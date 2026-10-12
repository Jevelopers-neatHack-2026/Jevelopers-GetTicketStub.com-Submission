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
/** Finance `TrustedScope` vocabulary (cost-intelligence); getticketstub.com #42 maps its `/2` modes onto it. */
export type FinanceEnvironment = 'development' | 'test' | 'production';
export type BillingMode = 'live' | 'sandbox' | 'simulated';
export type TrustedHostContext = Readonly<{
  actorId: string;
  tenantId: string;
  projectId: string;
  /** Finance execution context, already mapped by the host (`ticketstub.finance-scope-adapter/1`). */
  environment: FinanceEnvironment;
  /** Finance economic behavior, already mapped by the host. `paid_test` maps to `live`. */
  billingMode: BillingMode;
  /** Changes whenever session, membership or grants change (for #42: derived from `membershipRevision`). */
  revision: string;
  /** Explicit host grants. These, not `role`, drive every decision. */
  capabilities: readonly string[];
  audience: string;
  /** Strict ISO-8601 instant with `Z` or an explicit offset, after which the context must not be used. */
  expiresAt: string;
  /** Informational only; never consulted for authorization. */
  role?: string;
}>;
/** Exactly the five fields of cost-intelligence's `TrustedScope`, built only from the verified context. */
export type TrustedScope = Readonly<{ tenantId: string; projectId: string; environment: FinanceEnvironment; billingMode: BillingMode; actorId: string }>;
export type VerifyResult = { ok: true; context: TrustedHostContext } | { ok: false; reason: VerifyFailure };
export type VerifyRequest = Readonly<{ credential: HostCredential; audience: string; signal: AbortSignal }>;
/** Implemented by the host (identity provider decision pending); must re-check session and membership. */
export interface HostSessionVerifier { verify(request: VerifyRequest): Promise<VerifyResult> }

export type DenyReason = 'unauthenticated' | 'forbidden' | 'not_found';
/** Server-only detail for logs and audit. `toHostAccessProjection` drops it; never send it to the browser. */
export type DenyCause = Exclude<VerifyFailure, 'unavailable'> | 'invalid_credential' | 'lifetime_exceeded' | 'unknown_route' | 'project_mismatch' | 'missing_capability';
export type UnavailableCause = 'verifier_unavailable' | 'verifier_error' | 'timeout' | 'aborted' | 'malformed_answer';
export type AuthorizationDecision =
  | Readonly<{ status: 'allowed'; route: RouteId; scope: HostScope; trustedScope: TrustedScope; actorId: string; revision: string; expiresAt: string; capabilities: readonly string[] }>
  | Readonly<{ status: 'denied'; reason: DenyReason; cause: DenyCause }>
  | Readonly<{ status: 'unavailable'; cause: UnavailableCause }>;
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
  /** Verifier deadline in ms. Integer in [1, 60000]; default 5000. */
  timeoutMs?: number;
  /**
   * Longest remaining lifetime a verified context may claim, in ms. A context whose `expiresAt` is later than
   * `now + maxContextTtlMs` is denied (`lifetime_exceeded`). Integer in [1000, 86400000]; default 900000 (15 min;
   * #42 issues 5 min tokens).
   */
  maxContextTtlMs?: number;
}>;

export const TIMEOUT_LIMITS = Object.freeze({ min: 1, max: 60_000 });
export const CONTEXT_TTL_LIMITS = Object.freeze({ min: 1_000, max: 86_400_000 });
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_READ_TIMEOUT_MS = 9_000;
// Rejects C0/C1 controls so a verifier-supplied revision cannot forge audit log lines.
const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
};
const DEFAULT_MAX_CONTEXT_TTL_MS = 900_000;
const MAX_CREDENTIAL_LENGTH = 8192;
const MAX_CAPABILITIES = 256;
const IDENTIFIER = /^[\w.:-]{1,128}$/u;
const CAPABILITY = /^[a-z][\w.:-]{0,127}$/u;
/** Strict instant: no local-time form, no RFC 2822, no date-only form. */
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/u;
const VERIFY_FAILURES: ReadonlySet<string> = new Set<VerifyFailure>(['missing', 'malformed', 'forged', 'unsupported_version', 'expired', 'wrong_audience', 'revoked', 'stale', 'unavailable']);
const ENVIRONMENTS: ReadonlySet<string> = new Set<FinanceEnvironment>(['development', 'test', 'production']);
const BILLING_MODES: ReadonlySet<string> = new Set<BillingMode>(['live', 'sandbox', 'simulated']);
const DENIED = (reason: DenyReason, cause: DenyCause): AuthorizationDecision => Object.freeze({ status: 'denied', reason, cause });
const UNAVAILABLE = (cause: UnavailableCause): AuthorizationDecision => Object.freeze({ status: 'unavailable', cause });

