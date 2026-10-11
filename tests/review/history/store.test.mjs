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
    authorizeBoundary(input) {
      const allowed = input.request?.serverContextToken === TRUSTED_SERVER_CONTEXT
        && input.request?.principal?.tenantId === input.tenantId
        && input.request?.principal?.actorId === input.actorId
        && input.actorId !== 'outsider';
      let boundaryNow = clock.value;
      if (typeof overrides.now === 'function') {
        try { boundaryNow = overrides.now(); } catch { return false; }
      }
      return allowed ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
        eventId: input.eventId, action: input.action, field: input.field, nowMs: boundaryNow }) : false;
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

async function waitForSignal(signal, label, timeoutMs = 3_000) {
  let timer;
  try {
    await Promise.race([
      signal,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function inspectDatabase(root, tenantId = 'tenant-a') {
  const tenantHash = createHash('sha256').update(`event-intelligence:review-tenant:v1:${tenantId}`).digest('hex');
  const database = new DatabaseSync(path.join(root, tenantHash, 'history.sqlite'));
  try {
    return {
      heads: database.prepare('SELECT * FROM heads ORDER BY event_key').all(),
      versions: database.prepare(`SELECT event_key, revision, version_id, parent_version_id, content_hash, material_hash,
        expires_at_ms, encryption_key_id, sealed, state FROM versions ORDER BY event_key, revision`).all(),
      versionSealedLengths: database.prepare('SELECT length(sealed) AS length FROM versions WHERE sealed IS NOT NULL ORDER BY event_key, revision').all()
        .map((row) => row.length),
      idempotencyCount: database.prepare('SELECT COUNT(*) AS count FROM idempotency').get().count,
      idempotencyRows: database.prepare('SELECT * FROM idempotency ORDER BY event_key, key_hash').all(),
      references: database.prepare('SELECT COUNT(*) AS count FROM downstream_references').get().count,
      referenceRows: database.prepare('SELECT * FROM downstream_references ORDER BY event_key, reference_hash').all(),
      invalidations: database.prepare('SELECT COUNT(*) AS count FROM invalidations').get().count,
      invalidationRows: database.prepare('SELECT * FROM invalidations ORDER BY event_key, reference_hash, prior_version_id, prior_content_hash').all(),
      correctionCacheOperations: database.prepare('SELECT COUNT(*) AS count FROM correction_cache_operations').get().count,
      pendingCorrectionCacheOperations: database.prepare("SELECT COUNT(*) AS count FROM correction_cache_state WHERE phase != 'complete'").get().count,
      sealedBytes: database.prepare("SELECT COALESCE(SUM(length(sealed)), 0) AS count FROM versions WHERE sealed IS NOT NULL").get().count
        + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS count FROM downstream_references').get().count,
    };
  } finally {
    database.close();
  }
}

async function inspectHistoryClockMax(root, tenantId = 'tenant-a') {
  const tenantHash = createHash('sha256').update(`event-intelligence:review-tenant:v1:${tenantId}`).digest('hex');
  const database = new DatabaseSync(path.join(root, tenantHash, 'history.sqlite'));
  try {
    const row = database.prepare("SELECT value FROM correction_cache_meta WHERE key = 'clock_max_ms'").get();
    return row ? Number(row.value) : null;
  } finally {
    database.close();
  }
}

function historyDatabasePath(root, tenantId = 'tenant-a') {
  const tenantHash = createHash('sha256').update(`event-intelligence:review-tenant:v1:${tenantId}`).digest('hex');
  return path.join(root, tenantHash, 'history.sqlite');
}

async function awaitWithTimeout(value, label, timeoutMs = 4_000) {
  let timer;
  try {
    return await Promise.race([
      value,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function createWriterAuthorizationRaceHarness(t, revokeOnFirstWriterAttempt) {
  let resolveRetryObserved;
  const retryObserved = new Promise((resolve) => { resolveRetryObserved = resolve; });
  const race = {
    request: null,
    action: null,
    operationHandle: null,
    retentionCalls: 0,
    armNextPreBeginPair: false,
    preBeginPairRemaining: 0,
    revokeOnFirstWriterAttempt,
    revokeAtNextNow: false,
    writer: null,
    writerAcquired: false,
    writerAcquireError: null,
    writerReleased: false,
    retryAuthorizationCalls: 0,
    boundaryAttempts: 0,
    busyAttemptObserved: false,
    retryObserved,
    retryObservedSignalled: false,
    resolveRetryObserved,
    root: null,
    clock: null,
    releaseWriter() {
      if (!race.writer) return;
      try { race.writer.exec('ROLLBACK'); } catch { /* It may already have rolled back. */ }
      try { race.writer.close(); } catch { /* It may already be closed. */ }
      race.writer = null;
      race.writerReleased = true;
    },
    signalRetry() {
      if (race.retryObservedSignalled) return;
      race.retryObservedSignalled = true;
      race.resolveRetryObserved();
    },
  };
  const request = { principal: { tenantId: 'tenant-a', actorId: 'customer-a' }, serverContextToken: TRUSTED_SERVER_CONTEXT };
  race.request = request;
  const harness = await createHarness(t, {
    lockTimeoutMs: 1_000,
    resolveActor(value) {
      if (value === race.request && value.principal.actorId === 'actor-revoked') race.signalRetry();
      return value?.principal?.actorId;
    },
    authorize({ tenantId, actorId, action, request: value }) {
      return value?.serverContextToken === TRUSTED_SERVER_CONTEXT
        && value?.principal?.tenantId === tenantId
        && value?.principal?.actorId === actorId
        && actorId !== 'outsider' && actorId !== 'actor-revoked';
    },
    authorizeBoundary(input) {
      const actionByLegacy = {
        initialize_history: 'review.history.initialize',
        apply_correction: 'review.history.apply_correction',
        refresh_source_facts: 'review.history.refresh_source_facts',
      };
      const matchesOperation = input.request === race.request && input.action === actionByLegacy[race.action];
      if (matchesOperation) {
        race.boundaryAttempts += 1;
        if (race.armNextPreBeginPair && !race.writerAcquired) {
          race.armNextPreBeginPair = false;
          try {
            race.writer = new DatabaseSync(historyDatabasePath(race.root), { timeout: 0 });
            race.writer.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
            race.writerAcquired = true;
          } catch (error) {
            race.writerAcquireError = error;
          }
        } else if (race.writerAcquired && !race.writerReleased && race.boundaryAttempts > 1) {
          race.busyAttemptObserved = true;
          race.retryAuthorizationCalls += 1;
          if (race.revokeOnFirstWriterAttempt) {
            race.request.principal.actorId = 'actor-revoked';
            race.signalRetry();
            return false;
          }
          race.releaseWriter();
          race.signalRetry();
        }
      }
      const allowed = input.request?.serverContextToken === TRUSTED_SERVER_CONTEXT
        && input.request?.principal?.tenantId === input.tenantId
        && input.request?.principal?.actorId === input.actorId
        && input.actorId !== 'outsider' && input.actorId !== 'actor-revoked';
      return allowed ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
        eventId: input.eventId, action: input.action, field: input.field, nowMs: race.clock?.value ?? EPOCH }) : false;
    },
    resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (!retentionHandle || typeof retentionHandle !== 'object') throw new Error('synthetic retention denial');
      if (retentionHandle === race.operationHandle) {
        race.retentionCalls += 1;
        if (race.retentionCalls === 2) race.armNextPreBeginPair = true;
      }
      return {
        expiresAtMs: Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
        policyId: 'synthetic-private-history',
        policyVersion: '1',
        accessPolicy: 'tenant_private',
      };
    },
    now: () => race.clock?.value ?? EPOCH,
  });
  race.root = harness.root;
  race.clock = harness.clock;
  t.after(() => {
    race.request.principal.actorId = 'customer-a';
    race.releaseWriter();
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request);
  return { harness, race, request, scope };
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

test('asynchronous same-process corrections across store instances serialize to one CAS winner', async (t) => {
  const harness = await createHarness(t, {
    lockTimeoutMs: 25,
    async authorize({ tenantId, actorId, request }) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return request?.serverContextToken === TRUSTED_SERVER_CONTEXT
        && request?.principal?.tenantId === tenantId
        && request?.principal?.actorId === actorId
        && actorId !== 'outsider';
    },
  });
  const first = (await createSeed(harness)).snapshot;
  const otherStore = harness.openStore();
  const otherScope = await otherStore.scopeForAuthenticatedRequest(harness.request);
  const makeInput = (value, idempotencyKey) => ({
    eventId: EVENT_ID,
    baseVersionId: first.versionId,
    baseContentHash: first.contentHash,
    field: 'event_date',
    value: { precision: 'date', value },
    idempotencyKey,
    retentionHandle: harness.createPermit(),
  });
  const [left, right] = await Promise.allSettled([
    harness.store.applyCorrection(harness.scope, makeInput('2027-06-20', 'async-same-process-left'), harness.request),
    otherStore.applyCorrection(otherScope, makeInput('2027-06-21', 'async-same-process-right'), harness.request),
  ]);
  const outcomes = [left, right];
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
  const rejected = outcomes.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'REVIEW_VERSION_CONFLICT');
  assert.equal(rejected.reason.code === 'REVIEW_BUSY', false);
  const history = await harness.store.listHistory(harness.scope, EVENT_ID, harness.request);
  assert.deepEqual(history.map((snapshot) => snapshot.revision), [1, 2]);
});

test('persistVersion succeeds after an actual SQLite writer conflict and reauthorizes the retry', async (t) => {
  const { harness, race, request, scope } = await createWriterAuthorizationRaceHarness(t, false);
  race.action = 'apply_correction';
  const first = (await harness.store.createHistory(scope, {
    eventId: EVENT_ID,
    sourceFacts: initialFacts(),
    idempotencyKey: 'writer-retry-seed',
    retentionHandle: harness.createPermit(),
  }, request)).snapshot;
  race.operationHandle = harness.createPermit();
  const input = {
    eventId: EVENT_ID,
    baseVersionId: first.versionId,
    baseContentHash: first.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-20' },
    idempotencyKey: 'writer-retry-positive-correction',
    retentionHandle: race.operationHandle,
  };

  const result = await awaitWithTimeout(harness.store.applyCorrection(scope, input, request), 'authorized SQLite writer retry');
  await waitForSignal(race.retryObserved, 'fresh authorization after the busy writer attempt');
  assert.equal(race.writerAcquired, true, race.writerAcquireError?.message);
  assert.equal(race.writerReleased, true);
  assert.equal(race.retryAuthorizationCalls >= 1, true);
  assert.equal(race.busyAttemptObserved, true, 'the first BEGIN was blocked by the retained external writer');
  assert.equal(result.snapshot.revision, 2);
  assert.equal((await harness.store.listHistory(scope, EVENT_ID, request)).length, 2);
});

test('persistVersion denies disclosure after a committed revision when authorization is revoked at the return boundary', async (t) => {
  let root;
  let denyCommittedDisclosure = false;
  let committedRevisionSeenByGuard = null;
  let disclosureDenials = 0;
  const harness = await createHarness(t, {
    authorize({ tenantId, actorId, action, request }) {
      return request?.serverContextToken === TRUSTED_SERVER_CONTEXT
        && request?.principal?.tenantId === tenantId
        && request?.principal?.actorId === actorId
        && actorId !== 'outsider';
    },
    authorizeBoundary(input) {
      let allowed = input.request?.serverContextToken === TRUSTED_SERVER_CONTEXT
        && input.request?.principal?.tenantId === input.tenantId
        && input.request?.principal?.actorId === input.actorId && input.actorId !== 'outsider';
      if (allowed && input.action === 'private_profile.read' && input.details?.sourceAction === 'apply_correction'
        && denyCommittedDisclosure) {
        const database = new DatabaseSync(historyDatabasePath(root), { timeout: 0 });
        let revision;
        try {
          revision = database.prepare('SELECT revision FROM heads ORDER BY event_key LIMIT 1').get()?.revision ?? null;
        } finally {
          database.close();
        }
        if (revision === 2) {
          committedRevisionSeenByGuard = revision;
          disclosureDenials += 1;
          denyCommittedDisclosure = false;
          allowed = false;
        }
      }
      return allowed ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
        eventId: input.eventId, action: input.action, field: input.field, nowMs: harness?.clock.value ?? EPOCH }) : false;
    },
  });
  root = harness.root;
  const { request, scope, store } = harness;
  const first = (await store.createHistory(scope, {
    eventId: EVENT_ID,
    sourceFacts: initialFacts(),
    idempotencyKey: 'disclosure-boundary-seed',
    retentionHandle: harness.createPermit(),
  }, request)).snapshot;
  const input = {
    eventId: EVENT_ID,
    baseVersionId: first.versionId,
    baseContentHash: first.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-23' },
    idempotencyKey: 'disclosure-boundary-correction',
    retentionHandle: harness.createPermit(),
  };

  denyCommittedDisclosure = true;
  const deniedResult = await awaitWithTimeout(
    store.applyCorrection(scope, input, request),
    'post-commit authorization denial',
  ).then(() => null, (error) => error);
  assert.equal(deniedResult?.code, 'REVIEW_DENIED');
  assert.equal(committedRevisionSeenByGuard, 2);
  assert.equal(disclosureDenials, 1);

  const committed = await inspectDatabase(harness.root);
  assert.equal(committed.heads.length, 1);
  assert.equal(committed.heads[0].revision, 2);
  assert.equal(committed.versions.length, 2);
  assert.equal(committed.idempotencyCount, 2);
  assert.equal(committed.correctionCacheOperations, 0);
  assert.equal(committed.pendingCorrectionCacheOperations, 0);

  const replay = await awaitWithTimeout(
    store.applyCorrection(scope, input, request),
    'exact replay after disclosure authorization is restored',
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.snapshot.revision, 2);
  const afterReplay = await inspectDatabase(harness.root);
  assert.equal(afterReplay.versions.length, 2);
  assert.equal(afterReplay.idempotencyCount, 2);
});

test('persistVersion denies an actor revoked between a real busy writer attempt and its retry, then exact retry succeeds', async (t) => {
  const scenarios = [
    { operation: 'initialize', action: 'initialize_history' },
    { operation: 'correction', action: 'apply_correction' },
    { operation: 'source refresh', action: 'refresh_source_facts' },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.operation, async (subtest) => {
      const { harness, race, request, scope } = await createWriterAuthorizationRaceHarness(subtest, true);
      let base;
      if (scenario.operation !== 'initialize') {
        base = (await harness.store.createHistory(scope, {
          eventId: EVENT_ID,
          sourceFacts: initialFacts(),
          idempotencyKey: `writer-revoke-seed-${scenario.operation.replaceAll(' ', '-')}`,
          retentionHandle: harness.createPermit(),
        }, request)).snapshot;
      }
      race.action = scenario.action;
      race.operationHandle = harness.createPermit();
      const input = scenario.operation === 'initialize'
        ? {
          eventId: EVENT_ID,
          sourceFacts: initialFacts(),
          idempotencyKey: 'writer-revoke-initialize',
          retentionHandle: race.operationHandle,
        }
        : scenario.operation === 'correction'
          ? {
            eventId: EVENT_ID,
            baseVersionId: base.versionId,
            baseContentHash: base.contentHash,
            field: 'event_date',
            value: { precision: 'date', value: '2027-06-21' },
            idempotencyKey: 'writer-revoke-correction',
            retentionHandle: race.operationHandle,
          }
          : {
            eventId: EVENT_ID,
            baseVersionId: base.versionId,
            baseContentHash: base.contentHash,
            sourceFacts: { event_date: sourceDate('2027-06-22', 'writer-revoke-refresh') },
            idempotencyKey: 'writer-revoke-source-refresh',
            retentionHandle: race.operationHandle,
          };
      const run = () => scenario.operation === 'initialize'
        ? harness.store.createHistory(scope, input, request)
        : scenario.operation === 'correction'
          ? harness.store.applyCorrection(scope, input, request)
          : harness.store.refreshSources(scope, input, request);
      const before = scenario.operation === 'initialize' ? null : await inspectDatabase(harness.root);

      const rejected = await awaitWithTimeout(run(), `revoked ${scenario.operation} writer retry`)
        .then(() => null, (error) => error);
      assert.equal(rejected?.code, 'REVIEW_DENIED', JSON.stringify({
        code: rejected?.code,
        actorId: request.principal.actorId,
        revokeAtNextNow: race.revokeAtNextNow,
        armNextPreBeginPair: race.armNextPreBeginPair,
        preBeginPairRemaining: race.preBeginPairRemaining,
        writerAcquired: race.writerAcquired,
        writerAcquireError: race.writerAcquireError?.message,
        writerReleased: race.writerReleased,
        retryObservedSignalled: race.retryObservedSignalled,
        retentionCalls: race.retentionCalls,
      }));
      await waitForSignal(race.retryObserved, `revoked ${scenario.operation} retry authorization`);
      assert.equal(race.writerAcquired, true, race.writerAcquireError?.message);
      assert.equal(race.writerReleased, false);
      assert.equal(race.busyAttemptObserved, true, 'retry boundary proves the first BEGIN hit SQLite contention');
      race.releaseWriter();
      const after = await inspectDatabase(harness.root);
      if (scenario.operation === 'initialize') {
        assert.equal(after.heads.length, 0);
        assert.equal(after.versions.length, 0);
        assert.equal(after.idempotencyCount, 0);
      } else {
        assert.equal(after.heads[0].version_id, before.heads[0].version_id);
        assert.equal(after.versions.length, before.versions.length);
        assert.equal(after.idempotencyCount, before.idempotencyCount);
        assert.equal(after.invalidations, before.invalidations);
      }
      assert.equal(after.correctionCacheOperations, 0);
      assert.equal(after.pendingCorrectionCacheOperations, 0);

      request.principal.actorId = 'customer-a';
      const retried = await awaitWithTimeout(run(), `exact authorized ${scenario.operation} retry`);
      assert.equal(retried.snapshot.revision, scenario.operation === 'initialize' ? 1 : 2);
      assert.equal((await harness.store.listHistory(scope, EVENT_ID, request)).length, scenario.operation === 'initialize' ? 1 : 2);
    });
  }
});

test('persistVersion reauthorizes after its transaction clock sample before any revision write', async (t) => {
  const scenarios = [
    { operation: 'initialize', action: 'initialize_history' },
    { operation: 'correction', action: 'apply_correction' },
    { operation: 'source refresh', action: 'refresh_source_facts' },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.operation, async (subtest) => {
      let requestValue;
      let currentActor = 'customer-a';
      let root;
      let operationHandle;
      let retentionCalls = 0;
      let revokeAtTransactionClock = false;
      let clockBoundaryReached = false;
      let clockCallbackAcquiredWriter = false;
      let clockWriterError;
      const harness = await createHarness(subtest, {
        authorize({ tenantId, actorId, request: value }) {
          return value?.serverContextToken === TRUSTED_SERVER_CONTEXT
            && value?.principal?.tenantId === tenantId
            && currentActor === actorId
            && actorId !== 'outsider' && actorId !== 'actor-revoked';
        },
        resolveActor(value) { return value === requestValue ? currentActor : value?.principal?.actorId; },
        resolveRetention({ nowMs, sourceExpiresAtMs, retentionHandle }) {
          if (!retentionHandle || typeof retentionHandle !== 'object') throw new Error('synthetic retention denial');
          if (retentionHandle === operationHandle) {
            retentionCalls += 1;
            if (retentionCalls === 2) revokeAtTransactionClock = true;
          }
          return {
            expiresAtMs: Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
            policyId: 'synthetic-private-history',
            policyVersion: '1',
            accessPolicy: 'tenant_private',
          };
        },
        authorizeBoundary(input) {
          const guardAction = scenario.action === 'initialize_history' ? 'review.history.initialize'
            : scenario.action === 'apply_correction' ? 'review.history.apply_correction'
              : 'review.history.refresh_source_facts';
          if (input.request === requestValue && input.action === guardAction && revokeAtTransactionClock
            && !clockBoundaryReached) {
            revokeAtTransactionClock = false;
            clockBoundaryReached = true;
            currentActor = 'actor-revoked';
            let writer;
            try {
              writer = new DatabaseSync(historyDatabasePath(root), { timeout: 0 });
              writer.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE; ROLLBACK');
              clockCallbackAcquiredWriter = true;
            } catch (error) {
              clockWriterError = error;
            } finally {
              writer?.close();
            }
          }
          const allowed = input.request?.serverContextToken === TRUSTED_SERVER_CONTEXT
            && input.request?.principal?.tenantId === input.tenantId
            && input.request?.principal?.actorId === input.actorId
            && currentActor === input.actorId && input.actorId !== 'outsider' && input.actorId !== 'actor-revoked';
          return allowed ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
            eventId: input.eventId, action: input.action, field: input.field, nowMs: harness.clock.value }) : false;
        },
        now: () => harness.clock.value,
      });
      requestValue = harness.request;
      root = harness.root;
      let base;
      if (scenario.operation !== 'initialize') {
        base = (await createSeed(harness)).snapshot;
      }
      operationHandle = harness.createPermit();
      const input = scenario.operation === 'initialize'
        ? { eventId: EVENT_ID, sourceFacts: initialFacts(), idempotencyKey: 'clock-revoke-initialize', retentionHandle: operationHandle }
        : scenario.operation === 'correction'
          ? { eventId: EVENT_ID, baseVersionId: base.versionId, baseContentHash: base.contentHash,
            field: 'event_date', value: { precision: 'date', value: '2027-06-25' },
            idempotencyKey: 'clock-revoke-correction', retentionHandle: operationHandle }
          : { eventId: EVENT_ID, baseVersionId: base.versionId, baseContentHash: base.contentHash,
            sourceFacts: { event_date: sourceDate('2027-06-26', 'clock-revoke-refresh') },
            idempotencyKey: 'clock-revoke-source-refresh', retentionHandle: operationHandle };
      const run = () => scenario.operation === 'initialize'
        ? harness.store.createHistory(harness.scope, input, requestValue)
        : scenario.operation === 'correction'
          ? harness.store.applyCorrection(harness.scope, input, requestValue)
          : harness.store.refreshSources(harness.scope, input, requestValue);
      const before = scenario.operation === 'initialize' ? null : await inspectDatabase(root);

      const rejected = await awaitWithTimeout(run(), `clock-revoked ${scenario.operation}`)
        .then(() => null, (error) => error);
      assert.equal(rejected?.code, 'REVIEW_DENIED');
      assert.equal(clockBoundaryReached, true, 'the transaction clock callback must reach the actual pre-BEGIN boundary');
      assert.equal(clockCallbackAcquiredWriter, true, clockWriterError?.message);
      assert.equal(currentActor, 'actor-revoked');
      const after = await inspectDatabase(root);
      if (scenario.operation === 'initialize') {
        assert.equal(after.heads.length, 0);
        assert.equal(after.versions.length, 0);
        assert.equal(after.idempotencyCount, 0);
      } else {
        assert.deepEqual(after, before);
      }
      assert.equal(after.correctionCacheOperations, 0);
      assert.equal(after.pendingCorrectionCacheOperations, 0);

      currentActor = 'customer-a';
      const retried = await awaitWithTimeout(run(), `exact clock-revoked ${scenario.operation} retry`);
      assert.equal(retried.snapshot.revision, scenario.operation === 'initialize' ? 1 : 2);
    });
  }
});

