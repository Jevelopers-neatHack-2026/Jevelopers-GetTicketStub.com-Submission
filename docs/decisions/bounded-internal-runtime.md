# Bounded private runtime: Phase B/C

**Status:** private durable local-runtime prerequisite only. This increment does not pass full AH-04 or AH-08.

## Scope and ownership

Phase A supplies private bounded plan, registry, limit, and recovery-classification mechanics. Phase B/C adds a durable controller and read-only recovery inspection over the existing SQLite store. The controller and inspection functions remain private and are not exported from the package root. The package test target includes the planning and recovery tests, and the Makefile has a clearly labeled private prerequisite target; neither is a full AH-04/AH-08 acceptance target.

The integrated Phase B base is `bb280f2bfcf390b5d228148fb961ed0b2af326c9`, which includes telemetry and merged JEV PR 29. The database schema is 5 and the checkpoint envelope schema is 2. This increment adds no database migration and does not change existing telemetry, JEV, receipt, observation, cursor, privacy, event, or outbox semantics. The controller checkpoint kind below is an independent nested private payload version.

The private controller uses a consistent file-backed SQLite workflow/checkpoint/unknown-attempt snapshot, then commits each admission or completion through one fenced `BEGIN IMMEDIATE` transaction. `recordDispatchIntent` remains an external operation path and is never used for local steps. A local step creates no operation attempt, transport attempt, response receipt, hold, provider observation, or JEV observation.

The merged telemetry and JEV contracts remain untouched. Local checkpoint commits reuse the existing checkpoint, workflow event, and normal event outbox tables without changing telemetry cursor, redaction, queue, JEV observation, hold, receipt, or migration semantics.

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

Local evaluation is in-process. `runBoundedLocalPlan` uses only the static registry, persists an allowance before executing a pure step, and atomically commits a validated result with the next checkpoint/event/outbox. Each new admission is fenced to the current workflow revision and checkpoint sequence, live lease, cancellation state, external-attempt barrier, plan, registry, limits, and base checkpoint. Completion repeats the fresh state and fence checks. A committed result is returned as private synthetic evidence while the workflow remains running; it does not promote workflow status or imply canonical approval.

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

Budget snapshots include the pinned wall deadline, last wall sample, elapsed allowance, limit-set hash, and consumed counters. `advanceBudget` returns a new snapshot; the controller persists it atomically with admission before invoking a step, and loads the saved value after restart. A replay after an uncommitted pure computation consumes another attempt and retry allowance. A result already present in the completed checkpoint is returned without replay or additional writes. Limits and counts remain stopping facts only.

Within one process, elapsed time uses a monotonic clock. Across restarts, the persisted wall deadline is checked against the injected wall clock, which must remain a trusted source. Backward movement, inconsistent wall/elapsed samples beyond the 250 ms tolerance, or expiry fail closed. The reviewed local handlers have bounded input loops; a duration breach is observed after a handler returns and does not terminate it. No Promise.race or AbortSignal is claimed to preempt arbitrary synchronous JavaScript.

Plan and recovery errors expose fixed safe codes/messages only. Recovery output contains only a classification, a fixed reason code, and actionable: false; it does not copy source text, provider payloads, attempt IDs, tenant data, or hold references into diagnostics.

## Private recovery classification

classifyRecovery accepts bounded JSON text that projects two workflow reads (before and after), the selected checkpoint, the known attempt states, and a trusted observation time. The two workflow projections must agree on ID, state, revision, and checkpoint sequence before a local classification is returned. The controller and read-only inspector project one consistent store snapshot into that classifier input.

A supported private checkpoint is nested under the existing version 2 checkpoint envelope and uses kind `agent-harness.private-bounded-local-checkpoint`, nested version 2. It pins workflow ID, the original base checkpoint, plan JSON/hash, registry version, run identity, limits/hash, budget snapshot, completed-result JSON, and an optional pending step ID. The classifier verifies the checkpoint SHA-256 and these identities. The store controller reads workflow/checkpoint/unknown attempts from one SQLite snapshot. Recovery inspection uses stable keyset pagination bound to a workflow revision, returns a fixed maximum page, and exposes `hasMore`/`incomplete` explicitly. It does not copy opaque hold references or response bodies into its output. It returns one of:

