# `cost-intelligence`

**Repository status:** Proposed addition; creation is not claimed.  
**Proposed owner:** Finance and reliability.  
**Delivery state:** Planning only; all checks pending.

## Responsibility

Own the authoritative financial ledger, usage costing, metered client, budget protocol, reconciliation, and CFO.ai financial export. Distinguish revenue, expenses, cash movements, budget reservations, promotional credits, and forecast assumptions.

Retain immutable records with correction or adjustment entries. Preserve source currency and pricing assumptions. Unknown usage is a data-quality condition, never an automatic zero. Attribute development and customer operations separately while reconciling them to provider totals.

## Planned internal modules

- `src/metering/`: Provider-neutral client and usage observations.
- `src/pricing/`: Versioned rate cards and estimation rules.
- `src/budgets/`: Atomic reservations, settlement, release, and enforcement.
- `src/ledger/`: Revenue, expenses, cash movements, and adjustments.
- `src/integrations/`: Model billing, available Entire development usage, Neatlogs evidence links, payment records, and supplier inputs.
- `src/reconciliation/`: Matching, variance review, and source status.
- `src/reporting/`: Financial summaries and CFO.ai export packages.

## Dependencies and handoff

Consume shared contracts and usage from specialist modules. Deduplicate repeated observations of an attempt while retaining separately billed retry attempts. Reconcile request estimates with provider charges without counting both as independent expenses. Supply authoritative summaries to `team-dashboard` and permission-checked financial commands through the application boundary.

## P0 demo slice

Meter one design journey, enforce concurrent-safe reservations, record labeled sandbox commerce, and produce a reconcilable summary. Export documented CFO.ai inputs; a direct connector is optional.

## Acceptance boundary

- [ ] Billable attempts have stable identities and visible usage completeness.
- [ ] Concurrent reservations respect the applicable budget limit.
- [ ] Estimates, confirmed charges, credits, and cash remain distinguishable.
- [ ] Duplicate observations do not inflate spending.
- [ ] Adjustments preserve audit history and source references.
- [ ] Summary totals trace to ledger entries and reconciliation status.

[Architecture](../docs/architecture.md) · [Acceptance checklist](../planning/acceptance-checklist.md).
