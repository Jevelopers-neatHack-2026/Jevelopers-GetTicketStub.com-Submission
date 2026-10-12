#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, root, sha256 } from './build.mjs';
import { validateArtifact } from './artifact.mjs';
import { readAuditedFile, visibleText } from './suites/content.mjs';

const jsonAt = (repository, revision, path) => JSON.parse(readAuditedFile(repository, revision, path).toString('utf8'));

const namedReferences = Object.freeze({ amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>',
  quot: '"', QUOT: '"', apos: "'", nbsp: '\u00a0', NonBreakingSpace: '\u00a0', Tab: '\t', NewLine: '\n' });
// HTML's legacy names can decode without a semicolon, including as a prefix
// of a longer token in text. Names outside our supported set fail closed.
// List: Python stdlib html.entities.html5 keys without a trailing semicolon.
const legacyReferences = (`AElig AMP Aacute Acirc Agrave Aring Atilde Auml COPY Ccedil ETH Eacute Ecirc Egrave Euml GT
Iacute Icirc Igrave Iuml LT Ntilde Oacute Ocirc Ograve Oslash Otilde Ouml QUOT REG THORN Uacute Ucirc Ugrave Uuml
Yacute aacute acirc acute aelig agrave amp aring atilde auml brvbar ccedil cedil cent copy curren deg divide eacute
ecirc egrave eth euml frac12 frac14 frac34 gt iacute icirc iexcl igrave iquest iuml laquo lt macr micro middot nbsp
not ntilde oacute ocirc ograve ordf ordm oslash otilde ouml para plusmn pound quot raquo reg sect shy sup1 sup2 sup3
szlig thorn times uacute ucirc ugrave uml uuml yacute yen yuml`).split(/\s+/).sort((a, b) => b.length - a.length);
const normalizeText = text => text.replace(/\s+/gu, ' ').trim();

function decodeReferences(text) {
  // One pass: &amp;#80; is literal "&#80;" in HTML, not a recursively decoded P.
  return text.replace(/&(?:#(?:[xX][0-9a-fA-F]+|[0-9]+);?|[A-Za-z][A-Za-z0-9]*;?)/g, token => {
    const body = token.slice(1).replace(/;$/, '');
    if (body.startsWith('#')) {
      const hexadecimal = /^#[xX]/.test(body);
      const codepoint = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      // Reject invalid scalar values and HTML's legacy C1 remapping instead of
      // pretending this bounded checker implements an entire browser parser.
      assert.ok(Number.isInteger(codepoint) && codepoint > 0 && codepoint <= 0x10ffff &&
        !(codepoint >= 0xd800 && codepoint <= 0xdfff) && !(codepoint >= 0x80 && codepoint <= 0x9f),
      'Unsupported HTML character reference: inspect withdrawal output');
      return String.fromCodePoint(codepoint);
    }
    const name = token.endsWith(';') ? body : legacyReferences.find(value => body.startsWith(value));
    if (!name) return token; // No HTML legacy prefix: a raw ampersand/URL key.
    assert.ok(Object.hasOwn(namedReferences, name), 'Unsupported HTML character reference: inspect withdrawal output');
    return namedReferences[name] + body.slice(name.length);
  });
}

function contentViews(file) {
  if (!/\.(?:html?|svg|xml|css|js|mjs|json)$/i.test(file.path)) return [];
  const source = file.bytes.toString('utf8');
  const markup = source.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  // Inspect decoded attributes/source and both joined/separated text. Joining
  // catches a retained word split by inline tags. Strip tags before decoding,
  // so encoded angle brackets that render as text are never mistaken for tags.
  return [source, markup.replace(/<[^>]+>/g, ''), markup.replace(/<[^>]+>/g, ' ')]
    .map(value => normalizeText(decodeReferences(value)));
}

