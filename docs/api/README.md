# Financial API guide

The private `@jevelopers/cost-intelligence` package exposes typed schemas and ESM functions for metering, pricing, budgets, the financial ledger, accounting, evidence, reporting, reconciliation and export. These are in-process APIs with explicit host ports. The [root README](../../README.md) provides setup and repository navigation; this guide distinguishes executable boundaries from retained unavailable facades.

## Implemented and unavailable operations

| API | Current behavior | Reference |
| --- | --- | --- |
| Pricing v2 registration and `estimateV2` | Immutable catalog writes and exact non-posting estimates with configured authority/database ports | [Pricing](pricing.md) |
| `appendLedgerEvent`, `rebuildLedgerProjection` | PostgreSQL append-only events and deterministic as-of projections | [Ledger](ledger.md) |
| Accounting projection | Separate exact commerce, expense, simulation and cash metrics; policy acceptance is distinct from local implementation | [Accounting](accounting.md) |
| `ingestUsage`, `replayUsageOutbox` | Durable scoped observation intake, attempt correlation and bounded posting recovery | [Usage intake](usage-intake.md) |
| `authorize`, `markDispatched`, `changeBudget`, lookup/revalidation and partial acknowledgement | Operational when the host supplies current reservation authority and source-evidence ports | [Budget authority](budget-authority.md) |
| `querySummary`, `querySummaryV2` | Authorized PostgreSQL reporting snapshots; legacy 1.0.0 only where representable, Finance-owned 2.0.0 for richer projection data | [Reporting](reporting.md) |
| `exportSummary`, `exportSummaryV2`, `getPreparedExportArtifacts` | Prepare immutable JSON/CSV from a verified stored snapshot, with current disclosure authorization | [Prepared exports](prepared-exports.md) |
| Retained pricing 1.0.0 `estimate` | Typed unavailable: `PRICING_UNKNOWN` | [Compatibility](compatibility.md) |
| Public `settle`, `release` | Typed unavailable: `BUDGET_UNAVAILABLE`; CI-05B integration remains pending | [Budget authority](budget-authority.md) |
| `recordExpenseAdjustment`, `ingestFinancial` | Typed unavailable: `SOURCE_UNAVAILABLE` | [Ledger](ledger.md) |
| `startReconciliation`, `getReconciliation` | Typed unavailable: `RECONCILIATION_PENDING` | [Reconciliation entry point](../../src/reconciliation/index.ts) |

Unavailable facades still validate requests and current scope/permission, so invalid or unauthorized calls may return those errors first. Implemented APIs also reject missing or stale host dependencies. Pricing estimates do not authorize budget capacity or post charges; reporting and export do not settle reservations or import files into CFO.ai.

## Version and error behavior

Finance-owned requests use exact schema versions. Pricing retains its original `1.0.0` encoding and exposes its implementation as `2.0.0` under explicit v2 function, schema and type names. Reporting retains representable `1.0.0` results and adds Finance-owned `2.0.0` queries/pages; prepared exports have corresponding explicit v2 artifacts and reporting wrappers. Other retained APIs use their declared `1.0.0` schemas. Unknown versions return `UNSUPPORTED_VERSION`; unknown properties and enum values are rejected. The shared proposal's `exact_semver` policy is also strict: an optional-field addition requires a new exact schema version with old-version encoding and fixtures retained. See [compatibility](compatibility.md) and each API's fixtures for its bounded migration coverage.

Errors use a bounded safe message and a newly generated opaque `diagnostic_ref`. Caller request IDs are not copied into diagnostic references. Codes are `VALIDATION_ERROR`, `UNSUPPORTED_VERSION`, `FORBIDDEN_SCOPE`, `IDEMPOTENCY_CONFLICT`, `PRICING_UNKNOWN`, `BUDGET_EXCEEDED`, `BUDGET_UNAVAILABLE`, `RECONCILIATION_PENDING`, and `SOURCE_UNAVAILABLE`. A retryable error does not authorize spending or dispatch; a caller must obtain a new explicit authorization decision.

Money and quantities are decimal strings. Finance-owned amount schemas permit up to 18 fractional digits and never use binary floating point. Economic `billingMode` values map to shared snake-case `billing_mode` values `live`, `sandbox`, and `simulated`; funding mechanisms such as subscription, included allowance, and credits are not billing modes. `environment` maps to the shared `environment` field and is restricted to `development`, `test`, or `production`.

Finance API request/response objects use camel case. Nested shared contracts retain their generated canonical snake-case field names and are validated using the exact installed proposal package. These wrappers are versioned finance API proposals; their existence does not resolve producer/consumer ownership or make the shared draft canonical.

## Scope and boundary coverage

`TrustedScope` binds tenant, project, environment, billing mode, and actor. The current query boundary limits environment and billing-mode filters to the exact scope authorized for the operation; callers cannot widen scope by adding filter values. `TrustedContextPort` supplies no permission by itself.

