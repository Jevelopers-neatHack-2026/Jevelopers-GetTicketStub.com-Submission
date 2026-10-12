// Offline consumer contract driver (team-dashboard), per shared-contracts docs/consumer-handoff.md.
// Reads SHARED_CONTRACTS_BINDING_CONFIG, runs every required package fixture for the team-dashboard roles through the
// pinned package helper, then runs the reviewed local domain cases, and prints exactly one JSON receipt.
// Imports only: node:fs/promises, node:path, the pinned package, and repository files. No network, child process or fetch.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importVerified } from '../scripts/verified-package.mjs';
import { runDomainCases } from './domain-cases.mjs';

// Resolve here (so a shadowing node_modules would be what resolves), then import only a path proven inside the verified root.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// Under the producer's runner the bound snapshot (SHARED_CONTRACTS_ROOT) is the verified root; standalone, the repo copy is.
const options = { boundRoot: process.env.SHARED_CONTRACTS_ROOT };
const kit = await importVerified(import.meta.resolve('@jevelopers/shared-contracts'), repoRoot, options);
const { runCanonicalFixtures } = await importVerified(import.meta.resolve('@jevelopers/shared-contracts/fixture-harness'), repoRoot, options);

const config = JSON.parse(await readFile(process.env.SHARED_CONTRACTS_BINDING_CONFIG, 'utf8'));
const { binding } = config;
const fixtures = {}, fixtureRuns = [];
for (const item of config.required_fixtures) {
  const manifest = JSON.parse(await readFile(join(config.snapshot, item.path), 'utf8'));
  const checked = runCanonicalFixtures(item.contract, manifest);
  if (checked.failures.length) throw new Error('PACKAGE_FIXTURE_FAILED ' + item.contract);
  fixtures[item.contract] = manifest;
  fixtureRuns.push({ contract: item.contract, version: item.version, cases: checked.records.length });
}
const adapted = ['FinancialSummary', 'EvidenceProjection', 'JobStatus', 'FulfillmentStatus'];
for (const name of adapted) if (!fixtures[name]) throw new Error('MISSING_REQUIRED_FIXTURE ' + name);
const domain = runDomainCases({ kit, fixtures });
const failed = domain.filter((c) => !c.passed);
const receipt = {
  status: failed.length ? 'failed' : 'passed',
  repository: binding.repository,
  consumer_sha: binding.consumer_sha,
  shared_source_revision: binding.shared_source_revision,
  fixture_digest: binding.fixture_digest,
  package_content_digest: binding.package_content_digest,
  package_integrity: binding.package_integrity,
  binding_nonce: binding.nonce,
  contracts_tested: [...config.required],
  package_fixture_runs: fixtureRuns,
  domain_cases: domain,
  domain_adapted_contracts: adapted,
  fixture_only_contracts: config.required.filter((name) => !adapted.includes(name)),
  owner_acknowledgement: null,
};
console.log(JSON.stringify(receipt));
if (failed.length) process.exitCode = 1;
