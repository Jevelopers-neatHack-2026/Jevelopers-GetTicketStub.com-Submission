import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { normalizeBasePath, resolveRoute, routeHref, routes, type ResolvedRoute } from '../integration/routes';
import { isAuthorized, type HostAccess } from './access/host';
import { isRouteState, type RouteProvider, type RouteState } from './data/boundary';
import { RouteView, type RouteRenderer } from './views/RouteView';
import { BoundaryState, type BoundaryExit } from './components/BoundaryState';

export interface DashboardProps<T = unknown> {
  basePath: string;
  pathname: string;
  navigate: (href: string) => void;
  access?: HostAccess | undefined;
  provider?: RouteProvider<T> | undefined;
  renderRoute?: RouteRenderer<T> | undefined;
}
type ReadResult<T> = { key: string; provider: RouteProvider<T>; attempt: number; state: RouteState<T> };
function routeKey(route: ResolvedRoute, access: Extract<HostAccess, { status: 'authorized' }>): string {
  return JSON.stringify([route.id, route.params, access.scope.tenantId, access.scope.projectId, access.revision]);
}
function DataRoute<T>({ route, access, provider, renderRoute, exit }: {
  route: ResolvedRoute; access: Extract<HostAccess, { status: 'authorized' }>; provider: RouteProvider<T> | undefined; renderRoute: RouteRenderer<T> | undefined; exit: BoundaryExit | undefined;
}) {
  const key = routeKey(route, access);
  const [result, setResult] = useState<ReadResult<T>>();
  const [attempt, setAttempt] = useState(0);
  const tenantId = access.scope.tenantId;
  const projectId = access.scope.projectId;
  useEffect(() => {
    if (!provider) return;
    const controller = new AbortController();
    let current = true;
    const timeout = setTimeout(() => {
      if (current) setResult({ key, provider, attempt, state: { status: 'error', retryable: true } });
      current = false; controller.abort();
    }, 15000);
    Promise.resolve().then(() => current ? provider.readRoute({ route, scope: { tenantId, projectId }, signal: controller.signal }) : { status: 'unavailable' } as RouteState<T>)
      .then((state) => {
        clearTimeout(timeout);
        if (current) setResult({ key, provider, attempt, state: isRouteState(state) && state.status !== 'loading' ? state : { status: 'error', retryable: false } });
      }).catch(() => { clearTimeout(timeout); if (current) setResult({ key, provider, attempt, state: { status: 'error', retryable: true } }); });
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [key, provider, tenantId, projectId, route, attempt]);
  const state: RouteState<T> = !provider ? { status: 'unavailable' } : result?.key === key && result.provider === provider && result.attempt === attempt ? result.state : { status: 'loading' };
  return <RouteView state={state} route={route} scope={access.scope} renderRoute={renderRoute} onRetry={() => setAttempt((value) => value + 1)} exit={exit} />;
}
export function Dashboard<T>({ basePath, pathname, navigate, access, provider, renderRoute }: DashboardProps<T>) {
  const base = normalizeBasePath(basePath);
  const resolved = useMemo(() => resolveRoute(base, pathname), [base, pathname]);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname) heading.current?.focus();
    previousPath.current = pathname;
  }, [pathname]);
  function onNavigate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(event.currentTarget.getAttribute('href')!);
  }
  // Every non-ready boundary offers a safe way out except on the overview itself.
  const exit: BoundaryExit | undefined = resolved.status === 'found' && resolved.route.id === 'overview' ? undefined : { href: routeHref(base, 'overview'), label: 'Return to overview', onNavigate };
  let content;
  if (resolved.status === 'not-found') content = <section className="td-boundary"><h2>Route not found</h2><p>This path is outside the declared dashboard routes.</p><a href={routeHref(base, 'overview')} onClick={onNavigate}>Return to overview</a></section>;
  else if (!isAuthorized(access)) content = <BoundaryState state={{ status: access?.status === 'loading' ? 'loading' : access?.status === 'unavailable' ? 'unavailable' : 'restricted' }} exit={exit} />;
  else content = <DataRoute key={routeKey(resolved.route, access)} route={resolved.route} access={access} provider={provider} renderRoute={renderRoute} exit={exit} />;
  return <div className="team-dashboard">
    <a className="td-skip" href="#td-route-content">Skip dashboard navigation</a>
    <header className="td-header"><p className="td-eyebrow">Finance</p>
      <p className="td-mode">{provider?.mode === 'fixture' ? 'Fixture mode — local boundary examples' : provider?.mode === 'integrated' ? 'Host data adapter' : 'No authoritative adapter connected'}</p>
    </header>
    <div className="td-layout"><nav aria-label="Dashboard"><ul>{routes.filter((route) => route.navigation).map((route) => <li key={route.id}><a href={routeHref(base, route.id)} onClick={onNavigate} aria-current={resolved.status === 'found' && resolved.route.id === route.id ? 'page' : undefined}>{route.label}</a></li>)}</ul></nav>
      <section id="td-route-content" aria-labelledby="td-route-title" tabIndex={-1}>
        <h1 id="td-route-title" ref={heading} tabIndex={-1}>{resolved.status === 'found' ? resolved.route.label : 'Dashboard route not found'}</h1>
        {content}
      </section>
    </div>
  </div>;
}
