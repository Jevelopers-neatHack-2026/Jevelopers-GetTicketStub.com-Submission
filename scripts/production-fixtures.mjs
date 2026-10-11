import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashBytes, hashManifest, canonicalJson, validateContractVersion } from '../tooling/runtime.mjs';
import { productionContentHash } from '../tooling/production-values.mjs';
import { productionBundleContentHash, productionPayloadSetHash } from '../tooling/production-bundle.mjs';
import { createProductionError } from '../tooling/production-errors.mjs';
import { crc32 } from 'node:zlib';
import { hashPrintSpec } from '../tooling/capability.mjs';
import { researchContentHash } from '../tooling/research-creative.mjs';

const packet = resolve(process.argv[2]);
const rootDigest = 'sha256:4d748f251360e9ddbfeec62d80699702c479c3c6ad67a9321581c546e86280ec';
if (hashBytes(await readFile(packet + '/digest-manifest.json')) !== rootDigest) throw new Error('Wrong immutable packet');
const read = async name => JSON.parse(await readFile(name, 'utf8'));
const priorCalibration = await read('fixtures/ProductionCalibration.json');
const priorProvenance = await read('fixtures/ProductionDerivedProvenance.json');
const source = await read(packet + '/proposal.json');
const index = await read(packet + '/fixtures/index.json');
for (const entry of index.fixtures) {
  const bytes = await readFile(packet + '/fixtures/' + entry.path);
  if (hashBytes(bytes) !== 'sha256:' + entry.byte_sha256 || bytes.byteLength !== entry.byte_size) throw new Error('Fixture source drift');
}
const uuid = n => '123e4567-e89b-42d3-a456-' + n.toString(16).padStart(12, '0');
const scope = { tenant_id: uuid(1), project_id: uuid(2) }, now = '2026-10-11T08:10:00.000Z';
const header = contract => ({ contract, schema_version: '1.0.0', policy_version: '1.0.0' });
const reference = (contract, id, hash, version = '1.0.0') => ({ contract, schema_version: version, id, revision: 1, content_hash: hash });
const seal = value => ({ ...value, content_hash: productionContentHash(value) });
const values = {}, fixtures = {};
const add = value => { values[value.contract] = value; return value; };
const resource = (kind, id) => seal({ ...header('ProductionResource'), ...scope, id: uuid(id), revision: 1, kind, byte_hash: hashManifest({ synthetic_resource: kind, id }), license_ref: null });
const font = resource('font', 10), product = resource('product', 11), lineageResource = resource('lineage', 12);
const fontRef = reference('ProductionResource', font.id, font.content_hash);
add(font);
const policyDocuments = Object.fromEntries(['layout','formatting','output','repair','warning','proof','inspection'].map((kind,i) => [kind, seal({ ...header('ProductionPolicy'), ...scope, id: uuid(20+i), revision: 1, kind,
  commitment: hashManifest({ synthetic_policy: kind }), formatting: kind === 'formatting' ? { locale: 'en-US', timezone: 'UTC' } : null,
  output: kind === 'output' ? { color_space: 'sRGB', pdf_profile: 'plain', minimum_dpi: 300, formats: ['svg','png','pdf'] } : null })]));
