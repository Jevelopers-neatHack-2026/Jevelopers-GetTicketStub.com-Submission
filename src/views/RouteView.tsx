import type { ReactNode } from 'react';
import type { ResolvedRoute } from '../../integration/routes';
import type { HostScope } from '../access/host';
import type { RouteState } from '../data/boundary';
import { BoundaryState } from '../components/BoundaryState';
export type RouteViewContext<T> = Readonly<{ route: ResolvedRoute; scope: HostScope; data: T }>;
export type RouteRenderer<T> = (context: RouteViewContext<T>) => ReactNode;
export function RouteView<T>({ state, route, scope, renderRoute, onRetry }: {
  state: RouteState<T>; route: ResolvedRoute; scope: HostScope | undefined; renderRoute: RouteRenderer<T> | undefined; onRetry: () => void;
}) {
  if (state.status !== 'ready') return <BoundaryState state={state} onRetry={onRetry} />;
  if (!renderRoute || !scope) return <BoundaryState state={{ status: 'unavailable' }} />;
  return <>{renderRoute({ route, scope, data: state.data })}</>;
}
