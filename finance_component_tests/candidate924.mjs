import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256, fileManifest, recordEvaluator } from './custody.mjs';
import { validateFixtureSchema } from './fixture-schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const fixtureRoot = join(here, 'fixtures/finance924');
export const canonicalJson = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
}
export const recordHash = value => 'sha256:' + sha256(canonicalJson(value));
const references = page => page.canonicalSummaries.map(summary => ({summaryId:summary.summary_id,
  policy:summary.policy_ref, metrics:Object.fromEntries(Object.entries(summary.metrics).map(([name,value]) => [name,value.definition_ref]))}));
const normalizedQuery = (request, asOf) => {
  const {requestId, idempotencyKey, cursor, snapshotId, requestedAsOf, ...query} = request;
  return {...query, groupings:[...query.groupings].sort(), asOf, encoding:'2.0.0',
    filters:Object.fromEntries(Object.entries(query.filters).map(([key,value]) => [key,Array.isArray(value) ? [...value].sort() : value]))};
};
const refusalCodes = {
  unsigned_cursor_forgery:'VALIDATION_ERROR', cursor_page_size_mismatch:'IDEMPOTENCY_CONFLICT',
  snapshot_period_mismatch:'IDEMPOTENCY_CONFLICT', snapshot_filter_mismatch:'IDEMPOTENCY_CONFLICT',
  foreign_scope:'FORBIDDEN_SCOPE', cross_version_snapshot:'IDEMPOTENCY_CONFLICT',
  current_grant_denied:'FORBIDDEN_SCOPE', stale_current_grant:'FORBIDDEN_SCOPE', revoked_after_commit:'FORBIDDEN_SCOPE',
};

export async function loadCandidateFixtures(directory = fixtureRoot) {
  const pin = JSON.parse(await readFile(join(here, '../contracts/finance924-fixture-pin.json')));
  assert.equal(pin.mode, 'synthetic-captured-fixture-consumer');
  assert.deepEqual((await readdir(directory)).sort(), Object.keys(pin.files).sort(), 'Exact fixture file set required');
  const files = {};
  for (const [name, expected] of Object.entries(pin.files)) {
    const bytes = await readFile(join(directory,name));
    assert.ok(bytes.length <= 2 * 1024 * 1024, 'Fixture too large');
    assert.equal(sha256(bytes), expected, `Pinned fixture mismatch: ${name}`);
    files[name] = JSON.parse(bytes);
  }
  const handoff = files['accepted-handoff.json'];
  assert.equal(handoff.status, 'FINANCE_OWNER_ACCEPTED_SYNTHETIC_CONFORMANCE_ONLY');
  assert.equal(handoff.producerHead, pin.producer);
  assert.equal(handoff.producerTree, pin.producerTree);
  assert.equal(handoff.files['producer-v2-pagination-page.json'].sha256,pin.files['pagination.json']);
  assert.equal(handoff.files['producer-v2-refusals-page.json'].sha256,pin.files['refusals.json']);
  const historical = files['historical22-manifest.json'];
  assert.equal(historical.producer,pin.historicalUnknownSource);
  for (const [name,source] of [['historical22-unknown-simulated.json','producer-unknown-simulated-v2-page.json'],
    ['page-schema.json','schemas/cost-intelligence/2.0.0/reporting/FinancialSummaryPageSchema.json'],
    ['definition-registry.json','fixtures/reporting/definition-registry.json']])
    assert.equal(historical.files.find(file => file.path === source).sha256,pin.files[name]);
  return {pin,files};
}

