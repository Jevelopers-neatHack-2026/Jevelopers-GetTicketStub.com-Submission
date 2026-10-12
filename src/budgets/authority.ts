import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { NonNegativeDecimalAmountSchema, TrustedScopeSchema, type TrustedScope } from '../shared/contracts.js';

/** Finance-local mapping. This is not a canonical shared-contract or a host grant issuer. */
export const RESERVATION_AUTHORITY_MAPPING_VERSION = 'ci-reservation-authority-1.0.0' as const;
export const BudgetReferenceSchema = Type.Object({
  contract: Type.String({ minLength: 1 }), schema_version: Type.Literal('1.0.0'), id: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 0 }), content_hash: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
}, { additionalProperties: false });
export type BudgetReference = Static<typeof BudgetReferenceSchema>;
const Ref = Type.String({ minLength: 1, maxLength: 256 });
const Hash = Type.String({ pattern: '^sha256:[a-f0-9]{64}$' });
export const ReservationAuthorityBindingSchema = Type.Object({
  mappingVersion: Type.Literal(RESERVATION_AUTHORITY_MAPPING_VERSION), budgetScopeId: Ref,
  grantRef: Ref, accountRef: Ref, projectRef: Ref, provider: Ref, model: Ref, operation: Ref,
  targetBindingSha256: Hash, leaseRef: Ref, leaseExpiresAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false });
