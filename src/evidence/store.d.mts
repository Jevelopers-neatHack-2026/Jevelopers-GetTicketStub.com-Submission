declare const tenantScopeBrand: unique symbol;
declare const evidenceHandleBrand: unique symbol;
declare const evidencePositionBrand: unique symbol;
declare const factHandleBrand: unique symbol;

export type EvidenceTenantScope = { readonly [tenantScopeBrand]: true };
export type EvidenceHandle = { readonly [evidenceHandleBrand]: true };
export type EvidencePositionHandle = { readonly [evidencePositionBrand]: true };
export type EvidenceFactHandle = { readonly [factHandleBrand]: true };

export type EvidenceErrorCode =
  | 'EVIDENCE_DENIED'
  | 'EVIDENCE_INVALID'
  | 'EVIDENCE_NOT_FOUND'
  | 'EVIDENCE_EXPIRED'
  | 'EVIDENCE_BUSY'
  | 'EVIDENCE_INTEGRITY'
  | 'EVIDENCE_KEY_UNAVAILABLE'
  | 'EVIDENCE_STORAGE';

export declare class EvidenceStoreError extends Error {
  readonly code: EvidenceErrorCode;
  constructor(code: EvidenceErrorCode);
}

export interface EvidenceStoreKeyRequest {
  readonly tenantId: string;
  readonly purpose: 'payload' | 'fact' | 'source-index';
  readonly keyId?: string;
}

export interface EvidenceStoreKey {
  readonly keyId: string;
  /** A fresh 32-byte AES/HMAC key from the trusted application key resolver. */
  readonly key: Uint8Array;
}

export interface EvidenceRetentionRequest {
  readonly tenantId: string;
  readonly kind: 'evidence' | 'fact';
  readonly sourceKind?: 'external' | 'customer_supplied' | 'sourced' | 'inferred' | 'conflicting' | 'missing';
  readonly nowMs: number;
  /** Facts cannot outlive any evidence record that supports them. */
  readonly sourceExpiresAtMs?: number;
  /** An opaque, app-issued permit linked to the source's existing retention decision. */
  readonly retentionHandle?: object;
}

export interface EvidenceRetentionDecision {
  readonly expiresAtMs: number;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly accessPolicy: 'tenant_private';
}

export interface TextRangeLocator {
  readonly kind: 'text-range';
  /** UTF-8 byte positions in the complete fetched source. */
  readonly startByte: number;
  readonly endByte: number;
}

export interface JsonPointerLocator {
  readonly kind: 'json-pointer';
  /** RFC 6901 pointer into a JSON or JSON-LD source. */
  readonly pointer: string;
}

export interface EvidencePositionInput {
  readonly locator: TextRangeLocator | JsonPointerLocator;
  /** Exact bytes selected by locator; persisted only after it matches the source. */
  readonly content: string | Uint8Array;
}

export interface AvailableEvidenceMetadata {
  readonly evidenceId: string;
  readonly version: number;
  readonly previousEvidenceId: string | null;
  readonly contentHash: string;
  /** Exact-content duplicate cluster; it does not establish source independence or authority. */
  readonly duplicateGroupId: string;
  readonly retrievedAt: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly accessPolicy: 'tenant_private';
  readonly state: 'available';
  readonly positionCount: number;
}

/** A minimal tombstone with no content hash, URL key, timestamp, or source linkage. */
export interface ExpiredEvidenceMetadata {
  readonly evidenceId: string;
  readonly state: 'expired';
  readonly positionCount: 0;
}

export type EvidenceMetadata = AvailableEvidenceMetadata | ExpiredEvidenceMetadata;

export interface EvidenceIngestInput {
  readonly sourceUrl: string;
  readonly canonicalUrl?: string;
  readonly redirectChain?: readonly string[];
  readonly content: string | Uint8Array;
  readonly contentType: string;
  readonly retrievedAt: string;
  readonly sourceKind: 'external' | 'customer_supplied';
  readonly positions: readonly EvidencePositionInput[];
  /** Opaque app-issued retention capability. Caller tenant fields are never accepted. */
  readonly retentionHandle: object;
}

export interface EvidenceIngestResult {
  readonly evidence: EvidenceHandle;
  readonly positions: readonly EvidencePositionHandle[];
  readonly created: boolean;
  readonly metadata: AvailableEvidenceMetadata;
}

export interface EvidenceSupportInput {
  readonly evidence: EvidenceHandle;
  readonly position: EvidencePositionHandle;
  readonly contentHash: string;
}

export interface EvidenceFactValue {
  readonly rawValue: unknown;
  readonly normalizedValue: unknown;
  readonly precision?: 'date' | 'local_datetime' | 'instant' | 'unknown';
}

export interface EvidenceMethod {
  readonly name: string;
  readonly version: string;
}

export interface SourcedFactInput extends EvidenceFactValue {
  readonly field: string;
  readonly status: 'sourced' | 'customer_supplied';
  readonly supports: readonly EvidenceSupportInput[];
}

export interface InferredFactInput extends EvidenceFactValue {
  readonly field: string;
  readonly status: 'inferred';
  readonly supports: readonly EvidenceSupportInput[];
  readonly method: EvidenceMethod;
}

export interface MissingFactInput {
  readonly field: string;
  readonly status: 'missing';
  readonly reason?: string;
}

export interface ConflictingFactCandidate extends EvidenceFactValue {
  readonly originStatus: 'sourced' | 'inferred' | 'customer_supplied';
  readonly supports: readonly EvidenceSupportInput[];
  readonly method?: EvidenceMethod;
}

