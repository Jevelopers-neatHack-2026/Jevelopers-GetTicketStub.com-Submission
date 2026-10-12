import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as usage from '@jevelopers/shared-contracts/usage-reported-unsettled';
import { validateContractVersion } from '@jevelopers/shared-contracts';
import { checkUsageEvent, compareUsageIdentity, checkOperation } from '@jevelopers/shared-contracts/operations';
const fixture = name => JSON.parse(readFileSync(new URL(import.meta.resolve('@jevelopers/shared-contracts/fixtures/' + name + '.json')), 'utf8'));
const v2 = fixture('UsageEvent.2_0_0');
const v1 = fixture('UsageEvent');
v1.context = v1.cases.find(c => c.id === 'semantic-positive').context;
const records = [];
const hash = usage.providerReportedCostEvidenceContentHash;
function check(name, actual, expected) {
  const observed = actual.ok ? (typeof actual.value === 'string' ? actual.value : 'OK') : actual.errors.map(e => e.code);
  const passed = Array.isArray(observed) ? observed.includes(expected) : observed === expected;
  records.push({ name, expected, observed, passed });
}
function scenario(name, edit, expected) {
  const f = structuredClone(v2);
  edit(f.valid, f.context);
  check(name, usage.checkReportedUnsettledUsageEvent(f.valid, f.context), expected);
}
function rebind(f) {
  const e = f.context.evidence_lookup.record;
  e.content_hash = hash(e);
  const ref = {contract:e.contract,schema_version:e.schema_version,id:e.evidence_id,revision:e.revision,content_hash:e.content_hash};
  f.valid.valuation.provider_evidence_ref = ref;
  f.context.evidence_lookup.expected_reference = ref;
}
check('v2-public-opt-in-positive',usage.checkReportedUnsettledUsageEvent(v2.valid,v2.context),'OK');
check('v1-old-helper-positive',checkUsageEvent(v1.valid,v1.context),'OK');
check('v1-old-identity-positive',compareUsageIdentity(v1.valid,v1.valid),'duplicate_observation');
check('v1-old-operation-positive',checkOperation('UsageEvent',v1.valid,v1.context),'OK');
check('old-helper-v2-refused',checkUsageEvent(v2.valid,v2.context),'UNSUPPORTED_VERSION');
check('old-operation-v2-refused',checkOperation('UsageEvent',v2.valid,v2.context),'UNSUPPORTED_VERSION');
check('old-identity-v2-refused',compareUsageIdentity(v2.valid,v2.valid),'UNSUPPORTED_VERSION');
check('v1-explicit-version-v2-refused',validateContractVersion('UsageEvent','1.0.0',v2.valid),'UNSUPPORTED_VERSION');
for(const [name,money] of [['known-zero',{amount:'0',currency:'USD',scale:0}],['eighteen-digit-exact',{amount:'0.123456789012345678',currency:'USD',scale:18}]]) {
 const f=structuredClone(v2); f.valid.valuation.money=money; f.context.evidence_lookup.record.reported_cost.money=money; rebind(f);
 const result=usage.checkReportedUnsettledUsageEvent(f.valid,f.context);
 check(name,result,'OK');
 assert.equal(result.ok,true);
 assert.deepEqual(result.value.valuation.money,money);
}
const unknown=structuredClone(v2); unknown.context.evidence_lookup.record.reported_cost={state:'unknown',money:null}; rebind(unknown);
check('unknown-evidence-explicit-null-valid',usage.checkProviderReportedCostEvidence(unknown.context.evidence_lookup.record),'OK');
check('unknown-evidence-cannot-value-event',usage.checkReportedUnsettledUsageEvent(unknown.valid,unknown.context),'UNKNOWN_USAGE');
for(const [name,money,code] of [['over-scale',{amount:'0.1',currency:'USD',scale:0},'INVALID_MONEY'],['nineteen-digit',{amount:'0.1234567890123456789',currency:'USD',scale:19},'INVALID_PAYLOAD'],['non-USD',{amount:'1',currency:'EUR',scale:0},'INVALID_PAYLOAD']]) scenario(name,e=>{e.valuation.money=money;},code);
scenario('known-cost-unknown-usage',e=>{e.completeness='unknown';e.usage_units=null;e.missing_fields=['tokens'];},'OK');
scenario('known-cost-timeout',e=>{e.outcome='timeout';},'OK');
scenario('known-cost-cancelled',e=>{e.outcome='cancelled';},'OK');
scenario('unknown-units-not-zero',e=>{e.completeness='unknown';e.usage_units=[{name:'tokens',quantity:'0',scale:0,relation:'standalone'}];},'UNKNOWN_USAGE');
scenario('missing-billable-identity',e=>{delete e.billable_attempt_id;},'INVALID_PAYLOAD');
scenario('wrong-billable-identity',e=>{e.billable_attempt_id='123e4567-e89b-42d3-a456-000000000999';},'IDENTITY_COLLISION');
scenario('provider-mismatch',e=>{e.provider='other-synthetic-provider';},'REFERENCE_MISMATCH');
scenario('evidence-byte-hash-mismatch',(e,c)=>{c.evidence_lookup.source_bytes_hash='sha256:'+'f'.repeat(64);},'REFERENCE_MISMATCH');
scenario('evidence-record-tamper',(e,c)=>{c.evidence_lookup.record.provider='tampered';},'INVALID_PAYLOAD');
scenario('amount-mismatch',e=>{e.valuation.money.amount='0.000004';},'OBSERVATION_CONFLICT');
scenario('scope-mismatch',e=>{e.project_id='123e4567-e89b-42d3-a456-000000000999';},'SCOPE_MISMATCH');
scenario('observation-time-mismatch',e=>{e.observed_at='2026-10-10T12:00:02Z';},'REFERENCE_MISMATCH');
for(const status of ['missing','revoked','unverified']) scenario('resolver-'+status,(e,c)=>{c.evidence_lookup.status=status;},'INVALID_TRUST_CONTEXT');
const aggregate=structuredClone(v2); aggregate.context.evidence_lookup.record.source_scope={kind:'per_key_aggregate',aggregate_key:'synthetic-key',period_start:'2026-10-10T00:00:00Z',period_end:'2026-10-11T00:00:00Z'}; rebind(aggregate);
check('aggregate-record-valid',usage.checkProviderReportedCostEvidence(aggregate.context.evidence_lookup.record),'OK');
check('aggregate-cannot-assign-attempt-cost',usage.checkReportedUnsettledUsageEvent(aggregate.valid,aggregate.context),'UNSUPPORTED_CASE');
const next=structuredClone(v2); next.valid.source_observation_id='123e4567-e89b-42d3-a456-000000000888';next.valid.usage_event_id='123e4567-e89b-42d3-a456-000000000889';next.valid.event_id=next.valid.usage_event_id;next.valid.supersedes_observation_id=v2.valid.source_observation_id;next.valid.valuation.money.amount='0.000004';next.context.evidence_lookup.record.source_observation_id=next.valid.source_observation_id;next.context.evidence_lookup.record.evidence_id='123e4567-e89b-42d3-a456-000000000887';next.context.evidence_lookup.record.reported_cost.money.amount='0.000004'; rebind(next);
check('supersession-forward',usage.compareReportedUnsettledUsageIdentity(v2.valid,next.valid),'superseding_observation');
check('supersession-reverse',usage.compareReportedUnsettledUsageIdentity(next.valid,v2.valid),'superseded_observation');
check('correction-with-prior',usage.checkReportedUnsettledUsageEvent(next.valid,{...next.context,prior:v2.valid}),'OK');
check('correction-missing-prior',usage.checkReportedUnsettledUsageEvent(next.valid,next.context),'INVALID_TRUST_CONTEXT');
check('late-old-event',usage.checkReportedUnsettledUsageEvent(v2.valid,{...v2.context,prior:next.valid}),'STALE_REVISION');
const cycle=structuredClone(v2);cycle.valid.supersedes_observation_id=next.valid.source_observation_id;
for(const [name,a,b,ctx] of [['cycle-forward',cycle.valid,next.valid,next.context],['cycle-reverse',next.valid,cycle.valid,cycle.context]]) {
 check(name,usage.compareReportedUnsettledUsageIdentity(a,b),'IDENTITY_COLLISION');
 check(name+'-helper',usage.checkReportedUnsettledUsageEvent(b,{...ctx,prior:a}),'IDENTITY_COLLISION');
}
const delivery=structuredClone(v2.valid);delivery.event_id='123e4567-e89b-42d3-a456-000000000555';delivery.transport_attempt_id='123e4567-e89b-42d3-a456-000000000556';delivery.ingested_at='2026-10-10T12:00:04Z';
check('redelivery-is-duplicate',usage.compareReportedUnsettledUsageIdentity(v2.valid,delivery),'duplicate_observation');
const distinct=structuredClone(v2.valid);distinct.source_observation_id='123e4567-e89b-42d3-a456-000000000777';distinct.billable_attempt_id='123e4567-e89b-42d3-a456-000000000778';
check('distinct-billable-attempt',usage.compareReportedUnsettledUsageIdentity(v2.valid,distinct),'distinct_billable_attempt');
const invalid=structuredClone(v2.valid);invalid.valuation.money={amount:'0.1',currency:'USD',scale:0};
check('intrinsic-invalid-left',usage.compareReportedUnsettledUsageIdentity(invalid,v2.valid),'INVALID_MONEY');
check('intrinsic-invalid-right',usage.compareReportedUnsettledUsageIdentity(v2.valid,invalid),'INVALID_MONEY');
let getterCalls=0;const accessor=structuredClone(v2.valid);Object.defineProperty(accessor,'schema_version',{enumerable:true,get(){getterCalls++;throw new TypeError('getter executed');}});
check('accessor-refused',usage.checkReportedUnsettledUsageEvent(accessor,v2.context),'NON_JSON_VALUE');
assert.equal(getterCalls,0);
const report={mode:'synthetic-only-pure-installed-SDK',provider_authentication:false,exports:Object.keys(usage),records,getterCalls,failed:records.filter(r=>!r.passed)};
writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:records.length,failed:report.failed}));
assert.equal(report.failed.length,0);
