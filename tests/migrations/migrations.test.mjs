import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import { appendLedgerEvent } from '../../dist/index.js';
import { assertDisposableMarker, databaseConfigFromEnvironment, migratorDatabaseConfigFromEnvironment, runtimeDatabaseConfigFromEnvironment, DISPOSABLE_MARKER } from '../../scripts/test-db-lifecycle.mjs';

const { Client, Pool } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function hasDestructiveMigrationStatement(sql) {
  const tokens = [];
  let index = 0;
  let statement = 0;
  const dollarDelimiters = [];
  while (index < sql.length) {
    const rest = sql.slice(index);
    const current = sql[index];
    if (rest.startsWith('--')) {
      const newline = sql.indexOf('\n', index + 2);
      index = newline < 0 ? sql.length : newline + 1;
      continue;
    }
    if (rest.startsWith('/*')) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) { depth++; index += 2; }
        else if (sql.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      continue;
    }
    const activeDollarDelimiter = dollarDelimiters.at(-1);
    if (activeDollarDelimiter && rest.startsWith(activeDollarDelimiter)) {
      index += activeDollarDelimiter.length;
      dollarDelimiters.pop();
      continue;
    }
    if (current === '$') {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)?.[0];
      if (delimiter) {
        // Procedural bodies can contain their own tagged strings. Track each
        // delimiter so nested tags cannot merge with or hide SQL keywords.
        dollarDelimiters.push(delimiter);
        index += delimiter.length;
        continue;
      }
    }
    if (current === "'" || current === '"') {
      const quote = current;
      index++;
      let contents = '';
      while (index < sql.length) {
        if (sql[index] === '\\' && index + 1 < sql.length) {
          contents += sql[index + 1];
          index += 2;
        } else if (sql[index] === quote && sql[index + 1] === quote) {
          contents += quote;
          index += 2;
        } else if (sql[index] === quote) {
          index++;
          break;
        } else {
          contents += sql[index++];
        }
      }
      const searchableContents = contents.replace(/\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g, ' ');
      for (const match of searchableContents.matchAll(/[A-Za-z_][A-Za-z0-9_$]*/g)) {
        tokens.push({ kind: 'word', value: match[0].toUpperCase(), statement, quoted: true, inDollar: dollarDelimiters.length > 0 });
      }
      continue;
    }
    let word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(rest)?.[0];
    if (word) {
      if (dollarDelimiters.length > 0) {
        const nestedDelimiter = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(word);
        if (nestedDelimiter) word = word.slice(0, nestedDelimiter.index);
      }
      tokens.push({ kind: 'word', value: word.toUpperCase(), statement, quoted: false, inDollar: dollarDelimiters.length > 0 });
      index += word.length;
      continue;
    }
    if (current === ';' && dollarDelimiters.length === 0) {
      statement++;
    } else if (current === ';') {
      tokens.push({ kind: 'punctuation', value: ';', statement, quoted: false, inDollar: true });
    }
    index++;
  }

  return tokens.some(token => {
    if (token.kind !== 'word') return false;
    if (token.value === 'DROP') return true;
    if (token.value !== 'TRUNCATE') return false;

    // Only the SQL event name in a CREATE TRIGGER ... BEFORE TRUNCATE ON
    // declaration is safe. Quoted strings and dollar-quoted bodies stay
    // conservative: they may contain dynamic SQL that executes later.
    if (token.quoted || token.inDollar) return true;
    const statementTokens = tokens.filter(item => item.statement === token.statement);
    const codeWords = statementTokens.filter(item => item.kind === 'word' && !item.quoted && !item.inDollar);
    const position = codeWords.indexOf(token);
    const safeTriggerDeclaration = codeWords[0]?.value === 'CREATE'
      && codeWords[1]?.value === 'TRIGGER'
      && position > 1
      && codeWords[position - 1]?.value === 'BEFORE'
      && codeWords[position + 1]?.value === 'ON';
    return !safeTriggerDeclaration;
  });
}

