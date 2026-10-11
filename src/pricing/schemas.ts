import { Type, type Static } from '@sinclair/typebox';
import {
  CurrencySchema,
  DecimalAmountSchema,
  NonNegativeDecimalAmountSchema,
  TrustedScopeSchema,
} from '../shared/contracts.js';

export const VersionedReferenceSchema = Type.Object({
  contract: Type.String({ minLength: 1, maxLength: 128 }),
  schema_version: Type.Literal('2.0.0'),
  id: Type.String({ minLength: 1, maxLength: 128 }),
  revision: Type.Integer({ minimum: 1 }),
  content_hash: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
}, { additionalProperties: false });
export type VersionedReference = Static<typeof VersionedReferenceSchema>;

/** References to pinned external contracts remain at their accepted 1.0.0 shape. */
export const SourceReferenceSchema = Type.Object({
  contract: Type.String({ minLength: 1, maxLength: 128 }),
  schema_version: Type.Literal('1.0.0'),
  id: Type.String({ minLength: 1, maxLength: 128 }),
  revision: Type.Integer({ minimum: 1 }),
  content_hash: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
}, { additionalProperties: false });
export type SourceReference = Static<typeof SourceReferenceSchema>;

export const PricingPartitionGroupSchema = Type.Object({
  parent: Type.String({ minLength: 1, maxLength: 128 }),
  separatelyPricedMembers: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1, maxItems: 100 }),
  semantics: Type.Literal('pairwise_disjoint_included_subsets'),
  conservativeBound: Type.Union([
    Type.Object({
      policy: Type.Literal('maximum_marginal_rate'),
      evidenceRef: SourceReferenceSchema,
    }, { additionalProperties: false }),
    Type.Null(),
  ]),
}, { additionalProperties: false });
export type PricingPartitionGroup = Static<typeof PricingPartitionGroupSchema>;

const UtcTime = Type.String({ format: 'date-time', pattern: 'Z$' });
const NullableDimension = Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]);
const Relation = Type.Union([
  Type.Literal('standalone'),
  Type.Literal('included_subset'),
  Type.Literal('unknown_relation'),
]);

export const RateCardSchema = Type.Object({
  schemaVersion: Type.Literal('2.0.0'),
  id: Type.String({ minLength: 1, maxLength: 128 }),
  revision: Type.Integer({ minimum: 1 }),
  provider: Type.String({ minLength: 1, maxLength: 128 }),
  product: Type.String({ minLength: 1, maxLength: 128 }),
  modelOrSku: Type.String({ minLength: 1, maxLength: 128 }),
  aliases: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 100 }),
  contextTier: NullableDimension,
  serviceTier: NullableDimension,
  reasoningMode: NullableDimension,
  toolClass: NullableDimension,
  currency: CurrencySchema,
  pricingRuleRef: VersionedReferenceSchema,
  unitRates: Type.Array(Type.Object({
    category: Type.String({ minLength: 1, maxLength: 128 }),
    unit: Type.String({ minLength: 1, maxLength: 128 }),
    basisQuantity: NonNegativeDecimalAmountSchema,
    rate: NonNegativeDecimalAmountSchema,
    relation: Relation,
    includedIn: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
  effectiveFrom: UtcTime,
  effectiveTo: Type.Union([UtcTime, Type.Null()]),
  retrievedAt: UtcTime,
  freshnessMaxAgeSeconds: Type.Integer({ minimum: 0, maximum: 315360000 }),
  sourceUrl: Type.String({ format: 'uri', maxLength: 2048 }),
  sourceContentHash: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  approvalRef: SourceReferenceSchema,
  provenance: Type.Union([
    Type.Literal('synthetic_fixture'),
    Type.Literal('documented_tariff'),
    Type.Literal('owner_approved'),
  ]),
}, { additionalProperties: false });
export type RateCard = Static<typeof RateCardSchema>;

export const PricingRuleSchema = Type.Object({
  schemaVersion: Type.Literal('2.0.0'),
  id: Type.String({ minLength: 1, maxLength: 128 }),
  revision: Type.Integer({ minimum: 1 }),
  provider: Type.String({ minLength: 1, maxLength: 128 }),
  product: Type.String({ minLength: 1, maxLength: 128 }),
  usageSource: Type.Union([
    Type.Literal('provider_response'),
    Type.Literal('provider_usage_api'),
    Type.Literal('trace'),
    Type.Literal('billing_export'),
    Type.Literal('other'),
  ]),
  usageSemantics: Type.String({ minLength: 1, maxLength: 3000 }),
  partitionGroups: Type.Array(PricingPartitionGroupSchema, { maxItems: 100 }),
  usageUnits: Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 128 }),
    category: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    unit: Type.String({ minLength: 1, maxLength: 128 }),
    relation: Relation,
    includedIn: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    treatment: Type.Union([
      Type.Literal('charge_total'),
      Type.Literal('charge_residual'),
      Type.Literal('charge_subset'),
      Type.Literal('included'),
      Type.Literal('unsupported'),
    ]),
    missingPolicy: Type.Union([
      Type.Literal('required'),
      Type.Literal('not_applicable'),
      Type.Literal('unknown'),
    ]),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
  effectiveFrom: UtcTime,
  effectiveTo: Type.Union([UtcTime, Type.Null()]),
  retrievedAt: UtcTime,
  freshnessMaxAgeSeconds: Type.Integer({ minimum: 0, maximum: 315360000 }),
  sourceUrl: Type.String({ format: 'uri', maxLength: 2048 }),
  sourceContentHash: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  approvalRef: SourceReferenceSchema,
  provenance: Type.Union([
    Type.Literal('synthetic_fixture'),
    Type.Literal('documented_tariff'),
    Type.Literal('owner_approved'),
  ]),
}, { additionalProperties: false });
export type PricingRule = Static<typeof PricingRuleSchema>;

