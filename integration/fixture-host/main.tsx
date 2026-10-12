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
import { pagingState, restorePagingCursor, type PagingBinding } from './paging-context';
import { FINANCE_EXPORT, FINANCE_READ, createExportHostStore, exportBehaviors, exportConformancePort, exportConformanceReadPort, storeReader, withCapability, withoutCapability, type ExportBehavior, type ExportPortLog } from './finance-v2-export';
const params = new URLSearchParams(window.location.search);
/**
 * A raw `?cursor=` in the address is never a paging channel: it is not read, not passed to the view, not echoed and not copied into any href. It is removed from the address at once and the paged
 * transaction routes answer it with an explicit unsupported notice and no read. Paging position lives only in the validated private history context (`paging-context.ts`).
 */
const incomingCursorParam = params.has('cursor');
if (incomingCursorParam) {
  const clean = new URLSearchParams(window.location.search);
  clean.delete('cursor');
  window.history.replaceState(window.history.state, '', window.location.pathname + (clean.toString() ? `?${clean.toString()}` : ''));
}
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
/**
 * `v2=export-conformance` serves the synthetic `ready` page re-bound to the identity of the producer's ACTUAL candidate receipt 0 (SYNTHETIC_EXPORT_CONFORMANCE_ONLY) and, unless `v2export=none`,
 * injects an export port that replays that receipt's exact bytes (`v2export=<behavior>` scripts one labelled deviation). `v2access=none` withholds the host's own access reader. The access store
 * is held outside React and changed by the host's handlers before it re-renders, so `Revoke ... silently` is visible to the Dashboard's synchronous check without any render.
 */
