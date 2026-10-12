import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard, FinancialSummaryView, FinanceV2ConnectedView, evaluateFinancePacket, type FinanceV2ViewName, type TableSort } from '@jevelopers/team-dashboard';
import { routeHref } from '@jevelopers/team-dashboard/integration';
import '@jevelopers/team-dashboard/style.css';
import { ComponentExamples } from './component-examples';
import { fixtureFinanceV2Port, portBehaviors, type FixturePortLog, type PortBehavior } from './finance-v2-port';
import { syntheticPagedMisbehaviors, syntheticPagedPort, type SyntheticPagedLog, type SyntheticPagedScript } from './finance-v2-paged';
import { capturedForeignProjectId, capturedGrants, capturedPaginationPort, capturedTampers, type CapturedGrant, type CapturedPortLog, type CapturedTamper } from './finance-v2-captured';
import { authorizedFixture, fixtureProvider, fixtureStates, summaryFixture, summaryFixtureNames, syntheticProjectLabel, type FixtureState, type SummaryFixtureName } from './host';
import { hostFixture, hostFixtureNames, type HostFixtureName } from './conformance';
const params = new URLSearchParams(window.location.search);
const requestedSummary = params.get('summary');
const summaryName = summaryFixtureNames.find((name) => name === requestedSummary) as SummaryFixtureName | undefined;
/** Explicit SYNTHETIC_PROPOSAL fixture mode for the Finance v2 views: `?v2=<fixture>` on the budgets, ai-costs, transactions and transaction detail routes only. */
const requestedV2 = params.get('v2');
const v2Name = hostFixtureNames.find((name) => name === requestedV2) as HostFixtureName | undefined;
/** Fixture-host-only scripting of the injected read port: `v2port=<behavior>` (or `none` for no port), `v2mode=integrated`, `v2timeout=<ms>`. */
const requestedBehavior = params.get('v2port');
const noV2Port = requestedBehavior === 'none';
const v2Behavior: PortBehavior = portBehaviors.find((name) => name === requestedBehavior) ?? 'ok';
const v2Integrated = params.get('v2mode') === 'integrated';
const v2Timeout = Number(params.get('v2timeout')) > 0 ? Number(params.get('v2timeout')) : undefined;
const v2Log: FixturePortLog = { calls: [] };
(window as unknown as { __financeV2PortLog: FixturePortLog }).__financeV2PortLog = v2Log;
/**
 * `v2port=paged` serves the HAND-AUTHORED synthetic three-page transaction chain (not Finance output, not producer pages). `v2p1`..`v2p3` script one deviation for page 1..3:
 * a misbehavior name, `slow` (a late answer that ignores the abort signal) or `fault<status>`.
 */
const pagedLog: SyntheticPagedLog = { requests: [] };
(window as unknown as { __financeV2PagedLog: SyntheticPagedLog }).__financeV2PagedLog = pagedLog;
/**
 * `v2port=captured` (with `v2=conformance-pagination`) serves the ACTUAL captured producer chain (SYNTHETIC_CONFORMANCE_ONLY) by looking up the recorded answer to the exact query: `v2grant=denied|stale|revoked`
 * replays the recorded current-grant refusals, `v2tamper=period|filters|version` the recorded snapshot-binding refusals, `v2scope=foreign` the recorded foreign scope, `v2size` a page size and
 * `v2delay=<ms>` a late continuation that ignores the abort signal. The first page size is the host's own trusted 2.
 */
