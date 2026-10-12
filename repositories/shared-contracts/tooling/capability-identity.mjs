import { hashManifest } from './runtime.mjs';

// Only declared capability sets/rows are unordered. Opaque metadata arrays retain order.
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function constraintSets(constraints) {
  const copy = structuredClone(constraints);
  for (const key of ['surfaces', 'options', 'materials']) if (copy[key].state === 'known') copy[key].value.sort(compare);
  if (copy.files.state === 'known') copy.files.value.mime_types.sort(compare);
  if (copy.color.state === 'known') for (const key of ['spaces', 'profiles']) copy.color.value[key].sort(compare);
  if (copy.personalization.state === 'known') copy.personalization.value.modes.sort(compare);
  if (copy.destinations.state === 'known') {
    copy.destinations.value.sort((a, b) => compare(a.country_code, b.country_code));
    for (const row of copy.destinations.value) if (row.regions.state === 'known' && row.regions.value.mode === 'allowlist') row.regions.value.codes.sort(compare);
  }
  if (copy.shipping.state === 'known') {
    copy.shipping.value.sort((a, b) => compare(a.country_code + '\0' + (a.region_code ?? ''), b.country_code + '\0' + (b.region_code ?? '')));
    for (const row of copy.shipping.value) row.methods.sort(compare);
  }
  return copy;
}
export function specDigest(spec) {
  return hashManifest({ identity_policy: 'PrintSpec/1', provider_id: spec.provider_id, api_version: spec.api_version,
    sku: spec.sku, variant_id: spec.variant_id, availability: spec.availability,
    constraints: constraintSets(spec.constraints), provider_metadata: spec.provider_metadata });
}
export function contentDigest(snapshot) {
  return hashManifest({ identity_policy: 'FulfillmentCapabilitySnapshot/content/1', provider_id: snapshot.provider_id,
    api_version: snapshot.api_version, catalog_version: snapshot.catalog_version,
    source: { reference: snapshot.source.reference, revision: snapshot.source.revision },
    products: snapshot.products.map(spec => ({ sku: spec.sku, variant_id: spec.variant_id, spec_identity: specDigest(spec) }))
      .sort((a, b) => compare(a.sku + '\0' + a.variant_id, b.sku + '\0' + b.variant_id)) });
}
export function captureDigest(snapshot) {
  return hashManifest({ identity_policy: 'FulfillmentCapabilitySnapshot/capture/1', content_identity: contentDigest(snapshot),
    tenant_id: snapshot.tenant_id, project_id: snapshot.project_id, source: snapshot.source, freshness: snapshot.freshness });
}
