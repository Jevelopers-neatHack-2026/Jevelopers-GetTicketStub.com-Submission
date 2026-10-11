# ACV1 coverage validator

`scripts/validate-agent-creative-coverage.py` checks an explicitly supplied coverage-map snapshot against its source pins, an externally supplied canonical checklist, timestamped issue readbacks, and (optionally) a release manifest. It uses only the Python standard library, performs no network calls, and writes no files. It emits one deterministic JSON report to stdout and exits nonzero when required checks are blocked.

The checked-in [coverage input pin reference](../../planning/agent-creative-v1/coverage-input-pins.json) records dated source identities and observed dimensions. It contains no coverage rows, issue bodies, or canonical criteria. Its historical map pin is incomplete and has no fresh issue-readback pin; it is not a ready-to-run authorization or a current acceptance source. A caller must supply fresh, exact inputs and a run-specific pin manifest before a planning result can pass.

## Commands

Run the focused synthetic suite:

```sh
python3 -m unittest discover -s tests/planning -p 'test_coverage_validator.py'
```

Planning validation requires explicit input paths:

```sh
python3 scripts/validate-agent-creative-coverage.py /caller/path/coverage-map.json \
  --source-pins /caller/path/source-pins.json \
  --canonical-checklist /caller/path/acceptance-checklist.json \
  --issue-readbacks /caller/path/issue-readbacks.json \
  --check-urls --check-dag --require-specialist-leaves
```

The release form adds a caller-supplied evidence manifest:

```sh
python3 scripts/validate-agent-creative-coverage.py /caller/path/coverage-map.json \
  --source-pins /caller/path/source-pins.json \
  --canonical-checklist /caller/path/acceptance-checklist.json \
  --issue-readbacks /caller/path/issue-readbacks.json \
  --check-urls --check-dag --require-specialist-leaves \
  --release /caller/path/release-manifest.json --require-evidence
```

URL/readback and graph checks are enabled by default; `--no-check-urls` and `--no-check-dag` are explicit diagnostic opt-outs. A report with either required check omitted remains `BLOCKED`. Use both checks for planning or release qualification. `--require-specialist-leaves` requires at least one required leaf in each of the agent-harness, event-intelligence, and creative-engine families; release mode always applies that requirement. A CLI release invocation requires `--require-evidence`, and release mode always validates its evidence manifest.

Evidence paths in the release manifest are opened exactly as supplied (relative paths resolve from the process working directory). There is no repository search, fallback directory, or path discovery. The validator follows no final-component symlinks. It reads only the four named JSON inputs and the evidence files named by the release manifest.

## Input and resource contract

JSON object keys must be unique at every depth. Each root must be an object, each adapter alias and record family must be explicit, and malformed inputs return fixed diagnostic codes and stable record keys rather than source payloads or exception text. Input streams are read with finite bounds before parsing; evidence files are hashed in 64 KiB chunks.

| Input | Maximum |
| --- | ---: |
| Coverage map JSON | 8 MiB |
| Canonical checklist JSON | 1 MiB |
| Issue readbacks JSON | 16 MiB |
| Source pins or release manifest JSON | 2 MiB each |
| Each evidence file | 256 MiB |
| Total evidence bytes | 1 GiB |
| Coverage/readback/canonical entries | 10,000 each |
| Contribution rows, ownership rows, graph and staged-edge rows | 100,000 each |
| Release revision/evidence/receipt rows | 10,000 each |
| Blocker owner/action text | 512 characters each |
| Reported blocker rows | 250 (the report marks truncation) |

These are parser and resource bounds, separate from program scope. The observed 59 required leaves, 555 contribution rows, 91 mapped requirement IDs, 47 canonical criteria, and 16 criteria outside the scoped map are snapshot dimensions, not fixed quotas. Distinct contribution rows remain distinct even when they reference the same requirement ID. The validator compares every recomputed dimension to the caller's pin and accepts a later, correctly pinned snapshot with different counts.

The pin manifest uses `acv1.coverage-source-reference/v1`. It pins the exact map bytes by SHA-256, the canonical checklist by Git blob ID and byte count, and issue readbacks by SHA-256, capture ID, timestamp, observed source revision, and page-completeness flag. It names the source adapter, repository, revision, and path. A missing, unknown, repeated, incomplete, or mismatched source role blocks validation. The digest proves byte identity, not source authorization or signer identity.

