# Timothy Wayne Gregg's coding-agent usage

[Back to evidence](EVIDENCE.md) · [Latest report (PDF, 198 pages, 580 KB)](../assets/submission/timothy-wayne-gregg-token-usage-2026-10-12-173441.pdf)

**Attribution:** Timothy Wayne Gregg (`completedottech`) supplied this report and identified it as his token usage on October 12, 2026. That identity comes from his statement. The report itself uses local account labels and says identity confidence is low. Its Jevelopers title does not make these totals team-wide.

Tokens are small pieces of text processed by a model. These records describe local coding-agent work assigned to the project. They do not measure customer use of TicketStub.

## Explore the report

- **[Complete report and CSVs (ZIP, 32.2 MB)](../assets/submission/timothy-wayne-gregg-usage-2026-10-12-173441.zip):** download and unzip, then open `exhaustive/report.html` in a browser. Search each table or click a column heading to sort it. CSV links work within this extracted folder.
- **[Searchable HTML file (646 KB)](../assets/submission/timothy-wayne-gregg-usage-2026-10-12-173441.html):** GitHub displays source code, not the interactive report. Download the file to use its table filters. Its CSV links require the ZIP's folder structure.
- **[Designed PDF (198 pages)](../assets/submission/timothy-wayne-gregg-token-usage-2026-10-12-173441.pdf):** charts, clickable navigation, and 43 sections, including session and source-file breakdowns.

These are the same snapshot through October 12 at 5:35 p.m. Eastern. The ZIP includes the PDF, HTML, event-level CSVs, summary tables, saved prices, scope notes, and file hashes. It contains local paths and session IDs. It contains derived usage records, not original conversation transcripts. Its README also mentions a separate native dashboard that is not included; use `exhaustive/report.html` here.

## What the report records

The window runs from **October 10 at 6:09:05 a.m. to October 12 at 5:35:05 p.m., Eastern time (UTC−04:00)**. This is a saved snapshot of active logs. It extends beyond the website cutoff recorded in the [rules checklist](RULES-CHECKLIST.md); the controlling Discord deadline remains unverified. Do not treat the full window as confirmed event-eligible work.

| Measure | Reported value | PDF page |
| --- | --- | --- |
| Tokens processed | 28.34 billion | 1 |
| Usage records | 209,611 | 1 |
| Cached reads: earlier input used again | 27,538,662,327 tokens; 97.1849% of all tokens | 182 |
| Output tokens | 134,877,701 | 182 |
| Recorded session IDs | 753 | 3 |
| Estimated value at API prices | $8,529.66 USD | 1 |

The four non-overlapping token categories on page 182 add to **28,336,367,703**. Reasoning is already part of output. The two cache-write time groups are already part of cache writes. Adding either again would overcount.

Page 6 separates 194,614 Codex records and 14,997 Claude Code records. Together they match the cover total. A usage record is not proof of a separate completed task. Session IDs are not a count of agents or people.

## How to read the estimate

The dollar figure applies a saved October 11 price table to recorded tokens. It is **an estimate, not an invoice, subscription charge, or confirmed expense**. Some model rates are assumed; priority and regional price premiums are excluded. See pages 195–198. We did not recheck those prices or rebuild the estimate from raw logs.

Repeated input makes up most of the token count. More tokens alone do not prove better work, faster work, or money saved. This report does not settle the business plan's expense questions.

## What remains uncertain

- Other users, machines, and remote runtime calls are outside the stated scope. Mixed-project sessions may need manual review. Page 198 separates workspace evidence from task or parent-session inference.
- Four Codex sessions differ from database counters by more than 2% (page 190). Claude's older stats cache cannot check this window (page 191).
- Pages 191–192 explain excluded records and limits. The companion CSVs are now supplied and their totals were checked as described below. Original logs and the producer's ingestion rules were not independently audited.
- This later snapshot does not independently audit the earlier Day 2 post. Do not add their overlapping totals together.
- Usage records do not establish code authorship, event eligibility, or a complete live customer result. See the [rules checklist](RULES-CHECKLIST.md).

## Earlier snapshots

The [earlier supplied PDF](../assets/submission/timothy-wayne-gregg-token-usage-2026-10-12.pdf), through 1:52:27 p.m., is retained for history. It reported 28.28 billion tokens and 209,218 records. The latest report supersedes it; do not add overlapping snapshots together. Crystal’s [separate ledger](CRYSTAL-USAGE.md) has a different date range and evidence source. No combined team total is claimed.

The **2:34 p.m. prior snapshot** remains available as [PDF](../assets/submission/timothy-wayne-gregg-token-usage-2026-10-12-143507.pdf), [HTML](../assets/submission/timothy-wayne-gregg-usage-2026-10-12-143507.html), and [complete ZIP](../assets/submission/timothy-wayne-gregg-usage-2026-10-12-143507.zip). It reported 209,429 records and 28,316,587,424 tokens. The latest snapshot has 182 more records and 19,780,279 more tokens; these are changes between snapshots, not additional independent totals.

## File integrity

All three supplied PDFs are retained unchanged. The latest source filename ends in `20261012-173441-designed-report.pdf`. Its filename now identifies Timothy; the report's internal title is preserved. [The asset manifest](../assets/submission/ASSET-MANIFEST.json) records its size and SHA-256 file fingerprint.

We checked the cited text, visually inspected the latest cover, token breakdown, and scope page, and scanned all extracted text for secrets. The PDF contains local workspace paths and session IDs, but no embedded files or JavaScript. No raw logs or private checkpoint contents were added.

The HTML and ZIP are also unchanged copies of the supplied files, with fingerprints in the asset manifest. All 50 checksums in the ZIP passed. Its PDF exactly matches the published PDF. All extracted files passed Gitleaks with no size limit or ignore file. All 69 HTML links resolve within the extracted bundle. It references no remote resources. Its table-filtering and sorting scripts are unchanged from the previously browser-tested report; this update did not repeat the interactive browser test.

We summed the event CSV: **209,611 records, 28,336,367,703 tokens, and $8,529.66 estimated API value**. Its token categories match `summary.json`. All 34 partition tables match the event count and tokens, and their estimated values agree within one cent. These checks establish internal agreement; they do not verify the original usage capture, saved prices, or actual charges.
