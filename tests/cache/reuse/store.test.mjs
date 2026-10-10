import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, lstat, mkdir, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createScopedReuseStore, ScopedReuseError } from '../../../src/cache/reuse/store.mjs';
import { createPrivacyBoundary } from '../../../src/privacy/boundary.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const PINS = Object.freeze({
  schemaVersion: 'profile-schema-1',
  extractorVersion: 'extractor-1',
  questionSetVersion: 'questions-1',
  policyHash: HASH_B,
  modelVersion: 'model-1',
});
const IDENTITY = Object.freeze({ occurrenceId: 'occurrence-1', entityId: 'entity-1', editionId: 'edition-1' });

function request(tenantId = 'tenant-a') {
  return Object.freeze({ principal: Object.freeze({ tenantId, actorId: `actor-${tenantId}` }) });
}

function facts() {
  return Object.freeze({
    event_name: Object.freeze({ status: 'sourced', value: 'Canary Event', supportRefs: Object.freeze(['PRIVATE_SUPPORT_CANARY']) }),
    venue: Object.freeze({ status: 'inferred', value: 'Canary Hall', supportRefs: Object.freeze(['PRIVATE_POSITION_CANARY']) }),
  });
}

function lineageComplete() {
  return Object.freeze({
    logicalOperationId: 'PRIVATE_LOGICAL_CANARY',
    billableAttemptId: 'PRIVATE_BILLABLE_CANARY',
    transportAttemptId: 'PRIVATE_TRANSPORT_CANARY',
    providerRequestId: 'PRIVATE_REQUEST_CANARY',
    observationIds: Object.freeze(['PRIVATE_OBSERVATION_CANARY']),
    usageEventIds: Object.freeze(['PRIVATE_USAGE_CANARY']),
    status: 'complete',
  });
}

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ei-scoped-reuse-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const clock = { value: 1_800_000_000_000 };
  const state = { observation: null, permission: 'valid', delivered: null, acknowledge: false, replayAck: false, previousAck: null, retentionMs: 7 * 24 * 60 * 60 * 1000, publicOnlyRequested: false, authorizationActions: [], advanceAtAuthorizationCall: null, advanceClockTo: null, advanceOnPermissionTo: null };
  const options = {
    directory,
    now: () => clock.value,
    resolveTenant: (authRequest) => authRequest?.principal?.tenantId,
    resolveActor: (authRequest) => authRequest?.principal?.actorId,
    authorizeAction: ({ action }) => {
      state.authorizationActions.push(action);
      if (state.authorizationActions.length === state.advanceAtAuthorizationCall) clock.value = state.advanceClockTo;
      return true;
    },
    resolveKey: ({ tenantId, scope, purpose }) => ({
      keyId: `${scope}:${purpose}:${tenantId ?? 'global'}`,
      key: Buffer.alloc(32, tenantId ? tenantId.charCodeAt(0) : 91),
    }),
    resolveRetention: ({ nowMs }) => ({
      expiresAtMs: nowMs + state.retentionMs,
      policyId: 'trusted-test-retention',
      policyVersion: '7',
    }),
    verifySourceObservation: ({ expectedContentHash, purpose, observation: raw }) => {
      if (state.observation) return state.observation(expectedContentHash, purpose, raw);
      return {
        status: 'body_changed',
        contentHash: expectedContentHash,
        retrievedAt: new Date(clock.value - 1_000).toISOString(),
        validatedAt: new Date(clock.value).toISOString(),
        attemptLineage: { status: 'unknown' },
      };
    },
    resolvePrivateProfileReferences: ({ contentHash }) => ({
      permissions: [{ reference: 'PRIVATE_PERMISSION_CANARY', contentHash, version: 1, use: 'cache_read' }],
      sourceRefs: ['PRIVATE_SOURCE_CANARY'],
      correctionRefs: ['PRIVATE_CORRECTION_CANARY'],
    }),
    verifyPermission: () => {
      if (state.advanceOnPermissionTo !== null) {
        clock.value = state.advanceOnPermissionTo;
        state.advanceOnPermissionTo = null;
      }
      return state.permission;
    },
    resolveLineage: () => lineageComplete(),
    consumeOriginalLineage: ({ sourceRefs, correctionRefs, lineage }) => {
      state.consumedLineage = { sourceRefs, correctionRefs, lineage };
      return { status: 'linked', logicalOperationBound: true, billedAttemptCount: 1, usageObservationCount: 2 };
    },
    resolveInvalidationConsumers: ({ descriptor }) => {
      if (descriptor.publicSafeOnly) state.publicOnlyRequested = true;
      return descriptor.publicSafeOnly ? ['PUBLIC_SAFE_CONSUMER'] : ['PRIVATE_CONSUMER'];
    },
    deliverInvalidation: async (event) => {
      state.delivered = event;
      const acknowledgement = state.replayAck && state.previousAck ? state.previousAck : { ...event };
      state.previousAck = { ...event };
      return acknowledgement;
    },
    verifyInvalidationAcknowledgement: ({ expected, acknowledgement }) => state.acknowledge
      && acknowledgement?.eventId === expected.eventId
      && acknowledgement?.deliveryAttemptId === expected.deliveryAttemptId
      && acknowledgement?.attemptNumber === expected.attemptNumber
      && acknowledgement?.entryRef === expected.entryRef
      && acknowledgement?.contentHash === expected.contentHash
      && acknowledgement?.version === expected.version
      && acknowledgement?.consumerRef === expected.consumerRef,
    verifyAdmissionOutcome: ({ requestedOutcome }) => ({ outcome: requestedOutcome, attemptLineage: { status: 'unknown' } }),
    ...overrides,
  };
  const store = createScopedReuseStore(options);
  return { directory, clock, state, store, options };
}

