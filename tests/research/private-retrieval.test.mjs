import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { createEvidenceStore } from '../../src/evidence/store.mjs';
import { createDiscoveryFrontierStore } from '../../src/discovery/planner/frontier.mjs';
import { runPrivateRetrieval } from '../../src/research/private-retrieval.mjs';
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
    'scopeForAuthenticatedRequest', 'createRun', 'claimNext', 'admitTransportHop',
    'markTransportDispatchIntent', 'markTransportResponseReceived', 'settleTransportHopKnownZero',
    'settleTransportHopBodyComplete', 'markTransportHopUnknown', 'getTransportProgress',
    'completeCandidate', 'markUnresolved', 'stopRun', 'getSnapshot',
  ]) wrapped[name] = frontier[name].bind(frontier);
  wrapped.sealPrivateDraft = (...args) => hook(frontier.sealPrivateDraft.bind(frontier), ...args);
  return wrapped;
}

function frontierWithDelayedCreateRun(frontier, gate, onCreate) {
  const wrapped = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'claimNext', 'admitTransportHop',
    'markTransportDispatchIntent', 'markTransportResponseReceived', 'settleTransportHopKnownZero',
    'settleTransportHopBodyComplete', 'markTransportHopUnknown', 'getTransportProgress',
    'completeCandidate', 'markUnresolved', 'stopRun', 'sealPrivateDraft', 'getSnapshot',
  ]) wrapped[name] = frontier[name].bind(frontier);
  wrapped.createRun = async (...args) => {
    await gate;
    const created = await frontier.createRun(...args);
    onCreate();
    return created;
  };
  return wrapped;
}

function request(allowPrivate = true) {
  return { principal: { tenantId: TENANT }, allowPrivate };
}

function eventHtml({ name = 'Moonlight Market', date = '2027-06-20', city = 'Boston', asset = false } = {}) {
  const event = {
    '@type': 'Event', name, startDate: date,
    location: { name: 'Civic Hall', address: { addressLocality: city } },
  };
  return Buffer.from(`<!doctype html>${asset ? '<meta property="og:image" content="/poster.jpg">' : ''}`
    + `<script type="application/ld+json">${JSON.stringify(event)}</script>`);
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
  const makeInput = ({ runId, server, seeds, limits, authorizeCurrent, retentionHandleFor, safeFetcher,
    frontier: frontierStore = frontier, store = evidenceStore }) => ({
    frontier: frontierStore,
    evidenceStore: store,
    safeFetcher: safeFetcher ?? makeFetcher(server),
    request: request(),
    runId,
    seeds,
    ...(limits ? { limits } : {}),
    retentionHandleFor: retentionHandleFor ?? (() => createRetention()),
    authorizeCurrent: authorizeCurrent ?? (() => true),
  });
  return {
    root, frontierDirectory, frontier, scope, openFrontier, evidenceStore, evidenceScope,
    evidenceConfig,
    createRetention, makeFetcher, makeInput, requests,
    currentlyAuthorized() { return currentAcl; },
    setAcl(value) { currentAcl = value; },
  };
}

