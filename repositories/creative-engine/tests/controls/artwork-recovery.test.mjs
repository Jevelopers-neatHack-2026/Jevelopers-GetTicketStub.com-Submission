import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createIntegratedHost, fixturePrincipal as principal } from '../../fixtures/controls/integrated-host.mjs';
import { hash } from '../../src/controls/actions.mjs';
import { defaultDraft } from '../../src/controls/schema.mjs';
import { projectApplyResult } from '../../src/controls/public-result.mjs';
import { assertArtworkRecovery } from '../../src/controls/artwork-recovery.mjs';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'artwork-recovery-'));
  const host = await createIntegratedHost(directory, { enableComposition: true, lockLogo: false });
  t.after(async () => { host.close(); await rm(directory, { recursive: true, force: true }); });
  return { host, directory };
}
function action(host, id, value = 'vibrant', schema = host.schema()) {
  const draft = defaultDraft(schema); draft.selections.c04 = value;
  return { action_version: `creative-apply/${schema.schema_version.split('/')[1]}`, schema_version: schema.schema_version,
    action_id: id, tenant_id: schema.tenant_id, project_id: schema.project_id, brief_id: schema.brief_id,
    expected_versions: schema.expected_versions, intent: 'apply', draft, draft_hash: hash(draft), control_schema_hash: `sha256:${hash(schema)}` };
}
const identity = action_id => ({ tenant_id: principal.tenant_id, project_id: principal.project_id, action_id });
const effects = host => [host.counts().image_calls, host.counts().jev_calls, host.counts().reservations, host.counts().jobs];
async function waiting(host, expected) {
  const deadline = Date.now() + 5000;
  while (host.waiting !== expected && Date.now() < deadline) await setImmediate();
  assert.equal(host.waiting, expected);
}

test('stale reviewed style has durable scoped non-admission across response loss/reopen and allows a fresh reviewed artwork child', async t => {
  const { host } = await setup(t), original = action(host, 'style_original');
  assert.equal((await host.adapter.apply(principal, { ...original, action_id: 'style_other-tab' })).status, 'completed');
  const before = effects(host), rejected = await host.adapter.applyReviewedArtwork(principal, original);
  assertArtworkRecovery(rejected, identity(original.action_id));
  assert.equal(rejected.recovery, 'not_admitted'); assert.equal(rejected.code, 'stale_version');
  assert.equal(rejected.status, 'rejected'); assert.equal(rejected.approval, false); assert.equal(rejected.purchase, false);
  assert.equal(host.adapter.lookup(principal, original.action_id), null);
  assert.equal(projectApplyResult(rejected).status, undefined, 'old result consumers cannot treat the new rejection as a completed Apply');
  // Deliberately discard the first response; only the opaque identity survives.
  host.restartAdapter();
  assert.deepEqual(await host.adapter.readArtworkAction(principal, original.action_id), rejected);
  assert.deepEqual(await host.adapter.retryArtworkAction(principal, original.action_id), rejected);
  assert.deepEqual(effects(host), before);
  const fresh = action(host, 'style_fresh', 'calm'), saved = await host.adapter.applyReviewedArtwork(principal, fresh);
  assert.equal(saved.recovery, 'terminal'); assert.equal(saved.status, 'completed');
  assert.equal(projectApplyResult(saved).result.design_version.design_version_id, saved.result.design_version.design_version_id);
  assert.equal(saved.result.design_version.design_version_id, host.selection().design_version_id);
  assert.deepEqual(effects(host), [2, 0, 2, 2]);
  assert.equal((await host.adapter.apply(principal, action(host, original.action_id, 'vibrant'))).code, 'stale_version');
  assert.deepEqual(effects(host), [2, 0, 2, 2], 'a rejected identity cannot execute through legacy Apply after authority becomes fresh');
});

