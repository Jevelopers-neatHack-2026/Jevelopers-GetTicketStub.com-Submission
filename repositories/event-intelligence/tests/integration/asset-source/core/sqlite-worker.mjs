import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { createEvidenceStore } from '../../../../src/evidence/store.mjs';

const [directory, sourcePath, markerPath, releasePath] = process.argv.slice(2);
const tenantId = 'tenant-asset-source';
const epoch = Date.parse('2026-10-10T15:00:00.000Z');
const permits = new WeakMap();
const retentionHandle = Object.freeze(Object.create(null));
permits.set(retentionHandle, { expiresAtMs: epoch + 60_000 });
const sourceBytes = await readFile(sourcePath);

const store = createEvidenceStore({
  directory,
  resolveTenant: (request) => request?.principal?.tenantId,
  async resolveKey({ tenantId: keyTenantId, purpose, keyId }) {
    if (purpose === 'payload' && keyId === undefined) {
      await writeFile(markerPath, 'ready');
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        try { await readFile(releasePath); break; }
        catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
      }
      if (Date.now() >= deadline) throw new Error('test barrier timed out');
    }
    const selectedId = keyId ?? `${purpose}-v1`;
    return {
      keyId: selectedId,
      key: createHash('sha256').update(`${keyTenantId}:${purpose}:${selectedId}:synthetic`).digest(),
    };
  },
  resolveRetention({ tenantId: retentionTenant, kind, nowMs, retentionHandle: permit }) {
    if (kind !== 'evidence' || retentionTenant !== tenantId || !permits.has(permit)) throw new Error('synthetic invalid permit');
    return { expiresAtMs: Math.min(nowMs + 60_000, permits.get(permit).expiresAtMs), policyId: 'synthetic', policyVersion: '1', accessPolicy: 'tenant_private' };
  },
  authorizePrivateAccess: ({ tenantId: authorizedTenant, request }) => authorizedTenant === tenantId
    && request?.principal?.tenantId === tenantId && request.allowPrivate === true,
  authorizePrivateAccessCurrent: ({ tenantId: authorizedTenant, request }) => authorizedTenant === tenantId
    && request?.principal?.tenantId === tenantId && request.allowPrivate === true,
  now: () => epoch,
  maxSourceBytes: 5 * 1024 * 1024,
  maxPositionBytes: 64 * 1024,
  maxPositionCount: 128,
  maxStoredPayloadBytes: 512 * 1024,
  maxRetentionMs: 60_000,
  lockTimeoutMs: 5_000,
});

try {
  const authenticatedRequest = { principal: { tenantId }, allowPrivate: true };
  const scope = await store.scopeForAuthenticatedRequest(authenticatedRequest);
  const result = await store.ingestAssetSourceEvidence(scope, {
    document: {
      url: 'https://events.example.com/calendar/index.html?campaign=autumn',
      contentType: 'text/html; charset=utf-8',
      fetchedAt: '2026-10-10T15:00:00.000Z',
      redirects: 0,
      bytes: Buffer.from(sourceBytes),
    },
    retentionHandle,
  }, authenticatedRequest);
  if (result.outcome !== 'stored') throw new Error(`expected stored source; received ${result.outcome}`);
  process.stdout.write(JSON.stringify({ outcome: 'stored', evidenceId: result.metadata.evidenceId, created: result.created }));
} catch (error) {
  if (error?.code === 'EVIDENCE_BUSY') {
    process.stdout.write(JSON.stringify({ outcome: 'busy' }));
  } else {
    process.stderr.write(`${error?.code ?? error?.name ?? 'Error'}: ${String(error?.message ?? 'worker failed')}`);
    process.exitCode = 1;
  }
} finally {
  sourceBytes.fill(0);
}
