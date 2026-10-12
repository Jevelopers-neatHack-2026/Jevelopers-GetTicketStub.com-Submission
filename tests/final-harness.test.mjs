import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm, cp, copyFile, chmod } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { catalog, contractVersions, classifications } from '../scripts/contracts.mjs';
import { consumerChecks, readPackageArchive, requiredConsumerCoverage } from '../scripts/consumer-checks.mjs';
import { root, readJson, versionTypeHeader } from '../scripts/generate.mjs';
import ts from 'typescript';
import { packageContents, verifyPackageContents } from '../scripts/package-content.mjs';
import { runCanonicalFixtures, assertFixture, fixturePayload } from '../tooling/fixture-harness.mjs';
import { hashManifest, canonicalJson, parseContract, validateContract, projectEvidence } from '../generated/index.mjs';

const entries = await catalog();
for (const entry of entries.flatMap(contractVersions)) {
  const manifest = await readJson(entry.fixtures);
  test(entry.name + ' roundtrips all indexed canonical fixture cases', () => {
    const result = runCanonicalFixtures(entry.name, manifest);
    assert.deepEqual(result.failures, []);
    assert.equal(result.records.length, manifest.cases.length);
    const schema = entry.schema_version;
    const supported = contractVersions(entries.find(row => row.name === entry.name)).map(row => row.schema_version);
    assert.ok(result.records.every(row => supported.includes(row.version) && row.policy_version === manifest.policy_version));
    const minimal = fixturePayload(manifest, manifest.cases.find(row => row.category === 'minimal'));
    const full = fixturePayload(manifest, manifest.cases.find(row => row.category === 'full'));
    assert.ok(Object.keys(full).length >= Object.keys(minimal).length);
    assert.equal(canonicalJson(parseContract(entry.name, canonicalJson(full)).value), canonicalJson(full));
  });
  test(entry.name + ' false validator acceptance cannot pass any negative assertion', () => {
    for (const fixture of manifest.cases.filter(row => !row.expected.ok)) assert.throws(() => assertFixture({ ok: true, value: manifest.valid }, fixture.expected), /Negative fixture/);
    assert.throws(() => assertFixture({ ok: false, errors: [{ code: 'WRONG_CODE', path: '' }] }, manifest.cases.find(row => !row.expected.ok).expected), /Negative fixture/);
    const missingCategory = { ...manifest, cases: manifest.cases.filter(row => row.category !== 'additive_field') };
    assert.ok(runCanonicalFixtures(entry.name, missingCategory).failures.some(row => row.code === 'MISSING_FIXTURE_CATEGORY'));
  });
}
test('fixture metadata omissions and duplicate IDs fail closed', async () => {
  const source = await readJson('fixtures/CommonEnvelope.json');
  const noPolicy = structuredClone(source); delete noPolicy.cases[0].policy_version;
  assert.ok(runCanonicalFixtures(source.contract, noPolicy).failures.some(row => row.code === 'INVALID_FIXTURE_CASE'));
  const duplicate = structuredClone(source); duplicate.cases.push(duplicate.cases[0]);
  assert.ok(runCanonicalFixtures(source.contract, duplicate).failures.some(row => row.code === 'INVALID_FIXTURE_CASE'));
  assert.ok(runCanonicalFixtures(source.contract, { ...source, schema_version: '2.0.0' }).failures.some(row => row.code === 'INVALID_FIXTURE_MANIFEST'));
});

