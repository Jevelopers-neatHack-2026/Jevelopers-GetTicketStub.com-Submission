/** Explicit MOCK host authority and intercepted provider/Finance transport.
 * Actual public planning/API/version/telemetry modules run against local SQLite.
 * This fixture authenticates no real membership and uses no credentials/network. */
import { join } from 'node:path';
import { createCreativeApi } from 'creative-engine/api/v1';
import { CreativeVersionStore, createCreativeVersionApiPorts } from 'creative-engine/versions';
import { createSqliteTelemetryOutbox } from 'creative-engine/telemetry';
import { canonicalHash } from 'creative-engine/contracts';
import { completeResearchPackage } from '../planning/research-packages.mjs';
import { CreativeControlsAdapter } from '../../src/controls/integration.mjs';
import { InspectionControlsAdapter } from '../../src/controls/inspection-integration.mjs';
import { attachOfflineInspection } from './offline-inspection-ports.mjs';
import { nativeImagePorts } from './native-image-ports.mjs';
import { validId } from '../../src/controls/schema.mjs';
import { CompositionControlsAdapter } from '../../src/controls/composition-integration.mjs';
import { attachOfflineComposition, fixtureLogoHash } from './offline-composition-ports.mjs';
import { fixtureCompositionPolicy } from './composition-policy.mjs';

export const fixturePrincipal = Object.freeze({ actor_id: 'fixture_actor', tenant_id: 'fixture_tenant', project_id: 'fixture_project' });
const NOW = Date.parse('2026-10-10T12:30:00.000Z');
const hostActor = principal => ({ ...principal, expires_at: '2026-10-11T00:00:00.000Z',
  permissions: ['creative.generate', 'creative.inspect', 'creative.edit', 'creative.read', 'creative.restore', 'creative.cancel', 'creative.brief.create', 'creative.brief.invalidate'],
  budget_scope_id: 'fixture_budget', budget_policy_version: 'fixture-budget-policy/1' });
const hostEnvelope = (action, principal) => ({ contract: 'CreativeApiRequest', schema_version: '1.0', event_id: `event:${action}`,
  request_id: `request:${action}`, tenant_id: principal.tenant_id, project_id: principal.project_id, correlation_id: `correlation:${action}`, producer: 'controls-mock-host/1',
  occurred_at: new Date(NOW).toISOString(), ingested_at: new Date(NOW).toISOString(), environment: 'test', billing_mode: 'simulated', source_refs: [], action_id: action });

