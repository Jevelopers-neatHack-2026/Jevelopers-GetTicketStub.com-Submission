import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp, mkdir, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import run, { inspectUX, markup, text } from '../scripts/suites/ux.mjs';
import { buildSite, root } from '../scripts/build.mjs';

const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
test('actual MVP source has valid static anchors, named controls and a coherent main heading sequence', () => {
  const result = inspectUX(html);
  assert.equal(result.status, 'PASS_DRAFT'); assert.ok(result.anchors >= 10); assert.ok(result.headings >= 6);
  assert.ok(result.inputs >= 1); assert.ok(result.buttons >= 4);
  assert.ok(result.findings.includes('browser-screenreader-reflow-performance-not-measured'));
  assert.ok(result.findings.includes('document-heading-before-h1'));
});
test('missing anchor targets reject the actual source fixture', () => assert.throws(() => inspectUX(html.replace('href="#scenes"', 'href="#not-a-real-section"')), /Missing anchor/));
test('duplicate static IDs fail, including the CTA target', () => assert.throws(() => inspectUX(html.replace('</main>', '<div id="make"></div></main>')), /Duplicate static/));
test('empty link names fail even when its target exists', () => assert.throws(() => inspectUX(html.replace(/(<a class="skip"[^>]*>)[\s\S]*?<\/a>/, '$1</a>')), /Link accessible name/));
test('a visible link without destination fails', () => assert.throws(() => inspectUX(html.replace('href="#scenes"', 'data-lost-href="#scenes"')), /Visible link destination/));
test('duplicate h1 cannot pass a heading count check', () => assert.throws(() => inspectUX(html.replace('</main>', '<h1>Duplicate</h1></main>')), /page-level heading/));
test('main heading jumps fail while existing whole-document review remains pending', () => assert.throws(() => inspectUX(html.replace('<h2>The event ends.', '<h4>The event ends.').replace('hold onto.</em></h2>', 'hold onto.</em></h4>')), /heading hierarchy/));
test('empty heading names fail', () => assert.throws(() => inspectUX(html.replace(/<h2>The event ends\.[\s\S]*?<\/h2>/, '<h2></h2>')), /Heading accessible name/));
test('missing named navigation or main landmark fails', () => {
  assert.throws(() => inspectUX(html.replace('aria-label="Main"', 'data-removed-label="Main"')), /Named navigation/);
  assert.throws(() => inspectUX(html.replace('<main id="top">', '<div id="top">').replace('</main>', '</div>')), /Main landmark/);
});
test('preview input needs a real label, not only a placeholder', () => assert.throws(() => inspectUX(html.replace(/<label\b[^>]*for="ev"[^>]*>[\s\S]*?<\/label>/, '')), /Input accessible name/));
test('missing description target fails', () => assert.throws(() => inspectUX(html.replace('aria-describedby="finNote"', 'aria-describedby="nonexistent"')), /description target/));
test('empty example button name fails', () => assert.throws(() => inspectUX(html.replace(/(<button\b[^>]*data-demo="gulls"[^>]*>)[\s\S]*?<\/button>/, '$1</button>')), /Button accessible name/));
test('missing focus or reduced-motion source hook fails without asserting browser behavior', () => {
  assert.throws(() => inspectUX(html.replace(/:focus-visible/g, ':focus-removed')), /focus outline/);
  assert.throws(() => inspectUX(html.replace(/prefers-reduced-motion/g, 'motion-query-removed')), /Reduced-motion/);
});
test('static explanation survives removing media and executable code as text evidence only', () => {
  const noMedia = html.replace(/<img\b[^>]*>/gi, '').replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, '');
  assert.equal(inspectUX(noMedia).status, 'PASS_DRAFT');
  const plain = text(markup(noMedia)); assert.ok(plain.includes('Illustrative scenes with fictional event details'));
  assert.ok(plain.includes('physical printing'));
});
test('image alternatives and media-independent explanation cannot be silently removed', () => {
  assert.throws(() => inspectUX(html.replace('</main>', '<img src="assets/fan-clean.webp"></main>')), /image alternative/);
  assert.throws(() => inspectUX(html.replace('does not research or verify', 'verified automatically')), /Static explanatory text/);
});
test('local group and non-submitting button remain compatible with a deferred external destination', () => {
  // Semantic fixture from the current page, not an invented provider or conversion outcome.
  const local = html.replace(/<form\b([^>]*)id="maker"([^>]*)>/, '<div role="group"$1id="maker"$2>').replace('</form>', '</div>').replace('name="link" ', '').replace('type="submit"', 'type="button"');
  assert.equal(inspectUX(local).status, 'PASS_DRAFT');
});
test('real built artifact cannot claim UX release from local source checks alone', async () => {
  const repository = await mkdtemp(resolve(tmpdir(), 'lp-ux-test-'));
  try {
    await cp(resolve(root, 'site'), resolve(repository, 'site'), { recursive: true });
    await mkdir(resolve(repository, 'tests'));
    await cp(resolve(root, 'tests/scroll.test.mjs'), resolve(repository, 'tests/scroll.test.mjs'));
    const { output } = await buildSite({ repository });
    await assert.rejects(run({ root: repository, artifactDir: output, mode: 'release' }), /actual viewport.*performance evidence unavailable/);
  } finally { await rm(repository, { recursive: true, force: true }); }
});