test('completed artwork recovery is a historical scoped read and identical retry makes no additional reservation or image call', async t => {
  const { host } = await setup(t), input = action(host, 'style_saved');
  const saved = await host.adapter.applyReviewedArtwork(principal, input); assert.equal(saved.status, 'completed');
  host.restartAdapter(); const before = effects(host), tables = () => ({ jobs: host.adapter.db.prepare('SELECT * FROM control_jobs').all(), completions: host.adapter.db.prepare('SELECT * FROM control_completions').all(), audit: host.adapter.db.prepare('SELECT * FROM control_audit').all() });
  const original = tables(); host.policy.can_apply = false;
  assert.deepEqual(await host.adapter.readArtworkAction(principal, input.action_id), saved);
  assert.deepEqual(await host.adapter.retryArtworkAction(principal, input.action_id), saved);
  assert.deepEqual(tables(), original); assert.deepEqual(effects(host), before);
  host.policy.can_read = false; assert.equal(await host.adapter.readArtworkAction(principal, input.action_id), null);
});

test('lost non-admission and completed response survive a genuinely separate process with only original identities', async t => {
  const { host, directory } = await setup(t), stale = action(host, 'style_process-stale'), winner = { ...stale, action_id: 'style_process-winner' };
  const saved = await host.adapter.applyReviewedArtwork(principal, winner), rejected = await host.adapter.applyReviewedArtwork(principal, stale);
  assert.equal(saved.status, 'completed'); assert.equal(rejected.recovery, 'not_admitted');
  const identitiesPath = join(directory, 'identities.json'); await writeFile(identitiesPath, JSON.stringify({ action_ids: [stale.action_id, winner.action_id] }));
  host.close();
  const receipt = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../../fixtures/controls/artwork-restart-worker.mjs', import.meta.url)), directory, identitiesPath], { encoding: 'utf8', timeout: 15000 }));
  assert.equal(receipt.node_executable, process.execPath); assert.equal(receipt.mode, 'mock'); assert.equal(receipt.live_calls, 0);
  assert.deepEqual(receipt.results, [{ action_id: stale.action_id, read: rejected, retry: rejected }, { action_id: winner.action_id, read: saved, retry: saved }]);
  assert.equal(receipt.counters.image_calls, 0); assert.equal(receipt.counters.reservations, 0); assert.equal(receipt.counters.jobs, 1);
});

test('unknown before admission, revoked authority and hostile principal remain uncertain without minting a negative receipt', async t => {
  const { host } = await setup(t), id = 'style_never-received';
  const unknown = await host.adapter.readArtworkAction(principal, id);
  assert.equal(unknown.recovery, 'unknown'); assert.equal(unknown.status, 'unknown'); assert.equal(Object.hasOwn(unknown, 'operation_id'), false);
  assert.deepEqual(await host.adapter.retryArtworkAction(principal, id), unknown);
  assert.equal(host.adapter.db.prepare('SELECT COUNT(*) AS n FROM control_artwork_rejections_v1').get().n, 0);
  assert.deepEqual(effects(host), [0, 0, 0, 0]);
  for (const p of [{ ...principal, actor_id: 'other_actor' }, { ...principal, tenant_id: 'other_tenant' }, { ...principal, project_id: 'other_project' }]) {
    assert.equal(await host.adapter.readArtworkAction(p, id), null);
    assert.equal(await host.adapter.retryArtworkAction(p, id), null);
  }
  host.policy.can_read = false;
  assert.equal(await host.adapter.readArtworkAction(principal, id), null);
  assert.equal(host.adapter.db.prepare('SELECT COUNT(*) AS n FROM control_artwork_rejections_v1').get().n, 0);
});

test('negative receipt is hash checked, actor bound, private and mutually exclusive with action admission', async t => {
  const { host, directory } = await setup(t), other = await createIntegratedHost(directory, { enableComposition: true, lockLogo: false });
  t.after(() => other.close());
  const input = action(host, 'style_rejected'), rejected = await host.adapter.applyReviewedArtwork(principal, { ...input, action_version: 'creative-apply/9.0' });
  assert.equal(rejected.recovery, 'not_admitted');
  assert.deepEqual(await other.adapter.applyReviewedArtwork(principal, input), rejected);
  assert.equal((await other.adapter.apply(principal, input)).code, 'unsupported_version');
  assert.equal(host.adapter.lookup(principal, input.action_id), null);
  const row = host.adapter.db.prepare('SELECT * FROM control_artwork_rejections_v1 WHERE action_id=?').get(input.action_id);
  assert.equal(JSON.stringify(row).includes('draft'), false); assert.equal(JSON.stringify(row).includes('vibrant'), false);
  host.adapter.db.prepare('UPDATE control_artwork_rejections_v1 SET code=? WHERE action_id=?').run('stale_schema', input.action_id);
  assert.equal(await host.adapter.readArtworkAction(principal, input.action_id), null);
  assert.equal(await host.adapter.retryArtworkAction(principal, input.action_id), null);
  assert.equal((await host.adapter.apply(principal, input)).ok, false);
  host.adapter.db.prepare('UPDATE control_artwork_rejections_v1 SET code=? WHERE action_id=?').run(row.code, input.action_id);
  for (const field of ['actor_id', 'tenant_id', 'project_id']) assert.equal(await host.adapter.readArtworkAction({ ...principal, [field]: 'other' }, input.action_id), null);
  assert.deepEqual(effects(host), [0, 0, 0, 0]); assert.deepEqual(effects(other), [0, 0, 0, 0]);
});