export interface ConflictingFactInput {
  readonly field: string;
  readonly status: 'conflicting';
  readonly candidates: readonly [ConflictingFactCandidate, ConflictingFactCandidate, ...ConflictingFactCandidate[]];
}

export type EvidenceFactInput = SourcedFactInput | InferredFactInput | MissingFactInput | ConflictingFactInput;

export interface EvidenceFactSupport extends EvidenceSupportInput {
  readonly duplicateGroupId: string;
  readonly independence: 'unknown';
}

export interface StoredEvidenceFact extends EvidenceFactValue {
  readonly factId: string;
  readonly field: string;
  readonly status: 'sourced' | 'inferred' | 'customer_supplied';
  readonly method?: EvidenceMethod;
  readonly supports: readonly EvidenceFactSupport[];
}

export interface StoredMissingFact {
  readonly factId: string;
  readonly field: string;
  readonly status: 'missing';
  readonly reason: string;
  readonly supports: readonly [];
}

export interface StoredConflictingFact {
  readonly factId: string;
  readonly field: string;
  readonly status: 'conflicting';
  readonly candidates: readonly (EvidenceFactValue & {
    readonly originStatus: 'sourced' | 'inferred' | 'customer_supplied';
    readonly method?: EvidenceMethod;
    readonly supports: readonly EvidenceFactSupport[];
  })[];
}

export type StoredEvidenceFactRecord = StoredEvidenceFact | StoredMissingFact | StoredConflictingFact;

export interface EvidencePrivatePayloadInput {
  readonly tenantId: string;
  readonly evidenceId: string;
  readonly metadata: AvailableEvidenceMetadata;
  readonly source: Readonly<{
    sourceUrl: string;
    canonicalUrl: string;
    redirectChain: readonly string[];
    contentType: string;
    sourceKind: 'external' | 'customer_supplied';
    retrievedAt: string;
    retrievedAtMs: number;
    contentHash: string;
  }>;
  readonly positions: readonly Readonly<{
    locator: TextRangeLocator | JsonPointerLocator;
    contentHash: string;
    content: Uint8Array;
  }>[];
  readonly request: unknown;
}

export interface EvidenceStoreOptions<Request = unknown> {
  /** Trusted local storage path, configured by the application composition root. */
  readonly directory: string;
  /** Must derive tenant identity from the authenticated server-side request. */
  readonly resolveTenant: (request: Request) => string | Promise<string>;
  /** Trusted key manager. Never log or serialize returned key bytes. */
  readonly resolveKey: (request: EvidenceStoreKeyRequest) => EvidenceStoreKey | Promise<EvidenceStoreKey>;
  /** Must bind evidence retentionHandle to the source's existing privacy expiry. */
  readonly resolveRetention: (request: EvidenceRetentionRequest) => EvidenceRetentionDecision | Promise<EvidenceRetentionDecision>;
  readonly authorizePrivateAccess?: (request: Readonly<{
    tenantId: string;
    request: unknown;
    action: string;
    evidenceIds: readonly string[];
    factIds: readonly string[];
  }>) => boolean | Promise<boolean>;
  /** Trusted consumer for explicitly authorized private evidence. */
  readonly consumePrivatePayload?: (input: EvidencePrivatePayloadInput) => unknown | Promise<unknown>;
  readonly now?: () => number;
  readonly maxSourceBytes?: number;
  readonly maxPositionBytes?: number;
  readonly maxPositionCount?: number;
  readonly maxStoredPayloadBytes?: number;
  readonly maxRetentionMs?: number;
  readonly lockTimeoutMs?: number;
}

export interface EvidenceIntegritySnapshot {
  readonly availableEvidence: number;
  readonly expiredEvidence: number;
  readonly availableFacts: number;
  readonly expiredFacts: number;
  readonly encryptedPayloadRecords: number;
}

export interface EvidenceStore<Request = unknown> {
  scopeForAuthenticatedRequest(request: Request): Promise<EvidenceTenantScope>;
  ingestEvidence(scope: EvidenceTenantScope, input: EvidenceIngestInput): Promise<EvidenceIngestResult>;
  lookupEvidence(scope: EvidenceTenantScope, evidenceId: string): Promise<EvidenceHandle>;
  getEvidenceMetadata(scope: EvidenceTenantScope, evidence: EvidenceHandle): Promise<EvidenceMetadata>;
  listEvidencePositions(scope: EvidenceTenantScope, evidence: EvidenceHandle, request: Request): Promise<readonly Readonly<{
    handle: EvidencePositionHandle;
    locator: TextRangeLocator | JsonPointerLocator;
    contentHash: string;
  }>[] >;
  withPrivatePayload(scope: EvidenceTenantScope, evidence: EvidenceHandle, request: Request): Promise<unknown>;
  appendFact(scope: EvidenceTenantScope, fact: EvidenceFactInput, request: Request): Promise<EvidenceFactHandle>;
  lookupFact(scope: EvidenceTenantScope, factId: string): Promise<EvidenceFactHandle>;
  readFact(scope: EvidenceTenantScope, fact: EvidenceFactHandle, request: Request): Promise<StoredEvidenceFactRecord>;
  listFacts(scope: EvidenceTenantScope, request: Request): Promise<readonly StoredEvidenceFactRecord[]>;
  purgeExpired(scope: EvidenceTenantScope): Promise<number>;
  integritySnapshot(scope: EvidenceTenantScope): Promise<EvidenceIntegritySnapshot>;
}

export declare function createEvidenceStore<Request = unknown>(options: EvidenceStoreOptions<Request>): EvidenceStore<Request>;
