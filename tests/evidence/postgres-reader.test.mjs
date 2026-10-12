// Actual disposable PostgreSQL only. Financial rows/host grants remain synthetic.
// No skip or model fallback: npm run test:evidence:postgres -- --offline.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { appendLedgerEvent, createPostgresEvidenceReader } from '../../dist/index.js';
import { assertDisposableMarker, databaseConfigFromEnvironment, runtimeDatabaseConfigFromEnvironment } from '../../scripts/test-db-lifecycle.mjs';
import { clock, now, decision, uniqueScope, partition, postingRequest, reverseRequest, ledgerRequest, ledgerPorts, checked, refused, hash } from './postgres-fixtures.mjs';

const table = 'cost_intelligence.financial_ledger_events';
const gate = s => `ci02-ledger:${s.tenantId}:${s.projectId}:${s.environment}:${s.billingMode}`;
const bind = (client, s) => client.query("SELECT set_config('cost_intelligence.tenant_id',$1,true),set_config('cost_intelligence.project_id',$2,true),set_config('cost_intelligence.environment',$3,true),set_config('cost_intelligence.billing_mode',$4,true)", partition(s));
const poolConfig = () => ({ ...runtimeDatabaseConfigFromEnvironment(), max: 4, connectionTimeoutMillis: 5_000, query_timeout: 8_000 });
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

