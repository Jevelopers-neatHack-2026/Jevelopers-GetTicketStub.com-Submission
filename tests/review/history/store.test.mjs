import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCorrectionHistoryStore, ReviewHistoryError } from '../../../src/review/history/store.mjs';

const EPOCH = Date.parse('2026-10-10T15:00:00.000Z');
const EVENT_ID = 'event-synthetic-001';
const TRUSTED_SERVER_CONTEXT = 'synthetic-server-context';

function evidence(evidenceId, material) {
  return { evidenceId, contentHash: createHash('sha256').update(material).digest('hex') };
}

function createRequest(tenantId = 'tenant-a', actorId = 'customer-a', token = TRUSTED_SERVER_CONTEXT) {
  return Object.freeze({
    principal: Object.freeze({ tenantId, actorId }),
    serverContextToken: token,
    // The store never reads this browser-like boolean as authorization.
    allowPrivate: true,
  });
}

function initialFacts() {
  return {
    event_name: { status: 'sourced', value: 'Moon Night', sourceEvidence: [evidence('source-name', 'Moon Night')] },
    event_date: { status: 'missing' },
    venue: {
      status: 'conflicting',
      candidates: [
        { originStatus: 'sourced', value: 'Civic Hall', sourceEvidence: [evidence('source-venue-a', 'Civic Hall')] },
        { originStatus: 'inferred', value: 'River Room', sourceEvidence: [evidence('source-venue-b', 'River Room')] },
      ],
    },
    event_status: { status: 'sourced', value: 'scheduled', sourceEvidence: [evidence('source-status', 'scheduled')] },
  };
}

function sourceDate(value, id) {
  return { status: 'sourced', value: { precision: 'date', value }, sourceEvidence: [evidence(id, value)] };
}

async function createHarness(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-review-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const clock = { value: EPOCH };
  const permits = new WeakMap();
  const createPermit = (tenantId = 'tenant-a', durationMs = 60_000) => {
    const handle = Object.freeze(Object.create(null));
    permits.set(handle, { tenantId, expiresAtMs: clock.value + durationMs });
    return handle;
  };
  const options = {
    directory: root,
    resolveTenant: (request) => request?.principal?.tenantId,
    resolveActor: (request) => request?.principal?.actorId,
    authorize({ tenantId, actorId, request }) {
      return request?.serverContextToken === TRUSTED_SERVER_CONTEXT
        && request?.principal?.tenantId === tenantId
        && request?.principal?.actorId === actorId
        && actorId !== 'outsider';
    },
    resolveKey({ tenantId, purpose, keyId }) {
      const resolvedId = `${purpose}-v1`;
      if (keyId && keyId !== resolvedId) throw new Error('SYNTHETIC_KEY_ERROR');
      return {
        keyId: resolvedId,
        key: createHash('sha256').update(`${tenantId}:${purpose}:test-only-key-material`).digest(),
      };
    },
    resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle }) {
      const permit = permits.get(retentionHandle);
      if (!permit || permit.tenantId !== tenantId) throw new Error('SYNTHETIC_RETENTION_ERROR');
      return {
        expiresAtMs: Math.min(permit.expiresAtMs, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
        policyId: 'synthetic-private-history',
        policyVersion: '1',
        accessPolicy: 'tenant_private',
      };
    },
    lockedFields: ['event_status'],
    now: () => clock.value,
    maxRetentionMs: 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
  const openStore = () => createCorrectionHistoryStore(options);
  const store = openStore();
  const request = createRequest();
  const scope = await store.scopeForAuthenticatedRequest(request);
  return { root, clock, createPermit, openStore, store, request, scope };
}

async function createSeed(harness, facts = initialFacts(), request = harness.request) {
  return harness.store.createHistory(harness.scope, {
    eventId: EVENT_ID,
    sourceFacts: facts,
    idempotencyKey: 'initialize-event-001',
    retentionHandle: harness.createPermit(),
  }, request);
}

function correction(harness, snapshot, field, value, idempotencyKey) {
  return harness.store.applyCorrection(harness.scope, {
    eventId: EVENT_ID,
    baseVersionId: snapshot.versionId,
    baseContentHash: snapshot.contentHash,
    field,
    value,
    idempotencyKey,
    retentionHandle: harness.createPermit(),
  }, harness.request);
}

function assertReviewError(expectedCode) {
  return (error) => error instanceof ReviewHistoryError && error.code === expectedCode;
}

