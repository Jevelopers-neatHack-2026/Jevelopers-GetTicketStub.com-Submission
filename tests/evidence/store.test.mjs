import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { createEvidenceStore, EvidenceStoreError } from '../../src/evidence/store.mjs';
import { createProvenancePort } from '../../src/verification/provenance/index.mjs';

const EPOCH = Date.parse('2026-10-10T15:00:00.000Z');

function request(tenantId, allowPrivate = true) {
  return Object.freeze({ principal: Object.freeze({ tenantId }), allowPrivate });
}

function mutableRequest(tenantId, allowPrivate = true) {
  return { principal: { tenantId }, allowPrivate };
}

function createHarness(t, overrides = {}, clock = { value: EPOCH }) {
  const { factRetentionMs, factPolicyIdForCall, ...storeOverrides } = overrides;
  const permits = new WeakMap();
  let factPolicyCall = 0;
  const sourceText = 'Event: Moon Night\nDate: 2027-06-20\nVenue: Civic Hall';
  const createPermit = (tenantId, durationMs = 10_000) => {
    const handle = Object.freeze(Object.create(null));
    permits.set(handle, { tenantId, expiresAtMs: clock.value + durationMs });
    return handle;
  };
  const root = mkdtemp(path.join(os.tmpdir(), 'ei-evidence-test-'));
  const ready = root.then((directory) => {
    t.after(() => rm(directory, { recursive: true, force: true }));
    const options = {
      directory,
      resolveTenant: (authenticatedRequest) => authenticatedRequest?.principal?.tenantId,
      resolveKey({ tenantId, purpose, keyId }) {
        const selectedId = `${purpose}-v1`;
        if (keyId && keyId !== selectedId) throw new Error('KEY-CANARY-DO-NOT-LOG');
        return { keyId: selectedId, key: createHash('sha256').update(`${tenantId}:${purpose}:synthetic-test-key`).digest() };
      },
      resolveRetention({ tenantId, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
        let expiresAtMs = sourceExpiresAtMs;
        if (kind === 'evidence') {
          const permit = permits.get(retentionHandle);
          if (!permit || permit.tenantId !== tenantId) throw new Error('RETENTION-CANARY-DO-NOT-LOG');
          expiresAtMs = permit.expiresAtMs;
        } else if (Number.isSafeInteger(factRetentionMs)) {
          expiresAtMs = nowMs + factRetentionMs;
        }
        return {
          expiresAtMs: expiresAtMs ?? nowMs + (factRetentionMs ?? 5_000),
          policyId: kind === 'fact' && typeof factPolicyIdForCall === 'function'
            ? factPolicyIdForCall(factPolicyCall++)
            : 'synthetic-private-source',
          policyVersion: '1',
          accessPolicy: 'tenant_private',
        };
      },
      authorizePrivateAccess({ tenantId, request: authenticatedRequest }) {
        return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
      },
      authorizePrivateAccessCurrent({ tenantId, request: authenticatedRequest }) {
        return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
      },
      consumePrivatePayload({ source, positions }) {
        return {
          sourceUrl: source.sourceUrl,
          sourceHash: source.contentHash,
          snapshots: positions.map((position) => position.content.toString('utf8')),
        };
      },
      now: () => clock.value,
      maxSourceBytes: 1024 * 1024,
      maxPositionBytes: 64 * 1024,
      maxPositionCount: 16,
      maxStoredPayloadBytes: 128 * 1024,
      maxRetentionMs: 60_000,
      ...storeOverrides,
    };
    const openStore = () => createEvidenceStore(options);
    const store = openStore();
    const store2 = openStore();
    return { directory, store, store2, openStore, clock, createPermit, sourceText };
  });
  return ready;
}

function createKeyGate() {
  let activeGate = null;
  return {
    arm(purpose, invocation = 1) {
      let signalReached;
      let signalRelease;
      const reached = new Promise((resolve) => { signalReached = resolve; });
      const blocked = new Promise((resolve) => { signalRelease = resolve; });
      activeGate = { purpose, invocation, seen: 0, reached, blocked, signalReached, signalRelease };
      return { reached, release: () => signalRelease() };
    },
    async resolve({ tenantId, purpose, keyId }) {
      const gate = activeGate;
      if (gate && gate.purpose === purpose) {
        gate.seen += 1;
        if (gate.seen === gate.invocation) {
          activeGate = null;
          gate.signalReached();
          await gate.blocked;
        }
      }
      const selectedId = `${purpose}-v1`;
      if (keyId && keyId !== selectedId) throw new Error('KEY-CANARY-DO-NOT-LOG');
      return { keyId: selectedId, key: createHash('sha256').update(`${tenantId}:${purpose}:synthetic-test-key`).digest() };
    },
  };
}

function createRetentionGate() {
  let signalStarted;
  let resolveResult;
  let signalSettled;
  const entered = new Promise((resolve) => { signalStarted = resolve; });
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const settled = new Promise((resolve) => { signalSettled = resolve; });
  return {
    entered,
    settled,
    release(value) { resolveResult(value); },
    invoke() {
      signalStarted();
      return result.then((value) => {
        signalSettled();
        return value;
      });
    },
  };
}

function inspectTenantDatabase(directory, tenantId = 'tenant-a') {
  const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
  const database = new DatabaseSync(path.join(directory, tenantHash, 'evidence.sqlite'));
  try {
    const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash);
    const bundleCount = database.prepare('SELECT COUNT(*) AS count FROM sealed_bundles').get().count;
    return { bundleCount, manifest: row ? JSON.parse(row.document) : null };
  } finally {
    database.close();
  }
}

function updateSealedBundle(directory, id, bytes, tenantId = 'tenant-a', kind = 'evidence') {
  const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
  const database = new DatabaseSync(path.join(directory, tenantHash, 'evidence.sqlite'));
  try {
    database.prepare('UPDATE sealed_bundles SET sealed = ? WHERE kind = ? AND id = ?').run(bytes, kind, id);
  } finally {
    database.close();
  }
}

function padSealedBundleTo(directory, id, targetBytes) {
  const tenantHash = createHash('sha256').update('event-intelligence:tenant:v1:tenant-a').digest('hex');
  const database = new DatabaseSync(path.join(directory, tenantHash, 'evidence.sqlite'));
  try {
    const row = database.prepare("SELECT sealed FROM sealed_bundles WHERE kind = 'evidence' AND id = ?").get(id);
    assert.ok(row);
    assert.ok(row.sealed.byteLength <= targetBytes);
    const padded = Buffer.concat([Buffer.from(row.sealed), Buffer.alloc(targetBytes - row.sealed.byteLength, 0x20)]);
    database.prepare("UPDATE sealed_bundles SET sealed = ? WHERE kind = 'evidence' AND id = ?").run(padded, id);
    return padded;
  } finally {
    database.close();
  }
}

function encryptSyntheticFact(tenantId, factId, payload) {
  const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
  const key = createHash('sha256').update(`${tenantId}:fact:synthetic-test-key`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`event-intelligence:evidence:v1:${tenantHash}:fact:${factId}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.from(JSON.stringify({
    version: 1,
    keyId: 'fact-v1',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }), 'utf8');
}

function assertOnlyTombstoneFields(records) {
  for (const record of Object.values(records)) {
    if (record.state === 'expired') assert.deepEqual(Object.keys(record).sort(), ['id', 'state']);
  }
}

function assertExpiredDiskState(state, expectedEvidence = 1, expectedFacts = 1) {
  assert.ok(state.manifest);
  const evidence = Object.values(state.manifest.records);
  const facts = Object.values(state.manifest.facts);
  assert.equal(evidence.filter((record) => record.state === 'expired').length, expectedEvidence);
  assert.equal(facts.filter((fact) => fact.state === 'expired').length, expectedFacts);
  assertOnlyTombstoneFields(state.manifest.records);
  assertOnlyTombstoneFields(state.manifest.facts);
  assert.equal(state.bundleCount, 0);
}

async function assertTombstonesAfterReopen(harness, evidenceId, factId) {
  const reopened = harness.openStore();
  const scope = await reopened.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await reopened.lookupEvidence(scope, evidenceId);
  const metadata = await reopened.getEvidenceMetadata(scope, evidence);
  assert.deepEqual(Object.keys(metadata).sort(), ['evidenceId', 'positionCount', 'state']);
  assert.equal(metadata.state, 'expired');
  const fact = await reopened.lookupFact(scope, factId);
  await assert.rejects(reopened.readFact(scope, fact, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  const afterReopen = inspectTenantDatabase(harness.directory);
  assertExpiredDiskState(afterReopen);
}

function sourceInput(source, {
  sourceUrl = 'https://events.example.test/night?ticket=SOURCE-URL-CANARY',
  canonicalUrl = 'https://events.example.test/night',
  sourceKind = 'external',
  retrievedAt = '2026-10-10T14:59:59.000Z',
  retentionHandle,
  contentType = 'text/plain',
} = {}) {
  const positionText = source.match(/Event: ([^\n]+)/)?.[1] ?? source;
  const startByte = Buffer.byteLength(source.slice(0, source.indexOf(positionText)), 'utf8');
  const endByte = startByte + Buffer.byteLength(positionText, 'utf8');
  return {
    sourceUrl,
    canonicalUrl,
    redirectChain: ['https://events.example.test/old-night'],
    content: source,
    contentType,
    retrievedAt,
    sourceKind,
    retentionHandle,
    positions: [{ locator: { kind: 'text-range', startByte, endByte }, content: positionText }],
  };
}

function supportFor(result) {
  return { evidence: result.evidence, position: result.positions[0], contentHash: result.metadata.contentHash };
}

async function ingest(store, scope, source, createPermit, options = {}) {
  const permit = options.retentionHandle ?? createPermit(options.tenantId ?? 'tenant-a', options.durationMs);
  return store.ingestEvidence(scope, sourceInput(source, { ...options, retentionHandle: permit }));
}

async function allFiles(directory) {
  const result = [];
  async function visit(target) {
    let entries = [];
    try { entries = await readdir(target, { withFileTypes: true }); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const fullPath = path.join(target, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) result.push(fullPath);
    }
  }
  await visit(directory);
  return result;
}

async function waitForPath(filePath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await access(filePath); return; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
  }
  throw new Error('worker did not reach its synchronization point');
}

function runWorker(directory, mode, markerPath, barrierPath) {
  const workerPath = new URL('./sqlite-worker.mjs', import.meta.url);
  const child = spawn(process.execPath, [workerPath.pathname, mode, directory, markerPath, barrierPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const exit = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, exit };
}

async function terminateWorker(worker) {
  if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
  await worker.exit;
}

test('stores tenant-private evidence encrypted and reopens evidence and fact handles after restart', async (t) => {
  const { directory, store, clock, createPermit, sourceText } = await createHarness(t);
  const scope = await store.scopeForAuthenticatedRequest(request('tenant-a'));
  const ingested = await ingest(store, scope, sourceText, createPermit);
  assert.equal(ingested.created, true);
  assert.equal(Object.isFrozen(ingested.metadata), true);
  assert.equal(Object.isFrozen(ingested.evidence), true);
  assert.equal(Reflect.set(ingested.metadata, 'state', 'expired'), false);
  assert.equal(ingested.metadata.state, 'available');
  assert.match(ingested.metadata.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(ingested.metadata.accessPolicy, 'tenant_private');
  assert.equal(ingested.metadata.positionCount, 1);

  const factHandle = await store.appendFact(scope, {
    field: 'event_name',
    status: 'sourced',
    rawValue: 'Moon Night',
    normalizedValue: 'Moon Night',
    supports: [supportFor(ingested)],
  }, request('tenant-a'));
  const fact = await store.readFact(scope, factHandle, request('tenant-a'));
  assert.equal(fact.status, 'sourced');
  assert.equal(fact.rawValue, 'Moon Night');
  assert.equal(fact.normalizedValue, 'Moon Night');
  assert.equal(fact.supports.every((support) => support.independence === 'unknown'), true);
  assert.equal(Object.hasOwn(fact, 'independentSupportCount'), false);

  const files = await allFiles(directory);
  const persistedText = (await Promise.all(files.map((file) => readFile(file)))).map((bytes) => bytes.toString('utf8')).join('\n');
  assert.equal(persistedText.includes('SOURCE-URL-CANARY'), false, 'source URLs remain inside encrypted payloads');
  assert.equal(persistedText.includes('Event: Moon Night'), false, 'the fetched source and excerpt are encrypted');
  assert.equal(persistedText.includes('Moon Night'), false, 'raw and normalized fact values are encrypted');
  assert.equal(persistedText.includes('ticket='), false);

  const restarted = createEvidenceStore({
    directory,
    resolveTenant: (authenticatedRequest) => authenticatedRequest?.principal?.tenantId,
    resolveKey({ tenantId, purpose, keyId }) {
      const selectedId = `${purpose}-v1`;
      if (keyId && keyId !== selectedId) throw new Error('KEY-CANARY-DO-NOT-LOG');
      return { keyId: selectedId, key: createHash('sha256').update(`${tenantId}:${purpose}:synthetic-test-key`).digest() };
    },
    resolveRetention({ nowMs, sourceExpiresAtMs }) {
      return { expiresAtMs: sourceExpiresAtMs ?? nowMs + 5_000, policyId: 'synthetic-private-source', policyVersion: '1', accessPolicy: 'tenant_private' };
    },
    authorizePrivateAccess: ({ tenantId, request: auth }) => auth?.principal?.tenantId === tenantId && auth.allowPrivate === true,
    authorizePrivateAccessCurrent: ({ tenantId, request: auth }) => auth?.principal?.tenantId === tenantId && auth.allowPrivate === true,
    consumePrivatePayload: ({ source, positions }) => ({ sourceUrl: source.sourceUrl, snapshots: positions.map((position) => position.content.toString('utf8')) }),
    now: () => clock.value,
    maxRetentionMs: 60_000,
  });
  const restartedScope = await restarted.scopeForAuthenticatedRequest(request('tenant-a'));
  const reopened = await restarted.lookupEvidence(restartedScope, ingested.metadata.evidenceId);
  const reopenedMetadata = await restarted.getEvidenceMetadata(restartedScope, reopened);
  assert.equal(reopenedMetadata.contentHash, ingested.metadata.contentHash);
  const reopenedFactHandle = await restarted.lookupFact(restartedScope, fact.factId);
  const reopenedFact = await restarted.readFact(restartedScope, reopenedFactHandle, request('tenant-a'));
  assert.equal(reopenedFact.rawValue, 'Moon Night');
  assert.equal(reopenedFact.supports[0].contentHash, ingested.metadata.contentHash);
  const payload = await restarted.withPrivatePayload(restartedScope, reopened, request('tenant-a'));
  assert.equal(payload.sourceUrl, 'https://events.example.test/night?ticket=SOURCE-URL-CANARY');
  assert.deepEqual(payload.snapshots, ['Moon Night']);
});

test('ingestion is idempotent for same source bytes, versions changed bytes, and serializes competing writers', async (t) => {
  const { store, store2, createPermit, sourceText } = await createHarness(t);
  const scope = await store.scopeForAuthenticatedRequest(request('tenant-a'));
  const competingScope = await store2.scopeForAuthenticatedRequest(request('tenant-a'));
  const permit = createPermit('tenant-a');
  const same = await Promise.all([
    store.ingestEvidence(scope, sourceInput(sourceText, { retentionHandle: permit })),
    store2.ingestEvidence(competingScope, sourceInput(sourceText, { retentionHandle: permit })),
  ]);
  assert.equal(same[0].metadata.evidenceId, same[1].metadata.evidenceId);
  assert.deepEqual(same.map((result) => result.created).sort(), [false, true]);

  const changedOne = 'Event: Moon Night Revised\nDate: 2027-06-20\nVenue: Civic Hall';
  const changedTwo = 'Event: Moon Night Final\nDate: 2027-06-20\nVenue: Civic Hall';
  const changes = await Promise.all([
    store.ingestEvidence(scope, sourceInput(changedOne, { retentionHandle: permit })),
    store2.ingestEvidence(competingScope, sourceInput(changedTwo, { retentionHandle: permit })),
  ]);
  assert.deepEqual(changes.map((result) => result.metadata.version).sort(), [2, 3]);
  const latest = changes.find((result) => result.metadata.version === 3);
  assert.equal(latest.metadata.previousEvidenceId, changes.find((result) => result.metadata.version === 2).metadata.evidenceId);
  assert.equal(changes.every((result) => result.metadata.duplicateGroupId !== same[0].metadata.duplicateGroupId), true);
});

test('separate Node processes serialize the first commit and return one immutable version', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ei-evidence-process-race-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const readyA = path.join(directory, 'ready-a');
  const readyB = path.join(directory, 'ready-b');
  const barrier = path.join(directory, 'start');
  const workerA = runWorker(directory, 'ingest', readyA, barrier);
  const workerB = runWorker(directory, 'ingest', readyB, barrier);
  t.after(() => Promise.all([terminateWorker(workerA), terminateWorker(workerB)]));
  await Promise.all([waitForPath(readyA), waitForPath(readyB)]);
  await writeFile(barrier, 'go');
  const [resultA, resultB] = await Promise.all([workerA.exit, workerB.exit]);
  assert.equal(resultA.code, 0, resultA.stderr);
  assert.equal(resultB.code, 0, resultB.stderr);
  const outputA = JSON.parse(resultA.stdout);
  const outputB = JSON.parse(resultB.stdout);
  assert.equal(outputA.evidenceId, outputB.evidenceId);
  assert.deepEqual([outputA.created, outputB.created].sort(), [false, true]);
});

test('SQLite busy transactions never reap a live writer and a killed staged commit leaves no partial evidence', async (t) => {
  const { directory, store, createPermit, sourceText } = await createHarness(t, { lockTimeoutMs: 100 });
  const scope = await store.scopeForAuthenticatedRequest(request('tenant-a'));
  const seed = await ingest(store, scope, sourceText, createPermit);
  const before = await store.integritySnapshot(scope);
  const holdMarker = path.join(directory, 'held-writer');
  const held = runWorker(directory, 'hold-lock', holdMarker, path.join(directory, 'unused-barrier'));
  t.after(() => terminateWorker(held));
  await waitForPath(holdMarker);
  let eventLoopTicks = 0;
  const heartbeat = setInterval(() => { eventLoopTicks += 1; }, 5);
  const startedAt = performance.now();
  await assert.rejects(
    store.ingestEvidence(scope, sourceInput(sourceText, { sourceUrl: 'https://events.example.test/other', retentionHandle: createPermit('tenant-a') })),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_BUSY',
  );
  clearInterval(heartbeat);
  assert.ok(performance.now() - startedAt < 1_000, 'async SQLite lock retry returns near its configured deadline');
  assert.ok(eventLoopTicks >= 2, 'SQLite lock retry leaves the JavaScript event loop responsive');
  await terminateWorker(held);
  const afterKill = await store.integritySnapshot(scope);
  assert.deepEqual(afterKill, before, 'the interrupted writer did not expose a partial record or payload row');
  assert.equal((await store.getEvidenceMetadata(scope, seed.evidence)).state, 'available');

  const stagedMarker = path.join(directory, 'staged-commit');
  const staged = runWorker(directory, 'crash-commit', stagedMarker, path.join(directory, 'unused-barrier'));
  t.after(() => terminateWorker(staged));
  await waitForPath(stagedMarker);
  await terminateWorker(staged);
  const afterCrash = await store.integritySnapshot(scope);
  assert.deepEqual(afterCrash, before, 'ciphertext and metadata staged in one transaction both roll back after SIGKILL');
  const databaseBytes = await readFile((await allFiles(directory)).find((file) => file.endsWith('evidence.sqlite')));
  assert.equal(databaseBytes.toString('utf8').includes('PRIVATE-PAYLOAD-CANARY'), false);
});

test('private receipt writes recheck current authorization after SQLite contention before committing', async (t) => {
  let currentAllowed = true;
  let signalAuthorized;
  const authorized = new Promise((resolve) => { signalAuthorized = resolve; });
  const harness = await createHarness(t, {
    lockTimeoutMs: 2_000,
    authorizePrivateAccessCurrent({ tenantId, request: authenticatedRequest, action }) {
      if (action === 'write_private_run_receipt') {
        if (currentAllowed) signalAuthorized();
        return currentAllowed
          && authenticatedRequest?.principal?.tenantId === tenantId
          && authenticatedRequest.allowPrivate === true;
      }
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  await ingest(harness.store, scope, harness.sourceText, harness.createPermit);

  const marker = path.join(harness.directory, 'receipt-held-writer');
  const held = runWorker(harness.directory, 'hold-lock', marker, path.join(harness.directory, 'unused-barrier'));
  t.after(() => terminateWorker(held));
  await waitForPath(marker);

  const binding = {
    runId: 'receipt-auth-contention',
    configHash: 'a'.repeat(64),
    candidate: {
      candidateId: 'b'.repeat(64),
      canonicalUrl: 'https://events.example.test/receipt-auth-contention',
      depth: 0,
      seed: true,
      sourceRefs: [],
    },
    claim: { claimKey: 'receipt-auth', workerId: 'receipt-auth', leaseToken: randomUUID() },
  };
  let settled = false;
  const pending = harness.store.beginPrivateRunReceipt(scope, binding, request('tenant-a'));
  pending.then(() => { settled = true; }, () => { settled = true; });
  await authorized;
  currentAllowed = false;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(settled, false, 'the separate process still owns the SQLite write lock');
  await terminateWorker(held);
  await assert.rejects(pending,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');

  const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:tenant-a`).digest('hex');
  const database = new DatabaseSync(path.join(harness.directory, tenantHash, 'evidence.sqlite'), { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM private_retrieval_receipts WHERE tenant_hash = ?')
      .get(tenantHash).count, 0, 'revoked current authorization cannot create a pending receipt after lock release');
  } finally {
    database.close();
  }
});

