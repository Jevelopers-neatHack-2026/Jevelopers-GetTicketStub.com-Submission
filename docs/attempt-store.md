# Local durable submit-attempt store

This module implements the existing AttemptPersistence port with a local,
crash-safe JSON snapshot. It is intended for development and explicitly
simulated or sandbox integrations that need process-restart durability. It
does not provide a shared production database, an issuer, a finance decision,
or permission to release a reservation or repeat a provider effect.

## Opening a store

After building, repository-local integrations can import
createLocalAttemptPersistence from dist/attempt-store.js and provide a
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

Claims are permanent in this implementation. The store does not delete old
attempts or reclaim a key, action, or authorization because time elapsed,
provider idempotency expired, a reservation is uncertain, or a process
restarted. A claim is unique by provider, tenant/project scope, and
idempotency key; by provider, tenant/project scope, and action ID; and by
provider and authorization ID. It binds the initial payload fingerprint,
claim owner, and authorization reference. Updates must preserve that binding,
advance the timestamp and effect/budget states monotonically, and retain any
reservation reference or provider request ID already recorded. Reads and
history are limited to the requested trusted scope.

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

This module is intentionally not re-exported from the package root, and is
not a supported package subpath. It is a private repository-local
implementation of the current port, not an accepted canonical cross-repository
schema or production integration. Snapshot contents are plain JSON protected
by local filesystem permissions; they are not encrypted. Use only in a
trusted local environment and do not place secrets in attempt fields.

## Local validation

Build the project, then run the standalone suite:

    npm run build
    node tests/attempt-store-suite.mjs

The suite exercises process restarts, simultaneous child-process claims,
crash barriers before and after commit, lock recovery, changed fingerprints,
retained ambiguity and reservation holds, expiry without claim release,
corruption/version handling, permissions, and symlink rejection. Its runtime
scenario uses the deterministic simulator and fixture authorization, budget,
and usage ports. It makes no provider or external finance calls and does not
represent production authorization or billing evidence.
