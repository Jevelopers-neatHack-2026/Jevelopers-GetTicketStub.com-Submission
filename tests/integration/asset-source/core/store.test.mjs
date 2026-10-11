import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { EvidenceStoreError } from '../../../../src/evidence/store.mjs';
import { composeSourceIdentity, SourceIdentityCompositionError } from '../../../../src/discovery/identity/from-extraction.mjs';
import { discoverAssetCandidates } from '../../../../src/brand-research/assets.mjs';
import { extractDeterministically } from '../../../../src/extraction/index.mjs';
import { parseAndValidateUrl } from '../../../../src/security/url-policy.mjs';
import { createHarness, EPOCH, request } from '../../pdf-evidence/store-harness.mjs';

const TENANT = 'tenant-asset-source';
const SOURCE_URL = 'https://events.example.com/calendar/index.html?campaign=autumn';
const FETCHED_AT = '2026-10-10T15:00:00.000Z';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const FIXTURES = new URL('../fixtures/', import.meta.url);
const PINNED_SELECTOR_ONE_COMMIT = 'e5ed7270581c8fc033b22e9252361c0139050bc7';
const PINNED_SELECTOR_ONE_FILES = Object.freeze({
  'src/evidence/store.mjs': 'ce407ab2b93c11474cf549da001e247ead100d8103e309af4e10a0a19502dde3',
  'src/extraction/index.mjs': 'da0bca674ccb87bf7c5af84910b5d607c93fda12f02c2ccc5e3e7b5783a235bc',
  'src/extraction/html.mjs': 'c7dc3bd91fafa34161e828396f3ea133f2c8887564e8a34c02f2364f92038569',
  'src/extraction/jsonld.mjs': '9706f11c502a1dd2079793ca5ebaf583479ea329bdada5e46700c6b42e40750c',
  'src/extraction/xhtml.mjs': 'b54f16a21d5228f7d0825e495e6bd5b327a89f8cc4c582e90b15372aa0f43588',
  'src/extraction/source.mjs': '4a0942a8222c8785a8b2ad9f8b7c2daab387ef96a1fe75e6c7a1ab8ea7e8b40d',
});
const PINNED_SELECTOR_TWO_COMMIT = 'e7061137e903ea198387db7b247de637a3e35891';
const PINNED_SELECTOR_TWO_FILES = Object.freeze({
  'src/evidence/store.mjs': 'a74fd17d53073d56ef20e68e8a3adf0d0b76363a94cd26d5c2aef33f84ffddc9',
  'src/extraction/index.mjs': '80ac799d0447d9240ec6ca74d7417fb0b0af60ab2dd353d45a79de88a7285881',
  'src/extraction/html.mjs': 'c3565f4b678ea2eef5bdb26e39bfd7a687e6138bd81835adb2e552f369897b25',
  'src/extraction/jsonld.mjs': '67a14953fab7c29e4abdeb48005de71b2b22d907520aa5110cefa9bccb5a7e29',
  'src/extraction/xhtml.mjs': 'b54f16a21d5228f7d0825e495e6bd5b327a89f8cc4c582e90b15372aa0f43588',
  'src/extraction/source.mjs': '4a0942a8222c8785a8b2ad9f8b7c2daab387ef96a1fe75e6c7a1ab8ea7e8b40d',
});
const PINNED_SELECTOR_THREE_COMMIT = '2b11c84e2a1684184fc7f2619c5cbbe353193d3c';
const PINNED_SELECTOR_THREE_FILES = Object.freeze({
  'src/evidence/store.mjs': 'b2e19816020e9dfa27aec6da53649f1648a7a3c976fdbba8f91a7f8429da768e',
  'src/extraction/index.mjs': '80ac799d0447d9240ec6ca74d7417fb0b0af60ab2dd353d45a79de88a7285881',
  'src/extraction/html.mjs': 'dceac310d7e423d2ad80fa64d543cc6efcf1a578d190c1ad8be1e64de93445d9',
  'src/extraction/jsonld.mjs': '67a14953fab7c29e4abdeb48005de71b2b22d907520aa5110cefa9bccb5a7e29',
  'src/extraction/xhtml.mjs': 'b54f16a21d5228f7d0825e495e6bd5b327a89f8cc4c582e90b15372aa0f43588',
  'src/extraction/source.mjs': '4a0942a8222c8785a8b2ad9f8b7c2daab387ef96a1fe75e6c7a1ab8ea7e8b40d',
});

function documentFrom(html, overrides = {}) {
  return {
    url: SOURCE_URL,
    contentType: 'text/html; charset=utf-8',
    fetchedAt: FETCHED_AT,
    redirects: 0,
    bytes: Buffer.from(html),
    ...overrides,
  };
}

function eventPage(extra = '') {
  return `<!doctype html><html><head>
    <base href="http://127.0.0.1/hostile-base/">
    <link rel="canonical" href="https://canonical.example.net/ignored/">
    <meta property="og:image" content="/assets/page-card.png#crop=wide">
    <link rel="icon" href="//cdn.example.com/site.ico">
  </head><body>
    <img src="../assets/hero.png?size=large&amp;rev=2#frame">
    <img src="javascript:alert(1)">
    <img src="data:image/svg+xml,%3Csvg%3E">
    <img src="https://cdn.example.com/credential.png?token=private-canary">
    <img src="https://user:private-canary@cdn.example.com/private.png">
    <img src="http://192.168.1.4/private.png">
    ${extra}
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Community Calendar Night',
      startDate: '2026-10-18',
      image: { '@type': 'ImageObject', url: '/assets/event-image.svg' },
      organizer: { name: 'Unverified Host', logo: { url: 'https://cdn.example.com/claimed-host.png' } },
    })}</script>
    <p>Community Calendar Night begins October 18.</p>
  </body></html>`;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function tenantHash(tenantId = TENANT) {
  return digest(Buffer.from(`event-intelligence:tenant:v1:${tenantId}`, 'utf8'));
}

function readDatabase(directory, tenantId = TENANT) {
  const database = new DatabaseSync(path.join(directory, tenantHash(tenantId), 'evidence.sqlite'));
  try {
    const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash(tenantId));
    const evidenceCount = Number(database.prepare("SELECT COUNT(*) AS count FROM sealed_bundles WHERE kind = 'evidence'").get().count);
    const factCount = Number(database.prepare("SELECT COUNT(*) AS count FROM sealed_bundles WHERE kind = 'fact'").get().count);
    const bundleCount = Number(database.prepare('SELECT COUNT(*) AS count FROM sealed_bundles').get().count);
    return { manifest: row ? JSON.parse(row.document) : null, evidenceCount, factCount, bundleCount };
  } finally {
    database.close();
  }
}

function readDatabaseIfPresent(directory, tenantId = TENANT) {
  const databasePath = path.join(directory, tenantHash(tenantId), 'evidence.sqlite');
  if (!existsSync(databasePath)) return { manifest: null, evidenceCount: 0, factCount: 0, bundleCount: 0 };
  return readDatabase(directory, tenantId);
}

function readEvidenceBytes(directory, evidenceId, tenantId = TENANT) {
  const database = new DatabaseSync(path.join(directory, tenantHash(tenantId), 'evidence.sqlite'));
  try {
    return Buffer.from(database.prepare("SELECT sealed FROM sealed_bundles WHERE kind = 'evidence' AND id = ?").get(evidenceId).sealed);
  } finally {
    database.close();
  }
}

function keyFor(tenantId = TENANT, purpose = 'payload', keyId = `${purpose}-v1`) {
  return createHash('sha256').update(`${tenantId}:${purpose}:${keyId}:synthetic`).digest();
}

function openBundle(envelopeBytes, evidenceId, tenantId = TENANT) {
  const envelope = JSON.parse(envelopeBytes.toString('utf8'));
  const decipher = createDecipheriv('aes-256-gcm', keyFor(tenantId, 'payload', envelope.keyId), Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(`event-intelligence:evidence:v1:${tenantHash(tenantId)}:evidence:${evidenceId}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
  try { return JSON.parse(plaintext.toString('utf8')); }
  finally { plaintext.fill(0); }
}

function resealBundle(bundle, oldEnvelopeBytes, evidenceId, tenantId = TENANT) {
  const oldEnvelope = JSON.parse(oldEnvelopeBytes.toString('utf8'));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(tenantId, 'payload', oldEnvelope.keyId), iv);
  cipher.setAAD(Buffer.from(`event-intelligence:evidence:v1:${tenantHash(tenantId)}:evidence:${evidenceId}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(bundle), 'utf8')), cipher.final()]);
  return Buffer.from(JSON.stringify({
    version: 1,
    keyId: oldEnvelope.keyId,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }), 'utf8');
}

function replaceSealed(directory, evidenceId, sealed) {
  const database = new DatabaseSync(path.join(directory, tenantHash(), 'evidence.sqlite'));
  try {
    database.prepare("UPDATE sealed_bundles SET sealed = ? WHERE kind = 'evidence' AND id = ?").run(sealed, evidenceId);
  } finally {
    database.close();
  }
}

function replaceManifest(directory, manifest) {
  const database = new DatabaseSync(path.join(directory, tenantHash(), 'evidence.sqlite'));
  try {
    database.prepare('UPDATE evidence_manifest SET document = ? WHERE tenant_hash = ?')
      .run(JSON.stringify(manifest), tenantHash());
  } finally {
    database.close();
  }
}

function assetDerivationDigest(bundle) {
  const assetSource = bundle.assetSource;
  const material = {
    bindingVersion: assetSource.bindingVersion,
    representation: 'asset-source-excerpt',
    sourceContentHash: bundle.source.contentHash,
    sourceUrl: assetSource.sourceUrl,
    sourceKind: assetSource.sourceKind,
    extractorVersion: assetSource.extractorVersion,
    selectorVersion: assetSource.selectorVersion,
    completeness: assetSource.completeness,
    limitations: assetSource.limitations,
    candidates: assetSource.candidates.map((candidate, index) => ({
      ...candidate,
      locator: bundle.positions[index].locator,
      excerptHash: bundle.positions[index].contentHash,
    })),
  };
  return digest(Buffer.from(JSON.stringify(material), 'utf8'));
}

function sourceInput(doc, permit) {
  return { document: doc, retentionHandle: permit };
}

function createPinnedLegacyOptions(directory) {
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
          if (!permit || permit.tenantId !== tenantId) throw new Error('synthetic invalid historical retention permit');
          return {
            expiresAtMs: Math.min(permit.expiresAtMs, nowMs + 60_000, sourceExpiresAtMs ?? Number.POSITIVE_INFINITY),
            policyId: 'synthetic-historical-retention',
            policyVersion: '1',
            accessPolicy: 'tenant_private',
          };
        }
        return {
          expiresAtMs: sourceExpiresAtMs ?? nowMs + 30_000,
          policyId: 'synthetic-historical-retention',
          policyVersion: '1',
          accessPolicy: 'tenant_private',
        };
      },
      authorizePrivateAccess: ({ tenantId, request: authRequest }) => authRequest?.principal?.tenantId === tenantId && authRequest.allowPrivate === true,
      authorizePrivateAccessCurrent: ({ tenantId, request: authRequest }) => authRequest?.principal?.tenantId === tenantId && authRequest.allowPrivate === true,
      consumePrivatePayload: ({ source, positions }) => {
        const result = {
          sourceHash: source.contentHash,
          sourceUrl: source.sourceUrl,
          positions: positions.map((position) => ({ locator: position.locator, text: position.content.toString('utf8') })),
        };
        if (source.derivedPdf !== undefined) result.derivedPdf = source.derivedPdf;
        return result;
      },
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

