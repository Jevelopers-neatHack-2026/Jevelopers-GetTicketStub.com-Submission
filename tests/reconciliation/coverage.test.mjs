import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import * as root from '@jevelopers/cost-intelligence';
import * as api from '@jevelopers/cost-intelligence/reconciliation';
import { suitePlan } from '../../scripts/suite-policy.mjs';
import { canonical, checked, clone, harness, hash, partition, readRequest, record, reference, refused, request, scope } from './coverage-fixtures.mjs';

test('CI-07 scoped coverage API is explicit v2 and public root/subpath agree', async () => {
  for (const name of ['startCoverageDryRun', 'getCoverageDryRun', 'getCoverageImportContentHash', 'createPostgresCoverageRunStore', 'CoverageDryRunRequestSchema', 'CoverageDryRunReadRequestSchema', 'CoverageDryRunPageSchema', 'CoverageImportRecordSchema']) assert.equal(root[name], api[name], name);
  const fixture = record(); const q = request([fixture]); const { ports, state } = harness([fixture]);
  const summary = await checked(root.startCoverageDryRun(q, ports));
  assert.equal(Value.Check(api.CoverageDryRunSummarySchema, summary), true);
  assert.equal(summary.status, 'needs_review'); assert.equal(summary.mode, 'coverage_only');
  assert.equal(summary.ruleVersion, 'ci07-coverage-1.0.0'); assert.equal(summary.financialEffects, false); assert.equal(summary.billingAuthority, false);
  assert.deepEqual(clone(summary.unavailableStages), { matching: 'unavailable', financialVariance: 'unavailable', apply: 'unavailable', settlement: 'unavailable' });
  assert.equal(state.writes, 1); assert.equal(state.sourceReads, 1);
  const page = await checked(root.getCoverageDryRun(readRequest(summary), ports));
  assert.equal(Value.Check(api.CoverageDryRunPageSchema, page), true); assert.equal(page.coverage.length, 1);
  for (const absent of ['knownVariance', 'matchedCount', 'settled', 'ledgerEvents', 'reservationRelease']) assert.equal(Object.hasOwn(page, absent), false);
  assert.equal(Object.isFrozen(page), true); assert.equal(Object.isFrozen(page.coverage[0].record.scope), true);
});

test('normalized import hash commits metadata independently of original artifact commitment', () => {
  const a = record(); const b = record({ retrievedAt: '2026-10-12T15:01:00.000Z' });
  assert.equal(a.sourceArtifactHash, b.sourceArtifactHash); assert.notEqual(reference(a).contentHash, reference(b).contentHash);
  assert.equal(api.getCoverageImportContentHash({ ...a, authenticated: true }).ok, false);
  assert.equal(api.getCoverageImportContentHash({ ...a, sourceArtifactHash: 'not-a-hash' }).ok, false);
  assert.equal(api.getCoverageImportContentHash({ ...a, cursorRef: 'https://provider.example/secret-token' }).ok, false);
});

test('same immutable input replays across request IDs, clock, source order and later reauthorized grant revision', async () => {
  const records = [record({ importId: 'import-z' }), record({ importId: 'import-a', currency: 'EUR' })];
  const { ports, state } = harness(records); const q = request(records);
  const first = await checked(root.startCoverageDryRun(q, ports));
  state.now = '2026-10-12T15:10:00.000Z'; state.revision = 'synthetic-grant-2';
  const second = await checked(root.startCoverageDryRun({ ...q, requestId: 'changed-transport', sourceSnapshots: [...q.sourceSnapshots].reverse() }, ports));
  assert.equal(canonical(first), canonical(second)); assert.equal(state.writes, 1);
  const committed = { ruleVersion: first.ruleVersion, scope: q.scope, windowStart: q.windowStart, windowEnd: q.windowEnd,
    sourceSnapshots: [...q.sourceSnapshots].sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0) };
  assert.equal(first.inputHash, hash(committed));
  assert.notEqual(first.inputHash, hash({ ...committed, ruleVersion: 'ci07-coverage-2.0.0' }));
  assert.equal(first.runId, hash({ scope: partition(q.scope), idempotencyKey: q.idempotencyKey }));
});

