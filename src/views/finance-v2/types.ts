/**
 * Checked TypeScript props for the Finance v2 presentation, mirroring the FROZEN WIP proposal
 * `src/reporting/schema-v2.ts` (manifest status WIP_PROPOSAL_NOT_ACCEPTED, source_base a08760e9). Field names and unions follow
 * `FinancialSummaryPageV2`, `ReportingProjection`, `ReportingDetail` and `ReportingAmount` exactly.
 *
 * This is NOT a canonical fork: the shared-contracts schema is not copied, no TypeBox schema is re-created, and nothing here is
 * a producer validator. Decimal values stay producer strings end to end. `canonicalSummaries` is deliberately absent from the
 * props: the rich projection is shown whether or not a canonical mapping exists. Erasable TypeScript only.
 */
export type Sha256Ref = string;
export type DecimalString = string;
export type Instant = string;
export type AmountStatus = 'known' | 'partial' | 'unknown';
export type ReportingAmount = Readonly<{ status: AmountStatus; knownSubtotal: DecimalString | null; total: DecimalString | null; unknownCount: number }>;
export type ReportingDimension = 'provider' | 'model' | 'feature' | 'repo' | 'workflowId' | 'productId' | 'orderId' | 'channel';
export const REPORTING_DIMENSIONS: readonly ReportingDimension[] = ['provider', 'model', 'feature', 'repo', 'workflowId', 'productId', 'orderId', 'channel'];
export type MetricName = 'expense' | 'grossSales' | 'netSales' | 'directCosts' | 'contribution' | 'cashReceipts' | 'cashPayouts';
export const METRIC_NAMES: readonly MetricName[] = ['expense', 'grossSales', 'netSales', 'directCosts', 'contribution', 'cashReceipts', 'cashPayouts'];
/** The eleven detail metric names of the frozen `ReportingDetail.metrics` (`additionalProperties: false`). Nothing else is rendered. */
export type DetailMetricName = MetricName | 'simulatedGrossSales' | 'simulatedNetSales' | 'simulatedDirectCosts' | 'simulatedExpense';
export const DETAIL_METRIC_NAMES: readonly DetailMetricName[] = [...METRIC_NAMES, 'simulatedGrossSales', 'simulatedNetSales', 'simulatedDirectCosts', 'simulatedExpense'];
export type Metrics = Readonly<Record<MetricName, ReportingAmount>>;
export type VersionedRef = Readonly<{ id: string; revision: number; contentHash: Sha256Ref }>;

/**
 * Opaque product scope as the product host states it (`account:...`, `event:...`). It is shown as delivered. It is never
 * converted to, or required to be, a canonical UUID, and no grant is derived from it; compare it with the host's expectation only.
 */
export type OpaqueProductScope = Readonly<{ tenantId: string; projectId: string; environment: string; billingMode: string; actorId: string }>;

export type ReportingDetail = Readonly<{
  detailId: Sha256Ref; currency: string; eventType: string; classification: string; occurredAt: Instant;
  valuation: 'estimated' | 'provider_confirmed' | 'unknown'; reconciliation: 'unmatched' | 'matched' | 'exception'; settlement: 'unpaid' | 'partly_paid' | 'paid';
  dimensions: Readonly<Record<ReportingDimension, string | null>>;
  amount: DecimalString | null;
  metrics: Readonly<Record<DetailMetricName, DecimalString>>;
  status: 'recognized' | 'unknown' | 'unsupported';
}>;
export type ReportingGroup = Readonly<{ dimension: ReportingDimension; value: string | null; bucket: 'known' | 'unknown_unallocated'; eventCount: number; metrics: Metrics }>;
export type ReportingCurrencySummary = Readonly<{
  currency: string; scale: 18; metrics: Metrics;
  valuation: Readonly<{ estimated: ReportingAmount; confirmed: ReportingAmount; unknownCount: number }>;
  reconciliation: Readonly<{ matchedCount: number; unmatchedCount: number; exceptionCount: number }>;
  simulated: Readonly<{ expense: DecimalString; grossSales: DecimalString; netSales: DecimalString; directCosts: DecimalString }>;
  groups: readonly ReportingGroup[];
}>;
export type ReportingBudget = Readonly<{
  currency: string; window: 'project_lifetime'; policyReference: VersionedRef | null; limit: DecimalString | null;
  ledgerExpense: DecimalString; lifecycleConsumed: DecimalString; held: DecimalString; remainingAuthorizedCapacity: DecimalString | null;
  unresolvedExposure: boolean; advisoryOnly: true;
}>;
export type ReportingCoverage = Readonly<{
  status: 'complete' | 'partial' | 'unknown'; observed: number; expected: number | null; unknownAmountCount: number;
  unpostedAttemptCount: number; awaitingEvidenceAttemptCount: number; quarantinedObservationCount: number; unsupportedEventCount: number; missingSources: readonly string[];
}>;
export type ReportingProjection = Readonly<{
  policyVersion: string; accountingPolicyVersion: string; definitionsStatus: string;
  currencies: readonly ReportingCurrencySummary[]; coverage: ReportingCoverage; budgets: readonly ReportingBudget[];
  unitCosts: readonly unknown[]; allocations: readonly unknown[];
}>;
export type FinanceV2Page = Readonly<{
  schemaVersion: '2.0.0'; requestId: string; snapshotId: Sha256Ref; queryContentHash: Sha256Ref; summaryContentHash: Sha256Ref;
  asOf: Instant; timezone: string; period: Readonly<{ start: Instant; end: Instant }>; scope: OpaqueProductScope;
  summary: ReportingProjection; details: readonly ReportingDetail[]; detailCount: number; hasMore: boolean; nextCursor: string | null;
  canonicalMappingStatus: 'proposal_only_owner_ack_pending' | 'unsupported_opaque_scope';
}>;

/** Outcome of a host read. Only `ready` carries amounts; every other state shows none. */
export type FinanceV2Result =
  | Readonly<{ status: 'ready'; page: FinanceV2Page }>
  | Readonly<{ status: 'missing' | 'restricted' | 'unauthorized' | 'unknown' }>;

/** What a host hands the view: the same states as `FinanceV2Result`, but a ready page is `unknown` until `checkFinanceV2Page` has accepted it. */
export type FinanceV2Input = Readonly<{ status: 'ready'; page: unknown }> | Readonly<{ status: 'missing' | 'restricted' | 'unauthorized' | 'unknown' }>;
/** The only mode this slice accepts. Anything else renders nothing financial. */
export type FinanceV2Mode = 'SYNTHETIC_PROPOSAL';
export type FinanceV2RefusalCode = 'INVALID_SHAPE' | 'SCOPE_MISMATCH' | 'UNSUPPORTED_VERSION' | 'SNAPSHOT_MISMATCH' | 'QUERY_HASH_MISMATCH' | 'SUMMARY_HASH_MISMATCH' | 'UNSUPPORTED_MODE';
export type FinanceV2Check = Readonly<{ ok: true; page: FinanceV2Page }> | Readonly<{ ok: false; code: FinanceV2RefusalCode; path: string }>;
