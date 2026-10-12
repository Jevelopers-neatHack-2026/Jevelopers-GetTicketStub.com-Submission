import { readFile } from 'node:fs/promises';
import { checkOperation, checkReservation } from '../generated/index.mjs';
import { historicalFinanceFixture } from '../tooling/historical-finance-fixtures.mjs';
const root = new URL('../', import.meta.url);
export const budgetNames = Object.freeze(['BudgetReservation', 'ReserveRequest', 'ReserveResult', 'SettleRequest', 'SettleResult', 'ReleaseRequest', 'ReleaseResult', 'QueryRequest', 'QueryResult']);
export async function financeCounterexamples() {
  const fixtures = Object.fromEntries(await Promise.all(budgetNames.map(async name => [name, JSON.parse(await readFile(new URL('fixtures/' + name + '.json', root), 'utf8'))])));
  const given = name => { const fixture = fixtures[name]; const positive = fixture.cases.find(row => row.mode === 'semantic' && row.expected.ok); return { value: structuredClone(fixture.valid), context: structuredClone(positive.context) }; };
  const cases = [];
  let example = given('SettleRequest');
  example.context.prior.held.amount = '1.00'; example.value.consumed.amount = '1.10';
  cases.push({ finding: 'FC-001', id: 'overrun-command', contract: 'SettleRequest', ...example });
  example = given('BudgetReservation'); example.value.held.amount = '1.00'; example.value.consumed.amount = '1.10';
  cases.push({ finding: 'FC-001', id: 'overrun-snapshot', contract: 'BudgetReservation', ...example });
  for (const contract of budgetNames) {
    example = given(contract); example.context.environment = 'test'; example.context.billing_mode = 'simulated';
    example.value.environment = 'production'; example.value.billing_mode = 'live';
    cases.push({ finding: 'FC-002', id: 'partition-' + contract, contract, ...example });
  }
  example = given('SettleResult'); example.context.environment = 'test'; example.context.billing_mode = 'simulated'; example.value.reservation.billing_mode = 'live';
  cases.push({ finding: 'FC-002', id: 'nested-partition', contract: 'SettleResult', ...example });
  example = given('SettleResult'); example.value.reservation.consumed.amount = '0.000000';
  cases.push({ finding: 'FC-003', id: 'settle-result-contradicts-command', contract: 'SettleResult', ...example });
  example = given('ReserveResult'); example.value.reservation.held.amount = '100.00';
  cases.push({ finding: 'FC-003', id: 'reserve-result-contradicts-command', contract: 'ReserveResult', ...example });
  for (const contract of ['SettleResult', 'ReleaseResult']) {
    example = given(contract); example.context.execution_state = 'uncertain'; example.context.prior.execution_state = 'uncertain'; example.context.prior.lifecycle = 'uncertain_in_flight';
    example.value.disposition = 'held_for_reconciliation'; example.value.reservation.execution_state = 'uncertain'; example.value.reservation.lifecycle = 'uncertain_in_flight';
    example.value.reservation.consumed = structuredClone(example.context.prior.consumed); example.value.reservation.settlement_ref = null;
    delete example.context.references['reservation/settlement_ref'];
    cases.push({ finding: 'FC-004', id: 'retained-hold-' + contract, contract, ...example });
  }
  return cases;
}
export function observeCounterexample(example, historical = false) {
  const structural = example.value;
  const result = historical ? historicalFinanceFixture(example.contract, structural, example.context) : checkOperation(example.contract, structural, example.context);
  const subcontext = { ...example.context, references: Object.fromEntries(Object.entries(example.context.references).filter(([key]) => key.startsWith('reservation/')).map(([key, value]) => [key.slice('reservation/'.length), value])) };
  const nested = example.finding === 'FC-004' ? historical ? historicalFinanceFixture('BudgetReservation', example.value.reservation, subcontext) : checkReservation(example.value.reservation, subcontext) : null;
  return { finding: example.finding, id: example.id, contract: example.contract, result, nested };
}
