# Dated source observations — revision 2

Checked 2026-10-11 between 17:55 and 18:25 UTC. These observations supplement the original [2026-10-11 source observations](../2026-10-11/source-observations.md), which remain unchanged.

## Current TicketStub behavior (main `8afdefd40c9faf912e4a50a6a532fff0b5e480b2`)

This is an inspected revision, not an accepted release. The original plan pinned `660cc5e0c92e0e338fe6d75db445c737c8fdfc10`. Since then, PRs #20, #28, #29, #31, #32, #33, #35 and #36 have merged.

| Plan claim | Current main | Status |
| --- | --- | --- |
| Digital $9, Card $29, Print $49, Framed $89; $6 shipping estimate on physical carts | `src/customer/studio/types.ts:80-84`; `SHIPPING_ESTIMATE_MINOR = 600` in `src/customer/pages/commerce.ts:57` | Holds |
| Physical variants are not orderable | `capabilities.ts:189` `"Preview, not yet orderable"`. Every Card/Print/Framed variant has `sku: null`. The live-mode gate at `capabilities.ts:254` reads "This is a preview. We haven't confirmed a printer SKU for it yet, so it can't be ordered." The server also enforces this in `src/app/api/orders/route.ts`. getticketstub.com#23 is open, with no confirmed SKU. | Holds |
| Checkout is sandbox; no revenue | `commerce.ts:2` "Nothing here calls a payment, print or shipping API." `SANDBOX_LABEL = "Sandbox · no real charge"`. Orders are recorded with `mode: "sandbox"`. No payment-provider dependency exists. | Holds |
| Foil +$6, holo +$9 excluded from revenue | Holo is no longer charged (`commerce.ts:128`) and is labelled "Screen effect · not printed" (`capabilities.ts:136,193`). Foil applies only to physical previews. | Exclusion holds; narrative updated |
| Main disables external calls by default; PR20 separate | PR #20 merged 2026-10-11 (`ef4da79`). `https://getticketstub.com/api/health` returned `{"mode":"live","storage":"ok","persistence":"configured"}` at 18:20:38Z. | **Stale.** Live AI calls can now incur real cost while no revenue is collected. Narrative updated. |
| Output caps 600 research / 300 chat; direct defaults `gpt-image-1`, `claude-sonnet-5-5` | `src/app/api/research/route.ts:282`, `src/app/api/agent/route.ts:39`, `src/server/ai/providers.ts:41` | Holds |
| Commercial weather licensing unknown | Research geocodes through Open-Meteo's free geocoding API (`route.ts:237`). It uses `archive-api.open-meteo.com/v1/archive` for events more than 60 days old, otherwise the free forecast API (`route.ts:249`). No key and no customer endpoint are used. | **Changed.** The owner bought API Standard (EUR 29/month), which is not integrated and excludes historical weather. This is now an explicit launch gate. |

## Actual expenses (owner-reported, not reconciled)

- **Open-Meteo API Standard.** EUR 29.00/month, no tax, service period 2026-10-11 to 2026-11-11, per the owner ([integration-evals PR #26](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/26) and [getticketstub.com#27 comment](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27#issuecomment-6110613162)). The payment receipt has not been independently verified, and the settled USD card amount is unknown. The [official pricing page](https://open-meteo.com/en/pricing) states that historical weather requires Professional or higher.
- **FX.** [ECB euro foreign exchange reference rates](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml), fetched 2026-10-11 17:56:43Z. The latest reference date is 2026-10-09, with USD 1.1206 per EUR. The response is retained as `ecb-eurofxref-2026-10-09.xml` with SHA-256 `cf79007a1de55aea7158681ed3731e72ae15f80a92a916d7e0eb32f5640142cd`. EUR 29.00 × 1.1206 = USD 32.4974, an estimate only.
- **OpenRouter image smoke test.** [creative-engine#37](https://github.com/Jevelopers-neatHack-2026/creative-engine/issues/37#issuecomment-6111863983) records two authorized requests on 2026-10-11 with `openai/gpt-image-2.5-sunburst`, quality low, 1024×1024. The reported costs were $0.006005 for a generation (196 output tokens) and $0.014252 for a reference edit, $0.020257 in total. These are provider-reported and unsettled. This is one sample on a different model and quality from the planning benchmark, so the $0.12075/generation estimate is retained. A successful configuration is not proof of production unit economics.

Double-counting control: Open-Meteo is weather/data licensing, which is what the existing "Data and API licensing contingency" was budgeted for. It is therefore entered as the first identified commitment inside that line, not as an additional cost. The Base ($40) and Growth ($150) contingencies already cover it, so their fixed totals are unchanged. The Conservative contingency was $20, so Conservative fixed rises by $12.4974 to $162.4974. The OpenRouter smoke-test usage stays outside the recurring forecast because per-start inference is already modeled.

## Official hackathon requirements (re-read 2026-10-11)

From [neatlogs.com/hackathon](https://neatlogs.com/hackathon):
- Use cfo.ai to plan the agent's pricing, costs, revenue and runway, and include the resulting business plan in the submission.
- Judges must be able to check each claim against evidence.
- The repository must be public and contain hackathon-dated commits.
- The demo video is scored on how clearly it explains the agent and the use of neatlogs, Entire and cfo.ai.
- Submit by quoting the official neatlogs post with team, name, project, public repo and demo.
- The planned close is Monday 12 October 2026, 7:00–11:55 PM IST. The final cutoff is announced on Discord.

The [hackathon skill](https://neatlogs.com/hackathon/skill) repeats that the business plan belongs in the submission and that the demo should explain all three tools. It also asks for no private data or fabricated results, and states that it does not set contest rules.

The private CFO.ai canvas requires workspace login, and page-level private-audience controls are disabled in the workspace. Judges therefore rely on the public repository evidence: the native export, narrative, screenshot and verification files. No public CFO.ai share link was created.

## CFO.ai workspace

The existing signed-in browser session opened the canvas on 2026-10-11 without any billing interaction. The live narrative before revision 2 matched the retained `../2026-10-11/cfo-canvas-narrative.txt`. Revision 2 edits were made through the existing "TicketStub Business Plan Canvas" chat on the same page, `7ed03e7e-ca7d-441c-b6bb-7d4e5f7efc94`. No new page, sharing, connection, purchase or billing change was made, and the Welcome chat was not touched.
