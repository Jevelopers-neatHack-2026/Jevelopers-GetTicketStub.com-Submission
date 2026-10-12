import { type CurrentReservationRequest, type PartialAcknowledgementRequest, ReservationAuthorityBindingSchema, ReservationWorkPlanSchema, BudgetReferenceSchema, FinanceReservationAuthoritySchema } from './authority.js';
import { authorizeReservation, changeBudgetPolicy, markReservationDispatched, readReservationSnapshot, revalidateReservation, acknowledgePartialReservation, type BudgetRuntimePorts } from './reservation-store.js';
import { Type, type Static } from '@sinclair/typebox';
import { authorizeFinanceOperation, blockedBoundary, CurrencySchema, NonNegativeDecimalAmountSchema, errorEnvelope, failure, TrustedScopeSchema, validateRequest, type ApiResult, type FinanceOperation, type RuntimePorts, type Validation } from '../shared/contracts.js';
import { validateCanonical, type SharedBudgetReservation, type SharedReleaseRequest, type SharedReserveRequest, type SharedSettleRequest } from '../shared/canonical.js';

const VersionedReferenceSchema = Type.Object({
  contract: Type.String({ minLength: 1 }), schema_version: Type.Literal('1.0.0'), id: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 0 }), content_hash: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
}, { additionalProperties: false });
const AttemptBindingSchema = Type.Object({
  logicalOperationId: Type.String({ minLength: 1 }), transportAttemptId: Type.String({ minLength: 1 }),
  providerRequestId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]), providerAttemptId: Type.String({ minLength: 1 }),
  billableAttemptId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
const EstimateEvidenceSchema = Type.Object({
  completeness: Type.Union([Type.Literal('unknown'), Type.Literal('incomplete'), Type.Literal('complete')]),
  knownSubtotal: NonNegativeDecimalAmountSchema, currency: CurrencySchema, rateCardRef: Type.Union([VersionedReferenceSchema, Type.Null()]),
  missingDimensions: Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 }),
  boundedConservativeMaximum: Type.Optional(NonNegativeDecimalAmountSchema),
  maximumPolicyRef: Type.Optional(VersionedReferenceSchema),
}, { additionalProperties: false });

/** Finance-owned envelope around the pinned proposal's ReserveRequest; it adds the explicit partial-consent and estimate evidence needed by this boundary. */
export const ReservationRequestSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'), requestId: Type.String({ minLength: 1 }), idempotencyKey: Type.String({ minLength: 1 }),
  scope: TrustedScopeSchema, canonicalRequest: Type.Unknown(), estimate: EstimateEvidenceSchema,
  allowPartialAuthorization: Type.Boolean(), attemptBinding: AttemptBindingSchema,
  authorityBinding: Type.Optional(ReservationAuthorityBindingSchema), sourceAuthorityRef: Type.Optional(BudgetReferenceSchema),
  workPlan: Type.Optional(ReservationWorkPlanSchema),
}, { additionalProperties: false });
export type ReservationRequest = Omit<Static<typeof ReservationRequestSchema>, 'canonicalRequest'> & { readonly canonicalRequest: SharedReserveRequest };

/** Validate the finance wrapper and its nested pinned ReserveRequest as one public boundary. */
export function validateReservationRequestBoundary(value: unknown): Validation<ReservationRequest> {
  const outer = validateRequest(ReservationRequestSchema, value, 'budgets', 'authorize');
  if (!outer.ok) return outer;
  const canonical = validateCanonical({ contract: 'ReserveRequest', value: outer.value.canonicalRequest, module: 'budgets', operation: 'authorize', requestId: outer.value.requestId });
  if (!canonical.ok) return canonical;
  const request = canonical.value;
  if (request.tenant_id !== outer.value.scope.tenantId || request.project_id !== outer.value.scope.projectId || request.environment !== outer.value.scope.environment || request.billing_mode !== outer.value.scope.billingMode) {
    return { ok: false, error: errorEnvelope('budgets', 'authorize', 'FORBIDDEN_SCOPE', outer.value.requestId, 'The reservation does not match the authenticated tenant, project, environment, or billing mode.') };
  }
  return { ok: true, value: { ...outer.value, canonicalRequest: request } as ReservationRequest };
}

