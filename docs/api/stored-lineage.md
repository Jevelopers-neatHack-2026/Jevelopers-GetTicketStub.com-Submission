# Stored intake and reporting input lineage

Primary: Refs #11. Supporting repository criteria: Refs #8, #10, #18.
Refs #3 only for known snapshot input references; export delivery and
consumer/CFO acceptance remain separate. This additive Finance-local metadata
reader uses the already published intake and reporting tables. It does not
complete any linked issue, the export acceptance gate, or the financial release gate.

Import `createPostgresStoredLineageReader` from
`@jevelopers/cost-intelligence` or `@jevelopers/cost-intelligence/evidence`.
The factory exposes exactly two guarded methods. It neither changes the
existing evidence APIs nor publishes a new canonical operation or permission.

## Host composition

```ts
import { createPostgresStoredLineageReader } from '@jevelopers/cost-intelligence';

const reader = createPostgresStoredLineageReader({
  clock,
  financeAuthority, // current grants from the actual host authority
  database: {
    async connect() {
      const client = await restrictedPool.connect();
      return {
        query: (text, values) => client.query(text, values),
        release: () => client.release(),
        discard: () => client.release(true),
      };
    },
  },
});
```

The host supplies a PostgreSQL login that is a member of
`ci_finance_runtime` and is neither privileged nor a member of the owner or
migrator roles. It must configure finite connection and query transport
timeouts. The example's `discard` must physically evict an unsafe connection.
No default connection, credentials, grant, provider call or production
deployment is supplied by this package.

Both methods return a typed `ApiResult`. Invalid requests return
`VALIDATION_ERROR`. Changed or denied current authorization returns
`FORBIDDEN_SCOPE`. Missing capabilities, malformed stored metadata,
inconsistent references, privacy quarantine, timeouts and source failures
return `SOURCE_UNAVAILABLE` with no result value. Driver details and retained
partial metadata do not appear in a failed response.

## Intake references

```ts
await reader.readIntakeLineage({
  schemaVersion: '1.0.0',
  requestId: 'intake-audit-1',
  scope,
  selector: {
    kind: 'source_observation',
    sourceObservationId: 'observation-1',
  },
});

await reader.readIntakeLineage({
  schemaVersion: '1.0.0',
  requestId: 'posting-audit-1',
  scope,
  selector: { kind: 'posting_event', eventId: 'posting-1' },
});
```

This lookup follows the actual `0009_usage_intake` inbox, attempt and outbox
relations. Each observation returns operational identifiers, explicit source,
completeness and valuation states, three stored commitments, the direct
outbox status and posting reference, and the observed current attempt state.
It does not return usage quantities, monetary amounts, provenance strings,
raw observations or posting payloads.

| Stored field | Meaning returned by this reader |
| --- | --- |
| `payload_sha256` | Commitment to the intake producer's normalized scope and event facts; returned as `normalizedPayloadHash` |
| `idempotency_sha256` | The producer's stored idempotency commitment; returned as `idempotencyHash` |
| `provenance_sha256` | Commitment to the provenance reference string, not to original provider bytes; returned as `provenanceReferenceHash` |
| Direct outbox posting | Exact scoped ledger event ID and its stored event hash; its source observation, attempt identities and stored source-content commitment must agree with that inbox observation |
| Current attempt posting | Exact scoped event ID and stored hash; its own source observation must resolve to an inbox record with matching attempt identities and stored payload commitment |

An attempt's current observation can be newer than its current posting. For
example, a correction can be durably recorded for retry while the earlier
posting remains the current ledger head. The reader checks the head against
its own inbox observation; it does not require that observation to equal the
newest observation. Neither this current pointer nor an outbox status proves
billing finality.

A non-null global ledger pointer whose scoped join fails is inconsistent
lineage and produces no value. A stored `posted` outbox or current attempt
without a posting pointer is likewise inconsistent. Legitimate
`awaiting_evidence`, `pending`, `retry`, `suppressed`, `duplicate` and
`dead_letter` outbox states keep their exact stored status and nullable
posting. Unknown billing remains unknown; an absent reference never becomes a
zero amount or successful posting.

