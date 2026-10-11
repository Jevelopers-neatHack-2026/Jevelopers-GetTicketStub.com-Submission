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
    frontier: frontierStore = frontier, store = evidenceStore }) => ({
    frontier: frontierStore,
    evidenceStore: store,
    safeFetcher: safeFetcher ?? makeFetcher(server),
    request: request(),
    runId,
    seeds,
    ...(limits ? { limits } : {}),
    ...(signal ? { signal } : {}),
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

async function legacyOvercapWorkspace(t, requestCounter) {
  const fixtureDirectory = new URL('../evidence/fixtures/private-run-receipt-v1-overcap/', import.meta.url);
  const fixtureBytes = await readFile(new URL('fixture.json', fixtureDirectory));
  assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'),
    '2981e94690d5c041b364ac91f8ebc24d5d0bc0742d48c46c9574e951aaa35cae',
  'the reviewed fixture descriptor is the captured baseline artifact');
  const fixture = JSON.parse(fixtureBytes.toString('utf8'));
  const evidenceBytes = await readFile(new URL('evidence.sqlite', fixtureDirectory));
  const frontierBytes = await readFile(new URL('frontier.sqlite', fixtureDirectory));
  assert.equal(createHash('sha256').update(evidenceBytes).digest('hex'), fixture.evidenceDatabaseSha256);
  assert.equal(createHash('sha256').update(frontierBytes).digest('hex'), fixture.frontierDatabaseSha256);
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-private-legacy-overcap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const frontierStores = new Set();
  t.after(() => {
    for (const store of frontierStores) store.close();
  });
  const evidenceDirectory = path.join(root, 'evidence');
  const frontierDirectory = path.join(root, 'frontier');
  await mkdir(path.join(evidenceDirectory, fixture.tenantHash), { recursive: true });
  await mkdir(path.join(frontierDirectory, fixture.tenantHash), { recursive: true });
  await copyFile(new URL('evidence.sqlite', fixtureDirectory),
    path.join(evidenceDirectory, fixture.tenantHash, 'evidence.sqlite'));
  await copyFile(new URL('frontier.sqlite', fixtureDirectory),
    path.join(frontierDirectory, fixture.tenantHash, 'frontier.sqlite'));
  const frontierDatabase = new DatabaseSync(path.join(frontierDirectory, fixture.tenantHash, 'frontier.sqlite'));
  try {
    const refreshed = frontierDatabase.prepare(`UPDATE frontier_runs SET deadline_at_ms = ?
      WHERE tenant_hash = ? AND run_id = ?`)
      .run(Date.now() + fixture.limits.durationMs, fixture.tenantHash, fixture.runId);
    assert.equal(refreshed.changes, 1, 'the test copy receives a fresh bounded restart window');
  } finally {
    frontierDatabase.close();
  }
  const authenticatedRequest = { principal: { tenantId: fixture.tenantId }, allowPrivate: true };
  const evidenceConfig = {
    directory: evidenceDirectory,
    resolveTenant: (value) => value?.principal?.tenantId,
    resolveKey({ tenantId, purpose, keyId }) {
      assert.equal(tenantId, fixture.tenantId);
      const selectedId = `${purpose}-legacy-fixture-v1`;
      if (keyId) assert.equal(keyId, selectedId);
      return {
        keyId: selectedId,
        key: createHash('sha256').update(`${tenantId}:${purpose}:legacy-receipt-v1`).digest(),
      };
    },
    resolveRetention({ tenantId, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
      assert.equal(tenantId, fixture.tenantId);
      return {
        expiresAtMs: kind === 'evidence'
          ? retentionHandle?.expiresAtMs ?? nowMs + fixture.retentionWindowMs
          : sourceExpiresAtMs ?? nowMs + fixture.retentionWindowMs,
        policyId: 'legacy-fixture-recovery', policyVersion: '1', accessPolicy: 'tenant_private',
      };
    },
    authorizePrivateAccess: ({ tenantId, request: value }) => tenantId === fixture.tenantId
      && value?.principal?.tenantId === tenantId && value.allowPrivate === true,
    authorizePrivateAccessCurrent: ({ tenantId, request: value }) => tenantId === fixture.tenantId
      && value?.principal?.tenantId === tenantId && value.allowPrivate === true,
    consumePrivatePayload({ source, positions }) {
      return { sourceUrl: source.sourceUrl, sourceHash: source.contentHash,
        snapshots: positions.map((position) => position.content.toString('utf8')) };
    },
    now: () => Date.now(),
    maxSourceBytes: 2 * 1024 * 1024,
    maxPositionBytes: 64 * 1024,
    maxPositionCount: 128,
    maxStoredPayloadBytes: 512 * 1024,
    maxRetentionMs: fixture.retentionWindowMs,
  };
  const openEvidenceStore = () => createEvidenceStore(evidenceConfig);
  const openFrontier = () => {
    const store = createDiscoveryFrontierStore({
      directory: frontierDirectory,
      resolveTenant: (value) => value?.principal?.tenantId,
      lockTimeoutMs: 10_000,
    });
    frontierStores.add(store);
    return store;
  };
  const server = await startFixture((_request, response) => {
    requestCounter.count += 1;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const safeFetcher = new SafeFetcher(localTestSeam({
    port: 80, dialPort: server.port, hostnames: ['fixture.example.org'],
  }));
  return {
    fixture,
    request: authenticatedRequest,
    safeFetcher,
    seeds: fixture.seeds,
    limits: fixture.limits,
    runId: fixture.runId,
    evidenceDirectory,
    frontierDirectory,
    openEvidenceStore,
    openFrontier,
    readLegacyReceiptRow() {
      const database = new DatabaseSync(path.join(evidenceDirectory, fixture.tenantHash, 'evidence.sqlite'), { readOnly: true });
      try {
        const row = database.prepare(`SELECT state, key_id, payload_hash, payload_bytes, sealed
          FROM private_retrieval_receipts WHERE tenant_hash = ?`)
          .get(fixture.tenantHash);
        assert.ok(row);
        return {
          state: row.state,
          keyId: row.key_id,
          payloadHash: row.payload_hash,
          payloadBytes: row.payload_bytes,
          sealed: Buffer.from(row.sealed),
        };
      } finally {
        database.close();
      }
    },
    async run(frontier, evidenceStore) {
      return runPrivateRetrieval({
        frontier,
        evidenceStore,
        safeFetcher,
        request: authenticatedRequest,
        runId: fixture.runId,
        seeds: fixture.seeds,
        limits: fixture.limits,
        retentionHandleFor: () => Object.freeze(Object.create(null)),
        authorizeCurrent: () => true,
      });
    },
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
    'beginPrivateRunReceipt', 'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
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

test('abort races an initially-live hop settlement without a late commit', { timeout: 8_000 }, async (t) => {
  for (const scenario of ['known-zero', 'unknown']) {
    let settlementReached;
    let settlementFinished;
    let releaseSettlement;
    const reached = new Promise((resolve) => { settlementReached = resolve; });
    const finished = new Promise((resolve) => { settlementFinished = resolve; });
    const held = new Promise((resolve) => { releaseSettlement = resolve; });
    const controller = new AbortController();
    const server = await startFixture((_request, response) => {
      if (scenario === 'unknown') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.write('<!doctype html><html><body>partial');
        setTimeout(() => response.destroy(), 25);
      } else {
        respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
      }
    });
    t.after(() => server.close());
    const h = await harness(t);
    const settlementMethod = scenario === 'known-zero'
      ? 'settleTransportHopKnownZero'
      : 'markTransportHopUnknown';
    let settlementCalls = 0;
    const overrides = {
      [settlementMethod]: async (...args) => {
        settlementCalls += 1;
        if (scenario === 'known-zero' && settlementCalls === 1) {
          throw new Error('fail the SafeFetcher known-zero hook so finally owns the next settlement');
        }
        assert.equal(args.at(-1)?.aborted, false, 'the finalizer settlement starts while the run is still live');
        settlementReached();
        await held;
        try { return await h.frontier[settlementMethod](...args); }
        finally { settlementFinished(); }
      },
    };
    if (scenario === 'known-zero') {
      overrides.markTransportDispatchIntent = async () => {
        throw new Error('controlled dispatch hook failure before socket creation');
      };
    }
    const frontier = frontierWithMethodOverrides(h.frontier, overrides);
    const runId = `private-late-${scenario}-settlement`;
    const running = runPrivateRetrieval(h.makeInput({
      runId, server, frontier, signal: controller.signal,
      seeds: [{ url: sourceUrl(`/${scenario}`) }],
      limits: { maxTransportAttemptAdmissions: 1, maxDepth: 0 },
    }));
    const gateOutcome = await Promise.race([
      reached.then(() => ({ reached: true })),
      running.then((value) => ({ result: value }), (error) => ({ error: String(error) })),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 2_000)),
    ]);
    assert.equal(gateOutcome.reached, true, JSON.stringify(gateOutcome));
    assert.equal(settlementCalls, scenario === 'known-zero' ? 2 : 1,
      'the delayed operation is the intended initially-live finally settlement');
    const abortStarted = Date.now();
    controller.abort();
    const result = await running;
    assert.ok(Date.now() - abortStarted < 1_000, `${scenario} settlement wait is bounded to shutdown scale`);
    assert.equal(result.draft, null);
    assert.equal(result.status, 'cancelled');
    releaseSettlement();
    await Promise.race([
      finished,
      new Promise((_, reject) => setTimeout(() => reject(new Error('late settlement did not acknowledge its attempt')), 1_000)),
    ]);
    const reopened = h.openFrontier();
    const reopenedScope = await reopened.scopeForAuthenticatedRequest(request());
    const transport = await reopened.getTransportProgress(reopenedScope, runId);
    assert.equal(transport.reservedBytes, 20 * 1024 * 1024,
      'a settlement whose outcome was uncertain at cancellation retains its full durable reservation');
    assert.equal(transport.spentBytes, 0);
    assert.equal(transport.states[scenario === 'known-zero' ? 'reserved' : 'response_received'], 1);
    assert.equal(transport.states.known_zero ?? 0, 0);
  }
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
  const limits = {
    maxDepth: 0,
    maxTransportAttemptAdmissions: 1,
    maxInFlightLeases: 4,
    durationMs: 30_000,
    maxSuggestionsPerCompletion: 16,
  };
  await h.frontier.createRun(h.scope, { runId, seeds, limits });
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
    runId, server, seeds, frontier: restartedFrontier, limits,
  }));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('dispatch_state_unknown'), JSON.stringify(result));
  assert.equal(requestCount, 0, 'a prior lease and admission do not authorize a second transport dispatch');
  const snapshot = await restartedFrontier.getSnapshot(restartedScope, runId);
  assert.equal(snapshot.counters.transportAttemptAdmissions, 1);
  assert.equal(snapshot.candidates[0].state, 'unresolved');
  assert.ok(snapshot.stopReasons.some((entry) => entry.reason === 'unresolved_work'));
  const transport = await restartedFrontier.getTransportProgress(restartedScope, runId);
  assert.equal(transport.reservedBytes, 20 * 1024 * 1024);
  assert.equal(transport.spentBytes, 0);
  assert.equal(transport.states.response_received, 1);
});

