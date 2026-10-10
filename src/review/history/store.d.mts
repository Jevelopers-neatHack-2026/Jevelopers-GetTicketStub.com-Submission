declare const correctionTenantScopeBrand: unique symbol;

/** Opaque capability issued by this private store after its trusted tenant resolver runs. */
export type CorrectionTenantScope = { readonly [correctionTenantScopeBrand]: true };

export type ReviewFactField = 'event_name' | 'event_date' | 'venue' | 'event_status';
/** Zoned wall times reject gaps and preserve folds without selecting an instant. */
export type ReviewDateValue =
  | Readonly<{ precision: 'date'; value: string }>
  | Readonly<{ precision: 'local_datetime'; value: string; timeZone: string }>
  | Readonly<{ precision: 'instant'; value: string }>;
export type ReviewEventStatus = 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'completed';
export type ReviewValueFor<Field extends ReviewFactField> = Field extends 'event_date'
  ? ReviewDateValue
  : Field extends 'event_status'
    ? ReviewEventStatus
    : string;

export interface ReviewEvidenceReference {
  readonly evidenceId: string;
  readonly contentHash: string;
}

export interface ReviewSourceCandidate<Value> {
  readonly originStatus: 'sourced' | 'inferred';
  readonly value: Value;
  readonly sourceEvidence: readonly ReviewEvidenceReference[];
}

export type ReviewSourceFact<Value> =
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'sourced' | 'inferred'; value: Value; sourceEvidence: readonly ReviewEvidenceReference[] }>
  | Readonly<{ status: 'conflicting'; candidates: readonly [ReviewSourceCandidate<Value>, ReviewSourceCandidate<Value>, ...ReviewSourceCandidate<Value>[]] }>;

/** Initial values are source or inferred facts; customer values use a correction action. */
export type ReviewInitialFact<Value> = ReviewSourceFact<Value>;

export interface ReviewInitialFacts {
  readonly event_name?: ReviewInitialFact<string>;
  readonly event_date?: ReviewInitialFact<ReviewDateValue>;
  readonly venue?: ReviewInitialFact<string>;
  readonly event_status?: ReviewInitialFact<ReviewEventStatus>;
}

export interface ReviewRefreshedFacts {
  readonly event_name?: ReviewSourceFact<string>;
  readonly event_date?: ReviewSourceFact<ReviewDateValue>;
  readonly venue?: ReviewSourceFact<string>;
  readonly event_status?: ReviewSourceFact<ReviewEventStatus>;
}

export type ReviewFactStatus = 'sourced' | 'inferred' | 'customer_supplied' | 'missing' | 'conflicting';
export interface ReviewCorrectionRecord<Field extends ReviewFactField = ReviewFactField> {
  readonly origin: 'customer_supplied';
  readonly field: Field;
  readonly value: ReviewValueFor<Field>;
  /** Keyed actor reference. It does not contain an application user identifier. */
  readonly actorFingerprint: string;
  readonly revision: number;
  readonly createdAt: string;
}

export interface ReviewSourceClaim<Field extends ReviewFactField = ReviewFactField> {
  readonly originStatus: 'sourced' | 'inferred';
  readonly value: ReviewValueFor<Field>;
  readonly sourceEvidence: readonly ReviewEvidenceReference[];
  readonly sourceRevision: number;
}

export interface ReviewProjectedFact<Field extends ReviewFactField = ReviewFactField> {
  readonly field: Field;
  readonly status: ReviewFactStatus;
  readonly value?: ReviewValueFor<Field>;
  readonly sourceClaims: readonly ReviewSourceClaim<Field>[];
  readonly correctionHistory: readonly ReviewCorrectionRecord<Field>[];
  readonly currentCorrection?: ReviewCorrectionRecord<Field>;
  readonly sourceEvidence?: readonly ReviewEvidenceReference[];
  readonly candidates?: readonly Readonly<{
    value: ReviewValueFor<Field>;
    originStatus: 'sourced' | 'inferred';
    sourceEvidence: readonly ReviewEvidenceReference[];
    latestSourceRevision: number;
  }>[];
  readonly sourceCandidates?: readonly Readonly<{
    value: ReviewValueFor<Field>;
    originStatus: 'sourced' | 'inferred';
    sourceEvidence: readonly ReviewEvidenceReference[];
    latestSourceRevision: number;
  }>[];
  readonly disagreements?: readonly Readonly<{
    value: ReviewValueFor<Field>;
    originStatus: 'sourced' | 'inferred';
    sourceEvidence: readonly ReviewEvidenceReference[];
    latestSourceRevision: number;
  }>[];
}

