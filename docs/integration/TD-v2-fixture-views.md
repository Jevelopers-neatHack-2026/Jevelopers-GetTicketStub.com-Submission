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

## SYNTHETIC_CONFORMANCE (producer 22a3237)

Label: **SYNTHETIC_CONFORMANCE_ONLY**. The Finance owner accepted reviewed synthetic outputs only (receipt `cost-intelligence#2` comment 6123320849). This is not live grants, not a production acknowledgement and not an owner ACK of this dashboard. Producer gate PG passed 29/29; the producer's full CI at 22a3237 **failed** (migration job) and that historical failure is neither reproduced, waived nor relabelled here. A later producer head (667) went full-green with production bytes unchanged; that is separate evidence and no retroactive waiver of the 22a3237 result. The full producer tree is `4f8dcc44019ec0f73ab3aa7c0eb1d5de40bb777e` (recorded in `PROVENANCE.json`, asserted by the unit test, and not a prefix claim).

- `simulated.*` is now a `ReportingAmount` (status, knownSubtotal, nullable total, unknownCount), rendered in its own table with all four cells. No scalar coercion and no zero fallback: a partial simulated expense of known subtotal `5`, total `null`, unknown count `1` reads "5 USD / Amount unknown / 1", beside an actual expense that is `unknown`.
- The earlier proposal's scalar `simulated` strings are a different shape. They are refused as `LEGACY_PROPOSAL_SHAPE` at their exact path and are never read as this `2.0.0`.
- The guard now also requires the closed set of eighteen page members (an invented member such as `grant` is refused), `filters`, `watermark` and an array `canonicalSummaries` (carried, never rendered).
- `checkFinanceV2Page(..., { references })` binds every `canonicalSummaries[].metrics.*.definition_ref` and `policy_ref` to references the host pinned independently (the test derives them from the committed `definition-registry.json` after re-hashing it). A page is never its own authority; with no host references supplied nothing is bound. Mismatches are `REFERENCE_MISMATCH`. The references are an optional `expectedReferences` prop on `FinanceV2View` and `FinanceV2ConnectedView`, forwarded to the async read port and part of its identity key (changing them discards a settled answer). Supplying none leaves canonical references unbound; that is a documented limit, not an acceptance.
- Fixture host: `?v2=conformance-base|conformance-budget|conformance-unknown-simulated|conformance-pg|conformance-v1-refused` serves the actual produced pages through the same injected synthetic port, with host-literal snapshot/query/summary identities and registry-derived references (`integration/fixture-host/conformance.ts`). The earlier proposal fixtures are unchanged and now use the new `simulated` amount shape; the old scalar shape is only reachable as a refused case.
- Committed under `tests/fixtures/finance-v2-conformance/` with `PROVENANCE.json`: the four v2 pages, the v1 page (refused), the registry (`577ce880...`), the page schema (`862900ad...`), and the producer `source/schema-v2.ts` and `source/query-export-handoff.json` as byte-exact pinned references. `source/` is excluded from this repository's `tsc` and eslint (the TypeScript imports producer-only modules) and is never imported or executed; all nine pins are re-hashed. `tests/components/finance-v2-conformance.test.tsx` re-hashes them in place; it reads nothing from `/tmp` and has no skips.
- The page schema declares `partial_wrapper_requires_combined_validation`: it is not the full producer validator, and neither is this guard.
- A further host fixture, `?v2=conformance-forged-policy`, is the unknown-simulated page with its `policy_ref` rewritten inside the payload; the registry-derived host references still win and it is refused as `REFERENCE_MISMATCH` at `/canonicalSummaries/0/policy_ref`.
- `tests/e2e/finance-v2-conformance.spec.ts` drives the conformance routes in real Chromium + axe against the packed host (exact produced strings, v1 and forged-reference refusal, keyboard, 320px reflow, async revocation and ignored-abort stale answers). Its execution status is stated in the evidence report, not here.
- CFO export stays disabled; no export port is accepted.

## Not claimed, and still open

- The async read port, lifecycle and fault mapping are in `docs/integration/TD-v2-async-port.md`.
- No Finance wrapper handoff, no real provider, no trusted host port: live authority is unsupported. No grant alias and no grant derived from the opaque scope.
- Finance definitions, the canonical mapping and the query/export API are unmerged and pending owner acknowledgement. No export API acceptance.
- **Request to the Finance port (names only, no implementation here):** a reviewed read port that returns `FinancialSummaryPageV2` for the host's opaque product scope, with `snapshotId` / `queryContentHash` / `summaryContentHash` bound to the requested query, and an approved export port keyed by that snapshot.
- Unit-cost and allocation rows (`unitCosts`, `allocations`) are carried as `unknown[]` and not displayed.