async function loadPinnedSelectorOneStore(t) {
  const parserDirectory = await mkdtemp(path.join(ROOT, 'src/extraction/.legacy-selector-one-'));
  t.after(() => rm(parserDirectory, { recursive: true, force: true }));
  for (const sourcePath of Object.keys(PINNED_SELECTOR_ONE_FILES).filter((file) => file.startsWith('src/extraction/'))) {
    const relativePath = sourcePath.slice('src/extraction/'.length);
    const extracted = spawnSync('git', ['show', `${PINNED_SELECTOR_ONE_COMMIT}:${sourcePath}`], {
      cwd: ROOT,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(extracted.status, 0, `pinned selector-one parser source exists: ${sourcePath}`);
    assert.equal(digest(extracted.stdout), PINNED_SELECTOR_ONE_FILES[sourcePath], `pinned selector-one parser bytes match: ${sourcePath}`);
    await writeFile(path.join(parserDirectory, relativePath), extracted.stdout, { flag: 'wx', mode: 0o600 });
  }

  const oldStore = spawnSync('git', ['show', `${PINNED_SELECTOR_ONE_COMMIT}:src/evidence/store.mjs`], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(oldStore.status, 0, 'pinned selector-one store source exists');
  assert.equal(digest(oldStore.stdout), PINNED_SELECTOR_ONE_FILES['src/evidence/store.mjs'], 'pinned selector-one store bytes match');
  const importSpecifier = "from '../extraction/index.mjs';";
  const oldStoreSource = oldStore.stdout.toString('utf8');
  assert.ok(oldStoreSource.includes(importSpecifier));
  const parserImport = `from '../extraction/${path.basename(parserDirectory)}/index.mjs';`;
  const modulePath = path.join(ROOT, 'src/evidence', `.legacy-selector-one-store-${process.pid}-${Date.now()}.mjs`);
  await writeFile(modulePath, oldStoreSource.replace(importSpecifier, parserImport), { flag: 'wx', mode: 0o600 });
  t.after(() => rm(modulePath, { force: true }));
  return import(pathToFileURL(modulePath).href);
}

async function loadPinnedSelectorTwoStore(t) {
  const parserDirectory = await mkdtemp(path.join(ROOT, 'src/extraction/.legacy-selector-two-'));
  t.after(() => rm(parserDirectory, { recursive: true, force: true }));
  for (const sourcePath of Object.keys(PINNED_SELECTOR_TWO_FILES).filter((file) => file.startsWith('src/extraction/'))) {
    const relativePath = sourcePath.slice('src/extraction/'.length);
    const extracted = spawnSync('git', ['show', `${PINNED_SELECTOR_TWO_COMMIT}:${sourcePath}`], {
      cwd: ROOT,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(extracted.status, 0, `pinned selector-two parser source exists: ${sourcePath}`);
    assert.equal(digest(extracted.stdout), PINNED_SELECTOR_TWO_FILES[sourcePath], `pinned selector-two parser bytes match: ${sourcePath}`);
    await writeFile(path.join(parserDirectory, relativePath), extracted.stdout, { flag: 'wx', mode: 0o600 });
  }

  const oldStore = spawnSync('git', ['show', `${PINNED_SELECTOR_TWO_COMMIT}:src/evidence/store.mjs`], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(oldStore.status, 0, 'pinned selector-two store source exists');
  assert.equal(digest(oldStore.stdout), PINNED_SELECTOR_TWO_FILES['src/evidence/store.mjs'], 'pinned selector-two store bytes match');
  const importSpecifier = "from '../extraction/index.mjs';";
  const oldStoreSource = oldStore.stdout.toString('utf8');
  assert.ok(oldStoreSource.includes(importSpecifier));
  const parserImport = `from '../extraction/${path.basename(parserDirectory)}/index.mjs';`;
  const modulePath = path.join(ROOT, 'src/evidence', `.legacy-selector-two-store-${process.pid}-${Date.now()}.mjs`);
  await writeFile(modulePath, oldStoreSource.replace(importSpecifier, parserImport), { flag: 'wx', mode: 0o600 });
  t.after(() => rm(modulePath, { force: true }));
  return import(pathToFileURL(modulePath).href);
}

async function loadPinnedSelectorThreeStore(t) {
  const parserDirectory = await mkdtemp(path.join(ROOT, 'src/extraction/.legacy-selector-three-'));
  t.after(() => rm(parserDirectory, { recursive: true, force: true }));
  for (const sourcePath of Object.keys(PINNED_SELECTOR_THREE_FILES).filter((file) => file.startsWith('src/extraction/'))) {
    const relativePath = sourcePath.slice('src/extraction/'.length);
    const extracted = spawnSync('git', ['show', `${PINNED_SELECTOR_THREE_COMMIT}:${sourcePath}`], {
      cwd: ROOT,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(extracted.status, 0, `pinned selector-three parser source exists: ${sourcePath}`);
    assert.equal(digest(extracted.stdout), PINNED_SELECTOR_THREE_FILES[sourcePath], `pinned selector-three parser bytes match: ${sourcePath}`);
    await writeFile(path.join(parserDirectory, relativePath), extracted.stdout, { flag: 'wx', mode: 0o600 });
  }

  const oldStore = spawnSync('git', ['show', `${PINNED_SELECTOR_THREE_COMMIT}:src/evidence/store.mjs`], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(oldStore.status, 0, 'pinned selector-three store source exists');
  assert.equal(digest(oldStore.stdout), PINNED_SELECTOR_THREE_FILES['src/evidence/store.mjs'], 'pinned selector-three store bytes match');
  const importSpecifier = "from '../extraction/index.mjs';";
  const oldStoreSource = oldStore.stdout.toString('utf8');
  assert.ok(oldStoreSource.includes(importSpecifier));
  const parserImport = `from '../extraction/${path.basename(parserDirectory)}/index.mjs';`;
  const modulePath = path.join(ROOT, 'src/evidence', `.legacy-selector-three-store-${process.pid}-${Date.now()}.mjs`);
  await writeFile(modulePath, oldStoreSource.replace(importSpecifier, parserImport), { flag: 'wx', mode: 0o600 });
  t.after(() => rm(modulePath, { force: true }));
  return import(pathToFileURL(modulePath).href);
}

function waitFor(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function composeInput(store, doc, permit) {
  return {
    sources: [{ document: doc, retentionHandle: permit }],
    request: request(TENANT),
    evidenceStore: store,
  };
}

test('real HTML asset candidates persist as encrypted source excerpts and reopen through current authorization', async (t) => {
  const harness = await createHarness(t, {
    storeOptions: {
      consumePrivatePayload: ({ metadata, source, positions }) => ({
      evidenceId: metadata.evidenceId,
      sourceHash: source.contentHash,
      assetSource: source.assetSource,
      excerpts: positions.map((position) => ({
        locator: position.locator,
        contentHash: position.contentHash,
        text: position.content.toString('utf8'),
      })),
      }),
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const doc = documentFrom(eventPage());
  const original = Buffer.from(doc.bytes);
  const discovered = await discoverAssetCandidates({
    store: harness.store,
    scope,
    document: doc,
    retentionHandle: harness.createPermit(TENANT),
    request: request(TENANT),
  });
  assert.equal(discovered.outcome, 'stored');
  assert.equal(discovered.created, true);
  assert.equal(discovered.sourceHash, digest(original));
  assert.equal(discovered.metadata.contentHash, digest(original));
  assert.equal(discovered.metadata.representation, 'asset-source-excerpt');
  assert.equal(discovered.candidates[0].excerptKind, 'url-value');
  assert.ok(discovered.candidates.length >= 9);
  assert.ok(discovered.candidates.every((candidate) => candidate.role === 'unknown'
    && candidate.permission === 'unknown' && candidate.inspection === 'pending'));
  assert.ok(discovered.candidates.some((candidate) => candidate.sourceForm === 'open-graph-image'
    && candidate.association.kind === 'unassigned-page'));
  assert.ok(discovered.candidates.some((candidate) => candidate.sourceForm === 'html-icon-link'
    && candidate.association.kind === 'unassigned-page'));
  const relative = discovered.candidates.find((candidate) => candidate.field === 'img.src'
    && candidate.normalizedSuggestion?.includes('/assets/hero.png'));
  assert.equal(relative.normalizedSuggestion, 'https://events.example.com/assets/hero.png?size=large&rev=2#frame');
  assert.equal(relative.fetchSuggestion, 'https://events.example.com/assets/hero.png?size=large&rev=2');
  const quarantined = discovered.candidates.filter((candidate) => candidate.quarantineReason !== null);
  assert.ok(quarantined.some((candidate) => candidate.quarantineReason === 'unsupported_scheme'));
  assert.ok(quarantined.some((candidate) => candidate.quarantineReason === 'sensitive_query'));
  assert.ok(quarantined.some((candidate) => candidate.quarantineReason === 'url_policy_denied'));
  assert.ok(quarantined.every((candidate) => candidate.fetchSuggestion === null));
  assert.ok(!JSON.stringify(discovered).includes('private-canary'));
      assert.ok(!JSON.stringify(discovered).includes(SOURCE_URL));
  assert.equal(discovered.candidates.some((candidate) => candidate.fetchSuggestion?.includes('hostile-base')), false);
  assert.equal(discovered.candidates.some((candidate) => candidate.fetchSuggestion?.includes('canonical.example.net')), false);
  assert.equal(discovered.candidates.some((candidate) => candidate.normalizedSuggestion?.includes('claimed-host.png')),
    true, 'nested organizer image is retained as a source claim, not verified ownership');
  const organizerLogo = discovered.candidates.find((candidate) => candidate.normalizedSuggestion?.includes('claimed-host.png'));
  assert.equal(organizerLogo.association.kind, 'nested-entity-source-claim');
  assert.equal(organizerLogo.association.parentPointer, '');
  assert.equal(organizerLogo.association.assetPointer, '/organizer/logo/url');

  const reopenedStore = harness.openStore();
  const reopenedScope = await reopenedStore.scopeForAuthenticatedRequest(request(TENANT));
  const lookup = await reopenedStore.lookupEvidence(reopenedScope, discovered.metadata.evidenceId);
  const reopenedSelection = await reopenedStore.materializeSelected(
    reopenedScope, { evidence: [lookup], facts: [] }, request(TENANT),
  );
  assert.equal(reopenedSelection.evidence[0].source.contentHash, digest(original));
  assert.equal(reopenedSelection.evidence[0].source.assetSource.derivationDigest, discovered.metadata.derivationDigest);
  assert.equal(reopenedSelection.evidence[0].positions.length, discovered.candidates.length);
  assert.equal(JSON.stringify(reopenedSelection).includes('Community Calendar Night'), false);
  const privateRead = await reopenedStore.withPrivatePayload(reopenedScope, lookup, request(TENANT));
  assert.equal(privateRead.sourceHash, digest(original));
  assert.equal(privateRead.excerpts.length, discovered.candidates.length);
  for (const [index, excerpt] of privateRead.excerpts.entries()) {
    assert.equal(original.subarray(excerpt.locator.startByte, excerpt.locator.endByte).toString('utf8'), excerpt.text);
    assert.equal(digest(Buffer.from(excerpt.text, 'utf8')), excerpt.contentHash);
    assert.equal(excerpt.contentHash, discovered.candidates[index].excerptHash);
  }
  assert.ok(!privateRead.excerpts.some((excerpt) => excerpt.text.includes('Community Calendar Night')));

  const databaseBytes = await readFile(path.join(harness.directory, tenantHash(), 'evidence.sqlite'));
  assert.equal(databaseBytes.includes(Buffer.from('claimed-host.png')), false, 'source excerpts and URL claims remain encrypted');
  assert.equal(databaseBytes.includes(Buffer.from('private-canary')), false);
});

test('production HTML, XHTML, and standalone JSON-LD asset forms persist exact locators and reopen', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const cases = [
    { name: 'html.html', contentType: 'text/html; charset=utf-8', expectedForms: ['open-graph-image', 'html-icon-link', 'html-img-src', 'jsonld-image'] },
    { name: 'xhtml.xhtml', contentType: 'application/xhtml+xml', expectedForms: ['open-graph-image', 'html-icon-link', 'html-img-src', 'jsonld-logo'] },
    { name: 'standalone.jsonld', contentType: 'application/ld+json', expectedForms: ['jsonld-image', 'jsonld-image', 'jsonld-logo'] },
  ];
  const records = [];
  for (const [index, item] of cases.entries()) {
    const bytes = await readFile(fileURLToPath(new URL(item.name, FIXTURES)));
    const doc = documentFrom(bytes, {
      contentType: item.contentType,
      url: `https://events.example.com/assets-fixture/${item.name}`,
    });
    const discovered = await discoverAssetCandidates({
      store: harness.store,
      scope,
      document: doc,
      retentionHandle: harness.createPermit(TENANT),
      request: request(TENANT),
    });
    assert.equal(discovered.outcome, 'stored', item.name);
    assert.equal(discovered.sourceHash, digest(bytes), item.name);
    assert.equal(discovered.metadata.contentHash, digest(bytes), item.name);
    assert.deepEqual(discovered.candidates.map((candidate) => candidate.sourceForm).sort(), [...item.expectedForms].sort(), item.name);
    assert.ok(discovered.candidates.every((candidate) => candidate.excerptKind === 'url-value'), item.name);
    assert.ok(discovered.candidates.every((candidate) => candidate.role === 'unknown'
      && candidate.permission === 'unknown' && candidate.inspection === 'pending'), item.name);
    records.push({ ...item, bytes, discovered });
  }

  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request(TENANT));
  for (const item of records) {
    const evidence = await reopened.lookupEvidence(reopenedScope, item.discovered.metadata.evidenceId);
    const selected = await reopened.materializeSelected(reopenedScope, { evidence: [evidence], facts: [] }, request(TENANT));
    const view = selected.evidence[0];
    assert.equal(view.source.contentHash, digest(item.bytes), item.name);
    assert.equal(view.source.retrievedAt, FETCHED_AT, item.name);
    assert.deepEqual(view.source.redirectChain, [], item.name);
    assert.equal(view.source.assetSource.candidates.length, item.expectedForms.length, item.name);
    assert.ok(!JSON.stringify(view).includes('fixture event'), item.name);

    const privateRead = await reopened.withPrivatePayload(reopenedScope, evidence, request(TENANT));
    assert.equal(privateRead.sourceHash, digest(item.bytes), item.name);
    assert.equal(privateRead.positions.length, item.expectedForms.length, item.name);
    for (const excerpt of privateRead.positions) {
      assert.equal(item.bytes.subarray(excerpt.locator.startByte, excerpt.locator.endByte).toString('utf8'), excerpt.text, item.name);
      assert.equal(digest(Buffer.from(excerpt.text, 'utf8')), excerpt.contentHash, item.name);
    }
    if (item.name === 'xhtml.xhtml') {
      assert.ok(privateRead.positions.some((excerpt) => excerpt.text === '/café&amp;tea.png'));
    }
    if (item.name === 'standalone.jsonld') {
      const associations = view.source.assetSource.candidates.map((candidate) => candidate.association);
      const eventImage = associations.find((association) => association.kind === 'entity-source-claim' && association.entityKind === 'event');
      const organizationLogo = associations.find((association) => association.kind === 'entity-source-claim' && association.entityKind === 'organization');
      assert.ok(eventImage);
      assert.equal(eventImage.entityPointer, '/@graph/0');
      assert.equal(eventImage.assetPointer, '/@graph/0/image/0');
      assert.equal(eventImage.entityId, 'event:script-0:/@graph/0');
      assert.ok(organizationLogo);
      assert.equal(organizationLogo.entityPointer, '/@graph/1');
      assert.equal(organizationLogo.assetPointer, '/@graph/1/logo');
      assert.equal(organizationLogo.entityId, 'organization:script-0:/@graph/1');
      assert.ok(associations.every((association) => association.kind === 'entity-source-claim'));
    }
  }
});

test('empty and missing HTML/XHTML asset attributes remain quarantined beside valid posters after authorized reopen', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const htmlCase = (name, form, token, valueState, element) => ({
    name,
    contentType: 'text/html; charset=utf-8',
    source: `<!doctype html><html><head>${form === 'open-graph-image' ? element : ''}</head><body>🧭${form === 'open-graph-image' ? '' : element}<img src="/poster.png"></body></html>`,
    tokens: [{ form, token, valueState }],
  });
  const cases = [
    htmlCase('HTML img quoted empty with spacing and uppercase name', 'html-img-src', 'SRC = ""', 'empty', '<img SRC = ""/>'),
    htmlCase('HTML img missing value', 'html-img-src', 'src', 'missing', '<img src>'),
    {
      name: 'HTML equals with no value for img, icon, and Open Graph attributes',
      contentType: 'text/html; charset=utf-8',
      source: '<html><head>🧭<link rel=icon href=><meta property=og:image content=></head>'
        + '<body><img src=><img src="/poster.png"></body></html>',
      expectedCandidateCount: 4,
      tokens: [
        { form: 'html-img-src', token: 'src=', valueState: 'empty' },
        { form: 'html-icon-link', token: 'href=', valueState: 'empty' },
        { form: 'open-graph-image', token: 'content=', valueState: 'empty' },
      ],
    },
    {
      name: 'HTML equals followed by separator whitespace stays an empty value',
      contentType: 'text/html; charset=utf-8',
      source: '<html><head><link rel=icon href= >'
        + '<meta property=og:image content=\n></head><body><img src= ><img src="/poster.png"></body></html>',
      expectedCandidateCount: 4,
      tokens: [
        { form: 'html-img-src', token: 'src=', valueState: 'empty' },
        { form: 'html-icon-link', token: 'href=', valueState: 'empty' },
        { form: 'open-graph-image', token: 'content=', valueState: 'empty' },
      ],
    },
    htmlCase('HTML icon single-quoted empty with spacing', 'html-icon-link', "href = ''", 'empty', '<link rel="icon" href = \'\'/>'),
    htmlCase('HTML icon missing value', 'html-icon-link', 'href', 'missing', '<link rel=icon href>'),
    htmlCase('HTML Open Graph empty with spacing', 'open-graph-image', 'content = ""', 'empty', '<meta property="og:image" content = ""/>'),
    htmlCase('HTML Open Graph missing value', 'open-graph-image', 'content', 'missing', '<meta property=og:image content>'),
    {
      name: 'XHTML empty img, icon, and Open Graph values',
      contentType: 'application/xhtml+xml; charset=utf-8',
      source: '<html xmlns="http://www.w3.org/1999/xhtml"><head>🧭<link rel="icon" href="" />'
        + '<meta property="og:image" content="" /></head><body><img SRC="" /><img src="/poster.png" /></body></html>',
      tokens: [
        { form: 'html-img-src', token: 'SRC=""', valueState: 'empty' },
        { form: 'html-icon-link', token: 'href=""', valueState: 'empty' },
        { form: 'open-graph-image', token: 'content=""', valueState: 'empty' },
      ],
    },
    {
      name: 'HTML whitespace remains a URL-value excerpt',
      contentType: 'text/html; charset=utf-8',
      source: '<html><body>🧭<img src=" "><img src="/poster.png"></body></html>',
      tokens: [{ form: 'html-img-src', token: ' ', valueState: 'value' }],
      expectedQuarantine: 'invalid_or_empty',
    },
    {
      name: 'HTML unquoted self-closing slash remains a nonempty URL value',
      contentType: 'text/html; charset=utf-8',
      source: '<html><body>🧭<img src=/><img src="/poster.png"></body></html>',
      tokens: [{ form: 'html-img-src', token: '/', valueState: 'value' }],
      expectedQuarantine: null,
    },
    {
      name: 'JSON-LD empty scalar and poster retain JSON value spans',
      contentType: 'application/ld+json',
      source: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Event', name: 'Poster control', image: ['', '/poster.png'] }),
      tokens: [{ form: 'jsonld-image', token: '""', valueState: 'value' }],
      expectedQuarantine: 'invalid_or_empty',
    },
  ];
  const records = [];
  for (const [index, item] of cases.entries()) {
    const bytes = Buffer.from(item.source, 'utf8');
    const doc = documentFrom(bytes, {
      contentType: item.contentType,
      url: `https://events.example.com/empty-asset-fixtures/${index}.html`,
    });
    const extraction = await extractDeterministically(doc);
    assert.equal(extraction.assetSources.length,
      item.expectedCandidateCount ?? (item.name.startsWith('XHTML') ? 4 : 2), item.name);
    for (const expected of item.tokens) {
      const parsed = extraction.assetSources.find((asset) => asset.sourceForm === expected.form
        && (expected.valueState === 'value'
          ? asset.candidate.rawValue === expected.token
          : asset.candidate.rawValue === ''));
      assert.ok(parsed, `${item.name} has the actual production parser candidate`);
      if (expected.valueState === 'value') {
        assert.ok(parsed.candidate.source.locator.endByte > parsed.candidate.source.locator.startByte,
          `${item.name} retains a positive-length original value locator`);
        assert.equal(Object.hasOwn(parsed, 'emptyAttributeToken'), false, `${item.name} does not mark nonempty values as empty tokens`);
      } else {
        assert.equal(parsed.candidate.source.locator.startByte, parsed.candidate.source.locator.endByte,
          `${item.name} preserves the original zero-length URL-value locator`);
        const token = parsed.emptyAttributeToken;
        assert.ok(token, `${item.name} carries parser-derived empty attribute token metadata`);
        assert.equal(token.attributeName, expected.form === 'html-img-src' ? 'src'
          : expected.form === 'html-icon-link' ? 'href' : 'content', item.name);
        assert.equal(token.valueState, expected.valueState, item.name);
        assert.equal(Object.getOwnPropertyDescriptor(parsed, 'emptyAttributeToken').enumerable, false, item.name);
        assert.equal(JSON.stringify(parsed).includes('emptyAttributeToken'), false, item.name);
        assert.equal(bytes.subarray(token.locator.startByte, token.locator.endByte).toString('utf8'), expected.token, item.name);
        if (expected.token.endsWith('=')) {
          assert.equal(parsed.candidate.source.locator.startByte, token.locator.endByte,
            `${item.name} places the empty value immediately after its equals sign`);
        }
      }
    }

    const discovered = await discoverAssetCandidates({
      store: harness.store,
      scope,
      document: doc,
      retentionHandle: harness.createPermit(TENANT),
      request: request(TENANT),
    });
    assert.equal(discovered.outcome, 'stored', item.name);
    assert.equal(discovered.sourceHash, digest(bytes), item.name);
    const selected = discovered.candidates;
    const invalid = item.tokens.map((expected) => selected.find((candidate) => candidate.sourceForm === expected.form
      && (expected.valueState === 'value'
        ? candidate.excerptKind === 'url-value' && candidate.locator.endByte - candidate.locator.startByte === Buffer.byteLength(expected.token)
        : candidate.excerptKind === 'html-empty-attribute-token')));
    assert.ok(invalid.every(Boolean), `${item.name} stores all targeted candidates with declared excerpt semantics`);
    for (const [tokenIndex, expected] of item.tokens.entries()) {
      const candidate = invalid[tokenIndex];
      const expectedQuarantine = Object.hasOwn(item, 'expectedQuarantine')
        ? item.expectedQuarantine
        : 'invalid_or_empty';
      assert.equal(candidate.quarantineReason, expectedQuarantine, item.name);
      if (expected.valueState !== 'value' || expectedQuarantine !== null) {
        assert.equal(candidate.normalizedSuggestion, null, item.name);
        assert.equal(candidate.fetchSuggestion, null, item.name);
      }
    }
    const posterForm = item.contentType === 'application/ld+json' ? 'jsonld-image' : 'html-img-src';
    const poster = selected.find((candidate) => candidate.sourceForm === posterForm
      && candidate.fetchSuggestion === 'https://events.example.com/poster.png');
    assert.ok(poster, `${item.name} retains its valid poster candidate`);
    records.push({ ...item, bytes, doc, evidenceId: discovered.metadata.evidenceId, sourceHash: discovered.sourceHash });
  }

  const emptyPageBefore = readDatabase(harness.directory);
  const emptyPage = documentFrom('<html><body>Valid source with no asset fields</body></html>', {
    url: 'https://events.example.com/empty-asset-fixtures/no-candidates.html',
  });
  const emptyResult = await harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(emptyPage, harness.createPermit(TENANT)), request(TENANT),
  );
  assert.deepEqual(emptyResult, { outcome: 'no-candidates', code: 'NO_STATIC_ASSET_CANDIDATES' });
  assert.deepEqual(readDatabase(harness.directory), emptyPageBefore, 'a true empty page writes no evidence or partial bundle');

  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request(TENANT));
  for (const item of records) {
    const evidence = await reopened.lookupEvidence(reopenedScope, item.evidenceId);
    const selected = await reopened.materializeSelected(reopenedScope, { evidence: [evidence], facts: [] }, request(TENANT));
    const view = selected.evidence[0];
    assert.equal(view.source.contentHash, item.sourceHash, item.name);
    const posterForm = item.contentType === 'application/ld+json' ? 'jsonld-image' : 'html-img-src';
    assert.ok(view.source.assetSource.candidates.some((candidate) => candidate.sourceForm === posterForm
      && candidate.fetchSuggestion === 'https://events.example.com/poster.png'), item.name);
    const tokenCandidates = view.source.assetSource.candidates.filter((candidate) => candidate.excerptKind === 'html-empty-attribute-token');
    assert.equal(tokenCandidates.length, item.tokens.filter((token) => token.valueState !== 'value').length, item.name);
    const privateRead = await reopened.withPrivatePayload(reopenedScope, evidence, request(TENANT));
    assert.equal(privateRead.sourceHash, digest(item.bytes), item.name);
    for (const expected of item.tokens) {
      const stored = view.source.assetSource.candidates.find((candidate) => candidate.sourceForm === expected.form
        && (expected.valueState === 'value' ? candidate.excerptKind === 'url-value'
          : candidate.excerptKind === 'html-empty-attribute-token'));
      assert.ok(stored, item.name);
      const position = privateRead.positions.find((entry) => entry.locator.startByte === stored.locator.startByte
        && entry.locator.endByte === stored.locator.endByte);
      assert.ok(position, item.name);
      assert.equal(item.bytes.subarray(position.locator.startByte, position.locator.endByte).toString('utf8'), position.text, item.name);
      assert.equal(position.text, expected.token, item.name);
      assert.equal(position.contentHash, stored.excerptHash, item.name);
    }
    assert.equal(view.source.assetSource.candidates.every((candidate) => candidate.role === 'unknown'
      && candidate.permission === 'unknown' && candidate.inspection === 'pending'), true, item.name);
  }
});

test('selector 4 stores complete non-ASCII HTML attribute values and reopens exact source ranges', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const forms = [
    { form: 'html-img-src' },
    { form: 'html-icon-link' },
    { form: 'open-graph-image' },
  ];
  const whitespace = [
    { name: 'NBSP', value: '\u00a0', entity: '&#160;' },
    { name: 'EM SPACE', value: '\u2003', entity: '&#x2003;' },
  ];
  const cases = [];
  for (const item of forms) {
    for (const space of whitespace) {
      cases.push(
        { name: `${item.form} ${space.name} value-only`, ...item, syntax: 'html-unquoted', value: space.value, expectedQuarantine: 'invalid_or_empty' },
        { name: `${item.form} ${space.name} leading`, ...item, syntax: 'html-unquoted', value: `${space.value}/leading-${space.name.toLowerCase().replaceAll(' ', '-')}.png`, expectedQuarantine: null },
        { name: `${item.form} ${space.name} internal`, ...item, syntax: 'html-unquoted', value: `/internal-${space.name.toLowerCase().replaceAll(' ', '-')}${space.value}value.png`, expectedQuarantine: null },
        { name: `${item.form} ${space.name} quoted`, ...item, syntax: 'html-quoted', value: `/quoted-${space.name.toLowerCase().replaceAll(' ', '-')}${space.value}value.png`, expectedQuarantine: null },
        { name: `${item.form} ${space.name} character reference`, ...item, syntax: 'html-entity', value: `/entity-${space.entity}value.png`, expectedQuarantine: null },
        { name: `XHTML ${item.form} ${space.name} quoted`, ...item, syntax: 'xhtml-quoted', value: `/xhtml-${space.name.toLowerCase().replaceAll(' ', '-')}${space.value}value.png`, expectedQuarantine: null },
        { name: `XHTML ${item.form} ${space.name} character reference`, ...item, syntax: 'xhtml-entity', value: `/xhtml-entity-${space.entity}value.png`, expectedQuarantine: null },
      );
    }
  }

  const records = [];
  for (const [index, item] of cases.entries()) {
    const isXhtml = item.syntax.startsWith('xhtml-');
    const isImg = item.form === 'html-img-src';
    const isEntity = item.syntax.endsWith('entity');
    const rawAttributeValue = item.value;
    const sourceAttributeValue = isEntity
      ? (isXhtml ? `"${item.value}"` : item.value)
      : item.syntax.endsWith('quoted') ? `"${item.value}"` : item.value;
    const targetMarkup = item.form === 'html-img-src'
      ? `<img src=${sourceAttributeValue}${isXhtml ? ' />' : '>'}`
      : item.form === 'html-icon-link'
        ? `<link rel="icon" href=${sourceAttributeValue}${isXhtml ? ' />' : '>'}`
        : `<meta property="og:image" content=${sourceAttributeValue}${isXhtml ? ' />' : '>'}`;
    const source = isXhtml
      ? `<html xmlns="http://www.w3.org/1999/xhtml"><head>${isImg ? '' : targetMarkup}</head>`
        + `<body>🧭${isImg ? targetMarkup : ''}<img src="/poster.png" /></body></html>`
      : `<html><head>${isImg ? '' : targetMarkup}</head>`
        + `<body>🧭${isImg ? targetMarkup : ''}<img src="/poster.png"></body></html>`;
    const bytes = Buffer.from(source, 'utf8');
    const doc = documentFrom(bytes, {
      contentType: isXhtml ? 'application/xhtml+xml; charset=utf-8' : 'text/html; charset=utf-8',
      url: `https://events.example.com/unicode-asset-fixtures/${index}.html`,
    });
    const extraction = await extractDeterministically(doc);
    const parsed = extraction.assetSources.find((asset) => asset.sourceForm === item.form
      && asset.candidate.rawValue === rawAttributeValue);
    assert.ok(parsed, `${item.name}: production parser returned the target candidate`);
    assert.ok(parsed.candidate.source.locator.endByte > parsed.candidate.source.locator.startByte,
      `${item.name}: Unicode whitespace belongs to a positive-length URL-value range`);
    assert.equal(bytes.subarray(parsed.candidate.source.locator.startByte, parsed.candidate.source.locator.endByte).toString('utf8'),
      rawAttributeValue, `${item.name}: parser locator selects the complete original value spelling`);
    assert.equal(Object.hasOwn(parsed, 'emptyAttributeToken'), false, `${item.name}: nonempty decoded value is not an empty-attribute token`);

    const discovered = await discoverAssetCandidates({
      store: harness.store,
      scope,
      document: doc,
      retentionHandle: harness.createPermit(TENANT),
      request: request(TENANT),
    });
    assert.equal(discovered.outcome, 'stored', item.name);
    assert.equal(discovered.sourceHash, digest(bytes), item.name);
    assert.equal(discovered.metadata.contentHash, digest(bytes), item.name);
    const descriptor = discovered.candidates.find((candidate) => candidate.sourceForm === item.form
      && candidate.locator.startByte === parsed.candidate.source.locator.startByte
      && candidate.locator.endByte === parsed.candidate.source.locator.endByte);
    assert.ok(descriptor, `${item.name}: the exact parser range is stored`);
    assert.equal(descriptor.excerptKind, 'url-value', item.name);
    assert.equal(descriptor.excerptHash, digest(Buffer.from(rawAttributeValue, 'utf8')), item.name);
    assert.equal(descriptor.quarantineReason, item.expectedQuarantine, item.name);
    if (item.expectedQuarantine === 'invalid_or_empty') {
      assert.equal(descriptor.normalizedSuggestion, null, item.name);
      assert.equal(descriptor.fetchSuggestion, null, item.name);
    } else {
      assert.equal(descriptor.quarantineReason, null, item.name);
      assert.ok(descriptor.fetchSuggestion?.startsWith('https://events.example.com/'), item.name);
    }
    assert.ok(discovered.candidates.some((candidate) => candidate.sourceForm === 'html-img-src'
      && candidate.fetchSuggestion === 'https://events.example.com/poster.png'), `${item.name}: valid poster is retained`);
    records.push({ ...item, bytes, doc, evidenceId: discovered.metadata.evidenceId, sourceHash: discovered.sourceHash, descriptor });
  }

  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request(TENANT));
  for (const item of records) {
    const evidence = await reopened.lookupEvidence(reopenedScope, item.evidenceId);
    const selected = await reopened.materializeSelected(reopenedScope, { evidence: [evidence], facts: [] }, request(TENANT));
    const view = selected.evidence[0];
    assert.equal(view.source.contentHash, item.sourceHash, item.name);
    assert.equal(view.source.assetSource.selectorVersion, 'ei-asset-source-selector/4', item.name);
    assert.equal(view.source.assetSource.extractorVersion, 'ei-deterministic-extraction/1.4.0', item.name);
    const candidate = view.source.assetSource.candidates.find((entry) => entry.sourceForm === item.form
      && entry.locator.startByte === item.descriptor.locator.startByte
      && entry.locator.endByte === item.descriptor.locator.endByte);
    assert.ok(candidate, `${item.name}: authorized reopened descriptor retains the exact range`);
    assert.equal(candidate.excerptHash, item.descriptor.excerptHash, item.name);
    assert.equal(candidate.excerptKind, 'url-value', item.name);
    assert.equal(candidate.quarantineReason, item.expectedQuarantine, item.name);
    if (item.expectedQuarantine === 'invalid_or_empty') {
      assert.equal(candidate.normalizedSuggestion, null, item.name);
      assert.equal(candidate.fetchSuggestion, null, item.name);
    }
    assert.ok(view.source.assetSource.candidates.some((entry) => entry.sourceForm === 'html-img-src'
      && entry.fetchSuggestion === 'https://events.example.com/poster.png'), `${item.name}: reopened poster remains available`);

    const privateRead = await reopened.withPrivatePayload(reopenedScope, evidence, request(TENANT));
    assert.equal(privateRead.sourceHash, digest(item.bytes), item.name);
    const excerpt = privateRead.positions.find((position) => position.locator.startByte === candidate.locator.startByte
      && position.locator.endByte === candidate.locator.endByte);
    assert.ok(excerpt, `${item.name}: authorized private consumer received the target excerpt`);
    assert.equal(item.bytes.subarray(excerpt.locator.startByte, excerpt.locator.endByte).toString('utf8'), excerpt.text, item.name);
    assert.equal(excerpt.text, item.value, item.name);
    assert.equal(excerpt.contentHash, candidate.excerptHash, item.name);
  }
});

test('fatal XHTML parser failures reject before empty discovery without writing any evidence', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const emptyDatabase = readDatabaseIfPresent(harness.directory);
  assert.equal(emptyDatabase.evidenceCount, 0);
  assert.equal(emptyDatabase.factCount, 0);
  assert.equal(emptyDatabase.bundleCount, 0);

  const fatalCases = [
    {
      name: 'malformed XML',
      source: '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="https://diagnostic-secret.invalid/malformed.png"></body></html>',
      diagnostic: 'MALFORMED_XHTML',
      marker: 'diagnostic-secret.invalid',
    },
    {
      name: 'unsupported internal DTD',
      source: '<!DOCTYPE html [<!ENTITY private "diagnostic-secret">]><html xmlns="http://www.w3.org/1999/xhtml"><body><img src="/dtd.png" /></body></html>',
      diagnostic: 'XHTML_DTD_UNSUPPORTED',
      marker: 'diagnostic-secret',
    },
  ];
  for (const item of fatalCases) {
    const doc = documentFrom(item.source, { contentType: 'application/xhtml+xml; charset=utf-8' });
    const extraction = await extractDeterministically(doc);
    assert.equal(extraction.status, 'NO_ANSWER', item.name);
    assert.equal(extraction.termination, null, item.name);
    assert.ok(extraction.diagnostics.some((diagnostic) => diagnostic.code === item.diagnostic), item.name);
    assert.equal(JSON.stringify(extraction.diagnostics).includes(item.marker), false, `${item.name} diagnostics must not echo source text`);

    const result = await harness.store.ingestAssetSourceEvidence(
      scope, sourceInput(doc, harness.createPermit(TENANT)), request(TENANT),
    );
    assert.deepEqual(result, { outcome: 'rejected', code: 'SOURCE_UNSUPPORTED_OR_MALFORMED' }, item.name);
    assert.equal(JSON.stringify(result).includes(item.marker), false, item.name);
    assert.deepEqual(readDatabaseIfPresent(harness.directory), emptyDatabase, `${item.name} must not write evidence, facts, or a bundle prefix`);
  }

  const empty = documentFrom(
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Valid empty source</p></body></html>',
    { contentType: 'application/xhtml+xml; charset=utf-8' },
  );
  const emptyExtraction = await extractDeterministically(empty);
  assert.equal(emptyExtraction.status, 'PARTIAL');
  assert.deepEqual(emptyExtraction.assetSources, []);
  const noCandidates = await harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(empty, harness.createPermit(TENANT)), request(TENANT),
  );
  assert.deepEqual(noCandidates, { outcome: 'no-candidates', code: 'NO_STATIC_ASSET_CANDIDATES' });
  assert.deepEqual(readDatabaseIfPresent(harness.directory), emptyDatabase);

  const validAsset = documentFrom(
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="/valid.png" /></body></html>',
    { contentType: 'application/xhtml+xml; charset=utf-8' },
  );
  const validStored = await harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(validAsset, harness.createPermit(TENANT)), request(TENANT),
  );
  assert.equal(validStored.outcome, 'stored');

  const recovered = documentFrom('<html><body><img src="/recovered.png"><p>Recovered page</body>', {
    contentType: 'text/html; charset=utf-8',
  });
  const recoveredExtraction = await extractDeterministically(recovered);
  assert.ok(recoveredExtraction.diagnostics.some((diagnostic) => diagnostic.code === 'HTML_RECOVERED_PARSE_ERROR'));
  assert.ok(recoveredExtraction.assetSources.some((asset) => asset.candidate.normalizedValue === '/recovered.png'));
  const recoveredStored = await harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(recovered, harness.createPermit(TENANT)), request(TENANT),
  );
  assert.equal(recoveredStored.outcome, 'stored', 'ordinary recoverable HTML parser behavior remains usable');
});

test('asset URL quarantine checks original policy syntax across HTML, XHTML, JSON-LD, and protocol-relative values', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const denied = [
    { name: 'HTML hexadecimal host', raw: 'http://0x08080808/logo.png', type: 'text/html; charset=utf-8', form: 'html-img-src' },
    { name: 'XHTML integer host', raw: 'http://134744072/logo.png', type: 'application/xhtml+xml; charset=utf-8', form: 'html-img-src' },
    { name: 'JSON-LD octal host', raw: 'http://010.010.010.010/logo.png', type: 'application/ld+json', form: 'jsonld-image' },
    { name: 'HTML protocol-relative hexadecimal host', raw: '//0x08080808/logo.png', type: 'text/html; charset=utf-8', form: 'html-img-src', protocolRelative: true },
    { name: 'XHTML protocol-relative non-canonical port', raw: '//cdn.example.com:0443/logo.png', type: 'application/xhtml+xml; charset=utf-8', form: 'html-img-src', protocolRelative: true },
    { name: 'JSON-LD protocol-relative backslash', raw: '//cdn.example.com\\logo.png', type: 'application/ld+json', form: 'jsonld-image', protocolRelative: true },
    { name: 'HTML tab inside scheme', raw: 'h\tttp://0x08080808/logo.png', type: 'text/html; charset=utf-8', form: 'html-img-src' },
    { name: 'XHTML tab inside protocol-relative authority', raw: '/\t/0x08080808/logo.png', type: 'application/xhtml+xml; charset=utf-8', form: 'html-img-src', protocolRelative: true },
    { name: 'XHTML newline inside path', raw: 'http://0x08080808/\nlogo.png', type: 'application/xhtml+xml; charset=utf-8', form: 'html-img-src' },
    { name: 'JSON-LD escaped C0 before scheme', raw: '\u0001http://0x08080808/logo.png', type: 'application/ld+json', form: 'jsonld-image' },
    { name: 'JSON-LD DEL before scheme', raw: '\u007fhttp://0x08080808/logo.png', type: 'application/ld+json', form: 'jsonld-image' },
    { name: 'JSON-LD escaped tab inside scheme', raw: 'h\tttp://0x08080808/logo.png', type: 'application/ld+json', form: 'jsonld-image' },
    { name: 'HTML entity-decoded tab inside scheme', raw: 'h\tttp://0x08080808/logo.png', sourceRaw: 'h&#9;ttp://0x08080808/logo.png', type: 'text/html; charset=utf-8', form: 'html-img-src' },
    { name: 'HTML non-canonical port', raw: 'https://cdn.example.com:0443/logo.png', type: 'text/html; charset=utf-8', form: 'html-img-src' },
    { name: 'XHTML backslash separator', raw: 'https://cdn.example.com\\logo.png', type: 'application/xhtml+xml; charset=utf-8', form: 'html-img-src' },
  ];
  const accepted = {
    name: 'valid protocol-relative host',
    raw: '//cdn.example.com/logo.png',
    type: 'application/ld+json',
    form: 'jsonld-image',
    protocolRelative: true,
  };
  const allCases = [...denied, accepted];
  const records = [];

  for (const [index, item] of allCases.entries()) {
    const policyInput = item.protocolRelative ? `https:${item.raw}` : item.raw;
    if (item === accepted) {
      assert.equal(parseAndValidateUrl(policyInput).url.hostname, 'cdn.example.com');
    } else {
      assert.throws(() => parseAndValidateUrl(policyInput), (error) => error.code === 'POLICY_DENIED', item.name);
    }

    const sourceValue = item.sourceRaw ?? item.raw;
    const bytes = item.type === 'application/ld+json'
      ? Buffer.from(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Event', name: 'Policy fixture', image: item.raw }))
      : Buffer.from(item.type.startsWith('application/xhtml+xml')
        ? `<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="${sourceValue}" /></body></html>`
        : `<html><body><img src="${sourceValue}"></body></html>`);
    const doc = documentFrom(bytes, {
      contentType: item.type,
      url: `https://events.example.com/policy-fixtures/${index}.html`,
    });
    const extraction = await extractDeterministically(doc);
    const extractedAsset = extraction.assetSources.find((entry) => entry.sourceForm === item.form);
    assert.ok(extractedAsset, item.name);
    assert.equal(extractedAsset.urlPolicyValue, item.raw, `${item.name} keeps parser-decoded pre-normalization syntax`);
    if (item.raw.includes('\t') || item.raw.includes('\n')) {
      assert.notEqual(extractedAsset.candidate.normalizedValue, item.raw, `${item.name} demonstrates the parser's existing whitespace normalization`);
    }
    assert.equal(Object.getOwnPropertyDescriptor(extractedAsset, 'urlPolicyValue').enumerable, false, item.name);
    assert.equal(JSON.stringify(extractedAsset).includes('urlPolicyValue'), false, `${item.name} does not serialize the internal policy value`);
    const discovered = await discoverAssetCandidates({
      store: harness.store,
      scope,
      document: doc,
      retentionHandle: harness.createPermit(TENANT),
      request: request(TENANT),
    });
    assert.equal(discovered.outcome, 'stored', item.name);
    assert.equal(discovered.sourceHash, digest(bytes), item.name);
    const candidate = discovered.candidates.find((entry) => entry.sourceForm === item.form);
    assert.ok(candidate, item.name);
    if (item === accepted) {
      assert.equal(candidate.quarantineReason, null);
      assert.equal(candidate.normalizedSuggestion, 'https://cdn.example.com/logo.png');
      assert.equal(candidate.fetchSuggestion, 'https://cdn.example.com/logo.png');
    } else {
      assert.equal(candidate.quarantineReason, 'url_policy_denied', item.name);
      assert.equal(candidate.normalizedSuggestion, null, item.name);
      assert.equal(candidate.fetchSuggestion, null, item.name);
      assert.equal(JSON.stringify(discovered).includes(item.raw), false, `${item.name} must not leak the rejected URL`);
    }
    records.push({ item, bytes, evidenceId: discovered.metadata.evidenceId, sourceHash: discovered.sourceHash, candidate });
  }

  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request(TENANT));
  for (const record of records) {
    const evidence = await reopened.lookupEvidence(reopenedScope, record.evidenceId);
    const selected = await reopened.materializeSelected(reopenedScope, { evidence: [evidence], facts: [] }, request(TENANT));
    const reopenedCandidate = selected.evidence[0].source.assetSource.candidates.find((entry) => entry.sourceForm === record.item.form);
    assert.equal(selected.evidence[0].source.contentHash, record.sourceHash, record.item.name);
    assert.equal(reopenedCandidate.quarantineReason, record.candidate.quarantineReason, record.item.name);
    assert.equal(reopenedCandidate.normalizedSuggestion, record.candidate.normalizedSuggestion, record.item.name);
    assert.equal(reopenedCandidate.fetchSuggestion, record.candidate.fetchSuggestion, record.item.name);
    const privateRead = await reopened.withPrivatePayload(reopenedScope, evidence, request(TENANT));
    assert.equal(privateRead.sourceHash, digest(record.bytes), record.item.name);
    const excerpt = privateRead.positions.find((position) => position.locator.startByte === reopenedCandidate.locator.startByte
      && position.locator.endByte === reopenedCandidate.locator.endByte);
    assert.ok(excerpt, record.item.name);
    assert.equal(record.bytes.subarray(excerpt.locator.startByte, excerpt.locator.endByte).toString('utf8'), excerpt.text, record.item.name);
    assert.equal(excerpt.contentHash, reopenedCandidate.excerptHash, record.item.name);
  }
});

test('selector 4 keeps selector 1 encrypted asset records readable without rewriting them', async (t) => {
  const harness = await createHarness(t);
  const requestValue = request(TENANT);
  const doc = documentFrom('<html><body><img src="http://0x08080808/logo.png"></body></html>', {
    url: 'https://events.example.com/selector-profile/history.html',
  });
  const legacyModule = await loadPinnedSelectorOneStore(t);
  const legacyHarness = createPinnedLegacyOptions(harness.directory);
  const legacyStore = legacyModule.createEvidenceStore(legacyHarness.options);
  const legacyScope = await legacyStore.scopeForAuthenticatedRequest(requestValue);
  const legacyWritten = await legacyStore.ingestAssetSourceEvidence(
    legacyScope, sourceInput(doc, legacyHarness.createPermit(TENANT)), requestValue,
  );
  assert.equal(legacyWritten.outcome, 'stored');
  assert.equal(legacyWritten.created, true);
  const legacyId = legacyWritten.metadata.evidenceId;
  const legacySealed = readEvidenceBytes(harness.directory, legacyId);
  const beforeCurrentWrite = readDatabase(harness.directory);
  assert.equal(beforeCurrentWrite.manifest.records[legacyId].representation, 'asset-source-excerpt');
  assert.equal(beforeCurrentWrite.manifest.records[legacyId].version, 1);

  const currentBeforeWrite = harness.openStore();
  const currentScopeBeforeWrite = await currentBeforeWrite.scopeForAuthenticatedRequest(requestValue);
  const legacyHandle = await currentBeforeWrite.lookupEvidence(currentScopeBeforeWrite, legacyId);
  const legacyView = await currentBeforeWrite.materializeSelected(
    currentScopeBeforeWrite, { evidence: [legacyHandle], facts: [] }, requestValue,
  );
  const legacyCandidate = legacyView.evidence[0].source.assetSource.candidates[0];
  assert.equal(legacyView.evidence[0].source.assetSource.selectorVersion, 'ei-asset-source-selector/1');
  assert.equal(legacyCandidate.fetchSuggestion, 'http://8.8.8.8/logo.png');
  assert.equal(Object.hasOwn(legacyCandidate, 'excerptKind'), false, 'historical selector 1 keeps its original metadata shape');

  const currentWritten = await currentBeforeWrite.ingestAssetSourceEvidence(
    currentScopeBeforeWrite, sourceInput(doc, harness.createPermit(TENANT)), requestValue,
  );
  assert.equal(currentWritten.outcome, 'stored');
  assert.equal(currentWritten.created, true);
  assert.equal(currentWritten.metadata.version, 2);
  assert.notEqual(currentWritten.metadata.evidenceId, legacyId);
  assert.deepEqual(readEvidenceBytes(harness.directory, legacyId), legacySealed, 'selector-one ciphertext remains byte-identical');

  const currentAfterRestart = harness.openStore();
  const currentScopeAfterRestart = await currentAfterRestart.scopeForAuthenticatedRequest(requestValue);
  const oldAfterRestart = await currentAfterRestart.lookupEvidence(currentScopeAfterRestart, legacyId);
  const newAfterRestart = await currentAfterRestart.lookupEvidence(currentScopeAfterRestart, currentWritten.metadata.evidenceId);
  const oldReadback = await currentAfterRestart.materializeSelected(
    currentScopeAfterRestart, { evidence: [oldAfterRestart], facts: [] }, requestValue,
  );
  const newReadback = await currentAfterRestart.materializeSelected(
    currentScopeAfterRestart, { evidence: [newAfterRestart], facts: [] }, requestValue,
  );
  assert.equal(oldReadback.evidence[0].source.assetSource.selectorVersion, 'ei-asset-source-selector/1');
  assert.equal(oldReadback.evidence[0].source.assetSource.candidates[0].fetchSuggestion, 'http://8.8.8.8/logo.png');
  assert.equal(newReadback.evidence[0].source.assetSource.selectorVersion, 'ei-asset-source-selector/4');
  assert.equal(newReadback.evidence[0].source.assetSource.extractorVersion, 'ei-deterministic-extraction/1.4.0');
  assert.equal(newReadback.evidence[0].source.assetSource.candidates[0].excerptKind, 'url-value');
  assert.equal(newReadback.evidence[0].source.assetSource.candidates[0].quarantineReason, 'url_policy_denied');
  assert.equal(newReadback.evidence[0].source.assetSource.candidates[0].normalizedSuggestion, null);
  assert.equal(newReadback.evidence[0].source.assetSource.candidates[0].fetchSuggestion, null);
  assert.deepEqual(readEvidenceBytes(harness.directory, legacyId), legacySealed);
});

test('selector 4 keeps actual selector 2 producer records readable without rewriting them', async (t) => {
  const harness = await createHarness(t);
  const requestValue = request(TENANT);
  const doc = documentFrom('<html><body><img src="http://0x08080808/logo.png"></body></html>', {
    url: 'https://events.example.com/selector-profile/selector-two.html',
  });
  const legacyModule = await loadPinnedSelectorTwoStore(t);
  const legacyHarness = createPinnedLegacyOptions(harness.directory);
  const legacyStore = legacyModule.createEvidenceStore(legacyHarness.options);
  const legacyScope = await legacyStore.scopeForAuthenticatedRequest(requestValue);
  const legacyWritten = await legacyStore.ingestAssetSourceEvidence(
    legacyScope, sourceInput(doc, legacyHarness.createPermit(TENANT)), requestValue,
  );
  assert.equal(legacyWritten.outcome, 'stored');
  assert.equal(legacyWritten.created, true);
  const legacyId = legacyWritten.metadata.evidenceId;
  const legacySealed = readEvidenceBytes(harness.directory, legacyId);

  const current = harness.openStore();
  const currentScope = await current.scopeForAuthenticatedRequest(requestValue);
  const oldHandle = await current.lookupEvidence(currentScope, legacyId);
  const oldBeforeWrite = await current.materializeSelected(currentScope, { evidence: [oldHandle], facts: [] }, requestValue);
  const oldCandidate = oldBeforeWrite.evidence[0].source.assetSource.candidates[0];
  assert.equal(oldBeforeWrite.evidence[0].source.assetSource.selectorVersion, 'ei-asset-source-selector/2');
  assert.equal(oldCandidate.quarantineReason, 'url_policy_denied');
  assert.equal(oldCandidate.normalizedSuggestion, null);
  assert.equal(oldCandidate.fetchSuggestion, null);
  assert.equal(Object.hasOwn(oldCandidate, 'excerptKind'), false, 'historical selector 2 keeps its original metadata shape');

  const currentWritten = await current.ingestAssetSourceEvidence(
    currentScope, sourceInput(doc, harness.createPermit(TENANT)), requestValue,
  );
  assert.equal(currentWritten.outcome, 'stored');
  assert.equal(currentWritten.created, true);
  assert.equal(currentWritten.metadata.version, 2);
  assert.notEqual(currentWritten.metadata.evidenceId, legacyId);
  assert.deepEqual(readEvidenceBytes(harness.directory, legacyId), legacySealed, 'selector-two ciphertext remains byte-identical');

  const restarted = harness.openStore();
  const restartedScope = await restarted.scopeForAuthenticatedRequest(requestValue);
  const oldAfterRestart = await restarted.lookupEvidence(restartedScope, legacyId);
  const newAfterRestart = await restarted.lookupEvidence(restartedScope, currentWritten.metadata.evidenceId);
  const oldReadback = await restarted.materializeSelected(restartedScope, { evidence: [oldAfterRestart], facts: [] }, requestValue);
  const newReadback = await restarted.materializeSelected(restartedScope, { evidence: [newAfterRestart], facts: [] }, requestValue);
  assert.equal(oldReadback.evidence[0].source.assetSource.selectorVersion, 'ei-asset-source-selector/2');
  assert.equal(oldReadback.evidence[0].source.assetSource.candidates[0].quarantineReason, 'url_policy_denied');
  assert.equal(newReadback.evidence[0].source.assetSource.selectorVersion, 'ei-asset-source-selector/4');
  assert.equal(newReadback.evidence[0].source.assetSource.extractorVersion, 'ei-deterministic-extraction/1.4.0');
  assert.equal(newReadback.evidence[0].source.assetSource.candidates[0].excerptKind, 'url-value');
  assert.equal(newReadback.evidence[0].source.assetSource.candidates[0].quarantineReason, 'url_policy_denied');
  assert.deepEqual(readEvidenceBytes(harness.directory, legacyId), legacySealed);
});

test('selector 4 reads actual selector 3 producer ciphertext without relabeling it', async (t) => {
  const harness = await createHarness(t);
  const requestValue = request(TENANT);
  const doc = documentFrom('<html><body><img src=""><img src="/poster.png"></body></html>', {
    url: 'https://events.example.com/selector-profile/selector-three.html',
  });
  const legacyModule = await loadPinnedSelectorThreeStore(t);
  const legacyHarness = createPinnedLegacyOptions(harness.directory);
  const legacyStore = legacyModule.createEvidenceStore(legacyHarness.options);
  const legacyScope = await legacyStore.scopeForAuthenticatedRequest(requestValue);
  const legacyWritten = await legacyStore.ingestAssetSourceEvidence(
    legacyScope, sourceInput(doc, legacyHarness.createPermit(TENANT)), requestValue,
  );
  assert.equal(legacyWritten.outcome, 'stored');
  assert.equal(legacyWritten.created, true);
  const legacyId = legacyWritten.metadata.evidenceId;
  const legacySealed = readEvidenceBytes(harness.directory, legacyId);
  const legacyBundle = openBundle(legacySealed, legacyId);
  assert.equal(legacyBundle.assetSource.selectorVersion, 'ei-asset-source-selector/3');
  assert.equal(legacyBundle.assetSource.extractorVersion, 'ei-deterministic-extraction/1.3.0');
  assert.ok(legacyBundle.assetSource.candidates.some((candidate) => candidate.excerptKind === 'html-empty-attribute-token'));

  const current = harness.openStore();
  const currentScope = await current.scopeForAuthenticatedRequest(requestValue);
  const oldHandle = await current.lookupEvidence(currentScope, legacyId);
  const oldBeforeWrite = await current.materializeSelected(currentScope, { evidence: [oldHandle], facts: [] }, requestValue);
  const oldProvenance = oldBeforeWrite.evidence[0].source.assetSource;
  assert.equal(oldProvenance.selectorVersion, 'ei-asset-source-selector/3');
  assert.equal(oldProvenance.extractorVersion, 'ei-deterministic-extraction/1.3.0');
  assert.ok(oldProvenance.candidates.some((candidate) => candidate.excerptKind === 'html-empty-attribute-token'));

  const currentWritten = await current.ingestAssetSourceEvidence(
    currentScope, sourceInput(doc, harness.createPermit(TENANT)), requestValue,
  );
  assert.equal(currentWritten.outcome, 'stored');
  assert.equal(currentWritten.created, true);
  assert.notEqual(currentWritten.metadata.evidenceId, legacyId);
  assert.deepEqual(readEvidenceBytes(harness.directory, legacyId), legacySealed,
    'authentic selector-3 ciphertext remains byte-identical after a selector-4 write');

  const restarted = harness.openStore();
  const restartedScope = await restarted.scopeForAuthenticatedRequest(requestValue);
  const oldAfterRestart = await restarted.lookupEvidence(restartedScope, legacyId);
  const newAfterRestart = await restarted.lookupEvidence(restartedScope, currentWritten.metadata.evidenceId);
  const oldReadback = await restarted.materializeSelected(restartedScope, { evidence: [oldAfterRestart], facts: [] }, requestValue);
  const newReadback = await restarted.materializeSelected(restartedScope, { evidence: [newAfterRestart], facts: [] }, requestValue);
  const oldAssetSource = oldReadback.evidence[0].source.assetSource;
  const newAssetSource = newReadback.evidence[0].source.assetSource;
  assert.equal(oldAssetSource.selectorVersion, 'ei-asset-source-selector/3');
  assert.equal(oldAssetSource.extractorVersion, 'ei-deterministic-extraction/1.3.0');
  const oldEmptyToken = oldAssetSource.candidates.find((candidate) => candidate.excerptKind === 'html-empty-attribute-token');
  assert.ok(oldEmptyToken);
  assert.equal(oldEmptyToken.quarantineReason, 'invalid_or_empty');
  assert.equal(oldEmptyToken.normalizedSuggestion, null);
  assert.equal(oldEmptyToken.fetchSuggestion, null);
  assert.equal(newAssetSource.selectorVersion, 'ei-asset-source-selector/4');
  assert.equal(newAssetSource.extractorVersion, 'ei-deterministic-extraction/1.4.0');
  assert.ok(newAssetSource.candidates.some((candidate) => candidate.excerptKind === 'html-empty-attribute-token'));
  const oldPrivate = await restarted.withPrivatePayload(restartedScope, oldAfterRestart, requestValue);
  assert.equal(oldPrivate.sourceHash, digest(doc.bytes));
  const oldTokenPosition = oldPrivate.positions.find((position) => JSON.stringify(position.locator) === JSON.stringify(oldEmptyToken.locator));
  assert.ok(oldTokenPosition);
  assert.equal(oldTokenPosition.text, 'src=""');
  assert.equal(oldTokenPosition.contentHash, oldEmptyToken.excerptHash);
  assert.deepEqual(readEvidenceBytes(harness.directory, legacyId), legacySealed);
});

test('source-family identity coexists with raw source composition in either ingestion order and survives replay/restart', async (t) => {
  for (const order of ['composer-first', 'asset-first']) {
    await t.test(order, async (t2) => {
      const harness = await createHarness(t2);
      const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
      const doc = documentFrom(eventPage());
      const originalHash = digest(doc.bytes);
      let composer;
      let asset;
      if (order === 'composer-first') {
        composer = await composeSourceIdentity(composeInput(harness.store, doc, harness.createPermit(TENANT)));
        asset = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(doc, harness.createPermit(TENANT)), request(TENANT));
      } else {
        asset = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(doc, harness.createPermit(TENANT)), request(TENANT));
        composer = await composeSourceIdentity(composeInput(harness.store, doc, harness.createPermit(TENANT)));
      }
      assert.equal(asset.outcome, 'stored');
      assert.equal(asset.created, true);
      assert.equal(composer.sources[0].evidence.contentHash, originalHash);
      assert.equal(composer.sources[0].storedSource.contentHash, originalHash);
      assert.ok(composer.sources[0].evidence.positionCount > 0);
      assert.ok(composer.facts.length > 0);
      const firstManifest = readDatabase(harness.directory);
      const firstAssetRecord = firstManifest.manifest.records[asset.metadata.evidenceId];
      const firstRawRecord = firstManifest.manifest.records[composer.sources[0].evidence.evidenceId];
      assert.equal(firstAssetRecord.representation, 'asset-source-excerpt');
      assert.equal(firstRawRecord.representation, undefined);
      assert.equal(firstAssetRecord.contentHash, firstRawRecord.contentHash);
      assert.equal(firstAssetRecord.duplicateGroupId, firstRawRecord.duplicateGroupId);
      assert.equal(firstManifest.manifest.schemaVersion, 3);
      assert.equal(Object.values(firstManifest.manifest.families).filter((family) => family.representation === 'asset-source-excerpt').length, 1);
      assert.equal(Object.values(firstManifest.manifest.families).filter((family) => family.representation === undefined).length, 1);
      assert.equal(firstManifest.evidenceCount, 2);

      const restartStore = harness.openStore();
      const restartedScope = await restartStore.scopeForAuthenticatedRequest(request(TENANT));
      const assetReplay = await restartStore.ingestAssetSourceEvidence(
        restartedScope, sourceInput(doc, harness.createPermit(TENANT)), request(TENANT),
      );
      assert.equal(assetReplay.created, false);
      assert.equal(assetReplay.metadata.evidenceId, asset.metadata.evidenceId);
      const composerReplay = await composeSourceIdentity(composeInput(restartStore, doc, harness.createPermit(TENANT)));
      assert.equal(composerReplay.sources[0].evidence.evidenceId, composer.sources[0].evidence.evidenceId);
      const rawReplay = await restartStore.ingestEvidence(restartedScope, {
        sourceUrl: doc.url,
        content: Buffer.from(doc.bytes),
        contentType: doc.contentType,
        retrievedAt: doc.fetchedAt,
        sourceKind: 'external',
        retentionHandle: harness.createPermit(TENANT),
        positions: composer.sources[0].extraction.events.flatMap((event) => event.candidates
          .filter((candidate) => ['name', 'startDate'].includes(candidate.field))
          .map((candidate) => ({ locator: candidate.source.locator, content: candidate.rawValue }))),
      });
      assert.equal(rawReplay.created, false);
      assert.equal(rawReplay.metadata.evidenceId, composer.sources[0].evidence.evidenceId);
      assert.deepEqual(readDatabase(harness.directory).manifest.records[asset.metadata.evidenceId], firstAssetRecord);
      assert.deepEqual(readDatabase(harness.directory).manifest.records[rawReplay.metadata.evidenceId], firstRawRecord);
    });
  }
});

