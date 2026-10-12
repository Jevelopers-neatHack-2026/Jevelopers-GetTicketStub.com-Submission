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

The first authenticated refresh stopped before applying files when the shared GitHub API quota ran out. A public-only metadata option was added and tested; the refresh result is recorded below when complete. The sync copies exact source trees and never updates an evidence claim merely because its source code changed.
