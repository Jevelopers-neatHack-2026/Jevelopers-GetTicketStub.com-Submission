# Collateral accessibility baseline — MM-08

This is the local baseline for selected marketing graphics, diagrams, synthetic mockups, slides, social text and demo media. It does not certify the application or every platform. The accountable marketing/content owner is the user-assigned marketing-material supervisor. The UI worker records author verification; an independent Astra High review and applicable owner approvals are pending.

## Measurable checks

Check every delivered source and derivative at its declared viewing size after export. A template pass does not approve a resized, cropped, localized or otherwise changed variant.

- Essential normal text: **at least 4.5:1** contrast against its actual adjacent background.
- Large text: **at least 3:1**. For SVG, PNG and browser-rendered HTML, large means at least **24 effective CSS px regular**, or **18.67 effective CSS px at weight 700 or greater**. Effective raster size is source font size × displayed image width / source canvas width. The current SVGs use weight 500/600, so the regular-size definition applies. The current bundle tests all SVG text at the stricter 4.5:1 threshold.
- Essential diagram strokes, focus indicators and other meaningful marks: **at least 3:1** against adjacent colors. Decorative lines must not carry information missing from words.
- Variable backgrounds: measure the worst relevant point behind each glyph/mark or place it on an opaque solid backing. The current graphics use solid backgrounds. Brand conflicts go to brand-kit; do not redefine canonical colors locally to waive a failure.
- No state is conveyed by color alone. Use numbers, explicit words such as “draft,” “conceptual,” “synthetic,” “planned,” “blocked,” and the review action. Read left to right or in the explicitly numbered order; name any recovery branch.

The checker is local sRGB relative-luminance checker **1.0**, implementing the WCAG contrast formula in Python. It linearizes sRGB channels, applies luminance weights 0.2126/0.7152/0.0722, and divides (lighter + .05) by (darker + .05). Evidence: [contrast results](visual/contrast-evidence.json), [browser receipt](visual/browser-render-evidence.json), [author inspection](visual/verification.md). Deliberate cyan-on-cream (1.6464:1) and orange-on-cream (3.1376:1) normal-text failures must stay rejected; their presence in a negative fixture never means release approval.

## Viewing contexts and readability floors

| Format / selected use | View used for acceptance | Minimum essential type in this slice |
| --- | --- | --- |
| Workflow diagram | 1440 × 900 source; 960 × 600 presentation preview | 22 × 960/1440 = **14.67px** |
| Synthetic mockup | 1200 × 900 source; 720 × 540 presentation preview | 24 × 720/1200 = **14.4px** |
| X image | 1200 × 675 source; 390 × 220 feed preview | 40 × 390/1200 = **13px** |
| HTML rehearsal support | 1440 × 1200 desktop capture; **390 × 740** mobile viewport plus full-page capture | **20px** body/link/list text; mobile heading at least 32px |
| Redaction fixture controls | 800 × 500 native inspection only | **24px** text |
| Text alternatives / social text | Reflowable text; do not embed its full paragraphs in a graphic | Use host text scaling; avoid fixed-size clipping |

These are local, format-specific inspection floors, not universal accessibility guarantees. Presentation diagram and mockup PNGs are not approved as mobile-feed images: use their text alternatives on small screens. The HTML support page hides the dense graphic below 600px and presents an ordered text equivalent. Mobile allows vertical scrolling and must have no horizontal overflow. Any newly requested format, localization or smaller size needs a new recorded check.

## Language, alternatives and interaction

Use short, concrete sentences and plain actions. Expand unfamiliar acronyms on first use in public-facing copy. Asset/claim IDs are handoff metadata, not required audience knowledge. Preserve the concept/draft status and limitation in both visual and text versions. Do not turn planned states or sponsor references into demonstrated results.

Every meaningful image needs a concise alternative identifying its key message, evidence class, review checkpoint, limitation and CTA if present. A longer diagram gets an adjacent/linkable ordered text equivalent. HTML uses semantic headings, ordered lists and meaningful link text. SVG uses title/description and ordered visible labels; PNG needs its packaged Markdown alternative because a PNG does not carry reliable semantic reading order. Keep alternatives with exports through packaging and downstream handoffs.

Perform an **alternative-only check**: read the alternative without looking at the image, state the message and ordered journey, identify limitations and next action, then compare with the visual. Do not approve if information depends on color, source-canvas zoom or a missing link. Test actual Tab focus and visible focus outline where interaction exists. Static SVG/PNG controls have no keyboard action; interactive product flows are outside this bundle.

For speech/video, provide a reviewed transcript and synchronized captions, including meaningful sounds and speaker identification where needed. Check accuracy and timing on the final render, and ensure captions do not cover status/approval labels. Current exports are static and contain no speech/video, so **caption timing, caption accuracy and speech transcript are not applicable to this slice**. A future final demo video remains pending and must pass those checks; the static N/A cannot be inherited by it.

## Evidence and decision procedure

1. Declare use, dimensions, intended display, effective type and text alternative before export.
2. Render the actual source locally, reopen the flattened output, inspect intended feed/presentation/mobile views, and record errors, requests and dimensions.
3. Measure text/mark contrast and run a failing control. Check plain language, status without color and reading order. Perform the alternative-only check.
4. Record PASS, FAIL, expected negative control, or justified NOT_APPLICABLE for each variant. Fix failures and rerender/reinspect the changed variants. Any failed criterion blocks that variant.
5. Bind the check to exact file hashes. A changed source, crop, output, font, locale or brand baseline makes the old record stale. Obtain refreshed independent/owner review where required.

Run `python3 -m unittest discover -s tests -p 'test_visual_*.py' -v` to verify contrast, fixture removal, browser receipts, variant coverage, exact accessibility evidence hashes and ordered text equivalents. See the [all-variant checklist](accessibility-checklist.md) and [machine-readable results](visual/accessibility-results.json).

An author check passing is separate from final brand, rights/privacy, content/destination or publication approval. Unknown/revoked rights stay blocked under publication safety policy. Independent review is forthcoming; MM-08 closure and future video approval are not asserted here.
