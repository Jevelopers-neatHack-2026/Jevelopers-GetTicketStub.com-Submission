// Deterministic synthetic transport/authority checks, never PostgreSQL evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  createPostgresStoredLineageReader, IntakeLineageRequestSchema, IntakeLineageResultSchema,
  SnapshotInputLineageRequestSchema, SnapshotInputLineageResultSchema,
} from '../../dist/index.js';
import { checked, refused } from './postgres-fixtures.mjs';
import { model, scope, decision, now, hash, intakeRequest, snapshotRequest, intakeRow, noPosting, snapshotRow, inputRow } from './stored-lineage-fixtures.mjs';
const flush = () => new Promise(resolve => setImmediate(resolve));

test('stored lineage is an explicit public metadata contract with only two guarded reads', async () => {
  const root = await import('../../dist/index.js');
  const subpath = await import('../../dist/evidence/index.js');
  assert.equal(root.createPostgresStoredLineageReader, subpath.createPostgresStoredLineageReader);
  const h = model();
  assert.deepEqual(Object.keys(h.reader).sort(), ['readIntakeLineage', 'readSnapshotInputLineage']);
  assert.equal(h.state.connections, 0);
  assert.equal(Value.Check(IntakeLineageRequestSchema, intakeRequest()), true);
  assert.equal(Value.Check(SnapshotInputLineageRequestSchema, snapshotRequest()), true);
  const result = await checked(h.reader.readIntakeLineage(intakeRequest()));
  assert.equal(Value.Check(IntakeLineageResultSchema, result), true);
  assert.equal(result.verification, 'stored_reference_match');
  assert.equal(result.billingAuthority, false);
  assert.equal(result.observations[0].commitments.verification, 'stored_commitments_only');
  assert.equal(result.observations[0].currentAttempt.revisionSequence, 0);
  assert.equal(result.observations[0].providerRequestId, null);
  assert.deepEqual(result.observations[0].outbox.posting, { eventId: 'event-1', eventHash: hash('ledger-1') });
  assert.equal(Object.isFrozen(result.observations[0].commitments), true);
});

