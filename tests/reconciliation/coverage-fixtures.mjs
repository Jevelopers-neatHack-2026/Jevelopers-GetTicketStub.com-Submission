// Synthetic metadata and model storage only. These fixtures establish no live/provider authority.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getCoverageImportContentHash } from '@jevelopers/cost-intelligence/reconciliation';

export const clone = value => JSON.parse(JSON.stringify(value));
export const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
export const hash = value => 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex');
export const scope = extra => ({ tenantId: 'ci07-synthetic-tenant', projectId: 'ci07-synthetic-project', environment: 'test', billingMode: 'simulated', actorId: 'synthetic-finance-reviewer', ...extra });
export const partition = value => ({ tenantId: value.tenantId, projectId: value.projectId, environment: value.environment, billingMode: value.billingMode });

export function record(extra = {}) {
  return {
    schemaVersion: '1.0.0', sourceId: 'synthetic-provider', importId: 'synthetic-import', revision: 1, predecessorHash: null,
    scope: partition(scope()), sourceAccountRef: 'synthetic-account', sourceProjectRef: 'synthetic-project', currency: 'USD',
    periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z', timeZone: 'UTC',
    coverageStart: '2026-10-01T00:00:00.000Z', coverageEnd: '2026-11-01T00:00:00.000Z',
    sourceArtifactHash: hash('synthetic-original-retrieval-receipt'), adapterVersion: 'synthetic-adapter-1', sourceSchemaVersion: 'synthetic-source-1',
    cursorRef: 'synthetic-cursor-ref', retrievedAt: '2026-10-12T15:00:00.000Z', retrievalStatus: 'complete', recordCount: 2,
    zeroEvidenceRef: null, evidenceMode: 'mocked', verificationStatus: 'unverified', ...extra,
  };
}
export function reference(value) {
  const result = getCoverageImportContentHash(value);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value, hash(value), 'public normalized hash must match independent canonical oracle');
  return { sourceId: value.sourceId, importId: value.importId, revision: value.revision, contentHash: result.value };
}
export function request(records = [record()], extra = {}) {
  return { schemaVersion: '2.0.0', mode: 'coverage_only', requestId: 'synthetic-request-1', scope: scope(), idempotencyKey: 'synthetic-run-1',
    windowStart: '2026-10-01T00:00:00.000Z', windowEnd: '2026-11-01T00:00:00.000Z', sourceSnapshots: records.map(reference), ...extra };
}
export const readRequest = (summary, extra = {}) => ({ schemaVersion: '2.0.0', mode: 'coverage_only', requestId: 'synthetic-read-1', scope: scope(), runId: summary.runId, pageSize: 2, ...extra });
export async function checked(result) { const resolved = await result; assert.equal(resolved.ok, true, JSON.stringify(resolved)); return resolved.value; }
export async function refused(result, code) { const resolved = await result; assert.equal(resolved.ok, false, JSON.stringify(resolved)); if (code) assert.equal(resolved.error.code, code); assert.equal(Object.hasOwn(resolved, 'value'), false); return resolved; }

export function harness(records = [record()], initialScope = scope()) {
  const state = { now: '2026-10-12T15:00:00.000Z', denied: false, kind: 'service', revision: 'synthetic-grant-1', authorizationCalls: 0,
    reads: 0, writes: 0, sourceReads: 0, authorityHook: null, sourceHook: null, storeHook: null, latestRun: null };
  const runs = new Map();
  const sources = new Map(records.map(value => [hash(value), value]));
  const financeAuthority = { authorizeCurrent: async command => {
    state.authorizationCalls++;
    if (state.authorityHook) return state.authorityHook(command, state);
    if (state.denied || canonical(command.requestedScope) !== canonical(initialScope)) return { status: 'denied', operation: command.operation, permission: command.permission };
    return { status: 'allowed', decisionId: 'synthetic-current-authority', operation: command.operation, permission: command.permission, scope: clone(initialScope),
      principal: state.kind === 'user'
        ? { kind: 'user', actorId: initialScope.actorId, membershipStatus: 'active', membershipRevision: state.revision }
        : { kind: 'service', actorId: initialScope.actorId, serviceStatus: 'active', serviceGrantRevision: state.revision },
      verifiedAt: state.now, expiresAt: new Date(Date.parse(state.now) + 60_000).toISOString() };
  } };
  const coverageSource = { resolve: async (ref, requestedScope) => {
    state.sourceReads++;
    if (state.sourceHook) return state.sourceHook(ref, requestedScope);
    const value = sources.get(ref.contentHash);
    return value ? { status: 'available', record: value } : { status: 'unavailable' };
  } };
  const coverageStore = {
    async createOrReplay(run, access) {
      if (state.storeHook) await state.storeHook('create', run, access);
      await access.renew();
      const prior = runs.get(run.summary.runId);
      if (prior) {
        // This model cannot establish PostgreSQL conflict/durability behavior.
        if (prior.summary.inputHash !== run.summary.inputHash) throw new Error('synthetic model immutable-input conflict');
        return clone(prior);
      }
      state.writes++;
      state.latestRun = clone(run);
      runs.set(run.summary.runId, state.latestRun);
      return clone(run);
    },
    async read(runId, access) {
      state.reads++;
      if (state.storeHook) await state.storeHook('read', runId, access);
      await access.renew();
      const run = runs.get(runId);
      return run && canonical(partition(run.scope)) === canonical(partition(access.scope)) ? clone(run) : null;
    },
  };
  return { state, runs, sources, ports: { clock: { now: () => new Date(state.now) }, financeAuthority, coverageSource, coverageStore } };
}