test('expiry cleanup after revocation cannot outlive a cancelled SQLite wait', { timeout: 5_000 }, async (t) => {
  let signalAuthorization;
  const authorizationAttempt = new Promise((resolve) => { signalAuthorization = resolve; });
  let currentAuthorizationCalls = 0;
  const harness = await createHarness(t, {
    lockTimeoutMs: 2_000,
    authorizePrivateAccessCurrent({ tenantId, request: authenticatedRequest, action }) {
      if (action === 'write_private_run_receipt') {
        currentAuthorizationCalls += 1;
        if (currentAuthorizationCalls > 1) {
          signalAuthorization();
          return false;
        }
        return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
      }
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  await harness.store.integritySnapshot(scope);
  const marker = path.join(harness.directory, 'expiry-cleanup-held-writer');
  const held = runWorker(harness.directory, 'hold-lock', marker, path.join(harness.directory, 'unused-barrier'));
  t.after(() => terminateWorker(held));
  await waitForPath(marker);

  const binding = {
    runId: 'receipt-revoked-cleanup-cancel',
    configHash: '1'.repeat(64),
    candidate: {
      candidateId: '2'.repeat(64),
      canonicalUrl: 'https://events.example.test/receipt-revoked-cleanup-cancel',
      depth: 0,
      seed: true,
      sourceRefs: [],
    },
    claim: { claimKey: 'receipt-revoked-cleanup', workerId: 'receipt-revoked-cleanup', leaseToken: randomUUID() },
  };
  const controller = new AbortController();
  let settled = false;
  const pending = harness.store.beginPrivateRunReceipt(scope, binding, request('tenant-a'), controller.signal);
  pending.then(() => { settled = true; }, () => { settled = true; });
  await Promise.race([
    authorizationAttempt,
    new Promise((_, reject) => setTimeout(() => reject(new Error('final current authorization was not reached')), 1_000)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(settled, false, 'the required expiry sweep waits asynchronously behind the external writer');

  const startedAt = performance.now();
  controller.abort();
  await assert.rejects(pending,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_CANCELLED');
  assert.ok(performance.now() - startedAt < 1_000, 'cancellation bounds cleanup without blocking the private call');
  await terminateWorker(held);
  const tenantHash = createHash('sha256').update('event-intelligence:tenant:v1:tenant-a').digest('hex');
  const database = new DatabaseSync(path.join(harness.directory, tenantHash, 'evidence.sqlite'), { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM private_retrieval_receipts WHERE tenant_hash = ?')
      .get(tenantHash).count, 0, 'cancelled cleanup cannot create or finalize a receipt');
  } finally {
    database.close();
  }
});

test('finalizing a missing private receipt cannot create a replayable completion row', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const input = {
    runId: 'receipt-finalize-missing',
    configHash: 'e'.repeat(64),
    candidate: {
      candidateId: 'f'.repeat(64),
      canonicalUrl: 'https://events.example.test/receipt-finalize-missing',
      depth: 0,
      seed: true,
      sourceRefs: [],
    },
    claim: { claimKey: 'receipt-missing', workerId: 'receipt-missing', leaseToken: randomUUID() },
    completion: {
      completionKey: 'receipt-missing-completion',
      outcome: 'failed',
      suggestions: [],
      limitations: [],
      identity: { entityCandidates: [], occurrenceCandidates: [], transitionLinks: [], unresolvedTransitions: [] },
    },
    selection: { evidence: [], facts: [] },
  };
  await assert.rejects(harness.store.finalizePrivateRunReceipt(scope, input, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  const tenantHash = createHash('sha256').update('event-intelligence:tenant:v1:tenant-a').digest('hex');
  const database = new DatabaseSync(path.join(harness.directory, tenantHash, 'evidence.sqlite'), { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM private_retrieval_receipts WHERE tenant_hash = ?')
      .get(tenantHash).count, 0, 'missing receipts cannot mint completion authority');
  } finally {
    database.close();
  }
});

test('guarded receipt begin validates the extension schema before inserting its first row', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  await harness.store.integritySnapshot(scope);
  const tenantHash = createHash('sha256').update('event-intelligence:tenant:v1:tenant-a').digest('hex');
  const databasePath = path.join(harness.directory, tenantHash, 'evidence.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare(`UPDATE evidence_extension_schema SET version = 99
      WHERE extension = 'private-retrieval-receipts'`).run();
  } finally {
    database.close();
  }

  await assert.rejects(harness.store.beginPrivateRunReceipt(scope, {
    runId: 'receipt-invalid-extension-schema',
    configHash: '3'.repeat(64),
    candidate: {
      candidateId: '4'.repeat(64),
      canonicalUrl: 'https://events.example.test/receipt-invalid-extension-schema',
      depth: 0,
      seed: true,
      sourceRefs: [],
    },
    claim: { claimKey: 'receipt-invalid-extension-schema', workerId: 'schema-test', leaseToken: randomUUID() },
  }, request('tenant-a')),
  (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_STORAGE');

  const verify = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(verify.prepare('SELECT version FROM evidence_extension_schema WHERE extension = ?')
      .get('private-retrieval-receipts').version, 99, 'unsupported extension versions are not silently rewritten');
    assert.equal(verify.prepare('SELECT COUNT(*) AS count FROM private_retrieval_receipts WHERE tenant_hash = ?')
      .get(tenantHash).count, 0, 'schema validation precedes the first receipt insertion');
  } finally {
    verify.close();
  }
});

test('private receipt finalization rechecks current authorization after a reentrant current callback releases', async (t) => {
  let currentAllowed = true;
  let holdReceiptAuthorization = false;
  let holdDatabase;
  let signalAuthorization;
  const authorized = new Promise((resolve) => { signalAuthorization = resolve; });
  const harness = await createHarness(t, {
    lockTimeoutMs: 2_000,
    authorizePrivateAccessCurrent({ tenantId, request: authenticatedRequest, action }) {
      if (action === 'write_private_run_receipt' && holdReceiptAuthorization) {
        holdReceiptAuthorization = false;
        const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
        holdDatabase = new DatabaseSync(path.join(harnessDirectory, tenantHash, 'evidence.sqlite'), { timeout: 0 });
        holdDatabase.exec('BEGIN IMMEDIATE');
        signalAuthorization();
      }
      if (action === 'write_private_run_receipt') {
        return currentAllowed
          && authenticatedRequest?.principal?.tenantId === tenantId
          && authenticatedRequest.allowPrivate === true;
      }
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
  });
  const harnessDirectory = harness.directory;
  t.after(() => { try { holdDatabase?.close(); } catch { /* the lock may already be released */ } });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  const binding = {
    runId: 'receipt-finalize-auth-contention',
    configHash: 'c'.repeat(64),
    candidate: {
      candidateId: 'd'.repeat(64),
      canonicalUrl: 'https://events.example.test/receipt-finalize-auth-contention',
      depth: 0,
      seed: true,
      sourceRefs: [],
    },
    claim: { claimKey: 'receipt-finalize-auth', workerId: 'receipt-finalize-auth', leaseToken: randomUUID() },
  };
  assert.deepEqual(await harness.store.beginPrivateRunReceipt(scope, binding, request('tenant-a')),
    { state: 'pending', created: true });

  holdReceiptAuthorization = true;
  let settled = false;
  const pending = harness.store.finalizePrivateRunReceipt(scope, {
    ...binding,
    completion: {
      completionKey: 'receipt-finalize-auth-completion',
      outcome: 'failed',
      suggestions: [],
      limitations: [],
      identity: { entityCandidates: [], occurrenceCandidates: [], transitionLinks: [], unresolvedTransitions: [] },
    },
    selection: { evidence: [evidence.evidence], facts: [] },
  }, request('tenant-a'));
  pending.then(() => { settled = true; }, () => { settled = true; });
  await authorized;
  assert.ok(holdDatabase, 'the synchronous current authorizer can acquire its own SQLite write lock');
  currentAllowed = false;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(settled, false, 'the final receipt update is waiting behind the callback-owned writer lock');
  holdDatabase.exec('ROLLBACK');
  holdDatabase.close();
  holdDatabase = undefined;
  await assert.rejects(pending,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');

  const tenantHash = createHash('sha256').update('event-intelligence:tenant:v1:tenant-a').digest('hex');
  const database = new DatabaseSync(path.join(harness.directory, tenantHash, 'evidence.sqlite'), { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT state FROM private_retrieval_receipts WHERE tenant_hash = ?')
      .get(tenantHash).state, 'pending', 'stale authorization cannot finalize the encrypted receipt');
  } finally {
    database.close();
  }
});

test('fact commits do not use authorization that became stale while waiting for SQLite', { timeout: 5_000 }, async (t) => {
  let currentAllowed = true;
  let holdFactAuthorization = false;
  let holdDatabase;
  let signalAuthorized;
  const authorized = new Promise((resolve) => { signalAuthorized = resolve; });
  const harness = await createHarness(t, {
    lockTimeoutMs: 2_000,
    authorizePrivateAccessCurrent({ tenantId, request: authenticatedRequest, action }) {
      if (action === 'validate_fact_support' && holdFactAuthorization) {
        holdFactAuthorization = false;
        const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
        holdDatabase = new DatabaseSync(path.join(harnessDirectory, tenantHash, 'evidence.sqlite'), { timeout: 0 });
        holdDatabase.exec('BEGIN IMMEDIATE');
        signalAuthorized();
      }
      return currentAllowed
        && authenticatedRequest?.principal?.tenantId === tenantId
        && authenticatedRequest.allowPrivate === true;
    },
  });
  const harnessDirectory = harness.directory;
  t.after(() => { try { holdDatabase?.close(); } catch { /* the lock may already be released */ } });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);

  holdFactAuthorization = true;
  let settled = false;
  const pending = harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night',
    supports: [supportFor(evidence)],
  }, request('tenant-a'));
  pending.then(() => { settled = true; }, () => { settled = true; });
  await Promise.race([
    authorized,
    new Promise((_, reject) => setTimeout(() => reject(new Error('fact current authorization was not reached')), 1_000)),
  ]);
  assert.ok(holdDatabase, 'the synchronous current authorizer can acquire its own SQLite write lock');
  currentAllowed = false;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(settled, false, 'the callback-owned writer lock prevents the final fact transaction');
  holdDatabase.exec('ROLLBACK');
  holdDatabase.close();
  holdDatabase = undefined;
  await assert.rejects(pending,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
  const after = await harness.store.integritySnapshot(scope);
  assert.equal(after.availableEvidence, 1);
  assert.equal(after.availableFacts, 0, 'revoked current authorization cannot append the fact after lock release');
  assert.equal(after.encryptedPayloadRecords, 1);
});

test('rejects a pre-existing database symlink without opening its target', async (t) => {
  const { directory, store } = await createHarness(t);
  const scope = await store.scopeForAuthenticatedRequest(request('tenant-a'));
  const tenantHash = createHash('sha256').update('event-intelligence:tenant:v1:tenant-a').digest('hex');
  const databasePath = path.join(directory, tenantHash, 'evidence.sqlite');
  await store.integritySnapshot(scope);
  const outsidePath = path.join(directory, 'outside.sqlite');
  await writeFile(outsidePath, 'OUTSIDE-DATABASE-CANARY');
  await rm(databasePath);
  await symlink(outsidePath, databasePath);
  await assert.rejects(store.integritySnapshot(scope),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_STORAGE');
  assert.equal((await readFile(outsidePath, 'utf8')), 'OUTSIDE-DATABASE-CANARY');
});

test('AES-GCM binds ciphertext to its tenant, bundle kind, and immutable record ID', async (t) => {
  const { directory, store, createPermit, sourceText } = await createHarness(t);
  const scope = await store.scopeForAuthenticatedRequest(request('tenant-a'));
  const original = await ingest(store, scope, sourceText, createPermit);
  const tenantHash = createHash('sha256').update('event-intelligence:tenant:v1:tenant-a').digest('hex');
  const database = new DatabaseSync(path.join(directory, tenantHash, 'evidence.sqlite'));
  const copyId = randomUUID();
  try {
    database.exec('BEGIN IMMEDIATE');
    const manifestRow = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash);
    const manifest = JSON.parse(manifestRow.document);
    const originalRecord = manifest.records[original.metadata.evidenceId];
    const family = Object.values(manifest.families).find((candidate) => candidate.recordIds.includes(originalRecord.id));
    const sealed = database.prepare('SELECT sealed FROM sealed_bundles WHERE kind = ? AND id = ?').get('evidence', originalRecord.id);
    database.prepare('INSERT INTO sealed_bundles (kind, id, sealed) VALUES (?, ?, ?)').run('evidence', copyId, sealed.sealed);
    manifest.records[copyId] = { ...originalRecord, id: copyId, version: 2, previousId: originalRecord.id };
    family.recordIds.push(copyId);
    family.versionCount = 2;
    database.prepare('UPDATE evidence_manifest SET document = ? WHERE tenant_hash = ?').run(JSON.stringify(manifest), tenantHash);
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* cleanup after the failed integrity fixture */ }
    throw error;
  } finally {
    database.close();
  }
  const copiedHandle = await store.lookupEvidence(scope, copyId);
  await assert.rejects(store.withPrivatePayload(scope, copiedHandle, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INTEGRITY');
});

test('fact support must match an authorized evidence hash and issued source position', async (t) => {
  const { store, createPermit, sourceText } = await createHarness(t);
  const scope = await store.scopeForAuthenticatedRequest(request('tenant-a'));
  const first = await ingest(store, scope, sourceText, createPermit);
  const second = await ingest(store, scope, 'Event: Moon Night\nDate: 2027-06-20\nVenue: Civic Hall', createPermit, {
    sourceUrl: 'https://events.example.test/copy',
    canonicalUrl: 'https://events.example.test/copy',
  });
  const badHash = { ...supportFor(first), contentHash: '0'.repeat(64) };
  await assert.rejects(store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [badHash],
  }, request('tenant-a')), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');

  const crossEvidencePosition = { evidence: first.evidence, position: second.positions[0], contentHash: first.metadata.contentHash };
  await assert.rejects(store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [crossEvidencePosition],
  }, request('tenant-a')), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');

  await assert.rejects(store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [supportFor(first)],
  }, request('tenant-a', false)), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
  await assert.rejects(store.getEvidenceMetadata(await store.scopeForAuthenticatedRequest(request('tenant-b')), first.evidence),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
});

test('date precision, customer input, explicit missing values, and conflicts remain distinct', async (t) => {
  const { store, createPermit, sourceText } = await createHarness(t);
  const scope = await store.scopeForAuthenticatedRequest(request('tenant-a'));
  const external = await ingest(store, scope, sourceText, createPermit);
  const customerText = 'Customer says doors open at 7';
  const customer = await ingest(store, scope, customerText, createPermit, {
    sourceKind: 'customer_supplied',
    sourceUrl: 'https://customer-input.invalid/source',
    canonicalUrl: 'https://customer-input.invalid/source',
  });

  const dateHandle = await store.appendFact(scope, {
    field: 'event_date', status: 'sourced', rawValue: 'June 20, 2027', normalizedValue: '2027-06-20', precision: 'date',
    supports: [supportFor(external)],
  }, request('tenant-a'));
  const customerHandle = await store.appendFact(scope, {
    field: 'doors_open', status: 'customer_supplied', rawValue: '7', normalizedValue: '7:00 PM', precision: 'unknown',
    supports: [supportFor(customer)],
  }, request('tenant-a'));
  const missingHandle = await store.appendFact(scope, { field: 'event_timezone', status: 'missing', reason: 'not_stated' }, request('tenant-a'));

  const venueA = await ingest(store, scope, 'Venue: Civic Hall', createPermit, { sourceUrl: 'https://one.example.test', canonicalUrl: 'https://one.example.test' });
  const venueB = await ingest(store, scope, 'Venue: North Hall', createPermit, { sourceUrl: 'https://two.example.test', canonicalUrl: 'https://two.example.test' });
  const conflictHandle = await store.appendFact(scope, {
    field: 'venue',
    status: 'conflicting',
    candidates: [
      { originStatus: 'sourced', rawValue: 'Civic Hall', normalizedValue: 'Civic Hall', supports: [supportFor(venueA)] },
      { originStatus: 'sourced', rawValue: 'North Hall', normalizedValue: 'North Hall', supports: [supportFor(venueB)] },
    ],
  }, request('tenant-a'));

  assert.equal((await store.readFact(scope, dateHandle, request('tenant-a'))).normalizedValue, '2027-06-20');
  assert.equal((await store.readFact(scope, dateHandle, request('tenant-a'))).precision, 'date', 'date-only normalization has no invented midnight or zone');
  assert.equal((await store.readFact(scope, customerHandle, request('tenant-a'))).status, 'customer_supplied');
  const missing = await store.readFact(scope, missingHandle, request('tenant-a'));
  assert.equal(missing.status, 'missing');
  assert.equal(Object.hasOwn(missing, 'normalizedValue'), false);
  const conflict = await store.readFact(scope, conflictHandle, request('tenant-a'));
  assert.equal(conflict.status, 'conflicting');
  assert.deepEqual(conflict.candidates.map((candidate) => candidate.rawValue), ['Civic Hall', 'North Hall']);
  assert.equal(conflict.candidates.every((candidate) => candidate.supports.every((support) => support.independence === 'unknown')), true);
  assert.equal(conflict.candidates.every((candidate) => !Object.hasOwn(candidate, 'independentSupportCount')), true);
});

test('method-bearing sourced, inferred, and conflicting facts survive private-tree cleanup and restart', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const firstEvidence = await ingest(harness.store, scope, 'Event: First method source', harness.createPermit, {
    sourceUrl: 'https://method-one.example.test/event', canonicalUrl: 'https://method-one.example.test/event',
  });
  const secondEvidence = await ingest(harness.store, scope, 'Event: Second method source', harness.createPermit, {
    sourceUrl: 'https://method-two.example.test/event', canonicalUrl: 'https://method-two.example.test/event',
  });
  const sourcedHandle = await harness.store.appendFact(scope, {
    field: 'event_name',
    status: 'sourced',
    rawValue: { label: 'source', nested: [{ text: 'raw' }] },
    normalizedValue: { label: 'normalized', nested: [{ text: 'clean' }] },
    method: { name: 'source-reader', version: '1' },
    supports: [supportFor(firstEvidence)],
  }, request('tenant-a'));
  const inferredHandle = await harness.store.appendFact(scope, {
    field: 'event_date',
    status: 'inferred',
    rawValue: { date: 'June 20, 2027' },
    normalizedValue: { date: '2027-06-20' },
    method: { name: 'date-normalizer', version: '2' },
    supports: [supportFor(firstEvidence)],
  }, request('tenant-a'));
  const conflictHandle = await harness.store.appendFact(scope, {
    field: 'venue',
    status: 'conflicting',
    candidates: [
      {
        originStatus: 'inferred',
        rawValue: { venue: 'First Hall', details: ['east'] },
        normalizedValue: { venue: 'First Hall' },
        method: { name: 'venue-normalizer', version: '3' },
        supports: [supportFor(firstEvidence)],
      },
      {
        originStatus: 'sourced',
        rawValue: { venue: 'Second Hall' },
        normalizedValue: { venue: 'Second Hall' },
        supports: [supportFor(secondEvidence)],
      },
    ],
  }, request('tenant-a'));

  const sourcedFact = await harness.store.readFact(scope, sourcedHandle, request('tenant-a'));
  const inferredFact = await harness.store.readFact(scope, inferredHandle, request('tenant-a'));
  const conflictFact = await harness.store.readFact(scope, conflictHandle, request('tenant-a'));
  const expectedIds = {
    sourced: sourcedFact.factId,
    inferred: inferredFact.factId,
    conflict: conflictFact.factId,
  };
  const assertMethods = (facts) => {
    const sourced = facts.find((fact) => fact.factId === expectedIds.sourced);
    const inferred = facts.find((fact) => fact.factId === expectedIds.inferred);
    const conflict = facts.find((fact) => fact.factId === expectedIds.conflict);
    assert.deepEqual({ ...sourced.method }, { name: 'source-reader', version: '1' });
    assert.deepEqual({ ...inferred.method }, { name: 'date-normalizer', version: '2' });
    assert.deepEqual({ ...conflict.candidates[0].method }, { name: 'venue-normalizer', version: '3' });
    assert.equal(sourced.rawValue.nested[0].text, 'raw');
    assert.equal(sourced.normalizedValue.nested[0].text, 'clean');
    assert.equal(Object.isFrozen(sourced.method), true);
    assert.equal(Object.isFrozen(conflict.candidates[0].method), true);
    assert.equal(Object.isFrozen(sourced.rawValue.nested[0]), true);
  };

  assertMethods([sourcedFact, inferredFact, conflictFact]);
  assertMethods(await harness.store.listFacts(scope, request('tenant-a')));
  assertMethods((await harness.store.materializeSelected(scope, {
    evidence: [], facts: [sourcedHandle, inferredHandle, conflictHandle],
  }, request('tenant-a'))).facts);

  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request('tenant-a'));
  const reopenedFacts = await Promise.all([
    reopened.lookupFact(reopenedScope, expectedIds.sourced),
    reopened.lookupFact(reopenedScope, expectedIds.inferred),
    reopened.lookupFact(reopenedScope, expectedIds.conflict),
  ]);
  assertMethods([
    await reopened.readFact(reopenedScope, reopenedFacts[0], request('tenant-a')),
    await reopened.readFact(reopenedScope, reopenedFacts[1], request('tenant-a')),
    await reopened.readFact(reopenedScope, reopenedFacts[2], request('tenant-a')),
  ]);
  assertMethods(await reopened.listFacts(reopenedScope, request('tenant-a')));
  assertMethods((await reopened.materializeSelected(reopenedScope, {
    evidence: [], facts: reopenedFacts,
  }, request('tenant-a'))).facts);
});

test('exact and altered syndicated copies do not claim independent support without attribution evidence', async (t) => {
  const { store, createPermit } = await createHarness(t);
  const scope = await store.scopeForAuthenticatedRequest(request('tenant-a'));
  const content = 'Event: Open Data Night';
  const publisherOne = await ingest(store, scope, content, createPermit, { sourceUrl: 'https://publisher-one.example.test/event', canonicalUrl: 'https://publisher-one.example.test/event' });
  const publisherTwo = await ingest(store, scope, content, createPermit, { sourceUrl: 'https://publisher-two.example.test/syndicated', canonicalUrl: 'https://publisher-two.example.test/syndicated' });
  const alteredSyndicatedCopy = await ingest(store, scope, `${content}\nRead more at publisher three`, createPermit, {
    sourceUrl: 'https://publisher-three.example.test/rewritten',
    canonicalUrl: 'https://publisher-three.example.test/rewritten',
  });
  assert.notEqual(publisherOne.metadata.evidenceId, publisherTwo.metadata.evidenceId);
  assert.equal(publisherOne.metadata.duplicateGroupId, publisherTwo.metadata.duplicateGroupId);
  assert.notEqual(publisherOne.metadata.duplicateGroupId, alteredSyndicatedCopy.metadata.duplicateGroupId);
  const factHandle = await store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Open Data Night', normalizedValue: 'Open Data Night',
    supports: [supportFor(publisherOne), supportFor(publisherTwo), supportFor(alteredSyndicatedCopy)],
  }, request('tenant-a'));
  const fact = await store.readFact(scope, factHandle, request('tenant-a'));
  assert.equal(fact.supports.length, 3, 'all source records remain attributable');
  assert.equal(fact.supports.every((support) => support.independence === 'unknown'), true,
    'different byte hashes, URL hosts, and branding do not establish independent origin');
  assert.equal(Object.hasOwn(fact, 'independentSupportCount'), false);
  assert.equal(Object.hasOwn(publisherOne.metadata, 'authority'), false);
});

test('expiry removes encrypted snapshots and fact values, retains a sanitized tombstone, and raises typed expiry', async (t) => {
  const { directory, store, clock, createPermit, sourceText } = await createHarness(t);
  const scope = await store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(store, scope, sourceText, createPermit, { durationMs: 2_000 });
  const factHandle = await store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [supportFor(evidence)],
  }, request('tenant-a'));
  const fact = await store.readFact(scope, factHandle, request('tenant-a'));
  clock.value += 2_000;
  const tombstone = await store.getEvidenceMetadata(scope, evidence.evidence);
  assert.equal(tombstone.state, 'expired');
  assert.equal(tombstone.positionCount, 0);
  assert.deepEqual(Object.keys(tombstone).sort(), ['evidenceId', 'positionCount', 'state']);
  await assert.rejects(store.withPrivatePayload(scope, evidence.evidence, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  await assert.rejects(store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [supportFor(evidence)],
  }, request('tenant-a')), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  const reopenedFact = await store.lookupFact(scope, fact.factId);
  await assert.rejects(store.readFact(scope, reopenedFact, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  const snapshot = await store.integritySnapshot(scope);
  assert.equal(snapshot.expiredEvidence, 1);
  assert.equal(snapshot.expiredFacts, 1);
  assert.equal(snapshot.encryptedPayloadRecords, 0);
  const databaseBytes = await readFile((await allFiles(directory)).find((file) => file.endsWith('evidence.sqlite')));
  const databaseText = databaseBytes.toString('utf8');
  assert.equal(databaseText.includes('SOURCE-URL-CANARY'), false);
  assert.equal(databaseText.includes('Moon Night'), false);
  assert.equal(databaseText.includes('Event: '), false);
  assert.equal((await store.purgeExpired(scope)) >= 0, true);
});

test('selected materialization returns immutable stored provenance and only selected fact values', async (t) => {
  const finalCalls = [];
  const harness = await createHarness(t, {
    authorizePrivateAccessCurrent({ tenantId, request: auth, action, evidenceIds, factIds }) {
      finalCalls.push({ tenantId, action, evidenceIds: [...evidenceIds], factIds: [...factIds] });
      return auth?.principal?.tenantId === tenantId && auth.allowPrivate === true;
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const first = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, {
    sourceUrl: 'https://events.example.test/night?observed=old',
    canonicalUrl: 'https://events.example.test/night',
    contentType: 'text/plain',
    retrievedAt: '2026-10-10T14:59:59.000Z',
  });
  const replay = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, {
    sourceUrl: 'https://events.example.test/night?observed=new',
    canonicalUrl: 'https://events.example.test/night',
    contentType: 'application/ld+json',
    retrievedAt: '2026-10-10T15:00:00.000Z',
  });
  assert.equal(replay.created, false);
  assert.equal(replay.metadata.evidenceId, first.metadata.evidenceId);
  const factHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [supportFor(first)],
  }, request('tenant-a'));
  finalCalls.length = 0;

  const selected = await harness.store.materializeSelected(scope, {
    evidence: [first.evidence],
    facts: [factHandle],
  }, request('tenant-a'));
  const factOnly = await harness.store.materializeSelected(scope, {
    evidence: [],
    facts: [factHandle],
  }, request('tenant-a'));

  assert.equal(selected.evidence.length, 1);
  assert.equal(selected.facts.length, 1);
  assert.equal(factOnly.evidence.length, 1, 'the fact support source is included from persisted linkage');
  assert.equal(factOnly.evidence[0].metadata.evidenceId, first.metadata.evidenceId);
  assert.equal(factOnly.facts[0].factId, selected.facts[0].factId);
  assert.equal(selected.facts[0].rawValue, 'Moon Night');
  assert.equal(selected.evidence[0].source.sourceUrl, 'https://events.example.test/night?observed=old');
  assert.equal(selected.evidence[0].source.contentType, 'text/plain');
  assert.equal(selected.evidence[0].source.sourceKind, 'external');
  assert.equal(selected.evidence[0].source.retrievedAt, '2026-10-10T14:59:59.000Z');
  assert.equal(selected.evidence[0].source.contentHash, first.metadata.contentHash);
  assert.equal(selected.evidence[0].metadata.retrievedAt, first.metadata.retrievedAt);
  assert.notEqual(selected.evidence[0].positions[0].contentHash, first.metadata.contentHash);
  assert.equal(JSON.stringify(selected).includes('Event: Moon Night'), false, 'raw source and excerpt bytes are not returned');
  assert.equal(Object.isFrozen(selected), true);
  assert.deepEqual(finalCalls, [
    {
      tenantId: 'tenant-a',
      action: 'materialize_selected',
      evidenceIds: [first.metadata.evidenceId],
      factIds: [selected.facts[0].factId],
    },
    {
      tenantId: 'tenant-a',
      action: 'materialize_selected',
      evidenceIds: [first.metadata.evidenceId],
      factIds: [selected.facts[0].factId],
    },
  ]);
  await assert.rejects(
    harness.store.materializeSelected(scope, { evidence: Array(9).fill(first.evidence), facts: [] }, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID',
  );
  await assert.rejects(
    harness.store.materializeSelected(scope, { evidence: [], facts: Array(129).fill(factHandle) }, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID',
  );
});

test('selected encrypted-byte budgets accept the exact aggregate ceiling and reject one byte over before key resolution', async (t) => {
  let payloadKeyResolutions = 0;
  const harness = await createHarness(t, {
    resolveKey({ tenantId, purpose, keyId }) {
      const selectedId = `${purpose}-v1`;
      if (purpose === 'payload') payloadKeyResolutions += 1;
      if (keyId && keyId !== selectedId) throw new Error('KEY-CANARY-DO-NOT-LOG');
      return { keyId: selectedId, key: createHash('sha256').update(`${tenantId}:${purpose}:synthetic-test-key`).digest() };
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const first = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, {
    sourceUrl: 'https://events.example.test/sealed-one',
    canonicalUrl: 'https://events.example.test/sealed-one',
  });
  const second = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, {
    sourceUrl: 'https://events.example.test/sealed-two',
    canonicalUrl: 'https://events.example.test/sealed-two',
  });
  const third = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, {
    sourceUrl: 'https://events.example.test/sealed-three',
    canonicalUrl: 'https://events.example.test/sealed-three',
  });
  const exactBundleBytes = 4 * 1024 * 1024;
  padSealedBundleTo(harness.directory, first.metadata.evidenceId, exactBundleBytes);
  padSealedBundleTo(harness.directory, second.metadata.evidenceId, exactBundleBytes);

  const beforeExactRead = payloadKeyResolutions;
  const exact = await harness.store.materializeSelected(scope, {
    evidence: [first.evidence, second.evidence], facts: [],
  }, request('tenant-a'));
  assert.equal(exact.evidence.length, 2);
  assert.equal(payloadKeyResolutions, beforeExactRead + 2);

  const beforeAggregateOver = payloadKeyResolutions;
  await assert.rejects(harness.store.materializeSelected(scope, {
    evidence: [first.evidence, second.evidence, third.evidence], facts: [],
  }, request('tenant-a')), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assert.equal(payloadKeyResolutions, beforeAggregateOver, 'aggregate size is rejected using SQLite length() before copying/decrypting');

  updateSealedBundle(harness.directory, second.metadata.evidenceId,
    Buffer.concat([Buffer.alloc(exactBundleBytes + 1, 0x20)]));
  await assert.rejects(harness.store.materializeSelected(scope, {
    evidence: [second.evidence], facts: [],
  }, request('tenant-a')), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assert.equal(payloadKeyResolutions, beforeAggregateOver, 'per-record cap is checked before key resolution');
});

test('selected position-byte budget accepts one MiB and rejects the next byte without a partial result', async (t) => {
  const harness = await createHarness(t, {
    maxSourceBytes: 2 * 1024 * 1024,
    maxPositionCount: 128,
    maxStoredPayloadBytes: 2 * 1024 * 1024,
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const positionSize = 64 * 1024;
  const source = 'a'.repeat(8 * positionSize);
  const positions = Array.from({ length: 8 }, (_, index) => ({
    locator: { kind: 'text-range', startByte: index * positionSize, endByte: (index + 1) * positionSize },
    content: source.slice(index * positionSize, (index + 1) * positionSize),
  }));
  const ingestSegmented = (suffix) => harness.store.ingestEvidence(scope, {
    sourceUrl: `https://events.example.test/positions-${suffix}`,
    canonicalUrl: `https://events.example.test/positions-${suffix}`,
    content: source,
    contentType: 'text/plain',
    retrievedAt: '2026-10-10T14:59:59.000Z',
    sourceKind: 'external',
    positions,
    retentionHandle: harness.createPermit('tenant-a'),
  });
  const first = await ingestSegmented('first');
  const second = await ingestSegmented('second');
  const exact = await harness.store.materializeSelected(scope, {
    evidence: [first.evidence, second.evidence], facts: [],
  }, request('tenant-a'));
  assert.equal(exact.evidence.reduce((count, item) => count + item.positions.length, 0), 16);

  const tiny = await harness.store.ingestEvidence(scope, {
    sourceUrl: 'https://events.example.test/positions-over',
    canonicalUrl: 'https://events.example.test/positions-over',
    content: 'z',
    contentType: 'text/plain',
    retrievedAt: '2026-10-10T14:59:59.000Z',
    sourceKind: 'external',
    positions: [{ locator: { kind: 'text-range', startByte: 0, endByte: 1 }, content: 'z' }],
    retentionHandle: harness.createPermit('tenant-a'),
  });
  await assert.rejects(harness.store.materializeSelected(scope, {
    evidence: [first.evidence, second.evidence, tiny.evidence], facts: [],
  }, request('tenant-a')), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
});

test('fact plaintext budget accepts its exact per-record ceiling and rejects one byte over before key resolution', async (t) => {
  let factKeyResolutions = 0;
  const harness = await createHarness(t, {
    resolveKey({ tenantId, purpose, keyId }) {
      const selectedId = `${purpose}-v1`;
      if (purpose === 'fact') factKeyResolutions += 1;
      if (keyId && keyId !== selectedId) throw new Error('KEY-CANARY-DO-NOT-LOG');
      return { keyId: selectedId, key: createHash('sha256').update(`${tenantId}:${purpose}:synthetic-test-key`).digest() };
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  const factHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'small', normalizedValue: 'small', supports: [supportFor(evidence)],
  }, request('tenant-a'));
  const factId = (await harness.store.readFact(scope, factHandle, request('tenant-a'))).factId;
  const manifest = inspectTenantDatabase(harness.directory).manifest;
  const record = manifest.facts[factId];
  const evidenceRecord = manifest.records[record.supportEvidenceIds[0]];
  const support = {
    evidenceId: evidenceRecord.id,
    positionId: evidenceRecord.positionIds[0],
    contentHash: evidenceRecord.contentHash,
    sourceKind: 'external',
    duplicateGroupId: evidenceRecord.duplicateGroupId,
  };
  const targetPlaintextBytes = 256 * 1024;
  const payload = {
    field: 'event_name',
    status: 'sourced',
    rawValue: [],
    normalizedValue: 'value',
    supports: [support],
  };
  const fillerStrings = [...Array(65)].map(() => 'a'.repeat(4_000));
  payload.rawValue = [...fillerStrings, ''];
  const bytesWithoutRemainder = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const remainderLength = targetPlaintextBytes - bytesWithoutRemainder;
  assert.ok(remainderLength >= 0 && remainderLength <= 4_000);
  payload.rawValue[65] = 'a'.repeat(remainderLength);
  assert.equal(Buffer.byteLength(JSON.stringify(payload), 'utf8'), targetPlaintextBytes);
  updateSealedBundle(harness.directory, factId, encryptSyntheticFact('tenant-a', factId, payload), 'tenant-a', 'fact');

  const beforeExactFact = factKeyResolutions;
  const exact = await harness.store.readFact(scope, factHandle, request('tenant-a'));
  assert.equal(exact.rawValue.length, 66);
  assert.equal(factKeyResolutions, beforeExactFact + 1);

  payload.rawValue[65] += 'a';
  assert.equal(Buffer.byteLength(JSON.stringify(payload), 'utf8'), targetPlaintextBytes + 1);
  updateSealedBundle(harness.directory, factId, encryptSyntheticFact('tenant-a', factId, payload), 'tenant-a', 'fact');
  const beforeOverLimit = factKeyResolutions;
  await assert.rejects(harness.store.readFact(scope, factHandle, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assert.equal(factKeyResolutions, beforeOverLimit, 'fact bytes are checked from the sealed envelope before key resolution');
});

test('selected provenance byte budget accepts the exact ceiling and rejects an additional source', async (t) => {
  const harness = await createHarness(t, { maxPositionCount: 128 });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const makeUrl = (prefix, length) => {
    assert.ok(prefix.length <= length);
    return prefix + 'x'.repeat(length - prefix.length);
  };
  const longSourceUrl = (index) => makeUrl(`https://events.example.test/source-${index}/`, 4096);
  const longCanonicalUrl = (index) => makeUrl(`https://events.example.test/canonical-${index}/`, 4096);
  const longRedirectPrefix = 'https://redirect.example.test/';
  const tenantHash = createHash('sha256').update('event-intelligence:tenant:v1:tenant-a').digest('hex');
  const sourceHash = createHash('sha256').update('x').digest('hex');
  const duplicateGroupId = createHash('sha256')
    .update(`event-intelligence:duplicate:v1:${tenantHash}:${sourceHash}`).digest('hex');
  const retrievedAt = '2026-10-10T14:59:59.000Z';
  const createdAt = new Date(EPOCH).toISOString();
  const locator = { kind: 'text-range', startByte: 0, endByte: 1 };
  const locatorBytes = Buffer.byteLength(JSON.stringify(locator), 'utf8');
  const fixedProvenanceBytes = Array.from({ length: 6 }, (_, index) => {
    const sourceUrl = longSourceUrl(index);
    const canonicalUrl = longCanonicalUrl(index);
    const recordMetadataBytes = 256 + Buffer.byteLength(
      randomUUID() + sourceHash + duplicateGroupId + retrievedAt + createdAt
        + 'synthetic-private-source' + '1' + 'payload-v1',
      'utf8',
    ) + 36 + 64;
    const sourceDescriptorBytes = 256 + Buffer.byteLength(
      sourceUrl + canonicalUrl + 'text/plain' + 'external' + retrievedAt + sourceHash,
      'utf8',
    );
    return recordMetadataBytes + sourceDescriptorBytes + locatorBytes + 128;
  }).reduce((total, bytes) => total + bytes, 0);
  const exactRedirectBytes = 512 * 1024 - fixedProvenanceBytes;
  assert.ok(exactRedirectBytes > 0 && exactRedirectBytes <= 6 * 20 * 4096);
  let unassignedRedirectBytes = exactRedirectBytes;
  const exactRecords = [];
  for (let index = 0; index < 6; index += 1) {
    const redirectChain = [];
    let thisRecordBytes = Math.min(unassignedRedirectBytes, 20 * 4096);
    while (thisRecordBytes > 0) {
      const length = Math.min(thisRecordBytes, 4096);
      redirectChain.push(makeUrl(longRedirectPrefix, length));
      thisRecordBytes -= length;
      unassignedRedirectBytes -= length;
    }
    const result = await harness.store.ingestEvidence(scope, {
      sourceUrl: longSourceUrl(index),
      canonicalUrl: longCanonicalUrl(index),
      redirectChain,
      content: 'x',
      contentType: 'text/plain',
      retrievedAt,
      sourceKind: 'external',
      positions: [{ locator, content: 'x' }],
      retentionHandle: harness.createPermit('tenant-a'),
    });
    exactRecords.push(result);
  }
  assert.equal(unassignedRedirectBytes, 0);
  const exact = await harness.store.materializeSelected(scope, {
    evidence: exactRecords.map((record) => record.evidence), facts: [],
  }, request('tenant-a'));
  assert.equal(exact.evidence.length, 6);

  const seventh = await harness.store.ingestEvidence(scope, {
    sourceUrl: 'https://events.example.test/provenance-extra',
    canonicalUrl: 'https://events.example.test/provenance-extra',
    content: 'x',
    contentType: 'text/plain',
    retrievedAt,
    sourceKind: 'external',
    positions: [{ locator, content: 'x' }],
    retentionHandle: harness.createPermit('tenant-a'),
  });
  await assert.rejects(harness.store.materializeSelected(scope, {
    evidence: [...exactRecords.map((record) => record.evidence), seventh.evidence], facts: [],
  }, request('tenant-a')), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
});

test('listFacts charges duplicate support references in conflicting candidates before publishing', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const external = await ingest(harness.store, scope, 'Event: External hall', harness.createPermit, {
    sourceUrl: 'https://external-hall.example.test/event',
    canonicalUrl: 'https://external-hall.example.test/event',
  });
  const customer = await ingest(harness.store, scope, 'Customer: 會場甲', harness.createPermit, {
    sourceKind: 'customer_supplied',
    sourceUrl: 'https://customer-hall.invalid/event',
    canonicalUrl: 'https://customer-hall.invalid/event',
  });
  const externalSupport = supportFor(external);
  const customerSupport = supportFor(customer);
  const conflictHandle = await harness.store.appendFact(scope, {
    field: 'event_venue',
    status: 'conflicting',
    candidates: [
      {
        originStatus: 'inferred',
        rawValue: { value: 'Hall A – 東側' },
        normalizedValue: { value: 'Hall A – east' },
        method: { name: 'venue-normalizer', version: '1' },
        supports: [externalSupport, externalSupport],
      },
      {
        originStatus: 'customer_supplied',
        rawValue: { value: '會場甲' },
        normalizedValue: { value: 'Customer Hall A' },
        supports: [customerSupport, customerSupport],
      },
    ],
  }, request('tenant-a'));

  const facts = await harness.store.listFacts(scope, request('tenant-a'));
  assert.equal(facts.length, 1);
  assert.equal(facts[0].factId, (await harness.store.readFact(scope, conflictHandle, request('tenant-a'))).factId);
  assert.equal(facts[0].candidates[0].supports.length, 2);
  assert.equal(facts[0].candidates[1].supports.length, 2);
  assert.equal(facts[0].candidates[0].rawValue.value, 'Hall A – 東側');
  assert.equal(facts[0].candidates[1].normalizedValue.value, 'Customer Hall A');
});

test('listFacts accepts the exact aggregate provenance ceiling and rejects the next fact as a whole', async (t) => {
  const harness = await createHarness(t, {
    factPolicyIdForCall(index) {
      return index === 21 ? `é${'p'.repeat(51)}` : 'p';
    },
    resolveKey({ tenantId, purpose, keyId }) {
      const selectedId = purpose === 'fact' ? 'f' : `${purpose}-v1`;
      if (keyId && keyId !== selectedId) throw new Error('KEY-CANARY-DO-NOT-LOG');
      return { keyId: selectedId, key: createHash('sha256').update(`${tenantId}:${purpose}:synthetic-test-key`).digest() };
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, 'Event: Exact list budget', harness.createPermit);
  const support = supportFor(evidence);
  // The persisted support uses fixed UUID/hash/source-kind/group fields. Each
  // duplicated reference is charged separately by the public-list budget.
  const persistedSupportBytes = 192 + 36 + 36 + 64 + Buffer.byteLength('external', 'utf8') + 64;
  assert.equal(persistedSupportBytes, 400);

  const factHandles = [];
  for (let index = 0; index < 22; index += 1) {
    const supportCount = index < 20 ? 64 : index === 20 ? 11 : 1;
    factHandles.push(await harness.store.appendFact(scope, {
      field: 'event_name',
      status: 'sourced',
      rawValue: { value: `Event ${index}` },
      normalizedValue: { value: `Event ${index}` },
      supports: Array.from({ length: supportCount }, () => support),
    }, request('tenant-a')));
  }
  const factMetadataBaseBytes = 192 + 36 + Buffer.byteLength('sourcedfp1', 'utf8') + 36 + 64;
  const expectedAggregateBytes = 22 * factMetadataBaseBytes
    + Buffer.byteLength(`é${'p'.repeat(51)}`, 'utf8') - Buffer.byteLength('p', 'utf8')
    + (20 * 64 + 11 + 1) * persistedSupportBytes;
  assert.equal(expectedAggregateBytes, 512 * 1024);
  const exact = await harness.store.listFacts(scope, request('tenant-a'));
  assert.equal(exact.length, 22);
  assert.equal(exact.reduce((sum, fact) => sum + fact.supports.length, 0), 20 * 64 + 11 + 1);

  await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Next', normalizedValue: 'Next', supports: [support],
  }, request('tenant-a'));
  await assert.rejects(harness.store.listFacts(scope, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
});

test('withPrivatePayload expiry rejection commits cleanup before returning the typed error', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, { durationMs: 1_000 });
  const factHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [supportFor(evidence)],
  }, request('tenant-a'));
  const fact = await harness.store.readFact(scope, factHandle, request('tenant-a'));

  harness.clock.value = EPOCH + 1_001;
  await assert.rejects(harness.store.withPrivatePayload(scope, evidence.evidence, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  assertExpiredDiskState(inspectTenantDatabase(harness.directory));
  await assertTombstonesAfterReopen(harness, evidence.metadata.evidenceId, fact.factId);
});

test('listEvidencePositions expiry rejection commits cleanup before returning the typed error', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, { durationMs: 1_000 });

  harness.clock.value = EPOCH + 1_001;
  await assert.rejects(harness.store.listEvidencePositions(scope, evidence.evidence, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  const state = inspectTenantDatabase(harness.directory);
  assertExpiredDiskState(state, 1, 0);
  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request('tenant-a'));
  const reopenedEvidence = await reopened.lookupEvidence(reopenedScope, evidence.metadata.evidenceId);
  assert.equal((await reopened.getEvidenceMetadata(reopenedScope, reopenedEvidence)).state, 'expired');
  assertExpiredDiskState(inspectTenantDatabase(harness.directory), 1, 0);
});

test('readFact expiry rejection commits cleanup before returning the typed error', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, { durationMs: 1_000 });
  const factHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [supportFor(evidence)],
  }, request('tenant-a'));
  const fact = await harness.store.readFact(scope, factHandle, request('tenant-a'));

  harness.clock.value = EPOCH + 1_001;
  await assert.rejects(harness.store.readFact(scope, factHandle, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  assertExpiredDiskState(inspectTenantDatabase(harness.directory));
  await assertTombstonesAfterReopen(harness, evidence.metadata.evidenceId, fact.factId);
});

test('appendFact expiry rejection commits cleanup without retaining an attempted fact', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, { durationMs: 1_000 });
  const factHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [supportFor(evidence)],
  }, request('tenant-a'));
  const fact = await harness.store.readFact(scope, factHandle, request('tenant-a'));

  harness.clock.value = EPOCH + 1_001;
  await assert.rejects(harness.store.appendFact(scope, {
    field: 'another_event_field', status: 'sourced', rawValue: 'Attempted value', normalizedValue: 'Attempted value', supports: [supportFor(evidence)],
  }, request('tenant-a')), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  assertExpiredDiskState(inspectTenantDatabase(harness.directory));
  await assertTombstonesAfterReopen(harness, evidence.metadata.evidenceId, fact.factId);
});

test('failed fact mutation rolls back while a separate expiry sweep commits unrelated cleanup', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const expiredEvidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, { durationMs: 1_000 });
  const expiredFactHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [supportFor(expiredEvidence)],
  }, request('tenant-a'));
  const expiredFact = await harness.store.readFact(scope, expiredFactHandle, request('tenant-a'));
  const liveEvidence = await ingest(harness.store, scope, 'Event: Still Available\nDate: 2027-06-21', harness.createPermit, {
    durationMs: 5_000,
    sourceUrl: 'https://other.example.test/event',
    canonicalUrl: 'https://other.example.test/event',
  });
  const tenantHash = createHash('sha256').update('event-intelligence:tenant:v1:tenant-a').digest('hex');
  const database = new DatabaseSync(path.join(harness.directory, tenantHash, 'evidence.sqlite'));
  try {
    database.exec(`CREATE TRIGGER fail_available_fact_manifest_update
      BEFORE UPDATE OF document ON evidence_manifest
      WHEN instr(NEW.document, '"status":"sourced"') > 0
      BEGIN SELECT RAISE(ABORT, 'synthetic metadata-write failure'); END`);
  } finally {
    database.close();
  }

  harness.clock.value = EPOCH + 1_001;
  await assert.rejects(harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Attempted write', normalizedValue: 'Attempted write',
    supports: [supportFor(liveEvidence)],
  }, request('tenant-a')), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_STORAGE');
  const state = inspectTenantDatabase(harness.directory);
  const expiredRecord = state.manifest.records[expiredEvidence.metadata.evidenceId];
  const liveRecord = state.manifest.records[liveEvidence.metadata.evidenceId];
  assert.equal(expiredRecord.state, 'expired');
  assert.deepEqual(Object.keys(expiredRecord).sort(), ['id', 'state']);
  assert.equal(liveRecord.state, 'available');
  assert.equal(Object.keys(state.manifest.facts).length, 1, 'the failed attempted fact metadata was rolled back');
  assert.equal(state.manifest.facts[expiredFact.factId].state, 'expired');
  assert.deepEqual(Object.keys(state.manifest.facts[expiredFact.factId]).sort(), ['id', 'state']);
  assert.equal(state.bundleCount, 1, 'the staged fact ciphertext rolled back; only live evidence remains');
});

