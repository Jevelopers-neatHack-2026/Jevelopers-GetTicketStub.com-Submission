import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createScopedReuseStore } from '../../../src/cache/reuse/store.mjs';
import { createCorrectionCacheBinding } from '../../../src/review/history/cache-binding.mjs';
import { createCorrectionHistoryStore, ReviewHistoryError } from '../../../src/review/history/store.mjs';

const EPOCH = Date.parse('2026-10-10T15:00:00.000Z');
const EVENT_ID = 'event-binding-001';
const CONTENT_HASH = 'a'.repeat(64);
const IDENTITY = Object.freeze({ occurrenceId: 'occurrence-binding-1', entityId: 'entity-binding-1', editionId: 'edition-binding-1' });
const PINS = Object.freeze({
  schemaVersion: 'profile-schema-1',
  extractorVersion: 'extractor-1',
  questionSetVersion: 'questions-1',
  policyHash: 'b'.repeat(64),
  modelVersion: 'model-1',
});
const TRUSTED_TOKEN = 'binding-test-server-context';

function request(tenantId = 'tenant-binding', actorId = 'actor-binding') {
  return Object.freeze({ principal: Object.freeze({ tenantId, actorId }), serverContextToken: TRUSTED_TOKEN });
}

function sourceEvidence(id, value) {
  return Object.freeze({ evidenceId: id, contentHash: createHash('sha256').update(value).digest('hex') });
}

function initialFacts() {
  return Object.freeze({
    event_name: Object.freeze({ status: 'sourced', value: 'Lantern Night', sourceEvidence: [sourceEvidence('event-name-source', 'Lantern Night')] }),
    event_date: Object.freeze({ status: 'missing' }),
    venue: Object.freeze({ status: 'conflicting', candidates: [
      Object.freeze({ originStatus: 'sourced', value: 'Civic Hall', sourceEvidence: [sourceEvidence('venue-a', 'Civic Hall')] }),
      Object.freeze({ originStatus: 'inferred', value: 'River Room', sourceEvidence: [sourceEvidence('venue-b', 'River Room')] }),
    ] }),
    event_status: Object.freeze({ status: 'sourced', value: 'scheduled', sourceEvidence: [sourceEvidence('event-status-source', 'scheduled')] }),
  });
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-correction-cache-binding-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const clock = { value: EPOCH };
  const permits = new WeakSet();
  const createPermit = () => {
    const permit = Object.freeze(Object.create(null));
    permits.add(permit);
    return permit;
  };
  const historyOptions = {
    directory: path.join(root, 'history'),
    resolveTenant: (value) => value?.principal?.tenantId,
    resolveActor: (value) => options.history?.resolveActor
      ? options.history.resolveActor(value) : value?.principal?.actorId,
    authorize({ tenantId, actorId, action, field, request: value }) {
      if (options.history?.authorize) return options.history.authorize({ tenantId, actorId, action, field, request: value });
      return value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === tenantId
        && value?.principal?.actorId === actorId && actorId !== 'outsider';
    },
    authorizeBoundary(input) {
      if (options.history?.authorizeBoundary) return options.history.authorizeBoundary(input);
      const allowed = input.request?.serverContextToken === TRUSTED_TOKEN
        && input.request?.principal?.tenantId === input.tenantId
        && input.request?.principal?.actorId === input.actorId && input.actorId !== 'outsider';
      return allowed ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
        eventId: input.eventId, action: input.action, field: input.field, nowMs: clock.value }) : false;
    },
    resolveKey({ tenantId, purpose, keyId }) {
      const resolvedId = `${purpose}-v1`;
      if (keyId && keyId !== resolvedId) throw new Error('synthetic history key unavailable');
      return { keyId: resolvedId, key: createHash('sha256').update(`${tenantId}:${purpose}:history-test-key`).digest() };
    },
    resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (options.history?.resolveRetention) return options.history.resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle });
      if (!['tenant-binding', 'tenant-other'].includes(tenantId) || !permits.has(retentionHandle)) throw new Error('synthetic history retention denied');
      return { expiresAtMs: Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
        policyId: 'synthetic-history-retention', policyVersion: '1', accessPolicy: 'tenant_private' };
    },
    lockedFields: ['event_status'],
    now: options.history?.now ?? (() => clock.value),
  };
  const cacheOptions = {
    directory: path.join(root, 'cache'),
    now: () => clock.value,
    resolveTenant: (value) => value?.principal?.tenantId,
    resolveActor: (value) => value?.principal?.actorId,
    authorizeAction({ tenantId, actorId, request: value }) {
      return value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === tenantId
        && value?.principal?.actorId === actorId && actorId !== 'outsider';
    },
    authorizeCurrentRequest({ expectedTenantId, expectedActorId, request: value }) {
      return value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === expectedTenantId
        && value?.principal?.actorId === expectedActorId && expectedActorId !== 'outsider';
    },
    authorizeBoundary(input) {
      if (options.cache?.authorizeBoundary) return options.cache.authorizeBoundary(input);
      const allowed = input.request?.serverContextToken === TRUSTED_TOKEN
        && input.request?.principal?.tenantId === input.tenantId
        && input.request?.principal?.actorId === input.actorId && input.actorId !== 'outsider';
      return allowed ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
        eventId: input.eventId, action: input.action, field: input.field, nowMs: clock.value }) : false;
    },
    resolveKey({ tenantId, scope, purpose, keyId }) {
      const resolvedId = `${scope}:${purpose}:${tenantId ?? 'global'}:v1`;
      if (keyId && keyId !== resolvedId) throw new Error('synthetic cache key unavailable');
      return { keyId: resolvedId, key: createHash('sha256').update(`${tenantId}:${scope}:${purpose}:cache-test-key`).digest() };
    },
    resolveRetention({ nowMs, requestedExpiryMs }) {
      return { expiresAtMs: Math.min(nowMs + 60_000, requestedExpiryMs ?? Number.MAX_SAFE_INTEGER),
        policyId: 'synthetic-cache-retention', policyVersion: '1' };
    },
    verifySourceObservation({ expectedContentHash, purpose, observation }) {
      return { status: 'body_changed', contentHash: expectedContentHash,
        retrievedAt: new Date(clock.value - 1_000).toISOString(), validatedAt: new Date(clock.value).toISOString(),
        attemptLineage: { status: 'unknown' } };
    },
    resolvePrivateProfileReferences({ contentHash }) {
      return { permissions: [{ reference: 'synthetic-private-permission', contentHash, version: 1, use: 'cache_read' }],
        sourceRefs: ['private-source-reference'], correctionRefs: ['private-correction-reference'] };
    },
    verifyPermission({ reference, contentHash, version, use }) {
      return { status: 'valid', reference, contentHash, version, use, validUntilMs: EPOCH + 60_000 };
    },
    resolveLineage: () => ({ status: 'unknown' }),
    resolveInvalidationConsumers: () => ['private-consumer-binding-test'],
    deliverInvalidation: async (event) => event,
    verifyInvalidationAcknowledgement: () => false,
    ...options.cache,
  };
  const authorizeBoundary = options.authorizeBoundary ?? ((input) => input.tenantId === 'tenant-binding'
    && input.request?.serverContextToken === TRUSTED_TOKEN && input.actorId !== 'outsider'
    ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
      eventId: input.eventId, action: input.action, field: input.field, nowMs: clock.value }) : false);
  const makeStore = (timeoutMs = options.operationTimeoutMs) => createCorrectionCacheBinding({ history: historyOptions, cache: cacheOptions,
    authorizeBoundary, operationTimeoutMs: timeoutMs });
  const store = makeStore();
  const authRequest = request();
  const scope = await store.scopeForAuthenticatedRequest(authRequest);
  return { root, clock, createPermit, makeStore, store, authRequest, scope, historyOptions, cacheOptions };
}

async function createSeed(f) {
  return f.store.createHistory(f.scope, { eventId: EVENT_ID, sourceFacts: initialFacts(),
    idempotencyKey: 'initialize-binding-event', retentionHandle: f.createPermit() }, f.authRequest);
}

function cacheProfile(options = {}) {
  return Object.freeze({
    identity: options.identity ?? IDENTITY,
    contentHash: options.contentHash ?? CONTENT_HASH,
    pins: PINS,
    facts: Object.freeze({ event_name: Object.freeze({ status: 'sourced', value: 'ignored input' }) }),
    observation: Object.freeze({ source: 'synthetic local observation' }),
    freshnessTtlMs: options.freshnessTtlMs ?? 30_000,
    expiresAtMs: options.expiresAtMs ?? EPOCH + 45_000,
  });
}

function lookup(options = {}) {
  return Object.freeze({ identity: options.identity ?? IDENTITY, contentHash: options.contentHash ?? CONTENT_HASH, pins: options.pins ?? PINS });
}

async function historyStoreFor(f, requestValue = f.authRequest) {
  const history = createCorrectionHistoryStore(f.historyOptions);
  const scope = await history.scopeForAuthenticatedRequest(requestValue);
  return { history, scope };
}

