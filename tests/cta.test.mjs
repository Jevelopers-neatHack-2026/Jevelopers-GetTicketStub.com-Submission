import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fixtureSource, sourceConfig, validateCtaSource } from '../scripts/suites/cta.mjs';
import { exerciseJourney } from '../scripts/suites/privacy.mjs';
const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const config = JSON.parse(await readFile(new URL('../src/content/cta.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
// Synthetic approval-shaped data exercises disabled/enabled code paths. No owner approval is claimed.
function approved(environment = 'preview') {
  const fixture = clone(config); fixture.environment = environment;
  const destination = 'https://public.example.org/demo';
  fixture.destinations[environment] = {
    status: 'APPROVED', url: destination, allowedOrigin: 'https://public.example.org', allowedPath: '/demo', queryKeys: [], availability: 'verified', ownerRole: 'SYNTHETIC_RECEIVING_OWNER',
    receipt: { destination, environment, reviewer: 'SYNTHETIC_REVIEWER', sourceRevision: 'a'.repeat(40), reviewedAt: '2026-10-12T00:00:00Z', evidenceUrl: `https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/${'a'.repeat(40)}/review/cta.json` },
  };
  return fixture;
}
function journey(value, options) { return exerciseJourney(fixtureSource(html, value), options); }
test('actual source config, no-JS markup and local editor boundary are explicit', () => {
  assert.deepEqual(sourceConfig(html), config);
  const result = validateCtaSource(html, config);
  assert.equal(result.destination, 'https://getticketstub.com/make'); assert.equal(result.externalHandoff, 'link-only-local-check');
  assert.match(result.localNote, /Nothing was sent/);
  assert.ok(!/<form\b|\bname="link"|type="submit"/.test(html));
  const link = html.match(/<a\b[^>]*id="demoLink"[^>]*>/)[0];
  assert.match(link, /href="https:\/\/getticketstub.com\/make"/); assert.ok(!/\bhidden\b/.test(link));
});
test('no-JS escape is explicit, query-free and uses the same approved native destination', () => {
  assert.match(html, /<noscript>[\s\S]*?The interactive preview requires JavaScript\./);
  assert.match(html, /id="nojsStudio" href="https:\/\/getticketstub\.com\/make" target="_blank" rel="noopener noreferrer"/);
  assert.equal(validateCtaSource(html, config).destination, 'https://getticketstub.com/make');
});
test('a mismatched or hidden duplicate static fallback link cannot escape the approved config', () => {
  for (const replacement of ['id="nojsStudio" href="https://other.example.org/make"', 'id="nojsStudio" href=\'https://other.example.org/make\'', 'id="nojsStudio" href=https://other.example.org/make', 'id="nojsStudio" hidden href="https://getticketstub.com/make?private=LP_SYNTHETIC_ONLY"']) {
    const bad = html.replace('id="nojsStudio" href="https://getticketstub.com/make"', replacement);
    assert.throws(() => validateCtaSource(bad, config), /Static native link differs/);
  }
});
test('withdrawn config requires static no-JS navigation to be withdrawn too', () => {
  const pending = clone(config); pending.destinations.preview.status = 'PENDING';
  const bad = fixtureSource(html, pending).replace(/(<a\b[^>]*id="demoLink") href="[^"]+"/, '$1');
  assert.throws(() => validateCtaSource(bad, pending), /Static native link differs/);
});
test('missing/invalid config cannot expose any external navigation', () => {
  for (const value of [null, {}, { ...clone(config), environment: 'unknown' }, { ...clone(config), capture: 'enabled' }]) assert.equal(journey(value).destination, null);
  const missing = clone(config); delete missing.destinations.preview;
  assert.equal(journey(missing).destination, null);
});
test('approved-shaped link fixtures carry only exact owner-allowlisted URL in each environment', () => {
  for (const environment of ['preview','demo','staging','production']) {
    const fixture = approved(environment), result = journey(fixture);
    assert.equal(result.destination, 'https://public.example.org/demo');
    assert.equal(result.externalHandoff, 'link-only-local-check');
    assert.equal(new URL(result.destination).search, '');
    assert.ok(!result.destination.includes(result.inputValue));
    assert.match(result.demoStatus, /text is not included/);
    assert.deepEqual(result.attempts, []);
  }
});
test('unavailable service, pending owner or absent/nonimmutable/mismatched approval receipts disable the link', () => {
  const variants = [
    e => { e.availability = 'unavailable'; }, e => { e.status = 'PENDING'; }, e => { e.receipt = null; },
    e => { e.receipt.destination = 'https://other.example.org/demo'; }, e => { e.receipt.environment = 'production'; },
    e => { e.receipt.sourceRevision = 'main'; }, e => { e.receipt.evidenceUrl = 'https://unrelated.example.org/receipt'; },
    e => { e.receipt.evidenceUrl = 'https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/' + e.receipt.sourceRevision + '.md'; },
    e => { e.receipt.reviewer = ''; }, e => { e.receipt.reviewedAt = 'invalid'; }, e => { e.ownerRole = ''; },
  ];
  for (const change of variants) { const fixture = approved(); change(fixture.destinations.preview); assert.equal(journey(fixture).destination, null); }
});
test('invalid scheme/origin/path, queries, fragments, credentials and private destinations fail closed', () => {
  for (const value of ['http://public.example.org/demo','https://other.example.org/demo','https://public.example.org/other','https://public.example.org/demo?link=LP_SYNTHETIC_SECRET','https://public.example.org/demo#LP_SYNTHETIC_SECRET','https://name:password@public.example.org/demo','https://public.example.org:8443/demo','//public.example.org/demo','invalid']) {
    const fixture = approved(), entry = fixture.destinations.preview; entry.url = value; entry.receipt.destination = value;
    assert.equal(journey(fixture).destination, null, value);
  }
  for (const value of ['https://127.0.0.1/demo','https://app.internal/demo','https://[::1]/demo','https://public.example.org/signin','https://public.example.org/admin','https://public.example.org/api/health','https://public.example.org/%2fadmin']) {
    const fixture = approved(), entry = fixture.destinations.preview, url = new URL(value);
    Object.assign(entry, { url: value, allowedOrigin: url.origin, allowedPath: url.pathname }); entry.receipt.destination = value;
    assert.equal(journey(fixture).destination, null, value);
  }
  const tracking = approved(); tracking.destinations.preview.queryKeys = ['utm_source']; assert.equal(journey(tracking).destination, null);
});
test('real pointer/Enter/preview/example/navigation handlers keep synthetic input local with reduced motion and blocked surfaces', () => {
  for (const reduced of [true,false]) for (const failure of ['blocked','failed']) {
    const result = exerciseJourney(html, { reduced, failure });
    assert.ok(result.anchors >= 10); assert.ok(result.previews >= 4);
    assert.equal(result.destination, 'https://getticketstub.com/make'); assert.deepEqual(result.attempts, []);
    assert.match(result.inputValue, /LP_PRIVACY_SYNTHETIC_ONLY/);
  }
});
test('tampered source config, named input and sending confirmation are rejected', () => {
  assert.throws(() => validateCtaSource(fixtureSource(html, approved()), config), /config\/source drift/);
  assert.throws(() => validateCtaSource(html.replace('id="ev" type=', 'id="ev" name="link" type='), config), /submit name/);
  assert.throws(() => validateCtaSource(html.replace('Nothing was sent', 'Sent to the studio'), config), /false send confirmation/);
});

test('limited thread receipt rejects malformed observation/approval scope and cannot migrate to another environment', () => {
  for (const observations of [{}, [null], ['invalid']]) {
    const bad = clone(config); bad.destinations.preview.receipt.observations = observations;
    assert.equal(journey(bad).destination, null);
  }
  for (const change of [r => { r.scope = 'release'; }, r => { r.mode = 'sandbox'; }, r => { r.label = 'Try demo'; }, r => { r.source.threadId = 'other'; }]) {
    const bad = clone(config); change(bad.destinations.preview.receipt); assert.equal(journey(bad).destination, null);
  }
  for (const environment of ['demo','staging','production']) {
    const bad = clone(config); bad.environment = environment; bad.destinations[environment] = clone(bad.destinations.preview); bad.destinations[environment].receipt.environment = environment;
    assert.equal(journey(bad).destination, null);
  }
});
test('actual live navigation target stays byte-identical after editing, chips, button clicks and Enter', () => {
  const result = exerciseJourney(html);
  assert.equal(result.destination, 'https://getticketstub.com/make');
  const url = new URL(result.destination); assert.equal(url.search, ''); assert.equal(url.hash, '');
  assert.match(result.inputValue, /LP_PRIVACY_SYNTHETIC_ONLY/); assert.ok(!result.destination.includes(result.inputValue));
});

test('invalid config must remove the real pre-existing native href; deletion mutant fails the safety assertion', () => {
  const invalid = clone(config); invalid.destinations.preview.status = 'PENDING';
  const changed = fixtureSource(html, invalid);
  assert.match(changed, /id="demoLink" href="https:\/\/getticketstub.com\/make"/);
  assert.equal(exerciseJourney(changed).destination, null);
  const mutant = changed.replace("demoLink.removeAttribute('href');", '');
  assert.notEqual(mutant, changed);
  assert.throws(() => assert.equal(exerciseJourney(mutant).destination, null), assert.AssertionError);
});
