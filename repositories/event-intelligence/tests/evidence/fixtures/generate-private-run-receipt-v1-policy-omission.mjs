import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const baseline = process.env.EI_BASELINE_CHECKOUT;
const outputDirectory = process.env.EI_FIXTURE_OUTPUT_DIR;
assert.equal(typeof baseline, 'string', 'set EI_BASELINE_CHECKOUT to the detached baseline checkout');
assert.equal(typeof outputDirectory, 'string', 'set EI_FIXTURE_OUTPUT_DIR to an empty output directory');
assert.equal(process.versions.node, '22.23.3', 'fixture capture uses the repository-pinned Node runtime');
const baselineCommit = execFileSync('git', ['-C', baseline, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(baselineCommit, 'c887d88afb9665ea92129b89d685b2a75ae482ea');
const baselineSourceHashes = {
  'src/research/private-retrieval.mjs': 'fed7dc96f069b5e626f34a8d7e708c85708adf66edfcd422df11df3fe27dc79e',
  'src/evidence/store.mjs': '0d910b9dedd97f6130202a300ba171cbe6e4870fc898445ea6d7900454db9070',
  'src/discovery/planner/frontier.mjs': 'd09902b2756dd57433b71143cbc12845d3422937f17f08bc0cd26973b4526bc3',
};
for (const [relativePath, expectedHash] of Object.entries(baselineSourceHashes)) {
  const actualHash = createHash('sha256').update(await readFile(path.join(baseline, relativePath))).digest('hex');
  assert.equal(actualHash, expectedHash, `baseline ${relativePath} source pin must match`);
}
let priorOutput;
try { priorOutput = await readdir(outputDirectory); }
catch (error) { if (error?.code !== 'ENOENT') throw error; }
assert.ok(priorOutput === undefined || priorOutput.length === 0, 'fixture output directory must be empty');

const [{ createEvidenceStore }, { createDiscoveryFrontierStore }, { runPrivateRetrieval }, { SafeFetcher }, support] = await Promise.all([
  import(pathToFileURL(path.join(baseline, 'src/evidence/store.mjs'))),
  import(pathToFileURL(path.join(baseline, 'src/discovery/planner/frontier.mjs'))),
  import(pathToFileURL(path.join(baseline, 'src/research/private-retrieval.mjs'))),
  import(pathToFileURL(path.join(baseline, 'src/security/controlled-fetch.mjs'))),
  import(pathToFileURL(path.join(baseline, 'tests/security/support.mjs'))),
]);

const tenantId = 'legacy-policy-omission-fixture-tenant';
const runId = 'private-receipt-v1-policy-omission-fixture';
const host = 'fixture.example.org';
const tenantHash = createHash('sha256').update(`event-intelligence:tenant:v1:${tenantId}`).digest('hex');
const retentionWindowMs = 100 * 365 * 24 * 60 * 60 * 1000;
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ei-v1-policy-omission-fixture-'));
const evidenceDirectory = path.join(temporaryDirectory, 'evidence');
const frontierDirectory = path.join(temporaryDirectory, 'frontier');
const evidenceDataDirectory = path.join(evidenceDirectory, tenantHash);
const frontierDataDirectory = path.join(frontierDirectory, tenantHash);
const retentionPermits = new WeakMap();
let requestCount = 0;
const unsafeCanonicalUrl = 'https://links.example.org/?access_token=synthetic-canary';
const event = {
  '@type': 'Event', name: 'Legacy policy omission fixture', startDate: '2027-06-20',
  location: { name: 'Civic Hall', address: { addressLocality: 'Boston' } },
};
const body = Buffer.from(`<!doctype html><link rel="canonical" href="${unsafeCanonicalUrl}">`
  + `<script type="application/ld+json">${JSON.stringify(event)}</script>`);
const server = http.createServer((_request, response) => {
  requestCount += 1;
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const serverPort = server.address().port;
const seeds = [
  { url: support.fixtureUrl(80, '/legacy-policy-omission', host) },
  { url: support.fixtureUrl(80, '/new-policy-omission', host) },
];
const limits = {
  maxDepth: 1,
  maxTransportAttemptAdmissions: 2,
  maxInFlightLeases: 4,
  durationMs: 30_000,
  maxSuggestionsPerCompletion: 1,
};
const fetcher = new SafeFetcher(support.localTestSeam({ port: 80, dialPort: serverPort, hostnames: [host] }));
const request = { principal: { tenantId }, allowPrivate: true };
const evidenceStore = createEvidenceStore({
  directory: evidenceDirectory,
  resolveTenant: (authenticated) => authenticated?.principal?.tenantId,
  resolveKey({ tenantId: requestedTenant, purpose, keyId }) {
    assert.equal(requestedTenant, tenantId);
    const selectedId = `${purpose}-legacy-fixture-v1`;
    if (keyId) assert.equal(keyId, selectedId);
    return { keyId: selectedId, key: createHash('sha256').update(`${requestedTenant}:${purpose}:legacy-receipt-v1`).digest() };
  },
  resolveRetention({ tenantId: requestedTenant, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
    assert.equal(requestedTenant, tenantId);
    if (kind === 'evidence') {
      const permit = retentionPermits.get(retentionHandle);
      assert.ok(permit, 'only generator-issued synthetic retention permits are valid');
      return { expiresAtMs: permit.expiresAtMs, policyId: 'legacy-fixture', policyVersion: '1', accessPolicy: 'tenant_private' };
    }
    return { expiresAtMs: sourceExpiresAtMs ?? nowMs + 60_000,
      policyId: 'legacy-fixture-facts', policyVersion: '1', accessPolicy: 'tenant_private' };
  },
  authorizePrivateAccess: ({ tenantId: requestedTenant, request: authenticated }) => requestedTenant === tenantId
    && authenticated?.principal?.tenantId === tenantId && authenticated.allowPrivate === true,
  authorizePrivateAccessCurrent: ({ tenantId: requestedTenant, request: authenticated }) => requestedTenant === tenantId
    && authenticated?.principal?.tenantId === tenantId && authenticated.allowPrivate === true,
  now: () => Date.now(),
  maxSourceBytes: 2 * 1024 * 1024,
  maxPositionBytes: 64 * 1024,
  maxPositionCount: 128,
  maxStoredPayloadBytes: 512 * 1024,
  maxRetentionMs: retentionWindowMs,
});
const frontier = createDiscoveryFrontierStore({
  directory: frontierDirectory,
  resolveTenant: (authenticated) => authenticated?.principal?.tenantId,
  lockTimeoutMs: 10_000,
});
const frontierScope = await frontier.scopeForAuthenticatedRequest(request);
const evidenceScope = await evidenceStore.scopeForAuthenticatedRequest(request);
const permit = Object.freeze(Object.create(null));
retentionPermits.set(permit, { expiresAtMs: Date.now() + retentionWindowMs });
let firstCompletionMade = false;
let claimCalls = 0;
const interruptedFrontier = Object.create(null);
for (const method of [
  'scopeForAuthenticatedRequest', 'createRun', 'claimNext', 'getCandidateReceiptBinding', 'admitTransportHop',
  'markTransportDispatchIntent', 'markTransportResponseReceived', 'settleTransportHopKnownZero',
  'settleTransportHopBodyComplete', 'markTransportHopUnknown', 'getTransportProgress', 'completeCandidate',
  'markUnresolved', 'stopRun', 'sealPrivateDraft', 'getSnapshot',
]) {
  if (method === 'completeCandidate') {
    interruptedFrontier[method] = async (...args) => {
      const completed = await frontier.completeCandidate(...args);
      firstCompletionMade = true;
      return completed;
    };
  } else if (method === 'claimNext') {
    interruptedFrontier[method] = async (...args) => {
      claimCalls += 1;
      if (claimCalls > 1 && firstCompletionMade) throw new Error('synthetic interruption after baseline receipt completion');
      return frontier.claimNext(...args);
    };
  } else interruptedFrontier[method] = frontier[method].bind(frontier);
}

try {
  const result = await runPrivateRetrieval({
    frontier: interruptedFrontier,
    evidenceStore,
    safeFetcher: fetcher,
    request,
    runId,
    seeds,
    limits,
    retentionHandleFor: () => permit,
    authorizeCurrent: () => true,
  });
  assert.equal(firstCompletionMade, true, 'baseline execution completes its first authenticated receipt');
  assert.equal(result.status, 'incomplete', JSON.stringify(result));
  assert.equal(requestCount, 1, 'baseline capture makes one local synthetic HTTP request');
  const snapshot = await frontier.getSnapshot(frontierScope, runId);
  const completedSeed = snapshot.candidates.find((candidate) => candidate.seed && candidate.state === 'completed');
  const queuedSeeds = snapshot.candidates.filter((candidate) => candidate.seed && candidate.state === 'queued');
  assert.ok(completedSeed, 'one old-format seed completion is durable');
  assert.equal(queuedSeeds.length, 1, 'one second seed remains queued for the mixed-version replay');
  const claimBinding = await frontier.getCandidateReceiptBinding(frontierScope, runId, completedSeed.candidateId);
  const configHash = createHash('sha256').update(JSON.stringify({ runId, seeds, limits })).digest('hex');
  const receipt = await evidenceStore.readPrivateRunReceipt(evidenceScope, {
    runId, configHash, candidate: claimBinding.candidate,
  }, request);
  assert.equal(receipt.state, 'complete');
  assert.equal(receipt.outcome, 'no_links');
  assert.equal(receipt.omissionMetadataVersion, undefined,
    'the baseline receipt uses its original schema without omission-count fields');
  assert.ok(receipt.limitations.includes('some_link_candidates_omitted_by_policy_or_parser_limit'),
    'the baseline writer preserves a positive policy-omission marker');
  assert.equal(receipt.sourceLinkCandidatesOmittedCount, undefined);
  assert.deepEqual(receipt.suggestions, []);
  assert.equal(JSON.stringify(receipt).includes('synthetic-canary'), false,
    'the receipt does not retain the rejected credential-bearing URL');
  await frontier.close();
  await new Promise((resolve) => server.close(resolve));
  await mkdir(outputDirectory, { recursive: true });
  await copyFile(path.join(evidenceDataDirectory, 'evidence.sqlite'), path.join(outputDirectory, 'evidence.sqlite'));
  await copyFile(path.join(frontierDataDirectory, 'frontier.sqlite'), path.join(outputDirectory, 'frontier.sqlite'));
  const descriptor = {
    baselineCommit,
    baselineSourceHashes,
    tenantId,
    tenantHash,
    runId,
    configHash,
    seeds,
    limits,
    requestCount,
    retentionWindowMs,
    expectedStatus: result.status,
    expectedCompletedCandidateId: completedSeed.candidateId,
    expectedQueuedCandidateIds: queuedSeeds.map((candidate) => candidate.candidateId),
    expectedOutcome: receipt.outcome,
    legacyLimitation: 'some_link_candidates_omitted_by_policy_or_parser_limit',
    unsafeUrlRetainedInReceipt: false,
    keyIdPattern: '`${purpose}-legacy-fixture-v1`',
    keyRecipe: 'SHA-256 of `${tenantId}:${purpose}:legacy-receipt-v1`',
  };
  descriptor.evidenceDatabaseSha256 = createHash('sha256')
    .update(await readFile(path.join(outputDirectory, 'evidence.sqlite'))).digest('hex');
  descriptor.frontierDatabaseSha256 = createHash('sha256')
    .update(await readFile(path.join(outputDirectory, 'frontier.sqlite'))).digest('hex');
  await writeFile(path.join(outputDirectory, 'fixture.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: result.status, requestCount, completedSeed: completedSeed.candidateId,
    queuedSeeds: queuedSeeds.map((candidate) => candidate.candidateId), outputDirectory })}\n`);
} finally {
  try { frontier.close(); } catch { /* already closed after successful capture */ }
  await new Promise((resolve) => server.close(() => resolve())).catch(() => {});
  await rm(temporaryDirectory, { recursive: true, force: true });
}
