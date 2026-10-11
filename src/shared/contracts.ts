import { FormatRegistry, Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

function validDateTime(value: string): boolean {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return calendarDate.getUTCFullYear() === year && calendarDate.getUTCMonth() === month - 1 && calendarDate.getUTCDate() === day;
}

if (!FormatRegistry.Has('date-time')) FormatRegistry.Set('date-time', validDateTime);
if (!FormatRegistry.Has('uri')) FormatRegistry.Set('uri', value => {
  try { return new URL(value).protocol.length > 0; } catch { return false; }
});

export const SCHEMA_VERSION = '1.0.0' as const;
export const SchemaVersionSchema = Type.Literal(SCHEMA_VERSION);

export const EnvironmentSchema = Type.Union([
  Type.Literal('development'),
  Type.Literal('test'),
  Type.Literal('production'),
]);
export const BillingModeSchema = Type.Union([
  Type.Literal('live'),
  Type.Literal('sandbox'),
  Type.Literal('simulated'),
]);

export const TrustedScopeSchema = Type.Object({
  tenantId: Type.String({ minLength: 1, maxLength: 128 }),
  projectId: Type.String({ minLength: 1, maxLength: 128 }),
  environment: EnvironmentSchema,
  billingMode: BillingModeSchema,
  actorId: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
export type TrustedScope = Static<typeof TrustedScopeSchema>;

export const ErrorCodeSchema = Type.Union([
  Type.Literal('VALIDATION_ERROR'),
  Type.Literal('UNSUPPORTED_VERSION'),
  Type.Literal('FORBIDDEN_SCOPE'),
  Type.Literal('IDEMPOTENCY_CONFLICT'),
  Type.Literal('PRICING_UNKNOWN'),
  Type.Literal('BUDGET_EXCEEDED'),
  Type.Literal('BUDGET_UNAVAILABLE'),
  Type.Literal('RECONCILIATION_PENDING'),
  Type.Literal('SOURCE_UNAVAILABLE'),
]);
export type ErrorCode = Static<typeof ErrorCodeSchema>;

export const ErrorEnvelopeSchema = Type.Object({
  schemaVersion: SchemaVersionSchema,
  module: Type.String({ minLength: 1 }),
  operation: Type.String({ minLength: 1 }),
  code: ErrorCodeSchema,
  retryable: Type.Boolean(),
  safe_message: Type.String({ minLength: 1, maxLength: 240 }),
  diagnostic_ref: Type.String({ minLength: 1, maxLength: 160 }),
}, { additionalProperties: false });
export type ErrorEnvelope = Static<typeof ErrorEnvelopeSchema>;

export const RequestBaseSchema = Type.Object({
  schemaVersion: SchemaVersionSchema,
  requestId: Type.String({ minLength: 1, maxLength: 128 }),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
  scope: TrustedScopeSchema,
}, { additionalProperties: false });
export type RequestBase = Static<typeof RequestBaseSchema>;

export const DecimalAmountSchema = Type.String({
  pattern: '^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,18})?$',
  maxLength: 40,
  description: 'Base-10 decimal string with at most 18 fractional digits; never use binary floating point for money.',
});
export const NonNegativeDecimalAmountSchema = Type.String({
  pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,18})?$',
  maxLength: 40,
  description: 'Non-negative base-10 decimal string with at most 18 fractional digits.',
});
export const CurrencySchema = Type.String({ pattern: '^[A-Z]{3}$' });
export const CompletenessSchema = Type.Union([
  Type.Literal('complete'),
  Type.Literal('partial'),
  Type.Literal('unknown'),
]);

export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ErrorEnvelope };
export type ApiErrorResult = { readonly ok: false; readonly error: ErrorEnvelope };
export type Clock = { now(): Date };
export type FinancialStorePort = { isAvailable(): Promise<boolean> };
export type ProviderSourcePort = { isAvailable(): Promise<boolean> };
export type TrustedContextPort = { resolve(requested: TrustedScope): Promise<TrustedScope | null> };

