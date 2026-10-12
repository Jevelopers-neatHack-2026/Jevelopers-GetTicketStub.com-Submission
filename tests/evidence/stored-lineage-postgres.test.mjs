// Actual disposable PostgreSQL only; all observations, grants and snapshots are
// synthetic. No skip/model fallback and no provider, host or CFO acceptance claim.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { appendLedgerEvent, ingestUsage, querySummary, createPostgresStoredLineageReader } from '../../dist/index.js';
import { REPORTING_POLICY_VERSION, REPORTING_DIMENSIONS } from '../../dist/reporting/index.js';
import { assertDisposableMarker, databaseConfigFromEnvironment, runtimeDatabaseConfigFromEnvironment } from '../../scripts/test-db-lifecycle.mjs';
import { checked, refused, hash, partition, ledgerRequest } from './postgres-fixtures.mjs';
import { intakeRequest, snapshotRequest } from './stored-lineage-fixtures.mjs';

const fixture = JSON.parse(await readFile(new URL('../../fixtures/metering/usage-observation.request.json', import.meta.url), 'utf8'));
const migration = await readFile(new URL('../../migrations/0015_stored_lineage_reader.sql', import.meta.url), 'utf8');
const s = () => ({ tenantId: randomUUID(), projectId: randomUUID(), environment: 'test', billingMode: 'simulated', actorId: randomUUID() });
const asOf = '2026-10-12T23:00:00.000Z';
const clock = { now: () => new Date(asOf) };
const grant = (input, revision = 'ci10-lineage-fixture-grant-1') => ({
  status: 'allowed', decisionId: 'synthetic-lineage-current-grant', operation: input.operation, permission: input.permission,
  scope: { ...input.requestedScope }, principal: { kind: 'service', actorId: input.requestedScope.actorId, serviceStatus: 'active', serviceGrantRevision: revision },
  verifiedAt: asOf, expiresAt: '2026-10-12T23:01:00.000Z',
});
const gate = scope => `ci02-ledger:${scope.tenantId}:${scope.projectId}:${scope.environment}:${scope.billingMode}`;
const config = () => ({ ...runtimeDatabaseConfigFromEnvironment(), max: 4, connectionTimeoutMillis: 5_000, query_timeout: 8_000 });
const turn = () => new Promise(resolve => setImmediate(resolve));
const quote = name => '"' + name.replaceAll('"', '""') + '"';
function observation(scope, options = {}) {
  const event = structuredClone(fixture.usageEvent);
  Object.assign(event, {
    event_id: randomUUID(), usage_event_id: randomUUID(), source_observation_id: randomUUID(),
    logical_operation_id: randomUUID(), provider_attempt_id: randomUUID(), billable_attempt_id: randomUUID(),
    transport_attempt_id: randomUUID(), correlation_id: randomUUID(), provider_request_id: null,
    tenant_id: scope.tenantId, project_id: scope.projectId, environment: scope.environment, billing_mode: scope.billingMode,
    producer: { module: 'shared-contracts', source_revision: 'a'.repeat(40), build_revision: 'ci10-lineage-synthetic' },
    occurred_at: '2026-10-12T15:00:00.000Z', observed_at: '2026-10-12T15:00:01.000Z', ingested_at: asOf,
    source: 'provider_response', provider: 'synthetic_provider', model: 'synthetic_model',
    completeness: 'complete', usage_units: [{ name: 'input_tokens', quantity: '7', scale: 0, relation: 'standalone' }],
    missing_fields: [], outcome: 'succeeded', supersedes_observation_id: null, reconciliation_ref: null,
    valuation: { basis: 'estimated', money: { amount: '0.000003', currency: 'USD', scale: 6 },
      rate_card_ref: { contract: 'RateCard', schema_version: '1.0.0', id: randomUUID(), revision: 1, content_hash: hash('synthetic-rate') } },
    ...options,
  });
  return { schemaVersion: '1.0.0', requestId: randomUUID(), idempotencyKey: randomUUID(), scope, usageEvent: event,
    evidenceMode: 'mocked', verificationStatus: 'unverified', evidenceProvenanceRef: 'fixture:ci10-lineage:' + event.source_observation_id };
}

