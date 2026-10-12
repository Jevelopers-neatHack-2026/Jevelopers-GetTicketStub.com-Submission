# Private local production output

The current named `exporters` command can report scoped local conformance after
real output and supplied canonical-manifest byte checks. See the
[exporter conformance runbook](EXPORTER-CONFORMANCE.md) for execution, custody,
the retained 0.9.7 byte-metadata defect and release/approval holds. The historical
private-stage description below does not grant supplier or consumer acceptance.

Issues 13/14/15/16/19 now have executable local functions. They consume the real
private composition, assets, typography, preflight, repair, SQLite storage,
durable jobs and observation modules. These modules are not public canonical
operations. The package root still exports runtime only. No local inventory is
a canonical ProductionBundle, and no private publication is handoff eligible.
The executable shared-contracts candidate is unaccepted; see
[candidate intake](../contracts/candidate-intake.md) and
[combined runner diagnosis](RUNNER-DIAGNOSIS.md) for current owner holds.

## Functions and boundaries

`planRows` parses stable IDs and exact strings with an explicit template field
mapping. Duplicate IDs fail the entire plan; equal values under different IDs
remain distinct. Missing, extra, non-string and overlong field values have
per-row validation errors. Personalization changes only the approved personal
display nodes; event/fact and approval identities remain unchanged. The future
accepted adapter must supply the authoritative allowlist and current approval
ports. A synthetic permission port grants no real approval.

`createPrivateBatch`, `privateBatchRenderer`, `runPrivateBatch` and
`privateResultPage` use the durable engine. Default policy is atomic; partial
publication requires `allow_partial`. Failed/cancelled/processing atomic batches
expose no completed batch refs. Row results retain ordinal, stable ID, submitted
digest, job, operation, publication, archive digest and typed error. Rendering
failures have immutable private diagnostic publications with code/path/digests,
never raw values. Diagnostics are failed local records, not successful rows.
Paging, queued jobs, attempts, input/output bytes and concurrency use the engine's
limits. The example adapter executes at most that concurrency and stops when
no row can be claimed; a scheduler must call again when retry backoff is due.
Output bytes are bounded per row, so the whole batch upper bound is row count
times the configured per-row output limit. Cancellation fences publication;
it does not promise immediate Chromium termination.

`parseCsv` uses exactly pinned csv-parse 6.1.0. UTF-8 is decoded fatally; an initial
BOM is accepted. Delimiter and LF or CRLF record separator are explicit, quote
and escaped quote are double quotes, and cells are never trimmed or coerced.
The exact header mapping rejects missing/extra/duplicate/ambiguous columns.
Limits cover bytes, rows, columns, cell bytes and record size. Stream writable
and readable high-water marks are one; each upstream chunk is also limited by
the total byte bound. Physical ending line, logical record, complete byte offset,
header paths and file/dialect digest travel with each row.

Checkpoint resume replays the whole authenticated stream, validates the previous
complete record boundary and emits the suffix with unchanged identities. It is
not a byte-seek shortcut. `createPrivateCsvBatch` consumes the entire bounded
stream and validates its final digest before creating any durable job. Syntax,
encoding and file identity failures schedule nothing. Structured row errors
then use normal atomic/partial execution. Formula and markup values stay inert;
`csvErrorReport` prefixes dangerous diagnostic cells without changing source
values. Baseline CSV is disabled because the approved roster is absent; the
conditional implementation is tested with explicitly synthetic enablement.

CSV preserves CRLF within quoted cells. The inherited typography boundary only
accepts LF in display text, so such cells remain exact parsed strings and are
blocked for rendering when they contain CR. The typography owner must agree any
approved newline semantics; this adapter does not silently rewrite cells.

## Actual file policies

`exportPrivateFiles` checks current identity, model preflight and permissions,
then uses the existing pinned sandboxed offline Chromium launcher. There is no
alternate launch or network path. A live DOM checks each exact line, independent
shaping advance/anchor and actual custom font identity. SVG stays exactly the
composition SVG: raster artwork bytes are embedded unchanged; text/shapes are
vector content. Mixed raster/vector output is recorded truthfully.

PNG pixels are round(mm × selected DPI / 25.4), default 300 DPI, never below the
resolved minimum. PNG contains parsed CRC-checked pHYs and sRGB chunks and opaque
RGB pixels against the layout background. Its pixel digest is separate from
its serialized byte digest. Pixel and total byte limits apply before rendering
and during independent inspection.

Plain PDF has exact MediaBox/CropBox, top-left-to-PDF converted TrimBox/BleedBox,
embedded fonts and a verified ToUnicode stream. Creation/modification dates and
producer metadata are normalized. The renderer's real 536-byte Skia sRGB ICC
program is pinned by SHA-256
`d9f822e8083f2f4d1c91e887454be5f75e8c7144b2853408f361e3c4a7a6b36d`.
Images use its ICCBased space; DefaultRGB binds vector RGB to the same profile.
Gray image spaces are permitted. PDF/X, CMYK and arbitrary ICC profiles are
unsupported; no conversion or certification is asserted.

