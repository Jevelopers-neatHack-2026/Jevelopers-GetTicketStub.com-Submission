import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, lstat, mkdir, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
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

function lineReader(child) {
  let buffer = '';
  const queued = [];
  const waiters = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else queued.push(line);
    }
  });
  child.stderr.on('data', () => {});
  return () => queued.length ? Promise.resolve(queued.shift()) : new Promise((resolve) => waiters.push(resolve));
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
  const state = { observation: null, permission: 'valid', permissionValidUntilMs: 8_640_000_000_000_000, delivered: null, acknowledge: false, replayAck: false, previousAck: null, retentionMs: 7 * 24 * 60 * 60 * 1000, publicOnlyRequested: false, authorizationActions: [], currentAuthorizationActions: [], advanceAtAuthorizationCall: null, advanceClockTo: null, advanceOnPermissionTo: null };
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
    authorizeCurrentRequest: async ({ expectedTenantId, expectedActorId, action, request: authRequest, details }) => {
      state.currentAuthorizationActions.push(action);
      const tenantId = await options.resolveTenant(authRequest);
      const actorId = await options.resolveActor(authRequest);
      if (tenantId !== expectedTenantId || actorId !== expectedActorId) return false;
      const allowed = (await options.authorizeAction({ tenantId, actorId, action, request: authRequest, details })) === true;
      const principal = authRequest?.principal;
      return allowed && principal?.tenantId === expectedTenantId && principal?.actorId === expectedActorId;
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
    verifyPermission: ({ reference, contentHash, version, use }) => {
      if (state.advanceOnPermissionTo !== null) {
        clock.value = state.advanceOnPermissionTo;
        state.advanceOnPermissionTo = null;
      }
      if (state.permission !== 'valid') return state.permission;
      return { status: 'valid', reference, contentHash, version, use, validUntilMs: state.permissionValidUntilMs };
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
    ...(input.freshnessTtlMs ? { freshnessTtlMs: input.freshnessTtlMs } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
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

test('identity observation ordering rejects stale initial replays and equal-time conflicts without replacing current state', async (t) => {
  for (const publicProfile of [false, true]) {
    const env = await fixture(t, {
      authorizePublicPublication: ({ identity, contentHash }) => ({ status: 'approved', identity, contentHash, publicPermissions: [] }),
    });
    const authRequest = request();
    let created;
    let boundaryData;
    if (publicProfile) {
      boundaryData = await approvedBoundary(authRequest);
      created = await putPublic(env.store, authRequest, boundaryData);
    } else {
      created = await putPrivate(env.store, authRequest);
    }
    const originalTime = env.clock.value;

    env.clock.value += 500;
    const outageTime = env.clock.value;
    env.state.observation = () => ({ status: 'outage', validatedAt: new Date(env.clock.value).toISOString() });
    const outage = await env.store.observe(created.scope, authRequest, {
      profileRef: created.profile.profileRef,
      scopeKind: publicProfile ? 'public_profile' : 'tenant_private',
      observation: { source: 'outage' },
    });
    assert.equal(outage.status, 'outage');
    const restarted = createScopedReuseStore(env.options);
    const restartedScope = await restarted.scopeForAuthenticatedRequest(authRequest);

    env.clock.value += 500;
    env.state.observation = () => ({
      status: 'body_changed', contentHash: HASH_A,
      retrievedAt: new Date(originalTime - 1_000).toISOString(),
      validatedAt: new Date(originalTime).toISOString(),
      attemptLineage: { status: 'unknown' },
    });
    if (publicProfile) {
      const replayBoundary = await approvedBoundary(authRequest);
      await assert.rejects(putPublic(restarted, authRequest, replayBoundary), (error) => error.code === 'REUSE_POLICY_UNAVAILABLE');
    } else {
      await assert.rejects(putPrivate(restarted, authRequest), (error) => error.code === 'REUSE_POLICY_UNAVAILABLE');
    }
    const read = publicProfile
      ? await restarted.getPublicProfile(restartedScope, authRequest, created.lookup)
      : await restarted.getPrivateProfile(restartedScope, authRequest, created.lookup);
    assert.deepEqual({ status: read.status, reason: read.reason }, { status: 'unavailable', reason: 'source_outage' });

    env.state.observation = () => ({ status: 'body_changed', contentHash: HASH_B,
      retrievedAt: new Date(outageTime - 100).toISOString(), validatedAt: new Date(outageTime).toISOString() });
    await assert.rejects(restarted.observe(restartedScope, authRequest, {
      profileRef: created.profile.profileRef,
      scopeKind: publicProfile ? 'public_profile' : 'tenant_private',
      observation: { source: 'equal-time-conflict' },
    }), (error) => error.code === 'REUSE_POLICY_UNAVAILABLE');
    const remainsOutage = publicProfile
      ? await restarted.getPublicProfile(restartedScope, authRequest, created.lookup)
      : await restarted.getPrivateProfile(restartedScope, authRequest, created.lookup);
    assert.equal(remainsOutage.reason, 'source_outage');
  }
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
  env.clock.value += 1_000;
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

test('cancellation after outbox selection or claim prevents dispatch and restores only the undelivered claim', async (t) => {
  for (const abortAtDispatchAuthorization of [4, 6]) {
    const controller = new AbortController();
    let dispatchAuthorizationCalls = 0;
    let deliveries = 0;
    const env = await fixture(t, {
      authorizeAction: async ({ action }) => {
        if (action === 'outbox.dispatch' && ++dispatchAuthorizationCalls === abortAtDispatchAuthorization) {
          await new Promise((resolve) => setImmediate(resolve));
          controller.abort();
        }
        return true;
      },
      deliverInvalidation: async (expected) => {
        deliveries += 1;
        return expected;
      },
      verifyInvalidationAcknowledgement: () => true,
    });
    const created = await putPrivate(env.store);
    await env.store.invalidate(created.scope, created.authRequest, {
      profileRef: created.profile.profileRef, scopeKind: 'tenant_private', reason: 'material_fact_change',
    });
    await assert.rejects(
      env.store.dispatchPendingInvalidations(created.scope, created.authRequest, 20, 'tenant_private', controller.signal),
      (error) => error.code === 'REUSE_DENIED',
    );
    assert.equal(deliveries, 0);
    const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
    try {
      const row = database.prepare('SELECT status, attempt_count, active_attempt_id FROM reuse_outbox WHERE entry_id = ?').get(created.profile.profileRef);
      assert.deepEqual({ ...row }, { status: 'pending', attempt_count: 0, active_attempt_id: null });
    } finally { database.close(); }
  }

  const controller = new AbortController();
  let keyVersion = 1;
  let deliveries = 0;
  const keyEnv = await fixture(t, {
    resolveKey: async ({ tenantId, scope, purpose, keyId }) => {
      if (purpose === 'payload' && keyId?.endsWith(':v1') && keyVersion === 2) {
        await new Promise((resolve) => setImmediate(resolve));
        controller.abort();
      }
      return {
        keyId: keyId ?? `${scope}:${purpose}:${tenantId ?? 'global'}:v${purpose === 'payload' ? keyVersion : 1}`,
        key: Buffer.alloc(32, tenantId ? tenantId.charCodeAt(0) : 91),
      };
    },
    deliverInvalidation: async (expected) => { deliveries += 1; return expected; },
    verifyInvalidationAcknowledgement: () => true,
  });
  const created = await putPrivate(keyEnv.store);
  await keyEnv.store.invalidate(created.scope, created.authRequest, {
    profileRef: created.profile.profileRef, scopeKind: 'tenant_private', reason: 'material_fact_change',
  });
  keyVersion = 2;
  await assert.rejects(
    keyEnv.store.dispatchPendingInvalidations(created.scope, created.authRequest, 20, 'tenant_private', controller.signal),
    (error) => error.code === 'REUSE_DENIED',
  );
  assert.equal(deliveries, 0);
  assert.equal((await keyEnv.store.outboxSnapshot(created.scope, created.authRequest)).pending, 1);
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

test('public profile replay preserves the first tenant lineage link across unknown and changed resolver results', async (t) => {
  let lineageResult = {
    logicalOperationId: 'ORIGINAL_LOGICAL', billableAttemptId: 'ORIGINAL_BILLABLE',
    transportAttemptId: 'ORIGINAL_TRANSPORT', providerRequestId: 'ORIGINAL_REQUEST',
    observationIds: ['ORIGINAL_OBSERVATION'], usageEventIds: ['ORIGINAL_USAGE'], status: 'complete',
  };
  let referenceLabel = 'ORIGINAL';
  const env = await fixture(t, {
    authorizePublicPublication: ({ identity, contentHash }) => ({ status: 'approved', identity, contentHash, publicPermissions: [] }),
    resolvePrivateProfileReferences: ({ contentHash }) => ({
      permissions: [{ reference: 'PRIVATE_PERMISSION_CANARY', contentHash, version: 1, use: 'finance.read_original_lineage' }],
      sourceRefs: [`${referenceLabel}_SOURCE`],
      correctionRefs: [`${referenceLabel}_CORRECTION`],
    }),
    resolveLineage: () => {
      if (lineageResult === 'throw') throw new Error('temporary lineage resolver outage');
      return lineageResult;
    },
  });
  const authRequest = request();
  const boundaryData = await approvedBoundary(authRequest);
  const created = await putPublic(env.store, authRequest, boundaryData);
  const originalLink = (() => {
    const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
    try {
      const row = database.prepare('SELECT link_id, payload_key_id, payload FROM reuse_private_links WHERE public_entry_id = ?').get(created.profile.profileRef);
      return { link_id: row.link_id, payload_key_id: row.payload_key_id, payload: Buffer.from(row.payload).toString('hex') };
    } finally { database.close(); }
  })();
  const assertOriginal = async () => {
    const handoff = await env.store.withPrivateLineage(created.scope, authRequest, created.profile.profileRef);
    assert.equal(handoff.status, 'linked');
    assert.deepEqual(env.state.consumedLineage.sourceRefs, ['ORIGINAL_SOURCE']);
    assert.deepEqual(env.state.consumedLineage.correctionRefs, ['ORIGINAL_CORRECTION']);
    assert.equal(env.state.consumedLineage.lineage.logicalOperationId, 'ORIGINAL_LOGICAL');
  };
  await assertOriginal();

  const replays = [
    { result: { status: 'unknown' }, label: 'UNKNOWN' },
    { result: 'throw', label: 'THROW' },
    { result: { malformed: true }, label: 'MALFORMED' },
    { result: {
      logicalOperationId: 'LATER_LOGICAL', billableAttemptId: 'LATER_BILLABLE',
      transportAttemptId: 'LATER_TRANSPORT', providerRequestId: 'LATER_REQUEST',
      observationIds: ['LATER_OBSERVATION'], usageEventIds: ['LATER_USAGE'], status: 'complete',
    }, label: 'LATER' },
  ];
  for (const replay of replays) {
    lineageResult = replay.result;
    referenceLabel = replay.label;
    env.clock.value += 1_000;
    await putPublic(env.store, authRequest, await approvedBoundary(authRequest));
    const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
    try {
      const row = database.prepare('SELECT link_id, payload_key_id, payload FROM reuse_private_links WHERE public_entry_id = ?').get(created.profile.profileRef);
      assert.deepEqual({ link_id: row.link_id, payload_key_id: row.payload_key_id, payload: Buffer.from(row.payload).toString('hex') }, originalLink);
    } finally { database.close(); }
    await assertOriginal();
  }

  lineageResult = { status: 'unknown' };
  referenceLabel = 'TENANT_B';
  const tenantB = request('tenant-b');
  const publicForB = await putPublic(env.store, tenantB, await approvedBoundary(tenantB));
  assert.equal(publicForB.profile.status, 'existing');
  const scopeB = await env.store.scopeForAuthenticatedRequest(tenantB);
  await env.store.withPrivateLineage(scopeB, tenantB, created.profile.profileRef);
  assert.deepEqual(env.state.consumedLineage.sourceRefs, ['TENANT_B_SOURCE']);
  assert.deepEqual(env.state.consumedLineage.correctionRefs, ['TENANT_B_CORRECTION']);
  const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
  try {
    const preserved = database.prepare('SELECT link_id, payload_key_id, payload FROM reuse_private_links WHERE link_id = ?').get(originalLink.link_id);
    assert.deepEqual({ link_id: preserved.link_id, payload_key_id: preserved.payload_key_id, payload: Buffer.from(preserved.payload).toString('hex') }, originalLink);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_private_links WHERE public_entry_id = ?').get(created.profile.profileRef).count, 2);
  } finally { database.close(); }
  await assertOriginal();
});

test('Finance lineage handoff revalidates permission version and the earliest deadline after authorization', async (t) => {
  for (const publicLink of [false, true]) {
    let permissionChecks = 0;
    let handoffs = 0;
    let env;
    const base = 1_800_000_000_000;
    env = await fixture(t, {
      resolvePrivateProfileReferences: ({ contentHash }) => ({
        permissions: [
          { reference: 'permission-long', contentHash, version: 2, use: 'finance.read_original_lineage' },
          { reference: 'permission-short', contentHash, version: 3, use: 'finance.read_original_lineage' },
        ],
        sourceRefs: ['PRIVATE_SOURCE_CANARY'],
        correctionRefs: ['PRIVATE_CORRECTION_CANARY'],
      }),
      verifyPermission: ({ reference, contentHash, version, use }) => {
        permissionChecks += 1;
        return {
          status: 'valid', reference, contentHash, version, use,
          validUntilMs: base + (reference === 'permission-short' ? 1_000 : 10_000),
        };
      },
      authorizeAction: ({ action }) => {
        if (action === 'finance.read_original_lineage' && permissionChecks >= 2) env.clock.value = base + 1_500;
        return true;
      },
      consumeOriginalLineage: () => {
        handoffs += 1;
        return { status: 'linked', logicalOperationBound: true, billedAttemptCount: 1, usageObservationCount: 1 };
      },
      ...(publicLink ? {
        authorizePublicPublication: ({ identity, contentHash }) => ({ status: 'approved', identity, contentHash, publicPermissions: [] }),
      } : {}),
    });
    const authRequest = request();
    let created;
    if (publicLink) {
      const boundary = await approvedBoundary(authRequest);
      created = await putPublic(env.store, authRequest, boundary);
    } else {
      created = await putPrivate(env.store, authRequest);
    }
    permissionChecks = 0;
    env.clock.value = base;
    await assert.rejects(env.store.withPrivateLineage(created.scope, authRequest, created.profile.profileRef),
      (error) => error.code === 'REUSE_DENIED');
    assert.equal(permissionChecks, 2);
    assert.equal(handoffs, 0);
  }

  const bareValid = await fixture(t, { verifyPermission: () => 'valid' });
  const created = await putPrivate(bareValid.store);
  const denied = await bareValid.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  assert.equal(denied.status, 'ineligible');
  assert.equal(denied.reason, 'permission_unverified');
});

test('Finance lineage handoff rechecks the exact action after the final permission verifier callback', async (t) => {
  for (const publicLink of [false, true]) {
    let permissionChecks = 0;
    let financeRevoked = false;
    let handoffs = 0;
    const env = await fixture(t, {
      ...(publicLink ? { authorizePublicPublication: ({ identity, contentHash }) => ({ status: 'approved', identity, contentHash, publicPermissions: [] }) } : {}),
      authorizeAction: ({ action }) => !(financeRevoked && action === 'finance.read_original_lineage'),
      verifyPermission: ({ reference, contentHash, version, use }) => {
        permissionChecks += 1;
        if (permissionChecks === 2) financeRevoked = true;
        return { status: 'valid', reference, contentHash, version, use, validUntilMs: 8_640_000_000_000_000 };
      },
      consumeOriginalLineage: () => {
        handoffs += 1;
        return { status: 'linked', logicalOperationBound: true, billedAttemptCount: 1, usageObservationCount: 1 };
      },
    });
    const authRequest = request();
    const created = publicLink
      ? await putPublic(env.store, authRequest, await approvedBoundary(authRequest))
      : await putPrivate(env.store, authRequest);
    permissionChecks = 0;
    await assert.rejects(env.store.withPrivateLineage(created.scope, authRequest, created.profile.profileRef),
      (error) => error.code === 'REUSE_DENIED');
    assert.equal(permissionChecks, 2);
    assert.equal(handoffs, 0);
  }
});

test('Finance handoff final freshness observes callback-time outages and TTL expiry for private and public links', async (t) => {
  for (const publicLink of [false, true]) {
    for (const change of ['outage', 'ttl']) {
      let permissionChecks = 0;
      let created;
      let env;
      let handoffs = 0;
      const base = 1_800_000_000_000;
      env = await fixture(t, {
        ...(publicLink ? { authorizePublicPublication: ({ identity, contentHash }) => ({ status: 'approved', identity, contentHash, publicPermissions: [] }) } : {}),
        verifyPermission: async ({ reference, contentHash, version, use }) => {
          permissionChecks += 1;
          if (created && permissionChecks === 2) {
            if (change === 'outage') {
              env.clock.value += 1;
              env.state.observation = () => ({ status: 'outage', validatedAt: new Date(env.clock.value).toISOString() });
              await env.store.observe(created.scope, created.authRequest, {
                profileRef: created.profile.profileRef,
                scopeKind: publicLink ? 'public_profile' : 'tenant_private',
                observation: { source: 'final-finance-permission-check' },
              });
            } else {
              env.clock.value = base + 1_000;
            }
          }
          return { status: 'valid', reference, contentHash, version, use, validUntilMs: 8_640_000_000_000_000 };
        },
        consumeOriginalLineage: () => {
          handoffs += 1;
          return { status: 'linked', logicalOperationBound: true, billedAttemptCount: 1, usageObservationCount: 1 };
        },
      });
      const authRequest = request();
      created = publicLink
        ? await putPublic(env.store, authRequest, await approvedBoundary(authRequest), { freshnessTtlMs: 1_000 })
        : await putPrivate(env.store, authRequest, { freshnessTtlMs: 1_000 });
      permissionChecks = 0;
      env.clock.value = base;
      await assert.rejects(env.store.withPrivateLineage(created.scope, authRequest, created.profile.profileRef),
        (error) => error.code === 'REUSE_DENIED');
      assert.equal(handoffs, 0);
      assert.equal(permissionChecks, 3);
    }
  }
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
  assert.equal('profileRef' in rollback, false);
  const blockedAdmission = await clockEnv.store.admitOperation(clockCreated.scope, clockCreated.authRequest, {
    identity: IDENTITY, pins: PINS, mode: 'reuse',
  });
  assert.deepEqual(blockedAdmission, { status: 'unavailable', reason: 'clock_rollback' });
  assert.equal('usage' in blockedAdmission, false);
  assert.equal('admissionRef' in blockedAdmission, false);
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

test('signal checks ignore own overrides and reject proxy inputs before profile admission', async (t) => {
  const env = await fixture(t);
  const shadowedSignal = new AbortController().signal;
  Object.defineProperty(shadowedSignal, 'aborted', { get() { throw new Error('SECRET_SIGNAL_GETTER'); } });
  const created = await putPrivate(env.store, request(), { identity: { ...IDENTITY, editionId: 'shadowed-signal' }, signal: shadowedSignal });
  assert.equal(created.profile.status, 'stored');

  const scope = await env.store.scopeForAuthenticatedRequest(request());
  const transparent = new Proxy(new AbortController().signal, {});
  const forwarding = new Proxy(new AbortController().signal, {
    get(target, key, receiver) { return Reflect.get(target, key, receiver); },
  });
  let throwingProxyRead = false;
  const throwing = new Proxy(new AbortController().signal, { get() { throwingProxyRead = true; throw new Error('SECRET_SIGNAL_PROXY'); } });
  const controller = new AbortController();
  const abortedSymbol = Object.getOwnPropertySymbols(controller.signal).find((symbol) => symbol.description === 'kAborted');
  assert.ok(abortedSymbol, 'Node 22 AbortSignal state symbol is available for the masking regression');
  controller.abort();
  const masked = new Proxy(controller.signal, {
    get(target, key, receiver) { return key === abortedSymbol ? false : Reflect.get(target, key, receiver); },
  });
  assert.equal(controller.signal.aborted, true);
  assert.equal(Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get.call(masked), false,
    'the Node 22 intrinsic getter alone accepts the state-masking proxy');

  for (const [index, signal] of [transparent, forwarding, throwing, masked].entries()) {
    await assert.rejects(env.store.putPrivateProfile(scope, request(), {
      identity: { ...IDENTITY, editionId: `proxy-signal-${index}` }, contentHash: HASH_A, pins: PINS,
      facts: facts(), observation: {}, signal,
    }), (error) => error.code === 'REUSE_INVALID' && !error.message.includes('SECRET_SIGNAL'));
  }
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(env.store.putPrivateProfile(scope, request(), {
    identity: { ...IDENTITY, editionId: 'already-aborted-signal' }, contentHash: HASH_A, pins: PINS,
    facts: facts(), observation: {}, signal: alreadyAborted.signal,
  }), (error) => error.code === 'REUSE_DENIED');
  assert.equal(throwingProxyRead, false, 'proxy properties are never inspected');
  assert.equal((await env.store.integritySnapshot(scope, request())).entryCount, 1);
  assert.equal((await env.store.integritySnapshot(scope, request())).eligibleEntryCount, 1);
});

test('public profile admission rejects forwarding and aborted-state masking proxies without writes', async (t) => {
  const env = await fixture(t, {
    authorizePublicPublication: ({ identity, contentHash }) => ({ status: 'approved', identity, contentHash, publicPermissions: [] }),
  });
  const authRequest = request();
  const scope = await env.store.scopeForAuthenticatedRequest(authRequest);
  const controller = new AbortController();
  const abortedSymbol = Object.getOwnPropertySymbols(controller.signal).find((symbol) => symbol.description === 'kAborted');
  assert.ok(abortedSymbol);
  controller.abort();
  const signals = [
    new Proxy(new AbortController().signal, { get(target, key, receiver) { return Reflect.get(target, key, receiver); } }),
    new Proxy(controller.signal, { get(target, key, receiver) { return key === abortedSymbol ? false : Reflect.get(target, key, receiver); } }),
  ];
  for (const [index, signal] of signals.entries()) {
    const boundaryData = await approvedBoundary(authRequest);
    await assert.rejects(putPublic(env.store, authRequest, boundaryData, {
      identity: { ...IDENTITY, editionId: `public-proxy-${index}` }, signal,
    }), (error) => error.code === 'REUSE_INVALID');
  }
  assert.equal((await env.store.integritySnapshot(scope, authRequest)).entryCount, 0);
  const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_entries WHERE scope_kind = \'public_profile\'').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_private_links').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_observations').get().count, 0);
  } finally { database.close(); }
});

test('dispatch rejects proxy cancellation inputs before claiming or delivering an event', async (t) => {
  const env = await fixture(t);
  const created = await putPrivate(env.store);
  await env.store.invalidate(created.scope, created.authRequest, {
    profileRef: created.profile.profileRef, scopeKind: 'tenant_private', reason: 'material_fact_change',
  });
  const controller = new AbortController();
  const abortedSymbol = Object.getOwnPropertySymbols(controller.signal).find((symbol) => symbol.description === 'kAborted');
  assert.ok(abortedSymbol);
  controller.abort();
  const signals = [
    new Proxy(new AbortController().signal, {}),
    new Proxy(controller.signal, { get(target, key, receiver) { return key === abortedSymbol ? false : Reflect.get(target, key, receiver); } }),
  ];
  for (const signal of signals) {
    await assert.rejects(
      env.store.dispatchPendingInvalidations(created.scope, created.authRequest, 20, 'tenant_private', signal),
      (error) => error.code === 'REUSE_INVALID',
    );
  }
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(
    env.store.dispatchPendingInvalidations(created.scope, created.authRequest, 20, 'tenant_private', alreadyAborted.signal),
    (error) => error.code === 'REUSE_DENIED',
  );
  assert.equal(env.state.delivered, null);
  assert.equal((await env.store.outboxSnapshot(created.scope, created.authRequest)).pending, 1);
  const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
  try {
    const row = database.prepare('SELECT status, attempt_count, active_attempt_id FROM reuse_outbox WHERE entry_id = ?').get(created.profile.profileRef);
    assert.deepEqual({ ...row }, { status: 'pending', attempt_count: 0, active_attempt_id: null });
  } finally { database.close(); }
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

test('shared index-key bytes never share flights across tenant partitions, including expired leases and restart', async (t) => {
  const env = await fixture(t);
  const worker = path.resolve('tests/cache/reuse/admission-worker.mjs');
  const run = (tenantId, now, leaseMs = 30_000) => spawn(process.execPath, [worker], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REUSE_WORKER_CONFIG: JSON.stringify({ directory: env.directory, tenantId }),
      REUSE_WORKER_SHARED_KEY: '1',
      REUSE_WORKER_NOW: String(now),
      REUSE_WORKER_LEASE_MS: String(leaseMs),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const readOutcome = (child) => new Promise((resolve, reject) => {
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline >= 0) resolve(JSON.parse(output.slice(0, newline)));
    });
    child.once('error', reject);
    child.stderr.on('data', () => {});
  });
  const baseNow = 1_800_000_000_000;
  const first = run('tenant-a', baseNow, 100);
  t.after(() => first.kill('SIGKILL'));
  const a = await readOutcome(first);
  assert.equal(a.status, 'admitted');
  first.stdin.end('done\n');

  const second = run('tenant-b', baseNow + 200);
  t.after(() => second.kill('SIGKILL'));
  const b = await readOutcome(second);
  assert.equal(b.status, 'admitted');
  assert.notEqual(b.admissionRef, a.admissionRef);
  second.stdin.end('done\n');

  const restartedB = run('tenant-b', baseNow + 201);
  t.after(() => restartedB.kill('SIGKILL'));
  const bDuplicate = await readOutcome(restartedB);
  assert.equal(bDuplicate.status, 'in_flight');
  assert.equal(bDuplicate.admissionRef, b.admissionRef);
  restartedB.stdin.end('done\n');

  const restartedA = run('tenant-a', baseNow + 201);
  t.after(() => restartedA.kill('SIGKILL'));
  const aExpired = await readOutcome(restartedA);
  assert.equal(aExpired.status, 'needs_reconciliation');
  assert.equal(aExpired.admissionRef, a.admissionRef);
  restartedA.stdin.end('done\n');
});

test('flight keys include the active key identifier so a key rotation cannot expose an old admission reference', async (t) => {
  let keyVersion = 'one';
  const env = await fixture(t, {
    resolveKey: ({ scope, purpose }) => ({ keyId: `shared-${scope}-${purpose}-${keyVersion}`, key: Buffer.alloc(32, 79) }),
  });
  const authRequest = request();
  const scope = await env.store.scopeForAuthenticatedRequest(authRequest);
  const first = await env.store.admitOperation(scope, authRequest, { identity: IDENTITY, pins: PINS, mode: 'reuse' });
  keyVersion = 'two';
  const afterRotation = await env.store.admitOperation(scope, authRequest, { identity: IDENTITY, pins: PINS, mode: 'reuse' });
  assert.equal(afterRotation.status, 'admitted');
  assert.notEqual(afterRotation.admissionRef, first.admissionRef);
});

test('scope authorization binds every request to its current tenant and actor and to the issuing store', async (t) => {
  const env = await fixture(t);
  const mutableRequest = { principal: { tenantId: 'tenant-a', actorId: 'actor-tenant-a' } };
  const created = await putPrivate(env.store, mutableRequest);
  const swapped = request('tenant-b');
  await assert.rejects(env.store.getPrivateProfile(created.scope, swapped, created.lookup), (error) => error.code === 'REUSE_DENIED');
  const foreignStore = createScopedReuseStore(env.options);
  await assert.rejects(foreignStore.getPrivateProfile(created.scope, mutableRequest, created.lookup), (error) => error.code === 'REUSE_DENIED');

  mutableRequest.principal.actorId = 'actor-revoked';
  await assert.rejects(env.store.getPrivateProfile(created.scope, mutableRequest, created.lookup), (error) => error.code === 'REUSE_DENIED');
});

test('principal changes during key resolution, permission verification, or authorization deny before facts escape', async (t) => {
  let mutableRequest;
  let mutateOn = 'key';
  const env = await fixture(t, {
    resolveKey: ({ tenantId, scope, purpose }) => {
      if (mutateOn === 'key' && mutableRequest) mutableRequest.principal.actorId = 'actor-revoked';
      return { keyId: `${scope}:${purpose}:${tenantId ?? 'global'}`, key: Buffer.alloc(32, tenantId ? tenantId.charCodeAt(0) : 91) };
    },
    authorizeAction: ({ request: authRequest }) => {
      if (mutateOn === 'authorization' && authRequest === mutableRequest) mutableRequest.principal.actorId = 'actor-revoked';
      return true;
    },
  });
  mutableRequest = { principal: { tenantId: 'tenant-a', actorId: 'actor-tenant-a' } };
  const keyScope = await env.store.scopeForAuthenticatedRequest(mutableRequest);
  await assert.rejects(env.store.putPrivateProfile(keyScope, mutableRequest, {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS, facts: facts(), observation: {},
  }), (error) => error.code === 'REUSE_DENIED');
  assert.equal((await env.store.integritySnapshot(keyScope, request())).entryCount, 0);

  mutateOn = 'none';
  mutableRequest.principal.actorId = 'actor-tenant-a';
  const created = await putPrivate(env.store, mutableRequest);
  mutateOn = 'authorization';
  await assert.rejects(env.store.getPrivateProfile(created.scope, mutableRequest, created.lookup), (error) => error.code === 'REUSE_DENIED');
  assert.equal((await env.store.integritySnapshot(created.scope, request())).eligibleEntryCount, 1);

  mutateOn = 'none';
  mutableRequest.principal.actorId = 'actor-tenant-a';
  const permissionEnv = await fixture(t, {
    verifyPermission: ({ reference, contentHash, version, use }) => {
      mutableRequest.principal.actorId = 'actor-revoked';
      return { status: 'valid', reference, contentHash, version, use, validUntilMs: 8_640_000_000_000_000 };
    },
  });
  const permissionCreated = await putPrivate(permissionEnv.store, mutableRequest);
  await assert.rejects(permissionEnv.store.getPrivateProfile(permissionCreated.scope, mutableRequest, permissionCreated.lookup), (error) => error.code === 'REUSE_DENIED');
});

test('final reads observe an outage or TTL crossing that occurs while permission verification is awaited', async (t) => {
  let created;
  let env;
  env = await fixture(t, {
    verifyPermission: async ({ reference, contentHash, version, use }) => {
      if (created && env.state.nextPermissionObservation === 'outage') {
        env.state.nextPermissionObservation = null;
        env.clock.value += 1;
        env.state.observation = () => ({ status: 'outage', validatedAt: new Date(env.clock.value).toISOString() });
        await env.store.observe(created.scope, created.authRequest, {
          profileRef: created.profile.profileRef, scopeKind: 'tenant_private', observation: { source: 'permission-callback' },
        });
      }
      if (created && env.state.advanceOnPermissionTo !== null) {
        env.clock.value = env.state.advanceOnPermissionTo;
        env.state.advanceOnPermissionTo = null;
      }
      return { status: 'valid', reference, contentHash, version, use, validUntilMs: 8_640_000_000_000_000 };
    },
  });
  created = await putPrivate(env.store, request(), { freshnessTtlMs: 1_000 });
  env.state.nextPermissionObservation = 'outage';
  const outage = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  assert.deepEqual({ status: outage.status, reason: outage.reason }, { status: 'unavailable', reason: 'source_outage' });
  assert.equal('facts' in outage, false);

  const ttlEnv = await fixture(t, { maxRetentionMs: 60_000 });
  ttlEnv.state.retentionMs = 60_000;
  const ttlCreated = await putPrivate(ttlEnv.store, request(), { freshnessTtlMs: 1_000 });
  ttlEnv.state.advanceOnPermissionTo = ttlEnv.clock.value + 1_000;
  const stale = await ttlEnv.store.getPrivateProfile(ttlCreated.scope, ttlCreated.authRequest, ttlCreated.lookup);
  assert.deepEqual({ status: stale.status, reason: stale.reason }, { status: 'stale', reason: 'ttl_expired' });
});

test('final authorization follows queued database preparation for private and public facts and Finance lineage', async (t) => {
  for (const pathKind of ['private_facts', 'public_facts', 'private_finance', 'public_finance']) {
    for (const mutation of ['acl', 'tenant', 'actor']) {
      let armed = false;
      let permissionChecks = 0;
      let scheduled = false;
      let revoked = false;
      let handoffs = 0;
      let authRequest;
      const targetAction = pathKind.endsWith('facts')
        ? (pathKind === 'private_facts' ? 'private_profile.read' : 'public_profile.read')
        : 'finance.read_original_lineage';
      const env = await fixture(t, {
        ...(pathKind.startsWith('public') ? {
          authorizePublicPublication: ({ identity, contentHash }) => ({
            status: 'approved', identity, contentHash,
            publicPermissions: [{ reference: 'PUBLIC_PERMISSION', contentHash, version: 1, use: 'fact_read' }],
          }),
        } : {}),
        verifyPermission: ({ reference, contentHash, version, use }) => {
          if (armed) permissionChecks += 1;
          return { status: 'valid', reference, contentHash, version, use, validUntilMs: 8_640_000_000_000_000 };
        },
        authorizeAction: ({ action }) => {
          if (armed && permissionChecks === 2 && action === targetAction && !scheduled) {
            scheduled = true;
            setImmediate(() => {
              revoked = true;
              if (mutation === 'tenant') authRequest.principal.tenantId = 'tenant-b';
              if (mutation === 'actor') authRequest.principal.actorId = 'actor-revoked';
            });
          }
          return !revoked;
        },
        consumeOriginalLineage: () => {
          handoffs += 1;
          return { status: 'linked', logicalOperationBound: true, billedAttemptCount: 1, usageObservationCount: 1 };
        },
      });
      authRequest = { principal: { tenantId: 'tenant-a', actorId: 'actor-tenant-a' } };
      const created = pathKind.startsWith('public')
        ? await putPublic(env.store, authRequest, await approvedBoundary(authRequest))
        : await putPrivate(env.store, authRequest);
      permissionChecks = 0;
      armed = true;
      if (pathKind === 'private_facts' || pathKind === 'public_facts') {
        const read = pathKind === 'private_facts'
          ? env.store.getPrivateProfile(created.scope, authRequest, created.lookup)
          : env.store.getPublicProfile(created.scope, authRequest, created.lookup);
        await assert.rejects(read, (error) => error.code === 'REUSE_DENIED');
      } else {
        await assert.rejects(env.store.withPrivateLineage(created.scope, authRequest, created.profile.profileRef),
          (error) => error.code === 'REUSE_DENIED');
      }
      assert.equal(scheduled, true, `${pathKind}/${mutation} must stage a revocation before finalization`);
      assert.equal(revoked, true, `${pathKind}/${mutation} mutation must run during async preparation`);
      assert.equal(handoffs, 0, `${pathKind}/${mutation} must not disclose Finance lineage`);
      assert.ok(permissionChecks >= 2);
    }
  }
});

test('final combined host decision catches same-principal ACL revocation across either asynchronous resolver tail', async (t) => {
  for (const pathKind of ['private_facts', 'public_facts', 'private_finance', 'public_finance']) {
    for (const resolverKind of ['tenant', 'actor']) {
      let armed = false;
      let permissionChecks = 0;
      let waitForResolverTail = false;
      let resolverTailObserved = false;
      let scheduledRevocation = false;
      let revoked = false;
      let handoffs = 0;
      let postThirdAuthorizations = 0;
      const currentActionCalls = [];
      let authRequest;
      const targetAction = pathKind.endsWith('facts')
        ? (pathKind === 'private_facts' ? 'private_profile.read' : 'public_profile.read')
        : 'finance.read_original_lineage';
      const waitOnTail = async (value, kind) => {
        if (armed && waitForResolverTail && resolverKind === kind) {
          waitForResolverTail = false;
          await new Promise((resolve) => setImmediate(resolve));
          resolverTailObserved = true;
        }
        return value;
      };
      const env = await fixture(t, {
        ...(pathKind.startsWith('public') ? {
          authorizePublicPublication: ({ identity, contentHash }) => ({
            status: 'approved', identity, contentHash,
            publicPermissions: [{ reference: 'PUBLIC_PERMISSION', contentHash, version: 1, use: 'fact_read' }],
          }),
        } : {}),
        resolveTenant: async (value) => waitOnTail(value?.principal?.tenantId, 'tenant'),
        resolveActor: async (value) => waitOnTail(value?.principal?.actorId, 'actor'),
        verifyPermission: ({ reference, contentHash, version, use }) => {
          if (armed) permissionChecks += 1;
          return { status: 'valid', reference, contentHash, version, use, validUntilMs: 8_640_000_000_000_000 };
        },
        authorizeAction: ({ action }) => {
          if (armed && permissionChecks === 3 && action === targetAction) {
            postThirdAuthorizations += 1;
            if (postThirdAuthorizations === 2 && !scheduledRevocation) {
              scheduledRevocation = true;
              waitForResolverTail = true;
              setImmediate(() => { revoked = true; });
            }
          }
          return !revoked;
        },
        authorizeCurrentRequest: async ({ expectedTenantId, expectedActorId, action, request: value, details }) => {
          currentActionCalls.push(action);
          const tenantId = await env.options.resolveTenant(value);
          const actorId = await env.options.resolveActor(value);
          if (tenantId !== expectedTenantId || actorId !== expectedActorId) return false;
          const allowed = await env.options.authorizeAction({ tenantId, actorId, action, request: value, details });
          const principal = value?.principal;
          return allowed === true && !revoked && action === targetAction
            && principal?.tenantId === expectedTenantId && principal?.actorId === expectedActorId;
        },
        consumeOriginalLineage: () => {
          handoffs += 1;
          return { status: 'linked', logicalOperationBound: true, billedAttemptCount: 1, usageObservationCount: 1 };
        },
      });
      authRequest = { principal: { tenantId: 'tenant-a', actorId: 'actor-tenant-a' } };
      const created = pathKind.startsWith('public')
        ? await putPublic(env.store, authRequest, await approvedBoundary(authRequest))
        : await putPrivate(env.store, authRequest);
      permissionChecks = 0;
      armed = true;
      if (pathKind === 'private_facts' || pathKind === 'public_facts') {
        const read = pathKind === 'private_facts'
          ? env.store.getPrivateProfile(created.scope, authRequest, created.lookup)
          : env.store.getPublicProfile(created.scope, authRequest, created.lookup);
        await assert.rejects(read, (error) => error.code === 'REUSE_DENIED');
      } else {
        await assert.rejects(env.store.withPrivateLineage(created.scope, authRequest, created.profile.profileRef),
          (error) => error.code === 'REUSE_DENIED');
      }
      assert.equal(scheduledRevocation, true, `${pathKind}/${resolverKind} must revoke after action approval`);
      assert.equal(resolverTailObserved, true, `${pathKind}/${resolverKind} must exercise its post-action async resolver`);
      assert.equal(revoked, true);
      assert.deepEqual(authRequest.principal, { tenantId: 'tenant-a', actorId: 'actor-tenant-a' }, 'the ACL revocation must leave the principal unchanged');
      assert.ok(currentActionCalls.includes(targetAction), 'the final joint host decision must run');
      assert.equal(handoffs, 0, `${pathKind}/${resolverKind} must not disclose Finance lineage`);
    }
  }
});

test('combined final adapter rejects tenant or actor changes during its resolver and authorizer phases', async (t) => {
  for (const pathKind of ['private_facts', 'public_facts', 'private_finance', 'public_finance']) {
    for (const mutation of ['tenant', 'actor']) {
      for (const phase of ['resolver', 'authorizer']) {
        let env;
        let armed = false;
        let combinedDecisionEntered = false;
        let mutated = false;
        let handoffs = 0;
        let authRequest;
        const targetAction = pathKind.endsWith('facts')
          ? (pathKind === 'private_facts' ? 'private_profile.read' : 'public_profile.read')
          : 'finance.read_original_lineage';
        const mutateAfterTurn = async () => {
          await new Promise((resolve) => setImmediate(resolve));
          if (mutation === 'tenant') authRequest.principal.tenantId = 'tenant-b';
          else authRequest.principal.actorId = 'actor-revoked';
          mutated = true;
        };
        const envHolder = { env: null };
        env = await fixture(t, {
          ...(pathKind.startsWith('public') ? {
            authorizePublicPublication: ({ identity, contentHash }) => ({
              status: 'approved', identity, contentHash,
              publicPermissions: [{ reference: 'PUBLIC_PERMISSION', contentHash, version: 1, use: 'fact_read' }],
            }),
          } : {}),
          resolveTenant: async (value) => {
            if (armed && combinedDecisionEntered && phase === 'resolver' && mutation === 'tenant' && !mutated) await mutateAfterTurn();
            return value?.principal?.tenantId;
          },
          resolveActor: async (value) => {
            if (armed && combinedDecisionEntered && phase === 'resolver' && mutation === 'actor' && !mutated) await mutateAfterTurn();
            return value?.principal?.actorId;
          },
          authorizeAction: async ({ action }) => {
            if (armed && combinedDecisionEntered && phase === 'authorizer' && action === targetAction && !mutated) {
              await mutateAfterTurn();
            }
            return true;
          },
          authorizeCurrentRequest: async ({ expectedTenantId, expectedActorId, action, request: value, details }) => {
            combinedDecisionEntered = true;
            const tenantId = await envHolder.env.options.resolveTenant(value);
            const actorId = await envHolder.env.options.resolveActor(value);
            if (tenantId !== expectedTenantId || actorId !== expectedActorId) return false;
            const allowed = await envHolder.env.options.authorizeAction({ tenantId, actorId, action, request: value, details });
            const principal = value?.principal;
            return allowed === true && action === targetAction
              && principal?.tenantId === expectedTenantId && principal?.actorId === expectedActorId;
          },
          consumeOriginalLineage: () => {
            handoffs += 1;
            return { status: 'linked', logicalOperationBound: true, billedAttemptCount: 1, usageObservationCount: 1 };
          },
        });
        envHolder.env = env;
        authRequest = { principal: { tenantId: 'tenant-a', actorId: 'actor-tenant-a' } };
        const created = pathKind.startsWith('public')
          ? await putPublic(env.store, authRequest, await approvedBoundary(authRequest))
          : await putPrivate(env.store, authRequest);
        armed = true;
        if (pathKind === 'private_facts' || pathKind === 'public_facts') {
          const read = pathKind === 'private_facts'
            ? env.store.getPrivateProfile(created.scope, authRequest, created.lookup)
            : env.store.getPublicProfile(created.scope, authRequest, created.lookup);
          await assert.rejects(read, (error) => error.code === 'REUSE_DENIED');
        } else {
          await assert.rejects(env.store.withPrivateLineage(created.scope, authRequest, created.profile.profileRef),
            (error) => error.code === 'REUSE_DENIED');
        }
        assert.equal(combinedDecisionEntered, true, `${pathKind}/${mutation}/${phase} reaches the combined decision`);
        assert.equal(mutated, true, `${pathKind}/${mutation}/${phase} mutates the principal during the chosen phase`);
        assert.equal(handoffs, 0, `${pathKind}/${mutation}/${phase} must not disclose Finance lineage`);
      }
    }
  }
});

test('the final host adapter is mandatory and denial, throw, or rejection never falls back to separate callbacks', async (t) => {
  const invalidConfig = await fixture(t);
  assert.throws(() => createScopedReuseStore({ ...invalidConfig.options, authorizeCurrentRequest: undefined }),
    (error) => error.code === 'REUSE_INVALID');
  assert.throws(() => createScopedReuseStore({ ...invalidConfig.options, authorizeCurrentRequest: true }),
    (error) => error.code === 'REUSE_INVALID');

  for (const failure of ['deny', 'throw', 'reject']) {
    let env;
    let mode = 'allow';
    let handoffs = 0;
    let finalCalls = 0;
    env = await fixture(t, {
      authorizePublicPublication: ({ identity, contentHash }) => ({
        status: 'approved', identity, contentHash,
        publicPermissions: [{ reference: 'PUBLIC_PERMISSION', contentHash, version: 1, use: 'fact_read' }],
      }),
      authorizeCurrentRequest: async ({ expectedTenantId, expectedActorId, action, request: authRequest, details }) => {
        finalCalls += 1;
        if (mode === 'deny') return false;
        if (mode === 'throw') throw new Error('private adapter failure');
        if (mode === 'reject') return Promise.reject(new Error('private adapter rejection'));
        const tenantId = await env.options.resolveTenant(authRequest);
        const actorId = await env.options.resolveActor(authRequest);
        if (tenantId !== expectedTenantId || actorId !== expectedActorId) return false;
        const allowed = await env.options.authorizeAction({ tenantId, actorId, action, request: authRequest, details });
        const principal = authRequest?.principal;
        return allowed === true && principal?.tenantId === expectedTenantId && principal?.actorId === expectedActorId;
      },
      consumeOriginalLineage: () => {
        handoffs += 1;
        return { status: 'linked', logicalOperationBound: true, billedAttemptCount: 1, usageObservationCount: 1 };
      },
    });
    const authRequest = request();
    const privateCreated = await putPrivate(env.store, authRequest);
    const publicCreated = await putPublic(env.store, authRequest, await approvedBoundary(authRequest));
    mode = failure;
    const before = finalCalls;
    await assert.rejects(env.store.getPrivateProfile(privateCreated.scope, authRequest, privateCreated.lookup),
      (error) => error.code === 'REUSE_DENIED');
    await assert.rejects(env.store.getPublicProfile(publicCreated.scope, authRequest, publicCreated.lookup),
      (error) => error.code === 'REUSE_DENIED');
    await assert.rejects(env.store.withPrivateLineage(privateCreated.scope, authRequest, privateCreated.profile.profileRef),
      (error) => error.code === 'REUSE_DENIED');
    await assert.rejects(env.store.withPrivateLineage(publicCreated.scope, authRequest, publicCreated.profile.profileRef),
      (error) => error.code === 'REUSE_DENIED');
    assert.equal(finalCalls - before, 4, `${failure} must be reached for all four disclosure paths`);
    assert.equal(handoffs, 0, `${failure} must not disclose private Finance lineage`);
  }
});

test('final host permission callbacks can re-enter freshness writes without locking the prepared reader', async (t) => {
  for (const pathKind of ['private_facts', 'public_facts', 'private_finance', 'public_finance']) {
    let env;
    let created;
    let permissionChecks = 0;
    let reentered = false;
    let handoffs = 0;
    env = await fixture(t, {
      ...(pathKind.startsWith('public') ? {
        authorizePublicPublication: ({ identity, contentHash }) => ({
          status: 'approved', identity, contentHash,
          publicPermissions: [{ reference: 'PUBLIC_PERMISSION', contentHash, version: 1, use: 'fact_read' }],
        }),
      } : {}),
      verifyPermission: async ({ reference, contentHash, version, use }) => {
        permissionChecks += 1;
        if (created && permissionChecks === 3) {
          env.clock.value += 1;
          env.state.observation = () => ({ status: 'outage', validatedAt: new Date(env.clock.value).toISOString() });
          await env.store.observe(created.scope, created.authRequest, {
            profileRef: created.profile.profileRef,
            scopeKind: pathKind.startsWith('private') ? 'tenant_private' : 'public_profile',
            observation: { source: 'reentrant-final-permission-callback' },
          });
          reentered = true;
        }
        return { status: 'valid', reference, contentHash, version, use, validUntilMs: 8_640_000_000_000_000 };
      },
      consumeOriginalLineage: () => {
        handoffs += 1;
        return { status: 'linked', logicalOperationBound: true, billedAttemptCount: 1, usageObservationCount: 1 };
      },
    });
    const authRequest = request();
    created = pathKind.startsWith('public')
      ? await putPublic(env.store, authRequest, await approvedBoundary(authRequest))
      : await putPrivate(env.store, authRequest);
    permissionChecks = 0;
    if (pathKind === 'private_facts' || pathKind === 'public_facts') {
      const result = pathKind === 'private_facts'
        ? await env.store.getPrivateProfile(created.scope, authRequest, created.lookup)
        : await env.store.getPublicProfile(created.scope, authRequest, created.lookup);
      assert.deepEqual({ status: result.status, reason: result.reason }, { status: 'unavailable', reason: 'observation_changed' });
      assert.equal('facts' in result, false);
    } else {
      await assert.rejects(env.store.withPrivateLineage(created.scope, authRequest, created.profile.profileRef),
        (error) => error.code === 'REUSE_DENIED');
    }
    assert.equal(reentered, true, `${pathKind} must allow the host callback's independent observation write`);
    assert.equal(handoffs, 0);
  }
});

test('the combined final authorization adapter can re-enter SQLite and changed freshness still blocks disclosure', async (t) => {
  for (const pathKind of ['private_facts', 'public_facts', 'private_finance', 'public_finance']) {
    let env;
    let created;
    let reentered = false;
    let handoffs = 0;
    env = await fixture(t, {
      ...(pathKind.startsWith('public') ? {
        authorizePublicPublication: ({ identity, contentHash }) => ({
          status: 'approved', identity, contentHash,
          publicPermissions: [{ reference: 'PUBLIC_PERMISSION', contentHash, version: 1, use: 'fact_read' }],
        }),
      } : {}),
      authorizeCurrentRequest: async ({ expectedTenantId, expectedActorId, action, request: authRequest, details }) => {
        const tenantId = await env.options.resolveTenant(authRequest);
        const actorId = await env.options.resolveActor(authRequest);
        if (tenantId !== expectedTenantId || actorId !== expectedActorId) return false;
        const allowed = await env.options.authorizeAction({ tenantId, actorId, action, request: authRequest, details });
        if (created && !reentered) {
          env.clock.value += 1;
          env.state.observation = () => ({ status: 'outage', validatedAt: new Date(env.clock.value).toISOString() });
          await env.store.observe(created.scope, created.authRequest, {
            profileRef: created.profile.profileRef,
            scopeKind: pathKind.startsWith('private') ? 'tenant_private' : 'public_profile',
            observation: { source: 'reentrant-final-authorizer-callback' },
          });
          reentered = true;
        }
        const principal = authRequest?.principal;
        return allowed === true && principal?.tenantId === expectedTenantId && principal?.actorId === expectedActorId;
      },
      consumeOriginalLineage: () => {
        handoffs += 1;
        return { status: 'linked', logicalOperationBound: true, billedAttemptCount: 1, usageObservationCount: 1 };
      },
    });
    const authRequest = request();
    created = pathKind.startsWith('public')
      ? await putPublic(env.store, authRequest, await approvedBoundary(authRequest))
      : await putPrivate(env.store, authRequest);
    if (pathKind === 'private_facts' || pathKind === 'public_facts') {
      const result = pathKind === 'private_facts'
        ? await env.store.getPrivateProfile(created.scope, authRequest, created.lookup)
        : await env.store.getPublicProfile(created.scope, authRequest, created.lookup);
      assert.deepEqual({ status: result.status, reason: result.reason }, { status: 'unavailable', reason: 'observation_changed' });
      assert.equal('facts' in result, false);
    } else {
      await assert.rejects(env.store.withPrivateLineage(created.scope, authRequest, created.profile.profileRef),
        (error) => error.code === 'REUSE_DENIED');
    }
    assert.equal(reentered, true, `${pathKind} must finish the reentrant freshness write`);
    assert.equal(handoffs, 0);
  }
});

test('storage writes conserve bytes and event-count reservations until invalidation converts them', async (t) => {
  const env = await fixture(t, { maxStoreBytes: 6_000, maxOutboxEntries: 32, maxFlights: 64 });
  const created = await putPrivate(env.store);
  let acceptedFlights = 0;
  let refused = false;
  for (let index = 0; index < 64; index += 1) {
    try {
      const admitted = await env.store.admitOperation(created.scope, created.authRequest, {
        identity: { ...IDENTITY, editionId: `fresh-${index}` }, pins: PINS, mode: 'fresh',
      });
      assert.equal(admitted.usage, 'unknown');
      acceptedFlights += 1;
    } catch (error) {
      assert.equal(error.code, 'REUSE_CAPACITY');
      refused = true;
      break;
    }
  }
  assert.ok(acceptedFlights > 0);
  assert.equal(refused, true);
  const invalidation = await env.store.invalidate(created.scope, created.authRequest, {
    profileRef: created.profile.profileRef, scopeKind: 'tenant_private', reason: 'rights_revocation',
  });
  assert.equal(invalidation.invalidated, true);
  const retry = await env.store.dispatchPendingInvalidations(created.scope, created.authRequest, 1);
  assert.equal(retry.attempted, 1);
  assert.equal(retry.delivered, 0);
  assert.equal((await env.store.outboxSnapshot(created.scope, created.authRequest)).pending, 1);
  assert.equal((await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup)).reason, 'invalidated');
});

test('multiple consumer reservations convert atomically and block overcommitted eligible entries', async (t) => {
  const env = await fixture(t, {
    maxOutboxEntries: 3,
    maxStoreBytes: 32_000,
    resolveInvalidationConsumers: () => ['CONSUMER_A', 'CONSUMER_B', 'CONSUMER_C'],
  });
  const created = await putPrivate(env.store);
  await assert.rejects(putPrivate(env.store, request(), { identity: { ...IDENTITY, editionId: 'blocked-by-reservation' } }),
    (error) => error.code === 'REUSE_CAPACITY');
  assert.equal((await env.store.integritySnapshot(created.scope, created.authRequest)).entryCount, 1);
  const changed = await env.store.invalidate(created.scope, created.authRequest, {
    profileRef: created.profile.profileRef, scopeKind: 'tenant_private', reason: 'rights_revocation',
  });
  assert.equal(changed.invalidated, true);
  const snapshot = await env.store.outboxSnapshot(created.scope, created.authRequest);
  assert.equal(snapshot.pending, 3);
  assert.equal(snapshot.unresolved, 3);
});

test('final sealed size bounds reject oversized profiles, lineage reconciliation, and unrevocable Unicode consumers atomically', async (t) => {
  const profileEnv = await fixture(t, { maxEntryBytes: 2_060 });
  const profileScope = await profileEnv.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(profileEnv.store.putPrivateProfile(profileScope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS, facts: facts(), observation: {}, freshnessTtlMs: 1_000,
  }), (error) => error.code === 'REUSE_CAPACITY');
  assert.equal((await profileEnv.store.integritySnapshot(profileScope, request())).entryCount, 0);

  const consumerEnv = await fixture(t, {
    resolveInvalidationConsumers: () => ['漢'.repeat(512)],
  });
  const consumerScope = await consumerEnv.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(consumerEnv.store.putPrivateProfile(consumerScope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS, facts: facts(), observation: {},
  }), (error) => error.code === 'REUSE_CAPACITY');
  assert.equal((await consumerEnv.store.integritySnapshot(consumerScope, request())).entryCount, 0);

  let oversizedLineage = true;
  const smallEnv = await fixture(t, {
    maxEntryBytes: 2_048,
    verifyAdmissionOutcome: ({ requestedOutcome }) => ({ outcome: requestedOutcome, attemptLineage: oversizedLineage ? lineage : { status: 'unknown' } }),
  });
  const authRequest = request();
  const scope = await smallEnv.store.scopeForAuthenticatedRequest(authRequest);
  const admission = await smallEnv.store.admitOperation(scope, authRequest, { identity: IDENTITY, pins: PINS, mode: 'fresh' });
  const largeRefs = Array(128).fill('L'.repeat(512));
  const lineage = {
    logicalOperationId: 'logical', billableAttemptId: 'billable', transportAttemptId: 'transport',
    observationIds: largeRefs, usageEventIds: largeRefs, status: 'complete',
  };
  await assert.rejects(smallEnv.store.reconcileAdmission(scope, authRequest, { admissionRef: admission.admissionRef, outcome: 'completed' }),
    (error) => error.code === 'REUSE_CAPACITY');
  const snapshot = await smallEnv.store.integritySnapshot(scope, authRequest);
  assert.equal(snapshot.flights.active, 1);
  oversizedLineage = false;
  const resolved = await smallEnv.store.reconcileAdmission(scope, authRequest, { admissionRef: admission.admissionRef, outcome: 'unknown' });
  assert.equal(resolved.status, 'unknown');
  assert.equal(resolved.usage, 'unknown');
});

test('event-envelope attempt metadata fits exactly at the reservation cap and rejects cap plus one', async (t) => {
  const keyId = 'tenant_private:payload:tenant-a';
  const envelopeBytes = (consumerRef) => {
    const attempt = {
      eventId: 'f'.repeat(36), reason: 'policy_version_change', entryRef: 'e'.repeat(36), contentHash: 'f'.repeat(64),
      version: Number.MAX_SAFE_INTEGER, consumerRef, createdAtMs: 8_640_000_000_000_000,
      deliveryAttemptId: 'd'.repeat(36), deliveryAttemptNumber: Number.MAX_SAFE_INTEGER,
    };
    const plaintextBytes = Buffer.byteLength(JSON.stringify(attempt), 'utf8');
    return Buffer.byteLength(JSON.stringify({ version: 1, keyId, iv: 'i'.repeat(16), tag: 't'.repeat(24), ciphertext: 'c'.repeat(4 * Math.ceil(plaintextBytes / 3)) }), 'utf8');
  };
  assert.equal(envelopeBytes('漢'.repeat(350)), 2_048);
  assert.equal(envelopeBytes('漢'.repeat(351)), 2_052);

  const exact = await fixture(t, { resolveInvalidationConsumers: () => ['漢'.repeat(350)] });
  const created = await putPrivate(exact.store);
  await exact.store.invalidate(created.scope, created.authRequest, {
    profileRef: created.profile.profileRef, scopeKind: 'tenant_private', reason: 'rights_revocation',
  });
  const attempt = await exact.store.dispatchPendingInvalidations(created.scope, created.authRequest, 1);
  assert.equal(attempt.attempted, 1);
  const database = new DatabaseSync(path.join(exact.directory, 'scoped-reuse.sqlite'));
  try { assert.ok(database.prepare('SELECT MAX(payload_bytes) AS bytes FROM reuse_outbox').get().bytes <= 2_048); }
  finally { database.close(); }

  const over = await fixture(t, { resolveInvalidationConsumers: () => ['漢'.repeat(351)] });
  const overScope = await over.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(over.store.putPrivateProfile(overScope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS, facts: facts(), observation: {},
  }), (error) => error.code === 'REUSE_CAPACITY');
  assert.equal((await over.store.integritySnapshot(overScope, request())).entryCount, 0);

  const escaped = await fixture(t, { resolveInvalidationConsumers: () => ['\u0001'.repeat(512)] });
  const escapedScope = await escaped.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(escaped.store.putPrivateProfile(escapedScope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS, facts: facts(), observation: {},
  }), (error) => error.code === 'REUSE_CAPACITY');
  assert.equal((await escaped.store.integritySnapshot(escapedScope, request())).entryCount, 0);

  const longKeyId = await fixture(t, {
    resolveKey: ({ scope, purpose }) => ({ keyId: 'K'.repeat(128), key: Buffer.alloc(32, 61) }),
    resolveInvalidationConsumers: () => ['漢'.repeat(350)],
  });
  const longKeyScope = await longKeyId.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(longKeyId.store.putPrivateProfile(longKeyScope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS, facts: facts(), observation: {},
  }), (error) => error.code === 'REUSE_CAPACITY');
  assert.equal((await longKeyId.store.integritySnapshot(longKeyScope, request())).entryCount, 0);
});

