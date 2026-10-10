# `team-dashboard`

**Repository status:** Verified existing on GitHub, private, October 10, 2026.
**Proposed owner:** Finance and reliability.
**Delivery state:** Architecture plan; implementation criteria remain planned until evidence is recorded.

## Responsibility

Show authorized team members project spending, sales, operating result, and remaining budget. Own financial presentation, filtering, transaction drilldowns, and report navigation. Cash requires an identified balance source or reconciled calculation.

Maintain a separate source repository and mount its module in the authenticated administration area of `getticketstub.com`. The initial architecture requires one running web application. Financial calculations and ledger writes remain with `cost-intelligence`; the application enforces identity and access.

## Planned internal modules

- `src/views/`: Overview, AI usage, sales, fulfillment, and budgets.
- `src/components/`: Metric cards, charts, filters, and transaction tables.
- `src/data/`: Typed financial API queries and refresh behavior.
- `src/reports/`: Export navigation and forecast references.
- `src/access/`: Application role integration and presentation permissions.
- `integration/`: Mounting contract and route expectations.

## Dependencies and handoff

Consume versioned summaries from `cost-intelligence`, interface definitions from `shared-contracts`, and tokens from `brand-kit`. Show CFO.ai outputs as scenarios with their assumptions and dates. Any authorized budget action should call the owning financial API and produce an audit record.

## P0 demo slice

Show earned, spent, operating result, and remaining budget for the agreed period, with source-status labels. Provide expense breakdowns and a transaction drilldown for one journey. Label demonstration data and unavailable values clearly.

## Acceptance boundary

- [ ] Displayed amounts reconcile to the authoritative financial API.
- [ ] Estimates, sandbox activity, and confirmed amounts are distinguishable.
- [ ] Filters apply consistently across metrics and detail views.
- [ ] Authorized viewers can follow totals to supporting records.
- [ ] Roles protect financial commands and sensitive transaction details.
- [ ] Data freshness and unresolved reconciliation gaps remain visible.

[Architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) · [Acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

## Acceptance and contributor handoff

Use the [repository acceptance view](ACCEPTANCE.md) and [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md). Interfaces are specified in the [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md). Preserve local contributor and agent instructions; follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.