test('a rejected duplicate on another connection cannot terminalize an already admitted pending artwork action', async t => {
  const { host, directory } = await setup(t), other = await createIntegratedHost(directory, { enableComposition: true, lockLogo: false });
  t.after(() => other.close());
  const input = action(host, 'style_pending'); host.block('native-post-ack');
  const pending = host.adapter.applyReviewedArtwork(principal, input);
  try {
    await waiting(host, 'native-post-ack');
    const refusal = await other.adapter.applyReviewedArtwork(principal, { ...input, action_version: 'creative-apply/9.0' });
    assert.equal(refusal.recovery, 'unknown'); assert.equal(refusal.status, 'unknown'); assert.ok(refusal.backend_job_id);
    assert.equal(host.adapter.db.prepare('SELECT COUNT(*) AS n FROM control_artwork_rejections_v1').get().n, 0);
    const before = effects(host);
    assert.deepEqual(await host.adapter.readArtworkAction(principal, input.action_id), refusal);
    assert.deepEqual(effects(host), before);
    const duplicate = host.adapter.retryArtworkAction(principal, input.action_id);
    host.release(); const [saved, replay] = await Promise.all([pending, duplicate]);
    assert.equal(saved.status, 'completed'); assert.deepEqual(replay, saved);
    assert.deepEqual(effects(host), [1, 0, 1, 1]);
  } finally { host.release(); await Promise.allSettled([pending]); }
});

test('authoritative cancellation reconciles on explicit retry, while status reads remain free of writes', async t => {
  const { host } = await setup(t), input = action(host, 'style_cancelled'); host.block('native-post-ack');
  const pending = host.adapter.applyReviewedArtwork(principal, input);
  try {
    await waiting(host, 'native-post-ack'); const operation = host.adapter.lookup(principal, input.action_id);
    assert.equal((await host.adapter.cancel(principal, operation.operation_id)).code, 'cancelled');
    host.release(); const cancelled = await pending;
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.recovery, 'terminal');
    const before = effects(host), audit = host.adapter.db.prepare('SELECT COUNT(*) AS n FROM control_audit').get().n;
    host.restartAdapter(); assert.deepEqual(await host.adapter.readArtworkAction(principal, input.action_id), cancelled);
    assert.deepEqual(await host.adapter.retryArtworkAction(principal, input.action_id), cancelled);
    assert.equal(host.adapter.db.prepare('SELECT COUNT(*) AS n FROM control_audit').get().n, audit); assert.deepEqual(effects(host), before);
  } finally { host.release(); await Promise.allSettled([pending]); }
});

test('actual failed backend action frees the local admission slot only after matched terminal recovery, without repeating a reservation', async t => {
  const { host } = await setup(t), input = action(host, 'style_failed');
  const edit = host.ports.provider.edit; host.setProviderFault('artifact-hash');
  const failed = await host.adapter.applyReviewedArtwork(principal, input);
  assert.equal(failed.status, 'failed'); assert.equal(failed.recovery, 'terminal');
  assert.equal((await host.ports.jobs.get({ scope: principal, job_id: failed.backend_job_id })).status, 'failed');
  const operation = host.adapter.lookup(principal, input.action_id), before = effects(host);
  assert.equal(operation.status, 'failed'); host.restartAdapter();
  assert.deepEqual(await host.adapter.readArtworkAction(principal, input.action_id), failed);
  assert.deepEqual(await host.adapter.retryArtworkAction(principal, input.action_id), failed);
  assert.equal(host.adapter.store.dispatch(principal, operation.operation_id).code, 'failed');
  assert.equal((await host.adapter.cancel(principal, operation.operation_id)).code, 'failed');
  assert.deepEqual(effects(host), before); assert.equal(host.adapter.lookup(principal, input.action_id).status, 'failed');
  host.ports.provider.edit = edit;
  const saved = await host.adapter.applyReviewedArtwork(principal, action(host, 'style_after-failure'));
  assert.equal(saved.status, 'completed'); assert.equal(host.counts().reservations, before[2] + 1); assert.equal(host.counts().image_calls, before[0] + 1);
});

