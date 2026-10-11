import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  CurrencySchema,
  DecimalAmountSchema,
  NonNegativeDecimalAmountSchema,
  TrustedScopeSchema,
  errorEnvelope,
  failure,
  sameScope,
  validateRequest,
  type ApiResult,
  type Clock,
  type ErrorEnvelope,
  type TrustedContextPort,
  type TrustedScope,
  type Validation,
} from '../shared/contracts.js';

const LocalVersion = Type.Literal('1.0.0');
const UtcTimestamp = Type.String({ format: 'date-time' });
const Sha256Reference = Type.String({ pattern: '^sha256:[a-f0-9]{64}$' });
const RevisionHash = Type.String({ pattern: '^[a-f0-9]{40}$' });
const Identifier = Type.String({ minLength: 1, maxLength: 256 });
const VersionedEvidenceRefSchema = Type.Object({
  contract: Type.String({ minLength: 1, maxLength: 128 }),
  schema_version: Type.String({ minLength: 1, maxLength: 32 }),
  id: Identifier,
  revision: Type.Integer({ minimum: 0 }),
  content_hash: Sha256Reference,
}, { additionalProperties: false });

export const LedgerEventTypeSchema = Type.Union([
  Type.Literal('usage_observation'), Type.Literal('reservation_authorized'), Type.Literal('dispatch'),
  Type.Literal('charge'), Type.Literal('consumption'), Type.Literal('reservation_release'), Type.Literal('expense'),
  Type.Literal('revenue'), Type.Literal('refund'), Type.Literal('credit'), Type.Literal('discount'), Type.Literal('fee'),
  Type.Literal('tax'), Type.Literal('reimbursement'), Type.Literal('cash_movement'), Type.Literal('reversal'),
  Type.Literal('adjustment'), Type.Literal('correction'),
]);
export type LedgerEventType = Static<typeof LedgerEventTypeSchema>;

export const LedgerClassificationSchema = Type.Union([
  Type.Literal('sale'), Type.Literal('discount'), Type.Literal('sale_refund'), Type.Literal('pass_through_tax'),
  Type.Literal('supplier_credit'), Type.Literal('supplier_expense'), Type.Literal('reimbursement'),
  Type.Literal('payout_transfer'), Type.Literal('direct_cost'), Type.Literal('operating_expense'),
  Type.Literal('operating_revenue'), Type.Literal('award_grant'), Type.Literal('capital_funding'),
  Type.Literal('sponsorship'), Type.Literal('in_kind_support'), Type.Literal('payable_labor'),
  Type.Literal('reservation_memo'), Type.Literal('usage_memo'),
]);
export type LedgerClassification = Static<typeof LedgerClassificationSchema>;

const LedgerAppendRequestBaseSchema = Type.Object({
  schemaVersion: LocalVersion,
  requestId: Type.String({ minLength: 1, maxLength: 128 }),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
  scope: TrustedScopeSchema,
  eventId: Identifier,
  correlationId: Identifier,
  producer: Type.Object({
    module: Type.String({ minLength: 1, maxLength: 128 }),
    sourceRevision: RevisionHash,
    buildRevision: Type.String({ minLength: 1, maxLength: 128 }),
  }, { additionalProperties: false }),
  occurredAt: UtcTimestamp,
  observedAt: UtcTimestamp,
  evidenceMode: Type.Union([Type.Literal('mocked'), Type.Literal('sandbox'), Type.Literal('live')]),
  verificationStatus: Type.Union([Type.Literal('verified'), Type.Literal('unverified'), Type.Literal('unknown')]),
  eventType: LedgerEventTypeSchema,
  classification: LedgerClassificationSchema,
  valuation: Type.Union([Type.Literal('unknown'), Type.Literal('estimated'), Type.Literal('provider_confirmed')]),
  settlementStatus: Type.Union([Type.Literal('unpaid'), Type.Literal('partly_paid'), Type.Literal('paid')]),
  reconciliationStatus: Type.Union([Type.Literal('unmatched'), Type.Literal('matched'), Type.Literal('exception')]),
  reservationLifecycle: Type.Union([
    Type.Literal('held'), Type.Literal('dispatched'), Type.Literal('outcome_unknown'), Type.Literal('partially_settled'),
    Type.Literal('settled'), Type.Literal('released'), Type.Literal('expired'), Type.Literal('held_for_reconciliation'),
    Type.Null(),
  ]),
  identities: Type.Object({
    logicalOperationId: Identifier,
    transportAttemptId: Identifier,
    providerAttemptId: Identifier,
    providerRequestId: Type.Union([Identifier, Type.Null()]),
    billableAttemptId: Identifier,
    sourceObservationId: Identifier,
    reservationId: Type.Union([Identifier, Type.Null()]),
  }, { additionalProperties: false }),
  sourceIdentity: Type.Object({
    source: Type.String({ minLength: 1, maxLength: 120 }),
    sourceEventId: Identifier,
    sourceObjectId: Identifier,
    revisionSubjectId: Identifier,
    sourceRevision: Type.String({ minLength: 1, maxLength: 128 }),
    revisionSequence: Type.Integer({ minimum: 0, maximum: 2147483647 }),
    contentHash: Sha256Reference,
  }, { additionalProperties: false }),
  usage: Type.Object({
    completeness: Type.Union([Type.Literal('unknown'), Type.Literal('incomplete'), Type.Literal('complete')]),
    missingFields: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 100 }),
    units: Type.Array(Type.Object({
      name: Type.String({ minLength: 1, maxLength: 128 }),
      quantity: Type.Union([NonNegativeDecimalAmountSchema, Type.Null()]),
      scale: Type.Integer({ minimum: 0, maximum: 18 }),
      relation: Type.Union([Type.Literal('standalone'), Type.Literal('included_subset'), Type.Literal('unknown_relation')]),
      includedIn: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    }, { additionalProperties: false }), { maxItems: 100 }),
  }, { additionalProperties: false }),
  money: Type.Object({
    amount: Type.Union([DecimalAmountSchema, Type.Null()]),
    currency: CurrencySchema,
    scale: Type.Integer({ minimum: 0, maximum: 18 }),
  }, { additionalProperties: false }),
  sourceRefs: Type.Array(VersionedEvidenceRefSchema, { maxItems: 100 }),
  dimensions: Type.Object({
    repo: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    feature: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    provider: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    model: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    workflowId: Type.Optional(Identifier),
    jobId: Type.Optional(Identifier),
    orderId: Type.Optional(Identifier),
    channel: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  }, { additionalProperties: false }),
  pricing: Type.Union([Type.Object({
    policyVersion: Type.String({ minLength: 1, maxLength: 64 }),
    ruleVersion: Type.String({ minLength: 1, maxLength: 64 }),
    rateCardRef: Type.Union([VersionedEvidenceRefSchema, Type.Null()]),
  }, { additionalProperties: false }), Type.Null()]),
  fxEvidence: Type.Union([Type.Object({
    sourceRef: VersionedEvidenceRefSchema,
    sourceCurrency: CurrencySchema,
    targetCurrency: CurrencySchema,
    rate: NonNegativeDecimalAmountSchema,
    effectiveAt: UtcTimestamp,
  }, { additionalProperties: false }), Type.Null()]),
  financialEffect: Type.Boolean(),
  reservationAuthorizationEventId: Type.Union([Identifier, Type.Null()]),
  supersedesEventId: Type.Union([Identifier, Type.Null()]),
  reversesEventId: Type.Union([Identifier, Type.Null()]),
}, { additionalProperties: false });

