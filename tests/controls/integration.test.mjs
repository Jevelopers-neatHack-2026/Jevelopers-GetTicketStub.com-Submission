import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createIntegratedHost, fixturePrincipal } from '../../fixtures/controls/integrated-host.mjs';
import { defaultDraft, assertRenderableSchema, createControlSchema, snapshotControlJson } from '../../src/controls/schema.mjs';
import { hash } from '../../src/controls/actions.mjs';
import { canonicalHash } from 'creative-engine/contracts';

async function setup(t, options) {
  const directory = await mkdtemp(join(tmpdir(), 'creative-controls-integrated-'));
  const host = await createIntegratedHost(directory, options);
  t.after(async () => { if (!host.closed) host.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, host };
}
function action(host, selection = { c04: 'vibrant' }, version = '1.1') {
  const schema = host.schema(); schema.schema_version = `creative-controls/${version}`;
  const draft = defaultDraft(schema); Object.assign(draft.selections, selection);
  if (draft.selections.c02 === 'stacked') draft.answers.q01 = 'name';
  return { action_version: `creative-apply/${version}`, schema_version: schema.schema_version, action_id: 'integrated_action',
    tenant_id: schema.tenant_id, project_id: schema.project_id, brief_id: schema.brief_id, expected_versions: schema.expected_versions,
    intent: 'apply', draft, draft_hash: hash(draft), control_schema_hash: `sha256:${hash(schema)}` };
}
async function waitFor(check) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Fixture synchronization timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

test('actual brief/API/CE08 publication and CE11 evidence complete one Apply; draft incurs zero attempts', async t => {
  const { host } = await setup(t), body = action(host), initial = host.store.getCurrentDesignVersion({ scope: host.scope, brief_id: body.brief_id });
  assert.equal(host.counts().image_calls, 0); assert.equal(host.counts().reservations, 0);
  const result = await host.adapter.apply(fixturePrincipal, body);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.code, 'completed');
  const design = result.result.design_version;
  assert.equal(design.parent_version_id, initial.design_version_id);
  assert.equal(design.logical_operation_id, result.action_id);
  const bytes = await host.store.getArtifactBytes({ scope: host.scope, brief_id: body.brief_id, design_version_id: design.design_version_id });
  assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, design.artifact.content_hash);
  const binding = host.adapter.db.prepare('SELECT * FROM control_api_bindings_v1').get();
  assert.equal(canonicalHash(JSON.parse(binding.request_json)), result.request_hash);
  const job = await host.ports.jobs.get({ scope: host.scope, job_id: result.backend_job_id });
  assert.equal(job.status, 'completed'); assert.equal(job.action_id, result.action_id); assert.equal(job.request_hash, binding.backend_request_hash);
  assert.equal(host.schema().controls.find(c => c.id === 'c04').default_value, 'vibrant');
  assert.deepEqual([host.counts().image_calls, host.counts().jev_calls, host.counts().reservations], [1, 0, 1]);
  const evidence = host.store.db.prepare('SELECT event_type,payload_json FROM creative_telemetry_evidence_outbox_v1').all().map(row => JSON.parse(row.payload_json));
  assert.equal(evidence.filter(row => row.logical_operation_id === result.action_id).length, 3);
  assert.equal((await host.history()).result.items.length, 2);
  assert.equal(result.approval, false); assert.equal(result.purchase, false);
});

test('concurrent identical and lost-response Apply replay durable backend result, then hard process restart makes zero new calls', async t => {
  const { host, directory } = await setup(t), body = action(host);
  const results = await Promise.all([host.adapter.apply(fixturePrincipal, body), host.adapter.apply(fixturePrincipal, body)]);
  assert.equal(results[0].ok, true, JSON.stringify(results[0])); assert.equal(results[1].ok, true);
  assert.equal(results[0].backend_job_id, results[1].backend_job_id); assert.equal(host.counts().image_calls, 1);
  const bodyPath = join(directory, 'retry.json'); await writeFile(bodyPath, JSON.stringify(body)); host.close(); host.closed = true;
  const child = spawnSync(process.execPath, ['fixtures/controls/integrated-restart-worker.mjs', directory, bodyPath], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); const recovered = JSON.parse(child.stdout);
  assert.equal(recovered.result.ok, true, JSON.stringify(recovered)); assert.equal(recovered.result.backend_job_id, results[0].backend_job_id);
  assert.equal(recovered.result.result.design_version.artifact.content_hash, results[0].result.design_version.artifact.content_hash);
  assert.equal(recovered.counters.image_calls, 0); assert.equal(recovered.counters.reservations, 0);
});

