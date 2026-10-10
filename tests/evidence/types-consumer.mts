import { createProvenancePort, isProvenancePort } from '../../src/verification/provenance/index.mjs';
import type {
  AvailableEvidenceMetadata,
  EvidenceFactHandle,
  EvidenceFactInput,
  PdfDerivedEvidenceIngestInput,
  PdfDerivedEvidenceIngestResult,
  EvidencePrivatePayloadInput,
  EvidencePrivatePayloadResult,
  EvidencePrivatePayloadValue,
  EvidenceHandle,
  EvidenceIngestInput,
  EvidenceSelectedMaterialization,
  EvidenceStore,
  EvidenceTenantScope,
  EvidenceStoreOptions,
  StoredEvidenceFactRecord,
} from '../../src/evidence/store.mjs';

interface AuthenticatedRequest {
  readonly principal: { readonly tenantId: string };
  readonly allowPrivate: boolean;
}

declare const store: EvidenceStore<AuthenticatedRequest>;
declare const scope: EvidenceTenantScope;
declare const request: AuthenticatedRequest;
declare const evidenceHandle: EvidenceHandle;
declare const factHandleForBatch: EvidenceFactHandle;
declare const ingestInput: EvidenceIngestInput;
declare const factInput: EvidenceFactInput;

const provenance = createProvenancePort(store);
const factHandle = await provenance.record(scope, factInput, request);
const readFact: StoredEvidenceFactRecord = await provenance.read(scope, factHandle, request);
const available: AvailableEvidenceMetadata = (await store.ingestEvidence(scope, ingestInput)).metadata;
const evidenceMetadata = await store.getEvidenceMetadata(scope, (await store.ingestEvidence(scope, ingestInput)).evidence);
const selectedMaterialization: EvidenceSelectedMaterialization = await store.materializeSelected(scope, {
  evidence: [evidenceHandle],
  facts: [factHandleForBatch],
}, request, new AbortController().signal);
const storedSourceUrl: string = selectedMaterialization.evidence[0].source.sourceUrl;
const storedSourceTime: string = selectedMaterialization.evidence[0].source.retrievedAt;
const selectedPositionDigest: string = selectedMaterialization.evidence[0].positions[0].contentHash;
void storedSourceUrl;
void storedSourceTime;
void selectedPositionDigest;
declare const pdfInput: PdfDerivedEvidenceIngestInput;
const pdfResult: PdfDerivedEvidenceIngestResult = await store.ingestDerivedPdfEvidence(scope, pdfInput, request);
if (pdfResult.outcome === 'stored') {
  const storedRepresentation: 'pdf-derived-text' | undefined = pdfResult.metadata.representation;
  const storedDigest: string | undefined = pdfResult.metadata.derivationDigest;
  const positions = await store.listEvidencePositions(scope, pdfResult.evidence, request);
  if (positions[0]?.locator.kind === 'pdf-text-box') {
    const pageIndex: number = positions[0].locator.pageIndex;
    void pageIndex;
  }
  void storedRepresentation;
  void storedDigest;
}

type CurrentPrivateAuthorizer = NonNullable<EvidenceStoreOptions<AuthenticatedRequest>['authorizePrivateAccessCurrent']>;
const synchronousFinalAuthorizer: CurrentPrivateAuthorizer = ({ tenantId, action, evidenceIds, factIds }) =>
  tenantId.length > 0 && action.length > 0 && evidenceIds.length + factIds.length > 0;
void synchronousFinalAuthorizer;
// @ts-expect-error final private authorization must be synchronous
const asynchronousFinalAuthorizer: CurrentPrivateAuthorizer = async () => true;
void asynchronousFinalAuthorizer;

type PrivatePayloadConsumer = NonNullable<EvidenceStoreOptions<AuthenticatedRequest>['consumePrivatePayload']>;
const synchronousPrivateConsumer: PrivatePayloadConsumer = (input: EvidencePrivatePayloadInput<AuthenticatedRequest>): EvidencePrivatePayloadResult => ({
  retrievedAt: input.source.retrievedAt,
  positions: input.positions.map((position) => position.contentHash),
  derivedText: input.source.derivedPdf?.requiresInspection ?? false,
});
void synchronousPrivateConsumer;
const readonlyArrayResult: EvidencePrivatePayloadResult = ['first', { nested: ['second'] }];
if (Array.isArray(readonlyArrayResult)) {
  const mapped: EvidencePrivatePayloadValue[] = readonlyArrayResult.map((value) => value);
  const spread: readonly EvidencePrivatePayloadValue[] = [...readonlyArrayResult];
  for (const value of readonlyArrayResult) void value;
  void mapped;
  void spread;
}
function consumeReadonlyPrivateArray(values: readonly EvidencePrivatePayloadValue[]): void {
  const mapped = values.map((value) => value);
  const spread: readonly EvidencePrivatePayloadValue[] = [...values];
  for (const value of values) void value;
  void mapped;
  void spread;
}
consumeReadonlyPrivateArray(['first', { nested: ['second'] }]);
// @ts-expect-error private-payload consumers cannot return Promises or thenables
const asynchronousPrivateConsumer: PrivatePayloadConsumer = async () => ({ privateResult: 'not released' });
void asynchronousPrivateConsumer;

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
