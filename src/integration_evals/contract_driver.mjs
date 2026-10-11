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
const { runCanonicalFixtures } = await import(pathToFileURL(await path('tooling/fixture-harness.mjs')).href);
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
  const evaluation = runCanonicalFixtures(schema.contract, source);
  if (evaluation.failures.some(failure => typeof failure.case !== 'string')) throw new Error('Canonical fixture manifest rejected');
  const failures = evaluation.failures.map(failure => failure.case);
  const cases = source.cases.map(fixture => fixture.id);
  const attempted = new Set([...evaluation.records.map(record => record.case), ...failures]);
  if (attempted.size !== cases.length || cases.some(id => !attempted.has(id))) throw new Error('Canonical fixture coverage mismatch');
  const categories = new Set(source.cases.map(fixture => fixture.category));
  results.push({ contract: schema.contract, version: schema.version, schema_digest: schema.sha256,
    cases, failures, categories: [...categories].sort() });
}
const catalogText = (await read('docs/contract-catalog.md')).toString('utf8');
const catalog = JSON.parse(catalogText.match(/```json catalog\n([\s\S]*?)\n```/)[1]).contracts;
console.log(JSON.stringify({ node_version: process.versions.node, fixture_digest: fixtures.digest.slice(7),
  required_contracts: catalog.map(row => row.name), results }));
