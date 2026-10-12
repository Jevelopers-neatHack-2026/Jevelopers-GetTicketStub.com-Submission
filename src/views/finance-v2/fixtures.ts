import type { FinanceV2Input, FinanceV2Page, OpaqueProductScope, ReportingAmount, ReportingBudget, ReportingCurrencySummary, ReportingDetail, ReportingGroup, ReportingProjection } from './types';

/**
 * SYNTHETIC_PROPOSAL fixtures typed against the FROZEN WIP Finance proposal (`schema-v2.ts`, `FinancialSummaryPageV2`).
 * They are generated here, not copied from a Finance run: they are not observations, not Finance output, not owner-accepted
 * and not producer evidence. Amounts are fixed strings chosen for display cases; no value here is computed from another.
 * Hash-shaped strings are label-derived placeholders, not digests of anything.
 */
export const FROZEN_PROPOSAL_PROVENANCE = Object.freeze({
  status: 'WIP_PROPOSAL_NOT_ACCEPTED',
  sourceBase: 'a08760e9ea65bda1e116867ac00b3e03d737bb7e',
  manifestCapturedAt: '2026-10-12T10:40:31.830416+00:00',
  manifestPath: '/tmp/td-finance-v2-frozen-proposal/manifest.json',
  files: Object.freeze([
    { path: 'src/reporting/schema-v2.ts', sha256: '467f46768cb80912ccc82ad4d0003d9987726333b1680c7e8ef98ef425719c7f' },
    { path: 'src/reporting/definitions.ts', sha256: 'adfb4d5132349878a25673455fb2f8898bdde674c7fe2369516b6c11daa85e8f' },
    { path: 'src/reporting/host-authority.ts', sha256: '4f781461f9afc89434c6dd99b31d6bf90530d41c6d315e73b992d6bf6b1ae92e' },
    { path: 'fixtures/reporting/query-export-handoff.json', sha256: 'eca74fe6fd34b9631fcb3022f3417425ef94580043a67fce4832b52fa6993da9' },
  ]),
  generatedBy: 'src/views/finance-v2/fixtures.ts',
  observation: false,
  ownerAccepted: false,
} as const);

export const financeV2FixtureNames = [
  'ready', 'mixed-currency-partial', 'unknown-coverage', 'refund-negative', 'empty-budget',
  'forged-scope', 'forged-snapshot', 'unsupported-version', 'invalid-shape', 'missing', 'restricted', 'unauthorized', 'unknown-state',
] as const;
export type FinanceV2FixtureName = (typeof financeV2FixtureNames)[number];

/** Opaque product scope as the product host states it. Deliberately not a canonical UUID. */
export const syntheticOpaqueScope: OpaqueProductScope = Object.freeze({
  tenantId: 'account:synthetic-tenant', projectId: 'event:synthetic-project', environment: 'test', billingMode: 'simulated', actorId: 'account:synthetic-actor',
});
const placeholderHash = (label: string): string => `sha256:${[...label].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64)}`;
export const syntheticSnapshotId = placeholderHash('synthetic-snapshot');

const D = '000000000000000000';
const zero = `0.${D}`;
const amount = (value: string): string => `${value}.${D}`;
const known = (value: string): ReportingAmount => ({ status: 'known', knownSubtotal: amount(value), total: amount(value), unknownCount: 0 });
const partial = (subtotal: string, unknownCount: number): ReportingAmount => ({ status: 'partial', knownSubtotal: amount(subtotal), total: null, unknownCount });
const unknown = (unknownCount: number): ReportingAmount => ({ status: 'unknown', knownSubtotal: null, total: null, unknownCount });
const metrics = (over: Partial<ReportingCurrencySummary['metrics']> = {}): ReportingCurrencySummary['metrics'] => ({
  expense: known('42'), grossSales: known('120'), netSales: known('110'), directCosts: known('30'), contribution: known('80'), cashReceipts: known('100'), cashPayouts: known('0'), ...over,
});
const group = (dimension: ReportingGroup['dimension'], value: string | null, expense: ReportingAmount, eventCount: number): ReportingGroup =>
  ({ dimension, value, bucket: value === null ? 'unknown_unallocated' : 'known', eventCount, metrics: metrics({ expense }) });
