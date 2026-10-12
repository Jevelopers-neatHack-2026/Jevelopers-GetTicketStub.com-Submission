import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildSite } from '../scripts/build.mjs';
import { inspectBrand, validateBrand } from '../scripts/suites/brand.mjs';
import { digest } from '../scripts/suites/content.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(resolve(root, 'site/index.html'), 'utf8');
const inventory = JSON.parse(await readFile(resolve(root, 'review/brand-inventory.json'), 'utf8'));
// Fixed fixture clock tests policy logic independently of a later test-run date.
const now = new Date('2026-10-12T17:00:00Z');
const check = (data = inventory, options = {}) => validateBrand({ root, inventory: data, now, ...options });

async function withSource(callback) {
  const temp = await mkdtemp(resolve(tmpdir(), 'lp-brand-fixture-'));
  try {
    await cp(resolve(root, 'site'), resolve(temp, 'site'), { recursive: true });
    await mkdir(resolve(temp, 'review/brand'), { recursive: true });
    await cp(resolve(root, 'review/brand/upstream-allowlist.json'), resolve(temp, 'review/brand/upstream-allowlist.json'));
    await callback(temp);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

test('current source inventory is draft only, with zero imported brand files', async () => {
  const result = await check();
  assert.equal(result.status, 'PASS_DRAFT');
  assert.equal(result.importedBrandFiles, 0);
  assert.equal(result.assets, 10);
});

test('release stays blocked by the empty upstream subset and actual missing acceptance', async () => {
  await assert.rejects(check(inventory, { mode: 'release' }), /Brand release blocked: upstream publishable subset is empty/);
});

for (const [label, change, error] of [
  ['invented owner approval', data => { data.approvals.brand = 'APPROVED'; }, /manufacture approval/],
  ['invented distribution', data => { data.upstream.approvedArtifact = 'synthetic-package'; }, /No approved distribution/],
  ['invented consumer agreement', data => { data.upstream.consumerContract = 'synthetic-contract'; }, /No accepted brand consumer/],
  ['unapproved imported file', data => { data.importedBrandFiles.push('logo/new.svg'); }, /import contract/],
  ['moving upstream pin', data => { data.upstream.revision = 'main'; }, /immutable commit/],
  ['wrong upstream URL', data => { data.upstream.sources[0].url = data.upstream.sources[0].url.replace(data.upstream.revision, 'main'); }, /Unpinned upstream/],
  ['moving landing pin', data => { data.auditedSource.revision = 'main'; data.auditedSource.url = data.auditedSource.url.replace(inventory.auditedSource.revision, 'main'); }, /immutable audit source/],
  ['stale audit', data => { data.audit.recheckBy = '2026-10-12T16:59:59Z'; }, /stale/],
  ['future audit', data => { data.audit.reviewedAt = '2026-10-13T00:00:00Z'; }, /invalid review date/],
  ['missing freshness trigger', data => { data.audit.recheckTriggers.pop(); }, /freshness triggers/],
  ['missing token mapping', data => { data.aliases.pop(); }, /alias coverage/],
  ['false matching-token claim', data => { data.aliases[0].upstreamValue = '#000000'; }, /matching token differs/],
  ['invented inline logo permission', data => { data.inlineMarks[0].permission = 'APPROVED'; }, /not logo permission/],
  ['invented logo provenance', data => { data.inlineMarks[0].originMatch = 'VERIFIED'; }, /upstream derivation/],
]) {
  test(`brand audit rejects ${label}`, async () => {
    const data = structuredClone(inventory); change(data);
    await assert.rejects(check(data), error);
  });
}

for (const [label, change] of [
  ['palette override', value => value.replace('--ink:#17140f', '--ink:#000000')],
  ['removed type fallback', value => value.replace('"Archivo","Arial Black",system-ui,sans-serif', '"Archivo"')],
  ['inline mark replacement', value => value.replace('<symbol id="tsStamp"', '<symbol data-fixture="changed" id="tsStamp"')],
  ['CDN version change', value => value.replace('motion@11.11.17', 'motion@11.11.18')],
  ['new stylesheet', value => value.replace('</head>', '<link rel="stylesheet" href="https://example.invalid/new.css"></head>')],
]) {
  test(`unreviewed ${label} changes source-bound brand inventory`, async () => {
    await withSource(async temp => {
      const changed = change(html); assert.notEqual(changed, html, 'The negative control must alter actual source');
      await writeFile(resolve(temp, 'site/index.html'), changed);
      await assert.rejects(check(inventory, { root: temp, auditRoot: root }), /changed without review/);
      const rehashed = structuredClone(inventory); rehashed.projection = inspectBrand(changed);
      await assert.rejects(check(rehashed, { root: temp, auditRoot: root }), /differs from its immutable landing source/);
    });
  });
}

test('duplicate URL attributes and inline font/import loaders require review', () => {
  assert.throws(() => inspectBrand(html.replace('href="https://fonts.googleapis.com"', 'href="https://fonts.googleapis.com" href="https://example.invalid"')), /Duplicate resource attribute/);
  assert.throws(() => inspectBrand(html.replace('</style>', '@font-face{font-family:fixture;src:url(assets/test.woff2)}</style>')), /font hosting/);
  assert.throws(() => inspectBrand(html.replace('</style>', '@import "https://example.invalid/font.css";</style>')), /CSS import/);
});

test('unrelated focus code changes do not relabel or invalidate unchanged brand bytes', async () => {
  await withSource(async temp => {
    await writeFile(resolve(temp, 'site/index.html'), html.replace('outline-offset:3px', 'outline-offset:4px'));
    assert.equal((await check(inventory, { root: temp, auditRoot: root })).status, 'PASS_DRAFT');
  });
});

test('new files and self-hosted fonts cannot enter the reviewed public subset', async () => {
  await withSource(async temp => {
    const extra = resolve(temp, 'site/assets/fixture.svg');
    await writeFile(extra, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await assert.rejects(check(inventory, { root: temp, auditRoot: root }), /Unreviewed or withdrawn public asset/);
    await rm(extra);
    await writeFile(resolve(temp, 'site/assets/fixture.woff2'), 'SYNTHETIC_FONT_BYTES');
    await assert.rejects(check(inventory, { root: temp, auditRoot: root }), /Self-hosted font/);
  });
});

test('a rehashed changed asset must still match immutable source bytes', async () => {
  await withSource(async temp => {
    const data = structuredClone(inventory), record = data.retainedLandingAssets.find(record => record.path.endsWith('flight.json'));
    const changed = '{"synthetic":"brand-negative-fixture"}\n';
    await writeFile(resolve(temp, 'site', record.path), changed);
    await assert.rejects(check(inventory, { root: temp, auditRoot: root }), /asset digest changed/);
    record.sha256 = digest(changed);
    await assert.rejects(check(data, { root: temp, auditRoot: root }), /differs from immutable landing source/);
  });
});

test('captured empty policy bytes retain the observed Git blob and SHA-256', async () => {
  await withSource(async temp => {
    await writeFile(resolve(temp, 'review/brand/upstream-allowlist.json'), '{"synthetic":true,"entries":["fixture"]}\n');
    await assert.rejects(check(inventory, { root: temp, auditRoot: root }), /Captured brand allowlist/);
  });
});

test('withdrawal requires removal from source, not just a new inventory status', async () => {
  const asset = structuredClone(inventory); asset.withdrawn.localPaths.push(asset.retainedLandingAssets[0].path);
  await assert.rejects(check(asset), /Withdrawn asset remains/);
  const resource = structuredClone(inventory); resource.withdrawn.resourceUrls.push(resource.projection.resources[0].url);
  await assert.rejects(check(resource), /Withdrawn resource remains/);
});

test('built artifact drift cannot be hidden behind a passing source inventory', async () => {
  await withSource(async temp => {
    const { output } = await buildSite({ repository: temp });
    assert.equal((await check(inventory, { root: temp, auditRoot: root, artifactDir: output })).status, 'PASS_DRAFT');
    await writeFile(resolve(output, 'index.html'), html.replace('--ink:#17140f', '--ink:#000000'));
    await assert.rejects(check(inventory, { root: temp, auditRoot: root, artifactDir: output }), /Artifact hash\/source mismatch/);
  });
});

test('synthetic font withdrawal and rollback rebuild exact source-bound artifacts', async () => {
  await withSource(async temp => {
    const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Synthetic fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: temp, encoding: 'utf8' });
    git(['init', '--quiet']);
    const commitSource = () => { git(['add', 'site']); git(['commit', '--quiet', '-m', 'Synthetic brand source fixture']); return git(['rev-parse', 'HEAD']).trim(); };
    const pin = (data, revision, content) => {
      data.auditedSource.revision = revision;
      data.auditedSource.url = `https://github.com/Jevelopers-neatHack-2026/landing-page-repo/blob/${revision}/site/index.html`;
      data.auditedSource.pageSha256 = digest(content);
      data.projection = inspectBrand(content);
    };
    const baseline = structuredClone(inventory); pin(baseline, commitSource(), html);
    let built = await buildSite({ repository: temp });
    const oldManifest = digest(await readFile(resolve(built.output, 'manifest.json')));
    assert.equal((await check(baseline, { root: temp, artifactDir: built.output })).status, 'PASS_DRAFT');

    // Change only this isolated synthetic fixture; no fonts or public files are fetched.
    const withdrawn = html.replace(/<link\b[^>]*href="https:\/\/fonts\.[^>]*>\n/g, '');
    assert.notEqual(withdrawn, html);
    await writeFile(resolve(temp, 'site/index.html'), withdrawn);
    const update = structuredClone(baseline);
    update.withdrawn.resourceUrls = baseline.projection.resources.filter(resource => resource.kind.startsWith('link:')).map(resource => resource.url);
    pin(update, commitSource(), withdrawn);
    built = await buildSite({ repository: temp });
    assert.equal((await check(update, { root: temp, artifactDir: built.output })).status, 'PASS_DRAFT');
    for (const url of update.withdrawn.resourceUrls) assert.ok(!(await readFile(resolve(built.output, 'index.html'), 'utf8')).includes(url));
    await assert.rejects(check(update, { root: temp, artifactDir: built.output, mode: 'release' }), /Brand release blocked/);

    await writeFile(resolve(temp, 'site/index.html'), html);
    built = await buildSite({ repository: temp });
    assert.equal((await check(baseline, { root: temp, artifactDir: built.output })).status, 'PASS_DRAFT');
    assert.equal(digest(await readFile(resolve(built.output, 'manifest.json'))), oldManifest);
  });
});
