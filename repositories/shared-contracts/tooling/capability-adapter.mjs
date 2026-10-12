import { hashManifest, checkTrustedContext } from './runtime.mjs';
import { boundary, ownedData, exactRecord, fail, utcEpoch } from './capability-data.mjs';
import { checkFulfillmentCapabilitySnapshot, deriveCapabilityIdentities } from './capability.mjs';

const inputFields = ['dimensions', 'minimumBleed', 'minimumSafeArea', 'minimumResolutionDpi', 'surfaces', 'files', 'color', 'options', 'materials', 'personalization', 'destinations', 'shipping'];
const outputFields = ['physical_dimensions', 'minimum_bleed', 'minimum_safe_area', 'minimum_resolution_dpi', 'surfaces', 'files', 'color', 'options', 'materials', 'personalization', 'destinations', 'shipping'];
const unknownGeometry = () => ({ state: 'unknown', reason_code: 'not_in_source' });
function nanometres(value, unit) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/.test(value)) fail('INVALID_PHYSICAL_DECIMAL');
  let factor;
  switch (unit) {
    case 'mm': factor = 1000000n; break;
    case 'cm': factor = 10000000n; break;
    case 'in': factor = 25400000n; break;
    default: fail('UNSUPPORTED_PHYSICAL_UNIT');
  }
  const [whole, fraction = ''] = value.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction) * factor;
  if (numerator % denominator !== 0n) fail('INEXACT_PHYSICAL_UNIT');
  const length = numerator / denominator;
  if (length > 2000000000n) fail('PHYSICAL_RANGE');
  return length.toString();
}
export function convertPhysicalLength(input) {
  return boundary(() => {
    const data = exactRecord(ownedData(input), ['value', 'unit']);
    return { ok: true, value: nanometres(data.value, data.unit) };
  });
}
function mappedKnown(field, value) {
  switch (field) {
    case 'dimensions': {
      const data = exactRecord(value, ['width', 'height', 'depth', 'unit']);
      return { width_nm: nanometres(data.width, data.unit), height_nm: nanometres(data.height, data.unit), depth_nm: nanometres(data.depth, data.unit), unit: 'nm', basis: 'unspecified_physical_product' };
    }
    case 'minimumBleed': case 'minimumSafeArea': {
      const data = exactRecord(value, ['top', 'right', 'bottom', 'left', 'unit']);
      return { top_nm: nanometres(data.top, data.unit), right_nm: nanometres(data.right, data.unit), bottom_nm: nanometres(data.bottom, data.unit), left_nm: nanometres(data.left, data.unit), unit: 'nm' };
    }
    case 'files': {
      const data = exactRecord(value, ['types', 'minimumCount', 'maximumCount']);
      return { mime_types: data.types, minimum_count: data.minimumCount, maximum_count: data.maximumCount };
    }
    case 'color': return exactRecord(value, ['spaces', 'profiles']);
    case 'personalization': {
      const data = exactRecord(value, ['modes', 'maximumFields', 'maximumCharactersPerField']);
      return { modes: data.modes, maximum_fields: data.maximumFields, maximum_characters_per_field: data.maximumCharactersPerField };
    }
    case 'destinations': {
      if (!Array.isArray(value)) fail('INVALID_PAYLOAD');
      return value.map(row => {
        const data = exactRecord(row, ['countryCode', 'regions']);
        const regions = mappedState('regions', data.regions);
        return { country_code: data.countryCode, regions };
      });
    }
    case 'regions':
      if (!Array.isArray(value)) fail('INVALID_PAYLOAD');
      return value.length === 0 ? { mode: 'unrestricted' } : { mode: 'allowlist', codes: value };
    case 'shipping':
      if (!Array.isArray(value)) fail('INVALID_PAYLOAD');
      return value.map(row => {
        const data = exactRecord(row, ['countryCode', 'regionCode', 'methods']);
        return { country_code: data.countryCode, region_code: data.regionCode, methods: data.methods };
      });
    case 'minimumResolutionDpi': case 'surfaces': case 'options': case 'materials': return value;
    default: fail('UNSUPPORTED_SOURCE_FIELD');
  }
}
function mappedState(field, input) {
  if (!input || typeof input !== 'object') fail('INVALID_PAYLOAD');
  switch (input.state) {
    case 'known': {
      const data = exactRecord(input, ['state', 'value']);
      return { state: 'known', value: mappedKnown(field, data.value) };
    }
    case 'unknown': case 'unsupported': {
      const data = exactRecord(input, ['state', 'reasonCode']);
      return { state: data.state, reason_code: data.reasonCode };
    }
    default: fail('INVALID_PAYLOAD');
  }
}
/** Explicit field adapter for the one received private development version. No I/O or selection. */
export function adaptFulfillmentCatalogV1(input, context) {
  return boundary(() => {
    const supplied = ownedData(context);
    const scope = supplied?.trusted_scope;
    const scopeResult = checkTrustedContext(scope, scope);
    if (!scopeResult.ok) return scopeResult;
    const raw = exactRecord(ownedData(input), ['localFormat', 'providerId', 'apiVersion', 'catalogVersion', 'source', 'freshness', 'products']);
    if (raw.localFormat !== 'connector-development-catalog/1') fail('UNSUPPORTED_SOURCE_VERSION', '/localFormat');
    const source = exactRecord(raw.source, ['reference', 'revision', 'retrievedAt', 'evidenceMode', 'evidenceReference']);
    const freshness = exactRecord(raw.freshness, ['maximumAgeSeconds']);
    if (!Number.isSafeInteger(freshness.maximumAgeSeconds) || freshness.maximumAgeSeconds < 1 || freshness.maximumAgeSeconds > 31536000) fail('INVALID_PAYLOAD', '/freshness');
    const expiry = utcEpoch(source.retrievedAt) + freshness.maximumAgeSeconds * 1000;
    if (expiry > 253402300799999) fail('INVALID_CLOCK', '/freshness');
    if (!Array.isArray(raw.products)) fail('INVALID_PAYLOAD', '/products');
    const products = raw.products.map(inputProduct => {
      const product = exactRecord(inputProduct, ['sku', 'variantId', 'availability', 'constraints', 'providerAttributes']);
      const constraints = exactRecord(product.constraints, inputFields);
      const mapped = Object.fromEntries(inputFields.map((field, index) => [outputFields[index], mappedState(field, constraints[field])]));
      mapped.geometry = { trim: unknownGeometry(), printable: unknownGeometry(), outer_frame: unknownGeometry() };
      mapped.inset_geometry_basis = unknownGeometry();
      const spec = { contract: 'PrintSpec', schema_version: '1.0.0', policy_version: '1.0.0', tenant_id: scope.tenant_id, project_id: scope.project_id,
        provider_id: raw.providerId, api_version: raw.apiVersion, sku: product.sku, variant_id: product.variantId, availability: product.availability,
        constraints: mapped, provider_metadata: product.providerAttributes };
      // Hash only after generated structural/consistency validation at the final boundary below.
      spec.spec_identity = 'sha256:' + '0'.repeat(64);
      return spec;
    });
    const snapshot = { contract: 'FulfillmentCapabilitySnapshot', schema_version: '1.0.0', policy_version: '1.0.0', tenant_id: scope.tenant_id, project_id: scope.project_id,
      provider_id: raw.providerId, api_version: raw.apiVersion, catalog_version: raw.catalogVersion,
      source: { reference: source.reference, revision: source.revision, retrieved_at: source.retrievedAt, evidence_mode: source.evidenceMode, evidence_reference: source.evidenceReference, input_hash: hashManifest(raw) },
      freshness: { maximum_age_seconds: freshness.maximumAgeSeconds, fresh_until: new Date(expiry).toISOString() }, products,
      content_identity: 'sha256:' + '0'.repeat(64), capture_identity: 'sha256:' + '0'.repeat(64) };
    // Derivation first validates the entire mapped candidate; no normalizer/service is ported.
    const derived = deriveCapabilityIdentities(snapshot);
    if (!derived.ok) return derived;
    snapshot.products.forEach((spec, index) => { spec.spec_identity = derived.value.spec_identities[index]; });
    snapshot.content_identity = derived.value.content_identity;
    snapshot.capture_identity = derived.value.capture_identity;
    return checkFulfillmentCapabilitySnapshot(snapshot, supplied);
  });
}
