import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const evidence = process.argv[2];
const receipts = [];
const observations = new Map();
for (const [lane, expected] of [['old', [76, 86, 1641]], ['new', [77, 88, 1673]]]) {
  for (const surface of ['source', 'installed']) {
    for (const scope of ['candidate', 'full']) {
      const directory = join(evidence, lane, `${surface}-${scope}`);
      const names = readdirSync(directory).filter(name => name.startsWith('contracts-'));
      assert.equal(names.length, 1, 'Use a fresh evidence directory for each run');
      const path = join(directory, names[0], 'contracts.json');
      const receipt = JSON.parse(readFileSync(path, 'utf8'));
      assert.equal(receipt.execution, 'passed');
      assert.equal(receipt.product_acceptance, 'blocked');
      assert.equal(receipt.owner_acknowledgement, null);
      assert.deepEqual(receipt.missing_contracts, []);
      assert.equal(receipt.candidate_scope, scope === 'candidate');
      assert.equal(receipt.execution_surface, surface === 'source' ? 'source' : 'installed-package');
      const observation = receipt.observation;
      const counts = [observation.required_contracts.length, observation.results.length,
        observation.results.reduce((sum, row) => sum + row.cases.length, 0)];
      assert.deepEqual(counts, expected);
      assert.ok(observation.results.every(row => row.failures.length === 0));
      if (observations.has(lane)) assert.deepEqual(observation, observations.get(lane));
      observations.set(lane, observation);
      receipts.push({ lane, surface, scope, path, counts, passed: true });
    }
  }
}
const historical = observation => observation.results.filter(row => row.semantic_records.length);
const oldHistorical = historical(observations.get('old'));
assert.equal(oldHistorical.length, 9);
assert.deepEqual(historical(observations.get('new')), oldHistorical);
console.log(JSON.stringify({ receipts, historical_rows_preserved: 9,
  product_acceptance: 'blocked', owner_acknowledgement: null }, null, 2));