test('asset-derived issued and reopened positions cannot support ordinary facts or conflicts using the original full source hash', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const doc = documentFrom(eventPage());
  const fullSourceHash = digest(doc.bytes);
  const asset = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(doc, harness.createPermit(TENANT)), request(TENANT));
  assert.equal(asset.outcome, 'stored');
  const before = readDatabase(harness.directory);
  const support = {
    evidence: asset.evidence,
    position: asset.positions[0],
    contentHash: fullSourceHash,
  };
  await assert.rejects(harness.store.appendFact(scope, {
    field: 'event.name', status: 'sourced', rawValue: 'Asset image URL', normalizedValue: 'Asset image URL',
    supports: [support],
  }, request(TENANT)), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assert.deepEqual(readDatabase(harness.directory), before);

  const rawText = 'A separate actual raw source remains valid';
  const raw = await harness.store.ingestEvidence(scope, {
    sourceUrl: 'https://events.example.com/ordinary-source.txt',
    content: rawText,
    contentType: 'text/plain',
    retrievedAt: FETCHED_AT,
    sourceKind: 'external',
    retentionHandle: harness.createPermit(TENANT),
    positions: [{ locator: { kind: 'text-range', startByte: 0, endByte: Buffer.byteLength(rawText) }, content: rawText }],
  });
  const validRawFact = await harness.store.appendFact(scope, {
    field: 'event.name', status: 'sourced', rawValue: rawText, normalizedValue: rawText,
    supports: [{ evidence: raw.evidence, position: raw.positions[0], contentHash: raw.metadata.contentHash }],
  }, request(TENANT));
  const secondRawText = 'A second separate valid raw source';
  const secondRaw = await harness.store.ingestEvidence(scope, {
    sourceUrl: 'https://events.example.com/second-ordinary-source.txt',
    content: secondRawText,
    contentType: 'text/plain',
    retrievedAt: FETCHED_AT,
    sourceKind: 'external',
    retentionHandle: harness.createPermit(TENANT),
    positions: [{ locator: { kind: 'text-range', startByte: 0, endByte: Buffer.byteLength(secondRawText) }, content: secondRawText }],
  });
  const validRawConflict = await harness.store.appendFact(scope, {
    field: 'event.name', status: 'conflicting', candidates: [
      { originStatus: 'sourced', rawValue: rawText, normalizedValue: rawText,
        supports: [{ evidence: raw.evidence, position: raw.positions[0], contentHash: raw.metadata.contentHash }] },
      { originStatus: 'sourced', rawValue: secondRawText, normalizedValue: secondRawText,
        supports: [{ evidence: secondRaw.evidence, position: secondRaw.positions[0], contentHash: secondRaw.metadata.contentHash }] },
    ],
  }, request(TENANT));
  assert.ok(validRawFact);
  assert.ok(validRawConflict);
  const beforeConflictRetry = readDatabase(harness.directory);
  await assert.rejects(harness.store.appendFact(scope, {
    field: 'event.name', status: 'conflicting', candidates: [
      { originStatus: 'sourced', rawValue: rawText, normalizedValue: rawText,
        supports: [{ evidence: raw.evidence, position: raw.positions[0], contentHash: raw.metadata.contentHash }] },
      { originStatus: 'sourced', rawValue: 'Asset position is not a fact', normalizedValue: 'Asset position is not a fact',
        supports: [{ ...support, evidence: asset.evidence, position: asset.positions[0] }] },
    ],
  }, request(TENANT)), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assert.deepEqual(readDatabase(harness.directory), beforeConflictRetry);

  const reopenStore = harness.openStore();
  const reopenScope = await reopenStore.scopeForAuthenticatedRequest(request(TENANT));
  const reopenedHandle = await reopenStore.lookupEvidence(reopenScope, asset.metadata.evidenceId);
  const reopened = await reopenStore.materializeSelected(reopenScope, { evidence: [reopenedHandle], facts: [] }, request(TENANT));
  const reopenedSupport = {
    evidence: reopened.evidence[0].handle,
    position: reopened.evidence[0].positions[0].handle,
    contentHash: fullSourceHash,
  };
  const beforeReopenedAttempt = readDatabase(harness.directory);
  await assert.rejects(reopenStore.appendFact(reopenScope, {
    field: 'event.name', status: 'sourced', rawValue: 'Asset URL after restart', normalizedValue: 'Asset URL after restart',
    supports: [reopenedSupport],
  }, request(TENANT)), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assert.deepEqual(readDatabase(harness.directory), beforeReopenedAttempt);
});

test('source composer rejects the real asset-derived descriptor at the unchanged raw source boundary', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const doc = documentFrom(eventPage());
  const asset = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(doc, harness.createPermit(TENANT)), request(TENANT));
  assert.equal(asset.outcome, 'stored');
  const before = readDatabase(harness.directory);
  const view = Object.create(null);
  for (const method of ['scopeForAuthenticatedRequest', 'appendFact', 'materializeSelected']) {
    view[method] = harness.store[method].bind(harness.store);
  }
  view.ingestEvidence = async () => ({
    evidence: asset.evidence,
    positions: asset.positions,
    created: false,
    metadata: asset.metadata,
  });
  await assert.rejects(composeSourceIdentity(composeInput(view, doc, harness.createPermit(TENANT))),
    (error) => error instanceof SourceIdentityCompositionError && error.code === 'SOURCE_BINDING_FAILED');
  assert.equal(asset.metadata.contentHash, digest(doc.bytes), 'negative control carries the original complete document hash');
  assert.deepEqual(readDatabase(harness.directory), before, 'failed composition adds no raw/fact/bundle rows');
});