function testChildEnvironment(prefix) {
  const keys = ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME'].map(suffix => `${prefix}_${suffix}`);
  return Object.fromEntries([['PATH', process.env.PATH ?? ''], ...keys.map(key => [key, process.env[key]])]);
}

async function verifyDurability(prefix) {
  const config = databaseConfigFromEnvironment(prefix);
  const probeId = randomUUID();
  const client = new Client(config);
  await client.connect();
  try {
    const marker = await client.query('SELECT marker FROM ci_test.disposable_database_marker');
    assertDisposableMarker(marker.rows);
    const health = await client.query('SELECT migrations_ready, required_migrations_present FROM cost_intelligence.foundation_health');
    assert.equal(health.rows[0].migrations_ready, true);
    assert.equal(Number(health.rows[0].required_migrations_present), 6);
    await client.query('CREATE TABLE IF NOT EXISTS ci_test.foundation_durable_probe (probe_id uuid PRIMARY KEY, payload text NOT NULL)');
    await client.query('INSERT INTO ci_test.foundation_durable_probe(probe_id, payload) VALUES ($1, $2)', [probeId, `verified:${prefix}`]);
  } finally {
    await client.end();
  }

  const child = spawnSync(process.execPath, ['scripts/verify-db-durability.mjs', prefix, probeId], {
    cwd: root, encoding: 'utf8', timeout: 15000, env: testChildEnvironment(prefix),
  });
  assert.equal(child.status, 0, `fresh worker could not see the durable record and health view: ${(child.stderr || child.stdout || 'no output').slice(0, 1000)}`);
  assert.match(child.stdout, /durable database health and record verified/);
}

