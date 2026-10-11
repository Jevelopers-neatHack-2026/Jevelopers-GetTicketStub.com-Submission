import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { financeCounterexamples, observeCounterexample } from './finance-counterexamples.mjs';
import { financeV2Examples } from './finance-v2-cases.mjs';
import { exact24V2Cases } from './finance-exact24-v2.mjs';
import { evaluateFixture, assertFixture } from '../tooling/fixture-harness.mjs';
import { validateContractVersion, parseContractVersion, checkFinanceOperation, checkFinanceDispatch, checkDecisionResult, checkDecisionReceipt, bindDecisionPort, checkOperation } from '../generated/index.mjs';
import { root, readJson } from '../scripts/generate.mjs';

const examples = await financeV2Examples();
const exactCases = await exact24V2Cases();
assert.equal(exactCases.length, 24);
for (const example of exactCases) test('exact finance boundary adaptation: ' + example.id, () => {
  assert.equal(checkOperation(example.contract, example.value, example.context).ok, example.expected_ok);
});
for (const name of Object.keys(examples.seeds)) {
  const fixture = await readJson('fixtures/' + name + '.2_0_0.json');
  for (const row of fixture.cases) test(name + '@2.0.0 / ' + row.id, () => assertFixture(evaluateFixture(name, fixture, row), row.expected));
}
const oldCases = await financeCounterexamples();
assert.equal(oldCases.length, 16);
for (const example of oldCases) test('legacy 1.0.0 counterexample remains explicitly characterized: ' + example.id, () => {
  const observed = observeCounterexample(example, true);
  if (['FC-002', 'FC-003'].includes(example.finding)) assert.equal(observed.result.ok, true);
  else {
    assert.equal(observed.result.ok, false);
    assert.equal(observed.result.errors[0].code, example.finding === 'FC-001' ? 'INVALID_MONEY' : 'INVALID_TRUST_CONTEXT');
    if (example.finding === 'FC-004') assert.equal(observed.nested.ok, true);
  }
});
for (const example of oldCases) test('active semantic helper blocks legacy counterexample without downgrade: ' + example.id, () => {
  const observed = observeCounterexample(example);
  assertFixture(observed.result, { ok: false, code: 'UNSUPPORTED_VERSION', path: '/schema_version' });
});
test('new finance safety context never silently selects the unsafe legacy semantic profile', async () => {
  for (const [name, example] of Object.entries(examples.seeds)) {
    const old = await readJson('fixtures/' + name + '.json');
    const result = checkOperation(name, old.valid, example.context);
    assertFixture(result, { ok: false, code: 'UNSUPPORTED_VERSION', path: '/schema_version' });
  }
});
test('overrun records exact actual cost and zero additional dispatch without altering the original hold', () => {
  const current = examples.scenarios.overrun;
  assert.equal(current.value.reservation.held.amount, '1.00');
  assert.equal(current.value.reservation.consumed.amount, '1.10');
  assert.equal(current.value.reservation.overrun.amount, '0.100000');
  assert.equal(current.value.reservation.dispatch_cap.amount, '0.000000');
  const before = JSON.stringify(current);
  assert.equal(checkFinanceOperation('SettleResult', current.value, current.context).ok, true);
  assert.equal(JSON.stringify(current), before);
  const context = { ...structuredClone(current.context), references: Object.fromEntries(Object.entries(current.context.references).filter(([key]) => key.startsWith('reservation/')).map(([key, value]) => [key.slice(12), value])), requested_dispatch: { amount: '0.01', currency: 'USD', scale: 6 } };
  assert.equal(checkFinanceDispatch(current.value.reservation, context).ok, false);
});
test('final 0.60 actual consumption conserves original 1.00 authorization and explicit 0.40 release', () => {
  const current = examples.scenarios.finalRemainder;
  assert.equal(checkFinanceOperation('SettleResult', current.value, current.context).ok, true);
  assert.equal(current.value.reservation.held.amount, '1.00');
  assert.equal(current.value.reservation.consumed.amount, '0.60');
  assert.equal(current.value.reservation.released_capacity.amount, '0.400000');
  assert.equal(current.value.reservation.retained_exposure.amount, '0.000000');
});
test('partial consumption conserves 0.40 exposure while in-flight usage remains incomplete', () => {
  const current = examples.scenarios.partial;
  assert.equal(checkFinanceOperation('SettleResult', current.value, current.context).ok, true);
  assert.equal(current.value.reservation.retained_exposure.amount, '0.400000');
  assert.equal(current.value.reservation.released_capacity.amount, '0.000000');
  assert.equal(current.value.reservation.unreported_exposure, 'unknown');
});
test('partial grant permits dispatch only after exact scoped cap acknowledgement', () => {
  const pending = examples.scenarios.partialGrant;
  const pendingContext = { ...structuredClone(pending.context), references: Object.fromEntries(Object.entries(pending.context.references).filter(([key]) => key.startsWith('reservation/')).map(([key, value]) => [key.slice(12), value])), requested_dispatch: { amount: '0.000400', currency: 'USD', scale: 6 } };
  assertFixture(checkFinanceDispatch(pending.value.reservation, pendingContext), { ok: false, code: 'INVALID_TRANSITION', path: '/dispatch_cap' });
  const accepted = examples.scenarios.acknowledged;
  const context = { ...structuredClone(accepted.context), requested_dispatch: { amount: '0.000400', currency: 'USD', scale: 6 } };
  assert.equal(checkFinanceDispatch(accepted.value, context).ok, true);
  context.requested_dispatch.amount = '0.000600';
  assertFixture(checkFinanceDispatch(accepted.value, context), { ok: false, code: 'INVALID_MONEY', path: '/dispatch_cap' });
});
test('canonical parser distinguishes retained 1.0.0 decoding from v2-only execution', async () => {
  const old = await readJson('fixtures/BudgetReservation.json');
  assert.equal(parseContractVersion('BudgetReservation', '1.0.0', JSON.stringify(old.valid)).ok, true);
  assertFixture(parseContractVersion('BudgetReservation', '2.0.0', JSON.stringify(old.valid)), { ok: false, code: 'UNSUPPORTED_VERSION', path: '/schema_version' });
  const current = examples.seeds.BudgetReservation;
  assert.equal(validateContractVersion('BudgetReservation', '2.0.0', current.value).ok, true);
  assertFixture(validateContractVersion('BudgetReservation', '1.0.0', current.value), { ok: false, code: 'UNSUPPORTED_VERSION', path: '/schema_version' });
});
for (const [key, replacement] of [['environment', 'production'], ['billing_mode', 'live']]) {
  test('SC-CHK-002 rejects ' + key + ' before DecisionPort callback dispatch', async () => {
    const fixture = await readJson('fixtures/DecisionPortRequest.json');
    const request = structuredClone(fixture.valid), context = structuredClone(fixture.cases.find(row => row.id === 'semantic-positive').context);
    const resultFixture = await readJson('fixtures/DecisionPortResult.json');
    request[key] = replacement;
    let calls = 0;
    const result = await bindDecisionPort(() => { calls++; return resultFixture.valid; }).decide(request, context);
    assert.equal(calls, 0);
    assertFixture(result, { ok: false, code: 'SCOPE_MISMATCH', path: '/' + key });
  });
  test('SC-CHK-002 binds returned DecisionPort ' + key, async () => {
    const request = (await readJson('fixtures/DecisionPortRequest.json')).valid;
    const fixture = await readJson('fixtures/DecisionPortResult.json'), context = fixture.cases.find(row => row.id === 'semantic-positive').context;
    const result = structuredClone(fixture.valid); result[key] = replacement;
    assertFixture(checkDecisionResult(request, result, context), { ok: false, code: 'SCOPE_MISMATCH', path: '/' + key });
  });
  test('SC-CHK-002 binds DecisionReceipt ' + key, async () => {
    const fixture = await readJson('fixtures/DecisionReceipt.json'), context = fixture.cases.find(row => row.id === 'semantic-positive').context;
    const receipt = structuredClone(fixture.valid); receipt[key] = replacement;
    assertFixture(checkDecisionReceipt(receipt, context), { ok: false, code: 'SCOPE_MISMATCH', path: '/' + key });
  });
  test('SC-CHK-002 rejects wrong trusted budget partition ' + key, async () => {
    const fixture = await readJson('fixtures/DecisionPortRequest.json');
    const context = structuredClone(fixture.cases.find(row => row.id === 'semantic-positive').context);
    context.environment = 'test'; context.billing_mode = 'simulated'; context.budget[key] = replacement;
    let calls = 0;
    const result = await bindDecisionPort(() => { calls++; return {}; }).decide(fixture.valid, context);
    assert.equal(calls, 0);
    assertFixture(result, { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/budget/' + key });
  });
}
test('DecisionPort v1 cannot reinterpret a v2 reservation as a legacy permission grant', async () => {
  const fixture = await readJson('fixtures/DecisionPortRequest.json');
  const context = structuredClone(fixture.cases.find(row => row.id === 'semantic-positive').context);
  context.budget = structuredClone(examples.seeds.BudgetReservation.value);
  let calls = 0;
  const result = await bindDecisionPort(() => { calls++; return {}; }).decide(fixture.valid, context);
  assert.equal(calls, 0);
  assertFixture(result, { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/budget' });
});
test('finance context money stays exact with no coercion or floating-point posting', () => {
  const example = structuredClone(examples.scenarios.overrun);
  example.context.request.consumed.amount = 1.1;
  assert.equal(checkFinanceOperation('SettleResult', example.value, example.context).ok, false);
});
test('two real supported finance versions have distinct exact generated decoder types', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-version-types-'));
  try {
    const source = join(directory, 'consumer.mts');
    await writeFile(source, `import { parseContractVersion } from ${JSON.stringify(root + 'generated/index.js')};
const old = parseContractVersion('BudgetReservation', '1.0.0', '{}');
if (old.ok) { const version: '1.0.0' = old.value.schema_version; }
const current = parseContractVersion('BudgetReservation', '2.0.0', '{}');
if (current.ok) { const version: '2.0.0' = current.value.schema_version; const protocol: '2.0.0' = current.value.finance_protocol_version; }
`);
    const result = spawnSync(process.execPath, [root + 'node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', source], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('legacy DecisionPort grant cannot dispatch without independent current Finance context', async () => {
  const fixture = await readJson('fixtures/DecisionPortRequest.json');
  const context = structuredClone(fixture.cases.find(row => row.id === 'semantic-positive').context);
  delete context.finance_context;
  let calls = 0;
  const result = await bindDecisionPort(() => { calls++; return {}; }).decide(fixture.valid, context);
  assert.equal(calls, 0);
  assertFixture(result, { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/finance_context' });
});
test('contradictory legacy budget projection cannot downgrade DecisionPort authority', async () => {
  const fixture = await readJson('fixtures/DecisionPortRequest.json');
  const context = structuredClone(fixture.cases.find(row => row.id === 'semantic-positive').context);
  context.budget.held.amount = '100.00';
  let calls = 0;
  const result = await bindDecisionPort(() => { calls++; return {}; }).decide(fixture.valid, context);
  assert.equal(calls, 0);
  assertFixture(result, { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/budget_projection' });
});

for (const name of ['ReserveResult', 'SettleResult', 'ReleaseResult', 'QueryResult']) test('v2 exact cached ' + name + ' acknowledgement never reexecutes economics', () => {
  const example = structuredClone(examples.seeds[name]);
  example.context.previous_command = structuredClone(example.context.request);
  example.context.previous_result = structuredClone(example.value);
  if (example.context.prior) example.context.command_prior = structuredClone(example.context.prior);
  example.context.prior = name === 'ReserveResult' ? undefined : structuredClone(example.value.reservation);
  if (example.context.prior === undefined) delete example.context.prior;
  example.value.disposition = 'duplicate';
  assert.equal(checkFinanceOperation(name, example.value, example.context).ok, true);
  const forged = structuredClone(example);
  forged.value.reservation.held.amount = '100.00'; forged.context.previous_result.reservation.held.amount = '100.00';
  assert.equal(checkFinanceOperation(name, forged.value, forged.context).ok, false);
});