export type ReservationAuthorityBinding = Static<typeof ReservationAuthorityBindingSchema>;
export const ReservationWorkPlanSchema = Type.Object({
  requestedUnits: Type.Integer({ minimum: 1, maximum: 2147483647 }), unit: Ref,
  unitMaximumAmount: NonNegativeDecimalAmountSchema,
}, { additionalProperties: false });
export type ReservationWorkPlan = Static<typeof ReservationWorkPlanSchema>;
export type ReservationVerificationPhase = 'admission' | 'preparation' | 'post_transport_ack' | 'dispatch';
export interface ReservationAuthorityQuery {
  readonly scope: TrustedScope; readonly billableAttemptId: string; readonly binding: ReservationAuthorityBinding;
  readonly sourceAuthorityRef: BudgetReference; readonly phase: ReservationVerificationPhase;
  readonly reservationId?: string; readonly dispatchIntentRef?: BudgetReference; readonly transportAttemptId?: string;
}
export interface ReservationAuthorityDecision {
  readonly status: 'allowed'; readonly revoked: false; readonly queryDigest: string;
  readonly verifiedAt: string; readonly expiresAt: string; readonly evidenceRef: string; readonly evidenceSha256: string;
}
/** Implemented by the host issuer, independently of incoming request labels or Finance scope permission. */
export interface BudgetReservationAuthorityPort {
  verifyCurrent(query: ReservationAuthorityQuery): Promise<ReservationAuthorityDecision | null>;
}
export interface BudgetEvidenceQuery {
  readonly operation: string; readonly scope: TrustedScope; readonly actorId: string;
  readonly sourceAuthorityRef: BudgetReference; readonly requestDigest: string;
}
export interface BudgetEvidenceDecision {
  readonly status: 'verified'; readonly queryDigest: string; readonly verifiedAt: string; readonly expiresAt: string;
  readonly maximum?: { readonly policyRef: BudgetReference; readonly authorizedCap: string; readonly currency: string };
}
/** Authenticates source records/bytes and approved maximum/replan evidence; a matching hash alone is not authentication. */
export interface BudgetEvidencePort {
  verifyCurrent(query: BudgetEvidenceQuery): Promise<BudgetEvidenceDecision | null>;
}
export function canonicalBudgetJson(value: unknown): string {
  function canon(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canon);
    if (input !== null && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map(k => [k, canon((input as Record<string, unknown>)[k])]));
    return input;
  }
  return JSON.stringify(canon(value));
}
export async function budgetDigest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalBudgetJson(value)));
  return `sha256:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`;
}
export function normalizedBudgetRequest(value: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(value); delete copy.requestId;
  return copy;
}
function currentTimes(value: { verifiedAt: string; expiresAt: string }, now: Date): boolean {
  const verified = Date.parse(value.verifiedAt), expires = Date.parse(value.expiresAt);
  return Number.isFinite(verified) && Number.isFinite(expires) && verified <= now.getTime() && expires > now.getTime();
}
export async function verifyBudgetSource(port: BudgetEvidencePort | undefined, query: BudgetEvidenceQuery, now: Date): Promise<BudgetEvidenceDecision | null> {
  if (!port) return null;
  const decision = await port.verifyCurrent(structuredClone(query));
  if (!decision || decision.status !== 'verified' || decision.queryDigest !== await budgetDigest(query) || !currentTimes(decision, now)) return null;
  if (decision.maximum && (!Value.Check(BudgetReferenceSchema, decision.maximum.policyRef) || !Value.Check(NonNegativeDecimalAmountSchema, decision.maximum.authorizedCap) || !/^[A-Z]{3}$/.test(decision.maximum.currency))) return null;
  return structuredClone(decision);
}
export async function verifyReservationHost(port: BudgetReservationAuthorityPort | undefined, query: ReservationAuthorityQuery, now: Date): Promise<ReservationAuthorityDecision | null> {
  if (!port || !Value.Check(ReservationAuthorityBindingSchema, query.binding) || Date.parse(query.binding.leaseExpiresAt) <= now.getTime()) return null;
  const decision = await port.verifyCurrent(structuredClone(query));
  if (!decision || decision.status !== 'allowed' || decision.revoked !== false || decision.queryDigest !== await budgetDigest(query) || !currentTimes(decision, now)
    || !Value.Check(Ref, decision.evidenceRef) || !Value.Check(Hash, decision.evidenceSha256)) return null;
  return structuredClone(decision);
}
const AttemptIdentitySchema = Type.Object({logicalOperationId:Ref, transportAttemptId:Ref, providerRequestId:Type.Union([Ref,Type.Null()]), providerAttemptId:Ref, billableAttemptId:Ref}, {additionalProperties:false});
export const CurrentReservationRequestSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'), requestId: Ref, scope: TrustedScopeSchema, reservationId: Ref,
  attemptBinding: AttemptIdentitySchema, authorityBinding: ReservationAuthorityBindingSchema,
  expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
  phase: Type.Union([Type.Literal('preparation'), Type.Literal('post_transport_ack')]),
  dispatchIntentRef: Type.Optional(BudgetReferenceSchema), transportAttemptId: Type.Optional(Ref),
}, { additionalProperties: false });
export type CurrentReservationRequest = Static<typeof CurrentReservationRequestSchema>;
export const PartialAcknowledgementRequestSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'), requestId: Ref, idempotencyKey: Ref, scope: TrustedScopeSchema,
  reservationId: Ref, expectedRevision: Type.Integer({ minimum: 1 }), actorReference: Ref,
  attemptBinding: AttemptIdentitySchema, sourceAuthorityRef: BudgetReferenceSchema,
  allowedAmount: NonNegativeDecimalAmountSchema, allowedWorkUnits: Type.Integer({ minimum: 1 }), unit: Ref,
  revisedPlanHash: Hash, revisedPlan: ReservationWorkPlanSchema,
}, { additionalProperties: false });
export type PartialAcknowledgementRequest = Static<typeof PartialAcknowledgementRequestSchema>;
export const FinanceReservationAuthoritySchema = Type.Object({
  status: Type.Literal('held'), revoked: Type.Literal(false), reservation_ref: Ref, billable_attempt_id: Ref,
  budget_scope_id: Ref, lease_ref: Ref, grant_ref: Ref, tenant_id: Ref, project_id: Ref, account_ref: Ref, project_ref: Ref,
  provider: Ref, model: Ref, operation: Ref, target_binding_sha256: Hash,
  held_amount: Type.Object({ amount: NonNegativeDecimalAmountSchema, currency: Type.String({ pattern: '^[A-Z]{3}$' }) }, { additionalProperties: false }),
  authorized_cap: Type.Object({ amount: NonNegativeDecimalAmountSchema, currency: Type.String({ pattern: '^[A-Z]{3}$' }) }, { additionalProperties: false }),
  expires_at: Type.String({ format: 'date-time' }), evidence_ref: Ref, evidence_sha256: Hash,
}, { additionalProperties: false });
export type FinanceReservationAuthority = Static<typeof FinanceReservationAuthoritySchema>;