Successful intake results have `status: 'found' | 'not_found'` and explicitly
state `verification: 'stored_reference_match'` and `billingAuthority: false`.
The nested commitment marker is `stored_commitments_only`. These checks do
not re-fetch original source bytes or recompute the full ledger event.

The lookup returns at most 50 observations in ascending source-observation
order, with `truncated` and `result_limit_reached` if its protective bound is
reached. It does not provide a cursor or silently infer a complete search from
a truncated result. This limit does not broaden the producer's existing
identity rules.

## Known reporting snapshot input

```ts
await reader.readSnapshotInputLineage({
  schemaVersion: '1.0.0',
  requestId: 'snapshot-input-audit-1',
  scope,
  snapshotId: 'sha256:' + 'a'.repeat(64),
  postingEventId: 'posting-1',
});
```

This method accepts a known immutable `0012_reporting_snapshots` ID and one
posting ID. It reads scalar metadata and the stored
`inputEvidence.ledger` references for the recognized `1.0.0` and `2.0.0`
encodings. It does not enumerate snapshots or discover exports.

The supported identity requires the snapshot and normalized query to retain
the exact requested five-field scope, including the original creator
`actorId`, and the existing `ci08-reporting-policy-2.0.0` policy,
`2.0.0` normalized query schema, encoding, captured timestamp and stored query
commitment. A different current actor in the same database partition is
unavailable in this version. This preserves the original creator identity
without rewriting or claiming a more general host delegation rule.

Posting selectors and returned posting references retain the existing ledger's
opaque identifier alphabet, including IDs such as `event/1` and
`source:record/1`. URLs, query strings, fragments and user-information characters
remain invalid. This applies to posting IDs in the stored snapshot list as well
as the selected posting; an unrelated valid slash ID must not invalidate the
lookup. The older `EvidenceReference` contract and canonical intake identifier
rules are unchanged.

The stored ledger list is bounded at 50,000 entries. Every entry must contain
exactly a valid event ID and stored SHA-256 event hash, with no duplicate IDs.
Malformed metadata and unknown encodings return no value. The selected
reference must match the actual immutable ledger event in the same tenant,
project, environment and billing mode.

| Result status | Meaning |
| --- | --- |
| `recorded_input` | Exact event ID and stored event hash appear in the supported snapshot's input list and match the scoped ledger row |
| `not_recorded_input` | The scoped posting exists but does not appear in that stored list |
| `snapshot_not_found` | No snapshot with this ID is visible in the authorized partition |
| `posting_not_found` | The snapshot is present, and neither a stored selected input nor the requested scoped posting exists |

A selected stored input that cannot resolve to its original scoped posting
is inconsistent and returns `SOURCE_UNAVAILABLE`. It is not an ordinary
`posting_not_found` result.

Successful results always carry these limitations:

```json
{
  "verification": "stored_reference_match",
  "wholeSnapshotHashVerified": false,
  "inputMeaning": "recorded_input_only",
  "billingAuthority": false
}
```

The stored query hash and watermark ID remain commitments. This reader
intentionally does not transfer the complete mixed financial snapshot to
JavaScript merely to recompute its whole-content hash, and it does not
validate every field of that financial document. Use the existing verified
reporting snapshot API for that separate purpose.

The existing reporting encoding records lifetime ledger inputs for budget
context as well as period reporting. A posting outside the requested report
period can therefore appear in this input list without contributing to a
period total. Input membership says nothing about a displayed detail row,
reported total, export appearance, delivery, consumer acknowledgement, CFO
import, payment or provider settlement.

## Authorization and read consistency

Intake uses the existing `ledger.readSnapshot` operation and
`ledger.snapshot.read` permission. Snapshot input reads additionally require
`reporting.querySummary` and `finance.summary.read`. Both grants must name
the same principal kind, actor and membership or service-grant revision for
the entire call.

The reader snapshots request data and each raw host decision before shared
validation. It renews current authorization around awaited SQL boundaries
and retains both grants through the final synchronous freshness and expiry
checks. One grant cannot expire while waiting for the other and then be
treated as valid. A revision change, denial, clock rollback or expiry
withholds all retained metadata.

Each lookup uses a read-only transaction, four-axis RLS scope, restricted-role
and feature-capability checks, table locks, and the existing
`ci02-ledger:<tenant>:<project>:<environment>:<billing>` advisory partition
gate. Privacy quarantine is checked before protected reads and immediately
before commit while the gate remains held. No authority callback follows
commit. Both grants and the clock are checked synchronously through that
commit boundary.

