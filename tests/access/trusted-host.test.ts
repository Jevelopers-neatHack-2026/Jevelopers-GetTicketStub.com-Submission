// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createDashboardAuthorizer, createGuardedRouteReader, parseInstant, routeCapabilities, toHostAccessProjection, type GuardedReadOutcome, type HostAccess, type HostSessionVerifier, type RouteState, type TrustedReadRequest } from '../../src/server';
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
    expect(decision).toEqual({
      status: 'allowed', route: 'overview', scope: { tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1' },
      trustedScope: { tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1', environment: 'test', billingMode: 'simulated', actorId: 'account:acc_FIXTURE_captain1' },
      actorId: 'account:acc_FIXTURE_captain1', revision: 'account:acc_FIXTURE_captain1@2', expiresAt: '2026-10-10T12:05:00.000Z', capabilities: ['event.read', 'finance.read', 'finance.export'],
    });
    expect(Object.isFrozen(decision)).toBe(true);
    if (decision.status === 'allowed') expect([decision.scope, decision.trustedScope, decision.capabilities].every(Object.isFrozen)).toBe(true);
    expect(toHostAccessProjection(decision)).toEqual({ status: 'authorized', scope: { tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1' }, revision: 'account:acc_FIXTURE_captain1@2' });
  });

  it('requires an explicit grant for every route and an export grant for exports', async () => {
    const { authorizer } = setup();
    for (const route of routes) expect((await authorizer.authorize({ credential: member, route: route.id })).status).toBe(route.id === 'exports' ? 'denied' : 'allowed');
    expect(await authorizer.authorize({ credential: member, route: 'exports' })).toEqual({ status: 'denied', reason: 'forbidden', cause: 'missing_capability' });
    expect(Object.keys(routeCapabilities).sort()).toEqual(routes.map((route) => route.id).sort());
  });

  it('keeps exported route capability requirements immutable at runtime', async () => {
    const { authorizer } = setup();
    const required = routeCapabilities.exports as string[];
    const original = [...required];
    try {
      const mutationAccepted = Reflect.set(required, 'length', 0);
      const decision = await authorizer.authorize({ credential: member, route: 'exports' });
      expect(Object.values(routeCapabilities).every(Object.isFrozen)).toBe(true);
      expect(Object.isFrozen(required)).toBe(true);
      expect(mutationAccepted).toBe(false);
      expect(decision).toEqual({ status: 'denied', reason: 'forbidden', cause: 'missing_capability' });
    } finally {
      if (!Object.isFrozen(required)) required.splice(0, required.length, ...original);
    }
  });

  it('never consults the role name: a captain or staff role without grants gets nothing', async () => {
    const { authorizer } = setup();
    for (const role of ['captain', 'staff', 'finance-admin', 'owner']) {
      const token = issueFixtureToken(captainClaims({ role, capabilities: ['event.read'] }));
      expect(await authorizer.authorize({ credential: token, route: 'overview' })).toEqual({ status: 'denied', reason: 'forbidden', cause: 'missing_capability' });
    }
  });

  it.each([
    ['missing', undefined], ['null', null], ['empty', ''], ['whitespace', ' '], ['padded', ` ${captain}`], ['newline', `${captain}\n`],
    ['object', { token: captain }], ['number', 42], ['oversized', 'a'.repeat(8193)],
  ])('fails closed for a %s credential without calling the verifier', async (_label, credential) => {
    const { authorizer, verifier } = setup();
    expect(await authorizer.authorize({ credential, route: 'overview' })).toEqual({ status: 'denied', reason: 'unauthenticated', cause: 'invalid_credential' });
    expect(verifier.calls).toBe(0);
  });

  it('fails closed on invalid, expired, revoked and stale host context and keeps the cause server-side', async () => {
    const { authorizer, state } = setup();
    const [header, payload] = captain.split('.') as [string, string];
    const tampered = `${header}.${Buffer.from(JSON.stringify(captainClaims({ tenantId: victimScope.tenantId, projectId: victimScope.projectId }))).toString('base64url')}.${captain.split('.')[2]}`;
    const cases: [string, string][] = [
      [tampered, 'forged'], [`${header}.${payload}.invalid-signature`, 'forged'], [`${header}.${payload}`, 'malformed'],
      [issueFixtureToken(captainClaims({ expiresAt: '2026-10-10T11:59:59.000Z' })), 'expired'],
      [issueFixtureToken(captainClaims({ audience: 'ticketstub.other' })), 'wrong_audience'],
      [issueFixtureToken(captainClaims({ membershipRevision: 1 })), 'stale'],
      [issueFixtureToken(captainClaims({ sessionId: 'session-unknown' })), 'revoked'],
    ];
    for (const [credential, cause] of cases) {
      const decision = await authorizer.authorize({ credential, route: 'overview' });
      expect(decision).toEqual({ status: 'denied', reason: 'unauthenticated', cause });
      expect(toHostAccessProjection(decision)).toEqual({ status: 'restricted' });
    }
    state.projectMembers.get('event:evt_fx_1')!.delete('account:acc_FIXTURE_captain1');
    expect(await authorizer.authorize({ credential: captain, route: 'overview' })).toEqual({ status: 'denied', reason: 'unauthenticated', cause: 'revoked' });
  });

  it('cannot select a project the verified context does not hold', async () => {
    const { authorizer } = setup();
    const notFound = { status: 'denied', reason: 'not_found', cause: 'project_mismatch' };
    expect(await authorizer.authorize({ credential: captain, route: 'overview', projectId: 'event:evt_fx_2' })).toEqual(notFound);
    expect(await authorizer.authorize({ credential: captain, route: 'overview', projectId: 'event:does_not_exist' })).toEqual(notFound);
    expect(await authorizer.authorize({ credential: captain, route: 'overview', projectId: '../event' })).toEqual(notFound);
    expect((await authorizer.authorize({ credential: captain, route: 'overview', projectId: 'event:evt_fx_1' })).status).toBe('allowed');
  });

  it('rejects unknown routes even with a valid credential', async () => {
    const { authorizer } = setup();
    for (const route of ['admin', '__proto__', 'constructor', 'toString']) expect(await authorizer.authorize({ credential: captain, route: route as never })).toEqual({ status: 'denied', reason: 'not_found', cause: 'unknown_route' });
  });

  it('treats verifier failures, timeouts and malformed answers as unavailable', async () => {
    const answers: unknown[] = [
      undefined, null, 'ok', { ok: 'true', context: {} }, { ok: false, reason: 'unknown-reason' },
      { ok: true }, { ok: true, context: { ...okContext(), capabilities: 'finance.read' } }, { ok: true, context: { ...okContext(), capabilities: [1] } },
      { ok: true, context: { ...okContext(), tenantId: '' } }, { ok: true, context: { ...okContext(), projectId: 'x'.repeat(129) } },
      { ok: true, context: { ...okContext(), revision: ' ' } }, { ok: true, context: { ...okContext(), revision: 'account:x@2\nFORGED audit line' } }, { ok: true, context: { ...okContext(), revision: 'rev\u0085' } }, { ok: true, context: { ...okContext(), expiresAt: 'tomorrow' } },
      { ok: true, context: { ...okContext(), role: 7 } }, [{ ok: true, context: okContext() }], { ok: true, context: [okContext()] },
      { ok: true, context: { ...okContext(), environment: 'preview' } }, { ok: true, context: { ...okContext(), billingMode: 'paid_test' } },
      { ok: true, context: omit(okContext(), 'environment') }, { ok: true, context: omit(okContext(), 'billingMode') },
      { ok: true, context: { ...okContext(), capabilities: Array.from({ length: 257 }, () => 'finance.read') } },
    ];
    for (const answer of answers) {
      const authorizer = createDashboardAuthorizer({ verifier: { verify: async () => answer as never }, audience: FIXTURE_AUDIENCE, now });
      expect(await authorizer.authorize({ credential: captain, route: 'overview' })).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
    }
    expect(await answerWith({ ok: false, reason: 'unavailable' })).toEqual({ status: 'unavailable', cause: 'verifier_unavailable' });
    const throwing = createDashboardAuthorizer({ verifier: { verify: () => { throw new Error('secret-canary'); } }, audience: FIXTURE_AUDIENCE, now });
    expect(await throwing.authorize({ credential: captain, route: 'overview' })).toEqual({ status: 'unavailable', cause: 'verifier_error' });
    let hungSignal: AbortSignal | undefined;
    const hanging: HostSessionVerifier = { verify: ({ signal: s }) => { hungSignal = s; return new Promise(() => undefined); } };
    const slow = createDashboardAuthorizer({ verifier: hanging, audience: FIXTURE_AUDIENCE, now, timeoutMs: 10 });
    expect(await slow.authorize({ credential: captain, route: 'overview' })).toEqual({ status: 'unavailable', cause: 'timeout' });
    expect(hungSignal?.aborted).toBe(true);
    const aborted = new AbortController(); aborted.abort();
    expect(await createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: FIXTURE_AUDIENCE, now }).authorize({ credential: captain, route: 'overview', signal: aborted.signal })).toEqual({ status: 'unavailable', cause: 'aborted' });
  });

  it('aborts the verifier when the outer signal aborts while it is in flight', async () => {
    let verifierSignal: AbortSignal | undefined;
    const controller = new AbortController();
    const verifier: HostSessionVerifier = { verify: ({ signal: s }) => { verifierSignal = s; queueMicrotask(() => controller.abort()); return new Promise(() => undefined); } };
    const authorizer = createDashboardAuthorizer({ verifier, audience: FIXTURE_AUDIENCE, now });
    expect(await authorizer.authorize({ credential: captain, route: 'overview', signal: controller.signal })).toEqual({ status: 'unavailable', cause: 'aborted' });
    expect(verifierSignal?.aborted).toBe(true);
  });

  it('re-checks audience and expiry even when the verifier says ok', async () => {
    expect(await answerWith({ ok: true, context: { ...okContext(), audience: 'other' } })).toEqual({ status: 'denied', reason: 'unauthenticated', cause: 'wrong_audience' });
    expect(await answerWith({ ok: true, context: { ...okContext(), expiresAt: FIXTURE_NOW.toISOString() } })).toEqual({ status: 'denied', reason: 'unauthenticated', cause: 'expired' });
  });

  it('requires a verifier, an audience and bounded integer timeouts and lifetime', () => {
    expect(() => createDashboardAuthorizer({ verifier: undefined as never, audience: FIXTURE_AUDIENCE })).toThrow();
    expect(() => createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: ' ' })).toThrow();
    const verifier = fixtureVerifier(hostState());
    for (const timeoutMs of [Number.NaN, 0, -1, 1.5, Number.POSITIVE_INFINITY, 60_001, '5000' as never]) {
      expect(() => createDashboardAuthorizer({ verifier, audience: FIXTURE_AUDIENCE, timeoutMs })).toThrow(/timeoutMs/u);
      const authorizer = createDashboardAuthorizer({ verifier, audience: FIXTURE_AUDIENCE });
      expect(() => createGuardedRouteReader({ authorizer, basePath: base, read: async () => ({ status: 'empty' }), readTimeoutMs: timeoutMs })).toThrow(/readTimeoutMs/u);
    }
    for (const maxContextTtlMs of [Number.NaN, 999, 86_400_001, Number.POSITIVE_INFINITY]) expect(() => createDashboardAuthorizer({ verifier, audience: FIXTURE_AUDIENCE, maxContextTtlMs })).toThrow(/maxContextTtlMs/u);
    expect(() => createDashboardAuthorizer({ verifier, audience: FIXTURE_AUDIENCE, timeoutMs: 1, maxContextTtlMs: 1_000 })).not.toThrow();
    expect(() => createDashboardAuthorizer({ verifier, audience: FIXTURE_AUDIENCE, timeoutMs: 60_000, maxContextTtlMs: 86_400_000 })).not.toThrow();
  });

  it('projects denials to restricted and unavailability to unavailable, dropping the cause', () => {
    expect(toHostAccessProjection({ status: 'denied', reason: 'forbidden', cause: 'missing_capability' })).toEqual({ status: 'restricted' });
    expect(toHostAccessProjection({ status: 'denied', reason: 'unauthenticated', cause: 'revoked' })).toEqual({ status: 'restricted' });
    expect(toHostAccessProjection({ status: 'unavailable', cause: 'timeout' })).toEqual({ status: 'unavailable' });
  });
});