for (const keyword of ['if', 'then', 'else', 'not', 'contains', 'unevaluatedProperties', 'unevaluatedItems', 'propertyNames']) test('classification traverses ' + keyword, () => {
  const schema = { [keyword]: { properties: { credential: { type: 'string' } } } };
  assert.ok(classifications(schema, ['public', 'restricted']).some(row => row.code === 'UNCLASSIFIED_FIELD' && row.path.endsWith('/credential')));
});
for (const keyword of ['prefixItems', 'allOf', 'anyOf', 'oneOf']) test('classification traverses every ' + keyword + ' branch', () => {
  const schema = { [keyword]: [{ properties: { first: { type: 'string', 'x-classification': 'public' } } }, { properties: { credential: { type: 'string' } } }] };
  assert.ok(classifications(schema, ['public']).some(row => row.path.endsWith('/credential')));
});
test('classification resolves local/external escaped references and cyclic schemas safely', () => {
  const target = { $id: 'urn:target', $defs: { 'private/object': { properties: { customer: { type: 'string' } } } } };
  const schema = { $id: 'urn:root', properties: { payload: { 'x-classification': 'restricted', $ref: 'urn:target#/$defs/private~1object' } } };
  assert.ok(classifications(schema, ['restricted'], '', new Map([[target.$id, target]])).some(row => row.path === '/payload/customer'));
  assert.ok(classifications(schema, ['restricted']).some(row => row.code === 'UNRESOLVED_CLASSIFICATION_REFERENCE'));
  const cyclic = { $id: 'urn:cycle', properties: { self: { 'x-classification': 'restricted', $ref: '#' } } };
  assert.deepEqual(classifications(cyclic, ['restricted']), []);
  const dependent = { dependentSchemas: { field: { properties: { private_locator: {} } } } };
  assert.ok(classifications(dependent, ['public']).some(row => row.path.endsWith('/private_locator')));
});
for (const secret of ['raw_prompt', 'customer_data', 'source_data', 'private_locator', 'credentials']) test('public evidence excludes ' + secret + ' at every nested boundary', async () => {
  const projection = structuredClone((await readJson('fixtures/EvidenceProjection.json')).valid);
  const sentinel = 'SYNTHETIC_PRIVATE_SENTINEL';
  projection[secret] = sentinel;
  projection.component[secret] = sentinel;
  assert.equal(validateContract('EvidenceProjection', projection).ok, false);
  const projected = projectEvidence(projection);
  assert.equal(projected.ok, true);
  assert.ok(!JSON.stringify(projected).includes(sentinel));
  const evidence = structuredClone((await readJson('fixtures/EvaluationEvidence.json')).valid);
  evidence.components[0][secret] = sentinel;
  assert.equal(validateContract('EvaluationEvidence', evidence).ok, false);
});