test('intake reads exact partitioned 0009 relations without raw payloads or financial writes', async () => {
  const h = model();
  await checked(h.reader.readIntakeLineage(intakeRequest(scope(), { kind: 'posting_event', eventId: 'event-1' })));
  assert.equal(h.state.queries[0].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
  assert.equal(h.state.queries.at(-1).sql, 'COMMIT');
  const data = h.state.queries.find(row => row.sql.startsWith('SELECT i.tenant_id'));
  assert.deepEqual(data.values, ['ci10-tenant','ci10-project','test','simulated','event-1',51]);
  assert.ok(data.sql.includes('o.ledger_event_id=$5'));
  assert.ok(data.sql.includes('direct.environment=i.environment AND direct.billing_mode=i.billing_mode'));
  assert.ok(data.sql.includes('head.environment=i.environment AND head.billing_mode=i.billing_mode'));
  assert.equal(/\bevent_facts\b|\bposting_payload\b|\bevent_payload\b|\bamount\b|SELECT\s+\*/i.test(data.sql), false);
  assert.ok(h.state.queries.findIndex(row => row.sql.includes('pg_advisory_xact_lock')) < h.state.queries.indexOf(data));
  assert.equal(h.state.calls.some(call => call.operation !== 'ledger.readSnapshot' || call.permission !== 'ledger.snapshot.read'), false);
  assert.equal(h.state.calls.some(call => call.committed), false);
  assert.equal(h.state.releases, 1);
  assert.equal(h.state.discards, 0);
});

for (const status of ['awaiting_evidence','pending','retry','duplicate','suppressed','dead_letter']) {
  test(`unposted intake preserves ${status} and unknown/null facts`, async () => {
    const row = intakeRow(scope(), { ...noPosting('outbox'), ...noPosting('current'),
      outbox_status: status, attempt_status: ['duplicate','suppressed'].includes(status) ? 'awaiting_evidence' : status,
      completeness: 'unknown', valuation_basis: 'unknown', attempt_completeness: 'unknown', attempt_valuation_basis: 'unknown',
      attempt_revision_accepted: false });
    const result = await checked(model({ intakeRows: [row] }).reader.readIntakeLineage(intakeRequest()));
    assert.equal(result.observations[0].outbox.status, status);
    assert.equal(result.observations[0].outbox.posting, null);
    assert.equal(result.observations[0].currentAttempt.posting, null);
    assert.equal(result.observations[0].valuationBasis, 'unknown');
    assert.equal(result.observations[0].attemptRevisionAccepted, false);
    assert.equal(JSON.stringify(result).includes('"amount"'), false);
  });
}

test('a new current observation may await evidence while an older posting remains the current ledger head', async () => {
  const row = intakeRow(scope(), { current_observation_id: 'new-observation', attempt_status: 'awaiting_evidence',
    attempt_completeness: 'unknown', attempt_valuation_basis: 'unknown', revision_sequence: 1 });
  const result = await checked(model({ intakeRows: [row] }).reader.readIntakeLineage(intakeRequest()));
  assert.equal(result.observations[0].currentAttempt.currentObservationId, 'new-observation');
  assert.equal(result.observations[0].currentAttempt.posting.eventId, 'event-1');
  assert.ok(result.gaps.includes('current_attempt_is_not_observation_finality'));
});

test('authorized absent intake has no fabricated ledger row or zero-usage interpretation', async () => {
  const result = await checked(model({ intakeRows: [] }).reader.readIntakeLineage(intakeRequest()));
  assert.equal(result.status, 'not_found');
  assert.deepEqual(result.observations, []);
  assert.ok(result.gaps.includes('no_match_is_not_proof_of_zero_usage'));
});

const corruptions = [
  ['foreign global posting FK', { outbox_event_id: null, outbox_event_hash: null }],
  ['foreign current-head FK', { current_event_id: null, current_event_hash: null }],
  ['wrong outbox observation', { outbox_observation_id: 'foreign-observation' }],
  ['wrong outbox attempt', { outbox_billable_attempt_id: 'foreign-attempt' }],
  ['wrong attempt logical operation', { attempt_logical_id: 'foreign-logical' }],
  ['wrong attempt provider', { attempt_provider_id: 'foreign-provider' }],
  ['wrong first observation attempt', { first_billable_id: 'foreign-attempt' }],
  ['wrong latest observation provider', { latest_provider_id: 'foreign-provider' }],
  ['wrong direct posting observation', { outbox_source_observation_id: 'foreign-observation' }],
  ['wrong direct posting source commitment', { outbox_source_content_hash: hash('foreign-commitment') }],
  ['wrong direct posting provider', { outbox_provider_id: 'foreign-provider' }],
  ['wrong current posting attempt', { current_billable_id: 'foreign-attempt' }],
  ['unrecorded current posting observation', { head_observation_id: null, head_payload_sha256: null }],
  ['wrong current posting source commitment', { current_source_content_hash: hash('foreign-commitment') }],
  ['wrong current posting inbox identity', { head_provider_id: 'foreign-provider' }],
  ['posted without a ledger pointer', { ...noPosting('outbox') }],
  ['current attempt posted without a ledger pointer', { ...noPosting('current') }],
  ['malformed stored commitment', { payload_sha256: 'https://private.invalid' }],
  ['unknown future intake state', { outbox_status: 'paid' }],
  ['unsafe identifier', { provider_request_id: 'https://private.invalid?token=SECRET' }],
  ['out-of-range revision', { revision_sequence: 2147483648 }],
];
for (const [label, change] of corruptions) {
  test(`inconsistent intake refuses ${label} without exposing earlier metadata`, async () => {
    const h = model({ intakeRows: [intakeRow(scope(), change)] });
    const result = await refused(h.reader.readIntakeLineage(intakeRequest()));
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
    assert.equal(h.state.committed, false);
  });
}

test('an oversized or sparse SQL transport response is not a partial pass', async () => {
  for (const rows of [Array.from({ length: 52 }, () => intakeRow()), new Array(2)]) {
    const h = model({ afterQuery(sql, _values, _state, result) { if (sql.startsWith('SELECT i.tenant_id')) result.rows = rows; } });
    await refused(h.reader.readIntakeLineage(intakeRequest()));
    assert.equal(h.state.discards, 1);
  }
});

for (const encoding of ['1.0.0','2.0.0']) {
  test(`known frozen ${encoding} snapshot links exact stored input and actual ledger hash only`, async () => {
    const h = model({ snapshotRows: [snapshotRow(scope(), { encoding })] });
    const result = await checked(h.reader.readSnapshotInputLineage(snapshotRequest()));
    assert.equal(Value.Check(SnapshotInputLineageResultSchema, result), true);
    assert.equal(result.status, 'recorded_input');
    assert.deepEqual(result.matchedInput, { eventId: 'event-1', eventHash: hash('ledger-1') });
    assert.equal(result.wholeSnapshotHashVerified, false);
    assert.equal(result.inputMeaning, 'recorded_input_only');
    assert.ok(result.gaps.includes('input_inclusion_is_not_period_total_contribution'));
    assert.ok(result.gaps.includes('export_discovery_not_integrated'));
    assert.ok(h.state.calls.some(call => call.operation === 'reporting.querySummary' && call.permission === 'finance.summary.read'));
    assert.ok(h.state.calls.some(call => call.operation === 'ledger.readSnapshot' && call.permission === 'ledger.snapshot.read'));
    assert.equal(h.state.calls.some(call => call.committed), false);
    const header = h.state.queries.find(row => row.sql.startsWith('SELECT s.tenant_id'));
    assert.equal(header.values[5], scope().actorId, 'creator actor is explicitly bound');
    for (const query of h.state.queries) {
      assert.equal(/SELECT\s+(?:s\.)?snapshot_content(?:\s|,)|\bevent_payload\b|\bamount\b|\bevent_facts\b|\bposting_payload\b/i.test(query.sql), false);
    }
  });
}

test('snapshot and posting absence are explicit and never assert absent financial activity', async () => {
  const missingSnapshot = await checked(model({ snapshotRows: [] }).reader.readSnapshotInputLineage(snapshotRequest()));
  assert.equal(missingSnapshot.status, 'snapshot_not_found');
  assert.equal(missingSnapshot.snapshot, null);
  const unmatched = { inputRows: [inputRow({ selected_count: 0, selected_hash: null })] };
  const notIncluded = await checked(model(unmatched).reader.readSnapshotInputLineage(snapshotRequest()));
  assert.equal(notIncluded.status, 'not_recorded_input');
  assert.equal(notIncluded.matchedInput, null);
  const missingPosting = await checked(model({ ...unmatched, postingRows: [] }).reader.readSnapshotInputLineage(snapshotRequest()));
  assert.equal(missingPosting.status, 'posting_not_found');
  assert.equal(missingPosting.posting, null);
});

for (const [label, override] of [
  ['unrecognized encoding', { snapshotRows: [snapshotRow(scope(), { encoding: '3.0.0', metadata_valid: false })] }],
  ['creator or normalized-query mismatch', { snapshotRows: [snapshotRow(scope(), { metadata_valid: false })] }],
  ['input array exceeds bound', { snapshotRows: [snapshotRow(scope(), { input_count: 50_001 })] }],
  ['duplicate input identities', { inputRows: [inputRow({ distinct_ids: 0 })] }],
  ['malformed input shape', { inputRows: [inputRow({ inputs_valid: false })] }],
  ['selected input hash disagrees', { inputRows: [inputRow({ selected_hash: hash('foreign') })] }],
  ['recorded input no longer resolves', { postingRows: [] }],
  ['foreign actual posting partition', { postingRows: [{ tenant_id: 'foreign', project_id: 'ci10-project', environment: 'test', billing_mode: 'simulated', event_id: 'event-1', event_hash: hash('ledger-1') }] }],
]) {
  test(`snapshot metadata refuses ${label}`, async () => {
    const h = model(override);
    await refused(h.reader.readSnapshotInputLineage(snapshotRequest()));
    assert.equal(h.state.committed, false);
  });
}

test('dual grants require the same current principal and grant revision before any connection', async () => {
  for (const kind of ['service','user']) {
    const h = model({ authority(input) { return decision(input, input.operation === 'ledger.readSnapshot' ? 'revision-1' : 'revision-2', kind); } });
    await refused(h.reader.readSnapshotInputLineage(snapshotRequest()), 'FORBIDDEN_SCOPE');
    assert.equal(h.state.connections, 0);
    assert.equal(h.state.calls.length, 2);
  }
});

test('a ledger grant expiring during the reporting grant callback refuses before SQL', async () => {
  const h = model({ authority(input, state) {
    if (input.operation === 'reporting.querySummary') state.milliseconds += 2000;
    const result = decision(input, 'same-revision');
    result.expiresAt = input.operation === 'ledger.readSnapshot' ? '2026-10-12T16:00:01.000Z' : '2026-10-12T16:01:00.000Z';
    return result;
  } });
  await refused(h.reader.readSnapshotInputLineage(snapshotRequest()), 'FORBIDDEN_SCOPE');
  assert.equal(h.state.connections, 0);
});

test('request aliases are captured before authorization and returned rows before renewal', async () => {
  const request = intakeRequest();
  const h = model({ afterQuery(sql, _values, state) {
    if (sql.startsWith('SELECT i.tenant_id')) {
      state.authority = input => {
        request.scope.tenantId = 'late-foreign';
        request.selector.sourceObservationId = 'late-observation';
        state.intakeRows[0].payload_sha256 = hash('late-mutation');
        return decision(input, state.revision);
      };
    }
  } });
  const result = await checked(h.reader.readIntakeLineage(request));
  assert.equal(result.scope.tenantId, 'ci10-tenant');
  assert.equal(result.observations[0].commitments.normalizedPayloadHash, hash('normalized-1'));
});

for (const hops of [2,3,4,5,6]) {
  test(`raw authority revision mutation after ${hops} microtasks cannot restore continuity`, async () => {
    const retained = [];
    const h = model({ authority(input, state) {
      const changed = state.calls.length > 1;
      const result = decision(input, changed ? 'actual-new-revision' : 'synthetic-revision-1');
      if (changed) {
        retained.push(result);
        let chain = Promise.resolve();
        for (let i = 0; i < hops; i++) chain = chain.then(() => {});
        chain.then(() => { result.principal.serviceGrantRevision = 'synthetic-revision-1'; });
      }
      return result;
    } });
    await refused(h.reader.readIntakeLineage(intakeRequest()), 'FORBIDDEN_SCOPE');
    await flush();
    assert.equal(retained.length, 1);
    assert.equal(retained[0].principal.serviceGrantRevision, 'synthetic-revision-1', 'mutation really executed');
    assert.equal(h.state.dataReads, 0);
  });
}

test('missing/denied grants and behavior-bearing requests fail before acquiring storage', async () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, 'scope', { enumerable: true, get() { getterCalls++; return scope(); } });
  for (const request of [null, { ...intakeRequest(), extra: true }, intakeRequest(scope(), { kind: 'source_observation', sourceObservationId: 'https://private.invalid' }), accessor, new Proxy(intakeRequest(), {})]) {
    const h = model(); await refused(h.reader.readIntakeLineage(request), 'VALIDATION_ERROR'); assert.equal(h.state.connections, 0);
  }
  assert.equal(getterCalls, 0);
  const denied = model({ denied: true });
  await refused(denied.reader.readSnapshotInputLineage(snapshotRequest()), 'FORBIDDEN_SCOPE');
  assert.equal(denied.state.connections, 0);
  const h = model(); const { financeAuthority: _, ...ports } = h.ports;
  await refused(createPostgresStoredLineageReader(ports).readIntakeLineage(intakeRequest()));
  assert.equal(h.state.connections, 0);
});

