import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FINANCE_EXPORT, FINANCE_READ } from '../../access/permissions';
import { classifyFinanceV2Fault, type FinanceV2Authorization, type FinanceV2DataMode } from './async-port';
import {
  FINANCE_V2_FORMAT_FILE, checkPreparedExport,
  type FinanceV2ExportErrorCode, type FinanceV2ExportFormat, type FinanceV2PreparedExpectation, type FinanceV2PreparedFile, type FinanceV2PreparedManifestView, type FinanceV2PreparedRefusalCode,
} from './export-check';
import type { FinanceV2Page, OpaqueProductScope } from './types';

/**
 * Host-injected prepared-export port for the Finance v2 presentation. Explicitly synthetic conformance only: it consumes the Finance producer's exact prepared JSON/CSV receipt shape
 * (`ReportingExportReceipt@2.0.0`) and nothing else, and it establishes no CFO delivery, no consumer acceptance and no live host adoption.
 *
 * What is NOT here, on purpose: no export grant is derived or alias-mapped (Dashboard `finance.export` is a separate, explicit capability the HOST states; it is not the Finance
 * `finance.summary.export` permission), no Finance authority fence is rebuilt (the host port owns canonical validation and its own coherent final disclosure fence), no artifact
 * bytes, hashes, aliases or timestamps are invented, and nothing is generated or aggregated in the browser. The Dashboard only (1) renews its OWN host access around every await and
 * before disclosure, (2) binds the answer to what the host stated, and (3) holds the bytes in memory until an explicit download.
 */
export const FINANCE_V2_EXPORT_KIND = 'SYNTHETIC_EXPORT_CONFORMANCE_ONLY' as const;
export const FINANCE_V2_EXPORT_DESTINATION = 'cfo.ai' as const;

/**
 * What the port is asked. The host canonicalizes this into its own Finance `ExportRequest` (request id, idempotency key, `requestedBy`, `requestedAt` and evidence mode are the host's:
 * they are untrusted labels the producer ignores for authority). `summarySnapshot` is the accepted FIRST page only, never a continuation page.
 */
export type FinanceV2PreparedExportRequest = Readonly<{
  scope: OpaqueProductScope;
  expectedSnapshotId: string;
  expectedQueryContentHash: string;
  expectedSummaryContentHash: string;
  format: FinanceV2ExportFormat;
  destination: typeof FINANCE_V2_EXPORT_DESTINATION;
  summarySnapshot: FinanceV2Page;
  /** Fresh per request and never rendered, stored or logged here. */
  authorization: Readonly<{ token: string; revision: string }>;
  signal: AbortSignal;
}>;
/** Wire answer of the port is untrusted (`unknown`); a fault is signalled by rejecting, and a rejection message is never read or shown. */
export type FinanceV2SyntheticExportPort = Readonly<{ kind: typeof FINANCE_V2_EXPORT_KIND; prepare: (request: FinanceV2PreparedExportRequest) => Promise<unknown> }>;

/**
 * The host's CURRENT view of this user's Dashboard access, read synchronously every time the Dashboard needs it. It is the host's statement, not a grant derived here: the read and
 * export capabilities are separate explicit entries (`finance.read`, `finance.export`), neither implies the other, and the revision and scope must match the Finance read it belongs to.
 */
export type FinanceV2ExportHostAccess = Readonly<{ revision: string; scope: OpaqueProductScope; capabilities: readonly string[]; expiresAt: string }>;
export type FinanceV2ExportAccessReader = () => FinanceV2ExportHostAccess | null | undefined;

export type FinanceV2ExportUnavailableReason =
  | 'integrated-port-not-accepted' | 'no-port' | 'port-kind-mismatch' | 'not-first-page'
  | 'no-access' | 'access-stale' | 'scope-changed' | 'expired' | 'no-read-permission' | 'no-export-permission';

export type FinanceV2ExportPortResolution =
  | Readonly<{ status: 'available'; port: FinanceV2SyntheticExportPort }>
  | Readonly<{ status: 'unavailable'; reason: 'integrated-port-not-accepted' | 'no-port' | 'port-kind-mismatch' }>;