export const AuthorizationDecisionSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'), requestId: Type.String({ minLength: 1 }), decidedAt: Type.String({ format: 'date-time' }),
  status: Type.Union([Type.Literal('authorized'), Type.Literal('denied'), Type.Literal('partial'), Type.Literal('unavailable')]),
  reservationId: Type.String({ minLength: 1 }), heldAmount: NonNegativeDecimalAmountSchema, availableAmount: NonNegativeDecimalAmountSchema,
  currency: CurrencySchema, estimateCompleteness: Type.Union([Type.Literal('unknown'), Type.Literal('incomplete'), Type.Literal('complete')]),
  knownSubtotal: NonNegativeDecimalAmountSchema, boundedConservativeMaximum: Type.Union([NonNegativeDecimalAmountSchema, Type.Null()]),
  rateCardRef: Type.Union([VersionedReferenceSchema, Type.Null()]), policyRef: VersionedReferenceSchema,
  expiryEligibility: Type.Union([Type.Literal('eligible_if_never_dispatched'), Type.Literal('not_expired'), Type.Literal('held_for_reconciliation')]),
  attemptBinding: AttemptBindingSchema,
  partialAuthorization: Type.Union([Type.Null(), Type.Object({
    allowedAmount: NonNegativeDecimalAmountSchema, allowedWorkUnits: Type.Union([NonNegativeDecimalAmountSchema, Type.Null()]),
    unit: Type.Union([Type.String({ minLength: 1 }), Type.Null()]), callerAcknowledgementRequired: Type.Literal(true),
    replanBeforeDispatch: Type.Literal(true),
  }, { additionalProperties: false })]),
  retryAfterMs: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  finance: Type.Optional(FinanceReservationAuthoritySchema),
  historicalReplay: Type.Optional(Type.Literal(true)),
}, { additionalProperties: false });
export type AuthorizationDecision = Static<typeof AuthorizationDecisionSchema>;

const CommandBase = {
  schemaVersion: Type.Literal('1.0.0'), requestId: Type.String({ minLength: 1 }), idempotencyKey: Type.String({ minLength: 1 }),
  scope: TrustedScopeSchema, reservationId: Type.String({ minLength: 1 }), expectedRevision: Type.Integer({ minimum: 0 }),
  actorReference: Type.String({ minLength: 1, maxLength: 200 }), sourceAuthorityRef: VersionedReferenceSchema,
  attemptBinding: AttemptBindingSchema,
};
const EvidenceReferenceArray = Type.Array(VersionedReferenceSchema, { minItems: 1, maxItems: 100 });
export const MarkDispatchedCommandSchema = Type.Object({
  ...CommandBase, action: Type.Literal('mark_dispatched'), dispatchIntentRef: VersionedReferenceSchema,
  workerLeaseId: Type.String({ minLength: 1 }), workerLeaseExpiresAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false });
