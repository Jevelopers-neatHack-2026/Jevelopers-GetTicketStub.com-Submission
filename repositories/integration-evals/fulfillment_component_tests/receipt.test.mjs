import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyArchive, verifyMembers, verifySource } from './custody.mjs';
import { blocked, artifactNames, validateReceipt, validateArtifacts } from './receipt.mjs';
import { runBounded, retirePrivate } from './process.mjs';

const pin = JSON.parse(await readFile(new URL('../contracts/fulfillment-producer-pin.json', import.meta.url)));
const archive = fileURLToPath(new URL('./fixtures/print-corpus.zip', import.meta.url));
const reader = fileURLToPath(new URL('./archive_reader.py', import.meta.url));
const temporary = async () => realpath(await mkdtemp(join(tmpdir(), 'fulfillment-unit-')));
const goodReceipt = () => ({ kind: 'fulfillment-bundle-component-development', status: 'passed', source: pin.revision,
  corpus_sha256: pin.corpus.sha256, platform: 'linux', node: `v${pin.node}`, accepted: false, handoffEligible: false,
  paid_execution_enabled: false, actual_sandbox_execution: false, cleanup: { confirmed: true, private_removed: true },
  execution_boundary: { namespace_separate: true, interfaces: ['lo'], ipv4_route_count: 0, uid_nonroot: true, claim: 'network_namespace_only' },
  owner_control: { basis: 'owner_assertion', status: 'passed', localFixtureCounts: { total: 166, passed: 166, failed: 0 } },
  artifacts: artifactNames.map(path => ({ path, sha256: 'a'.repeat(64) })), members: pin.corpus.members });
const record = async (name, value) => {
  if (!process.env.FC_TEST_EVIDENCE) return;
  await mkdir(process.env.FC_TEST_EVIDENCE, { recursive: true });
  await writeFile(join(process.env.FC_TEST_EVIDENCE, name), JSON.stringify({ synthetic_control: true, ...value }, null, 2));
};

test('exact immutable archive joins all 65 provenance members using standard ZIP reader', async () => {
  const root = await temporary();
  try {
    await verifyArchive(archive, pin);
    const result = await runBounded('python3', [reader, archive, join(root,'members'), ...pin.corpus.members.map(row=>row.path)], { env: { PATH: process.env.PATH } });
    assert.equal(result.exitCode, 0); assert.equal(result.groupAbsent, true);
    const members = JSON.parse(result.stdout); verifyMembers(members,pin);
    await record('archive-custody.json', { members, origin: pin.corpus.origin, archive_sha256: pin.corpus.sha256 });
  } finally { await rm(root, { recursive: true }); }
});
test('archive byte drift cannot use the captured provenance', async () => {
  const root = await temporary(); const bytes = await readFile(archive); bytes[100] ^= 1;
  await writeFile(join(root,'changed.zip'),bytes);
  try { await assert.rejects(verifyArchive(join(root,'changed.zip'),pin)); } finally { await rm(root,{recursive:true}); }
});
test('symlinked archive input is rejected', async () => {
  const root = await temporary(); await symlink(archive,join(root,'linked.zip'));
  try { await assert.rejects(verifyArchive(join(root,'linked.zip'),pin)); } finally { await rm(root,{recursive:true}); }
});
for(const variant of ['unexpected-member','symlink-member']) test(`${variant} metadata is rejected before extraction`, async () => {
  const root = await temporary(); const bytes = await readFile(archive);
  const names=pin.corpus.members.map(row=>row.path);
  if(variant==='unexpected-member') names.pop();
  else {
    // Negative outer-container metadata only; no reconstructed producer bundle is supplied to a consumer.
    const index=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x01,0x02])); assert.ok(index>0);
    bytes.writeUInt32LE(0xa1ff0000,index+38);
  }
  await writeFile(join(root,'negative.zip'),bytes);
  try {
    const result=await runBounded('python3',[reader,join(root,'negative.zip'),join(root,'members'),...names],{env:{PATH:process.env.PATH}});
    assert.notEqual(result.exitCode,0);assert.equal(result.groupAbsent,true);
    await assert.rejects(readFile(join(root,'members/CORPUS.json')),{code:'ENOENT'});
  } finally {await rm(root,{recursive:true});}
});
test('member inventory rejects omission and hash drift', () => {
  assert.throws(()=>verifyMembers(pin.corpus.members.slice(1),pin));
  const rows=structuredClone(pin.corpus.members);rows[0].sha256='0'.repeat(64);
  assert.throws(()=>verifyMembers(rows,pin));
});
for(const [name,mutate] of [
  ['source drift',v=>{v.source='0'.repeat(40);} ], ['archive drift',v=>{v.corpus_sha256='0'.repeat(64);} ],
  ['missing variant',v=>{v.artifacts.pop();}], ['unknown cleanup',v=>{v.cleanup.confirmed=false;}],
  ['retained private files',v=>{v.cleanup.private_removed=false;}], ['authority upgrade',v=>{v.accepted=true;}],
  ['eligibility upgrade',v=>{v.handoffEligible=true;}], ['sandbox claim',v=>{v.actual_sandbox_execution=true;}],
  ['upgraded owner assertion',v=>{v.owner_control.basis='direct';}], ['missing isolated execution',v=>{delete v.execution_boundary;}],
]) test(`receipt rejects ${name}`,()=>{const value=goodReceipt();mutate(value);assert.throws(()=>validateReceipt(value,pin));});
test('qualified synthetic shape preserves explicitly blocked authority',()=>{validateReceipt(goodReceipt(),pin);});
for(const field of ['authorityIssued','accepted','handoffEligible','eligibility']) test(`returned report rejects ${field} upgrade`,()=>{
  const report={owner:{accepted:false},authorityIssued:false,accepted:false,handoffEligible:false,eligibility:'blocked'};
  report[field]=field==='eligibility'?'eligible':true;assert.throws(()=>blocked(report));
});
test('missing report files cannot validate an artifact set',async()=>{
  const root=await temporary();try{await assert.rejects(validateArtifacts(root,pin),{code:'ENOENT'});}finally{await rm(root,{recursive:true});}
});
for(const [name,script,limits] of [
  ['timeout','setInterval(()=>{},1000)',{timeout:100,limit:4096}],
  ['output_overflow',"process.stdout.write('x'.repeat(65536));setInterval(()=>{},1000)",{timeout:5000,limit:1024}],
]) test(`${name} kills inert child and retains failed control evidence`,async()=>{
  const result=await runBounded(process.execPath,['-e',script],{...limits,grace:100,env:{}});
  assert.equal(result.failure,name);assert.equal(result.groupAbsent,true);assert.notEqual(result.exitCode,0);
  await record(`${name}.json`,{status:'failed',...result});
});
test('unknown bootstrap or nested execution lifetime preserves owned private files',async()=>{
  const root=await temporary();await writeFile(join(root,'marker'),'potentially-live');
  try{const result=await retirePrivate(root,false);assert.equal(result.private_removed,false);assert.equal(await readFile(join(root,'marker'),'utf8'),'potentially-live');await record('quarantine.json',{status:'failed',...result});}
  finally{await rm(root,{recursive:true});}
});
if(process.env.FC_TEST_SOURCE) test('actual clean exact source custody rejects tracked-byte pin drift',async()=>{
  const source=await verifySource(process.env.FC_TEST_SOURCE,pin);assert.equal(source.revision,pin.revision);
  await assert.rejects(verifySource(process.env.FC_TEST_SOURCE,{...pin,tracked_files_sha256:'0'.repeat(64)}));
  await record('source-custody.json',source);
});
