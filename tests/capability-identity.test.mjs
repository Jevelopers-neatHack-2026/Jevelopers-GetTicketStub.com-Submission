import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptFulfillmentCatalogV1, compareFulfillmentCaptures, checkPrintSpecBinding, canonicalJson } from '../generated/index.mjs';
import { mapped, sources, context } from './capability-fixture-seeds.mjs';

test('capture metadata refresh preserves spec/content identities and immutable history', () => {
  const prior = mapped(), bytes = canonicalJson(prior), raw = structuredClone(sources.alpha);
  raw.source.retrievedAt = '2026-10-10T10:01:00.000Z';
  const current = mapped(raw);
  assert.equal(current.products[0].spec_identity, prior.products[0].spec_identity);
  assert.equal(current.content_identity, prior.content_identity);
  assert.notEqual(current.capture_identity, prior.capture_identity);
  assert.deepEqual(compareFulfillmentCaptures(prior, current, context), { ok: true, value: { status: 'capture_refresh', changed_products: [] } });
  assert.equal(canonicalJson(prior), bytes);
});
test('source revision and catalog version change content/capture, not product spec', () => {
  const prior = mapped(), raw = structuredClone(sources.alpha);
  raw.source.revision = 'revision:fixture-alpha-2'; raw.catalogVersion = 'alpha-r2';
  const current = mapped(raw);
  assert.equal(current.products[0].spec_identity, prior.products[0].spec_identity);
  assert.notEqual(current.content_identity, prior.content_identity);
  assert.notEqual(current.capture_identity, prior.capture_identity);
  assert.equal(compareFulfillmentCaptures(prior, current, context).value.status, 'source_or_catalog_change');
});
test('evidence attribution and freshness policy change capture only and authenticate nothing', () => {
  const prior = mapped(), raw = structuredClone(sources.alpha);
  raw.source.evidenceMode = 'unverified_import'; raw.source.evidenceReference = 'fixture:unverified'; raw.freshness.maximumAgeSeconds = 7200;
  const current = mapped(raw);
  assert.equal(current.content_identity, prior.content_identity);
  assert.equal(current.products[0].spec_identity, prior.products[0].spec_identity);
  assert.notEqual(current.capture_identity, prior.capture_identity);
});
test('set order changes only raw input/capture attribution, not normalized spec/content', () => {
  const prior = mapped(), raw = structuredClone(sources.alpha), c = raw.products[0].constraints;
  for (const value of [c.files.value.types, c.options.value, c.destinations.value, c.shipping.value, c.destinations.value[0].regions.value]) value.reverse();
  const current = mapped(raw);
  assert.equal(current.products[0].spec_identity, prior.products[0].spec_identity);
  assert.equal(current.content_identity, prior.content_identity);
  assert.notEqual(current.source.input_hash, prior.source.input_hash);
});
test('equivalent exact units produce the same material spec', () => {
  const raw = structuredClone(sources.alpha), imperial = structuredClone(raw);
  raw.products[0].constraints.dimensions.value = { width: '25.4', height: '50.8', depth: '2.54', unit: 'mm' };
  imperial.products[0].constraints.dimensions.value = { width: '1', height: '2', depth: '0.1', unit: 'in' };
  assert.equal(mapped(raw).products[0].spec_identity, mapped(imperial).products[0].spec_identity);
});
for (const [field, mutate] of [
  ['dimensions', p => { p.constraints.dimensions.value.width = '305'; }],
  ['bleed', p => { p.constraints.minimumBleed.value.left = '4'; }],
  ['safe', p => { p.constraints.minimumSafeArea.value.top = '6'; }],
  ['DPI', p => { p.constraints.minimumResolutionDpi.value = 301; }],
  ['surfaces', p => { p.constraints.surfaces.value.push('back'); }],
  ['MIME', p => { p.constraints.files.value.types.push('image/jpeg'); }],
  ['count', p => { p.constraints.files.value.maximumCount = 3; }],
  ['profile', p => { p.constraints.color.value.profiles.push('fixture-srgb'); }],
  ['options', p => { p.constraints.options.value.push('framed'); }],
  ['materials', p => { p.constraints.materials.value.push('paper-250gsm'); }],
  ['personalization', p => { p.constraints.personalization.value.maximumFields = 3; }],
  ['destinations', p => { p.constraints.destinations.value[0].regions.value.push('TX'); }],
  ['shipping', p => { p.constraints.shipping.value[0].methods.push('tracked'); }],
  ['metadata', p => { p.providerAttributes.finishCode = 'M-03'; }],
  ['metadata array order', p => { p.providerAttributes.tags.reverse(); }],
  ['unknown files', p => { p.constraints.files = { state: 'unknown', reasonCode: 'not_confirmed' }; }],
  ['removed availability', p => { p.availability = 'removed'; }]
]) test('material drift in ' + field + ' invalidates the previous exact spec binding', () => {
  const prior = mapped(), raw = structuredClone(sources.alpha);
  mutate(raw.products[0]);
  const current = mapped(raw), bound = { ...context, capture_identity: current.capture_identity, content_identity: current.content_identity };
  assert.notEqual(current.products[0].spec_identity, prior.products[0].spec_identity);
  assert.equal(compareFulfillmentCaptures(prior, current, context).value.status, 'material_drift');
  const result = checkPrintSpecBinding(prior.products[0], current, bound);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'SPEC_DRIFT');
});
test('same-SKU incompatible provider is not substituted', () => {
  const alpha = mapped(), beta = mapped(sources.beta);
  const result = checkPrintSpecBinding(alpha.products[0], beta, { ...context, capture_identity: beta.capture_identity, content_identity: beta.content_identity });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'PRODUCT_MISSING');
  assert.equal(compareFulfillmentCaptures(alpha, beta, context).errors[0].code, 'PROVIDER_MISMATCH');
});
test('capture clock regression is rejected even if the current capture is fresh', () => {
  const later = structuredClone(sources.alpha); later.source.retrievedAt = '2026-10-10T10:01:00.000Z';
  assert.equal(compareFulfillmentCaptures(mapped(later), mapped(), context).errors[0].code, 'CAPTURE_CLOCK_REGRESSION');
});
test('expired old history may be compared but is not returned as a fresh capture', () => {
  const prior = mapped(), raw = structuredClone(sources.alpha); raw.source.retrievedAt = '2026-10-10T11:01:00.000Z';
  const laterContext = { ...context, now: '2026-10-10T11:30:00.000Z' };
  const current = adaptFulfillmentCatalogV1(raw, laterContext);
  assert.equal(current.ok, true);
  assert.equal(compareFulfillmentCaptures(prior, current.value, laterContext).value.status, 'capture_refresh');
});
