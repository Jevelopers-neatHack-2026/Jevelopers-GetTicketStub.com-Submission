// R4 adapter for the sealed seven-case Astra R3 probe: the host fixture now issues and revokes the additive scoped release capability. The R3 probe remains preserved unchanged in the evidence packet.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { createEvidenceStore } from '../../src/evidence/store.mjs';
import { createDiscoveryFrontierStore } from '../../src/discovery/planner/frontier.mjs';
import { createPrivateAssetReleaseAuthority, runPrivateRetrieval } from '../../src/research/private-retrieval.mjs';
import { SafeFetcher } from '../../src/security/controlled-fetch.mjs';
import { fixtureUrl, localTestSeam, respond, startFixture } from '../security/support.mjs';

const STOP_WORKER = new URL('./frontier-stop-worker.mjs', import.meta.url);
const TENANT = 'tenant-a';
const LOCAL_FIXTURE_HOST = 'fixture.example.org';

function sourceUrl(pathname = '/') {
  return fixtureUrl(80, pathname, LOCAL_FIXTURE_HOST);
}

function frontierWithSealHook(frontier, hook) {
  const wrapped = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'createRun', 'claimNext', 'getCandidateReceiptBinding', 'admitTransportHop',
    'markTransportDispatchIntent', 'markTransportResponseReceived', 'settleTransportHopKnownZero',
    'settleTransportHopBodyComplete', 'markTransportHopUnknown', 'getTransportProgress',
    'completeCandidate', 'markUnresolved', 'stopRun', 'getSnapshot',
  ]) wrapped[name] = frontier[name].bind(frontier);
  wrapped.sealPrivateDraft = (...args) => hook(frontier.sealPrivateDraft.bind(frontier), ...args);
  return wrapped;
}

function frontierWithDelayedCreateRun(frontier, gate, onAttempt) {
  const wrapped = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'claimNext', 'getCandidateReceiptBinding', 'admitTransportHop',
    'markTransportDispatchIntent', 'markTransportResponseReceived', 'settleTransportHopKnownZero',
    'settleTransportHopBodyComplete', 'markTransportHopUnknown', 'getTransportProgress',
    'completeCandidate', 'markUnresolved', 'stopRun', 'sealPrivateDraft', 'getSnapshot',
  ]) wrapped[name] = frontier[name].bind(frontier);
  wrapped.createRun = async (...args) => {
    await gate;
    try { return await frontier.createRun(...args); }
    finally { onAttempt(); }
  };
  return wrapped;
}

function frontierWithMethodOverrides(frontier, overrides) {
  const wrapped = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'createRun', 'claimNext', 'getCandidateReceiptBinding', 'admitTransportHop',
    'markTransportDispatchIntent', 'markTransportResponseReceived', 'settleTransportHopKnownZero',
    'settleTransportHopBodyComplete', 'markTransportHopUnknown', 'getTransportProgress',
    'completeCandidate', 'markUnresolved', 'stopRun', 'sealPrivateDraft', 'getSnapshot',
  ]) wrapped[name] = Object.hasOwn(overrides, name) ? overrides[name] : frontier[name].bind(frontier);
  return wrapped;
}

async function waitUntilPerfAtOrAfter(targetPerfMs) {
  while (performance.now() < targetPerfMs) {
    const remainingMs = targetPerfMs - performance.now();
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.ceil(remainingMs))));
  }
  return performance.now();
}

function request(allowPrivate = true) {
  return { principal: { tenantId: TENANT }, allowPrivate };
}

function releaseAuthorityFor(_authenticated, context) {
  return createPrivateAssetReleaseAuthority({
    tenantId: TENANT,
    runId: context.runId,
    policy: context.policy,
    expiresAtMonotonic: context.deadlineAtMonotonic,
  });
}

function eventHtml({ name = 'Moonlight Market', date = '2027-06-20', city = 'Boston', asset = false } = {}) {
  const event = {
    '@type': 'Event', name, startDate: date,
    location: { name: 'Civic Hall', address: { addressLocality: city } },
  };
  return Buffer.from(`<!doctype html>${asset ? '<meta property="og:image" content="/poster.jpg">' : ''}`
    + `<script type="application/ld+json">${JSON.stringify(event)}</script>`);
}

function eventHtmlWithCanonicalLinks(urls) {
  const event = {
    '@type': 'Event', name: 'Bounded Link Event', startDate: '2027-06-20',
    location: { name: 'Civic Hall', address: { addressLocality: 'Boston' } },
  };
  const links = urls.map((url) => `<link rel="canonical" href="${url}">`).join('');
  return Buffer.from(`<!doctype html>${links}<script type="application/ld+json">${JSON.stringify(event)}</script>`);
}

