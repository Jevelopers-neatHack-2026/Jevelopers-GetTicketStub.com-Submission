import type { PdfTextReaderErrorCode } from '../extraction/pdf/index.mjs';

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
  | 'EVIDENCE_CANCELLED'
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

export interface PdfTextBoxLocator {
  readonly kind: 'pdf-text-box';
  readonly pageIndex: number;
  readonly textIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly coordinateSystem: 'viewport-points-top-left';
  readonly geometry: 'approximate-text-item';
}

export type StoredEvidenceLocator = TextRangeLocator | JsonPointerLocator | PdfTextBoxLocator;

export interface StoredPdfDerivedPage {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly coordinateSystem: 'viewport-points-top-left';
  readonly textPresence: 'text-present' | 'no-embedded-text';
  readonly requiresInspection: true;
  readonly textBoxCount: number;
}

export interface PdfDerivedProvenance {
  readonly bindingVersion: 1;
  readonly decoder: Readonly<{ name: 'pdfjs-dist'; version: '6.4.299'; configVersion: 'ei-text-pdf/1' }>;
  readonly completeness: 'incomplete-text-only';
  readonly requiresInspection: true;
  readonly limits: Readonly<Record<string, number>>;
  readonly pages: readonly StoredPdfDerivedPage[];
  readonly textBoxCount: number;
  readonly derivationDigest: string;
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
  readonly representation?: 'pdf-derived-text';
  readonly derivationDigest?: string;
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

export interface PdfDerivedReaderOptions {
  /** Lower than the reader's fixed maximum. Timeout is operational and excluded from derivation identity. */
  readonly timeoutMs?: number;
  /** Lower-only decoder caps; the effective values are persisted in provenance. */
  readonly maxTextCodeUnits?: number;
  readonly maxOutputBytes?: number;
}

export interface PdfDerivedEvidenceIngestInput {
  readonly sourceUrl: string;
  readonly canonicalUrl?: string;
  readonly redirectChain?: readonly string[];
  /** Exact copied bytes fetched from the source. Strings are rejected to avoid re-encoding the PDF. */
  readonly content: Uint8Array;
  readonly contentType: string;
  readonly retrievedAt: string;
  readonly sourceKind: 'external' | 'customer_supplied';
  /** Opaque app-issued retention capability; caller tenant fields are never accepted. */
  readonly retentionHandle: object;
  readonly readerOptions?: PdfDerivedReaderOptions;
}

export type PdfDerivedEvidenceIngestResult =
  | (EvidenceIngestResult & { readonly outcome: 'stored' })
  | { readonly outcome: 'no-text'; readonly code: 'NO_EMBEDDED_TEXT'; readonly requiresInspection: true }
  | { readonly outcome: 'rejected'; readonly code: PdfTextReaderErrorCode };

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

export interface EvidencePrivatePayloadInput<Request = unknown> {
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
    /** Present only for derived PDF text, and remains private provenance. */
    derivedPdf?: PdfDerivedProvenance;
  }>;
  readonly positions: readonly Readonly<{
    locator: StoredEvidenceLocator;
    contentHash: string;
    content: Uint8Array;
  }>[];
  readonly request: Request;
}

export type EvidencePrivatePayloadValue =
  | null
  | boolean
  | number
  | string
  | readonly EvidencePrivatePayloadValue[]
  | { readonly [key: string]: EvidencePrivatePayloadValue };
export type EvidencePrivatePayloadResult = EvidencePrivatePayloadValue | undefined;

export interface EvidenceSelectedEvidence {
  readonly handle: EvidenceHandle;
  readonly metadata: AvailableEvidenceMetadata;
  /** Stored private provenance; these values come from the encrypted bundle, not caller descriptors. */
  readonly source: Readonly<{
    sourceUrl: string;
    canonicalUrl: string;
    redirectChain: readonly string[];
    contentType: string;
    sourceKind: 'external' | 'customer_supplied';
    retrievedAt: string;
    retrievedAtMs: number;
    /** Full source SHA-256; each position carries its own selected-content hash. */
    contentHash: string;
    /** Present only for derived PDF text. Contains no text bytes or text strings. */
    derivedPdf?: PdfDerivedProvenance;
  }>;
  readonly positions: readonly Readonly<{
    handle: EvidencePositionHandle;
    locator: StoredEvidenceLocator;
    /** Digest of the exact selected position bytes, distinct from source.contentHash. */
    contentHash: string;
  }>[];
}

