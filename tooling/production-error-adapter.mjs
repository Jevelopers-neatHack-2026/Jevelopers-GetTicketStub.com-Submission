import { validateContract } from './runtime.mjs';
import { errorRegistry } from '../generated/error-registry.mjs';
import { checkProductionError, productionIssue, productionOk } from './production-errors.mjs';

const codes=Object.freeze({ INVALID_INPUT:'INVALID_PAYLOAD',UNSUPPORTED_VERSION:'UNSUPPORTED_VERSION',UNSUPPORTED_PRODUCT:'UNSUPPORTED_CASE',INCOMPATIBLE_TEMPLATE:'UNSUPPORTED_CASE',APPROVAL_INVALID:'STALE_APPROVAL',APPROVAL_REVOKED:'STALE_APPROVAL',ASSET_MISSING:'REFERENCE_MISMATCH',HASH_MISMATCH:'REFERENCE_MISMATCH',PREFLIGHT_FAILED:'UNSUPPORTED_CASE',IDEMPOTENCY_CONFLICT:'IDENTITY_COLLISION',NOT_FOUND:'SCOPE_MISMATCH',FORBIDDEN:'SCOPE_MISMATCH',OUTPUT_UNSUPPORTED:'UNSUPPORTED_CASE',ROW_SCHEMA:'INVALID_PAYLOAD',ROW_DUPLICATE:'INVALID_BATCH',CAPABILITY_DISABLED:'UNSUPPORTED_CASE',CANCELLED:'CANCELLED',INTEGRITY_FAILURE:'REFERENCE_MISMATCH' });
export function adaptProductionErrorToV1(input, context) {
  const checked=checkProductionError(input,context.scope);
  if(!checked.ok)return checked;
  const code=codes[input.code];
  if(!code)return productionIssue('LEGACY_UNREPRESENTABLE');
  const detail={code,...errorRegistry[code],module:'print-production',operation:input.operation,retryable:input.retryable,blocking_condition:context.blocking_condition,side_effects:input.side_effects,usage_state:input.usage_state,validation_paths:input.field_path===undefined?[]:[input.field_path]};
  if(input.diagnostic_ref.state==='persisted')detail.diagnostic_ref=input.diagnostic_ref.reference;
  const value={...context.envelope,contract:'ErrorEnvelope',error:detail};
  const parsed=validateContract('ErrorEnvelope',value);
  return parsed.ok?productionOk({value:parsed.value.error,source_code:input.code,equivalent:false,loss:['production_code_vocabulary','diagnostic_state','row_identity']}):productionIssue('LEGACY_UNREPRESENTABLE');
}