for (const status of ['no_data', 'delayed', 'incomplete', 'explicit_zero', 'failed', 'complete']) test(`coverage preserves ${status} without inventing financial zero`, async () => {
  const absent = ['no_data', 'delayed', 'failed'].includes(status);
  const fixture = record({ importId: 'import-' + status, retrievalStatus: status, recordCount: absent ? null : status === 'explicit_zero' ? 0 : status === 'incomplete' ? null : 2,
    sourceArtifactHash: absent ? null : hash('synthetic-artifact'), coverageStart: absent ? null : '2026-10-01T00:00:00.000Z', coverageEnd: absent ? null : status === 'incomplete' ? '2026-10-10T00:00:00.000Z' : '2026-11-01T00:00:00.000Z',
    zeroEvidenceRef: status === 'explicit_zero' ? 'synthetic-zero-receipt' : null });
  const { ports } = harness([fixture]); const summary = await checked(root.startCoverageDryRun(request([fixture]), ports));
  const page = await checked(root.getCoverageDryRun(readRequest(summary), ports));
  assert.equal(page.coverage[0].record.retrievalStatus, status); assert.equal(page.coverage[0].record.recordCount, fixture.recordCount);
  assert.equal(page.coverage[0].record.sourceArtifactHash, fixture.sourceArtifactHash);
  assert.equal(page.coverage[0].gaps.includes('incomplete_coverage'), !['explicit_zero', 'complete'].includes(status));
  assert.equal(page.status, 'needs_review'); assert.equal(page.billingAuthority, false);
});

test('explicit zero requires its own artifact, receipt and actual coverage, while absence cannot carry zero', () => {
  const zero = record({ retrievalStatus: 'explicit_zero', recordCount: 0, zeroEvidenceRef: 'synthetic-zero-receipt' });
  assert.equal(api.validateCoverageImportRecordBoundary(zero).ok, true);
  for (const change of [{ sourceArtifactHash: null }, { zeroEvidenceRef: null }, { coverageStart: null, coverageEnd: null }, { recordCount: null }]) assert.equal(api.validateCoverageImportRecordBoundary({ ...zero, ...change }).ok, false);
  for (const retrievalStatus of ['no_data', 'delayed', 'failed']) assert.equal(api.validateCoverageImportRecordBoundary(record({ retrievalStatus, recordCount: 0, coverageStart: null, coverageEnd: null })).ok, false);
  assert.equal(api.validateCoverageImportRecordBoundary(record({ recordCount: 0 })).ok, false);
});

test('unknown mappings/currency stay explicit; window, overlap and revision diagnostics are deterministic', async () => {
  const base = record();
  const records = [record({ importId: 'unknown', sourceAccountRef: null, sourceProjectRef: null, currency: null }),
    record({ importId: 'overlap-a', verificationStatus: 'verified' }), record({ importId: 'overlap-b', coverageStart: '2026-10-10T00:00:00.000Z' }),
    record({ importId: 'revision', revision: 2, predecessorHash: reference(base).contentHash, currency: 'EUR' })];
  const { ports } = harness(records);
  const summary = await checked(root.startCoverageDryRun(request(records, { windowStart: '2026-10-05T00:00:00.000Z', windowEnd: '2026-10-20T00:00:00.000Z' }), ports));
  const page = await checked(root.getCoverageDryRun(readRequest(summary, { pageSize: 100 }), ports));
  const find = id => page.coverage.find(entry => entry.record.importId === id);
  for (const gap of ['source_account_unknown', 'source_project_unknown', 'currency_unknown', 'source_not_verified']) assert.ok(find('unknown').gaps.includes(gap));
  assert.equal(find('unknown').gaps.includes('overlapping_coverage'), false);
  assert.ok(find('overlap-a').gaps.includes('overlapping_coverage')); assert.ok(find('overlap-b').gaps.includes('overlapping_coverage'));
  assert.equal(find('overlap-a').gaps.includes('source_not_verified'), false); assert.ok(find('revision').gaps.includes('revision_requires_review'));
  assert.ok(find('overlap-a').gaps.includes('outside_requested_window'));
});

