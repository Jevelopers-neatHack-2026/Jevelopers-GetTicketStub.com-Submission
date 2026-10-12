import { resolveRoute, type ResolvedRoute, type RouteId } from '../../integration/routes';
import { isRouteState, type RouteState } from '../data/boundary';
import type { HostAccess, HostScope } from './host';
import { requiredCapabilities } from './permissions';

/**
 * Server-side trust seam. The host server passes an opaque credential that it holds itself (for example a
 * signed context token derived from its httpOnly session), never a value the browser chose. The injected
 * verifier is the only component allowed to turn that credential into identity, membership and grants.
 */
export type HostCredential = string;
export type VerifyFailure = 'missing' | 'malformed' | 'forged' | 'unsupported_version' | 'expired' | 'wrong_audience' | 'revoked' | 'stale' | 'unavailable';
export type TrustedHostContext = Readonly<{
  actorId: string;
  tenantId: string;
  projectId: string;
  /** Changes whenever session, membership or grants change. */
  revision: string;
  /** Explicit host grants. These, not `role`, drive every decision. */
  capabilities: readonly string[];
  audience: string;
  /** ISO-8601 instant after which the verified context must not be used. */
  expiresAt: string;
  /** Informational only; never consulted for authorization. */
  role?: string;
}>;
export type VerifyResult = { ok: true; context: TrustedHostContext } | { ok: false; reason: VerifyFailure };
export type VerifyRequest = Readonly<{ credential: HostCredential; audience: string; signal: AbortSignal }>;
/** Implemented by the host (identity provider decision pending); must re-check session and membership. */
export interface HostSessionVerifier { verify(request: VerifyRequest): Promise<VerifyResult> }

export type DenyReason = 'unauthenticated' | 'forbidden' | 'not_found';
export type AuthorizationDecision =
  | Readonly<{ status: 'allowed'; route: RouteId; scope: HostScope; actorId: string; revision: string; capabilities: readonly string[] }>
  | Readonly<{ status: 'denied'; reason: DenyReason }>
  | Readonly<{ status: 'unavailable' }>;
export type AuthorizeInput = Readonly<{
  credential: unknown;
  route: RouteId;
  /** A project the caller asks about. It can only narrow: a mismatch with the verified project is not_found. */
  projectId?: string | undefined;
  signal?: AbortSignal | undefined;
}>;
export interface DashboardAuthorizer { authorize(input: AuthorizeInput): Promise<AuthorizationDecision> }
export type AuthorizerOptions = Readonly<{
  verifier: HostSessionVerifier;
  /** Audience the host issues dashboard contexts for; supplied by host code, not read from the environment. */
  audience: string;
  now?: () => Date;
  timeoutMs?: number;
}>;

const MAX_CREDENTIAL_LENGTH = 8192;
const IDENTIFIER = /^[\w.:-]{1,128}$/u;
const CAPABILITY = /^[a-z][\w.:-]{0,127}$/u;
const VERIFY_FAILURES: ReadonlySet<string> = new Set<VerifyFailure>(['missing', 'malformed', 'forged', 'unsupported_version', 'expired', 'wrong_audience', 'revoked', 'stale', 'unavailable']);
const DENIED = (reason: DenyReason): AuthorizationDecision => Object.freeze({ status: 'denied', reason });
const UNAVAILABLE: AuthorizationDecision = Object.freeze({ status: 'unavailable' });

function isCredential(value: unknown): value is HostCredential {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CREDENTIAL_LENGTH && value.trim() === value
    && ![...value].some((character) => { const code = character.charCodeAt(0); return code < 33 || code === 127; });
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validIdentifier(value: unknown): value is string { return typeof value === 'string' && IDENTIFIER.test(value); }

/** Treat the verifier's answer as untrusted shape: anything unexpected fails closed. */
function parseVerifyResult(value: unknown, audience: string, now: Date): { context: TrustedHostContext } | { failure: VerifyFailure } | undefined {
  if (!isRecord(value)) return undefined;
  if (value.ok === false) return typeof value.reason === 'string' && VERIFY_FAILURES.has(value.reason) ? { failure: value.reason as VerifyFailure } : undefined;
  if (value.ok !== true || !isRecord(value.context)) return undefined;
  const context = value.context;
  if (!validIdentifier(context.actorId) || !validIdentifier(context.tenantId) || !validIdentifier(context.projectId)) return undefined;
  if (typeof context.revision !== 'string' || context.revision.trim().length === 0 || context.revision.length > 256) return undefined;
  if (!Array.isArray(context.capabilities) || context.capabilities.length > 256 || !context.capabilities.every((item) => typeof item === 'string' && CAPABILITY.test(item))) return undefined;
  if (context.role !== undefined && typeof context.role !== 'string') return undefined;
  if (context.audience !== audience) return { failure: 'wrong_audience' };
  if (typeof context.expiresAt !== 'string') return undefined;
  const expires = Date.parse(context.expiresAt);
  if (!Number.isFinite(expires)) return undefined;
  if (expires <= now.getTime()) return { failure: 'expired' };
  return { context: Object.freeze({
    actorId: context.actorId, tenantId: context.tenantId, projectId: context.projectId, revision: context.revision,
    capabilities: Object.freeze([...new Set(context.capabilities as string[])]), audience, expiresAt: context.expiresAt,
  }) };
}

async function verifyWithDeadline(verifier: HostSessionVerifier, credential: HostCredential, audience: string, timeoutMs: number, outer: AbortSignal | undefined): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); });
    const cancelled = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    if (outer?.aborted) throw new Error('aborted');
    return await Promise.race([Promise.resolve().then(() => verifier.verify({ credential, audience, signal: controller.signal })), deadline, cancelled]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', abort);
  }
}

