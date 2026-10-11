# Finance authorization and data handling

## Authority boundary

Every finance API call resolves its operation through `authorizeFinanceOperation`. The shared `FINANCE_OPERATION_POLICY` assigns one local permission, one data class, and allowed principal kinds to each current operation and reserved future operation. `RuntimePorts.financeAuthority.authorizeCurrent` must resolve the principal from the host's trusted issuer and recheck the principal's current tenant membership or service grant, revocation state, requested scope, exact operation, and exact permission on every invocation. The host must not infer finance permission from an application role, `TrustedContextPort`, request fields, approvals, or a broad read/write role.

The decision must repeat the requested operation, permission, full tenant/project/environment/billing-mode/actor scope, active principal kind and actor ID, a nonempty current membership or service-grant revision, a unique decision ID, and valid `verifiedAt`/`expiresAt` timestamps. The local boundary allows a decision verified within the last 60 seconds and a decision lifetime of at most five minutes. Expired, stale, mismatched, inactive, or wrong-kind decisions return a generic `FORBIDDEN_SCOPE`. Missing, throwing, null, or unusable authority returns `SOURCE_UNAVAILABLE`; an unavailable result never counts as a positive authorization.

The existing v2 `PricingActionAuthorityPort` remains as a compatibility bridge for already published pricing callers. Its action-specific scoped result goes through the same central gate and is queried again before estimate replay, catalog access, each contract-time/dimension/bound-evidence resolution, and snapshot persistence. Every compatibility decision must carry a fresh issue time (within 60 seconds) and remain unexpired; the existing port's longer expiry shape is preserved for wire/runtime compatibility. New host integrations should provide `FinanceAuthorizationPort`, which also bounds decision lifetime to five minutes and carries current membership/service-grant revisions. Neither interface in this package contains the upstream GT issuer adapter, accepted GT grant spellings, or the issuer-to-billing-mode mapping: those remain unresolved, so this package does not claim a live GT integration. The finance permission names below are package-local policy IDs and must be mapped only by a separately reviewed host adapter.

`TrustedContextPort` remains in legacy runtime shapes for source compatibility, but it grants no permission. A request's explicit `scope` is an authorization request, not proof of identity. Ledger SQL independently binds tenant, project, environment, and billing mode. Foreign scopes are denied before ledger connection or row lookup when the current authority does not grant that exact scope.

## Operation and data-class matrix

| Operation | Local permission | Allowed principal | Protected data or action |
| --- | --- | --- | --- |
| `metering.ingestUsage` | `usage.ingest` | service | Minimal usage source facts; handler is not implemented |
| `pricing.estimate`, `pricing.estimateV2` | `pricing.estimate` | user or service | Scoped estimate result and immutable estimate replay |
| `pricing.registerPricingRuleV2` | `pricing.rule.register` | user or service | Immutable pricing rule catalog write |
| `pricing.registerRateCardV2` | `pricing.rate-card.register` | user or service | Immutable rate card catalog write |
| `pricing.registerFxRateV2` | `pricing.fx-rate.register` | user or service | Immutable FX catalog write |
| `pricing.resolveEvidence` | `pricing.evidence.resolve` | user or service | Reserved for any future evidence resolver handler |
| `budgets.authorize` | `budget.reservation.authorize` | user or service | Reservation capacity decision; handler is unavailable |
| `budgets.markDispatched` | `budget.reservation.dispatch` | service | Dispatch lifecycle action; handler is unavailable |
| `budgets.settle` | `budget.reservation.settle` | user or service | Reservation settlement action; handler is unavailable |
| `budgets.release` | `budget.reservation.release` | user or service | Reservation release action; handler is unavailable |
| `budgets.changeBudget` | `budget.policy.change` | user or service | Budget policy change; handler is unavailable |
| `budgets.recordExpenseAdjustment` | `expense.adjust` | user or service | Finance adjustment posting; handler is unavailable |
| `ledger.ingestFinancial` | `ledger.financial.ingest` | service | Financial source facts; accounting handler is unavailable |
| `ledger.appendLedgerEvent` | `ledger.event.append` | service | Immutable scoped ledger append and minimal quarantine evidence |
| `ledger.rebuildLedgerProjection` | `ledger.projection.rebuild` | service | Scoped aggregate rows and immutable snapshot writes |
| `ledger.resolveQuarantine` | `ledger.quarantine.resolve` | user or service | Reserved for any future quarantine resolution handler |
| `ledger.readSnapshot` | `ledger.snapshot.read` | user or service | Reserved for any future direct snapshot read handler |
| `reporting.querySummary` | `finance.summary.read` | user or service | Safe scoped summary; query handler is unavailable |
| `reconciliation.startReconciliation` | `finance.reconciliation.start` | user or service | Reconciliation action; handler is unavailable |
| `reconciliation.getReconciliation` | `finance.reconciliation.read` | user or service | Reconciliation evidence; handler is unavailable |
| `integrations.exportSummary` | `finance.summary.export` | user or service | Sanitized financial export; delivery handler is unavailable |

