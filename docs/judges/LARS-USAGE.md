# Lars: supplied AI usage report

[Back to evidence](EVIDENCE.md) · [Timothy's report](USAGE.md) · [Crystal's ledger](CRYSTAL-USAGE.md) · [Zach's pasted table](ZACH-USAGE.md)

**Source:** report text pasted by the team and attributed to **Lars** on October 12, 2026. Attribution is team-supplied. No original dashboard, call ledger, database, or reproduction scripts accompanied this message. The checks below verify the pasted numbers, not the original logs.

## Scope and totals

The report covers a local hackathon workspace, **including preparation, October 8–12, 2026**, in **America/Chicago**. Its cutoff is **October 12 at 4:26:59 p.m. CDT** (21:26:59 UTC). It says the audit thread was excluded.

**5,716 model calls · 1,198,266,955 tokens · $359.71 estimated API value**

Tokens are small pieces of text processed by a model. API value estimates what the recorded work would cost at listed usage rates. It is not a bill or measured subscription spending.

| Model, as reported | Calls | Tokens | Estimated API value |
| --- | ---: | ---: | ---: |
| Claude Opus 5.5 | 3,060 | 857,429,912 | $291.57 |
| Claude Sonnet 5.5 | 2,476 | 324,567,775 | $64.30 |
| GPT-6.1 Sol (Codex) | 82 | 12,197,632 | $3.20 |
| Claude Haiku 4.5 | 81 | 3,156,317 | $0.61 |
| Claude Haiku 5.5 | 17 | 915,319 | $0.03 |
| **Total** | **5,716** | **1,198,266,955** | **$359.71** |

| Token category | Tokens |
| --- | ---: |
| Cached prompt reads: reused input | 1,170,789,679 |
| Fresh input | 573,937 |
| Cache writes: input stored for reuse | 23,904,289 |
| Output, including reasoning | 2,999,050 |

The output includes **626,758 reasoning tokens**; do not add them again. Cached reads are **98.0% of prompt tokens**, rounded from 97.952%. The denominator includes cached reads, fresh input, and cache writes. Repeated reads are not unique words or new output.

## Usage by local date

| Date in Chicago | Calls | Tokens |
| --- | ---: | ---: |
| October 8 | 40 | 3,240,392 |
| October 9 | 139 | 30,781,296 |
| October 10 | 2,645 | 482,034,460 |
| October 11 | 1,736 | 316,000,710 |
| October 12 | 1,156 | 366,210,097 |

**Arithmetic checked:** both tables match the headline call and token totals. Token categories also match. The displayed model prices add to $359.71.

The report estimates **$4,147.16 without caching** and a **$3,787.46 caching reduction**. Subtracting the displayed rounded amounts gives **$3,787.45**, one cent less. This may reflect rounding of underlying amounts, but those amounts were not supplied. The reported figure is preserved here with the difference noted. Neither figure establishes actual money saved.

## Producer-reported checks

These are claims in the supplied report, not checks rerun for this submission:

- Selection used 114 source files. Other projects and the audit were excluded. The C: Codex directory resolved to the H: store and was counted once.
- Claude Code used three main sessions and 108 logged child agents, with 3,949 subagent calls. Codex supplied 82 calls; no forked Codex sessions matched the workspace.
- Repeated Claude messages were grouped by message ID. Input and cache fields agreed. The last nondecreasing completed output before cutoff corrected 895 messages, adding 1,512,049 output tokens over the first-record parser. One synthetic or zero-usage row was excluded.
- Codex's per-call sum matched its native `state_5.sqlite` counter: 12,197,632 tokens.
- A second ingest added zero events and skipped all 5,716 existing events. Skill fixtures and store checks passed in a fresh checkout. A prior snapshot was retained separately.

The producer assigns high confidence to counts within selected logs and medium confidence to coverage. Coverage excludes teammates, remote or WSL sessions, web chats, image generation, external service calls, and deployed app usage without local coding-tool records. Claude's global total cannot validate this project-only slice.

## Sources and reproduction limits

The report names [AI Usage Ledger skill 1.6.0](https://github.com/CompleteTech-LLC/ai-usage-ledger-skill), commit `e9d5e225a802d8eddcc7e1a2fc72cded6db1437e`. It cites [OpenAI pricing](https://developers.openai.com/api/docs/pricing) and [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), reportedly checked October 12. These public pages were accessible during preparation; that does not verify this report's rate selection or calculations.

Named inputs and scripts were **not supplied**: `compiled/all_events.csv`, `ledger.sqlite`, `scope.json`, `correction.json`, `pricing.json`, `scan_scoped.py`, `reconcile_and_prepare.py`, and `deliver.py`. The producer says they select files, reconcile streamed output, check duplicate ingest, and verify prices and totals. The reviewed `NeatHack-dashboard.html` was also not supplied.

The report says pricing includes per-call context tiers and cache storage durations. Actual charges, Claude billing plan, subscription allocation, taxes, and speed or region premiums remain unknown. The upstream template's subscription and account-attribution assumptions do not apply to this focused report.

Preparation predates the event, and the cutoff is later than the website deadline. [Final deadline and eligibility remain unverified](RULES-CHECKLIST.md); Discord updates control. Keep this report separate from other team reports. Overlap has not been checked, and no combined team total is claimed.
