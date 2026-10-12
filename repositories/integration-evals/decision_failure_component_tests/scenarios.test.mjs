import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadOwners,createCase} from './wiring.mjs';
import {matrix,faultFor} from './matrix.mjs';
import {validateCase} from './receipt.mjs';
import {sha256,digest} from '../fulfillment_component_tests/custody.mjs';

const harness=process.env.DF_HARNESS;const creative=process.env.DF_CREATIVE;const output=process.env.DF_OUTPUT;
assert.ok(harness&&creative&&output&&process.env.TMPDIR);
process.env.JEV_OFFLINE_METRICS_FILE=join(process.env.TMPDIR,'decision-network.metrics');
const metrics=async()=>{try{return(await readFile(process.env.JEV_OFFLINE_METRICS_FILE,'utf8')).trim().split('\n').filter(Boolean);}catch(error){if(error.code==='ENOENT')return [];throw error;}};
const save=(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const guardStart=(await metrics()).length;
const owners=await loadOwners(harness,creative);
assert.equal((await metrics()).length,guardStart,'Owner initialization attempted uncontrolled network');
const initial=(await metrics()).length;
assert.throws(()=>globalThis.fetch('https://guard-probe.invalid'));
assert.equal((await metrics()).length,initial+1);
const guardBaseline=(await metrics()).length;
await save('guard-probe.json',{blocked:true,basis:'owner_native_network_guard',blocked_probe_count:1});
let positive=false;let completed=0;
try {
  for(const descriptor of matrix) {
    if(descriptor.id!=='complete-control') assert.equal(positive,true,'positive CE-HAR-CE compatibility required');
    await test(`actual decision boundary: ${descriptor.id}`,{timeout:5000},async t=>{
      const record={id:descriptor.id,mode:'intercepted_mock_only',synthetic_authority:true,accepted:false,paid_execution_enabled:false,cost:'unknown',execution_error:null,execution_started:false};
      try {
        const scenario=createCase(owners,descriptor.id,descriptor);
        const controller=new AbortController();scenario.input.signal=controller.signal;
        const fault=faultFor(descriptor,scenario.body,controller);
        const before=(await metrics()).length;const wire=owners.fixture.intercept(t,fault);
        record.inputs={brief:scenario.brief,design_version:scenario.version,observation:scenario.observation,artifact_sha256:sha256(scenario.artifact_bytes),
          fault:{id:descriptor.id,http_status:fault.status??200,body_sha256:sha256(typeof fault.body==='string'?fault.body:JSON.stringify(fault.body)),deadline_offset:descriptor.deadlineOffset??5000,clock_offset:descriptor.clockOffset??0}};
        record.input_fingerprint=digest(record.inputs);record.request=scenario.request;record.plan_ref=scenario.plan.plan_ref;record.inspection_subject_hash=scenario.plan.inspection_subject_hash;
        record.request_hash=scenario.hash(scenario.request);record.target_binding_sha256=scenario.input.target_binding_sha256;
        record.binding={scope:scenario.input.scope,actor_id:scenario.input.actor_id,deadline_at:scenario.input.deadline_at,attempt:scenario.input.attempt,reservation_ref:scenario.input.reservation_ref,transport_attempt_id:scenario.input.transport_attempt_id,dispatch_intent_ref:scenario.input.dispatch_intent_ref};
        record.execution_started=true;record.result=await scenario.port.execute(scenario.input);
        record.result_hash=scenario.hash(record.result);record.consumer=scenario.consume(record.result);
        record.request_hash_after=scenario.hash(scenario.request);record.result_hash_after=scenario.hash(record.result);
        record.counters={dns:wire.dns,requests:wire.requests,writes:wire.writes};record.wire=wire.wire;record.dispatch_callbacks=scenario.events;
        record.guard_attempt_delta=(await metrics()).length-before;
        validateCase(record,descriptor);completed++;if(descriptor.id==='complete-control')positive=true;
      } catch(error) {record.execution_error={code:error.code??error.name};throw error;}
      finally {t.mock.restoreAll();await save(`${descriptor.id}.json`,record);}
    });
  }
} finally {
  const external=(await metrics()).length-guardBaseline;
  await save('matrix-result.json',{status:completed===matrix.length&&external===0?'passed':'failed',positive_control_passed:positive,guard_probe_blocked:true,completed,external_attempts:external});
}
