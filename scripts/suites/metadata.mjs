import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateContent } from './content.mjs';

const environments = ['preview', 'demo', 'staging', 'production'];
const approvalKeys = ['origin', 'indexing', 'copy', 'social', 'structuredData'];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
export function productionOrigin(value) {
  assert(typeof value === 'string', 'Production origin pending: app/hosting owner must supply it');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid production origin'); }
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === '/' && value === url.origin, 'Production origin must be an exact HTTPS origin, without credentials, port, path, query or fragment');
  assert(/^[a-z0-9.-]+$/.test(url.hostname) && url.hostname.includes('.') && url.hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) && !/^\d+(?:\.\d+){3}$/.test(url.hostname), 'Private/local/IP origin forbidden');
  assert(!/(?:^|[.-])(?:preview|demo|staging|stage|dev|test|localhost|local|internal)(?:[.-]|$)/i.test(url.hostname) && !/\.(?:vercel\.app|netlify\.app|pages\.dev|local|internal|test)$/.test(url.hostname), 'Preview/private origin forbidden');
  return url.origin;
}
function approved(record, key, decision) {
  assert(record?.status === 'APPROVED', `${key} approval pending`);
  const receipt = record.receipt;
  assert(receipt?.decision === decision, `${key}: approval receipt does not match current policy decision`);
  assert(receipt?.reviewer && Number.isFinite(Date.parse(receipt.reviewedAt)) && /^[a-f0-9]{40}$/.test(receipt.sourceRevision || '') && /^https:\/\/github\.com\/[^\s?#]+$/.test(receipt.url || '') && receipt.url.includes(receipt.sourceRevision), `${key}: owner receipt must pin reviewer, date and immutable source`);
}
export function environmentOutput(policy, environment = policy.environment) {
  assert(policy.schemaVersion === 1 && environments.includes(environment), 'Unknown metadata environment/schema');
  assert(JSON.stringify(policy.routes) === '["/"]', 'Private, anchor or nonexistent route in metadata inventory; only actual homepage / is allowed');
  assert(policy.language === 'en' && policy.title && policy.description, 'Required language/title/description missing');
  assert(policy.socialImage?.state === 'omitted-pending-rights' && policy.socialImage.reason && !policy.socialImage.url, 'Unapproved social image: omission reason required');
  assert(policy.structuredData?.state === 'omitted' && policy.structuredData.reason, 'Structured data omission decision required');
  let canonical = null;
  let index = false;
  if (environment === 'production') {
    const origin = productionOrigin(policy.production?.origin);
    assert(['index', 'noindex'].includes(policy.production?.indexing), 'Production indexing decision pending');
    const decisions = { origin, indexing: policy.production.indexing, copy: JSON.stringify([policy.title, policy.description]), social: policy.socialImage.state, structuredData: policy.structuredData.state };
    for (const key of approvalKeys) approved(policy.approvals?.[key], key, decisions[key]);
    canonical = `${origin}/`;
    index = policy.production.indexing === 'index';
  }
  return {
    canonical,
    fields: {
      description: policy.description, robots: index ? 'index,follow' : 'noindex,nofollow',
      'og:type': 'website', 'og:title': policy.title, 'og:description': policy.description,
      'twitter:card': 'summary', 'twitter:title': policy.title, 'twitter:description': policy.description,
      ...(canonical ? { 'og:url': canonical } : {}),
    },
    // Host integration proposal/fixtures only. These are not served or added to dist by this suite.
    robots: index ? `User-agent: *\nAllow: /\nSitemap: ${canonical}sitemap.xml\n` : 'User-agent: *\nDisallow: /\n',
    sitemap: index ? `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${canonical}</loc></url></urlset>\n` : null,
  };
}
function attributes(tag) {
  const output = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const key = match[1].toLowerCase();
    assert(!(key in output), `Duplicate attribute ${key}`);
    output[key] = match[2] ?? match[3] ?? match[4];
  }
  return output;
}
export function validateMetadataHtml(html, policy, inventory, { environment = policy.environment } = {}) {
  const expected = environmentOutput(policy, environment);
  const heads = [...html.matchAll(/<head\b[^>]*>([\s\S]*?)<\/head>/gi)];
  assert(heads.length === 1 && (html.match(/<body\b/gi) || []).length === 1 && html.indexOf('</head>') < html.search(/<body\b/i), 'One complete head must precede body');
  const head = heads[0][1];
  const headStart = heads[0].index, headEnd = headStart + heads[0][0].length;
  for (const match of html.matchAll(/<(?:title|meta|link)\b[^>]*>/gi)) {
    const a = attributes(match[0]);
    if (/^<(?:title|meta)\b/i.test(match[0]) || a.rel === 'canonical') assert(match.index > headStart && match.index < headEnd, 'Metadata outside head');
  }
  const titles = [...head.matchAll(/<title>([^<]*)<\/title>/gi)];
  assert(titles.length === 1 && titles[0][1] === policy.title, 'Missing, duplicate or inconsistent title');
  const htmlTag = html.match(/<html\b[^>]*>/i);
  assert(htmlTag && attributes(htmlTag[0]).lang === policy.language, 'Missing or inconsistent language');
  const metas = new Map();
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(match[0]), name = a.name || a.property;
    if (!name) continue;
    assert(!metas.has(name), `Duplicate metadata ${name}`);
    metas.set(name, a.content);
  }
  const managed = [...metas.keys()].filter(name => name === 'description' || name === 'robots' || /^(?:og:|twitter:)/.test(name));
  assert(JSON.stringify(managed.sort()) === JSON.stringify(Object.keys(expected.fields).sort()), 'Unexpected or missing social/URL metadata; unapproved images are forbidden');
  for (const [key, value] of Object.entries(expected.fields)) {
    assert(metas.get(key) === value, `Inconsistent metadata ${key}`);
    if (key === 'og:url') continue;
    const entry = inventory.entries.find(item => item.id === policy.copyIds?.[key]);
    assert(entry?.exactCopy === value && entry.approval === 'PENDING', `Unrecorded or unapproved draft metadata ${key}`);
  }
  const titleEntry = inventory.entries.find(item => item.id === policy.copyIds?.title);
  assert(titleEntry?.exactCopy === policy.title && titleEntry.approval === 'PENDING', 'Unrecorded draft title');
  const canonicals = [...head.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0])).filter(a => a.rel === 'canonical');
  assert(expected.canonical ? canonicals.length === 1 && canonicals[0].href === expected.canonical : canonicals.length === 0, 'Preview canonical leakage or invalid canonical URL');
  assert(!/<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(html), 'Unsupported structured data must remain omitted');
  return expected;
}
export default async function run({ root, artifactDir, mode = 'release' }) {
  const policy = JSON.parse(await readFile(resolve(root, 'src/content/metadata.json'), 'utf8'));
  const inventory = JSON.parse(await readFile(resolve(root, 'src/content/copy.json'), 'utf8'));
  const html = await readFile(resolve(root, 'site/index.html'), 'utf8');
  validateContent(html, inventory, { mode: 'draft' });
  validateMetadataHtml(html, policy, inventory);
  if (artifactDir) validateMetadataHtml(await readFile(resolve(artifactDir, 'index.html'), 'utf8'), policy, inventory);
  const tests = spawnSync(process.execPath, ['--test', 'tests/metadata.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (tests.error || tests.status !== 0) throw new Error(tests.error?.message || `Metadata tests exited ${tests.status}`);
  if (mode === 'release') {
    environmentOutput(policy, 'production');
    throw new Error('Production source/host integration and LP-08 approval evidence pending; fixture output does not enable publication');
  }
  assert(mode === 'draft' && policy.environment === 'preview', 'Actual source must use explicit preview metadata in draft mode');
  console.log('metadata: static preview head verified; canonical/image/structured data omitted; production origin/indexing/copy/social approvals PENDING');
  return { status: 'PASS_DRAFT' };
}
