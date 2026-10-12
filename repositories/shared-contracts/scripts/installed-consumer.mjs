import { mkdtemp, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './generate.mjs';
import { hashBytes } from '../tooling/runtime.mjs';
import { productionInstalledChecks } from './production-installed-check.mjs';

const directory = await mkdtemp(join(tmpdir(), 'shared-contracts-consumer-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' } });
  if (result.status !== 0) throw new Error('Installed-consumer command failed: ' + command + '\n' + result.stderr + result.stdout);
  return result.stdout;
}
try {
  const first = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', directory], root))[0];
  const digest = hashBytes(await readFile(join(directory, first.filename)));
  const second = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', directory], root))[0];
  if (hashBytes(await readFile(join(directory, second.filename))) !== digest) throw new Error('Archive bytes are not reproducible');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, first.filename)], directory);
  await cp(root + 'examples/consumer.mjs', join(directory, 'consumer.mjs'));
  console.log(run(process.execPath, ['consumer.mjs'], directory).trim());
  await cp(root + 'examples/operations-consumer.mjs', join(directory, 'operations-consumer.mjs'));
  console.log(run(process.execPath, ['operations-consumer.mjs'], directory).trim());
  await cp(root + 'examples/research-creative-consumer.mjs', join(directory, 'research-creative-consumer.mjs'));
  console.log(run(process.execPath, ['research-creative-consumer.mjs'], directory).trim());
  await cp(root + 'examples/commerce-evidence-consumer.mjs', join(directory, 'commerce-evidence-consumer.mjs'));
  console.log(run(process.execPath, ['commerce-evidence-consumer.mjs'], directory).trim());
  await cp(root + 'examples/fixture-consumer.mjs', join(directory, 'fixture-consumer.mjs'));
  console.log(run(process.execPath, ['fixture-consumer.mjs'], directory).trim());
  await cp(root + 'examples/capability-consumer.mjs', join(directory, 'capability-consumer.mjs'));
  console.log(run(process.execPath, ['capability-consumer.mjs'], directory).trim());
  console.log(run(process.execPath, [join(directory, 'node_modules', '@jevelopers', 'shared-contracts', 'examples', 'usage-reported-unsettled-consumer.mjs')], directory).trim());
  await cp(root + 'tests/usage-reported-unsettled-cycle-inputs.json', join(directory, 'usage-reported-unsettled-cycle-inputs.json'));
  await writeFile(join(directory, 'usage-cycle-consumer.mjs'), `import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkReportedUnsettledUsageEvent, compareReportedUnsettledUsageIdentity } from '@jevelopers/shared-contracts/usage-reported-unsettled';
const { first, second } = JSON.parse(await readFile(new URL('./usage-reported-unsettled-cycle-inputs.json', import.meta.url), 'utf8'));
const original = JSON.stringify({ first, second });
function refuses(result) {
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.code === 'IDENTITY_COLLISION' && error.path === '/supersedes_observation_id'), JSON.stringify(result.errors));
}
refuses(compareReportedUnsettledUsageIdentity(first.value, second.value));
refuses(compareReportedUnsettledUsageIdentity(second.value, first.value));
refuses(checkReportedUnsettledUsageEvent(first.value, first.context));
refuses(checkReportedUnsettledUsageEvent(second.value, second.context));
assert.equal(JSON.stringify({ first, second }), original);
const earlier = structuredClone(first.value);
earlier.supersedes_observation_id = null;
const later = structuredClone(second.value);
assert.equal(compareReportedUnsettledUsageIdentity(earlier, later).value, 'superseding_observation');
assert.equal(compareReportedUnsettledUsageIdentity(later, earlier).value, 'superseded_observation');
assert.equal(checkReportedUnsettledUsageEvent(later, { ...second.context, prior: earlier }).ok, true);
const late = checkReportedUnsettledUsageEvent(earlier, { ...first.context, prior: later });
assert.equal(late.ok, false);
assert.ok(late.errors.some(error => error.code === 'STALE_REVISION' && error.path === '/source_observation_id'));
console.log(JSON.stringify({ status: 'passed', input: 'reviewer-sealed-synthetic-cycle', comparator_directions: 2, helper_prior_directions: 2, one_way_correction: 'passed', late_observation: 'STALE_REVISION' }));
`);
  console.log(run(process.execPath, ['usage-cycle-consumer.mjs'], directory).trim());
  await productionInstalledChecks(directory, run);
  await writeFile(join(directory, 'consumer.mts'), `import { parseContract, versions } from '@jevelopers/shared-contracts';
import type { ContractMap, ContractVersionMap, ContractName, TenantId, ProjectId, UsageEvent_1_0_0 } from '@jevelopers/shared-contracts';
import { runCanonicalFixtures } from '@jevelopers/shared-contracts/fixture-harness';
import { checkReportedUnsettledUsageEvent } from '@jevelopers/shared-contracts/usage-reported-unsettled';
import type { ProviderReportedUnsettledValuation, UsageReportedContext } from '@jevelopers/shared-contracts/usage-reported-unsettled';
import type { ProviderReportedCostEvidence_1_0_0, UsageEvent_2_0_0 } from '@jevelopers/shared-contracts';
import { checkPrintSpec } from '@jevelopers/shared-contracts/capability';
import type { PrintSpec, CapabilityContext } from '@jevelopers/shared-contracts/capability';
import type { ProductionMeteringPort, ProductionReferenceValue, ProductionResult } from '@jevelopers/shared-contracts/production-operations';
type Assert<T extends true> = T;
type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
type EachVersion = Assert<{ [K in ContractName]: ContractMap[K]['schema_version'] extends keyof ContractVersionMap[K] ? true : false }[ContractName]>;
type Brands = Assert<ProjectId extends TenantId ? false : true>;
type LegacyObserverInput = Parameters<ProductionMeteringPort['observe']>[0];
type LegacyAcceptsAssignedV1 = Assert<IsAssignable<UsageEvent_1_0_0, LegacyObserverInput>>;
type LegacyRejectsV2 = Assert<IsAssignable<UsageEvent_2_0_0, LegacyObserverInput> extends false ? true : false>;
declare const existingV1Observer: (event: UsageEvent_1_0_0) => Promise<ProductionResult<ProductionReferenceValue>>;
const legacyMeteringPort: ProductionMeteringPort = { observe: existingV1Observer };
type DirectRateCardIsNull = Assert<ProviderReportedUnsettledValuation['rate_card_ref'] extends null ? true : false>;
type ExactV2 = Assert<UsageEvent_2_0_0['schema_version'] extends '2.0.0' ? true : false>;
type EvidenceIsReadonly = Assert<ProviderReportedCostEvidence_1_0_0 extends Readonly<ProviderReportedCostEvidence_1_0_0> ? true : false>;
const parsed = parseContract('ProjectRequest', '{}');
if (parsed.ok) { const version: '1.0.0' = parsed.value.schema_version; }
const registry: 'ProjectRequest_1_0_0' = versions.ProjectRequest['1.0.0'];
const result = runCanonicalFixtures('CommonEnvelope', {contract:'CommonEnvelope',schema_version:'1.0.0',policy_version:'1.0.0',valid:{},cases:[]});
export type Parity = readonly [EachVersion, Brands, LegacyAcceptsAssignedV1, LegacyRejectsV2];
declare const capabilityContext: CapabilityContext;
const checkedSpec = checkPrintSpec({}, capabilityContext);
if (checkedSpec.ok) { const unitState: PrintSpec['constraints']['geometry']['trim']['state'] = checkedSpec.value.constraints.geometry.trim.state; }
declare const usageContext: UsageReportedContext;
const reported = checkReportedUnsettledUsageEvent({}, usageContext);
if (reported.ok) { const candidateVersion: '2.0.0' = reported.value.schema_version; }
`);
  run(process.execPath, [root + 'node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', join(directory, 'consumer.mts')], directory);
  console.log(JSON.stringify({ installed_types: 'passed', esm_export_map: 'passed' }));
  console.log(JSON.stringify({ archive_hash: digest, archive_integrity: first.integrity, reproducible: true, runtime_dependencies: 0 }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