test('changed source bytes append immutable same-family asset versions while exact replay reuses the original record', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const firstDocument = documentFrom(eventPage());
  const first = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(firstDocument, harness.createPermit(TENANT)), request(TENANT));
  assert.equal(first.outcome, 'stored');
  const firstBundle = readEvidenceBytes(harness.directory, first.metadata.evidenceId);
  const firstExpiry = first.metadata.expiresAt;
  const firstRetrievedAt = first.metadata.retrievedAt;
  harness.keyState.active['source-index'] = 'source-index-v2';
  harness.keyState.active.payload = 'payload-v2';
  const replayDocument = documentFrom(firstDocument.bytes, {
    fetchedAt: new Date(Date.parse(FETCHED_AT) + 30_000).toISOString(),
  });
  const firstReplay = await harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(replayDocument, harness.createPermit(TENANT)), request(TENANT),
  );
  assert.equal(firstReplay.created, false);
  assert.equal(firstReplay.metadata.evidenceId, first.metadata.evidenceId);
  assert.equal(firstReplay.metadata.retrievedAt, firstRetrievedAt, 'replay returns the original stored retrieval time');
  assert.equal(firstReplay.metadata.expiresAt, firstExpiry, 'replay does not refresh the original retention deadline');
  assert.deepEqual(readEvidenceBytes(harness.directory, first.metadata.evidenceId), firstBundle);
  await assert.rejects(harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(firstDocument, harness.createPermit(TENANT, 10_000)), request(TENANT),
  ), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
  const replayRead = await harness.store.materializeSelected(scope, { evidence: [firstReplay.evidence], facts: [] }, request(TENANT));
  assert.equal(replayRead.evidence[0].source.contentHash, digest(firstDocument.bytes), 'payload-key rotation preserves the original sealed record');

  const changedBytes = Buffer.from(eventPage('<img src="/added-later.png">'));
  const changed = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(documentFrom(changedBytes), harness.createPermit(TENANT)), request(TENANT));
  assert.equal(changed.outcome, 'stored');
  assert.equal(changed.created, true);
  assert.equal(changed.metadata.version, 2);
  assert.equal(changed.metadata.previousEvidenceId, first.metadata.evidenceId);
  assert.equal(changed.metadata.contentHash, digest(changedBytes));
  assert.notEqual(changed.metadata.contentHash, first.metadata.contentHash);
  assert.notEqual(changed.metadata.duplicateGroupId, first.metadata.duplicateGroupId);
  const replayOldVersion = await harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(firstDocument, harness.createPermit(TENANT)), request(TENANT),
  );
  assert.equal(replayOldVersion.created, false);
  assert.equal(replayOldVersion.metadata.evidenceId, first.metadata.evidenceId);
  const records = readDatabase(harness.directory).manifest.records;
  assert.equal(records[first.metadata.evidenceId].state, 'available');
  assert.equal(records[changed.metadata.evidenceId].state, 'available');
});

