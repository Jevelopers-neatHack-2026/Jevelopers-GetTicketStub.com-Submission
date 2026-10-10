# Bounded private runtime: Phase A

**Status:** private implementation prerequisite only. This increment does not pass AH-04 or AH-08.

## Scope and ownership

Phase A adds private bounded plan, registry, local limit, and recovery-classification mechanics. Its files are confined to src/orchestrator/internal/, src/tools/internal/, src/recovery/internal/, tests/planning/, tests/recovery/, and this decision record. Nothing is exported from the package root, and no shared store, type, error, package, Makefile, runtime-test, or CI file is changed.

The inspected base is 6f9428acd43a4b711adf8c7f9e5e168360318d18. That base contains the merged telemetry schema 4 implementation. JEV PR 29's schema 5 work was still unmerged at dispatch; Phase A does not assume or depend on its interfaces. The current workflow store has database schema 4 and checkpoint envelope schema 2. The private controller checkpoint kind below is a nested payload version, not a database or envelope migration.

The existing store exposes immutable checkpoints, workflow state, events, and outbox records. It does not expose an ordinary local-step admission/completion transaction. getWorkflow and getCheckpoint are separate reads. recordDispatchIntent creates an external operation attempt and requires an opaque hold reference; it is not a local-step API. Phase A performs no store writes and creates no attempts, receipts, transports, holds, events, or outbox rows.

The current telemetry implementation and its cursor, redaction, queue, and outbox semantics remain untouched. Any Phase B checkpoint commit must preserve those existing behaviors and use the actual store/schema interfaces after root transfers shared-file ownership.

## Private plan and registry

Plans are JSON text with this exact private shape:

~~~json
{
  "kind": "agent-harness.private-synthetic-plan",
  "version": 1,
  "steps": [
    {
      "id": "first",
      "operation": "number.add",
      "dependsOn": [],
      "args": { "left": 19, "right": 23 }
    },
    {
      "id": "second",
      "operation": "number.add",
      "dependsOn": ["first"],
      "args": { "left": { "$result": "first" }, "right": 1 }
    }
  ]
}
~~~

Only JSON text is accepted at the plan boundary. Objects, accessors, proxies, toJSON hooks, unknown fields, nonfinite numbers, duplicate IDs, invalid references, cycles, and oversized/deep graphs are rejected before a local operation is admitted. Result references name a whole prior result, and that step must also be an explicit dependency. Dependencies are evaluated in stable ASCII step-ID order. Unknown operations are rejected. The registry is a frozen static manifest with no registration, plugin, dynamic import, code, URL, shell, or function-injection path.

The only executable operations are bounded pure functions:

| Operation | Input | Computation |
| --- | --- | --- |
| number.add | Two bounded safe integers | Adds them and validates the bounded integer result |
| text.concat | Up to 32 bounded strings | Concatenates them and validates the UTF-8 output size |

The manifest also records network.fetch as external, provider.image and provider.reason as provider effects, and system.shell as privileged. Each is explicitly unavailable. The registry has no dispatch handler for any of these effects, and no dependency mode changes that result. These names are fixed examples of unavailable effects; they do not create a provider contract.

compilePlan returns an opaque frozen handle pinned to the canonical plan hash, static registry version, tightened-limit hash, and a workflow-scoped run identity. executeLocalStep and executePlanLocally compute actual local values. Each result carries hashes bound to the plan, registry, workflow-scoped run identity, resolved input, and output. Owned result data is frozen. Recovery validation rejects results from another workflow or with changed identity.

Local evaluation is in-process and has no durable admission, checkpoint, cancellation race, event, or outbox integration. executePlanLocally is a bounded deterministic exercise path, not a controller or a resumable workflow. executeLocalStep is the reusable one-step primitive for the later controller. Phase B must put admission and completion around that primitive in the SQLite transaction; it must not treat this Phase A evaluator as durable evidence.

## Limits, clocks, and diagnostics

The default finite ceilings are fixed in limits.js. Callers may lower them through JSON limit configuration; plan content cannot raise them.

| Limit | Default ceiling |
| --- | ---: |
| Plan UTF-8 bytes | 32,768 |
| Steps / dependency edges | 32 / 64 |
| JSON or dependency depth | 12 |
| Ready queue | 16 |
| Per-step input / result bytes | 8,192 / 8,192 |
| Total result / saved-results bytes | 65,536 / 131,072 |
| Step attempts / local replays | 64 / 32 |
| Replans / total iterations | 8 / 64 |
| Elapsed time / observed step duration | 30,000 ms / 1,000 ms |
| Recovery attempt-state records | 32 |

Limits and counters only stop work. They are not authorization, provider capacity, finance reservation, or spending permission. There is no cost counter or usage claim in this increment.

Budget snapshots include the pinned wall deadline, last wall sample, elapsed allowance, limit-set hash, and consumed counters. advanceBudget returns a new snapshot; it does not mutate or persist the old one. The classifier checks the recorded budget before offering a candidate. A future controller must persist every successful admission and consumed replay/replan counter atomically before invoking a step, and must load that saved state after restart instead of constructing a fresh snapshot.