test('fact reads recheck expiry after an asynchronous key resolution and commit cleanup', async (t) => {
  const clock = { value: EPOCH };
  const keyGate = createKeyGate();
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args) }, clock);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, { durationMs: 1_000 });
  const factHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [supportFor(evidence)],
  }, request('tenant-a'));
  const fact = await harness.store.readFact(scope, factHandle, request('tenant-a'));

  const gate = keyGate.arm('fact');
  const pendingRead = harness.store.readFact(scope, factHandle, request('tenant-a'));
  await gate.reached;
  clock.value = EPOCH + 1_000;
  gate.release();
  await assert.rejects(pendingRead,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  assertExpiredDiskState(inspectTenantDatabase(harness.directory));
  await assertTombstonesAfterReopen(harness, evidence.metadata.evidenceId, fact.factId);
});

test('readFact denies a principal switch during the final asynchronous key resolution', async (t) => {
  const keyGate = createKeyGate();
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args) });
  const authRequest = mutableRequest('tenant-a');
  const scope = await harness.store.scopeForAuthenticatedRequest(authRequest);
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  const factHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Private tenant A', normalizedValue: 'Private tenant A', supports: [supportFor(evidence)],
  }, authRequest);

  const gate = keyGate.arm('fact');
  const pending = harness.store.readFact(scope, factHandle, authRequest);
  await gate.reached;
  authRequest.principal.tenantId = 'tenant-b';
  gate.release();
  let returned;
  await pending.then((value) => { returned = value; }, () => {});
  assert.equal(returned, undefined, 'the old tenant fact is never published');
  await assert.rejects(harness.store.readFact(scope, factHandle, authRequest),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
});