test('rejects untrusted source URLs and distinguishes malformed/restricted/dynamic/no-candidate outcomes without URL diagnostics', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const bytes = Buffer.from(eventPage());
  const control = await harness.store.ingestAssetSourceEvidence(scope,
    sourceInput(documentFrom(eventPage()), harness.createPermit(TENANT)), request(TENANT));
  assert.equal(control.outcome, 'stored');
  const unchanged = readDatabase(harness.directory);
  const deniedUrls = [
    'http://127.0.0.1/private',
    'https://192.168.4.5/private',
    'https://user:password@events.example.com/calendar',
    'https://events.example.com/calendar?X-Amz-Credential=private-token',
    'https://events.example.com/calendar?invite=private-token',
  ];
  for (const url of deniedUrls) {
    const result = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(documentFrom(bytes, { url }), harness.createPermit(TENANT)), request(TENANT));
    assert.deepEqual(result, { outcome: 'rejected', code: 'SOURCE_URL_POLICY_DENIED' });
    assert.equal(JSON.stringify(result).includes(url), false);
  }
  await assert.rejects(harness.store.ingestAssetSourceEvidence(scope,
    sourceInput(documentFrom(bytes, { redirects: 1 }), harness.createPermit(TENANT)), request(TENANT)),
  (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assert.deepEqual(readDatabase(harness.directory), unchanged);

  const noAssets = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(documentFrom('<html><body><p>A valid page with no asset fields.</p></body></html>'), harness.createPermit(TENANT)), request(TENANT));
  assert.deepEqual(noAssets, { outcome: 'no-candidates', code: 'NO_STATIC_ASSET_CANDIDATES' });
  const malformed = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(documentFrom(
    '<html><body><img src="/poster.png"><script type="application/ld+json">{"@type":"Event","image":,}</script><p>Fallback paragraph.</p></body></html>',
  ), harness.createPermit(TENANT)), request(TENANT));
  assert.deepEqual(malformed, { outcome: 'rejected', code: 'SOURCE_UNSUPPORTED_OR_MALFORMED' });
  const restricted = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(documentFrom(
    '<html><body><h1>Access denied</h1><img src="/blocked.png"></body></html>',
  ), harness.createPermit(TENANT)), request(TENANT));
  assert.deepEqual(restricted, { outcome: 'rejected', code: 'SOURCE_ACCESS_RESTRICTED' });
  const dynamic = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(documentFrom(
    '<html><body><div id="app"></div><noscript>JavaScript is required to continue.</noscript><img src="/dynamic.png"></body></html>',
  ), harness.createPermit(TENANT)), request(TENANT));
  assert.deepEqual(dynamic, { outcome: 'rejected', code: 'SOURCE_DYNAMIC_OR_INCOMPLETE' });
  const badEncoding = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(documentFrom(
    Buffer.from([0x3c, 0x69, 0x6d, 0x67, 0x20, 0x73, 0x72, 0x63, 0x3d, 0x22, 0xff, 0x22, 0x3e]),
  ), harness.createPermit(TENANT)), request(TENANT));
  assert.deepEqual(badEncoding, { outcome: 'rejected', code: 'SOURCE_UNSUPPORTED_OR_MALFORMED' });
  assert.deepEqual(readDatabase(harness.directory), unchanged);
});

