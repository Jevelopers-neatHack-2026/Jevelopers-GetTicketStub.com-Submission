import { readFile } from 'node:fs/promises';
import { runCanonicalFixtures } from '@jevelopers/shared-contracts/fixture-harness';
import { verifyProductionBundleFiles, checkTemplateSpec, checkPersonalizationPlan, checkComposition, checkProductionHostApproval, checkProductionHostRequest, productionReferences } from '@jevelopers/shared-contracts/production-operations';
const read = async name => JSON.parse(await readFile(new URL(import.meta.resolve('@jevelopers/shared-contracts/fixtures/'+name+'.json')), 'utf8'));
const names=['ComposeArtifactRequest','PersonalizeBatchRequest','InspectArtifactRequest','ExportBundleRequest','CompareTemplateRequest','ArtifactStatusRequest','ProductionError','TemplateSpec','Composition','PersonalizationSchema','RowResult','BatchResult','ArtifactFile.2_0_0','ProductionBundle.2_0_0','ProductionBundleDetached'];
let cases=0;
for(const name of names){const fixture=await read(name),result=runCanonicalFixtures(fixture.contract,fixture);if(result.failures.length)throw new Error('Installed production fixture rejected');cases+=result.records.length;}
const calibration=await read('ProductionCalibration');
const files=Object.entries(calibration.byte_files).map(([filename,value])=>({filename,bytes:Buffer.from(value,'base64')}));
const result=verifyProductionBundleFiles(files,{scope:calibration.scope,trusted_commitment:calibration.trusted_commitment});
if(!result.ok||result.value.integrity!=='passed'||result.value.eligibility!=='blocked')throw new Error('Calibration boundary changed');
if(!checkTemplateSpec(calibration.template,calibration.scope).ok||!checkPersonalizationPlan((await read('PersonalizeBatchRequest')).valid,{scope:calibration.scope,policy:calibration.personalization,template:calibration.template}).ok)throw new Error('Installed values rejected');
const compositionContext={scope:calibration.scope,template:calibration.template,personalization:calibration.personalization,facts:calibration.facts,expected_references:Object.fromEntries(productionReferences(calibration.composition)),expected_resolved_layout_commitment:calibration.composition.resolved_layout_commitment,expected_policy_refs:calibration.composition.policy_refs,expected_font_refs:calibration.composition.font_refs,expected_runtime_ref:calibration.composition.runtime_ref,asset_bytes:Object.fromEntries(Object.entries(calibration.asset_bytes).map(([id,bytes])=>[id,Buffer.from(bytes,'base64')]))};
if(!checkComposition(calibration.composition,compositionContext).ok)throw new Error('Canonical installed facts rejected');
const approval=(await read('ApprovalReceipt')).valid;
const host={scope:{tenant_id:approval.tenant_id,project_id:approval.project_id},authority:{actor_id:approval.actor_id,audience:approval.audience},policy_version:'1.0.0'};
const now='2026-10-10T12:00:00Z',observation={receipt:approval,status:'valid',checked_at:now};
if(!checkProductionHostApproval(observation,host,approval.binding,now).ok)throw new Error('Valid host expectation rejected');
for(const field of ['actor_id','audience']){
  const foreign=structuredClone(host);foreign.authority[field]=field==='actor_id'?'foreign_actor':'event-intelligence';
  if(checkProductionHostApproval(observation,foreign,approval.binding,now).ok)throw new Error('Foreign host expectation accepted');
}
let calls=0;
const request=(await read('ComposeArtifactRequest')).valid,references=new Proxy({},{get(){calls++;return undefined;}});
if(checkProductionHostRequest('composeArtifact',request,{...host,authority:undefined},references).ok||calls)throw new Error('Invalid host boundary accessed references');
if(checkProductionHostRequest('composeArtifact',{...request,actor_id:host.authority.actor_id},host,references).ok||calls)throw new Error('Forged request boundary accessed references');
console.log(JSON.stringify({module:'production-operations',fixture_cases:cases,integrity:'passed',eligibility:'blocked',host_authority:'independently_supplied_synthetic_controls_passed',callbacks_before_invalid_boundary:calls,accepted:false}));
