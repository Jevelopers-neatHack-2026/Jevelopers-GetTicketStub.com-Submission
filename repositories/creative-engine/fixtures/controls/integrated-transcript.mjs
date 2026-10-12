import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createIntegratedHost, fixturePrincipal } from './integrated-host.mjs';
import { defaultDraft } from '../../src/controls/schema.mjs';
import { hash } from '../../src/controls/actions.mjs';
import { inspectOpenAIImageBytes } from 'creative-engine/models';
import { canonicalHash } from 'creative-engine/contracts';

export async function integratedTranscript() {
  const directory = await mkdtemp(join(tmpdir(), 'creative-controls-evidence-'));
  let host;
  try {
    host = await createIntegratedHost(directory); const schema = host.schema(), draft = defaultDraft(schema);
    const initial = host.store.getCurrentDesignVersion({ scope: host.scope, brief_id: schema.brief_id });
    draft.selections.c04 = 'vibrant'; const draftCounters = host.counts();
    const action = { action_version: 'creative-apply/1.1', schema_version: schema.schema_version, action_id: 'fixture-evidence-apply', tenant_id: schema.tenant_id, project_id: schema.project_id,
      brief_id: schema.brief_id, expected_versions: schema.expected_versions, intent: 'apply', draft, draft_hash: hash(draft), control_schema_hash: `sha256:${hash(schema)}` };
    const result = await host.adapter.apply(fixturePrincipal, action);
    if (!result.ok) throw new Error('Actual backend transcript failed');
    const replay = await host.adapter.apply(fixturePrincipal, action), design = result.result.design_version;
    const bytes = await host.store.getArtifactBytes({ scope: host.scope, brief_id: schema.brief_id, design_version_id: design.design_version_id });
    const computed = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (computed !== design.artifact.content_hash || host.counts().image_calls !== 1 || host.counts().reservations !== 1 || draftCounters.image_calls !== 0 || draftCounters.reservations !== 0 || replay.backend_job_id !== result.backend_job_id) throw new Error('Actual transcript identity/counter mismatch');
    const binding = host.adapter.db.prepare('SELECT request_json,request_hash,backend_request_hash FROM control_api_bindings_v1').get();
    const events = host.store.db.prepare('SELECT event_id,event_type,payload_json FROM creative_telemetry_evidence_outbox_v1').all().filter(row => JSON.parse(row.payload_json).logical_operation_id === result.action_id);
    const privateUsage = JSON.parse(host.store.db.prepare('SELECT usage_json FROM private_provider_usage_attributions WHERE action_id=?').get(result.action_id).usage_json);
    const storedResult = JSON.parse(host.store.db.prepare('SELECT result_json FROM creative_jobs WHERE action_id=?').get(result.action_id).result_json);
    const nativeEdit = host.native.captures.at(-1);
    if (nativeEdit.parent.content_hash !== initial.artifact.content_hash || nativeEdit.output.content_hash !== computed ||
        storedResult.usage_evidence.raw_usage_sha256 !== canonicalHash(privateUsage)) throw new Error('Native byte/usage binding mismatch');
    return { evidence_version: 'controls-actual-api-transcript/2', mode: 'mock', authority: 'MOCK trusted host fixture; no actual membership', transport: 'public native provider with intercepted offline fetch',
      local_modules: ['public planning', 'public creative API', 'selected native image provider and fully decoding codec', 'C03 port boundary', 'CE08 durable jobs/artifact/selection', 'CE11 durable usage evidence'], live_application_calls: 0,
      schema_hash: `sha256:${hash(schema)}`, action_hash: `sha256:${hash(action)}`, schema, action, backend_request: JSON.parse(binding.request_json),
      full_request_hash: binding.request_hash, backend_request_hash: binding.backend_request_hash,
      result, replay, draft_counters: draftCounters, final_counters: host.counts(), artifact_hash_verified: computed,
      native: { profile: host.native.profile, captures: host.native.captures, decoded: await inspectOpenAIImageBytes(bytes),
        parent_hash_verified: initial.artifact.content_hash, private_raw_usage_hash: canonicalHash(privateUsage),
        private_raw_completeness: privateUsage.completeness, private_raw_missing_fields: privateUsage.missing_fields,
        settled_evidence: storedResult.usage_evidence, raw_provider_request_id_public: false },
      trace_refs: events.map(row => ({ event_id: row.event_id, event_type: row.event_type, payload_hash: `sha256:${hash(JSON.parse(row.payload_json))}` })),
      approval_created: false, purchase_created: false, pending_local: ['actual CE06 composition consumer', 'compound consumer', 'research correction consumer', 'actual inspection integration', 'public controls package export/build and package consumer'],
      pending_external: ['canonical contracts', 'real application identity', 'actual harness/JEV/provider/Finance/Neatlogs', 'production composition renderer', 'release acceptance'] };
  } finally { host?.close(); await rm(directory, { recursive: true, force: true }); }
}
