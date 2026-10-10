import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDiscoveryFrontierStore, DiscoveryFrontierError } from '../../../src/discovery/planner/frontier.mjs';

const WORKER = new URL('./frontier-worker.mjs', import.meta.url);
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function sourceRef(url, evidenceId, contentHash = HASH_A) {
  return {
    evidenceId,
    contentHash,
    locator: { kind: 'json-pointer', pointer: '/links/0/href' },
    field: 'outbound_link',
    value: url,
  };
}

async function harness(t, { clock = { value: Date.UTC(2026, 9, 10) }, tenantId = 'tenant-a' } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ei-frontier-'));
  const stores = new Set();
  const openStore = () => {
    const store = createDiscoveryFrontierStore({
      directory,
      resolveTenant: (request) => request?.principal?.tenantId,
      now: () => clock.value,
      lockTimeoutMs: 10_000,
    });
    stores.add(store);
    return store;
  };
  t.after(async () => {
    for (const store of stores) store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const store = openStore();
  const scope = await store.scopeForAuthenticatedRequest({ principal: { tenantId } });
  return { directory, clock, openStore, store, scope, tenantId };
}

async function seedRun(store, scope, runId, seeds = ['https://events.example.com/root'], limits) {
  return store.createRun(scope, {
    runId,
    seeds: seeds.map((url) => ({ url })),
    ...(limits ? { limits } : {}),
  });
}

async function claimAndAdmit(store, scope, runId, { workerId = 'worker-1', claimKey = 'claim-1', attemptKey = 'attempt-1' } = {}) {
  const claim = await store.claimNext(scope, runId, { workerId, claimKey });
  assert.equal(claim.state, 'claimed');
  const admission = await store.admitAttempt(scope, runId, {
    leaseToken: claim.leaseToken,
    attemptKey,
    kind: 'initial',
    url: claim.candidate.canonicalUrl,
  });
  assert.equal(admission.state, 'admitted');
  return { claim, admission };
}

function codeIs(code) {
  return (error) => error instanceof DiscoveryFrontierError && error.code === code;
}

function runWorker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER.pathname, ...args], {
      cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      if (exitCode !== 0) reject(new Error(`worker failed with ${exitCode}: ${stderr.slice(0, 500)}`));
      else {
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('worker returned invalid result')); }
      }
    });
  });
}

