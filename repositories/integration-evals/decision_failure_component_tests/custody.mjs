import assert from 'node:assert/strict';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {manifest} from '../fulfillment_component_tests/files.mjs';
import {sha256,digest} from '../fulfillment_component_tests/custody.mjs';
export {verifySource,checked,sha256,digest} from '../fulfillment_component_tests/custody.mjs';

export async function verifyInstalled(harness,creative) {
  const root=join(harness,'node_modules/creative-engine');const files=await manifest(root);
  for(const row of files) {
    assert.match(row.sha256,/^[a-f0-9]{64}$/);
    const sourcePath=['.npmignore','.entire/.npmignore','examples/frontend-action-roundtrip/.npmignore'].includes(row.path)?row.path.replace(/\.npmignore$/,'.gitignore'):row.path;
    assert.equal(sha256(await readFile(join(creative,sourcePath))),row.sha256,`Installed Creative differs from source: ${row.path}`);
  }
  const pkg=JSON.parse(await readFile(join(root,'package.json')));
  assert.equal(pkg.name,'creative-engine');
  assert.equal(JSON.parse(await readFile(join(harness,'node_modules/typescript/package.json'))).version,'5.9.3');
  assert.equal(JSON.parse(await readFile(join(harness,'node_modules/neatlogs/package.json'))).version,'1.1.28');
  return {files,sha256:digest(files),packaging_renames:['.npmignore','.entire/.npmignore','examples/frontend-action-roundtrip/.npmignore'].map(path=>({installed:path,source:path.replace(/\.npmignore$/,'.gitignore')})),public_entries:{inspection:pkg.exports['./inspection'].import,contracts:pkg.exports['./contracts'].import},esm_graph:'one_installed_creative_graph'};
}

export async function verifyCachedArchive(cache,pins) {
  const integrity=pins.creative_dependency.integrity;
  assert.match(integrity,/^sha512-[A-Za-z0-9+/]+={0,2}$/);
  const hash=Buffer.from(integrity.slice(7),'base64').toString('hex');
  const path=join(cache,'_cacache/content-v2/sha512',hash.slice(0,2),hash.slice(2,4),hash.slice(4));
  const stat=await lstat(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<16*1024*1024);
  const bytes=await readFile(path);assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`,integrity);
  assert.equal(sha256(bytes),pins.creative_archive_sha256);
  return {origin:pins.creative_dependency.resolved,bytes:bytes.length,integrity,sha256:sha256(bytes)};
}