await test('CI-10 stored intake and snapshot input lineage on actual PostgreSQL', async t => {
  const admin = new pg.Pool({ ...databaseConfigFromEnvironment(), max: 4, connectionTimeoutMillis: 5_000, query_timeout: 8_000 });
  let runtime = new pg.Pool(config());
  const outcomes = [];
  let completed = false;
  const run = async (name, body) => t.test(name, async () => {
    try { await body(); outcomes.push({ name, status: 'passed' }); }
    catch (error) { outcomes.push({ name, status: 'failed', code: typeof error?.code === 'string' ? error.code : null }); throw error; }
  });
  try {
    assertDisposableMarker((await admin.query('SELECT marker FROM ci_test.disposable_database_marker')).rows);
    const core = (await admin.query('SELECT * FROM cost_intelligence.foundation_health')).rows;
    const predecessor = (await admin.query("SELECT version,checksum_sha256 FROM cost_intelligence.schema_migrations WHERE version<'0015' ORDER BY version")).rows;
    function ports(scope, database = runtime) {
      return { clock, database, trustedContext: { resolve: async requested => JSON.stringify(requested) === JSON.stringify(scope) ? { ...scope } : null },
        financeAuthority: { authorizeCurrent: async input => JSON.stringify(input.requestedScope) === JSON.stringify(scope)
          ? grant(input) : { status: 'denied', operation: input.operation, permission: input.permission } },
        storage: { isAvailable: async () => true }, providerSource: { isAvailable: async () => false },
        reporting: { database, cursorSigningKey: 'synthetic-lineage-pagination-key-000000000000000000',
          producer: { sourceRevision: 'a'.repeat(40), buildRevision: 'ci10-lineage-synthetic' } } };
    }
    function reader(scope, hooks = {}, pool = runtime) {
      const state = { statements: [], calls: [], dataReads: 0, releases: 0, discards: 0, denied: false, committed: false };
      const database = { async connect() {
        const raw = await pool.connect();
        return { release() { state.releases++; raw.release(); }, discard() { state.discards++; raw.release(true); },
          async query(sql, values = []) {
            state.statements.push(sql);
            await hooks.beforeQuery?.(sql, values, state, raw);
            const result = await raw.query(sql, values);
            if (/^SELECT (i\.tenant_id|s\.tenant_id|count\(\*\)::integer AS input_count|tenant_id,project_id)/.test(sql)) state.dataReads++;
            if (sql === 'COMMIT') state.committed = true;
            await hooks.afterQuery?.(sql, values, state, raw, result);
            return result;
          } };
      } };
      const financeAuthority = { async authorizeCurrent(input) {
        state.calls.push({ operation: input.operation, permission: input.permission, committed: state.committed });
        if (hooks.authority) return hooks.authority(input, state);
        return state.denied || JSON.stringify(input.requestedScope) !== JSON.stringify(scope)
          ? { status: 'denied', operation: input.operation, permission: input.permission } : grant(input);
      } };
      return { reader: createPostgresStoredLineageReader({ database, clock, financeAuthority }), state };
    }
    const counts = scope => admin.query(`SELECT
      (SELECT count(*)::text FROM cost_intelligence.usage_intake_inbox WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS inbox,
      (SELECT count(*)::text FROM cost_intelligence.usage_intake_attempts WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS attempts,
      (SELECT count(*)::text FROM cost_intelligence.usage_intake_outbox WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS outbox,
      (SELECT count(*)::text FROM cost_intelligence.reporting_snapshots WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS snapshots,
      (SELECT count(*)::text FROM cost_intelligence.financial_ledger_events WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS events,
      (SELECT sum(amount)::text FROM cost_intelligence.financial_ledger_events WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS amount`, partition(scope)).then(result => result.rows);
    const direct = async request => (await admin.query(`SELECT o.ledger_event_id,e.event_hash,i.payload_sha256,i.idempotency_sha256,i.provenance_sha256
      FROM cost_intelligence.usage_intake_inbox i JOIN cost_intelligence.usage_intake_outbox o USING(tenant_id,project_id,environment,billing_mode,source_observation_id)
      LEFT JOIN cost_intelligence.financial_ledger_events e ON e.event_id=o.ledger_event_id
      WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.environment=$3 AND i.billing_mode=$4 AND i.source_observation_id=$5`,
    [...partition(request.scope), request.usageEvent.source_observation_id])).rows[0];
    const quarantine = (client, scope) => client.query("INSERT INTO cost_intelligence.financial_privacy_quarantine(tenant_id,project_id,environment,billing_mode,record_kind,record_hash,reason_code) VALUES($1,$2,$3,$4,'ledger_event',$5,'legacy_sensitive_event_data')", [...partition(scope), hash(scope.tenantId)]);

    await run('independent feature capability is healthy without changing predecessor checksums or core health', async () => {
      assert.deepEqual((await runtime.query('SELECT migrations_ready FROM cost_intelligence.stored_lineage_reader_health')).rows, [{ migrations_ready: true }]);
      assert.equal((await admin.query("SELECT count(*)::integer AS n FROM pg_policy WHERE polname LIKE 'ci10_lineage_expected_%'")).rows[0].n, 0);
      assert.deepEqual((await admin.query('SELECT * FROM cost_intelligence.foundation_health')).rows, core);
    });

    const retainedScope = s(); const request = observation(retainedScope);
    const ingested = await checked(ingestUsage(request, ports(retainedScope)));
    assert.equal(ingested.outboxStatus, 'posted');
    const stored = await direct(request);
    const observationLookup = intakeRequest(retainedScope, { kind: 'source_observation', sourceObservationId: request.usageEvent.source_observation_id });
    let retained;
    await run('public intake commits resolve both directions with exact stored hashes and no additional financial writes', async () => {
      const before = await counts(retainedScope);
      retained = await checked(reader(retainedScope).reader.readIntakeLineage(observationLookup));
      assert.equal(retained.status, 'found'); assert.equal(retained.observations.length, 1);
      const row = retained.observations[0];
      assert.deepEqual(row.outbox.posting, { eventId: stored.ledger_event_id, eventHash: stored.event_hash });
      assert.equal(row.commitments.normalizedPayloadHash, stored.payload_sha256);
      assert.equal(row.commitments.idempotencyHash, stored.idempotency_sha256);
      assert.equal(row.commitments.provenanceReferenceHash, stored.provenance_sha256);
      assert.equal(row.inputEventId, request.usageEvent.event_id);
      const reverse = await checked(reader(retainedScope).reader.readIntakeLineage(intakeRequest(retainedScope, { kind: 'posting_event', eventId: stored.ledger_event_id })));
      assert.deepEqual(reverse.observations, retained.observations);
      assert.equal(retained.billingAuthority, false);
      assert.equal(/event_facts|posting_payload|event_payload|"amount"|evidenceProvenanceRef/.test(JSON.stringify(retained)), false);
      assert.deepEqual(await counts(retainedScope), before);
    });
    await run('new pool and reader recover the same durable stored relations', async () => {
      await runtime.end(); runtime = new pg.Pool(config());
      assert.deepEqual(await checked(reader(retainedScope).reader.readIntakeLineage(observationLookup)), retained);
    });
    await run('unknown billing retains an actual awaiting-evidence observation with null posting', async () => {
      const scope = s(); const input = observation(scope, { completeness: 'incomplete', usage_units: null, missing_fields: ['usage','amount'],
        valuation: { basis: 'unknown', money: null, rate_card_ref: null }, outcome: 'partial' });
      assert.equal((await checked(ingestUsage(input, ports(scope)))).outboxStatus, 'awaiting_evidence');
      const value = await checked(reader(scope).reader.readIntakeLineage(intakeRequest(scope, { kind: 'source_observation', sourceObservationId: input.usageEvent.source_observation_id })));
      assert.equal(value.observations[0].outbox.status, 'awaiting_evidence');
      assert.equal(value.observations[0].outbox.posting, null);
      assert.equal(value.observations[0].currentAttempt.posting, null);
      assert.equal(value.observations[0].valuationBasis, 'unknown');
    });
    let correctionFixture;
    await run('a durable correction retry preserves a newer observation and its older current posting', async () => {
      const scope = s(); const original = observation(scope); await checked(ingestUsage(original, ports(scope)));
      const earlier = await direct(original);
      const correction = observation(scope, { logical_operation_id: original.usageEvent.logical_operation_id,
        provider_attempt_id: original.usageEvent.provider_attempt_id, billable_attempt_id: original.usageEvent.billable_attempt_id,
        transport_attempt_id: original.usageEvent.transport_attempt_id, provider_request_id: original.usageEvent.provider_request_id,
        supersedes_observation_id: original.usageEvent.source_observation_id });
      let injected = false;
      const database = { async connect() { const raw = await runtime.connect(); return {
        release: () => raw.release(),
        async query(sql, values) {
          if (!injected && /^INSERT INTO cost_intelligence\.financial_ledger_events/i.test(sql)) { injected = true; throw Error('synthetic pre-insert failure'); }
          return raw.query(sql, values);
        },
      }; } };
      assert.equal((await checked(ingestUsage(correction, ports(scope, database)))).outboxStatus, 'retry');
      assert.equal(injected, true);
      const value = await checked(reader(scope).reader.readIntakeLineage(intakeRequest(scope, { kind: 'source_observation', sourceObservationId: correction.usageEvent.source_observation_id })));
      assert.equal(value.observations[0].outbox.status, 'retry');
      assert.equal(value.observations[0].outbox.posting, null);
      assert.equal(value.observations[0].currentAttempt.currentObservationId, correction.usageEvent.source_observation_id);
      assert.equal(value.observations[0].currentAttempt.posting.eventId, earlier.ledger_event_id);
      correctionFixture = { scope, original, correction, earlier };
    });
    await run('a same-attempt current pointer must bind its own recorded source observation and stored commitment', async () => {
      assert.ok(correctionFixture, 'the public retry producer fixture must have succeeded');
      const { scope, original, correction, earlier } = correctionFixture;
      for (const sourceObservationId of [randomUUID(), correction.usageEvent.source_observation_id]) {
        const eventId = randomUUID();
        // Explicit privileged negative fixture: only a new synthetic audit row is
        // inserted; existing immutable rows/triggers are never rewritten.
        await admin.query(`INSERT INTO cost_intelligence.financial_ledger_events
          SELECT (jsonb_populate_record(NULL::cost_intelligence.financial_ledger_events,
            to_jsonb(e) || jsonb_build_object('event_id',$2::text,'idempotency_key',$2::text,
              'source_event_id',$2::text,'source_observation_id',$3::text,
              'source_content_hash',$4::text,'event_hash',$5::text,'financial_effect',false))).*
          FROM cost_intelligence.financial_ledger_events e WHERE e.event_id=$1`,
        [earlier.ledger_event_id, eventId, sourceObservationId, hash('wrong-intake-commitment'), hash(eventId)]);
        await admin.query(`UPDATE cost_intelligence.usage_intake_attempts SET current_ledger_event_id=$6
          WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND billable_attempt_id=$5`,
        [...partition(scope), original.usageEvent.billable_attempt_id, eventId]);
        try {
          await refused(reader(scope).reader.readIntakeLineage(intakeRequest(scope,
            { kind: 'source_observation', sourceObservationId: original.usageEvent.source_observation_id })));
        } finally {
          await admin.query(`UPDATE cost_intelligence.usage_intake_attempts SET current_ledger_event_id=$6
            WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND billable_attempt_id=$5`,
          [...partition(scope), original.usageEvent.billable_attempt_id, earlier.ledger_event_id]);
        }
      }
    });
    await run('globally valid foreign-partition outbox or current pointers are refused as inconsistent lineage', async () => {
      const foreignScope = s(); const foreign = ledgerRequest(foreignScope);
      await checked(appendLedgerEvent(foreign, ports(foreignScope)));
      for (const [table, column, key, id] of [
        ['usage_intake_outbox','ledger_event_id','source_observation_id', request.usageEvent.source_observation_id],
        ['usage_intake_attempts','current_ledger_event_id','billable_attempt_id', request.usageEvent.billable_attempt_id],
      ]) {
        await admin.query(`UPDATE cost_intelligence.${table} SET ${column}=$6 WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND ${key}=$5`, [...partition(retainedScope), id, foreign.eventId]);
        try { await refused(reader(retainedScope).reader.readIntakeLineage(observationLookup)); }
        finally { await admin.query(`UPDATE cost_intelligence.${table} SET ${column}=$6 WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND ${key}=$5`, [...partition(retainedScope), id, stored.ledger_event_id]); }
      }
    });
    await run('each authorized foreign partition is empty rather than exposing another intake record', async () => {
      for (const changed of [{ tenantId: randomUUID() }, { projectId: randomUUID() }, { environment: 'development' }, { billingMode: 'sandbox' }]) {
        const scope = { ...retainedScope, ...changed };
        const value = await checked(reader(scope).reader.readIntakeLineage({ ...observationLookup, scope }));
        assert.equal(value.status, 'not_found'); assert.deepEqual(value.observations, []);
      }
    });
    await run('a stored posted current attempt with a null pointer is inconsistent rather than unposted', async () => {
      await admin.query(`UPDATE cost_intelligence.usage_intake_attempts SET current_ledger_event_id=NULL
        WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND billable_attempt_id=$5`,
      [...partition(retainedScope), request.usageEvent.billable_attempt_id]);
      try { await refused(reader(retainedScope).reader.readIntakeLineage(observationLookup)); }
      finally {
        await admin.query(`UPDATE cost_intelligence.usage_intake_attempts SET current_ledger_event_id=$6
          WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND billable_attempt_id=$5`,
        [...partition(retainedScope), request.usageEvent.billable_attempt_id, stored.ledger_event_id]);
      }
    });

    const reportScope = { ...s(), billingMode: 'live' };
    const posting = ledgerRequest(reportScope, { occurredAt: '2026-10-11T00:00:00.000Z' });
    await checked(appendLedgerEvent(posting, ports(reportScope)));
    const query = { schemaVersion: '2.0.0', requestId: 'synthetic-lineage-summary', idempotencyKey: 'synthetic-lineage-summary', scope: reportScope,
      period: { start: '2026-10-10T00:00:00.000Z', end: '2026-10-11T00:00:00.000Z' }, timezone: 'UTC', policyVersion: REPORTING_POLICY_VERSION,
      filters: { environments: ['test'], billingModes: ['live'], currency: 'USD' }, groupings: [...REPORTING_DIMENSIONS], pageSize: 10 };
    const summary = await checked(querySummary(query, ports(reportScope)));
    const snapshotLookup = snapshotRequest(reportScope, summary.snapshotId, posting.eventId);
    await run('public v2 summary input membership includes lifetime input outside the period without claiming a total contribution', async () => {
      assert.equal(summary.detailCount, 0, 'the posting is exactly outside the half-open report period');
      const before = await counts(reportScope);
      const h = reader(reportScope); const value = await checked(h.reader.readSnapshotInputLineage(snapshotLookup));
      assert.equal(value.status, 'recorded_input'); assert.equal(value.snapshot.encoding, '2.0.0');
      assert.equal(value.matchedInput.eventId, posting.eventId);
      assert.equal(value.wholeSnapshotHashVerified, false); assert.equal(value.inputMeaning, 'recorded_input_only');
      assert.equal(value.billingAuthority, false);
      assert.ok(value.gaps.includes('input_inclusion_is_not_period_total_contribution'));
      assert.deepEqual(new Set(h.state.calls.map(call => call.permission)), new Set(['ledger.snapshot.read','finance.summary.read']));
      assert.equal(h.state.calls.some(call => call.committed), false);
      assert.equal(h.state.statements.some(sql => /^SELECT snapshot_content(?:\s|,)/.test(sql)), false);
      assert.deepEqual(await counts(reportScope), before);
    });
    await run('published legacy v1 snapshots retain their original recognized encoding', async () => {
      const legacy = { ...query, schemaVersion: '1.0.0' }; delete legacy.policyVersion; delete legacy.groupings;
      const page = await checked(querySummary(legacy, ports(reportScope)));
      const value = await checked(reader(reportScope).reader.readSnapshotInputLineage(snapshotRequest(reportScope, page.snapshotId, posting.eventId)));
      assert.equal(value.status, 'recorded_input'); assert.equal(value.snapshot.encoding, '1.0.0');
      assert.equal(value.snapshot.queryContentHash, page.queryContentHash);
    });
    const frozen = (await admin.query('SELECT snapshot_content FROM cost_intelligence.reporting_snapshots WHERE snapshot_id=$1', [summary.snapshotId])).rows[0].snapshot_content;
    async function syntheticCopy(change) {
      const content = structuredClone(frozen); change(content);
      const id = hash('synthetic-corrupt-snapshot-' + randomUUID());
      await admin.query('INSERT INTO cost_intelligence.reporting_snapshots(snapshot_id,tenant_id,project_id,environment,billing_mode,query_content_hash,as_of,snapshot_content) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [id, ...partition(reportScope), content.queryContentHash, asOf, JSON.stringify(content)]);
      return id;
    }
    for (const [label, change] of [
      ['unknown encoding', c => { c.encoding = 'future'; c.normalizedQuery.encoding = 'future'; }],
      ['different creator actor', c => { c.scope.actorId = randomUUID(); c.normalizedQuery.scope.actorId = c.scope.actorId; }],
      ['different normalized query scope', c => { c.normalizedQuery.scope.projectId = randomUUID(); }],
      ['changed stored query commitment', c => { c.queryContentHash = hash('different-query'); }],
      ['missing event hash', c => { delete c.inputEvidence.ledger[0].eventHash; }],
      ['extra input field', c => { c.inputEvidence.ledger[0].unexpected = 'not-supported'; }],
      ['non-object input', c => { c.inputEvidence.ledger = [null]; }],
      ['duplicate input identity', c => { c.inputEvidence.ledger.push(structuredClone(c.inputEvidence.ledger[0])); }],
      ['different ledger commitment', c => { c.inputEvidence.ledger[0].eventHash = hash('different-ledger'); }],
      ['non-array ledger metadata', c => { c.inputEvidence.ledger = {}; }],
      ['malformed recorded timestamp', c => { c.asOf = 'not-a-time'; c.normalizedQuery.asOf = c.asOf; }],
    ]) {
      await run('actual SQL refuses synthetic stored snapshot with ' + label, async () => {
        const id = await syntheticCopy(change);
        if (label === 'changed stored query commitment') {
          // Preserve the table commitment independently of its malformed JSON.
          const content = structuredClone(frozen); content.queryContentHash = hash('different-query');
          const isolatedId = hash('different-column-query-' + randomUUID());
          await admin.query('INSERT INTO cost_intelligence.reporting_snapshots(snapshot_id,tenant_id,project_id,environment,billing_mode,query_content_hash,as_of,snapshot_content) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
            [isolatedId, ...partition(reportScope), frozen.queryContentHash, asOf, JSON.stringify(content)]);
          await refused(reader(reportScope).reader.readSnapshotInputLineage({ ...snapshotLookup, snapshotId: isolatedId }));
        } else await refused(reader(reportScope).reader.readSnapshotInputLineage({ ...snapshotLookup, snapshotId: id }));
      });
    }
    await run('missing snapshot, missing posting and stored non-inclusion remain distinct nonzero claims', async () => {
      assert.equal((await checked(reader(reportScope).reader.readSnapshotInputLineage({ ...snapshotLookup, snapshotId: hash('absent') }))).status, 'snapshot_not_found');
      assert.equal((await checked(reader(reportScope).reader.readSnapshotInputLineage({ ...snapshotLookup, postingEventId: 'absent-event' }))).status, 'posting_not_found');
      const id = await syntheticCopy(content => { content.inputEvidence.ledger = []; });
      const value = await checked(reader(reportScope).reader.readSnapshotInputLineage({ ...snapshotLookup, snapshotId: id }));
      assert.equal(value.status, 'not_recorded_input'); assert.equal(value.matchedInput, null);
      assert.equal(value.wholeSnapshotHashVerified, false, 'synthetic fixture deliberately does not claim a whole-snapshot rehash');
    });
    await run('recorded foreign input whose scoped actual event is absent is refused', async () => {
      const foreignScope = s(); const foreign = ledgerRequest(foreignScope);
      await checked(appendLedgerEvent(foreign, ports(foreignScope)));
      const row = (await admin.query('SELECT event_hash FROM cost_intelligence.financial_ledger_events WHERE event_id=$1', [foreign.eventId])).rows[0];
      const id = await syntheticCopy(content => { content.inputEvidence.ledger = [{ eventId: foreign.eventId, eventHash: row.event_hash }]; });
      await refused(reader(reportScope).reader.readSnapshotInputLineage(snapshotRequest(reportScope, id, foreign.eventId)));
    });
    await run('revocation after a real snapshot header withholds all retained metadata', async () => {
      const h = reader(reportScope, { afterQuery(sql, _values, state) { if (sql.startsWith('SELECT s.tenant_id')) state.denied = true; } });
      await refused(h.reader.readSnapshotInputLineage(snapshotLookup), 'FORBIDDEN_SCOPE');
      assert.equal(h.state.dataReads, 1); assert.equal(h.state.committed, false); assert.equal(h.state.releases, 1);
    });
    await run('a real SQL failure rolls back, discards the connection and exposes no metadata', async () => {
      const h = reader(reportScope, { async afterQuery(sql, _values, _state, raw) { if (sql.startsWith('SELECT s.tenant_id')) await raw.query('SELECT 1/0'); } });
      await refused(h.reader.readSnapshotInputLineage(snapshotLookup));
      assert.equal(h.state.discards, 1); assert.equal(h.state.releases, 0); assert.equal(h.state.committed, false);
    });
    await run('current authorization timeout while holding the actual partition lock unwinds without later SQL', async () => {
      let resolve; let gateHeld = false;
      const h = reader(retainedScope, {
        afterQuery(sql) { if (sql.startsWith('SELECT pg_advisory_xact_lock')) gateHeld = true; },
        authority(input) {
          if (gateHeld && resolve === undefined) return new Promise(done => { resolve = () => done(grant(input)); });
          return grant(input);
        },
      });
      await refused(h.reader.readIntakeLineage(observationLookup));
      assert.equal(gateHeld, true); assert.equal(typeof resolve, 'function');
      assert.equal(h.state.statements.filter(sql => sql === 'ROLLBACK').length, 1);
      assert.equal(h.state.releases, 1); assert.equal(h.state.dataReads, 0);
      const previous = h.state.statements.length; resolve(); await turn();
      assert.equal(h.state.statements.length, previous); assert.equal(h.state.committed, false);
      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        assert.equal((await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [gate(retainedScope)])).rows[0].acquired, true);
      } finally { await client.query('ROLLBACK'); client.release(); }
    });
    await run('privacy activation holds the same gate until the metadata read commits', async () => {
      const scope = s(); const input = observation(scope); await checked(ingestUsage(input, ports(scope)));
      const lookup = intakeRequest(scope, { kind: 'source_observation', sourceObservationId: input.usageEvent.source_observation_id });
      let paused; const entered = new Promise(resolve => { paused = resolve; }); let resume; let once = false;
      const h = reader(scope, { async authority(input, state) {
        if (!once && state.dataReads === 1) { once = true; paused(); await new Promise(resolve => { resume = resolve; }); }
        return grant(input);
      } });
      const pending = h.reader.readIntakeLineage(lookup);
      await Promise.race([entered, pending.then(() => { throw Error('Reader completed before gate barrier'); })]);
      const writer = await admin.connect();
      try {
        await writer.query('BEGIN');
        assert.equal((await writer.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [gate(scope)])).rows[0].acquired, false);
        resume(); await checked(pending);
        await writer.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [gate(scope)]);
        await quarantine(writer, scope); await writer.query('COMMIT');
        await refused(reader(scope).reader.readIntakeLineage(lookup));
        assert.equal(h.state.calls.some(call => call.committed), false);
      } finally { resume?.(); try { await writer.query('ROLLBACK'); } catch { /* disposable cleanup */ } writer.release(); }
    });
    await run('migration installation rejects pre-existing trigger scope, binding and event mutations', async () => {
      for (const declaration of [
        'BEFORE UPDATE OF payload_sha256 OR DELETE ON cost_intelligence.usage_intake_inbox FOR EACH ROW EXECUTE FUNCTION cost_intelligence.reject_usage_intake_audit_mutation()',
        'BEFORE UPDATE OR DELETE ON cost_intelligence.usage_intake_inbox FOR EACH ROW EXECUTE FUNCTION cost_intelligence.guard_usage_intake_outbox_update()',
        'BEFORE UPDATE ON cost_intelligence.usage_intake_inbox FOR EACH ROW EXECUTE FUNCTION cost_intelligence.reject_usage_intake_audit_mutation()',
      ]) {
        const client = await admin.connect();
        try {
          await client.query('BEGIN');
          await client.query('DROP TRIGGER usage_intake_inbox_append_only ON cost_intelligence.usage_intake_inbox');
          await client.query('CREATE TRIGGER usage_intake_inbox_append_only ' + declaration);
          await assert.rejects(client.query(migration), error => error.message === 'Stored lineage requires exact predecessor trigger bindings');
        } finally { await client.query('ROLLBACK'); client.release(); }
      }
    });
    await run('migration installation rejects an unvalidated or changed-action predecessor FK', async () => {
      const fk = (await admin.query("SELECT conname FROM pg_constraint WHERE contype='f' AND conrelid='cost_intelligence.usage_intake_outbox'::regclass AND confrelid='cost_intelligence.financial_ledger_events'::regclass")).rows[0].conname;
      for (const ending of ['ON DELETE RESTRICT NOT VALID', 'ON DELETE CASCADE']) {
        const client = await admin.connect();
        try {
          await client.query('BEGIN');
          await client.query('ALTER TABLE cost_intelligence.usage_intake_outbox DROP CONSTRAINT ' + quote(fk));
          await client.query('ALTER TABLE cost_intelligence.usage_intake_outbox ADD CONSTRAINT ' + quote(fk) + ' FOREIGN KEY(ledger_event_id) REFERENCES cost_intelligence.financial_ledger_events(event_id) ' + ending);
          await assert.rejects(client.query(migration), error => error.message === 'Stored lineage requires exact validated predecessor foreign keys');
        } finally { await client.query('ROLLBACK'); client.release(); }
      }
    });
    await run('migration policy preflight refuses a changed source policy and leaves no temporary probe', async () => {
      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        await client.query('ALTER POLICY usage_intake_inbox_scope_policy ON cost_intelligence.usage_intake_inbox USING(false)');
        await assert.rejects(client.query(migration), error => error.message === 'Stored lineage requires the reviewed intake and reporting scope policies');
      } finally { await client.query('ROLLBACK'); client.release(); }
      assert.equal((await admin.query("SELECT count(*)::integer AS n FROM pg_policy WHERE polname LIKE 'ci10_lineage_expected_%'")).rows[0].n, 0);
    });
    await run('predecessor checksums and core capability survive all scoped adverse controls', async () => {
      assert.deepEqual((await admin.query("SELECT version,checksum_sha256 FROM cost_intelligence.schema_migrations WHERE version<'0015' ORDER BY version")).rows, predecessor);
      assert.deepEqual((await admin.query('SELECT * FROM cost_intelligence.foundation_health')).rows, core);
      assert.deepEqual((await runtime.query('SELECT migrations_ready FROM cost_intelligence.stored_lineage_reader_health')).rows, [{ migrations_ready: true }]);
    });
    completed = true;
  } finally {
    await runtime.end(); await admin.end();
    await mkdir(new URL('../../artifacts/evidence/', import.meta.url), { recursive: true });
    await writeFile(new URL('../../artifacts/evidence/stored-lineage-postgres.json', import.meta.url), JSON.stringify({
      schemaVersion: '1.0.0', mode: 'actual_postgresql_with_synthetic_financial_rows_and_host_grants',
      status: completed && outcomes.length > 0 && outcomes.every(item => item.status === 'passed') ? 'passed' : 'failed',
      completed, registeredSubtests: outcomes.length,
      verification: 'stored_reference_match', wholeSnapshotHashVerified: false, billingAuthority: false,
      limits: ['no_live_host_authority', 'no_provider_billing_proof', 'no_CFO_delivery_or_acceptance', 'no_full_issue_or_gate_completion'],
      outcomes,
    }, null, 2) + '\n');
  }
});
