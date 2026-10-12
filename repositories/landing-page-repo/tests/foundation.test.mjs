import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSite, root } from '../scripts/build.mjs';
import { validateArtifact } from '../scripts/artifact.mjs';
import { createPreview } from '../scripts/preview.mjs';

async function sandbox(t, actual = false) {
  const repository = await mkdtemp(resolve(tmpdir(), 'lp-foundation-test-'));
  t.after(() => rm(repository, { recursive: true, force: true }));
  if (actual) await cp(resolve(root, 'site'), resolve(repository, 'site'), { recursive: true });
  else {
    await mkdir(resolve(repository, 'site/assets'), { recursive: true });
    await writeFile(resolve(repository, 'site/index.html'), '<img src="assets/sample.svg">');
    await writeFile(resolve(repository, 'site/assets/sample.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  }
  return repository;
}

test('actual illustrated source builds reproducibly with every asset and no repository documents', async t => {
  const repository = await sandbox(t, true);
  const {output,files} = await buildSite({ repository });
  assert.ok(files.length >= 11);
  await validateArtifact(repository, output);
  const first = await readFile(resolve(output, 'manifest.json'));
  await writeFile(resolve(output, 'stale-private-note.md'), 'must disappear');
  await buildSite({ repository });
  assert.deepEqual(await readFile(resolve(output, 'manifest.json')), first);
  await validateArtifact(repository, output);
});

test('validator detects missing referenced assets, tampering, stale manifests and unexpected files', async t => {
  const repository = await sandbox(t);
  const {output} = await buildSite({ repository });
  await writeFile(resolve(output, 'assets/sample.svg'), '<svg>tampered</svg>');
  await assert.rejects(validateArtifact(repository, output), /hash\/source mismatch/);
  await buildSite({ repository });
  const manifestPath = resolve(output, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath));
  manifest.files['assets/sample.svg'].sha256 = '0'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(validateArtifact(repository, output), /hash\/source mismatch/);
  await writeFile(resolve(repository, 'site/index.html'), '<img src="assets/absent.svg">');
  await buildSite({ repository });
  await assert.rejects(validateArtifact(repository, output), /Missing local reference/);
  await writeFile(resolve(output, 'private.md'), 'synthetic');
  await assert.rejects(validateArtifact(repository, output), /Unexpected/);
});

test('build refuses symlinks, unreviewed asset types and unsafe output destinations', async t => {
  const repository = await sandbox(t);
  await assert.rejects(buildSite({repository, output: repository}), /below repository\/dist/);
  await writeFile(resolve(repository, 'site/assets/secret.env'), 'synthetic=fixture');
  await assert.rejects(buildSite({ repository }), /Unreviewed asset type/);
  await rm(resolve(repository, 'site/assets/secret.env'));
  await symlink(resolve(repository, 'site/index.html'), resolve(repository, 'site/assets/leak.html'));
  await assert.rejects(buildSite({ repository }), /Unsafe asset entry/);
});

test('preview serves homepage and every actual asset; unknown and app routes cannot fall back to landing', async t => {
  const repository = await sandbox(t, true);
  const {output,files} = await buildSite({ repository });
  // Paths read from host source at 388005240aa62374d49f709afc300adb5e98cd98.
  // Responses are synthetic isolation sentinels, not host-provided acceptance fixtures.
  const fixtures = new Map([
    ['/make', {status: 200, body: 'synthetic-app', type: 'text/plain'}],
    ['/signin/confirm', {status: 401, body: 'synthetic-auth', type: 'text/plain'}],
    ['/api/health', {status: 200, body: '{"fixture":true}', type: 'application/json'}]
  ]);
  const server = createPreview({artifactDir:output, fixtures});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const homepage = await fetch(base + '/');
  assert.equal(homepage.status, 200);
  assert.match(homepage.headers.get('content-type'), /text\/html/);
  assert.equal(await homepage.text(), await readFile(resolve(output,'index.html'), 'utf8'));
  for (const name of files.filter(name => name.startsWith('assets/'))) {
    const response = await fetch(base + '/' + name);
    assert.equal(response.status, 200, name);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(resolve(output,name)));
    assert.match(response.headers.get('content-type'), /(?:image\/webp|application\/json)/);
  }
  for (const [path, fixture] of fixtures) {
    const response = await fetch(base + path);
    assert.equal(response.status, fixture.status);
    assert.equal(await response.text(), fixture.body);
  }
  for (const path of ['/unknown','/studio/fixture','/admin/nested','/api/auth/me','/README.md','/archive/','/manifest.json']) assert.equal((await fetch(base+path)).status,404,path);
  assert.equal((await fetch(base + '/%2e%2e%2fREADME.md')).status,400);
  assert.equal((await fetch(base + '/', {method:'POST'})).status,405);
  assert.equal(await (await fetch(base + '/', {method:'HEAD'})).text(),'');
  const standalone = createPreview({artifactDir:output});
  await new Promise(resolve => standalone.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => standalone.close(resolve)));
  const standaloneBase = `http://127.0.0.1:${standalone.address().port}`;
  for (const path of fixtures.keys()) assert.equal((await fetch(standaloneBase+path)).status,404);
});

test('dispatcher rejects invalid arguments and no-argument validation fails for unavailable required suites', async t => {
  for (const args of [['--suite','bogus'],['--suite'],['--suite','foundation','extra'],['--mode','bogus'],['--mode','draft','--mode','release']]) {
    const result = spawnSync(process.execPath, ['scripts/validate-landing', ...args], {cwd:root, encoding:'utf8'});
    assert.equal(result.status,2);
    assert.match(result.stderr,/Usage:/);
  }
  const repository = await sandbox(t);
  await mkdir(resolve(repository,'scripts/suites'),{recursive:true});
  await writeFile(resolve(repository,'scripts/suites/foundation.mjs'),"export default async () => ({status:'PASS_LOCAL'});");
  const module = resolve(root,'scripts/validate.mjs');
  const run = args => spawnSync(process.execPath, ['--input-type=module','-e',`import {main} from ${JSON.stringify(module)}; await main(${JSON.stringify(args)}, {repository:${JSON.stringify(repository)}});`], {encoding:'utf8'});
  const all = run([]);
  assert.equal(all.status,1);
  assert.match(all.stdout,/PASS_LOCAL foundation/);
  assert.match(all.stderr,/FAIL cta: required validator unavailable/);
  assert.match(all.stderr,/FAIL governance: required validator unavailable/);
  const missing = run(['--suite','cta']);
  assert.equal(missing.status,1);
  assert.match(missing.stderr,/Implement scripts\/suites\/cta.mjs/);
  await writeFile(resolve(repository,'scripts/suites/content.mjs'), "export default async ({mode}) => ({status:mode==='draft' ? 'PASS_DRAFT' : 'PASS_DRAFT'});");
  const release = run(['--suite','content']);
  assert.equal(release.status,1);
  assert.match(release.stderr,/Draft evidence cannot pass release/);
  const draft = run(['--suite','content','--mode','draft']);
  assert.equal(draft.status,0);
  assert.match(draft.stdout,/PASS_DRAFT content/);
  assert.doesNotMatch(draft.stdout,/^PASS content/m);
});
