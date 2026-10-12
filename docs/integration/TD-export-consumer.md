# TD export consumer: manual prepared CFO export (SYNTHETIC_EXPORT_CONFORMANCE_ONLY)

Status: bounded synthetic consumer conformance against the Finance export producer (`0c4c7024`, tree `377cd19b`, merged `ef6dee41`; candidate `f8e06f3d`, run 38254570860). Owner
acceptance: cost-intelligence issue 3 comment 6125399193. This is **not** an integrated export, not CFO delivery, not a consumer acknowledgement by Finance, not a mounted host, and
not a claim that the MVP is complete. `INTEGRATED` mode keeps export disabled: no accepted export port type exists.

## What the Dashboard does

`FinanceV2ConnectedView` offers a manual JSON/CSV export only when the host injects **both**

* `exportPort` (`kind: 'SYNTHETIC_EXPORT_CONFORMANCE_ONLY'`, `prepare(request) => Promise<unknown>`), and
* `exportAccess` (a **synchronous** reader of the host's CURRENT Dashboard access: `revision`, complete `scope` including the actor, `expiresAt`, `capabilities`).

Otherwise the section stays the fixed "Export unavailable" (no export props at all) or an explicit fail-closed reason (no port, wrong port kind, no access reader, `INTEGRATED`).

* Separate explicit permission: the host must state both `finance.read` and `finance.export`. Neither implies the other; Finance names (`finance.summary.export`), roles and
  look-alike strings are not aliases. `exportAccess().revision` must equal `authorization.revision`, and its scope must equal the view's scope.
* Original first snapshot only: export is offered only for the first page of the current identity (no cursor). A deep-linked or paged-to continuation page never exports.
* Renewal: the Dashboard re-reads `exportAccess()` and re-compares the view identity before the token await, after it, before the port call, after the port call, after validation
  and before anything is kept, again on a 250 ms watch while something is preparing or prepared, and immediately before a download hands bytes to the browser. Any veto drops the
  held bytes for good. A change of port, access reader, scope, actor, authorization revision, snapshot, hashes, filter, format, unmount or timeout aborts the run and discards its
  late answer even if the port ignores the abort signal.
* Source binding: the run is bound to a canonical-key-order value fingerprint of the WHOLE accepted source page (envelope, scope, filters, watermark, summary and its references), not
  just its snapshot id. The request and the expected binding use an immutable copy taken at prepare time. Any change of that page, including one with the same snapshot id and one made
  in place on the host's own object without a re-render, aborts a pending run, discards a prepared export and refuses the download. The fingerprint is a change detector, not a hash
  of anything financial. This holds for `usePreparedExport` and `PreparedExportPanel` used on their own, outside the connected view.
* An older run that was cancelled or replaced owns nothing: its late resolution, rejection or veto never clears or replaces a newer run's held bytes or state.
* The host port owns canonical validation and its own coherent final disclosure fence (Finance's `ExportDisclosureFencePort` is a host capability; the Dashboard neither rebuilds nor
  fakes it). The Dashboard additionally checks its own host access, as above.

## What the Dashboard validates in an answer (`checkPreparedExport`)

The answer is untrusted. Only the rich `ReportingExportReceipt@2.0.0` is accepted (the legacy `ExportRequest@1.0.0` receipt is `UNSUPPORTED_SHAPE`). Closed key sets, own data
properties only; `status: prepared`, `delivery: manual_prepared`, `deliveryReference: null`, `consumerAcknowledgement: pending`, `canonicalAdoption: proposal_only`,
`definitionsStatus: pending_owner_review`, `sourceEvidenceStatus: not_exposed_by_query`; exactly two artifacts `summary.json` then `metrics.csv` with the pinned media types, equal
to the manifest references; the UTF-8 byte length of each text equals its declared length; and the answer is bound to what the **host** stated: snapshot id, query hash, summary
(projection) hash, requested format, period (as instants), timezone, currencies, environment, billing mode and snapshot as-of, both in the manifest and inside the delivered
`summary.json` provenance and every `metrics.csv` row. A failure is a typed refusal with a path and **no bytes**; a typed producer failure keeps only its closed `code` and its
`safe_message` / body is never read, stored or shown.

`checkPreparedExport` is **async and is the only public path to an accepted result**: the structural check runs, then the real Web Crypto SHA-256 of each file's exact UTF-8 bytes is
compared with the manifest's declared `contentHash`; a mismatch (even an equal-length change), or no Web Crypto, is `CONTENT_MISMATCH` with a path and no bytes.
`checkPreparedExportIntegrity` is the same function under its earlier name. The structural step alone (`inspectPreparedExportStructure`) is internal, is not exported from the package
root, never returns `FinanceV2PreparedCheck`, and its success is typed `bytesVerified: false`. `usePreparedExport` uses the verified function before anything is held or offered.
The answer is bound to a **private baseline captured before the port sees the request** (a separate copy of the accepted page and scope); the request itself carries different,
deep-frozen copies, so a port that alters its request and returns matching bytes with a correct digest is still refused. Because Web Crypto is async,
all host access and source checks are repeated after that await, before the bytes are kept. A match proves only that the bytes are the ones the manifest declared; it is **content
integrity, not host authentication and not financial authority** (the manifest is as untrusted as the bytes), and no new hash is produced or offered as proof.

Not done in the browser, deliberately: no CSV or JSON generation, no aggregation, rounding, currency conversion or zero-filling (unknown totals stay JSON `null` / empty CSV
cells), no reconstruction of any snapshot, projection, query or artifact-set hash and no receipt authentication (those are the host port's; only the artifact bytes' own declared SHA-256 is checked), no invented aliases, timestamps or ids. The honest status shown
is `prepared` / `manual_prepared` with delivery reference "None". Artifact text is held in memory only, never rendered, and reaches the browser only as a `Blob` download on an
explicit click.

## Conformance inputs

`tests/fixtures/export-conformance` holds portable, digest-pinned inputs (no absolute paths): `PROVENANCE.json`, `candidate-pins.json` (17 receipts / 34 artifact files),
`candidate-receipts/receipt-00.json` and the pinned manifest schema as **data only**. Producer source and its synthetic disclosure host are pinned references in the handoff and
are never imported or executed. The producer's `prepared-export-request.json` is a structural fixture, not the actual PostgreSQL request, and is not copied or relabelled. The
earlier source-22 / pagination inputs are unchanged and re-pinned by the conformance test.

`node scripts/prepare-export-conformance.mjs <export-producer-handoff-0c4>` verifies all 34 artifact byte strings against the handoff pins and writes
`candidate-receipts/receipt-00..16.json`. Until it has been run and committed, the pinned suite checks receipt 0 only and reports the rest pending; set
`TD_REQUIRE_EXPORT_FIXTURES=1` to turn pending into a failure.

## Limits

No mounted selected host, no live Product issuer, no coherent live fence, no CFO import/delivery, no consumer ACK, no provider evidence, no actual business run. The producer
captured only `json`-prepared receipts, so CSV behaviour is covered with clearly labelled test-built receipts; in the fixture host a CSV request is answered with the exact
JSON-prepared receipt and is refused on format, which is the intended negative control.
