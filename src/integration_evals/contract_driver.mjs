import { readFile, realpath } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const request = JSON.parse(readFileSync(0, 'utf8'));
if (process.versions.node !== request.node_version) throw new Error('Runtime version mismatch');
const root = await realpath(resolve(request.producer));
const path = async name => {
  const target = await realpath(resolve(root, name));
  const displacement = relative(root, target);
  if (displacement.startsWith('..') || isAbsolute(displacement)) throw new Error('Unsafe fixture path');
  return target;
};
const read = async name => readFile(await path(name));
const sdk = await import(pathToFileURL(await path('generated/index.mjs')).href);
const json = async path => JSON.parse(await read(path));
const schemas = await json('generated/schema-manifest.json');
const fixtures = await json('generated/fixture-manifest.json');
if (sdk.hashManifest(fixtures.files) !== fixtures.digest) throw new Error('Fixture manifest mismatch');
for (const [path, expected] of Object.entries(fixtures.files)) {
  if (sdk.hashBytes(await read(path)) !== expected) throw new Error('Fixture bytes mismatch');
}
const results = [];
for (const schema of schemas.schemas) {
  if (sdk.hashBytes(await read(schema.path)) !== 'sha256:' + schema.sha256) throw new Error('Schema bytes mismatch');
  const path = 'fixtures/' + schema.contract + '.json';
  if (!Object.hasOwn(fixtures.files, path)) throw new Error('Fixture export not pinned');
  const source = await json(path);
  const failures = [];
  const cases = [];
  const categories = new Set();
  for (const fixture of source.cases) {
    cases.push(fixture.id);
    categories.add(fixture.category);
    const payload = structuredClone(source.valid);
    for (const key of fixture.remove ?? []) delete payload[key];
    Object.assign(payload, fixture.set ?? {});
    let observation;
    switch (fixture.mode ?? 'wire') {
      case 'commerce_evidence': {
        const context = structuredClone(fixture.context);
        if (context.artifact_bytes) context.artifact_bytes = Object.fromEntries(
          Object.entries(context.artifact_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
        observation = sdk.checkCommerceEvidence(schema.contract, payload, context);
        break;
      }
      case 'research_creative': {
        const context = structuredClone(fixture.context);
        if (context.artifact_bytes) context.artifact_bytes = Object.fromEntries(
          Object.entries(context.artifact_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
        observation = sdk.checkResearchCreative(schema.contract, payload, context);
        break;
      }
      case 'semantic': observation = sdk.checkOperation(schema.contract, payload, fixture.context); break;
      case 'relationship': observation = sdk.compareUsageIdentity(fixture.prior, payload); break;
      case 'context': observation = sdk.checkTrustedContext(payload, fixture.expected_context); break;
      case 'parse': observation = sdk.parseContract(schema.contract, fixture.json); break;
      case 'wire': observation = sdk.validateContract(schema.contract, payload); break;
      default: throw new Error('Unsupported fixture mode');
    }
    const expected = fixture.expected;
    const matches = expected.ok
      ? observation.ok && (!Object.hasOwn(expected, 'value') || sdk.canonicalJson(observation.value) === sdk.canonicalJson(expected.value))
      : !observation.ok && observation.errors.some(error => error.code === expected.code && error.path === expected.path);
    if (!matches) failures.push(fixture.id);
  }
  results.push({ contract: schema.contract, version: schema.version, schema_digest: schema.sha256,
    cases, failures, categories: [...categories].sort() });
}
const catalogText = (await read('docs/contract-catalog.md')).toString('utf8');
const catalog = JSON.parse(catalogText.match(/```json catalog\n([\s\S]*?)\n```/)[1]).contracts;
console.log(JSON.stringify({ node_version: process.versions.node, fixture_digest: fixtures.digest.slice(7),
  required_contracts: catalog.map(row => row.name), results }));