const summary = (currency: string, over: Partial<ReportingCurrencySummary> = {}): ReportingCurrencySummary => ({
  currency, scale: 18, metrics: metrics(),
  valuation: { estimated: known('12'), confirmed: known('30'), unknownCount: 0 },
  reconciliation: { matchedCount: 3, unmatchedCount: 1, exceptionCount: 0 },
  simulated: { expense: amount('5'), grossSales: zero, netSales: zero, directCosts: amount('5') },
  groups: [group('provider', 'provider-a', known('25'), 3), group('provider', 'provider-b', known('17'), 2), group('model', 'model-a', known('42'), 5)], ...over,
});
const policyReference = { id: 'budget-policy-synthetic', revision: 1, contentHash: placeholderHash('synthetic-budget-policy') };
const budget = (currency: string, over: Partial<ReportingBudget> = {}): ReportingBudget => ({
  currency, window: 'project_lifetime', policyReference, limit: amount('100'), ledgerExpense: amount('42'), lifecycleConsumed: amount('55'), held: amount('10'),
  remainingAuthorizedCapacity: amount('35'), unresolvedExposure: true, advisoryOnly: true, ...over,
});
const projection = (over: Partial<ReportingProjection> = {}): ReportingProjection => ({
  policyVersion: 'ci08-reporting-policy-2.0.0', accountingPolicyVersion: 'synthetic-accounting-policy', definitionsStatus: 'definitions_pending_owner_signoff',
  currencies: [summary('USD')],
  coverage: { status: 'complete', observed: 5, expected: 5, unknownAmountCount: 0, unpostedAttemptCount: 0, awaitingEvidenceAttemptCount: 0, quarantinedObservationCount: 0, unsupportedEventCount: 0, missingSources: [] },
  budgets: [budget('USD')], unitCosts: [], allocations: [], ...over,
});
const noDimensions = { provider: null, model: null, feature: null, repo: null, workflowId: null, productId: null, orderId: null, channel: null } as const;
const detailMetrics = (over: Record<string, string> = {}): Record<string, string> => ({
  expense: zero, grossSales: zero, netSales: zero, directCosts: zero, contribution: zero, cashReceipts: zero, cashPayouts: zero,
  simulatedGrossSales: zero, simulatedNetSales: zero, simulatedDirectCosts: zero, simulatedExpense: zero, ...over,
});
export const detailIds = {
  aiCost: placeholderHash('detail-ai-cost'), sale: placeholderHash('detail-sale'), refund: placeholderHash('detail-refund'),
  unknown: placeholderHash('detail-unknown'), eur: placeholderHash('detail-eur'),
} as const;
const details = (): ReportingDetail[] => [
  { detailId: detailIds.aiCost, currency: 'USD', eventType: 'ai.usage', classification: 'direct_cost', occurredAt: '2026-10-02T09:00:00Z', valuation: 'estimated', reconciliation: 'unmatched', settlement: 'unpaid',
    dimensions: { ...noDimensions, provider: 'provider-a', model: 'model-a', feature: 'summaries' }, amount: amount('12'), metrics: detailMetrics({ expense: amount('12'), directCosts: amount('12') }), status: 'recognized' },
  { detailId: detailIds.sale, currency: 'USD', eventType: 'sale.completed', classification: 'sale', occurredAt: '2026-10-03T12:30:00Z', valuation: 'provider_confirmed', reconciliation: 'matched', settlement: 'paid',
    dimensions: { ...noDimensions, productId: 'event:synthetic-project', orderId: 'order-1', channel: 'web' }, amount: amount('120'), metrics: detailMetrics({ grossSales: amount('120'), netSales: amount('120'), cashReceipts: amount('120') }), status: 'recognized' },
  { detailId: detailIds.refund, currency: 'USD', eventType: 'sale.refunded', classification: 'refund', occurredAt: '2026-10-04T08:15:00Z', valuation: 'provider_confirmed', reconciliation: 'matched', settlement: 'partly_paid',
    dimensions: { ...noDimensions, productId: 'event:synthetic-project', orderId: 'order-1', channel: 'web' }, amount: `-10.${D}`, metrics: detailMetrics({ netSales: `-10.${D}`, cashPayouts: amount('10') }), status: 'recognized' },
  { detailId: detailIds.unknown, currency: 'USD', eventType: 'ai.usage', classification: 'direct_cost', occurredAt: '2026-10-05T16:45:00Z', valuation: 'unknown', reconciliation: 'unmatched', settlement: 'unpaid',
    dimensions: { ...noDimensions, provider: 'provider-b' }, amount: null, metrics: detailMetrics(), status: 'unknown' },
];
const eurDetail = (): ReportingDetail => ({
  detailId: detailIds.eur, currency: 'EUR', eventType: 'supplier.invoice', classification: 'fulfillment_cost', occurredAt: '2026-10-06T10:00:00Z', valuation: 'provider_confirmed', reconciliation: 'exception', settlement: 'unpaid',
  dimensions: { ...noDimensions, orderId: 'order-2' }, amount: amount('8'), metrics: detailMetrics({ expense: amount('8') }), status: 'recognized',
});
const page = (over: Partial<FinanceV2Page> = {}): FinanceV2Page => ({
  schemaVersion: '2.0.0', requestId: 'synthetic-request-1', snapshotId: syntheticSnapshotId, queryContentHash: placeholderHash('synthetic-query'), summaryContentHash: placeholderHash('synthetic-summary'),
  asOf: '2026-10-08T00:05:00Z', timezone: 'UTC', period: { start: '2026-10-01T00:00:00Z', end: '2026-10-08T00:00:00Z' }, scope: syntheticOpaqueScope,
  summary: projection(), details: details(), detailCount: 4, hasMore: false, nextCursor: null, canonicalMappingStatus: 'unsupported_opaque_scope', ...over,
});

