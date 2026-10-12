import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPrintSpec, checkFulfillmentCapabilitySnapshot, checkPrintSpecBinding, validateContract, translatePrintSpecToLegacy, projectEvidence } from '../generated/index.mjs';
import { mapped, geometryControl, context, sealSpec } from './capability-fixture-seeds.mjs';
import { readJson } from '../scripts/generate.mjs';

for (const [name, mutate, code, path] of [
  ['bad unit', c => { c.physical_dimensions.value.unit = 'mm'; }, 'INVALID_PAYLOAD', '/constraints/physical_dimensions/value/unit'],
  ['nanometre decimal', c => { c.physical_dimensions.value.width_nm = '304800000.0'; }, 'INVALID_PAYLOAD', '/constraints/physical_dimensions/value/width_nm'],
  ['range', c => { c.physical_dimensions.value.width_nm = '2000000001'; }, 'PHYSICAL_RANGE', '/constraints/physical_dimensions'],
  ['safe width equality', c => { c.minimum_safe_area.value.left_nm = '152400000'; c.minimum_safe_area.value.right_nm = '152400000'; }, 'IMPOSSIBLE_SAFE_GEOMETRY', '/constraints/minimum_safe_area'],
  ['safe width overflow', c => { c.minimum_safe_area.value.left_nm = '304800000'; }, 'IMPOSSIBLE_SAFE_GEOMETRY', '/constraints/minimum_safe_area'],
  ['safe height equality', c => { c.minimum_safe_area.value.top_nm = '228600000'; c.minimum_safe_area.value.bottom_nm = '228600000'; }, 'IMPOSSIBLE_SAFE_GEOMETRY', '/constraints/minimum_safe_area'],
  ['unconfirmed trim', c => { c.geometry.trim = { state: 'unknown', reason_code: 'not_confirmed' }; }, 'GEOMETRY_UNCONFIRMED', '/constraints/inset_geometry_basis'],
  ['zero DPI', c => { c.minimum_resolution_dpi.value = 0; }, 'INVALID_PAYLOAD', '/constraints/minimum_resolution_dpi/value'],
  ['empty MIME list', c => { c.files.value.mime_types = []; }, 'INVALID_PAYLOAD', '/constraints/files/value/mime_types'],
  ['count range', c => { c.files.value.minimum_count = 3; }, 'CONTRADICTORY_CONSTRAINT', '/constraints/files'],
  ['empty profile set', c => { c.color.value.profiles = []; }, 'INVALID_PAYLOAD', '/constraints/color/value/profiles'],
  ['empty materials', c => { c.materials.value = []; }, 'INVALID_PAYLOAD', '/constraints/materials/value'],
  ['personalization limits', c => { c.personalization.value.maximum_fields = 0; }, 'CONTRADICTORY_CONSTRAINT', '/constraints/personalization'],
  ['shipping country', c => { c.shipping.value[0].country_code = 'FR'; }, 'CONTRADICTORY_ROUTE', '/constraints/shipping'],
  ['shipping region', c => { c.shipping.value[1].region_code = 'TX'; }, 'CONTRADICTORY_ROUTE', '/constraints/shipping'],
  ['empty shipping methods', c => { c.shipping.value[0].methods = []; }, 'INVALID_PAYLOAD', '/constraints/shipping/value/0/methods'],
  ['duplicate country', c => { c.destinations.value.push({ ...c.destinations.value[0], regions: { state: 'unknown', reason_code: 'not_confirmed' } }); }, 'DUPLICATE_ROUTE', '/constraints/destinations'],
  ['duplicate shipping key', c => { c.shipping.value.push({ ...c.shipping.value[0], methods: ['express'] }); }, 'DUPLICATE_ROUTE', '/constraints/shipping']
]) test('pure consistency rejects ' + name, () => {
  const spec = structuredClone(geometryControl().products[0]);
  mutate(spec.constraints);
  const result = checkPrintSpec(spec, context);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.code === code && error.path === path), JSON.stringify(result));
});
test('source physical dimensions cannot prove safe-area content geometry', () => {
  const spec = structuredClone(mapped().products[0]);
  spec.constraints.minimum_safe_area.value.left_nm = '304800000';
  const sealed = sealSpec(spec);
  assert.equal(checkPrintSpec(sealed, context).ok, true);
  assert.equal(sealed.constraints.inset_geometry_basis.state, 'unknown');
});
test('generic separately evidenced geometry permits strictly positive content room', () => {
  const spec = structuredClone(geometryControl().products[0]);
  spec.constraints.minimum_safe_area.value.left_nm = '150000000';
  spec.constraints.minimum_safe_area.value.right_nm = '150000000';
  assert.equal(checkPrintSpec(sealSpec(spec), context).ok, true);
});
for (const [name, mutation, code] of [
  ['invalid clock', (v, c) => { c.now = '2026-02-30T10:00:00.000Z'; }, 'INVALID_CLOCK'],
  ['before capture', (v, c) => { c.now = '2026-10-10T09:59:59.999Z'; }, 'CLOCK_BEFORE_CAPTURE'],
  ['one ms stale', (v, c) => { c.now = '2026-10-10T11:00:00.001Z'; }, 'STALE_CAPTURE'],
  ['expiry mismatch', v => { v.freshness.fresh_until = '2026-10-10T10:59:59.999Z'; }, 'EXPIRY_MISMATCH'],
  ['nested scope', v => { v.products[0].tenant_id = '123e4567-e89b-42d3-a456-426614174099'; }, 'SCOPE_MISMATCH'],
  ['provider mismatch', v => { v.products[0].provider_id = 'fixture-provider-beta'; }, 'PROVIDER_MISMATCH'],
  ['spec hash', v => { v.products[0].spec_identity = 'sha256:' + '0'.repeat(64); }, 'SPEC_HASH_MISMATCH'],
  ['content hash', v => { v.content_identity = 'sha256:' + '0'.repeat(64); }, 'CONTENT_HASH_MISMATCH'],
  ['capture hash', v => { v.capture_identity = 'sha256:' + '0'.repeat(64); }, 'CAPTURE_HASH_MISMATCH'],
  ['duplicate product', v => { const row = structuredClone(v.products[0]); row.provider_metadata.finishCode = 'M-03'; v.products.push(row); }, 'DUPLICATE_PRODUCT']
]) test('snapshot consistency rejects ' + name, () => {
  const snapshot = structuredClone(mapped()), supplied = structuredClone(context);
  mutation(snapshot, supplied);
  const result = checkFulfillmentCapabilitySnapshot(snapshot, supplied);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.code === code), JSON.stringify(result));
});
test('snapshot freshness is inclusive at exact expiry', () => {
  const snapshot = mapped();
  assert.equal(checkFulfillmentCapabilitySnapshot(snapshot, { ...context, now: snapshot.freshness.fresh_until }).ok, true);
});
test('exact bound spec checks are consistency only and preserve source uncertainty', () => {
  const snapshot = mapped(), bound = { ...context, capture_identity: snapshot.capture_identity, content_identity: snapshot.content_identity };
  const result = checkPrintSpecBinding(snapshot.products[0], snapshot, bound);
  assert.equal(result.ok, true);
  assert.equal(result.value.constraints.geometry.printable.state, 'unknown');
  assert.equal(Object.hasOwn(result, 'eligible'), false);
  const bad = checkPrintSpecBinding(snapshot.products[0], snapshot, { ...bound, capture_identity: 'sha256:' + '0'.repeat(64) });
  assert.equal(bad.errors[0].code, 'CAPTURE_BINDING_MISMATCH');
});
for (const [target, code, path] of [['ProductionBundle/1.0.0', 'LEGACY_UNREPRESENTABLE', '/print_spec'], ['FulfillmentQuote/1.0.0', 'LEGACY_ADOPTION_PENDING', '/spec_ref'], ['OrderAuthorization/1.0.0', 'LEGACY_UNREPRESENTABLE', '/bundle_ref']]) test(target + ' translation blocks without invented legacy fields', () => {
  assert.deepEqual(translatePrintSpecToLegacy(mapped().products[0], target), { ok: false, errors: [{ code, path }] });
});
test('older production bundle cannot carry the new value or additional constraints', async () => {
  const value = structuredClone((await readJson('fixtures/ProductionBundle.json')).valid);
  value.print_spec = mapped().products[0];
  assert.equal(validateContract('ProductionBundle', value).ok, false);
});
test('public evidence strips all capability and metadata fields including restricted hashes', async () => {
  const evidence = { ...(await readJson('fixtures/EvidenceProjection.json')).valid, capability: mapped(), spec_identity: mapped().products[0].spec_identity, source: mapped().source };
  const result = projectEvidence(evidence);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, (await readJson('fixtures/EvidenceProjection.json')).valid);
  for (const secret of ['provider_metadata', 'spec_identity', 'input_hash', 'capture_identity', context.trusted_scope.tenant_id]) assert.equal(JSON.stringify(result.value).includes(secret), false);
});