export interface EvidenceSelectedMaterialization {
  readonly evidence: readonly EvidenceSelectedEvidence[];
  readonly facts: readonly StoredEvidenceFactRecord[];
}

export interface EvidenceSelectedMaterializationInput {
  /** At most eight direct evidence handles; supporting evidence for selected facts is included automatically. */
  readonly evidence: readonly EvidenceHandle[];
  /** At most 128 selected fact handles. */
  readonly facts: readonly EvidenceFactHandle[];
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
    request: Request;
    action: string;
    evidenceIds: readonly string[];
    factIds: readonly string[];
  }>) => boolean | Promise<boolean>;
  /**
   * Required for any private result release. Must synchronously re-derive the
   * current authenticated tenant and current ACL for the exact action and IDs.
   * It receives the expected tenant from an opaque store scope and must compare
   * that with current host identity. Promise/thenable results fail closed.
   */
  readonly authorizePrivateAccessCurrent: (request: Readonly<{
    tenantId: string;
    request: Request;
    action: string;
    evidenceIds: readonly string[];
    factIds: readonly string[];
  }>) => boolean;
  /** Trusted synchronous consumer for explicitly authorized private evidence. Runtime-denies native Promise results. */
  readonly consumePrivatePayload?: (input: EvidencePrivatePayloadInput<Request>) => EvidencePrivatePayloadResult;
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
  /** Invokes the pinned isolated PDF reader itself; caller-supplied observations and geometry are rejected. */
  ingestDerivedPdfEvidence(
    scope: EvidenceTenantScope,
    input: PdfDerivedEvidenceIngestInput,
    request: Request,
    signal?: AbortSignal,
  ): Promise<PdfDerivedEvidenceIngestResult>;
  lookupEvidence(scope: EvidenceTenantScope, evidenceId: string): Promise<EvidenceHandle>;
  getEvidenceMetadata(scope: EvidenceTenantScope, evidence: EvidenceHandle): Promise<EvidenceMetadata>;
  listEvidencePositions(scope: EvidenceTenantScope, evidence: EvidenceHandle, request: Request): Promise<readonly Readonly<{
    handle: EvidencePositionHandle;
    locator: StoredEvidenceLocator;
    contentHash: string;
  }>[] >;
  /** Bounded, all-or-error private snapshot; no raw source or position bytes are returned. */
  materializeSelected(
    scope: EvidenceTenantScope,
    selection: EvidenceSelectedMaterializationInput,
    request: Request,
    signal?: AbortSignal,
  ): Promise<EvidenceSelectedMaterialization>;
  withPrivatePayload(scope: EvidenceTenantScope, evidence: EvidenceHandle, request: Request): Promise<EvidencePrivatePayloadResult>;
  appendFact(scope: EvidenceTenantScope, fact: EvidenceFactInput, request: Request): Promise<EvidenceFactHandle>;
  lookupFact(scope: EvidenceTenantScope, factId: string): Promise<EvidenceFactHandle>;
  readFact(scope: EvidenceTenantScope, fact: EvidenceFactHandle, request: Request): Promise<StoredEvidenceFactRecord>;
  listFacts(scope: EvidenceTenantScope, request: Request): Promise<readonly StoredEvidenceFactRecord[]>;
  purgeExpired(scope: EvidenceTenantScope): Promise<number>;
  integritySnapshot(scope: EvidenceTenantScope): Promise<EvidenceIntegritySnapshot>;
}

export declare function createEvidenceStore<Request = unknown>(options: EvidenceStoreOptions<Request>): EvidenceStore<Request>;