test('persistVersion rechecks expiry after queued authorization advances the injected clock', async (t) => {
  let requestValue;
  let operationHandle;
  let correctionAuthorizationCalls = 0;
  let advancedAtFinalAsyncAuthorization = false;
  const harness = await createHarness(t, {
    authorize({ tenantId, actorId, request: value, action }) {
      const permitted = value?.serverContextToken === TRUSTED_SERVER_CONTEXT
        && value?.principal?.tenantId === tenantId && value?.principal?.actorId === actorId
        && actorId !== 'outsider' && actorId !== 'actor-revoked';
      if (value === requestValue && action === 'apply_correction') {
        correctionAuthorizationCalls += 1;
      }
      if (correctionAuthorizationCalls === 5 && !advancedAtFinalAsyncAuthorization) {
        // This is the second authorization inside the final async recheck, after
        // retention/key/directory preparation and immediately before the sync guard.
        advancedAtFinalAsyncAuthorization = true;
        harness.clock.value = EPOCH + 3;
      }
      return permitted;
    },
  });
  requestValue = harness.request;
  const base = (await createSeed(harness)).snapshot;
  operationHandle = harness.createPermit('tenant-a', 3);
  const input = {
    eventId: EVENT_ID,
    baseVersionId: base.versionId,
    baseContentHash: base.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-27' },
    idempotencyKey: 'expiry-advances-during-prebegin-authorization',
    retentionHandle: operationHandle,
  };
  const before = await inspectDatabase(harness.root);
  assert.equal(await inspectHistoryClockMax(harness.root), EPOCH);
  await assert.rejects(harness.store.applyCorrection(harness.scope, input, requestValue), assertReviewError('REVIEW_EXPIRED'));
  assert.equal(advancedAtFinalAsyncAuthorization, true);
  assert.equal(correctionAuthorizationCalls, 5, 'the expiry jump occurred inside the final async authorization pair');
  assert.deepEqual(await inspectDatabase(harness.root), before);
  assert.equal(await inspectHistoryClockMax(harness.root), EPOCH + 3,
    'the separately authorized expiry cleanup records the final boundary clock without changing history rows');

  harness.clock.value = EPOCH;
  await assert.rejects(harness.store.applyCorrection(harness.scope, input, requestValue), assertReviewError('REVIEW_DENIED'));
  assert.equal(await inspectHistoryClockMax(harness.root), EPOCH + 3,
    'a backwards trusted clock cannot retry against the newer persisted watermark');
  harness.clock.value = EPOCH + 4;
  input.retentionHandle = harness.createPermit('tenant-a', 60_000);
  const retried = await harness.store.applyCorrection(harness.scope, input, requestValue);
  assert.equal(retried.snapshot.revision, 2);
});

