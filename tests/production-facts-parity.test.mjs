import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as api from '../generated/index.mjs';
import * as production from '../tooling/production-operations.mjs';
import { factsReferenceSlots, productionFactsParityCases, runProductionFactsParityCase } from './production-facts-parity-cases.mjs';
test('facts parity ledger covers every VersionedReference slot in the established schema', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/EventIntelligencePackage/1.0.0.json', import.meta.url), 'utf8'));
  const paths = [];
  function walk(node, path) {
    if (node.$ref?.endsWith('#/$defs/VersionedReference')) paths.push(path);
    else if (node.$ref?.startsWith(schema.$id + '#/$defs/')) walk(schema.$defs[node.$ref.split('/').at(-1)], path);
    if (node.properties) for (const [key, child] of Object.entries(node.properties)) walk(child, path ? path + '/' + key : key);
    if (node.items) walk(node.items, path + '/*');
    for (const branch of node.anyOf ?? []) walk(branch, path);
  }
  walk({ properties: schema.properties }, '');
  assert.deepEqual(paths.sort(), factsReferenceSlots.map(([path]) => path).sort());
});
for (const row of await productionFactsParityCases()) test(row.id, () => {
  const before = structuredClone(row.input);
  const results = runProductionFactsParityCase(api, production, row);
  for (const [route, expected] of Object.entries(row.expected)) assert.equal(results[route].ok, expected, route + ': ' + JSON.stringify(results[route]));
  for (const route of ['facts', 'integrity']) if (!row.expected[route]) {
    assert.equal(typeof results[route].errors[0].code, 'string');
    if (row.path) assert.ok(results[route].errors[0].path.startsWith(row.path), route + ': ' + JSON.stringify(results[route]));
  }
  if (!row.expected.composition) assert.equal(results.eligibility.errors[0].code, 'FACTS_UNSUPPORTED');
  assert.deepEqual(row.input, before);
  assert.equal(api.hashManifest(row.input), row.input_hash);
});
