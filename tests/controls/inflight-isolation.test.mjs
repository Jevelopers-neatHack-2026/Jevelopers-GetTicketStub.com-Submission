import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CompositionControlsAdapter } from '../../src/controls/composition-integration.mjs';
import { InspectionControlsAdapter } from '../../src/controls/inspection-integration.mjs';
import { CreativeControlsAdapter } from '../../src/controls/integration.mjs';
import { canonicalHash } from 'creative-engine/contracts';
import { canonical, validId } from '../../src/controls/schema.mjs';

const principal = (tenant_id, project_id) => ({ tenant_id, project_id, actor_id: 'actor' });
const pairs = [
  [principal('tenant:a', 'project'), principal('tenant', 'a:project'), 'action', 'action'],
  [principal('tenant', 'project:a'), principal('tenant', 'project'), 'action', 'a:action'],
];
const context = p => ({ actor: { ...p, permissions: ['creative.read', 'creative.edit'], expires_at: '2099-01-01T00:00:00Z' },
  brief: { ...p, brief_id: 'brief' }, design: { ...p, brief_id: 'brief', design_version_id: 'design', design_hash: 'hash' },
  selection: { design_version_id: 'design', design_hash: 'hash' }, policy: { can_read: true, can_apply: true }, brief_usable: true });
const action = action_id => ({ action_version: 'creative-composition-apply/1.0', action_id, intent: 'apply',
  projection_sha256: 'sha256:' + '0'.repeat(64), draft: { categories: { name_size: 'large' }, exact: {} } });
