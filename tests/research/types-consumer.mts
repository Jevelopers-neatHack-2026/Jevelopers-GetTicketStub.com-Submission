import type { DiscoveryFrontierStore } from '../../src/discovery/planner/frontier.mjs';
import type { EvidenceStore } from '../../src/evidence/store.mjs';
import type {
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
  signal: new AbortController().signal,
};

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
}

void runPrivateRetrieval(input).then(inspect);