Read and financial-action permissions are distinct. `finance.summary.read` does not grant export, pricing writes, ledger writes, budget changes, dispatch, or settlement. The service-only allowlist applies to usage ingestion, financial ingestion, ledger append, projection rebuild, and dispatch; a user principal cannot operate those service actions. Permissions for unreleased handlers are declared so the same gate is mandatory when those handlers are added; the declaration does not make those handlers available.

## Source facts, response fields, and retention

| Field group | Access rule | Current exposure |
| --- | --- | --- |
| Tenant, project, environment, billing mode, actor | Required to authorize every operation; host resolves the actor and exact scope | Included in the ledger projection's requested scope; never copied into the safe export projection |
| Exact money, usage quantities, completeness and lifecycle status | Available only after the permission for the corresponding estimate, ledger, summary, or budget operation | Estimates and ledger projections return operation-scoped values; unavailable budget/reporting leaves return no rows |
| Request/event/correlation/attempt IDs, customer/order/provider/workflow identifiers | Restricted operational facts; not broad read permissions | Not included in the safe export projection; do not include in authority errors or logs |
| Source URLs, evidence references, payloads, prompts, addresses, source blobs | Restricted evidence; resolve only through an authorized evidence port and retain only what the leaf needs | Pricing rejects credential-bearing URLs; ledger quarantine stores a payload hash rather than raw unsupported payload; safe exports omit evidence and source refs |
| Catalog versions, rate-card/rule/FX references | Protected immutable pricing data | Returned only through pricing estimate/catalog operations; not copied into the export allowlist |
| Budget limits, holds, settlement and dispatch proofs | Restricted budget state/action evidence | Each lifecycle action has a distinct permission; those domain handlers remain unavailable |

Public request schemas accept only documented fields. The ledger persists normalized financial events and source identity/content hashes needed to enforce idempotency, lineage, and immutable projection behavior. Unsupported ledger payloads are not stored: quarantine records retain the scoped identifiers, a safe reason/version, payload hash, and opaque diagnostic reference, never the raw payload. Ledger projection queries constrain all four financial scope dimensions and return amounts, quantities, completeness counts, and the requested scope. Ledger snapshots remain append-only.

Pricing catalogs are immutable and scope-bound. Catalog source URLs must use HTTPS and must not contain user information, query strings, or fragments, which prevents signed URL credentials from entering catalog rows. Estimate evidence ports receive the exact scope, actor, event/reference identifiers, effective instant, currency, and selected catalog references required for their decision. A reference hash alone is not evidence. The caller rechecks authorization before each evidence lookup and before persisting an estimate.

The safe summary export projection includes only period, environment, billing mode, currency, valuation basis, completeness, settlement, reconciliation, and reviewed metric name/status/exact amount/currency/scale. `MetricDefinition` has no reviewed display-name registry in the pinned proposal, so the current projection exports only the fixture-backed `expense` metric and drops other dynamic metric keys until that registry is approved. It excludes tenant/project, event, customer, order, correlation, evidence, and source-reference fields. The CSV serializer quotes all cells, escapes quotes, normalizes line endings, and prefixes formula-like values. A future adapter must consume this projection rather than serialize the raw `FinancialSummary` or wrapper.

Errors use the published bounded safe envelope and do not copy raw authority failures or request fields. Tests use private canary markers to check safe errors and exports. There is no application logging adapter in these leaves; a host adapter must log opaque decision/request references and safe status only, never the raw request, source evidence, credentials, or provider payload. The package does not configure a deployment database role, row-level-security policy, storage retention job, audit sink, or secret-redaction pipeline. Those are explicit deployment handoffs; injecting a host-managed pool does not prove database least-privilege configuration.

## Downstream handler obligations

Before adding or completing any current unavailable handler, call `authorizeFinanceOperation` before row lookup, retry/replay lookup, source/evidence resolution, export generation, or mutation. Recheck current membership/revocation for each separate read, retry, evidence lookup, and export delivery attempt. Bind every row predicate and mutation to tenant, project, environment, and billing mode. Use the least-privilege permission from the matrix, preserve opaque safe errors, and project only fields allowed for that handler's data class. Any new ledger quarantine or snapshot reader must use `ledger.resolveQuarantine` or `ledger.readSnapshot`; it must not reuse append/project service grants.

The local synthetic fixtures and tests exercise this policy only. They are not production identity, issuer, host authorization, or live provider evidence.