test('source hash mismatch, foreign partition and duplicate immutable identities fail before writes', async () => {
  const a = record();
  for (const changed of [record({ recordCount: 3 }), record({ scope: partition(scope({ billingMode: 'live' })) }), { ...a, prompt: 'PRIVATE_CI07_CANARY' }]) {
    const { ports, state } = harness([a]); state.sourceHook = async () => ({ status: 'available', record: changed });
    const result = await refused(root.startCoverageDryRun(request([a]), ports), 'SOURCE_UNAVAILABLE');
    assert.equal(state.writes, 0); assert.equal(JSON.stringify(result).includes('PRIVATE_CI07_CANARY'), false);
  }
  const b = record({ recordCount: 3 }); const { ports, state } = harness([a, b]);
  await refused(root.startCoverageDryRun(request([a, b]), ports), 'IDEMPOTENCY_CONFLICT'); assert.equal(state.writes, 0);
  const duplicate = request([a]); duplicate.sourceSnapshots.push(clone(duplicate.sourceSnapshots[0]));
  await refused(root.startCoverageDryRun(duplicate, ports), 'VALIDATION_ERROR');
});

test('current authority rejects denied/absent/stale/wrong-grant decisions before source/store access', async () => {
  for (const kind of ['denied', 'absent', 'stale', 'wrong-grant', 'throws']) {
    const { ports, state } = harness();
    if (kind === 'denied') state.denied = true;
    if (kind === 'absent') delete ports.financeAuthority;
    if (kind === 'throws') ports.financeAuthority = { authorizeCurrent: async () => { throw new Error('PRIVATE_CI07_CANARY'); } };
    if (kind === 'stale' || kind === 'wrong-grant') {
      const original = ports.financeAuthority.authorizeCurrent;
      ports.financeAuthority.authorizeCurrent = async command => ({ ...await original(command), ...(kind === 'stale' ? { expiresAt: '2026-10-12T14:59:00.000Z' } : { permission: 'finance.budget.authorize' }) });
    }
    const result = await refused(root.startCoverageDryRun(request(), ports));
    assert.equal(state.sourceReads, 0); assert.equal(state.writes, 0); assert.equal(JSON.stringify(result).includes('PRIVATE_CI07_CANARY'), false);
  }
});

for (const change of ['deny', 'service_revision', 'principal_kind', 'membership_revision']) test(`source await renewal rejects ${change} and retained authority aliases`, async () => {
  const { ports, state } = harness();
  if (change === 'membership_revision') state.kind = 'user';
  const original = ports.coverageSource.resolve;
  state.sourceHook = null;
  ports.coverageSource.resolve = async (...args) => {
    const resolved = await original(...args);
    if (change === 'deny') state.denied = true;
    if (change === 'service_revision' || change === 'membership_revision') state.revision = 'synthetic-grant-changed';
    if (change === 'principal_kind') state.kind = 'user';
    return resolved;
  };
  await refused(root.startCoverageDryRun(request(), ports), 'FORBIDDEN_SCOPE'); assert.equal(state.writes, 0);
});

test('a mutable principal returned twice cannot rewrite the pinned initial grant', async () => {
  const { ports, state } = harness();
  let retained;
  const original = ports.financeAuthority.authorizeCurrent;
  ports.financeAuthority.authorizeCurrent = async command => retained ??= await original(command);
  state.sourceHook = async () => { retained.principal.serviceGrantRevision = 'rewritten-alias'; return { status: 'available', record: record() }; };
  await refused(root.startCoverageDryRun(request(), ports), 'FORBIDDEN_SCOPE'); assert.equal(state.writes, 0);
});

test('raw authority microtask rewrites cannot hide changing validated revisions or create a model write', async () => {
  const afterMicrotasks = (count, action) => {
    if (count === 0) action();
    else queueMicrotask(() => afterMicrotasks(count - 1, action));
  };
  // The zero-hop case is the unchanged-result control. Hops 2–4 reproduced the
  // reviewed validate-then-alias-capture bypass; later hops protect the boundary too.
  for (const hops of [0, 2, 3, 4, 5, 6]) {
    const { ports, state } = harness();
    const originalAuthority = ports.financeAuthority.authorizeCurrent;
    const rawDecisions = [];
    const returnedRevisions = [];
    ports.financeAuthority.authorizeCurrent = async command => {
      state.revision = `synthetic-valid-grant-${state.authorizationCalls + 1}`;
      const decision = await originalAuthority(command);
      rawDecisions.push(decision);
      returnedRevisions.push(decision.principal.serviceGrantRevision);
      if (hops > 0) afterMicrotasks(hops, () => { decision.principal.serviceGrantRevision = 'synthetic-retained-alias'; });
      return decision;
    };
    await refused(root.startCoverageDryRun(request(), ports), 'FORBIDDEN_SCOPE');
    assert.equal(state.writes, 0, `microtask hops=${hops} must not reach model writes`);
    assert.equal(state.authorizationCalls, 2, `microtask hops=${hops} must refuse the first revision change`);
    assert.deepEqual(returnedRevisions, ['synthetic-valid-grant-1', 'synthetic-valid-grant-2'], 'the authority actually returned changing valid revisions before retained alias rewrites');
    await new Promise(resolve => setImmediate(resolve));
    if (hops > 0) assert.ok(rawDecisions.every(decision => decision.principal.serviceGrantRevision === 'synthetic-retained-alias'), 'the fixture really rewrites each retained raw response');
  }
});