function boundedInteger(name: string, value: number, limits: Readonly<{ min: number; max: number }>): number {
  if (!Number.isInteger(value) || value < limits.min || value > limits.max) throw new Error(`${name} must be an integer between ${limits.min} and ${limits.max}.`);
  return value;
}
function isCredential(value: unknown): value is HostCredential {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CREDENTIAL_LENGTH && value.trim() === value
    && ![...value].some((character) => { const code = character.charCodeAt(0); return code < 33 || code === 127; });
}
function validIdentifier(value: unknown): value is string { return typeof value === 'string' && IDENTIFIER.test(value); }

/** Parses a strict ISO-8601 instant to epoch ms without consulting the server's timezone. */
export function parseInstant(value: string): number | undefined {
  const match = ISO_INSTANT.exec(value);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const millis = Number((match[7] ?? '0').padEnd(3, '0'));
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return undefined;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return undefined;
  let offset = 0;
  if (match[8]) {
    const offsetHours = Number(match[9]); const offsetMinutes = Number(match[10]);
    if (offsetHours > 23 || offsetMinutes > 59) return undefined;
    offset = (match[8] === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60_000;
  }
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, millis);
  return utc.getTime() - offset;
}

/**
 * Reads one own data property exactly once. Accessors, inherited values (including a polluted
 * `Object.prototype`) and throwing Proxy traps never reach validation.
 */
const ABSENT = Symbol('absent');
function ownValue(target: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor) return ABSENT;
  if (!('value' in descriptor)) throw new TypeError('accessor');
  return descriptor.value as unknown;
}
function isObject(value: unknown): value is object { return value !== null && typeof value === 'object'; }
function isPlainRecord(value: unknown): value is object { return isObject(value) && !Array.isArray(value); }
/** Copies a verified real array by index into a fresh array; an overridden `every`, iterator or length getter cannot intervene. */
function copyArray(value: unknown, max: number): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const length = ownValue(value, 'length');
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > max) return undefined;
  return Array.from({ length }, (_unused, index) => ownValue(value, String(index)));
}

type Parsed = { context: TrustedHostContext } | { failure: VerifyFailure } | { denied: DenyCause } | undefined;
/** Treat the verifier's answer as untrusted shape: snapshot every field once, validate only the snapshot, fail closed. */
function parseVerifyResult(value: unknown, audience: string, now: number, maxTtlMs: number): Parsed {
  if (!isPlainRecord(value)) return undefined;
  const ok = ownValue(value, 'ok');
  if (ok === false) {
    const reason = ownValue(value, 'reason');
    return typeof reason === 'string' && VERIFY_FAILURES.has(reason) ? { failure: reason as VerifyFailure } : undefined;
  }
  if (ok !== true) return undefined;
  const context = ownValue(value, 'context');
  if (!isPlainRecord(context)) return undefined;
  const actorId = ownValue(context, 'actorId');
  const tenantId = ownValue(context, 'tenantId');
  const projectId = ownValue(context, 'projectId');
  const environment = ownValue(context, 'environment');
  const billingMode = ownValue(context, 'billingMode');
  const revision = ownValue(context, 'revision');
  const capabilities = copyArray(ownValue(context, 'capabilities'), MAX_CAPABILITIES);
  const contextAudience = ownValue(context, 'audience');
  const expiresAt = ownValue(context, 'expiresAt');
  const role = ownValue(context, 'role');
  if (!validIdentifier(actorId) || !validIdentifier(tenantId) || !validIdentifier(projectId)) return undefined;
  if (typeof environment !== 'string' || !ENVIRONMENTS.has(environment) || typeof billingMode !== 'string' || !BILLING_MODES.has(billingMode)) return undefined;
  if (typeof revision !== 'string' || revision.trim().length === 0 || revision.length > 256 || hasControlCharacter(revision)) return undefined;
  if (!capabilities || !capabilities.every((item) => typeof item === 'string' && CAPABILITY.test(item))) return undefined;
  if (role !== ABSENT && role !== undefined && typeof role !== 'string') return undefined;
  if (contextAudience !== audience) return { failure: 'wrong_audience' };
  if (typeof expiresAt !== 'string') return undefined;
  const expires = parseInstant(expiresAt);
  if (expires === undefined) return undefined;
  if (expires <= now) return { failure: 'expired' };
  if (expires > now + maxTtlMs) return { denied: 'lifetime_exceeded' };
  return { context: Object.freeze({
    actorId, tenantId, projectId, environment: environment as FinanceEnvironment, billingMode: billingMode as BillingMode, revision,
    capabilities: Object.freeze([...new Set(capabilities as string[])]), audience, expiresAt,
  }) };
}