test('outstanding invalidation cleanup purges expired private bytes while retaining unresolved events', async (t) => {
  const env = await fixture(t);
  const created = await putPrivate(env.store);
  await env.store.invalidate(created.scope, created.authRequest, {
    profileRef: created.profile.profileRef, scopeKind: 'tenant_private', reason: 'rights_revocation',
  });
  env.clock.value += 8 * 24 * 60 * 60 * 1000;
  const result = await env.store.purgeExpired(created.scope, created.authRequest);
  assert.equal(result.purged, 1);
  assert.equal(result.retainedOutboxPending, 1);
  const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
  try {
    const entry = database.prepare('SELECT payload_bytes, length(payload) AS actual_bytes, payload_purged FROM reuse_entries WHERE entry_id = ?').get(created.profile.profileRef);
    assert.deepEqual({ ...entry }, { payload_bytes: 0, actual_bytes: 0, payload_purged: 1 });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_observations WHERE entry_id = ?').get(created.profile.profileRef).count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_consumer_refs WHERE entry_id = ?').get(created.profile.profileRef).count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_outbox WHERE entry_id = ? AND status != \'delivered\'').get(created.profile.profileRef).count, 1);
  } finally { database.close(); }
  assert.equal((await env.store.purgeExpired(created.scope, created.authRequest)).purged, 0);
});