- local-ready-candidate: a deterministic next step can be admitted; nothing is admitted by the classifier.
- local-replay-candidate: an admitted pure step is incomplete and another replay allowance is available; nothing is replayed by the classifier.
- durable-evidence-present: all private local results match the pinned identities; no workflow state is promoted.
- external-reconciliation-required: an existing intent, unknown outcome, response-received attempt, awaiting-response state, or reconciliation-pending state remains a barrier.
- stop or quarantine: missing, foreign, corrupt, unsupported, stale, terminal, review, cancelled, or invalid local data cannot be adopted.

Terminal states and review_required never become runnable. Unresolved external attempt evidence takes precedence over local recovery. Recovery inspection is read-only; it is not a restart sweeper and cannot query providers, update attempts, ingest external responses, settle/release holds, or promote receipts. A stale page cursor/revision stops safely.

## Phase B/C acceptance evidence

The following table maps all 13 mandatory groups. These local cases exercise private mechanics over the actual merged store. They do not replace canonical, Finance, tenant-authority, planner, provider, live, evaluation, or release acceptance.

| Group | Phase B/C local evidence | Remaining acceptance |
| --- | --- | --- |
| PLAN_BOUNDS | Controller and planner tests reject hostile inputs, bad graphs, unknown operations, unsupported versions, and graph/input/result limit overruns before durable admission. Deterministic dependency order is checked. | Re-run through any canonical planner integration; no production planner is installed. |
| NO_CAPABILITY_GRANT | Unknown, external, provider, and privileged operations stop before admission in mock/recorded/sandbox/live labels; intercepted `fetch` count stays zero. The private API accepts no injected registry, mode, grant, approval, or hold. | Actual tenant and Finance authorization remain external gates; offline judgments cannot grant them. |
| EXECUTABLE_LOCAL_PATH | File-backed controller computes dependent `number.add` results, persists admission/completion, validates identities, and returns committed results without another event or attempt. | This is private synthetic computation; canonical request/result and authenticated planner flow remain absent. |
| CRASH_BUDGET | Four child-process SIGKILL points cover before admission, after admission, after compute/before completion, and after completion. Reopen preserves counts; only an admitted pure step replays with another allowance; committed results do not repeat. | No arbitrary synchronous-code preemption is claimed. Repeat on supported platform/SQLite configurations. |
| CAS_CANCEL_LEASE | Independent file-backed processes race admission, completion/cancellation, and stale lease/takeover. Cancellation is also placed at admission and post-compute boundaries. One valid CAS wins and late completion cannot resurrect work. | Canonical authority and external reservation revocation races need accepted fixtures. |
| LIMITS_TIME | Planner tests cover exact caps. Controller persists deadline/counters, rejects expiry and rollback after reopen, stops at zero replay budget, and checks cancellation boundaries. | Trusted wall time across restarts remains an assumption; uncooperative handlers remain excluded. |
| RESULT_VALIDITY | Accessor inputs and provider-shaped/foreign results are rejected without invoking getters or copying markers; altered plan/registry pins fail completion; serialized identities are checked before storage. | Real provider result contracts remain external. |
| EXTERNAL_UNKNOWN_BARRIER | Actual store intent, outcome-unknown, and response-received fixtures block local work. Attempt state, receipt/checkpoint, and opaque hold evidence remain unchanged by the controller; it creates no local attempt, receipt, retry, or hold write. | Provider status lookup and financial reconciliation remain unimplemented. Receipt creation in tests is only an offline fixture via the existing store API. |
| RECOVERY_COMPATIBILITY | Private v1/foreign-prefix and missing-plan checkpoints stop without writes; classifier tests cover missing/old/future/corrupt/foreign data and terminal/review states. Existing schema 1-to-5 migration tests remain in the full store suite. Read-only attempt inspection pins workflow revision, pages in binary key order, and reports incompleteness. | No schema or envelope migration is added; future schemas remain unsupported by this branch. |
| ROLLOUT_AND_GATE | No production planner, canonical decision port, JEV route, promotion, Finance input, or live capability is installed. Package-root checks keep private entrypoints inaccessible. | Full AH-04/AH-06/AH-08 and release gates require accepted external artifacts below. |
| TRANSACTION_LOCAL_CHECKPOINT_EVENT | File-database triggers fail after each workflow/checkpoint/event/outbox write for admission and completion; full table snapshots match before/after and after reopen. Duplicate event IDs cannot add checkpoints. Four SIGKILL boundaries distinguish pending from committed results. | Re-run against supported CI SQLite builds and future migrations. |
| REVOCATION_READMISSION | Controlled cancellation, multiprocess cancellation/completion and lease races, and changed plan/registry pins stop stale work with counters unchanged. External operations remain unavailable in every mode. | Real authority/reservation revocation and cached-rank behavior remain unavailable without canonical contracts. |
| UNKNOWN_EXTERNAL_QUARANTINE | Provider-shaped, cross-workflow, altered-plan, and altered-registry result data fail before completion; raw fixture markers do not appear in diagnostics. Unknown/late attempt evidence is not used as local completion. | Durable provider-response ingestion remains in the owned JEV/canonical pathways; this controller is not an ingestion shortcut. |

