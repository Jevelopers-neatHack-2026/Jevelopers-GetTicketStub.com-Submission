# CI05A Finance authority mapping

This package exposes an operational PostgreSQL Finance authority through the root
`@jevelopers/cost-intelligence` and `@jevelopers/cost-intelligence/budgets` entrypoints.
The mapping is Finance-owned `ci-reservation-authority-1.0.0`. Shared-contracts
0.3.0 remains pinned, proposal-only and unmodified. This implementation does not
constitute canonical GAP002 acceptance or genuine host issuer acceptance.

## Composition and functions

Supply `RuntimePorts.budgets` with `database`, `reservationAuthority`,
`budgetEvidence`, and optionally `authorityWaitMs`. Keep the existing top-level
`clock`, `trustedContext` and `financeAuthority`. Finance scope permissions and
host target grants are distinct authorities; neither is inferred from an app role
or request label. Missing composition preserves the legacy unavailable facade.

- `authorize(ReservationRequest, RuntimePorts)` atomically reserves capacity.
- `getReservationSnapshot(ReservationSnapshotRequest, RuntimePorts)` reads current
  scoped state. It is advisory, omits a dispatch grant, and reports
  `dispatchEligible:false`; it never substitutes for revalidation.
- `revalidateAuthorization(CurrentReservationRequest, RuntimePorts)` independently
  checks current Finance scope permission, stored state, host target grant and
  authenticated source/maximum/replan evidence. The result has
  `status:authorized|denied`, `revoked`, `snapshot`, and, only when eligible,
  `finance`. It does not manufacture the outer host `grant`.
- `acknowledgePartial(PartialAcknowledgementRequest, RuntimePorts)` durably binds
  a source-verified revised plan before partial dispatch.
- `markDispatched(MarkDispatchedCommand, RuntimePorts)` appends the scoped dispatch
  intent/worker lease and returns a current advisory snapshot.
- `changeBudget(BudgetChangeRequest, RuntimePorts)` serializes policy mutation with
  admission. `expectedLedgerRevision` is the scoped immutable ledger event count.

The low-level equivalents accept `BudgetRuntimePorts`: `authorizeReservation`,
`readReservationSnapshot`, `revalidateReservation`,
`acknowledgePartialReservation`, `markReservationDispatched`,
`changeBudgetPolicy`, and advisory `readCapacity`.

Public `settle` and `release` remain unavailable pending CI05B source-backed,
ledger-linked finality/recovery integration. Existing low-level lifecycle routines
are preserved local proposals, not accepted cumulative/delta canonical semantics.

## Exact request and issuer evidence

`ReservationRequest` adds `sourceAuthorityRef` and `authorityBinding` (optional in
legacy structural validation, required for operational admission):

```text
authorityBinding = {
  mappingVersion: "ci-reservation-authority-1.0.0",
  budgetScopeId, grantRef, accountRef, projectRef, provider, model, operation,
  targetBindingSha256, leaseRef, leaseExpiresAt
}
```

The canonical request's tenant/project/environment/billing mode, idempotency key,
logical operation, billable attempt and budget scope must equal the Finance
wrapper. Financial expiry comes from canonical `expires_at`. It is immutable and
separate from the worker lease; neither expiry releases financial exposure.

`BudgetReservationAuthorityPort.verifyCurrent` receives
`{scope,billableAttemptId,binding,sourceAuthorityRef,phase,reservationId?,
dispatchIntentRef?,transportAttemptId?}`. The independent host issuer must verify
current access/account/project/target/lease binding, revocation, and, for
`post_transport_ack`, the genuine durable transport acknowledgement. Its result
is `{status:"allowed",revoked:false,queryDigest,verifiedAt,expiresAt,
evidenceRef,evidenceSha256}`. `queryDigest` is `budgetDigest(query)`; a matching
hash alone is not authentication. Synthetic fixture issuers are not real grants.

`BudgetEvidencePort.verifyCurrent` receives
`{operation,scope,actorId,sourceAuthorityRef,requestDigest}`. The request digest is
`budgetDigest(normalizedBudgetRequest(command))`, which removes only the outer
request ID and binds all economic, target, source, lifetime and plan fields. The
resolver must authenticate independent current source records/bytes, not echo
incoming verified labels. It returns
`{status:"verified",queryDigest,verifiedAt,expiresAt,maximum?}`;
`maximum={policyRef,authorizedCap,currency}`. Missing/invalid/currently revoked
source evidence fails closed. Unknown or incomplete estimate provenance remains
unchanged: only an exact current maximum reference/cap/currency equal to the
canonical request amount can authorize. Known subtotal cannot exceed that cap.
Complete estimates also require independent source authentication.

## Consumer fields and phases

Eligible Finance envelopes contain exactly the audited creative consumer fields:
`status:"held"`, `revoked:false`, `reservation_ref`, `billable_attempt_id`,
`budget_scope_id`, `lease_ref`, `grant_ref`, `tenant_id`, `project_id`,
`account_ref`, `project_ref`, `provider`, `model`, `operation`,
`target_binding_sha256`, `held_amount:{amount,currency}`,
`authorized_cap:{amount,currency}`, `expires_at`, `evidence_ref`,
`evidence_sha256`. Finance evidence identifies and hashes its immutable admission
record; genuine host evidence is also retained in that record. The held amount
and approved per-attempt cap remain separate. OpenRouter uses USD only.