/** Integrated mode has no accepted export port type, so it can never resolve to one. There is no default port and no fixture fallback in any branch. */
export function resolveFinanceV2ExportPort(mode: FinanceV2DataMode, port: unknown): FinanceV2ExportPortResolution {
  if (mode !== 'SYNTHETIC_PROPOSAL') return { status: 'unavailable', reason: 'integrated-port-not-accepted' };
  if (port === undefined || port === null) return { status: 'unavailable', reason: 'no-port' };
  if (typeof port !== 'object' || (port as { kind?: unknown }).kind !== FINANCE_V2_EXPORT_KIND || typeof (port as { prepare?: unknown }).prepare !== 'function') return { status: 'unavailable', reason: 'port-kind-mismatch' };
  return { status: 'available', port: port as FinanceV2SyntheticExportPort };
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const SCOPE_KEYS = ['tenantId', 'projectId', 'environment', 'billingMode', 'actorId'] as const;
/**
 * Renews the Dashboard's own access check against the host's CURRENT state: revision, complete scope (including the actor), expiry, then the separate read and export capabilities.
 * Fails closed on a missing reader, a throwing reader or a malformed answer. Returns `null` only when everything holds right now.
 */
export function evaluateFinanceV2ExportAccess(reader: unknown, bound: Readonly<{ revision: string; scope: OpaqueProductScope }>, nowMs: number): FinanceV2ExportUnavailableReason | null {
  if (typeof reader !== 'function') return 'no-access';
  let revision: unknown; let scope: unknown; let capabilities: unknown; let expiresAt: unknown;
  try {
    const access: unknown = (reader as FinanceV2ExportAccessReader)();
    if (typeof access !== 'object' || access === null) return 'no-access';
    ({ revision, scope, capabilities, expiresAt } = access as Record<string, unknown>);
    if (typeof scope !== 'object' || scope === null) return 'no-access';
    const read = scope as Record<string, unknown>;
    scope = Object.fromEntries(SCOPE_KEYS.map((key) => [key, read[key]]));
    capabilities = Array.isArray(capabilities) ? Array.from(capabilities as unknown[]) : undefined;
  } catch { return 'no-access'; }
  if (typeof revision !== 'string' || revision.length === 0 || revision !== bound.revision) return 'access-stale';
  const current = scope as Record<string, unknown>;
  if (!SCOPE_KEYS.every((key) => typeof current[key] === 'string' && current[key] === bound.scope[key])) return 'scope-changed';
  if (typeof expiresAt !== 'string' || !INSTANT.test(expiresAt) || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= nowMs) return 'expired';
  if (!Array.isArray(capabilities)) return 'no-access';
  if (!capabilities.includes(FINANCE_READ)) return 'no-read-permission';
  if (!capabilities.includes(FINANCE_EXPORT)) return 'no-export-permission';
  return null;
}

/** Fixed, secret-free copy. A port's `safe_message`, error body or exception message is never read, so none can be echoed. */
export const FINANCE_V2_EXPORT_ERROR_COPY: Readonly<Record<FinanceV2ExportErrorCode | 'failed' | 'unauthorized', string>> = {
  SOURCE_UNAVAILABLE: 'The export source is unavailable right now. No file was produced.',
  FORBIDDEN_SCOPE: 'Export is not permitted for this scope or access. No file was produced.',
  IDEMPOTENCY_CONFLICT: 'This snapshot was already prepared with different parameters. No file was produced.',
  VALIDATION_ERROR: 'The export request was not valid. No file was produced.',
  UNSUPPORTED_VERSION: 'This snapshot cannot be exported in a supported format. No file was produced.',
  unauthorized: 'Export is not authorized for you right now. No file was produced.',
  failed: 'The export could not be prepared. No file was produced.',
};
export const FINANCE_V2_EXPORT_UNAVAILABLE_COPY: Readonly<Record<FinanceV2ExportUnavailableReason, string>> = {
  'integrated-port-not-accepted': 'Integrated CFO export is not available: no accepted export port exists. No file is produced and no export success is claimed.',
  'no-port': 'No export port was provided by the host, so no file is produced and no export success is claimed.',
  'port-kind-mismatch': 'The provided export port is not usable in this mode, so no file is produced.',
  'not-first-page': 'Export is prepared from the original first page of the snapshot only. Return to the first page to prepare it. No file is produced.',
  'no-access': 'The host has not stated current export access, so no file is produced.',
  'access-stale': 'Your access changed. Any prepared export was discarded and nothing was downloaded.',
  'scope-changed': 'The host scope changed. Any prepared export was discarded and nothing was downloaded.',
  expired: 'Your access has expired. Any prepared export was discarded and nothing was downloaded.',
  'no-read-permission': 'Export needs read access to this report, which the host does not currently state. No file is produced.',
  'no-export-permission': 'You do not have export permission for this report. Export is restricted and no file is produced.',
};

export type FinanceV2ExportState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'preparing' }>
  | Readonly<{ phase: 'prepared'; manifest: FinanceV2PreparedManifestView }>
  | Readonly<{ phase: 'refused'; code: FinanceV2PreparedRefusalCode; path: string }>
  | Readonly<{ phase: 'failed'; code: FinanceV2ExportErrorCode | 'failed' | 'unauthorized' }>
  | Readonly<{ phase: 'discarded'; reason: FinanceV2ExportUnavailableReason }>;