test('encrypted receipts recover sealed cross-source identity after same-config restart with current authorization', async (t) => {
  let requestCount = 0;
  const same = eventHtml({ name: 'Moonlight Market', date: '2027-06-20', city: 'Boston' });
  const conflict = eventHtml({ name: 'Moonlight Market', date: '2027-06-21', city: 'Boston' });
  const server = await startFixture((requestValue, response) => {
    requestCount += 1;
    const body = requestValue.url === '/same-a' || requestValue.url === '/same-b' ? same : conflict;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, body);
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-receipt-sealed-restart';
  const seeds = ['/same-a', '/same-b', '/conflict'].map((pathname) => ({ url: sourceUrl(pathname) }));
  const limits = {
    maxDepth: 0,
    maxTransportAttemptAdmissions: 3,
    maxInFlightLeases: 4,
    durationMs: 30_000,
    maxSuggestionsPerCompletion: 16,
  };
  const first = await runPrivateRetrieval(h.makeInput({ runId, server, seeds, limits }));
  assert.equal(first.status, 'draft', JSON.stringify(first));
  assert.ok(first.conflicts.some((item) => item.fields?.includes('start')));
  assert.equal(requestCount, 3);

  const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${TENANT}`).digest('hex');
  const database = new DatabaseSync(path.join(h.evidenceConfig.directory, tenantHash, 'evidence.sqlite'));
  try {
    const manifest = JSON.parse(database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?')
      .get(tenantHash).document);
    const extension = database.prepare(`SELECT version FROM evidence_extension_schema
      WHERE extension = 'private-retrieval-receipts'`).get();
    assert.equal(manifest.schemaVersion, 1, 'receipt storage does not migrate the evidence manifest profile');
    assert.equal(extension.version, 1, 'receipt storage keeps its own additive schema version');
    const receipts = database.prepare(`SELECT state, schema_version, key_id, payload_hash, payload_bytes, sealed
      FROM private_retrieval_receipts WHERE tenant_hash = ? ORDER BY receipt_key`).all(tenantHash);
    assert.equal(receipts.length, 3);
    assert.ok(receipts.every((row) => row.state === 'complete' && row.schema_version === 1));
    for (const row of receipts) {
      assert.equal(row.key_id, 'payload-test-v1');
      assert.match(row.payload_hash, /^[a-f0-9]{64}$/);
      assert.ok(row.payload_bytes > 0 && row.payload_bytes <= 512 * 1024);
      const envelope = Buffer.from(row.sealed).toString('utf8');
      for (const privateValue of ['Moonlight Market', 'Civic Hall', '2027-06-20', '2027-06-21', 'Boston']) {
        assert.equal(envelope.includes(privateValue), false, `receipt envelope must not expose ${privateValue}`);
      }
    }
  } finally {
    database.close();
  }

  const reopenedFrontier = h.openFrontier();
  const reopenedStore = createEvidenceStore(h.evidenceConfig);
  const recovered = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds, limits, frontier: reopenedFrontier, store: reopenedStore,
  }));
  assert.equal(requestCount, 3, 'sealed receipt replay performs no second transport');
  assert.equal(recovered.status, 'draft', JSON.stringify(recovered));
  assert.deepEqual(recovered.facts, first.facts);
  assert.deepEqual(recovered.sources, first.sources);
  assert.deepEqual(JSON.parse(JSON.stringify(recovered.occurrenceCandidates)),
    JSON.parse(JSON.stringify(first.occurrenceCandidates)));
  assert.deepEqual(JSON.parse(JSON.stringify(recovered.occurrenceDecisions)),
    JSON.parse(JSON.stringify(first.occurrenceDecisions)));
  assert.deepEqual(recovered.conflicts, first.conflicts);

  h.setAcl(false);
  const deniedFrontier = h.openFrontier();
  const deniedStore = createEvidenceStore(h.evidenceConfig);
  const denied = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds, limits, frontier: deniedFrontier, store: deniedStore,
  }));
  assert.equal(denied.draft, null);
  assert.notEqual(denied.status, 'draft');
  assert.ok(denied.limitations.includes('private_receipt_unavailable'));
  assert.equal(requestCount, 3, 'revoked authorization cannot turn receipt replay into a new fetch');
});

for (const mode of ['self-canonical', 'backlink', 'cycle']) {
  test(`same-config receipt replay retains claim-time binding after ${mode} observations`, async (t) => {
    let requestCount = 0;
    const targetFor = (pathname) => mode === 'self-canonical'
      ? (pathname === '/self' ? sourceUrl('/self') : null)
      : mode === 'backlink'
        ? (pathname === '/b' ? sourceUrl('/a') : null)
        : (pathname === '/a' ? sourceUrl('/b') : pathname === '/b' ? sourceUrl('/a') : null);
    const server = await startFixture((requestValue, response) => {
      requestCount += 1;
      const canonicalTarget = targetFor(requestValue.url);
      const canonical = canonicalTarget ? `<link rel="canonical" href="${canonicalTarget}">` : '';
      respond(response, 200, { 'content-type': 'text/html; charset=utf-8' },
        Buffer.concat([eventHtml({ name: `Canonical replay ${requestValue.url}` }), Buffer.from(canonical)]));
    });
    t.after(() => server.close());
    const h = await harness(t);
    const runId = `private-claim-prefix-${mode}`;
    const seeds = (mode === 'self-canonical' ? ['/self'] : mode === 'backlink' ? ['/a', '/b'] : ['/a'])
      .map((pathname) => ({ url: sourceUrl(pathname) }));
    const limits = { maxDepth: 1, maxTransportAttemptAdmissions: mode === 'cycle' ? 2 : seeds.length };
    const canonicalUrl = (pathname) => new URL(sourceUrl(pathname)).href;
    const first = await runPrivateRetrieval(h.makeInput({ runId, server, seeds, limits }));
    assert.equal(first.status, 'draft', JSON.stringify(first));
    const firstSnapshot = await h.frontier.getSnapshot(h.scope, runId);
    if (mode === 'self-canonical') {
      assert.ok(firstSnapshot.observations.some((item) => ['cycle', 'duplicate'].includes(item.disposition)
        && item.canonicalUrl === canonicalUrl('/self')));
    } else if (mode === 'backlink') {
      const linkedSeed = firstSnapshot.candidates.find((item) => item.canonicalUrl === canonicalUrl('/a'));
      assert.ok(linkedSeed.sourceRefs.length > 0, 'the later backlink remains in current frontier provenance');
    } else {
      assert.ok(firstSnapshot.observations.some((item) => item.disposition === 'cycle'),
        'the later cyclic observation remains represented');
    }

    const reopenedFrontier = h.openFrontier();
    const reopenedStore = createEvidenceStore(h.evidenceConfig);
    const replay = await runPrivateRetrieval(h.makeInput({
      runId, server, seeds, limits, frontier: reopenedFrontier, store: reopenedStore,
    }));
    assert.equal(requestCount, seeds.length + (mode === 'cycle' ? 1 : 0), 'replay never redispatches a completed candidate');
    assert.equal(replay.status, 'draft', JSON.stringify(replay));
    assert.deepEqual(replay.facts, first.facts);
    const reopenedScope = await reopenedFrontier.scopeForAuthenticatedRequest(request());
    const replaySnapshot = await reopenedFrontier.getSnapshot(reopenedScope, runId);
    assert.deepEqual(replaySnapshot.observations, firstSnapshot.observations,
      'later duplicate/cycle provenance remains available after receipt replay');
  });
}

for (const tamper of ['provenance', 'candidate', 'supplied-url', 'claim-key', 'claim-worker', 'claim-lease', 'completion-key', 'completion-outcome']) {
  test(`receipt replay withholds disclosure when durable ${tamper} no longer matches the sealed claim`, async (t) => {
    let requestCount = 0;
    const server = await startFixture((requestValue, response) => {
      requestCount += 1;
      const canonical = requestValue.url === '/root'
        ? `<link rel="canonical" href="${sourceUrl('/target')}">` : '';
      respond(response, 200, { 'content-type': 'text/html; charset=utf-8' },
        Buffer.concat([eventHtml({ name: `Tamper check ${requestValue.url}` }), Buffer.from(canonical)]));
    });
    t.after(() => server.close());
    const h = await harness(t);
    const runId = `private-claim-tamper-${tamper}`;
    const seeds = [{ url: sourceUrl('/root') }];
    const limits = { maxDepth: 1, maxTransportAttemptAdmissions: 2 };
    const first = await runPrivateRetrieval(h.makeInput({ runId, server, seeds, limits }));
    assert.equal(first.status, 'draft', JSON.stringify(first));
    const before = await h.frontier.getSnapshot(h.scope, runId);
    const candidate = before.candidates.find((item) => item.canonicalUrl === new URL(sourceUrl('/target')).href);
    assert.ok(candidate);
    if (tamper === 'provenance') assert.equal(candidate.sourceRefs.length, 1);

    const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${TENANT}`).digest('hex');
    const database = new DatabaseSync(path.join(h.frontierDirectory, tenantHash, 'frontier.sqlite'));
    try {
      if (tamper === 'provenance') {
        database.prepare(`UPDATE frontier_observations SET source_refs_json = '[]'
          WHERE tenant_hash = ? AND run_id = ? AND target_candidate_id = ? AND kind = 'link'`)
          .run(tenantHash, runId, candidate.candidateId);
      } else if (tamper === 'supplied-url') {
        const suppliedUrl = 'http://fixture.example.org:80/target';
        const observations = database.prepare(`SELECT sequence, source_refs_json FROM frontier_observations
          WHERE tenant_hash = ? AND run_id = ? AND target_candidate_id = ? AND kind = 'link'`)
          .all(tenantHash, runId, candidate.candidateId);
        assert.equal(observations.length, 1);
        for (const observation of observations) {
          const sourceRefs = JSON.parse(observation.source_refs_json);
          for (const reference of sourceRefs) reference.value = suppliedUrl;
          database.prepare(`UPDATE frontier_observations SET supplied_url = ?, source_refs_json = ?
            WHERE tenant_hash = ? AND run_id = ? AND sequence = ?`)
            .run(suppliedUrl, JSON.stringify(sourceRefs), tenantHash, runId, observation.sequence);
        }
      } else if (tamper === 'candidate') {
        database.prepare(`UPDATE frontier_candidates SET canonical_url = 'https://fixture.example.org/tampered-candidate'
          WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
          .run(tenantHash, runId, candidate.candidateId);
      } else if (tamper === 'claim-key') {
        database.exec('BEGIN IMMEDIATE');
        database.exec('PRAGMA defer_foreign_keys = ON');
        database.prepare(`UPDATE frontier_attempts SET claim_key = 'tampered-claim-key'
          WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
          .run(tenantHash, runId, candidate.candidateId);
        database.prepare(`UPDATE frontier_claims SET claim_key = 'tampered-claim-key'
          WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
          .run(tenantHash, runId, candidate.candidateId);
        database.exec('COMMIT');
      } else if (tamper === 'claim-worker') {
        database.prepare(`UPDATE frontier_claims SET worker_id = 'tampered-worker'
          WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
          .run(tenantHash, runId, candidate.candidateId);
      } else if (tamper === 'claim-lease') {
        database.prepare(`UPDATE frontier_claims SET lease_token = '123e4567-e89b-42d3-a456-426614174001'
          WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
          .run(tenantHash, runId, candidate.candidateId);
      } else if (tamper === 'completion-key') {
        database.prepare(`UPDATE frontier_completions SET completion_key = 'tampered-completion'
          WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
          .run(tenantHash, runId, candidate.candidateId);
      } else {
        database.prepare(`UPDATE frontier_completions SET outcome = 'failed'
          WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
          .run(tenantHash, runId, candidate.candidateId);
      }
    } finally {
      database.close();
    }

    const reopenedFrontier = h.openFrontier();
    const reopenedStore = createEvidenceStore(h.evidenceConfig);
    const replay = await runPrivateRetrieval(h.makeInput({
      runId, server, seeds, limits, frontier: reopenedFrontier, store: reopenedStore,
    }));
    assert.equal(replay.status, 'incomplete', JSON.stringify(replay));
    assert.equal(replay.draft, null);
    const expectedLimitation = ['provenance', 'supplied-url'].includes(tamper) ? 'private_receipt_mismatch'
      : ['claim-key', 'claim-worker'].includes(tamper) ? 'private_receipt_claim_mismatch'
        : ['completion-key', 'completion-outcome'].includes(tamper) ? 'private_receipt_completion_mismatch'
          : 'private_receipt_unavailable';
    assert.ok(replay.limitations.includes(expectedLimitation), JSON.stringify(replay));
    assert.equal(requestCount, 2, 'mismatched durable bindings do not authorize a second request');
  });
}

test('a complete receipt recovers evidence committed before a failed frontier completion without redispatch', async (t) => {
  let requestCount = 0;
  const server = await startFixture((_request, response) => {
    requestCount += 1;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-receipt-before-frontier-completion';
  const seeds = [{ url: sourceUrl('/receipt-before-frontier') }];
  const limits = { maxDepth: 0, maxTransportAttemptAdmissions: 1 };
  let failCompletion = true;
  const interruptedFrontier = frontierWithMethodOverrides(h.frontier, {
    completeCandidate: async (...args) => {
      if (failCompletion) {
        failCompletion = false;
        throw new Error('simulated interruption after receipt commit');
      }
      return h.frontier.completeCandidate(...args);
    },
  });
  const interrupted = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds, limits, frontier: interruptedFrontier,
  }));
  assert.equal(interrupted.status, 'incomplete');
  assert.equal(interrupted.draft, null);
  assert.equal(requestCount, 1);
  const beforeRestart = await h.frontier.getSnapshot(h.scope, runId);
  assert.equal(beforeRestart.candidates[0].state, 'leased');
  assert.equal((await h.frontier.getTransportProgress(h.scope, runId)).reservedBytes, 0);

  const reopenedFrontier = h.openFrontier();
  const reopenedStore = createEvidenceStore(h.evidenceConfig);
  const recovered = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds, limits, frontier: reopenedFrontier, store: reopenedStore,
  }));
  assert.equal(recovered.status, 'draft', JSON.stringify(recovered));
  assert.ok(recovered.facts.some((fact) => fact.field === 'startDate'));
  assert.equal(requestCount, 1, 'frontier completion is repaired from the receipt without a second request');
  const reopenedScope = await reopenedFrontier.scopeForAuthenticatedRequest(request());
  const afterRestart = await reopenedFrontier.getSnapshot(reopenedScope, runId);
  assert.equal(afterRestart.candidates[0].state, 'completed');
});

test('per-completion cap retains omitted provenance and deterministically replays after receipt interruption', async (t) => {
  let requestCount = 0;
  const acceptedUrl = 'https://links.example.org/a-first';
  const omittedUrl = 'https://links.example.org/z-last';
  const server = await startFixture((requestValue, response) => {
    requestCount += 1;
    const reverse = requestValue.url.endsWith('/reverse');
    const links = reverse ? [omittedUrl, acceptedUrl] : [acceptedUrl, omittedUrl];
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtmlWithCanonicalLinks(links));
  });
  t.after(() => server.close());
  const h = await harness(t);
  const limits = {
    maxDepth: 1,
    maxTransportAttemptAdmissions: 1,
    maxInFlightLeases: 4,
    durationMs: 30_000,
    maxSuggestionsPerCompletion: 1,
  };
  const assertBoundedResult = (result) => {
    assert.equal(result.status, 'draft', JSON.stringify(result));
    assert.equal(result.linkCandidates.length, 1);
    assert.equal(result.linkCandidates[0].url, acceptedUrl);
    assert.equal(result.omittedLinkCandidates.length, 1);
    assert.equal(result.omittedLinkCandidates[0].url, omittedUrl);
    assert.equal(result.omittedLinkCandidates[0].reason, 'completion_suggestion_limit');
    assert.equal(result.omittedLinkCandidates[0].depth, undefined,
      'omitted links are not projected as queued frontier candidates');
    assert.equal(result.omittedLinkCandidates[0].sourceAuthority, undefined);
    assert.equal(result.progress.truncatedSuggestionCount, 1);
    assert.equal(result.progress.sourceLinkCandidateOmittedCount, 0);
    assert.ok(result.progress.stopReasons.includes('fanout_limit'));
    const acceptedRef = result.linkCandidates[0].sourceRefs[0];
    const omittedRef = result.omittedLinkCandidates[0].sourceRefs[0];
    assert.equal(acceptedRef.value, acceptedUrl);
    assert.equal(omittedRef.value, omittedUrl);
    const source = result.sources.find((candidate) => candidate.evidenceId === omittedRef.evidenceId);
    assert.ok(source, 'omitted provenance remains tied to selected evidence');
    assert.equal(omittedRef.contentHash, source.contentHash);
    assert.equal(acceptedRef.contentHash, source.contentHash);
  };

  const orderedRunId = 'private-cap-order-a';
  const orderedSeeds = [{ url: sourceUrl('/fanout/ordered') }];
  const ordered = await runPrivateRetrieval(h.makeInput({ runId: orderedRunId, server, seeds: orderedSeeds, limits }));
  assertBoundedResult(ordered);
  const orderedSnapshot = await h.frontier.getSnapshot(h.scope, orderedRunId);
  assert.equal(orderedSnapshot.candidates.filter((candidate) => candidate.state === 'queued').length, 1);
  assert.ok(!orderedSnapshot.candidates.some((candidate) => candidate.canonicalUrl === omittedUrl));

  const interruptedRunId = 'private-cap-order-b-restart';
  const interruptedSeeds = [{ url: sourceUrl('/fanout/reverse') }];
  let failCompletion = true;
  const interruptedFrontier = frontierWithMethodOverrides(h.frontier, {
    completeCandidate: async (...args) => {
      if (failCompletion) {
        failCompletion = false;
        throw new Error('simulated crash after bounded receipt finalization');
      }
      return h.frontier.completeCandidate(...args);
    },
  });
  const interrupted = await runPrivateRetrieval(h.makeInput({
    runId: interruptedRunId, server, seeds: interruptedSeeds, limits, frontier: interruptedFrontier,
  }));
  assert.equal(interrupted.status, 'incomplete');
  assert.equal(interrupted.draft, null);
  assert.equal(requestCount, 2, 'each seed is fetched once despite the receipt/frontier crash boundary');
  const interruptedSnapshot = await h.frontier.getSnapshot(h.scope, interruptedRunId);
  assert.equal(interruptedSnapshot.candidates[0].state, 'leased');
  assert.equal((await h.frontier.getTransportProgress(h.scope, interruptedRunId)).reservedBytes, 0);
  const bindingBeforeRestart = await h.frontier.getCandidateReceiptBinding(
    h.scope, interruptedRunId, interruptedSnapshot.candidates[0].candidateId,
  );
  const configHash = createHash('sha256').update(JSON.stringify({
    runId: interruptedRunId,
    seeds: interruptedSeeds,
    limits,
  })).digest('hex');
  const receiptBeforeRestart = await h.evidenceStore.readPrivateRunReceipt(h.evidenceScope, {
    runId: interruptedRunId,
    configHash,
    candidate: bindingBeforeRestart.candidate,
  }, request());
  assert.equal(receiptBeforeRestart.state, 'complete');
  assert.equal(receiptBeforeRestart.truncatedCount, 1);
  assert.deepEqual(receiptBeforeRestart.suggestions.map((suggestion) => suggestion.url), [acceptedUrl]);
  assert.deepEqual(receiptBeforeRestart.omittedSuggestions.map((suggestion) => suggestion.url), [omittedUrl]);

  const reopenedFrontier = h.openFrontier();
  const reopenedStore = createEvidenceStore(h.evidenceConfig);
  const recovered = await runPrivateRetrieval(h.makeInput({
    runId: interruptedRunId, server, seeds: interruptedSeeds, limits,
    frontier: reopenedFrontier, store: reopenedStore,
  }));
  assertBoundedResult(recovered);
  assert.equal(requestCount, 2, 'receipt recovery does not dispatch the old lease again');
  const reopenedScope = await reopenedFrontier.scopeForAuthenticatedRequest(request());
  const afterRestart = await reopenedFrontier.getSnapshot(reopenedScope, interruptedRunId);
  assert.equal(afterRestart.candidates[0].state, 'completed');
  const reopenedEvidenceScope = await reopenedStore.scopeForAuthenticatedRequest(request());
  const receiptAfterRestart = await reopenedStore.readPrivateRunReceipt(reopenedEvidenceScope, {
    runId: interruptedRunId,
    configHash,
    candidate: bindingBeforeRestart.candidate,
  }, request());
  assert.deepEqual(receiptAfterRestart.suggestions, receiptBeforeRestart.suggestions);
  assert.deepEqual(receiptAfterRestart.omittedSuggestions, receiptBeforeRestart.omittedSuggestions);
  assert.equal(receiptAfterRestart.truncatedCount, receiptBeforeRestart.truncatedCount);
  assert.equal(recovered.linkCandidates[0].url, ordered.linkCandidates[0].url,
    'sorting by URL makes the accepted subset independent of extraction order');
  assert.equal(recovered.omittedLinkCandidates[0].url, ordered.omittedLinkCandidates[0].url);
});

test('no-links receipt records parser or URL-policy omission counts without retaining unsafe URLs', async (t) => {
  let requestCount = 0;
  const unsafeUrl = 'https://links.example.org/?access_token=synthetic-canary';
  const server = await startFixture((_request, response) => {
    requestCount += 1;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' },
      eventHtmlWithCanonicalLinks([unsafeUrl]));
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-no-links-policy-omission';
  const seeds = [{ url: sourceUrl('/unsafe-canonical') }];
  const limits = {
    maxDepth: 1, maxTransportAttemptAdmissions: 1, maxInFlightLeases: 4,
    durationMs: 30_000, maxSuggestionsPerCompletion: 1,
  };
  const result = await runPrivateRetrieval(h.makeInput({ runId, server, seeds, limits }));
  assert.equal(result.status, 'draft', JSON.stringify(result));
  assert.equal(result.linkCandidates.length, 0);
  assert.equal(result.omittedLinkCandidates.length, 0,
    'unsafe source URLs are counted without exposing or retaining their values');
  assert.equal(result.progress.truncatedSuggestionCount, 0,
    'the completion fanout cap did not omit any eligible suggestion');
  assert.equal(result.progress.sourceLinkCandidateOmittedCount, 1);
  assert.ok(!result.progress.stopReasons.includes('fanout_limit'));
  assert.ok(result.limitations.includes('some_link_candidates_omitted_by_policy_or_parser_limit'));
  assert.equal(JSON.stringify(result).includes('synthetic-canary'), false);
  assert.equal(requestCount, 1, 'the unsafe canonical link is never fetched');

  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  const candidate = snapshot.candidates.find((item) => item.seed);
  const binding = await h.frontier.getCandidateReceiptBinding(h.scope, runId, candidate.candidateId);
  const configHash = createHash('sha256').update(JSON.stringify({ runId, seeds, limits })).digest('hex');
  const receipt = await h.evidenceStore.readPrivateRunReceipt(h.evidenceScope, {
    runId, configHash, candidate: binding.candidate,
  }, request());
  assert.equal(receipt.state, 'complete');
  assert.equal(receipt.outcome, 'no_links');
  assert.equal(receipt.truncatedCount, 0);
  assert.deepEqual(receipt.omittedSuggestions, []);
  assert.equal(receipt.sourceLinkCandidatesOmittedCount, 1);
  assert.ok(receipt.limitations.includes('some_link_candidates_omitted_by_policy_or_parser_limit'));
});

test('baseline v1 overcap receipt recovers once and reconstructs identical omission evidence after another restart', async (t) => {
  const requests = { count: 0 };
  const h = await legacyOvercapWorkspace(t, requests);
  let frontier = h.openFrontier();
  let evidenceStore = h.openEvidenceStore();
  const scope = await frontier.scopeForAuthenticatedRequest(h.request);
  const before = await frontier.getSnapshot(scope, h.runId);
  assert.equal(before.candidates[0].state, 'leased');
  assert.equal(before.counters.transportAttemptAdmissions, 1);
  const transportBefore = await frontier.getTransportProgress(scope, h.runId);
  assert.equal(transportBefore.reservedBytes, 0);
  assert.ok(transportBefore.spentBytes > 0);
  const immutableReceiptRow = h.readLegacyReceiptRow();
  assert.equal(immutableReceiptRow.state, 'complete');
  assert.match(immutableReceiptRow.payloadHash, /^[a-f0-9]{64}$/);
  assert.ok(immutableReceiptRow.payloadBytes > 0 && immutableReceiptRow.sealed.byteLength > 0);
  const candidate = before.candidates[0];
  const initialBinding = await frontier.getCandidateReceiptBinding(scope, h.runId, candidate.candidateId);
  const evidenceScope = await evidenceStore.scopeForAuthenticatedRequest(h.request);
  const oldReceipt = await evidenceStore.readPrivateRunReceipt(evidenceScope, {
    runId: h.runId, configHash: h.fixture.configHash, candidate: initialBinding.candidate,
  }, h.request);
  assert.equal(oldReceipt.state, 'complete');
  assert.equal(oldReceipt.omissionMetadataVersion, 0);
  assert.equal(oldReceipt.suggestions.length, 2);
  assert.equal(oldReceipt.truncatedCount, 0,
    'the modern reader does not invent a persisted omission count for an old receipt');

  const recovered = await h.run(frontier, evidenceStore);
  assert.equal(recovered.status, 'draft', JSON.stringify(recovered));
  assert.equal(recovered.linkCandidates.length, 1);
  assert.equal(recovered.linkCandidates[0].url, 'https://links.example.org/a-first');
  assert.equal(recovered.omittedLinkCandidates.length, 1);
  assert.equal(recovered.omittedLinkCandidates[0].url, 'https://links.example.org/z-last');
  assert.equal(recovered.progress.truncatedSuggestionCount, 1);
  assert.ok(recovered.progress.stopReasons.includes('fanout_limit'));
  assert.equal(requests.count, 0, 'legacy receipt recovery does not repeat its original transport dispatch');
  const afterFirstRecovery = await frontier.getSnapshot(scope, h.runId);
  assert.equal(afterFirstRecovery.candidates.find((item) => item.seed).state, 'completed');
  assert.equal(afterFirstRecovery.counters.transportAttemptAdmissions, before.counters.transportAttemptAdmissions);
  assert.deepEqual(await frontier.getTransportProgress(scope, h.runId), transportBefore,
    'recovery preserves the original settled transport spend and admission counters');
  assert.deepEqual(h.readLegacyReceiptRow(), immutableReceiptRow,
    'frontier recovery leaves the historical encrypted receipt row unchanged');
  const omissionSourceRef = recovered.omittedLinkCandidates[0].sourceRefs[0];
  assert.equal(omissionSourceRef.value, 'https://links.example.org/z-last');
  assert.ok(recovered.sources.some((item) => item.evidenceId === omissionSourceRef.evidenceId
    && item.contentHash === omissionSourceRef.contentHash),
  'the recovery-time omitted URL remains attributable to the encrypted source evidence');

  frontier.close();
  frontier = h.openFrontier();
  evidenceStore = h.openEvidenceStore();
  const replayed = await h.run(frontier, evidenceStore);
  assert.equal(replayed.status, 'draft', JSON.stringify(replayed));
  assert.equal(replayed.progress.truncatedSuggestionCount, 1);
  assert.equal(replayed.omittedLinkCandidates[0].url, recovered.omittedLinkCandidates[0].url);
  assert.deepEqual(replayed.omittedLinkCandidates[0].sourceRefs, recovered.omittedLinkCandidates[0].sourceRefs,
    'the repeated completed-receipt reconstruction retains the same omitted provenance');
  assert.equal(requests.count, 0, 'the second restart remains receipt-only');
  const replayScope = await frontier.scopeForAuthenticatedRequest(h.request);
  const afterSecondRecovery = await frontier.getSnapshot(replayScope, h.runId);
  assert.equal(afterSecondRecovery.counters.transportAttemptAdmissions, before.counters.transportAttemptAdmissions);
  assert.deepEqual(await frontier.getTransportProgress(replayScope, h.runId), transportBefore);
  assert.deepEqual(h.readLegacyReceiptRow(), immutableReceiptRow);
});

test('legacy overcap recovery refuses missing or conflicting observations and a changed frontier payload hash', async (t) => {
  const requests = { count: 0 };
  const missingObservation = await legacyOvercapWorkspace(t, requests);
  let frontier = missingObservation.openFrontier();
  let evidenceStore = missingObservation.openEvidenceStore();
  const recovered = await missingObservation.run(frontier, evidenceStore);
  assert.equal(recovered.status, 'draft', JSON.stringify(recovered));
  const scope = await frontier.scopeForAuthenticatedRequest(missingObservation.request);
  const snapshot = await frontier.getSnapshot(scope, missingObservation.runId);
  const parent = snapshot.candidates.find((item) => item.seed);
  const databasePath = path.join(missingObservation.frontierDirectory,
    missingObservation.fixture.tenantHash, 'frontier.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    const observationCount = database.prepare(`SELECT COUNT(*) AS count FROM frontier_observations
      WHERE tenant_hash = ? AND run_id = ? AND parent_candidate_id = ? AND kind = 'link'`)
      .get(missingObservation.fixture.tenantHash, missingObservation.runId, parent.candidateId).count;
    assert.equal(observationCount, 1);
    database.prepare(`DELETE FROM frontier_observations
      WHERE tenant_hash = ? AND run_id = ? AND parent_candidate_id = ? AND kind = 'link'`)
      .run(missingObservation.fixture.tenantHash, missingObservation.runId, parent.candidateId);
  } finally {
    database.close();
  }
  frontier.close();
  frontier = missingObservation.openFrontier();
  evidenceStore = missingObservation.openEvidenceStore();
  const missingReplay = await missingObservation.run(frontier, evidenceStore);
  assert.equal(missingReplay.status, 'incomplete', JSON.stringify(missingReplay));
  assert.equal(missingReplay.draft, null);
  assert.ok(missingReplay.limitations.includes('legacy_receipt_fanout_recovery_unverified'));
  assert.equal(requests.count, 0);

  const conflictingObservation = await legacyOvercapWorkspace(t, requests);
  frontier = conflictingObservation.openFrontier();
  evidenceStore = conflictingObservation.openEvidenceStore();
  const conflictRecovered = await conflictingObservation.run(frontier, evidenceStore);
  assert.equal(conflictRecovered.status, 'draft', JSON.stringify(conflictRecovered));
  const conflictScope = await frontier.scopeForAuthenticatedRequest(conflictingObservation.request);
  const conflictSnapshot = await frontier.getSnapshot(conflictScope, conflictingObservation.runId);
  const conflictParent = conflictSnapshot.candidates.find((item) => item.seed);
  const conflictDatabasePath = path.join(conflictingObservation.frontierDirectory,
    conflictingObservation.fixture.tenantHash, 'frontier.sqlite');
  const conflictDatabase = new DatabaseSync(conflictDatabasePath);
  try {
    const observation = conflictDatabase.prepare(`SELECT sequence, source_refs_json FROM frontier_observations
      WHERE tenant_hash = ? AND run_id = ? AND parent_candidate_id = ? AND kind = 'link' ORDER BY sequence LIMIT 1`)
      .get(conflictingObservation.fixture.tenantHash, conflictingObservation.runId, conflictParent.candidateId);
    assert.ok(observation);
    const sourceRefs = JSON.parse(observation.source_refs_json);
    assert.equal(sourceRefs.length, 1);
    sourceRefs[0].value = 'https://links.example.org/conflicting-observation';
    conflictDatabase.prepare(`UPDATE frontier_observations SET source_refs_json = ?
      WHERE tenant_hash = ? AND run_id = ? AND sequence = ?`)
      .run(JSON.stringify(sourceRefs), conflictingObservation.fixture.tenantHash,
        conflictingObservation.runId, observation.sequence);
  } finally {
    conflictDatabase.close();
  }
  frontier.close();
  frontier = conflictingObservation.openFrontier();
  evidenceStore = conflictingObservation.openEvidenceStore();
  const conflictingReplay = await conflictingObservation.run(frontier, evidenceStore);
  assert.equal(conflictingReplay.status, 'incomplete', JSON.stringify(conflictingReplay));
  assert.equal(conflictingReplay.draft, null);
  assert.ok(conflictingReplay.limitations.includes('legacy_receipt_fanout_recovery_unverified'));
  assert.equal(requests.count, 0);

  const changedHash = await legacyOvercapWorkspace(t, requests);
  frontier = changedHash.openFrontier();
  evidenceStore = changedHash.openEvidenceStore();
  const hashRecovered = await changedHash.run(frontier, evidenceStore);
  assert.equal(hashRecovered.status, 'draft', JSON.stringify(hashRecovered));
  const hashDatabasePath = path.join(changedHash.frontierDirectory, changedHash.fixture.tenantHash, 'frontier.sqlite');
  const hashDatabase = new DatabaseSync(hashDatabasePath);
  try {
    hashDatabase.prepare(`UPDATE frontier_completions SET payload_hash = ?
      WHERE tenant_hash = ? AND run_id = ?`).run('0'.repeat(64), changedHash.fixture.tenantHash, changedHash.runId);
  } finally {
    hashDatabase.close();
  }
  frontier.close();
  frontier = changedHash.openFrontier();
  evidenceStore = changedHash.openEvidenceStore();
  const hashReplay = await changedHash.run(frontier, evidenceStore);
  assert.equal(hashReplay.status, 'incomplete', JSON.stringify(hashReplay));
  assert.equal(hashReplay.draft, null);
  assert.ok(hashReplay.limitations.includes('legacy_receipt_fanout_recovery_unverified'));
  assert.ok(hashReplay.limitations.includes('private_receipt_completion_mismatch'));
  assert.equal(requests.count, 0);
});

test('an expired encrypted receipt withholds replayed facts and does not authorize another request', async (t) => {
  let requestCount = 0;
  let evidenceNow = Date.now();
  const server = await startFixture((_request, response) => {
    requestCount += 1;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t, { evidenceOptions: { now: () => evidenceNow } });
  const runId = 'private-receipt-expired-restart';
  const seeds = [{ url: sourceUrl('/receipt-expiry') }];
  const limits = {
    maxDepth: 0,
    maxTransportAttemptAdmissions: 1,
    maxInFlightLeases: 4,
    durationMs: 30_000,
    maxSuggestionsPerCompletion: 16,
  };
  const first = await runPrivateRetrieval(h.makeInput({ runId, server, seeds, limits }));
  assert.equal(first.status, 'draft', JSON.stringify(first));
  assert.equal(requestCount, 1);

  evidenceNow += 181_000;
  const reopenedFrontier = h.openFrontier();
  const reopenedStore = createEvidenceStore(h.evidenceConfig);
  const reopenedScope = await reopenedStore.scopeForAuthenticatedRequest(request());
  const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${TENANT}`).digest('hex');
  const databasePath = path.join(h.evidenceConfig.directory, tenantHash, 'evidence.sqlite');
  const beforePurge = new DatabaseSync(databasePath);
  try {
    const row = beforePurge.prepare(`SELECT state, key_id, payload_hash, payload_bytes, sealed
      FROM private_retrieval_receipts WHERE tenant_hash = ? LIMIT 1`).get(tenantHash);
    assert.equal(row.state, 'complete', 'the completed runner persisted its replay receipt');
    assert.equal(row.key_id, 'payload-test-v1');
    assert.match(row.payload_hash, /^[a-f0-9]{64}$/);
    assert.ok(row.payload_bytes > 0 && row.sealed.byteLength > 0);
  } finally {
    beforePurge.close();
  }
  assert.equal(await reopenedStore.purgeExpired(reopenedScope), first.facts.length + 1,
    'tenant-wide purge expires the source and all extracted facts before exact receipt lookup');
  const afterPurge = new DatabaseSync(databasePath);
  try {
    const row = afterPurge.prepare(`SELECT state, key_id, payload_hash, payload_bytes, sealed
      FROM private_retrieval_receipts WHERE tenant_hash = ? LIMIT 1`).get(tenantHash);
    assert.equal(row.state, 'expired', 'purge clears the complete receipt before exact receipt lookup');
    assert.equal(row.key_id, null);
    assert.equal(row.payload_hash, null);
    assert.equal(row.payload_bytes, null);
    assert.equal(row.sealed, null);
  } finally {
    afterPurge.close();
  }
  assert.deepEqual(await reopenedStore.integritySnapshot(reopenedScope), {
    availableEvidence: 0,
    expiredEvidence: 1,
    availableFacts: 0,
    expiredFacts: first.facts.length,
    encryptedPayloadRecords: 0,
    encryptedPrivateReceiptRecords: 0,
  }, 'ordinary expiry purge removes the expired receipt envelope as well as evidence payloads');
  const expired = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds, limits, frontier: reopenedFrontier, store: reopenedStore,
  }));
  assert.equal(expired.status, 'incomplete');
  assert.equal(expired.draft, null);
  assert.ok(expired.limitations.includes('private_receipt_expired'), JSON.stringify(expired));
  assert.ok(expired.limitations.includes('private_receipt_unavailable'));
  assert.equal(requestCount, 1, 'expired records and receipts never trigger a replacement fetch');
});

test('a durable pending receipt after the pre-dispatch crash boundary remains incomplete and is never redispatched', async (t) => {
  let requestCount = 0;
  let receiptBinding;
  const server = await startFixture((_request, response) => {
    requestCount += 1;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-pending-receipt-crash';
  const seeds = [{ url: sourceUrl('/pending-receipt') }];
  const limits = { maxDepth: 0, maxTransportAttemptAdmissions: 1 };
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'appendFact', 'ingestEvidence', 'ingestDerivedPdfEvidence',
    'ingestAssetSourceEvidence', 'lookupEvidence', 'lookupFact', 'materializeSelected',
    'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.beginPrivateRunReceipt = async (scope, binding, authenticated, signal) => {
    receiptBinding = binding;
    const result = await h.evidenceStore.beginPrivateRunReceipt(scope, binding, authenticated, signal);
    assert.deepEqual(result, { state: 'pending', created: true });
    throw new Error('simulated process loss after durable pending receipt and before first admission');
  };
  const interrupted = await runPrivateRetrieval(h.makeInput({ runId, server, seeds, limits, store }));
  assert.equal(interrupted.draft, null);
  assert.equal(requestCount, 0);
  assert.equal((await h.frontier.getSnapshot(h.scope, runId)).counters.transportAttemptAdmissions, 0);
  assert.ok(receiptBinding);
  const pending = await h.evidenceStore.readPrivateRunReceipt(h.evidenceScope, {
    runId, configHash: receiptBinding.configHash, candidate: receiptBinding.candidate,
  }, request());
  assert.equal(pending.state, 'pending');

  const reopenedFrontier = h.openFrontier();
  const reopenedStore = createEvidenceStore(h.evidenceConfig);
  const recovered = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds, limits, frontier: reopenedFrontier, store: reopenedStore,
  }));
  assert.equal(recovered.draft, null);
  assert.equal(recovered.status, 'incomplete');
  assert.ok(recovered.limitations.includes('private_receipt_pending'));
  assert.ok(recovered.limitations.includes('cancelled_before_dispatch'));
  assert.equal(requestCount, 0, 'a pending receipt is never a replay or dispatch grant');
  const reopenedScope = await reopenedFrontier.scopeForAuthenticatedRequest(request());
  const persisted = await reopenedFrontier.getSnapshot(reopenedScope, runId);
  assert.equal(persisted.candidates[0].state, 'unresolved');
  assert.equal(persisted.candidates[0].unresolvedReason, 'cancelled_before_dispatch');
  assert.ok(persisted.stopReasons.some((entry) => entry.reason === 'unresolved_work'));
  assert.deepEqual(await reopenedStore.beginPrivateRunReceipt(
    await reopenedStore.scopeForAuthenticatedRequest(request()), receiptBinding, request(),
  ), { state: 'pending', created: false }, 'an existing pending marker cannot become a fresh dispatch grant');
});

