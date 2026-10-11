# FINAL-LINUX-1: bounded synthetic coordinate checkpoint

This checkpoint preserves paint identity commit `4a28f985` and changes no production
geometry calculation, tolerance, literal/font/paint rule, inspector policy or
security/runtime/workflow setting. It is not a Linux fix or acceptance receipt.

The original full Astra report (SHA256
`3a6b1487c3d82ec89f38df962ca8771a959da6629d1972900583815e3127096a`)
records head `6880d356` Linux run `38111192191`: 492 tests, 462 passes, 30 failures,
zero skips/cancellations. Direct PDFs and all six Unicode positives fail at
`pdf.glyphPosition`. The dependent batch/CSV/personalization failures are actual
private failures. Candidate run `38111195604` timed out at the existing 20-minute
budget with unknown final counts; FINAL-CI-1 remains separately owned.

The complete retained head log contains 38 glyphPosition references but no numeric
source/PDF anchors, matrices or displacement arrays. A platform-specific cause is
therefore unproved. Host Docker is unavailable and must not be started or changed.
The parent must collect actual Linux arrays through the unchanged pinned CI route.

After clean install/build, run inside that exact existing secured environment:

```sh
node dist/scripts/diagnostics/pdf-position.js out/pdf-linux-position
```

Only an evidence-directory argument is accepted. Inputs are the fixed synthetic
Arabic, wrapped U+0020, combining, ligature, multiline and literal fixtures; there
is no customer/file/URL input. The existing renderer and environment/browser/font/
network/sandbox guards remain mandatory. The script does not call a production
export, job, publication or usage emitter. It directly renders diagnostic bytes,
then invokes the unchanged complete PDF inspector. Rejection remains rejection:
the script records it, collects the other fixtures and exits 1 if any fails.
An infrastructure failure emits a finite code, never arbitrary exception text.

Each fixture writes its actual PDF, 300 DPI PNG and bounded JSON before handing
control back. Numeric records include:

- Raw source anchor and existing floor(64)/64 anchor, node transform, physical
  source-to-PDF basis and measured advance/bounds.
- Source font unitsPerEm/ascent/descent/lineGap/bbox, fontkit glyph IDs/advances/
  offsets/pen positions and the unchanged expected origin/tolerance calculation.
  Empty-outline glyphs have an explicit null bbox and zero outline-command count;
  their advances and positions remain recorded, including U+0020 spaces.
- Actual PDF glyph CID/GID, full matrix, consecutive displacement, width, embedded
  advance, clip/color and font program/source digests.
- Actual Blink DOM character starts/ends, text bounds/advance and screen CTM,
  labelled by text/font digests rather than raw strings.
- Literal-source/actual digests, exact-literal equality, source/PDF/PNG/content/
  graph/pin/receipt/browser/sandbox hashes and the current inspection outcome.

Mismatched source/actual glyph counts are labelled composed-outlines-required;
the script does not invent a one-to-one mapping. Bounds are 16 lines, 256 glyphs
and clusters per line, 256 DOM character observations, 256 KiB per geometry record
and 1 MiB per formatted fixture JSON, in addition to existing PDF/font/parser
limits. Index JSON has a fresh UUID nonce and all six outcomes/digests. Source
text is never substituted for actual PDF evidence.

The next diagnosis must distinguish anchor serialization, cumulative displacement
quantization, and CTM/font-metric differences using the actual Linux arrays and
same-source macOS controls. Relevant pinned Blink/Skia/font implementation should
then explain the observed discrepancy before any bounded policy change. The
existing floor64/displacement65536 model is recorded for comparison, not extended
to Linux by assumption. No tolerance expansion or acceptance fallback is added.

Pinned-source inspection used Chromium `156.0.8078.4` DEPS, which selects Skia
`95ee33d7ec7791ab9c071675710a14fe6408ae4f`, FreeType
`891f904e2e7b4289f615598cd4b69832f87d2f3a` and HarfBuzz
`f5efbbef3841bdcdc6427bde7c2971f62ac8c8f1`. Skia's
[PDF glyph writer](https://skia.googlesource.com/skia/+/95ee33d7ec7791ab9c071675710a14fe6408ae4f/src/pdf/SkPDFDevice.cpp)
uses glyph-run positions and emits relative Td offsets. Its
[FreeType metrics code](https://skia.googlesource.com/skia/+/95ee33d7ec7791ab9c071675710a14fe6408ae4f/src/ports/SkFontHost_FreeType.cpp)
distinguishes linear advances from 26.6 advances. Blink's
[SVG layout algorithm](https://chromium.googlesource.com/chromium/src/+/156.0.8078.4/third_party/blink/renderer/core/layout/svg/svg_text_layout_algorithm.cc)
uses scaled-font fixed ascent/descent and floating positions. These are relevant
branches to investigate against real Linux values; none proves which branch or
coordinate discrepancy caused FINAL-LINUX-1. Downloaded source bytes and hashes
are retained in the local diagnostic evidence, outside the product tree.

The parent freezes/pushes the stopped writer's diagnostic commit, executes the
command within the existing digest-pinned Linux profile, preserves failures and
returns the six JSON/PDF/PNG files plus exact head/base/candidate/command/exit/pin
receipts through an explicit new handoff. Source work stops at this checkpoint.
After the measured fix, all required Linux head/candidate commands, post-test
sandbox/calibration proof, permanent positive/negative regressions and fresh whole
Astra review remain required. FINAL-PDF-1..4, FINAL-CI-1 and every retained history
remain intact. Public/canonical/spec/approval/finance/consumer gates remain nonzero.
