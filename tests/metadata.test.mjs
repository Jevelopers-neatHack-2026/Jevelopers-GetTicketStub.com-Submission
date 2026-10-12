import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createPreview } from '../scripts/preview.mjs';
import { buildSite } from '../scripts/build.mjs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { environmentOutput, productionOrigin, validateMetadataHtml } from '../scripts/suites/metadata.mjs';
const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const policy = JSON.parse(await readFile(new URL('../src/content/metadata.json', import.meta.url), 'utf8'));
const inventory = JSON.parse(await readFile(new URL('../src/content/copy.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
// Entirely synthetic receipts/origin exercise the policy; they are not approval evidence.
function production(indexing = 'index') {
  const fixture = clone(policy);
  fixture.production = { origin: 'https://public.example.org', indexing };
  const decisions = { origin: fixture.production.origin, indexing, copy: JSON.stringify([fixture.title, fixture.description]), social: fixture.socialImage.state, structuredData: fixture.structuredData.state };
  for (const [key, record] of Object.entries(fixture.approvals)) {
    record.status = 'APPROVED';
    record.receipt = { decision: decisions[key], reviewer: 'SYNTHETIC_OWNER_FIXTURE', reviewedAt: '2026-10-12T00:00:00Z', sourceRevision: 'a'.repeat(40), url: `https://github.com/example/fixture/commit/${'a'.repeat(40)}` };
  }
  return fixture;
}
test('actual static HTML has one valid head and consistent inventoried preview/social copy', () => assert.equal(validateMetadataHtml(html, policy, inventory).canonical, null));
test('preview, demo and staging never inherit production canonical, indexing or sitemap', () => {
  for (const environment of ['preview', 'demo', 'staging']) {
    const result = environmentOutput(production(), environment);
    assert.equal(result.fields.robots, 'noindex,nofollow');
    assert.equal(result.canonical, null); assert.equal(result.sitemap, null);
    assert.equal(result.robots, 'User-agent: *\nDisallow: /\n');
  }
});
test('synthetic approved production index/noindex fixtures enforce exact origin and real homepage inventory', () => {
  const index = environmentOutput(production(), 'production');
  assert.equal(index.canonical, 'https://public.example.org/');
  assert.equal(index.fields['og:url'], index.canonical);
  assert.equal(index.fields.robots, 'index,follow');
  assert.equal((index.sitemap.match(/<loc>/g) || []).length, 1);
  assert.ok(index.sitemap.includes('<loc>https://public.example.org/</loc>'));
  assert.ok(index.robots.includes('Sitemap: https://public.example.org/sitemap.xml'));
  const noindex = environmentOutput(production('noindex'), 'production');
  assert.equal(noindex.sitemap, null); assert.equal(noindex.fields.robots, 'noindex,nofollow');
});
test('production rejects missing origin, undecided indexing and every pending/missing owner receipt', () => {
  assert.throws(() => environmentOutput(policy, 'production'), /origin pending/);
  const undecided = production(); undecided.production.indexing = null;
  assert.throws(() => environmentOutput(undecided, 'production'), /indexing decision pending/);
  for (const key of Object.keys(policy.approvals)) {
    const pending = production(); pending.approvals[key].status = 'PENDING';
    assert.throws(() => environmentOutput(pending, 'production'), /approval pending/);
    const missing = production(); missing.approvals[key].receipt = null;
    assert.throws(() => environmentOutput(missing, 'production'), /receipt/);
  }
});
test('production origin rejects preview hosts, private addresses and malformed/credential/query/path URLs', () => {
  for (const origin of ['https://demo.example.org','https://preview.example.org','https://staging.example.org','https://project.vercel.app','https://project.netlify.app','https://project.pages.dev','https://localhost','https://127.0.0.1','https://10.0.0.1','https://[::1]','https://app.internal','https://public..example.org','https://-public.example.org','https://public.example.org.','http://public.example.org','https://name:pass@public.example.org','https://public.example.org/','https://public.example.org/private','https://public.example.org?key=value','https://public.example.org#top','https://public.example.org:8443','//public.example.org','invalid']) assert.throws(() => productionOrigin(origin), undefined, origin);
});
test('private app routes, aliases and section anchors cannot become indexable pages', () => {
  for (const route of ['/signin','/admin','/api/health','/studio/private','/index.html','/#studio','#how']) {
    const bad = production(); bad.routes.push(route);
    assert.throws(() => environmentOutput(bad, 'production'), /route in metadata inventory/);
  }
});
test('head placement, duplicate and missing metadata regression fixtures fail', () => {
  assert.throws(() => validateMetadataHtml(html.replace('</style>\n<title>', '</style></head><body>\n<title>'), policy, inventory), /head|outside/);
  assert.throws(() => validateMetadataHtml(html.replace('</head>', '<meta name="robots" content="index,follow"></head>'), policy, inventory), /Duplicate/);
  assert.throws(() => validateMetadataHtml(html.replace('<meta name="twitter:card" content="summary">', ''), policy, inventory), /missing social/);
  assert.throws(() => validateMetadataHtml(html.replace('lang="en"', 'lang="fr"'), policy, inventory), /language/);
});
test('canonical/image/structured data leakage and missing ledger entries fail', () => {
  for (const extra of ['<link rel="canonical" href="https://preview.example.org/">','<meta property="og:url" content="https://preview.example.org/">','<meta property="og:image" content="https://public.example.org/private.webp">','<script type="application/ld+json">{"aggregateRating":{"ratingValue":5}}</script>']) assert.throws(() => validateMetadataHtml(html.replace('</head>', `${extra}</head>`), policy, inventory), /canonical|social|structured/);
  const bad = clone(inventory); bad.entries = bad.entries.filter(item => item.id !== 'LP-META-04');
  assert.throws(() => validateMetadataHtml(html, policy, bad), /Unrecorded/);
});
test('invalid environments and unsupported image/structured decisions fail', () => {
  assert.throws(() => environmentOutput(policy, 'prod'), /Unknown/);
  const image = clone(policy); image.socialImage = { state: 'approved', url: 'not-a-url' };
  assert.throws(() => environmentOutput(image), /Unapproved social image/);
  const data = clone(policy); data.structuredData = { state: 'present' };
  assert.throws(() => environmentOutput(data), /omission/);
});

test('loopback served artifact contains static metadata without JS and exposes no sitemap/robots/private route', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  await mkdir(resolve(root, 'dist'), { recursive: true });
  const output = await mkdtemp(resolve(root, 'dist/metadata-http-'));
  const server = createPreview({ artifactDir: output });
  try {
    await buildSite({ repository: root, output });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    validateMetadataHtml(await page.text(), policy, inventory);
    for (const path of ['/sitemap.xml', '/robots.txt', '/signin', '/admin', '/api/health']) assert.equal((await fetch(`${origin}${path}`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(output, { recursive: true, force: true });
  }
});

test('approval receipts cannot silently authorize a changed origin or indexing decision', () => {
  const changed = production(); changed.production.origin = 'https://other.example.org';
  assert.throws(() => environmentOutput(changed, 'production'), /does not match/);
  const indexing = production(); indexing.production.indexing = 'noindex';
  assert.throws(() => environmentOutput(indexing, 'production'), /does not match/);
});