add(policyDocuments.output);
const policyRefs = Object.fromEntries(Object.entries(policyDocuments).map(([kind,doc]) => [kind,reference('ProductionPolicy',doc.id,doc.content_hash)]));
const runtime = add(seal({ ...header('ProductionRuntime'), ...scope, id: uuid(30), revision: 1, source_revision: 'adb3e1b5b5a76bc8a530fd67633d700905f67c8e', renderer_commitment: hashManifest({ synthetic_runtime: 'renderer' }), parser_commitment: hashManifest({ synthetic_runtime: 'parser' }) }));
const runtimeRef = reference('ProductionRuntime',runtime.id,runtime.content_hash);
const spec = structuredClone((await read('fixtures/PrintSpec.json')).valid); Object.assign(spec,scope);
spec.spec_identity = hashPrintSpec(spec).value;
const specRef = reference('PrintSpec',uuid(40),spec.spec_identity);
const capture = structuredClone((await read('fixtures/FulfillmentCapabilitySnapshot.json')).valid);
const capabilityRef = reference('FulfillmentCapabilitySnapshot',uuid(41),capture.capture_identity);
const facts = structuredClone((await read('fixtures/EventIntelligencePackage.json')).valid); Object.assign(facts,scope);
facts.package_hash = researchContentHash(facts, 'package_hash');
const factsRef = reference('EventIntelligencePackage',facts.package_id,facts.package_hash);
const design = (await read('fixtures/DesignVersion.json')).valid, handoff = (await read('fixtures/ArtifactHandoffManifest.json')).valid;
const approval = (await read('fixtures/ApprovalReceipt.json')).valid;
const designRef = reference('DesignVersion',design.design_version_id,researchContentHash(design, 'design_hash'));
const handoffRef = reference('ArtifactHandoffManifest',handoff.handoff_id,handoff.manifest_hash);
const approvalRef = reference('ApprovalReceipt',approval.approval_id,approval.receipt_hash);
const policy = (await read(packet + '/fixtures/personalization-schema.json')).wire;
delete policy.template_ref; Object.assign(policy,header('PersonalizationSchema'),scope,{ schema_id:uuid(50), revision:1 });
policy.fields.push({ field_id:'title',slot_id:'title-slot',required:true,maximum_utf16_units:200,source_policy:'approved_fact_readonly' }); policy.limits.maximum_fields=3;
const personalization = add(seal(policy));
const template = (await read(packet + '/fixtures/template-spec.json')).wire;
Object.assign(template,header('TemplateSpec'),scope,{ template_id:uuid(51),product_ref:reference('ProductionResource',product.id,product.content_hash),spec_ref:specRef,capability_ref:capabilityRef,
  layout_policy_ref:policyRefs.layout,color_policy_ref:policyRefs.output,formatting_policy_ref:policyRefs.formatting,warning_policy_ref:policyRefs.warning,proof_policy_ref:policyRefs.proof,font_refs:[fontRef],personalization_schema_ref:reference('PersonalizationSchema',personalization.schema_id,personalization.content_hash) });
