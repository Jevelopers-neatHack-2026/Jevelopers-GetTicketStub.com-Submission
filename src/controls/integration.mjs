/** Source-local UI adapter over public creative API ports. No provider executor,
 * credential issuer, ledger, composition renderer, or approval authority. */
import { createCreativeApi } from 'creative-engine/api/v1';
import { canonicalHash } from 'creative-engine/contracts';
import { projectPublicTelemetry } from 'creative-engine/telemetry';
import { ApplyStore, hash } from './actions.mjs';
import { createControlSchema, SCHEMA_VERSIONS, snapshotControlJson, canonical } from './schema.mjs';
import { ARTWORK_RECOVERY_VERSION, assertArtworkRecovery } from './artwork-recovery.mjs';
import { projectApplyResult } from './public-result.mjs';

const fields = ['name_size', 'layout', 'logo_position', 'style', 'layout_emphasis'];
const baseline = { name_size: 'medium', layout: 'centered', logo_position: 'top', style: 'calm', layout_emphasis: 'balanced' };
const options = { name_size: ['small', 'medium', 'large'], layout: ['centered', 'stacked'], logo_position: ['top', 'bottom'], style: ['calm', 'vibrant'] };
const safe = value => {
  const result = projectPublicTelemetry(value);
  if (result.redactions.length) throw new TypeError('Unsafe control evidence');
  return snapshotControlJson(result.value);
};
const token = (kind, value) => `${kind}_${hash(value)}`;