test('sensitive seed query and fragment material is rejected before frontier persistence', async (t) => {
  const server = await startFixture((_request, response) => {
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-sensitive-seed';
  const sensitiveUrl = 'http://fixture.example.org/?%61ccess_%74oken=canary#%2574oken=canary';
  await assert.rejects(runPrivateRetrieval(h.makeInput({
    runId, server, seeds: [{ url: sensitiveUrl }],
  })), (error) => error?.code === 'INVALID_INPUT' && !error.message.includes('canary'));
  await assert.rejects(h.frontier.getSnapshot(h.scope, runId), (error) => error?.code === 'FRONTIER_NOT_FOUND');
});

test('one-hop limit admits and completes its last real request, then releases AES-backed facts with exact source provenance', async (t) => {
  let requestCount = 0;
  const server = await startFixture((requestValue, response) => {
    requestCount += 1;
    assert.equal(requestValue.headers.authorization, undefined);
    assert.equal(requestValue.headers.cookie, undefined);
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml({ asset: true }));
  });
  t.after(() => server.close());
  const h = await harness(t);
  const suppliedUrl = sourceUrl('/event/../event?source=offline');
  const canonicalUrl = new URL(suppliedUrl).href;
  const fetchedBuffers = [];
  const observedStore = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'appendFact', 'ingestDerivedPdfEvidence', 'lookupEvidence', 'lookupFact', 'materializeSelected',
  ]) observedStore[name] = h.evidenceStore[name].bind(h.evidenceStore);
  observedStore.ingestEvidence = async (...args) => {
    fetchedBuffers.push(args[1].content);
    return h.evidenceStore.ingestEvidence(...args);
  };
  observedStore.ingestAssetSourceEvidence = async (...args) => {
    fetchedBuffers.push(args[1].document.bytes);
    return h.evidenceStore.ingestAssetSourceEvidence(...args);
  };
  const result = await runPrivateRetrieval(h.makeInput({
    runId: 'private-max-one', server, seeds: [{ url: suppliedUrl }],
    store: observedStore,
    limits: { maxTransportAttemptAdmissions: 1, maxDepth: 0 },
    retentionHandleFor: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return h.createRetention();
    },
  }));

  assert.equal(result.schema, 'ei-private-retrieval-draft/v1');
  assert.equal(result.status, 'draft', JSON.stringify(result));
  assert.equal(result.completeness, 'incomplete');
  assert.ok(result.facts.some((fact) => fact.field === 'startDate'));
  assert.equal(result.sources.filter((source) => source.representation === 'raw').length, 1);
  assert.equal(result.sources.filter((source) => source.representation === 'asset-source-excerpt').length, 1, JSON.stringify(result));
  assert.equal(result.sources.find((source) => source.representation === 'raw').sourceUrl, suppliedUrl);
  assert.equal(result.sources.find((source) => source.representation === 'raw').canonicalUrl, canonicalUrl);
  assert.ok(result.sources.find((source) => source.representation === 'asset-source-excerpt').assetCandidates.length > 0);
  assert.equal(result.sources.find((source) => source.representation === 'asset-source-excerpt').assetCandidates[0].permission, 'unknown');
  assert.equal(result.sources.find((source) => source.representation === 'asset-source-excerpt').assetCandidates[0].inspection, 'pending');
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.sourceAuthority, 'not_evaluated');
  assert.equal(result.rights, 'not_evaluated');
  assert.equal(result.usage, 'unknown');
  assert.equal(requestCount, 1, 'discovered image candidates are stored without fetching the asset');
  assert.equal(result.progress.transportAttemptAdmissions, 1);
  assert.equal(fetchedBuffers.length, 2);
  assert.ok(fetchedBuffers.every((buffer) => Buffer.isBuffer(buffer) && buffer.every((byte) => byte === 0)),
    'private SafeFetcher body references passed to evidence stores are wiped after use');

  const reopened = createEvidenceStore(h.evidenceConfig);
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request());
  const selectedHandles = await Promise.all(result.sources.map((source) => reopened.lookupEvidence(reopenedScope, source.evidenceId)));
  const readback = await reopened.materializeSelected(reopenedScope, {
    evidence: selectedHandles, facts: [],
  }, request());
  assert.deepEqual(readback.evidence.map((item) => item.metadata.evidenceId).sort(),
    result.sources.map((source) => source.evidenceId).sort());
  const reopenedRaw = readback.evidence.find((item) => item.metadata.representation === undefined);
  assert.equal(reopenedRaw.source.sourceUrl, suppliedUrl);
  assert.equal(reopenedRaw.source.canonicalUrl, canonicalUrl);
  assert.ok(reopenedRaw.positions.length > 0);
});

test('selected-evidence cap seals a useful incomplete draft while preserving queued candidates without another dispatch', async (t) => {
  let requestCount = 0;
  const server = await startFixture((_request, response) => {
    requestCount += 1;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-selection-cap-queued';
  const seeds = Array.from({ length: 9 }, (_, index) => ({ url: sourceUrl(`/cap-${index}`) }));
  const result = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds,
    limits: { maxTransportAttemptAdmissions: 8, maxDepth: 0 },
  }));

  assert.equal(result.status, 'draft', JSON.stringify(result));
  assert.equal(result.completeness, 'incomplete');
  assert.ok(result.sources.length > 0);
  assert.ok(result.limitations.includes('selected_evidence_limit'));
  assert.equal(requestCount, 8, 'the selected-evidence cap stops before a ninth request');
  assert.equal(result.progress.transportAttemptAdmissions, 8);
  assert.equal(result.progress.remainingCandidates, 1);
  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  assert.equal(snapshot.candidates.filter((candidate) => candidate.state === 'queued').length, 1);
  assert.equal(snapshot.candidates.filter((candidate) => candidate.state === 'completed').length, 8);
  const queued = snapshot.candidates.find((candidate) => candidate.state === 'queued');
  assert.ok(queued);
  assert.deepEqual(await h.frontier.claimNext(h.scope, runId, {
    workerId: 'after-seal', claimKey: 'claim-after-partial-release',
  }), { state: 'stopped', reason: 'private_draft_sealed' });
  const afterSeal = await h.frontier.admitTransportHop(h.scope, runId, {
    leaseToken: 'synthetic-after-partial-release', attemptKey: 'transport-after-partial-release',
    kind: 'initial', url: queued.canonicalUrl,
  });
  assert.equal(afterSeal.state, 'denied');
  assert.equal(afterSeal.reason, 'private_draft_sealed');
  assert.equal(requestCount, 8);
  assert.equal((await h.frontier.getTransportProgress(h.scope, runId)).reservedBytes, 0);
  const reopened = h.openFrontier();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request());
  const persisted = await reopened.getSnapshot(reopenedScope, runId);
  assert.equal(persisted.candidates.filter((candidate) => candidate.state === 'queued').length, 1);
  assert.equal(persisted.candidates.filter((candidate) => candidate.state === 'completed').length, 8);
  assert.deepEqual(await reopened.claimNext(reopenedScope, runId, {
    workerId: 'after-reopen', claimKey: 'claim-after-sealed-reopen',
  }), { state: 'stopped', reason: 'private_draft_sealed' });
});