test('request/source/store snapshots stay detached across authorization awaits', async () => {
  const fixture = record(); const q = request([fixture]); const originalScope = clone(q.scope); const { ports, state } = harness([fixture]);
  const originalAuthority = ports.financeAuthority.authorizeCurrent;
  ports.financeAuthority.authorizeCurrent = async command => {
    const answer = await originalAuthority(command);
    if (state.authorizationCalls === 1) { q.scope.projectId = 'mutated-external-project'; q.idempotencyKey = 'mutated-key'; }
    if (state.authorizationCalls === 2) fixture.recordCount = 999;
    return answer;
  };
  const summary = await checked(root.startCoverageDryRun(q, ports));
  assert.equal(summary.runId, hash({ scope: partition(originalScope), idempotencyKey: 'synthetic-run-1' }));
  assert.equal(state.latestRun.coverage[0].record.recordCount, 2);
  const returned = clone(state.latestRun);
  ports.coverageStore.read = async () => returned;
  let calls = 0;
  ports.financeAuthority.authorizeCurrent = async command => { const answer = await originalAuthority(command); if (++calls === 2) returned.coverage[0].record.recordCount = 777; return answer; };
  const page = await checked(root.getCoverageDryRun(readRequest(summary), ports));
  assert.equal(page.coverage[0].record.recordCount, 2);
});

for (const stage of ['source', 'store-start', 'store-read']) for (const outcome of ['throws', 'malformed', 'unavailable']) test(`${stage} ${outcome} still renews and exposes no denied value`, async () => {
  const { ports, state } = harness(); let summary;
  if (stage === 'store-read') summary = await checked(root.startCoverageDryRun(request(), ports));
  const fault = async () => { state.denied = true; if (outcome === 'throws') throw new Error('PRIVATE_CI07_CANARY'); return outcome === 'malformed' ? { get secret() { throw new Error('PRIVATE_CI07_CANARY'); } } : stage === 'source' ? { status: 'unavailable' } : null; };
  if (stage === 'source') ports.coverageSource.resolve = fault;
  if (stage === 'store-start') ports.coverageStore.createOrReplay = fault;
  if (stage === 'store-read') ports.coverageStore.read = fault;
  const result = await refused(stage === 'store-read' ? root.getCoverageDryRun(readRequest(summary), ports) : root.startCoverageDryRun(request(), ports), 'FORBIDDEN_SCOPE');
  assert.equal(JSON.stringify(result).includes('PRIVATE_CI07_CANARY'), false);
});

test('store transaction authorization callback denies before a model write', async () => {
  const { ports, state } = harness(); state.storeHook = async () => { state.denied = true; };
  await refused(root.startCoverageDryRun(request(), ports), 'FORBIDDEN_SCOPE'); assert.equal(state.writes, 0);
});