test('canonical seed permutations, cycle suppression, duplicate provenance, depth bounds, and stable URL ties', async (t) => {
  const { store, scope } = await harness(t);
  const first = await seedRun(store, scope, 'permutation-a', [
    'https://events.example.com/seed-b', 'https://events.example.com/seed-A',
  ]);
  const second = await seedRun(store, scope, 'permutation-b', [
    'https://events.example.com/seed-A', 'https://events.example.com/seed-b',
  ]);
  const expectedOrder = [
    'https://events.example.com/seed-A',
    'https://events.example.com/seed-b',
  ];
  assert.deepEqual(first.candidates.map(({ canonicalUrl }) => canonicalUrl), expectedOrder);
  assert.deepEqual(second.candidates.map(({ canonicalUrl }) => canonicalUrl), expectedOrder);

  const runId = 'cycle-depth';
  await seedRun(store, scope, runId);
  const root = await claimAndAdmit(store, scope, runId);
  const duplicateTarget = 'https://events.example.com/A';
  let snapshot = await store.completeCandidate(scope, runId, {
    leaseToken: root.claim.leaseToken,
    completionKey: 'root-completion',
    outcome: 'links_observed',
    suggestions: [
      { url: duplicateTarget, label: 'official event', sourceRefs: [sourceRef(duplicateTarget, 'evidence-a')] },
      { url: duplicateTarget, label: 'plausible brand', sourceRefs: [sourceRef(duplicateTarget, 'evidence-b')] },
      { url: 'https://events.example.com/root', sourceRefs: [sourceRef('https://events.example.com/root', 'root-ref', 'c'.repeat(64))] },
      { url: 'https://events.example.com/a', sourceRefs: [sourceRef('https://events.example.com/a', 'evidence-c', HASH_B)] },
    ],
  });
  assert.ok(snapshot.observations.some((item) => item.disposition === 'cycle'));
  assert.equal(snapshot.duplicateContentGroups.length, 1);
  assert.deepEqual(snapshot.duplicateContentGroups[0].evidenceIds, ['evidence-a', 'evidence-b']);
  assert.equal(snapshot.duplicateContentGroups[0].independence, 'unknown');
  assert.equal(snapshot.observations.find((item) => item.untrustedLabel === 'official event').sourceAuthority, 'not_evaluated');
  const uppercaseCandidate = snapshot.candidates.find(({ canonicalUrl }) => canonicalUrl === duplicateTarget);
  assert.equal(uppercaseCandidate.sourceRefs.length, 2);

  let task = await claimAndAdmit(store, scope, runId, { claimKey: 'claim-uppercase', attemptKey: 'attempt-uppercase' });
  assert.equal(task.claim.candidate.canonicalUrl, 'https://events.example.com/A');
  snapshot = await store.completeCandidate(scope, runId, {
    leaseToken: task.claim.leaseToken,
    completionKey: 'uppercase-completion',
    outcome: 'links_observed',
    suggestions: [{ url: 'https://events.example.com/grandchild', sourceRefs: [sourceRef('https://events.example.com/grandchild', 'grandchild-ref')] }],
  });
  task = await claimAndAdmit(store, scope, runId, { claimKey: 'claim-lowercase', attemptKey: 'attempt-lowercase' });
  assert.equal(task.claim.candidate.canonicalUrl, 'https://events.example.com/a');
  await store.completeCandidate(scope, runId, {
    leaseToken: task.claim.leaseToken,
    completionKey: 'lowercase-completion',
    outcome: 'no_links',
    suggestions: [],
  });
  task = await claimAndAdmit(store, scope, runId, { claimKey: 'claim-grandchild', attemptKey: 'attempt-grandchild' });
  assert.equal(task.claim.candidate.canonicalUrl, 'https://events.example.com/grandchild');
  snapshot = await store.completeCandidate(scope, runId, {
    leaseToken: task.claim.leaseToken,
    completionKey: 'grandchild-completion',
    outcome: 'links_observed',
    suggestions: [{ url: 'https://events.example.com/depth-three', sourceRefs: [sourceRef('https://events.example.com/depth-three', 'depth-three-ref')] }],
  });
  const depthLimited = snapshot.candidates.find(({ canonicalUrl }) => canonicalUrl.endsWith('/depth-three'));
  assert.equal(depthLimited.state, 'depth_limited');
  assert.ok(snapshot.observations.some((item) => item.canonicalUrl.endsWith('/depth-three') && item.disposition === 'depth_limit'));
  assert.equal(snapshot.readiness, 'blocked_no_transport_adapter');
});

test('attempt admission counts initial, retries, and redirects exactly once and stops at the durable cap', async (t) => {
  const { store, scope } = await harness(t);
  const runId = 'attempt-caps';
  await seedRun(store, scope, runId, undefined, { maxTransportAttemptAdmissions: 3 });
  const claim = await store.claimNext(scope, runId, { workerId: 'worker-a', claimKey: 'claim-a' });
  const initial = await store.admitAttempt(scope, runId, {
    leaseToken: claim.leaseToken, attemptKey: 'admit-1', kind: 'initial', url: claim.candidate.canonicalUrl,
  });
  assert.equal(initial.sequence, 1);
  assert.equal((await store.admitAttempt(scope, runId, {
    leaseToken: claim.leaseToken, attemptKey: 'admit-1', kind: 'initial', url: claim.candidate.canonicalUrl,
  })).state, 'already_admitted');
  const retry = await store.admitAttempt(scope, runId, {
    leaseToken: claim.leaseToken, attemptKey: 'admit-2', kind: 'retry', previousAttemptKey: 'admit-1',
    url: claim.candidate.canonicalUrl,
  });
  assert.equal(retry.sequence, 2);
  const redirectUrl = 'https://events.example.com/redirected';
  const redirect = await store.admitAttempt(scope, runId, {
    leaseToken: claim.leaseToken, attemptKey: 'admit-3', kind: 'redirect', previousAttemptKey: 'admit-2', url: redirectUrl,
  });
  assert.equal(redirect.sequence, 3);
  assert.equal(redirect.stopAfterThisAdmission, true);
  assert.equal((await store.admitAttempt(scope, runId, {
    leaseToken: claim.leaseToken, attemptKey: 'admit-4', kind: 'redirect', previousAttemptKey: 'admit-3',
    url: 'https://events.example.com/fourth',
  })).state, 'denied');
  const snapshot = await store.getSnapshot(scope, runId);
  assert.equal(snapshot.counters.transportAttemptAdmissions, 3);
  assert.deepEqual(snapshot.attempts.map(({ kind }) => kind), ['initial', 'retry', 'redirect']);
  assert.equal(snapshot.stopReason, 'attempt_limit');
  assert.equal((await store.claimNext(scope, runId, { workerId: 'worker-b', claimKey: 'claim-b' })).state, 'stopped');
  assert.equal(snapshot.usageStatus, 'unknown');
  assert.equal(snapshot.budgetAuthority, 'not_evaluated');
});

