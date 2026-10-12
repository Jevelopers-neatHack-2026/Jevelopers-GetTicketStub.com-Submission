import { validateContract, validateContractVersion, parseContractVersion, canonicalJson, hashManifest, hashBytes, checkTrustedContext } from './runtime.mjs';
import { productionIssue, productionOk } from './production-errors.mjs';
import { productionArchiveLimits, safeProductionFilename, verifyProductionZip } from './production-zip.mjs';
export { productionArchiveLimits, safeProductionFilename, verifyProductionZip } from './production-zip.mjs';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const reserved = Object.freeze({ manifest: 'manifest.json', archive: 'archive.zip', detached: 'detached.json' });
const visuals = new Set(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
export const productionJsonLimits = Object.freeze({ maximum_depth: 64, maximum_tokens: 100000 });

function jsonBudget(json) {
  let depth = 0, tokens = 0, quoted = false, escaped = false, scalar = false;
  for (const character of json) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; scalar = false; tokens++; }
    else if (character === '{' || character === '[') { scalar = false; tokens++; if (++depth > productionJsonLimits.maximum_depth) return productionIssue('RESOURCE_LIMIT'); }
    else if (character === '}' || character === ']') { scalar = false; tokens++; if (--depth < 0) return productionIssue('INTEGRITY_FAILURE'); }
    else if (character === ':' || character === ',') { scalar = false; tokens++; }
    else if (/\s/.test(character)) scalar = false;
    else if (!scalar) { scalar = true; tokens++; }
    if (tokens > productionJsonLimits.maximum_tokens) return productionIssue('RESOURCE_LIMIT');
  }
  return quoted || depth !== 0 ? productionIssue('INTEGRITY_FAILURE') : productionOk(json);
}
export function productionBundleContentHash(value) {
  return hashManifest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'bundle_hash')));
}
export function productionPayloadSetHash(files) {
  return hashManifest(files.map(({ filename, byte_hash, byte_size }) => ({ filename, byte_hash, byte_size })).sort((a, b) => a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
}

export function checkProductionFile(input) {
  const parsed = validateContractVersion('ArtifactFile', '2.0.0', input);
  if (!parsed.ok) return parsed;
  if (!safeProductionFilename(input.filename)) return productionIssue('INTEGRITY_FAILURE');
  if (Object.hasOwn(reserved, input.role) ? input.filename !== reserved[input.role] : Object.values(reserved).some(name => name.toLowerCase() === input.filename.toLowerCase())) return productionIssue('INTEGRITY_FAILURE');
  if (!visuals.has(input.media_type) && (input.geometry !== null || input.characteristics !== null || input.profile_ref !== null)) return productionIssue('INTEGRITY_FAILURE');
  if (['manifest', 'detached', 'preflight_report', 'lineage'].includes(input.role) && input.media_type !== 'application/json') return productionIssue('INTEGRITY_FAILURE');
  if (input.role === 'archive' && input.media_type !== 'application/zip') return productionIssue('INTEGRITY_FAILURE');
  if (['print_output', 'source_artwork', 'display_preview', 'composed_preview'].includes(input.role) && !visuals.has(input.media_type)) return productionIssue('INTEGRITY_FAILURE');
  return parsed;
}

function inventory(files, maximum) {
  if (!Array.isArray(files) || files.length > maximum || files.length < 1) return productionIssue('RESOURCE_LIMIT');
  if (new Set(files.map(file => file.filename?.toLowerCase())).size !== files.length || new Set(files.map(file => file.artifact_id)).size !== files.length) return productionIssue('INTEGRITY_FAILURE');
  for (const file of files) { const checked = checkProductionFile(file); if (!checked.ok) return checked; }
  return productionOk(files);
}

/** Exact canonical raw UTF-8, duplicate members and invalid Unicode fail before hashing. */
export function parseProductionCanonicalBytes(contract, version, bytes, maximum) {
  const ceiling = contract === 'ProductionBundle' && version === '2.0.0' ? productionArchiveLimits.manifest_bytes : contract === 'ProductionBundleDetached' && version === '1.0.0' ? productionArchiveLimits.detached_bytes : null;
  if (ceiling === null) return productionIssue('UNSUPPORTED_VERSION');
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > ceiling || bytes.byteLength > maximum) return productionIssue('RESOURCE_LIMIT');
  let json;
  try { json = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch (error) { if (error instanceof TypeError) return productionIssue('INTEGRITY_FAILURE'); throw error; }
  const budget = jsonBudget(json);
  if (!budget.ok) return budget;
  const parsed = parseContractVersion(contract, version, json);
  if (!parsed.ok || canonicalJson(parsed.value) !== json) return productionIssue('INTEGRITY_FAILURE');
  return parsed;
}

export function checkProductionBundleV2(input, scope) {
  if (Array.isArray(input?.files) && input.files.length > productionArchiveLimits.payloads) return productionIssue('RESOURCE_LIMIT');
  const parsed = validateContractVersion('ProductionBundle', '2.0.0', input);
  if (!parsed.ok) return parsed;
  if (!checkTrustedContext(input, scope).ok) return productionIssue('NOT_FOUND');
  if (productionBundleContentHash(input) !== input.bundle_hash) return productionIssue('HASH_MISMATCH');
  const checked = inventory(input.files, productionArchiveLimits.payloads);
  if (!checked.ok) return checked;
  if (input.files.some(file => Object.hasOwn(reserved, file.role) || file.media_type === 'application/zip')) return productionIssue('INTEGRITY_FAILURE');
  if (input.files.some(file => file.byte_size > productionArchiveLimits.entry_bytes) || input.files.reduce((sum, file) => sum + file.byte_size, 0) > productionArchiveLimits.payload_bytes) return productionIssue('RESOURCE_LIMIT');
  if (!input.files.some(file => file.role === 'print_output') || input.files.filter(file => file.role === 'lineage').length !== 1 || input.files.filter(file => file.role === 'preflight_report').length !== 1) return productionIssue('INTEGRITY_FAILURE');
  if (input.files.find(file => file.role === 'lineage').byte_hash !== input.lineage_ref.content_hash || input.files.find(file => file.role === 'preflight_report').semantic_hash !== input.preflight.report_ref.content_hash || input.composition.composition_hash !== input.composition_ref.content_hash || input.composition.facts_hash !== input.facts_ref.content_hash) return productionIssue('HASH_MISMATCH');
  if (!input.files.some(file => file.role === 'print_output' && file.media_type === 'image/svg+xml' && file.byte_hash === input.composition.render_hash)) return productionIssue('HASH_MISMATCH');
  return parsed;
}

/** Outer commitments must come from a trusted publication record, separately from these bytes. */
export function verifyProductionBundleFiles(input, context) {
  const limits = productionArchiveLimits;
  if (!Array.isArray(input) || input.length > limits.outer_descriptors || !context?.trusted_commitment) return productionIssue('INTEGRITY_FAILURE');
  const trusted = validateContract('ProductionBundleRef', context.trusted_commitment);
  if (!trusted.ok) return productionIssue('INVALID_TRUST_CONTEXT');
  const outer = inventory(trusted.value.file_set, limits.outer_descriptors);
  if (!outer.ok) return outer;
  for (const file of input) {
    if (file === null || typeof file !== 'object' || Array.isArray(file) || !safeProductionFilename(file.filename) || !(file.bytes instanceof Uint8Array)) return productionIssue('INTEGRITY_FAILURE');
  }
  if (new Set(input.map(file => file.filename?.toLowerCase())).size !== input.length || input.length !== outer.value.length) return productionIssue('INTEGRITY_FAILURE');
  const actual = new Map();
  for (const observed of input) {
    const descriptor = outer.value.find(file => file.filename === observed.filename);
    if (!descriptor || !(observed.bytes instanceof Uint8Array)) return productionIssue('INTEGRITY_FAILURE');
    const bound = descriptor.role === 'archive' ? limits.archive_bytes : descriptor.role === 'manifest' ? limits.manifest_bytes : descriptor.role === 'detached' ? limits.detached_bytes : limits.entry_bytes;
    if (observed.bytes.byteLength > bound) return productionIssue('RESOURCE_LIMIT');
    if (observed.bytes.byteLength !== descriptor.byte_size || hashBytes(observed.bytes) !== descriptor.byte_hash) return productionIssue('INTEGRITY_FAILURE');
    actual.set(observed.filename, observed.bytes);
  }
  const manifest = parseProductionCanonicalBytes('ProductionBundle', '2.0.0', actual.get('manifest.json'), limits.manifest_bytes);
  if (!manifest.ok) return manifest;
  const bundle = checkProductionBundleV2(manifest.value, context.scope);
  if (!bundle.ok) return bundle;
  const b = bundle.value, committed = trusted.value.bundle_ref;
  if (committed.id !== b.bundle_id || committed.revision !== b.bundle_version || committed.content_hash !== b.bundle_hash || !same(trusted.value.composition_ref, b.composition_ref) || !same(trusted.value.row_scope, b.row_scope)) return productionIssue('INTEGRITY_FAILURE');
  const metadata = Object.fromEntries(Object.keys(reserved).map(role => [role, outer.value.find(file => file.role === role)]));
  if (Object.keys(reserved).some(role => outer.value.filter(file => file.role === role).length !== 1)) return productionIssue('INTEGRITY_FAILURE');
  const payloads = outer.value.filter(file => !Object.hasOwn(reserved, file.role));
  if (!same([...payloads].sort((a,b) => a.filename.localeCompare(b.filename, 'en')), [...b.files].sort((a,b) => a.filename.localeCompare(b.filename, 'en')))) return productionIssue('INTEGRITY_FAILURE');
  const zip = verifyProductionZip(actual.get('archive.zip'), [...b.files, metadata.manifest]);
  if (!zip.ok) return zip;
  const detached = parseProductionCanonicalBytes('ProductionBundleDetached', '1.0.0', actual.get('detached.json'), limits.detached_bytes);
  if (!detached.ok) return detached;
  const d = detached.value;
  if (!same(d.bundle_ref, committed) || !same(d.manifest, metadata.manifest) || !same(d.archive, metadata.archive) || d.lineage_hash !== b.lineage_ref.content_hash || d.payload_set_hash !== productionPayloadSetHash(b.files) || trusted.value.detached_ref.content_hash !== metadata.detached.byte_hash) return productionIssue('INTEGRITY_FAILURE');
  return productionOk({ bundle: b, detached: d, integrity: 'passed', eligibility: 'blocked', reasons: ['OWNER_ACCEPTANCE_PENDING'], evidence_mode: 'byte_verification_only' });
}

/** V1 has no representation of this protocol; no lossy migration. */
export function translateProductionBundleV2ToV1(input) {
  const parsed = validateContractVersion('ProductionBundle', '2.0.0', input);
  return parsed.ok ? productionIssue('LEGACY_UNREPRESENTABLE') : parsed;
}
