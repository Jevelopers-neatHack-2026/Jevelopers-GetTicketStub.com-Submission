import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { createHash } from 'node:crypto';
import {
  CurrencySchema,
  NonNegativeDecimalAmountSchema,
  TrustedScopeSchema,
  errorEnvelope,
  type ErrorEnvelope,
  type Validation,
} from '../shared/contracts.js';

/**
 * CI-06 deterministic accounting projection.
 *
 * This module is the authoritative, offline projection engine for commerce and
 * expense events. It never performs provider or network calls; it consumes
 * already-posted, trusted, normalized events (the CI-02 immutable posting
 * boundary / CI-09 ledger produce these) and derives v1 operational metrics
 * with exact base-10 integer arithmetic.
 *
 * The authored definitions and the sign/classification matrix below are a
 * DOCUMENTED DEFAULT POLICY that is PENDING FINANCE-OWNER SIGN-OFF. See
 * docs/api/accounting.md.
 */

export const ACCOUNTING_POLICY_VERSION = 'ci06-accounting-policy-1.0.0' as const;
export const ACCOUNTING_ALLOCATION_POLICY_VERSION = 'ci06-allocation-policy-1.0.0' as const;
export const ACCOUNTING_DEFINITIONS_STATUS = 'PENDING FINANCE-OWNER SIGN-OFF' as const;

const Sha256Reference = Type.String({ pattern: '^sha256:[a-f0-9]{64}$' });
const Identifier = Type.String({ minLength: 1, maxLength: 256 });

export const AccountingClassificationSchema = Type.Union([
  Type.Literal('sale'), Type.Literal('discount'), Type.Literal('refund'), Type.Literal('credit'),
  Type.Literal('tax'), Type.Literal('fee'), Type.Literal('reimbursement'), Type.Literal('payout'),
  Type.Literal('direct_cost'), Type.Literal('adjustment'), Type.Literal('cash_movement'),
]);
export type AccountingClassification = Static<typeof AccountingClassificationSchema>;

/** Metric a signed amount contributes to. `none` = excluded from all accounting metrics. */
export type AccountingMetric = 'gross_sales' | 'net_sales' | 'direct_costs' | 'none';

/**
 * Event→metric sign/classification matrix (CI-06.1).
 *
 * The sign is applied to a NON-NEGATIVE posted magnitude. Recoveries
 * (credit / reimbursement / fee refund) reduce the ORIGINAL category they are
 * linked to and are never also recorded as negative revenue, so they can never
 * be subtracted twice. Cash movements and payouts never touch accounting
 * metrics; they are kept in a separate cash projection. Taxes are pass-through.
 */
export interface MatrixEntry {
  readonly grossSalesSign: -1 | 0 | 1;
  readonly netSalesSign: -1 | 0 | 1;
  readonly directCostsSign: -1 | 0 | 1;
  readonly cash: 'none' | 'receipt' | 'payout' | 'directional';
  readonly recovery: boolean;
  readonly note: string;
}

export const ACCOUNTING_SIGN_MATRIX: Readonly<Record<string, MatrixEntry>> = Object.freeze({
  sale: { grossSalesSign: 1, netSalesSign: 1, directCostsSign: 0, cash: 'none', recovery: false, note: 'Recognized sale line; before discounts/refunds; excludes pass-through tax.' },
  discount: { grossSalesSign: 0, netSalesSign: -1, directCostsSign: 0, cash: 'none', recovery: false, note: 'Contra-revenue; reduces net sales only.' },
  'refund:sale': { grossSalesSign: 0, netSalesSign: -1, directCostsSign: 0, cash: 'none', recovery: true, note: 'Sales refund linked to original sale; reduces net sales.' },
  'refund:fee': { grossSalesSign: 0, netSalesSign: 0, directCostsSign: -1, cash: 'none', recovery: true, note: 'Fee refund; recovery linked to the original fee; reduces direct costs.' },
  credit: { grossSalesSign: 0, netSalesSign: 0, directCostsSign: -1, cash: 'none', recovery: true, note: 'Supplier/fee credit; recovery linked to its original cost category; reduces direct costs.' },
  reimbursement: { grossSalesSign: 0, netSalesSign: 0, directCostsSign: -1, cash: 'none', recovery: true, note: 'Reimbursement; recovery linked to its original cost category; reduces direct costs.' },
  tax: { grossSalesSign: 0, netSalesSign: 0, directCostsSign: 0, cash: 'none', recovery: false, note: 'Pass-through tax; excluded from gross and net sales.' },
  fee: { grossSalesSign: 0, netSalesSign: 0, directCostsSign: 1, cash: 'none', recovery: false, note: 'Applicable fee recognized as a direct cost under the documented policy.' },
  direct_cost: { grossSalesSign: 0, netSalesSign: 0, directCostsSign: 1, cash: 'none', recovery: false, note: 'Attributed AI / fulfillment / other direct expense.' },
  payout: { grossSalesSign: 0, netSalesSign: 0, directCostsSign: 0, cash: 'payout', recovery: false, note: 'Settlement transfer; cash only; never a new sale or expense.' },
  cash_movement: { grossSalesSign: 0, netSalesSign: 0, directCostsSign: 0, cash: 'directional', recovery: false, note: 'Cash receipt or payout; kept separate from accounting totals.' },
});