test('enforces candidate and UTF-8 excerpt/aggregate byte ceilings with all-or-error persistence', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const images = (count, length) => Array.from({ length: count }, (_, index) =>
    `<img src="data:${String(index).padStart(2, '0')}${'x'.repeat(length - 7)}">`).join('');
  const exactCount = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(documentFrom(images(64, 8)), harness.createPermit(TENANT)), request(TENANT));
  assert.equal(exactCount.outcome, 'stored');
  assert.equal(exactCount.positions.length, 64);
  const countBeforeOver = readDatabase(harness.directory);
  const oneOverCount = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(documentFrom(images(65, 8)), harness.createPermit(TENANT)), request(TENANT));
  assert.deepEqual(oneOverCount, { outcome: 'rejected', code: 'SOURCE_EXTRACTION_INCOMPLETE' });
  assert.deepEqual(readDatabase(harness.directory), countBeforeOver);

  const exactPosition = `data:${'x'.repeat(8 * 1024 - 5)}`;
  const exactExcerpt = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(documentFrom(`<img src="${exactPosition}">`), harness.createPermit(TENANT)), request(TENANT));
  assert.equal(exactExcerpt.outcome, 'stored');
  const exactExcerptCheck = await harness.store.materializeSelected(scope, { evidence: [exactExcerpt.evidence], facts: [] }, request(TENANT));
  assert.equal(exactExcerptCheck.evidence[0].positions[0].contentHash, digest(Buffer.from(exactPosition)));
  const overPosition = `data:${'x'.repeat(8 * 1024 - 4)}`;
  const beforePositionOver = readDatabase(harness.directory);
  await assert.rejects(harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(documentFrom(`<img src="${overPosition}">`), harness.createPermit(TENANT)), request(TENANT),
  ), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assert.deepEqual(readDatabase(harness.directory), beforePositionOver);

  const exactAggregate = await harness.store.ingestAssetSourceEvidence(scope,
    sourceInput(documentFrom(images(8, 8 * 1024)), harness.createPermit(TENANT)), request(TENANT));
  assert.equal(exactAggregate.outcome, 'stored');
  assert.equal(exactAggregate.positions.length, 8);
  const beforeAggregateOver = readDatabase(harness.directory);
  await assert.rejects(harness.store.ingestAssetSourceEvidence(scope,
    sourceInput(documentFrom(images(9, Math.floor((64 * 1024) / 9) + 1)), harness.createPermit(TENANT)), request(TENANT)),
  (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assert.deepEqual(readDatabase(harness.directory), beforeAggregateOver);
});