for (const [label, mutate, code] of [
  ['tenant', body => { body.tenant_id = 'forged'; }, 'permission'], ['project', body => { body.project_id = 'forged'; }, 'permission'],
  ['unknown field HTML', body => { body.html = '<script>attack()</script>'; }, 'unknown_field'],
  ['privileged action', body => { body.intent = 'purchase'; }, 'invalid_intent'],
  ['schema', body => { body.schema_version = 'creative-controls/2.0'; }, 'unsupported_version'],
  ['control', body => { body.draft.selections.evil = 'run'; body.draft_hash = hash(body.draft); }, 'validation'],
  ['value', body => { body.draft.selections.c04 = '<script>x</script>'; body.draft_hash = hash(body.draft); }, 'invalid_value'],
  ['lock', body => { body.draft.selections.c03 = 'bottom'; body.draft_hash = hash(body.draft); }, 'locked'],
]) test(`${label} rejects before actual API/provider/reservation dispatch`, async t => {
  const { host } = await setup(t), body = action(host); mutate(body);
  const result = await host.adapter.apply(fixturePrincipal, body); assert.equal(result.code, code, JSON.stringify(result));
  assert.deepEqual([host.counts().jobs, host.counts().image_calls, host.counts().reservations], [0, 0, 0]);
});

test('negotiated older pair and optional correlation preserve typed action meaning; unknown additions reject', async t => {
  const { host } = await setup(t), body = action(host, { c04: 'vibrant' }, '1.0'); body.correlation_id = 'fixture_correlation';
  assert.equal((await host.adapter.apply(fixturePrincipal, body)).ok, true);
  const conflicting = { ...body, correlation_id: 'another_correlation' };
  assert.equal((await host.adapter.apply(fixturePrincipal, conflicting)).code, 'action_conflict');
  assert.equal(host.counts().image_calls, 1);
});

test('actual versioned brief update and fact invalidation make preexisting schema stale or unauthorized without dispatch', async t => {
  const { host } = await setup(t), body = action(host);
  assert.equal((await host.changeBrief([{ preference_id: 'style', value: 'calm' }, { preference_id: 'layout', value: 'stacked' }])).ok, true);
  assert.equal((await host.adapter.apply(fixturePrincipal, body)).code, 'stale_version');
  assert.equal(host.schema().controls.find(c => c.id === 'c02').default_value, 'stacked');
  const fresh = action(host); const invalidated = await host.invalidate(); assert.equal(invalidated.ok, true, JSON.stringify(invalidated));
  assert.equal((await host.adapter.apply(fixturePrincipal, fresh)).code, 'permission'); assert.equal(host.counts().image_calls, 0);
});

for (const kind of ['reservation', 'provider']) test(`revocation during awaited ${kind} prevents late publication; cancellation preserves unresolved hold`, async t => {
  const { host } = await setup(t), body = action(host), initial = host.schema().expected_versions.design;
  host.block(kind); const pending = host.adapter.apply(fixturePrincipal, body);
  await waitFor(() => kind === 'reservation' ? host.counts().reservations === 1 : host.counts().image_calls === 1);
  const operationId = host.adapter.lookup(fixturePrincipal, body.action_id).operation_id;
  host.policy.can_apply = false;
  assert.equal((await host.adapter.cancel(fixturePrincipal, operationId)).code, 'cancelled');
  if (kind === 'provider') { assert.equal(host.counts().holds, 1); assert.equal(host.counts().releases, 0); }
  host.release(); const result = await pending; assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(host.schema().expected_versions.design, initial);
  assert.equal((await host.history()).result.items.length, 1);
  assert.equal(host.counts().image_calls, kind === 'provider' ? 1 : 0);
});

test('required composition task stays durable typed unavailable with zero image/JEV/reservations', async t => {
  const { host } = await setup(t); const body = action(host, { c01: 'large', c02: 'stacked' });
  const result = await host.adapter.apply(fixturePrincipal, body);
  assert.equal(result.code, 'unavailable'); assert.equal(result.pending_bridge, 'creative.composition.consume/1');
  const operation = JSON.parse(host.adapter.db.prepare('SELECT operation FROM control_jobs').get().operation);
  assert.equal(operation.tasks[0].kind, 'composition.update'); assert.equal(operation.tasks[0].image_calls, 0); assert.equal(operation.tasks[0].jev_calls, 0);
  assert.deepEqual([host.counts().image_calls, host.counts().jev_calls, host.counts().reservations], [0, 0, 0]);
});

