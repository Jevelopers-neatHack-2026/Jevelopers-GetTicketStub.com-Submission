# Presentation checks

[Back to TicketStub](../../README.md) · [Evidence and limits](EVIDENCE.md)

Checked October 12, 2026. These are engineering checks, not organizer approval.

- **Sync tests:** all 11 tests pass. The update test also checks that judge documents and presentation graphics survive a refresh. Private exclusion, exact exports, unsafe paths, scan failures, changed scan exceptions, public API pagination, and credential-free public metadata are covered.
- **Links:** the [public HTTP report](LINK-CHECK.json) records an unauthenticated check of every external link in the maintained judge pages. Relative files and Markdown heading links are checked by the command below. A working URL does not verify the claim on a page or prove submission.
- **Words:** the root guide has about 630 words, including image descriptions and excluding code. It uses a short example, defines trace and runway, and separates samples from live evidence.
- **Graphics:** both generated illustrations were visually inspected. Editable diagrams were checked down to a 300-pixel content width, in their light and dark variants. Labels, arrows, sponsor marks, and contrast were readable. Main explanations also remain ordinary text.
- **GitHub rendering:** the published README was checked in Chrome at 1280 × 900 and 390 × 844, in light and dark modes. The banner, real screenshots, disclosure, Mermaid workflow, tool table, and evidence links rendered. The phone view selects the real phone screenshot. Evidence diagrams switch with the color scheme; captions render as text. The placeholder MP4 opens its public GitHub file page with a raw download link. Browser overrides were reset.
- **Actual app:** an isolated demo replay confirmed date editing, PNG download, and a stub pinned to the local wall. A phone-sized view was checked. [Exact revision and runtime caveats](DEMO.md#replay-the-sample) remain recorded.
- **Evidence integrity:** all four Entire graph checksums and all 20 cfo.ai revision-2 checksums passed. This does not rerun the original model calls or spreadsheet calculations.
- **Public building:** Day 1 and Day 2 posts were opened directly in X. Their URLs and the official launch URL returned HTTP 200 without authentication. Post content was read in signed-in Chrome; full signed-out rendering was not tested. Their product and usage claims remain qualified.
- **Placeholder:** `ffprobe` confirms a 170.04-second, 1280 × 720 silent video. The supplied ZIP and extracted material passed a Gitleaks scan. The inspected timeline is a concept storyboard, not a filmed demo.

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
