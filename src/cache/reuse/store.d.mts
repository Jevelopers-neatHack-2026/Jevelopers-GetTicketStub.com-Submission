import type { PrivacyBoundary, SanitizedDerivative, TenantScope } from '../../privacy/boundary.mjs';

declare const reuseScopeBrand: unique symbol;
export type ScopedReuseScope = { readonly [reuseScopeBrand]: true };

export type ReuseErrorCode =
  | 'REUSE_DENIED'
  | 'REUSE_INVALID'
  | 'REUSE_NOT_FOUND'
  | 'REUSE_BUSY'
  | 'REUSE_STORAGE'
  | 'REUSE_INTEGRITY'
  | 'REUSE_KEY_UNAVAILABLE'
  | 'REUSE_CAPACITY'
  | 'REUSE_POLICY_UNAVAILABLE';

export declare class ScopedReuseError extends Error {
  readonly code: ReuseErrorCode;
  constructor(code: ReuseErrorCode);
}

export interface CacheIdentity {
  readonly occurrenceId: string;
  readonly entityId: string;
  readonly editionId: string;
}

export interface ReusePins {
  readonly schemaVersion: string;
  readonly extractorVersion: string;
  readonly questionSetVersion: string;
  readonly policyHash: string;
  readonly modelVersion: string;
}

export type PrivateFact = Readonly<{
  status: 'sourced' | 'inferred' | 'customer_supplied';
  value: string;
  reason?: string;
  supportRefs?: readonly string[];
}> | Readonly<{
  status: 'missing';
  reason?: string;
  supportRefs?: readonly string[];
}> | Readonly<{
  status: 'conflicting';
  reason?: string;
  candidates: readonly Readonly<{
    status: 'sourced' | 'inferred' | 'customer_supplied';
    value: string;
    supportRefs: readonly string[];
  }> [];
  supportRefs?: readonly string[];
}>;

export interface CacheLineage {
  readonly logicalOperationId?: string | null;
  readonly billableAttemptId?: string | null;
  readonly transportAttemptId?: string | null;
  readonly providerRequestId?: string | null;
  readonly observationIds?: readonly string[];
  readonly usageEventIds?: readonly string[];
  readonly status: 'complete' | 'unknown';
}

export type FreshnessStatus = 'body_changed' | 'not_modified' | 'removed' | 'outage' | 'evidence_lost';
export interface SourceObservation {
  readonly status: FreshnessStatus;
  readonly contentHash?: string;
  /** Present only when the host verified a newly retrieved body. */
  readonly retrievedAt?: string;
  /** Time the source observation was successfully validated. */
  readonly validatedAt: string;
  readonly sourceVersion?: string | null;
  readonly attemptLineage?: CacheLineage;
}

export type FreshnessObservation = Readonly<{
  readonly status: FreshnessStatus;
  readonly contentHash?: string | null;
  readonly retrievedAt: string;
  readonly validatedAt: string;
  readonly invalidated?: boolean;
  readonly usageLineage?: 'complete' | 'unknown';
}> | Readonly<{ status: 'unavailable'; reason: 'clock_rollback'; profileRef?: string }>;

export type InvalidationReason =
  | 'material_fact_change'
  | 'rights_revocation'
  | 'evidence_lost'
  | 'permission_expiry';

export interface ReuseKeyRequest {
  readonly tenantId: string | null;
  readonly scope: 'tenant_private' | 'public_profile';
  readonly purpose: 'index' | 'payload';
  readonly keyId?: string;
}

export interface ReuseKey {
  readonly keyId: string;
  readonly key: Uint8Array;
}

export interface RetentionDecision {
  readonly expiresAtMs: number;
  readonly policyId: string;
  readonly policyVersion: string;
}

export interface ReusePermission {
  readonly reference: string;
  readonly contentHash: string;
  readonly version: number;
  readonly use: string;
}

export interface PermissionVerification {
  readonly status: 'valid';
  readonly reference: string;
  readonly contentHash: string;
  readonly version: number;
  readonly use: string;
  readonly validUntilMs: number;
}

export interface PrivateProfileReferences {
  readonly permissions?: readonly ReusePermission[];
  readonly sourceRefs?: readonly string[];
  readonly correctionRefs?: readonly string[];
}

