# Bounded cold-open WAL initialization

Refs #17 (PP-10B). This is a private storage bootstrap correction, not a
canonical row/job mapping, product approval, or release acceptance.

## Problem and boundary

`DurabilityDatabase` previously executed its initial WAL transition once. Even
with the existing `PRAGMA busy_timeout=10000`, SQLite can return `SQLITE_BUSY`
without invoking its busy handler when promoting locks. Independent processes
opening a new database could therefore fail before the schema transaction or any
production work began. The inherited limitation is also recorded in PR #46;
that PR's cursor-key/privacy work is separate.

SQLite's primary references describe both the busy-handler exception and the
need to inspect the journal-mode result:

- <https://www.sqlite.org/c3ref/busy_handler.html>
- <https://www.sqlite.org/wal.html#activating_and_configuring_wal_mode>

## Behavior

`src/internal/durability-wal.ts` retries only `PRAGMA journal_mode=WAL`, before
any application or schema transaction. It retries only native
`ERR_SQLITE_ERROR` with numeric `errcode === 5` (`SQLITE_BUSY`). Other errors,
including `SQLITE_LOCKED`, corrupt storage, or a transaction
already in progress, are not retried. Extended busy codes are not silently
mapped to this narrow bootstrap policy.

The total SQLite wait budget remains 10,000 ms, measured with the monotonic
performance clock. Each attempt receives only the remaining budget. Sleeps are
at most 10 ms; a second attempt cannot begin after the deadline. A separate
1,000-attempt ceiling also bounds the loop if time does not advance. These are
bounds on requested waits/attempts, not a hard real-time scheduling guarantee.
The original 10,000 ms busy timeout is restored afterward. Foreign keys and
`FULL` synchronization remain enabled by the constructor.

The returned journal mode must actually be `wal`. A backend that returns
another mode without throwing is rejected instead of silently claiming WAL
semantics. Constructor failures still close the connection and become the
existing safe `DurabilityError("STORAGE")`; settings-version and input-limit
conflicts retain their existing typed results. There is no fallback journal
mode and no database rewrite/recreation on failure.

No job, row, render, publication, outbox delivery, or application transaction is
retried by this helper. Existing fences, idempotency, cancellation, immutable
publication, and usage-attempt semantics are unchanged. No schema or contract
version changes, migration, runtime pin change, or new dependency is introduced.
The helper is internal and is not exported from the package API.

## Verification

After installing the repository's exact toolchain and dependencies:

```sh
npm ci
npm run build
npm run typecheck
npm run format:check
node --test dist/tests/unit/durability-wal.test.js
node --test dist/tests/unit/durability-bootstrap.test.js
```

The helper suite covers real file-backed WAL configuration and re-observation,
non-WAL refusal, transaction refusal, injected busy errors during prepare and
step, nonretryable errors, deadline exhaustion, no late attempt, and the attempt
ceiling. Fault-injected cases are synthetic, not claims of provider behavior.

The constructor suite starts 32 actual child processes in four synchronized
cold-open groups. It verifies every writer, one settings row, `wal`, the restored
busy timeout, foreign keys, `FULL` synchronization, and `integrity_check` after
reopening. It also covers incompatible settings, unsupported stored versions,
and unchanged corrupt bytes. All data is synthetic. Child processes belong to
the test and have bounded lifetimes; unrelated processes are never terminated.

Both new `.test.ts` files are discovered by the existing complete workload plan
and run in its standalone group. No file is removed, test count relaxed, timeout
extended, renderer substituted, or workload gate bypassed. Run all existing
pinned Linux workloads and the affected storage/recovery suites before merge.
Do not infer that a passing helper test qualifies the complete repository.

## Author evidence and remaining qualification

The original `durability.ts` at main
`89b5dd63c0a23dc27e62cfc235daa40dfe6d2002` has Git blob
`c22bece2b829316365546b90f1a476a1d12522f6`. An isolated, blob-verified source
snapshot was used; it was not a full repository clone.

On auxiliary Node 22.16.0 / SQLite 3.49.1, a replay of the exact original bootstrap
PRAGMA and schema with 64 synchronized processes produced 62 successes and two
`SQLITE_BUSY` failures at WAL setup (exit 1). The corrected helper on the same
64-process replay completed all 64 and retained every successful write and
`integrity_check=ok` (exit 0). The 15 helper tests passed with no failures,
cancellations, skips, or TODOs. The original failure evidence is retained; this
bounded sample is not a statistical guarantee about all scheduling conditions.

The auxiliary helper and tests were transpiled with TypeScript 5.8.3 and checked
with available Node type definitions 25.1.0. These are explicitly not the pinned
repository build/typecheck or native runtime. The constructor suite and full
pinned Node 24.21.0/npm 11.19.0/Linux renderer/recovery qualification were not run
in the author container, where the exact toolchain, dependencies, and Docker
were unavailable and direct clone failed DNS resolution. They remain required
on the exact candidate, together with independent Print maintainer review and
post-merge verification.

PP-10B.5's canonical draft-row representation remains with #13 and the Shared
and Product owners. This correction does not satisfy that dependency or close
#17, gate #3, or epic #1. Existing PR #46, #37, and the other active owner branches
remain untouched. The constructor change is outside PR #46's key-table/trigger
hunk; reconcile through the existing Print review/merge route.