## Issue and release acceptance remains open

This increment supplies a narrow private prerequisite for issue 19 (ACV1-AH04), issue 18 (ACV1-AH08), and a limited input to issue 17 (ACV1-AH06). All original acceptance conditions remain unchanged:

- **AH-04 / CON-03 / AGT-03 / AGT-04 / ACV1-JEV-08:** This increment contributes private local bounds, deterministic computation, and durable progress. It does not implement an authenticated ProjectRequest, canonical action DTO, actual planner provider/model, JEV ranking, budget metering, source retrieval, authorization, or a live planner happy path. The required bounded-planner-happy-path must use a real configured provider call with explicit model/snapshot, authorized identity, metered attempt, usage-or-unknown evidence, and persisted progress.
- **AH-08 / AGT-02 / AGT-03:** This increment persists only local pure-step admission/completion and read-only recovery evidence. It does not retry, reconcile, or settle provider effects.
- **FIN-03 / FIN-04 / BUD-03:** No distinct billed retries, unknown-billing evidence, conservative held-budget proof, finance ledger, or hold lifecycle is implemented. Existing opaque hold references remain external-owned and untouched.
- **AH-02:** No trusted tenant/project/artifact lookup, authenticated create/status/cancel/correct/resume command, scoped command idempotency, progress cursor, or authorization is implemented. A workflow ID is not tenant authority.
- **AH-06 / ACV1-JEV-04/05:** No canonical decision receipt, policy, cache, promotion, rollback, or active/shadow route is introduced. Synthetic local result hashes are not DecisionReceipts or cache authority.
- **SPN-01, SPN-02, provider/live, full AH-04/AH-08 and final-journey acceptance:** No Neatlogs/Entire artifact, paid provider call, live run, or external application acknowledgement is produced. Mock/private tests cannot satisfy those criteria.

Required external artifacts remain: accepted ProjectRequest/AuthorizationPort and versioned consumer commands; atomic Finance reservation/attempt and usage-or-unknown contracts; canonical DecisionPort/action/result/receipt/policy/promotion/cache contracts; accessible evaluation promotion and rollback authority; selected planner and JEV provider/model/account access plus budget and verified retry/status semantics. No missing DTO or authority is inferred here.

## Sequenced follow-up

**Phase B/C — private durable local controller and recovery:** implemented over merged schema 5 without a database or checkpoint-envelope migration. It uses fenced admission/completion over the existing checkpoint/event/outbox tables, persists limits/counters/deadline in a private nested version, and exposes bounded read-only attempt pages. No external receipt, operation attempt, transport, hold, or JEV observation is created by local work. Existing external unknown work stays unresolved.

**Phase D — canonical integration:** after the external contracts and owners above deliver accepted fixtures and consumer acknowledgements. Add real authorization, planner/JEV and finance boundaries only against their owned interfaces. Re-run all 13 groups through the integrated controller and the unchanged full issue criteria. A fresh independent review must inspect the exact integrated base/head before any merge.