test('deadline, absolute counters, and claim keys survive close/reopen without lease redelivery', async (t) => {
  const harnessState = await harness(t, { clock: { value: 20_000 } });
  let { store, scope, clock, openStore } = harnessState;
  const runId = 'resume-same-config';
  const input = { runId, seeds: [{ url: 'https://events.example.com/resume' }], limits: { durationMs: 1_000 } };
  const created = await store.createRun(scope, input);
  const claim = await store.claimNext(scope, runId, { workerId: 'worker-resume', claimKey: 'stable-claim-key' });
  await store.admitAttempt(scope, runId, {
    leaseToken: claim.leaseToken, attemptKey: 'resume-attempt', kind: 'initial', url: claim.candidate.canonicalUrl,
  });
  store.close();
  clock.value = 19_000;
  store = openStore();
  scope = await store.scopeForAuthenticatedRequest({ principal: { tenantId: 'tenant-a' } });
  const reopened = await store.createRun(scope, input);
  assert.equal(reopened.deadlineAtMs, created.deadlineAtMs);
  assert.equal(reopened.counters.transportAttemptAdmissions, 1);
  assert.equal(reopened.counters.inFlightLeases, 1);
  assert.equal(reopened.lastObservedClockMs, 20_000);
  const replay = await store.claimNext(scope, runId, { workerId: 'worker-resume', claimKey: 'stable-claim-key' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.leaseToken, claim.leaseToken);
  assert.equal(replay.candidate.admittedAttemptCount, 1);
  clock.value = created.deadlineAtMs;
  const expired = await store.getSnapshot(scope, runId);
  assert.equal(expired.state, 'halted');
  assert.equal(expired.stopReason, 'deadline');
  assert.equal(expired.counters.transportAttemptAdmissions, 1);
  assert.equal(expired.counters.inFlightLeases, 1);
});

test('unresolved work is durable review state and stale tokens cannot complete or requeue it', async (t) => {
  const { store, scope, openStore } = await harness(t);
  const runId = 'worker-lost';
  await seedRun(store, scope, runId);
  const claim = await claimAndAdmit(store, scope, runId, { claimKey: 'lost-claim', attemptKey: 'lost-attempt' });
  store.close();
  const reopened = openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest({ principal: { tenantId: 'tenant-a' } });
  const unresolved = await reopened.markUnresolved(reopenedScope, runId, {
    leaseToken: claim.claim.leaseToken, reason: 'dispatch_state_unknown',
  });
  assert.equal(unresolved.candidates[0].state, 'unresolved');
  assert.equal(unresolved.state, 'halted');
  assert.equal(unresolved.stopReason, 'unresolved_work');
  assert.equal((await reopened.claimNext(reopenedScope, runId, { workerId: 'worker-new', claimKey: 'new-claim' })).state, 'stopped');
  await assert.rejects(reopened.completeCandidate(reopenedScope, runId, {
    leaseToken: claim.claim.leaseToken, completionKey: 'late-completion', outcome: 'no_links', suggestions: [],
  }), codeIs('FRONTIER_STALE_LEASE'));
  const replayedClaim = await reopened.claimNext(reopenedScope, runId, { workerId: 'worker-1', claimKey: 'lost-claim' });
  assert.equal(replayedClaim.state, 'unresolved');
  assert.equal(replayedClaim.leaseToken, claim.claim.leaseToken);
  assert.equal((await reopened.markUnresolved(reopenedScope, runId, {
    leaseToken: claim.claim.leaseToken, reason: 'dispatch_state_unknown',
  })).candidates[0].state, 'unresolved');
});

test('separate SQLite connections serialize concurrent claims at the configured four-lease cap', async (t) => {
  const { directory, store, scope, clock } = await harness(t);
  const runId = 'process-contention';
  const seeds = Array.from({ length: 10 }, (_, index) => `https://events.example.com/seed-${index}`);
  const snapshot = await seedRun(store, scope, runId, seeds);
  assert.equal(snapshot.candidates.length, 10);
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => runWorker([
    directory, runId, `process-${index}`, `claim-${index}`, String(clock.value),
  ])));
  const claimed = results.filter(({ state }) => state === 'claimed');
  const waiting = results.filter(({ state, reason }) => state === 'waiting' && reason === 'in_flight_limit');
  assert.equal(claimed.length, 4);
  assert.equal(waiting.length, 4);
  assert.equal(new Set(claimed.map(({ candidate }) => candidate.candidateId)).size, 4);
  assert.equal((await store.getSnapshot(scope, runId)).counters.inFlightLeases, 4);
});