test('readFact denies authorization-only revocation during the final asynchronous key resolution', async (t) => {
  const keyGate = createKeyGate();
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args) });
  const authRequest = mutableRequest('tenant-a');
  const scope = await harness.store.scopeForAuthenticatedRequest(authRequest);
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  const factHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Still private', normalizedValue: 'Still private', supports: [supportFor(evidence)],
  }, authRequest);

  const gate = keyGate.arm('fact');
  const pending = harness.store.readFact(scope, factHandle, authRequest);
  await gate.reached;
  authRequest.allowPrivate = false;
  gate.release();
  let returned;
  await pending.then((value) => { returned = value; }, () => {});
  assert.equal(returned, undefined);
  await assert.rejects(harness.store.readFact(scope, factHandle, authRequest),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
});

test('readFact preserves bounded legacy support for more than eight distinct evidence records', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = [];
  for (let index = 0; index < 9; index += 1) {
    evidence.push(await ingest(harness.store, scope, `Event source ${index}`, harness.createPermit, {
      sourceUrl: `https://source-${index}.example.test/event`,
      canonicalUrl: `https://source-${index}.example.test/event`,
    }));
  }
  const factHandle = await harness.store.appendFact(scope, {
    field: 'event_name',
    status: 'sourced',
    rawValue: 'Supported by nine sources',
    normalizedValue: 'Supported by nine sources',
    supports: evidence.map(supportFor),
  }, request('tenant-a'));

  const fact = await harness.store.readFact(scope, factHandle, request('tenant-a'));
  assert.equal(fact.rawValue, 'Supported by nine sources');
  const listed = await harness.store.listFacts(scope, request('tenant-a'));
  assert.equal(listed.length, 1);
  assert.equal(listed[0].supports.length, 9, 'tenant listing keeps its legacy support bound');
  await assert.rejects(
    harness.store.materializeSelected(scope, { evidence: [], facts: [factHandle] }, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID',
    'the composer-facing selected API remains capped at eight evidence records',
  );
});

