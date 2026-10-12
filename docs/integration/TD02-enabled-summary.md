# TD-02 enabled view: reusable `FinancialSummaryView`

Refs issue #6 (TD-02). Foundational, private, offline step. It is not owner-accepted, not integrated acceptance and closes no TD-02 acceptance item. No Finance or Dashboard owner has acknowledged it.

## What exists

`src/views/financial-summary/`

- `FinancialSummaryView` renders a `ProjectionResult<SummaryProjection>` from `readFinancialSummary` (shared-contracts 0.9.7 adapter). It composes the existing `MetricCard`, `AmountText`, `StateBadge`, `ScopeContext` and `TableScroll`.
- `evaluateFinancePacket(manifest, trusted, mode)` is the packet acceptance gate (`packet.ts`). It checks, in order: manifest shape, wire `schemaVersion`, the `FinancialSummary` schema entry, its digest against a **host-supplied** trusted schema digest, a host-supplied summary digest, and host-supplied trusted versioned-reference expectations (UUID id, safe non-negative revision, `sha256:` content hash). It returns a typed `PacketOutcome`: `refused` (typed refusal: `INVALID_PAYLOAD`, `UNSUPPORTED_VERSION`, `UNKNOWN_CONTRACT`, `DIGEST_MISMATCH`, `INVALID_TRUST_CONTEXT`, `REFERENCE_MISMATCH` or `UNACCEPTED_INTERFACE`) or `synthetic_development_only`.
- `readFinancePage({ page, manifest, trusted, ... })` runs that gate, splits the Finance page, keeps every non-`summary` field as `wrapper` (verbatim, never summed), and passes only the exact inner `summary` to `readFinancialSummary` with the trusted digest and references. A null or absent `summary` is `missing`, never a zero summary. Scope, partition, digest and the semantic producer check (`checkFinancialSummary`) stay the adapter's and are not bypassed.

## Contract compatibility basis

The independent review `financial-summary-contract-compatibility-review.md` (2026-10-12) found `schemas/FinancialSummary/1.0.0.json` (sha256 `8d73d97e...67d9`) byte-identical in Finance 0.3.0 and the Dashboard 0.9.7 producer, and the extracted `checkFinancialSummary` text identical. The package-version difference is therefore **not** a wire blocker and the gate does not refuse on it. The review is mechanical compatibility evidence only: not implementation approval, domain acceptance, owner acknowledgement or permission to merge. It did not rebuild or verify the 0.9.7 archive, and the fixture manifests and whole runtime files differ.

## Adoption status

- Finance `proposal_only` / `adoption_accepted=false` and Dashboard `owner_acknowledgement=null` remain true. No pin here is declared accepted.
- A schema-compatible packet may be used in **explicit synthetic development** only, and only when the host has independently established the trusted schema digest, summary digest and reference expectations. It is never production adoption: `mode: 'production'` is always refused (`UNACCEPTED_INTERFACE` at `/ownerAcknowledgement`) because no owner verifier exists in this slice, and an acknowledgement or `adoptionAccepted` claim inside a packet is recorded as `claimed_unverified` and grants nothing.
- References are never manufactured. Review findings this view does not fix, which belong to the Finance mapping author: C1 non-UUID metric-definition and policy reference ids, C2 `complete` coverage with `expected: null` (rejected by the strict helper), C3 no trusted reference registry or receipt, C4 the richer Finance wrapper cannot be encoded in the closed canonical object. This view surfaces the wrapper separately and shows metrics only as delivered.

## Display rules

- Metric titles, definition ids/revisions, source counts and amount strings are the producer's, verbatim. No spent/earned/remaining/budget alias, no arithmetic, no independent balance.
- A requested metric absent from the record reads "Amount unavailable"; a producer-declared unknown reads "Amount unknown". Neither is zero.
- Valuation, settlement, reconciliation, reservation and completeness are separate labelled values. Environment and billing mode, coverage (expected `null` shown as "Unknown"), missing sources, observed/ingested time and staleness are shown independently.
- The project label is host-supplied only; the projection has none, so "Not supplied by host" is shown otherwise.
- `missing`, `restricted`, `unknown` and `refused` results show no amounts. `stale` keeps the last observed amounts under a status notice.
- Accessibility: labelled region, heading hierarchy, definition lists, a provenance table with `scope` headers inside the shared scroll frame, `role=status` / `role=alert` for state notices, state conveyed as text.

## Tests and their limits

- `tests/components/financial-summary.test.tsx` (vitest/jsdom): view behaviour; adapter-to-view wiring through a **stub** `ContractKit` (proves wiring and gate ordering only; real structural and semantic validation is `npm run test:contracts`, and the stub's semantic refusal is injected, not a real C2 check); the packet gate (identical schema with a different package version is not refused; mismatched digest, unsupported wire version and missing or malformed trusted references are refused; a proposal-only packet is synthetic-development-only and never production); `readFinancePage` wrapper separation; and, when `/tmp/ie-financial-fixture-handoff` exists, manifest hash equality and that every `expectedPublicFinancialSummary` is `null`.
- `tests/components/financial-summary.fixtures.ts`: synthetic UI projections, not producer or Finance fixtures. The reference UUID and hash in the gate tests are shape-only test vectors, not Finance references.
- `tests/e2e/financial-summary.spec.ts` (Playwright/Chromium + axe): routed through the real `Dashboard` in the packed fixture host, synthetic fixture mode only.

## Not claimed

- No spend, budget, breakdown, drilldown or export. The IE packet carries no successful `FinancialSummary` (`expectedPublicFinancialSummary` is null throughout), `querySummary`/`exportSummary` are unavailable, and `ci08_query_sol` owns the API. This view neither defines nor assumes a query schema or totals.
- No 0.9.7 package fixture is exercised here (the package is not provisioned in this checkout).

## Integration (done)

- `src/index.ts` exports `FinancialSummaryView`, `evaluateFinancePacket`, `readFinancePage`, the packet and wrapper types and the `ProjectionResult` / `SummaryProjection` / `MetricProjection` types (`src/package.ts` re-exports them); `scripts/prepare-fixture.mjs` compiles them from the packed tarball as an isolated consumer.
- The fixture host renders the view from `renderRoute` for the `overview` route only when the explicit `?summary=<ready|partial|stale|unknown|missing|restricted|refused|unsupported|digest-mismatch|missing-references>` fixture parameter is present (with `?state=ready`). Every such page carries a visible **SYNTHETIC FIXTURE** note and a synthetic project label. The data is typed adapter-shaped fixtures in `integration/fixture-host/host.ts`, not producer or Finance data; the `ready` fixture also shows synthetic response-envelope metadata in its own section. The three packet fixtures run the real gate with a host expectation holding the reviewed schema digest and **no references**, so none can reach the eligible outcome and no reference is invented. Without the parameter the host is unchanged.
- `tests/e2e/financial-summary.spec.ts` drives the packed, hydrated client through the real `Dashboard` (axe, 320px reflow, keyboard on the table scroll controls). `tests/components/financial-summary-route.test.tsx` mounts the real `Dashboard` in jsdom with the same fixtures.

## Still open

- The actual Finance wrapper handoff is pending: no real route provider delivers `readFinancePage` output (host verifier scope, trusted references, digest), so the actual Finance route stays unavailable and no real output is shown.
- Owner acknowledgement, Finance repairs for C1-C4, the single-currency/envelope extraction path and agreed metric names are outstanding. Hosted browser (Playwright/axe) results are pending: Chromium cannot launch in this sandbox and the sandbox was not bypassed.
- The existing Finance query author solely owns the actual mapping; this view and gate duplicate no financial math.
