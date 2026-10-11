import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptFulfillmentCatalogV1, convertPhysicalLength, canonicalJson, hashManifest } from '../generated/index.mjs';
import { mapped, sources, context } from './capability-fixture-seeds.mjs';

for (const [name, raw] of [['alpha', sources.alpha], ['beta', sources.beta]]) test(name + ' source fields map exactly without inferred print geometry', () => {
  const result = adaptFulfillmentCatalogV1(raw, context);
  assert.equal(result.ok, true);
  const snapshot = result.value, product = snapshot.products[0], c = product.constraints;
  assert.equal(snapshot.source.input_hash, hashManifest(raw));
  assert.equal(snapshot.source.reference, raw.source.reference);
  assert.equal(snapshot.source.revision, raw.source.revision);
  assert.equal(snapshot.source.evidence_mode, 'synthetic_fixture');
  assert.equal(snapshot.provider_id, raw.providerId);
  assert.equal(snapshot.api_version, raw.apiVersion);
  assert.equal(snapshot.catalog_version, raw.catalogVersion);
  assert.equal(product.sku, raw.products[0].sku);
  assert.equal(product.variant_id, raw.products[0].variantId);
  assert.deepEqual(product.provider_metadata, raw.products[0].providerAttributes);
  assert.equal(c.physical_dimensions.value.depth_nm, name === 'alpha' ? '300000' : '400000');
  assert.equal(c.physical_dimensions.value.basis, 'unspecified_physical_product');
  for (const shape of Object.values(c.geometry)) assert.deepEqual(shape, { state: 'unknown', reason_code: 'not_in_source' });
  assert.deepEqual(c.inset_geometry_basis, { state: 'unknown', reason_code: 'not_in_source' });
  for (const field of ['surfaces', 'options', 'materials']) assert.deepEqual(c[field], raw.products[0].constraints[field]);
  assert.equal(c.minimum_resolution_dpi.value, name === 'alpha' ? 300 : 600);
  assert.equal(c.files.value.maximum_count, name === 'alpha' ? 2 : 4);
  assert.deepEqual(c.files.value.mime_types, raw.products[0].constraints.files.value.types);
  assert.deepEqual(c.color, raw.products[0].constraints.color);
  assert.equal(c.minimum_bleed.value.top_nm, name === 'alpha' ? '3000000' : '5000000');
  assert.equal(c.minimum_safe_area.value.top_nm, name === 'alpha' ? '5000000' : '8000000');
  assert.equal(c.personalization.state, raw.products[0].constraints.personalization.state);
  assert.deepEqual(c.shipping.value.map(row => [row.country_code, row.region_code, row.methods]), raw.products[0].constraints.shipping.value.map(row => [row.countryCode, row.regionCode, row.methods]));
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(c.geometry.trim), true);
});

for (const [value, unit, expected] of [['25.4', 'mm', '25400000'], ['2.54', 'cm', '25400000'], ['1', 'in', '25400000'], ['0.001', 'in', '25400'], ['0', 'mm', '0'], ['2000', 'mm', '2000000000']]) test('exact unit conversion ' + value + unit, () => {
  assert.deepEqual(convertPhysicalLength({ value, unit }), { ok: true, value: expected });
});
for (const [value, unit, code] of [['1', 'ft', 'UNSUPPORTED_PHYSICAL_UNIT'], ['304.8001', 'mm', 'INVALID_PHYSICAL_DECIMAL'], ['01', 'mm', 'INVALID_PHYSICAL_DECIMAL'], ['1e2', 'mm', 'INVALID_PHYSICAL_DECIMAL'], ['-1', 'mm', 'INVALID_PHYSICAL_DECIMAL'], ['2000.001', 'mm', 'PHYSICAL_RANGE']]) test('unit/precision rejects ' + value + unit, () => {
  const result = convertPhysicalLength({ value, unit });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, code);
});

