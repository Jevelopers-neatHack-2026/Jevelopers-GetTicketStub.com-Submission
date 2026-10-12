# Private bounded discovery frontier

This document describes the private EI-04 frontier/checkpoint core in
`src/discovery/planner/frontier.mjs`. It is an internal implementation shape,
not a canonical wire schema, a provider port, or an accepted integration
contract. It contributes only scoped EI work to AGT-01, AGT-05, and FIN-01;
those cross-project criteria retain their original meanings and owners.

The core stores a deterministic candidate pool, source-linked observations,
durable leases, and request-admission counters. It does not perform extraction,
search, fetching, model calls, billing, source verification, or event/company
identity resolution. A snapshot always reports `readiness:
"blocked_no_transport_adapter"`, `transportDispatch: "not_implemented"`,
`sourceAuthority: "not_evaluated"`, `independentCorroboration:
"not_evaluated"`, `usageStatus: "unknown"`, and `budgetAuthority:
"not_evaluated"`.

## Bounds and ordering

The hard ceilings are 10 seed inputs, depth 2, 30 transport-attempt
admissions per run, 4 in-flight leases, a 120-second absolute run deadline, 16
suggested links per completion, and 4 source references per suggestion. A
caller can choose lower limits. Links at depth 3 remain in the candidate pool
as `depth_limited` observations, with a durable `depth_limit` stop reason. A
candidate is deduplicated for scheduling by its normalized URL only; every
seed/link observation and its references remain in history. This is URL work
deduplication, not an entity merge.

Claim order is ascending depth, then normalized URL in explicit JavaScript
code-unit order, then stable candidate ID. Input seed and link arrays are
normalized and sorted before persistence, so permutation of the same inputs
does not change the eligible candidate order. Link labels are retained only as
`untrustedLabel` hints.

Per tenant, at most 128 run records and 64 MiB of SQLite pages are retained.
Exceeding a storage bound fails closed. The core has no automatic retention or
garbage-collection policy; the application composition root must provide a
private storage directory and an approved lifecycle before relying on it for
long-lived or customer data.

### Shared tenant admission

The trusted store constructor accepts an optional `tenantLimits` policy. It
defaults to `maxInFlightLeases: 4` and `maxReservedDecodedBytes: 104857600`
(100 MiB). The policy applies across every run in one tenant database and
every store instance or process opening it. The configured directory, identity
resolver and numeric settings belong to the host; these component defaults
are not an attestation of deployed tenant policy or host containment.

Both values must be ordinary safe integers. Lease capacity accepts 1–512,
derived from the existing 128-run and four-lease ceilings. Outstanding byte
capacity accepts 20 MiB–12,800 MiB, derived from the existing per-hop reservation
and per-run/store ceilings. Per-run limits retain their existing values and
cannot be raised by a larger tenant policy. Unknown keys, getters, string
coercions, fractions, non-finite values and out-of-range values fail with
`FRONTIER_INVALID_INPUT` before storage access.

The normalized complete policy is persisted on the tenant's first successful
database operation. A later instance must supply that same policy, including
when it omits `tenantLimits` and therefore requests the defaults. A larger or
smaller mismatched policy fails with `FRONTIER_CONFLICT`; caller mutation after
construction cannot change the captured policy. Policy binding and schema
migration use the same `BEGIN IMMEDIATE` transaction. Schema selection happens
after acquiring that lock, so a peer's completed migration is rechecked before
binding or validating the policy. There is no policy reset,
automatic renewal or policy-change API.

Concurrency counts distinct `(run_id, lease_token)` pairs that still have a
leased claim, an unsettled transport hop, or an admission without a transport
row. Redirects of one lease count once toward concurrency while their separate
byte reservations all count. Cancellation, deadline expiry, planner completion
and `markUnresolved` never remove uncertain transport exposure from this count.
An unused lease can be released through the existing confirmed
`cancelled_before_dispatch` path only when no attempt was admitted.

