import test from 'node:test';
import assert from 'node:assert/strict';
import { calibration,clone,compositionContext,readProduction } from './production-seeds.mjs';
import { productionContentHash,checkTemplateSpec,checkComposition,checkPersonalizationSchema,nmToPrivateMillimetres,privateMillimetresToNm,translateProductionGeometry,compareProductionTemplates } from '../tooling/production-operations.mjs';
const seal=value=>({...value,content_hash:productionContentHash(value)});
test('derived layout is bounded desired geometry',()=>assert.equal(checkTemplateSpec(calibration.template,calibration.scope).ok,true));
test('sealed Composition checks supported independent facts and expected commitments',()=>assert.equal(checkComposition(calibration.composition,compositionContext()).ok,true));
for(const [name,mutate] of [['duplicate slot',t=>t.slots.push(clone(t.slots[0]))],['duplicate field',t=>t.slots[1].field_id=t.slots[2].field_id],['orientation',t=>t.orientation='portrait'],['negative slot',t=>t.slots[0].bounds.x_nm='-1'],['canvas overflow',t=>t.slots[0].bounds.width_nm='2000000001'],['zero rectangle',t=>t.coordinate_geometry.safe.width_nm='0'],['font bounds',t=>t.slots[1].font_bounds_nm.minimum='8000000'],['unknown font',t=>t.slots[1].allowed_font_refs[0].revision=2],['unapproved crop',t=>t.slots[0].allowed_fits=['cover']]])test(name+' is rejected after rehash',()=>{
  const t=clone(calibration.template);mutate(t);assert.equal(checkTemplateSpec(seal(t),calibration.scope).ok,false);
});
for(const key of Object.keys(calibration.template).filter(key=>!['contract','schema_version','policy_version','content_hash'].includes(key)))test('template hash binds '+key,()=>{
  const value=clone(calibration.template);delete value[key];assert.notEqual(productionContentHash(value),calibration.template.content_hash);
});
for(const key of Object.keys(calibration.composition).filter(key=>!['contract','schema_version','policy_version','content_hash'].includes(key)))test('composition hash binds '+key,()=>{
  const value=clone(calibration.composition);delete value[key];assert.notEqual(productionContentHash(value),calibration.composition.content_hash);
});
for(const name of ['fact override','missing fact binding','changed fact','unknown facts','missing asset','extra asset','tampered source','layout commitment','policy pin','font pin','runtime pin'])test(name+' cannot establish composition completeness',()=>{
  const value=clone(calibration.composition),ctx=compositionContext();
  if(name==='fact override')value.values.title={kind:'display',value:'Customer override'};
  else if(name==='missing fact binding')value.fact_bindings=[];
  else if(name==='changed fact')value.fact_bindings[0].value_hash='sha256:'+'f'.repeat(64);
  else if(name==='unknown facts')ctx.facts=null;
  else if(name==='missing asset')ctx.asset_bytes={};
  else if(name==='extra asset')ctx.asset_bytes.extra=Buffer.from('synthetic');
  else if(name==='tampered source')ctx.asset_bytes[Object.keys(ctx.asset_bytes)[0]]=Buffer.from('synthetic replacement');
  else if(name==='layout commitment')ctx.expected_resolved_layout_commitment='sha256:'+'a'.repeat(64);
  else if(name==='policy pin')ctx.expected_policy_refs.output.revision++;
  else if(name==='font pin')ctx.expected_font_refs[0].revision++;
  else ctx.expected_runtime_ref.revision++;
  assert.equal(checkComposition(seal(value),ctx).ok,false);
});
for(const nm of ['0','1','-1','999999','-999999','1000000','2000000000','-2000000000'])test('exact nm/mm roundtrip '+nm,()=>{
  const converted=nmToPrivateMillimetres(nm,'2000000000');assert.equal(converted.ok,true);assert.equal(privateMillimetresToNm(converted.value,'2000000000').value,nm);
});
for(const input of ['-0.000000','0.0000001','0.1','NaN','2000.000001'])test('unsupported decimal '+input+' blocks without rounding',()=>assert.equal(privateMillimetresToNm(input,'2000000000').ok,false));
test('missing private maximum fails explicitly',()=>assert.equal(nmToPrivateMillimetres('1',undefined).errors[0].code,'LEGACY_UNREPRESENTABLE'));
test('complete valid PrintSpec retains unknown supplier geometry',()=>assert.equal(translateProductionGeometry(calibration.spec,{scope:calibration.scope,maximum_nm:'2000000000'}).errors[0].code,'GEOMETRY_UNCONFIRMED'));
test('policy has no hash back-edge to template',()=>{
  assert.equal(Object.hasOwn(calibration.personalization,'template_ref'),false);
  assert.equal(checkPersonalizationSchema(calibration.personalization,calibration.template).ok,true);
});
test('material change requires relayout and reapproval',()=>{
  const current=clone(calibration.template);current.minimum_effective_dpi++;
  const result=compareProductionTemplates(calibration.template,seal(current),calibration.scope);assert.equal(result.value.relayout,true);assert.equal(result.value.reapproval,true);
});
test('barcode absence is explicit and cannot borrow a facts digest',()=>{
  const value=clone(calibration.composition);value.barcode={state:'bound',symbology:'qr',slot_id:'shape-slot',input_hash:value.facts_ref.content_hash};
  assert.equal(checkComposition(seal(value),compositionContext()).errors[0].code,'HASH_MISMATCH');
});
test('a commitment cannot hide missing required public slot bindings',()=>{
  const value=clone(calibration.composition);value.slot_bindings=value.slot_bindings.filter(binding=>binding.slot_id!=='logo-slot');assert.equal(checkComposition(seal(value),compositionContext()).errors[0].code,'INCOMPLETE_COMPOSITION');
});
