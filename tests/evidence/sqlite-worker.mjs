import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEvidenceStore } from '../../src/evidence/store.mjs';

const [mode, directory, markerPath, barrierPath] = process.argv.slice(2);
const tenantId = 'tenant-a';
const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
const source = 'Event: Process Race';
const permit = Object.freeze(Object.create(null));

function createStore({ holdPayloadKey = false } = {}) {
  return createEvidenceStore({
    directory,
    resolveTenant: (request) => request?.principal?.tenantId,
    async resolveKey({ purpose, keyId }) {
      if (holdPayloadKey && purpose === 'payload') {
        await writeFile(markerPath, 'transaction-open');
        setInterval(() => {}, 1_000);
        await new Promise(() => {});
      }
      const id = `${purpose}-v1`;
      if (keyId && keyId !== id) throw new Error('unexpected key id');
      return { keyId: id, key: createHash('sha256').update(`${tenantId}:${purpose}:shared-synthetic-key`).digest() };
    },
    resolveRetention({ kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (kind === 'evidence' && retentionHandle !== permit) throw new Error('invalid permit');
      return {
        expiresAtMs: sourceExpiresAtMs ?? nowMs + 60_000,
        policyId: 'synthetic-test-retention',
        policyVersion: '1',
        accessPolicy: 'tenant_private',
      };
    },
    authorizePrivateAccess: () => true,
    consumePrivatePayload: () => undefined,
    lockTimeoutMs: 10_000,
  });
}

function input() {
  return {
    sourceUrl: 'https://process.example.test/event',
    canonicalUrl: 'https://process.example.test/event',
    content: source,
    contentType: 'text/plain',
    retrievedAt: '2026-10-10T15:00:00.000Z',
    sourceKind: 'external',
    retentionHandle: permit,
    positions: [{ locator: { kind: 'text-range', startByte: 0, endByte: Buffer.byteLength(source) }, content: source }],
  };
}

async function waitForBarrier(filePath) {
  await writeFile(markerPath, 'ready');
  while (true) {
    try { await import('node:fs/promises').then(({ access }) => access(barrierPath)); return; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
  }
}

if (mode === 'ingest') {
  await waitForBarrier(barrierPath);
  const store = createStore();
  const scope = await store.scopeForAuthenticatedRequest({ principal: { tenantId } });
  const result = await store.ingestEvidence(scope, input());
  process.stdout.write(JSON.stringify({ evidenceId: result.metadata.evidenceId, created: result.created }));
} else if (mode === 'hold-ingest') {
  const store = createStore({ holdPayloadKey: true });
  const scope = await store.scopeForAuthenticatedRequest({ principal: { tenantId } });
  await store.ingestEvidence(scope, input());
} else if (mode === 'crash-commit') {
  const database = new DatabaseSync(path.join(directory, tenantHash, 'evidence.sqlite'), { timeout: 10_000 });
  database.exec('BEGIN IMMEDIATE');
  const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash);
  const manifest = JSON.parse(row.document);
  const id = randomUUID();
  manifest.records[id] = {
    id,
    version: 99,
    previousId: null,
    contentHash: '0'.repeat(64),
    duplicateGroupId: '1'.repeat(64),
    retrievedAt: '2026-10-10T15:00:00.000Z',
    createdAt: '2026-10-10T15:00:00.000Z',
    createdAtMs: Date.now(),
    retrievedAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
    policyId: 'synthetic-test-retention',
    policyVersion: '1',
    state: 'available',
    sourceKeyId: 'source-index-v1',
    sourceKeyHmac: '2'.repeat(64),
    encryptionKeyId: 'payload-v1',
    positionIds: [],
    positionHashes: {},
  };
  const key = createHash('sha256').update('synthetic-crash-test-key').digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`event-intelligence:evidence:v1:${tenantHash}:evidence:${id}`, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ sourceUrl: 'https://private.example.test/PRIVATE-PAYLOAD-CANARY' }), 'utf8'),
    cipher.final(),
  ]);
  const envelope = Buffer.from(JSON.stringify({
    version: 1,
    keyId: 'payload-v1',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }));
  database.prepare('INSERT INTO sealed_bundles (kind, id, sealed) VALUES (?, ?, ?)').run('evidence', id, envelope);
  database.prepare('UPDATE evidence_manifest SET document = ? WHERE tenant_hash = ?').run(JSON.stringify(manifest), tenantHash);
  await writeFile(markerPath, 'transaction-staged-before-commit');
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
} else {
  process.stderr.write('unknown worker mode');
  process.exitCode = 2;
}
