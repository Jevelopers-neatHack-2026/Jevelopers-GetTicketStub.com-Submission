import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { versions, hashManifest, hashBytes, validateContract, parseContract, canonicalJson } from '@jevelopers/shared-contracts';
import { runCanonicalFixtures, assertFixture } from '@jevelopers/shared-contracts/fixture-harness';

const packageRoot = new URL('../', import.meta.resolve('@jevelopers/shared-contracts'));
const read = async path => JSON.parse(await readFile(new URL(path, packageRoot), 'utf8'));
const schemaManifest = await read('generated/schema-manifest.json');
const fixtureManifest = await read('generated/fixture-manifest.json');
const contentManifest = await read('generated/package-content-manifest.json');
assert.equal(hashManifest(contentManifest.files), contentManifest.digest);
for (const [path, expected] of Object.entries(contentManifest.files)) assert.equal(hashBytes(await readFile(new URL(path, packageRoot))), expected);
assert.equal(hashManifest(fixtureManifest.files), fixtureManifest.digest);
assert.equal(fixtureManifest.contracts.length, schemaManifest.schemas.length);
let cases = 0, negativeAssertions = 0;
for (const schema of schemaManifest.schemas) {
  assert.equal(hashBytes(await readFile(new URL(schema.path, packageRoot))), 'sha256:' + schema.sha256);
  assert.ok(Object.hasOwn(versions[schema.contract], schema.version));
  const fixture = await read('fixtures/' + schema.contract + '.json');
  const result = runCanonicalFixtures(schema.contract, fixture);
  assert.deepEqual(result.failures, []);
  cases += result.records.length;
  for (const row of fixture.cases.filter(row => !row.expected.ok)) {
    assert.throws(() => assertFixture({ ok: true, value: fixture.valid }, row.expected), /Negative fixture/);
    negativeAssertions++;
  }
  const parsed = parseContract(schema.contract, canonicalJson(fixture.valid));
  assert.equal(parsed.ok, true);
  assert.equal(hashManifest(parsed.value), hashManifest(fixture.valid));
  assert.equal(validateContract(schema.contract, { ...fixture.valid, schema_version: '999.0.0' }).ok, false);
}
console.log(JSON.stringify({ status: 'passed', scope: 'package_owned_representative_fixtures', contracts: schemaManifest.schemas.length, cases, negative_assertions: negativeAssertions, fixture_digest: fixtureManifest.digest, package_content_digest: contentManifest.digest, provider_calls: 0, runtime_dependencies: 0, real_consumer_adoption: 'pending' }));
