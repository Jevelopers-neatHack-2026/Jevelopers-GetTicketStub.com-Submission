import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { canonicalHash } from 'creative-engine/contracts';
import { inspectOpenAIImageBytes } from 'creative-engine/models';
import { createIntegratedHost, fixturePrincipal } from '../../fixtures/controls/integrated-host.mjs';
import { defaultDraft } from '../../src/controls/schema.mjs';
import { hash } from '../../src/controls/actions.mjs';

async function setup(t, options) {
  const directory = await mkdtemp(join(tmpdir(), 'controls-native-'));
  const host = await createIntegratedHost(directory, options);
  t.after(async () => { host.close(); await rm(directory, { recursive: true, force: true }); }); return host;
}
function action(host) {
  const schema = host.schema(), draft = defaultDraft(schema); draft.selections.c04 = 'vibrant';
  return { action_version: 'creative-apply/1.1', schema_version: schema.schema_version, action_id: 'native-fixture-apply',
    tenant_id: schema.tenant_id, project_id: schema.project_id, brief_id: schema.brief_id,
    expected_versions: schema.expected_versions, intent: 'apply', draft, draft_hash: hash(draft), control_schema_hash: `sha256:${hash(schema)}` };
}
async function waitFor(check) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Native fixture synchronization timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