describe('TD-07 expiry is a strict, timezone-independent instant', () => {
  it('parses only ISO-8601 instants with Z or an explicit offset', () => {
    expect(parseInstant('2026-10-10T12:00:00Z')).toBe(Date.UTC(2026, 9, 10, 12));
    expect(parseInstant('2026-10-10T12:00:00.5Z')).toBe(Date.UTC(2026, 9, 10, 12, 0, 0, 500));
    expect(parseInstant('2026-10-10T05:00:00-07:00')).toBe(Date.UTC(2026, 9, 10, 12));
    expect(parseInstant('2026-10-10T17:30:00+05:30')).toBe(Date.UTC(2026, 9, 10, 12));
    for (const value of ['2026-10-10T05:30:00', '2026-10-10', 'Sat, 10 Oct 2026 12:30:00 GMT', '2026-10-10 12:00:00Z', '2026-10-10T12:00:00z', '2026-02-30T00:00:00Z',
      '2026-13-01T00:00:00Z', '2026-10-10T24:00:00Z', '2026-10-10T12:00:00+25:00', '2026-10-10T12:00:00+0700', '2026-10-10T12:00:00.1234Z', '+002026-10-10T12:00:00Z', ' 2026-10-10T12:00:00Z']) {
      expect(parseInstant(value), value).toBeUndefined();
    }
  });

  it('gives the same decision under TZ=UTC and TZ=America/Los_Angeles', async () => {
    const rows: [string, unknown][] = [
      // Offset-less local time: Date.parse would read it as local time and allow it in Los Angeles.
      ['2026-10-10T05:30:00', { status: 'unavailable', cause: 'malformed_answer' }],
      ['Sat, 10 Oct 2026 12:30:00 GMT', { status: 'unavailable', cause: 'malformed_answer' }],
      ['2026-10-10', { status: 'unavailable', cause: 'malformed_answer' }],
      ['2026-10-10T04:59:59-07:00', { status: 'denied', reason: 'unauthenticated', cause: 'expired' }],
      ['9999-12-31T00:00:00Z', { status: 'denied', reason: 'unauthenticated', cause: 'lifetime_exceeded' }],
      ['2026-10-10T12:15:00.001Z', { status: 'denied', reason: 'unauthenticated', cause: 'lifetime_exceeded' }],
    ];
    await inTimeZones(async () => {
      for (const [expiresAt, expected] of rows) expect(await answerWith({ ok: true, context: { ...okContext(), expiresAt } }), expiresAt).toEqual(expected);
      for (const expiresAt of ['2026-10-10T05:05:00-07:00', '2026-10-10T12:15:00Z']) expect((await answerWith({ ok: true, context: { ...okContext(), expiresAt } })).status, expiresAt).toBe('allowed');
      const { authorizer } = setup();
      expect((await authorizer.authorize({ credential: captain, route: 'overview' })).status).toBe('allowed');
      expect(await authorizer.authorize({ credential: issueFixtureToken(captainClaims({ expiresAt: '2026-10-10T05:30:00' })), route: 'overview' })).toEqual({ status: 'denied', reason: 'unauthenticated', cause: 'expired' });
    });
  });

  it('applies a configurable maximum context lifetime', async () => {
    const tight = { ok: true, context: { ...okContext(), expiresAt: '2026-10-10T12:01:00.001Z' } };
    expect(await answerWith(tight, { maxContextTtlMs: 60_000 })).toEqual({ status: 'denied', reason: 'unauthenticated', cause: 'lifetime_exceeded' });
    expect((await answerWith({ ok: true, context: { ...okContext(), expiresAt: '2026-10-10T12:01:00Z' } }, { maxContextTtlMs: 60_000 })).status).toBe('allowed');
    expect((await answerWith({ ok: true, context: { ...okContext(), expiresAt: '2026-10-11T11:59:00Z' } }, { maxContextTtlMs: 86_400_000 })).status).toBe('allowed');
  });
});

