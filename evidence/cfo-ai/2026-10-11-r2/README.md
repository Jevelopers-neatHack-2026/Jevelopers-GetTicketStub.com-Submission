# TicketStub CFO.ai business plan — revision 2 (2026-10-11 review)

**Result:** revision 2 corrects three workbook defects, adds the owner-confirmed Open-Meteo expense and reconciles the narrative with current TicketStub behavior. The repairs were made in the existing CFO.ai canvas, re-exported natively, and independently verified in desktop Microsoft Excel. The original evidence in [`../2026-10-11/`](../2026-10-11/README.md) is retained unchanged; this folder supersedes it as the current plan reference.

This is agent-prepared evidence. It is **not** Finance/reliability owner acceptance of SPN-03, and it does not record a hackathon submission.

- [Actual CFO.ai canvas](https://app.cfo.ai/completetech-83718c83/pages/7ed03e7e-ca7d-441c-b6bb-7d4e5f7efc94): same page as the original, workspace login required, no public sharing.
- **[Reviewer workbook](cfo-native-export.xlsx)** (`TicketStub-Revision-2-Final-Native-Repaired.xlsx`, delivered by CFO.ai). This is the current plan workbook. It is the CFO.ai export with four opening-cash passthrough formulas made blank-safe by the CFO.ai assistant (`Model inputs!B69, C72, B74, B76`: `=01!B34` became `=IF(01!B34="","",01!B34)`). All cached values are identical to the generic export. The exact difference is in [export-postprocessing-diff.json](export-postprocessing-diff.json).
- [Generic native export](cfo-native-export-generic.xlsx): the unmodified export from the canvas, retained for provenance. CFO.ai's exporter still writes those four links in a blank-coercing form, so in this file a blank opening cash shows Conservative/Growth as UNFUNDED LAUNCH. That residual is recorded in [its Excel result](excel-verification-generic-export.json). Use the reviewer workbook for input editing.
- [Saved canvas narrative](cfo-canvas-narrative.md) (CFO.ai's Markdown copy of the saved page) and [canvas screenshot](cfo-canvas-overview.jpg).
- [Independent model](model.py), [results](model-results.json), [tables](calculated-tables.md), [scenario CSV](monthly-scenarios.csv).
- [Stdlib export verifier](verify-native-export.py) with results for the [reviewer workbook](export-verification.json) and the [generic export](export-verification-generic-export.json).
- [Desktop Excel recalculation and input-change check](excel-recalc-check.py) with results for the [reviewer workbook](excel-verification.json), the [generic export](excel-verification-generic-export.json) and the [original export](original-export-excel-check.json).
- [Dated source observations](source-observations.md) and the [ECB reference-rate response](ecb-eurofxref-2026-10-09.xml).
- [Verification record](VERIFICATION.md) and [SHA-256 manifest](SHA256SUMS).

The saved narrative labels the live-mode, Open-Meteo archive-endpoint and ECB-rate facts as owner-supplied and not reverified. That labeling is conservative. This repository verifies them independently: see the `/api/health` response, the `8afdefd` file and line references, and the retained ECB response in [source observations](source-observations.md).

## Review verdict

The original plan's arithmetic was correct. Desktop Excel 16.113.4 recalculated all 1,663 cells of the original export identically to its cached values, with no errors. That closes the original "desktop recalculation not run" limitation. The original did have the robustness and labeling defects Finance reported, and part of its implementation narrative had gone stale.

| Finding | Original behavior (native Excel) | Revision 2 |
| --- | --- | --- |
| CFO-001: zero paid conversion or zero traffic | 74 `#VALUE!` cells. Contribution, profit, burn and funding all failed. | Aggregates computed directly. At zero conversion: contribution −$308.99, profit −$908.99, burn $908.99, reserve $572.0977, six-month need $6,026.0377. At zero traffic: profit −$600, six-month need $4,100. Per-order metrics and break-even show n/a. |
| CFO-002: advertised inputs did not drive the model | Changing `01!B7` or `01!B33` had no effect (`04` held the drivers). | Table 01 is the single entry point: `01!B5` visits, `B6` start rate, `B7` paid conversion, `B10` chats, `B32` marketing, `B34` opening cash. Each was edited in Excel and propagates; for example `B7`=1% gives 100 orders and −$103.09. |
| CFO-003: unknown opening cash appeared funded | Blank cash showed "Reserve funded" and October cash of −$600. | In the reviewer workbook, blank or `""` cash shows "Opening cash unknown" in Base, Conservative and Growth, with gaps, runway and cash balances blank. Explicit 0 shows UNFUNDED LAUNCH, with Base October cash −$600 and a launch gap of $616.011. In the generic export, blank cash still coerces Conservative/Growth to 0 (exporter limitation, documented above). |
| Launch-status wording (new) | With $1,000 the status read "Reserve funded" although Base cash is −$800 at the hypothetical launch. | At $1,000, all scenarios read "Opening cash covers reserve only; ramp unfunded". At $10,000, all three read "Reserve funded; ramp funded". The narrative states that runway is measured from opening cash and ignores prelaunch burn. |
| Open-Meteo actual expense (new) | Not present. | EUR 29.00/month is kept as the source amount, converted at USD 32.4974 (ECB 2026-10-09, estimate). It is placed inside the existing data/API contingency. Conservative fixed rises from $150 to $162.4974; Base and Growth totals are unchanged. A separate "actual expenses — owner-reported, not reconciled" table was added. |
| Implementation narrative (stale) | Pinned to `660cc5e`: "external calls disabled", "PR20 separate". | Now pinned to main `8afdefd`. The site reports live mode, so AI cost can occur with no revenue. Checkout is sandbox, physical variants are "Preview, not yet orderable", and holo is no longer charged. Open-Meteo archive use conflicts with the Standard plan. |

## Revision 2 results (USD, hypothetical forecasts, not actual sales)

| Metric | Conservative | Base | Growth |
| --- | ---: | ---: | ---: |
| Fixed budget / marketing | 162.4974 / 100 | 300 / 300 | 900 / 1,500 |
| Orders / revenue | 50 / 450 | 200 / 1,800 | 1,000 / 9,000 |
| AI per order (all starts, incl. abandoned) | 6.0314 | 1.54495 | 0.58863 |
| Contribution per order | 2.0276 | 6.51405 | 7.47037 |
| Operating profit (no founder pay) | −161.1174 | 702.81 | 5,070.3688 |
| Operating profit ($3,000 founder pay) | −3,161.1174 | −2,297.19 | 2,070.3688 |
| Break-even orders (no pay / with pay) | 130 / 1,610 | 93 / 553 | 322 / 723 |
| Launch reserve | 581.3447 | 616.011 | 856.914 |
| Six-month need (no pay / with pay) | 1,548.0491 / 19,548.0491 | 616.011 / 14,399.151 | 856.914 / 856.914 |
| 3 prelaunch + 6 postlaunch ramp (no pay / with pay) | 2,335.5413 / 29,335.5413 | 2,416.011 / 25,199.151 | 8,056.914 / 17,056.914 |

The $1,000 opening cash is hypothetical, and actual cash is unknown. On that assumption Base cash runs −$800 by the hypothetical January 2027 launch, leaving a ramp funding gap of $1,416.011 without founder pay and $24,199.151 with it. Physical revenue is excluded in every scenario. The conditional physical economics (Card/Print/Framed contribution $17.89/$26.31/$35.15 at Base AI/order) are unchanged and remain unquoted hypotheses.

Evidence classes are unchanged:
- **Measured revenue:** none. Sandbox checkout is not revenue.
- **Actual expenses (owner-reported, unreconciled):** Open-Meteo EUR 29.00; OpenRouter smoke test $0.020257.
- **Public vendor rates:** OpenRouter, Stripe benchmark, ECB FX.
- **Estimates:** traffic, conversion, tokens, budgets, physical costs, reserve.
- **Unknown:** actual cash, taxes/entity, billed production usage, supplier SKUs and quotes.

## Verification performed

See [`VERIFICATION.md`](VERIFICATION.md) for exact commands, results, hashes and component revisions.

## Remaining limitations and gates

- **Finance/reliability owner acceptance of SPN-03 is pending.** The owner role is "Finance and reliability". No named person has been confirmed, and the earlier Finance REQUEST_CHANGES must be re-reviewed against this revision.
- Actual opening cash, demand, conversion, billed usage, taxes/entity/payment eligibility and production delivery remain unvalidated. Neither the Open-Meteo receipt nor the settled USD amount has been verified.
- Physical sales require a confirmed supplier SKU, quote and production authorization; none exists.
- Open-Meteo commercial use requires integrating the keyed customer endpoint and either disabling historical enrichment or licensing it. No upgrade is authorized.
- CFO.ai's generic exporter still writes blank-coercing inherited links. Any future re-export must be re-checked with `excel-recalc-check.py`, or receive the same four-formula guard.
- CFO.ai access is the canceled trial ending 2026-10-25, per the owner. The retained export does not depend on continued access.

## Submission and demo reference

Official requirement ([neatlogs.com/hackathon](https://neatlogs.com/hackathon)): include the cfo.ai business plan covering pricing, costs, revenue and runway in the submission, and cover cfo.ai in the demo video. Reviewers without workspace access should use these public, immutable references:

- **Business plan:** this folder at the pinned integration-evals commit recorded in the PR #24 review comment. Start with this README, [the narrative](cfo-canvas-narrative.md), [the reviewer workbook](cfo-native-export.xlsx) and [the screenshot](cfo-canvas-overview.jpg).
- **Demo coverage (suggested, about 60–90 seconds):**
  1. Open the saved canvas and show the revision 2 header.
  2. Change paid conversion (`01!B7`, or the simulator slider as a preview) and show profit move from $702.81 to −$103.09 at 1%.
  3. Show the funding shortfall: $1,000 hypothetical cash, −$800 at launch, a $1,416.01 ramp gap.
  4. Compare the Conservative, Base and Growth scenarios.
  5. Show the separate actual-expenses table.
  Do not present sandbox checkout as revenue, physical variants as orderable, or the AI smoke test as production unit economics.
- **Not done here:** the quote-post submission, the demo recording and any public CFO.ai sharing. These are the team's actions.
- The hackathon submission (quote post, demo video with CFO.ai coverage) is the team's separate action and has not been performed.
