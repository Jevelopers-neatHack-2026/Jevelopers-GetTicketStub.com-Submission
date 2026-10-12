import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateArtifact } from '../artifact.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));
const same = (actual, expected, message) => assert.deepEqual(actual, expected, message);
export function markupDigest(html) {
  const markup = html.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '');
  return digest([...markup.matchAll(/<\/?[a-z][^>]*>/gi)].map(m => m[0]).filter(tag => !/^<meta\b/i.test(tag) && !(/^<link\b/i.test(tag) && attributes(tag).rel === 'canonical')).join('\n'));
}
const blocked = /\b(?:localStorage|sessionStorage|indexedDB|cookieStore|sendBeacon|XMLHttpRequest|WebSocket|EventSource|gtag|dataLayer|fbq|posthog|mixpanel|amplitude|analytics|trackEvent)\b|\bdocument\s*(?:\.\s*cookie|\[\s*['"]cookie['"]\s*\])/i;

export function validatePrivacySource(html, inventory) {
  assert.equal(inventory.schema, 'ticketstub.privacy-inventory/1', 'Privacy inventory schema');
  assert.equal(inventory.analytics, 'deferred', 'No enabled analytics implementation is approved');
  assert.equal(inventory.reviewStatus, 'PENDING', 'Draft audit is not owner approval');
  const markup = html.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '');
  for (const tag of markup.matchAll(/<[a-z][^>]*>/gi)) {
    assert.ok(!/^<meta\b[^>]*\bhttp-equiv\s*=/i.test(tag[0]), 'Unreviewed meta refresh/header');
    assert.ok(!/\s(?:href|src|srcset|action|poster)\s*=\s*[^\s"']/i.test(tag[0]), 'Unquoted request URL requires review');
    assert.ok(!/\s(?:on[a-z]+|ping|formaction)\s*=|^<(?:iframe|embed|object)\b/i.test(tag[0]), 'Unreviewed inline handler, ping, form override or embedded destination');
    assert.ok(!/(?:href|src|action)\s*=\s*["']\s*(?:javascript:|data:text\/html)/i.test(tag[0]), 'Unreviewed executable URL');
    assert.ok(!/url\s*\(|@import/i.test(attributes(tag[0]).style || ''), 'Unreviewed inline style request');
  }
  const executable = [], sources = [], maps = [], scriptTags = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.ok(!/\s(?:src|type)\s*=\s*[^\s"']/i.test(` ${match[1]}`), 'Unquoted script attribute requires review');
    const attrs = attributes(match[1]);
    assert.ok(!/\s(?:on[a-z]+|style)\s*=/i.test(` ${match[1]}`), 'Unreviewed script handler/style');
    if (attrs.type === 'application/ld+json') {
      assert.match(match[1].trim(), /^type=["']application\/ld\+json["']$/, 'Unreviewed metadata script attributes');
      JSON.parse(match[2]); continue;
    } // Metadata URLs do not execute or fetch.
    scriptTags.push(digest(match[1]));
    if (attrs.type === 'importmap') { maps.push(JSON.parse(match[2]).imports); continue; }
    if (attrs.src) sources.push(attrs.src);
    if (match[2].trim()) executable.push(match[2]);
  }
  same(sources, inventory.scriptSources, 'Unreviewed script destination');
  same(scriptTags, inventory.scriptTagsSha256, 'Script attributes changed; refresh privacy audit');
  same(maps, [inventory.imports], 'Unreviewed import destination');
  const resourceLinks = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => attributes(m[0])).filter(a => a.rel !== 'canonical').map(a => a.href);
  same(resourceLinks, inventory.resourceLinks, 'Unreviewed resource destination');
  for (let source of executable) {
    assert.ok(!blocked.test(source), 'Tracking/storage API in landing source');
    // Existing animation diagnostics are local console warnings. No user-input logging is permitted.
    source = source.replace(/console\.warn\('3D (?:animation )?unavailable, showing the static version', err\);/g, '');
    assert.ok(!/\bconsole\s*(?:\.|\[)/.test(source), 'Unreviewed logging in landing source');
    const fetches = [...source.matchAll(/\bfetch\s*\(([^)]*)\)/g)].map(m => m[1]);
    for (const call of fetches) assert.equal(call, "'assets/flight.json'", 'Unreviewed fetch destination or payload');
  }
  // Exact executable hashes also catch computed/aliased APIs and injected dynamic resource loaders.
  same(executable.map(digest), inventory.executableScriptSha256, 'Executable source changed; refresh privacy audit');
  const forms = [...html.matchAll(/<form\b[^>]*>/gi)];
  assert.equal(forms.length, 0, 'No capture form or native external submit is approved');
  const group = html.match(/<div\b[^>]*id="maker"[^>]*>/i);
  assert.ok(group && attributes(group[0]).role === 'group', 'Local editor group missing');
  const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map(m => attributes(m[0]));
  same(inputs.map(a => [a.id, a.name, a.type]), [['ev', undefined, 'text']], 'Unreviewed input capture');
  for (const control of markup.matchAll(/<(?:textarea|select|button)\b[^>]*>/gi)) assert.ok(!attributes(control[0]).name, 'Unreviewed named form control');
  for (const tag of markup.matchAll(/<(?:a|img|source|video|audio)\b[^>]*>/gi)) {
    const attrs = attributes(tag[0]);
    if (tag[0].toLowerCase().startsWith('<a ')) {
      assert.ok(attrs.href?.startsWith('#') || (inventory.studioUrl && attrs.href === inventory.studioUrl) || (!attrs.href && attrs.id === 'demoLink' && /\bhidden\b/.test(tag[0])), 'Unreviewed external navigation');
      if (attrs.href === inventory.studioUrl) assert.match(attrs.rel || '', /\bnoopener\b/);
    } else {
      for (const key of ['src', 'srcset', 'poster']) if (attrs[key]) assert.match(attrs[key], /^assets\/[a-z0-9_.-]+\.(?:webp|png|jpe?g|avif)$/, 'Unreviewed asset request');
    }
  }
  assert.ok(!/@import\b/i.test(html), 'Unreviewed CSS import');
  for (const url of html.matchAll(/url\(\s*['"]?((?:https?:|\/\/)[^)'"\s]+)/gi)) throw new Error(`Unreviewed CSS request: ${url[1]}`);
  same([...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => digest(m[1])), inventory.styleSha256, 'Style source changed; refresh privacy audit');
  same([...html.matchAll(/<style\b([^>]*)>/gi)].map(m => digest(m[1])), inventory.styleTagsSha256, 'Style attributes changed; refresh privacy audit');
  same(markupDigest(html), inventory.markupTagsSha256, 'Markup source changed; refresh privacy audit');
  return { scripts: executable.length, analytics: 'deferred' };
}

function node() {
  const handlers = new Map(), attrs = new Map(), classes = new Set();
  return {
    handlers, value: '', hidden: true, textContent: 'Local preview', lastChild: { textContent: '' },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c, on) { on ? classes.add(c) : classes.delete(c); } },
    setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k), hasAttribute: k => attrs.has(k), getAttribute: k => attrs.get(k),
    addEventListener(type, handler) { const list = handlers.get(type) || []; list.push(handler); handlers.set(type, list); },
    removeEventListener() {}, appendChild() {}, insertAdjacentHTML() {}, focus() {}, querySelector: () => node(),
    dispatch(type, details = {}) { let prevented = false; for (const handler of handlers.get(type) || []) handler({ ...details, preventDefault() { prevented = true; } }); return prevented; },
  };
}
function section(html, from, to) {
  const begin = html.indexOf(from), end = html.indexOf(to, begin);
  assert.ok(begin >= 0 && end > begin, 'Real journey source section missing');
  return html.slice(begin, end);
}

// Execute the real maker and in-page CTA handlers without CDN code or external requests.
// This is a limited VM journey harness, not a browser/network/storage certification.
export function exerciseJourney(html, { failure = 'blocked', reduced = true } = {}) {
  const elements = Object.fromEntries(['maker', 'ev', 'finCard', 'finNote', 'finale', 'demoLink', 'demoUnavailable', 'finStatus', 'previewButton'].map(id => [id, node()]));
  elements.maker.querySelector = () => elements.previewButton;
  const timers = [], frames = [], attempts = [], previews = [], moves = [];
  const fail = surface => { attempts.push(surface); throw new Error(`${surface} ${failure}`); };
  const anchors = [...html.matchAll(/<a\b[^>]*href=["'](#[^"']+)["'][^>]*>/gi)].map(match => { const a = node(); a.getAttribute = () => match[1]; return a; });
  const chips = ['gulls', 'nova', 'wolves'].map(demo => Object.assign(node(), { dataset: { demo } }));
  const document = {
    getElementById: id => elements[id],
    querySelectorAll: selector => selector === '.fin-try button' ? chips : anchors,
    querySelector: id => id.startsWith('#') ? { getBoundingClientRect: () => ({ top: 500 }) } : null,
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(document, 'cookie', { get: () => fail('cookie'), set: () => fail('cookie') });
  const context = vm.createContext({
    document, URL, URLSearchParams, reduced, scrollY: 0, innerHeight: 600,
    finale: { inert: false }, boardEl: { offsetTop: 10000, offsetHeight: 3000 },
    performance: { now: () => 0 }, matchMedia: () => ({ matches: reduced }),
    TS: { still: reduced, fine: false, NIGHTS: Object.fromEntries(chips.map(c => [c.dataset.demo, {}])), card: node, paint: (_, d) => previews.push(d), buzz() {} },
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: callback => frames.push(callback), addEventListener() {},
    scrollTo: value => moves.push(value), history: { pushState() {} },
    fetch: () => fail('fetch'), XMLHttpRequest: function() { fail('XHR'); },
    navigator: { sendBeacon: () => fail('beacon') },
    console: new Proxy({}, { get: () => () => fail('logging') }),
  });
  context.window = context;
  context.open = () => fail('navigation');
  Object.defineProperty(context, 'location', { get: () => fail('navigation'), set: () => fail('navigation') });
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'cookieStore']) Object.defineProperty(context, name, { get: () => fail(name) });
  vm.runInContext(section(html, '/* ---------- the one checkout:', '/* ---------- brand motion,'), context, { timeout: 1000 });
  vm.runInContext(section(html, '/* ---------- in-page links:', '// Progress follows native'), context, { timeout: 1000 });
  for (const anchor of anchors) { assert.equal(anchor.dispatch('click'), true); }
  while (frames.length) frames.shift()();
  assert.equal(moves.length, anchors.length, 'All real in-page CTA/navigation links remain usable');
  const input = elements.ev;
  input.value = ''; assert.equal(elements.previewButton.dispatch('click'), true, 'Empty preview click stays local');
  assert.equal(input.dispatch('keydown', { key: 'Enter', isComposing: false }), true, 'Enter stays local');
  for (const chip of chips) { chip.dispatch('click'); assert.ok(input.value); }
  const synthetic = 'LP_PRIVACY_SYNTHETIC_ONLY, Fictional Hall, Jul 12 2025';
  input.value = synthetic; input.dispatch('input'); input.dispatch('change');
  // Run preview timers, including the animation completion branch.
  for (let i = 0; i < timers.length; i++) timers[i](); timers.length = 0;
  assert.ok(previews.some(p => p.a === 'LP_PRIVACY_SYNTHETIC_ONLY'), 'Real local preview updates');
  assert.equal(elements.previewButton.dispatch('click'), true, 'Preview button cannot submit input');
  assert.equal(input.dispatch('keydown', { key: 'Enter', isComposing: false }), true, 'Typed Enter cannot submit input');
  for (const timer of timers) timer();
  const external = elements.demoLink.href || null;
  if (external) {
    const target = new URL(external);
    assert.equal(target.search, '', 'Link-only destination cannot carry query data');
    assert.equal(target.hash, '', 'Link-only destination cannot carry fragment data');
    assert.ok(!external.includes('LP_PRIVACY_SYNTHETIC_ONLY'));
  } else assert.equal(elements.demoLink.hidden, true, 'Pending demo has no active link');
  same(attempts, [], 'Journey attempted tracking, storage, network or input logging');
  return { anchors: anchors.length, previews: previews.length, externalHandoff: external ? 'link-only-fixture' : 'disabled', destination: external, localNote: elements.finNote.textContent, inputValue: input.value, demoStatus: elements.demoUnavailable.textContent, attempts };
}

export function validateReleaseReceipt(receipt, manifest, pageSha256) {
  assert.ok(receipt, 'Privacy release approval receipt missing: owner review, LP-03 handoff and clean-browser evidence pending');
  assert.equal(receipt.schema, 'ticketstub.privacy-approval/1');
  assert.match(receipt.sourceRevision || '', /^[a-f0-9]{40}$/, 'Receipt requires immutable source revision');
  assert.equal(receipt.pageSha256, pageSha256, 'Privacy approval page pin differs');
  same(receipt.artifactFiles, manifest.files, 'Privacy approval artifact hashes differ');
  for (const role of ['Product and frontend', 'Finance and reliability']) {
    const approval = receipt.approvals?.find(a => a.role === role);
    assert.ok(approval?.reviewer && approval.status === 'APPROVED', `${role} approval pending`);
    assert.equal(approval.sourceRevision, receipt.sourceRevision, 'Approval revision differs');
    assert.match(approval.reviewUrl || '', /^https:\/\/github\.com\/Jevelopers-neatHack-2026\/landing-page-repo\/pull\/\d+#pullrequestreview-\d+$/, 'Approval requires GitHub review evidence');
  }
  const browser = receipt.cleanBrowser;
  for (const key of ['browserVersion', 'evidenceUrl', 'profile', 'testedAt']) assert.ok(browser?.[key], `Clean-browser ${key} evidence missing`);
  assert.equal(browser.profile, 'fresh');
  assert.equal(browser.sourceRevision, receipt.sourceRevision);
  assert.ok(!Number.isNaN(Date.parse(browser.testedAt)), 'Invalid browser evidence date');
  assert.match(browser.evidenceUrl, new RegExp(`^https://github\\.com/Jevelopers-neatHack-2026/landing-page-repo/blob/${receipt.sourceRevision}/[a-zA-Z0-9_./-]+$`), 'Browser evidence must be a pinned repository URL');
  assert.equal(browser.trackingRequests, 0); assert.equal(browser.trackingStorageWrites, 0);
  for (const mode of ['load', 'all-ctas', 'offline', 'blocked-cdn', 'local-preview', 'link-only-demo']) assert.ok(browser.scenarios?.includes(mode), `Missing browser scenario: ${mode}`);
  assert.equal(receipt.lp03HandoffReviewed, true, 'LP-03 receiving endpoint and handling review pending');
  return { status: 'PASS' };
}

const execute = promisify(execFile);
export async function verifyReleaseEvidence(root, receipt, manifest) {
  // Schema checks alone are not attestation. Resolve actual source bytes and GitHub reviews.
  for (const [path, record] of Object.entries(manifest.files)) {
    const { stdout } = await execute('git', ['show', `${receipt.sourceRevision}:site/${path}`], { cwd: root, encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 });
    assert.equal(digest(stdout), record.sha256, `Reviewed source bytes differ: ${path}`);
  }
  const evidencePath = new URL(receipt.cleanBrowser.evidenceUrl).pathname.split(`/blob/${receipt.sourceRevision}/`)[1];
  const { stdout: browserEvidence } = await execute('git', ['show', `${receipt.sourceRevision}:${evidencePath}`], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.ok(browserEvidence.trim(), 'Pinned clean-browser evidence file is empty');
  for (const approval of receipt.approvals) {
    const [, pull, reviewId] = approval.reviewUrl.match(/\/pull\/(\d+)#pullrequestreview-(\d+)$/);
    const { stdout } = await execute('gh', ['api', `repos/Jevelopers-neatHack-2026/landing-page-repo/pulls/${pull}/reviews/${reviewId}`], { cwd: root, encoding: 'utf8', timeout: 15000 });
    const review = JSON.parse(stdout);
    assert.equal(review.state, 'APPROVED', 'GitHub review is not approved');
    assert.equal(review.user?.login, approval.reviewer, 'GitHub reviewer identity differs');
    assert.equal(review.commit_id, receipt.sourceRevision, 'GitHub approval source pin differs');
    assert.ok(review.body?.includes(`LP-07 privacy approval: ${approval.role}`), 'Review must explicitly approve the accountable privacy role');
  }
}

export default async function run({ root, artifactDir, mode = 'draft' }) {
  assert.ok(['draft', 'release'].includes(mode), 'Unknown privacy mode');
  const inventory = JSON.parse(await readFile(resolve(root, 'review/privacy-inventory.json'), 'utf8'));
  await validateArtifact(root, artifactDir);
  const html = await readFile(resolve(artifactDir, 'index.html'), 'utf8');
  const result = validatePrivacySource(html, inventory);
  // The current artifact contains no executable asset files. Future ones require a reviewed boundary.
  const manifest = JSON.parse(await readFile(resolve(artifactDir, 'manifest.json'), 'utf8'));
  for (const path of Object.keys(manifest.files)) {
    assert.ok(!/\.(?:js|mjs|css|svg)$/i.test(path), `Unreviewed executable/style asset: ${path}`);
    if (!/\.json$/i.test(path)) continue;
    const json = JSON.parse(await readFile(resolve(artifactDir, path), 'utf8'));
    for (const item of [...(json.buffers || []), ...(json.images || [])]) if (item.uri) assert.ok(/^(?:data:|assets\/|[^:/]+$)/.test(item.uri), `Unreviewed model resource: ${path}`);
  }
  for (const reduced of [true, false]) for (const failure of ['blocked', 'failed']) exerciseJourney(html, { reduced, failure });
  if (mode === 'release') {
    let receipt;
    try { receipt = JSON.parse(await readFile(resolve(root, 'review/privacy-approval.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const approval = validateReleaseReceipt(receipt, manifest, digest(html));
    await verifyReleaseEvidence(root, receipt, manifest);
    return approval;
  }
  console.log(`privacy: ${result.scripts} audited scripts; real local editor/link handlers exercised; CDN/browser certification and owner approvals PENDING`);
  return { status: 'PASS_DRAFT' };
}