/** Finance-local operation identifiers. A host must map them to reviewed issuer grants explicitly. */
export type FinanceOperation =
  | 'metering.ingestUsage'
  | 'pricing.estimate'
  | 'pricing.estimateV2'
  | 'pricing.registerPricingRuleV2'
  | 'pricing.registerRateCardV2'
  | 'pricing.registerFxRateV2'
  | 'pricing.resolveEvidence'
  | 'budgets.authorize'
  | 'budgets.markDispatched'
  | 'budgets.settle'
  | 'budgets.release'
  | 'budgets.changeBudget'
  | 'budgets.recordExpenseAdjustment'
  | 'ledger.ingestFinancial'
  | 'ledger.appendLedgerEvent'
  | 'ledger.rebuildLedgerProjection'
  | 'ledger.resolveQuarantine'
  | 'ledger.readSnapshot'
  | 'reporting.querySummary'
  | 'reconciliation.startReconciliation'
  | 'reconciliation.getReconciliation'
  | 'integrations.exportSummary';

/** Distinct internal grants; these names are not accepted GT-08 capability spellings. */
export type FinancePermission =
  | 'usage.ingest'
  | 'pricing.estimate'
  | 'pricing.rule.register'
  | 'pricing.rate-card.register'
  | 'pricing.fx-rate.register'
  | 'pricing.evidence.resolve'
  | 'budget.reservation.authorize'
  | 'budget.reservation.dispatch'
  | 'budget.reservation.settle'
  | 'budget.reservation.release'
  | 'budget.policy.change'
  | 'expense.adjust'
  | 'ledger.financial.ingest'
  | 'ledger.event.append'
  | 'ledger.projection.rebuild'
  | 'ledger.quarantine.resolve'
  | 'ledger.snapshot.read'
  | 'finance.summary.read'
  | 'finance.reconciliation.start'
  | 'finance.reconciliation.read'
  | 'finance.summary.export';

export type FinancePrincipalKind = 'user' | 'service';
export type FinanceDataClass =
  | 'restricted_minimal_source_facts'
  | 'pricing_result'
  | 'immutable_pricing_catalog'
  | 'restricted_budget_state'
  | 'safe_financial_summary'
  | 'sanitized_financial_export'
  | 'restricted_reconciliation';

/**
 * Reviewed per-operation policy. No application role or broad finance.read/write grant is inferred.
 * Host capability spellings and issuer-mode mappings remain a separate, unresolved handoff.
 */
const FinanceOperationPolicyValues = {
  'metering.ingestUsage': { permission: 'usage.ingest', dataClass: 'restricted_minimal_source_facts', principalKinds: ['service'] },
  'pricing.estimate': { permission: 'pricing.estimate', dataClass: 'pricing_result', principalKinds: ['user', 'service'] },
  'pricing.estimateV2': { permission: 'pricing.estimate', dataClass: 'pricing_result', principalKinds: ['user', 'service'] },
  'pricing.registerPricingRuleV2': { permission: 'pricing.rule.register', dataClass: 'immutable_pricing_catalog', principalKinds: ['user', 'service'] },
  'pricing.registerRateCardV2': { permission: 'pricing.rate-card.register', dataClass: 'immutable_pricing_catalog', principalKinds: ['user', 'service'] },
  'pricing.registerFxRateV2': { permission: 'pricing.fx-rate.register', dataClass: 'immutable_pricing_catalog', principalKinds: ['user', 'service'] },
  'pricing.resolveEvidence': { permission: 'pricing.evidence.resolve', dataClass: 'restricted_minimal_source_facts', principalKinds: ['user', 'service'] },
  'budgets.authorize': { permission: 'budget.reservation.authorize', dataClass: 'restricted_budget_state', principalKinds: ['user', 'service'] },
  'budgets.markDispatched': { permission: 'budget.reservation.dispatch', dataClass: 'restricted_budget_state', principalKinds: ['service'] },
  'budgets.settle': { permission: 'budget.reservation.settle', dataClass: 'restricted_budget_state', principalKinds: ['user', 'service'] },
  'budgets.release': { permission: 'budget.reservation.release', dataClass: 'restricted_budget_state', principalKinds: ['user', 'service'] },
  'budgets.changeBudget': { permission: 'budget.policy.change', dataClass: 'restricted_budget_state', principalKinds: ['user', 'service'] },
  'budgets.recordExpenseAdjustment': { permission: 'expense.adjust', dataClass: 'restricted_minimal_source_facts', principalKinds: ['user', 'service'] },
  'ledger.ingestFinancial': { permission: 'ledger.financial.ingest', dataClass: 'restricted_minimal_source_facts', principalKinds: ['service'] },
  'ledger.appendLedgerEvent': { permission: 'ledger.event.append', dataClass: 'restricted_minimal_source_facts', principalKinds: ['service'] },
  'ledger.rebuildLedgerProjection': { permission: 'ledger.projection.rebuild', dataClass: 'restricted_minimal_source_facts', principalKinds: ['service'] },
  'ledger.resolveQuarantine': { permission: 'ledger.quarantine.resolve', dataClass: 'restricted_minimal_source_facts', principalKinds: ['user', 'service'] },
  'ledger.readSnapshot': { permission: 'ledger.snapshot.read', dataClass: 'restricted_minimal_source_facts', principalKinds: ['user', 'service'] },
  'reporting.querySummary': { permission: 'finance.summary.read', dataClass: 'safe_financial_summary', principalKinds: ['user', 'service'] },
  'reconciliation.startReconciliation': { permission: 'finance.reconciliation.start', dataClass: 'restricted_reconciliation', principalKinds: ['user', 'service'] },
  'reconciliation.getReconciliation': { permission: 'finance.reconciliation.read', dataClass: 'restricted_reconciliation', principalKinds: ['user', 'service'] },
  'integrations.exportSummary': { permission: 'finance.summary.export', dataClass: 'sanitized_financial_export', principalKinds: ['user', 'service'] },
} as const satisfies Record<FinanceOperation, {
  permission: FinancePermission;
  dataClass: FinanceDataClass;
  principalKinds: readonly FinancePrincipalKind[];
}>;
for (const policy of Object.values(FinanceOperationPolicyValues)) {
  Object.freeze(policy.principalKinds);
  Object.freeze(policy);
}
export const FINANCE_OPERATION_POLICY = Object.freeze(FinanceOperationPolicyValues);

