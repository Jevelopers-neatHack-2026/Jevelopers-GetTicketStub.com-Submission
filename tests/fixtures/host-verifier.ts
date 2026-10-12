import { createHmac, timingSafeEqual } from 'node:crypto';
import type { HostSessionVerifier, TrustedHostContext, VerifyResult } from '../../src/server';

/**
 * Offline test double of a host session verifier. It models what a real host must do: check an HMAC
 * signature, audience and expiry, then re-check the live session and membership revision from its own
 * state. The key is a published test value that no deployment holds.
 */
export const FIXTURE_AUDIENCE = 'ticketstub.finance';
export const FIXTURE_NOW = new Date('2026-10-10T12:00:00.000Z');
const FIXTURE_KEY = 'team-dashboard-fixture-key-not-a-secret-0000000000';
type Claims = Omit<TrustedHostContext, 'revision'> & { sessionId: string; membershipRevision: number };
export type HostState = { liveSessions: Set<string>; membershipRevision: Map<string, number>; projectMembers: Map<string, Set<string>> };

const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const sign = (body: string) => createHmac('sha256', FIXTURE_KEY).update(body).digest('base64url');
export function issueFixtureToken(claims: Claims): string {
  const body = `${encode(JSON.stringify({ alg: 'HS256', typ: 'fixture.context' }))}.${encode(JSON.stringify(claims))}`;
  return `${body}.${sign(body)}`;
}
export function captainClaims(overrides: Partial<Claims> = {}): Claims {
  return {
    actorId: 'account:acc_FIXTURE_captain1', tenantId: 'account:acc_FIXTURE_captain1', projectId: 'event:evt_fx_1', role: 'captain',
    capabilities: ['event.read', 'finance.read', 'finance.export'], audience: FIXTURE_AUDIENCE, expiresAt: '2026-10-10T12:05:00.000Z',
    sessionId: 'session-captain', membershipRevision: 2, ...overrides,
  };
}
export function hostState(): HostState {
  return {
    liveSessions: new Set(['session-captain', 'session-member', 'session-other']),
    membershipRevision: new Map([['account:acc_FIXTURE_captain1', 2], ['account:acc_FIXTURE_member1', 1], ['account:acc_FIXTURE_other', 1]]),
    projectMembers: new Map([['event:evt_fx_1', new Set(['account:acc_FIXTURE_captain1', 'account:acc_FIXTURE_member1'])], ['event:evt_fx_2', new Set(['account:acc_FIXTURE_other'])]]),
  };
}
export function fixtureVerifier(state: HostState, now: () => Date = () => FIXTURE_NOW): HostSessionVerifier & { calls: number } {
  const verifier = {
    calls: 0,
    async verify({ credential, audience }: { credential: string; audience: string }): Promise<VerifyResult> {
      verifier.calls += 1;
      const parts = credential.split('.');
      if (parts.length !== 3) return { ok: false, reason: 'malformed' };
      const [header, payload, signature] = parts as [string, string, string];
      const expected = Buffer.from(sign(`${header}.${payload}`));
      const actual = Buffer.from(signature);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: 'forged' };
      let claims: Claims;
      try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Claims; } catch { return { ok: false, reason: 'malformed' }; }
      if (Date.parse(claims.expiresAt) <= now().getTime()) return { ok: false, reason: 'expired' };
      if (claims.audience !== audience) return { ok: false, reason: 'wrong_audience' };
      if (!state.liveSessions.has(claims.sessionId)) return { ok: false, reason: 'revoked' };
      if (!state.projectMembers.get(claims.projectId)?.has(claims.actorId)) return { ok: false, reason: 'revoked' };
      if (state.membershipRevision.get(claims.actorId) !== claims.membershipRevision) return { ok: false, reason: 'stale' };
      const context: Record<string, unknown> = { ...claims, revision: `${claims.actorId}@${claims.membershipRevision}` };
      delete context.sessionId; delete context.membershipRevision;
      return { ok: true, context: context as TrustedHostContext };
    },
  };
  return verifier;
}
