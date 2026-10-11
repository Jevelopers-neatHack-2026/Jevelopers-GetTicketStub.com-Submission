import test from 'node:test';
import assert from 'node:assert/strict';
import { financeOriginCases } from './finance-origin-cases.mjs';
import { financeV2Examples } from './finance-v2-cases.mjs';
import { fixtureReferences } from './finance-fixture-seeds.mjs';
import { assertFixture } from '../tooling/fixture-harness.mjs';
const api = await import(process.env.FINANCE_DUPLICATE_API_URI ?? '../generated/index.mjs');
const clone = structuredClone;
for (const { id, example, expected } of await financeOriginCases()) test('FC-003 original command state ' + id, () => {
  // Given an independently supplied original prior and a separately bound cached outcome.
  const { value, context } = clone(example);
  assert.equal(api.validateContract(value.contract, value).ok, true);
  const fingerprint = api.hashManifest({ value, context });
  // When the result is checked through its public Finance and operation routes.
  const results = [api.checkFinanceResult(value, context), api.checkOperation(value.contract, value, context)];
  // Then both routes enforce origin legality without mutating any supplied facts.
  for (const result of results) assertFixture(result, expected);
  assert.equal(api.hashManifest({ value, context }), fingerprint);
});
const { seeds } = await financeV2Examples();
for (const family of ['SettleResult', 'ReleaseResult']) test('FC-003 standalone exact snapshot redelivery remains valid for ' + family, () => {
  const value = clone(seeds[family].value.reservation), context = clone(seeds[family].context);
  context.prior = clone(value); context.references = fixtureReferences(value);
  const result = api.checkFinanceReservation(value, context);
  assert.equal(result.ok, true);
});
