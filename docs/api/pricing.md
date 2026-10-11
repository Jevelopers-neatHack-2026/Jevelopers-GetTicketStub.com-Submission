# Pricing API

The package keeps the original 1.0.0 pricing schemas and function names for existing source consumers. Their encodings are unchanged. The v1 estimate and catalog-write functions fail closed because v1 cannot carry a current operation-specific Finance grant. The implemented pricing API is explicitly versioned: use `estimateV2`, `registerPricingRuleV2`, `registerRateCardV2`, and `registerFxRateV2`, with the `*V2Schema` and `*V2` types from the package root or `@jevelopers/cost-intelligence/pricing` subpath.

## Host authority and scope

Every v2 read or write resolves trusted context and asks the host's `PricingActionAuthorityPort` for a current decision for that exact action. The decision must match the full tenant, project, environment, billing mode, and actor scope, identify the requested action, and be current at the host clock. Missing, denied, expired, mismatched, or unavailable authority fails before pricing opens a database connection. Pricing does not infer a grant from a role, an approval string, or client input.

The host also supplies an existing PostgreSQL-compatible pool and a clock; pricing opens no hidden pool and calls no provider. Contract-time selection requires an exact `ContractTimeAuthorityPort` result. Non-null context, service, reasoning, or tool dimensions require a supported `PricingUsageDimensionEvidence` reference and an injected resolver that binds the exact reference, scope, actor, usage-event ID, and all four values. A hash appearing in `UsageEvent.source_refs` alone is not proof of those values. Unknown or unverified dimensions return typed `unknown` and cannot choose a cheaper card.

These are host-injected boundaries for synthetic acceptance. The repository does not edit the pinned canonical contracts, mint their capabilities, or connect a real Finance issuer. Issuer integration and its accepted decision source remain pending.

## Immutable catalog and valuation history

V2 rules, rate cards, and FX rates are immutable scoped versions. Each exact version reference hashes the full stored payload, including selectors, nested usage semantics, dimensions, and rates. Revision identity is stable: rule revisions keep provider, product, and usage source; FX revisions keep their source/target currency pair; card revisions keep provider, product, model/aliases, tier selector, and currency. Writes serialize idempotency, identity, and selector checks. A successful retry key is durably bound to its payload and result in the same transaction.

A rate card pins one exact rule version. That rule remains available to the card after a later rule revision; the estimate checks the pinned version's effective interval instead of silently requiring the latest revision. Effective time selects economic validity. Catalog publication and evidence retrieval are separately filtered at `estimatedAt`, so a source retrieved after event time may support a first historical valuation when its effective interval covers the event. An eligible valuation is stored append-only by scope, actor, and usage-event ID. Later catalog changes do not reprice its replay; a previously unknown event without a usable card/rule reference can be valued after a source becomes available.

Migration `0005_pricing_valuation_history` adds append-only operation-idempotency bindings and estimate snapshots. The financial ledger remains unchanged by pricing; estimates do not post expenses or erase provider-attempt history.

## Exact arithmetic and uncertainty

Rules map canonical usage-unit names to price categories and state whether a missing unit is required, not applicable, or unknown. A charged parent total cannot also be charged on top of separately priced included subsets. Charged siblings require an explicit pairwise-disjoint partition, matching units and relations, and quantities that do not exceed the parent. A missing `not_applicable` child contributes no subset quantity, so the parent residual remains priced. A card may omit a supported category rate; evaluation then returns a partial known subtotal and names the missing rate category. Output totals already containing reasoning tokens are priced once. Missing, malformed, unsupported, or ambiguous quantities and rates are never treated as zero.

The result preserves exact reduced rational values for the known subtotal and each line. Display decimals are rounded once at the result boundary to 18 fractional places using half-even. `complete`, `partial`, `unknown`, `stale`, and `pricing_unknown` remain distinct. A known subtotal stays nullable and in the card's original currency; an FX result retains both original and converted exact amounts.

V2 can produce a bounded conservative amount only when a source-backed partition rule and host-verified bound evidence match the selected rule, rate card, effective instant, and currency. For `maximum_marginal_rate`, it applies the greatest eligible per-unit rate only to the unallocated parent quantity and adds that to the known priced lines. The amount remains separate from the known subtotal. Its display value is rounded upward at the 18-decimal serialization boundary, so rounding cannot understate the exact upper bound; the exact rational is retained. It is null for unbounded or unsupported usage, stale evidence, unverified/mismatched bound evidence, invalid partitions, or a requested currency that lacks an unambiguous supported conversion. A bound is not a confirmed expense, Finance grant, purchase authorization, or dispatch authority.

## Synthetic fixtures and source boundary

`fixtures/pricing/ci03-synthetic-acceptance.json` uses invented deterministic rates and FX, makes zero provider calls, and does not contain current provider prices. It includes the independent review regression vector (USD 0.00292 complete, USD 0.0029 partial when the cached rate is absent, and USD 0.0031 when cached input is explicitly not applicable), plus a USD 0.0022 known subtotal with a USD 0.0031 conservative bound and tests for unverified evidence, stale sources, unbounded dimensions, FX uncertainty, and an evidenced zero bound. The bounded result is a calculation fixture, not authorization.

The dated official-source summaries and response hashes are recorded in [pricing-source-evidence-2026-10-11.md](./pricing-source-evidence-2026-10-11.md). The source pages inform usage semantics only; no current numeric provider tariff is copied into the fixtures.
