# Draft visual verification — author evidence, approval pending

This editable rehearsal bundle is not a released product demonstration or approved campaign. Sources/exports label conceptual or synthetic content and approval checkpoints. No product behavior, live sponsor integration, measured savings, compliance, sponsorship or purchase completion is demonstrated. No external publication or paid call occurred.

## Selected support

| Asset ID | Source / export | Purpose |
| --- | --- | --- |
| DEMO-WORKFLOW-DIAGRAM-001 | demo/diagrams/demo-workflow.svg / .png, 1440 × 900 | Four intended process states, human approval, hold/revise recovery. First-party conceptual diagram, not unverified runtime evidence. |
| DEMO-SCREENSHOT-SET-001 | demo/screenshots/synthetic-stub-mockup.svg / .png, 1200 × 900 | Fictional artwork review example explicitly marked “not a product screenshot.” No real person, venue, date, barcode, order or third-party art. |
| DEMO-DECK-SUPPORT-001 | demo/deck/concept-overview.html | One rehearsal support page reusing the diagram; mobile replaces dense graphic with ordered text. Not a final video or PowerPoint. |
| LAUNCH-X-KEY-VISUAL-001 | launch/assets/x-submission-key-visual.svg / .png, 1200 × 675 | Draft concept announcement; docs CTA only. |
| LAUNCH-X-ALT-TEXT-001 | launch/assets/x-submission-alt-text.md | Equivalent message, limitations, approval checkpoint and pinned documentation destination. |

## Canonical draft comparison

Read exact [SPEC](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/SPEC.md), [tokens](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/tokens/tokens.json), and [voice](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/docs/voice.md). This is draft baseline 3822635aff507cd5918a08a0c636bb0e41705261; BK-03B #14 and BK-09 #15 block final brand acceptance.

| Reference | Workflow / mockup | Announcement |
| --- | --- | --- |
| Paper by day / dark stage | Cream page, moss process cards/stub | Night ink page, cream text |
| Palette | Cream #F4ECDD, ink #17140F, moss #26302A, orange #E4572E | Ink, cream, orange; cyan #7CC6D2 rule |
| Type fallback | SPEC fallback serif/system sans stacks | Same stacks; larger type for feed |
| Mark geometry | No logos copied or redrawn | Plain product name, no fabricated logo |
| Voice | Short actions and explicit status | Concept/status/approval copy, no shipped-product slogan |
| Product / landing reference | Documentation-only product 5a2986454297dd6df97088a8fbde69adc771f7a0 and landing 3f28c8ac691374614354a8e53c1a2520e8c7854c; no deployed UI comparison possible | Docs CTA; no working-application promise |

No font binaries, logos, sponsor marks, stock photos or generated media copied. Type and layout adjustments serve the medium, not new brand tokens. This author comparison does not replace brand/landing reviewer decisions. Upstream changes invalidate it; rerender all SVG/PNG/HTML treatments and recheck alternatives.

## Executed browser and accessibility checks

`node tools/render_collateral.mjs`: Chrome **154.0.8037.98**, Node **24.15.0**, Python **3.9.6**, Pillow **11.3.0**. Isolated temporary headless browser profile, local files only, real browser PNGs: **10 views, zero page console/runtime/network errors, zero external page requests**, no horizontal overflow. These are page-event checks, not a claim that all browser-process diagnostics were absent. A real Tab key event focused the deck text-equivalent link; visible solid outline was inspected. No transaction loading/error states exist in static collateral. Hold/revise/blocked labels explain conceptual states, not exercised product transitions.

Inspected native X PNG, 390 × 220 feed image, 960 × 600 workflow, 720 × 540 mockup, 1440 × 1200 deck, mobile deck/full-page captures, and both 800 × 500 fixture PNGs. First mobile capture had unreadably small diagram labels; fixed by replacing mobile graphic with 20px ordered text. The complete corrected mobile capture was inspected. Presentation PNGs are not mobile-feed variants; their text equivalents serve small screens. At declared sizes no crop removes status, checkpoint or qualification.

| Format | Intended display | Minimum effective essential type |
| --- | --- | --- |
| Workflow | 960 × 600 or larger | 22 × 960/1440 = 14.67px |
| Mockup | 720 × 540 or larger | 24 × 720/1200 = 14.4px |
| X image | 390 × 220 feed; native 1200 × 675 | 40 × 390/1200 = 13px |
| HTML support | Desktop presentation; 390px mobile scrolling | 20px body; graphic replaced by ordered text |