test('each real redirect is admitted before fetch and retained with its exact transport chain', async (t) => {
  let requestCount = 0;
  const finalUrl = new URL(sourceUrl('/final')).href;
  const server = await startFixture((requestValue, response) => {
    requestCount += 1;
    if (requestValue.url === '/start') {
      response.writeHead(302, { location: '/final' });
      response.end();
      return;
    }
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-redirect-chain';
  const result = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds: [{ url: sourceUrl('/start') }],
    limits: { maxTransportAttemptAdmissions: 2, maxDepth: 0 },
  }));
  assert.equal(result.status, 'draft', JSON.stringify(result));
  assert.equal(requestCount, 2);
  assert.equal(result.progress.transportAttemptAdmissions, 2);
  assert.deepEqual(result.sources.find((source) => source.representation === 'raw').redirectChain, [finalUrl]);
  const transport = await h.frontier.getTransportProgress(h.scope, runId);
  assert.equal(transport.reservedBytes, 0);
  assert.ok(transport.spentBytes > 0);
  assert.equal(transport.states.known_zero, 1);
  assert.equal(transport.states.body_complete, 1);
});

test('private and credential-bearing redirect targets stop before a second admission or dispatch', async (t) => {
  const targets = [
    'http://127.0.0.1/private',
    '/next?access_token=canary-redirect-token',
  ];
  for (const [index, target] of targets.entries()) {
    let requestCount = 0;
    const server = await startFixture((_request, response) => {
      requestCount += 1;
      response.writeHead(302, { location: target });
      response.end();
    });
    t.after(() => server.close());
    const h = await harness(t);
    const runId = `private-redirect-denied-${index}`;
    const result = await runPrivateRetrieval(h.makeInput({
      runId, server, seeds: [{ url: sourceUrl('/start') }],
      limits: { maxTransportAttemptAdmissions: 2, maxDepth: 0 },
    }));
    assert.equal(result.draft, null);
    assert.equal(result.status, 'cancelled');
    assert.ok(result.limitations.includes('safe_fetch_policy_or_dns_denied'));
    assert.equal(requestCount, 1);
    const transport = await h.frontier.getTransportProgress(h.scope, runId);
    assert.equal(transport.reservedBytes, 0);
    assert.equal(transport.spentBytes, 0);
    assert.equal(transport.states.known_zero, 1);
    const snapshot = await h.frontier.getSnapshot(h.scope, runId);
    assert.equal(snapshot.counters.transportAttemptAdmissions, 1);
    assert.equal(JSON.stringify(snapshot).includes('canary-redirect-token'), false);
  }
});

test('real source-bound results aggregate cross-source matching and contradictory event claims', async (t) => {
  const same = eventHtml({ name: 'Moonlight Market', date: '2027-06-20', city: 'Boston' });
  const conflict = eventHtml({ name: 'Moonlight Market', date: '2027-06-21', city: 'Boston' });
  const server = await startFixture((requestValue, response) => {
    const body = requestValue.url === '/same-a' || requestValue.url === '/same-b' ? same : conflict;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, body);
  });
  t.after(() => server.close());
  const h = await harness(t);
  const result = await runPrivateRetrieval(h.makeInput({
    runId: 'private-cross-source', server,
    seeds: ['/same-a', '/same-b', '/conflict'].map((pathname) => ({ url: sourceUrl(pathname) })),
    limits: { maxTransportAttemptAdmissions: 3, maxDepth: 0 },
  }));

  assert.equal(result.status, 'draft', JSON.stringify(result));
  assert.equal(result.occurrenceCandidates.length, 3);
  assert.equal(result.occurrenceDecisions.length, 3);
  assert.ok(result.occurrenceDecisions.some((decision) => decision.duplicateContentHashes.length === 1));
  assert.ok(result.occurrenceDecisions.some((decision) => decision.conflictFields.includes('start')));
  assert.ok(result.conflicts.some((conflictValue) => conflictValue.fields?.includes('start')));
  assert.ok(result.facts.filter((fact) => fact.field === 'startDate').length >= 3);
});