export const FxRateSchema = Type.Object({
  schemaVersion: Type.Literal('2.0.0'),
  id: Type.String({ minLength: 1, maxLength: 128 }),
  revision: Type.Integer({ minimum: 1 }),
  sourceCurrency: CurrencySchema,
  targetCurrency: CurrencySchema,
  rate: NonNegativeDecimalAmountSchema,
  effectiveFrom: UtcTime,
  effectiveTo: Type.Union([UtcTime, Type.Null()]),
  retrievedAt: UtcTime,
  freshnessMaxAgeSeconds: Type.Integer({ minimum: 0, maximum: 315360000 }),
  sourceUrl: Type.String({ format: 'uri', maxLength: 2048 }),
  sourceContentHash: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  approvalRef: SourceReferenceSchema,
  provenance: Type.Union([
    Type.Literal('synthetic_fixture'),
    Type.Literal('documented_tariff'),
    Type.Literal('owner_approved'),
  ]),
}, { additionalProperties: false });
export type FxRate = Static<typeof FxRateSchema>;

const RegistrationRequest = {
  schemaVersion: Type.Literal('2.0.0'),
  requestId: Type.String({ minLength: 1, maxLength: 128 }),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
  scope: TrustedScopeSchema,
};
export const RegisterPricingRuleRequestSchema = Type.Object({
  ...RegistrationRequest,
  rule: PricingRuleSchema,
}, { additionalProperties: false });
export type RegisterPricingRuleRequest = Static<typeof RegisterPricingRuleRequestSchema>;

export const RegisterRateCardRequestSchema = Type.Object({
  ...RegistrationRequest,
  rateCard: RateCardSchema,
}, { additionalProperties: false });
export type RegisterRateCardRequest = Static<typeof RegisterRateCardRequestSchema>;

export const RegisterFxRateRequestSchema = Type.Object({
  ...RegistrationRequest,
  fxRate: FxRateSchema,
}, { additionalProperties: false });
export type RegisterFxRateRequest = Static<typeof RegisterFxRateRequestSchema>;

export const CatalogWriteReceiptSchema = Type.Object({
  schemaVersion: Type.Literal('2.0.0'),
  requestId: Type.String({ minLength: 1 }),
  status: Type.Union([Type.Literal('accepted'), Type.Literal('duplicate')]),
  reference: VersionedReferenceSchema,
  durableCommit: Type.Boolean(),
}, { additionalProperties: false });
export type CatalogWriteReceipt = Static<typeof CatalogWriteReceiptSchema>;

