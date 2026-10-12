import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, fileManifest } from './custody.mjs';
import { recordHash } from './candidate924.mjs';
import { validateFixtureSchema } from './fixture-schema.mjs';
import { validateCapturedExport, validateStructuralExportError } from './export-candidate.mjs';

const here=dirname(fileURLToPath(import.meta.url));
export const denialFixtureRoot=join(here,'fixtures/export3e8');
const keys=(value,names)=>assert.deepEqual(Object.keys(value).sort(),[...names].sort());
const counterNames=['sourceQueries','authorityCalls','fenceValidations','stateTransitions'];
export async function loadDenialSupplement(directory=denialFixtureRoot) {
  const pin=JSON.parse(await readFile(join(here,'../contracts/finance-export3e8-supplement-pin.json')));
  assert.equal(pin.mode,'synthetic-captured-export-denial-supplement');
  assert.deepEqual((await fileManifest(directory)).map(x=>x.path).sort(),Object.keys(pin.files).sort());
  const files={},raw={};
  for(const [name,digest]of Object.entries(pin.files)) {
    const b=await readFile(join(directory,name));assert.ok(b.length<=2*1024*1024);assert.equal(sha256(b),digest,`Pinned supplement mismatch: ${name}`);
    raw[name]=b;if(name.endsWith('.json'))files[name]=JSON.parse(b);
  }
  return {pin,files,raw};
}

export function expectedAuthorizationCases() {
  const cases=new Map();
  for(const version of ['1.0.0','2.0.0'])for(const mode of ['create','retrieve']) {
    const prefix=`${version}.${mode}`,path=mode==='create'?'exportSummaryV2':'getPreparedExportArtifacts';
    const add=(id,kind,code,pair=null,actualPath=path)=>cases.set(id,{version,mode,path:actualPath,kind,code,pair});
    for(const [family,subjects]of [['F1',['denyRead','denyExport']],['F2',['null','foreign']],['F3',['finance.summary.read','finance.summary.export']]])for(const subject of subjects) {
      const id=`${prefix}.${family}.${subject}`;add(id,family,'FORBIDDEN_SCOPE');
      add(id+(family==='F3'?'.unchanged-retrieve':'.restored-retrieve'),family+'positive',null,id,'getPreparedExportArtifacts');
    }
    add(prefix+'.missing-fourth-fence','missing','SOURCE_UNAVAILABLE');add(prefix+'.unchanged-fourth-fence','positive',null);
    for(const field of ['tenantId','projectId','actorId','environment','billingMode','principal','contextRevision','readRevision','exportRevision'])add(prefix+'.current-host.'+field,'current','FORBIDDEN_SCOPE');
  }
  return cases;
}

// Inspect public capture DTOs and JSON documents; this does not authenticate a live host or store.
function noPrivatePayload(value) {
  assert.ok(Buffer.byteLength(JSON.stringify(value))<=2*1024*1024);
  function visit(x,depth=0) {
    assert.ok(depth<=48,'Bounded public projection');
    if(!x||typeof x!=='object')return;
    for(const [name,v]of Object.entries(x)) {
      assert.ok(!/^(?:tenant_?id|project_?id|actor_?id|credential|credentials|token|receiptKey|privateStore|storeDirectory|authorityState)$/iu.test(name),'Private field in public projection');
      visit(v,depth+1);
    }
  }
  visit(value);
  assert.doesNotMatch(JSON.stringify(value),/Bearer |BEGIN (?:RSA |EC )?PRIVATE KEY|fixture-transport-canary|fixture-authority-canary/u);
}

