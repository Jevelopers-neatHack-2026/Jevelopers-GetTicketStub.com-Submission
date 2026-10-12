import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard, FinancialSummaryView, FinanceV2View, evaluateFinancePacket, type FinanceV2ViewName, type TableSort } from '@jevelopers/team-dashboard';
import { routeHref } from '@jevelopers/team-dashboard/integration';
import '@jevelopers/team-dashboard/style.css';
import { ComponentExamples } from './component-examples';
import { authorizedFixture, financeV2Fixture, financeV2FixtureNames, fixtureProvider, fixtureStates, summaryFixture, summaryFixtureNames, syntheticProjectLabel, type FinanceV2FixtureName, type FixtureState, type SummaryFixtureName } from './host';
const params = new URLSearchParams(window.location.search);
const requestedSummary = params.get('summary');
const summaryName = summaryFixtureNames.find((name) => name === requestedSummary) as SummaryFixtureName | undefined;
/** Explicit SYNTHETIC_PROPOSAL fixture mode for the Finance v2 views: `?v2=<fixture>` on the budgets, ai-costs, transactions and transaction detail routes only. */
const requestedV2 = params.get('v2');
const v2Name = financeV2FixtureNames.find((name) => name === requestedV2) as FinanceV2FixtureName | undefined;
const v2Views: Readonly<Record<string, FinanceV2ViewName>> = { budgets: 'budget', 'ai-costs': 'breakdown', transactions: 'transactions', 'transaction-detail': 'transaction-detail' };
const configuredBase = params.get('base') ?? '/admin/finance';
const examples = params.get('examples') === 'components';
const initialState = params.get('state') ?? (examples ? 'ready' : null);
function FixtureHost() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [query, setQuery] = useState(window.location.search);
  const [sort, setSort] = useState<TableSort>({ key: 'record', direction: 'ascending' });
  const [restoreFocus, setRestoreFocus] = useState(false);
  const [originLink, setOriginLink] = useState<{ path: string; id: string }>();
  const [returnFocusId, setReturnFocusId] = useState<string>();
  const search = new URLSearchParams(query);
  function navigate(href: string, restore = false) {
    const target = new URL(href, window.location.origin);
    if (target.pathname.includes('/transactions/')) {
      const active = document.activeElement;
      setOriginLink(active instanceof HTMLAnchorElement && active.id && new URL(active.href).pathname === target.pathname ? { path: target.pathname, id: active.id } : undefined);
    }
    if (restore) setReturnFocusId(originLink?.path === window.location.pathname ? originLink.id : undefined);
    window.history.pushState(null, '', target.pathname + (target.search || window.location.search));
    setPathname(window.location.pathname); setQuery(window.location.search); setRestoreFocus(restore);
  }
  function changeSample(key: string, value: string) { const next = new URLSearchParams(window.location.search); next.set(key, value); if (key === 'sample') next.set('page', '1'); navigate(window.location.pathname + '?' + next.toString()); }

  const [state, setState] = useState<FixtureState>(fixtureStates.includes(initialState as FixtureState) ? initialState as FixtureState : 'unavailable');
  const [authenticated, setAuthenticated] = useState(params.get('auth') !== 'missing');
  const [connected, setConnected] = useState(params.get('provider') !== 'missing');
  const provider = useMemo(() => fixtureProvider(state), [state]);
  useEffect(() => { const update = () => { setPathname(window.location.pathname); setQuery(window.location.search); setRestoreFocus(false); }; window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  return <>
    <aside aria-label="Offline fixture controls" style={{ fontFamily: 'system-ui', padding: '1rem', background: '#F4ECDD', color: '#17140F', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
      <strong>Development fixture only</strong>
      <label>Boundary state <select value={state} onChange={(event) => setState(event.target.value as FixtureState)}>{fixtureStates.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><input type="checkbox" checked={authenticated} onChange={(event) => setAuthenticated(event.target.checked)} /> Fixture auth grant</label>
      <label><input type="checkbox" checked={connected} onChange={(event) => setConnected(event.target.checked)} /> Fixture read port</label>
    </aside>
    <main><Dashboard basePath={configuredBase} pathname={pathname} navigate={navigate}
      access={authenticated ? authorizedFixture : { status: 'restricted' }} provider={connected ? provider : undefined}
      renderRoute={({ data, route }) => v2Name && !examples && Object.hasOwn(v2Views, route.id) ? (() => {
        const fixture = financeV2Fixture(v2Name);
        return <FinanceV2View mode="SYNTHETIC_PROPOSAL" view={v2Views[route.id]!} input={fixture.input} expectedScope={fixture.expectedScope} expectedSnapshotId={fixture.expectedSnapshotId}
          {...(route.params.id ? { detailId: route.params.id } : {})} detailHref={(id) => routeHref(configuredBase, 'transaction-detail', { id })} listHref={routeHref(configuredBase, 'transactions')} onNavigate={navigate} />;
      })() : summaryName && route.id === 'overview' && !examples ? <>
        <p role="note"><strong>SYNTHETIC FIXTURE</strong>: offline development data shaped like adapter output. Not real Finance data; the actual Finance summary route is unavailable until the accepted handoff.</p>
        <FinancialSummaryView {...summaryFixture(summaryName, evaluateFinancePacket)} projectLabel={syntheticProjectLabel} />
      </> : examples ?<ComponentExamples route={route} navigate={navigate} sample={search.get('sample') ?? 'all'} onSampleChange={(value) => changeSample('sample', value)} page={search.get('page') === '2' ? '2' : '1'} onPageChange={(direction) => changeSample('page', direction === 'next' ? '2' : '1')} sort={sort} onSort={setSort} returnToResults={(href) => navigate(href, true)} restoreFocus={restoreFocus} returnFocusId={returnFocusId} /> : <section><h2>Connected read-only extension</h2><p>{data.text}</p></section>} /></main>
  </>;
}
createRoot(document.getElementById('root')!).render(<FixtureHost />);
