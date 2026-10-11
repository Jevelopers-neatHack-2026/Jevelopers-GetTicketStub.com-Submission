import { financeV2Examples, exposure } from './finance-v2-cases.mjs';
import { fixtureReferences, requestReference } from './finance-fixture-seeds.mjs';

const clone = structuredClone;
export function bindFinanceExample(example) {
  if (example.context.request) {
    example.value.request_ref = requestReference(example.context.request);
    example.context.request_references = fixtureReferences(example.context.request);
  }
  example.context.references = fixtureReferences(example.value);
  return example;
}

export function queryFor(snapshot, context, seed) {
  const example = { value: clone(seed.value), context: clone(context) };
  example.value.reservation = clone(snapshot);
  example.context.prior = clone(snapshot);
  example.context.current_reservation = clone(snapshot);
  example.context.request = clone(seed.context.request);
  example.context.request.expected_revision = snapshot.revision;
  delete example.context.previous_command;
  delete example.context.previous_result;
  return bindFinanceExample(example);
}

export async function queryOutcomes() {
  const { seeds, scenarios } = await financeV2Examples();
  const examples = new Map();
  examples.set('granted', clone(seeds.QueryResult));
  examples.set('partially_granted', queryFor(scenarios.partialGrant.value.reservation, scenarios.partialGrant.context, seeds.QueryResult));
  examples.set('partially_consumed', queryFor(scenarios.partial.value.reservation, scenarios.partial.context, seeds.QueryResult));
  examples.set('consumed', queryFor(scenarios.finalRemainder.value.reservation, scenarios.finalRemainder.context, seeds.QueryResult));
  examples.set('released', queryFor(seeds.ReleaseResult.value.reservation, seeds.ReleaseResult.context, seeds.QueryResult));
  const expired = clone(examples.get('released'));
  expired.value.reservation.lifecycle = 'expired'; expired.context.now = '2026-10-10T14:00:00Z';
  expired.context.prior = clone(expired.value.reservation); expired.context.current_reservation = clone(expired.value.reservation);
  examples.set('expired', bindFinanceExample(expired));
  const hold = clone(seeds.QueryResult);
  hold.context.execution_state = hold.value.reservation.execution_state = 'uncertain';
  hold.context.usage_completeness = hold.value.reservation.usage_completeness = 'unknown';
  hold.context.dispatch_state = 'blocked';
  hold.value.reservation.lifecycle = 'uncertain_in_flight'; hold.value.reservation.dispatch_cap.amount = '0.000000';
  exposure(hold.value.reservation);
  hold.context.prior = clone(hold.value.reservation); hold.context.current_reservation = clone(hold.value.reservation);
  examples.set('held_for_reconciliation', bindFinanceExample(hold));
  for (const [disposition, example] of examples) { example.value.disposition = disposition; bindFinanceExample(example); }
  return examples;
}

export function unsafeTerminal(example, lifecycle, completeness) {
  const changed = clone(example);
  changed.value.lifecycle = lifecycle;
  changed.value.execution_state = changed.context.execution_state = 'finished';
  changed.value.usage_completeness = changed.context.usage_completeness = completeness;
  changed.value.resolution_ref = null;
  exposure(changed.value);
  changed.context.references = fixtureReferences(changed.value);
  return changed;
}
