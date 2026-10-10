import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createEvidenceStore } from '../../../src/evidence/store.mjs';

export const EPOCH = Date.parse('2026-10-10T15:00:00.000Z');
export const FIXTURES = new URL('../../extraction/pdf/fixtures/', import.meta.url);

export function request(tenantId = 'tenant-pdf', allowPrivate = true) {
  return { principal: { tenantId }, allowPrivate };
}

export function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function twoPagePdfWithBlankSecondPage() {
  const content = 'BT /F1 16 Tf 72 700 Td (Page with text) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`,
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

export async function createHarness(t, overrides = {}) {
  const directory = overrides.storeOptions?.directory ?? await mkdtemp(path.join(os.tmpdir(), 'ei-pdf-derived-store-'));
  if (overrides.storeOptions?.directory === undefined) t.after(() => rm(directory, { recursive: true, force: true }));
  const clock = overrides.clock ?? { value: EPOCH };
  const permits = new WeakMap();
  const keyState = overrides.keyState ?? {
    active: { payload: 'payload-v1', fact: 'fact-v1', 'source-index': 'source-index-v1' },
  };
  let payloadGate = null;
  const createPermit = (tenantId = 'tenant-pdf', durationMs = 60_000) => {
    const permit = Object.freeze(Object.create(null));
    permits.set(permit, { tenantId, expiresAtMs: clock.value + durationMs });
    return permit;
  };
  const options = {
    directory,
    resolveTenant: (authenticatedRequest) => authenticatedRequest?.principal?.tenantId,
    async resolveKey({ tenantId, purpose, keyId }) {
      if (purpose === 'payload' && payloadGate && keyId === undefined) {
        const gate = payloadGate;
        payloadGate = null;
        gate.signalReached();
        await gate.blocked;
      }
      const selectedId = keyId ?? keyState.active[purpose];
      if (typeof selectedId !== 'string') throw new Error('synthetic missing test key');
      return {
        keyId: selectedId,
        key: createHash('sha256').update(`${tenantId}:${purpose}:${selectedId}:synthetic`).digest(),
      };
    },
    resolveRetention({ tenantId, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (kind === 'evidence') {
        const permit = permits.get(retentionHandle);
        if (!permit || permit.tenantId !== tenantId) throw new Error('synthetic invalid retention permit');
        return {
          expiresAtMs: Math.min(permit.expiresAtMs, nowMs + 60_000, sourceExpiresAtMs ?? Number.POSITIVE_INFINITY),
          policyId: 'synthetic-pdf-retention',
          policyVersion: '1',
          accessPolicy: 'tenant_private',
        };
      }
      return {
        expiresAtMs: sourceExpiresAtMs ?? nowMs + 30_000,
        policyId: 'synthetic-pdf-retention',
        policyVersion: '1',
        accessPolicy: 'tenant_private',
      };
    },
    async authorizePrivateAccess({ tenantId, request: authenticatedRequest, action, evidenceIds }) {
      if (overrides.authorizePrivateAccess) {
        return overrides.authorizePrivateAccess({ tenantId, request: authenticatedRequest, action, evidenceIds });
      }
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
    authorizePrivateAccessCurrent({ tenantId, request: authenticatedRequest, action, evidenceIds }) {
      if (overrides.authorizePrivateAccessCurrent) {
        return overrides.authorizePrivateAccessCurrent({ tenantId, request: authenticatedRequest, action, evidenceIds });
      }
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
    consumePrivatePayload({ source, positions }) {
      return {
        sourceUrl: source.sourceUrl,
        canonicalUrl: source.canonicalUrl,
        contentType: source.contentType,
        sourceKind: source.sourceKind,
        retrievedAt: source.retrievedAt,
        sourceHash: source.contentHash,
        derivedPdf: source.derivedPdf,
        positions: positions.map((position) => ({
          locator: position.locator,
          contentHash: position.contentHash,
          text: position.content.toString('utf8'),
        })),
      };
    },
    now: () => clock.value,
    maxSourceBytes: 5 * 1024 * 1024,
    maxPositionBytes: 64 * 1024,
    maxPositionCount: 128,
    maxStoredPayloadBytes: 512 * 1024,
    maxRetentionMs: 60_000,
    lockTimeoutMs: 5_000,
    ...overrides.storeOptions,
  };
  const openStore = () => createEvidenceStore(options);
  const store = openStore();
  return {
    directory,
    store,
    openStore,
    clock,
    keyState,
    createPermit,
    armPayloadGate() {
      let signalReached;
      let signalRelease;
      const reached = new Promise((resolve) => { signalReached = resolve; });
      const blocked = new Promise((resolve) => { signalRelease = resolve; });
      payloadGate = { reached, blocked, signalReached, signalRelease };
      return { reached, release: () => signalRelease() };
    },
  };
}
