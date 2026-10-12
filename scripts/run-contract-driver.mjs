#!/usr/bin/env node
// Local runner for contracts/contract-driver.mjs. Verifies the provisioned package against the committed pin
// (fail closed), writes a binding config shaped like the producer's, runs the driver in a child with a minimal
// environment, and checks the single JSON receipt it prints. This runner is not the driver: it may spawn processes.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pin = JSON.parse(readFileSync(join(root, 'contracts/shared-contracts.pin.json'), 'utf8'));
const snapshot = join(root, 'node_modules/@jevelopers/shared-contracts');
const fail = (message) => { console.error('CONTRACT_DRIVER_BLOCKED: ' + message); process.exit(1); };
if (!existsSync(snapshot)) fail('shared-contracts is not provisioned; run `npm run contracts:provision` (needs network for the public git clone only)');
const read = (path) => JSON.parse(readFileSync(join(snapshot, path), 'utf8'));
const packageJson = read('package.json');
if (packageJson.name !== pin.package || packageJson.version !== pin.version) fail('installed package name/version differs from the pin');
const content = read('generated/package-content-manifest.json'), fixtureManifest = read('generated/fixture-manifest.json');
if (content.digest !== pin.package_content_digest) fail('package content digest differs from the pin');
if (fixtureManifest.digest !== pin.fixture_digest) fail('fixture digest differs from the pin');
for (const [path, expected] of Object.entries(content.files)) {
  if ('sha256:' + createHash('sha256').update(readFileSync(join(snapshot, path))).digest('hex') !== expected) fail('installed file bytes differ from the pin: ' + path);
}
const roles = ['CommonEnvelope', 'EvidenceProjection', 'ErrorEnvelope', 'PartialFailure', 'JobStatus', 'JobProgress', 'Cancellation', 'JobCommandAcknowledgement', 'FinancialSummary', 'FulfillmentStatus', 'EvaluationEvidence'];
const requiredFixtures = roles.map((contract) => {
  const row = fixtureManifest.contracts.find((entry) => entry.contract === contract);
  if (!row) fail('fixture manifest lacks ' + contract);
  return { contract, version: row.version, path: row.path };
});
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const consumerSha = process.env.TD01B_CONSUMER_SHA ?? git('rev-parse', 'HEAD');
const nonce = randomUUID();
const binding = { repository: 'team-dashboard', consumer_sha: consumerSha, shared_source_revision: pin.head, package_integrity: pin.package_integrity, package_content_digest: pin.package_content_digest, fixture_digest: pin.fixture_digest, nonce };
const directory = mkdtempSync(join(tmpdir(), 'td01b-driver-'));
try {
  const config = join(directory, 'binding.json');
  writeFileSync(config, JSON.stringify({ snapshot, binding, required: roles, required_fixtures: requiredFixtures, files: content.files }));
  const run = spawnSync(process.execPath, ['contracts/contract-driver.mjs'], { cwd: root, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, SHARED_CONTRACTS_OFFLINE: '1', SHARED_CONTRACTS_BINDING_CONFIG: config } });
  if (run.status !== 0) { console.error(run.stdout, run.stderr); fail('driver exited with status ' + run.status); }
  const receipt = JSON.parse(run.stdout);
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (receipt.status !== 'passed' || receipt.consumer_sha !== binding.consumer_sha || receipt.shared_source_revision !== pin.head || receipt.fixture_digest !== pin.fixture_digest
    || receipt.package_content_digest !== pin.package_content_digest || receipt.package_integrity !== pin.package_integrity || receipt.binding_nonce !== nonce || !same(receipt.contracts_tested, roles)) fail('receipt does not match the binding');
  const { domain_cases: domain, package_fixture_runs: runs, ...summary } = receipt;
  console.log(JSON.stringify({ ...summary, package_fixture_cases: runs.reduce((n, r) => n + r.cases, 0), domain_cases_passed: domain.filter((c) => c.passed).length, domain_cases_total: domain.length }));
} finally { rmSync(directory, { recursive: true, force: true }); }