test('asset writes honor lower configured evidence limits without truncating or persisting a prefix', async (t) => {
  const countLimited = await createHarness(t, { storeOptions: { maxPositionCount: 1 } });
  const countScope = await countLimited.store.scopeForAuthenticatedRequest(request(TENANT));
  const twoCandidates = documentFrom('<html><body><img src="/one.png"><img src="/two.png"></body></html>');
  const countResult = await countLimited.store.ingestAssetSourceEvidence(
    countScope, sourceInput(twoCandidates, countLimited.createPermit(TENANT)), request(TENANT),
  );
  assert.deepEqual(countResult, { outcome: 'rejected', code: 'SOURCE_EXTRACTION_INCOMPLETE' });
  assert.equal(existsSync(path.join(countLimited.directory, tenantHash())), false);

  const exactPosition = await createHarness(t, { storeOptions: { maxPositionCount: 1 } });
  const exactScope = await exactPosition.store.scopeForAuthenticatedRequest(request(TENANT));
  const oneCandidate = documentFrom('<html><body><img src="/one.png"></body></html>');
  const exactResult = await exactPosition.store.ingestAssetSourceEvidence(
    exactScope, sourceInput(oneCandidate, exactPosition.createPermit(TENANT)), request(TENANT),
  );
  assert.equal(exactResult.outcome, 'stored');
  assert.equal(exactResult.positions.length, 1);

  for (const [name, storeOptions, html] of [
    ['source', { maxSourceBytes: 32 }, '<html><body><img src="/bounded-source.png"></body></html>'],
    ['position', { maxPositionBytes: 8 }, '<html><body><img src="/long-image-name.png"></body></html>'],
    ['aggregate', { maxStoredPayloadBytes: 10 }, '<html><body><img src="/a.png"><img src="/b.png"></body></html>'],
  ]) {
    await t.test(name, async (t2) => {
      const limited = await createHarness(t2, { storeOptions });
      const scope = await limited.store.scopeForAuthenticatedRequest(request(TENANT));
      await assert.rejects(limited.store.ingestAssetSourceEvidence(
        scope, sourceInput(documentFrom(html), limited.createPermit(TENANT)), request(TENANT),
      ), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
      assert.equal(existsSync(path.join(limited.directory, tenantHash())), false);
    });
  }
});

test('rejects candidate metadata over its independent byte ceiling before persistence', async (t) => {
  const harness = await createHarness(t);
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const image = (index) => `https://cdn.example.com/${String(index).padStart(2, '0')}/${'x'.repeat(700)}`;
  const bytes = Buffer.from(JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: 'Large static asset metadata fixture',
    image: Array.from({ length: 64 }, (_, index) => image(index)),
  }));
  assert.ok(bytes.length < 2 * 1024 * 1024, 'source remains below the independent document byte ceiling');
  await assert.rejects(harness.store.ingestAssetSourceEvidence(
    scope,
    sourceInput(documentFrom(bytes, { contentType: 'application/ld+json' }), harness.createPermit(TENANT)),
    request(TENANT),
  ), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assert.equal(existsSync(path.join(harness.directory, tenantHash())), false,
    'oversized normalized URL associations do not leave a manifest or sealed prefix');
});

