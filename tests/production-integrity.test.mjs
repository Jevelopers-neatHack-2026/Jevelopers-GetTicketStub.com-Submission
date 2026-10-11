import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../tooling/production-operations.mjs';
import { hashManifest } from '../tooling/runtime.mjs';
import { productionIntegrityCases, runProductionIntegrityCase } from './production-integrity-cases.mjs';
for (const row of await productionIntegrityCases()) test(row.id, () => {
  const before = structuredClone(row.input);
  const result = runProductionIntegrityCase(api, row);
  assert.equal(result.ok, row.expected);
  assert.deepEqual(row.input, before);
  assert.equal(hashManifest(row.input), row.input_hash);
});
