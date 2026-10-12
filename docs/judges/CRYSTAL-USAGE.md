# Crystal (lajefa): supplied usage ledger

[Back to evidence](EVIDENCE.md) · [Timothy's separate report](USAGE.md)

**Source:** ledger text pasted by the team on October 12, 2026. The team identified it as Crystal's usage and supplied the credit **lajefa**. No original report file, public report URL, raw logs, account mapping file, or payment records were provided with the text. This page is a summary of that supplied text, not an independent audit.

The pasted report is titled **GetTicketStub — AI Usage Ledger**. It says it was generated on **October 12 at 17:55 UTC** and covers **May 19–October 12, 2026**. Much of that window predates neatHack. It is not a hackathon-only usage total.

## Reported totals

| Measure | Supplied value |
| --- | --- |
| Tokens processed | 128,391,680 (128.4 million) |
| Model calls | 1,137 |
| Sessions | 24 |
| Active days | 17 |
| Output tokens | 590.8 thousand, including 41.8 thousand reasoning tokens |
| Value at API list prices | $87.11 USD |
| Subscription amount labeled as paid | $80.00 USD: four months at $20 |

Tokens are small pieces of text processed by a model. Reused input makes up most of this total. The ledger reports a **97.3% Claude Code prompt-cache hit rate**: the share of input read from a cache of earlier work. This is not the same measure as the share of all tokens shown in Timothy's report.

The tool table assigns 1,136 calls and 23 sessions to Claude Code. It assigns one call, one session, and 508 output tokens to Copilot CLI. Those call and session totals reconcile to the headline. The pasted text also reports zero captured typed prompts; this does not prove that no person guided the work.

## Cost and evidence limits

The $87.11 figure is an API-price estimate. The $80 subscription total is a claim in the supplied report, not a verified bill. Its account labels are placeholders; the text says 13 of 14 account rules have less than high confidence. Attribution to Crystal comes from the team, not those account labels.

The report labels $7.11 as subscription savings and $492.18 as caching savings. These compare estimated prices under different billing assumptions. They do not establish money actually saved, a reconciled project expense, or a return on investment. A shared subscription may also cover other work.

The ledger warns that retained Claude transcripts may be incomplete. Its scan inventory lists 1,142 Claude records found, but the final table includes 1,136 calls. The pasted text does not explain that six-record gap. We did not inspect the scanner or reproduce its exclusions.

October's figures cover the month through October 12, not just the event window. The listed project and host labels are anonymized. Exact repository and event-period attribution remain unverified.

Keep this report separate from Timothy's. Their date ranges and methods differ, and overlap has not been checked. Neither token volume nor API-price estimates prove a complete live customer task. The [official requirement statuses](RULES-CHECKLIST.md) remain unchanged.