export const SettleReservationCommandSchema = Type.Object({
  ...CommandBase, action: Type.Literal('settle'), canonicalCommand: Type.Unknown(),
  settlement: Type.Object({
    measure: Type.Literal('cumulative'), finality: Type.Union([Type.Literal('partial'), Type.Literal('final')]),
    sequence: Type.Integer({ minimum: 1 }), cumulativeAmount: NonNegativeDecimalAmountSchema, currency: CurrencySchema,
    usageCompleteness: Type.Union([Type.Literal('unknown'), Type.Literal('incomplete'), Type.Literal('complete')]),
    sourceObservationRefs: EvidenceReferenceArray, allowObservedOverrun: Type.Literal(true),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export const ReleaseReservationCommandSchema = Type.Object({
  ...CommandBase, action: Type.Literal('release'), canonicalCommand: Type.Unknown(),
  release: Type.Object({
    amount: NonNegativeDecimalAmountSchema, currency: CurrencySchema, reason: Type.String({ minLength: 1, maxLength: 240 }),
    proof: Type.Union([Type.Literal('never_dispatched_fenced'), Type.Literal('final_usage_known')]), evidenceRefs: EvidenceReferenceArray,
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export const ReservationCommandSchema = Type.Union([MarkDispatchedCommandSchema, SettleReservationCommandSchema, ReleaseReservationCommandSchema]);
export type MarkDispatchedCommand = Static<typeof MarkDispatchedCommandSchema>;
export type SettleReservationCommand = Omit<Static<typeof SettleReservationCommandSchema>, 'canonicalCommand'> & { readonly canonicalCommand: SharedSettleRequest };
export type ReleaseReservationCommand = Omit<Static<typeof ReleaseReservationCommandSchema>, 'canonicalCommand'> & { readonly canonicalCommand: SharedReleaseRequest };
export type ReservationCommand = MarkDispatchedCommand | SettleReservationCommand | ReleaseReservationCommand;

/** Validate the lifecycle command against its operation and exact pinned nested payload. */
export function validateSettleReservationCommandBoundary(value: unknown): Validation<SettleReservationCommand> {
  const outer = validateRequest(SettleReservationCommandSchema, value, 'budgets', 'settle');
  if (!outer.ok) return outer;
  const canonical = validateCanonical({ contract: 'SettleRequest', value: outer.value.canonicalCommand, module: 'budgets', operation: 'settle', requestId: outer.value.requestId });
  if (!canonical.ok) return canonical;
  const command = canonical.value;
  if (command.tenant_id !== outer.value.scope.tenantId || command.project_id !== outer.value.scope.projectId || command.environment !== outer.value.scope.environment || command.billing_mode !== outer.value.scope.billingMode || command.reservation_id !== outer.value.reservationId || command.expected_revision !== outer.value.expectedRevision) {
    return { ok: false, error: errorEnvelope('budgets', 'settle', 'FORBIDDEN_SCOPE', outer.value.requestId, 'The reservation command does not match its authenticated scope or expected revision.') };
  }
  return { ok: true, value: { ...outer.value, canonicalCommand: command } as SettleReservationCommand };
}

/** Validate the lifecycle command against its operation and exact pinned nested payload. */
export function validateReleaseReservationCommandBoundary(value: unknown): Validation<ReleaseReservationCommand> {
  const outer = validateRequest(ReleaseReservationCommandSchema, value, 'budgets', 'release');
  if (!outer.ok) return outer;
  const canonical = validateCanonical({ contract: 'ReleaseRequest', value: outer.value.canonicalCommand, module: 'budgets', operation: 'release', requestId: outer.value.requestId });
  if (!canonical.ok) return canonical;
  const command = canonical.value;
  if (command.tenant_id !== outer.value.scope.tenantId || command.project_id !== outer.value.scope.projectId || command.environment !== outer.value.scope.environment || command.billing_mode !== outer.value.scope.billingMode || command.reservation_id !== outer.value.reservationId || command.expected_revision !== outer.value.expectedRevision) {
    return { ok: false, error: errorEnvelope('budgets', 'release', 'FORBIDDEN_SCOPE', outer.value.requestId, 'The reservation command does not match its authenticated scope or expected revision.') };
  }
  return { ok: true, value: { ...outer.value, canonicalCommand: command } as ReleaseReservationCommand };
}

/** Validate the command union and dispatch to the matching complete action boundary. */
export function validateReservationCommandBoundary(value: unknown): Validation<ReservationCommand> {
  const outer = validateRequest(ReservationCommandSchema, value, 'budgets', 'reservationCommand');
  if (!outer.ok) return outer;
  switch (outer.value.action) {
    case 'mark_dispatched': {
      const mark = validateRequest(MarkDispatchedCommandSchema, value, 'budgets', 'markDispatched');
      return mark.ok ? { ok: true, value: mark.value } : mark;
    }
    case 'settle': return validateSettleReservationCommandBoundary(value);
    case 'release': return validateReleaseReservationCommandBoundary(value);
  }
}

export const ReservationSnapshotSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'), requestId: Type.String({ minLength: 1 }), asOf: Type.String({ format: 'date-time' }),
  reservation: Type.Unknown(), state: Type.Union([
    Type.Literal('held'), Type.Literal('dispatched'), Type.Literal('outcome_unknown'), Type.Literal('partially_settled'),
    Type.Literal('settled'), Type.Literal('released'), Type.Literal('expired'), Type.Literal('held_for_reconciliation'),
  ]),
  heldAmount: NonNegativeDecimalAmountSchema, effectiveConsumedAmount: NonNegativeDecimalAmountSchema, releasedAmount: NonNegativeDecimalAmountSchema,
  latestCumulativeSettlement: NonNegativeDecimalAmountSchema, overrunAmount: NonNegativeDecimalAmountSchema, usageFinality: Type.Union([Type.Literal('unknown'), Type.Literal('partial'), Type.Literal('final')]),
  expectedRevision: Type.Integer({ minimum: 0 }), attemptBinding: AttemptBindingSchema,
  finance: Type.Optional(FinanceReservationAuthoritySchema),
  dispatchEligible: Type.Optional(Type.Boolean()),
  commandOutcome: Type.Optional(Type.Union([Type.Literal('applied'), Type.Literal('replay'), Type.Literal('stale_revision'), Type.Literal('conflict')])),
}, { additionalProperties: false });
export type ReservationSnapshot = Omit<Static<typeof ReservationSnapshotSchema>, 'reservation'> & { readonly reservation: SharedBudgetReservation };

/** Validate the snapshot wrapper and its nested pinned BudgetReservation as one public boundary. */
export function validateReservationSnapshotBoundary(value: unknown): Validation<ReservationSnapshot> {
  const outer = validateRequest(ReservationSnapshotSchema, value, 'budgets', 'reservationSnapshot');
  if (!outer.ok) return outer;
  const canonical = validateCanonical({ contract: 'BudgetReservation', value: outer.value.reservation, module: 'budgets', operation: 'reservationSnapshot', requestId: outer.value.requestId });
  if (!canonical.ok) return canonical;
  return { ok: true, value: { ...outer.value, reservation: canonical.value } as ReservationSnapshot };
}

export const BudgetChangeRequestSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'), requestId: Type.String({ minLength: 1 }), idempotencyKey: Type.String({ minLength: 1 }),
  scope: TrustedScopeSchema, newLimit: NonNegativeDecimalAmountSchema, currency: CurrencySchema,
  expectedPolicyRevision: Type.Integer({ minimum: 0 }), expectedLedgerRevision: Type.Integer({ minimum: 0 }),
  actorReference: Type.String({ minLength: 1, maxLength: 200 }), reasonReference: Type.String({ minLength: 1, maxLength: 200 }),
  sourceAuthorityRef: Type.Optional(BudgetReferenceSchema),
}, { additionalProperties: false });
export type BudgetChangeRequest = Static<typeof BudgetChangeRequestSchema>;

export const BudgetChangeReceiptSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'), requestId: Type.String({ minLength: 1 }), status: Type.Union([
    Type.Literal('applied'), Type.Literal('denied'), Type.Literal('stale'), Type.Literal('replay'), Type.Literal('conflict'),
  ]), requestedLimit: NonNegativeDecimalAmountSchema, previousLimit: NonNegativeDecimalAmountSchema, effectiveLimit: NonNegativeDecimalAmountSchema,
  effectiveConsumedSpend: NonNegativeDecimalAmountSchema, activeUnconsumedCommitments: NonNegativeDecimalAmountSchema,
  expectedPolicyRevision: Type.Integer({ minimum: 0 }), resultingPolicyRevision: Type.Integer({ minimum: 0 }),
  replayedStatus: Type.Optional(Type.Union([Type.Literal('denied'), Type.Literal('stale')])),
  alertThresholdPercent: Type.Literal(80), decisionPolicyVersion: Type.Literal('ci-budget-policy-1.0.0'),
  decisionReference: VersionedReferenceSchema,
}, { additionalProperties: false });
export type BudgetChangeReceipt = Static<typeof BudgetChangeReceiptSchema>;

export const ExpenseAdjustmentRequestSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'), requestId: Type.String({ minLength: 1 }), idempotencyKey: Type.String({ minLength: 1 }),
  scope: TrustedScopeSchema, adjustmentId: Type.String({ minLength: 1 }), amount: NonNegativeDecimalAmountSchema, currency: CurrencySchema,
  direction: Type.Union([Type.Literal('increase_expense'), Type.Literal('decrease_expense')]),
  expectedLedgerRevision: Type.Integer({ minimum: 0 }), actorReference: Type.String({ minLength: 1, maxLength: 200 }),
  reasonReference: Type.String({ minLength: 1, maxLength: 200 }), originalPostingRef: VersionedReferenceSchema,
  sourceReference: Type.String({ minLength: 1, maxLength: 240 }), sourceContentHash: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  evidenceMode: Type.Union([Type.Literal('mocked'), Type.Literal('sandbox'), Type.Literal('live')]),
}, { additionalProperties: false });
export type ExpenseAdjustmentRequest = Static<typeof ExpenseAdjustmentRequestSchema>;

export const PostingReceiptSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'), requestId: Type.String({ minLength: 1 }), postingId: Type.String({ minLength: 1 }),
  status: Type.Union([Type.Literal('applied'), Type.Literal('denied'), Type.Literal('stale'), Type.Literal('replay'), Type.Literal('conflict')]),
  ledgerRevision: Type.Integer({ minimum: 0 }), originalPostingRef: VersionedReferenceSchema,
}, { additionalProperties: false });
export type PostingReceipt = Static<typeof PostingReceiptSchema>;

