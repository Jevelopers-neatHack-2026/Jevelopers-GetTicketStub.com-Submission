import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,cp,writeFile,rm,readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadExportFixtures } from './export-candidate.mjs';
import { loadDenialSupplement,evaluateDenialSupplement,denialFixtureRoot } from './export-denial-supplement.mjs';
const original=await loadExportFixtures(),supplement=await loadDenialSupplement();
test('accepted additive capture verifies 60 late denials,4 missing-entry denials,28 positives and17 financial receipts',()=>{
  const x=evaluateDenialSupplement(supplement,original);assert.equal(x.capturedCases,92);assert.equal(x.lateDenials,60);assert.equal(x.entryMissingCapabilityDenials,4);assert.equal(x.positiveArtifactFiles,56);assert.equal(x.financialArtifactFiles,34);assert.equal(x.ieProducerOrCurrentAuthorityExecuted,false);assert.match(x.legacyPositiveSnapshots,/unavailable/u);
});
const row=(files,id)=>files['postgres-composition.json'].authorizationCases.find(x=>x.caseId===id);
const first=files=>row(files,'1.0.0.create.F1.denyRead');
const positive=files=>row(files,'2.0.0.create.F1.denyRead.restored-retrieve');
for(const [name,change]of [
  ['captured denial cannot disclose a success value',f=>{first(f).actualResult.value={artifacts:['private']};}],
  ['typed denial cannot silently change its error code',f=>{first(f).actualResult.error.code='SOURCE_UNAVAILABLE';}],
  ['typed denial must retain retryability',f=>{first(f).actualResult.error.retryable=true;}],
  ['fixed safe error text cannot contain private material',f=>{first(f).actualResult.error.safe_message='Bearer fixture-secret';}],
  ['error schema rejects unknown envelope properties',f=>{first(f).actualResult.error.permissionGranted=true;}],
  ['error diagnostic reference must be a bounded actual identifier',f=>{first(f).actualResult.error.diagnostic_ref='ci1:invented';}],
  ['case coverage rejects duplicates and missing cases',f=>{f['postgres-composition.json'].authorizationCases[1]=structuredClone(first(f));}],
  ['case routing cannot alias create and retrieval',f=>{first(f).path='getPreparedExportArtifacts';}],
  ['missing capability entry cannot be counted as late SQL work',f=>{const x=row(f,'1.0.0.create.missing-fourth-fence');x.counters.after.sourceQueries++;}],
  ['missing capability requires zero protected store lookups',f=>{row(f,'1.0.0.retrieve.missing-fourth-fence').reached.storeLookups=1;}],
  ['late denial requires original verification witness',f=>{first(f).reached.originalVerified=false;}],
  ['late denial requires exactly one in-call transition',f=>{first(f).counters.after.stateTransitions++;}],
  ['F3 captures require governed context await',f=>{row(f,'2.0.0.retrieve.F3.finance.summary.export').reached.governedContextAwait=false;}],
  ['current principal transition requires its authentic witness',f=>{row(f,'2.0.0.retrieve.current-host.principal').reached.authorityTransition=false;}],
  ['positive controls cannot silently cross source bindings',f=>{positive(f).sourceBinding.scopeHash='sha256:'+'a'.repeat(64);}],
  ['positive controls require restoration counter continuity',f=>{positive(f).counters.before.stateTransitions++;positive(f).counters.after.stateTransitions++;}],
  ['rich positive snapshot hash must match the captured reference',f=>{positive(f).sourceBinding.snapshotReferenceHash='sha256:'+'a'.repeat(64);}],
  ['positive artifact bytes are independently hashed',f=>{positive(f).actualResult.value.artifacts[0].content+=' ';}],
  ['success payload cannot disclose private tenant fields',f=>{positive(f).actualResult.value.tenantId='private';}],
  ['test self-source hash cannot substitute execution provenance',f=>{f['postgres-composition.json'].executionProvenance.testSourceHash='sha256:'+'a'.repeat(64);}],
  ['candidate synthetic checkout cannot masquerade as actual main',f=>{f['hosted-checkout-commit.json'].sha=f['accepted-handoff.json'].actualMerge;}],
  ['source boundary cannot hide a production schema change',f=>{f['source-boundary.json'].files.find(x=>x.path.includes('schemas/')).candidateBlob='a'.repeat(40);}],
  ['original22 label cannot become export execution source',f=>{f['postgres-composition.json'].producer=f['accepted-handoff.json'].producerHead;}],
])test(name,()=>{const changed={...supplement,files:structuredClone(supplement.files)};change(changed.files);assert.throws(()=>evaluateDenialSupplement(changed,original));});
test('supplement admission rejects modified bytes before interpreting cases',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'export-denial-admission-'));
  try {await cp(denialFixtureRoot,directory,{recursive:true});await writeFile(join(directory,'postgres-composition.json'),'{}');await assert.rejects(loadDenialSupplement(directory),/Pinned supplement mismatch/u);}finally{await rm(directory,{recursive:true,force:true});}
});
test('actual CLI failed supplement admission emits failed receipt without any consumer ACK',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'export-denial-cli-failure-'));
  try {
    const hook=join(directory,'deny-supplement-read.mjs'),output=join(directory,'output');
    await writeFile(hook,`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';const original=fs.readFile;fs.readFile=async function(path,...args){if(String(path).endsWith('/contracts/finance-export3e8-supplement-pin.json'))throw new Error('TEST_INJECTED_SUPPLEMENT_ADMISSION_FAILURE');return original.call(this,path,...args);};syncBuiltinESMExports();`);
    // Only intercept the additive pin read, after actual clean custody and original packet evaluation.
    const result=spawnSync(process.execPath,['--import',hook,new URL('./run.mjs',import.meta.url).pathname,'--candidate-export0c4-fixtures',output],{env:{PATH:process.env.PATH,TMPDIR:tmpdir()},encoding:'utf8',timeout:30000});
    assert.equal(result.status,1,result.stderr);const receipt=JSON.parse(await readFile(join(output,'receipt.json')));
    assert.equal(receipt.status,'failed');assert.equal(receipt.failure,'TEST_INJECTED_SUPPLEMENT_ADMISSION_FAILURE');
    assert.equal(receipt.observation.capturedResponses,17);assert.equal(Object.hasOwn(receipt,'denialSupplement'),false);
    assert.equal(Object.hasOwn(receipt,'consumerAcknowledgement'),false);assert.equal(receipt.ownerAcknowledgement,null);assert.equal(receipt.adoptionAccepted,false);
  }finally{await rm(directory,{recursive:true,force:true});}
});
