import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { NO_EVIDENCE, checkFinanceV2Continuation, checkFinanceV2Evidence, checkFinanceV2Page, recordFinanceV2Evidence, validCursor, type FinanceV2Evidence, type FinanceV2PageTrail, type FinanceV2TrustedReferences } from './check';
import type { FinanceV2Input, FinanceV2Page, FinanceV2RefusalCode, OpaqueProductScope } from './types';

/**
 * Host-injected, read-only async port for the Finance v2 presentation (frozen WIP proposal, not accepted).
 *
 * Nothing here implements Finance, derives a grant, or alias-maps a permission. The host states the scope, snapshot id and the
 * query/summary hashes it expects, independently of whatever the port returns; the port answers for exactly that request. The
 * browser only compares strings for equality: it never computes, signs or vouches for a hash. Authorization comes from a host
 * seam (token plus revision) and never from the URL. This module imports no fixture: a synthetic port is something a host injects.
 */

/**
 * Transaction paging is a typed, snapshot-bound continuation of the SAME query: each request repeats the host-stated snapshot id, query hash and summary hash, and
 * adds only the opaque `cursor` (and optional `pageSize`) of `FinancialSummaryQueryV2`. Producer-produced continuation pages are still pending, so only
 * clearly synthetic port fixtures exercise it; INTEGRATED mode stays unavailable.
 */
export const FINANCE_V2_PAGINATION = 'snapshot-bound-cursor' as const;

/** Host-owned authorization seam. `revision` changes whenever membership, session or grant state changes; the token is fetched fresh for every read and is never rendered. */
export type FinanceV2Authorization = Readonly<{
  revision: string;
  /** Resolves the current opaque token, or `null` when the host has none (the read is then not attempted). */
  token: (signal: AbortSignal) => Promise<string | null>;
}>;
/** Explicit host availability/refusal gate. `available` is a statement by the host, never a grant derived here. */
export type FinanceV2HostAvailability = Readonly<{ status: 'available' }> | Readonly<{ status: 'refused'; reason: 'restricted' | 'unauthorized' | 'unavailable' }>;

export type FinanceV2ReadRequest = Readonly<{
  scope: OpaqueProductScope;
  expectedSnapshotId: string;
  expectedQueryContentHash: string;
  expectedSummaryContentHash: string;
  /** Absent for the first page. Otherwise the opaque `nextCursor` of an earlier page of this same snapshot (or a host-supplied deep-link cursor): never decoded, never an authority. */
  cursor?: string;
  /** `FinancialSummaryQueryV2.pageSize` (1..500), as the host stated it. */
  pageSize?: number;
  authorization: Readonly<{ token: string; revision: string }>;
  signal: AbortSignal;
}>;
/** Wire answer of a port. A fault is signalled by rejecting (see `classifyFinanceV2Fault`); a rejection message is never read or shown. */
export type FinanceV2ReadPortBase = Readonly<{ read: (request: FinanceV2ReadRequest) => Promise<FinanceV2Input> }>;
/** The only port this slice can be given. Explicitly synthetic; refused in INTEGRATED mode. */
export type FinanceV2SyntheticReadPort = FinanceV2ReadPortBase & Readonly<{ kind: 'SYNTHETIC_PROPOSAL' }>;

export type FinanceV2DataMode = 'SYNTHETIC_PROPOSAL' | 'INTEGRATED';

/** Typed fault classes. Retryable faults offer a retry; the others never do. */
export type FinanceV2FaultKind = 'rate_limited' | 'server' | 'timeout' | 'failed';
export type FinanceV2Fault =
  | Readonly<{ outcome: 'unauthorized' | 'restricted' | 'missing' }>
  | Readonly<{ outcome: 'error'; kind: FinanceV2FaultKind; retryable: boolean }>;

/** Maps a thrown port failure to a typed fault from its numeric `status` or `code` only. Messages and bodies are never read, so nothing secret can be echoed. */
export function classifyFinanceV2Fault(error: unknown): FinanceV2Fault {
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 'TIMEOUT' || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'TimeoutError')) return { outcome: 'error', kind: 'timeout', retryable: true };
  if (status === 401) return { outcome: 'unauthorized' };
  if (status === 403) return { outcome: 'restricted' };
  if (status === 404) return { outcome: 'missing' };
  if (status === 429) return { outcome: 'error', kind: 'rate_limited', retryable: true };
  if (typeof status === 'number' && Number.isInteger(status) && status >= 500 && status <= 599) return { outcome: 'error', kind: 'server', retryable: true };
  return { outcome: 'error', kind: 'failed', retryable: false };
}

