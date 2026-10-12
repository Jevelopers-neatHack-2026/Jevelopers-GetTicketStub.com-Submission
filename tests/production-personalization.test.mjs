import test from 'node:test';
import assert from 'node:assert/strict';
import { calibration,clone,readProduction,batchContext,partialBatch } from './production-seeds.mjs';
import { checkPersonalizationPlan,checkRowResult,checkBatchResult,checkBatchPages,checkCsvInput,productionContentHash } from '../tooling/production-operations.mjs';
import { hashManifest } from '../tooling/runtime.mjs';
const request=await readProduction('PersonalizeBatchRequest');
const planContext=()=>({scope:calibration.scope,policy:clone(calibration.personalization),template:clone(calibration.template)});
test('equal values under distinct IDs remain separate original rows',()=>{
  const result=checkPersonalizationPlan(request,planContext());assert.equal(result.ok,true);assert.equal(result.value.rows.length,2);assert.notEqual(result.value.rows[0].input_hash,result.value.rows[1].input_hash);assert.equal(result.value.rows[0].fields.name,'0001');assert.equal(result.value.rows[0].fields.detail,'A\u0301da');
});
for(const [name,mutate] of [['duplicate ID',r=>r.input.rows[1].row_id=r.input.rows[0].row_id],['empty required',r=>r.input.rows[0].fields.name=''],['readonly fact',r=>r.input.rows[0].fields.title='override'],['extra field',r=>r.input.rows[0].fields.unsupported='x'],['field bound',r=>r.input.rows[0].fields.name='x'.repeat(201)],['numeric coercion',r=>r.input.rows[0].fields.name=1]])test(name+' rejects the whole plan',()=>{const r=clone(request);mutate(r);assert.equal(checkPersonalizationPlan(r,planContext()).ok,false);});
test('original row hash precedes optional display default',()=>{
  const r=clone(request),ctx=planContext();ctx.policy.fields.find(field=>field.field_id==='detail').required=false;ctx.policy.content_hash=productionContentHash(ctx.policy);ctx.template.personalization_schema_ref.content_hash=ctx.policy.content_hash;ctx.template.content_hash=productionContentHash(ctx.template);r.binding.template_ref.content_hash=ctx.template.content_hash;r.input.row_schema_ref.content_hash=ctx.policy.content_hash;delete r.input.rows[0].fields.detail;
  const result=checkPersonalizationPlan(r,ctx);assert.equal(result.ok,true);assert.equal(result.value.rows[0].fields.detail,'');assert.equal(result.value.rows[0].input_hash,hashManifest(r.input.rows[0]));
});
test('atomic failed result retains execution success and exposes zero refs',()=>assert.equal(checkBatchPages([calibration.batch],batchContext()).ok,true));
test('partial output uses separately supplied complete row metadata',()=>{
  const {batch,context}=partialBatch();assert.equal(checkBatchPages([batch],context).ok,true);
});
for(const [name,mutate] of [['counts',b=>b.counts.failed=0],['terminal pending',b=>{b.counts.failed=0;b.counts.pending=1;}],['atomic publication',b=>b.published_count=1],['ordinal',b=>b.rows[1].ordinal=0],['input hash',b=>b.rows[0].input_hash='sha256:'+'a'.repeat(64)],['missing row',b=>b.rows.pop()],['job binding',b=>b.rows[0].job.batch_input_hash='sha256:'+'a'.repeat(64)]])test(name+' cannot pass complete batch validation',()=>{const b=clone(calibration.batch);mutate(b);assert.equal(checkBatchPages([b],batchContext()).ok,false);});
for(const [name,mutate] of [['row scope',b=>b.rows[0].bundle_ref.row_scope.ordinal=1],['partial files',b=>b.rows[0].artifact_ref=null],['missing proof',()=>{}],['failed publish',b=>b.rows[0].status='failed']])test(name+' cannot become partial publication',()=>{
  const {batch,context}=partialBatch();mutate(batch);if(name==='missing proof')context.verified_rows={};assert.equal(checkBatchPages([batch],context).ok,false);
});
test('cancelled atomic operation exposes zero refs',()=>{
  const batch=clone(calibration.batch);batch.status='cancelled';batch.rows[1].status='cancelled';batch.counts.failed=0;batch.counts.cancelled=1;batch.cancel_requested=true;
  assert.equal(checkBatchPages([batch],batchContext()).ok,true);
});
test('skipped rows require a diagnostic and explicit reason',()=>{
  const batch=clone(calibration.batch);batch.rows[1].status='skipped';batch.counts.failed=0;batch.counts.skipped=1;
  assert.equal(checkBatchPages([batch],batchContext()).ok,false);batch.rows[1].skip_reason='SKIPPED_POLICY';assert.equal(checkBatchPages([batch],batchContext()).ok,true);
});
test('global counts stay global across bounded pages',()=>{
  const first=clone(calibration.batch),second=clone(calibration.batch);first.rows=first.rows.slice(0,1);first.next_cursor='opaque-host-cursor';second.rows=second.rows.slice(1);second.page_start=1;
  assert.equal(checkBatchPages([first,second],batchContext()).ok,true);assert.equal(checkBatchPages([first],batchContext()).ok,false);assert.equal(checkBatchPages([second,first],batchContext()).ok,false);
});
test('CSV disabled rejects before fetch or scheduling',()=>{
  let calls=0;const ctx={enabled:false,fetch(){calls++;},schedule(){calls++;}};
  assert.equal(checkCsvInput({invalid:true},ctx).errors[0].code,'CAPABILITY_DISABLED');assert.equal(calls,0);
  assert.equal(checkPersonalizationPlan({input:{kind:'csv'}},planContext()).errors[0].code,'CAPABILITY_DISABLED');
});
test('CSV enabled schema checkpoint is conditional and supplies no parser or launch authority',async()=>{
  const dialect=await readProduction('CsvDialect'),mapping=await readProduction('CsvMapping'),checkpoint=await readProduction('CsvCheckpoint');
  const ref=d=>({contract:d.contract,schema_version:d.schema_version,id:d.id,revision:d.revision,content_hash:d.content_hash});
  const r=clone(request);r.input={kind:'csv',file_ref:checkpoint.file_ref,dialect_ref:ref(dialect),mapping_ref:ref(mapping)};
  const ctx={enabled:true,scope:calibration.scope,enabling_ref:ref(dialect),expected_enabling_ref:ref(dialect),dialect,mapping,row_policy:calibration.personalization};
  const result=checkCsvInput(r,ctx);assert.equal(result.ok,true);assert.equal(result.value.parser_implemented,false);assert.equal(result.value.launch_authorized,false);
  mapping.headers.push(mapping.headers[0]);assert.equal(checkCsvInput(r,ctx).ok,false);
});