Outstanding bytes include every `reserved`, `dispatch_intent`,
`response_received` or `unknown` hop at its existing 20 MiB reservation. A raw
`admitAttempt` has no transport observation, so each such untracked admission
also conservatively reserves 20 MiB for this tenant policy, even after planner
completion. It cannot be converted to a new transport permit by replaying its
key through `admitTransportHop`. The existing v1 full-run uncertainty reserves
100 MiB per affected run instead of double-counting its untracked attempts.
No reconciliation authority or refund path is invented for these unknowns.

Known-zero and complete-body settlement release the corresponding **outstanding
tenant reservation**. Complete-body settlement still records exact decoded
spend against the original cumulative per-run limit. The tenant policy is a
resource admission bound, not a cumulative financial budget or a fresh budget
per new run ID. The old per-run `getTransportProgress` describes tracked
transport and v1 full-run uncertainty; it does not project current raw
`admitAttempt` records or imply zero usage for them. `getTenantProgress` exposes
the separate tenant projection, including untracked admission counts.

New claims wait with `tenant_in_flight_limit` when tenant concurrency is full.
New admissions return `denied` with `tenant_decoded_budget` when another 20 MiB
reservation would exceed capacity. Over-limit migrated concurrency also denies
new admissions for existing leases. Admission and accounting occur atomically;
exact historical replay remains deduplicated at full capacity and never grants
another dispatch. Denial leaves the new attempt and its counters uncommitted.

Schema 4 migrates v1–v3 databases atomically, retaining their old rows, run
configuration hashes, deadlines, counters and uncertainty. Exposure already
above the new tenant limit is preserved; available capacity saturates at zero.
History and existing settlement remain accessible with the matching policy,
while new work stays bounded. V3 and older binaries reject schema 4, so reverting
the code is not a database downgrade procedure. Missing or corrupted schema-4
policy metadata fails with `FRONTIER_VERSION`, without silently rebinding or
clearing debt. The host owner must coordinate any later policy migration or
rollback; no production database or policy was changed by the local fixtures.

The tenant tests use real temporary SQLite databases, independent Node
processes and synthetic identities/settings without transport or provider
calls. Two older per-run byte-contention fixtures explicitly select six tenant
lease slots to retain their four unsettled reservations and two racing workers;
their original 20 MiB and 100 MiB assertions remain intact. This is a scoped
EI-02 AC4 mechanism and does not close issue #8, the release gate or the epic.

## Durable operations

