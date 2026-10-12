# Presentation checks

[Back to TicketStub](../../README.md) · [Evidence and limits](EVIDENCE.md)

Checked October 12, 2026. These are engineering checks, not organizer approval.

- **Sync tests:** all 13 tests pass. The update test also checks that judge documents and presentation graphics survive a refresh. Private exclusion, exact exports, unsafe paths, scan failures, changed scan exceptions, public API pagination, credential-free public metadata, pinned-history counts, line-count edge cases, and shallow-history rejection are covered.
- **Links:** the [public HTTP report](LINK-CHECK.json) retains the earlier full unauthenticated check of the judge pages. The added collection's 14 pinned history links also returned HTTP 200 without authentication in this update. The local checker now includes the generated index: 133 relative file and heading links pass. A working URL does not verify the claim on a page or prove submission.
- **Source-link fallback:** five GitHub file views returned HTTP 503 in the final pass. Their guide links now open verified raw files at the same exact source commit; all five matched the collected copies byte for byte. The report preserves the failed view URLs and retry outcome. All 30 final external URLs returned HTTP 200.
- **Words:** the root guide has about 630 words, including image descriptions and excluding code. It uses a short example, defines trace and runway, and separates samples from live evidence.
- **Graphics:** both generated illustrations were visually inspected. Editable diagrams were checked down to a 300-pixel content width, in their light and dark variants. Labels, arrows, sponsor marks, and contrast were readable. Main explanations also remain ordinary text.
- **GitHub rendering:** the published README was checked in Chrome at 1280 × 900 and 390 × 844, in light and dark modes. The banner, real screenshots, disclosure, Mermaid workflow, tool table, and evidence links rendered. The phone view selects the real phone screenshot. Evidence diagrams switch with the color scheme; captions render as text. The placeholder MP4 opens its public GitHub file page with a raw download link. Browser overrides were reset.
- **Actual app:** an isolated demo replay confirmed date editing, PNG download, and a stub pinned to the local wall. A phone-sized view was checked. [Exact revision and runtime caveats](DEMO.md#replay-the-sample) remain recorded.
- **Evidence integrity:** all four Entire graph checksums and all 20 cfo.ai revision-2 checksums passed. This does not rerun the original model calls or spreadsheet calculations.
- **Supplied business-plan workbook:** `TicketStub — neatHack Business Plan — 2026-10-11.xlsx` exactly matches the original October 11 export already in the source collection and its public, pinned download. SHA-256: `73827929b5e495ad39a073cf7343ffe98832ad4e2d67f501236841c0527d7bc1`. The public URL returned HTTP 200. It differs from the revision 2 reviewer workbook linked first in the evidence guide. No workbook was edited or recalculated for this comparison.
- **Public building:** Day 1 and Day 2 posts were opened directly in X. Their URLs and the official launch URL returned HTTP 200 without authentication. Post content was read in signed-in Chrome; full signed-out rendering was not tested. Their product and usage claims remain qualified.
- **Placeholder:** `ffprobe` confirms a 170.04-second, 1280 × 720 silent video. The supplied ZIP and extracted material passed a Gitleaks scan. The inspected timeline is a concept storyboard, not a filmed demo.
- **Timothy's usage report:** the supplied 198-page PDF was copied unchanged and added to the asset manifest. All extracted text passed Gitleaks with default rules and no ignore file. PDF metadata reports no JavaScript; attachment inspection found zero embedded files. The cover, token breakdown, counter exceptions, scope, and attribution pages were visually inspected. The four main token categories and the two tools' record counts reconcile to the reported totals. Original logs, companion CSV files, prices, identity, and actual charges were not independently audited. See the [attributed summary](USAGE.md).
- **Latest usage update:** the newer `143507` PDF is retained unchanged; the earlier report remains labeled as a prior snapshot. All text from the new report passed the same secret scan; it has no embedded files or JavaScript. The latest cover, token breakdown, and scope page were visually inspected. Its token categories and tool record counts reconcile. Crystal's pasted ledger is summarized separately under the team-supplied credit **lajefa**, with its pre-event date range, missing source file, unexplained six-record difference, and unverified payment claims preserved.
- **Collection counts:** full public histories were fetched for all 14 existing source pins. Exported trees and file counts matched the manifest. No source pin or copied file changed. Counts include 3,931 files, 494,742 source-file lines, 1,172,903 total text lines, and 1,696 source commits summed per repo. These are all-history counts, not an event-eligibility finding. Counts are now part of the generated index and manifest and refresh with the normal sync.
- **Zach's usage report:** the supplied 11-page PDF is retained unchanged and hashed in the asset manifest. All extracted text passed Gitleaks with default rules and no ignore file. It has no embedded files or JavaScript. Pages 1, 4, and 9 were visually inspected. Token categories match his earlier pasted table; model and daily tables agree on calls and tokens. The [attributed record](ZACH-USAGE.md) preserves the stated scope, counter differences, and price limits. Original logs and companion data were not supplied; producer checks were not rerun. No combined team total was added.
- **Timothy's complete bundle:** the supplied HTML and ZIP are unchanged and hashed in the asset manifest. Archive paths were checked before extraction; no archive symlinks or escaping paths were found. All 50 bundled checksums match, and the included PDF equals the published PDF. Gitleaks scanned all 314 MB of extracted content without a size limit and found no secrets. The event CSV's 209,429 rows, token-category sums, and rounded $8,503.11 estimate match the summary. All 34 partition tables agree on records and tokens and agree on estimated value within one cent. This checks internal consistency, not original log capture, pricing accuracy, or actual payment.
- **Searchable HTML:** opened the supplied report locally in Chrome. Filtering the tool table to Claude hid the Codex row; clearing the filter restored both rows. Clicking the call-count heading sorted the numeric values correctly. Resource links and navigation anchors resolve within the extracted ZIP. The standalone HTML download needs that extracted folder for its CSV links; GitHub serves it as source, not a hosted app.

Run the local checks:

```sh
python3 scripts/check_judge_docs.py
python3 -m unittest discover -s tests -v
```

To refresh the public link report (this edits `LINK-CHECK.json`):

```sh
python3 scripts/check_judge_docs.py --public-links
```

## First source refresh

Published October 12 at 17:29 UTC: [snapshot commit 9580b9b](https://github.com/Jevelopers-neatHack-2026/Jevelopers-GetTicketStub.com-Submission/commit/9580b9b3eebd90470c8c322d95ee169f153995d3).

- 14 public repositories, 3,931 tracked files. All copied Git trees matched their recorded source trees. Private checkpoint storage was excluded.
- 27 presentation files had identical SHA-256 hashes before and after the refresh. The root guide and assets survived unchanged.
- The secret scan passed with 553 exact, reviewed fixture/identifier matches. Eleven matches in ten changed or new files were reviewed before updating their exact exceptions: synthetic test keys, fake token strings, an unchanged test-only UUID, and public input-file hashes. No path or rule was excluded wholesale.
- All 11 sync tests and the maintained-document link/hash checks passed after refresh. Evidence claims still refer to their tested revisions; new source code was not declared live-verified.

The first authenticated attempt stopped safely when the shared GitHub API quota ran out. The successful retry used `python3 scripts/sync_submission.py --publish --public-api`. Public metadata used no credential; the normal Git push used existing authentication.
