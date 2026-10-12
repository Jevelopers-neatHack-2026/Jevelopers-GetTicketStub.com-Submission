import { financeV2Examples, exposure } from './finance-v2-cases.mjs';
import { fixtureReferences, requestReference } from './finance-fixture-seeds.mjs';
import { queryOutcomes } from './finance-delta-cases.mjs';

const clone = structuredClone;
const yes = { ok: true };
const no = (code, path) => ({ ok: false, code, path });
function duplicate(seed) {
  const example = clone(seed);
  if (example.context.prior) example.context.command_prior = clone(example.context.prior);
  example.context.previous_command = clone(example.context.request);
  example.context.previous_result = clone(example.value);
  example.value.disposition = 'duplicate';
  return example;
}
function bind(example) {
  example.context.previous_command = clone(example.context.request);
  example.value.request_ref = requestReference(example.context.request);
  example.context.previous_result.request_ref = clone(example.value.request_ref);
  example.context.previous_result.reservation = clone(example.value.reservation);
  example.context.references = fixtureReferences(example.value);
  example.context.request_references = fixtureReferences(example.context.request);
  return example;
}
function fenced(seed, lifecycle, usage) {
  const example = clone(seed), snapshot = example.value.reservation;
  example.value.disposition = lifecycle;
  snapshot.lifecycle = lifecycle;
  snapshot.execution_state = example.context.execution_state = 'not_dispatched';
  snapshot.usage_completeness = example.context.usage_completeness = usage;
  example.context.now = '2026-10-10T14:00:00Z';
  example.context.request.reason = lifecycle === 'expired' ? 'expired' : 'cancelled';
  example.context.prior.execution_state = 'uncertain';
  example.context.prior.lifecycle = 'uncertain_in_flight';
  example.context.prior.usage_completeness = usage;
  snapshot.resolution_ref = { ...snapshot.authority_ref, contract: 'FinanceResolution' };
  example.context.request.resolution_ref = clone(snapshot.resolution_ref);
  example.context.resolution = { tenant_id: snapshot.tenant_id, project_id: snapshot.project_id,
    environment: snapshot.environment, billing_mode: snapshot.billing_mode, currency: example.context.currency,
    reservation_id: snapshot.reservation_id, billable_attempt_id: snapshot.billable_attempt_id,
    execution_state: 'not_dispatched', reference: clone(snapshot.resolution_ref) };
  return bind(duplicate(example));
}
export async function financeDuplicateCases() {
  const { seeds, scenarios, groups } = await financeV2Examples();
  const cases = [], positives = new Map();
  const add = (id, example, expected = yes) => cases.push({ id, example: clone(example), expected });
  for (const name of ['ReserveResult', 'SettleResult', 'ReleaseResult', 'QueryResult']) positives.set(name, duplicate(seeds[name]));
  for (const name of ['partial', 'finalRemainder', 'overrun', 'late', 'correction', 'partialGrant']) positives.set(name, duplicate(scenarios[name]));
  for (const [name, seed] of await queryOutcomes()) positives.set('query-' + name, duplicate(seed));
  for (const name of ['SettleResult', 'ReleaseResult']) for (const row of groups[name].filter(row => row.expected.ok && /^(retained-hold-|partial-known-cost-held-)/.test(row.id))) {
    positives.set(name + '/' + row.id, duplicate({ value: row.set, context: row.context }));
  }
  for (const lifecycle of ['released', 'expired']) for (const usage of ['unknown', 'incomplete', 'complete']) positives.set('fenced-' + lifecycle + '-' + usage, fenced(seeds.ReleaseResult, lifecycle, usage));
  for (const [name, seed] of positives) {
    add('authentic/' + name, seed);
    const advanced = clone(seed);
    advanced.context.prior = clone(seed.value.reservation);
    advanced.context.prior.revision += 4;
    advanced.context.prior.event_id = '123e4567-e89b-42d3-a456-000000000999';
    add('already-advanced/' + name, advanced);
    for (const state of ['not_dispatched', 'in_flight', 'finished', 'uncertain'].filter(state => state !== seed.context.execution_state)) {
      const changed = clone(seed); changed.context.execution_state = state;
      // A fence-dependent snapshot may fail earlier at the contextual boundary.
      const fence = name.startsWith('fenced-') && seed.context.usage_completeness !== 'complete';
      const hold = seed.context.previous_result.disposition === 'held_for_reconciliation' &&
        seed.value.contract !== 'QueryResult' && seed.context.usage_completeness === 'complete' && ['not_dispatched', 'finished'].includes(state);
      add('execution-contradiction/' + name + '/' + state, changed,
        hold ? no('INVALID_RECEIPT', '/reservation') : no('INVALID_TRUST_CONTEXT', fence ? '/previous_result' : '/execution_state'));
    }
    for (const usage of ['unknown', 'incomplete', 'complete'].filter(usage => usage !== seed.context.usage_completeness)) {
      const changed = clone(seed); changed.context.usage_completeness = usage;
      add('usage-contradiction/' + name + '/' + usage, changed, no('INVALID_TRUST_CONTEXT', '/execution_state'));
    }
  }
  for (const name of ['SettleResult', 'partial', 'finalRemainder', 'overrun']) {
    const seed = positives.get(name);
    for (const mutation of ['amount', 'intent', 'usage-reference', 'kind', 'exception-reference']) {
      const changed = clone(seed), command = changed.context.request;
      if (mutation === 'amount') command.consumed.amount = '0.000002';
      if (mutation === 'intent') command.settlement_intent = command.settlement_intent === 'final' ? 'partial' : 'final';
      if (mutation === 'usage-reference') command.usage_ref.content_hash = 'sha256:' + '9'.repeat(64);
      if (mutation === 'kind') { command.consumption_kind = 'late_charge'; command.correction_ref = { ...command.usage_ref, contract: 'ConsumptionCorrection' }; }
      if (mutation === 'exception-reference') command.exception_refs = [{ ...command.usage_ref, contract: 'FinanceException', content_hash: 'sha256:' + '8'.repeat(64) }];
      add('command-economics/' + name + '/' + mutation, bind(changed), no('INVALID_MONEY', '/reservation/consumed'));
    }
    for (const field of ['consumed', 'reference', 'consumption_kind', 'correction_ref', 'exception_refs']) {
      const changed = clone(seed), observed = changed.context.consumption_observation;
      if (field === 'consumed') observed.consumed.amount = '0.000002';
      if (field === 'reference') observed.reference.content_hash = 'sha256:' + '9'.repeat(64);
      if (field === 'consumption_kind') observed.consumption_kind = 'late_charge';
      if (field === 'correction_ref') observed.correction_ref = clone(observed.reference);
      if (field === 'exception_refs') observed.exception_refs = [{ ...observed.reference, contract: 'FinanceException' }];
      add('independent-evidence/' + name + '/' + field, changed, no('INVALID_TRUST_CONTEXT', '/consumption_observation'));
    }
    const missing = clone(seed); delete missing.context.consumption_observation;
    add('independent-evidence/' + name + '/missing', missing, no('INVALID_TRUST_CONTEXT', '/consumption_observation'));
  }
  for (const name of ['ReserveResult', 'partialGrant', 'SettleResult', 'partial', 'ReleaseResult', 'QueryResult']) {
    const changed = clone(positives.get(name));
    changed.context.previous_result.disposition = name === 'ReserveResult' ? 'partially_granted' : name === 'partialGrant' ? 'granted' :
      name === 'SettleResult' ? 'partially_consumed' : name === 'partial' ? 'consumed' : 'expired';
    add('cached-disposition/' + name, changed, no(name === 'SettleResult' || name === 'partial' ? 'INVALID_MONEY' : 'INVALID_RECEIPT',
      name === 'SettleResult' || name === 'partial' ? '/reservation/consumed' : name === 'ReleaseResult' ? '/reservation' : '/disposition'));
    for (const disposition of ['duplicate', 'unknown']) {
      const nested = clone(positives.get(name)); nested.context.previous_result.disposition = disposition;
      add('unproven-cached-outcome/' + name + '/' + disposition, nested, no('INVALID_RECEIPT', '/reservation'));
    }
  }
  const release = clone(positives.get('ReleaseResult'));
  release.context.request.reason = 'expired';
  add('release-intent/reason', bind(release), no('INVALID_RECEIPT', '/reservation'));
  const grant = clone(positives.get('ReserveResult'));
  grant.context.request.requested.amount = '0.000002';
  grant.context.initial_request = clone(grant.context.request);
  add('reserve-amount/requested', bind(grant), no('INVALID_TRUST_CONTEXT', '/grant_request_ref'));
  const delayed = clone(positives.get('ReserveResult'));
  delayed.context.now = '2026-10-11T14:00:00Z'; delayed.context.dispatch_state = 'blocked';
  delayed.context.prior = clone(seeds.SettleResult.value.reservation);
  add('grant/expired-lease-already-consumed-does-not-renew-authority', delayed);
  for (const name of ['SettleResult', 'ReleaseResult']) {
    const changed = clone(positives.get(name));
    changed.context.request.resolution_ref = { ...changed.value.reservation.authority_ref, contract: 'FinanceResolution' };
    add('command-evidence/' + name + '/resolution', bind(changed),
      no(name === 'SettleResult' ? 'INVALID_MONEY' : 'INVALID_RECEIPT', name === 'SettleResult' ? '/reservation/consumed' : '/reservation'));
  }
  for (const lifecycle of ['released', 'expired']) for (const usage of ['unknown', 'incomplete']) {
    const seed = positives.get('fenced-' + lifecycle + '-' + usage);
    for (const mutation of ['missing', 'scope', 'reference', 'execution']) {
      const changed = clone(seed);
      if (mutation === 'missing') delete changed.context.resolution;
      if (mutation === 'scope') changed.context.resolution.billing_mode = 'live';
      if (mutation === 'reference') changed.context.resolution.reference.content_hash = 'sha256:' + '9'.repeat(64);
      if (mutation === 'execution') changed.context.resolution.execution_state = 'finished';
      add('independent-fence/' + lifecycle + '/' + usage + '/' + mutation, changed, no('INVALID_TRUST_CONTEXT', '/previous_result'));
    }
  }
  const conserved = clone(positives.get('SettleResult/partial-known-cost-held-unknown'));
  conserved.context.request.consumed.amount = '0.70';
  conserved.context.consumption_observation.consumed.amount = '0.70';
  add('held-retains-prior-evidence/changed-command', bind(conserved));
  const vanished = clone(conserved); vanished.value.reservation.retained_exposure.amount = '0.00';
  add('held-retains-prior-evidence/erased-exposure', bind(vanished), no('INVALID_RECEIPT', '/reservation'));
  const falseCost = clone(conserved); falseCost.context.prior_observation.consumed.amount = '0.50';
  add('held-retains-prior-evidence/contradiction', falseCost, no('INVALID_TRUST_CONTEXT', '/consumption_observation'));
  const overrun = clone(positives.get('overrun'));
  overrun.value.reservation.overrun.amount = '0.00';
  add('overrun/cached-erased-overrun', bind(overrun), no('INVALID_MONEY', '/overrun'));
  const forged = clone(positives.get('SettleResult'));
  forged.value.reservation.consumed.amount = '0.000002'; exposure(forged.value.reservation);
  add('amount/cached-and-outward-agree-without-independent-evidence', bind(forged), no('INVALID_TRUST_CONTEXT', '/consumption_observation'));
  return cases;
}
