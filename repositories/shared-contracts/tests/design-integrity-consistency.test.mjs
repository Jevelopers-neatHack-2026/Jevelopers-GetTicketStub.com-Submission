import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCommerceEvidence, checkArtifactHandoffManifest, checkArtifactConsumptionReceipt, validateContract, hashManifest, researchContentHash } from '../generated/index.mjs';
import { designIntegrityCases } from './design-integrity-cases.mjs';

for (const row of await designIntegrityCases()) test('supplied immutable design integrity / ' + row.id, () => {
  const input = structuredClone(row.input);
  assert.equal(hashManifest(input), row.input_hash);
  if (row.expected_design_wire !== undefined) assert.equal(validateContract('DesignVersion', input.context.design).ok, row.expected_design_wire, row.id);
  if (row.body_path) assert.notEqual(input.context.design.design_hash, researchContentHash(input.context.design, 'design_hash'), row.body_path);
  if (row.expected_same_digest) assert.equal(input.context.design.design_hash, researchContentHash(input.context.design, 'design_hash'));
  if (input.context.artifact_bytes) input.context.artifact_bytes = Object.fromEntries(Object.entries(input.context.artifact_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
  const before = structuredClone(input);
  const result = checkCommerceEvidence(input.value.contract, input.value, input.context);
  assert.equal(result.ok, row.expected_ok, row.id + ': ' + JSON.stringify(result));
  if (!row.expected_ok) {
    assert.ok(result.errors.length > 0);
    for (const error of result.errors) { assert.equal(typeof error.code, 'string'); assert.equal(typeof error.path, 'string'); assert.ok(error.path === '' || error.path.startsWith('/')); }
    if (row.expected_error) assert.deepEqual(result.errors, [row.expected_error]);
  }
  const narrow = input.value.contract === 'ArtifactHandoffManifest' ? checkArtifactHandoffManifest : input.value.contract === 'ArtifactConsumptionReceipt' ? checkArtifactConsumptionReceipt : null;
  if (narrow) assert.deepEqual(narrow(input.value, input.context), result);
  assert.deepEqual(input, before);
});