export type FinanceV2Fixture = Readonly<{ input: FinanceV2Input; expectedScope: OpaqueProductScope; expectedSnapshotId: string }>;
/** Typed fixture for one named case. The result is exactly what a host would hand the view; forged cases are deliberately wrong. */
export function financeV2Fixture(name: FinanceV2FixtureName): FinanceV2Fixture {
  const ready = (value: unknown): FinanceV2Input => ({ status: 'ready', page: value });
  const make = (input: FinanceV2Input): FinanceV2Fixture => ({ input, expectedScope: syntheticOpaqueScope, expectedSnapshotId: syntheticSnapshotId });
  switch (name) {
    case 'ready': return make(ready(page()));
    case 'mixed-currency-partial': return make(ready(page({
      summary: projection({
        currencies: [summary('USD', { metrics: metrics({ expense: partial('30', 2), contribution: unknown(3) }), valuation: { estimated: partial('12', 2), confirmed: known('30'), unknownCount: 2 },
          groups: [group('provider', 'provider-a', known('25'), 3), group('provider', null, partial('5', 2), 2)] }), summary('EUR', { metrics: metrics({ expense: known('8'), grossSales: known('0'), netSales: known('0'), directCosts: known('8'), contribution: known('0') }),
          reconciliation: { matchedCount: 0, unmatchedCount: 0, exceptionCount: 1 }, valuation: { estimated: known('0'), confirmed: known('8'), unknownCount: 0 }, groups: [group('provider', 'supplier-x', known('8'), 1)] })],
        coverage: { status: 'partial', observed: 4, expected: 6, unknownAmountCount: 2, unpostedAttemptCount: 1, awaitingEvidenceAttemptCount: 1, quarantinedObservationCount: 0, unsupportedEventCount: 0, missingSources: ['synthetic-cash-source'] },
        budgets: [budget('USD'), budget('EUR', { limit: null, remainingAuthorizedCapacity: null, policyReference: null, ledgerExpense: amount('8'), lifecycleConsumed: amount('8'), held: zero, unresolvedExposure: false })],
      }),
      details: [...details(), eurDetail()], detailCount: 5,
    })));
    case 'unknown-coverage': return make(ready(page({
      summary: projection({
        currencies: [summary('USD', { metrics: metrics({ expense: unknown(4), grossSales: unknown(2), netSales: unknown(2), directCosts: unknown(4), contribution: unknown(4), cashReceipts: unknown(1), cashPayouts: unknown(1) }), valuation: { estimated: unknown(4), confirmed: unknown(0), unknownCount: 4 }, groups: [] })],
        coverage: { status: 'unknown', observed: 0, expected: null, unknownAmountCount: 4, unpostedAttemptCount: 0, awaitingEvidenceAttemptCount: 0, quarantinedObservationCount: 2, unsupportedEventCount: 1, missingSources: ['synthetic-expense-source', 'synthetic-revenue-source'] },
        budgets: [budget('USD', { limit: null, remainingAuthorizedCapacity: null, policyReference: null })],
      }),
      details: [details()[3]!], detailCount: 1,
    })));
    case 'refund-negative': return make(ready(page({
      summary: projection({ currencies: [summary('USD', { metrics: metrics({ grossSales: known('120'), netSales: { status: 'known', knownSubtotal: `-10.${D}`, total: `-10.${D}`, unknownCount: 0 } }) })] }),
      details: [details()[2]!], detailCount: 1,
    })));
    case 'empty-budget': return make(ready(page({ summary: projection({ budgets: [] }) })));
    case 'forged-scope': return make(ready(page({ scope: { ...syntheticOpaqueScope, tenantId: 'account:another-tenant' } })));
    case 'forged-snapshot': return make(ready(page({ snapshotId: placeholderHash('some-other-snapshot') })));
    case 'unsupported-version': return make(ready({ ...page(), schemaVersion: '1.0.0' }));
    case 'invalid-shape': return make(ready({ ...page(), summary: { ...projection(), currencies: 'not-an-array' } }));
    case 'missing': return make({ status: 'missing' });
    case 'restricted': return make({ status: 'restricted' });
    case 'unauthorized': return make({ status: 'unauthorized' });
    case 'unknown-state': return make({ status: 'unknown' });
  }
}