let directory, shared, consumer, sharedSha, consumerSha, archive, packageManifest, schemaManifest, fixtureManifest;
const git = (path, args) => {
  const result = spawnSync('git', ['-C', path, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Synthetic fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Synthetic fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const commitFixture = path => { git(path, ['add', '.']); git(path, ['commit', '-qm', 'synthetic offline integration fixture']); return git(path, ['rev-parse', 'HEAD']); };
const driver = `import { readFile } from 'node:fs/promises';
import { runCanonicalFixtures } from '@jevelopers/shared-contracts/fixture-harness';
const config = JSON.parse(await readFile(process.env.SHARED_CONTRACTS_BINDING_CONFIG, 'utf8'));
for (const {contract, path} of config.required_fixtures) {
  const fixture = JSON.parse(await readFile(process.env.SHARED_CONTRACTS_ROOT + '/' + path, 'utf8'));
  const result = runCanonicalFixtures(contract, fixture);
  if (result.failures.length) throw new Error('Fixture adapter failure');
}
const b = config.binding;
console.log(JSON.stringify({ status: 'passed', consumer_sha: b.consumer_sha, shared_source_revision: b.shared_source_revision, package_integrity: b.package_integrity, package_content_digest: b.package_content_digest, fixture_digest: b.fixture_digest, binding_nonce: b.nonce, contracts_tested: config.required }));
`;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'shared-contracts-final-tests-'));
  shared = join(directory, 'shared'); consumer = join(directory, 'consumer');
  await mkdir(shared); await mkdir(consumer);
  for (const [path, bytes] of await packageContents(root)) { await mkdir(join(shared, path, '..'), { recursive: true }); await writeFile(join(shared, path), bytes); }
  await cp(root + 'generated/package-content-manifest.json', join(shared, 'generated/package-content-manifest.json'));
  git(shared, ['init', '-q']); sharedSha = commitFixture(shared);
  await writeFile(join(consumer, 'driver.mjs'), driver);
  git(consumer, ['init', '-q']); consumerSha = commitFixture(consumer);
  packageManifest = await readJson('generated/package-content-manifest.json');
  schemaManifest = await readJson('generated/schema-manifest.json');
  fixtureManifest = await readJson('generated/fixture-manifest.json');
  const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', directory], { cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' } });
  assert.equal(pack.status, 0, pack.stderr); archive = JSON.parse(pack.stdout)[0];
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function manifestFor({ all = false, mode = 'source', mutate = () => {}, script = 'driver.mjs', sourceRevision = sharedSha } = {}) {
  const manifest = structuredClone(await readJson('compatibility/consumers.json'));
  for (const entry of manifest.repositories) {
    if (!all && entry.repository !== 'agent-harness') continue;
    const required = requiredConsumerCoverage(entries, entry.repository);
    entry.roles = required.requiredRoles;
    Object.assign(entry, { source_sha: consumerSha, local_path: consumer, dependency_mode: 'offline', shared_source_revision: sourceRevision, package_content_digest: packageManifest.digest, package_integrity: mode === 'artifact' ? archive.integrity : null, shared_binding: { mode, local_path: mode === 'artifact' ? join(directory, archive.filename) : shared }, command: ['node', script], schema_pins: schemaManifest.schemas.filter(row => required.requiredFixtures.some(c => c.contract === row.contract && c.version === row.version)).map(row => ({ contract: row.contract, version: row.version, schema_id: row.schema_id, sha256: row.sha256 })), fixture_digest: fixtureManifest.digest });
    mutate(entry);
    const acknowledgement = { status: 'accepted', consumer_sha: entry.source_sha, shared_source_revision: entry.shared_source_revision, package_content_digest: entry.package_content_digest, package_integrity: entry.package_integrity, schema_pins_digest: hashManifest(entry.schema_pins), fixture_digest: entry.fixture_digest, command_digest: hashManifest(entry.command), reviewer: 'synthetic-fixture-reviewer', reviewed_at: '2026-10-10T12:00:00Z', record_ref: 'https://github.com/example/synthetic-fixture/pull/1' };
    const ackPath = join(directory, entry.repository + '-ack-' + Math.random().toString(36).slice(2) + '.json');
    await writeFile(ackPath, JSON.stringify(acknowledgement));
    entry.acknowledgement = { ...acknowledgement, local_path: ackPath };
  }
  return manifest;
}
const failureFor = (result, repository = 'agent-harness') => result.failures.find(row => row.repository === repository)?.code;
test('intended evidence roles stay separate from current per-version pins and roles', async () => {
  const evidence = entries.find(entry => entry.name === 'ProviderReportedCostEvidence');
  assert.deepEqual(evidence.producers, ['cost-intelligence']);
  assert.deepEqual(evidence.consumers, ['cost-intelligence', 'integration-evals']);
  assert.equal(evidence.role_status, 'intended_role_only');
  assert.equal(evidence.named_owner, null);
  assert.equal(evidence.reviewer, null);
  assert.equal(evidence.owner_acknowledgement, null);
  assert.deepEqual(evidence.versions[0].producers, []);
  assert.deepEqual(evidence.versions[0].consumers, []);
  assert.equal(evidence.versions[0].role_status, 'opt_in_candidate_no_current_assignment');

  const usage = entries.find(entry => entry.name === 'UsageEvent');
  const existingUsage = requiredConsumerCoverage(entries, 'cost-intelligence').requiredFixtures;
  assert.ok(existingUsage.some(row => row.contract === 'UsageEvent' && row.version === '1.0.0'));
  assert.ok(!existingUsage.some(row => row.contract === 'UsageEvent' && row.version === '2.0.0'));
  assert.equal(usage.versions.find(version => version.schema_version === '2.0.0').role_status, 'opt_in_candidate_no_current_assignment');

  const manifest = await readJson('compatibility/consumers.json');
  for (const repository of ['cost-intelligence', 'integration-evals']) {
    const current = requiredConsumerCoverage(entries, repository);
    const existingEntries = entries.filter(entry => entry.name !== 'ProviderReportedCostEvidence' && (entry.producers.includes(repository) || entry.consumers.includes(repository)));
    assert.ok(!current.requiredNames.includes('ProviderReportedCostEvidence'));
    assert.ok(!current.requiredFixtures.some(row => row.contract === 'ProviderReportedCostEvidence'));
    assert.ok(!current.requiredRoles.some(row => row.contract === 'ProviderReportedCostEvidence'));
    assert.ok(current.requiredNames.includes('UsageEvent'));
    assert.deepEqual(current.requiredNames, existingEntries.map(entry => entry.name));
    assert.deepEqual(
      current.requiredFixtures.filter(row => row.contract !== 'ProviderReportedCostEvidence').map(row => row.contract + '@' + row.version),
      existingEntries.flatMap(entry => (entry.versions ?? [entry])
        .map(version => ({ ...entry, ...version }))
        .filter(version => version.producers?.includes(repository) || version.consumers?.includes(repository))
        .map(version => entry.name + '@' + version.schema_version))
    );
    assert.deepEqual(
      current.requiredRoles.filter(row => row.contract !== 'ProviderReportedCostEvidence'),
      existingEntries.map(entry => ({
        contract: entry.name,
        producer: entry.producers.includes(repository),
        consumer: entry.consumers.includes(repository)
      }))
    );
    const declared = manifest.repositories.find(row => row.repository === repository);
    assert.ok(!declared.roles.some(row => row.contract === 'ProviderReportedCostEvidence'));
    assert.ok(!declared.schema_pins.some(row => row.contract === 'ProviderReportedCostEvidence'));
    assert.ok(!declared.schema_pins.some(row => row.contract === 'UsageEvent' && row.version === '2.0.0'));
  }

  const printProduction = requiredConsumerCoverage(entries, 'print-production');
  assert.ok(printProduction.requiredFixtures.some(row => row.contract === 'ProductionBundle' && row.version === '2.0.0'));
  assert.ok(printProduction.requiredRoles.some(row => row.contract === 'ProductionBundle' && row.producer && !row.consumer));
});
test('nine synthetic adapters bind real imported source code and all catalog roles', async () => {
  const result = await consumerChecks(await manifestFor({ all: true }));
  assert.deepEqual(result.failures, []);
  assert.equal(result.records.length, 9);
  assert.equal(result.checkout_records.length, 9);
  const application = result.records.find(row => row.repository === 'getticketstub.com');
  for (const contract of ['ProjectRequest', 'ApprovalReceipt', 'ApprovalReference', 'OrderAuthorization', 'FulfillmentQuote', 'FulfillmentStatus']) assert.ok(application.observed_contracts.includes(contract));
});
test('unaccepted usage candidates do not expand existing consumer pins', async () => {
  const manifest = await manifestFor({ all: true });
  for (const entry of manifest.repositories) {
    assert.equal(entry.schema_pins.some(pin => pin.contract === 'UsageEvent' && pin.version === '2.0.0'), false);
    assert.equal(entry.schema_pins.some(pin => pin.contract === 'ProviderReportedCostEvidence'), false);
    assert.equal(entry.roles.some(role => role.contract === 'ProviderReportedCostEvidence'), false);
  }
});
test('integrity-locked actual archive binds imports independently of source checkout', async () => {
  const result = await consumerChecks(await manifestFor({ mode: 'artifact' }));
  assert.equal(failureFor(result), undefined);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].package_integrity, archive.integrity);
});
for (const [name, mutate, code] of [
  ['wrong consumer revision', entry => { entry.source_sha = '1'.repeat(40); }, 'BLOCKED_REVISION_MISMATCH'],
  ['missing shared revision', entry => { entry.shared_source_revision = null; }, 'BLOCKED_MISSING_INTEGRATION_PIN'],
  ['wrong shared revision despite matching schemas and fixtures', entry => { entry.shared_source_revision = '1'.repeat(40); }, 'BLOCKED_SHARED_REVISION_MISMATCH'],
  ['missing package code digest', entry => { entry.package_content_digest = null; }, 'BLOCKED_MISSING_INTEGRATION_PIN'],
  ['forged package code digest', entry => { entry.package_content_digest = 'sha256:' + '1'.repeat(64); }, 'BLOCKED_MISSING_INTEGRATION_PIN'],
  ['tampered schema hash', entry => { entry.schema_pins[0].sha256 = '1'.repeat(64); }, 'BLOCKED_MISSING_INTEGRATION_PIN'],
  ['tampered schema identity', entry => { entry.schema_pins[0].schema_id = 'https://schemas.example.invalid/wrong'; }, 'BLOCKED_MISSING_INTEGRATION_PIN'],
  ['tampered fixture digest', entry => { entry.fixture_digest = 'sha256:' + '1'.repeat(64); }, 'BLOCKED_MISSING_INTEGRATION_PIN'],
  ['incomplete schema coverage', entry => { entry.schema_pins.pop(); }, 'BLOCKED_INCOMPLETE_CONSUMER_COVERAGE'],
  ['incomplete role coverage', entry => { entry.roles = []; }, 'BLOCKED_INCOMPLETE_CONSUMER_COVERAGE'],
  ['missing fixture command', entry => { entry.command = null; }, 'BLOCKED_MISSING_CONSUMER_COMMAND'],
  ['escaping driver path', entry => { entry.command = ['node', '../driver.mjs']; }, 'BLOCKED_MISSING_CONSUMER_COMMAND']
]) test('consumer runner rejects ' + name, async () => {
  assert.equal(failureFor(await consumerChecks(await manifestFor({ mutate }))), code);
});
test('missing and duplicate mandatory consumer rows fail', async () => {
  const manifest = await manifestFor(); manifest.repositories.pop();
  assert.equal(failureFor(await consumerChecks(manifest), 'getticketstub.com'), 'MISSING_OR_DUPLICATE_CONSUMER');
  manifest.repositories.push(manifest.repositories[0]);
  assert.equal(failureFor(await consumerChecks(manifest)), 'MISSING_OR_DUPLICATE_CONSUMER');
});
test('dirty consumer and dirty shared checkouts fail before driver execution', async () => {
  const manifest = await manifestFor();
  await writeFile(join(consumer, 'untracked'), 'synthetic');
  assert.equal(failureFor(await consumerChecks(manifest)), 'BLOCKED_DIRTY_CHECKOUT');
  await rm(join(consumer, 'untracked'));
  await writeFile(join(shared, 'untracked'), 'synthetic');
  assert.equal(failureFor(await consumerChecks(manifest)), 'BLOCKED_DIRTY_SHARED_CHECKOUT');
  await rm(join(shared, 'untracked'));
});
test('acknowledgement provenance requires its actual consistent external record', async () => {
  let manifest = await manifestFor(), entry = manifest.repositories[0];
  entry.acknowledgement.status = 'pending';
  assert.equal(failureFor(await consumerChecks(manifest)), 'BLOCKED_MISSING_INTEGRATION_PIN');
  manifest = await manifestFor(); entry = manifest.repositories[0];
  await writeFile(entry.acknowledgement.local_path, JSON.stringify({ status: 'accepted' }));
  assert.equal(failureFor(await consumerChecks(manifest)), 'INVALID_ACKNOWLEDGEMENT_RECORD');
  manifest = await manifestFor(); entry = manifest.repositories[0]; delete entry.acknowledgement.local_path;
  assert.equal(failureFor(await consumerChecks(manifest)), 'BLOCKED_MISSING_ACKNOWLEDGEMENT_RECORD');
});
for (const [name, edit, code] of [
  ['missing receipt', text => text.slice(0, text.indexOf('console.log')), 'MISSING_CONSUMER_RECEIPT'],
  ['forged package receipt', text => text.replace('b.package_content_digest, fixture_digest', "'sha256:' + '1'.repeat(64), fixture_digest"), 'INVALID_CONSUMER_RECEIPT'],
  ['missing contract receipt', text => text.replace('contracts_tested: config.required', 'contracts_tested: []'), 'INVALID_CONSUMER_RECEIPT'],
  ['claimed imports without actual fixture execution', text => text.replace('of config.required_fixtures)', 'of [])'), 'MISSING_OBSERVED_PACKAGE_COVERAGE'],
  ['altered fixtures supplied to imported adapter', text => text.replace('runCanonicalFixtures(contract, fixture)', "runCanonicalFixtures(contract, { ...fixture, status: 'forged' })"), 'MISSING_OBSERVED_PACKAGE_COVERAGE'],
  ['network-capable driver import', text => "import 'node:https';\n" + text, 'CONSUMER_CHECK_FAILED']
]) test('consumer runner rejects ' + name, async () => {
  const alternate = join(directory, 'alternate-' + Math.random().toString(36).slice(2)); await mkdir(alternate);
  await writeFile(join(alternate, 'driver.mjs'), edit(driver)); git(alternate, ['init', '-q']); const revision = commitFixture(alternate);
  const manifest = await manifestFor({ mutate: entry => { entry.source_sha = revision; entry.local_path = alternate; } });
  assert.equal(failureFor(await consumerChecks(manifest)), code);
});
test('counterfeit source helper code cannot pass unchanged schema/fixture pins', async () => {
  const alternate = join(directory, 'counterfeit-source'); await cp(shared, alternate, { recursive: true });
  await writeFile(join(alternate, 'tooling/runtime.mjs'), (await readFile(join(alternate, 'tooling/runtime.mjs'), 'utf8')) + '\nexport const counterfeit = true;\n');
  const revision = commitFixture(alternate);
  const manifest = await manifestFor({ sourceRevision: revision, mutate: entry => { entry.shared_binding.local_path = alternate; } });
  assert.equal(failureFor(await consumerChecks(manifest)), 'PACKAGE_CONTENT_MISMATCH');
});
test('tampered archive is rejected even when all declaration pins remain unchanged', async () => {
  const tampered = join(directory, 'tampered.tgz'); const bytes = await readFile(join(directory, archive.filename)); bytes[bytes.length - 1] ^= 1; await writeFile(tampered, bytes);
  const manifest = await manifestFor({ mode: 'artifact', mutate: entry => { entry.shared_binding.local_path = tampered; } });
  assert.equal(failureFor(await consumerChecks(manifest)), 'ARTIFACT_INTEGRITY_MISMATCH');
  assert.throws(() => readPackageArchive(bytes, archive.integrity), /ARTIFACT_INTEGRITY_MISMATCH/);
});
test('package content guard binds code, types, schemas, fixtures, notices and exports', async () => {
  assert.equal(await verifyPackageContents(root, packageManifest), true);
  for (const file of ['tooling/runtime.mjs', 'tooling/fixture-harness.mjs', 'generated/index.d.ts', 'generated/validators.mjs', 'generated/THIRD_PARTY_NOTICES.md', 'package.json']) assert.ok(packageManifest.files[file]);
  const provenance = await readJson('generated/dependency-provenance.json');
  const notices = await readFile(root + 'generated/THIRD_PARTY_NOTICES.md', 'utf8');
  for (const dependency of provenance.packages) {
    const source = await readFile(root + 'node_modules/' + dependency.name + '/LICENSE', 'utf8');
    assert.ok(notices.includes(source.trimEnd()));
    assert.ok(provenance.embedded.includes(dependency.name));
  }
});

