import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { createIntegratedHost } from '../../fixtures/controls/integrated-host.mjs';
import { fixtureCompositionPolicy } from '../../fixtures/controls/composition-policy.mjs';
import { CompositionControlsAdapter } from '../../src/controls/composition-integration.mjs';
import { canonical } from '../../src/controls/schema.mjs';
import { canonicalHash } from 'creative-engine/contracts';

const pairs = [
  [{ tenant_id: 'tenant:a', project_id: 'project', actor_id: 'actor-a' }, { tenant_id: 'tenant', project_id: 'a:project', actor_id: 'actor-b' }, 'apply', 'apply'],
  [{ tenant_id: 'tenant', project_id: 'project:a', actor_id: 'actor-a' }, { tenant_id: 'tenant', project_id: 'project', actor_id: 'actor-b' }, 'apply', 'a:apply'],
];

// The public API, real CreativeVersionStore/paired jobs ports and actual SQLite
// publication are retained. Membership/rights and preview producer are MOCK
// fixture authority; no provider/network or production typography is exercised.
for (const [a,b,actionA,actionB] of pairs) test(`public composition Apply/replay isolates colon-colliding scope/action tuples ${actionA}/${actionB}`, { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'composition-scope-'));
  const hosts = [];
  t.after(async () => { for (const host of hosts) host.close(); await rm(directory, { recursive:true, force:true }); });
  // Separate connections to the SAME durable backend and controls databases.
  // Fixture setup failure is intentionally a failure, never a skip or fake store.
  const hostA = await createIntegratedHost(directory, { principal:a, enableComposition:true, lockLogo:false }); hosts.push(hostA);
  const hostB = await createIntegratedHost(directory, { principal:b, enableComposition:true, lockLogo:false }); hosts.push(hostB);
  const identity = p => canonical([p.tenant_id,p.project_id]);
  const routes = new Map([[identity(a),hostA],[identity(b),hostB]]);
  const route = input => {
    const p = input?.scope ?? input?.trusted_scope ?? input;
    const host = routes.get(identity(p)); assert.ok(host, 'Every public backend call carries an exact routed scope'); return host;
  };
  const ports = { ...hostA.ports };
  for (const group of ['storage','jobs','planning','composition']) {
    ports[group] = { ...hostA.ports[group] };
    for (const [key,value] of Object.entries(ports[group])) if (typeof value === 'function')
      ports[group][key] = (input,...rest) => route(input).ports[group][key](input,...rest);
  }
  const makeAdapter = () => new CompositionControlsAdapter({ database:hostA.adapter.db, ports,
    readContext:p => route(p).adapter.context(p), readPolicy:() => fixtureCompositionPolicy(Date.parse('2026-10-10T12:30:00Z')),
    now:() => Date.parse('2026-10-10T12:30:00Z') });
  let adapter = makeAdapter();
  for (const p of [a,b]) {
    const view = await adapter.current(p); assert.equal(view.status,'not_initialized',JSON.stringify(view));
    const result = await adapter.apply(p,{ action_version:'creative-composition-initialize/1.0',action_id:'initialize',review_sha256:view.review.review_sha256,intent:'initialize' });
    assert.equal(result.ok,true,JSON.stringify(result));
  }
  const inputs=[];
  for (const [p,id,text] of [[a,actionA,'Scope A Name'],[b,actionB,'Scope B Name']]) {
    const view=await adapter.current(p); assert.equal(view.status,'current',JSON.stringify(view));
    inputs.push({ action_version:'creative-composition-apply/1.0',action_id:id,projection_sha256:view.projection.projection_sha256,intent:'apply',draft:{categories:{},exact:{text}} });
  }
  assert.equal(`${a.tenant_id}:${a.project_id}:${actionA}`,`${b.tenant_id}:${b.project_id}:${actionB}`);
  hostA.block('composition-preview'); hostB.block('composition-preview');
  const pendingA=adapter.apply(a,inputs[0]), pendingB=adapter.apply(b,inputs[1]);
  // Always release even on assertion failure so node:test cannot hide dangling
  // public backend promises or an open SQLite transaction.
  let results;
  try {
    const deadline=Date.now()+5000;
    while ((hostA.waiting!=='composition-preview' || hostB.waiting!=='composition-preview') && Date.now()<deadline) await setImmediate();
    assert.equal(hostA.waiting,'composition-preview'); assert.equal(hostB.waiting,'composition-preview');
    assert.equal(adapter.inflight.size,2);
    assert.deepEqual([...adapter.inflight.keys()].sort(),[canonical([a.tenant_id,a.project_id,actionA]),canonical([b.tenant_id,b.project_id,actionB])].sort());
    const same=adapter.apply(a,inputs[0]); assert.equal(adapter.inflight.size,2);
    hostA.release(); hostB.release();
    const all=await Promise.all([pendingA,pendingB,same]); results=all.slice(0,2); assert.deepEqual(all[2],all[0]);
  } finally {
    hostA.release(); hostB.release(); await Promise.allSettled([pendingA,pendingB]);
  }
  assert.equal(adapter.inflight.size,0);
  for (const [i,p,host,id,text] of [[0,a,hostA,actionA,'Scope A Name'],[1,b,hostB,actionB,'Scope B Name']]) {
    const result=results[i]; assert.equal(result.ok,true,JSON.stringify(result)); assert.equal(result.action_id,id);
    const row=adapter.row(p,id), request=JSON.parse(row.request_json);
    assert.equal(request.tenant_id,p.tenant_id); assert.equal(request.project_id,p.project_id); assert.equal(request.action_id,id);
    assert.equal(row.actor_id,p.actor_id); assert.equal(canonicalHash(request),row.request_hash); assert.equal(result.request_sha256,row.request_hash);
    const job=await host.ports.jobs.get({scope:p,job_id:result.backend_job_id});
    assert.equal(job.status,'completed'); assert.equal(job.action_id,id); assert.equal(job.request_hash,row.backend_request_hash);
    const durable=await host.ports.storage.getCompositionAction({scope:host.scope,action_id:id});
    assert.equal(durable.status,'published'); assert.equal(durable.revision.tenant_id,p.tenant_id); assert.equal(durable.revision.project_id,p.project_id);
    assert.equal(durable.revision.revision_sha256,result.revision_sha256);
    assert.equal(durable.revision.layer_manifest.find(x=>x.layer_id==='layer:name').value,text);
  }
  assert.notEqual(results[0].backend_job_id,results[1].backend_job_id); assert.notEqual(results[0].revision_sha256,results[1].revision_sha256);
  const rowsBefore=hostA.store.db.prepare('SELECT * FROM creative_composition_current_v1 ORDER BY tenant_id,project_id').all();
  const countsBefore=hosts.map(host=>host.counts()); adapter=makeAdapter();
  const replay=await Promise.all([adapter.apply(a,inputs[0]),adapter.apply(b,inputs[1])]);
  for (const i of [0,1]) { assert.equal(replay[i].ok,true,JSON.stringify(replay[i])); assert.equal(replay[i].historical,true);
    for (const key of ['action_id','backend_job_id','request_sha256','revision_id','revision_sha256','preview']) assert.deepEqual(replay[i][key],results[i][key]); }
  assert.deepEqual(hostA.store.db.prepare('SELECT * FROM creative_composition_current_v1 ORDER BY tenant_id,project_id').all(),rowsBefore);
  assert.deepEqual(hosts.map(host=>host.counts()),countsBefore);
  assert.equal((await adapter.apply({...a,actor_id:'other-actor'},inputs[0])).ok,false);
  assert.equal((await adapter.apply(a,{...inputs[0],draft:{categories:{name_size:'small'},exact:{}}})).code,'conflict');
  for (const host of hosts) assert.deepEqual([host.counts().image_calls,host.counts().jev_calls,host.counts().reservations],[0,0,0]);
});