export type FinanceAuthorizationRequest = {
  readonly requestedScope: TrustedScope;
  readonly operation: FinanceOperation;
  readonly permission: FinancePermission;
  readonly requestId: string;
};

export type FinanceAuthorizationPrincipal =
  | { readonly kind: 'user'; readonly actorId: string; readonly membershipStatus: 'active'; readonly membershipRevision: string }
  | { readonly kind: 'service'; readonly actorId: string; readonly serviceStatus: 'active'; readonly serviceGrantRevision: string };

export type FinanceAuthorizationDecision =
  | {
      readonly status: 'allowed';
      readonly decisionId: string;
      readonly operation: FinanceOperation;
      readonly permission: FinancePermission;
      readonly scope: TrustedScope;
      readonly principal: FinanceAuthorizationPrincipal;
      readonly verifiedAt: string;
      readonly expiresAt: string;
    }
  | { readonly status: 'denied'; readonly decisionId?: string; readonly operation: FinanceOperation; readonly permission: FinancePermission };

/** Must resolve the current host principal, membership/revocation, scope, and this exact grant on every call. */
export type FinanceAuthorizationPort = {
  authorizeCurrent(request: FinanceAuthorizationRequest): Promise<FinanceAuthorizationDecision | null>;
};

/** Compatibility evidence for the pre-existing pricing action authority only. New handlers use FinanceAuthorizationPort. */
export type PricingAuthorizationCompatibilityDecision = {
  readonly status: 'allowed' | 'denied';
  readonly decisionId: string;
  readonly operation: FinanceOperation;
  readonly permission: FinancePermission;
  readonly scope: TrustedScope;
  readonly actorId: string;
  readonly verifiedAt: string;
  readonly expiresAt: string;
};

export type RuntimePorts = {
  clock: Clock;
  storage: FinancialStorePort;
  providerSource: ProviderSourcePort;
  trustedContext: TrustedContextPort;
  /** Missing configuration is deny-by-default; never infer a grant from TrustedContextPort or application roles. */
  financeAuthority?: FinanceAuthorizationPort;
};

export type FinanceAuthorizationResult =
  | { readonly ok: true; readonly decision: FinanceAuthorizationDecision | PricingAuthorizationCompatibilityDecision }
  | { readonly ok: false; readonly error: ErrorEnvelope };

export type Validation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ErrorEnvelope };

