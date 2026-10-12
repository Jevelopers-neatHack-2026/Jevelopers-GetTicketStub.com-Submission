import assert from 'node:assert/strict';
import {digest} from '../fulfillment_component_tests/custody.mjs';
import {validateAnswerEvidence} from './answer-evidence.mjs';

export function validateChoice(value,descriptor) {
  assert.equal(value.id,descriptor.id);assert.equal(value.mode,'intercepted_mock_only');assert.equal(value.synthetic_authority,true);
  assert.equal(value.accepted,false);assert.equal(value.paid_execution_enabled,false);assert.equal(value.cost,'unknown');assert.equal(value.execution_error,null);
  assert.equal(value.input_fingerprint,digest(value.inputs));assert.deepEqual(value.inputs.choice_response_body,value.route.response_body);
  assert.equal(value.declared_batches,2);assert.equal(value.retries,0);assert.equal(value.guard_attempt_delta,0);
  assert.equal(value.first.result.status,'complete');assert.equal(value.route.result.status,descriptor.status);
  for(const stage of[value.first,value.route]) {
    assert.deepEqual(stage.counters,{dns:1,requests:1,writes:1});assert.deepEqual(stage.callbacks,['revalidate','record','assert']);
    assert.equal(stage.request.attempt_number,1);assert.equal(stage.request.attempt_limit,1);
    assert.equal(stage.binding.reservation_ref,stage.request.budget_ref.reservation_ref);
    assert.equal(stage.binding.attempt.billable_attempt_id,stage.request.billable_attempt_id);
    for(const field of['request_id','logical_operation_id','billable_attempt_id','correlation_id','tenant_id','project_id','design_version_id','artifact_id'])assert.equal(stage.result[field],stage.request[field]);
    if(stage.request.transport_attempt_id)assert.equal(stage.result.transport_attempt_id,stage.request.transport_attempt_id);
    assert.deepEqual(stage.result.usage,{completeness:'complete',input_tokens:10,output_tokens:4});validateAnswerEvidence(stage.result,stage.request.questions);
  }
  for(const field of['request_id','billable_attempt_id'])assert.notEqual(value.first.request[field],value.route.request[field]);
  for(const field of['logical_operation_id','correlation_id'])assert.equal(value.first.request[field],value.route.request[field]);
  assert.notEqual(value.first.binding.reservation_ref,value.route.binding.reservation_ref);
  assert.notEqual(value.first.binding.transport_attempt_id,value.route.binding.transport_attempt_id);
  assert.equal(value.route.request.transport_attempt_id,value.route.binding.transport_attempt_id);
  assert.deepEqual(value.route.recorded_transport_ids,[value.route.binding.transport_attempt_id]);
  assert.deepEqual(Object.keys(value.route.request.questions),['next_step']);
  assert.deepEqual(Object.keys(value.route.wire.questions),['next_step']);
  assert.equal(value.first.request_hash,value.first_request_hash_after);assert.equal(value.first.result_hash,value.first_result_hash_after);
  assert.equal(value.route.request_hash,value.route_request_hash_after);assert.equal(value.route.result_hash,value.route_result_hash_after);
  assert.equal(value.consumer.first_request_ref,value.first.request_hash);assert.equal(value.consumer.route_request_ref,value.route.request_hash);
  assert.equal(value.consumer.plan_ref,value.plan_ref);assert.equal(value.consumer.inspection_subject_hash,value.inspection_subject_hash);
  assert.equal(value.route.request.source_refs.at(-1),value.first.result_hash);
  assert.equal(Object.hasOwn(value.consumer,'action'),false);
  const answer=value.route.response_body.answers.next_step;const candidates=value.route.request.questions.next_step.eligible_candidate_ids;
  assert.deepEqual(Object.keys(answer.probabilities),candidates);
  switch(descriptor.id) {
    case 'choice-complete-control':
      assert.equal(value.consumer.status,'complete');assert.equal(value.consumer.outcome,'acceptable_for_review');assert.equal(value.consumer.reason,'not_an_approval');
      assert.ok(candidates.includes(answer.choice));assert.equal(answer.choice,'acceptable_for_review');break;
    case 'choice-unknown-option':
      assert.ok(!candidates.includes(answer.choice));break;
    case 'choice-invalid-enum':
      assert.notEqual(answer.type,value.route.request.questions.next_step.type);break;
    default:assert.fail('Unknown Choice case');
  }
  if(descriptor.status!=='complete') {
    assert.equal(value.consumer.status,'review_required');assert.equal(value.consumer.outcome,'needs_human_review');assert.equal(value.consumer.reason,value.route.result.status);
    assert.equal(value.route.result.error.retryable,false);
  }
}