function runWorker(args) {
  const workerPath = path.resolve('tests/integration/review-cache-binding/worker.mjs');
  const child = spawn(process.execPath, [workerPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const exit = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, exit };
}

async function waitForFile(filePath, timeoutMs = 5_000) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    try { await access(filePath); return; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('worker did not reach its synchronization point');
}

function historyDatabasePath(root) {
  const tenantHash = createHash('sha256').update('event-intelligence:review-tenant:v1:tenant-binding').digest('hex');
  return path.join(root, 'history', tenantHash, 'history.sqlite');
}

function cacheDatabasePath(root) {
  return path.join(root, 'cache', 'scoped-reuse.sqlite');
}

function assertNoPendingBinding(root) {
  const database = new DatabaseSync(historyDatabasePath(root));
  try {
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correction_cache_state WHERE phase != 'complete'").get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM correction_cache_operations').get().count, 0);
  } finally { database.close(); }
}

async function waitForSignal(signal, label, timeoutMs = 3_000) {
  let timer;
  try {
    await Promise.race([
      signal,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

async function awaitWithTimeout(value, label, timeoutMs = 4_000) {
  let timer;
  try {
    return await Promise.race([
      value,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function withPhase(label, operation) {
  try { return await operation; }
  catch (error) { throw new Error(`${label}: ${error?.code ?? error?.message ?? error}`, { cause: error }); }
}

function interceptFinalBoundRead(onEntry) {
  const descriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'prepare');
  let reached = false;
  let restored = false;
  Object.defineProperty(DatabaseSync.prototype, 'prepare', {
    ...descriptor,
    value(sql, ...args) {
      if (!reached && String(sql).includes('SELECT * FROM reuse_entries WHERE entry_id')
        && new Error().stack.includes('finalBoundRead')) {
        reached = true;
        onEntry();
      }
      return Reflect.apply(descriptor.value, this, [sql, ...args]);
    },
  });
  return Object.freeze({
    reached: () => reached,
    restore() {
      if (restored) return;
      restored = true;
      Object.defineProperty(DatabaseSync.prototype, 'prepare', descriptor);
    },
  });
}

test('composed correction binds exact history provenance, invalidates cache locally, and keeps ACK status separate', async (t) => {
  const f = await fixture(t);
  const seeded = await createSeed(f);
  const bound = await f.store.bindPrivateProfile(f.scope, EVENT_ID, {
    idempotencyKey: 'bind-profile-1', profile: cacheProfile(),
  }, f.authRequest);
  assert.equal(bound.status, 'bound');
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'hit');

  const revised = await f.store.applyCorrection(f.scope, {
    eventId: EVENT_ID,
    baseVersionId: seeded.snapshot.versionId,
    baseContentHash: seeded.snapshot.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-20' },
    idempotencyKey: 'correct-date-1',
    retentionHandle: f.createPermit(),
  }, f.authRequest);
  assert.equal(revised.snapshot.revision, seeded.snapshot.revision + 1);
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'miss');
  const pending = await f.store.outboxSnapshot(f.scope, f.authRequest);
  assert.equal(pending.readiness, 'blocked_pending_external_ack');
  assert.equal(pending.pending > 0, true);
  const dispatched = await f.store.dispatchPendingInvalidations(f.scope, f.authRequest);
  assert.equal(dispatched.delivered, 0);
  assert.equal(dispatched.pending, true);
  const afterUnverifiedAck = await f.store.outboxSnapshot(f.scope, f.authRequest);
  assert.equal(afterUnverifiedAck.pending, pending.pending);
  assert.equal(afterUnverifiedAck.readiness, 'blocked_pending_external_ack');

  await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, request('tenant-other', 'actor-binding'), lookup()),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_DENIED');
  await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, request('tenant-binding', 'outsider'), lookup()),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_DENIED');
});

test('bind preflight honors the exact history expiry without extending earlier cache retention', async (t) => {
  const cases = [
    {
      name: 'profile expiry omitted',
      profile() {
        const { expiresAtMs, ...withoutExpiry } = cacheProfile();
        void expiresAtMs;
        return withoutExpiry;
      },
      requestedExpiryMs: EPOCH + 60_000,
      expectedExpiryMs: EPOCH + 60_000,
    },
    {
      name: 'profile expiry later than history',
      profile: () => cacheProfile({ expiresAtMs: EPOCH + 120_000 }),
      requestedExpiryMs: EPOCH + 60_000,
      expectedExpiryMs: EPOCH + 60_000,
    },
    {
      name: 'profile expiry earlier than history',
      profile: () => cacheProfile({ expiresAtMs: EPOCH + 45_000 }),
      requestedExpiryMs: EPOCH + 45_000,
      expectedExpiryMs: EPOCH + 45_000,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const requestedExpiries = [];
      const f = await fixture(subtest, { cache: {
        resolveRetention({ nowMs, requestedExpiryMs }) {
          requestedExpiries.push(requestedExpiryMs);
          return { expiresAtMs: Math.min(nowMs + 180_000, requestedExpiryMs ?? Number.MAX_SAFE_INTEGER),
            policyId: 'synthetic-long-cache-retention', policyVersion: '1' };
        },
      } });
      const seeded = await createSeed(f);
      const bound = await f.store.bindPrivateProfile(f.scope, EVENT_ID,
        { idempotencyKey: `bind-expiry-${scenario.name.replaceAll(' ', '-')}`, profile: scenario.profile() }, f.authRequest);
      assert.equal(bound.status, 'bound');
      assert.equal(bound.historyVersionId, seeded.snapshot.versionId);
      assert.equal(Date.parse(bound.expiresAt), scenario.expectedExpiryMs);
      assert.deepEqual(requestedExpiries, [scenario.requestedExpiryMs]);
      assert.equal((await f.store.getHistory(f.scope, EVENT_ID, f.authRequest)).versionId, seeded.snapshot.versionId);

      const cache = new DatabaseSync(cacheDatabasePath(f.root));
      const history = new DatabaseSync(historyDatabasePath(f.root));
      try {
        const entry = cache.prepare(`SELECT expires_at_ms, eligible FROM reuse_entries
          WHERE scope_kind = 'tenant_private'`).get();
        assert.equal(entry.expires_at_ms, scenario.expectedExpiryMs);
        assert.equal(entry.eligible, 1);
        const mapping = history.prepare('SELECT expires_at_ms, bound_version_id FROM correction_cache_bindings').get();
        assert.equal(mapping.expires_at_ms, scenario.expectedExpiryMs);
        assert.equal(mapping.bound_version_id, seeded.snapshot.versionId);
        const state = history.prepare('SELECT kind, phase FROM correction_cache_state').get();
        assert.deepEqual({ ...state }, { kind: 'bind', phase: 'complete' });
      } finally { cache.close(); history.close(); }
    });
  }
});

test('bind preflight rejects a TTL longer than effective history retention before creating a barrier', async (t) => {
  const f = await fixture(t, { cache: { resolveRetention({ nowMs, requestedExpiryMs }) {
    return { expiresAtMs: Math.min(nowMs + 180_000, requestedExpiryMs ?? Number.MAX_SAFE_INTEGER),
      policyId: 'synthetic-long-cache-retention', policyVersion: '1' };
  } } });
  const seeded = await createSeed(f);
  const invalidInput = { idempotencyKey: 'bind-ttl-over-history-expiry',
    profile: cacheProfile({ expiresAtMs: EPOCH + 120_000, freshnessTtlMs: 60_001 }) };
  await assert.rejects(f.store.bindPrivateProfile(f.scope, EVENT_ID, invalidInput, f.authRequest),
    (error) => error?.code === 'REUSE_INVALID');
  assertNoPendingBinding(f.root);
  assert.equal((await f.store.getHistory(f.scope, EVENT_ID, f.authRequest)).versionId, seeded.snapshot.versionId);
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'miss');

  const valid = await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-ttl-after-history-expiry-rejection', profile: cacheProfile({ expiresAtMs: EPOCH + 120_000 }) },
    f.authRequest);
  assert.equal(valid.status, 'bound');
  assert.equal(Date.parse(valid.expiresAt), EPOCH + 60_000);
});

test('bind preflight rejects a stale history base without writing a binding barrier', async (t) => {
  let gateNextRetention = false;
  let resolveRetentionStarted;
  let releaseRetention;
  const retentionStarted = new Promise((resolve) => { resolveRetentionStarted = resolve; });
  const retentionGate = new Promise((resolve) => { releaseRetention = resolve; });
  const f = await fixture(t, { cache: { async resolveRetention({ nowMs, requestedExpiryMs }) {
    if (gateNextRetention) {
      gateNextRetention = false;
      resolveRetentionStarted();
      await retentionGate;
    }
    return { expiresAtMs: Math.min(nowMs + 180_000, requestedExpiryMs ?? Number.MAX_SAFE_INTEGER),
      policyId: 'synthetic-long-cache-retention', policyVersion: '1' };
  } } });
  t.after(() => releaseRetention());
  const seeded = await createSeed(f);
  const input = { idempotencyKey: 'bind-stale-preflight-base',
    profile: cacheProfile({ expiresAtMs: EPOCH + 120_000 }) };
  gateNextRetention = true;
  const bindAttempt = f.store.bindPrivateProfile(f.scope, EVENT_ID, input, f.authRequest);
  await waitForSignal(retentionStarted, 'bind retention preflight after history snapshot');

  const corrected = await f.store.applyCorrection(f.scope, {
    eventId: EVENT_ID,
    baseVersionId: seeded.snapshot.versionId,
    baseContentHash: seeded.snapshot.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-26' },
    idempotencyKey: 'advance-history-during-bind-preflight',
    retentionHandle: f.createPermit(),
  }, f.authRequest);
  assert.equal(corrected.snapshot.revision, 2);
  releaseRetention();
  await assert.rejects(awaitWithTimeout(bindAttempt, 'stale bind base rejection'),
    (error) => error?.code === 'REVIEW_VERSION_CONFLICT');

  assert.equal((await f.store.getHistory(f.scope, EVENT_ID, f.authRequest)).versionId, corrected.snapshot.versionId);
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'miss');
  const history = new DatabaseSync(historyDatabasePath(f.root));
  try {
    const state = history.prepare('SELECT kind, phase FROM correction_cache_state').get();
    assert.deepEqual({ ...state }, { kind: 'correction', phase: 'complete' });
    assert.equal(history.prepare('SELECT COUNT(*) AS count FROM correction_cache_bindings').get().count, 0);
    assert.equal(history.prepare("SELECT COUNT(*) AS count FROM correction_cache_operations WHERE kind = 'bind'").get().count, 0);
  } finally { history.close(); }
  let cacheEntries = 0;
  try {
    await access(cacheDatabasePath(f.root));
    const cache = new DatabaseSync(cacheDatabasePath(f.root));
    try { cacheEntries = cache.prepare('SELECT COUNT(*) AS count FROM reuse_entries').get().count; }
    finally { cache.close(); }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  assert.equal(cacheEntries, 0);

  const retried = await f.store.bindPrivateProfile(f.scope, EVENT_ID, input, f.authRequest);
  assert.equal(retried.status, 'bound');
  assert.equal(retried.historyVersionId, corrected.snapshot.versionId);
});

test('invalid composed revision input is rejected before a durable barrier is created', async (t) => {
  const cases = [
    {
      name: 'locked field',
      kind: 'correction',
      input: (seeded, f) => ({ eventId: EVENT_ID, baseVersionId: seeded.versionId, baseContentHash: seeded.contentHash,
        field: 'event_status', value: 'cancelled', idempotencyKey: 'invalid-locked-status', retentionHandle: f.createPermit() }),
      code: 'REVIEW_FIELD_LOCKED',
    },
    {
      name: 'malformed date',
      kind: 'correction',
      input: (seeded, f) => ({ eventId: EVENT_ID, baseVersionId: seeded.versionId, baseContentHash: seeded.contentHash,
        field: 'event_date', value: { precision: 'date', value: '2027-02-30' },
        idempotencyKey: 'invalid-malformed-date', retentionHandle: f.createPermit() }),
      code: 'REVIEW_INVALID',
    },
    {
      name: 'malformed source facts',
      kind: 'refresh',
      input: (seeded, f) => ({ eventId: EVENT_ID, baseVersionId: seeded.versionId, baseContentHash: seeded.contentHash,
        sourceFacts: { event_name: { status: 'sourced', value: 'Bad fact', sourceEvidence: [] } },
        idempotencyKey: 'invalid-malformed-refresh', retentionHandle: f.createPermit() }),
      code: 'REVIEW_INVALID',
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const f = await fixture(subtest);
      const seeded = (await createSeed(f)).snapshot;
      const operation = scenario.kind === 'correction' ? f.store.applyCorrection : f.store.refreshSources;
      await assert.rejects(operation(f.scope, scenario.input(seeded, f), f.authRequest),
        (error) => error instanceof ReviewHistoryError && error.code === scenario.code);
      assertNoPendingBinding(f.root);
      assert.equal((await f.store.getHistory(f.scope, EVENT_ID, f.authRequest)).versionId, seeded.versionId);

      const reopened = f.makeStore();
      const reopenedScope = await reopened.scopeForAuthenticatedRequest(f.authRequest);
      assert.equal((await reopened.getHistory(reopenedScope, EVENT_ID, f.authRequest)).versionId, seeded.versionId);
      const corrected = await reopened.applyCorrection(reopenedScope, {
        eventId: EVENT_ID,
        baseVersionId: seeded.versionId,
        baseContentHash: seeded.contentHash,
        field: 'event_date',
        value: { precision: 'date', value: '2027-06-20' },
        idempotencyKey: `valid-after-${scenario.kind}-${scenario.name.replaceAll(' ', '-')}`,
        retentionHandle: f.createPermit(),
      }, f.authRequest);
      assert.equal(corrected.snapshot.revision, seeded.revision + 1);
    });
  }
});

test('invalid private bind identity or pins and rejected trusted observation leave history usable', async (t) => {
  const cases = [
    { name: 'missing identity coordinates', profile: () => ({ ...cacheProfile(), identity: { occurrenceId: 'only-one' } }), code: 'REUSE_INVALID' },
    { name: 'malformed policy pin', profile: () => ({ ...cacheProfile(), pins: { ...PINS, policyHash: 'bad' } }), code: 'REUSE_INVALID' },
    { name: 'malformed ignored caller facts', profile: () => ({ ...cacheProfile(), facts: { unexpected: 'fact' } }), code: 'REUSE_INVALID' },
    { name: 'trusted observation verifier rejects', profile: () => cacheProfile(), code: 'REUSE_POLICY_UNAVAILABLE', verifier: () => { throw new Error('synthetic verifier denial'); } },
    { name: 'trusted observation verifier returns malformed result', profile: () => cacheProfile(), code: 'REUSE_POLICY_UNAVAILABLE', verifier: () => ({ status: 'body_changed', contentHash: 'bad' }) },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const f = await fixture(subtest, scenario.verifier ? { cache: { verifySourceObservation: scenario.verifier } } : {});
      const seeded = (await createSeed(f)).snapshot;
      await assert.rejects(f.store.bindPrivateProfile(f.scope, EVENT_ID,
        { idempotencyKey: `invalid-${scenario.name.replaceAll(' ', '-')}`, profile: scenario.profile() }, f.authRequest),
      (error) => error?.code === scenario.code);
      assertNoPendingBinding(f.root);
      assert.equal((await f.store.getHistory(f.scope, EVENT_ID, f.authRequest)).versionId, seeded.versionId);

      const reopened = f.makeStore();
      const reopenedScope = await reopened.scopeForAuthenticatedRequest(f.authRequest);
      assert.equal((await reopened.getHistory(reopenedScope, EVENT_ID, f.authRequest)).versionId, seeded.versionId);
      const corrected = await reopened.applyCorrection(reopenedScope, {
        eventId: EVENT_ID,
        baseVersionId: seeded.versionId,
        baseContentHash: seeded.contentHash,
        field: 'event_date',
        value: { precision: 'date', value: '2027-06-21' },
        idempotencyKey: `valid-after-bind-${scenario.name.replaceAll(' ', '-')}`,
        retentionHandle: f.createPermit(),
      }, f.authRequest);
      assert.equal(corrected.snapshot.revision, seeded.revision + 1);
    });
  }
});