export interface PublicPublicationAttestation {
  readonly status: 'approved';
  readonly identity: CacheIdentity;
  readonly contentHash: string;
  readonly publicPermissions?: readonly ReusePermission[];
}

export interface LookupInput {
  readonly identity: CacheIdentity;
  readonly contentHash: string;
  readonly pins: ReusePins;
}

export type LookupResult =
  | Readonly<{ status: 'miss' }>
  | Readonly<{ status: 'hit'; profileRef: string; version: number; facts: Readonly<Record<string, PrivateFact | string>>; trust: 'tenant_private' | 'untrusted_external'; rights?: 'not_asserted'; permissionStatus: string; retrievedAt: string; validatedAt: string; expiresAt: string; originalLineageStatus: 'complete' | 'unknown' }>
  | Readonly<{ status: 'stale'; reason: 'policy_hash_stale' | 'body_changed' | 'ttl_expired' | 'identity_version_mismatch' | 'content_hash_mismatch'; profileRef: string }>
  | Readonly<{ status: 'unavailable'; reason: 'clock_rollback' }>
  | Readonly<{ status: 'unavailable'; reason: 'invalidated' | 'expired' | 'source_removed' | 'evidence_lost' | 'source_outage' | 'invalid_validation_time' | 'observation_missing' | 'observation_changed'; profileRef: string }>
  | Readonly<{ status: 'ineligible'; reason: string; profileRef: string }>;
export type PrivateLookupResult =
  | Readonly<{ status: 'miss' }>
  | Readonly<{ status: 'hit'; profileRef: string; version: number; facts: Readonly<Record<string, PrivateFact>>; trust: 'tenant_private'; permissionStatus: string; retrievedAt: string; validatedAt: string; expiresAt: string; originalLineageStatus: 'complete' | 'unknown' }>
  | Exclude<LookupResult, { status: 'hit' }>;
export type PublicLookupResult =
  | Readonly<{ status: 'miss' }>
  | Readonly<{ status: 'hit'; profileRef: string; version: number; facts: Readonly<Record<string, string>>; trust: 'untrusted_external'; rights: 'not_asserted'; permissionStatus: string; retrievedAt: string; validatedAt: string; expiresAt: string; originalLineageStatus: 'complete' | 'unknown' }>
  | Exclude<LookupResult, { status: 'hit' }>;

export type AdmissionResult =
  | Readonly<{ status: 'unavailable'; reason: 'clock_rollback' }>
  | Readonly<{ status: 'admitted' | 'refresh_unresolved'; admissionRef: string; usage: 'unknown'; providerTransport: 'not_implemented' }>
  | Readonly<{ status: 'in_flight'; admissionRef: string; usage: 'unresolved' }>
  | Readonly<{ status: 'needs_reconciliation'; admissionRef: string; usage: 'unknown' }>
  | Readonly<{ status: 'already_completed'; admissionRef: string; usage: 'unresolved' }>;