for (const state of [{ restrictedRole: false }, { healthy: false }, { quarantined: true }]) {
  test(`unavailable storage guard ${Object.keys(state)[0]} suppresses all data reads`, async () => {
    const h = model(state);
    await refused(h.reader.readSnapshotInputLineage(snapshotRequest()));
    assert.equal(h.state.dataReads, 0);
  });
}

for (const mutation of ['deny','revision','quarantine','query_error']) {
  test(`late ${mutation} after protected metadata read suppresses retained results`, async () => {
    const h = model({ afterQuery(sql, _values, state) {
      if (!sql.startsWith('SELECT s.tenant_id')) return;
      if (mutation === 'deny') state.denied = true;
      else if (mutation === 'revision') state.revision = 'changed';
      else if (mutation === 'quarantine') state.quarantined = true;
      else throw Error('postgres://PRIVATE_CONNECTION_SECRET');
    } });
    const result = await refused(h.reader.readSnapshotInputLineage(snapshotRequest()), ['deny','revision'].includes(mutation) ? 'FORBIDDEN_SCOPE' : 'SOURCE_UNAVAILABLE');
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(h.state.dataReads, 1);
    assert.equal(h.state.committed, false);
    if (mutation === 'query_error') assert.equal(h.state.discards, 1);
  });
}

