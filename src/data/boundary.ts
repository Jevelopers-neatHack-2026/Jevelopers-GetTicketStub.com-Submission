import type { HostAccess, HostScope } from '../access/host';
import type { ResolvedRoute } from '../../integration/routes';
export type RouteState<T = unknown> =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; retryable: boolean }
  | { status: 'restricted' }
  | { status: 'unavailable' }
  | { status: 'ready'; data: T };
export type RouteRequest = Readonly<{ route: ResolvedRoute; scope: HostScope; signal: AbortSignal }>;
/** Keep the projection of the authorization decision that served this read beside its state. */
export type RouteReadResult<T = unknown> = Readonly<{ state: RouteState<T>; access: HostAccess }>;
/** Read-only port; the host enforces scope and authorization on the server. */
export interface RouteProvider<T = unknown> {
  readonly mode: 'fixture' | 'integrated';
  readRoute(request: RouteRequest): Promise<RouteReadResult<T>>;
}
const ABSENT = Symbol('absent');
/** Reject accessors and inherited fields without invoking them. Callers catch throwing Proxy traps. */
function ownValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ABSENT;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value as unknown : ABSENT;
}
/** Fresh envelope snapshot; domain data still belongs to the host's redaction/validation boundary. */
export function snapshotRouteState<T = unknown>(value: unknown): RouteState<T> | undefined {
  try {
    const status = ownValue(value, 'status');
    if (status === 'ready') {
      const data = ownValue(value, 'data');
      return data === ABSENT ? undefined : Object.freeze({ status, data: data as T });
    }
    if (status === 'error') {
      const retryable = ownValue(value, 'retryable');
      return typeof retryable === 'boolean' ? Object.freeze({ status, retryable }) : undefined;
    }
    if (status === 'loading' || status === 'empty' || status === 'restricted' || status === 'unavailable') return Object.freeze({ status });
  } catch { /* An uninspectable envelope fails closed. */ }
  return undefined;
}
export function snapshotHostAccess(value: unknown): HostAccess | undefined {
  try {
    const status = ownValue(value, 'status');
    if (status === 'loading' || status === 'restricted' || status === 'unavailable') return Object.freeze({ status });
    if (status !== 'authorized') return undefined;
    const scope = ownValue(value, 'scope');
    const tenantId = ownValue(scope, 'tenantId');
    const projectId = ownValue(scope, 'projectId');
    const revision = ownValue(value, 'revision');
    if (typeof tenantId !== 'string' || !tenantId.trim() || typeof projectId !== 'string' || !projectId.trim()
      || typeof revision !== 'string' || !revision.trim()) return undefined;
    return Object.freeze({ status, scope: Object.freeze({ tenantId, projectId }), revision });
  } catch { /* Never invoke a projection getter or expose a Proxy error. */ }
  return undefined;
}
export type BoundRouteResult<T> = Readonly<{ state: RouteState<T>; scope?: HostScope }>;
/** Reject stale/forged labels; only the returned, matching projection supplies the renderer scope. */
export function bindRouteRead<T>(value: unknown, expected: Extract<HostAccess, { status: 'authorized' }>): BoundRouteResult<T> {
  try {
    const state = snapshotRouteState<T>(ownValue(value, 'state'));
    const access = snapshotHostAccess(ownValue(value, 'access'));
    if (!state || state.status === 'loading' || !access || access.status === 'loading') return { state: { status: 'error', retryable: false } };
    if (access.status === 'unavailable' && state.status === 'unavailable') return { state };
    if (access.status !== 'authorized' || access.scope.tenantId !== expected.scope.tenantId
      || access.scope.projectId !== expected.scope.projectId || access.revision !== expected.revision) return { state: { status: 'restricted' } };
    return { state, scope: access.scope };
  } catch {
    return { state: { status: 'error', retryable: false } };
  }
}