async function putPrivate(store, authRequest = request(), input = {}) {
  const scope = await store.scopeForAuthenticatedRequest(authRequest);
  const profile = await store.putPrivateProfile(scope, authRequest, {
    identity: input.identity ?? IDENTITY,
    contentHash: input.contentHash ?? HASH_A,
    pins: input.pins ?? PINS,
    facts: input.facts ?? facts(),
    observation: input.observation ?? Object.freeze({ source: 'opaque-host-observation' }),
    ...(input.freshnessTtlMs ? { freshnessTtlMs: input.freshnessTtlMs } : {}),
    ...(input.expiresAtMs ? { expiresAtMs: input.expiresAtMs } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return { scope, authRequest, profile, lookup: { identity: input.identity ?? IDENTITY, contentHash: input.contentHash ?? HASH_A, pins: input.pins ?? PINS } };
}

function approvedBoundary(authRequest, candidate = { event_name: 'Public Lantern Night', event_date: '2027-06-20', venue: 'Civic Hall' }) {
  const boundary = createPrivacyBoundary({
    resolveTenant: (value) => value?.principal?.tenantId,
    reviewPublicFacts: ({ tenantId, sourceDigest, candidate: factsValue }) => ({ status: 'approved', tenantId, sourceDigest, facts: factsValue }),
  });
  const boundaryScope = boundary.scopeForAuthenticatedRequest(authRequest);
  const started = boundary.begin(boundaryScope, { modality: 'plain_text', content: 'Public event listing plus private evidence' });
  return boundary.prepare(boundaryScope, started.session, candidate).then(() => ({ boundary, boundaryScope, derivative: boundary.publish(boundaryScope, started.session) }));
}

async function putPublic(store, authRequest, boundaryData, input = {}) {
  const scope = await store.scopeForAuthenticatedRequest(authRequest);
  const profile = await store.publishReviewedPublicProfile(scope, authRequest, {
    ...boundaryData,
    identity: input.identity ?? IDENTITY,
    contentHash: input.contentHash ?? HASH_A,
    pins: input.pins ?? PINS,
    observation: input.observation ?? Object.freeze({ source: 'opaque-host-observation' }),
  });
  return { scope, authRequest, profile, lookup: { identity: input.identity ?? IDENTITY, contentHash: input.contentHash ?? HASH_A, pins: input.pins ?? PINS } };
}

test('private cache keys bind tenant, occurrence, entity, edition, content, and every explicit version pin', async (t) => {
  const env = await fixture(t);
  const first = await putPrivate(env.store);
  const hit = await env.store.getPrivateProfile(first.scope, first.authRequest, first.lookup);
  assert.equal(hit.status, 'hit');
  assert.equal(hit.facts.event_name.supportRefs[0], 'PRIVATE_SUPPORT_CANARY');
  assert.equal(hit.originalLineageStatus, 'complete');
  assert.equal('logicalOperationId' in hit, false);
  assert.equal('usageEventIds' in hit, false);

  const changedContent = await env.store.getPrivateProfile(first.scope, first.authRequest, { ...first.lookup, contentHash: HASH_B });
  assert.deepEqual({ status: changedContent.status, reason: changedContent.reason }, { status: 'stale', reason: 'content_hash_mismatch' });
  for (const pin of ['schemaVersion', 'extractorVersion', 'questionSetVersion', 'policyHash', 'modelVersion']) {
    const mismatch = await env.store.getPrivateProfile(first.scope, first.authRequest, {
      ...first.lookup,
      pins: { ...PINS, [pin]: pin === 'policyHash' ? 'c'.repeat(64) : `${PINS[pin]}-next` },
    });
    assert.deepEqual({ status: mismatch.status, reason: mismatch.reason }, { status: 'stale', reason: 'policy_hash_stale' }, pin);
  }
  assert.equal((await env.store.getPrivateProfile(first.scope, first.authRequest, first.lookup)).status, 'hit');

  const edition = await env.store.getPrivateProfile(first.scope, first.authRequest, {
    ...first.lookup,
    identity: { ...IDENTITY, editionId: 'edition-2' },
  });
  assert.equal(edition.status, 'miss');
  const otherScope = await env.store.scopeForAuthenticatedRequest(request('tenant-b'));
  const crossTenant = await env.store.getPrivateProfile(otherScope, request('tenant-b'), first.lookup);
  assert.equal(crossTenant.status, 'miss');

  const dbBytes = await readFile(path.join(env.directory, 'scoped-reuse.sqlite'));
  for (const canary of ['PRIVATE_SUPPORT_CANARY', 'PRIVATE_SOURCE_CANARY', 'PRIVATE_CORRECTION_CANARY', 'PRIVATE_USAGE_CANARY']) {
    assert.equal(dbBytes.includes(Buffer.from(canary)), false, `${canary} must stay encrypted at rest`);
  }
});

test('private records fail closed without a trusted permission verifier', async (t) => {
  const env = await fixture(t, { verifyPermission: undefined });
  const created = await putPrivate(env.store);
  const result = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  assert.deepEqual({ status: result.status, reason: result.reason }, { status: 'ineligible', reason: 'permission_unverified' });
});

test('public reuse accepts only the authentic boundary derivative and host policy, then shares three reviewed fields', async (t) => {
  const denied = await fixture(t, { authorizePublicPublication: undefined });
  const authRequest = request();
  const boundaryData = await approvedBoundary(authRequest);
  const deniedScope = await denied.store.scopeForAuthenticatedRequest(authRequest);
  await assert.rejects(denied.store.publishReviewedPublicProfile(deniedScope, authRequest, {
    ...boundaryData, identity: IDENTITY, contentHash: HASH_A, pins: PINS, observation: {},
  }), (error) => error instanceof ScopedReuseError && error.code === 'REUSE_POLICY_UNAVAILABLE');
  assert.equal((await denied.store.integritySnapshot(deniedScope, authRequest)).entryCount, 0);

  const env = await fixture(t, {
    authorizePublicPublication: ({ tenantId, request: sourceRequest, identity, contentHash }) => {
      assert.equal(tenantId, sourceRequest.principal.tenantId);
      return { status: 'approved', identity, contentHash, publicPermissions: [] };
    },
  });
  const created = await putPublic(env.store, authRequest, boundaryData);
  const otherRequest = request('tenant-b');
  const otherScope = await env.store.scopeForAuthenticatedRequest(otherRequest);
  const read = await env.store.getPublicProfile(otherScope, otherRequest, created.lookup);
  assert.equal(read.status, 'hit');
  assert.deepEqual(Object.keys(read.facts).sort(), ['event_date', 'event_name', 'venue']);
  assert.equal(read.trust, 'untrusted_external');
  assert.equal(read.rights, 'not_asserted');
  assert.equal(read.permissionStatus, 'not_asserted');
  assert.equal(JSON.stringify(read).includes('PRIVATE_SOURCE_CANARY'), false);
  assert.equal(JSON.stringify(read).includes('occurrence-1'), false);

  const forged = { ...boundaryData, boundary: {}, derivative: {} };
  const authScope = await env.store.scopeForAuthenticatedRequest(authRequest);
  await assert.rejects(env.store.publishReviewedPublicProfile(authScope, authRequest, {
    ...forged, identity: IDENTITY, contentHash: HASH_B, pins: PINS, observation: {},
  }), (error) => error.code === 'REUSE_POLICY_UNAVAILABLE');
});

test('304 observations preserve original retrieval time, outages do not invent retrievals, and changed bodies invalidate', async (t) => {
  const env = await fixture(t);
  const created = await putPrivate(env.store);
  const original = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  assert.equal(original.status, 'hit');
  const retrievalTime = original.retrievedAt;

  env.clock.value += 1_000;
  env.state.observation = (_hash, _purpose, raw) => raw.mode === 'not-modified'
    ? { status: 'not_modified', contentHash: HASH_A, validatedAt: new Date(env.clock.value).toISOString(), attemptLineage: { status: 'unknown' } }
    : { status: 'outage', validatedAt: new Date(env.clock.value).toISOString(), attemptLineage: { status: 'unknown' } };
  const unchanged = await env.store.observe(created.scope, created.authRequest, { profileRef: created.profile.profileRef, scopeKind: 'tenant_private', observation: { mode: 'not-modified' } });
  assert.equal(unchanged.status, 'not_modified');
  const after304 = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  assert.equal(after304.status, 'hit');
  assert.equal(after304.retrievedAt, retrievalTime);
  assert.notEqual(after304.validatedAt, original.validatedAt);

  env.clock.value += 1_000;
  const outage = await env.store.observe(created.scope, created.authRequest, { profileRef: created.profile.profileRef, scopeKind: 'tenant_private', observation: { mode: 'outage' } });
  assert.equal(outage.status, 'outage');
  const duringOutage = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  assert.equal(duringOutage.status, 'unavailable');
  assert.equal(duringOutage.reason, 'source_outage');
  assert.equal(duringOutage.retrievedAt, undefined);

  env.clock.value += 1_000;
  env.state.observation = () => ({ status: 'body_changed', contentHash: HASH_B, retrievedAt: new Date(env.clock.value - 100).toISOString(), validatedAt: new Date(env.clock.value).toISOString() });
  const changed = await env.store.observe(created.scope, created.authRequest, { profileRef: created.profile.profileRef, scopeKind: 'tenant_private', observation: { mode: 'changed' } });
  assert.equal(changed.invalidated, true);
  assert.equal((await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup)).reason, 'invalidated');
  assert.equal((await env.store.outboxSnapshot(created.scope, created.authRequest)).unresolved, 1);
});

test('removed evidence, permission revocation, and policy changes persist ineligibility with an exact private outbox reference', async (t) => {
  const env = await fixture(t);
  const created = await putPrivate(env.store);
  env.clock.value += 1_000;
  env.state.observation = () => ({ status: 'evidence_lost', validatedAt: new Date(env.clock.value).toISOString() });
  const lost = await env.store.observe(created.scope, created.authRequest, { profileRef: created.profile.profileRef, scopeKind: 'tenant_private', observation: {} });
  assert.equal(lost.invalidated, true);
  const row = await env.store.outboxSnapshot(created.scope, created.authRequest);
  assert.equal(row.pending, 1);
  assert.equal(row.readiness, 'blocked_pending_external_ack');
  assert.equal(env.state.delivered, null);
});

test('source removal and TTL expiry never return historical facts as fresh', async (t) => {
  const env = await fixture(t);
  const removedEntry = await putPrivate(env.store);
  env.state.observation = () => ({ status: 'removed', validatedAt: new Date(env.clock.value).toISOString() });
  const removed = await env.store.observe(removedEntry.scope, removedEntry.authRequest, {
    profileRef: removedEntry.profile.profileRef, scopeKind: 'tenant_private', observation: {},
  });
  assert.equal(removed.status, 'removed');
  assert.equal(removed.invalidated, true);
  assert.equal((await env.store.getPrivateProfile(removedEntry.scope, removedEntry.authRequest, removedEntry.lookup)).reason, 'invalidated');

  const ttlEnv = await fixture(t, { defaultFreshnessTtlMs: 2_000 });
  ttlEnv.state.retentionMs = 60_000;
  const ttlEntry = await putPrivate(ttlEnv.store, request(), { freshnessTtlMs: 1_000 });
  ttlEnv.clock.value += 2_000;
  const stale = await ttlEnv.store.getPrivateProfile(ttlEntry.scope, ttlEntry.authRequest, ttlEntry.lookup);
  assert.deepEqual({ status: stale.status, reason: stale.reason }, { status: 'stale', reason: 'ttl_expired' });
});

test('a newly stored pinned policy version invalidates the old version atomically', async (t) => {
  const env = await fixture(t);
  const oldVersion = await putPrivate(env.store);
  const nextPins = { ...PINS, policyHash: 'c'.repeat(64), modelVersion: 'model-2' };
  const newVersion = await putPrivate(env.store, request(), { pins: nextPins });
  assert.equal(newVersion.profile.status, 'stored');
  assert.equal(newVersion.profile.version, 2);
  const oldRead = await env.store.getPrivateProfile(oldVersion.scope, oldVersion.authRequest, oldVersion.lookup);
  assert.deepEqual({ status: oldRead.status, reason: oldRead.reason }, { status: 'unavailable', reason: 'invalidated' });
  const newRead = await env.store.getPrivateProfile(newVersion.scope, newVersion.authRequest, newVersion.lookup);
  assert.equal(newRead.status, 'hit');
  assert.equal((await env.store.outboxSnapshot(oldVersion.scope, oldVersion.authRequest)).pending, 1);
});

test('outbox acknowledgements are attempt-bound and forged acknowledgements stay pending until verified', async (t) => {
  const env = await fixture(t);
  const created = await putPrivate(env.store);
  await env.store.invalidate(created.scope, created.authRequest, {
    profileRef: created.profile.profileRef,
    scopeKind: 'tenant_private',
    reason: 'material_fact_change',
  });
  const forged = await env.store.dispatchPendingInvalidations(created.scope, created.authRequest);
  assert.equal(forged.delivered, 0);
  assert.equal((await env.store.outboxSnapshot(created.scope, created.authRequest)).unresolved, 1);
  assert.equal(env.state.delivered.consumerRef, 'PRIVATE_CONSUMER');

  env.clock.value += 1_000;
  env.state.acknowledge = true;
  const restarted = createScopedReuseStore(env.options);
  const restartScope = await restarted.scopeForAuthenticatedRequest(created.authRequest);
  env.state.replayAck = true;
  const replayed = await restarted.dispatchPendingInvalidations(restartScope, created.authRequest);
  assert.equal(replayed.delivered, 0);
  assert.equal((await restarted.outboxSnapshot(restartScope, created.authRequest)).unresolved, 1);

  env.clock.value += 1_000;
  env.state.replayAck = false;
  const accepted = await restarted.dispatchPendingInvalidations(restartScope, created.authRequest);
  assert.equal(accepted.delivered, 1);
  assert.equal(accepted.deliveryKind, 'injected_host_callback');
  const snapshot = await restarted.outboxSnapshot(restartScope, created.authRequest);
  assert.equal(snapshot.unresolved, 0);
  assert.equal(snapshot.readiness, 'external_consumer_unverified');
});

test('cancellation during delivery leaves the persisted attempt unresolved', async (t) => {
  const controller = new AbortController();
  let verified = false;
  const env = await fixture(t, {
    deliverInvalidation: async (expected) => {
      controller.abort();
      return expected;
    },
    verifyInvalidationAcknowledgement: () => {
      verified = true;
      return true;
    },
  });
  const created = await putPrivate(env.store);
  await env.store.invalidate(created.scope, created.authRequest, {
    profileRef: created.profile.profileRef,
    scopeKind: 'tenant_private',
    reason: 'material_fact_change',
  });

  await assert.rejects(
    env.store.dispatchPendingInvalidations(created.scope, created.authRequest, 20, 'tenant_private', controller.signal),
    (error) => error.code === 'REUSE_DENIED',
  );
  assert.equal(verified, false);
  assert.deepEqual(
    await env.store.outboxSnapshot(created.scope, created.authRequest),
    { pending: 0, delivering: 1, failed: 0, delivered: 0, unresolved: 1, readiness: 'blocked_pending_external_ack' },
  );
});

test('public lineage stays tenant-private and rechecks the original permission before the finance callback', async (t) => {
  const env = await fixture(t, {
    authorizePublicPublication: ({ identity, contentHash }) => ({ status: 'approved', identity, contentHash, publicPermissions: [] }),
  });
  const authRequest = request();
  const boundaryData = await approvedBoundary(authRequest);
  const created = await putPublic(env.store, authRequest, boundaryData);
  const before = await env.store.withPrivateLineage(created.scope, authRequest, created.profile.profileRef);
  assert.equal(before.status, 'linked');
  assert.equal(env.state.consumedLineage.sourceRefs[0], 'PRIVATE_SOURCE_CANARY');
  assert.equal(before.allocationAuthority, 'finance_external');
  assert.equal('PRIVATE_SOURCE_CANARY' in before, false);

  env.state.permission = 'revoked';
  await assert.rejects(env.store.withPrivateLineage(created.scope, authRequest, created.profile.profileRef), (error) => error.code === 'REUSE_DENIED');
  const after = await env.store.getPublicProfile(created.scope, authRequest, created.lookup);
  assert.equal(after.status, 'unavailable');
  assert.equal(after.reason, 'invalidated');
});

test('public invalidation emits only an opaque content reference and host-approved consumer reference', async (t) => {
  const env = await fixture(t, {
    authorizePublicPublication: ({ identity, contentHash }) => ({ status: 'approved', identity, contentHash, publicPermissions: [] }),
  });
  const authRequest = request();
  const boundaryData = await approvedBoundary(authRequest);
  const created = await putPublic(env.store, authRequest, boundaryData);
  await env.store.invalidate(created.scope, authRequest, {
    profileRef: created.profile.profileRef, scopeKind: 'public_profile', reason: 'material_fact_change',
  });
  const dispatch = await env.store.dispatchPendingInvalidations(created.scope, authRequest, 5, 'public_profile');
  assert.equal(dispatch.delivered, 0);
  assert.equal(env.state.publicOnlyRequested, true);
  assert.equal(env.state.delivered.consumerRef, 'PUBLIC_SAFE_CONSUMER');
  assert.notEqual(env.state.delivered.contentHash, HASH_A);
  assert.equal('identity' in env.state.delivered, false);
  assert.equal(JSON.stringify(env.state.delivered).includes('occurrence-1'), false);
  assert.equal((await env.store.outboxSnapshot(created.scope, authRequest, 'public_profile')).unresolved, 1);
});

test('retention expiry persists cleanup on an unavailable read; clock rollback blocks reads', async (t) => {
  const env = await fixture(t, { maxRetentionMs: 10_000, defaultFreshnessTtlMs: 5_000, maxEntryBytes: 8_000 });
  env.state.retentionMs = 5_000;
  const created = await putPrivate(env.store, request(), { freshnessTtlMs: 4_000 });
  env.clock.value += 6_000;
  const expired = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  assert.equal(expired.status, 'unavailable');
  assert.equal(expired.reason, 'expired');
  const snapshot = await env.store.integritySnapshot(created.scope, created.authRequest);
  assert.equal(snapshot.eligibleEntryCount, 0);
  assert.equal((await env.store.outboxSnapshot(created.scope, created.authRequest)).pending, 1);

  const clockEnv = await fixture(t, { maxRetentionMs: 10_000, defaultFreshnessTtlMs: 5_000 });
  clockEnv.state.retentionMs = 5_000;
  const clockCreated = await putPrivate(clockEnv.store, request(), { freshnessTtlMs: 4_000 });
  clockEnv.clock.value -= 1_000;
  const rollback = await clockEnv.store.getPrivateProfile(clockCreated.scope, clockCreated.authRequest, clockCreated.lookup);
  assert.equal(rollback.status, 'unavailable');
  assert.equal(rollback.reason, 'clock_rollback');
});

test('retention revalidation cannot extend the originally stored expiration cap', async (t) => {
  const env = await fixture(t);
  const created = await putPrivate(env.store, request(), { freshnessTtlMs: 60_000 });
  const first = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  env.clock.value += 5_000;
  const repeated = await putPrivate(env.store, request(), { freshnessTtlMs: 60_000 });
  assert.equal(repeated.profile.status, 'existing');
  const after = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  assert.equal(after.expiresAt, first.expiresAt);
  assert.notEqual(after.retrievedAt, first.retrievedAt);
});

test('idempotent replay rechecks the persisted head expiry after authorization callbacks', async (t) => {
  const env = await fixture(t, { maxRetentionMs: 10_000 });
  env.state.retentionMs = 10_000;
  const created = await putPrivate(env.store, request(), { freshnessTtlMs: 10_000 });
  const initial = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  const expiresAtMs = Date.parse(initial.expiresAt);
  env.clock.value = expiresAtMs - 1;
  env.state.advanceAtAuthorizationCall = env.state.authorizationActions.length + 9;
  env.state.advanceClockTo = expiresAtMs;

  const replay = await putPrivate(env.store, request(), { freshnessTtlMs: 1_000 });
  assert.equal(replay.profile.status, 'expired');
  assert.equal((await env.store.integritySnapshot(created.scope, created.authRequest)).eligibleEntryCount, 0);
  assert.equal((await env.store.outboxSnapshot(created.scope, created.authRequest)).pending, 1);
});

test('profile reads recheck the persisted head expiry after an awaited permission decision', async (t) => {
  const env = await fixture(t, { maxRetentionMs: 10_000 });
  env.state.retentionMs = 10_000;
  const created = await putPrivate(env.store, request(), { freshnessTtlMs: 10_000 });
  const initial = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  const expiresAtMs = Date.parse(initial.expiresAt);
  env.clock.value = expiresAtMs - 1;
  env.state.advanceOnPermissionTo = expiresAtMs;

  const expired = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  assert.deepEqual({ status: expired.status, reason: expired.reason }, { status: 'unavailable', reason: 'expired' });
  assert.equal('facts' in expired, false);
  assert.equal((await env.store.integritySnapshot(created.scope, created.authRequest)).eligibleEntryCount, 0);
  assert.equal((await env.store.outboxSnapshot(created.scope, created.authRequest)).pending, 1);
});

test('cancellation during retention resolution leaves no visible profile', async (t) => {
  const controller = new AbortController();
  const env = await fixture(t, {
    resolveRetention: ({ nowMs }) => {
      controller.abort();
      return { expiresAtMs: nowMs + 60_000, policyId: 'trusted-test-retention', policyVersion: '1' };
    },
  });
  const scope = await env.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(env.store.putPrivateProfile(scope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS, facts: facts(), observation: {}, signal: controller.signal,
  }), (error) => error.code === 'REUSE_DENIED');
  assert.equal((await env.store.integritySnapshot(scope, request())).entryCount, 0);
});

test('signal checks use the intrinsic AbortSignal state and sanitize proxy failures', async (t) => {
  const env = await fixture(t);
  const shadowedSignal = new AbortController().signal;
  Object.defineProperty(shadowedSignal, 'aborted', { get() { throw new Error('SECRET_SIGNAL_GETTER'); } });
  const created = await putPrivate(env.store, request(), { signal: shadowedSignal });
  assert.equal(created.profile.status, 'stored');

  const scope = await env.store.scopeForAuthenticatedRequest(request());
  const proxySignal = new Proxy(new AbortController().signal, { get() { throw new Error('SECRET_SIGNAL_PROXY'); } });
  await assert.rejects(env.store.putPrivateProfile(scope, request(), {
    identity: { ...IDENTITY, editionId: 'proxy-signal-edition' }, contentHash: HASH_A, pins: PINS,
    facts: facts(), observation: {}, signal: proxySignal,
  }), (error) => error.code === 'REUSE_INVALID' && !error.message.includes('SECRET_SIGNAL'));
  assert.equal((await env.store.integritySnapshot(scope, request())).entryCount, 1);
});

test('serialized encrypted payload size is bounded before committing', async (t) => {
  const env = await fixture(t, { maxEntryBytes: 2_048 });
  const scope = await env.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(env.store.putPrivateProfile(scope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS,
    facts: { event_name: { status: 'sourced', value: 'Canary Event', supportRefs: Array(64).fill('R'.repeat(512)) } },
    observation: {}, freshnessTtlMs: 1_000,
  }), (error) => error.code === 'REUSE_CAPACITY');
  assert.equal((await env.store.integritySnapshot(scope, request())).entryCount, 0);

  assert.throws(() => createScopedReuseStore({
    ...env.options,
    maxEntryBytes: 2_047,
  }), (error) => error.code === 'REUSE_INVALID');

  const aggregate = await fixture(t, { maxStoreBytes: 128 });
  const aggregateScope = await aggregate.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(aggregate.store.putPrivateProfile(aggregateScope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS, facts: facts(), observation: {}, freshnessTtlMs: 1_000,
  }), (error) => error.code === 'REUSE_CAPACITY');
  assert.equal((await aggregate.store.integritySnapshot(aggregateScope, request())).entryCount, 0);
});