test('composed revisions reauthorize after a real SQLite writer conflict before any cache mutation', async (t) => {
  for (const scenario of [
    { kind: 'correction', action: 'apply_correction' },
    { kind: 'source refresh', action: 'refresh_source_facts' },
  ]) {
    await t.test(scenario.kind, async (subtest) => {
      let root;
      let requestValue;
      let operationHandle;
      let retentionCalls = 0;
      let armNextPreBeginPair = false;
      let preBeginPairRemaining = 0;
      let boundaryAttempts = 0;
      let writer;
      let writerAcquired = false;
      let writerAcquireError;
      let retryObservedSignalled = false;
      let resolveRetryObserved;
      const retryObserved = new Promise((resolve) => { resolveRetryObserved = resolve; });
      const closeWriter = () => {
        if (!writer) return;
        try { writer.exec('ROLLBACK'); } catch { /* It may already have rolled back. */ }
        try { writer.close(); } catch { /* It may already be closed. */ }
        writer = null;
      };
      const history = {
        resolveActor(value) {
          if (value === requestValue && value.principal.actorId === 'actor-revoked' && !retryObservedSignalled) {
            retryObservedSignalled = true;
            resolveRetryObserved();
          }
          return value?.principal?.actorId;
        },
        authorize({ tenantId, actorId, action, request: value }) {
          const matchesOperation = value === requestValue && action === scenario.action;
          if (matchesOperation && armNextPreBeginPair && preBeginPairRemaining === 0) {
            armNextPreBeginPair = false;
            preBeginPairRemaining = 2;
            try {
              writer = new DatabaseSync(historyDatabasePath(root));
              writer.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
              writerAcquired = true;
            } catch (error) {
              writerAcquireError = error;
            }
          }
          if (matchesOperation && preBeginPairRemaining > 0) {
            preBeginPairRemaining -= 1;
          }
          return value?.serverContextToken === TRUSTED_TOKEN
            && value?.principal?.tenantId === tenantId
            && value?.principal?.actorId === actorId
            && actorId !== 'outsider' && actorId !== 'actor-revoked';
        },
        authorizeBoundary(input) {
          const boundaryAction = scenario.action === 'apply_correction'
            ? 'review.history.apply_correction' : 'review.history.refresh_source_facts';
          if (input.request === requestValue && input.action === boundaryAction) {
            boundaryAttempts += 1;
            if (boundaryAttempts === 2) {
              requestValue.principal.actorId = 'actor-revoked';
              if (!retryObservedSignalled) {
                retryObservedSignalled = true;
                resolveRetryObserved();
              }
              return false;
            }
          }
          const allowed = input.request?.serverContextToken === TRUSTED_TOKEN
            && input.request?.principal?.tenantId === input.tenantId
            && input.request?.principal?.actorId === input.actorId && input.actorId !== 'outsider'
            && input.actorId !== 'actor-revoked';
          return allowed ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
            eventId: input.eventId, action: input.action, field: input.field, nowMs: EPOCH }) : false;
        },
        resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle }) {
          if (!retentionHandle || typeof retentionHandle !== 'object') throw new Error('synthetic history retention denied');
          if (retentionHandle === operationHandle) {
            retentionCalls += 1;
            if (retentionCalls === 2) armNextPreBeginPair = true;
          }
          return { expiresAtMs: Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
            policyId: 'synthetic-history-retention', policyVersion: '1', accessPolicy: 'tenant_private' };
        },
        now: () => EPOCH,
      };
      const f = await fixture(subtest, { history });
      subtest.after(() => {
        closeWriter();
        if (requestValue) requestValue.principal.actorId = 'actor-binding';
      });
      root = f.root;
      requestValue = { principal: { tenantId: 'tenant-binding', actorId: 'actor-binding' }, serverContextToken: TRUSTED_TOKEN };
      const scope = await f.store.scopeForAuthenticatedRequest(requestValue);
      const first = (await f.store.createHistory(scope, { eventId: EVENT_ID, sourceFacts: initialFacts(),
        idempotencyKey: `writer-revoke-${scenario.kind.replaceAll(' ', '-')}-seed`, retentionHandle: f.createPermit() }, requestValue)).snapshot;
      await f.store.bindPrivateProfile(scope, EVENT_ID,
        { idempotencyKey: `writer-revoke-${scenario.kind.replaceAll(' ', '-')}-bind`, profile: cacheProfile() }, requestValue);

      operationHandle = f.createPermit();
      const input = scenario.kind === 'correction'
        ? { eventId: EVENT_ID, baseVersionId: first.versionId, baseContentHash: first.contentHash,
          field: 'event_date', value: { precision: 'date', value: '2027-06-23' },
          idempotencyKey: 'writer-revoke-composed-correction', retentionHandle: operationHandle }
        : { eventId: EVENT_ID, baseVersionId: first.versionId, baseContentHash: first.contentHash,
          sourceFacts: { event_date: { status: 'sourced', value: { precision: 'date', value: '2027-06-24' },
            sourceEvidence: [sourceEvidence('writer-revoke-composed-refresh', '2027-06-24')] } },
          idempotencyKey: 'writer-revoke-composed-source-refresh', retentionHandle: operationHandle };
      const run = (store = f.store, operationScope = scope) => scenario.kind === 'correction'
        ? store.applyCorrection(operationScope, input, requestValue)
        : store.refreshSources(operationScope, input, requestValue);

      const historyBefore = new DatabaseSync(historyDatabasePath(f.root));
      let initialHistoryState;
      try {
        initialHistoryState = {
          head: historyBefore.prepare('SELECT version_id, revision FROM heads WHERE event_key IS NOT NULL').get(),
          versions: historyBefore.prepare('SELECT COUNT(*) AS count FROM versions').get().count,
          idempotency: historyBefore.prepare('SELECT COUNT(*) AS count FROM idempotency').get().count,
          invalidations: historyBefore.prepare('SELECT COUNT(*) AS count FROM invalidations').get().count,
        };
      } finally { historyBefore.close(); }
      const cacheBefore = new DatabaseSync(cacheDatabasePath(f.root));
      let initialCacheState;
      try {
        initialCacheState = {
          entry: cacheBefore.prepare(`SELECT version, eligible, payload_purged FROM reuse_entries WHERE binding_hash IS NOT NULL`).get(),
          reservations: cacheBefore.prepare('SELECT COUNT(*) AS count FROM reuse_correction_reservations').get().count,
          outbox: cacheBefore.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count,
          receipts: cacheBefore.prepare('SELECT COUNT(*) AS count FROM reuse_history_invalidation_ops').get().count,
        };
      } finally { cacheBefore.close(); }

      const rejected = await awaitWithTimeout(run(), `revoked composed ${scenario.kind} retry`)
        .then(() => null, (error) => error);
      assert.equal(rejected?.code, 'REVIEW_DENIED', JSON.stringify({
        code: rejected?.code,
        actorId: requestValue.principal.actorId,
        retentionCalls,
        armNextPreBeginPair,
        preBeginPairRemaining,
        boundaryAttempts,
        writerAcquired,
        writerAcquireError: writerAcquireError?.message,
        writerHeld: Boolean(writer),
        retryObservedSignalled,
      }));
      await waitForSignal(retryObserved, 'revoked composed revision retry authorization');
      assert.equal(boundaryAttempts, 2, 'the second synchronous guard follows the actual busy BEGIN retry');
      assert.equal(writerAcquired, true, writerAcquireError?.message);
      assert.equal(Boolean(writer), true);
      closeWriter();
      assert.equal(requestValue.principal.actorId, 'actor-revoked');

      const historyAfter = new DatabaseSync(historyDatabasePath(f.root));
      try {
        assert.deepEqual({
          head: historyAfter.prepare('SELECT version_id, revision FROM heads WHERE event_key IS NOT NULL').get(),
          versions: historyAfter.prepare('SELECT COUNT(*) AS count FROM versions').get().count,
          idempotency: historyAfter.prepare('SELECT COUNT(*) AS count FROM idempotency').get().count,
          invalidations: historyAfter.prepare('SELECT COUNT(*) AS count FROM invalidations').get().count,
        }, initialHistoryState);
        assert.equal(historyAfter.prepare("SELECT phase FROM correction_cache_state WHERE kind = ?").get(scenario.kind === 'correction' ? 'correction' : 'source_refresh').phase,
          'pending_correction');
      } finally { historyAfter.close(); }
      const cacheAfter = new DatabaseSync(cacheDatabasePath(f.root));
      try {
        assert.deepEqual({
          entry: cacheAfter.prepare(`SELECT version, eligible, payload_purged FROM reuse_entries WHERE binding_hash IS NOT NULL`).get(),
          reservations: cacheAfter.prepare('SELECT COUNT(*) AS count FROM reuse_correction_reservations').get().count,
          outbox: cacheAfter.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count,
          receipts: cacheAfter.prepare('SELECT COUNT(*) AS count FROM reuse_history_invalidation_ops').get().count,
        }, initialCacheState);
      } finally { cacheAfter.close(); }

      requestValue.principal.actorId = 'actor-binding';
      const reopened = f.makeStore();
      const reopenedScope = await reopened.scopeForAuthenticatedRequest(requestValue);
      const retried = await run(reopened, reopenedScope);
      assert.equal(retried.snapshot.revision, 2);
      const completeHistory = new DatabaseSync(historyDatabasePath(f.root));
      try {
        assert.equal(completeHistory.prepare("SELECT phase FROM correction_cache_state WHERE kind = ?")
          .get(scenario.kind === 'correction' ? 'correction' : 'source_refresh').phase, 'complete');
        assert.equal(completeHistory.prepare('SELECT COUNT(*) AS count FROM idempotency').get().count, initialHistoryState.idempotency + 1);
      } finally { completeHistory.close(); }
      const completeCache = new DatabaseSync(cacheDatabasePath(f.root));
      try {
        assert.equal(completeCache.prepare('SELECT eligible FROM reuse_entries WHERE binding_hash IS NOT NULL').get().eligible, 0);
        assert.equal(completeCache.prepare('SELECT COUNT(*) AS count FROM reuse_history_invalidation_ops').get().count, 1);
        assert.equal(completeCache.prepare('SELECT COUNT(*) AS count FROM reuse_outbox WHERE status = \'pending\'').get().count, 1);
      } finally { completeCache.close(); }
    });
  }
});

test('composed correction never invokes the configured history clock while holding its SQLite writer lock', async (t) => {
  let armed = false;
  let historyDatabasePath;
  const attempts = [];
  const f = await fixture(t, { history: { now() {
    if (armed) {
      const attempt = { result: 'writer acquired' };
      let database;
      try {
        database = new DatabaseSync(historyDatabasePath, { timeout: 0 });
        database.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
        database.exec('ROLLBACK');
      } catch (error) {
        attempt.result = 'writer rejected';
        attempt.errorCode = error?.code ?? null;
        attempt.errorMessage = String(error?.message ?? error);
      } finally {
        database?.close();
        attempts.push(attempt);
      }
    }
    return EPOCH;
  } } });
  const seeded = await createSeed(f);
  const tenantHash = createHash('sha256').update('event-intelligence:review-tenant:v1:tenant-binding').digest('hex');
  historyDatabasePath = path.join(f.historyOptions.directory, tenantHash, 'history.sqlite');
  armed = true;
  let revised;
  try {
    revised = await f.store.applyCorrection(f.scope, {
      eventId: EVENT_ID,
      baseVersionId: seeded.snapshot.versionId,
      baseContentHash: seeded.snapshot.contentHash,
      field: 'event_date',
      value: { precision: 'date', value: '2027-06-20' },
      idempotencyKey: 'clock-writer-guard-correction',
      retentionHandle: f.createPermit(),
    }, f.authRequest);
  } finally {
    armed = false;
  }

  assert.equal(revised.snapshot.revision, seeded.snapshot.revision + 1);
  assert.ok(attempts.length > 0, 'the injected clock was exercised during the composed correction');
  assert.deepEqual(attempts.filter((attempt) => attempt.result !== 'writer acquired'), []);
});

test('failed history binding context setup zeroes its acquired index key', async (t) => {
  const f = await fixture(t);
  await createSeed(f);
  const historyDirectory = f.historyOptions.directory;
  await rename(historyDirectory, `${historyDirectory}.preserved`);
  await writeFile(historyDirectory, 'regular file prevents tenant-directory setup');

  const originalFill = Buffer.prototype.fill;
  let contextKeyWasZeroed = false;
  Buffer.prototype.fill = function(value, ...args) {
    const contextBinding = value === 0 && this.byteLength === 32 && /bindingContext/.test(new Error().stack ?? '');
    const result = Reflect.apply(originalFill, this, [value, ...args]);
    if (contextBinding) contextKeyWasZeroed = this.every((byte) => byte === 0);
    return result;
  };
  try {
    await assert.rejects(f.store.getHistory(f.scope, EVENT_ID, f.authRequest),
      (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_STORAGE');
  } finally {
    Buffer.prototype.fill = originalFill;
  }
  assert.equal(contextKeyWasZeroed, true);
});

test('composed reads resolve only an exact issued binding and reject malformed mapping state', async (t) => {
  const f = await fixture(t);
  await createSeed(f);
  const unrelated = createScopedReuseStore(f.cacheOptions);
  const unrelatedScope = await unrelated.scopeForAuthenticatedRequest(f.authRequest);
  await unrelated.putPrivateProfile(unrelatedScope, f.authRequest, {
    ...cacheProfile(),
    facts: { event_name: { status: 'sourced', value: 'unbound arbitrary profile' } },
  });
  assert.deepEqual(await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()), { status: 'miss' });

  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-exact-issued-reference', profile: cacheProfile() }, f.authRequest);
  const exact = await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup());
  assert.equal(exact.status, 'hit');
  if (exact.status === 'hit') {
    assert.equal(exact.facts.event_name.value, 'Lantern Night');
    assert.notEqual(exact.facts.event_name.value, 'unbound arbitrary profile');
  }
  assert.deepEqual(await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest,
    { ...lookup(), contentHash: 'c'.repeat(64) }), { status: 'miss' });
  assert.deepEqual(await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest,
    { ...lookup(), pins: { ...PINS, extractorVersion: 'unrelated-pin' } }), { status: 'miss' });
  await assert.rejects(f.store.getPrivateProfile(f.scope, 'unrelated-event', f.authRequest, lookup()),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_NOT_FOUND');

  const history = new DatabaseSync(historyDatabasePath(f.root));
  try {
    const row = history.prepare('SELECT event_key, binding_hash, sealed FROM correction_cache_bindings LIMIT 1').get();
    history.prepare('UPDATE correction_cache_bindings SET sealed = ? WHERE event_key = ? AND binding_hash = ?')
      .run(Buffer.alloc(2), row.event_key, row.binding_hash);
  } finally { history.close(); }
  await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_INTEGRITY');
});

