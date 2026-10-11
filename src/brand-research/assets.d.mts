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
  /** Present on selector-3 and selector-4 readbacks; marks whether the excerpt is a URL value or an explicit empty HTML attribute token. */
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
