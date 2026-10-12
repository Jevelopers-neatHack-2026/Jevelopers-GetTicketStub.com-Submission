import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../tooling/production-operations.mjs';
import { hashManifest } from '../tooling/runtime.mjs';
import { productionIntegrityCases, runProductionIntegrityCase } from './production-integrity-cases.mjs';
import { readFile } from 'node:fs/promises';
const calibration = JSON.parse(await readFile(new URL('../fixtures/ProductionCalibration.json', import.meta.url), 'utf8'));
for (const context of [undefined, null, false, [], {}]) test('composition rejects malformed context ' + JSON.stringify(context), () => {
  assert.equal(api.checkComposition(calibration.composition, context).errors[0].code, 'INVALID_TRUST_CONTEXT');
});
test('production facts and composition return typed nesting rejection', () => {
  let nested = null;
  for (let i = 0; i < 3000; i++) nested = { next: nested };
  assert.equal(api.checkProductionFacts({ ...calibration.facts.package, extra: nested }, calibration.scope).errors[0].code, 'RESOURCE_LIMIT');
  assert.equal(api.checkComposition({ ...calibration.composition, extra: nested }, { scope: calibration.scope }).errors[0].code, 'RESOURCE_LIMIT');
});
for (const row of await productionIntegrityCases()) test(row.id, () => {
  const before = structuredClone(row.input);
  const result = runProductionIntegrityCase(api, row);
  assert.equal(result.ok, row.expected);
  assert.deepEqual(row.input, before);
  assert.equal(hashManifest(row.input), row.input_hash);
});
