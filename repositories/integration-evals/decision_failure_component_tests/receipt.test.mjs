import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {allCases} from './matrix.mjs';
import {sha256,digest} from '../fulfillment_component_tests/custody.mjs';
import {validateCase,validateReports} from './receipt.mjs';
import {runBounded,retirePrivate} from '../fulfillment_component_tests/process.mjs';
const output=process.env.DF_CASES;assert.ok(output,'Tests must mutate actual captured component reports');
const fixture=async id=>JSON.parse(await readFile(join(output,`${id}.json`)));
const descriptor=id=>allCases.find(row=>row.id===id);
const record=async(name,value)=>{if(process.env.DF_TEST_EVIDENCE){await mkdir(process.env.DF_TEST_EVIDENCE,{recursive:true});await writeFile(join(process.env.DF_TEST_EVIDENCE,name),JSON.stringify({synthetic_control:true,...value},null,2));}};
let uncertainChild=false;let activeChildren=0;
after(async()=>record('lifecycle.json',{confirmed:!uncertainChild&&activeChildren===0}));
test('all actual captured owner and consumer reports validate',async()=>{assert.equal((await validateReports(output)).length,24);});
for(const[name,id,mutate]of[
 ['incorrect final Choice consumer','choice-complete-control',v=>{v.consumer.outcome='needs_human_review';}],
 ['reused second billable identity','choice-complete-control',v=>{v.route.request.billable_attempt_id=v.first.request.billable_attempt_id;v.route.result.billable_attempt_id=v.first.request.billable_attempt_id;v.route.binding.attempt.billable_attempt_id=v.first.request.billable_attempt_id;}],
 ['reused second reservation','choice-complete-control',v=>{v.route.binding.reservation_ref=v.first.binding.reservation_ref;v.route.request.budget_ref.reservation_ref=v.first.binding.reservation_ref;}],
 ['reused second transport','choice-complete-control',v=>{v.route.binding.transport_attempt_id=v.first.binding.transport_attempt_id;v.route.request.transport_attempt_id=v.first.binding.transport_attempt_id;v.route.result.transport_attempt_id=v.first.binding.transport_attempt_id;v.route.recorded_transport_ids=[v.first.binding.transport_attempt_id];}],
 ['broken stage correlation','choice-complete-control',v=>{v.route.request.correlation_id='different';v.route.result.correlation_id='different';v.route.binding.attempt.correlation_id='different';}],
 ['late result mutation','late-response-timeout',v=>{v.late.result_hash_after='sha256:'+'0'.repeat(64);}],
 ['late consumer mutation','late-response-cancel',v=>{v.late.consumer_hash_after='sha256:'+'0'.repeat(64);}],
 ['late permit write','late-permit-cancel',v=>{v.late.counters_after.writes=1;}],
 ['invented optional provider reference','missing-provider-reference',v=>{v.result.provider_request_ref='sha256:'+'a'.repeat(64);}],
 ['invented Noul confidence','uncertain-noul',v=>{v.result.answers.defect_present.answer.confidence=0.99;}],
 ['invented unavailable confidence','http-503',v=>{v.result.answers.defect_present.confidence=0.99;}],
 ['NaN silently serialized as null','raw-nan',v=>{v.raw_response=v.raw_response.replace(':NaN',':null');v.inputs.fault.body_sha256=sha256(v.raw_response);v.input_fingerprint=digest(v.inputs);}],
 ['finite value posing as overflow','numeric-overflow',v=>{v.raw_response=v.raw_response.replace(':1e309',':3.2');v.inputs.fault.body_sha256=sha256(v.raw_response);v.input_fingerprint=digest(v.inputs);}],
 ['unknown option replaced by valid option','choice-unknown-option',v=>{v.route.response_body.answers.next_step.choice=v.route.request.questions.next_step.eligible_candidate_ids[0];v.inputs.choice_response_body=structuredClone(v.route.response_body);v.input_fingerprint=digest(v.inputs);}],
 ['enum fault replaced by valid enum','choice-invalid-enum',v=>{v.route.response_body.answers.next_step.type=v.route.request.questions.next_step.type;v.inputs.choice_response_body=structuredClone(v.route.response_body);v.input_fingerprint=digest(v.inputs);}],
 ['wrong CE consumer','http-429',v=>{v.consumer={status:'complete'};}],
 ['dependent route on failure','timeout-after-send',v=>{v.consumer={contract:'DecisionPortRequest',questions:{next_step:{}}};}],
 ['excess send','http-503',v=>{v.counters.writes=2;}],
 ['hidden pretransport fixture failure','http-503',v=>{v.counters={dns:0,requests:0,writes:0};}],
 ['fabricated free cost','missing-usage',v=>{v.cost=0;}],
 ['fabricated zero usage','timeout-before-send',v=>{v.result.usage.input_tokens=0;v.result.usage.output_tokens=0;}],
 ['hidden bootstrap error','malformed-json',v=>{v.execution_error={code:'CONFIG_INVALID'};}],
 ['identity drift','invalid-score',v=>{v.result.request_id='foreign-request';}],
 ['hidden network guard violation','invalid-distribution',v=>{v.guard_attempt_delta=1;}],
 ['suppressed complete follow-on','complete-control',v=>{v.consumer={status:'review_required',reason:'complete'};}],
 ['authority upgrade','uncertain-noul',v=>{v.accepted=true;}],
 ['increased attempt limit','wrong-question-keys',v=>{v.request.attempt_limit=2;}],
])test(`rejects ${name} in actual captured evidence`,async()=>{const value=await fixture(id);mutate(value);assert.throws(()=>validateCase(value,descriptor(id)));});
test('missing scenario output fails qualification',async()=>{const root=await mkdtemp(join(tmpdir(),'decision-negative-'));try{await assert.rejects(validateReports(root),{code:'ENOENT'});}finally{await rm(root,{recursive:true});}});
for(const[failure,script,options]of[
 ['timeout','setInterval(()=>{},1000)',{timeout:100,limit:4096}],
 ['output_overflow',"process.stdout.write('x'.repeat(65536));setInterval(()=>{},1000)",{timeout:5000,limit:1024}],
])test(`${failure} terminates inert child and retains nonpass`,async()=>{activeChildren++;const result=await runBounded(process.execPath,['-e',script],{...options,grace:100,env:{}});activeChildren--;uncertainChild ||= !result.groupAbsent;assert.equal(result.failure,failure);assert.equal(result.groupAbsent,true);await record(`${failure}.json`,{status:'failed',...result});});
test('uncertain child lifetime preserves evaluator-owned private files',async()=>{const root=await mkdtemp(join(tmpdir(),'decision-negative-'));await writeFile(join(root,'marker'),'live');try{const result=await retirePrivate(root,false);assert.equal(result.private_removed,false);assert.equal(await readFile(join(root,'marker'),'utf8'),'live');await record('quarantine.json',result);}finally{await rm(root,{recursive:true});}});
