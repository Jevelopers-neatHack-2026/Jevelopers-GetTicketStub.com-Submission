export type ScopeDisplay = Readonly<{ status: 'available'; projectLabel: string; periodLabel: string; currencyLabel: string }> | Readonly<{ status: 'restricted' | 'unavailable' }>;
export function ScopeContext({ scope }: { scope: ScopeDisplay }) {
  return <section className="td-scope" aria-label="Financial scope">{scope.status === 'available' ? <dl><div><dt>Project</dt><dd>{scope.projectLabel}</dd></div><div><dt>Period</dt><dd>{scope.periodLabel}</dd></div><div><dt>Currency</dt><dd>{scope.currencyLabel}</dd></div></dl> : <p>{scope.status === 'restricted' ? 'Scope restricted' : 'Scope unavailable'}</p>}</section>;
}
