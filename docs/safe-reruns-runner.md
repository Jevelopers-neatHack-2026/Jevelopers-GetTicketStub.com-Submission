# Preserved runner history and recorded evaluation diagnostics

This is a partial implementation of issue 21, IE-09B.AC1–AC4. It does not
complete owner re-execution, authentic source-flake acceptance, Linux containment,
JEV benchmark acceptance, or release approval. The existing read-only
`tools/rerun_report.py` format remains separate and grants no execution authority.

## Trust boundary

`execute_captured` runs the existing owner path once. Only successful local
`compare_response`, artifact retention and final cleanup can produce a comparison
capture. A failed oracle records `evaluation_failure=oracle-mismatch`; invocation,
missing dependency, invalid evidence, timeout and failed cleanup do not produce
eligible captures. Exit zero, output hashes and reason text alone never do so.

The frozen evaluator `Case` may explicitly declare `category` and `quarantined`.
Their default is unknown. Absent fields are omitted when serializing the suite,
so old frozen suite hashes remain valid; old receipts load but do not supply
missing diagnostic proof. Only explicit `functional` and `quarantined=false`
are eligible. Suite facts are evaluation declarations, not domain-owner approval.

The capture export allows only boolean/null observations whose keys occur in the
frozen assertions. It declines captures containing strings, numbers or undeclared
observations, then applies the existing credential/privacy rejection policy.
An excluded private capture does not erase the ordinary original failure.
The original owner response is not exported. A bundle is bounded by the existing
8 MiB artifact limit. Existing evidence metadata remains subject to its existing
permission, privacy, digest and retention checks.

`replay_comparisons` invokes the same `compare_response` again against the
hash-bound capture. It cannot call owner commands or providers. A new receipt is
labeled `recorded-evaluation-replay`, with a new run ID and
`evaluation_source_run` pointing to the original. Original evidence IDs, timestamps,
source run IDs and bytes are preserved. Diagnostic receipts do not invent fresh
owner evidence, process exit/cleanup results or charges. This can diagnose the
evaluator; it cannot establish stochastic behavior in the source component.

Generic `authorize_rerun` continues to deny owner redispatch. The blocker is not
necessarily missing OwnerResponse fields: mismatch and cleanup facts are local.
The current process wrapper does not establish absence of host-credential reads.
`processes.py` uses macOS allow-default with network/write restrictions, and Linux
read-only host-root binding. A fresh process retry requires independently reviewed
containment proof and trusted execution scope. Neither this feature nor a receipt
waives that boundary. Live/provider work still needs owner authority, budget and
IE-05C reconciliation.

## Actual entry points

```sh
# Existing pinned owner run, with at most two optional pure evaluator diagnostics:
uv run integration-evals run --manifest /approved/assembly.json --evaluation-diagnostics 2 --output /tmp/eval-runs

# Complete report: follows successors even when given the old original directory:
uv run integration-evals history-report /tmp/eval-runs/run-ORIGINAL --suite scenarios/suite.json

# Only repeat the evaluator over archived captured inputs; never execute stored commands:
uv run integration-evals replay-evaluation /tmp/eval-runs/run-ORIGINAL --suite scenarios/suite.json

# Statistical repeats are independent of the diagnostic cap:
uv run integration-evals benchmark-history benchmarks/corpus.json /approved/samples.json 4 /tmp/benchmark-history.json
```

Run/replay/report exit 2 means retained failure or incomplete acceptance. Invalid
input or denied replay exits 1. Benchmark export success only means the declared
sample set was preserved; its `promotion_blockers` remain visible. No command
executes a reproduction string or shell command read from a register.

The replay CLI verifies bundle, source artifact and ancestry hashes, current Python
runtime, and the installed evaluator source digest. It explicitly
labels archive source authenticity unverified. Local hashes cannot authenticate
an owner run, prove real timestamps or prevent a privileged actor from replacing
the entire archive and all of its hashes. A deserialized bundle grants only pure
comparison, never permission to invoke its stored owner commands.

## Immutable retention and reporting

