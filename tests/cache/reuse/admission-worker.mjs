import { createScopedReuseStore } from '../../../src/cache/reuse/store.mjs';

const { directory, tenantId } = JSON.parse(process.env.REUSE_WORKER_CONFIG);
const request = Object.freeze({ principal: Object.freeze({ tenantId, actorId: `actor-${tenantId}` }) });
const sharedKey = process.env.REUSE_WORKER_SHARED_KEY === '1';
const key = Buffer.alloc(32, sharedKey ? 71 : tenantId.charCodeAt(0));
const store = createScopedReuseStore({
  directory,
  resolveTenant: (value) => value.principal.tenantId,
  resolveActor: (value) => value.principal.actorId,
  authorizeAction: () => true,
  resolveKey: ({ tenantId: keyTenant, purpose }) => ({ keyId: sharedKey ? `shared:${purpose}` : `index:${keyTenant}`, key }),
  resolveRetention: ({ nowMs }) => ({ expiresAtMs: nowMs + 60_000, policyId: 'worker', policyVersion: '1' }),
  now: () => Number(process.env.REUSE_WORKER_NOW ?? 1_800_000_000_000),
});
const scope = await store.scopeForAuthenticatedRequest(request);
const outcome = await store.admitOperation(scope, request, {
  identity: { occurrenceId: 'process-occurrence', entityId: 'process-entity', editionId: 'process-edition' },
  pins: { schemaVersion: 's1', extractorVersion: 'e1', questionSetVersion: 'q1', policyHash: 'c'.repeat(64), modelVersion: 'm1' },
  mode: 'reuse',
  leaseMs: Number(process.env.REUSE_WORKER_LEASE_MS ?? 30_000),
});
process.stdout.write(`${JSON.stringify(outcome)}\n`);
process.stdin.setEncoding('utf8');
process.stdin.on('data', () => process.exit(0));
process.stdin.resume();
