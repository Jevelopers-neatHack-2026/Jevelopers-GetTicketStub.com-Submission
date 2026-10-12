import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256, fileManifest, recordEvaluator } from './custody.mjs';
import { recordHash, loadCandidateFixtures } from './candidate924.mjs';
import { validateFixtureSchema } from './fixture-schema.mjs';

const here=dirname(fileURLToPath(import.meta.url));
export const exportFixtureRoot=join(here,'fixtures/export0c4');
const schemaPath=(version,name)=>`source/schemas/cost-intelligence/${version}/integrations/${name}Schema.json`;
const exactKeys=(value,keys,label)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),label);
const decimal=value=>{assert.match(value,/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u);const sign=value.startsWith('-')?-1n:1n;const [a,b='']=value.replace(/^-/u,'').split('.');return sign*BigInt(a+b.padEnd(18,'0'));};

export async function loadExportFixtures(directory=exportFixtureRoot) {
  const pin=JSON.parse(await readFile(join(here,'../contracts/finance-export0c4-fixture-pin.json')));
  assert.equal(pin.mode,'synthetic-captured-export-fixture-consumer');
  const actual=await fileManifest(directory);assert.deepEqual(actual.map(row=>row.path).sort(),Object.keys(pin.files).sort(),'Exact export packet file set');
  const raw={};const files={};
  for(const [name,digest]of Object.entries(pin.files)) {
    const bytes=await readFile(join(directory,name));assert.ok(bytes.length<=2*1024*1024,'Bounded export fixture');
    assert.equal(sha256(bytes),digest,`Pinned export fixture mismatch: ${name}`);raw[name]=bytes;
    if(name.endsWith('.json'))files[name]=JSON.parse(bytes);
  }
  const manifest=files['packet-file-manifest.json'];assert.equal(manifest.length,76);
  for(const row of manifest) {
    const name=relative(pin.originalPacketRoot,row.path);assert.ok(!isAbsolute(name)&&!name.startsWith('../'),'Confined original packet path');
    assert.equal(raw[name].length,row.byteLength);assert.equal(sha256(raw[name]),row.sha256);
  }
  const canonical=await loadCandidateFixtures();
  return {pin,files,raw,canonical:canonical.files};
}

function validateCanonical(summary,scope,registry,canonical) {
  validateFixtureSchema(canonical['FinancialSummary-schema.json'],summary,[canonical['CommonEnvelope-schema.json'],canonical['ErrorEnvelope-schema.json']]);
  assert.equal(summary.tenant_id,scope.tenantId);assert.equal(summary.project_id,scope.projectId);
  assert.equal(summary.environment,scope.environment);assert.equal(summary.billing_mode,scope.billingMode);
  assert.deepEqual(summary.policy_ref,registry.policy.reference,'Independent policy binding');
  assert.deepEqual(Object.keys(summary.metrics).sort(),Object.keys(registry.metrics).sort());
  for(const [name,metric]of Object.entries(summary.metrics)) {
    assert.deepEqual(metric.definition_ref,registry.metrics[name].reference,'Independent definition binding');
    if(metric.status!=='known')assert.equal(metric.value,null,'Canonical unknown stays null');
  }
  if(summary.coverage.expected===null)assert.equal(summary.completeness,'incomplete');
}

export function validateStructuralExportRequest(request,loaded) {
  const {files,canonical}=loaded;const version=request.schemaVersion;
  assert.ok(['1.0.0','2.0.0'].includes(version));
  validateFixtureSchema(files[schemaPath(version,version==='1.0.0'?'ExportRequest':'ReportingExportRequest')],request);
  const page=request.summarySnapshot;assert.equal(page.schemaVersion,version);
  validateFixtureSchema(files[`source/schemas/cost-intelligence/${version}/reporting/FinancialSummaryPageSchema.json`],page);
  if(version==='2.0.0')assert.deepEqual(request.scope,page.scope,'Full request/page scope binding');
  assert.equal(request.summaryContentHash,page.summaryContentHash);assert.equal(recordHash(page.summary),page.summaryContentHash,'Structural summary hash');
  const registry=files['source/fixtures/reporting/definition-registry.json'];
  if(version==='1.0.0')validateCanonical(page.summary,request.scope,registry,canonical);
  else {
    assert.deepEqual(page.canonicalSummaries.map(row=>row.currency),page.summary.currencies.map(row=>row.currency));
    for(const summary of page.canonicalSummaries)validateCanonical(summary,page.scope,registry,canonical);
  }
  assert.equal(request.destination,'cfo.ai');
  return {qualification:'STRUCTURAL_ONLY_NOT_CAPTURED_PG_REQUEST',version};
}