export function evaluateDenialSupplement(supplement,original) {
  const {pin,files,raw}=supplement, handoff=files['accepted-handoff.json'],capture=files['postgres-composition.json'];
  assert.equal(handoff.status,'FINANCE_OWNER_ACCEPTED_SYNTHETIC_DENIAL_CAPTURE_SUPPLEMENT_ONLY');
  for(const [key,target]of [['producerHead','producer'],['tree','producerTree'],['candidateCheckout','candidateCheckout'],['candidateRun','candidateRun'],['actualMerge','actualProducerMerge'],['mainRun','actualMainRun']])assert.equal(handoff[key],pin[target]);
  assert.equal(handoff.originalPacketSha256Unchanged,pin.originalHandoffSha256);assert.equal(pin.originalHandoffSha256,original.pin.files['export-producer-handoff.json']);
  assert.equal(handoff.capturedFileSha256,sha256(raw['postgres-composition.json']));assert.equal(handoff.reviewSha256,sha256(raw['owner-review.md']));
  assert.equal(handoff.actualCases,92);assert.deepEqual(handoff.typedDenials,{FORBIDDEN_SCOPE:60,SOURCE_UNAVAILABLE:4});assert.equal(handoff.positiveControls,28);
  const boundary=files['source-boundary.json'];assert.equal(boundary.original,original.pin.producer);assert.equal(boundary.candidate,pin.producer);assert.equal(boundary.candidateTree,pin.producerTree);
  assert.equal(boundary.files.length,226);assert.equal(new Set(boundary.files.map(x=>x.path)).size,226);
  assert.deepEqual(boundary.changedPaths,['tests/exports/query-export-pg.test.mjs']);
  assert.deepEqual(boundary.files.filter(x=>x.originalBlob!==x.candidateBlob).map(x=>x.path),boundary.changedPaths);
  const run=files['hosted-run.json'],checkout=files['hosted-checkout-commit.json'];
  assert.equal(run.id,pin.candidateRun);assert.equal(run.head_sha,pin.producer);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  assert.equal(checkout.sha,pin.candidateCheckout);assert.equal(checkout.tree.sha,pin.producerTree);
  assert.deepEqual(checkout.parents.map(x=>x.sha),[original.pin.actualProducerMerge,pin.producer]);assert.notEqual(pin.candidateRun,pin.actualMainRun);
  assert.equal(files['hosted-artifacts.json'].artifacts[0].id,handoff.artifactId);
  assert.equal(capture.producer,'22a3237dd44f376017969ac881586ff396f19cf8');assert.deepEqual(capture.failures,[]);
  assert.equal(capture.actualProviderCharges,'not_tested');assert.equal(capture.consumerAcknowledgement,'pending');
  assert.equal(capture.authorizationCaptureVersion,'1.0.0');assert.equal(capture.executionProvenance.reportedCheckoutCommit,null);
  assert.equal(capture.executionProvenance.authorityMode,'synthetic_single_state_host_NOT_live_issuer');assert.equal(capture.executionProvenance.producerLabel,'reporting_lineage_only_NOT_export_execution_revision');
  assert.equal(capture.executionProvenance.testSourceHash,'sha256:'+sha256(raw['query-export-pg.test.mjs']));
  assert.match(raw['query-export-pg.test.mjs'].toString(),/actualResult: structuredClone\(result\)/u,'Direct producer response capture source');
  const matrix=expectedAuthorizationCases(),cases=new Map(capture.authorizationCases.map(x=>[x.caseId,x]));
  assert.equal(capture.authorizationCases.length,92);assert.equal(cases.size,92);assert.deepEqual([...cases.keys()].sort(),[...matrix.keys()].sort(),'Exact authorization case matrix');
  const counts={FORBIDDEN_SCOPE:0,SOURCE_UNAVAILABLE:0,positive:0};let positiveArtifactFiles=0;
  for(const [id,row]of cases) {
    keys(row,['caseId','version','path','fixtureMode','sourceBinding','expectedCode','actualResult','reached','counters']);
    const expected=matrix.get(id);assert.equal(row.version,expected.version);assert.equal(row.path,expected.path);assert.equal(row.expectedCode,expected.code);
    assert.equal(row.fixtureMode,'synthetic_coherent_authority_with_actual_postgresql');
    keys(row.sourceBinding,['scopeHash','snapshotReferenceHash','queryContentHash','summaryContentHash']);for(const hash of Object.values(row.sourceBinding))assert.match(hash,/^sha256:[a-f0-9]{64}$/u);
    keys(row.counters,['before','after']);const delta={};
    for(const side of ['before','after']){keys(row.counters[side],counterNames);for(const n of counterNames)assert.ok(Number.isSafeInteger(row.counters[side][n])&&row.counters[side][n]>=0);}
    for(const n of counterNames){delta[n]=row.counters.after[n]-row.counters.before[n];assert.ok(delta[n]>=0);}
    if(expected.kind==='missing') {
      assert.deepEqual(delta,Object.fromEntries(counterNames.map(n=>[n,0])),'Missing capability has zero protected activity');
      assert.deepEqual(row.reached,{capabilityAbsent:true,originalPrepared:expected.mode==='retrieve',storeLookups:0});
    }else {
      assert.equal(row.reached.originalVerified,true,'Original authentication witness');for(const n of counterNames.slice(0,3))assert.ok(delta[n]>0);
      assert.equal(delta.stateTransitions,expected.code?1:0,'In-call state transition');
      const witnesses={F1:'revocationTriggered',F2:'contextTransitionTriggered',current:'authorityTransition',F1positive:'authorityRestored',F2positive:'contextRestored',F3positive:'authorityRestored'};
      if(witnesses[expected.kind])assert.equal(row.reached[witnesses[expected.kind]],true);
      if(['F3','F3positive','positive'].includes(expected.kind))assert.equal(row.reached.governedContextAwait,true);
      const reached=['originalVerified',...(witnesses[expected.kind]?[witnesses[expected.kind]]:[]),...(['F3','F3positive','positive'].includes(expected.kind)?['governedContextAwait']:[])];keys(row.reached,reached);
    }
    const result=row.actualResult;noPrivatePayload(result);
    if(expected.code) {
      counts[expected.code]++;validateStructuralExportError(result,expected.code);validateFixtureSchema(files['ErrorEnvelopeSchema.json'],result.error);
      assert.equal(result.error.retryable,expected.kind==='missing');assert.equal(result.error.safe_message,expected.kind==='missing'?'A coherent current financial disclosure capability is unavailable.':'Current financial disclosure is not authorized.');
      assert.match(result.error.diagnostic_ref,/^ci1:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u);
    }else {
      counts.positive++;keys(result,['ok','value']);assert.equal(result.ok,true);const receipt=result.value,manifest=receipt.manifest;
      const rich=expected.version==='2.0.0';assert.equal(receipt.schemaVersion==='2.0.0',rich);
      assert.equal(manifest.createdAt,'2026-10-12T22:00:00.000Z');
      // Legacy capture hashes an object; its public alias hashes a raw string. No raw preimage is present.
      if(rich)assert.equal(recordHash({snapshotId:manifest.snapshotId}),row.sourceBinding.snapshotReferenceHash,'Rich snapshot reference binding');
      const query={snapshotId:manifest.snapshotId,queryContentHash:row.sourceBinding.queryContentHash,summaryContentHash:row.sourceBinding.summaryContentHash};
      validateCapturedExport(receipt,query,original,{legacySnapshotAliasOnly:!rich});
      for(const artifact of receipt.artifacts)if(artifact.fileName==='summary.json')noPrivatePayload(JSON.parse(artifact.content));
      positiveArtifactFiles+=receipt.artifacts.length;
      if(expected.pair) {
        const prior=cases.get(expected.pair);assert.deepEqual(row.sourceBinding,prior.sourceBinding,'Restored pair source binding');
        assert.equal(row.counters.before.stateTransitions,prior.counters.after.stateTransitions+1);
        for(const n of counterNames.slice(0,3))assert.equal(row.counters.before[n],prior.counters.after[n]);
      }
    }
  }
  assert.deepEqual(counts,{FORBIDDEN_SCOPE:60,SOURCE_UNAVAILABLE:4,positive:28});assert.equal(positiveArtifactFiles,56);
  assert.equal(capture.receipts.length,17);for(const row of capture.receipts)validateCapturedExport(row.receipt,row.query,original);
  return {qualification:'CAPTURED_SYNTHETIC_DENIAL_SUPPLEMENT_ONLY',capturedCases:92,lateDenials:60,entryMissingCapabilityDenials:4,positiveControls:28,positiveArtifactFiles,financialReceipts:17,financialArtifactFiles:34,legacyPositiveSnapshots:'14 aliases: independent raw-preimage comparison unavailable; source/runtime and restored-pair binding qualified',counterMeaning:'SQL calls include transaction/session activity; not distinct economic queries',ieProducerOrCurrentAuthorityExecuted:false};
}
