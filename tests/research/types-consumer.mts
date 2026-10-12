import type { DiscoveryFrontierStore } from '../../src/discovery/planner/frontier.mjs';
import type {
  ControlledAssetEvidenceIngestInput,
  EvidenceHandle,
  EvidenceStore,
  EvidenceTenantScope,
} from '../../src/evidence/store.mjs';
import type {
  PrivateRetrievalAssetAcquisitionPolicy,
  PrivateRetrievalInput,
  PrivateRetrievalResult,
} from '../../src/research/private-retrieval.mjs';
import { runPrivateRetrieval } from '../../src/research/private-retrieval.mjs';
import type { SafeFetcher } from '../../src/security/index.mjs';

interface AuthenticatedRequest {
  readonly principal: { readonly tenantId: string };
  readonly allowPrivate: boolean;
}

declare const frontier: DiscoveryFrontierStore<AuthenticatedRequest>;
declare const evidenceStore: EvidenceStore<AuthenticatedRequest>;
declare const safeFetcher: SafeFetcher;
declare const request: AuthenticatedRequest;
const acquisitionPolicy: PrivateRetrievalAssetAcquisitionPolicy = {
  schemaVersion: 1,
  policyVersion: 'ei-private-svg-acquisition/1',
  policyId: 'typed-host-policy-v1',
  allowedOrigins: ['https://events.example.org'],
};

const input: PrivateRetrievalInput<AuthenticatedRequest> = {
  frontier,
  evidenceStore,
  safeFetcher,
  request,
  runId: 'typed-private-run',
  seeds: [{ url: 'https://events.example.org/event' }],
  limits: { maxDepth: 0, maxTransportAttemptAdmissions: 1 },
  retentionHandleFor: async (_request, context) => {
    context.sourceUrl satisfies string;
    return Object.freeze({});
  },
  authorizeCurrent: (_request, context) => context.stage === 'candidate' || context.stage === 'release',
  assetAcquisitionPolicyFor: async (_request, context) => {
    context.runId satisfies string;
    return acquisitionPolicy;
  },
  signal: new AbortController().signal,
};

async function storeControlledAsset(
  scope: EvidenceTenantScope,
  input: ControlledAssetEvidenceIngestInput,
): Promise<void> {
  const stored = await evidenceStore.ingestControlledAssetEvidence(scope, input, request);
  stored.outcome satisfies 'stored';
  stored.metadata.contentHash satisfies string;
}

async function reopenAssetSource(
  scope: EvidenceTenantScope,
  evidence: EvidenceHandle,
  candidateId: string,
): Promise<void> {
  const source = await evidenceStore.readAssetSourceCandidateBinding(scope, evidence, candidateId, request);
  source.candidate.value satisfies string;
  source.candidate.fetchSuggestion satisfies string;
}

async function inspect(result: PrivateRetrievalResult): Promise<void> {
  if ('draft' in result) {
    result.runId satisfies string;
    result.draft satisfies null;
    return;
  }
  result.completeness satisfies 'incomplete';
  result.sources[0]?.sourceAuthority satisfies 'not_evaluated' | undefined;
  result.sources[0]?.pdf?.requiresInspection satisfies true | undefined;
  result.conflicts[0]?.kind satisfies 'occurrence_identity' | 'entity_identity' | undefined;
  result.progress.remainingCandidates satisfies number;
  for (const acquisition of result.assetAcquisitions ?? []) {
    acquisition.status satisfies 'blocked_local_inspection_only';
    acquisition.acceptedExternalAssetVersion satisfies null;
    acquisition.questionPlan.execution satisfies 'not_dispatched';
    acquisition.questionPlan.rights satisfies 'unknown';
    acquisition.acquiredEvidence.fetchedSource.contentHash satisfies string;
    acquisition.acquiredEvidence.transformed.contentHash satisfies string;
  }
}

void runPrivateRetrieval(input).then(inspect);
void storeControlledAsset;
void reopenAssetSource;