test('final time checks refuse expiration during COMMIT and reject clock rollback', async () => {
  for (const mode of ['expired','rewound']) {
    const h = model({ afterQuery(sql, _values, state) { if (sql === 'COMMIT') state.milliseconds = Date.parse(now) + (mode === 'expired' ? 60_000 : -1); } });
    await refused(h.reader.readSnapshotInputLineage(snapshotRequest()), mode === 'expired' ? 'FORBIDDEN_SCOPE' : 'SOURCE_UNAVAILABLE');
    assert.equal(h.state.committed, true, 'read-only COMMIT completed; its data is nevertheless withheld');
    assert.equal(h.state.calls.some(call => call.committed), false);
  }
});

test('lost COMMIT acknowledgment discards its connection and returns no metadata', async () => {
  const h = model({ beforeQuery(sql) { if (sql === 'COMMIT') throw Error('PRIVATE_COMMIT_ACK'); } });
  const result = await refused(h.reader.readIntakeLineage(intakeRequest()));
  assert.equal(h.state.discards, 1);
  assert.equal(h.state.releases, 0);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});

test('timed-out current authorization cannot resume later and read or commit data', async () => {
  let resolve;
  const h = model({ authority(input, state) {
    if (state.calls.length === 1) return new Promise(done => { resolve = () => done(decision(input, state.revision)); });
    return decision(input, state.revision);
  } });
  await refused(h.reader.readIntakeLineage(intakeRequest()));
  resolve(); await flush();
  assert.equal(h.state.connections, 0);
  assert.equal(h.state.queries.length, 0);
});

