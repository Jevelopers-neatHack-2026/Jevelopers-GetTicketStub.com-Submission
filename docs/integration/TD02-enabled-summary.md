# TD-02 enabled view: reusable `FinancialSummaryView`

Refs issue #6 (TD-02). Foundational, private, offline step. It is not owner-accepted, not integrated acceptance and closes no TD-02 acceptance item. No Finance or Dashboard owner has acknowledged it.

## What exists

`src/views/financial-summary/`

- `FinancialSummaryView` renders a `ProjectionResult<SummaryProjection>` from `readFinancialSummary` (shared-contracts 0.9.7 adapter). It composes the existing `MetricCard`, `AmountText`, `StateBadge`, `ScopeContext` and `TableScroll`.
- `refuseUnsupportedPacket(manifest)` returns a typed `refused` result (`UNSUPPORTED_VERSION` / `UNACCEPTED_INTERFACE`) for a Finance handoff whose canonical references are not the pinned 0.9.7 / schema 1.0.0 / adopted set. The Finance 0.3.0 proposal-only packet is refused this way; nothing is relabelled or approximated.

## Display rules

- Metric titles, definition ids/revisions, source counts and amount strings are the producer's, verbatim. No spent/earned/remaining/budget alias, no arithmetic, no independent balance.
- A requested metric absent from the record reads "Amount unavailable"; a producer-declared unknown reads "Amount unknown". Neither is zero.
- Valuation, settlement, reconciliation, reservation and completeness are separate labelled values. Environment and billing mode, coverage (expected `null` shown as "Unknown"), missing sources, observed/ingested time and staleness are shown independently.
- The project label is host-supplied only; the projection has none, so "Not supplied by host" is shown otherwise.
- `missing`, `restricted`, `unknown` and `refused` results show no amounts. `stale` keeps the last observed amounts under a status notice.
- Accessibility: labelled region, heading hierarchy, definition lists, a provenance table with `scope` headers inside the shared scroll frame, `role=status` / `role=alert` for state notices, state conveyed as text.

## Tests and their limits

- `tests/components/financial-summary.test.tsx` (vitest/jsdom): view behaviour; adapter-to-view wiring through a **stub** `ContractKit` (accepts anything, so it proves wiring only; real validation is `npm run test:contracts`); packet gate; and, when `/tmp/ie-financial-fixture-handoff` exists, manifest hash equality and that every `expectedPublicFinancialSummary` is `null`.
- `tests/components/financial-summary.fixtures.ts`: synthetic UI projections, not producer or Finance fixtures.
- `tests/e2e/financial-summary.spec.ts` (Playwright/Chromium + axe): routed through the real `Dashboard` in the packed fixture host, synthetic fixture mode only.

## Not claimed

- No spend, budget, breakdown, drilldown or export. The IE packet carries no successful `FinancialSummary` (`expectedPublicFinancialSummary` is null throughout), `querySummary`/`exportSummary` are unavailable, and `ci08_query_sol` owns the API. This view neither defines nor assumes a query schema or totals.
- No 0.9.7 package fixture is exercised here (the package is not provisioned in this checkout).

## Integration (done)

- `src/index.ts` exports `FinancialSummaryView`, `refuseUnsupportedPacket` and the `ProjectionResult` / `SummaryProjection` / `MetricProjection` types (`src/package.ts` re-exports them); `scripts/prepare-fixture.mjs` compiles them from the packed tarball as an isolated consumer.
- The fixture host renders the view from `renderRoute` for the `overview` route only when the explicit `?summary=<ready|partial|stale|unknown|missing|restricted|refused|unsupported>` fixture parameter is present (with `?state=ready`). Every such page carries a visible **SYNTHETIC FIXTURE** note and a synthetic project label. The data is typed adapter-shaped fixtures in `integration/fixture-host/host.ts`, not producer or Finance data. Without the parameter the host is unchanged.
- `tests/e2e/financial-summary.spec.ts` drives the packed, hydrated client through the real `Dashboard` (axe, 320px reflow, keyboard on the table scroll controls). `tests/components/financial-summary-route.test.tsx` mounts the real `Dashboard` in jsdom with the same fixtures.

## Still open

- The actual Finance route stays unavailable: no real route provider delivers `readFinancialSummary` output (host verifier scope, references, digest) until Finance supplies the accepted handoff.
