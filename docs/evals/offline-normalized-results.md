# Offline normalized-result projection

`evals/project_results.py` validates a small, synthetic-only JSONL format and emits deterministic descriptive summaries. It does not run a JEV adapter, call a provider, evaluate production routing, authenticate evidence, or make promotion decisions. Its only input mode is `synthetic_fixture_only`; this is a format boundary, not a privacy certification for arbitrary data.

Run it with the checked-in fixture:

```sh
python3 evals/project_results.py \
  --input tests/fixtures/evals/project-results/smoke.synthetic.jsonl \
  --output /tmp/projected-results.json
```

Exit code `3` means the input was structurally projected and the report was written. It is a nonzero status because promotion is always blocked. Exit code `2` means malformed or out-of-bounds input, including invalid or missing CLI arguments, and writes one fixed-code JSON error to stderr without echoing arguments, input paths, or values. `--help` prints normal usage and exits `0`. Omitting `--output` writes the report to stdout. Input paths and values are never copied into error messages.

## Input contract

The input is UTF-8 JSON Lines. The first line is one header object and every later line is one observation. Duplicate object keys, non-finite numeric constants, unsupported schema versions, unknown object fields, and invalid identifiers are rejected before projection. Schema version `1.0.0` has these header fields:

| Field | Meaning |
| --- | --- |
| `contract`, `schema_version` | Must be `ei.offline.normalized-results` and `1.0.0`. |
| `source_mode`, `dataset_id` | Must declare `synthetic_fixture_only` and a bounded fixture identifier. |
| `grouping` | Must be `split`, `arm`, `seed`, `question_id` in that order. |
| `required_question_ids` | Declares opaque question identifiers. The projector separately checks for all seven required EI question IDs but does not attach a class legend or meaning to them. |
| `expected_splits`, `expected_arms`, `expected_seeds`, `expected_cases` | Defines the expected cohort grid. Each expected case has only `case_id`, `family_id`, and `split`. Family IDs reused across calibration and held-out splits are flagged. |
| `denominators` | Optional declarations keyed by split, arm, seed, and question. The only supported method is `adjudicated_truth_token_rows`. A declaration never changes the expected record count. |
| `percentile_spec` | Optional. Only nearest-rank p50/p95 with `separate_cold_warm` is summarized. |
| `expected_pins` | Optional bounded pin claims for policy, corpus, question registry, result schema, adapter, model, baseline, and runtime. Values are compared to observations but never authenticated. |
| `mapping_claims`, `corpus_status`, `target_status` | Optional caller claims. A `caller_claimed_approved` value remains unverified and cannot change promotion status. |
| `owner_approval_claims`, `caller_claims` | Optional booleans supplied by the input author. They are recorded as claims only; they have no authority in this tool. |

Each observation must supply `case_id`, `family_id`, `split`, `arm`, `seed`, `question_id`, `truth`, `prediction`, `evidence_mode`, `latency_ms`, `latency_phase`, `usage_state`, `usage_attempts`, and `observed_pins`. `evidence_mode` must be `synthetic_fixture_only`.