test('cancel and budget denial halt admissions while preserving queued candidates and private refs', async (t) => {
  const { store, scope } = await harness(t);
  const runId = 'budget-cancel';
  await seedRun(store, scope, runId, [
    'https://events.example.com/a', 'https://events.example.com/b',
  ]);
  const claim = await store.claimNext(scope, runId, { workerId: 'worker-a', claimKey: 'cancel-claim' });
  const stopped = await store.stopRun(scope, runId, 'budget_denied');
  assert.equal(stopped.state, 'halted');
  assert.equal(stopped.stopReason, 'budget_denied');
  assert.equal(stopped.candidates.filter(({ state }) => state === 'queued').length, 1);
  assert.equal((await store.admitAttempt(scope, runId, {
    leaseToken: claim.leaseToken, attemptKey: 'after-denial', kind: 'initial', url: claim.candidate.canonicalUrl,
  })).state, 'denied');
  assert.equal((await store.getSnapshot(scope, runId)).counters.transportAttemptAdmissions, 0);

  const cancelRunId = 'cancelled-run';
  await seedRun(store, scope, cancelRunId, [
    'https://events.example.com/cancel-a', 'https://events.example.com/cancel-b',
  ]);
  const cancelClaim = await store.claimNext(scope, cancelRunId, { workerId: 'worker-c', claimKey: 'cancel-claim' });
  const cancelled = await store.stopRun(scope, cancelRunId, 'cancelled');
  assert.equal(cancelled.state, 'halted');
  assert.equal(cancelled.stopReason, 'cancelled');
  assert.equal(cancelled.counters.inFlightLeases, 1);
  assert.equal((await store.admitAttempt(scope, cancelRunId, {
    leaseToken: cancelClaim.leaseToken,
    attemptKey: 'cancelled-attempt',
    kind: 'initial',
    url: cancelClaim.candidate.canonicalUrl,
  })).state, 'denied');
});

test('reported fanout truncation leaves an explicit stop reason and keeps the bounded candidate pool', async (t) => {
  const { store, scope } = await harness(t);
  const runId = 'fanout-truncated';
  await seedRun(store, scope, runId, undefined, { maxSuggestionsPerCompletion: 2 });
  const claim = await claimAndAdmit(store, scope, runId);
  const urlA = 'https://events.example.com/kept-a';
  const urlB = 'https://events.example.com/kept-b';
  const snapshot = await store.completeCandidate(scope, runId, {
    leaseToken: claim.claim.leaseToken,
    completionKey: 'truncated-completion',
    outcome: 'links_observed',
    suggestions: [
      { url: urlA, sourceRefs: [sourceRef(urlA, 'kept-a')] },
      { url: urlB, sourceRefs: [sourceRef(urlB, 'kept-b')] },
    ],
    truncatedCount: 98,
  });
  assert.equal(snapshot.state, 'active');
  assert.equal(snapshot.candidates.length, 3);
  assert.ok(snapshot.stopReasons.some(({ reason }) => reason === 'fanout_limit'));
  assert.equal(snapshot.counters.uniqueCandidates, 3);
});