The parent-authorized policy-3 semantic inspector now reconstructs exact strings
from bounded PDF cluster/CMap bytes and validates the painted licensed glyphs,
instructions, geometry, colors, spaces, source raster and hash binding. Literal
strings are unchanged. PDF.js results remain separate known-lossy corroboration.
The earlier policy-1 Arabic/wrap-space rejections remain in immutable evidence;
the new private proof requires independent full-candidate review before acceptance.
An explicitly supplied SVG/PNG-only template can render Arabic. This is a local
capability fixture, not permission to change a real launch roster. Other Unicode
cases also fail closed when exact extraction cannot be proved.

Independent SAX/PNG/pdf-lib/PDF.js inspection binds file hashes and actual
dimensions/content/fonts/container/profile checks into the real final preflight
report. Archive assembly accepts only the actual issued export object, verifies
its full digest including current bytes, reinspects copied bytes and checks
current permission again. A caller-written or mutated receipt cannot certify
an export. This process-local provenance seal is not an external approval.

## Inventory, hashing and storage

`assemblePrivateArchive` emits `private-output-inventory` version 1, explicitly
external-blocked. Its source descriptor contains scoped refs/digests for design,
facts, approval, model/render/revision, layout/template, source/display assets,
font/license pins, policy/renderer, repair receipts and row/batch/CSV lineage.
Raw attendee values and source URLs are excluded. Final report descriptors carry
the actual full report hash, checked-file proofs, findings and readiness; raw
text-bearing bounds stay out of the inventory.

Hash order is payloads → private inventory bytes → ZIP bytes. Payload descriptors
list every SVG/PNG/PDF. The fixed controls are `private-inventory.json`,
`archive.zip` and `detached.json`. The ZIP contains exactly payloads plus inventory;
detached metadata sits outside it with manifest and archive hashes. Controls do
not recursively list/hash themselves. None of these bytes are canonical owner
manifest bytes; mapping waits for accepted shared contracts.

ZIP creation uses fflate 0.8.2 at store level 0, sorted safe ASCII relative names,
2000-01-01 UTC timestamps and regular file permissions. Independent yauzl 3.2.0
inspection checks sizes, CRC, SHA-256, file set, entry type and bounded expansion.
Reconstruction equality rejects hidden prefixes/trailers, duplicate entries,
unsupported compressed containers and alternate metadata. This verifier accepts
this declared deterministic ZIP dialect, not arbitrary third-party archives.

Rows stage complete bytes and publish through the existing SQLite engine.
`verifyPrivateArchive` requires trusted detached hashes, the current artifact,
lineage digest, output policy and specification; it rejects missing/extra/tampered
files and reinspects their bytes. `retrievePrivateArchive` checks opaque storage
scope/access plus current permissions. Cold PDF inspection can launch a sandboxed
source-reference browser; see [complete paint identity](PDF-PAINT.md). These
functions create no production attempt or usage observation. Read-only repeat
status/verification is tested.

## Verification and holds

Node 24.21.0 / npm 11.19.0, UTC, C.UTF-8 are required. Added parser/ZIP dependencies
are exact pins in the npm-generated lock. Real fixture specs and permission ports
are synthetic; external contracts, creative/event authority, supplier roster,
app, finance and fulfillment revisions remain null.

```
npm ci
npm run build
npm run typecheck
npm run format:check
npm test
npm run verify -- --suite release --mode offline --evidence-dir out/production-output-final-gates
```

The release command must exit 1. Each private leaf requires exact executed/pass
counts, zero skips/failures and fresh artifacts plus an independently executed
canary. All six composition selections now use the frozen independent runner,
clear inherited NODE_TEST_* variables and include the composition review fixes.
Passing private leaves retain external-blocked outer receipts. Nested test-context
regressions deliberately fail canaries and reject inherited success receipts.

Frozen prerequisite merges are `4f11723f59b44da574738e3e45a14043aad23fe9` and
`0282c2d4ad31691b2bf4e8cb91e87619983a7204`. The continuation also integrates frozen
durability `b5b96e04951561d44d1b8360d1a5f59d7ed63ce8` and runtime
`f413ef020629cb264eaf71a5a1df1e150fdc4b12` normally, preserving authorship.
DUR-R1..R7 were independently verified for frozen durability head `b5b96e0`
in the supervisor's third review, whose overall verdict remains BLOCKED. That
review does not approve this combined output/runtime head; its final candidate
still needs fresh independent disposition. ROOT-R1
remains open: the supervisor reports a passed PR Linux run and a failed push
trace binding; the active runtime owner handles that nondeterminism. Local
macOS evidence cannot certify the final Linux candidate. No later active writer
changes are guessed or imported.
Parent owns manual QA, independent review, push and any merge/closure transition.
[Acceptance matrix](ACCEPTANCE.md) records local proof separately from external
acceptance. This work does not mark ART-03/04/05 or release complete.

[PDF mapping investigation](PDF-MAPPING.md) records the earlier source evidence.
[PDF semantic inspector](PDF-SEMANTIC.md) records the new policy, parsed evidence,
bounded mechanisms, rejection corpus and retained reliability limitation.
