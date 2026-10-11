import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIntegratedHost, fixturePrincipal as principal } from '../../fixtures/controls/integrated-host.mjs';
import { defaultDraft } from '../../src/controls/schema.mjs';
import { hash } from '../../src/controls/actions.mjs';
import { canonicalHash } from 'creative-engine/contracts';

async function setup(t, options) {
 const directory = await mkdtemp(join(tmpdir(), 'controls-actual-inspection-')); let host = await createIntegratedHost(directory, options);
 t.after(async () => { host.close(); await rm(directory, { recursive: true, force: true }); });
 return { get host() { return host; }, directory, async reopen() { host.close(); host = await createIntegratedHost(directory, options); return host; } };
}
function edit(host, action_id = 'actual-inspection-apply') {
 const schema = host.schema(), draft = defaultDraft(schema); draft.selections.c04 = 'vibrant';
 return { action_version: 'creative-apply/1.1', schema_version: schema.schema_version, action_id,
   tenant_id: schema.tenant_id, project_id: schema.project_id, brief_id: schema.brief_id, expected_versions: schema.expected_versions,
   intent: 'apply', draft, draft_hash: hash(draft), control_schema_hash: `sha256:${hash(schema)}` };
}
async function saved(host) { const r = await host.adapter.apply(principal, edit(host)); assert.equal(r.ok, true, JSON.stringify(r)); return r; }
const begin = (host, apply, id = 'actual-inspection-review') => host.inspection.start(principal, { source_operation_id: apply.operation_id, inspection_action_id: id });
async function waitFor(check) { for (let i=0;i<500;i++) { if (check()) return; await new Promise(r=>setTimeout(r,5)); } throw new Error('Fixture barrier timeout'); }
for (const nativeFormat of ['png', 'jpeg', 'webp']) test(`actual Apply→inspect ${nativeFormat}: exact shared-store report, stages, usage and no automatic repair`, async t => {
 const { host } = await setup(t, { nativeFormat });
 assert.deepEqual([host.counts().image_calls,host.counts().observer_calls,host.counts().jev_calls,host.counts().reservations],[0,0,0,0]);
 const apply = await saved(host), selection = host.selection();
 const view = await begin(host, apply); assert.equal(view.status, 'completed', JSON.stringify(view));
 assert.equal(view.outcome, 'acceptable_for_review'); assert.equal(view.repair_available, false);
 assert.equal(view.references.edit_action_id, apply.action_id); assert.notEqual(view.references.inspection_action_id, apply.action_id);
 assert.equal(view.references.design_version_id, apply.result.design_version.design_version_id);
 assert.equal(view.references.artifact_hash, apply.result.design_version.artifact.content_hash);
 assert.deepEqual(host.selection(),selection);
 assert.deepEqual([host.counts().image_calls,host.counts().observer_calls,host.counts().independent_decision_calls,host.counts().dependent_choice_calls,host.counts().reservations],[1,1,1,1,4]);
 assert.deepEqual([host.counts().independent_questions,host.counts().dependent_questions],[2,1]);
 const rows = host.store.db.prepare('SELECT stage,status,result_json FROM creative_inspection_stages_v1 WHERE action_id=? ORDER BY rowid').all(view.references.inspection_action_id);
 assert.deepEqual(rows.map(x=>[x.stage,x.status]),[['observer','completed'],['decision_evidence','completed'],['decision_route','completed']]);
 const session = await host.ports.storage.getInspectionSession({ scope:host.scope,action_id:view.references.inspection_action_id });
 assert.equal(canonicalHash(session.result.report),view.report_hash); assert.equal(session.artifact_hash,view.references.artifact_hash);
 assert.equal(session.design_hash, apply.result.design_version.design_hash); assert.equal(session.parent_version_id,apply.result.design_version.parent_version_id);
 assert.equal(view.provenance.first_request_ref,session.result.report.first_request_ref);
 assert.equal(view.usage_completeness,'complete'); assert.equal(view.total_cost,null); assert.equal(view.approval,false);
 t.diagnostic(JSON.stringify({controls_probe:'actual_apply_inspect',nativeFormat,view,counters:host.counts(),session_hash:canonicalHash(session)}));
});

