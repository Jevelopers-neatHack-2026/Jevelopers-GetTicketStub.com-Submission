# Safe reruns runbook

> **Status: read-only local reporting is implemented; issue 21 remains open.** This page documents the run-history report (`tools/rerun_report.py`, "IE09B read-only local reporting v1"), which lands in the same combined PR. Actual integration with PR 23 and the full machine-readable run schemas from issue 8 remains **pending**. The input format below is a local reporting format, not the canonical producer/consumer domain schema, and nothing here is evidence that any actual run happened.

## Principles

- **Original failures are preserved.** A rerun is a new record appended after the original. It never replaces, edits or hides the original outcome.
- **A diagnostic rerun is not a fix.** A later pass never verifies a release and never clears a mandatory case.
- **Reports are not authority.** The report grants no status, no producer rights and no schema authority. A `diagnostic_candidate` decision is advice to a human, never runtime authorization.
- **The report is read-only and offline.** The script itself reads one local file, makes no network calls and never mutates its input. This describes the script only; it says nothing about how or at what cost the runs it summarizes were produced, or about development usage, which is separate and unknown here.

## Triage

1. Record the original failure as run `attempt_index` 0 with `parent_run_id` null.
2. Check the case category and provider modes. Only `functional` cases whose provider modes are all `mock` or `recorded` can ever be diagnostic candidates.
3. Check the error kind of every run. Only a history in which every run is `failed` with `test_failure` qualifies.
4. If the case is eligible, run at most **two** diagnostic reruns, offline (mock or recorded providers only), each appended as the next attempt.
5. Classify from the full recorded sequence (below) and route accordingly.

## Routes

| Situation | Route |
| --- | --- |
| `functional`, all `mock`/`recorded`, **every** run `failed` with `test_failure`, fewer than 2 reruns so far, no quarantine, no `environment`/`ambiguous_dispatch` error in any run | `diagnostic_candidate`: a human may run one more offline diagnostic rerun |
| `live` or `sandbox` provider mode anywhere | Stop. **Never auto-dispatch.** |
| Category `safety` or `authorization` | Stop. **Never auto-dispatch.** |
| `ambiguous_dispatch` in any run | Stop. **Never auto-dispatch.** It is unknown whether the action happened. |
| `environment` error in any run | Blocked. Fix the environment first. |
| Quarantine present | Blocked. |
| Any run not a `failed`/`test_failure`, e.g. fail-pass-fail | Stop. Not a candidate: a pass anywhere in the history ends eligibility, even if the first and last runs failed. |
| Two reruns already recorded | Stop. Escalate to the owner. |

Anything that needs a live or sandbox run, more attempts, or spend is an explicit owner decision made outside this report. **Owner reconciliation and budget approval are separate, explicit steps**; the report does not request, imply or record either.

## Classification

| Classification | Condition |
| --- | --- |
| `passed` | Every run passed, i.e. the original passed |
| `flaky` | At least one pass and at least one failure in the history |
| `consistently_failed` | Every run failed |
| `blocked` | Any run was `skipped` or `error`, or the case is quarantined |

Benchmark cases are reported with a separate variation classification. **Benchmark and statistical repeats are kept separate from diagnostic reruns, and the report never triggers automatic reruns for them.**

## Release gate

`release_blocked` is true for a mandatory case if any run in the history (original included) is `failed`, `skipped` or `error`, or if the case is quarantined. A diagnostic pass does not change that. **No release-gate waiver exists in this report**; a waiver, if any, is an explicit decision recorded elsewhere by the owner.

## Quarantine limits

A quarantine object is optional and is a record, not an exemption. The input carries `reason`, `owner_role`, `remediation_issue` (an `https://github.com/<owner>/<repo>/issues/<n>` URL), `expiry` (UTC), `reproduction_command`, `failure_signature`, `last_good_revision` (full lowercase 40-hex commit or null) and `last_bad_revision` (full lowercase 40-hex commit). A quarantined case is always `blocked`, is never a diagnostic candidate, and does not lift `release_blocked`. The output carries only the optional metadata: the issue URL, the expiry and the revisions. The raw `reason`, `failure_signature` and `reproduction_command` stay in the input and are never echoed.

## Reproduction

```
python3 tools/rerun_report.py /tmp/history.json
python3 -B -m unittest discover -s tests
```

The first command reports on a local history file you supply; the second runs the unit tests.

