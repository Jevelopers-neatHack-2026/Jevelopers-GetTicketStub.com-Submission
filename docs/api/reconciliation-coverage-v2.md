# Reconciliation coverage-only dry runs

Refs [CI-07 / issue #16](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/16).

This repository-owned version 2.0.0 boundary can persist and read immutable **source coverage metadata** for a dry run. It does not implement financial matching, calculate a variance, apply corrections, settle reservations, or release holds. Every successful result remains `status: "needs_review"`, with `financialEffects: false`, `billingAuthority: false`, and all four financial stages explicitly `unavailable`.

The existing version 1.0.0 reconciliation request/result contract is unchanged and remains `RECONCILIATION_PENDING`. The explicitly named coverage methods leave startReconciliation/getReconciliation untouched, including the separate budget-reconciliation work in PR #43. The new schemas are a Finance-local versioned interface; they do not amend shared-contracts or establish consumer/global acceptance.

## Public interface and host composition

Both the package root and `@jevelopers/cost-intelligence/reconciliation` export:

| Public symbol | Purpose |
| --- | --- |
| `startCoverageDryRun(CoverageDryRunRequest, ReconciliationCoveragePorts)` | Resolve exact imports, inspect coverage metadata, and atomically create or replay a run. |
| `getCoverageDryRun(CoverageDryRunReadRequest, ReconciliationCoveragePorts)` | Read a protected persisted run with deterministic pagination. |
| `createPostgresCoverageRunStore(database)` | Supply the PostgreSQL implementation of `CoverageRunStorePort`. |
| `getCoverageImportContentHash(record)` | Validate and hash normalized metadata. This does not read provider bytes or grant provider authority. |
| `validateCoverageDryRunRequestBoundary`, `validateCoverageDryRunReadRequestBoundary`, `validateCoverageImportRecordBoundary` | Bounded plain-JSON and semantic validators, returning `ApiResult` with safe error envelopes. |

The associated six schemas and typed request/result/reference/port interfaces are exported. Start/read requests use `schemaVersion: "2.0.0"` and `mode: "coverage_only"`; normalized import records and import references use their own version 1.0.0 schema directory.

The host supplies a trusted clock, current `FinanceAuthorizationPort`, `CoverageImportReaderPort`, and `CoverageRunStorePort`. The PostgreSQL constructor requires `PostgresCoverageDatabasePort`, whose acquired `PostgresCoverageTransactionPort` has separate `release()` and `discard()` methods. `discard()` must physically evict the connection. A release-only legacy pool is rejected before `BEGIN`; callers must supply the explicit adapter below. Both port types are exported at the package root and reconciliation subpath.

```ts
import { Pool } from 'pg';
import { createPostgresCoverageRunStore } from '@jevelopers/cost-intelligence/reconciliation';
import type { PostgresCoverageDatabasePort } from '@jevelopers/cost-intelligence/reconciliation';

const pool = new Pool({ ...restrictedRuntimeOptions, connectionTimeoutMillis: 5_000, query_timeout: 8_000 });
const database: PostgresCoverageDatabasePort = {
  async connect() {
    const client = await pool.connect();
    return {
      query: (text, values) => client.query(text, values === undefined ? undefined : [...values]),
      release: () => client.release(),
      discard: () => client.release(true),
    };
  },
};
const coverageStore = createPostgresCoverageRunStore(database);
```

The constructor does not open hidden connections, provision credentials, run migrations, call a provider, or choose a tenant. Use a non-owner, non-superuser, non-bypass-RLS runtime login with the reviewed `ci_finance_runtime` membership and bounded pool connection/driver timeouts. The store verifies the role boundary before reading evidence.

Current Finance permissions remain `finance.reconciliation.start` and `finance.reconciliation.read` through the existing operation policy. The server must derive the actor, membership/service grant, and scope from its authenticated host and recheck them on every authorization call. A request flag, import hash, synthetic fixture, or caller-supplied resolver is not an authorization source.

## Imported metadata and source responsibility

Each start request contains one to 100 exact references with `sourceId`, `importId`, integer `revision`, and `contentHash`. The host-owned resolver must return the corresponding normalized record or explicitly report that it is unavailable. It must independently establish current access to that import and verify any original source-artifact commitment. It must not echo request assertions as source verification.

`contentHash` is SHA-256 over the deterministic canonical JSON representation of the **normalized CoverageImportRecord**, including its partition, status, mappings, timing, versions, and original artifact reference. Object keys are sorted; array order is significant. It is different from `sourceArtifactHash`, which refers to the original bytes attested by the trusted resolver. The runtime recomputes the normalized hash; it does not claim to fetch or hash original provider bytes. Changing normalized facts under the same source/import/revision identity conflicts even when the original artifact hash is unchanged.

The import record contains only bounded metadata: tenant/project/environment/billing partition, opaque source/account/project/import/cursor references, nullable currency, provider period and timezone, actual covered interval, adapter/source-schema versions, retrieval time and status, nullable record count, source-artifact commitment, zero-evidence reference, evidence mode, and verification status. References must be safe opaque identifiers. Do not supply credentials, raw provider URLs, prompts, transcripts, customer records, or unredacted artifacts.

| Retrieval state | Count and artifact semantics | Coverage meaning |
| --- | --- | --- |
| `complete` | Positive record count and source artifact required. | Actual covered interval required; the requested interval may still exceed it. A positive record count says nothing about monetary amounts. |
| `explicit_zero` | Count is exactly zero; source artifact and explicit zero-evidence reference required. | Actual covered interval required. This is a source statement about record coverage, never a financial zero, confirmed invoice, settlement, or released obligation. |
| `no_data` | Record count is unknown (`null`). An artifact may be absent (`null`). | Actual coverage is unknown (`null` endpoints). Absence is not zero. |
| `delayed` | Record count is unknown. An artifact may be absent. | Actual coverage is unknown; delayed input remains distinct from no data. |
| `failed` | Record count is unknown. An artifact may be absent. | Actual coverage is unknown; failure remains visible metadata. |
| `incomplete` | Count and artifact may be unknown. | Actual coverage can be a known subinterval or unknown. No complete-coverage claim follows. |

`periodStart`/`periodEnd` describe the provider/billing period; `coverageStart`/`coverageEnd` separately describe actual covered data. Intervals are nonempty and half-open. A known covered interval must fit within the provider period. Timezones must be recognized IANA/Intl timezone identifiers. No data is synthesized for an uncovered interval.

Revision 1 has no predecessor. A later revision names a predecessor hash and always receives `revision_requires_review`. This slice records that reference; it does not resolve or accept a financial correction chain. `evidenceMode` (`mocked`, `sandbox`, `live`) and `verificationStatus` (`verified`, `unverified`, `unknown`) remain separate metadata fields. Neither can establish a live provider grant or confirmed billing through this boundary.

## Coverage diagnostics and immutable identity

The result preserves individual imports. Diagnostics identify unknown account/project mappings or currency, unverified sources, incomplete/out-of-window coverage, revisions requiring review, and overlapping actual coverage for the same known source/account/project/currency. Unknown mappings are not silently joined. Overlap is a review flag, not duplicate-transaction matching or automatic deduplication.

The run identity is a hash of the four-field partition and the idempotency key. The input digest commits the complete creating scope, including actor, requested window, sorted exact references, and `ruleVersion: "ci07-coverage-1.0.0"`. Transport `requestId`, current time, and deployment changes do not alter this identity. A later retry by the same actor with newly valid authority replays the first persisted summary, including its original timestamp. Authority revision is pinned within one request and deliberately excluded from cross-request input identity.

Another currently authorized actor in the same partition can read the persisted metadata, but cannot recreate the same idempotency key under a different creating actor: that changes the input digest and conflicts. The creating actor is retained exactly as `ownerReference`, including characters accepted by TrustedScope such as `@`.

Start resolves the specified imports again before replay, so an unavailable or changed resolver result does not become an implicitly accepted cache hit. Read returns the immutable prior metadata under current Finance authorization and privacy checks; it does not refresh a provider or turn the prior source verification into current billing authority.

Read cursors bind the persisted run, input digest, reading scope/actor, page size, and canonical integer offset. They are deterministic integrity/context bindings, not signatures or authorization tokens. Every page requires current Finance authority. A cursor from another run, actor, page size, or input digest is rejected. Returned inputs, principals, stored results, and pages are detached frozen plain-JSON snapshots.

## PostgreSQL transaction and authorization behavior

Migration `0013_reconciliation_coverage_runs.sql` adds only the coverage imports/runs tables and dedicated capability/health metadata. Imports are unique by partition/source/import/revision; runs are unique by partition/idempotency key. Inserts occur atomically. There are no ledger, budget, settlement, or reservation writes.

Tables belong to `ci_finance_owner`; runtime grants are SELECT and INSERT only, with forced RLS for the four-field partition and privacy quarantine. Append-only and no-truncate guards reject mutation. The dedicated health view compares the exact installed table capability descriptors against an expected literal captured at migration time: columns, owner, forced RLS, constraints and index readiness, enabled triggers, exact policies, and runtime privileges. A migration marker alone is insufficient. The existing foundation health and migrations 0001–0012 are not rewritten.

This feature descriptor covers the two new tables and their exact policy/trigger bindings. The existing `finance_scope_matches()` and `reject_ledger_projection_mutation()` implementations, quarantine table/SELECT policy, and reviewed core security role graph remain trusted prerequisites. It does not detect arbitrary privileged rewrites of those shared core function bodies or claim that every financial safeguard is included in its fingerprint.

Each transaction acquires the shared `ci02-ledger:<tenant>:<project>:<environment>:<billing>` advisory gate **before replay, read, or not-found handling**, and checks current privacy quarantine. Stored run JSON is revalidated and rehashed, then bound back to its indexed identity/hash columns. Existing imports are also fully validated against their indexed identity and normalized hash before reuse.

Finance authority is renewed after awaited reads, immediately before inserts and commit, and after commit before a result can be returned. The coverage adapter detaches the complete raw authority response immediately after its await and before shared validation, so validation and principal continuity inspect the same immutable decision despite later mutations of a host-retained response. Principal kind, actor, active status, and membership/service grant revision must stay equal to the detached initial principal within that request. Denied, stale, mismatched, unavailable, or malformed decisions return safe envelopes without a success value. Source/store failures and malformed/not-found results still cross the current-authority renewal before disclosure. Adapter exception text is never returned.

Renewal/source waits are bounded to two seconds and guarded by a monotonic fifteen-second operation deadline. PostgreSQL acquisition is bounded to five seconds; a client arriving after timeout is released once without receiving BEGIN. Transactions have a separate monotonic fifteen-second fence, two-second lock timeout, five-second statement timeout, and five-second idle-in-transaction timeout. Expired authority callbacks close the fence and unwind rollback; late callback resolution cannot resume an insert or commit. The implementation does not race an entire SQL transaction and then release its still-active connection. In-flight SQL and rollback finish according to the host's finite database/driver timeouts; monotonic checks alone do not promise a hard wall-clock response bound for an injected transport that never settles. These limits are liveness controls, not a promise of cross-system atomic revocation.

The store selects `discard()` after a synchronous or asynchronous SQL failure, malformed acknowledgement, lost `BEGIN`/`COMMIT` acknowledgement, or failed `ROLLBACK`. A cleanup failure preserves the original safe refusal. Clean commit, or a non-transport refusal followed by a successful rollback, selects ordinary `release()`. Driver methods are captured once for the acquired session, and cleanup selects exactly one release/discard path. A late idle acquisition is released without starting SQL.

A commit can succeed before its acknowledgement is lost, or authority can change immediately after commit. Such a call returns a safe refusal instead of claiming success. Retrying the same immutable inputs resolves the existing run; it does not insert duplicate imports or perform financial effects. This slice does not automatically retry external reads or database requests.

### Privacy fence prerequisite on the current base

On base `ab80f81731714a448288cec1eb57e608b25d265f`, the shared gate coordinates with the existing controlled `audit_legacy_financial_privacy()` protocol. A privileged direct quarantine INSERT is not guaranteed to take that lock. The stronger direct-insert guard belongs to the active owner of [PR #43](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/pull/43); this migration does not duplicate or overwrite that owner’s migration 0011. Accordingly, this slice does not claim an all-writer quarantine fence or coherent final host authorization acceptance. Application runtime logins cannot insert quarantine records.

## Validation and remaining work

The scoped commands are:

```sh
npm run test:reconciliation -- --offline --suite=coverage
node scripts/with-postgres.mjs reconciliation --offline --suite=coverage-postgres
```

The first suite exercises synthetic public-boundary, negative, mutation/renewal, replay, normalized-hash, pagination, deadline, and scope cases using explicitly modeled storage. Its SQL transport controls verify cleanup selection for synchronous/asynchronous faults, clean rollback and commit, missing discard capability, and late acquisition. They prove no PostgreSQL durability or physical pool eviction. The second requires the actual disposable PostgreSQL lifecycle and a restricted runtime role; it has no skip or in-memory fallback. It covers atomic concurrent starts, replay after pool restart, lost commit acknowledgement, rollback on revocation, physical eviction after failed rollback, late authorization completion, malformed persisted evidence, RLS, quarantine ordering under the controlled protocol, bounded locking, feature capability damage, and absence of financial mutations. Hosted CI runs both scoped selectors. Packed-consumer tests compile positive v1/v2 calls and reject a release-only PostgreSQL adapter as well as invalid enum/financial-result assertions.

Integration and release require both `tests/reconciliation/coverage.test.mjs` and `tests/reconciliation/coverage-pg.test.mjs` alongside the full reconciliation leaf. The required `tests/reconciliation/reconciliation.test.mjs` leaf remains absent; the scoped files do not substitute for it. P1 nested budgets remain explicitly deferred under issue #17. Meaningful local results and unexecuted database prerequisites are recorded separately in the implementation handoff; a missing PostgreSQL service is a blocked database execution, never a pass.

Still required for complete CI-07: accepted operational source adapters and identity mappings; ledger/source entries and matching rules; exact financial variance and exception outcomes; policy-checked apply/correction/outbox behavior; reservation hold/settlement integration; actual PostgreSQL validation; host assembly/current provider grants; and accountable Finance/consumer acceptance. Full accounting depends on the published operational checkpoint and repairs requested in [issue #14](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/14); settlement depends on [issue #13](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/13) and its current owner. This bounded implementation does not close issue #16, [gate #5](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/5), or [epic #1](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/1).
