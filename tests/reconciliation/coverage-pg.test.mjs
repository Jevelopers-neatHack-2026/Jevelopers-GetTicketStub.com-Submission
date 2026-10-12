// Real disposable PostgreSQL only; all imported/provider/authority facts are explicitly synthetic.
// No skip or in-memory fallback: use scripts/with-postgres.mjs reconciliation --offline --suite=coverage-postgres.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import * as api from '@jevelopers/cost-intelligence/reconciliation';
import { assertDisposableMarker, databaseConfigFromEnvironment, runtimeDatabaseConfigFromEnvironment } from '../../scripts/test-db-lifecycle.mjs';
import { checked, clone, harness, hash, partition, readRequest, record, reference, refused, request, scope } from './coverage-fixtures.mjs';

const table = 'cost_intelligence.reconciliation_coverage_runs';
const imports = 'cost_intelligence.reconciliation_coverage_imports';
const uniqueScope = () => scope({ tenantId: randomUUID(), projectId: randomUUID() });
const values = s => [s.tenantId, s.projectId, s.environment, s.billingMode];
const gate = s => `ci02-ledger:${s.tenantId}:${s.projectId}:${s.environment}:${s.billingMode}`;
const bind = (client, s) => client.query("SELECT set_config('cost_intelligence.tenant_id',$1,true),set_config('cost_intelligence.project_id',$2,true),set_config('cost_intelligence.environment',$3,true),set_config('cost_intelligence.billing_mode',$4,true)", values(s));
const runtimeConfig = () => ({ ...runtimeDatabaseConfigFromEnvironment(), max: 8, connectionTimeoutMillis: 5_000, query_timeout: 8_000 });
const postgresPort = pool => ({ async connect() {
  const client = await pool.connect();
  return { query: client.query.bind(client), release: () => client.release(), discard: () => client.release(true) };
} });