export type ReviewQuestionCode = 'MISSING_REQUIRED_FACT' | 'CONFLICTING_SOURCE_FACTS' | 'SOURCE_REFRESH_REVIEW';
export interface ReviewQuestion<Field extends ReviewFactField = ReviewFactField> {
  readonly id: string;
  readonly code: ReviewQuestionCode;
  readonly field: Field;
  readonly expectedType: 'text' | 'date' | 'event_status';
  readonly state: 'open' | 'answered_customer_supplied';
  readonly sourceEvidence: readonly ReviewEvidenceReference[];
  readonly candidates?: readonly Readonly<{
    value: ReviewValueFor<Field>;
    originStatus: 'sourced' | 'inferred';
    sourceEvidence: readonly ReviewEvidenceReference[];
    latestSourceRevision: number;
  }>[];
}

export type ReviewReferenceKind = 'approval_reference' | 'handoff_reference' | 'consumer_reference';
export interface ReviewInvalidation {
  readonly referenceId: string;
  readonly referenceKind: ReviewReferenceKind;
  readonly priorVersionId: string;
  readonly priorContentHash: string;
  readonly reason: 'material_projection_changed' | 'new_version_requires_new_binding';
  readonly materialChange: boolean;
  readonly createdAt: string;
}

export interface CorrectionHistorySnapshot {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly revision: number;
  readonly versionId: string;
  readonly parentVersionId: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly retentionPolicy: Readonly<{ id: string; version: string }>;
  readonly fields: Readonly<{
    event_name: ReviewProjectedFact<'event_name'>;
    event_date: ReviewProjectedFact<'event_date'>;
    venue: ReviewProjectedFact<'venue'>;
    event_status: ReviewProjectedFact<'event_status'>;
  }>;
  readonly questions: readonly ReviewQuestion[];
  readonly invalidations: readonly ReviewInvalidation[];
  readonly materialHash: string;
  readonly contentHash: string;
}

export type ReviewHistoryErrorCode =
  | 'REVIEW_DENIED'
  | 'REVIEW_INVALID'
  | 'REVIEW_NOT_FOUND'
  | 'REVIEW_EXPIRED'
  | 'REVIEW_BUSY'
  | 'REVIEW_INTEGRITY'
  | 'REVIEW_KEY_UNAVAILABLE'
  | 'REVIEW_STORAGE'
  | 'REVIEW_STORAGE_LIMIT'
  | 'REVIEW_VERSION_CONFLICT'
  | 'REVIEW_IDEMPOTENCY_CONFLICT'
  | 'REVIEW_ALREADY_EXISTS'
  | 'REVIEW_FIELD_NOT_ALLOWED'
  | 'REVIEW_FIELD_LOCKED'
  | 'REVIEW_REFERENCE_CONFLICT'
  | 'REVIEW_ABORTED';

export declare class ReviewHistoryError extends Error {
  readonly code: ReviewHistoryErrorCode;
  constructor(code?: ReviewHistoryErrorCode);
}

export interface CorrectionHistoryKeyRequest {
  readonly tenantId: string;
  readonly purpose: 'correction_payload' | 'correction_index';
  readonly keyId?: string;
}
export interface CorrectionHistoryKey {
  readonly keyId: string;
  /** Fresh 32-byte key material from the trusted application key manager. */
  readonly key: Uint8Array;
}

export interface CorrectionHistoryRetentionRequest<Handle extends object = object> {
  readonly tenantId: string;
  readonly kind: 'correction_history';
  readonly nowMs: number;
  /** Existing evidence/privacy expiry. A correction history may shorten this, never extend it. */
  readonly sourceExpiresAtMs?: number;
  /** Opaque app-issued retention permit checked by trusted server composition. */
  readonly retentionHandle: Handle;
}
export interface CorrectionHistoryRetentionDecision {
  readonly expiresAtMs: number;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly accessPolicy: 'tenant_private';
}

export type CorrectionHistoryAction =
  | 'initialize_history'
  | 'read_history'
  | 'read_history_version'
  | 'list_history'
  | 'apply_correction'
  | 'refresh_source_facts'
  | 'record_downstream_reference'
  | 'read_downstream_references'
  | 'purge_correction_history';
export interface CorrectionHistoryAuthorization<Request = unknown> {
  readonly tenantId: string;
  readonly actorId: string;
  readonly eventId: string | null;
  readonly action: CorrectionHistoryAction;
  readonly field?: ReviewFactField;
  readonly request: Request;
}

export interface CorrectionHistoryStoreOptions<Request = unknown, RetentionHandle extends object = object> {
  /** Private local filesystem directory configured by the trusted composition root. */
  readonly directory: string;
  /** Must derive tenant identity from authenticated server-side request context. */
  readonly resolveTenant: (request: Request) => string | Promise<string>;
  /** Must derive the actor from authenticated server-side request context. */
  readonly resolveActor: (request: Request) => string | Promise<string>;
  /** Must authorize this exact action, tenant, actor, event, and optional field. */
  readonly authorize: (request: CorrectionHistoryAuthorization<Request>) => boolean | Promise<boolean>;
  readonly resolveKey: (request: CorrectionHistoryKeyRequest) => CorrectionHistoryKey | Promise<CorrectionHistoryKey>;
  readonly resolveRetention: (request: CorrectionHistoryRetentionRequest<RetentionHandle>) => CorrectionHistoryRetentionDecision | Promise<CorrectionHistoryRetentionDecision>;
  /** Explicit server-owned allowlist; defaults to the four typed event fields. */
  readonly allowedFields?: readonly ReviewFactField[];
  /** Required server-owned lock policy. A locked field can never be corrected through this port. */
  readonly lockedFields: readonly ReviewFactField[];
  readonly now?: () => number;
  readonly maxRetentionMs?: number;
  readonly maxStoredBytes?: number;
  readonly maxHistories?: number;
  readonly maxRevisionsPerHistory?: number;
  readonly lockTimeoutMs?: number;
}