export function createDashboardAuthorizer({ verifier, audience, now = () => new Date(), timeoutMs = 5000 }: AuthorizerOptions): DashboardAuthorizer {
  if (!verifier || typeof verifier.verify !== 'function') throw new Error('A host session verifier is required.');
  if (typeof audience !== 'string' || audience.trim().length === 0) throw new Error('A dashboard audience is required.');
  return Object.freeze({
    async authorize({ credential, route, projectId, signal }: AuthorizeInput): Promise<AuthorizationDecision> {
      const required = requiredCapabilities(route);
      if (!required) return DENIED('not_found');
      // A browser HostAccess projection, an object or any non-opaque value is never a credential.
      if (!isCredential(credential)) return DENIED('unauthenticated');
      if (projectId !== undefined && !validIdentifier(projectId)) return DENIED('not_found');
      let raw: unknown;
      try { raw = await verifyWithDeadline(verifier, credential, audience, timeoutMs, signal); } catch { return UNAVAILABLE; }
      const parsed = parseVerifyResult(raw, audience, now());
      if (!parsed) return UNAVAILABLE;
      if ('failure' in parsed) return parsed.failure === 'unavailable' ? UNAVAILABLE : DENIED('unauthenticated');
      const { context } = parsed;
      // A project the caller does not hold is indistinguishable from one that does not exist.
      if (projectId !== undefined && projectId !== context.projectId) return DENIED('not_found');
      const granted = new Set(context.capabilities);
      if (!required.every((capability) => granted.has(capability))) return DENIED('forbidden');
      return Object.freeze({ status: 'allowed', route, scope: Object.freeze({ tenantId: context.tenantId, projectId: context.projectId }), actorId: context.actorId, revision: context.revision, capabilities: context.capabilities });
    },
  });
}

/** Display-only projection for the client `Dashboard`. Its output is never accepted back as a credential. */
export function toHostAccessProjection(decision: AuthorizationDecision): HostAccess {
  if (decision.status === 'allowed') return { status: 'authorized', scope: { tenantId: decision.scope.tenantId, projectId: decision.scope.projectId }, revision: decision.revision };
  return decision.status === 'denied' ? { status: 'restricted' } : { status: 'unavailable' };
}

export type TrustedReadRequest = Readonly<{ route: ResolvedRoute; scope: HostScope; actorId: string; capabilities: readonly string[]; signal: AbortSignal }>;
export type GuardedReadInput = Readonly<{ credential: unknown; pathname: string; projectId?: string | undefined; signal: AbortSignal }>;
export type GuardedRouteReader<T> = (input: GuardedReadInput) => Promise<RouteState<T>>;

/**
 * Wraps a host server read so that every read is re-authorized against the verified context. The read
 * function receives only verified scope; the input deliberately has no scope or access field to forge.
 */
export function createGuardedRouteReader<T>({ authorizer, basePath, read }: Readonly<{
  authorizer: DashboardAuthorizer; basePath: string; read: (request: TrustedReadRequest) => Promise<RouteState<T>>;
}>): GuardedRouteReader<T> {
  return async ({ credential, pathname, projectId, signal }) => {
    const resolved = resolveRoute(basePath, pathname);
    if (resolved.status !== 'found') return { status: 'unavailable' };
    const decision = await authorizer.authorize({ credential, route: resolved.route.id, projectId, signal });
    if (decision.status === 'denied') return { status: 'restricted' };
    if (decision.status !== 'allowed' || signal.aborted) return { status: 'unavailable' };
    try {
      const state = await read({ route: resolved.route, scope: decision.scope, actorId: decision.actorId, capabilities: decision.capabilities, signal });
      if (signal.aborted) return { status: 'unavailable' };
      return isRouteState(state) && state.status !== 'loading' ? state as RouteState<T> : { status: 'error', retryable: false };
    } catch {
      return { status: 'error', retryable: true };
    }
  };
}
