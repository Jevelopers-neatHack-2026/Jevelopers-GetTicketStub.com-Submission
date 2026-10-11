# Draft brand consumption — MM-06

`brand-kit` is the source of visual identity. Marketing-material consumes it; this document is not a replacement brand system, producer release contract or license. Accountable marketing owner: user-assigned marketing-material supervisor. UI author comparison: recorded below. Named brand and landing consumer reviewers: pending. Independent Astra review: pending. **Final brand conformance is BLOCKED**, not passed by matching a draft palette.

## Exact source and selected draft subset

All references below were read on 2026-10-11 UTC at **brand-kit 3822635aff507cd5918a08a0c636bb0e41705261**. Exact fetched-byte SHA-256 and byte lengths are in [brand-comparison.json](visual/brand-comparison.json). Checksums identify the read bytes; they do not grant rights or certify approval. No upstream binaries are copied.

| Canonical source | Current consumption / selected subset | Approval state |
| --- | --- | --- |
| [SPEC.md](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/SPEC.md) | Color/type roles, master-brand/edition distinction, documented fallback families | Draft reference only |
| [tokens/tokens.json](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/tokens/tokens.json) | Selected palette values; spacing guidance. No runtime token import or new canonical token definitions | Draft reference only |
| [docs/voice.md](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/docs/voice.md) | Plain, short review actions; sentence-case audience copy and explicit status | Draft reference; capability slogans are not implementation proof |
| [docs/logo.md](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/docs/logo.md) | Usage/no-redraw/clear-space constraints read; no logo files selected or copied | Future logo import blocked pending approved subset |
| [docs/imagery.md](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/docs/imagery.md) | Exclusion rules: no vendor/artist/venue marks, likenesses or copied album art | No reference images, photography or generated art consumed |
| [Fraunces notice](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/fonts/Fraunces-OFL.txt) | Notice reviewed; names Fraunces Project Authors, copyright 2018, SIL OFL 1.1 | No font binary copied; subset approval pending |
| [Inter Tight notice](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/fonts/InterTight-OFL.txt) | Notice reviewed; names Inter Project Authors, copyright 2022, SIL OFL 1.1 | No font binary copied; subset approval pending |

**Approved vocabulary/assets:** no release-approved subset has been supplied in this handoff. Draft audience copy uses ordinary words such as ticket, stub, design, review, hold and revise. No “no forms,” automated fulfillment, pricing, savings, sponsor-completion or other unsupported product promise is imported from positioning examples. A brand statement is not evidence of product behavior.

**Master brand versus stub:** master-brand guidance covers marketing chrome and product identity. Customer stub editions are separately defined artwork treatments; the fictional “The paper moon” example is first-party synthetic artwork, not a new authoritative edition or a customer/event output. Its simple dark ticket shape demonstrates a reviewable object without pretending to be a shipped product screenshot. No ticket vendor mark, customer image, real event identifier or sponsor logo is included.

## Draft implementation boundaries

Palette used: cream #F4ECDD, ink #17140F, moss #26302A, orange #E4572E and cyan #7CC6D2. Copper #B4693E and the foil gradient are not used in current collateral. Body text uses ink/cream pairs; orange is a solid backing with ink labels; cyan is an essential separator on ink. No local tint is promoted to a canonical token. Current contrast evidence is in [contrast-evidence.json](visual/contrast-evidence.json).

SVG display fallback stack is `Iowan Old Style, Palatino Linotype, Georgia, serif`; body is `Segoe UI, system-ui, -apple-system, sans-serif`. HTML rehearsal display uses Georgia and system sans body. These are SPEC-permitted fallback choices using installed platform fonts, not claims that Fraunces or Inter Tight rendered. No font download, webfont embedding or font redistribution occurs. Platform fallback changes can change glyph metrics and PNG hashes; rerender and inspect line breaks, text bounds and contrast on the target platform. If an approved future distribution includes fonts, preserve its exact notices and distribution requirements using the producer's approved contract; the current fallback decision does not authorize copying those binaries.

Current layout uses the documented spacing family as a reference, with source-canvas measurements adapted to presentation/feed readability. For example, common margins are 48px, source text is enlarged for the 390px feed view, and cards are sized to keep state labels visible. Exact canvas measurements are local layout values, not a canonical token fork. Future stricter spacing/type import rules may require role-routed changes and re-review.

No logo is used, so logo geometry/clear-space/minimum-size checks are **not applicable to current treatments**. The plain product name is text, not a recreated wordmark. Future logo use must select an approved upstream file without redrawing or altering its shape, preserve the documented clear space/minimum size, and use the approved background/variant. Do not substitute a locally drawn mark while waiting for approval.

## Import, version and checksum assumptions

This draft consumes source guidance by pinned reference and locally declared palette/fallback values. It does not claim a published package, runtime token import, automated update integration or approved checksum manifest. `brand-comparison.json` records observed source hashes and exact visual candidate hashes. The future BK-09 contract must define the authoritative import locator, allowlist, version/hash verification, fallback behavior and migration rules. Adopt that producer contract when accepted; do not create a competing brand importer here.

On a future allowed import, require the exact approved revision and approved artifact list, verify bytes against the producer's accepted manifest, preserve notices, and reject unknown/mismatched/revoked inputs. A checksum match alone cannot convert pending rights, approval or brand status to passed. Do not silently track `main` or treat a merged documentation PR as blanket asset approval.

## Actual side-by-side comparison

