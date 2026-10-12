# `team-dashboard`

**Repository status:** Proposed addition; creation is not claimed.  
**Proposed owner:** Finance and reliability.  
**Delivery state:** Planning only; all checks pending.

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

[Architecture](../docs/architecture.md) · [Acceptance checklist](../planning/acceptance-checklist.md).
