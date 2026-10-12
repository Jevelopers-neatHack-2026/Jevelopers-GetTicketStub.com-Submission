import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
// Root's source-pinned Chrome observations: same logo/CTA fonts and artwork as this CSS-only fix.
// This source/layout arithmetic guard is not a browser engine or full reflow certification.
const logoWidth = 196.03125, ctaWidth = 178.25;
function narrowHeaderRules(source, viewport) {
  const blocks = [];
  for (const match of source.matchAll(/@media \(max-width:440px\)\{/g)) {
    let depth = 1, end = match.index + match[0].length;
    for (; end < source.length && depth; end++) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; }
    blocks.push(source.slice(match.index, end));
  }
  assert.ok(blocks.length, 'Existing narrow-header breakpoint missing');
  const body = viewport <= 440 ? blocks.join('\n') : '';
  const declarations = selector => Object.fromEntries((body.match(new RegExp(`${selector.replaceAll('.', '\\.') }\\{([^}]+)\\}`))?.[1] || '').split(';').filter(Boolean).map(item => item.split(':').map(s => s.trim())));
  return { nav: declarations('.nav'), cta: declarations('.navcta.cta'), hero: declarations('.hero'), finale: declarations('.finale') };
}
function headerGeometry(source, viewport, clientWidth) {
  const { nav, cta } = narrowHeaderRules(source, viewport);
  // Read the real gutter contract, rather than hiding the measured overflow.
  const gutter = source.match(/--gutter:clamp\((\d+)px,([\d.]+)vw,(\d+)px\)/);
  assert.ok(gutter, 'Gutter source contract missing');
  const padding = Math.max(Number(gutter[1]), Math.min(viewport * Number(gutter[2]) / 100, Number(gutter[3])));
  const available = clientWidth - padding * 2, gap = parseFloat(nav.gap || '0');
  const wraps = nav['flex-wrap'] === 'wrap' && logoWidth + gap + ctaWidth > available;
  const ctaLeft = wraps && cta['margin-left'] === 'auto' ? clientWidth - padding - ctaWidth : padding + logoWidth + gap;
  return { wraps, available, logoRight: padding + logoWidth, ctaLeft, ctaRight: ctaLeft + ctaWidth, ctaCanFit: ctaWidth <= available, logoCanFit: logoWidth <= available };
}
test('narrow header fits both measured controls at 320/375 including gutters', () => {
  for (const [viewport, client] of [[320, 305], [375, 360]]) {
    const result = headerGeometry(html, viewport, client);
    assert.equal(result.wraps, true);
    assert.ok(result.logoCanFit && result.ctaCanFit);
    assert.ok(result.logoRight <= client - 16 && result.ctaLeft >= 16 && result.ctaRight <= client - 16);
    assert.equal(narrowHeaderRules(html, viewport).cta['flex-shrink'], '0', 'Preserve readable intrinsic CTA width');
    const rules = narrowHeaderRules(html, viewport), twoRowHeight = 14 + 30 + 8 + 33.375 + 14;
    for (const selector of ['hero', 'finale']) assert.ok(Number(rules[selector]['padding-top']?.match(/calc\((\d+)px/)?.[1]) > twoRowHeight, 'Following content must clear both header rows');
    assert.equal(rules.finale['overflow-y'], 'auto', 'Maker content remains reachable below the taller header');
  }
});
test('removing the wrap rule reproduces the measured 320/375 overflow control', () => {
  const noWrap = html.replace('.nav{flex-wrap:wrap;gap:8px}', '.nav{flex-wrap:nowrap;gap:0}');
  assert.notEqual(noWrap, html);
  for (const [viewport, client, overflow] of [[320, 305, 85.28125], [375, 360, 30.28125]]) {
    const result = headerGeometry(noWrap, viewport, client);
    assert.equal(result.wraps, false); assert.equal(result.ctaRight - client, overflow);
  }
});
test('header fix preserves labels, anchor semantics and the larger-screen CSS scope', () => {
  assert.match(html, /<a class="navcta cta cta-in" href="#make">[\s\S]*?<span class="cta-label">Make yours<\/span>/);
  assert.match(html, /<a class="logo" href="#top">/);
  assert.match(html, /\.cta:focus-visible\{outline:3px solid var\(--foil\)/);
  assert.deepEqual(narrowHeaderRules(html, 768), { nav: {}, cta: {}, hero: {}, finale: {} });
  assert.deepEqual(narrowHeaderRules(html, 1440), { nav: {}, cta: {}, hero: {}, finale: {} });
});
