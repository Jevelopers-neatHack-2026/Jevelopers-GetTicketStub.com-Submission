/**
 * Fixture-host private paging context. The opaque Finance cursor is request metadata held ONLY in `history.state` under one namespaced key, next to an identity binding the host
 * states independently. It is never written to the DOM, to any href or to any URL, and it never carries a token or credential. Restoring it grants nothing: it is accepted only when
 * every binding field equals what the host states now, and the connected view still gets a fresh token and verifies every answer. The model library knows none of this.
 */
export const PAGING_CONTEXT_KEY = 'tdFinancePagingContext';

export type PagingBinding = Readonly<{
  tenantId: string; projectId: string; environment: string; billingMode: string; actorId: string;
  snapshotId: string; queryContentHash: string; summaryContentHash: string;
  revision: string; pageSize: number | null; valuation: string; currency: string;
}>;
export type PagingContext = Readonly<{ version: 1; cursor: string; binding: PagingBinding }>;

const BINDING_STRINGS = ['tenantId', 'projectId', 'environment', 'billingMode', 'actorId', 'snapshotId', 'queryContentHash', 'summaryContentHash', 'revision', 'valuation', 'currency'] as const;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Strict shape check. Cursor length is left to the connected view, which refuses an out-of-range cursor before any read. */
export function parsePagingContext(value: unknown): PagingContext | undefined {
  if (!record(value)) return undefined;
  const raw = value[PAGING_CONTEXT_KEY];
  if (!record(raw) || raw.version !== 1 || typeof raw.cursor !== 'string' || !record(raw.binding)) return undefined;
  if (Object.keys(raw).length !== 3 || Object.keys(raw.binding).length !== BINDING_STRINGS.length + 1) return undefined;
  const binding = raw.binding;
  if (!BINDING_STRINGS.every((key) => typeof binding[key] === 'string')) return undefined;
  if (binding.pageSize !== null && typeof binding.pageSize !== 'number') return undefined;
  return raw as unknown as PagingContext;
}

/** Every field is compared; any difference discards the context (a scope, actor, snapshot, query, summary, revision, page size or filter change). */
export function bindingMatches(context: PagingContext, current: PagingBinding): boolean {
  return (Object.keys(current) as (keyof PagingBinding)[]).every((key) => Object.is(context.binding[key], current[key]));
}

/** The validated cursor for this binding, or undefined (discard) when the stored context is absent, malformed or stale. */
export function restorePagingCursor(state: unknown, current: PagingBinding): string | undefined {
  const context = parsePagingContext(state);
  return context && bindingMatches(context, current) ? context.cursor : undefined;
}

/** State to store for a page request: the context for a cursor, or none for the first page. Other history state is not kept. */
export const pagingState = (cursor: string | null, binding: PagingBinding): unknown => (cursor === null ? null : { [PAGING_CONTEXT_KEY]: { version: 1, cursor, binding } });
