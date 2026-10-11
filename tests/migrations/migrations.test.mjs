import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import { appendLedgerEvent, rebuildLedgerProjection } from '../../dist/index.js';
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

const legacyFixtureTime = '2026-10-11T03:30:00.000Z';
const legacyFixtureAsOf = '2026-10-11T04:00:00.000Z';
const legacyPrivacyMarker = 'CI09_FIX2_PROMPT_ADDRESS_TOKEN_CANARY';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function contentAddress(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function legacyScope(label, overrides = {}) {
  const suffix = randomUUID();
  return {
    tenantId: overrides.tenantId ?? `ci09-legacy-tenant-${suffix}`,
    projectId: overrides.projectId ?? `ci09-legacy-project-${suffix}`,
    environment: overrides.environment ?? 'test',
    billingMode: overrides.billingMode ?? 'simulated',
    actorId: overrides.actorId ?? `ci09-legacy-actor-${label}-${suffix}`,
  };
}

function legacyRequest(scope, options = {}) {
  const eventId = options.eventId ?? `ci09-legacy-event-${randomUUID()}`;
  const eventType = options.eventType ?? 'expense';
  const amount = Object.hasOwn(options, 'amount') ? options.amount : '0.05';
  const sequence = options.revisionSequence ?? 0;
  const sourceObjectId = options.sourceObjectId ?? `ci09-legacy-object-${eventId}`;
  const revisionSubjectId = options.revisionSubjectId ?? `ci09-legacy-line-${eventId}`;
  const logicalOperationId = options.logicalOperationId ?? `ci09-legacy-operation-${eventId}`;
  const memoEvent = ['usage_observation', 'reservation_authorized', 'dispatch', 'reservation_release'].includes(eventType);
  const sourceRef = {
    contract: 'ci09.legacy.synthetic', schema_version: '1.0.0', id: `ci09-legacy-proof-${eventId}`,
    revision: 1, content_hash: contentAddress({ evidence: eventId }),
  };
  const sourceRefs = options.sourceRefs ?? (['correction', 'reversal', 'adjustment'].includes(eventType) ? [sourceRef] : []);
  const usage = options.usage ?? {
    completeness: 'complete', missingFields: [],
    units: [{ name: 'token', quantity: '1', scale: 0, relation: 'standalone' }],
  };
  return {
    schemaVersion: '1.0.0', requestId: `ci09-legacy-request-${eventId}`,
    idempotencyKey: `ci09-legacy-idempotency-${eventId}`, scope, eventId,
    correlationId: `ci09-legacy-correlation-${eventId}`,
    producer: { module: 'ci09.legacy.tokenization', sourceRevision: 'b'.repeat(40), buildRevision: 'legacy-fixture-1' },
    occurredAt: legacyFixtureTime, observedAt: legacyFixtureTime, evidenceMode: 'mocked', verificationStatus: 'verified',
    eventType,
    classification: options.classification ?? (eventType === 'usage_observation' ? 'usage_memo' : memoEvent ? 'reservation_memo' : 'direct_cost'),
    valuation: options.valuation ?? (amount === null ? 'unknown' : 'provider_confirmed'),
    settlementStatus: options.settlementStatus ?? 'unpaid', reconciliationStatus: 'unmatched',
    reservationLifecycle: Object.hasOwn(options, 'reservationLifecycle') ? options.reservationLifecycle : null,
    identities: {
      logicalOperationId, sourceObservationId: options.sourceObservationId ?? `ci09-legacy-observation-${eventId}`,
      reservationId: Object.hasOwn(options, 'reservationId') ? options.reservationId : null,
    },
    postingMapping: {
      schemaVersion: '1.0.0', sourceLineId: revisionSubjectId,
      transportAttemptId: { status: 'unknown' }, providerAttemptId: { status: 'unknown' },
      providerRequestId: { status: 'unknown' }, billableAttemptId: { status: 'unknown' },
    },
    sourceIdentity: {
      source: 'ci09-legacy-tokenization', sourceEventId: `ci09-legacy-source-event-${eventId}`,
      sourceObjectId, revisionSubjectId, sourceRevision: `legacy-revision-${sequence}`,
      revisionSequence: sequence, contentHash: contentAddress({ source: eventId, sequence }),
    },
    usage, money: { amount, currency: options.currency ?? 'USD', scale: options.scale ?? (amount === null ? 2 : amount.split('.')[1]?.length ?? 0) },
    sourceRefs, dimensions: options.dimensions ?? { feature: 'legacy usage metering', model: 'tokenization-runner' },
    pricing: null, fxEvidence: null, financialEffect: Object.hasOwn(options, 'financialEffect') ? options.financialEffect : !memoEvent,
    reservationAuthorizationEventId: options.reservationAuthorizationEventId ?? null,
    supersedesEventId: options.supersedesEventId ?? null, reversesEventId: options.reversesEventId ?? null,
  };
}

function legacyPorts(pool) {
  return {
    database: { connect: () => pool.connect() },
    trustedContext: { resolve: async requested => requested },
    clock: { now: () => new Date(legacyFixtureTime) },
    financeAuthority: { authorizeCurrent: async request => ({
      status: 'allowed', decisionId: `ci09-legacy-fixture:${request.operation}`,
      operation: request.operation, permission: request.permission, scope: request.requestedScope,
      principal: {
        kind: 'service', actorId: request.requestedScope.actorId, serviceStatus: 'active',
        serviceGrantRevision: 'ci09-legacy-fixture-1',
      },
      verifiedAt: legacyFixtureTime, expiresAt: '2026-10-11T03:35:00.000Z',
    }) },
  };
}

async function appendLegacyEvent(pool, request) {
  const result = await appendLedgerEvent(request, legacyPorts(pool));
  assert.equal(result.ok, true, result.ok ? '' : `legacy fixture append: ${result.error.code}`);
  assert.equal(result.value.status, 'accepted');
  return result.value;
}

async function projectLegacyScope(pool, scope, asOf = legacyFixtureAsOf) {
  return rebuildLedgerProjection({
    schemaVersion: '1.0.0', requestId: `ci09-legacy-projection-${randomUUID()}`, scope, asOf,
  }, legacyPorts(pool));
}

async function createPre0006Database() {
  const base = databaseConfigFromEnvironment('CI_TEST_DB');
  const name = `ci09_legacy_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ ...base, database: 'postgres' });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  return { name, base, config: { ...base, database: name } };
}

async function installDisposableMarker(client) {
  await client.query('CREATE SCHEMA ci_test');
  await client.query('CREATE TABLE ci_test.disposable_database_marker (marker text PRIMARY KEY)');
  await client.query('INSERT INTO ci_test.disposable_database_marker(marker) VALUES ($1)', [DISPOSABLE_MARKER]);
}

async function applyMigrationsThrough0005(client, names) {
  await client.query('CREATE SCHEMA IF NOT EXISTS cost_intelligence');
  await client.query(`CREATE TABLE IF NOT EXISTS cost_intelligence.schema_migrations (
    version text PRIMARY KEY, checksum_sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const name of names.slice(0, 5)) {
    const sql = await readFile(join(root, 'migrations', name), 'utf8');
    const version = name.replace(/\.sql$/, '');
    const checksum = createHash('sha256').update(sql).digest('hex');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO cost_intelligence.schema_migrations(version, checksum_sha256) VALUES ($1, $2)',
        [version, checksum],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  }
}

async function contaminateLegacyEvent(client, eventId, mutate) {
  await client.query('ALTER TABLE cost_intelligence.financial_ledger_events DISABLE TRIGGER financial_ledger_events_append_only');
  try {
    const current = await client.query(
      'SELECT event_payload FROM cost_intelligence.financial_ledger_events WHERE event_id = $1', [eventId],
    );
    assert.equal(current.rows.length, 1);
    const persisted = current.rows[0].event_payload;
    const request = JSON.parse(JSON.stringify(persisted));
    const ingestedAt = request.ingestedAt;
    delete request.ingestedAt;
    mutate(request);
    const payload = { ...request, ingestedAt };
    const eventHash = contentAddress(request);
    await client.query(
      `UPDATE cost_intelligence.financial_ledger_events
       SET source_refs = $1::jsonb, quantity_units = $2::jsonb, dimensions = $3::jsonb,
           event_hash = $4, event_payload = $5::jsonb
       WHERE event_id = $6`,
      [JSON.stringify(request.sourceRefs), JSON.stringify(request.usage.units), JSON.stringify(request.dimensions),
        eventHash, JSON.stringify(payload), eventId],
    );
    return { eventHash, payload };
  } finally {
    await client.query('ALTER TABLE cost_intelligence.financial_ledger_events ENABLE TRIGGER financial_ledger_events_append_only');
  }
}

async function insertSnapshotWithSensitiveLabel(client, scope, sourceSnapshot) {
  const effective = await client.query(
    `SELECT e.event_id, e.event_hash
     FROM cost_intelligence.financial_ledger_events e
     WHERE e.tenant_id = $1 AND e.project_id = $2 AND e.environment = $3 AND e.billing_mode = $4
       AND e.ingested_at <= $5 AND e.financial_effect
       AND NOT EXISTS (
         SELECT 1 FROM cost_intelligence.financial_ledger_events successor
         WHERE successor.supersedes_event_id = e.event_id AND successor.ingested_at <= $5
       )
     ORDER BY e.event_id`,
    [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, sourceSnapshot.asOf],
  );
  const eventEvidence = effective.rows.map(row => ({ eventId: row.event_id, eventHash: row.event_hash }));
  let marked = false;
  const quantities = sourceSnapshot.quantities.map(item => {
    if (!marked && item.unitName !== null) {
      marked = true;
      return { ...item, unitName: legacyPrivacyMarker };
    }
    return { ...item };
  });
  assert.equal(marked, true, 'legacy label fixture must include a materialized measure name');
  const content = {
    schemaVersion: '1.0.0', scope, asOf: sourceSnapshot.asOf, eventEvidence,
    eventCount: eventEvidence.length, amounts: sourceSnapshot.amounts, quantities,
  };
  const snapshotHash = contentAddress(content);
  await client.query(
    `INSERT INTO cost_intelligence.financial_projection_snapshots
      (snapshot_id, tenant_id, project_id, environment, billing_mode, as_of, event_count, projection_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [snapshotHash, scope.tenantId, scope.projectId, scope.environment, scope.billingMode,
      sourceSnapshot.asOf, eventEvidence.length, snapshotHash],
  );
  for (const item of sourceSnapshot.amounts) {
    await client.query(
      `INSERT INTO cost_intelligence.financial_projection_amounts
        (snapshot_id, event_type, classification, currency, event_count, known_amount_count,
         unknown_amount_count, known_subtotal, total_amount, amount_completeness)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [snapshotHash, item.eventType, item.classification, item.currency, item.eventCount, item.knownAmountCount,
        item.unknownAmountCount, item.knownSubtotal, item.totalAmount, item.completeness],
    );
  }
  for (const item of quantities) {
    await client.query(
      `INSERT INTO cost_intelligence.financial_projection_quantities
        (snapshot_id, event_type, classification, currency, unit_name, relation, observation_count,
         known_quantity_count, unknown_quantity_count, incomplete_observation_count, known_subtotal,
         total_quantity, quantity_completeness)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [snapshotHash, item.eventType, item.classification, item.currency, item.unitName, item.relation,
        item.observationCount, item.knownQuantityCount, item.unknownQuantityCount, item.incompleteObservationCount,
        item.knownSubtotal, item.totalQuantity, item.completeness],
    );
  }
  return snapshotHash;
}

async function apply0006ToLegacyDatabase(client, name) {
  const sql = await readFile(join(root, 'migrations', name), 'utf8');
  const version = name.replace(/\.sql$/, '');
  const checksum = createHash('sha256').update(sql).digest('hex');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO cost_intelligence.schema_migrations(version, checksum_sha256) VALUES ($1, $2)',
      [version, checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function assert0006RejectedBeforeRecord(client, migrationName, label) {
  await assert.rejects(
    apply0006ToLegacyDatabase(client, migrationName),
    error => error.code === '42501',
    `${label}: unsafe pre-existing runtime authority must stop the upgrade`,
  );
  const recorded = await client.query(
    'SELECT version FROM cost_intelligence.schema_migrations WHERE version = $1',
    [migrationName.replace(/\.sql$/, '')],
  );
  assert.deepEqual(recorded.rows, [], `${label}: a rejected upgrade cannot report migration success`);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function captureLegacyFinancialRows(client) {
  const tables = [
    'financial_ledger_events', 'financial_ledger_identity_bindings', 'financial_source_revision_heads',
    'financial_posting_attempt_mappings', 'financial_ledger_quarantine', 'financial_projection_snapshots',
    'financial_projection_amounts', 'financial_projection_quantities',
  ];
  const captured = {};
  for (const table of tables) {
    const result = await client.query(
      `SELECT COALESCE(jsonb_agg(item ORDER BY item::text), '[]'::jsonb)::text AS rows
       FROM (SELECT to_jsonb(source_row) AS item FROM cost_intelligence.${table} source_row) records`,
    );
    captured[table] = result.rows[0].rows;
  }
  return captured;
}

async function bindRawFinanceScope(client, scope) {
  await client.query(
    `SELECT set_config('cost_intelligence.tenant_id', $1, true),
            set_config('cost_intelligence.project_id', $2, true),
            set_config('cost_intelligence.environment', $3, true),
            set_config('cost_intelligence.billing_mode', $4, true)`,
    [scope.tenantId, scope.projectId, scope.environment, scope.billingMode],
  );
}

function assertLegacyUnavailable(result, label) {
  assert.equal(result.ok, false, `${label} must not return an apparently complete snapshot or append receipt`);
  if (result.ok) return null;
  assert.equal(result.error.code, 'SOURCE_UNAVAILABLE', `${label} must fail closed with the typed unavailable status`);
  assert.match(result.error.diagnostic_ref, /^ci1:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.equal(result.error.safe_message, 'Ledger history in this scope is restricted pending financial review.');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(legacyPrivacyMarker));
  return result.error.diagnostic_ref;
}

async function dropTestDatabase(name, base) {
  const admin = new Client({ ...base, database: 'postgres' });
  await admin.connect();
  try {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await admin.end();
  }
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
        `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
         FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
        [['ci_finance_migrator', 'ci_finance_owner', 'ci_finance_runtime']],
      );
      assert.deepEqual(roleGroups.rows.map(row => row.rolname), ['ci_finance_migrator', 'ci_finance_owner', 'ci_finance_runtime']);
      assert.deepEqual(roleGroups.rows.map(({ rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls }) =>
        ({ rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls })), [
        { rolname: 'ci_finance_migrator', rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: true },
        { rolname: 'ci_finance_owner', rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false },
        { rolname: 'ci_finance_runtime', rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false },
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

test('0006 rejects pre-existing runtime role graphs and ACL escalation before a restricted-login upgrade', async () => {
  assert.ok(process.env.CI_TEST_DB_HOST, 'role-upgrade audit requires the disposable PostgreSQL harness');
  const names = (await readdir(join(root, 'migrations'))).filter(name => name.endsWith('.sql')).sort();
  assert.equal(names.length, 6);
  const migrationName = names[5];
  const { name, base, config } = await createPre0006Database();
  const admin = new Client(config);
  await admin.connect();
  const runtimeLogin = runtimeDatabaseConfigFromEnvironment().user;
  const runtimeRole = quoteIdentifier(runtimeLogin);
  let financeRowsBefore;
  try {
    await installDisposableMarker(admin);
    await applyMigrationsThrough0005(admin, names);
    financeRowsBefore = await captureLegacyFinancialRows(admin);
  } catch (error) {
    await admin.end();
    await dropTestDatabase(name, base);
    throw error;
  }

  const scenarios = [];
  scenarios.push({
    label: 'direct migrator membership',
    prepare: () => admin.query('GRANT ci_finance_migrator TO ci_finance_runtime'),
    cleanup: () => admin.query('REVOKE ci_finance_migrator FROM ci_finance_runtime'),
  });
  scenarios.push({
    label: 'direct owner membership',
    prepare: () => admin.query('GRANT ci_finance_owner TO ci_finance_runtime'),
    cleanup: () => admin.query('REVOKE ci_finance_owner FROM ci_finance_runtime'),
  });
  const migrationBridge = `ci09_migrator_bridge_${randomUUID().replaceAll('-', '')}`;
  scenarios.push({
    label: 'transitive migrator membership',
    prepare: async () => {
      await admin.query(`CREATE ROLE ${quoteIdentifier(migrationBridge)} NOLOGIN`);
      await admin.query(`GRANT ci_finance_migrator TO ${quoteIdentifier(migrationBridge)}`);
      await admin.query(`GRANT ${quoteIdentifier(migrationBridge)} TO ci_finance_runtime`);
    },
    cleanup: async () => {
      await admin.query(`REVOKE ${quoteIdentifier(migrationBridge)} FROM ci_finance_runtime`);
      await admin.query(`REVOKE ci_finance_migrator FROM ${quoteIdentifier(migrationBridge)}`);
      await admin.query(`DROP ROLE ${quoteIdentifier(migrationBridge)}`);
    },
  });
  const elevatedBridge = `ci09_elevated_bridge_${randomUUID().replaceAll('-', '')}`;
  const elevatedRole = `ci09_bypass_${randomUUID().replaceAll('-', '')}`;
  scenarios.push({
    label: 'transitive elevated role membership',
    prepare: async () => {
      await admin.query(`CREATE ROLE ${quoteIdentifier(elevatedRole)} NOLOGIN BYPASSRLS`);
      await admin.query(`CREATE ROLE ${quoteIdentifier(elevatedBridge)} NOLOGIN`);
      await admin.query(`GRANT ${quoteIdentifier(elevatedRole)} TO ${quoteIdentifier(elevatedBridge)}`);
      await admin.query(`GRANT ${quoteIdentifier(elevatedBridge)} TO ci_finance_runtime`);
    },
    cleanup: async () => {
      await admin.query(`REVOKE ${quoteIdentifier(elevatedBridge)} FROM ci_finance_runtime`);
      await admin.query(`REVOKE ${quoteIdentifier(elevatedRole)} FROM ${quoteIdentifier(elevatedBridge)}`);
      await admin.query(`DROP ROLE ${quoteIdentifier(elevatedBridge)}`);
      await admin.query(`DROP ROLE ${quoteIdentifier(elevatedRole)}`);
    },
  });
  const adminOptionRole = `ci09_admin_option_${randomUUID().replaceAll('-', '')}`;
  scenarios.push({
    label: 'runtime group admin-option membership',
    prepare: async () => {
      await admin.query(`CREATE ROLE ${quoteIdentifier(adminOptionRole)} NOLOGIN`);
      await admin.query(`GRANT ${quoteIdentifier(adminOptionRole)} TO ci_finance_runtime WITH ADMIN OPTION`);
    },
    cleanup: async () => {
      await admin.query(`REVOKE ${quoteIdentifier(adminOptionRole)} FROM ci_finance_runtime`);
      await admin.query(`DROP ROLE ${quoteIdentifier(adminOptionRole)}`);
    },
  });
  scenarios.push({
    label: 'host runtime login admin option',
    prepare: () => admin.query(`GRANT ci_finance_runtime TO ${runtimeRole} WITH ADMIN OPTION`),
    cleanup: async () => {
      await admin.query(`REVOKE ci_finance_runtime FROM ${runtimeRole}`);
      await admin.query(`GRANT ci_finance_runtime TO ${runtimeRole}`);
    },
  });
  const settableAclRole = `ci09_settable_acl_${randomUUID().replaceAll('-', '')}`;
  scenarios.push({
    label: 'runtime login SET ROLE-only history DELETE grant',
    prepare: async () => {
      await admin.query(`CREATE ROLE ${quoteIdentifier(settableAclRole)} NOLOGIN`);
      await admin.query(`GRANT DELETE ON cost_intelligence.financial_ledger_events TO ${quoteIdentifier(settableAclRole)}`);
      await admin.query(`GRANT ${quoteIdentifier(settableAclRole)} TO ${runtimeRole} WITH INHERIT FALSE, SET TRUE`);
    },
    cleanup: async () => {
      await admin.query(`REVOKE ${quoteIdentifier(settableAclRole)} FROM ${runtimeRole}`);
      await admin.query(`REVOKE DELETE ON cost_intelligence.financial_ledger_events FROM ${quoteIdentifier(settableAclRole)}`);
      await admin.query(`DROP ROLE ${quoteIdentifier(settableAclRole)}`);
    },
  });
  const delegatedMembershipRole = `ci09_admin_path_${randomUUID().replaceAll('-', '')}`;
  scenarios.push({
    label: 'runtime login ADMIN OPTION on a separate membership',
    prepare: async () => {
      await admin.query(`CREATE ROLE ${quoteIdentifier(delegatedMembershipRole)} NOLOGIN`);
      await admin.query(`GRANT ${quoteIdentifier(delegatedMembershipRole)} TO ${runtimeRole} WITH ADMIN OPTION`);
    },
    cleanup: async () => {
      await admin.query(`REVOKE ${quoteIdentifier(delegatedMembershipRole)} FROM ${runtimeRole}`);
      await admin.query(`DROP ROLE ${quoteIdentifier(delegatedMembershipRole)}`);
    },
  });
  scenarios.push({
    label: 'host runtime login migrator membership',
    prepare: () => admin.query(`GRANT ci_finance_migrator TO ${runtimeRole}`),
    cleanup: () => admin.query(`REVOKE ci_finance_migrator FROM ${runtimeRole}`),
  });
  scenarios.push({
    label: 'direct schema CREATE grant',
    prepare: () => admin.query('GRANT CREATE ON SCHEMA cost_intelligence TO ci_finance_runtime'),
    cleanup: () => admin.query('REVOKE CREATE ON SCHEMA cost_intelligence FROM ci_finance_runtime'),
  });
  scenarios.push({
    label: 'runtime login database CREATE grant',
    prepare: () => admin.query(`GRANT CREATE ON DATABASE ${quoteIdentifier(name)} TO ${runtimeRole}`),
    cleanup: () => admin.query(`REVOKE CREATE ON DATABASE ${quoteIdentifier(name)} FROM ${runtimeRole}`),
  });
  scenarios.push({
    label: 'direct table UPDATE DELETE TRUNCATE grants',
    prepare: () => admin.query('GRANT UPDATE, DELETE, TRUNCATE ON cost_intelligence.financial_ledger_events TO ci_finance_runtime'),
    cleanup: () => admin.query('REVOKE ALL ON cost_intelligence.financial_ledger_events FROM ci_finance_runtime'),
  });
  scenarios.push({
    label: 'direct column UPDATE grant',
    prepare: () => admin.query('GRANT UPDATE (event_payload) ON cost_intelligence.financial_ledger_events TO ci_finance_runtime'),
    cleanup: () => admin.query('REVOKE UPDATE (event_payload) ON cost_intelligence.financial_ledger_events FROM ci_finance_runtime'),
  });
  const functionProbe = `ci09_privileged_probe_${randomUUID().replaceAll('-', '')}`;
  scenarios.push({
    label: 'direct privileged-function EXECUTE grant',
    prepare: async () => {
      await admin.query(`CREATE FUNCTION cost_intelligence.${quoteIdentifier(functionProbe)}() RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$`);
      await admin.query(`GRANT EXECUTE ON FUNCTION cost_intelligence.${quoteIdentifier(functionProbe)}() TO ci_finance_runtime`);
    },
    cleanup: async () => {
      await admin.query(`REVOKE EXECUTE ON FUNCTION cost_intelligence.${quoteIdentifier(functionProbe)}() FROM ci_finance_runtime`);
      await admin.query(`DROP FUNCTION cost_intelligence.${quoteIdentifier(functionProbe)}()`);
    },
  });
  const sequenceProbe = `ci09_sequence_probe_${randomUUID().replaceAll('-', '')}`;
  scenarios.push({
    label: 'direct sequence privilege grant',
    prepare: async () => {
      await admin.query(`CREATE SEQUENCE cost_intelligence.${quoteIdentifier(sequenceProbe)}`);
      await admin.query(`GRANT USAGE, SELECT, UPDATE ON SEQUENCE cost_intelligence.${quoteIdentifier(sequenceProbe)} TO ci_finance_runtime`);
    },
    cleanup: async () => {
      await admin.query(`REVOKE ALL ON SEQUENCE cost_intelligence.${quoteIdentifier(sequenceProbe)} FROM ci_finance_runtime`);
      await admin.query(`DROP SEQUENCE cost_intelligence.${quoteIdentifier(sequenceProbe)}`);
    },
  });
  scenarios.push({
    label: 'direct runtime-login history DELETE grant',
    prepare: () => admin.query(`GRANT DELETE ON cost_intelligence.financial_ledger_events TO ${runtimeRole}`),
    cleanup: () => admin.query(`REVOKE DELETE ON cost_intelligence.financial_ledger_events FROM ${runtimeRole}`),
  });
  const inheritedAclRole = `ci09_inherited_acl_${randomUUID().replaceAll('-', '')}`;
  scenarios.push({
    label: 'runtime-login inherited history DELETE grant',
    prepare: async () => {
      await admin.query(`CREATE ROLE ${quoteIdentifier(inheritedAclRole)} NOLOGIN`);
      await admin.query(`GRANT DELETE ON cost_intelligence.financial_ledger_events TO ${quoteIdentifier(inheritedAclRole)}`);
      await admin.query(`GRANT ${quoteIdentifier(inheritedAclRole)} TO ${runtimeRole}`);
    },
    cleanup: async () => {
      await admin.query(`REVOKE ${quoteIdentifier(inheritedAclRole)} FROM ${runtimeRole}`);
      await admin.query(`REVOKE DELETE ON cost_intelligence.financial_ledger_events FROM ${quoteIdentifier(inheritedAclRole)}`);
      await admin.query(`DROP ROLE ${quoteIdentifier(inheritedAclRole)}`);
    },
  });
  const eventOwnerBefore = await admin.query(
    `SELECT owner.rolname FROM pg_class relation
     JOIN pg_roles owner ON owner.oid = relation.relowner
     JOIN pg_namespace schema ON schema.oid = relation.relnamespace
     WHERE schema.nspname = 'cost_intelligence' AND relation.relname = 'financial_ledger_events'`,
  );
  assert.equal(eventOwnerBefore.rows.length, 1);
  const eventOwner = quoteIdentifier(eventOwnerBefore.rows[0].rolname);
  scenarios.push({
    label: 'runtime group owns immutable history',
    prepare: () => admin.query('ALTER TABLE cost_intelligence.financial_ledger_events OWNER TO ci_finance_runtime'),
    cleanup: () => admin.query(`ALTER TABLE cost_intelligence.financial_ledger_events OWNER TO ${eventOwner}`),
  });
  scenarios.push({
    label: 'host runtime login owns immutable history',
    prepare: () => admin.query(`ALTER TABLE cost_intelligence.financial_ledger_events OWNER TO ${runtimeRole}`),
    cleanup: () => admin.query(`ALTER TABLE cost_intelligence.financial_ledger_events OWNER TO ${eventOwner}`),
  });

  try {
    for (const scenario of scenarios) {
      try {
        await scenario.prepare();
        await assert0006RejectedBeforeRecord(admin, migrationName, scenario.label);
        assert.deepEqual(await captureLegacyFinancialRows(admin), financeRowsBefore,
          `${scenario.label}: a rejected security migration leaves immutable ledger and projection rows unchanged`);
      } finally {
        await scenario.cleanup();
      }
    }

    await apply0006ToLegacyDatabase(admin, migrationName);
    const runtimeConfig = { ...runtimeDatabaseConfigFromEnvironment(), database: name };
    const restricted = new Client(runtimeConfig);
    await restricted.connect();
    const runtimePool = new Pool({ ...runtimeConfig, max: 4 });
    try {
      const login = await restricted.query(
        `SELECT current_user, role.rolsuper, role.rolcreatedb, role.rolcreaterole, role.rolreplication, role.rolbypassrls,
                pg_has_role(current_user, 'ci_finance_runtime', 'MEMBER') AS is_runtime,
                pg_has_role(current_user, 'ci_finance_owner', 'MEMBER') AS is_owner,
                pg_has_role(current_user, 'ci_finance_migrator', 'MEMBER') AS is_migrator,
                has_database_privilege(current_user, current_database(), 'CREATE') AS database_can_create
         FROM pg_roles role WHERE role.rolname = current_user`,
      );
      assert.equal(login.rows.length, 1);
      assert.deepEqual(login.rows[0], {
        current_user: runtimeLogin, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
        rolreplication: false, rolbypassrls: false,
        is_runtime: true, is_owner: false, is_migrator: false, database_can_create: false,
      });
      for (const role of ['ci_finance_owner', 'ci_finance_migrator']) {
        await assert.rejects(restricted.query(`SET ROLE ${role}`), error => error.code === '42501',
          `the real runtime login cannot assume ${role}`);
      }
      await assert.rejects(restricted.query('CREATE TABLE cost_intelligence.ci09_runtime_ddl_probe (value integer)'),
        error => error.code === '42501');
      await assert.rejects(restricted.query('CREATE SCHEMA ci09_runtime_schema_probe'),
        error => error.code === '42501');
      await assert.rejects(restricted.query('ALTER TABLE cost_intelligence.financial_ledger_events DISABLE TRIGGER financial_ledger_events_append_only'),
        error => error.code === '42501');
      await assert.rejects(restricted.query('ALTER TABLE cost_intelligence.financial_ledger_events DISABLE ROW LEVEL SECURITY'),
        error => error.code === '42501');
      await assert.rejects(restricted.query('UPDATE cost_intelligence.financial_ledger_events SET amount = amount'),
        error => error.code === '42501');
      await assert.rejects(restricted.query('DELETE FROM cost_intelligence.financial_ledger_events'),
        error => error.code === '42501');
      await assert.rejects(restricted.query('TRUNCATE cost_intelligence.pricing_rate_card_versions'),
        error => error.code === '42501');
      await assert.rejects(restricted.query('SELECT * FROM cost_intelligence.schema_migrations'),
        error => error.code === '42501');
      await assert.rejects(restricted.query('SELECT cost_intelligence.audit_legacy_financial_privacy()'),
        error => error.code === '42501');
      await assert.rejects(restricted.query("SELECT cost_intelligence.financial_jsonb_has_sensitive_text('{}'::jsonb)"),
        error => error.code === '42501');

      const scope = legacyScope('actual-restricted-upgrade');
      const event = legacyRequest(scope, { amount: '0.37' });
      await appendLegacyEvent(runtimePool, event);
      const projection = await projectLegacyScope(runtimePool, scope);
      assert.equal(projection.ok, true, projection.ok ? '' : projection.error.safe_message);
      if (projection.ok) assert.ok(projection.value.amounts.some(item => item.totalAmount === '0.37'));
      await restricted.query('BEGIN');
      try {
        await bindRawFinanceScope(restricted, scope);
        const own = await restricted.query(
          'SELECT event_id FROM cost_intelligence.financial_ledger_events WHERE event_id = $1', [event.eventId],
        );
        assert.deepEqual(own.rows, [{ event_id: event.eventId }], 'restricted login reads an authorized scoped row');
        await bindRawFinanceScope(restricted, { ...scope, tenantId: `${scope.tenantId}-foreign` });
        const foreign = await restricted.query(
          'SELECT event_id FROM cost_intelligence.financial_ledger_events WHERE event_id = $1', [event.eventId],
        );
        assert.deepEqual(foreign.rows, [], 'restricted login cannot read a foreign tenant row by ID');
        await restricted.query('COMMIT');
      } catch (error) {
        await restricted.query('ROLLBACK').catch(() => {});
        throw error;
      }
    } finally {
      await runtimePool.end();
      await restricted.end();
    }
  } finally {
    await admin.end();
    await dropTestDatabase(name, base);
  }
});

test('legacy financial privacy upgrade preserves immutable economics and fails affected scopes closed', async () => {
  const names = (await readdir(join(root, 'migrations'))).filter(name => name.endsWith('.sql')).sort();
  assert.equal(names.length, 6);
  const { name, base, config } = await createPre0006Database();
  let admin;
  let seedPool;
  let runtimePool;
  let raceMigrator;
  try {
    admin = new Client(config);
    await admin.connect();
    await installDisposableMarker(admin);
    await applyMigrationsThrough0005(admin, names);
    // The current API includes the post-0006 gate. This disposable-only empty
    // shim lets it seed genuine 0001-0005 rows; it is dropped before upgrade.
    await admin.query(
      'CREATE TABLE cost_intelligence.financial_privacy_quarantine (' +
      'record_kind text, record_hash text, tenant_id text, project_id text, environment text, billing_mode text)',
    );
    seedPool = new Pool({ ...config, max: 12 });

    const cleanScope = legacyScope('clean-conservation');
    const known = legacyRequest(cleanScope, { amount: '0.75', usage: {
      completeness: 'complete', missingFields: [],
      units: [{ name: 'token', quantity: '10', scale: 0, relation: 'standalone' }],
    } });
    const unknown = legacyRequest(cleanScope, { amount: null, valuation: 'unknown' });
    const incomplete = legacyRequest(cleanScope, { amount: '0.05', usage: {
      completeness: 'incomplete', missingFields: ['tokens'],
      units: [{ name: 'token', quantity: null, scale: 0, relation: 'standalone' }],
    } });
    const sameScopeClean = legacyRequest(cleanScope, { amount: '0.25', usage: {
      completeness: 'complete', missingFields: [],
      units: [{ name: 'token', quantity: '2', scale: 0, relation: 'standalone' }],
    } });
    for (const request of [known, unknown, incomplete, sameScopeClean]) await appendLegacyEvent(seedPool, request);
    const cleanBeforeUpgrade = await projectLegacyScope(seedPool, cleanScope);
    assert.equal(cleanBeforeUpgrade.ok, true);
    const cleanUsd = cleanBeforeUpgrade.value.amounts.find(item => item.eventType === 'expense' && item.currency === 'USD');
    assert.deepEqual({
      eventCount: cleanUsd.eventCount, knownAmountCount: cleanUsd.knownAmountCount,
      unknownAmountCount: cleanUsd.unknownAmountCount, knownSubtotal: cleanUsd.knownSubtotal,
      totalAmount: cleanUsd.totalAmount, completeness: cleanUsd.completeness,
    }, {
      eventCount: 4, knownAmountCount: 3, unknownAmountCount: 1, knownSubtotal: '1.05',
      totalAmount: null, completeness: 'partial',
    }, 'the clean legacy scope retains known subtotal and unknown-amount completeness');
    const cleanToken = cleanBeforeUpgrade.value.quantities.find(item => item.eventType === 'expense' && item.currency === 'USD' && item.unitName === 'token');
    assert.deepEqual({
      observationCount: cleanToken.observationCount, knownQuantityCount: cleanToken.knownQuantityCount,
      unknownQuantityCount: cleanToken.unknownQuantityCount, incompleteObservationCount: cleanToken.incompleteObservationCount,
      knownSubtotal: cleanToken.knownSubtotal, totalQuantity: cleanToken.totalQuantity, completeness: cleanToken.completeness,
    }, {
      observationCount: 4, knownQuantityCount: 3, unknownQuantityCount: 1, incompleteObservationCount: 1,
      knownSubtotal: '13', totalQuantity: null, completeness: 'incomplete',
    }, 'the clean legacy scope retains incomplete quantity and token measure facts');

    const approvedMeasuresScope = legacyScope('approved-measure-conservation');
    const approvedInput = legacyRequest(approvedMeasuresScope, { usage: {
      completeness: 'incomplete', missingFields: ['output'],
      units: [{ name: 'input', quantity: '10', scale: 0, relation: 'standalone' }],
    } });
    const approvedCacheWrite = legacyRequest(approvedMeasuresScope, { usage: {
      completeness: 'complete', missingFields: [], units: [
        { name: 'input_tokens', quantity: '20', scale: 0, relation: 'standalone' },
        { name: 'cache_write_tokens', quantity: '4', scale: 0, relation: 'included_subset', includedIn: 'input_tokens' },
      ],
    } });
    const approvedAllUnknown = legacyRequest(approvedMeasuresScope, {
      amount: null, valuation: 'unknown', usage: { completeness: 'unknown', missingFields: ['all'], units: [] },
    });
    const approvedIdentityUnknown = legacyRequest(approvedMeasuresScope, {
      amount: null, valuation: 'unknown',
      usage: { completeness: 'unknown', missingFields: ['usage', 'providerAttemptId', 'billableAttemptId'], units: [] },
    });
    const approvedMeasureEvents = [approvedInput, approvedCacheWrite, approvedAllUnknown, approvedIdentityUnknown];
    for (const request of approvedMeasureEvents) await appendLegacyEvent(seedPool, request);
    const approvedMeasuresBefore = await projectLegacyScope(seedPool, approvedMeasuresScope);
    assert.equal(approvedMeasuresBefore.ok, true);
    if (approvedMeasuresBefore.ok) {
      assert.ok(approvedMeasuresBefore.value.quantities.some(item => item.unitName === 'input' && item.knownSubtotal === '10'));
      assert.ok(approvedMeasuresBefore.value.quantities.some(item => item.unitName === 'cache_write_tokens' && item.knownSubtotal === '4'));
      assert.equal(approvedMeasuresBefore.value.amounts.find(item => item.currency === 'USD').knownAmountCount, 2);
    }

    const cleanOtherCurrencyScope = legacyScope('clean-other-currency');
    await appendLegacyEvent(seedPool, legacyRequest(cleanOtherCurrencyScope, { amount: '3.00', currency: 'EUR' }));
    const cleanOtherCurrencyBefore = await projectLegacyScope(seedPool, cleanOtherCurrencyScope);
    assert.equal(cleanOtherCurrencyBefore.ok, true);
    assert.equal(cleanOtherCurrencyBefore.value.amounts[0].totalAmount, '3');
    const cleanOtherTenantScope = legacyScope('clean-other-tenant');
    await appendLegacyEvent(seedPool, legacyRequest(cleanOtherTenantScope, { amount: '7.00' }));
    const cleanOtherTenantBefore = await projectLegacyScope(seedPool, cleanOtherTenantScope);
    assert.equal(cleanOtherTenantBefore.ok, true);
    assert.equal(cleanOtherTenantBefore.value.amounts[0].totalAmount, '7');

    const affectedConservationScope = legacyScope('affected-mixed-completeness');
    const affectedKnown = legacyRequest(affectedConservationScope, { amount: '0.75', usage: {
      completeness: 'complete', missingFields: [],
      units: [{ name: 'token', quantity: '10', scale: 0, relation: 'standalone' }],
    } });
    const affectedUnknown = legacyRequest(affectedConservationScope, { amount: null, valuation: 'unknown' });
    const affectedIncomplete = legacyRequest(affectedConservationScope, { amount: '0.05', usage: {
      completeness: 'incomplete', missingFields: ['tokens'],
      units: [{ name: 'token', quantity: null, scale: 0, relation: 'standalone' }],
    } });
    const affectedClean = legacyRequest(affectedConservationScope, { amount: '0.25', usage: {
      completeness: 'complete', missingFields: [],
      units: [{ name: 'token', quantity: '2', scale: 0, relation: 'standalone' }],
    } });
    for (const request of [affectedKnown, affectedUnknown, affectedIncomplete, affectedClean]) {
      await appendLegacyEvent(seedPool, request);
    }
    const affectedCleanOracle = await projectLegacyScope(seedPool, affectedConservationScope);
    assert.equal(affectedCleanOracle.ok, true);
    const affectedSensitive = await contaminateLegacyEvent(admin, affectedClean.eventId, request => {
      request.sourceRefs = [{
        contract: 'ci09.legacy.source', schema_version: '1.0.0',
        id: 'https://private.invalid/mixed-completeness?token=' + legacyPrivacyMarker,
        revision: 1, content_hash: contentAddress({ confidential: true }),
      }];
    });
    const affectedBeforeUpgrade = await projectLegacyScope(seedPool, affectedConservationScope);
    assert.equal(affectedBeforeUpgrade.ok, true);
    assert.deepEqual(affectedBeforeUpgrade.value.amounts, affectedCleanOracle.value.amounts,
      'adding only private source metadata must preserve the complete known/unknown money oracle before audit');
    assert.deepEqual(affectedBeforeUpgrade.value.quantities, affectedCleanOracle.value.quantities,
      'adding only private source metadata must preserve the complete/incomplete quantity oracle before audit');
    const affectedConservation = {
      scope: affectedConservationScope, snapshotId: affectedBeforeUpgrade.value.snapshotId,
      sensitiveHash: affectedSensitive.eventHash, sensitiveRequest: affectedClean,
      safeAppend: legacyRequest(affectedConservationScope),
    };

    async function appendCorrectionPair(scope, label, contaminateAncestor) {
      const logicalOperationId = 'ci09-' + label + '-logical-operation-' + randomUUID();
      const sourceObjectId = 'ci09-' + label + '-source-object-' + randomUUID();
      const revisionSubjectId = 'ci09-' + label + '-source-line';
      const root = legacyRequest(scope, {
        eventType: 'expense', amount: '1.00', logicalOperationId, sourceObjectId, revisionSubjectId,
        revisionSequence: 0,
      });
      await appendLegacyEvent(seedPool, root);
      const correction = legacyRequest(scope, {
        eventType: 'correction', amount: '1.20', logicalOperationId, sourceObjectId, revisionSubjectId,
        revisionSequence: 1, supersedesEventId: root.eventId,
      });
      await appendLegacyEvent(seedPool, correction);
      const sensitive = contaminateAncestor ? root : correction;
      const contaminated = await contaminateLegacyEvent(admin, sensitive.eventId, request => {
        request.sourceRefs = [{
          contract: 'ci09.legacy.source', schema_version: '1.0.0',
          id: 'https://private.invalid/ledger/raw?token=' + legacyPrivacyMarker + '&prompt=source',
          revision: 1, content_hash: contentAddress({ confidential: true }),
        }];
      });
      const projection = await projectLegacyScope(seedPool, scope);
      assert.equal(projection.ok, true, 'the pre-0006 snapshot must use the source event hash containing its legacy metadata');
      const sensitiveHash = contaminated.eventHash;
      const nextCorrection = legacyRequest(scope, {
        eventType: 'correction', amount: '1.30', logicalOperationId, sourceObjectId, revisionSubjectId,
        revisionSequence: 2, supersedesEventId: correction.eventId,
      });
      return { scope, sensitiveHash, sensitiveRequest: sensitive, safeAppend: legacyRequest(scope),
        correctionRequest: nextCorrection };
    }

    const effectiveCorrectionScope = legacyScope('effective-correction-only');
    const effectiveCorrection = await appendCorrectionPair(effectiveCorrectionScope, 'effective-correction', false);
    const ancestorScope = legacyScope('ancestor-only');
    const ancestorCorrection = await appendCorrectionPair(ancestorScope, 'ancestor', true);

    const reversalScope = legacyScope('deep-mixed-reversal-only');
    const reversalOperation = 'ci09-deep-reversal-logical-' + randomUUID();
    const chargeObject = 'ci09-deep-charge-object-' + randomUUID();
    const chargeLine = 'ci09-deep-charge-line';
    const charge = legacyRequest(reversalScope, {
      eventType: 'charge', amount: '1.00', logicalOperationId: reversalOperation,
      sourceObjectId: chargeObject, revisionSubjectId: chargeLine, revisionSequence: 0,
    });
    await appendLegacyEvent(seedPool, charge);
    const chargeCorrection = legacyRequest(reversalScope, {
      eventType: 'correction', amount: '1.20', logicalOperationId: reversalOperation,
      sourceObjectId: chargeObject, revisionSubjectId: chargeLine, revisionSequence: 1,
      supersedesEventId: charge.eventId,
    });
    await appendLegacyEvent(seedPool, chargeCorrection);
    const reversalObject = 'ci09-deep-reversal-object-' + randomUUID();
    const reversalLine = 'ci09-deep-reversal-line';
    const partialReversal = legacyRequest(reversalScope, {
      eventType: 'reversal', amount: '-0.40', logicalOperationId: reversalOperation,
      sourceObjectId: reversalObject, revisionSubjectId: reversalLine, revisionSequence: 0,
      reversesEventId: chargeCorrection.eventId,
    });
    await appendLegacyEvent(seedPool, partialReversal);
    const correctedReversal = legacyRequest(reversalScope, {
      eventType: 'correction', amount: '-0.30', logicalOperationId: reversalOperation,
      sourceObjectId: reversalObject, revisionSubjectId: reversalLine, revisionSequence: 1,
      supersedesEventId: partialReversal.eventId,
    });
    await appendLegacyEvent(seedPool, correctedReversal);
    const reversalOfReversal = legacyRequest(reversalScope, {
      eventType: 'reversal', amount: '0.10', logicalOperationId: reversalOperation,
      sourceObjectId: 'ci09-deep-reversal-inverse-' + randomUUID(), revisionSubjectId: 'ci09-deep-inverse-line',
      revisionSequence: 0, reversesEventId: correctedReversal.eventId,
    });
    await appendLegacyEvent(seedPool, reversalOfReversal);
    const deepSensitive = await contaminateLegacyEvent(admin, reversalOfReversal.eventId, request => {
      request.sourceRefs = [{
        contract: 'ci09.legacy.source', schema_version: '1.0.0',
        id: 'https://private.invalid/reversal?token=' + legacyPrivacyMarker + '&address=192.0.2.44',
        revision: 1, content_hash: contentAddress({ confidential: true }),
      }];
    });
    const deepBeforeUpgrade = await projectLegacyScope(seedPool, reversalScope);
    assert.equal(deepBeforeUpgrade.ok, true,
      'the pre-0006 mixed-sign snapshot must use the sensitive reversal source hash');
    const deepCorrectionTotal = deepBeforeUpgrade.value.amounts.find(item => item.eventType === 'correction' && item.currency === 'USD');
    const deepReversalTotal = deepBeforeUpgrade.value.amounts.find(item => item.eventType === 'reversal' && item.currency === 'USD');
    assert.deepEqual({
      correctionEvents: deepCorrectionTotal.eventCount, correctionSubtotal: deepCorrectionTotal.knownSubtotal,
      reversalEvents: deepReversalTotal.eventCount, reversalSubtotal: deepReversalTotal.knownSubtotal,
    }, { correctionEvents: 2, correctionSubtotal: '0.9', reversalEvents: 1, reversalSubtotal: '0.1' },
    'the pre-upgrade mixed-sign correction/reversal chain retains its exact current economic oracle');
    const newReversal = legacyRequest(reversalScope, {
      eventType: 'reversal', amount: '-0.01', logicalOperationId: reversalOperation,
      sourceObjectId: 'ci09-denied-reversal-' + randomUUID(), revisionSubjectId: 'ci09-denied-reversal-line',
      revisionSequence: 0, reversesEventId: reversalOfReversal.eventId,
    });
    const deepAffected = {
      scope: reversalScope, sensitiveHash: deepSensitive.eventHash, sensitiveRequest: reversalOfReversal,
      safeAppend: legacyRequest(reversalScope), reversalRequest: newReversal,
    };

    const labelOnlyScope = legacyScope('snapshot-label-only');
    const labelOnlyRequest = legacyRequest(labelOnlyScope, { amount: '4.00' });
    await appendLegacyEvent(seedPool, labelOnlyRequest);
    const labelOnlyProjection = await projectLegacyScope(seedPool, labelOnlyScope);
    assert.equal(labelOnlyProjection.ok, true);
    const labelOnlySnapshot = await insertSnapshotWithSensitiveLabel(admin, labelOnlyScope, labelOnlyProjection.value);
    const labelAffected = {
      scope: labelOnlyScope, snapshotId: labelOnlySnapshot,
      sensitiveRequest: labelOnlyRequest, safeAppend: legacyRequest(labelOnlyScope),
    };

    const bothScope = legacyScope('event-and-snapshot-label');
    const bothRequest = legacyRequest(bothScope, { amount: '5.00' });
    await appendLegacyEvent(seedPool, bothRequest);
    const bothEvent = await contaminateLegacyEvent(admin, bothRequest.eventId, request => {
      request.dimensions.feature = 'prompt address canary ' + legacyPrivacyMarker;
    });
    const bothProjection = await projectLegacyScope(seedPool, bothScope);
    assert.equal(bothProjection.ok, true,
      'the pre-0006 source-event snapshot must reflect the event hash containing legacy metadata');
    const bothSnapshot = await insertSnapshotWithSensitiveLabel(admin, bothScope, bothProjection.value);
    const bothAffected = {
      scope: bothScope, snapshotId: bothSnapshot, sensitiveHash: bothEvent.eventHash,
      sensitiveRequest: bothRequest, safeAppend: legacyRequest(bothScope),
    };

    const reservationScope = legacyScope('reservation-lineage');
    const reservationId = 'ci09-legacy-reservation-' + randomUUID();
    const reservationOperation = 'ci09-legacy-reservation-operation-' + randomUUID();
    const reservationObject = 'ci09-legacy-reservation-source-' + randomUUID();
    const authorizationRequest = legacyRequest(reservationScope, {
      eventType: 'reservation_authorized', classification: 'reservation_memo', amount: '0.10',
      financialEffect: false, reservationLifecycle: 'held', logicalOperationId: reservationOperation,
      reservationId, sourceObjectId: reservationObject, revisionSubjectId: 'authorization-line',
    });
    await appendLegacyEvent(seedPool, authorizationRequest);
    const dispatchRequest = legacyRequest(reservationScope, {
      eventType: 'dispatch', classification: 'reservation_memo', amount: '0.10',
      financialEffect: false, reservationLifecycle: 'dispatched', logicalOperationId: reservationOperation,
      reservationId, reservationAuthorizationEventId: authorizationRequest.eventId,
      sourceObjectId: reservationObject, revisionSubjectId: 'dispatch-line',
    });
    await appendLegacyEvent(seedPool, dispatchRequest);
    const reservationSensitive = await contaminateLegacyEvent(admin, authorizationRequest.eventId, request => {
      request.sourceRefs = [{
        contract: 'ci09.legacy.authorization', schema_version: '1.0.0',
        id: 'https://private.invalid/authorization?token=' + legacyPrivacyMarker,
        revision: 1, content_hash: contentAddress({ confidential: true }),
      }];
    });
    const reservationBeforeUpgrade = await projectLegacyScope(seedPool, reservationScope);
    assert.equal(reservationBeforeUpgrade.ok, true,
      'the pre-0006 reservation snapshot must reflect the sensitive authorization event hash');
    const nextDispatch = legacyRequest(reservationScope, {
      eventType: 'dispatch', classification: 'reservation_memo', amount: '0.10',
      financialEffect: false, reservationLifecycle: 'dispatched', logicalOperationId: reservationOperation,
      reservationId, reservationAuthorizationEventId: authorizationRequest.eventId,
      sourceObjectId: reservationObject, revisionSubjectId: 'dispatch-retry-line',
    });
    const reservationAffected = {
      scope: reservationScope, sensitiveHash: reservationSensitive.eventHash,
      sensitiveRequest: authorizationRequest, safeAppend: legacyRequest(reservationScope),
      reservationRequest: nextDispatch,
    };

    const auditRaceScope = legacyScope('legacy-audit-race');
    const auditRaceRequest = legacyRequest(auditRaceScope, { amount: '0.44' });
    await appendLegacyEvent(seedPool, auditRaceRequest);

    const affectedEventHashes = [
      effectiveCorrection.sensitiveHash, ancestorCorrection.sensitiveHash, deepAffected.sensitiveHash,
      bothAffected.sensitiveHash, reservationAffected.sensitiveHash, affectedConservation.sensitiveHash,
    ];
    assert.ok(affectedEventHashes.every(value => typeof value === 'string'));

    const boundaryBase = legacyScope('scope-boundary-base');
    const boundaryScopes = [
      boundaryBase,
      { ...boundaryBase, tenantId: boundaryBase.tenantId + '-foreign-tenant' },
      { ...boundaryBase, projectId: boundaryBase.projectId + '-foreign-project' },
      { ...boundaryBase, environment: 'development' },
      { ...boundaryBase, billingMode: 'sandbox' },
    ];
    const boundaryEvents = [];
    for (const scope of boundaryScopes) {
      const request = legacyRequest(scope);
      await appendLegacyEvent(seedPool, request);
      boundaryEvents.push({ scope, eventId: request.eventId });
    }

    // Keep the legacy snapshots built before audit, as a prior deployed
    // handler could have produced them from these clean source facts.
    const beforeUpgradeRows = await captureLegacyFinancialRows(admin);
    await admin.query('DROP TABLE cost_intelligence.financial_privacy_quarantine');
    await apply0006ToLegacyDatabase(admin, names[5]);
    const migrationRow = await admin.query(
      'SELECT checksum_sha256 FROM cost_intelligence.schema_migrations WHERE version = $1',
      [names[5].replace(/\.sql$/, '')],
    );
    assert.equal(migrationRow.rows[0].checksum_sha256.trim(), createHash('sha256')
      .update(await readFile(join(root, 'migrations', names[5]), 'utf8')).digest('hex'));
    assert.deepEqual(await captureLegacyFinancialRows(admin), beforeUpgradeRows,
      'the additive migration must preserve all event, binding, head, mapping, snapshot, amount, and quantity row bytes');

    const migratorConfig = { ...migratorDatabaseConfigFromEnvironment(), database: name };
    const migrator = new Client(migratorConfig);
    await migrator.connect();
    let auditAfterFirstRun;
    let auditAfterSecondRun;
    try {
      const login = await migrator.query(
        'SELECT current_user, role.rolsuper, role.rolcreatedb, role.rolcreaterole, role.rolbypassrls ' +
        'FROM pg_roles role WHERE role.rolname = current_user',
      );
      assert.equal(login.rows.length, 1);
      assert.deepEqual(login.rows[0], {
        current_user: login.rows[0].current_user, rolsuper: false, rolcreatedb: false,
        rolcreaterole: false, rolbypassrls: false,
      });
      await migrator.query('SET ROLE ci_finance_migrator');
      assert.equal((await migrator.query('SELECT current_user')).rows[0].current_user, 'ci_finance_migrator');
      const ownership = await migrator.query(
        'SELECT pg_get_userbyid(p.proowner) AS audit_owner FROM pg_proc p ' +
        'JOIN pg_namespace n ON n.oid = p.pronamespace ' +
        'WHERE n.nspname = $1 AND p.proname = $2',
        ['cost_intelligence', 'audit_legacy_financial_privacy'],
      );
      assert.deepEqual(ownership.rows, [{ audit_owner: 'ci_finance_migrator' }]);
      await migrator.query('SELECT cost_intelligence.audit_legacy_financial_privacy()');
      auditAfterFirstRun = await admin.query(
        'SELECT record_kind, record_hash, tenant_id, project_id, environment, billing_mode, reason_code ' +
        'FROM cost_intelligence.financial_privacy_quarantine ORDER BY record_kind, record_hash',
      );
      await migrator.query('SELECT cost_intelligence.audit_legacy_financial_privacy()');
      auditAfterSecondRun = await admin.query(
        'SELECT record_kind, record_hash, tenant_id, project_id, environment, billing_mode, reason_code ' +
        'FROM cost_intelligence.financial_privacy_quarantine ORDER BY record_kind, record_hash',
      );
    } finally {
      await migrator.end();
    }
    assert.deepEqual(auditAfterSecondRun.rows, auditAfterFirstRun.rows,
      'repeated legacy audit must be idempotent and append no duplicate records');
    const expectedAudit = [
      { record_kind: 'ledger_event', record_hash: affectedConservation.sensitiveHash,
        tenant_id: affectedConservation.scope.tenantId, project_id: affectedConservation.scope.projectId,
        environment: affectedConservation.scope.environment, billing_mode: affectedConservation.scope.billingMode,
        reason_code: 'legacy_sensitive_event_data' },
      { record_kind: 'ledger_event', record_hash: effectiveCorrection.sensitiveHash,
        tenant_id: effectiveCorrection.scope.tenantId, project_id: effectiveCorrection.scope.projectId,
        environment: effectiveCorrection.scope.environment, billing_mode: effectiveCorrection.scope.billingMode,
        reason_code: 'legacy_sensitive_event_data' },
      { record_kind: 'ledger_event', record_hash: ancestorCorrection.sensitiveHash,
        tenant_id: ancestorCorrection.scope.tenantId, project_id: ancestorCorrection.scope.projectId,
        environment: ancestorCorrection.scope.environment, billing_mode: ancestorCorrection.scope.billingMode,
        reason_code: 'legacy_sensitive_event_data' },
      { record_kind: 'ledger_event', record_hash: deepAffected.sensitiveHash,
        tenant_id: deepAffected.scope.tenantId, project_id: deepAffected.scope.projectId,
        environment: deepAffected.scope.environment, billing_mode: deepAffected.scope.billingMode,
        reason_code: 'legacy_sensitive_event_data' },
      { record_kind: 'projection_snapshot', record_hash: labelAffected.snapshotId,
        tenant_id: labelAffected.scope.tenantId, project_id: labelAffected.scope.projectId,
        environment: labelAffected.scope.environment, billing_mode: labelAffected.scope.billingMode,
        reason_code: 'legacy_sensitive_projection_label' },
      { record_kind: 'ledger_event', record_hash: bothAffected.sensitiveHash,
        tenant_id: bothAffected.scope.tenantId, project_id: bothAffected.scope.projectId,
        environment: bothAffected.scope.environment, billing_mode: bothAffected.scope.billingMode,
        reason_code: 'legacy_sensitive_event_data' },
      { record_kind: 'projection_snapshot', record_hash: bothAffected.snapshotId,
        tenant_id: bothAffected.scope.tenantId, project_id: bothAffected.scope.projectId,
        environment: bothAffected.scope.environment, billing_mode: bothAffected.scope.billingMode,
        reason_code: 'legacy_sensitive_projection_label' },
      { record_kind: 'ledger_event', record_hash: reservationAffected.sensitiveHash,
        tenant_id: reservationAffected.scope.tenantId, project_id: reservationAffected.scope.projectId,
        environment: reservationAffected.scope.environment, billing_mode: reservationAffected.scope.billingMode,
        reason_code: 'legacy_sensitive_event_data' },
    ].sort((left, right) => left.record_kind.localeCompare(right.record_kind) || left.record_hash.localeCompare(right.record_hash));
    const cleanEventIds = [
      known.eventId, unknown.eventId, incomplete.eventId, sameScopeClean.eventId,
      affectedKnown.eventId, affectedUnknown.eventId, affectedIncomplete.eventId,
      ...approvedMeasureEvents.map(request => request.eventId),
    ];
    // Quarantine stores immutable content hashes, so resolve the event IDs to
    // their persisted hashes before running the no-false-positive assertion.
    const cleanEventHashes = await admin.query(
      'SELECT event_hash FROM cost_intelligence.financial_ledger_events WHERE event_id = ANY($1::text[]) ORDER BY event_id',
      [cleanEventIds],
    );
    const cleanHashes = cleanEventHashes.rows.map(row => row.event_hash);
    assert.equal(cleanHashes.length, cleanEventIds.length, 'every seeded clean event must contribute its stored immutable event_hash');
    assert.ok(cleanHashes.every(hash => /^sha256:[a-f0-9]{64}$/.test(hash)),
      'the clean-row quarantine guard compares content hashes, not event IDs');
    assert.deepEqual(auditAfterSecondRun.rows, expectedAudit,
      'audit must catch effective correction, ancestor, deep reversal, reservation authorization, label-only, and combined cases');
    assert.doesNotMatch(JSON.stringify(auditAfterSecondRun.rows), new RegExp(legacyPrivacyMarker));
    const cleanQuarantine = await admin.query(
      'SELECT record_hash FROM cost_intelligence.financial_privacy_quarantine WHERE record_hash = ANY($1::text[])',
      [cleanHashes],
    );
    assert.deepEqual(cleanQuarantine.rows, [],
      'reviewed unit token, tokenization values, incomplete markers, and clean same-scope facts are not false positives');
    const boundaryQuarantine = await admin.query(
      'SELECT tenant_id, project_id, environment, billing_mode FROM cost_intelligence.financial_privacy_quarantine ' +
      'WHERE tenant_id = ANY($1::text[]) OR project_id = ANY($2::text[])',
      [boundaryScopes.map(scope => scope.tenantId), boundaryScopes.map(scope => scope.projectId)],
    );
    assert.deepEqual(boundaryQuarantine.rows, [], 'clean facts at every scope boundary stay unquarantined');

    const runtimeConfig = { ...runtimeDatabaseConfigFromEnvironment(), database: name };
    runtimePool = new Pool({ ...runtimeConfig, max: 10 });
    const runtimePorts = legacyPorts(runtimePool);
    const cleanAfterUpgrade = await projectLegacyScope(runtimePool, cleanScope);
    assert.equal(cleanAfterUpgrade.ok, true);
    assert.deepEqual(cleanAfterUpgrade.value, cleanBeforeUpgrade.value,
      'a clean same-scope as-of replay after upgrade retains the exact pre-upgrade amount, quantity, evidence, and hash');
    const approvedMeasuresAfter = await projectLegacyScope(runtimePool, approvedMeasuresScope);
    assert.equal(approvedMeasuresAfter.ok, true);
    assert.deepEqual(approvedMeasuresAfter.value, approvedMeasuresBefore.value,
      'approved input, cache-write, and unknown-field observations retain exact pre-upgrade projection identity');
    const approvedSnapshotQuarantine = await admin.query(
      'SELECT record_hash FROM cost_intelligence.financial_privacy_quarantine WHERE record_kind = $1 AND record_hash = $2',
      ['projection_snapshot', approvedMeasuresBefore.value.snapshotId],
    );
    assert.deepEqual(approvedSnapshotQuarantine.rows, [],
      'reviewed cache_write_tokens projection labels are not quarantined during upgrade');
    const otherCurrencyAfter = await projectLegacyScope(runtimePool, cleanOtherCurrencyScope);
    assert.equal(otherCurrencyAfter.ok, true);
    assert.deepEqual(otherCurrencyAfter.value, cleanOtherCurrencyBefore.value);
    const otherTenantAfter = await projectLegacyScope(runtimePool, cleanOtherTenantScope);
    assert.equal(otherTenantAfter.ok, true);
    assert.deepEqual(otherTenantAfter.value, cleanOtherTenantBefore.value);
    assert.doesNotMatch(JSON.stringify([
      cleanAfterUpgrade, otherCurrencyAfter, otherTenantAfter,
    ]), new RegExp(legacyPrivacyMarker));

    const raceContamination = await contaminateLegacyEvent(admin, auditRaceRequest.eventId, request => {
      request.sourceRefs = [{
        contract: 'ci09.legacy.audit-race', schema_version: '1.0.0',
        id: 'https://private.invalid/audit-race?token=' + legacyPrivacyMarker,
        revision: 1, content_hash: contentAddress({ confidential: true }),
      }];
    });
    const auditRaceProjection = await projectLegacyScope(runtimePool, auditRaceScope);
    assert.equal(auditRaceProjection.ok, true,
      'a controlled pre-audit import retains its exact source hash in the existing snapshot');
    const raceRowsBeforeAudit = await captureLegacyFinancialRows(admin);
    const raceLockKey = 'ci02-ledger:' + auditRaceScope.tenantId + ':' + auditRaceScope.projectId + ':' +
      auditRaceScope.environment + ':' + auditRaceScope.billingMode;
    raceMigrator = new Client({ ...migratorDatabaseConfigFromEnvironment(), database: name });
    await raceMigrator.connect();
    await raceMigrator.query('SET ROLE ci_finance_migrator');
    await raceMigrator.query('BEGIN');
    await raceMigrator.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [raceLockKey],
    );
    let raceCompleted = false;
    const racingProjection = rebuildLedgerProjection({
      schemaVersion: '1.0.0', requestId: 'ci09-audit-race-projection',
      scope: auditRaceScope, asOf: legacyFixtureAsOf,
    }, runtimePorts).then(result => {
      raceCompleted = true;
      return result;
    });
    await new Promise(resolve => setTimeout(resolve, 75));
    assert.equal(raceCompleted, false, 'projection must wait for an in-flight scope privacy audit');
    await raceMigrator.query('SELECT cost_intelligence.audit_legacy_financial_privacy()');
    await raceMigrator.query('COMMIT');
    const raceResult = await racingProjection;
    assertLegacyUnavailable(raceResult, 'projection concurrent with a newly detected legacy marker');
    assert.deepEqual(await captureLegacyFinancialRows(admin), raceRowsBeforeAudit,
      'the audit/replay race cannot create a replacement snapshot or mutate source history');
    const raceQuarantine = await admin.query(
      'SELECT record_kind, record_hash FROM cost_intelligence.financial_privacy_quarantine WHERE record_hash = $1',
      [raceContamination.eventHash],
    );
    assert.deepEqual(raceQuarantine.rows, [{ record_kind: 'ledger_event', record_hash: raceContamination.eventHash }]);
    await raceMigrator.end();
    raceMigrator = undefined;
    const auditRaceAffected = {
      scope: auditRaceScope, sensitiveHash: raceContamination.eventHash,
      sensitiveRequest: auditRaceRequest, safeAppend: legacyRequest(auditRaceScope),
    };

    const rowsBeforeDeniedCalls = await captureLegacyFinancialRows(admin);
    const privacyBeforeDeniedCalls = await admin.query(
      'SELECT record_kind, record_hash, tenant_id, project_id, environment, billing_mode, reason_code ' +
      'FROM cost_intelligence.financial_privacy_quarantine ORDER BY record_kind, record_hash',
    );
    const affected = [
      { ...affectedConservation, label: 'mixed known, unknown, and incomplete economics' },
      { ...effectiveCorrection, label: 'effective correction' },
      { ...ancestorCorrection, label: 'correction ancestor' },
      { ...deepAffected, label: 'deep reversal' },
      { ...labelAffected, label: 'snapshot label' },
      { ...bothAffected, label: 'event and snapshot' },
      { ...reservationAffected, label: 'reservation authorization' },
      { ...auditRaceAffected, label: 'concurrent audit and replay' },
    ];
    const asOfVariants = [
      '2026-10-11T04:00:00Z', '2026-10-11T04:00:00.0Z',
      '2026-10-11T04:00:00.000000Z',
    ];
    for (const item of affected) {
      const projectionRequest = {
        schemaVersion: '1.0.0', requestId: 'ci09-repeat-' + item.label.replaceAll(' ', '-') + '-' + randomUUID(),
        scope: item.scope, asOf: asOfVariants[0],
      };
      assertLegacyUnavailable(await rebuildLedgerProjection(projectionRequest, runtimePorts), item.label + ' as-of replay');
      assertLegacyUnavailable(await rebuildLedgerProjection(projectionRequest, runtimePorts), item.label + ' repeated as-of replay');
      for (const asOf of asOfVariants.slice(1)) {
        assertLegacyUnavailable(await rebuildLedgerProjection({
          ...projectionRequest, requestId: projectionRequest.requestId + '-' + asOf.slice(-2), asOf,
        }, runtimePorts), item.label + ' equivalent as-of spelling');
      }
    }
    const reconnectPool = new Pool({ ...runtimeConfig, max: 4 });
    try {
      assertLegacyUnavailable(await projectLegacyScope(reconnectPool, effectiveCorrection.scope),
        'reconnected affected-scope replay');
    } finally {
      await reconnectPool.end();
    }
    const concurrentResults = await Promise.all(Array.from({ length: 8 }, (_, index) => rebuildLedgerProjection({
      schemaVersion: '1.0.0', requestId: 'ci09-concurrent-replay-' + index, scope: deepAffected.scope,
      asOf: asOfVariants[index % asOfVariants.length],
    }, runtimePorts)));
    concurrentResults.forEach((result, index) => assertLegacyUnavailable(result, 'concurrent replay ' + index));

    for (const item of affected) {
      if (item.sensitiveRequest) {
        assertLegacyUnavailable(await appendLedgerEvent(item.sensitiveRequest, runtimePorts), item.label + ' exact idempotent retry');
      }
      assertLegacyUnavailable(await appendLedgerEvent(item.safeAppend, runtimePorts), item.label + ' safe append');
      if (item.correctionRequest) {
        assertLegacyUnavailable(await appendLedgerEvent(item.correctionRequest, runtimePorts), item.label + ' correction and source-head mutation');
      }
      if (item.reversalRequest) {
        assertLegacyUnavailable(await appendLedgerEvent(item.reversalRequest, runtimePorts), item.label + ' reversal lineage mutation');
      }
      if (item.reservationRequest) {
        assertLegacyUnavailable(await appendLedgerEvent(item.reservationRequest, runtimePorts), item.label + ' reservation authorization lookup');
      }
      if (item === affected[0]) {
        const unsupported = { ...legacyRequest(item.scope), schemaVersion: '9.9.9' };
        assertLegacyUnavailable(await appendLedgerEvent(unsupported, runtimePorts),
          'unsupported-payload quarantine in an affected scope');
      }
    }
    assert.deepEqual(await captureLegacyFinancialRows(admin), rowsBeforeDeniedCalls,
      'all unavailable retries, corrections, reversals, reservation lookups, and concurrent rebuilds must leave immutable rows unchanged');
    const privacyAfterDeniedCalls = await admin.query(
      'SELECT record_kind, record_hash, tenant_id, project_id, environment, billing_mode, reason_code ' +
      'FROM cost_intelligence.financial_privacy_quarantine ORDER BY record_kind, record_hash',
    );
    assert.deepEqual(privacyAfterDeniedCalls.rows, privacyBeforeDeniedCalls.rows);

    const single = await runtimePool.connect();
    try {
      await single.query('BEGIN');
      await bindRawFinanceScope(single, effectiveCorrection.scope);
      const hiddenSensitiveEvent = await single.query(
        'SELECT event_payload::text FROM cost_intelligence.financial_ledger_events WHERE event_id = $1',
        [effectiveCorrection.sensitiveRequest.eventId],
      );
      assert.equal(hiddenSensitiveEvent.rows.length, 0);
      assert.doesNotMatch(JSON.stringify(hiddenSensitiveEvent.rows), new RegExp(legacyPrivacyMarker));
      await bindRawFinanceScope(single, affectedConservation.scope);
      const hiddenAffectedHistory = await single.query(
        'SELECT event_id FROM cost_intelligence.financial_ledger_events ' +
        'WHERE event_id = ANY($1::text[]) ORDER BY event_id',
        [[affectedKnown.eventId, affectedUnknown.eventId, affectedIncomplete.eventId, affectedClean.eventId]],
      );
      assert.deepEqual(hiddenAffectedHistory.rows, [],
        'one quarantined source event hides all same-scope source rows from the restricted runtime role');
      const hiddenAffectedSnapshots = await single.query(
        'SELECT snapshot_id FROM cost_intelligence.financial_projection_snapshots ' +
        'WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4',
        [affectedConservation.scope.tenantId, affectedConservation.scope.projectId,
          affectedConservation.scope.environment, affectedConservation.scope.billingMode],
      );
      assert.deepEqual(hiddenAffectedSnapshots.rows, [],
        'source-event quarantine hides preexisting aggregate snapshots for the entire affected scope');
      await bindRawFinanceScope(single, labelAffected.scope);
      const hiddenSensitiveSnapshot = await single.query(
        'SELECT snapshot_id FROM cost_intelligence.financial_projection_snapshots WHERE snapshot_id = $1',
        [labelAffected.snapshotId],
      );
      assert.equal(hiddenSensitiveSnapshot.rows.length, 0);
      await single.query('COMMIT');
    } finally {
      single.release();
    }

    const boundaryIds = boundaryEvents.map(item => item.eventId);
    const boundaryClient = await runtimePool.connect();
    try {
      await boundaryClient.query('BEGIN');
      await bindRawFinanceScope(boundaryClient, boundaryBase);
      const ownRows = await boundaryClient.query(
        'SELECT event_id FROM cost_intelligence.financial_ledger_events WHERE event_id = ANY($1::text[]) ORDER BY event_id',
        [boundaryIds],
      );
      assert.deepEqual(ownRows.rows.map(row => row.event_id), [boundaryEvents[0].eventId]);
      const foreignHeadUpdate = await boundaryClient.query(
        'UPDATE cost_intelligence.financial_source_revision_heads SET current_revision_sequence = 1 ' +
        'WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4',
        [boundaryScopes[1].tenantId, boundaryScopes[1].projectId, boundaryScopes[1].environment, boundaryScopes[1].billingMode],
      );
      assert.equal(foreignHeadUpdate.rowCount, 0, 'a bound tenant cannot update another tenant source head');
      await boundaryClient.query('COMMIT');

      await boundaryClient.query('BEGIN');
      await boundaryClient.query(
        "SELECT set_config('cost_intelligence.tenant_id', $1, true)",
        [boundaryBase.tenantId],
      );
      const partialRows = await boundaryClient.query(
        'SELECT event_id FROM cost_intelligence.financial_ledger_events WHERE event_id = ANY($1::text[])',
        [boundaryIds],
      );
      assert.equal(partialRows.rows.length, 0, 'partial context denies all scoped rows');
      await boundaryClient.query('COMMIT');
      const unboundRows = await boundaryClient.query(
        'SELECT event_id FROM cost_intelligence.financial_ledger_events WHERE event_id = ANY($1::text[])',
        [boundaryIds],
      );
      assert.equal(unboundRows.rows.length, 0, 'transaction-local scope does not leak after commit');

      for (const foreign of boundaryScopes.slice(1)) {
        await boundaryClient.query('BEGIN');
        await bindRawFinanceScope(boundaryClient, boundaryBase);
        await assert.rejects(boundaryClient.query(
          'INSERT INTO cost_intelligence.financial_source_revision_heads ' +
          '(tenant_id, project_id, environment, billing_mode, source_name, source_object_id, source_revision_subject_id, ' +
          'current_revision_sequence, current_event_id) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)',
          [foreign.tenantId, foreign.projectId, foreign.environment, foreign.billingMode,
            'ci09-denied-boundary', 'ci09-denied-object-' + randomUUID(), 'ci09-denied-line'],
        ), error => error.code === '42501');
        await boundaryClient.query('ROLLBACK');
      }

      await boundaryClient.query('BEGIN');
      await bindRawFinanceScope(boundaryClient, boundaryBase);
      await boundaryClient.query('SELECT 1 / 0').catch(() => {});
      await boundaryClient.query('ROLLBACK');
      await boundaryClient.query('BEGIN');
      await bindRawFinanceScope(boundaryClient, boundaryScopes[2]);
      const afterRollbackRows = await boundaryClient.query(
        'SELECT event_id FROM cost_intelligence.financial_ledger_events WHERE event_id = ANY($1::text[]) ORDER BY event_id',
        [boundaryIds],
      );
      assert.deepEqual(afterRollbackRows.rows.map(row => row.event_id), [boundaryEvents[2].eventId],
        'a failed request rollback cannot leak the prior tenant and project context');
      await boundaryClient.query('COMMIT');

      await boundaryClient.query('BEGIN');
      await bindRawFinanceScope(boundaryClient, boundaryBase);
      const beforeRebind = await boundaryClient.query(
        'SELECT event_id FROM cost_intelligence.financial_ledger_events WHERE event_id = ANY($1::text[])',
        [boundaryIds],
      );
      assert.deepEqual(beforeRebind.rows.map(row => row.event_id), [boundaryEvents[0].eventId]);
      await bindRawFinanceScope(boundaryClient, boundaryScopes[1]);
      const afterTrustedRebind = await boundaryClient.query(
        'SELECT event_id FROM cost_intelligence.financial_ledger_events WHERE event_id = ANY($1::text[])',
        [boundaryIds],
      );
      assert.deepEqual(afterTrustedRebind.rows.map(row => row.event_id), [boundaryEvents[1].eventId],
        'the trusted backend SQL credential can explicitly rebind transaction-local scope');
      await boundaryClient.query('COMMIT');
    } finally {
      boundaryClient.release();
    }

    const concurrentScopeReads = await Promise.all([boundaryScopes[0], boundaryScopes[3]].map(async (scope, index) => {
      const connection = await runtimePool.connect();
      try {
        await connection.query('BEGIN');
        await bindRawFinanceScope(connection, scope);
        await connection.query('SELECT pg_sleep(0.05)');
        const result = await connection.query(
          'SELECT event_id FROM cost_intelligence.financial_ledger_events WHERE event_id = ANY($1::text[])',
          [boundaryIds],
        );
        await connection.query('COMMIT');
        return result.rows.map(row => row.event_id);
      } finally {
        connection.release();
      }
    }));
    assert.deepEqual(concurrentScopeReads, [[boundaryEvents[0].eventId], [boundaryEvents[3].eventId]],
      'concurrent pooled requests remain isolated across environment scope');

    const deniedScope = boundaryScopes[1];
    let connectionAttempts = 0;
    const deniedPorts = {
      ...runtimePorts,
      database: { connect: async () => { connectionAttempts++; return runtimePool.connect(); } },
      financeAuthority: { authorizeCurrent: async request => ({
        status: 'denied', decisionId: 'ci09-synthetic-scope-boundary-denial',
        operation: request.operation, permission: request.permission,
      }) },
    };
    const foreignApiRequest = legacyRequest(deniedScope);
    const foreignAppend = await appendLedgerEvent(foreignApiRequest, deniedPorts);
    assert.equal(foreignAppend.ok, false);
    if (!foreignAppend.ok) assert.equal(foreignAppend.error.code, 'FORBIDDEN_SCOPE');
    assert.equal(connectionAttempts, 0, 'foreign API scope is denied before database connection or row lookup');

    const runtime = new Client(runtimeConfig);
    await runtime.connect();
    try {
      const role = await runtime.query(
        'SELECT current_user, role.rolsuper, role.rolcreatedb, role.rolcreaterole, role.rolbypassrls, ' +
        "pg_has_role(current_user, 'ci_finance_owner', 'MEMBER') AS is_owner " +
        'FROM pg_roles role WHERE role.rolname = current_user',
      );
      assert.equal(role.rows.length, 1);
      assert.deepEqual({
        superuser: role.rows[0].rolsuper, createdb: role.rows[0].rolcreatedb,
        createrole: role.rows[0].rolcreaterole, bypassrls: role.rows[0].rolbypassrls, owner: role.rows[0].is_owner,
      }, { superuser: false, createdb: false, createrole: false, bypassrls: false, owner: false });
      for (const statement of [
        'CREATE TABLE cost_intelligence.ci09_runtime_ddl_denied (value integer)',
        'UPDATE cost_intelligence.financial_ledger_events SET amount = amount',
        'DELETE FROM cost_intelligence.financial_ledger_events',
        'TRUNCATE cost_intelligence.financial_projection_snapshots',
        'ALTER TABLE cost_intelligence.financial_ledger_events DISABLE TRIGGER ALL',
        'ALTER TABLE cost_intelligence.financial_ledger_events DISABLE ROW LEVEL SECURITY',
        'SELECT cost_intelligence.audit_legacy_financial_privacy()',
        'SET ROLE ci_finance_owner',
        'SET ROLE ci_finance_migrator',
      ]) {
        await assert.rejects(runtime.query(statement), error => error.code === '42501');
      }
    } finally {
      await runtime.end();
    }

    const safeWriteScope = legacyScope('clean-write-and-validation');
    const safeRequest = legacyRequest(safeWriteScope, { amount: '0.31' });
    const accepted = await appendLedgerEvent(safeRequest, runtimePorts);
    assert.equal(accepted.ok, true);
    if (accepted.ok) assert.equal(accepted.value.status, 'accepted');
    assert.doesNotMatch(JSON.stringify(accepted), new RegExp(legacyPrivacyMarker));
    const duplicate = await appendLedgerEvent(safeRequest, runtimePorts);
    assert.equal(duplicate.ok, true);
    if (duplicate.ok) assert.equal(duplicate.value.status, 'duplicate');
    const unsafeLink = legacyRequest(safeWriteScope, {
      sourceRefs: [{
        contract: 'ci09.legacy.source', schema_version: '1.0.0',
        id: 'https://private.invalid/ledger?token=' + legacyPrivacyMarker,
        revision: 1, content_hash: contentAddress({ confidential: true }),
      }],
    });
    const unsafeLinkResult = await appendLedgerEvent(unsafeLink, runtimePorts);
    assert.equal(unsafeLinkResult.ok, false);
    if (!unsafeLinkResult.ok) assert.equal(unsafeLinkResult.error.code, 'VALIDATION_ERROR');
    assert.doesNotMatch(JSON.stringify(unsafeLinkResult), new RegExp(legacyPrivacyMarker));
    const unsafeLabel = legacyRequest(safeWriteScope);
    unsafeLabel.usage.units[0].name = 'prompt address ' + legacyPrivacyMarker;
    const unsafeLabelResult = await appendLedgerEvent(unsafeLabel, runtimePorts);
    assert.equal(unsafeLabelResult.ok, false);
    if (!unsafeLabelResult.ok) assert.equal(unsafeLabelResult.error.code, 'VALIDATION_ERROR');
    assert.doesNotMatch(JSON.stringify(unsafeLabelResult), new RegExp(legacyPrivacyMarker));
    const safeWriteRows = await admin.query(
      'SELECT event_id FROM cost_intelligence.financial_ledger_events WHERE event_id = ANY($1::text[])',
      [[safeRequest.eventId, unsafeLink.eventId, unsafeLabel.eventId]],
    );
    assert.deepEqual(safeWriteRows.rows.map(row => row.event_id), [safeRequest.eventId],
      'safe reviewed facts persist, duplicates remain idempotent, and unsafe evidence or measure labels are rejected before persistence');
  } finally {
    await raceMigrator?.end().catch(() => {});
    await runtimePool?.end();
    await seedPool?.end();
    await admin?.end();
    await dropTestDatabase(name, base);
  }
});
