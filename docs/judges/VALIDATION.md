# Presentation checks

[Back to TicketStub](../../README.md) · [Evidence and limits](EVIDENCE.md)

Checked October 12, 2026. These are engineering checks, not organizer approval.

- **Sync tests:** all nine tests pass. The update test also checks that judge documents and presentation graphics survive a refresh. Private exclusion, exact exports, unsafe paths, scan failures, and changed scan exceptions are covered.
- **Links:** the [public HTTP report](LINK-CHECK.json) records an unauthenticated check of every external link in the maintained judge pages. Relative files and Markdown heading links are checked by the command below. A working URL does not verify the claim on a page or prove submission.
- **Words:** the root guide has about 620 words, including image descriptions and excluding code. It uses a short example, defines trace and runway, and separates samples from live evidence.
- **Graphics:** both generated illustrations were visually inspected. Editable diagrams were checked at 390 pixels wide, in their light and dark variants. Labels, arrows, sponsor marks, and contrast were readable. Main explanations also remain ordinary text.
- **Actual app:** an isolated demo replay confirmed date editing, PNG download, and a stub pinned to the local wall. A phone-sized view was checked. [Exact revision and runtime caveats](DEMO.md#replay-the-sample) remain recorded.
- **Evidence integrity:** all four Entire graph checksums and all 20 cfo.ai revision-2 checksums passed. This does not rerun the original model calls or spreadsheet calculations.
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

Source refresh and final GitHub rendering results will be recorded here after publication. The sync copies exact source trees and never updates an evidence claim merely because its source code changed.
