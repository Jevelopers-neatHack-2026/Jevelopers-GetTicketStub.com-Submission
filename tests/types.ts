import { validateContract, validatePrimitive, checkTrustedContext, ContractError } from '../generated/index.js';
import type { CommonEnvelope, TenantId, ProjectId, ValidationCode, TrustedContext } from '../generated/index.js';

type Assert<T extends true> = T;
type DistinctIdentity = Assert<ProjectId extends TenantId ? false : true>;
type RejectRawIdentity = Assert<string extends TenantId ? false : true>;
type RejectUnknownEnum = Assert<'free' extends CommonEnvelope['billing_mode'] ? false : true>;
type RejectNullScope = Assert<null extends CommonEnvelope['tenant_id'] ? false : true>;
type RejectUnknownVersion = Assert<'2.0.0' extends CommonEnvelope['schema_version'] ? false : true>;

export function typedInvalidBytesError(): { readonly error: ContractError; readonly invalidBytes: boolean } {
  const code: ValidationCode = 'INVALID_BYTES';
  const error = new ContractError(code);
  return { error, invalidBytes: error.code === 'INVALID_BYTES' };
}

export function typedBoundary(input: unknown, authenticatedExpectations: TrustedContext): CommonEnvelope | undefined {
  const parsed = validateContract('CommonEnvelope', input);
  if (!parsed.ok) return undefined;
  const scope = checkTrustedContext(parsed.value, authenticatedExpectations);
  return scope.ok ? scope.value : undefined;
}

export function parseTenant(input: unknown): TenantId | undefined {
  const result = validatePrimitive('TenantId', input);
  return result.ok ? result.value : undefined;
}
export type TypeParity = readonly [DistinctIdentity, RejectRawIdentity, RejectUnknownEnum, RejectNullScope, RejectUnknownVersion];