function runWorker(args) {
  const worker = new URL('./worker.mjs', import.meta.url);
  const child = spawn(process.execPath, [worker.pathname, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const exit = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, exit };
}

async function waitFor(filePath, timeoutMs = 10_000) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    try { await access(filePath); return; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('worker did not reach its synchronization point');
}

async function inspectDatabase(root, tenantId = 'tenant-a') {
  const tenantHash = createHash('sha256').update(`event-intelligence:review-tenant:v1:${tenantId}`).digest('hex');
  const database = new DatabaseSync(path.join(root, tenantHash, 'history.sqlite'));
  try {
    return {
      heads: database.prepare('SELECT * FROM heads ORDER BY event_key').all(),
      versions: database.prepare('SELECT event_key, revision, version_id, parent_version_id, content_hash, sealed, state FROM versions ORDER BY event_key, revision').all(),
      versionSealedLengths: database.prepare('SELECT length(sealed) AS length FROM versions WHERE sealed IS NOT NULL ORDER BY event_key, revision').all()
        .map((row) => row.length),
      idempotencyCount: database.prepare('SELECT COUNT(*) AS count FROM idempotency').get().count,
      references: database.prepare('SELECT COUNT(*) AS count FROM downstream_references').get().count,
      invalidations: database.prepare('SELECT COUNT(*) AS count FROM invalidations').get().count,
      sealedBytes: database.prepare("SELECT COALESCE(SUM(length(sealed)), 0) AS count FROM versions WHERE sealed IS NOT NULL").get().count
        + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS count FROM downstream_references').get().count,
    };
  } finally {
    database.close();
  }
}

test('creates targeted typed questions and keeps customer corrections beside source disagreements', async (t) => {
  const harness = await createHarness(t);
  const first = (await createSeed(harness)).snapshot;
  const dateQuestion = first.questions.find((question) => question.field === 'event_date');
  const venueQuestion = first.questions.find((question) => question.field === 'venue');
  assert.equal(dateQuestion.code, 'MISSING_REQUIRED_FACT');
  assert.equal(dateQuestion.expectedType, 'date');
  assert.match(dateQuestion.id, /^q_[a-f0-9]{24}$/);
  assert.equal(venueQuestion.code, 'CONFLICTING_SOURCE_FACTS');
  assert.equal(venueQuestion.expectedType, 'text');
  assert.equal(venueQuestion.candidates.length, 2);
  assert.equal((await harness.store.getHistory(harness.scope, EVENT_ID, harness.request)).questions[0].id, first.questions[0].id);

  const dateResult = await correction(harness, first, 'event_date', { precision: 'date', value: '2027-06-20' }, 'correct-date-1');
  const dateSnapshot = dateResult.snapshot;
  assert.equal(dateSnapshot.revision, 2);
  assert.equal(dateSnapshot.parentVersionId, first.versionId);
  assert.notEqual(dateSnapshot.contentHash, first.contentHash);
  assert.equal(first.fields.event_date.status, 'missing');
  assert.equal(first.questions.some((question) => question.field === 'event_date'), true);
  assert.equal(dateSnapshot.fields.event_date.status, 'customer_supplied');
  assert.equal(dateSnapshot.fields.event_date.value.value, '2027-06-20');
  assert.equal(dateSnapshot.questions.some((question) => question.field === 'event_date'), false);
  assert.equal(dateSnapshot.questions.find((question) => question.field === 'venue').id, venueQuestion.id);

  const venueResult = await correction(harness, dateSnapshot, 'venue', 'Civic Hall', 'correct-venue-1');
  const venue = venueResult.snapshot.fields.venue;
  assert.equal(venue.status, 'customer_supplied');
  assert.equal(venue.value, 'Civic Hall');
  assert.equal(venue.sourceClaims.length, 2);
  assert.equal(venue.disagreements.length, 1);
  assert.equal(venue.disagreements[0].value, 'River Room');
  const conflictQuestion = venueResult.snapshot.questions.find((question) => question.field === 'venue');
  assert.equal(conflictQuestion.state, 'answered_customer_supplied');
  assert.equal(conflictQuestion.candidates.length, 2);

  const oldVenue = await harness.store.getHistoryVersion(harness.scope, EVENT_ID, first.versionId, harness.request);
  assert.equal(oldVenue.contentHash, first.contentHash);
  assert.equal(oldVenue.fields.venue.status, 'conflicting');
});

test('authorization, typed fields, locked policy, and approval-shaped client data fail closed', async (t) => {
  const harness = await createHarness(t);
  const initial = (await createSeed(harness)).snapshot;
  const forgedRequest = createRequest('tenant-a', 'outsider');
  await assert.rejects(harness.store.getHistory(harness.scope, EVENT_ID, forgedRequest), assertReviewError('REVIEW_DENIED'));
  await assert.rejects(harness.store.applyCorrection(harness.scope, {
    eventId: EVENT_ID,
    baseVersionId: initial.versionId,
    baseContentHash: initial.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-20' },
    idempotencyKey: 'wrong-actor-write',
    retentionHandle: harness.createPermit(),
  }, forgedRequest), assertReviewError('REVIEW_DENIED'));
  const otherScope = await harness.store.scopeForAuthenticatedRequest(createRequest('tenant-b', 'customer-b'));
  await assert.rejects(harness.store.getHistory(otherScope, EVENT_ID, harness.request), assertReviewError('REVIEW_DENIED'));

  const write = (extra) => harness.store.applyCorrection(harness.scope, {
    eventId: EVENT_ID,
    baseVersionId: initial.versionId,
    baseContentHash: initial.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-20' },
    idempotencyKey: 'negative-case',
    retentionHandle: harness.createPermit(),
    ...extra,
  }, harness.request);
  await assert.rejects(write({ field: 'unknown_fact' }), assertReviewError('REVIEW_FIELD_NOT_ALLOWED'));
  await assert.rejects(write({ field: 'event_status', value: 'cancelled' }), assertReviewError('REVIEW_FIELD_LOCKED'));
  await assert.rejects(write({ value: { precision: 'date', value: '2027-02-29' } }), assertReviewError('REVIEW_INVALID'));
  await assert.rejects(write({ approval: { approved: true, versionId: initial.versionId } }), assertReviewError('REVIEW_INVALID'));
  await assert.rejects(write({ baseVersionId: 'copied-version-id' }), assertReviewError('REVIEW_VERSION_CONFLICT'));
  const after = await harness.store.getHistory(harness.scope, EVENT_ID, harness.request);
  assert.equal(after.versionId, initial.versionId);
  assert.equal(after.contentHash, initial.contentHash);
});

test('idempotent corrections survive restart and mismatched key reuse conflicts', async (t) => {
  const harness = await createHarness(t);
  const first = (await createSeed(harness)).snapshot;
  const input = {
    eventId: EVENT_ID,
    baseVersionId: first.versionId,
    baseContentHash: first.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-20' },
    idempotencyKey: 'exact-correction-key',
    retentionHandle: harness.createPermit(),
  };
  const committed = await harness.store.applyCorrection(harness.scope, input, harness.request);
  const replay = await harness.store.applyCorrection(harness.scope, { ...input, retentionHandle: harness.createPermit() }, harness.request);
  assert.equal(replay.replayed, true);
  assert.equal(replay.snapshot.versionId, committed.snapshot.versionId);
  assert.equal(replay.snapshot.revision, 2);
  await assert.rejects(harness.store.applyCorrection(harness.scope, {
    ...input,
    value: { precision: 'date', value: '2027-06-21' },
    retentionHandle: harness.createPermit(),
  }, harness.request), assertReviewError('REVIEW_IDEMPOTENCY_CONFLICT'));
  await assert.rejects(harness.store.applyCorrection(harness.scope, {
    ...input,
    retentionHandle: harness.createPermit(),
  }, createRequest('tenant-a', 'reviewer')), assertReviewError('REVIEW_IDEMPOTENCY_CONFLICT'));

  const restarted = harness.openStore();
  const restartedScope = await restarted.scopeForAuthenticatedRequest(harness.request);
  const afterRestart = await restarted.applyCorrection(restartedScope, {
    ...input,
    retentionHandle: harness.createPermit(),
  }, harness.request);
  assert.equal(afterRestart.replayed, true);
  assert.equal(afterRestart.snapshot.contentHash, committed.snapshot.contentHash);
  const history = await restarted.listHistory(restartedScope, EVENT_ID, harness.request);
  assert.deepEqual(history.map((snapshot) => snapshot.revision), [1, 2]);
});

test('source refresh retains customer value and opens a review when new evidence disagrees', async (t) => {
  const harness = await createHarness(t);
  const first = (await createSeed(harness)).snapshot;
  const corrected = (await correction(harness, first, 'event_date', { precision: 'date', value: '2027-06-20' }, 'correct-date-2')).snapshot;
  const refreshed = await harness.store.refreshSources(harness.scope, {
    eventId: EVENT_ID,
    baseVersionId: corrected.versionId,
    baseContentHash: corrected.contentHash,
    sourceFacts: { event_date: sourceDate('2027-06-21', 'source-refreshed-date') },
    idempotencyKey: 'refresh-after-correction',
    retentionHandle: harness.createPermit(),
  }, harness.request);
  const field = refreshed.snapshot.fields.event_date;
  assert.equal(field.status, 'customer_supplied');
  assert.equal(field.value.value, '2027-06-20');
  assert.equal(field.disagreements.length, 1);
  assert.equal(field.disagreements[0].value.value, '2027-06-21');
  const review = refreshed.snapshot.questions.find((question) => question.field === 'event_date');
  assert.equal(review.code, 'SOURCE_REFRESH_REVIEW');
  assert.equal(review.state, 'open');
  assert.equal(refreshed.snapshot.parentVersionId, corrected.versionId);
});

test('every new version invalidates exact prior references, including explicit nonmaterial revisions', async (t) => {
  const harness = await createHarness(t);
  const first = (await createSeed(harness)).snapshot;
  await harness.store.registerDownstreamReference(harness.scope, {
    eventId: EVENT_ID,
    versionId: first.versionId,
    contentHash: first.contentHash,
    referenceId: 'approval-ref-001',
    kind: 'approval_reference',
  }, harness.request);
  await harness.store.registerDownstreamReference(harness.scope, {
    eventId: EVENT_ID,
    versionId: first.versionId,
    contentHash: first.contentHash,
    referenceId: 'handoff-ref-001',
    kind: 'handoff_reference',
  }, harness.request);

  const second = (await correction(harness, first, 'event_date', { precision: 'date', value: '2027-06-20' }, 'correct-date-3')).snapshot;
  assert.equal(second.invalidations.length, 2);
  assert.equal(second.invalidations[0].priorVersionId, first.versionId);
  assert.equal(second.invalidations[0].priorContentHash, first.contentHash);
  assert.equal(second.invalidations.every((item) => item.materialChange), true);
  assert.equal(second.invalidations.every((item) => item.reason === 'material_projection_changed'), true);
  assert.equal((await harness.store.listDownstreamReferences(harness.scope, EVENT_ID, harness.request)).every((item) => item.state === 'invalidated'), true);
  await assert.rejects(harness.store.registerDownstreamReference(harness.scope, {
    eventId: EVENT_ID,
    versionId: first.versionId,
    contentHash: first.contentHash,
    referenceId: 'late-old-approval',
    kind: 'approval_reference',
  }, harness.request), assertReviewError('REVIEW_VERSION_CONFLICT'));

  await harness.store.registerDownstreamReference(harness.scope, {
    eventId: EVENT_ID,
    versionId: second.versionId,
    contentHash: second.contentHash,
    referenceId: 'handoff-ref-002',
    kind: 'handoff_reference',
  }, harness.request);
  const third = (await correction(harness, second, 'event_date', { precision: 'date', value: '2027-06-20' }, 'reaffirm-date')).snapshot;
  assert.equal(third.materialHash, second.materialHash);
  assert.equal(third.invalidations.length, 1);
  assert.equal(third.invalidations[0].materialChange, false);
  assert.equal(third.invalidations[0].reason, 'new_version_requires_new_binding');
  assert.equal(third.invalidations[0].priorVersionId, second.versionId);
  assert.equal(third.invalidations[0].priorContentHash, second.contentHash);
});

test('two processes cannot both commit from one base revision', async (t) => {
  const harness = await createHarness(t);
  const first = (await createSeed(harness)).snapshot;
  const startPath = path.join(harness.root, 'concurrency-start');
  const workerA = runWorker(['compete', harness.root, EVENT_ID, first.versionId, first.contentHash, startPath, '2027-06-20', 'child-a']);
  const workerB = runWorker(['compete', harness.root, EVENT_ID, first.versionId, first.contentHash, startPath, '2027-06-21', 'child-b']);
  await Promise.all([waitFor(`${startPath}.ready-child-a`), waitFor(`${startPath}.ready-child-b`)]);
  await writeFile(startPath, 'go');
  const [a, b] = await Promise.all([workerA.exit, workerB.exit]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  const outcomes = [JSON.parse(a.stdout), JSON.parse(b.stdout)].map((result) => result.outcome);
  assert.equal(outcomes.filter((outcome) => outcome === 'committed').length, 1);
  assert.equal(outcomes.filter((outcome) => outcome === 'conflict').length, 1);
  const history = await harness.store.listHistory(harness.scope, EVENT_ID, harness.request);
  assert.equal(history.length, 2);
  assert.equal(history[1].parentVersionId, first.versionId);
});

test('cancellation after the new row is staged rolls back version, head, and idempotency together', async (t) => {
  const controller = new AbortController();
  let armed = false;
  let callsAfterArm = 0;
  const harness = await createHarness(t, {
    resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (armed && ++callsAfterArm === 2) queueMicrotask(() => controller.abort());
      const upper = sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER;
      return {
        expiresAtMs: Math.min(nowMs + 60_000, upper),
        policyId: 'synthetic-private-history',
        policyVersion: '1',
        accessPolicy: 'tenant_private',
      };
    },
  });
  const first = (await createSeed(harness)).snapshot;
  armed = true;
  const input = {
    eventId: EVENT_ID,
    baseVersionId: first.versionId,
    baseContentHash: first.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-20' },
    idempotencyKey: 'cancelled-before-commit',
    retentionHandle: Object.freeze(Object.create(null)),
  };
  await assert.rejects(harness.store.applyCorrection(harness.scope, input, harness.request, { signal: controller.signal }), assertReviewError('REVIEW_ABORTED'));
  const unchanged = await harness.store.getHistory(harness.scope, EVENT_ID, harness.request);
  assert.equal(unchanged.versionId, first.versionId);
  assert.equal((await harness.store.listHistory(harness.scope, EVENT_ID, harness.request)).length, 1);

  armed = false;
  const retry = await harness.store.applyCorrection(harness.scope, {
    ...input,
    retentionHandle: harness.createPermit(),
  }, harness.request);
  assert.equal(retry.snapshot.revision, 2);
  assert.equal(retry.replayed, false);
});

test('process death while a transaction has staged a version recovers the old head cleanly', async (t) => {
  const harness = await createHarness(t);
  const first = (await createSeed(harness)).snapshot;
  const markerPath = path.join(harness.root, 'crash-staged');
  const worker = runWorker(['crash', harness.root, EVENT_ID, first.versionId, first.contentHash, markerPath]);
  await waitFor(markerPath);
  worker.child.kill('SIGKILL');
  const result = await worker.exit;
  assert.equal(result.signal, 'SIGKILL');
  const restarted = harness.openStore();
  const restartedScope = await restarted.scopeForAuthenticatedRequest(harness.request);
  const recovered = await restarted.getHistory(restartedScope, EVENT_ID, harness.request);
  assert.equal(recovered.versionId, first.versionId);
  assert.equal((await restarted.listHistory(restartedScope, EVENT_ID, harness.request)).length, 1);
  const retry = await restarted.applyCorrection(restartedScope, {
    eventId: EVENT_ID,
    baseVersionId: first.versionId,
    baseContentHash: first.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-20' },
    idempotencyKey: 'crash-retry',
    retentionHandle: harness.createPermit(),
  }, harness.request);
  assert.equal(retry.snapshot.revision, 2);
});

test('private encrypted files have restrictive modes and retention expiry removes payloads without extension', async (t) => {
  const harness = await createHarness(t);
  const first = (await createSeed(harness, initialFacts())).snapshot;
  const [tenantEntry] = await readdir(harness.root, { withFileTypes: true });
  const tenantPath = path.join(harness.root, tenantEntry.name);
  const databasePath = path.join(tenantPath, 'history.sqlite');
  const directoryMode = (await stat(tenantPath)).mode & 0o777;
  const databaseMode = (await stat(databasePath)).mode & 0o777;
  assert.equal(directoryMode, 0o700);
  assert.equal(databaseMode, 0o600);
  const disk = (await readFile(databasePath)).toString('utf8');
  assert.equal(disk.includes('Moon Night'), false);
  assert.equal(disk.includes('Civic Hall'), false);
  assert.equal(disk.includes(EVENT_ID), false);

  const shortHarness = await createHarness(t, {
    resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle }) {
      void tenantId;
      void retentionHandle;
      return {
        expiresAtMs: Math.min(nowMs + 1_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
        policyId: 'synthetic-short-retention',
        policyVersion: '1',
        accessPolicy: 'tenant_private',
      };
    },
  });
  const shortBase = (await createSeed(shortHarness)).snapshot;
  const corrected = await correction(shortHarness, shortBase, 'event_date', { precision: 'date', value: '2027-06-20' }, 'short-retention-correction');
  assert.equal(corrected.snapshot.expiresAt, shortBase.expiresAt);
  shortHarness.clock.value += 1_001;
  assert.equal(await shortHarness.store.purgeExpired(shortHarness.scope, shortHarness.request), 1);
  await assert.rejects(shortHarness.store.getHistory(shortHarness.scope, EVENT_ID, shortHarness.request), assertReviewError('REVIEW_EXPIRED'));
  const [shortTenantEntry] = await readdir(shortHarness.root, { withFileTypes: true });
  const shortTenantPath = path.join(shortHarness.root, shortTenantEntry.name);
  const shortDirEntries = await readdir(shortTenantPath);
  assert.deepEqual(shortDirEntries.sort(), ['history.sqlite']);
  const expiredDisk = (await readFile(path.join(shortTenantPath, 'history.sqlite'))).toString('utf8');
  assert.equal(expiredDisk.includes('Moon Night'), false);
  assert.equal(expiredDisk.includes('Civic Hall'), false);
});