for (const format of ['png', 'jpeg', 'webp']) test(`actual native ${format} Apply sends exact stored parent and publishes fully decoded immutable bytes`, async t => {
  const host = await setup(t, { nativeFormat: format }), body = action(host), original = host.selection();
  const parent = await host.store.getArtifactBytes({ scope: host.scope, brief_id: body.brief_id, design_version_id: original.design_version_id });
  const before = host.counts(); assert.equal(before.image_calls, 0); assert.equal(before.reservations, 0);
  const result = await host.adapter.apply(fixturePrincipal, body); assert.equal(result.ok, true, JSON.stringify(result));
  const design = result.result.design_version;
  const bytes = await host.store.getArtifactBytes({ scope: host.scope, brief_id: body.brief_id, design_version_id: design.design_version_id });
  const decoded = await inspectOpenAIImageBytes(bytes); assert.deepEqual([decoded.format, decoded.width, decoded.height, decoded.has_transparency], [format, 16, 16, false]);
  const capture = host.native.captures.at(-1);
  assert.equal(capture.operation, 'edit'); assert.equal(capture.parent.content_hash, sha(parent));
  assert.equal(capture.parent.byte_length, parent.length); assert.equal(capture.output.content_hash, sha(bytes));
  assert.equal(design.artifact.content_hash, sha(bytes)); assert.equal(design.artifact.media_type, `image/${format}`);
  assert.equal(design.parent_version_id, original.design_version_id);
  if (format === 'png') assert.notEqual(sha(bytes), sha(parent), 'PNG edit has distinct encoded pixels');
  const stored = JSON.parse(host.store.db.prepare('SELECT result_json FROM creative_jobs WHERE action_id=?').get(result.action_id).result_json);
  const attribution = host.store.db.prepare('SELECT usage_json,usage_sha256 FROM private_provider_usage_attributions WHERE action_id=?').get(result.action_id);
  const raw = JSON.parse(attribution.usage_json);
  assert.equal(raw.completeness, 'unknown'); assert.deepEqual(raw.missing_fields, ['usage.profile_mapping_pending']);
  assert.equal(canonicalHash(raw), attribution.usage_sha256); assert.equal(stored.usage_evidence.raw_usage_sha256, attribution.usage_sha256);
  assert.equal(stored.usage_evidence.status, 'settled_owner_mapping');
  assert.equal(stored.usage_evidence.billable_attempt_id, design.billable_attempt_id);
  assert.match(stored.usage_evidence.target_binding_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(stored.usage_evidence.attempt_binding_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-offline-token|req-controls-private-synthetic|mock-owner-profile/);
  assert.deepEqual([host.counts().image_calls, host.counts().reservations, host.counts().holds], [1, 1, 0]);
  const replay = await host.adapter.apply(fixturePrincipal, body); assert.equal(replay.backend_job_id, result.backend_job_id);
  assert.equal(replay.result.design_version.artifact.content_hash, design.artifact.content_hash); assert.equal(host.counts().image_calls, 1);
  const read = await host.artifact(design.design_version_id); assert.deepEqual(Buffer.from(read.bytes), Buffer.from(bytes));
  host.policy.can_read = false; assert.equal(await host.artifact(design.design_version_id), null);
  t.diagnostic(JSON.stringify({ controls_probe: 'native_bytes', format, decoded, capture,
    artifact_hash: design.artifact.content_hash, raw_usage_sha256: attribution.usage_sha256, mapped: stored.usage_evidence.status,
    counts: host.counts(), live_application_calls: 0 }));
});

for (const fault of ['unmapped', 'usage-extension', 'malformed-usage']) test(`native ${fault} usage keeps unresolved hold and cannot publish or redispatch exact replay`, async t => {
  const host = await setup(t), body = action(host), original = host.selection();
  if (fault === 'unmapped') host.policy.map_native_usage = false; else host.policy.native_fault = fault;
  const result = await host.adapter.apply(fixturePrincipal, body); assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual(host.selection(), original); assert.equal((await host.history()).result.items.length, 1);
  assert.deepEqual([host.counts().image_calls, host.counts().reservations, host.counts().holds, host.counts().releases], [1, 1, 1, 0]);
  const binding = host.adapter.db.prepare('SELECT request_json FROM control_api_bindings_v1 WHERE operation_id=?').get(result.operation_id);
  const backendAction = JSON.parse(binding.request_json).action_id;
  const raw = JSON.parse(host.store.db.prepare('SELECT usage_json FROM private_provider_usage_attributions WHERE action_id=?').get(backendAction).usage_json);
  assert.notEqual(raw.completeness, 'complete');
  const replay = await host.adapter.apply(fixturePrincipal, body); assert.equal(replay.ok, false);
  assert.equal(replay.backend_job_id, result.backend_job_id); assert.equal(host.counts().image_calls, 1); assert.equal(host.counts().reservations, 1);
  t.diagnostic(JSON.stringify({ controls_probe: 'native_unknown_usage', fault, code: result.code,
    raw_completeness: raw.completeness, raw_missing_fields: raw.missing_fields, counts: host.counts(), live_application_calls: 0 }));
});

test('native corrupt compressed output rejects after one POST without publishing encoded header fragments', async t => {
  const host = await setup(t), original = host.selection(); host.policy.native_fault = 'corrupt-output';
  const result = await host.adapter.apply(fixturePrincipal, action(host)); assert.equal(result.ok, false);
  assert.deepEqual(host.selection(), original); assert.equal((await host.history()).result.items.length, 1);
  assert.equal(host.counts().image_calls, 1); assert.equal(host.counts().reservations, 1); assert.equal(host.counts().releases, 0);
});

for (const revoke of ['permission', 'asset', 'cancel']) test(`native post-ACK ${revoke} rechecks current authority with zero intercepted POST and no late publication`, async t => {
  const host = await setup(t), body = action(host), original = host.selection();
  let ackWaiting = false;
  const authority = host.native.provider; // Public provider stays frozen and unchanged.
  assert.equal(Object.isFrozen(authority), true);
  const originalAck = host.ports.metering.recordTransportAttempt;
  host.ports.metering.recordTransportAttempt = async input => { const ack = await originalAck(input); ackWaiting = true; return ack; };
  host.block('native-post-ack'); const pending = host.adapter.apply(fixturePrincipal, body);
  await waitFor(() => ackWaiting);
  if (revoke === 'permission') host.policy.can_apply = false;
  else if (revoke === 'asset') host.policy.permitted_asset_ids = [];
  else assert.equal((await host.adapter.cancel(fixturePrincipal, host.adapter.lookup(fixturePrincipal, body.action_id).operation_id)).code, 'cancelled');
  host.release(); const result = await pending; assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual(host.selection(), original); assert.equal((await host.history()).result.items.length, 1);
  assert.equal(host.counts().image_calls, 0); assert.equal(host.counts().reservations, 1); assert.equal(host.counts().releases, 0);
  assert.equal(host.counts().holds, 1, 'acknowledged transport remains conservatively held even before intercepted fetch');
});

test('current rights revoked while owner usage mapping awaits prevents late native publication', async t => {
  const host = await setup(t), body = action(host), original = host.selection();
  let mapping = false; const map = host.ports.telemetry.usage_profile_authority.mapProviderUsage;
  host.ports.telemetry.usage_profile_authority.mapProviderUsage = async input => { mapping = true; return map(input); };
  host.block('usage-map'); const pending = host.adapter.apply(fixturePrincipal, body); await waitFor(() => mapping);
  host.policy.permitted_asset_ids = []; host.release(); const result = await pending; assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual(host.selection(), original); assert.equal((await host.history()).result.items.length, 1);
  assert.equal(host.counts().image_calls, 1); assert.equal(host.counts().reservations, 1); assert.equal(host.counts().releases, 0);
});

test('unknown native result with revoked current read policy withholds durable backend identity', async t => {
  const host = await setup(t), body = action(host);
  let mapping = false; const map = host.ports.telemetry.usage_profile_authority.mapProviderUsage;
  host.ports.telemetry.usage_profile_authority.mapProviderUsage = async input => { mapping = true; return map(input); };
  host.policy.map_native_usage = false; host.block('usage-map');
  const pending = host.adapter.apply(fixturePrincipal, body); await waitFor(() => mapping);
  host.policy.can_read = false; host.release(); const result = await pending;
  assert.equal(result.ok, false); assert.equal(result.code, 'unavailable');
  assert.equal(Object.hasOwn(result, 'backend_job_id'), false); assert.equal(Object.hasOwn(result, 'action_id'), false);
  assert.equal(Object.hasOwn(result, 'request_hash'), false);
  const binding = host.adapter.db.prepare('SELECT job_id FROM control_api_bindings_v1').get(); assert.ok(binding.job_id);
  assert.deepEqual([host.counts().image_calls, host.counts().reservations, host.counts().holds, host.counts().releases], [1, 1, 1, 0]);
  const forged = await host.adapter.apply({ ...fixturePrincipal, tenant_id: 'forged-scope' }, body);
  assert.equal(forged.code, 'permission'); assert.equal(Object.hasOwn(forged, 'backend_job_id'), false);
});
