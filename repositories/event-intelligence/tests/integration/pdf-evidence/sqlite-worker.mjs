import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { createEvidenceStore } from '../../../src/evidence/store.mjs';

const [directory, sourcePath, readyPath, releasePath] = process.argv.slice(2);
const tenantId = 'tenant-pdf';
const EPOCH = Date.parse('2026-10-10T15:00:00.000Z');
const permit = Object.freeze(Object.create(null));

const store = createEvidenceStore({
  directory,
  resolveTenant: (request) => request?.principal?.tenantId,
  async resolveKey({ tenantId: resolvedTenant, purpose, keyId }) {
    const selected = keyId ?? `${purpose}-v1`;
    return {
      keyId: selected,
      key: createHash('sha256').update(`${resolvedTenant}:${purpose}:${selected}:cross-process-test`).digest(),
    };
  },
  resolveRetention({ tenantId: resolvedTenant, kind, nowMs, retentionHandle }) {
    if (resolvedTenant !== tenantId || kind !== 'evidence' || retentionHandle !== permit) throw new Error('invalid fixture permit');
    return {
      expiresAtMs: nowMs + 60_000,
      policyId: 'cross-process-retention',
      policyVersion: '1',
      accessPolicy: 'tenant_private',
    };
  },
  async authorizePrivateAccess({ tenantId: resolvedTenant, request }) {
    if (resolvedTenant !== tenantId || request?.principal?.tenantId !== tenantId) return false;
    await writeFile(readyPath, 'ready', { flag: 'wx' });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try { await readFile(releasePath); return true; }
      catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
    }
    return false;
  },
  authorizePrivateAccessCurrent({ tenantId: resolvedTenant, request }) {
    return resolvedTenant === tenantId && request?.principal?.tenantId === tenantId;
  },
  now: () => EPOCH,
  maxSourceBytes: 5 * 1024 * 1024,
  maxPositionBytes: 64 * 1024,
  maxPositionCount: 128,
  maxStoredPayloadBytes: 512 * 1024,
  maxRetentionMs: 60_000,
  lockTimeoutMs: 2_000,
});

const request = { principal: { tenantId }, allowPrivate: true };
const scope = await store.scopeForAuthenticatedRequest(request);
const sourceBytes = await readFile(sourcePath);
try {
  const result = await store.ingestDerivedPdfEvidence(scope, {
    sourceUrl: 'https://pdf.example.test/cross-process.pdf',
    canonicalUrl: 'https://pdf.example.test/cross-process.pdf',
    content: sourceBytes,
    contentType: 'application/pdf',
    retrievedAt: '2026-10-10T11:00:00.000-04:00',
    sourceKind: 'external',
    retentionHandle: permit,
  }, request);
  process.stdout.write(`${JSON.stringify({ outcome: 'stored', created: result.created })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ outcome: error?.code === 'EVIDENCE_BUSY' ? 'busy' : 'error', code: error?.code ?? 'UNKNOWN' })}\n`);
  if (error?.code !== 'EVIDENCE_BUSY') process.exitCode = 1;
} finally {
  sourceBytes.fill(0);
}