test('persistVersion uses monotonic elapsed time at pre-COMMIT without persisting it as the clock watermark', async (t) => {
  let harness;
  let guardedWriteAttempt = 0;
  harness = await createHarness(t, { authorizeBoundary(input) {
    const allowed = input.request?.serverContextToken === TRUSTED_SERVER_CONTEXT
      && input.request?.principal?.tenantId === input.tenantId
      && input.request?.principal?.actorId === input.actorId && input.actorId !== 'outsider';
    if (allowed && input.action === 'review.history.apply_correction') guardedWriteAttempt += 1;
    return allowed ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
      eventId: input.eventId, action: input.action, field: input.field, nowMs: harness.clock.value }) : false;
  } });
  const base = (await createSeed(harness)).snapshot;
  const input = {
    eventId: EVENT_ID,
    baseVersionId: base.versionId,
    baseContentHash: base.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-28' },
    idempotencyKey: 'monotonic-expiry-precommit',
    retentionHandle: harness.createPermit('tenant-a', 400),
  };
  const before = await inspectDatabase(harness.root);
  const beforeClock = await inspectHistoryClockMax(harness.root);

  const probe = new DatabaseSync(':memory:');
  const statementPrototype = Object.getPrototypeOf(probe.prepare('SELECT 1'));
  probe.close();
  const prepareDescriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'prepare');
  const getDescriptor = Object.getOwnPropertyDescriptor(statementPrototype, 'get');
  const originalPrepare = prepareDescriptor.value;
  const originalGet = getDescriptor.value;
  const statementSql = new WeakMap();
  let matchingStatements = 0;
  let delayedBeforeCommit = false;
  let abortBeforeCommit = false;
  const controller = new AbortController();
  const liveBytesQuery = /SELECT COALESCE\(SUM\(length\(sealed\)\), 0\) AS bytes FROM versions WHERE state = 'available'/;
  Object.defineProperty(DatabaseSync.prototype, 'prepare', { ...prepareDescriptor, value: function(...args) {
    const statement = Reflect.apply(originalPrepare, this, args);
    statementSql.set(statement, args[0]);
    return statement;
  } });
  Object.defineProperty(statementPrototype, 'get', { ...getDescriptor, value: function(...args) {
    const sql = statementSql.get(this);
    if (guardedWriteAttempt > 0 && typeof sql === 'string' && liveBytesQuery.test(sql)) {
      matchingStatements += 1;
      if (guardedWriteAttempt === 1 && matchingStatements === 2) {
        delayedBeforeCommit = true;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 650);
      } else if (guardedWriteAttempt === 2 && matchingStatements === 2) {
        abortBeforeCommit = true;
        controller.abort();
      }
    }
    return Reflect.apply(originalGet, this, args);
  } });
  try {
    await assert.rejects(awaitWithTimeout(harness.store.applyCorrection(harness.scope, input, harness.request),
      'monotonic pre-commit expiry'), assertReviewError('REVIEW_EXPIRED'));
    assert.equal(guardedWriteAttempt, 1, 'the synchronous write boundary was reached');
    assert.equal(matchingStatements, 2, 'the delay occurred after the transaction write set was staged');
    assert.equal(delayedBeforeCommit, true);
    assert.deepEqual(await inspectDatabase(harness.root), before, 'the expired transaction rolls back all revision and idempotency writes');
    assert.equal(await inspectHistoryClockMax(harness.root), beforeClock,
      'monotonic elapsed expiry is not persisted as an extrapolated trusted clock sample');

    input.retentionHandle = harness.createPermit('tenant-a', 60_000);
    matchingStatements = 0;
    await assert.rejects(awaitWithTimeout(harness.store.applyCorrection(harness.scope, input, harness.request,
      { signal: controller.signal }), 'abort at pre-commit boundary'), assertReviewError('REVIEW_ABORTED'));
    assert.equal(guardedWriteAttempt, 2);
    assert.equal(matchingStatements, 2, 'abort occurs after the full SQLite write set is staged');
    assert.equal(abortBeforeCommit, true);
    assert.deepEqual(await inspectDatabase(harness.root), before, 'pre-COMMIT cancellation rolls back revision and idempotency writes');
    assert.equal(await inspectHistoryClockMax(harness.root), beforeClock);
  } finally {
    Object.defineProperty(DatabaseSync.prototype, 'prepare', prepareDescriptor);
    Object.defineProperty(statementPrototype, 'get', getDescriptor);
  }

  guardedWriteAttempt = 0;
  matchingStatements = 0;
  abortBeforeCommit = false;
  delayedBeforeCommit = false;
  input.retentionHandle = harness.createPermit('tenant-a', 60_000);
  const retry = await harness.store.applyCorrection(harness.scope, input, harness.request);
  assert.equal(retry.snapshot.revision, 2, 'the exact operation succeeds with a newly valid retention permit');
});