test('materializeSelected catches request changes during its final async authorization callback', async (t) => {
  let signalEntered;
  let releaseAuthorization;
  const entered = new Promise((resolve) => { signalEntered = resolve; });
  const blocked = new Promise((resolve) => { releaseAuthorization = resolve; });
  const authRequest = mutableRequest('tenant-a');
  const harness = await createHarness(t, {
    authorizePrivateAccess: async ({ tenantId, request: current, action }) => {
      if (action === 'materialize_selected') {
        signalEntered();
        await blocked;
        return tenantId === 'tenant-a';
      }
      return current?.principal?.tenantId === tenantId && current.allowPrivate === true;
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(authRequest);
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  const pending = harness.store.materializeSelected(scope, { evidence: [evidence.evidence], facts: [] }, authRequest);
  await entered;
  authRequest.allowPrivate = false;
  releaseAuthorization();
  let returned;
  await pending.then((value) => { returned = value; }, () => {});
  assert.equal(returned, undefined, 'a stale asynchronous precheck cannot release the source');
});

test('materializeSelected denies a rejected native promise from the synchronous final authorization hook', async (t) => {
  const harness = await createHarness(t, {
    authorizePrivateAccessCurrent: () => Promise.reject(new Error('AUTH-CANARY-DO-NOT-LOG')),
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  await assert.rejects(harness.store.materializeSelected(scope, { evidence: [evidence.evidence], facts: [] }, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED'
      && !error.message.includes('CANARY'));
});

test('private release requires a current synchronous Boolean authorization with no legacy fallback', async (t) => {
  let thenGetterCalls = 0;
  const hostileThenable = Object.defineProperty({}, 'then', {
    get() {
      thenGetterCalls += 1;
      throw new Error('THENABLE-CANARY-DO-NOT-LOG');
    },
  });
  const cases = [
    ['missing final hook', undefined],
    ['false result', () => false],
    ['throwing hook', () => { throw new Error('AUTH-CANARY-DO-NOT-LOG'); }],
    ['non-Boolean result', () => hostileThenable],
  ];
  for (const [label, authorizePrivateAccessCurrent] of cases) {
    const harness = await createHarness(t, { authorizePrivateAccessCurrent });
    const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
    const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
    await assert.rejects(
      harness.store.materializeSelected(scope, { evidence: [evidence.evidence], facts: [] }, request('tenant-a')),
      (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED'
        && !error.message.includes('CANARY'),
      label,
    );
  }
  assert.equal(thenGetterCalls, 0, 'a caller thenable is never assimilated');
});

test('listFacts denies a principal change during final asynchronous key resolution', async (t) => {
  const keyGate = createKeyGate();
  const authRequest = mutableRequest('tenant-a');
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args) });
  const scope = await harness.store.scopeForAuthenticatedRequest(authRequest);
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Private list value', normalizedValue: 'Private list value', supports: [supportFor(evidence)],
  }, authRequest);

  const gate = keyGate.arm('fact');
  const pending = harness.store.listFacts(scope, authRequest);
  await gate.reached;
  authRequest.principal.tenantId = 'tenant-b';
  gate.release();
  let returned;
  await pending.then((value) => { returned = value; }, () => {});
  assert.equal(returned, undefined, 'listFacts never releases a stale private snapshot');
  await assert.rejects(pending,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
});

test('listFacts resolves keys outside the SQLite tenant queue so a trusted key callback can reenter storage', { timeout: 3_000 }, async (t) => {
  let nestedRead = null;
  const resolveKey = async ({ tenantId, purpose, keyId }) => {
    if (nestedRead) {
      const reenter = nestedRead;
      nestedRead = null;
      await reenter();
    }
    const selectedId = `${purpose}-v1`;
    if (keyId && keyId !== selectedId) throw new Error('KEY-CANARY-DO-NOT-LOG');
    return { keyId: selectedId, key: createHash('sha256').update(`${tenantId}:${purpose}:synthetic-test-key`).digest() };
  };
  const harness = await createHarness(t, { resolveKey });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'List value', normalizedValue: 'List value', supports: [supportFor(evidence)],
  }, request('tenant-a'));
  nestedRead = () => harness.store.getEvidenceMetadata(scope, evidence.evidence);

  const result = await harness.store.listFacts(scope, request('tenant-a'));
  assert.equal(result.length, 1);
  assert.equal(result[0].rawValue, 'List value');
  assert.equal(nestedRead, null);
});

test('withPrivatePayload does not return a consumer result if the consumer changes current authorization', async (t) => {
  const authRequest = mutableRequest('tenant-a');
  const harness = await createHarness(t, {
    consumePrivatePayload({ request: current }) {
      current.allowPrivate = false;
      return { privateValue: 'must not reach the caller' };
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(authRequest);
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);

  let returned;
  const pending = harness.store.withPrivatePayload(scope, evidence.evidence, authRequest);
  await pending.then((value) => { returned = value; }, () => {});
  assert.equal(returned, undefined);
  await assert.rejects(pending,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
});

test('withPrivatePayload rejects a custom thenable consumer result without assimilating it', async (t) => {
  let thenCalls = 0;
  const harness = await createHarness(t, {
    consumePrivatePayload: () => ({ then() { thenCalls += 1; } }),
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);

  await assert.rejects(harness.store.withPrivatePayload(scope, evidence.evidence, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
  assert.equal(thenCalls, 0, 'the async API never adopts a consumer-supplied thenable');
});

test('withPrivatePayload returns frozen arrays with standard operations despite hostile inherited then', async (t) => {
  let thenCalls = 0;
  const consumerArray = ['value', { nested: ['second'] }];
  Object.setPrototypeOf(consumerArray, {
    then(resolve) {
      thenCalls += 1;
      return resolve('adopted');
    },
  });
  const harness = await createHarness(t, { consumePrivatePayload: () => consumerArray });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);

  const result = await harness.store.withPrivatePayload(scope, evidence.evidence, request('tenant-a'));
  assert.equal(Array.isArray(result), true);
  assert.equal(result[1].nested[0], 'second');
  assert.equal(typeof result.map, 'function');
  assert.deepEqual([...result].map((value) => typeof value === 'string' ? value : value.nested[0]), ['value', 'second']);
  assert.deepEqual(result.map((value) => typeof value === 'string' ? value : 'nested'), ['value', 'nested']);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result[1]), true);
  assert.equal(Object.isFrozen(result[1].nested), true);
  assert.equal(Object.hasOwn(result, 'then'), true);
  assert.equal(result.then, undefined);
  assert.equal(thenCalls, 0);
});

test('withPrivatePayload denies own array thenables and safely observes rejected native Promises', async (t) => {
  let thenCalls = 0;
  const ownThenArray = ['value'];
  Object.defineProperty(ownThenArray, 'then', {
    value() { thenCalls += 1; },
    enumerable: false,
  });
  const first = await createHarness(t, { consumePrivatePayload: () => ownThenArray });
  const firstScope = await first.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const firstEvidence = await ingest(first.store, firstScope, first.sourceText, first.createPermit);
  await assert.rejects(first.store.withPrivatePayload(firstScope, firstEvidence.evidence, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
  assert.equal(thenCalls, 0);

  const second = await createHarness(t, {
    consumePrivatePayload: () => Promise.reject(new Error('PRIVATE-CONSUMER-CANARY')),
  });
  const secondScope = await second.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const secondEvidence = await ingest(second.store, secondScope, second.sourceText, second.createPermit);
  await assert.rejects(second.store.withPrivatePayload(secondScope, secondEvidence.evidence, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
});

test('selected materialization honors cancellation while a key resolver is pending', async (t) => {
  const keyGate = createKeyGate();
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args) });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  const controller = new AbortController();
  const gate = keyGate.arm('payload');
  const pending = harness.store.materializeSelected(scope, {
    evidence: [evidence.evidence], facts: [],
  }, request('tenant-a'), controller.signal);
  await gate.reached;
  controller.abort();
  gate.release();
  let returned;
  await pending.then((value) => { returned = value; }, () => {});
  assert.equal(returned, undefined, 'aborted preparation never publishes a partial result');
  await assert.rejects(pending,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_CANCELLED');
});

test('selected materialization rejects a shorter-lived earlier fact after a later fact decrypt and commits only tombstones', async (t) => {
  const clock = { value: EPOCH };
  const keyGate = createKeyGate();
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args), factRetentionMs: 5_000 }, clock);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const firstEvidence = await ingest(harness.store, scope, 'Event: First\nDate: 2027-06-20', harness.createPermit, {
    durationMs: 10_000,
    sourceUrl: 'https://first.example.test/event',
    canonicalUrl: 'https://first.example.test/event',
  });
  const firstFact = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'First private value', normalizedValue: 'First', supports: [supportFor(firstEvidence)],
  }, request('tenant-a'));
  const firstFactRecord = await harness.store.readFact(scope, firstFact, request('tenant-a'));

  clock.value = EPOCH + 4_000;
  const secondEvidence = await ingest(harness.store, scope, 'Event: Second\nDate: 2027-06-21', harness.createPermit, {
    durationMs: 10_000,
    sourceUrl: 'https://second.example.test/event',
    canonicalUrl: 'https://second.example.test/event',
  });
  const secondFact = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Second private value', normalizedValue: 'Second', supports: [supportFor(secondEvidence)],
  }, request('tenant-a'));
  const secondFactRecord = await harness.store.readFact(scope, secondFact, request('tenant-a'));

  const gate = keyGate.arm('fact', 2);
  const pending = harness.store.materializeSelected(scope, {
    evidence: [firstEvidence.evidence, secondEvidence.evidence],
    facts: [firstFact, secondFact],
  }, request('tenant-a'));
  await gate.reached;
  clock.value = EPOCH + 5_001;
  gate.release();
  let returned;
  await pending.then((value) => { returned = value; }, () => {});
  assert.equal(returned, undefined, 'an aggregate never returns a partial fact set');
  await assert.rejects(pending,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  const state = inspectTenantDatabase(harness.directory);
  assert.deepEqual(Object.keys(state.manifest.facts[firstFactRecord.factId]).sort(), ['id', 'state']);
  assert.equal(state.manifest.records[firstEvidence.metadata.evidenceId].state, 'available', 'the source outlives its shorter fact');
  assert.equal(state.manifest.facts[secondFactRecord.factId].state, 'available');
  assert.equal(state.bundleCount, 3, 'only the expired fact ciphertext is deleted');
});