All SVG text passes **4.5:1**, including large headings. Large text means ≥24 effective CSS px regular or ≥18.67px bold. Essential strokes pass **3:1**. Actual pairs: cream/moss 11.6265, ink/cream 15.6455, ink/orange 4.9865, cyan/ink 9.5027. Cyan/cream **1.6464** and orange/cream **3.1376** deliberately fail normal-text checks; rejection is tested. Local checker 1.0 uses the WCAG sRGB relative-luminance formula; see `contrast-evidence.json`.

SVG title/descriptions, matching text alternatives, numbered/verbal states and reading order preserve the message without color. Announcement alt text preserves limitations, approval and docs CTA. Audio/video captions, timing and transcript are not applicable: this static bundle contains no speech/video. No application accessibility certification is claimed.

## Current format source versus design choice

[Official X guidance](https://help.x.com/en/using-x/posting-gifs-and-pictures), checked **2026-10-11 UTC**, says single-image ratios from 2:1 through 3:4 display in full. **1200 × 675 (16:9)** is our design choice within that range, not an organizer-mandated dimension. PNG is approximately 80KB; exact bytes/hash are in the receipt. The collapsed maximum-size subsection was not available in extracted text; no unverified maximum asserted. Confirm final upload in the composer before an authorized submission.

[Official organizer](https://neatlogs.com/hackathon), checked **2026-10-11 UTC**, requires a ≤3-minute demo video and public X quote-post with team/name/project/public repository/demo information. Final cutoff is on Discord; official submission post was not live when checked. This static rehearsal bundle is not that video or submission. Authentic sponsor/runtime evidence, final video, submitter/destination approval and organizer publication remain blockers.

## Actual synthetic redaction proof

**PROV-SYNTHETIC-CANARY-001** contains only obvious `DUMMY_*_CANARY_*` markers. Before fixture is a synthetic negative test excluded from release. Renderer removes sensitive SVG group, metadata and comments; replaces accessible description; renders a new flattened PNG; reconstructs PNG from RGB pixels without metadata. No blur/overlay preserves an intact sensitive layer.

Tests prove the known 640 × 180 region changes from rendered fake text to uniform cream pixels; every canary is absent from sanitized SVG, alt text and PNG bytes; PNG metadata is empty. Before PNG has fake metadata, proving the test is exercised. Overlay-only source retains the fake secret marker and fails the source scan. Exact pixel uniformity proves glyph removal for this controlled fixture; this is not a generic automated-redaction/OCR claim.

| Surface | Inspection / applicability |
| --- | --- |
| Pixels | Reopened native PNGs; exact region comparison |
| SVG accessible text / metadata / comments | Reconstructed source scanned; sensitive group, metadata and fake notes comment removed |
| PNG metadata | Pillow `Image.info == {}` plus byte scan; no EXIF/text chunks retained |
| Speaker notes | PNG/SVG have no notes container: not applicable. SVG fake comment tests analogous hidden notes removal. HTML contains no speaker notes/comments; visible DOM/source inspected |
| Names / alt / links | Sanitized filenames contain no canaries; after alt scanned; no QR/barcodes or remote resources; pinned public docs CTA |
| Audio / video | Not applicable: none in bundle |

Rights/consent are not granted by redaction. Unknown/revoked rights remain blocked by the general release validator. No actual private source may be used as a repository fixture.

## No-paid reproduction

Use installed Node ≥22 with WebSocket, local Chrome, Python 3 and Pillow. macOS default Chrome path is in script; set `COLLATERAL_CHROME` for another installed executable. No runtime downloads or remote fonts.

```sh
node tools/render_collateral.mjs
python3 -m unittest discover -s tests -p 'test_visual_*.py' -v
```

Last run **6 tests passed**, zero skips. Early file-handle ResourceWarnings fixed with context managers; clean rerun passed. `browser-render-evidence.json` records SHA-256/bytes/dimensions/versions/page requests/errors. Browser/font/platform changes may alter raster hashes: rerender and re-review changed pixels; no cross-platform pixel identity promised.

Remaining approvals: independent candidate review; brand subset/consumer contract and brand/landing review; privacy/rights and destination approval; product/evaluation evidence; marketing content/final CTA owner; authentic sponsor evidence/finished video; final official post/cutoff. No self-approval recorded.