test('an OS-process cancellation closes a slow active request and leaves its full reservation unresolved', { timeout: 8_000 }, async (t) => {
  let reached;
  let closed;
  let release;
  const requestStarted = new Promise((resolve) => { reached = resolve; });
  const requestClosed = new Promise((resolve) => { closed = resolve; });
  const hold = new Promise((resolve) => { release = resolve; });
  const server = await startFixture(async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.write('<!doctype html><html><body>slow');
    response.once('close', closed);
    reached();
    await hold;
    if (!response.destroyed) response.end(eventHtml());
  });
  t.after(async () => { release(); await server.close(); });
  const h = await harness(t);
  const runId = 'private-remote-cancel';
  const running = runPrivateRetrieval(h.makeInput({
    runId, server, seeds: [{ url: sourceUrl('/slow') }],
    limits: { maxTransportAttemptAdmissions: 1, maxDepth: 0 },
  }));
  await requestStarted;
  assert.equal((await h.frontier.getSnapshot(h.scope, runId)).stopReason, 'attempt_limit',
    'automatic exhaustion after the last allowed admission is not itself cancellation');
  const cancelStarted = Date.now();
  await runStopWorker(h.frontierDirectory, runId);
  assert.ok((await h.frontier.getSnapshot(h.scope, runId)).stopReasons.some((entry) => entry.reason === 'cancelled'),
    'the durable cancellation event is present even when the primary stop reason was already exhausted');
  await requestClosed;
  const result = await running;
  assert.ok(Date.now() - cancelStarted < 5_000, 'remote cancellation closes the active request promptly');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.draft, null);
  const transport = await h.frontier.getTransportProgress(h.scope, runId);
  assert.equal(transport.reservedBytes, 20 * 1024 * 1024);
  assert.equal(transport.spentBytes, 0);
});

test('a restarted runner reports an admitted stale lease incomplete without redispatching it', async (t) => {
  let requestCount = 0;
  const server = await startFixture((_request, response) => {
    requestCount += 1;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-restart-unknown';
  const seeds = [{ url: sourceUrl('/already-dispatched') }];
  await h.frontier.createRun(h.scope, { runId, seeds });
  const priorClaim = await h.frontier.claimNext(h.scope, runId, { workerId: 'crashed-worker', claimKey: 'crashed-claim' });
  const attemptKey = 'crashed-in-flight-attempt';
  const admission = await h.frontier.admitTransportHop(h.scope, runId, {
    leaseToken: priorClaim.leaseToken, attemptKey, kind: 'initial', url: priorClaim.candidate.canonicalUrl,
  });
  assert.equal(admission.state, 'admitted');
  await h.frontier.markTransportDispatchIntent(h.scope, runId, { leaseToken: priorClaim.leaseToken, attemptKey });
  await h.frontier.markTransportResponseReceived(h.scope, runId, { leaseToken: priorClaim.leaseToken, attemptKey });
  h.frontier.close();

  const restartedFrontier = h.openFrontier();
  const restartedScope = await restartedFrontier.scopeForAuthenticatedRequest(request());
  const result = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds, frontier: restartedFrontier,
  }));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.equal(requestCount, 0, 'a prior lease and admission do not authorize a second transport dispatch');
  const snapshot = await restartedFrontier.getSnapshot(restartedScope, runId);
  assert.equal(snapshot.counters.transportAttemptAdmissions, 1);
  assert.equal(snapshot.candidates[0].state, 'leased');
  const transport = await restartedFrontier.getTransportProgress(restartedScope, runId);
  assert.equal(transport.reservedBytes, 20 * 1024 * 1024);
  assert.equal(transport.spentBytes, 0);
  assert.equal(transport.states.response_received, 1);
});

test('remote cancellation bounds a never-resolving retention callback and ignores its late result', { timeout: 8_000 }, async (t) => {
  let retentionStarted;
  let resolveRetention;
  const retentionCallbackStarted = new Promise((resolve) => { retentionStarted = resolve; });
  const pendingRetention = new Promise((resolve) => { resolveRetention = resolve; });
  const server = await startFixture((_request, response) => {
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  let ingestCalls = 0;
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'appendFact', 'ingestDerivedPdfEvidence', 'ingestAssetSourceEvidence',
    'lookupEvidence', 'lookupFact', 'materializeSelected',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.ingestEvidence = async (...args) => {
    ingestCalls += 1;
    return h.evidenceStore.ingestEvidence(...args);
  };
  const runId = 'private-cancel-retention';
  const running = runPrivateRetrieval(h.makeInput({
    runId, server, seeds: [{ url: sourceUrl('/event') }], store,
    retentionHandleFor() { retentionStarted(); return pendingRetention; },
  }));
  await retentionCallbackStarted;
  const cancelStarted = Date.now();
  await runStopWorker(h.frontierDirectory, runId);
  assert.ok((await h.frontier.getSnapshot(h.scope, runId)).stopReasons.some((entry) => entry.reason === 'cancelled'),
    'the durable cancellation event is present even if another stop reason remains primary');
  const result = await running;
  assert.ok(Date.now() - cancelStarted < 5_000, 'an unresolved host callback cannot delay cancellation');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.draft, null);
  assert.equal(ingestCalls, 0);
  resolveRetention(h.createRetention());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ingestCalls, 0, 'the late handle is not used to write private evidence after cancellation');
});

