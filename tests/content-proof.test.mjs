import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { validateContent, digest } from '../scripts/suites/content.mjs';
import { validateProof, webpChunks } from '../scripts/suites/proof.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const html=await readFile(resolve(root,'site/index.html'),'utf8');
const inventory=JSON.parse(await readFile(resolve(root,'src/content/copy.json'),'utf8'));
const manifest=JSON.parse(await readFile(resolve(root,'review/examples.json'),'utf8'));
const now=new Date('2026-10-12T12:00:00Z');
const clone=value=>structuredClone(value);
test('audited provisional copy passes as draft with approvals pending',()=>assert.equal(validateContent(html,inventory,{now}).status,'PASS_DRAFT'));
test('unreviewed copy change is rejected, including a new unsupported price',()=>assert.throws(()=>validateContent(html.replace('Explore digital','Buy for $9.99: digital'),inventory,{now}),/Unreviewed/));
test('unreviewed claim fixture is rejected',()=>{const bad=clone(inventory); bad.entries[0].authorAudit='unreviewed';assert.throws(()=>validateContent(html,bad,{now}),/unreviewed claim/);});
test('expired claim fixture is rejected',()=>{const bad=clone(inventory);bad.entries[0].recheckBy='2026-10-11';assert.throws(()=>validateContent(html,bad,{now}),/stale/);});
test('future audit date and moving source references are rejected',()=>{const bad=clone(inventory);bad.entries[0].reviewDate='2026-10-13';assert.throws(()=>validateContent(html,bad,{now}),/invalid audit/);bad.entries[0].reviewDate='2026-10-12';bad.entries[0].source.revision='main';assert.throws(()=>validateContent(html,bad,{now}),/immutable/);});
test('draft cannot fabricate owner approval; release correctly remains blocked',()=>{const bad=clone(inventory);bad.entries[0].approval='APPROVED';assert.throws(()=>validateContent(html,bad,{now}),/assert owner approval/);assert.throws(()=>validateContent(html,inventory,{mode:'release',now}),/approval pending/);});
test('all retained assets and illustrative examples are hash-covered',async()=>assert.equal((await validateProof({root,manifest,html})).status,'PASS_DRAFT'));
test('proof release correctly blocks unconfirmed publication permission',async()=>await assert.rejects(validateProof({root,manifest,html,mode:'release'}),/release permission/));
test('missing metadata and forbidden synthetic marker fixtures are rejected',async()=>{const bad=clone(manifest);delete bad.assets[0].rights;await assert.rejects(validateProof({root,manifest:bad,html}),/missing rights/);const marker=clone(manifest);marker.scenes[0].caption='LP_PRIVATE_BOOKING_CANARY';await assert.rejects(validateProof({root,manifest:marker,html}),/Forbidden/);});
test('missing media and changed bytes fail without damaging real assets',async()=>{
 const temp=await mkdtemp(resolve(tmpdir(),'lp-proof-fixture-'));
 try{
  await cp(resolve(root,'site'),resolve(temp,'site'),{recursive:true});
  const asset=manifest.assets[0],path=resolve(temp,asset.path);
  await rm(path);await assert.rejects(validateProof({root:temp,manifest,html}),/ENOENT/);
  await writeFile(path,'replacement');await assert.rejects(validateProof({root:temp,manifest,html}),/digest changed/);
  const bytes=Buffer.from('LP_PRIVATE_ACCOUNT_CANARY');await writeFile(path,bytes);
  const bad=clone(manifest);bad.assets[0].sha256=digest(bytes);
  await assert.rejects(validateProof({root:temp,manifest:bad,html}),/Forbidden/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('EXIF/XMP chunk scanner identifies embedded metadata',()=>{const bytes=Buffer.alloc(20);bytes.write('RIFF',0);bytes.writeUInt32LE(12,4);bytes.write('WEBP',8);bytes.write('EXIF',12);bytes.writeUInt32LE(0,16);assert.deepEqual(webpChunks(bytes),['EXIF']);});
test('static illustrative description remains independent of images',()=>assert.ok(html.includes(manifest.fallback.staticDescription)));
