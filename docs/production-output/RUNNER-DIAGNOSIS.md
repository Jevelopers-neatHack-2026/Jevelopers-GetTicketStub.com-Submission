# Combined private runner diagnosis

The final integration imports actual main `e7e57bbb` (runtime foundation
`f251983a`) and the stopped contract-intake writer's docs-only `4c5ab24b` through
normal merges. Runtime review 3 approves that foundation only. It resolves the
historical ROOT-R1/RUNTIME-R2 findings at its reviewed bytes, without approving
this combined output candidate. Durability review 3 verifies DUR-R1..R7 at
`b5b96e0`; composition review 2 verifies COMP-R1..R5 and preserves COMP-R6's
stale candidate compile failure and inherited DUR-R4 vacuity. Those reports
remain immutable. Current build and independently executed selections are
separate evidence, not retroactive approval of those candidates.

## Reproduced evidence-directory defect

The old runner removes `NODE_TEST_*` but preserves other private suites'
evidence directories. Composition selects a fresh `PP_COMPOSITION_EVIDENCE_DIR`;
its real canary prefers inherited `PP_OUTPUT_EVIDENCE_DIR`. With the latter set,
the actual templates CLI executes 67/67 passing tests, writes the canary outside
the execution directory and correctly rejects the missing mandatory artifact.
This reproduces the supervisor's custom-evidence failure mechanism. No test
count, required artifact or assertion is relaxed.

The runner now removes inherited output/composition/durability evidence
directories and execution nonces at the independent execution boundary, then
sets only the selected fresh directory and nonce. Other application/security
environment values and deliberate canary failure controls remain intact.
`independentTestEnvironment` still preserves application environment when used
by genuine worker processes; only `runIndependentTests` owns this additional
isolation. A real canary regression exercises all three families with hostile
inherited paths/nonces and fails on the old runner before the correction.

## Deadline and workload boundaries

Both old Linux runs 38103571399/38103565127 cancel templates and personalization
nested tests at 60 seconds. Each old parent test included a complete passing
child suite and another complete failed-canary child suite inside one 60-second
budget; each child separately had a 60-second limit. The outer package runner
also ran files concurrently, multiplying nested browser/process work. Its
legacy release assertion accepted an aggregate failure without proving each
private child succeeded. Complete raw logs contain no child failure diagnostics
or uploaded artifacts, so they cannot establish whether the first child failed,
the second exceeded the shared budget, or resource contention caused either.

Positive and failed-canary executions now have separate 60-second tests. All six
composition selections and personalization execute both, checking exact counts,
fresh nonces and hashes. Each failed canary must complete every selected test
with exactly one failure and replace its actual earlier passing receipt.
The package runs one outer test file at a time; independent children retain
their existing file parallelism. This bounds overlap of complete nested suite
sweeps without changing any per-child deadline, fixture, sandbox or case.
It does not establish the exact cause of the historical Linux timeouts. The
parent must run the frozen combined source in actual Linux CI, within the
existing workflow budget, before claiming reliability.

Legacy leaf and release tests now also inspect every local private receipt,
exact expected count, mandatory artifact digest and canary nonce. They continue
to require `SUITE_UNIMPLEMENTED` for external leaves and `RELEASE_INCOMPLETE`
for release; a private `RUNTIME_FAILURE` is a test failure. A release test can no
longer pass because all outer failures happen to be nonzero.
Private failure diagnostics are checked before generic gate/state assertions,
so default CI cleanup cannot erase the only useful reason/count/exit evidence
from a completed child failure. Genuine failed-canary receipts exercise this
finite diagnostic serialization path as well as invalidating prior success.

Finite failure diagnostics are version 2, adding monotonic elapsed milliseconds
to existing reason/count/exit/signal/artifact states and SHA-256 references.
They retain no raw arbitrary error, test-label, customer, credential or
environment content. The 60-second child timeout, 4-MiB output limit, positive
exact counts, zero skips/cancellations/todo and fresh mandatory artifacts remain.

## Deterministic CSV privacy correction