function validatePage(page, files) {
  validateFixtureSchema(files['page-schema.json'],page);
  const registry = files['definition-registry.json'];
  for (const entry of [...Object.values(registry.metrics),registry.policy]) {
    assert.equal(entry.reference.content_hash,recordHash(entry.definition),'Definition content hash');
    assert.equal(entry.reference.id,entry.definition.definitionId,'Definition identity');
  }
  assert.equal(recordHash(page.summary),page.summaryContentHash,'Summary content hash');
  assert.deepEqual(page.canonicalSummaries.map(summary=>summary.currency),page.summary.currencies.map(row=>row.currency),'Canonical currency coverage');
  for (const summary of page.canonicalSummaries) {
    validateFixtureSchema(files['FinancialSummary-schema.json'],summary,[files['CommonEnvelope-schema.json'],files['ErrorEnvelope-schema.json']]);
    assert.equal(summary.tenant_id,page.scope.tenantId);assert.equal(summary.project_id,page.scope.projectId);
    assert.equal(summary.environment,page.scope.environment);assert.equal(summary.billing_mode,page.scope.billingMode);
    assert.deepEqual(summary.period,page.period);assert.equal(summary.scale,18);assert.equal(summary.rounding,'none');
    assert.deepEqual(summary.policy_ref,registry.policy.reference,'Independent policy reference');
    assert.deepEqual(Object.keys(summary.metrics).sort(),Object.keys(registry.metrics).sort());
    for (const [name,metric] of Object.entries(summary.metrics)) {
      assert.deepEqual(metric.definition_ref,registry.metrics[name].reference,'Independent metric reference');
      if (metric.status !== 'known') assert.equal(metric.value,null,'Unknown canonical amounts remain null');
    }
    if (summary.coverage.expected === null) assert.equal(summary.completeness,'incomplete','Unknown coverage cannot be complete');
    assert.equal(summary.producer.source_revision,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','Synthetic source placeholder must remain unmodified');
    assert.ok(page.summary.currencies.some(row => row.currency === summary.currency));
  }
  assert.equal(page.canonicalMappingStatus,'proposal_only_owner_ack_pending');
}

const scaled = value => {
  assert.match(value,/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u);
  const negative=value.startsWith('-');const [integer,fraction='']=value.replace(/^-/u,'').split('.');
  return (negative?-1n:1n)*BigInt(integer+fraction.padEnd(18,'0'));
};

export function evaluateCandidate924({pin,files}) {
  const capture=files['pagination.json'];const refusals=files['refusals.json'];
  assert.equal(capture.status,'TESTED_SYNTHETIC_PAGINATION_CAPTURE_NOT_CONSUMER_ACK');
  assert.equal(capture.pages.length,3);assert.equal(capture.detailCount,6);assert.equal(capture.terminal,true);
  const first=capture.pages[0].response;const rows=[];
  for (const [index,entry] of capture.pages.entries()) {
    const {request,response}=entry;assert.equal(entry.index,index);
    assert.equal(request.schemaVersion,'2.0.0');assert.equal(response.requestId,request.requestId);
    assert.equal(recordHash(request),entry.requestRecordHash,'Captured request hash');
    assert.equal(recordHash(response),entry.responseRecordHash,'Captured response hash');
    validatePage(response,files);
    assert.equal(recordHash(normalizedQuery(request,response.asOf)),response.queryContentHash,'Normalized query hash');
    for(const key of ['snapshotId','queryContentHash','summaryContentHash','asOf','detailCount','timezone','scope','period','filters','watermark','summary','canonicalSummaries'])
      assert.deepEqual(response[key],first[key],`Frozen page field: ${key}`);
    assert.equal(recordHash(references(response)),capture.binding.referenceHash,'Frozen canonical reference hash');
    assert.equal(request.pageSize,2);assert.equal(response.details.length,2);assert.equal(response.detailCount,6);
    if(index===0){assert.equal(request.cursor,undefined);assert.equal(request.snapshotId,undefined);}
    else {assert.equal(request.snapshotId,first.snapshotId);assert.equal(request.cursor,capture.pages[index-1].response.nextCursor,'Opaque continuation must be unchanged');}
    assert.equal(response.hasMore,index<2);
    if(index<2){assert.match(response.nextCursor,/^[A-Za-z0-9_-]+$/u);assert.ok(response.nextCursor.length<=2048);}
    else assert.equal(response.nextCursor,null,'Terminal page');
    rows.push(...response.details);
  }
  for(const key of ['snapshotId','queryContentHash','summaryContentHash','asOf','scope'])assert.deepEqual(capture.binding[key],first[key]);
  assert.equal(new Set(rows.map(row=>row.detailId)).size,6,'No duplicate detail IDs');
  assert.deepEqual(rows.map(row=>row.detailId),capture.orderedDetailIds);
  assert.deepEqual(rows.map(row=>row.detailId),[...capture.orderedDetailIds].sort(),'Stable detail ordering');
  assert.deepEqual(first.summary.currencies.map(row=>row.currency),['EUR','USD'],'No cross-currency aggregation');
  const usd=first.summary.currencies.find(row=>row.currency==='USD');
  assert.equal(usd.metrics.directCosts.knownSubtotal,'1.000000000000000001');
  assert.equal(usd.metrics.grossSales.knownSubtotal,'20');assert.equal(usd.metrics.netSales.knownSubtotal,'15');
  assert.equal(usd.metrics.contribution.knownSubtotal,'13.999999999999999999');
  for(const currency of first.summary.currencies)for(const name of ['grossSales','netSales','directCosts','contribution'])
    assert.equal(rows.filter(row=>row.currency===currency.currency).reduce((sum,row)=>sum+scaled(row.metrics[name]),0n),scaled(currency.metrics[name].knownSubtotal??'0'),'Exact per-currency detail sums');
  for(const row of rows)assert.equal(row.status,'recognized','This accepted pagination capture has no unknown detail');
  assert.deepEqual(refusals.observations.map(row=>row.name),Object.keys(refusalCodes),'Exact nine refusal cases');
  for(const key of ['snapshotId','queryContentHash','summaryContentHash'])assert.equal(refusals[key],first[key]);
  for(const row of refusals.observations) {
    assert.equal(recordHash(row.request),row.requestRecordHash);assert.equal(recordHash(row.result),row.resultRecordHash);
    assert.equal(row.result.ok,false,'Refusal cannot be success');assert.deepEqual(Object.keys(row.result).sort(),['error','ok']);
    const error=row.result.error;assert.equal(error.code,refusalCodes[row.name],'Expected refusal routing');assert.equal(error.schemaVersion,'1.0.0');
    assert.equal(error.module,'reporting');assert.equal(error.operation,'querySummary');assert.equal(error.retryable,false);
    assert.ok(typeof error.safe_message==='string'&&error.safe_message.length>0);assert.match(error.diagnostic_ref,/^ci1:/u);
  }
  const historical=files['historical22-unknown-simulated.json'];validatePage(historical,files);
  const unknown=historical.summary.currencies[0].simulated.expense;
  assert.deepEqual(unknown,{status:'partial',knownSubtotal:'5',total:null,unknownCount:1},'Historical22 unknown simulated expense oracle');
  assert.equal(historical.details.filter(row=>row.amount===null&&row.status==='unknown').length,1,'Historical unknown amount remains null');
  return {pages:3,uniqueDetails:6,refusals:9,currencies:['EUR','USD'],historicalUnknownControl:{source:pin.historicalUnknownSource,...unknown},
    assertionGroups:['trusted outer and canonical schemas','independent definition and policy references','summary and normalized-query hashes','captured record hashes','frozen aggregate and reference hashes','opaque cursor continuity and terminal page','unique ordered detail IDs','exact decimal per-currency oracle','nine typed refusals','historical22 unknown amounts preserved']};
}

export async function runCandidate924(outputArg) {
  assert.ok(outputArg,'Usage: node finance_component_tests/run.mjs --candidate-924-fixtures OUTPUT');
  const output=resolve(outputArg);await mkdir(output,{recursive:false});
  const receipt={kind:'synthetic-captured-fixture-consumer',candidateScope:'Finance924 pagination',status:'failed',
    validationSurface:'evaluation-owned pinned-schema captured-fixture projection; no SDK or producer API conformance claimed',
    authorityVerification:'Owner-captured synthetic refusal records inspected; HMAC, current authority and grants not executed or replayed by IE',
    producerExecuted:false,postgresExecuted:false,hmacVerified:false,currentAuthorityExecuted:false,
    providerCalls:0,adoptionAccepted:false,ownerAcknowledgement:null,productAcceptance:'blocked',node:process.version};
  try {
    const loaded=await loadCandidateFixtures();assert.equal(process.version,`v${loaded.pin.node}`);
    await recordEvaluator(here,output);
    const git=spawnSync('git',['-C',here,'show','-s','--format=%H%n%T','HEAD'],{encoding:'utf8',timeout:30000});assert.equal(git.status,0);
    const [revision,tree]=git.stdout.trim().split('\n');receipt.consumer={revision,tree};
    receipt.provenance=loaded.pin;receipt.observation=evaluateCandidate924(loaded);receipt.status='passed';
    receipt.consumerAcknowledgement='SCOPED_SYNTHETIC_FIXTURE_CONFORMANCE_ONLY';
  }catch(error){receipt.failure=error.message;process.exitCode=1;}
  await writeFile(join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  await writeFile(join(output,'artifacts.json'),JSON.stringify(await fileManifest(output),null,2)+'\n');
  console.log(`Finance924 captured consumer ${receipt.status}; receipt: ${join(output,'receipt.json')}`);
}