test('selected materialization rejects an earlier source expiry during a later source decrypt', async (t) => {
  const clock = { value: EPOCH };
  const keyGate = createKeyGate();
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args) }, clock);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const first = await ingest(harness.store, scope, 'Event: First source', harness.createPermit, {
    durationMs: 1_000, sourceUrl: 'https://first.example.test/source', canonicalUrl: 'https://first.example.test/source',
  });
  const second = await ingest(harness.store, scope, 'Event: Second source', harness.createPermit, {
    durationMs: 10_000, sourceUrl: 'https://second.example.test/source', canonicalUrl: 'https://second.example.test/source',
  });
  const gate = keyGate.arm('payload', 2);
  const pending = harness.store.materializeSelected(scope, { evidence: [first.evidence, second.evidence], facts: [] }, request('tenant-a'));
  await gate.reached;
  clock.value = EPOCH + 1_001;
  gate.release();
  let returned;
  await pending.then((value) => { returned = value; }, () => {});
  assert.equal(returned, undefined);
  await assert.rejects(pending,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  const state = inspectTenantDatabase(harness.directory);
  assert.deepEqual(Object.keys(state.manifest.records[first.metadata.evidenceId]).sort(), ['id', 'state']);
  assert.equal(state.manifest.records[second.metadata.evidenceId].state, 'available');
  assert.equal(state.bundleCount, 1);
});