export function parseExportCsv(content) {
  assert.ok(Buffer.byteLength(content)<=1048576);const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<content.length;i++) {
    const char=content[i];
    if(quoted){if(char==='"'){if(content[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=char;}
    else if(char==='"'){assert.equal(cell,'','CSV quote boundary');quoted=true;}
    else if(char===','){row.push(cell);cell='';}
    else if(char==='\n'){row.push(cell.replace(/\r$/u,''));rows.push(row);row=[];cell='';}
    else cell+=char;
  }
  assert.equal(quoted,false,'CSV quote closed');if(cell||row.length){row.push(cell);rows.push(row);}
  const header=rows.shift();assert.equal(new Set(header).size,header.length);
  return rows.map(row=>{assert.equal(row.length,header.length,'CSV column count');return Object.fromEntries(header.map((key,index)=>[key,row[index]]));});
}

export function validateCapturedExport(receipt,query,loaded,{legacySnapshotAliasOnly=false}={}) {
  const {files}=loaded;const rich=receipt.schemaVersion==='2.0.0';const manifest=receipt.manifest;
  if(rich)validateFixtureSchema(files[schemaPath('2.0.0','ReportingExportReceipt')],receipt);
  else {exactKeys(receipt,['manifest','artifactManifest','artifacts'],'Legacy response constituents');validateFixtureSchema(files[schemaPath('1.0.0','ExportManifest')],manifest);}
  assert.equal(manifest.status,'prepared');assert.equal(manifest.destination,'cfo.ai');assert.equal(manifest.deliveryReference,null,'No delivery accepted');
  const artifactManifest=rich?manifest:receipt.artifactManifest;
  if(!rich) {
    // Projection of the hash-pinned runtime.ts TypeBox definition; no invented registered JSON schema.
    exactKeys(artifactManifest,['schemaVersion','status','destination','exportId','createdAt','requestedFormat','evidenceMode','snapshotId','summaryContentHash','queryContentHash','snapshotEnvelopeHash','artifactSetHash','artifacts','compatibility','delivery'],'Pinned runtime legacy artifact-manifest projection');
    assert.deepEqual(artifactManifest.compatibility,{financialSummarySchema:'1.0.0',financeExportSchema:'2.0.0',sharedContractsPackage:'0.3.0',adoption:'proposal_only',financeDefinitions:'pending_owner_review',dashboardSdkMapping:'pending_consumer_ack'});
    for(const key of ['status','destination','exportId','createdAt','snapshotId','summaryContentHash','queryContentHash','evidenceMode'])assert.deepEqual(artifactManifest[key],manifest[key],'Legacy manifest bindings');
  }else {assert.equal(manifest.canonicalAdoption,'proposal_only');assert.equal(manifest.consumerAcknowledgement,'pending');assert.equal(manifest.definitionsStatus,'pending_owner_review');}
  assert.equal(artifactManifest.delivery,'manual_prepared');assert.equal(manifest.evidenceMode,'mocked');
  if(legacySnapshotAliasOnly) {
    assert.equal(rich,false);assert.match(manifest.snapshotId,/^snapshot:[a-f0-9]{64}$/u);
    assert.equal(manifest.snapshotId,query.snapshotId,'Captured public legacy alias binding; raw-preimage equality unavailable');
  }else assert.equal(manifest.snapshotId,rich?query.snapshotId:'snapshot:'+recordHash(query.snapshotId).slice(7),'Captured snapshot/query binding');
  assert.equal(query.queryContentHash,manifest.queryContentHash,'Captured query binding');
  assert.equal(query.summaryContentHash,rich?manifest.projectionContentHash:manifest.summaryContentHash,'Captured economic hash binding');
  assert.deepEqual(receipt.artifacts.map(file=>file.fileName),['summary.json','metrics.csv']);
  const descriptors=receipt.artifacts.map(file=>{
    exactKeys(file,['fileName','mediaType','content','contentHash','byteLength'],'Artifact fields');
    assert.equal(file.mediaType,file.fileName==='summary.json'?'application/json':'text/csv');
    assert.ok(file.byteLength>0&&file.byteLength<=1048576);assert.equal(Buffer.byteLength(file.content),file.byteLength);
    assert.equal('sha256:'+sha256(file.content),file.contentHash,'Actual artifact bytes hash');
    const {content,...descriptor}=file;return descriptor;
  });
  assert.deepEqual(descriptors,artifactManifest.artifacts);assert.equal(recordHash(descriptors),artifactManifest.artifactSetHash,'Artifact-set binding');
  const view=JSON.parse(receipt.artifacts[0].content);assert.equal(view.kind,rich?'finance_reporting_export_proposal':'finance_export_proposal');
  assert.equal(view.evidenceMode,'mocked');assert.equal(view.environment,'test');assert.ok(['live','simulated'].includes(view.billingMode)); // Requested labels are not billing proof.
  const provenance=view.provenance;
  for(const key of ['snapshotId','queryContentHash'])assert.equal(provenance[key],manifest[key]);
  assert.equal(provenance[rich?'projectionContentHash':'summaryContentHash'],query.summaryContentHash);
  assert.equal(provenance.snapshotEnvelopeHash,artifactManifest.snapshotEnvelopeHash,'Envelope binding');
  const registry=files['source/fixtures/reporting/definition-registry.json'];
  for(const entry of [...Object.values(registry.metrics),registry.policy])assert.equal(recordHash(entry.definition),entry.reference.content_hash);
  assert.equal(view.accounting.definitionsStatus,'pending_owner_review');
  const metrics=rich?view.currencies.flatMap(currency=>[...currency.metrics,...currency.simulated]):view.metrics;
  if(rich) {
    assert.equal(recordHash(registry),manifest.definitionRegistryHash);assert.equal(view.accounting.definitionRegistryHash,manifest.definitionRegistryHash);
    assert.deepEqual(view.accounting.policyReference,{id:registry.policy.reference.id,revision:registry.policy.reference.revision,contentHash:registry.policy.reference.content_hash});
    assert.deepEqual(view.unavailableMetrics,[{knownSubtotal:null,metric:'cash_net',status:'not_supplied_by_query',total:null}]);
    for(const currency of view.currencies){assert.equal(currency.scale,18);assert.equal(currency.metrics.length,7);assert.equal(currency.simulated.length,4);}
  }
  for(const metric of metrics) {
    const reference=registry.metrics[metric.metric].reference;
    assert.ok(['known','partial','unknown'].includes(metric.status));
    if(rich) {
      assert.deepEqual(metric.definitionReference,{id:reference.id,revision:reference.revision,contentHash:reference.content_hash},'Independent exported metric reference');
      for(const value of [metric.knownSubtotal,metric.total])if(value!==null)decimal(value);
      if(metric.status!=='known')assert.equal(metric.total,null,'Partial/unknown totals remain null');
      if(metric.status==='unknown')assert.equal(metric.knownSubtotal,null);
      assert.ok(Number.isSafeInteger(metric.unknownCount)&&metric.unknownCount>=0);
    }else {
      assert.deepEqual(metric.producerDefinition,{contentHash:reference.content_hash,revision:reference.revision,schemaVersion:'1.0.0'});
      if(metric.status==='known')decimal(metric.amount);else assert.equal(metric.amount,null);
      assert.equal(metric.definitionStatus,'pending_owner_review');
    }
  }
  const csv=parseExportCsv(receipt.artifacts[1].content);assert.equal(csv.length,manifest.itemCount);
  const expected=rich?view.currencies.flatMap(currency=>[...currency.metrics,...currency.simulated].map(metric=>({currency:currency.currency,...metric}))):metrics;
  for(const [index,row]of csv.entries()) {
    const metric=expected[index];assert.equal(row.metric,metric.metric);assert.equal(row.currency,metric.currency);assert.equal(row.status,metric.status);
    assert.equal(row.query_content_hash,query.queryContentHash);assert.equal(row[rich?'projection_content_hash':'summary_content_hash'],query.summaryContentHash);
    assert.equal(row.environment,view.environment);assert.equal(row.billing_mode,view.billingMode);
    if(rich){assert.equal(row.recognition,metric.recognition);for(const [column,value]of [['known_subtotal',metric.knownSubtotal],['total',metric.total]])
      if(value===null)assert.equal(row[column],'','CSV unknown/partial blank');else assert.equal(decimal(row[column]),decimal(value));}
    else if(metric.amount===null)assert.equal(row.amount,'');else assert.equal(decimal(row.amount),decimal(metric.amount));
  }
  return {version:rich?'2.0.0':'1.0.0',artifactHashes:descriptors.map(file=>file.contentHash),delivery:'manual_prepared'};
}

export function validateOwnerFenceEvidence(loaded) {
  const {pin,files,raw}=loaded;const handoff=files['export-producer-handoff.json'];const report=files['candidate-verification.json'];
  assert.equal(handoff.originalHead,pin.producer);assert.equal(handoff.tree,pin.producerTree);assert.equal(handoff.candidateRun,pin.candidateRun);
  assert.equal(handoff.actualMerge,pin.actualProducerMerge);assert.equal(handoff.mainRun,pin.actualMainRun);assert.notEqual(handoff.mainRun,handoff.candidateRun);
  assert.equal(handoff.fence.permissions[0].permission,'finance.summary.read');assert.equal(handoff.fence.permissions[1].permission,'finance.summary.export');
  assert.match(handoff.fence.missing,/SOURCE_UNAVAILABLE/u);assert.match(handoff.fence.validateCurrent,/SYNCHRONOUS/u);
  assert.equal(report.head,pin.producer);assert.equal(report.tree,pin.producerTree);
  const run=report.runs.find(row=>row.run===pin.candidateRun);assert.ok(run);assert.equal(run.actualCheckout,pin.candidateCheckout);assert.equal(run.actualTree,pin.producerTree);assert.equal(run.status,'success');
  assert.deepEqual(run.counts,{pg:{registered:10,passed:10,failed:0,skipped:0},public:{registered:195,passed:195,failed:0,skipped:0}});
  const source='source/'+report.assertionSource.path;assert.equal(sha256(raw[source]),report.assertionSource.sha256);
  const tests=raw[source].toString();assert.match(tests,/F3: real stored receipt verification/u);assert.match(tests,/result\.error\.code, 'FORBIDDEN_SCOPE'/u);
  const fence=raw['source/tests/exports/disclosure-fence.test.mjs'].toString();assert.match(fence,/historical three-argument composition fails missing capability/u);assert.match(fence,/'SOURCE_UNAVAILABLE'/u);
  assert.match(run.assertionLimit,/not a separate machine receipt/u);
  return {qualification:'OWNER_SOURCE_QUALIFIED_AGGREGATE_RECORD_ONLY',missingFourthCapabilityCode:'SOURCE_UNAVAILABLE',lateRevocationCode:'FORBIDDEN_SCOPE',perLoopRefusalEnvelopes:0,ieFenceOrCurrentAccessExecuted:false};
}

export function validateStructuralExportError(result,expectedCode) {
  exactKeys(result,['ok','error'],'Refusal cannot disclose value or artifact bytes');assert.equal(result.ok,false);
  exactKeys(result.error,['schemaVersion','module','operation','code','retryable','safe_message','diagnostic_ref'],'Typed export error fields');
  assert.equal(result.error.schemaVersion,'1.0.0');assert.equal(result.error.module,'integrations');assert.equal(result.error.operation,'exportSummary');
  assert.ok(['SOURCE_UNAVAILABLE','FORBIDDEN_SCOPE','IDEMPOTENCY_CONFLICT','VALIDATION_ERROR','UNSUPPORTED_VERSION'].includes(result.error.code));
  assert.equal(result.error.code,expectedCode);assert.equal(typeof result.error.retryable,'boolean');assert.ok(result.error.safe_message.length>0);assert.match(result.error.diagnostic_ref,/^ci1:/u);
}

export function evaluateExportCandidate(loaded) {
  const {pin,files,raw}=loaded;const handoff=files['export-producer-handoff.json'];const composition=files['candidate-postgres-composition.json'];
  assert.equal(composition.producer,'22a3237dd44f376017969ac881586ff396f19cf8','Original22 payload lineage stays unchanged');
  assert.deepEqual(composition.failures,[]);assert.equal(composition.receipts.length,17);assert.equal(composition.actualProviderCharges,'not_tested');
  const observations=composition.receipts.map((entry,index)=>{
    const prefix=`candidate-artifacts/receipt-${String(index).padStart(2,'0')}/`;
    assert.deepEqual(files[prefix+'response.json'],{ok:true,value:entry.receipt});
    const observed=validateCapturedExport(entry.receipt,entry.query,loaded);
    for(const artifact of entry.receipt.artifacts) {
      assert.equal(raw[prefix+artifact.fileName].toString('utf8'),artifact.content);
      const binding=handoff.candidateReceipts.artifactBytes.find(row=>row.receiptIndex===index&&row.path.endsWith('/'+artifact.fileName));
      assert.ok(binding);assert.equal(binding.contentHash,artifact.contentHash);assert.equal(binding.byteLength,artifact.byteLength);assert.deepEqual(binding.snapshotBinding,entry.query);
    }
    return observed;
  });
  assert.equal(handoff.candidateReceipts.count,17);assert.equal(handoff.candidateReceipts.artifactBytes.length,34);
  const structural=validateStructuralExportRequest(files['source/fixtures/reporting/prepared-export-request.json'],loaded);
  return {capturedResponses:17,capturedArtifactBytes:34,observations,structuralRequest:structural,fenceEvidence:validateOwnerFenceEvidence(loaded),producerPayloadLineage:composition.producer,
    authority:'NOT_EXECUTED_BY_IE; no grants/HMAC/current authority/producer API/PG/CFO delivery/billing/adoption/full-run acceptance'};
}

export async function runExportCandidate(outputArg) {
  assert.ok(outputArg,'Usage: run.mjs --candidate-export0c4-fixtures OUTPUT');const output=resolve(outputArg);await mkdir(output,{recursive:false});
  const receipt={kind:'synthetic-captured-export-fixture-consumer',status:'failed',node:process.version,producerExecuted:false,postgresExecuted:false,currentAuthorityExecuted:false,hmacVerified:false,cfoDeliveryExecuted:false,providerCalls:0,adoptionAccepted:false,ownerAcknowledgement:null,productAcceptance:'blocked'};
  try {
    const loaded=await loadExportFixtures();assert.equal(process.version,`v${loaded.pin.node}`);await recordEvaluator(here,output);
    const git=spawnSync('git',['-C',here,'show','-s','--format=%H%n%T','HEAD'],{encoding:'utf8',timeout:30000});assert.equal(git.status,0);const [revision,tree]=git.stdout.trim().split('\n');
    receipt.consumer={revision,tree};receipt.provenance=loaded.pin;receipt.observation=evaluateExportCandidate(loaded);receipt.consumerAcknowledgement='SCOPED_SYNTHETIC_EXPORT_CAPTURE_PROJECTION_ONLY';
    const {loadDenialSupplement,evaluateDenialSupplement}=await import('./export-denial-supplement.mjs');
    const supplement=await loadDenialSupplement();receipt.denialSupplement={provenance:supplement.pin,observation:evaluateDenialSupplement(supplement,loaded)};
    receipt.status='passed';
  }catch(error){receipt.failure=error.message;process.exitCode=1;}
  await writeFile(join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');await writeFile(join(output,'artifacts.json'),JSON.stringify(await fileManifest(output),null,2)+'\n');
  console.log(`Captured Finance export consumer ${receipt.status}; receipt: ${join(output,'receipt.json')}`);
}