for (const [name, mutate] of [
  ['unknown source version', raw => { raw.localFormat = 'connector-development-catalog/2'; }],
  ['unmapped source field', raw => { raw.newCapability = true; }],
  ['unmapped product field', raw => { raw.products[0].printableSize = 'assumed'; }],
  ['missing constraint', raw => { delete raw.products[0].constraints.files; }],
  ['wrong unit', raw => { raw.products[0].constraints.dimensions.value.unit = 'pixels'; }],
  ['excess precision', raw => { raw.products[0].constraints.dimensions.value.width = '304.8001'; }],
  ['zero physical depth', raw => { raw.products[0].constraints.dimensions.value.depth = '0'; }],
  ['missing uncertainty reason', raw => { raw.products[0].constraints.files = { state: 'unknown' }; }],
  ['unsupported not declared', raw => { raw.products[0].constraints.files = { state: 'unsupported', reasonCode: 'not_in_source' }; }],
  ['noninteger DPI', raw => { raw.products[0].constraints.minimumResolutionDpi.value = 299.5; }],
  ['bad MIME', raw => { raw.products[0].constraints.files.value.types = ['png']; }],
  ['bad country', raw => { raw.products[0].constraints.destinations.value[0].countryCode = 'usa'; }],
  ['bad region', raw => { raw.products[0].constraints.shipping.value[0].regionCode = 'US_CA'; }],
  ['secret key', raw => { raw.products[0].providerAttributes.apiKey = 'fixture-sentinel'; }],
  ['nested private metadata', raw => { raw.products[0].providerAttributes.nested = { customer: 'fixture-sentinel' }; }],
  ['private URL', raw => { raw.products[0].providerAttributes.link = 'https://example.invalid/private'; }],
  ['private address', raw => { raw.products[0].providerAttributes.note = 'Ship to 42 Main Street'; }],
  ['source URL', raw => { raw.source.reference = 'https:private/path'; }]
]) test('adapter blocks ' + name + ' without echoing payload', () => {
  const raw = structuredClone(sources.alpha);
  mutate(raw);
  const result = adaptFulfillmentCatalogV1(raw, context);
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes('fixture-sentinel'), false);
});
test('explicit unknown remains unknown and known no-region restrictions become an explicit mode', () => {
  const raw = structuredClone(sources.alpha);
  raw.products[0].constraints.files = { state: 'unknown', reasonCode: 'not_confirmed' };
  const result = adaptFulfillmentCatalogV1(raw, context);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.products[0].constraints.files, { state: 'unknown', reason_code: 'not_confirmed' });
  assert.deepEqual(result.value.products[0].constraints.destinations.value[1].regions, { state: 'known', value: { mode: 'unrestricted' } });
});
test('trusted scope is supplied independently and source cannot supply scope', () => {
  const raw = { ...structuredClone(sources.alpha), tenant_id: context.trusted_scope.tenant_id };
  assert.equal(adaptFulfillmentCatalogV1(raw, context).ok, false);
  for (const bad of [null, {}, { trusted_scope: null }, { trusted_scope: { tenant_id: 'invented', project_id: 'invented' }, now: context.now }]) assert.equal(adaptFulfillmentCatalogV1(sources.alpha, bad).ok, false);
});
test('boundary rejects accessors, proxies, sparse arrays, cycles and limits without invoking getters', () => {
  const raw = structuredClone(sources.alpha);
  let invoked = false;
  Object.defineProperty(raw.source, 'retrievedAt', { enumerable: true, get() { invoked = true; return context.now; } });
  assert.equal(adaptFulfillmentCatalogV1(raw, context).ok, false);
  assert.equal(invoked, false);
  for (const value of [new Proxy(sources.alpha, { ownKeys() { throw new Error('must not run'); } }), { ...sources.alpha, products: new Array(1) }, { ...sources.alpha, extra: 'x'.repeat(4097) }]) assert.equal(adaptFulfillmentCatalogV1(value, context).ok, false);
  const cycle = structuredClone(sources.alpha); cycle.source.cycle = cycle;
  assert.equal(adaptFulfillmentCatalogV1(cycle, context).ok, false);
});
test('owned immutable capture survives changes to the raw input', () => {
  const raw = structuredClone(sources.alpha), snapshot = mapped(raw), bytes = canonicalJson(snapshot);
  raw.products[0].constraints.dimensions.value.width = '999';
  raw.products[0].providerAttributes.tags.push('changed');
  assert.equal(canonicalJson(snapshot), bytes);
  assert.throws(() => { snapshot.products[0].provider_metadata.tags.push('changed'); }, TypeError);
});