export const EstimateRequestSchema = Type.Object({
  schemaVersion: Type.Literal('2.0.0'),
  requestId: Type.String({ minLength: 1, maxLength: 128 }),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
  scope: TrustedScopeSchema,
  usageEvent: Type.Unknown(),
  selection: Type.Object({
    policy: Type.Union([Type.Literal('event_time'), Type.Literal('contract_time')]),
    effectiveAt: UtcTime,
    product: Type.String({ minLength: 1, maxLength: 128 }),
    requestedCurrency: CurrencySchema,
    rateCardRef: Type.Union([VersionedReferenceSchema, Type.Null()]),
    fxRateRef: Type.Union([VersionedReferenceSchema, Type.Null()]),
    contractTimeEvidenceRef: Type.Union([SourceReferenceSchema, Type.Null()]),
    contextTier: NullableDimension,
    serviceTier: NullableDimension,
    reasoningMode: NullableDimension,
    toolClass: NullableDimension,
    dimensionsEvidenceRef: Type.Union([SourceReferenceSchema, Type.Null()]),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type EstimateRequest = Omit<Static<typeof EstimateRequestSchema>, 'usageEvent'> & {
  readonly usageEvent: import('../shared/canonical.js').SharedUsageEvent;
};

export const EstimateStatusSchema = Type.Union([
  Type.Literal('complete'),
  Type.Literal('partial'),
  Type.Literal('unknown'),
  Type.Literal('stale'),
  Type.Literal('pricing_unknown'),
]);
export const ExactRatioSchema = Type.Object({
  numerator: Type.String({ pattern: '^-?(?:0|[1-9][0-9]*)$', maxLength: 8192 }),
  denominator: Type.String({ pattern: '^[1-9][0-9]*$', maxLength: 8192 }),
}, { additionalProperties: false });

export const EstimateResultSchema = Type.Object({
  schemaVersion: Type.Literal('2.0.0'),
  requestId: Type.String({ minLength: 1 }),
  estimatedAt: UtcTime,
  status: EstimateStatusSchema,
  selectionPolicy: Type.Union([Type.Literal('event_time'), Type.Literal('contract_time')]),
  effectiveAt: UtcTime,
  knownSubtotal: Type.Union([DecimalAmountSchema, Type.Null()]),
  knownSubtotalExact: Type.Union([ExactRatioSchema, Type.Null()]),
  currency: Type.Union([CurrencySchema, Type.Null()]),
  rateCardRef: Type.Union([VersionedReferenceSchema, Type.Null()]),
  pricingRuleRef: Type.Union([VersionedReferenceSchema, Type.Null()]),
  fxRateRef: Type.Union([VersionedReferenceSchema, Type.Null()]),
  fxConvertedSubtotal: Type.Union([DecimalAmountSchema, Type.Null()]),
  fxConvertedSubtotalExact: Type.Union([ExactRatioSchema, Type.Null()]),
  fxTargetCurrency: Type.Union([CurrencySchema, Type.Null()]),
  missingDimensions: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 100 }),
  assumptions: Type.Array(Type.String({ minLength: 1, maxLength: 3000 }), { maxItems: 100 }),
  boundedConservativeAuthorizationAmount: Type.Union([DecimalAmountSchema, Type.Null()]),
  boundedConservativeAuthorizationAmountExact: Type.Union([ExactRatioSchema, Type.Null()]),
  calculation: Type.Array(Type.Object({
    usageUnit: Type.String({ minLength: 1, maxLength: 128 }),
    category: Type.String({ minLength: 1, maxLength: 128 }),
    quantity: NonNegativeDecimalAmountSchema,
    unit: Type.String({ minLength: 1, maxLength: 128 }),
    basisQuantity: NonNegativeDecimalAmountSchema,
    rate: NonNegativeDecimalAmountSchema,
    exactAmount: ExactRatioSchema,
    extendedAmount: DecimalAmountSchema,
    relation: Relation,
  }, { additionalProperties: false }), { maxItems: 100 }),
}, { additionalProperties: false });
export type EstimateResult = Static<typeof EstimateResultSchema>;