test('fresh and previous foundation schemas apply checksummed upgrades, survive reconnect, and expose health', async () => {
  assert.equal(hasDestructiveMigrationStatement('CREATE TRIGGER guard BEFORE TRUNCATE ON schema.table FOR EACH STATEMENT EXECUTE FUNCTION guard_fn();'), false,
    'append-only TRUNCATE trigger declarations are not destructive migration statements');
  assert.equal(hasDestructiveMigrationStatement('CREATE TRIGGER guard BEFORE /* rationale */ TRUNCATE /* event */ ON schema.table FOR EACH STATEMENT EXECUTE FUNCTION guard_fn();'), false,
    'comments within a safe trigger declaration do not make it destructive');
  assert.equal(hasDestructiveMigrationStatement('  DROP\n TABLE schema.table;'), true,
    'indented multiline DROP statements remain forbidden');
  assert.equal(hasDestructiveMigrationStatement(';\nTRUNCATE\n TABLE schema.table;'), true,
    'multiline TRUNCATE statements remain forbidden');
  assert.equal(hasDestructiveMigrationStatement('/* rationale */ DROP TABLE schema.table;'), true,
    'block comments cannot hide destructive DROP statements');
  assert.equal(hasDestructiveMigrationStatement('-- rationale\nTRUNCATE TABLE schema.table;'), true,
    'line comments cannot hide destructive TRUNCATE statements');
  assert.equal(hasDestructiveMigrationStatement('DO $$ BEGIN DROP TABLE schema.table; END $$;'), true,
    'procedural bodies remain scanned for destructive statements');
  assert.equal(hasDestructiveMigrationStatement('DO $$ BEGIN TRUNCATE TABLE schema.table; END $$;'), true,
    'procedural TRUNCATE statements remain forbidden');
  assert.equal(hasDestructiveMigrationStatement('DO $$ BEGIN EXECUTE $q$DROP TABLE ci_test.reviewer_guard$q$; END $$;'), true,
    'nested tagged strings cannot hide DROP immediately after their opening delimiter');
  assert.equal(hasDestructiveMigrationStatement('DO $$ BEGIN EXECUTE $q$TRUNCATE TABLE ci_test.reviewer_guard$q$; END $$;'), true,
    'nested tagged strings cannot hide TRUNCATE immediately after their opening delimiter');
  assert.equal(hasDestructiveMigrationStatement("SELECT '$q$DROP TABLE ci_test.reviewer_guard$q$';"), true,
    'dollar tags inside quoted dynamic SQL text cannot hide DROP');
  assert.equal(hasDestructiveMigrationStatement('DO $outer$ BEGIN EXECUTE $inner$DROP TABLE ci_test.reviewer_guard$inner$; END $outer$;'), true,
    'distinct nested dollar tags remain scanned through their matching closing delimiters');
  assert.equal(hasDestructiveMigrationStatement('DO $$ BEGIN EXECUTE $q$TRUNCATE$q$ || $r$ TABLE ci_test.reviewer_guard$r$; END $$;'), true,
    'a closing tag adjacent to a destructive keyword cannot split it out of the scan');
  assert.equal(hasDestructiveMigrationStatement('DO $$ BEGIN EXECUTE $q$SELECT 1$q$; END $$;'), false,
    'nested dollar tags without destructive statements remain allowed');
  assert.equal(hasDestructiveMigrationStatement('DO $$ BEGIN -- DROP TABLE ci_test.reviewer_guard\n EXECUTE $q$SELECT 1$q$; END $$;'), false,
    'commented destructive keywords inside procedural bodies remain ignored');
  assert.equal(hasDestructiveMigrationStatement('SELECT 1 /* DROP TABLE ci_test.reviewer_guard */;'), false,
    'commented keywords outside procedural bodies remain ignored');
  assert.equal(hasDestructiveMigrationStatement("SELECT 'DROP TABLE schema.table';"), true,
    'dynamic destructive SQL text is rejected conservatively');
  assert.equal(hasDestructiveMigrationStatement("EXECUTE 'TRUNCATE TABLE schema.table';"), true,
    'quoted dynamic TRUNCATE text remains rejected conservatively');
  assert.equal(hasDestructiveMigrationStatement('EXECUTE $$TRUNCATE TABLE schema.table$$;'), true,
    'dollar-quoted dynamic TRUNCATE text remains rejected conservatively');
  assert.equal(hasDestructiveMigrationStatement('CREATE TRIGGER guard BEFORE TRUNCATE ON schema.table FOR EACH STATEMENT EXECUTE FUNCTION guard_fn(); TRUNCATE TABLE schema.table;'), true,
    'a safe trigger declaration cannot exempt a later destructive statement');
  assert.throws(() => assertDisposableMarker([]), /not marked as a disposable/);
  assert.throws(() => assertDisposableMarker([{ marker: 'unrelated' }]), /not marked as a disposable/);
  assert.equal(assertDisposableMarker([{ marker: DISPOSABLE_MARKER }]), true);
  assert.ok(process.env.CI_TEST_DB_HOST, 'with-postgres lifecycle must provide split connection settings for its validated disposable database');
  assert.equal(process.env.CI_TEST_PREVIOUS_FIXTURE_LOADED, '1', 'previous-version upgrade fixture must be installed before this suite starts');

  const migrations = JSON.parse(process.env.CI_TEST_MIGRATIONS ?? 'null');
  const previousMigrations = JSON.parse(process.env.CI_TEST_PREVIOUS_MIGRATIONS ?? 'null');
  assert.ok(Array.isArray(migrations) && migrations.length > 0, 'fresh database migration outcomes must be recorded');
  assert.ok(Array.isArray(previousMigrations) && previousMigrations.length > 0, 'previous database migration outcomes must be recorded');
  assert.ok(migrations.every(item => item.status === 'applied'), 'fresh database must apply each migration');
  assert.deepEqual(previousMigrations.map(({ version, status }) => ({ version, status })), [
    { version: '0001_foundation', status: 'already_applied' },
    { version: '0002_foundation_health', status: 'applied' },
    { version: '0003_financial_ledger', status: 'applied' },
    { version: '0004_pricing_catalog', status: 'applied' },
    { version: '0005_pricing_valuation_history', status: 'applied' },
    { version: '0006_finance_security_roles', status: 'applied' },
  ]);

  const names = (await readdir(join(root, 'migrations'))).filter(name => name.endsWith('.sql')).sort();
  assert.equal(names.length, 6, 'foundation migration suite must exercise fresh creation and an additive security upgrade');
  for (const prefix of ['CI_TEST_DB', 'CI_TEST_PREVIOUS_DB']) {
    const client = new Client(databaseConfigFromEnvironment(prefix));
    await client.connect();
    try {
      const marker = await client.query('SELECT marker FROM ci_test.disposable_database_marker');
      assertDisposableMarker(marker.rows);
      const records = await client.query('SELECT version, checksum_sha256 FROM cost_intelligence.schema_migrations ORDER BY version');
      assert.equal(records.rowCount, names.length);
      for (let index = 0; index < names.length; index++) {
        const sql = await readFile(join(root, 'migrations', names[index]), 'utf8');
        assert.equal(hasDestructiveMigrationStatement(sql), false,
          'incremental migrations must not start destructive DROP or TRUNCATE statements');
        assert.equal(records.rows[index].version, names[index].replace(/\.sql$/, ''));
        assert.equal(records.rows[index].checksum_sha256.trim(), createHash('sha256').update(sql).digest('hex'));
      }
      const requiredLedgerTables = [
        'financial_ledger_events', 'financial_ledger_identity_bindings', 'financial_source_revision_heads',
        'financial_posting_attempt_mappings', 'financial_projection_snapshots', 'financial_projection_amounts',
        'financial_projection_quantities', 'financial_ledger_quarantine', 'financial_privacy_quarantine',
      ];
      const ledgerTables = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'cost_intelligence' AND table_name = ANY($1::text[]) ORDER BY table_name`,
        [requiredLedgerTables],
      );
      assert.deepEqual(ledgerTables.rows.map(row => row.table_name), [...requiredLedgerTables].sort(),
        'fresh and upgraded schemas must include the ledger, mapping, snapshot, and quarantine tables');
      const requiredPricingTables = [
        'pricing_rule_versions', 'pricing_rate_card_versions', 'pricing_fx_rate_versions',
        'pricing_operation_idempotency', 'pricing_estimate_snapshots',
      ];
      const pricingTables = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'cost_intelligence' AND table_name = ANY($1::text[]) ORDER BY table_name`,
        [requiredPricingTables],
      );
      assert.deepEqual(pricingTables.rows.map(row => row.table_name), [...requiredPricingTables].sort(),
        'fresh and upgraded schemas must include append-only rate, rule, and FX version catalogs');
      const requiredEventColumns = [
        'posting_mapping_version', 'source_line_id', 'transport_attempt_status', 'provider_attempt_status',
        'provider_request_status', 'billable_attempt_status', 'economic_event_type',
      ];
      const eventColumns = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'cost_intelligence' AND table_name = 'financial_ledger_events'
           AND column_name = ANY($1::text[]) ORDER BY column_name`,
        [requiredEventColumns],
      );
      assert.deepEqual(eventColumns.rows.map(row => row.column_name), [...requiredEventColumns].sort(),
        'event rows must retain versioned source-line and explicit upstream identity provenance');
      const requiredAppendOnlyTriggers = [
        'financial_ledger_events_append_only', 'financial_posting_attempt_mappings_append_only',
        'financial_posting_attempt_mappings_no_truncate', 'financial_projection_snapshots_append_only',
        'financial_projection_snapshots_no_truncate', 'financial_projection_amounts_append_only',
        'financial_projection_amounts_no_truncate', 'financial_projection_quantities_append_only',
        'financial_projection_quantities_no_truncate', 'financial_ledger_quarantine_append_only',
        'financial_ledger_quarantine_no_truncate', 'financial_privacy_quarantine_append_only',
        'financial_privacy_quarantine_no_truncate',
      ];
      const ledgerTriggers = await client.query(
        `SELECT t.tgname::text AS trigger_name
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'cost_intelligence' AND t.tgname::text = ANY($1::text[]) AND NOT t.tgisinternal
         ORDER BY t.tgname`,
        [requiredAppendOnlyTriggers],
      );
      assert.deepEqual(ledgerTriggers.rows.map(row => row.trigger_name), [...requiredAppendOnlyTriggers].sort(),
        'event, mapping, snapshot, and quarantine records must install append-only triggers');
      const requiredPricingTriggers = [
        'pricing_rule_versions_append_only', 'pricing_rule_versions_no_truncate',
        'pricing_rate_card_versions_append_only', 'pricing_rate_card_versions_no_truncate',
        'pricing_fx_rate_versions_append_only', 'pricing_fx_rate_versions_no_truncate',
        'pricing_operation_idempotency_append_only', 'pricing_operation_idempotency_no_truncate',
        'pricing_estimate_snapshots_append_only', 'pricing_estimate_snapshots_no_truncate',
      ];
      const pricingTriggers = await client.query(
        `SELECT t.tgname::text AS trigger_name
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'cost_intelligence' AND t.tgname::text = ANY($1::text[]) AND NOT t.tgisinternal
         ORDER BY t.tgname`,
        [requiredPricingTriggers],
      );
      assert.deepEqual(pricingTriggers.rows.map(row => row.trigger_name), [...requiredPricingTriggers].sort(),
        'rate cards, rules, and FX records must reject update, delete, and truncate');
      const health = await client.query('SELECT migrations_ready, required_migrations_present FROM cost_intelligence.foundation_health');
      assert.equal(health.rows[0].migrations_ready, true);
      assert.equal(Number(health.rows[0].required_migrations_present), names.length);

      const roleGroups = await client.query(
        `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
         FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
        [['ci_finance_migrator', 'ci_finance_owner', 'ci_finance_runtime']],
      );
      assert.deepEqual(roleGroups.rows.map(row => row.rolname), ['ci_finance_migrator', 'ci_finance_owner', 'ci_finance_runtime']);
      assert.deepEqual(roleGroups.rows.map(({ rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls }) =>
        ({ rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls })), [
        { rolname: 'ci_finance_migrator', rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: true },
        { rolname: 'ci_finance_owner', rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false },
        { rolname: 'ci_finance_runtime', rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false },
      ]);
      const scopedOwners = await client.query(
        `SELECT c.relname, owner.rolname AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles owner ON owner.oid = c.relowner
         WHERE n.nspname = 'cost_intelligence' AND c.relkind = 'r'
           AND c.relname LIKE 'financial_%' OR n.nspname = 'cost_intelligence' AND c.relname LIKE 'pricing_%'
         ORDER BY c.relname`,
      );
      assert.ok(scopedOwners.rows.length >= 14);
      assert.ok(scopedOwners.rows.every(row => row.owner === 'ci_finance_owner'),
        'runtime ledger and pricing tables are owned by the distinct non-login finance owner');
      const policyCount = await client.query(
        `SELECT count(*)::integer AS total FROM pg_policies WHERE schemaname = 'cost_intelligence'
           AND policyname LIKE '%_scope_policy'`,
      );
      assert.equal(policyCount.rows[0].total, 14, 'each scoped runtime table has an explicit RLS policy');
      const runtimePrivileges = await client.query(
        `SELECT has_table_privilege('ci_finance_runtime', 'cost_intelligence.financial_ledger_events', 'SELECT') AS can_read,
                has_table_privilege('ci_finance_runtime', 'cost_intelligence.financial_ledger_events', 'UPDATE') AS can_update,
                has_table_privilege('ci_finance_runtime', 'cost_intelligence.financial_ledger_events', 'DELETE') AS can_delete,
                has_table_privilege('ci_finance_runtime', 'cost_intelligence.financial_ledger_events', 'TRUNCATE') AS can_truncate,
                has_schema_privilege('ci_finance_runtime', 'cost_intelligence', 'CREATE') AS can_ddl,
                pg_has_role('ci_finance_runtime', 'ci_finance_owner', 'MEMBER') AS is_owner`);
      assert.deepEqual(runtimePrivileges.rows[0], {
        can_read: true, can_update: false, can_delete: false, can_truncate: false, can_ddl: false, is_owner: false,
      });
      const migrationPrivileges = await client.query(
        `SELECT has_schema_privilege('ci_finance_migrator', 'cost_intelligence', 'CREATE') AS can_ddl,
                has_table_privilege('ci_finance_migrator', 'cost_intelligence.financial_ledger_events', 'UPDATE') AS can_mutate_history,
                pg_has_role('ci_finance_migrator', 'ci_finance_owner', 'MEMBER') AS is_owner_member,
                pg_has_role('ci_finance_migrator', 'ci_finance_runtime', 'MEMBER') AS is_runtime_member`,
      );
      assert.deepEqual(migrationPrivileges.rows[0], {
        can_ddl: true, can_mutate_history: true, is_owner_member: true, is_runtime_member: false,
      }, 'migration administration has explicit owner powers without inheriting the service runtime role');
    } finally {
      await client.end();
    }
    await verifyDurability(prefix);

    const runtimeConfig = {
      ...runtimeDatabaseConfigFromEnvironment(),
      database: databaseConfigFromEnvironment(prefix).database,
    };
    const restricted = new Client(runtimeConfig);
    await restricted.connect();
    try {
      const roleState = await restricted.query(
        `SELECT role.rolsuper, role.rolcreatedb, role.rolcreaterole, role.rolbypassrls,
                pg_has_role(current_user, 'ci_finance_owner', 'MEMBER') AS is_owner
         FROM pg_roles role WHERE role.rolname = current_user`,
      );
      assert.equal(roleState.rows.length, 1);
      assert.deepEqual(roleState.rows[0], { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, is_owner: false });
      const unboundEvents = await restricted.query('SELECT event_id FROM cost_intelligence.financial_ledger_events LIMIT 10');
      assert.equal(unboundEvents.rows.length, 0, `${prefix} runtime role cannot read ledger rows without an authority-bound scope`);
      const unboundPricing = await restricted.query('SELECT rule_id FROM cost_intelligence.pricing_rule_versions LIMIT 10');
      assert.equal(unboundPricing.rows.length, 0, `${prefix} runtime role cannot read pricing rows without an authority-bound scope`);
      await assert.rejects(restricted.query('CREATE TABLE cost_intelligence.ci09_migration_forbidden (value text)'), error => error.code === '42501');
      await assert.rejects(restricted.query('UPDATE cost_intelligence.financial_ledger_events SET amount = amount'), error => error.code === '42501');
      await assert.rejects(restricted.query('TRUNCATE cost_intelligence.pricing_rate_card_versions'), error => error.code === '42501');
    } finally {
      await restricted.end();
    }

    const migrator = new Client({
      ...migratorDatabaseConfigFromEnvironment(),
      database: databaseConfigFromEnvironment(prefix).database,
    });
    await migrator.connect();
    try {
      const loginState = await migrator.query(
        `SELECT current_user, role.rolsuper, role.rolcreatedb, role.rolcreaterole, role.rolbypassrls,
                pg_has_role(current_user, 'ci_finance_migrator', 'MEMBER') AS is_migrator,
                pg_has_role(current_user, 'ci_finance_runtime', 'MEMBER') AS is_runtime,
                has_schema_privilege(current_user, 'cost_intelligence', 'CREATE') AS can_migrate
         FROM pg_roles role WHERE role.rolname = current_user`,
      );
      assert.equal(loginState.rows.length, 1);
      assert.deepEqual({
        superuser: loginState.rows[0].rolsuper,
        createdb: loginState.rows[0].rolcreatedb,
        createrole: loginState.rows[0].rolcreaterole,
        bypassrls: loginState.rows[0].rolbypassrls,
        isMigrator: loginState.rows[0].is_migrator,
        isRuntime: loginState.rows[0].is_runtime,
        canMigrate: loginState.rows[0].can_migrate,
      }, {
        superuser: false, createdb: false, createrole: false, bypassrls: false,
        isMigrator: true, isRuntime: false, canMigrate: true,
      }, `${prefix} migration login is non-superuser and has no runtime service grant`);
      await migrator.query('SET ROLE ci_finance_migrator');
      const activeRole = await migrator.query(
        `SELECT current_user, role.rolbypassrls,
                has_schema_privilege(current_user, 'cost_intelligence', 'CREATE') AS can_migrate
         FROM pg_roles role WHERE role.rolname = current_user`,
      );
      assert.deepEqual(activeRole.rows[0], { current_user: 'ci_finance_migrator', rolbypassrls: true, can_migrate: true });
      const probeName = `ci09_migrator_probe_${randomUUID().replaceAll('-', '')}`;
      await migrator.query(`CREATE TABLE cost_intelligence.${probeName} (probe_id integer)`);
      await migrator.query(`DROP TABLE cost_intelligence.${probeName}`);
      await migrator.query('SELECT cost_intelligence.audit_legacy_financial_privacy()');
    } finally {
      await migrator.end();
    }
  }

  const auditPool = new Pool({ ...databaseConfigFromEnvironment('CI_TEST_DB'), max: 2 });
  const scope = {
    tenantId: `ci09-migration-tenant-${randomUUID()}`, projectId: `ci09-migration-project-${randomUUID()}`,
    environment: 'test', billingMode: 'simulated', actorId: 'ci09-migration-audit-service',
  };
  const now = '2026-10-11T03:30:00.000Z';
  const eventId = `ci09-migration-event-${randomUUID()}`;
  const request = {
    schemaVersion: '1.0.0', requestId: `ci09-migration-request-${randomUUID()}`, idempotencyKey: `ci09-migration-idem-${randomUUID()}`,
    scope, eventId, correlationId: `ci09-migration-correlation-${randomUUID()}`,
    producer: { module: 'ci09.migration.test', sourceRevision: 'a'.repeat(40), buildRevision: 'fixture-1' },
    occurredAt: now, observedAt: now, evidenceMode: 'mocked', verificationStatus: 'verified',
    eventType: 'expense', classification: 'direct_cost', valuation: 'provider_confirmed', settlementStatus: 'unpaid',
    reconciliationStatus: 'unmatched', reservationLifecycle: null,
    identities: { logicalOperationId: `ci09-migration-operation-${randomUUID()}`, sourceObservationId: `ci09-migration-observation-${randomUUID()}`, reservationId: null },
    postingMapping: {
      schemaVersion: '1.0.0', sourceLineId: 'migration-line', transportAttemptId: { status: 'unknown' },
      providerAttemptId: { status: 'unknown' }, providerRequestId: { status: 'unknown' }, billableAttemptId: { status: 'unknown' },
    },
    sourceIdentity: {
      source: 'ci09-migration-fixture', sourceEventId: `source-${eventId}`, sourceObjectId: `object-${eventId}`,
      revisionSubjectId: 'migration-line', sourceRevision: 'revision-0', revisionSequence: 0,
      contentHash: `sha256:${'a'.repeat(64)}`,
    },
    usage: { completeness: 'complete', missingFields: [], units: [{ name: 'tokens', quantity: '1', scale: 0, relation: 'standalone' }] },
    money: { amount: '0.05', currency: 'USD', scale: 2 }, sourceRefs: [], dimensions: {}, pricing: null, fxEvidence: null,
    financialEffect: true, reservationAuthorizationEventId: null, supersedesEventId: null, reversesEventId: null,
  };
  try {
    const appended = await appendLedgerEvent(request, {
      database: { connect: () => auditPool.connect() },
      trustedContext: { resolve: async requested => requested },
      clock: { now: () => new Date(now) },
      financeAuthority: { authorizeCurrent: async grant => ({
        status: 'allowed', decisionId: 'ci09-migration-fixture-grant', operation: grant.operation,
        permission: grant.permission, scope: grant.requestedScope,
        principal: { kind: 'service', actorId: grant.requestedScope.actorId, serviceStatus: 'active', serviceGrantRevision: 'fixture-1' },
        verifiedAt: now, expiresAt: '2026-10-11T03:31:00.000Z',
      }) },
    });
    assert.equal(appended.ok, true, appended.ok ? '' : appended.error.code);

    const privateEvidence = [{
      contract: 'ci09.migration.evidence', schema_version: '1.0.0',
      id: 'https://evidence.invalid/raw?token=CI09_MIGRATION_PRIVATE_SOURCE_TOKEN', revision: 1,
      content_hash: `sha256:${'b'.repeat(64)}`,
    }];
    await auditPool.query('ALTER TABLE cost_intelligence.financial_ledger_events DISABLE TRIGGER financial_ledger_events_append_only');
    try {
      await auditPool.query(
        `UPDATE cost_intelligence.financial_ledger_events
         SET source_refs = $1::jsonb, event_payload = jsonb_set(event_payload, '{sourceRefs}', $1::jsonb)
         WHERE event_id = $2`,
        [JSON.stringify(privateEvidence), eventId],
      );
    } finally {
      await auditPool.query('ALTER TABLE cost_intelligence.financial_ledger_events ENABLE TRIGGER financial_ledger_events_append_only');
    }
    const event = await auditPool.query('SELECT event_hash FROM cost_intelligence.financial_ledger_events WHERE event_id = $1', [eventId]);
    assert.equal(event.rows.length, 1);
    const migrator = new Client({ ...migratorDatabaseConfigFromEnvironment(), database: databaseConfigFromEnvironment('CI_TEST_DB').database });
    await migrator.connect();
    try {
      await migrator.query('SET ROLE ci_finance_migrator');
      await migrator.query('SELECT cost_intelligence.audit_legacy_financial_privacy()');
    } finally {
      await migrator.end();
    }
    const audited = await auditPool.query(
      `SELECT record_kind, record_hash, reason_code FROM cost_intelligence.financial_privacy_quarantine
       WHERE record_hash = $1`, [event.rows[0].event_hash],
    );
    assert.deepEqual(audited.rows, [{ record_kind: 'ledger_event', record_hash: event.rows[0].event_hash, reason_code: 'legacy_sensitive_event_data' }]);
    assert.doesNotMatch(JSON.stringify(audited.rows), /CI09_MIGRATION_PRIVATE_SOURCE_TOKEN/);

    const restricted = new Client(runtimeDatabaseConfigFromEnvironment());
    await restricted.connect();
    try {
      await restricted.query('BEGIN');
      await restricted.query(
        `SELECT set_config('cost_intelligence.tenant_id', $1, true), set_config('cost_intelligence.project_id', $2, true),
                set_config('cost_intelligence.environment', $3, true), set_config('cost_intelligence.billing_mode', $4, true)`,
        [scope.tenantId, scope.projectId, scope.environment, scope.billingMode],
      );
      const hidden = await restricted.query('SELECT event_id FROM cost_intelligence.financial_ledger_events WHERE event_id = $1', [eventId]);
      assert.equal(hidden.rows.length, 0, 'privacy quarantine hides contaminated historical rows while preserving the immutable event');
      await restricted.query('COMMIT');
    } finally {
      await restricted.end();
    }
  } finally {
    await auditPool.end();
  }
});
