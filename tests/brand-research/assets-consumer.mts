import type {
  AssetCandidateDescriptor,
  AssetCandidateDiscoveryOutcome,
  AssetCandidateDiscoveryResult,
  BrandRoleQuestionPreparationResult,
  SuppliedAssetInspectionDocument,
} from '../../src/brand-research/assets.mjs';
import type { AssetSourceAssociation, EvidenceStore, EvidenceTenantScope } from '../../src/evidence/store.mjs';
import type { QuestionPlan, StructuredVisualObservation } from '../../src/decisions/questions/index.mjs';
import type { RetrievedDocument } from '../../src/security/index.mjs';
import { discoverAssetCandidates, prepareBrandRoleQuestionFromAssetCandidate } from '../../src/brand-research/assets.mjs';

async function consumePrivateAssetSource<Request>(
  store: EvidenceStore<Request>,
  scope: Parameters<EvidenceStore<Request>['ingestAssetSourceEvidence']>[0],
  document: RetrievedDocument,
  retentionHandle: object,
  request: Request,
): Promise<AssetCandidateDiscoveryOutcome> {
  const result = await discoverAssetCandidates({ store, scope, document, retentionHandle, request });
  if (result.outcome !== 'stored') return result;
  const candidate: AssetCandidateDescriptor | undefined = result.candidates[0];
  if (!candidate) return result;
  const association: AssetSourceAssociation = candidate.association;
  if (association.kind === 'nested-entity-source-claim') {
    const untrustedOrganizerHint: 'organizer' = association.roleHint;
    void untrustedOrganizerHint;
  }
  const privateSourceHash: string = result.sourceHash;
  const positionCount: number = result.metadata.positionCount;
  if (result.candidates.length !== positionCount) throw new Error('candidate position count mismatch');
  if (!/^[a-f0-9]{64}$/.test(privateSourceHash)) throw new Error('source hash is not a full-source digest');
  return result;
}

void consumePrivateAssetSource;

async function prepareLocalBrandQuestion<Request>(
  store: EvidenceStore<Request>,
  scope: EvidenceTenantScope,
  request: Request,
  discovery: AssetCandidateDiscoveryResult<Request>,
  candidateId: string,
  assetDocument: SuppliedAssetInspectionDocument,
  observation: StructuredVisualObservation & Readonly<{ candidateRef: string }>,
): Promise<BrandRoleQuestionPreparationResult> {
  const prepared = await prepareBrandRoleQuestionFromAssetCandidate({
    store,
    scope,
    request,
    discovery,
    candidateId,
    assetDocument,
    observation,
  });
  const plan: QuestionPlan = prepared.plan;
  const acquisition: 'caller_supplied_unverified' = prepared.assetInspection.acquisitionProvenance;
  const observer: 'caller_asserted_unverified' = prepared.questionBinding.observerMetadataProvenance;
  void [plan, acquisition, observer];
  return prepared;
}

void prepareLocalBrandQuestion;
