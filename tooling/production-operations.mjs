import { validateContract, validatePrimitive, checkTrustedContext, canonicalJson, hashManifest, ContractError } from './runtime.mjs';
import { productionIssue, productionOk, validateProductionReference, checkProductionAuthority } from './production-errors.mjs';
import { checkProductionValueIntegrity } from './production-values.mjs';
export { productionErrorRegistry, createProductionError, checkProductionError, validateProductionReference, adaptProductionRevision, checkProductionApproval, checkProductionAuthority, checkProductionHostApproval } from './production-errors.mjs';
export * from './production-values.mjs';
export * from './production-rows.mjs';
export * from './production-bundle.mjs';
export * from './production-csv.mjs';
export * from './production-preflight.mjs';
export * from './production-error-adapter.mjs';

export const productionRequests = Object.freeze({ composeArtifact: 'ComposeArtifactRequest', personalizeArtifactBatch: 'PersonalizeBatchRequest', inspectArtifact: 'InspectArtifactRequest', exportArtifactBundle: 'ExportBundleRequest', compareTemplateCompatibility: 'CompareTemplateRequest', getArtifactManifestStatus: 'ArtifactStatusRequest' });
const values = Object.freeze({ composeArtifact: ['ArtifactRef'], personalizeArtifactBatch: ['JobRef', 'BatchResult'], inspectArtifact: ['PreflightReport'], exportArtifactBundle: ['ProductionBundleRef'], compareTemplateCompatibility: ['CompatibilityReport'], getArtifactManifestStatus: ['ArtifactManifestStatus'] });

export function productionReferences(value, path = '') {
  if (value === null || typeof value !== 'object') return [];
  if (Object.hasOwn(value, 'content_hash') && Object.hasOwn(value, 'id') && Object.hasOwn(value, 'schema_version')) return [[path, value]];
  return Object.entries(value).flatMap(([key, child]) => productionReferences(child, path + '/' + key));
}

/** Structural/scope checks consume supplied values only; no resolver or host port is called. */
export function checkProductionRequest(operation, input, context) {
  const contract = productionRequests[operation];
  if (!contract) return productionIssue('UNSUPPORTED_VERSION');
  const parsed = validateContract(contract, input);
  if (!parsed.ok) {
    if (parsed.errors.some(error => error.code === 'UNSUPPORTED_VERSION')) return productionIssue('UNSUPPORTED_VERSION', '/schema_version');
    const unsupportedFormatOnly = parsed.errors.length > 0 && parsed.errors.every(error => error.keyword === 'enum' && /^\/formats\/\d+$/.test(error.path));
    return productionIssue(unsupportedFormatOnly ? 'OUTPUT_UNSUPPORTED' : 'INVALID_INPUT');
  }
  if (!checkTrustedContext(context?.scope, context?.scope).ok || context.policy_version !== '1.0.0') return productionIssue('INVALID_TRUST_CONTEXT');
  const intrinsic = checkProductionValueIntegrity(contract, parsed.value, context.scope);
  if (!intrinsic.ok) return intrinsic;
  for (const [path, reference] of productionReferences(parsed.value)) {
    const expected = context.references?.[path];
    if (!validateProductionReference(expected).ok) return productionIssue('NOT_FOUND');
    if (canonicalJson(reference) !== canonicalJson(expected)) return productionIssue('NOT_FOUND');
  }
  return parsed;
}

/** Gate host and request data before the host invokes any resolver or service port. */
export function checkProductionHostRequest(operation, input, context, references) {
  const authority = checkProductionAuthority(context?.authority, context?.scope);
  if (!authority.ok) return authority;
  return checkProductionRequest(operation, input, { scope: context.scope, policy_version: context.policy_version, references });
}

/** Validate concrete negotiated value/error constituents, never a fictitious JSON generic. */
export function validateProductionResult(operation, input, scope) {
  try { canonicalJson(input); } catch (error) { if (error instanceof ContractError) return productionIssue('INVALID_INPUT'); throw error; }
  if (!Object.hasOwn(values, operation) || input === null || typeof input !== 'object' || Array.isArray(input)) return productionIssue('INVALID_INPUT');
  if (input.ok === false && Object.keys(input).length === 2 && Object.hasOwn(input, 'error')) {
    const checked = validateContract('ProductionError', input.error);
    if (!checked.ok || checked.value.operation !== operation || !checkTrustedContext(checked.value.diagnostic_ref, scope).ok) return productionIssue('INVALID_INPUT');
    return productionOk(input);
  }
  if (input.ok !== true || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'value') || !values[operation].includes(input.value?.contract)) return productionIssue('INVALID_INPUT');
  const checked = checkProductionValueIntegrity(input.value.contract, input.value, scope);
  return checked.ok ? productionOk(input) : checked;
}

/** No persistence, replay, key reuse, authority refresh or paid execution. */
export function productionSemanticDigest(operation, input, pins) {
  const contract = productionRequests[operation];
  if (!contract || !validateContract(contract, input).ok || !validateContract('ProductionExecutionPins', pins).ok) return productionIssue('INVALID_INPUT');
  if (!checkTrustedContext(pins, { tenant_id: pins.tenant_id, project_id: pins.project_id }).ok) return productionIssue('INVALID_TRUST_CONTEXT');
  const intrinsic = checkProductionValueIntegrity('ProductionExecutionPins', pins, { tenant_id: pins.tenant_id, project_id: pins.project_id });
  if (!intrinsic.ok) return intrinsic;
  const { request_id, correlation_id, idempotency_key, ...semantic } = input;
  if (operation === 'personalizeArtifactBatch') semantic.acceptance_policy = input.acceptance_policy ?? 'atomic';
  return productionOk(hashManifest({ operation, input: semantic, pins }));
}

export function compareProductionIdempotency(input, prior) {
  for (const value of [input, prior]) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return productionIssue('INVALID_INPUT');
    try { canonicalJson(value); }
    catch (error) { if (error instanceof ContractError) return productionIssue('INVALID_INPUT'); throw error; }
    if (!checkTrustedContext(value, { tenant_id: value.tenant_id, project_id: value.project_id }).ok ||
        typeof value.operation !== 'string' || !Object.hasOwn(productionRequests, value.operation) ||
        typeof value.idempotency_key !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}(?![\s\S])/.test(value.idempotency_key) ||
        !validatePrimitive('Sha256', value.digest).ok) return productionIssue('INVALID_INPUT');
  }
  const fields = ['tenant_id', 'project_id', 'operation', 'idempotency_key'];
  if (!fields.every(key => input[key] === prior[key])) return productionIssue('NOT_FOUND');
  return input.digest === prior.digest ? productionOk({ relationship: 'same_input', replay_authorized: false }) : productionIssue('IDEMPOTENCY_CONFLICT');
}