test('concurrent/lost response/reopen and current read authorization preserve exact report without work',async t=>{
 const system=await setup(t), host=system.host, apply=await saved(host);
 const [a,b]=await Promise.all([begin(host,apply),begin(host,apply)]); assert.deepEqual(a,b);
 const before=host.counts(); assert.deepEqual(await host.inspection.lookup(principal,a.references.inspection_action_id),a);
 assert.deepEqual(host.counts(),before);
 host.policy.can_read=false; assert.equal((await host.inspection.lookup(principal,a.references.inspection_action_id)).ok,false);
 assert.deepEqual(host.counts(),before);
 const reopened=await system.reopen(); const replay=await begin(reopened,apply); assert.deepEqual(replay,a);
 assert.deepEqual([reopened.counts().image_calls,reopened.counts().observer_calls,reopened.counts().jev_calls,reopened.counts().reservations],[0,0,0,0]);
});

for (const fault of ['refused','unavailable','timeout','lost-observer-response','malformed-noul','abstain']) test(`actual ${fault} is truthful and inspection-only replay preserves saved edit`,async t=>{
 const system=await setup(t),host=system.host,apply=await saved(host),selection=host.selection(); host.policy.inspection_fault=fault;
 const view=await begin(host,apply); t.diagnostic(JSON.stringify({fault,view})); const expected={refused:['completed','refusal'],unavailable:['completed','needs_human_review'],timeout:['completed','needs_human_review'],'lost-observer-response':['failed',null],'malformed-noul':['failed',null],abstain:['completed','needs_human_review']}[fault];assert.deepEqual([view.status,view.outcome],expected,JSON.stringify(view));
 assert.equal(view.repair_available??false,false);assert.deepEqual(host.selection(),selection);assert.equal(host.counts().image_calls,1);
 const counts=host.counts(); await begin(host,apply);assert.deepEqual(host.counts(),counts);
 const reopened=await system.reopen();const replay=await begin(reopened,apply);assert.equal(replay.status,view.status);assert.equal(replay.outcome,view.outcome);
 assert.equal(reopened.counts().image_calls,0);assert.equal(reopened.counts().observer_calls,0);assert.equal(reopened.counts().reservations,0);
});

for(const usage of ['unknown','partial','jev_decision'])test(`actual ${usage} usage retains holds and unknown total, no repair`,async t=>{
 const {host}=await setup(t),apply=await saved(host);host.policy.inspection_usage=usage;
 const view=await begin(host,apply);assert.equal(view.repair_available??false,false);assert.notEqual(view.usage_completeness,'complete');
 assert.equal(view.total_cost??null,null);assert.ok(host.counts().holds>0);assert.equal(host.counts().image_calls,1);
 const before=host.counts();await begin(host,apply);assert.deepEqual(host.counts(),before);
});

test('explicit authorized repair preserves original lineage and cumulative two-repair limit across reopen/new IDs',async t=>{
 const system=await setup(t);let host=system.host;const apply=await saved(host);host.policy.recommend_repair=true;
 let view=await begin(host,apply);assert.equal(view.repair_available,true,JSON.stringify(view));assert.equal(host.counts().image_calls,1);
 const repair1=await host.inspection.repair(principal,{inspection_action_id:view.references.inspection_action_id,repair_action:'image.edit',repair_action_id:'ui-repair-1'});
 assert.equal(repair1.ok,true,JSON.stringify(repair1));assert.equal(host.counts().image_calls,2);
 const rootSession=await host.ports.storage.getInspectionSession({scope:host.scope,action_id:view.references.inspection_action_id});const root=rootSession.root_design_version_id;assert.equal(root,apply.result.design_version.parent_version_id);
 host=await system.reopen();host.policy.recommend_repair=true;
 assert.equal((await host.inspection.repair(principal,{inspection_action_id:view.references.inspection_action_id,repair_action:'image.edit',repair_action_id:'ui-repair-1'})).ok,true);assert.equal(host.counts().image_calls,0);
 view=await host.inspection.start(principal,{source_operation_id:'ui-repair-1',inspection_action_id:'ui-inspect-descendant-1'});assert.equal(view.repair_available,true,JSON.stringify(view));assert.equal(view.limits.remaining_repairs,1);
 const repair2=await host.inspection.repair(principal,{inspection_action_id:view.references.inspection_action_id,repair_action:'image.edit',repair_action_id:'ui-repair-2'});assert.equal(repair2.ok,true,JSON.stringify(repair2));
 view=await host.inspection.start(principal,{source_operation_id:'ui-repair-2',inspection_action_id:'ui-inspect-descendant-2'});assert.equal(view.limits.remaining_repairs,0,JSON.stringify(view));
 const before=host.counts();assert.equal((await host.inspection.repair(principal,{inspection_action_id:view.references.inspection_action_id,repair_action:'image.edit',repair_action_id:'ui-repair-3'})).ok,false);assert.deepEqual(host.counts(),before);
 const design=host.store.getCurrentDesignVersion({scope:host.scope,brief_id:host.scope.brief_id});assert.equal(design.design_version_id,repair2.design_version_id);
 const state=host.ports.storage.inspectionRepair.getState({scope:{...host.scope,design_version_id:root},inspection_id:(await host.ports.storage.getInspectionSession({scope:host.scope,action_id:'actual-inspection-review'})).result.inspection_id});
 assert.equal(state.repairs_used,2);assert.equal(state.simulated_units_used,2);
 t.diagnostic(JSON.stringify({controls_probe:'actual_explicit_repairs',view,root,counters:host.counts(),state}));
});