export interface HistoryWriteOptions {
  /** Pass a genuine, non-proxy signal directly from trusted in-process code. The runtime getter is not an authenticity check for symbol-copied objects. */
  readonly signal?: AbortSignal;
}
export interface HistoryWriteResult {
  readonly snapshot: CorrectionHistorySnapshot;
  readonly replayed: boolean;
  readonly invalidations: readonly ReviewInvalidation[];
}

export interface CreateHistoryInput<Handle extends object = object> {
  readonly eventId: string;
  readonly sourceFacts: ReviewInitialFacts;
  readonly idempotencyKey: string;
  readonly retentionHandle: Handle;
}
export interface CorrectionInput<Field extends ReviewFactField = ReviewFactField, Handle extends object = object> {
  readonly eventId: string;
  readonly baseVersionId: string;
  readonly baseContentHash: string;
  readonly field: Field;
  readonly value: ReviewValueFor<Field>;
  readonly idempotencyKey: string;
  readonly retentionHandle: Handle;
}
export interface SourceRefreshInput<Handle extends object = object> {
  readonly eventId: string;
  readonly baseVersionId: string;
  readonly baseContentHash: string;
  readonly sourceFacts: ReviewRefreshedFacts;
  readonly idempotencyKey: string;
  readonly retentionHandle: Handle;
}
export interface DownstreamReferenceInput {
  readonly eventId: string;
  readonly versionId: string;
  readonly contentHash: string;
  readonly referenceId: string;
  readonly kind: ReviewReferenceKind;
}
export interface DownstreamReferenceRecord {
  readonly referenceId: string;
  readonly kind: ReviewReferenceKind;
  readonly boundVersionId: string;
  readonly boundContentHash: string;
  readonly state: 'bound_to_version' | 'invalidated';
  readonly invalidatedByVersionId?: string;
  readonly reason?: ReviewInvalidation['reason'];
  readonly materialChange?: boolean;
}
export interface DownstreamReferenceWriteResult {
  readonly referenceId: string;
  readonly kind: ReviewReferenceKind;
  readonly versionId: string;
  readonly contentHash: string;
  readonly replayed: boolean;
}

export interface CorrectionHistoryStore<Request = unknown, RetentionHandle extends object = object> {
  scopeForAuthenticatedRequest(request: Request): Promise<CorrectionTenantScope>;
  createHistory(scope: CorrectionTenantScope, input: CreateHistoryInput<RetentionHandle>, request: Request, options?: HistoryWriteOptions): Promise<HistoryWriteResult>;
  getHistory(scope: CorrectionTenantScope, eventId: string, request: Request): Promise<CorrectionHistorySnapshot>;
  getHistoryVersion(scope: CorrectionTenantScope, eventId: string, versionId: string, request: Request): Promise<CorrectionHistorySnapshot>;
  listHistory(scope: CorrectionTenantScope, eventId: string, request: Request): Promise<readonly CorrectionHistorySnapshot[]>;
  applyCorrection<Field extends ReviewFactField>(scope: CorrectionTenantScope, input: CorrectionInput<Field, RetentionHandle>, request: Request, options?: HistoryWriteOptions): Promise<HistoryWriteResult>;
  refreshSources(scope: CorrectionTenantScope, input: SourceRefreshInput<RetentionHandle>, request: Request, options?: HistoryWriteOptions): Promise<HistoryWriteResult>;
  registerDownstreamReference(scope: CorrectionTenantScope, input: DownstreamReferenceInput, request: Request): Promise<DownstreamReferenceWriteResult>;
  listDownstreamReferences(scope: CorrectionTenantScope, eventId: string, request: Request): Promise<readonly DownstreamReferenceRecord[]>;
  purgeExpired(scope: CorrectionTenantScope, request: Request): Promise<number>;
}

/** Internal projection/history API only; it does not define a public package or authenticated route. */
export declare function createCorrectionHistoryStore<Request = unknown, RetentionHandle extends object = object>(
  options: CorrectionHistoryStoreOptions<Request, RetentionHandle>,
): CorrectionHistoryStore<Request, RetentionHandle>;

export declare const REVIEW_FACT_FIELDS: readonly ReviewFactField[];