function eventVariant<const EventType extends LedgerEventType, const Effect extends boolean>(
  eventType: EventType,
  financialEffect: Effect,
  reservationLifecycle?: TSchema,
) {
  return Type.Object({
    ...LedgerAppendRequestBaseSchema.properties,
    eventType: Type.Literal(eventType),
    financialEffect: Type.Literal(financialEffect),
    ...(reservationLifecycle ? { reservationLifecycle } : {}),
  }, { additionalProperties: false });
}

/** Versioned discriminated event union. Observation/reservation facts cannot post recognized money. */
export const LedgerAppendRequestSchema = Type.Union([
  eventVariant('usage_observation', false, Type.Null()),
  eventVariant('reservation_authorized', false, Type.Literal('held')),
  eventVariant('dispatch', false, Type.Literal('dispatched')),
  eventVariant('reservation_release', false, Type.Union([
    Type.Literal('released'), Type.Literal('expired'),
  ])),
  eventVariant('charge', true),
  eventVariant('consumption', true),
  eventVariant('expense', true),
  eventVariant('revenue', true),
  eventVariant('refund', true),
  eventVariant('credit', true),
  eventVariant('discount', true),
  eventVariant('fee', true),
  eventVariant('tax', true),
  eventVariant('reimbursement', true),
  eventVariant('cash_movement', true),
  eventVariant('reversal', true),
  eventVariant('adjustment', true),
  eventVariant('correction', true),
]);
export type LedgerAppendRequest = Static<typeof LedgerAppendRequestSchema>;

export const LedgerAppendReceiptSchema = Type.Object({
  schemaVersion: LocalVersion,
  requestId: Type.String({ minLength: 1, maxLength: 128 }),
  status: Type.Union([Type.Literal('accepted'), Type.Literal('duplicate'), Type.Literal('conflict'), Type.Literal('stale_revision')]),
  eventId: Identifier,
  existingEventId: Type.Union([Identifier, Type.Null()]),
  durableCommit: Type.Boolean(),
  ingestedAt: Type.Union([UtcTimestamp, Type.Null()]),
}, { additionalProperties: false });
export type LedgerAppendReceipt = Static<typeof LedgerAppendReceiptSchema>;

export const LedgerProjectionRequestSchema = Type.Object({
  schemaVersion: LocalVersion,
  requestId: Type.String({ minLength: 1, maxLength: 128 }),
  scope: TrustedScopeSchema,
  asOf: UtcTimestamp,
}, { additionalProperties: false });
export type LedgerProjectionRequest = Static<typeof LedgerProjectionRequestSchema>;

const ProjectionAmountSchema = Type.Object({
  eventType: LedgerEventTypeSchema,
  classification: LedgerClassificationSchema,
  currency: CurrencySchema,
  eventCount: Type.Integer({ minimum: 1 }),
  knownAmountCount: Type.Integer({ minimum: 0 }),
  unknownAmountCount: Type.Integer({ minimum: 0 }),
  knownSubtotal: Type.Union([DecimalAmountSchema, Type.Null()]),
  totalAmount: Type.Union([DecimalAmountSchema, Type.Null()]),
  completeness: Type.Union([Type.Literal('unknown'), Type.Literal('partial'), Type.Literal('complete')]),
}, { additionalProperties: false });
const ProjectionQuantitySchema = Type.Object({
  eventType: LedgerEventTypeSchema,
  classification: LedgerClassificationSchema,
  currency: CurrencySchema,
  unitName: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  relation: Type.Union([Type.Literal('standalone'), Type.Literal('included_subset'), Type.Literal('unknown_relation'), Type.Null()]),
  observationCount: Type.Integer({ minimum: 1 }),
  knownQuantityCount: Type.Integer({ minimum: 0 }),
  unknownQuantityCount: Type.Integer({ minimum: 0 }),
  incompleteObservationCount: Type.Integer({ minimum: 0 }),
  knownSubtotal: Type.Union([NonNegativeDecimalAmountSchema, Type.Null()]),
  totalQuantity: Type.Union([NonNegativeDecimalAmountSchema, Type.Null()]),
  completeness: Type.Union([Type.Literal('unknown'), Type.Literal('incomplete'), Type.Literal('complete')]),
}, { additionalProperties: false });

export const LedgerProjectionSchema = Type.Object({
  schemaVersion: LocalVersion,
  snapshotId: Sha256Reference,
  projectionHash: Sha256Reference,
  scope: TrustedScopeSchema,
  asOf: UtcTimestamp,
  eventCount: Type.Integer({ minimum: 0 }),
  amounts: Type.Array(ProjectionAmountSchema),
  quantities: Type.Array(ProjectionQuantitySchema),
}, { additionalProperties: false });
export type LedgerProjection = Static<typeof LedgerProjectionSchema>;

export interface LedgerQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number | null;
}

/** Structural subset implemented by a node-postgres PoolClient. */
export interface LedgerTransactionPort {
  query(text: string, values?: readonly unknown[]): Promise<LedgerQueryResult>;
  release(): void;
}

/** Inject an existing host-managed pool; this module never creates a hidden connection. */
export interface LedgerDatabasePort {
  connect(): Promise<LedgerTransactionPort>;
}

export interface LedgerRuntimePorts {
  readonly database: LedgerDatabasePort;
  readonly trustedContext: TrustedContextPort;
  readonly clock: Clock;
}

type LedgerScope = Pick<TrustedScope, 'tenantId' | 'projectId' | 'environment' | 'billingMode'>;
type BindingKind = 'logical_operation' | 'transport_attempt' | 'provider_attempt' | 'provider_request' | 'billable_attempt' | 'source_observation' | 'reservation';
type Binding = { kind: BindingKind; value: string };