test('wrong cache version or history binding coordinates fail closed without revealing a cache hit', async (t) => {
  const f = await fixture(t);
  await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-corrupt-coordinates', profile: cacheProfile() }, f.authRequest);
  const cache = new DatabaseSync(cacheDatabasePath(f.root));
  const history = new DatabaseSync(historyDatabasePath(f.root));
  try {
    const entry = cache.prepare('SELECT entry_id, version FROM reuse_entries LIMIT 1').get();
    cache.prepare('UPDATE reuse_entries SET version = ? WHERE entry_id = ?').run(entry.version + 1, entry.entry_id);
    await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()),
      (error) => error?.code === 'REUSE_DENIED' && error.message === 'reuse access denied');
    cache.prepare('UPDATE reuse_entries SET version = ? WHERE entry_id = ?').run(entry.version, entry.entry_id);

    const binding = history.prepare('SELECT event_key, binding_hash, bound_version_id, bound_content_hash FROM correction_cache_bindings LIMIT 1').get();
    history.prepare('UPDATE correction_cache_bindings SET bound_version_id = ? WHERE event_key = ? AND binding_hash = ?')
      .run('unrelated-history-version', binding.event_key, binding.binding_hash);
    assert.deepEqual(await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()), { status: 'miss' });
    history.prepare('UPDATE correction_cache_bindings SET bound_version_id = ? WHERE event_key = ? AND binding_hash = ?')
      .run(binding.bound_version_id, binding.event_key, binding.binding_hash);

    history.prepare('UPDATE correction_cache_bindings SET bound_content_hash = ? WHERE event_key = ? AND binding_hash = ?')
      .run('d'.repeat(64), binding.event_key, binding.binding_hash);
    assert.deepEqual(await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()), { status: 'miss' });
  } finally { cache.close(); history.close(); }
});

test('history commit crash window keeps stale reads blocked and exact retry reconciles after reopen', async (t) => {
  let failKeyOnce = false;
  let indexCallsAfterFailure = 0;
  const f = await fixture(t, { cache: {
    resolveKey({ tenantId, scope, purpose, keyId }) {
      if (failKeyOnce && purpose === 'index') {
        indexCallsAfterFailure += 1;
        if (indexCallsAfterFailure === 2) {
          failKeyOnce = false;
          throw new Error('synthetic key outage after history commit');
        }
      }
      const resolvedId = `${scope}:${purpose}:${tenantId ?? 'global'}:v1`;
      if (keyId && keyId !== resolvedId) throw new Error('synthetic cache key unavailable');
      return { keyId: resolvedId, key: createHash('sha256').update(`${tenantId}:${scope}:${purpose}:cache-test-key`).digest() };
    },
  } });
  const seeded = await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-profile-recovery', profile: cacheProfile() }, f.authRequest);
  const input = {
    eventId: EVENT_ID,
    baseVersionId: seeded.snapshot.versionId,
    baseContentHash: seeded.snapshot.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-21' },
    idempotencyKey: 'correct-date-recover',
    retentionHandle: f.createPermit(),
  };
  failKeyOnce = true;
  await assert.rejects(f.store.applyCorrection(f.scope, input, f.authRequest),
    (error) => error?.code === 'REUSE_KEY_UNAVAILABLE');
  await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_BUSY');

  const reopened = f.makeStore();
  const scope = await reopened.scopeForAuthenticatedRequest(f.authRequest);
  const recovered = await reopened.applyCorrection(scope, input, f.authRequest);
  assert.equal(recovered.replayed, true);
  assert.equal((await reopened.getPrivateProfile(scope, EVENT_ID, f.authRequest, lookup())).status, 'miss');
  assert.equal((await reopened.outboxSnapshot(scope, f.authRequest)).readiness, 'blocked_pending_external_ack');
});

test('cache invalidation receipt prevents duplicate outbox rows after post-commit retry', async (t) => {
  let rejectAfterReceipt = true;
  const f = await fixture(t, { cache: {
    authorizeAction({ tenantId, actorId, action, request: value, details }) {
      if (rejectAfterReceipt && action === 'cache.invalidate' && typeof details?.profileRef === 'string') {
        try {
          const database = new DatabaseSync(cacheDatabasePath(f.root));
          try {
            const receipt = database.prepare('SELECT 1 AS found FROM reuse_history_invalidation_ops WHERE entry_id = ? LIMIT 1')
              .get(details.profileRef);
            if (receipt) rejectAfterReceipt = false;
            if (receipt) return false;
          } finally { database.close(); }
        } catch (error) { if (error?.code !== 'ERR_SQLITE_CANTOPEN') throw error; }
      }
      return value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === tenantId
        && value?.principal?.actorId === actorId && actorId !== 'outsider';
    },
  } });
  const seeded = await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-receipt-idempotence', profile: cacheProfile() }, f.authRequest);
  const input = {
    eventId: EVENT_ID,
    baseVersionId: seeded.snapshot.versionId,
    baseContentHash: seeded.snapshot.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-23' },
    idempotencyKey: 'correction-receipt-idempotence',
    retentionHandle: f.createPermit(),
  };
  await assert.rejects(f.store.applyCorrection(f.scope, input, f.authRequest), (error) => error?.code === 'REUSE_DENIED');
  assert.equal(rejectAfterReceipt, false);
  assert.equal((await f.store.outboxSnapshot(f.scope, f.authRequest)).pending, 1);
  const recovered = await f.store.applyCorrection(f.scope, input, f.authRequest);
  assert.equal(recovered.replayed, true);
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'miss');
  assert.equal((await f.store.outboxSnapshot(f.scope, f.authRequest)).pending, 1);
  const database = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_history_invalidation_ops').get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM reuse_outbox WHERE status != 'delivered'").get().count, 1);
  } finally { database.close(); }
});

test('real process death after history commit leaves a durable read barrier until exact retry', async (t) => {
  const f = await fixture(t);
  const seeded = await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-process-death', profile: cacheProfile() }, f.authRequest);
  const idempotencyKey = 'correction-process-death';
  const marker = path.join(f.root, 'cache-invalidation-entered');
  const worker = runWorker(['kill-after-history', f.root, EVENT_ID, seeded.snapshot.versionId,
    seeded.snapshot.contentHash, marker, idempotencyKey]);
  t.after(() => { if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL'); });
  await waitForFile(marker);
  const processResult = await worker.exit;
  assert.equal(processResult.signal, 'SIGKILL');
  assert.equal(await readFile(marker, 'utf8'), 'post-history cache invalidation callback');

  const database = new DatabaseSync(historyDatabasePath(f.root));
  try {
    const durable = database.prepare('SELECT phase, target_version_id FROM correction_cache_state WHERE event_key = (SELECT event_key FROM heads LIMIT 1)').get();
    const head = database.prepare('SELECT revision, version_id FROM heads LIMIT 1').get();
    assert.equal(durable.phase, 'history_committed');
    assert.equal(durable.target_version_id, head.version_id);
    assert.equal(head.revision, 2);
  } finally { database.close(); }
  await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_BUSY');

  const recovered = await f.store.applyCorrection(f.scope, {
    eventId: EVENT_ID,
    baseVersionId: seeded.snapshot.versionId,
    baseContentHash: seeded.snapshot.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-22' },
    idempotencyKey,
    retentionHandle: f.createPermit(),
  }, f.authRequest);
  assert.equal(recovered.replayed, true);
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'miss');
  assert.equal((await f.store.outboxSnapshot(f.scope, f.authRequest)).readiness, 'blocked_pending_external_ack');
});

test('real process death after cache invalidation commit replays its receipt without duplicate outbox work', async (t) => {
  const f = await fixture(t);
  const seeded = await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-cache-commit-crash', profile: cacheProfile() }, f.authRequest);
  const idempotencyKey = 'correction-cache-commit-crash';
  const marker = path.join(f.root, 'cache-commit-marker');
  const worker = runWorker(['kill-after-cache-commit', f.root, EVENT_ID, seeded.snapshot.versionId,
    seeded.snapshot.contentHash, marker, idempotencyKey]);
  t.after(() => { if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL'); });
  await waitForFile(marker);
  const processResult = await worker.exit;
  assert.equal(processResult.signal, 'SIGKILL');
  assert.equal(await readFile(marker, 'utf8'), 'post-cache-commit before history receipt');

  const history = new DatabaseSync(historyDatabasePath(f.root));
  const cache = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    const state = history.prepare('SELECT phase FROM correction_cache_state WHERE event_key = (SELECT event_key FROM heads LIMIT 1)').get();
    const binding = history.prepare('SELECT last_invalidation_operation_id FROM correction_cache_bindings LIMIT 1').get();
    const entry = cache.prepare('SELECT eligible FROM reuse_entries LIMIT 1').get();
    assert.equal(state.phase, 'history_committed');
    assert.equal(binding.last_invalidation_operation_id, null);
    assert.equal(entry.eligible, 0);
    assert.equal(cache.prepare('SELECT COUNT(*) AS count FROM reuse_history_invalidation_ops').get().count, 1);
    assert.equal(cache.prepare("SELECT COUNT(*) AS count FROM reuse_outbox WHERE status != 'delivered'").get().count, 1);
  } finally { history.close(); cache.close(); }
  await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_BUSY');

  const reopened = f.makeStore();
  const scope = await reopened.scopeForAuthenticatedRequest(f.authRequest);
  const recovered = await reopened.applyCorrection(scope, {
    eventId: EVENT_ID,
    baseVersionId: seeded.snapshot.versionId,
    baseContentHash: seeded.snapshot.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-22' },
    idempotencyKey,
    retentionHandle: f.createPermit(),
  }, f.authRequest);
  assert.equal(recovered.replayed, true);
  assert.equal((await reopened.getPrivateProfile(scope, EVENT_ID, f.authRequest, lookup())).status, 'miss');
  assert.equal((await reopened.outboxSnapshot(scope, f.authRequest)).pending, 1);
  const finalHistory = new DatabaseSync(historyDatabasePath(f.root));
  const finalCache = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    const state = finalHistory.prepare('SELECT phase FROM correction_cache_state WHERE event_key = (SELECT event_key FROM heads LIMIT 1)').get();
    const binding = finalHistory.prepare('SELECT last_invalidation_operation_id FROM correction_cache_bindings LIMIT 1').get();
    assert.equal(state.phase, 'complete');
    assert.equal(typeof binding.last_invalidation_operation_id, 'string');
    assert.equal(finalCache.prepare('SELECT COUNT(*) AS count FROM reuse_history_invalidation_ops').get().count, 1);
    assert.equal(finalCache.prepare("SELECT COUNT(*) AS count FROM reuse_outbox WHERE status != 'delivered'").get().count, 1);
  } finally { finalHistory.close(); finalCache.close(); }
});

test('composed correction waits out a real cross-process SQLite writer lock', async (t) => {
  const f = await fixture(t);
  const seeded = await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-cross-process-writer', profile: cacheProfile() }, f.authRequest);
  const marker = path.join(f.root, 'cross-process-ready');
  const database = new DatabaseSync(historyDatabasePath(f.root));
  database.exec('PRAGMA busy_timeout = 0');
  database.exec('BEGIN IMMEDIATE');
  let locked = true;
  const release = () => {
    if (!locked) return;
    locked = false;
    database.exec('ROLLBACK');
    database.close();
  };
  t.after(release);
  const worker = runWorker(['compete', f.root, EVENT_ID, seeded.snapshot.versionId,
    seeded.snapshot.contentHash, marker, 'correction-cross-process-writer']);
  t.after(() => { if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL'); });
  await waitForFile(marker);
  await new Promise((resolve) => setTimeout(resolve, 30));
  release();
  const processResult = await worker.exit;
  assert.equal(processResult.signal, null, processResult.stderr);
  assert.equal(processResult.code, 0, processResult.stderr);
  assert.deepEqual(JSON.parse(processResult.stdout), { outcome: 'committed', revision: 2 });
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'miss');
});

test('refreshSources invalidates the exact cache binding even when source alternatives are retained', async (t) => {
  const f = await fixture(t);
  const seeded = await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-source-refresh', profile: cacheProfile() }, f.authRequest);
  const refreshed = await f.store.refreshSources(f.scope, {
    eventId: EVENT_ID,
    baseVersionId: seeded.snapshot.versionId,
    baseContentHash: seeded.snapshot.contentHash,
    sourceFacts: { event_name: { status: 'sourced', value: 'Lantern Evening', sourceEvidence: [sourceEvidence('name-refresh', 'Lantern Evening')] } },
    idempotencyKey: 'refresh-source-binding',
    retentionHandle: f.createPermit(),
  }, f.authRequest);
  assert.equal(refreshed.snapshot.revision, seeded.snapshot.revision + 1);
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'miss');
  const pending = await f.store.outboxSnapshot(f.scope, f.authRequest);
  assert.equal(pending.readiness, 'blocked_pending_external_ack');
  assert.equal(pending.pending > 0, true);
});

test('outbox capacity refusal leaves the binding barred and exact retry succeeds after capacity is restored', async (t) => {
  const f = await fixture(t, { cache: { maxOutboxEntries: 1 } });
  await createSeed(f);
  const input = { idempotencyKey: 'bind-capacity-retry', profile: cacheProfile() };
  await assert.rejects(f.store.bindPrivateProfile(f.scope, EVENT_ID, input, f.authRequest),
    (error) => error?.code === 'REUSE_CAPACITY');
  await assert.rejects(f.store.getHistory(f.scope, EVENT_ID, f.authRequest),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_BUSY');
  f.cacheOptions.maxOutboxEntries = 8;
  const reopened = f.makeStore();
  const scope = await reopened.scopeForAuthenticatedRequest(f.authRequest);
  const bound = await reopened.bindPrivateProfile(scope, EVENT_ID, input, f.authRequest);
  assert.equal(bound.status, 'bound');
  assert.equal((await reopened.getPrivateProfile(scope, EVENT_ID, f.authRequest, lookup())).status, 'hit');
});

test('pending bind fence checks history expiry after the paired cache commit and exact retry reconciles', async (t) => {
  let f;
  let armed = false;
  let cacheBoundaryReached = false;
  let cacheCommitCompleted = false;
  let historyCommitAttempted = false;
  f = await fixture(t, { cache: {
    authorizeBoundary(input) {
      if (armed && input.action === 'cache.private_profile.bind') cacheBoundaryReached = true;
      const allowed = input.request?.serverContextToken === TRUSTED_TOKEN
        && input.request?.principal?.tenantId === input.tenantId
        && input.request?.principal?.actorId === input.actorId && input.actorId !== 'outsider';
      return allowed ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
        eventId: input.eventId, action: input.action, field: input.field, nowMs: f.clock.value }) : false;
    },
  } });
  await createSeed(f);
  f.clock.value = EPOCH + 59_000;
  const bindingInput = { idempotencyKey: 'pending-bind-fence-expiry',
    profile: cacheProfile({ expiresAtMs: EPOCH + 120_000, freshnessTtlMs: 500 }) };

  const databaseKinds = new WeakMap();
  const prepareDescriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'prepare');
  const execDescriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'exec');
  let restored = false;
  Object.defineProperty(DatabaseSync.prototype, 'prepare', {
    ...prepareDescriptor,
    value(sql, ...args) {
      const statement = Reflect.apply(prepareDescriptor.value, this, [sql, ...args]);
      const query = String(sql);
      if (/correction_cache_(?:state|meta|bindings)|\bFROM heads\b/.test(query)) databaseKinds.set(this, 'history');
      else if (/\breuse_(?:meta|entries|bound_writes|correction_reservations)\b/.test(query)) databaseKinds.set(this, 'cache');
      return statement;
    },
  });
  Object.defineProperty(DatabaseSync.prototype, 'exec', {
    ...execDescriptor,
    value(sql, ...args) {
      if (armed && sql === 'COMMIT' && databaseKinds.get(this) === 'cache'
        && cacheBoundaryReached && !cacheCommitCompleted) {
        const result = Reflect.apply(execDescriptor.value, this, [sql, ...args]);
        cacheCommitCompleted = true;
        const deadline = process.hrtime.bigint() + 1_100_000_000n;
        while (process.hrtime.bigint() < deadline) { /* Cache committed; let the pending history head expire before its paired COMMIT. */ }
        return result;
      }
      if (armed && sql === 'COMMIT' && databaseKinds.get(this) === 'history' && cacheCommitCompleted) {
        historyCommitAttempted = true;
      }
      return Reflect.apply(execDescriptor.value, this, [sql, ...args]);
    },
  });
  const restore = () => {
    if (restored) return;
    restored = true;
    Object.defineProperty(DatabaseSync.prototype, 'prepare', prepareDescriptor);
    Object.defineProperty(DatabaseSync.prototype, 'exec', execDescriptor);
  };
  t.after(restore);
  armed = true;
  let firstAttemptError;
  try {
    try { await f.store.bindPrivateProfile(f.scope, EVENT_ID, bindingInput, f.authRequest); }
    catch (error) { firstAttemptError = error; }
  } finally { restore(); }

  assert.equal(cacheBoundaryReached, true,
    `the exact cache participant guard ran; first error ${firstAttemptError?.code ?? 'success'}`);
  assert.equal(cacheCommitCompleted, true, 'the paired cache transaction committed before history fence validation');
  assert.equal(historyCommitAttempted, false, 'pending-bind expiry prevented the paired history COMMIT');
  const history = new DatabaseSync(historyDatabasePath(f.root));
  const cache = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(history.prepare("SELECT phase FROM correction_cache_state WHERE kind = 'bind'").get().phase, 'pending_bind');
    assert.equal(history.prepare('SELECT COUNT(*) AS count FROM correction_cache_bindings').get().count, 0);
    assert.equal(cache.prepare("SELECT COUNT(*) AS count FROM reuse_entries WHERE scope_kind = 'tenant_private'").get().count, 1);
    assert.equal(cache.prepare('SELECT COUNT(*) AS count FROM reuse_bound_writes').get().count, 1);
  } finally { history.close(); cache.close(); }
  await assert.rejects(f.store.getHistory(f.scope, EVENT_ID, f.authRequest),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_BUSY');

  const retried = await f.store.bindPrivateProfile(f.scope, EVENT_ID, bindingInput, f.authRequest);
  assert.equal(retried.status, 'bound');
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'hit');
  const finalHistory = new DatabaseSync(historyDatabasePath(f.root));
  try {
    assert.equal(finalHistory.prepare('SELECT phase FROM correction_cache_state WHERE kind = \'bind\'').get().phase, 'complete');
    assert.equal(finalHistory.prepare('SELECT COUNT(*) AS count FROM correction_cache_operations').get().count, 1);
    assert.equal(finalHistory.prepare('SELECT COUNT(*) AS count FROM correction_cache_bindings').get().count, 1);
  } finally { finalHistory.close(); }
  const finalCache = new DatabaseSync(cacheDatabasePath(f.root));
  try { assert.equal(finalCache.prepare('SELECT COUNT(*) AS count FROM reuse_entries').get().count, 1); }
  finally { finalCache.close(); }
});