for(const gate of ['observer-after-ack','decision-evidence-after-ack','decision-route-after-ack'])test(`public Cancel during ${gate}: no late report and no image repeat`,async t=>{
 const {host}=await setup(t),apply=await saved(host);host.block(gate);const work=begin(host,apply);
 const expected=gate==='observer-after-ack'?1:gate==='decision-evidence-after-ack'?2:3;
 await waitFor(()=>host.counts().transport_acks>=1+expected);
 const pending=await host.inspection.lookup(principal,'actual-inspection-review');assert.equal(pending.status,'pending');
 const cancelled=await host.inspection.cancel(principal,'actual-inspection-review');assert.equal(cancelled.status,'cancelled',JSON.stringify(cancelled));host.release();
 const view=await work;assert.notEqual(view.status,'completed');assert.equal(host.counts().image_calls,1);assert.ok(host.counts().holds>0);
 const before=host.counts();await begin(host,apply);assert.deepEqual(host.counts(),before);
});

// Known trusted raw usage can settle conservatively while absent owner mapping
// still makes inspection evidence unknown and ineligible for automatic repair.
test('complete raw usage with unknown owner mapping is distinct from omitted consumption',async t=>{const {host}=await setup(t),apply=await saved(host);host.policy.inspection_owner_mapping='unmapped';host.policy.recommend_repair=true;const view=await begin(host,apply);assert.equal(view.usage_completeness,'unknown');assert.equal(view.repair_available,false);assert.equal(view.total_cost,null);assert.equal(host.counts().holds,0);assert.equal(host.counts().inspection_usage_observations,3);});

