import type { HostAccess, ProjectionResult, RouteProvider, RouteState, SummaryProjection } from '../../src';
/**
 * SYNTHETIC summary fixtures for the overview route, selected only by an explicit `?summary=` fixture-mode parameter.
 * They are shaped like adapter output, are not producer or Finance packet data, carry no real amounts, and never come
 * from a real route provider. Metric names are arbitrary producer-style labels, with no spend/budget alias.
 */
export const summaryFixtureNames = ['ready', 'partial', 'stale', 'unknown', 'missing', 'restricted', 'refused', 'unsupported'] as const;
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
const unknownMetric = { amount: { status: 'unknown' }, definition: { id: 'synthetic-definition-u', revision: 1 }, sourceCount: 1 } as const;
/** `refuse` is the packaged `refuseUnsupportedPacket`, injected so this module stays type-only against src. */
export function summaryFixture(name: SummaryFixtureName, refuse: (manifest: unknown) => ProjectionResult<SummaryProjection> | undefined): ProjectionResult<SummaryProjection> {
  switch (name) {
    case 'ready': return { status: 'ready', authority, data: synthetic() };
    case 'partial': return { status: 'ready', authority, data: synthetic({ axes: { valuation: 'estimated', settlement: 'unpaid', reconciliation: 'unmatched', reservation: 'held', completeness: 'incomplete' }, coverage: { observed: 1, expected: null, missingSources: ['synthetic-source-b'] }, badges: ['fixture', 'estimated', 'unreconciled', 'partial'] }) };
    case 'stale': return { status: 'stale', authority, ageMs: 7_200_000, data: synthetic({ badges: ['fixture', 'estimated', 'unreconciled', 'stale'] }) };
    case 'unknown': return { status: 'ready', authority, data: synthetic({ metrics: { 'synthetic.metric_u': unknownMetric }, requested: { 'synthetic.metric_u': { status: 'unknown' } }, missingMetrics: [] }) };
    case 'missing': return { status: 'missing', authority };
    case 'restricted': return { status: 'restricted', authority };
    case 'refused': return { status: 'refused', authority, code: 'CONTRACT_REFUSED', path: '/synthetic' };
    case 'unsupported': return refuse({ canonicalReferences: { packageVersion: '0.3.0', schemaVersion: '1.0.0', adoptionAccepted: false } })!;
  }
}
export const fixtureStates = ['unavailable', 'loading', 'empty', 'error', 'restricted', 'ready'] as const;
export type FixtureState = (typeof fixtureStates)[number];
export const authorizedFixture: HostAccess = { status: 'authorized', scope: { tenantId: 'fixture-tenant', projectId: 'fixture-project' }, revision: 'td01-fixture-v1' };
export function fixtureProvider(state: FixtureState): RouteProvider<{ text: string }> {
  return { mode: 'fixture', readRoute: ({ signal }) => {
    if (state === 'loading') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled fixture')), { once: true }));
    const result: RouteState<{ text: string }> = state === 'ready' ? { status: 'ready', data: { text: 'Read-only extension fixture. This contains no financial records.' } } : state === 'error' ? { status: 'error', retryable: true } : { status: state };
    return Promise.resolve(result);
  } };
}
