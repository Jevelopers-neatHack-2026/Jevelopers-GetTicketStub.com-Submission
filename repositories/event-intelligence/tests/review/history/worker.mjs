import { createHash } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import { createCorrectionHistoryStore } from '../../../src/review/history/store.mjs';

const [mode, directory, eventId, baseVersionId, baseContentHash, signalPath, dateValue, actorId] = process.argv.slice(2);
const EPOCH = Date.parse('2026-10-10T15:00:00.000Z');
const TRUSTED_SERVER_CONTEXT = 'synthetic-server-context';
let retentionCalls = 0;

const store = createCorrectionHistoryStore({
  directory,
  resolveTenant: (request) => request?.principal?.tenantId,
  resolveActor: (request) => request?.principal?.actorId,
  authorize({ tenantId, actorId: resolvedActor, request }) {
    return request?.serverContextToken === TRUSTED_SERVER_CONTEXT
      && request?.principal?.tenantId === tenantId
      && request?.principal?.actorId === resolvedActor;
  },
  authorizeBoundary(input) {
    const allowed = input.request?.serverContextToken === TRUSTED_SERVER_CONTEXT
      && input.request?.principal?.tenantId === input.tenantId
      && input.request?.principal?.actorId === input.actorId;
    return allowed ? Object.freeze({ authorized: true, tenantId: input.tenantId, actorId: input.actorId,
      eventId: input.eventId, action: input.action, field: input.field, nowMs: EPOCH }) : false;
  },
  resolveKey({ tenantId, purpose, keyId }) {
    const resolvedId = `${purpose}-v1`;
    if (keyId && keyId !== resolvedId) throw new Error('synthetic key resolver failure');
    return {
      keyId: resolvedId,
      key: createHash('sha256').update(`${tenantId}:${purpose}:test-only-key-material`).digest(),
    };
  },
  async resolveRetention({ nowMs, sourceExpiresAtMs }) {
    retentionCalls += 1;
    if (mode === 'crash' && retentionCalls === 2) {
      await writeFile(signalPath, 'staged');
      await new Promise(() => setInterval(() => {}, 60_000));
    }
    return {
      expiresAtMs: Math.min(nowMs + 60_000, sourceExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
      policyId: 'synthetic-private-history',
      policyVersion: '1',
      accessPolicy: 'tenant_private',
    };
  },
  lockedFields: ['event_status'],
  now: () => EPOCH,
});

const request = Object.freeze({
  principal: Object.freeze({ tenantId: 'tenant-a', actorId: actorId ?? 'crash-worker' }),
  serverContextToken: TRUSTED_SERVER_CONTEXT,
});
const scope = await store.scopeForAuthenticatedRequest(request);

if (mode === 'compete') {
  const readyPath = `${signalPath}.ready-${actorId}`;
  await writeFile(readyPath, 'ready');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { await access(signalPath); break; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  try {
    const result = await store.applyCorrection(scope, {
      eventId,
      baseVersionId,
      baseContentHash,
      field: 'event_date',
      value: { precision: 'date', value: dateValue },
      idempotencyKey: `process-${actorId}`,
      retentionHandle: Object.freeze(Object.create(null)),
    }, request);
    process.stdout.write(JSON.stringify({ outcome: 'committed', revision: result.snapshot.revision }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ outcome: error?.code === 'REVIEW_VERSION_CONFLICT' ? 'conflict' : 'error', code: error?.code ?? 'UNKNOWN' }));
  }
} else if (mode === 'crash') {
  try {
    await store.applyCorrection(scope, {
      eventId,
      baseVersionId,
      baseContentHash,
      field: 'event_date',
      value: { precision: 'date', value: '2027-06-20' },
      idempotencyKey: 'crash-worker-key',
      retentionHandle: Object.freeze(Object.create(null)),
    }, request);
  } catch (error) {
    process.stdout.write(JSON.stringify({ outcome: 'error', code: error?.code ?? 'UNKNOWN' }));
  }
} else {
  process.stderr.write('unknown worker mode');
  process.exitCode = 2;
}
