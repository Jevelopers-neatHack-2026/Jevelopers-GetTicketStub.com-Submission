import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptFulfillmentCatalogV1, deriveCapabilityIdentities, hashPrintSpec } from '../tooling/capability.mjs';

export const sources = JSON.parse(await readFile(new URL('../compatibility/capability-source-fixtures.json', import.meta.url), 'utf8'));
export const context = Object.freeze({ trusted_scope: Object.freeze({ tenant_id: '123e4567-e89b-42d3-a456-426614174001', project_id: '123e4567-e89b-42d3-a456-426614174002' }), now: '2026-10-10T10:30:00.000Z' });
export function mapped(source = sources.alpha) {
  const result = adaptFulfillmentCatalogV1(source, context);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
export function sealSnapshot(value) {
  const copy = structuredClone(value);
  const result = deriveCapabilityIdentities(copy);
  assert.equal(result.ok, true, JSON.stringify(result));
  copy.products.forEach((spec, index) => { spec.spec_identity = result.value.spec_identities[index]; });
  copy.content_identity = result.value.content_identity;
  copy.capture_identity = result.value.capture_identity;
  return copy;
}
export function sealSpec(value) {
  const copy = structuredClone(value);
  const result = hashPrintSpec(copy);
  assert.equal(result.ok, true, JSON.stringify(result));
  copy.spec_identity = result.value;
  return copy;
}
export function geometryControl() {
  const copy = structuredClone(mapped());
  const c = copy.products[0].constraints;
  c.geometry.trim = { state: 'known', value: { width_nm: '304800000', height_nm: '457200000', unit: 'nm', evidence_ref: 'fixture:generic-known-trim-control' } };
  c.geometry.printable = { state: 'known', value: { width_nm: '310800000', height_nm: '463200000', unit: 'nm', evidence_ref: 'fixture:generic-known-printable-control' } };
  c.inset_geometry_basis = { state: 'known', value: 'trim' };
  return sealSnapshot(copy);
}
