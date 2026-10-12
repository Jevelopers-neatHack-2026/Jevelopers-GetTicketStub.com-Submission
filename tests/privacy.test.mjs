import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildSite, root } from '../scripts/build.mjs';
import run, { digest, validatePrivacySource, exerciseJourney, validateReleaseReceipt, verifyReleaseEvidence } from '../scripts/suites/privacy.mjs';

const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const inventory = JSON.parse(await readFile(new URL('../review/privacy-inventory.json', import.meta.url), 'utf8'));
test('audited page has deferred analytics and two pinned executable scripts', () => {
  assert.deepEqual(validatePrivacySource(html, inventory), { scripts: 2, analytics: 'deferred' });
});
const variants = [
  ['SDK script', '<script src="https://tracker.invalid/sdk.js"></script>', /script destination/],
  ['inline event', '<button onclick="navigator.sendBeacon(\'/collect\')">x</button>', /inline handler/],
  ['relative pixel', '<img src="/collect?event=click">', /asset request/],
  ['external srcset', '<img srcset="https://tracker.invalid/pixel 1x">', /asset request/],
  ['iframe', '<iframe src="https://tracker.invalid/"></iframe>', /embedded destination/],
  ['CSS import', '<style>@import "https://tracker.invalid/style.css";</style>', /CSS import/],
  ['CSS pixel', '<style>body { background:url(https://tracker.invalid/pixel); }</style>', /CSS request/],
  ['same-origin CSS pixel', '<style>body { background:url(/collect); }</style>', /Style source changed/],
  ['inline CSS pixel', '<div style="background:url(/collect)">x</div>', /inline style request/],
  ['SVG image pixel', '<svg><image href="https://tracker.invalid/pixel" /></svg>', /Markup source changed/],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://tracker.invalid/">', /meta refresh/],
  ['form override', '<button formaction="https://tracker.invalid/" type="submit">x</button>', /form override/],
  ['executable link', '<a href="javascript:fetch(\'/collect\')">x</a>', /executable URL/],
  ['data HTML', '<a href="data:text/html,hello">x</a>', /executable URL/],
  ['link tracking ping', '<a href="#make" ping="/collect">x</a>', /ping/],
  ['named control', '<textarea name="private"></textarea>', /named form control/],
  ['unquoted pixel', '<img src=/collect>', /Unquoted/],
  ['unquoted script', '<script src=https://tracker.invalid/sdk.js></script>', /Unquoted script/],
  ['unquoted href', '<a href=https://tracker.invalid/>x</a>', /Unquoted/],
  ['style event', '<style onload="fetch(\'/collect\')"></style>', /Style source changed|Style attributes changed/],
];
for (const [name, addition, error] of variants) test(`reject seeded ${name}`, () => assert.throws(() => validatePrivacySource(html.replace('</body>', `${addition}</body>`), inventory), error));
for (const statement of ['localStorage.setItem("event", "click");', 'navigator.sendBeacon("/collect", "click");', 'console.log(document.getElementById("ev").value);', 'fetch("/collect");']) {
  test(`reject forbidden source operation: ${statement.split('(')[0]}`, () => {
    const changed = html.replace('const CTA_CONFIG =', `${statement}\n  const CTA_CONFIG =`);
    assert.throws(() => validatePrivacySource(changed, inventory), /Tracking\/storage|logging|fetch destination/);
  });
}
test('computed API addition fails exact executable hash boundary', () => {
  const changed = html.replace('const CTA_CONFIG =', 'window["ana" + "lytics"]?.send("click");\nconst CTA_CONFIG =');
  assert.throws(() => validatePrivacySource(changed, inventory), /Executable source changed/);
});
test('external script handler cannot bypass pinned executable text', () => {
  const changed = html.replace('<script src=', '<script onload="fetch(\'/collect\')" src=');
  assert.throws(() => validatePrivacySource(changed, inventory), /script handler/);
});
test('metadata URL declarations do not count as browser requests', () => {
  const metadata = '<link rel="canonical" href="https://public.example.org/"><meta property="og:url" content="https://public.example.org/"><script type="application/ld+json">{"@context":"https://schema.org","url":"https://public.example.org/"}</script>';
  assert.equal(validatePrivacySource(html.replace('</head>', metadata + '</head>'), inventory).analytics, 'deferred');
});
for (const reduced of [true, false]) for (const failure of ['blocked', 'failed']) test(`real maker/navigation handlers with ${failure} collection surfaces, reduced motion ${reduced}`, () => {
  const result = exerciseJourney(html, { reduced, failure });
  assert.ok(result.anchors >= 10); assert.ok(result.previews >= 4); assert.deepEqual(result.attempts, []);
  assert.equal(result.externalHandoff, 'disabled');
});
for (const surface of ['navigator.sendBeacon("/collect", ev.value)', 'localStorage.setItem("preview", ev.value)', 'console.log(ev.value)', 'fetch("/collect")']) {
  test(`journey traps a swallowed forbidden attempt: ${surface.split('(')[0]}`, () => {
    const changed = html.replace("const v = ev.value.trim();\n    if (!v)", `try { ${surface}; } catch (err) {}\n    const v = ev.value.trim();\n    if (!v)`);
    assert.notEqual(changed, html);
    assert.throws(() => exerciseJourney(changed), /attempted tracking/);
  });
}
test('native external capture or query navigation cannot return', () => {
  assert.throws(() => validatePrivacySource(html.replace('<div class="maker"', '<form action="https://tracker.invalid/" class="maker"'), inventory), /No capture form/);
  assert.throws(() => validatePrivacySource(html.replace('id="ev" type=', 'id="ev" name="link" type='), inventory), /input capture/);
});
test('built artifact passes draft and cannot pass release without approval receipt', async () => {
  const { output } = await buildSite();
  assert.equal((await run({ root, artifactDir: output, mode: 'draft' })).status, 'PASS_DRAFT');
  await assert.rejects(run({ root, artifactDir: output, mode: 'release' }), /approval receipt missing/);
});
test('receipt validator requires exact pins, both roles and browser scenarios', () => {
  const revision = 'a'.repeat(40), files = { 'index.html': { sha256: digest(html), bytes: Buffer.byteLength(html) } };
  // This is a schema fixture only, never an approval file or claim of actual owner review.
  const receipt = {
    schema: 'ticketstub.privacy-approval/1', sourceRevision: revision, pageSha256: digest(html), artifactFiles: files,
    approvals: ['Product and frontend', 'Finance and reliability'].map(role => ({ role, reviewer: 'synthetic-reviewer', status: 'APPROVED', sourceRevision: revision, reviewUrl: 'https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pull/999#pullrequestreview-999' })),
    cleanBrowser: { browserVersion: 'synthetic', profile: 'fresh', testedAt: '2026-10-12T04:00:00Z', sourceRevision: revision, evidenceUrl: `https://github.com/Jevelopers-neatHack-2026/landing-page-repo/blob/${revision}/review/browser.md`, trackingRequests: 0, trackingStorageWrites: 0, scenarios: ['load', 'all-ctas', 'offline', 'blocked-cdn', 'local-preview', 'link-only-demo'] },
    lp03HandoffReviewed: true,
  };
  assert.equal(validateReleaseReceipt(receipt, { files }, digest(html)).status, 'PASS');
  for (const mutate of [r => r.approvals.pop(), r => { r.pageSha256 = 'b'.repeat(64); }, r => { r.cleanBrowser.scenarios = ['load']; }, r => { r.cleanBrowser.trackingStorageWrites = 1; }, r => { r.lp03HandoffReviewed = false; }, r => { r.cleanBrowser.evidenceUrl = `fake/${revision}/fake`; }]) {
    const bad = structuredClone(receipt); mutate(bad); assert.throws(() => validateReleaseReceipt(bad, { files }, digest(html)));
  }
});
test('invented source receipt cannot pass real release evidence verification', async () => {
  await assert.rejects(verifyReleaseEvidence(root, { sourceRevision: '0'.repeat(40) }, { files: { 'index.html': { sha256: digest(html) } } }), /git show/);
});
