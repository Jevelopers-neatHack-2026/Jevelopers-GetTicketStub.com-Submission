import { canonicalJson } from './runtime.mjs';
import { fail } from './capability-data.mjs';

const secretKey = /(?:authorization|credential|secret|token|password|email|phone|address|street|recipient|customer|contact|postal.?code|zip.?code|signed.?url|access.?key|api.?key|__proto__|constructor|prototype)/i;
const privateValue = /(?:https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\bbearer\s+[A-Za-z0-9._~-]{8,}|\bsk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----|\b\d{1,6}\s+[A-Za-z0-9.' -]{2,64}\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr)\b|(?:^|\D)\+?\d[\d\s().-]{8,}\d(?:\D|$))/i;
export function safeMetadata(value) {
  if (Buffer.byteLength(canonicalJson(value)) > 32000) fail('RESOURCE_LIMIT', '/provider_metadata');
  function scan(entry) {
    if (typeof entry === 'number' && !Number.isSafeInteger(entry)) fail('INVALID_PAYLOAD', '/provider_metadata');
    if (typeof entry === 'string' && (privateValue.test(entry) || /[\u0000-\u001f\u007f]/.test(entry))) fail('PRIVATE_METADATA', '/provider_metadata');
    if (Array.isArray(entry)) { for (const child of entry) scan(child); }
    else if (entry !== null && typeof entry === 'object') {
      for (const [key, child] of Object.entries(entry)) {
        if (secretKey.test(key)) fail('PRIVATE_METADATA', '/provider_metadata');
        scan(child);
      }
    }
  }
  scan(value);
}
export function consistency(spec) {
  const c = spec.constraints;
  safeMetadata(spec.provider_metadata);
  for (const key of ['physical_dimensions', 'minimum_bleed', 'minimum_safe_area']) {
    if (c[key].state === 'known') for (const [field, value] of Object.entries(c[key].value)) {
      if (field.endsWith('_nm') && BigInt(value) > 2000000000n) fail('PHYSICAL_RANGE', '/constraints/' + key);
    }
  }
  for (const shape of Object.values(c.geometry)) if (shape.state === 'known' && (BigInt(shape.value.width_nm) > 2000000000n || BigInt(shape.value.height_nm) > 2000000000n)) fail('PHYSICAL_RANGE', '/constraints/geometry');
  if (c.inset_geometry_basis.state === 'known') {
    const shape = c.geometry[c.inset_geometry_basis.value];
    if (shape.state !== 'known') fail('GEOMETRY_UNCONFIRMED', '/constraints/inset_geometry_basis');
    if (c.minimum_safe_area.state === 'known') {
      const safe = c.minimum_safe_area.value;
      if (BigInt(safe.left_nm) + BigInt(safe.right_nm) >= BigInt(shape.value.width_nm) || BigInt(safe.top_nm) + BigInt(safe.bottom_nm) >= BigInt(shape.value.height_nm)) fail('IMPOSSIBLE_SAFE_GEOMETRY', '/constraints/minimum_safe_area');
    }
  }
  if (c.files.state === 'known' && c.files.value.minimum_count > c.files.value.maximum_count) fail('CONTRADICTORY_CONSTRAINT', '/constraints/files');
  if (c.personalization.state === 'known') {
    const p = c.personalization.value;
    if ((p.modes.length === 0) !== (p.maximum_fields === 0) || (p.modes.length === 0) !== (p.maximum_characters_per_field === 0)) fail('CONTRADICTORY_CONSTRAINT', '/constraints/personalization');
  }
  if (c.destinations.state === 'known') {
    const rows = c.destinations.value;
    if (new Set(rows.map(row => row.country_code)).size !== rows.length) fail('DUPLICATE_ROUTE', '/constraints/destinations');
    if (c.shipping.state === 'known') for (const route of c.shipping.value) {
      const country = rows.find(row => row.country_code === route.country_code);
      if (!country || (route.region_code !== null && country.regions.state === 'unsupported') ||
        (route.region_code !== null && country.regions.state === 'known' && country.regions.value.mode === 'allowlist' && !country.regions.value.codes.includes(route.region_code))) fail('CONTRADICTORY_ROUTE', '/constraints/shipping');
    }
  }
  if (c.shipping.state === 'known' && new Set(c.shipping.value.map(row => row.country_code + '\0' + (row.region_code ?? ''))).size !== c.shipping.value.length) fail('DUPLICATE_ROUTE', '/constraints/shipping');
}
