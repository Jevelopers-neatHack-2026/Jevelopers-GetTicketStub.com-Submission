import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
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