export class CreativeControlsAdapter {
  /** readContext MUST synchronously read authoritative current records and host
   * policy. In this adapter composition is deliberately unavailable: CE06 must
   * provide a durable zero-image consumer before that route can complete. */
  constructor({ path, ports, readContext, now = () => Date.now() }) {
    if (typeof readContext !== 'function' || !['begin', 'get', 'cancel', 'authorizeDispatch', 'completeIfActive'].every(key => typeof ports?.jobs?.[key] === 'function') || typeof ports?.storage?.getDesignVersion !== 'function') throw new TypeError('Required public controls integration ports unavailable');
    this.readContext = readContext; this.now = now; this.inflight = new Map();
    this.store = new ApplyStore(path, principal => this.projection(principal));
    this.db = this.store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS control_api_bindings_v1 (
      operation_id TEXT PRIMARY KEY REFERENCES control_jobs(operation_id),
      action_id TEXT NOT NULL UNIQUE, request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
      job_id TEXT, backend_request_hash TEXT, result_json TEXT, design_hash TEXT, values_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS control_adapter_meta_v1 (version INTEGER NOT NULL);
      INSERT INTO control_adapter_meta_v1 SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM control_adapter_meta_v1);`);
    if (this.db.prepare('SELECT version FROM control_adapter_meta_v1').get().version !== 1) throw new TypeError('Unsupported controls adapter migration');
    this.ports = ports;
    const guarded = { ...ports, jobs: { ...ports.jobs,
      begin: async input => {
        if (this.db.isTransaction) throw new TypeError('Controls database transaction unavailable');
        const result = await ports.jobs.begin(input);
        if (this.db.isTransaction) throw new TypeError('Controls database transaction unavailable');
        const binding = this.db.prepare('SELECT operation_id FROM control_api_bindings_v1 WHERE action_id=?').get(input.action_id);
        if (binding && result.kind !== 'conflict') {
          const jobId = result.kind === 'started' ? result.job_id : result.job.job_id;
          this.db.prepare('UPDATE control_api_bindings_v1 SET job_id=?,backend_request_hash=? WHERE operation_id=?').run(jobId, input.request_hash, binding.operation_id);
          // Cancellation can win while the underlying begin port is awaited.
          if (!this.guard(binding.operation_id)) await this.cancelBackend(input.scope, input.actor_id, binding.operation_id);
        }
        return result;
      },
      authorizeDispatch: async input => {
        const binding = this.db.prepare('SELECT operation_id FROM control_api_bindings_v1 WHERE action_id=?').get(input.action_id);
        if (binding && !this.guard(binding.operation_id)) return { status: 'stale_context' };
        const result = await ports.jobs.authorizeDispatch(input);
        return binding && !this.guard(binding.operation_id) ? { status: 'stale_context' } : result;
      },
      completeIfActive: async (input, publish) => {
        const binding = this.db.prepare('SELECT operation_id FROM control_api_bindings_v1 WHERE action_id=?').get(input.action_id);
        if (binding && !this.guard(binding.operation_id)) return { status: 'stale_context' };
        return ports.jobs.completeIfActive(input, async transaction => {
          if (binding && !this.guard(binding.operation_id)) throw new TypeError('Control context no longer current');
          const authority = binding ? this.publicationAuthority(binding.operation_id) : null;
          const result = await publish(transaction);
          // The actual paired jobs port owns the outer transaction. A changed
          // authority after awaited storage work throws before that port commits,
          // so provisional metadata/selection remain invisible after rollback.
          if (binding && (authority === null || authority !== this.publicationAuthority(binding.operation_id))) throw new TypeError('Control authority changed during publication');
          return result;
        });
      },
    } };
    this.api = createCreativeApi({ ports: guarded, now });
  }
  close() { this.store.close(); }
  context(principal) {
    const input = snapshotControlJson(principal);
    const context = safe(this.readContext(input));
    const { brief, design, selection } = context;
    if (!brief || brief.tenant_id !== input.tenant_id || brief.project_id !== input.project_id ||
      !design || design.brief_id !== brief.brief_id || design.tenant_id !== input.tenant_id || design.project_id !== input.project_id ||
      context.actor.actor_id !== input.actor_id || context.actor.tenant_id !== input.tenant_id || context.actor.project_id !== input.project_id ||
      !selection || selection.design_version_id !== design.design_version_id || selection.design_hash !== design.design_hash) throw new TypeError('Missing current creative context');
    return context;
  }
  projection(principal) {
    const current = this.context(principal), { brief, design, selection, policy } = current;
    const values = { ...baseline };
    for (const item of brief.preferences.items) if (fields.includes(item.preference_id) && typeof item.value === 'string') values[item.preference_id] = item.value;
    const binding = this.db.prepare('SELECT values_json FROM control_api_bindings_v1 WHERE design_hash=? AND result_json IS NOT NULL ORDER BY rowid DESC LIMIT 1').get(design.design_hash);
    if (binding) Object.assign(values, JSON.parse(binding.values_json));
    const locks = brief.locks.items.map(item => item.field).filter(field => fields.includes(field));
    const permitted = brief.permissions.items.filter(item => item.action === 'reproduce' && item.status === 'granted' && policy.permitted_asset_ids.includes(item.asset_id)).map(item => item.asset_id);
    const schema = createControlSchema({ tenant_id: brief.tenant_id, project_id: brief.project_id, brief_id: brief.brief_id,
      versions: { brief: token('brief', canonicalHash(brief)), design: token('selection', selection), composition: token('composition', current.composition) },
      available_operations: policy.available_operations, values, allowed_options: policy.allowed_options ?? options,
      locks: locks.filter(field => field !== 'layout_emphasis'), follow_up_locks: locks.includes('layout_emphasis') ? ['q01'] : [],
      follow_up_answers: { q01: values.layout_emphasis },
      ...(permitted.includes(policy.logo_asset_id) ? { logo_asset_id: policy.logo_asset_id } : {}) });
    return { schema, supported_schema_versions: SCHEMA_VERSIONS,
      can_apply: current.brief_usable === true && policy.can_apply === true && current.actor.permissions.includes('creative.edit') && Date.parse(current.actor.expires_at) > this.now(),
      can_read: policy.can_read !== false && current.actor.permissions.includes('creative.read') && Date.parse(current.actor.expires_at) > this.now(),
      can_acknowledge: true, permitted_asset_ids: permitted,
      dispatchable_routes: policy.available_operations.includes('artwork.edit') ? ['artwork.edit'] : [] };
  }
  guard(operationId) {
    const job = this.db.prepare('SELECT actor_id,tenant_id,project_id FROM control_jobs WHERE operation_id=?').get(operationId);
    if (!job) return false;
    return this.store.dispatch(job, operationId).ok;
  }
  publicationAuthority(operationId) {
    const row = this.db.prepare('SELECT actor_id,tenant_id,project_id,status FROM control_jobs WHERE operation_id=?').get(operationId);
    if (!row || row.status !== 'ready') return null;
    const current = this.context({ actor_id: row.actor_id, tenant_id: row.tenant_id, project_id: row.project_id });
    if (!current.brief_usable || !current.policy.can_apply || !current.actor.permissions.includes('creative.edit') || Date.parse(current.actor.expires_at) <= this.now()) return null;
    return hash({ brief_hash: canonicalHash(current.brief), composition: current.composition, policy: current.policy, actor: current.actor });
  }
  request(current, operation, task) {
    const { brief, design } = current, now = new Date(this.now()).toISOString();
    const envelope = { schema_version: '1.0', tenant_id: brief.tenant_id, project_id: brief.project_id,
      event_id: `event:${operation.logical_operation_id}`, correlation_id: operation.logical_operation_id,
      producer: 'creative-controls-local-adapter/1', occurred_at: now, ingested_at: now,
      environment: brief.environment, billing_mode: brief.billing_mode, source_refs: brief.source_identity.map(item => item.source_id) };
    const instruction = task.changes.map(change => `Set ${change.field} to ${change.value}.`).join(' ') + ' Preserve verified facts, approved assets and locked fields.';
    const plan = { ...envelope, contract: 'EditPlan', plan_id: `plan:${operation.logical_operation_id}`,
      base: { brief_hash: canonicalHash(brief), design_hash: design.design_hash, design_version_id: design.design_version_id },
      operation: 'image.edit', steps: [{ step_id: `step:${operation.logical_operation_id}`, action: 'image.edit', source_refs: [],
        parameters: { design_version_id: design.design_version_id, artifact_id: design.artifact.artifact_id, instruction } }],
      expected_result: { contract: 'DesignVersion', schema_version: '1.0', parent_version_id: design.design_version_id, artifact_kind: 'image' }, invalidates: [] };
    return { ...envelope, contract: 'CreativeApiRequest', request_id: `request:${operation.logical_operation_id}`,
      operation: 'edit', action_id: `controls:${operation.logical_operation_id}`,
      payload: { brief_id: brief.brief_id, design_version_id: design.design_version_id, plan, selection_mode: 'advance' } };
  }
  async apply(principal, body) { return this.applyInternal(principal, body, false); }
  async applyInternal(principal, body, reviewedArtwork) {
    // Keep one own-data principal across awaits; caller mutation cannot alter
    // the scope of persisted work or subsequent public-port reads.
    try { principal = snapshotControlJson(principal); } catch { return { ok: false, code: 'permission' }; }
    const accepted = reviewedArtwork ? this.store.applyReviewedArtwork(principal, body) : this.store.apply(principal, body);
    if (!accepted.ok) return accepted;
    const operationId = accepted.operation_id;
    const key = canonical([principal.tenant_id, principal.project_id, operationId]);
    if (this.inflight.has(key)) return this.inflight.get(key);
    const running = this.consume(principal, operationId, accepted.replayed === true);
    this.inflight.set(key, running);
    try { return await running; } finally { this.inflight.delete(key); }
  }
  async applyReviewedArtwork(principal, input) {
    try {
      principal = snapshotControlJson(principal); const body = snapshotControlJson(input);
      await this.applyInternal(principal, body, true);
      return this.artworkRecovery(principal, body.action_id, true);
    } catch { return null; }
  }
  readArtworkAction(principal, actionId) { return this.artworkRecovery(principal, actionId, false); }
  async retryArtworkAction(principal, actionId) {
    try {
      principal = snapshotControlJson(principal);
      const outcome = await this.artworkRecovery(principal, actionId, true);
      if (!outcome || outcome.recovery !== 'unknown') return outcome;
      const row = this.artworkRow(principal, actionId);
      if (!row) return outcome;
      await this.applyInternal(principal, JSON.parse(row.payload), true);
      return this.artworkRecovery(principal, actionId, true);
    } catch { return null; }
  }
  artworkRow(principal, actionId) {
    if (this.db.isTransaction || !this.projection(principal).can_read) throw new TypeError('Artwork recovery unavailable');
    const row = this.db.prepare('SELECT * FROM control_jobs WHERE tenant_id=? AND project_id=? AND actor_id=? AND action_id=?')
      .get(principal.tenant_id, principal.project_id, principal.actor_id, actionId);
    if (!row) return null;
    const payload = snapshotControlJson(JSON.parse(row.payload)), operation = snapshotControlJson(JSON.parse(row.operation));
    const tasks = [{ kind: 'artwork.edit', changes: [{ field: 'style', value: payload.draft.selections.c04 }] }];
    if (hash(payload) !== row.action_hash || payload.action_id !== actionId || payload.tenant_id !== principal.tenant_id || payload.project_id !== principal.project_id ||
        operation.action_id !== actionId || operation.actor_id !== principal.actor_id || operation.tenant_id !== principal.tenant_id || operation.project_id !== principal.project_id ||
        operation.brief_id !== payload.brief_id || operation.draft_hash !== payload.draft_hash || operation.control_schema_hash !== payload.control_schema_hash ||
        canonical(operation.expected_versions) !== canonical(payload.expected_versions) || canonical(operation.tasks) !== canonical(tasks) ||
        projectApplyResult({ ok: true, code: 'ready', status: 'ready', operation_id: row.operation_id, operation }).status !== 'ready') throw new TypeError('Corrupt artwork action');
    return row;
  }
  async artworkRecovery(principal, actionId, reconcile) {
    try {
      principal = snapshotControlJson(principal);
      if (this.db.isTransaction || !this.projection(principal).can_read) return null;
      const identity = { tenant_id: principal.tenant_id, project_id: principal.project_id, action_id: actionId };
      const response = fields => assertArtworkRecovery({ contract: 'CreativeArtworkActionRecovery', schema_version: ARTWORK_RECOVERY_VERSION,
        ...identity, approval: false, purchase: false, ...fields }, identity);
      const negative = this.store.nonAdmission(principal, actionId);
      if (negative) return response({ ok: false, code: negative.code, status: 'rejected', recovery: 'not_admitted' });
      const row = this.artworkRow(principal, actionId);
      const unknown = references => response({ ok: false, code: 'unavailable', status: 'unknown', recovery: 'unknown', ...references });
      if (!row) return unknown({});
      const binding = this.db.prepare('SELECT * FROM control_api_bindings_v1 WHERE operation_id=?').get(row.operation_id);
      if (!binding) return unknown({ operation_id: row.operation_id });
      const request = snapshotControlJson(JSON.parse(binding.request_json));
      if (canonicalHash(request) !== binding.request_hash || request.action_id !== binding.action_id || request.action_id !== `controls:${row.operation_id}` ||
          request.operation !== 'edit' || request.tenant_id !== principal.tenant_id || request.project_id !== principal.project_id || request.payload.brief_id !== JSON.parse(row.payload).brief_id) throw new TypeError('Corrupt artwork binding');
      if (!binding.job_id) return unknown({ operation_id: row.operation_id });
      const job = await this.ports.jobs.get({ scope: principal, job_id: binding.job_id });
      const latest = this.artworkRow(principal, actionId);
      const currentBinding = this.db.prepare('SELECT * FROM control_api_bindings_v1 WHERE operation_id=?').get(row.operation_id);
      if (!latest || latest.action_hash !== row.action_hash || !currentBinding ||
          ['request_json', 'request_hash', 'action_id', 'job_id', 'backend_request_hash'].some(k => currentBinding[k] !== binding[k])) throw new TypeError('Changed artwork binding');
      if (!job) return unknown({ operation_id: row.operation_id });
      if (job.tenant_id !== principal.tenant_id || job.project_id !== principal.project_id || job.actor_id !== principal.actor_id || job.job_id !== binding.job_id ||
          job.operation !== 'edit' || job.action_id !== binding.action_id || job.request_hash !== binding.backend_request_hash) throw new TypeError('Wrong artwork job');
      const references = { operation_id: row.operation_id, backend_job_id: job.job_id };
      if (job.status === 'completed' && latest.status === 'completed' && currentBinding.result_json) {
        const result = projectApplyResult(await this.consume(principal, row.operation_id, true, true));
        if (!this.projection(principal).can_read || result.status !== 'completed' || !result.result) return null;
        return response({ ok: true, code: 'completed', status: 'completed', recovery: 'terminal', ...references, result: result.result });
      }
      if (['failed', 'cancelled'].includes(job.status)) {
        // Only an explicit Apply/retry reconciles the local outbox. A read never
        // writes an acknowledgement or changes an admitted operation's status.
        if (reconcile && ['queued', 'ready'].includes(latest.status)) {
          this.db.prepare("UPDATE control_jobs SET status=? WHERE operation_id=? AND tenant_id=? AND project_id=? AND actor_id=? AND action_hash=? AND status IN ('queued','ready')")
            .run(job.status, row.operation_id, principal.tenant_id, principal.project_id, principal.actor_id, row.action_hash);
        }
        const status = this.artworkRow(principal, actionId)?.status;
        if (status === job.status) return response({ ok: false, code: job.status, status: job.status, recovery: 'terminal', ...references });
      }
      return unknown(references);
    } catch { return null; }
  }
  async consume(principal, operationId, replayed, readOnly = false) {
    try {
      let binding = this.db.prepare('SELECT * FROM control_api_bindings_v1 WHERE operation_id=?').get(operationId);
      if (readOnly && !binding) throw new TypeError('Original control binding unavailable');
      if (!binding) {
        const ready = this.store.dispatch(principal, operationId);
        if (!ready.ok) {
          const stored = this.db.prepare('SELECT operation FROM control_jobs WHERE operation_id=?').get(operationId);
          const tasks = stored ? JSON.parse(stored.operation).tasks : [];
          return { ...ready, ...(ready.code === 'unavailable' && tasks.some(task => task.kind === 'composition.update') ?
            { pending_bridge: tasks.length > 1 ? 'creative.compound.consume/1' : 'creative.composition.consume/1' } : {}) };
        }
        const operation = ready.operation;
        if (operation.tasks.length !== 1 || operation.tasks[0].kind !== 'artwork.edit') return { ok: false, code: 'unavailable', operation_id: operationId, pending_bridge: 'creative.compound.consume/1' };
        const current = this.context(principal), request = safe(this.request(current, operation, operation.tasks[0]));
        const values = { ...baseline };
        const sourceSchema = this.projection(principal).schema;
        for (const control of sourceSchema.controls) values[control.field] = control.default_value;
        for (const question of sourceSchema.follow_up_questions) values[question.field] = question.default_value;
        for (const change of operation.tasks[0].changes) values[change.field] = change.value;
        this.db.prepare('INSERT INTO control_api_bindings_v1(operation_id,action_id,request_json,request_hash,values_json) VALUES(?,?,?,?,?)')
          .run(operationId, request.action_id, canonical(request), canonicalHash(request), canonical(values));
        binding = this.db.prepare('SELECT * FROM control_api_bindings_v1 WHERE operation_id=?').get(operationId);
      }
      const current = this.context(principal);
      const persistedRequest = safe(JSON.parse(binding.request_json));
      if (canonicalHash(persistedRequest) !== binding.request_hash || persistedRequest.action_id !== binding.action_id || persistedRequest.tenant_id !== principal.tenant_id || persistedRequest.project_id !== principal.project_id) throw new TypeError('Corrupt controls API binding');
      const completion = this.db.prepare('SELECT * FROM control_completions WHERE operation_id=?').get(operationId);
      // Completed replay is a scoped historical read, not another edit request.
      // Keep the original publication receipt even after a later edit/restore.
      const historical = completion && binding.result_json;
      if (completion && !historical) throw new TypeError('Missing original backend completion');
      if (readOnly && !historical) throw new TypeError('Original control completion unavailable');
      if (historical && !this.projection(principal).can_read) return { ok: false, code: 'permission', operation_id: operationId };
      const response = historical ? safe(JSON.parse(binding.result_json)) : await this.api.invoke(current.actor, persistedRequest);
      if (this.db.isTransaction) throw new TypeError('Controls database transaction unavailable');
      if (!response.ok) return { ok: false, code: response.error.code === 'permission_denied' ? 'permission' : response.error.code,
        operation_id: operationId, backend_error: response.error, replayed,
        ...this.#backendIdentity(principal, operationId),
        ...(['stale_version', 'conflict'].includes(response.error.code) && this.projection(principal).can_apply ? { current_versions: this.projection(principal).schema.expected_versions } : {}) };
      const jobId = response.job?.job_id ?? binding.job_id;
      const job = await this.ports.jobs.get({ scope: principal, job_id: jobId });
      if (this.db.isTransaction) throw new TypeError('Controls database transaction unavailable');
      if (historical && !this.projection(principal).can_read) return { ok: false, code: 'permission', operation_id: operationId };
      if (job?.status !== 'completed' || !response.result?.design_version || job.action_id !== binding.action_id || job.request_hash !== this.db.prepare('SELECT backend_request_hash FROM control_api_bindings_v1 WHERE operation_id=?').get(operationId).backend_request_hash) {
        return { ok: false, code: 'unavailable', operation_id: operationId, backend_job_id: jobId, status: 'unknown' };
      }
      const design = safe(response.result.design_version);
      if (design.logical_operation_id !== binding.action_id || design.parent_version_id !== persistedRequest.payload.design_version_id || design.brief_id !== persistedRequest.payload.brief_id) throw new TypeError('Backend design/action identity mismatch');
      if (!job.result?.design || canonicalHash(job.result.design) !== canonicalHash(design)) throw new TypeError('Backend job/result mismatch');
      const persisted = await this.ports.storage.getDesignVersion({ scope: principal, brief_id: design.brief_id, design_version_id: design.design_version_id });
      if (this.db.isTransaction) throw new TypeError('Controls database transaction unavailable');
      if (!persisted || canonicalHash(persisted) !== canonicalHash(design)) throw new TypeError('Backend result mismatch');
      if (historical && !this.projection(principal).can_read) return { ok: false, code: 'permission', operation_id: operationId };
      // Only trusted durable consumer state can populate completion; public callers
      // cannot submit a receipt or a completed version string to this adapter.
      if (!historical) this.db.prepare('UPDATE control_api_bindings_v1 SET result_json=?,design_hash=?,job_id=? WHERE operation_id=?')
        .run(canonical(safe(response)), design.design_hash, jobId, operationId);
      const receipt = historical ? safe(JSON.parse(completion.receipt)) : {
        completion_id: `completion:${jobId}`, result_ref: design.design_version_id,
        applied_versions: this.projection(principal).schema.expected_versions };
      if (historical && (hash(receipt) !== completion.completion_hash || receipt.completion_id !== `completion:${jobId}` || receipt.result_ref !== design.design_version_id)) throw new TypeError('Corrupt original control completion');
      const acknowledged = readOnly ? { ok: true, code: 'replayed', operation_id: operationId, status: 'completed', replayed: true } : this.store.acknowledge(principal, operationId, receipt);
      if (!acknowledged.ok) return acknowledged;
      return { ...acknowledged, replayed: replayed || response.replayed === true,
        backend_job_id: jobId, backend_operation_id: response.operation_id, result: safe(response.result),
        action_id: binding.action_id, request_hash: binding.request_hash, approval: false, purchase: false };
    } catch {
      return { ok: false, code: 'unavailable', operation_id: operationId, retryable: true, status: 'unknown', ...this.#backendIdentity(principal, operationId) };
    }
  }
  #backendIdentity(principal, operationId) {
    try {
      if (this.db.isTransaction || !this.projection(principal).can_read) return {};
      const row = this.db.prepare(`SELECT b.job_id,b.action_id,b.request_hash FROM control_api_bindings_v1 b
        JOIN control_jobs c ON c.operation_id=b.operation_id
        WHERE b.operation_id=? AND c.actor_id=? AND c.tenant_id=? AND c.project_id=?`)
        .get(operationId, principal.actor_id, principal.tenant_id, principal.project_id);
      // A jobs.begin callback persists this identity before downstream work. It
      // proves an existing durable job, never dispatch, completion or settlement.
      return row?.job_id ? safe({ backend_job_id: row.job_id, action_id: row.action_id, request_hash: row.request_hash }) : {};
    } catch { return {}; }
  }
  async cancelBackend(scope, actorId, operationId) {
    const binding = this.db.prepare('SELECT * FROM control_api_bindings_v1 WHERE operation_id=?').get(operationId);
    if (!binding?.job_id) return;
    const job = await this.ports.jobs.get({ scope, job_id: binding.job_id });
    if (!job || job.status === 'completed' || job.status === 'cancelled') return;
    await this.ports.jobs.cancel({ scope, actor_id: actorId, job_id: binding.job_id, target_action_id: binding.action_id,
      action_id: `cancel:${operationId}`, request_hash: canonicalHash({ operation_id: operationId, intent: 'cancel' }) });
  }
  async retryExisting(principal, actionId) {
    try {
      principal = snapshotControlJson(principal);
      if (!this.projection(principal).can_read) return { ok: false, code: 'permission' };
      const row = this.db.prepare('SELECT * FROM control_jobs WHERE tenant_id=? AND project_id=? AND actor_id=? AND action_id=?')
        .get(principal.tenant_id, principal.project_id, principal.actor_id, actionId);
      if (!row) return { ok: false, code: 'unavailable', status: 'unknown' };
      const payload = snapshotControlJson(JSON.parse(row.payload));
      if (hash(payload) !== row.action_hash || payload.action_id !== actionId) throw new TypeError('Corrupt original action');
      return this.apply(principal, payload);
    } catch { return { ok: false, code: 'unavailable', status: 'unknown' }; }
  }
  async readExisting(principal, actionId) {
    try {
      principal = snapshotControlJson(principal);
      if (!this.projection(principal).can_read) return { ok: false, code: 'permission' };
      const row = this.db.prepare('SELECT j.operation_id,j.status,b.result_json FROM control_jobs j LEFT JOIN control_api_bindings_v1 b ON b.operation_id=j.operation_id WHERE j.tenant_id=? AND j.project_id=? AND j.actor_id=? AND j.action_id=?')
        .get(principal.tenant_id, principal.project_id, principal.actor_id, actionId);
      if (!row) return { ok: false, code: 'unavailable', status: 'unknown' };
      // Pending status never invokes the producer. A completed cached binding is
      // verified through the original historical read path before presentation.
      if (row.status === 'completed' && row.result_json) return this.consume(principal, row.operation_id, true, true);
      return { ok: true, code: 'replayed', status: row.status, operation_id: row.operation_id, acknowledgment_only: true, approval: false, purchase: false };
    } catch { return { ok: false, code: 'unavailable', status: 'unknown' }; }
  }
  lookup(principal, actionId) {
    const ctx = snapshotControlJson(principal);
    const row = this.db.prepare('SELECT operation_id,status FROM control_jobs WHERE tenant_id=? AND project_id=? AND actor_id=? AND action_id=?')
      .get(ctx.tenant_id, ctx.project_id, ctx.actor_id, actionId);
    return row ? { ...row } : null;
  }
  async cancel(principal, operationId) {
    try { principal = snapshotControlJson(principal); } catch { return { ok: false, code: 'permission' }; }
    if (typeof operationId !== 'string') return { ok: false, code: 'validation' };
    const owned = this.db.prepare('SELECT operation_id FROM control_jobs WHERE operation_id=? AND actor_id=? AND tenant_id=? AND project_id=?').get(operationId, principal.actor_id, principal.tenant_id, principal.project_id);
    if (!owned) return { ok: false, code: 'permission' };
    const binding = this.db.prepare('SELECT job_id FROM control_api_bindings_v1 WHERE operation_id=?').get(operationId);
    if (binding?.job_id) {
      const job = await this.ports.jobs.get({ scope: principal, job_id: binding.job_id });
      if (job?.status === 'completed') return { ok: false, code: 'already_completed', operation_id: operationId };
    }
    const result = this.store.cancel(principal, operationId);
    if (result.ok) await this.cancelBackend(principal, principal.actor_id, operationId);
    return result;
  }
}