test('final authorization runs outside SQLite write transactions and persisted state is reread synchronously after it', async (t) => {
  let directory;
  let evidenceId;
  let writeTransactionAcquired = false;
  const harness = await createHarness(t, {
    authorizePrivateAccessCurrent({ tenantId, request: auth, action }) {
      if (action === 'materialize_selected') {
        const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
        const database = new DatabaseSync(path.join(directory, tenantHash, 'evidence.sqlite'), { timeout: 250 });
        try {
          database.exec('BEGIN IMMEDIATE');
          writeTransactionAcquired = true;
          database.exec('ROLLBACK');
        } finally {
          database.close();
        }
      }
      return auth?.principal?.tenantId === tenantId && auth.allowPrivate === true;
    },
  });
  directory = harness.directory;
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  evidenceId = evidence.metadata.evidenceId;
  const selected = await harness.store.materializeSelected(scope, { evidence: [evidence.evidence], facts: [] }, request('tenant-a'));
  assert.equal(selected.evidence.length, 1);
  assert.equal(writeTransactionAcquired, true, 'the final host callback can acquire SQLite write ownership without queue deadlock');
});

test('selected materialization rereads persisted expiry and store time after the final synchronous authorization callback', async (t) => {
  const clock = { value: EPOCH };
  const harness = await createHarness(t, {
    authorizePrivateAccessCurrent({ tenantId, request: auth, action }) {
      if (action === 'materialize_selected') clock.value = EPOCH + 1_000;
      return auth?.principal?.tenantId === tenantId && auth.allowPrivate === true;
    },
  }, clock);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, { durationMs: 1_000 });
  await assert.rejects(harness.store.materializeSelected(scope, { evidence: [evidence.evidence], facts: [] }, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  assertExpiredDiskState(inspectTenantDatabase(harness.directory), 1, 0);
});

test('selected materialization observes a persisted expiry committed during final authorization', async (t) => {
  let directory;
  let evidenceId;
  const harness = await createHarness(t, {
    authorizePrivateAccessCurrent({ tenantId, request: auth, action }) {
      if (action === 'materialize_selected') {
        const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
        const database = new DatabaseSync(path.join(directory, tenantHash, 'evidence.sqlite'));
        try {
          database.exec('BEGIN IMMEDIATE');
          const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash);
          const manifest = JSON.parse(row.document);
          manifest.records[evidenceId] = { id: evidenceId, state: 'expired' };
          database.prepare('UPDATE evidence_manifest SET document = ? WHERE tenant_hash = ?').run(JSON.stringify(manifest), tenantHash);
          database.prepare("DELETE FROM sealed_bundles WHERE kind = 'evidence' AND id = ?").run(evidenceId);
          database.exec('COMMIT');
        } finally {
          database.close();
        }
      }
      return auth?.principal?.tenantId === tenantId && auth.allowPrivate === true;
    },
  });
  directory = harness.directory;
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  evidenceId = evidence.metadata.evidenceId;
  await assert.rejects(harness.store.materializeSelected(scope, { evidence: [evidence.evidence], facts: [] }, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  assertExpiredDiskState(inspectTenantDatabase(harness.directory), 1, 0);
});

test('selected materialization resolves keys outside the tenant write queue so trusted key callbacks can reenter storage', { timeout: 3_000 }, async (t) => {
  let nestedRead = null;
  const resolveKey = async ({ tenantId, purpose, keyId }) => {
    if (nestedRead) {
      const reenter = nestedRead;
      nestedRead = null;
      await reenter();
    }
    const selectedId = `${purpose}-v1`;
    if (keyId && keyId !== selectedId) throw new Error('KEY-CANARY-DO-NOT-LOG');
    return { keyId: selectedId, key: createHash('sha256').update(`${tenantId}:${purpose}:synthetic-test-key`).digest() };
  };
  const harness = await createHarness(t, { resolveKey });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  nestedRead = () => harness.store.getEvidenceMetadata(scope, evidence.evidence);
  const result = await harness.store.materializeSelected(scope, { evidence: [evidence.evidence], facts: [] }, request('tenant-a'));
  assert.equal(result.evidence[0].metadata.contentHash, evidence.metadata.contentHash);
  assert.equal(nestedRead, null);
});

test('listFacts rejects its snapshot if a later decrypt expires an earlier fact', async (t) => {
  const clock = { value: EPOCH };
  const keyGate = createKeyGate();
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args) }, clock);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const firstEvidence = await ingest(harness.store, scope, 'Event: First\nDate: 2027-06-20', harness.createPermit, {
    durationMs: 1_000,
    sourceUrl: 'https://first.example.test/event',
    canonicalUrl: 'https://first.example.test/event',
  });
  const firstFactHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'First', normalizedValue: 'First', supports: [supportFor(firstEvidence)],
  }, request('tenant-a'));
  const firstFact = await harness.store.readFact(scope, firstFactHandle, request('tenant-a'));
  const secondEvidence = await ingest(harness.store, scope, 'Event: Second\nDate: 2027-06-21', harness.createPermit, {
    durationMs: 5_000,
    sourceUrl: 'https://second.example.test/event',
    canonicalUrl: 'https://second.example.test/event',
  });
  const secondFactHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Second', normalizedValue: 'Second', supports: [supportFor(secondEvidence)],
  }, request('tenant-a'));
  const secondFact = await harness.store.readFact(scope, secondFactHandle, request('tenant-a'));

  const gate = keyGate.arm('fact', 2);
  const pendingList = harness.store.listFacts(scope, request('tenant-a'));
  await gate.reached;
  clock.value = EPOCH + 1_001;
  gate.release();
  await assert.rejects(pendingList,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  const state = inspectTenantDatabase(harness.directory);
  assert.equal(state.manifest.records[firstEvidence.metadata.evidenceId].state, 'expired');
  assert.deepEqual(Object.keys(state.manifest.records[firstEvidence.metadata.evidenceId]).sort(), ['id', 'state']);
  assert.equal(state.manifest.records[secondEvidence.metadata.evidenceId].state, 'available');
  assert.equal(state.manifest.facts[firstFact.factId].state, 'expired');
  assert.equal(state.manifest.facts[secondFact.factId].state, 'available');
  assert.equal(state.bundleCount, 2);
  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request('tenant-a'));
  const remaining = await reopened.listFacts(reopenedScope, request('tenant-a'));
  assert.deepEqual(remaining.map((fact) => fact.factId), [secondFact.factId]);
});

test('position reads recheck expiry after asynchronous key resolution and commit cleanup', async (t) => {
  const clock = { value: EPOCH };
  const keyGate = createKeyGate();
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args) }, clock);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, { durationMs: 1_000 });

  const gate = keyGate.arm('payload');
  const pendingPositions = harness.store.listEvidencePositions(scope, evidence.evidence, request('tenant-a'));
  await gate.reached;
  clock.value = EPOCH + 1_000;
  gate.release();
  await assert.rejects(pendingPositions,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  assertExpiredDiskState(inspectTenantDatabase(harness.directory), 1, 0);
  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request('tenant-a'));
  const reopenedEvidence = await reopened.lookupEvidence(reopenedScope, evidence.metadata.evidenceId);
  assert.equal((await reopened.getEvidenceMetadata(reopenedScope, reopenedEvidence)).state, 'expired');
  assertExpiredDiskState(inspectTenantDatabase(harness.directory), 1, 0);
});

test('ingestion does not report an idempotent record after key resolution crosses its expiry', async (t) => {
  const clock = { value: EPOCH };
  const keyGate = createKeyGate();
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args) }, clock);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const permit = harness.createPermit('tenant-a', 1_000);
  const input = sourceInput(harness.sourceText, { retentionHandle: permit });
  const evidence = await harness.store.ingestEvidence(scope, input);

  const gate = keyGate.arm('payload');
  const pendingIngest = harness.store.ingestEvidence(scope, input);
  await gate.reached;
  clock.value = EPOCH + 1_000;
  gate.release();
  await assert.rejects(pendingIngest,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  assertExpiredDiskState(inspectTenantDatabase(harness.directory), 1, 0);
  assert.equal(evidence.created, true);
});

test('new evidence and fact writes roll back if key resolution crosses retention expiry', async (t) => {
  const clock = { value: EPOCH };
  const keyGate = createKeyGate();
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args) }, clock);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const permit = harness.createPermit('tenant-a', 1_000);
  const input = sourceInput(harness.sourceText, { retentionHandle: permit });

  const evidenceGate = keyGate.arm('payload');
  const pendingEvidence = harness.store.ingestEvidence(scope, input);
  await evidenceGate.reached;
  clock.value = EPOCH + 1_000;
  evidenceGate.release();
  await assert.rejects(pendingEvidence,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  const emptyState = inspectTenantDatabase(harness.directory);
  assert.equal(emptyState.bundleCount, 0);
  assert.equal(emptyState.manifest, null, 'the uncommitted evidence manifest was rolled back');

  const freshClock = { value: EPOCH };
  const factKeyGate = createKeyGate();
  const factHarness = await createHarness(t, { resolveKey: (args) => factKeyGate.resolve(args) }, freshClock);
  const factScope = await factHarness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const supportEvidence = await ingest(factHarness.store, factScope, factHarness.sourceText, factHarness.createPermit, { durationMs: 1_000 });
  const factGate = factKeyGate.arm('fact');
  const pendingFact = factHarness.store.appendFact(factScope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night', supports: [supportFor(supportEvidence)],
  }, request('tenant-a'));
  await factGate.reached;
  freshClock.value = EPOCH + 1_000;
  factGate.release();
  await assert.rejects(pendingFact,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  assertExpiredDiskState(inspectTenantDatabase(factHarness.directory), 1, 0);
});