function makeError(module: string, operation: string, code: ErrorEnvelope['code'], requestId: string, message: string): ErrorEnvelope {
  return errorEnvelope(module, operation, code, requestId, message);
}

function validationFailure(module: string, operation: string, requestId: string, message: string): Validation<never> {
  return { ok: false, error: makeError(module, operation, 'VALIDATION_ERROR', requestId, message) };
}

function hasUtcZ(value: string): boolean {
  return value.endsWith('Z') && Number.isFinite(Date.parse(value));
}

function decimalScale(value: string): number {
  return value.split('.')[1]?.length ?? 0;
}

function parseScaledDecimal(value: string): bigint {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/.exec(value);
  if (!match) throw new Error('Decimal failed validation before exact parsing.');
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2] ?? '0');
  const fraction = BigInt((match[3] ?? '').padEnd(18, '0') || '0');
  return sign * (whole * 1_000_000_000_000_000_000n + fraction);
}

function formatScaledDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1_000_000_000_000_000_000n;
  const fraction = (absolute % 1_000_000_000_000_000_000n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, canonicalize(object[key])]));
  }
  return value;
}

async function hashValue(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function getRequestId(value: unknown): string {
  return typeof value === 'object' && value !== null && 'requestId' in value && typeof value.requestId === 'string'
    ? value.requestId : 'unavailable';
}

export function validateLedgerAppendRequestBoundary(value: unknown): Validation<LedgerAppendRequest> {
  const requestId = getRequestId(value);
  const parsed = validateRequest(LedgerAppendRequestSchema, value, 'ledger', 'appendLedgerEvent');
  if (!parsed.ok) return parsed;
  const request = parsed.value;
  if (!hasUtcZ(request.occurredAt) || !hasUtcZ(request.observedAt)) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Event timestamps must be UTC instants ending in Z.');
  }
  if ((request.valuation === 'unknown') !== (request.money.amount === null)) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Unknown valuation requires a null amount; valued money requires an exact amount.');
  }
  if (request.money.amount !== null && decimalScale(request.money.amount) > request.money.scale) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'The money scale cannot be smaller than the serialized exact amount.');
  }
  if (request.valuation === 'estimated' && request.pricing === null) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Estimated money requires an explicit pricing policy and rule version.');
  }
  if (request.fxEvidence !== null) {
    if (request.fxEvidence.sourceCurrency !== request.money.currency || request.fxEvidence.targetCurrency === request.money.currency
      || !hasUtcZ(request.fxEvidence.effectiveAt) || parseScaledDecimal(request.fxEvidence.rate) <= 0n) {
      return validationFailure('ledger', 'appendLedgerEvent', requestId, 'FX evidence must identify a distinct target currency, positive exact rate, source reference, and UTC effective time.');
    }
  }
  if (request.usage.completeness === 'complete' && (request.usage.units.length === 0 || request.usage.units.some(unit => unit.quantity === null) || request.usage.missingFields.length > 0)) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Complete usage requires at least one known quantity and no missing fields.');
  }
  if (request.usage.completeness === 'unknown' && request.usage.units.some(unit => unit.quantity !== null)) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Unknown usage cannot contain a known quantity.');
  }
  for (const unit of request.usage.units) {
    if (unit.quantity !== null && decimalScale(unit.quantity) > unit.scale) {
      return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Usage scale cannot be smaller than its exact quantity.');
    }
    if (unit.relation === 'included_subset' && !unit.includedIn) {
      return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Included usage subsets must identify their parent measure.');
    }
  }
  const memoEvent = ['usage_observation', 'reservation_authorized', 'dispatch', 'reservation_release'].includes(request.eventType);
  if (memoEvent && request.financialEffect) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Observation and reservation lifecycle records cannot post recognized financial effects.');
  }
  if (request.eventType === 'correction' && request.supersedesEventId === null
    || !['correction', 'consumption'].includes(request.eventType) && request.supersedesEventId !== null) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Only a correction or cumulative consumption revision may supersede a prior event; every correction must name it.');
  }
  if (request.eventType === 'reversal' ? request.reversesEventId === null : request.reversesEventId !== null) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Every reversal must name its original event; other event types cannot use reversal lineage.');
  }
  if (request.eventType === 'reversal' && (!request.financialEffect || request.money.amount === null)) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'A reversal must carry a known signed financial effect.');
  }
  if (request.eventType === 'correction' && !request.financialEffect) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'A financial correction must participate in the effective projection.');
  }
  if (['correction', 'adjustment', 'reversal'].includes(request.eventType) && request.sourceRefs.length === 0) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Corrections, reversals, and adjustments require content-addressed source evidence.');
  }
  if (request.eventType === 'reservation_authorized' && request.classification !== 'reservation_memo'
    || request.eventType === 'dispatch' && request.classification !== 'reservation_memo'
    || request.eventType === 'reservation_release' && request.classification !== 'reservation_memo'
    || request.eventType === 'usage_observation' && request.classification !== 'usage_memo') {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Observation and reservation events must use their memo classification.');
  }
  const reservationId = request.identities.reservationId;
  const reservationEventId = request.reservationAuthorizationEventId;
  if (request.eventType === 'reservation_authorized') {
    if (reservationId === null || reservationEventId !== null) {
      return validationFailure('ledger', 'appendLedgerEvent', requestId, 'A reservation authorization needs its reservation identity and cannot point to another authorization.');
    }
  } else if (['dispatch', 'reservation_release'].includes(request.eventType) && reservationId === null) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Reservation dispatch and release events require a reservation identity.');
  }
  if (request.eventType !== 'reservation_authorized' && (reservationId === null) !== (reservationEventId === null)) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Reservation activity must retain both the reservation identity and its authorization event link.');
  }
  if (request.eventType === 'consumption' && request.money.amount !== null && parseScaledDecimal(request.money.amount) < 0n) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Cumulative consumption cannot be negative; append a linked reversal or correction instead.');
  }
  if (request.eventType === 'consumption' && !new Set<string>(['partially_settled', 'settled', 'outcome_unknown', 'held_for_reconciliation']).has(request.reservationLifecycle as string)) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'Consumption must preserve its partial, final, or unresolved reservation lifecycle.');
  }
  if (request.fxEvidence !== null && request.fxEvidence.sourceRef.content_hash.length !== 71) {
    return validationFailure('ledger', 'appendLedgerEvent', requestId, 'FX evidence needs a content-addressed source reference.');
  }
  return parsed;
}

