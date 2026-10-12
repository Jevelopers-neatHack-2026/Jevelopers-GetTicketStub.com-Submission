import type { FinanceWrapperMetadata, HostAccess, PacketMode, PacketOutcome, ProjectionResult, RouteProvider, RouteState, SummaryProjection, TrustedPacketExpectation } from '../../src';
/**
 * SYNTHETIC summary fixtures for the overview route, selected only by an explicit `?summary=` fixture-mode parameter.
 * They are shaped like adapter output, are not producer or Finance packet data, carry no real amounts, and never come
 * from a real route provider. Metric names are arbitrary producer-style labels, with no spend/budget alias.
 */
export const summaryFixtureNames = ['ready', 'partial', 'stale', 'unknown', 'missing', 'restricted', 'refused', 'unsupported', 'digest-mismatch', 'missing-references'] as const;
export type SummaryFixtureName = (typeof summaryFixtureNames)[number];
export const syntheticProjectLabel = 'SYNTHETIC FIXTURE project (not real data)';
const authority = 'read_only_projection' as const;
const synthetic = (over: Partial<SummaryProjection> = {}): SummaryProjection => ({
  summaryId: 'synthetic-summary', revision: 1, period: { start: '2026-10-01T00:00:00Z', end: '2026-10-08T00:00:00Z' }, currency: 'USD', scale: 6,
  partition: { environment: 'test', billingMode: 'simulated' },
  axes: { valuation: 'estimated', settlement: 'unpaid', reconciliation: 'unmatched', reservation: 'held', completeness: 'complete' },
  coverage: { observed: 2, expected: 2, missingSources: [] },
  metrics: { 'synthetic.metric_a': { amount: { status: 'available', text: '0.000007', currency: 'USD' }, definition: { id: 'synthetic-definition-a', revision: 1 }, sourceCount: 2 } },
  missingMetrics: ['synthetic.metric_missing'],
  requested: { 'synthetic.metric_a': { status: 'available', text: '0.000007', currency: 'USD' }, 'synthetic.metric_missing': { status: 'unavailable' } },
  badges: ['fixture', 'estimated', 'unreconciled'],
  observedAt: '2026-10-08T00:05:00Z', ingestedAt: '2026-10-08T00:06:00Z', producerRevision: 'synthetic-producer-revision', ...over,
});
/** A producer-unknown metric cannot sit under `complete` coverage, so the unknown fixture is incomplete with unknown expected sources and the partial badge, as in `partial`. */
const incompleteUnknownCoverage: Partial<SummaryProjection> = { axes: { valuation: 'estimated', settlement: 'unpaid', reconciliation: 'unmatched', reservation: 'held', completeness: 'incomplete' }, coverage: { observed: 1, expected: null, missingSources: ['synthetic-source-b'] }, badges: ['fixture', 'estimated', 'unreconciled', 'partial'] };
const unknownMetric = { amount: { status: 'unknown' }, definition: { id: 'synthetic-definition-u', revision: 1 }, sourceCount: 1 } as const;
/** Schema digest recorded by the independent 2026-10-12 mechanical review (FinancialSummary 1.0.0, byte-identical in Finance 0.3.0 and Dashboard 0.9.7). A development binding for these fixtures, not an acceptance. */
const reviewedSchemaSha256 = '8d73d97e86d0684ccbb84fc1838de9d7802438966be60bd1f2da3347833067d9';
/** Host-held expectation for packet fixtures. It holds no references on purpose: none are invented, so no packet fixture can reach the eligible outcome here. */
const trustedExpectation: TrustedPacketExpectation = { schemaSha256: reviewedSchemaSha256, summaryDigest: 'synthetic-summary-digest', references: {} };
const packetManifest = (over: { schemaVersion?: string; sha256?: string } = {}) => ({
  canonicalReferences: { status: 'proposal_only', adoptionAccepted: false, packageVersion: '0.3.0', schemaVersion: over.schemaVersion ?? '1.0.0',
    schemas: [{ contract: 'FinancialSummary', schemaVersion: '1.0.0', sha256: over.sha256 ?? reviewedSchemaSha256 }] },
  financeAcknowledgment: null, dashboardAcknowledgment: null,
});
/** Synthetic Finance response-envelope metadata, kept apart from the summary. Not Finance output. */
const syntheticWrapper: FinanceWrapperMetadata = { asOf: '2026-10-08T00:05:00Z', timezone: 'UTC', watermark: 'synthetic-watermark', queryContentHash: 'synthetic-query-hash', pagination: { cursor: null } };
// `queryContentHash` and `pagination` above are deliberately outside the allowed shape, so the fixture also shows the withheld notice.
export type SummaryFixture = Readonly<{ result: ProjectionResult<SummaryProjection>; wrapper?: FinanceWrapperMetadata }>;
/** `evaluate` is the packaged `evaluateFinancePacket`, injected so this module stays type-only against src. */
export function summaryFixture(name: SummaryFixtureName, evaluate: (manifest: unknown, trusted: TrustedPacketExpectation, mode: PacketMode) => PacketOutcome): SummaryFixture {
  const gated = (manifest: unknown): SummaryFixture => { const packet = evaluate(manifest, trustedExpectation, 'synthetic_development'); return { result: packet.outcome === 'refused' ? packet.result : { status: 'unknown', authority } }; };
  switch (name) {
    case 'ready': return { result: { status: 'ready', authority, data: synthetic() }, wrapper: syntheticWrapper };
    case 'partial': return { result: { status: 'ready', authority, data: synthetic(incompleteUnknownCoverage) } };
    case 'stale': return { result: { status: 'stale', authority, ageMs: 7_200_000, data: synthetic({ badges: ['fixture', 'estimated', 'unreconciled', 'stale'] }) } };
    case 'unknown': return { result: { status: 'ready', authority, data: synthetic({ ...incompleteUnknownCoverage, metrics: { 'synthetic.metric_u': unknownMetric }, requested: { 'synthetic.metric_u': { status: 'unknown' } }, missingMetrics: [] }) } };
    case 'missing': return { result: { status: 'missing', authority } };
    case 'restricted': return { result: { status: 'restricted', authority } };
    case 'refused': return { result: { status: 'refused', authority, code: 'CONTRACT_REFUSED', path: '/synthetic' } };
    case 'unsupported': return gated(packetManifest({ schemaVersion: '2.0.0' }));
    case 'digest-mismatch': return gated(packetManifest({ sha256: '0'.repeat(64) }));
    case 'missing-references': return gated(packetManifest());
  }
}
/** SYNTHETIC_PROPOSAL Finance v2 fixtures (data only, typed against the frozen unaccepted proposal). The views come from the packed package. */
export { financeV2Fixture, financeV2FixtureNames, FROZEN_PROPOSAL_PROVENANCE, type FinanceV2FixtureName } from '../../src/views/finance-v2/fixtures';
export const fixtureStates =['unavailable', 'loading', 'empty', 'error', 'restricted', 'ready'] as const;
export type FixtureState = (typeof fixtureStates)[number];
export const authorizedFixture: HostAccess = { status: 'authorized', scope: { tenantId: 'fixture-tenant', projectId: 'fixture-project' }, revision: 'td01-fixture-v1' };
export function fixtureProvider(state: FixtureState): RouteProvider<{ text: string }> {
  return { mode: 'fixture', readRoute: ({ signal }) => {
    if (state === 'loading') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled fixture')), { once: true }));
    const result: RouteState<{ text: string }> = state === 'ready' ? { status: 'ready', data: { text: 'Read-only extension fixture. This contains no financial records.' } } : state === 'error' ? { status: 'error', retryable: true } : { status: state };
    return Promise.resolve(result);
  } };
}
