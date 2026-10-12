import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { sourceFiles } from '../build.mjs';
import { validateArtifact } from '../artifact.mjs';
import { digest, readAuditedFile } from './content.mjs';

const landingRepository = 'Jevelopers-neatHack-2026/landing-page-repo';
const brandRepository = 'Jevelopers-neatHack-2026/brand-kit';
const fontFile = /\.(?:woff2?|ttf|otf|eot)$/i;
const same = (actual, expected, message) => assert.deepEqual(actual, expected, message);
const sorted = values => [...values].sort();
const sourceUrl = (repository, revision, path) => `https://github.com/${repository}/blob/${revision}/${path}`;

function attributes(source) {
  const result = {};
  for (const match of source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const key = match[1].toLowerCase();
    assert.ok(!(key in result), `Duplicate resource attribute: ${key}`);
    result[key] = (match[2] ?? match[3] ?? match[4]).replace(/&amp;/g, '&');
  }
  return result;
}

// This is a bounded inventory of the existing static page, not a CSS/HTML parser
// or a browser/network/visual approval. Whole executable privacy belongs to LP-07.
export function inspectBrand(html) {
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map(match => match[1].replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
  assert.ok(!/@font-face\b|@import\b/i.test(styles), 'Unreviewed font hosting or CSS import');
  const roots = [...styles.matchAll(/:root\s*\{([^}]*)\}/g)].map(match => match[1]);
  const rootTokens = roots.flatMap(block => [...block.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)]
    .map(match => [match[1], match[2].trim()]));
  assert.ok(rootTokens.length, 'Missing local token declarations');
  const tokenNames = new Set(rootTokens.map(([name]) => name));
  const declarations = [...styles.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)]
    .filter(match => tokenNames.has(match[1]) || match[1].startsWith('--ts-'))
    .map(match => [match[1], match[2].trim()]);
  const fonts = [...styles.matchAll(/font-family\s*:\s*([^;{}]+)/g)].map(match => match[1].trim());
  const symbols = [...html.matchAll(/<symbol\b([^>]*)>[\s\S]*?<\/symbol>/gi)]
    .map(match => ({ id: attributes(match[1]).id, sha256: digest(match[0]) }));
  assert.ok(symbols.length && symbols.every(symbol => symbol.id), 'Missing inline brand symbol');
  assert.equal(new Set(symbols.map(symbol => symbol.id)).size, symbols.length, 'Duplicate inline brand symbol');
  const symbolUses = [...html.matchAll(/<use\b([^>]*)\/?\s*>/gi)].map(match => attributes(match[1]).href);
  const resources = [];
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = attributes(match[1]);
    if (attrs.rel !== 'canonical') resources.push({ kind: `link:${attrs.rel}`, url: attrs.href, attributes: attrs });
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = attributes(match[1]);
    if (attrs.src) resources.push({ kind: 'script', url: attrs.src, attributes: attrs });
    if (attrs.type === 'importmap') {
      const map = JSON.parse(match[2]);
      same(Object.keys(map), ['imports'], 'Unreviewed import-map structure');
      for (const [name, url] of Object.entries(map.imports)) resources.push({ kind: `import:${name}`, url });
    }
  }
  for (const match of styles.matchAll(/url\(\s*["']?((?:https?:|\/\/)[^"')\s]+)/gi)) {
    resources.push({ kind: 'css-url', url: match[1] });
  }
  for (const resource of resources) {
    assert.equal(typeof resource.url, 'string', 'Missing resource URL');
    const url = new URL(resource.url);
    assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash,
      'Unsafe or unreviewed resource URL');
  }
  return { rootTokens, declarations, fonts, symbols, symbolUses, resources };
}

export async function validateBrand({ root, artifactDir, inventory, mode = 'draft', now = new Date(), auditRoot = root }) {
  assert.ok(['draft', 'release'].includes(mode), 'Unknown brand validation mode');
  assert.equal(inventory.schema, 'ticketstub.landing-brand-inventory/1', 'Missing brand inventory');
  assert.equal(inventory.status, 'PROVISIONAL_UNAPPROVED', 'Local inventory cannot grant brand approval');
  same(inventory.importedBrandFiles, [], 'Approved brand import contract is unavailable');
  same(inventory.approvals, { brand: 'PENDING', publication: 'PENDING', consumerContract: 'PENDING', visual: 'PENDING' },
    'Draft brand inventory cannot manufacture approval');
  const { reviewedAt, recheckBy } = inventory.audit;
  assert.ok(Number.isFinite(Date.parse(reviewedAt)) && Number.isFinite(Date.parse(recheckBy)) &&
    Date.parse(reviewedAt) <= now.getTime() && Date.parse(recheckBy) > now.getTime() && Date.parse(recheckBy) > Date.parse(reviewedAt),
    'Brand inventory is stale or has an invalid review date');
  same(inventory.audit.recheckTriggers, ['source-change', 'brand-release-or-revocation', 'font-policy-change', 'before-publication'],
    'Brand freshness triggers are incomplete');
  assert.equal(inventory.fontPolicy.selfHosted, false, 'Self-hosted fonts are not authorized');
  assert.equal(inventory.fontPolicy.providerApproval, 'PENDING', 'External-font declaration is not provider approval');

  const source = inventory.auditedSource;
  assert.equal(source.repository, landingRepository, 'Wrong landing source repository');
  assert.equal(source.url, sourceUrl(landingRepository, source.revision, 'site/index.html'), 'Mismatched landing source URL');
  const pinnedHtml = readAuditedFile(auditRoot, source.revision, 'site/index.html').toString('utf8');
  assert.equal(digest(pinnedHtml), source.pageSha256, 'Pinned landing page digest mismatch');
  same(inspectBrand(pinnedHtml), inventory.projection, 'Brand inventory differs from its immutable landing source');
  const html = await readFile(resolve(root, 'site/index.html'), 'utf8');
  same(inspectBrand(html), inventory.projection, 'Local brand tokens, symbols, fonts or resource declarations changed without review');

  const upstream = inventory.upstream;
  assert.equal(upstream.repository, brandRepository, 'Wrong brand source repository');
  assert.match(upstream.revision, /^[a-f0-9]{40}$/, 'Brand source requires an immutable commit');
  assert.equal(upstream.approvedArtifact, null, 'No approved distribution artifact has been supplied');
  assert.equal(upstream.consumerContract, null, 'No accepted brand consumer contract has been supplied');
  const paths = new Set();
  for (const record of upstream.sources) {
    assert.match(record.path, /^(?:docs|provenance|tokens)\/[a-zA-Z0-9/_.-]+$/, 'Unsafe upstream source path');
    assert.ok(!record.path.split('/').includes('..') && !paths.has(record.path), 'Duplicate/unsafe upstream source path');
    paths.add(record.path);
    assert.equal(record.url, sourceUrl(brandRepository, upstream.revision, record.path), 'Unpinned upstream source URL');
    assert.match(record.sha256, /^[a-f0-9]{64}$/, 'Missing upstream source digest');
    assert.match(record.gitBlobSha, /^[a-f0-9]{40}$/, 'Missing upstream Git blob identity');
  }
  for (const path of ['provenance/allowlist.json', 'tokens/tokens.json', 'tokens/tokens.css', 'tokens/external-fonts-google.css', 'docs/logo.md', 'docs/imagery.md']) {
    assert.ok(paths.has(path), `Missing upstream source observation: ${path}`);
  }
  const allowlistRecord = upstream.sources.find(record => record.path === 'provenance/allowlist.json');
  // This small policy snapshot is evidence only; the build excludes review/.
  const captured = await readFile(resolve(root, 'review/brand/upstream-allowlist.json'));
  assert.equal(captured.length, allowlistRecord.bytes, 'Captured brand allowlist length changed');
  assert.equal(digest(captured), allowlistRecord.sha256, 'Captured brand allowlist digest changed');
  const blobSha = createHash('sha1').update(Buffer.from(`blob ${captured.length}\0`)).update(captured).digest('hex');
  assert.equal(blobSha, allowlistRecord.gitBlobSha, 'Captured policy differs from observed upstream Git blob');
  const allowlist = JSON.parse(captured);
  assert.equal(allowlist.synthetic, false, 'Synthetic upstream policy cannot authorize brand consumption');
  assert.equal(allowlist.status, 'empty', 'Changed upstream distribution requires a new consumer review');
  same(allowlist.entries, [], 'Unreviewed upstream distribution entry');

  const tokenEntries = new Map(inventory.projection.rootTokens);
  same(sorted(inventory.aliases.map(alias => alias.local)), sorted(tokenEntries.keys()), 'Local token alias coverage differs');
  assert.equal(new Set(inventory.aliases.map(alias => alias.local)).size, inventory.aliases.length, 'Duplicate local alias');
  for (const alias of inventory.aliases) {
    assert.equal(alias.observedValue, tokenEntries.get(alias.local), 'Token observation differs from source');
    assert.ok(['same-value', 'adapted', 'local-only'].includes(alias.relationship) && alias.note, 'Missing token adaptation disposition');
    if (alias.relationship === 'local-only') assert.equal(alias.upstreamPath, null, 'Local adaptation is not an upstream token');
    else assert.ok(alias.upstreamPath && alias.upstreamValue !== undefined, 'Missing observed upstream token mapping');
    if (alias.relationship === 'same-value') {
      const normalize = value => String(value).replace(/\s+/g, '').toLowerCase();
      assert.equal(normalize(alias.observedValue), normalize(alias.upstreamValue), 'Claimed matching token differs from observed upstream value');
    }
  }
  same(sorted(inventory.inlineMarks.map(mark => mark.id)), sorted(inventory.projection.symbols.map(symbol => symbol.id)), 'Inline mark coverage differs');
  for (const mark of inventory.inlineMarks) {
    assert.equal(mark.permission, 'UNCONFIRMED', 'Inline source availability is not logo permission');
    assert.equal(mark.originMatch, 'UNVERIFIED', 'Inline artwork must not claim verified upstream derivation');
  }

  const files = await sourceFiles(resolve(root, 'site'));
  assert.ok(!files.some(path => fontFile.test(path)), 'Self-hosted font in public output');
  const records = inventory.retainedLandingAssets;
  assert.equal(new Set(records.map(record => record.path)).size, records.length, 'Duplicate retained asset');
  same(sorted(files.filter(path => path !== 'index.html')), sorted(records.map(record => record.path)), 'Unreviewed or withdrawn public asset');
  for (const record of records) {
    assert.match(record.path, /^assets\/[a-zA-Z0-9_.-]+$/, 'Unsafe retained asset path');
    assert.equal(record.permission, 'UNCONFIRMED', 'Retained illustration is not publication permission');
    const bytes = await readFile(resolve(root, 'site', record.path));
    assert.equal(digest(bytes), record.sha256, 'Retained landing asset digest changed');
    assert.equal(digest(readAuditedFile(auditRoot, source.revision, `site/${record.path}`)), record.sha256,
      'Retained asset differs from immutable landing source');
  }
  for (const path of inventory.withdrawn.localPaths) assert.ok(!files.includes(path), 'Withdrawn asset remains in public source');
  for (const url of inventory.withdrawn.resourceUrls) assert.ok(!inventory.projection.resources.some(resource => resource.url === url),
    'Withdrawn resource remains in public source');
  if (artifactDir) {
    await validateArtifact(root, artifactDir);
    same(inspectBrand(await readFile(resolve(artifactDir, 'index.html'), 'utf8')), inventory.projection, 'Built brand projection changed');
  }
  if (mode === 'release') throw new Error('Brand release blocked: upstream publishable subset is empty; BK-03B #14 distribution/font decision, BK-09 #15 consumer contract, and actual brand/publication/visual approval are pending');
  return { status: 'PASS_DRAFT', assets: records.length, importedBrandFiles: 0, publicationPermission: 'PENDING' };
}

export default async function run({ root, artifactDir, mode = 'draft' }) {
  const inventory = JSON.parse(await readFile(resolve(root, 'review/brand-inventory.json'), 'utf8'));
  const result = await validateBrand({ root, artifactDir, inventory, mode });
  console.log(`brand: ${result.assets} retained local assets; zero approved imports; source/URL/token inventory checked; publication and visual review PENDING`);
  return result;
}
