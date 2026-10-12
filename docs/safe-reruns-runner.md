# Runner receipt history and rerun authority

This bounded runner repair contributes to issue 21 (IE-09B.AC1/AC2/AC3). It does
not complete those criteria or release the verification tooling from its hold.
The separate `tools/rerun_report.py` read-only report on main has its own input
format and grants no execution authority. Its diagnostic advice is not an input
to this runner's authorization boundary.

## Execution authorization remains blocked

`authorize_rerun(prior, suite, rationale)` always denies execution with the current
receipt schema. It checks complete history, the two-diagnostic limit, rationale
privacy, provider modes, selected safety cases and the selected outcome history.
The explicit `supplier-ambiguity`, `restart-after-external-success` and
`authorization-mutation` guards remain in force even when their frozen safety
flags are false, as does the existing ambiguous-case-name guard.
Even an all-failed, offline, functional-shaped history ends with
`rerun_failure_provenance_missing`.

`CaseResult` does not record typed failure kind, case category or quarantine
provenance. `FAILED`, an exit code of zero, successful cleanup, an output digest,
or words such as “test failure” or “approved” cannot supply that missing proof.
`ERROR`, selected skips, environment or missing-dependency blockers, ambiguous
execution and quarantine cannot become authorized retries through this API.
Sandbox/live results or provider declarations require current owner authority,
budget and reconciliation through IE-05C outside this helper.

A future scoped change must establish owner-issued typed failure, category and
quarantine provenance before positively authorizing deterministic offline reruns.
That integration and a genuine positive execution scenario remain unimplemented.
There is no CLI retry command or automatic dispatch path here.

## Record already executed attempts without replacing history

`validate_history(history, suite)` validates a tuple of `Run` receipts ordered
original first. `link_rerun(history, candidate, suite, rationale)` returns a new
copy of an already executed candidate with its immediate parent, attempt index
and rationale bound. The returned receipt is a record, **not authorization**.
It grants no provider, budget, approval, quarantine or release authority.

For compatibility, either helper accepting `prior` also accepts one original
`Run`. A latest-only diagnostic is rejected: supply every ancestor. The old
unsafe implication that successful linking authorizes execution no longer holds.
There are no runtime callers of these helpers; existing callers are policy tests.

```python
from integration_evals.replay import link_rerun, validate_history

# original and candidate are separately retained, already executed Run records.
first = link_rerun((original,), candidate, suite, "offline diagnostic observation")
history = (original, first)
validate_history(history, suite)
# Retain the original and all linked receipts; do not dispatch from this result.
```

Record validation accepts passed, failed, error and skipped observations so that
unfavorable history can be preserved honestly. It requires:

- An original at attempt zero with no parent, then contiguous attempts 1 and 2.
- Unique run IDs, immediate parents and nonempty diagnostic rationales.
- Aware, strictly increasing recorded `started_at` timestamps. The injected
  `clock` stays identical and is not used to order actual receipts.
- Identical integration revision, source/manifest/suite/fixture/configuration
  digests, seed, clock, components, providers, dirty state, context, scope,
  selected IDs, runtime and per-result case/mode selection.
- A fresh candidate with no previous parent, attempt or rationale to overwrite.
- Valid suite-bound receipts and sanitized rationale/receipt content.

Neither helper mutates input receipts or writes files. Persist the complete
history with the existing immutable report writer; a pass never overwrites the
original failure. A fail-pass-fail history can be retained, but cannot authorize
another attempt or erase the pass when reporting flakes. Mandatory skipped or
quarantined cases remain release blockers. This helper does not compute flake
rates, release coverage or the separate report's classifications.

## Verification and limits

```sh
uv run pytest tests/test_replay.py tests/test_replay_history.py
uv run basedpyright
uv run ruff check
uv run ruff format --check
```

The focused tests use explicitly synthetic model copies for policy, chronology,
immutable-input and failure-history scenarios. An actual missing-assembly runner
receipt establishes the skipped-receipt rejection. Neither is genuine component
acceptance or evidence of successful Linux containment.

Consistency validation cannot authenticate a receipt, discover a completely
fabricated/reset history, or independently establish that submitted timestamps
are real. It rejects observable omissions and resets; trusted capture and complete
retention remain required. Actual historical containment failures stay failures;
this repair neither reruns them nor changes runtime security controls.