test('authority timeout while holding the partition gate rolls back once and cannot resume SQL', async () => {
  let resolve;
  let gateHeld = false;
  const h = model({
    afterQuery(sql) { if (sql.startsWith('SELECT pg_advisory_xact_lock')) gateHeld = true; },
    authority(input, state) {
      if (gateHeld && resolve === undefined) return new Promise(done => { resolve = () => done(decision(input, state.revision)); });
      return decision(input, state.revision);
    },
  });
  await refused(h.reader.readIntakeLineage(intakeRequest()));
  assert.equal(gateHeld, true);
  assert.equal(typeof resolve, 'function');
  assert.equal(h.state.queries.filter(row => row.sql === 'ROLLBACK').length, 1);
  assert.equal(h.state.releases, 1);
  assert.equal(h.state.discards, 0);
  const statements = h.state.queries.length;
  resolve(); await flush();
  assert.equal(h.state.queries.length, statements);
  assert.equal(h.state.dataReads, 0);
  assert.equal(h.state.committed, false);
  assert.equal(h.state.releases, 1);
});

test('pool acquisition timeout returns no data and releases a later client exactly once', async () => {
  let resolve;
  const h = model({ acquire(client) { return new Promise(done => { resolve = () => done(client); }); } });
  await refused(h.reader.readIntakeLineage(intakeRequest()));
  assert.equal(h.state.connections, 1);
  assert.equal(h.state.queries.length, 0);
  assert.equal(h.state.releases, 0);
  resolve(); await flush();
  assert.equal(h.state.releases, 1);
  assert.equal(h.state.discards, 0);
  assert.equal(h.state.queries.length, 0);
});
