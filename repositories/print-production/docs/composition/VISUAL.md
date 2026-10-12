# Fresh fixture visual observations

Surface: fixed physical print drafts, rendered through the existing pinned offline Chromium helper with sandbox launch enabled. These are fixture previews, not an app UI or a supplier product. The working evidence corpus is generated at `out/composition-render/`; named suite runs additionally retain their own independent corpus under `out/composition-gates/<suite>/local/`.

The implementation worker directly opened the fresh PNGs for both attendees, combining marks, multiline text, long wrapped name, inert markup, pure Arabic RTL, shrink result and normalized-logo result. This is implementation-side visual inspection, not independent approval. No reviewer child was launched because the user expressly prohibited children/model switching. Parent review, remote Linux conformance and full acceptance remain pending.

| Fixture | Observation | Evidence |
| --- | --- | --- |
| attendee-001 | Zoë O’Connor visible; row 0002, seat 0007, serial 000123 retain zeros; logo and separator visible | `attendee-001/draft.png`, `content-integrity.json`, `evidence.json` |
| attendee-002 | Apostrophe and 0009 visible; supplied venue and date display string unchanged | `attendee-002/draft.png` |
| combining | Decomposed acute, ring and diaeresis paint as expected with pinned static Noto Sans; source strings remain decomposed | `combining/draft.png`, `content-integrity.json` |
| multiline | Anne and Marie occupy separate baselines; lower fact line and logo stay clear | `multiline/draft.png` |
| long-name | Two measured name lines stay inside the slot; no ellipsis or dropped content | `long-name/draft.png` |
| inert-markup | Literal `<b>Alice</b> & 0007` paints as text; no active markup | `inert-markup/draft.png` |
| rtl-arabic | Arabic joins and paints right-to-left with the approved pinned Arabic face; Latin serial remains a separate exact field | `rtl-arabic/draft.png`, painted CDP fonts in `evidence.json` |
| shrink-after | All 26 W characters paint inside allowed bounds after explicit shrink; source art and facts retain identity | `shrink-after/draft.png`, `repair-receipt.json` |
| normalization-after | Meaningful logo geometry, color and placement are unchanged | `normalization-before/draft.png`, `normalization-after/draft.png`; decoded pixel hashes match |
| repeat | Independent sandboxed browsers have identical SVG identity, decoded PNG pixels and normalized PDF bytes | `repeat-1/evidence.json`, `repeat-2/evidence.json` |

The machine oracle checks actual custom painted fonts through CDP, exact SVG text nodes, independent Fontkit advances (less than 0.03 mm difference), SVG anchor geometry, visible raster ink and parsed PNG/PDF dimensions. Every PDF font inspected in this final static-font corpus has an embedded program and an expected PostScript identity. Text is a real vector text layer, not a pasted screenshot. Raster artwork is intentionally retained as artwork and is not advertised as vector.

Color/alpha, alignment, fixed physical margins and visible content were inspected on the actual captures. Web theme, responsive phone/desktop layouts, focus/touch targets, loading states and animation are not applicable to this fixed print engine. There is no reference design or real enabled supplier template to certify visual fidelity against. No launch branding decision is implied by the synthetic colors or geometry.

The PDF draft has known non-passing content results for Arabic Unicode mapping and for trailing whitespace at a wrapped line boundary. Those outputs are saved for inspection, and final-file findings remain failed. PNG drafts are 96 DPI and fail the resolved fixture's required output DPI. Color/profile certification remains unknown. No rendered draft or current fixture port can enable a production bundle.