test('persisted action, operation, binding, original completion and backend mismatch cannot unlock a reviewed identity', async t => {
  const { host } = await setup(t), input = action(host, 'style_corrupt'), saved = await host.adapter.applyReviewedArtwork(principal, input);
  const operationId = saved.operation_id, db = host.adapter.db, before = effects(host);
  const job = db.prepare('SELECT * FROM control_jobs WHERE operation_id=?').get(operationId), binding = db.prepare('SELECT * FROM control_api_bindings_v1 WHERE operation_id=?').get(operationId);
  const completion = db.prepare('SELECT * FROM control_completions WHERE operation_id=?').get(operationId);
  const payload = JSON.parse(job.payload); payload.draft.selections.c04 = 'calm';
  const operation = JSON.parse(job.operation); operation.tasks[0].changes[0].value = 'calm';
  const result = JSON.parse(binding.result_json); result.result.design_version.artifact.content_hash = `sha256:${'b'.repeat(64)}`;
  for (const [table, field, corrupt, original] of [
    ['control_jobs', 'payload', JSON.stringify(payload), job.payload], ['control_jobs', 'operation', JSON.stringify(operation), job.operation],
    ['control_api_bindings_v1', 'backend_request_hash', `sha256:${'a'.repeat(64)}`, binding.backend_request_hash],
    ['control_api_bindings_v1', 'result_json', JSON.stringify(result), binding.result_json],
    ['control_completions', 'completion_hash', '0'.repeat(64), completion.completion_hash],
  ]) {
    db.prepare(`UPDATE ${table} SET ${field}=? WHERE operation_id=?`).run(corrupt, operationId);
    assert.equal(await host.adapter.readArtworkAction(principal, input.action_id), null, field);
    assert.equal(await host.adapter.retryArtworkAction(principal, input.action_id), null, field);
    db.prepare(`UPDATE ${table} SET ${field}=? WHERE operation_id=?`).run(original, operationId);
    assert.deepEqual(await host.adapter.readArtworkAction(principal, input.action_id), saved);
    assert.deepEqual(effects(host), before);
  }
});

test('borrowed transactions reject before recovery callbacks and preserve the caller transaction', async t => {
  const { host } = await setup(t), input = action(host, 'style_borrowed');
  let reads = 0; const read = host.adapter.readContext; host.adapter.readContext = p => { reads++; return read(p); };
  for (const boundary of ['BEGIN', 'SAVEPOINT caller']) {
    host.adapter.db.exec(boundary);
    try {
      assert.equal(await host.adapter.applyReviewedArtwork(principal, input), null);
      assert.equal(await host.adapter.readArtworkAction(principal, input.action_id), null);
      assert.equal(await host.adapter.retryArtworkAction(principal, input.action_id), null);
      assert.equal(host.adapter.db.isTransaction, true); assert.equal(reads, 0);
    } finally { host.adapter.db.exec(boundary === 'BEGIN' ? 'ROLLBACK' : 'ROLLBACK TO caller; RELEASE caller'); }
  }
  assert.deepEqual(effects(host), [0, 0, 0, 0]);
});

test('missing original completion proof never falls back to API invocation or SQLite writes from recovery reads', async t => {
  const { host } = await setup(t), input = action(host, 'style_missing-proof'), saved = await host.adapter.applyReviewedArtwork(principal, input);
  const db = host.adapter.db; db.prepare('DELETE FROM control_completions WHERE operation_id=?').run(saved.operation_id);
  let invokes = 0; const api = host.adapter.api; host.adapter.api = { invoke(...args) { invokes++; return api.invoke(...args); } };
  const before = effects(host), changes = db.prepare('SELECT total_changes() AS n').get().n;
  assert.equal(await host.adapter.readArtworkAction(principal, input.action_id), null);
  assert.equal(await host.adapter.retryArtworkAction(principal, input.action_id), null);
  assert.equal((await host.adapter.readExisting(principal, input.action_id)).status, 'unknown');
  assert.equal(invokes, 0); assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes);
  assert.deepEqual(effects(host), before);
});

