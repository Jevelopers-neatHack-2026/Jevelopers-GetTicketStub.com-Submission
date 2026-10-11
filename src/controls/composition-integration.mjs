/** Durable reviewed controls over the actual public composition API. This
 * adapter owns requests/reconciliation, never revision currentness or rendering. */
import { createCreativeApi } from 'creative-engine/api/v1';
import { canonicalHash, canonicalSerialize } from 'creative-engine/contracts';
import { snapshotCompositionJson, validateCompositionProductionEnvelope, createCompositionProductionEnvelope } from 'creative-engine/contracts/composition-authority';
import { snapshotControlJson, validId, canonical } from './schema.mjs';
import { createCompositionControlProjection, createCompositionControlPlan, COMPOSITION_APPLY_VERSION, CompositionControlsError } from './composition-projection.mjs';
import { assertCompositionHistoryIdentity } from './composition-view.mjs';
import { projectPublicTelemetry } from 'creative-engine/telemetry';

const safe = input => { const output = projectPublicTelemetry(input); if (output.redactions.length) throw new TypeError('Unsafe composition view'); return snapshotControlJson(output.value); };
const exact = (x, fields) => x && Object.keys(x).sort().join(',') === [...fields].sort().join(',');
export class CompositionControlsAdapter {
  constructor({ database, ports, readContext, readPolicy, now = () => Date.now() }) {
    if (!database || typeof readContext !== 'function' || typeof readPolicy !== 'function') throw new TypeError('Composition adapter dependencies unavailable');
    if (database.isTransaction) throw new TypeError('Borrowed controls transaction');
    this.db = database; this.ports = ports; this.readContext = readContext; this.readPolicy = readPolicy; this.now = now; this.inflight = new Map();
    database.exec(`CREATE TABLE IF NOT EXISTS control_composition_actions_v1 (
      tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, actor_id TEXT NOT NULL, action_id TEXT NOT NULL,
      action_json TEXT NOT NULL, action_hash TEXT NOT NULL, request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
      job_id TEXT, backend_request_hash TEXT, response_json TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY(tenant_id,project_id,action_id));`);
    const begin = ports.jobs.begin;
    this.api = createCreativeApi({ now, ports: { ...ports, jobs: { ...ports.jobs, begin: async input => {
      const result = await begin(input);
      if (result.kind !== 'conflict') {
        this.assertTransactionFree();
        this.db.prepare('UPDATE control_composition_actions_v1 SET job_id=?,backend_request_hash=? WHERE tenant_id=? AND project_id=? AND action_id=? AND actor_id=?')
          .run(result.kind === 'started' ? result.job_id : result.job.job_id, input.request_hash, input.scope.tenant_id, input.scope.project_id, input.action_id, input.actor_id);
      }
      return result;
    } } } });
  }
  assertTransactionFree() { if (this.db.isTransaction) throw new TypeError('Borrowed controls transaction'); }
  context(principal, edit = false) {
    principal = snapshotControlJson(principal);
    if (!exact(principal, ['actor_id','tenant_id','project_id']) || Object.values(principal).some(x => !validId(x))) throw new CompositionControlsError('permission_denied','scope');
    const context = snapshotCompositionJson(this.readContext(principal));
    const { actor, brief, design, selection, policy } = context;
    if (!actor || actor.actor_id !== principal.actor_id || actor.tenant_id !== principal.tenant_id || actor.project_id !== principal.project_id ||
        !brief || brief.tenant_id !== principal.tenant_id || brief.project_id !== principal.project_id || !design || design.tenant_id !== principal.tenant_id || design.project_id !== principal.project_id || design.brief_id !== brief.brief_id ||
        selection?.design_version_id !== design.design_version_id || selection.design_hash !== design.design_hash ||
        !actor.permissions.includes('creative.read') || Date.parse(actor.expires_at) <= this.now() || policy.can_read === false ||
        edit && (!context.brief_usable || policy.can_apply !== true || !actor.permissions.includes('creative.edit'))) throw new CompositionControlsError('permission_denied','scope');
    return context;
  }
  request(principal, context, operation, payload, action_id) {
    const id = action_id ?? 'controls-composition-read', timestamp = new Date(this.now()).toISOString();
    return { contract: 'CreativeApiRequest', schema_version: ['composition.history','composition.revalidate'].includes(operation) ? '1.3' : '1.2', ...Object.fromEntries(['tenant_id','project_id'].map(k => [k, principal[k]])),
      event_id: `event:${id}`, request_id: `request:${id}`, correlation_id: `correlation:${id}`, producer: 'composition-controls/1', occurred_at: timestamp, ingested_at: timestamp,
      environment: context.brief.environment, billing_mode: context.brief.billing_mode, source_refs: [], operation, ...(action_id ? { action_id } : {}),
      payload: { brief_id: context.brief.brief_id, design_version_id: context.design.design_version_id, ...payload } };
  }
  binding(context) { return { tenant_id: context.brief.tenant_id, project_id: context.brief.project_id, brief_id: context.brief.brief_id, brief_sha256: canonicalHash(context.brief),
    design_version_id: context.design.design_version_id, design_version_sha256: context.design.design_hash, artwork_sha256: context.design.artifact.content_hash, selection_revision: context.selection.revision }; }
  async current(principal) {
    this.assertTransactionFree(); const context = this.context(principal);
    const response = await this.api.invoke(context.actor, this.request(principal, context, 'composition.get', {}));
    this.assertTransactionFree(); const after = this.context(principal);
    if (canonical(this.binding(context)) !== canonical(this.binding(after))) return { ok: false, status: 'stale', code: 'stale_version', approval: false, purchase: false };
    if (!response.ok) return safe({ ok: false, status: response.error.code === 'stale_version' ? 'stale' : 'unavailable', code: response.error.code, approval: false, purchase: false });
    const can_apply = context.brief_usable && context.policy.can_apply === true && context.actor.permissions.includes('creative.edit');
    if (response.result.status === 'not_initialized' && response.result.composition === null) {
      const review = { contract: 'CreativeCompositionInitializationReview', schema_version: '1.0', base: this.binding(after), can_initialize: can_apply, approval: false, purchase: false };
      return safe({ ok: true, status: 'not_initialized', review: { ...review, review_sha256: canonicalHash(review) }, approval: false, purchase: false });
    }
    const { revision, bytes } = this.validateResult(response.result, principal);
    if (revision.brief_id !== after.brief.brief_id || revision.dependencies.design_version_id !== after.design.design_version_id || revision.dependencies.design_version_sha256 !== after.design.design_hash || revision.dependencies.selection_revision !== after.selection.revision) throw new TypeError('Current result binding mismatch');
    const projection = createCompositionControlProjection({ revision, preview_bytes: Uint8Array.from(bytes), principal, policy: this.readPolicy(principal, after), selection_revision: after.selection.revision, can_apply: !!can_apply, now_ms: this.now() });
    return safe({ ok: true, status: 'current', projection, preview: this.previewDescriptor(revision), approval: false, purchase: false });
  }
  async history(principal, options = {}) {
    this.assertTransactionFree(); options = snapshotControlJson(options);
    if (Object.keys(options).some(k => !['limit','after_revision_id'].includes(k)) ||
        options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 20) ||
        options.after_revision_id !== undefined && !validId(options.after_revision_id)) throw new CompositionControlsError('invalid_request','history');
    const context = this.context(principal), response = await this.api.invoke(context.actor, this.request(principal, context, 'composition.history', options));
    this.assertTransactionFree(); const after = this.context(principal);
    if (canonical(this.binding(context)) !== canonical(this.binding(after))) return { ok: false, status: 'unavailable', code: 'stale_version', approval: false, purchase: false };
    if (!response.ok) return safe({ ok: false, status: 'unavailable', code: response.error.code, approval: false, purchase: false });
    const identity = assertCompositionHistoryIdentity(response.result);
    if (identity.current && (identity.current.design_version_id !== after.design.design_version_id || identity.current.design_version_sha256 !== after.design.design_hash) ||
        identity.revisions.some(r => r.design_version_id !== after.design.design_version_id || r.design_version_sha256 !== after.design.design_hash)) throw new TypeError('History scope binding mismatch');
    let review = null;
    if (identity.current) {
      const body = { contract: 'CreativeCompositionRenewalReview', schema_version: '1.0', base: { ...this.binding(after),
        composition_id: identity.current.composition_id, current_revision_id: identity.current.revision_id, current_revision_sha256: identity.current.revision_sha256 },
        can_renew: !!after.brief_usable && after.policy.can_apply === true && after.actor.permissions.includes('creative.edit') && ['current','changed'].includes(identity.selection_compatibility),
        approval: false, purchase: false };
      review = { ...body, review_sha256: canonicalHash(body) };
    }
    return safe({ ok: true, status: identity.status, identity, review, approval: false, purchase: false });
  }
  validateResult(result, principal) {
    const rawProduction = snapshotCompositionJson(result.composition);
    const access = snapshotCompositionJson(result.preview_access);
    if (!exact(access, ['contract','schema_version','preview_id','sha256','byte_length','mime_type','width_px','height_px','bytes_base64']) || access.contract !== 'CreativeCompositionPreviewAccess' || access.schema_version !== '1.1' ||
        typeof access.bytes_base64 !== 'string' || access.bytes_base64.length > 34952536 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(access.bytes_base64)) throw new TypeError('Invalid preview access');
    const bytes = Buffer.from(access.bytes_base64, 'base64');
    const production = validateCompositionProductionEnvelope(rawProduction, { trustedScope: { ...principal, brief_id: rawProduction.revision.brief_id }, previewBytes: Uint8Array.from(bytes) });
    const revision = { ...production.revision, created_at: new Date(0).toISOString() };
    if (bytes.length > 25 * 1024 * 1024 || bytes.toString('base64') !== access.bytes_base64 ||
        ['preview_id','byte_length','mime_type','width_px','height_px'].some(k => access[k] !== revision.preview[k]) || access.sha256 !== revision.preview.preview_sha256) throw new TypeError('Preview identity mismatch');
    return { revision, bytes };
  }
  previewDescriptor(revision) { return { revision_id: revision.revision_id, revision_sha256: revision.revision_sha256, state_sha256: revision.state_sha256,
    preview_id: revision.preview.preview_id, preview_sha256: revision.preview.preview_sha256, byte_length: revision.preview.byte_length, mime_type: revision.preview.mime_type, width_px: revision.preview.width_px, height_px: revision.preview.height_px }; }
  async preview(principal, expected) {
    this.assertTransactionFree();
    expected = snapshotControlJson(expected);
    if (!exact(expected, ['revision_id','revision_sha256','preview_sha256'])) return null;
    const context = this.context(principal), response = await this.api.invoke(context.actor, this.request(principal, context, 'composition.get', {}));
    if (!response.ok || response.result.status !== 'current') return null;
    const checked = this.validateResult(response.result, principal);
    this.assertTransactionFree(); const after = this.context(principal);
    if (canonical(this.binding(context)) !== canonical(this.binding(after))) return null;
    if (expected.revision_id !== checked.revision.revision_id || expected.revision_sha256 !== checked.revision.revision_sha256 || expected.preview_sha256 !== checked.revision.preview.preview_sha256) return null;
    return { bytes: checked.bytes, metadata: this.previewDescriptor(checked.revision) };
  }
  row(principal, action_id) {
    this.assertTransactionFree();
    const row = this.db.prepare('SELECT * FROM control_composition_actions_v1 WHERE tenant_id=? AND project_id=? AND action_id=?').get(principal.tenant_id, principal.project_id, action_id);
    if (row && row.actor_id !== principal.actor_id) throw new TypeError('Permission');
    if (row && (canonicalHash(snapshotControlJson(JSON.parse(row.action_json))) !== row.action_hash || JSON.parse(row.action_json).action_id !== row.action_id)) throw new TypeError('Corrupt stored action');
    return row;
  }
  async apply(principal, rawAction) {
    let action, row;
    try {
      this.assertTransactionFree();
      principal = snapshotControlJson(principal); action = snapshotControlJson(rawAction); this.context(principal, true);
      if (!validId(action.action_id)) return { ok: false, code: 'validation', status: 'failed', approval: false, purchase: false };
      if (!['creative-composition-initialize/1.0', 'creative-composition-renew/1.0', COMPOSITION_APPLY_VERSION].includes(action.action_version)) return { ok: false, code: 'unsupported_version', status: 'failed', action_id: action.action_id, approval: false, purchase: false };
      row = this.row(principal, action.action_id);
      if (row && row.action_hash !== canonicalHash(action)) return safe({ ok: false, code: 'conflict', status: 'failed', action_id: action.action_id });
      if (!row) {
        const view = action.action_version === 'creative-composition-renew/1.0' ? await this.history(principal) : await this.current(principal), context = this.context(principal, true); let operation, payload;
        if (action.action_version === 'creative-composition-renew/1.0') {
          if (!exact(action, ['action_version','action_id','review_sha256','intent']) || action.intent !== 'renew' || !view.ok || !view.review?.can_renew || action.review_sha256 !== view.review.review_sha256) return { ok: false, code: 'stale_version', status: 'stale', action_id: action.action_id, approval: false, purchase: false };
          operation = 'composition.revalidate'; payload = { expected_current_revision_id: view.review.base.current_revision_id, expected_current_revision_sha256: view.review.base.current_revision_sha256, candidate_revision_id: `renew:${action.action_id}` };
        } else if (action.action_version === 'creative-composition-initialize/1.0') {
          if (!exact(action, ['action_version','action_id','review_sha256','intent']) || action.intent !== 'initialize' || view.status !== 'not_initialized' || !view.review.can_initialize || action.review_sha256 !== view.review.review_sha256) return { ok: false, code: 'stale_version', status: 'stale' };
          operation = 'composition.create'; payload = {};
        } else {
          if (action.action_version !== COMPOSITION_APPLY_VERSION || view.status !== 'current') return { ok: false, code: 'stale_version', status: 'stale' };
          const current = await this.ports.storage.getCurrentComposition({ scope: { ...principal, brief_id: context.brief.brief_id }, design_version_id: context.design.design_version_id });
          const plan = createCompositionControlPlan({ revision: current.revision, policy: this.readPolicy(principal, context), projection: view.projection, action });
          operation = 'composition.update'; payload = { plan };
        }
        this.assertTransactionFree(); this.context(principal, true);
        const request = this.request(principal, context, operation, payload, action.action_id);
        // Synchronous persistence precedes invoke/begin/owner/render callbacks.
        const raced = this.row(principal, action.action_id);
        if (raced && raced.action_hash !== canonicalHash(action)) return { ok: false, code: 'conflict', status: 'failed' };
        if (!raced) this.db.prepare('INSERT INTO control_composition_actions_v1(tenant_id,project_id,actor_id,action_id,action_json,action_hash,request_json,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(principal.tenant_id, principal.project_id, principal.actor_id, action.action_id, canonical(action), canonicalHash(action), canonicalSerialize(request), canonicalHash(request), this.now());
        row = this.row(principal, action.action_id);
      }
    } catch (error) {
      const allowed = ['permission_denied','stale_version','invalid_request','unsupported_version','conflict','integrity_error'];
      return { ok: false, code: allowed.includes(error?.code) ? error.code : 'validation', status: error?.code === 'stale_version' ? 'stale' : 'failed', ...(action && validId(action.action_id) ? {action_id:action.action_id} : {}), approval: false, purchase: false };
    }
    const key = `${principal.tenant_id}:${principal.project_id}:${action.action_id}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = this.consume(principal, row); this.inflight.set(key, promise);
    try { return await promise; } finally { this.inflight.delete(key); }
  }
  async consume(principal, row, readOnly = false) {
    try {
      this.assertTransactionFree();
      const context = this.context(principal, !row.response_json && !readOnly), request = snapshotCompositionJson(JSON.parse(row.request_json));
      if (!['composition.create','composition.update','composition.revalidate'].includes(request.operation)) throw new TypeError('Unsupported composition operation');
      if (canonicalHash(request) !== row.request_hash || request.action_id !== row.action_id || request.tenant_id !== principal.tenant_id || request.project_id !== principal.project_id) throw new TypeError('Corrupt request');
      let response;
      if (row.response_json) response = snapshotCompositionJson(JSON.parse(row.response_json));
      else if (readOnly) {
        const savedJob = row.job_id ? await this.ports.jobs.get({ scope: principal, job_id: row.job_id }) : null;
        if (savedJob?.status !== 'completed' || !savedJob.result) return safe({ ok: false, code: savedJob?.status === 'cancelled' ? 'cancelled' : 'unavailable', status: savedJob?.status === 'cancelled' ? 'cancelled' : 'unknown', action_id: row.action_id, backend_job_id: row.job_id, approval: false, purchase: false });
        // A read-only projection of the real durable job, not an executor call.
        response = { ok: true, job: { job_id: savedJob.job_id }, result: savedJob.result, replayed: true };
      } else response = await this.api.invoke(context.actor, request);
      this.assertTransactionFree(); this.context(principal);
      if (!response.ok) return safe({ ok: false, status: response.error.code === 'stale_version' ? 'stale' : response.error.code === 'cancelled' ? 'cancelled' : 'failed', code: response.error.code,
        action_id: row.action_id, backend_job_id: response.job?.job_id ?? this.row(principal, row.action_id).job_id ?? null, approval: false, purchase: false });
      const checked = this.validateResult(response.result, principal), latest = this.row(principal, row.action_id);
      const job = await this.ports.jobs.get({ scope: principal, job_id: latest.job_id });
      const durable = await this.ports.storage.getCompositionAction({ scope: { ...principal, brief_id: request.payload.brief_id }, action_id: row.action_id });
      this.assertTransactionFree(); this.context(principal);
      const revision = checked.revision;
      if (revision.brief_id !== request.payload.brief_id || revision.dependencies.design_version_id !== request.payload.design_version_id) throw new TypeError('Request/result binding mismatch');
      if (!job || job.status !== 'completed' || job.action_id !== row.action_id || job.request_hash !== latest.backend_request_hash || response.job?.job_id !== latest.job_id ||
          durable?.status !== 'published' || durable.actor_id !== principal.actor_id || durable.job_id !== job.job_id || durable.request_hash !== job.request_hash ||
          durable.revision?.revision_sha256 !== revision.revision_sha256 || canonicalSerialize(createCompositionProductionEnvelope(durable.revision)) !== canonicalSerialize(response.result.composition) ||
          canonicalSerialize(job.result) !== canonicalSerialize(response.result) || !Buffer.from(durable.preview_bytes).equals(checked.bytes) ||
          request.operation === 'composition.update' && (revision.revision_id !== request.payload.plan.target_composition_revision_id || revision.parent_revision_id !== request.payload.plan.base_composition_revision_id) ||
          request.operation === 'composition.revalidate' && (response.result.contract !== 'CreativeCompositionRevalidationResult' || response.result.schema_version !== '1.0' || response.result.revision_sha256 !== revision.revision_sha256 || response.result.selection_revision !== revision.dependencies.selection_revision || revision.revision_id !== request.payload.candidate_revision_id || revision.parent_revision_id !== request.payload.expected_current_revision_id || revision.parent_revision_sha256 !== request.payload.expected_current_revision_sha256)) throw new TypeError('Durable result identity mismatch');
      if (!row.response_json && !readOnly) this.db.prepare('UPDATE control_composition_actions_v1 SET response_json=? WHERE tenant_id=? AND project_id=? AND action_id=? AND actor_id=?')
        .run(canonicalSerialize(response), principal.tenant_id, principal.project_id, row.action_id, principal.actor_id);
      // Completion is historical until a separate fail-closed current read proves
      // it is still current. No replay response changes any current pointer.
      return safe({ ok: true, status: 'saved', historical: !!row.response_json || response.replayed === true, action_id: row.action_id,
        backend_job_id: job.job_id, request_sha256: row.request_hash, revision_id: revision.revision_id, revision_sha256: revision.revision_sha256,
        parent_revision_id: revision.parent_revision_id, parent_revision_sha256: revision.parent_revision_sha256,
        state_sha256: revision.state_sha256, artwork_sha256: revision.dependencies.artwork_sha256, preview: this.previewDescriptor(revision), approval: false, purchase: false });
    } catch { return safe({ ok: false, code: 'unavailable', status: 'unknown', action_id: row.action_id, backend_job_id: row.job_id ?? null, approval: false, purchase: false }); }
  }
  async lookup(principal, action_id) {
    try { this.assertTransactionFree(); this.context(principal); if (!validId(action_id)) return null; const row = this.row(principal, action_id); return row ? this.consume(principal, row, true) : null; } catch { return null; }
  }
  async retry(principal, action_id) {
    // The browser persists only this opaque identity, never the name/text draft.
    // Recovery uses the original durable, scoped, hash-checked request.
    try { this.assertTransactionFree(); this.context(principal); if (!validId(action_id)) return null; const row = this.row(principal, action_id); return row ? this.consume(principal, row) : null; } catch { return null; }
  }
  async cancel(principal, action_id) {
    try { this.assertTransactionFree(); const context = this.context(principal, true), row = this.row(principal, action_id); if (!row?.job_id) return { ok: false, status: 'unknown', action_id };
      const response = await this.api.invoke(context.actor, { ...this.request(principal, context, 'cancel', {}, `cancel:${action_id}`), schema_version: '1.0', payload: { job_id: row.job_id } });
      this.context(principal); return safe({ ok: response.ok, status: response.ok ? response.job.status : 'unknown', action_id, backend_job_id: row.job_id, approval: false, purchase: false });
    } catch { return { ok: false, status: 'unknown', approval: false, purchase: false }; }
  }
}
