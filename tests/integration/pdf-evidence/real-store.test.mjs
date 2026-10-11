import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { EvidenceStoreError } from '../../../src/evidence/store.mjs';
import { composeSourceIdentity, SourceIdentityCompositionError } from '../../../src/discovery/identity/from-extraction.mjs';
import {
  createHarness,
  digest,
  EPOCH,
  FIXTURES,
  padPdfBeforeXref,
  request,
  twoPagePdfWithBlankSecondPage,
} from './store-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function pdfInput(content, permit, overrides = {}) {
  return {
    sourceUrl: 'https://pdf.example.test/calendar.pdf?private=source-url-canary',
    canonicalUrl: 'https://pdf.example.test/calendar.pdf',
    content,
    contentType: 'application/pdf; version=1.7',
    retrievedAt: '2026-10-10T11:00:00.000-04:00',
    sourceKind: 'external',
    retentionHandle: permit,
    ...overrides,
  };
}

function tenantHash(tenantId) {
  return createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
}

function inspectManifest(directory, tenantId = 'tenant-pdf') {
  const database = new DatabaseSync(path.join(directory, tenantHash(tenantId), 'evidence.sqlite'));
  try {
    const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash(tenantId));
    const count = database.prepare('SELECT COUNT(*) AS count FROM sealed_bundles WHERE kind = ?').get('evidence').count;
    const factBundleCount = database.prepare('SELECT COUNT(*) AS count FROM sealed_bundles WHERE kind = ?').get('fact').count;
    const sealedCount = database.prepare('SELECT COUNT(*) AS count FROM sealed_bundles').get().count;
    return { manifest: row ? JSON.parse(row.document) : null, bundleCount: count, factBundleCount, sealedCount };
  } finally {
    database.close();
  }
}

function inspectSealedBundles(directory, tenantId = 'tenant-pdf') {
  const database = new DatabaseSync(path.join(directory, tenantHash(tenantId), 'evidence.sqlite'));
  try {
    return new Map(database.prepare('SELECT kind, id, sealed FROM sealed_bundles ORDER BY kind, id')
      .all().map((row) => [`${row.kind}:${row.id}`, Buffer.from(row.sealed)]));
  } finally {
    database.close();
  }
}

async function loadPinnedLegacyStore(t) {
  const commit = '62dc0e4c1b45cfb78d06a1bd9d2110e23c134650';
  const sourceSha256 = 'aaf123d8bd43615de2212a0372d1ca5a555795f10c1cf8ab8e2912859d393eea';
  const extracted = spawnSync('git', ['show', `${commit}:src/evidence/store.mjs`], {
    cwd: ROOT, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(extracted.status, 0, `pinned legacy source must be available from commit ${commit}`);
  assert.equal(digest(extracted.stdout), sourceSha256, 'legacy implementation source hash must match the pinned blob');
  const modulePath = path.join(os.tmpdir(), `ei-pdf-legacy-store-${process.pid}-${Date.now()}.mjs`);
  await writeFile(modulePath, extracted.stdout, { flag: 'wx', mode: 0o600 });
  t.after(() => rm(modulePath, { force: true }));
  return import(pathToFileURL(modulePath).href);
}

async function filesBelow(directory) {
  const result = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) result.push(target);
    }
  }
  await visit(directory);
  return result;
}

