import test from 'node:test';
import assert from 'node:assert/strict';
import { readProduction,calibration,clone } from './production-seeds.mjs';
import { checkProductionRequest, productionReferences, productionRequests, createProductionError, checkProductionError, validateProductionResult, validateProductionReference, adaptProductionRevision, productionSemanticDigest, compareProductionIdempotency, checkProductionApproval, productionErrorRegistry } from '../tooling/production-operations.mjs';
import { validateVersionedReference } from '../tooling/operations.mjs';
import { hashManifest } from '../tooling/runtime.mjs';
const scope=calibration.scope;
const requestContext=request=>({scope,policy_version:'1.0.0',references:Object.fromEntries(productionReferences(request))});
const errorContext=operation=>({scope,operation,correlation_id:'123e4567-e89b-42d3-a456-000000000071'});
const targets={composeArtifact:'ArtifactRef',personalizeArtifactBatch:'BatchResult',inspectArtifact:'PreflightReport',exportArtifactBundle:'ProductionBundleRef',compareTemplateCompatibility:'CompatibilityReport',getArtifactManifestStatus:'ArtifactManifestStatus'};
for(const [operation,contract] of Object.entries(productionRequests)){
  const request=await readProduction(contract);
  test(operation+' accepts its exact minimal request',()=>assert.equal(checkProductionRequest(operation,request,requestContext(request)).ok,true));
  for(const field of ['tenant_id','project_id','now','environment','billing_mode','authorization','approved'])test(operation+' rejects forged '+field+' before host access',()=>{
    let accesses=0;const context={scope,policy_version:'1.0.0',get references(){accesses++;return {};}};
    const result=checkProductionRequest(operation,{...request,[field]:true},context);
    assert.equal(result.ok,false);assert.equal(accesses,0);
  });
  test(operation+' rejects an unsupported major',()=>assert.equal(checkProductionRequest(operation,{...request,schema_version:'9.0.0'},requestContext(request)).errors[0].code,'UNSUPPORTED_VERSION'));
  test(operation+' returns uniform foreign and missing outcomes',()=>{
    const missing=requestContext(request);missing.references={};
    const foreign=requestContext(request);const key=Object.keys(foreign.references)[0];foreign.references[key]={...foreign.references[key],id:'123e4567-e89b-42d3-a456-000000009999'};
    assert.deepEqual(checkProductionRequest(operation,request,missing),checkProductionRequest(operation,request,foreign));
  });
  const value=await readProduction(targets[operation]);
  test(operation+' validates its concrete successful constituent',()=>assert.equal(validateProductionResult(operation,{ok:true,value},scope).ok,true));
  test(operation+' validates its concrete error constituent',()=>{
    const error=createProductionError('INVALID_INPUT',errorContext(operation)).value;
    assert.equal(validateProductionResult(operation,{ok:false,error},scope).ok,true);
  });
  test(operation+' rejects errors[] alias and unknown generic shape',()=>{
    assert.equal(validateProductionResult(operation,{ok:false,errors:[]},scope).ok,false);
    assert.equal(validateProductionResult(operation,{ok:true,value:{}},scope).ok,false);
  });
}
for(const code of Object.keys(productionErrorRegistry)){
  test(code+' preserves uncertainty and unavailable diagnostics',()=>{
    const result=createProductionError(code,errorContext('composeArtifact'));
    assert.equal(result.ok,true);assert.equal(result.value.side_effects,'unknown');assert.equal(result.value.usage_state,'unknown');assert.equal(result.value.diagnostic_ref.state,'unavailable');
  });
  test(code+' rejects an unsafe error message',()=>{
    const value=createProductionError(code,errorContext('composeArtifact')).value;value.safe_message='synthetic user details';
    assert.equal(checkProductionError(value,scope).ok,false);
  });
}
test('persisted diagnostics bind actual scoped reference',async()=>{
  const doc=await readProduction('ProductionDiagnostic');const diagnostic={state:'persisted',...scope,reference:{contract:doc.contract,schema_version:doc.schema_version,id:doc.id,revision:doc.revision,content_hash:doc.content_hash}};
  const value=createProductionError('INVALID_INPUT',{...errorContext('composeArtifact'),diagnostic_ref:diagnostic});assert.equal(value.ok,true);
  diagnostic.tenant_id='123e4567-e89b-42d3-a456-000000009999';assert.equal(createProductionError('INVALID_INPUT',{...errorContext('composeArtifact'),diagnostic_ref:diagnostic}).ok,false);
});
test('new references keep positive revisions without altering legacy zero',()=>{
  const ref=clone(calibration.template.personalization_schema_ref);assert.equal(validateProductionReference(ref).ok,true);
  assert.equal(validateProductionReference({...ref,revision:0}).ok,false);assert.equal(validateVersionedReference({...ref,revision:0}).ok,true);
  assert.equal(validateProductionReference({...ref,content_hash:ref.content_hash.slice(7)}).ok,false);
});
for(const revision of ['fixture-1','sha256:'+'0'.repeat(64),0,1.5])test('revision adapter blocks '+revision,()=>assert.equal(adaptProductionRevision({...calibration.template.personalization_schema_ref,revision}).errors[0].code,'LEGACY_UNREPRESENTABLE'));
test('only excessive cardinality wins over unsupported format in diagnostic precedence',async()=>{
  const request=await readProduction('ExportBundleRequest'),ctx=requestContext(request);
  assert.equal(checkProductionRequest('exportArtifactBundle',{...request,formats:['jpeg']},ctx).errors[0].code,'OUTPUT_UNSUPPORTED');
  assert.equal(checkProductionRequest('exportArtifactBundle',{...request,formats:['svg','png','pdf','jpeg']},ctx).errors[0].code,'INVALID_INPUT');
  assert.equal(checkProductionRequest('exportArtifactBundle',{...request,formats:['svg','svg']},ctx).errors[0].code,'INVALID_INPUT');
});
const batchRequest=await readProduction('PersonalizeBatchRequest');
test('omitted and explicit atomic have the same full digest',()=>assert.equal(productionSemanticDigest('personalizeArtifactBatch',batchRequest,calibration.pins).value,productionSemanticDigest('personalizeArtifactBatch',{...batchRequest,acceptance_policy:'atomic'},calibration.pins).value));
test('transport identifiers cannot change the semantic digest',()=>assert.equal(productionSemanticDigest('personalizeArtifactBatch',batchRequest,calibration.pins).value,productionSemanticDigest('personalizeArtifactBatch',{...batchRequest,request_id:'123e4567-e89b-42d3-a456-000000009999',correlation_id:'123e4567-e89b-42d3-a456-000000009998'},calibration.pins).value));
for(const kind of ['policy','rows','runtime','fonts','output','approval'])test(kind+' changes full plan identity',()=>{
  const request=clone(batchRequest),pins=clone(calibration.pins);
  if(kind==='policy')request.acceptance_policy='allow_partial';
  else if(kind==='rows')request.input.rows.reverse();
  else if(kind==='fonts')pins.font_refs[0].revision++;
  else pins[{runtime:'runtime_ref',output:'output_policy_ref',approval:'approval_ref'}[kind]].revision++;
  assert.notEqual(productionSemanticDigest('personalizeArtifactBatch',request,pins).value,productionSemanticDigest('personalizeArtifactBatch',batchRequest,calibration.pins).value);
});
test('pure idempotency comparison grants no replay and retains conflict',()=>{
  const prior={...scope,operation:'composeArtifact',idempotency_key:'one',digest:hashManifest('a')};
  assert.equal(compareProductionIdempotency(prior,prior).value.replay_authorized,false);
  assert.equal(compareProductionIdempotency({...prior,digest:hashManifest('b')},prior).errors[0].code,'IDEMPOTENCY_CONFLICT');
});
const approval=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../fixtures/ApprovalReceipt.json',import.meta.url),'utf8')).valid;
const approvalContext={scope:{tenant_id:approval.tenant_id,project_id:approval.project_id},now:'2026-10-10T12:00:00Z',expected_binding:approval.binding,actor_id:approval.actor_id,audience:approval.audience};
for(const [status,code] of [['revoked','APPROVAL_REVOKED'],['unavailable','APPROVAL_UNAVAILABLE'],['expired','APPROVAL_INVALID']])test('verifier '+status+' maps before collapsed private permission failure',()=>assert.equal(checkProductionApproval({receipt:approval,status,checked_at:approvalContext.now},approvalContext).errors[0].code,code));
test('approval expiry equality and future checked_at reject',()=>{
  assert.equal(checkProductionApproval({receipt:approval,status:'valid',checked_at:approval.expires_at},{...approvalContext,now:approval.expires_at}).ok,false);
  assert.equal(checkProductionApproval({receipt:approval,status:'valid',checked_at:'2026-10-10T12:00:01Z'},approvalContext).ok,false);
});