async function runStopWorker(directory, runId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STOP_WORKER.pathname, directory, runId], {
      cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      if (exitCode !== 0) reject(new Error(`stop worker failed (${exitCode}): ${stderr.slice(0, 500)}`));
      else {
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('stop worker returned invalid result')); }
      }
    });
  });
}

async function harness(t, { evidenceOptions = {}, hostnames = [LOCAL_FIXTURE_HOST], addresses } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-private-retrieval-'));
  const frontierDirectory = path.join(root, 'frontier');
  const evidenceDirectory = path.join(root, 'evidence');
  const requests = new Set();
  const permitted = new WeakMap();
  let currentAcl = true;
  let activeReleaseController = null;
  const createRetention = (expiresAtMs = Date.now() + 120_000) => {
    const handle = Object.freeze(Object.create(null));
    permitted.set(handle, { tenantId: TENANT, expiresAtMs });
    return handle;
  };
  const evidenceConfig = {
    directory: evidenceDirectory,
    resolveTenant: (authenticated) => authenticated?.principal?.tenantId,
    resolveKey({ tenantId, purpose, keyId }) {
      const selectedKeyId = `${purpose}-test-v1`;
      if (keyId && keyId !== selectedKeyId) throw new Error('private key selection denied');
      return { keyId: selectedKeyId, key: createHash('sha256').update(`${tenantId}:${purpose}:private-retrieval-test`).digest() };
    },
    resolveRetention({ tenantId, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (kind === 'evidence') {
        const stored = permitted.get(retentionHandle);
        if (!stored || stored.tenantId !== tenantId) throw new Error('retention denied');
        return { expiresAtMs: stored.expiresAtMs, policyId: 'offline-private-test', policyVersion: '1', accessPolicy: 'tenant_private' };
      }
      return {
        expiresAtMs: sourceExpiresAtMs ?? nowMs + 60_000,
        policyId: 'offline-private-fact-test', policyVersion: '1', accessPolicy: 'tenant_private',
      };
    },
    authorizePrivateAccess({ tenantId, request: authenticated }) {
      return currentAcl && authenticated?.principal?.tenantId === tenantId && authenticated.allowPrivate === true;
    },
    authorizePrivateAccessCurrent({ tenantId, request: authenticated }) {
      return currentAcl && authenticated?.principal?.tenantId === tenantId && authenticated.allowPrivate === true;
    },
    now: () => Date.now(),
    maxSourceBytes: 2 * 1024 * 1024,
    maxPositionBytes: 64 * 1024,
    maxPositionCount: 128,
    maxStoredPayloadBytes: 512 * 1024,
    maxRetentionMs: 180_000,
    ...evidenceOptions,
  };
  const evidenceStore = createEvidenceStore(evidenceConfig);
  const frontierStores = new Set();
  const openFrontier = () => {
    const store = createDiscoveryFrontierStore({
      directory: frontierDirectory,
      resolveTenant: (authenticated) => authenticated?.principal?.tenantId,
      lockTimeoutMs: 10_000,
    });
    frontierStores.add(store);
    return store;
  };
  const frontier = openFrontier();
  const scope = await frontier.scopeForAuthenticatedRequest(request());
  const evidenceScope = await evidenceStore.scopeForAuthenticatedRequest(request());
  t.after(async () => {
    for (const store of frontierStores) store.close();
    await rm(root, { recursive: true, force: true });
  });
  const makeFetcher = (server) => new SafeFetcher(localTestSeam({
    port: 80, dialPort: server.port, hostnames, addresses,
    onDial: () => requests.add('dial'),
  }));
  const makeInput = ({ runId, server, seeds, limits, authorizeCurrent, retentionHandleFor, safeFetcher, signal,
    assetAcquisitionPolicyFor, assetAcquisitionReleaseAuthorityFor, frontier: frontierStore = frontier, store = evidenceStore }) => ({
    frontier: frontierStore,
    evidenceStore: store,
    safeFetcher: safeFetcher ?? makeFetcher(server),
    request: request(),
    runId,
    seeds,
    ...(limits ? { limits } : {}),
    ...(signal ? { signal } : {}),
    ...(assetAcquisitionPolicyFor ? {
      assetAcquisitionPolicyFor,
      assetAcquisitionReleaseAuthorityFor: assetAcquisitionReleaseAuthorityFor ?? ((_authenticated, context) => {
        activeReleaseController = releaseAuthorityFor(request(), context);
        return activeReleaseController;
      }),
    } : {}),
    retentionHandleFor: retentionHandleFor ?? (() => createRetention()),
    authorizeCurrent: authorizeCurrent ?? (() => true),
  });
  return {
    root, frontierDirectory, frontier, scope, openFrontier, evidenceStore, evidenceScope,
    evidenceConfig,
    createRetention, makeFetcher, makeInput, requests,
    currentlyAuthorized() { return currentAcl; },
    setAcl(value) { currentAcl = value; },
    releaseController() { return activeReleaseController; },
  };
}




for (const mode of ['control', 'cancel-success', 'deadline-success', 'cancel-rejection', 'deadline-rejection', 'cancel-never', 'deadline-never']) {
  test(`R4 independent bounded final preparation: ${mode}`, { timeout: 10_000 }, async (t) => {
    const paths = [];
    const page = Buffer.from('<!doctype html><meta property="og:image" content="/logo.svg"><script type="application/ld+json">{"@type":"Event","name":"Final Tail Event","startDate":"2027-06-20"}</script>');
    const svg = '<svg height="10" width="10" xmlns="http://www.w3.org/2000/svg"><rect height="3" width="2"/></svg>';
    const server = await startFixture((req, res) => {
      paths.push(req.url);
      respond(res, 200, { 'content-type': req.url === '/logo.svg' ? 'image/svg+xml' : 'text/html' },
        req.url === '/logo.svg' ? svg : page);
    });
    t.after(() => server.close());
    const h = await harness(t);
    const abort = new AbortController();
    const runId = `r4-bounded-${mode}`;
    const durationMs = 5_000;
    const finalPhaseWindowMs = 1_000;
    let originalDeadlineAtMonotonic;
    let persistedDeadlineAtMs;
    let preparationReadyAt;
    let phaseEnteredAt;
    let gateRelease;
    let enteredResolve;
    const counts = { discard: 0, finalize: 0 };
    const enteredPromise = new Promise((resolve) => { enteredResolve = resolve; });
    const gate = new Promise((resolve) => { gateRelease = resolve; });
    const enterFinalPhase = async () => {
      preparationReadyAt = performance.now();
      if (mode.startsWith('deadline')) {
        // Real HTTP, SQLite and release preparation have a bounded setup window.
        // Hold this exact callback until the original run has at most the same
        // 1000ms final-phase budget as the probe; never reset its stored deadline.
        await waitUntilPerfAtOrAfter(originalDeadlineAtMonotonic - finalPhaseWindowMs);
      }
      phaseEnteredAt = performance.now();
      enteredResolve();
    };
    const store = {
      ...h.evidenceStore,
      revalidateControlledAssetRelease: async (...args) => {
        if (mode.endsWith('-never')) {
          await enterFinalPhase();
          return new Promise(() => {});
        }
        const result = await h.evidenceStore.revalidateControlledAssetRelease(...args);
        await enterFinalPhase();
        if (mode !== 'control') await gate;
        if (mode.endsWith('-rejection')) throw new Error('late-preparation-rejection');
        return result;
      },
      discardControlledAssetRelease: (...args) => {
        counts.discard += 1;
        return h.evidenceStore.discardControlledAssetRelease(...args);
      },
      finalizeControlledAssetRelease: (...args) => {
        counts.finalize += 1;
        return h.evidenceStore.finalizeControlledAssetRelease(...args);
      },
    };
    const frontier = frontierWithMethodOverrides(h.frontier, {
      createRun: async (...args) => {
        const created = await h.frontier.createRun(...args);
        persistedDeadlineAtMs = created.deadlineAtMs;
        return created;
      },
    });
    const policy = {
      schemaVersion: 1, policyVersion: 'ei-private-svg-acquisition/1',
      policyId: 'r4-bounded-final-prep', allowedOrigins: ['http://fixture.example.org'],
    };
    let pending;
    let entryWatchdog;
    let settlementWatchdog;
    t.after(async () => {
      clearTimeout(entryWatchdog);
      clearTimeout(settlementWatchdog);
      abort.abort();
      gateRelease();
      if (pending) {
        let drainWatchdog;
        try {
          await Promise.race([
            pending.then(() => undefined, () => undefined),
            new Promise((resolve) => { drainWatchdog = setTimeout(resolve, 2_000); }),
          ]);
        } finally { clearTimeout(drainWatchdog); }
      }
    });
    const runStartedAt = performance.now();
    pending = runPrivateRetrieval(h.makeInput({
      runId, server, store, frontier, seeds: [{ url: sourceUrl('/event') }],
      limits: { durationMs }, signal: abort.signal, assetAcquisitionPolicyFor: () => policy,
      assetAcquisitionReleaseAuthorityFor: (authenticated, context) => {
        originalDeadlineAtMonotonic = context.deadlineAtMonotonic;
        return releaseAuthorityFor(authenticated, context);
      },
    }));
    const entry = await Promise.race([
      enteredPromise.then(() => ({ kind: 'entered', atPerfMs: phaseEnteredAt })),
      pending.then(
        (result) => ({ kind: 'resolved-before-entry', status: result.status, atPerfMs: performance.now() }),
        (error) => ({ kind: 'rejected-before-entry', error: String(error), atPerfMs: performance.now() }),
      ),
      new Promise((resolve) => {
        entryWatchdog = setTimeout(() => resolve({ kind: 'fixture-watchdog', atPerfMs: performance.now() }), durationMs + 500);
      }),
    ]);
    clearTimeout(entryWatchdog);
    const remainingAtEntryMs = originalDeadlineAtMonotonic - phaseEnteredAt;
    t.diagnostic(JSON.stringify({
      stage: 'entry-race', mode, entry, runStartedAt, originalDeadlineAtMonotonic,
      persistedDeadlineAtMs, preparationReadyAt, remainingAtEntryMs,
    }));
    assert.equal(entry.kind, 'entered', 'run must reach the controlled-release preparation callback before its deadline or completion');
    assert.ok(Number.isSafeInteger(persistedDeadlineAtMs), 'the real frontier persisted the original run deadline');
    assert.ok(remainingAtEntryMs > 0, 'the selected callback is entered before the original deadline');
    if (mode.startsWith('deadline')) {
      assert.ok(remainingAtEntryMs <= finalPhaseWindowMs, 'the phase gate leaves at most the original 1000ms final-preparation window');
    }
    if (mode.startsWith('cancel')) abort.abort();
    const waitMs = mode.startsWith('deadline') ? 1_500 : 250;
    const measured = await Promise.race([
      pending.then((result) => ({ settled: true, result, atPerfMs: performance.now() })),
      new Promise((resolve) => {
        settlementWatchdog = setTimeout(() => resolve({ settled: false, atPerfMs: performance.now() }), waitMs);
      }),
    ]);
    clearTimeout(settlementWatchdog);
    if (mode !== 'control' && !mode.endsWith('-never')) gateRelease();
    const eventual = await pending;
    await new Promise((resolve) => setTimeout(resolve, 25));
    t.diagnostic(JSON.stringify({
      stage: 'settlement', mode, settled: measured.settled, finalPhaseElapsedMs: measured.atPerfMs - phaseEnteredAt,
      measuredStatus: measured.result?.status, eventualStatus: eventual.status, paths, counts,
    }));
    assert.deepEqual(paths, ['/event', '/logo.svg']);
    const snapshot = await h.frontier.getSnapshot(h.scope, runId);
    assert.equal(snapshot.deadlineAtMs, persistedDeadlineAtMs, 'phase synchronization never resets the stored deadline');
    if (mode === 'control') {
      assert.equal(measured.result?.assetAcquisitions?.length, 1);
      assert.equal(counts.finalize, 1);
    } else {
      assert.equal(measured.settled, true, 'cancellation/deadline must settle the run without waiting for the async store adapter');
      assert.notEqual(measured.result?.status, 'draft');
      assert.notEqual(eventual.status, 'draft');
      assert.equal(counts.finalize, 0);
      if (mode.endsWith('-success')) assert.equal(counts.discard, 1, 'late opaque preflight check must be discarded exactly once');
      if (mode.endsWith('-rejection') || mode.endsWith('-never')) assert.equal(counts.discard, 0);
      const transport = await h.frontier.getTransportProgress(h.scope, runId);
      const reopened = h.openFrontier();
      const reopenedScope = await reopened.scopeForAuthenticatedRequest(request());
      const restarted = await runPrivateRetrieval(h.makeInput({
        runId, server, frontier: reopened, seeds: [{ url: sourceUrl('/event') }],
        limits: { durationMs }, assetAcquisitionPolicyFor: () => policy,
      }));
      if (mode.startsWith('deadline')) {
        assert.notEqual(restarted.status, 'draft', 'restarting cannot renew the original expired deadline');
      }
      // A fresh authorized invocation can reconstruct a sealed, unexpired run
      // after post-seal cancellation. It cannot use this abandoned invocation's
      // release check or dispatch either acquisition again.
      assert.equal(counts.finalize, 0, 'recovery cannot finalize the abandoned preparation');
      assert.deepEqual(paths, ['/event', '/logo.svg'], 'recovery cannot redispatch either completed acquisition');
      assert.equal((await reopened.getSnapshot(reopenedScope, runId)).deadlineAtMs, persistedDeadlineAtMs);
      assert.deepEqual(await reopened.getTransportProgress(reopenedScope, runId), transport,
        'recovery preserves the original transport accounting');
    }
  });
}