The parent independently injected valid, unique UUIDs with a `0007` prefix in
a child-only crypto wrapper on locked `0fc7bfb`. The unchanged real CSV test
completed composition/storage/row/delivery assertions, then failed its whole
JSON substring check. A SHA-256 of input without `0007` also contains that short
substring. Owned red evidence reproduces both the pure assertion defect and
the genuine CSV failure at the privacy stage with zero generation calls.

The test now checks the complete private Observation field/type envelope:
only defined UUID/digest references, enum states/modes/codes, numeric values
and exact metric unit/value/completeness relationships are permitted. Unknown
top-level and nested payload/text fields reject. Raw attendee/seat strings in
identity, digest, state, code or numeric fields reject. Valid opaque references
may contain those four hex digits. This is a test-only assertion over current
private observations, not a changed production schema or canonical authority.
The Unicode name check and all real row, archive, attempt and transport retry
assertions remain. Three deterministic regression cases cover opaque references,
raw payload leakage and malformed envelopes; each output selection includes
them and raises its exact expected count by three.

The finite CSV receipt now records checkpoints before fixture creation and
rendering, then completion and privacy revision/verification, without raw event
values. It is mandatory output-suite evidence. The test passes its existing
30-second context's abort signal to the cooperative batch runner; neither its
deadline nor the independent child's 60-second deadline changes.

## Separate timeout and original failure holds

The earlier bounded diagnostic run's execution 7 timed out at 60,011 ms with
unknown counts. Its stage recorder wrote only on finalization, so the absent
artifact cannot identify the pending phase. No contemporaneous process/stack
snapshot establishes cleanup or resource state. Later before-await checkpoint
runs have only completed receipts on disk; the parent stopped the controller
for this evidence handoff, not a reliability waiver. At resumption no owned CSV
diagnostic processes were observed. That does not establish past cleanup.
The timeout remains explicitly unresolved for independent review and fresh
Linux. No unbounded sampling, retry acceptance, arbitrary sleep, expanded timer,
sandbox change or host service change resolves it here.
Pinned Node 24.21's `execFile` timeout sets its killed flag and sends SIGTERM to
the direct child. It does not itself establish descendant cleanup. No retained
snapshot proves which renderer/request was pending in execution 7 or whether
descendants were reaped at that moment. The source audit is retained separately;
current absence of owned diagnostic processes is a narrower observation.

The later named-release exporter failure completed 47/48 tests in 9.9 seconds;
its finite test-name hash identifies the CSV case. The confirmed privacy defect
is consistent with this failure, but its original assertion site was not kept.
Do not equate that correlation, the controlled probe, or the separate timeout
with a proven cause for the older OUTPUT-INT-1 observation.

OUTPUT-INT-1 remains open: the first old exporter release receipt reported
RUNTIME_FAILURE without a detailed cause. The subsequent 32/32 executions and
the previous archived-source reproduction are not a fix. Evidence-directory
isolation does not explain that output selection, which selected its own output
directory. Do not infer an exporter reliability certificate from later greens.

## Acceptance boundaries

The private policy-2 PDF semantic inspector and supported exact Arabic/wrapped
space corpus are unchanged. Parsed byte/font/paint/geometry/hash checks and
adversarial rejections still require fresh whole-candidate Astra High review.
The shared owner snapshot `2af72ec` is executable but unaccepted, not docs-only:
its required public operation shapes, full SVG/JSON/ZIP inventory and detached
protocol remain missing/incompatible, and its Node-22 engine excludes Node 24.
The inspected finance gateway still returns SOURCE_UNAVAILABLE. See
[candidate intake](../contracts/candidate-intake.md) for exact owner actions.
No canonical facade/bundle, real consumer acknowledgement, supplier approval,
finance acceptance or release readiness follows from private successes.

The result report links separate immutable failed raw-log hashes, current
finite diagnostics, standalone/nested evidence and commands. Parent publication,
actual exact-head Linux CI, manual QA and fresh whole-PR23 independent review
remain required before any winning merge.
