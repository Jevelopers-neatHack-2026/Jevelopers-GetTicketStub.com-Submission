import type { FinanceV2Input, FinanceV2ReadRequest, FinanceV2SyntheticReadPort } from '../../src/views/finance-v2';
import pagination from '../../tests/fixtures/finance-v2-pagination-conformance/producer-v2-pagination-page.json';
import refusals from '../../tests/fixtures/finance-v2-pagination-conformance/producer-v2-refusals-page.json';

/**
 * SYNTHETIC_CONFORMANCE_ONLY fixture-host port over the ACTUAL captured Finance-producer pagination chain (three pages, six unique details, nine typed refusals), committed byte for byte
 * under `tests/fixtures/finance-v2-pagination-conformance`. It is a presentation fixture for the packed host's artifact route, not live Finance: the captured cursors were signed by a
 * disposed producer host and cannot be replayed against anything else, so this port only LOOKS UP the recorded answer to the exact recorded query. It never generates, alters,
 * decodes or re-signs a cursor, never computes a hash or an amount, and grants nothing. The host owns the initial trusted normalized query; a URL cursor or scope claim is only a request parameter.
 */
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export type CapturedApiError = Readonly<{ schemaVersion: string; module: string; operation: string; code: string; retryable: boolean; safe_message: string; diagnostic_ref: string }>;
export type CapturedApiResult = Readonly<{ ok: true; value: Json }> | Readonly<{ ok: false; error: CapturedApiError }>;
type CapturedObservation = Readonly<{ name: string; request: Json; result: CapturedApiResult }>;

export const capturedBinding = pagination.binding;
export const capturedPages = pagination.pages;
export const capturedObservations = refusals.observations as unknown as readonly CapturedObservation[];
export const capturedGrants = ['current', 'denied', 'stale', 'revoked'] as const;
export type CapturedGrant = (typeof capturedGrants)[number];
export const capturedTampers = ['none', 'period', 'filters', 'version'] as const;
export type CapturedTamper = (typeof capturedTampers)[number];
export type CapturedPortLog = { reads: Array<{ page: number | null; pageSize: number | null; actorId: string; revision: string; outcome: string; code: string | null }> };

/** Deterministic key-sorted JSON, used only to compare a built query with a recorded one. Arrays keep their order. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1))) : item));
const observation = (name: string): CapturedObservation => {
  const found = capturedObservations.find((entry) => entry.name === name);
  if (!found) throw new Error(`captured observation ${name} is missing`);
  return found;
};
/** The project id of the recorded `foreign_scope` refusal: a host presenting it states a scope the producer refused. */
export const capturedForeignProjectId = ((observation('foreign_scope').request as { scope: { projectId: string } }).scope.projectId);

/**
 * Maps a producer `ApiResult` to what the dashboard's read port can express, by the exact error CODE and the host's own knowledge of why it asked.
 * `FORBIDDEN_SCOPE` keeps the permission distinction: the requested scope is not the host's (restricted) versus the CURRENT principal no longer holding the grant (unauthorized).
 * The producer's `safe_message` and `diagnostic_ref` are never read here, so neither can reach a view. Faults are thrown as numeric status only.
 */
export function financeV2InputFromApiResult(result: CapturedApiResult, why: 'scope' | 'grant' = 'grant'): FinanceV2Input {
  if (result.ok) return { status: 'ready', page: result.value };
  switch (result.error.code) {
    case 'FORBIDDEN_SCOPE': return { status: why === 'scope' ? 'restricted' : 'unauthorized' };
    case 'VALIDATION_ERROR': case 'IDEMPOTENCY_CONFLICT': case 'UNSUPPORTED_VERSION': throw Object.assign(new Error('refused'), { status: 400 });
    case 'SOURCE_UNAVAILABLE': if (result.error.retryable) throw Object.assign(new Error('unavailable'), { status: 503 }); return { status: 'missing' };
    default: return { status: 'unknown' };
  }
}