for(const bucket of ['valid_unchanged','wrong_subject','mask_drift','poor_result','observer_refusal','observer_timeout','adversarial_observation'])test(`actual inspection bucket ${bucket} uses saved bytes and bounded text`,async t=>{
 const {host}=await setup(t),apply=await saved(host);host.policy.inspection_bucket=bucket;if(['wrong_subject','mask_drift','poor_result'].includes(bucket))host.policy.recommend_repair=true;
 if(bucket==='observer_refusal')host.policy.inspection_fault='refused';if(bucket==='observer_timeout')host.policy.inspection_fault='timeout';
 const view=await begin(host,apply);assert.equal(view.status,bucket==='adversarial_observation'?'failed':'completed',JSON.stringify(view));assert.equal(view.outcome,bucket==='adversarial_observation'?null:bucket==='observer_refusal'?'refusal':bucket==='observer_timeout'?'needs_human_review':['wrong_subject','mask_drift','poor_result'].includes(bucket)?'bounded_repair_recommended':'acceptable_for_review');assert.equal(view.repair_available,['wrong_subject','mask_drift','poor_result'].includes(bucket));assert.equal(host.counts().image_calls,1);assert.equal(host.counts().observer_calls,1);assert.equal(host.counts().independent_questions,bucket.startsWith('observer_')||bucket==='adversarial_observation'?0:2);assert.equal(host.counts().dependent_questions,bucket.startsWith('observer_')||bucket==='adversarial_observation'?0:1);
});
test('forged scope/options/unsafe IDs, conflicts, stale selection and borrowed transactions reject without work',async t=>{
 const {host}=await setup(t),apply=await saved(host),before=host.counts();
 for(const input of [{source_operation_id:apply.operation_id,inspection_action_id:'safe',tenant_id:'foreign'},{source_operation_id:apply.operation_id,inspection_action_id:'safe',repair:true},{source_operation_id:apply.operation_id,inspection_action_id:'https://signed.invalid/?sig=secret'}])assert.equal((await host.inspection.start(principal,input)).ok,false);
 assert.equal((await begin(host,apply,apply.action_id)).ok,false);assert.equal((await host.inspection.start({...principal,actor_id:'foreign'},{source_operation_id:apply.operation_id,inspection_action_id:'foreign'})).ok,false);assert.deepEqual(host.counts(),before);
 for(const beginTx of ['BEGIN IMMEDIATE','SAVEPOINT caller']){host.adapter.db.exec(beginTx);assert.equal((await begin(host,apply,'borrowed')).ok,false);assert.equal(host.adapter.db.isTransaction,true);host.adapter.db.exec('ROLLBACK');assert.deepEqual(host.counts(),before);}
 const view=await begin(host,apply);const count=host.counts();assert.equal((await host.inspection.start(principal,{source_operation_id:'different',inspection_action_id:view.references.inspection_action_id})).code,'conflict');assert.deepEqual(host.counts(),count);
 const secondInput=edit(host,'second-apply');secondInput.draft.selections.c04='calm';secondInput.draft_hash=hash(secondInput.draft);const second=await host.adapter.apply(principal,secondInput);assert.equal(second.ok,true,JSON.stringify(second));const after=host.counts();assert.equal((await begin(host,apply,'stale-inspection')).code,'stale_version');assert.deepEqual(host.counts(),after);
});
for(const change of ['membership','actor_expiry','asset','clock'])test(`current ${change} after owner await fences inspection transport`,async t=>{
 const {host}=await setup(t),apply=await saved(host);host.block('owner-authorize');const work=begin(host,apply,'fenced');await waitFor(()=>host.store.db.prepare("SELECT count(*) n FROM creative_jobs WHERE operation='inspect'").get().n===1);await new Promise(r=>setTimeout(r,30));
 if(change==='membership')host.policy.can_inspect=false;if(change==='actor_expiry')host.policy.actor_expired=true;if(change==='asset')host.policy.permitted_asset_ids=[];if(change==='clock'){host.advance(120000);}
 host.release();const view=await work;assert.notEqual(view.status,'completed',JSON.stringify(view));assert.equal(host.counts().observer_calls,0);assert.equal(host.counts().image_calls,1);
});
test('backend cumulative repair deadline survives UI availability and rejects with zero new image',async t=>{const {host}=await setup(t),apply=await saved(host);host.policy.recommend_repair=true;const view=await begin(host,apply);assert.equal(view.repair_available,true);host.advance(60001);const before=host.counts();assert.equal((await host.inspection.repair(principal,{inspection_action_id:view.references.inspection_action_id,repair_action:'image.edit',repair_action_id:'late-repair'})).ok,false);assert.deepEqual(host.counts(),before);});

test('actual hard process exit after observer ACK retains unresolved attempt and reopens without redispatch',async t=>{
 const {spawnSync}=await import('node:child_process');const system=await setup(t),apply=await saved(system.host);system.host.close();
 const child=spawnSync(process.execPath,['fixtures/controls/inspection-crash.mjs',system.directory,apply.operation_id,'ack'],{encoding:'utf8',timeout:15000});assert.equal(child.status,17,child.stderr);assert.equal(JSON.parse(child.stdout).counters.observer_calls,1);
 const host=await system.reopen();const before=host.counts();const view=await host.inspection.start(principal,{source_operation_id:apply.operation_id,inspection_action_id:'process-inspection'});assert.equal(view.status,'pending',JSON.stringify(view));assert.deepEqual(host.counts(),before);assert.equal((await host.inspection.lookup(principal,'process-inspection')).status,'pending');
 const attempts=host.store.db.prepare("SELECT count(*) n FROM creative_inspection_stages_v1 WHERE action_id='process-inspection' AND stage='observer' AND status='dispatching'").get();assert.equal(attempts.n,1);
});

