import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createCorrectionCacheBinding } from '../../../src/review/history/cache-binding.mjs';
import { createCorrectionHistoryStore } from '../../../src/review/history/store.mjs';

const [mode, root, eventId, baseVersionId, baseContentHash, markerPath, idempotencyKey, actorId = 'actor-binding'] = process.argv.slice(2);
const EPOCH = Date.parse('2026-10-10T15:00:00.000Z');
const TRUSTED_TOKEN = 'binding-test-server-context';

const request = Object.freeze({
  principal: Object.freeze({ tenantId: 'tenant-binding', actorId }),
  serverContextToken: TRUSTED_TOKEN,
});
const authorizeBoundary = (input) => {
  if (mode === 'kill-after-bind-cache-commit' && input.action === 'review.history.cache_bind_reference') {
    const history = new DatabaseSync(`${root}/history/${createHash('sha256')
      .update('event-intelligence:review-tenant:v1:tenant-binding').digest('hex')}/history.sqlite`);
    const cache = new DatabaseSync(`${root}/cache/scoped-reuse.sqlite`);
    try {
      const pending = history.prepare("SELECT phase FROM correction_cache_state WHERE kind = 'bind'").get();
      const receipt = cache.prepare('SELECT 1 AS found FROM reuse_bound_writes LIMIT 1').get();
      if (pending?.phase === 'pending_bind' && receipt) {
        writeFileSync(markerPath, 'bind cache receipt committed before history reference');
        cache.close();
        history.close();
        process.kill(process.pid, 'SIGKILL');
      }
    } finally {
      try { cache.close(); } catch { /* process may be terminating */ }
      try { history.close(); } catch { /* process may be terminating */ }
    }
  }
  return request.serverContextToken === TRUSTED_TOKEN
    && request.principal.tenantId === input.tenantId && request.principal.actorId === input.actorId
    ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
      eventId: input.eventId, action: input.action, field: input.field, nowMs: EPOCH }) : false;
};

const store = createCorrectionCacheBinding({
  history: {
    directory: `${root}/history`,
    resolveTenant: (value) => value?.principal?.tenantId,
    resolveActor: (value) => value?.principal?.actorId,
    authorize({ tenantId, actorId: resolvedActor, request: value }) {
      return value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === tenantId
        && value?.principal?.actorId === resolvedActor && resolvedActor !== 'outsider';
    },
    authorizeBoundary,
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
      if (mode === 'kill-after-bind-reservation' && action === 'private_profile.write') {
        const tenantHash = createHash('sha256').update('event-intelligence:review-tenant:v1:tenant-binding').digest('hex');
        const database = new DatabaseSync(`${root}/history/${tenantHash}/history.sqlite`);
        try {
          const pending = database.prepare("SELECT phase, reserved_history_bytes FROM correction_cache_operations WHERE kind = 'bind'").get();
          if (pending?.phase === 'pending_bind' && pending.reserved_history_bytes > 0) {
            writeFileSync(markerPath, `bind reservation persisted:${pending.reserved_history_bytes}`);
            database.close();
            process.kill(process.pid, 'SIGKILL');
          }
        } finally {
          try { database.close(); } catch { /* process may be terminating */ }
        }
      }
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
    authorizeBoundary,
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
  authorizeBoundary,
});

const scope = await store.scopeForAuthenticatedRequest(request);
if (mode === 'compete') writeFileSync(markerPath, 'ready-before-composed-correction');

if (mode === 'register-reference') {
  const maxStoredBytes = Number(markerPath);
  const historyStore = createCorrectionHistoryStore({
    directory: `${root}/history`,
    resolveTenant: (value) => value?.principal?.tenantId,
    resolveActor: (value) => value?.principal?.actorId,
    authorize({ tenantId, actorId: resolvedActor, request: value }) {
      return value?.serverContextToken === TRUSTED_TOKEN && value?.principal?.tenantId === tenantId
        && value?.principal?.actorId === resolvedActor && resolvedActor !== 'outsider';
    },
    authorizeBoundary,
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
    maxStoredBytes,
  });
  const historyScope = await historyStore.scopeForAuthenticatedRequest(request);
  try {
    const result = await historyStore.registerDownstreamReference(historyScope, {
      eventId,
      versionId: baseVersionId,
      contentHash: baseContentHash,
      referenceId: idempotencyKey,
      kind: 'consumer_reference',
    }, request);
    process.stdout.write(JSON.stringify({ outcome: 'registered', referenceId: result.referenceId }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ outcome: 'error', code: error?.code ?? 'UNKNOWN' }));
  }
} else if (mode === 'bind' || mode === 'kill-after-bind-reservation' || mode === 'kill-after-bind-cache-commit') {
  try {
    const result = await store.bindPrivateProfile(scope, eventId, {
      idempotencyKey,
      profile: Object.freeze({
        identity: Object.freeze({ occurrenceId: 'occurrence-binding-1', entityId: 'entity-binding-1', editionId: 'edition-binding-1' }),
        contentHash: 'a'.repeat(64),
        pins: Object.freeze({ schemaVersion: 'profile-schema-1', extractorVersion: 'extractor-1',
          questionSetVersion: 'questions-1', policyHash: 'b'.repeat(64), modelVersion: 'model-1' }),
        facts: Object.freeze({ event_name: Object.freeze({ status: 'sourced', value: 'ignored input' }) }),
        observation: Object.freeze({ source: 'synthetic local observation' }),
        freshnessTtlMs: 30_000,
        expiresAtMs: EPOCH + 45_000,
      }),
    }, request);
    process.stdout.write(JSON.stringify({ outcome: 'bound', cacheVersion: result.cacheVersion }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ outcome: 'error', code: error?.code ?? 'UNKNOWN' }));
  }
} else if (mode === 'hold-history-writer') {
  const tenantHash = createHash('sha256').update('event-intelligence:review-tenant:v1:tenant-binding').digest('hex');
  const database = new DatabaseSync(`${root}/history/${tenantHash}/history.sqlite`);
  try {
    database.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
    writeFileSync(markerPath, 'history writer acquired');
    const delayMs = Number(idempotencyKey);
    if (!Number.isSafeInteger(delayMs) || delayMs < 1 || delayMs > 5_000) throw new Error('invalid lock duration');
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    database.exec('COMMIT');
    process.stdout.write(JSON.stringify({ outcome: 'released', delayMs }));
  } finally {
    database.close();
  }
} else if (mode === 'read-history') {
  try {
    const result = await store.getHistory(scope, eventId, request);
    process.stdout.write(JSON.stringify({ outcome: 'read', revision: result.revision }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ outcome: 'error', code: error?.code ?? 'UNKNOWN' }));
  }
} else {
  try {
    const result = await store.applyCorrection(scope, {
      eventId,
      baseVersionId,
      baseContentHash,
      field: 'event_date',
      value: { precision: 'date', value: mode === 'retry-correction' ? '2027-06-24' : '2027-06-22' },
      idempotencyKey,
      retentionHandle: Object.freeze(Object.create(null)),
    }, request);
    process.stdout.write(JSON.stringify({ outcome: 'committed', revision: result.snapshot.revision }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ outcome: 'error', code: error?.code ?? 'UNKNOWN' }));
    if (mode === 'compete') process.exitCode = 1;
  }
}
