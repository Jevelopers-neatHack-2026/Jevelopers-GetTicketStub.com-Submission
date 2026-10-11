# Complete private PDF source paint identity

`private-output-3` requires
`private-pdf-semantic-2_paint-1_chromium-156_pdf-lib-1.17.1_fontkit-2.0.4`.
Final-file parser identity is `private-output-inspector-3_pdf-semantic-2_paint-1`
with the existing exact dependency versions. Old records remain historical and
cannot be issued under this policy. No public schema or external acceptance is added.

The frozen policy-2 verifier accepted required vector omissions, page rotation,
image Decode inversion, a white transfer function and a line-shaped clip. Literal
text stayed correct while Poppler pixels were damaged. These are output failures
even though supplier handoff remained false. Original findings remain preserved.

`verifyPdfSourcePaint` independently renders the verified immutable source SVG,
embedded assets and fonts using the existing pinned offline sandboxed Chromium
launcher. The submitted PDF, its metadata and its export receipt cannot supply the
reference. Environment, executable, font and network guards remain unchanged.
The reference contains the complete mixed artwork and text. No dependency changes
are needed.

`pdfSourceGraph` compares the complete resolved page and catalog graph exactly.
Ordered content bytes bind every glyph, path, image, clip and state operation:
curve controls, winding, saves/restores, layer order and transforms. Every resource
dictionary and stream is bound, including fonts, image samples/color spaces/Decode/
interpolation/masks, alpha/blend/transfer, ICC defaults, optional content and page
orientation/units/boxes. Inherited Resources, MediaBox, CropBox and Rotate are
resolved along a bounded single-page tree; other inherited entries fail closed.
Unknown entries cannot match the approved generated graph.

Dictionary order and object numbers do not affect graph identity. Array order,
keys, scalar values and decoded stream bytes do. Only stream Length is omitted
because it describes encoded storage. Filter remains bound; unsupported filters
and DecodeParms fail closed. Metadata outside the rendering graph may change.
No numeric or pixel tolerance is added. Bounds/colors alone cannot license missing,
extra, shifted, recolored or mirrored paint. This accepts the generated dialect,
not arbitrary visually similar third-party PDF serializations.

Before pdf-lib parsing, an envelope check bounds objects/nesting and validates
classic xref offsets, direct stream lengths and the complete trailer. The loaded
document must reproduce submitted bytes exactly with the pinned serializer.
Duplicate keys/objects, incremental updates, trailers and parser recovery
ambiguities consequently fail closed. The basis is PDF 1.7 sections 3.4, 3.6.2,
4.3, 4.4 and 4.8, and installed pdf-lib 1.17.1 `PDFObjectParser`, `PDFParser`,
`PDFPageLeaf` and `PDFWriter` source. See the
[Adobe reference](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf).

Existing literal ActualText/ToUnicode, spaces, bidi, combining/ligature clusters,
source font programs/instructions/outlines and geometry checks still execute after
graph equality. Text evidence still comes from actual PDF bytes. The added proof
binds source SVG/artifact identity, actual/reference graph hashes, reference PDF/
pixel hashes and renderer/browser hashes. Semantic descriptors, final-file evidence,
full report and existing issued export/archive seals include it; the actual final
PDF digest remains separately bound. Stale policy identities are rejected.

The reference screenshot is diagnostic at 72 DPI with the maximum permitted
40-million-pixel allocation. PDF printing reloads the unchanged physical source
and does not use screenshot resolution. Actual export PNGs retain their requested
policy (the positive corpus is 300 DPI). Neither raster is an equality tolerance.

At most 128 successful reference digest records are cached by verified full source
identity, runtime pins and inspector revision. Submitted files cannot populate
references; reference bytes are not cached. Cold inspection, including archive
verification, can launch a local source-reference browser. This inspection calls
no production export API, job/attempt creation, image generation, publication or
usage emitter. Status and durable production-attempt counts remain unchanged.
Cold verification therefore requires the pinned local browser environment.

Bounds are 16 MB input, 4,096 objects, 32 graph/page/container levels, 20,000 graph
visits, 48 MB per decoded stream and 64 MB cumulative decoded graph data, plus all
earlier content/font/glyph bounds. General dialects, CFF/variable/vertical fonts,
CMYK/PDF-X, forms/soft masks and ambiguous structures remain blocked.

Permanent tests mutate real Chromium mixed raster/vector/font PDFs at both direct
inspection and final-file evidence issuance. They cover the five Astra mutations
and missing/extra/shifted/changed artwork, image bytes, Decode, page/inherited
transforms, clipping, alpha/blend/transfer and state reset. Changed approved source
logos fail against old PDFs and successfully export their own correct artwork.
The six Unicode fixtures and existing 300 DPI/box/font/ZIP/hash/status tests remain
required. Poppler raster inspection supplies independent diagnostic evidence,
not a tolerance-based acceptance substitute.

The frozen independent report records FINAL-PDF-1 through FINAL-PDF-4, including
the additional clip-text-line, clip-raster-empty and raster-over-text proofs. Their
saved PDFs and faithful permanent equivalents are tested under this new policy;
only a fresh independent review can disposition them. FINAL-LINUX-1 and FINAL-CI-1
remain open. OUTPUT-INT-1, OUTPUT-CSV-TIMEOUT-7 and OLD-COMBINED-LINUX-FAILURES
retain the reviewer's unresolved reliability holds. This paint change does not
resolve those histories. Contract/provider/app/
finance/fulfillment gates stay nonzero; whole-candidate review is still required.
