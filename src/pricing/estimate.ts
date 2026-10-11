import { Value } from '@sinclair/typebox/value';
import {
  errorEnvelope,
  failure,
  sameScope,
  success,
  validateRequest,
  type ApiResult,
  type ErrorEnvelope,
  type RuntimePorts,
  type Validation,
} from '../shared/contracts.js';
import { validateCanonical } from '../shared/canonical.js';
import {
  add,
  compare,
  divide,
  multiply,
  parseNonNegativeDecimal,
  rational,
  ratioJson,
  roundedDecimal,
  subtract,
  utcMicros,
  type ExactRational,
} from './exact.js';
import {
  loadPricingCatalog,
  type PricingRuntimePorts,
  type StoredVersion,
} from './store.js';
import {
  EstimateRequestSchema,
  EstimateResultSchema,
  type EstimateRequest,
  type EstimateResult,
  type FxRate,
  type PricingRule,
  type RateCard,
  type VersionedReference,
} from './schemas.js';

type UsageValue = {
  readonly name: string;
  readonly quantity: ExactRational | null;
  readonly unit: string;
  readonly relation: string;
  readonly includedIn: string | null;
};

type PricedLine = EstimateResult['calculation'][number];

function safeError(code: ErrorEnvelope['code'], requestId: string, message: string, retryable = false): ErrorEnvelope {
  return errorEnvelope('pricing', 'estimate', code, requestId, message, retryable);
}

function validationFailure(requestId: string, message: string): Validation<never> {
  return { ok: false, error: safeError('VALIDATION_ERROR', requestId, message) };
}

function sameReference(left: VersionedReference, right: VersionedReference): boolean {
  return left.contract === right.contract && left.schema_version === right.schema_version && left.id === right.id
    && left.revision === right.revision && left.content_hash === right.content_hash;
}

