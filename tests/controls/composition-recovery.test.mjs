import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { createIntegratedHost, fixturePrincipal as principal } from '../../fixtures/controls/integrated-host.mjs';
import { assertCompositionCompletion } from '../../src/controls/composition-view.mjs';

// Real public API/jobs/SQLite; mock membership, rights and preview producer only.
async function setup(t) {
  const directory=await mkdtemp(join(tmpdir(),'composition-recovery-'));
  const host=await createIntegratedHost(directory,{enableComposition:true,lockLogo:false});
  t.after(async()=>{host.close();await rm(directory,{recursive:true,force:true});}); return host;
}
const init=(view,id)=>({action_version:'creative-composition-initialize/1.0',action_id:id,review_sha256:view.review.review_sha256,intent:'initialize'});
const edit=(view,id,size='large')=>({action_version:'creative-composition-apply/1.0',action_id:id,projection_sha256:view.projection.projection_sha256,intent:'apply',draft:{categories:{name_size:size},exact:{}}});
function failure(result,id,code) {assert.equal(result.ok,false);assert.equal(result.action_id,id);assert.equal(result.approval,false);assert.equal(result.purchase,false);if(code)assert.equal(result.code,code);assertCompositionCompletion(result,id);}
async function initialized(host,id='initialize') {const view=await host.composition.current(principal);assert.equal((await host.composition.apply(principal,init(view,id))).ok,true);return host.composition.current(principal);}

test('expired reviewed Apply is a closed definitive rejection; explicit renewal and fresh Apply remain possible',async t=>{
  const host=await setup(t), view=await initialized(host), input=edit(view,'expired-action');
  await host.composition.review(principal,{projection_sha256:input.projection_sha256,draft:input.draft});
  host.advance(60001);const before=host.counts();
  const result=await host.composition.apply(principal,input);failure(result,input.action_id,'stale_version');assert.equal(result.status,'stale');
  assert.equal(host.composition.row(principal,input.action_id),undefined);
  assert.equal(result.recovery,'not_admitted');assert.deepEqual(await host.composition.lookup(principal,input.action_id),result);assert.deepEqual(await host.composition.retry(principal,input.action_id),result);
  assert.deepEqual(host.counts(),before);host.restartAdapter();assert.deepEqual(await host.composition.lookup(principal,input.action_id),result);
  const history=await host.composition.history(principal);assert.equal(history.review.can_renew,true);
  const renewal={action_version:'creative-composition-renew/1.0',action_id:'renew-after-rejection',intent:'renew',review_sha256:history.review.review_sha256};
  assert.equal((await host.composition.apply(principal,renewal)).ok,true);
  const fresh=await host.composition.current(principal), saved=await host.composition.apply(principal,edit(fresh,'fresh-action'));
  assert.equal(saved.ok,true);assert.notEqual(saved.revision_sha256,view.projection.base.revision_sha256);
  assert.deepEqual([host.counts().image_calls,host.counts().jev_calls,host.counts().reservations],[0,0,0]);
});

test('superseded initialization and every valid-identity pre-admission failure retain the closed action envelope',async t=>{
  const host=await setup(t), initial=await host.composition.current(principal);
  assert.equal((await host.composition.apply(principal,init(initial,'other-tab-initialize'))).ok,true);
  const rejected=init(initial,'superseded-initialize');failure(await host.composition.apply(principal,rejected),rejected.action_id,'stale_version');
  assert.equal(host.composition.row(principal,rejected.action_id),undefined);assert.equal((await host.composition.lookup(principal,rejected.action_id)).recovery,'not_admitted');
  const unsupported={...rejected,action_id:'unsupported',action_version:'creative-composition-apply/9.0'};
  failure(await host.composition.apply(principal,unsupported),unsupported.action_id,'unsupported_version');
  failure(await host.composition.apply(null,{...rejected,action_id:'bad-principal'}),'bad-principal');
  host.adapter.db.exec('BEGIN');try {failure(await host.composition.apply(principal,{...rejected,action_id:'borrowed-transaction'}),'borrowed-transaction');}finally{host.adapter.db.exec('ROLLBACK');}
  const original=init(initial,'other-tab-initialize'), changed={...original,intent:'wrong-intent'};
  failure(await host.composition.apply(principal,changed),changed.action_id,'conflict');
  const cancellation=await host.composition.cancel(principal,'not-admitted');
  assert.deepEqual(cancellation,{ok:false,status:'unknown',action_id:'not-admitted',approval:false,purchase:false});
});