/** Fixed, secret-free copy per fault kind. */
export const FINANCE_V2_FAULT_COPY: Readonly<Record<FinanceV2FaultKind, string>> = {
  rate_limited: 'The report service asked us to slow down. No amounts are shown. Try again shortly.',
  server: 'The report service is unavailable right now. No amounts are shown.',
  timeout: 'The report service did not answer in time. No amounts are shown.',
  failed: 'The report could not be loaded. No amounts are shown.',
};

export type FinanceV2PortResolution =
  | Readonly<{ status: 'available'; port: FinanceV2SyntheticReadPort }>
  | Readonly<{ status: 'unavailable'; reason: 'integrated-port-not-accepted' | 'no-port' | 'port-kind-mismatch' }>;
/**
 * Integrated mode has no accepted port type yet, so it can never resolve to one. The synthetic path needs a port that declares itself
 * synthetic. There is no default port and no fallback to fixtures in any branch.
 */
export function resolveFinanceV2Port(mode: FinanceV2DataMode, port: unknown): FinanceV2PortResolution {
  if (mode !== 'SYNTHETIC_PROPOSAL') return { status: 'unavailable', reason: 'integrated-port-not-accepted' };
  if (port === undefined || port === null) return { status: 'unavailable', reason: 'no-port' };
  if (typeof port !== 'object' || (port as { kind?: unknown }).kind !== 'SYNTHETIC_PROPOSAL' || typeof (port as { read?: unknown }).read !== 'function') return { status: 'unavailable', reason: 'port-kind-mismatch' };
  return { status: 'available', port: port as FinanceV2SyntheticReadPort };
}

export type FinanceV2ReadOptions = Readonly<{
  mode: FinanceV2DataMode;
  port: unknown;
  availability: FinanceV2HostAvailability;
  scope: OpaqueProductScope;
  expectedSnapshotId: string;
  expectedQueryContentHash: string;
  expectedSummaryContentHash: string;
  /** References the host pinned independently of any page (for example from a digest-verified definition registry). Optional: with none, nothing is bound. */
  expectedReferences?: FinanceV2TrustedReferences;
  authorization: FinanceV2Authorization;
  /** Ceiling for one read, default 15000 ms. On expiry the request is aborted and a late answer is dropped. */
  timeoutMs?: number;
  /** `FinancialSummaryQueryV2.pageSize` (1..500). Anything else is refused before any read. Changing it starts again at the first page. */
  pageSize?: number;
  /**
   * Opaque cursor of a deep link or reload, read once for the first identity. It is a request parameter only: it grants nothing, and the page that answers it must still
   * match the host's scope, snapshot and hashes. A malformed one is refused before any read. A change of any identity, `resetKey` or `pageSize` drops it.
   */
  initialCursor?: string;
  /** Anything else that changes which rows a page means (for example the transaction filters), as a string. A change cancels the paging in flight and returns to the first page. */
  resetKey?: string;
  /** Told the cursor of the page now requested (`null` for the first page), so the host can keep it in its own durable context. */
  onCursorChange?: (cursor: string | null) => void;
}>;
export type FinanceV2ReadState =
  | Readonly<{ phase: 'unavailable'; reason: Extract<FinanceV2PortResolution, { status: 'unavailable' }>['reason'] }>
  | Readonly<{ phase: 'gated'; reason: 'restricted' | 'unauthorized' | 'unavailable' }>
  | Readonly<{ phase: 'loading' }>
  | Readonly<{ phase: 'ready'; page: FinanceV2Page }>
  | Readonly<{ phase: 'refused'; code: FinanceV2RefusalCode; path: string }>
  | Readonly<{ phase: 'missing' | 'restricted' | 'unauthorized' | 'unknown' }>
  | Readonly<{ phase: 'error'; kind: FinanceV2FaultKind; retryable: boolean }>;
/** Page controls. `previous` re-reads the earlier page with fresh authorization (no amounts are cached; only observed page identities are compared), and from a deep-linked page it returns to the first page. */
export type FinanceV2Paging = Readonly<{
  /** 1-based position from the first page, or `null` for a deep-linked page whose position is not known. */
  pageNumber: number | null;
  canPrevious: boolean;
  /** True only for a verified page with `hasMore` and an opaque `nextCursor`. */
  canNext: boolean;
  next: () => void;
  previous: () => void;
  restart: () => void;
}>;
export type FinanceV2ReadResult = Readonly<{ state: FinanceV2ReadState; retry: () => void; paging: FinanceV2Paging }>;

type Settled = Readonly<{ key: string; attempt: number; state: FinanceV2ReadState }>;
/** Stable numeric identity for an injected object, so a replaced port changes the key without any value being read or logged. */
const identities = new WeakMap<object, number>();
let nextIdentity = 1;
function identityOf(value: unknown): number {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return 0;
  let id = identities.get(value);
  if (id === undefined) { id = nextIdentity++; identities.set(value, id); }
  return id;
}
/**
 * Every independent input whose change makes an in-flight or settled answer stale. Compared as a whole, so a change in any one invalidates it.
 * The port is compared by identity, never by value, so a host keeps it stable while nothing changed. The token callback is deliberately NOT part of
 * the key: its identity may change on every render without a new read, and a change of what it resolves is signalled by `authorization.revision`.
 */