test('a pending receipt that appears before begin returns its existing marker and resolves the lease without redispatch', async (t) => {
  let requestCount = 0;
  let receiptBinding;
  let beginCalls = 0;
  const server = await startFixture((_request, response) => {
    requestCount += 1;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-pending-receipt-existing-marker';
  const seeds = [{ url: sourceUrl('/pending-existing-marker') }];
  const limits = { maxDepth: 0, maxTransportAttemptAdmissions: 1 };
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'appendFact', 'ingestEvidence', 'ingestDerivedPdfEvidence',
    'ingestAssetSourceEvidence', 'lookupEvidence', 'lookupFact', 'materializeSelected',
    'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.beginPrivateRunReceipt = async (scope, binding, authenticated, signal) => {
    beginCalls += 1;
    receiptBinding = binding;
    const concurrentlyCreated = await h.evidenceStore.beginPrivateRunReceipt(scope, binding, authenticated, signal);
    assert.deepEqual(concurrentlyCreated, { state: 'pending', created: true });
    // Model a concurrent creator winning immediately before this begin observes
    // its key: the real store returns its durable existing-marker result.
    return h.evidenceStore.beginPrivateRunReceipt(scope, binding, authenticated, signal);
  };

  const result = await runPrivateRetrieval(h.makeInput({ runId, server, seeds, limits, store }));
  assert.equal(beginCalls, 1);
  assert.equal(result.status, 'incomplete', JSON.stringify(result));
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('private_receipt_pending'), JSON.stringify(result));
  assert.ok(result.limitations.includes('cancelled_before_dispatch'), JSON.stringify(result));
  const pendingMarkerLimitations = result.limitations.filter((limitation) => [
    'private_receipt_pending', 'private_receipt_already_exists', 'cancelled_before_dispatch',
    'dispatch_state_unknown', 'source_unavailable',
  ].includes(limitation)).sort();
  assert.deepEqual(pendingMarkerLimitations, ['cancelled_before_dispatch', 'private_receipt_pending'],
    'the existing marker is handled directly without a generic source failure or changed uncertainty');
  assert.ok(!result.limitations.includes('source_unavailable'), JSON.stringify(result));
  assert.equal(requestCount, 0, 'an existing pending marker never authorizes another fetch');
  assert.ok(receiptBinding);
  const receipt = await h.evidenceStore.readPrivateRunReceipt(h.evidenceScope, {
    runId, configHash: receiptBinding.configHash, candidate: receiptBinding.candidate,
  }, request());
  assert.equal(receipt.state, 'pending');
  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  assert.equal(snapshot.counters.transportAttemptAdmissions, 0);
  assert.equal(snapshot.candidates[0].state, 'unresolved');
  assert.equal(snapshot.candidates[0].unresolvedReason, 'cancelled_before_dispatch');
});