[Demo comparison](visual/brand-comparison/demo.html) and [announcement comparison](visual/brand-comparison/announcement.html) place a **labeled SPEC/token/voice summary**, including canonical color swatches, beside the **actual unchanged SVG candidates**. The reference panel is a first-party summary, not a screenshot of an approved brand board or a deployed product. Local Chrome rendered both at **1800 × 1300**; author opened and inspected both PNGs. Browser/Node versions, page errors/requests and exact hashes are recorded in the JSON. No external page requests or page errors occurred. Use the source links for full-size inspection; these comparison PNGs are review aids, not new campaign variants.

| Check | Demo workflow / supporting mockup | Announcement | Decision |
| --- | --- | --- | --- |
| Palette | Cream page, moss cards/stub, orange recovery backing; matching pinned palette | Ink stage, cream text, orange status backing, cyan rule | Author alignment observed; final owner review pending |
| Typography | Serif heading/system-sans labels; readable presentation adaptation | Same roles with larger feed type | Canonical fallback choice, not final brand approval |
| Logo | None; no redraw or geometry modification | Plain product name, no fabricated wordmark | Logo checks N/A for actual sources |
| Voice/evidence | Explicit conceptual/synthetic states, human review, blocked handoff and recovery | Draft concept, approval before production, unverified product/sponsor results, docs CTA | No capability/savings/sponsor proof inferred |
| Imagery/tiering | Fictional stub shape/text; no copied reference media or real identifiers | Text and first-party shapes only | No customer edition or external rights represented |
| Layout differences | Process diagram prioritizes state order and recovery over a product hero | Feed graphic prioritizes status, concept and CTA with larger text | Medium-specific draft adaptations awaiting owner disposition |

## Product and landing contract comparison

Read [product ownership](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/5a2986454297dd6df97088a8fbde69adc771f7a0/docs/architecture/OWNERSHIP.md) at **5a2986454297dd6df97088a8fbde69adc771f7a0** and [landing ownership](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/blob/3f28c8ac691374614354a8e53c1a2520e8c7854c/docs/architecture/OWNERSHIP.md) at **3f28c8ac691374614354a8e53c1a2520e8c7854c**. Source links remain subject to repository access. Their exact source hashes are recorded without copying restricted source bodies into collateral.

The documentation assigns design/order authority to the product and public introduction/static-root handoff to landing. It does not prove runtime, deployed routes or completed design/order actions. Current conceptual review/hold states respect that authority; the announcement CTA reaches pinned repository documentation, not a purported working application. Marketing examples remain synthetic and qualified. No landing/product screenshot or reviewed runtime preview exists at these pins, so visual-runtime parity is **not available**, not fabricated. Contract-level comparison can proceed without waiting for deployment; final integration and destination review remain separate gates.

## Open decisions and responsible owners

| Blocker | Owner / authoritative reference | Required resolution |
| --- | --- | --- |
| Approved pinned artifact subset/locator absent | Brand-kit producer/reviewer, [BK-03B #14](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/14) | Supply allowlist, exact revision/locator and approval record |
| Consumer import/hash/font/fallback/migration contract pending | Brand-kit and consumer reviewers, [BK-09 #15](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/15) | Approve the producer-owned contract; marketing can acknowledge it before final treatments |
| Two-treatment brand/landing review pending; named individuals not supplied | Brand and landing consumer reviewer roles, [MM-06 #7](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/7) | Record decision on exact candidate/hashes and resolve medium-specific adaptations |
| Product/landing runtime absent at consumed pins | Product/landing owners through their ownership references | Provide reviewed runtime evidence only when implemented; do not block safe draft comparison or claim it exists |
| Content/destination and independent candidate review pending | User-assigned marketing supervisor / independent Astra reviewer | Record exact-candidate decision; never substitute author alignment for upstream rights/brand authority |

Clarifications/overrides go to the relevant existing owner issue above with asset ID, exact pin/hash, failing use/size and proposed outcome. Do not redefine identity locally. A request or early consumer acknowledgement is not an approval receipt.

## Upgrade and rollback exercise

**Hypothetical scenario, not an actual upstream release:** a newly approved brand revision changes fallback families or orange usage. The migration impact list is DEMO-WORKFLOW-DIAGRAM-001, DEMO-SCREENSHOT-SET-001, DEMO-DECK-SUPPORT-001, LAUNCH-X-KEY-VISUAL-001 and LAUNCH-X-ALT-TEXT-001, including every related SVG/PNG/HTML/alternative and comparison preview.

1. Keep current source pins and historical candidate identifiable; mark affected results stale rather than silently current.
2. Request the new approved subset and BK-09 contract; validate revision/allowed paths/checksums/notices using the accepted producer mechanism.
3. Route UI changes to the authorized UI worker. Rerender all affected derivatives and recheck intended-size text, contrast, reading order, mobile alternative, limitations and CTA.
4. Have the general inventory/provenance owner update exact source/derivative lineage and hashes. Obtain refreshed independent candidate review and brand/landing/content/destination decisions. Preserve superseded history with explicit deprecated status.
5. If the new candidate fails, retain the blocked draft and document the reason. Roll back to prior exact bytes only when their rights, destination and approval are still valid; revoked/expired assets stay blocked. Old successful checks are not transferable to changed bytes.

The [brand evidence tests](../tests/test_visual_brand.py) ensure a missing approved subset or pending required approval cannot coexist with a passed conformance record, and bind comparison previews to actual candidate bytes. They enforce this record's integrity, not upstream authority or a competing release validator. Final MM-06 acceptance remains blocked pending the owner decisions above.
