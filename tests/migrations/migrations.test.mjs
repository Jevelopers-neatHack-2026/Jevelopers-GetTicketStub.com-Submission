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
  return /(?:^|;)\s*(?:DROP|TRUNCATE)\b/im.test(sql);
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
  assert.equal(hasDestructiveMigrationStatement('  DROP\n TABLE schema.table;'), true,
    'indented multiline DROP statements remain forbidden');
  assert.equal(hasDestructiveMigrationStatement(';\nTRUNCATE\n TABLE schema.table;'), true,
    'multiline TRUNCATE statements remain forbidden');
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