for (const slot of template.slots) if (slot.kind === 'text') slot.allowed_font_refs=[fontRef];
template.slots.push({ ...structuredClone(template.slots.find(slot => slot.kind === 'text')),slot_id:'title-slot',field_id:'title' });
const sealedTemplate = add(seal(template)), templateRef=reference('TemplateSpec',template.template_id,sealedTemplate.content_hash);
const byteTable = (await read(packet + '/fixtures/bytes.json')).artifacts;
const bytes = Object.fromEntries(Object.entries(byteTable).map(([name,row])=>[name,Buffer.from(row.base64,'base64')]));
const sourceHash=hashBytes(bytes['output.svg']);
const sourceRef=reference('ArtifactFile',uuid(60),sourceHash,'2.0.0');
const asset={ asset_ref:sourceRef,permission_ref:approvalRef,purpose:'artwork',normalization_policy_ref:null };
const logoRef=reference('ArtifactFile',uuid(62),hashBytes(bytes['source-logo.svg']),'2.0.0');
const logoAsset={asset_ref:logoRef,permission_ref:approvalRef,purpose:'overlay',normalization_policy_ref:null};
const composition={ ...header('Composition'),...scope,composition_id:uuid(61),revision:1,design_ref:designRef,handoff_ref:handoffRef,facts_ref:factsRef,template_ref:templateRef,spec_ref:specRef,capability_ref:capabilityRef,asset_uses:[asset],values:{ name:{kind:'display',value:'0001'},detail:{kind:'display',value:'A\u0301da'} },fact_bindings:[{slot_id:'title-slot',fact_key:'title',value_hash:hashManifest({kind:'display',value:facts.facts[0].value})}],policy_refs:{formatting:policyRefs.formatting,layout:policyRefs.layout,output:policyRefs.output,repair:null},font_refs:[fontRef],runtime_ref:runtimeRef,resolved_layout_commitment:hashManifest({ synthetic_private_layout:'explicit test double; completeness not attested' }),barcode:{state:'absent',reason:'not_requested'} };
composition.input_binding_hash=hashManifest({ values:composition.values,fact_bindings:composition.fact_bindings,facts_ref:composition.facts_ref,formatting:composition.policy_refs.formatting });
composition.asset_uses.push(logoAsset);
composition.slot_bindings=[{slot_id:'art-slot',source:{kind:'asset',asset_ref:sourceRef}},{slot_id:'logo-slot',source:{kind:'asset',asset_ref:logoRef}},{slot_id:'name-slot',source:{kind:'value',field_id:'name'}},{slot_id:'detail-slot',source:{kind:'value',field_id:'detail'}},{slot_id:'title-slot',source:{kind:'fact',fact_key:'title'}}];
const sealedComposition=add(seal(composition)),compositionRef=reference('Composition',composition.composition_id,sealedComposition.content_hash);
const artifact=add({ ...header('ArtifactRef'),artifact_ref:sourceRef,composition_ref:compositionRef,private_revision_hash:hashManifest({ compositionHash:sealedComposition.content_hash,renderHash:sourceHash }),source_artwork_hashes:[sourceHash,logoRef.content_hash],render_hash:sourceHash,preview_ref:null });
const binding={ design_ref:designRef,handoff_ref:handoffRef,facts_ref:factsRef,asset_refs:[asset,logoAsset],approval_ref:approvalRef,template_ref:templateRef,spec_ref:specRef,capability_ref:capabilityRef,composition_ref:compositionRef,formatting_policy_ref:policyRefs.formatting,repair_policy_ref:null,values:composition.values };
const reqHeader=contract=>({...header(contract),request_id:uuid(70),correlation_id:uuid(71)});
add({...reqHeader('ComposeArtifactRequest'),binding,idempotency_key:'compose_1'});
const rows=[{row_id:'row_1',fields:{name:'0001',detail:'A\u0301da'}},{row_id:'row_2',fields:{name:'0001',detail:'A\u0301da'}}];
const personalize=add({...reqHeader('PersonalizeBatchRequest'),binding,input:{kind:'structured',row_schema_ref:template.personalization_schema_ref,rows},idempotency_key:'batch_1'});
add({...reqHeader('InspectArtifactRequest'),artifact_ref:artifact,spec_ref:specRef,capability_ref:capabilityRef,inspection_policy_ref:policyRefs.inspection});
add({...reqHeader('ExportBundleRequest'),artifact_ref:artifact,spec_ref:specRef,capability_ref:capabilityRef,approval_ref:approvalRef,formats:['svg','png','pdf'],output_policy_ref:policyRefs.output,idempotency_key:'export_1'});
const comparison={ source_template_ref:templateRef,target_template_ref:templateRef,spec_ref:specRef,capability_ref:capabilityRef };
add({...reqHeader('CompareTemplateRequest'),...comparison}); add({...header('CompatibilityReport'),...comparison,state:'unknown',reasons:['SPEC_UNKNOWN'],changed_constraints:[],relayout:false,reapproval:false});
const pins=add({...header('ProductionExecutionPins'),...scope,runtime_ref:runtimeRef,font_refs:[fontRef],output_policy_ref:policyRefs.output,template_ref:templateRef,spec_ref:specRef,capability_ref:capabilityRef,approval_ref:approvalRef});
const {request_id,correlation_id,idempotency_key,...semantic}=personalize; semantic.acceptance_policy='atomic';
const job=add({...header('JobRef'),job_ref:reference('JobStatus',uuid(80),hashManifest({synthetic_job:'one'})),batch_input_hash:hashManifest({operation:'personalizeArtifactBatch',input:semantic,pins})});
add({...reqHeader('ArtifactStatusRequest'),target:{kind:'job',job_ref:job}});
const eligibility={state:'blocked',reason_codes:['CALIBRATION_ONLY','OWNER_ACCEPTANCE_PENDING'],checked_at:now,evidence_mode:'offline',handoff_eligible:false};
const reportBody={ artifact_ref:artifact,spec_ref:specRef,rule_ref:policyRefs.inspection,status:'unknown',checked_files:[],findings:[],model_ready:true,files_ready:false };
const report=add({...header('PreflightReport'),report_ref:reference('PreflightReport',uuid(81),hashManifest(reportBody)),body:reportBody,eligibility});
bytes['report.json']=Buffer.from(canonicalJson(report));
bytes['lineage.json']=Buffer.from(canonicalJson({synthetic:true,source:sourceHash,composition:compositionRef,render_hash:sourceHash}));
bytes['profile.json']=Buffer.from(canonicalJson({synthetic:true,description:'sRGB calibration descriptor; not ICC bytes'}));
const file=(name,role,id)=>({ ...header('ArtifactFile'),schema_version:'2.0.0',artifact_id:uuid(id),filename:name,role,byte_hash:hashBytes(bytes[name]),byte_size:bytes[name].length,media_type:name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':name.endsWith('.pdf')?'application/pdf':name.endsWith('.zip')?'application/zip':'application/json',geometry:null,profile_ref:null,characteristics:null,semantic_hash:role==='preflight_report'?report.report_ref.content_hash:null });
const payloads=[file('output.svg','print_output',90),file('output.png','print_output',91),file('output.pdf','print_output',92),file('report.json','preflight_report',93),file('profile.json','profile',94),file('lineage.json','lineage',95)]; add(payloads[0]);
const bundle={...(await read('fixtures/ProductionBundle.json')).valid,...header('ProductionBundle'),schema_version:'2.0.0',...scope,bundle_id:uuid(96),bundle_version:1,handoff_ref:handoffRef,approval_ref:approvalRef,facts_ref:factsRef,composition_ref:compositionRef,template_ref:templateRef,spec_ref:specRef,capability_ref:capabilityRef,renderer_ref:runtimeRef,font_refs:[fontRef],policy_refs:composition.policy_refs,composition:{facts_hash:factsRef.content_hash,composition_hash:compositionRef.content_hash,source_artwork_hashes:[sourceHash,logoRef.content_hash],displayed_preview_hash:null,composed_preview_hash:null,render_hash:sourceHash,private_revision_hash:artifact.private_revision_hash,input_binding_hash:composition.input_binding_hash,barcode_hash:null},files:payloads,preflight:{report_ref:report.report_ref,status:'unknown',reasons:['SPEC_UNKNOWN','CALIBRATION_ONLY']},lineage_ref:reference('ProductionResource',lineageResource.id,hashBytes(bytes['lineage.json'])),row_scope:null,usage_refs:[],decision_refs:[]};
for(const key of ['print_spec','composed_preview_ref','source_artwork_ref','template_version','font_versions'])delete bundle[key];
delete bundle.bundle_hash; bundle.bundle_hash=productionBundleContentHash(bundle); add(bundle);
bytes['manifest.json']=Buffer.from(canonicalJson(bundle)); const manifestFile=file('manifest.json','manifest',97);
const zipEntries=[...payloads,manifestFile].sort((a,b)=>a.filename<b.filename?-1:a.filename>b.filename?1:0),local=[],central=[];let offset=0;
for(const descriptor of zipEntries){const data=bytes[descriptor.filename],name=Buffer.from(descriptor.filename),l=Buffer.alloc(30),c=Buffer.alloc(46);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(0x2821,12);l.writeUInt32LE(crc32(data),14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(name.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x2821,14);c.writeUInt32LE(crc32(data),16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(0x81a40000,38);c.writeUInt32LE(offset,42);local.push(l,name,data);central.push(c,name);offset+=l.length+name.length+data.length;}
const centralBytes=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(zipEntries.length,8);end.writeUInt16LE(zipEntries.length,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(offset,16);bytes['archive.zip']=Buffer.concat([...local,centralBytes,end]);
const archiveFile=file('archive.zip','archive',98),bundleRef=reference('ProductionBundle',bundle.bundle_id,bundle.bundle_hash,'2.0.0');
const detached=add({...header('ProductionBundleDetached'),bundle_ref:bundleRef,manifest:manifestFile,archive:archiveFile,lineage_hash:hashBytes(bytes['lineage.json']),payload_set_hash:productionPayloadSetHash(payloads)});
bytes['detached.json']=Buffer.from(canonicalJson(detached)); const detachedFile=file('detached.json','detached',99);
const publication=add({...header('ProductionBundleRef'),bundle_ref:bundleRef,file_set:[...payloads,manifestFile,archiveFile,detachedFile],detached_ref:reference('ProductionBundleDetached',uuid(100),detachedFile.byte_hash),row_scope:null,composition_ref:compositionRef,eligibility});
const error=createProductionError('ROW_SCHEMA',{scope,operation:'personalizeArtifactBatch',correlation_id:uuid(71),row_id:'row_2',side_effects:'none',usage_state:'unknown'}).value;add(error);
const row=add({...header('RowResult'),...scope,job,row_id:'row_1',ordinal:0,input_hash:hashManifest(rows[0]),status:'succeeded',skip_reason:null,artifact_ref:null,bundle_ref:null,errors:[],source_position:null,eligibility});
const batch=add({...header('BatchResult'),...scope,job,acceptance_policy:'atomic',status:'failed',counts:{submitted:2,succeeded:1,failed:1,cancelled:0,skipped:0,pending:0},published_count:0,rows:[row,{...row,row_id:'row_2',ordinal:1,input_hash:hashManifest(rows[1]),status:'failed',errors:[error]}],page_start:0,next_cursor:null,batch_manifest_ref:null,cancel_requested:false,eligibility});
add({...header('ArtifactManifestStatus'),target:{kind:'job',job_ref:job},status:'failed',bundle_ref:null,batch,integrity:'unknown',eligibility,evidence_refs:[]});
add({...header('ProductionReference'),reference:templateRef});add(seal({...header('ProductionDiagnostic'),...scope,id:uuid(110),revision:1,operation:'composeArtifact',reason_codes:['INVALID_INPUT']}));
const dialect=add(seal({...header('CsvDialect'),...scope,id:uuid(111),revision:1,encoding:'utf-8',bom:'optional',delimiter:',',quote:'"',newline:'lf',header:'required',maximum_record_bytes:131072}));
const mapping=add(seal({...header('CsvMapping'),...scope,id:uuid(112),revision:1,row_schema_ref:template.personalization_schema_ref,headers:['id','name','detail'],field_mapping:{name:'name',detail:'detail'},row_id_header:'id'}));
add({...header('CsvCheckpoint'),...scope,file_ref:sourceRef,dialect_ref:reference('CsvDialect',dialect.id,dialect.content_hash),mapping_ref:reference('CsvMapping',mapping.id,mapping.content_hash),byte_offset:0,logical_record:1,physical_line:1,complete_record:true});
for (const [contract,valid] of Object.entries(values)) {
  const checked=validateContractVersion(contract,valid.schema_version,valid);if(!checked.ok)throw new Error('Invalid derived '+contract+': '+JSON.stringify(checked));
  const negative=(id,category,change,code='INVALID_PAYLOAD',path='/contract')=>({id,category,policy_version:'1.0.0',...change,expected:{ok:false,code,path}});
  const cases=[{id:'minimal',category:'minimal',policy_version:'1.0.0',expected:{ok:true}},{id:'full',category:'full',policy_version:'1.0.0',expected:{ok:true}},negative('missing','missing',{remove:['contract']},'INVALID_PAYLOAD','/contract'),negative('type','type',{set:{contract:0}}),negative('enum','enum',{set:{contract:'OtherContract'}}),negative('parse','malformed_json',{mode:'parse',json:'{'},'MALFORMED_JSON',''),negative('version','unsupported_version',{set:{schema_version:'9.0.0'}},'UNSUPPORTED_VERSION','/schema_version'),...['unknown_field','unknown_critical','additive_field'].map(category=>negative(category,category,{set:{tenant_override:true}},'INVALID_PAYLOAD','')), {id:'retained',category:'retained_encoding',policy_version:'1.0.0',mode:'parse',json:canonicalJson(valid),expected:{ok:true}}];
  const context={scope,expected:valid,template:sealedTemplate,personalization,facts:{reference:factsRef,package:facts},asset_bytes:{[sourceRef.id]:bytes['output.svg'].toString('base64'),[logoRef.id]:bytes['source-logo.svg'].toString('base64')},job,rows,request:personalize,pins,composition:sealedComposition,render_bytes:bytes['output.svg'].toString('base64'),byte_files:Object.fromEntries(Object.entries(bytes).filter(([name])=>publication.file_set.some(file=>file.filename===name)).map(([name,data])=>[name,data.toString('base64')])),trusted_commitment:publication};
  cases.push({id:'production-independent-bindings',category:'production_semantic',policy_version:'1.0.0',mode:'production',context,expected:{ok:true}});
  const path='fixtures/'+contract+(valid.schema_version==='2.0.0'?'.2_0_0':'')+'.json'; const fixture={contract,schema_version:valid.schema_version,policy_version:'1.0.0',evidence_mode:'synthetic_candidate_values_only',accepted:false,live_integration:false,valid,cases};
  await writeFile(path,JSON.stringify(fixture,null,2)+'\n');fixtures[contract]=path;
}
const evidence={scope,now,template:sealedTemplate,personalization,composition:sealedComposition,facts:{reference:factsRef,package:facts},spec,capture,pins,policy_documents:policyDocuments,resources:[font,product,lineageResource],asset_bytes:{[sourceRef.id]:bytes['output.svg'].toString('base64'),[logoRef.id]:bytes['source-logo.svg'].toString('base64')},byte_files:Object.fromEntries(Object.entries(bytes).filter(([name])=>publication.file_set.some(file=>file.filename===name)).map(([name,data])=>[name,data.toString('base64')])),trusted_commitment:publication,rows,batch,accepted:false,live_integration:false,synthetic:true};
await writeFile('fixtures/ProductionCalibration.json',JSON.stringify(evidence,null,2)+'\n');
const provenance={packet_root:rootDigest,source_sha:source.sourceSHA,transformation_version:'canonical-production-corrections/1',evidence_mode:'genuine_synthetic_test_doubles_and_original_calibration_bytes',accepted:false,live_integration:false,originals:index.fixtures.map(row=>({path:row.path,source_byte_size:row.byte_size,source_byte_hash:'sha256:'+row.byte_sha256,mapping:'C1..C15 canonical adaptation and corresponding negative checker; original remains private and unchanged'})),derived:await Promise.all(Object.entries(fixtures).map(async([contract,path])=>({contract,path,byte_hash:hashBytes(await readFile(path)),content_hash:values[contract].content_hash??null}))),domains:{composition:compositionRef.content_hash,render:sourceHash,batch:job.batch_input_hash,bundle:bundle.bundle_hash,manifest:manifestFile.byte_hash,archive:archiveFile.byte_hash,detached:detachedFile.byte_hash,payload_set:detached.payload_set_hash},limitations:['Calibration is not personalized production output.','Synthetic references and policy documents have no real registry or issuer authority.','Unconfirmed domain facts, fonts, geometry, approval and consumer pins remain pending.']};
provenance.integrity_repair = {
  transformation_version: 'canonical-production-integrity/1',
  source_commit: 'b47defaaf630c9d64dcc315c6c4d49fadd194587',
  before: priorProvenance.integrity_repair?.before ?? { domains: priorProvenance.domains, derived: priorProvenance.derived, facts: priorCalibration.facts.reference, design: priorCalibration.composition.design_ref },
  after: { domains: provenance.domains, derived: provenance.derived, facts: factsRef, design: designRef },
  mappings: ['EventIntelligencePackage.package_hash uses existing researchContentHash(package, package_hash), excluding delivery fields.', 'DesignVersion reference uses existing researchContentHash(design, design_hash).', 'Recompute composition/input, request/plan, report, lineage, payload, bundle, manifest, archive and detached commitments from the corrected dependencies.'],
  raw_packet_unchanged: true,
  original_expectations_unchanged: true,
  accepted: false
};
await writeFile('fixtures/ProductionDerivedProvenance.json',JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({derived_contracts:Object.keys(values).length,source_vectors:index.fixtures.length,domains:provenance.domains}));
