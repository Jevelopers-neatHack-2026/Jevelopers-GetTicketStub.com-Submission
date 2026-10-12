import test from 'node:test';
import assert from 'node:assert/strict';
import { financeDuplicateCases } from './finance-duplicate-cases.mjs';
import { assertFixture } from '../tooling/fixture-harness.mjs';
const api = await import(process.env.FINANCE_DUPLICATE_API_URI ?? '../generated/index.mjs');
for (const { id, example, expected } of await financeDuplicateCases()) test('FC-003/004 duplicate ' + id, () => {
  const { value, context } = structuredClone(example);
  // Wire-valid inputs and exact bound commands must still satisfy independent semantics.
  assert.equal(api.validateContract(value.contract, value).ok, true);
  const before = api.hashManifest({ value, context });
  assertFixture(api.checkFinanceResult(value, context), expected);
  assertFixture(api.checkOperation(value.contract, value, context), expected);
  assert.equal(api.hashManifest({ value, context }), before);
});
