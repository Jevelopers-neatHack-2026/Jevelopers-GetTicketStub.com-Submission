import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createIntegratedHost, fixturePrincipal } from '../../fixtures/controls/integrated-host.mjs';
import { fixtureState, projection, action as foundationAction, principal } from '../../fixtures/controls/state.mjs';
import { ApplyStore, hash } from '../../src/controls/actions.mjs';
import { CreativeControlsAdapter } from '../../src/controls/integration.mjs';
import { createControlSchema, assertRenderableSchema, defaultDraft, validId } from '../../src/controls/schema.mjs';
import { containsSensitivePublicText } from 'creative-engine/telemetry';
import { applyErrorMessage, historyErrorMessage } from '../../examples/frontend-action-roundtrip/messages.mjs';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'controls-review-fix-'));
  const host = await createIntegratedHost(directory);
  t.after(async () => { host.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, host };
}
function action(host, id = 'review_a', style = 'vibrant') {
  const schema = host.schema(), draft = defaultDraft(schema); draft.selections.c04 = style;
  return { action_version: 'creative-apply/1.1', schema_version: schema.schema_version, action_id: id,
    tenant_id: schema.tenant_id, project_id: schema.project_id, brief_id: schema.brief_id,
    expected_versions: schema.expected_versions, intent: 'apply', draft, draft_hash: hash(draft),
    control_schema_hash: 'sha256:' + hash(schema) };
}

test('borrowed BEGIN and SAVEPOINT survive rejected Apply/dispatch/ack/cancel without authority, audit or callback', async t => {
  const { host } = await setup(t), body = action(host), db = host.adapter.db;
  db.exec('CREATE TABLE caller_probe(value TEXT)');
  let calls = 0; host.adapter.store.getState = () => { calls++; throw Error('unexpected authority'); };
  for (const [open, finish] of [['BEGIN IMMEDIATE', 'COMMIT'], ['SAVEPOINT caller_owned', 'RELEASE caller_owned']]) {
    db.exec(open); db.prepare('INSERT INTO caller_probe VALUES(?)').run(open);
    const auditCount = db.prepare('SELECT count(*) AS n FROM control_audit').get().n;
    const results = [await host.adapter.apply(fixturePrincipal, body), host.adapter.store.dispatch(fixturePrincipal, 'invalid_operation'),
      host.adapter.store.acknowledge(fixturePrincipal, 'invalid_operation', {}), host.adapter.store.cancel(fixturePrincipal, 'invalid_operation'),
      host.adapter.store.execute(hash(null), () => { calls++; throw Error('unexpected callback'); })];
    for (const result of results) { assert.equal(result.code, 'unavailable'); assert.equal(result.audit_status, 'unavailable'); }
    assert.equal(db.isTransaction, true); assert.equal(db.prepare('SELECT count(*) AS n FROM control_audit').get().n, auditCount);
    assert.equal(db.prepare('SELECT count(*) AS n FROM caller_probe WHERE value=?').get(open).n, 1);
    db.exec(finish); assert.equal(db.isTransaction, false);
  }
  assert.equal(calls, 0); assert.deepEqual([host.counts().image_calls, host.counts().reservations, host.counts().jobs], [0, 0, 0]);
});

