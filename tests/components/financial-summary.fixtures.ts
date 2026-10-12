import type { AmountDisplay } from '../../src/components/AmountText';
import type { ContractKit, ContractScope, ProjectionResult, SummaryProjection } from '../../src/data/shared-contracts-adapter';
/**
 * SYNTHETIC UI fixtures shaped like adapter output. They are not producer fixtures, not Finance packet data, and carry
 * no real amounts. Metric names are arbitrary producer-style names chosen to avoid any spend/budget vocabulary.
 */
const authority = 'read_only_projection' as const;
export const projection = (over: Partial<SummaryProjection> = {}): SummaryProjection => ({
  summaryId: 'summary-ui-fixture', revision: 3, period: { start: '2026-10-01T00:00:00Z', end: '2026-10-08T00:00:00Z' }, currency: 'USD', scale: 6,
  partition: { environment: 'test', billingMode: 'simulated' },
  axes: { valuation: 'estimated', settlement: 'unpaid', reconciliation: 'unmatched', reservation: 'held', completeness: 'incomplete' },
  coverage: { observed: 2, expected: null, missingSources: ['ui-source-b'] },
  metrics: Object.assign(Object.create(null), {
    'expense.effective': { amount: { status: 'available', text: '0.000007', currency: 'USD' }, definition: { id: 'definition-ui-expense', revision: 4 }, sourceCount: 2 },
    'expense.provider_unbilled': { amount: { status: 'unknown' }, definition: { id: 'definition-ui-unbilled', revision: 1 }, sourceCount: 1 },
  }),
  missingMetrics: [], requested: Object.assign(Object.create(null), {}),
  badges: ['fixture', 'estimated', 'unreconciled', 'partial'],
  observedAt: '2026-10-08T00:05:00Z', ingestedAt: '2026-10-08T00:06:00Z', producerRevision: 'producer-revision-ui-fixture',
  ...over,
});
export const requestedOf = (data: SummaryProjection, names: readonly string[]): SummaryProjection => {
  const requested: Record<string, AmountDisplay> = Object.create(null), missing: string[] = [];
  for (const name of names) { if (Object.hasOwn(data.metrics, name)) requested[name] = data.metrics[name]!.amount; else { requested[name] = { status: 'unavailable' }; missing.push(name); } }
  return { ...data, requested, missingMetrics: missing };
};
export const ready = (data: SummaryProjection = projection()): ProjectionResult<SummaryProjection> => ({ status: 'ready', authority, data });
export const stale = (data: SummaryProjection = projection()): ProjectionResult<SummaryProjection> => ({ status: 'stale', authority, data: { ...data, badges: [...data.badges, 'stale'] }, ageMs: 7_200_000 });

/** Adapter wiring only: this stub accepts whatever it is given. Real validation is covered by `npm run test:contracts`. */
export const stubKit: ContractKit = {
  parseContractVersion: (_contract, _version, text) => ({ ok: true, value: JSON.parse(text) }),
  checkTrustedContext: () => ({ ok: true, value: undefined }),
  checkFinancialSummary: () => ({ ok: true, value: undefined }),
  hashManifest: () => 'sha256:stub',
};
export const stubScope: ContractScope = { tenantId: 'tenant-ui', projectId: 'project-ui', environment: 'test', billingMode: 'simulated' };
export const wirePayload = () => ({
  summary_id: 'summary-wire', revision: 1, period: { start: '2026-10-01T00:00:00Z', end: '2026-10-08T00:00:00Z' }, currency: 'USD', scale: 6,
  environment: 'test', billing_mode: 'simulated', valuation_basis: 'estimated', settlement: 'unpaid', reconciliation: 'unmatched', reservation_state: 'held', completeness: 'complete',
  coverage: { observed: 1, expected: 1, missing_sources: [] },
  metrics: {
    'expense.effective': { status: 'known', value: { amount: '0.000003', currency: 'USD' }, definition_ref: { id: 'definition-wire', revision: 2 }, source_refs: [{}] },
    'expense.unbilled': { status: 'unknown', definition_ref: { id: 'definition-wire-unknown', revision: 1 }, source_refs: [] },
  },
  observed_at: '2026-10-08T00:05:00Z', ingested_at: '2026-10-08T00:06:00Z', producer: { source_revision: 'wire-producer-rev' },
});
