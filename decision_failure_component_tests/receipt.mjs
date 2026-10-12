import assert from 'node:assert/strict';
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {sha256,digest} from '../fulfillment_component_tests/custody.mjs';
import {matrix} from './matrix.mjs';

export function validateCase(value, descriptor) {
  assert.equal(value.id,descriptor.id); assert.equal(value.mode,'intercepted_mock_only');
  assert.equal(value.synthetic_authority,true);assert.equal(value.accepted,false);assert.equal(value.paid_execution_enabled,false);
  assert.equal(value.cost,'unknown');assert.equal(value.execution_error,null);assert.equal(value.execution_started,true);
  assert.equal(value.result.status,descriptor.status);assert.equal(value.guard_attempt_delta,0);
  assert.deepEqual(value.counters,{dns:descriptor.send,requests:descriptor.send,writes:descriptor.send});
  assert.deepEqual(value.dispatch_callbacks,descriptor.send?['revalidate','record','assert']:[]);
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
}
export async function validateReports(output) {
  const rows=[];
  for(const descriptor of matrix) {
    const path=join(output,`${descriptor.id}.json`);const stat=await lstat(path);
    assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<256*1024);
    const bytes=await readFile(path);validateCase(JSON.parse(bytes),descriptor);rows.push({path:`${descriptor.id}.json`,sha256:sha256(bytes)});
  }
  const execution=JSON.parse(await readFile(join(output,'matrix-result.json')));
  assert.equal(execution.status,'passed');assert.equal(execution.positive_control_passed,true);assert.equal(execution.guard_probe_blocked,true);
  assert.equal(execution.completed,matrix.length);assert.equal(execution.external_attempts,0);
  return rows;
}
export function validateReceipt(receipt,pins) {
  assert.equal(receipt.kind,'decision-failure-component-development');assert.equal(receipt.status,'passed');
  assert.equal(receipt.mode,'intercepted_mock_only');assert.equal(receipt.synthetic_authority,true);assert.equal(receipt.paid_execution_enabled,false);
  assert.equal(receipt.accepted,false);assert.equal(receipt.cost,'unknown');assert.equal(receipt.platform,'linux');assert.equal(receipt.node,`v${pins.node}`);
  assert.equal(receipt.harness,pins.harness.revision);assert.equal(receipt.creative,pins.creative.revision);
  assert.equal(receipt.cleanup.confirmed,true);assert.equal(receipt.cleanup.private_removed,true);
  assert.deepEqual(receipt.reports.map(row=>row.path),matrix.map(row=>`${row.id}.json`));
  for(const row of receipt.reports) assert.match(row.sha256,/^[a-f0-9]{64}$/);
}