The ordering guarantee uses the same controlled audit protocol documented in
[the PostgreSQL evidence reader](./evidence-postgres.md): every participating
privacy writer must acquire this partition gate before activating quarantine.
It does not cover arbitrary direct quarantine inserts, inherit an unmerged
all-writer fence, or make JavaScript/HTTP disclosure atomic with a host grant
epoch. The table locks exclude conflicting table and policy DDL; they do not
fence arbitrary concurrent changes to roles or core functions. Production
composition needs the actual host's coherent authorization and audit protocol.

External callbacks are bounded to two seconds; pool acquisition is bounded
to five seconds and a late client is released without starting SQL. A
cooperative monotonic 15-second budget prevents late continuations. SQL has separate
two-second lock and five-second statement/idle transaction limits. The
implementation never races an entire live SQL transaction and releases its
connection while that SQL is still pending. Host driver transport timeouts
remain necessary for live SQL and rollback; this is not a hard total-operation
timeout. Failed SQL, failed rollback or lost commit acknowledgement
physically discard the connection.

These repository-local controls require actual host composition. Synthetic
grant fixtures do not establish live host authorization or resolve the
separate export disclosure fence and acceptance dependencies.

## Additive migration and required evidence

`0015_stored_lineage_reader.sql` adds an outbox lookup index and an independent
`stored_lineage_reader_health` capability. It preserves predecessor SQL
checksums and the ten-migration Finance core. At installation it verifies the
exact scoped predecessor policies, original guard function bodies, six
trigger bindings including unrestricted update events, and the exact
validated intake foreign keys. Its capability detects subsequent catalog
drift. Temporary comparison policies are removed in the same migration
transaction.

The supported bootstrap prerequisite is that the installer of 0003 and 0006
is the database owner. Among the five functions bound by this reader, those
migrations leave
`reject_ledger_projection_mutation()` and
`finance_scope_matches(text,text,text,text)` owned by that installer; 0009
explicitly assigns its three intake guard functions to `ci_finance_owner`.
Migration 0015 verifies those named ownership boundaries and the reviewed
function bodies, language, result type, volatility, parallel mode and invoker
configuration. Its readiness fingerprint includes the database owner, each
function owner and definition, and function ACLs, so later changes fail
readiness. It does not transfer ownership or grant additional execution.
The fresh, previous-version and restricted-migrator fixtures use this
database-owner bootstrap topology. A host with a different bootstrap owner
needs an explicitly reviewed migration contract; an arbitrary existing owner
is not accepted. The existing [0006 handoff](./usage-intake.md#existing-0006-migration-role-handoff-to-0009)
preserves the two installer owners when the dedicated migration login assumes
the Finance owner role.

The conservative migration scanner allows only this file's reviewed complete
SHA-256 fingerprint and its four literal temporary cleanup statements.
Changed bytes, missing paired creation, moved cleanup or extra destructive
SQL do not inherit that allowance. The fresh database, previous-version
upgrade and reconnect migration checks explicitly require this feature.

The focused model suite is deliberately labeled synthetic:

```sh
npm run test:evidence -- --offline --suite=stored-lineage
npm run test:traceability -- --offline --suite=migration-policy
npm run test:exports
```

Required database checks use actual disposable PostgreSQL with synthetic
financial rows and host grants:

```sh
npm run test:evidence:postgres -- --offline
npm run test:migrations -- --offline
```

The evidence PostgreSQL selector includes both the previous ledger reader
and this intake/snapshot reader. Integration and release selection require
both files even when their model suites pass. Hosted CI retains the scoped
`artifacts/evidence/stored-lineage-postgres.json` receipt and the runner's
revision-bound manifests and database logs. The database fixture covers
public intake and reporting producers, outside-period input membership,
cross-partition and same-attempt reference corruption, malformed JSON,
authorization and quarantine recovery, and migration preflight refusal.

An unavailable PostgreSQL runtime is a blocked command with zero executed
database cases. It does not turn these required checks into model passes.
This slice leaves reconciliation and adjustment lineage, export discovery,
live host composition and accountable consumer/CFO acceptance open.