describe('TD-07 verifier answers are snapshotted once and validated as untrusted shape', () => {
  it('rejects a getter whose value changes between reads', async () => {
    let reads = 0;
    const context = { ...okContext(), get tenantId() { reads += 1; return reads === 1 ? 'account:a' : 'account:victim'; } };
    const decision = await answerWith({ ok: true, context });
    expect(decision).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
    expect(reads).toBe(0);
    let okReads = 0;
    expect(await answerWith({ get ok() { okReads += 1; return true; }, context: okContext() })).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
    expect(okReads).toBe(0);
  });

  it('reads each field of a Proxy exactly once and uses only the value it validated', async () => {
    const seen = new Map<PropertyKey, number>();
    const target = okContext();
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        const count = (seen.get(key) ?? 0) + 1; seen.set(key, count);
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        return key === 'tenantId' && count > 1 && descriptor ? { ...descriptor, value: 'account:victim' } : descriptor;
      },
      get(object, key, receiver) { return key === 'tenantId' ? 'account:victim' : Reflect.get(object, key, receiver) as unknown; },
    });
    const decision = await answerWith({ ok: true, context: proxy });
    expect(decision.status).toBe('allowed');
    if (decision.status === 'allowed') { expect(decision.scope.tenantId).toBe('account:a'); expect(decision.trustedScope.tenantId).toBe('account:a'); }
    expect(seen.get('tenantId')).toBe(1);
    const throwing = new Proxy(okContext(), { getOwnPropertyDescriptor() { throw new Error('trap'); } });
    expect(await answerWith({ ok: true, context: throwing })).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
    const hugeArray = new Proxy(['finance.read'], { getOwnPropertyDescriptor(object, key) { return key === 'length' ? { value: 1e9, writable: true, enumerable: false, configurable: false } : Reflect.getOwnPropertyDescriptor(object, key); } });
    expect(await answerWith({ ok: true, context: { ...okContext(), capabilities: hugeArray } })).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
  });

  it('copies capabilities by index so an overridden every or iterator cannot skip validation', async () => {
    const overriddenEvery = Object.assign(['finance.read', 'bad value\n<script>'], { every: () => true });
    expect(await answerWith({ ok: true, context: { ...okContext(), capabilities: overriddenEvery } })).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
    const overriddenIterator = Object.assign(['finance.read', 'bad value'], { [Symbol.iterator]: function* () { yield 'finance.read'; } });
    expect(await answerWith({ ok: true, context: { ...okContext(), capabilities: overriddenIterator } })).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
    const arrayLike = { 0: 'finance.read', length: 1 };
    expect(await answerWith({ ok: true, context: { ...okContext(), capabilities: arrayLike } })).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
    const sparse = ['finance.read']; sparse.length = 2;
    expect(await answerWith({ ok: true, context: { ...okContext(), capabilities: sparse } })).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
  });

  it('ignores a polluted Object.prototype', async () => {
    const proto = Object.prototype as Record<string, unknown>;
    try {
      proto.ok = true; proto.context = okContext(); proto.environment = 'production'; proto.billingMode = 'live'; proto.role = 7;
      expect(await answerWith({})).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
      expect(await answerWith({ ok: true })).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
      expect(await answerWith({ ok: true, context: omit(okContext(), 'environment') })).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
      const decision = await answerWith({ ok: true, context: okContext() });
      expect(decision.status).toBe('allowed');
      if (decision.status === 'allowed') expect(decision.trustedScope).toEqual({ tenantId: 'account:a', projectId: 'event:e', environment: 'test', billingMode: 'simulated', actorId: 'account:a' });
    } finally {
      for (const key of ['ok', 'context', 'environment', 'billingMode', 'role']) delete proto[key];
    }
    expect(Object.hasOwn(Object.prototype, 'ok')).toBe(false);
  });

  it('de-duplicates capabilities, drops unknown fields and returns frozen fresh objects', async () => {
    const capabilities = ['finance.read', 'finance.read', 'finance.export'];
    const decision = await answerWith({ ok: true, context: { ...okContext(), capabilities, extra: 'smuggled', scope: victimScope, role: 'captain' }, extra: true });
    expect(decision.status).toBe('allowed');
    if (decision.status !== 'allowed') return;
    expect(decision.capabilities).toEqual(['finance.read', 'finance.export']);
    expect(decision.capabilities).not.toBe(capabilities);
    capabilities.push('finance.command.refund');
    expect(decision.capabilities).toEqual(['finance.read', 'finance.export']);
    expect(Object.keys(decision).sort()).toEqual(['actorId', 'capabilities', 'expiresAt', 'revision', 'route', 'scope', 'status', 'trustedScope']);
    expect(Object.keys(decision.trustedScope).sort()).toEqual(['actorId', 'billingMode', 'environment', 'projectId', 'tenantId']);
    expect(JSON.stringify(decision)).not.toContain('smuggled');
    expect([decision, decision.scope, decision.trustedScope, decision.capabilities].every(Object.isFrozen)).toBe(true);
  });
});

