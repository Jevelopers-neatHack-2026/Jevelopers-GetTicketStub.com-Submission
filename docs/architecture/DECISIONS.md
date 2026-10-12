# Foundation decisions and unresolved handoffs

These decisions describe implemented local boundaries, deferred operations, and external handoffs. Source and local test coverage do not mean that a criterion has been accepted.

## Typed boundary policy

- **API schema:** finance-owned requests use exact `1.0.0`, reject unknown fields and enums, and return bounded safe errors with opaque diagnostic references.
- **Economics:** decimal strings support up to 18 fractional digits. `billingMode` means economic execution (`live`, `sandbox`, `simulated`); funding state is modeled separately.
- **Unknown usage:** unknown completeness uses explicit `null` measurements and missing-field evidence. Unknown is not numeric zero.
- **Authorization:** partial grants require explicit caller consent and a caller replan before dispatch. Uncertain outcomes retain the hold until fenced non-dispatch proof or final usage evidence resolves it.
- **Budget limit changes:** reject decreases below effective consumed spend plus active unconsumed commitments and preserve the previous effective limit on denial. Mark the near-limit condition at 80% committed.
- **Corrections:** expense adjustments link to the original posting and a content-hashed source; existing postings are not overwritten.
- **Reproducible queries:** a finance-owned snapshot wrapper records filters, timezone, as-of time, snapshot identity, query and summary hashes, and per-source watermarks. The shared proposal summary remains unchanged.

## External contract handoff

The pinned shared-contract package is a proposal test dependency, not an accepted release. Its FC-001 through FC-004 blockers and pending finance acknowledgement are recorded in [`contracts.lock.json`](../../contracts.lock.json) and [compatibility notes](../api/compatibility.md). Finance wrappers are local, versioned API proposals and must be reviewed with the producer and consuming applications before adoption.

The reporting reader, scoped query filters, immutable snapshot writer and prepared-export pipeline are implemented locally. Repository, workstream, provider, model, workflow, job, feature, and permitted order/customer dimensions are returned only where the source provides them; missing attribution stays unknown. The shared #2 capability contract, consumer handoff, accepted metric registry and production issuer mapping remain pending. See [reporting](../api/reporting.md) and [prepared exports](../api/prepared-exports.md).

## Delivery gates

Pricing v2, usage intake, PostgreSQL ledger append/projection, CI05A budget authority, scoped reporting snapshots and prepared-export functions have local source/tests (see the [API map](../api/INDEX.md)). Legacy pricing 1.0.0 estimate, ledger financial ingest, settlement/release, expense adjustment and reconciliation remain typed unavailable. Nested budget scopes are deferred as P1 issue #17 outside the default v1 gate by issue #18. Integration and release runners currently fail closed because the required adapters and reconciliation leaf test files are absent. No local result closes a financial acceptance criterion.