async function waitFor(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('actual isolated PDF observations persist encrypted, reopen, and privately release exact text with complete page provenance', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const multipage = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  const first = await harness.store.ingestDerivedPdfEvidence(scope, pdfInput(multipage, harness.createPermit()), request());
  assert.equal(first.outcome, 'stored');
  assert.equal(first.created, true);
  assert.equal(first.metadata.representation, 'pdf-derived-text');
  assert.equal(first.metadata.contentHash, digest(multipage));
  assert.equal(first.metadata.retrievedAt, '2026-10-10T11:00:00.000-04:00');
  assert.match(first.metadata.derivationDigest, /^[a-f0-9]{64}$/);

  const selected = await harness.store.materializeSelected(scope, { evidence: [first.evidence], facts: [] }, request());
  const metadataOnly = selected.evidence[0];
  assert.equal(metadataOnly.source.contentHash, digest(multipage));
  assert.equal(metadataOnly.source.contentType, 'application/pdf; version=1.7');
  assert.equal(metadataOnly.source.retrievedAt, first.metadata.retrievedAt);
  assert.equal(metadataOnly.source.derivedPdf.requiresInspection, true);
  assert.equal(metadataOnly.source.derivedPdf.completeness, 'incomplete-text-only');
  assert.equal(metadataOnly.source.derivedPdf.pages.length, 2);
  assert.equal(metadataOnly.source.derivedPdf.pages[1].rotation, 90);
  assert.ok(metadataOnly.positions.length > 0);
  assert.ok(metadataOnly.positions.every((position) => position.locator.kind === 'pdf-text-box'));
  assert.equal(JSON.stringify(metadataOnly).includes('Community Night'), false);
  assert.deepEqual(Object.keys(metadataOnly.positions[0].locator).sort(), [
    'coordinateSystem', 'geometry', 'height', 'kind', 'pageHeight', 'pageIndex', 'pageWidth',
    'rotation', 'textIndex', 'width', 'x', 'y',
  ]);
  assert.equal(Object.hasOwn(metadataOnly.positions[0].locator, 'text'), false);
  assert.equal(Object.hasOwn(metadataOnly.positions[0].locator, 'content'), false);
  assert.equal(Object.isFrozen(metadataOnly), true);

  const reopenedStore = harness.openStore();
  const reopenedScope = await reopenedStore.scopeForAuthenticatedRequest(request());
  const reopened = await reopenedStore.lookupEvidence(reopenedScope, first.metadata.evidenceId);
  const privatePayload = await reopenedStore.withPrivatePayload(reopenedScope, reopened, request());
  assert.equal(privatePayload.sourceUrl, 'https://pdf.example.test/calendar.pdf?private=source-url-canary');
  assert.equal(privatePayload.sourceHash, digest(multipage));
  assert.equal(privatePayload.derivedPdf.decoder.version, '6.4.299');
  assert.equal(privatePayload.derivedPdf.bindingVersion, 1);
  assert.ok(privatePayload.positions.some((position) => position.text.includes('Community Night')));
  assert.ok(privatePayload.positions.some((position) => position.text.includes('Saturday, October 17, 2026')));
  assert.ok(privatePayload.positions.every((position) => position.locator.kind === 'pdf-text-box'));

  const callerBytes = Buffer.from(multipage);
  const callerReaderOptions = { maxTextCodeUnits: 50_000, maxOutputBytes: 400_000 };
  const snapshotAttempt = reopenedStore.ingestDerivedPdfEvidence(reopenedScope, pdfInput(callerBytes, harness.createPermit(), {
    sourceUrl: 'https://pdf.example.test/snapshotted-input.pdf',
    canonicalUrl: 'https://pdf.example.test/snapshotted-input.pdf',
    readerOptions: callerReaderOptions,
  }), request());
  callerBytes.fill(0);
  callerReaderOptions.maxTextCodeUnits = 99_999;
  callerReaderOptions.maxOutputBytes = 2_000_000;
  const snapshotted = await snapshotAttempt;
  assert.equal(snapshotted.metadata.contentHash, digest(multipage));
  const snapshottedPrivate = await reopenedStore.withPrivatePayload(reopenedScope, snapshotted.evidence, request());
  assert.equal(snapshottedPrivate.derivedPdf.limits.maxTextCodeUnits, 50_000);
  assert.equal(snapshottedPrivate.derivedPdf.limits.maxOutputBytes, 400_000);
  assert.ok(snapshottedPrivate.positions.some((position) => position.text.includes('Community Night')));

  const replay = await reopenedStore.ingestDerivedPdfEvidence(reopenedScope, pdfInput(multipage, harness.createPermit(), {
    retrievedAt: '2026-10-10T12:30:00Z',
    readerOptions: { timeoutMs: 14_000 },
  }), request());
  assert.equal(replay.outcome, 'stored');
  assert.equal(replay.created, false);
  assert.equal(replay.metadata.evidenceId, first.metadata.evidenceId);
  assert.equal(replay.metadata.retrievedAt, first.metadata.retrievedAt);
  assert.equal(replay.metadata.expiresAt, first.metadata.expiresAt);

  const mixedPages = twoPagePdfWithBlankSecondPage();
  const mixed = await reopenedStore.ingestDerivedPdfEvidence(reopenedScope, pdfInput(mixedPages, harness.createPermit(), {
    sourceUrl: 'https://pdf.example.test/mixed-page-coverage.pdf',
    canonicalUrl: 'https://pdf.example.test/mixed-page-coverage.pdf',
  }), request());
  assert.equal(mixed.outcome, 'stored');
  const mixedSelected = await reopenedStore.materializeSelected(reopenedScope, { evidence: [mixed.evidence], facts: [] }, request());
  assert.deepEqual(mixedSelected.evidence[0].source.derivedPdf.pages.map((page) => page.textBoxCount), [1, 0]);
  assert.equal(mixedSelected.evidence[0].source.derivedPdf.pages[1].textPresence, 'no-embedded-text');
  const mixedPrivate = await reopenedStore.withPrivatePayload(reopenedScope, mixed.evidence, request());
  assert.deepEqual(mixedPrivate.positions.map((position) => position.text), ['Page with text']);

  const unicodeBytes = await readFile(fileURLToPath(new URL('text-rotated-unicode.pdf', FIXTURES)));
  const unicode = await reopenedStore.ingestDerivedPdfEvidence(reopenedScope, pdfInput(unicodeBytes, harness.createPermit(), {
    sourceUrl: 'https://pdf.example.test/unicode.pdf', canonicalUrl: 'https://pdf.example.test/unicode.pdf',
  }), request());
  assert.equal(unicode.outcome, 'stored');
  const unicodePrivate = await reopenedStore.withPrivatePayload(reopenedScope, unicode.evidence, request());
  assert.ok(unicodePrivate.positions.some((position) => position.text.includes('Festival 東京 2027')));
  assert.equal(unicodePrivate.derivedPdf.pages[0].rotation, 90);

  const persisted = await filesBelow(harness.directory);
  const bytesOnDisk = (await Promise.all(persisted.map((file) => readFile(file)))).map((bytes) => bytes.toString('utf8')).join('\n');
  assert.equal(bytesOnDisk.includes('Community Night'), false);
  assert.equal(bytesOnDisk.includes('source-url-canary'), false);
  assert.equal(bytesOnDisk.includes('Festival 東京 2027'), false);
});