Both `preparation` and `post_transport_ack` re-read current state and evidence.
Post-ack requires the original transport attempt, durable recorded dispatch
intent, and current worker lease. Both held and dispatched states can be eligible;
released, settled, expired, stale-revision, mismatched and revoked results cannot.
The financial hold remains after a failed post-send check. Remote authorities
cannot share an atomic revocation snapshot: a host still needs its last local
synchronous dispatch fence, and CI05B owns crash/recovery completeness.

The host composes Finance with its separate genuine access `grant`; it must not
rename the Finance scope grant into product entitlement. Creative source pin
`c1879872e27439e77daa3872c4989cc5fce9b7d4` currently accepts at most nine
fractional digits. Finance preserves exact zero-to-eighteen decimal strings.
Amounts within the nine-digit range are losslessly compatible; no truncation,
rounding, exchange or deployed eighteen-digit consumer change is claimed.

## Partial work

Opt-in returns `partial` and exact `allowedAmount`. If a source-authenticated
`workPlan={requestedUnits,unit,unitMaximumAmount}` is provided, its conservative
cost must equal the requested cap; partial admission floors to whole affordable
units and returns their count/unit. Without a work plan, the monetary partial
hold remains non-dispatchable until a compatible accepted work protocol exists.

Acknowledgement binds reservation/attempt, expected revision, actor, source,
`allowedAmount`, `allowedWorkUnits`, `unit`, `revisedPlan` and
`revisedPlanHash=budgetDigest(revisedPlan)`. Revised work must fit the exact held
cap and original work bounds. The durable acknowledgement is a separate
append-only scoped record. A database trigger and the shared lock enforce one
ordered revision/idempotency space across acknowledgement records and lifecycle
events. Dispatch and both current phases revalidate the revised
plan's current source authority. Missing, changed, revoked or over-cap plans are
refused. This is an explicit local versioned GAP002 proposal, pending owner and
canonical consumer receipts.

## Capacity, policy and concurrency

Capacity is project-lifetime, partitioned by tenant/project/environment/economic
billing mode/currency. Reporting dates cannot alter it. Existing effective ledger
cost heads for direct_cost/supplier_expense/operating_expense/payable_labor are
included. Distinct effective economic source rows sum per attempt; cumulative
reservation consumption is compared against that sum, not added to it twice.
Unconsumed holds cover the remainder. Unlinked expenses reduce project capacity;
unknown cost exposure returns unavailable for new admission and remains explicit
on snapshots. No unknown amount becomes zero.

Lock order is CI02 scoped ledger advisory lock, then currency budget partition,
under READ COMMITTED. Existing ledger writers use the first lock. A unique first
admission index binds one economic attempt across currencies and keys. Provider
retries require a new billable attempt. Identical admission replay is historical;
current dispatch eligibility requires the current revalidation API.

Policy `ci-budget-policy-1.0.0` rejects reductions below consumed plus outstanding
commitments, retaining the old limit/spend/holds. Unknown exposure blocks
reductions. Near-limit is exact commitment >=80% of limit. Available, near-limit,
exhausted, over-limit and unresolved exposure remain explicit. Denied/stale policy
commands are immutable audited decisions; their identical retry replays the
original decision rather than reevaluating it. Changed command content conflicts.

Every operation has a finite end-to-end authority deadline. Timeout before COMMIT
rolls back; uncertain COMMIT acknowledgement returns unavailable, retains possible
exposure and requires identical-key retry. No unavailable decision authorizes
provider dispatch.

## Readiness and migration limits

Additive `0009_budget_authority_bindings` preserves old history and fails upgrade
on existing duplicate economic attempts rather than deleting or rewriting them.
Legacy rows lacking immutable target/source/lifetime mapping cannot become new
host-ready dispatch grants by guessed backfill.

A separately queued CI04A migration also uses sequence 0009. This candidate is
currently based on `acfdfbd`; the supervisor must serialize the reviewed intake
handoff, renumber this migration to 0010, refresh health/upgrade tests and obtain
new exact-head review before integrating both. No unreviewed branch is adopted.

Existing migration 0007/0008 installer prerequisite F03 remains unresolved here:
upgrading the restricted owner from 0006 may require the installer-authorized
one-time EXECUTE grant on `reject_ledger_projection_mutation`. The disposable
harness performs its own role fixture setup; that is not evidence that a real
installer without the grant can upgrade. No public runtime grants are broadened.

Independent exact-head review, canonical/consumer GAP002 agreement, genuine host
issuer/source/maximum fixtures, approved security evidence, serialized migration
integration and post-merge verification remain required. CI05B settlement,
unknown-outcome queues, crash/lease recovery and null-provider-ID reconciliation
remain separate. No full issue closure, paid provider call or host deployment is
claimed by these offline tests.
