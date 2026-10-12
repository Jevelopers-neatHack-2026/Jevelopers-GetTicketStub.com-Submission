import test from 'node:test';
import assert from 'node:assert/strict';
import { financeV2Examples } from './finance-v2-cases.mjs';
import { fixtureReferences } from './finance-fixture-seeds.mjs';
import { bindFinanceExample, queryFor, queryOutcomes, unsafeTerminal } from './finance-delta-cases.mjs';
import { assertFixture } from '../tooling/fixture-harness.mjs';
import { readJson } from '../scripts/generate.mjs';
import { checkOperation, checkFinanceReservation, checkFinanceResult, checkFinanceDispatch, hashManifest } from '../generated/index.mjs';

const outcomes = await queryOutcomes(), examples = await financeV2Examples();
const error = (await readJson('fixtures/ErrorEnvelope.json')).valid.error;
for (const [disposition, seed] of outcomes) {
  test('FC-003 query reports independently bound ' + disposition, () => {
    // Given the current reservation and exact command, when queried, then truthful disposition passes.
    assertFixture(checkFinanceResult(seed.value, seed.context), { ok: true });
  });
  for (const contradiction of [...outcomes.keys()].filter(key => key !== disposition)) {
    test('FC-003 query cannot report ' + contradiction + ' for ' + disposition, () => {
      // Given current economics, when only disposition changes, then the contradiction is rejected.
      const changed = structuredClone(seed); changed.value.disposition = contradiction;
      assert.equal(checkOperation('QueryResult', changed.value, changed.context).ok, false);
    });
  }
  test('FC-003 duplicate query binds the same current ' + disposition + ' snapshot', () => {
    const duplicate = structuredClone(seed);
    duplicate.context.previous_result = structuredClone(seed.value);
    duplicate.context.previous_command = structuredClone(seed.context.request);
    duplicate.value.disposition = 'duplicate';
    // When an exact query is redelivered, then its current snapshot is still bound.
    assertFixture(checkFinanceResult(duplicate.value, duplicate.context), { ok: true });
  });
}
test('FC-003 consumed disposition with the canonical held snapshot has a typed rejection', () => {
  const changed = structuredClone(examples.seeds.QueryResult); changed.value.disposition = 'consumed';
  assertFixture(checkFinanceResult(changed.value, changed.context), { ok: false, code: 'INVALID_RECEIPT', path: '/disposition' });
});
test('FC-003 query cannot replay a stale snapshot as duplicate', () => {
  const seed = outcomes.get('granted'), changed = structuredClone(seed);
  changed.context.previous_result = structuredClone(seed.value); changed.context.previous_command = structuredClone(seed.context.request);
  changed.value.disposition = 'duplicate'; changed.context.current_reservation.revision++;
  assertFixture(checkFinanceResult(changed.value, changed.context), { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/current_reservation' });
});
test('FC-003 duplicate cannot endorse a contradictory prior query disposition', () => {
  const seed = outcomes.get('granted'), changed = structuredClone(seed);
  changed.context.previous_result = structuredClone(seed.value); changed.context.previous_result.disposition = 'consumed';
  changed.context.previous_command = structuredClone(seed.context.request); changed.value.disposition = 'duplicate';
  assertFixture(checkFinanceResult(changed.value, changed.context), { ok: false, code: 'INVALID_RECEIPT', path: '/disposition' });
});
test('FC-003 duplicate query cannot override independently unknown current usage', () => {
  const changed = structuredClone(examples.seeds.QueryResult);
  changed.context.previous_result = structuredClone(changed.value); changed.context.previous_command = structuredClone(changed.context.request);
  changed.value.disposition = 'duplicate'; changed.context.usage_completeness = 'unknown';
  assertFixture(checkFinanceResult(changed.value, changed.context), { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/execution_state' });
});
test('FC-003 uncertain query preserves authenticated known partial consumption', () => {
  const partial = structuredClone(examples.scenarios.partial);
  partial.value.reservation.lifecycle = 'uncertain_in_flight'; partial.value.reservation.execution_state = partial.context.execution_state = 'uncertain';
  partial.value.reservation.usage_completeness = partial.context.usage_completeness = 'unknown';
  const changed = queryFor(partial.value.reservation, partial.context, examples.seeds.QueryResult);
  changed.value.disposition = 'held_for_reconciliation';
  assertFixture(checkFinanceResult(changed.value, changed.context), { ok: true });
});
for (const disposition of ['denied', 'unknown', 'unavailable']) for (const retained of [false, true]) test('query ' + disposition + ' preserves truthful ' + (retained ? 'retained snapshot' : 'missing snapshot') + ' reporting', () => {
  const changed = structuredClone(examples.seeds.QueryResult);
  changed.value.disposition = disposition; changed.value.error = disposition === 'unknown' ? null : structuredClone(error);
  if (!retained) changed.value.reservation = null;
  bindFinanceExample(changed);
  assertFixture(checkFinanceResult(changed.value, changed.context), { ok: true });
});
test('FC-004 a previous-result context cannot import unsafe finality into a healthy query', () => {
  const changed = structuredClone(examples.seeds.QueryResult);
  changed.context.previous_result = structuredClone(changed.value);
  changed.context.previous_result.reservation = unsafeTerminal({ value: examples.seeds.ReleaseResult.value.reservation, context: examples.seeds.ReleaseResult.context }, 'released', 'unknown').value;
  assertFixture(checkFinanceResult(changed.value, changed.context), { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/previous_result' });
});

for (const lifecycle of ['released', 'expired']) for (const completeness of ['incomplete', 'unknown']) {
  const released = { value: examples.seeds.ReleaseResult.value.reservation, context: examples.seeds.ReleaseResult.context };
  const unsafe = unsafeTerminal(released, lifecycle, completeness);
  delete unsafe.context.prior; unsafe.context.now = '2026-10-10T14:00:00Z';
  test('FC-004 direct ' + lifecycle + ' cannot erase ' + completeness + ' exposure', () => {
    // Given erased exposure without complete usage, when validated directly, then finality fails.
    assertFixture(checkFinanceReservation(unsafe.value, unsafe.context), { ok: false, code: 'UNKNOWN_USAGE', path: '/usage_completeness' });
  });
  for (const contract of ['ReserveResult', 'SettleResult', 'ReleaseResult', 'QueryResult']) {
    test('FC-004 ' + contract + ' cannot duplicate unsafe ' + lifecycle + '/' + completeness, () => {
      const seed = structuredClone(examples.seeds[contract]);
      seed.value.reservation = structuredClone(unsafe.value); seed.value.disposition = 'duplicate';
      seed.context.previous_result = structuredClone(seed.value); seed.context.previous_command = structuredClone(seed.context.request);
      seed.context.references = fixtureReferences(seed.value);
      // When any result route repeats an unsafe terminal snapshot, then it cannot gain validity.
      assert.equal(checkFinanceResult(seed.value, seed.context).ok, false);
    });
  }
}

test('GAP-002 cap acknowledgement preserves the hold but cannot dispatch a partial grant', () => {
  const partial = structuredClone(examples.scenarios.acknowledged);
  assertFixture(checkFinanceReservation(partial.value, partial.context), { ok: true });
  partial.context.requested_dispatch = { ...partial.value.held, amount: '0.000400' };
  // When cap-only partial dispatch is attempted, then the unsupported work-plan boundary is explicit.
  assertFixture(checkFinanceDispatch(partial.value, partial.context), { ok: false, code: 'UNSUPPORTED_CASE', path: '/decision' });
});
test('full bounded dispatch remains available', () => {
  const full = structuredClone(examples.seeds.BudgetReservation);
  full.context.requested_dispatch = structuredClone(full.value.held);
  assertFixture(checkFinanceDispatch(full.value, full.context), { ok: true });
});

for (const lifecycle of ['released', 'expired']) test('FC-004 independently fenced undispatched ' + lifecycle + ' remains valid', () => {
  const snapshot = structuredClone(examples.seeds.ReleaseResult.value.reservation);
  const context = structuredClone(examples.seeds.ReleaseResult.context);
  snapshot.lifecycle = lifecycle; snapshot.execution_state = context.execution_state = 'not_dispatched';
  snapshot.usage_completeness = context.usage_completeness = 'unknown'; context.now = '2026-10-10T14:00:00Z';
  context.prior.execution_state = 'uncertain'; context.prior.lifecycle = 'uncertain_in_flight'; context.prior.usage_completeness = 'unknown';
  snapshot.resolution_ref = { ...snapshot.authority_ref, contract: 'FinanceResolution' };
  context.resolution = { tenant_id: snapshot.tenant_id, project_id: snapshot.project_id, environment: snapshot.environment, billing_mode: snapshot.billing_mode,
    currency: context.currency, reservation_id: snapshot.reservation_id, billable_attempt_id: snapshot.billable_attempt_id, execution_state: 'not_dispatched', reference: snapshot.resolution_ref };
  context.references = fixtureReferences(snapshot);
  assertFixture(checkFinanceReservation(snapshot, context), { ok: true });
});
test('FC-004 undispatched release command requires the same financial fence when usage is unknown', () => {
  const changed = structuredClone(examples.seeds.ReleaseRequest);
  changed.context.usage_completeness = 'unknown'; changed.value.resolution_ref = null;
  changed.context.references = fixtureReferences(changed.value);
  assertFixture(checkOperation('ReleaseRequest', changed.value, changed.context), { ok: false, code: 'UNKNOWN_USAGE', path: '/usage_ref' });
});
for (const corruption of ['missing resolution', 'wrong reference', 'wrong scope', 'finished execution']) test('FC-004 rejects unfenced release with ' + corruption, () => {
  const snapshot = structuredClone(examples.seeds.ReleaseResult.value.reservation);
  const context = structuredClone(examples.seeds.ReleaseResult.context);
  snapshot.execution_state = context.execution_state = 'not_dispatched'; snapshot.usage_completeness = context.usage_completeness = 'unknown';
  snapshot.resolution_ref = { ...snapshot.authority_ref, contract: 'FinanceResolution' };
  context.resolution = { tenant_id: snapshot.tenant_id, project_id: snapshot.project_id, environment: snapshot.environment, billing_mode: snapshot.billing_mode,
    currency: context.currency, reservation_id: snapshot.reservation_id, billable_attempt_id: snapshot.billable_attempt_id, execution_state: 'not_dispatched', reference: structuredClone(snapshot.resolution_ref) };
  context.references = fixtureReferences(snapshot);
  if (corruption === 'missing resolution') delete context.resolution;
  if (corruption === 'wrong reference') context.resolution.reference.content_hash = hashManifest('wrong');
  if (corruption === 'wrong scope') context.resolution.billing_mode = 'live';
  if (corruption === 'finished execution') context.resolution.execution_state = snapshot.execution_state = context.execution_state = 'finished';
  assertFixture(checkFinanceReservation(snapshot, context), { ok: false, code: 'UNKNOWN_USAGE', path: '/usage_completeness' });
});