describe('TD-07 forged HostAccess projections grant nothing', () => {
  it('rejects a forged HostAccess object used as a credential', async () => {
    const { authorizer, guarded, read, verifier } = setup();
    expect(await authorizer.authorize({ credential: forgedAccess, route: 'overview' })).toEqual({ status: 'denied', reason: 'unauthenticated', cause: 'invalid_credential' });
    expect(await guarded({ credential: forgedAccess, pathname: base, signal: signal() })).toEqual(RESTRICTED);
    expect(verifier.calls).toBe(0); expect(read).not.toHaveBeenCalled();
  });

  // String forms only prove the fixture's signature check here: in production their rejection rests entirely on the host verifier.
  it('rejects forged HostAccess serialized as JSON, base64 or an unsigned token', async () => {
    const { guarded, read } = setup();
    const json = JSON.stringify(forgedAccess);
    const b64 = Buffer.from(json).toString('base64url');
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...captainClaims(), ...victimScope })).toString('base64url')}.`;
    for (const credential of [json, b64, `${b64}.${b64}.${b64}`, unsigned, 'authorized', forgedAccess.revision]) {
      expect(await guarded({ credential, pathname: base, signal: signal() })).toEqual(RESTRICTED);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('ignores a forged scope or access smuggled next to a valid credential', async () => {
    const { guarded, read } = setup();
    const smuggled = { credential: captain, pathname: base, signal: signal(), scope: victimScope, access: forgedAccess, tenantId: victimScope.tenantId } as never;
    expect(await guarded(smuggled)).toEqual({ state: { status: 'ready', data: 'records-for:account:acc_FIXTURE_captain1/event:evt_fx_1' }, access: CAPTAIN_ACCESS });
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]![0].scope).toEqual({ tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1' });
  });

  it('a projection issued to one user is not a credential for anyone', async () => {
    const { authorizer, guarded, read } = setup();
    const genuine = toHostAccessProjection(await authorizer.authorize({ credential: captain, route: 'overview' }));
    expect(genuine.status).toBe('authorized');
    expect(await guarded({ credential: genuine, pathname: base, signal: signal() })).toEqual(RESTRICTED);
    expect(await guarded({ credential: JSON.stringify(genuine), pathname: base, signal: signal() })).toEqual(RESTRICTED);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('TD-07 guarded server reads', () => {
  it.each(['\u2028', '\u2029', '\u202e', '\u202a', '\u2066'])('rejects Unicode audit revision control %j before reads or allowed audit output', async (control) => {
    const revision = `before${control}after`;
    const authorizer = createDashboardAuthorizer({ verifier: { verify: async () => ({ ok: true, context: { ...captainClaims(), revision } }) }, audience: FIXTURE_AUDIENCE, now });
    const read = vi.fn(async (): Promise<RouteState<string>> => ({ status: 'ready', data: 'synthetic-canary' }));
    const onOutcome = vi.fn();
    const guarded = createGuardedRouteReader({ authorizer, basePath: base, read, onOutcome });
    expect(await authorizer.authorize({ credential: captain, route: 'overview' })).toEqual({ status: 'unavailable', cause: 'malformed_answer' });
    expect(await guarded({ credential: captain, pathname: base, signal: signal() })).toEqual({ state: { status: 'unavailable' }, access: { status: 'unavailable' } });
    expect(read).not.toHaveBeenCalled();
    expect(onOutcome).toHaveBeenCalledWith({ status: 'unavailable', route: 'overview', cause: 'malformed_answer' });
    expect(JSON.stringify(onOutcome.mock.calls)).not.toContain('before');
  });

  it('accepts a bounded visible ASCII revision unchanged in the verified projection and audit outcome', async () => {
    const revision = `account:synthetic@2!~${'x'.repeat(235)}`;
    expect(revision).toHaveLength(256);
    const authorizer = createDashboardAuthorizer({ verifier: { verify: async () => ({ ok: true, context: { ...captainClaims(), revision } }) }, audience: FIXTURE_AUDIENCE, now });
    const onOutcome = vi.fn();
    const guarded = createGuardedRouteReader({ authorizer, basePath: base, read: async () => ({ status: 'empty' }), onOutcome });
    const result = await guarded({ credential: captain, pathname: base, signal: signal() });
    expect(result.access).toMatchObject({ status: 'authorized', revision });
    expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'allowed', revision, read: 'ok' }));
  });

  it('rejects a ready data accessor without invoking it or classifying it as a retryable read error', async () => {
    const getter = vi.fn(() => { throw new Error('synthetic-secret-error'); });
    const { authorizer } = setup();
    const guarded = createGuardedRouteReader({ authorizer, basePath: base, read: async () => Object.defineProperty({ status: 'ready' }, 'data', { get: getter }) as RouteState<string> });
    expect((await guarded({ credential: captain, pathname: base, signal: signal() })).state).toEqual({ status: 'error', retryable: false });
    expect(getter).not.toHaveBeenCalled();
  });

  it('passes the verified revision, expiry and finance trusted scope to the read and labels the result with its scope', async () => {
    const { guarded, read } = setup();
    const result = await guarded({ credential: captain, pathname: base, signal: signal() });
    expect(result).toEqual({ state: { status: 'ready', data: 'records-for:account:acc_FIXTURE_captain1/event:evt_fx_1' }, access: CAPTAIN_ACCESS });
    expect(Object.isFrozen(result)).toBe(true);
    const request = read.mock.calls[0]![0];
    expect(request.revision).toBe('account:acc_FIXTURE_captain1@2');
    expect(request.expiresAt).toBe('2026-10-10T12:05:00.000Z');
    expect(request.trustedScope).toEqual({ tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1', environment: 'test', billingMode: 'simulated', actorId: 'account:acc_FIXTURE_captain1' });
  });

  it('re-authorizes every read so revocation takes effect immediately', async () => {
    const { guarded, read, state } = setup();
    expect((await guarded({ credential: captain, pathname: `${base}/transactions/tx-1`, signal: signal() })).state.status).toBe('ready');
    expect(read.mock.calls[0]![0].route).toEqual({ id: 'transaction-detail', label: 'Transaction detail', params: { id: 'tx-1' } });
    state.liveSessions.delete('session-captain');
    expect(await guarded({ credential: captain, pathname: base, signal: signal() })).toEqual(RESTRICTED);
    state.liveSessions.add('session-captain'); state.membershipRevision.set('account:acc_FIXTURE_captain1', 3);
    expect(await guarded({ credential: captain, pathname: base, signal: signal() })).toEqual(RESTRICTED);
    expect(read).toHaveBeenCalledOnce();
  });

  it('denies export reads without the export grant and never reaches the reader', async () => {
    const { guarded, read } = setup();
    expect(await guarded({ credential: member, pathname: `${base}/reports/exports`, signal: signal() })).toEqual(RESTRICTED);
    expect((await guarded({ credential: member, pathname: `${base}/reports`, signal: signal() })).state.status).toBe('ready');
    expect((await guarded({ credential: captain, pathname: `${base}/reports/exports`, signal: signal() })).state.status).toBe('ready');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('returns unavailable for unknown paths and verifier outages without reading', async () => {
    const { guarded, read } = setup();
    for (const pathname of ['/admin/other', `${base}/missing`, `${base}?tenant=x`, `${base}/transactions/..`]) expect(await guarded({ credential: captain, pathname, signal: signal() })).toEqual(UNAVAILABLE);
    const down = createGuardedRouteReader({ authorizer: createDashboardAuthorizer({ verifier: { verify: async () => { throw new Error('down'); } }, audience: FIXTURE_AUDIENCE, now }), basePath: base, read });
    expect(await down({ credential: captain, pathname: base, signal: signal() })).toEqual(UNAVAILABLE);
    expect(read).not.toHaveBeenCalled();
  });

  it('uses safe states for reader errors, malformed results and cancellation', async () => {
    const authorizer = createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: FIXTURE_AUDIENCE, now });
    const failing = createGuardedRouteReader<string>({ authorizer, basePath: base, read: async () => { throw new Error('secret-canary'); } });
    expect(await failing({ credential: captain, pathname: base, signal: signal() })).toEqual({ state: { status: 'error', retryable: true }, access: CAPTAIN_ACCESS });
    const malformed = createGuardedRouteReader<string>({ authorizer, basePath: base, read: async () => ({ status: 'loading' }) });
    expect(await malformed({ credential: captain, pathname: base, signal: signal() })).toEqual({ state: { status: 'error', retryable: false }, access: CAPTAIN_ACCESS });
    const controller = new AbortController();
    const cancelled = createGuardedRouteReader<string>({ authorizer, basePath: base, read: async () => { controller.abort(); return { status: 'ready', data: 'late-canary' }; } });
    const result = await cancelled({ credential: captain, pathname: base, signal: controller.signal });
    expect(result.state).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('late-canary');
  });

  it('enforces a server-side deadline on the host read and aborts its signal', async () => {
    const authorizer = createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: FIXTURE_AUDIENCE, now });
    let readSignal: AbortSignal | undefined;
    const outcomes: GuardedReadOutcome[] = [];
    const hung = createGuardedRouteReader<string>({ authorizer, basePath: base, readTimeoutMs: 20, onOutcome: (outcome) => outcomes.push(outcome), read: ({ signal: s }) => { readSignal = s; return new Promise(() => undefined); } });
    expect(await hung({ credential: captain, pathname: base, signal: signal() })).toEqual({ state: { status: 'unavailable' }, access: CAPTAIN_ACCESS });
    expect(readSignal?.aborted).toBe(true);
    expect(outcomes).toEqual([{ status: 'allowed', route: 'overview', actorId: 'account:acc_FIXTURE_captain1', revision: 'account:acc_FIXTURE_captain1@2', read: 'timeout' }]);
  });

  it('swallows a rejected async audit hook instead of raising an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const authorizer = createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: FIXTURE_AUDIENCE, now });
      const guarded = createGuardedRouteReader<string>({ authorizer, basePath: base, onOutcome: async () => { throw new Error('audit backend down'); }, read: async () => ({ status: 'empty' }) });
      expect(await guarded({ credential: captain, pathname: base, signal: signal() })).toMatchObject({ state: { status: 'empty' } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('swallows rejected cross-realm promises and thenables from the audit hook', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const authorizer = createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: FIXTURE_AUDIENCE, now });
      const crossRealmHook = runInNewContext('(async function () { throw new Error("cross-realm audit failure"); })') as (outcome: GuardedReadOutcome) => unknown;
      const rejectedThenable = () => ({ then: (_resolve: (value: unknown) => void, reject: (reason: unknown) => void) => reject(new Error('thenable audit failure')) });
      for (const onOutcome of [crossRealmHook, rejectedThenable]) {
        const guarded = createGuardedRouteReader<string>({ authorizer, basePath: base, onOutcome, read: async () => ({ status: 'empty' }) });
        expect(await guarded({ credential: captain, pathname: base, signal: signal() })).toMatchObject({ state: { status: 'empty' } });
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('reports the denial cause to a server-only hook and never in the result', async () => {
    const outcomes: GuardedReadOutcome[] = [];
    const state = hostState();
    const authorizer = createDashboardAuthorizer({ verifier: fixtureVerifier(state), audience: FIXTURE_AUDIENCE, now });
    const guarded = createGuardedRouteReader<string>({ authorizer, basePath: base, onOutcome: (outcome) => { outcomes.push(outcome); throw new Error('audit hook failure'); }, read: async () => ({ status: 'empty' }) });
    state.liveSessions.delete('session-captain');
    const revoked = await guarded({ credential: captain, pathname: base, signal: signal() });
    state.liveSessions.add('session-captain');
    const stale = await guarded({ credential: issueFixtureToken(captainClaims({ membershipRevision: 1 })), pathname: base, signal: signal() });
    const expired = await guarded({ credential: issueFixtureToken(captainClaims({ expiresAt: '2026-10-10T11:00:00Z' })), pathname: base, signal: signal() });
    const unknown = await guarded({ credential: captain, pathname: `${base}/nope`, signal: signal() });
    for (const result of [revoked, stale, expired]) expect(result).toEqual(RESTRICTED);
    expect(unknown).toEqual(UNAVAILABLE);
    for (const result of [revoked, stale, expired, unknown]) expect(JSON.stringify(result)).not.toMatch(/revoked|stale|expired|cause|unknown_path/u);
    expect(outcomes).toEqual([
      { status: 'denied', route: 'overview', reason: 'unauthenticated', cause: 'revoked' },
      { status: 'denied', route: 'overview', reason: 'unauthenticated', cause: 'stale' },
      { status: 'denied', route: 'overview', reason: 'unauthenticated', cause: 'expired' },
      { status: 'unavailable', cause: 'unknown_path' },
    ]);
  });
});

describe('TD-07 object-level authorization on detail routes', () => {
  /** Host fixture that follows the TD-07 rule: look up by id within the verified scope; "not yours" and "does not exist" are one state. */
  const records = new Map([
    ['transaction-detail:tx-own', { tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1', data: 'own-transaction' }],
    ['transaction-detail:tx-victim', { tenantId: victimScope.tenantId, projectId: victimScope.projectId, data: 'victim-transaction-canary' }],
    ['transaction-detail:tx-same-tenant-other-project', { tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_9', data: 'other-project-canary' }],
    ['event-detail:evt_fx_1', { tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1', data: 'own-event' }],
    ['event-detail:evt_fx_2', { tenantId: victimScope.tenantId, projectId: victimScope.projectId, data: 'victim-event-canary' }],
  ]);
  function detailSetup() {
    const authorizer = createDashboardAuthorizer({ verifier: fixtureVerifier(hostState()), audience: FIXTURE_AUDIENCE, now });
    const read = vi.fn(async ({ route, scope }: TrustedReadRequest): Promise<RouteState<string>> => {
      const record = records.get(`${route.id}:${route.params.id ?? ''}`);
      return record && record.tenantId === scope.tenantId && record.projectId === scope.projectId ? { status: 'ready', data: record.data } : { status: 'empty' };
    });
    return { read, guarded: createGuardedRouteReader({ authorizer, basePath: base, read }) };
  }

  it.each([
    ['transactions', 'tx-own', 'tx-victim'], ['transactions', 'tx-own', 'tx-same-tenant-other-project'],
    ['transactions', 'tx-own', encodeURIComponent('tx-victim?tenant=account:acc_FIXTURE_other')], ['transactions', 'tx-own', encodeURIComponent(victimScope.tenantId)],
    ['events', 'evt_fx_1', 'evt_fx_2'], ['events', 'evt_fx_1', encodeURIComponent(victimScope.projectId)],
  ])('a forged %s id outside the verified scope looks exactly like a nonexistent one', async (section, own, forged) => {
    const { guarded, read } = detailSetup();
    const ownResult = await guarded({ credential: captain, pathname: `${base}/${section}/${own}`, signal: signal() });
    const forgedResult = await guarded({ credential: captain, pathname: `${base}/${section}/${forged}`, signal: signal() });
    const missingResult = await guarded({ credential: captain, pathname: `${base}/${section}/does-not-exist-9f3`, signal: signal() });
    expect(ownResult.state.status).toBe('ready');
    expect(forgedResult).toEqual(missingResult);
    expect(forgedResult).toEqual({ state: { status: 'empty' }, access: CAPTAIN_ACCESS });
    expect(JSON.stringify(forgedResult)).not.toMatch(/canary/u);
    for (const call of read.mock.calls) expect(call[0].scope).toEqual({ tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1' });
  });

  it('a forged project selector on a detail route is not_found before the reader runs', async () => {
    const { guarded, read } = detailSetup();
    expect(await guarded({ credential: captain, pathname: `${base}/transactions/tx-victim`, projectId: victimScope.projectId, signal: signal() })).toEqual(RESTRICTED);
    expect(await guarded({ credential: captain, pathname: `${base}/transactions/tx-victim`, projectId: 'event:does_not_exist', signal: signal() })).toEqual(RESTRICTED);
    expect(read).not.toHaveBeenCalled();
  });
});

const RESTRICTED = { state: { status: 'restricted' }, access: { status: 'restricted' } };
const UNAVAILABLE = { state: { status: 'unavailable' }, access: { status: 'unavailable' } };
const CAPTAIN_ACCESS = { status: 'authorized', scope: { tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1' }, revision: 'account:acc_FIXTURE_captain1@2' };

function okContext() {
  return { actorId: 'account:a', tenantId: 'account:a', projectId: 'event:e', environment: 'test', billingMode: 'simulated', revision: 'r1', capabilities: ['finance.read'], audience: FIXTURE_AUDIENCE, expiresAt: '2026-10-10T12:05:00.000Z' };
}
function omit<T extends object>(value: T, key: keyof T): Partial<T> { const copy = { ...value }; delete copy[key]; return copy; }
function answerWith(answer: unknown, options: { maxContextTtlMs?: number } = {}) {
  return createDashboardAuthorizer({ verifier: { verify: async () => answer as never }, audience: FIXTURE_AUDIENCE, now, ...options }).authorize({ credential: captain, route: 'overview' });
}
/** Runs `run` with the process timezone set to UTC and then America/Los_Angeles, proving the switch took effect. */
async function inTimeZones(run: (timeZone: string) => Promise<void>) {
  const original = process.env.TZ;
  try {
    for (const [timeZone, localHour] of [['UTC', 12], ['America/Los_Angeles', 5]] as const) {
      process.env.TZ = timeZone;
      expect(new Date('2026-10-10T12:00:00Z').getHours()).toBe(localHour);
      await run(timeZone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
}
