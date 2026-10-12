# TD v2 fixture views: budget advisory, cost breakdown, transaction drilldown

Private, offline, **SYNTHETIC_PROPOSAL** slice. It is not owner-accepted, not integrated acceptance, and no Finance or Dashboard owner has acknowledged it. API unmerged; Finance definitions pending owner acknowledgement.

## Input and status

Typed against the **frozen** Finance WIP proposal in `/tmp/td-finance-v2-frozen-proposal` (manifest status `WIP_PROPOSAL_NOT_ACCEPTED`, source base `a08760e9ea65bda1e116867ac00b3e03d737bb7e`, captured 2026-10-12T10:40:31Z). SHA-256 of the four frozen files was recomputed locally with Node and matches `manifest.json`:

| file | sha256 |
|---|---|
| `src/reporting/schema-v2.ts` | `467f46768cb80912ccc82ad4d0003d9987726333b1680c7e8ef98ef425719c7f` |
| `src/reporting/definitions.ts` | `adfb4d5132349878a25673455fb2f8898bdde674c7fe2369516b6c11daa85e8f` |
| `src/reporting/host-authority.ts` | `4f781461f9afc89434c6dd99b31d6bf90530d41c6d315e73b992d6bf6b1ae92e` |
| `fixtures/reporting/query-export-handoff.json` | `eca74fe6fd34b9631fcb3022f3417425ef94580043a67fce4832b52fa6993da9` |

The same hashes and status are recorded in `FROZEN_PROPOSAL_PROVENANCE` (`src/views/finance-v2/fixtures.ts`). The unit test checks their shape and that `observation` and `ownerAccepted` are `false`; it does not re-read `/tmp` (the frozen directory is a host-local path), so re-verification is a manual step.

## What exists

`src/views/finance-v2/`

- `types.ts`: checked TypeScript props that mirror `FinancialSummaryPageV2`, `ReportingProjection`, `ReportingDetail`, `ReportingAmount` field for field. **Not a canonical fork**: no TypeBox schema, no shared-contracts copy, no producer validator. `canonicalSummaries` is deliberately absent, so the rich projection is shown whether or not a canonical mapping exists.
- `check.ts`: `checkFinanceV2Page(raw, expectedScope, expectedSnapshotId?)`, a presentation guard only. Refusal codes: `INVALID_SHAPE`, `UNSUPPORTED_VERSION`, `SCOPE_MISMATCH` (any scope field differs from the host's own expected opaque scope), `SNAPSHOT_MISMATCH` (snapshot differs from the one asked for, or a detail's currency is absent from the parent summary). Amounts are only required to be strings; they are never parsed. Each currency summary must carry `scale` exactly `18`. A detail's `metrics` must have exactly the eleven frozen names (`expense`, `grossSales`, `netSales`, `directCosts`, `contribution`, `cashReceipts`, `cashPayouts`, `simulatedGrossSales`, `simulatedNetSales`, `simulatedDirectCosts`, `simulatedExpense`), each a string; a missing, extra or invented key is refused (`INVALID_SHAPE` at `/details/<i>/metrics`) and only those names are ever rendered.
- `FinanceV2Views.tsx`: `FinanceV2View` with `view` = `budget` | `breakdown` | `transactions` | `transaction-detail`. Composes the existing `MetricCard`, `AmountText`, `StateBadge`, `ScopeContext`, `FilterSelect` and `TableScroll`.
- `fixtures.ts`: typed fixtures (13 named cases) plus `FROZEN_PROPOSAL_PROVENANCE`. Not exported from the package.

## Display rules

- Amounts are producer strings, shown verbatim, including negative refund strings and 18-digit scale. **No parsing, no sum, no unit cost, no balance, no rounding, no currency conversion.** A source test greps the view and guard for number-parsing and arithmetic primitives.
- Each currency is its own section; currencies are never combined. `null` is "Amount unknown", never zero. A `partial` `ReportingAmount` shows status, known subtotal, total (unknown when `null`) and unknown count in separate cells.
- Parent totals come from the same delivered snapshot and currency, verbatim. A detail view shows its currency's parent totals and states that the detail is not added to them.
- Budget: `remainingAuthorizedCapacity` is labelled advisory and "not spend authority"; `lifecycleConsumed` is labelled "not ledger expense" and sits beside, not merged with, `ledgerExpense`. A `null` limit or capacity reads unknown, not zero. No budget delivered reads "No budget delivered", not a zero budget.
- Transaction filters are host-owned when the host passes `filters` and `onFiltersChange` (the fixture host keeps them, with the fixture and boundary state, in the URL query as `valuation` and `currency`). `detailHref` and `listHref` must carry that same query so Back, reload and deep links keep the snapshot and filters; without those props the list keeps local state only. A filter value that is not one of the offered options is shown as `all`; `unknown` is a real valuation and is never treated as `all`.
- Accessible names are unique per view: budget cards are currency-qualified (`USD limit`, `EUR limit`, ...), the list section is "Transaction list" and the detail record section is "Transaction record", so they never repeat the route heading or each other.
- Estimated, confirmed, unknown valuation, reconciliation counts, simulated amounts and coverage are separate labelled sections.
- Opaque product scope (`account:...`, `event:...`) is shown as delivered. It is not converted to or required to be a canonical UUID, and no grant is derived from it. `canonicalMappingStatus` and `definitionsStatus` are shown verbatim.
- CFO export: a disabled "Export unavailable" button and a restricted notice on every view. No approved export port exists, so no file, no CSV and no success state.
- `missing`, `restricted`, `unauthorized`, `unknown` and refused results show no amounts. Mode must be the literal `SYNTHETIC_PROPOSAL`; anything else renders `UNSUPPORTED_MODE` and nothing financial.

## Fixture host route

`?state=ready&v2=<fixture>` on `budgets` (budget advisory), `ai-costs` (cost breakdown), `transactions` (list) and `transactions/:id` (detail), through the real `Dashboard` `renderRoute`. Without `v2`, or on any other route, the host is unchanged. Fixtures: `ready`, `mixed-currency-partial`, `unknown-coverage`, `refund-negative`, `empty-budget`, `forged-scope`, `forged-snapshot`, `unsupported-version`, `invalid-shape`, `missing`, `restricted`, `unauthorized`, `unknown-state`. Fixture data is imported by the host from source; the views come from the packed package.

## Tests and their limits

- `tests/components/finance-v2.test.tsx` (vitest/jsdom): guard, states, budget, breakdown, drilldown, no-arithmetic source check, and mounting through the real `Dashboard`.
- `tests/e2e/finance-v2.spec.ts` (Playwright/Chromium + axe): written against the packed fixture host. See the report for whether it was executed in this checkout.
- Fixtures are not observations and not Finance output; passing tests prove presentation of synthetic data only, not Finance correctness.

## Not claimed, and still open

- No Finance wrapper handoff, no real provider, no trusted host port: live authority is unsupported. No grant alias and no grant derived from the opaque scope.
- Finance definitions, the canonical mapping and the query/export API are unmerged and pending owner acknowledgement. No export API acceptance.
- **Request to the Finance port (names only, no implementation here):** a reviewed read port that returns `FinancialSummaryPageV2` for the host's opaque product scope, with `snapshotId` / `queryContentHash` / `summaryContentHash` bound to the requested query, and an approved export port keyed by that snapshot.
- Unit-cost and allocation rows (`unitCosts`, `allocations`) are carried as `unknown[]` and not displayed.