`save_history(History(...), root, tracker, suite, artifact_root)` writes each
original-first prefix in its own run directory. Each contains `run.json`,
`suite.json`, complete `history.json`, measured `register.json`, coverage, JUnit
and a human report. CLI paths also write `release-audit.json`; a captured original
includes `comparisons.json` for minimal local replay. Preserve the whole sibling
run-directory set and the trusted suite when exporting a reproduction bundle.

Parent `successor.json` reservations are exclusive and hash-bound. A local file
lock serializes writers; stale writers cannot fork a parent. Files and directories
are flushed before successful append. Partial writes leave a blocking reservation.
There is no reset/overwrite/recovery shortcut. The reader rejects missing ancestors,
changed receipts, cycles, input drift, omitted retained successor snapshots,
symlinked records and changed evidence. Filesystem-wide destructive replacement
remains outside consistency validation and requires trusted backup/retention.

All original PR45 guards remain: contiguous attempts 0/1/2, identical revision,
source/manifest/suite/fixture/config digests, seed, clock, runtime, component/provider
pins, scope and selected modes, strictly increasing timestamps and rationale.
`supplier-ambiguity`, `restart-after-external-success`, `authorization-mutation`,
safety and ambiguous cases remain denied even if an old safety flag was false.
A pass anywhere stops further diagnostics. Errors, skips, unknown category,
quarantine, sandbox/live modes, provider operations and external providers stop them.

`coverage` and `audit` consume `History` directly. Passing a latest-only diagnostic
`Run` to those report/release boundaries is rejected. Full-history coverage, JUnit
and release audit preserve earlier failed/skipped/error samples. Mandatory
quarantine blocks release even after expiry or a later pass.

## Register, quarantine and CI triage

Each case row measures all sample IDs/outcomes, failure numerator, denominator,
last observed good/bad integration revision, structural failure signature,
requirements and owner. Missing remediation metadata is explicit
`triage_complete=false`; the implementation never invents an owner decision.
An optional `History.quarantines` entry supplies an owner, GitHub remediation
issue, reason and timezone-aware expiry. Reproduction is a fixed local report
command plus the original archive identity and its suite. Run that argument vector
from the common archive root; it is never arbitrary executable text.

```python
from datetime import UTC, datetime
from integration_evals.history import History, Quarantine

history = History(
    runs=all_original_first_runs,
    quarantines=(
        Quarantine(
            case_id=all_original_first_runs[0].selected_case_ids[0],
            owner="reliability",
            remediation_issue="https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/21",
            reason="Controlled example; replace with reviewed remediation disposition",
            expires_at=datetime(2026, 11, 1, tzinfo=UTC),
        ),
    ),
)
# Save the complete record through save_history; this example grants no approval.
```

Quarantine metadata is immutable within a retained history. Expiry triggers owner
triage; it never clears the row. Removal requires a linked reviewed remediation,
explicit recorded disposition, a separately pinned fresh execution and owner
review. Retain and link the old blocked archive. This implementation has no
in-place removal or release waiver API.

CI routes `consistently_failed` oracle mismatches to the owning component/evaluator,
`flaky` mixed outcomes to reliability with every sample, and `blocked` errors,
skips and quarantines to the dependency/security/authority owner. Unknown metadata
must be completed before claiming triage complete. Benchmark variation is exported
separately with the exact declared trial Cartesian set for rules/generative/JEV,
all raw samples and existing evaluator statistics. Missing/duplicate trials,
missing candidates and per-candidate pin/config/mode drift are rejected. Statistical
variation is never relabeled an infrastructure flake, and repeats are never
truncated to the diagnostic cap. Full held-out dataset and genuine provider
acceptance remain independent obligations.

## Verification

```sh
uv run pytest tests/test_seeded_history.py tests/test_history_integration.py tests/test_history_archive.py tests/test_diagnostic_execution.py tests/test_diagnostic_denials.py tests/test_benchmark_history.py tests/test_replay.py tests/test_replay_history.py
uv run basedpyright
uv run ruff check
uv run ruff format --check
```

Controlled protocol fixtures execute through actual containment and the existing
oracle. They prove repository tooling behavior, not product authority. Seeded
injected samples are likewise explicitly synthetic, and no provider is called.