test('malformed arrays and hostile error codes become fixed typed failures without mutation', async (t) => {
  const harness = await createHarness(t);
  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  const unsafeLength = new Proxy([], {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'length') throw new Error('SYNTHETIC_PRIVATE_SECRET_LENGTH');
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const unsafeIndex = new Proxy([evidence('safe-id', 'safe')], {
    getOwnPropertyDescriptor(target, key) {
      if (key === '0') throw new Error('SYNTHETIC_PRIVATE_SECRET_INDEX');
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const unsafeKeys = new Proxy([], {
    ownKeys() { throw new Error('SYNTHETIC_PRIVATE_SECRET_KEYS'); },
  });
  const symbolArray = [evidence('symbol-id', 'symbol')];
  symbolArray[Symbol('unexpected')] = 'private';
  const sparseArray = Array(1);
  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    configurable: true,
    get() { throw new Error('SYNTHETIC_PRIVATE_SECRET_GETTER'); },
  });

  const badArrays = [revoked.proxy, unsafeLength, unsafeIndex, unsafeKeys, symbolArray, sparseArray, accessorArray];
  for (const [index, sourceEvidence] of badArrays.entries()) {
    const facts = initialFacts();
    facts.event_name.sourceEvidence = sourceEvidence;
    await assert.rejects(harness.store.createHistory(harness.scope, {
      eventId: EVENT_ID,
      sourceFacts: facts,
      idempotencyKey: `malformed-array-${index}`,
      retentionHandle: harness.createPermit(),
    }, harness.request), assertReviewError('REVIEW_INVALID'));
  }
  const coerciveCode = {
    [Symbol.toPrimitive]() { throw new Error('SYNTHETIC_ERROR_CODE_SECRET'); },
  };
  const safeError = new ReviewHistoryError(coerciveCode);
  assert.equal(safeError.code, 'REVIEW_STORAGE');
  assert.equal(safeError.message, 'correction history storage failed');
  assert.equal(new ReviewHistoryError(Symbol('invalid-code')).code, 'REVIEW_STORAGE');
  await assert.rejects(access(path.join(harness.root,
    createHash('sha256').update('event-intelligence:review-tenant:v1:tenant-a').digest('hex'),
    'history.sqlite')));
});

test('local date-time rejects DST gaps and preserves fold ambiguity without choosing an instant', async (t) => {
  const harness = await createHarness(t);
  let current = (await createSeed(harness)).snapshot;
  await assert.rejects(correction(harness, current, 'event_date', {
    precision: 'local_datetime', value: '2027-03-14T02:30', timeZone: 'America/New_York',
  }, 'dst-gap'), assertReviewError('REVIEW_INVALID'));
  await assert.rejects(correction(harness, current, 'event_date', {
    precision: 'local_datetime', value: '2027-06-20T09:15', timeZone: 'No/Such_Zone',
  }, 'bad-zone'), assertReviewError('REVIEW_INVALID'));

  const validLocal = await correction(harness, current, 'event_date', {
    precision: 'local_datetime', value: '2027-06-20T09:15', timeZone: 'America/New_York',
  }, 'valid-local');
  current = validLocal.snapshot;
  assert.deepEqual(current.fields.event_date.value, {
    precision: 'local_datetime', value: '2027-06-20T09:15', timeZone: 'America/New_York',
  });
  const folded = await correction(harness, current, 'event_date', {
    precision: 'local_datetime', value: '2027-11-07T01:30', timeZone: 'America/New_York',
  }, 'dst-fold');
  current = folded.snapshot;
  assert.deepEqual(current.fields.event_date.value, {
    precision: 'local_datetime', value: '2027-11-07T01:30', timeZone: 'America/New_York',
  });
  const leap = await correction(harness, current, 'event_date', { precision: 'date', value: '2028-02-29' }, 'leap-date');
  current = leap.snapshot;
  assert.deepEqual(current.fields.event_date.value, { precision: 'date', value: '2028-02-29' });
  await assert.rejects(correction(harness, current, 'event_date', {
    precision: 'instant', value: '2027-06-20T24:00:00Z',
  }, 'invalid-end-of-day'), assertReviewError('REVIEW_INVALID'));
  const instant = await correction(harness, current, 'event_date', {
    precision: 'instant', value: '2027-06-20T23:59:59Z',
  }, 'valid-instant');
  assert.deepEqual(instant.snapshot.fields.event_date.value, {
    precision: 'instant', value: '2027-06-20T23:59:59Z',
  });
});

test('event status conflicts and refresh disagreements create review questions for cancellation and reschedule', async (t) => {
  const harness = await createHarness(t, { lockedFields: [] });
  const facts = initialFacts();
  facts.event_status = {
    status: 'conflicting',
    candidates: [
      { originStatus: 'sourced', value: 'scheduled', sourceEvidence: [evidence('status-scheduled', 'scheduled')] },
      { originStatus: 'sourced', value: 'postponed', sourceEvidence: [evidence('status-postponed', 'postponed')] },
    ],
  };
  const first = (await createSeed(harness, facts)).snapshot;
  const firstStatusQuestion = first.questions.find((question) => question.field === 'event_status');
  assert.equal(firstStatusQuestion.code, 'CONFLICTING_SOURCE_FACTS');
  assert.equal(firstStatusQuestion.state, 'open');
  await assert.rejects(harness.store.createHistory(harness.scope, {
    eventId: 'event-customer-origin-blocked',
    sourceFacts: { event_status: { status: 'customer_supplied', value: 'cancelled' } },
    idempotencyKey: 'initial-customer-origin',
    retentionHandle: harness.createPermit(),
  }, harness.request), assertReviewError('REVIEW_INVALID'));

  const scheduled = (await correction(harness, first, 'event_status', 'scheduled', 'answer-status-conflict')).snapshot;
  assert.equal(scheduled.questions.find((question) => question.field === 'event_status').state, 'answered_customer_supplied');
  const cancelledRefresh = await harness.store.refreshSources(harness.scope, {
    eventId: EVENT_ID,
    baseVersionId: scheduled.versionId,
    baseContentHash: scheduled.contentHash,
    sourceFacts: { event_status: { status: 'sourced', value: 'cancelled', sourceEvidence: [evidence('status-cancelled-refresh', 'cancelled')] } },
    idempotencyKey: 'status-cancelled-refresh',
    retentionHandle: harness.createPermit(),
  }, harness.request);
  const cancelledQuestion = cancelledRefresh.snapshot.questions.find((question) => question.field === 'event_status'
    && question.code === 'SOURCE_REFRESH_REVIEW');
  assert.equal(cancelledQuestion.state, 'open');
  assert.equal(cancelledQuestion.candidates[0].value, 'cancelled');
  const cancelledAnswer = (await correction(harness, cancelledRefresh.snapshot, 'event_status', 'cancelled', 'answer-cancelled')).snapshot;
  assert.equal(cancelledAnswer.fields.event_status.status, 'customer_supplied');
  assert.equal(cancelledAnswer.fields.event_status.sourceClaims.length, 3);
  assert.equal(cancelledAnswer.questions.some((question) => question.code === 'SOURCE_REFRESH_REVIEW'), false);

  const rescheduledRefresh = await harness.store.refreshSources(harness.scope, {
    eventId: EVENT_ID,
    baseVersionId: cancelledAnswer.versionId,
    baseContentHash: cancelledAnswer.contentHash,
    sourceFacts: { event_status: { status: 'sourced', value: 'rescheduled', sourceEvidence: [evidence('status-rescheduled-refresh', 'rescheduled')] } },
    idempotencyKey: 'status-rescheduled-refresh',
    retentionHandle: harness.createPermit(),
  }, harness.request);
  const rescheduleQuestion = rescheduledRefresh.snapshot.questions.find((question) => question.field === 'event_status'
    && question.code === 'SOURCE_REFRESH_REVIEW');
  assert.equal(rescheduleQuestion.state, 'open');
  assert.equal(rescheduleQuestion.candidates[0].value, 'rescheduled');
  const rescheduledAnswer = (await correction(harness, rescheduledRefresh.snapshot, 'event_status', 'rescheduled', 'answer-rescheduled')).snapshot;
  assert.equal(rescheduledAnswer.fields.event_status.value, 'rescheduled');
  assert.equal(rescheduledAnswer.questions.some((question) => question.code === 'SOURCE_REFRESH_REVIEW'), false);
});

test('revocation or principal changes at asynchronous key, retention, and reference boundaries deny and roll back', async (t) => {
  for (const boundary of ['key', 'retention', 'reference_decryption']) {
    for (const change of ['revocation', 'principal_change']) {
      await t.test(`${boundary} with ${change}`, async (subtest) => {
        let permissionGranted = true;
        let actorNow = 'customer-a';
        let armed = false;
        let retentionCalls = 0;
        let payloadReadCalls = 0;
        const request = {
          principal: { tenantId: 'tenant-a', get actorId() { return actorNow; } },
          serverContextToken: TRUSTED_SERVER_CONTEXT,
        };
        const changePrincipal = () => {
          if (change === 'revocation') permissionGranted = false;
          else actorNow = 'reviewer-b';
        };
        const harness = await createHarness(subtest, {
          authorize({ tenantId, actorId, request: authRequest }) {
            return permissionGranted
              && authRequest?.serverContextToken === TRUSTED_SERVER_CONTEXT
              && authRequest?.principal?.tenantId === tenantId
              && authRequest?.principal?.actorId === actorId
              && actorId !== 'outsider';
          },
          resolveKey({ tenantId, purpose, keyId }) {
            const resolvedId = `${purpose}-v1`;
            if (keyId && keyId !== resolvedId) throw new Error('SYNTHETIC_KEY_ERROR');
            if (armed && boundary === 'key' && purpose === 'correction_index') changePrincipal();
            if (armed && boundary === 'reference_decryption' && purpose === 'correction_payload' && keyId) {
              payloadReadCalls += 1;
              if (payloadReadCalls === 2) changePrincipal();
            }
            return {
              keyId: resolvedId,
              key: createHash('sha256').update(`${tenantId}:${purpose}:test-only-key-material`).digest(),
            };
          },
          resolveRetention({ nowMs, sourceExpiresAtMs }) {
            retentionCalls += 1;
            if (armed && boundary === 'retention' && retentionCalls === 2) changePrincipal();
            return {
              expiresAtMs: Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
              policyId: 'synthetic-private-history',
              policyVersion: '1',
              accessPolicy: 'tenant_private',
            };
          },
        });
        const first = (await createSeed(harness)).snapshot;
        const dynamicScope = await harness.store.scopeForAuthenticatedRequest(request);
        if (boundary === 'reference_decryption') {
          await harness.store.registerDownstreamReference(dynamicScope, {
            eventId: EVENT_ID,
            versionId: first.versionId,
            contentHash: first.contentHash,
            referenceId: 'retained-reference-for-revocation',
            kind: 'handoff_reference',
          }, request);
          payloadReadCalls = 0;
        }
        retentionCalls = 0;
        armed = true;
        await assert.rejects(harness.store.applyCorrection(dynamicScope, {
          eventId: EVENT_ID,
          baseVersionId: first.versionId,
          baseContentHash: first.contentHash,
          field: 'event_date',
          value: { precision: 'date', value: '2027-06-20' },
          idempotencyKey: `denied-${boundary}-${change}`,
          retentionHandle: harness.createPermit(),
        }, request), assertReviewError('REVIEW_DENIED'));

        permissionGranted = true;
        actorNow = 'customer-a';
        armed = false;
        const disk = await inspectDatabase(harness.root);
        assert.equal(disk.heads.length, 1);
        assert.equal(disk.heads[0].version_id, first.versionId);
        assert.equal(disk.heads[0].content_hash, first.contentHash);
        assert.equal(disk.versions.length, 1);
        assert.equal(disk.idempotencyCount, 1);
        assert.equal(disk.invalidations, 0);
        assert.equal(disk.references, boundary === 'reference_decryption' ? 1 : 0);
        assert.equal((await harness.store.getHistory(harness.scope, EVENT_ID, harness.request)).versionId, first.versionId);
        if (boundary === 'reference_decryption') {
          const references = await harness.store.listDownstreamReferences(harness.scope, EVENT_ID, harness.request);
          assert.equal(references.length, 1);
          assert.equal(references[0].state, 'bound_to_version');
        }
      });
    }
  }
});

test('persisted expiry survives a later moving retention decision for initialize, correction, and refresh', async (t) => {
  for (const operation of ['initialize', 'correction', 'refresh']) {
    await t.test(operation, async (subtest) => {
      let currentTime = EPOCH;
      let armed = operation === 'initialize';
      let retentionCalls = 0;
      const harness = await createHarness(subtest, {
        now: () => currentTime,
        resolveRetention({ nowMs, sourceExpiresAtMs }) {
          retentionCalls += 1;
          let expiresAtMs;
          if (!armed) expiresAtMs = Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER);
          else if (retentionCalls === 1) expiresAtMs = EPOCH + 1_000;
          else {
            currentTime = EPOCH + 1_000; // Equality at the immutable snapshot boundary must fail.
            expiresAtMs = EPOCH + 3_000;
          }
          return {
            expiresAtMs: Math.min(expiresAtMs, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
            policyId: 'synthetic-private-history',
            policyVersion: '1',
            accessPolicy: 'tenant_private',
          };
        },
      });

      if (operation === 'initialize') {
        const facts = initialFacts();
        await assert.rejects(harness.store.createHistory(harness.scope, {
          eventId: EVENT_ID,
          sourceFacts: facts,
          idempotencyKey: 'moving-initialize-expiry',
          retentionHandle: harness.createPermit(),
        }, harness.request), assertReviewError('REVIEW_EXPIRED'));
        const disk = await inspectDatabase(harness.root);
        assert.equal(disk.heads.length, 0);
        assert.equal(disk.idempotencyCount, 0);
        assert.equal(disk.versions.length, 0);
      } else {
        const first = (await createSeed(harness)).snapshot;
        armed = true;
        retentionCalls = 0;
        if (operation === 'correction') {
          await assert.rejects(correction(harness, first, 'event_date', {
            precision: 'date', value: '2027-06-20',
          }, 'moving-correction-expiry'), assertReviewError('REVIEW_EXPIRED'));
        } else {
          await assert.rejects(harness.store.refreshSources(harness.scope, {
            eventId: EVENT_ID,
            baseVersionId: first.versionId,
            baseContentHash: first.contentHash,
            sourceFacts: { event_name: { status: 'sourced', value: 'Updated Moon Night', sourceEvidence: [evidence('moving-refresh', 'Updated Moon Night')] } },
            idempotencyKey: 'moving-refresh-expiry',
            retentionHandle: harness.createPermit(),
          }, harness.request), assertReviewError('REVIEW_EXPIRED'));
        }
        const disk = await inspectDatabase(harness.root);
        assert.equal(disk.heads[0].version_id, first.versionId);
        assert.equal(disk.versions.length, 1);
        assert.equal(disk.idempotencyCount, 1);
        assert.equal(disk.invalidations, 0);
      }
    });
  }
});

test('reads and idempotent replay reject expiry reached during decryption and commit the purge', async (t) => {
  for (const operation of ['head', 'version', 'history_list', 'reference_list', 'replay']) {
    await t.test(operation, async (subtest) => {
      let currentTime = EPOCH;
      let expireDuringPayloadRead = false;
      const expiresAtMs = EPOCH + 1_000;
      const harness = await createHarness(subtest, {
        now: () => currentTime,
        resolveKey({ tenantId, purpose, keyId }) {
          const resolvedId = `${purpose}-v1`;
          if (keyId && keyId !== resolvedId) throw new Error('SYNTHETIC_KEY_ERROR');
          if (expireDuringPayloadRead && purpose === 'correction_payload' && keyId) currentTime = expiresAtMs;
          return {
            keyId: resolvedId,
            key: createHash('sha256').update(`${tenantId}:${purpose}:test-only-key-material`).digest(),
          };
        },
        resolveRetention({ sourceExpiresAtMs }) {
          return {
            expiresAtMs: Math.min(expiresAtMs, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
            policyId: 'synthetic-short-retention',
            policyVersion: '1',
            accessPolicy: 'tenant_private',
          };
        },
      });
      const first = (await createSeed(harness)).snapshot;
      let committedCorrection;
      let correctionInput;
      if (operation === 'reference_list') {
        await harness.store.registerDownstreamReference(harness.scope, {
          eventId: EVENT_ID,
          versionId: first.versionId,
          contentHash: first.contentHash,
          referenceId: 'expiry-reference',
          kind: 'handoff_reference',
        }, harness.request);
      }
      if (operation === 'replay') {
        correctionInput = {
          eventId: EVENT_ID,
          baseVersionId: first.versionId,
          baseContentHash: first.contentHash,
          field: 'event_date',
          value: { precision: 'date', value: '2027-06-20' },
          idempotencyKey: 'expiry-replay',
          retentionHandle: harness.createPermit(),
        };
        committedCorrection = await harness.store.applyCorrection(harness.scope, correctionInput, harness.request);
      }
      currentTime = expiresAtMs - 1;
      expireDuringPayloadRead = true;
      let operationPromise;
      if (operation === 'head') operationPromise = harness.store.getHistory(harness.scope, EVENT_ID, harness.request);
      if (operation === 'version') operationPromise = harness.store.getHistoryVersion(harness.scope, EVENT_ID, first.versionId, harness.request);
      if (operation === 'history_list') operationPromise = harness.store.listHistory(harness.scope, EVENT_ID, harness.request);
      if (operation === 'reference_list') operationPromise = harness.store.listDownstreamReferences(harness.scope, EVENT_ID, harness.request);
      if (operation === 'replay') operationPromise = harness.store.applyCorrection(harness.scope, correctionInput, harness.request);
      await assert.rejects(operationPromise, (error) => error instanceof ReviewHistoryError
        && ['REVIEW_EXPIRED', 'REVIEW_NOT_FOUND'].includes(error.code));
      const disk = await inspectDatabase(harness.root);
      assert.equal(disk.heads[0].state, 'expired');
      assert.equal(disk.versions.every((row) => row.state === 'expired' && row.version_id === null && row.sealed === null), true);
      assert.equal(disk.idempotencyCount, 0);
      assert.equal(disk.references, 0);
      assert.equal(disk.invalidations, 0);
      assert.equal(disk.sealedBytes, 0);
      if (committedCorrection) assert.equal(committedCorrection.snapshot.revision, 2);
    });
  }
});

test('any denied expired operation commits ciphertext, idempotency, reference, and invalidation cleanup', async (t) => {
  for (const operation of ['get', 'version', 'list', 'references', 'replay', 'failed_write']) {
    await t.test(operation, async (subtest) => {
      let currentTime = EPOCH;
      const expiresAtMs = EPOCH + 1_000;
      const harness = await createHarness(subtest, {
        now: () => currentTime,
        resolveRetention({ sourceExpiresAtMs }) {
          return {
            expiresAtMs: Math.min(expiresAtMs, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
            policyId: 'synthetic-short-retention',
            policyVersion: '1',
            accessPolicy: 'tenant_private',
          };
        },
      });
      const first = (await createSeed(harness)).snapshot;
      await harness.store.registerDownstreamReference(harness.scope, {
        eventId: EVENT_ID,
        versionId: first.versionId,
        contentHash: first.contentHash,
        referenceId: `expiry-cleanup-${operation}`,
        kind: 'approval_reference',
      }, harness.request);
      const correctionInput = {
        eventId: EVENT_ID,
        baseVersionId: first.versionId,
        baseContentHash: first.contentHash,
        field: 'event_date',
        value: { precision: 'date', value: '2027-06-20' },
        idempotencyKey: `expiry-cleanup-correction-${operation}`,
        retentionHandle: harness.createPermit(),
      };
      const second = (await harness.store.applyCorrection(harness.scope, correctionInput, harness.request)).snapshot;
      assert.equal(second.invalidations.length, 1);
      currentTime = expiresAtMs + 1;
      let expiredOperation;
      if (operation === 'get') expiredOperation = harness.store.getHistory(harness.scope, EVENT_ID, harness.request);
      if (operation === 'version') expiredOperation = harness.store.getHistoryVersion(harness.scope, EVENT_ID, first.versionId, harness.request);
      if (operation === 'list') expiredOperation = harness.store.listHistory(harness.scope, EVENT_ID, harness.request);
      if (operation === 'references') expiredOperation = harness.store.listDownstreamReferences(harness.scope, EVENT_ID, harness.request);
      if (operation === 'replay') expiredOperation = harness.store.applyCorrection(harness.scope, correctionInput, harness.request);
      if (operation === 'failed_write') expiredOperation = harness.store.applyCorrection(harness.scope, {
        ...correctionInput,
        baseVersionId: second.versionId,
        baseContentHash: second.contentHash,
        value: { precision: 'date', value: '2027-06-21' },
        idempotencyKey: `expiry-cleanup-failed-${operation}`,
      }, harness.request);
      await assert.rejects(expiredOperation, (error) => error instanceof ReviewHistoryError
        && ['REVIEW_EXPIRED', 'REVIEW_NOT_FOUND'].includes(error.code));
      const disk = await inspectDatabase(harness.root);
      assert.equal(disk.heads.length, 1);
      assert.equal(disk.heads[0].state, 'expired');
      assert.equal(disk.heads[0].version_id, null);
      assert.equal(disk.versions.length, 2);
      assert.equal(disk.versions.every((row) => row.state === 'expired' && row.version_id === null
        && row.parent_version_id === null && row.content_hash === null && row.sealed === null), true);
      assert.equal(disk.idempotencyCount, 0);
      assert.equal(disk.references, 0);
      assert.equal(disk.invalidations, 0);
      assert.equal(disk.sealedBytes, 0);
    });
  }
});

test('512 KiB ceiling measures the sealed envelope and rejected refresh preserves the whole base', async (t) => {
  const candidates = (prefix, count) => Array.from({ length: count }, (_, candidateIndex) => ({
    originStatus: 'sourced',
    value: `Venue ${prefix} ${candidateIndex}`,
    sourceEvidence: Array.from({ length: 32 }, (_, referenceIndex) => {
      const suffix = `${prefix}-${candidateIndex}-${referenceIndex}`;
      const evidenceId = `${suffix}-${'x'.repeat(179 - suffix.length)}`;
      return evidence(evidenceId, `${prefix}:${candidateIndex}:${referenceIndex}`);
    }),
  }));
  const nearHarness = await createHarness(t);
  const nearSnapshot = (await nearHarness.store.createHistory(nearHarness.scope, {
    eventId: EVENT_ID,
    sourceFacts: {
      event_name: { status: 'sourced', value: 'Near Limit', sourceEvidence: [evidence('near-limit-name', 'near')] },
      event_date: { status: 'missing' },
      venue: { status: 'conflicting', candidates: candidates('near', 10) },
    },
    idempotencyKey: 'near-envelope-limit',
    retentionHandle: nearHarness.createPermit(),
  }, nearHarness.request)).snapshot;
  const nearDisk = await inspectDatabase(nearHarness.root);
  const nearEnvelopeLength = nearDisk.versionSealedLengths[0];
  assert.equal(nearSnapshot.revision, 1);
  assert.ok(nearEnvelopeLength > 450_000, `expected a near-limit envelope, got ${nearEnvelopeLength}`);
  assert.ok(nearEnvelopeLength <= 512 * 1024, `envelope exceeded its ceiling: ${nearEnvelopeLength}`);

  const rejectHarness = await createHarness(t);
  const baseFacts = initialFacts();
  baseFacts.venue = { status: 'missing' };
  const first = (await createSeed(rejectHarness, baseFacts)).snapshot;
  await rejectHarness.store.registerDownstreamReference(rejectHarness.scope, {
    eventId: EVENT_ID,
    versionId: first.versionId,
    contentHash: first.contentHash,
    referenceId: 'size-rejection-bound-reference',
    kind: 'approval_reference',
  }, rejectHarness.request);
  await assert.rejects(rejectHarness.store.refreshSources(rejectHarness.scope, {
    eventId: EVENT_ID,
    baseVersionId: first.versionId,
    baseContentHash: first.contentHash,
    sourceFacts: { venue: { status: 'conflicting', candidates: candidates('over', 12) } },
    idempotencyKey: 'over-envelope-limit',
    retentionHandle: rejectHarness.createPermit(),
  }, rejectHarness.request), assertReviewError('REVIEW_STORAGE_LIMIT'));
  const rejectedDisk = await inspectDatabase(rejectHarness.root);
  assert.equal(rejectedDisk.heads[0].version_id, first.versionId);
  assert.equal(rejectedDisk.versions.length, 1);
  assert.equal(rejectedDisk.idempotencyCount, 1);
  assert.equal(rejectedDisk.invalidations, 0);
  assert.equal(rejectedDisk.references, 1);
  assert.equal((await rejectHarness.store.listDownstreamReferences(rejectHarness.scope, EVENT_ID, rejectHarness.request))[0].state, 'bound_to_version');
});

test('expiry cleanup migrates prior non-null version tombstones and clears linked private rows', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-review-history-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tenantId = 'tenant-a';
  const actorId = 'customer-a';
  const eventId = 'legacy-event';
  const tenantHash = createHash('sha256').update(`event-intelligence:review-tenant:v1:${tenantId}`).digest('hex');
  const tenantDirectory = path.join(root, tenantHash);
  await mkdir(tenantDirectory, { mode: 0o700 });
  const databasePath = path.join(tenantDirectory, 'history.sqlite');
  const database = new DatabaseSync(databasePath);
  const eventKey = createHmac('sha256', createHash('sha256').update(`${tenantId}:correction_index:test-only-key-material`).digest())
    .update(`event-intelligence:review-index:v1:${tenantHash}:event:${eventId}`).digest('hex');
  const oldVersionId = 'prior-schema-version';
  database.exec(`
    CREATE TABLE versions (
      event_key TEXT NOT NULL, revision INTEGER NOT NULL, version_id TEXT NOT NULL, parent_version_id TEXT,
      content_hash TEXT, material_hash TEXT, expires_at_ms INTEGER, encryption_key_id TEXT, sealed BLOB,
      state TEXT NOT NULL CHECK (state IN ('available', 'expired')),
      PRIMARY KEY (event_key, revision), UNIQUE (event_key, version_id)
    ) STRICT;
    CREATE TABLE heads (
      event_key TEXT PRIMARY KEY NOT NULL, revision INTEGER, version_id TEXT, content_hash TEXT,
      material_hash TEXT, expires_at_ms INTEGER,
      state TEXT NOT NULL CHECK (state IN ('available', 'expired'))
    ) STRICT;
    CREATE TABLE idempotency (
      event_key TEXT NOT NULL, key_hash TEXT NOT NULL, fingerprint TEXT NOT NULL, version_id TEXT NOT NULL,
      PRIMARY KEY (event_key, key_hash)
    ) STRICT;
    CREATE TABLE downstream_references (
      event_key TEXT NOT NULL, reference_hash TEXT NOT NULL, bound_version_id TEXT NOT NULL,
      bound_content_hash TEXT NOT NULL, encryption_key_id TEXT NOT NULL, sealed BLOB NOT NULL,
      PRIMARY KEY (event_key, reference_hash)
    ) STRICT;
    CREATE TABLE invalidations (
      event_key TEXT NOT NULL, reference_hash TEXT NOT NULL, prior_version_id TEXT NOT NULL,
      prior_content_hash TEXT NOT NULL, next_version_id TEXT NOT NULL,
      material_change INTEGER NOT NULL CHECK (material_change IN (0, 1)), reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (event_key, reference_hash, prior_version_id, prior_content_hash)
    ) STRICT;
  `);
  database.prepare(`INSERT INTO versions VALUES (?, 1, ?, NULL, ?, ?, ?, ?, ?, 'available')`)
    .run(eventKey, oldVersionId, 'a'.repeat(64), 'b'.repeat(64), EPOCH - 1, 'payload-key-v1', Buffer.from('synthetic-ciphertext'));
  database.prepare(`INSERT INTO heads VALUES (?, 1, ?, ?, ?, ?, 'available')`)
    .run(eventKey, oldVersionId, 'a'.repeat(64), 'b'.repeat(64), EPOCH - 1);
  database.prepare('INSERT INTO idempotency VALUES (?, ?, ?, ?)')
    .run(eventKey, 'synthetic-key-hash', 'synthetic-fingerprint', oldVersionId);
  database.prepare('INSERT INTO downstream_references VALUES (?, ?, ?, ?, ?, ?)')
    .run(eventKey, 'synthetic-reference-hash', oldVersionId, 'a'.repeat(64), 'payload-key-v1', Buffer.from('synthetic-reference-ciphertext'));
  database.prepare('INSERT INTO invalidations VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .run(eventKey, 'synthetic-reference-hash', oldVersionId, 'a'.repeat(64), 'next-version', 'material_projection_changed', new Date(EPOCH - 2).toISOString());
  database.close();

  const request = { tenantId, actorId };
  const store = createCorrectionHistoryStore({
    directory: root,
    resolveTenant: (context) => context.tenantId,
    resolveActor: (context) => context.actorId,
    authorize: ({ tenantId: authorizedTenant, actorId: authorizedActor, request: context }) =>
      context.tenantId === authorizedTenant && context.actorId === authorizedActor,
    resolveKey: () => ({ keyId: 'unused-test-key', key: Buffer.alloc(32) }),
    resolveRetention: () => ({ expiresAtMs: EPOCH + 1_000, policyId: 'unused', policyVersion: '1', accessPolicy: 'tenant_private' }),
    now: () => EPOCH,
    lockedFields: [],
  });
  const scope = await store.scopeForAuthenticatedRequest(request);
  assert.equal(await store.purgeExpired(scope, request), 1);
  const disk = await inspectDatabase(root, tenantId);
  assert.equal(disk.heads[0].state, 'expired');
  assert.equal(disk.versions.length, 1);
  assert.equal(disk.versions[0].version_id, null);
  assert.equal(disk.versions[0].sealed, null);
  assert.equal(disk.idempotencyCount, 0);
  assert.equal(disk.references, 0);
  assert.equal(disk.invalidations, 0);
  assert.equal(disk.sealedBytes, 0);
});
