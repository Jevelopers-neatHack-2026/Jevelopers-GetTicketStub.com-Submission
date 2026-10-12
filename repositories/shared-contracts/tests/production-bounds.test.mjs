import test from 'node:test';
import assert from 'node:assert/strict';
import { calibration,clone,readProduction } from './production-seeds.mjs';
import { checkPersonalizationPlan,productionContentHash,checkProductionFile,productionArchiveLimits,verifyProductionZip,parseProductionCanonicalBytes } from '../tooling/production-operations.mjs';
import { validateContractVersion } from '../tooling/runtime.mjs';
import { hashBytes } from '../tooling/runtime.mjs';
import { storedZip } from './production-archive-seeds.mjs';
const request=await readProduction('PersonalizeBatchRequest');
function plan(maximumRows=10000,maximumUnits=4096){
  const value=clone(request),policy=clone(calibration.personalization),template=clone(calibration.template);
  policy.limits.maximum_rows=maximumRows;policy.limits.maximum_canonical_bytes=4000000;
  for(const field of policy.fields)field.maximum_utf16_units=maximumUnits;
  policy.content_hash=productionContentHash(policy);template.personalization_schema_ref.content_hash=policy.content_hash;template.content_hash=productionContentHash(template);
  value.binding.template_ref.content_hash=template.content_hash;value.input.row_schema_ref.content_hash=policy.content_hash;
  return {value,context:{scope:calibration.scope,policy,template}};
}
test('10,000 original rows are bounded and retained; plus one rejects',()=>{
  const {value,context}=plan();value.input.rows=Array.from({length:10000},(_,ordinal)=>({row_id:'row_'+ordinal,fields:{name:'0001',detail:'exact'}}));
  const result=checkPersonalizationPlan(value,context);assert.equal(result.ok,true);assert.equal(result.value.rows[9999].ordinal,9999);
  value.input.rows.push({row_id:'extra',fields:{name:'1',detail:'x'}});assert.equal(checkPersonalizationPlan(value,context).errors[0].code,'RESOURCE_LIMIT');
});
test('4096 UTF16 units including astral pairs pass; plus one rejects',()=>{
  const {value,context}=plan();value.input.rows[0].fields.name='\u{1f600}'.repeat(2048);assert.equal(checkPersonalizationPlan(value,context).ok,true);
  value.input.rows[0].fields.name+='x';assert.equal(checkPersonalizationPlan(value,context).ok,false);
});
test('exact canonical plan byte policy rejects plus one without a larger absolute cap',()=>{
  const {value,context}=plan();context.policy.limits.maximum_canonical_bytes=1;context.policy.content_hash=productionContentHash(context.policy);context.template.personalization_schema_ref.content_hash=context.policy.content_hash;context.template.content_hash=productionContentHash(context.template);value.input.row_schema_ref.content_hash=context.policy.content_hash;value.binding.template_ref.content_hash=context.template.content_hash;
  assert.equal(checkPersonalizationPlan(value,context).errors[0].code,'RESOURCE_LIMIT');
});
test('101 rows cannot appear in one public batch page',()=>{
  const batch=clone(calibration.batch);batch.rows=Array.from({length:101},()=>clone(batch.rows[0]));assert.equal(validateContractVersion('BatchResult','1.0.0',batch).ok,false);
});
test('artifact descriptor maximum bytes remains finite',async()=>{
  const file=await readProduction('ArtifactFile.2_0_0');file.byte_size=67108864;assert.equal(checkProductionFile(file).ok,true);file.byte_size++;assert.equal(checkProductionFile(file).ok,false);
});
test('archive and raw manifest size limits reject oversized views before parsing',()=>{
  assert.equal(verifyProductionZip(new Uint8Array(productionArchiveLimits.archive_bytes+1),[]).errors[0].code,'RESOURCE_LIMIT');
  assert.equal(parseProductionCanonicalBytes('ProductionBundle','2.0.0',new Uint8Array(productionArchiveLimits.manifest_bytes+1),productionArchiveLimits.manifest_bytes).errors[0].code,'RESOURCE_LIMIT');
});
test('raw canonical parser cannot disable its finite contract limit',()=>{
  for(const maximum of [Infinity,NaN,0,productionArchiveLimits.manifest_bytes+1])assert.equal(parseProductionCanonicalBytes('ProductionBundle','2.0.0',Buffer.from('{}'),maximum).errors[0].code,'RESOURCE_LIMIT');
});
test('aggregate ZIP bytes pass at the finite ceiling and reject plus one',()=>{
  const sizes=[8388608,8388608,8388608,8388608,4194304];
  const entries=sizes.map((size,index)=>({filename:'entry-'+index+'.json',bytes:Buffer.alloc(size)}));
  const expected=entries.map(entry=>({filename:entry.filename,byte_hash:hashBytes(entry.bytes),byte_size:entry.bytes.length}));
  assert.equal(verifyProductionZip(storedZip(entries),expected).ok,true);
  entries[4].bytes=Buffer.alloc(sizes[4]+1);expected[4]={...expected[4],byte_hash:hashBytes(entries[4].bytes),byte_size:entries[4].bytes.length};
  assert.equal(verifyProductionZip(storedZip(entries),expected).errors[0].code,'RESOURCE_LIMIT');
});
test('wire row fields are bounded at 32 and reject 33',()=>{
  const value=clone(request);value.input.rows[0].fields=Object.fromEntries(Array.from({length:32},(_,i)=>['field_'+i,'exact']));
  assert.equal(validateContractVersion('PersonalizeBatchRequest','1.0.0',value).ok,true);value.input.rows[0].fields.extra='x';assert.equal(validateContractVersion('PersonalizeBatchRequest','1.0.0',value).ok,false);
});