test('a stalled authorization callback releases the model transaction; late resolution cannot insert or commit', async () => {
  const { ports, state } = harness(); const statements = []; let releases = 0; let discards = 0; let late;
  const originalAuthority = ports.financeAuthority.authorizeCurrent; let stall = false;
  ports.financeAuthority.authorizeCurrent = async command => {
    const decision = await originalAuthority(command);
    return stall ? new Promise(resolve => { late = () => resolve(decision); }) : decision;
  };
  ports.coverageStore = api.createPostgresCoverageRunStore({ connect: async () => ({
    query: async sql => {
      statements.push(sql);
      if (sql.includes('pg_advisory_xact_lock')) stall = true;
      if (sql.includes('AS restricted')) return { rows: [{ restricted: true }] };
      if (sql.includes('reconciliation_coverage_health')) return { rows: [{ migrations_ready: true }] };
      return { rows: [] };
    }, release: () => { releases++; }, discard: () => { discards++; },
  }) });
  const result = await refused(root.startCoverageDryRun(request(), ports), 'SOURCE_UNAVAILABLE'); assert.equal(result.error.retryable, true);
  assert.equal(releases, 1); assert.equal(discards, 0); assert.ok(statements.includes('ROLLBACK')); assert.equal(statements.some(sql => sql.startsWith('INSERT ') || sql === 'COMMIT'), false);
  const before = statements.length; late(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(statements.length, before); assert.equal(state.writes, 0);
});

test('timed-out pool acquisition releases a late model client exactly once without beginning a transaction', async () => {
  const { ports } = harness(); let deliver; let releases = 0; let discards = 0; let queries = 0;
  ports.coverageStore = api.createPostgresCoverageRunStore({ connect: () => new Promise(resolve => { deliver = resolve; }) });
  const result = await refused(root.startCoverageDryRun(request(), ports), 'SOURCE_UNAVAILABLE'); assert.equal(result.error.retryable, true);
  assert.equal(releases, 0); deliver({ query: async () => { queries++; return { rows: [] }; }, release: () => { releases++; }, discard: () => { discards++; } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(releases, 1); assert.equal(discards, 0); assert.equal(queries, 0);
});

test('safe adapter faults, missing runs and malformed persisted metadata never expose exception text or value', async () => {
  for (const fault of [async () => { throw new Error('PRIVATE_CI07_CANARY'); }, async () => null, async () => ({ unexpected: 'PRIVATE_CI07_CANARY' })]) {
    const { ports } = harness(); ports.coverageStore.read = fault;
    const result = await refused(root.getCoverageDryRun(readRequest({ runId: hash('absent') }), ports), 'SOURCE_UNAVAILABLE');
    assert.equal(JSON.stringify(result).includes('PRIVATE_CI07_CANARY'), false);
  }
  for (const change of [run => { run.coverage[0].record.recordCount = 999; }, run => { run.summary.status = 'complete'; }, run => { run.coverage[0].gaps = []; }, run => { run.private = 'PRIVATE_CI07_CANARY'; }]) {
    const { ports, state } = harness(); const summary = await checked(root.startCoverageDryRun(request(), ports)); change(state.latestRun);
    const result = await refused(root.getCoverageDryRun(readRequest(summary), ports), 'SOURCE_UNAVAILABLE'); assert.equal(JSON.stringify(result).includes('PRIVATE_CI07_CANARY'), false);
  }
});

test('stable pagination binds run, digest, page size, actor and canonical offset', async () => {
  const records = Array.from({ length: 5 }, (_, i) => record({ importId: 'page-' + i, currency: i % 2 ? 'EUR' : 'USD' }));
  const { ports } = harness(records); const summary = await checked(root.startCoverageDryRun(request(records), ports));
  const first = await checked(root.getCoverageDryRun(readRequest(summary), ports)); const second = await checked(root.getCoverageDryRun(readRequest(summary, { cursor: first.nextCursor }), ports));
  const third = await checked(root.getCoverageDryRun(readRequest(summary, { cursor: second.nextCursor }), ports));
  assert.equal(new Set([...first.coverage, ...second.coverage, ...third.coverage].map(entry => entry.record.importId)).size, 5); assert.equal(third.nextCursor, null);
  for (const change of [{ pageSize: 3, cursor: first.nextCursor }, { cursor: '0' + first.nextCursor }, { cursor: first.nextCursor.replace(/^2:/, '3:') }, { cursor: first.nextCursor.replace(/[a-f0-9]$/, value => value === 'a' ? 'b' : 'a') }]) await refused(root.getCoverageDryRun(readRequest(summary, change), ports), 'VALIDATION_ERROR');
  const other = harness(records, scope({ actorId: 'another-authorized-reader' })); other.ports.coverageStore = ports.coverageStore;
  await refused(root.getCoverageDryRun(readRequest(summary, { scope: scope({ actorId: 'another-authorized-reader' }), cursor: first.nextCursor }), other.ports), 'VALIDATION_ERROR');
});

test('valid TrustedScope actor references including @ are preserved exactly', async () => {
  const s = scope({ actorId: 'reviewer@example.test' }); const fixture = record(); const { ports } = harness([fixture], s);
  const summary = await checked(root.startCoverageDryRun(request([fixture], { scope: s }), ports));
  assert.equal(summary.ownerReference, s.actorId);
  assert.equal((await checked(root.getCoverageDryRun(readRequest(summary, { scope: s }), ports))).ownerReference, s.actorId);
});

test('bounded public snapshots reject sparse arrays, aliases with accessors, huge keys and aggregate oversized input before authority', async () => {
  const sparse = []; sparse[1_000_000_000] = 'small-allocation';
  const holes = Array(2); holes[1] = 'hole';
  const extra = []; extra.untrusted = 'extra';
  const getter = { get schemaVersion() { throw new Error('must-not-execute'); } };
  const oversized = Array.from({ length: 200 }, () => 'x'.repeat(4096));
  const key = { ['x'.repeat(129)]: 'bounded-key-failure' };
  for (const candidate of [sparse, holes, extra, getter, oversized, key, { ...request(), sourceSnapshots: sparse }]) {
    const { ports, state } = harness(); await refused(root.startCoverageDryRun(candidate, ports), 'VALIDATION_ERROR'); assert.equal(state.authorizationCalls, 0);
  }
});

test('unknown versions/windows/provider flags are refused and v1 remains unavailable', async () => {
  assert.equal(api.validateCoverageDryRunRequestBoundary({ ...request(), schemaVersion: '3.0.0' }).error.code, 'UNSUPPORTED_VERSION');
  for (const change of [{ mode: 'apply' }, { windowEnd: '2026-09-01T00:00:00.000Z' }, { providerAuthenticated: true }]) assert.equal(api.validateCoverageDryRunRequestBoundary({ ...request(), ...change }).ok, false);
  const { ports } = harness();
  const legacy = { schemaVersion: '1.0.0', requestId: 'legacy-request', idempotencyKey: 'legacy-key', scope: scope(),
    sourceSnapshots: [{ name: 'synthetic-source', revision: '1', contentHash: hash('source'), evidenceMode: 'mocked', verificationStatus: 'unverified' }],
    windowStart: '2026-10-01T00:00:00.000Z', windowEnd: '2026-11-01T00:00:00.000Z', pageSize: 2, requestedBy: 'synthetic-owner' };
  const legacyPorts = { ...ports, storage: { isAvailable: async () => true }, providerSource: { isAvailable: async () => true }, trustedContext: { resolve: async s => s } };
  await refused(root.startReconciliation(legacy, legacyPorts), 'RECONCILIATION_PENDING');
  await refused(root.getReconciliation(legacy, legacyPorts), 'RECONCILIATION_PENDING');
});

test('scoped coverage selector cannot satisfy the required full reconciliation/release leaf', async () => {
  const files = new Set(['tests/reconciliation/coverage.test.mjs', 'tests/reconciliation/coverage-pg.test.mjs']);
  assert.deepEqual(suitePlan('reconciliation', files, 'coverage').missingFiles, []);
  assert.deepEqual(suitePlan('reconciliation', files).missingFiles, ['tests/reconciliation/reconciliation.test.mjs']);
  assert.ok(suitePlan('release', files).missingFiles.includes('tests/reconciliation/reconciliation.test.mjs'));
  const migration = await readFile(new URL('../../migrations/0013_reconciliation_coverage_runs.sql', import.meta.url), 'utf8');
  assert.equal(/CREATE OR REPLACE VIEW\s+cost_intelligence\.foundation_health/i.test(migration), false);
});

// Synthetic SQL transport scheduling only. These controls do not qualify
// PostgreSQL durability, locks, RLS, or actual physical pool eviction.
function cleanupTransport(options = {}) {
  const h = harness();
  const state = { statements: [], connections: 0, releases: 0, discards: 0, inserts: 0, committed: false };
  const client = {
    release() { state.releases++; },
    discard() { state.discards++; },
    query(sql) {
      state.statements.push(sql);
      const selected = options.failure === 'query' ? sql.includes('reconciliation_coverage_health')
        : options.failure === 'insert' ? sql.startsWith('INSERT ')
          : sql === options.failure;
      if (selected) {
        // A later restored grant cannot erase the original denied operation;
        // cleanup failure must preserve its safe error rather than replace it.
        if (sql === 'ROLLBACK') h.state.denied = false;
        const error = new Error('PRIVATE_CI07_DRIVER_FAILURE');
        if (options.synchronous) throw error;
        return Promise.reject(error);
      }
      if (sql.startsWith('INSERT ')) {
        state.inserts++;
        if (options.denyAfterInsert) h.state.denied = true;
      }
      if (sql === 'COMMIT') state.committed = true;
      const rows = sql.includes('FROM pg_roles') ? [{ restricted: true }]
        : sql.includes('reconciliation_coverage_health') ? [{ migrations_ready: true }] : [];
      return Promise.resolve({ rows });
    },
  };
  if (options.noDiscard) delete client.discard;
  const database = { connect() {
    state.connections++;
    return options.acquire ? options.acquire(client) : Promise.resolve(client);
  } };
  h.ports.coverageStore = api.createPostgresCoverageRunStore(database);
  return { ...h, transport: state, client };
}

test('coverage cleanup normally releases a committed connection and a successfully rolled-back refusal', async () => {
  const completed = cleanupTransport();
  await checked(root.startCoverageDryRun(request(), completed.ports));
  assert.equal(completed.transport.committed, true);
  assert.equal(completed.transport.releases, 1);
  assert.equal(completed.transport.discards, 0);
  assert.equal(completed.transport.statements.includes('ROLLBACK'), false);

  const denied = cleanupTransport({ denyAfterInsert: true });
  await refused(root.startCoverageDryRun(request(), denied.ports), 'FORBIDDEN_SCOPE');
  assert.equal(denied.transport.inserts, 1, 'the denial occurs after a protected write');
  assert.equal(denied.transport.statements.at(-1), 'ROLLBACK');
  assert.equal(denied.transport.committed, false);
  assert.equal(denied.transport.releases, 1, 'successful rollback establishes clean cleanup');
  assert.equal(denied.transport.discards, 0);
});

for (const failure of ['BEGIN', 'query', 'insert', 'COMMIT', 'ROLLBACK']) {
  for (const synchronous of [false, true]) {
    test(`coverage cleanup discards after ${synchronous ? 'synchronous' : 'asynchronous'} ${failure} failure`, async () => {
      const h = cleanupTransport({ failure, synchronous, denyAfterInsert: failure === 'ROLLBACK' });
      const result = await refused(root.startCoverageDryRun(request(), h.ports), failure === 'ROLLBACK' ? 'FORBIDDEN_SCOPE' : 'SOURCE_UNAVAILABLE');
      assert.equal(JSON.stringify(result).includes('PRIVATE_CI07_DRIVER_FAILURE'), false);
      assert.equal(h.transport.releases, 0, 'uncertain transaction state cannot return to the pool');
      assert.equal(h.transport.discards, 1, 'the explicit physical discard capability must be selected exactly once');
      assert.equal(h.transport.committed, false);
      assert.equal(h.transport.statements.at(-1), 'ROLLBACK');
    });
  }
}

test('coverage cleanup requires discard capability before BEGIN', async () => {
  const h = cleanupTransport({ noDiscard: true });
  await refused(root.startCoverageDryRun(request(), h.ports), 'SOURCE_UNAVAILABLE');
  assert.equal(h.transport.connections, 1);
  assert.deepEqual(h.transport.statements, []);
  assert.equal(h.transport.releases, 1, 'the acquired idle connection can be released without starting work');
  assert.equal(h.transport.discards, 0);
});

test('coverage cleanup releases a late acquired idle connection exactly once without SQL', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveClient;
  const h = cleanupTransport({ acquire: client => new Promise(resolve => { resolveClient = () => resolve(client); }) });
  const pending = root.startCoverageDryRun(request(), h.ports);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof resolveClient, 'function');
  t.mock.timers.tick(5_001);
  await refused(pending, 'SOURCE_UNAVAILABLE');
  assert.equal(h.transport.releases, 0);
  assert.equal(h.transport.discards, 0);
  assert.deepEqual(h.transport.statements, []);
  resolveClient();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.transport.releases, 1);
  assert.equal(h.transport.discards, 0);
  assert.deepEqual(h.transport.statements, []);
});
