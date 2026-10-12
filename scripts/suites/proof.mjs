import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { digest } from './content.mjs';
export const FORBIDDEN = /LP_PRIVATE_(?:BOOKING|EMAIL|ACCOUNT)_CANARY|sk-proj-[A-Za-z0-9]{12,}/;
export function webpChunks(bytes) {
  if (bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WEBP') throw new Error('Invalid WebP asset');
  const chunks = [];
  for (let at=12; at < bytes.length;) {
    if (at + 8 > bytes.length) throw new Error('Truncated WebP metadata');
    const size=bytes.readUInt32LE(at+4); chunks.push(bytes.toString('ascii',at,at+4));
    at += 8 + size + (size % 2);
    if (at > bytes.length) throw new Error('Invalid WebP chunk length');
  }
  return chunks;
}
export async function validateProof({root, manifest, html, mode = 'draft', assetRoot = root, now = new Date()}) {
  if (!['draft','release'].includes(mode)) throw new Error('Unknown proof validation mode');
  if (manifest.schemaVersion !== 1 || manifest.assets?.length !== 10 || manifest.scenes?.length !== 8 || manifest.specimens?.length !== 3) throw new Error('Incomplete example manifest');
  if (Number.isNaN(Date.parse(manifest.recheckBy)) || Date.parse(manifest.recheckBy) <= now.getTime()) throw new Error('Stale example manifest');
  if (digest(html) !== manifest.pageSha256) throw new Error('Example source changed without manifest review');
  if (FORBIDDEN.test(html) || FORBIDDEN.test(JSON.stringify(manifest))) throw new Error('Forbidden synthetic sensitive marker');
  const files = await readdir(resolve(root,'site/assets'));
  if (files.some(file => !manifest.assets.some(a => a.path === `site/assets/${file}`))) throw new Error('Unregistered distributed asset');
  const paths = new Set();
  for (const asset of manifest.assets) {
    if (paths.has(asset.path) || !/^site\/assets\/[\w.-]+$/.test(asset.path)) throw new Error('Duplicate/unsafe asset path');
    paths.add(asset.path);
    for (const key of ['sha256','source','evidenceClass','publicationPermission','rights','sanitization','reviewer','restrictions']) if (!asset[key]) throw new Error(`${asset.path}: missing ${key}`);
    if (mode === 'draft' && (asset.publicationPermission !== 'UNCONFIRMED' || asset.sanitization !== 'PENDING_VISUAL_OWNER_REVIEW')) throw new Error(`${asset.path}: draft must not fabricate publication/sanitization approval`);
    if (mode === 'release' && (asset.publicationPermission !== 'APPROVED' || asset.sanitization !== 'APPROVED' || !asset.approvalReceipt)) throw new Error(`${asset.path}: release permission/sanitization pending`);
    const path = resolve(assetRoot,asset.path);
    if (relative(assetRoot,path).startsWith('..')) throw new Error('Asset escapes root');
    const bytes = await readFile(path); // Missing media is a failed artifact check, not an assumed fallback pass.
    if (digest(bytes) !== asset.sha256) throw new Error(`${asset.path}: asset digest changed`);
    if (FORBIDDEN.test(bytes.toString('utf8'))) throw new Error('Forbidden synthetic sensitive marker');
    if (asset.path.endsWith('.webp') && webpChunks(bytes).some(chunk => ['EXIF','XMP '].includes(chunk))) throw new Error(`${asset.path}: embedded EXIF/XMP requires redaction`);
  }
  for (const scene of manifest.scenes) {
    if (!paths.has(scene.asset) || !scene.alt || !scene.caption || scene.evidenceClass !== 'illustrative' || !html.includes(scene.title)) throw new Error('Uncovered illustrative scene');
  }
  for (const specimen of manifest.specimens) if (!specimen.caption || !specimen.alt || !html.includes(specimen.title) || specimen.productEvidence !== 'NONE_LOCAL_ILLUSTRATION') throw new Error('Uncovered local specimen');
  for (const label of manifest.requiredVisibleLabels) if (!html.includes(label)) throw new Error('Missing proof boundary label');
  if (!html.includes(manifest.fallback.staticDescription)) throw new Error('Readable static specimen description missing');
  if (manifest.fallback.browserMissingMediaCheck !== 'PENDING') throw new Error('No browser missing-media receipt recorded');
  return {status:'PASS_DRAFT', assets:manifest.assets.length, publicationPermission:'UNCONFIRMED', visualReview:'PENDING'};
}
export default async function run({root,artifactDir,mode='draft'}) {
  const manifest=JSON.parse(await readFile(resolve(root,'review/examples.json'),'utf8'));
  const html=await readFile(resolve(root,'site/index.html'),'utf8');
  const result=await validateProof({root,manifest,html,mode});
  if (artifactDir) {
    const artifactHtml=await readFile(resolve(artifactDir,'index.html'),'utf8');
    // Built artifact keeps assets beside index.html rather than under site/.
    for (const asset of manifest.assets) if (digest(await readFile(resolve(artifactDir,asset.path.replace(/^site\//,'')))) !== asset.sha256) throw new Error('Built asset digest drift');
    if (digest(artifactHtml) !== manifest.pageSha256) throw new Error('Built example/copy drift');
  }
  console.log(`proof: ${result.status}; ${result.assets} assets; publication/visual review PENDING`);
  return result;
}
