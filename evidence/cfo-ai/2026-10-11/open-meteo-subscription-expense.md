# Open-Meteo subscription expense — 2026-10-11 reconciliation

The project owner reported purchasing an Open-Meteo subscription on 2026-10-11 and subsequently storing the API key locally. The [original contribution in PR #26](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/26), preserved at [head `7239d6b`](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/7239d6b303225d82cbe2c083cf12bc1427bd4cce/evidence/cfo-ai/2026-10-11/open-meteo-subscription-expense.md), records that the key field was verified as populated without reading out or retaining its value. This handoff does not recheck the key. The expense remains owner-reported, not an independently verified payment receipt or settled cash charge.

| Field | Recorded status |
| --- | --- |
| Vendor | Open-Meteo |
| Purpose | TicketStub event-weather research and commercial API access |
| Expense category | Recurring data/API subscription; fixed operating overhead |
| Purchase date | Subscription service starts 2026-10-11; receipt verification pending |
| Plan / historical API entitlement | API Standard, active per owner; historical weather is not included under current published plan terms |
| Amount and currency | EUR 29.00 per month, confirmed by owner subscription details; replaces earlier ambiguous dollar notation |
| Tax and total charged | No tax; EUR 29.00 total reported by owner |
| Billing frequency / service period | Monthly; 2026-10-11 through 2026-11-11 |
| Settlement and receipt | Purchase reported by owner; independent receipt verification and settled USD amount remain unknown |
| Integration status | Keyed customer forecast/geocoding implemented in merged PR #49; deployment key delivery and deployed behavior remain unverified by this handoff |

## CFO.ai reconciliation

The dated recurring forecast has already been reconciled in [merged PR #24](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/24), merge `f375fcf20584f5c98dbd4f3b69f884c52994224e`. Its [revision 2 evidence](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/f375fcf20584f5c98dbd4f3b69f884c52994224e/evidence/cfo-ai/2026-10-11-r2) retains the saved CFO.ai narrative, native exports and dated verification. The earlier request to update the canvas and recurring forecast is superseded by that revision; this handoff makes no new canvas edit or current native-UI verification. The original snapshot and revision 2 remain immutable dated records.

The [revision 2 source observations](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/f375fcf20584f5c98dbd4f3b69f884c52994224e/evidence/cfo-ai/2026-10-11-r2/source-observations.md) and [model](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/f375fcf20584f5c98dbd4f3b69f884c52994224e/evidence/cfo-ai/2026-10-11-r2/model.py) preserve EUR 29.00 as the source expense. The [retained ECB response](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/f375fcf20584f5c98dbd4f3b69f884c52994224e/evidence/cfo-ai/2026-10-11-r2/ecb-eurofxref-2026-10-09.xml) uses the 2026-10-09 reference rate of USD 1.1206 per EUR: EUR 29.00 × 1.1206 = **USD 32.4974, a forecast estimate only**. This is neither USD 29.00 nor a settled USD card charge.

Open-Meteo is the first identified commitment **inside the existing data/API licensing contingency**, not an additional allocation. Conservative's USD 20 contingency is exceeded by USD 12.4974, raising its fixed budget from USD 150 to **USD 162.4974**. Base's USD 40 and Growth's USD 150 contingencies already cover it, so their fixed budgets remain **USD 300 and USD 900**. Do not add the subscription again when handing this forecast to Finance.

Revision 2 separately labels actual expenses as **owner-reported, not reconciled**. A reconciled forecast and an expense evidence row do not establish authoritative Finance/cost-intelligence ingestion or settlement. The later [evidence register at the PR #24 merge](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/f375fcf20584f5c98dbd4f3b69f884c52994224e/evidence/README.md) records Finance and reliability owner acceptance of SPN-03, relayed from chat. That owner decision is not an independent payment audit; the earlier dated revision 2 prose retains its original pending-acceptance wording.

For the remaining Finance handoff, preserve original currency and no-tax owner reporting, obtain receipt/settlement evidence, and reconcile the authoritative cost-intelligence summary/export without duplicating the contingency. Actual opening cash remains unknown; do not enter unknown as zero or infer cash from the subscription. If billing later becomes annual, distinguish the actual cash charge from monthly expense allocation. Keep promotional credits separate from the underlying cost.

## Customer endpoint and plan limitation

[Main-app PR #49](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/49) merged at `2ed762b206021e02507fe58b5079076453882171`. Inspection of its [pinned research source](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/2ed762b206021e02507fe58b5079076453882171/src/app/api/research/route.ts#L266-L324) confirms:

- With the server-side key configured, forecast and geocoding URLs use the keyed customer hosts. Without it, the code uses free endpoints for evaluation.
- Weather `sourceUrl` sent to the browser is the public attribution link, rather than the keyed request URL.
- The archive path is removed. Dates more than 92 days before or 15 days after the current UTC date produce a pending fact before an Open-Meteo fetch. An in-window date still does not guarantee available data.

PR #49 reports 270 passing offline tests and live customer geocoding/forecast HTTP 200 checks. These are **author/owner-reported results**, not tests rerun by this documentation handoff, and do not prove the deployed revision, deployed key delivery or account entitlement. The [pinned operational documentation](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/2ed762b206021e02507fe58b5079076453882171/docs/operations/preview-runtime.md#L90-L111) records the remaining stub/print attribution gap.

[Official Open-Meteo pricing](https://open-meteo.com/en/pricing), checked 2026-10-11, excludes the Historical Weather API from Standard and requires Professional or higher for that API. The owner has deferred historical weather; **no upgrade is authorized**. A source-level forecast-window implementation is not acceptance of historical enrichment. Deployment key delivery to Preview/Publish, deployed verification, and attribution on digital/printed stubs remain gates before commercial launch.

Related: [getticketstub.com issue #27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27). No API key, invoice identifier, payment method or private billing details are included. This record authorizes no purchase, upgrade, deployment or acceptance change.
