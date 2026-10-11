import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createScopedReuseStore } from '../../../src/cache/reuse/store.mjs';
import { createCorrectionCacheBinding } from '../../../src/review/history/cache-binding.mjs';
import { ReviewHistoryError } from '../../../src/review/history/store.mjs';

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
    resolveActor: (value) => value?.principal?.actorId,
    authorize({ tenantId, actorId, request: value }) {
      return value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === tenantId
        && value?.principal?.actorId === actorId && actorId !== 'outsider';
    },
    resolveKey({ tenantId, purpose, keyId }) {
      const resolvedId = `${purpose}-v1`;
      if (keyId && keyId !== resolvedId) throw new Error('synthetic history key unavailable');
      return { keyId: resolvedId, key: createHash('sha256').update(`${tenantId}:${purpose}:history-test-key`).digest() };
    },
    resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (options.history?.resolveRetention) return options.history.resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle });
      if (tenantId !== 'tenant-binding' || !permits.has(retentionHandle)) throw new Error('synthetic history retention denied');
      return { expiresAtMs: Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
        policyId: 'synthetic-history-retention', policyVersion: '1', accessPolicy: 'tenant_private' };
    },
    lockedFields: ['event_status'],
    now: () => clock.value,
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
  const authorizeFinalDisclosure = options.authorizeFinalDisclosure ?? ((decision) => decision.tenantId === 'tenant-binding'
    && decision.actorId !== 'outsider' && decision.action === 'private_profile.read');
  const makeStore = () => createCorrectionCacheBinding({ history: historyOptions, cache: cacheOptions,
    authorizeFinalDisclosure, operationTimeoutMs: options.operationTimeoutMs });
  const store = makeStore();
  const authRequest = request();
  const scope = await store.scopeForAuthenticatedRequest(authRequest);
  return { root, clock, createPermit, makeStore, store, authRequest, scope, historyOptions, cacheOptions };
}

async function createSeed(f) {
  return f.store.createHistory(f.scope, { eventId: EVENT_ID, sourceFacts: initialFacts(),
    idempotencyKey: 'initialize-binding-event', retentionHandle: f.createPermit() }, f.authRequest);
}

function cacheProfile() {
  return Object.freeze({
    identity: IDENTITY,
    contentHash: CONTENT_HASH,
    pins: PINS,
    facts: Object.freeze({ event_name: Object.freeze({ status: 'sourced', value: 'ignored input' }) }),
    observation: Object.freeze({ source: 'synthetic local observation' }),
    freshnessTtlMs: 30_000,
    expiresAtMs: EPOCH + 45_000,
  });
}

function lookup() {
  return Object.freeze({ identity: IDENTITY, contentHash: CONTENT_HASH, pins: PINS });
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
  await initialRejection;

  const retried = await f.store.bindPrivateProfile(f.scope, EVENT_ID, input, request());
  assert.equal(retried.status, 'bound');
  releaseFirstObservation();
  await waitForSignal(oldContinuation, 'late callback continuation guard');
  assert.equal((await f.store.getPrivateProfile(f.scope, EVENT_ID, request(), lookup())).status, 'hit');
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

test('final synchronous disclosure guard is current and permission expiry is resampled afterward', async (t) => {
  let authorized = true;
  const f = await fixture(t, {
    authorizeFinalDisclosure(decision) {
      assert.equal(decision.permissionValidUntilMs, EPOCH + 500);
      if (!authorized) return false;
      f.clock.value = EPOCH + 500;
      return true;
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

test('asynchronous and hostile final disclosure results fail closed without thenable property access', async (t) => {
  const asyncFixture = await fixture(t, { authorizeFinalDisclosure: async () => true });
  await createSeed(asyncFixture);
  await asyncFixture.store.bindPrivateProfile(asyncFixture.scope, EVENT_ID,
    { idempotencyKey: 'bind-async-final-guard', profile: cacheProfile() }, asyncFixture.authRequest);
  await assert.rejects(asyncFixture.store.getPrivateProfile(asyncFixture.scope, EVENT_ID,
    asyncFixture.authRequest, lookup()),
  (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_DENIED');

  let thenReads = 0;
  const hostileFixture = await fixture(t, { authorizeFinalDisclosure: () => Object.defineProperty({}, 'then', {
    get() { thenReads += 1; throw new Error('hostile then getter'); },
  }) });
  await createSeed(hostileFixture);
  await hostileFixture.store.bindPrivateProfile(hostileFixture.scope, EVENT_ID,
    { idempotencyKey: 'bind-hostile-final-guard', profile: cacheProfile() }, hostileFixture.authRequest);
  await assert.rejects(hostileFixture.store.getPrivateProfile(hostileFixture.scope, EVENT_ID,
    hostileFixture.authRequest, lookup()),
  (error) => error instanceof ReviewHistoryError && error.code === 'REVIEW_DENIED');
  assert.equal(thenReads, 0);
});

test('cache cleanup at its private retention expiry never permits an old bound read', async (t) => {
  const f = await fixture(t);
  await createSeed(f);
  await f.store.bindPrivateProfile(f.scope, EVENT_ID, { idempotencyKey: 'bind-retention-cleanup', profile: cacheProfile() }, f.authRequest);
  const cache = createScopedReuseStore(f.cacheOptions);
  const cacheScope = await cache.scopeForAuthenticatedRequest(f.authRequest);
  f.clock.value = EPOCH + 45_000;
  const purged = await cache.purgeExpired(cacheScope, f.authRequest);
  assert.equal(purged.purged, 1);
  assert.deepEqual(await f.store.getPrivateProfile(f.scope, EVENT_ID, f.authRequest, lookup()),
    { status: 'unavailable', reason: 'expired' });
  assert.equal((await f.store.outboxSnapshot(f.scope, f.authRequest)).readiness, 'blocked_pending_external_ack');
});