// An exact-content removal check, not an approval or semantic/privacy review.
// The old revision stays immutable; active inventories may remove an item or
// replace it while retaining its original provenance in historical records.
export async function validateWithdrawal({ repository = root, auditRoot = repository, artifactDir, baselineRevision, claimIds = [], assetPaths = [] }) {
  assert.match(baselineRevision || '', /^[a-f0-9]{40}$/, 'Withdrawal baseline must be a full immutable commit SHA');
  assert.ok(claimIds.length + assetPaths.length > 0, 'Select at least one baseline claim ID or asset path');
  assert.equal(new Set(claimIds).size, claimIds.length, 'Duplicate withdrawal claim ID');
  assert.equal(new Set(assetPaths).size, assetPaths.length, 'Duplicate withdrawal asset path');
  const beforeCopy = jsonAt(auditRoot, baselineRevision, 'src/content/copy.json');
  const beforeProof = jsonAt(auditRoot, baselineRevision, 'review/examples.json');
  const beforeHtml = readAuditedFile(auditRoot, baselineRevision, 'site/index.html').toString('utf8');
  assert.equal(sha256(beforeHtml), beforeCopy.pageSha256, 'Baseline copy inventory does not match its source revision');
  assert.equal(sha256(beforeHtml), beforeProof.pageSha256, 'Baseline example inventory does not match its source revision');

  await validateArtifact(repository, artifactDir);
  const manifest = JSON.parse(await readFile(resolve(artifactDir, 'manifest.json'), 'utf8'));
  const payloads = await Promise.all(Object.keys(manifest.files).map(async path => ({ path, bytes: await readFile(resolve(artifactDir, path)) })));
  for (const file of payloads) file.contentViews = contentViews(file);
  const html = payloads.find(file => file.path === 'index.html').bytes.toString('utf8');
  const copy = JSON.parse(await readFile(resolve(repository, 'src/content/copy.json'), 'utf8'));
  const proof = JSON.parse(await readFile(resolve(repository, 'review/examples.json'), 'utf8'));

  for (const id of claimIds) {
    const matches = beforeCopy.entries.filter(entry => entry.id === id);
    assert.equal(matches.length, 1, `Unknown or ambiguous baseline claim: ${id}`);
    const original = matches[0].exactCopy;
    assert.ok(original && (beforeHtml.includes(original) || visibleText(beforeHtml).includes(original)), `Baseline claim has no source occurrence: ${id}`);
    assert.ok(!copy.entries.some(entry => entry.id === id && entry.exactCopy === original), `Withdrawn claim remains in active copy inventory: ${id}`);
    assert.ok(!visibleText(html).includes(original), `Withdrawn claim remains in built page text: ${id}`);
    const originalViews = new Set([normalizeText(original), normalizeText(decodeReferences(original))]);
    for (const file of payloads) {
      assert.ok(!file.bytes.includes(Buffer.from(original)), `Withdrawn claim remains in public payload ${file.path}: ${id}`);
      for (const text of file.contentViews) for (const oldText of originalViews) {
        assert.ok(!text.includes(oldText), `Withdrawn claim remains in decoded public payload ${file.path}: ${id}`);
      }
    }
  }

  for (const path of assetPaths) {
    assert.match(path, /^site\/assets\/[\w.-]+$/, 'Withdrawal asset must be a baseline site/assets path');
    const matches = beforeProof.assets.filter(asset => asset.path === path);
    assert.equal(matches.length, 1, `Unknown or ambiguous baseline asset: ${path}`);
    const original = matches[0];
    const originalBytes = readAuditedFile(auditRoot, baselineRevision, path);
    assert.equal(sha256(originalBytes), original.sha256, `Baseline asset digest differs: ${path}`);
    assert.ok(!proof.assets.some(asset => asset.path === path || asset.sha256 === original.sha256), `Withdrawn asset remains in active example inventory: ${path}`);
    assert.ok(!proof.scenes.some(scene => scene.asset === path), `Withdrawn scene reference remains in active example inventory: ${path}`);
    const publicPath = path.replace(/^site\//, '');
    assert.ok(!Object.hasOwn(manifest.files, publicPath), `Withdrawn asset remains packaged: ${path}`);
    for (const file of payloads) {
      assert.ok(!file.bytes.includes(originalBytes), `Withdrawn asset bytes remain under ${file.path}`);
      assert.ok(!file.bytes.includes(Buffer.from(publicPath)), `Withdrawn asset reference remains in public payload ${file.path}: ${path}`);
      for (const text of file.contentViews) assert.ok(!text.includes(publicPath), `Withdrawn asset reference remains in decoded public payload ${file.path}: ${path}`);
    }
  }
  return { status: 'PASS_LOCAL', baselineRevision, claims: claimIds, assets: assetPaths,
    artifactManifestSha256: sha256(await readFile(resolve(artifactDir, 'manifest.json'))) };
}

export async function main(args = process.argv.slice(2)) {
  let baselineRevision;
  const claimIds = [], assetPaths = [];
  for (let at = 0; at < args.length; at += 2) {
    const option = args[at], value = args[at + 1];
    if (!value || !['--baseline', '--claim', '--asset'].includes(option) || (option === '--baseline' && baselineRevision)) throw new Error('Usage: node scripts/withdrawal.mjs --baseline FULL_SHA [--claim ID] [--asset site/assets/FILE] (repeat --claim/--asset as needed)');
    if (option === '--baseline') baselineRevision = value;
    else if (option === '--claim') claimIds.push(value);
    else assetPaths.push(value);
  }
  assert.match(baselineRevision || '', /^[a-f0-9]{40}$/, 'Withdrawal baseline must be a full immutable commit SHA');
  assert.ok(claimIds.length + assetPaths.length > 0, 'Select at least one baseline claim ID or asset path');
  const { output } = await buildSite();
  console.log(JSON.stringify(await validateWithdrawal({ artifactDir: output, baselineRevision, claimIds, assetPaths }), null, 2));
  console.log('Local exact-content withdrawal verified; owner review, semantic/visual sanitization, deployed removal and cache invalidation remain separate checks.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