Identifiers are bounded ASCII tokens: case, family, arm, seed, dataset, attempt, batch, and label tokens use `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`; question IDs use `[A-Za-z0-9][A-Za-z0-9._:-]{0,63}`; pin tokens use `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. Currency codes are three uppercase ASCII letters. These limits reject free-form source text, but a token that fits the grammar may still be sensitive. Label tokens intentionally appear in raw pair counts, so use only synthetic fixture labels. The grammar does not authenticate labels, establish their semantics, or certify arbitrary input as privacy-reviewed.

Truth objects have `status` and `token`. Truth statuses are `adjudicated`, `unmapped`, `missing`, and `unknown`; only an `adjudicated` truth with a token enters the descriptive agreement denominator. A token attached to `unknown` or `missing` remains visible in raw pair counts but is not treated as truth. Prediction statuses are `label`, `unmapped`, `abstained`, `outage`, `unknown`, and `missing`. Only a labeled prediction token can contribute to the exact raw-token match numerator. An outage or unknown prediction is retained as its own outcome and never counted as a match. The metric is named `exact_token_agreement`; it describes equality of unverified synthetic tokens and is not factual correctness or a semantic quality score.

For each declared group, the report shows the expected row count from the case inventory, observed rows, missing rows, status counts, and raw label-pair counts. Calibration and held-out groups are separate. A denominator declaration must equal the number of observed adjudicated truth-token rows. A missing or mismatched denominator produces a null agreement value with a reason. Missing observations remain visible and cannot be removed by declaring a smaller denominator.

Truth consistency is checked across expected arms and seeds for each stable case, family, split, and question identity. Multiple adjudicated claims for that identity must have the same opaque token. Present records for that identity must also use the same truth status; a difference such as `adjudicated` in one arm and `unknown` in another is a status inconsistency, not grounds to select or infer a truth. Missing rows contribute no status claim. `unmapped`, `missing`, and `unknown` remain explicit non-label states, and tokens attached to them remain untrusted raw values rather than adjudicated truth. A conflict adds `adjudicated_truth_conflict` or `truth_status_inconsistency` diagnostics keyed by sanitized `group_index` values and blocks data integrity. Exact-token agreement is set to null with reason `truth_consistency_conflict` for every group in the same split/question scope, while raw per-group status and token-pair counts remain visible. The projector does not choose a winning claim or infer token meaning.

Latency values are nonnegative numeric milliseconds with magnitude at most `1,000,000,000` and at most six decimal places. Integer literals are limited to 19 digits; decimal/exponent literals are limited to 64 characters and exponents from -6 through 9. Per group, cold and warm values are kept separate. Nearest rank selects rank `ceil(percentile × n / 100)` after sorting values. A phase with zero samples reports `null` percentiles and `zero_samples`; absent or unsupported method/boundary declarations also leave percentiles null.

## Cost and integrity behavior

Every observation has a `usage_state` of `attributed`, `unknown`, or `no_billable_usage_claimed`, plus a list of zero or more `usage_attempts`. Each attempt has a bounded `attempt_id`, `batch_id`, optional `retry_of`, a usage basis of `confirmed`, `estimated`, or `unknown`, and either a cost object or `null`. `unknown` must have `cost: null`. Confirmed and estimated claims include an uppercase currency, one precision from 0 through 6, and a nonnegative integer `amount_minor` no larger than `2^63 - 1`.

Attempt identity is global across the fixture. The same attempt attached to multiple case/question rows in one batch, split, arm, and seed counts once; a distinct retry attempt counts separately. Batch IDs cannot cross split/arm/seed contexts. Retry parents must be present in the same context, and retry cycles are rejected. Per-currency precision must be consistent throughout the input. Minor units are summed exactly as integers, with signed 64-bit aggregate bounds. Currencies are never combined.

Cost output is scoped to `unique_observed_billable_attempts`, not all-in workflow cost. It includes explicit expected/observed/missing observation coverage. If rows or cohorts are missing, a known amount may appear only as `observed_attempt_subtotal_incomplete_coverage`; it must not be read as a full run total. Unknown usage, unknown attempt costs, claimed absence of billable use, incomplete attribution, currency conflicts, precision conflicts, and overflow block the corresponding total. Unknown cost is never converted to zero. `confirmed` and `estimated` are separate claims, not independently verified accounting records.

`data_integrity_status` describes structural completeness of the supplied synthetic records and claims. `promotion_status` is always `blocked`, and `promotion_possible` is always `false`, even if an input sets every approval/live field to `true` or repeats matching pin strings. A clear data-integrity status is not an approval or an evaluation result.

## Bounds, tests, and limits

The parser accepts at most 8 MiB total, 64 KiB per line, 10,000 observation rows, 2,000 expected cases, eight arms, sixteen seeds, and 64 attempts per observation. It rejects duplicate JSON keys, non-finite numbers, booleans used as numbers, overlong numeric literals, oversized magnitudes, invalid UTF-8, and duplicate observations. Errors contain only a fixed code and optional JSONL line number; raw fields, values, and paths are not echoed.

Run the focused tests with:

```sh
python3 -m unittest discover -s tests/evals -p 'test_project_results.py' -v
```

The path-filtered `.github/workflows/offline-eval-projection.yml` job pins Python 3.11.17 and fails if the expected test count changes or any case is skipped.

This projector does not implement confidence intervals, semantic metric mappings, authenticated adjudication, independently qualified corpus/calibration targets, owner approval verification, complete cost accounting, an actual JEV adapter or model/runtime receipt, active routing evidence, or the rest of issue #21. Those remain required work. No output from this tool can close those gaps or promote a system.