test('every distributed declaration has readonly properties, maps and arrays', async () => {
  const files = (await import('node:fs/promises')).readdir;
  for (const name of (await files(root + 'generated')).filter(name => name.endsWith('.d.ts'))) {
    const ast = ts.createSourceFile(name, await readFile(root + 'generated/' + name, 'utf8'), ts.ScriptTarget.Latest, true);
    function inspect(node) {
      if (ts.isPropertySignature(node) || ts.isIndexSignatureDeclaration(node)) assert.ok(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ReadonlyKeyword), name + ': mutable property/map');
      if (ts.isArrayTypeNode(node) || ts.isTupleTypeNode(node)) assert.ok(ts.isTypeOperatorNode(node.parent) && node.parent.operator === ts.SyntaxKind.ReadonlyKeyword, name + ': mutable array/tuple');
      ts.forEachChild(node, inspect);
    }
    inspect(ast);
  }
});
test('generated aliases preserve both synthetic supported version types', async () => {
  const local = await mkdtemp(join(tmpdir(), 'shared-contracts-version-types-'));
  try {
    await writeFile(join(local, 'Example_1_0_0.d.ts'), "export type Example = { readonly contract: 'Example'; readonly schema_version: '1.0.0'; readonly old: true };\n");
    await writeFile(join(local, 'Example_2_0_0.d.ts'), "export type Example = { readonly contract: 'Example'; readonly schema_version: '2.0.0'; readonly current: true };\n");
    await writeFile(join(local, 'index.d.ts'), versionTypeHeader({ Example: { '1.0.0': 'Example_1_0_0', '2.0.0': 'Example_2_0_0' } }));
    await writeFile(join(local, 'consumer.mts'), "import type { Example } from './index.js';\ntype Assert<T extends true> = T;\ntype Both = Assert<Example['schema_version'] extends '1.0.0' | '2.0.0' ? ('1.0.0' | '2.0.0' extends Example['schema_version'] ? true : false) : false>;\nexport function use(v: Example) { return v.schema_version === '1.0.0' ? v.old : v.current; }\n");
    const result = spawnSync(process.execPath, [root + 'node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', join(local, 'consumer.mts')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { await rm(local, { recursive: true, force: true }); }
});
for (const [name, source, diagnostic] of [
  ['scope brand mixing', 'declare const project: ProjectId; const tenant: TenantId = project;', 'TS2322'],
  ['unknown supported version', "const version: ContractMap['ProjectRequest']['schema_version'] = '2.0.0';", 'TS2322'],
  ['nested immutable money', "declare const quote: FulfillmentQuote; if (quote.total) quote.total.amount = '1';", 'TS2540'],
  ['immutable question map', "declare const request: DecisionPortRequest; request.questions['new'] = request.questions['old']!;", 'TS2542'],
  ['immutable question choices', "declare const request: DecisionPortRequest; const q = request.questions['question']!; if (q.type === 'choice') q.eligible_candidate_ids.push('mutated');", 'TS2339'],
  ['immutable source reference', "declare const envelope: CommonEnvelope; envelope.source_refs[0]!.id = 'mutated';", 'TS2540']
]) test('actual TypeScript rejects ' + name, async () => {
  const local = await mkdtemp(join(tmpdir(), 'shared-contracts-negative-type-'));
  try {
    await writeFile(join(local, 'consumer.mts'), 'import type { ProjectId, TenantId, ContractMap, FulfillmentQuote, DecisionPortRequest, CommonEnvelope } from ' + JSON.stringify(root + 'generated/index.js') + ';\n' + source + '\n');
    const result = spawnSync(process.execPath, [root + 'node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', join(local, 'consumer.mts')], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.ok(result.stdout.includes(diagnostic), result.stdout);
    if (name === 'immutable question choices') assert.ok(result.stdout.includes("Property 'push' does not exist"), result.stdout);
  } finally { await rm(local, { recursive: true, force: true }); }
});
test('missing real package command and missing local source artifact remain blocked', async () => {
  const manifest = await manifestFor({ mutate: entry => { entry.shared_binding.local_path = join(directory, 'absent-source'); } });
  assert.equal(failureFor(await consumerChecks(manifest)), 'BLOCKED_SHARED_REVISION_MISMATCH');
  const cli = spawnSync(process.execPath, ['scripts/contracts.mjs', 'consumers', '--manifest', 'counterfeit.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(cli.status, 1);
});

test('coverage preserves all 126 local criteria and scoped global IDs without granting acceptance', async () => {
  const { coverageEvidence, humanCoverage } = await import('../scripts/coverage.mjs');
  const result = await coverageEvidence();
  const requirements = await readJson('docs/requirements.json');
  const expected = requirements.issues.flatMap(row => row.acceptance_ids).concat(['SC-EPIC.1', 'SC-EPIC.2', 'SC-EPIC.3']);
  assert.deepEqual(result.local_criteria.map(row => row.id).sort(), expected.sort());
  assert.equal(result.local_criteria.length, 126);
  assert.equal(new Set(result.local_criteria.map(row => row.id)).size, 126);
  assert.ok(result.local_criteria.every(row => row.independent_review === 'pending_exact_candidate' && row.owner_and_consumer_acceptance === 'pending'));
  assert.ok(result.local_criteria.filter(row => [1, 3].includes(row.issue)).every(row => row.status === 'release_or_epic_blocked'));
  assert.ok(result.local_criteria.filter(row => row.issue === 12).every(row => row.status === 'local_producer_repair_review_pending' && row.unresolved_findings.length === 4));
  assert.deepEqual(result.global_criteria.map(row => row.id).sort(), requirements.global_requirements.slice().sort());
  assert.ok(result.global_criteria.every(row => row.contribution_only && row.status === 'unverified_external_master_tracker'));
  const human = humanCoverage(result);
  for (const id of expected) assert.ok(human.includes(id));
  const json = JSON.stringify(result);
  for (const privateKey of ['"context":', '"valid":', '"artifact_bytes":', '"local_path":', root]) assert.ok(!json.includes(privateKey));
  const schemaManifest = await readJson('generated/schema-manifest.json');
  assert.equal(result.contracts.length, schemaManifest.schemas.length);
  assert.ok(result.contracts.every(row => row.failures.length === 0));
});

test('malformed pin and role records return typed blockers without crashing', async () => {
  let manifest = await manifestFor();
  manifest.repositories[0].schema_pins[0] = null;
  assert.equal(failureFor(await consumerChecks(manifest)), 'BLOCKED_MISSING_INTEGRATION_PIN');
  manifest = await manifestFor();
  manifest.repositories[0].roles = [null];
  assert.equal(failureFor(await consumerChecks(manifest)), 'BLOCKED_INCOMPLETE_CONSUMER_COVERAGE');
  manifest = await manifestFor();
  delete manifest.repositories[0].command;
  assert.equal(failureFor(await consumerChecks(manifest)), 'BLOCKED_MISSING_INTEGRATION_PIN');
});

for (const mode of ['source', 'artifact']) test('SC-CHK-001 rejects zero-import driver forging writable-audit coverage in ' + mode + ' mode', async () => {
  const alternate = join(directory, 'forged-audit-' + mode);
  await mkdir(alternate);
  const forged = `import {readFile,writeFile} from 'node:fs/promises';
const config=JSON.parse(await readFile(process.env.SHARED_CONTRACTS_BINDING_CONFIG,'utf8'));
const audit=config.audit ?? './forged-audit.jsonl';
await writeFile(audit,config.required_fixtures.map(item=>JSON.stringify({kind:'fixture_run',contract:item.contract,version:item.version,bound:true,failures:0,positive:1,negative:1,semantic:['CommonEnvelope','EvidenceProjection'].includes(item.contract)?0:1})).join('\\n')+'\\n');
const b=config.binding;
console.log(JSON.stringify({status:'passed',consumer_sha:b.consumer_sha,shared_source_revision:b.shared_source_revision,package_integrity:b.package_integrity,package_content_digest:b.package_content_digest,fixture_digest:b.fixture_digest,binding_nonce:b.nonce,contracts_tested:config.required}));
`;
  await writeFile(join(alternate, 'driver.mjs'), forged);
  git(alternate, ['init', '-q']); const revision = commitFixture(alternate);
  const manifest = await manifestFor({ mode, mutate: entry => { entry.source_sha = revision; entry.local_path = alternate; } });
  const result = await consumerChecks(manifest);
  assert.equal(failureFor(result), 'MISSING_OBSERVED_PACKAGE_COVERAGE');
  assert.equal(result.records.length, 0);
});
test('SC-CHK-001 merely importing the package does not fabricate canonical fixture execution', async () => {
  const alternate = join(directory, 'unused-package-import'); await mkdir(alternate);
  const noRuns = driver.replace('of config.required_fixtures)', 'of [])');
  await writeFile(join(alternate, 'driver.mjs'), noRuns); git(alternate, ['init', '-q']); const revision = commitFixture(alternate);
  const result = await consumerChecks(await manifestFor({ mutate: entry => { entry.source_sha = revision; entry.local_path = alternate; } }));
  assert.equal(failureFor(result), 'MISSING_OBSERVED_PACKAGE_COVERAGE');
});
test('SC-CHK-001 runner losing its own executable is a typed runner failure, not a consumer artifact defect', async () => {
  const alternate = join(directory, 'runner-executable-removed'); await mkdir(alternate);
  await writeFile(join(alternate, 'driver.mjs'), "console.log(JSON.stringify({ status: 'passed' }));\n");
  git(alternate, ['init', '-q']); const revision = commitFixture(alternate);
  const manifestPath = join(directory, 'runner-executable-removed.json');
  await writeFile(manifestPath, JSON.stringify(await manifestFor({ mutate: entry => { entry.source_sha = revision; entry.local_path = alternate; } })));
  // A disposable runtime copy removes itself before checking, as when a shared npx cache is re-reified mid-run.
  const runtime = join(directory, 'runner-executable-removed-node');
  await copyFile(process.execPath, runtime, fsConstants.COPYFILE_FICLONE);
  await chmod(runtime, 0o755);
  const program = `import { readFile, unlink } from 'node:fs/promises';
const { consumerChecks } = await import(${JSON.stringify(root + 'scripts/consumer-checks.mjs')});
const manifest = JSON.parse(await readFile(process.argv[1], 'utf8'));
await unlink(process.execPath);
console.log(JSON.stringify(await consumerChecks(manifest)));`;
  const child = spawnSync(runtime, ['--input-type=module', '--eval', program, manifestPath], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 120000 });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  const failure = result.failures.find(row => row.repository === 'agent-harness');
  assert.deepEqual(failure, { code: 'TRUSTED_PROBE_UNAVAILABLE', repository: 'agent-harness', diagnostic: { error: 'ENOENT', signal: null } });
  assert.equal(result.records.length, 0);
  assert.ok(!child.stdout.includes(directory));
});

for (const [probe, code] of [
  [{ status: 0, stdout: '{}' }, 'TRUSTED_PROBE_INVALID_RESULT'],
  [{ status: 0, stdout: JSON.stringify({ status: 'failed', records: [] }) }, 'TRUSTED_PROBE_INVALID_RESULT'],
  [{ status: 0, stdout: JSON.stringify({ status: 'passed', records: [] }) }, 'TRUSTED_PROBE_INVALID_RESULT'],
  [{ status: 0, stdout: '{' }, 'TRUSTED_PROBE_INVALID_RESULT'],
  [{ status: null, stdout: '', error: { code: 'ENOBUFS' }, signal: 'SIGTERM' }, 'TRUSTED_PROBE_OUTPUT_LIMIT']
]) test('trusted probe result rejects ' + code + ' / ' + probe.stdout, async () => {
  const manifestPath = join(directory, 'invalid-trusted-probe.json');
  await writeFile(manifestPath, JSON.stringify(await manifestFor()));
  const program = `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readFile } from 'node:fs/promises';
const original = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => args[0]?.endsWith('consumer-trusted-probe.mjs') ? ${JSON.stringify(probe)} : original(command, args, options);
syncBuiltinESMExports();
const { consumerChecks } = await import(${JSON.stringify(root + 'scripts/consumer-checks.mjs')});
console.log(JSON.stringify(await consumerChecks(JSON.parse(await readFile(process.argv[1], 'utf8')))));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', program, manifestPath], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 60000 });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(failureFor(result), code);
  assert.equal(result.records.length, 0);
  assert.ok(!child.stdout.includes(directory));
});
