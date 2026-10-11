import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const baseline = process.env.EI_BASELINE_CHECKOUT;
const outputDirectory = process.env.EI_FIXTURE_OUTPUT_DIR;
assert.equal(typeof baseline, 'string', 'set EI_BASELINE_CHECKOUT to the detached baseline checkout');
assert.equal(typeof outputDirectory, 'string', 'set EI_FIXTURE_OUTPUT_DIR to an empty output directory');
assert.equal(process.versions.node, '22.23.3', 'fixture capture uses the repository-pinned Node runtime');
assert.equal(execFileSync('git', ['-C', baseline, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  'c887d88afb9665ea92129b89d685b2a75ae482ea');
const baselineSourceHash = '0d910b9dedd97f6130202a300ba171cbe6e4870fc898445ea6d7900454db9070';
assert.equal(createHash('sha256').update(await readFile(path.join(baseline, 'src/evidence/store.mjs'))).digest('hex'),
  baselineSourceHash);
await mkdir(outputDirectory, { recursive: true });
let priorOutput;
try { priorOutput = await readdir(outputDirectory); }
catch (error) { if (error?.code !== 'ENOENT') throw error; }
assert.ok(priorOutput === undefined || priorOutput.length === 0, 'fixture output directory must be empty');

const { createEvidenceStore } = await import(pathToFileURL(path.join(baseline, 'src/evidence/store.mjs')));
const tenantId = 'legacy-receipt-fixture-tenant';
const runId = 'private-receipt-v1-legacy-fixture';
const candidate = {
  candidateId: 'b3fc8f83cf93f44b3b043485fbec191ea4baef22ae778cf9fdea06ce32c92223',
  canonicalUrl: 'https://events.example.test/event',
  depth: 0,
  seed: true,
  sourceRefs: [],
};
const binding = {
  runId,
  configHash: '91e2d2e1a01740c458b64d7418118a3bad5f59095d337f4387863efa614ef523',
  candidate,
  claim: {
    claimKey: 'claim:legacy-fixture',
    workerId: 'worker:legacy-fixture',
    leaseToken: '00000000-0000-4000-8000-000000000001',
  },
};
const completion = {
  completionKey: 'complete:legacy-fixture',
  outcome: 'no_links',
  suggestions: [],
  limitations: [],
  identity: { entityCandidates: [], occurrenceCandidates: [], transitionLinks: [], unresolvedTransitions: [] },
};
const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
const receiptKey = createHash('sha256')
  .update(`event-intelligence:private-receipt:v1\0${tenantHash}\0${runId}\0${candidate.candidateId}`).digest('hex');
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ei-v1-no-links-fixture-'));
const request = { principal: { tenantId }, allowPrivate: true };
const store = createEvidenceStore({
  directory: temporaryDirectory,
  resolveTenant: (authenticated) => authenticated?.principal?.tenantId,
  resolveKey({ tenantId: requestedTenant, purpose, keyId }) {
    assert.equal(requestedTenant, tenantId);
    const selectedId = 'payload-legacy-fixture-v1';
    if (keyId) assert.equal(keyId, selectedId);
    return {
      keyId: selectedId,
      key: createHash('sha256').update(`${requestedTenant}:${purpose}:legacy-receipt-v1`).digest(),
    };
  },
  resolveRetention({ nowMs, sourceExpiresAtMs }) {
    return {
      expiresAtMs: sourceExpiresAtMs ?? nowMs + 60_000,
      policyId: 'legacy-receipt-fixture', policyVersion: '1', accessPolicy: 'tenant_private',
    };
  },
  authorizePrivateAccess: ({ tenantId: requestedTenant, request: authenticated }) => requestedTenant === tenantId
    && authenticated?.principal?.tenantId === tenantId && authenticated.allowPrivate === true,
  authorizePrivateAccessCurrent: ({ tenantId: requestedTenant, request: authenticated }) => requestedTenant === tenantId
    && authenticated?.principal?.tenantId === tenantId && authenticated.allowPrivate === true,
  now: () => Date.now(),
});

try {
  const scope = await store.scopeForAuthenticatedRequest(request);
  await store.integritySnapshot(scope);
  assert.deepEqual(await store.beginPrivateRunReceipt(scope, binding, request), { state: 'pending', created: true });
  assert.deepEqual(await store.finalizePrivateRunReceipt(scope, {
    ...binding, completion, selection: { evidence: [], facts: [] },
  }, request), { state: 'complete' });
  const databasePath = path.join(temporaryDirectory, tenantHash, 'evidence.sqlite');
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  let row;
  try {
    row = database.prepare(`SELECT schema_version, state, key_id, payload_hash, payload_bytes, sealed
      FROM private_retrieval_receipts WHERE tenant_hash = ? AND receipt_key = ?`)
      .get(tenantHash, receiptKey);
  } finally {
    database.close();
  }
  assert.ok(row);
  assert.equal(row.payload_hash, '23efbd0e5b4125f0f2f90bf350d047840f523c931caa66e671f3d090fe330277');
  const fixture = {
    tenantId,
    runId,
    configHash: binding.configHash,
    candidate,
    claim: binding.claim,
    completion,
    tenantHash,
    receiptKey,
    schemaVersion: row.schema_version,
    state: row.state,
    keyId: row.key_id,
    payloadHash: row.payload_hash,
    payloadBytes: row.payload_bytes,
    sealedBase64: Buffer.from(row.sealed).toString('base64'),
  };
  await writeFile(path.join(outputDirectory, 'private-run-receipt-v1-legacy.json'),
    `${JSON.stringify(fixture, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ state: row.state, payloadHash: row.payload_hash,
    payloadBytes: row.payload_bytes, outputDirectory })}\n`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