await test('CI-07 real PostgreSQL coverage persistence, recovery and protected reads', async t => {
  const admin = new pg.Pool({ ...databaseConfigFromEnvironment(), max: 2, connectionTimeoutMillis: 5_000, query_timeout: 8_000 });
  let runtime = new pg.Pool(runtimeConfig());
  try {
    assertDisposableMarker((await admin.query('SELECT marker FROM ci_test.disposable_database_marker')).rows);
    const financialBefore = (await admin.query('SELECT (SELECT count(*)::text FROM cost_intelligence.financial_ledger_events) AS ledger,(SELECT count(*)::text FROM cost_intelligence.budget_reservation_events) AS reservations')).rows[0];
    function host(records, s, database = postgresPort(runtime)) {
      const h = harness(records, s); h.ports.coverageStore = api.createPostgresCoverageRunStore(database); return h;
    }
    const count = async (name, s) => Number((await admin.query(`SELECT count(*)::text AS count FROM ${name} WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4`, values(s))).rows[0].count);
    const seedImport = async (s, ref, content) => admin.query(`INSERT INTO ${imports}(tenant_id,project_id,environment,billing_mode,source_id,import_id,revision,content_hash,record_content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [...values(s), ref.sourceId, ref.importId, ref.revision, ref.contentHash, JSON.stringify(content)]);
    const quarantine = async (client, s) => client.query("INSERT INTO cost_intelligence.financial_privacy_quarantine(tenant_id,project_id,environment,billing_mode,record_kind,record_hash,reason_code) VALUES($1,$2,$3,$4,'ledger_event',$5,'legacy_sensitive_event_data')", [...values(s), hash({ syntheticQuarantine: s.tenantId })]);

    await t.test('restricted runtime sees exact installed feature health without changing foundation readiness', async () => {
      const health = await runtime.query('SELECT migrations_ready FROM cost_intelligence.reconciliation_coverage_health'); assert.equal(health.rows[0].migrations_ready, true);
      const roles = await runtime.query("SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'ci_finance_runtime','MEMBER') AS member FROM pg_roles WHERE rolname=current_user");
      assert.equal(roles.rows[0].rolsuper, false); assert.equal(roles.rows[0].rolbypassrls, false); assert.equal(roles.rows[0].member, true);
    });

    let retained;
    await t.test('concurrent identical starts commit exactly one run and one immutable import', async () => {
      const s = uniqueScope(); const fixture = record({ scope: partition(s) }); const { ports } = host([fixture], s); const q = request([fixture], { scope: s });
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => checked(api.startCoverageDryRun({ ...q, requestId: 'transport-' + i }, ports))));
      assert.equal(new Set(results.map(result => JSON.stringify(result))).size, 1); assert.equal(await count(table, s), 1); assert.equal(await count(imports, s), 1);
      retained = { s, fixture, q, summary: results[0] };
    });

    await t.test('new pool and store recover the original committed run after all old connections close', async () => {
      await runtime.end(); runtime = new pg.Pool(runtimeConfig());
      const { s, fixture, q, summary } = retained; const { ports, state } = host([fixture], s); state.now = '2026-10-12T15:30:00.000Z'; state.revision = 'synthetic-new-lease';
      const replay = await checked(api.startCoverageDryRun({ ...q, requestId: 'restarted-host' }, ports)); assert.deepEqual(clone(replay), clone(summary));
      const page = await checked(api.getCoverageDryRun(readRequest(summary, { scope: s }), ports)); assert.equal(page.coverage[0].reference.contentHash, reference(fixture).contentHash);
    });

    await t.test('changed run facts conflict; changed normalized facts under the same import identity also conflict', async () => {
      const { s, fixture, q } = retained; const changed = { ...fixture, retrievedAt: '2026-10-12T15:02:00.000Z' }; const { ports } = host([changed], s);
      assert.equal(changed.sourceArtifactHash, fixture.sourceArtifactHash);
      await refused(api.startCoverageDryRun(request([changed], { scope: s, idempotencyKey: q.idempotencyKey }), ports), 'IDEMPOTENCY_CONFLICT');
      await refused(api.startCoverageDryRun(request([changed], { scope: s, idempotencyKey: 'different-run-key' }), ports), 'IDEMPOTENCY_CONFLICT');
      assert.equal(await count(table, s), 1); assert.equal(await count(imports, s), 1);
    });

    await t.test('explicit new import revision preserves prior run and stays review-only', async () => {
      const { s, fixture, summary } = retained; const revision = record({ ...fixture, revision: 2, predecessorHash: reference(fixture).contentHash, recordCount: 3 });
      const { ports } = host([revision], s); const next = await checked(api.startCoverageDryRun(request([revision], { scope: s, idempotencyKey: 'revision-run' }), ports));
      const page = await checked(api.getCoverageDryRun(readRequest(next, { scope: s }), ports)); assert.ok(page.coverage[0].gaps.includes('revision_requires_review'));
      assert.equal((await checked(api.getCoverageDryRun(readRequest(summary, { scope: s }), ports))).coverage[0].record.revision, 1);
      assert.equal(await count(table, s), 2); assert.equal(await count(imports, s), 2);
    });

    await t.test('lost COMMIT acknowledgement is retryable and replays one durable run without duplicate imports', async () => {
      const s = uniqueScope(); const fixture = record({ scope: partition(s) }); let loseAck = true; let discards = 0;
      const database = { connect: async () => { const client = await runtime.connect(); return { release: () => client.release(), discard: () => { discards++; client.release(true); }, query: async (...args) => {
        const result = await client.query(...args); if (args[0] === 'COMMIT' && loseAck) { loseAck = false; throw new Error('SYNTHETIC_LOST_ACK_PRIVATE'); } return result;
      } }; } };
      const { ports } = host([fixture], s, database); const q = request([fixture], { scope: s });
      const first = await refused(api.startCoverageDryRun(q, ports), 'SOURCE_UNAVAILABLE'); assert.equal(first.error.retryable, true); assert.equal(JSON.stringify(first).includes('SYNTHETIC_LOST_ACK_PRIVATE'), false);
      assert.equal(discards, 1, 'uncertain commit acknowledgement physically evicts its session');
      await checked(api.startCoverageDryRun({ ...q, requestId: 'retry-after-lost-ack' }, ports)); assert.equal(await count(table, s), 1); assert.equal(await count(imports, s), 1);
    });

    await t.test('revocation after an import insert rolls back both new import and run', async () => {
      const s = uniqueScope(); const fixture = record({ scope: partition(s) }); let state;
      const database = { connect: async () => { const client = await runtime.connect(); return { release: () => client.release(), discard: () => client.release(true), query: async (...args) => {
        const result = await client.query(...args); if (args[0].startsWith('INSERT INTO cost_intelligence.reconciliation_coverage_imports')) state.denied = true; return result;
      } }; } };
      const h = host([fixture], s, database); state = h.state;
      await refused(api.startCoverageDryRun(request([fixture], { scope: s }), h.ports), 'FORBIDDEN_SCOPE'); assert.equal(await count(table, s), 0); assert.equal(await count(imports, s), 0);
    });

    for (const synchronous of [false, true]) {
      await t.test(`failed ${synchronous ? 'synchronous' : 'asynchronous'} rollback evicts the physical session and preserves the original denial`, async () => {
        const isolated = new pg.Pool({ ...runtimeConfig(), max: 1 });
        const s = uniqueScope(); const fixture = record({ scope: partition(s) });
        let state; let failedPid; let releases = 0; let discards = 0;
        const database = { async connect() {
          const client = await isolated.connect(); failedPid = client.processID;
          return {
            release() { releases++; client.release(); },
            discard() { discards++; client.release(true); },
            query(sql, parameters) {
              if (sql === 'ROLLBACK') {
                state.denied = false;
                const error = new Error('SYNTHETIC_PRIVATE_ROLLBACK_FAILURE');
                if (synchronous) throw error;
                return Promise.reject(error);
              }
              return client.query(sql, parameters).then(result => {
                if (sql.startsWith('INSERT INTO cost_intelligence.reconciliation_coverage_imports')) state.denied = true;
                return result;
              });
            },
          };
        } };
        try {
          const h = host([fixture], s, database); state = h.state;
          const q = request([fixture], { scope: s });
          const result = await refused(api.startCoverageDryRun(q, h.ports), 'FORBIDDEN_SCOPE');
          assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_ROLLBACK_FAILURE'), false);
          assert.equal(releases, 0); assert.equal(discards, 1);
          const fresh = await isolated.connect();
          try { assert.notEqual(fresh.processID, failedPid, 'the failed transaction is not reused by the single-connection pool'); }
          finally { fresh.release(); }
          assert.equal(await count(table, s), 0); assert.equal(await count(imports, s), 0);
          const recovered = host([fixture], s, postgresPort(isolated));
          await checked(api.startCoverageDryRun(q, recovered.ports));
          assert.equal(await count(table, s), 1); assert.equal(await count(imports, s), 1);
        } finally { await isolated.end(); }
      });
    }

    await t.test('stalled current authority after the shared lock times out, rolls back, and cannot resume late writes', async () => {
      const s = uniqueScope(); const fixture = record({ scope: partition(s) }); let stall = false; let late; let releases = 0; const statements = [];
      const database = { connect: async () => { const client = await runtime.connect(); return { release: () => { releases++; client.release(); }, discard: () => client.release(true), query: async (...args) => {
        statements.push(args[0]); const result = await client.query(...args); if (args[0].includes('pg_advisory_xact_lock')) stall = true; return result;
      } }; } };
      const { ports } = host([fixture], s, database); const originalAuthority = ports.financeAuthority.authorizeCurrent;
      ports.financeAuthority.authorizeCurrent = async command => { const decision = await originalAuthority(command); return stall ? new Promise(resolve => { late = () => resolve(decision); }) : decision; };
      const result = await refused(api.startCoverageDryRun(request([fixture], { scope: s }), ports), 'SOURCE_UNAVAILABLE'); assert.equal(result.error.retryable, true);
      assert.equal(releases, 1); assert.ok(statements.includes('ROLLBACK')); assert.equal(statements.some(sql => sql.startsWith('INSERT ') || sql === 'COMMIT'), false);
      const before = statements.length; late(); await new Promise(resolve => setImmediate(resolve)); assert.equal(statements.length, before);
      assert.equal(await count(table, s), 0); assert.equal(await count(imports, s), 0);
    });

    await t.test('malformed stored import and hash/index binding cannot be reused under a new run key', async () => {
      for (const fault of ['malformed', 'foreign-scope', 'changed-record', 'wrong-index']) {
        const s = uniqueScope(); const fixture = record({ scope: partition(s) }); const ref = reference(fixture);
        const content = fault === 'malformed' ? { invalid: 'synthetic' } : fault === 'foreign-scope' ? { ...fixture, scope: partition(uniqueScope()) }
          : fault === 'changed-record' ? { ...fixture, recordCount: 99 } : { ...fixture, sourceId: 'other-indexed-source' };
        await seedImport(s, ref, content); const { ports } = host([fixture], s);
        await refused(api.startCoverageDryRun(request([fixture], { scope: s }), ports), 'SOURCE_UNAVAILABLE'); assert.equal(await count(table, s), 0);
      }
    });

    await t.test('indexed run hash and identity columns must agree with validated immutable JSON', async () => {
      for (const changedColumn of ['input_hash', 'idempotency_key']) {
        const s = uniqueScope(); const fixture = record({ scope: partition(s) }); const model = harness([fixture], s); const q = request([fixture], { scope: s });
        const summary = await checked(api.startCoverageDryRun(q, model.ports)); const run = model.state.latestRun;
        await admin.query(`INSERT INTO ${table}(tenant_id,project_id,environment,billing_mode,run_id,idempotency_key,input_hash,run_content) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [...values(s), summary.runId, changedColumn === 'idempotency_key' ? 'different-indexed-key' : run.idempotencyKey, changedColumn === 'input_hash' ? hash('wrong-indexed-hash') : summary.inputHash, JSON.stringify(run)]);
        const { ports } = host([fixture], s); await refused(api.getCoverageDryRun(readRequest(summary, { scope: s }), ports), 'SOURCE_UNAVAILABLE');
      }
    });

    await t.test('forced RLS isolates every tenant/project/environment/billing partition and mutation privileges remain absent', async () => {
      const { s, summary } = retained;
      for (const change of [{ tenantId: randomUUID() }, { projectId: randomUUID() }, { environment: 'development' }, { billingMode: 'sandbox' }]) {
        const foreign = { ...s, ...change }; const { ports } = host([], foreign);
        await refused(api.getCoverageDryRun(readRequest(summary, { scope: foreign }), ports), 'SOURCE_UNAVAILABLE');
        const client = await runtime.connect(); try { await client.query('BEGIN'); await bind(client, foreign); assert.equal((await client.query(`SELECT run_id FROM ${table} WHERE run_id=$1`, [summary.runId])).rows.length, 0); } finally { await client.query('ROLLBACK'); client.release(); }
      }
      for (const sql of [`UPDATE ${table} SET input_hash=input_hash`, `DELETE FROM ${table}`, `TRUNCATE ${table}`, `UPDATE ${imports} SET content_hash=content_hash`, `DELETE FROM ${imports}`, `TRUNCATE ${imports}`]) await assert.rejects(runtime.query(sql), { code: '42501' });
      const privileged = host([retained.fixture], s, postgresPort(admin)); await refused(api.getCoverageDryRun(readRequest(summary, { scope: s }), privileged.ports), 'SOURCE_UNAVAILABLE');
    });

    await t.test('controlled audit lock precedes replay/read and a newly quarantined scope discloses no evidence', async () => {
      for (const operation of ['read', 'replay']) {
        const s = uniqueScope(); const fixture = record({ scope: partition(s) }); const h = host([fixture], s); const q = request([fixture], { scope: s }); const summary = await checked(api.startCoverageDryRun(q, h.ports));
        const locker = await admin.connect(); let signal; const lockRequested = new Promise(resolve => { signal = resolve; });
        const database = { connect: async () => { const client = await runtime.connect(); return { release: () => client.release(), discard: () => client.release(true), query: async (...args) => {
          if (args[0].includes('pg_advisory_xact_lock')) signal(); return client.query(...args);
        } }; } };
        h.ports.coverageStore = api.createPostgresCoverageRunStore(database);
        try {
          await locker.query('BEGIN'); await locker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [gate(s)]);
          const pending = operation === 'read' ? api.getCoverageDryRun(readRequest(summary, { scope: s }), h.ports) : api.startCoverageDryRun(q, h.ports);
          await lockRequested; await quarantine(locker, s); await locker.query('COMMIT');
          await refused(pending, 'SOURCE_UNAVAILABLE');
        } finally { await locker.query('ROLLBACK'); locker.release(); }
      }
    });

    await t.test('bounded lock timeout rolls back and returns a safe retryable refusal', async () => {
      const s = uniqueScope(); const fixture = record({ scope: partition(s) }); const { ports } = host([fixture], s); const locker = await admin.connect();
      try {
        await locker.query('BEGIN'); await locker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [gate(s)]);
        const started = Date.now(); const result = await refused(api.startCoverageDryRun(request([fixture], { scope: s }), ports), 'SOURCE_UNAVAILABLE');
        assert.equal(result.error.retryable, true); assert.ok(Date.now() - started < 10_000, 'database lock wait must be bounded'); assert.equal(await count(table, s), 0);
      } finally { await locker.query('ROLLBACK'); locker.release(); }
    });

    await t.test('disabled RLS, append-only guards, modified policy/constraint and missing table fail dedicated health', async () => {
      const { s, fixture, summary } = retained; const { ports } = host([fixture], s);
      const alterations = [
        [`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`, `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`],
        [`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`, `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`],
        [`ALTER TABLE ${imports} DISABLE TRIGGER reconciliation_coverage_imports_append_only`, `ALTER TABLE ${imports} ENABLE TRIGGER reconciliation_coverage_imports_append_only`],
        [`ALTER TABLE ${table} DISABLE TRIGGER reconciliation_coverage_runs_no_truncate`, `ALTER TABLE ${table} ENABLE TRIGGER reconciliation_coverage_runs_no_truncate`],
      ];
      for (const [weaken, restore] of alterations) {
        try { await admin.query(weaken); assert.equal((await admin.query('SELECT migrations_ready FROM cost_intelligence.reconciliation_coverage_health')).rows[0].migrations_ready, false); await refused(api.getCoverageDryRun(readRequest(summary, { scope: s }), ports), 'SOURCE_UNAVAILABLE'); }
        finally { await admin.query(restore); }
      }
      const client = await admin.connect();
      try {
        // Transaction rollback restores every exact definition and fixture after controlled corruption.
        for (const mutation of [`DROP TABLE ${imports}`, `ALTER TABLE ${imports} DROP CONSTRAINT reconciliation_coverage_imports_pkey`, `ALTER POLICY reconciliation_coverage_runs_scope_policy ON ${table} USING (true) WITH CHECK (true)`]) {
          await client.query('BEGIN'); await client.query(mutation); assert.equal((await client.query('SELECT migrations_ready FROM cost_intelligence.reconciliation_coverage_health')).rows[0].migrations_ready, false); await client.query('ROLLBACK');
        }
      } finally { await client.query('ROLLBACK'); client.release(); }
      assert.equal((await admin.query('SELECT migrations_ready FROM cost_intelligence.reconciliation_coverage_health')).rows[0].migrations_ready, true);
    });

    await t.test('coverage tests cause no ledger postings, reservation settlement or hold release', async () => {
      const after = (await admin.query('SELECT (SELECT count(*)::text FROM cost_intelligence.financial_ledger_events) AS ledger,(SELECT count(*)::text FROM cost_intelligence.budget_reservation_events) AS reservations')).rows[0]; assert.deepEqual(after, financialBefore);
    });
  } finally { await Promise.allSettled([runtime.end(), admin.end()]); }
});
