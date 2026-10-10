import type {
  EvidenceFactHandle,
  EvidenceFactInput,
  EvidenceStore,
  EvidenceTenantScope,
  StoredEvidenceFactRecord,
} from '../../evidence/store.mjs';

/** Internal adapter only; it is not a public package or wire contract. */
export interface ProvenancePort<Request = unknown> {
  record(scope: EvidenceTenantScope, fact: EvidenceFactInput, request: Request): Promise<EvidenceFactHandle>;
  lookup(scope: EvidenceTenantScope, factId: string): Promise<EvidenceFactHandle>;
  read(scope: EvidenceTenantScope, fact: EvidenceFactHandle, request: Request): Promise<StoredEvidenceFactRecord>;
  list(scope: EvidenceTenantScope, request: Request): Promise<readonly StoredEvidenceFactRecord[]>;
}

export declare function createProvenancePort<Request = unknown>(store: EvidenceStore<Request>): ProvenancePort<Request>;
export declare function isProvenancePort(value: unknown): value is ProvenancePort<unknown>;
