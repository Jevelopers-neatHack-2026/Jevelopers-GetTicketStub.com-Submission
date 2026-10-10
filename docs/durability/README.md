# Private local durability

These modules implement local storage, batch recovery and staged observations.
They are absent from the root package exports. They are not canonical API,
JobStatus, ProductionBundle, UsageEvent, EvaluationEvidence, authentication or
finance implementations. Issues #10, #17 and #18 remain open dependency gates.

## Running and observing

Use Node 24.21.0/npm 11.19.0, UTC and C.UTF-8:

```sh
npm ci --offline
npm run build
npm run typecheck
npm run format:check
PP_DURABILITY_EVIDENCE_DIR=/absolute/task-private/evidence node --test dist/tests/unit/durability*.test.js dist/tests/integration/durability*.test.js
npm run verify -- --suite artifact-storage --mode offline --evidence-dir out/evidence
npm run verify -- --suite restart-recovery --mode offline --evidence-dir out/evidence
npm run verify -- --suite metering-traces --mode offline --evidence-dir out/evidence
```

Each named verification suite runs actual private checks, saves local receipts
and crash/process artifacts, then exits **1** with status=failed and an explicit
externalState=external-blocked field, preserving the runtime receipt contract.
Release also exits 1. Passing local mechanisms cannot satisfy unavailable
canonical, supplier, app or finance semantics. CSV remains unsupported.

## Storage consistency and trust

`DurabilityDatabase` requires an absolute SQLite path in a private directory
(no group/other permission bits), rejects a symlink database file and sets its
mode to 0600. The caller manages that directory, capacity, access and backups.
Private raw row inputs and opaque pins are persisted for recovery; they are not
logs. Encryption at rest and a hosted adapter are not supplied.

SQLite WAL, FULL synchronous and foreign keys are enabled. Every mutation uses
BEGIN IMMEDIATE, a ten-second busy timeout and rollback on failure. Bytes reside
in transactional BLOBs, avoiding a filesystem/metadata dual-write window.
Process death rolls back unfinished transactions; committed bytes, output sets,
row state and observations survive together. This relies on local filesystem
SQLite locking/fsync guarantees. Network filesystems, power-loss on defective
storage, Linux CI and Windows behavior have not been independently established.
No claim of exactly-once execution is made.

`LocalArtifactStore.bind` consumes already validated/authenticated tenant and
project context, opaque canonical-request bytes and their supplied SHA-256.
It verifies the digest but does not normalize public requests. Its private key
framing hashes tenant/project and operation/key independently; these are local
index identities, not canonical source/composition/manifest/bundle fingerprints.
The future adapter must include accepted canonical refs, revisions, options and
trusted scope in the supplied request fingerprint and verify app authority.

Binding is transactional. Equal scoped key/digest returns the stable operation;
a changed digest conflicts. Logical operations remain separate even when their
bytes share a physical blob. Scoped metadata is checked before byte retrieval;
wrong scope and missing records both give NOT_FOUND. Existence of shared blobs
is not exposed. Diagnostics contain codes, generated IDs and digests only.

Stages are invisible to readers. Safe filenames are a bounded ASCII basename,
never a path; duplicate names, missing files, wrong lengths/hashes and writes
that change an existing name fail. Publication verifies the entire supplied set
and atomically commits one immutable publication per operation plus an outbox
observation. Repeated publication must match the set digest. Retrieval rehashes
every blob and the complete output inventory. `abandon` removes unfinished
stage links and unreachable blobs without changing committed history.

Completion grants no approval. Retrieval always reports handoffEligible=false.
`deny` provides irreversible local access denial without modifying output bytes;
canonical approval/revocation and handoff eligibility adapters remain upstream.

## Batch state and recovery

`DurableBatchEngine.create` persists the entire structured row plan before work.
It verifies opaque request/pin/row bytes and digests, binds the ordered row
identities/content, policy and pin digest to the key, defaults to atomic, rejects
duplicate row IDs and retains equal content under distinct row IDs. Raw row IDs
are hashed in storage and traces. Private plan framing is not a wire contract.
Version 1 database metadata and exact immutable limit settings are required on
restart; unsupported versions/settings fail, without guessing migrations.

Claims are serialized across processes. Per-row fences, attempt IDs, stage IDs
and lease deadlines guard completion and renewal. Storage itself also checks
row stage/lease ownership, preventing direct stale publication. Callers use
`renew` while long executions continue; an expired worker cannot acknowledge
success. `runOne` is a single-step scheduler port, not a background service.
It accepts AbortSignal and a renderer port; tests supply synthetic bytes only.
Unknown renderer errors become a safe permanent failure code.

Lease expiration records an interrupted attempt with unknown duration. Recovery
looks for a committed publication before retrying; uncertain committed output
is reconciled without rendering again. Otherwise an abandoned stage is fenced,
the row is queued after exponential backoff, and a new claim creates a new local
execution attempt. Retryable failures stop at maxAttempts. Permanent failures
never retry. Terminal row counts and total attempts provide monotonic progress;
inventory and results are paged under fixed limits.

Completion commits output bytes, publication, successful row state and attempt
observations together. A batch publishes an internal local-inventory.json only
after all rows are terminal. Atomic batches with any failed row publish no batch
receipt/results. allow_partial exposes all row outcomes, successful publication
refs and durable failures. This receipt is not a ProductionBundle manifest.
Successful row evidence remains stored even for failed/cancelled batches.

