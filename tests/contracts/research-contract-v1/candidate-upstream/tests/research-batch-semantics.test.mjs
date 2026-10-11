import test from 'node:test';
import assert from 'node:assert/strict';
import { checkResearchBatchReceipt, validateContract } from '../generated/index.mjs';
import { assertFixture } from '../scripts/contracts.mjs';
import { researchBatchCases } from './research-batch-cases.mjs';

for (const row of await researchBatchCases()) test('research admission and outcome / ' + row.id, () => {
  // Given exact receipt hashes and independently identified batch members.
  const input = structuredClone(row.input), before = structuredClone(input);
  assert.equal(validateContract(input.value.contract, input.value).ok, !row.id.endsWith('/schema_version'));
  // When the public batch helper reconciles admission with the outcome partition.
  const result = checkResearchBatchReceipt(input.value, input.context);
  // Then the permitted outcome or exact typed refusal holds without input mutation.
  assertFixture(result, row.expected);
  assert.deepEqual(input, before);
});