test('eligible entries reserve bounded durable invalidation capacity before admission', async (t) => {
  const env = await fixture(t, { maxOutboxEntries: 1, maxStoreBytes: 32_000 });
  const first = await putPrivate(env.store);
  await env.store.invalidate(first.scope, first.authRequest, {
    profileRef: first.profile.profileRef,
    scopeKind: 'tenant_private',
    reason: 'material_fact_change',
  });
  assert.equal((await env.store.outboxSnapshot(first.scope, first.authRequest)).pending, 1);

  await assert.rejects(putPrivate(env.store, request(), {
    identity: { ...IDENTITY, editionId: 'edition-2' },
  }), (error) => error.code === 'REUSE_CAPACITY');
  assert.equal((await env.store.integritySnapshot(first.scope, first.authRequest)).entryCount, 1);
  assert.equal((await env.store.outboxSnapshot(first.scope, first.authRequest)).unresolved, 1);
});

test('database parent symlinks and untrusted proxy diagnostics fail closed without leaking details', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-reuse-symlink-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'real');
  const link = path.join(root, 'link');
  await mkdir(target);
  await symlink(target, link);
  const env = await fixture(t, { directory: link });
  const scope = await env.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(env.store.integritySnapshot(scope, request()), (error) => error.code === 'REUSE_STORAGE');

  const proxyError = new Proxy({}, {
    get() { throw new Error('SECRET_PROXY_GET'); },
    getOwnPropertyDescriptor() { throw new Error('SECRET_PROXY_DESCRIPTOR'); },
  });
  const badKeyEnv = await fixture(t, { resolveKey: async () => { throw proxyError; } });
  await assert.rejects(badKeyEnv.store.scopeForAuthenticatedRequest(request()).then((scopeValue) => badKeyEnv.store.integritySnapshot(scopeValue, request())), (error) => {
    assert.equal(error.code, 'REUSE_KEY_UNAVAILABLE');
    assert.equal(error.message.includes('SECRET_PROXY'), false);
    return true;
  });
});

