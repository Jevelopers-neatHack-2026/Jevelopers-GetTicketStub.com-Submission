import {
  createDiscoveryFrontierStore,
  type FrontierSnapshot,
} from '../../../src/discovery/planner/frontier.mjs';

const store = createDiscoveryFrontierStore({
  directory: '/tmp/private-frontier',
  resolveTenant: (request: { readonly tenant: string }) => request.tenant,
});

async function consumer(request: { readonly tenant: string }): Promise<FrontierSnapshot> {
  const scope = await store.scopeForAuthenticatedRequest(request);
  const snapshot = await store.createRun(scope, {
    runId: 'typed-run',
    seeds: [{ url: 'https://events.example.com/seed' }],
    limits: { maxDepth: 1, maxTransportAttemptAdmissions: 4, maxInFlightLeases: 2 },
  });
  const remainsUnknown: 'not_evaluated' = snapshot.sourceAuthority;
  // @ts-expect-error the private frontier does not declare a URL authoritative
  const official: boolean = snapshot.sourceAuthority;
  void remainsUnknown;
  void official;
  return snapshot;
}

void consumer;