test('the whole-run deadline bounds a never-resolving final retention callback after the last admission', { timeout: 8_000 }, async (t) => {
  let retentionStarted;
  let resolveRetention;
  const retentionCallbackStarted = new Promise((resolve) => { retentionStarted = resolve; });
  const pendingRetention = new Promise((resolve) => { resolveRetention = resolve; });
  const server = await startFixture((_request, response) => {
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  let ingestCalls = 0;
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'appendFact', 'ingestDerivedPdfEvidence', 'ingestAssetSourceEvidence',
    'lookupEvidence', 'lookupFact', 'materializeSelected',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.ingestEvidence = async (...args) => {
    ingestCalls += 1;
    return h.evidenceStore.ingestEvidence(...args);
  };
  const runId = 'private-deadline-retention';
  const running = runPrivateRetrieval(h.makeInput({
    runId,
    server,
    seeds: [{ url: sourceUrl('/event') }],
    limits: { maxTransportAttemptAdmissions: 1, maxDepth: 0, durationMs: 750 },
    store,
    retentionHandleFor() { retentionStarted(); return pendingRetention; },
  }));
  await retentionCallbackStarted;
  const deadlineObservedAt = Date.now();
  const result = await running;
  assert.ok(Date.now() - deadlineObservedAt < 2_000, 'the absolute deadline releases a stalled retention callback promptly');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('deadline_exceeded'));
  assert.equal(ingestCalls, 0);
  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  assert.ok(snapshot.stopReasons.some((entry) => entry.reason === 'attempt_limit'));
  assert.ok(snapshot.stopReasons.some((entry) => entry.reason === 'deadline'));
  assert.equal(snapshot.candidates[0].state, 'unresolved');
  const transport = await h.frontier.getTransportProgress(h.scope, runId);
  assert.equal(transport.reservedBytes, 0, 'the complete response was settled before retention paused');
  assert.ok(transport.spentBytes > 0);
  resolveRetention(h.createRetention());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ingestCalls, 0, 'a late retention result cannot write evidence after the deadline');
  const restarted = h.openFrontier();
  const restartedScope = await restarted.scopeForAuthenticatedRequest(request());
  const reopened = await restarted.getSnapshot(restartedScope, runId);
  assert.equal(reopened.candidates[0].state, 'unresolved');
  assert.ok(reopened.stopReasons.some((entry) => entry.reason === 'deadline'));
});