test('raw evidence and fact commits stop on cancellation while retention is pending and owned source copies are wiped', async (t) => {
  let activeRetentionGate;
  const harness = await createHarness(t, {
    resolveRetention({ nowMs, sourceExpiresAtMs }) {
      if (activeRetentionGate) {
        const gate = activeRetentionGate;
        activeRetentionGate = undefined;
        return gate.invoke();
      }
      return {
        expiresAtMs: Math.min(sourceExpiresAtMs ?? nowMs + 5_000, nowMs + 5_000),
        policyId: 'cancel-boundary-test',
        policyVersion: '1',
        accessPolicy: 'tenant_private',
      };
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const sourceBytes = Buffer.from('Event: Cancelled Source\nDate: 2027-06-20');
  const positionBytes = Buffer.from('Cancelled Source');
  const positionStart = sourceBytes.indexOf(positionBytes);
  const callerSource = Buffer.from(sourceBytes);
  const callerPosition = Buffer.from(positionBytes);
  const input = {
    sourceUrl: 'https://events.example.test/cancelled-source',
    canonicalUrl: 'https://events.example.test/cancelled-source',
    redirectChain: [],
    content: sourceBytes,
    contentType: 'text/plain',
    retrievedAt: '2026-10-10T14:59:59.000Z',
    sourceKind: 'external',
    retentionHandle: harness.createPermit('tenant-a'),
    positions: [{
      locator: { kind: 'text-range', startByte: positionStart, endByte: positionStart + positionBytes.length },
      content: positionBytes,
    }],
  };
  const retentionResult = {
    expiresAtMs: EPOCH + 5_000,
    policyId: 'cancel-boundary-test',
    policyVersion: '1',
    accessPolicy: 'tenant_private',
  };
  const gate = createRetentionGate();
  activeRetentionGate = gate;
  const ownedCopies = [];
  const originalBufferFrom = Buffer.from;
  Buffer.from = function capturedBufferFrom(...args) {
    const result = Reflect.apply(originalBufferFrom, this, args);
    if (new Error().stack?.includes('copyBytes (file://')) ownedCopies.push(result);
    return result;
  };
  const controller = new AbortController();
  let pendingEvidence;
  try {
    pendingEvidence = harness.store.ingestEvidence(scope, input, controller.signal);
  } finally {
    Buffer.from = originalBufferFrom;
  }
  await gate.entered;
  controller.abort();
  await assert.rejects(pendingEvidence,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_CANCELLED');
  assert.equal(ownedCopies.length, 2, 'raw source and position each have a separately owned store snapshot');
  assert.ok(ownedCopies.every((buffer) => buffer.every((byte) => byte === 0)),
    'store-owned raw and position snapshots are wiped before the cancelled call returns');
  assert.deepEqual(sourceBytes, callerSource, 'cancellation does not wipe caller-owned source input');
  assert.deepEqual(positionBytes, callerPosition, 'cancellation does not wipe caller-owned position input');
  gate.release(retentionResult);
  await Promise.race([
    gate.settled,
    new Promise((_, reject) => setTimeout(() => reject(new Error('late evidence retention callback did not settle')), 1_000)),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await harness.store.integritySnapshot(scope), {
    availableEvidence: 0, expiredEvidence: 0, availableFacts: 0, expiredFacts: 0, encryptedPayloadRecords: 0,
  }, 'late retention completion cannot commit evidence or fact rows');

  const supportEvidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit, {
    sourceUrl: 'https://events.example.test/fact-support',
    canonicalUrl: 'https://events.example.test/fact-support',
    redirectChain: [],
  });
  const factGate = createRetentionGate();
  activeRetentionGate = factGate;
  const factController = new AbortController();
  const pendingFact = harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Moon Night', normalizedValue: 'Moon Night',
    supports: [supportFor(supportEvidence)],
  }, request('tenant-a'), factController.signal);
  await factGate.entered;
  factController.abort();
  await assert.rejects(pendingFact,
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_CANCELLED');
  factGate.release(retentionResult);
  await Promise.race([
    factGate.settled,
    new Promise((_, reject) => setTimeout(() => reject(new Error('late fact retention callback did not settle')), 1_000)),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  const afterFactCancel = await harness.store.integritySnapshot(scope);
  assert.equal(afterFactCancel.availableEvidence, 1);
  assert.equal(afterFactCancel.availableFacts, 0, 'late retention completion cannot append a private fact');
  assert.equal(afterFactCancel.encryptedPayloadRecords, 1);
});

test('listFacts returns a frozen empty list for a new or rolled-back tenant, including after reopen', async (t) => {
  let failFactKey = false;
  let revokeCurrent = false;
  const authRequest = mutableRequest('tenant-a');
  const harness = await createHarness(t, {
    resolveKey({ tenantId, purpose, keyId }) {
      if (failFactKey && purpose === 'fact') throw new Error('SYNTHETIC-KEY-FAILURE');
      const selectedId = `${purpose}-v1`;
      if (keyId && keyId !== selectedId) throw new Error('KEY-CANARY-DO-NOT-LOG');
      return { keyId: selectedId, key: createHash('sha256').update(`${tenantId}:${purpose}:synthetic-test-key`).digest() };
    },
    authorizePrivateAccess({ tenantId, request: current }) {
      return current?.principal?.tenantId === tenantId && current.allowPrivate === true;
    },
    authorizePrivateAccessCurrent({ tenantId, request: current }) {
      if (revokeCurrent) {
        current.allowPrivate = false;
        return false;
      }
      return current?.principal?.tenantId === tenantId && current.allowPrivate === true;
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(authRequest);
  const port = createProvenancePort(harness.store);

  const initial = await harness.store.listFacts(scope, authRequest);
  assert.deepEqual(initial, []);
  assert.equal(Object.isFrozen(initial), true);
  assert.deepEqual(await port.list(scope, authRequest), []);
  await assert.rejects(harness.store.listFacts(scope, request('tenant-a', false)),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');

  revokeCurrent = true;
  await assert.rejects(harness.store.listFacts(scope, authRequest),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
  revokeCurrent = false;
  authRequest.allowPrivate = true;

  failFactKey = true;
  await assert.rejects(harness.store.appendFact(scope, {
    field: 'event_timezone', status: 'missing', reason: 'not_observed',
  }, authRequest), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_KEY_UNAVAILABLE');
  assert.equal(inspectTenantDatabase(harness.directory).manifest, null, 'the failed first write leaves no manifest');
  failFactKey = false;

  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(authRequest);
  const reopenedPort = createProvenancePort(reopened);
  const afterRollback = await reopened.listFacts(reopenedScope, authRequest);
  assert.deepEqual(afterRollback, []);
  assert.equal(Object.isFrozen(afterRollback), true);
  assert.deepEqual(await reopenedPort.list(reopenedScope, authRequest), []);
});

test('listFacts rejects a manifest that disappears after a nonempty snapshot', async (t) => {
  let directory;
  let deleteManifestAtFinalGate = false;
  const harness = await createHarness(t, {
    authorizePrivateAccessCurrent({ tenantId, request: auth, action }) {
      if (deleteManifestAtFinalGate && action === 'list_facts') {
        const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
        const database = new DatabaseSync(path.join(directory, tenantHash, 'evidence.sqlite'));
        try {
          database.prepare('DELETE FROM evidence_manifest WHERE tenant_hash = ?').run(tenantHash);
        } finally {
          database.close();
        }
      }
      return auth?.principal?.tenantId === tenantId && auth.allowPrivate === true;
    },
  });
  directory = harness.directory;
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  await harness.store.appendFact(scope, {
    field: 'event_timezone', status: 'missing', reason: 'not_observed',
  }, request('tenant-a'));
  deleteManifestAtFinalGate = true;
  await assert.rejects(harness.store.listFacts(scope, request('tenant-a')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INTEGRITY');
  assert.equal(inspectTenantDatabase(harness.directory).manifest, null);
});

test('metadata serializes a cleared predecessor link as null after predecessor expiry', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const first = await ingest(harness.store, scope, 'Event: First Version', harness.createPermit, { durationMs: 1_000 });
  const second = await ingest(harness.store, scope, 'Event: Second Version', harness.createPermit, { durationMs: 5_000 });
  assert.equal(second.metadata.previousEvidenceId, first.metadata.evidenceId);

  harness.clock.value = EPOCH + 1_001;
  const metadata = await harness.store.getEvidenceMetadata(scope, second.evidence);
  assert.equal(metadata.previousEvidenceId, null);
  assert.equal(JSON.parse(JSON.stringify(metadata)).previousEvidenceId, null);
});

test('live successors remain readable after predecessor expiry before and after restart', async (t) => {
  const clock = { value: EPOCH };
  const harness = await createHarness(t, {
    consumePrivatePayload({ metadata, source, positions }) {
      return {
        previousEvidenceId: metadata.previousEvidenceId,
        sourceUrl: source.sourceUrl,
        snapshots: positions.map((position) => position.content.toString('utf8')),
      };
    },
  }, clock);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const predecessor = await ingest(harness.store, scope, 'Event: First retained version', harness.createPermit, {
    durationMs: 1_000,
  });
  const successor = await ingest(harness.store, scope, 'Event: Second retained version', harness.createPermit, {
    durationMs: 5_000,
  });
  const factHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'Second retained version',
    normalizedValue: 'Second retained version', supports: [supportFor(successor)],
  }, request('tenant-a'));
  const initialFact = await harness.store.readFact(scope, factHandle, request('tenant-a'));

  const assertSuccessorReads = async (store, tenantScope, evidenceHandle, currentFactHandle) => {
    const metadata = await store.getEvidenceMetadata(tenantScope, evidenceHandle);
    assert.equal(metadata.state, 'available');
    assert.equal(metadata.previousEvidenceId, null);
    const positions = await store.listEvidencePositions(tenantScope, evidenceHandle, request('tenant-a'));
    assert.equal(positions.length, 1);
    const payload = await store.withPrivatePayload(tenantScope, evidenceHandle, request('tenant-a'));
    assert.equal(payload.previousEvidenceId, null);
    assert.equal(payload.snapshots[0], 'Second retained version');
    const fact = await store.readFact(tenantScope, currentFactHandle, request('tenant-a'));
    assert.equal(fact.rawValue, 'Second retained version');
    const selected = await store.materializeSelected(tenantScope, {
      evidence: [evidenceHandle], facts: [currentFactHandle],
    }, request('tenant-a'));
    assert.equal(selected.evidence[0].metadata.previousEvidenceId, null);
    assert.equal(selected.facts[0].rawValue, 'Second retained version');
  };

  clock.value = EPOCH + 1_001;
  await assertSuccessorReads(harness.store, scope, successor.evidence, factHandle);
  const afterExpiry = inspectTenantDatabase(harness.directory);
  assert.deepEqual(Object.keys(afterExpiry.manifest.records[predecessor.metadata.evidenceId]).sort(), ['id', 'state']);
  assert.equal(afterExpiry.manifest.records[successor.metadata.evidenceId].previousId, undefined);

  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request('tenant-a'));
  const reopenedSuccessor = await reopened.lookupEvidence(reopenedScope, successor.metadata.evidenceId);
  const reopenedFact = await reopened.lookupFact(reopenedScope, initialFact.factId);
  await assertSuccessorReads(reopened, reopenedScope, reopenedSuccessor, reopenedFact);
  const reopenedPredecessor = await reopened.lookupEvidence(reopenedScope, predecessor.metadata.evidenceId);
  assert.equal((await reopened.getEvidenceMetadata(reopenedScope, reopenedPredecessor)).state, 'expired');
});

test('selected reads accept an expiry-driven predecessor unlink during later asynchronous preparation', async (t) => {
  const clock = { value: EPOCH };
  const keyGate = createKeyGate();
  const harness = await createHarness(t, { resolveKey: (args) => keyGate.resolve(args) }, clock);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const predecessor = await ingest(harness.store, scope, 'Event: Old source bytes', harness.createPermit, {
    durationMs: 1_000,
  });
  const successor = await ingest(harness.store, scope, 'Event: New source bytes', harness.createPermit, {
    durationMs: 10_000,
  });
  assert.equal(successor.metadata.previousEvidenceId, predecessor.metadata.evidenceId);
  const factHandle = await harness.store.appendFact(scope, {
    field: 'event_name', status: 'sourced', rawValue: 'New source bytes',
    normalizedValue: 'New source bytes', supports: [supportFor(successor)],
  }, request('tenant-a'));

  const gate = keyGate.arm('fact');
  const pending = harness.store.materializeSelected(scope, {
    evidence: [successor.evidence], facts: [factHandle],
  }, request('tenant-a'));
  await gate.reached;
  clock.value = EPOCH + 1_001;
  const currentMetadata = await harness.store.getEvidenceMetadata(scope, successor.evidence);
  assert.equal(currentMetadata.previousEvidenceId, null, JSON.stringify({
    now: clock.value,
    predecessor: inspectTenantDatabase(harness.directory).manifest.records[predecessor.metadata.evidenceId],
    successor: inspectTenantDatabase(harness.directory).manifest.records[successor.metadata.evidenceId],
  }));
  gate.release();

  const selected = await pending;
  assert.equal(selected.evidence[0].metadata.previousEvidenceId, null);
  assert.equal(selected.facts[0].rawValue, 'New source bytes');
  const state = inspectTenantDatabase(harness.directory);
  assert.deepEqual(Object.keys(state.manifest.records[predecessor.metadata.evidenceId]).sort(), ['id', 'state']);
  assert.equal(state.manifest.records[successor.metadata.evidenceId].previousId, undefined);

  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request('tenant-a'));
  const reopenedFact = await reopened.lookupFact(reopenedScope, selected.facts[0].factId);
  assert.equal((await reopened.readFact(reopenedScope, reopenedFact, request('tenant-a'))).rawValue, 'New source bytes');
});

test('private payload receives current predecessor metadata after asynchronous decryption', async (t) => {
  const clock = { value: EPOCH };
  const keyGate = createKeyGate();
  const harness = await createHarness(t, {
    resolveKey: (args) => keyGate.resolve(args),
    consumePrivatePayload: ({ metadata }) => ({ previousEvidenceId: metadata.previousEvidenceId }),
  }, clock);
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const predecessor = await ingest(harness.store, scope, 'Event: Payload predecessor', harness.createPermit, {
    durationMs: 1_000,
  });
  const successor = await ingest(harness.store, scope, 'Event: Payload successor', harness.createPermit, {
    durationMs: 10_000,
  });
  assert.equal(successor.metadata.previousEvidenceId, predecessor.metadata.evidenceId);

  const gate = keyGate.arm('payload');
  const pending = harness.store.withPrivatePayload(scope, successor.evidence, request('tenant-a'));
  await gate.reached;
  clock.value = EPOCH + 1_001;
  const metadata = await harness.store.getEvidenceMetadata(scope, successor.evidence);
  assert.equal(metadata.previousEvidenceId, null);
  gate.release();
  const consumed = await pending;
  assert.equal(consumed.previousEvidenceId, null);

  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request('tenant-a'));
  const reopenedSuccessor = await reopened.lookupEvidence(reopenedScope, successor.metadata.evidenceId);
  const reopenedConsumed = await reopened.withPrivatePayload(
    reopenedScope, reopenedSuccessor, request('tenant-a'),
  );
  assert.equal(reopenedConsumed.previousEvidenceId, null);
});

test('predecessor normalization does not hide a substantive evidence metadata change', async (t) => {
  let directory;
  let evidenceId;
  const harness = await createHarness(t, {
    authorizePrivateAccessCurrent({ tenantId, request: auth, action }) {
      if (action === 'materialize_selected') {
        const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
        const database = new DatabaseSync(path.join(directory, tenantHash, 'evidence.sqlite'));
        try {
          const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash);
          const manifest = JSON.parse(row.document);
          manifest.records[evidenceId].contentHash = 'f'.repeat(64);
          database.prepare('UPDATE evidence_manifest SET document = ? WHERE tenant_hash = ?').run(JSON.stringify(manifest), tenantHash);
        } finally {
          database.close();
        }
      }
      return auth?.principal?.tenantId === tenantId && auth.allowPrivate === true;
    },
  });
  directory = harness.directory;
  const scope = await harness.store.scopeForAuthenticatedRequest(request('tenant-a'));
  const evidence = await ingest(harness.store, scope, harness.sourceText, harness.createPermit);
  evidenceId = evidence.metadata.evidenceId;
  await assert.rejects(harness.store.materializeSelected(scope, {
    evidence: [evidence.evidence], facts: [],
  }, request('tenant-a')),
  (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INTEGRITY');
});

test('source positions are verified against text ranges and JSON pointers before persistence', async (t) => {
  const { store, createPermit } = await createHarness(t);
  const scope = await store.scopeForAuthenticatedRequest(request('tenant-a'));
  const document = '{"@type":"Event","name":"Moon Night","startDate":"2027-06-20"}';
  const permitted = {
    sourceUrl: 'https://structured.example.test/event',
    canonicalUrl: 'https://structured.example.test/event',
    content: document,
    contentType: 'application/ld+json',
    retrievedAt: '2026-10-10T14:59:59Z',
    sourceKind: 'external',
    retentionHandle: createPermit('tenant-a'),
    positions: [{ locator: { kind: 'json-pointer', pointer: '/name' }, content: '"Moon Night"' }],
  };
  const ingested = await store.ingestEvidence(scope, permitted);
  assert.equal(ingested.created, true);
  await assert.rejects(store.ingestEvidence(scope, {
    ...permitted,
    retentionHandle: createPermit('tenant-a'),
    positions: [{ locator: { kind: 'json-pointer', pointer: '/name' }, content: '"Wrong name"' }],
  }), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  await assert.rejects(store.ingestEvidence(scope, {
    ...permitted,
    sourceUrl: 'https://user:secret@structured.example.test/event',
    retentionHandle: createPermit('tenant-a'),
  }), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
});

test('retrieval timestamps validate calendar, clock, and offset components without changing declared precision', async (t) => {
  const { store, createPermit } = await createHarness(t);
  const scope = await store.scopeForAuthenticatedRequest(request('tenant-a'));
  const invalidValues = [
    '2026-02-30T12:00:00Z',
    '2023-02-29T12:00:00Z',
    '2026-04-31T12:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T23:60:00Z',
    '2026-01-01T23:59:60Z',
    '2026-01-01T12:00:00+23:60',
    '2026-01-01T12:00:00+24:00',
  ];
  for (const retrievedAt of invalidValues) {
    await assert.rejects(
      store.ingestEvidence(scope, sourceInput('Event: Timestamp Check', {
        sourceUrl: `https://timestamp.example.test/${encodeURIComponent(retrievedAt)}`,
        canonicalUrl: `https://timestamp.example.test/${encodeURIComponent(retrievedAt)}`,
        retrievedAt,
        retentionHandle: createPermit('tenant-a'),
      })),
      (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID',
      retrievedAt,
    );
  }

  const declared = '2024-02-29T23:59:59.123456789+05:45';
  const accepted = await store.ingestEvidence(scope, sourceInput('Event: Timestamp Check', {
    sourceUrl: 'https://timestamp.example.test/leap-day',
    canonicalUrl: 'https://timestamp.example.test/leap-day',
    retrievedAt: declared,
    retentionHandle: createPermit('tenant-a'),
  }));
  assert.equal(accepted.metadata.retrievedAt, declared);
  const minutePrecision = await store.ingestEvidence(scope, sourceInput('Event: Timestamp Check', {
    sourceUrl: 'https://timestamp.example.test/minute',
    canonicalUrl: 'https://timestamp.example.test/minute',
    retrievedAt: '2026-06-01T09:30-03:30',
    retentionHandle: createPermit('tenant-a'),
  }));
  assert.equal(minutePrecision.metadata.retrievedAt, '2026-06-01T09:30-03:30');
});
