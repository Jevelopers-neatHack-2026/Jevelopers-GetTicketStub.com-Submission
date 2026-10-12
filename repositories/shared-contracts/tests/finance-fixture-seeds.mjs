import { readFile } from 'node:fs/promises';
import { hashManifest } from '../tooling/runtime.mjs';
import { budgetNames } from './finance-counterexamples.mjs';
const root = new URL('../', import.meta.url);
export function fixtureReferences(value, path = '', slot = false) {
  if (value === null || typeof value !== 'object') return {};
  if (slot && !Array.isArray(value) && Object.hasOwn(value, 'schema_version') && Object.hasOwn(value, 'content_hash')) return { [path]: structuredClone(value) };
  return Object.assign({}, ...Object.entries(value).map(([key, child]) => fixtureReferences(child, path ? path + '/' + key : key, key.endsWith('_ref') || key.endsWith('_refs') || key === 'reference' || (slot && Array.isArray(value)))));
}
export function requestReference(request) { return { contract: request.contract, schema_version: '2.0.0', id: request.request_id, revision: 1, content_hash: hashManifest(request) }; }
export function observeConsumption(reservation, command, now) {
  return { tenant_id: reservation.tenant_id, project_id: reservation.project_id, environment: reservation.environment, billing_mode: reservation.billing_mode, reservation_id: reservation.reservation_id, billable_attempt_id: reservation.billable_attempt_id, consumed: structuredClone(command.consumed), consumption_kind: command.consumption_kind, correction_ref: structuredClone(command.correction_ref), exception_refs: structuredClone(command.exception_refs), reference: structuredClone(command.usage_ref), observed_at: now };
}
export async function financeSeeds() {
  const old = Object.fromEntries(await Promise.all(budgetNames.map(async name => [name, JSON.parse(await readFile(new URL('fixtures/' + name + '.json', root), 'utf8'))])));
  const basic = name => ({ ...structuredClone(old[name].valid), schema_version: '2.0.0', finance_protocol_version: '2.0.0' });
  const reservation = basic('BudgetReservation');
  const reserve = { ...structuredClone(old.ReserveResult.cases.find(row => row.mode === 'semantic' && row.expected.ok).context.request), schema_version: '2.0.0', finance_protocol_version: '2.0.0', partial_grant: 'forbid', pricing_basis: 'bounded_conservative' };
  const zero = structuredClone(reservation.consumed);
  Object.assign(reservation, { requested_capacity: structuredClone(reserve.requested), held: structuredClone(reserve.requested), grant_revision: 1, grant_request_ref: requestReference(reserve), dispatch_cap: structuredClone(reserve.requested), dispatch_acknowledgement_ref: null, overrun: structuredClone(zero), consumption_basis: 'cumulative', settlement_intent: 'none', consumption_kind: 'regular', consumption_evidence_ref: null, correction_ref: null, exception_refs: [], retained_exposure: structuredClone(reserve.requested), released_capacity: structuredClone(zero), unreported_exposure: 'unknown' });
  const base = { ...structuredClone(old.BudgetReservation.cases.find(row => row.mode === 'semantic' && row.expected.ok).context), finance_protocol_version: '2.0.0', environment: reservation.environment, billing_mode: reservation.billing_mode, dispatch_state: 'eligible', initial_request: structuredClone(reserve), grant_revision: 1, grant_decision: 'granted', authorized_capacity: structuredClone(reserve.requested) };
  const settle = { ...basic('SettleRequest'), consumption_basis: 'cumulative', settlement_intent: 'final', consumption_kind: 'regular', correction_ref: null, exception_refs: [] };
  const release = basic('ReleaseRequest'), query = basic('QueryRequest');
  const settleContext = { ...structuredClone(base), prior: structuredClone(reservation), execution_state: 'finished', consumption_observation: observeConsumption(reservation, settle, base.now) };
  const settled = { ...structuredClone(reservation), ...structuredClone(old.SettleResult.valid.reservation), schema_version: '2.0.0', finance_protocol_version: '2.0.0', grant_request_ref: requestReference(reserve), requested_capacity: structuredClone(reserve.requested), held: structuredClone(reserve.requested), dispatch_cap: structuredClone(zero), consumed: structuredClone(settle.consumed), settlement_intent: 'final', consumption_evidence_ref: structuredClone(settle.usage_ref) };
  const released = { ...structuredClone(reservation), ...structuredClone(old.ReleaseResult.valid.reservation), schema_version: '2.0.0', finance_protocol_version: '2.0.0', grant_request_ref: requestReference(reserve), requested_capacity: structuredClone(reserve.requested), held: structuredClone(reserve.requested), dispatch_cap: structuredClone(zero) };
  settled.retained_exposure = structuredClone(zero); settled.released_capacity = structuredClone(zero); settled.unreported_exposure = 'none';
  released.retained_exposure = structuredClone(zero); released.released_capacity = structuredClone(reserve.requested); released.unreported_exposure = 'none';
  const cases = {
    BudgetReservation: { value: reservation, context: base },
    ReserveRequest: { value: reserve, context: structuredClone(base) },
    SettleRequest: { value: settle, context: settleContext },
    ReleaseRequest: { value: release, context: { ...structuredClone(base), prior: structuredClone(reservation) } },
    QueryRequest: { value: query, context: { ...structuredClone(base), prior: structuredClone(reservation) } }
  };
  for (const [name, request, snapshot, context] of [
    ['ReserveResult', reserve, reservation, base], ['SettleResult', settle, settled, settleContext],
    ['ReleaseResult', release, released, cases.ReleaseRequest.context], ['QueryResult', query, reservation, { ...cases.QueryRequest.context, current_reservation: structuredClone(reservation) }]
  ]) cases[name] = { value: { ...basic(name), reservation: structuredClone(snapshot), request_ref: requestReference(request) }, context: { ...structuredClone(context), request: structuredClone(request), request_references: fixtureReferences(request) } };
  for (const seed of Object.values(cases)) seed.context.references = fixtureReferences(seed.value);
  return { cases, old };
}