The local map adapter is `agent-harness.coverage-map-current/v1`; map records require explicit `record_type` values (`implementation_leaf`, `delivery_leaf`, `epic`, `gate`, `release_gate`, or `program_gate`). The captured candidate does not yet include this adapter version or explicit record classification, and its historical pin marks it incomplete. The validator will report that candidate as blocked rather than infer types or rewrite its source. The canonical adapter is `integration-evals.acceptance-checklist/v1`; its records remain caller-supplied and are never copied into the product tree. The readback adapter is `agent-harness.issue-readbacks/v1`; it describes exactly what its complete paginated snapshot observed at its capture time, not present-day URL reachability.

## Checks and status boundaries

The report keeps `planning_status`, `coordination_status`, `publication_status`, and `release_status` distinct. A structurally valid planning result may show pending owner/action blockers; those blockers remain visible and prevent a required release outcome from passing. A pending coordination or publication state is not silently promoted and is not itself a substitute for scoped release evidence. `BACKLOG_READY` means the supplied planning structure reconciles; it does not close the coordination issue or establish feature completion.

Every required leaf has a unique key, explicit type, repository, owner role, priority, requirement IDs, and a pinned issue identity when a URL is known. Required URLs are matched to the readback by repository, issue number, title, state, and body digest; issue-number text is bounded before integer conversion. A null URL remains unknown and requires a concrete owner/action blocker; the validator never guesses a URL. A closed readback cannot be hidden behind an active map state, and a map marked closed cannot have an open readback. Closed leaves need an exact commit and the leaf's complete required test set, but a valid closed leaf does not need a replacement. Deferred and not-planned required leaves do not count. A replacement is recognized only when both records name one another.

Ownership projection is one row per unique requirement ID. Contribution records have independent unique row IDs, preserve row multiplicity, and reconcile to a declared leaf and owner. For each requirement, every declared required contributor must have at least one valid row; duplicating another contributor's row cannot hide a missing contributor. Scoped contributions to a global criterion retain its canonical ID, title, priority, owner, verification, and evidence requirement; they never claim the global criterion is complete. Canonical criteria outside the local map remain counted.

Execution edges are a typed DAG over actionable leaf prerequisites, checked iteratively. Required gate fan-in is compared with the explicit gate predecessor set; a valid positive fan-in is permitted. Evidence-stage edges are checked separately and cannot satisfy or rewrite execution prerequisites. A gate may collect stage evidence without becoming an implementation-leaf dependency. The local adapter recognizes the explicit stages `fixture`, `contract`, `runnable`, and `final_acceptance`, and edge states `pending` and `satisfied`. Each stage edge explicitly marks whether it is required for v1 and identifies the source requirement IDs it relates to; a required edge must relate to requirements mapped by both endpoint leaves. A release outcome must name the exact `evaluated_stage` declared for its leaf as `required_release_stage`; an outcome cannot choose a lower stage to bypass an applicable prerequisite. For a satisfied required edge at that selected stage, the source map must declare evidence IDs. Each ID must also appear on the prerequisite leaf's release outcome, resolve to content-hashed evidence, and carry the exact edge ID, requirement IDs, prerequisite leaf, prerequisite stage, revision, and mode. A pending or malformed applicable required edge fails closed; an optional pending edge and the checked-in pending `final_acceptance` edge to the release gate do not block a leaf's separate `runnable` result. Any owner receipt is required only when the source edge declares it, and it must also be declared and accepted on the prerequisite outcome. These structural checks do not authenticate the evidence producer or establish owner agreement.

Release validation requires each required outcome's exact tested repository revision, required tests, content-addressed evidence files, required mode, prerequisite status, and only those owner receipts explicitly named on its source leaf or applicable stage edge. Model and policy requirements come from the pinned leaf; the release outcome must repeat any declared expectation exactly, and its evidence must match it. Removing or changing an outcome field cannot disable a map requirement. Leaves without a model/policy requirement do not need fabricated pins. Pending blockers, stale revisions, absent or changed evidence, skipped required tests, missing required receipts, mismatched stages, and unresolved applicable stage prerequisites fail closed. Mock, recorded, sandbox, and shadow modes remain distinct from live. Successful digest/schema validation does not authenticate an owner, establish an actual provider or financial action, or prove that a claimed receipt is true.