test('a failed read of an already-invalidated expired entry still commits payload cleanup', async (t) => {
  const env = await fixture(t);
  const created = await putPrivate(env.store);
  await env.store.invalidate(created.scope, created.authRequest, {
    profileRef: created.profile.profileRef, scopeKind: 'tenant_private', reason: 'evidence_lost',
  });
  env.clock.value += 8 * 24 * 60 * 60 * 1000;
  const denied = await env.store.getPrivateProfile(created.scope, created.authRequest, created.lookup);
  assert.equal(denied.status, 'unavailable');
  const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
  try {
    const row = database.prepare('SELECT payload_bytes, payload_purged FROM reuse_entries WHERE entry_id = ?').get(created.profile.profileRef);
    assert.equal(row.payload_bytes, 0);
    assert.equal(row.payload_purged, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_observations WHERE entry_id = ?').get(created.profile.profileRef).count, 0);
  } finally { database.close(); }
});

test('retention cleanup migrates and purges legacy invalidated rows after restart', async (t) => {
  const env = await fixture(t);
  const created = await putPrivate(env.store);
  await env.store.invalidate(created.scope, created.authRequest, {
    profileRef: created.profile.profileRef, scopeKind: 'tenant_private', reason: 'rights_revocation',
  });
  const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
  try {
    database.exec('ALTER TABLE reuse_entries DROP COLUMN payload_purged; ALTER TABLE reuse_outbox DROP COLUMN has_consumer;');
  } finally { database.close(); }

  env.clock.value += 8 * 24 * 60 * 60 * 1000;
  const restarted = createScopedReuseStore(env.options);
  const scope = await restarted.scopeForAuthenticatedRequest(created.authRequest);
  const result = await restarted.purgeExpired(scope, created.authRequest);
  assert.equal(result.purged, 1);
  assert.equal(result.retainedOutboxPending, 1);
  const inspect = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
  try {
    const row = inspect.prepare('SELECT payload_bytes, payload_purged FROM reuse_entries WHERE entry_id = ?').get(created.profile.profileRef);
    assert.equal(row.payload_bytes, 0);
    assert.equal(row.payload_purged, 1);
  } finally { inspect.close(); }
});

test('authorized public retention sweep purges cold public payloads and linked private evidence', async (t) => {
  const env = await fixture(t, {
    authorizePublicPublication: ({ identity, contentHash }) => ({ status: 'approved', identity, contentHash, publicPermissions: [] }),
  });
  env.state.retentionMs = 60_000;
  const authRequest = request();
  const boundary = await approvedBoundary(authRequest);
  const created = await putPublic(env.store, authRequest, boundary, { freshnessTtlMs: 10_000 });
  env.clock.value += 61_000;
  const purged = await env.store.purgeExpired(created.scope, authRequest, 'public_profile');
  assert.equal(purged.purged, 1);
  assert.equal(purged.retainedOutboxPending, 1);
  const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
  try {
    const entry = database.prepare('SELECT payload_bytes, payload_purged FROM reuse_entries WHERE entry_id = ?').get(created.profile.profileRef);
    assert.deepEqual({ ...entry }, { payload_bytes: 0, payload_purged: 1 });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_private_links WHERE public_entry_id = ?').get(created.profile.profileRef).count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_observations WHERE entry_id = ?').get(created.profile.profileRef).count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_consumer_refs WHERE entry_id = ?').get(created.profile.profileRef).count, 0);
  } finally { database.close(); }
});