function insert(adapter, p, input) {
  const request = { tenant_id: p.tenant_id, project_id: p.project_id, action_id: input.action_id,
    operation: 'composition.update', payload: { brief_id: 'brief', design_version_id: 'design' } };
  adapter.db.prepare(`INSERT INTO control_composition_actions_v1
    (tenant_id,project_id,actor_id,action_id,action_json,action_hash,request_json,request_hash,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(p.tenant_id, p.project_id, p.actor_id, input.action_id,
    canonical(input), canonicalHash(input), canonical(request), canonicalHash(request), 0);
}

// Admission regression only: real Apply/context/SQLite persistence and row checks,
// with consume suspended in place of the backend. Public-backend qualification
// lives separately in composition-scope-backend.test.mjs; this is no render proof.
for (const [a, b, actionA, actionB] of pairs) test(`composition Apply isolates concurrent colon-colliding scope/action tuples ${actionA}/${actionB}`, async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const adapter = new CompositionControlsAdapter({ database: db, ports: { jobs: { begin() { throw Error('Unused backend'); } } },
    readContext: context, readPolicy() { throw Error('Unused policy'); }, now: () => 0 });
  for (const id of [...Object.values(a), ...Object.values(b), actionA, actionB]) assert.equal(validId(id), true);
  const inputA = action(actionA), inputB = action(actionB);
  insert(adapter, a, inputA); insert(adapter, b, inputB);
  assert.equal(`${a.tenant_id}:${a.project_id}:${actionA}`, `${b.tenant_id}:${b.project_id}:${actionB}`);
  const realConsume = adapter.consume.bind(adapter);
  let release; const gate = new Promise(resolve => { release = resolve; }); const calls = [];
  adapter.consume = async (p, row) => {
    const request = JSON.parse(row.request_json);
    assert.equal(canonicalHash(request), row.request_hash);
    assert.equal(request.tenant_id, p.tenant_id); assert.equal(request.project_id, p.project_id);
    assert.equal(request.action_id, row.action_id);
    calls.push(canonical([p.tenant_id, p.project_id, row.action_id]));
    await gate;
    return { tenant_id: p.tenant_id, project_id: p.project_id, action_id: row.action_id, request_sha256: row.request_hash };
  };
  const first = adapter.apply(a, inputA), second = adapter.apply(b, inputB), same = adapter.apply(a, inputA);
  assert.equal(calls.length, 2); assert.equal(adapter.inflight.size, 2);
  assert.deepEqual([...adapter.inflight.keys()].sort(), [canonical([a.tenant_id,a.project_id,actionA]), canonical([b.tenant_id,b.project_id,actionB])].sort());
  const otherActor = await adapter.apply({ ...a, actor_id: 'different-actor' }, inputA);
  assert.equal(otherActor.ok, false); assert.equal(calls.length, 2);
  const conflict = await adapter.apply(a, { ...inputA, draft: { categories: { name_size: 'small' }, exact: {} } });
  assert.equal(conflict.code, 'conflict'); assert.equal(calls.length, 2);
  release(); const [resultA, resultB, duplicate] = await Promise.all([first, second, same]);
  assert.deepEqual(duplicate, resultA); assert.notDeepEqual(resultA, resultB);
  for (const [p, input, result] of [[a,inputA,resultA],[b,inputB,resultB]]) {
    assert.equal(result.tenant_id, p.tenant_id); assert.equal(result.project_id, p.project_id); assert.equal(result.action_id, input.action_id);
    const row = adapter.row(p, input.action_id), request = JSON.parse(row.request_json);
    assert.equal(request.tenant_id, p.tenant_id); assert.equal(request.project_id, p.project_id);
    assert.equal(canonicalHash(request), result.request_sha256);
    assert.deepEqual(await adapter.apply(p, input), result);
  }
  assert.equal(calls.length, 4); assert.equal(adapter.inflight.size, 0);
  // The production consumer must reject a persisted request from the other scope
  // even when its stored hash has been recomputed, before invoking a backend.
  adapter.consume = realConsume;
  const row = adapter.row(a, actionA), wrong = { ...JSON.parse(row.request_json), project_id: 'wrong-project' };
  db.prepare('UPDATE control_composition_actions_v1 SET request_json=?,request_hash=? WHERE tenant_id=? AND project_id=? AND action_id=?')
    .run(canonical(wrong), canonicalHash(wrong), a.tenant_id, a.project_id, actionA);
  let invoked = 0; adapter.api = { invoke: async () => { invoked++; throw Error('Must not invoke'); } };
  assert.equal((await adapter.apply(a, inputA)).code, 'unavailable'); assert.equal(invoked, 0);
  assert.equal(adapter.inflight.size, 0);
});

test('inspection execution uses canonical tuples and exact same-scope deduplication', async () => {
  // This execution seam checks only the map. Slash-bearing rows are deliberately
  // internal fixtures, outside public validId grammar, to prevent delimiter
  // encoding from becoming an implicit dependency on future identifier grammar.
  const adapter = Object.create(InspectionControlsAdapter.prototype); adapter.inflight = new Map();
  let release; const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  adapter.invoke = async (p, row) => { calls++; await gate; return { ...p, action_id: row.action_id }; };
  const a = principal('tenant/a', 'project'), b = principal('tenant', 'a/project');
  const row = p => ({ ...p, action_id: 'same-action' });
  const first = adapter.execute(a, row(a)), second = adapter.execute(b, row(b)), same = adapter.execute(a, row(a));
  assert.equal(calls, 2); assert.equal(adapter.inflight.size, 2);
  assert.deepEqual([...adapter.inflight.keys()], [canonical([a.tenant_id,a.project_id,'same-action']),canonical([b.tenant_id,b.project_id,'same-action'])]);
  release(); const [resultA,resultB,duplicate] = await Promise.all([first,second,same]);
  assert.deepEqual(duplicate,resultA); assert.equal(resultB.tenant_id,b.tenant_id); assert.notDeepEqual(resultA,resultB);
  assert.equal(adapter.inflight.size,0);
});

test('artwork Apply uses scoped canonical operation tuples and clears rejected work', async () => {
  // Store/consume admission seam: production ApplyStore generates globally unique
  // operation IDs. Reusing one here explicitly exercises the adapter's scope key.
  const adapter = Object.create(CreativeControlsAdapter.prototype); adapter.inflight = new Map();
  adapter.store = { apply() { return { ok: true, operation_id: 'operation' }; } };
  let release; const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  adapter.consume = async p => { calls++; await gate; return p; };
  const a = principal('tenant:a','project'), b = principal('tenant','a:project');
  const first=adapter.apply(a,{}), second=adapter.apply(b,{}), same=adapter.apply(a,{});
  assert.equal(calls,2); assert.deepEqual([...adapter.inflight.keys()], [canonical([a.tenant_id,a.project_id,'operation']),canonical([b.tenant_id,b.project_id,'operation'])]);
  release(); const [resultA,resultB,duplicate]=await Promise.all([first,second,same]);
  assert.deepEqual(duplicate,resultA); assert.equal(resultB.tenant_id,b.tenant_id); assert.equal(adapter.inflight.size,0);
  adapter.consume = async () => { throw Error('backend failure'); };
  await assert.rejects(adapter.apply(a,{}), /backend failure/); assert.equal(adapter.inflight.size,0);
});