export interface ScopedReuseOptions<Request = unknown> {
  readonly directory: string;
  readonly resolveTenant: (request: Request) => string | Promise<string>;
  readonly resolveActor: (request: Request) => string | Promise<string>;
  readonly authorizeAction: (input: { readonly tenantId: string; readonly actorId: string; readonly action: string; readonly request: Request; readonly details: Readonly<Record<string, unknown>> }) => boolean | Promise<boolean>;
  /** Private local final-disclosure adapter. The trusted host must bind the current request principal to the expected issued scope and authorize the exact action in one decision. No cache-controlled async identity or policy work follows a true result; this is not a canonical contract, approval, or durable lease. */
  readonly authorizeCurrentRequest: (input: { readonly expectedTenantId: string; readonly expectedActorId: string; readonly action: string; readonly request: Request; readonly details: Readonly<Record<string, unknown>> }) => boolean | Promise<boolean>;
  readonly resolveKey: (input: ReuseKeyRequest) => ReuseKey | Promise<ReuseKey>;
  readonly resolveRetention: (input: { readonly tenantId: string | null; readonly kind: 'tenant_private' | 'public_profile'; readonly nowMs: number; readonly requestedExpiryMs: number | null }) => RetentionDecision | Promise<RetentionDecision>;
  readonly verifySourceObservation?: (input: { readonly tenantId: string | null; readonly actorId: string | null; readonly request: Request; readonly purpose: 'initial' | 'revalidate'; readonly expectedContentHash: string; readonly observation: unknown }) => SourceObservation | Promise<SourceObservation>;
  readonly authorizePublicPublication?: (input: { readonly tenantId: string; readonly actorId: string; readonly request: Request; readonly boundaryTrust: 'untrusted_external'; readonly facts: Readonly<{ event_name?: string; event_date?: string; venue?: string }>; readonly identity: CacheIdentity; readonly contentHash: string; readonly boundaryScope: TenantScope; readonly sourceRecordId: string }) => PublicPublicationAttestation | Promise<PublicPublicationAttestation>;
  readonly resolvePrivateProfileReferences?: (input: { readonly tenantId: string; readonly actorId: string; readonly request: Request; readonly kind: 'tenant_private' | 'public_profile'; readonly identity: CacheIdentity; readonly contentHash: string; readonly projection: Readonly<Record<string, PrivateFact | string>> }) => PrivateProfileReferences | Promise<PrivateProfileReferences>;
  readonly verifyPermission?: (input: { readonly tenantId: string | null; readonly actorId: string | null; readonly request: Request; readonly reference: string; readonly contentHash: string; readonly version: number; readonly use: string; readonly nowMs: number }) => PermissionVerification | 'expired' | 'revoked' | 'unverified' | Promise<PermissionVerification | 'expired' | 'revoked' | 'unverified'>;
  readonly resolveLineage?: (input: { readonly tenantId: string | null; readonly actorId: string | null; readonly request: Request; readonly descriptor: Readonly<Record<string, unknown>> }) => CacheLineage | Promise<CacheLineage>;
  readonly consumeOriginalLineage?: (input: { readonly tenantId: string; readonly actorId: string; readonly request: Request; readonly profileRef: string; readonly scope: 'tenant_private'; readonly contentHash: string; readonly version: number; readonly lineage: CacheLineage; readonly sourceRefs: readonly string[]; readonly correctionRefs: readonly string[]; readonly permissions: readonly ReusePermission[] }) => { readonly status: 'linked' | 'incomplete' | 'unavailable'; readonly logicalOperationBound: boolean; readonly billedAttemptCount: number; readonly usageObservationCount: number } | Promise<{ readonly status: 'linked' | 'incomplete' | 'unavailable'; readonly logicalOperationBound: boolean; readonly billedAttemptCount: number; readonly usageObservationCount: number }>;
  readonly resolveInvalidationConsumers?: (input: { readonly tenantId: string | null; readonly actorId: string | null; readonly request: Request; readonly descriptor: Readonly<Record<string, unknown>> & { readonly publicSafeOnly?: true } }) => readonly string[] | Promise<readonly string[]>;
  readonly deliverInvalidation?: (event: Readonly<{ readonly eventId: string; readonly consumerRef: string; readonly entryRef: string; readonly contentHash: string; readonly version: number; readonly deliveryAttemptId: string; readonly attemptNumber: number; readonly reason: string }>) => unknown | Promise<unknown>;
  readonly verifyInvalidationAcknowledgement?: (input: { readonly expected: Readonly<Record<string, unknown>>; readonly acknowledgement: unknown; readonly tenantId: string; readonly actorId: string }) => boolean | Promise<boolean>;
  readonly verifyAdmissionOutcome?: (input: { readonly tenantId: string; readonly actorId: string; readonly request: Request; readonly admissionRef: string; readonly existingState: string; readonly requestedOutcome: 'completed' | 'unknown' | 'not_dispatched' }) => { readonly outcome: 'completed' | 'unknown' | 'not_dispatched'; readonly attemptLineage?: CacheLineage } | Promise<{ readonly outcome: 'completed' | 'unknown' | 'not_dispatched'; readonly attemptLineage?: CacheLineage }>;
  readonly now?: () => number;
  readonly maxEntryBytes?: number;
  readonly maxEntries?: number;
  readonly maxFlights?: number;
  readonly maxPrivateLinks?: number;
  readonly maxObservationsPerEntry?: number;
  readonly maxOutboxEntries?: number;
  readonly maxOutboxAttempts?: number;
  readonly maxRetentionMs?: number;
  readonly lockTimeoutMs?: number;
  readonly defaultFreshnessTtlMs?: number;
  /** Maximum combined encrypted payload bytes across cache, observation, flight, link, and outbox rows. */
  readonly maxStoreBytes?: number;
}