export type FinanceV2PreparedExportOptions = Readonly<{
  mode: FinanceV2DataMode;
  port: unknown;
  /** The host's synchronous current-access reader. Without it nothing is prepared or disclosed. */
  access: FinanceV2ExportAccessReader | undefined;
  authorization: FinanceV2Authorization;
  scope: OpaqueProductScope;
  expectedSnapshotId: string;
  expectedQueryContentHash: string;
  expectedSummaryContentHash: string;
  /** The page the view accepted. Export is for its original FIRST snapshot page only. */
  page: FinanceV2Page;
  /** True only for the first page of this identity (no cursor was applied). A continuation page, deep-linked or paged to, never exports. */
  firstPage: boolean;
  /** Anything else that changes what is on screen (for example the transaction filters). A change aborts a run and discards a prepared export. */
  resetKey?: string;
  timeoutMs?: number;
  now?: () => number;
}>;
export type FinanceV2PreparedExportResult = Readonly<{
  unavailable: FinanceV2ExportUnavailableReason | null;
  format: FinanceV2ExportFormat;
  setFormat: (format: FinanceV2ExportFormat) => void;
  state: FinanceV2ExportState;
  prepare: () => void;
  /** Returns the file name handed to the browser, or `null` when access no longer holds or nothing is prepared. Disclosure happens only here. */
  download: () => string | null;
}>;

const identities = new WeakMap<object, number>();
let nextIdentity = 1;
function identityOf(value: unknown): number {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return 0;
  let id = identities.get(value);
  if (id === undefined) { id = nextIdentity++; identities.set(value, id); }
  return id;
}
/** Everything whose change makes an in-flight or prepared export stale. The port and access reader are compared by identity, never by value. The token callback is not part of it. */
function identityKey(o: FinanceV2PreparedExportOptions): string {
  const { scope } = o;
  return JSON.stringify([o.mode, identityOf(o.port), identityOf(o.access), scope.tenantId, scope.projectId, scope.environment, scope.billingMode, scope.actorId,
    o.expectedSnapshotId, o.expectedQueryContentHash, o.expectedSummaryContentHash, o.authorization.revision, o.firstPage, o.resetKey ?? null, o.page.snapshotId]);
}
/** Everything that must hold RIGHT NOW. Synchronous, so it can be repeated immediately before and after every await and before disclosure. */
function unavailableNow(o: FinanceV2PreparedExportOptions): FinanceV2ExportUnavailableReason | null {
  const resolved = resolveFinanceV2ExportPort(o.mode, o.port);
  if (resolved.status === 'unavailable') return resolved.reason;
  if (!o.firstPage) return 'not-first-page';
  return evaluateFinanceV2ExportAccess(o.access, { revision: o.authorization.revision, scope: o.scope }, (o.now ?? Date.now)());
}
/** The expectation the answer must be bound to: the host's own statements plus the identity of the accepted first page. */
function expectationOf(o: FinanceV2PreparedExportOptions, format: FinanceV2ExportFormat): FinanceV2PreparedExpectation {
  return {
    snapshotId: o.expectedSnapshotId, queryContentHash: o.expectedQueryContentHash, summaryContentHash: o.expectedSummaryContentHash, format,
    environment: o.scope.environment, billingMode: o.scope.billingMode, asOf: o.page.asOf, timezone: o.page.timezone, period: { start: o.page.period.start, end: o.page.period.end },
    currencies: o.page.summary.currencies.map((entry) => entry.currency),
  };
}

class Stale extends Error {}
class Vetoed extends Error { constructor(readonly reason: FinanceV2ExportUnavailableReason) { super(reason); } }
type Held = Readonly<{ key: string; format: FinanceV2ExportFormat; files: readonly FinanceV2PreparedFile[] }>;
type Settled = Readonly<{ key: string; state: FinanceV2ExportState }>;

/**
 * Lifecycle of one manual export preparation. The bytes live in a private ref, are never rendered, stored in state, written to the DOM, a URL or web storage, and are dropped on any change
 * of port, access reader, scope, actor, authorization revision, snapshot, hashes, filter or format, on unmount, and as soon as host access no longer holds.
 */
