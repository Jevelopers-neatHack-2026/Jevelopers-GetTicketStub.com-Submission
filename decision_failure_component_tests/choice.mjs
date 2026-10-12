import assert from 'node:assert/strict';
import {sha256,digest} from '../fulfillment_component_tests/custody.mjs';
import {createCase} from './wiring.mjs';

const counters=wire=>({dns:wire.dns,requests:wire.requests,writes:wire.writes});
const binding=input=>({scope:input.scope,attempt:input.attempt,reservation_ref:input.reservation_ref,
  transport_attempt_id:input.transport_attempt_id,dispatch_intent_ref:input.dispatch_intent_ref,target_binding_sha256:input.target_binding_sha256});
export async function executeChoice(owners,t,id) {
  const scenario=createCase(owners,id,{routeTransport:`transport-${id}-route`});
  const firstWire=owners.fixture.intercept(t,{body:scenario.body});
  const firstResult=await scenario.port.execute(scenario.input);
  assert.equal(firstResult.status,'complete');
  const request=scenario.consume(firstResult);
  const first={request:scenario.request,result:firstResult,binding:binding(scenario.input),counters:counters(firstWire),wire:firstWire.wire,
    callbacks:[...scenario.events],request_hash:scenario.hash(scenario.request),result_hash:scenario.hash(firstResult)};
  t.mock.restoreAll();
  const fixture=owners.fixture.setup();const input=fixture.input;
  Object.assign(input,{request,scope:scenario.input.scope,reservation_ref:request.budget_ref.reservation_ref,
    transport_attempt_id:request.transport_attempt_id,deadline_at:request.deadline_at,target_binding_sha256:owners.fixture.contracts.decisionExecutionTargetHash(request)});
  input.attempt={...fixture.attempt,tenant_id:request.tenant_id,project_id:request.project_id,
    logical_operation_id:request.logical_operation_id,billable_attempt_id:request.billable_attempt_id,correlation_id:request.correlation_id};
  const recordedTransportIds=[];
  // Synthetic permit fixture only: assert the second batch's distinct transport identity.
  input.recordTransportAttempt=async transport=>{assert.equal(transport,request.transport_attempt_id);recordedTransportIds.push(transport);fixture.events.push('record');return input.dispatch_intent_ref;};
  const candidates=request.questions.next_step.eligible_candidate_ids;
  assert.ok(candidates.includes('acceptable_for_review'));
  const answer={type:'choice',choice:'acceptable_for_review',probabilities:Object.fromEntries(candidates.map(candidate=>[candidate,candidate==='acceptable_for_review'?1:0])),confidence:0.95};
  if(id==='choice-unknown-option'){answer.choice=`${candidates[0]}-not-eligible`;assert.ok(!candidates.includes(answer.choice));}
  if(id==='choice-invalid-enum')answer.type='invalid-choice-enum';
  const body={model:'jev-1.13.0',answers:{next_step:answer},usage:{input_tokens:10,output_tokens:4}};
  const wire=owners.fixture.intercept(t,{body});const result=await fixture.port.execute(input);
  const consumer=owners.inspection.evaluateInspectionDecision(scenario.plan,scenario.request,firstResult,request,result,scenario.input.scope);
  const inputs={brief:scenario.brief,design_version:scenario.version,observation:scenario.observation,artifact_sha256:sha256(scenario.artifact_bytes),first_response_body:scenario.body,choice_response_body:body};
  return {id,inputs,input_fingerprint:digest(inputs),mode:'intercepted_mock_only',synthetic_authority:true,accepted:false,paid_execution_enabled:false,cost:'unknown',declared_batches:2,retries:0,
    first,route:{request,result,binding:binding(input),counters:counters(wire),wire:wire.wire,response_body:body,callbacks:fixture.events,recorded_transport_ids:recordedTransportIds,
      request_hash:scenario.hash(request),result_hash:scenario.hash(result)},consumer,consumer_hash:scenario.hash(consumer),
    first_request_hash_after:scenario.hash(scenario.request),first_result_hash_after:scenario.hash(firstResult),
    route_request_hash_after:scenario.hash(request),route_result_hash_after:scenario.hash(result),plan_ref:scenario.plan.plan_ref,inspection_subject_hash:scenario.plan.inspection_subject_hash};
}
