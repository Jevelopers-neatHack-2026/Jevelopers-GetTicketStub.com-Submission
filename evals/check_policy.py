#!/usr/bin/env python3
"""Validate the EI promotion policy and corpus without provider calls.

Exit codes: 0 = structurally valid and promotion-ready (or --validate-only),
1 = malformed or inconsistent artifacts, 2 = valid artifacts but promotion is
blocked by an unresolved decision or missing evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


REQUIRED_QUESTIONS = (
    "Q-EI-SOURCE-TYPE:v1",
    "Q-EI-RELEVANCE:v1",
    "Q-EI-INJECTION:v1",
    "Q-EI-IDENTITY:v1",
    "Q-EI-FACT-SUPPORT:v1",
    "Q-EI-CONFLICT:v1",
    "Q-EI-BRAND-ROLE:v1",
)
REQUIRED_FAMILIES = (
    "ordinary",
    "sparse_dynamic",
    "unsupported",
    "no_answer",
    "identity_edition_conflict",
    "changed_date_venue",
    "multilingual_noisy",
    "hostile_url_content",
    "wrong_assets_stale_rights",
    "cache_provider_outage",
)
REQUIRED_GLOBAL_ROLES = {
    "domain_question_and_corpus_owner": "Agent and research",
    "EVAL-02_comparable_improvement": "Finance and reliability",
    "EVAL-03_evidence_classification": "Product and frontend",
    "EVAL-04_secrets_and_customer_data": "Finance and reliability",
    "cost_basis_and_tradeoff_review": "Finance and reliability",
    "separate_paid_budget_authority": "Captain with finance owner",
}
REQUIRED_CORPUS_MINIMUMS = {
    "calibration_cases": 120,
    "held_out_cases": 240,
    "held_out_cases_per_scenario_family": 20,
    "held_out_non_english_cases": 40,
    "held_out_non_english_languages": 4,
    "held_out_requires_cjk": True,
}
REQUIRED_REEVALUATION_TRIGGERS = [
    "policy_version", "question_registry_or_threshold", "event_intelligence_schema",
    "jev_model_id_or_revision", "jev_adapter_revision", "deterministic_baseline_revision",
    "generative_baseline_revision", "dependency_revisions", "runtime_version",
    "configured_workload_or_budget",
]
LABEL_PROVENANCE = "author_authored_synthetic_expectation_not_independently_adjudicated"
LINEAGE_SCOPE = "case_scoped_fixture_ids_only_no_real_world_independence_claim"
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d ()-]{8,}\d)(?!\w)")
WEB_URL_RE = re.compile(r"https?://", re.I)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def reject_json_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number is forbidden: {value}")


def assignment_digest(assignments: list[dict[str, Any]]) -> str:
    fields = (
        "case_id", "split", "scenario_family", "source_family_id",
        "event_family_id", "template_family_id",
    )
    data = "\n".join("|".join(str(row.get(field, "")) for field in fields) for row in assignments) + "\n"
    return sha256(data.encode("utf-8"))


def read_json(path: Path, errors: list[str], label: str) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_json_constant)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        errors.append(f"{label}: cannot read valid JSON ({exc})")
        return None
    if not isinstance(value, dict):
        errors.append(f"{label}: top-level value must be an object")
        return None
    return value


def read_jsonl(path: Path, errors: list[str], label: str) -> list[dict[str, Any]]:
    try:
        raw_lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        errors.append(f"{label}: cannot read UTF-8 JSONL ({exc})")
        return []
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(raw_lines, 1):
        if not line.strip():
            errors.append(f"{label}:{line_number}: blank JSONL row")
            continue
        try:
            row = json.loads(line, parse_constant=reject_json_constant)
        except (json.JSONDecodeError, ValueError) as exc:
            errors.append(f"{label}:{line_number}: invalid JSON ({exc})")
            continue
        if not isinstance(row, dict):
            errors.append(f"{label}:{line_number}: row must be a JSON object")
            continue
        rows.append(row)
    return rows


def _is_number(value: Any) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(float(value))
    except (OverflowError, ValueError):
        return False


def _has_phone_number(text: str) -> bool:
    return any(sum(character.isdigit() for character in match.group(0)) >= 10 for match in PHONE_RE.finditer(text))


def validate_policy(policy: dict[str, Any], errors: list[str], blockers: list[str]) -> dict[str, Any]:
    if policy.get("policy_status") != "proposed_unapproved":
        errors.append("policy_status must remain proposed_unapproved until authenticated owner review exists")
    if not isinstance(policy.get("policy_version"), str) or not policy.get("policy_version"):
        errors.append("policy_version must be explicit")
    if policy.get("requirement_scope") != ["EI-12", "JEV-EI-07", "EVAL-02", "EVAL-03", "EVAL-04"]:
        errors.append("requirement_scope must retain EI-12, JEV-EI-07, EVAL-02, EVAL-03, and EVAL-04")
    roles = policy.get("global_owner_roles")
    if roles != REQUIRED_GLOBAL_ROLES:
        errors.append("global_owner_roles must preserve the authoritative acceptance roles")

    verification = policy.get("approval_verification")
    expected_verification = {
        "mode": "unverified_local_record_only",
        "local_checker_may_authenticate": False,
        "trusted_role_signing_keys": [],
        "approval_json_or_a_copied_receipt_hash_counts_as": "unverified claim, never proof",
        "external_verified_owner_decision_source": None,
    }
    if verification != expected_verification:
        errors.append("approval_verification must state that local approval fields and copied hashes are unauthenticated")
    blockers.append("No trusted owner-role signing keys or authenticated decision source are configured; local approval fields cannot authorize promotion")

    questions = policy.get("required_questions")
    if not isinstance(questions, list):
        errors.append("required_questions must be a list containing all seven versioned questions")
        questions = []
    question_by_id: dict[str, dict[str, Any]] = {}
    ids = [q.get("id") for q in questions if isinstance(q, dict)]
    if ids != list(REQUIRED_QUESTIONS):
        errors.append("required_questions must include the seven required v1 question IDs exactly once and in registry order")
    for q in questions:
        if not isinstance(q, dict) or not isinstance(q.get("id"), str):
            continue
        question_by_id[q["id"]] = q
        qid = q["id"]
        if q.get("owner_role") != "Agent and research":
            errors.append(f"{qid}: owner role must remain Agent and research")
        classes = q.get("classes")
        if not isinstance(classes, list) or not classes or len(set(classes)) != len(classes):
            errors.append(f"{qid}: classes must be a nonempty unique list")
            classes = []
        required_metrics = q.get("required_metrics")
        definitions = q.get("metric_definitions")
        if not isinstance(required_metrics, list) or not required_metrics:
            errors.append(f"{qid}: required_metrics must be explicit")
            required_metrics = []
        if not isinstance(definitions, dict) or any(not isinstance(definitions.get(m), str) or not definitions[m].strip() for m in required_metrics):
            errors.append(f"{qid}: every required metric needs a denominator-aware definition")
        for field in ("positive_classes", "negative_classes", "unknown_classes"):
            values = q.get(field)
            if not isinstance(values, list) or any(item not in classes for item in values):
                errors.append(f"{qid}: {field} must identify valid classes")
        pos = set(q.get("positive_classes") or [])
        neg = set(q.get("negative_classes") or [])
        unknown = set(q.get("unknown_classes") or [])
        if pos & neg or pos & unknown or neg & unknown or (pos | neg | unknown) != set(classes):
            errors.append(f"{qid}: positive, negative, and unknown classes must partition all classes")
        mins = q.get("minimum_samples_per_class")
        if not isinstance(mins, dict) or any(not _is_number(mins.get(k)) or mins[k] < 1 for k in ("calibration", "held_out", "non_english_held_out_per_language")):
            errors.append(f"{qid}: numeric minimum class coverage is required for calibration, held-out, and each non-English language")
        if not isinstance(q.get("candidate_thresholds"), dict) or not q["candidate_thresholds"]:
            errors.append(f"{qid}: proposed numeric candidate thresholds are required")
        elif any(not _is_number(value) or value < 0 or value > 1 for value in q["candidate_thresholds"].values()):
            errors.append(f"{qid}: rate thresholds must be finite numeric values from zero through one")
        for field in (
            "denominator", "confidence_interval_method", "threshold_selection_split",
            "error_cost_reference", "latency_target_reference", "downstream_cost_target_reference",
            "quality_cost_tradeoff_reference", "approval_status",
        ):
            if not isinstance(q.get(field), str) or not q[field].strip():
                errors.append(f"{qid}: {field} is required")
        if q.get("threshold_selection_split") != "calibration":
            errors.append(f"{qid}: threshold selection must use calibration only")
        if q.get("approval_status") != "proposed_unapproved":
            errors.append(f"{qid}: candidate metric thresholds must remain proposed_unapproved without authenticated review")
        blockers.append(f"{qid}: candidate metric thresholds and slices are not owner-approved")

    approvals = policy.get("approval_records")
    if not isinstance(approvals, list) or not approvals:
        errors.append("approval_records must identify accountable role reviews")
    else:
        for row in approvals:
            if not isinstance(row, dict) or not all(row.get(k) for k in ("decision", "required_role", "status")):
                errors.append("each approval record must name a decision, role, and status")
                continue
            if row.get("status") != "pending_owner_review" or row.get("approved_by") is not None or row.get("approval_reference") is not None:
                errors.append(f"Approval record {row['decision']} must remain pending and contain no unauthenticated approver claim")
            blockers.append(f"Approval pending: {row['decision']} ({row['required_role']})")

    pins = policy.get("version_pins")
    required_pins = (
        "policy", "question_registry", "corpus", "eval_artifact_storage_schema", "event_intelligence_schema",
        "jev_model_id_and_revision", "jev_adapter_revision", "deterministic_baseline_revision",
        "pinned_generative_baseline_provider_model_revision", "dependency_revisions", "runtime_version",
    )
    if not isinstance(pins, dict):
        errors.append("version_pins must be an object")
    else:
        for key in required_pins:
            if not pins.get(key):
                blockers.append(f"Version pin missing: {key}")
        if pins.get("policy") != policy.get("policy_version") or pins.get("question_registry") != "1.0.0":
            errors.append("policy and question registry version pins must match the versioned artifacts")
    versioning = policy.get("version_compatibility")
    expected_versioning = {
        "policy_version": "1.0.0",
        "question_registry_version": "1.0.0",
        "eval_artifact_storage_schema": "1.0.0",
        "manifest_schema_version": "1.0.0",
        "split_lock_schema_version": "1.0.0",
        "preserve_immutable_history": True,
        "producer_consumer_review_required": True,
        "previously_supported_fixture_versions": "retain as immutable fixtures or provide an owner-reviewed migration record",
        "unsupported_major_version_behavior": "actionable typed validation error; do not silently coerce",
        "storage_scope_note": "This pins eval artifact storage formats. No application event store or runtime storage implementation exists in the inspected base revision.",
    }
    if versioning != expected_versioning:
        errors.append("version compatibility must pin artifact schemas, retain immutable history, and reject unsupported major versions")
    elif isinstance(pins, dict) and pins.get("eval_artifact_storage_schema") != versioning["eval_artifact_storage_schema"]:
        errors.append("evaluation artifact storage pin differs from the compatibility declaration")

    targets = policy.get("cost_and_latency_targets")
    if not isinstance(targets, dict):
        errors.append("cost_and_latency_targets must be an object")
        targets = {}
    cap = targets.get("standard_workflow_cost_cap", {})
    comparison_cap = targets.get("comparison_total_cost_cap", {})
    cap_record = cap if isinstance(cap, dict) else {}
    comparison_cap_record = comparison_cap if isinstance(comparison_cap, dict) else {}
    workflow_latency = targets.get("standard_workflow_latency_seconds", {})
    question_latency = targets.get("single_question_latency_milliseconds", {})
    for label, record, fields in (
        ("standard workflow cost cap", cap, ("amount", "currency", "per", "unknown_cost_treatment")),
        ("comparison cost cap", comparison_cap, ("amount", "currency", "per")),
        ("workflow latency", workflow_latency, ("p50_max", "p95_max", "measurement_boundary")),
        ("question latency", question_latency, ("p50_max", "p95_max", "measurement_boundary")),
    ):
        if not isinstance(record, dict) or any(record.get(field) is None or record.get(field) == "" for field in fields):
            errors.append(f"{label}: numeric targets, units, and measurement boundary are required")
    if isinstance(cap, dict) and (not _is_number(cap.get("amount")) or cap.get("amount", 0) <= 0 or cap.get("currency") != "USD"):
        errors.append("standard workflow cap must be a positive numeric USD amount")
    if isinstance(comparison_cap, dict) and (not _is_number(comparison_cap.get("amount")) or comparison_cap.get("amount", 0) <= 0 or comparison_cap.get("currency") != "USD"):
        errors.append("comparison cap must be a positive numeric USD amount")
    for record, name in ((workflow_latency, "workflow"), (question_latency, "question")):
        if isinstance(record, dict) and (not _is_number(record.get("p50_max")) or not _is_number(record.get("p95_max")) or record.get("p50_max", 0) <= 0 or record.get("p95_max", 0) < record.get("p50_max", 0)):
            errors.append(f"{name} latency must have positive p50/p95 maxima with p95 >= p50")
    if targets.get("status") != "approved" or cap.get("status") != "approved" or not cap.get("rate_card_version") or not cap.get("cost_basis") or cap.get("cost_basis") == "unresolved_requires_finance_approval":
        blockers.append("Latency and USD caps are proposed; Finance and reliability has not approved the cost basis or rate card")
    eval_auth_value = targets.get("evaluation_authorization", {})
    eval_auth = eval_auth_value if isinstance(eval_auth_value, dict) else {}
    if eval_auth.get("finance_cost_basis_approval") != "approved":
        blockers.append("Finance cost-basis approval is pending")
    if eval_auth.get("captain_and_finance_paid_budget_authorization") != "approved":
        blockers.append("Separate captain and finance paid-budget authorization is absent")
    if eval_auth.get("provider_calls_allowed") is not True:
        blockers.append("Provider calls are not authorized")

    tradeoff = policy.get("quality_cost_tradeoff")
    numeric_tradeoff = (
        "minimum_quality_gain_absolute", "maximum_incremental_cost_per_attempt_usd",
        "minimum_cost_reduction_for_quality_noninferiority", "quality_noninferiority_margin_absolute",
        "maximum_regression_on_any_hard_gated_quality_metric",
    )
    if not isinstance(tradeoff, dict) or any(not _is_number(tradeoff.get(key)) or tradeoff[key] < 0 for key in numeric_tradeoff):
        errors.append("quality_cost_tradeoff must declare numeric gain, cost, reduction, and non-inferiority limits")
    if not isinstance(tradeoff, dict) or tradeoff.get("status") != "approved" or not tradeoff.get("approved_by") or not tradeoff.get("approval_reference"):
        blockers.append("Quality/cost tradeoff is proposed and requires Agent and research plus Finance and reliability approval")
    error_costs = policy.get("error_costs")
    if not isinstance(error_costs, dict) or any(not _is_number(error_costs.get(k)) for k in (
        "false_exclusion_of_relevant_source", "false_accept_of_unsupported_event_fact",
        "false_merge_of_different_event_occurrence", "missed_date_or_venue_conflict",
        "wrong_entity_or_unapproved_asset_acceptance", "false_positive_injection_signal_on_benign_quote",
    )):
        errors.append("error_costs must declare numeric relative severity for each named error")
    if not isinstance(error_costs, dict) or error_costs.get("status") != "approved":
        blockers.append("Relative error costs remain proposed and unapproved")

    ci = policy.get("confidence_intervals")
    if not isinstance(ci, dict) or not ci.get("method") or not _is_number(ci.get("confidence_level")) or not 0 < ci.get("confidence_level", 0) < 1:
        errors.append("confidence intervals require a method and numeric confidence level")
    elif ci.get("zero_denominator") != "report not_applicable and block the affected gate; do not replace with zero":
        errors.append("zero denominators must be reported as not applicable and block the affected gate")

    corpus_admission_value = policy.get("corpus_admission", {})
    corpus_admission = corpus_admission_value if isinstance(corpus_admission_value, dict) else {}
    if corpus_admission.get("current_mode") != "synthetic_smoke_fixture_only":
        errors.append("corpus_admission.current_mode must identify the checked-in data as smoke fixtures only")
    if corpus_admission.get("required_minimums") != REQUIRED_CORPUS_MINIMUMS:
        errors.append("corpus_admission.required_minimums must retain the required calibration, held-out, family, and language counts")
    if corpus_admission.get("lineage_claim") != LINEAGE_SCOPE or corpus_admission.get("label_provenance") != LABEL_PROVENANCE:
        errors.append("corpus admission must disclaim real-world lineage and independent label adjudication")
    if corpus_admission.get("independent_family_audit") != "pending":
        errors.append("independent family audit must remain pending")
    if corpus_admission.get("human_adjudication_report") != "approved" or corpus_admission.get("independent_permission_and_privacy_audit") != "approved":
        blockers.append("Human adjudication and independent permission/privacy audit are pending")
    if corpus_admission.get("held_out_threshold_tuning") != "prohibited":
        errors.append("held-out threshold tuning must be prohibited")

    comparison = policy.get("comparison")
    required_arms = {"deterministic_only", "active_jev_assisted", "pinned_generative_baseline"}
    if not isinstance(comparison, dict):
        errors.append("comparison plan must define deterministic, JEV-assisted, and pinned generative arms")
    else:
        arms = comparison.get("arms")
        if not isinstance(arms, list) or {row.get("id") for row in arms if isinstance(row, dict)} != required_arms:
            errors.append("comparison plan must include all three required arms exactly once")
        elif any(not row.get("revision_pin") for row in arms):
            blockers.append("Comparison arm revisions are not pinned")
        if comparison.get("same_input_identity_required") is not True or comparison.get("same_budget_limits_required") is not True:
            errors.append("comparison arms must use identical input identities and configured budgets")
        workload_value = comparison.get("workload", {})
        workload = workload_value if isinstance(workload_value, dict) else {}
        if workload.get("seeds", comparison.get("seeds")) != 3 or workload.get("max_source_pages", 12) != 12 or workload.get("max_passages", 20) != 20 or workload.get("correction_allowance", 1) != 1 or workload.get("cold_and_warm_cache_reported_separately") is not True:
            errors.append("comparison workload must retain the predeclared 3-seed, 12-page, 20-passage, 1-correction cold/warm plan")
        if comparison.get("status") != "completed" or not comparison.get("baseline_results") or not comparison.get("runs"):
            blockers.append("No comparable baseline results or run evidence exist")
        reevaluation = comparison.get("reevaluation_policy", {})
        if not isinstance(reevaluation, dict) or reevaluation.get("required") is not True or reevaluation.get("triggers") != REQUIRED_REEVALUATION_TRIGGERS or reevaluation.get("moving_model_alias_allowed") is not False or reevaluation.get("held_out_tuning_allowed") is not False:
            errors.append("every pinned policy, question, schema, model, baseline, dependency, runtime, or budget change must require a fresh comparison")
        elif not isinstance(reevaluation.get("on_any_pinned_change"), str) or not reevaluation["on_any_pinned_change"].strip():
            errors.append("reevaluation policy must define the response to a pinned change")
        plan_value = comparison.get("bounded_run_plan")
        plan = plan_value if isinstance(plan_value, dict) else {}
        if not plan:
            errors.append("comparison.bounded_run_plan must define coherent per-arm ceilings")
        else:
            held_cases = plan.get("held_out_cases_per_seed")
            seeds = plan.get("seeds")
            jev_value = plan.get("jev", {})
            jev = jev_value if isinstance(jev_value, dict) else {}
            stage_value = jev.get("stage_graph", [])
            stages = stage_value if isinstance(stage_value, list) else []
            stage_one = [
                "Q-EI-SOURCE-TYPE:v1", "Q-EI-RELEVANCE:v1", "Q-EI-INJECTION:v1",
                "Q-EI-IDENTITY:v1", "Q-EI-BRAND-ROLE:v1",
            ]
            stage_two = ["Q-EI-FACT-SUPPORT:v1", "Q-EI-CONFLICT:v1"]
            if held_cases != 240 or seeds != 3 or comparison.get("seeds") != 3:
                errors.append("bounded comparison must retain 240 held-out cases per seed and three seeds")
            valid_stages = len(stages) == 2 and all(isinstance(stage, dict) for stage in stages)
            if not valid_stages or stages[0].get("stage") != 1 or stages[0].get("questions") != stage_one or stages[1].get("stage") != 2 or stages[1].get("questions") != stage_two:
                errors.append("JEV stages must keep independent identity/source questions in stage one and dependent fact/conflict questions in stage two")
            if jev.get("only_independent_questions_share_a_batch") is not True or jev.get("dependent_questions_use_a_later_stage") is not True:
                errors.append("JEV batches may share only independent questions; dependent questions require a later stage")
            per_case_seed = held_cases * seeds if isinstance(held_cases, int) and isinstance(seeds, int) else 0
            attempts_per_case = plan.get("max_attempts_per_case_arm_seed_including_one_retry")
            arm_count = len(comparison.get("arms", [])) if isinstance(comparison.get("arms"), list) else 0
            total_case_executions = per_case_seed * arm_count
            if plan.get("maximum_case_arm_seed_executions") != total_case_executions:
                errors.append("comparison case-arm-seed execution count does not match cases, seeds, and required arms")
            if not isinstance(attempts_per_case, int) or isinstance(attempts_per_case, bool) or attempts_per_case != 2:
                errors.append("each comparison case-arm-seed execution must cap at one retry")
            elif plan.get("maximum_end_to_end_attempts_total_including_retries") != total_case_executions * attempts_per_case:
                errors.append("comparison end-to-end attempt ceiling does not include the single retry")

            stage_count = len(stages)
            jev_initial_batches = per_case_seed * stage_count
            retry_limit = jev.get("max_retries_per_case_seed_across_all_stages")
            if not isinstance(retry_limit, int) or isinstance(retry_limit, bool) or retry_limit != 1:
                errors.append("JEV must allow at most one retry per case-seed across all stages")
                retry_limit = 0
            jev_retries = per_case_seed * retry_limit
            jev_attempts = jev_initial_batches + jev_retries
            max_input = jev.get("max_input_tokens_per_batch")
            max_output = jev.get("max_output_tokens_per_batch")
            for field, expected in (
                ("maximum_stages_per_case", stage_count),
                ("maximum_initial_batches_per_seed", held_cases * stage_count if isinstance(held_cases, int) else 0),
                ("maximum_initial_batches_total", jev_initial_batches),
                ("maximum_billable_attempts_total_including_retries", jev_attempts),
                ("maximum_input_tokens_total_including_retries", jev_attempts * max_input if isinstance(max_input, int) else 0),
                ("maximum_output_tokens_total_including_retries", jev_attempts * max_output if isinstance(max_output, int) else 0),
            ):
                if jev.get(field) != expected:
                    errors.append(f"JEV {field} is inconsistent with staged batch and retry ceilings")
            if any(not isinstance(value, int) or isinstance(value, bool) or value <= 0 for value in (max_input, max_output)):
                errors.append("JEV input and output token ceilings must be positive integers per batch")

            candidates = policy.get("provider_candidates", {})
            candidates = candidates if isinstance(candidates, dict) else {}
            jev_candidate = candidates.get("jev", {})
            jev_candidate = jev_candidate if isinstance(jev_candidate, dict) else {}
            input_rate = jev_candidate.get("published_input_rate_usd_per_million_tokens")
            output_rate = jev_candidate.get("published_output_rate_usd_per_million_tokens")
            if not _is_number(input_rate) or not _is_number(output_rate):
                errors.append("JEV published candidate token rates must be finite numbers")
            if (jev_candidate.get("model_id_candidate") != "jev-1.13.0"
                    or jev_candidate.get("endpoint_candidate") != "https://api.typesafe.ai/v1/systemone"
                    or jev_candidate.get("source") != "https://docs.typesafe.ai/models"
                    or jev_candidate.get("official_documentation_inspected_on") != "2026-10-10"
                    or input_rate != 0.042 or output_rate != 0.0):
                errors.append("JEV candidate identity and published rates must match the dated official documentation record")
            elif isinstance(max_input, int) and isinstance(max_output, int):
                calculated_input_cost = jev_attempts * max_input * input_rate / 1_000_000
                calculated_output_cost = jev_attempts * max_output * output_rate / 1_000_000
                if not _is_number(jev.get("published_input_cost_ceiling_usd_at_candidate_rate")) or not math.isclose(jev["published_input_cost_ceiling_usd_at_candidate_rate"], calculated_input_cost, rel_tol=1e-12, abs_tol=1e-12):
                    errors.append("JEV published input cost ceiling does not match the staged token and batch rate calculation")
                if not _is_number(jev.get("published_output_cost_ceiling_usd")) or not math.isclose(jev["published_output_cost_ceiling_usd"], calculated_output_cost, rel_tol=1e-12, abs_tol=1e-12):
                    errors.append("JEV published output cost ceiling does not match the staged token and batch rate calculation")
            if jev_candidate.get("account_access") != "verified" or jev_candidate.get("invoice_rate_card_and_eligibility") != "verified":
                blockers.append("JEV account access and invoice/rate-card eligibility remain unverified")
            for candidate_key in ("generative_baseline", "vision_baseline_for_brand_role"):
                candidate = candidates.get(candidate_key, {})
                candidate = candidate if isinstance(candidate, dict) else {}
                if candidate.get("cost_status") != "unknown_not_zero":
                    errors.append(f"{candidate_key} pricing status must remain unknown_not_zero until reviewed")
                if candidate.get("input_rate_usd_per_million_tokens") is not None or candidate.get("output_rate_usd_per_million_tokens") is not None or candidate.get("image_input_rate") is not None or candidate.get("input_output_token_rates") is not None:
                    errors.append(f"{candidate_key} unknown rates must remain null rather than a zero-price assumption")

            for model_key in ("generative_baseline", "vision_baseline_for_brand_role"):
                arm_value = plan.get(model_key, {})
                arm = arm_value if isinstance(arm_value, dict) else {}
                maximum_attempts = arm.get("maximum_billable_attempts_total_including_retries")
                expected_attempts = per_case_seed * 2
                if maximum_attempts != expected_attempts:
                    errors.append(f"{model_key} attempt ceiling must cover one attempt plus one retry per case and seed")
                if model_key == "generative_baseline":
                    for field in ("max_input_tokens_per_case_attempt", "max_output_tokens_per_case_attempt"):
                        if not isinstance(arm.get(field), int) or isinstance(arm.get(field), bool) or arm[field] <= 0:
                            errors.append(f"generative baseline {field} must be a positive integer")
                    if arm.get("maximum_input_tokens_total_including_retries") != maximum_attempts * arm.get("max_input_tokens_per_case_attempt", 0) or arm.get("maximum_output_tokens_total_including_retries") != maximum_attempts * arm.get("max_output_tokens_per_case_attempt", 0):
                        errors.append("generative baseline token totals do not match attempts and per-attempt ceilings")
                    if arm.get("published_cost_ceiling_usd") is not None or arm.get("unknown_cost_is_not_zero") is not True or arm.get("cost_blocks_execution_until_provider_model_and_rate_card_are_reviewed") is not True:
                        errors.append("generative baseline unknown pricing must remain null and block execution")
                else:
                    if not isinstance(arm.get("max_images_per_case_attempt"), int) or isinstance(arm.get("max_images_per_case_attempt"), bool) or arm["max_images_per_case_attempt"] <= 0:
                        errors.append("vision baseline image-input ceiling must be a positive integer")
                    if arm.get("maximum_image_inputs_total_including_retries") != maximum_attempts * arm.get("max_images_per_case_attempt", 0):
                        errors.append("vision baseline image-input total does not match attempts and per-attempt ceiling")
                    if not isinstance(arm.get("max_output_tokens_per_case_attempt"), int) or isinstance(arm.get("max_output_tokens_per_case_attempt"), bool) or arm.get("maximum_output_tokens_total_including_retries") != maximum_attempts * arm.get("max_output_tokens_per_case_attempt", 0):
                        errors.append("vision baseline output-token total does not match attempts and per-attempt ceiling")
                    if arm.get("unknown_cost_is_not_zero") is not True or arm.get("published_cost_ceiling_usd") is not None:
                        errors.append("unknown vision pricing must remain null and block execution")
            deterministic_arm = plan.get("deterministic_only", {})
            deterministic_arm = deterministic_arm if isinstance(deterministic_arm, dict) else {}
            deterministic_executions = per_case_seed
            if deterministic_arm.get("maximum_case_arm_seed_executions") != deterministic_executions or deterministic_arm.get("model_input_tokens") != 0 or deterministic_arm.get("model_output_tokens") != 0:
                errors.append("deterministic arm must retain its case-seed and zero model-token ceilings")
            deterministic_attempts = deterministic_arm.get("max_attempts_per_case_arm_seed_including_one_retry")
            if not isinstance(deterministic_attempts, int) or isinstance(deterministic_attempts, bool) or deterministic_attempts != 2 or deterministic_arm.get("maximum_end_to_end_attempts_total_including_retries") != deterministic_executions * deterministic_attempts:
                errors.append("deterministic arm attempt ceiling must include at most one retry")
            proposed_case_cap = cap_record.get("amount")
            required_total_cap = total_case_executions * proposed_case_cap if _is_number(proposed_case_cap) else None
            if not _is_number(comparison_cap_record.get("amount")) or required_total_cap is None or not math.isclose(comparison_cap_record["amount"], required_total_cap, rel_tol=1e-12, abs_tol=1e-12):
                errors.append("total comparison cap must equal required arms times held-out cases times seeds times per-case all-in cap")
            vision_arm = plan.get("vision_baseline_for_brand_role", {})
            vision_arm = vision_arm if isinstance(vision_arm, dict) else {}
            if not math.isclose(vision_arm.get("additional_candidate_all_in_cap_usd_if_approved", -1), per_case_seed * proposed_case_cap if _is_number(proposed_case_cap) else -1, rel_tol=1e-12, abs_tol=1e-12):
                errors.append("optional fourth vision-arm cap must be separate and equal one arm's per-case cap total")

    deterministic_value = policy.get("deterministic_security_gate", {})
    deterministic = deterministic_value if isinstance(deterministic_value, dict) else {}
    if deterministic.get("required") is not True or deterministic.get("unauthorized_capability_count_max") != 0 or deterministic.get("scope_expansion_count_max") != 0 or deterministic.get("metric_score_can_override") is not False:
        errors.append("deterministic security gate must require zero unauthorized capability/scope expansion and cannot be overridden by a metric")
    if deterministic.get("status") != "passed":
        blockers.append("Deterministic application security checks are pending")

    evidence_value = policy.get("evidence_classification", {})
    evidence = evidence_value if isinstance(evidence_value, dict) else {}
    required_evidence_labels = {"synthetic", "recorded", "sandbox", "live", "estimated", "pending"}
    if set(evidence.get("required_labels", [])) != required_evidence_labels or evidence.get("synthetic_fixtures_satisfy_live_criteria") is not False:
        errors.append("evidence classification must distinguish synthetic, recorded, sandbox, live, estimated, and pending")
    if evidence.get("EVAL-03_review") != "approved":
        blockers.append("EVAL-03 evidence-label presentation review by Product and frontend is pending")
    privacy_value = policy.get("secret_and_customer_data_review", {})
    privacy = privacy_value if isinstance(privacy_value, dict) else {}
    if privacy.get("EVAL-04_status") != "approved" or privacy.get("independent_published_evidence_review") != "approved":
        blockers.append("EVAL-04 published evidence review by Finance and reliability is pending")

    listed_blockers = policy.get("promotion_blockers")
    if not isinstance(listed_blockers, list) or not listed_blockers:
        errors.append("promotion_blockers must explain outstanding owner decisions and evidence")
    for reason in (
        "Policy targets and tradeoff require Agent and research plus Finance and reliability approval.",
        "Human-adjudicated corpus and independent permission/privacy audit are unavailable; current corpus is synthetic fixtures only.",
    ):
        if reason not in (listed_blockers or []):
            errors.append(f"promotion_blockers must retain: {reason}")

    return {"question_count": len(question_by_id), "question_ids": ids}


def validate_corpus(manifest_path: Path, manifest: dict[str, Any], policy: dict[str, Any], errors: list[str], blockers: list[str]) -> dict[str, Any]:
    root = manifest_path.parent.resolve()
    artifacts = manifest.get("artifacts")
    required_artifacts = ("authored_cases", "observations", "labels", "split_lock")
    if not isinstance(artifacts, dict):
        errors.append("manifest.artifacts must index authored_cases, observations, labels, and split_lock")
        artifacts = {}
    artifact_entries = {
        name: artifacts.get(name) if isinstance(artifacts.get(name), dict) else {}
        for name in ("authored_cases", "observations", "labels", "split_lock")
    }
    loaded: dict[str, Any] = {}
    raw_files: dict[str, bytes] = {}
    for name in required_artifacts:
        entry = artifact_entries[name]
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str) or not entry.get("sha256"):
            errors.append(f"manifest.artifacts.{name} must provide a relative path and SHA-256")
            continue
        relative = Path(entry["path"])
        if relative.is_absolute():
            errors.append(f"manifest.artifacts.{name}: absolute paths are forbidden")
            continue
        file_path = (root / relative).resolve()
        if root not in file_path.parents:
            errors.append(f"manifest.artifacts.{name}: path must remain inside the corpus directory")
            continue
        try:
            raw_files[name] = file_path.read_bytes()
        except OSError as exc:
            errors.append(f"manifest.artifacts.{name}: cannot read ({exc})")
            continue
        if sha256(raw_files[name]) != entry["sha256"]:
            errors.append(f"manifest.artifacts.{name}: SHA-256 mismatch")
        if name in ("authored_cases", "observations", "labels"):
            loaded[name] = read_jsonl(file_path, errors, name)
        else:
            loaded[name] = read_json(file_path, errors, name)

    authored = loaded.get("authored_cases", [])
    observations = loaded.get("observations", [])
    labels = loaded.get("labels", [])
    lock = loaded.get("split_lock") or {}
    if manifest.get("dataset_mode") != "synthetic_smoke_fixture_only" or manifest.get("benchmark_eligible") is not False:
        errors.append("corpus must be marked synthetic_smoke_fixture_only and benchmark_eligible=false")
    if manifest.get("manifest_version") != "1.0.0":
        errors.append("unsupported manifest schema version; expected 1.0.0 and an owner-reviewed migration with matching fixtures")
    if lock.get("lock_version") != "1.0.0":
        errors.append("unsupported split-lock schema version; expected 1.0.0 and an owner-reviewed migration with matching fixtures")
    version_pins_value = policy.get("version_pins", {})
    version_pins = version_pins_value if isinstance(version_pins_value, dict) else {}
    if manifest.get("corpus_version") != lock.get("corpus_version") or manifest.get("corpus_version") != version_pins.get("corpus"):
        errors.append("policy, manifest, and split lock corpus versions must match")
    if manifest.get("label_provenance") != LABEL_PROVENANCE:
        errors.append("manifest must distinguish author-authored expectations from independent adjudication")
    if manifest.get("lineage_review") != "case_scoped_fixture_ids_only_no_real_world_independence_claim; independent family audit unavailable":
        errors.append("manifest must disclaim real-world family independence and record the pending family audit")
    notice = manifest.get("notice", "")
    if not isinstance(notice, str) or "do not measure real-world quality" not in notice or "not independently adjudicated" not in notice:
        errors.append("manifest notice must state that expectations are unadjudicated and fixtures do not measure real-world quality")

    admission_value = manifest.get("admission", {})
    admission = admission_value if isinstance(admission_value, dict) else {}
    if not isinstance(admission_value, dict):
        errors.append("manifest.admission must be an object")
    if admission.get("external_sources") != 0 or admission.get("customer_records") != 0 or admission.get("image_or_asset_bytes") != 0:
        errors.append("smoke fixtures must contain no external sources, customer records, or asset bytes")
    if admission.get("personal_data") != "none_by_construction":
        errors.append("corpus privacy classification must state no personal data by construction")
    if admission.get("permission_review") != "synthetic_text_only_no_external_asset; independent_owner_audit_pending":
        errors.append("permission review must distinguish fixture screening from the pending owner audit")
    if admission.get("label_adjudication") != LABEL_PROVENANCE:
        errors.append("label provenance cannot claim programmatic oracle or human adjudication")
    if admission.get("family_independence") != "not_established; case-scoped synthetic IDs only":
        errors.append("manifest must state that case-scoped IDs do not establish independent families")
    if admission.get("reviewer") is None:
        blockers.append("Named corpus reviewer is unassigned")
    if manifest.get("dataset_mode") == "synthetic_smoke_fixture_only":
        blockers.append("Current corpus is synthetic smoke fixtures only; it is not human-adjudicated benchmark evidence")
        blockers.append("Independent corpus permission, privacy, and family-lineage audits are pending")

    policy_admission_value = policy.get("corpus_admission", {})
    policy_admission = policy_admission_value if isinstance(policy_admission_value, dict) else {}
    policy_minimums = policy_admission.get("required_minimums")
    manifest_minimums = manifest.get("minimums")
    if policy_minimums != REQUIRED_CORPUS_MINIMUMS or manifest_minimums != REQUIRED_CORPUS_MINIMUMS:
        errors.append("policy and manifest must retain the required corpus minimums")

    if lock.get("locked") is not True or lock.get("threshold_selection_split") != "calibration":
        errors.append("split lock must be locked and permit threshold selection only on calibration")
    if lock.get("source_cases_sha256") != artifact_entries["authored_cases"].get("sha256"):
        errors.append("split lock must pin the exact authored fixture source bytes")
    if lock.get("observations_sha256") != artifact_entries["observations"].get("sha256") or lock.get("labels_sha256") != artifact_entries["labels"].get("sha256"):
        errors.append("split lock must pin the exact observations and labels bytes")
    manifest_lock_value = manifest.get("split_lock", {})
    manifest_lock = manifest_lock_value if isinstance(manifest_lock_value, dict) else {}
    if manifest_lock.get("path") != artifact_entries["split_lock"].get("path") or manifest_lock.get("lock_version") != lock.get("lock_version"):
        errors.append("manifest split-lock path or version differs from split-lock artifact")

    question_rows = policy.get("required_questions", [])
    question_rows = question_rows if isinstance(question_rows, list) else []
    q_records = {q.get("id"): q for q in question_rows if isinstance(q, dict)}
    required_ids = list(REQUIRED_QUESTIONS)
    allowed_case_fields = {
        "case_id", "split", "scenario_family", "language", "fictional_event_name",
        "source_type_observation", "content", "asset_description", "untrusted_excerpt", "labels",
    }
    authored_by_id: dict[str, dict[str, Any]] = {}
    expected_observations: dict[str, dict[str, Any]] = {}
    expected_labels: dict[str, dict[str, Any]] = {}
    expected_assignments: list[dict[str, Any]] = []
    for case in authored:
        case_id = case.get("case_id")
        if not isinstance(case_id, str) or not case_id:
            errors.append("authored fixture row has no case_id")
            continue
        if case_id in authored_by_id:
            errors.append(f"duplicate authored fixture case_id: {case_id}")
            continue
        authored_by_id[case_id] = case
        if set(case) != allowed_case_fields:
            errors.append(f"{case_id}: authored case fields differ from the permitted fixture schema")
        split = case.get("split")
        family = case.get("scenario_family")
        if split not in ("calibration", "held_out"):
            errors.append(f"{case_id}: split must be calibration or held_out")
        if family not in REQUIRED_FAMILIES:
            errors.append(f"{case_id}: unknown required scenario family")
        labels_value = case.get("labels")
        if not isinstance(labels_value, dict) or set(labels_value) != set(required_ids):
            errors.append(f"{case_id}: author labels must include exactly all seven versioned questions")
            labels_value = labels_value if isinstance(labels_value, dict) else {}
        for field in ("language", "fictional_event_name", "source_type_observation", "content", "asset_description"):
            if not isinstance(case.get(field), str) or not case[field].strip():
                errors.append(f"{case_id}: authored {field} must be nonempty text")
        if "untrusted_excerpt" not in case or (case.get("untrusted_excerpt") is not None and not isinstance(case.get("untrusted_excerpt"), str)):
            errors.append(f"{case_id}: untrusted_excerpt must be text or null")
        observation = {
            "case_id": case_id,
            "split": split,
            "scenario_family": family,
            "source_family_id": f"authored-case:{case_id}:source",
            "event_family_id": f"authored-case:{case_id}:event",
            "template_family_id": f"authored-case:{case_id}:template",
            "lineage_scope": LINEAGE_SCOPE,
            "language": case.get("language"),
            "fictional_event_name": case.get("fictional_event_name"),
            "source_type_observation": case.get("source_type_observation"),
            "content": case.get("content"),
            "asset_description": case.get("asset_description"),
            "untrusted_excerpt": case.get("untrusted_excerpt"),
            "fixture_only": True,
            "privacy_classification": "synthetic_no_personal_data",
            "permission_classification": "synthetic_original_text_no_external_asset",
            "asset_rights_status": "synthetic_text_only_no_reproduction_rights_claimed",
            "adjudication_status": LABEL_PROVENANCE,
            "evidence_ref": f"fixture://synthetic-smoke/{case_id}",
        }
        expected_observations[case_id] = observation
        expected_labels[case_id] = {"case_id": case_id, "labels": {qid: labels_value.get(qid) for qid in required_ids}}
        expected_assignments.append({
            "case_id": case_id, "split": split, "scenario_family": family,
            "source_family_id": observation["source_family_id"],
            "event_family_id": observation["event_family_id"],
            "template_family_id": observation["template_family_id"],
        })

    def rows_by_id(rows: list[dict[str, Any]], kind: str) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            case_id = row.get("case_id")
            if not isinstance(case_id, str) or not case_id:
                errors.append(f"{kind} row has no case_id")
            elif case_id in result:
                errors.append(f"duplicate {kind} case_id: {case_id}")
            else:
                result[case_id] = row
        return result

    authored_ids = set(authored_by_id)
    obs_by_id = rows_by_id(observations, "observation")
    labels_by_id = rows_by_id(labels, "label")
    if set(obs_by_id) != authored_ids or set(labels_by_id) != authored_ids:
        errors.append("authored source, observations, and labels must contain exactly the same case IDs")
    for case_id in authored_ids & set(obs_by_id):
        if obs_by_id[case_id] != expected_observations[case_id]:
            errors.append(f"{case_id}: observation differs from the author-authored source projection")
    for case_id in authored_ids & set(labels_by_id):
        if labels_by_id[case_id] != expected_labels[case_id]:
            errors.append(f"{case_id}: label row differs from the author-authored expectation projection")

    assignments = lock.get("case_assignments")
    if not isinstance(assignments, list):
        errors.append("split-lock case_assignments must be a list")
        assignments = []
    assignment_by_id: dict[str, dict[str, Any]] = {}
    for row in assignments:
        if not isinstance(row, dict) or not isinstance(row.get("case_id"), str):
            errors.append("split-lock contains an invalid case assignment")
            continue
        case_id = row["case_id"]
        if case_id in assignment_by_id:
            errors.append(f"duplicate split assignment for {case_id}")
        else:
            assignment_by_id[case_id] = row
    if assignments != expected_assignments:
        errors.append("split-lock assignments must exactly match the case-scoped authored assignments")
    if set(assignment_by_id) != authored_ids:
        errors.append("split assignments and authored case IDs do not match exactly")
    assignment_text = "\n".join(
        "|".join(str(row.get(field, "")) for field in (
            "case_id", "split", "scenario_family", "source_family_id", "event_family_id", "template_family_id",
        )) for row in assignments
    ) + "\n"
    if lock.get("assignment_sha256") != sha256(assignment_text.encode("utf-8")):
        errors.append("split-lock assignment SHA-256 mismatch")
    if manifest_lock.get("assignment_sha256") != lock.get("assignment_sha256"):
        errors.append("manifest split-lock assignment digest differs from split-lock artifact")

    split_counts = Counter(row.get("split") for row in assignment_by_id.values())
    actual_counts = {split: split_counts.get(split, 0) for split in ("calibration", "held_out")}
    if manifest.get("case_counts") != actual_counts or lock.get("split_counts") != actual_counts:
        errors.append("case counts differ between manifest, lock, and authored assignments")
    for split, minimum_key in (("calibration", "calibration_cases"), ("held_out", "held_out_cases")):
        minimum = REQUIRED_CORPUS_MINIMUMS[minimum_key]
        if actual_counts[split] < minimum:
            blockers.append(f"{split} contains {actual_counts[split]} cases; required minimum is {minimum}")

    family_counts: dict[str, Counter[str]] = {"calibration": Counter(), "held_out": Counter()}
    lineage_values: dict[str, dict[str, set[str]]] = {
        "source_family_id": defaultdict(set), "event_family_id": defaultdict(set), "template_family_id": defaultdict(set),
    }
    split_by_case: dict[str, str] = {}
    for case_id, assignment in assignment_by_id.items():
        split = assignment.get("split")
        split_by_case[case_id] = split
        if split in family_counts and isinstance(assignment.get("scenario_family"), str):
            family_counts[split][assignment["scenario_family"]] += 1
        for field in lineage_values:
            value = assignment.get(field)
            if not isinstance(value, str) or not value:
                errors.append(f"{case_id}: missing {field}")
            else:
                lineage_values[field][value].add(str(split))
    for field, groups in lineage_values.items():
        if any(len(splits) > 1 for splits in groups.values()):
            errors.append(f"split leakage: a case-scoped {field} ID appears in both splits")
        if len(groups) != len(authored_ids):
            errors.append(f"{field} must have one unique case-scoped ID per authored fixture")
    for split in ("calibration", "held_out"):
        if set(family_counts[split]) != set(REQUIRED_FAMILIES):
            errors.append(f"{split} smoke fixtures must represent all ten required scenario families")
    expected_family_counts = {
        family: {split: family_counts[split][family] for split in ("calibration", "held_out")}
        for family in REQUIRED_FAMILIES
    }
    if manifest.get("required_scenario_family_counts") != expected_family_counts:
        errors.append("manifest scenario-family counts differ from authored cases")
    for family in REQUIRED_FAMILIES:
        actual = family_counts["held_out"][family]
        minimum = REQUIRED_CORPUS_MINIMUMS["held_out_cases_per_scenario_family"]
        if actual < minimum:
            blockers.append(f"held_out family {family} contains {actual} fixtures; required minimum is {minimum}")

    language_counts: Counter[str] = Counter()
    for case_id, case in authored_by_id.items():
        if split_by_case.get(case_id) == "held_out" and isinstance(case.get("language"), str):
            language = case["language"].split("-")[0].lower()
            if language != "en":
                language_counts[language] += 1
    non_english_count = sum(language_counts.values())
    cjk = any(language in {"ja", "zh", "ko"} for language in language_counts)
    language_data_value = manifest.get("non_english_held_out", {})
    language_data = language_data_value if isinstance(language_data_value, dict) else {}
    if not isinstance(language_data_value, dict):
        errors.append("manifest.non_english_held_out must be an object")
    actual_languages = sorted(language_counts)
    if language_data.get("actual") != non_english_count or language_data.get("languages") != actual_languages or language_data.get("language_counts") != dict(sorted(language_counts.items())) or language_data.get("includes_cjk") is not cjk:
        errors.append("manifest non-English language counts or CJK declaration differ from authored held-out cases")
    if language_data.get("minimum") != REQUIRED_CORPUS_MINIMUMS["held_out_non_english_cases"] or language_data.get("required_language_count") != REQUIRED_CORPUS_MINIMUMS["held_out_non_english_languages"] or language_data.get("requires_cjk") is not True:
        errors.append("manifest must retain non-English count, language, and CJK minima")
    if non_english_count < REQUIRED_CORPUS_MINIMUMS["held_out_non_english_cases"]:
        blockers.append(f"held_out has {non_english_count} non-English fixtures; required minimum is {REQUIRED_CORPUS_MINIMUMS['held_out_non_english_cases']}")
    if len(language_counts) < REQUIRED_CORPUS_MINIMUMS["held_out_non_english_languages"]:
        blockers.append(f"held_out spans {len(language_counts)} non-English languages; required minimum is {REQUIRED_CORPUS_MINIMUMS['held_out_non_english_languages']}")
    if REQUIRED_CORPUS_MINIMUMS["held_out_requires_cjk"] and not cjk:
        blockers.append("held_out requires at least one CJK language")

    content_hashes: dict[str, list[str]] = defaultdict(list)
    for case_id, case in authored_by_id.items():
        if case.get("split") not in ("calibration", "held_out"):
            continue
        text_fields = ("fictional_event_name", "source_type_observation", "content", "asset_description", "untrusted_excerpt")
        combined = " ".join(str(case.get(field) or "") for field in text_fields)
        if EMAIL_RE.search(combined) or _has_phone_number(combined) or WEB_URL_RE.search(combined):
            errors.append(f"{case_id}: possible personal data or external URL detected")
        normalized = " ".join(str(case.get("content", "")).split()).casefold()
        content_hashes[sha256(normalized.encode("utf-8"))].append(case_id)
        observation = obs_by_id.get(case_id, {})
        if observation.get("fixture_only") is not True or observation.get("privacy_classification") != "synthetic_no_personal_data":
            errors.append(f"{case_id}: fixture and synthetic privacy metadata are required")
        if observation.get("permission_classification") != "synthetic_original_text_no_external_asset":
            errors.append(f"{case_id}: permission classification is missing or unsafe")
        if observation.get("asset_rights_status") != "synthetic_text_only_no_reproduction_rights_claimed":
            errors.append(f"{case_id}: asset rights status is missing or unsafe")
        if observation.get("adjudication_status") != LABEL_PROVENANCE or observation.get("lineage_scope") != LINEAGE_SCOPE:
            errors.append(f"{case_id}: observations must disclaim adjudication and real-world lineage")
        if not isinstance(observation.get("evidence_ref"), str) or not observation["evidence_ref"].startswith("fixture://synthetic-smoke/"):
            errors.append(f"{case_id}: evidence_ref must be a synthetic smoke fixture reference")
    duplicates = [case_ids for case_ids in content_hashes.values() if len(case_ids) > 1]
    if duplicates:
        errors.append(f"duplicate normalized observation content appears across {sum(len(case_ids) - 1 for case_ids in duplicates)} fixture case(s)")

    label_summaries: dict[str, dict[str, Any]] = {"calibration": {}, "held_out": {}}
    coverage_gaps: list[str] = []
    for split in ("calibration", "held_out"):
        for qid in REQUIRED_QUESTIONS:
            question = q_records.get(qid, {})
            classes = question.get("classes", [])
            counts: Counter[str] = Counter()
            language_class_counts: dict[str, Counter[str]] = defaultdict(Counter)
            for case_id, label_row in labels_by_id.items():
                if split_by_case.get(case_id) != split:
                    continue
                label_values = label_row.get("labels")
                value = label_values.get(qid) if isinstance(label_values, dict) else None
                if value not in classes:
                    errors.append(f"{case_id}: missing or invalid label for {qid}")
                    continue
                counts[value] += 1
                language = authored_by_id.get(case_id, {}).get("language", "")
                if isinstance(language, str) and language.split("-")[0].lower() != "en":
                    language_class_counts[language.split("-")[0].lower()][value] += 1
            groups = {}
            for group_name in ("positive", "negative", "unknown"):
                class_names = question.get(f"{group_name}_classes", [])
                groups[group_name] = sum(counts[class_name] for class_name in class_names if class_name in classes)
            minimums = question.get("minimum_samples_per_class", {})
            class_minimum = minimums.get(split, 0)
            for class_name in classes:
                if counts[class_name] < class_minimum:
                    coverage_gaps.append(f"{split} {qid}/{class_name}: {counts[class_name]} of {class_minimum} required")
            group_minimum = 10 if split == "calibration" else 20
            for group_name, count in groups.items():
                if count < group_minimum:
                    coverage_gaps.append(f"{split} {qid}/{group_name}: {count} of {group_minimum} required")
            if split == "held_out":
                lang_minimum = minimums.get("non_english_held_out_per_language", 0)
                for language in actual_languages:
                    for class_name in classes:
                        count = language_class_counts[language][class_name]
                        if count < lang_minimum:
                            coverage_gaps.append(f"held_out {qid}/{language}/{class_name}: {count} of {lang_minimum} required")
            label_summaries[split][qid] = {
                "class_counts": dict(sorted(counts.items())),
                "positive_count": groups["positive"],
                "negative_count": groups["negative"],
                "unknown_count": groups["unknown"],
                "denominator_definition": question.get("denominator"),
                "metric_denominators": question.get("metric_definitions", {}),
            }
    for gap in coverage_gaps:
        blockers.append(f"Question-label coverage minimum unmet: {gap}")

    held_usage = lock.get("held_out_usage", {})
    if not isinstance(held_usage, dict):
        errors.append("split lock held_out_usage must be an object")
        held_usage = {}
    runs = held_usage.get("evaluation_runs", [])
    if not isinstance(runs, list):
        errors.append("split lock held_out_usage.evaluation_runs must be a list")
        runs = []
    if held_usage.get("status") == "not_consumed" and runs:
        errors.append("held-out usage is marked not_consumed but contains evaluation runs")
    run_ids: set[str] = set()
    usage_by_case: Counter[str] = Counter()
    for run in runs:
        if not isinstance(run, dict) or not isinstance(run.get("run_id"), str) or not isinstance(run.get("case_ids"), list):
            errors.append("held-out usage run requires run_id and case_ids")
            continue
        if run["run_id"] in run_ids:
            errors.append(f"duplicate held-out evaluation run_id: {run['run_id']}")
        run_ids.add(run["run_id"])
        if len(run["case_ids"]) != len(set(run["case_ids"])):
            errors.append(f"held-out run {run['run_id']} repeats a case within the run")
        for case_id in run["case_ids"]:
            if split_by_case.get(case_id) != "held_out":
                errors.append(f"held-out run {run['run_id']} contains non-held-out case {case_id}")
            usage_by_case[case_id] += 1
    reused = [case_id for case_id, count in usage_by_case.items() if count > 1]
    if reused:
        errors.append(f"held-out reuse detected for {len(reused)} case(s): {', '.join(sorted(reused)[:5])}")
    if runs and held_usage.get("status") != "consumed":
        errors.append("held-out usage status must be consumed when a run is recorded")
    if not runs and held_usage.get("status") != "not_consumed":
        errors.append("empty held-out run log must be marked not_consumed")
    if manifest_lock.get("held_out_consumed") is not bool(runs):
        errors.append("manifest held_out_consumed flag differs from usage ledger")
    if runs:
        blockers.append("Held-out corpus has been opened; confirm frozen configuration and no threshold tuning before promotion")

    actual_summary = {
        "case_counts": {
            "required_minimum": {"calibration": REQUIRED_CORPUS_MINIMUMS["calibration_cases"], "held_out": REQUIRED_CORPUS_MINIMUMS["held_out_cases"]},
            "actual": actual_counts,
        },
        "held_out_scenario_families": {
            family: {
                "required_minimum": REQUIRED_CORPUS_MINIMUMS["held_out_cases_per_scenario_family"],
                "actual": family_counts["held_out"][family],
            }
            for family in REQUIRED_FAMILIES
        },
        "non_english_held_out": {
            "required_minimum": REQUIRED_CORPUS_MINIMUMS["held_out_non_english_cases"],
            "actual": non_english_count,
            "required_language_count": REQUIRED_CORPUS_MINIMUMS["held_out_non_english_languages"],
            "language_counts": dict(sorted(language_counts.items())),
            "includes_cjk": cjk,
        },
        "lineage_status": "case_scoped_fixture_ids_only_no_real_world_independence_claim",
        "question_count": len(q_records),
        "question_label_coverage": label_summaries,
        "question_coverage_gaps": coverage_gaps,
        "held_out_consumed": bool(runs),
        "held_out_reuse_count": len(reused),
    }
    return actual_summary

def validate(policy_path: Path, manifest_path: Path) -> dict[str, Any]:
    errors: list[str] = []
    blockers: list[str] = []
    policy = read_json(policy_path, errors, "policy") or {}
    manifest = read_json(manifest_path, errors, "manifest") or {}
    policy_summary = validate_policy(policy, errors, blockers)
    corpus_summary = validate_corpus(manifest_path, manifest, policy, errors, blockers)
    # Preserve stable order while avoiding repeated reasons from shared subchecks.
    errors = list(dict.fromkeys(errors))
    blockers = list(dict.fromkeys(blockers))
    return {
        "checker_version": "1.0.0",
        "policy_id": policy.get("policy_id"),
        "policy_version": policy.get("policy_version"),
        "corpus_version": manifest.get("corpus_version"),
        "dataset_mode": manifest.get("dataset_mode"),
        "status": "invalid" if errors else ("blocked" if blockers else "promotion_ready"),
        "promotion_eligible": not errors and not blockers,
        "expected_vs_actual": corpus_summary,
        "policy_questions": policy_summary,
        "errors": errors,
        "promotion_blockers": blockers,
        "evidence_status": {
            "provider_calls": 0,
            "paid_calls": 0,
            "comparative_results": "pending",
            "live_qualification": "not_established",
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, required=True, help="path to corpus manifest.json")
    parser.add_argument("--validate-only", action="store_true", help="return zero for structurally valid artifacts even if promotion blockers remain")
    args = parser.parse_args(argv)
    report = validate(args.policy, args.corpus)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    if report["errors"]:
        return 1
    if report["promotion_blockers"] and not args.validate_only:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
