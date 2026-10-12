export const badgeLabels = {
  unknown: 'Valuation: unknown', estimated: 'Valuation: estimated', confirmed: 'Valuation: confirmed',
  reconciled: 'Reconciliation: reconciled', unreconciled: 'Reconciliation: unresolved',
  partial: 'Coverage: partial', stale: 'Freshness: stale', restricted: 'Access: restricted',
  fixture: 'Evidence: synthetic fixture', sandbox: 'Evidence: sandbox', live: 'Evidence: live',
} as const;
export type BadgeState = keyof typeof badgeLabels;
export function StateBadge({ state }: { state: BadgeState }) {
  return <span className="td-badge">{typeof badgeLabels[state] === 'string' ? badgeLabels[state] : 'State unknown'}</span>;
}