Within one process, the controller should use a monotonic clock for elapsed time. Across restarts, the persisted wall deadline is necessarily checked against a trusted system wall clock. Backward movement, inconsistent wall/elapsed samples beyond the 250 ms tolerance, or expiry fail closed. The Phase A synchronous handlers have finite input loops. A duration breach is observed after a handler returns; it does not terminate that handler. No Promise.race or AbortSignal is claimed to preempt arbitrary synchronous JavaScript.

Plan and recovery errors expose fixed safe codes/messages only. Recovery output contains only a classification, a fixed reason code, and actionable: false; it does not copy source text, provider payloads, attempt IDs, tenant data, or hold references into diagnostics.

## Private recovery classification

classifyRecovery accepts bounded JSON text that projects two workflow reads (before and after), the selected checkpoint, the known attempt states, and a trusted observation time. The two workflow projections must agree on ID, state, revision, and checkpoint sequence before a local classification is returned. This lets a caller using the current API read workflow, checkpoint, and workflow again and reject a raced snapshot; Phase B may replace that with a consistent store read after shared-file transfer.

A supported private checkpoint is nested under the existing version 2 checkpoint envelope and uses kind agent-harness.private-bounded-local-checkpoint, version 1. It pins workflow ID, plan JSON/hash, registry version, run identity, limits/hash, budget snapshot, completed-result JSON, and an optional pending step ID. The classifier verifies the checkpoint SHA-256 and these identities. It returns one of:

- local-ready-candidate: a deterministic next step can be admitted; nothing is admitted by the classifier.
- local-replay-candidate: an admitted pure step is incomplete and another replay allowance is available; nothing is replayed by the classifier.
- durable-evidence-present: all private local results match the pinned identities; no workflow state is promoted.
- external-reconciliation-required: an existing intent, unknown outcome, response-received attempt, awaiting-response state, or reconciliation-pending state remains a barrier.
- stop or quarantine: missing, foreign, corrupt, unsupported, stale, terminal, review, cancelled, or invalid local data cannot be adopted.

Terminal states and review_required never become runnable. Unresolved external attempt evidence takes precedence over local recovery. The current store has no bounded per-workflow pending-attempt discovery method, so this pure classifier only examines a supplied bounded list; it is not a restart sweeper and cannot query providers, update attempts, ingest external responses, settle/release holds, or promote receipts.

## Phase A acceptance evidence

The following table maps all 13 mandatory groups. “Local evidence” describes only the private Phase A tests. Every Phase B/C/D prerequisite remains mandatory for a coherent integrated increment.

| Group | Phase A local evidence | Required remaining work |
| --- | --- | --- |
| PLAN_BOUNDS | Rejects unsupported versions, duplicate/self/unknown dependencies, cycles, undeclared references, nonfinite values, excess bytes/nodes/edges/depth/ready queue/input/output. | Phase B must repeat these through the actual controller before durable admission. |
| NO_CAPABILITY_GRANT | Unknown operations fail; external/provider/privileged registry entries have no handler and stay unavailable in all modes. | Phase D must keep these denials behind actual authorization and finance adapters; no synthetic flag can grant them. |
| EXECUTABLE_LOCAL_PATH | Real addition and concatenation compute dependent outputs; deterministic step choice and result identity are checked. | Phase B must add atomic admission/completion checkpoint, event, and outbox writes and prove resume from committed work. |
| CRASH_BUDGET | Pure budget helpers model consumed steps, attempts, local replay, replans, and pinned deadlines. | Phase B must prove all four subprocess crash boundaries on file-backed SQLite, persisted counters, bounded replay, and no duplicate committed completion. Phase A has no process-crash artifact. |
| CAS_CANCEL_LEASE | Recovery rejects a changed workflow revision/state/checkpoint snapshot. | Phase B must race independent processes for admission, completion, cancellation, and lease takeover; prove one CAS winner and stale-writer rejection. |
| LIMITS_TIME | Exact step/replay/replan/result/time boundaries and backward/forward clock inconsistency are tested. | Phase B must persist the original deadline/counters and test restart, cancellation, and real clock-source integration. |
| RESULT_VALIDITY | JSON-only inputs reject accessors/proxies/toJSON; local results bind plan, registry, run, input, and result hashes; saved foreign/modified results are rejected. | Phase B must repeat validation at admission and commit, including output-size and identity checks on persisted checkpoint data. |
| EXTERNAL_UNKNOWN_BARRIER | Recovery returns reconciliation-required for intent, outcome_unknown, response_received, awaiting_response, and reconciliation_pending. | Phase B/C must inspect actual persisted attempts and prove no local admission, retry, hold change, fake receipt, or zero-cost outcome. |
| RECOVERY_COMPATIBILITY | Missing, generic/foreign, corrupt-hash, old/future-envelope, and unsupported private checkpoint versions stop safely. | Phase B/C must verify actual schema 1–4 upgrades, retain existing receipts/hashes, test future schemas, and expose bounded discovery incompleteness. |
| ROLLOUT_AND_GATE | No planner, JEV route, mode switch, approval boolean, finance input, or live capability exists in these modules. | Phase D requires accepted canonical decision/promotion/rollback and current authorization/finance interfaces; Phase A cannot pass full AH-04/AH-06. |
| TRANSACTION_LOCAL_CHECKPOINT_EVENT | Not implemented; Phase A makes no store writes. | Phase B must inject failures after every admission/completion SQL write and verify checkpoint, workflow revision, event, and outbox all commit or all roll back. |
| REVOCATION_READMISSION | Workflow/run/registry/plan identity changes stop saved local results; every external effect remains unavailable. | Phase B must test cancellation, lease, plan/registry replacement and CAS conflicts. Real authority/reservation revocation races require canonical Phase D fixtures. |
| UNKNOWN_EXTERNAL_QUARANTINE | Provider-shaped or cross-workflow local result data is quarantined; no classifier output promotes it. | Phase B/C must preserve existing external attempt/receipt evidence through the actually merged JEV observation path. No external-response ingestion shortcut is allowed. |