test('evidence committed before receipt completion remains explicit uncertainty after restart', async (t) => {
  let requestCount = 0;
  let receiptBinding;
  const server = await startFixture((_request, response) => {
    requestCount += 1;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const runId = 'private-evidence-before-receipt-crash';
  const seeds = [{ url: sourceUrl('/evidence-before-receipt') }];
  const limits = { maxDepth: 0, maxTransportAttemptAdmissions: 1 };
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'appendFact', 'ingestEvidence', 'ingestDerivedPdfEvidence',
    'ingestAssetSourceEvidence', 'lookupEvidence', 'lookupFact', 'materializeSelected',
    'readPrivateRunReceipt',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.beginPrivateRunReceipt = async (scope, binding, authenticated, signal) => {
    receiptBinding = binding;
    return h.evidenceStore.beginPrivateRunReceipt(scope, binding, authenticated, signal);
  };
  store.finalizePrivateRunReceipt = async () => {
    throw new Error('simulated crash after evidence and fact commits, before the complete receipt');
  };
  const interrupted = await runPrivateRetrieval(h.makeInput({ runId, server, seeds, limits, store }));
  assert.equal(interrupted.status, 'incomplete');
  assert.equal(interrupted.draft, null);
  assert.equal(requestCount, 1);
  const persistedEvidence = await h.evidenceStore.integritySnapshot(h.evidenceScope);
  assert.ok(persistedEvidence.availableEvidence >= 1);
  assert.ok(persistedEvidence.availableFacts >= 1);
  assert.ok(receiptBinding);
  assert.equal((await h.evidenceStore.readPrivateRunReceipt(h.evidenceScope, {
    runId, configHash: receiptBinding.configHash, candidate: receiptBinding.candidate,
  }, request())).state, 'pending');
  const transport = await h.frontier.getTransportProgress(h.scope, runId);
  assert.equal(transport.reservedBytes, 0);
  assert.ok(transport.spentBytes > 0);

  const reopenedFrontier = h.openFrontier();
  const reopenedScope = await reopenedFrontier.scopeForAuthenticatedRequest(request());
  const reopenedStore = createEvidenceStore(h.evidenceConfig);
  const recovered = await runPrivateRetrieval(h.makeInput({
    runId, server, seeds, limits, frontier: reopenedFrontier, store: reopenedStore,
  }));
  assert.equal(recovered.status, 'incomplete');
  assert.equal(recovered.draft, null, 'unreceipted stored facts are not assumed to belong to a completed selection');
  assert.ok(recovered.limitations.includes('private_receipt_pending'), JSON.stringify(recovered));
  assert.ok(recovered.limitations.includes('dispatch_state_unknown'));
  assert.equal(requestCount, 1, 'an evidence/receipt crash gap never redispatches its old lease');
  const snapshot = await reopenedFrontier.getSnapshot(reopenedScope, runId);
  assert.equal(snapshot.candidates[0].state, 'unresolved');
  assert.equal(snapshot.candidates[0].unresolvedReason, 'dispatch_state_unknown');
  assert.equal((await reopenedFrontier.getTransportProgress(reopenedScope, runId)).spentBytes, transport.spentBytes);
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
    'beginPrivateRunReceipt', 'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
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

test('the whole-run deadline bounds a never-resolving final retention callback after the last admission', { timeout: 10_000 }, async (t) => {
  const runDurationMs = 5_000;
  const responseLeadMs = 1_250;
  const maximumMappingWidthMs = 25;
  let retentionStarted;
  let resolveRetention;
  const retentionCallbackStarted = new Promise((resolve) => { retentionStarted = resolve; });
  const pendingRetention = new Promise((resolve) => { resolveRetention = resolve; });
  let requestCount = 0;
  let tcpConnectionCount = 0;
  let persistedDeadlineAtMs;
  let persistedDeadlineMapPerfBeforeMs;
  let persistedDeadlineWallSampleAtMs;
  let persistedDeadlineMapPerfAfterMs;
  let persistedDeadlineLowerPerfMs;
  let persistedDeadlineUpperPerfMs;
  let runEntryPerfBeforeMs;
  let runEntryPerfAfterMs;
  let runEntryDeadlineLowerPerfMs;
  let runEntryDeadlineUpperPerfMs;
  let effectiveDeadlineLowerPerfMs;
  let effectiveDeadlineUpperPerfMs;
  let requestReceivedAtPerfMs;
  let responseTargetPerfMs;
  let responseStartedAtPerfMs;
  let responseFinishedAtPerfMs;
  let bodySettledAtPerfMs;
  let retentionCallbackStartedAtPerfMs;
  let runReturnedAtPerfMs;
  let retentionCalls = 0;
  const server = await startFixture(async (_request, response) => {
    requestCount += 1;
    requestReceivedAtPerfMs = performance.now();
    if (!Number.isFinite(effectiveDeadlineLowerPerfMs)) {
      response.destroy();
      return;
    }
    responseTargetPerfMs = effectiveDeadlineLowerPerfMs - responseLeadMs;
    responseStartedAtPerfMs = await waitUntilPerfAtOrAfter(responseTargetPerfMs);
    response.once('finish', () => { responseFinishedAtPerfMs = performance.now(); });
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  server.server.on('connection', () => { tcpConnectionCount += 1; });
  t.after(() => server.close());
  const h = await harness(t);
  let ingestCalls = 0;
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'appendFact', 'ingestDerivedPdfEvidence', 'ingestAssetSourceEvidence',
    'lookupEvidence', 'lookupFact', 'materializeSelected',
    'beginPrivateRunReceipt', 'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.ingestEvidence = async (...args) => {
    ingestCalls += 1;
    return h.evidenceStore.ingestEvidence(...args);
  };
  const runId = 'private-deadline-retention';
  // Keep cold tenant schema creation outside the run budget; this case targets
  // the stalled retention callback after a real response body has settled.
  await h.evidenceStore.integritySnapshot(h.evidenceScope);
  await assert.rejects(h.frontier.getSnapshot(h.scope, runId), (error) => error?.code === 'FRONTIER_NOT_FOUND');
  const frontier = frontierWithMethodOverrides(h.frontier, {
    createRun: async (...args) => {
      const created = await h.frontier.createRun(...args);
      persistedDeadlineAtMs = created.deadlineAtMs;
      persistedDeadlineMapPerfBeforeMs = performance.now();
      persistedDeadlineWallSampleAtMs = Date.now();
      persistedDeadlineMapPerfAfterMs = performance.now();
      // Date.now() is millisecond-granular. Include its full quantization
      // interval rather than treating either sampled endpoint as exact.
      persistedDeadlineLowerPerfMs = persistedDeadlineMapPerfBeforeMs
        + (persistedDeadlineAtMs - persistedDeadlineWallSampleAtMs - 1);
      persistedDeadlineUpperPerfMs = persistedDeadlineMapPerfAfterMs
        + (persistedDeadlineAtMs - persistedDeadlineWallSampleAtMs + 1);
      effectiveDeadlineLowerPerfMs = Math.min(runEntryDeadlineLowerPerfMs, persistedDeadlineLowerPerfMs);
      effectiveDeadlineUpperPerfMs = Math.min(runEntryDeadlineUpperPerfMs, persistedDeadlineUpperPerfMs);
      return created;
    },
    settleTransportHopBodyComplete: async (...args) => {
      const settled = await h.frontier.settleTransportHopBodyComplete(...args);
      bodySettledAtPerfMs = performance.now();
      return settled;
    },
  });
  runEntryPerfBeforeMs = performance.now();
  const running = runPrivateRetrieval(h.makeInput({
    runId,
    server,
    frontier,
    seeds: [{ url: sourceUrl('/event') }],
    limits: { maxTransportAttemptAdmissions: 1, maxDepth: 0, durationMs: runDurationMs },
    store,
    retentionHandleFor() {
      retentionCalls += 1;
      retentionCallbackStartedAtPerfMs = performance.now();
      retentionStarted();
      return pendingRetention;
    },
  }));
  runEntryPerfAfterMs = performance.now();
  runEntryDeadlineLowerPerfMs = runEntryPerfBeforeMs + runDurationMs;
  runEntryDeadlineUpperPerfMs = runEntryPerfAfterMs + runDurationMs;
  const runOutcome = running.then(
    (result) => ({ kind: 'returned', result }),
    (error) => ({ kind: 'rejected', error }),
  );
  const phase = await Promise.race([
    retentionCallbackStarted.then(() => ({ kind: 'retention-callback-started' })),
    runOutcome,
  ]);
  if (phase.kind !== 'retention-callback-started') {
    const outcome = phase.kind === 'returned'
      ? JSON.stringify({ status: phase.result.status, limitations: phase.result.limitations })
      : String(phase.error);
    assert.fail(`run ended before final retention callback; diagnostics=${JSON.stringify({
      outcome,
      ingestCalls,
      tcpConnectionCount,
      requestCount,
      runEntryPerfBeforeMs,
      runEntryPerfAfterMs,
      persistedDeadlineAtMs: persistedDeadlineAtMs ?? null,
      effectiveDeadlineLowerPerfMs: effectiveDeadlineLowerPerfMs ?? null,
      effectiveDeadlineUpperPerfMs: effectiveDeadlineUpperPerfMs ?? null,
      requestReceivedAtPerfMs: requestReceivedAtPerfMs ?? null,
      responseTargetPerfMs: responseTargetPerfMs ?? null,
      responseStartedAtPerfMs: responseStartedAtPerfMs ?? null,
      bodySettledAtPerfMs: bodySettledAtPerfMs ?? null,
    })}`);
  }
  const remainingAtRetentionCallbackMs = effectiveDeadlineLowerPerfMs - retentionCallbackStartedAtPerfMs;
  const remainingAtRequestMs = effectiveDeadlineLowerPerfMs - requestReceivedAtPerfMs;
  const diagnostics = () => ({
    runDurationMs,
    responseLeadMs,
    tcpConnectionCount,
    requestCount,
    runEntryPerfBeforeMs,
    runEntryPerfAfterMs,
    runEntryBracketWidthMs: runEntryPerfAfterMs - runEntryPerfBeforeMs,
    runEntryDeadlineLowerPerfMs,
    runEntryDeadlineUpperPerfMs,
    persistedDeadlineAtMs,
    persistedDeadlineMapPerfBeforeMs,
    persistedDeadlineWallSampleAtMs,
    persistedDeadlineMapPerfAfterMs,
    persistedDeadlineMapSampleWidthMs: persistedDeadlineMapPerfAfterMs - persistedDeadlineMapPerfBeforeMs,
    persistedDeadlineLowerPerfMs,
    persistedDeadlineUpperPerfMs,
    persistedDeadlineMappedWidthMs: persistedDeadlineUpperPerfMs - persistedDeadlineLowerPerfMs,
    effectiveDeadlineLowerPerfMs,
    effectiveDeadlineUpperPerfMs,
    effectiveDeadlineIntervalWidthMs: effectiveDeadlineUpperPerfMs - effectiveDeadlineLowerPerfMs,
    requestReceivedAtPerfMs: requestReceivedAtPerfMs ?? null,
    remainingAtRequestMs,
    responseTargetPerfMs: responseTargetPerfMs ?? null,
    responseStartedAtPerfMs: responseStartedAtPerfMs ?? null,
    responseFinishedAtPerfMs: responseFinishedAtPerfMs ?? null,
    bodySettledAtPerfMs: bodySettledAtPerfMs ?? null,
    retentionCallbackStartedAtPerfMs,
    remainingAtRetentionCallbackMs,
    retentionCalls,
    runReturnedAtPerfMs: runReturnedAtPerfMs ?? null,
  });
  t.diagnostic(JSON.stringify(diagnostics()));
  assert.equal(tcpConnectionCount, 1, 'a real local TCP connection reached the fixture');
  assert.equal(requestCount, 1, 'a real local HTTP request reached the fixture');
  assert.ok(Number.isSafeInteger(persistedDeadlineAtMs), 'the frontier persisted its absolute deadline');
  assert.ok(runEntryPerfAfterMs - runEntryPerfBeforeMs <= maximumMappingWidthMs,
    'the monotonic run-entry sample interval is narrow and bounded');
  assert.ok(persistedDeadlineMapPerfAfterMs - persistedDeadlineMapPerfBeforeMs <= maximumMappingWidthMs,
    'the persisted wall-to-monotonic sample interval is narrow and bounded');
  assert.ok(persistedDeadlineUpperPerfMs - persistedDeadlineLowerPerfMs <= maximumMappingWidthMs,
    'the quantization-aware persisted deadline interval is narrow and bounded');
  assert.ok(effectiveDeadlineLowerPerfMs <= effectiveDeadlineUpperPerfMs);
  assert.ok(effectiveDeadlineUpperPerfMs - effectiveDeadlineLowerPerfMs <= maximumMappingWidthMs,
    'the effective deadline interval is narrow and bounded');
  assert.ok(remainingAtRequestMs > 500,
    'the admitted real HTTP request reached the fixture with more than 500ms remaining');
  assert.ok(responseStartedAtPerfMs >= responseTargetPerfMs,
    'the real HTTP body was not released before the conservative response phase');
  assert.ok(bodySettledAtPerfMs < retentionCallbackStartedAtPerfMs,
    'the admitted response body settled in the frontier before final retention began');
  assert.ok(remainingAtRetentionCallbackMs >= 250 && remainingAtRetentionCallbackMs <= 1_500,
    'final retention begins with a bounded, measured amount of the original deadline remaining');
  assert.equal(retentionCalls, 1, 'the phase was reached by one final retention callback');

  const result = await running;
  runReturnedAtPerfMs = performance.now();
  t.diagnostic(JSON.stringify(diagnostics()));
  assert.ok(runReturnedAtPerfMs - retentionCallbackStartedAtPerfMs < 2_000,
    'the whole-run deadline releases the stalled final retention callback promptly');
  assert.ok(runReturnedAtPerfMs >= effectiveDeadlineLowerPerfMs - 100,
    'the admitted run did not return before the conservative absolute deadline bound');
  assert.ok(runReturnedAtPerfMs <= effectiveDeadlineUpperPerfMs + 2_000,
    'cleanup returns within a bounded interval after the conservative absolute deadline bound');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('deadline_exceeded'));
  assert.equal(ingestCalls, 0);
  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  assert.equal(snapshot.deadlineAtMs, persistedDeadlineAtMs, 'the persisted absolute deadline remains unchanged');
  assert.ok(snapshot.stopReasons.some((entry) => entry.reason === 'attempt_limit'));
  assert.ok(snapshot.stopReasons.some((entry) => entry.reason === 'deadline'));
  assert.equal(snapshot.candidates[0].state, 'unresolved');
  assert.equal(snapshot.candidates[0].admittedAttemptCount, 1);
  assert.equal(snapshot.counters.transportAttemptAdmissions, 1);
  const transport = await h.frontier.getTransportProgress(h.scope, runId);
  assert.equal(transport.reservedBytes, 0, 'the complete response was settled before retention paused');
  assert.ok(transport.spentBytes > 0);
  resolveRetention(h.createRetention());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ingestCalls, 0, 'a late retention result cannot write evidence after the deadline');
  const restarted = h.openFrontier();
  const restartedScope = await restarted.scopeForAuthenticatedRequest(request());
  const reopened = await restarted.getSnapshot(restartedScope, runId);
  assert.equal(reopened.deadlineAtMs, persistedDeadlineAtMs, 'reopening preserves the original absolute deadline');
  assert.equal(reopened.candidates[0].state, 'unresolved');
  assert.ok(reopened.stopReasons.some((entry) => entry.reason === 'deadline'));
});

test('a delayed createRun cannot create a durable run after timeout or dispatch late', { timeout: 8_000 }, async (t) => {
  let releaseCreate;
  let markAttempted;
  const createGate = new Promise((resolve) => { releaseCreate = resolve; });
  const lateCreateAttempted = new Promise((resolve) => { markAttempted = resolve; });
  let requestCount = 0;
  const server = await startFixture((_request, response) => {
    requestCount += 1;
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, eventHtml());
  });
  t.after(() => server.close());
  const h = await harness(t);
  const frontier = frontierWithDelayedCreateRun(h.frontier, createGate, markAttempted);
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
  await lateCreateAttempted;
  await assert.rejects(h.frontier.getSnapshot(h.scope, runId), (error) => error?.code === 'FRONTIER_NOT_FOUND');
});

test('the whole-run deadline interrupts an already-admitted last request and keeps uncertain capacity reserved', { timeout: 10_000 }, async (t) => {
  const runDurationMs = 5_000;
  const preCreateDelayMs = 200;
  const closeEventObservationTimeoutMs = 1_000;
  let requestCount = 0;
  let tcpConnectionCount = 0;
  let responseClosed = false;
  let socketClosed = false;
  let lateBodyAttempted = false;
  let lateBodyDelivered = false;
  let lateBodySawClosedResponse = false;
  let persistedDeadlineAtMs;
  let createRunEnteredAtPerfMs;
  let createRunInvokedAtPerfMs;
  let preCreateDelayElapsedMs;
  let persistedDeadlineMapPerfBeforeMs;
  let persistedDeadlineWallSampleAtMs;
  let persistedDeadlineMapPerfAfterMs;
  let persistedDeadlineLowerPerfMs;
  let persistedDeadlineUpperPerfMs;
  let runEntryPerfBeforeMs;
  let runEntryPerfAfterMs;
  let runEntryDeadlineLowerPerfMs;
  let runEntryDeadlineUpperPerfMs;
  let effectiveDeadlineLowerPerfMs;
  let effectiveDeadlineUpperPerfMs;
  let requestReceivedAtPerfMs;
  let responseClosedAtPerfMs;
  let socketClosedAtPerfMs;
  let lateBodyAttemptedAtPerfMs;
  let serverResponse;
  let resolveRequestReceived;
  let resolveResponseClosed;
  let resolveSocketClosed;
  let resolveLateBodyAttempt;
  const requestReceived = new Promise((resolve) => { resolveRequestReceived = resolve; });
  const responseClosedEvent = new Promise((resolve) => { resolveResponseClosed = resolve; });
  const socketClosedEvent = new Promise((resolve) => { resolveSocketClosed = resolve; });
  const lateBodyAttempt = new Promise((resolve) => { resolveLateBodyAttempt = resolve; });
  const server = await startFixture((_request, response) => {
    serverResponse = response;
    requestCount += 1;
    requestReceivedAtPerfMs = performance.now();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.write('<!doctype html>');
    response.once('close', () => {
      responseClosed = true;
      responseClosedAtPerfMs = performance.now();
      resolveResponseClosed();
    });
    resolveRequestReceived();
  });
  server.server.on('connection', (socket) => {
    tcpConnectionCount += 1;
    socket.once('close', () => {
      socketClosed = true;
      socketClosedAtPerfMs = performance.now();
      resolveSocketClosed();
    });
  });
  t.after(async () => {
    await server.close();
  });
  const h = await harness(t);
  const runId = 'private-deadline-last-hop';
  const frontier = frontierWithMethodOverrides(h.frontier, {
    createRun: async (...args) => {
      createRunEnteredAtPerfMs = performance.now();
      const preCreateTargetPerfMs = createRunEnteredAtPerfMs + preCreateDelayMs;
      while (performance.now() < preCreateTargetPerfMs) {
        const remainingDelayMs = preCreateTargetPerfMs - performance.now();
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.ceil(remainingDelayMs))));
      }
      createRunInvokedAtPerfMs = performance.now();
      preCreateDelayElapsedMs = createRunInvokedAtPerfMs - createRunEnteredAtPerfMs;
      const created = await h.frontier.createRun(...args);
      persistedDeadlineAtMs = created.deadlineAtMs;
      persistedDeadlineMapPerfBeforeMs = performance.now();
      persistedDeadlineWallSampleAtMs = Date.now();
      persistedDeadlineMapPerfAfterMs = performance.now();
      // Date.now() is millisecond-granular. These sample intervals conservatively
      // map the persisted wall deadline into the monotonic clock without selecting
      // one sample endpoint as an exact deadline.
      persistedDeadlineLowerPerfMs = persistedDeadlineMapPerfBeforeMs
        + (persistedDeadlineAtMs - persistedDeadlineWallSampleAtMs - 1);
      persistedDeadlineUpperPerfMs = persistedDeadlineMapPerfAfterMs
        + (persistedDeadlineAtMs - persistedDeadlineWallSampleAtMs + 1);
      effectiveDeadlineLowerPerfMs = Math.min(runEntryDeadlineLowerPerfMs, persistedDeadlineLowerPerfMs);
      effectiveDeadlineUpperPerfMs = Math.min(runEntryDeadlineUpperPerfMs, persistedDeadlineUpperPerfMs);
      return created;
    },
  });
  const input = h.makeInput({
    runId,
    server,
    frontier,
    seeds: [{ url: sourceUrl('/slow-body') }],
    limits: { maxTransportAttemptAdmissions: 1, maxDepth: 0, durationMs: runDurationMs },
  });
  runEntryPerfBeforeMs = performance.now();
  const running = runPrivateRetrieval(input);
  runEntryPerfAfterMs = performance.now();
  runEntryDeadlineLowerPerfMs = runEntryPerfBeforeMs + runDurationMs;
  runEntryDeadlineUpperPerfMs = runEntryPerfAfterMs + runDurationMs;
  const runOutcome = running.then(
    (result) => ({ kind: 'returned', result }),
    (error) => ({ kind: 'rejected', error }),
  );
  const phase = await Promise.race([
    requestReceived.then(() => ({ kind: 'request-received' })),
    runOutcome,
  ]);
  if (phase.kind !== 'request-received') {
    const outcome = phase.kind === 'returned'
      ? JSON.stringify({ status: phase.result.status, limitations: phase.result.limitations })
      : String(phase.error);
    assert.fail(`run ended before a real local HTTP request arrived; requestCount=${requestCount}; elapsedMs=${performance.now() - runEntryPerfBeforeMs}; outcome=${outcome}`);
  }
  const remainingAtRequestMs = effectiveDeadlineLowerPerfMs - requestReceivedAtPerfMs;
  assert.equal(tcpConnectionCount, 1, 'the local fixture observed a real TCP connection');
  assert.equal(requestCount, 1, 'the local HTTP handler observed the admitted request');
  assert.ok(Number.isSafeInteger(persistedDeadlineAtMs), 'the real frontier persisted the original run deadline');
  assert.ok(preCreateDelayElapsedMs >= preCreateDelayMs, 'createRun was phase-shifted by the full bounded real-time delay');
  assert.ok(persistedDeadlineLowerPerfMs > runEntryDeadlineUpperPerfMs,
    'the newly persisted deadline maps later than the entire run-entry deadline interval');
  assert.ok(effectiveDeadlineLowerPerfMs <= effectiveDeadlineUpperPerfMs, 'the effective deadline bounds are ordered');
  assert.ok(remainingAtRequestMs > 500, 'the request reached the fixture with a bounded window left on the original deadline');
  assert.ok(requestReceivedAtPerfMs < effectiveDeadlineLowerPerfMs,
    'the request arrived before the conservative lower bound of the effective whole-run deadline');

  const result = await running;
  const runReturnedAtPerfMs = performance.now();
  const deadlineReturnLagFromUpperMs = runReturnedAtPerfMs - effectiveDeadlineUpperPerfMs;
  const closeWaitStartedAtPerfMs = performance.now();
  let closeEventsObserved;
  let closeWaitTimer;
  try {
    closeEventsObserved = await Promise.race([
      Promise.all([responseClosedEvent, socketClosedEvent]).then(() => true),
      new Promise((resolve) => {
        closeWaitTimer = setTimeout(() => resolve(false), closeEventObservationTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(closeWaitTimer);
  }
  const closeWaitFinishedAtPerfMs = performance.now();
  t.diagnostic(JSON.stringify({
    preCreateDelayTargetMs: preCreateDelayMs,
    preCreateDelayElapsedMs,
    createRunEnteredAtPerfMs,
    createRunInvokedAtPerfMs,
    runEntryPerfBeforeMs,
    runEntryPerfAfterMs,
    runEntryBracketWidthMs: runEntryPerfAfterMs - runEntryPerfBeforeMs,
    runEntryDeadlineLowerPerfMs,
    runEntryDeadlineUpperPerfMs,
    persistedDeadlineAtMs,
    persistedDeadlineMapPerfBeforeMs,
    persistedDeadlineWallSampleAtMs,
    persistedDeadlineMapPerfAfterMs,
    persistedDeadlineMapSampleWidthMs: persistedDeadlineMapPerfAfterMs - persistedDeadlineMapPerfBeforeMs,
    persistedDeadlineLowerPerfMs,
    persistedDeadlineUpperPerfMs,
    persistedDeadlineMappedWidthMs: persistedDeadlineUpperPerfMs - persistedDeadlineLowerPerfMs,
    effectiveDeadlineLowerPerfMs,
    effectiveDeadlineUpperPerfMs,
    effectiveDeadlineIntervalWidthMs: effectiveDeadlineUpperPerfMs - effectiveDeadlineLowerPerfMs,
    requestReceivedAtPerfMs: requestReceivedAtPerfMs ?? null,
    remainingAtRequestMs: Number.isFinite(requestReceivedAtPerfMs)
      ? effectiveDeadlineLowerPerfMs - requestReceivedAtPerfMs : null,
    tcpConnectionCount,
    requestCount,
    runReturnedAtPerfMs,
    deadlineReturnLagFromUpperMs,
    deadlineReturnLagFromLowerMs: runReturnedAtPerfMs - effectiveDeadlineLowerPerfMs,
    closeWaitStartedAtPerfMs,
    closeWaitFinishedAtPerfMs,
    closeWaitLagMs: closeWaitFinishedAtPerfMs - closeWaitStartedAtPerfMs,
    closeEventObservationTimeoutMs,
    closeEventsObserved,
    responseClosed,
    responseClosedAtPerfMs: responseClosedAtPerfMs ?? null,
    socketClosed,
    socketClosedAtPerfMs: socketClosedAtPerfMs ?? null,
    lateBodyAttempted,
    lateBodyAttemptedAtPerfMs: lateBodyAttemptedAtPerfMs ?? null,
    lateBodySawClosedResponse,
    lateBodyDelivered,
  }));
  assert.ok(runReturnedAtPerfMs <= effectiveDeadlineUpperPerfMs + 2_000,
    'the final authorized hop returns promptly after the upper bound of the effective run deadline');
  assert.equal(closeEventsObserved, true, 'both local response and TCP socket close events are observed within the bounded wait');
  assert.ok(closeWaitFinishedAtPerfMs - closeWaitStartedAtPerfMs <= closeEventObservationTimeoutMs,
    'both close events are observed within one second after the run returns');
  assert.ok(responseClosedAtPerfMs >= effectiveDeadlineLowerPerfMs - 100,
    'the active local response remains open until the original run deadline');
  assert.ok(socketClosedAtPerfMs >= effectiveDeadlineLowerPerfMs - 100,
    'the local TCP socket remains open until the original run deadline');
  assert.ok(responseClosed && socketClosed, 'both observed close events came from real local fixture objects');

  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('deadline_exceeded'));
  const snapshotBeforeLateBody = await h.frontier.getSnapshot(h.scope, runId);
  assert.equal(snapshotBeforeLateBody.deadlineAtMs, persistedDeadlineAtMs, 'phase synchronization did not reset the persisted deadline');
  assert.ok(snapshotBeforeLateBody.stopReasons.some((entry) => entry.reason === 'attempt_limit'));
  assert.ok(snapshotBeforeLateBody.stopReasons.some((entry) => entry.reason === 'deadline'));
  assert.equal(snapshotBeforeLateBody.counters.transportAttemptAdmissions, 1);
  assert.equal(snapshotBeforeLateBody.candidates[0].state, 'unresolved');
  assert.equal(snapshotBeforeLateBody.candidates[0].admittedAttemptCount, 1);
  const transportBeforeLateBody = await h.frontier.getTransportProgress(h.scope, runId);
  assert.equal(transportBeforeLateBody.reservedBytes, 20 * 1024 * 1024);
  assert.equal(transportBeforeLateBody.spentBytes, 0);
  assert.equal(transportBeforeLateBody.states.unknown, 1);
  assert.equal(responseClosed, true, 'deadline abort closes the local response socket');
  assert.equal(socketClosed, true, 'the TCP socket is closed before the late body attempt');

  const lateBodyTargetPerfMs = effectiveDeadlineUpperPerfMs + 250;
  await waitUntilPerfAtOrAfter(lateBodyTargetPerfMs);
  lateBodyAttempted = true;
  lateBodyAttemptedAtPerfMs = performance.now();
  lateBodySawClosedResponse = serverResponse.destroyed;
  if (!serverResponse.destroyed) {
    lateBodyDelivered = true;
    serverResponse.end(eventHtml());
  }
  resolveLateBodyAttempt();

  await lateBodyAttempt;
  assert.equal(lateBodyAttempted, true, 'the scheduled late body phase actually ran');
  assert.ok(lateBodyAttemptedAtPerfMs >= lateBodyTargetPerfMs,
    'the late body phase begins no earlier than 250ms after the upper bound of the effective original deadline');
  assert.equal(lateBodySawClosedResponse, true, 'the response was already closed at the late body phase');
  assert.equal(lateBodyDelivered, false, 'a late body cannot reach the closed client');
  assert.ok(responseClosedAtPerfMs < lateBodyAttemptedAtPerfMs);
  assert.ok(socketClosedAtPerfMs < lateBodyAttemptedAtPerfMs);
  const snapshotAfterLateBody = await h.frontier.getSnapshot(h.scope, runId);
  assert.equal(snapshotAfterLateBody.deadlineAtMs, persistedDeadlineAtMs);
  assert.deepEqual(
    snapshotAfterLateBody.candidates.map(({ candidateId, state, admittedAttemptCount }) => ({ candidateId, state, admittedAttemptCount })),
    snapshotBeforeLateBody.candidates.map(({ candidateId, state, admittedAttemptCount }) => ({ candidateId, state, admittedAttemptCount })),
    'the late server callback cannot complete or otherwise change the unresolved candidate',
  );
  assert.deepEqual(
    snapshotAfterLateBody.stopReasons.map((entry) => entry.reason).sort(),
    snapshotBeforeLateBody.stopReasons.map((entry) => entry.reason).sort(),
  );
  const transportAfterLateBody = await h.frontier.getTransportProgress(h.scope, runId);
  assert.equal(transportAfterLateBody.reservedBytes, transportBeforeLateBody.reservedBytes);
  assert.equal(transportAfterLateBody.spentBytes, transportBeforeLateBody.spentBytes);
  assert.deepEqual(transportAfterLateBody.states, transportBeforeLateBody.states);
  t.diagnostic(JSON.stringify({
    runEntryPerfBeforeMs,
    runEntryPerfAfterMs,
    runEntryBracketWidthMs: runEntryPerfAfterMs - runEntryPerfBeforeMs,
    persistedDeadlineLowerPerfMs,
    persistedDeadlineUpperPerfMs,
    persistedDeadlineMappedWidthMs: persistedDeadlineUpperPerfMs - persistedDeadlineLowerPerfMs,
    effectiveDeadlineLowerPerfMs,
    effectiveDeadlineUpperPerfMs,
    effectiveDeadlineIntervalWidthMs: effectiveDeadlineUpperPerfMs - effectiveDeadlineLowerPerfMs,
    persistedDeadlineAtMs,
    requestReceivedAtPerfMs,
    remainingAtRequestMs,
    tcpConnectionCount,
    requestCount,
    responseClosedAtPerfMs,
    socketClosedAtPerfMs,
    lateBodyAttemptedAtPerfMs,
    lateBodyDelivered,
    deadlineReturnLagFromUpperMs,
    reservedBytesAfterLateBody: transportAfterLateBody.reservedBytes,
    spentBytesAfterLateBody: transportAfterLateBody.spentBytes,
    statesAfterLateBody: transportAfterLateBody.states,
  }));
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
    'lookupFact', 'beginPrivateRunReceipt', 'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
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
  let persistedDeadlineAtMs;
  let releaseSealCompletedAtMs;
  let releaseSealState;
  let sealWrapperReturnedAtMs;
  let sealReturnGateWaitMs;
  let finalMaterializationEnteredAtMs;
  let finalEntryRemainingAtMs;
  const store = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'ingestEvidence', 'appendFact', 'ingestDerivedPdfEvidence', 'ingestAssetSourceEvidence',
    'lookupEvidence', 'lookupFact', 'beginPrivateRunReceipt', 'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
  ]) store[name] = h.evidenceStore[name].bind(h.evidenceStore);
  store.materializeSelected = async (...args) => {
    materializeCalls += 1;
    if (materializeCalls < 3) return h.evidenceStore.materializeSelected(...args);
    assert.ok(releaseSealCompletedAtMs <= Date.now() && ['sealed', 'already_sealed'].includes(releaseSealState),
      'the final selected materialization follows a successful durable release seal');
    assert.ok(Number.isSafeInteger(persistedDeadlineAtMs), 'the real frontier run persisted its original deadline');
    finalMaterializationEnteredAtMs = Date.now();
    finalEntryRemainingAtMs = persistedDeadlineAtMs - finalMaterializationEnteredAtMs;
    assert.ok(finalEntryRemainingAtMs > 0, 'the sealed final materialization is entered before the original deadline');
    materializationStarted();
    return new Promise(() => {});
  };
  const startedAt = Date.now();
  const frontier = frontierWithMethodOverrides(h.frontier, {
    createRun: async (...args) => {
      const created = await h.frontier.createRun(...args);
      persistedDeadlineAtMs = created.deadlineAtMs;
      return created;
    },
    sealPrivateDraft: async (...args) => {
      const sealed = await h.frontier.sealPrivateDraft(...args);
      releaseSealState = sealed.state;
      releaseSealCompletedAtMs = Date.now();
      const gateUntilMs = persistedDeadlineAtMs - 1_400;
      const waitMs = Math.max(0, gateUntilMs - Date.now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      sealReturnGateWaitMs = Date.now() - releaseSealCompletedAtMs;
      sealWrapperReturnedAtMs = Date.now();
      return sealed;
    },
  });
  const running = runPrivateRetrieval(h.makeInput({
    runId,
    server,
    store,
    frontier,
    seeds: [{ url: sourceUrl('/event') }],
    limits: { maxTransportAttemptAdmissions: 1, maxDepth: 0, durationMs: 5_000 },
  }));
  const runOutcome = running.then(
    (result) => ({ kind: 'returned', result }),
    (error) => ({ kind: 'rejected', error }),
  );
  const phase = await Promise.race([
    finalMaterializationStarted.then(() => ({ kind: 'final-materialization-started' })),
    runOutcome,
  ]);
  if (phase.kind !== 'final-materialization-started') {
    const outcome = phase.kind === 'returned'
      ? JSON.stringify({ status: phase.result.status, limitations: phase.result.limitations })
      : String(phase.error);
    const phases = JSON.stringify({
      persistedDeadlineAtMs,
      releaseSealState,
      releaseSealCompletedAtMs,
      sealWrapperReturnedAtMs,
      sealReturnGateWaitMs,
      finalMaterializationEnteredAtMs,
      finalEntryRemainingAtMs,
    });
    assert.fail(`run ended before stalled final materialization; calls=${materializeCalls}; elapsedMs=${Date.now() - startedAt}; phases=${phases}; outcome=${outcome}`);
  }
  assert.ok(Number.isSafeInteger(persistedDeadlineAtMs));
  assert.ok(releaseSealCompletedAtMs <= sealWrapperReturnedAtMs && sealWrapperReturnedAtMs <= finalMaterializationEnteredAtMs,
    'both real materializations and the durable release seal finish before the final call enters');
  assert.ok(['sealed', 'already_sealed'].includes(releaseSealState));
  assert.ok(finalEntryRemainingAtMs > 0 && finalEntryRemainingAtMs <= 1_500,
    'the actual final materialization is entered with a measured, bounded portion of the original persisted deadline remaining');
  const sealReturnRemainingAtMs = persistedDeadlineAtMs - sealWrapperReturnedAtMs;
  assert.ok(sealReturnRemainingAtMs > 0 && sealReturnRemainingAtMs <= 1_500,
    'the real seal wrapper returns only after the original deadline gate opens');
  assert.ok(sealReturnGateWaitMs >= 0);
  const result = await running;
  const finalEntryWaitMs = Date.now() - finalMaterializationEnteredAtMs;
  assert.ok(finalEntryWaitMs < 2_000, 'the final-release phase remains covered after watcher drain');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.draft, null);
  assert.ok(result.limitations.includes('deadline_exceeded'));
  assert.equal(materializeCalls, 3);
  const snapshot = await h.frontier.getSnapshot(h.scope, runId);
  assert.equal(snapshot.deadlineAtMs, persistedDeadlineAtMs, 'the stored deadline was not reset by phase synchronization');
  assert.ok(snapshot.stopReasons.some((entry) => entry.reason === 'deadline'));
  t.diagnostic(JSON.stringify({
    persistedDeadlineAtMs,
    releaseSealState,
    sealReturnGateWaitMs,
    sealReturnRemainingAtMs,
    finalEntryRemainingAtMs,
    finalEntryWaitMs,
    wholeRunElapsedMs: Date.now() - startedAt,
  }));
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
    'lookupFact', 'materializeSelected', 'beginPrivateRunReceipt', 'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
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
    'lookupEvidence', 'lookupFact', 'beginPrivateRunReceipt', 'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
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
    'beginPrivateRunReceipt', 'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
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
    'beginPrivateRunReceipt', 'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
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
