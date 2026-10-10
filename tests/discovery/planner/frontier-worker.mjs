import { createDiscoveryFrontierStore } from '../../../src/discovery/planner/frontier.mjs';

const [directory, runId, workerId, claimKey, clockValue] = process.argv.slice(2);
const store = createDiscoveryFrontierStore({
  directory,
  resolveTenant: (request) => request?.principal?.tenantId,
  now: () => Number(clockValue),
  lockTimeoutMs: 10_000,
});
try {
  const scope = await store.scopeForAuthenticatedRequest({ principal: { tenantId: 'tenant-a' } });
  const result = await store.claimNext(scope, runId, { workerId, claimKey });
  process.stdout.write(JSON.stringify(result));
} finally {
  store.close();
}