test('persistVersion reauthorizes after its same-process tenant queue wait and before BEGIN', async (t) => {
  let targetRequest;
  let blockerRequest;
  let targetHandle;
  let blockerHandle;
  let targetRetentionCalls = 0;
  let blockerRetentionCalls = 0;
  let blockerPreBeginArmed = false;
  let blockerPreBeginHeld = false;
  let targetPreBeginAuthorizationCalls = 0;
  let probeWriterAcquired = false;
  let probeWriterError;
  let releaseTargetRetention;
  let resolveTargetRetentionReady;
  let resolveBlockerPreBegin;
  let releaseBlockerPreBegin;
  let resolveTargetPreBeginObserved;
  const targetRetentionReady = new Promise((resolve) => { resolveTargetRetentionReady = resolve; });
  const targetRetentionGate = new Promise((resolve) => { releaseTargetRetention = resolve; });
  const blockerPreBeginEntered = new Promise((resolve) => { resolveBlockerPreBegin = resolve; });
  const blockerPreBeginGate = new Promise((resolve) => { releaseBlockerPreBegin = resolve; });
  const targetPreBeginObserved = new Promise((resolve) => { resolveTargetPreBeginObserved = resolve; });
  const harness = await createHarness(t, {
    lockTimeoutMs: 1_000,
    resolveActor(value) {
      if (value === targetRequest && value.principal.actorId === 'actor-revoked') resolveTargetPreBeginObserved();
      return value?.principal?.actorId;
    },
    authorize({ tenantId, actorId, action, request }) {
      if (request === blockerRequest && action === 'initialize_history' && blockerPreBeginArmed && !blockerPreBeginHeld) {
        blockerPreBeginHeld = true;
        try {
          const probe = new DatabaseSync(historyDatabasePath(harness.root));
          try { probe.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE; ROLLBACK'); probeWriterAcquired = true; }
          finally { probe.close(); }
        } catch (error) { probeWriterError = error; }
        resolveBlockerPreBegin();
        return blockerPreBeginGate.then(() => request?.serverContextToken === TRUSTED_SERVER_CONTEXT
          && request?.principal?.tenantId === tenantId
          && request?.principal?.actorId === actorId && actorId !== 'outsider');
      }
      if (request === targetRequest && action === 'apply_correction' && targetRetentionCalls >= 2) {
        targetPreBeginAuthorizationCalls += 1;
      }
      return request?.serverContextToken === TRUSTED_SERVER_CONTEXT
        && request?.principal?.tenantId === tenantId
        && request?.principal?.actorId === actorId
        && actorId !== 'outsider' && actorId !== 'actor-revoked';
    },
    resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (retentionHandle === targetHandle) {
        targetRetentionCalls += 1;
        if (targetRetentionCalls === 2) {
          resolveTargetRetentionReady();
          return targetRetentionGate.then(() => ({ expiresAtMs: Math.min(nowMs + 60_000,
            sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER), policyId: 'queue-test', policyVersion: '1', accessPolicy: 'tenant_private' }));
        }
      }
      if (retentionHandle === blockerHandle) {
        blockerRetentionCalls += 1;
        if (blockerRetentionCalls === 2) blockerPreBeginArmed = true;
      }
      if (!retentionHandle || typeof retentionHandle !== 'object') throw new Error('synthetic retention denial');
      return { expiresAtMs: Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
        policyId: 'queue-test', policyVersion: '1', accessPolicy: 'tenant_private' };
    },
  });
  const releaseAll = () => {
    releaseTargetRetention();
    releaseBlockerPreBegin();
    if (targetRequest) targetRequest.principal.actorId = 'customer-a';
  };
  t.after(releaseAll);
  targetRequest = { principal: { tenantId: 'tenant-a', actorId: 'customer-a' }, serverContextToken: TRUSTED_SERVER_CONTEXT };
  blockerRequest = { principal: { tenantId: 'tenant-a', actorId: 'customer-b' }, serverContextToken: TRUSTED_SERVER_CONTEXT };
  const targetScope = await harness.store.scopeForAuthenticatedRequest(targetRequest);
  const blockerScope = await harness.store.scopeForAuthenticatedRequest(blockerRequest);
  const first = (await harness.store.createHistory(targetScope, {
    eventId: EVENT_ID,
    sourceFacts: initialFacts(),
    idempotencyKey: 'tenant-queue-target-seed',
    retentionHandle: harness.createPermit(),
  }, targetRequest)).snapshot;
  targetHandle = harness.createPermit();
  blockerHandle = harness.createPermit();
  const targetInput = {
    eventId: EVENT_ID,
    baseVersionId: first.versionId,
    baseContentHash: first.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-25' },
    idempotencyKey: 'tenant-queue-target-correction',
    retentionHandle: targetHandle,
  };
  const targetOperation = harness.store.applyCorrection(targetScope, targetInput, targetRequest);
  await waitForSignal(targetRetentionReady, 'target final retention callback before queue wait');

  const blockerOperation = harness.store.createHistory(blockerScope, {
    eventId: 'event-tenant-queue-blocker',
    sourceFacts: initialFacts(),
    idempotencyKey: 'tenant-queue-blocker-initialize',
    retentionHandle: blockerHandle,
  }, blockerRequest);
  await waitForSignal(blockerPreBeginEntered, 'blocker holding same-process queue before BEGIN');
  assert.equal(probeWriterAcquired, true, probeWriterError?.message);

  releaseTargetRetention();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(targetPreBeginAuthorizationCalls, 0);
  targetRequest.principal.actorId = 'actor-revoked';
  releaseBlockerPreBegin();
  const results = await awaitWithTimeout(Promise.allSettled([targetOperation, blockerOperation]), 'queued revision guard results');
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason.code, 'REVIEW_DENIED');
  assert.equal(results[1].status, 'fulfilled');
  await waitForSignal(targetPreBeginObserved, 'target current principal check after queue release');
  assert.equal(targetRequest.principal.actorId, 'actor-revoked');

  const afterDenied = await inspectDatabase(harness.root);
  assert.equal(afterDenied.heads.length, 2);
  assert.equal(afterDenied.versions.length, 2);
  assert.equal(afterDenied.idempotencyCount, 2);
  assert.equal(afterDenied.invalidations, 0);
  assert.equal(afterDenied.correctionCacheOperations, 0);
  targetRequest.principal.actorId = 'customer-a';
  const retried = await awaitWithTimeout(harness.store.applyCorrection(targetScope, targetInput, targetRequest), 'exact retry after queue authorization denial');
  assert.equal(retried.snapshot.revision, 2);
  assert.deepEqual((await harness.store.listHistory(targetScope, EVENT_ID, targetRequest)).map((snapshot) => snapshot.revision), [1, 2]);
});

