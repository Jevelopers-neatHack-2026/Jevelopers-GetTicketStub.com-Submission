// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDashboardAuthorizer, createGuardedRouteReader, routeCapabilities, toHostAccessProjection, type HostAccess, type HostSessionVerifier, type RouteState, type TrustedReadRequest } from '../../src/server';
import { routes } from '../../integration';
import { captainClaims, FIXTURE_AUDIENCE, FIXTURE_NOW, fixtureVerifier, hostState, issueFixtureToken } from '../fixtures/host-verifier';

const now = () => FIXTURE_NOW;
const base = '/admin/finance';
const signal = () => new AbortController().signal;
function setup(state = hostState()) {
  const verifier = fixtureVerifier(state);
  const authorizer = createDashboardAuthorizer({ verifier, audience: FIXTURE_AUDIENCE, now });
  const read = vi.fn(async ({ scope }: TrustedReadRequest): Promise<RouteState<string>> => ({ status: 'ready', data: `records-for:${scope.tenantId}/${scope.projectId}` }));
  return { state, verifier, authorizer, read, guarded: createGuardedRouteReader({ authorizer, basePath: base, read }) };
}
const captain = issueFixtureToken(captainClaims());
const member = issueFixtureToken(captainClaims({ actorId: 'account:acc_FIXTURE_member1', tenantId: 'account:acc_FIXTURE_captain1', role: 'member', capabilities: ['finance.read'], sessionId: 'session-member', membershipRevision: 1 }));
const victimScope = { tenantId: 'account:acc_FIXTURE_other', projectId: 'event:evt_fx_2' };
const forgedAccess: HostAccess = { status: 'authorized', scope: victimScope, revision: 'forged-revision' };