Cancellation atomically fences queued/running rows and records explicit outcomes,
preserves already completed/uncertain committed output and prevents further
claims. It cannot forcibly stop arbitrary renderer code; fenced storage prevents
late writes and AbortSignal lets a cooperative renderer stop. Cancellation of a
terminal job is a re-observation. Completed reads/submissions create no attempts.

Bounds cover rows, input bytes, output set bytes/files, queued jobs, concurrent
claims, execution retries, pages, pending delivery events and delivery retries.
Bounds are persisted and identical in every process. Immutable completed history
has no automatic retention deletion; operators need capacity monitoring/backups.
Outbox backpressure rolls back transitions rather than dropping observations.

## Staged observation semantics

Observation IDs, logical operation IDs, local execution attempt IDs and transport
attempt IDs are separate. Observations are immutable (database update/delete
triggers) and transactionally enqueued with actual publication/job transitions.
They carry scope/request digests, private job/row joins, safe codes, output refs,
units and measurement completeness. Bytes and duration are unknown when absent,
never inferred as zero. Duration is measured only for an observed end, not for
a killed worker. Row counts are explicit private plan counts.

Staging version 1 uses environment=local and billingMode=unclassified. Actual
producer build identity is unknown until supplied through an accepted provenance
port. There are no provider/billable IDs, prices, currencies or ledger writes.
The outbox transport uses bounded claims/leases, backoff and delivery attempts.
Failure/exhaustion preserves source observations; exhausted events require
explicit `requeue`. Delivery retries create transport records and preserve
source event identity. Uncertain deliveries are replayed after a crash.
Consumers must deduplicate source event IDs: an acknowledgment can be lost after
acceptance. A local synthetic sink is only a delivery-semantics fixture.

No raw input, names, signed URLs, secrets, scope strings or third-party errors
enter observations. The private DB is an input store, not a sanitized evidence
export. Export only allowlisted observations/inventories; never copy the DB as
public evidence. Production stage traces beyond jobs/persistence, canonical
mapping, real finance intake, Neatlogs and EvaluationEvidence remain blocked.

## Acceptance and handoffs

| ID | Independently executable local proof | Unmet closure/integration requirement |
| --- | --- | --- |
| PP-10A.1 | Opaque byte SHA-256 checks and scoped private identity framing | Accepted canonical hashing/ref/version/approval rules and adapter; distinct canonical source/composition/file/manifest/bundle identities |
| PP-10A.2 | Transactional scope/key binding, changed-input conflicts, two-process same-key publication, stable completed IDs | Accepted scope/idempotency/error contracts and app fixtures |
| PP-10A.3 | Separate logical operations, execution attempts, shared physical bytes; completed reads do not execute | Canonical attempt/billable semantics and authenticated cross-tenant application access |
| PP-10A.4 | Complete-set atomic publication, write-once checks, hashes, abandoned cleanup, killed transaction/stage/commit restart tests | Production manifests/export integration and independently reviewed hosted/platform guarantees |
| PP-10A.5 | Scoped status/read integrity, access denial, completion never grants handoff | Real canonical approval/revocation/eligibility and app authorization adapters |
| PP-10B.1 | Persisted opaque pin/row plan, default policy, terminal inventory and monotonic counts | Canonical job/progress/version definitions and actual #13/#16 integrations |
| PP-10B.2 | Atomic claims, lease/CAS/stage fencing, changed-plan conflicts, completed-row reuse | Accepted row identities, immutable renderer/template pins and actual production renderer |
| PP-10B.3 | Transactional checkpoint/publication, interrupted stage/transaction/commit recovery, uncertain-write reconciliation | Real ProductionBundle/ZIP/manifest transition fixtures |
| PP-10B.4 | Retry/permanent classification, bounded backoff, cancellation fencing, retained completed evidence | Canonical errors/cancellation policy and harness scheduler agreement |
| PP-10B.5 | No missing structured rows; atomic failure and allow_partial receipt/inventory tests | #13 accepted partial semantics; CSV #14 intentionally excluded |
| PP-10B.6 | No new execution on read; new attempts on retries; stable transport source IDs | Accepted common attempt and UsageEvent semantics |
| PP-11.1 | Local operation/job/row/attempt/observation/transport/output joins | UsageEvent/common errors/jobs, producer provenance and canonical mapper; provider IDs remain absent |
| PP-11.2 | Units, completeness, observed durations, explicit failed/retryable/cancelled/partial outcomes | Actual compose/preflight/repair/export metrics and canonical measurement definitions |
| PP-11.3 | Execution vs transport retries; cache/read never executes | Canonical environment/billing mode and real finance dedup semantics |
| PP-11.4 | Transactional immutable outbox, outage/retry/exhaustion, crash redelivery and bounded queues | Real #10 finance intake at accepted revisions; synthetic sink does not establish conformance |
| PP-11.5 | Safe IDs/digests/codes in persistence/job traces and sensitive-marker negatives | Agreed parent/correlation relationships and actual validation/layout/asset/preflight/repair/export spans |
| PP-11.6 | Offline outbox transport and privacy proof | Accepted Neatlogs/observability port, EvaluationEvidence, actual cost-intelligence intake and producer conformance fixtures |

#5 owns public shape publication, canonical adapter/package pins and root exports.
#13 owns actual structured production rows; #16 owns canonical bundle publication.
Shared-contracts #5-11/#22-24/#28-29 must deliver accepted definitions/revisions.
Cost-intelligence #10/#15 owns genuine intake conformance, valuation and ledger.
#19/#3 own integration/release evidence and accountable reviewer acceptance.
No issue, global ART/FIN/EVAL criterion, sponsor claim or release gate closes here.