test('authenticated tenant scopes isolate runs and snapshots are immutable; malformed input never calls getters', async (t) => {
  const { store, scope, tenantId } = await harness(t);
  const snapshot = await seedRun(store, scope, 'private-snapshot');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.candidates), true);
  assert.equal(Object.isFrozen(snapshot.candidates[0].sourceRefs), true);
  assert.throws(() => { snapshot.candidates[0].canonicalUrl = 'https://attacker.example.com'; }, TypeError);

  let getterCalls = 0;
  const getterSeed = {};
  Object.defineProperty(getterSeed, 'url', { enumerable: true, get() { getterCalls += 1; return 'https://events.example.com/unsafe'; } });
  await assert.rejects(store.createRun(scope, { runId: 'getter-input', seeds: [getterSeed] }), codeIs('FRONTIER_INVALID_INPUT'));
  assert.equal(getterCalls, 0);
  const hostile = new Proxy({}, { ownKeys() { throw new Error('private input trap'); } });
  await assert.rejects(store.createRun(scope, hostile), codeIs('FRONTIER_INVALID_INPUT'));

  const otherScope = await store.scopeForAuthenticatedRequest({ principal: { tenantId: `${tenantId}-other` } });
  await assert.rejects(store.getSnapshot(otherScope, 'private-snapshot'), codeIs('FRONTIER_NOT_FOUND'));
  const secondStore = createDiscoveryFrontierStore({
    directory: path.join(os.tmpdir(), 'separate-unused-frontier-root'),
    resolveTenant: () => 'different-tenant',
  });
  t.after(() => secondStore.close());
  await assert.rejects(secondStore.getSnapshot(scope, 'private-snapshot'), codeIs('FRONTIER_DENIED'));
  await assert.rejects(store.createRun(scope, {
    runId: 'private-address', seeds: [{ url: 'https://127.0.0.1/private' }],
  }), codeIs('FRONTIER_INVALID_INPUT'));
  await assert.rejects(store.createRun(scope, {
    runId: 'userinfo', seeds: [{ url: 'https://user:pass@events.example.com/private' }],
  }), codeIs('FRONTIER_INVALID_INPUT'));
});

test('seed and completion content hashes reject coercion without invoking hooks or changing state', async (t) => {
  const { store, scope } = await harness(t);
  const url = 'https://events.example.com/hash-source';
  const sourceBase = sourceRef(url, 'hash-source');
  let hookCalls = 0;
  const forgedHash = {
    toString() { hookCalls += 1; return HASH_A; },
    toJSON() { hookCalls += 1; return 'forged-non-hash'; },
  };
  const hostilePrimitive = {};
  Object.defineProperty(hostilePrimitive, Symbol.toPrimitive, {
    get() {
      hookCalls += 1;
      throw new Error('PRIVATE_REFERENCE_SENTINEL');
    },
  });
  const hostileSerialization = {
    toString() { hookCalls += 1; return HASH_A; },
  };
  Object.defineProperty(hostileSerialization, 'toJSON', {
    get() {
      hookCalls += 1;
      throw new Error('PRIVATE_REFERENCE_SENTINEL');
    },
  });
  const hostileStringifier = {};
  Object.defineProperty(hostileStringifier, 'toString', {
    get() {
      hookCalls += 1;
      throw new Error('PRIVATE_REFERENCE_SENTINEL');
    },
  });
  const invalidHashes = [
    [HASH_A],
    new String(HASH_A),
    forgedHash,
    Symbol('private'),
    17n,
    hostilePrimitive,
    hostileSerialization,
    hostileStringifier,
  ];
  const sanitizedInputError = (error) => error instanceof DiscoveryFrontierError
    && error.code === 'FRONTIER_INVALID_INPUT'
    && error.message === 'invalid frontier input'
    && error.cause === undefined
    && !String(error).includes('PRIVATE_REFERENCE_SENTINEL');

  for (const [index, contentHash] of invalidHashes.entries()) {
    const runId = `invalid-content-hash-seed-${index}`;
    await assert.rejects(store.createRun(scope, {
      runId,
      seeds: [{ url, sourceRefs: [{ ...sourceBase, contentHash }] }],
    }), sanitizedInputError);
    await assert.rejects(store.getSnapshot(scope, runId), codeIs('FRONTIER_NOT_FOUND'));
  }

  const runId = 'invalid-content-hash-completion';
  await seedRun(store, scope, runId);
  const claim = await store.claimNext(scope, runId, { workerId: 'hash-worker', claimKey: 'hash-claim' });
  await store.admitAttempt(scope, runId, {
    leaseToken: claim.leaseToken,
    attemptKey: 'hash-attempt',
    kind: 'initial',
    url: claim.candidate.canonicalUrl,
  });
  const before = await store.getSnapshot(scope, runId);
  for (const [index, contentHash] of invalidHashes.entries()) {
    const suggestionUrl = `https://events.example.com/hash-link-${index}`;
    await assert.rejects(store.completeCandidate(scope, runId, {
      leaseToken: claim.leaseToken,
      completionKey: `invalid-hash-completion-${index}`,
      outcome: 'links_observed',
      suggestions: [{
        url: suggestionUrl,
        sourceRefs: [{ ...sourceRef(suggestionUrl, `invalid-hash-ref-${index}`), contentHash }],
      }],
    }), sanitizedInputError);
    assert.deepEqual(await store.getSnapshot(scope, runId), before);
  }
  assert.equal(hookCalls, 0);

  const validCompletionUrl = 'https://events.example.com/valid-hash-link';
  const completed = await store.completeCandidate(scope, runId, {
    leaseToken: claim.leaseToken,
    completionKey: 'valid-hash-completion',
    outcome: 'links_observed',
    suggestions: [{
      url: validCompletionUrl,
      sourceRefs: [sourceRef(validCompletionUrl, 'valid-hash-completion-ref', HASH_B)],
    }],
  });
  assert.equal(completed.observations.find(({ suppliedUrl }) => suppliedUrl === validCompletionUrl)
    .sourceRefs[0].contentHash, HASH_B);

  const accepted = await store.createRun(scope, {
    runId: 'valid-content-hash',
    seeds: [{ url, sourceRefs: [sourceBase] }],
  });
  assert.equal(accepted.observations[0].sourceRefs[0].contentHash, HASH_A);
});