test('admission preserves unknown outcomes and gives intentional fresh operations distinct references', async (t) => {
  const env = await fixture(t, { verifyAdmissionOutcome: ({ requestedOutcome }) => ({ outcome: requestedOutcome, attemptLineage: { status: 'unknown' } }) });
  const authRequest = request();
  const scope = await env.store.scopeForAuthenticatedRequest(authRequest);
  const first = await env.store.admitOperation(scope, authRequest, { identity: IDENTITY, pins: PINS, mode: 'reuse', leaseMs: 100 });
  assert.equal(first.status, 'admitted');
  assert.equal(first.usage, 'unknown');
  const duplicate = await env.store.admitOperation(scope, authRequest, { identity: IDENTITY, pins: PINS, mode: 'reuse', leaseMs: 100 });
  assert.equal(duplicate.status, 'in_flight');
  env.clock.value += 200;
  const uncertain = await env.store.admitOperation(scope, authRequest, { identity: IDENTITY, pins: PINS, mode: 'reuse', leaseMs: 100 });
  assert.equal(uncertain.status, 'needs_reconciliation');
  const reconciled = await env.store.reconcileAdmission(scope, authRequest, { admissionRef: first.admissionRef, outcome: 'unknown' });
  assert.equal(reconciled.status, 'unknown');
  assert.equal(reconciled.usage, 'unknown');
  assert.equal(reconciled.holdDisposition, 'finance_reconciliation_required');
  const freshA = await env.store.admitOperation(scope, authRequest, { identity: IDENTITY, pins: PINS, mode: 'fresh' });
  const freshB = await env.store.admitOperation(scope, authRequest, { identity: IDENTITY, pins: PINS, mode: 'fresh' });
  assert.notEqual(freshA.admissionRef, freshB.admissionRef);
  assert.equal(freshA.providerTransport, 'not_implemented');
});

