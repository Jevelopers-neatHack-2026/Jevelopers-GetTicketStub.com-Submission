# Brand usage by channel

**Draft guidance using existing source rules. No approved identity version or distributable subset exists yet.** The [identity packet](identity-decision-packet.md) identifies the baseline and pending choices; the [provenance allowlist](../provenance/allowlist.json) controls release eligibility. These examples support review and do not grant rights to use assets or publish claims. Refs [BK-05 #13](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/13).

## Canonical rule index

| Rule | Canonical source | This guide's responsibility |
|---|---|---|
| Mark selection, clear space, size, no transformation | [Logo usage](logo.md) | Map existing rules to channels and pair valid/invalid examples. |
| Palette and master-brand direction | [SPEC](../SPEC.md#colour), [token source](../tokens/tokens.json) | Preserve A+B until the exact scoped decision; do not invent a per-channel palette. |
| Readable pairs, themes, focus and reduced motion | [Accessibility guidance](accessibility.md), [contrast report](accessibility/contrast-report.md) | Apply computed pair restrictions; owner/browser acceptance remains separately required. |
| Typography and external-font behavior | [SPEC type](../SPEC.md#typography), [token profile](token-profile.md) | Use the same two families/fallbacks; respect the no-self-hosted-font constraint. |
| Imagery and voice | [Imagery](imagery.md), [voice](voice.md), [claim register](claims-register.md) | Separate master collateral from artwork editions and label unverified example copy. |
| Approval, rights and export version | [Governance](brand-governance.md), [provenance](provenance.md) | Link the decision and exact allowed artifact before distribution. |

## Channel matrix

All rows have **approved identity version: pending**. The frozen review baseline is [3c48922](identity-decision-packet.md#files-and-hashes); a source pin does not make it approved. Format entries identify source/target choices for review, not shipped export files.

| Channel / consumer owner | Canonical source mark or lockup | Type, color and background | Format and readiness boundary |
|---|---|---|---|
| Product app — getticketstub.com | [Primary stamp](../logo/ts-stamp.svg); [horizontal lockup](../logo/lockup-horizontal.svg) when space permits; [favicon](../logo/favicon.svg) for small context | Fraunces display / Inter Tight controls and data, ink on cream. Existing night subtree is a source capability; A+B versus paper-only app usage is pending. | SVG sources; app-icon raster is a BK-04 export target. App layout, accessible controls and supported workflows remain consumer-owned. |
| Landing page — landing-page-repo | [Horizontal lockup](../logo/lockup-horizontal.svg); [cream wordmark](../logo/wordmark-cream.svg) on a permitted dark section | Existing paper/ink/foil language, with explicit flat plates over imagery. Use [readable pairs](accessibility/contrast-report.md) and approved public wording only. | SVG for web; raster/social export requires actual BK-04 evidence. Final rendered copy belongs to LP-02, with MM-02 substantiation. |
| Marketing collateral — marketing-material | [Primary stamp](../logo/ts-stamp.svg), [stacked lockup](../logo/lockup-stacked.svg) or [mono horizontal](../logo/lockup-horizontal-mono.svg) according to available space | Existing day/night art direction; typography and brand foil unchanged. Original reference imagery is not reusable collateral. | Exact allowed SVG/PNG/PDF subset and output profile remain BK-03B/BK-04 prerequisites. Never copy the whole repository for distribution. |
| Social / demo material — marketing-material with product evidence owner | [Primary stamp](../logo/ts-stamp.svg), [compact wordmark](../logo/wordmark-compact.svg) below 120 px | Keep the brand signature legible against a flat plate; captions retain illustrative/mock labels. Sample event names/data are illustrative and not product evidence. | 1200 × 630 is the board's illustrative composition target. No final social export, publication or submission is authorized by this guide. |
| Internal financial UI — team-dashboard | [Mono ink stamp](../logo/ts-stamp-mono-ink.svg) or [horizontal mono lockup](../logo/lockup-horizontal-mono.svg) | Inter Tight fallback stack and tabular numerals; state must have text/symbols beyond color. Dashboard owns host style isolation and financial-state behavior. | Same exact approved token/artifact version required; this brand source does not redefine financial contracts. |
| Print / packaging — print-production and fulfillment owners | [Mono ink](../logo/ts-stamp-mono-ink.svg) or [stacked lockup](../logo/lockup-stacked.svg) | Preserve 8 mm stamp minimum and clear space; spot foil/emboss is a process-specific proposal. Marketing/print dark scope needs the identity decision. | Outline SVG source; printer-ready PDF/raster, bleed, finish, stock and packaging approval require the print owner. The moss sleeve is an illustrative concept, not a shipping promise. |

Each consumer must receive the final artifact locator, version, hash, allowlist, font/fallback and upgrade contract through BK-03B/BK-09. None of those ACKs is created by this matrix.

## Paired source examples

Open [usage-examples.html](usage-examples.html) locally. It loads canonical SVG files by relative path, uses system fonts and a synthetic CSS pattern, and performs no checkout, upload, sharing or external font request. The invalid examples are deliberately labelled. The reference images in the main board are not copied into this fixture.

| Rule | Valid example under the existing rule | Prohibited example and correction |
|---|---|---|
| Preserve aspect ratio | `ts-stamp.svg` at its intrinsic 4:5 ratio; a 56 px width gives 70 px height. | Stretching it to 96 × 40 px changes the mark. Restore intrinsic aspect ratio. |
| Stamp clear space | At 56 px width, keep at least `56 ÷ 7 = 8 px` clear on all sides. The fixture's dashed boundary measures that area. | Putting neighboring content inside that 8 px area. Move content outside the boundary. |
| Minimum size | Stamp at 24 px high on screen; 8 mm in print. Use `favicon.svg` below the stamp minimum. | A 16 px-high portrait stamp. Use the square favicon at 16 px. Screen CSS millimeters do not validate physical print size. |
| Wordmark substitution | Perforated wordmark at 120 px or wider; compact wordmark below 120 px. | Keeping the small tear dots at 90 px. Switch to `wordmark-compact.svg`. |
| Busy image background | Mono ink on a cream plate, with the same clear space. | Bare foil stamp on busy artwork. Add a flat plate; the fixture uses only a synthetic pattern. |
| Mono/currentColor | Canonical mono sources in permitted brand colors; currentColor source for an explicitly reviewed consumer embedding. | Treating currentColor as permission for arbitrary palette values, outlines or gradients. Choose the existing ink/orange/cream mono variant instead. |
| Text contrast | Ink on cream; cream on ink/moss; ink labels on orange CTA fill. | Orange/copper/cyan normal body text on cream; copper normal text on ink. Use an allowed pairing or the documented large-text restriction. |
| Accent/focus boundaries | Focus color qualified against its actual adjacent surface. An offset ring must expose the allowed surface through its gap. | Cyan directly adjacent to orange (about 1.91:1). Use the qualified offset/adjacent-surface arrangement in the accessibility guide. |
| Logo geometry and material | Existing SVG shape and copper → orange → cyan at 135°. | Redraw, rotate, skew, outline, re-gradient or apply a new drop shadow to the logo file. Keep physical-object mockup effects separate from the mark. |
| Lockups and co-branding | An existing horizontal/stacked TicketStub lockup, pending exact-version approval. | Adding an unapproved sponsor, customer, organizer, artist or venue mark. Remove it and request the actual scoped permission/combination decision. |

Logo/decorative exceptions to WCAG body-text contrast do not make colored small copy readable. The logo guide's practical 3:1 background rule is retained as a brand rule. Compare unrounded values to the [accessibility thresholds](accessibility.md), including alpha-composited muted text; a displayed rounded value must not turn a failing pair into a pass.

## Master brand, artwork editions and third parties

Master-brand chrome, marks, marketing and packaging are owned here. Edition-specific art and palettes are described in the [pinned studio source](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/43bb721f00de1c616e8e8d27efbb87c6bf75bcbf/docs/studio/stub-system.md); creative-engine owns artwork versions, and print-production owns printable composition. The current imagery guide's blanket generated-art wording is explicitly a [pending scope decision](identity-decision-packet.md#baseline-decisions-requested), not permission to override those owners.

Unknown reference rights remain unknown even if an image appears on the board, in a mood study or in a screenshot. Customer screenshots and event/organizer marks require actual rights evidence and any privacy approvals before reusable collateral. Event-intelligence owns discovery and permission evaluation for event-specific assets. A new co-brand lockup requires BK-07 review of exact marks, rights, geometry, placement and scope; no preapproved combination exists in this repository.

## Public wording and mock labels

The [claim register](claims-register.md) inventories capability, format, automation, pricing, shipping and sponsor-related wording in README, SPEC, the board and voice guidance. All unverified product statements are explicitly illustrative/planned. A source example is not a customer offer, provider result or proof that a feature works. Preserve its label when taking excerpts or screenshots.

MM-02 owns final public claim substantiation; getticketstub.com supplies product evidence, LP-02 owns rendered landing copy, and commerce/fulfillment/partnership owners supply their applicable inputs. This guide changes no prices, provider modes, financial contracts or publication authority.

## Review procedure and remaining acceptance

1. Follow each channel row's exact mark, rule and version references. Today the approved-version and allowed-subset checks remain **blocked** because approval/rights are missing.
2. Open the source fixture at the documented minimum/typical sizes and inspect ratio, space, plates and contrast; then inspect 200% zoom and narrow width. Record actual viewport/browser/font mode and evidence. These visual checks remain required until an actual result is attached.
3. Review each negative example against its paired valid alternative and canonical rule. Reject the [unlabelled automation/price fixture](claims-register.md#negative-review-fixture).
4. Run `make check-guidelines`, `make check-links` and `git diff --check` on the integrated candidate. The [guidelines checker](../tools/check_guidelines.py) verifies only the source snapshot and fixture structure, including rejected-copy regression cases. Structural checks do not stand in for visual review, rights, the identity decision or approved copy.
5. Obtain the required brand/accessibility/content review and the actual consumer evidence. Record only satisfied acceptance IDs; BK-05 stays open while those required inputs are missing.

No existing dimensions, logo variants, colors, font families, source paths or permissions are changed by this guide. The numerical correction from muted 5.6:1 to 5.5:1 documents the computed existing values; it is not a palette migration.
