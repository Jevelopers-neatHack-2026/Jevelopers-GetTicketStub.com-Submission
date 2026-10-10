import { createProvenancePort, isProvenancePort } from '../../src/verification/provenance/index.mjs';
import type {
  AvailableEvidenceMetadata,
  EvidenceFactInput,
  EvidenceIngestInput,
  EvidenceStore,
  EvidenceTenantScope,
  StoredEvidenceFactRecord,
} from '../../src/evidence/store.mjs';

interface AuthenticatedRequest {
  readonly principal: { readonly tenantId: string };
  readonly allowPrivate: boolean;
}

declare const store: EvidenceStore<AuthenticatedRequest>;
declare const scope: EvidenceTenantScope;
declare const request: AuthenticatedRequest;
declare const ingestInput: EvidenceIngestInput;
declare const factInput: EvidenceFactInput;

const provenance = createProvenancePort(store);
const factHandle = await provenance.record(scope, factInput, request);
const readFact: StoredEvidenceFactRecord = await provenance.read(scope, factHandle, request);
const available: AvailableEvidenceMetadata = (await store.ingestEvidence(scope, ingestInput)).metadata;
const evidenceMetadata = await store.getEvidenceMetadata(scope, (await store.ingestEvidence(scope, ingestInput)).evidence);

if (readFact.status === 'sourced' || readFact.status === 'inferred' || readFact.status === 'customer_supplied') {
  const support = readFact.supports[0];
  const conservativeIndependence: 'unknown' = support.independence;
  void conservativeIndependence;
  // @ts-expect-error independent corroboration is not inferred from different hashes or publishers
  void readFact.independentSupportCount;
}

if (evidenceMetadata.state === 'expired') {
  // @ts-expect-error expiry tombstones do not retain content hashes
  void evidenceMetadata.contentHash;
}

// @ts-expect-error tenant identity is derived by the authenticated composition root
const forgedTenantInput: EvidenceIngestInput = { ...ingestInput, tenantId: 'tenant-b' };
void forgedTenantInput;
void available.contentHash;
void isProvenancePort(provenance);