Exit codes: `1` invalid input, `2` the report is valid and `release_blocked` is true, `0` otherwise. Stdout is deterministic JSON.

## Limitations

**The history is not authenticated.** The report cannot tell whether the file was written by a real harness, edited by hand or fabricated. The copied pins, digests, seed and provider modes are consistency checks against the file's own top-level declarations, not proof. The report never changes any master checklist or status.

## Input format (v1)

Top level: `format_version` 1; `case_id` (safe ID, below); `requirement_ids` (nonempty list of unique safe IDs); `mandatory` (boolean); `category` (`functional`, `safety`, `authorization` or `benchmark`); `provider_modes` (nonempty object with safe-ID keys whose values are `mock`, `recorded`, `sandbox` or `live`); `pins` (nonempty object with safe-ID keys and full lowercase 40-hex commit values); `fixture_digest` and `config_digest` (lowercase 64-hex); `seed` (nonempty string); `runs` (nonempty list); optional `quarantine`.

Each run: `run_id` (safe ID, unique); `parent_run_id` (null for the original, otherwise the immediately preceding `run_id`); `attempt_index` (contiguous from 0 to at most 2); `outcome` (`passed`, `failed`, `skipped`, `error`); `error_kind` (`none`, `test_failure`, `environment`, `ambiguous_dispatch`); `rationale` (nonempty); `occurred_at` (UTC ISO timestamp with timezone, strictly increasing across runs). Every run also repeats `pins`, `fixture_digest`, `config_digest`, `seed` and `provider_modes`, which must equal the top-level values exactly. These are immutable declarations, not independently trusted facts.

**Safe IDs** (`case_id`, `run_id`, each `requirement_ids` entry, pin keys and provider-mode keys) match the ASCII grammar `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`.

**Rejected input.** Input over 1 MiB, non-regular input files, duplicate JSON keys, unknown fields, non-finite numbers, floats and huge integers are rejected (exit 1) with sanitized errors that do not echo arbitrary input values.

## Output

Deterministic JSON with `format_version` 1, `provider_mode` `"N/A"` and `scope` `"offline-report-only"`. It contains the source hash, the recorded outcome sequence, whitelisted-grammar `run_id` and outcome values, attempt counts, the classification, failure count, total denominator, `release_blocked`, and a decision with a reason enum. `release_verified` and `rerun_authorized` are always `false`. The seed appears only as its SHA-256. Optional quarantine metadata is limited to the issue URL, expiry and revisions. The source hash and outcome sequence are observations of the supplied file, recorded for provenance; they are not authority and do not attest that the history is genuine. It never includes raw `rationale`, `reason`, `failure_signature` or `reproduction_command` text or other arbitrary input content.

## Example input

**Fictional and synthetic.** It is not a record of any real run or commit, and the all-`1` and all-`2` values are dummy test hashes, not real SHAs or digests. It is shaped to be valid under the v1 format above, and the companion tests can validate it.

```json
{
  "format_version": 1,
  "case_id": "synthetic-case-1",
  "requirement_ids": ["SYNTHETIC-1"],
  "mandatory": true,
  "category": "functional",
  "provider_modes": {"example-provider": "mock"},
  "pins": {"example-component": "1111111111111111111111111111111111111111"},
  "fixture_digest": "2222222222222222222222222222222222222222222222222222222222222222",
  "config_digest": "2222222222222222222222222222222222222222222222222222222222222222",
  "seed": "synthetic-seed",
  "runs": [
    {
      "run_id": "synthetic-run-0",
      "parent_run_id": null,
      "attempt_index": 0,
      "outcome": "failed",
      "error_kind": "test_failure",
      "rationale": "synthetic original failure",
      "occurred_at": "2026-01-01T00:00:00Z",
      "pins": {"example-component": "1111111111111111111111111111111111111111"},
      "fixture_digest": "2222222222222222222222222222222222222222222222222222222222222222",
      "config_digest": "2222222222222222222222222222222222222222222222222222222222222222",
      "seed": "synthetic-seed",
      "provider_modes": {"example-provider": "mock"}
    }
  ]
}
```

Under these rules this history has one failed original, fewer than two reruns and no quarantine, so it would be a `diagnostic_candidate`, and `release_blocked` would be true (exit 2). This expected result is fictional and illustrates the rules only; it is not a claim that any real run occurred. The output is described rather than shown.
