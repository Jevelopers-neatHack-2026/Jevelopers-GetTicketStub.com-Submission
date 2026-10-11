import type { HostScope } from '../access/host';
import type { ResolvedRoute } from '../../integration/routes';
export type RouteState<T = unknown> =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; retryable: boolean }
  | { status: 'restricted' }
  | { status: 'unavailable' }
  | { status: 'ready'; data: T };
export type RouteRequest = Readonly<{ route: ResolvedRoute; scope: HostScope; signal: AbortSignal }>;
/** Read-only port; the host enforces scope and authorization on the server. */
export interface RouteProvider<T = unknown> {
  readonly mode: 'fixture' | 'integrated';
  readRoute(request: RouteRequest): Promise<RouteState<T>>;
}
export function isRouteState(value: unknown): value is RouteState {
  if (!value || typeof value !== 'object' || !('status' in value)) return false;
  switch (value.status) {
    case 'ready': return 'data' in value;
    case 'error': return 'retryable' in value && typeof value.retryable === 'boolean';
    case 'loading': case 'empty': case 'restricted': case 'unavailable': return true;
    default: return false;
  }
}