export function errorEnvelope(
  module: string,
  operation: string,
  code: ErrorCode,
  requestId: string,
  safeMessage: string,
  retryable = false,
): ErrorEnvelope {
  const opaqueRef = globalThis.crypto.randomUUID();
  return {
    schemaVersion: SCHEMA_VERSION,
    module,
    operation,
    code,
    retryable,
    safe_message: safeMessage,
    diagnostic_ref: `ci1:${opaqueRef}`,
  };
}

export function validateRequest<T extends TSchema>(
  schema: T,
  value: unknown,
  module: string,
  operation: string,
): Validation<Static<T>> {
  const requestId = typeof value === 'object' && value !== null && 'requestId' in value && typeof value.requestId === 'string'
    ? value.requestId
    : 'unavailable';
  if (typeof value === 'object' && value !== null && 'schemaVersion' in value && value.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: errorEnvelope(module, operation, 'UNSUPPORTED_VERSION', requestId, 'The request schema version is not supported.'),
    };
  }
  if (!Value.Check(schema, value)) {
    return {
      ok: false,
      error: errorEnvelope(module, operation, 'VALIDATION_ERROR', requestId, 'The request does not match the published schema.'),
    };
  }
  return { ok: true, value: value as Static<T> };
}

export function failure(error: ErrorEnvelope): ApiErrorResult {
  return { ok: false, error };
}

export function success<T>(value: T): ApiResult<T> {
  return { ok: true, value };
}

const AUTHORITY_DECISION_MAX_AGE_MS = 60_000;
const AUTHORITY_DECISION_MAX_TTL_MS = 5 * 60_000;
const PRICING_COMPATIBILITY_OPERATIONS: readonly FinanceOperation[] = [
  'pricing.estimateV2',
  'pricing.registerPricingRuleV2',
  'pricing.registerRateCardV2',
  'pricing.registerFxRateV2',
];

function currentDecisionTimes(
  verifiedAt: unknown,
  expiresAt: unknown,
  now: Date,
  requireFreshDecision = true,
  requireBoundedLifetime = requireFreshDecision,
): boolean {
  if (typeof verifiedAt !== 'string' || typeof expiresAt !== 'string'
      || !validDateTime(verifiedAt) || !validDateTime(expiresAt)) return false;
  const verified = Date.parse(verifiedAt);
  const expires = Date.parse(expiresAt);
  const nowMs = now.getTime();
  return verified <= nowMs
    && (!requireFreshDecision || nowMs - verified <= AUTHORITY_DECISION_MAX_AGE_MS)
    && expires > nowMs
    && expires > verified
    && (!requireBoundedLifetime || expires - verified <= AUTHORITY_DECISION_MAX_TTL_MS);
}

/**
 * The shared authorization gate used by finance APIs and future service leaves.
 * The injected port must derive the principal from its trusted host and recheck
 * current membership/revocation and this exact permission on every invocation.
 */
