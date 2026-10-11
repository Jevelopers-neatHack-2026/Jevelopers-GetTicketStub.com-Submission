import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { root, readJson } from './generate.mjs';
import { catalog, execute } from './contracts.mjs';
import { runCanonicalFixtures } from '../tooling/fixture-harness.mjs';

export async function coverageEvidence() {
  const entries = await catalog();
  const requirements = await readJson('docs/requirements.json');
  const fixtureManifest = await readJson('generated/fixture-manifest.json');
  const packageManifest = await readJson('generated/package-content-manifest.json');
  const packageJson = await readJson('package.json');
  const findings = await readJson('compatibility/owner-findings.json');
  const proposals = await readJson('compatibility/proposal-intake.json');
  const consumers = await readJson('compatibility/consumers.json');
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const checks = [];
  for (const command of ['check', 'fixtures', 'compat', 'docs']) checks.push(await execute(command, {}));
  checks.push(await execute('inventory', { 'require-consumer': true, 'require-leaf': true, 'require-version-policy': true, 'require-field-classification': true, 'require-fixtures': true, 'require-docs': true }));
  const contracts = [];
  for (const entry of entries) {
    const result = runCanonicalFixtures(entry.name, await readJson(entry.fixtures));
    contracts.push({ contract: entry.name, version: entry.schema_version, requirement: entry.requirement, issue: entry.issue, artifacts: { schema: entry.schema_path, types: entry.generated_export, helper: entry.helper, fixtures: entry.fixtures, owner_issue: entry.issue }, status: result.failures.length ? 'failed' : 'passed_local_fixture_contribution', ...result });
  }
  const localPassed = checks.every(check => check.failures.length === 0) && contracts.every(contract => contract.failures.length === 0);
  const criteria = (await readJson('docs/acceptance-criteria.json')).criteria;
  const localCriteria = criteria.map(criterion => {
    const related = contracts.filter(contract => contract.issue === criterion.issue);
    const unresolved = findings.findings.filter(finding => finding.issue === criterion.issue && finding.status !== 'resolved');
    const aggregate = [1, 3].includes(criterion.issue);
    return {
      id: criterion.id, issue: criterion.issue, requirement: criterion.requirement,
      status: aggregate ? 'release_or_epic_blocked' : unresolved.length ? 'unresolved_producer_correctness' : 'pending_independent_and_owner_acceptance',
      contribution: { status: localPassed ? 'package_owned_checks_passed' : 'package_owned_checks_failed', contracts: related.map(row => ({ contract: row.contract, version: row.version, cases: row.records.map(record => record.case), artifacts: row.artifacts })), foundation_artifacts: related.length ? [] : ['docs/contract-catalog.md', 'compatibility/version-policy.json', 'compatibility/privacy-policy.json', 'scripts/contracts.mjs', 'scripts/consumer-checks.mjs'] },
      evidence: [29, 30].includes(criterion.issue) ? ['generated/fixture-manifest.json', 'tests/final-harness.test.mjs', 'tests/final-types.ts', 'docs/fixture-harness.md', 'docs/consumer-handoff.md', 'docs/release-guide.md'] : related.map(row => row.artifacts.fixtures),
      unresolved_findings: unresolved.map(row => row.id),
      independent_review: 'pending_exact_candidate',
      owner_and_consumer_acceptance: 'pending',
      independent_type_archive_suite: 'required_separate_npm_test_build_and_test_installed'
    };
  });
  return { policy_version: '1.0.0', status: localPassed ? 'local_checks_passed_release_blocked' : 'local_checks_failed_release_blocked', scope: 'package_owned_fixture_contribution', source_revision: revision.status === 0 ? revision.stdout.trim() : null, source_dirty: dirty.status === 0 ? Boolean(dirty.stdout.trim()) : null, node: process.version, package_version: packageJson.version, dependency_mode: 'locked_offline', provider_calls: 0, runtime_dependencies: 0, fixture_digest: fixtureManifest.digest, package_content_digest: packageManifest.digest, checks, local_criteria: localCriteria, global_criteria: requirements.global_requirements.map(id => ({ id, status: 'unverified_external_master_tracker', contribution_only: true })), contracts, consumer_handoffs: consumers.repositories.map(row => ({ repository: row.repository, discovery_source_revision: row.source_sha, accepted_shared_source_revision: row.shared_source_revision, tested_consumer_revision: row.tested_consumer_revision, command: row.command, fixture_digest: row.fixture_digest, status: row.result, acknowledgement: row.acknowledgement === null ? null : 'review_record_requires_runner_validation' })), unresolved_producer_findings: findings.findings, proposal_intake: proposals.requests };
}
export function humanCoverage(result) {
  return [result.status + ': ' + result.contracts.length + ' wire exports', 'source=' + result.source_revision + ' dirty=' + result.source_dirty + ' Node=' + result.node + ' package=' + result.package_version, 'fixture_digest=' + result.fixture_digest, 'package_content_digest=' + result.package_content_digest, ...result.contracts.map(row => row.contract + '@' + row.version + ': ' + row.status + ', cases=' + row.records.length), ...result.local_criteria.map(row => row.id + ': ' + row.status + '; acceptance pending'), ...result.global_criteria.map(row => row.id + ': ' + row.status), ...result.consumer_handoffs.map(row => row.repository + ': ' + row.status), ...result.unresolved_producer_findings.map(row => row.id + ': ' + row.status + ' producer correctness')].join('\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  const human = flags.length === 1 && flags[0] === '--human';
  const output = flags.length === 2 && flags[0] === '--output' && flags[1] && !flags[1].startsWith('--') ? flags[1] : null;
  if (flags.length && !human && !output) throw new Error('coverage [--human | --output PATH]');
  const result = await coverageEvidence();
  if (output) {
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ status: result.status, contracts: result.contracts.length, cases: result.contracts.reduce((sum, contract) => sum + contract.records.length, 0), fixture_digest: result.fixture_digest, package_content_digest: result.package_content_digest }));
  } else console.log(human ? humanCoverage(result) : JSON.stringify(result, null, 2));
  if (result.checks.some(check => check.failures.length) || result.contracts.some(contract => contract.failures.length)) process.exitCode = 1;
}
