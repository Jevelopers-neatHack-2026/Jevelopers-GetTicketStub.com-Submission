# Exact Finance export producer handoff

Original source `0c4c7024c68b5a52a12f3de3cec891f64aa65bd3`, tree
`377cd19beeafad222b19cd8e1b057552196f64df`; actual merge
`ef6dee41fdce642bc1b90a2acb2640226ec699fe` has that identical tree.
This packet preserves the reviewed candidate checkout
`f8e06f3d9b8c4d98e67b616f869e1392c74b8996`, run `38254570860`, artifact
`11749324572` and independent review SHA256
`54b83d444b9baa58f8733876894cfb0e182e5176769a42cdf4d91fd53e6b6bdb`.
Main run `38255883018` is separately verified in the referenced post-merge report.

Read `export-producer-handoff.json` for exact functions, request/response fields,
errors, schema/registry pins, test commands and limits. `source/` contains
committed source/schema/fixture bytes. `candidate-postgres-composition.json`
contains 17 captured receipts. `candidate-artifacts/receipt-00..16/` contains
34 exact `summary.json`/`metrics.csv` byte files and response envelope examples.
The response envelopes are formatted examples wrapping actual captured values;
the JSON/CSV artifact files are exact bytes from that candidate run.

Use the top-level `@jevelopers/cost-intelligence` public barrel and
`createReportingExportRuntimePorts(reportingPorts, legacyStore,
reportingStore, disclosureFence)`. Both query-backed versions require the
fourth coherent host capability at runtime. Missing capability refuses all four
creation/retrieval paths before protected source/store I/O. `acquire` gives an
owner-private revision-bound permit; `validateCurrent` is synchronous and
returns one immutable current context/principal/read/export snapshot. No async
polling, cached grant, caller proof or permission alias establishes this fence.
Exact Finance operations are `reporting.querySummary` / `finance.summary.read`
and `integrations.exportSummary` / `finance.summary.export`.

Pass the original stored first query page, including full aggregate even when
`hasMore` is true, to `exportSummaryV2`; retrieve through
`getPreparedExportArtifacts`. Use the combined request validator for nested
canonical semantics. A continuation conflicts. Caller summaries/hash/evidence
labels do not provide source authority. Replay renews current authority and
returns original authenticated preparation time and deterministic bytes.
Unknown amounts remain null; currencies and actual/simulated amounts stay
separate. Outputs are manual prepared files with no delivered/import claim.

The committed prepared-request fixture is a structural synthetic example,
not a reconstructed request for the captured candidate snapshots. Actual PG
request construction is pinned in `tests/exports/query-export-pg.test.mjs`.
Reporting22 producer/fixture labels describe source lineage only. This packet
is the exact export0c4/actualef6 handoff, not a relabeled Finance22 packet.

Candidate and main ran actual hosted PostgreSQL with synthetic postings and a
single-state synthetic authority fixture. No mounted real issuer, selected real
business run, paid provider bill, Dashboard/IE ACK or CFO import exists. Shared
canonical adoption and definitions remain proposal limits. Bounded synthetic
consumer conformance may use this packet; issue #3/global11/SPN03 are not closed.
