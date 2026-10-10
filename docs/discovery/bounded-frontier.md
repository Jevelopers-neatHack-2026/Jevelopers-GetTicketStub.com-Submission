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
`fanout_limit`, so a future extractor can retain a deterministic bounded prefix
and disclose omitted links. Completions are idempotent by caller-supplied
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