`createDiscoveryFrontierStore` requires a trusted local directory and a
`resolveTenant` function. That function must resolve tenant identity from an
authenticated server-side request; the frontier cannot validate the
application's authentication system. It hashes the returned tenant ID and
stores each tenant under a separate directory. SQLite writes use
`BEGIN IMMEDIATE`, full synchronous mode, restrictive file/directory modes,
and the builtin `node:sqlite` `DatabaseSync`. Node documents this API as
experimental in 22.x; its busy-timeout option is available in the pinned
22.23.3 release ([Node.js SQLite documentation](https://nodejs.org/download/release/v22.23.3/docs/api/sqlite.html)).

`createRun` persists the absolute deadline on first creation. Repeating the
same run ID and normalized configuration returns the existing state without
resetting the deadline, counters, observations, or leases. Reusing a run ID
with different seeds or limits returns a conflict. A fresh run ID creates a
separate run; this core does not provide a financial budget authority that can
prevent an upstream caller from creating a new logical run.

`claimNext` atomically claims one queued candidate while the configured lease
limit allows it. The caller supplies a stable `claimKey` and `workerId`. A
repeated claim with the same pair returns the original lease and never assigns
a second candidate. This replay is only a way to recover the durable claim; it
does not authorize another transport dispatch. A lease does not expire or
silently return to the queue. After a crash, a worker may recover the claim
with its stable key and reconcile it against durable attempt history and real
transport telemetry. If it cannot establish whether a committed admission was
dispatched, it must preserve that attempt as unknown or unresolved rather than
redispatching it. `markUnresolved` instead records the work as unresolved,
clears the lease, and halts new work for review. Completion with a stale lease
is rejected.

`admitAttempt` is the durable pre-dispatch admission operation. The first
admission for a lease must be `initial` at the current candidate URL, whether
the candidate came from the original seed set or was discovered through a
link. A `retry` must name the latest attempt and reuse that URL. A `redirect`
must name the latest attempt, provide a new normalized URL, and cannot revisit
a URL already admitted for that candidate. Each unique `attemptKey` consumes
one persistent admission, including retries and redirects; replaying the same
key and payload returns `already_admitted` and does not add another count.
`already_admitted` reports historical deduplication state only and is never
authority to dispatch another real request. After a crash between admission
and dispatch, a future transport adapter must distinguish a confirmed
undispatched admission from a request whose dispatch outcome is unknown using
its transport telemetry. If it cannot resolve that state, it must retain the
attempt as unknown or unresolved for review; replaying the admission must
never itself trigger a redispatch. Reusing a key with a different payload is
a conflict.

Before a future transport adapter makes **each actual request**, including
each redirect, it must commit an admission and only then dispatch. This core
does not prove that an adapter followed that sequence, observe HTTP responses,
resolve DNS, pin the peer, or enforce a deadline during a socket operation.
The existing URL policy applies static URL and hostname checks only. A
transport integration still must compose it with the approved DNS-pinned safe
fetcher and reconcile durable admissions with real request/redirect telemetry.
The frontier counter is an admission count, not evidence of actual network
requests, and a historical `already_admitted` result cannot be used as a new
dispatch permit.

`completeCandidate` requires an admitted lease. It stores bounded link
observations and exact caller-projected source references. A suggestion must
include at least one reference whose `value` exactly matches its supplied URL.
The future caller must first verify that each reference came from an available,
same-tenant evidence record and source position; this module does not read or
authorize EvidenceStore handles. A positive `truncatedCount` records
`fanout_limit`, so private retrieval can retain a deterministic bounded prefix
and disclose omitted links with their source references in the encrypted
receipt. Completions are idempotent by caller-supplied
`completionKey` and payload. Results already in flight may still be recorded
after cancellation or another stop, but new claims/admissions remain denied.

`stopRun` records cancellation, budget denial, access restriction, review, or
an adequate-facts stop and prevents additional claims/admissions. It does not
cancel an external request already dispatched by a future adapter; that
adapter must propagate cancellation and reconcile ambiguous work as unknown.
`budget_denied` is only an opaque caller stop reason. It does not create a
Finance ledger, release a hold, infer zero usage, or grant spending authority.

## Provenance and uncertainty

Every observation preserves its supplied and normalized URL, parent candidate,
depth, optional untrusted label, and source references. Duplicate canonical
URLs create one schedulable candidate while preserving each observed link.
Self-links and links that close a recorded graph path receive a `cycle`
disposition. Equal content hashes across multiple evidence IDs are exposed as
duplicate-content groups with `independence: "unknown"`; the core does not
count them as independent corroboration. Source authority remains
`not_evaluated` regardless of URL, label, branding, or link position.

The frontier is not an entity or occurrence matcher. It cannot conclude that
two event pages describe the same event, that a company is official, or that a
source is independent. Those questions remain with the identity/evidence
layers and their later composition.

Input objects, arrays, references, IDs, labels, URLs, locators, and state are
bounded. The API copies own data properties and rejects accessors, unknown
keys, malformed arrays, invalid Unicode, and malformed URL/source-reference
shapes. Diagnostics use fixed messages and codes; input URLs and labels are
not included in thrown errors. The SQLite file contains private URLs and
reference metadata in plaintext under tenant-scoped filesystem permissions;
it is not encrypted by this module and must live in trusted private storage.

## Remaining EI-04 integration work

This is a partial core. Issue #14 remains open. The future implementation must
compose a bounded extractor, tenant-authorized evidence lookup, the pinned
safe transport adapter, durable admission before every request and redirect,
real cancellation and deadline handling, actual request/usage telemetry,
an explicit spend authority, source authority and corroboration decisions,
and release evidence. No selector, shared runner, or public contract has been
registered here. This core alone does not satisfy full EI-04 or release
acceptance.