test('derived identities are domain-separated from raw evidence and derivation changes create immutable versions across key rotation', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const bytes = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  const permit = harness.createPermit();
  const first = await harness.store.ingestDerivedPdfEvidence(scope, pdfInput(bytes, permit), request());
  assert.equal(first.outcome, 'stored');

  harness.keyState.active['source-index'] = 'source-index-v2';
  const rotatedReplay = await harness.store.ingestDerivedPdfEvidence(scope, pdfInput(bytes, harness.createPermit(), {
    retrievedAt: '2026-10-10T13:00:00Z',
  }), request());
  assert.equal(rotatedReplay.created, false);
  assert.equal(rotatedReplay.metadata.evidenceId, first.metadata.evidenceId);
  assert.equal(rotatedReplay.metadata.retrievedAt, first.metadata.retrievedAt);

  const changedDerivation = await harness.store.ingestDerivedPdfEvidence(scope, pdfInput(bytes, harness.createPermit(), {
    readerOptions: { maxTextCodeUnits: 20_000, maxOutputBytes: 200_000 },
  }), request());
  assert.equal(changedDerivation.created, true);
  assert.equal(changedDerivation.metadata.version, 2);
  assert.equal(changedDerivation.metadata.previousEvidenceId, first.metadata.evidenceId);
  assert.equal(changedDerivation.metadata.contentHash, first.metadata.contentHash);
  assert.equal(changedDerivation.metadata.duplicateGroupId, first.metadata.duplicateGroupId);
  assert.notEqual(changedDerivation.metadata.derivationDigest, first.metadata.derivationDigest);
  const replayOldDerivation = await harness.store.ingestDerivedPdfEvidence(scope, pdfInput(bytes, harness.createPermit()), request());
  assert.equal(replayOldDerivation.created, false);
  assert.equal(replayOldDerivation.metadata.evidenceId, first.metadata.evidenceId);

  const changedBytes = Buffer.concat([bytes, Buffer.from(' ', 'ascii')]);
  const changedSource = await harness.store.ingestDerivedPdfEvidence(scope, pdfInput(changedBytes, harness.createPermit()), request());
  assert.equal(changedSource.created, true);
  assert.equal(changedSource.metadata.version, 3);
  assert.equal(changedSource.metadata.previousEvidenceId, changedDerivation.metadata.evidenceId);
  assert.notEqual(changedSource.metadata.contentHash, first.metadata.contentHash);
  assert.notEqual(changedSource.metadata.duplicateGroupId, first.metadata.duplicateGroupId);
  const changedSourceReplay = await harness.store.ingestDerivedPdfEvidence(scope, pdfInput(changedBytes, harness.createPermit(), {
    retrievedAt: '2026-10-10T13:45:00Z',
  }), request());
  assert.equal(changedSourceReplay.created, false);
  assert.equal(changedSourceReplay.metadata.evidenceId, changedSource.metadata.evidenceId);
  assert.equal(changedSourceReplay.metadata.retrievedAt, changedSource.metadata.retrievedAt);

  const derivedSelection = await harness.store.materializeSelected(scope, { evidence: [first.evidence], facts: [] }, request());
  const selectedDerivedPosition = derivedSelection.evidence[0].positions[0];
  assert.equal(derivedSelection.evidence[0].source.contentHash, first.metadata.contentHash);
  assert.notEqual(selectedDerivedPosition.contentHash, first.metadata.contentHash);
  const privateDerived = await harness.store.withPrivatePayload(scope, first.evidence, request());
  const derivedSupportText = privateDerived.positions[0].text;
  assert.equal(privateDerived.positions[0].contentHash, digest(Buffer.from(derivedSupportText, 'utf8')));
  assert.equal(privateDerived.positions[0].contentHash, selectedDerivedPosition.contentHash);
  assert.notEqual(privateDerived.positions[0].contentHash, first.metadata.contentHash);
  assert.ok(derivedSupportText.length > 0);
  const rawText = 'Raw support remains available';
  const raw = await harness.store.ingestEvidence(scope, {
    sourceUrl: 'https://pdf.example.test/calendar.pdf?private=source-url-canary',
    canonicalUrl: 'https://pdf.example.test/calendar.pdf',
    content: rawText,
    contentType: 'text/plain',
    retrievedAt: '2026-10-10T11:00:00.000-04:00',
    sourceKind: 'external',
    retentionHandle: harness.createPermit(),
    positions: [{ locator: { kind: 'text-range', startByte: 0, endByte: Buffer.byteLength(rawText) }, content: rawText }],
  });
  assert.equal(raw.created, true);
  const rawSupport = { evidence: raw.evidence, position: raw.positions[0], contentHash: raw.metadata.contentHash };
  assert.equal(rawSupport.contentHash, digest(Buffer.from(rawText)));

  const secondRawText = 'Second valid raw support';
  const secondRaw = await harness.store.ingestEvidence(scope, {
    sourceUrl: 'https://pdf.example.test/second-raw-source.txt',
    canonicalUrl: 'https://pdf.example.test/second-raw-source.txt',
    content: secondRawText,
    contentType: 'text/plain',
    retrievedAt: '2026-10-10T11:05:00.000-04:00',
    sourceKind: 'external',
    retentionHandle: harness.createPermit(),
    positions: [{ locator: { kind: 'text-range', startByte: 0, endByte: Buffer.byteLength(secondRawText) }, content: secondRawText }],
  });
  assert.equal(secondRaw.created, true);
  const secondRawSupport = {
    evidence: secondRaw.evidence,
    position: secondRaw.positions[0],
    contentHash: secondRaw.metadata.contentHash,
  };
  assert.equal(secondRawSupport.contentHash, digest(Buffer.from(secondRawText)));

  const persistedCounts = () => {
    const after = inspectManifest(harness.directory);
    return {
      factMetadataCount: Object.keys(after.manifest.facts).length,
      evidenceBundleCount: after.bundleCount,
      factBundleCount: after.factBundleCount,
      sealedBundleCount: after.sealedCount,
    };
  };
  const assertPersistedCountsUnchanged = (expected, description) => {
    assert.deepEqual(persistedCounts(), expected, description);
  };

  const beforeSourcedDerivedAttempt = persistedCounts();
  assert.equal(beforeSourcedDerivedAttempt.factMetadataCount, 0);
  assert.equal(beforeSourcedDerivedAttempt.factBundleCount, 0);
  assert.equal(beforeSourcedDerivedAttempt.evidenceBundleCount, 5);
  assert.equal(beforeSourcedDerivedAttempt.sealedBundleCount, 5);
  await assert.rejects(harness.store.appendFact(scope, {
    field: 'event.name', status: 'sourced', rawValue: derivedSupportText, normalizedValue: derivedSupportText,
    supports: [{ evidence: first.evidence, position: first.positions[0], contentHash: first.metadata.contentHash }],
  }, request()), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assertPersistedCountsUnchanged(beforeSourcedDerivedAttempt, 'sourced derived support adds no fact or bundle rows');

  const reopenedStore = harness.openStore();
  const reopenedScope = await reopenedStore.scopeForAuthenticatedRequest(request());
  const reopenedDerivedLookup = await reopenedStore.lookupEvidence(reopenedScope, first.metadata.evidenceId);
  const reopenedDerivedSelection = await reopenedStore.materializeSelected(
    reopenedScope, { evidence: [reopenedDerivedLookup], facts: [] }, request(),
  );
  const reopenedDerivedEvidence = reopenedDerivedSelection.evidence[0].handle;
  const reopenedDerivedPositions = reopenedDerivedSelection.evidence[0].positions;
  assert.equal(reopenedDerivedPositions.length, first.positions.length);
  assert.equal(reopenedDerivedSelection.evidence[0].source.contentHash, first.metadata.contentHash);
  assert.equal(reopenedDerivedPositions[0].contentHash, selectedDerivedPosition.contentHash);
  assert.notEqual(reopenedDerivedPositions[0].contentHash, first.metadata.contentHash);
  const reopenedRawEvidence = await reopenedStore.lookupEvidence(reopenedScope, raw.metadata.evidenceId);
  const reopenedRawPositions = await reopenedStore.listEvidencePositions(reopenedScope, reopenedRawEvidence, request());
  assert.equal(reopenedRawPositions.length, 1);
  assert.equal(reopenedRawPositions[0].contentHash, raw.metadata.contentHash);
  const reopenedRawSupport = {
    evidence: reopenedRawEvidence,
    position: reopenedRawPositions[0].handle,
    contentHash: raw.metadata.contentHash,
  };
  assert.equal(reopenedRawSupport.contentHash, rawSupport.contentHash);
  const reopenedSecondRawEvidence = await reopenedStore.lookupEvidence(reopenedScope, secondRaw.metadata.evidenceId);
  const reopenedSecondRawPositions = await reopenedStore.listEvidencePositions(reopenedScope, reopenedSecondRawEvidence, request());
  assert.equal(reopenedSecondRawPositions.length, 1);
  assert.equal(reopenedSecondRawPositions[0].contentHash, secondRaw.metadata.contentHash);
  const reopenedSecondRawSupport = {
    evidence: reopenedSecondRawEvidence,
    position: reopenedSecondRawPositions[0].handle,
    contentHash: secondRaw.metadata.contentHash,
  };
  assert.equal(reopenedSecondRawSupport.contentHash, secondRawSupport.contentHash);

  const validRawConflict = await reopenedStore.appendFact(reopenedScope, {
    field: 'event.name',
    status: 'conflicting',
    candidates: [
      {
        originStatus: 'sourced', rawValue: rawText, normalizedValue: rawText,
        supports: [reopenedRawSupport],
      },
      {
        originStatus: 'sourced', rawValue: secondRawText, normalizedValue: secondRawText,
        supports: [reopenedSecondRawSupport],
      },
    ],
  }, request());
  const validRawConflictValue = await reopenedStore.readFact(reopenedScope, validRawConflict, request());
  assert.equal(validRawConflictValue.status, 'conflicting');
  assert.deepEqual(validRawConflictValue.candidates.map((candidate) => candidate.rawValue), [rawText, secondRawText]);
  const beforeConflictingDerivedAttempt = persistedCounts();
  assert.equal(beforeConflictingDerivedAttempt.factMetadataCount, 1);
  assert.equal(beforeConflictingDerivedAttempt.factBundleCount, 1);
  assert.equal(beforeConflictingDerivedAttempt.evidenceBundleCount, 5);
  assert.equal(beforeConflictingDerivedAttempt.sealedBundleCount, 6);

  await assert.rejects(reopenedStore.appendFact(reopenedScope, {
    field: 'event.name',
    status: 'conflicting',
    candidates: [
      {
        originStatus: 'sourced', rawValue: 'Raw support remains available', normalizedValue: 'Raw support remains available',
        supports: [reopenedRawSupport],
      },
      {
        originStatus: 'sourced', rawValue: derivedSupportText, normalizedValue: derivedSupportText,
        supports: [{ evidence: reopenedDerivedEvidence, position: reopenedDerivedPositions[0].handle, contentHash: first.metadata.contentHash }],
      },
    ],
  }, request()), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assertPersistedCountsUnchanged(beforeConflictingDerivedAttempt, 'a derived conflict candidate adds no fact or bundle rows');

  const rawFact = await reopenedStore.appendFact(reopenedScope, {
    field: 'event.name', status: 'sourced', rawValue: rawText, normalizedValue: rawText,
    supports: [reopenedRawSupport],
  }, request());
  assert.equal((await reopenedStore.readFact(reopenedScope, rawFact, request())).rawValue, rawText);

  const { manifest, bundleCount, factBundleCount, sealedCount } = inspectManifest(harness.directory);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(bundleCount, 5);
  assert.equal(factBundleCount, 2, 'valid raw conflict and sourced controls each store one fact bundle');
  assert.equal(sealedCount, 7);
  assert.equal(manifest.records[first.metadata.evidenceId].representation, 'pdf-derived-text');
  assert.equal(manifest.records[raw.metadata.evidenceId].representation, undefined);
  assert.equal(manifest.records[secondRaw.metadata.evidenceId].representation, undefined);
  assert.equal(Object.values(manifest.families).filter((family) => family.representation === 'pdf-derived-text').length, 1);
});

test('pinned v1 store reads existing raw records, survives atomic v2 upgrade, and itself rejects the upgraded schema', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-pdf-derived-v1-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = await loadPinnedLegacyStore(t);
  const permits = new WeakMap();
  const keys = { payload: 'payload-v1', fact: 'fact-v1', 'source-index': 'source-index-v1' };
  const createLegacyPermit = (tenantId = 'tenant-pdf') => {
    const permit = Object.freeze(Object.create(null));
    permits.set(permit, { tenantId, expiresAtMs: EPOCH + 60_000 });
    return permit;
  };
  const legacyOptions = {
    directory: root,
    resolveTenant: (authenticatedRequest) => authenticatedRequest?.principal?.tenantId,
    async resolveKey({ tenantId, purpose, keyId }) {
      const selectedId = keyId ?? keys[purpose];
      return { keyId: selectedId, key: createHash('sha256').update(`${tenantId}:${purpose}:${selectedId}:synthetic`).digest() };
    },
    resolveRetention({ tenantId, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (kind === 'evidence') {
        const permit = permits.get(retentionHandle);
        if (!permit || permit.tenantId !== tenantId) throw new Error('synthetic invalid legacy permit');
        return {
          expiresAtMs: Math.min(permit.expiresAtMs, nowMs + 60_000, sourceExpiresAtMs ?? Number.POSITIVE_INFINITY),
          policyId: 'synthetic-v1-retention', policyVersion: '1', accessPolicy: 'tenant_private',
        };
      }
      return {
        expiresAtMs: sourceExpiresAtMs ?? nowMs + 30_000,
        policyId: 'synthetic-v1-retention', policyVersion: '1', accessPolicy: 'tenant_private',
      };
    },
    async authorizePrivateAccess({ tenantId, request: authenticatedRequest }) {
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
    authorizePrivateAccessCurrent({ tenantId, request: authenticatedRequest }) {
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
    consumePrivatePayload({ source, positions }) {
      return {
        sourceUrl: source.sourceUrl, canonicalUrl: source.canonicalUrl, contentType: source.contentType,
        sourceKind: source.sourceKind, retrievedAt: source.retrievedAt, sourceHash: source.contentHash,
        positions: positions.map((position) => ({ locator: position.locator, contentHash: position.contentHash, text: position.content.toString('utf8') })),
      };
    },
    now: () => EPOCH,
    maxSourceBytes: 5 * 1024 * 1024,
    maxPositionBytes: 64 * 1024,
    maxPositionCount: 128,
    maxStoredPayloadBytes: 512 * 1024,
    maxRetentionMs: 60_000,
    lockTimeoutMs: 5_000,
  };
  const requestValue = request();
  const oldStore = legacy.createEvidenceStore(legacyOptions);
  const oldScope = await oldStore.scopeForAuthenticatedRequest(requestValue);
  const rawText = 'Pinned v1 evidence remains readable after derived migration';
  const oldEvidence = await oldStore.ingestEvidence(oldScope, {
    sourceUrl: 'https://pdf.example.test/legacy-raw.txt',
    canonicalUrl: 'https://pdf.example.test/legacy-raw.txt',
    content: rawText,
    contentType: 'text/plain; charset=utf-8',
    retrievedAt: '2026-10-10T11:00:00.000-04:00',
    sourceKind: 'external',
    retentionHandle: createLegacyPermit(),
    positions: [{ locator: { kind: 'text-range', startByte: 0, endByte: Buffer.byteLength(rawText) }, content: rawText }],
  });
  const oldFact = await oldStore.appendFact(oldScope, {
    field: 'event.name', status: 'sourced', rawValue: rawText, normalizedValue: rawText,
    supports: [{ evidence: oldEvidence.evidence, position: oldEvidence.positions[0], contentHash: digest(Buffer.from(rawText)) }],
  }, requestValue);

  const before = inspectManifest(root);
  assert.equal(before.manifest.schemaVersion, 1);
  const legacyFactId = Object.keys(before.manifest.facts)[0];
  assert.ok(legacyFactId);
  const sealedBefore = inspectSealedBundles(root);
  const legacyEvidenceKey = `evidence:${oldEvidence.metadata.evidenceId}`;
  const legacyFactKey = `fact:${legacyFactId}`;
  assert.ok(sealedBefore.has(legacyEvidenceKey));
  assert.ok(sealedBefore.has(legacyFactKey));

  const harness = await createHarness(t, { storeOptions: { directory: root } });
  const scope = await harness.store.scopeForAuthenticatedRequest(requestValue);
  const reopenedEvidence = await harness.store.lookupEvidence(scope, oldEvidence.metadata.evidenceId);
  const oldPayloadBeforeMigration = await harness.store.withPrivatePayload(scope, reopenedEvidence, requestValue);
  assert.equal(oldPayloadBeforeMigration.positions[0].text, rawText);
  const reopenedFact = await harness.store.lookupFact(scope, legacyFactId);
  const oldFactBeforeMigration = await harness.store.readFact(scope, reopenedFact, requestValue);
  assert.equal(oldFactBeforeMigration.rawValue, rawText);
  assert.equal(oldFactBeforeMigration.normalizedValue, rawText);

  const pdfBytes = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  const migrated = await harness.store.ingestDerivedPdfEvidence(scope, pdfInput(pdfBytes, harness.createPermit(), {
    sourceUrl: 'https://pdf.example.test/legacy-migration.pdf',
    canonicalUrl: 'https://pdf.example.test/legacy-migration.pdf',
  }), requestValue);
  assert.equal(migrated.outcome, 'stored');
  const after = inspectManifest(root);
  assert.equal(after.manifest.schemaVersion, 2);
  assert.deepEqual(after.manifest.records[oldEvidence.metadata.evidenceId], before.manifest.records[oldEvidence.metadata.evidenceId]);
  assert.deepEqual(after.manifest.facts[legacyFactId], before.manifest.facts[legacyFactId]);
  const sealedAfter = inspectSealedBundles(root);
  assert.deepEqual(sealedAfter.get(legacyEvidenceKey), sealedBefore.get(legacyEvidenceKey));
  assert.deepEqual(sealedAfter.get(legacyFactKey), sealedBefore.get(legacyFactKey));

  const reopenedStore = harness.openStore();
  const reopenedScope = await reopenedStore.scopeForAuthenticatedRequest(requestValue);
  const migratedEvidence = await reopenedStore.lookupEvidence(reopenedScope, oldEvidence.metadata.evidenceId);
  assert.equal((await reopenedStore.withPrivatePayload(reopenedScope, migratedEvidence, requestValue)).positions[0].text, rawText);
  const migratedFact = await reopenedStore.lookupFact(reopenedScope, legacyFactId);
  assert.equal((await reopenedStore.readFact(reopenedScope, migratedFact, requestValue)).rawValue, rawText);

  const oldBinaryAfterMigration = legacy.createEvidenceStore(legacyOptions);
  const oldBinaryScope = await oldBinaryAfterMigration.scopeForAuthenticatedRequest(requestValue);
  await assert.rejects(oldBinaryAfterMigration.lookupEvidence(oldBinaryScope, oldEvidence.metadata.evidenceId),
    (error) => error?.code === 'EVIDENCE_INTEGRITY');

  const databasePath = path.join(root, tenantHash('tenant-pdf'), 'evidence.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash('tenant-pdf'));
    const future = JSON.parse(row.document);
    future.schemaVersion = 99;
    database.prepare('UPDATE evidence_manifest SET document = ? WHERE tenant_hash = ?')
      .run(JSON.stringify(future), tenantHash('tenant-pdf'));
  } finally {
    database.close();
  }
  await assert.rejects(reopenedStore.integritySnapshot(reopenedScope), (error) => error?.code === 'EVIDENCE_INTEGRITY');
  assert.ok(oldFact, 'the pinned v1 writer created a real encrypted fact before migration');
});

test('empty text and decoder rejections return typed non-persisted outcomes; cancellation is typed too', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const cases = [
    ['empty.pdf', 'no-text'],
    ['scanned.pdf', 'no-text'],
    ['encrypted.pdf', 'rejected'],
    ['javascript-open-action.pdf', 'rejected'],
    ['remote-goto-action.pdf', 'rejected'],
    ['malformed.pdf', 'rejected'],
  ];
  for (const [name, outcome] of cases) {
    const bytes = await readFile(fileURLToPath(new URL(name, FIXTURES)));
    const result = await harness.store.ingestDerivedPdfEvidence(scope, pdfInput(bytes, harness.createPermit(), {
      sourceUrl: `https://pdf.example.test/rejections/${name}`,
      canonicalUrl: `https://pdf.example.test/rejections/${name}`,
    }), request());
    assert.equal(result.outcome, outcome, name);
    if (outcome === 'no-text') assert.equal(result.requiresInspection, true);
    else assert.equal(typeof result.code, 'string');
  }
  const aborted = new AbortController();
  aborted.abort();
  const validBytes = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  await assert.rejects(harness.store.ingestDerivedPdfEvidence(scope, pdfInput(validBytes, harness.createPermit()), request(), aborted.signal),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_CANCELLED');
  const integrity = await harness.store.integritySnapshot(scope);
  assert.equal(integrity.availableEvidence, 0);
  assert.equal(integrity.encryptedPayloadRecords, 0);

  await assert.rejects(harness.store.ingestDerivedPdfEvidence(scope, pdfInput(validBytes.toString('latin1'), harness.createPermit()), request()),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  const afterStringSource = await harness.store.integritySnapshot(scope);
  assert.equal(afterStringSource.availableEvidence, 0, 'text cannot be silently re-encoded as original PDF bytes');
});

test('derived PDF source and reader-output limits stay fixed when trusted store limits are raised', async (t) => {
  const harness = await createHarness(t, {
    storeOptions: { maxSourceBytes: 12 * 1024 * 1024, maxStoredPayloadBytes: 12 * 1024 * 1024 },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const source = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  const sourceCeiling = 5 * 1024 * 1024;
  const exactSource = padPdfBeforeXref(source, sourceCeiling);
  const atCeiling = await harness.store.ingestDerivedPdfEvidence(scope, pdfInput(exactSource, harness.createPermit(), {
    sourceUrl: 'https://pdf.example.test/exact-source-ceiling.pdf',
    canonicalUrl: 'https://pdf.example.test/exact-source-ceiling.pdf',
  }), request());
  assert.equal(atCeiling.outcome, 'stored');
  assert.equal(atCeiling.metadata.contentHash, digest(exactSource));

  const oversizedSource = padPdfBeforeXref(source, sourceCeiling + 1);
  await assert.rejects(harness.store.ingestDerivedPdfEvidence(scope, pdfInput(oversizedSource, harness.createPermit(), {
    sourceUrl: 'https://pdf.example.test/over-source-ceiling.pdf',
    canonicalUrl: 'https://pdf.example.test/over-source-ceiling.pdf',
  }), request()), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');

  await assert.rejects(harness.store.ingestDerivedPdfEvidence(scope, pdfInput(source, harness.createPermit(), {
    sourceUrl: 'https://pdf.example.test/over-output-ceiling.pdf',
    canonicalUrl: 'https://pdf.example.test/over-output-ceiling.pdf',
    readerOptions: { maxOutputBytes: 2 * 1024 * 1024 + 1 },
  }), request()), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  const integrity = await harness.store.integritySnapshot(scope);
  assert.equal(integrity.availableEvidence, 1);
  assert.equal(integrity.encryptedPayloadRecords, 1);
});

test('derived text admission enforces configured position count and UTF-8 byte ceilings without partial writes', async (t) => {
  const onePosition = twoPagePdfWithBlankSecondPage();
  const exactBytes = Buffer.byteLength('Page with text', 'utf8');
  assert.equal(exactBytes, 14);
  const exact = await createHarness(t, {
    storeOptions: {
      maxPositionBytes: exactBytes,
      maxPositionCount: 1,
      maxStoredPayloadBytes: exactBytes,
    },
  });
  const exactScope = await exact.store.scopeForAuthenticatedRequest(request());
  const exactResult = await exact.store.ingestDerivedPdfEvidence(exactScope, pdfInput(onePosition, exact.createPermit()), request());
  assert.equal(exactResult.outcome, 'stored');
  const exactPrivate = await exact.store.withPrivatePayload(exactScope, exactResult.evidence, request());
  assert.deepEqual(exactPrivate.positions.map((position) => position.text), ['Page with text']);

  const perPositionOver = await createHarness(t, {
    storeOptions: { maxPositionBytes: exactBytes - 1, maxPositionCount: 1, maxStoredPayloadBytes: exactBytes },
  });
  const perPositionScope = await perPositionOver.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(perPositionOver.store.ingestDerivedPdfEvidence(
    perPositionScope, pdfInput(onePosition, perPositionOver.createPermit()), request(),
  ), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  let integrity = await perPositionOver.store.integritySnapshot(perPositionScope);
  assert.equal(integrity.availableEvidence, 0);
  assert.equal(integrity.encryptedPayloadRecords, 0);

  const unicode = await readFile(fileURLToPath(new URL('text-rotated-unicode.pdf', FIXTURES)));
  const unicodeCap = 19;
  assert.ok(Buffer.byteLength('Festival 東京 2027', 'utf8') > unicodeCap);
  assert.ok('Festival 東京 2027'.length < unicodeCap);
  const aggregateOver = await createHarness(t, {
    storeOptions: { maxPositionBytes: 64 * 1024, maxPositionCount: 128, maxStoredPayloadBytes: unicodeCap },
  });
  const aggregateScope = await aggregateOver.store.scopeForAuthenticatedRequest(request());
  await assert.rejects(aggregateOver.store.ingestDerivedPdfEvidence(
    aggregateScope,
    pdfInput(unicode, aggregateOver.createPermit(), {
      sourceUrl: 'https://pdf.example.test/unicode-over-byte-cap.pdf',
      canonicalUrl: 'https://pdf.example.test/unicode-over-byte-cap.pdf',
    }),
    request(),
  ), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  integrity = await aggregateOver.store.integritySnapshot(aggregateScope);
  assert.equal(integrity.availableEvidence, 0);
  assert.equal(integrity.encryptedPayloadRecords, 0);

  const countOver = await createHarness(t, { storeOptions: { maxPositionCount: 1 } });
  const countScope = await countOver.store.scopeForAuthenticatedRequest(request());
  const multipage = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  await assert.rejects(countOver.store.ingestDerivedPdfEvidence(
    countScope,
    pdfInput(multipage, countOver.createPermit(), {
      sourceUrl: 'https://pdf.example.test/position-count-over.pdf',
      canonicalUrl: 'https://pdf.example.test/position-count-over.pdf',
    }),
    request(),
  ), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  integrity = await countOver.store.integritySnapshot(countScope);
  assert.equal(integrity.availableEvidence, 0);
  assert.equal(integrity.encryptedPayloadRecords, 0);
});

test('retention expiry during decoder preparation or a delayed key denies persistence without extending the source deadline', async (t) => {
  const decodeClock = { value: EPOCH };
  const duringDecode = await createHarness(t, { clock: decodeClock });
  const decodeScope = await duringDecode.store.scopeForAuthenticatedRequest(request());
  const bytes = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  const shortPermit = duringDecode.createPermit('tenant-pdf', 5);
  const decodeAttempt = duringDecode.store.ingestDerivedPdfEvidence(decodeScope, pdfInput(bytes, shortPermit), request());
  setTimeout(() => { decodeClock.value = EPOCH + 5; }, 10);
  await assert.rejects(decodeAttempt, (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  const decodeFiles = await readdir(duringDecode.directory);
  assert.deepEqual(decodeFiles, [], 'expiry before the preflight store read leaves no tenant database');

  const keyClock = { value: EPOCH };
  const duringKey = await createHarness(t, { clock: keyClock });
  const keyScope = await duringKey.store.scopeForAuthenticatedRequest(request());
  const keyGate = duringKey.armPayloadGate();
  const permit = duringKey.createPermit('tenant-pdf', 2_000);
  const keyAttempt = duringKey.store.ingestDerivedPdfEvidence(keyScope, pdfInput(bytes, permit), request());
  try {
    await waitFor(keyGate.reached, 15_000, 'payload key resolver gate');
  } catch (error) {
    keyGate.release();
    await keyAttempt.catch(() => {});
    throw error;
  }
  keyClock.value = EPOCH + 2_000;
  keyGate.release();
  await assert.rejects(keyAttempt, (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  const keyIntegrity = await duringKey.store.integritySnapshot(keyScope);
  assert.equal(keyIntegrity.availableEvidence, 0);
  assert.equal(keyIntegrity.encryptedPayloadRecords, 0);
});

test('principal switch and ACL revocation during delayed key resolution deny derived private release', async (t) => {
  const bytes = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  for (const mutation of [
    ['principal-switch', (mutableRequest) => { mutableRequest.principal.tenantId = 'tenant-other'; }],
    ['acl-revocation', (mutableRequest) => { mutableRequest.allowPrivate = false; }],
  ]) {
    const [name, changeRequest] = mutation;
    const harness = await createHarness(t);
    const mutableRequest = request();
    const scope = await harness.store.scopeForAuthenticatedRequest(mutableRequest);
    const gate = harness.armPayloadGate();
    const attempt = harness.store.ingestDerivedPdfEvidence(scope, pdfInput(bytes, harness.createPermit(), {
      sourceUrl: `https://pdf.example.test/${name}.pdf`, canonicalUrl: `https://pdf.example.test/${name}.pdf`,
    }), mutableRequest);
    try {
      await waitFor(gate.reached, 15_000, `${name} payload key gate`);
    } catch (error) {
      gate.release();
      await attempt.catch(() => {});
      throw error;
    }
    changeRequest(mutableRequest);
    gate.release();
    await assert.rejects(attempt, (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED', name);
    const integrity = await harness.store.integritySnapshot(scope);
    assert.equal(integrity.availableEvidence, 0, name);
    assert.equal(integrity.encryptedPayloadRecords, 0, name);
  }
});

test('cancellation during delayed key resolution and the final current hook creates no derived record', async (t) => {
  const bytes = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  const duringKey = await createHarness(t);
  const keyScope = await duringKey.store.scopeForAuthenticatedRequest(request());
  const keyGate = duringKey.armPayloadGate();
  const keyAbort = new AbortController();
  const keyAttempt = duringKey.store.ingestDerivedPdfEvidence(keyScope, pdfInput(bytes, duringKey.createPermit()), request(), keyAbort.signal);
  try {
    await waitFor(keyGate.reached, 15_000, 'cancellation payload key gate');
  } catch (error) {
    keyGate.release();
    await keyAttempt.catch(() => {});
    throw error;
  }
  keyAbort.abort();
  keyGate.release();
  await assert.rejects(keyAttempt, (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_CANCELLED');
  const keyIntegrity = await duringKey.store.integritySnapshot(keyScope);
  assert.equal(keyIntegrity.availableEvidence, 0);
  assert.equal(keyIntegrity.encryptedPayloadRecords, 0);

  let finalSignal;
  const duringFinalHook = await createHarness(t, {
    authorizePrivateAccessCurrent({ action }) {
      if (action === 'ingest_derived_pdf_evidence') finalSignal.abort();
      return true;
    },
  });
  const finalScope = await duringFinalHook.store.scopeForAuthenticatedRequest(request());
  finalSignal = new AbortController();
  await assert.rejects(
    duringFinalHook.store.ingestDerivedPdfEvidence(finalScope, pdfInput(bytes, duringFinalHook.createPermit()), request(), finalSignal.signal),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_CANCELLED',
  );
  const finalIntegrity = await duringFinalHook.store.integritySnapshot(finalScope);
  assert.equal(finalIntegrity.availableEvidence, 0);
  assert.equal(finalIntegrity.encryptedPayloadRecords, 0);
});

test('the final synchronous authorizer can reenter SQLite; a changed snapshot fails the CAS without partial derived evidence', async (t) => {
  if (process.platform !== 'linux' || !existsSync('/usr/bin/prlimit')) {
    t.skip('the production PDF reader requires Linux prlimit isolation; Linux CI runs this CAS regression');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-pdf-derived-cas-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const clock = { value: EPOCH };
  const tenantId = 'tenant-pdf';
  const hash = tenantHash(tenantId);
  let currentHookCalls = 0;
  let mutatedManifest = false;
  const harness = await createHarness(t, {
    storeOptions: { directory: root },
    authorizePrivateAccessCurrent({ action, tenantId: authorizedTenant }) {
      assert.equal(authorizedTenant, tenantId);
      if (action === 'ingest_derived_pdf_evidence') {
        currentHookCalls += 1;
        const database = new DatabaseSync(path.join(root, hash, 'evidence.sqlite'));
        try {
          if (!mutatedManifest) {
            database.prepare('INSERT INTO evidence_manifest (tenant_hash, document) VALUES (?, ?)')
              .run(hash, JSON.stringify({ schemaVersion: 1, tenantHash: hash, records: {}, families: {}, facts: {} }));
            mutatedManifest = true;
          } else {
            assert.equal(database.prepare('SELECT COUNT(*) AS count FROM evidence_manifest WHERE tenant_hash = ?')
              .get(hash).count, 1, 'each current authorization callback can reenter SQLite outside the writer transaction');
          }
        } finally {
          database.close();
        }
      }
      return true;
    },
    clock,
  });
  const store = harness.store;
  const scope = await store.scopeForAuthenticatedRequest(request());
  const content = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  await assert.rejects(store.ingestDerivedPdfEvidence(scope, pdfInput(content, harness.createPermit(tenantId)), request()),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_BUSY');
  assert.ok(currentHookCalls >= 2, 'the callback is rechecked after the snapshot changed');
  assert.equal(mutatedManifest, true, 'the fixture changes the manifest once so the final CAS reports EVIDENCE_BUSY');
  const integrity = await store.integritySnapshot(scope);
  assert.equal(integrity.availableEvidence, 0);
  assert.equal(integrity.encryptedPayloadRecords, 0);
});

test('retention that expires during a real SQLite write-lock wait rolls back the derived write', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-pdf-derived-lock-expiry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hash = tenantHash('tenant-pdf');
  const databasePath = path.join(root, hash, 'evidence.sqlite');
  const readyPath = path.join(root, 'lock.ready');
  const releasedPath = path.join(root, 'lock.released');
  const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sqlite-lock-worker.mjs');
  let worker;
  let workerExit;
  const clock = { value: EPOCH };
  const harness = await createHarness(t, {
    clock,
    storeOptions: {
      directory: root,
      lockTimeoutMs: 2_000,
      now: () => existsSync(releasedPath) ? EPOCH + 10_000 : clock.value,
    },
    async authorizePrivateAccess({ tenantId: authorizedTenant, action }) {
      if (authorizedTenant !== 'tenant-pdf' || action !== 'ingest_derived_pdf_evidence') return false;
      worker = spawn(process.execPath, [workerPath, databasePath, readyPath, releasedPath], {
        cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'],
      });
      worker.stderr.resume();
      workerExit = new Promise((resolve, reject) => {
        worker.once('error', reject);
        worker.once('close', (code) => code === 0 ? resolve() : reject(new Error(`SQLite lock worker exited ${code}`)));
      });
      const deadline = Date.now() + 5_000;
      while (!existsSync(readyPath) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
      return existsSync(readyPath);
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const pdfBytes = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  await assert.rejects(
    harness.store.ingestDerivedPdfEvidence(scope, pdfInput(pdfBytes, harness.createPermit('tenant-pdf', 10_000)), request()),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED',
  );
  await workerExit;
  const integrity = await harness.store.integritySnapshot(scope);
  assert.equal(integrity.availableEvidence, 0);
  assert.equal(integrity.encryptedPayloadRecords, 0);
  const { manifest, sealedCount } = inspectManifest(root);
  assert.equal(manifest, null, 'an expired first write leaves no manifest row');
  assert.equal(sealedCount, 0, 'the rolled-back SQL transaction leaves no sealed payload rows');
});

test('a manifest-trigger failure rolls back sealed derived bytes and schema migration together', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-pdf-derived-atomic-rollback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let triggerCreated = false;
  const harness = await createHarness(t, {
    storeOptions: { directory: root },
    async authorizePrivateAccess({ tenantId: authorizedTenant, action }) {
      if (authorizedTenant !== 'tenant-pdf' || action !== 'ingest_derived_pdf_evidence') return false;
      const databasePath = path.join(root, tenantHash('tenant-pdf'), 'evidence.sqlite');
      const database = new DatabaseSync(databasePath);
      try {
        database.exec(`CREATE TRIGGER fail_first_v2_manifest BEFORE INSERT ON evidence_manifest
          WHEN instr(NEW.document, '"schemaVersion":2') > 0
          BEGIN SELECT RAISE(ABORT, 'synthetic atomic rollback'); END`);
        triggerCreated = true;
      } finally {
        database.close();
      }
      return true;
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const bytes = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  await assert.rejects(harness.store.ingestDerivedPdfEvidence(scope, pdfInput(bytes, harness.createPermit()), request()),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_STORAGE');
  assert.equal(triggerCreated, true);
  const integrity = await harness.store.integritySnapshot(scope);
  assert.equal(integrity.availableEvidence, 0);
  assert.equal(integrity.encryptedPayloadRecords, 0);
  const database = new DatabaseSync(path.join(root, tenantHash('tenant-pdf'), 'evidence.sqlite'));
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM evidence_manifest').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sealed_bundles').get().count, 0);
  } finally {
    database.close();
  }
});

test('source identity rejects an actual stored derived-PDF locator at its unchanged raw-source boundary', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const pdfBytes = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  const derived = await harness.store.ingestDerivedPdfEvidence(scope, pdfInput(pdfBytes, harness.createPermit()), request());
  assert.equal(derived.outcome, 'stored');
  const derivedSelection = await harness.store.materializeSelected(scope, { evidence: [derived.evidence], facts: [] }, request());
  const pdfLocator = derivedSelection.evidence[0].positions[0].locator;

  const html = await readFile(path.join(ROOT, 'tests/extraction/fixtures/multi-event.html'));
  const document = {
    url: 'https://events.example.test/calendar',
    contentType: 'text/html; charset=utf-8',
    fetchedAt: '2026-10-10T15:00:00.000Z',
    redirects: 0,
    bytes: html,
  };
  const actualStore = harness.store;
  const wrappedStore = Object.create(null);
  for (const method of ['scopeForAuthenticatedRequest', 'ingestEvidence', 'appendFact']) {
    wrappedStore[method] = actualStore[method].bind(actualStore);
  }
  wrappedStore.materializeSelected = async (selectedScope, selection, authRequest, signal) => {
    const selected = await actualStore.materializeSelected(selectedScope, selection, authRequest, signal);
    if (selection.facts.length === 0 && selected.evidence.length > 0) {
      const first = selected.evidence[0];
      return Object.freeze({
        evidence: Object.freeze([Object.freeze({
          ...first,
          positions: Object.freeze(first.positions.map((position, index) => index === 0
            ? Object.freeze({ ...position, locator: pdfLocator }) : position)),
        })]),
        facts: selected.facts,
      });
    }
    return selected;
  };
  await assert.rejects(composeSourceIdentity({
    sources: [{ document, retentionHandle: harness.createPermit() }],
    request: request(),
    evidenceStore: wrappedStore,
  }), (error) => error instanceof SourceIdentityCompositionError && error.code === 'SOURCE_BINDING_FAILED');
});

test('two Node processes cannot commit from the same derived-evidence manifest snapshot', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ei-pdf-derived-process-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = fileURLToPath(new URL('text-multipage.pdf', FIXTURES));
  const markerPaths = [path.join(directory, 'writer-1.ready'), path.join(directory, 'writer-2.ready')];
  const releasePath = path.join(directory, 'release-writers');
  const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sqlite-worker.mjs');
  const children = markerPaths.map((markerPath) => spawn(process.execPath, [worker, directory, source, markerPath, releasePath], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  t.after(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  });
  const outputs = children.map((child) => new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) reject(new Error(`PDF evidence worker exited ${code}: ${stderr.slice(-500)}`));
      else {
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`PDF evidence worker emitted invalid result: ${stderr.slice(-500)}`)); }
      }
    });
  }));
  const deadline = Date.now() + 20_000;
  let bothReady = false;
  while (Date.now() < deadline) {
    try {
      await Promise.all(markerPaths.map((marker) => readFile(marker)));
      bothReady = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  await writeFile(releasePath, 'release');
  assert.ok(bothReady, 'both real PDF workers reached their post-decode key gate');
  const results = await waitFor(Promise.all(outputs), 60_000, 'cross-process SQLite writers');
  assert.deepEqual(results.map((result) => result.outcome).sort(), ['busy', 'stored']);
  assert.equal(results.filter((result) => result.created === true).length, 1);

  const harness = await createHarness(t, { storeOptions: { directory } });
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const integrity = await harness.store.integritySnapshot(scope);
  assert.equal(integrity.availableEvidence, 1);
  assert.equal(integrity.encryptedPayloadRecords, 1);
});