class DeadlineError extends Error {}
class AbortedError extends Error {}
/** Runs `task` with a derived signal that aborts on the outer signal or the deadline, whichever comes first. */
async function withDeadline<T>(timeoutMs: number, outer: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { reject(new DeadlineError()); controller.abort(); }, timeoutMs); });
    const cancelled = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new AbortedError()), { once: true }));
    if (outer?.aborted) throw new AbortedError();
    return await Promise.race([Promise.resolve().then(() => task(controller.signal)), deadline, cancelled]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', abort);
  }
}

export function createDashboardAuthorizer({ verifier, audience, now = () => new Date(), timeoutMs = DEFAULT_TIMEOUT_MS, maxContextTtlMs = DEFAULT_MAX_CONTEXT_TTL_MS }: AuthorizerOptions): DashboardAuthorizer {
  if (!verifier || typeof verifier.verify !== 'function') throw new Error('A host session verifier is required.');
  if (typeof audience !== 'string' || audience.trim().length === 0) throw new Error('A dashboard audience is required.');
  boundedInteger('timeoutMs', timeoutMs, TIMEOUT_LIMITS);
  boundedInteger('maxContextTtlMs', maxContextTtlMs, CONTEXT_TTL_LIMITS);
  return Object.freeze({
    async authorize({ credential, route, projectId, signal }: AuthorizeInput): Promise<AuthorizationDecision> {
      const required = requiredCapabilities(route);
      if (!required) return DENIED('not_found', 'unknown_route');
      // A browser HostAccess projection, an object or any non-opaque value is never a credential.
      if (!isCredential(credential)) return DENIED('unauthenticated', 'invalid_credential');
      if (projectId !== undefined && !validIdentifier(projectId)) return DENIED('not_found', 'project_mismatch');
      let raw: unknown;
      try { raw = await withDeadline(timeoutMs, signal, (derived) => verifier.verify({ credential, audience, signal: derived })); }
      catch (error) { return UNAVAILABLE(error instanceof DeadlineError ? 'timeout' : error instanceof AbortedError ? 'aborted' : 'verifier_error'); }
      let parsed: Parsed;
      try { parsed = parseVerifyResult(raw, audience, now().getTime(), maxContextTtlMs); } catch { parsed = undefined; }
      if (!parsed) return UNAVAILABLE('malformed_answer');
      if ('denied' in parsed) return DENIED('unauthenticated', parsed.denied);
      if ('failure' in parsed) return parsed.failure === 'unavailable' ? UNAVAILABLE('verifier_unavailable') : DENIED('unauthenticated', parsed.failure);
      const { context } = parsed;
      // A project the caller does not hold is indistinguishable from one that does not exist.
      if (projectId !== undefined && projectId !== context.projectId) return DENIED('not_found', 'project_mismatch');
      const granted = new Set(context.capabilities);
      if (!required.every((capability) => granted.has(capability))) return DENIED('forbidden', 'missing_capability');
      return Object.freeze({
        status: 'allowed', route,
        scope: Object.freeze({ tenantId: context.tenantId, projectId: context.projectId }),
        trustedScope: Object.freeze({ tenantId: context.tenantId, projectId: context.projectId, environment: context.environment, billingMode: context.billingMode, actorId: context.actorId }),
        actorId: context.actorId, revision: context.revision, expiresAt: context.expiresAt, capabilities: context.capabilities,
      });
    },
  });
}

/** Display-only projection for the client `Dashboard`. Its output is never accepted back as a credential; `cause` is dropped. */
export function toHostAccessProjection(decision: AuthorizationDecision): HostAccess {
  if (decision.status === 'allowed') return { status: 'authorized', scope: { tenantId: decision.scope.tenantId, projectId: decision.scope.projectId }, revision: decision.revision };
  return decision.status === 'denied' ? { status: 'restricted' } : { status: 'unavailable' };
}

export type TrustedReadRequest = Readonly<{
  route: ResolvedRoute;
  scope: HostScope;
  /** Finance `TrustedScope` for downstream reads; never rebuild it from env or request state. */
  trustedScope: TrustedScope;
  actorId: string;
  capabilities: readonly string[];
  /** The revision just verified. Make the downstream read conditional on it where the store allows. */
  revision: string;
  expiresAt: string;
  /** Aborts on client cancellation or the guarded reader's server-side deadline. */
  signal: AbortSignal;
}>;
export type GuardedReadInput = Readonly<{ credential: unknown; pathname: string; projectId?: string | undefined; signal: AbortSignal }>;
export type GuardedReadResult<T> = Readonly<{
  /** Safe to send to the browser. */
  state: RouteState<T>;
  /** Projection of the decision that served this read; send it with `state` so the client never labels data with another scope. */
  access: HostAccess;
}>;
/** Server-only outcome for logging and audit. Never forward it to the browser. */
export type GuardedReadOutcome = Readonly<
  | { status: 'allowed'; route: RouteId; actorId: string; revision: string; read: 'ok' | 'error' | 'malformed' | 'timeout' | 'aborted' }
  | { status: 'denied'; route: RouteId; reason: DenyReason; cause: DenyCause }
  | { status: 'unavailable'; route?: RouteId; cause: UnavailableCause | 'unknown_path' }