test('own descriptor input never executes accessors, array overrides, custom prototypes, or species', async t => {
  const { host } = await setup(t); let invoked = 0;
  const body = action(host); Object.defineProperty(body, 'draft', { enumerable: true, get() { invoked += 1; return {}; } });
  assert.equal((await host.adapter.apply(fixturePrincipal, body)).code, 'validation');
  assert.equal(host.adapter.store.dispatch(fixturePrincipal, body).code, 'validation');
  assert.equal(host.adapter.store.acknowledge(fixturePrincipal, 'invalid_operation', body).code, 'validation');
  const schema = host.schema(); Object.defineProperty(schema.controls, 'map', { value() { invoked += 1; }, enumerable: true });
  assert.throws(() => assertRenderableSchema(schema));
  assert.throws(() => snapshotControlJson(Object.create({ secret: 'bad' })));
  const principal = { ...fixturePrincipal }; Object.defineProperty(principal, 'actor_id', { enumerable: true, get() { invoked += 1; return fixturePrincipal.actor_id; } });
  assert.equal((await host.adapter.apply(principal, action(host))).code, 'permission');
  assert.equal((await host.adapter.cancel(principal, 'invalid_operation')).code, 'permission');
  assert.equal((await host.adapter.cancel(fixturePrincipal, {})).code, 'validation');
  assert.equal(invoked, 0); assert.equal(host.counts().image_calls, 0);
  host.block('provider');
  const mutablePrincipal = { ...fixturePrincipal }, pending = host.adapter.apply(mutablePrincipal, action(host));
  await waitFor(() => host.counts().image_calls === 1);
  mutablePrincipal.tenant_id = 'forged_tenant'; mutablePrincipal.actor_id = 'forged_actor'; host.release();
  const completed = await pending; assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal(completed.result.design_version.tenant_id, fixturePrincipal.tenant_id);
});

test('rights revoked during async verification deny dispatch and reservation', async t => {
  const { host } = await setup(t), body = action(host); host.block('rights');
  const pending = host.adapter.apply(fixturePrincipal, body);
  await waitFor(() => host.adapter.db.prepare('SELECT job_id FROM control_api_bindings_v1').get()?.job_id);
  host.policy.permitted_asset_ids = []; host.release();
  const result = await pending; assert.equal(result.ok, false); assert.equal(result.code, 'permission');
  assert.equal(host.counts().image_calls, 0); assert.equal(host.counts().reservations, 0);
});

test('historical compare and restore select exact bytes; stale pre-restore schema cannot silently rebase', async t => {
  const { host } = await setup(t), body = action(host), original = host.selection();
  const first = await host.adapter.apply(fixturePrincipal, body); assert.equal(first.ok, true);
  const stale = action(host, { c04: 'calm' }); stale.action_id = 'after_restore';
  const comparison = await host.compare(original.design_version_id); assert.equal(comparison.ok, true);
  assert.equal(comparison.result.right.design_hash, original.design_hash);
  const restored = await host.restore(original.design_version_id, host.selection().revision, 'fixture-restore');
  assert.equal(restored.ok, true); assert.equal(restored.result.selection.design_hash, original.design_hash);
  assert.equal((await host.adapter.apply(fixturePrincipal, stale)).code, 'stale_version');
  assert.equal(host.schema().controls.find(c => c.id === 'c04').default_value, 'calm');
  assert.equal(host.counts().image_calls, 1); assert.equal((await host.history()).result.items.length, 2);
});

test('hard crash after transport dispatch keeps durable running attempt unknown; restart performs no extra provider/reservation/release', async t => {
  const { host, directory } = await setup(t), body = action(host), bodyPath = join(directory, 'crash-action.json');
  await writeFile(bodyPath, JSON.stringify(body)); host.close(); host.closed = true;
  const crash = spawnSync(process.execPath, ['fixtures/controls/integrated-crash-worker.mjs', directory, bodyPath], { encoding: 'utf8' });
  assert.equal(crash.status, 17, crash.stderr); const before = JSON.parse(crash.stdout);
  assert.equal(before.crossed_dispatch, true); assert.equal(before.counters.holds, 1); assert.equal(before.counters.releases, 0);
  const restarted = spawnSync(process.execPath, ['fixtures/controls/integrated-restart-worker.mjs', directory, bodyPath], { encoding: 'utf8' });
  assert.equal(restarted.status, 0, restarted.stderr); const recovered = JSON.parse(restarted.stdout);
  assert.equal(recovered.result.ok, false); assert.equal(recovered.result.code, 'unavailable'); assert.equal(recovered.result.status, 'unknown');
  assert.equal(recovered.result.backend_job_id, before.backend_job_id);
  assert.equal(recovered.counters.image_calls, 0); assert.equal(recovered.counters.reservations, 0); assert.equal(recovered.counters.releases, 0);
});

