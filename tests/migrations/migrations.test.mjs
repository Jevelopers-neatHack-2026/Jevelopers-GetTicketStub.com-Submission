import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import { assertDisposableMarker, databaseConfigFromEnvironment, DISPOSABLE_MARKER } from '../../scripts/test-db-lifecycle.mjs';

const { Client } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function hasDestructiveMigrationStatement(sql) {
  const tokens = [];
  let index = 0;
  let statement = 0;
  let dollarDelimiter = null;
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
    if (dollarDelimiter && rest.startsWith(dollarDelimiter)) {
      index += dollarDelimiter.length;
      dollarDelimiter = null;
      continue;
    }
    if (!dollarDelimiter && current === '$') {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)?.[0];
      if (delimiter) {
        dollarDelimiter = delimiter;
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
      for (const match of contents.matchAll(/[A-Za-z_][A-Za-z0-9_$]*/g)) {
        tokens.push({ kind: 'word', value: match[0].toUpperCase(), statement, quoted: true, inDollar: dollarDelimiter !== null });
      }
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(rest)?.[0];
    if (word) {
      tokens.push({ kind: 'word', value: word.toUpperCase(), statement, quoted: false, inDollar: dollarDelimiter !== null });
      index += word.length;
      continue;
    }
    if (current === ';' && dollarDelimiter === null) {
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
    assert.equal(Number(health.rows[0].required_migrations_present), 3);
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
  ]);

  const names = (await readdir(join(root, 'migrations'))).filter(name => name.endsWith('.sql')).sort();
  assert.equal(names.length, 3, 'foundation migration suite must exercise fresh creation and an incremental upgrade');
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
        'financial_projection_quantities', 'financial_ledger_quarantine',
      ];
      const ledgerTables = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'cost_intelligence' AND table_name = ANY($1::text[]) ORDER BY table_name`,
        [requiredLedgerTables],
      );
      assert.deepEqual(ledgerTables.rows.map(row => row.table_name), [...requiredLedgerTables].sort(),
        'fresh and upgraded schemas must include the ledger, mapping, snapshot, and quarantine tables');
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
        'financial_ledger_quarantine_no_truncate',
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
      const health = await client.query('SELECT migrations_ready, required_migrations_present FROM cost_intelligence.foundation_health');
      assert.equal(health.rows[0].migrations_ready, true);
      assert.equal(Number(health.rows[0].required_migrations_present), names.length);
    } finally {
      await client.end();
    }
    await verifyDurability(prefix);
  }
});
