import { validateContractVersion, checkTrustedContext, canonicalJson } from './runtime.mjs';
import { boundary, ownedData, rejected, fail, utcEpoch } from './capability-data.mjs';
import { specDigest, contentDigest, captureDigest } from './capability-identity.mjs';
import { consistency } from './capability-consistency.mjs';

function decoded(contract, value) {
  const result = validateContractVersion(contract, '1.0.0', ownedData(value));
  if (!result.ok) return result;
  const specs = contract === 'PrintSpec' ? [result.value] : result.value.products;
  for (const spec of specs) consistency(spec);
  return result;
}
function scope(value, context) {
  const supplied = ownedData(context);
  const checked = checkTrustedContext(value, supplied?.trusted_scope);
  if (!checked.ok) fail(checked.errors[0].code, checked.errors[0].path);
  return supplied;
}
export function hashPrintSpec(value) {
  return boundary(() => {
    const result = decoded('PrintSpec', value);
    return result.ok ? { ok: true, value: specDigest(result.value) } : result;
  });
}
export function deriveCapabilityIdentities(value) {
  return boundary(() => {
    const result = decoded('FulfillmentCapabilitySnapshot', value);
    if (!result.ok) return result;
    return { ok: true, value: { spec_identities: result.value.products.map(specDigest), content_identity: contentDigest(result.value), capture_identity: captureDigest(result.value) } };
  });
}
export function checkPrintSpec(value, context) {
  return boundary(() => {
    const result = decoded('PrintSpec', value);
    if (!result.ok) return result;
    scope(result.value, context);
    if (specDigest(result.value) !== result.value.spec_identity) fail('SPEC_HASH_MISMATCH', '/spec_identity');
    return result;
  });
}
export function checkFulfillmentCapabilitySnapshot(value, context) {
  return boundary(() => {
    const result = decoded('FulfillmentCapabilitySnapshot', value);
    if (!result.ok) return result;
    const snapshot = result.value;
    const supplied = scope(snapshot, context);
    const now = utcEpoch(supplied.now), retrieved = utcEpoch(snapshot.source.retrieved_at), expiry = utcEpoch(snapshot.freshness.fresh_until);
    if (expiry !== retrieved + snapshot.freshness.maximum_age_seconds * 1000) fail('EXPIRY_MISMATCH', '/freshness/fresh_until');
    if (now < retrieved) fail('CLOCK_BEFORE_CAPTURE', '/now');
    if (now > expiry) fail('STALE_CAPTURE', '/freshness/fresh_until');
    if (new Set(snapshot.products.map(spec => spec.sku + '\0' + spec.variant_id)).size !== snapshot.products.length) fail('DUPLICATE_PRODUCT', '/products');
    for (const field of ['reference', 'revision', 'evidence_reference']) if (/(?:https?:|\?|=|%)/i.test(snapshot.source[field])) fail('PRIVATE_METADATA', '/source/' + field);
    for (const spec of snapshot.products) {
      if (spec.provider_id !== snapshot.provider_id || spec.api_version !== snapshot.api_version) fail('PROVIDER_MISMATCH', '/products');
      const scoped = checkTrustedContext(spec, supplied.trusted_scope);
      if (!scoped.ok) return scoped;
      if (specDigest(spec) !== spec.spec_identity) fail('SPEC_HASH_MISMATCH', '/products');
    }
    if (contentDigest(snapshot) !== snapshot.content_identity) fail('CONTENT_HASH_MISMATCH', '/content_identity');
    if (captureDigest(snapshot) !== snapshot.capture_identity) fail('CAPTURE_HASH_MISMATCH', '/capture_identity');
    return result;
  });
}
/** Exact cross-record binding, without product discovery, selection, rendering or order authority. */
export function checkPrintSpecBinding(value, snapshotValue, context) {
  return boundary(() => {
    const spec = checkPrintSpec(value, context);
    if (!spec.ok) return spec;
    const snapshot = checkFulfillmentCapabilitySnapshot(snapshotValue, context);
    if (!snapshot.ok) return snapshot;
    const supplied = ownedData(context);
    if (supplied.capture_identity !== snapshot.value.capture_identity || supplied.content_identity !== snapshot.value.content_identity) fail('CAPTURE_BINDING_MISMATCH', '/capture_identity');
    const product = snapshot.value.products.find(row => row.sku === spec.value.sku && row.variant_id === spec.value.variant_id);
    if (!product) fail('PRODUCT_MISSING', '/sku');
    if (product.spec_identity !== spec.value.spec_identity) fail('SPEC_DRIFT', '/spec_identity');
    if (product.availability !== 'available') fail('AVAILABILITY_UNCONFIRMED', '/availability');
    return spec;
  });
}
/** Compares captures only; source change does not assert material drift or authenticate either source. */
export function compareFulfillmentCaptures(priorValue, currentValue, context) {
  return boundary(() => {
    const current = checkFulfillmentCapabilitySnapshot(currentValue, context);
    if (!current.ok) return current;
    // An old capture may be expired; still verify its immutable structure and hashes at its own expiry.
    const priorData = decoded('FulfillmentCapabilitySnapshot', priorValue);
    if (!priorData.ok) return priorData;
    const supplied = scope(priorData.value, context);
    const prior = checkFulfillmentCapabilitySnapshot(priorData.value, { trusted_scope: supplied.trusted_scope, now: priorData.value.freshness.fresh_until });
    if (!prior.ok) return prior;
    if (current.value.provider_id !== prior.value.provider_id || current.value.api_version !== prior.value.api_version) fail('PROVIDER_MISMATCH', '/provider_id');
    if (utcEpoch(current.value.source.retrieved_at) < utcEpoch(prior.value.source.retrieved_at)) fail('CAPTURE_CLOCK_REGRESSION', '/source/retrieved_at');
    const ids = new Map(prior.value.products.map(row => [row.sku + '\0' + row.variant_id, row.spec_identity]));
    const changed = current.value.products.filter(row => ids.get(row.sku + '\0' + row.variant_id) !== row.spec_identity).map(row => ({ sku: row.sku, variant_id: row.variant_id }));
    for (const row of prior.value.products) if (!current.value.products.some(next => next.sku === row.sku && next.variant_id === row.variant_id)) changed.push({ sku: row.sku, variant_id: row.variant_id });
    const status = changed.length ? 'material_drift' : prior.value.content_identity !== current.value.content_identity ? 'source_or_catalog_change' : prior.value.capture_identity !== current.value.capture_identity ? 'capture_refresh' : 'unchanged';
    return { ok: true, value: { status, changed_products: changed.sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0) } };
  });
}
/** Lossless legacy conversion is unavailable: numeric units and missing constraints lose canonical meaning. */
export function translatePrintSpecToLegacy(value, target) {
  return boundary(() => {
    const result = decoded('PrintSpec', value);
    if (!result.ok) return result;
    switch (target) {
      case 'ProductionBundle/1.0.0': return rejected('LEGACY_UNREPRESENTABLE', '/print_spec');
      case 'FulfillmentQuote/1.0.0': return rejected('LEGACY_ADOPTION_PENDING', '/spec_ref');
      case 'OrderAuthorization/1.0.0': return rejected('LEGACY_UNREPRESENTABLE', '/bundle_ref');
      default: return rejected('UNSUPPORTED_LEGACY_TARGET', '');
    }
  });
}
export { adaptFulfillmentCatalogV1, convertPhysicalLength } from './capability-adapter.mjs';
