import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateArtifact } from '../artifact.mjs';

export const digest = text => createHash('sha256').update(text).digest('hex');
export const markup = html => html.replace(/<!--[\s\S]*?-->|<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '');
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4]]));
export const text = html => html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt);/g, ' ').replace(/\s+/g, ' ').trim();
const name = (opening, inner) => attrs(opening)['aria-label'] || text(inner);

export function inspectUX(html) {
  const source = markup(html), ids = [...source.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate static element IDs');
  const known = new Set(ids);
  const links = [...source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  assert.ok(links.length, 'Navigation links missing');
  let anchors = 0;
  for (const link of links) {
    const attribute = attrs(link[1]);
    assert.ok(name(link[1], link[2]), 'Link accessible name missing');
    if (attribute.href?.startsWith('#')) { assert.ok(known.has(attribute.href.slice(1)), `Missing anchor target: ${attribute.href}`); anchors++; }
    else assert.ok(attribute.href || /\bhidden\b/.test(link[1]), 'Visible link destination missing');
  }
  const main = source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  assert.ok(main, 'Main landmark missing');
  assert.equal([...source.matchAll(/<main\b/gi)].length, 1, 'Exactly one main landmark required');
  assert.ok(/<nav\b[^>]*aria-label=["'][^"']+["']/i.test(source), 'Named navigation landmark missing');
  assert.ok(/<footer\b/i.test(source), 'Footer landmark missing');
  const headings = [...main.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)];
  assert.equal([...source.matchAll(/<h1\b/gi)].length, 1, 'Exactly one page-level heading required');
  assert.equal(headings[0]?.[1], '1', 'Main content must start with h1');
  let previous = 0;
  for (const heading of headings) {
    assert.ok(name(heading[2], heading[3]), 'Heading accessible name missing');
    const level = Number(heading[1]); assert.ok(level <= previous + 1, 'Main heading hierarchy skips a level'); previous = level;
  }
  const skip = links.find(link => /\bclass=["'][^"']*\bskip\b/.test(link[1]));
  assert.ok(skip && attrs(skip[1]).href?.startsWith('#') && known.has(attrs(skip[1]).href.slice(1)), 'Working skip-link target missing');
  assert.match(html, /\.skip:focus\s*\{/, 'Skip-link focus reveal rule missing');
  assert.match(html, /:focus-visible\s*\{[^}]*outline\s*:/, 'Visible focus outline rule missing');
  const controls = [...source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  for (const control of controls) assert.ok(name(control[1], control[2]), 'Button accessible name missing');
  const labels = [...source.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)];
  const inputs = [...source.matchAll(/<input\b([^>]*)>/gi)].filter(m => attrs(m[1]).type !== 'hidden');
  assert.ok(inputs.length, 'MVP preview input missing');
  for (const input of inputs) {
    const attribute = attrs(input[1]);
    assert.ok(attribute.id, 'Input ID missing');
    assert.ok(attribute['aria-label'] || labels.some(label => attrs(label[1]).for === attribute.id && text(label[2])), 'Input accessible name missing');
    if (attribute['aria-describedby']) for (const id of attribute['aria-describedby'].split(/\s+/)) assert.ok(known.has(id), 'Input description target missing');
  }
  for (const image of source.matchAll(/<img\b([^>]*)>/gi)) assert.ok('alt' in attrs(image[1]), 'Static image alternative missing');
  assert.ok([...source.matchAll(/<meta\b([^>]*)>/gi)].some(m => attrs(m[1]).name === 'viewport' && attrs(m[1]).content?.includes('width=device-width')), 'Device viewport declaration missing');
  assert.match(html, /prefers-reduced-motion\s*:\s*reduce/, 'Reduced-motion source hooks missing');
  assert.match(html, /pointer-events\s*:\s*none[^}]*cursor\s*:\s*default/, 'Decorative rail must not intercept native input');
  const mediaIndependent = text(source.replace(/<(?:img|canvas|svg)\b[^>]*>[\s\S]*?<\/(?:canvas|svg)>|<img\b[^>]*>/gi, ''));
  for (const phrase of ['digital ticket stub keepsake', 'physical printing', 'does not research or verify', 'Illustrative scenes with fictional event details']) assert.ok(mediaIndependent.toLowerCase().includes(phrase.toLowerCase()), `Static explanatory text missing: ${phrase}`);
  const findings = [];
  const firstHeading = source.match(/<h([1-6])\b/i);
  if (firstHeading?.[1] !== '1') findings.push('document-heading-before-h1');
  const footer = source.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/i)?.[1] || '';
  if (/<h4\b/i.test(footer) && !/<h[23]\b/i.test(footer)) findings.push('footer-heading-level-review');
  if (!main.includes('id="maker"')) findings.push('maker-outside-main-landmark');
  if (/\.fin-note\s*\{\s*display:none/.test(html)) findings.push('mobile-status-visibility-review');
  findings.push('browser-screenreader-reflow-performance-not-measured', 'no-js-loader-and-maker-visibility-not-verified');
  return { status: 'PASS_DRAFT', anchors, headings: headings.length, buttons: controls.length, inputs: inputs.length, findings, pageSha256: digest(html) };
}

export default async function run({ root, artifactDir, mode = 'draft' }) {
  assert.ok(['draft', 'release'].includes(mode), 'Unknown UX validation mode');
  await validateArtifact(root, artifactDir);
  const html = await readFile(resolve(artifactDir, 'index.html'), 'utf8');
  const result = inspectUX(html);
  const childEnv = { ...process.env }; delete childEnv.NODE_TEST_CONTEXT;
  const scroll = spawnSync(process.execPath, ['--test', 'tests/scroll.test.mjs'], { cwd: root, env: childEnv, stdio: 'inherit' });
  assert.ok(!scroll.error && scroll.status === 0, 'Actual-source scroll/fallback regressions failed');
  console.log(`ux: source checks and real-handler scroll tests passed; ${result.findings.length} unresolved review/evidence items; browser/WCAG/lab performance not certified`);
  // This bounded implementation has no browser or Lighthouse adapter; absent checks cannot be replaced by receipt strings.
  if (mode === 'release') throw new Error('UX release blocked: actual viewport, keyboard/screen-reader, zoom/reflow, reduced-motion/failure and three-run performance evidence unavailable; see review/ux/README.md');
  return result;
}
