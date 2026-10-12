import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export async function loadOwners(harness, creative) {
  const load = path => import(pathToFileURL(path).href);
  await load(join(harness,'tests/decisions/jev-adapter.contract/network-guard.js'));
  const installed = join(harness,'node_modules/creative-engine');
  const manifest = JSON.parse(await readFile(join(installed,'package.json')));
  const publicEntry = name => join(installed,manifest.exports[name].import);
  return {
    inspection: await load(publicEntry('./inspection')),
    contracts: await load(publicEntry('./contracts')),
    fixture: await load(join(harness,'tests/decisions/public-port/helpers.js')),
    versions: await load(join(creative,'tests/versions/helpers.mjs')),
    png: await load(join(creative,'fixtures/models/png.mjs')),
  };
}
export function createCase(owners, id, { deadlineOffset = 5000, clockOffset = 0, routeTransport } = {}) {
  const {inspection: ce, contracts, fixture: har, versions, png} = owners;
  const brief = structuredClone(versions.createBrief()); brief.permissions.items[0].status = 'granted';
  const scope = versions.DEFAULT_SCOPE;
  const validated = contracts.validateCreativeBrief(brief,{trustedScope:scope});
  const bytes = png.makePng();
  const version = versions.createVersion({scope,brief:validated,id:`design-${id}`,bytes});
  const inspected = ce.inspectCreativeArtifact({trusted_scope:scope,brief:validated,design_version:version.design_version,
    artifact_bytes:Uint8Array.from(bytes),used_assets:[{asset_id:'asset-1',action:'reproduce'}],eligible_repair_actions:['image.edit','composition.update']});
  const hash = contracts.canonicalHash;
  const observation = ce.validateVisualObservation({contract:'CreativeVisualObservation',schema_version:'1.0',
    ...Object.fromEntries(['tenant_id','project_id','brief_id','design_version_id','artifact_id','brief_hash','parent_design_hash','design_hash','artifact_hash'].map(key=>[key,inspected[key]])),
    observation_id:`observation-${id}`,observed_at:new Date(har.NOW).toISOString(),
    observer:{type:'model',id:'fixture-vision',model_id:'mock-vision/1.0',config_ref:hash('synthetic vision configuration')},
    source:{kind:'vision_model',source_ref:hash('synthetic observation source')},uncertainty:{status:'measured'},findings:[],usage:{completeness:'unknown'}},inspected);
  const context = suffix => ({event_id:`event-${id}-${suffix}`,correlation_id:`correlation-${id}`,producer:'creative-engine.inspection',
    occurred_at:new Date(har.NOW).toISOString(),ingested_at:new Date(har.NOW).toISOString(),environment:'test',billing_mode:'live',
    request_id:`request-${id}-${suffix}`,logical_operation_id:`logical-${id}`,billable_attempt_id:`attempt-${id}-${suffix}`,attempt_number:1,attempt_limit:1,
    budget_ref:{budget_scope_ref:'budget-fixture',reservation_ref:`reservation-${id}-${suffix}`,policy_version:'budget-policy/1'},
    deadline_at:new Date(har.NOW+deadlineOffset).toISOString(),cancellation_ref:`cancel-${id}`,model_policy:{model_id:'jev-1.13.0',policy_version:ce.INSPECTION_POLICY_VERSION}});
  const plan = ce.createInspectionDecisionPlan({deterministic:inspected,observation,decision_context:context('first')});
  assert.equal(plan.status,'ready');
  const request = ce.createInspectionEvidenceBatch(plan,observation);
  const fixture = har.setup({clock:()=>har.NOW+clockOffset}); const input = fixture.input;
  const trustedScope = {...scope,design_version_id:inspected.design_version_id,artifact_id:inspected.artifact_id};
  Object.assign(input,{request,scope:trustedScope,reservation_ref:request.budget_ref.reservation_ref,deadline_at:request.deadline_at,
    target_binding_sha256:har.contracts.decisionExecutionTargetHash(request)});
  input.attempt = {...fixture.attempt,tenant_id:request.tenant_id,project_id:request.project_id,
    logical_operation_id:request.logical_operation_id,billable_attempt_id:request.billable_attempt_id,correlation_id:request.correlation_id};
  const routeContext = {...context('route'),...(routeTransport?{transport_attempt_id:routeTransport}:{}),linked_request_id:request.request_id,linked_billable_attempt_id:request.billable_attempt_id,
    plan_ref:plan.plan_ref,inspection_subject_hash:plan.inspection_subject_hash};
  const consume = result => ce.createInspectionRouteBatch(plan,request,result,trustedScope,routeContext);
  const criteria = request.questions.visual_quality.criteria;
  const body = {model:'jev-1.13.0',answers:{defect_present:{type:'noul',noul:0.1},visual_quality:{type:'score',score:3.2,
    legend:Object.fromEntries(criteria.map((value,index)=>[String(index),value])),probabilities:{'0':0,'1':0,'2':0,'3':0.8,'4':0.2},confidence:0.95}},usage:{input_tokens:10,output_tokens:4}};
  return {input,port:fixture.port,events:fixture.events,request,plan,inspected,observation,brief:validated,version:version.design_version,
    artifact_bytes:bytes,body,consume,hash};
}
