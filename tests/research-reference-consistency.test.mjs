import test from 'node:test';
import assert from 'node:assert/strict';
import { checkResearchCreative, hashManifest } from '../generated/index.mjs';
import { researchReferenceCases } from './research-reference-cases.mjs';

for (const row of await researchReferenceCases()) test('research reference binding / ' + row.id, () => {
  const input = structuredClone(row.input);
  assert.equal(hashManifest(input), row.input_hash);
  if (input.context?.artifact_bytes) input.context.artifact_bytes = Object.fromEntries(Object.entries(input.context.artifact_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
  const before = structuredClone(input), result = checkResearchCreative(input.value.contract, input.value, input.context);
  assert.equal(result.ok, row.expected_ok, row.id + ': ' + JSON.stringify(result));
  if (!row.expected_ok) {
    assert.ok(result.errors.length > 0);
    for (const error of result.errors) {
      assert.equal(typeof error.code, 'string');
      assert.equal(typeof error.path, 'string');
      assert.ok(error.path === '' || error.path.startsWith('/'));
    }
    if (row.expected_error) assert.deepEqual(result.errors, [row.expected_error]);
  }
  assert.deepEqual(input, before);
});
