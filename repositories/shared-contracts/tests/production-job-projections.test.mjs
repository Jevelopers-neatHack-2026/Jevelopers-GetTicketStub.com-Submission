import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calibration,clone,batchContext,partialBatch,readProduction } from './production-seeds.mjs';
import { projectBatchPartialFailure,projectBatchJobStatus,adaptProductionErrorToV1,createProductionError } from '../tooling/production-operations.mjs';
import { hashManifest } from '../tooling/runtime.mjs';
const old=async name=>JSON.parse(await readFile(new URL('../fixtures/'+name+'.json',import.meta.url),'utf8')).valid;
const envelope=await old('CommonEnvelope');Object.assign(envelope,calibration.scope);
const legacyError=(await old('PartialFailure')).failures[0].error;
const policyRef={contract:'ProductionPolicy',schema_version:'1.0.0',id:calibration.policy_documents.output.id,revision:1,content_hash:calibration.policy_documents.output.content_hash};
function partialContext(context){return {...context,envelope:clone(envelope),policy_ref:policyRef,v1_errors:{row_2:legacyError},operation_context:{scope:calibration.scope,now:calibration.now,policy_version:'1.0.0',references:{policy_ref:policyRef}}};}
test('atomic converts to all_or_nothing with zero successful committed IDs',()=>{
  const result=projectBatchPartialFailure([calibration.batch],partialContext(batchContext()));assert.equal(result.ok,true);assert.equal(result.value.value.acceptance_policy,'all_or_nothing');assert.deepEqual(result.value.value.successful_item_ids,[]);assert.deepEqual(result.value.value.unprocessed_item_ids,['row_1']);assert.equal(result.value.equivalent,false);
});
test('partial converts only published successes and retains failure diagnostics',()=>{
  const {batch,context}=partialBatch(),result=projectBatchPartialFailure([batch],partialContext(context));assert.equal(result.ok,true);assert.equal(result.value.value.acceptance_policy,'partial');assert.deepEqual(result.value.value.successful_item_ids,['row_1']);assert.equal(result.value.value.failures[0].item_id,'row_2');
});
test('unknown side effects cannot be discarded by a v1 projection',()=>{
  const context=partialContext(batchContext());context.v1_errors={row_2:{...legacyError,side_effects:'confirmed'}};assert.equal(projectBatchPartialFailure([calibration.batch],context).errors[0].code,'LEGACY_UNREPRESENTABLE');
});
test('terminal partial status explicitly projects to failed/failed with BatchResult',async()=>{
  const {batch,context}=partialBatch(),prior=await old('JobStatus');Object.assign(prior,calibration.scope);prior.job_id=batch.job.job_ref.id;
  const candidate=clone(prior);candidate.event_id='123e4567-e89b-42d3-a456-000000009999';candidate.revision=2;candidate.error={...legacyError,code:'PARTIAL_FAILURE',category:'partial',operation:'personalizeArtifactBatch'};
  const batchRef={contract:'BatchResult',schema_version:'1.0.0',id:batch.job.job_ref.id,revision:1,content_hash:hashManifest(batch)};
  const result=projectBatchJobStatus([batch],{...context,batch_ref:batchRef,job_candidate:candidate,job_context:{scope:calibration.scope,now:calibration.now,policy_version:'1.0.0',references:{'result_refs/0':batchRef},prior}});
  assert.equal(result.ok,true);assert.equal(result.value.value.state,'failed');assert.equal(result.value.value.outcome,'failed');assert.equal(result.value.equivalent,false);
});
test('missing batch reference produces typed unsupported projection',()=>assert.equal(projectBatchJobStatus([calibration.batch],batchContext()).errors[0].code,'LEGACY_UNREPRESENTABLE'));
test('error adapter retains uncertainty and declares lost vocabulary',()=>{
  const source=createProductionError('ROW_SCHEMA',{scope:calibration.scope,operation:'personalizeArtifactBatch',correlation_id:envelope.correlation_id,side_effects:'possible',usage_state:'incomplete'}).value;
  const result=adaptProductionErrorToV1(source,{scope:calibration.scope,envelope,blocking_condition:'review'});assert.equal(result.ok,true);assert.equal(result.value.value.side_effects,'possible');assert.equal(result.value.value.usage_state,'incomplete');assert.equal(result.value.equivalent,false);
});
test('transient renderer/storage errors do not impersonate unrelated v1 availability codes',()=>{
  const source=createProductionError('RETRYABLE_RENDER_FAILURE',{scope:calibration.scope,operation:'composeArtifact',correlation_id:envelope.correlation_id}).value;
  assert.equal(adaptProductionErrorToV1(source,{scope:calibration.scope,envelope,blocking_condition:'unknown'}).errors[0].code,'LEGACY_UNREPRESENTABLE');
});
