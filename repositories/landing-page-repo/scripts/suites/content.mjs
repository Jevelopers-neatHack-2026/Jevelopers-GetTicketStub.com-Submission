import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const repository = 'Jevelopers-neatHack-2026/landing-page-repo';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Resolve local objects only: replacement refs and lazy network fetching must not
// turn an immutable audit pin into different bytes or an external operation.
export function readAuditedFile(root, revision, path) {
  if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Missing immutable audit source revision');
  const options = { cwd: root, encoding: 'buffer', timeout: 5000, maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' } };
  try {
    const args = ['--no-replace-objects', '-c', 'protocol.allow=never'];
    if (execFileSync('git', [...args, 'cat-file', '-t', revision], options).toString().trim() !== 'commit') throw new Error('Audit revision must identify a commit');
    return execFileSync('git', [...args, 'show', `${revision}:${path}`], options);
  } catch (error) {
    throw new Error(`Immutable audit source unavailable or not a commit: ${revision}:${path}`, { cause: error });
  }
}
export function validateAuditedSource(html, source, pageSha256, { root = repositoryRoot } = {}) {
  if (!source || !/^[a-f0-9]{40}$/.test(source.revision || '')) throw new Error('Missing immutable audit source revision');
  if (source.repository !== repository || source.url !== `https://github.com/${repository}/blob/${source.revision}/site/index.html`) throw new Error('Audit source repository/URL differs from immutable page pin');
  if (!/^[a-f0-9]{64}$/.test(pageSha256 || '')) throw new Error('Missing audited page digest');
  const pinned = readAuditedFile(root, source.revision, 'site/index.html');
  if (digest(pinned) !== pageSha256 || digest(html) !== pageSha256) throw new Error('Audited source bytes differ from current page/inventory digest');
  return pinned.toString('utf8');
}
export function visibleText(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
export function validateContent(html, inventory, { mode = 'draft', now = new Date(), root = repositoryRoot } = {}) {
  if (!['draft', 'release'].includes(mode)) throw new Error('Unknown content validation mode');
  if (inventory.schemaVersion !== 1 || !inventory.entries?.length) throw new Error('Missing copy inventory');
  if (digest(html) !== inventory.pageSha256) throw new Error('Unreviewed source/copy change: refresh inventory and request review');
  if (digest(visibleText(html)) !== inventory.visibleTextSha256) throw new Error('Rendered copy inventory drift');
  validateAuditedSource(html, inventory.auditedSource, inventory.pageSha256, { root });
  const ids = new Set();
  for (const entry of inventory.entries) {
    if (!entry.id || ids.has(entry.id)) throw new Error('Missing/duplicate claim ID');
    ids.add(entry.id);
    for (const key of ['location','exactCopy','evidenceClass','approval','reviewDate','recheckBy','recheckTrigger','source','authorAudit']) if (!entry[key]) throw new Error(`${entry.id}: missing ${key}`);
    if (!visibleText(html).includes(entry.exactCopy) && !html.includes(entry.exactCopy)) throw new Error(`${entry.id}: exact rendered copy missing`);
    if (entry.authorAudit !== 'draft-audited') throw new Error(`${entry.id}: unreviewed claim`);
    if (!['illustrative','simulated','pending','local-preview'].includes(entry.evidenceClass)) throw new Error(`${entry.id}: unsupported evidence class`);
    if (Number.isNaN(Date.parse(entry.reviewDate)) || Number.isNaN(Date.parse(entry.recheckBy)) || Date.parse(entry.reviewDate) > now.getTime() || Date.parse(entry.recheckBy) <= now.getTime()) throw new Error(`${entry.id}: stale or invalid audit date`);
    if (!entry.source.revision?.match(/^[a-f0-9]{40}$/) || !entry.source.url?.includes(entry.source.revision)) throw new Error(`${entry.id}: missing immutable source`);
    if (mode === 'draft' && entry.approval !== 'PENDING') throw new Error(`${entry.id}: this draft cannot assert owner approval`);
    if (mode === 'release' && (entry.approval !== 'APPROVED' || !entry.productApproval || !entry.marketingApproval)) throw new Error(`${entry.id}: product/marketing approval pending`);
  }
  for (const word of ['Illustrative digital preview','printing and shipping pending','does not research or verify','purchase authorization are separate','publication permissions remain unconfirmed']) if (!html.includes(word)) throw new Error(`Visible boundary missing: ${word}`);
  if (/\$\s*9\.99|ships? (?:within|in) 72|Printed on 300|No forms:|drop your ticket and it.s done/i.test(html)) throw new Error('Unsupported price/fulfillment/automation promise');
  return { status: 'PASS_DRAFT', entries: inventory.entries.length, ownerApprovals: 'PENDING' };
}
export default async function run({ root, artifactDir, mode = 'draft' }) {
  const inventory = JSON.parse(await readFile(resolve(root, 'src/content/copy.json'), 'utf8'));
  const html = await readFile(resolve(root, 'site/index.html'), 'utf8');
  const result = validateContent(html, inventory, { mode, root });
  if (artifactDir) validateContent(await readFile(resolve(artifactDir, 'index.html'), 'utf8'), inventory, { mode, root });
  console.log(`content: ${result.status}; ${result.entries} entries; product/marketing approvals PENDING`);
  return result;
}
