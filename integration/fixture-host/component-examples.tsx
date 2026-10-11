import { useEffect } from 'react';
import { AmountText, MetricCard, StateBadge, ScopeContext, FilterSelect, Pagination, DataTable, BreakdownChart, BoundaryState, EvidenceLink, ReturnToResults, type EvidencePolicy, type TableSort } from '@jevelopers/team-dashboard';
import type { ResolvedRoute } from '@jevelopers/team-dashboard/integration';
import { syntheticNotice, exactSamples, sampleRows, sampleColumns, chartSamples } from '../../tests/fixtures/td10-display';
export function ComponentExamples({ route, navigate, sample, onSampleChange, page, onPageChange, sort, onSort, returnToResults, restoreFocus }: {
  route: ResolvedRoute; navigate: (href: string) => void; sample: string; onSampleChange: (value: string) => void;
  page: string; onPageChange: (direction: 'previous' | 'next') => void; sort: TableSort; onSort: (value: TableSort) => void;
  returnToResults: (href: string) => void; restoreFocus: boolean;
}) {
  const policy: EvidencePolicy = { origin: window.location.origin, allowedOrigins: [], allowedPathPrefixes: ['/admin/finance'], allowedQueryKeys: ['examples', 'sample', 'page'] };
  useEffect(() => {
    if (!restoreFocus || route.id !== 'transactions') return;
    const frame = requestAnimationFrame(() => document.getElementById('td10-negative-link')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [restoreFocus, route.id]);
  const rows = sample === 'none' ? [] : sample === 'negative' ? sampleRows.filter((row) => row.id === 'negative') : page === '2' ? sampleRows.slice(2) : sampleRows.slice(0, 2);
  const orderedRows = sort.direction === 'descending' ? [...rows].reverse() : rows;
  const detail = route.id === 'transaction-detail' || route.id === 'event-detail';
  return <div className="td-component-stack">
    <section className="td-example-section"><h2>Component examples</h2><p>{syntheticNotice}</p><StateBadge state="fixture" /></section>
    <ScopeContext scope={{ status: 'available', projectLabel: 'Synthetic project / no customer data', periodLabel: 'Fixed UI sample period', currencyLabel: 'USD and EUR displayed separately' }} />
    {detail ? <section className="td-example-section"><h2>Synthetic record detail</h2><AmountText amount={route.params.id === 'subcent-ui-sample' ? exactSamples.subcent! : exactSamples.negative!} /><p>Display-only example. No authoritative record was loaded.</p><ReturnToResults href="/admin/finance/transactions" policy={policy} onNavigate={returnToResults} /></section> : <>
      <div className="td-controls"><FilterSelect label="Display sample" value={sample} options={[{ value: 'all', label: 'All display samples' }, { value: 'negative', label: 'Negative example' }, { value: 'none', label: 'No matches example' }]} onChange={onSampleChange} description="Changes synthetic examples only." />
        <EvidenceLink evidence={{ status: 'permitted', href: '/admin/finance/transactions', label: 'View synthetic record examples' }} policy={policy} onNavigate={navigate} />
        <EvidenceLink evidence={{ status: 'permitted', href: '/admin/finance/reports', label: 'View synthetic report preview' }} policy={policy} onNavigate={navigate} />
      </div>
      <div className="td-metrics"><MetricCard title="Synthetic exact zero" amount={exactSamples.zero!} states={['confirmed', 'fixture']} /><MetricCard title="Synthetic negative display" amount={exactSamples.negative!} states={['estimated', 'unreconciled', 'fixture']} /><MetricCard title="Synthetic sub-cent display" amount={exactSamples.subcent!} states={['confirmed', 'reconciled', 'fixture']} /><MetricCard title="Synthetic unknown" amount={{ status: 'unknown' }} states={['unknown', 'partial', 'stale']} /></div>
      <DataTable caption="Synthetic records — display examples" columns={sampleColumns} rows={orderedRows} sort={sort} onSort={onSort} linkPolicy={policy} onNavigate={navigate} />
      <Pagination pageLabel={sample === 'all' ? `Synthetic page ${page} — total count unavailable` : 'Filtered synthetic examples — total count unavailable'} hasPrevious={sample === 'all' && page === '2'} hasNext={sample === 'all' && page !== '2'} onNavigate={onPageChange} />
      <BreakdownChart title="Synthetic category display" items={sample === 'none' ? [] : chartSamples} />
      {route.id === 'reports' || route.id === 'exports' ? <section className="td-example-section"><h2>Synthetic report preview</h2><p>Presentation example only. No report file, export or financial total is generated.</p><ReturnToResults href="/admin/finance/transactions" policy={policy} onNavigate={returnToResults} /></section> : null}
      {route.id === 'overview' && <section className="td-component-stack" aria-label="Boundary examples"><h2>Boundary examples</h2>{(['loading', 'empty', 'error', 'restricted', 'unavailable'] as const).map((status) => <BoundaryState key={status} state={status === 'error' ? { status, retryable: false } : { status }} />)}</section>}
    </>}
  </div>;
}
