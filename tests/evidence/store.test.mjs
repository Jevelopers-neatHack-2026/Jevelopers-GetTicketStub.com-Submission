import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { createEvidenceStore, EvidenceStoreError } from '../../src/evidence/store.mjs';

const EPOCH = Date.parse('2026-10-10T15:00:00.000Z');

function request(tenantId, allowPrivate = true) {
  return Object.freeze({ principal: Object.freeze({ tenantId }), allowPrivate });
}

function createHarness(t, overrides = {}) {
  const clock = { value: EPOCH };
  const permits = new WeakMap();
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
        }
        return {
          expiresAtMs: expiresAtMs ?? nowMs + 5_000,
          policyId: 'synthetic-private-source',
          policyVersion: '1',
          accessPolicy: 'tenant_private',
        };
      },
      authorizePrivateAccess({ tenantId, request: authenticatedRequest }) {
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
      ...overrides,
    };
    const store = createEvidenceStore(options);
    const store2 = createEvidenceStore(options);
    return { directory, store, store2, clock, createPermit, sourceText };
  });
  return ready;
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
  const held = runWorker(directory, 'hold-ingest', holdMarker, path.join(directory, 'unused-barrier'));
  t.after(() => terminateWorker(held));
  await waitForPath(holdMarker);
  await assert.rejects(
    store.ingestEvidence(scope, sourceInput(sourceText, { sourceUrl: 'https://events.example.test/other', retentionHandle: createPermit('tenant-a') })),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_BUSY',
  );
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