export function usePreparedExport(options: FinanceV2PreparedExportOptions): FinanceV2PreparedExportResult {
  const [format, setFormat] = useState<FinanceV2ExportFormat>('json');
  const runKey = `${identityKey(options)}\u0000${format}`;
  const unavailable = unavailableNow(options);
  const latest = useRef({ options, runKey, format });
  useLayoutEffect(() => { latest.current = { options, runKey, format }; });
  const held = useRef<Held | null>(null);
  const active = useRef<{ cancel: () => void } | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);

  // A different identity or format starts from nothing: the in-flight run is cancelled, any held bytes are dropped.
  useEffect(() => () => { active.current?.cancel(); active.current = null; held.current = null; }, [runKey]);
  // Once access no longer holds at render time, nothing prepared may stay reachable.
  useEffect(() => { if (unavailable !== null) held.current = null; });

  const state: FinanceV2ExportState = unavailable !== null ? { phase: 'idle' } : settled !== null && settled.key === runKey ? settled.state : { phase: 'idle' };

  const discard = (key: string, reason: FinanceV2ExportUnavailableReason) => { held.current = null; setSettled({ key, state: { phase: 'discarded', reason } }); };

  // While something is prepared or being prepared, access is re-read on a timer too, so a revocation with no re-render still drops it before any disclosure.
  const watching = state.phase === 'preparing' || state.phase === 'prepared';
  useEffect(() => {
    if (!watching) return undefined;
    const timer = setInterval(() => {
      const now = latest.current;
      if (now.runKey !== runKey) return;
      const veto = unavailableNow(now.options);
      if (veto === null) return;
      active.current?.cancel(); active.current = null;
      discard(runKey, veto);
    }, 250);
    return () => clearInterval(timer);
  }, [watching, runKey]);

  const prepare = () => {
    const { options: o, runKey: key, format: wanted } = latest.current;
    if (active.current !== null) return;
    const veto = unavailableNow(o);
    if (veto !== null) { discard(key, veto); return; }
    const resolved = resolveFinanceV2ExportPort(o.mode, o.port);
    if (resolved.status !== 'available') return;
    held.current = null;
    const controller = new AbortController();
    let live = true;
    const timer = setTimeout(() => { if (live) { controller.abort(); finish({ phase: 'failed', code: 'failed' }); } }, o.timeoutMs ?? 15000);
    const finish = (next: FinanceV2ExportState) => { if (!live) return; live = false; clearTimeout(timer); if (active.current === handle) active.current = null; setSettled({ key, state: next }); };
    const handle = { cancel: () => { live = false; clearTimeout(timer); controller.abort(); } };
    active.current = handle;
    setSettled({ key, state: { phase: 'preparing' } });
    /** Renewed before and after every await and before anything is kept: the identity this run started for, then the host's CURRENT access. */
    const renew = () => {
      if (!live) throw new Stale();
      const now = latest.current;
      if (now.runKey !== key) throw new Stale();
      const reason = unavailableNow(now.options);
      if (reason !== null) throw new Vetoed(reason);
    };
    void (async () => {
      try {
        renew();
        const token = await o.authorization.token(controller.signal);
        renew();
        if (typeof token !== 'string' || token.length === 0) { finish({ phase: 'failed', code: 'unauthorized' }); return; }
        const answer = await resolved.port.prepare({
          scope: o.scope, expectedSnapshotId: o.expectedSnapshotId, expectedQueryContentHash: o.expectedQueryContentHash, expectedSummaryContentHash: o.expectedSummaryContentHash,
          format: wanted, destination: FINANCE_V2_EXPORT_DESTINATION, summarySnapshot: o.page, authorization: { token, revision: o.authorization.revision }, signal: controller.signal,
        });
        renew();
        const checked = checkPreparedExport(answer, expectationOf(o, wanted));
        renew();
        if (!checked.ok) { finish(checked.kind === 'error' ? { phase: 'failed', code: checked.code } : { phase: 'refused', code: checked.code, path: checked.path }); return; }
        held.current = { key, format: wanted, files: checked.files };
        finish({ phase: 'prepared', manifest: checked.manifest });
      } catch (error) {
        held.current = null;
        if (error instanceof Stale) return;
        if (error instanceof Vetoed) { active.current = null; live = false; clearTimeout(timer); controller.abort(); discard(key, error.reason); return; }
        // A rejection is classified from its numeric status or code only; its message and body are never read.
        const fault = classifyFinanceV2Fault(error);
        finish({ phase: 'failed', code: fault.outcome === 'unauthorized' ? 'unauthorized' : fault.outcome === 'restricted' ? 'FORBIDDEN_SCOPE' : 'failed' });
      }
    })();
  };

  const download = (): string | null => {
    const { options: o, runKey: key } = latest.current;
    const mine = held.current;
    if (mine === null || mine.key !== key) return null;
    // Disclosure gate: the host's CURRENT access, checked synchronously with nothing awaited between this check and the hand-off below.
    const veto = unavailableNow(o);
    if (veto !== null) { discard(key, veto); return null; }
    const file = mine.files.find((candidate) => candidate.fileName === FINANCE_V2_FORMAT_FILE[mine.format]);
    if (!file) return null;
    const url = URL.createObjectURL(new Blob([file.content], { type: `${file.mediaType};charset=utf-8` }));
    const link = document.createElement('a');
    link.href = url; link.download = file.fileName; link.rel = 'noopener'; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return file.fileName;
  };

  return { unavailable, format, setFormat, state, prepare, download };
}