## Issue and release acceptance remains open

This increment supplies a narrow private prerequisite for issue 19 (ACV1-AH04), issue 18 (ACV1-AH08), and a limited input to issue 17 (ACV1-AH06). All original acceptance conditions remain unchanged:

- **AH-04 / CON-03 / AGT-03 / AGT-04 / ACV1-JEV-08:** Phase A contributes local typed bounds, deterministic pure computation, and safe rejection of untrusted plan data. It does not implement an authenticated ProjectRequest, canonical action DTO, actual planner provider/model, JEV ranking, budget metering, source retrieval, authorization, cancellation integration, or a live planner happy path. The required later bounded-planner-happy-path must be a real configured provider call with an explicit model/snapshot, authorized synthetic identity, metered attempt, usage-or-unknown evidence, and persisted progress.
- **AH-08 / AGT-02 / AGT-03:** Phase A does not persist local-step admission/completion or recover a real workflow. It does not repeat, reconcile, or settle any provider effect.
- **FIN-03 / FIN-04 / BUD-03:** No distinct billed retries, unknown-billing evidence, conservative held-budget proof, finance ledger, or hold lifecycle is implemented. Existing opaque hold references remain external-owned and untouched.
- **AH-02:** No trusted tenant/project/artifact lookup, authenticated create/status/cancel/correct/resume command, scoped command idempotency, progress cursor, or authorization is implemented. A workflow ID is not tenant authority.
- **AH-06 / ACV1-JEV-04/05:** No canonical decision receipt, policy, cache, promotion, rollback, or active/shadow route is introduced. Synthetic local result hashes are not DecisionReceipts or cache authority.
- **SPN-01, SPN-02, provider/live, full AH-04/AH-08 and final-journey acceptance:** No Neatlogs/Entire artifact, paid provider call, live run, or external application acknowledgement is produced. Mock/private tests cannot satisfy those criteria.

Required external artifacts remain: accepted ProjectRequest/AuthorizationPort and versioned consumer commands; atomic Finance reservation/attempt and usage-or-unknown contracts; canonical DecisionPort/action/result/receipt/policy/promotion/cache contracts; accessible evaluation promotion and rollback authority; selected planner and JEV provider/model/account access plus budget and verified retry/status semantics. No missing DTO or authority is inferred here.

## Sequenced follow-up

**Phase B — durable local controller:** only after root explicitly transfers shared-file ownership after telemetry merge and the scheduled JEV migration. Refresh the merged source and schema first. Add an atomic local checkpoint admission/completion operation that fences workflow ID, lease, expected revision, cancellation, plan/registry/run identity, current checkpoint sequence, and unresolved external attempts. Persist the pinned limits, deadline, counters, pending step, and completed result with checkpoint/event/outbox in one transaction. Do not create operation attempts, transport rows, receipts, or hold changes for pure local steps. Test rollback at every SQL write, all four process-crash boundaries, multiprocess CAS/cancel/lease races, and restart with a file-backed database. Preserve telemetry pagination, redaction, cursors, and outbox semantics. Existing external unknown work must stay unresolved.

**Phase C — bounded recovery composition:** after Phase B and the actual merged JEV observation interface. Add bounded, stable-order per-workflow pending-attempt inspection with a cap and explicit incomplete visibility. Report known durable evidence; never query a provider, retry paid work, settle a hold, or promote external results automatically.

**Phase D — canonical integration:** after the external contracts and owners above deliver accepted fixtures and consumer acknowledgements. Add real authorization, planner/JEV and finance boundaries only against their owned interfaces. Re-run all 13 groups through the integrated controller and the unchanged full issue criteria. A fresh independent review must inspect the exact integrated base/head before any merge.
