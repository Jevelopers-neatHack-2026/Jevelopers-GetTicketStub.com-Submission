# Pricing API

The pricing package is available from the package root and the @jevelopers/cost-intelligence/pricing subpath. It exposes registerPricingRule, registerRateCard, registerFxRate, estimate, their TypeBox request/result schemas, combined usage validation, and PricingRuntimePorts.

A host supplies an existing PostgreSQL-compatible pool, the approved trusted-scope resolver, a clock, and (for contract-time selection) a contract-time authority. Pricing opens no hidden connections and calls no provider. Every write and estimate validates the request, validates the nested shared UsageEvent, and authorizes the exact tenant, project, environment, billing mode, and actor before database access. A real estimate requires PricingRuntimePorts with the database adapter; the generic RuntimePorts overload stays compatible with the existing worker composition and returns retryable source-unavailable when that adapter is absent.

## Immutable catalog versions

Rules, rate cards, and FX rates are scoped to a financial scope and stored as append-only versions. Each row retains the immutable version payload, content hash, revision, effective interval, retrieval time, catalog publication time, actor, provenance, source URL/hash, and approval reference. Update, delete, and truncate are rejected by database triggers. Revision IDs are sequential within one stable identity; reusing a revision with changed content is an error.

A rate card names one exact rule reference. Its selector includes provider, product, canonical model/SKU, explicit aliases, currency, context tier, service tier, reasoning mode, tool class, and unit rates. The selection dimensions are required values; null means explicitly not applicable. Non-null dimensions must point to a content-addressed source reference on the usage event. Model aliases and tiers never fall through to a default.

A new card revision supersedes the preceding open interval for the same stable identity at its own effective start. Separate card identities may not overlap on the same model/alias and tier selector. Registration serializes competing writes and rejects overlaps. The estimator also rejects ambiguous catalog matches.

Catalog publication time and source retrieval time must both be at or before the selected event or contract instant. The estimator filters on those evidence times before deriving revision intervals. A rate card inserted later cannot reprice an earlier event, even if its effective start is backdated. Corrections and revaluation remain append-only ledger adjustments.

## Selection, usage, and uncertainty

event_time requires selection.effectiveAt to equal the canonical UsageEvent.occurred_at. contract_time requires a ContractTimeEvidence reference resolved by the host authority; an absent or mismatched authority result returns typed unknown. A caller cannot choose a different historical time by supplying a cheaper tariff reference. A supplied rate-card reference is only a pin: it must equal the unique eligible result.

Each immutable rule maps canonical usage-unit names to supported pricing categories and records inclusion semantics. It declares whether absent units are required, explicitly not applicable, or unknown. Input parents can be priced as a residual after subtracting the rule's separately priced included subsets. Subsets must use matching units and relations, and their total cannot exceed the parent. Included reasoning units are not charged a second time when output total already contains them. Unsupported tool/service dimensions, missing usage, invalid partitions, and missing rates remain in missingDimensions; they never become zero.

The result status is complete, partial, unknown, stale, or pricing_unknown. knownSubtotal is nullable and remains in the original rate-card currency. knownSubtotalExact and each calculation line retain reduced integer numerator/denominator values. Decimal display fields are rounded once at the response boundary to 18 fractional digits using half-even. The exact rational is preserved when that final decimal representation cannot express every fractional place.

An FX conversion is applied only when an immutable, effective, non-stale FX version is selected. The result keeps the original currency and subtotal alongside the conversion reference, target currency, exact conversion ratio, and rounded converted subtotal. Without a unique FX version, the result remains partial in the original currency. No currency is inferred or implicitly converted.

The bounded conservative authorization amount is null unless a defensible upper bound is supplied by a future reviewed rule; this implementation does not invent one. An estimate is not a posted expense or purchase authorization. Provider-confirmed usage is not re-estimated; use its existing immutable ledger posting.

## Fixture and source boundaries

fixtures/pricing/ci03-synthetic-acceptance.json uses invented, deterministic rates and an invented USD-to-EUR conversion. It is labeled synthetic_fixture, makes zero provider calls, and does not contain current provider prices. The dated source evidence and content hashes are summarized in [pricing-source-evidence-2026-10-11.md](./pricing-source-evidence-2026-10-11.md). The pinned shared-contract proposal and actual issuer/contract authority handoff remain external integration work.