>;
export type GuardedRouteReader<T> = (input: GuardedReadInput) => Promise<GuardedReadResult<T>>;
export type GuardedReaderOptions<T> = Readonly<{
  authorizer: DashboardAuthorizer;
  basePath: string;
  /**
   * Host read. For detail routes it must scope the lookup of `route.params.id` by `scope` and return the same
   * state for a record outside the scope as for one that does not exist (TD-07 object-level rule).
   */
  read: (request: TrustedReadRequest) => Promise<RouteState<T>>;
  /** Server-side deadline for `read` in ms. Integer in [1, 60000]; default 9000, so verifier (5 s) plus read stays below the 15 s client timeout. */
  readTimeoutMs?: number;
  /** Server-only audit hook. Synchronous throws and rejected promises are both swallowed. */
  onOutcome?: (outcome: GuardedReadOutcome) => unknown;
}>;

/**
 * Wraps a host server read so that every read is re-authorized against the verified context. The read
 * function receives only verified scope; the input deliberately has no scope or access field to forge.
 */
export function createGuardedRouteReader<T>({ authorizer, basePath, read, readTimeoutMs = DEFAULT_READ_TIMEOUT_MS, onOutcome }: GuardedReaderOptions<T>): GuardedRouteReader<T> {
  boundedInteger('readTimeoutMs', readTimeoutMs, TIMEOUT_LIMITS);
  const report = (outcome: GuardedReadOutcome) => {
    try {
      const pending: unknown = onOutcome?.(Object.freeze(outcome));
      // Assimilate cross-realm promises and thenables so audit failures never become unhandled rejections.
      if (pending !== null && (typeof pending === 'object' || typeof pending === 'function')) {
        void Promise.resolve(pending).catch(() => undefined);
      }
    } catch { /* Audit hooks never change the result. */ }
  };
  const result = (state: RouteState<T>, access: HostAccess): GuardedReadResult<T> => Object.freeze({ state, access });
  return async ({ credential, pathname, projectId, signal }) => {
    const resolved = resolveRoute(basePath, pathname);
    if (resolved.status !== 'found') { report({ status: 'unavailable', cause: 'unknown_path' }); return result({ status: 'unavailable' }, { status: 'unavailable' }); }
    const route = resolved.route.id;
    const decision = await authorizer.authorize({ credential, route, projectId, signal });
    if (decision.status === 'denied') { report({ status: 'denied', route, reason: decision.reason, cause: decision.cause }); return result({ status: 'restricted' }, { status: 'restricted' }); }
    if (decision.status !== 'allowed') { report({ status: 'unavailable', route, cause: decision.cause }); return result({ status: 'unavailable' }, { status: 'unavailable' }); }
    if (signal.aborted) { report({ status: 'unavailable', route, cause: 'aborted' }); return result({ status: 'unavailable' }, { status: 'unavailable' }); }
    const access = toHostAccessProjection(decision);
    const allowed = (outcome: 'ok' | 'error' | 'malformed' | 'timeout' | 'aborted') => report({ status: 'allowed', route, actorId: decision.actorId, revision: decision.revision, read: outcome });
    try {
      const state = await withDeadline(readTimeoutMs, signal, (derived) => read({
        route: resolved.route, scope: decision.scope, trustedScope: decision.trustedScope, actorId: decision.actorId,
        capabilities: decision.capabilities, revision: decision.revision, expiresAt: decision.expiresAt, signal: derived,
      }));
      if (signal.aborted) { allowed('aborted'); return result({ status: 'unavailable' }, access); }
      if (isRouteState(state) && state.status !== 'loading') { allowed('ok'); return result(state as RouteState<T>, access); }
      allowed('malformed'); return result({ status: 'error', retryable: false }, access);
    } catch (error) {
      if (error instanceof DeadlineError) { allowed('timeout'); return result({ status: 'unavailable' }, access); }
      if (error instanceof AbortedError || signal.aborted) { allowed('aborted'); return result({ status: 'unavailable' }, access); }
      allowed('error'); return result({ status: 'error', retryable: true }, access);
    }
  };
}
