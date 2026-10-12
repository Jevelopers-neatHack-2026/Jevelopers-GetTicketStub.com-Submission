# cost-intelligence ownership and implementation boundary

**Repository status:** Public on GitHub; verified October 12, 2026.
**Accountable owner:** Finance and reliability, [@CompleteDotTech](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/10#issuecomment-6118434131).
**Implementation state:** A private Node.js 22 package contains local finance modules behind injected PostgreSQL, authority, storage, evidence and clock ports. Usage intake, pricing v2, ledger append/projection, budget reservation authority, scoped reporting and prepared exports have source and test coverage. Contract adoption, real host issuer integration, financial acceptance, settlement/release finality and CFO.ai delivery remain separate.

## Responsibility

Own the authoritative financial ledger, usage costing, metered client, budget protocol, reconciliation, and CFO.ai financial export. Distinguish revenue, expenses, cash movements, budget reservations, promotional credits, and forecast assumptions.

Retain immutable records with correction or adjustment entries. Preserve source currency and pricing assumptions. Unknown usage is a data-quality condition, never an automatic zero. Attribute development and customer operations separately while reconciling them to provider totals.

## Current implementation surface

The ESM package targets Node.js 22.23.3 through 22.x with npm 10.9.9. It exports contracts, metering, pricing, budgets, ledger, accounting, integrations, evidence, reconciliation and reporting. Local source includes versioned pricing v2 catalog/estimate operations; usage-intake persistence and recovery; PostgreSQL ledger event append and immutable projection; CI05A scoped budget authorization, dispatch and policy operations; authorized reporting snapshots; and snapshot-backed JSON/CSV export preparation.

These are host-composed functions, not a running service. They require finance authority, trusted context, injected databases/source evidence and private storage or signing material as described in the API guides. Pinned shared-contracts 0.3.0 remains proposal-only. The [original reporting/export packets have scoped synthetic owner and consumer acknowledgements](../api/cfo-ai-handoff.md#accepted-synthetic-handoffs); those receipts do not establish canonical adoption or compatibility with later producer additions.

Typed unavailable operations include legacy pricing 1.0.0 estimate, ledger financial ingest, budget settlement/release, expense adjustment and reconciliation. Nested budget scopes remain deferred as P1 issue #17 from the default v1 integration/release gate by issue #18. CFO.ai has a manual handoff but no connector or automatic delivery path. Prepared files, synthetic fixtures and mode labels are not production financial evidence.

## Integration targets and handoff

Application integrations must provide independently reviewed finance authority, source evidence and exact scope mapping. This package does not issue external grants, infer permission from application roles, or expose a hosted finance endpoint. The app's proposed source comparison linked below reports no cost-intelligence dependency, API client or vendored module at app main `01c65ae2290447c523823bf4601d6373ce4c6ca2`. Inspect producer and consumer at exact revisions and retain the joint Product/Finance handoff and affected tests before claiming integration.

See the [development guide](../development.md), [API map](../api/INDEX.md), [authorization and data-handling guide](../api/security.md), [reporting guide](../api/reporting.md), and [prepared export guide](../api/prepared-exports.md).

## P0 target slice

Design intent: meter one design journey, enforce concurrent-safe reservations, record labeled sandbox commerce, and produce a reconcilable summary. Prepare CFO.ai inputs only from independently verified source records; direct connection is optional. This is not a current complete journey.

## Acceptance boundary

- [ ] Billable attempts have stable identities and visible usage completeness.
- [ ] Concurrent reservations respect the applicable budget limit.
- [ ] Estimates, confirmed charges, credits, and cash remain distinguishable.
- [ ] Duplicate observations do not inflate spending.
- [ ] Adjustments preserve audit history and source references.
- [ ] Summary totals trace to ledger entries and reconciliation status.

The proposed [cross-repository current-state companion at `60d3b6a`](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/60d3b6aa074caddca4d362ba8b13b56fe4436177/docs/architecture/CURRENT-STATE.md) is available for review in [app PR #117](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/117), observed open on 2026-10-12. It is absent from inspected app main `01c65ae2290447c523823bf4601d6373ce4c6ca2`; its source comparison is proposed context, not integration acceptance. The historical [v1.0 architecture kit](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) remains design intent.

Use the [repository acceptance view](ACCEPTANCE.md) for criterion allocation only. Current criteria and evidence live in the [master checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) and [JSON tracker](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.json). See the [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md), [contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md) and [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Implementation and independent review assignments are recorded per issue or PR; the confirmed Finance owner does not substitute for a required reviewer.

For a guide-by-topic list, see the [documentation index](../INDEX.md).
