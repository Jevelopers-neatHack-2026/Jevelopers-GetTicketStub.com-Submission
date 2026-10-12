# Prepared financial exports — Finance proposal 2.0.0

Configured `exportSummary` prepares immutable files and returns the unchanged
`ExportManifest@1.0.0`. The integrations subpath also provides
`exportSummaryV2` and `getPreparedExportArtifacts`, which return the legacy
manifest, `ExportArtifactManifestV2@2.0.0`, and sanitized artifact bytes. These
are Finance-owned proposals. They do not adopt or replace shared
`FinancialSummary@1.0.0` in shared-contracts 0.3.0. The dashboard SDK 0.9.7 at
`d432ad5c` has a separate compatibility/consumer-acknowledgement gate.

This checkpoint verifies synthetic configured adapters only. The actual CI-08
PostgreSQL snapshot reader, producer hash agreement, mixed-mode query-to-export
oracle and consumer ACK remain pending. An unconfigured call returns typed
`SOURCE_UNAVAILABLE`; supplying a caller summary does not configure a source.

The configured-export tests produce executed synthetic examples in the local
`artifacts/export-samples/` directory:
versioned JSON, the metric CSV, both manifests and an external hash/byte-count
index. They contain fictional fixture amounts and pending-owner definitions.
They are import-format examples, not actual Finance/producer/consumer receipts.

## Host composition and authority

`ExportRuntimePorts` extends the existing runtime locally with optional
`exports.snapshotReader` and `exports.artifactStore`. Shared `RuntimePorts` is
unchanged. The provisional trusted reader contract is:

```ts
readVerifiedSnapshot({ scope, snapshotId, summaryContentHash, queryContentHash })
  // Promise<FinancialSummaryPage | null>
```

The reader must retrieve the immutable stored query page in the authenticated
tenant/project/environment/billing scope and verify its producer provenance.
It must never echo the caller's `summarySnapshot`. The exporter validates the
complete pinned canonical payload, exact scope, summary SHA-256, full expected
snapshot envelope, and absence of continuation pages. The pending producer
handoff must additionally establish the normalized query hash, policy and
watermark semantics against actual stored source rows.

Every operation requires current `integrations.exportSummary` /
`finance.summary.export` authorization before any source or artifact lookup,
serialization or storage. Current authority is checked again after each async
storage/source wait, before publication and after the persistence await.
The principal must have an active current membership/service grant and the
exact bound scope. `requestedBy`, application roles and display access are not
authority. Retrieval performs the same checks and freshly verifies the source.
The low-level artifact-store adapter is for a trusted host and is not an
independently authorized public endpoint.

Dashboard issuer actions `finance.read` / `finance.export` are not the Finance
permissions `finance.summary.read` / `finance.summary.export`. This module
does not translate or elevate them; an explicitly reviewed Product host
adapter and mounted issuer acceptance remain external prerequisites.

## Bytes, tables and redaction

Every preparation creates both `summary.json` and `metrics.csv`, regardless of
the selected manual-consumer representation. JSON is recursively key-sorted,
UTF-8, without BOM, with a final LF. Arrays retain their defined ordering.
CSV uses the existing protected encoder, UTF-8 without BOM and CRLF records.
Money is a typed canonical signed decimal at its declared scale; excess
nonzero precision is rejected, never rounded. Negative money stays numeric.
Unknown amounts are JSON `null` and empty CSV cells with explicit `unknown`
status. Missing metrics stay absent and unavailable.

CSV columns are `metric`, `definition`, `definition_status`, `status`,
`currency`, `scale`, `amount`, `valuation_basis`, `completeness`,
`reconciliation`, `period_start`, `period_end`, `timezone`, `environment`,
`billing_mode`, `summary_content_hash`, `query_content_hash`.

The finite proposed dictionary covers `expense`, `gross_sales`, `net_sales`,
`direct_costs`, `contribution`, `cash_receipts`, `cash_payouts` and `cash_net`.
Each included row carries its static definition, local definition hash and
the producer definition's version/revision/hash. All definitions remain
`pending_owner_review` under the documented CI-06 default mapping. Those
mapping versions are not proof that an arbitrary canonical source applied
CI-06: actual applied policy/allocation provenance needs the trusted query
handoff. Unsupported keys, currencies or definition contracts return typed
`UNSUPPORTED_VERSION`; this configured path does not silently export only
expense. Summary-wide valuation basis is retained as supplied and is not a
per-metric confirmed/estimated breakdown.

