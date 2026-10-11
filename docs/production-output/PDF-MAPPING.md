# Exact PDF mapping investigation

Historical policy-1 investigation. The later parent-authorized implementation
and its still-pending acceptance are described in [PDF-SEMANTIC.md](PDF-SEMANTIC.md).
This history is retained; it is not a description of the policy-2 exactness oracle.

The frozen integration keeps requested Arabic and trailing-wrap-space PDF output
blocked as `OUTPUT_CONTENT / pdf.exactUnicodeOrWrapSpaces`. No production exporter
or exactness check is relaxed. The safe result of this investigation is a
reproducible limitation and a route for a reviewed future policy/renderer change,
not an exactness acceptance or an approval receipt.

## Observed bytes and readers

`production-output-pdf-mapping.test.ts` uses the actual pinned sandboxed Chromium
launcher, existing composition/font/permission checks and real output mechanics.
It saves synthetic diagnostic PDFs, PNGs, SVGs, decoded content streams, ToUnicode
CMaps and both default and normalization-disabled PDF.js extraction. These files
are labelled diagnostic and cannot be passed off as a production export. The
existing production inspector must still reject both rendered cases.

| Case | Actual source/bytes | Independent extraction |
| --- | --- | --- |
| Arabic | Original display is `مرحبا بالعالم`. Chromium emits `/ReversedChars BMC` and per-cluster `/Span ... /ActualText <FEFF...> BDC` with original Arabic letters. One logical baa spans two positioned glyphs. The font's ToUnicode maps several CIDs to Arabic presentation forms, and `0010`, `0013`, `0122` to U+0000 | Pinned PDF.js 6.4.299 returns isolated presentation forms and NULs in paint order. Disabling normalization gives the same failure. Installed Poppler recognizes the ActualText and returns original Arabic words with bidi controls; that is diagnostic corroboration, not an unchanged exact-string pass |
| Wrap | The original measured first line ends in U+0020. The PDF actually ends that text object in `<0003> Tj`, and the ToUnicode entry is `<0003> <0020>` | Both PDF.js extraction modes remove the trailing space. Poppler `-raw` also omits it at the line ending |
| ActualText control | A real Span wraps visible `Displayed glyphs` with UTF-16BE replacement `Original Unicode 0007 ` | PDF.js returns the visible string rather than replacement. Poppler returns replacement including the trailing space. This deliberately synthetic control is not an approved font/artifact fixture |

The PDF-rendered Arabic and wrap PNGs were inspected locally with Poppler. Their
visible glyphs and placement agree with the actual SVG source. Visible correctness
does not prove literal space preservation or machine-readable Unicode exactness.
No new output acceptance follows from this visual observation.

## Source-backed cause

The exact installed `pdfjs-dist/legacy/build/pdf.worker.mjs` is the relevant
consumer implementation. Its `getTextContent` marked-content handling reads tag
and MCID, but does not consume ActualText as replacement text. `runBidiTransform`
works from the glyph Unicode strings. `buildTextContentItem` defaults
`keepWhiteSpace=false`, advances over whitespace glyphs and retains whitespace
only when its heuristics infer an interior break. The public `streamTextContent`
API in `pdf.mjs` forwards `includeMarkedContent` and `disableNormalization`; it
does not expose `keepWhiteSpace`. The evidence index records these installed
source hashes. The direct probes establish behavior on the pinned package rather
than inferring support from an API name.

[Mozilla issue 12237](https://github.com/mozilla/pdf.js/issues/12237) documents the
same missing replacement-text behavior. The [PDF Association ActualText
definition](https://pdfa.org/glossary-of-accessibility-terminology-in-pdf/) explains
its use for content without a correct Unicode mapping and recommends small Span
marked-content scopes in PDF 1.7. Its [extraction
technique](https://pdfa.org/techniques-for-accessible-pdf/actualtext-provides-correct-extractable-characters-in-place-of-ocr-errors/UA1_Tpdf-G2_06/)
requires software supporting the corresponding tagged-PDF behavior. These sources
support the mechanism; local bytes and installed-reader probes determine the
current result.

## Feasible approaches and limits

| Approach | Assessment under this assignment |
| --- | --- |
| Add or expand ActualText spans in the owned exporter | Standard replacement text is feasible, and Arabic already has it. The current reader ignores it. Adding it cannot make the existing strict independent check pass. Whole-page replacement, hidden duplicate text or a metadata-only comparison would also disconnect semantics from painted content |
| Rewrite ToUnicode entries in the browser PDF | A narrow unambiguous CID mapping can be corrected in principle without changing paint. It is not a general cluster repair. Here one source letter is drawn as multiple positioned component glyphs, shared glyphs have U+0000 mappings, and paint order is reversed. Guessing one letter per glyph can duplicate letters or mis-map reused components. It does nothing to fix the reader's trailing-whitespace removal when the existing space mapping is already correct |
| Emit a new text backend with source-cluster-aware CIDs | Technically feasible as a separately reviewed renderer: preserve shaping cluster-to-source data, allocate CIDs by semantic cluster/occurrence, keep exact positioned approved glyphs and embedded font programs, and verify paint/geometry/font/Unicode behavior across the corpus. It is a substantial new backend, not a concrete safe patch to this Chromium serialization. The current reader can still discard trailing spaces, so this alone does not establish both required cases |
| Use an ActualText-aware independent reader or a parsed cluster/space inventory | A promising reviewed validation policy. It must independently parse actual bytes, bind each replacement to its painted cluster, preserve explicit spaces and handle ReversedChars/bidi without guessing, with wrong-metadata/paint/missing-glyph/tamper negatives and cross-reader evidence. Poppler results demonstrate why merely switching readers and checking normalized strings is insufficient. Current gates and pins cannot be silently changed |
| Normalize Arabic forms, delete NULs/controls, trim spaces, append expected source text or insert invisible text | Rejected. Those changes manufacture an expected answer or change literal content, rather than proving the requested unchanged data |

No concrete exporter-only fix identified here can satisfy both required cases
with the current pinned extraction check unchanged. Therefore production exactness
stays blocked. A future accepted mapping/reader-policy change needs a new output
policy identity, robust visual/semantic adversarial coverage, reviewed immutable
pins and current external approval applicability. It must not use a public local
schema copy or claim canonical supplier/app/fulfillment conformance.

## Frozen integration and gates

Durability `b5b96e04951561d44d1b8360d1a5f59d7ed63ce8` and runtime
`f413ef020629cb264eaf71a5a1df1e150fdc4b12` were merged normally with authorship
preserved. No security or durability source was authored by this continuation.
The preserved runner now requires 80/103/59 executed tests and 25 nonce-bound
artifacts per durability selection, including both bounded recovery process
artifacts. Output selections include the three mapping probes and their fresh
diagnostic evidence. Counts are never inferred from an exit-zero child alone.

The supervisor reports passed runtime PR Linux evidence and a failed push run
from nondeterministic page-renderer trace binding. ROOT-R1 remains open and its
active runtime writer owns that fix. This macOS worker adds no alternate launch,
sandbox exception or Linux certification. The third durability review received
during this continuation independently verifies DUR-R1..R7 on frozen `b5b96e0`,
with private code APPROVE and overall BLOCKED. It reviewed a stale merge candidate
and does not approve this combined head. Durability and composition findings
retain their full history; the final integrated candidate needs fresh review. Canonical
contracts, approved real roster/spec/permissions and unchanged-hash app/finance/
fulfillment consumer evidence remain absent; the named offline release must fail.
