import { createDiscoveryFrontierStore } from '../../src/discovery/planner/frontier.mjs';

const [directory, runId] = process.argv.slice(2);
const store = createDiscoveryFrontierStore({
  directory,
  resolveTenant: (request) => request?.principal?.tenantId,
  lockTimeoutMs: 10_000,
});
try {
  const scope = await store.scopeForAuthenticatedRequest({ principal: { tenantId: 'tenant-a' } });
  const snapshot = await store.stopRun(scope, runId, 'cancelled');
  process.stdout.write(JSON.stringify({ stopReason: snapshot.stopReason, state: snapshot.state }));
} finally {
  store.close();
}
