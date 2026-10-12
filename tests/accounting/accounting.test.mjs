import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as accounting from '../../dist/accounting/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const golden = JSON.parse(await readFile(join(root, 'fixtures/accounting/ci06-golden-events.json'), 'utf8'));

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

function shuffle(items, seed) {
  const copy = [...items];
  let state = seed;
  for (let index = copy.length - 1; index > 0; index--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const swap = state % (index + 1);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

test('CI-06.1 every classification maps to a documented sign-matrix entry and policy is flagged pending sign-off', () => {
  assert.equal(accounting.ACCOUNTING_DEFINITIONS_STATUS, 'PENDING FINANCE-OWNER SIGN-OFF');
  const keys = Object.keys(accounting.ACCOUNTING_SIGN_MATRIX);
  for (const required of ['sale', 'discount', 'refund:sale', 'refund:fee', 'credit', 'reimbursement', 'tax', 'fee', 'direct_cost', 'payout', 'cash_movement']) {
    assert.ok(keys.includes(required), `matrix missing ${required}`);
  }
  // Gross sales only ever comes from a sale; taxes are pass-through; cash classifications never touch metrics.
  assert.equal(accounting.ACCOUNTING_SIGN_MATRIX.sale.grossSalesSign, 1);
  assert.equal(accounting.ACCOUNTING_SIGN_MATRIX.tax.grossSalesSign, 0);
  assert.equal(accounting.ACCOUNTING_SIGN_MATRIX.tax.netSalesSign, 0);
  assert.equal(accounting.ACCOUNTING_SIGN_MATRIX.tax.directCostsSign, 0);
  assert.equal(accounting.ACCOUNTING_SIGN_MATRIX.payout.cash, 'payout');
  // Recoveries reduce the original cost category and are never negative revenue (no double subtraction).
  for (const key of ['refund:fee', 'credit', 'reimbursement']) {
    assert.equal(accounting.ACCOUNTING_SIGN_MATRIX[key].recovery, true);
    assert.equal(accounting.ACCOUNTING_SIGN_MATRIX[key].netSalesSign, 0);
    assert.equal(accounting.ACCOUNTING_SIGN_MATRIX[key].directCostsSign, -1);
  }
});

test('CI-06.1/06.2 golden fixture projects exact gross/net/direct/contribution/cash totals and refund links', () => {
  const projection = accounting.projectAccounting(golden.events, { asOf: golden.asOf });
  assert.equal(projection.grossSales, golden.expected.grossSales);
  assert.equal(projection.netSales, golden.expected.netSales);
  assert.equal(projection.directCosts, golden.expected.directCosts);
  assert.equal(projection.contribution, golden.expected.contribution);
  assert.deepEqual(projection.cash, golden.expected.cash);
  assert.deepEqual(projection.refundLinks, golden.expected.refundLinks);
  assert.equal(projection.recognizedEventCount, golden.expected.recognizedEventCount);
  assert.equal(projection.currency, 'USD');
  assert.equal(projection.incomplete.length, 0);
  const digestInput = {
    policyVersion: projection.policyVersion, currency: projection.currency, scale: projection.scale,
    asOf: projection.asOf, grossSales: projection.grossSales, netSales: projection.netSales,
    directCosts: projection.directCosts, contribution: projection.contribution,
    cash: projection.cash, simulated: projection.simulated, refundLinks: projection.refundLinks,
    incomplete: projection.incomplete,
  };
  const expectedDigest = createHash('sha256').update(canonicalJson(digestInput), 'utf8').digest('hex');
  assert.equal(projection.projectionHash, 'sha256:' + expectedDigest, 'projection identity must be a real SHA-256 digest');
});

test('CI-06.2 cash receipts/payouts stay separate from accounting totals', () => {
  const projection = accounting.projectAccounting(golden.events, { asOf: golden.asOf });
  // Payout (90.00) and cash receipt (140.00) never appear in gross/net/direct/contribution.
  assert.equal(projection.cash.net, '50.00');
  assert.equal(projection.grossSales, '150.00');
  assert.equal(projection.netSales, '120.00');
});

test('CI-06.4 replaying and reordering events produces identical totals without duplication', () => {
  const baseline = accounting.projectAccounting(golden.events, { asOf: golden.asOf });
  const replayed = [...golden.events, ...golden.events];
  const reordered = shuffle(replayed, 7);
  const projection = accounting.projectAccounting(reordered, { asOf: golden.asOf });
  assert.equal(projection.grossSales, baseline.grossSales);
  assert.equal(projection.netSales, baseline.netSales);
  assert.equal(projection.directCosts, baseline.directCosts);
  assert.equal(projection.contribution, baseline.contribution);
  assert.equal(projection.projectionHash, baseline.projectionHash);
  assert.equal(projection.recognizedEventCount, baseline.recognizedEventCount);
  assert.ok(projection.duplicateEventIds.length >= golden.events.length);
});

test('CI-06.4 repeated and reordered adjustments keep only the highest revision per subject', () => {
  const sale = golden.events.find(event => event.eventId === 'S1');
  const low = { ...sale, eventId: 'ADJ-LOW', classification: 'adjustment', amount: '5.00', adjustmentTarget: 'net_sales', adjustmentDirection: 'decrease', recognition: 'actual', source: { ...sale.source, name: 'adjuster', sourceEventId: 'adj-subject', revision: 1, contentHash: `sha256:${'1'.repeat(64)}` } };
  const high = { ...low, eventId: 'ADJ-HIGH', amount: '9.00', source: { ...low.source, revision: 2, contentHash: `sha256:${'2'.repeat(64)}` } };
  const onlyLow = accounting.projectAccounting([sale, low], { asOf: golden.asOf });
  const bothOrderA = accounting.projectAccounting([sale, low, high], { asOf: golden.asOf });
  const bothOrderB = accounting.projectAccounting([high, sale, low, low], { asOf: golden.asOf });
  assert.equal(onlyLow.netSales, '95.00');
  assert.equal(bothOrderA.netSales, '91.00');
  assert.equal(bothOrderB.netSales, bothOrderA.netSales);
});

test('conflicting source facts for one revision are excluded deterministically', () => {
  const sale = golden.events.find(event => event.eventId === 'S1');
  const candidate = (eventId, amount, contentHash) => ({
    ...sale,
    eventId,
    amount,
    source: {
      ...sale.source, name: 'conflicting-source', sourceEventId: 'same-revision',
      revision: 8, contentHash: 'sha256:' + contentHash,
    },
  });
  const differentHashes = [
    candidate('SOURCE-CONFLICT-A', '1.00', 'a'.repeat(64)),
    candidate('SOURCE-CONFLICT-B', '90.00', 'b'.repeat(64)),
  ];
  const sameHashDifferentFacts = [
    candidate('SAME-HASH-A', '1.00', 'c'.repeat(64)),
    candidate('SAME-HASH-B', '90.00', 'c'.repeat(64)),
  ];
  for (const events of [differentHashes, sameHashDifferentFacts]) {
    const forward = accounting.projectAccounting(events, { asOf: golden.asOf });
    const reverse = accounting.projectAccounting([...events].reverse(), { asOf: golden.asOf });
    assert.equal(forward.recognizedEventCount, 0);
    assert.equal(forward.grossSales, '0.00');
    assert.deepEqual(forward.incomplete.map(record => record.reason), ['source_revision_conflict', 'source_revision_conflict']);
    assert.equal(forward.projectionHash, reverse.projectionHash, 'input order must not select a conflicting source fact');
  }
});

test('CI-06.4 unauthenticated sources and manual imports missing evidence stay visibly incomplete', () => {
  const unauth = { ...golden.events[0], eventId: 'UNAUTH', source: { ...golden.events[0].source, sourceEventId: 'evt_unauth', authenticated: false, contentHash: `sha256:${'3'.repeat(64)}` } };
  const badManual = { ...golden.events[0], eventId: 'BADMAN', source: { ...golden.events[0].source, sourceEventId: 'evt_badman', contentHash: `sha256:${'4'.repeat(64)}` }, manualImport: { actor: 'a', sourceHash: `sha256:${'5'.repeat(64)}`, reason: '', currency: 'USD' } };
  const projection = accounting.projectAccounting([...golden.events, unauth, badManual], { asOf: golden.asOf });
  const reasons = new Map(projection.incomplete.map(entry => [entry.eventId, entry.reason]));
  assert.equal(reasons.get('UNAUTH'), 'source_not_authenticated');
  assert.equal(reasons.get('BADMAN'), 'manual_import_missing_auditable_evidence');
  // Incomplete events never leak into recognized totals.
  assert.equal(projection.grossSales, golden.expected.grossSales);
});

test('CI-06.4 simulated sales are excluded from actual sales while actual (live) expense is retained', () => {
  const projection = accounting.projectAccounting(golden.events, { asOf: golden.asOf });
  assert.equal(projection.grossSales, '150.00');
  assert.equal(projection.simulated.grossSales, '999.00');
  // The live-mode AI direct cost (DC1=30 + RES1=1) is retained in actual direct costs.
  assert.equal(projection.simulated.directCosts, '0.00');
  assert.ok(Number(projection.directCosts) >= 31);
});

test('CI-06.3 shared expense posted once allocates across three orders with retained residual and unchanged project expense', () => {
  const { sourceAmount, currency, scale, targets, expected } = golden.allocation;
  const result = accounting.allocateSharedExpense(sourceAmount, currency, scale, targets);
  assert.equal(result.policyVersion, accounting.ACCOUNTING_ALLOCATION_POLICY_VERSION);
  assert.deepEqual(result.allocations, expected.allocations);
  assert.equal(result.allocatedTotal, expected.allocatedTotal);
  assert.equal(result.residual, expected.residual);
  assert.equal(result.projectExpense, expected.projectExpense);
  // Allocations sum to at most the source, and the project expense is never increased.
  assert.ok(Number(result.allocatedTotal) <= Number(result.sourceAmount));
  assert.equal(Number(result.allocatedTotal) + Number(result.residual), Number(result.sourceAmount));
  assert.equal(result.projectExpense, '1.00');
});

test('boundary validation accepts golden events and rejects unknown fields', () => {
  for (const event of golden.events) {
    const validated = accounting.validateAccountingEventBoundary(event);
    assert.equal(validated.ok, true, `golden event ${event.eventId} should validate`);
  }
  const bad = accounting.validateAccountingEventBoundary({ ...golden.events[0], notAField: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'VALIDATION_ERROR');
});