test('timed-out binding callback cannot commit after an exact retry advances the fence', async (t) => {
  let observationCalls = 0;
  let initialRequest;
  let resolveObservationStarted;
  let releaseFirstObservation;
  let resolveOldContinuation;
  let oldObservationReleased = false;
  const observationStarted = new Promise((resolve) => { resolveObservationStarted = resolve; });
  const firstObservation = new Promise((resolve) => { releaseFirstObservation = resolve; });
  const oldContinuation = new Promise((resolve) => { resolveOldContinuation = resolve; });
  t.after(() => releaseFirstObservation());
  const f = await fixture(t, { operationTimeoutMs: 500, cache: {
    async verifySourceObservation({ expectedContentHash, request: value }) {
      observationCalls += 1;
      if (observationCalls === 1) {
        resolveObservationStarted();
        await firstObservation;
        oldObservationReleased = true;
      }
      return { status: 'body_changed', contentHash: expectedContentHash,
        retrievedAt: new Date(EPOCH - 1_000).toISOString(), validatedAt: new Date(EPOCH).toISOString(),
        attemptLineage: { status: 'unknown' } };
    },
    authorizeAction({ request: value }) {
      if (value === initialRequest && oldObservationReleased) resolveOldContinuation();
      return value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === 'tenant-binding'
        && value?.principal?.actorId === 'actor-binding';
    },
  } });
  await createSeed(f);
  initialRequest = f.authRequest;
  const idempotencyKey = 'bind-late-observation';
  const input = { idempotencyKey, profile: cacheProfile() };
  const initialAttempt = f.store.bindPrivateProfile(f.scope, EVENT_ID, input, f.authRequest);
  const initialRejection = assert.rejects(initialAttempt,
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_ABORTED');
  await waitForSignal(observationStarted, 'first private source observation callback');
  await withPhase('first timed-out bind rejection', initialRejection);

  // The 500ms deadline is the intentional first-attempt fault. Exact recovery gets a
  // separate bounded budget so host scheduling does not turn recovery into a second timeout.
  const recoveryStore = f.makeStore(2_000);
  const recoveryScope = await recoveryStore.scopeForAuthenticatedRequest(request());
  const retried = await withPhase('exact retry bind', recoveryStore.bindPrivateProfile(recoveryScope, EVENT_ID, input, request()));
  assert.equal(retried.status, 'bound');
  releaseFirstObservation();
  await withPhase('late callback continuation guard', waitForSignal(oldContinuation, 'late callback continuation guard'));
  const finalRead = await withPhase('read after late callback', recoveryStore.getPrivateProfile(recoveryScope, EVENT_ID, request(), lookup()));
  assert.equal(finalRead.status, 'hit');
  const database = new DatabaseSync(path.join(f.root, 'cache', 'scoped-reuse.sqlite'));
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_entries').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_entries WHERE eligible = 1').get().count, 1);
  } finally { database.close(); }
});

test('cancelled correction callback cannot commit after an exact retry takes over the history fence', async (t) => {
  let blockSecondRetention = false;
  let retentionCalls = 0;
  let releaseBlockedRetention;
  let resolveBlockedEntry;
  let resolveBlockedCompletion;
  const blockedEntry = new Promise((resolve) => { resolveBlockedEntry = resolve; });
  const blockedCompletion = new Promise((resolve) => { resolveBlockedCompletion = resolve; });
  const retentionFor = (nowMs, sourceExpiresAtMs) => ({
    expiresAtMs: Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
    policyId: 'synthetic-history-retention',
    policyVersion: '1',
    accessPolicy: 'tenant_private',
  });
  const f = await fixture(t, { operationTimeoutMs: 500, history: {
    resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (tenantId !== 'tenant-binding' || !retentionHandle) throw new Error('synthetic history retention denied');
      retentionCalls += 1;
      if (blockSecondRetention && retentionCalls === 2) {
        resolveBlockedEntry();
        return new Promise((resolve) => {
          releaseBlockedRetention = () => {
            resolve(retentionFor(nowMs, sourceExpiresAtMs));
            resolveBlockedCompletion();
          };
        });
      }
      return retentionFor(nowMs, sourceExpiresAtMs);
    },
  } });
  const seeded = await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-cancelled-correction', profile: cacheProfile() }, f.authRequest);
  blockSecondRetention = true;
  retentionCalls = 0;
  const input = {
    eventId: EVENT_ID,
    baseVersionId: seeded.snapshot.versionId,
    baseContentHash: seeded.snapshot.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-24' },
    idempotencyKey: 'correction-cancelled-before-inner-commit',
    retentionHandle: f.createPermit(),
  };
  t.after(() => releaseBlockedRetention?.());
  const firstAttempt = f.store.applyCorrection(f.scope, input, f.authRequest);
  const rejected = assert.rejects(firstAttempt,
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_ABORTED');
  await waitForSignal(blockedEntry, 'second correction retention decision');
  await rejected;
  await assert.rejects(f.store.getHistory(f.scope, EVENT_ID, f.authRequest),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_BUSY');

  blockSecondRetention = false;
  const recovered = await f.store.applyCorrection(f.scope, input, f.authRequest);
  assert.equal(recovered.snapshot.revision, seeded.snapshot.revision + 1);
  assert.equal(recovered.replayed, false);
  releaseBlockedRetention();
  await waitForSignal(blockedCompletion, 'late retention callback completion');
  await new Promise((resolve) => setTimeout(resolve, 30));

  const history = new DatabaseSync(historyDatabasePath(f.root));
  const cache = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    const head = history.prepare('SELECT revision, version_id FROM heads LIMIT 1').get();
    assert.equal(head.revision, seeded.snapshot.revision + 1);
    assert.equal(head.version_id, recovered.snapshot.versionId);
    assert.equal(history.prepare('SELECT COUNT(*) AS count FROM correction_cache_operations WHERE target_version_id IS NOT NULL').get().count, 2);
    assert.equal(cache.prepare('SELECT COUNT(*) AS count FROM reuse_history_invalidation_ops').get().count, 1);
    assert.equal(cache.prepare("SELECT COUNT(*) AS count FROM reuse_outbox WHERE status != 'delivered'").get().count, 1);
  } finally { history.close(); cache.close(); }
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'miss');
});

test('final synchronous boundary permit is current and permission expiry is resampled afterward', async (t) => {
  let authorized = true;
  const f = await fixture(t, {
    authorizeBoundary(input) {
      assert.equal(input.details.permissionValidUntilMs, EPOCH + 500);
      if (!authorized) return false;
      f.clock.value = EPOCH + 500;
      return Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
        eventId: input.eventId, action: input.action, field: input.field, nowMs: f.clock.value });
    },
    cache: {
      verifyPermission({ reference, contentHash, version, use }) {
        return { status: 'valid', reference, contentHash, version, use, validUntilMs: EPOCH + 500 };
      },
    },
  });
  const seeded = await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-final-guard', profile: cacheProfile() }, f.authRequest);
  assert.deepEqual(await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()),
    { status: 'unavailable', reason: 'expired' });
  f.clock.value = EPOCH;
  authorized = false;
  await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_DENIED');
  void seeded;
});

