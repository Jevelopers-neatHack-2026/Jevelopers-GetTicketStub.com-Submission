import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard, type HostAccess, type RouteProvider } from '../../src';
import { routeHref } from '../../integration';
import { createDashboardAuthorizer, createGuardedRouteReader, type GuardedReadResult, type RouteState, type TrustedReadRequest } from '../../src/server';
import { captainClaims, FIXTURE_AUDIENCE, FIXTURE_NOW, fixtureVerifier, hostState, issueFixtureToken } from '../fixtures/host-verifier';

const base = '/admin/finance';
const own = { tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1' };
const victim = { tenantId: 'account:acc_FIXTURE_other', projectId: 'event:evt_fx_2' };
/** Records keyed by `${tenant}/${project}/${route}/${id}`; the victim's rows carry a canary. */
const records: Record<string, string> = {
  [`${own.tenantId}/${own.projectId}/overview/`]: 'own-project-summary',
  [`${own.tenantId}/${own.projectId}/transaction-detail/tx-own`]: 'own-transaction',
  [`${victim.tenantId}/${victim.projectId}/overview/`]: 'victim-canary',
  [`${victim.tenantId}/${victim.projectId}/transaction-detail/tx-victim`]: 'victim-canary',
};
const forged: HostAccess = { status: 'authorized', scope: victim, revision: 'forged' };

/** Models the host: the browser's provider call reaches a server handler that attaches the server-held credential. */
function hostBridge(serverHeldCredential: unknown) {
  const read = vi.fn(async ({ route, scope }: TrustedReadRequest): Promise<RouteState<string>> => {
    const data = records[`${scope.tenantId}/${scope.projectId}/${route.id}/${route.params.id ?? ''}`];
    return data ? { status: 'ready', data } : { status: 'empty' };
  });
  const guarded = createGuardedRouteReader({ authorizer: createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: FIXTURE_AUDIENCE, now: () => FIXTURE_NOW }), basePath: base, read });
  const results: GuardedReadResult<string>[] = [];
  const provider: RouteProvider<string> = {
    mode: 'integrated',
    // The browser-supplied scope is deliberately dropped: only the route's own pathname crosses to the server.
    readRoute: async ({ route, signal }) => {
      const result = await guarded({ credential: serverHeldCredential, pathname: routeHref(base, route.id, route.params), signal });
      results.push(result);
      return result.state;
    },
  };
  return { provider, read, results };
}

const cases = [
  { label: 'overview', pathname: base, ownData: 'own-project-summary' },
  { label: 'transaction detail', pathname: `${base}/transactions/tx-own`, ownData: 'own-transaction' },
] as const;

describe.each(cases)('TD-07 forged browser HostAccess in the mounted dashboard ($label)', ({ pathname, ownData }) => {
  it('shows restricted, not victim data, when the projection is forged and no server credential exists', async () => {
    const { provider, read } = hostBridge(undefined);
    render(<Dashboard basePath={base} pathname={pathname} navigate={vi.fn()} access={forged} provider={provider} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeVisible();
    expect(screen.queryByText('victim-canary')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('serves only the verified scope when a forged projection names another tenant, and labels it with that scope', async () => {
    const { provider, read, results } = hostBridge(issueFixtureToken(captainClaims()));
    render(<Dashboard basePath={base} pathname={pathname} navigate={vi.fn()} access={forged} provider={provider} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(await screen.findByText(ownData)).toBeVisible();
    expect(screen.queryByText('victim-canary')).toBeNull();
    expect(read.mock.calls[0]![0].scope).toEqual(own);
    expect(read.mock.calls[0]![0].route.id).toBe(pathname === base ? 'overview' : 'transaction-detail');
    // The read result carries the scope that served it, so the host can see the forged projection does not match.
    expect(results[0]!.access).toEqual({ status: 'authorized', scope: own, revision: 'account:acc_FIXTURE_captain1@2' });
    expect(results[0]!.access).not.toEqual(forged);
  });

  it('shows restricted when the forged projection is reused as the credential', async () => {
    const { provider, read } = hostBridge(JSON.stringify(forged));
    render(<Dashboard basePath={base} pathname={pathname} navigate={vi.fn()} access={forged} provider={provider} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeVisible();
    expect(screen.queryByText('victim-canary')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

it('TD-07 a forged victim detail id in the mounted dashboard renders the same empty state as a missing id', async () => {
  const { provider } = hostBridge(issueFixtureToken(captainClaims()));
  const { unmount } = render(<Dashboard basePath={base} pathname={`${base}/transactions/tx-victim`} navigate={vi.fn()} access={forged} provider={provider} renderRoute={({ data }) => <p>{data}</p>} />);
  const forgedHeading = (await screen.findByRole('heading', { level: 2 })).textContent;
  expect(screen.queryByText('victim-canary')).toBeNull();
  unmount();
  render(<Dashboard basePath={base} pathname={`${base}/transactions/tx-missing`} navigate={vi.fn()} access={forged} provider={provider} renderRoute={({ data }) => <p>{data}</p>} />);
  expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe(forgedHeading);
});