function budgetPorts(ports: RuntimePorts): BudgetRuntimePorts | null {
  return ports.budgets ? { ...ports.budgets, clock: ports.clock, trustedContext: ports.trustedContext, ...(ports.financeAuthority ? { financeAuthority: ports.financeAuthority } : {}) } : null;
}
export async function authorize(request: ReservationRequest, ports: RuntimePorts): Promise<ApiResult<AuthorizationDecision>> {
  const validation = validateReservationRequestBoundary(request);
  if (!validation.ok) return failure(validation.error);
  const engine = budgetPorts(ports);
  if (engine) return authorizeReservation(validation.value, engine);
  const auth = await authorizeFinanceOperation({ module: 'budgets', requestOperation: 'authorize', operation: 'budgets.authorize', scope: validation.value.scope, requestId: validation.value.requestId, clock: ports.clock, ...(ports.financeAuthority ? { financeAuthority: ports.financeAuthority } : {}) });
  if (!auth.ok && auth.error.code !== 'SOURCE_UNAVAILABLE') return failure(auth.error);
  return failure(errorEnvelope('budgets', 'authorize', 'BUDGET_UNAVAILABLE', request.requestId, 'The host has not configured the budget authority.', true));
}

async function reservationCommand(args: {
  request: ReservationCommand;
  ports: RuntimePorts;
  operation: string;
  authorityOperation: FinanceOperation;
  expectedAction: ReservationCommand['action'];
  schema: typeof MarkDispatchedCommandSchema | typeof SettleReservationCommandSchema | typeof ReleaseReservationCommandSchema;
  validate(value: unknown): Validation<ReservationCommand>;
}): Promise<ApiResult<ReservationSnapshot>> {
  const { request, ports, operation, expectedAction, schema } = args;
  const validation = args.validate(request);
  if (!validation.ok) return failure(validation.error);
  const parsed = validation.value as ReservationCommand;
  if (parsed.action !== expectedAction) return failure(errorEnvelope('budgets', operation, 'VALIDATION_ERROR', parsed.requestId, 'The command action does not match this lifecycle operation.'));
  return blockedBoundary<ReservationCommand, ReservationSnapshot>({ module: 'budgets', operation, authorityOperation: args.authorityOperation, schema, request: parsed, ports, unavailableCode: 'BUDGET_UNAVAILABLE', safeMessage: `Reservation ${operation} is not available until the budget lifecycle leaf is delivered.`, retryable: true });
}

