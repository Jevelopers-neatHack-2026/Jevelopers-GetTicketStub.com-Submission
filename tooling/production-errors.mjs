import { validateContract, validatePrimitive, checkTrustedContext, canonicalJson } from './runtime.mjs';
import { commerceContentHash } from './commerce-evidence.mjs';
import { DefinitionApprovalBinding } from '../generated/validators.mjs';
const records = {
  "INVALID_INPUT": {
    "safe_message": "The production input is invalid.",
    "retryable": false
  },
  "UNSUPPORTED_VERSION": {
    "safe_message": "The production version is unsupported.",
    "retryable": false
  },
  "UNSUPPORTED_PRODUCT": {
    "safe_message": "The product is unsupported.",
    "retryable": false
  },
  "INCOMPATIBLE_TEMPLATE": {
    "safe_message": "The template is incompatible.",
    "retryable": false
  },
  "APPROVAL_INVALID": {
    "safe_message": "The approval is invalid.",
    "retryable": false
  },
  "APPROVAL_REVOKED": {
    "safe_message": "The approval is revoked.",
    "retryable": false
  },
  "APPROVAL_UNAVAILABLE": {
    "safe_message": "Approval verification is unavailable.",
    "retryable": true
  },
  "ASSET_MISSING": {
    "safe_message": "A required asset is missing.",
    "retryable": false
  },
  "HASH_MISMATCH": {
    "safe_message": "A commitment does not match.",
    "retryable": false
  },
  "PREFLIGHT_FAILED": {
    "safe_message": "Mandatory preflight checks did not pass.",
    "retryable": false
  },
  "IDEMPOTENCY_CONFLICT": {
    "safe_message": "The operation key binds different inputs.",
    "retryable": false
  },
  "NOT_FOUND": {
    "safe_message": "The requested value is unavailable.",
    "retryable": false
  },
  "FORBIDDEN": {
    "safe_message": "The operation capability is denied.",
    "retryable": false
  },
  "RETRYABLE_STORAGE_FAILURE": {
    "safe_message": "Production storage is temporarily unavailable.",
    "retryable": true
  },
  "RETRYABLE_RENDER_FAILURE": {
    "safe_message": "Production rendering is temporarily unavailable.",
    "retryable": true
  },
  "OUTPUT_UNSUPPORTED": {
    "safe_message": "The output format or profile is unsupported.",
    "retryable": false
  },
  "ROW_SCHEMA": {
    "safe_message": "The row fields do not match the policy.",
    "retryable": false
  },
  "ROW_DUPLICATE": {
    "safe_message": "A row identifier is duplicated.",
    "retryable": false
  },
  "CAPABILITY_DISABLED": {
    "safe_message": "The production capability is disabled.",
    "retryable": false
  },
  "CANCELLED": {
    "safe_message": "The operation was cancelled.",
    "retryable": false
  },
  "INTEGRITY_FAILURE": {
    "safe_message": "The file inventory failed integrity checks.",
    "retryable": false
  }
};
for (const record of Object.values(records)) Object.freeze(record);
export const productionErrorRegistry = Object.freeze(records);
export const productionOk = value => ({ ok: true, value });
export const productionIssue = (code, path = '') => ({ ok: false, errors: [{ code, path }] });

/** Sanitized errors never interpolate input or exceptions. Defaults preserve uncertainty. */
export function createProductionError(code, context) {
  const record = productionErrorRegistry[code];
  if (!record) return productionIssue('INVALID_INPUT');
  const diagnostic = context.diagnostic_ref ?? { state: 'unavailable', ...context.scope, correlation_id: context.correlation_id, reason_code: 'STORAGE_UNAVAILABLE' };
  const value = { contract: 'ProductionError', schema_version: '1.0.0', policy_version: '1.0.0', module: 'print-production', operation: context.operation, code,
    ...record, diagnostic_ref: diagnostic, blocking_condition: context.blocking_condition ?? 'input', side_effects: context.side_effects ?? 'unknown', usage_state: context.usage_state ?? 'unknown',
    ...(context.field_path === undefined ? {} : { field_path: context.field_path }), ...(context.row_id === undefined ? {} : { row_id: context.row_id }) };
  return checkProductionError(value, context.scope);
}

export function checkProductionError(input, scope) {
  const parsed = validateContract('ProductionError', input);
  if (!parsed.ok) return parsed;
  const scoped = checkTrustedContext(parsed.value.diagnostic_ref, scope);
  return scoped.ok ? parsed : productionIssue('NOT_FOUND');
}

/** Separate from VersionedReference/1; no revision coercion. */
export function validateProductionReference(input) {
  const wrapper = validateContract('ProductionReference', { contract: 'ProductionReference', schema_version: '1.0.0', policy_version: '1.0.0', reference: input });
  return wrapper.ok ? productionOk(wrapper.value.reference) : wrapper;
}

export function adaptProductionRevision(input) {
  const parsed = validateProductionReference(input);
  return parsed.ok ? parsed : productionIssue('LEGACY_UNREPRESENTABLE');
}

/** Supply actual current verifier observations. No cached validity is assumed. */
export function checkProductionApproval(input, context) {
  if (!checkProductionAuthority(context, context?.scope).ok || !validatePrimitive('UtcTime', context?.now).ok || !DefinitionApprovalBinding(context?.expected_binding)) return productionIssue('INVALID_TRUST_CONTEXT');
  const receipt = validateContract('ApprovalReceipt', input?.receipt);
  if (!receipt.ok || !validatePrimitive('UtcTime', input?.checked_at).ok) return productionIssue('INVALID_INPUT');
  if (!checkTrustedContext(receipt.value, context.scope).ok) return productionIssue('NOT_FOUND');
  if (receipt.value.receipt_hash !== commerceContentHash(receipt.value, 'receipt_hash') || receipt.value.issuer !== 'getticketstub.com' || receipt.value.audience !== context.audience || receipt.value.actor_id !== context.actor_id || canonicalJson(receipt.value.binding) !== canonicalJson(context.expected_binding)) return productionIssue('APPROVAL_INVALID');
  const now = Date.parse(context.now), checked = Date.parse(input.checked_at);
  if (checked > now || checked !== now || Date.parse(receipt.value.issued_at) > now || Date.parse(receipt.value.expires_at) <= now) return productionIssue('APPROVAL_INVALID');
  switch (input.status) {
    case 'valid': return productionOk(input);
    case 'revoked': return productionIssue('APPROVAL_REVOKED');
    case 'unavailable': return productionIssue('APPROVAL_UNAVAILABLE');
    case 'rejected': case 'stale': case 'expired': return productionIssue('APPROVAL_INVALID');
    default: return productionIssue('INVALID_INPUT');
  }
}

/** Host-authenticated expectation; this check does not authenticate an identity. */
export function checkProductionAuthority(input, scope) {
  if (!checkTrustedContext(scope, scope).ok || typeof input?.actor_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.actor_id) || !['creative-engine', 'print-production', 'getticketstub.com', 'agent-harness', 'event-intelligence'].includes(input?.audience)) return productionIssue('INVALID_TRUST_CONTEXT');
  return productionOk({ actor_id: input.actor_id, audience: input.audience });
}

/** Bind returned verifier evidence to the host expectation, never the receipt identity. */
export function checkProductionHostApproval(input, context, expectedBinding, now) {
  const authority = checkProductionAuthority(context?.authority, context?.scope);
  if (!authority.ok) return authority;
  return checkProductionApproval(input, { scope: context.scope, now, expected_binding: expectedBinding, ...authority.value });
}
