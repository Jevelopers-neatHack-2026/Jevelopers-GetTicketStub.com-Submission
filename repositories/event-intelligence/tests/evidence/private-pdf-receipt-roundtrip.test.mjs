import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tenantId = 'tenant-synthetic-pdf-receipt';
const sourceBytes = Buffer.from('%PDF-1.7\n% synthetic receipt fixture\n%%EOF\n', 'ascii');
const pdfFixtureMode = Symbol.for('event-intelligence.test.private-pdf-receipt.mode');
const storeUrl = pathToFileURL(fileURLToPath(new URL('../../src/evidence/store.mjs', import.meta.url))).href;
const readerStubSource = `
  import { createHash } from 'node:crypto';
  export const PDF_TEXT_READER_LIMITS = Object.freeze({
    maxInputBytes: 20 * 1024 * 1024,
    maxPages: 20,
    maxPagePoints: 14_400,
    maxTextCodeUnits: 100_000,
    maxTextItemCodeUnits: 20_000,
    maxTextItems: 2_000,
    maxOutputBytes: 2 * 1024 * 1024,
    maxTimeoutMs: 20_000,
  });
  export async function readTextPdf(input, options) {
    const malformed = globalThis[Symbol.for('event-intelligence.test.private-pdf-receipt.mode')] === 'malformed';
    return {
      kind: 'observation',
      documentSha256: createHash('sha256').update(input).digest('hex'),
      decoder: { name: 'pdfjs-dist', version: '6.4.299', configVersion: 'ei-text-pdf/1' },
      networkAttemptCount: 0,
      completeness: 'incomplete-text-only',
      requiresInspection: true,
      limits: {
        maxInputBytes: 20 * 1024 * 1024,
        maxPages: 20,
        maxPagePoints: 14_400,
        maxTextCodeUnits: options.maxTextCodeUnits,
        maxTextItemCodeUnits: 20_000,
        maxTextItems: 2_000,
        maxOutputBytes: options.maxOutputBytes,
        addressSpaceBytes: 6 * 1024 * 1024 * 1024,
        maxCpuSeconds: 15,
        maxWallMilliseconds: 20_000,
      },
      pages: [{
        pageIndex: 0,
        width: 612,
        height: 792,
        rotation: 0,
        coordinateSystem: 'viewport-points-top-left',
        textPresence: 'text-present',
        requiresInspection: true,
        textBoxes: [{
          text: 'Synthetic PDF receipt excerpt',
          x: 24,
          y: 32,
          width: 192,
          height: 12,
          geometry: malformed ? 'unknown-geometry' : 'approximate-text-item',
        }],
      }],
    };
  }
`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../extraction/pdf/index.mjs' && context.parentURL === storeUrl) {
      return { url: 'ei-test:synthetic-private-pdf-reader', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'ei-test:synthetic-private-pdf-reader') {
      return { format: 'module', source: readerStubSource, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { createEvidenceStore, EvidenceStoreError } = await import(storeUrl);

function authenticatedRequest() {
  return { principal: { tenantId }, allowPrivate: true };
}

function createStoreOptions(directory, permits, now) {
  return {
    directory,
    resolveTenant: (request) => request?.principal?.tenantId,
    resolveKey({ tenantId: requestedTenant, purpose, keyId }) {
      const selectedId = keyId ?? `${purpose}-v1`;
      return {
        keyId: selectedId,
        key: createHash('sha256').update(`${requestedTenant}:${purpose}:${selectedId}:synthetic-pdf-receipt`).digest(),
      };
    },
    resolveRetention({ tenantId: requestedTenant, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (kind === 'evidence') {
        const permit = permits.get(retentionHandle);
        if (!permit || permit.tenantId !== requestedTenant) throw new Error('synthetic invalid retention handle');
        return {
          expiresAtMs: Math.min(permit.expiresAtMs, nowMs + 60_000, sourceExpiresAtMs ?? Number.POSITIVE_INFINITY),
          policyId: 'synthetic-private-pdf-receipt',
          policyVersion: '1',
          accessPolicy: 'tenant_private',
        };
      }
      return {
        expiresAtMs: sourceExpiresAtMs ?? nowMs + 60_000,
        policyId: 'synthetic-private-pdf-receipt',
        policyVersion: '1',
        accessPolicy: 'tenant_private',
      };
    },
    authorizePrivateAccess: ({ tenantId: requestedTenant, request }) =>
      request?.principal?.tenantId === requestedTenant && request.allowPrivate === true,
    authorizePrivateAccessCurrent: ({ tenantId: requestedTenant, request }) =>
      request?.principal?.tenantId === requestedTenant && request.allowPrivate === true,
    consumePrivatePayload({ source, positions }) {
      return {
        sourceUrl: source.sourceUrl,
        canonicalUrl: source.canonicalUrl,
        contentType: source.contentType,
        sourceKind: source.sourceKind,
        retrievedAt: source.retrievedAt,
        sourceHash: source.contentHash,
        positions: positions.map((position) => ({
          locator: position.locator,
          contentHash: position.contentHash,
          text: position.content.toString('utf8'),
        })),
        ...(source.derivedPdf === undefined ? {} : { derivedPdf: source.derivedPdf }),
      };
    },
    now: () => now.value,
    maxSourceBytes: 5 * 1024 * 1024,
    maxPositionBytes: 64 * 1024,
    maxPositionCount: 128,
    maxStoredPayloadBytes: 512 * 1024,
    maxRetentionMs: 60_000,
    lockTimeoutMs: 5_000,
  };
}

async function withPdfStore(t, { malformed = false } = {}, operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ei-private-pdf-receipt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const now = { value: Date.now() };
  const permits = new WeakMap();
  const options = createStoreOptions(directory, permits, now);
  const store = createEvidenceStore(options);
  const scope = await store.scopeForAuthenticatedRequest(authenticatedRequest());
  const retentionHandle = Object.freeze(Object.create(null));
  permits.set(retentionHandle, { tenantId, expiresAtMs: now.value + 60_000 });
  globalThis[pdfFixtureMode] = malformed ? 'malformed' : 'valid';
  try {
    await operation({ directory, options, store, scope, retentionHandle, now });
  } finally {
    delete globalThis[pdfFixtureMode];
  }
}

test('a finalized PDF-backed receipt can be authenticated, reopened, and read with its PDF position locator', async (t) => {
  await withPdfStore(t, {}, async ({ directory, options, store, scope, retentionHandle, now }) => {
    const request = authenticatedRequest();
    const ingested = await store.ingestDerivedPdfEvidence(scope, {
      sourceUrl: 'https://pdf.example.test/synthetic-receipt.pdf',
      canonicalUrl: 'https://pdf.example.test/synthetic-receipt.pdf',
      content: sourceBytes,
      contentType: 'application/pdf',
      retrievedAt: new Date(now.value - 1).toISOString(),
      sourceKind: 'external',
      retentionHandle,
    }, request);
    assert.equal(ingested.outcome, 'stored');
    assert.equal(ingested.metadata.representation, 'pdf-derived-text');
    assert.equal(ingested.positions.length, 1);

    const binding = {
      runId: 'synthetic-pdf-receipt-roundtrip',
      configHash: createHash('sha256').update('synthetic-pdf-receipt-config').digest('hex'),
      candidate: {
        candidateId: createHash('sha256').update('synthetic-pdf-receipt-candidate').digest('hex'),
        canonicalUrl: 'https://events.example.test/synthetic-pdf-receipt',
        depth: 0,
        seed: true,
        sourceRefs: [],
      },
      claim: { claimKey: 'pdf-receipt-claim', workerId: 'synthetic-test', leaseToken: randomUUID() },
    };
    assert.deepEqual(await store.beginPrivateRunReceipt(scope, binding, request), { state: 'pending', created: true });
    assert.deepEqual(await store.finalizePrivateRunReceipt(scope, {
      ...binding,
      completion: {
        completionKey: 'pdf-receipt-completion',
        outcome: 'no_links',
        suggestions: [],
        limitations: [],
        identity: { entityCandidates: [], occurrenceCandidates: [], transitionLinks: [], unresolvedTransitions: [] },
      },
      selection: { evidence: [ingested.evidence], facts: [] },
    }, request), { state: 'complete' });

    const reopened = createEvidenceStore(options);
    const reopenedScope = await reopened.scopeForAuthenticatedRequest(request);
    const receipt = await reopened.readPrivateRunReceipt(reopenedScope, {
      runId: binding.runId,
      configHash: binding.configHash,
      candidate: binding.candidate,
    }, request);
    assert.equal(receipt.state, 'complete');
    assert.deepEqual(receipt.evidenceIds, [ingested.metadata.evidenceId]);
    assert.deepEqual(receipt.facts, []);
  });
});

test('derived PDF ingestion rejects malformed text-box geometry before receipt creation', async (t) => {
  await withPdfStore(t, { malformed: true }, async ({ store, scope, retentionHandle, now }) => {
    await assert.rejects(store.ingestDerivedPdfEvidence(scope, {
      sourceUrl: 'https://pdf.example.test/malformed.pdf',
      canonicalUrl: 'https://pdf.example.test/malformed.pdf',
      content: sourceBytes,
      contentType: 'application/pdf',
      retrievedAt: new Date(now.value - 1).toISOString(),
      sourceKind: 'external',
      retentionHandle,
    }, authenticatedRequest()), (error) => {
      assert.ok(error instanceof EvidenceStoreError);
      assert.equal(error.code, 'EVIDENCE_INTEGRITY');
      return true;
    });
  });
});
