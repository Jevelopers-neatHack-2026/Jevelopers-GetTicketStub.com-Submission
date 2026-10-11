import test from 'node:test';import assert from 'node:assert/strict';
import {projectActualInspection} from '../../src/controls/inspection-result.mjs';
import {projectInspectionSource,projectInspectionView,projectRepairResult} from '../../src/controls/inspection-view.mjs';
const digest=`sha256:${'a'.repeat(64)}`;
const binding={source_operation_id:'apply-operation',edit_action_id:'saved-edit',inspection_action_id:'review-action',brief_id:'brief',brief_hash:digest,design_version_id:'design',design_hash:digest,artifact_hash:digest,tenant_id:'tenant',project_id:'project'};
function input(){return {binding,job_id:'job',response:{ok:true,job:{job_id:'job',status:'completed'},result:{report:{...binding,contract:'CreativeInspectionReport',schema_version:'1.0',evidence_mode:'fixture',outcome:'bounded_repair_recommended',eligible_repair_actions:['image.edit'],first_request_ref:digest,route_request_ref:digest,decision_ref:digest,limits:{max_repairs:2,max_elapsed_ms:60000,max_simulated_units:3,remaining_repairs:2,remaining_elapsed_ms:60000,remaining_simulated_units:3,usage_completeness:'complete'}}}}};}
test('actual result projection allowlists nested fields and freezes references/provenance/limits',()=>{
 const source=input(),canary='https://signed.invalid/file?sig=synthetic-private';
 source.response.result.report.limits.provider_request_id=canary;source.response.result.report.customer_prompt=canary;
 source.response.result.report.observations=[{artwork_bytes:canary}];source.response.result.report.prose=canary;
 const view=projectActualInspection(source);assert.equal(view.status,'completed');assert.equal(JSON.stringify(view).includes(canary),false);
 for(const value of [view,view.references,view.provenance,view.limits])assert.ok(Object.isFrozen(value));
 const withExtras={...view,provenance:{...view.provenance,private:canary},limits:{...view.limits,provider_request_id:canary}};
 const projected=projectInspectionView(withExtras);assert.ok(projected);assert.equal(JSON.stringify(projected).includes(canary),false);
 for(const value of [projected,projected.references,projected.provenance,projected.limits])assert.ok(Object.isFrozen(value));
});
test('fractional units remain exact and bounded while counts and milliseconds remain integers',()=>{
 for(const units of [0,0.001,0.5,2.5,3]){const source=input();source.response.result.report.limits.remaining_simulated_units=units;const projected=projectActualInspection(source);assert.equal(projected.status,'completed');assert.equal(projected.limits.remaining_simulated_units,units);assert.equal(projectInspectionView(projected).limits.remaining_simulated_units,units);}
 for(const units of [-0.001,3.001,Infinity,NaN,'2.5',null]){const source=input();source.response.result.report.limits.remaining_simulated_units=units;assert.equal(projectActualInspection(source).ok,false);const view=projectActualInspection(input());assert.equal(projectInspectionView({...view,limits:{...view.limits,remaining_simulated_units:units}}),null);}
 for(const key of ['remaining_repairs','remaining_elapsed_ms']){const source=input();source.response.result.report.limits[key]=0.5;assert.equal(projectActualInspection(source).ok,false);const view=projectActualInspection(input());assert.equal(projectInspectionView({...view,limits:{...view.limits,[key]:0.5}}),null);}
});
test('saved source projection is immutable and drops extras without invoking hostile hooks',()=>{
 const source={source_operation_id:'saved-apply',design_version_id:'saved-design',artifact_hash:digest};const projected=projectInspectionSource({...source,provider_request_id:'private',signed_url:'https://signed.invalid?sig=private'});assert.deepEqual(projected,source);assert.ok(Object.isFrozen(projected));
 let hooks=0;const hostile={};Object.defineProperty(hostile,'source_operation_id',{enumerable:true,get(){hooks++;return 'saved-apply'}});assert.equal(projectInspectionSource(hostile),null);assert.equal(projectInspectionSource({...source,source_operation_id:'https://private.invalid'}),null);assert.equal(hooks,0);
});
test('malformed/foreign/incomplete completed reports never show saved review or permit repair',()=>{
 const changes=[x=>delete x.response.result,x=>x.response.result.report.schema_version='2',x=>x.response.result.report.artifact_hash=`sha256:${'b'.repeat(64)}`,x=>x.response.result.report.tenant_id='foreign',x=>x.response.result.report.outcome='approved',x=>x.response.result.report.first_request_ref='https://signed.invalid?sig=synthetic',x=>x.response.result.report.limits.remaining_repairs=1.5,x=>x.response.result.report.limits.remaining_simulated_units=Infinity];
 for(const change of changes){const x=input();change(x);const view=projectActualInspection(x);assert.equal(view.status,'unknown');assert.equal(view.repair_available??false,false);}
 const partial=input();partial.response.result.report.limits.usage_completeness='partial';assert.equal(projectActualInspection(partial).repair_available,false);
});
test('hostile getters/arrays invoke zero hooks and unsafe operation identity cannot render',()=>{
 let hooks=0;const hostile={};Object.defineProperty(hostile,'binding',{enumerable:true,get(){hooks++;return binding}});
 const array=[];array[Symbol.iterator]=()=>{hooks++;return[][Symbol.iterator]()};
 assert.equal(projectActualInspection(hostile).ok,false);assert.equal(projectInspectionView(array),null);
 for(const value of ['id.ghp_'+'a'.repeat(36),'https://signed.invalid?sig=private','customer@example.invalid','<script>prompt</script>']){
  const x=input();x.binding={...binding,inspection_action_id:value};assert.equal(projectActualInspection(x).ok,false);
  const v=projectActualInspection(input());assert.equal(projectInspectionView({...v,references:{...v.references,job_id:value}}),null);
 }
 assert.equal(hooks,0);
 assert.equal(projectRepairResult({ok:true,status:'completed',action_id:'repair'},'repair'),null);
 assert.equal(projectRepairResult({ok:true,status:'completed',action_id:'repair',design_version_id:'design',artifact_hash:digest,approval:false,purchase:false},'other'),null);
});