test('same-key duplicate requests commit once and replay across store instances', async (t) => {
  const harness = await createHarness(t, {
    lockTimeoutMs: 25,
    async authorize({ tenantId, actorId, request }) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return request?.serverContextToken === TRUSTED_SERVER_CONTEXT
        && request?.principal?.tenantId === tenantId
        && request?.principal?.actorId === actorId
        && actorId !== 'outsider';
    },
  });
  const first = (await createSeed(harness)).snapshot;
  const otherStore = harness.openStore();
  const otherScope = await otherStore.scopeForAuthenticatedRequest(harness.request);
  const input = {
    eventId: EVENT_ID,
    baseVersionId: first.versionId,
    baseContentHash: first.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-20' },
    idempotencyKey: 'async-same-key-duplicate',
    retentionHandle: harness.createPermit(),
  };
  const results = await Promise.all([
    harness.store.applyCorrection(harness.scope, input, harness.request),
    otherStore.applyCorrection(otherScope, input, harness.request),
  ]);
  assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
  assert.equal(results[0].snapshot.versionId, results[1].snapshot.versionId);
  assert.equal((await harness.store.listHistory(harness.scope, EVENT_ID, harness.request)).length, 2);
  assert.equal((await inspectDatabase(harness.root)).idempotencyCount, 2);
});