export function validateLedgerProjectionRequestBoundary(value: unknown): Validation<LedgerProjectionRequest> {
  const parsed = validateRequest(LedgerProjectionRequestSchema, value, 'ledger', 'rebuildLedgerProjection');
  if (!parsed.ok) return parsed;
  if (!hasUtcZ(parsed.value.asOf)) {
    return validationFailure('ledger', 'rebuildLedgerProjection', parsed.value.requestId, 'Projection as-of time must be a UTC instant ending in Z.');
  }
  return parsed;
}

function bindingsFor(request: LedgerAppendRequest): Binding[] {
  const ids = request.identities;
  const bindings: Binding[] = [
    { kind: 'logical_operation', value: ids.logicalOperationId },
    { kind: 'transport_attempt', value: ids.transportAttemptId },
    { kind: 'provider_attempt', value: ids.providerAttemptId },
    { kind: 'billable_attempt', value: ids.billableAttemptId },
    { kind: 'source_observation', value: ids.sourceObservationId },
  ];
  if (ids.providerRequestId !== null) bindings.push({ kind: 'provider_request', value: ids.providerRequestId });
  if (ids.reservationId !== null) bindings.push({ kind: 'reservation', value: ids.reservationId });
  return bindings.sort((left, right) => `${left.kind}\0${left.value}`.localeCompare(`${right.kind}\0${right.value}`));
}

function receipt(request: LedgerAppendRequest, status: LedgerAppendReceipt['status'], existingEventId: string | null, ingestedAt: string | null): LedgerAppendReceipt {
  return {
    schemaVersion: '1.0.0', requestId: request.requestId, status,
    eventId: request.eventId, existingEventId, durableCommit: status === 'accepted', ingestedAt,
  };
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Database returned an unexpected ledger value.');
  return value;
}

function fromRow(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : asString(value);
}

async function trustedScope(
  request: { requestId: string; scope: TrustedScope },
  ports: LedgerRuntimePorts,
  operation: string,
): Promise<ErrorEnvelope | null> {
  try {
    const resolved = await ports.trustedContext.resolve(request.scope);
    if (!resolved || !sameScope(resolved, request.scope)) {
      return makeError('ledger', operation, 'FORBIDDEN_SCOPE', request.requestId, 'The requested financial scope is not authorized.');
    }
    return null;
  } catch {
    return makeError('ledger', operation, 'SOURCE_UNAVAILABLE', request.requestId, 'Trusted financial scope is temporarily unavailable.');
  }
}

function conflictResult(request: LedgerAppendRequest, status: 'conflict' | 'stale_revision', existingId: string | null = null): ApiResult<LedgerAppendReceipt> {
  return { ok: true, value: receipt(request, status, existingId, null) };
}

function exactEffectFingerprint(request: LedgerAppendRequest): unknown {
  return {
    tenantId: request.scope.tenantId,
    projectId: request.scope.projectId,
    environment: request.scope.environment,
    billingMode: request.scope.billingMode,
    evidenceMode: request.evidenceMode,
    verificationStatus: request.verificationStatus,
    occurredAt: request.occurredAt,
    logicalOperationId: request.identities.logicalOperationId,
    billableAttemptId: request.identities.billableAttemptId,
    reservationId: request.identities.reservationId,
    reservationAuthorizationEventId: request.reservationAuthorizationEventId,
    eventType: request.eventType,
    financialEffect: request.financialEffect,
    reservationLifecycle: request.reservationLifecycle,
    classification: request.classification,
    valuation: request.valuation,
    settlementStatus: request.settlementStatus,
    reconciliationStatus: request.reconciliationStatus,
    amount: request.money.amount,
    currency: request.money.currency,
    scale: request.money.scale,
    usage: request.usage,
    pricing: request.pricing,
    fxEvidence: request.fxEvidence,
    sourceIdentity: request.sourceIdentity,
    sourceRefs: request.sourceRefs,
    dimensions: request.dimensions,
  };
}

async function eventAndEffectHashes(request: LedgerAppendRequest): Promise<{ eventHash: string; effectHash: string }> {
  const [eventHash, effectHash] = await Promise.all([hashValue(request), hashValue(exactEffectFingerprint(request))]);
  return { eventHash, effectHash };
}

async function rollback(client: LedgerTransactionPort): Promise<void> {
  await client.query('ROLLBACK').catch(() => undefined);
}

