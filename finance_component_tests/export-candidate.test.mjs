import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,cp,writeFile,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadExportFixtures,evaluateExportCandidate,validateCapturedExport,validateStructuralExportRequest,validateOwnerFenceEvidence,validateStructuralExportError,exportFixtureRoot } from './export-candidate.mjs';
import { recordHash } from './candidate924.mjs';

const loaded=await loadExportFixtures();
const captures=loaded.files['candidate-postgres-composition.json'].receipts;
function responseMutation(name,index,change,expected) {
  test(name,()=>{const record=structuredClone(captures[index]);change(record);assert.throws(()=>validateCapturedExport(record.receipt,record.query,loaded),expected);});
}
function rewriteView(record,change) {
  const artifact=record.receipt.artifacts[0];const view=JSON.parse(artifact.content);change(view);artifact.content=JSON.stringify(view);
  artifact.byteLength=Buffer.byteLength(artifact.content);artifact.contentHash=recordHash(view);
  const manifest=record.receipt.artifactManifest??record.receipt.manifest;
  manifest.artifacts=record.receipt.artifacts.map(({content,...descriptor})=>descriptor);manifest.artifactSetHash=recordHash(manifest.artifacts);
}
test('exact accepted packet validates 17 captures and 34 byte artifacts with original22 labels and structural-only request',()=>{
  const result=evaluateExportCandidate(loaded);assert.equal(result.capturedResponses,17);assert.equal(result.capturedArtifactBytes,34);
  assert.equal(result.structuralRequest.qualification,'STRUCTURAL_ONLY_NOT_CAPTURED_PG_REQUEST');assert.equal(result.fenceEvidence.perLoopRefusalEnvelopes,0);
  assert.equal(result.producerPayloadLineage,'22a3237dd44f376017969ac881586ff396f19cf8');
});
responseMutation('changed artifact content fails independent byte hashing',0,r=>{r.receipt.artifacts[0].content+=' ';},/strictly equal/u);
responseMutation('wrong captured query hash is rejected',0,r=>{r.query.queryContentHash='sha256:'+'a'.repeat(64);},/Captured query binding/u);
responseMutation('legacy opaque snapshot association follows exact hash-pinned producer projection',1,r=>{r.query.snapshotId='sha256:'+'a'.repeat(64);},/Captured snapshot\/query binding/u);
responseMutation('artifact-set binding refuses reordering',0,r=>{r.receipt.manifest.artifacts.reverse();});
responseMutation('CFO delivery reference cannot be synthesized',0,r=>{r.receipt.manifest.deliveryReference='delivered';});
responseMutation('unnegotiated extra response fields are refused',0,r=>{r.receipt.permissionGranted=true;},/unexpected property/u);
responseMutation('legacy compatibility cannot imply canonical adoption',1,r=>{r.receipt.artifactManifest.compatibility.adoption='accepted';});
responseMutation('pending consumer acknowledgement cannot become owner acceptance',0,r=>{r.receipt.manifest.consumerAcknowledgement='accepted';});
responseMutation('rehashed JSON projection cannot replace independent metric references',0,r=>rewriteView(r,v=>{v.currencies[0].metrics[0].definitionReference.id='foreign';}),/Independent exported metric reference/u);
responseMutation('rehashed partial totals cannot become complete zero',0,r=>rewriteView(r,v=>{v.currencies[0].metrics[0].total='0';}),/Partial\/unknown totals/u);
responseMutation('rehashed unknown subtotal cannot become zero',0,r=>rewriteView(r,v=>{v.currencies[0].metrics[1].knownSubtotal='0';}));
responseMutation('rehashed cash_net cannot claim unavailable money',0,r=>rewriteView(r,v=>{v.unavailableMetrics[0].total='0';}));
responseMutation('rehashed envelope hash cannot move source association',0,r=>rewriteView(r,v=>{v.provenance.snapshotEnvelopeHash='sha256:'+'a'.repeat(64);}),/Envelope binding/u);
responseMutation('CSV unknown money cannot be filled with zero even if content hashes are updated',0,r=>{
  const csv=r.receipt.artifacts[1];csv.content=csv.content.replace('unknown,,,0','unknown,,0,0');csv.byteLength=Buffer.byteLength(csv.content);csv.contentHash='sha256:'+byteHash(csv.content);
  r.receipt.manifest.artifacts=r.receipt.artifacts.map(({content,...descriptor})=>descriptor);r.receipt.manifest.artifactSetHash=recordHash(r.receipt.manifest.artifacts);
},/CSV unknown\/partial blank/u);
// Hash bytes independently of parsed financial values; this helper does not execute producer code.
function byteHash(value){return createHash('sha256').update(value).digest('hex');}
test('structural request scope is compared with nested canonical scope without claiming current access',()=>{
  const request=structuredClone(loaded.files['source/fixtures/reporting/prepared-export-request.json']);request.scope.projectId='33333333-3333-4333-8333-333333333333';
  assert.throws(()=>validateStructuralExportRequest(request,loaded));
});
test('structural request cannot bypass nested canonical completeness and definition checks',()=>{
  const request=structuredClone(loaded.files['source/fixtures/reporting/prepared-export-request.json']);request.summarySnapshot.summary.metrics={};request.summarySnapshot.summaryContentHash=recordHash(request.summarySnapshot.summary);request.summaryContentHash=request.summarySnapshot.summaryContentHash;
  assert.throws(()=>validateStructuralExportRequest(request,loaded));
});
test('rich structural request combines pinned wrapper and canonical validation without claiming a captured PG request',()=>{
  const page=structuredClone(loaded.canonical['pagination.json'].pages[0].response);
  const request={...structuredClone(loaded.files['source/fixtures/reporting/prepared-export-request.json']),schemaVersion:'2.0.0',summarySnapshot:page,summaryContentHash:page.summaryContentHash};
  assert.equal(validateStructuralExportRequest(request,loaded).qualification,'STRUCTURAL_ONLY_NOT_CAPTURED_PG_REQUEST');
  request.summarySnapshot.canonicalSummaries=[];assert.throws(()=>validateStructuralExportRequest(request,loaded));
});
for(const [label,change]of [
  ['fourth capability refusal code changed',f=>{f['export-producer-handoff.json'].fence.missing='FORBIDDEN_SCOPE';}],
  ['read/export permissions aliased to host actions',f=>{f['export-producer-handoff.json'].fence.permissions[0].permission='finance.read';}],
  ['async current validator misrepresented as coherent fence',f=>{f['export-producer-handoff.json'].fence.validateCurrent='ASYNC';}],
  ['failed owner capture claimed as successful',f=>{f['candidate-verification.json'].runs.find(r=>r.run===38254570860).counts.pg.failed=1;}],
  ['candidate checkout relabelled as actual main',f=>{f['candidate-verification.json'].runs.find(r=>r.run===38254570860).actualCheckout=f['export-producer-handoff.json'].actualMerge;}],
  ['per-loop capture limit erased',f=>{f['candidate-verification.json'].runs.find(r=>r.run===38254570860).assertionLimit='Separate denial envelope proved';}],
])test(label,()=>{const changed={...loaded,files:structuredClone(loaded.files)};change(changed.files);assert.throws(()=>validateOwnerFenceEvidence(changed));});
test('structural error controls reject leaked bytes and wrong routing; no captured denial is invented',()=>{
  const structural={ok:false,error:{schemaVersion:'1.0.0',module:'integrations',operation:'exportSummary',code:'SOURCE_UNAVAILABLE',retryable:true,safe_message:'Synthetic structural control only',diagnostic_ref:'ci1:structural-control'}};
  validateStructuralExportError(structural,'SOURCE_UNAVAILABLE');assert.throws(()=>validateStructuralExportError({...structural,value:{artifacts:[]}},'SOURCE_UNAVAILABLE'));
  assert.throws(()=>validateStructuralExportError(structural,'FORBIDDEN_SCOPE'));
});
test('changed source or artifact bytes fail full76-file admission and extra files are rejected',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ie-export-packet-'));try{
    await cp(exportFixtureRoot,directory,{recursive:true});const name=join(directory,'candidate-artifacts/receipt-00/metrics.csv');await writeFile(name,(await readFile(name))+' ');
    await assert.rejects(loadExportFixtures(directory),/Pinned export fixture mismatch/u);await cp(join(exportFixtureRoot,'candidate-artifacts/receipt-00/metrics.csv'),name);
    await writeFile(join(directory,'extra.json'),'{}');await assert.rejects(loadExportFixtures(directory),/Exact export packet file set/u);
  }finally{await rm(directory,{recursive:true,force:true});}
});