test('input, fanout, and URL bounds fail without storing partial observations or leaking values in errors', async (t) => {
  const { store, scope } = await harness(t);
  await assert.rejects(store.createRun(scope, {
    runId: 'too-many-seeds', seeds: Array.from({ length: 11 }, (_, index) => ({ url: `https://events.example.com/${index}` })),
  }), codeIs('FRONTIER_INVALID_INPUT'));
  await assert.rejects(store.createRun(scope, {
    runId: 'oversize-url', seeds: [{ url: `https://events.example.com/${'x'.repeat(8_200)}` }],
  }), (error) => error instanceof DiscoveryFrontierError && !error.message.includes('events.example.com'));

  const runId = 'bounded-fanout';
  await seedRun(store, scope, runId);
  const claim = await claimAndAdmit(store, scope, runId);
  const suggestions = Array.from({ length: 17 }, (_, index) => {
    const url = `https://events.example.com/link-${index}`;
    return { url, sourceRefs: [sourceRef(url, `link-${index}`)] };
  });
  await assert.rejects(store.completeCandidate(scope, runId, {
    leaseToken: claim.claim.leaseToken, completionKey: 'too-many-links', outcome: 'links_observed', suggestions,
  }), codeIs('FRONTIER_INVALID_INPUT'));
  const unchanged = await store.getSnapshot(scope, runId);
  assert.equal(unchanged.candidates.length, 1);
  assert.equal(unchanged.candidates[0].state, 'leased');
});

test('unknown error codes use fixed diagnostics without coercing caller values', () => {
  let hookCalls = 0;
  const hostileCode = {};
  Object.defineProperty(hostileCode, Symbol.toPrimitive, {
    get() {
      hookCalls += 1;
      throw new Error('PRIVATE_REFERENCE_SENTINEL');
    },
  });
  const error = new DiscoveryFrontierError(hostileCode);
  assert.equal(error.code, 'FRONTIER_STORAGE');
  assert.equal(error.message, 'frontier storage operation failed');
  assert.equal(String(error).includes('PRIVATE_REFERENCE_SENTINEL'), false);
  assert.equal(hookCalls, 0);
});

test('no transport or provider is called by the frontier core and source authority stays unknown', async (t) => {
  const { store, scope } = await harness(t);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => { fetchCalls += 1; throw new Error('network must stay outside this core'); };
  try {
    const runId = 'no-dispatch';
    await seedRun(store, scope, runId);
    const claim = await claimAndAdmit(store, scope, runId);
    const url = 'https://organizer.example.com/official';
    const snapshot = await store.completeCandidate(scope, runId, {
      leaseToken: claim.claim.leaseToken,
      completionKey: 'untrusted-link',
      outcome: 'links_observed',
      suggestions: [{ url, label: 'official', sourceRefs: [sourceRef(url, 'unknown-source', HASH_B)] }],
    });
    assert.equal(fetchCalls, 0);
    assert.equal(snapshot.sourceAuthority, 'not_evaluated');
    assert.equal(snapshot.candidates.find((candidate) => candidate.canonicalUrl === url).sourceAuthority, 'not_evaluated');
    assert.equal(snapshot.transportDispatch, 'not_implemented');
    assert.equal(snapshot.readiness, 'blocked_no_transport_adapter');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