test('raced conflicting Apply has a closed envelope while genuine pending and identical replay remain pending until completion',async t=>{
  const host=await setup(t), view=await initialized(host), first=edit(view,'raced-action','large'), changed=edit(view,'raced-action','small');
  host.block('composition-owner');const pending=host.composition.apply(principal,first), conflict=host.composition.apply(principal,changed);
  host.release();host.block('composition-preview');
  let saved;
  try {
    const deadline=Date.now()+5000;while(host.waiting!=='composition-preview'&&Date.now()<deadline)await setImmediate();
    assert.equal(host.waiting,'composition-preview');const refused=await conflict;failure(refused,first.action_id,'conflict');assert.equal(refused.recovery,'unknown');
    const read=await host.composition.lookup(principal,first.action_id);failure(read,first.action_id,'unavailable');assert.equal(read.status,'unknown');
    assert.ok(host.composition.row(principal,first.action_id).job_id);
    const duplicate=host.composition.apply(principal,first);assert.equal(host.composition.inflight.size,1);
    host.release();const results=await Promise.all([pending,duplicate]);assert.deepEqual(results[0],results[1]);saved=results[0];
  } finally {host.release();await Promise.allSettled([pending,conflict]);}
  assert.equal(saved.ok,true);assert.equal(host.counts().composition_previews,1);
  const read=await host.composition.lookup(principal,first.action_id);assert.equal(read.ok,true);assert.equal(read.revision_sha256,saved.revision_sha256);
});

test('revoked edit context rejects a duplicate but cannot turn the held original into a terminal operation',async t=>{
  const host=await setup(t),view=await initialized(host),input=edit(view,'held-before-revocation');host.block('composition-preview');
  const pending=host.composition.apply(principal,input);
  try {
    const deadline=Date.now()+5000;while(host.waiting!=='composition-preview'&&Date.now()<deadline)await setImmediate();assert.equal(host.waiting,'composition-preview');
    const row=host.composition.row(principal,input.action_id);assert.ok(row.job_id);host.policy.can_apply=false;
    const duplicate=await host.composition.apply(principal,input);failure(duplicate,input.action_id,'permission_denied');assert.equal(duplicate.status,'failed');assert.equal(duplicate.recovery,'unknown');assert.equal(duplicate.backend_job_id,row.job_id);
    const retry=await host.composition.retry(principal,input.action_id);failure(retry,input.action_id);assert.equal(retry.status,'unknown');
    const read=await host.composition.lookup(principal,input.action_id);assert.equal(read.status,'unknown');assert.equal(read.recovery,'unknown');
    assert.equal(host.adapter.db.prepare('SELECT COUNT(*) AS n FROM control_composition_rejections_v1 WHERE action_id=?').get(input.action_id).n,0);
    host.policy.can_apply=true;host.release();assert.equal((await pending).ok,true);
    host.restartAdapter();const recovered=await host.composition.lookup(principal,input.action_id);assert.equal(recovered.ok,true);assert.equal(recovered.backend_job_id,row.job_id);assert.equal(host.counts().composition_previews,1);
  } finally {host.policy.can_apply=true;host.release();await Promise.allSettled([pending]);}
});

test('durable non-admission wins exclusively against a pre-journal Apply on another SQLite connection',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'composition-admission-race-'));
  const hostA=await createIntegratedHost(directory,{enableComposition:true,lockLogo:false});
  const hostB=await createIntegratedHost(directory,{enableComposition:true,lockLogo:false});
  t.after(async()=>{hostA.close();hostB.close();await rm(directory,{recursive:true,force:true});});
  const view=await initialized(hostA),input=edit(view,'admission-versus-rejection');hostA.block('composition-owner');
  const pending=hostA.composition.apply(principal,input);
  try {
    const deadline=Date.now()+5000;while(hostA.waiting!=='composition-owner'&&Date.now()<deadline)await setImmediate();assert.equal(hostA.waiting,'composition-owner');
    const rejected=await hostB.composition.apply(principal,{...input,action_version:'creative-composition-apply/9.0'});failure(rejected,input.action_id,'unsupported_version');assert.equal(rejected.recovery,'not_admitted');
    hostA.release();assert.deepEqual(await pending,rejected);assert.equal(hostA.composition.row(principal,input.action_id),undefined);
    assert.deepEqual(await hostA.composition.lookup(principal,input.action_id),rejected);assert.equal(hostA.counts().composition_previews,0);assert.equal(hostB.counts().composition_previews,0);
  } finally {hostA.release();await Promise.allSettled([pending]);}
});