Phase 1 accepts only `evidenceMode: "mocked"` with an explicit host
`syntheticFixtureRegistry` binding the exact summary hash, policy reference and
every metric definition reference. Its mode must be `synthetic_only`.
Sandbox/live export preparation is rejected until an immutable Finance-owned
registered UUID definition/policy domain mapping and actual query reader are
reviewed. A synthetic registry cannot grant actual accounting authority.

Only approved static labels, dates, numeric amounts, currency/status enums and
necessary snapshot/summary references flow into artifacts. Tenant/project,
actor, customer, provider-request, financial-event and raw source-reference
IDs are omitted. Source hashes are retained; source revision text is hashed.
Unrecognized coverage/source names become `unclassified_source`, retaining
the gap count. Prompts, addresses, credentials, raw exception messages and
caller labels are never copied. Forecast and business-plan assumptions are
explicitly `not_supplied`, with empty arrays; none are inferred from events.

## Immutable preparation and retries

An idempotency key is scoped by tenant/project/environment/billing mode and
current actor. Its fingerprint includes the complete expected economic
snapshot, scope, format, destination and evidence mode. Snapshot `requestId`
and export `requestId`, `requestedAt`, `requestedBy` are transport metadata
and are excluded. Changed content under the same key returns
`IDEMPOTENCY_CONFLICT`. Public manifest `requestId` is the opaque export
reference, so caller text cannot leak into the handoff.

`createFileExportArtifactStore({ directory, receiptKey })` is a concrete host-managed
local adapter: it fsyncs one complete bytes-and-receipts file and publishes
that file using an exclusive atomic hard link. Existing files are never
overwritten. Concurrent preparations return the immutable original, including
its first actual `createdAt`. A lost persistence acknowledgement leaves the
original bundle available for a retry. The host retains a separate HMAC-SHA256
receipt key (at least 32 bytes) across restarts; it authenticates the full
immutable record, first actual preparation time and restricted source binding.
`verifyOriginal` checks the independently authenticated original before replay.
The exporter privately copies and freezes lookup/commit results immediately
when the adapter returns them. Validation, original-receipt verification and
the response use that same immutable copy across later authorization waits;
a shared adapter cache alias cannot change authenticated response bytes.
Coherently changing both public receipt timestamps therefore fails verification.
Tests use a fixture-only local key; no provider credential is loaded. Changing
the receipt key makes earlier records unreadable until the host restores the
original key; rotation/migration is a separate host lifecycle obligation.
Symlink files are not followed and
malformed, oversized or mismatched receipts fail closed. The host owns directory
permissions and lifecycle; this is artifact persistence, not a ledger.

Public snapshot/watermark references are opaque SHA-256 aliases. The raw
producer references stay in the restricted authenticated storage binding,
associated with the exact summary/query hashes, and never enter public files.
Shared `checkFinancialSummary` validates coverage, period, scale/currency,
policy and every independently registered UUID reference in addition to
structural validation. Request/scope and the trusted synthetic registry are
deep-copied and frozen before the first asynchronous authorization call.

Artifact hashes cover exact file bytes. `artifactSetHash` covers ordered
name/media-type/hash/byte-count receipts. Creation time belongs to preparation
metadata, outside those deterministic content hashes; it is actual trusted
clock time, never the query `asOf`. A frozen snapshot produces identical
content hashes even when a different export key is prepared later. Stored
receipt economics and bytes are checked against the freshly verified source
before replay. Requests, source envelopes and persisted bundles are bounded
to 1 MiB; at most 100 metric rows are supported. Errors carry opaque diagnostic
references and no source content.

`prepared` / `manual_prepared` records executed local preparation only.
`deliveryReference` stays null. No connector, delivery, sponsor plan,
owner-approved accounting dictionary, live billing completeness or consumer
acceptance is implied. CI-08X.1–.4 and DASH-04 stay pending until their actual
source, compatibility and external acceptance evidence is complete.