test('final composed cache read denies disclosure when permission expires during synchronous SQLite work', async (t) => {
  let readGuardReached = false;
  const f = await fixture(t, {
    authorizeBoundary(input) {
      if (input.action === 'private_profile.read') readGuardReached = true;
      return input.tenantId === 'tenant-binding'
        && input.request?.serverContextToken === TRUSTED_TOKEN
        && input.request?.principal?.tenantId === input.tenantId
        && input.request?.principal?.actorId === input.actorId && input.actorId !== 'outsider'
        ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
          eventId: input.eventId, action: input.action, field: input.field, nowMs: EPOCH }) : false;
    },
    cache: { verifyPermission({ reference, contentHash, version, use }) {
      return { status: 'valid', reference, contentHash, version, use, validUntilMs: EPOCH + 60 };
    } },
  });
  await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-final-read-expiry', profile: cacheProfile() }, f.authRequest);

  const interception = interceptFinalBoundRead(() => {
    const deadline = process.hrtime.bigint() + 160_000_000n;
    while (process.hrtime.bigint() < deadline) { /* Exercise the real synchronous SQLite read boundary. */ }
  });
  t.after(interception.restore);
  let result;
  let error;
  try {
    result = await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup());
  } catch (caught) { error = caught; }
  finally { interception.restore(); }
  assert.equal(readGuardReached, true, 'the required final synchronous boundary guard ran');
  assert.equal(interception.reached(), true, 'the delay occurred inside finalBoundRead after the guard');
  assert.notEqual(result?.status, 'hit', `expired permission must not disclose a profile (error ${error?.code ?? 'none'})`);
});

test('final composed cache read honors a genuine abort during synchronous SQLite work', async (t) => {
  const f = await fixture(t);
  await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-final-read-abort', profile: cacheProfile() }, f.authRequest);
  const controller = new AbortController();
  const interception = interceptFinalBoundRead(() => controller.abort());
  t.after(interception.restore);
  let error;
  try {
    await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup(), 'cache_read', { signal: controller.signal });
  } catch (caught) { error = caught; }
  finally { interception.restore(); }
  assert.equal(interception.reached(), true, 'abort occurred during the final cache read, not during setup');
  assert.equal(error?.code, 'REVIEW_ABORTED');
});

test('revoked current permission fails closed before a bound profile can be disclosed', async (t) => {
  let revoked = false;
  const f = await fixture(t, { cache: {
    verifyPermission({ reference, contentHash, version, use }) {
      if (revoked) return 'revoked';
      return { status: 'valid', reference, contentHash, version, use, validUntilMs: EPOCH + 60_000 };
    },
  } });
  await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-revoked-permission', profile: cacheProfile() }, f.authRequest);
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'hit');
  revoked = true;
  await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()),
    (error) => error?.code === 'REUSE_DENIED' && error.message === 'reuse access denied');
});

test('composed cancellation reads genuine AbortSignal state through captured intrinsics', async (t) => {
  const f = await fixture(t);
  await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-abort-signal', profile: cacheProfile() }, f.authRequest);

  const activeController = new AbortController();
  Object.defineProperty(activeController.signal, 'aborted', { configurable: true, value: true });
  Object.defineProperty(activeController.signal, 'addEventListener', { configurable: true, value() { throw new Error('own override'); } });
  Object.defineProperty(activeController.signal, 'removeEventListener', { configurable: true, value() { throw new Error('own override'); } });
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup(), undefined,
    { signal: activeController.signal })).status, 'hit');

  const abortedController = new AbortController();
  abortedController.abort();
  Object.defineProperty(abortedController.signal, 'aborted', { configurable: true, value: false });
  Object.defineProperty(abortedController.signal, 'addEventListener', { configurable: true, value() {} });
  await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup(), undefined,
    { signal: abortedController.signal }),
  (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_ABORTED');
});

test('asynchronous and hostile final boundary permits fail closed without thenable property access', async (t) => {
  const asyncFixture = await fixture(t, { authorizeBoundary: async () => true });
  await createSeed(asyncFixture);
  await asyncFixture.store.bindPrivateProfile(asyncFixture.scope, EVENT_ID,
    { idempotencyKey: 'bind-async-final-guard', profile: cacheProfile() }, asyncFixture.authRequest);
  await assert.rejects(asyncFixture.store.getPrivateProfile(asyncFixture.scope, EVENT_ID,
    asyncFixture.authRequest, lookup()),
  (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_DENIED');

  let thenReads = 0;
  const hostileFixture = await fixture(t, { authorizeBoundary: () => Object.defineProperty({}, 'then', {
    get() { thenReads += 1; throw new Error('hostile then getter'); },
  }) });
  await createSeed(hostileFixture);
  await hostileFixture.store.bindPrivateProfile(hostileFixture.scope, EVENT_ID,
    { idempotencyKey: 'bind-hostile-final-guard', profile: cacheProfile() }, hostileFixture.authRequest);
  await assert.rejects(hostileFixture.store.getPrivateProfile(hostileFixture.scope, EVENT_ID,
    hostileFixture.authRequest, lookup()),
  (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_DENIED');
  assert.equal(thenReads, 0);

  const rejectedFixture = await fixture(t, { authorizeBoundary: () => Promise.reject(new Error('rejected async guard')) });
  await createSeed(rejectedFixture);
  await rejectedFixture.store.bindPrivateProfile(rejectedFixture.scope, EVENT_ID,
    { idempotencyKey: 'bind-rejected-final-guard', profile: cacheProfile() }, rejectedFixture.authRequest);
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await assert.rejects(rejectedFixture.store.getPrivateProfile(rejectedFixture.scope, EVENT_ID,
      rejectedFixture.authRequest, lookup()),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_DENIED');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('malformed final boundary permit shapes fail closed without changing the bound row', async (t) => {
  let mode = 'valid';
  let accessorReads = 0;
  let proxyTraps = 0;
  const f = await fixture(t, { authorizeBoundary(input) {
    const permit = Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
      eventId: input.eventId, action: input.action, field: input.field, nowMs: EPOCH });
    if (mode === 'valid') return permit;
    if (mode === 'denied') return false;
    if (mode === 'throw') throw new Error('trusted guard failure');
    if (mode === 'tenant') return { ...permit, tenantId: 'tenant-other' };
    if (mode === 'actor') return { ...permit, actorId: 'actor-other' };
    if (mode === 'event') return { ...permit, eventId: 'event-other' };
    if (mode === 'action') return { ...permit, action: 'review.history.read' };
    if (mode === 'field') return { ...permit, field: 'event_name' };
    if (mode === 'clock') return { ...permit, nowMs: Number.NaN };
    if (mode === 'extra') return { ...permit, extra: true };
    if (mode === 'accessor') {
      const result = { ...permit };
      Object.defineProperty(result, 'nowMs', { enumerable: true, get() { accessorReads += 1; throw new Error('permit getter'); } });
      return result;
    }
    if (mode === 'proxy') return new Proxy(permit, { ownKeys() { proxyTraps += 1; throw new Error('permit proxy trap'); } });
    if (mode === 'prototype') return Object.assign(Object.create({ trusted: true }), permit);
    return permit;
  } });
  await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-malformed-final-permit', profile: cacheProfile() }, f.authRequest);

  for (const invalidMode of ['denied', 'throw', 'tenant', 'actor', 'event', 'action', 'field', 'clock', 'extra', 'accessor', 'proxy', 'prototype']) {
    mode = invalidMode;
    await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()),
      (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_DENIED', invalidMode);
  }
  assert.equal(accessorReads, 0, 'permit getters are inspected as descriptors, never invoked');
  assert.equal(proxyTraps, 0, 'proxy detection runs before proxy traps');

  const history = new DatabaseSync(historyDatabasePath(f.root));
  const cache = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(history.prepare('SELECT revision FROM heads').get().revision, 1);
    assert.equal(cache.prepare('SELECT eligible FROM reuse_entries WHERE binding_hash IS NOT NULL').get().eligible, 1);
  } finally { history.close(); cache.close(); }
  mode = 'valid';
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup())).status, 'hit');
});

test('a composed cache participant requires its sync guard while standalone cache remains compatible', async (t) => {
  const f = await fixture(t);
  const { authorizeBoundary: _standaloneOptionalGuard, ...standaloneOptions } = f.cacheOptions;
  const standalone = createScopedReuseStore(standaloneOptions);
  assert.ok(await standalone.scopeForAuthenticatedRequest(f.authRequest));

  assert.throws(() => createCorrectionCacheBinding({
    history: f.historyOptions,
    cache: standaloneOptions,
    authorizeBoundary: () => false,
  }), (error) => error?.code === 'REUSE_DENIED');
  await assert.rejects(access(historyDatabasePath(f.root)), { code: 'ENOENT' });
  await assert.rejects(access(cacheDatabasePath(f.root)), { code: 'ENOENT' });
});