test('late cancellation after asynchronous host boundaries cannot write and expired history cleanup still commits', async (t) => {
  let harness;
  let armed = false;
  let shortSeedPermit;
  let blockingRetentionHandle;
  let blockedRetentionCalls = 0;
  let resolveBlockedBoundary;
  let releaseBlockedBoundary;
  let resolveQueuedAuthorization;
  let releaseQueuedAuthorization;
  const blockedBoundary = new Promise((resolve) => { resolveBlockedBoundary = resolve; });
  const releaseRetention = new Promise((resolve) => { releaseBlockedBoundary = resolve; });
  const queuedAuthorization = new Promise((resolve) => { resolveQueuedAuthorization = resolve; });
  const releaseQueued = new Promise((resolve) => { releaseQueuedAuthorization = resolve; });
  const releaseAllBoundaries = () => {
    releaseQueuedAuthorization();
    releaseBlockedBoundary();
  };
  t.after(releaseAllBoundaries);
  harness = await createHarness(t, {
    lockTimeoutMs: 25,
    async authorize({ tenantId, actorId, action, request }) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      const allowed = request?.serverContextToken === TRUSTED_SERVER_CONTEXT
        && request?.principal?.tenantId === tenantId
        && request?.principal?.actorId === actorId
        && actorId !== 'outsider';
      if (armed && action === 'apply_correction' && actorId === 'customer-a') {
        resolveQueuedAuthorization();
        await releaseQueued;
      }
      return allowed;
    },
    async resolveRetention({ tenantId, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (armed && retentionHandle === blockingRetentionHandle && blockedRetentionCalls++ === 0) {
        resolveBlockedBoundary();
        await releaseRetention;
      }
      return {
        expiresAtMs: Math.min(retentionHandle === shortSeedPermit ? EPOCH + 1_000 : nowMs + 60_000,
          sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
        policyId: 'synthetic-private-history',
        policyVersion: '1',
        accessPolicy: 'tenant_private',
      };
    },
  });
  shortSeedPermit = harness.createPermit('tenant-a', 1_000);
  const initial = (await harness.store.createHistory(harness.scope, {
    eventId: EVENT_ID,
    sourceFacts: initialFacts(),
    idempotencyKey: 'queued-expiring-initialize',
    retentionHandle: shortSeedPermit,
  }, harness.request)).snapshot;
  await harness.store.registerDownstreamReference(harness.scope, {
    eventId: EVENT_ID,
    versionId: initial.versionId,
    contentHash: initial.contentHash,
    referenceId: 'queued-expiry-cleanup-reference',
    kind: 'handoff_reference',
  }, harness.request);

  const blockingRequest = createRequest('tenant-a', 'customer-block');
  const blockingScope = await harness.store.scopeForAuthenticatedRequest(blockingRequest);
  const otherStore = harness.openStore();
  const otherScope = await otherStore.scopeForAuthenticatedRequest(harness.request);
  blockingRetentionHandle = harness.createPermit();
  armed = true;
  const controller = new AbortController();
  try {
    const blockedWrite = harness.store.applyCorrection(blockingScope, {
      eventId: EVENT_ID,
      baseVersionId: initial.versionId,
      baseContentHash: initial.contentHash,
      field: 'event_date',
      value: { precision: 'date', value: '2027-06-20' },
      idempotencyKey: 'queued-blocked-write',
      retentionHandle: blockingRetentionHandle,
    }, blockingRequest);
    const blockedRejection = assert.rejects(blockedWrite, assertReviewError('REVIEW_EXPIRED'));
    await waitForSignal(blockedBoundary, 'suspended retention callback');

    // A trusted retention callback may suspend, but no SQLite transaction may span it.
    const tenantHash = createHash('sha256').update('event-intelligence:review-tenant:v1:tenant-a').digest('hex');
    const probe = new DatabaseSync(path.join(harness.root, tenantHash, 'history.sqlite'));
    try {
      probe.exec('BEGIN IMMEDIATE');
      probe.exec('ROLLBACK');
    } finally { probe.close(); }

    const queuedWrite = otherStore.applyCorrection(otherScope, {
      eventId: EVENT_ID,
      baseVersionId: initial.versionId,
      baseContentHash: initial.contentHash,
      field: 'event_date',
      value: { precision: 'date', value: '2027-06-21' },
      idempotencyKey: 'queued-cancelled-write',
      retentionHandle: harness.createPermit(),
    }, harness.request, { signal: controller.signal });
    const queuedRejection = assert.rejects(queuedWrite, assertReviewError('REVIEW_ABORTED'));
    await waitForSignal(queuedAuthorization, 'queued actor authorization callback');
    controller.abort();
    harness.clock.value = EPOCH + 1_000;
    releaseQueuedAuthorization();
    releaseBlockedBoundary();

    await blockedRejection;
    await queuedRejection;
  } finally {
    // Always unblock host callbacks if an expected phase is missing so the test fails boundedly.
    releaseAllBoundaries();
  }
  assert.equal(await otherStore.purgeExpired(otherScope, harness.request), 0);
  const disk = await inspectDatabase(harness.root);
  assert.equal(disk.heads[0].state, 'expired');
  assert.equal(disk.versions.length, 1);
  assert.equal(disk.versions[0].version_id, null);
  assert.equal(disk.versions[0].sealed, null);
  assert.equal(disk.idempotencyCount, 0);
  assert.equal(disk.references, 0);
  assert.equal(disk.invalidations, 0);
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

test('abort inputs reject proxies, use captured intrinsic state, and never leak hostile getter errors', async (t) => {
  for (const operation of ['create', 'correction', 'refresh']) {
    for (const kind of ['aborted', 'throwing_getter_aborted', 'prototype_forgery', 'proxy', 'revoked_proxy',
      'transparent_proxy', 'forwarding_proxy', 'state_masking_proxy']) {
      await t.test(`${operation} rejects ${kind} with a fixed typed error and no mutation`, async (subtest) => {
        const harness = await createHarness(subtest);
        const seeded = (await createSeed(harness)).snapshot;
        await harness.store.registerDownstreamReference(harness.scope, {
          eventId: EVENT_ID,
          versionId: seeded.versionId,
          contentHash: seeded.contentHash,
          referenceId: `abort-prior-${operation}-${kind}`,
          kind: 'approval_reference',
        }, harness.request);
        const first = (await correction(harness, seeded, 'event_date', { precision: 'date', value: '2027-06-19' },
          `abort-setup-${operation}-${kind}`)).snapshot;
        await harness.store.registerDownstreamReference(harness.scope, {
          eventId: EVENT_ID,
          versionId: first.versionId,
          contentHash: first.contentHash,
          referenceId: `abort-current-${operation}-${kind}`,
          kind: 'handoff_reference',
        }, harness.request);
        const before = await inspectDatabase(harness.root);
        let getterCalls = 0;
        let signal;
        if (kind === 'aborted' || kind === 'throwing_getter_aborted') {
          const controller = new AbortController();
          controller.abort();
          signal = controller.signal;
          if (kind === 'throwing_getter_aborted') {
            Object.defineProperty(signal, 'aborted', {
              configurable: true,
              get() {
                getterCalls += 1;
                throw new Error('SYNTHETIC_ABORT_SECRET');
              },
            });
          }
        } else if (kind === 'prototype_forgery') {
          signal = Object.create(AbortSignal.prototype);
          Object.defineProperty(signal, 'aborted', { value: false });
        } else if (kind === 'proxy') {
          signal = new Proxy(new AbortController().signal, {
            get() { throw new Error('SYNTHETIC_ABORT_SECRET'); },
          });
        } else if (kind === 'revoked_proxy') {
          const revoked = Proxy.revocable(new AbortController().signal, {});
          revoked.revoke();
          signal = revoked.proxy;
        } else {
          const controller = new AbortController();
          controller.abort();
          const abortedSymbol = Object.getOwnPropertySymbols(controller.signal)
            .find((symbol) => symbol.description === 'kAborted');
          if (kind === 'transparent_proxy') {
            signal = new Proxy(controller.signal, {});
          } else if (kind === 'forwarding_proxy') {
            signal = new Proxy(controller.signal, {
              get(target, key, receiver) { return Reflect.get(target, key, receiver); },
            });
          } else {
            assert.ok(abortedSymbol);
            signal = new Proxy(controller.signal, {
              get(target, key, receiver) {
                if (key === abortedSymbol) return false;
                return Reflect.get(target, key, receiver);
              },
            });
          }
        }

        let operationPromise;
        if (operation === 'create') {
          operationPromise = harness.store.createHistory(harness.scope, {
            eventId: `${EVENT_ID}-abort-${kind}`,
            sourceFacts: initialFacts(),
            idempotencyKey: `abort-create-${kind}`,
            retentionHandle: harness.createPermit(),
          }, harness.request, { signal });
        } else if (operation === 'correction') {
          operationPromise = harness.store.applyCorrection(harness.scope, {
            eventId: EVENT_ID,
            baseVersionId: first.versionId,
            baseContentHash: first.contentHash,
            field: 'event_date',
            value: { precision: 'date', value: '2027-06-20' },
            idempotencyKey: `abort-correction-${kind}`,
            retentionHandle: harness.createPermit(),
          }, harness.request, { signal });
        } else {
          operationPromise = harness.store.refreshSources(harness.scope, {
            eventId: EVENT_ID,
            baseVersionId: first.versionId,
            baseContentHash: first.contentHash,
            sourceFacts: { event_name: { status: 'sourced', value: 'Abort Test Refresh', sourceEvidence: [evidence('abort-refresh', 'refresh')] } },
            idempotencyKey: `abort-refresh-${kind}`,
            retentionHandle: harness.createPermit(),
          }, harness.request, { signal });
        }

        const expectedCode = kind === 'aborted' || kind === 'throwing_getter_aborted' ? 'REVIEW_ABORTED' : 'REVIEW_INVALID';
        await assert.rejects(operationPromise, (error) => {
          assert.ok(error instanceof ReviewHistoryError);
          assert.equal(error.code, expectedCode);
          assert.equal(error.message, expectedCode === 'REVIEW_ABORTED'
            ? 'correction history operation cancelled' : 'invalid correction history input');
          assert.equal(error.message.includes('SYNTHETIC_ABORT_SECRET'), false);
          assert.equal(Object.hasOwn(error, 'cause'), false);
          return true;
        });
        assert.equal(getterCalls, 0);
        assert.deepEqual(await inspectDatabase(harness.root), before);
      });
    }

    await t.test(`${operation} accepts a genuine non-aborted signal with an ignored own getter`, async (subtest) => {
      const harness = await createHarness(subtest);
      const first = (await createSeed(harness)).snapshot;
      const controller = new AbortController();
      let getterCalls = 0;
      Object.defineProperty(controller.signal, 'aborted', {
        configurable: true,
        get() {
          getterCalls += 1;
          throw new Error('SYNTHETIC_ABORT_SECRET');
        },
      });
      if (operation === 'create') {
        const result = await harness.store.createHistory(harness.scope, {
          eventId: `${EVENT_ID}-genuine-abort-signal`,
          sourceFacts: initialFacts(),
          idempotencyKey: 'genuine-abort-create',
          retentionHandle: harness.createPermit(),
        }, harness.request, { signal: controller.signal });
        assert.equal(result.snapshot.revision, 1);
      } else if (operation === 'correction') {
        const result = await harness.store.applyCorrection(harness.scope, {
          eventId: EVENT_ID,
          baseVersionId: first.versionId,
          baseContentHash: first.contentHash,
          field: 'event_date',
          value: { precision: 'date', value: '2027-06-20' },
          idempotencyKey: 'genuine-abort-correction',
          retentionHandle: harness.createPermit(),
        }, harness.request, { signal: controller.signal });
        assert.equal(result.snapshot.revision, 2);
      } else {
        const result = await harness.store.refreshSources(harness.scope, {
          eventId: EVENT_ID,
          baseVersionId: first.versionId,
          baseContentHash: first.contentHash,
          sourceFacts: { event_name: { status: 'sourced', value: 'Genuine Signal Refresh', sourceEvidence: [evidence('genuine-signal-refresh', 'refresh')] } },
          idempotencyKey: 'genuine-abort-refresh',
          retentionHandle: harness.createPermit(),
        }, harness.request, { signal: controller.signal });
        assert.equal(result.snapshot.revision, 2);
      }
      assert.equal(getterCalls, 0);
    });
  }
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

test('historical reads and every replay path enforce the current shortened history expiry after awaits', async (t) => {
  for (const operation of ['historical', 'history_list', 'initialize_replay', 'correction_replay', 'refresh_replay']) {
    for (const boundary of ['key', 'authorization']) {
      for (const delta of [0, 1]) {
        await t.test(`${operation} during ${boundary} at ${delta === 0 ? 'equality' : 'crossing'}`, async (subtest) => {
          const expiryAtMs = EPOCH + 1_000;
          let harness;
          let armed = false;
          let authorizationCalls = 0;
          let actionToAdvance;
          const advanceClock = () => { harness.clock.value = expiryAtMs + delta; };
          harness = await createHarness(subtest, {
            lockTimeoutMs: 25,
            authorize({ tenantId, actorId, request, action }) {
              const allowed = request?.serverContextToken === TRUSTED_SERVER_CONTEXT
                && request?.principal?.tenantId === tenantId
                && request?.principal?.actorId === actorId
                && actorId !== 'outsider';
              if (armed && boundary === 'authorization' && action === actionToAdvance) {
                authorizationCalls += 1;
                if (authorizationCalls === 3) advanceClock();
              }
              return allowed;
            },
            resolveKey({ tenantId, purpose, keyId }) {
              const resolvedId = `${purpose}-v1`;
              if (keyId && keyId !== resolvedId) throw new Error('SYNTHETIC_KEY_ERROR');
              if (armed && boundary === 'key' && purpose === 'correction_payload' && keyId) advanceClock();
              return {
                keyId: resolvedId,
                key: createHash('sha256').update(`${tenantId}:${purpose}:test-only-key-material`).digest(),
              };
            },
          });

          const initializeInput = {
            eventId: EVENT_ID,
            sourceFacts: initialFacts(),
            idempotencyKey: `short-head-initialize-${operation}`,
            retentionHandle: harness.createPermit('tenant-a', 60_000),
          };
          const first = (await harness.store.createHistory(harness.scope, initializeInput, harness.request)).snapshot;
          await harness.store.registerDownstreamReference(harness.scope, {
            eventId: EVENT_ID,
            versionId: first.versionId,
            contentHash: first.contentHash,
            referenceId: `short-head-reference-${operation}`,
            kind: 'approval_reference',
          }, harness.request);

          let replayOperation;
          if (operation === 'historical' || operation === 'history_list' || operation === 'initialize_replay') {
            const shortCorrection = await harness.store.applyCorrection(harness.scope, {
              eventId: EVENT_ID,
              baseVersionId: first.versionId,
              baseContentHash: first.contentHash,
              field: 'event_date',
              value: { precision: 'date', value: '2027-06-20' },
              idempotencyKey: `short-head-current-${operation}`,
              retentionHandle: harness.createPermit('tenant-a', 1_000),
            }, harness.request);
            assert.equal(Date.parse(shortCorrection.snapshot.expiresAt), expiryAtMs);
            actionToAdvance = operation === 'historical' ? 'read_history_version'
              : operation === 'history_list' ? 'list_history' : 'initialize_history';
            replayOperation = operation === 'historical'
              ? () => harness.store.getHistoryVersion(harness.scope, EVENT_ID, first.versionId, harness.request)
              : operation === 'history_list'
                ? () => harness.store.listHistory(harness.scope, EVENT_ID, harness.request)
                : () => harness.store.createHistory(harness.scope, initializeInput, harness.request);
          } else if (operation === 'correction_replay') {
            const originalCorrection = {
              eventId: EVENT_ID,
              baseVersionId: first.versionId,
              baseContentHash: first.contentHash,
              field: 'event_date',
              value: { precision: 'date', value: '2027-06-20' },
              idempotencyKey: 'short-head-original-correction',
              retentionHandle: harness.createPermit('tenant-a', 60_000),
            };
            const second = (await harness.store.applyCorrection(harness.scope, originalCorrection, harness.request)).snapshot;
            const shortCorrection = await harness.store.applyCorrection(harness.scope, {
              eventId: EVENT_ID,
              baseVersionId: second.versionId,
              baseContentHash: second.contentHash,
              field: 'event_name',
              value: 'Updated Moon Night',
              idempotencyKey: 'short-head-after-correction',
              retentionHandle: harness.createPermit('tenant-a', 1_000),
            }, harness.request);
            assert.equal(Date.parse(shortCorrection.snapshot.expiresAt), expiryAtMs);
            actionToAdvance = 'apply_correction';
            replayOperation = () => harness.store.applyCorrection(harness.scope, originalCorrection, harness.request);
          } else {
            const originalRefresh = {
              eventId: EVENT_ID,
              baseVersionId: first.versionId,
              baseContentHash: first.contentHash,
              sourceFacts: { event_name: { status: 'sourced', value: 'Updated Moon Night', sourceEvidence: [evidence('short-head-refresh', 'Updated Moon Night')] } },
              idempotencyKey: 'short-head-original-refresh',
              retentionHandle: harness.createPermit('tenant-a', 60_000),
            };
            const second = (await harness.store.refreshSources(harness.scope, originalRefresh, harness.request)).snapshot;
            const shortCorrection = await harness.store.applyCorrection(harness.scope, {
              eventId: EVENT_ID,
              baseVersionId: second.versionId,
              baseContentHash: second.contentHash,
              field: 'event_date',
              value: { precision: 'date', value: '2027-06-20' },
              idempotencyKey: 'short-head-after-refresh',
              retentionHandle: harness.createPermit('tenant-a', 1_000),
            }, harness.request);
            assert.equal(Date.parse(shortCorrection.snapshot.expiresAt), expiryAtMs);
            actionToAdvance = 'refresh_source_facts';
            replayOperation = () => harness.store.refreshSources(harness.scope, originalRefresh, harness.request);
          }

          harness.clock.value = expiryAtMs - 1;
          const before = await inspectDatabase(harness.root);
          assert.ok(before.sealedBytes > 0);
          assert.ok(before.idempotencyCount > 1);
          assert.equal(before.references, 1);
          assert.ok(before.invalidations > 0);
          armed = true;
          authorizationCalls = 0;
          await assert.rejects(replayOperation(), assertReviewError('REVIEW_EXPIRED'));

          const after = await inspectDatabase(harness.root);
          assert.equal(after.heads[0].state, 'expired');
          assert.equal(after.heads[0].version_id, null);
          assert.equal(after.versions.every((row) => row.state === 'expired' && row.version_id === null
            && row.parent_version_id === null && row.content_hash === null && row.material_hash === null
            && row.expires_at_ms === null && row.encryption_key_id === null && row.sealed === null), true);
          assert.equal(after.idempotencyCount, 0);
          assert.equal(after.references, 0);
          assert.equal(after.invalidations, 0);
          assert.equal(after.sealedBytes, 0);
        });
      }
    }
  }
});

test('an idempotent replay discovered after a competing commit checks the shortened current head', async (t) => {
  let harness;
  let armed = false;
  let replayKeyArmed = false;
  let firstPermit;
  let secondPermit;
  let shortPermit;
  let firstRetentionCalls = 0;
  let resolveFirstEntered;
  let resolveSecondEntered;
  let releaseFirst;
  let releaseSecond;
  const firstEntered = new Promise((resolve) => { resolveFirstEntered = resolve; });
  const secondEntered = new Promise((resolve) => { resolveSecondEntered = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
  harness = await createHarness(t, {
    resolveRetention: async ({ sourceExpiresAtMs, retentionHandle }) => {
      if (armed && retentionHandle === firstPermit && firstRetentionCalls++ === 0) {
        resolveFirstEntered();
        await firstGate;
      }
      if (armed && retentionHandle === secondPermit) {
        resolveSecondEntered();
        await secondGate;
      }
      const expiresAtMs = retentionHandle === shortPermit ? EPOCH + 1_000 : EPOCH + 60_000;
      return {
        expiresAtMs: Math.min(expiresAtMs, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
        policyId: 'synthetic-private-history',
        policyVersion: '1',
        accessPolicy: 'tenant_private',
      };
    },
    resolveKey({ tenantId, purpose, keyId }) {
      const resolvedId = `${purpose}-v1`;
      if (keyId && keyId !== resolvedId) throw new Error('SYNTHETIC_KEY_ERROR');
      if (replayKeyArmed && purpose === 'correction_payload' && keyId) harness.clock.value = EPOCH + 1_000;
      return {
        keyId: resolvedId,
        key: createHash('sha256').update(`${tenantId}:${purpose}:test-only-key-material`).digest(),
      };
    },
  });
  const first = (await createSeed(harness)).snapshot;
  await harness.store.registerDownstreamReference(harness.scope, {
    eventId: EVENT_ID,
    versionId: first.versionId,
    contentHash: first.contentHash,
    referenceId: 'inner-replay-expiry-reference',
    kind: 'handoff_reference',
  }, harness.request);
  firstPermit = harness.createPermit('tenant-a', 60_000);
  secondPermit = harness.createPermit('tenant-a', 60_000);
  shortPermit = harness.createPermit('tenant-a', 1_000);
  const duplicateInput = {
    eventId: EVENT_ID,
    baseVersionId: first.versionId,
    baseContentHash: first.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-20' },
    idempotencyKey: 'inner-replay-shared-key',
  };
  armed = true;
  const firstCommit = harness.store.applyCorrection(harness.scope, {
    ...duplicateInput,
    retentionHandle: firstPermit,
  }, harness.request);
  await firstEntered;
  const delayedDuplicate = harness.store.applyCorrection(harness.scope, {
    ...duplicateInput,
    retentionHandle: secondPermit,
  }, harness.request);
  await secondEntered;
  releaseFirst();
  const committed = await firstCommit;
  assert.equal(committed.replayed, false);
  const shortHead = await harness.store.applyCorrection(harness.scope, {
    eventId: EVENT_ID,
    baseVersionId: committed.snapshot.versionId,
    baseContentHash: committed.snapshot.contentHash,
    field: 'event_name',
    value: 'Short Head Revision',
    idempotencyKey: 'inner-replay-short-head',
    retentionHandle: shortPermit,
  }, harness.request);
  assert.equal(Date.parse(shortHead.snapshot.expiresAt), EPOCH + 1_000);

  harness.clock.value = EPOCH + 999;
  replayKeyArmed = true;
  releaseSecond();
  await assert.rejects(delayedDuplicate, assertReviewError('REVIEW_EXPIRED'));
  const disk = await inspectDatabase(harness.root);
  assert.equal(disk.heads[0].state, 'expired');
  assert.equal(disk.versions.length, 3);
  assert.equal(disk.versions.every((row) => row.state === 'expired' && row.version_id === null && row.sealed === null), true);
  assert.equal(disk.idempotencyCount, 0);
  assert.equal(disk.references, 0);
  assert.equal(disk.invalidations, 0);
  assert.equal(disk.sealedBytes, 0);
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

test('legacy migration preserves available history and normalizes prior explicit expiry tombstones', async (t) => {
  const harness = await createHarness(t);
  const activeEventId = 'legacy-active-history';
  const expiredEventId = 'legacy-explicitly-purged-history';
  const activeInitialize = {
    eventId: activeEventId,
    sourceFacts: initialFacts(),
    idempotencyKey: 'legacy-active-initialize',
    retentionHandle: harness.createPermit(),
  };
  const activeFirst = (await harness.store.createHistory(harness.scope, activeInitialize, harness.request)).snapshot;
  await harness.store.registerDownstreamReference(harness.scope, {
    eventId: activeEventId,
    versionId: activeFirst.versionId,
    contentHash: activeFirst.contentHash,
    referenceId: 'legacy-active-reference',
    kind: 'handoff_reference',
  }, harness.request);
  const activeCorrectionInput = {
    eventId: activeEventId,
    baseVersionId: activeFirst.versionId,
    baseContentHash: activeFirst.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-20' },
    idempotencyKey: 'legacy-active-correction',
    retentionHandle: harness.createPermit(),
  };
  const activeSecond = (await harness.store.applyCorrection(harness.scope, activeCorrectionInput, harness.request)).snapshot;

  const expiredInitialize = {
    eventId: expiredEventId,
    sourceFacts: initialFacts(),
    idempotencyKey: 'legacy-expired-initialize',
    retentionHandle: harness.createPermit('tenant-a', 1_000),
  };
  const expiredFirst = (await harness.store.createHistory(harness.scope, expiredInitialize, harness.request)).snapshot;
  await harness.store.registerDownstreamReference(harness.scope, {
    eventId: expiredEventId,
    versionId: expiredFirst.versionId,
    contentHash: expiredFirst.contentHash,
    referenceId: 'legacy-expired-reference',
    kind: 'approval_reference',
  }, harness.request);
  const expiredCorrectionInput = {
    eventId: expiredEventId,
    baseVersionId: expiredFirst.versionId,
    baseContentHash: expiredFirst.contentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-21' },
    idempotencyKey: 'legacy-expired-correction',
    retentionHandle: harness.createPermit('tenant-a', 1_000),
  };
  const expiredSecond = (await harness.store.applyCorrection(harness.scope, expiredCorrectionInput, harness.request)).snapshot;
  const tenantHash = createHash('sha256').update('event-intelligence:review-tenant:v1:tenant-a').digest('hex');
  const indexKey = createHash('sha256').update('tenant-a:correction_index:test-only-key-material').digest();
  const eventKeyFor = (eventId) => createHmac('sha256', indexKey)
    .update(`event-intelligence:review-index:v1:${tenantHash}:event:${eventId}`).digest('hex');
  const activeEventKey = eventKeyFor(activeEventId);
  const expiredEventKey = eventKeyFor(expiredEventId);

  harness.clock.value = EPOCH + 1_000;
  const databasePath = path.join(harness.root, tenantHash, 'history.sqlite');
  const database = new DatabaseSync(databasePath);
  database.exec('BEGIN IMMEDIATE');
  database.exec(`
    CREATE TABLE versions_legacy (
      event_key TEXT NOT NULL, revision INTEGER NOT NULL, version_id TEXT NOT NULL, parent_version_id TEXT,
      content_hash TEXT, material_hash TEXT, expires_at_ms INTEGER, encryption_key_id TEXT, sealed BLOB,
      state TEXT NOT NULL CHECK (state IN ('available', 'expired')),
      PRIMARY KEY (event_key, revision), UNIQUE (event_key, version_id)
    ) STRICT;
    INSERT INTO versions_legacy SELECT * FROM versions;
    DROP TABLE versions;
    ALTER TABLE versions_legacy RENAME TO versions;
  `);
  // Recreate the prior implementation's explicit purge shape: it erased payloads,
  // hashes and parent links but left each version_id on the expired row.
  database.prepare(`UPDATE versions SET parent_version_id = NULL, content_hash = NULL, material_hash = NULL,
    expires_at_ms = NULL, encryption_key_id = NULL, sealed = NULL, state = 'expired' WHERE event_key = ?`).run(expiredEventKey);
  database.prepare(`UPDATE heads SET revision = NULL, version_id = NULL, content_hash = NULL, material_hash = NULL,
    expires_at_ms = NULL, state = 'expired' WHERE event_key = ?`).run(expiredEventKey);
  database.prepare('DELETE FROM idempotency WHERE event_key = ?').run(expiredEventKey);
  database.prepare('DELETE FROM downstream_references WHERE event_key = ?').run(expiredEventKey);
  database.prepare('DELETE FROM invalidations WHERE event_key = ?').run(expiredEventKey);
  // Stale linked metadata is not emitted by the old atomic purge, but migration
  // also removes it if a legacy database contains detached cleanup residue.
  database.prepare('INSERT INTO idempotency VALUES (?, ?, ?, ?)')
    .run(expiredEventKey, 'stale-idempotency-hash', 'stale-fingerprint', expiredFirst.versionId);
  database.prepare('INSERT INTO downstream_references VALUES (?, ?, ?, ?, ?, ?)')
    .run(expiredEventKey, 'stale-reference-hash', expiredSecond.versionId, expiredSecond.contentHash,
      'payload-key-v1', Buffer.from('stale-reference-envelope'));
  database.prepare('INSERT INTO invalidations VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .run(expiredEventKey, 'stale-reference-hash', expiredFirst.versionId, expiredFirst.contentHash,
      expiredSecond.versionId, 'material_projection_changed', new Date(EPOCH).toISOString());
  database.exec('COMMIT');
  database.close();

  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(harness.request);
  const activeRead = await reopened.getHistory(reopenedScope, activeEventId, harness.request);
  assert.equal(activeRead.versionId, activeSecond.versionId);
  assert.equal(activeRead.contentHash, activeSecond.contentHash);
  const activeReplay = await reopened.createHistory(reopenedScope, activeInitialize, harness.request);
  assert.equal(activeReplay.replayed, true);
  assert.equal(activeReplay.snapshot.versionId, activeFirst.versionId);
  assert.equal(activeReplay.snapshot.contentHash, activeFirst.contentHash);
  assert.deepEqual((await reopened.listHistory(reopenedScope, activeEventId, harness.request)).map((snapshot) => snapshot.revision), [1, 2]);

  const disk = await inspectDatabase(harness.root);
  const activeRows = disk.versions.filter((row) => row.event_key === activeEventKey);
  const expiredRows = disk.versions.filter((row) => row.event_key === expiredEventKey);
  assert.equal(activeRows.length, 2);
  assert.deepEqual(activeRows.map((row) => row.version_id), [activeFirst.versionId, activeSecond.versionId]);
  assert.deepEqual(activeRows.map((row) => row.content_hash), [activeFirst.contentHash, activeSecond.contentHash]);
  assert.equal(activeRows.every((row) => row.state === 'available' && row.sealed !== null), true);
  assert.equal(expiredRows.length, 2);
  assert.equal(expiredRows.every((row) => row.state === 'expired' && row.version_id === null
    && row.parent_version_id === null && row.content_hash === null && row.material_hash === null
    && row.expires_at_ms === null && row.encryption_key_id === null && row.sealed === null), true);
  const expiredHead = disk.heads.find((row) => row.event_key === expiredEventKey);
  assert.equal(expiredHead.state, 'expired');
  assert.equal(expiredHead.revision, null);
  assert.equal(expiredHead.version_id, null);
  assert.equal(expiredHead.content_hash, null);
  assert.equal(expiredHead.material_hash, null);
  assert.equal(expiredHead.expires_at_ms, null);
  assert.equal(disk.idempotencyCount, 2);
  assert.equal(disk.references, 1);
  assert.equal(disk.invalidations, 1);

  const tableInfo = new DatabaseSync(databasePath);
  try {
    assert.equal(tableInfo.prepare('PRAGMA table_info(versions)').all().find((column) => column.name === 'version_id').notnull, 0);
  } finally {
    tableInfo.close();
  }
  const priorCandidateDb = new DatabaseSync(databasePath);
  try {
    // The previously reviewed migration made the column nullable but copied
    // version_id unchanged for already-expired rows. Recreate that durable state
    // to ensure a later transaction can safely normalize it again.
    priorCandidateDb.prepare('UPDATE versions SET version_id = ? WHERE event_key = ? AND revision = 1')
      .run(expiredFirst.versionId, expiredEventKey);
    priorCandidateDb.prepare('INSERT INTO idempotency VALUES (?, ?, ?, ?)')
      .run(expiredEventKey, 'post-migration-stale-key', 'stale-fingerprint', expiredFirst.versionId);
    priorCandidateDb.prepare('INSERT INTO downstream_references VALUES (?, ?, ?, ?, ?, ?)')
      .run(expiredEventKey, 'post-migration-stale-reference', expiredFirst.versionId, expiredFirst.contentHash,
        'payload-key-v1', Buffer.from('stale-migrated-reference'));
    priorCandidateDb.prepare('INSERT INTO invalidations VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(expiredEventKey, 'post-migration-stale-reference', expiredFirst.versionId, expiredFirst.contentHash,
        expiredSecond.versionId, 'material_projection_changed', new Date(EPOCH).toISOString());
  } finally {
    priorCandidateDb.close();
  }
  assert.equal(await reopened.purgeExpired(reopenedScope, harness.request), 0);
  const repeated = await inspectDatabase(harness.root);
  assert.equal(repeated.versions.filter((row) => row.event_key === expiredEventKey)
    .every((row) => row.version_id === null && row.parent_version_id === null && row.content_hash === null
      && row.material_hash === null && row.expires_at_ms === null && row.encryption_key_id === null && row.sealed === null), true);
  assert.equal(repeated.idempotencyCount, 2);
  assert.equal(repeated.references, 1);
  assert.equal(repeated.invalidations, 1);
  assert.equal((await reopened.getHistory(reopenedScope, activeEventId, harness.request)).contentHash, activeSecond.contentHash);
});
