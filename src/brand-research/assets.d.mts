import type {
  AssetSourceAssociation,
  AssetSourceEvidenceIngestResult,
  AssetSourceForm,
  AssetSourceQuarantineReason,
  EvidenceHandle,
  EvidenceMetadata,
  EvidencePositionHandle,
  EvidenceStore,
  EvidenceTenantScope,
  StoredEvidenceLocator,
} from '../evidence/store.mjs';
import type { QuestionPlan, StructuredVisualObservation } from '../decisions/questions/index.mjs';
import type { RetrievedDocument } from '../security/index.mjs';

export interface AssetCandidateDescriptor {
  readonly candidateId: string;
  readonly sourceForm: AssetSourceForm;
  readonly field: string;
  readonly relationHint: string | null;
  /** An unverified claim copied from source structure; it grants no identity or permission. */
  readonly association: AssetSourceAssociation;
  readonly locator: StoredEvidenceLocator;
  /** Digest of the private source excerpt, never a digest of unfetched asset bytes. */
  readonly excerptHash: string;
  /** Present on selector-3 through selector-6 readbacks; marks whether the excerpt is a URL value or an explicit empty HTML attribute token. */
  readonly excerptKind?: 'url-value' | 'html-empty-attribute-token';
  readonly normalizedSuggestion: string | null;
  readonly fetchSuggestion: string | null;
  readonly quarantineReason: AssetSourceQuarantineReason | null;
  readonly role: 'unknown';
  readonly permission: 'unknown';
  readonly inspection: 'pending';
  readonly position: EvidencePositionHandle;
}

export interface AssetCandidateDiscoveryResult<Request = unknown> {
  readonly outcome: 'stored';
  readonly evidence: EvidenceHandle;
  readonly metadata: EvidenceMetadata;
  /** Original full response-body hash from the encrypted evidence source descriptor. */
  readonly sourceHash: string;
  readonly created: boolean;
  readonly completeness: 'static-selected-forms-only';
  readonly limitations: readonly string[];
  readonly candidates: readonly AssetCandidateDescriptor[];
}

export type AssetCandidateDiscoveryOutcome =
  | AssetCandidateDiscoveryResult
  | Exclude<AssetSourceEvidenceIngestResult, { outcome: 'stored' }>;

/**
 * Caller-supplied byte and retrieval metadata for a candidate asset. It is
 * intentionally not a SafeFetcher receipt: this repository's SafeFetcher
 * does not accept image/svg+xml, and these fields do not authenticate where
 * the bytes came from.
 */
export interface SuppliedAssetInspectionDocument {
  readonly url: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly fetchedAt: string;
  readonly redirects: number;
}

export type BrandRoleQuestionPreparationErrorCode =
  | 'INVALID_INPUT'
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_AMBIGUOUS'
  | 'CANDIDATE_NOT_FETCHABLE'
  | 'CURRENT_SOURCE_MISMATCH'
  | 'CANDIDATE_POSITION_MISMATCH'
  | 'ASSET_DOCUMENT_MISMATCH'
  | 'ASSET_INSPECTION_REVIEW'
  | 'ASSET_INSPECTION_REJECTED'
  | 'OBSERVATION_BINDING_MISMATCH'
  | 'ASSET_HASH_MISMATCH'
  | 'QUESTION_BINDING_FAILED';

export declare class BrandRoleQuestionPreparationError extends Error {
  readonly code: BrandRoleQuestionPreparationErrorCode;
  constructor(code?: BrandRoleQuestionPreparationErrorCode);
}

export interface BrandRoleQuestionPreparationResult {
  readonly sourceBinding: Readonly<{
    evidenceId: string;
    /** Version of the stored page evidence; this is not an asset version. */
    evidenceVersion: number;
    /** SHA-256 of the full stored page response. */
    pageSourceHash: string;
    derivationDigest: string;
    candidateId: string;
    positionIndex: number;
    locator: StoredEvidenceLocator;
    /** SHA-256 of the exact page excerpt, not of the asset bytes. */
    candidateExcerptHash: string;
  }>;
  readonly assetInspection: Readonly<{
    contentType: 'image/svg+xml';
    policyVersion: string;
    assetBytesSourceHash: string;
    transformedBytesHash: string;
    transformedBytesMatchInspection: true;
    acquisitionProvenance: 'caller_supplied_unverified';
  }>;
  readonly questionBinding: Readonly<{
    questionId: 'Q-EI-BRAND-ROLE:v1';
    candidateId: string;
    registryVersion: string;
    registrySchemaVersion: string;
    registryHash: string;
    definitionHash: string;
    targetRef: string;
    targetBindingHash: string | null;
    observationRef: string;
    observerMetadataProvenance: 'caller_asserted_unverified';
  }>;
  readonly discoveryCandidateStatus: Readonly<{
    role: 'unknown';
    permission: 'unknown';
    inspection: 'pending';
  }>;
  /** Existing internal question plan; always blocked and never dispatched. */
  readonly plan: QuestionPlan;
}

/**
 * Runs the store-owned parser and then obtains a current-authorized metadata
 * view from persisted ciphertext. It never returns source excerpt bytes.
 */
export declare function discoverAssetCandidates<Request>(input: Readonly<{
  store: EvidenceStore<Request>;
  scope: EvidenceTenantScope;
  document: RetrievedDocument;
  retentionHandle: object;
  request: Request;
  signal?: AbortSignal;
}>): Promise<AssetCandidateDiscoveryOutcome>;

/**
 * Reopens one in-process discovery result through current EvidenceStore
 * authorization, inspects a copied caller-supplied asset document locally,
 * and prepares a candidate-bound internal brand-role question. No asset is
 * fetched, persisted, classified, approved, or handed off by this function.
 */
export declare function prepareBrandRoleQuestionFromAssetCandidate<Request>(input: Readonly<{
  store: EvidenceStore<Request>;
  scope: EvidenceTenantScope;
  request: Request;
  discovery: AssetCandidateDiscoveryResult<Request>;
  candidateId: string;
  assetDocument: SuppliedAssetInspectionDocument;
  observation: StructuredVisualObservation & Readonly<{ candidateRef: string }>;
  signal?: AbortSignal;
}>): Promise<BrandRoleQuestionPreparationResult>;