function identityKey(o: FinanceV2ReadOptions): string {
  const { scope } = o;
  return JSON.stringify([o.mode, o.availability.status, scope.tenantId, scope.projectId, scope.environment, scope.billingMode, scope.actorId, o.expectedSnapshotId, o.expectedQueryContentHash, o.expectedSummaryContentHash, o.expectedReferences ?? null, o.authorization.revision, identityOf(o.port), o.pageSize ?? null]);
}

const NO_TRAIL: FinanceV2PageTrail = [];
/** The request parameters a host stated are checked before any read; a bad one is refused with no amount and no port call. */
function invalidRequest(o: FinanceV2ReadOptions, cursor: string | undefined): { path: string } | undefined {
  if (o.pageSize !== undefined && !(Number.isSafeInteger(o.pageSize) && o.pageSize >= 1 && o.pageSize <= 500)) return { path: '/pageSize' };
  if (cursor !== undefined && !validCursor(cursor)) return { path: '/cursor' };
  return undefined;
}

function interpret(result: FinanceV2Input | null | undefined, o: FinanceV2ReadOptions, trail: FinanceV2PageTrail, cursor: string | undefined, evidence: MutableRefObject<FinanceV2Evidence>): FinanceV2ReadState {
  if (typeof result !== 'object' || result === null) return { phase: 'unknown' };
  if (result.status === 'missing' || result.status === 'restricted' || result.status === 'unauthorized' || result.status === 'unknown') return { phase: result.status };
  if (result.status !== 'ready') return { phase: 'unknown' };
  const checked = checkFinanceV2Page(result.page, o.scope, o.expectedSnapshotId, { queryContentHash: o.expectedQueryContentHash, summaryContentHash: o.expectedSummaryContentHash, ...(o.expectedReferences ? { references: o.expectedReferences } : {}) });
  if (!checked.ok) return { phase: 'refused', code: checked.code, path: checked.path };
  const continued = checkFinanceV2Continuation(checked.page, trail);
  if (!continued.ok) return { phase: 'refused', code: continued.code, path: continued.path };
  // Compared with what this identity generation already observed (public envelope of the first accepted page, the page behind every request cursor). Only an accepted page is recorded.
  const observed = checkFinanceV2Evidence(continued.page, cursor, evidence.current);
  if (!observed.ok) return { phase: 'refused', code: observed.code, path: observed.path };
  evidence.current = recordFinanceV2Evidence(observed.page, cursor, evidence.current);
  return { phase: 'ready', page: observed.page };
}
function fromFault(fault: FinanceV2Fault): FinanceV2ReadState {
  return fault.outcome === 'error' ? { phase: 'error', kind: fault.kind, retryable: fault.retryable } : { phase: fault.outcome };
}

/**
 * Lifecycle of one scoped read. Returns `loading` (never a previous answer) whenever the independent identity differs from the one an
 * answer was produced for, so stale amounts cannot render even for a single frame. A change of scope, actor, environment, billing mode,
 * authorization revision, snapshot or hash, an unmount, a retry or a timeout aborts the in-flight read AND discards its answer, so a
 * port that ignores the abort signal still cannot surface a late response.
 */