The usage observation wrapper contains the shared `UsageEvent` plus evidence mode, verification status, and source provenance. The generated event preserves logical-operation, transport-attempt, provider request/attempt, billable-attempt, and source-observation identities. Unknown completeness stays explicit, with `usage_units: null`; it is never converted to zero. An unknown financial-event valuation likewise requires `amount: null`; estimated or provider-confirmed valuation requires an exact decimal amount.

Budget wrappers express authorized, denied, partial and unavailable outcomes, held and available amounts, estimate completeness/subtotal, conservative authorization caps, rate/policy references, attempt bindings and explicit partial-consent/replan requirements. Operational admission and dispatch require independent current source/target authority; the [Finance authority mapping](budget-authority.md) describes those ports and their limits. The policy rejects a limit reduction below effective consumed spend plus active unconsumed commitments and emits the near-limit alert at 80% committed. Declared settlement, release and expense-adjustment schemas remain interface proposals while their public execution facades are unavailable; low-level lifecycle helpers do not establish accepted finality or reconciliation.

The financial ledger API is documented in [ledger.md](./ledger.md). It persists immutable versioned events, binds operational identities independently, records corrections and reversals by reference, and rebuilds deterministic as-of projections with exact decimal arithmetic. Reservation authorization remains a non-financial memo; linked cumulative consumption contributes its full effective amount, including an observed overrun.

The shared operation matrix, least-privilege rules, safe field projection and current host integration gaps are documented in [security.md](security.md). Real issuer and mounted-host acceptance remain pending; current operation decisions and evidence resolvers are host-injected ports exercised with synthetic fixtures. The [manual CFO.ai handoff](cfo-ai-handoff.md) describes the input mapping and evidence boundary; an export file is not an external import receipt.

## Summary and export identity

The pinned shared `FinancialSummary` has no query-level as-of, watermark, timezone, or stable snapshot identity. The finance-owned `FinancialSummaryPage` wrapper adds:

- `snapshotId`, query hash, and the effective `asOf` instant;
- timezone and echoed query filters;
- a watermark identity and per-source revision, observed-through time, content hash, and completeness;
- summary content hash and the nested canonical `FinancialSummary`;
- a continuation cursor bound to the snapshot.

The implemented reporting reader supports scoped filters and breakdowns only where the current ledger supplies the dimensions. Missing attribution remains explicit; workstream/customer attribution and product dimensions are not invented. The Finance-owned 2.0.0 wrapper provides richer currency projections, detail identities and pagination while retaining unchanged nested shared summaries where representable. Export composition reads the verified stored first page and preserves the same financial snapshot. See [reporting](reporting.md#request-and-response) and [prepared exports](prepared-exports.md#concrete-host-composition) for exact query, pagination, artifact and disclosure contracts. No CFO.ai connector is included.

## Schema artifacts and proposal pin

Run `npm run build` from the repository root to generate the local TypeBox schemas under their exact versions and record SHA-256 digests in [schema-index.json](schema-index.json). The [schema tree](../../schemas/cost-intelligence/) retains `1.0.0` artifacts alongside versioned pricing, reporting and integration additions. The build records shared-contract adoption state from [contracts.lock.json](../../contracts.lock.json). Schemas whose JSON artifact contains an unconstrained nested canonical value are marked `partial_wrapper_requires_combined_validation` in both the schema (`x-schema-completeness`) and catalog. Consumers must use the named, exported combined validator from the corresponding ESM subpath; it validates the wrapper and the exact pinned shared-contract schema together. The paired validator names are recorded in `x-combined-validator` and `combined_validator`. This applies to usage observations, pricing estimates, reservation requests and commands, reservation snapshots, summary pages and export requests. The finance package does not copy or redefine the producer's canonical nested schemas.

The checked-in archive under `vendor/` is exactly pinned by SHA-256 and installed as a real package dependency. Tests verify the installed version, archive digest, selected schema/fixture digests, Git blob IDs, and producer fixtures. The pin remains proposal-only with unresolved finance findings:

- FC-001: final observed budget overrun cannot be represented without rejection or rewriting the hold;
- FC-002: environment and billing mode are not bound across independent context, commands, and results;
- FC-003: settlement/grant results are not bound to commands and cumulative/partial semantics remain unresolved;
- FC-004: `held_for_reconciliation` is rejected in the uncertain state it is meant to express.

Finance-owned wrappers preserve the needed boundary information while those producer fixes and consumer acknowledgements remain pending. They are not alternate canonical shared schemas.

## Development and acceptance

Use the [root quickstart](../../README.md#quickstart), current [package scripts](../../package.json) and [suite policy](../../scripts/suite-policy.mjs) for build and test commands. Database checks use disposable PostgreSQL; synthetic fixtures do not establish a deployed issuer, authentic provider billing or accepted canonical adoption. The [Financial Intelligence release gate](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/5) and the [integration-evals acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) remain separate from local API implementation.
