import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {matrix} from './matrix.mjs';
import {validateCase,validateReports} from './receipt.mjs';
import {runBounded,retirePrivate} from '../fulfillment_component_tests/process.mjs';
const output=process.env.DF_CASES;assert.ok(output,'Tests must mutate actual captured component reports');
const fixture=async id=>JSON.parse(await readFile(join(output,`${id}.json`)));
const descriptor=id=>matrix.find(row=>row.id===id);
const record=async(name,value)=>{if(process.env.DF_TEST_EVIDENCE){await mkdir(process.env.DF_TEST_EVIDENCE,{recursive:true});await writeFile(join(process.env.DF_TEST_EVIDENCE,name),JSON.stringify({synthetic_control:true,...value},null,2));}};
let uncertainChild=false;let activeChildren=0;
after(async()=>record('lifecycle.json',{confirmed:!uncertainChild&&activeChildren===0}));
test('all actual captured owner and consumer reports validate',async()=>{assert.equal((await validateReports(output)).length,15);});
for(const[name,id,mutate]of[
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