describe('TD-07 trusted host authorization', () => {
  it('allows a verified captain and derives scope only from the verified context', async () => {
    const { authorizer } = setup();
    const decision = await authorizer.authorize({ credential: captain, route: 'overview' });
    expect(decision).toEqual({ status: 'allowed', route: 'overview', scope: { tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1' }, actorId: 'account:acc_FIXTURE_captain1', revision: 'account:acc_FIXTURE_captain1@2', capabilities: ['event.read', 'finance.read', 'finance.export'] });
    expect(toHostAccessProjection(decision)).toEqual({ status: 'authorized', scope: { tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1' }, revision: 'account:acc_FIXTURE_captain1@2' });
  });

  it('requires an explicit grant for every route and an export grant for exports', async () => {
    const { authorizer } = setup();
    for (const route of routes) expect((await authorizer.authorize({ credential: member, route: route.id })).status).toBe(route.id === 'exports' ? 'denied' : 'allowed');
    expect(await authorizer.authorize({ credential: member, route: 'exports' })).toEqual({ status: 'denied', reason: 'forbidden' });
    expect(Object.keys(routeCapabilities).sort()).toEqual(routes.map((route) => route.id).sort());
  });

  it('never consults the role name: a captain or staff role without grants gets nothing', async () => {
    const { authorizer } = setup();
    for (const role of ['captain', 'staff', 'finance-admin', 'owner']) {
      const token = issueFixtureToken(captainClaims({ role, capabilities: ['event.read'] }));
      expect(await authorizer.authorize({ credential: token, route: 'overview' })).toEqual({ status: 'denied', reason: 'forbidden' });
    }
  });

  it.each([
    ['missing', undefined], ['null', null], ['empty', ''], ['whitespace', ' '], ['padded', ` ${captain}`], ['newline', `${captain}\n`],
    ['object', { token: captain }], ['number', 42], ['oversized', 'a'.repeat(8193)],
  ])('fails closed for a %s credential without calling the verifier', async (_label, credential) => {
    const { authorizer, verifier } = setup();
    expect(await authorizer.authorize({ credential, route: 'overview' })).toEqual({ status: 'denied', reason: 'unauthenticated' });
    expect(verifier.calls).toBe(0);
  });

  it('fails closed on invalid, expired, revoked and stale host context', async () => {
    const { authorizer, state } = setup();
    const [header, payload] = captain.split('.') as [string, string];
    const tampered = `${header}.${Buffer.from(JSON.stringify(captainClaims({ tenantId: victimScope.tenantId, projectId: victimScope.projectId }))).toString('base64url')}.${captain.split('.')[2]}`;
    const cases = [
      tampered, `${header}.${payload}.invalid-signature`, `${header}.${payload}`,
      issueFixtureToken(captainClaims({ expiresAt: '2026-10-10T11:59:59.000Z' })),
      issueFixtureToken(captainClaims({ audience: 'ticketstub.other' })),
      issueFixtureToken(captainClaims({ membershipRevision: 1 })),
      issueFixtureToken(captainClaims({ sessionId: 'session-unknown' })),
    ];
    for (const credential of cases) expect(await authorizer.authorize({ credential, route: 'overview' })).toEqual({ status: 'denied', reason: 'unauthenticated' });
    state.projectMembers.get('event:evt_fx_1')!.delete('account:acc_FIXTURE_captain1');
    expect(await authorizer.authorize({ credential: captain, route: 'overview' })).toEqual({ status: 'denied', reason: 'unauthenticated' });
  });

  it('cannot select a project the verified context does not hold', async () => {
    const { authorizer } = setup();
    expect(await authorizer.authorize({ credential: captain, route: 'overview', projectId: 'event:evt_fx_2' })).toEqual({ status: 'denied', reason: 'not_found' });
    expect(await authorizer.authorize({ credential: captain, route: 'overview', projectId: 'event:does_not_exist' })).toEqual({ status: 'denied', reason: 'not_found' });
    expect(await authorizer.authorize({ credential: captain, route: 'overview', projectId: '../event' })).toEqual({ status: 'denied', reason: 'not_found' });
    expect((await authorizer.authorize({ credential: captain, route: 'overview', projectId: 'event:evt_fx_1' })).status).toBe('allowed');
  });

  it('rejects unknown routes even with a valid credential', async () => {
    const { authorizer } = setup();
    for (const route of ['admin', '__proto__', 'constructor', 'toString']) expect(await authorizer.authorize({ credential: captain, route: route as never })).toEqual({ status: 'denied', reason: 'not_found' });
  });

  it('treats verifier failures, timeouts and malformed answers as unavailable', async () => {
    const answers: unknown[] = [
      undefined, null, 'ok', { ok: 'true', context: {} }, { ok: false, reason: 'unknown-reason' }, { ok: false, reason: 'unavailable' },
      { ok: true }, { ok: true, context: { ...okContext(), capabilities: 'finance.read' } }, { ok: true, context: { ...okContext(), capabilities: [1] } },
      { ok: true, context: { ...okContext(), tenantId: '' } }, { ok: true, context: { ...okContext(), projectId: 'x'.repeat(129) } },
      { ok: true, context: { ...okContext(), revision: ' ' } }, { ok: true, context: { ...okContext(), expiresAt: 'tomorrow' } },
      { ok: true, context: { ...okContext(), role: 7 } }, [{ ok: true, context: okContext() }],
    ];
    for (const answer of answers) {
      const authorizer = createDashboardAuthorizer({ verifier: { verify: async () => answer as never }, audience: FIXTURE_AUDIENCE, now });
      expect(await authorizer.authorize({ credential: captain, route: 'overview' })).toEqual({ status: 'unavailable' });
    }
    const throwing = createDashboardAuthorizer({ verifier: { verify: () => { throw new Error('secret-canary'); } }, audience: FIXTURE_AUDIENCE, now });
    expect(await throwing.authorize({ credential: captain, route: 'overview' })).toEqual({ status: 'unavailable' });
    let hungSignal: AbortSignal | undefined;
    const hanging: HostSessionVerifier = { verify: ({ signal: s }) => { hungSignal = s; return new Promise(() => undefined); } };
    const slow = createDashboardAuthorizer({ verifier: hanging, audience: FIXTURE_AUDIENCE, now, timeoutMs: 10 });
    expect(await slow.authorize({ credential: captain, route: 'overview' })).toEqual({ status: 'unavailable' });
    expect(hungSignal?.aborted).toBe(true);
    const aborted = new AbortController(); aborted.abort();
    expect(await createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: FIXTURE_AUDIENCE, now }).authorize({ credential: captain, route: 'overview', signal: aborted.signal })).toEqual({ status: 'unavailable' });
  });

  it('re-checks audience and expiry even when the verifier says ok', async () => {
    const wrongAudience = createDashboardAuthorizer({ verifier: { verify: async () => ({ ok: true, context: { ...okContext(), audience: 'other' } }) }, audience: FIXTURE_AUDIENCE, now });
    const expired = createDashboardAuthorizer({ verifier: { verify: async () => ({ ok: true, context: { ...okContext(), expiresAt: FIXTURE_NOW.toISOString() } }) }, audience: FIXTURE_AUDIENCE, now });
    expect(await wrongAudience.authorize({ credential: captain, route: 'overview' })).toEqual({ status: 'denied', reason: 'unauthenticated' });
    expect(await expired.authorize({ credential: captain, route: 'overview' })).toEqual({ status: 'denied', reason: 'unauthenticated' });
  });

  it('requires a verifier and an audience', () => {
    expect(() => createDashboardAuthorizer({ verifier: undefined as never, audience: FIXTURE_AUDIENCE })).toThrow();
    expect(() => createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: ' ' })).toThrow();
  });

  it('projects denials to restricted and unavailability to unavailable', () => {
    expect(toHostAccessProjection({ status: 'denied', reason: 'forbidden' })).toEqual({ status: 'restricted' });
    expect(toHostAccessProjection({ status: 'denied', reason: 'unauthenticated' })).toEqual({ status: 'restricted' });
    expect(toHostAccessProjection({ status: 'unavailable' })).toEqual({ status: 'unavailable' });
  });
});

describe('TD-07 forged HostAccess projections grant nothing', () => {
  it('rejects a forged HostAccess object used as a credential', async () => {
    const { authorizer, guarded, read, verifier } = setup();
    expect(await authorizer.authorize({ credential: forgedAccess, route: 'overview' })).toEqual({ status: 'denied', reason: 'unauthenticated' });
    expect(await guarded({ credential: forgedAccess, pathname: base, signal: signal() })).toEqual({ status: 'restricted' });
    expect(verifier.calls).toBe(0); expect(read).not.toHaveBeenCalled();
  });

  it('rejects forged HostAccess serialized as JSON, base64 or an unsigned token', async () => {
    const { guarded, read } = setup();
    const json = JSON.stringify(forgedAccess);
    const b64 = Buffer.from(json).toString('base64url');
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...captainClaims(), ...victimScope })).toString('base64url')}.`;
    for (const credential of [json, b64, `${b64}.${b64}.${b64}`, unsigned, 'authorized', forgedAccess.revision]) {
      expect(await guarded({ credential, pathname: base, signal: signal() })).toEqual({ status: 'restricted' });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('ignores a forged scope or access smuggled next to a valid credential', async () => {
    const { guarded, read } = setup();
    const smuggled = { credential: captain, pathname: base, signal: signal(), scope: victimScope, access: forgedAccess, tenantId: victimScope.tenantId } as never;
    expect(await guarded(smuggled)).toEqual({ status: 'ready', data: 'records-for:account:acc_FIXTURE_captain1/event:evt_fx_1' });
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]![0].scope).toEqual({ tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1' });
  });

  it('a projection issued to one user is not a credential for anyone', async () => {
    const { authorizer, guarded, read } = setup();
    const genuine = toHostAccessProjection(await authorizer.authorize({ credential: captain, route: 'overview' }));
    expect(genuine.status).toBe('authorized');
    expect(await guarded({ credential: genuine, pathname: base, signal: signal() })).toEqual({ status: 'restricted' });
    expect(await guarded({ credential: JSON.stringify(genuine), pathname: base, signal: signal() })).toEqual({ status: 'restricted' });
    expect(read).not.toHaveBeenCalled();
  });
});

describe('TD-07 guarded server reads', () => {
  it('re-authorizes every read so revocation takes effect immediately', async () => {
    const { guarded, read, state } = setup();
    expect((await guarded({ credential: captain, pathname: `${base}/transactions/tx-1`, signal: signal() })).status).toBe('ready');
    expect(read.mock.calls[0]![0].route).toEqual({ id: 'transaction-detail', label: 'Transaction detail', params: { id: 'tx-1' } });
    state.liveSessions.delete('session-captain');
    expect(await guarded({ credential: captain, pathname: base, signal: signal() })).toEqual({ status: 'restricted' });
    state.liveSessions.add('session-captain'); state.membershipRevision.set('account:acc_FIXTURE_captain1', 3);
    expect(await guarded({ credential: captain, pathname: base, signal: signal() })).toEqual({ status: 'restricted' });
    expect(read).toHaveBeenCalledOnce();
  });

  it('denies export reads without the export grant and never reaches the reader', async () => {
    const { guarded, read } = setup();
    expect(await guarded({ credential: member, pathname: `${base}/reports/exports`, signal: signal() })).toEqual({ status: 'restricted' });
    expect((await guarded({ credential: member, pathname: `${base}/reports`, signal: signal() })).status).toBe('ready');
    expect((await guarded({ credential: captain, pathname: `${base}/reports/exports`, signal: signal() })).status).toBe('ready');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('returns unavailable for unknown paths and verifier outages without reading', async () => {
    const { guarded, read } = setup();
    for (const pathname of ['/admin/other', `${base}/missing`, `${base}?tenant=x`, `${base}/transactions/..`]) expect(await guarded({ credential: captain, pathname, signal: signal() })).toEqual({ status: 'unavailable' });
    const down = createGuardedRouteReader({ authorizer: createDashboardAuthorizer({ verifier: { verify: async () => { throw new Error('down'); } }, audience: FIXTURE_AUDIENCE, now }), basePath: base, read });
    expect(await down({ credential: captain, pathname: base, signal: signal() })).toEqual({ status: 'unavailable' });
    expect(read).not.toHaveBeenCalled();
  });

  it('uses safe states for reader errors, malformed results and cancellation', async () => {
    const authorizer = createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: FIXTURE_AUDIENCE, now });
    const failing = createGuardedRouteReader<string>({ authorizer, basePath: base, read: async () => { throw new Error('secret-canary'); } });
    expect(await failing({ credential: captain, pathname: base, signal: signal() })).toEqual({ status: 'error', retryable: true });
    const malformed = createGuardedRouteReader<string>({ authorizer, basePath: base, read: async () => ({ status: 'loading' }) });
    expect(await malformed({ credential: captain, pathname: base, signal: signal() })).toEqual({ status: 'error', retryable: false });
    const controller = new AbortController();
    const cancelled = createGuardedRouteReader<string>({ authorizer, basePath: base, read: async () => { controller.abort(); return { status: 'ready', data: 'late-canary' }; } });
    expect(await cancelled({ credential: captain, pathname: base, signal: controller.signal })).toEqual({ status: 'unavailable' });
  });
});

function okContext() {
  return { actorId: 'account:a', tenantId: 'account:a', projectId: 'event:e', revision: 'r1', capabilities: ['finance.read'], audience: FIXTURE_AUDIENCE, expiresAt: '2026-10-10T12:05:00.000Z' };
}