test('cache expiry atomically removes its reservation and history cleanup retires only the expired mapping', async (t) => {
  const f = await fixture(t);
  await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-retention-cleanup', profile: cacheProfile() }, f.authRequest);
  const cache = createScopedReuseStore(f.cacheOptions);
  const cacheScope = await cache.scopeForAuthenticatedRequest(f.authRequest);
  const cacheDb = new DatabaseSync(cacheDatabasePath(f.root));
  let legacyReservation;
  try {
    const entry = cacheDb.prepare('SELECT * FROM reuse_entries WHERE binding_hash IS NOT NULL').get();
    const reservation = cacheDb.prepare('SELECT * FROM reuse_correction_reservations WHERE entry_id = ?').get(entry.entry_id);
    assert.ok(reservation);
    legacyReservation = { ...reservation, payload: Buffer.from(reservation.payload) };
  } finally { cacheDb.close(); }

  f.clock.value = EPOCH + 45_000;
  assert.equal((await cache.purgeExpired(cacheScope, f.authRequest)).purged, 1);

  const afterCacheExpiry = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    const entry = afterCacheExpiry.prepare(`SELECT eligible, payload_bytes, payload_purged, length(payload) AS payload_length
      FROM reuse_entries WHERE binding_hash IS NOT NULL`).get();
    assert.deepEqual({ ...entry }, { eligible: 0, payload_bytes: 0, payload_purged: 1, payload_length: 0 });
    assert.equal(afterCacheExpiry.prepare('SELECT COUNT(*) AS count FROM reuse_correction_reservations').get().count, 0);
    assert.deepEqual(afterCacheExpiry.prepare('SELECT status, COUNT(*) AS count FROM reuse_outbox GROUP BY status').all().map((row) => ({ ...row })),
      [{ status: 'pending', count: 1 }]);
    const history = new DatabaseSync(historyDatabasePath(f.root));
    try {
      assert.equal(history.prepare("SELECT state FROM heads WHERE state = 'available'").get().state, 'available');
      assert.equal(history.prepare('SELECT COUNT(*) AS count FROM correction_cache_bindings').get().count, 1);
      assert.ok(history.prepare('SELECT length(sealed) AS bytes FROM correction_cache_bindings').get().bytes > 0);
      assert.equal(history.prepare('SELECT COUNT(*) AS count FROM downstream_references').get().count, 1);
    } finally { history.close(); }
  } finally { afterCacheExpiry.close(); }

  // Recreate the former stale private row so the bounded compatibility sweep is exercised.
  const legacyDb = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    legacyDb.prepare(`INSERT INTO reuse_correction_reservations
      (entry_id, scope_kind, partition_hash, binding_hash, outbox_slots, payload_key_id, payload, payload_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(legacyReservation.entry_id, legacyReservation.scope_kind,
      legacyReservation.partition_hash, legacyReservation.binding_hash, legacyReservation.outbox_slots,
      legacyReservation.payload_key_id, legacyReservation.payload, legacyReservation.payload_bytes);
  } finally { legacyDb.close(); }
  assert.equal((await cache.purgeExpired(cacheScope, f.authRequest)).purged, 0);
  const afterResidualSweep = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(afterResidualSweep.prepare('SELECT COUNT(*) AS count FROM reuse_correction_reservations').get().count, 0);
    assert.equal(afterResidualSweep.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count, 1);
  } finally { afterResidualSweep.close(); }

  const historyStore = await historyStoreFor(f);
  assert.equal(await historyStore.history.purgeExpired(historyStore.scope, f.authRequest), 0);
  const afterHistorySweep = new DatabaseSync(historyDatabasePath(f.root));
  try {
    assert.equal(afterHistorySweep.prepare("SELECT state FROM heads WHERE state = 'available'").get().state, 'available');
    assert.equal(afterHistorySweep.prepare('SELECT COUNT(*) AS count FROM correction_cache_bindings').get().count, 0);
    assert.equal(afterHistorySweep.prepare('SELECT COUNT(*) AS count FROM downstream_references').get().count, 1);
  } finally { afterHistorySweep.close(); }

  f.clock.value = EPOCH + 60_000;
  assert.equal((await cache.purgeExpired(cacheScope, f.authRequest)).purged, 0);
  assert.equal(await historyStore.history.purgeExpired(historyStore.scope, f.authRequest), 1);
  const finalHistory = new DatabaseSync(historyDatabasePath(f.root));
  const finalCache = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(finalHistory.prepare('SELECT COUNT(*) AS count FROM downstream_references').get().count, 0);
    assert.equal(finalCache.prepare('SELECT COUNT(*) AS count FROM reuse_correction_reservations').get().count, 0);
    assert.equal(finalCache.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count, 1);
  } finally { finalHistory.close(); finalCache.close(); }
  assert.equal((await f.store.outboxSnapshot(f.scope, f.authRequest)).readiness, 'blocked_pending_external_ack');
});

test('composed binding enumeration prunes an expired mapping and preserves a later live binding and history references', async (t) => {
  const f = await fixture(t);
  await createSeed(f);
  const laterIdentity = Object.freeze({ ...IDENTITY, occurrenceId: 'occurrence-binding-later' });
  await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-expiry-first', profile: cacheProfile() }, f.authRequest);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-expiry-later', profile: cacheProfile({ identity: laterIdentity, expiresAtMs: EPOCH + 50_000,
      freshnessTtlMs: 50_000 }) },
    f.authRequest);
  f.clock.value = EPOCH + 45_000;

  assert.deepEqual(await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()), { status: 'miss' });
  const history = new DatabaseSync(historyDatabasePath(f.root));
  try {
    const live = history.prepare('SELECT expires_at_ms, length(sealed) AS bytes FROM correction_cache_bindings').get();
    assert.equal(live.expires_at_ms, EPOCH + 50_000);
    assert.ok(live.bytes > 0);
    assert.equal(history.prepare('SELECT COUNT(*) AS count FROM downstream_references').get().count, 2);
    assert.equal(history.prepare("SELECT state FROM heads WHERE state = 'available'").get().state, 'available');
  } finally { history.close(); }
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup({ identity: laterIdentity }))).status, 'hit');
});

test('correction after cache effective expiry keeps the history reference invalidation without a second cache event', async (t) => {
  const f = await fixture(t);
  const seeded = await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-correction-after-expiry', profile: cacheProfile() }, f.authRequest);
  const cache = createScopedReuseStore(f.cacheOptions);
  const cacheScope = await cache.scopeForAuthenticatedRequest(f.authRequest);
  f.clock.value = EPOCH + 45_000;
  assert.equal((await cache.purgeExpired(cacheScope, f.authRequest)).purged, 1);

  const revised = await f.store.applyCorrection(f.scope, {
    eventId: EVENT_ID,
    baseVersionId: seeded.snapshot.versionId,
    baseContentHash: seeded.snapshot.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-20' },
    idempotencyKey: 'correction-after-cache-effective-expiry',
    retentionHandle: f.createPermit(),
  }, f.authRequest);
  assert.equal(revised.snapshot.revision, seeded.snapshot.revision + 1);

  const history = new DatabaseSync(historyDatabasePath(f.root));
  const cacheDb = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(history.prepare('SELECT COUNT(*) AS count FROM invalidations').get().count, 1);
    assert.equal(history.prepare('SELECT COUNT(*) AS count FROM correction_cache_bindings').get().count, 0);
    assert.equal(cacheDb.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count, 1);
    assert.equal(cacheDb.prepare('SELECT COUNT(*) AS count FROM reuse_history_invalidation_ops').get().count, 0);
    assert.equal(cacheDb.prepare('SELECT COUNT(*) AS count FROM reuse_correction_reservations').get().count, 0);
  } finally { history.close(); cacheDb.close(); }
  assert.equal((await f.store.outboxSnapshot(f.scope, f.authRequest)).readiness, 'blocked_pending_external_ack');
});

test('an expiry race leaves the durable history barrier until exact retry retires the expired mapping', async (t) => {
  let releaseIndexKey;
  let signalIndexKey;
  let indexResolveCount = 0;
  let blockIndexResolution = false;
  const indexResolutionStarted = new Promise((resolve) => { signalIndexKey = resolve; });
  const f = await fixture(t, { cache: { resolveKey({ tenantId, scope, purpose, keyId }) {
    if (blockIndexResolution && tenantId === 'tenant-binding' && purpose === 'index' && ++indexResolveCount === 2) {
      blockIndexResolution = false;
      signalIndexKey();
      return new Promise((resolve) => {
        releaseIndexKey = () => resolve({ keyId: `${scope}:${purpose}:${tenantId}:v1`,
          key: createHash('sha256').update(`${tenantId}:${scope}:${purpose}:cache-test-key`).digest() });
      });
    }
    const resolvedId = `${scope}:${purpose}:${tenantId ?? 'global'}:v1`;
    if (keyId && keyId !== resolvedId) throw new Error('synthetic cache key unavailable');
    return { keyId: resolvedId,
      key: createHash('sha256').update(`${tenantId}:${scope}:${purpose}:cache-test-key`).digest() };
  } } });
  t.after(() => releaseIndexKey?.());
  const seeded = await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-expiry-race', profile: cacheProfile() }, f.authRequest);
  const input = {
    eventId: EVENT_ID,
    baseVersionId: seeded.snapshot.versionId,
    baseContentHash: seeded.snapshot.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-22' },
    idempotencyKey: 'correction-expiry-race-exact-retry',
    retentionHandle: f.createPermit(),
  };
  blockIndexResolution = true;
  indexResolveCount = 0;
  const firstAttempt = f.store.applyCorrection(f.scope, input, f.authRequest);
  const rejected = assert.rejects(firstAttempt, (error) => ['REUSE_DENIED', 'REVIEW_DENIED'].includes(error?.code));
  await waitForSignal(indexResolutionStarted, 'cache invalidation index-key resolution after history binding enumeration');
  const cache = createScopedReuseStore(f.cacheOptions);
  const cacheScope = await cache.scopeForAuthenticatedRequest(f.authRequest);
  f.clock.value = EPOCH + 45_000;
  assert.equal((await cache.purgeExpired(cacheScope, f.authRequest)).purged, 1);
  releaseIndexKey();
  await rejected;
  await assert.rejects(f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()),
    (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_BUSY');

  const recovered = await f.store.applyCorrection(f.scope, input, f.authRequest);
  assert.equal(recovered.snapshot.revision, seeded.snapshot.revision + 1);
  const history = new DatabaseSync(historyDatabasePath(f.root));
  const cacheDb = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(history.prepare("SELECT phase FROM correction_cache_state WHERE kind = 'correction'").get().phase, 'complete');
    assert.equal(history.prepare('SELECT COUNT(*) AS count FROM invalidations').get().count, 1);
    assert.equal(history.prepare('SELECT COUNT(*) AS count FROM correction_cache_bindings').get().count, 0);
    assert.equal(cacheDb.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count, 1);
    assert.equal(cacheDb.prepare('SELECT COUNT(*) AS count FROM reuse_history_invalidation_ops').get().count, 0);
  } finally { history.close(); cacheDb.close(); }
});

test('correction invalidation that commits before expiry keeps its receipt and does not duplicate the outbox event', async (t) => {
  const f = await fixture(t);
  const seeded = await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-correction-before-expiry', profile: cacheProfile() }, f.authRequest);
  const input = {
    eventId: EVENT_ID,
    baseVersionId: seeded.snapshot.versionId,
    baseContentHash: seeded.snapshot.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-23' },
    idempotencyKey: 'correction-before-cache-expiry',
    retentionHandle: f.createPermit(),
  };
  await f.store.applyCorrection(f.scope, input, f.authRequest);
  const cache = createScopedReuseStore(f.cacheOptions);
  const cacheScope = await cache.scopeForAuthenticatedRequest(f.authRequest);
  f.clock.value = EPOCH + 45_000;
  assert.equal((await cache.purgeExpired(cacheScope, f.authRequest)).purged, 1);
  assert.equal((await f.store.applyCorrection(f.scope, input, f.authRequest)).replayed, true);
  const cacheDb = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(cacheDb.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count, 1);
    assert.equal(cacheDb.prepare('SELECT COUNT(*) AS count FROM reuse_history_invalidation_ops').get().count, 1);
    assert.equal(cacheDb.prepare('SELECT COUNT(*) AS count FROM reuse_correction_reservations').get().count, 0);
  } finally { cacheDb.close(); }
});

test('tenant-scoped residual reservation cleanup progresses past 500 rows and preserves another tenant', async (t) => {
  const f = await fixture(t);
  await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-residual-default', profile: cacheProfile() }, f.authRequest);
  const otherRequest = request('tenant-other', 'actor-binding');
  const otherScope = await f.store.scopeForAuthenticatedRequest(otherRequest);
  await f.store.createHistory(otherScope, { eventId: EVENT_ID, sourceFacts: initialFacts(),
    idempotencyKey: 'initialize-other-tenant-event', retentionHandle: f.createPermit() }, otherRequest);
  const otherIdentity = Object.freeze({ ...IDENTITY, occurrenceId: 'occurrence-other-tenant' });
  await f.store.bindPrivateProfile(otherScope, EVENT_ID,
    { idempotencyKey: 'bind-residual-other-tenant', profile: cacheProfile({ identity: otherIdentity, expiresAtMs: EPOCH + 55_000 }) },
    otherRequest);

  const cache = createScopedReuseStore(f.cacheOptions);
  const cacheScope = await cache.scopeForAuthenticatedRequest(f.authRequest);
  const database = new DatabaseSync(cacheDatabasePath(f.root));
  let expiredEntry;
  let oldReservation;
  try {
    expiredEntry = database.prepare('SELECT * FROM reuse_entries WHERE expires_at_ms = ?').get(EPOCH + 45_000);
    oldReservation = database.prepare('SELECT * FROM reuse_correction_reservations WHERE entry_id = ?').get(expiredEntry.entry_id);
    oldReservation = { ...oldReservation, payload: Buffer.from(oldReservation.payload) };
  } finally { database.close(); }

  f.clock.value = EPOCH + 45_000;
  assert.equal((await cache.purgeExpired(cacheScope, f.authRequest)).purged, 1);
  const seedLegacy = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    const insertEntry = seedLegacy.prepare(`INSERT INTO reuse_entries
      (entry_id, scope_kind, partition_hash, identity_hash, cache_key_hash, content_hash_mac, pins_hash, version,
       created_at_ms, expires_at_ms, eligible, payload_key_id, payload, payload_bytes, payload_purged, binding_hash)
      VALUES (?, 'tenant_private', ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?, 0, 1, ?)`);
    const insertReservation = seedLegacy.prepare(`INSERT INTO reuse_correction_reservations
      (entry_id, scope_kind, partition_hash, binding_hash, outbox_slots, payload_key_id, payload, payload_bytes)
      VALUES (?, 'tenant_private', ?, ?, 1, ?, ?, ?)`);
    for (let index = 0; index < 501; index += 1) {
      const entryId = `legacy-expired-reservation-${String(index).padStart(4, '0')}`;
      const uniqueHash = index.toString(16).padStart(64, '0');
      insertEntry.run(entryId, expiredEntry.partition_hash, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64),
        EPOCH, EPOCH + 45_000, oldReservation.payload_key_id, Buffer.alloc(0), uniqueHash);
      insertReservation.run(entryId, expiredEntry.partition_hash, uniqueHash, oldReservation.payload_key_id,
        oldReservation.payload, oldReservation.payload_bytes);
    }
  } finally { seedLegacy.close(); }

  assert.equal((await cache.purgeExpired(cacheScope, f.authRequest)).purged, 0);
  const afterFirstSweep = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(afterFirstSweep.prepare('SELECT COUNT(*) AS count FROM reuse_correction_reservations').get().count, 2);
    assert.equal(afterFirstSweep.prepare(`SELECT COUNT(*) AS count FROM reuse_correction_reservations
      WHERE partition_hash = ?`).get(expiredEntry.partition_hash).count, 1);
    assert.equal(afterFirstSweep.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count, 1);
  } finally { afterFirstSweep.close(); }

  assert.equal((await cache.purgeExpired(cacheScope, f.authRequest)).purged, 0);
  const afterSecondSweep = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(afterSecondSweep.prepare('SELECT COUNT(*) AS count FROM reuse_correction_reservations').get().count, 1);
    assert.equal(afterSecondSweep.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count, 1);
  } finally { afterSecondSweep.close(); }

  const otherTenantHash = createHash('sha256').update('event-intelligence:review-tenant:v1:tenant-other').digest('hex');
  const otherHistory = new DatabaseSync(path.join(f.historyOptions.directory, otherTenantHash, 'history.sqlite'));
  try {
    assert.equal(otherHistory.prepare('SELECT COUNT(*) AS count FROM correction_cache_bindings').get().count, 1);
    assert.equal(otherHistory.prepare('SELECT COUNT(*) AS count FROM downstream_references').get().count, 1);
  } finally { otherHistory.close(); }
});

test('cache expiry consumes the reserved retention event at the exact outbox capacity boundary', async (t) => {
  const f = await fixture(t, { cache: { maxOutboxEntries: 2 } });
  await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-capacity-expiry', profile: cacheProfile() }, f.authRequest);
  const cache = createScopedReuseStore(f.cacheOptions);
  const cacheScope = await cache.scopeForAuthenticatedRequest(f.authRequest);
  const before = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(before.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count, 0);
    assert.equal(before.prepare('SELECT SUM(outbox_slots) AS count FROM reuse_correction_reservations').get().count, 1);
  } finally { before.close(); }
  f.clock.value = EPOCH + 45_000;
  assert.equal((await cache.purgeExpired(cacheScope, f.authRequest)).purged, 1);
  const after = new DatabaseSync(cacheDatabasePath(f.root));
  try {
    assert.equal(after.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count, 1);
    assert.equal(after.prepare("SELECT COUNT(*) AS count FROM reuse_outbox WHERE status = 'pending'").get().count, 1);
    assert.equal(after.prepare('SELECT COUNT(*) AS count FROM reuse_correction_reservations').get().count, 0);
  } finally { after.close(); }
});

test('history mapping purge rechecks current authorization after a real SQLite writer conflict before retry', async (t) => {
  let revoked = false;
  let watchBoundary = false;
  let boundaryAttempts = 0;
  let purgeAuthorizationCalls = 0;
  const authorizationCountsAtBoundary = [];
  let writer;
  let writerAcquired = false;
  let writerAcquireError;
  let signalRetry;
  const retryObserved = new Promise((resolve) => { signalRetry = resolve; });
  const f = await fixture(t, { history: {
    authorize({ tenantId, actorId, action, request: value }) {
      if (action === 'purge_correction_history') purgeAuthorizationCalls += 1;
      return !revoked && value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === tenantId
        && value?.principal?.actorId === actorId && actorId !== 'outsider';
    },
    authorizeBoundary(input) {
      if (watchBoundary && input.eventId === null && input.action === 'review.history.retention_purge') {
        boundaryAttempts += 1;
        authorizationCountsAtBoundary.push(purgeAuthorizationCalls);
        if (boundaryAttempts === 1) {
          try {
            writer = new DatabaseSync(historyDatabasePath(f.root), { timeout: 0 });
            writer.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
            writerAcquired = true;
          } catch (error) {
            writerAcquireError = error;
          }
          if (!writerAcquired) return false;
          return Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
            eventId: input.eventId, action: input.action, field: input.field, nowMs: f.clock.value });
        }
        if (boundaryAttempts === 2) {
          revoked = true;
          signalRetry();
          return false;
        }
      }
      const allowed = input.request?.serverContextToken === TRUSTED_TOKEN
        && input.request?.principal?.tenantId === input.tenantId
        && input.request?.principal?.actorId === input.actorId && input.actorId !== 'outsider'
        && !revoked;
      return allowed ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
        eventId: input.eventId, action: input.action, field: input.field, nowMs: f.clock.value }) : false;
    },
  } });
  t.after(() => {
    try { writer?.exec('ROLLBACK'); } catch { /* It may already be closed. */ }
    try { writer?.close(); } catch { /* Cleanup is best-effort after a test failure. */ }
  });
  await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-purge-auth-race', profile: cacheProfile() }, f.authRequest);
  f.clock.value = EPOCH + 45_000;
  const history = await historyStoreFor(f);
  watchBoundary = true;
  const purgeAttempt = history.history.purgeExpired(history.scope, f.authRequest);
  const rejection = await awaitWithTimeout(purgeAttempt, 'history purge authorization retry')
    .then(() => null, (error) => error);
  assert.equal(rejection instanceof ReviewHistoryError, true);
  assert.equal(rejection?.code, 'REVIEW_DENIED');
  await waitForSignal(retryObserved, 'history purge synchronous boundary rejection');
  assert.equal(writerAcquired, true, writerAcquireError?.message);
  assert.equal(boundaryAttempts, 2, 'the second guard follows an actual busy BEGIN retry');
  assert.equal(authorizationCountsAtBoundary[1] - authorizationCountsAtBoundary[0], 2,
    'the retry performs both async authorization checks before its final synchronous guard');
  writer.exec('ROLLBACK');
  writer.close();
  writer = undefined;
  const deniedSweep = new DatabaseSync(historyDatabasePath(f.root));
  try {
    assert.equal(deniedSweep.prepare('SELECT COUNT(*) AS count FROM correction_cache_bindings').get().count, 1);
    assert.equal(deniedSweep.prepare('SELECT COUNT(*) AS count FROM downstream_references').get().count, 1);
  } finally { deniedSweep.close(); }

  revoked = false;
  assert.equal(await history.history.purgeExpired(history.scope, f.authRequest), 0);
  const allowedSweep = new DatabaseSync(historyDatabasePath(f.root));
  try {
    assert.equal(allowedSweep.prepare('SELECT COUNT(*) AS count FROM correction_cache_bindings').get().count, 0);
    assert.equal(allowedSweep.prepare('SELECT COUNT(*) AS count FROM downstream_references').get().count, 1);
    assert.equal(allowedSweep.prepare("SELECT state FROM heads WHERE state = 'available'").get().state, 'available');
  } finally { allowedSweep.close(); }
});

test('binding preflight accepts the cache projection maxima of 32 candidates and 64 support references', async (t) => {
  const candidate = (value, prefix, referenceCount = 1) => Object.freeze({
    originStatus: 'sourced',
    value,
    sourceEvidence: Object.freeze(Array.from({ length: referenceCount }, (_, index) =>
      sourceEvidence(`${prefix}-${index}`, `${value}:${prefix}:${index}`))),
  });

  await t.test('exactly 32 projected candidates remain bindable', async (subtest) => {
    const f = await fixture(subtest);
    const facts = { ...initialFacts(), venue: Object.freeze({ status: 'conflicting',
      candidates: Object.freeze(Array.from({ length: 32 }, (_, index) =>
        candidate(`Venue ${index}`, `candidate-${index}`))) }) };
    await f.store.createHistory(f.scope, { eventId: EVENT_ID, sourceFacts: facts,
      idempotencyKey: 'initialize-exactly-32-candidates', retentionHandle: f.createPermit() }, f.authRequest);
    const bound = await f.store.bindPrivateProfile(f.scope, EVENT_ID,
      { idempotencyKey: 'bind-exactly-32-candidates', profile: cacheProfile() }, f.authRequest);
    assert.equal(bound.status, 'bound');
    const profile = await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup());
    assert.equal(profile.status, 'hit');
    assert.equal(profile.facts.venue.candidates.length, 32);
  });

  await t.test('exactly 64 support references on one projected candidate remain bindable', async (subtest) => {
    const f = await fixture(subtest);
    const facts = { ...initialFacts(), venue: Object.freeze({ status: 'conflicting', candidates: Object.freeze([
      candidate('Civic Hall', 'civic-initial', 32),
      candidate('River Room', 'river-initial'),
    ]) }) };
    const first = await f.store.createHistory(f.scope, { eventId: EVENT_ID, sourceFacts: facts,
      idempotencyKey: 'initialize-exactly-64-support-references', retentionHandle: f.createPermit() }, f.authRequest);
    const refreshed = await f.store.refreshSources(f.scope, {
      eventId: EVENT_ID,
      baseVersionId: first.snapshot.versionId,
      baseContentHash: first.snapshot.contentHash,
      sourceFacts: { venue: { status: 'sourced', value: 'Civic Hall',
        sourceEvidence: Array.from({ length: 32 }, (_, index) =>
          sourceEvidence(`civic-refresh-${index}`, `Civic Hall:refresh:${index}`)) } },
      idempotencyKey: 'refresh-exactly-64-support-references',
      retentionHandle: f.createPermit(),
    }, f.authRequest);
    const civicCandidate = refreshed.snapshot.fields.venue.candidates.find((entry) => entry.value === 'Civic Hall');
    assert.equal(civicCandidate.sourceEvidence.length, 64, JSON.stringify({
      claims: refreshed.snapshot.fields.venue.sourceClaims.map((claim) => claim.sourceEvidence.length),
      candidates: refreshed.snapshot.fields.venue.candidates.map((item) => ({ value: item.value, refs: item.sourceEvidence.length })),
    }));
    const bound = await f.store.bindPrivateProfile(f.scope, EVENT_ID,
      { idempotencyKey: 'bind-exactly-64-support-references', profile: cacheProfile() }, f.authRequest);
    assert.equal(bound.status, 'bound');
  });
});

test('unsupported accumulated projections fail before a durable bind barrier', async (t) => {
  const f = await fixture(t);
  let current = await createSeed(f);
  for (const [batch, count] of [32, 32, 32, 30].entries()) {
    const candidates = Array.from({ length: count }, (_, index) => {
      const value = `Accumulated venue ${batch}-${index}`;
      return { originStatus: 'sourced', value,
        sourceEvidence: [sourceEvidence(`accumulated-${batch}-${index}`, value)] };
    });
    current = await f.store.refreshSources(f.scope, {
      eventId: EVENT_ID,
      baseVersionId: current.snapshot.versionId,
      baseContentHash: current.snapshot.contentHash,
      sourceFacts: { venue: { status: 'conflicting', candidates } },
      idempotencyKey: `accumulated-candidates-${batch}`,
      retentionHandle: f.createPermit(),
    }, f.authRequest);
  }
  assert.equal(current.snapshot.fields.venue.sourceClaims.length, 128);
  assert.equal(current.snapshot.fields.venue.candidates.length, 128);

  const bindError = await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-128-accumulated-candidates', profile: cacheProfile() }, f.authRequest)
    .then(() => null, (error) => error);
  assert.equal(bindError?.code, 'REUSE_INVALID');
  const reopenedHistory = await f.store.getHistory(f.scope, EVENT_ID, f.authRequest);
  assert.equal(reopenedHistory.contentHash, current.snapshot.contentHash);
  assert.equal(reopenedHistory.fields.venue.sourceClaims.length, 128);
  assert.equal(reopenedHistory.fields.venue.candidates.length, 128,
    'preflight must preserve every immutable alternative rather than truncate to the cache bound');

  const history = new DatabaseSync(historyDatabasePath(f.root));
  try {
    assert.equal(history.prepare("SELECT COUNT(*) AS count FROM correction_cache_operations WHERE kind = 'bind'").get().count, 0);
    assert.equal(history.prepare("SELECT COUNT(*) AS count FROM correction_cache_state WHERE phase = 'pending_bind'").get().count, 0);
  } finally { history.close(); }

  const standaloneHistory = await historyStoreFor(f);
  await assert.rejects(standaloneHistory.history.refreshSources(standaloneHistory.scope, {
    eventId: EVENT_ID,
    baseVersionId: current.snapshot.versionId,
    baseContentHash: current.snapshot.contentHash,
    sourceFacts: { venue: { status: 'sourced', value: 'Overflow venue',
      sourceEvidence: [sourceEvidence('overflow-venue-129', 'Overflow venue')] } },
    idempotencyKey: 'history-129th-source-claim',
    retentionHandle: f.createPermit(),
  }, f.authRequest), (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_STORAGE_LIMIT');
  assert.equal((await f.store.getHistory(f.scope, EVENT_ID, f.authRequest)).contentHash, current.snapshot.contentHash,
    'the 129th source claim remains rejected without changing the 128-claim history');
});

test('unsupported accumulated support references fail before a durable bind barrier', async (t) => {
  const f = await fixture(t);
  let current = await createSeed(f);
  for (let batch = 0; batch < 2; batch += 1) {
    current = await f.store.refreshSources(f.scope, {
      eventId: EVENT_ID,
      baseVersionId: current.snapshot.versionId,
      baseContentHash: current.snapshot.contentHash,
      sourceFacts: { venue: { status: 'sourced', value: 'Civic Hall',
        sourceEvidence: Array.from({ length: 32 }, (_, index) =>
          sourceEvidence(`support-ref-${batch}-${index}`, `support-ref:${batch}:${index}`)) } },
      idempotencyKey: `support-reference-refresh-${batch}`,
      retentionHandle: f.createPermit(),
    }, f.authRequest);
  }
  assert.equal(current.snapshot.fields.venue.candidates
    .find((entry) => entry.value === 'Civic Hall').sourceEvidence.length, 65);

  const bindError = await f.store.bindPrivateProfile(f.scope, EVENT_ID,
    { idempotencyKey: 'bind-65-accumulated-support-references', profile: cacheProfile() }, f.authRequest)
    .then(() => null, (error) => error);
  assert.equal(bindError?.code, 'REUSE_INVALID');
  const reopenedHistory = await f.store.getHistory(f.scope, EVENT_ID, f.authRequest);
  assert.equal(reopenedHistory.contentHash, current.snapshot.contentHash);
  assert.equal(reopenedHistory.fields.venue.candidates
    .find((entry) => entry.value === 'Civic Hall').sourceEvidence.length, 65,
  'preflight must preserve immutable support evidence instead of truncating it');
  const history = new DatabaseSync(historyDatabasePath(f.root));
  try {
    assert.equal(history.prepare("SELECT COUNT(*) AS count FROM correction_cache_operations WHERE kind = 'bind'").get().count, 0);
    assert.equal(history.prepare("SELECT COUNT(*) AS count FROM correction_cache_state WHERE phase = 'pending_bind'").get().count, 0);
  } finally { history.close(); }
});