/** Transactionally append an immutable event. Status outcomes never rewrite prior postings. */
export async function appendLedgerEvent(
  value: unknown,
  ports: LedgerRuntimePorts,
): Promise<ApiResult<LedgerAppendReceipt>> {
  const validated = validateLedgerAppendRequestBoundary(value);
  if (!validated.ok) return failure(validated.error);
  const request = validated.value;
  const authorizationError = await trustedScope(request, ports, 'appendLedgerEvent');
  if (authorizationError) return failure(authorizationError);
  let now: Date;
  try {
    now = ports.clock.now();
  } catch {
    return failure(makeError('ledger', 'appendLedgerEvent', 'SOURCE_UNAVAILABLE', request.requestId, 'Trusted ledger clock is unavailable.'));
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return failure(makeError('ledger', 'appendLedgerEvent', 'SOURCE_UNAVAILABLE', request.requestId, 'Trusted ledger clock is unavailable.'));
  }
  const ingestedAt = now.toISOString();
  const { eventHash, effectHash } = await eventAndEffectHashes(request);
  const scope = request.scope;
  const bindings = bindingsFor(request);
  let client: LedgerTransactionPort | undefined;
  let inTransaction = false;
  try {
    client = await ports.database.connect();
    await client.query('BEGIN');
    inTransaction = true;
    await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');

    const idempotency = await client.query(
      `SELECT event_id, event_hash FROM cost_intelligence.financial_ledger_events
       WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4 AND idempotency_key = $5 FOR UPDATE`,
      [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, request.idempotencyKey],
    );
    if (idempotency.rows.length) {
      await rollback(client);
      inTransaction = false;
      const row = idempotency.rows[0] ?? {};
      const existingId = fromRow(row, 'event_id');
      const status = fromRow(row, 'event_hash') === eventHash ? 'duplicate' : 'conflict';
      return { ok: true, value: receipt(request, status, existingId, null) };
    }

    for (const binding of bindings) {
      await client.query(
        `INSERT INTO cost_intelligence.financial_ledger_identity_bindings
          (tenant_id, project_id, environment, billing_mode, identity_kind, identity_value, logical_operation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, binding.kind, binding.value, request.identities.logicalOperationId],
      );
    }
    const lockedBindings = await client.query(
      `SELECT identity_kind, identity_value, logical_operation_id, first_event_id
       FROM cost_intelligence.financial_ledger_identity_bindings
       WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4 AND (identity_kind, identity_value) IN (
         SELECT * FROM unnest($5::text[], $6::text[])
       ) ORDER BY identity_kind, identity_value FOR UPDATE`,
      [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, bindings.map(item => item.kind), bindings.map(item => item.value)],
    );
    for (const row of lockedBindings.rows) {
      if (fromRow(row, 'logical_operation_id') !== request.identities.logicalOperationId) {
        await rollback(client);
        inTransaction = false;
        return conflictResult(request, 'conflict');
      }
      if (fromRow(row, 'identity_kind') === 'source_observation' && fromRow(row, 'first_event_id') !== null) {
        const existing = await client.query(
          `SELECT event_id, event_hash, source_content_hash, billable_attempt_id, source_revision_sequence
           FROM cost_intelligence.financial_ledger_events WHERE event_id = $1 FOR UPDATE`,
          [fromRow(row, 'first_event_id')],
        );
        const prior = existing.rows[0] ?? {};
        const duplicate = fromRow(prior, 'event_hash') === eventHash
          && fromRow(prior, 'source_content_hash') === request.sourceIdentity.contentHash
          && fromRow(prior, 'billable_attempt_id') === request.identities.billableAttemptId
          && Number(prior.source_revision_sequence) === request.sourceIdentity.revisionSequence;
        await rollback(client);
        inTransaction = false;
        return { ok: true, value: receipt(request, duplicate ? 'duplicate' : 'conflict', fromRow(prior, 'event_id'), null) };
      }
      if (fromRow(row, 'identity_kind') === 'reservation' && fromRow(row, 'first_event_id') !== null
        && request.eventType === 'reservation_authorized') {
        const existing = await client.query(
          `SELECT event_id, event_hash FROM cost_intelligence.financial_ledger_events WHERE event_id = $1 FOR UPDATE`,
          [fromRow(row, 'first_event_id')],
        );
        const prior = existing.rows[0] ?? {};
        const duplicate = fromRow(prior, 'event_hash') === eventHash;
        await rollback(client);
        inTransaction = false;
        return { ok: true, value: receipt(request, duplicate ? 'duplicate' : 'conflict', fromRow(prior, 'event_id'), null) };
      }
    }

    if (request.reservationAuthorizationEventId !== null) {
      const authorization = await client.query(
        `SELECT tenant_id, project_id, environment, billing_mode, event_type, reservation_id, logical_operation_id, currency
         FROM cost_intelligence.financial_ledger_events WHERE event_id = $1`,
        [request.reservationAuthorizationEventId],
      );
      const authorizationRow = authorization.rows[0] ?? {};
      if (fromRow(authorizationRow, 'tenant_id') !== scope.tenantId
        || fromRow(authorizationRow, 'project_id') !== scope.projectId
        || fromRow(authorizationRow, 'environment') !== scope.environment
        || fromRow(authorizationRow, 'billing_mode') !== scope.billingMode
        || fromRow(authorizationRow, 'event_type') !== 'reservation_authorized'
        || fromRow(authorizationRow, 'reservation_id') !== request.identities.reservationId
        || fromRow(authorizationRow, 'logical_operation_id') !== request.identities.logicalOperationId
        || fromRow(authorizationRow, 'currency')?.trim() !== request.money.currency) {
        await rollback(client);
        inTransaction = false;
        return conflictResult(request, 'conflict', request.reservationAuthorizationEventId);
      }
    }

    await client.query(
      `INSERT INTO cost_intelligence.financial_source_revision_heads
          (tenant_id, project_id, environment, billing_mode, source_name, source_object_id, source_revision_subject_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, request.sourceIdentity.source,
        request.sourceIdentity.sourceObjectId, request.sourceIdentity.revisionSubjectId],
    );
    const sourceHead = await client.query(
      `SELECT current_revision_sequence, current_event_id FROM cost_intelligence.financial_source_revision_heads
       WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4
         AND source_name = $5 AND source_object_id = $6 AND source_revision_subject_id = $7 FOR UPDATE`,
      [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, request.sourceIdentity.source,
        request.sourceIdentity.sourceObjectId, request.sourceIdentity.revisionSubjectId],
    );
    const currentSource = sourceHead.rows[0] ?? {};
    const currentSourceEventId = fromRow(currentSource, 'current_event_id');
    const currentSourceRevision = currentSource.current_revision_sequence === null || currentSource.current_revision_sequence === undefined
      ? null : Number(currentSource.current_revision_sequence);
    if (currentSourceRevision !== null) {
      if (request.sourceIdentity.revisionSequence <= currentSourceRevision || request.supersedesEventId !== currentSourceEventId) {
        await rollback(client);
        inTransaction = false;
        return conflictResult(request, 'stale_revision', currentSourceEventId);
      }
    } else if (request.supersedesEventId !== null) {
      await rollback(client);
      inTransaction = false;
      return conflictResult(request, 'stale_revision');
    }

    let existingBillableEventId: string | null = null;
    if (request.financialEffect) {
      await client.query(
        `INSERT INTO cost_intelligence.financial_billable_attempt_heads
          (tenant_id, project_id, environment, billing_mode, billable_attempt_id, logical_operation_id)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [scope.tenantId, scope.projectId, scope.environment, scope.billingMode,
          request.identities.billableAttemptId, request.identities.logicalOperationId],
      );
      const billableHead = await client.query(
        `SELECT logical_operation_id, current_event_id, current_effect_hash
         FROM cost_intelligence.financial_billable_attempt_heads
         WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4 AND billable_attempt_id = $5 FOR UPDATE`,
        [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, request.identities.billableAttemptId],
      );
      const current = billableHead.rows[0] ?? {};
      if (fromRow(current, 'logical_operation_id') !== request.identities.logicalOperationId) {
        await rollback(client);
        inTransaction = false;
        return conflictResult(request, 'conflict', fromRow(current, 'current_event_id'));
      }
      existingBillableEventId = fromRow(current, 'current_event_id');
      const existingEffectHash = fromRow(current, 'current_effect_hash');
      if (existingBillableEventId !== null) {
        if (request.eventType === 'correction' && request.supersedesEventId === existingBillableEventId) {
          const original = await client.query(
            `SELECT classification, currency, logical_operation_id, billable_attempt_id, reservation_id, reservation_authorization_event_id
             FROM cost_intelligence.financial_ledger_events WHERE event_id = $1 FOR UPDATE`,
            [existingBillableEventId],
          );
          const originalRow = original.rows[0] ?? {};
          if (fromRow(originalRow, 'classification') !== request.classification
            || fromRow(originalRow, 'currency')?.trim() !== request.money.currency
            || fromRow(originalRow, 'logical_operation_id') !== request.identities.logicalOperationId
            || fromRow(originalRow, 'billable_attempt_id') !== request.identities.billableAttemptId
            || fromRow(originalRow, 'reservation_id') !== request.identities.reservationId
            || fromRow(originalRow, 'reservation_authorization_event_id') !== request.reservationAuthorizationEventId) {
            await rollback(client);
            inTransaction = false;
            return conflictResult(request, 'conflict', existingBillableEventId);
          }
        } else if (request.eventType === 'consumption' && request.supersedesEventId === existingBillableEventId) {
          const original = await client.query(
            `SELECT event_type, classification, currency, amount::text AS amount, logical_operation_id,
                    billable_attempt_id, reservation_id, reservation_authorization_event_id
             FROM cost_intelligence.financial_ledger_events WHERE event_id = $1 FOR UPDATE`,
            [existingBillableEventId],
          );
          const originalRow = original.rows[0] ?? {};
          const previousAmount = fromRow(originalRow, 'amount');
          const nextAmount = request.money.amount;
          if (fromRow(originalRow, 'event_type') !== 'consumption'
            || fromRow(originalRow, 'classification') !== request.classification
            || fromRow(originalRow, 'currency')?.trim() !== request.money.currency
            || fromRow(originalRow, 'logical_operation_id') !== request.identities.logicalOperationId
            || fromRow(originalRow, 'billable_attempt_id') !== request.identities.billableAttemptId
            || fromRow(originalRow, 'reservation_id') !== request.identities.reservationId
            || fromRow(originalRow, 'reservation_authorization_event_id') !== request.reservationAuthorizationEventId
            || previousAmount !== null && nextAmount !== null && parseScaledDecimal(nextAmount) < parseScaledDecimal(previousAmount)) {
            await rollback(client);
            inTransaction = false;
            return conflictResult(request, 'conflict', existingBillableEventId);
          }
        } else {
          await rollback(client);
          inTransaction = false;
          return { ok: true, value: receipt(request, existingEffectHash === effectHash ? 'duplicate' : 'conflict', existingBillableEventId, null) };
        }
      }
    }

    if (request.eventType === 'reversal' && request.reversesEventId !== null) {
      const target = await client.query(
        `SELECT tenant_id, project_id, environment, billing_mode, currency, amount::text AS amount, classification
         FROM cost_intelligence.financial_ledger_events WHERE event_id = $1 FOR UPDATE`,
        [request.reversesEventId],
      );
      const targetRow = target.rows[0];
      const amount = request.money.amount;
      if (!targetRow || fromRow(targetRow, 'tenant_id') !== scope.tenantId || fromRow(targetRow, 'project_id') !== scope.projectId
        || fromRow(targetRow, 'environment') !== scope.environment || fromRow(targetRow, 'billing_mode') !== scope.billingMode
        || fromRow(targetRow, 'currency')?.trim() !== request.money.currency || amount === null || fromRow(targetRow, 'amount') === null) {
        await rollback(client);
        inTransaction = false;
        return conflictResult(request, 'conflict', request.reversesEventId);
      }
      const originalAmount = parseScaledDecimal(asString(targetRow.amount));
      const reversalAmount = parseScaledDecimal(amount);
      const previouslyReversed = await client.query(
        `SELECT amount::text AS amount FROM cost_intelligence.financial_ledger_events
         WHERE reverses_event_id = $1 AND tenant_id = $2 AND project_id = $3 AND environment = $4 AND billing_mode = $5`,
        [request.reversesEventId, scope.tenantId, scope.projectId, scope.environment, scope.billingMode],
      );
      const reversedTotal = previouslyReversed.rows.reduce((sum, row) => sum + parseScaledDecimal(asString(row.amount)), 0n) + reversalAmount;
      if (fromRow(targetRow, 'classification') !== request.classification
        || originalAmount === 0n || (originalAmount > 0n) === (reversalAmount > 0n)
        || (reversedTotal > 0n ? reversedTotal : -reversedTotal) > (originalAmount > 0n ? originalAmount : -originalAmount)) {
        await rollback(client);
        inTransaction = false;
        return conflictResult(request, 'conflict', request.reversesEventId);
      }
    }

    const persistedPayload = { ...request, ingestedAt };
    await client.query(
      `INSERT INTO cost_intelligence.financial_ledger_events (
        event_id, ledger_schema_version, tenant_id, project_id, correlation_id, producer_module,
        producer_source_revision, producer_build_revision, occurred_at, observed_at, ingested_at,
        environment, billing_mode, evidence_mode, verification_status, event_type, classification,
        valuation, settlement_status, reconciliation_status, reservation_lifecycle,
        reservation_id, reservation_authorization_event_id,
        logical_operation_id, transport_attempt_id, provider_attempt_id, provider_request_id,
        billable_attempt_id, source_observation_id, source_name, source_event_id, source_object_id, source_revision_subject_id,
        source_revision, source_revision_sequence, source_content_hash, quantity_completeness, quantity_units,
        amount, currency, amount_scale, source_refs, dimensions, pricing, fx_evidence, financial_effect,
        idempotency_key, supersedes_event_id, reverses_event_id, event_hash, event_payload
      ) VALUES (
        $1, '1.0.0', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32,
        $33, $34, $35, $36, $37::jsonb, $38, $39, $40, $41::jsonb, $42::jsonb, $43::jsonb, $44::jsonb,
        $45, $46, $47, $48, $49, $50::jsonb
      )`,
      [
        request.eventId, scope.tenantId, scope.projectId, request.correlationId, request.producer.module,
        request.producer.sourceRevision, request.producer.buildRevision, request.occurredAt, request.observedAt, ingestedAt,
        scope.environment, scope.billingMode, request.evidenceMode, request.verificationStatus, request.eventType, request.classification,
        request.valuation, request.settlementStatus, request.reconciliationStatus, request.reservationLifecycle,
        request.identities.reservationId, request.reservationAuthorizationEventId,
        request.identities.logicalOperationId, request.identities.transportAttemptId, request.identities.providerAttemptId,
        request.identities.providerRequestId, request.identities.billableAttemptId, request.identities.sourceObservationId,
        request.sourceIdentity.source, request.sourceIdentity.sourceEventId, request.sourceIdentity.sourceObjectId,
        request.sourceIdentity.revisionSubjectId,
        request.sourceIdentity.sourceRevision, request.sourceIdentity.revisionSequence, request.sourceIdentity.contentHash,
        request.usage.completeness, JSON.stringify(request.usage.units), request.money.amount, request.money.currency,
        request.money.scale, JSON.stringify(request.sourceRefs), JSON.stringify(request.dimensions),
        request.pricing === null ? null : JSON.stringify(request.pricing),
        request.fxEvidence === null ? null : JSON.stringify(request.fxEvidence), request.financialEffect, request.idempotencyKey, request.supersedesEventId,
        request.reversesEventId, eventHash, JSON.stringify(persistedPayload),
      ],
    );

    for (const binding of bindings) {
      await client.query(
        `UPDATE cost_intelligence.financial_ledger_identity_bindings SET first_event_id = $7
         WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4
           AND identity_kind = $5 AND identity_value = $6 AND first_event_id IS NULL`,
        [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, binding.kind, binding.value, request.eventId],
      );
    }
    await client.query(
      `UPDATE cost_intelligence.financial_source_revision_heads
       SET current_revision_sequence = $8, current_event_id = $9
       WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4
         AND source_name = $5 AND source_object_id = $6 AND source_revision_subject_id = $7`,
      [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, request.sourceIdentity.source,
        request.sourceIdentity.sourceObjectId, request.sourceIdentity.revisionSubjectId, request.sourceIdentity.revisionSequence, request.eventId],
    );
    if (request.financialEffect) {
      await client.query(
        `UPDATE cost_intelligence.financial_billable_attempt_heads
         SET current_event_id = $6, current_effect_hash = $7
         WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4 AND billable_attempt_id = $5`,
        [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, request.identities.billableAttemptId, request.eventId, effectHash],
      );
    }
    await client.query('COMMIT');
    inTransaction = false;
    return { ok: true, value: receipt(request, 'accepted', null, ingestedAt) };
  } catch (error) {
    if (client && inTransaction) await rollback(client);
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (code === '23505' && client) {
      try {
        const existing = await client.query(
          `SELECT event_id, event_hash FROM cost_intelligence.financial_ledger_events
           WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4
             AND (idempotency_key = $5 OR event_id = $6 OR source_observation_id = $7
               OR (source_name = $8 AND source_event_id = $9))
           ORDER BY CASE WHEN idempotency_key = $5 THEN 0 WHEN event_id = $6 THEN 1
             WHEN source_observation_id = $7 THEN 2 ELSE 3 END LIMIT 1`,
          [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, request.idempotencyKey,
            request.eventId, request.identities.sourceObservationId, request.sourceIdentity.source, request.sourceIdentity.sourceEventId],
        );
        const row = existing.rows[0];
        if (row) {
          const existingId = fromRow(row, 'event_id');
          return { ok: true, value: receipt(request, fromRow(row, 'event_hash') === eventHash ? 'duplicate' : 'conflict', existingId, null) };
        }
      } catch {
        return conflictResult(request, 'conflict');
      }
      return conflictResult(request, 'conflict');
    }
    if (code === '23503' || code === '23514') {
      return conflictResult(request, 'conflict');
    }
    return failure(makeError('ledger', 'appendLedgerEvent', 'SOURCE_UNAVAILABLE', request.requestId, 'Ledger persistence is temporarily unavailable.'));
  } finally {
    client?.release();
  }
}

type AmountAccumulator = {
  eventType: LedgerEventType;
  classification: LedgerClassification;
  currency: string;
  eventCount: number;
  knownAmountCount: number;
  unknownAmountCount: number;
  knownAmount: bigint;
};
type QuantityAccumulator = {
  eventType: LedgerEventType;
  classification: LedgerClassification;
  currency: string;
  unitName: string | null;
  relation: 'standalone' | 'included_subset' | 'unknown_relation' | null;
  observationCount: number;
  knownQuantityCount: number;
  unknownQuantityCount: number;
  incompleteObservationCount: number;
  knownQuantity: bigint;
};

function keyFor(...parts: (string | null)[]): string {
  return JSON.stringify(parts);
}

function computeProjectionRows(rows: readonly Record<string, unknown>[]): {
  amounts: Static<typeof ProjectionAmountSchema>[];
  quantities: Static<typeof ProjectionQuantitySchema>[];
} {
  const amounts = new Map<string, AmountAccumulator>();
  const quantities = new Map<string, QuantityAccumulator>();
  for (const row of rows) {
    const eventType = asString(row.event_type) as LedgerEventType;
    const classification = asString(row.classification) as LedgerClassification;
    const currency = asString(row.currency).trim();
    const amountKey = keyFor(eventType, classification, currency);
    let amount = amounts.get(amountKey);
    if (!amount) {
      amount = { eventType, classification, currency, eventCount: 0, knownAmountCount: 0, unknownAmountCount: 0, knownAmount: 0n };
      amounts.set(amountKey, amount);
    }
    amount.eventCount++;
    const rawAmount = fromRow(row, 'amount');
    if (rawAmount === null) amount.unknownAmountCount++;
    else {
      amount.knownAmountCount++;
      amount.knownAmount += parseScaledDecimal(rawAmount);
    }

    const completeness = asString(row.quantity_completeness) as 'unknown' | 'incomplete' | 'complete';
    const rawUnits = row.quantity_units;
    const units = typeof rawUnits === 'string' ? JSON.parse(rawUnits) as Array<Record<string, unknown>> : rawUnits as Array<Record<string, unknown>>;
    const addQuantity = (unitName: string | null, relation: QuantityAccumulator['relation'], quantity: string | null, incomplete: boolean): void => {
      const quantityKey = keyFor(eventType, classification, currency, unitName, relation);
      let accumulator = quantities.get(quantityKey);
      if (!accumulator) {
        accumulator = { eventType, classification, currency, unitName, relation, observationCount: 0, knownQuantityCount: 0, unknownQuantityCount: 0, incompleteObservationCount: 0, knownQuantity: 0n };
        quantities.set(quantityKey, accumulator);
      }
      accumulator.observationCount++;
      if (incomplete) accumulator.incompleteObservationCount++;
      if (quantity === null) accumulator.unknownQuantityCount++;
      else {
        accumulator.knownQuantityCount++;
        accumulator.knownQuantity += parseScaledDecimal(quantity);
      }
    };
    if (units.length === 0) {
      if (completeness !== 'complete') addQuantity(null, null, null, completeness === 'incomplete');
    } else {
      for (const unit of units) {
        const unitName = typeof unit.name === 'string' ? unit.name : null;
        const relation = typeof unit.relation === 'string' ? unit.relation as QuantityAccumulator['relation'] : null;
        const quantity = unit.quantity === null || unit.quantity === undefined ? null : asString(unit.quantity);
        addQuantity(unitName, relation, quantity, completeness !== 'complete');
      }
    }
  }
  const amountRows = [...amounts.values()].map(item => {
    const completeness: Static<typeof ProjectionAmountSchema>['completeness'] = item.unknownAmountCount === 0
      ? 'complete' : item.knownAmountCount === 0 ? 'unknown' : 'partial';
    return {
      eventType: item.eventType, classification: item.classification, currency: item.currency,
      eventCount: item.eventCount, knownAmountCount: item.knownAmountCount, unknownAmountCount: item.unknownAmountCount,
      knownSubtotal: item.knownAmountCount === 0 ? null : formatScaledDecimal(item.knownAmount),
      totalAmount: item.unknownAmountCount > 0 ? null : formatScaledDecimal(item.knownAmount), completeness,
    };
  }).sort((left, right) => keyFor(left.eventType, left.classification, left.currency).localeCompare(keyFor(right.eventType, right.classification, right.currency)));
  const quantityRows = [...quantities.values()].map(item => {
    const completeness: Static<typeof ProjectionQuantitySchema>['completeness'] = item.unknownQuantityCount === 0 && item.incompleteObservationCount === 0
      ? 'complete' : item.knownQuantityCount === 0 && item.incompleteObservationCount === 0 ? 'unknown' : 'incomplete';
    return {
      eventType: item.eventType, classification: item.classification, currency: item.currency,
      unitName: item.unitName, relation: item.relation, observationCount: item.observationCount,
      knownQuantityCount: item.knownQuantityCount, unknownQuantityCount: item.unknownQuantityCount,
      incompleteObservationCount: item.incompleteObservationCount,
      knownSubtotal: item.knownQuantityCount === 0 ? null : formatScaledDecimal(item.knownQuantity),
      totalQuantity: completeness === 'complete' ? formatScaledDecimal(item.knownQuantity) : null,
      completeness,
    };
  }).sort((left, right) => keyFor(left.eventType, left.classification, left.currency, left.unitName, left.relation)
    .localeCompare(keyFor(right.eventType, right.classification, right.currency, right.unitName, right.relation)));
  return { amounts: amountRows, quantities: quantityRows };
}

/** Rebuild and persist an immutable as-of snapshot using exact integer decimal arithmetic. */
export async function rebuildLedgerProjection(
  value: unknown,
  ports: LedgerRuntimePorts,
): Promise<ApiResult<LedgerProjection>> {
  const validated = validateLedgerProjectionRequestBoundary(value);
  if (!validated.ok) return failure(validated.error);
  const request = validated.value;
  const authorizationError = await trustedScope(request, ports, 'rebuildLedgerProjection');
  if (authorizationError) return failure(authorizationError);
  let client: LedgerTransactionPort | undefined;
  let inTransaction = false;
  try {
    client = await ports.database.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    inTransaction = true;
    const events = await client.query(
      `SELECT e.event_id, e.event_hash, e.event_type, e.classification, e.currency, e.amount::text AS amount,
              e.quantity_completeness, e.quantity_units
       FROM cost_intelligence.financial_ledger_events e
       WHERE e.tenant_id = $1 AND e.project_id = $2 AND e.environment = $3 AND e.billing_mode = $4
         AND e.ingested_at <= $5 AND e.financial_effect
         AND NOT EXISTS (
           SELECT 1 FROM cost_intelligence.financial_ledger_events successor
           WHERE successor.supersedes_event_id = e.event_id AND successor.ingested_at <= $5
         )
       ORDER BY e.event_id`,
      [request.scope.tenantId, request.scope.projectId, request.scope.environment, request.scope.billingMode, request.asOf],
    );
    const computed = computeProjectionRows(events.rows);
    const eventEvidence = events.rows.map(row => ({ eventId: asString(row.event_id), eventHash: asString(row.event_hash) }));
    const content = {
      schemaVersion: '1.0.0', scope: request.scope, asOf: request.asOf,
      eventEvidence, eventCount: events.rows.length, amounts: computed.amounts, quantities: computed.quantities,
    };
    const projectionHash = await hashValue(content);
    const snapshot: LedgerProjection = {
      schemaVersion: '1.0.0', snapshotId: projectionHash, projectionHash,
      scope: request.scope, asOf: request.asOf, eventCount: events.rows.length,
      amounts: computed.amounts, quantities: computed.quantities,
    };
    const inserted = await client.query(
      `INSERT INTO cost_intelligence.financial_projection_snapshots
        (snapshot_id, tenant_id, project_id, environment, billing_mode, as_of, event_count, projection_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (snapshot_id) DO NOTHING`,
      [projectionHash, request.scope.tenantId, request.scope.projectId, request.scope.environment, request.scope.billingMode,
        request.asOf, events.rows.length, projectionHash],
    );
    if (inserted.rowCount !== 0) {
      for (const item of computed.amounts) {
        await client.query(
          `INSERT INTO cost_intelligence.financial_projection_amounts
            (snapshot_id, event_type, classification, currency, event_count, known_amount_count,
             unknown_amount_count, known_subtotal, total_amount, amount_completeness)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [projectionHash, item.eventType, item.classification, item.currency, item.eventCount, item.knownAmountCount,
            item.unknownAmountCount, item.knownSubtotal, item.totalAmount, item.completeness],
        );
      }
      for (const item of computed.quantities) {
        await client.query(
          `INSERT INTO cost_intelligence.financial_projection_quantities
            (snapshot_id, event_type, classification, currency, unit_name, relation, observation_count,
             known_quantity_count, unknown_quantity_count, incomplete_observation_count, known_subtotal,
             total_quantity, quantity_completeness)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [projectionHash, item.eventType, item.classification, item.currency, item.unitName, item.relation,
            item.observationCount, item.knownQuantityCount, item.unknownQuantityCount, item.incompleteObservationCount,
            item.knownSubtotal, item.totalQuantity, item.completeness],
        );
      }
    }
    await client.query('COMMIT');
    inTransaction = false;
    return { ok: true, value: snapshot };
  } catch {
    if (client && inTransaction) await rollback(client);
    return failure(makeError('ledger', 'rebuildLedgerProjection', 'SOURCE_UNAVAILABLE', request.requestId, 'Ledger projection rebuild is temporarily unavailable.'));
  } finally {
    client?.release();
  }
}

export function isLedgerRequestValid(schema: TSchema, value: unknown): boolean {
  return Value.Check(schema, value);
}