for (const method of ['readArtworkAction', 'readExisting']) {
  for (const deleteBinding of [false, true]) {
    test(`${method} preserves read-only recovery with ${deleteBinding ? 'a concurrent binding deletion' : 'an unchanged binding'}`, async t => {
      const { host, directory } = await setup(t), input = action(host, `style_read-race-${method}`);
      const saved = await host.adapter.applyReviewedArtwork(principal, input);
      assert.equal(saved.status, 'completed');
      const other = new DatabaseSync(join(directory, 'controls.sqlite'));
      const db = host.adapter.db, prepare = db.prepare;
      const query = sql => Reflect.apply(prepare, db, [sql]);
      const before = effects(host), changes = query('SELECT total_changes() AS n').get().n;
      const audit = query('SELECT COUNT(*) AS n FROM control_audit').get().n;
      let reads = 0, deleted = 0, invokes = 0;
      const api = host.adapter.api;
      host.adapter.api = { invoke(...args) { invokes++; return api.invoke(...args); } };
      // Delete through a real second connection after the public read obtains its
      // last scoped snapshot. The subsequent consume read must stay read-only.
      db.prepare = function(sql) {
        const statement = query(sql);
        const scopedRead = method === 'readArtworkAction'
          ? sql === 'SELECT * FROM control_api_bindings_v1 WHERE operation_id=?'
          : sql.startsWith('SELECT j.operation_id,j.status,b.result_json FROM control_jobs j LEFT JOIN control_api_bindings_v1');
        if (deleteBinding && scopedRead) {
          const get = statement.get;
          statement.get = function(...args) {
            const row = Reflect.apply(get, statement, args);
            if (++reads === (method === 'readArtworkAction' ? 2 : 1)) {
              assert.equal(db.isTransaction, false);
              deleted = Number(other.prepare('DELETE FROM control_api_bindings_v1 WHERE operation_id=?').run(saved.operation_id).changes);
            }
            return row;
          };
        }
        return statement;
      };
      let result;
      try { result = await host.adapter[method](principal, input.action_id); }
      finally { db.prepare = prepare; other.close(); }
      assert.equal(deleted, deleteBinding ? 1 : 0);
      if (!deleteBinding) assert.equal(result.status, 'completed');
      else if (method === 'readArtworkAction') assert.equal(result, null);
      else assert.equal(result.status, 'unknown');
      assert.equal(invokes, 0);
      assert.equal(query('SELECT total_changes() AS n').get().n, changes);
      assert.equal(query('SELECT COUNT(*) AS n FROM control_audit').get().n, audit);
      assert.deepEqual(effects(host), before);
    });
  }
}

test('closed recovery presentation rejects swapped identities, forged terminal cache and contradictory result fields without getters', async t => {
  const { host } = await setup(t), input = action(host, 'style_view'), saved = await host.adapter.applyReviewedArtwork(principal, input);
  for (const mutate of [x => { x.approval = true; }, x => { x.tenant_id = 'other'; }, x => { x.action_id = 'other'; },
    x => { x.schema_version = '2.0'; }, x => { x.raw_usage = {}; }, x => { x.result.design_version.artifact.content_hash = 'invalid'; },
    x => { x.recovery = 'not_admitted'; }, x => { delete x.backend_job_id; }]) {
    const altered = structuredClone(saved); mutate(altered); assert.throws(() => assertArtworkRecovery(altered, identity(input.action_id)));
  }
  const unknown = await host.adapter.readArtworkAction(principal, 'style_unknown');
  assert.throws(() => assertArtworkRecovery({ ...unknown, recovery: 'not_admitted' }, identity('style_unknown')));
  let hooks = 0; const hostile = structuredClone(saved); Object.defineProperty(hostile, 'result', { enumerable: true, get() { hooks++; return saved.result; } });
  assert.throws(() => assertArtworkRecovery(hostile, identity(input.action_id))); assert.equal(hooks, 0);
});