test('inspection of pending repair is read-only; completed repair resolves exact immutable result',async t=>{
 const {host}=await setup(t),apply=await saved(host);host.policy.recommend_repair=true;const view=await begin(host,apply);host.block('native-post-ack');const work=host.inspection.repair(principal,{inspection_action_id:view.references.inspection_action_id,repair_action:'image.edit',repair_action_id:'pending-repair'});await waitFor(()=>host.counts().transport_acks===5);
 const before=host.counts();const result=await host.inspection.start(principal,{source_operation_id:'pending-repair',inspection_action_id:'inspect-pending-repair'});assert.equal(result.ok,false);assert.deepEqual(host.counts(),before);host.release();const repair=await work;assert.equal(repair.ok,true,JSON.stringify(repair));const after=host.counts();const design=await host.inspection.saved(principal,'pending-repair');assert.equal(design.design_version_id,repair.design_version_id);assert.deepEqual(host.counts(),after);
});

for(const [gate,observed,independent,dependent] of [['observer-after-ack',1,0,0],['decision-evidence-after-ack',1,1,0],['decision-route-after-ack',1,1,1]])for(const change of ['membership','replaced','expired','rights'])test(`actual ${change} at ${gate} prevents subsequent transport and report`,async t=>{
 const {host}=await setup(t),apply=await saved(host);host.block(gate);const work=begin(host,apply);const acks=gate==='observer-after-ack'?2:gate==='decision-evidence-after-ack'?3:4;await waitFor(()=>host.counts().transport_acks===acks);
 if(change==='membership')host.policy.can_inspect=false;if(change==='rights')host.policy.permitted_asset_ids=[];if(change==='expired')host.advance(120000);if(change==='replaced')host.store.db.prepare("UPDATE creative_jobs SET lease_hash='replacement' WHERE action_id='actual-inspection-review'").run();
 host.release();const view=await work;assert.notEqual(view.status,'completed',JSON.stringify(view));assert.deepEqual([host.counts().observer_calls,host.counts().independent_decision_calls,host.counts().dependent_choice_calls],[observed,independent,dependent]);assert.equal(host.counts().image_calls,1);assert.equal(host.store.db.prepare("SELECT count(*) n FROM creative_inspection_sessions_v1 WHERE action_id='actual-inspection-review' AND status='completed'").get().n,0);
});

for(const [stage,expected] of [['observer',[0,0,0]],['evidence',[1,0,0]],['route',[1,1,0]]])for(const change of ['cancel','expired','replaced','context','rights'])test(`final owner return ${stage}/${change}: target stage sends zero`,async t=>{
 const {host}=await setup(t),apply=await saved(host),selection=host.selection();const gate=`inspection-owner-${stage}`;host.block(gate);const work=begin(host,apply);await waitFor(()=>host.waiting===gate);const atFence=host.counts();assert.deepEqual([atFence.observer_calls,atFence.independent_decision_calls,atFence.dependent_choice_calls],expected);
 if(change==='cancel')await host.inspection.cancel(principal,'actual-inspection-review');if(change==='expired')host.advance(120000);if(change==='replaced')host.store.db.prepare("UPDATE creative_jobs SET lease_hash='replacement' WHERE action_id='actual-inspection-review'").run();if(change==='context'){const result=await host.changeBrief([{preference_id:'style',value:'different'}]);assert.equal(result.ok,true,JSON.stringify(result));}if(change==='rights')host.policy.permitted_asset_ids=[];
 assert.equal(host.counts().holds,atFence.holds);host.release();const view=await work;assert.notEqual(view.status,'completed',JSON.stringify(view));assert.deepEqual([host.counts().observer_calls,host.counts().independent_decision_calls,host.counts().dependent_choice_calls],expected);assert.equal(host.counts().image_calls,1);assert.deepEqual(host.selection(),selection);
 assert.equal(host.store.db.prepare("SELECT count(*) n FROM creative_inspection_sessions_v1 WHERE action_id='actual-inspection-review' AND status='completed'").get().n,0);
});

test('pending repair recovery returns stable identity read-only',async t=>{const {host}=await setup(t),apply=await saved(host);host.policy.recommend_repair=true;const view=await begin(host,apply);host.block('native-post-ack');const work=host.inspection.repair(principal,{inspection_action_id:view.references.inspection_action_id,repair_action:'image.edit',repair_action_id:'recover-pending-repair'});await waitFor(()=>host.counts().transport_acks===5);const before=host.counts();const recovery=await host.inspection.latestRepair(principal);assert.deepEqual(recovery,{ok:false,code:'pending',status:'pending',action_id:'recover-pending-repair',inspection_action_id:view.references.inspection_action_id});assert.deepEqual(host.counts(),before);host.release();assert.equal((await work).ok,true);assert.equal((await host.inspection.latestRepair(principal)).action_id,'recover-pending-repair');});

