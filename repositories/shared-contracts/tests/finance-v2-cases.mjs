import { financeSeeds, fixtureReferences, requestReference, observeConsumption } from './finance-fixture-seeds.mjs';
import { hashManifest } from '../tooling/runtime.mjs';

const clone = structuredClone;
const yes = { ok: true };
const no = (code, path) => ({ ok: false, code, path });
const id = number => '123e4567-e89b-42d3-a456-' + String(number).padStart(12, '0');
const amount = (example, value) => ({ ...clone(example), amount: value });
const ref = (example, contract, number) => ({ ...clone(example), contract, id: id(number), content_hash: 'sha256:' + String(number % 10).repeat(64) });
export function exposure(snapshot) {
  const scale = Math.max(snapshot.held.scale, snapshot.consumed.scale);
  const integer = money => { const [whole, fraction = ''] = money.amount.split('.'); return BigInt(whole + fraction.padEnd(scale, '0')); };
  const format = value => { const digits = value.toString().padStart(scale + 1, '0'); return scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits; };
  const difference = integer(snapshot.held) - integer(snapshot.consumed);
  const remaining = { currency: snapshot.held.currency, scale, amount: format(difference > 0n ? difference : 0n) };
  const overrun = { currency: snapshot.held.currency, scale, amount: format(difference < 0n ? -difference : 0n) };
  const zero = { ...remaining, amount: format(0n) };
  const final = ['consumed', 'released', 'expired'].includes(snapshot.lifecycle);
  snapshot.overrun = overrun; snapshot.retained_exposure = final ? clone(zero) : remaining; snapshot.released_capacity = final ? remaining : clone(zero);
  snapshot.unreported_exposure = final ? 'none' : 'unknown';
  if (final || difference < 0n) snapshot.dispatch_cap = clone(zero);
  return snapshot;
}
function bind(example) {
  example.context.references = fixtureReferences(example.value);
  if (example.context.request) {
    if (example.value.contract.endsWith('Result')) example.value.request_ref = requestReference(example.context.request);
    example.context.references = fixtureReferences(example.value);
    example.context.request_references = fixtureReferences(example.context.request);
  }
  return example;
}
export async function financeV2Examples() {
  const seeds = (await financeSeeds()).cases;
  const groups = Object.fromEntries(Object.keys(seeds).map(name => [name, []]));
  const add = (name, key, example, expected = yes, purpose = 'finance_protocol_regression') => {
    groups[name].push({ id: key, category: 'semantic', mode: 'semantic', policy_version: '1.0.0', context: clone(example.context), set: clone(example.value), expected: clone(expected), purpose });
  };
  for (const [name, seed] of Object.entries(seeds)) {
    add(name, 'semantic-positive-v2', seed);
    for (const key of ['environment', 'billing_mode']) {
      const changed = clone(seed); changed.value[key] = key === 'environment' ? 'production' : 'live';
      add(name, 'partition-' + key, changed, no('SCOPE_MISMATCH', '/' + key), 'FC-002');
      const missing = clone(seed); delete missing.context[key];
      add(name, 'missing-independent-' + key, missing, no('INVALID_TRUST_CONTEXT', ''), 'FC-002');
    }
    const scope = clone(seed); scope.value.project_id = id(999);
    add(name, 'forged-project', scope, no('SCOPE_MISMATCH', '/project_id'));
    const initial = clone(seed); initial.context.initial_request.billing_mode = 'live';
    add(name, 'wrong-initial-partition', initial, no('INVALID_TRUST_CONTEXT', '/initial_request'), 'FC-002');
    if (seed.context.prior) {
      for (const key of ['environment', 'billing_mode']) { const changed = clone(seed); changed.context.prior[key] = key === 'environment' ? 'production' : 'live'; add(name, 'prior-' + key, changed, no('INVALID_TRUST_CONTEXT', '/prior'), 'FC-002'); }
    }
  }
  for (const name of ['ReserveResult', 'SettleResult', 'ReleaseResult', 'QueryResult']) {
    const seed = clone(seeds[name]); seed.value.reservation.billing_mode = 'live';
    add(name, 'nested-partition', seed, no('SCOPE_MISMATCH', '/billing_mode'), 'FC-002');
    for (const disposition of ['denied', 'unknown', 'unavailable']) {
      const failed = clone(seeds[name]); failed.value.disposition = disposition; failed.value.reservation = null;
      failed.value.error = null;
      if (disposition !== 'unknown') {
        const fs = await import('node:fs/promises'); const errors = JSON.parse(await fs.readFile(new URL('../fixtures/ErrorEnvelope.json', import.meta.url), 'utf8'));
        failed.value.error = clone(errors.valid.error);
      }
      add(name, 'failure-' + disposition, failed);
      const wrong = clone(failed); wrong.context.request.billing_mode = 'live'; bind(wrong);
      add(name, 'failure-request-partition-' + disposition, wrong, no('INVALID_TRUST_CONTEXT', '/request'), 'FC-002');
      if (wrong.context.prior) {
        const priorWrong = clone(failed); priorWrong.context.prior.environment = 'production';
        add(name, 'failure-prior-partition-' + disposition, priorWrong, no('INVALID_TRUST_CONTEXT', '/prior'), 'FC-002');
      }
    }
  }
  const nestedFalse = clone(seeds.SettleResult); nestedFalse.value.reservation.consumed = amount(nestedFalse.value.reservation.consumed, '0.000000'); exposure(nestedFalse.value.reservation);
  add('SettleResult', 'result-consumption-contradiction', nestedFalse, no('INVALID_TRUST_CONTEXT', '/consumption_observation'), 'FC-003');
  const heldFalse = clone(seeds.ReserveResult); heldFalse.value.reservation.held = amount(heldFalse.value.reservation.held, '100.00');
  add('ReserveResult', 'result-capacity-contradiction', heldFalse, no('INVALID_TRUST_CONTEXT', '/authorized_capacity'), 'FC-003');
  const oversized = clone(heldFalse); oversized.context.authorized_capacity = clone(oversized.value.reservation.held);
  add('ReserveResult', 'even-authority-cannot-relabel-excess-as-full', oversized, no('INVALID_MONEY', '/held'), 'FC-003');
  const unrequestedSmall = clone(seeds.ReserveResult); unrequestedSmall.value.reservation.held = amount(unrequestedSmall.value.reservation.held, '0.000500'); unrequestedSmall.context.authorized_capacity = clone(unrequestedSmall.value.reservation.held); exposure(unrequestedSmall.value.reservation);
  add('ReserveResult', 'silent-smaller-full-grant', unrequestedSmall, no('INVALID_MONEY', '/held'), 'FC-003');

  function monetary(initialAmount, actualAmount, intent = 'final') {
    const example = clone(seeds.SettleResult), request = example.context.request, snapshot = example.value.reservation;
    example.context.initial_request.requested = amount(example.context.initial_request.requested, initialAmount);
    example.context.authorized_capacity = clone(example.context.initial_request.requested);
    for (const item of [example.context.prior, snapshot]) {
      item.held = clone(example.context.authorized_capacity); item.requested_capacity = clone(example.context.authorized_capacity);
      item.grant_request_ref = requestReference(example.context.initial_request);
    }
    example.context.prior.dispatch_cap = clone(example.context.authorized_capacity); exposure(example.context.prior);
    request.consumed = amount(request.consumed, actualAmount); request.settlement_intent = intent;
    snapshot.consumed = clone(request.consumed); snapshot.settlement_intent = intent;
    snapshot.lifecycle = intent === 'final' ? 'consumed' : 'held'; snapshot.settlement_ref = intent === 'final' ? snapshot.settlement_ref : null;
    snapshot.dispatch_cap = intent === 'final' ? amount(snapshot.held, '0.000000') : clone(snapshot.held);
    snapshot.consumption_evidence_ref = clone(request.usage_ref);
    exposure(snapshot);
    if (BigInt(snapshot.overrun.amount.replace('.', '')) > 0n) request.exception_refs = [ref(request.usage_ref, 'FinanceException', 810)];
    snapshot.exception_refs = clone(request.exception_refs);
    exposure(snapshot);
    example.context.consumption_observation = observeConsumption(snapshot, request, example.context.now);
    return bind(example);
  }
  const overrun = monetary('1.00', '1.10');
  add('SettleResult', 'authentic-overrun-result', overrun, yes, 'FC-001');
  add('SettleRequest', 'authentic-overrun-command', { value: clone(overrun.context.request), context: { ...clone(overrun.context), references: clone(overrun.context.request_references) } }, yes, 'FC-001');
  add('BudgetReservation', 'authentic-overrun-snapshot', { value: clone(overrun.value.reservation), context: { ...clone(overrun.context), references: fixtureReferences(overrun.value.reservation) } }, yes, 'FC-001');
  const missingException = clone(overrun); missingException.context.request.exception_refs = []; missingException.value.reservation.exception_refs = []; missingException.context.consumption_observation.exception_refs = []; bind(missingException);
  add('SettleResult', 'overrun-needs-linked-exception', missingException, no('INVALID_PAYLOAD', '/exception_refs'), 'FC-001');
  const finalRemainder = monetary('1.00', '0.60');
  add('SettleResult', 'final-consume-0_60-release-0_40', finalRemainder);
  const prematureRelease = clone(finalRemainder); prematureRelease.value.reservation.released_capacity.amount = '0.41';
  add('SettleResult', 'forged-released-remainder', prematureRelease, no('INVALID_MONEY', '/retained_exposure'));
  const partial = monetary('1.00', '0.60', 'partial'); partial.value.disposition = 'partially_consumed';
  partial.context.execution_state = 'in_flight'; partial.context.usage_completeness = 'incomplete'; partial.context.prior.execution_state = 'in_flight'; partial.context.prior.usage_completeness = 'incomplete';
  partial.value.reservation.execution_state = 'in_flight'; partial.value.reservation.usage_completeness = 'incomplete';
  add('SettleResult', 'partial-consumption-retains-incomplete-exposure', partial);
  for (const completeness of ['incomplete', 'unknown']) {
    const partialHold = clone(partial);
    partialHold.context.prior = clone(partial.value.reservation);
    partialHold.context.prior.execution_state = 'uncertain'; partialHold.context.prior.lifecycle = 'uncertain_in_flight';
    partialHold.context.prior.usage_completeness = completeness;
    partialHold.context.execution_state = 'uncertain'; partialHold.context.usage_completeness = completeness;
    partialHold.context.prior_observation = clone(partial.context.consumption_observation);
    partialHold.context.request.settlement_intent = 'final'; partialHold.context.request.expected_revision = partialHold.context.prior.revision;
    partialHold.context.request.request_id = id(815); partialHold.context.request.idempotency_key = 'final_after_partial_hold';
    partialHold.value.request_id = partialHold.context.request.request_id; partialHold.value.idempotency_key = partialHold.context.request.idempotency_key;
    partialHold.value.disposition = 'held_for_reconciliation'; partialHold.value.reservation = clone(partialHold.context.prior);
    partialHold.value.reservation.revision++; partialHold.value.reservation.event_id = id(816);
    bind(partialHold);
    add('SettleResult', 'partial-known-cost-held-' + completeness, partialHold, yes, 'FC-004');
  }
  const claimedFinal = clone(partial); claimedFinal.context.request.settlement_intent = 'final'; claimedFinal.value.disposition = 'consumed'; claimedFinal.value.reservation.settlement_intent = 'final'; claimedFinal.value.reservation.lifecycle = 'consumed'; claimedFinal.value.reservation.settlement_ref = clone(seeds.SettleResult.value.reservation.settlement_ref); exposure(claimedFinal.value.reservation); bind(claimedFinal);
  add('SettleResult', 'in-flight-final-forbidden', claimedFinal, no('UNCERTAIN_EXECUTION', '/settlement_intent'));
  const unknownFinal = clone(finalRemainder); unknownFinal.context.usage_completeness = 'unknown';
  add('SettleResult', 'unknown-usage-final-forbidden', unknownFinal, no('UNKNOWN_USAGE', '/usage_ref'));

  for (const name of ['SettleResult', 'ReleaseResult']) for (const completeness of ['complete', 'incomplete', 'unknown']) {
    const hold = clone(seeds[name]);
    hold.context.execution_state = 'uncertain'; hold.context.usage_completeness = completeness;
    hold.context.prior.execution_state = 'uncertain'; hold.context.prior.usage_completeness = completeness; hold.context.prior.lifecycle = 'uncertain_in_flight';
    hold.value.disposition = 'held_for_reconciliation'; hold.value.reservation = clone(hold.context.prior); hold.value.reservation.revision++; hold.value.reservation.event_id = id(name === 'SettleResult' ? 820 : 821);
    bind(hold);
    add(name, 'retained-hold-' + completeness, hold, yes, 'FC-004');
    const unsafe = { value: clone(hold.context.request), context: { ...clone(hold.context), references: clone(hold.context.request_references) } };
    add(name.replace('Result', 'Request'), 'unsafe-transition-' + completeness, unsafe, no('UNCERTAIN_EXECUTION', name === 'SettleResult' ? '/settlement_intent' : '/reason'), 'FC-004');
    const vanished = clone(hold); vanished.value.reservation.retained_exposure.amount = '0.000000';
    add(name, 'retained-hold-cannot-release-' + completeness, vanished, no('INVALID_RECEIPT', '/reservation'), 'FC-004');
  }

  const partialGrant = clone(seeds.ReserveResult), pg = partialGrant.value.reservation;
  partialGrant.value.disposition = 'partially_granted'; pg.decision = 'partially_granted';
  partialGrant.context.request.partial_grant = 'allow_with_acknowledgement'; partialGrant.context.initial_request = clone(partialGrant.context.request);
  pg.grant_request_ref = requestReference(partialGrant.context.initial_request); pg.held = amount(pg.held, '0.000500'); pg.dispatch_cap = amount(pg.held, '0.000000');
  partialGrant.context.grant_decision = 'partially_granted'; partialGrant.context.authorized_capacity = clone(pg.held); exposure(pg); bind(partialGrant);
  add('ReserveResult', 'explicit-partial-cap-no-dispatch-before-ack', partialGrant, yes, 'FC-003');
  const noOptIn = clone(partialGrant); noOptIn.context.request.partial_grant = 'forbid'; noOptIn.context.initial_request = clone(noOptIn.context.request); noOptIn.value.reservation.grant_request_ref = requestReference(noOptIn.context.initial_request); bind(noOptIn);
  add('ReserveResult', 'partial-without-opt-in', noOptIn, no('INVALID_TRANSITION', '/decision'), 'FC-003');
  const noAckCap = clone(partialGrant); noAckCap.value.reservation.dispatch_cap = clone(pg.held);
  add('ReserveResult', 'partial-cap-cannot-imply-acknowledgement', noAckCap, no('INVALID_MONEY', '/dispatch_cap'), 'FC-003');
  const acknowledged = { value: clone(pg), context: clone(partialGrant.context) };
  acknowledged.context.prior = clone(pg); acknowledged.value.revision++; acknowledged.value.event_id = id(830);
  acknowledged.value.dispatch_acknowledgement_ref = ref(pg.authority_ref, 'DispatchAcknowledgement', 831); acknowledged.value.dispatch_cap = clone(pg.held);
  acknowledged.context.dispatch_acknowledgement = { tenant_id: pg.tenant_id, project_id: pg.project_id, environment: pg.environment, billing_mode: pg.billing_mode, reservation_id: pg.reservation_id, grant_revision: pg.grant_revision, grant_request_ref: clone(pg.grant_request_ref), cap: clone(pg.held), reference: clone(acknowledged.value.dispatch_acknowledgement_ref), status: 'valid', checked_at: acknowledged.context.now, expires_at: pg.expires_at };
  bind(acknowledged);
  add('BudgetReservation', 'partial-acknowledgement-exact-grant', acknowledged);
  const revoked = clone(acknowledged); revoked.context.dispatch_acknowledgement.status = 'revoked';
  add('BudgetReservation', 'revoked-partial-acknowledgement', revoked, no('INVALID_MONEY', '/dispatch_cap'));
  const changedCap = clone(acknowledged); changedCap.context.dispatch_acknowledgement.cap.amount = '1.00';
  add('BudgetReservation', 'acknowledgement-wrong-cap', changedCap, no('INVALID_TRUST_CONTEXT', '/dispatch_acknowledgement'));

  const late = monetary('1.00', '0.70'); late.context.prior = clone(finalRemainder.value.reservation); late.context.request.expected_revision = late.context.prior.revision;
  late.context.request.consumption_kind = 'late_charge'; late.context.request.correction_ref = ref(late.context.request.usage_ref, 'ConsumptionCorrection', 840);
  late.context.request.usage_ref = ref(late.context.request.usage_ref, 'UsageEvent', 841);
  Object.assign(late.value.reservation, { revision: late.context.prior.revision + 1, event_id: id(842), consumption_kind: 'late_charge', correction_ref: clone(late.context.request.correction_ref), consumption_evidence_ref: clone(late.context.request.usage_ref) });
  late.context.consumption_observation = observeConsumption(late.value.reservation, late.context.request, late.context.now); bind(late);
  add('SettleResult', 'late-charge-append-only-after-final', late);
  const correction = clone(late); correction.context.request.consumed.amount = '0.50'; correction.context.request.consumption_kind = 'correction';
  correction.value.reservation.consumed = clone(correction.context.request.consumed); correction.value.reservation.consumption_kind = 'correction'; exposure(correction.value.reservation);
  correction.context.consumption_observation = observeConsumption(correction.value.reservation, correction.context.request, correction.context.now);
  correction.context.correction_authority = { tenant_id: correction.context.prior.tenant_id, project_id: correction.context.prior.project_id, environment: correction.context.prior.environment, billing_mode: correction.context.prior.billing_mode, currency: correction.context.currency, reservation_id: correction.context.prior.reservation_id, billable_attempt_id: correction.context.prior.billable_attempt_id, expected_revision: correction.context.prior.revision, from: clone(correction.context.prior.consumed), to: clone(correction.context.request.consumed), reference: clone(correction.context.request.correction_ref), prior_reservation_ref: { contract: 'BudgetReservation', schema_version: '2.0.0', id: correction.context.prior.reservation_id, revision: correction.context.prior.revision, content_hash: hashManifest(correction.context.prior) }, status: 'authorized', checked_at: correction.context.now };
  bind(correction);
  add('SettleResult', 'authorized-append-only-credit-correction', correction);
  const unauthorizedDecrease = clone(correction); delete unauthorizedDecrease.context.correction_authority;
  add('SettleResult', 'decrease-without-separate-correction-authority', unauthorizedDecrease, no('INVALID_TRUST_CONTEXT', '/request'));
  const wrongCorrection = clone(correction); wrongCorrection.context.correction_authority.prior_reservation_ref.content_hash = 'sha256:' + '9'.repeat(64);
  add('SettleResult', 'correction-wrong-prior-bytes', wrongCorrection, no('INVALID_TRUST_CONTEXT', '/request'));
  const reused = clone(late); reused.value.reservation.revision = reused.context.prior.revision;
  add('SettleResult', 'cumulative-revision-reuse', reused, no('REVISION_CONFLICT', '/revision'));
  const reusedEvidence = clone(late); reusedEvidence.context.request.usage_ref = clone(reusedEvidence.context.prior.consumption_evidence_ref); reusedEvidence.value.reservation.consumption_evidence_ref = clone(reusedEvidence.context.request.usage_ref); reusedEvidence.context.consumption_observation.reference = clone(reusedEvidence.context.request.usage_ref); bind(reusedEvidence);
  add('SettleResult', 'changed-amount-reuses-observation', reusedEvidence, no('IDENTITY_COLLISION', '/consumption_evidence_ref'));

  for (const basis of ['unknown', 'unbounded']) {
    const request = clone(seeds.ReserveRequest); request.value.pricing_basis = basis; request.value.requested = null; request.context.initial_request = clone(request.value);
    add('ReserveRequest', 'pricing-cannot-auto-authorize-' + basis, request, no('UNKNOWN_USAGE', '/pricing_basis'));
    const denied = clone(seeds.ReserveResult); denied.context.request = clone(request.value); denied.context.initial_request = clone(request.value); denied.value.disposition = 'unknown'; denied.value.reservation = null; bind(denied);
    add('ReserveResult', 'pricing-typed-unknown-' + basis, denied);
  }
  const unknownPrior = clone(seeds.QueryResult); unknownPrior.value.disposition = 'unknown'; unknownPrior.value.reservation = null; unknownPrior.context.prior.billing_mode = 'live';
  add('QueryResult', 'unknown-response-binds-prior-partition', unknownPrior, no('INVALID_TRUST_CONTEXT', '/prior'), 'FC-002');
  const stalePrevious = clone(seeds.SettleRequest); stalePrevious.context.previous_command = clone(seeds.SettleRequest.value); stalePrevious.context.previous_command.environment = 'production';
  add('SettleRequest', 'previous-command-partition', stalePrevious, no('INVALID_TRUST_CONTEXT', '/previous_command'), 'FC-002');
  const previousResult = clone(seeds.QueryResult); previousResult.context.previous_result = clone(seeds.QueryResult.value); previousResult.context.previous_result.billing_mode = 'live';
  add('QueryResult', 'previous-result-partition', previousResult, no('INVALID_TRUST_CONTEXT', '/previous_result'), 'FC-002');
  return { seeds, groups, scenarios: { overrun, finalRemainder, partial, partialGrant, acknowledged, late, correction } };
}
