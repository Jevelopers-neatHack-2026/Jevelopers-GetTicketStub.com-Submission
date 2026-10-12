# Bounded private PDF semantic inspector

This continuation implements the parent-authorized parsed cluster/space inventory.
It supersedes the earlier local extraction-library limitation for the tested PDF
dialect. It does not grant exactness acceptance, independent approval, supplier
conformance or canonical readiness. The earlier mapping reports and unexplained
exporter failure remain immutable history. Final combined-candidate Astra review
is still required.

## Identity and output evidence

The later [complete paint identity policy](PDF-PAINT.md) supersedes policy-2
output acceptance with policy-3 and semantic-2/paint-1. The original semantic
mechanisms and findings below remain historical context; all literal, font and
geometry checks still execute under the new policy.

The output policy is now `private-output-2`, with explicit
`private-pdf-semantic-1_chromium-156_pdf-lib-1.17.1_fontkit-2.0.4` identity.
The final-file parser revision is `private-output-inspector-2_pdf-semantic-1` plus
the existing pinned parser versions. PDF producer metadata, policy/input pins,
semantic descriptors, checked-file proofs and complete report hashes change.
Old policy-1 private inventories are not silently reinterpreted as policy-2
evidence. Canonical migration/owner adapters remain absent.

`inspectPdfSemantics` reads actual PDF content streams, ToUnicode CMaps and embedded
TrueType programs. Reconstructed strings come from those bytes: ActualText replaces
its bounded marked glyph cluster; otherwise the CID's ToUnicode value is used.
ReversedChars changes cluster sequence order, preserving literal values within each
replacement. Explicit U+0020 remains in the inventory, including trailing spaces.
No expected source string is appended to output evidence. Parsed strings must equal
the immutable measured source lines exactly.

The inspector independently verifies font resource type/encoding, approved font
digest, every retained glyph outline/advance and used CMap's intrinsic source-font
mapping. SFNT checksums, glyph ranges, composite references/cycles and hint programs
are bounded and checked. For TrueType input, source subset instruction data is
read through the pinned fontkit public encoder. For WOFF2, a bounded Brotli/directory/
transformed-glyf reader extracts instructions from the approved source bytes using
[W3C WOFF2 section 5.1](https://www.w3.org/TR/WOFF2/#glyf_table_format). The embedded
hint tables and glyph instructions must match; vendor source is never patched.

ActualText cannot make wrong paint pass: the complete source-font glyph sequence,
positions, size, color and clip must agree. Each replacement is bound to the
corresponding shaped source cluster, including component glyphs with no independent
character and multi-character ligatures. Parsed source raster pixels must equal
approved opaque PNG pixels; unrelated or overlapping foreground paint is rejected.
The file digest, verified artifact identity, source render digest, cluster/glyph
inventory and font program digests enter the proof/report. Existing issued-output
seals, independent file/hash validation, final preflight and current permission
checks remain in the consuming path.

## Combining glyphs without changing literal text

Chromium can paint a licensed precomposed glyph while ActualText records the exact
original combining sequence. Literal output is retained from ActualText and compared
unchanged. The glyph-only relationship uses canonical decomposition properties from
the pinned Unicode 17.0.0 UnicodeData file, SHA-256
`2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c`.
This is a predicate relating an intrinsic font glyph to its replacement, not a
normalizer for request values or extracted text. Compatibility decompositions,
including Arabic presentation-form substitutions, are excluded. Source and parsed
literal strings are never trimmed, normalized or stripped of controls. The data's
[Unicode license](UNICODE-LICENSE.txt) is retained.

Glyph origins use the observed pinned dialect's 1/64 SVG-unit anchor serialization
and bounded accumulated 1/65536-unit displacement rounding. Basis matrices and
physical size remain checked. This tolerance is part of the declared inspector
identity, not a license to accept arbitrary position changes. Geometry mutations
and wrong source transforms fail the tests.

PDF.js raw extraction remains separate corroboration with its original digest and
literal-line-match result. Its known lossy Arabic and trailing-space result cannot
override the parsed glyph inventory or manufacture success. Poppler pixels/text
remain independent diagnostic evidence, not canonical acceptance or a production
renderer substitute. The [Adobe PDF 1.7 reference](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf)
and [ISO document-interchange errata](https://pdf-issues.pdfa.org/32000-2-2020/clause14.html)
ground ActualText, ReversedChars, text operators and nesting semantics.

## Supported dialect and bounds

The supported dialect has one page/content stream; Type0 Identity-H CIDFontType2
fonts with identity CID-to-GID mapping; finite bfchar/bfrange CMaps; scalar Tj,
Tm/Td/Tf text; small Span ActualText scopes; separately balanced ReversedChars;
opaque normal RGB paint; rectangular clips; simple path fills and approved opaque
Flate-compressed raster images. Unsupported operators, nested text/marked spans,
Form XObjects, soft masks, alternate font/filter encodings and ambiguous mappings
fail closed. This is not a general-purpose PDF consumer.

Limits include 16 MB file bytes, 2 MB decoded content/font/reference data, 100,000
tokens, eight token-container levels, 50,000 operations, 4,096 document objects,
16 fonts, 10,000 CMap/glyph entries, 512 text lines, 32 graphics levels and 128
glyph components with at most 16 composite-reference levels. Source-approved font
programs and source layout are additional constraints, not alternate output text.
Arbitrary supplier standards, PDF/X, CMYK, variable/CFF/vertical fonts and genuine
consumer/approval contracts are not claimed.

## Retained runner failure and diagnostics

The original exporter failure had only `failed-private-mechanisms/RUNTIME_FAILURE`.
Its original artifacts exist and have the common nonce, but the old helper discarded
the child cause. A source archive of the exact original head `29f33ca` was built
inside this owned worktree's ignored evidence directory and its actual 32-test
selection was invoked through the new independent runner. A pass is not a fix;
the first-run cause remains an open reliability limitation.

The expressly handed-off runner now records finite `child-exit`, `timeout`,
`buffer-limit`, `counts`, missing/JSON/schema artifact or unexpected classifications.
It records count/exit/signal/artifact-index states and hashes, never arbitrary
exception messages, test labels, stderr, environment values or credentials.
Counts, expected totals, fresh directories/nonces, artifact validation, deliberate
canary failures and inherited NODE_TEST_* clearing remain mandatory. Timeouts,
buffers and retry behavior are not relaxed. Missing evidence cannot become success.

COMP-R1..R5 private fixes, COMP-R6 stale-candidate compile failure, inherited DUR-R4
vacuity and all durability/runtime finding histories are preserved. The current
combined dispatcher uses the independent helper for all six composition suites;
its build, nested/standalone canary and fresh-evidence tests must run on this exact
head. Runtime `5daab7e3` is merged unchanged; the user reports both Linux runs passed
and new independent runtime review in progress. This worker infers no Linux or
independent approval and authors no security corrections. The new runtime review
received during this task reports original sandbox/IPC remediation but requires
changes for RUNTIME-R2: missing/nonboolean trace loss evidence can be accepted.
That finding remains with the runtime owner; this worker makes no security patch
or combined-candidate approval claim.