export function useFinanceV2Read(options: FinanceV2ReadOptions): FinanceV2ReadResult {
  const resolution = resolveFinanceV2Port(options.mode, options.port);
  const gated = options.availability.status === 'refused' ? options.availability.reason : undefined;
  const key = identityKey(options);
  // Page history. It belongs to one identity plus `resetKey`; any change of either discards it in the same render, so an old page's position, cursor or ids can never apply
  // to a new scope or filter (not even on an A -> B -> A cycle, because the stored state is replaced rather than compared later).
  const pagingKey = `${key}\u0000${options.resetKey ?? ''}`;
  const [paging, setPaging] = useState<Readonly<{ key: string; trail: FinanceV2PageTrail }>>(() => ({
    key: pagingKey, trail: options.initialCursor === undefined ? NO_TRAIL : [{ cursor: options.initialCursor, fromDetailIds: [], linked: true }],
  }));
  if (paging.key !== pagingKey) setPaging({ key: pagingKey, trail: NO_TRAIL });
  const trail = paging.key === pagingKey ? paging.trail : NO_TRAIL;
  const cursor = trail.length === 0 ? undefined : trail[trail.length - 1]!.cursor;
  const invalid = invalidRequest(options, cursor);
  const active = gated === undefined && resolution.status === 'available' && invalid === undefined;
  // The filter/reset generation is part of the read identity: a change cancels an in-flight first-page read and drops a settled one, exactly as a cursor change does.
  const readKey = `${pagingKey}\u0000${cursor ?? ''}`;
  // Observed page evidence belongs to one pagingKey generation: it survives Previous, retry and revisits, but never an identity or filter change (also A -> B -> A).
  const evidence = useRef<FinanceV2Evidence>(NO_EVIDENCE);
  useLayoutEffect(() => { evidence.current = NO_EVIDENCE; }, [pagingKey]);
  const latest = useRef({ options, trail, cursor, pagingKey });
  useLayoutEffect(() => { latest.current = { options, trail, cursor, pagingKey }; });
  const [retries, setRetries] = useState<Readonly<{ key: string; count: number }>>({ key, count: 0 });
  const attempt = retries.key === key ? retries.count : 0;
  const [settled, setSettled] = useState<Settled | null>(null);

  const reported = useRef<string | null>(cursor ?? null);
  useEffect(() => {
    const now = cursor ?? null;
    if (reported.current === now) return;
    reported.current = now;
    latest.current.options.onCursorChange?.(now);
  }, [cursor]);

  useEffect(() => {
    if (!active) return undefined;
    const { options: o, trail: trailNow, cursor: cursorNow } = latest.current;
    const resolved = resolveFinanceV2Port(o.mode, o.port);
    if (resolved.status !== 'available') return undefined;
    const controller = new AbortController();
    let live = true;
    const finish = (state: FinanceV2ReadState) => { if (!live) return; live = false; clearTimeout(timer); setSettled({ key: readKey, attempt, state }); };
    const timer = setTimeout(() => { if (!live) return; controller.abort(); finish(fromFault({ outcome: 'error', kind: 'timeout', retryable: true })); }, o.timeoutMs ?? 15000);
    void (async () => {
      try {
        const token = await o.authorization.token(controller.signal);
        if (!live) return;
        if (typeof token !== 'string' || token.length === 0) { finish({ phase: 'unauthorized' }); return; }
        const answer = await resolved.port.read({
          scope: o.scope, expectedSnapshotId: o.expectedSnapshotId, expectedQueryContentHash: o.expectedQueryContentHash, expectedSummaryContentHash: o.expectedSummaryContentHash,
          ...(cursorNow !== undefined ? { cursor: cursorNow } : {}), ...(o.pageSize !== undefined ? { pageSize: o.pageSize } : {}),
          authorization: { token, revision: o.authorization.revision }, signal: controller.signal,
        });
        if (!live) return;
        finish(interpret(answer, o, trailNow, cursorNow, evidence));
      } catch (error) {
        finish(fromFault(classifyFinanceV2Fault(error)));
      }
    })();
    // Leaving a generation (gate, port, identity, revision or retry change, or unmount) aborts its read and permanently discards its answer, so a
    // reconnect or an A -> B -> A identity change can never resurface it: every new generation reads again.
    return () => { live = false; clearTimeout(timer); controller.abort(); setSettled(null); };
  }, [active, readKey, attempt]);

  const retry = () => setRetries((previous) => ({ key, count: (previous.key === key ? previous.count : 0) + 1 }));
  const state: FinanceV2ReadState = resolution.status === 'unavailable' ? { phase: 'unavailable', reason: resolution.reason }
    : gated !== undefined ? { phase: 'gated', reason: gated }
    : invalid !== undefined ? { phase: 'refused', code: 'INVALID_SHAPE', path: invalid.path }
    : settled && settled.key === readKey && settled.attempt === attempt ? settled.state : { phase: 'loading' };

  // Page controls act only on the render they were made for: after any identity or filter change `latest.current.pagingKey` differs and they do nothing.
  const move = (change: (current: FinanceV2PageTrail) => FinanceV2PageTrail | null) => setPaging((previous) => {
    if (latest.current.pagingKey !== pagingKey || previous.key !== pagingKey) return previous;
    const next = change(previous.trail);
    return next === null ? previous : { key: pagingKey, trail: next };
  });
  const page = state.phase === 'ready' ? state.page : undefined;
  const nextCursor = page !== undefined && page.hasMore ? page.nextCursor : null;
  const pagingControls: FinanceV2Paging = {
    pageNumber: trail.length > 0 && trail[0]!.linked ? null : trail.length + 1,
    canPrevious: trail.length > 0,
    canNext: nextCursor !== null,
    next: () => {
      if (page === undefined || nextCursor === null) return;
      const at = trail.length;
      move((current) => (current.length === at ? [...current, { cursor: nextCursor, fromDetailIds: page.details.map((detail) => detail.detailId), linked: false }] : null));
    },
    previous: () => { const at = trail.length; move((current) => (current.length === at && at > 0 ? current.slice(0, -1) : null)); },
    restart: () => move((current) => (current.length > 0 ? NO_TRAIL : null)),
  };
  return { state, retry, paging: pagingControls };
}
