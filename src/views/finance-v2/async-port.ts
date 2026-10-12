import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { checkFinanceV2Page, type FinanceV2TrustedReferences } from './check';
import type { FinanceV2Input, FinanceV2Page, FinanceV2RefusalCode, OpaqueProductScope } from './types';

/**
 * Host-injected, read-only async port for the Finance v2 presentation (frozen WIP proposal, not accepted).
 *
 * Nothing here implements Finance, derives a grant, or alias-maps a permission. The host states the scope, snapshot id and the
 * query/summary hashes it expects, independently of whatever the port returns; the port answers for exactly that request. The
 * browser only compares strings for equality: it never computes, signs or vouches for a hash. Authorization comes from a host
 * seam (token plus revision) and never from the URL. This module imports no fixture: a synthetic port is something a host injects.
 */

/** Pagination is unsupported: the frozen handoff returns the authoritative FIRST page only, and v2 continuation is unaccepted. The request has no cursor field. */
export const FINANCE_V2_PAGINATION = 'unsupported' as const;

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
}>;
export type FinanceV2ReadState =
  | Readonly<{ phase: 'unavailable'; reason: Extract<FinanceV2PortResolution, { status: 'unavailable' }>['reason'] }>
  | Readonly<{ phase: 'gated'; reason: 'restricted' | 'unauthorized' | 'unavailable' }>
  | Readonly<{ phase: 'loading' }>
  | Readonly<{ phase: 'ready'; page: FinanceV2Page }>
  | Readonly<{ phase: 'refused'; code: FinanceV2RefusalCode; path: string }>
  | Readonly<{ phase: 'missing' | 'restricted' | 'unauthorized' | 'unknown' }>
  | Readonly<{ phase: 'error'; kind: FinanceV2FaultKind; retryable: boolean }>;
export type FinanceV2ReadResult = Readonly<{ state: FinanceV2ReadState; retry: () => void }>;

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
  return JSON.stringify([o.mode, o.availability.status, scope.tenantId, scope.projectId, scope.environment, scope.billingMode, scope.actorId, o.expectedSnapshotId, o.expectedQueryContentHash, o.expectedSummaryContentHash, o.expectedReferences ?? null, o.authorization.revision, identityOf(o.port)]);
}

function interpret(result: FinanceV2Input | null | undefined, o: FinanceV2ReadOptions): FinanceV2ReadState {
  if (typeof result !== 'object' || result === null) return { phase: 'unknown' };
  if (result.status === 'missing' || result.status === 'restricted' || result.status === 'unauthorized' || result.status === 'unknown') return { phase: result.status };
  if (result.status !== 'ready') return { phase: 'unknown' };
  const checked = checkFinanceV2Page(result.page, o.scope, o.expectedSnapshotId, { queryContentHash: o.expectedQueryContentHash, summaryContentHash: o.expectedSummaryContentHash, ...(o.expectedReferences ? { references: o.expectedReferences } : {}) });
  return checked.ok ? { phase: 'ready', page: checked.page } : { phase: 'refused', code: checked.code, path: checked.path };
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
  const active = gated === undefined && resolution.status === 'available';
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const [retries, setRetries] = useState<Readonly<{ key: string; count: number }>>({ key, count: 0 });
  const attempt = retries.key === key ? retries.count : 0;
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const o = latest.current;
    const resolved = resolveFinanceV2Port(o.mode, o.port);
    if (resolved.status !== 'available') return undefined;
    const controller = new AbortController();
    let live = true;
    const finish = (state: FinanceV2ReadState) => { if (!live) return; live = false; clearTimeout(timer); setSettled({ key, attempt, state }); };
    const timer = setTimeout(() => { if (!live) return; controller.abort(); finish(fromFault({ outcome: 'error', kind: 'timeout', retryable: true })); }, o.timeoutMs ?? 15000);
    void (async () => {
      try {
        const token = await o.authorization.token(controller.signal);
        if (!live) return;
        if (typeof token !== 'string' || token.length === 0) { finish({ phase: 'unauthorized' }); return; }
        const answer = await resolved.port.read({
          scope: o.scope, expectedSnapshotId: o.expectedSnapshotId, expectedQueryContentHash: o.expectedQueryContentHash, expectedSummaryContentHash: o.expectedSummaryContentHash,
          authorization: { token, revision: o.authorization.revision }, signal: controller.signal,
        });
        if (!live) return;
        finish(interpret(answer, o));
      } catch (error) {
        finish(fromFault(classifyFinanceV2Fault(error)));
      }
    })();
    // Leaving a generation (gate, port, identity, revision or retry change, or unmount) aborts its read and permanently discards its answer, so a
    // reconnect or an A -> B -> A identity change can never resurface it: every new generation reads again.
    return () => { live = false; clearTimeout(timer); controller.abort(); setSettled(null); };
  }, [active, key, attempt]);

  const retry = () => setRetries((previous) => ({ key, count: (previous.key === key ? previous.count : 0) + 1 }));
  if (resolution.status === 'unavailable') return { state: { phase: 'unavailable', reason: resolution.reason }, retry };
  if (gated !== undefined) return { state: { phase: 'gated', reason: gated }, retry };
  if (settled && settled.key === key && settled.attempt === attempt) return { state: settled.state, retry };
  return { state: { phase: 'loading' }, retry };
}