export async function authorizeFinanceOperation(args: {
  readonly module: string;
  readonly requestOperation: string;
  readonly operation: FinanceOperation;
  readonly scope: TrustedScope;
  readonly requestId: string;
  readonly clock: Clock;
  readonly financeAuthority?: FinanceAuthorizationPort | undefined;
  /** Existing v2 pricing bridge only; never use it for another finance operation. */
  readonly pricingCompatibility?: (() => Promise<PricingAuthorizationCompatibilityDecision | null>) | undefined;
}): Promise<FinanceAuthorizationResult> {
  const reject = (code: ErrorCode, message: string, retryable = false): FinanceAuthorizationResult => ({
    ok: false,
    error: errorEnvelope(args.module, args.requestOperation, code, args.requestId, message, retryable),
  });
  if (typeof args.operation !== 'string' || !Object.hasOwn(FINANCE_OPERATION_POLICY, args.operation)) {
    return reject('FORBIDDEN_SCOPE', 'The requested financial operation is not recognized.');
  }
  const policy = FINANCE_OPERATION_POLICY[args.operation];
  let now: Date;
  try {
    now = args.clock.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('invalid clock');
  } catch {
    return reject('SOURCE_UNAVAILABLE', 'Current financial authorization is temporarily unavailable.', true);
  }

  if (args.financeAuthority) {
    let decision: FinanceAuthorizationDecision | null;
    try {
      decision = await args.financeAuthority.authorizeCurrent({
        requestedScope: args.scope,
        operation: args.operation,
        permission: policy.permission,
        requestId: args.requestId,
      });
    } catch {
      return reject('SOURCE_UNAVAILABLE', 'Current financial authorization is temporarily unavailable.', true);
    }
    if (!decision) return reject('SOURCE_UNAVAILABLE', 'Current financial authorization is temporarily unavailable.', true);
    if (decision.status !== 'allowed') {
      return reject('FORBIDDEN_SCOPE', 'The current principal is not authorized for this financial operation.');
    }
    const principal = decision.principal;
    const principalRevision = principal?.kind === 'user' ? principal.membershipRevision
      : principal?.kind === 'service' ? principal.serviceGrantRevision : null;
    const principalActive = principal?.kind === 'user' ? principal.membershipStatus === 'active'
      : principal?.kind === 'service' ? principal.serviceStatus === 'active' : false;
    if (decision.operation !== args.operation || decision.permission !== policy.permission
        || !sameScope(decision.scope, args.scope)
        || !principal || principal.actorId !== args.scope.actorId
        || !policy.principalKinds.some(kind => kind === principal.kind)
        || !principalActive || typeof principalRevision !== 'string' || principalRevision.length === 0
        || principalRevision.length > 200 || typeof decision.decisionId !== 'string' || decision.decisionId.length === 0
        || decision.decisionId.length > 200
        || !currentDecisionTimes(decision.verifiedAt, decision.expiresAt, now)) {
      return reject('FORBIDDEN_SCOPE', 'The current financial authorization does not match this scope and operation.');
    }
    return { ok: true, decision };
  }

  if (args.pricingCompatibility && PRICING_COMPATIBILITY_OPERATIONS.includes(args.operation)) {
    let decision: PricingAuthorizationCompatibilityDecision | null;
    try {
      decision = await args.pricingCompatibility();
    } catch {
      return reject('SOURCE_UNAVAILABLE', 'Current pricing authorization is temporarily unavailable.', true);
    }
    if (!decision) return reject('SOURCE_UNAVAILABLE', 'Current pricing authorization is temporarily unavailable.', true);
    if (decision.status !== 'allowed' || decision.operation !== args.operation
        || decision.permission !== policy.permission || !sameScope(decision.scope, args.scope)
        || decision.actorId !== args.scope.actorId || typeof decision.decisionId !== 'string'
        || decision.decisionId.length === 0 || decision.decisionId.length > 200
        || !currentDecisionTimes(decision.verifiedAt, decision.expiresAt, now, true, false)) {
      return reject('FORBIDDEN_SCOPE', 'Current pricing authorization does not grant this scoped operation.');
    }
    return { ok: true, decision };
  }

  return reject('SOURCE_UNAVAILABLE', 'Current financial authorization is not configured.', true);
}

export async function blockedBoundary<TRequest extends RequestBase, TOutput>(args: {
  module: string;
  operation: string;
  authorityOperation: FinanceOperation;
  schema: TSchema;
  request: unknown;
  ports: RuntimePorts;
  unavailableCode: ErrorCode;
  safeMessage: string;
  retryable?: boolean;
}): Promise<ApiResult<TOutput>> {
  const validation = validateRequest(args.schema, args.request, args.module, args.operation);
  if (!validation.ok) return failure(validation.error);
  const request = validation.value as TRequest;
  const authorization = await authorizeFinanceOperation({
    module: args.module,
    requestOperation: args.operation,
    operation: args.authorityOperation,
    scope: request.scope,
    requestId: request.requestId,
    clock: args.ports.clock,
    financeAuthority: args.ports.financeAuthority,
  });
  if (!authorization.ok) {
    if (authorization.error.code !== 'SOURCE_UNAVAILABLE') return failure(authorization.error);
    // Preserve the established unavailable envelope for unimplemented domain leaves.
    return failure(errorEnvelope(args.module, args.operation, args.unavailableCode, request.requestId,
      `${args.safeMessage} Current authorization is unavailable.`, args.retryable ?? true));
  }
  return failure(errorEnvelope(args.module, args.operation, args.unavailableCode, request.requestId, args.safeMessage, args.retryable ?? false));
}

export function sameScope(left: TrustedScope, right: TrustedScope): boolean {
  return left.tenantId === right.tenantId
    && left.projectId === right.projectId
    && left.environment === right.environment
    && left.billingMode === right.billingMode
    && left.actorId === right.actorId;
}