export async function createIntegratedHost(directory, { principal = fixturePrincipal, lockLogo = true, enableComposition = false, nativeFormat = 'png', preferences = [{ preference_id: 'style', value: 'calm' }, { preference_id: 'name_size', value: 'medium' }, { preference_id: 'layout', value: 'centered' }] } = {}) {
  const fixturePrincipal = Object.freeze({ ...principal });
  const actor = () => hostActor(fixturePrincipal), envelope = action => hostEnvelope(action, fixturePrincipal);
  let host, released, closed=false; let clock = NOW;
  const counters = { image_calls: 0, jev_calls: 0, reservations: 0, releases: 0, holds: 0, bootstrap_image_calls: 0, publication_waits: 0, transport_acks: 0, observer_calls: 0, independent_decision_calls: 0, dependent_choice_calls: 0, independent_questions: 0, dependent_questions: 0, inspection_usage_observations: 0, observer_sends:0, independent_decision_sends:0, dependent_choice_sends:0 };
  const policy = { can_apply: true, available_operations: ['composition.update', 'artwork.edit'], permitted_asset_ids: ['asset-1'], logo_asset_id: 'asset-1' };
  if (enableComposition) Object.assign(counters, { composition_resolves: 0, composition_previews: 0, composition_assertions: 0 });
  const currentActor = () => {
    const value = actor();
    if (policy.can_inspect === false) value.permissions = value.permissions.filter(permission => permission !== 'creative.inspect');
    if (policy.actor_expired) value.expires_at = '2026-10-10T00:00:00.000Z';
    if (policy.can_read === false) value.permissions = value.permissions.filter(permission => permission !== 'creative.read');
    return value;
  };
  const store = new CreativeVersionStore({ databasePath: join(directory, 'creative.sqlite'), objectRoot: join(directory, 'objects'), now: () => clock });
  let gate = null, gateKind, waiting;
  const wait = async kind => { if (gateKind === kind) { waiting=kind;try{await gate;}finally{waiting=undefined;} } };
  let brief;
  const reservations = new Map(), acknowledgedTransports=new Set(), inspectionTransportStages=new Map();
  const native = nativeImagePorts({ store, getBrief: () => brief, counters, policy, reservations, wait, now: () => clock, format: nativeFormat });
  const research = { ...completeResearchPackage(), tenant_id: fixturePrincipal.tenant_id, project_id: fixturePrincipal.project_id };
  research.permissions.items.push({ asset_id: 'asset-1', action: 'modify', status: 'granted', evidence_refs: ['page-1'] });
  if (enableComposition) {
    research.assets.items[0].content_hash = fixtureLogoHash;
    research.permissions.items.push({ asset_id: 'asset-1', action: 'display', status: 'granted', evidence_refs: ['page-1'] });
  }
  if (lockLogo) research.locks.items.push({ lock_id: 'fixture-logo-lock', field: 'logo_position', value_hash: canonicalHash('top'), reason: 'Declared fixture source lock' });
  const invalidations = new Map();
  const adapted = createCreativeVersionApiPorts({ store, otherPorts: {
    provider: { ...native.provider },
    metering: {
      async reserveAttempt(input) { counters.reservations += 1; counters.holds += 1; await wait('reservation');
        const value = { status: 'reserved', reservation_id: `reservation:${input.billable_attempt_id}`, billable_attempt_id: input.billable_attempt_id,
          held_amount: { amount: '1.00', currency: 'USD' }, lease_id: `finance-lease:${input.billable_attempt_id}` };
        reservations.set(value.reservation_id, { ...value, status: 'held' }); return value; },
      async releaseBeforeDispatch(input) { counters.releases += 1; counters.holds -= 1; if (reservations.has(input.reservation_id)) reservations.get(input.reservation_id).status = 'released'; return { status: 'released' }; },
      async markAttemptInFlight(input) { return { status: 'in_flight', reservation_id: input.reservation_id }; },
      async recordTransportAttempt(input) { counters.transport_acks += 1; acknowledgedTransports.add(input.transport_attempt_id); await wait('finance-ack'); return { status: 'recorded', transport_attempt_id: input.transport_attempt_id }; },
      async recordUsageObservation(input) { return { status: 'accepted', source_observation_id: input.observation.source_observation_id, effective_billable_attempt_id: input.observation.billable_attempt_id }; },
      async settleReservation(input) { counters.holds -= 1; if (reservations.has(input.reservation_id)) reservations.get(input.reservation_id).status = 'settled'; return { status: 'settled', reservation_id: input.reservation_id, consumed_amount: { amount: '0.10', currency: 'USD' }, released_unused_amount: { amount: '0.90', currency: 'USD' } }; },
      async markOutcomeUnknown() { return { status: 'held_for_reconciliation' }; },
    },
    planning: { assetPermissionVerifier: { async verifyAssetUse(input) { await wait('rights'); return { ...input, status: policy.permitted_asset_ids.includes(input.asset_id) ? 'granted' : 'denied', owner_evidence_status: 'verified', evidence_ref: 'fixture:MOCK-rights-authority', checked_at: input.now, expires_at: new Date(clock + (policy.rights_ttl_ms ?? 60000)).toISOString() }; } }, getCurrentResearchPackage: () => research, getInvalidationEvent: ({ event_id }) => invalidations.get(event_id),
      invalidationVerifier: { async verifyInvalidation({ event, trusted_scope }) { return { status: 'verified', classification: 'synthetic_test', evidence_ref: 'fixture:mock-owner-authority', event_hash: event.content_hash, event_id: event.event_id,
        ...trusted_scope, verified_at: new Date(NOW).toISOString(), valid_until: '2026-10-10T12:31:00.000Z' }; } } },
  } });
  const ports = adapted.ports;
  const commitPrepared = ports.storage.commitPreparedDesignVersion;
  ports.storage.commitPreparedDesignVersion = async (...args) => { if (gateKind === 'publication') counters.publication_waits += 1; await wait('publication'); return commitPrepared(...args); };
  ports.telemetry = { outbox: createSqliteTelemetryOutbox({ database: store.db, clock: () => clock }), modes: { provider_execution_mode: 'mock', commerce_mode: 'simulated' },
    usage_profiles: { image_generation: 'creative.normalized-token-usage/1', image_edit: 'creative.normalized-token-usage/1', vision_observation: 'creative.normalized-token-usage/1', jev_decision: 'typesafe.systemone-usage/2026-10-10' },
    usage_profile_authority: native.usageAuthority };
  attachOfflineInspection(ports, { counters, policy, wait });
  // This declared MOCK host supplies current membership authority through the
  // backend's existing final synchronous owner boundary. It issues no rights.
  const currentAuthority = input => {
    const operation = store.db.prepare('SELECT operation FROM creative_jobs WHERE job_id=?').get(input.job_id)?.operation;
    const active = currentActor(), permission = operation === 'inspect' ? 'creative.inspect' : operation === 'edit' ? 'creative.edit' : null;
    return !permission || (active.permissions.includes(permission) && Date.parse(active.expires_at) > clock &&
      (operation !== 'edit' || policy.can_apply));
  };
  const authorize = ports.jobs.authorizeDispatch, assertCurrent = ports.jobs.assertDispatchCurrent, complete = ports.jobs.completeIfActive;
  ports.jobs.authorizeDispatch = async input => {
    if (!currentAuthority(input)) return { status: 'stale_context' };
    const result = await authorize(input); await wait('owner-authorize');
    if(input.operation==='inspect'){
      let stage=inspectionTransportStages.get(input.transport_attempt_id);
      if(!stage){stage=input.provider_name==='controls-mock-vision'?'observer':counters.independent_decision_calls===0?'evidence':'route';inspectionTransportStages.set(input.transport_attempt_id,stage);}
      await wait(`inspection-owner-${stage}`);
      if(acknowledgedTransports.has(input.transport_attempt_id)){const entered=stage==='observer'?counters.observer_calls>0:stage==='evidence'?counters.independent_decision_calls>0:counters.dependent_choice_calls>0;await wait(`inspection-${entered?'send':'postack'}-${stage}`);}
    }
    return currentAuthority(input) ? result : { status: 'stale_context' };
  };
  ports.jobs.assertDispatchCurrent = input => currentAuthority(input) ? assertCurrent(input) : { status: 'stale_context' };
  ports.jobs.completeIfActive = (input, publish) => {
    if (!currentAuthority(input)) return { status: 'stale_context' };
    return complete(input, async transaction => {
      if (!currentAuthority(input)) throw new TypeError('Fixture authority revoked');
      const value = await publish(transaction);
      if (!currentAuthority(input)) throw new TypeError('Fixture authority revoked');
      return value;
    });
  };
  const api = createCreativeApi({ ports, now: () => clock });
  const existing = store.db.prepare('SELECT brief_id FROM creative_briefs WHERE tenant_id=? AND project_id=?').get(fixturePrincipal.tenant_id, fixturePrincipal.project_id);
  if (existing) brief = store.getBrief({ scope: fixturePrincipal, brief_id: existing.brief_id });
  else {
    const response = await api.invoke(currentActor(), { ...envelope('fixture-bootstrap-brief'), operation: 'brief.create', payload: {
      customer_preferences: preferences } });
    if (!response.ok) throw new Error(`Fixture brief initialization failed: ${JSON.stringify(response.error)}`);
    brief = response.result.brief;
  }
  const scope = { ...fixturePrincipal, brief_id: brief.brief_id };
  if (!store.getCurrentDesignVersion({ scope, brief_id: brief.brief_id })) {
    const env = envelope('fixture-bootstrap-artwork'); delete env.actor_id; delete env.action_id; delete env.request_id; delete env.contract;
    const plan = { ...env, contract: 'EditPlan', plan_id: 'fixture-bootstrap-plan', base: { brief_hash: canonicalHash(brief), design_hash: canonicalHash({ contract: 'DesignRoot', schema_version: '1.0', brief_id: brief.brief_id }) },
      operation: 'concept.generate', steps: [{ step_id: 'fixture-bootstrap-step', action: 'concept.generate', source_refs: [], parameters: { brief_id: brief.brief_id, variant_count: 1 } }],
      expected_result: { contract: 'DesignVersion', schema_version: '1.0', parent_version_id: `root:${brief.brief_id}`, artifact_kind: 'image' }, invalidates: [] };
    const response = await api.invoke(currentActor(), { ...envelope('fixture-bootstrap-artwork'), operation: 'generate', payload: { brief_id: brief.brief_id, plan } });
    if (!response.ok) throw new Error(`Fixture artwork initialization failed: ${JSON.stringify(response.error)}`);
    counters.bootstrap_image_calls = counters.image_calls; counters.image_calls = 0; counters.reservations = 0; counters.transport_acks = 0;
  }
  if (enableComposition) attachOfflineComposition(ports, { store, policy, counters, wait, now: () => clock });
  let adapter, inspection, composition;
  const readContext = () => {
    const current = store.getBrief({ scope, brief_id: brief.brief_id });
    return { brief: current, selection: store.getSelection({ scope, brief_id: brief.brief_id }), design: store.getCurrentDesignVersion({ scope, brief_id: brief.brief_id }),
      brief_usable: store.isBriefUsable({ scope, brief_id: brief.brief_id, brief_hash: canonicalHash(current) }),
      composition: { status: 'unavailable', bridge: 'creative.composition.consume/1' }, policy, actor: currentActor() };
  };
  const reopenAdapter = () => {
    adapter?.close(); adapter = new CreativeControlsAdapter({ path: join(directory, 'controls.sqlite'), ports, readContext, now: () => clock }); inspection = new InspectionControlsAdapter({ controls: adapter, ports, now: () => clock });
    if (enableComposition) composition = new CompositionControlsAdapter({ database: adapter.db, ports, readContext, now: () => clock,
      readPolicy: () => fixtureCompositionPolicy(clock, [...(lockLogo ? ['logo_position'] : []), ...(policy.locked_fields ?? [])]) });
  };
  reopenAdapter();
  host = {
    store, ports, api, policy, scope, counters, native,
    get adapter() { return adapter; },
    get inspection() { return inspection; },
    get composition() { return composition; },
    advance(ms) { clock += ms; },
    schema() { return adapter.projection(fixturePrincipal).schema; },
    counts() { return { ...counters, jobs: adapter.store.counts().jobs }; },
    nativeEvidence(actionId) {
      // Loopback test evidence only: hash private attribution, never expose raw IDs/usage.
      if (policy.can_read === false || !validId(actionId)) return null;
      const attribution = store.db.prepare('SELECT usage_json,usage_sha256 FROM private_provider_usage_attributions WHERE action_id=?').get(actionId);
      const job = store.db.prepare('SELECT result_json FROM creative_jobs WHERE action_id=?').get(actionId);
      if (!attribution || !job?.result_json) return null;
      const raw = JSON.parse(attribution.usage_json), usage = JSON.parse(job.result_json).usage_evidence;
      if (!usage) return null;
      return { evidence_mode: 'mock-private-attribution-fingerprints', captures: structuredClone(native.captures),
        private_usage_sha256: attribution.usage_sha256, verified_private_usage_sha256: canonicalHash(raw),
        private_request_id_sha256: canonicalHash(raw.provider_request_id ?? null),
        raw_completeness: raw.completeness, raw_missing_fields: raw.missing_fields,
        mapping_status: usage.status, target_binding_sha256: usage.target_binding_sha256,
        attempt_binding_sha256: usage.attempt_binding_sha256, billable_attempt_id: usage.billable_attempt_id };
    },
    get waiting() { return waiting; },
    block(kind) { gateKind = kind; gate = new Promise(resolve => { released = resolve; }); },
    release() { released?.(); gateKind = undefined; gate = null; },
    restartAdapter() { if (adapter.inflight.size) throw new Error('Use process restart for an in-flight operation'); reopenAdapter(); },
    setProviderFault(kind) {
      if (!['connection-loss', 'artifact-hash'].includes(kind)) throw new TypeError('Unknown fixture provider fault');
      const edit = ports.provider.edit;
      ports.provider.edit = async input => {
        const value = await edit(input); // Actual intercepted POST/ACK and usage path first.
        if (kind === 'connection-loss') throw new Error('Synthetic post-dispatch connection loss');
        return { ...value, artifact: { ...value.artifact, content_hash: `sha256:${'a'.repeat(64)}` } };
      };
    },
    async invalidate() {
      const event = { event_id: 'fixture-fact-correction', ...fixturePrincipal, source_package_id: brief.research_package_ref.package_id, source_package_hash: brief.research_package_ref.content_hash,
        source_revision: 2, occurred_at: new Date(NOW).toISOString(), kind: 'fact', reason: 'fact_corrected', fact_ids: ['event-date-1'], affected_briefs: [{ brief_id: brief.brief_id, brief_hash: canonicalHash(brief) }] };
      delete event.actor_id;
      invalidations.set(event.event_id, event);
      return api.invoke(currentActor(), { ...envelope('fixture-invalidation'), operation: 'brief.invalidate', payload: { event_id: event.event_id } });
    },
    async changeBrief(preferences) { return api.invoke(currentActor(), { ...envelope('fixture-brief-change'), operation: 'brief.create', payload: { expected_brief_hash: canonicalHash(store.getBrief({ scope, brief_id: brief.brief_id })), customer_preferences: preferences } }); },
    async history() { return api.invoke(currentActor(), { ...envelope('fixture-list'), operation: 'list', payload: { brief_id: brief.brief_id } }); },
    async artifact(designId) {
      const response = await this.history();
      if (!response.ok || typeof designId !== 'string') return null;
      const design = response.result.items.find(item => item.design_version_id === designId);
      if (!design) return null;
      const bytes = await store.getArtifactBytes({ scope, brief_id: brief.brief_id, design_version_id: designId });
      if (!currentActor().permissions.includes('creative.read')) return null;
      return { bytes, artifact: design.artifact };
    },
    selection() { return store.getSelection({ scope, brief_id: brief.brief_id }); },
    async compare(target) { return api.invoke(currentActor(), { ...envelope('fixture-compare'), operation: 'compare', payload: { brief_id: brief.brief_id, left_design_version_id: this.selection().design_version_id, right_design_version_id: target } }); },
    async restore(target, revision, actionId) { return api.invoke(currentActor(), { ...envelope(actionId), operation: 'restore', payload: { brief_id: brief.brief_id, target_design_version_id: target, expected_selection_revision: revision } }); },
    close() { if(closed)return; closed=true; this.release(); adapter.close(); store.close(); },
  };
  return host;
}
