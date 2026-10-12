# CFO.ai input mapping and export handoff (CI-08X.4)

This document defines a **manual handoff** to the TicketStub CFO.ai business plan. No CFO.ai connector exists or is required. Snapshot-backed export preparation is implemented when host ports are configured. Actual hosted PostgreSQL query-to-export execution and the packet-specific synthetic consumer ACKs below are recorded; current host adoption, source-specific metric/policy approval and actual plan delivery/import remain separate. An unconfigured call returns typed unavailable. A prepared file is not a CFO.ai delivery or verified financial statement.

| Item | State, 2026-10-12 |
| --- | --- |
| CI-08X.4: manual mapping, consumer role, plan reference | **This document** |
| CI-08X.1–.3: versioned JSON/CSV export, reconciliation to CI-08, sanitizing serializer | Actual PostgreSQL composition and the original export/denial-supplement ACKs are recorded below, using synthetic authority and financial fixtures. New reported-unsettled compatibility, broader policy/canonical adoption, mounted host grants/fence and actual CFO delivery/import remain pending. [Issue #3](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/3) stays open; [CI-08 #2](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/2) is the completed reporting slice. |
| SPN-03 (actual CFO.ai plan) | The [master at `f187722`](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/f187722613c61e14e3f4087a66d07b2b1e6820f7/planning/acceptance-checklist.json) records it verified after the [Finance owner's acceptance](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/20#issuecomment-6112762319). This does not verify CI-08X import; the later generic-export review qualification is retained below. |

## Accepted synthetic handoffs

These receipts retain their original producer, consumer and evidence identities. They acknowledge only the named synthetic scope; they do not establish live issuer authority, provider bills, a selected business run or actual CFO import.

| Producer and scope | Accountable receipts |
| --- | --- |
| Reporting `22a3237dd44f376017969ac881586ff396f19cf8`: exact reference mapping, read-model semantics and structured simulated amounts | [Finance acceptance](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/2#issuecomment-6123320849); [Dashboard ACK](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/2#issuecomment-6123982814), `SYNTHETIC_CONFORMANCE_ONLY` |
| Pagination/refusals `924cdd2b5489681434790b5d1d7aac138198ccfd`: immutable three-page chain and typed refusals | [Finance acceptance](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/2#issuecomment-6124267724); [Dashboard ACK](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/2#issuecomment-6125365102), `SYNTHETIC_CONFORMANCE_ONLY` |
| Original export `0c4c7024c68b5a52a12f3de3cec891f64aa65bd3`: packet SHA-256 `410a99fe766a6c0b3b36b696bf73b8f5a46590f9ce9170e9fbe02be3939f59c6` | [Finance acceptance and actual PostgreSQL composition receipt](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/3#issuecomment-6125399193); [Dashboard ACK](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/3#issuecomment-6126280618), `SYNTHETIC_EXPORT_CONFORMANCE_ONLY` |
| Denial supplement `3e88311d481052f522e8e79ed20155334ab526e7`: separate packet SHA-256 `8a38eaaf8af1c2723124958cd2ea0d0e4ce37925cab8268374a1a284ece4bfc3` | [Finance acceptance](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/3#issuecomment-6126114381); [Dashboard ACK](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/3#issuecomment-6126836669) and [postmerge verification](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/3#issuecomment-6127027435), `SYNTHETIC_DENIAL_CAPTURE_SUPPLEMENT_ONLY` |

The reporting receipt accepts the exact tested registry mapping/read-model semantics. Broader policy labels and source-specific plan mappings remain subject to their owners. The original export used actual hosted PostgreSQL with synthetic postings and authority; the Dashboard ACK does not claim new database execution. Its positive CSV request metadata is test-built, and the denial supplement's positive expectations use test-built hydration. Preserve those qualifications and all original packet bytes.

The later [Dashboard replay receipt](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/12#issuecomment-6128727744) re-executes those unchanged consumer fixtures. Its pending integrated consumer acknowledgement concerns the actual host handoff; it neither withdraws the earlier scoped ACKs nor establishes fresh producer/database execution, live authority or CFO delivery.

The later [reported-unsettled design](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/13#issuecomment-6128331072), `ci-finance-reporting-reported-unsettled-1.0.0`, requires the existing Reporting/Export writers to implement and qualify the new valuation bucket and return affected consumer ACKs before CI05B merge. Earlier packets do not accept that addition. The [joint Product/Finance host handoff](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/3#issuecomment-6127027435) still needs an accepted adapter revision, trusted current principal/grants, finite field policy, exact five-field scope, coherent fourth fence and adoption of the [public release boundary](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/3#issuecomment-6126848742), with positive and revoked/expired/foreign/missing-fence evidence. Actual CFO delivery/import and accountable acceptance remain open independently of the already verified SPN-03 plan.

## Consumer and plan reference

- **Consumer role:** the CFO.ai business-plan owner, in the Finance and reliability role. The owner is CompleteDotTech (confirmed 2026-10-11). This repository does not author or edit the plan.
- **Plan:** the TicketStub CFO.ai canvas, page `7ed03e7e-ca7d-441c-b6bb-7d4e5f7efc94`. Workspace login is required and the page is not publicly shared. The canvas access ends 2026-10-25 per the owner.
- **Sanitized plan reference** (public, immutable): [integration-evals `f375fcf`, `evidence/cfo-ai/2026-10-11-r2/`](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/f375fcf20584f5c98dbd4f3b69f884c52994224e/evidence/cfo-ai/2026-10-11-r2). It contains the reviewer workbook `cfo-native-export.xlsx`; Main-scenario inputs are entered in sheet `01 — Editable assumptions — USD`, cells `B5`, `B6`, `B7`, `B10`, `B32` and `B34`.

The owner acceptance is recorded as an explicit chat instruction relayed by an agent, not an independent human GitHub review. The plan uses documented assumptions, public vendor rates and synthetic tariff evidence; its forecasts do not establish actual cash, revenue or imported CI-08X observations.

The later independent [CFO-R2-001 review](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/20#issuecomment-6112840013) requests changes to the retained generic native export: genuinely blank opening cash becomes zero in Conservative and Growth, although formula-produced empty strings remain unknown and the reviewer workbook has blank-preserving guards. A new immutable exporter revision or enforced guard step, plus intended-engine blank/empty-string/explicit-zero checks across all three scenarios and financial dependents, remains the plan owner's repair and review prerequisite. Preserve the defective generic export as historical provenance; do not promote it as an accepted editable forecast. This qualification does not alter the integration-evals master's recorded SPN-03 status.

Add a newer immutable reference whenever the plan is re-exported, retaining the earlier revisions and their review qualifications. Never use a mutable branch as the export evidence reference.

## What may flow into the plan

Only a `FinancialSummary` from an export manifest with all of the following:

| Field | Required value | Why |
| --- | --- | --- |
| `environment` / `included_environments` | Explicit selected scope, with test/development separated from production | A genuinely paid live AI test remains actual expense; its environment does not erase the charge |
| `billing_mode` / `included_billing_modes` | `live` for actual paid observations | Sandbox/simulated sales are excluded from actual revenue. Synthetic fixture amounts are never actual bills (master FIN-09, FIN-10) |
| `valuation_basis` | `provider_confirmed`, or `estimated` labelled as an estimate | `unknown` is never entered as 0 |
| `completeness` | `complete`, or `incomplete` with `coverage.missing_sources` copied into the plan note | Partial coverage must stay visible |
| `reconciliation` | `matched` for "actual"; anything else is "unreconciled" | Matches the plan's "owner-reported, not reconciled" table |
| Manifest `summaryContentHash`, `snapshotId`, `snapshotAsOf`, `snapshotTimezone` | Recorded in the plan's source register | Reproducible provenance |

Excluded in every case: prompts, customer data, addresses, credentials, order or customer identifiers, promotional credits treated as cash, prize cash, and sandbox checkout totals.

## Mapping

Metric names below are **proposed**. CI-08 must publish each `definition_ref` before an export uses them. A metric with `status: "unknown"` leaves the plan input unchanged and adds an "unknown" note.

| Proposed `metrics` key | Plan destination | Rule |
| --- | --- | --- |
| `ai_provider_cost_actual` (per period) | "Actual expenses — owner-reported, not reconciled": one row per provider and period | Actual cost, not a forecast input. Compare with the plan's `TS Monthly AI spend` instead of overwriting it |
| `ai_provider_cost_per_studio_start` | Evidence for `TS AI cost per start` | Replaces the estimate only after a measured cohort with `completeness=complete`. Record the cohort size and period |
| `fixed_subscription_cost_actual` (per vendor) | `02 — Fixed monthly budgets` committed line, for example `Open-Meteo API Standard - committed` | Keep the source currency from `original_amounts`. A USD figure needs `conversion_ref` (dated FX) or the settled card amount |
| `payment_fees_actual`, `refunds_actual` | Evidence for `TS Payment rate` and `TS Digital refund allowance` | Not available: no payment provider is integrated, and checkout is sandbox |
| `revenue_actual` | None today | Must stay absent. TicketStub has no live payments, and sandbox orders are excluded |

Product funnel counts (visits, studio starts, paid orders) are **not** finance metrics. They come from product analytics and are out of scope here.

## Manual preparation and plan handoff

1. Prepare CSV or JSON only through the configured, authorized snapshot-backed composition described in [prepared exports](./prepared-exports.md). Use the verified source scope and evidence mode; selecting `evidenceMode: live` does not prove live provider activity. Keep query/export receipts and artifact hashes. Synthetic fixtures marked `mocked` must never enter actual plan values.
2. Check every row against the "What may flow" table and its source evidence. Reject the export if a source, scope, currency, completeness or mapping precondition fails.
3. The CFO.ai business-plan owner makes any approved change in the canvas or its assistant and re-exports the native workbook. A local prepared file does not update the plan.
4. Retain a new dated evidence folder in integration-evals with the reviewed manifest/hash, resulting workbook, recalculation results and changed inputs. Do not overwrite earlier snapshots.


CSV consumers must treat any text cell beginning with `=`, `+`, `-`, `@`, a tab, a carriage return or a line feed as data, including their full-width forms and when they follow leading whitespace. The internal encoder in `src/integrations/csv.ts` (CI-08X.3) prefixes such cells with `'`; rejects the byte-order mark, C1 and bidirectional control characters, and a `sep=` directive in the first header cell (upstream must strip direction marks from right-to-left names); and writes RFC 4180 CSV with CRLF records and no byte-order mark, keeps money as exact decimals at a fixed scale and rejects amounts more precise than that scale instead of rounding them, and writes unknown values as empty cells rather than `0`. The configured `exportSummary` and rich export paths use this protected encoder.

The legacy public summary serializer retains its narrow safe allowlist and hardened text-cell encoder. The configured exporter uses typed money cells and an explicit finite proposal dictionary; unsupported metrics fail visibly. Prepared local files are not delivered CFO.ai inputs or SPN-03 evidence.

## Compatibility

`ExportRequest` and `ExportManifest` 1.0.0 shapes are unchanged. New file/receipt data is a separate Finance-owned 2.0.0 proposal described in [prepared-exports.md](./prepared-exports.md). Shared FinancialSummary 1.0.0 in package 0.3.0 remains proposal-only; Dashboard's distinct SDK pin is not changed by the accepted synthetic handoffs above. Those ACKs do not establish canonical adoption or accept later producer/API additions. Renaming a metric key after first use needs a new `definition_ref` version and an entry in [compatibility.md](./compatibility.md).


The rich `ReportingExportReceipt@2.0.0` records `projectionContentHash`,
`snapshotId`, `queryContentHash` and `snapshotEnvelopeHash`; period/timezone and
per-currency metrics stay in the document. Use these fields in the source
register instead of assuming the legacy manifest names. Do not interpret
`evidenceMode: live` as provider verification: `sourceEvidenceStatus` is
`not_exposed_by_query`. Generic expense cannot be assigned to a provider,
subscription, cohort or financial-plan input without independently reviewed
source evidence. Those specialized mapping keys above are unavailable until
such producer definitions/evidence exist. `cash_net` is explicitly unavailable
in the rich projection; no forecast, runway or cash completeness is inferred.
