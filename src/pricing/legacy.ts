import {
  blockedBoundary,
  validateRequest,
  type ApiResult,
  type RuntimePorts,
  type Validation,
} from '../shared/contracts.js';
import {
  CatalogWriteReceiptSchema,
  RegisterFxRateRequestSchema,
  RegisterPricingRuleRequestSchema,
  RegisterRateCardRequestSchema,
  type CatalogWriteReceipt,
  type RegisterFxRateRequest,
  type RegisterPricingRuleRequest,
  type RegisterRateCardRequest,
} from './legacy-schemas.js';

function validate<T>(schema: object, value: unknown, operation: string): Validation<T> {
  return validateRequest(schema as never, value, 'pricing', operation) as Validation<T>;
}

export function validatePricingRuleBoundary(value: unknown): Validation<RegisterPricingRuleRequest> {
  return validate(RegisterPricingRuleRequestSchema, value, 'registerPricingRule');
}

export function validateRateCardBoundary(value: unknown): Validation<RegisterRateCardRequest> {
  return validate(RegisterRateCardRequestSchema, value, 'registerRateCard');
}

export function validateFxRateBoundary(value: unknown): Validation<RegisterFxRateRequest> {
  return validate(RegisterFxRateRequestSchema, value, 'registerFxRate');
}

/**
 * The 1.0.0 catalog-write encodings remain available to old consumers, but they
 * cannot carry the v2 host-injected operation decision and therefore fail
 * closed before any durable pricing access.
 */
export function registerPricingRule(
  request: RegisterPricingRuleRequest,
  ports: RuntimePorts,
): Promise<ApiResult<CatalogWriteReceipt>> {
  return blockedBoundary({
    module: 'pricing', operation: 'registerPricingRule', schema: RegisterPricingRuleRequestSchema,
    request, ports, unavailableCode: 'PRICING_UNKNOWN',
    safeMessage: 'The 1.0.0 pricing write contract is retained for compatibility and cannot authorize a catalog mutation.',
  });
}

export function registerRateCard(
  request: RegisterRateCardRequest,
  ports: RuntimePorts,
): Promise<ApiResult<CatalogWriteReceipt>> {
  return blockedBoundary({
    module: 'pricing', operation: 'registerRateCard', schema: RegisterRateCardRequestSchema,
    request, ports, unavailableCode: 'PRICING_UNKNOWN',
    safeMessage: 'The 1.0.0 pricing write contract is retained for compatibility and cannot authorize a catalog mutation.',
  });
}

export function registerFxRate(
  request: RegisterFxRateRequest,
  ports: RuntimePorts,
): Promise<ApiResult<CatalogWriteReceipt>> {
  return blockedBoundary({
    module: 'pricing', operation: 'registerFxRate', schema: RegisterFxRateRequestSchema,
    request, ports, unavailableCode: 'PRICING_UNKNOWN',
    safeMessage: 'The 1.0.0 pricing write contract is retained for compatibility and cannot authorize a catalog mutation.',
  });
}

export { CatalogWriteReceiptSchema };
