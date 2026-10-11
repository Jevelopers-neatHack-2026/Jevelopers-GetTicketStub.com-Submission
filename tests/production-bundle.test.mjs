import test from 'node:test';
import assert from 'node:assert/strict';
import { calibration,clone,readProduction,observedFiles,byteContext } from './production-seeds.mjs';
import { storedZip,maxPayloadProtocol } from './production-archive-seeds.mjs';
import { verifyProductionBundleFiles,verifyProductionZip,productionArchiveLimits,parseProductionCanonicalBytes,checkProductionBundleV2,productionBundleContentHash,checkProductionFile,translateProductionBundleV2ToV1,checkProductionPreflight } from '../tooling/production-operations.mjs';
import { hashBytes,canonicalJson,validateContractVersion } from '../tooling/runtime.mjs';
import { checkProductionBundle } from '../tooling/commerce-evidence.mjs';
const bundle=await readProduction('ProductionBundle.2_0_0'),report=await readProduction('PreflightReport');
test('original calibration verifies exact protocol and remains blocked',()=>{
  const result=verifyProductionBundleFiles(observedFiles(),byteContext());assert.equal(result.ok,true);assert.equal(result.value.integrity,'passed');assert.equal(result.value.eligibility,'blocked');assert.equal(result.value.bundle.composition.render_hash,hashBytes(observedFiles().find(file=>file.filename==='output.svg').bytes));
});
for(const kind of ['missing','extra','tampered','duplicate','casefold'])test('outer '+kind+' is rejected',()=>{
  const files=observedFiles();
  if(kind==='missing')files.pop();else if(kind==='extra')files.push({filename:'extra.json',bytes:Buffer.from('{}')});else if(kind==='tampered')files[0].bytes=Buffer.from('substitution');else if(kind==='duplicate')files.push(files[0]);else files.push({...files[0],filename:files[0].filename.toUpperCase()});
  assert.equal(verifyProductionBundleFiles(files,byteContext()).ok,false);
});
test('a co-tampered protocol cannot authenticate against independently pinned outer bytes',()=>{
  const changed=maxPayloadProtocol(7);assert.equal(verifyProductionBundleFiles(changed.files,byteContext()).ok,false);assert.equal(verifyProductionBundleFiles(changed.files,{scope:calibration.scope}).ok,false);
});
test('metadata row binding is independent of integrity',()=>{
  const context=byteContext();context.trusted_commitment.row_scope={job_ref:clone(calibration.batch.job),row_id:'row_1',ordinal:0,input_hash:calibration.batch.rows[0].input_hash};assert.equal(verifyProductionBundleFiles(observedFiles(),context).ok,false);
});
for(const role of ['manifest','archive','detached'])test(role+' recursion rejects after valid content rehash',()=>{
  const changed=clone(bundle);changed.files.push(clone(calibration.trusted_commitment.file_set.find(file=>file.role===role)));changed.bundle_hash=productionBundleContentHash(changed);assert.equal(checkProductionBundleV2(changed,calibration.scope).ok,false);
});
for(const filename of ['../payload.json','/payload.json','a/b.json','a\\b.json','output..svg','.hidden','output.svg.','MANIFEST.JSON'])test('unsafe or reserved filename '+filename+' rejects',()=>{const file=clone(bundle.files[0]);file.filename=filename;assert.equal(checkProductionFile(file).ok,false);});
test('nonvisual metadata cannot claim geometry',()=>{const file=clone(bundle.files.find(file=>file.role==='lineage'));file.geometry={width_nm:'1',height_nm:'1',width_px:null,height_px:null,effective_dpi:null};assert.equal(checkProductionFile(file).ok,false);});
test('97 payloads, 98 ZIP entries and 100 descriptors pass together',()=>{
  const maximal=maxPayloadProtocol();assert.equal(maximal.bundle.files.length,97);assert.equal(maximal.context.trusted_commitment.file_set.length,100);assert.equal(verifyProductionBundleFiles(maximal.files,maximal.context).ok,true);
});
test('payload and outer limits plus one reject before allocations',()=>{
  const maximal=maxPayloadProtocol(98);assert.equal(validateContractVersion('ProductionBundle','2.0.0',maximal.bundle).ok,false);assert.equal(verifyProductionBundleFiles(maximal.files,maximal.context).ok,false);
});
test('archive entry count plus one rejects before entry parsing',()=>{
  const entries=Array.from({length:99},(_,i)=>({filename:'p'+i.toString().padStart(3,'0')+'.json',bytes:Buffer.alloc(0)}));
  assert.equal(verifyProductionZip(storedZip(entries),entries.map(file=>({filename:file.filename,byte_hash:hashBytes(file.bytes),byte_size:0}))).errors[0].code,'RESOURCE_LIMIT');
});
const archive=observedFiles().find(file=>file.filename==='archive.zip').bytes;
const zipExpected=calibration.trusted_commitment.file_set.filter(file=>!['archive','detached'].includes(file.role));
for(const [kind,mutate] of [['prefix',bytes=>Buffer.concat([Buffer.from('junk'),bytes])],['trailing',bytes=>Buffer.concat([bytes,Buffer.from('junk')])],['encryption',bytes=>{bytes.writeUInt16LE(1,6);return bytes;}],['compression',bytes=>{bytes.writeUInt16LE(8,8);return bytes;}],['local name',bytes=>{bytes[30]=65;return bytes;}],['local size',bytes=>{bytes.writeUInt32LE(1,18);return bytes;}],['symlink',bytes=>{bytes.writeUInt32LE(0xa1ff0000,bytes.readUInt32LE(bytes.length-6)+38);return bytes;}],['directory',bytes=>{bytes.writeUInt32LE(0x41ed0010,bytes.readUInt32LE(bytes.length-6)+38);return bytes;}],['central offset',bytes=>{bytes.writeUInt32LE(1,bytes.readUInt32LE(bytes.length-6)+42);return bytes;}]])test('ZIP '+kind+' fails independent archive verification',()=>assert.equal(verifyProductionZip(mutate(Buffer.from(archive)),zipExpected).ok,false));
test('at-limit entry bytes pass and over-limit reject before body verification',()=>{
  const bytes=Buffer.alloc(productionArchiveLimits.entry_bytes),expected=[{filename:'entry.json',byte_hash:hashBytes(bytes),byte_size:bytes.length}];assert.equal(verifyProductionZip(storedZip([{filename:'entry.json',bytes}]),expected).ok,true);
  const bad=Buffer.from(archive),central=bad.readUInt32LE(bad.length-6);bad.writeUInt32LE(productionArchiveLimits.entry_bytes+1,central+24);assert.equal(verifyProductionZip(bad,zipExpected).errors[0].code,'RESOURCE_LIMIT');
});
for(const text of [canonicalJson(bundle)+'\n','\ufeff'+canonicalJson(bundle),canonicalJson(bundle).replace('"contract":"ProductionBundle"','"contract":"ProductionBundle","contract":"ProductionBundle"'),canonicalJson(bundle).replace('"contract":"ProductionBundle"','"contract":"\\ud800"')])test('noncanonical or lossy raw manifest is rejected '+hashBytes(Buffer.from(text)).slice(-8),()=>assert.equal(parseProductionCanonicalBytes('ProductionBundle','2.0.0',Buffer.from(text),productionArchiveLimits.manifest_bytes).ok,false));
test('invalid raw UTF8 cannot be repaired into canonical input',()=>assert.equal(parseProductionCanonicalBytes('ProductionBundle','2.0.0',Uint8Array.of(0xff),1024).ok,false));
test('content, raw manifest, ZIP and detached domains stay distinct',()=>{
  const hashes=[bundle.bundle_hash,...calibration.trusted_commitment.file_set.filter(file=>['manifest','archive','detached'].includes(file.role)).map(file=>file.byte_hash)];assert.equal(new Set(hashes).size,4);
});
test('old direct version and v1 helper remain version-specific',async()=>{
  const v1=await readProduction('ProductionBundle');assert.equal(validateContractVersion('ProductionBundle','1.0.0',v1).ok,true);assert.equal(checkProductionBundle(bundle,{}).errors[0].code,'UNSUPPORTED_VERSION');assert.equal(translateProductionBundleV2ToV1(bundle).errors[0].code,'LEGACY_UNREPRESENTABLE');
});
test('unknown calibration preflight cannot become eligible from report presence',()=>assert.equal(checkProductionPreflight(report,{artifact_ref:report.body.artifact_ref,spec_ref:report.body.spec_ref,rule_ref:report.body.rule_ref,parser_ref:bundle.renderer_ref,files:bundle.files}).errors[0].code,'PREFLIGHT_FAILED'));