No output can assert `SUBSYSTEM_COMPLETE`, whole-program acceptance, or global acceptance. A synthetic positive release fixture exercises local validator behavior only; it is not a real release, provider run, external contract adoption, or owner acceptance.

## Acceptance matrix represented by the suite

| Original case | Focused control |
| --- | --- |
| PL-00 | `test_synthetic_baseline_is_planning_only_and_keeps_fanin_separate`; `test_later_pinned_snapshot_with_changed_counts_is_accepted` |
| PL-01 / PL-03 | `test_duplicate_owner_or_orphan_ownership_fails` |
| PL-02 | `test_same_count_wrong_contribution_row_fails`; `test_same_count_contributor_reassignment_preserves_required_pair_check`; `test_distinct_repeated_contribution_rows_keep_multiplicity` |
| PL-04 / PL-14 | `test_required_specialist_family_and_null_url_block_without_guessing` |
| PL-05 | `test_required_specialist_family_and_null_url_block_without_guessing` |
| PL-06 / PL-15 | `test_issue_readback_mismatch_and_incomplete_pages_fail`; `test_readback_identity_rejects_wrong_repository_or_body`; `test_oversized_issue_number_is_bounded_and_cli_keeps_json_diagnostic` |
| PL-07 | `test_closed_requires_exact_evidence_deferred_never_counts`; `test_closed_readback_cannot_hide_an_active_map_leaf` |
| PL-08 | `test_supersession_requires_both_exact_link_directions`; `test_valid_supersession_requires_exact_bidirectional_relation` |
| PL-09 | `test_global_metadata_and_scope_cannot_be_rewritten_by_local_projection` |
| PL-10 | `test_missing_classifier_family_and_invalid_metadata_fail_closed`; `test_dated_source_reference_retains_snapshot_counts_without_using_them_as_limits` |
| PL-11 / PL-12 | `test_execution_graph_cycles_self_edges_unknown_and_epic_edges_fail` |
| PL-13 | `test_gate_fanin_is_checked_as_its_own_typed_relation`; `test_execution_graph_cycles_self_edges_unknown_and_epic_edges_fail` |
| RL-00 | `test_positive_release_branch_is_scoped_and_never_acceptance_claim` |
| RL-01 | `test_release_requires_exact_revisions_modes_tests_and_receipts` |
| RL-02 | `test_release_digest_model_policy_and_prerequisite_fail_closed`; `test_release_missing_artifact_is_named_without_path_echo` |
| RL-03 | `test_release_requires_exact_revisions_modes_tests_and_receipts` |
| RL-04 | `test_release_digest_model_policy_and_prerequisite_fail_closed`; `test_release_configuration_expectations_are_pinned_by_the_leaf`; `test_invalid_map_configuration_pin_types_are_reported` |
| RL-05 | `test_release_requires_exact_revisions_modes_tests_and_receipts`; `test_pending_external_blocker_keeps_planning_visible_and_fails_release` |
| RL-06 | `test_release_requires_exact_revisions_modes_tests_and_receipts` |
| RL-07 | `test_positive_release_branch_is_scoped_and_never_acceptance_claim`; `test_pending_external_blocker_keeps_planning_visible_and_fails_release`; `test_applicable_stage_prerequisites_need_revision_bound_evidence`; `test_outcome_cannot_lower_required_stage_and_final_gate_stays_outside_scope`; `test_stage_status_enum_and_required_evidence_fail_closed` |
| RL-08 | `test_readback_capture_pin_drift_is_explicit`; `test_issue_readback_mismatch_and_incomplete_pages_fail` |
| Provenance, JSON and bounds | `test_duplicate_json_keys_are_rejected_and_pin_mismatch_fails`; `test_nested_duplicate_json_keys_and_unknown_source_alias_fail`; `test_missing_readback_pin_is_blocked_and_report_does_not_guess`; `test_malformed_json_returns_fixed_diagnostic`; `test_input_byte_limit_is_checked_before_parse` |

PL-13 has no title-based or inferred “overbroad dependency” policy. The suite verifies the concrete structural boundaries: execution prerequisites must be leaf records, gate fan-in is separately declared and reconciled, and evidence-stage edges do not satisfy the execution DAG. A semantic narrowing decision requires an explicit source decision in the supplied input; the validator does not manufacture owner agreement.