const exportMode = v2Name === 'export-conformance';
const exportBehaviorName = exportBehaviors.find((name) => name === params.get('v2export')) as ExportBehavior | undefined;
const noExportPort = params.get('v2export') === 'none';
const noExportAccess = params.get('v2access') === 'none';
const exportLog: ExportPortLog = { requests: [] };
(window as unknown as { __financeV2ExportLog: ExportPortLog }).__financeV2ExportLog = exportLog;
const exportStore = createExportHostStore();
const exportReader = storeReader(exportStore);
/** A revocation that happens in the host while the Dashboard awaits: the store changes, nothing re-renders. */
function revokeExportSilently() { exportStore.access = withoutCapability(exportStore.access, FINANCE_EXPORT); }
function expireExportAccessSilently() { exportStore.access = { ...exportStore.access, expiresAt: '2020-01-01T00:00:00Z' }; }
function stepExportAccess(revision: string, change?: (access: typeof exportStore.access) => typeof exportStore.access) { exportStore.access = { ...(change ? change(exportStore.access) : exportStore.access), revision }; }
const v2Views: Readonly<Record<string, FinanceV2ViewName>> = { budgets: 'budget', 'ai-costs': 'breakdown', transactions: 'transactions', 'transaction-detail': 'transaction-detail' };
const configuredBase = params.get('base') ?? '/admin/finance';
const examples = params.get('examples') === 'components';
const initialState = params.get('state') ?? (examples ? 'ready' : null);
function FixtureHost() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [query, setQuery] = useState(window.location.search);
  const [sort, setSort] = useState<TableSort>({ key: 'record', direction: 'ascending' });
  const [restoreFocus, setRestoreFocus] = useState(false);
  const [cursorRejected, setCursorRejected] = useState(incomingCursorParam);
  const [generation, setGeneration] = useState(0);
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
    // Same-tab navigation to a transactions route carries the CURRENT validated private paging context into the new entry (never into the URL); the binding check still decides on use.
    window.history.pushState(target.pathname.includes('/transactions') ? window.history.state : null, '', target.pathname + (target.search || window.location.search));
    setCursorRejected(false);
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
  // The host's own handlers keep its access store in step with what it renders, BEFORE it re-renders; the Dashboard reads the store synchronously and never the React state.
  const bumpRevision = (change?: (access: typeof exportStore.access) => typeof exportStore.access) => {
    const next = v2Revision + 1;
    stepExportAccess(String(next), change);
    setV2Revision(next);
  };
  const fixtureActorScope = (actor: 'a' | 'b') => (actor === 'a' ? hostFixture(v2Name!).expectedScope : { ...hostFixture(v2Name!).expectedScope, actorId: 'account:synthetic-actor-b' });
  const [exportRead, setExportRead] = useState(true);
  const [exportCapability, setExportCapability] = useState(true);
  const exportPort = useMemo(() => exportMode && !noExportPort ? exportConformancePort(exportBehaviorName ?? 'ok', exportLog, revokeExportSilently) : undefined, []);
  const v2Port = useMemo(() => v2Name && !noV2Port ? (exportMode ? exportConformanceReadPort() : requestedBehavior === 'captured'
    ? capturedPaginationPort({ ...(capturedGrant ? { grant: capturedGrant } : {}), ...(capturedTamper ? { tamper: capturedTamper } : {}), ...(capturedDelay ? { delayContinuationMs: capturedDelay } : {}), log: capturedLog })
    : requestedBehavior === 'paged' ? syntheticPagedPort(pagedScript(), pagedLog) : fixtureFinanceV2Port(v2Name, v2Behavior, v2Log)) : undefined, []);
  // The cursor lives only in the host's private history state with its identity binding. It is read once per mount and the dashboard still binds every answer to the host's scope, snapshot and
  // hashes: a restored cursor alone is never authority. replaceState keeps Back from walking through pages: leaving the page is the host's Back, Previous page is the dashboard's.
  const keepCursor = (cursor: string | null, binding: PagingBinding) => { window.history.replaceState(pagingState(cursor, binding), '', window.location.pathname + window.location.search); };
  const [connected, setConnected] = useState(params.get('provider') !== 'missing');
  const provider = useMemo(() => fixtureProvider(state), [state]);
  useEffect(() => { const update = () => { setPathname(window.location.pathname); setQuery(window.location.search); setRestoreFocus(false); setGeneration((value) => value + 1); }; window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  return <>
    <aside aria-label="Offline fixture controls" style={{ fontFamily: 'system-ui', padding: '1rem', background: '#F4ECDD', color: '#17140F', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
      <strong>Development fixture only</strong>
      <label>Boundary state <select value={state} onChange={(event) => setState(event.target.value as FixtureState)}>{fixtureStates.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><input type="checkbox" checked={authenticated} onChange={(event) => setAuthenticated(event.target.checked)} /> Fixture auth grant</label>
      <label><input type="checkbox" checked={connected} onChange={(event) => setConnected(event.target.checked)} /> Fixture read port</label>
      {v2Name && !examples && <>
        <button type="button" onClick={() => bumpRevision()}>Bump Finance v2 authorization revision ({v2Revision})</button>
        <label>Finance v2 actor <select value={v2Actor} onChange={(event) => { const next = event.target.value as 'a' | 'b'; if (exportMode) bumpRevision((access) => ({ ...access, scope: fixtureActorScope(next) })); setV2Actor(next); }}><option value="a">actor a</option><option value="b">actor b</option></select></label>
        <label><input type="checkbox" checked={v2Token} onChange={(event) => { setV2Token(event.target.checked); bumpRevision(); }} /> Finance v2 host token</label>
        <label><input type="checkbox" checked={v2Available} onChange={(event) => setV2Available(event.target.checked)} /> Finance v2 host available</label>
        {exportMode && <>
          <label><input type="checkbox" checked={exportRead} onChange={(event) => { setExportRead(event.target.checked); bumpRevision((access) => (event.target.checked ? withCapability(access, FINANCE_READ) : withoutCapability(access, FINANCE_READ))); }} /> Dashboard read capability</label>
          <label><input type="checkbox" checked={exportCapability} onChange={(event) => { setExportCapability(event.target.checked); bumpRevision((access) => (event.target.checked ? withCapability(access, FINANCE_EXPORT) : withoutCapability(access, FINANCE_EXPORT))); }} /> Dashboard export capability</label>
          <button type="button" onClick={revokeExportSilently}>Revoke export capability silently</button>
          <button type="button" onClick={expireExportAccessSilently}>Expire host access silently</button>
        </>}
      </>}
    </aside>
    <main><Dashboard basePath={configuredBase} pathname={pathname} navigate={navigate}
      access={authenticated ? authorizedFixture : { status: 'restricted' }} provider={connected ? provider : undefined}
      renderRoute={({ data, route }) => v2Name && !examples && Object.hasOwn(v2Views, route.id) ? (() => {
        const fixture = hostFixture(v2Name);
        // The URL query is the durable context: fixture, boundary state and transaction filters. Detail and return hrefs carry all of it, so reload, deep link and Back keep the same snapshot and filters.
        const contextParams = new URLSearchParams(search); contextParams.delete('cursor');
        const context = contextParams.toString() ? `?${contextParams.toString()}` : '';
        const filters = { valuation: search.get('valuation') ?? 'all', currency: search.get('currency') ?? 'all' };
        const changeFilters = (next: { valuation: string; currency: string }) => {
          const params = new URLSearchParams(window.location.search);
          for (const [key, value] of Object.entries(next)) { if (value === 'all') params.delete(key); else params.set(key, value); }
          navigate(window.location.pathname + (params.toString() ? `?${params.toString()}` : ''));
        };
        const actorScope = v2Actor === 'a' ? fixture.expectedScope : { ...fixture.expectedScope, actorId: 'account:synthetic-actor-b' };
        const scope = params.get('v2scope') === 'foreign' ? { ...actorScope, projectId: capturedForeignProjectId } : actorScope;
        const pageSize = params.get('v2size') ? Number(params.get('v2size')) : requestedBehavior === 'captured' ? 2 : null;
        const binding: PagingBinding = { ...scope, snapshotId: fixture.expectedSnapshotId, queryContentHash: fixture.expectedQueryContentHash, summaryContentHash: fixture.expectedSummaryContentHash,
          revision: String(v2Revision), pageSize, valuation: filters.valuation, currency: filters.currency };
        const restoredCursor = pagedMode ? restorePagingCursor(window.history.state, binding) : undefined;
        const shared = { view: v2Views[route.id]!, availability: v2Available ? { status: 'available' } as const : { status: 'refused', reason: 'restricted' } as const, scope, authorization: v2Authorization,
          expectedSnapshotId: fixture.expectedSnapshotId, expectedQueryContentHash: fixture.expectedQueryContentHash, expectedSummaryContentHash: fixture.expectedSummaryContentHash,
          ...(fixture.expectedReferences ? { expectedReferences: fixture.expectedReferences } : {}),
          ...(v2Timeout ? { timeoutMs: v2Timeout } : {}),
          ...(exportMode && !noExportAccess ? { exportAccess: exportReader } : {}),
          // The private context is read when this route mounts (so Back to a page keeps its cursor); a stale, malformed or foreign one is simply absent here. The view reads it once per mount.
          ...(pagedMode ? { onCursorChange: (cursor: string | null) => keepCursor(cursor, binding), ...(restoredCursor !== undefined ? { initialCursor: restoredCursor } : {}), ...(pageSize !== null ? { pageSize } : {}) } : {}),
          ...(route.params.id ? { detailId: route.params.id } : {}), detailHref: (id: string) => routeHref(configuredBase, 'transaction-detail', { id }) + context, listHref: routeHref(configuredBase, 'transactions') + context,
          onNavigate: navigate, filters, onFiltersChange: changeFilters };
        if (pagedMode && cursorRejected && !v2Integrated) return <section className="td-component-stack" aria-labelledby="cursor-rejected-title"><h2 id="cursor-rejected-title">Address paging is not supported</h2>
          <section className="td-example-section" role="alert"><h3>Report not read</h3><p>A paging value in the address is not supported and was not used. Paging position is held privately by the host, so no report was read for this address and no amounts are shown.</p>
            <button type="button" onClick={() => setCursorRejected(false)}>Open the first page</button></section></section>;
        const viewKey = `${route.id}:${generation}`;
        return v2Integrated ? <FinanceV2ConnectedView key={viewKey} mode="INTEGRATED" {...shared} /> : <FinanceV2ConnectedView key={viewKey} mode="SYNTHETIC_PROPOSAL" {...shared} {...(v2Port ? { port: v2Port } : {})} {...(exportPort ? { exportPort } : {})} />;
      })() : summaryName && route.id === 'overview' && !examples ? <>
        <p role="note"><strong>SYNTHETIC FIXTURE</strong>: offline development data shaped like adapter output. Not real Finance data; the actual Finance summary route is unavailable until the accepted handoff.</p>
        <FinancialSummaryView {...summaryFixture(summaryName, evaluateFinancePacket)} projectLabel={syntheticProjectLabel} />
      </> : examples ?<ComponentExamples route={route} navigate={navigate} sample={search.get('sample') ?? 'all'} onSampleChange={(value) => changeSample('sample', value)} page={search.get('page') === '2' ? '2' : '1'} onPageChange={(direction) => changeSample('page', direction === 'next' ? '2' : '1')} sort={sort} onSort={setSort} returnToResults={(href) => navigate(href, true)} restoreFocus={restoreFocus} returnFocusId={returnFocusId} /> : <section><h2>Connected read-only extension</h2><p>{data.text}</p></section>} /></main>
  </>;
}
createRoot(document.getElementById('root')!).render(<FixtureHost />);