for(const phase of ['postack','send'])for(const [stage,expected] of [['observer',[0,0,0]],['evidence',[1,0,0]],['route',[1,1,0]]])for(const change of ['cancel','expired','replaced','context','rights'])test(`final post-ACK ${phase} owner return ${stage}/${change}: current send zero`,async t=>{
 const {host}=await setup(t),apply=await saved(host),selection=host.selection();const gate=`inspection-${phase}-${stage}`;host.block(gate);const work=begin(host,apply);await waitFor(()=>host.waiting===gate);const atFence=host.counts();assert.deepEqual([atFence.observer_sends,atFence.independent_decision_sends,atFence.dependent_choice_sends],expected);assert.ok(atFence.holds>0);
 if(change==='cancel')await host.inspection.cancel(principal,'actual-inspection-review');if(change==='expired')host.advance(120000);if(change==='replaced')host.store.db.prepare("UPDATE creative_jobs SET lease_hash='replacement' WHERE action_id='actual-inspection-review'").run();if(change==='context')assert.equal((await host.changeBrief([{preference_id:'style',value:'different'}])).ok,true);if(change==='rights')host.policy.permitted_asset_ids=[];
 assert.equal(host.counts().holds,atFence.holds);host.release();const view=await work;assert.notEqual(view.status,'completed',JSON.stringify(view));assert.deepEqual([host.counts().observer_sends,host.counts().independent_decision_sends,host.counts().dependent_choice_sends],expected);assert.equal(host.counts().holds,atFence.holds);assert.equal(host.counts().releases,atFence.releases);assert.deepEqual(host.selection(),selection);assert.equal(host.store.db.prepare("SELECT count(*) n FROM creative_inspection_sessions_v1 WHERE action_id='actual-inspection-review' AND status='completed'").get().n,0);
});
test('cumulative simulated units are enforced independently from repair count',async t=>{const {host}=await setup(t),apply=await saved(host);host.policy.recommend_repair=true;host.policy.repair_units=2;const first=await begin(host,apply);const repair=await host.inspection.repair(principal,{inspection_action_id:first.references.inspection_action_id,repair_action:'image.edit',repair_action_id:'two-unit-repair'});assert.equal(repair.ok,true,JSON.stringify(repair));const next=await host.inspection.start(principal,{source_operation_id:repair.action_id,inspection_action_id:'inspect-two-unit-child'});assert.equal(next.limits.remaining_repairs,1);assert.equal(next.limits.remaining_simulated_units,1);const before=host.counts();assert.equal((await host.inspection.repair(principal,{inspection_action_id:next.references.inspection_action_id,repair_action:'image.edit',repair_action_id:'over-unit-repair'})).ok,false);assert.deepEqual(host.counts(),before);});

test('concurrent identical explicit repairs share exact saved result and one root claim',async t=>{const {host}=await setup(t),apply=await saved(host);host.policy.recommend_repair=true;const view=await begin(host,apply);const input={inspection_action_id:view.references.inspection_action_id,repair_action:'image.edit',repair_action_id:'concurrent-repair'};const [a,b]=await Promise.all([host.inspection.repair(principal,input),host.inspection.repair(principal,input)]);assert.equal(a.ok,true,JSON.stringify(a));assert.deepEqual(a,b);assert.equal(host.counts().image_calls,2);assert.equal(host.counts().reservations,5);const session=await host.ports.storage.getInspectionSession({scope:host.scope,action_id:view.references.inspection_action_id});const state=host.ports.storage.inspectionRepair.getState({scope:{...host.scope,design_version_id:session.root_design_version_id},inspection_id:session.result.inspection_id});assert.equal(state.repairs_used,1);assert.equal(state.simulated_units_used,1);});

test('corrupt bytes for an exact saved artifact fail inspection before observer or JEV without erasing edit',async t=>{const {host}=await setup(t),apply=await saved(host),selection=host.selection();const read=host.ports.storage.getArtifactBytes;host.ports.storage.getArtifactBytes=async input=>{const bytes=Buffer.from(await read(input));bytes[bytes.length-1]^=1;return bytes;};const view=await begin(host,apply);assert.equal(view.status,'completed',JSON.stringify(view));assert.equal(view.outcome,'failure');assert.equal(view.repair_available,false);assert.deepEqual([host.counts().observer_calls,host.counts().jev_calls,host.counts().image_calls],[0,0,1]);assert.deepEqual(host.selection(),selection);});