test('caller SAVEPOINT opened during awaited backend begin survives with no controls write or dispatch', async t => {
  const { host } = await setup(t), db = host.adapter.db, begin = host.ports.jobs.begin;
  db.exec('CREATE TABLE caller_probe(value TEXT)');
  host.ports.jobs.begin = async input => {
    const result = await begin(input);
    db.exec("SAVEPOINT caller_owned; INSERT INTO caller_probe VALUES ('retained')");
    return result;
  };
  const result = await host.adapter.apply(fixturePrincipal, action(host));
  assert.equal(result.code, 'unavailable'); assert.equal(db.isTransaction, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM caller_probe').get().n, 1);
  assert.equal(db.prepare('SELECT job_id FROM control_api_bindings_v1').get().job_id, null);
  assert.deepEqual([host.counts().image_calls, host.counts().reservations, host.counts().releases], [0, 0, 0]);
  db.exec('RELEASE caller_owned');
});

test('exact completed Apply replays original receipt after another edit or restore, with scoped read authority and no mutation calls', async t => {
  for (const mode of ['edit', 'restore']) {
    const { host } = await setup(t), initial = host.selection(), a = action(host), first = await host.adapter.apply(fixturePrincipal, a);
    assert.equal(first.ok, true);
    const receipt = host.adapter.db.prepare('SELECT * FROM control_completions WHERE operation_id=?').get(first.operation_id);
    const changed = mode === 'edit' ? await host.adapter.apply(fixturePrincipal, action(host, 'review_b', 'calm')) :
      await host.restore(initial.design_version_id, host.selection().revision, 'review_restore');
    assert.equal(changed.ok, true);
    const selected = host.selection(), counts = host.counts(); let mutations = 0;
    host.adapter.api = { invoke() { mutations++; throw Error('historical replay must not POST edit'); } };
    host.policy.can_apply = false; // Historical read remains allowed when edit authority is withdrawn.
    const replay = await host.adapter.apply(fixturePrincipal, a);
    assert.equal(replay.ok, true, JSON.stringify(replay)); assert.equal(replay.code, 'replayed');
    assert.equal(replay.backend_job_id, first.backend_job_id); assert.equal(replay.request_hash, first.request_hash);
    assert.deepEqual(replay.result, first.result); assert.deepEqual(host.selection(), selected); assert.deepEqual(host.counts(), counts);
    assert.deepEqual(host.adapter.db.prepare('SELECT * FROM control_completions WHERE operation_id=?').get(first.operation_id), receipt);
    assert.equal(mutations, 0);
    host.policy.can_read = false; assert.equal((await host.adapter.apply(fixturePrincipal, a)).code, 'permission');
    host.policy.can_read = true;
    const context = host.adapter.readContext; host.adapter.readContext = p => {
      const current = context(p); current.actor = { ...current.actor, permissions: current.actor.permissions.filter(v => v !== 'creative.read') }; return current;
    };
    assert.equal((await host.adapter.apply(fixturePrincipal, a)).code, 'permission'); assert.equal(mutations, 0);
    assert.equal((await host.adapter.apply({ ...fixturePrincipal, actor_id: 'other_actor' }, a)).code, 'unavailable');
  }
});

test('historical replay rechecks current read authority and borrowed SAVEPOINT after awaited storage', async t => {
  const { host } = await setup(t), body = action(host), first = await host.adapter.apply(fixturePrincipal, body);
  assert.equal(first.ok, true); const get = host.ports.storage.getDesignVersion;
  const receipt = host.adapter.db.prepare('SELECT * FROM control_completions WHERE operation_id=?').get(first.operation_id);
  host.ports.storage.getDesignVersion = async input => { const result = await get(input); host.policy.can_read = false; return result; };
  assert.equal((await host.adapter.apply(fixturePrincipal, body)).code, 'permission');
  host.policy.can_read = true;
  const db = host.adapter.db; db.exec('CREATE TABLE caller_probe(value TEXT)');
  host.ports.storage.getDesignVersion = async input => { const result = await get(input); db.exec("SAVEPOINT caller_owned; INSERT INTO caller_probe VALUES ('retained')"); return result; };
  assert.equal((await host.adapter.apply(fixturePrincipal, body)).code, 'unavailable'); assert.equal(db.isTransaction, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM caller_probe').get().n, 1); db.exec('RELEASE caller_owned');
  assert.deepEqual(db.prepare('SELECT * FROM control_completions WHERE operation_id=?').get(first.operation_id), receipt);
  assert.equal(host.counts().image_calls, 1);
});

test('public producer and renderer screen complete opaque IDs consistently with scalar privacy and preserve benign hashes', () => {
  const secrets = ['design.ghp_' + 'a'.repeat(36), 'brief.AKIA' + 'A'.repeat(16), 'version.sk-' + 'a'.repeat(24),
    'id.api_key:inert-test', 'id.api_key::inert-test', 'id.Basic+' + btoa('fixture:inert'), 'id.Bearer+inert-test', 'id.212-555-0100'];
  for (const value of secrets) {
    assert.equal(containsSensitivePublicText(value), true); assert.equal(validId(value), false);
    for (const field of ['tenant_id', 'project_id', 'brief_id', 'design']) {
      const state = fixtureState(); if (field === 'design') state.versions.design = value; else state[field] = value;
      assert.throws(() => createControlSchema(state));
      const schema = createControlSchema(fixtureState()); if (field === 'design') schema.expected_versions.design = value; else schema[field] = value;
      assert.throws(() => assertRenderableSchema(schema));
    }
    const schema = createControlSchema(fixtureState()); schema.controls.find(c => c.field === 'logo_position').asset_id = value;
    assert.throws(() => assertRenderableSchema(schema));
  }
  for (const value of ['design:abc.def+rev_2', '_legacy-id', 'sha256:' + 'a'.repeat(64), 'id.Basic+' + btoa('benign'), 'id.Bearer+a:ordinary']) {
    assert.equal(containsSensitivePublicText(value), false); assert.equal(validId(value), true);
    const state = fixtureState(); state.versions.design = value; assert.equal(assertRenderableSchema(createControlSchema(state)).expected_versions.design, value);
  }
  const schema = createControlSchema(fixtureState());
  assert.equal(hash(schema), 'c8c4ec7ece4ea3b8a79eee93cbc704e0e3bf11a5ba123e220700192da6e34516');
});

test('49 hostile array variants reject without invoking caller hooks', t => {
  let hooks = 0, cases = 0; const hit = () => { hooks++; return []; };
  const mutations = [a => Object.defineProperty(a, 'map', { value: hit }), a => Object.defineProperty(a, Symbol.iterator, { value: hit }),
    a => Object.defineProperty(a, '0', { get: hit, enumerable: true }), a => Object.setPrototypeOf(a, { map: hit }),
    a => Object.defineProperty(a, 'constructor', { value: { get [Symbol.species]() { hooks++; return Array; } } }),
    a => { delete a[0]; }, a => Object.defineProperty(a, 'extra', { get: hit, enumerable: true })];
  for (const mutate of mutations) for (const field of ['available_operations', 'locks', 'follow_up_locks', 'options']) {
    const state = fixtureState(), array = field === 'options' ? state.allowed_options.style : state[field];
    if (!array.length) array.push('q01'); mutate(array); assert.throws(() => createControlSchema(state)); cases++;
  }
  for (const mutate of mutations) for (const field of ['controls', 'follow_up_questions', 'options']) {
    const schema = createControlSchema(fixtureState()); mutate(field === 'options' ? schema.controls[0].options : schema[field]);
    assert.throws(() => defaultDraft(schema)); cases++;
  }
  assert.equal(cases, 49); assert.equal(hooks, 0);
  t.diagnostic(JSON.stringify({ controls_probe: 'own_arrays', cases, hooks }));
});

test('actual populated BASE4e controls jobs and receipts survive additive adapter migration and reopen', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'controls-base-migration-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'base-source'); await mkdir(source);
  for (const file of ['actions.mjs', 'schema.mjs', 'runtime.mjs']) {
    const result = spawnSync('git', ['show', '4e28839ea8baeb4112a4f12340ef2fe84f5c8efe:src/controls/' + file], { encoding: 'utf8' });
    assert.equal(result.status, 0); await writeFile(join(source, file), result.stdout);
  }
  const { ApplyStore: BaseStore } = await import(pathToFileURL(join(source, 'actions.mjs')));
  const state = fixtureState(), path = join(directory, 'outbox.sqlite'), base = new BaseStore(path, () => projection(state)), body = foundationAction(state);
  const accepted = base.apply(principal, body); assert.equal(accepted.code, 'accepted'); assert.equal(base.dispatch(principal, accepted.operation_id).code, 'ready');
  state.can_acknowledge = true; state.values.name_size = 'large'; state.versions.composition = 'composition_v2';
  assert.equal(base.acknowledge(principal, accepted.operation_id, { completion_id: 'old_completion', result_ref: 'composition_v2', applied_versions: { ...state.versions } }).code, 'completed');
  const jobs = base.db.prepare('SELECT * FROM control_jobs').all(), receipts = base.db.prepare('SELECT * FROM control_completions').all(); base.close();
  const unused = () => { throw Error('unexpected authority'); };
  const adapter = new CreativeControlsAdapter({ path, ports: { jobs: { begin: unused, get: unused, cancel: unused, authorizeDispatch: unused, completeIfActive: unused }, storage: { getDesignVersion: unused } }, readContext: unused });
  assert.deepEqual(adapter.db.prepare('SELECT * FROM control_jobs').all(), jobs); assert.deepEqual(adapter.db.prepare('SELECT * FROM control_completions').all(), receipts);
  assert.equal(adapter.db.prepare('SELECT count(*) AS n FROM control_api_bindings_v1').get().n, 0); adapter.close();
  const reopened = new ApplyStore(path, () => projection(state)); assert.equal(reopened.apply(principal, body).code, 'replayed'); reopened.close();
  t.diagnostic(JSON.stringify({ controls_probe: 'base_migration', base: '4e28839ea8baeb4112a4f12340ef2fe84f5c8efe', populated_jobs: jobs.length,
    completed_receipts: receipts.length, jobs_hash: hash(jobs), receipts_hash: hash(receipts), exact_rows_preserved: true, fabricated_backend_bindings: 0, reopened_replay: 'replayed' }));
});

for (const [fault, code, holds] of [['connection-loss', 'unavailable', 1], ['artifact-hash', 'failed', 0]]) {
  test(`actual post-dispatch ${fault} preserves truthful outcome wording and MOCK reservation evidence`, async t => {
    const { host } = await setup(t), initial = host.selection(); host.setProviderFault(fault);
    const result = await host.adapter.apply(fixturePrincipal, action(host));
    assert.equal(result.ok, false); assert.equal(result.code, code);
    assert.deepEqual([host.counts().image_calls, host.counts().reservations, host.counts().holds, host.counts().releases], [1, 1, holds, 0]);
    assert.deepEqual(host.selection(), initial); assert.equal((await host.history()).result.items.length, 1);
    const message = applyErrorMessage(result); assert.match(message, /may have been dispatched/);
    assert.doesNotMatch(message, /no paid call|no operation was dispatched|did not dispatch/i);
    if (fault === 'connection-loss') assert.match(message, /reservation may remain held/);
    assert.match(applyErrorMessage({ code: 'unrecognized_failure' }), /not confirmed/);
    t.diagnostic(JSON.stringify({ controls_probe: 'postdispatch_outcome', fault, code: result.code,
      operation_id: result.operation_id, backend_field: result.backend_error.field, message, counts: host.counts(), live_application_calls: 0 }));
  });
}

test('expanded scalar privacy differential preserves all 234 reviewed cases', t => {
  const values = new Set();
  for (const prefix of ['', 'design.', 'design:', '_', 'abc-', 'abc+', 'foo_']) {
    for (const value of ['ghp_' + 'a'.repeat(36), 'AKIA' + 'A'.repeat(16), 'sk-' + 'a'.repeat(30), 'api_key:inert',
      'admission-token:inert', '212-555-0100', 'Bearer+inert-test', 'Bearer+a:ordinary', 'Basic+shapes']) values.add(prefix + value);
  }
  for (const raw of [':', ':pass', 'user:', 'user:pass:extra', 'é:ù', 'a:ÿ', 'a:ú', 'user:🦊', 'illustrations', 'shape', 'benign']) {
    for (const prefix of ['', 'id.', 'foo:']) for (const suffix of ['', ':ordinary', '.suffix']) for (const padded of [true, false]) {
      const encoded = Buffer.from(raw).toString('base64'); values.add(prefix + 'Basic+' + (padded ? encoded : encoded.replace(/=+$/, '')) + suffix);
    }
  }
  let rejected = 0, accepted = 0, sensitiveAccepted = 0;
  for (const value of values) {
    if (validId(value)) {
      accepted++; if (containsSensitivePublicText(value)) sensitiveAccepted++;
      const state = fixtureState(); state.versions.design = value; assertRenderableSchema(createControlSchema(state));
    } else rejected++;
  }
  assert.deepEqual([values.size, rejected, accepted, sensitiveAccepted], [234, 181, 53, 0]);
  t.diagnostic(JSON.stringify({ controls_probe: 'privacy_differential', cases: values.size, rejected, accepted, sensitive_accepted: sensitiveAccepted }));
});


test('history errors retain typed recovery guidance and screen unknown/prototype/backend text', () => {
  assert.match(historyErrorMessage({ error: { code: 'stale_version' } }), /Refresh controls.*before restoring/);
  assert.match(historyErrorMessage({ error: { code: 'permission' } }), /Permission denied.*current authorized project access/);
  assert.match(historyErrorMessage({ error: { code: 'permission_denied' } }), /Permission denied.*current authorized project access/);
  const fallback = historyErrorMessage({});
  for (const code of ['unavailable', 'failed', '__proto__', 'constructor', '<script>inert</script>']) {
    const value = historyErrorMessage({ error: { code, message: 'Bearer inert-private-fixture' } });
    assert.equal(value, fallback); assert.doesNotMatch(value, /Bearer|script|no paid call|No operation was dispatched/);
  }
});
