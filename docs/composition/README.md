# Private deterministic composition mechanics

These engines implement local portions of PP-03 (#6), PP-02 (#7), PP-04 (#8), PP-05 (#9), PP-07 (#11) and PP-08 (#12). They are private implementation modules. The package root still exports runtime verification only. No canonical request, template, capability, approval, handoff or ProductionBundle schema is defined here. ART-03, ART-04 and ART-05 ownership and acceptance remain with the existing program owners.

Every corpus object, geometry, product reference, permission response and repair policy is explicitly synthetic. The dimensions in `tests/fixtures/composition/corpus.ts` are a drawing fixture, not a supplier SKU. The ticket baseline is pending. Postcard, card and art-print each have a pending P1 enable/defer decision; none is advertised as enabled or compatible with a real supplier.

## Local flow

1. The future canonical adapter resolves validated immutable creative/fact references, approved font bytes and layout policy, scoped asset bytes and current permission ports. The engine never fetches a caller URL or path.
2. `resolveLayout`, `resolveConstraints` and `parseComposition` parse inert JSON into frozen private nodes. Descriptors are inspected before Zod so getters, functions, exotic prototypes, cycles, symbols, unsupported fields and large sparse arrays cannot enter the model. Nested objects are strict. References accept only bounded opaque identifiers.
3. `composeArtifact` sorts nodes by unique integer order and font inventory by identifier; retains immutable source bytes as base64; parses assets; measures/shapes exact strings; builds escaped SVG; hashes the source artwork, model and render separately; and checks external composition applicability. There is no generation port in the engine. A fixture adds a throwing generation spy and asserts zero calls.
4. `inspectModel` deterministically evaluates geometry, transformed raster DPI, bleed coverage, safe zones, required slots, clipping, source/render/content/font integrity, explicit profile assumptions, transparency, warnings and final-file hook completeness. `inspectArtifact` additionally rechecks current external asset and composition permission.
5. `planRepair` produces an explicit immutable before/after plan under a resolved numeric policy. `applyRepair` compares the current immutable revision and composition hash, recomputes the plan to detect tampering, creates a derived draft, obtains a separate current mechanical permission bound to plan/policy/before/result, rechecks applicability and preflight, and invokes supplied final-file checks. It does not persist or publish a new mutable pointer.

## Geometry and identities

Coordinates use millimetres, top-left origin, and at most six decimal places. Unsupported or ambiguous units fail. Bounded rotation, translation, rectangular clipping, opacity and the `normal`/`multiply`/`screen` blend allowlist are explicit. Images require equal positive axis scales through the complete transform. Raster fit is `exact`, `contain`, or explicitly permitted `cover`; crop and rotation permissions belong to the selected slot. Text requires uniform scaling and final physical size within slot and repair bounds. Required foreground content blocks when later paint may intersect it or its own visibility combination is unsupported. Source pixels are never rewritten. Guides are tagged and excluded from ordinary SVG; proof inclusion requires both a proof request and the layout policy.

The composition fingerprint covers creative/fact/approval references and digests, scope, layout and input policy revisions, formatting rules, slot geometry, transforms, font inventory and renderer revision. Clock values, execution IDs and timestamps are absent. Current permission observations do not change content identity. SVG render hash is separate from source and model hashes. Derived revisions retain parent revision and repair receipt IDs. This is a content identity and immutable precondition check, not a competing durable store or a claim of transactional publication. A future adapter must use the existing `LocalArtifactStore` transaction/publication mechanisms when it installs a current revision; it must not invent another ledger.

## Typography

Approved byte and license hashes, OFL provenance, file format and actual PostScript identity are verified by `pinFont`. Fontkit 2.0.4 performs glyph coverage, shaping, advance and ink-bound measurements. Host fonts are never an approved fallback. Fallback follows the explicitly pinned field order. Alignment, alphabetic baseline, line height, direction, language and wrapping policy are explicit. Grapheme wrapping preserves every code point; explicit newlines retain line breaks. Default overflow blocks; there is no truncation or ellipsis implementation for facts or serials.

Display strings are untouched, including leading zeros, accents, apostrophes, combining characters and spaces. Date formatting requires a valid explicit UTC timestamp, locale, timezone and complete date/time options; invalid dates and unknown formatting fail. Required empty fields block. Optional slots can omit absent nodes, and empty optional text has no painted text node. Control characters and bidi embedding/override controls are rejected. Pure Arabic RTL is exercised positively with an approved pinned Arabic font. Mixed Latin/Arabic or incompatible explicit direction blocks. Other complex scripts require pinned coverage and fresh renderer conformance; this corpus does not establish universal script or bidi support.

Scoped content-integrity evidence records source/format value, source binding, row/field, chosen font, glyph IDs and measured bounds. Reports use safe paths and digest references and do not copy source strings into diagnostics. SVG text is XML escaped. The fixture content evidence is local and synthetic; production traces must remain reference-only.

## Asset safety and normalization

The scoped resolver supplies bytes only. Current permission is checked for identifier, version, digest, tenant/project, purpose, permission reference, expiry, state and composition applicability at consumption and at inspect/export/handoff. A lookup failure or unknown/revoked result blocks. No approval is issued by this module.

PNG signature, chunk envelope/order, termination, dimensions and every chunk CRC are checked before the pinned PNG decoder. Native zlib performs an independent bounded inflate with exact scanline-length and compressed-stream consumption checks. The supported subset is non-interlaced 8-bit PNG; interlaced and other bit depths block before PNGjs can reach an unbounded inflate path. Bytes are limited to 2 MiB, dimensions to 4096 and pixels to 4 Mi. Unknown chunks, embedded profiles, non-sRGB gamma, trailing containers and malformed data fail. PNG source bytes are preserved; raster normalization is deliberately unsupported because stripping color metadata is not automatically harmless. Untagged color is unknown and blocks required sRGB checks. JPEG, animated formats and arbitrary ICC/CMYK conversion are unsupported. Negative fixtures include a real compressed expansion bomb and corrupted sRGB metadata CRC.

SAX 1.6.1 parses a restricted SVG grammar. Bounds are 16 levels, 2048 elements and 16 attributes per element, with bounded numeric coordinate/list values. The subset supports SVG/group/rectangle/circle/ellipse/line/polyline/polygon/title/description, safe solid paints, opacity and explicit viewBox geometry. Scripts, handlers, style, foreignObject, images/links/use, entities/DTDs, processing instructions, external resources/fonts, arbitrary transforms and all path commands are rejected. Path/gradient/filter conversion needs a separately accepted implementation; nothing is silently dropped into a visually different logo. Normalization only reconstructs an already validated SVG, retaining meaningful geometry/title/description while discarding comments and lexical container differences. Original and derivative hashes/provenance remain distinct. The rendered normalization test proves identical decoded pixels on the fixture.

## Preflight and repair ports

Findings have stable code/version, spec revision, severity and operational state, affected safe path, observed/expected value and unit, repair eligibility and evidence reference. Reports sort by path/code without locale-dependent ordering. Opaque art must cover every bleed corner using inverse transformed geometry; an axis-aligned bounding box alone cannot certify rotated coverage. Effective DPI uses actual source/crop pixels and final scaled dimensions. Required fonts and content are remeasured and the SVG is regenerated for integrity comparison. Warnings need an explicit versioned allowlist; repairable findings block until resolved.

`FinalFileEvidence` is a **trusted private exporter adapter input**, not a user-submitted proof or a public schema. It binds exact composition/render/file hashes and parser revision, and requires unique passing dimensions/content/fonts/container/profile checks per required format. Missing, duplicate, stale, failed, unsupported or unknown checks block. Exporter ownership must supply actual byte parsing, output DPI, PDF page/trim/bleed boxes, fonts, container safety and profile evidence; a boolean-only fake is never consumer conformance. Tests label synthetic hook ports and distinguish them from the real draft inspection helper.

Repairs allow bounded text shrinking, safe text repositioning without overlap/crop, explicitly approved pinned fallback, and declared SVG container normalization. Names, dates, seats, serials, art, logos and semantic layers are never rewritten, added or removed. Missing rights, material changes, exhausted bounds/attempts, stale/tampered plans, no progress, oscillation or failed final-file checks return `NEEDS_EXTERNAL_REVIEW` and retain the original. Reapplication returns a no-op with current permission/preflight observation. An applied result is named `APPLIED_DRAFT`; absent final-file hooks remain unknown. The supplied history is bounded and must be persisted by the existing job owner for cross-process iteration accounting.

`handoffEligible` remains false and `productionEligibility` unknown even if all local synthetic checks pass. The canonical adapter must obtain accepted schema/package pins, real permissions, roster/spec and producer-consumer proof before it can expose production status.

## Reproducible verification

Use the existing pinned toolchain with `TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8`:

```sh
npm ci
npm run build
npm run typecheck
npm run format:check
npm test
PP_COMPOSITION_EVIDENCE_DIR=out/composition-render node --test dist/tests/integration/composition-render.test.js
npm run verify -- --suite composition --mode offline --evidence-dir out/composition-gates
```

When invoked standalone, the six named suites (`templates`, `composition`, `typography`, `approved-assets`, `preflight`, `bounded-repair`) execute their selected private units and the real offline render corpus, record local exit 0 on success, then intentionally return exit 1 with `external-blocked`. Release retains exit 1. Nested invocation is still affected by DUR-R4 until the separately owned dispatcher helper is integrated. The new adversarial regressions run directly through `npm test`; adding them to named-suite selections is part of that later handoff. No missing canonical pin or supplier fixture is fabricated.

Draft previews are SVG/PNG/PDF and normalized PDF using the unchanged sandbox-preserving private browser helper. Browser bytes/version, environment, actual custom painted fonts, independent shaping metrics, visible ink, parsed dimensions, PDF embedded programs and source/display identities are recorded. PNG previews are 96 DPI and fail the fixture's required output DPI. Profile conformance remains unknown. Chromium PDF extraction loses some Arabic mappings and trailing wrap spaces; affected PDF content checks fail. SVG/PNG positive complex-script evidence does not assert PDF exact-content conformance. Local macOS evidence does not certify remote Linux sandbox or rendering correctness.

See [acceptance mapping](ACCEPTANCE.md), [font provenance](FONTS.md), [visual evidence](VISUAL.md) and [independent review fix history](REVIEW-FIXES.md).
