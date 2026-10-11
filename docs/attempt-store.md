# Local durable submit-attempt store

This module implements the existing AttemptPersistence port with a local,
crash-safe JSON snapshot. It is intended for development and explicitly
simulated or sandbox integrations that need process-restart durability. It
does not provide a shared production database, an issuer, a finance decision,
or permission to release a reservation or repeat a provider effect.

## Opening a store

The package root exports `createLocalAttemptPersistence`,
`LocalAttemptPersistence`, `AttemptStoreError`, and their public option and
history types. After building, integrations can import the factory from the
package root and provide a
dedicated absolute directory, the immutable provider ID, and the immutable
mode (simulated or sandbox). Use a separate directory for each provider and
mode. The factory rejects non-absolute paths, symlinked path components,
directories or files owned by another OS user, and group/world-readable or
writable managed storage on POSIX systems. It creates private directories
with mode 0700 and files with mode 0600. On Windows, POSIX mode and UID checks
are unavailable.

The state is stored below .attempt-store-v1 in the selected directory. The
store reuses the repository's DurableJsonStore: each update is serialized by
an in-process queue and exclusive filesystem lock, written to a temporary
file, synced, and atomically renamed. A small root-level commit marker is
written after the first claim. Its presence distinguishes a deleted or lost
snapshot from a store that has never held a claim. If a process dies before
rename, the prior snapshot remains authoritative; a synced temporary file is
ignored. If it dies after rename, the new snapshot remains authoritative even
if the caller did not receive its return value. Stale locks are recovered
using the existing store's process-liveness check, not by expiring claims.
Malformed locks, corruption, missing committed state, unsupported formats,
and storage/access failures stop the operation.

A single `claimSubmitAttempt` call can fail with `storage_busy` when a live or
uncertain writer keeps the lock through the store's finite acquisition
attempts. The store does not promise that every competing caller will acquire
the lock or wait until it becomes available. In particular, a caller must not
turn a local contention failure into a retry of `runtime.submit`, provider
transport, budget/finance authorization, or another external effect. The
runtime fails closed as `persistence_unavailable` / `not_dispatched` when it
cannot persist its claim. The process-race tests use an opt-in, bounded
fixture-only retry for exactly `storage_busy`, always with the same immutable
claim record; that test mechanism does not change runtime behavior or grant
external retry authority.

The fixture retry deadline is a monotonic cutoff for starting the next outer
`claimSubmitAttempt`. It does not interrupt a claim call already in progress,
so an attempt that starts before the cutoff may finish after it. Fixture attempt
diagnostics record the cutoff duration, decision and start offsets, completion
offset, stop offset, and stop reason. Tests require every outer attempt to start
before the cutoff and require no retry after it. The 200 ms and 12 s
values are retry-start windows, not completion-time service-level guarantees.
The per-child process watchdog and readiness/gate timeouts remain liveness
bounds for their respective processes and harness steps.

Each attempt history is limited to 1,000,000 rows. An exact repeat at the
limit remains a safe no-op; a changed update beyond the limit fails with
`storage_unavailable` before changing either the snapshot or commit marker.

Each mutation validates the marker and the exact snapshot read while holding
the writer lock. A present marker paired with a missing or empty snapshot is
corruption; the mutation leaves those bytes untouched and cannot create a new
claim. Reads that observe the brief first-claim transition between snapshot
rename and marker publication re-read before deciding that committed data is
missing, so valid concurrent initialization does not appear corrupt. Every
history row must also match the provider-request and reservation-reference
requirements of its own state; cross-row monotonicity is checked separately.

Claims are permanent in this implementation. The store does not delete old
attempts or reclaim a key, action, or authorization because time elapsed,
provider idempotency expired, a reservation is uncertain, or a process
restarted. A claim is unique by provider, tenant/project scope, and
idempotency key; by provider, tenant/project scope, and action ID; and by
provider and authorization ID. A cross-scope authorization collision remains
fenced but returns no foreign attempt record. It binds the initial payload
fingerprint, claim owner, and authorization reference. Updates must preserve
that binding, advance the timestamp and effect/budget states monotonically,
and retain any reservation reference or provider request ID already recorded.
Reads and history are limited to the requested trusted scope.

Effect and budget states must be exact primitive strings from their declared
enums. The store does not stringify arrays, boxed strings, or objects to
interpret state values. Invalid caller values fail with `invalid_record`
before storage changes; malformed persisted records or history fail with
`corrupt_state` and are left unchanged.

The private snapshot format is versioned. Unknown versions, malformed history,
duplicate identities, and corrupt data fail closed without rewriting the
existing bytes. There is no automatic migration or recovery from an older
attempt-store format. Back up the entire dedicated directory as one unit;
restoring an older copy can lose claims made after that backup and is therefore
an operator-controlled recovery decision.

## Existing port limits

AttemptPersistence currently accepts a SubmitAttemptRecord with provider,
tenant/project scope, key, claim, authorization and action identities,
fingerprint, effect/budget states, optional references, and a timestamp. It
does not accept provider mode, a store revision for compare-and-swap, a
separate logical-operation/billable-attempt/transport-attempt identity, or an
accepted SubmitResult. Mode is consequently bound at store creation, while
the existing durable metering outbox continues to own its separate dispatch
identities. Atomic store locking and monotone state checks reject competing
claims and stale state regressions, but this port cannot express a complete
transport-intent protocol or distinguish a stale same-state update by
revision.

The runtime initially records a submit attempt as unknown before it knows
whether transport was called. On restart, an existing unknown, possible, or
confirmed attempt remains fenced; the local store does not infer whether a
provider accepted a request and cannot replay a cached successful response.
This preserves the runtime's conservative behavior and may require manual
reconciliation. The store does not mint or verify authorization, create an
authoritative financial hold, release funds, reconcile a provider outcome, or
blindly retry a provider request.

The package-root API is a private local-development implementation of the
current port, not an accepted canonical cross-repository schema or production
integration. It is not exposed as a separate package subpath. Snapshot
contents are plain JSON protected by local filesystem permissions; they are
not encrypted. Use only in a trusted local environment and do not place
secrets in attempt fields.

The local persistence and simulator evidence do not complete issue 11. The
current port cannot represent transport intent, compare-and-swap revisions,
or a cached accepted submit result. No issuer authority, authoritative finance
hold or release, provider outcome reconciliation, provider retry authority,
or production encrypted storage is supplied. Authorization and budget
decisions in the runtime scenario use synthetic fixture ports. The issue
remains open pending those contracts and integrations.

## Local validation

Build and run the standalone suite, then write the simulated verifier evidence:

    npm run test:attempt-store
    npm run verify:attempt-store

The suite exercises process restarts, simultaneous child-process claims,
crash barriers before and after commit, lock recovery, changed fingerprints,
retained ambiguity and reservation holds, expiry without claim release,
committed-empty and missing-snapshot mutation refusal, a deterministic
first-claim read race, malformed state/reference combinations in initial,
intermediate, and final history rows, cross-scope privacy, corruption/version
handling, permissions, and symlink rejection. Its process-contention fixture
publishes lock readiness through a complete same-directory temporary record
and an atomic no-clobber link. A real child pauses after the final link exists
but before the temporary name is removed; the parent verifies both names
contain identical bytes and that readiness names the live lock owner, then
requires the temporary name to be absent after child completion. The parent
also rejects absent, malformed, or schema-invalid readiness before treating a
child as the live lock owner. Its runtime scenario uses the
deterministic simulator and fixture authorization, budget, and usage ports. It
makes no provider or external finance calls and does not represent production
authorization or billing evidence.