test('a createRun that resolves after timeout is stopped durably and cannot dispatch late', { timeout: 8_000 }, async (t) => {
  let releaseCreate;
  let markCreated;
  const createGate = new Promise((resolve) => { releaseCreate = resolve; });
  const lateCreateResolved = new Promise((resolve) => { markCreated = resolve; });
  let requestCount = 0;
  const server = await startFixture((_request, response) => {
    requestCount += 1;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const frontier = frontierWithDelayedCreateRun(h.frontier, createGate, markCreated);
  const runId = 'private-timeout-during-create';
  const running = runPrivateRetrieval(h.makeInput({
    runId,
    server,
    frontier,
    seeds: [{ url: sourceUrl('/event') }],
    limits: { durationMs: 100 },
  }));
  const timeoutObservedAt = Date.now();
  const result = await running;
  assert.ok(Date.now() - timeoutObservedAt < 2_000);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('deadline_exceeded'));
  assert.equal(requestCount, 0);

  releaseCreate();
  await lateCreateResolved;
  let snapshot;
  const cleanupDeadline = Date.now() + 1_000;
  do {
    snapshot = await h.frontier.getSnapshot(h.scope, runId);
    if (snapshot.stopReasons.some((entry) => entry.reason === 'deadline')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < cleanupDeadline);
  assert.ok(snapshot.stopReasons.some((entry) => entry.reason === 'deadline'),
    'late run creation is followed by the already-expired durable stop');
  assert.equal(snapshot.candidates[0].state, 'queued');
});

test('the whole-run deadline interrupts an already-admitted last request and keeps uncertain capacity reserved', { timeout: 8_000 }, async (t) => {
  let requestCount = 0;
  let responseClosed = false;
  let delayedResponse;
  const server = await startFixture((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.write('<!doctype html>');
    response.once('close', () => { responseClosed = true; clearTimeout(delayedResponse); });
    delayedResponse = setTimeout(() => response.end(eventHtml()), 1_000);
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-deadline-last-hop';
  const running = runPrivateRetrieval(h.makeInput({
    runId,
    server,
    seeds: [{ url: sourceUrl('/slow-body') }],
    limits: { maxTransportAttemptAdmissions: 1, maxDepth: 0, durationMs: 750 },
  }));
  const deadlineObservedAt = Date.now();
  const result = await running;
  assert.ok(Date.now() - deadlineObservedAt < 2_000, 'the final authorized hop is bounded by the run deadline');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('deadline_exceeded'));
  assert.equal(requestCount, 1);
  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  assert.ok(snapshot.stopReasons.some((entry) => entry.reason === 'attempt_limit'));
  assert.ok(snapshot.stopReasons.some((entry) => entry.reason === 'deadline'));
  const transport = await h.frontier.getTransportProgress(h.scope, runId);
  assert.equal(transport.reservedBytes, 20 * 1024 * 1024);
  assert.equal(transport.spentBytes, 0);
  assert.equal(transport.states.unknown, 1);
  assert.equal(responseClosed, true, 'deadline abort closes the local socket before the delayed body can arrive');
});

test('a remote stop during final evidence lookup returns promptly without materializing a draft', { timeout: 8_000 }, async (t) => {
  let lookupStarted;
  const finalLookupStarted = new Promise((resolve) => { lookupStarted = resolve; });
  const server = await startFixture((_request, response) => {
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-cancel-final-lookup';
  let materializeCalls = 0;
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'ingestEvidence', 'appendFact', 'ingestDerivedPdfEvidence', 'ingestAssetSourceEvidence',
    'lookupFact',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.materializeSelected = async (...args) => {
    materializeCalls += 1;
    return h.evidenceStore.materializeSelected(...args);
  };
  store.lookupEvidence = async (scope, evidenceId) => {
    const snapshot = await h.frontier.getSnapshot(h.scope, runId);
    if (snapshot.candidates.length > 0 && snapshot.candidates.every((candidate) => candidate.state === 'completed')) {
      lookupStarted();
      return new Promise(() => {});
    }
    return h.evidenceStore.lookupEvidence(scope, evidenceId);
  };
  const running = runPrivateRetrieval(h.makeInput({
    runId, server, store, seeds: [{ url: sourceUrl('/event') }],
  }));
  await finalLookupStarted;
  const stopStarted = Date.now();
  await runStopWorker(h.frontierDirectory, runId);
  const result = await running;
  assert.ok(Date.now() - stopStarted < 2_000, 'the active watcher interrupts a stalled pre-seal lookup');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.draft, null);
  assert.equal(materializeCalls, 2, 'only the source composer materializations ran');
});

test('the whole-run deadline withholds a final materialization that never returns after sealing', { timeout: 8_000 }, async (t) => {
  let materializationStarted;
  const finalMaterializationStarted = new Promise((resolve) => { materializationStarted = resolve; });
  const server = await startFixture((_request, response) => {
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-deadline-final-materialize';
  let materializeCalls = 0;
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'ingestEvidence', 'appendFact', 'ingestDerivedPdfEvidence', 'ingestAssetSourceEvidence',
    'lookupEvidence', 'lookupFact',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.materializeSelected = async (...args) => {
    materializeCalls += 1;
    if (materializeCalls < 3) return h.evidenceStore.materializeSelected(...args);
    materializationStarted();
    return new Promise(() => {});
  };
  const running = runPrivateRetrieval(h.makeInput({
    runId,
    server,
    store,
    seeds: [{ url: sourceUrl('/event') }],
    limits: { maxTransportAttemptAdmissions: 1, maxDepth: 0, durationMs: 1_000 },
  }));
  await finalMaterializationStarted;
  const deadlineObservedAt = Date.now();
  const result = await running;
  assert.ok(Date.now() - deadlineObservedAt < 2_000, 'the final-release phase remains covered after watcher drain');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('deadline_exceeded'));
  assert.equal(materializeCalls, 3);
  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  assert.ok(snapshot.stopReasons.some((entry) => entry.reason === 'deadline'));
});

test('final selected readback rechecks current retention expiry after the composer materializations', async (t) => {
  let evidenceNow = Date.now();
  const retentionExpiresAt = evidenceNow + 60_000;
  const h = await harness(t, { evidenceOptions: { now: () => evidenceNow } });
  const server = await startFixture((_request, response) => {
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const runId = 'private-final-retention-expiry';
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'ingestEvidence', 'appendFact', 'ingestDerivedPdfEvidence', 'ingestAssetSourceEvidence',
    'lookupFact', 'materializeSelected',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.lookupEvidence = async (scope, evidenceId) => {
    const snapshot = await h.frontier.getSnapshot(h.scope, runId);
    if (snapshot.candidates.length > 0 && snapshot.candidates.every((candidate) => candidate.state === 'completed')) {
      evidenceNow = retentionExpiresAt + 1;
    }
    return h.evidenceStore.lookupEvidence(scope, evidenceId);
  };
  const result = await runPrivateRetrieval(h.makeInput({
    runId,
    server,
    store,
    seeds: [{ url: sourceUrl('/event') }],
    retentionHandleFor: () => h.createRetention(retentionExpiresAt),
  }));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('selected_evidence_expired_or_revoked'));
});

test('final selected readback fails closed if the current decryption key is revoked', async (t) => {
  let keyAvailable = true;
  const h = await harness(t, {
    evidenceOptions: {
      resolveKey({ tenantId, purpose, keyId }) {
        if (!keyAvailable) throw new Error('current key unavailable');
        const selectedKeyId = `${purpose}-test-v1`;
        if (keyId && keyId !== selectedKeyId) throw new Error('private key selection denied');
        return { keyId: selectedKeyId, key: createHash('sha256').update(`${tenantId}:${purpose}:private-retrieval-test`).digest() };
      },
    },
  });
  const server = await startFixture((_request, response) => {
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  let materializeCalls = 0;
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'ingestEvidence', 'appendFact', 'ingestDerivedPdfEvidence', 'ingestAssetSourceEvidence',
    'lookupEvidence', 'lookupFact',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.materializeSelected = async (...args) => {
    materializeCalls += 1;
    if (materializeCalls === 3) keyAvailable = false;
    return h.evidenceStore.materializeSelected(...args);
  };
  const result = await runPrivateRetrieval(h.makeInput({
    runId: 'private-final-key-revoked', server, store, seeds: [{ url: sourceUrl('/event') }],
  }));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('selected_evidence_key_unavailable'));
  assert.equal(materializeCalls, 3);
});

test('identity responses stay inside the smaller hard wire ceiling and retain unknown capacity on interruption', async (t) => {
  const tooLarge = Buffer.alloc(10 * 1024 * 1024 + 128 * 1024, 0x61);
  const server = await startFixture((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(tooLarge);
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-identity-wire-cap';
  const result = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds: [{ url: sourceUrl('/identity-over-wire-limit') }],
  }));

  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('resource_limit'));
  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  assert.equal(snapshot.observations.filter((observation) => observation.kind === 'source').length, 0);
  const transport = await h.frontier.getTransportProgress(h.scope, runId);
  assert.equal(transport.reservedBytes, 20 * 1024 * 1024);
  assert.equal(transport.spentBytes, 0);
  assert.equal(transport.states.unknown, 1);
});

test('gzip expansion beyond the accepted-byte cap remains a full unknown reservation', async (t) => {
  const expanded = Buffer.concat([
    Buffer.from('<!doctype html><html><body>'),
    Buffer.alloc(20 * 1024 * 1024, 0x61),
    Buffer.from('</body></html>'),
  ]);
  const compressed = gzipSync(expanded);
  const server = await startFixture((_request, response) => {
    respond(response, 200, {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'content-length': String(compressed.length),
    }, compressed);
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-gzip-overlimit';
  const result = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds: [{ url: sourceUrl('/gzip-overlimit') }],
  }));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('resource_limit'));
  const transport = await h.frontier.getTransportProgress(h.scope, runId);
  assert.equal(transport.reservedBytes, 20 * 1024 * 1024);
  assert.equal(transport.spentBytes, 0);
  assert.equal(transport.states.unknown, 1);
});

test('truncated gzip after decoded output retains the full reservation and produces no evidence', async (t) => {
  const compressed = gzipSync(eventHtml());
  const partial = compressed.subarray(0, compressed.length - 8);
  const server = await startFixture((_request, response) => {
    respond(response, 200, {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'content-length': String(partial.length),
    }, partial);
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-gzip-truncated';
  const result = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds: [{ url: sourceUrl('/gzip-truncated') }],
  }));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  const transport = await h.frontier.getTransportProgress(h.scope, runId);
  assert.equal(transport.reservedBytes, 20 * 1024 * 1024);
  assert.equal(transport.spentBytes, 0);
  assert.equal(transport.states.unknown, 1);
  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  assert.equal(snapshot.observations.filter((observation) => observation.kind === 'source').length, 0);
});

test('revocation while final selected materialization is returning withholds the draft', async (t) => {
  const server = await startFixture((_request, response) => {
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  let finalReached;
  let releaseFinal;
  const finalMaterializationReached = new Promise((resolve) => { finalReached = resolve; });
  const finalMaterializationRelease = new Promise((resolve) => { releaseFinal = resolve; });
  let selectedCalls = 0;
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'ingestEvidence', 'appendFact', 'ingestDerivedPdfEvidence',
    'ingestAssetSourceEvidence', 'lookupEvidence', 'lookupFact',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.materializeSelected = async (...args) => {
    selectedCalls += 1;
    const selected = await h.evidenceStore.materializeSelected(...args);
    if (selectedCalls === 3) {
      finalReached();
      await finalMaterializationRelease;
    }
    return selected;
  };
  const running = runPrivateRetrieval(h.makeInput({
    runId: 'private-revoked-final', server, seeds: [{ url: sourceUrl('/event') }], store,
    authorizeCurrent: () => h.currentlyAuthorized(),
  }));
  await finalMaterializationReached;
  h.setAcl(false);
  releaseFinal();
  const result = await running;
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('authorization_revoked'));
});

test('a remote stop committed before the durable release seal prevents final materialization', { timeout: 8_000 }, async (t) => {
  const server = await startFixture((_request, response) => {
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  let reached;
  let release;
  const sealReached = new Promise((resolve) => { reached = resolve; });
  const holdSeal = new Promise((resolve) => { release = resolve; });
  const frontier = frontierWithSealHook(h.frontier, async (seal, ...args) => {
    reached();
    await holdSeal;
    return seal(...args);
  });
  let materializeCalls = 0;
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'ingestEvidence', 'appendFact', 'ingestDerivedPdfEvidence',
    'ingestAssetSourceEvidence', 'lookupEvidence', 'lookupFact',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.materializeSelected = async (...args) => {
    materializeCalls += 1;
    return h.evidenceStore.materializeSelected(...args);
  };
  const runId = 'private-cancel-before-seal';
  const running = runPrivateRetrieval(h.makeInput({
    runId, server, frontier, store, seeds: [{ url: sourceUrl('/event') }],
  }));
  await sealReached;
  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  assert.ok(snapshot.candidates.every((candidate) => candidate.state === 'completed'));
  assert.equal((await h.frontier.getTransportProgress(h.scope, runId)).reservedBytes, 0);
  const cancelStarted = Date.now();
  await runStopWorker(h.frontierDirectory, runId);
  assert.ok((await h.frontier.getSnapshot(h.scope, runId)).stopReasons.some((entry) => entry.reason === 'cancelled'),
    'the durable cancellation event is present even when frontier exhaustion stays primary');
  release();
  const result = await running;
  assert.ok(Date.now() - cancelStarted < 5_000);
  assert.equal(result.draft, null);
  assert.equal(materializeCalls, 2, 'only the composer internal materializations occurred');
});

test('the durable release seal linearizes a later cross-process stop after completed candidates', { timeout: 8_000 }, async (t) => {
  const server = await startFixture((_request, response) => {
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  let reached;
  let release;
  const sealReached = new Promise((resolve) => { reached = resolve; });
  const holdAfterSeal = new Promise((resolve) => { release = resolve; });
  const frontier = frontierWithSealHook(h.frontier, async (seal, ...args) => {
    const result = await seal(...args);
    assert.equal(result.state, 'sealed');
    reached();
    await holdAfterSeal;
    return result;
  });
  const runId = 'private-cancel-after-seal';
  const running = runPrivateRetrieval(h.makeInput({
    runId, server, frontier, seeds: [{ url: sourceUrl('/event') }],
  }));
  await sealReached;
  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  assert.ok(snapshot.candidates.every((candidate) => candidate.state === 'completed'));
  const stopped = await runStopWorker(h.frontierDirectory, runId);
  assert.equal(stopped.stopReason, snapshot.stopReason,
    'a stop after the committed seal cannot retroactively invalidate the release order');
  assert.deepEqual((await h.frontier.getSnapshot(h.scope, runId)).stopReasons, snapshot.stopReasons);
  release();
  const result = await running;
  assert.equal(result.status, 'draft');
  assert.ok(result.sources.length > 0);
});

test('Linux private PDF retrieval selects stored derived provenance instead of claiming identity facts', { skip: process.platform !== 'linux' }, async (t) => {
  const { readFile } = await import('node:fs/promises');
  const pdfBytes = await readFile(new URL('../extraction/pdf/fixtures/text-multipage.pdf', import.meta.url));
  const server = await startFixture((_request, response) => {
    respond(response, 200, { 'content-type': 'application/pdf' }, pdfBytes);
  });
  t.after(() => server.close());
  const h = await harness(t);
  const result = await runPrivateRetrieval(h.makeInput({
    runId: 'private-pdf', server, seeds: [{ url: sourceUrl('/program.pdf') }],
    limits: { maxTransportAttemptAdmissions: 1, maxDepth: 0 },
  }));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.facts.length, 0);
  const pdf = result.sources.find((source) => source.representation === 'pdf-derived-text');
  assert.ok(pdf);
  assert.ok(pdf.pdf.pageCount > 0);
  assert.ok(pdf.pdf.textBoxCount > 0);
  assert.equal(pdf.pdf.requiresInspection, true);
  assert.equal(result.limitations.includes('pdf_identity_extraction_not_supported'), true);
});
