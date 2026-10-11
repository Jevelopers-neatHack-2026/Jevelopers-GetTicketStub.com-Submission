# CFO.ai input mapping and export handoff (CI-08X.4)

This document defines how a finance export will feed the TicketStub CFO.ai business plan. It is a **manual handoff**: no CFO.ai connector exists, none is required, and `exportSummary` stays a typed unavailable operation until CI-08X.1–.3 land.

| Item | State, 2026-10-11 |
| --- | --- |
| CI-08X.4: manual mapping, consumer role, plan reference | **This document** |
| CI-08X.1–.3: versioned JSON/CSV export, reconciliation to CI-08, sanitizing serializer | Blocked by [CI-08 #2](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/2) (query/aggregation API not implemented), [CI-09 #8](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/8) (in progress, PR #22) and [SC-06C](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/13) (FinancialSummary projection) |
| SPN-03 (actual CFO.ai plan) | Verified separately in integration-evals, not by this issue |

## Consumer and plan reference

- **Consumer role:** the CFO.ai business-plan owner, in the Finance and reliability role. The owner is CompleteDotTech (confirmed 2026-10-11). This repository does not author or edit the plan.
- **Plan:** the TicketStub CFO.ai canvas, page `7ed03e7e-ca7d-441c-b6bb-7d4e5f7efc94`. Workspace login is required and the page is not publicly shared. The canvas access ends 2026-10-25 per the owner.
- **Sanitized plan reference** (public, immutable): [integration-evals `f375fcf`, `evidence/cfo-ai/2026-10-11-r2/`](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/f375fcf20584f5c98dbd4f3b69f884c52994224e/evidence/cfo-ai/2026-10-11-r2). It contains the reviewer workbook `cfo-native-export.xlsx`; Main-scenario inputs are entered in sheet `01 — Editable assumptions — USD`, cells `B5`, `B6`, `B7`, `B10`, `B32` and `B34`.

Replace the reference above with a newer immutable revision whenever the plan is re-exported. Never link a mutable branch.

## What may flow into the plan

Only a `FinancialSummary` from an export manifest with all of the following:

| Field | Required value | Why |
| --- | --- | --- |
| `environment` / `included_environments` | `production` only | Development and test spend is not business cost |
| `billing_mode` / `included_billing_modes` | `live` only | `sandbox` and `simulated` amounts are never actual revenue or cost (master FIN-09, FIN-10) |
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

## Manual procedure, once `exportSummary` is available

1. Request a CSV or JSON export with `destination: "cfo.ai"`, `evidenceMode: "live"`, and the production/live scope. Keep the manifest.
2. Check every row against the "What may flow" table. Reject the export if any of those preconditions fails.
3. Make the edits in the CFO.ai canvas or its assistant, never in the reviewer workbook alone, then re-export the native workbook.
4. Retain a new dated evidence folder in integration-evals with the manifest hash, the new workbook, recalculation results and the changed inputs. Do not overwrite earlier snapshots.

CSV consumers must treat any text cell beginning with `=`, `+`, `-`, `@`, a tab or a carriage return as data. CI-08X.3 will prefix such cells with `'` before export.

## Compatibility

This document adds no schema, and the `ExportRequest` and `ExportManifest` 1.0.0 shapes are unchanged. Renaming a metric key after first use needs a new `definition_ref` version and an entry in [compatibility.md](./compatibility.md).
