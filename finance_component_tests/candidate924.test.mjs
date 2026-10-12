import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, cp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCandidateFixtures, evaluateCandidate924, fixtureRoot, recordHash } from './candidate924.mjs';
import { validateFixtureSchema } from './fixture-schema.mjs';

const original=await loadCandidateFixtures();
function rehash(loaded) {
  for(const entry of loaded.files['pagination.json'].pages) {
    entry.requestRecordHash=recordHash(entry.request);entry.responseRecordHash=recordHash(entry.response);
  }
  for(const row of loaded.files['refusals.json'].observations) {
    row.requestRecordHash=recordHash(row.request);row.resultRecordHash=recordHash(row.result);
  }
}
function mutate(name,mutation,reason) {
  test(name,()=>{const loaded=structuredClone(original);mutation(loaded.files);rehash(loaded);
    assert.throws(()=>evaluateCandidate924(loaded),reason);});
}
test('accepted924 exact captures pass combined consumer assertions with distinct historical22 unknown provenance',()=>{
  const result=evaluateCandidate924(original);
  assert.equal(result.pages,3);assert.equal(result.uniqueDetails,6);assert.equal(result.refusals,9);
  assert.deepEqual(result.historicalUnknownControl,{source:'22a3237dd44f376017969ac881586ff396f19cf8',status:'partial',knownSubtotal:'5',total:null,unknownCount:1});
});
mutate('rehashed opaque continuation alteration is refused',files=>{files['pagination.json'].pages[1].request.cursor+='A';},/Opaque continuation/u);
mutate('rehashed page-size drift is refused',files=>{files['pagination.json'].pages[1].request.pageSize=3;},/Normalized query hash/u);
mutate('rehashed actor drift is bound into query identity',files=>{files['pagination.json'].pages[1].request.scope.actorId='foreign';},/Normalized query hash/u);
mutate('rehashed normalized filter drift is refused',files=>{files['pagination.json'].pages[1].request.filters.providers=['foreign'];},/Normalized query hash/u);
mutate('rehashed watermark changes cannot silently move frozen snapshot',files=>{files['pagination.json'].pages[1].response.watermark.sources[0].revision='changed';},/Frozen page field: watermark/u);
mutate('rehashed duplicate details are refused',files=>{files['pagination.json'].pages[1].response.details[0]=files['pagination.json'].pages[0].response.details[0];},/No duplicate detail IDs/u);
mutate('terminal page cannot advertise another continuation',files=>{files['pagination.json'].pages[2].response.nextCursor='another';},/Terminal page/u);
mutate('canonical summary holes bypass outer schema but fail trusted canonical schema',files=>{files['pagination.json'].pages[0].response.canonicalSummaries[0].metrics={};},/\$\/metrics/u);
mutate('empty canonical summaries cannot omit combined validation',files=>{files['pagination.json'].pages[0].response.canonicalSummaries=[];},/Canonical currency coverage/u);
mutate('canonical definition identity is checked against independent registry',files=>{files['pagination.json'].pages[0].response.canonicalSummaries[0].metrics.expense.definition_ref.id='123e4567-e89b-42d3-a456-426614174000';},/Independent metric reference/u);
mutate('canonical complete claim with unknown coverage is refused',files=>{files['pagination.json'].pages[0].response.canonicalSummaries[0].completeness='complete';},/Unknown coverage/u);
mutate('synthetic payload source cannot be relabelled as actual924 producer source',files=>{files['pagination.json'].pages[0].response.canonicalSummaries[0].producer.source_revision='924cdd2b5489681434790b5d1d7aac138198ccfd';},/Synthetic source placeholder/u);
mutate('floating money is rejected by trusted outer schema',files=>{files['pagination.json'].pages[0].response.details[0].amount=2;},/\$\/details\/0\/amount/u);
mutate('unknown enum values are rejected by trusted outer schema',files=>{files['pagination.json'].pages[0].response.details[0].valuation='invented';},/\$\/details\/0\/valuation/u);
mutate('extra fields are rejected by trusted outer schema',files=>{files['pagination.json'].pages[0].response.providerBillingAccepted=true;},/unexpected property/u);
mutate('invalid canonical IDs are rejected by pinned reference closure',files=>{files['pagination.json'].pages[0].response.canonicalSummaries[0].event_id='invalid-id';},/\$\/event_id/u);
mutate('summary bytes require independent recomputed content hash',files=>{files['pagination.json'].pages[0].response.summary.currencies[0].metrics.expense.knownSubtotal='999';},/Summary content hash/u);
mutate('unknown historical amount cannot be filled with zero',files=>{files['historical22-unknown-simulated.json'].details.find(row=>row.amount===null).amount='0';},/Historical unknown amount remains null/u);
mutate('historical partial5 total cannot be promoted to complete known zero',files=>{
  const page=files['historical22-unknown-simulated.json'];page.summary.currencies[0].simulated.expense.total='0';page.summaryContentHash=recordHash(page.summary);
},/Historical22 unknown simulated expense oracle/u);
mutate('changed refusal error routing is rejected independently of record hashes',files=>{files['refusals.json'].observations[0].result.error.code='FORBIDDEN_SCOPE';},/Expected refusal routing/u);
mutate('a captured refusal cannot become a fabricated success',files=>{files['refusals.json'].observations[0].result={ok:true,value:{}};},/Refusal cannot be success/u);
mutate('missing refusal coverage is rejected',files=>{files['refusals.json'].observations.pop();},/Exact nine refusal cases/u);
test('schema vocabulary and external refs fail closed without network access',()=>{
  assert.throws(()=>validateFixtureSchema({type:'string',not:{const:'bad'}},'ok'),/Unsupported schema keyword/u);
  assert.throws(()=>validateFixtureSchema({type:'string',$defs:{unused:{not:{const:'bad'}}}},'ok'),/Unsupported schema keyword/u);
  assert.throws(()=>validateFixtureSchema({$ref:'https://untrusted.invalid/schema'},{}),/Unpinned schema reference/u);
  assert.throws(()=>validateFixtureSchema({oneOf:[{type:'integer'},{type:'number'}]},1));
  assert.throws(()=>validateFixtureSchema({type:'string',format:'utc-time'},'2026-02-31T00:00:00Z'));
  assert.throws(()=>validateFixtureSchema({type:'string',format:'utc-time'},'2026-02-01T00:00:00+00:00'));
  assert.throws(()=>validateFixtureSchema({type:'array',uniqueItems:true},[{a:1,b:2},{b:2,a:1}]));
});
test('changed, extra and missing fixture bytes fail admission before evaluation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ie-finance924-fixture-'));
  try {
    await cp(fixtureRoot,root,{recursive:true});
    await writeFile(join(root,'pagination.json'),(await readFile(join(root,'pagination.json')))+' ');
    await assert.rejects(loadCandidateFixtures(root),/Pinned fixture mismatch: pagination/u);
    await cp(join(fixtureRoot,'pagination.json'),join(root,'pagination.json'));
    await writeFile(join(root,'extra.json'),'{}');await assert.rejects(loadCandidateFixtures(root),/Exact fixture file set/u);
    await rm(join(root,'extra.json'));await rm(join(root,'page-schema.json'));await assert.rejects(loadCandidateFixtures(root),/Exact fixture file set/u);
  }finally{await rm(root,{recursive:true,force:true});}
});
