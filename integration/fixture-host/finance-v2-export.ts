import { FINANCE_EXPORT, FINANCE_READ } from '../../src/access/permissions';
import type { FinanceV2ExportHostAccess, FinanceV2Input, FinanceV2Page, FinanceV2PreparedExportRequest, FinanceV2SyntheticExportPort, FinanceV2SyntheticReadPort, OpaqueProductScope } from '../../src/views/finance-v2';
import { FINANCE_V2_EXPORT_KIND } from '../../src/views/finance-v2';
import { financeV2Fixture } from '../../src/views/finance-v2/fixtures';
import receiptZero from '../../tests/fixtures/export-conformance/candidate-receipts/receipt-00.json';

/**
 * SYNTHETIC_EXPORT_CONFORMANCE_ONLY fixture-host data. The export port REPLAYS the Finance producer's ACTUAL candidate receipt 0 (its exact manifest and artifact bytes, committed under
 * `tests/fixtures/export-conformance` and pinned to the handoff digests) or one of a few clearly labelled test-built deviations of it. The page under it is the synthetic `ready` fixture
 * re-bound to receipt 0's snapshot, hashes, period and as-of: a presentation page, not Finance output. Neither is a mounted host, a live Product issuer, a coherent live fence, CFO delivery,
 * or a consumer acceptance. The packed package never imports this file; a host injects its products, and only in SYNTHETIC_PROPOSAL mode.
 */
export { FINANCE_EXPORT, FINANCE_READ };
const zero = receiptZero as unknown as { query: { snapshotId: string; queryContentHash: string; summaryContentHash: string }; receipt: ReceiptShape };
type ReceiptShape = { schemaVersion: string; artifacts: { fileName: string; mediaType: string; content: string; contentHash: string; byteLength: number }[]; manifest: Record<string, unknown> & { artifacts: { byteLength: number }[] } };

export const exportConformanceScope: OpaqueProductScope = Object.freeze({ tenantId: 'account:synthetic-tenant', projectId: 'event:synthetic-project', environment: 'test', billingMode: 'live', actorId: 'account:synthetic-actor' });
export const exportConformanceIdentity = Object.freeze({ snapshotId: zero.query.snapshotId, queryContentHash: zero.query.queryContentHash, summaryContentHash: zero.query.summaryContentHash });

/** The synthetic `ready` page re-bound to receipt 0, and to the scope the request states (so an actor or project switch is answered for that scope, like a correct port). */
export function exportConformancePage(scope: OpaqueProductScope = exportConformanceScope): FinanceV2Page {
  const base = structuredClone((financeV2Fixture('ready').input as { page: FinanceV2Page }).page);
  return {
    ...base, ...exportConformanceIdentity, scope, asOf: '2026-10-12T22:00:00.000Z', period: { start: '2026-10-10T00:00:00.000Z', end: '2026-10-11T00:00:00.000Z' },
    filters: { environments: ['test'], billingModes: ['live'] }, requestId: `synthetic-export-conformance:${scope.actorId}`,
  };
}
export const exportConformanceInput = (): FinanceV2Input => ({ status: 'ready', page: exportConformancePage() });
export function exportConformanceReadPort(): FinanceV2SyntheticReadPort {
  return { kind: 'SYNTHETIC_PROPOSAL', read: async (request) => ({ status: 'ready', page: exportConformancePage(request.scope) }) };
}

/** The host's CURRENT access, held outside React so a change needs no render to be visible to the Dashboard's synchronous check. Updated by the host's own handlers BEFORE it re-renders. */
export type ExportHostStore = { access: FinanceV2ExportHostAccess };
export function createExportHostStore(scope: OpaqueProductScope = exportConformanceScope): ExportHostStore {
  return { access: { revision: '1', scope, capabilities: [FINANCE_READ, FINANCE_EXPORT], expiresAt: '2099-01-01T00:00:00Z' } };
}
export const storeReader = (store: ExportHostStore) => (): FinanceV2ExportHostAccess => store.access;
export const withoutCapability = (access: FinanceV2ExportHostAccess, capability: string): FinanceV2ExportHostAccess => ({ ...access, capabilities: access.capabilities.filter((entry) => entry !== capability) });
export const withCapability = (access: FinanceV2ExportHostAccess, capability: string): FinanceV2ExportHostAccess => ({ ...access, capabilities: access.capabilities.includes(capability) ? access.capabilities : [...access.capabilities, capability] });

