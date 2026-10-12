import type { FinanceV2Input, FinanceV2Page, FinanceV2ReadRequest, FinanceV2SyntheticReadPort, ReportingDetail } from '../../src/views/finance-v2';
import { financeV2Fixture } from '../../src/views/finance-v2/fixtures';

/**
 * HAND-AUTHORED SYNTHETIC multi-page port data, for implementation regression only. It is NOT Finance output, NOT a producer-produced continuation chain and NOT
 * evidence for any acceptance: the producer's real continuation pages 2/3 (same snapshot, query and hashes) are still pending, and the nine pinned producer files under
 * `tests/fixtures/finance-v2-conformance` are untouched and never relabelled. Cursors below are arbitrary opaque strings that only this port understands; the dashboard
 * never reads them. Every page is answered for exactly the request (scope, snapshot id, query hash, summary hash), the way a correct port must.
 */
export const syntheticPagedCursors = ['synthetic-opaque-cursor-for-page-2', 'synthetic-opaque-cursor-for-page-3'] as const;
export const syntheticPagedMisbehaviors = ['snapshot-mismatch', 'query-hash-mismatch', 'summary-hash-mismatch', 'scope-mismatch', 'replay', 'cursor-loop', 'empty-cursor', 'stray-cursor'] as const;
export type SyntheticPagedMisbehavior = (typeof syntheticPagedMisbehaviors)[number];
/** One scripted deviation per page index (1 and 2 are continuation pages): a wrong page, a typed fault status, or a late answer that ignores the abort signal. */
export type SyntheticPagedScript = Partial<Record<0 | 1 | 2, SyntheticPagedMisbehavior | Readonly<{ fault: number }> | 'slow'>>;

const other = (n: number): string => `sha256:${n.toString(16).padStart(64, '0')}`;
const basePage = (): FinanceV2Page => structuredClone((financeV2Fixture('ready').input as { page: FinanceV2Page }).page);
const subcent = (detail: ReportingDetail, n: number, amount: string): ReportingDetail => ({ ...detail, detailId: other(900 + n), amount, eventType: 'sale.adjusted' });

/** Page `index` (0 = first) of the three synthetic pages, bound to exactly what the request states. */
export function syntheticPagedPage(index: 0 | 1 | 2, request: FinanceV2ReadRequest): { -readonly [K in keyof FinanceV2Page]: FinanceV2Page[K] } {
  const base = basePage();
  const [aiCost, sale, refund, unknown] = base.details as [ReportingDetail, ReportingDetail, ReportingDetail, ReportingDetail];
  const details = [[aiCost, sale], [refund, unknown], [subcent(sale, 1, '0.000000000000000001'), subcent(refund, 2, '-0.000000000000000500')]][index]!;
  return {
    ...base, scope: request.scope, snapshotId: request.expectedSnapshotId, queryContentHash: request.expectedQueryContentHash, summaryContentHash: request.expectedSummaryContentHash,
    requestId: `synthetic-paged-${index + 1}:${request.scope.actorId}:rev-${request.authorization.revision}`,
    details, detailCount: 6, hasMore: index < 2, nextCursor: index < 2 ? syntheticPagedCursors[index as 0 | 1] : null,
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export type SyntheticPagedLog = { requests: Array<{ cursor: string | null; pageSize: number | null; actorId: string; revision: string; token: string }> };

/** A SYNTHETIC_PROPOSAL port that serves the three synthetic pages by cursor. An unknown cursor reads `missing`; it is looked up, never parsed. */
export function syntheticPagedPort(script: SyntheticPagedScript = {}, log: SyntheticPagedLog = { requests: [] }): FinanceV2SyntheticReadPort {
  return {
    kind: 'SYNTHETIC_PROPOSAL',
    read: async (request): Promise<FinanceV2Input> => {
      log.requests.push({ cursor: request.cursor ?? null, pageSize: request.pageSize ?? null, actorId: request.scope.actorId, revision: request.authorization.revision, token: request.authorization.token });
      const known = request.cursor === undefined ? 0 : syntheticPagedCursors.indexOf(request.cursor as (typeof syntheticPagedCursors)[number]) + 1;
      if (request.cursor !== undefined && known === 0) return { status: 'missing' };
      const index = known as 0 | 1 | 2;
      const scripted = script[index];
      if (scripted === 'slow') await delay(1500);
      if (typeof scripted === 'object') throw Object.assign(new Error('synthetic fault'), { status: scripted.fault });
      const page = syntheticPagedPage(index, request);
      switch (scripted) {
        case 'snapshot-mismatch': page.snapshotId = other(1); break;
        case 'query-hash-mismatch': page.queryContentHash = other(2); break;
        case 'summary-hash-mismatch': page.summaryContentHash = other(3); break;
        case 'scope-mismatch': page.scope = { ...page.scope, tenantId: 'account:another-tenant' }; break;
        case 'replay': page.details = syntheticPagedPage(0, request).details; break;
        case 'cursor-loop': page.hasMore = true; page.nextCursor = request.cursor ?? syntheticPagedCursors[0]; break;
        case 'empty-cursor': page.hasMore = true; page.nextCursor = ''; break;
        case 'stray-cursor': page.hasMore = false; page.nextCursor = syntheticPagedCursors[1]; break;
        default: break;
      }
      return { status: 'ready', page };
    },
  };
}