/** The host's initial trusted normalized query: the recorded first-page query, with the host's own tamper applied. */
function trustedQuery(tamper: CapturedTamper): Record<string, Json> {
  const query = structuredClone(capturedPages[0]!.request) as Record<string, Json>;
  if (tamper === 'period') query.period = { ...(query.period as object), end: '2026-10-10T13:00:00.000Z' };
  if (tamper === 'filters') query.filters = { ...(query.filters as object), providers: ['provider-a'] };
  if (tamper === 'version') { query.schemaVersion = '1.0.0'; delete query.policyVersion; delete query.groupings; }
  return query;
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type CapturedPortOptions = Readonly<{ grant?: CapturedGrant; tamper?: CapturedTamper; delayContinuationMs?: number; log?: CapturedPortLog }>;

/**
 * Builds the FinancialSummaryQueryV2 for a read from the host's trusted query plus the view's request (scope, pageSize, snapshot, cursor), then answers with the recorded result of
 * that exact query. A query that was never recorded is refused by class: an unrecorded scope is `FORBIDDEN_SCOPE`, an unrecorded cursor is the recorded unsigned-cursor refusal.
 */
export function capturedPaginationPort(options: CapturedPortOptions = {}): FinanceV2SyntheticReadPort {
  const { grant = 'current', tamper = 'none', delayContinuationMs = 0, log = { reads: [] } } = options;
  let served = 0;
  return {
    kind: 'SYNTHETIC_PROPOSAL',
    read: async (request: FinanceV2ReadRequest): Promise<FinanceV2Input> => {
      const cursorPage = request.cursor === undefined ? null : capturedPages.findIndex((entry) => (entry.response as { nextCursor: string | null }).nextCursor === request.cursor) + 1 || -1;
      const entry: CapturedPortLog['reads'][number] = { page: cursorPage === null ? null : cursorPage, pageSize: request.pageSize ?? null, actorId: request.scope.actorId, revision: request.authorization.revision, outcome: 'pending', code: null };
      log.reads.push(entry);
      const answer = (result: CapturedApiResult, why: 'scope' | 'grant'): FinanceV2Input => {
        entry.code = result.ok ? null : result.error.code;
        try { const input = financeV2InputFromApiResult(result, why); entry.outcome = input.status; return input; } catch (error) { entry.outcome = `fault-${(error as { status: number }).status}`; throw error; }
      };
      if (request.cursor !== undefined && delayContinuationMs > 0) await delay(delayContinuationMs);
      if (grant === 'denied') return answer(observation('current_grant_denied').result, 'grant');
      if (grant === 'stale') return answer(observation('stale_current_grant').result, 'grant');
      if (grant === 'revoked' && served > 0) return answer(observation('revoked_after_commit').result, 'grant');
      const query = { ...trustedQuery(tamper), scope: request.scope as unknown as Json, ...(request.pageSize !== undefined ? { pageSize: request.pageSize } : {}) } as Record<string, Json>;
      // A first page is the recorded unbound query; a snapshot-bound first read (a tampered query or revoked grant) and every continuation also state the snapshot id the HOST expects.
      if (request.cursor !== undefined || tamper !== 'none') query.snapshotId = request.expectedSnapshotId;
      if (request.cursor !== undefined) query.cursor = request.cursor;
      const key = canonical(query);
      const index = capturedPages.findIndex((page) => canonical(page.request) === key);
      if (index >= 0) { served += 1; return answer({ ok: true, value: capturedPages[index]!.response as Json }, 'grant'); }
      const refused = capturedObservations.find((candidate) => canonical(candidate.request) === key);
      if (refused) return answer(refused.result, 'grant');
      if (canonical(query.scope) !== canonical(capturedBinding.scope)) return answer(observation('foreign_scope').result, 'scope');
      if (request.cursor !== undefined) return answer(observation('unsigned_cursor_forgery').result, 'grant');
      entry.outcome = 'unknown';
      return { status: 'unknown' };
    },
  };
}