export async function markDispatched(request: MarkDispatchedCommand, ports: RuntimePorts): Promise<ApiResult<ReservationSnapshot>> {
  const engine = budgetPorts(ports);
  if (engine) {
    const result = await markReservationDispatched(request, engine);
    if (!result.ok) return result;
    const snapshot=await readReservationSnapshot({ schemaVersion: '1.0.0', requestId: request.requestId, scope: request.scope, reservationId: request.reservationId }, engine);
    return snapshot.ok ? {ok:true,value:{...snapshot.value,commandOutcome:result.value.status}} : snapshot;
  }
  return reservationCommand({ request, ports, operation: 'markDispatched', authorityOperation: 'budgets.markDispatched', expectedAction: 'mark_dispatched', schema: MarkDispatchedCommandSchema, validate: value => {
    const result = validateRequest(MarkDispatchedCommandSchema, value, 'budgets', 'markDispatched');
    return result.ok ? { ok: true, value: result.value } : result;
  } });
}
export async function settle(request: SettleReservationCommand, ports: RuntimePorts): Promise<ApiResult<ReservationSnapshot>> {
  return reservationCommand({ request, ports, operation: 'settle', authorityOperation: 'budgets.settle', expectedAction: 'settle', schema: SettleReservationCommandSchema, validate: value => validateSettleReservationCommandBoundary(value) });
}
export async function release(request: ReleaseReservationCommand, ports: RuntimePorts): Promise<ApiResult<ReservationSnapshot>> {
  return reservationCommand({ request, ports, operation: 'release', authorityOperation: 'budgets.release', expectedAction: 'release', schema: ReleaseReservationCommandSchema, validate: value => validateReleaseReservationCommandBoundary(value) });
}
export async function changeBudget(request: BudgetChangeRequest, ports: RuntimePorts): Promise<ApiResult<BudgetChangeReceipt>> {
  const valid = validateRequest(BudgetChangeRequestSchema, request, 'budgets', 'changeBudget');
  if (!valid.ok) return failure(valid.error);
  const engine = budgetPorts(ports);
  if (!engine) return blockedBoundary<BudgetChangeRequest, BudgetChangeReceipt>({ module: 'budgets', operation: 'changeBudget', authorityOperation: 'budgets.changeBudget', schema: BudgetChangeRequestSchema, request, ports, unavailableCode: 'BUDGET_UNAVAILABLE', safeMessage: 'The host has not configured the budget authority.', retryable: true });
  const parsed=structuredClone(valid.value);
  const { newLimit, ...rest } = parsed;
  if (!rest.sourceAuthorityRef || !engine.budgetEvidence) return failure(errorEnvelope('budgets', 'changeBudget', 'BUDGET_UNAVAILABLE', request.requestId, 'Current policy source authority is not configured.', true));
  const result = await changeBudgetPolicy({ ...rest, limitAmount: newLimit }, engine);
  if (!result.ok) return result;
  const r = result.value;
  return { ok: true, value: { schemaVersion: '1.0.0', requestId: request.requestId, status: r.status,
    requestedLimit: parsed.newLimit, previousLimit: r.previousLimit, effectiveLimit: r.effectiveLimit,
    effectiveConsumedSpend: r.effectiveConsumedSpend, activeUnconsumedCommitments: r.activeUnconsumedCommitments,
    expectedPolicyRevision: parsed.expectedPolicyRevision, resultingPolicyRevision: r.policyRevision,
    alertThresholdPercent: 80, decisionPolicyVersion: 'ci-budget-policy-1.0.0', decisionReference: r.policyRef, ...(r.replayedStatus?{replayedStatus:r.replayedStatus}:{}) } };
}

export async function recordExpenseAdjustment(request: ExpenseAdjustmentRequest, ports: RuntimePorts): Promise<ApiResult<PostingReceipt>> {
  return blockedBoundary<ExpenseAdjustmentRequest, PostingReceipt>({ module: 'budgets', operation: 'recordExpenseAdjustment', authorityOperation: 'budgets.recordExpenseAdjustment', schema: ExpenseAdjustmentRequestSchema, request, ports, unavailableCode: 'SOURCE_UNAVAILABLE', safeMessage: 'Expense adjustment posting is not available until the accounting leaf is delivered.', retryable: true });
}

// Explicit host composition connects the public CI05A facades to this engine.
// CI05B public settlement/release remain unavailable pending accepted lifecycle evidence.
export * from './reservation-store.js';
export * from './authority.js';

/** Host composition still supplies the separate genuine access grant; Finance never manufactures it. */
export async function getReservationSnapshot(request: import('./reservation-store.js').ReservationSnapshotRequest, ports: RuntimePorts): Promise<ApiResult<ReservationSnapshot>> {
  const engine=budgetPorts(ports);
  if(!engine)return failure(errorEnvelope('budgets','getReservationSnapshot','BUDGET_UNAVAILABLE',request.requestId,'The host has not configured the budget authority.',true));
  return readReservationSnapshot(request,engine);
}
export async function revalidateAuthorization(request: CurrentReservationRequest, ports: RuntimePorts) {
  const engine=budgetPorts(ports);
  if(!engine)return failure(errorEnvelope('budgets','revalidateAuthorization','BUDGET_UNAVAILABLE',request.requestId,'The host has not configured the budget authority.',true));
  return revalidateReservation(request,engine);
}
export async function acknowledgePartial(request: PartialAcknowledgementRequest, ports: RuntimePorts) {
  const engine=budgetPorts(ports);
  if(!engine)return failure(errorEnvelope('budgets','acknowledgePartial','BUDGET_UNAVAILABLE',request.requestId,'The host has not configured the budget authority.',true));
  return acknowledgePartialReservation(request,engine);
}