test('concurrent invalidation is an idempotent CAS with exactly one durable event', async (t) => {
  const env = await fixture(t);
  const created = await putPrivate(env.store);
  const restarted = createScopedReuseStore(env.options);
  const [first, second] = await Promise.all([
    env.store.invalidate(created.scope, created.authRequest, { profileRef: created.profile.profileRef, scopeKind: 'tenant_private', reason: 'material_fact_change' }),
    restarted.invalidate(await restarted.scopeForAuthenticatedRequest(created.authRequest), created.authRequest,
      { profileRef: created.profile.profileRef, scopeKind: 'tenant_private', reason: 'material_fact_change' }),
  ]);
  assert.deepEqual([first.invalidated, second.invalidated].sort(), [false, true]);
  const snapshot = await env.store.outboxSnapshot(created.scope, created.authRequest);
  assert.equal(snapshot.pending, 1);
  const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
  try { assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_outbox WHERE entry_id = ?').get(created.profile.profileRef).count, 1); }
  finally { database.close(); }
});

test('competing processes serialize invalidation CAS and observation ordering', async (t) => {
  const env = await fixture(t);
  const worker = path.resolve('tests/cache/reuse/race-worker.mjs');
  const runPair = async (mode, profileRef) => {
    const children = [0, 1].map(() => spawn(process.execPath, [worker], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REUSE_RACE_CONFIG: JSON.stringify({ directory: env.directory, tenantId: 'tenant-a', mode, profileRef, now: env.clock.value }),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
    for (const child of children) t.after(() => child.kill('SIGKILL'));
    const readers = children.map(lineReader);
    assert.deepEqual(await Promise.all(readers.map((read) => read())), ['ready', 'ready']);
    for (const child of children) child.stdin.write('continue\n');
    const lines = await Promise.all(readers.map((read) => read()));
    for (const child of children) child.stdin.end();
    return lines.map((line) => JSON.parse(line));
  };

  const invalidated = await putPrivate(env.store);
  const invalidationResults = await runPair('invalidate', invalidated.profile.profileRef);
  assert.deepEqual(invalidationResults.map((result) => result.outcome.invalidated).sort(), [false, true]);
  const database = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
  try { assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reuse_outbox WHERE entry_id = ?').get(invalidated.profile.profileRef).count, 1); }
  finally { database.close(); }

  const observed = await putPrivate(env.store, request(), { identity: { ...IDENTITY, editionId: 'observe-race' } });
  env.clock.value += 1_000;
  const observeResults = await runPair('observe', observed.profile.profileRef);
  assert.equal(observeResults.filter((result) => result.outcome?.status === 'not_modified').length, 1);
  assert.equal(observeResults.filter((result) => result.errorCode === 'REUSE_BUSY').length, 1);
  const verifyDatabase = new DatabaseSync(path.join(env.directory, 'scoped-reuse.sqlite'));
  try { assert.equal(verifyDatabase.prepare('SELECT COUNT(*) AS count FROM reuse_observations WHERE entry_id = ?').get(observed.profile.profileRef).count, 2); }
  finally { verifyDatabase.close(); }
});

test('outbox dispatch skips exhausted and unroutable first rows without dropping them', async (t) => {
  let healthy = false;
  const env = await fixture(t, {
    maxOutboxAttempts: 1,
    resolveInvalidationConsumers: ({ descriptor }) => descriptor.identity.editionId === 'orphan'
      ? [] : [healthy ? 'HEALTHY_CONSUMER' : 'BAD_CONSUMER'],
  });
  const orphan = await putPrivate(env.store, request(), { identity: { ...IDENTITY, editionId: 'orphan' } });
  await env.store.invalidate(orphan.scope, orphan.authRequest, { profileRef: orphan.profile.profileRef, scopeKind: 'tenant_private', reason: 'material_fact_change' });
  env.state.acknowledge = false;
  const bad = await putPrivate(env.store, request(), { identity: { ...IDENTITY, editionId: 'bad' } });
  await env.store.invalidate(bad.scope, bad.authRequest, { profileRef: bad.profile.profileRef, scopeKind: 'tenant_private', reason: 'material_fact_change' });
  const failed = await env.store.dispatchPendingInvalidations(bad.scope, bad.authRequest, 1);
  assert.equal(failed.attempted, 1);
  assert.equal((await env.store.outboxSnapshot(bad.scope, bad.authRequest)).failed, 1);

  healthy = true;
  const good = await putPrivate(env.store, request(), { identity: { ...IDENTITY, editionId: 'good' } });
  await env.store.invalidate(good.scope, good.authRequest, { profileRef: good.profile.profileRef, scopeKind: 'tenant_private', reason: 'material_fact_change' });
  env.state.acknowledge = true;
  const next = await env.store.dispatchPendingInvalidations(good.scope, good.authRequest, 2);
  assert.equal(next.delivered, 1);
  assert.equal(env.state.delivered.consumerRef, 'HEALTHY_CONSUMER');
  assert.equal((await env.store.outboxSnapshot(good.scope, good.authRequest)).failed, 1);
  assert.equal((await env.store.outboxSnapshot(good.scope, good.authRequest)).unresolved, 2);
});

test('hostile array proxies, revoked proxies, accessors, and nonprimitive hashes return fixed errors before host work', async (t) => {
  let authorizationCalls = 0;
  const env = await fixture(t, { authorizeAction: () => { authorizationCalls += 1; return true; } });
  const scope = await env.store.scopeForAuthenticatedRequest(request());
  authorizationCalls = 0;
  const hostile = new Proxy([], { ownKeys() { throw new Error('SECRET_ARRAY_KEYS'); } });
  const badFacts = { ...facts(), event_name: { status: 'sourced', value: 'Event', supportRefs: hostile } };
  await assert.rejects(env.store.putPrivateProfile(scope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS, facts: badFacts, observation: {},
  }), (error) => error.code === 'REUSE_INVALID' && !error.message.includes('SECRET_ARRAY'));
  assert.equal(authorizationCalls, 0);

  const candidateProxy = new Proxy([
    { status: 'sourced', value: 'A', supportRefs: [] },
    { status: 'inferred', value: 'B', supportRefs: [] },
  ], { getOwnPropertyDescriptor() { throw new Error('SECRET_CANDIDATE_DESCRIPTOR'); } });
  await assert.rejects(env.store.putPrivateProfile(scope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS,
    facts: { event_name: { status: 'conflicting', candidates: candidateProxy } }, observation: {},
  }), (error) => error.code === 'REUSE_INVALID' && !error.message.includes('SECRET_CANDIDATE'));
  assert.equal(authorizationCalls, 0);

  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  await assert.rejects(env.store.putPrivateProfile(scope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS,
    facts: { event_name: { status: 'sourced', value: 'Event', supportRefs: revoked.proxy } }, observation: {},
  }), (error) => error.code === 'REUSE_INVALID');
  assert.equal(authorizationCalls, 0);

  const accessor = [];
  Object.defineProperty(accessor, '0', { get() { throw new Error('SECRET_ARRAY_ACCESSOR'); }, configurable: true });
  accessor.length = 1;
  await assert.rejects(env.store.putPrivateProfile(scope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS,
    facts: { event_name: { status: 'sourced', value: 'Event', supportRefs: accessor } }, observation: {},
  }), (error) => error.code === 'REUSE_INVALID' && !error.message.includes('SECRET_ARRAY'));
  assert.equal(authorizationCalls, 0);

  await assert.rejects(env.store.putPrivateProfile(scope, request(), {
    identity: IDENTITY, contentHash: { toString() { throw new Error('SECRET_HASH_COERCION'); } }, pins: PINS,
    facts: facts(), observation: {},
  }), (error) => error.code === 'REUSE_INVALID' && !error.message.includes('SECRET_HASH'));
  assert.equal(authorizationCalls, 0);
  assert.equal((await env.store.integritySnapshot(scope, request())).entryCount, 0);

  let downstreamCallbacks = 0;
  const badPermissions = new Proxy([], { ownKeys() { throw new Error('SECRET_PERMISSION_ARRAY'); } });
  const permissionEnv = await fixture(t, {
    resolvePrivateProfileReferences: () => ({ permissions: badPermissions, sourceRefs: [], correctionRefs: [] }),
    resolveLineage: () => { downstreamCallbacks += 1; return { status: 'unknown' }; },
    resolveInvalidationConsumers: () => { downstreamCallbacks += 1; return ['CONSUMER']; },
  });
  const permissionScope = await permissionEnv.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(permissionEnv.store.putPrivateProfile(permissionScope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS, facts: facts(), observation: {},
  }), (error) => error.code === 'REUSE_INVALID' && !error.message.includes('SECRET_PERMISSION'));
  assert.equal(downstreamCallbacks, 0);
  assert.equal((await permissionEnv.store.integritySnapshot(permissionScope, request())).entryCount, 0);

  const hostHash = { toString() { throw new Error('SECRET_SOURCE_HASH_COERCION'); } };
  const observationEnv = await fixture(t, {
    verifySourceObservation: ({ expectedContentHash }) => ({
      status: 'body_changed', contentHash: hostHash,
      retrievedAt: new Date(1_799_999_999_000).toISOString(), validatedAt: new Date(1_800_000_000_000).toISOString(),
    }),
  });
  const observationScope = await observationEnv.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(observationEnv.store.putPrivateProfile(observationScope, request(), {
    identity: IDENTITY, contentHash: HASH_A, pins: PINS, facts: facts(), observation: {},
  }), (error) => error.code === 'REUSE_POLICY_UNAVAILABLE' && !error.message.includes('SECRET_SOURCE_HASH'));
  assert.equal((await observationEnv.store.integritySnapshot(observationScope, request())).entryCount, 0);
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