test('the exact two MiB source ceiling is accepted and one byte over is rejected before persistence', async (t) => {
  const limit = 2 * 1024 * 1024;
  const opening = Buffer.from('<html><body><img src="/bounded.png"></body></html><!--');
  const closing = Buffer.from('-->');
  const exactBytes = Buffer.concat([
    opening,
    Buffer.alloc(limit - opening.length - closing.length, 0x78),
    closing,
  ]);
  assert.equal(exactBytes.length, limit);

  const exactHarness = await createHarness(t);
  const exactScope = await exactHarness.store.scopeForAuthenticatedRequest(request(TENANT));
  const exact = await exactHarness.store.ingestAssetSourceEvidence(
    exactScope,
    sourceInput(documentFrom(exactBytes), exactHarness.createPermit(TENANT)),
    request(TENANT),
  );
  assert.equal(exact.outcome, 'stored');
  assert.equal(exact.metadata.contentHash, digest(exactBytes));

  const overHarness = await createHarness(t);
  const overScope = await overHarness.store.scopeForAuthenticatedRequest(request(TENANT));
  const overBytes = Buffer.concat([exactBytes, Buffer.from('x')]);
  await assert.rejects(overHarness.store.ingestAssetSourceEvidence(
    overScope,
    sourceInput(documentFrom(overBytes), overHarness.createPermit(TENANT)),
    request(TENANT),
  ), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INVALID');
  assert.equal(existsSync(path.join(overHarness.directory, tenantHash())), false);
});

test('current ACL, tenant isolation, expiration, and cancellation remain final gates for asset excerpts', async (t) => {
  let allowed = true;
  const clock = { value: EPOCH };
  const harness = await createHarness(t, {
    clock,
    authorizePrivateAccessCurrent: ({ tenantId, request: authRequest }) => allowed
      && authRequest?.principal?.tenantId === tenantId && authRequest.allowPrivate === true,
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const doc = documentFrom(eventPage());
  const asset = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(doc, harness.createPermit(TENANT)), request(TENANT));
  assert.equal(asset.outcome, 'stored');
  const otherTenant = await harness.store.scopeForAuthenticatedRequest(request('tenant-other'));
  await assert.rejects(harness.store.materializeSelected(otherTenant, { evidence: [asset.evidence], facts: [] }, request('tenant-other')),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
  allowed = false;
  await assert.rejects(harness.store.materializeSelected(scope, { evidence: [asset.evidence], facts: [] }, request(TENANT)),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
  allowed = true;
  clock.value += 60_001;
  await assert.rejects(harness.store.materializeSelected(scope, { evidence: [asset.evidence], facts: [] }, request(TENANT)),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
  assert.equal(readDatabase(harness.directory).manifest.records[asset.metadata.evidenceId].state, 'expired');

  const fresh = await createHarness(t);
  const freshScope = await fresh.store.scopeForAuthenticatedRequest(request(TENANT));
  const canceled = new AbortController();
  canceled.abort();
  await assert.rejects(fresh.store.ingestAssetSourceEvidence(
    freshScope, sourceInput(doc, fresh.createPermit(TENANT)), request(TENANT), canceled.signal,
  ), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_CANCELLED');
  assert.equal(existsSync(path.join(fresh.directory, tenantHash())), false, 'pre-aborted parser created no tenant store rows');
});

test('asset persistence rechecks current ACL, retention, and cancellation after a delayed key resolution', async (t) => {
  for (const [name, expectedCode] of [
    ['acl', 'EVIDENCE_DENIED'],
    ['retention', 'EVIDENCE_EXPIRED'],
    ['cancellation', 'EVIDENCE_CANCELLED'],
  ]) {
    await t.test(name, async (t2) => {
      const clock = { value: EPOCH };
      let allowed = true;
      const harness = await createHarness(t2, {
        clock,
        authorizePrivateAccessCurrent: ({ action }) => action !== 'ingest_asset_source_evidence' || allowed,
      });
      const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
      const gate = harness.armPayloadGate();
      const abort = new AbortController();
      const permit = harness.createPermit(TENANT, 2_000);
      const attempt = harness.store.ingestAssetSourceEvidence(
        scope, sourceInput(documentFrom(eventPage()), permit), request(TENANT), abort.signal,
      );
      try {
        await waitFor(gate.reached, 15_000, `${name} asset payload key`);
      } catch (error) {
        gate.release();
        await attempt.catch(() => {});
        throw error;
      }
      if (name === 'acl') allowed = false;
      if (name === 'retention') clock.value = EPOCH + 2_000;
      if (name === 'cancellation') abort.abort();
      gate.release();
      await assert.rejects(attempt,
        (error) => error instanceof EvidenceStoreError && error.code === expectedCode);
      const integrity = await harness.store.integritySnapshot(scope);
      assert.equal(integrity.availableEvidence, 0);
      assert.equal(integrity.encryptedPayloadRecords, 0);
    });
  }
});

test('asset private readback reruns current authorization after synchronous consumer reentry', async (t) => {
  let allowed = true;
  let revokeDuringConsume = false;
  const harness = await createHarness(t, {
    authorizePrivateAccessCurrent: ({ tenantId, request: authRequest }) => allowed
      && authRequest?.principal?.tenantId === tenantId && authRequest.allowPrivate === true,
    storeOptions: {
      consumePrivatePayload({ positions }) {
        if (revokeDuringConsume) allowed = false;
        return { excerptCount: positions.length };
      },
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const asset = await harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(documentFrom(eventPage()), harness.createPermit(TENANT)), request(TENANT),
  );
  assert.equal(asset.outcome, 'stored');
  revokeDuringConsume = true;
  await assert.rejects(harness.store.withPrivatePayload(scope, asset.evidence, request(TENANT)),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');
});

test('input bytes are copied before awaits and private excerpt buffers are wiped after synchronous consumption', async (t) => {
  let signalReached;
  let release;
  const reached = new Promise((resolve) => { signalReached = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  let consumedBuffers = [];
  const harness = await createHarness(t, {
    authorizePrivateAccess: async ({ action }) => {
      if (action === 'ingest_asset_source_evidence') {
        signalReached();
        await blocked;
      }
      return true;
    },
    storeOptions: {
      consumePrivatePayload: ({ positions }) => {
        consumedBuffers = positions.map((position) => position.content);
        return { candidatePositionCount: positions.length };
      },
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const doc = documentFrom(eventPage());
  const original = Buffer.from(doc.bytes);
  const attempt = harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(doc, harness.createPermit(TENANT)), request(TENANT),
  );
  try {
    await waitFor(reached, 15_000, 'asset authorization await');
  } catch (error) {
    release();
    await attempt.catch(() => {});
    throw error;
  }
  doc.bytes.fill(0);
  release();
  const asset = await attempt;
  assert.equal(asset.metadata.contentHash, digest(original));

  const consumed = await harness.store.withPrivatePayload(scope, asset.evidence, request(TENANT));
  assert.ok(consumed.candidatePositionCount > 0);
  assert.ok(consumedBuffers.length > 0);
  assert.ok(consumedBuffers.every((buffer) => buffer.every((byte) => byte === 0)),
    'the trusted consumer cannot retain excerpt bytes after the call returns');
});

test('a reentrant current authorizer that changes SQLite state fails the asset CAS without a partial bundle', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ei-asset-cas-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let currentCalls = 0;
  const harness = await createHarness(t, {
    storeOptions: { directory },
    authorizePrivateAccessCurrent({ action }) {
      if (action === 'ingest_asset_source_evidence') {
        currentCalls += 1;
        const database = new DatabaseSync(path.join(directory, tenantHash(), 'evidence.sqlite'));
        try {
          database.prepare('INSERT INTO evidence_manifest (tenant_hash, document) VALUES (?, ?)')
            .run(tenantHash(), JSON.stringify({ schemaVersion: 1, tenantHash: tenantHash(), records: {}, families: {}, facts: {} }));
        } finally {
          database.close();
        }
      }
      return true;
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  await assert.rejects(harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(documentFrom(eventPage()), harness.createPermit(TENANT)), request(TENANT),
  ), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_BUSY');
  assert.equal(currentCalls, 1);
  const state = readDatabase(directory);
  assert.equal(Object.keys(state.manifest.records).length, 0);
  assert.equal(state.evidenceCount, 0);
  assert.equal(state.bundleCount, 0);
});

test('stored candidate order, metadata, locator, selector, and ciphertext tampering fail integrity after legitimate readback', async (t) => {
  const initial = await createHarness(t);
  const initialScope = await initial.store.scopeForAuthenticatedRequest(request(TENANT));
  const doc = documentFrom(eventPage());
  const good = await initial.store.ingestAssetSourceEvidence(initialScope, sourceInput(doc, initial.createPermit(TENANT)), request(TENANT));
  assert.equal(good.outcome, 'stored');
  const goodSelection = await initial.store.materializeSelected(initialScope, { evidence: [good.evidence], facts: [] }, request(TENANT));
  assert.equal(goodSelection.evidence[0].source.assetSource.candidates[0].positionIndex, 0);

  const corruptors = [
    (bundle) => { [bundle.assetSource.candidates[0], bundle.assetSource.candidates[1]] = [bundle.assetSource.candidates[1], bundle.assetSource.candidates[0]]; },
    (bundle) => { bundle.assetSource.candidates[0].field = 'forged.claim'; },
    (bundle) => { bundle.assetSource.candidates[0].excerptKind = 'future-kind'; },
    (bundle) => { bundle.assetSource.candidates[0].locator.startByte += 1; },
    (bundle) => { bundle.assetSource.selectorVersion = 'ei-asset-source-selector/future'; },
    (bundle) => { bundle.assetSource.extractorVersion = 'ei-deterministic-extraction/1.5.0'; },
    (bundle) => { bundle.schemaVersion = 4; },
  ];
  for (const corrupt of corruptors) {
    const harness = await createHarness(t);
    const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
    const result = await harness.store.ingestAssetSourceEvidence(scope, sourceInput(doc, harness.createPermit(TENANT)), request(TENANT));
    assert.equal(result.outcome, 'stored');
    assert.equal((await harness.store.materializeSelected(scope, { evidence: [result.evidence], facts: [] }, request(TENANT)).then((value) => value.evidence[0].source.contentHash)), digest(doc.bytes));
    const sealed = readEvidenceBytes(harness.directory, result.metadata.evidenceId);
    const bundle = openBundle(sealed, result.metadata.evidenceId);
    corrupt(bundle);
    replaceSealed(harness.directory, result.metadata.evidenceId, resealBundle(bundle, sealed, result.metadata.evidenceId));
    const reopened = harness.openStore();
    const reopenedScope = await reopened.scopeForAuthenticatedRequest(request(TENANT));
    const handle = await reopened.lookupEvidence(reopenedScope, result.metadata.evidenceId);
    await assert.rejects(reopened.materializeSelected(reopenedScope, { evidence: [handle], facts: [] }, request(TENANT)),
      (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INTEGRITY');
  }

  const tamperedCiphertext = await createHarness(t);
  const scope = await tamperedCiphertext.store.scopeForAuthenticatedRequest(request(TENANT));
  const result = await tamperedCiphertext.store.ingestAssetSourceEvidence(scope, sourceInput(doc, tamperedCiphertext.createPermit(TENANT)), request(TENANT));
  const sealed = readEvidenceBytes(tamperedCiphertext.directory, result.metadata.evidenceId);
  const envelope = JSON.parse(sealed.toString('utf8'));
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  ciphertext[0] ^= 0x01;
  envelope.ciphertext = ciphertext.toString('base64');
  replaceSealed(tamperedCiphertext.directory, result.metadata.evidenceId, Buffer.from(JSON.stringify(envelope)));
  const handle = await tamperedCiphertext.store.lookupEvidence(scope, result.metadata.evidenceId);
  await assert.rejects(tamperedCiphertext.store.materializeSelected(scope, { evidence: [handle], facts: [] }, request(TENANT)),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INTEGRITY');

  const futureManifest = await createHarness(t);
  const futureScope = await futureManifest.store.scopeForAuthenticatedRequest(request(TENANT));
  const futureAsset = await futureManifest.store.ingestAssetSourceEvidence(
    futureScope, sourceInput(doc, futureManifest.createPermit(TENANT)), request(TENANT),
  );
  const database = new DatabaseSync(path.join(futureManifest.directory, tenantHash(), 'evidence.sqlite'));
  try {
    const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash());
    const manifest = JSON.parse(row.document);
    manifest.schemaVersion = 4;
    database.prepare('UPDATE evidence_manifest SET document = ? WHERE tenant_hash = ?')
      .run(JSON.stringify(manifest), tenantHash());
  } finally {
    database.close();
  }
  await assert.rejects(futureManifest.store.lookupEvidence(futureScope, futureAsset.metadata.evidenceId),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INTEGRITY');
});

test('selector 4 rejects an otherwise digest-consistent nonempty attribute token before private release', async (t) => {
  let consumerCalls = 0;
  const harness = await createHarness(t, {
    storeOptions: {
      consumePrivatePayload() {
        consumerCalls += 1;
        return { released: true };
      },
    },
  });
  const requestValue = request(TENANT);
  const scope = await harness.store.scopeForAuthenticatedRequest(requestValue);
  const doc = documentFrom('<html><body><img src=""><img src="/poster.png"></body></html>');
  const written = await harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(doc, harness.createPermit(TENANT)), requestValue,
  );
  assert.equal(written.outcome, 'stored');
  assert.equal((await harness.store.withPrivatePayload(scope, written.evidence, requestValue)).released, true);
  assert.equal(consumerCalls, 1, 'the otherwise-valid fixture reaches the private consumer before tampering');

  const evidenceId = written.metadata.evidenceId;
  const sealed = readEvidenceBytes(harness.directory, evidenceId);
  const bundle = openBundle(sealed, evidenceId);
  const candidateIndex = bundle.assetSource.candidates.findIndex((candidate) => candidate.excerptKind === 'html-empty-attribute-token');
  assert.ok(candidateIndex >= 0);
  assert.equal(assetDerivationDigest(bundle), bundle.assetSource.derivationDigest, 'test digest matches the actual selector-4 derivation');
  const candidate = bundle.assetSource.candidates[candidateIndex];
  const position = bundle.positions[candidate.positionIndex];
  assert.equal(Buffer.from(position.content, 'base64').toString('utf8'), 'src=""');
  const invalidNonemptyToken = Buffer.from('src= /', 'utf8');
  assert.equal(invalidNonemptyToken.byteLength, Buffer.from(position.content, 'base64').byteLength);
  const changedHash = digest(invalidNonemptyToken);
  position.content = invalidNonemptyToken.toString('base64');
  position.contentHash = changedHash;
  candidate.excerptHash = changedHash;
  const changedDerivation = assetDerivationDigest(bundle);
  bundle.assetSource.derivationDigest = changedDerivation;
  bundle.derivationDigest = changedDerivation;

  const database = readDatabase(harness.directory);
  database.manifest.records[evidenceId].derivationDigest = changedDerivation;
  database.manifest.records[evidenceId].positionHashes[position.id] = changedHash;
  replaceManifest(harness.directory, database.manifest);
  replaceSealed(harness.directory, evidenceId, resealBundle(bundle, sealed, evidenceId));
  assert.equal(consumerCalls, 1);

  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(requestValue);
  const handle = await reopened.lookupEvidence(reopenedScope, evidenceId);
  await assert.rejects(reopened.withPrivatePayload(reopenedScope, handle, requestValue),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_INTEGRITY');
  assert.equal(consumerCalls, 1, 'invalid token excerpt is rejected before the private consumer receives payload');
});

test('a missing historical payload key denies authorized asset readback', async (t) => {
  let unavailable = false;
  const harness = await createHarness(t, {
    storeOptions: {
      async resolveKey({ tenantId, purpose, keyId }) {
        if (unavailable && purpose === 'payload') throw new Error('synthetic key unavailable');
        const selectedId = keyId ?? `${purpose}-v1`;
        return { keyId: selectedId, key: keyFor(tenantId, purpose, selectedId) };
      },
    },
  });
  const scope = await harness.store.scopeForAuthenticatedRequest(request(TENANT));
  const asset = await harness.store.ingestAssetSourceEvidence(
    scope, sourceInput(documentFrom(eventPage()), harness.createPermit(TENANT)), request(TENANT),
  );
  unavailable = true;
  const reopened = harness.openStore();
  const reopenedScope = await reopened.scopeForAuthenticatedRequest(request(TENANT));
  const handle = await reopened.lookupEvidence(reopenedScope, asset.metadata.evidenceId);
  await assert.rejects(reopened.materializeSelected(reopenedScope, { evidence: [handle], facts: [] }, request(TENANT)),
    (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_KEY_UNAVAILABLE');
});

test('two Node processes contend through the real source excerpt SQLite snapshot/CAS boundary', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ei-asset-source-process-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const htmlPath = path.join(directory, 'source.html');
  const markers = [path.join(directory, 'writer-1.ready'), path.join(directory, 'writer-2.ready')];
  const release = path.join(directory, 'release-writers');
  await writeFile(htmlPath, Buffer.from(eventPage()));
  const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sqlite-worker.mjs');
  const children = markers.map((marker) => spawn(process.execPath, [worker, directory, htmlPath, marker, release], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  t.after(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); });
  const outputs = children.map((child) => new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) reject(new Error(`asset source worker exited ${code}: ${stderr.slice(-500)}`));
      else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`invalid asset source worker result: ${stderr.slice(-500)}`)); } }
    });
  }));
  const deadline = Date.now() + 20_000;
  let bothReady = false;
  while (Date.now() < deadline) {
    try { await Promise.all(markers.map((marker) => readFile(marker))); bothReady = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  await writeFile(release, 'release');
  assert.equal(bothReady, true, 'both real parsers reach their post-snapshot key gate');
  const results = await Promise.all(outputs);
  assert.deepEqual(results.map((result) => result.outcome).sort(), ['busy', 'stored']);
  const state = readDatabase(directory);
  assert.equal(state.manifest.schemaVersion, 3);
  assert.equal(Object.keys(state.manifest.records).length, 1);
  assert.equal(Object.values(state.manifest.families).filter((family) => family.representation === 'asset-source-excerpt').length, 1);
});