test('corrupted durable request bytes cannot dispatch or replay another paid instruction', async t => {
  const { host } = await setup(t), body = action(host);
  const first = await host.adapter.apply(fixturePrincipal, body); assert.equal(first.ok, true);
  const row = host.adapter.db.prepare('SELECT operation_id,request_json FROM control_api_bindings_v1').get();
  const changed = JSON.parse(row.request_json); changed.payload.plan.steps[0].parameters.instruction = 'Untrusted replacement';
  host.adapter.db.prepare('UPDATE control_api_bindings_v1 SET request_json=? WHERE operation_id=?').run(JSON.stringify(changed), row.operation_id);
  const replay = await host.adapter.apply(fixturePrincipal, body); assert.equal(replay.ok, false); assert.equal(replay.code, 'unavailable');
  assert.equal(host.counts().image_calls, 1); assert.equal(host.counts().reservations, 1);
});

test('approved unlocked logo movement validates actual brief permissions into zero-image composition task', async t => {
  const { host } = await setup(t, { lockLogo: false }), body = action(host, { c03: 'bottom' });
  assert.equal(host.schema().controls.find(c => c.id === 'c03').locked, false);
  const result = await host.adapter.apply(fixturePrincipal, body); assert.equal(result.code, 'unavailable');
  assert.equal(result.pending_bridge, 'creative.composition.consume/1');
  const operation = JSON.parse(host.adapter.db.prepare('SELECT operation FROM control_jobs').get().operation);
  assert.deepEqual(operation.tasks[0].changes, [{ field: 'logo_position', value: 'bottom', asset_id: 'asset-1' }]);
  assert.equal(host.counts().image_calls, 0); assert.equal(host.counts().jev_calls, 0); assert.equal(host.counts().reservations, 0);
});

test('compound composition/artwork Apply preserves separate typed tasks and fails unavailable before partial image dispatch', async t => {
  const { host } = await setup(t), body = action(host, { c01: 'large', c04: 'vibrant' });
  const result = await host.adapter.apply(fixturePrincipal, body); assert.equal(result.code, 'unavailable');
  assert.equal(result.pending_bridge, 'creative.compound.consume/1');
  const operation = JSON.parse(host.adapter.db.prepare('SELECT operation FROM control_jobs').get().operation);
  assert.deepEqual(operation.tasks.map(task => task.kind), ['composition.update', 'artwork.edit']);
  assert.equal(host.counts().image_calls, 0); assert.equal(host.counts().jev_calls, 0); assert.equal(host.counts().reservations, 0);
});

test('actual artwork completion preserves the current versioned brief follow-up baseline', async t => {
  const { host } = await setup(t, { preferences: [{ preference_id: 'style', value: 'calm' }, { preference_id: 'layout', value: 'stacked' }, { preference_id: 'layout_emphasis', value: 'name' }] });
  const body = action(host); assert.equal(body.draft.answers.q01, 'name');
  const applied = await host.adapter.apply(fixturePrincipal, body); assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(host.schema().follow_up_questions[0].default_value, 'name');
  assert.equal(host.schema().controls.find(c => c.id === 'c02').default_value, 'stacked');
  assert.equal(host.counts().image_calls, 1);
});

test('defensive schema rejects injected public option labels and forged asset descriptors before rendering', async t => {
  const { host } = await setup(t); const schema = host.schema();
  schema.controls[0].options[0].label = 'secret:synthetic-credential'; assert.throws(() => assertRenderableSchema(schema));
  const forged = host.schema(); forged.controls.find(c => c.id === 'c04').asset_id = 'https://untrusted.test/logo';
  assert.throws(() => assertRenderableSchema(forged));
  assert.equal(host.counts().jobs, 0); assert.equal(host.counts().reservations, 0); assert.equal(host.counts().image_calls, 0);
});

test('authority revocation during final awaited publication storage rolls back actual job/version/selection', async t => {
  const { host } = await setup(t), body = action(host), initial = host.selection();
  host.block('publication'); const pending = host.adapter.apply(fixturePrincipal, body);
  await waitFor(() => host.counts().publication_waits === 1); host.policy.can_apply = false; host.release();
  const result = await pending; assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(host.selection().design_hash, initial.design_hash); assert.equal((await host.history()).result.items.length, 1);
  assert.equal(host.counts().image_calls, 1); assert.equal(host.counts().reservations, 1);
  const row = host.adapter.db.prepare('SELECT job_id FROM control_api_bindings_v1').get();
  assert.notEqual((await host.ports.jobs.get({ scope: host.scope, job_id: row.job_id })).status, 'completed');
});
