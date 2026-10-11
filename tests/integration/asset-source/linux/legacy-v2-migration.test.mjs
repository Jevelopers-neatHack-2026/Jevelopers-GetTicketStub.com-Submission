import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { composeSourceIdentity } from '../../../../src/discovery/identity/from-extraction.mjs';
import { createHarness, EPOCH, FIXTURES, request } from '../../pdf-evidence/store-harness.mjs';

const TENANT = 'tenant-asset-source';
const SOURCE_URL = 'https://events.example.com/calendar/index.html?campaign=autumn';
const FETCHED_AT = '2026-10-10T15:00:00.000Z';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const V2_COMMIT = 'fdc827d6c0be1508c94666a1cbfc0e5b73b49de7';
const V2_STORE_SHA256 = 'b159f926318a130c87fdc99b35a575ef751815be3651bf2f528d428ee82e758a';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function tenantHash() {
  return digest(Buffer.from(`event-intelligence:tenant:v1:${TENANT}`, 'utf8'));
}

function inspect(directory) {
  const database = new DatabaseSync(path.join(directory, tenantHash(), 'evidence.sqlite'));
  try {
    const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash());
    const manifest = JSON.parse(row.document);
    const rows = database.prepare("SELECT id, sealed FROM sealed_bundles WHERE kind = 'evidence'").all();
    const facts = Number(database.prepare("SELECT COUNT(*) AS count FROM sealed_bundles WHERE kind = 'fact'").get().count);
    return { manifest, bundles: new Map(rows.map((row) => [row.id, Buffer.from(row.sealed)])), facts };
  } finally {
    database.close();
  }
}

