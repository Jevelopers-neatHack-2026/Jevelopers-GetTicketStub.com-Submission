import { createCorrectionHistoryStore, ReviewHistoryError } from '../../../src/review/history/store.mjs';
import type {
  CorrectionHistoryStore,
  CorrectionTenantScope,
  ReviewInitialFacts,
} from '../../../src/review/history/store.mjs';

interface AuthenticatedRequest {
  readonly principal: Readonly<{ tenantId: string; actorId: string }>;
}
interface RetentionPermit { readonly opaque: unique symbol }

declare const request: AuthenticatedRequest;
declare const permit: RetentionPermit;
declare const directory: string;
declare const inputFacts: ReviewInitialFacts;
const customerOriginFact = { status: 'customer_supplied', value: 'cancelled' } as const;
// @ts-expect-error initial history facts accept source claims only; customers use the correction operation
const invalidInitialFacts: ReviewInitialFacts = { event_status: customerOriginFact };
declare const store: CorrectionHistoryStore<AuthenticatedRequest, RetentionPermit>;
declare const scope: CorrectionTenantScope;

const configured = createCorrectionHistoryStore<AuthenticatedRequest, RetentionPermit>({
  directory,
  resolveTenant: (value) => value.principal.tenantId,
  resolveActor: (value) => value.principal.actorId,
  authorize: ({ tenantId, actorId, request: value }) => value.principal.tenantId === tenantId
    && value.principal.actorId === actorId,
  authorizeBoundary: ({ tenantId, actorId, eventId, action, field, request: value }) =>
    value.principal.tenantId === tenantId && value.principal.actorId === actorId
      ? { authorized: true, tenantId, actorId, eventId, action, field, nowMs: 1_800_000_000_000 }
      : false,
  resolveKey: ({ purpose }) => ({ keyId: `${purpose}-v1`, key: new Uint8Array(32) }),
  resolveRetention: ({ nowMs, sourceExpiresAtMs }) => ({
    expiresAtMs: Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
    policyId: 'test',
    policyVersion: '1',
    accessPolicy: 'tenant_private',
  }),
  lockedFields: ['event_status'],
});

const created = await configured.createHistory(scope, {
  eventId: 'event-1',
  sourceFacts: inputFacts,
  idempotencyKey: 'initialize-1',
  retentionHandle: permit,
}, request);
const corrected = await store.applyCorrection(scope, {
  eventId: 'event-1',
  baseVersionId: created.snapshot.versionId,
  baseContentHash: created.snapshot.contentHash,
  field: 'event_date',
  value: { precision: 'local_datetime', value: '2027-06-20T18:30', timeZone: 'America/New_York' },
  idempotencyKey: 'correct-1',
  retentionHandle: permit,
}, request);
const oldVersion = await store.getHistoryVersion(scope, 'event-1', created.snapshot.versionId, request);
const history: readonly typeof created.snapshot[] = await store.listHistory(scope, 'event-1', request);
const typedError: ReviewHistoryError | undefined = undefined;
void corrected.snapshot.fields.event_date.status;
void oldVersion.contentHash;
void history;
void typedError;

// @ts-expect-error tenant scopes are issued by the trusted store, not caller-supplied IDs
const forgedScope: CorrectionTenantScope = { tenantId: 'tenant-b' };
const invalidStatus = store.applyCorrection(scope, {
  eventId: 'event-1', baseVersionId: 'v1', baseContentHash: '0'.repeat(64), field: 'event_status',
  // @ts-expect-error status corrections accept only the typed event-status enum
  value: 'approved', idempotencyKey: 'bad-status', retentionHandle: permit,
}, request);
const forgedApproval = store.applyCorrection(scope, {
  eventId: 'event-1', baseVersionId: 'v1', baseContentHash: '0'.repeat(64), field: 'venue', value: 'Civic Hall',
  idempotencyKey: 'bad-approval', retentionHandle: permit,
  // @ts-expect-error correction input rejects client-supplied approval assertions
  approval: { approved: true },
}, request);
void forgedScope;
void invalidStatus;
void forgedApproval;
void invalidInitialFacts;