const capturedLog: CapturedPortLog = { reads: [] };
(window as unknown as { __financeV2CapturedLog: CapturedPortLog }).__financeV2CapturedLog = capturedLog;
const capturedGrant = capturedGrants.find((name) => name === params.get('v2grant')) as CapturedGrant | undefined;
const capturedTamper = capturedTampers.find((name) => name === params.get('v2tamper')) as CapturedTamper | undefined;
const capturedDelay = Number(params.get('v2delay')) > 0 ? Number(params.get('v2delay')) : undefined;
const pagedMode = requestedBehavior === 'paged' || requestedBehavior === 'captured';
function pagedScript(): SyntheticPagedScript {
  const script: SyntheticPagedScript = {};
  ([0, 1, 2] as const).forEach((index) => {
    const value = params.get(`v2p${index + 1}`) ?? '';
    const fault = /^fault(\d{3})$/u.exec(value);
    if (fault) script[index] = { fault: Number(fault[1]) };
    else if (value === 'slow') script[index] = 'slow';
    else { const known = syntheticPagedMisbehaviors.find((name) => name === value); if (known) script[index] = known; }
  });
  return script;
}
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
  const [v2Revision, setV2Revision] = useState(1);
  const [v2Actor, setV2Actor] = useState<'a' | 'b'>('a');
  const [v2Token, setV2Token] = useState(true);
  const [v2Available, setV2Available] = useState(true);
  // The token seam is stable until the token or its revision changes, and the host bumps the revision whenever the token changes.
  const v2Authorization = useMemo(() => ({ revision: String(v2Revision), token: async () => (v2Token ? `fixture-token-${v2Revision}` : null) }), [v2Revision, v2Token]);
  const v2Port = useMemo(() => v2Name && !noV2Port ? (requestedBehavior === 'captured'
    ? capturedPaginationPort({ ...(capturedGrant ? { grant: capturedGrant } : {}), ...(capturedTamper ? { tamper: capturedTamper } : {}), ...(capturedDelay ? { delayContinuationMs: capturedDelay } : {}), log: capturedLog })
    : requestedBehavior === 'paged' ? syntheticPagedPort(pagedScript(), pagedLog) : fixtureFinanceV2Port(v2Name, v2Behavior, v2Log)) : undefined, []);
  // The cursor lives in the host's own URL as request metadata only. It is read once on load; the dashboard still binds every answer to the host's scope, snapshot and hashes, and a
  // URL cursor alone is never authority. replaceState keeps Back from walking through pages: leaving the page is the host's Back, Previous page is the dashboard's.
  const keepCursor = (cursor: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (cursor === null) next.delete('cursor'); else next.set('cursor', cursor);
    window.history.replaceState(null, '', window.location.pathname + (next.toString() ? `?${next.toString()}` : ''));
    setQuery(window.location.search);
  };
  const [connected, setConnected] = useState(params.get('provider') !== 'missing');
  const provider = useMemo(() => fixtureProvider(state), [state]);
  useEffect(() => { const update = () => { setPathname(window.location.pathname); setQuery(window.location.search); setRestoreFocus(false); }; window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  return <>
    <aside aria-label="Offline fixture controls" style={{ fontFamily: 'system-ui', padding: '1rem', background: '#F4ECDD', color: '#17140F', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
      <strong>Development fixture only</strong>
      <label>Boundary state <select value={state} onChange={(event) => setState(event.target.value as FixtureState)}>{fixtureStates.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><input type="checkbox" checked={authenticated} onChange={(event) => setAuthenticated(event.target.checked)} /> Fixture auth grant</label>
      <label><input type="checkbox" checked={connected} onChange={(event) => setConnected(event.target.checked)} /> Fixture read port</label>
      {v2Name && !examples && <>
        <button type="button" onClick={() => setV2Revision((value) => value + 1)}>Bump Finance v2 authorization revision ({v2Revision})</button>
        <label>Finance v2 actor <select value={v2Actor} onChange={(event) => setV2Actor(event.target.value as 'a' | 'b')}><option value="a">actor a</option><option value="b">actor b</option></select></label>
        <label><input type="checkbox" checked={v2Token} onChange={(event) => { setV2Token(event.target.checked); setV2Revision((value) => value + 1); }} /> Finance v2 host token</label>
        <label><input type="checkbox" checked={v2Available} onChange={(event) => setV2Available(event.target.checked)} /> Finance v2 host available</label>
      </>}
    </aside>
    <main><Dashboard basePath={configuredBase} pathname={pathname} navigate={navigate}
      access={authenticated ? authorizedFixture : { status: 'restricted' }} provider={connected ? provider : undefined}
      renderRoute={({ data, route }) => v2Name && !examples && Object.hasOwn(v2Views, route.id) ? (() => {
        const fixture = hostFixture(v2Name);
        // The URL query is the durable context: fixture, boundary state and transaction filters. Detail and return hrefs carry all of it, so reload, deep link and Back keep the same snapshot and filters.
        const context = search.toString() ? `?${search.toString()}` : '';
        const filters = { valuation: search.get('valuation') ?? 'all', currency: search.get('currency') ?? 'all' };
        const changeFilters = (next: { valuation: string; currency: string }) => {
          const params = new URLSearchParams(window.location.search);
          for (const [key, value] of Object.entries(next)) { if (value === 'all') params.delete(key); else params.set(key, value); }
          navigate(window.location.pathname + (params.toString() ? `?${params.toString()}` : ''));
        };
        const actorScope = v2Actor === 'a' ? fixture.expectedScope : { ...fixture.expectedScope, actorId: 'account:synthetic-actor-b' };
        const scope = params.get('v2scope') === 'foreign' ? { ...actorScope, projectId: capturedForeignProjectId } : actorScope;
        const shared = { view: v2Views[route.id]!, availability: v2Available ? { status: 'available' } as const : { status: 'refused', reason: 'restricted' } as const, scope, authorization: v2Authorization,
          expectedSnapshotId: fixture.expectedSnapshotId, expectedQueryContentHash: fixture.expectedQueryContentHash, expectedSummaryContentHash: fixture.expectedSummaryContentHash,
          ...(fixture.expectedReferences ? { expectedReferences: fixture.expectedReferences } : {}),
          ...(v2Timeout ? { timeoutMs: v2Timeout } : {}),
          // An empty `?cursor=` is still a cursor (a malformed one): it is passed on and refused before any read, never silently turned into a first-page read.
          // The cursor is read from the LIVE URL each time this route mounts (so Back to a page keeps its cursor); the view still reads it once per mount and treats it as a request parameter only.
          ...(pagedMode ? { onCursorChange: keepCursor, ...(search.get('cursor') !== null ? { initialCursor: search.get('cursor')! } : {}), ...(params.get('v2size') ? { pageSize: Number(params.get('v2size')) } : requestedBehavior === 'captured' ? { pageSize: 2 } : {}) } : {}),
          ...(route.params.id ? { detailId: route.params.id } : {}), detailHref: (id: string) => routeHref(configuredBase, 'transaction-detail', { id }) + context, listHref: routeHref(configuredBase, 'transactions') + context,
          onNavigate: navigate, filters, onFiltersChange: changeFilters };
        return v2Integrated ? <FinanceV2ConnectedView mode="INTEGRATED" {...shared} /> : <FinanceV2ConnectedView mode="SYNTHETIC_PROPOSAL" {...shared} {...(v2Port ? { port: v2Port } : {})} />;
      })() : summaryName && route.id === 'overview' && !examples ? <>
        <p role="note"><strong>SYNTHETIC FIXTURE</strong>: offline development data shaped like adapter output. Not real Finance data; the actual Finance summary route is unavailable until the accepted handoff.</p>
        <FinancialSummaryView {...summaryFixture(summaryName, evaluateFinancePacket)} projectLabel={syntheticProjectLabel} />
      </> : examples ?<ComponentExamples route={route} navigate={navigate} sample={search.get('sample') ?? 'all'} onSampleChange={(value) => changeSample('sample', value)} page={search.get('page') === '2' ? '2' : '1'} onPageChange={(direction) => changeSample('page', direction === 'next' ? '2' : '1')} sort={sort} onSort={setSort} returnToResults={(href) => navigate(href, true)} restoreFocus={restoreFocus} returnFocusId={returnFocusId} /> : <section><h2>Connected read-only extension</h2><p>{data.text}</p></section>} /></main>
  </>;
}
createRoot(document.getElementById('root')!).render(<FixtureHost />);
