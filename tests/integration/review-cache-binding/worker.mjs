import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createCorrectionCacheBinding } from '../../../src/review/history/cache-binding.mjs';

const [mode, root, eventId, baseVersionId, baseContentHash, markerPath, idempotencyKey, actorId = 'actor-binding'] = process.argv.slice(2);
const EPOCH = Date.parse('2026-10-10T15:00:00.000Z');
const TRUSTED_TOKEN = 'binding-test-server-context';

const request = Object.freeze({
  principal: Object.freeze({ tenantId: 'tenant-binding', actorId }),
  serverContextToken: TRUSTED_TOKEN,
});

const store = createCorrectionCacheBinding({
  history: {
    directory: `${root}/history`,
    resolveTenant: (value) => value?.principal?.tenantId,
    resolveActor: (value) => value?.principal?.actorId,
    authorize({ tenantId, actorId: resolvedActor, request: value }) {
      return value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === tenantId
        && value?.principal?.actorId === resolvedActor && resolvedActor !== 'outsider';
    },
    resolveKey({ tenantId, purpose, keyId }) {
      const resolvedId = `${purpose}-v1`;
      if (keyId && keyId !== resolvedId) throw new Error('synthetic history key unavailable');
      return { keyId: resolvedId, key: createHash('sha256').update(`${tenantId}:${purpose}:history-test-key`).digest() };
    },
    resolveRetention({ nowMs, sourceExpiresAtMs }) {
      return { expiresAtMs: Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
        policyId: 'synthetic-history-retention', policyVersion: '1', accessPolicy: 'tenant_private' };
    },
    lockedFields: ['event_status'],
    now: () => EPOCH,
  },
  cache: {
    directory: `${root}/cache`,
    now: () => EPOCH,
    resolveTenant: (value) => value?.principal?.tenantId,
    resolveActor: (value) => value?.principal?.actorId,
    authorizeAction({ tenantId, actorId: resolvedActor, action, request: value, details }) {
      if (mode === 'kill-after-history' && action === 'cache.invalidate' && typeof details?.profileRef === 'string') {
        writeFileSync(markerPath, 'post-history cache invalidation callback');
        process.kill(process.pid, 'SIGKILL');
      }
      if (mode === 'kill-after-cache-commit' && action === 'cache.invalidate' && typeof details?.profileRef === 'string') {
        const database = new DatabaseSync(`${root}/cache/scoped-reuse.sqlite`);
        try {
          const receipt = database.prepare('SELECT 1 AS found FROM reuse_history_invalidation_ops WHERE entry_id = ? LIMIT 1')
            .get(details.profileRef);
          if (receipt) {
            writeFileSync(markerPath, 'post-cache-commit before history receipt');
            database.close();
            process.kill(process.pid, 'SIGKILL');
          }
        } finally {
          try { database.close(); } catch { /* process is terminating after the test marker */ }
        }
      }
      return value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === tenantId
        && value?.principal?.actorId === resolvedActor && resolvedActor !== 'outsider';
    },
    authorizeCurrentRequest({ expectedTenantId, expectedActorId, request: value }) {
      return value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === expectedTenantId
        && value?.principal?.actorId === expectedActorId && expectedActorId !== 'outsider';
    },
    resolveKey({ tenantId, scope, purpose, keyId }) {
      const resolvedId = `${scope}:${purpose}:${tenantId ?? 'global'}:v1`;
      if (keyId && keyId !== resolvedId) throw new Error('synthetic cache key unavailable');
      return { keyId: resolvedId, key: createHash('sha256').update(`${tenantId}:${scope}:${purpose}:cache-test-key`).digest() };
    },
    resolveRetention({ nowMs, requestedExpiryMs }) {
      return { expiresAtMs: Math.min(nowMs + 60_000, requestedExpiryMs ?? Number.MAX_SAFE_INTEGER),
        policyId: 'synthetic-cache-retention', policyVersion: '1' };
    },
    verifySourceObservation({ expectedContentHash }) {
      return { status: 'body_changed', contentHash: expectedContentHash,
        retrievedAt: new Date(EPOCH - 1_000).toISOString(), validatedAt: new Date(EPOCH).toISOString(),
        attemptLineage: { status: 'unknown' } };
    },
    resolvePrivateProfileReferences({ contentHash }) {
      return { permissions: [{ reference: 'synthetic-private-permission', contentHash, version: 1, use: 'cache_read' }],
        sourceRefs: ['private-source-reference'], correctionRefs: ['private-correction-reference'] };
    },
    verifyPermission({ reference, contentHash, version, use }) {
      return { status: 'valid', reference, contentHash, version, use, validUntilMs: EPOCH + 60_000 };
    },
    resolveLineage: () => ({ status: 'unknown' }),
    resolveInvalidationConsumers: () => ['private-consumer-binding-test'],
    deliverInvalidation: async (event) => event,
    verifyInvalidationAcknowledgement: () => false,
  },
  authorizeFinalDisclosure: ({ tenantId, actorId: resolvedActor }) => tenantId === 'tenant-binding' && resolvedActor !== 'outsider',
});

const scope = await store.scopeForAuthenticatedRequest(request);
if (mode === 'compete') writeFileSync(markerPath, 'ready-before-composed-correction');

try {
  const result = await store.applyCorrection(scope, {
    eventId,
    baseVersionId,
    baseContentHash,
    field: 'event_date',
    value: { precision: 'date', value: '2027-06-22' },
    idempotencyKey,
    retentionHandle: Object.freeze(Object.create(null)),
  }, request);
  process.stdout.write(JSON.stringify({ outcome: 'committed', revision: result.snapshot.revision }));
} catch (error) {
  process.stdout.write(JSON.stringify({ outcome: 'error', code: error?.code ?? 'UNKNOWN' }));
  if (mode === 'compete') process.exitCode = 1;
}
