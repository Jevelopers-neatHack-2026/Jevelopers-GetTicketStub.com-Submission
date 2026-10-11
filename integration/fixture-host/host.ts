import type { HostAccess, RouteProvider, RouteState } from '../../src';
export const fixtureStates = ['unavailable', 'loading', 'empty', 'error', 'restricted', 'ready'] as const;
export type FixtureState = (typeof fixtureStates)[number];
export const authorizedFixture: HostAccess = { status: 'authorized', scope: { tenantId: 'fixture-tenant', projectId: 'fixture-project' }, revision: 'td01-fixture-v1' };
export function fixtureProvider(state: FixtureState): RouteProvider<{ text: string }> {
  return { mode: 'fixture', readRoute: ({ signal }) => {
    if (state === 'loading') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled fixture')), { once: true }));
    const result: RouteState<{ text: string }> = state === 'ready' ? { status: 'ready', data: { text: 'Read-only extension fixture. This contains no financial records.' } } : state === 'error' ? { status: 'error', retryable: true } : { status: state };
    return Promise.resolve(result);
  } };
}