export const exportBehaviors = [
  'ok', 'csv-control', 'forbidden', 'source', 'conflict', 'validation', 'unsupported', 'tamper-snapshot', 'tamper-query', 'tamper-csv-scope', 'delivered', 'legacy', 'extra', 'slow', 'hang', 'fault500', 'revoke-during',
] as const;
export type ExportBehavior = (typeof exportBehaviors)[number];

export const EXPORT_CANARY = 'CANARY-PORT-MESSAGE-must-never-be-shown';
export type ExportPortLog = { requests: Array<{ format: string; actorId: string; revision: string; token: string; snapshotId: string; destination: string }> };
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const failure = (code: string) => ({ ok: false, error: { code, safe_message: EXPORT_CANARY, diagnostic: { token: 'CANARY-TOKEN' } } });

/**
 * Replays the exact producer receipt 0 for any request (the producer captured only `json` preparations, so a CSV request is answered with that same JSON-prepared receipt and the
 * Dashboard must refuse it on format). Every other behaviour is a labelled test-built deviation of that receipt, never producer output.
 */
export function exportConformancePort(behavior: ExportBehavior, log: ExportPortLog, onRevoke: () => void = () => undefined): FinanceV2SyntheticExportPort {
  return {
    kind: FINANCE_V2_EXPORT_KIND,
    prepare: async (request: FinanceV2PreparedExportRequest): Promise<unknown> => {
      log.requests.push({ format: request.format, actorId: request.scope.actorId, revision: request.authorization.revision, token: request.authorization.token, snapshotId: request.summarySnapshot.snapshotId, destination: request.destination });
      const receipt = structuredClone(zero.receipt);
      switch (behavior) {
        // TEST_BUILT CSV control: receipt 0 untouched except `requestedFormat`; its original metrics.csv bytes, contentHash and length are replayed. Not a producer CSV preparation.
        case 'csv-control': receipt.manifest.requestedFormat = 'csv'; return { ok: true, value: receipt };
        case 'slow': await delay(1500); return { ok: true, value: receipt };
        case 'hang': return new Promise<never>(() => undefined);
        case 'fault500': throw Object.assign(new Error(EXPORT_CANARY), { status: 503 });
        case 'forbidden': return failure('FORBIDDEN_SCOPE');
        case 'source': return failure('SOURCE_UNAVAILABLE');
        case 'conflict': return failure('IDEMPOTENCY_CONFLICT');
        case 'validation': return failure('VALIDATION_ERROR');
        case 'unsupported': return failure('UNSUPPORTED_VERSION');
        case 'tamper-snapshot': receipt.manifest.snapshotId = `sha256:${'a'.repeat(64)}`; return { ok: true, value: receipt };
        case 'tamper-query': receipt.manifest.queryContentHash = `sha256:${'b'.repeat(64)}`; return { ok: true, value: receipt };
        case 'tamper-csv-scope': {
          // Same length, so only the binding is wrong: the CSV rows say a different billing mode than the host's scope.
          const csv = receipt.artifacts.find((artifact) => artifact.fileName === 'metrics.csv')!;
          csv.content = csv.content.replaceAll(',test,live,', ',test,sand,');
          return { ok: true, value: receipt };
        }
        case 'delivered': receipt.manifest.status = 'delivered'; receipt.manifest.delivery = 'delivered'; receipt.manifest.deliveryReference = 'cfo-delivery-1'; return { ok: true, value: receipt };
        case 'legacy': return { ok: true, value: { manifest: { schemaVersion: '1.0.0' }, artifactManifest: { schemaVersion: '2.0.0' }, artifacts: receipt.artifacts } };
        case 'extra': receipt.manifest.invented = 'x'; return { ok: true, value: receipt };
        case 'revoke-during': onRevoke(); return { ok: true, value: receipt };
        default: return { ok: true, value: receipt };
      }
    },
  };
}