export interface ReuseStore<Request = unknown> {
  scopeForAuthenticatedRequest(request: Request): Promise<ScopedReuseScope>;
  putPrivateProfile(scope: ScopedReuseScope, request: Request, input: LookupInput & { readonly facts: Readonly<Record<string, PrivateFact>>; readonly observation: unknown; readonly freshnessTtlMs?: number; readonly expiresAtMs?: number; readonly signal?: AbortSignal }): Promise<Readonly<{ status: 'stored' | 'existing' | 'expired'; profileRef: string; version: number; freshness: string; originalLineageStatus: 'complete' | 'unknown'; rights?: 'not_asserted' }>>;
  publishReviewedPublicProfile(scope: ScopedReuseScope, request: Request, input: { readonly boundary: PrivacyBoundary<Request>; readonly boundaryScope: TenantScope; readonly derivative: SanitizedDerivative; readonly identity: CacheIdentity; readonly contentHash: string; readonly pins: ReusePins; readonly observation: unknown; readonly freshnessTtlMs?: number; readonly expiresAtMs?: number; readonly signal?: AbortSignal }): Promise<Readonly<{ status: 'stored' | 'existing' | 'expired'; profileRef: string; version: number; freshness: string; originalLineageStatus: 'complete' | 'unknown'; rights?: 'not_asserted' }>>;
  getPrivateProfile(scope: ScopedReuseScope, request: Request, lookup: LookupInput): Promise<PrivateLookupResult>;
  getPublicProfile(scope: ScopedReuseScope, request: Request, lookup: LookupInput): Promise<PublicLookupResult>;
  observe(scope: ScopedReuseScope, request: Request, input: { readonly profileRef: string; readonly scopeKind: 'tenant_private' | 'public_profile'; readonly observation: unknown }): Promise<FreshnessObservation>;
  invalidate(scope: ScopedReuseScope, request: Request, input: { readonly profileRef: string; readonly scopeKind: 'tenant_private' | 'public_profile'; readonly reason: InvalidationReason }): Promise<Readonly<{ invalidated: boolean; profileRef: string; version: number }>>;
  admitOperation(scope: ScopedReuseScope, request: Request, input: { readonly identity: CacheIdentity; readonly pins: ReusePins; readonly mode: 'reuse' | 'fresh'; readonly leaseMs?: number }): Promise<AdmissionResult>;
  reconcileAdmission(scope: ScopedReuseScope, request: Request, input: { readonly admissionRef: string; readonly outcome: 'completed' | 'unknown' | 'not_dispatched' }): Promise<Readonly<Record<string, unknown>>>;
  withPrivateLineage(scope: ScopedReuseScope, request: Request, profileRef: string): Promise<Readonly<{ status: 'linked' | 'incomplete' | 'unavailable'; logicalOperationBound: boolean; billedAttemptCount: number; usageObservationCount: number; allocationAuthority: 'finance_external' }>>;
  dispatchPendingInvalidations(scope: ScopedReuseScope, request: Request, maximum?: number, scopeKind?: 'tenant_private' | 'public_profile', signal?: AbortSignal): Promise<Readonly<{ attempted: number; delivered: number; pending: boolean; unresolvedCount?: number; reason?: string; deliveryKind?: string }>>;
  outboxSnapshot(scope: ScopedReuseScope, request: Request, scopeKind?: 'tenant_private' | 'public_profile'): Promise<Readonly<{ pending: number; delivering: number; failed: number; delivered: number; unresolved: number; readiness: 'blocked_pending_external_ack' | 'external_consumer_unverified' }>>;
  integritySnapshot(scope: ScopedReuseScope, request: Request): Promise<Readonly<Record<string, unknown>>>;
  purgeExpired(scope: ScopedReuseScope, request: Request, scopeKind?: 'tenant_private' | 'public_profile'): Promise<Readonly<{ purged: number; retainedOutboxPending: number }>>;
}

export declare function createScopedReuseStore<Request = unknown>(options: ScopedReuseOptions<Request>): ReuseStore<Request>;
