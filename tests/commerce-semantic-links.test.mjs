import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCommerceEvidence, validateContract } from '../generated/index.mjs';
import { assertFixture } from '../scripts/contracts.mjs';
import { commerceSemanticLinkCases } from './commerce-semantic-link-cases.mjs';

for (const row of await commerceSemanticLinkCases()) test('immutable commerce link / ' + row.id, () => {
  // Given an independent record, with lookup and payload digest rebound for the probe.
  const input = structuredClone(row.input), before = structuredClone(row.input);
  if (input.context.artifact_bytes) input.context.artifact_bytes = Object.fromEntries(Object.entries(input.context.artifact_bytes).map(([key, bytes]) => [key, Uint8Array.from(bytes)]));
  assert.equal(validateContract(input.value.contract, input.value).ok, !row.id.endsWith('/schema_version'));
  // When the public semantic boundary checks the actual cross-record relationship.
  const result = checkCommerceEvidence(input.value.contract, input.value, input.context);
  // Then the exact typed outcome holds and the caller's records remain unchanged.
  assertFixture(result, row.expected);
  if (input.context.artifact_bytes) input.context.artifact_bytes = Object.fromEntries(Object.entries(input.context.artifact_bytes).map(([key, bytes]) => [key, Array.from(bytes)]));
  assert.deepEqual(input, before);
});
