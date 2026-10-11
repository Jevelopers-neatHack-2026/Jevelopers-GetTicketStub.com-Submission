# TicketStub CFO.ai business-plan evidence — 2026-10-11

**Result: actual CFO.ai business plan saved and its native financial export verified.** This is evidence for the CFO.ai business-plan item in [setup issue #27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27), not completion of the entire setup tracker, production launch, or hackathon submission.

- [Actual CFO.ai canvas](https://app.cfo.ai/completetech-83718c83/pages/7ed03e7e-ca7d-441c-b6bb-7d4e5f7efc94) — requires existing workspace access; no public sharing enabled.
- [Native CFO.ai workbook](cfo-native-export.xlsx) — sanitized, editable financial tables exported by CFO.ai; dated snapshot of Main Scenario.
- [Saved canvas narrative](cfo-canvas-narrative.txt) — actual saved narrative and visible source links captured through the browser.
- [Canvas screenshot](cfo-canvas-overview.jpg) — actual saved plan and simulator.
- [Supporting assumptions and product evidence](assumptions-and-plan.md), [source observations](source-observations.md), [calculated tables](calculated-tables.md).
- [Independent calculation script](model.py), [machine-readable results](model-results.json), [monthly scenario CSV](monthly-scenarios.csv).
- [Native-export verification](export-verification.json) and [reproducible verifier](verify-native-export.py).
- [SHA-256 manifest](SHA256SUMS) records the retained files.

## What was verified

The existing Welcome work was preserved. A separate TicketStub canvas was created through CFO.ai's signed-in supported chat/canvas workflow. It contains a sourced business narrative, editable assumptions and financial tables, separate Conservative and Growth futures, scenario comparison, digital unit economics, sensitivity, conditional physical economics, operating budgets, cash/runway and a preview simulator. The assistant checked isolated input propagation and removed its temporary validation case. Simulator sliders are previews; native assumptions/tables are the editable source. Static narrative and exports require refresh after assumptions change.

| Required coverage | Evidence |
| --- | --- |
| Product, customers, revenue model and current implementation | Saved narrative; public repository pins below; demo/sandbox status explicit |
| Digital $9 / Card $29 / Print $49 / Framed $89, estimated shipping | Native assumptions and narrative; physical revenue excluded from forecast |
| Research, chat, image generation and revisions | Per-start token estimates, vendor rates, abandoned-studio allocation, funding allowance |
| Printing, shipping, fees, support/refund and overhead | Digital and conditional physical tables; fixed budget categories |
| Contribution, operating costs, break-even, cash/runway | Native linked tables and monthly prelaunch/postlaunch cash forecasts |
| Conservative / Base / Growth, conversion/volume/usage/fulfillment sensitivity | Native scenarios, comparison and sensitivity tables; independent checkpoints |
| Measured versus vendor versus estimated versus unknown | Narrative and dated source register; actual costs/revenue unknown |
| Credits and prize treatment | Sustainable full costs retained; credits separate noncash; expected prize cash zero |
| Sanitized submission evidence | Native workbook, saved narrative, screenshot and reproducible calculations in this folder |

Native workbook: nine sheets, 1,121 formula cells. Independent read-only XML extraction compared cached scenario economics, sensitivities, physical margins and cash results to Python calculations at absolute tolerance 1e-8. No cached formula-error cells, macros or external workbook links were found. Formula traces and date-derived prelaunch duration were inspected. Desktop Excel recalculation and workbook visual layout were not independently tested; this limitation is recorded rather than claiming an unperformed check. See the verification JSON for exact checks.

Postlaunch Base: 10,000 visits/month, 10% studio starts, 2% visit-to-paid conversion, 200 $9 orders. All 1,000 starts incur estimated AI costs, including abandonment. Contribution is $6.51405/order; monthly operating result is $702.81 before founder pay, or -$2,297.19 with $3,000 pay. Scaling-volume break-even is 93 orders/month before founder pay, 553 with pay, holding funnel economics constant. These are projections, not actual revenue.

Opening cash is unknown. The user authorized best guesses: $1,000 illustrative opening cash, $0 founder pay, alternatives $0/$5,000 cash and $3,000 pay. A hypothetical October–December 2026 prelaunch period burns $600/month before founder pay, with zero revenue. $1,000 therefore runs out before the hypothetical January 2027 launch. Base funding for three prelaunch plus six postlaunch months and launch reserve is $2,416.011 before founder pay, $25,199.151 with $3,000 monthly pay. Negative cash is shown, not hidden or treated as financed.

## Source revisions and provenance

| Repository | Inspected local HEAD |
| --- | --- |
| getticketstub.com | `660cc5e0c92e0e338fe6d75db445c737c8fdfc10` |
| cost-intelligence | `d5a51894e8987cef078583ef63692f38eb265593` |
| fulfillment-connectors | `a710358e93370681eadd2615e1dd4fdc0cd6cc12` |
| creative-engine | `5ab7f0ede215e62f6ddb5ef3472a2dc8e55cbc74` |
| agent-harness | `c3a4960ee40b9bba46a0072255c2122a3bd75b55` |
| integration-evals baseline | `ff1f6d2df816ebbff34742f51be728fcb5c28cb5` |

Main product PR #20 was open/unmerged when checked (head `7adf30881ecf66ef264a1710436515c1ff4d964b`); proposed changes are not treated as main acceptance. Vendor snapshots are unauthenticated public metadata, not generation calls or billing records. Source dates/URLs and evidence classes are in the supporting assumptions and source observations. A supplied Conservative reserve checkpoint was corrected by $0.008 to $581.3446667, consistent with the actual formula.

## Remaining assumptions and acceptance boundaries

Actual opening cash, paid demand/conversion, billed usage, taxes/entity/payment eligibility, production operating bills, founder labor burden, paid-data rights and launch dates remain unvalidated. Physical fulfillment requires supplier/SKU/spec/quote validation and is excluded from sales forecasts. Text/image model IDs and token usage must match the eventual production configuration; the current dated rate benchmark does not prove production compatibility. Prototype sales are simulated. Production launch and supplier purchases are not authorized by this evidence.

No credentials, billing details, customer records, private account balances or raw account/chat dumps are retained. No financial accounts were connected, credits purchased, subscription reactivated or public CFO.ai sharing enabled. Existing canceled trial access ends October 25, 2026 per the user; the retained export is independent of continued workspace access.

Finance/reliability and integration-evals owners can review this evidence against SPN-03. The master acceptance checklist remains unchanged pending owner review. Final hackathon entry submission and demo-video inclusion remain separate tasks.