const CategoryLinkSchema = Type.Object({
  originalEventId: Type.Optional(Identifier),
  recoveryOf: Type.Optional(Type.Union([
    Type.Literal('sale'), Type.Literal('fee'), Type.Literal('direct_cost'),
  ])),
  refundKind: Type.Optional(Type.Union([Type.Literal('sale'), Type.Literal('fee')])),
}, { additionalProperties: false });

const ManualImportSchema = Type.Object({
  actor: Type.String({ minLength: 1, maxLength: 200 }),
  sourceHash: Sha256Reference,
  reason: Type.String({ minLength: 1, maxLength: 400 }),
  currency: CurrencySchema,
  correctionOf: Type.Optional(Identifier),
}, { additionalProperties: false });

export const AccountingEventSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'),
  eventId: Identifier,
  classification: AccountingClassificationSchema,
  /** Non-negative posted magnitude; the sign comes from the matrix. Null = unknown valuation. */
  amount: Type.Union([NonNegativeDecimalAmountSchema, Type.Null()]),
  currency: CurrencySchema,
  scale: Type.Integer({ minimum: 0, maximum: 18 }),
  /** Actual money vs sandbox/simulated money. Simulated sales never enter actual revenue. */
  recognition: Type.Union([Type.Literal('actual'), Type.Literal('simulated')]),
  evidenceMode: Type.Union([Type.Literal('mocked'), Type.Literal('sandbox'), Type.Literal('live')]),
  occurredAt: Type.String({ format: 'date-time' }),
  source: Type.Object({
    name: Type.String({ minLength: 1, maxLength: 120 }),
    sourceEventId: Identifier,
    revision: Type.Integer({ minimum: 0, maximum: 2147483647 }),
    contentHash: Sha256Reference,
    /** A verified trusted-origin attestation from the payment/financial connector. */
    authenticated: Type.Boolean(),
  }, { additionalProperties: false }),
  links: Type.Optional(CategoryLinkSchema),
  manualImport: Type.Optional(Type.Union([ManualImportSchema, Type.Null()])),
  /** For adjustments/reclassification: the metric the signed magnitude targets. */
  adjustmentTarget: Type.Optional(Type.Union([
    Type.Literal('gross_sales'), Type.Literal('net_sales'), Type.Literal('direct_costs'),
  ])),
  adjustmentDirection: Type.Optional(Type.Union([Type.Literal('increase'), Type.Literal('decrease')])),
  /** cash_movement direction. */
  cashDirection: Type.Optional(Type.Union([Type.Literal('receipt'), Type.Literal('payout')])),
  dimensions: Type.Optional(Type.Object({
    repo: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    feature: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    provider: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    model: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    workflowId: Type.Optional(Identifier),
    productId: Type.Optional(Identifier),
    orderId: Type.Optional(Identifier),
    channel: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type AccountingEvent = Static<typeof AccountingEventSchema>;

export function validateAccountingEventBoundary(value: unknown): Validation<AccountingEvent> {
  if (!Value.Check(AccountingEventSchema, value)) {
    return {
      ok: false,
      error: errorEnvelope('accounting', 'validateAccountingEvent', 'VALIDATION_ERROR', 'accounting-boundary', 'Accounting event failed boundary validation.'),
    };
  }
  return { ok: true, value: value as AccountingEvent };
}

// ----- exact base-10 integer decimal arithmetic -----

function parseMagnitude(amount: string, scale: number): bigint {
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > scale) throw new Error(`amount ${amount} exceeds declared scale ${scale}`);
  const padded = (fraction + '0'.repeat(scale)).slice(0, scale);
  return BigInt(`${whole}${padded}`);
}

function rescale(minor: bigint, fromScale: number, toScale: number): bigint {
  if (toScale === fromScale) return minor;
  if (toScale > fromScale) return minor * 10n ** BigInt(toScale - fromScale);
  throw new Error('cannot losslessly reduce scale');
}

function formatMinor(minor: bigint, scale: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale) || '0';
  const fraction = scale === 0 ? '' : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

function identityKey(event: AccountingEvent): string {
  return JSON.stringify([event.source.name, event.source.sourceEventId, event.source.revision, event.source.contentHash]);
}

function sourcePayloadKey(event: AccountingEvent): string {
  const { eventId: _eventId, ...payload } = event;
  return canonicalJson(payload);
}

function matrixKey(event: AccountingEvent): string {
  if (event.classification === 'refund') return `refund:${event.links?.refundKind ?? 'sale'}`;
  return event.classification;
}

export interface IncompleteRecord {
  readonly eventId: string;
  readonly reason: string;
}

export interface AccountingProjection {
  readonly policyVersion: string;
  readonly definitionsStatus: string;
  readonly currency: string;
  readonly scale: number;
  readonly asOf: string;
  readonly grossSales: string;
  readonly netSales: string;
  readonly directCosts: string;
  readonly contribution: string;
  readonly cash: { readonly receipts: string; readonly payouts: string; readonly net: string };
  readonly simulated: { readonly grossSales: string; readonly netSales: string; readonly directCosts: string; readonly contribution: string };
  readonly refundLinks: ReadonlyArray<{ readonly refundEventId: string; readonly originalEventId: string }>;
  readonly recognizedEventCount: number;
  readonly duplicateEventIds: readonly string[];
  readonly incomplete: readonly IncompleteRecord[];
  readonly projectionHash: string;
}

export interface ProjectAccountingOptions {
  readonly asOf: string;
}

/**
 * Deterministically project accounting metrics from posted events. Input order
 * does not affect the result: events are deduplicated by trusted source
 * identity, superseding adjustments keep only their highest revision per
 * subject, and aggregation is commutative. Unauthenticated sources and manual
 * imports missing required evidence are retained as visibly `incomplete` and
 * never silently included.
 */
export function projectAccounting(events: readonly AccountingEvent[], options: ProjectAccountingOptions): AccountingProjection {
  const incomplete: IncompleteRecord[] = [];
  const duplicateEventIds: string[] = [];

  // 1. Dedupe by trusted source identity (handles replay / reorder).
  const identityGroups = new Map<string, AccountingEvent[]>();
  for (const event of events) {
    const key = identityKey(event);
    const group = identityGroups.get(key) ?? [];
    group.push(event);
    identityGroups.set(key, group);
  }
  const byIdentity = new Map<string, AccountingEvent>();
  for (const [key, group] of identityGroups) {
    const payloads = new Set(group.map(sourcePayloadKey));
    if (payloads.size > 1) {
      for (const event of group) incomplete.push({ eventId: event.eventId, reason: 'source_revision_conflict' });
      continue;
    }
    group.sort((left, right) => left.eventId.localeCompare(right.eventId));
    const [first, ...duplicates] = group;
    if (first) byIdentity.set(key, first);
    duplicateEventIds.push(...duplicates.map(event => event.eventId));
  }

  // 2. For each source revision subject, keep the highest revision so reordered
  //    or repeated source updates cannot double-apply.
  const subjectGroups = new Map<string, AccountingEvent[]>();
  for (const event of byIdentity.values()) {
    const subjectKey = JSON.stringify([event.source.name, event.source.sourceEventId]);
    const group = subjectGroups.get(subjectKey) ?? [];
    group.push(event);
    subjectGroups.set(subjectKey, group);
  }
  const bySubject = new Map<string, AccountingEvent>();
  for (const [subjectKey, group] of subjectGroups) {
    const byRevision = new Map<number, AccountingEvent[]>();
    for (const event of group) {
      const revisions = byRevision.get(event.source.revision) ?? [];
      revisions.push(event);
      byRevision.set(event.source.revision, revisions);
    }
    const hasConflict = [...byRevision.values()].some(revisions => new Set(revisions.map(sourcePayloadKey)).size > 1);
    if (hasConflict) {
      for (const event of group) incomplete.push({ eventId: event.eventId, reason: 'source_revision_conflict' });
      continue;
    }
    const latestRevision = Math.max(...byRevision.keys());
    const latest = (byRevision.get(latestRevision) ?? []).sort((left, right) => left.eventId.localeCompare(right.eventId));
    const chosen = latest[0];
    if (chosen) bySubject.set(subjectKey, chosen);
    for (const event of group) {
      if (event.source.revision < latestRevision || (event.source.revision === latestRevision && event !== chosen)) {
        duplicateEventIds.push(event.eventId);
      }
    }
  }

  const accepted: AccountingEvent[] = [];
  let currency: string | null = null;
  let maxScale = 0;
  for (const event of bySubject.values()) {
    if (!event.source.authenticated) {
      incomplete.push({ eventId: event.eventId, reason: 'source_not_authenticated' });
      continue;
    }
    if (event.manualImport !== undefined && event.manualImport !== null) {
      const manual = event.manualImport;
      if (!manual.actor || !manual.reason || !manual.sourceHash || manual.currency !== event.currency) {
        incomplete.push({ eventId: event.eventId, reason: 'manual_import_missing_auditable_evidence' });
        continue;
      }
    }
    if (event.amount === null) {
      incomplete.push({ eventId: event.eventId, reason: 'unknown_valuation_missing_evidence' });
      continue;
    }
    currency ??= event.currency;
    if (event.currency !== currency) {
      incomplete.push({ eventId: event.eventId, reason: 'currency_mismatch_requires_fx_evidence' });
      continue;
    }
    maxScale = Math.max(maxScale, event.scale);
    accepted.push(event);
  }
  const outputScale = Math.max(maxScale, 2);
  const resolvedCurrency = currency ?? 'USD';

  let grossActual = 0n;
  let netActual = 0n;
  let directActual = 0n;
  let grossSim = 0n;
  let netSim = 0n;
  let directSim = 0n;
  let cashReceipts = 0n;
  let cashPayouts = 0n;
  const refundLinks: Array<{ refundEventId: string; originalEventId: string }> = [];

  for (const event of accepted) {
    const minor = rescale(parseMagnitude(event.amount as string, event.scale), event.scale, outputScale);
    const simulated = event.recognition === 'simulated';

    if (event.classification === 'cash_movement' || event.classification === 'payout') {
      const direction = event.classification === 'payout' ? 'payout' : event.cashDirection ?? 'receipt';
      if (!simulated) {
        if (direction === 'payout') cashPayouts += minor;
        else cashReceipts += minor;
      }
      continue;
    }

    if (event.classification === 'adjustment') {
      const target = event.adjustmentTarget ?? 'direct_costs';
      const sign = event.adjustmentDirection === 'decrease' ? -1n : 1n;
      const signed = sign * minor;
      if (target === 'gross_sales') { if (simulated) grossSim += signed; else grossActual += signed; }
      else if (target === 'net_sales') { if (simulated) netSim += signed; else netActual += signed; }
      else { if (simulated) directSim += signed; else directActual += signed; }
      continue;
    }

    const entry = ACCOUNTING_SIGN_MATRIX[matrixKey(event)];
    if (!entry) { incomplete.push({ eventId: event.eventId, reason: 'unsupported_classification' }); continue; }

    if (event.classification === 'refund' && (event.links?.refundKind ?? 'sale') === 'sale' && event.links?.originalEventId) {
      refundLinks.push({ refundEventId: event.eventId, originalEventId: event.links.originalEventId });
    }

    if (simulated) {
      grossSim += BigInt(entry.grossSalesSign) * minor;
      netSim += BigInt(entry.netSalesSign) * minor;
      directSim += BigInt(entry.directCostsSign) * minor;
    } else {
      grossActual += BigInt(entry.grossSalesSign) * minor;
      netActual += BigInt(entry.netSalesSign) * minor;
      directActual += BigInt(entry.directCostsSign) * minor;
    }
  }

  const contributionActual = netActual - directActual;
  const contributionSim = netSim - directSim;
  refundLinks.sort((a, b) => a.refundEventId.localeCompare(b.refundEventId));
  incomplete.sort((a, b) => a.eventId.localeCompare(b.eventId));
  duplicateEventIds.sort();

  const projection = {
    policyVersion: ACCOUNTING_POLICY_VERSION,
    definitionsStatus: ACCOUNTING_DEFINITIONS_STATUS,
    currency: resolvedCurrency,
    scale: outputScale,
    asOf: options.asOf,
    grossSales: formatMinor(grossActual, outputScale),
    netSales: formatMinor(netActual, outputScale),
    directCosts: formatMinor(directActual, outputScale),
    contribution: formatMinor(contributionActual, outputScale),
    cash: {
      receipts: formatMinor(cashReceipts, outputScale),
      payouts: formatMinor(cashPayouts, outputScale),
      net: formatMinor(cashReceipts - cashPayouts, outputScale),
    },
    simulated: {
      grossSales: formatMinor(grossSim, outputScale),
      netSales: formatMinor(netSim, outputScale),
      directCosts: formatMinor(directSim, outputScale),
      contribution: formatMinor(contributionSim, outputScale),
    },
    refundLinks,
    recognizedEventCount: accepted.length,
    duplicateEventIds,
    incomplete,
  };
  // The projection hash identifies the economic result only, so a replayed or
  // reordered input stream (which changes the duplicate list but not the
  // economics) produces an identical hash.
  const projectionHash = `sha256:${stableHash({
    policyVersion: projection.policyVersion, currency: projection.currency, scale: projection.scale,
    asOf: projection.asOf, grossSales: projection.grossSales, netSales: projection.netSales,
    directCosts: projection.directCosts, contribution: projection.contribution,
    cash: projection.cash, simulated: projection.simulated, refundLinks: projection.refundLinks,
    incomplete: projection.incomplete,
  })}`;
  return { ...projection, projectionHash };
}

// ----- CI-06.3 versioned shared-expense allocation -----

export interface AllocationTarget {
  readonly key: string;
  /** Non-negative integer allocation weight. */
  readonly weight: number;
}

export interface AllocationResult {
  readonly policyVersion: string;
  readonly sourceAmount: string;
  readonly currency: string;
  readonly scale: number;
  readonly allocations: ReadonlyArray<{ readonly key: string; readonly amount: string }>;
  readonly allocatedTotal: string;
  readonly residual: string;
  readonly projectExpense: string;
}

/**
 * Allocate a shared expense that is POSTED ONCE across approved targets using a
 * versioned, deterministic floor allocation. Allocations always sum to at most
 * the source amount; any unallocated remainder is retained as an explicit
 * residual. The source (project) expense is never increased by allocation — it
 * stays exactly equal to the posted amount.
 */
export function allocateSharedExpense(
  sourceAmount: string,
  currency: string,
  scale: number,
  targets: readonly AllocationTarget[],
): AllocationResult {
  const sourceMinor = parseMagnitude(sourceAmount, scale);
  const totalWeight = targets.reduce((sum, target) => sum + BigInt(Math.max(0, Math.trunc(target.weight))), 0n);
  const allocations: Array<{ key: string; amount: string; minor: bigint }> = [];
  let allocatedMinor = 0n;
  if (totalWeight > 0n) {
    for (const target of targets) {
      const weight = BigInt(Math.max(0, Math.trunc(target.weight)));
      // Floor division keeps the running total at or below the source.
      const share = (sourceMinor * weight) / totalWeight;
      allocations.push({ key: target.key, amount: formatMinor(share, scale), minor: share });
      allocatedMinor += share;
    }
  } else {
    for (const target of targets) allocations.push({ key: target.key, amount: formatMinor(0n, scale), minor: 0n });
  }
  const residualMinor = sourceMinor - allocatedMinor;
  return {
    policyVersion: ACCOUNTING_ALLOCATION_POLICY_VERSION,
    sourceAmount: formatMinor(sourceMinor, scale),
    currency,
    scale,
    allocations: allocations.map(({ key, amount }) => ({ key, amount })),
    allocatedTotal: formatMinor(allocatedMinor, scale),
    residual: formatMinor(residualMinor, scale),
    // Allocation is analytical: the project expense remains exactly the posted source.
    projectExpense: formatMinor(sourceMinor, scale),
  };
}

// ----- deterministic content hash (no network, no secrets) -----

function stableHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

export { TrustedScopeSchema };
