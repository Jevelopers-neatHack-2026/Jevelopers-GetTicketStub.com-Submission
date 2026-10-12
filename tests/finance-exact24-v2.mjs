import { readJson } from '../scripts/generate.mjs';
import { financeSeeds, fixtureReferences, observeConsumption } from './finance-fixture-seeds.mjs';
import { exposure } from './finance-v2-cases.mjs';
export async function exact24V2Cases() {
  const seeds = (await financeSeeds()).cases, out = [];
  const add = (id, contract, expected_ok, edit, override) => {
    const example = structuredClone(override ?? seeds[contract]);
    edit(example.value, example.context);
    out.push({ id, contract, expected_ok, ...example });
  };
  add('FC001-subcent-valid', 'SettleRequest', true, (p, c) => { p.consumed.amount = '0.000001'; c.consumption_observation.consumed = structuredClone(p.consumed); });
  add('FC001-negative-amount-rejected', 'SettleRequest', false, p => { p.consumed.amount = '-0.000001'; });
  add('FC001-currency-mismatch-rejected', 'SettleRequest', false, p => { p.consumed.currency = 'EUR'; });
  add('FC001-rewriting-original-hold-rejected', 'BudgetReservation', false, (p, c) => { c.prior = structuredClone(p); p.revision++; p.event_id = '123e4567-e89b-42d3-a456-000000009101'; p.held.amount = '100.00'; });
  for (const name of ['SettleRequest', 'ReleaseRequest', 'QueryRequest']) add('FC002-prior-mode-' + name, name, false, (p, c) => { c.prior.billing_mode = 'live'; });
  add('FC002-prior-revision-mode', 'BudgetReservation', false, (p, c) => { c.prior = structuredClone(p); c.prior.billing_mode = 'live'; p.revision++; p.event_id = '123e4567-e89b-42d3-a456-000000009102'; });
  for (const name of ['ReserveResult', 'SettleResult', 'ReleaseResult', 'QueryResult']) add('FC002-unknown-result-mode-' + name, name, false, (p, c) => { p.disposition = 'unknown'; p.reservation = null; p.environment = 'production'; p.billing_mode = 'live'; c.environment = 'test'; c.billing_mode = 'simulated'; });
  const usage = await readJson('fixtures/UsageEvent.json'), positive = usage.cases.find(row => row.id === 'semantic-positive');
  const usageSeed = { value: { ...usage.valid, ...positive.set }, context: positive.context };
  add('FC002-test-live-usage-positive', 'UsageEvent', true, (p, c) => { p.billing_mode = c.billing_mode = 'live'; }, usageSeed);
  add('FC002-forged-usage-mode-negative', 'UsageEvent', false, p => { p.billing_mode = 'live'; }, usageSeed);
  add('FC003-unrequested-partial-grant', 'ReserveResult', false, p => { p.reservation.held.amount = '0.000001'; });
  function priorPartial(context) {
    context.prior.consumed.amount = '0.000500'; context.prior.settlement_intent = 'partial'; context.prior.execution_state = 'finished';
    context.prior.usage_completeness = 'incomplete'; context.prior.consumption_evidence_ref = { ...context.request.usage_ref, id: '123e4567-e89b-42d3-a456-000000009103' };
    exposure(context.prior);
  }
  add('FC003-correct-nonzero-cumulative-settle', 'SettleResult', true, (p, c) => { priorPartial(c); });
  add('FC003-cumulative-result-cannot-decrease', 'SettleResult', false, (p, c) => { priorPartial(c); p.reservation.consumed.amount = '0.000400'; exposure(p.reservation); });
  for (const name of ['ReleaseResult', 'SettleResult']) add('FC004-incomplete-usage-held-' + name, name, true, (p, c) => {
    p.disposition = 'held_for_reconciliation'; c.execution_state = 'finished'; c.usage_completeness = 'incomplete';
    p.reservation = structuredClone(c.prior); p.reservation.execution_state = 'finished'; p.reservation.usage_completeness = 'incomplete';
    p.reservation.lifecycle = 'uncertain_in_flight'; p.reservation.settlement_ref = null; p.reservation.revision++; p.reservation.event_id = '123e4567-e89b-42d3-a456-000000009104';
    c.references = fixtureReferences(p);
  });
  for (const name of ['ReleaseRequest', 'SettleRequest']) add('FC004-unsafe-transition-still-rejected-' + name, name, false, (p, c) => { c.execution_state = 'uncertain'; c.prior.execution_state = 'uncertain'; c.prior.lifecycle = 'uncertain_in_flight'; });
  add('FC004-expired-uncertain-hold-remains-valid', 'BudgetReservation', true, (p, c) => { c.now = '2026-10-10T14:00:00Z'; c.execution_state = p.execution_state = 'uncertain'; p.lifecycle = 'uncertain_in_flight'; });
  add('GAP001-reporting-query-not-reservation-query', 'QueryRequest', false, p => { p.as_of = '2026-10-10T12:00:00Z'; });
  add('GAP002-partial-settlement-intent-not-represented', 'SettleRequest', false, p => { p.final = false; });
  return out;
}