await test('CI-10.2 real PostgreSQL evidence reader qualification', async t => {
  const admin = new pg.Pool({ ...databaseConfigFromEnvironment(), max: 4, connectionTimeoutMillis: 5_000, query_timeout: 8_000 });
  let runtime = new pg.Pool(poolConfig());
  try {
    assertDisposableMarker((await admin.query('SELECT marker FROM ci_test.disposable_database_marker')).rows);
    const coreHealth = (await admin.query('SELECT * FROM cost_intelligence.foundation_health')).rows[0];
    const originalChecksums = (await admin.query("SELECT version,checksum_sha256 FROM cost_intelligence.schema_migrations WHERE version < '0014' ORDER BY version")).rows;
    async function seed(s, options = {}) {
      const request = ledgerRequest(s, options);
      await checked(appendLedgerEvent(request, ledgerPorts(runtime, s)));
      return request;
    }
    const quarantine = (client, s) => client.query("INSERT INTO cost_intelligence.financial_privacy_quarantine(tenant_id,project_id,environment,billing_mode,record_kind,record_hash,reason_code) VALUES($1,$2,$3,$4,'ledger_event',$5,'legacy_sensitive_event_data')", [...partition(s), hash(`ci10-synthetic-quarantine-${s.tenantId}`)]);
    function reader(s, hooks = {}, pool = runtime) {
      const state = { statements: [], dataReads: 0, calls: [], discards: 0, releases: 0, committed: false, denied: false, revision: 'ci10-grant-1' };
      const database = { async connect() {
        const raw = await pool.connect(); state.pid = raw.processID;
        return {
          release() { state.releases++; raw.release(); },
          discard() { state.discards++; state.discardForwarded = true; raw.release(true); },
          async query(sql, parameters = []) {
            state.statements.push(sql);
            await hooks.beforeQuery?.(sql, parameters, state, raw);
            const result = await raw.query(sql, parameters);
            if (sql.startsWith('SELECT e.tenant_id')) state.dataReads++;
            if (sql === 'COMMIT') state.committed = true;
            await hooks.afterQuery?.(sql, parameters, state, raw, result);
            return result;
          },
        };
      } };
      const financeAuthority = { async authorizeCurrent(input) {
        state.calls.push({ committed: state.committed, dataReads: state.dataReads });
        if (hooks.authority) return hooks.authority(input, state);
        if (state.denied || JSON.stringify(input.requestedScope) !== JSON.stringify(s)) return { status: 'denied', operation: input.operation, permission: input.permission };
        return decision(input, state.revision);
      } };
      return { reader: createPostgresEvidenceReader({ database, clock: hooks.clock ?? clock, financeAuthority }), state };
    }

    await t.test('feature capability is healthy under restricted runtime without replacing core health', async () => {
      assert.equal((await runtime.query('SELECT migrations_ready FROM cost_intelligence.evidence_reader_health')).rows[0].migrations_ready, true);
      assert.deepEqual((await admin.query('SELECT * FROM cost_intelligence.foundation_health')).rows[0], coreHealth);
      assert.equal((await admin.query("SELECT count(*)::integer AS n FROM pg_indexes WHERE schemaname='cost_intelligence' AND indexname LIKE 'financial_evidence_%'")).rows[0].n, 8);
    });

    const retainedScope = uniqueScope();
    const posting = await seed(retainedScope);
    const observation = await seed(retainedScope, { eventType: 'usage_observation', logicalOperationId: posting.identities.logicalOperationId });
    let original;
    await t.test('public append-to-lookup joins only stored usage rows and preserves exact refs with no financial writes', async () => {
      const before = (await admin.query(`SELECT count(*)::text AS events,sum(amount)::text AS amount FROM ${table} WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4`, partition(retainedScope))).rows[0];
      original = await checked(reader(retainedScope).reader.lookupPostingEvidence(postingRequest(retainedScope, posting.eventId)));
      assert.equal(original.posting.eventId, posting.eventId);
      assert.deepEqual(original.sourceObservations.map(item => item.eventId), [observation.eventId]);
      assert.equal(original.rateRule.rateCardRef.revision, 0);
      assert.equal(original.billingAuthority, false);
      for (const gap of ['reconciliation_lineage_not_linked', 'adjustment_lineage_not_linked', 'export_lineage_not_linked']) assert.ok(original.gaps.includes(gap));
      assert.equal(/event_payload|"amount"|"sourceIdentity"/.test(JSON.stringify(original)), false);
      assert.deepEqual((await admin.query(`SELECT count(*)::text AS events,sum(amount)::text AS amount FROM ${table} WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4`, partition(retainedScope))).rows[0], before);
    });

    await t.test('new pool and reader reproduce durable stored references after prior connections close', async () => {
      await runtime.end(); runtime = new pg.Pool(poolConfig());
      const recovered = await checked(reader(retainedScope).reader.lookupPostingEvidence(postingRequest(retainedScope, posting.eventId)));
      assert.deepEqual(recovered, original);
    });

    await t.test('native reverse keys query stored identities and provider namespace; absent links remain explicit', async () => {
      const native = [
        ['logical_operation', posting.identities.logicalOperationId], ['source_observation', posting.identities.sourceObservationId],
        ['transport_attempt', posting.postingMapping.transportAttemptId.id], ['billable_attempt', posting.postingMapping.billableAttemptId.id],
        ['provider_attempt', posting.postingMapping.providerAttemptId.id],
        ['correlation', posting.correlationId], ['workflow', posting.dimensions.workflowId], ['job', posting.dimensions.jobId],
      ];
      for (const [kind, id] of native) {
        const result = await checked(reader(retainedScope).reader.lookupByOperationalReference(reverseRequest(kind, id, 'cost-intelligence', retainedScope)));
        assert.ok(result.matches.some(item => item.eventId === posting.eventId), kind);
      }
      const id = posting.postingMapping.providerRequestId.id;
      assert.equal((await checked(reader(retainedScope).reader.lookupByOperationalReference(reverseRequest('provider_request', id, 'provider:openai', retainedScope)))).matches.length, 1);
      assert.equal((await checked(reader(retainedScope).reader.lookupByOperationalReference(reverseRequest('provider_request', id, 'provider:other', retainedScope)))).matches.length, 0);
      for (const kind of ['provider_attempt', 'reservation']) {
        const result = await checked(reader(retainedScope).reader.lookupByOperationalReference(reverseRequest(kind, 'absent-reference', 'cost-intelligence', retainedScope)));
        assert.equal(result.matches.length, 0);
        assert.ok(result.gaps.includes('no_match_is_not_proof_of_zero_usage'));
      }
      await refused(reader(retainedScope).reader.lookupByOperationalReference(reverseRequest('workflow', posting.dimensions.workflowId, 'neatlogs', retainedScope)));
    });

    await t.test('RLS and explicit predicates isolate all four scope dimensions for posting and reverse reads', async () => {
      for (const change of [{ tenantId: `foreign-${randomUUID()}` }, { projectId: `foreign-${randomUUID()}` }, { environment: 'development' }, { billingMode: 'sandbox' }]) {
        const s = { ...retainedScope, ...change };
        assert.equal((await checked(reader(s).reader.lookupPostingEvidence(postingRequest(s, posting.eventId)))).status, 'not_found');
        assert.equal((await checked(reader(s).reader.lookupByOperationalReference(reverseRequest('logical_operation', posting.identities.logicalOperationId, 'cost-intelligence', s)))).matches.length, 0);
        const client = await runtime.connect();
        try { await client.query('BEGIN READ ONLY'); await bind(client, s); assert.equal((await client.query(`SELECT event_id FROM ${table} WHERE event_id=$1`, [posting.eventId])).rows.length, 0); }
        finally { await client.query('ROLLBACK'); client.release(); }
      }
      const privileged = reader(retainedScope, {}, admin);
      await refused(privileged.reader.lookupPostingEvidence(postingRequest(retainedScope, posting.eventId)));
      assert.equal(privileged.state.dataReads, 0);
    });

    await t.test('scope-indexed reverse lookup returns deterministic fifty-row bound and an honest truncation gap', async () => {
      const s = uniqueScope(); const operation = `operation-${randomUUID()}`;
      const ids = [];
      for (let i = 0; i < 51; i++) ids.push((await seed(s, { eventId: `ci10-bound-${String(i).padStart(2, '0')}-${randomUUID()}`, logicalOperationId: operation })).eventId);
      const result = await checked(reader(s).reader.lookupByOperationalReference(reverseRequest('logical_operation', operation, 'cost-intelligence', s)));
      assert.deepEqual(result.matches.map(item => item.eventId), ids.toSorted().slice(0, 50));
      assert.ok(result.gaps.includes('result_limit_reached'));
      assert.equal(result.billingAuthority, false);
    });

    await t.test('a real related-read SQL error cannot expose an earlier posting and evicts the aborted session', async () => {
      const h = reader(retainedScope, { async beforeQuery(sql, _parameters, state, raw) {
        if (sql.startsWith('SELECT e.tenant_id') && state.dataReads === 1) await raw.query('SELECT 1/0');
      } });
      await refused(h.reader.lookupPostingEvidence(postingRequest(retainedScope, posting.eventId)));
      assert.equal(h.state.dataReads, 1); assert.equal(h.state.committed, false);
      assert.ok(h.state.statements.includes('ROLLBACK'));
      assert.equal(h.state.discards, 1); assert.equal(h.state.discardForwarded, true); assert.equal(h.state.releases, 0);
    });

    await t.test('seeded malformed persisted JSON is refused without stringification or revision rounding', async () => {
      const s = uniqueScope(); const seedRequest = await seed(s);
      const cases = [
        { dimensions: JSON.stringify({ ...seedRequest.dimensions, provider: 123 }) },
        { dimensions: JSON.stringify({ ...seedRequest.dimensions, workflowId: true }) },
        { pricing: JSON.stringify({ ...seedRequest.pricing, policyVersion: 4 }) },
        { pricing: JSON.stringify({ ...seedRequest.pricing, rateCardRef: { ...seedRequest.pricing.rateCardRef, revision: '1' } }) },
        { pricing: JSON.stringify(seedRequest.pricing).replace('"revision":0', '"revision":9007199254740991.1') },
      ];
      for (const bad of cases) {
        const id = `ci10-corrupt-${randomUUID()}`;
        const patch = `{${Object.entries(bad).map(([key, value]) => `${JSON.stringify(key)}:${value}`).join(',')}}`;
        // Explicit privileged corruption fixture, not a valid append receipt.
        // Existing unrelated source/amount payload stays synthetic and is never read by the adapter.
        // Raw JSONB parameters preserve exact fractional decimal text without JS rounding.
        await admin.query(`INSERT INTO ${table} SELECT (jsonb_populate_record(NULL::${table},to_jsonb(e)||jsonb_build_object(
          'event_id',$2::text,'economic_root_event_id',$2::text,'source_observation_id',$2::text,
          'idempotency_key',$2::text,'source_event_id',$2::text)||$3::jsonb)).* FROM ${table} e WHERE event_id=$1`,
        [seedRequest.eventId, id, patch]);
        await refused(reader(s).reader.lookupPostingEvidence(postingRequest(s, id)));
      }
    });

    await t.test('known quarantine denies posting and not-found paths before any ledger read', async () => {
      const s = uniqueScope(); const event = await seed(s);
      const writer = await admin.connect();
      try { await writer.query('BEGIN'); await writer.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [gate(s)]); await quarantine(writer, s); await writer.query('COMMIT'); }
      finally { writer.release(); }
      for (const id of [event.eventId, 'absent-event']) {
        const h = reader(s); await refused(h.reader.lookupPostingEvidence(postingRequest(s, id))); assert.equal(h.state.dataReads, 0);
      }
    });

    await t.test('controlled audit stays behind the gate during the final authority wait; no authorization follows COMMIT', async () => {
      const s = uniqueScope(); const event = await seed(s);
      let pause; const paused = new Promise(resolve => { pause = resolve; }); let resume;
      let afterReads = 0;
      const h = reader(s, { async authority(input, state) {
        if (state.dataReads === 2 && ++afterReads === 3) { pause(); await new Promise(resolve => { resume = resolve; }); }
        return decision(input);
      } });
      const pending = h.reader.lookupPostingEvidence(postingRequest(s, event.eventId));
      await Promise.race([paused, pending.then(() => { throw new Error('Lookup completed before the final authority barrier.'); })]);
      const writer = await admin.connect();
      try {
        await writer.query('BEGIN');
        assert.equal((await writer.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [gate(s)])).rows[0].locked, false);
        let entered = false;
        const audit = (async () => { await writer.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [gate(s)]); entered = true; await quarantine(writer, s); await writer.query('COMMIT'); })();
        await nextTurn(); assert.equal(entered, false);
        resume();
        assert.equal((await checked(pending)).posting.eventId, event.eventId);
        await audit;
        assert.equal(h.state.calls.some(call => call.committed), false);
        await refused(reader(s).reader.lookupPostingEvidence(postingRequest(s, event.eventId)));
      } finally { resume?.(); try { await writer.query('ROLLBACK'); } catch { /* cleanup */ } writer.release(); }
    });

    await t.test('table locks protect attested RLS policies across a paused authority renewal', async () => {
      const s = uniqueScope(); const event = await seed(s); let pause; const paused = new Promise(resolve => { pause = resolve; }); let resume; let once = false;
      const h = reader(s, { async authority(input, state) {
        if (!once && state.statements.some(sql => sql.includes('evidence_reader_health'))) { once = true; pause(); await new Promise(resolve => { resume = resolve; }); }
        return decision(input);
      } });
      const pending = h.reader.lookupPostingEvidence(postingRequest(s, event.eventId));
      await Promise.race([paused, pending.then(() => { throw new Error('Lookup completed before the policy capability barrier.'); })]);
      const ddl = await admin.connect();
      try {
        await ddl.query('BEGIN'); await ddl.query("SET LOCAL lock_timeout='100ms'");
        await assert.rejects(ddl.query('ALTER POLICY financial_privacy_quarantine_scope_policy ON cost_intelligence.financial_privacy_quarantine USING(false)'), error => error.code === '55P03');
        await ddl.query('ROLLBACK'); resume(); await checked(pending);
      } finally { resume?.(); try { await ddl.query('ROLLBACK'); } catch { /* cleanup */ } ddl.release(); }
    });

    await t.test('partition-lock timeout returns retryable unavailability and releases the aborted transaction', async () => {
      const writer = await admin.connect();
      try {
        await writer.query('BEGIN'); await writer.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [gate(retainedScope)]);
        const h = reader(retainedScope);
        const result = await refused(h.reader.lookupPostingEvidence(postingRequest(retainedScope, posting.eventId)));
        assert.equal(result.error.retryable, true); assert.equal(h.state.dataReads, 0);
        assert.equal(h.state.discards, 1); assert.ok(h.state.statements.includes('ROLLBACK'));
      } finally { await writer.query('ROLLBACK'); writer.release(); }
    });

    await t.test('failed rollback uses an explicit physical discard, never ordinary pool release', async () => {
      const isolated = new pg.Pool({ ...poolConfig(), max: 1 });
      try {
        const h = reader(retainedScope, { beforeQuery(sql, _parameters, state) {
          if (sql === 'ROLLBACK') throw new Error('SYNTHETIC_PRIVATE_ROLLBACK');
          if (sql.startsWith('SELECT e.tenant_id') && state.dataReads === 1) throw new Error('SYNTHETIC_PRIVATE_RELATED_READ');
        } }, isolated);
        const result = await refused(h.reader.lookupPostingEvidence(postingRequest(retainedScope, posting.eventId)));
        assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
        assert.equal(h.state.discards, 1); assert.equal(h.state.discardForwarded, true); assert.equal(h.state.releases, 0);
        const next = await isolated.connect(); try { assert.notEqual(next.processID, h.state.pid); } finally { next.release(); }
      } finally { await isolated.end(); }
    });

    await t.test('index and complete policy drift fail feature health and every evidence read', async () => {
      const index = 'financial_evidence_operation_idx';
      const ddl = (await admin.query("SELECT pg_get_indexdef(('cost_intelligence.'||$1)::regclass) AS definition", [index])).rows[0].definition;
      try {
        await admin.query(`DROP INDEX cost_intelligence.${index}`);
        assert.equal((await runtime.query('SELECT migrations_ready FROM cost_intelligence.evidence_reader_health')).rows[0].migrations_ready, false);
        await refused(reader(retainedScope).reader.lookupPostingEvidence(postingRequest(retainedScope, posting.eventId)));
      } finally { await admin.query(ddl); }
      try {
        await admin.query('CREATE POLICY ci10_hide_quarantine ON cost_intelligence.financial_privacy_quarantine AS RESTRICTIVE FOR SELECT TO PUBLIC USING(false)');
        assert.equal((await runtime.query('SELECT migrations_ready FROM cost_intelligence.evidence_reader_health')).rows[0].migrations_ready, false);
        await refused(reader(retainedScope).reader.lookupPostingEvidence(postingRequest(retainedScope, posting.eventId)));
      } finally { await admin.query('DROP POLICY ci10_hide_quarantine ON cost_intelligence.financial_privacy_quarantine'); }
      assert.equal((await runtime.query('SELECT migrations_ready FROM cost_intelligence.evidence_reader_health')).rows[0].migrations_ready, true);
    });

    await t.test('migration preflight rejects a pre-existing false/extra policy instead of capturing it as healthy', async () => {
      const migration = await readFile(new URL('../../migrations/0014_evidence_reader_indexes.sql', import.meta.url), 'utf8');
      for (const fault of ['ALTER POLICY financial_privacy_quarantine_scope_policy ON cost_intelligence.financial_privacy_quarantine USING(false)',
        'CREATE POLICY ci10_preexisting_hidden ON cost_intelligence.financial_privacy_quarantine AS RESTRICTIVE FOR SELECT TO PUBLIC USING(false)']) {
        const client = await admin.connect();
        try {
          await client.query('BEGIN'); await client.query(fault);
          await assert.rejects(client.query(migration), error => error.message === 'CI evidence reader requires the reviewed ledger and quarantine scope policies');
        } finally { await client.query('ROLLBACK'); client.release(); }
      }
      assert.equal((await admin.query("SELECT count(*)::integer AS n FROM pg_policy WHERE polname LIKE 'ci10_expected_%'")).rows[0].n, 0);
    });

    for (const lookup of ['lookupPostingEvidence', 'lookupByOperationalReference']) {
      for (const boundary of ['final-privacy', 'commit']) {
        await t.test(`${lookup} rejects grant expiry across actual PostgreSQL ${boundary}`, async () => {
          let instant = Date.parse(now);
          let triggered = false;
          const h = reader(retainedScope, { clock: { now: () => new Date(instant) },
            afterQuery(sql, _parameters, state) {
              const finalPrivacy = sql.includes('AS restricted FROM cost_intelligence.financial_privacy_quarantine')
                && state.dataReads === (lookup === 'lookupPostingEvidence' ? 2 : 1);
              if ((boundary === 'commit' && sql === 'COMMIT') || (boundary === 'final-privacy' && finalPrivacy)) {
                instant += 60_000;
                triggered = true;
              }
            },
          });
          const result = await refused(h.reader[lookup](lookup === 'lookupPostingEvidence'
            ? postingRequest(retainedScope, posting.eventId)
            : reverseRequest('logical_operation', posting.identities.logicalOperationId, 'cost-intelligence', retainedScope)), 'FORBIDDEN_SCOPE');
          assert.equal(triggered, true);
          assert.equal(Object.hasOwn(result, 'value'), false);
          assert.equal(h.state.committed, boundary === 'commit');
          assert.equal(h.state.statements.at(-1), boundary === 'commit' ? 'COMMIT' : 'ROLLBACK');
          assert.equal(h.state.calls.some(call => call.committed), false);
          assert.equal(h.state.releases, 1);
        });
      }
    }

    await t.test('prior migration checksums and foundation readiness remain unchanged after all reader checks', async () => {
      assert.deepEqual((await admin.query("SELECT version,checksum_sha256 FROM cost_intelligence.schema_migrations WHERE version < '0014' ORDER BY version")).rows, originalChecksums);
      assert.deepEqual((await admin.query('SELECT * FROM cost_intelligence.foundation_health')).rows[0], coreHealth);
    });
  } finally { await runtime.end(); await admin.end(); }
});