async function loadPinnedV2Store(t) {
  const extracted = spawnSync('git', ['show', `${V2_COMMIT}:src/evidence/store.mjs`], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(extracted.status, 0, `pinned old-v2 implementation must exist in ${V2_COMMIT}`);
  assert.equal(digest(extracted.stdout), V2_STORE_SHA256, 'old-v2 binary fixture must match the reviewed merged implementation');
  const modulePath = path.join(ROOT, 'src', 'evidence', `.legacy-v2-store-${process.pid}-${Date.now()}.mjs`);
  await writeFile(modulePath, extracted.stdout, { flag: 'wx', mode: 0o600 });
  t.after(() => rm(modulePath, { force: true }));
  return import(pathToFileURL(modulePath).href);
}

function makeDocument(bytes) {
  return {
    url: SOURCE_URL,
    contentType: 'text/html; charset=utf-8',
    fetchedAt: FETCHED_AT,
    redirects: 0,
    bytes: Buffer.from(bytes),
  };
}

function eventPage() {
  return Buffer.from(`<!doctype html><html><head><meta property="og:image" content="/legacy-card.png"></head><body>
    <img src="/legacy-poster.png">
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Legacy Calendar Gathering',
      startDate: '2026-10-18',
      image: { '@type': 'ImageObject', url: '/legacy-event.png' },
    })}</script><p>Legacy Calendar Gathering at Community Hall.</p>
  </body></html>`);
}

function createLegacyOptions(directory) {
  const permits = new WeakMap();
  const keys = { payload: 'payload-v1', fact: 'fact-v1', 'source-index': 'source-index-v1' };
  const createPermit = (tenantId = TENANT, durationMs = 60_000) => {
    const permit = Object.freeze(Object.create(null));
    permits.set(permit, { tenantId, expiresAtMs: EPOCH + durationMs });
    return permit;
  };
  return {
    createPermit,
    options: {
      directory,
      resolveTenant: (authenticatedRequest) => authenticatedRequest?.principal?.tenantId,
      async resolveKey({ tenantId, purpose, keyId }) {
        const selectedId = keyId ?? keys[purpose];
        return { keyId: selectedId, key: createHash('sha256').update(`${tenantId}:${purpose}:${selectedId}:synthetic`).digest() };
      },
      resolveRetention({ tenantId, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
        if (kind === 'evidence') {
          const permit = permits.get(retentionHandle);
          if (!permit || permit.tenantId !== tenantId) throw new Error('synthetic invalid v2 permit');
          return {
            expiresAtMs: Math.min(permit.expiresAtMs, nowMs + 60_000, sourceExpiresAtMs ?? Number.POSITIVE_INFINITY),
            policyId: 'synthetic-v2-retention', policyVersion: '1', accessPolicy: 'tenant_private',
          };
        }
        return { expiresAtMs: sourceExpiresAtMs ?? nowMs + 30_000, policyId: 'synthetic-v2-retention', policyVersion: '1', accessPolicy: 'tenant_private' };
      },
      authorizePrivateAccess: ({ tenantId, request: authRequest }) => authRequest?.principal?.tenantId === tenantId && authRequest.allowPrivate === true,
      authorizePrivateAccessCurrent: ({ tenantId, request: authRequest }) => authRequest?.principal?.tenantId === tenantId && authRequest.allowPrivate === true,
      consumePrivatePayload: ({ source, positions }) => ({
        sourceHash: source.contentHash,
        sourceUrl: source.sourceUrl,
        derivedPdf: source.derivedPdf,
        positions: positions.map((position) => ({ locator: position.locator, text: position.content.toString('utf8') })),
      }),
      now: () => EPOCH,
      maxSourceBytes: 5 * 1024 * 1024,
      maxPositionBytes: 64 * 1024,
      maxPositionCount: 128,
      maxStoredPayloadBytes: 512 * 1024,
      maxRetentionMs: 60_000,
      lockTimeoutMs: 5_000,
    },
  };
}

const testOptions = { skip: process.platform !== 'linux' };

test('actual merged v2 store reads raw and PDF ciphertext, then v3 asset/PDF/composer writes preserve the old sealed bytes', testOptions, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-asset-v2-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = await loadPinnedV2Store(t);
  const legacyHarness = createLegacyOptions(root);
  const legacyStore = legacy.createEvidenceStore(legacyHarness.options);
  const authenticatedRequest = request(TENANT);
  const legacyScope = await legacyStore.scopeForAuthenticatedRequest(authenticatedRequest);
  const doc = makeDocument(eventPage());
  const composedOnV2 = await composeSourceIdentity({
    sources: [{ document: doc, retentionHandle: legacyHarness.createPermit() }],
    request: authenticatedRequest,
    evidenceStore: legacyStore,
  });
  const legacyRawId = composedOnV2.sources[0].evidence.evidenceId;
  assert.equal(composedOnV2.sources[0].evidence.contentHash, digest(doc.bytes));
  const rawPrivate = await legacyStore.withPrivatePayload(
    legacyScope,
    await legacyStore.lookupEvidence(legacyScope, legacyRawId),
    authenticatedRequest,
  );
  assert.equal(rawPrivate.sourceHash, digest(doc.bytes));
  assert.ok(rawPrivate.positions.some((position) => position.text.includes('Legacy Calendar Gathering')));

  const pdfBytes = await readFile(fileURLToPath(new URL('text-multipage.pdf', FIXTURES)));
  const legacyPdf = await legacyStore.ingestDerivedPdfEvidence(legacyScope, {
    sourceUrl: 'https://events.example.com/archive/legacy-v2.pdf',
    canonicalUrl: 'https://events.example.com/archive/legacy-v2.pdf',
    content: pdfBytes,
    contentType: 'application/pdf; version=1.7',
    retrievedAt: FETCHED_AT,
    sourceKind: 'external',
    retentionHandle: legacyHarness.createPermit(),
  }, authenticatedRequest);
  assert.equal(legacyPdf.outcome, 'stored');
  assert.equal(legacyPdf.metadata.representation, 'pdf-derived-text');
  const pdfPrivate = await legacyStore.withPrivatePayload(legacyScope, legacyPdf.evidence, authenticatedRequest);
  assert.equal(pdfPrivate.sourceHash, digest(pdfBytes));
  assert.ok(pdfPrivate.positions.some((position) => position.text.includes('Community Night')));
  assert.ok(pdfPrivate.derivedPdf.pages.length > 0);

  const v2Before = inspect(root);
  assert.equal(v2Before.manifest.schemaVersion, 2);
  assert.equal(v2Before.manifest.records[legacyRawId].representation, undefined);
  assert.equal(v2Before.manifest.records[legacyPdf.metadata.evidenceId].representation, 'pdf-derived-text');
  const rawSealedBefore = v2Before.bundles.get(legacyRawId);
  const pdfSealedBefore = v2Before.bundles.get(legacyPdf.metadata.evidenceId);
  assert.ok(rawSealedBefore && pdfSealedBefore);

  const current = await createHarness(t, { storeOptions: { directory: root } });
  const currentScope = await current.store.scopeForAuthenticatedRequest(authenticatedRequest);
  const asset = await current.store.ingestAssetSourceEvidence(
    currentScope,
    { document: doc, retentionHandle: current.createPermit(TENANT) },
    authenticatedRequest,
  );
  assert.equal(asset.outcome, 'stored');
  assert.equal(readDatabaseSchema(root), 3, 'v2 manifest upgraded only when the asset bundle is committed');

  const newPdf = await current.store.ingestDerivedPdfEvidence(currentScope, {
    sourceUrl: 'https://events.example.com/archive/post-v3.pdf',
    canonicalUrl: 'https://events.example.com/archive/post-v3.pdf',
    content: pdfBytes,
    contentType: 'application/pdf; version=1.7',
    retrievedAt: FETCHED_AT,
    sourceKind: 'external',
    retentionHandle: current.createPermit(TENANT),
  }, authenticatedRequest);
  assert.equal(newPdf.outcome, 'stored');
  assert.equal(newPdf.created, true);
  assert.equal(readDatabaseSchema(root), 3, 'the v2 PDF writer must not lower a v3 manifest');
  const composerAfterV3 = await composeSourceIdentity({
    sources: [{ document: doc, retentionHandle: current.createPermit(TENANT) }],
    request: authenticatedRequest,
    evidenceStore: current.store,
  });
  assert.equal(composerAfterV3.sources[0].evidence.evidenceId, legacyRawId);
  assert.equal(composerAfterV3.sources[0].evidence.contentHash, digest(doc.bytes));
  assert.equal(readDatabaseSchema(root), 3, 'raw composer fact writes preserve the monotonic manifest schema');

  const currentAfterRestart = current.openStore();
  const reopenedScope = await currentAfterRestart.scopeForAuthenticatedRequest(authenticatedRequest);
  for (const evidenceId of [legacyRawId, legacyPdf.metadata.evidenceId, asset.metadata.evidenceId, newPdf.metadata.evidenceId]) {
    const handle = await currentAfterRestart.lookupEvidence(reopenedScope, evidenceId);
    const selected = await currentAfterRestart.materializeSelected(reopenedScope, { evidence: [handle], facts: [] }, authenticatedRequest);
    assert.equal(selected.evidence.length, 1);
  }
  const reopenedPdf = await currentAfterRestart.withPrivatePayload(
    reopenedScope,
    await currentAfterRestart.lookupEvidence(reopenedScope, legacyPdf.metadata.evidenceId),
    authenticatedRequest,
  );
  assert.equal(reopenedPdf.sourceHash, digest(pdfBytes));
  assert.ok(reopenedPdf.positions.some((position) => position.text.includes('Community Night')));
  const v3After = inspect(root);
  assert.deepEqual(v3After.bundles.get(legacyRawId), rawSealedBefore, 'raw sealed bundle bytes remain identical after manifest migration and composer replay');
  assert.deepEqual(v3After.bundles.get(legacyPdf.metadata.evidenceId), pdfSealedBefore, 'v2 PDF sealed bundle bytes remain identical after v3 and subsequent PDF writes');
  assert.equal(v3After.manifest.records[asset.metadata.evidenceId].representation, 'asset-source-excerpt');
  assert.equal(v3After.manifest.records[newPdf.metadata.evidenceId].representation, 'pdf-derived-text');
  assert.ok(v3After.facts >= v2Before.facts, 'new composer facts append without rewriting legacy evidence');

  await assert.rejects(legacyStore.lookupEvidence(legacyScope, asset.metadata.evidenceId),
    (error) => error?.code === 'EVIDENCE_INTEGRITY', 'the pinned v2 implementation rejects current schema-v3 asset records');
});

test('actual merged v1 raw-only store migrates on current asset write and preserves raw ciphertext/replay', testOptions, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-asset-v1-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = await loadPinnedV2Store(t);
  const legacyHarness = createLegacyOptions(root);
  const legacyStore = legacy.createEvidenceStore(legacyHarness.options);
  const authenticatedRequest = request(TENANT);
  const legacyScope = await legacyStore.scopeForAuthenticatedRequest(authenticatedRequest);
  const doc = makeDocument(eventPage());
  const composedOnV1 = await composeSourceIdentity({
    sources: [{ document: doc, retentionHandle: legacyHarness.createPermit() }],
    request: authenticatedRequest,
    evidenceStore: legacyStore,
  });
  const legacyRawId = composedOnV1.sources[0].evidence.evidenceId;
  const v1Before = inspect(root);
  assert.equal(v1Before.manifest.schemaVersion, 1, 'the pinned legacy writer leaves a populated raw-only v1 manifest');
  const rawSealedBefore = v1Before.bundles.get(legacyRawId);
  assert.ok(rawSealedBefore);

  const current = await createHarness(t, { storeOptions: { directory: root } });
  const currentScope = await current.store.scopeForAuthenticatedRequest(authenticatedRequest);
  const asset = await current.store.ingestAssetSourceEvidence(currentScope, {
    document: doc,
    retentionHandle: current.createPermit(TENANT),
  }, authenticatedRequest);
  assert.equal(asset.outcome, 'stored');
  assert.equal(readDatabaseSchema(root), 3, 'the first current asset commit migrates the real populated v1 manifest');

  const replay = await composeSourceIdentity({
    sources: [{ document: doc, retentionHandle: current.createPermit(TENANT) }],
    request: authenticatedRequest,
    evidenceStore: current.store,
  });
  assert.equal(replay.sources[0].evidence.evidenceId, legacyRawId);
  assert.equal(replay.sources[0].evidence.contentHash, digest(doc.bytes));
  const reopened = current.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(authenticatedRequest);
  const rawHandle = await reopened.lookupEvidence(reopenedScope, legacyRawId);
  const rawPrivate = await reopened.withPrivatePayload(reopenedScope, rawHandle, authenticatedRequest);
  assert.equal(rawPrivate.sourceHash, digest(doc.bytes));
  assert.ok(rawPrivate.positions.some((position) => position.text.includes('Legacy Calendar Gathering')));
  const after = inspect(root);
  assert.deepEqual(after.bundles.get(legacyRawId), rawSealedBefore, 'v1 raw ciphertext remains byte-identical after migration and replay');
  assert.equal(after.manifest.records[legacyRawId].representation, undefined);
  assert.equal(after.manifest.records[asset.metadata.evidenceId].representation, 'asset-source-excerpt');

  await assert.rejects(legacyStore.lookupEvidence(legacyScope, asset.metadata.evidenceId),
    (error) => error?.code === 'EVIDENCE_INTEGRITY', 'the pinned v2 implementation rejects current schema-v3 asset records');
});

function readDatabaseSchema(directory) {
  return inspect(directory).manifest.schemaVersion;
}
