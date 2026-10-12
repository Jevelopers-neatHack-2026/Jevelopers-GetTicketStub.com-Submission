import assert from 'node:assert/strict';
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {sha256,digest} from '../fulfillment_component_tests/custody.mjs';
import {allCases} from './matrix.mjs';
import {validateChoice} from './choice-evidence.mjs';
import {validateAnswerEvidence} from './answer-evidence.mjs';

export function validateCase(value, descriptor) {
  if(descriptor.kind==='choice')return validateChoice(value,descriptor);
  assert.equal(value.id,descriptor.id); assert.equal(value.mode,'intercepted_mock_only');
  assert.equal(value.synthetic_authority,true);assert.equal(value.accepted,false);assert.equal(value.paid_execution_enabled,false);
  assert.equal(value.cost,'unknown');assert.equal(value.execution_error,null);assert.equal(value.execution_started,true);
  assert.equal(value.result.status,descriptor.status);assert.equal(value.guard_attempt_delta,0);
  assert.deepEqual(value.counters,descriptor.counters??{dns:descriptor.send,requests:descriptor.send,writes:descriptor.send});
  assert.deepEqual(value.dispatch_callbacks,descriptor.callbacks??(descriptor.send?['revalidate','record','assert']:[]));
  validateAnswerEvidence(value.result,value.request.questions);
  assert.equal(value.request.attempt_number,1);assert.equal(value.request.attempt_limit,1);
  assert.deepEqual(Object.keys(value.request.questions),['defect_present','visual_quality']);
  assert.equal(value.request.billing_mode,'live');assert.equal(value.request_hash,value.request_hash_after);
  assert.equal(value.result_hash,value.result_hash_after);
  for(const field of ['tenant_id','project_id','correlation_id','request_id','logical_operation_id','billable_attempt_id','design_version_id','artifact_id']) assert.equal(value.result[field],value.request[field]);
  for(const field of ['tenant_id','project_id','design_version_id','artifact_id'])assert.equal(value.binding.scope[field],value.request[field]);
  assert.equal(value.binding.deadline_at,value.request.deadline_at);
  assert.equal(value.binding.attempt.logical_operation_id,value.request.logical_operation_id);
  assert.equal(value.binding.attempt.billable_attempt_id,value.request.billable_attempt_id);
  assert.equal(value.binding.reservation_ref,value.request.budget_ref.reservation_ref);
  for(const field of ['request_hash','result_hash','target_binding_sha256','plan_ref','inspection_subject_hash']) assert.match(value[field],/^sha256:[a-f0-9]{64}$/);
  assert.equal(value.result.usage.completeness,descriptor.usage);
  if(descriptor.usage==='unknown') assert.deepEqual(Object.keys(value.result.usage).sort(),['completeness','reason']);
  else assert.deepEqual(value.result.usage,{completeness:'complete',input_tokens:10,output_tokens:4});
  if(descriptor.send) {
    assert.equal(value.wire.model,'jev-1.13.0');assert.deepEqual(value.wire.state,value.request.state);
    assert.deepEqual(Object.keys(value.wire.questions),['defect_present','visual_quality']);
  } else assert.equal(value.wire,null);
  if(descriptor.status==='complete') {
    assert.equal(value.consumer.contract,'DecisionPortRequest');assert.deepEqual(Object.keys(value.consumer.questions),['next_step']);
    assert.notEqual(value.consumer.request_id,value.request.request_id);assert.equal(value.consumer.correlation_id,value.request.correlation_id);
  } else {
    assert.deepEqual(value.consumer,{status:'review_required',reason:value.result.status});
    if(value.result.error) {assert.equal(value.result.error.retryable,false);assert.equal(value.result.error.fallback,'review');}
  }
  assert.equal(value.input_fingerprint,digest(value.inputs));
  if(descriptor.id==='raw-nan'||descriptor.id==='numeric-overflow'){
    assert.equal(sha256(value.raw_response),value.inputs.fault.body_sha256);
    if(descriptor.id==='raw-nan'){assert.match(value.raw_response,/\"score\":NaN/);assert.throws(()=>JSON.parse(value.raw_response));}
    else{assert.match(value.raw_response,/\"score\":1e309/);assert.equal(Number.isFinite(JSON.parse(value.raw_response).answers.visual_quality.score),false);}
  }
  if(descriptor.id==='missing-provider-reference'){assert.equal(Object.hasOwn(value.result,'provider_request_ref'),false);assert.deepEqual(value.reference_absence,{headers_has_reference:false,raw_headers_has_reference:false});}
  if(descriptor.id.startsWith('late-')){
    assert.equal(value.late.result_hash_before,value.result_hash);assert.equal(value.late.result_hash_after,value.result_hash);
    assert.equal(value.late.consumer_hash_before,value.late.consumer_hash_after);
    assert.deepEqual(value.late.counters_before,value.counters);assert.deepEqual(value.late.counters_after,value.counters);
    assert.deepEqual(value.late.callbacks_after,value.dispatch_callbacks);
    assert.equal(value.late.delivered_after_result,true);
    if(descriptor.id==='late-permit-cancel')assert.deepEqual(value.late.delivery,{resolutions:1});
    else{assert.equal(value.late.delivery.delivered,1);assert.ok(value.late.delivery.bytes>0);}
  }
}
export async function validateReports(output) {
  const rows=[];
  for(const descriptor of allCases) {
    const path=join(output,`${descriptor.id}.json`);const stat=await lstat(path);
    assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<256*1024);
    const bytes=await readFile(path);validateCase(JSON.parse(bytes),descriptor);rows.push({path:`${descriptor.id}.json`,sha256:sha256(bytes)});
  }
  const execution=JSON.parse(await readFile(join(output,'matrix-result.json')));
  assert.equal(execution.status,'passed');assert.equal(execution.positive_control_passed,true);assert.equal(execution.choice_control_passed,true);assert.equal(execution.guard_probe_blocked,true);
  assert.equal(execution.completed,allCases.length);assert.equal(execution.external_attempts,0);
  return rows;
}
export function validateReceipt(receipt,pins) {
  assert.equal(receipt.kind,'decision-failure-component-development');assert.equal(receipt.status,'passed');
  assert.equal(receipt.mode,'intercepted_mock_only');assert.equal(receipt.synthetic_authority,true);assert.equal(receipt.paid_execution_enabled,false);
  assert.equal(receipt.accepted,false);assert.equal(receipt.cost,'unknown');assert.equal(receipt.platform,'linux');assert.equal(receipt.node,`v${pins.node}`);
  assert.equal(receipt.harness,pins.harness.revision);assert.equal(receipt.creative,pins.creative.revision);
  assert.equal(receipt.cleanup.confirmed,true);assert.equal(receipt.cleanup.private_removed,true);
  assert.deepEqual(receipt.reports.map(row=>row.path),allCases.map(row=>`${row.id}.json`));
  for(const row of receipt.reports) assert.match(row.sha256,/^[a-f0-9]{64}$/);
}