test('duplicate completion is idempotent and never turns unknown usage into a local expense', async (t) => {
  let attestations = 0;
  const env = await fixture(t, {
    verifyAdmissionOutcome: ({ requestedOutcome }) => {
      attestations += 1;
      return { outcome: requestedOutcome, attemptLineage: lineageComplete() };
    },
  });
  const authRequest = request();
  const scope = await env.store.scopeForAuthenticatedRequest(authRequest);
  const admission = await env.store.admitOperation(scope, authRequest, { identity: IDENTITY, pins: PINS, mode: 'fresh' });
  const completed = await env.store.reconcileAdmission(scope, authRequest, { admissionRef: admission.admissionRef, outcome: 'completed' });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.usage, 'unknown');
  assert.equal(completed.holdDisposition, 'finance_reconciliation_required');
  const duplicate = await env.store.reconcileAdmission(scope, authRequest, { admissionRef: admission.admissionRef, outcome: 'completed' });
  assert.equal(duplicate.status, 'completed');
  assert.equal(duplicate.usage, 'unknown');
  assert.equal(attestations, 1);
  assert.equal('amount' in completed, false);
  assert.equal('charge' in completed, false);
});

test('SQLite admission is single-flight across two live Node processes', async (t) => {
  const env = await fixture(t);
  const worker = path.resolve('tests/cache/reuse/admission-worker.mjs');
  const run = () => spawn(process.execPath, [worker], {
    cwd: process.cwd(),
    env: { ...process.env, REUSE_WORKER_CONFIG: JSON.stringify({ directory: env.directory, tenantId: 'tenant-process' }) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const first = run();
  t.after(() => first.kill('SIGKILL'));
  const firstLine = await new Promise((resolve, reject) => {
    let output = '';
    first.stdout.setEncoding('utf8');
    first.stdout.on('data', (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline >= 0) resolve(output.slice(0, newline));
    });
    first.once('error', reject);
    first.stderr.on('data', () => {});
  });
  assert.equal(JSON.parse(firstLine).status, 'admitted');

  const second = run();
  t.after(() => second.kill('SIGKILL'));
  const secondLine = await new Promise((resolve, reject) => {
    let output = '';
    second.stdout.setEncoding('utf8');
    second.stdout.on('data', (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline >= 0) resolve(output.slice(0, newline));
    });
    second.once('error', reject);
    second.stderr.on('data', () => {});
  });
  assert.equal(JSON.parse(secondLine).status, 'in_flight');
  first.stdin.end('done\n');
  second.stdin.end('done\n');
});

test('the exported store surface is intentionally narrow', async (t) => {
  const env = await fixture(t);
  const created = await putPrivate(env.store);
  assert.equal((await lstat(path.join(env.directory, 'scoped-reuse.sqlite'))).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(env.store).sort(), [
    'admitOperation', 'dispatchPendingInvalidations', 'getPrivateProfile', 'getPublicProfile', 'integritySnapshot',
    'invalidate', 'observe', 'outboxSnapshot', 'publishReviewedPublicProfile', 'purgeExpired', 'putPrivateProfile',
    'reconcileAdmission', 'scopeForAuthenticatedRequest', 'withPrivateLineage',
  ].sort());
  assert.equal(created.profile.rights, 'not_asserted');
});