function parseUsageEvent(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

export function validateEstimateRequestBoundary(value: unknown): Validation<EstimateRequest> {
  const requestId = typeof value === 'object' && value !== null && 'requestId' in value && typeof value.requestId === 'string'
    ? value.requestId : 'unavailable';
  const outer = validateRequest(EstimateRequestSchema, value, 'pricing', 'estimate');
  if (!outer.ok) return outer;
  const canonical = validateCanonical({
    contract: 'UsageEvent',
    value: outer.value.usageEvent,
    module: 'pricing',
    operation: 'estimate',
    requestId: outer.value.requestId,
  });
  if (!canonical.ok) return canonical;
  const request = { ...outer.value, usageEvent: canonical.value } as EstimateRequest;
  const event = parseUsageEvent(request.usageEvent);
  if (event.tenant_id !== request.scope.tenantId || event.project_id !== request.scope.projectId
    || event.environment !== request.scope.environment || event.billing_mode !== request.scope.billingMode) {
    return { ok: false, error: safeError('FORBIDDEN_SCOPE', request.requestId, 'The usage event does not match the authenticated financial scope.') };
  }
  const selection = request.selection;
  if (selection.rateCardRef && selection.rateCardRef.contract !== 'RateCard') {
    return validationFailure(requestId, 'A pinned pricing version must reference a rate card.');
  }
  if (selection.fxRateRef && selection.fxRateRef.contract !== 'FxRate') {
    return validationFailure(requestId, 'A pinned conversion version must reference an FX rate.');
  }
  if (selection.policy === 'event_time') {
    if (selection.contractTimeEvidenceRef !== null || utcMicros(selection.effectiveAt) === null
      || utcMicros(String(event.occurred_at)) !== utcMicros(selection.effectiveAt)) {
      return validationFailure(request.requestId, 'Event-time selection must use the canonical usage event occurred_at timestamp.');
    }
  } else if (selection.contractTimeEvidenceRef === null || selection.contractTimeEvidenceRef.contract !== 'ContractTimeEvidence') {
    return validationFailure(request.requestId, 'Contract-time selection requires a versioned contract-time evidence reference.');
  }
  const dimensions = [selection.contextTier, selection.serviceTier, selection.reasoningMode, selection.toolClass];
  const hasDimension = dimensions.some(value => value !== null);
  if (hasDimension !== (selection.dimensionsEvidenceRef !== null)) {
    return validationFailure(request.requestId, 'Non-null selection dimensions require one content-addressed usage source reference.');
  }
  if (selection.dimensionsEvidenceRef) {
    const sourceRefs = Array.isArray(event.source_refs) ? event.source_refs as Array<Record<string, unknown>> : [];
    const found = sourceRefs.some(ref => ref.id === selection.dimensionsEvidenceRef?.id
      && ref.content_hash === selection.dimensionsEvidenceRef?.content_hash);
    if (!found) return validationFailure(request.requestId, 'Selection dimensions must be backed by a source reference on the canonical usage event.');
  }
  return { ok: true, value: request };
}

function resultBase(request: EstimateRequest, estimatedAt: string, effectiveAt: string): EstimateResult {
  return {
    schemaVersion: '1.0.0',
    requestId: request.requestId,
    estimatedAt,
    status: 'unknown',
    selectionPolicy: request.selection.policy,
    effectiveAt,
    knownSubtotal: null,
    knownSubtotalExact: null,
    currency: null,
    rateCardRef: null,
    pricingRuleRef: null,
    fxRateRef: null,
    fxConvertedSubtotal: null,
    fxConvertedSubtotalExact: null,
    fxTargetCurrency: request.selection.requestedCurrency,
    missingDimensions: [],
    assumptions: [
      'Rate selection uses the explicit event-time or authority-verified contract-time instant; wall-clock time never selects historical rates.',
      'Amounts retain exact rational products and are rounded once to 18 decimal places using half-even at the result boundary.',
      'The estimate is a non-posting valuation; it is not a confirmed expense or purchase authorization.',
    ],
    boundedConservativeAuthorizationAmount: null,
    calculation: [],
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort().slice(0, 100);
}

function activeVersions<T extends { id: string; revision: number; effectiveFrom: string; effectiveTo: string | null }>(
  rows: readonly StoredVersion<T>[],
  effectiveAt: bigint,
): StoredVersion<T>[] {
  const groups = new Map<string, StoredVersion<T>[]>();
  for (const row of rows) {
    const group = groups.get(row.value.id) ?? [];
    group.push(row);
    groups.set(row.value.id, group);
  }
  const active: StoredVersion<T>[] = [];
  for (const versions of groups.values()) {
    versions.sort((left, right) => left.value.revision - right.value.revision);
    for (let index = 0; index < versions.length; index += 1) {
      const version = versions[index];
      if (!version) continue;
      const start = utcMicros(version.value.effectiveFrom);
      const explicitEnd = version.value.effectiveTo === null ? null : utcMicros(version.value.effectiveTo);
      const nextStart = versions[index + 1] ? utcMicros(versions[index + 1]!.value.effectiveFrom) : null;
      const end = explicitEnd === null ? nextStart : nextStart === null || explicitEnd < nextStart ? explicitEnd : nextStart;
      if (start !== null && start <= effectiveAt && (end === null || effectiveAt < end)) active.push(version);
    }
  }
  return active;
}

function matchesModel(card: RateCard, model: unknown): boolean {
  return typeof model === 'string' && (card.modelOrSku === model || card.aliases.includes(model));
}

function dimensionMatches(card: RateCard, request: EstimateRequest): boolean {
  return card.contextTier === request.selection.contextTier
    && card.serviceTier === request.selection.serviceTier
    && card.reasoningMode === request.selection.reasoningMode
    && card.toolClass === request.selection.toolClass;
}

function parseUsageUnits(event: Record<string, unknown>, missing: string[]): Map<string, UsageValue> {
  const values = new Map<string, UsageValue>();
  const rawUnits = event.usage_units;
  if (!Array.isArray(rawUnits)) {
    missing.push('usage_units_unavailable');
    return values;
  }
  for (const raw of rawUnits) {
    if (typeof raw !== 'object' || raw === null) {
      missing.push('usage_unit_invalid');
      continue;
    }
    const unit = raw as Record<string, unknown>;
    const name = typeof unit.name === 'string' ? unit.name : '';
    if (!name) {
      missing.push('usage_unit_name_missing');
      continue;
    }
    if (values.has(name)) {
      missing.push('duplicate_usage_unit:' + name);
      values.delete(name);
      continue;
    }
    let quantity: ExactRational | null = null;
    if (typeof unit.quantity === 'string' && Number.isInteger(unit.scale) && Number(unit.scale) >= 0 && Number(unit.scale) <= 18) {
      try {
        quantity = parseNonNegativeDecimal(unit.quantity);
        const actualScale = unit.quantity.split('.')[1]?.length ?? 0;
        if (actualScale > Number(unit.scale)) {
          quantity = null;
          missing.push('usage_scale_invalid:' + name);
        }
      } catch {
        missing.push('usage_quantity_invalid:' + name);
      }
    } else {
      missing.push('usage_quantity_unknown:' + name);
    }
    values.set(name, {
      name,
      quantity,
      unit: typeof unit.unit === 'string' ? unit.unit : '',
      relation: typeof unit.relation === 'string' ? unit.relation : 'unknown_relation',
      includedIn: typeof unit.included_in === 'string' ? unit.included_in : null,
    });
  }
  return values;
}

function appendMissingUsageEvidence(event: Record<string, unknown>, missing: string[]): void {
  const fields = Array.isArray(event.missing_fields) ? event.missing_fields : [];
  for (const field of fields) if (typeof field === 'string') missing.push('usage_field:' + field);
  if (event.completeness === 'unknown') missing.push('usage_completeness_unknown');
  else if (event.completeness === 'incomplete' && fields.length === 0) missing.push('usage_completeness_incomplete');
}

function validateObservedRelation(
  unit: UsageValue,
  rule: PricingRule['usageUnits'][number],
  missing: string[],
): boolean {
  if (unit.relation !== rule.relation || (rule.relation === 'included_subset' && unit.includedIn !== rule.includedIn)) {
    missing.push('usage_relation_mismatch:' + rule.name);
    return false;
  }
  if (unit.unit !== '' && unit.unit !== rule.unit) {
    missing.push('usage_unit_mismatch:' + rule.name);
    return false;
  }
  return unit.quantity !== null;
}

function staleFor(effectiveAt: bigint, retrievedAt: string, freshnessMaxAgeSeconds: number): boolean {
  const retrieved = utcMicros(retrievedAt);
  return retrieved === null || effectiveAt - retrieved > BigInt(freshnessMaxAgeSeconds) * 1_000_000n;
}

function rateForCategory(card: RateCard, rule: PricingRule['usageUnits'][number]): RateCard['unitRates'][number] | undefined {
  if (rule.category === null) return undefined;
  return card.unitRates.find(rate => rate.category === rule.category);
}

function usageCalculation(
  request: EstimateRequest,
  event: Record<string, unknown>,
  card: RateCard,
  rule: PricingRule,
  missing: string[],
): { lines: PricedLine[]; exactTotal: ExactRational } {
  appendMissingUsageEvidence(event, missing);
  const observed = parseUsageUnits(event, missing);
  const ruleByName = new Map(rule.usageUnits.map(unit => [unit.name, unit]));
  for (const name of observed.keys()) if (!ruleByName.has(name)) missing.push('unsupported_usage_unit:' + name);

  const resolved = new Map<string, { rule: PricingRule['usageUnits'][number]; unit: UsageValue | null; quantity: ExactRational | null }>();
  for (const unitRule of rule.usageUnits) {
    const unit = observed.get(unitRule.name) ?? null;
    if (!unit) {
      if (unitRule.missingPolicy === 'required') missing.push('usage:' + unitRule.name);
      if (unitRule.missingPolicy === 'unknown') missing.push('usage_applicability:' + unitRule.name);
      resolved.set(unitRule.name, { rule: unitRule, unit: null, quantity: null });
      continue;
    }
    if (!validateObservedRelation(unit, unitRule, missing)) {
      resolved.set(unitRule.name, { rule: unitRule, unit, quantity: null });
      continue;
    }
    resolved.set(unitRule.name, { rule: unitRule, unit, quantity: unit.quantity });
  }

  const invalidParents = new Set<string>();
  for (const parent of rule.usageUnits) {
    if (parent.relation !== 'standalone') continue;
    const parentValue = resolved.get(parent.name)?.quantity;
    if (!parentValue) continue;
    let partitionTotal = rational(0n);
    for (const subsetRule of rule.usageUnits) {
      if (subsetRule.includedIn !== parent.name) continue;
      const subset = resolved.get(subsetRule.name);
      if (subset?.quantity && compare(subset.quantity, parentValue) > 0) {
        missing.push('usage_partition_exceeds_total:' + parent.name);
        invalidParents.add(parent.name);
      }
      if (subsetRule.treatment === 'charge_subset' && subset?.quantity) {
        partitionTotal = add(partitionTotal, subset.quantity);
      }
    }
    if (compare(partitionTotal, parentValue) > 0) {
      missing.push('usage_partition_exceeds_total:' + parent.name);
      invalidParents.add(parent.name);
    }
  }

  const lines: PricedLine[] = [];
  let exactTotal = rational(0n);
  for (const unitRule of rule.usageUnits) {
    if (unitRule.treatment === 'included') continue;
    if (unitRule.treatment === 'unsupported') {
      if (observed.has(unitRule.name) || unitRule.missingPolicy !== 'not_applicable') {
        missing.push('unsupported_usage_category:' + unitRule.name);
      }
      continue;
    }
    const item = resolved.get(unitRule.name);
    if (!item?.quantity || !item.unit) continue;
    if (unitRule.includedIn && invalidParents.has(unitRule.includedIn)) continue;
    let quantity = item.quantity;
    if (unitRule.treatment === 'charge_residual') {
      const missingPartition = rule.usageUnits.some(subsetRule => {
        if (subsetRule.treatment !== 'charge_subset' || subsetRule.includedIn !== unitRule.name) return false;
        const subset = resolved.get(subsetRule.name);
        return subset?.quantity === null || subset?.quantity === undefined;
      });
      if (missingPartition) continue;
      let subtotal = rational(0n);
      for (const subsetRule of rule.usageUnits) {
        if (subsetRule.treatment !== 'charge_subset' || subsetRule.includedIn !== unitRule.name) continue;
        const subset = resolved.get(subsetRule.name)?.quantity;
        if (subset) subtotal = add(subtotal, subset);
      }
      if (compare(subtotal, item.quantity) > 0) continue;
      quantity = subtract(item.quantity, subtotal);
    }
    const rate = rateForCategory(card, unitRule);
    if (!rate) {
      missing.push('rate_category:' + (unitRule.category ?? unitRule.name));
      continue;
    }
    if (rate.unit !== unitRule.unit || rate.relation !== unitRule.relation
      || (rate.includedIn ?? null) !== (unitRule.includedIn ?? null)) {
      missing.push('rate_semantics:' + unitRule.name);
      continue;
    }
    let amount: ExactRational;
    try {
      amount = divide(multiply(quantity, parseNonNegativeDecimal(rate.rate)), parseNonNegativeDecimal(rate.basisQuantity));
    } catch {
      missing.push('rate_arithmetic:' + unitRule.name);
      continue;
    }
    lines.push({
      usageUnit: unitRule.name,
      category: rate.category,
      quantity: roundedDecimal(quantity),
      unit: unitRule.unit,
      basisQuantity: rate.basisQuantity,
      rate: rate.rate,
      exactAmount: ratioJson(amount),
      extendedAmount: roundedDecimal(amount),
      relation: rate.relation,
    });
    exactTotal = add(exactTotal, amount);
  }
  return { lines, exactTotal };
}

function cardRuleRef(card: RateCard): VersionedReference {
  return card.pricingRuleRef;
}

function validRefForEvent(event: Record<string, unknown>, selection: EstimateRequest['selection']): VersionedReference | null {
  const fromRequest = selection.rateCardRef;
  const fromEvent = eventReference(event);
  if (fromRequest && fromEvent && !sameReference(fromRequest, fromEvent)) return null;
  return fromRequest ?? fromEvent;
}

function eventReference(event: Record<string, unknown>): VersionedReference | null {
  const valuation = event.valuation;
  if (typeof valuation !== 'object' || valuation === null) return null;
  const raw = (valuation as Record<string, unknown>).rate_card_ref;
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const reference = raw as Record<string, unknown>;
  if (typeof reference.contract !== 'string' || typeof reference.schema_version !== 'string'
    || typeof reference.id !== 'string' || typeof reference.revision !== 'number'
    || typeof reference.content_hash !== 'string') return null;
  return reference as unknown as VersionedReference;
}

function addMissing(existing: string[], additional: readonly string[]): void {
  existing.push(...additional);
}

export function estimate(request: EstimateRequest, ports: PricingRuntimePorts): Promise<ApiResult<EstimateResult>>;
/** Generic worker composition remains type-compatible and fails closed without the pricing catalog adapter. */
export function estimate(request: EstimateRequest, ports: RuntimePorts): Promise<ApiResult<EstimateResult>>;
export async function estimate(
  request: EstimateRequest,
  ports: PricingRuntimePorts | RuntimePorts,
): Promise<ApiResult<EstimateResult>> {
  const validation = validateEstimateRequestBoundary(request);
  if (!validation.ok) return failure(validation.error);
  const parsed = validation.value;
  const event = parseUsageEvent(parsed.usageEvent);
  let effectiveAt = parsed.selection.effectiveAt;
  const selectedMicros = utcMicros(effectiveAt);
  if (selectedMicros === null) return failure(safeError('VALIDATION_ERROR', parsed.requestId, 'Pricing selection time must be a UTC instant at PostgreSQL microsecond precision.'));

  try {
    const trusted = await ports.trustedContext.resolve(parsed.scope);
    if (!trusted || !sameScope(trusted, parsed.scope)) {
      return failure(safeError('FORBIDDEN_SCOPE', parsed.requestId, 'The requested financial scope is not authorized.'));
    }
  } catch {
    return failure(safeError('SOURCE_UNAVAILABLE', parsed.requestId, 'Trusted pricing scope is temporarily unavailable.', true));
  }

  let estimatedAt: string;
  try {
    const now = ports.clock.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('invalid clock');
    estimatedAt = now.toISOString();
  } catch {
    return failure(safeError('SOURCE_UNAVAILABLE', parsed.requestId, 'The trusted pricing clock is temporarily unavailable.', true));
  }

  if (!('database' in ports)) {
    return failure(safeError('SOURCE_UNAVAILABLE', parsed.requestId, 'The immutable pricing catalog is temporarily unavailable.', true));
  }

  if (parsed.selection.policy === 'contract_time') {
    const evidenceRef = parsed.selection.contractTimeEvidenceRef;
    if (!evidenceRef || !ports.contractTimeAuthority) {
      const unknown = resultBase(parsed, estimatedAt, effectiveAt);
      unknown.status = 'unknown';
      unknown.missingDimensions = ['authoritative_contract_time_evidence'];
      return success(unknown);
    }
    try {
      const resolved = await ports.contractTimeAuthority.resolve(parsed.scope, evidenceRef);
      if (!resolved || resolved.verified !== true || !sameReference(resolved.reference, evidenceRef)
        || utcMicros(resolved.effectiveAt) !== selectedMicros) {
        const unknown = resultBase(parsed, estimatedAt, effectiveAt);
        unknown.status = 'unknown';
        unknown.missingDimensions = ['authoritative_contract_time_evidence'];
        return success(unknown);
      }
      effectiveAt = resolved.effectiveAt;
    } catch {
      return failure(safeError('SOURCE_UNAVAILABLE', parsed.requestId, 'The authoritative contract-time source is temporarily unavailable.', true));
    }
  }

  const effectiveMicros = utcMicros(effectiveAt);
  if (effectiveMicros === null) return failure(safeError('VALIDATION_ERROR', parsed.requestId, 'Pricing selection time must be a valid UTC instant.'));
  const eventValuation = (event.valuation ?? {}) as Record<string, unknown>;
  if (eventValuation.basis === 'provider_confirmed') {
    const result = resultBase(parsed, estimatedAt, effectiveAt);
    result.status = 'unknown';
    result.missingDimensions = ['provider_confirmed_usage_must_use_original_ledger_posting'];
    result.assumptions.push('Provider-confirmed amounts remain in the immutable ledger and are not replaced by a new estimate.');
    return success(result);
  }

  const pinnedRateCard = validRefForEvent(event, parsed.selection);
  if (parsed.selection.rateCardRef && eventReference(event) && !pinnedRateCard) {
    const result = resultBase(parsed, estimatedAt, effectiveAt);
    result.status = 'pricing_unknown';
    result.missingDimensions = ['rate_card_reference_conflict'];
    return success(result);
  }

  try {
    const snapshot = await loadPricingCatalog(
      parsed.scope,
      String(event.provider ?? ''),
      parsed.selection.product,
      parsed.selection.requestedCurrency,
      effectiveAt,
      ports,
    );
    const cards = activeVersions(snapshot.rateCards, effectiveMicros).filter(stored => {
      const card = stored.value;
      return card.provider === event.provider && card.product === parsed.selection.product
        && matchesModel(card, event.model) && dimensionMatches(card, parsed)
        && (!pinnedRateCard || sameReference(pinnedRateCard, stored.reference));
    });
    if (cards.length !== 1) {
      const result = resultBase(parsed, estimatedAt, effectiveAt);
      result.status = 'pricing_unknown';
      result.missingDimensions = [cards.length === 0 ? 'eligible_rate_card_unavailable' : 'ambiguous_rate_card_selection'];
      return success(result);
    }
    const selectedCard = cards[0]!;
    const card = selectedCard.value;
    const rules = activeVersions(snapshot.rules, effectiveMicros).filter(stored => sameReference(cardRuleRef(card), stored.reference));
    if (rules.length !== 1) {
      const result = resultBase(parsed, estimatedAt, effectiveAt);
      result.status = 'pricing_unknown';
      result.rateCardRef = selectedCard.reference;
      result.missingDimensions = ['eligible_pricing_rule_unavailable'];
      return success(result);
    }
    const selectedRule = rules[0]!;
    const rule = selectedRule.value;
    if (rule.provider !== card.provider || rule.product !== card.product || rule.usageSource !== event.source) {
      const result = resultBase(parsed, estimatedAt, effectiveAt);
      result.status = 'pricing_unknown';
      result.rateCardRef = selectedCard.reference;
      result.pricingRuleRef = selectedRule.reference;
      result.missingDimensions = ['provider_product_or_usage_source_mismatch'];
      return success(result);
    }

    const missing: string[] = [];
    const priced = usageCalculation(parsed, event, card, rule, missing);
    const result = resultBase(parsed, estimatedAt, effectiveAt);
    result.rateCardRef = selectedCard.reference;
    result.pricingRuleRef = selectedRule.reference;
    result.currency = card.currency;
    result.calculation = priced.lines;
    result.knownSubtotal = priced.lines.length === 0 ? null : roundedDecimal(priced.exactTotal);
    result.knownSubtotalExact = priced.lines.length === 0 ? null : ratioJson(priced.exactTotal);
    result.missingDimensions = uniqueSorted(missing);
    result.assumptions.push(
      'Rate-card and pricing-rule versions are append-only and pinned by content hash.',
      rule.usageSemantics,
      'Nested input subsets are charged only after subtracting the explicitly declared disjoint subsets from their parent total; included subsets are not charged a second time.',
      'No quantity, unsupported category, or missing rate is interpreted as zero.',
    );

    let stale = staleFor(effectiveMicros, card.retrievedAt, card.freshnessMaxAgeSeconds)
      || staleFor(effectiveMicros, rule.retrievedAt, rule.freshnessMaxAgeSeconds);
    if (parsed.selection.requestedCurrency !== card.currency) {
      const fxCandidates = activeVersions(snapshot.fxRates, effectiveMicros).filter(stored => {
        const fx = stored.value;
        return fx.sourceCurrency === card.currency && fx.targetCurrency === parsed.selection.requestedCurrency
          && (!parsed.selection.fxRateRef || sameReference(parsed.selection.fxRateRef, stored.reference));
      });
      if (fxCandidates.length !== 1) {
        result.missingDimensions = uniqueSorted([...result.missingDimensions, 'fx_rate_unavailable_or_ambiguous:' + card.currency + '/' + parsed.selection.requestedCurrency]);
        result.assumptions.push('The known subtotal remains in the rate card original currency; no implicit currency conversion was applied.');
      } else {
        const selectedFx = fxCandidates[0]!;
        const fx = selectedFx.value;
        result.fxRateRef = selectedFx.reference;
        result.fxTargetCurrency = fx.targetCurrency;
        if (result.knownSubtotal !== null) {
          const converted = multiply(priced.exactTotal, parseNonNegativeDecimal(fx.rate));
          result.fxConvertedSubtotal = roundedDecimal(converted);
          result.fxConvertedSubtotalExact = ratioJson(converted);
        }
        stale = stale || staleFor(effectiveMicros, fx.retrievedAt, fx.freshnessMaxAgeSeconds);
        result.assumptions.push('FX uses the separately versioned, content-addressed source rate and effective interval.');
      }
    } else if (parsed.selection.fxRateRef !== null) {
      result.missingDimensions = uniqueSorted([...result.missingDimensions, 'unused_fx_rate_reference']);
    }

    if (stale) {
      result.status = 'stale';
      result.missingDimensions = uniqueSorted([...result.missingDimensions, 'stale_rate_or_rule_source']);
    } else if (result.missingDimensions.length > 0) {
      result.status = result.knownSubtotal === null ? 'unknown' : 'partial';
    } else {
      result.status = result.knownSubtotal === null ? 'unknown' : 'complete';
    }
    if (result.status === 'complete' && result.knownSubtotal === null) {
      result.status = 'unknown';
      result.missingDimensions = ['no_priceable_usage_dimensions'];
    }
    if (!Value.Check(EstimateResultSchema, result)) {
      return failure(safeError('SOURCE_UNAVAILABLE', parsed.requestId, 'Pricing produced a result that did not match its published response schema.'));
    }
    return success(result);
  } catch {
    return failure(safeError('SOURCE_UNAVAILABLE', parsed.requestId, 'The immutable pricing catalog is temporarily unavailable.', true));
  }
}
