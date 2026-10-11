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
  await productionInstalledChecks(directory, run);
  await writeFile(join(directory, 'consumer.mts'), `import { parseContract, versions } from '@jevelopers/shared-contracts';
import type { ContractMap, ContractVersionMap, ContractName, TenantId, ProjectId } from '@jevelopers/shared-contracts';
import { runCanonicalFixtures } from '@jevelopers/shared-contracts/fixture-harness';
import { checkPrintSpec } from '@jevelopers/shared-contracts/capability';
import type { PrintSpec, CapabilityContext } from '@jevelopers/shared-contracts/capability';
type Assert<T extends true> = T;
type EachVersion = Assert<{ [K in ContractName]: ContractMap[K]['schema_version'] extends keyof ContractVersionMap[K] ? true : false }[ContractName]>;
type Brands = Assert<ProjectId extends TenantId ? false : true>;
const parsed = parseContract('ProjectRequest', '{}');
if (parsed.ok) { const version: '1.0.0' = parsed.value.schema_version; }
const registry: 'ProjectRequest_1_0_0' = versions.ProjectRequest['1.0.0'];
const result = runCanonicalFixtures('CommonEnvelope', {contract:'CommonEnvelope',schema_version:'1.0.0',policy_version:'1.0.0',valid:{},cases:[]});
export type Parity = readonly [EachVersion, Brands];
declare const capabilityContext: CapabilityContext;
const checkedSpec = checkPrintSpec({}, capabilityContext);
if (checkedSpec.ok) { const unitState: PrintSpec['constraints']['geometry']['trim']['state'] = checkedSpec.value.constraints.geometry.trim.state; }
`);
  run(process.execPath, [root + 'node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', join(directory, 'consumer.mts')], directory);
  console.log(JSON.stringify({ installed_types: 'passed', esm_export_map: 'passed' }));
  console.log(JSON.stringify({ archive_hash: digest, reproducible: true, runtime_dependencies: 0 }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
