# Silent synthetic rehearsal — author verification only

The local candidate is `demo/exports/silent-synthetic-rehearsal.mp4`: H.264/yuv420p, 1280 × 720, 30 fps, 4,500 frames, exactly 150.000 seconds, 2,012,777 bytes. SHA-256: `c2bc7ca195d9be07c7cc007c4cdd5e1cf7b7d2ebc5530f64e2d441c6288f9ace`. The 20 MB target is a local Git payload choice, not an organizer requirement. This is a silent, captioned rehearsal; it has one video stream, no audio stream, and no embedded subtitle stream.

`metadata.json` contains the machine-readable artifact path, dimensions/duration/hash, all ten scene IDs, source commit/paths/checksums, export and sidecar checksums, exact tool versions, author inspection, limitations, and pending independent review. Sources are unchanged general-authored scenes/storyboard/narration/transcript from commit `75123ec8a99a94ecbb1227eae945efa62a175091`. The original general narrative commit was mechanically adopted by the supervisor. No claims/inventory/provenance files were edited here.

## Local recipe and actual checks

From the repository root, using installed local tools:

```sh
python3 tools/render_rehearsal.py
python3 -m unittest discover -s tests -p 'test_visual_*.py' -v
ffprobe -v error -show_format -show_streams -of json demo/exports/silent-synthetic-rehearsal.mp4
```

The Python recipe validates source status/timing/copy and pending sponsor facets, writes the editable HTML text-card source and caption sidecars, invokes local Chrome through `tools/render_rehearsal.mjs`, then encodes static cue PNGs with local FFmpeg (`libx264`, ultrafast, CRF 28, yuv420p, 30 fps, `-an`). Local concat with stream copy and `+faststart` produces the MP4. Temporary segments are removed. No paid call, remote media, provider runtime, TTS, or voice synthesis was used. Installed versions: FFmpeg/ffprobe 8.1, Chrome 154.0.8037.98, Node 24.15.0, Python 3.9.6, Pillow 11.3.0. Re-rendering resets author inspection to pending; inspect the new encoded frames before annotating a new receipt. Different platform fonts/encoder versions may change hashes even with the same recipe.

The actual final browser run rendered 17 cue frames with exact source screenText and captionText matches, zero page errors, zero external requests, and no main/caption overflow. `browser.json` records measured bounds and the browser version. The plain-text fallback is deliberate: it presents the general scene text without shrinking dense workflow/support diagrams, inventing product UI, or inserting external logos. Existing visual SVG/PNG sources remain unchanged.

All 22 visual tests passed, zero failures/skips, including seven rehearsal tests for actual MP4 properties, source/caption timing and text, exact browser copy/status, all 20 decoded scene boundary frames, final hashes, and rejection of malformed timing/copy/sponsor states or missing local runtime. No final-release or independent-approval status is inferred from these tests.

## Captions, frames, and viewing context

All ten scene start frames and the final frame before each scene ends were decoded from the final MP4 and inspected as native 1280 × 720 and landscape mobile 780 × 439 start/end pairs under `inspection/`. All 20 boundaries retain the correct scene, caption, persistent `DRAFT • SYNTHETIC REHEARSAL` / `NOT A PRODUCT DEMO • SILENT / CAPTIONED` header, and useful evidence/status labels. Tests compare decoded boundary pixels against the corresponding Chrome cue PNGs with a bounded codec-difference tolerance. This is representative frame inspection, not a claim of watching continuous 150-second playback or independent approval.

There are 17 sentence-preserving caption cues. Their concatenation reproduces each general caption exactly; sidecars are `demo/captions/silent-rehearsal.srt` and `.vtt`. The shortest cue is 4.333 seconds, the maximum reading rate is 17.039 characters/second, and the longest cue is 138 characters. Every cue is checked for wrapping/overflow in the actual browser. Complete negated sentences remain together so a later cue cannot read as a positive product/savings claim. Timings match the silent scene display at 30 fps; speech synchronization is not applicable. Narration/transcript remain separate general-authored text artifacts.

The intended checked mobile context is landscape/fullscreen at 780 × 439. At that width, the smallest essential 28 px sponsor/status text becomes 17.06 px, body/caption 32 px becomes 19.5 px, and heading 36 px becomes 21.94 px. Portrait inline video is not claimed readable; the packaged general transcript supplies the text equivalent. Meaningful text stays at least 5% from frame edges; main text bottoms at or before y=510 and the caption band starts y=526 and ends y=680. Caption lines fit the opaque band and do not obscure scene text.

Ink `#17140F` against cream `#F4ECDD` has 15.645:1 contrast; cream against moss `#26302A` has 11.627:1. Both exceed 4.5:1 normal text, 3:1 large text (24 CSS px normal or 18.667 CSS px bold at actual viewing size), and 3:1 essential-mark thresholds. Status is written in text rather than conveyed by color. Reading order is persistent draft/silent status, exact scene text in source order, then current caption. Scene 2 retains context → design → human review; scene 3 retains hold/revise and planned handoff. Video/text-card keyboard focus is not applicable; future hosting player controls remain a destination review requirement.

## Failures corrected before final candidate

Initial same-document hash navigation repeated scene 1; full query-string navigation and exact DOM equality guards corrected it. Initial first-paint compositor tiling was found in decoded frames; post-resize/font/animation-frame settling corrected it. Initial balanced word segmentation split a negated sentence into a potentially misleading fragment; complete-sentence segmentation corrected it without changing general copy. A mistyped inspection path and an oversized multi-image tool output were corrected by using actual filenames and inspecting final pairs in batches of two scenes. None of those superseded exports is represented as the final candidate. The final browser and encoded-frame checks pass.

## Remaining blocks

All 15 sponsor architecture/implementation/runtime/reasoning/result facets remain PENDING throughout their respective sponsor scenes; providerMode remains `not_run`. Product implementation, authentic customer journey, sponsor usage, and comparable EVAL-02 savings evidence remain unverified. All submission identity/URL/cutoff fields remain pending, and final runtime evidence is blocked. Brand BK14/BK15, source rights/consent/privacy, destination release checks, general ledger/provenance/inventory joins, accountable-owner approval, and fresh independent Astra review remain external gates. This artifact is not a final sponsor-eligible video, product demo, app certification, brand approval, publication approval, or submission.

## MMREL-001 receipt correction

The earlier ffprobe receipt included the author checkout's absolute filename. The recipe now invokes ffprobe with the repository-relative video path and repository cwd. The refreshed filename is exactly `demo/exports/silent-synthetic-rehearsal.mp4`; dependent renderer/ffprobe checksums are refreshed in `metadata.json`. The MP4, SRT, VTT, HTML, cue PNGs, and decoded inspection PNGs were preserved byte-for-byte; no re-encoding or narrative change was needed.

The regression checks the deterministic relative filename and full actual ffprobe result, copies the same MP4 into a second temporary checkout and verifies that its result is identical, scans all rehearsal JSON/Markdown receipts and the render plan for machine-local filesystem fields, and exercises positive leak cases plus public-URL exceptions. Actual second-location ffprobe reproduction passed; all 22 visual tests passed with no skips. The only local-path field found in the original tracked media reports was the corrected ffprobe filename. Independent review of this correction remains pending.

The second-location regression initially exposed macOS temporary-directory alias differences. Resolving both the video and repository root before computing the relative path corrected that case. The final second-location probe and full suite pass.
