import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard, type HostAccess, type RouteProvider } from '../../src';
import { createDashboardAuthorizer, createGuardedRouteReader, type RouteState, type TrustedReadRequest } from '../../src/server';
import { captainClaims, FIXTURE_AUDIENCE, FIXTURE_NOW, fixtureVerifier, hostState, issueFixtureToken } from '../fixtures/host-verifier';

const base = '/admin/finance';
const records: Record<string, string> = { 'account:acc_FIXTURE_captain1/event:evt_fx_1': 'own-project-summary', 'account:acc_FIXTURE_other/event:evt_fx_2': 'victim-canary' };
const forged: HostAccess = { status: 'authorized', scope: { tenantId: 'account:acc_FIXTURE_other', projectId: 'event:evt_fx_2' }, revision: 'forged' };

/** Models the host: the browser's provider call reaches a server handler that attaches the server-held credential. */
function hostBridge(serverHeldCredential: unknown) {
  const read = vi.fn(async ({ scope }: TrustedReadRequest): Promise<RouteState<string>> => {
    const data = records[`${scope.tenantId}/${scope.projectId}`];
    return data ? { status: 'ready', data } : { status: 'empty' };
  });
  const guarded = createGuardedRouteReader({ authorizer: createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: FIXTURE_AUDIENCE, now: () => FIXTURE_NOW }), basePath: base, read });
  const provider: RouteProvider<string> = {
    mode: 'integrated',
    // The browser-supplied scope is deliberately dropped: only the pathname crosses to the server.
    readRoute: ({ signal }) => guarded({ credential: serverHeldCredential, pathname: base, signal }),
  };
  return { provider, read };
}

describe('TD-07 forged browser HostAccess in the mounted dashboard', () => {
  it('shows restricted, not victim data, when the projection is forged and no server credential exists', async () => {
    const { provider, read } = hostBridge(undefined);
    render(<Dashboard basePath={base} pathname={base} navigate={vi.fn()} access={forged} provider={provider} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeVisible();
    expect(screen.queryByText('victim-canary')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('serves only the verified scope when a forged projection names another tenant', async () => {
    const { provider, read } = hostBridge(issueFixtureToken(captainClaims()));
    render(<Dashboard basePath={base} pathname={base} navigate={vi.fn()} access={forged} provider={provider} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(await screen.findByText('own-project-summary')).toBeVisible();
    expect(screen.queryByText('victim-canary')).toBeNull();
    expect(read.mock.calls[0]![0].scope).toEqual({ tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1' });
  });

  it('shows restricted when the forged projection is reused as the credential', async () => {
    const { provider, read } = hostBridge(JSON.stringify(forged));
    render(<Dashboard basePath={base} pathname={base} navigate={vi.fn()} access={forged} provider={provider} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeVisible();
    expect(screen.queryByText('victim-canary')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
