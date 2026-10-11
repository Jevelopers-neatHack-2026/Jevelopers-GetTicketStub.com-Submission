#!/usr/bin/env python3
"""Project bounded synthetic normalized-result JSONL into a descriptive report.

This tool has no promotion, JEV, provider, or live-evaluation path.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections import Counter, defaultdict
from decimal import Decimal, DecimalException
from pathlib import Path
from typing import Any


CONTRACT = "ei.offline.normalized-results"
SCHEMA_VERSION = "1.0.0"
REPORT_VERSION = "1.0.0"
SOURCE_MODE = "synthetic_fixture_only"
REQUIRED_SPLITS = ("calibration", "held_out")
REQUIRED_QUESTION_IDS = (
    "Q-EI-SOURCE-TYPE:v1",
    "Q-EI-RELEVANCE:v1",
    "Q-EI-INJECTION:v1",
    "Q-EI-IDENTITY:v1",
    "Q-EI-FACT-SUPPORT:v1",
    "Q-EI-CONFLICT:v1",
    "Q-EI-BRAND-ROLE:v1",
)
PIN_NAMES = (
    "policy",
    "corpus",
    "question_registry",
    "result_schema",
    "adapter",
    "model",
    "baseline",
    "runtime",
)
OWNER_CLAIM_NAMES = ("agent_research", "finance_reliability", "product_frontend")
CALLER_CLAIM_NAMES = ("promotion_approved", "live_acceptance", "provider_run_completed")
HEADER_KEYS = {
    "contract", "schema_version", "source_mode", "dataset_id", "grouping",
    "required_question_ids", "expected_splits", "expected_arms", "expected_seeds",
    "expected_cases", "denominators", "percentile_spec", "expected_pins",
    "corpus_status", "target_status", "mapping_claims", "owner_approval_claims",
    "caller_claims",
}
OBSERVATION_KEYS = {
    "case_id", "family_id", "split", "arm", "seed", "question_id", "truth",
    "prediction", "evidence_mode", "latency_ms", "latency_phase", "usage_state",
    "usage_attempts", "observed_pins",
}
IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
QUESTION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")
LABEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
PIN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_LINE_BYTES = 64 * 1024
MAX_INPUT_ROWS = 10_000
MAX_EXPECTED_OBSERVATIONS = 10_000
MAX_EXPECTED_CASES = 2_000
MAX_ARMS = 8
MAX_SEEDS = 16
MAX_ATTEMPTS_PER_OBSERVATION = 64
MAX_REPORT_BYTES = 8 * 1024 * 1024
MAX_INT_DIGITS = 19
MAX_DECIMAL_LITERAL_CHARS = 64
MAX_DECIMAL_VALUE = Decimal("1000000000")
MAX_DECIMAL_SCALE = 6
MAX_COST_MINOR = 9_223_372_036_854_775_807


class InputProblem(Exception):
    """An input failure represented only by a fixed safe code and line number."""

    def __init__(self, code: str, line: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.line = line


def _parse_int_literal(value: str) -> int:
    digits = value[1:] if value.startswith("-") else value
    if len(digits) > MAX_INT_DIGITS:
        raise InputProblem("integer_literal_too_long")
    return int(value)


def _parse_decimal_literal(value: str) -> Decimal:
    if len(value) > MAX_DECIMAL_LITERAL_CHARS:
        raise InputProblem("decimal_literal_too_long")
    try:
        parsed = Decimal(value)
    except DecimalException as exc:
        raise InputProblem("invalid_decimal_literal") from exc
    if not parsed.is_finite():
        raise InputProblem("non_finite_number")
    exponent = parsed.as_tuple().exponent
    # Check the exponent first. Decimal's built-in abs can apply the active
    # context and overflow on a tiny literal such as 1e999999999.
    if exponent < -MAX_DECIMAL_SCALE or exponent > 9:
        raise InputProblem("decimal_literal_out_of_bounds")
    if parsed.copy_abs() > MAX_DECIMAL_VALUE:
        raise InputProblem("decimal_literal_out_of_bounds")
    return parsed


def _reject_constant(_: str) -> None:
    raise InputProblem("non_finite_number")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InputProblem("duplicate_json_key")
        result[key] = value
    return result


def _json_object(line_bytes: bytes, line_number: int) -> dict[str, Any]:
    if len(line_bytes) > MAX_LINE_BYTES:
        raise InputProblem("line_too_large", line_number)
    try:
        line = line_bytes.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise InputProblem("invalid_utf8", line_number) from exc
    if not line.strip():
        raise InputProblem("blank_jsonl_line", line_number)
    try:
        value = json.loads(
            line,
            object_pairs_hook=_reject_duplicate_keys,
            parse_int=_parse_int_literal,
            parse_float=_parse_decimal_literal,
            parse_constant=_reject_constant,
        )
    except InputProblem as exc:
        if exc.line is None:
            raise InputProblem(exc.code, line_number) from exc
        raise
    except (json.JSONDecodeError, RecursionError, ValueError, OverflowError) as exc:
        raise InputProblem("invalid_json", line_number) from exc
    if not isinstance(value, dict):
        raise InputProblem("row_must_be_object", line_number)
    return value


def _read_jsonl(data: bytes) -> tuple[dict[str, Any], list[tuple[int, dict[str, Any]]]]:
    if len(data) > MAX_INPUT_BYTES:
        raise InputProblem("input_too_large")
    raw_lines = data.splitlines()
    if not raw_lines:
        raise InputProblem("empty_input")
    if len(raw_lines) > MAX_INPUT_ROWS + 1:
        raise InputProblem("too_many_rows")
    header = _json_object(raw_lines[0], 1)
    rows: list[tuple[int, dict[str, Any]]] = []
    for line_number, raw_line in enumerate(raw_lines[1:], start=2):
        rows.append((line_number, _json_object(raw_line, line_number)))
    return header, rows


def _check_keys(
    value: dict[str, Any],
    allowed: set[str],
    required: set[str],
    line: int,
) -> None:
    if not required.issubset(value) or not set(value).issubset(allowed):
        raise InputProblem("invalid_object_shape", line)


def _is_int(value: Any) -> bool:
    return type(value) is int


def _bounded_int(value: Any, *, maximum: int, minimum: int = 0) -> bool:
    return _is_int(value) and minimum <= value <= maximum


def _identifier(value: Any, pattern: re.Pattern[str] = IDENTIFIER_RE) -> bool:
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _safe_decimal(value: Any, *, maximum: Decimal = MAX_DECIMAL_VALUE) -> Decimal | None:
    if type(value) is int:
        parsed = Decimal(value)
    elif isinstance(value, Decimal):
        parsed = value
    else:
        return None
    if not parsed.is_finite() or parsed < 0 or parsed > maximum:
        return None
    if parsed.as_tuple().exponent < -MAX_DECIMAL_SCALE:
        return None
    return parsed


def _decimal_text(value: Decimal) -> str:
    normalized = value.normalize()
    if normalized == 0:
        return "0"
    return format(normalized, "f")


def _group_key(split: str, arm: str, seed: int, question_id: str) -> tuple[str, str, int, str]:
    return (split, arm, seed, question_id)


def _group_record(
    split: str,
    arm: str,
    seed: int,
    question_id: str,
    index: int,
) -> dict[str, Any]:
    return {
        "group_index": index,
        "split": split,
        "arm": arm,
        "seed": seed,
        "question_id": question_id,
    }


def _add_diagnostic(
    diagnostics: list[dict[str, Any]],
    code: str,
    *,
    line: int | None = None,
    group_index: int | None = None,
    count: int | None = None,
    pin_name: str | None = None,
) -> None:
    item: dict[str, Any] = {"code": code}
    if line is not None:
        item["line"] = line
    if group_index is not None:
        item["group_index"] = group_index
    if count is not None:
        item["count"] = count
    if pin_name is not None:
        item["pin_name"] = pin_name
    diagnostics.append(item)


def _parse_header(
    header: dict[str, Any],
    diagnostics: list[dict[str, Any]],
) -> dict[str, Any]:
    _check_keys(
        header,
        HEADER_KEYS,
        {
            "contract", "schema_version", "source_mode", "dataset_id", "grouping",
            "required_question_ids", "expected_splits", "expected_arms", "expected_seeds",
            "expected_cases",
        },
        1,
    )
    if header["contract"] != CONTRACT:
        raise InputProblem("unsupported_contract", 1)
    schema_version = header["schema_version"]
    if not isinstance(schema_version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", schema_version):
        raise InputProblem("invalid_schema_version", 1)
    if schema_version.split(".", 1)[0] != "1":
        raise InputProblem("unsupported_schema_major", 1)
    if schema_version != SCHEMA_VERSION:
        raise InputProblem("unsupported_schema_version", 1)
    if header["source_mode"] != SOURCE_MODE:
        raise InputProblem("non_synthetic_source_mode", 1)
    if not _identifier(header["dataset_id"]):
        raise InputProblem("invalid_dataset_id", 1)
    if header["grouping"] != ["split", "arm", "seed", "question_id"]:
        raise InputProblem("unsupported_grouping", 1)

    raw_questions = header["required_question_ids"]
    if not isinstance(raw_questions, list) or any(not _identifier(q, QUESTION_RE) for q in raw_questions):
        raise InputProblem("invalid_question_inventory", 1)
    if len(raw_questions) != len(set(raw_questions)):
        raise InputProblem("duplicate_question_inventory", 1)
    for question_id in REQUIRED_QUESTION_IDS:
        if question_id not in raw_questions:
            _add_diagnostic(diagnostics, "required_question_missing")
    for question_id in raw_questions:
        if question_id not in REQUIRED_QUESTION_IDS:
            _add_diagnostic(diagnostics, "unsupported_question_declared")

    raw_splits = header["expected_splits"]
    if (
        not isinstance(raw_splits, list)
        or any(not isinstance(split, str) or split not in REQUIRED_SPLITS for split in raw_splits)
        or len(raw_splits) != len(set(raw_splits))
    ):
        raise InputProblem("invalid_split_inventory", 1)
    for split in REQUIRED_SPLITS:
        if split not in raw_splits:
            _add_diagnostic(diagnostics, "required_split_missing")

    raw_arms = header["expected_arms"]
    if (
        not isinstance(raw_arms, list)
        or not 1 <= len(raw_arms) <= MAX_ARMS
        or any(not _identifier(arm) for arm in raw_arms)
        or len(raw_arms) != len(set(raw_arms))
    ):
        raise InputProblem("invalid_arm_inventory", 1)
    raw_seeds = header["expected_seeds"]
    if (
        not isinstance(raw_seeds, list)
        or not 1 <= len(raw_seeds) <= MAX_SEEDS
        or any(not _bounded_int(seed, maximum=MAX_SEEDS - 1) for seed in raw_seeds)
        or len(raw_seeds) != len(set(raw_seeds))
    ):
        raise InputProblem("invalid_seed_inventory", 1)

    raw_cases = header["expected_cases"]
    if not isinstance(raw_cases, list) or not raw_cases or len(raw_cases) > MAX_EXPECTED_CASES:
        raise InputProblem("invalid_expected_cases", 1)
    cases: dict[str, dict[str, str]] = {}
    family_splits: dict[str, set[str]] = defaultdict(set)
    for case in raw_cases:
        if not isinstance(case, dict):
            raise InputProblem("invalid_expected_case", 1)
        _check_keys(case, {"case_id", "family_id", "split"}, {"case_id", "family_id", "split"}, 1)
        case_id, family_id, split = case["case_id"], case["family_id"], case["split"]
        if not _identifier(case_id) or not _identifier(family_id) or split not in REQUIRED_SPLITS:
            raise InputProblem("invalid_expected_case", 1)
        if case_id in cases:
            raise InputProblem("duplicate_expected_case", 1)
        cases[case_id] = {"family_id": family_id, "split": split}
        family_splits[family_id].add(split)
    for splits in family_splits.values():
        if len(splits) > 1:
            _add_diagnostic(diagnostics, "family_split_leakage")
    for split in REQUIRED_SPLITS:
        if not any(case["split"] == split for case in cases.values()):
            _add_diagnostic(diagnostics, "split_has_no_expected_cases")

    expected_observations = len(cases) * len(raw_arms) * len(raw_seeds) * len(REQUIRED_QUESTION_IDS)
    if expected_observations > MAX_EXPECTED_OBSERVATIONS:
        raise InputProblem("expected_observation_limit_exceeded", 1)

    denominators: dict[tuple[str, str, int, str], dict[str, Any]] = {}
    raw_denominators = header.get("denominators", [])
    if not isinstance(raw_denominators, list):
        raise InputProblem("invalid_denominators", 1)
    for item in raw_denominators:
        if not isinstance(item, dict):
            raise InputProblem("invalid_denominator", 1)
        _check_keys(
            item,
            {"split", "arm", "seed", "question_id", "method", "n"},
            {"split", "arm", "seed", "question_id", "method", "n"},
            1,
        )
        split, arm, seed, question_id = item["split"], item["arm"], item["seed"], item["question_id"]
        if (
            split not in REQUIRED_SPLITS
            or not _identifier(arm)
            or not _bounded_int(seed, maximum=MAX_SEEDS - 1)
            or not _identifier(question_id, QUESTION_RE)
            or not _bounded_int(item["n"], maximum=MAX_EXPECTED_CASES)
            or not isinstance(item["method"], str)
        ):
            raise InputProblem("invalid_denominator", 1)
        key = _group_key(split, arm, seed, question_id)
        if key in denominators:
            raise InputProblem("duplicate_denominator", 1)
        denominators[key] = {"method": item["method"], "n": item["n"]}

    expected_pins = header.get("expected_pins", {})
    if not isinstance(expected_pins, dict) or not set(expected_pins).issubset(PIN_NAMES):
        raise InputProblem("invalid_expected_pins", 1)
    normalized_pins: dict[str, str | None] = {}
    for pin_name in PIN_NAMES:
        value = expected_pins.get(pin_name)
        if value is not None and not _identifier(value, PIN_RE):
            raise InputProblem("invalid_pin_claim", 1)
        normalized_pins[pin_name] = value
        if value is None:
            _add_diagnostic(diagnostics, "pin_missing", pin_name=pin_name)

    mapping_claims = header.get("mapping_claims", {})
    if not isinstance(mapping_claims, dict) or not set(mapping_claims).issubset(REQUIRED_QUESTION_IDS):
        raise InputProblem("invalid_mapping_claims", 1)
    for question_id, status in mapping_claims.items():
        if not isinstance(status, str) or status not in {"unresolved", "unmapped", "caller_claimed_approved"}:
            raise InputProblem("invalid_mapping_claim_status", 1)
        if status == "unresolved":
            _add_diagnostic(diagnostics, "mapping_unresolved")
        else:
            _add_diagnostic(diagnostics, "mapping_unverified")
    for question_id in REQUIRED_QUESTION_IDS:
        if question_id not in mapping_claims:
            _add_diagnostic(diagnostics, "mapping_claim_missing")

    corpus_status = header.get("corpus_status")
    if not isinstance(corpus_status, str) or corpus_status not in {"unqualified", "caller_claimed_qualified"}:
        if corpus_status is not None:
            raise InputProblem("invalid_corpus_status", 1)
        _add_diagnostic(diagnostics, "corpus_qualification_missing")
    else:
        _add_diagnostic(diagnostics, "corpus_qualification_unverified")
    target_status = header.get("target_status")
    if not isinstance(target_status, str) or target_status not in {"missing", "proposed_unapproved", "caller_claimed_approved"}:
        if target_status is not None:
            raise InputProblem("invalid_target_status", 1)
        _add_diagnostic(diagnostics, "target_approval_missing")
    else:
        _add_diagnostic(diagnostics, "target_approval_unverified")

    for claim_key, allowed_keys in (
        ("owner_approval_claims", set(OWNER_CLAIM_NAMES)),
        ("caller_claims", set(CALLER_CLAIM_NAMES)),
    ):
        claims = header.get(claim_key, {})
        if not isinstance(claims, dict) or not set(claims).issubset(allowed_keys):
            raise InputProblem("invalid_caller_claims", 1)
        if any(type(value) is not bool for value in claims.values()):
            raise InputProblem("invalid_caller_claims", 1)
    _add_diagnostic(diagnostics, "owner_approvals_not_authenticated")
    _add_diagnostic(diagnostics, "live_acceptance_not_established")

    percentile_spec = header.get("percentile_spec")
    normalized_percentile: dict[str, Any] | None = None
    if percentile_spec is None:
        _add_diagnostic(diagnostics, "percentile_method_or_boundary_missing")
    elif not isinstance(percentile_spec, dict):
        raise InputProblem("invalid_percentile_spec", 1)
    else:
        _check_keys(
            percentile_spec,
            {"method", "boundary", "percentiles"},
            {"method", "boundary", "percentiles"},
            1,
        )
        raw_percentiles = percentile_spec["percentiles"]
        if (
            percentile_spec["method"] != "nearest_rank"
            or percentile_spec["boundary"] != "separate_cold_warm"
            or not isinstance(raw_percentiles, list)
            or len(raw_percentiles) != 2
            or any(not _is_int(value) for value in raw_percentiles)
            or raw_percentiles != [50, 95]
        ):
            _add_diagnostic(diagnostics, "unsupported_percentile_method_or_boundary")
        else:
            normalized_percentile = {
                "method": "nearest_rank",
                "boundary": "separate_cold_warm",
                "percentiles": [50, 95],
            }

    return {
        "arms": list(raw_arms),
        "seeds": list(raw_seeds),
        "cases": cases,
        "denominators": denominators,
        "expected_pins": normalized_pins,
        "mapping_claims": mapping_claims,
        "percentile_spec": normalized_percentile,
        "expected_question_ids": raw_questions,
        "expected_splits": list(raw_splits),
    }


def _parse_label_object(value: Any, *, truth: bool, line: int) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InputProblem("invalid_label_status", line)
    _check_keys(value, {"status", "token"}, {"status", "token"}, line)
    status, token = value["status"], value["token"]
    allowed = {"adjudicated", "unmapped", "missing", "unknown"} if truth else {
        "label", "unmapped", "abstained", "outage", "unknown", "missing"
    }
    if not isinstance(status, str) or status not in allowed:
        raise InputProblem("invalid_label_status", line)
    if token is not None and not _identifier(token, LABEL_RE):
        raise InputProblem("invalid_label_token", line)
    if truth and status == "adjudicated" and token is None:
        # Keep this as a valid blocked observation; it cannot enter the denominator.
        pass
    if not truth and status in {"label", "unmapped"} and token is None:
        # Keep this as a valid blocked observation; it cannot be treated as a label.
        pass
    return {"status": status, "token": token}


def _parse_cost_attempt(value: Any, *, line: int) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InputProblem("invalid_usage_attempt", line)
    _check_keys(
        value,
        {"attempt_id", "batch_id", "retry_of", "usage_status", "cost"},
        {"attempt_id", "batch_id", "retry_of", "usage_status", "cost"},
        line,
    )
    attempt_id, batch_id, retry_of = value["attempt_id"], value["batch_id"], value["retry_of"]
    if not _identifier(attempt_id) or not _identifier(batch_id):
        raise InputProblem("invalid_attempt_identity", line)
    if retry_of is not None and (not _identifier(retry_of) or retry_of == attempt_id):
        raise InputProblem("invalid_retry_identity", line)
    usage_status = value["usage_status"]
    if not isinstance(usage_status, str) or usage_status not in {"confirmed", "estimated", "unknown"}:
        raise InputProblem("invalid_usage_status", line)
    cost = value["cost"]
    normalized_cost: dict[str, Any] | None = None
    if usage_status == "unknown":
        if cost is not None:
            raise InputProblem("unknown_usage_has_cost", line)
    else:
        if not isinstance(cost, dict):
            raise InputProblem("known_usage_missing_cost", line)
        _check_keys(cost, {"currency", "precision", "amount_minor"}, {"currency", "precision", "amount_minor"}, line)
        currency, precision, amount_minor = cost["currency"], cost["precision"], cost["amount_minor"]
        if not isinstance(currency, str) or not CURRENCY_RE.fullmatch(currency):
            raise InputProblem("invalid_cost_currency", line)
        if not _bounded_int(precision, maximum=6):
            raise InputProblem("invalid_cost_precision", line)
        if not _bounded_int(amount_minor, maximum=MAX_COST_MINOR):
            raise InputProblem("invalid_cost_amount", line)
        normalized_cost = {
            "currency": currency,
            "precision": precision,
            "amount_minor": amount_minor,
        }
    return {
        "attempt_id": attempt_id,
        "batch_id": batch_id,
        "retry_of": retry_of,
        "usage_status": usage_status,
        "cost": normalized_cost,
    }


def _parse_observation(
    line_number: int,
    row: dict[str, Any],
    config: dict[str, Any],
    diagnostics: list[dict[str, Any]],
) -> dict[str, Any]:
    _check_keys(row, OBSERVATION_KEYS, OBSERVATION_KEYS, line_number)
    case_id, family_id = row["case_id"], row["family_id"]
    split, arm, seed, question_id = row["split"], row["arm"], row["seed"], row["question_id"]
    if not _identifier(case_id) or not _identifier(family_id):
        raise InputProblem("invalid_sample_identity", line_number)
    if split not in REQUIRED_SPLITS:
        raise InputProblem("invalid_split", line_number)
    if not _identifier(arm):
        raise InputProblem("invalid_arm", line_number)
    if not _bounded_int(seed, maximum=MAX_SEEDS - 1):
        raise InputProblem("invalid_seed", line_number)
    if not _identifier(question_id, QUESTION_RE):
        raise InputProblem("invalid_question_id", line_number)
    if row["evidence_mode"] != SOURCE_MODE:
        raise InputProblem("non_synthetic_evidence_mode", line_number)

    truth = _parse_label_object(row["truth"], truth=True, line=line_number)
    prediction = _parse_label_object(row["prediction"], truth=False, line=line_number)

    latency_value = row["latency_ms"]
    latency_ms = None if latency_value is None else _safe_decimal(latency_value)
    if latency_value is not None and latency_ms is None:
        raise InputProblem("invalid_latency", line_number)
    latency_phase = row["latency_phase"]
    if latency_phase is not None and (not isinstance(latency_phase, str) or latency_phase not in {"cold", "warm"}):
        raise InputProblem("invalid_latency_phase", line_number)
    if latency_ms is not None and latency_phase is None:
        _add_diagnostic(diagnostics, "latency_phase_missing", line=line_number)
    if latency_ms is None and latency_phase is not None:
        _add_diagnostic(diagnostics, "latency_value_missing", line=line_number)

    usage_state = row["usage_state"]
    if not isinstance(usage_state, str) or usage_state not in {"attributed", "unknown", "no_billable_usage_claimed"}:
        raise InputProblem("invalid_usage_state", line_number)
    raw_attempts = row["usage_attempts"]
    if not isinstance(raw_attempts, list) or len(raw_attempts) > MAX_ATTEMPTS_PER_OBSERVATION:
        raise InputProblem("invalid_usage_attempts", line_number)
    attempts = [_parse_cost_attempt(item, line=line_number) for item in raw_attempts]
    attempt_ids = [item["attempt_id"] for item in attempts]
    if len(attempt_ids) != len(set(attempt_ids)):
        raise InputProblem("duplicate_attempt_attachment", line_number)
    if usage_state == "attributed" and not attempts:
        _add_diagnostic(diagnostics, "attributed_usage_without_attempt", line=line_number)
    if usage_state in {"unknown", "no_billable_usage_claimed"} and attempts:
        raise InputProblem("usage_state_attempt_conflict", line_number)
    if usage_state == "unknown":
        _add_diagnostic(diagnostics, "usage_coverage_unknown", line=line_number)
    if usage_state == "no_billable_usage_claimed":
        _add_diagnostic(diagnostics, "no_billable_usage_claim_unverified", line=line_number)

    observed_pins = row["observed_pins"]
    if not isinstance(observed_pins, dict) or not set(observed_pins).issubset(PIN_NAMES):
        raise InputProblem("invalid_observed_pins", line_number)
    normalized_observed_pins: dict[str, str | None] = {}
    for pin_name in PIN_NAMES:
        pin_value = observed_pins.get(pin_name)
        if pin_value is not None and not _identifier(pin_value, PIN_RE):
            raise InputProblem("invalid_observed_pin", line_number)
        normalized_observed_pins[pin_name] = pin_value
        expected = config["expected_pins"].get(pin_name)
        if expected is None or pin_value is None:
            _add_diagnostic(diagnostics, "pin_missing", line=line_number, pin_name=pin_name)
        elif expected != pin_value:
            _add_diagnostic(diagnostics, "pin_claim_mismatch", line=line_number, pin_name=pin_name)

    if truth["status"] == "adjudicated" and truth["token"] is None:
        _add_diagnostic(diagnostics, "adjudicated_truth_token_missing", line=line_number)
    elif truth["status"] == "unmapped":
        _add_diagnostic(diagnostics, "truth_mapping_unresolved", line=line_number)
    elif truth["status"] in {"missing", "unknown"} and truth["token"] is not None:
        _add_diagnostic(diagnostics, "truth_token_without_adjudication", line=line_number)
    if prediction["status"] == "label" and prediction["token"] is None:
        _add_diagnostic(diagnostics, "prediction_label_missing", line=line_number)
    elif prediction["status"] == "unmapped":
        _add_diagnostic(diagnostics, "prediction_mapping_unresolved", line=line_number)
    elif prediction["status"] in {"abstained", "outage", "unknown", "missing"} and prediction["token"] is not None:
        _add_diagnostic(diagnostics, "prediction_token_status_conflict", line=line_number)
    if prediction["status"] == "outage":
        _add_diagnostic(diagnostics, "provider_outage_outcome_retained", line=line_number)

    return {
        "line": line_number,
        "case_id": case_id,
        "family_id": family_id,
        "split": split,
        "arm": arm,
        "seed": seed,
        "question_id": question_id,
        "truth": truth,
        "prediction": prediction,
        "latency_ms": latency_ms,
        "latency_phase": latency_phase,
        "usage_state": usage_state,
        "usage_attempts": attempts,
        "observed_pins": normalized_observed_pins,
    }


def _nearest_rank(values: list[Decimal], percentile: int) -> Decimal | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = (percentile * len(ordered) + 99) // 100
    return ordered[max(0, rank - 1)]


def _sum_minor_bounded(values: Any) -> int | None:
    total = 0
    for value in values:
        total += value
        if total > MAX_COST_MINOR:
            return None
    return total


def _project_groups(
    config: dict[str, Any],
    observations: list[dict[str, Any]],
    diagnostics: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, int, str], list[dict[str, Any]]] = defaultdict(list)
    for row in observations:
        key = _group_key(row["split"], row["arm"], row["seed"], row["question_id"])
        if (
            row["case_id"] in config["cases"]
            and config["cases"][row["case_id"]]["split"] == row["split"]
            and config["cases"][row["case_id"]]["family_id"] == row["family_id"]
            and row["arm"] in config["arms"]
            and row["seed"] in config["seeds"]
            and row["question_id"] in REQUIRED_QUESTION_IDS
        ):
            grouped[key].append(row)

    output_groups: list[dict[str, Any]] = []
    key_to_index: dict[tuple[str, str, int, str], int] = {}
    group_keys = (
        (split, arm, seed, question_id)
        for split in REQUIRED_SPLITS
        for arm in config["arms"]
        for seed in config["seeds"]
        for question_id in REQUIRED_QUESTION_IDS
    )
    for index, (split, arm, seed, question_id) in enumerate(group_keys, start=1):
        key = _group_key(split, arm, seed, question_id)
        key_to_index[key] = index
        expected_case_ids = {
            case_id for case_id, case in config["cases"].items() if case["split"] == split
        }
        rows = grouped.get(key, [])
        seen_case_ids = {row["case_id"] for row in rows}
        missing = len(expected_case_ids - seen_case_ids)
        if missing:
            _add_diagnostic(diagnostics, "expected_observation_missing", group_index=index, count=missing)

        truth_counts: Counter[str] = Counter()
        prediction_counts: Counter[str] = Counter()
        pair_counts: Counter[tuple[str, str, str, str]] = Counter()
        phase_values: dict[str, list[Decimal]] = {"cold": [], "warm": []}
        adjudicated_truth_count = 0
        exact_match_count = 0
        for row in rows:
            truth = row["truth"]
            prediction = row["prediction"]
            truth_counts[truth["status"]] += 1
            prediction_counts[prediction["status"]] += 1
            pair_counts[(truth["status"], truth["token"] or "", prediction["status"], prediction["token"] or "")] += 1
            if truth["status"] == "adjudicated" and truth["token"] is not None:
                adjudicated_truth_count += 1
                if prediction["status"] == "label" and prediction["token"] is not None:
                    if truth["token"] == prediction["token"]:
                        exact_match_count += 1
            if row["latency_ms"] is not None and row["latency_phase"] in phase_values:
                phase_values[row["latency_phase"]].append(row["latency_ms"])

        declared = config["denominators"].get(key)
        denominator_result: dict[str, Any] = {
            "method": "adjudicated_truth_token_rows",
            "declared_n": None,
            "observed_n": adjudicated_truth_count,
            "exact_token_agreement": None,
            "reason": "denominator_missing",
        }
        if declared is None:
            _add_diagnostic(diagnostics, "denominator_missing", group_index=index)
        elif declared["method"] != "adjudicated_truth_token_rows":
            denominator_result["reason"] = "unsupported_denominator_method"
            _add_diagnostic(diagnostics, "denominator_method_unsupported", group_index=index)
        else:
            denominator_result["declared_n"] = declared["n"]
            if declared["n"] != adjudicated_truth_count:
                denominator_result["reason"] = "denominator_mismatch"
                _add_diagnostic(diagnostics, "denominator_mismatch", group_index=index)
            elif missing:
                denominator_result["reason"] = "expected_observations_missing"
            elif declared["n"] == 0:
                denominator_result["reason"] = "zero_denominator"
                _add_diagnostic(diagnostics, "zero_denominator", group_index=index)
            else:
                denominator_result["reason"] = None
                denominator_result["exact_token_agreement"] = {
                    "numerator": exact_match_count,
                    "denominator": declared["n"],
                }

        raw_pairs = []
        for (truth_status, truth_token, prediction_status, prediction_token), count in sorted(pair_counts.items()):
            raw_pairs.append({
                "truth_status": truth_status,
                "truth_token": truth_token or None,
                "prediction_status": prediction_status,
                "prediction_token": prediction_token or None,
                "count": count,
            })

        latency: dict[str, Any] = {
            "method": config["percentile_spec"]["method"] if config["percentile_spec"] else None,
            "boundary": config["percentile_spec"]["boundary"] if config["percentile_spec"] else None,
            "cold": {"n": len(phase_values["cold"]), "p50_ms": None, "p95_ms": None, "reason": None},
            "warm": {"n": len(phase_values["warm"]), "p50_ms": None, "p95_ms": None, "reason": None},
        }
        if config["percentile_spec"] is None:
            latency["cold"]["reason"] = "method_or_boundary_missing"
            latency["warm"]["reason"] = "method_or_boundary_missing"
        else:
            for phase in ("cold", "warm"):
                if not phase_values[phase]:
                    latency[phase]["reason"] = "zero_samples"
                else:
                    for percentile in (50, 95):
                        selected = _nearest_rank(phase_values[phase], percentile)
                        latency[phase][f"p{percentile}_ms"] = _decimal_text(selected) if selected is not None else None

        output_groups.append({
            **_group_record(split, arm, seed, question_id, index),
            "expected_observations": len(expected_case_ids),
            "observed_observations": len(rows),
            "missing_observations": missing,
            "truth_status_counts": dict(sorted(truth_counts.items())),
            "prediction_status_counts": dict(sorted(prediction_counts.items())),
            "raw_label_pair_counts": raw_pairs,
            "denominator": denominator_result,
            "latency": latency,
        })

    # Check group coverage by arm without pooling calibration and held-out rows.
    for split in REQUIRED_SPLITS:
        for seed in config["seeds"]:
            for question_id in REQUIRED_QUESTION_IDS:
                arm_cohorts = []
                for arm in config["arms"]:
                    rows = grouped.get(_group_key(split, arm, seed, question_id), [])
                    arm_cohorts.append({row["case_id"] for row in rows})
                if arm_cohorts and any(cohort != arm_cohorts[0] for cohort in arm_cohorts[1:]):
                    _add_diagnostic(diagnostics, "arm_cohort_mismatch")

    # Denominator declarations outside the explicit grouping grid cannot define new groups.
    valid_keys = set(key_to_index)
    for key in config["denominators"]:
        if key not in valid_keys:
            _add_diagnostic(diagnostics, "denominator_for_unexpected_group")
    return output_groups


def _cost_projection(
    config: dict[str, Any],
    observations: list[dict[str, Any]],
    diagnostics: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    attempts: dict[str, dict[str, Any]] = {}
    batch_contexts: dict[str, tuple[str, str, int]] = {}
    group_usage_states: dict[tuple[str, str, int], Counter[str]] = defaultdict(Counter)
    attachment_count: Counter[tuple[str, str, int]] = Counter()
    malformed_identity = False

    for row in observations:
        context = (row["split"], row["arm"], row["seed"])
        group_usage_states[context][row["usage_state"]] += 1
        if row["usage_state"] == "attributed" and not row["usage_attempts"]:
            group_usage_states[context]["attributed_without_attempt"] += 1
        for attempt in row["usage_attempts"]:
            batch_context = (row["split"], row["arm"], row["seed"])
            previous_batch_context = batch_contexts.get(attempt["batch_id"])
            if previous_batch_context is not None and previous_batch_context != batch_context:
                _add_diagnostic(diagnostics, "batch_identity_conflict", line=row["line"])
                malformed_identity = True
            else:
                batch_contexts[attempt["batch_id"]] = batch_context
            signature = {
                "batch_id": attempt["batch_id"],
                "retry_of": attempt["retry_of"],
                "usage_status": attempt["usage_status"],
                "cost": attempt["cost"],
                "context": context,
            }
            existing = attempts.get(attempt["attempt_id"])
            attachment = (row["case_id"], row["question_id"])
            if existing is None:
                attempts[attempt["attempt_id"]] = {
                    "signature": signature,
                    "attachments": {attachment},
                    "line": row["line"],
                }
            elif existing["signature"] != signature:
                _add_diagnostic(diagnostics, "attempt_identity_conflict", line=row["line"])
                malformed_identity = True
            elif attachment in existing["attachments"]:
                _add_diagnostic(diagnostics, "duplicate_attempt_attachment", line=row["line"])
                malformed_identity = True
            else:
                existing["attachments"].add(attachment)
            attachment_count[context] += 1
    if malformed_identity:
        raise InputProblem("conflicting_attempt_identity")

    for attempt_id, attempt in attempts.items():
        retry_of = attempt["signature"]["retry_of"]
        if retry_of is not None:
            parent = attempts.get(retry_of)
            if parent is None:
                _add_diagnostic(diagnostics, "retry_parent_missing", line=attempt["line"])
            elif parent["signature"]["context"] != attempt["signature"]["context"] or parent["signature"]["batch_id"] != attempt["signature"]["batch_id"]:
                raise InputProblem("retry_parent_identity_conflict", attempt["line"])

    # Retry links form a directed graph with at most one outgoing edge per
    # attempt. Walk it iteratively so adversarial input cannot exhaust Python's
    # recursion stack, and reject every cycle before cost projection.
    visited: set[str] = set()
    for start_id in attempts:
        if start_id in visited:
            continue
        path: list[str] = []
        positions: dict[str, int] = {}
        current_id: str | None = start_id
        while current_id is not None and current_id in attempts and current_id not in visited:
            if current_id in positions:
                raise InputProblem("retry_lineage_cycle", attempts[current_id]["line"])
            positions[current_id] = len(path)
            path.append(current_id)
            current_id = attempts[current_id]["signature"]["retry_of"]
        visited.update(path)

    for attempt in attempts.values():
        cost = attempt["signature"]["cost"]
        if cost is not None:
            group_usage_states[attempt["signature"]["context"]][f"cost_basis:{attempt['signature']['usage_status']}"] += 1
        else:
            group_usage_states[attempt["signature"]["context"]]["cost_basis:unknown"] += 1

    # Every currency uses one declared minor-unit precision in the full fixture.
    currency_precisions: dict[str, set[int]] = defaultdict(set)
    for attempt in attempts.values():
        cost = attempt["signature"]["cost"]
        if cost is not None:
            currency_precisions[cost["currency"]].add(cost["precision"])
    inconsistent_currencies = {currency for currency, precisions in currency_precisions.items() if len(precisions) > 1}
    for _ in inconsistent_currencies:
        _add_diagnostic(diagnostics, "currency_precision_mismatch")

    contexts = {
        (split, arm, seed)
        for split in REQUIRED_SPLITS
        for arm in config["arms"]
        for seed in config["seeds"]
    }
    contexts.update(
        context for context in group_usage_states
        if context[0] in REQUIRED_SPLITS and _identifier(context[1]) and _bounded_int(context[2], maximum=MAX_SEEDS - 1)
    )
    attempts_by_context: dict[tuple[str, str, int], list[dict[str, Any]]] = defaultdict(list)
    for attempt in attempts.values():
        attempts_by_context[attempt["signature"]["context"]].append(attempt)
    context_row_counts: Counter[tuple[str, str, int]] = Counter()
    context_expected_counts: Counter[tuple[str, str, int]] = Counter()
    for row in observations:
        context = (row["split"], row["arm"], row["seed"])
        context_row_counts[context] += 1
        case = config["cases"].get(row["case_id"])
        if (
            case is not None
            and case["split"] == row["split"]
            and case["family_id"] == row["family_id"]
            and row["arm"] in config["arms"]
            and row["seed"] in config["seeds"]
            and row["question_id"] in REQUIRED_QUESTION_IDS
        ):
            context_expected_counts[context] += 1
    output: list[dict[str, Any]] = []
    for split, arm, seed in sorted(
        contexts,
        key=lambda item: (
            REQUIRED_SPLITS.index(item[0]),
            config["arms"].index(item[1]) if item[1] in config["arms"] else len(config["arms"]),
            item[1],
            item[2],
        ),
    ):
        context = (split, arm, seed)
        selected = attempts_by_context.get(context, [])
        by_currency: dict[str, dict[str, Any]] = {}
        currency_overflow = False
        for attempt in selected:
            cost = attempt["signature"]["cost"]
            if cost is None:
                continue
            currency = cost["currency"]
            entry = by_currency.setdefault(currency, {
                "currency": currency,
                "precision": cost["precision"] if currency not in inconsistent_currencies else None,
                "confirmed_minor": None if currency in inconsistent_currencies else 0,
                "estimated_minor": None if currency in inconsistent_currencies else 0,
            })
            if currency not in inconsistent_currencies:
                amount_key = f"{attempt['signature']['usage_status']}_minor"
                current = entry[amount_key]
                if current is not None:
                    subtotal = _sum_minor_bounded((current, cost["amount_minor"]))
                    if subtotal is None:
                        entry[amount_key] = None
                        currency_overflow = True
                    else:
                        entry[amount_key] = subtotal
        for entry in by_currency.values():
            if entry["confirmed_minor"] is None or entry["estimated_minor"] is None:
                entry["known_subtotal_minor"] = None
            else:
                subtotal = _sum_minor_bounded((entry["confirmed_minor"], entry["estimated_minor"]))
                entry["known_subtotal_minor"] = subtotal
                if subtotal is None:
                    currency_overflow = True
        if currency_overflow:
            _add_diagnostic(diagnostics, "cost_aggregate_out_of_bounds")

        usage_states = group_usage_states[context]
        unknown_attempts = sum(1 for attempt in selected if attempt["signature"]["usage_status"] == "unknown")
        unverified_no_usage_rows = usage_states["no_billable_usage_claimed"]
        unknown_rows = usage_states["unknown"]
        attributed_without_attempt = usage_states["attributed_without_attempt"] > 0
        currencies = sorted({attempt["signature"]["cost"]["currency"] for attempt in selected if attempt["signature"]["cost"] is not None})
        expected_observations = (
            sum(1 for case in config["cases"].values() if case["split"] == split) * len(REQUIRED_QUESTION_IDS)
            if arm in config["arms"] and seed in config["seeds"]
            else 0
        )
        observed_expected_observations = context_expected_counts[context]
        missing_expected_observations = max(0, expected_observations - observed_expected_observations)
        unexpected_observations = max(0, context_row_counts[context] - observed_expected_observations)
        if expected_observations == 0:
            coverage_status = "unexpected_context"
        elif missing_expected_observations or unexpected_observations:
            coverage_status = "incomplete"
        else:
            coverage_status = "complete"

        reason = None
        total_minor: int | None = None
        currency: str | None = None
        precision: int | None = None
        if unknown_attempts or unknown_rows or unverified_no_usage_rows or attributed_without_attempt:
            reason = "unknown_or_unverified_usage_coverage"
        elif inconsistent_currencies.intersection(currencies):
            reason = "currency_precision_mismatch"
        elif len(currencies) > 1:
            reason = "currency_mismatch"
        elif not selected:
            reason = "no_billable_attempt_amount_reported"
        else:
            currency = currencies[0]
            precision = next(iter(currency_precisions[currency]))
            total_minor = _sum_minor_bounded(
                attempt["signature"]["cost"]["amount_minor"]
                for attempt in selected
                if attempt["signature"]["cost"] is not None
            )
            if total_minor is None:
                reason = "aggregate_amount_out_of_bounds"
                _add_diagnostic(diagnostics, "cost_aggregate_out_of_bounds")
        if coverage_status != "complete":
            _add_diagnostic(diagnostics, "expected_observation_coverage_incomplete")
            if reason is None:
                reason = "expected_observation_coverage_incomplete" if coverage_status == "incomplete" else "unexpected_cost_context"
        if reason is not None:
            _add_diagnostic(diagnostics, "cost_total_blocked")
        subtotal_status = (
            "observed_attempt_subtotal_incomplete_coverage"
            if total_minor is not None and coverage_status != "complete"
            else "observed_attempt_subtotal"
            if total_minor is not None
            else "blocked"
        )
        output.append({
            "split": split,
            "arm": arm,
            "seed": seed,
            "coverage": {
                "status": coverage_status,
                "expected_observations": expected_observations,
                "observed_expected_observations": observed_expected_observations,
                "missing_expected_observations": missing_expected_observations,
                "unexpected_observations": unexpected_observations,
            },
            "unique_attempt_count": len(selected),
            "attempt_attachment_count": attachment_count[context],
            "confirmed_attempt_claims": sum(1 for attempt in selected if attempt["signature"]["usage_status"] == "confirmed"),
            "estimated_attempt_claims": sum(1 for attempt in selected if attempt["signature"]["usage_status"] == "estimated"),
            "unknown_attempt_count": unknown_attempts,
            "unknown_usage_row_count": unknown_rows,
            "no_billable_usage_claim_row_count": unverified_no_usage_rows,
            "currency_breakdown": [by_currency[key] for key in sorted(by_currency)],
            "aggregate_total": {
                "scope": "unique_observed_billable_attempts",
                "status": subtotal_status,
                "currency": currency,
                "precision": precision,
                "amount_minor": total_minor,
                "reason": reason,
            },
            "authenticated": False,
        })
    return output


def project_bytes(data: bytes) -> dict[str, Any]:
    """Validate JSONL and return a deterministic sanitized descriptive report."""
    header, raw_rows = _read_jsonl(data)
    diagnostics: list[dict[str, Any]] = []
    config = _parse_header(header, diagnostics)
    observations: list[dict[str, Any]] = []
    seen_observations: set[tuple[str, str, str, int, str]] = set()

    for line_number, raw_row in raw_rows:
        observation = _parse_observation(line_number, raw_row, config, diagnostics)
        case = config["cases"].get(observation["case_id"])
        if case is None:
            _add_diagnostic(diagnostics, "unexpected_sample", line=line_number)
        elif case["split"] != observation["split"] or case["family_id"] != observation["family_id"]:
            _add_diagnostic(diagnostics, "sample_identity_mismatch", line=line_number)
        if observation["arm"] not in config["arms"]:
            _add_diagnostic(diagnostics, "unexpected_arm", line=line_number)
        if observation["seed"] not in config["seeds"]:
            _add_diagnostic(diagnostics, "unexpected_seed", line=line_number)
        if observation["question_id"] not in REQUIRED_QUESTION_IDS:
            _add_diagnostic(diagnostics, "unsupported_question_id", line=line_number)

        duplicate_key = (
            observation["case_id"], observation["split"], observation["arm"],
            observation["seed"], observation["question_id"],
        )
        if duplicate_key in seen_observations:
            raise InputProblem("duplicate_observation", line_number)
        seen_observations.add(duplicate_key)
        observations.append(observation)

    group_reports = _project_groups(config, observations, diagnostics)
    cost_reports = _cost_projection(config, observations, diagnostics)

    expected_count = len(config["cases"]) * len(config["arms"]) * len(config["seeds"]) * len(REQUIRED_QUESTION_IDS)
    observed_expected_count = sum(
        1 for row in observations
        if row["case_id"] in config["cases"]
        and config["cases"][row["case_id"]]["split"] == row["split"]
        and config["cases"][row["case_id"]]["family_id"] == row["family_id"]
        and row["arm"] in config["arms"]
        and row["seed"] in config["seeds"]
        and row["question_id"] in REQUIRED_QUESTION_IDS
    )
    pin_missing = sorted({item.get("pin_name") for item in diagnostics if item["code"] == "pin_missing" and item.get("pin_name")})
    pin_mismatched = sorted({item.get("pin_name") for item in diagnostics if item["code"] == "pin_claim_mismatch" and item.get("pin_name")})
    for pin_name in PIN_NAMES:
        if config["expected_pins"].get(pin_name) is None:
            if pin_name not in pin_missing:
                pin_missing.append(pin_name)
    pin_missing = sorted(set(pin_missing))

    data_blocker_codes = {
        "required_question_missing", "unsupported_question_declared", "required_split_missing",
        "split_has_no_expected_cases", "family_split_leakage",
        "percentile_method_or_boundary_missing", "unsupported_percentile_method_or_boundary",
        "pin_missing", "pin_claim_mismatch", "adjudicated_truth_token_missing",
        "truth_token_without_adjudication", "prediction_label_missing",
        "prediction_token_status_conflict", "latency_phase_missing", "latency_value_missing",
        "attributed_usage_without_attempt", "usage_coverage_unknown", "no_billable_usage_claim_unverified",
        "expected_observation_missing", "denominator_missing", "denominator_method_unsupported",
        "denominator_mismatch", "zero_denominator", "arm_cohort_mismatch",
        "denominator_for_unexpected_group", "unexpected_sample", "sample_identity_mismatch",
        "unexpected_arm", "unexpected_seed", "unsupported_question_id", "retry_parent_missing",
        "currency_precision_mismatch", "cost_aggregate_out_of_bounds", "cost_total_blocked",
        "expected_observation_coverage_incomplete",
    }
    data_blocker_count = sum(1 for item in diagnostics if item["code"] in data_blocker_codes)
    diagnostics.sort(key=lambda item: (
        item.get("group_index", 0), item.get("line", 0), item["code"],
        item.get("pin_name", ""), item.get("count", 0),
    ))

    report = {
        "report_contract": "ei.offline.projected-results",
        "report_version": REPORT_VERSION,
        "input_contract": CONTRACT,
        "input_schema_version": SCHEMA_VERSION,
        "source_mode": SOURCE_MODE,
        "projection_status": "completed",
        "status": "valid_blocked",
        "data_integrity_status": "blocked" if data_blocker_count else "clear",
        "data_integrity_blocker_count": data_blocker_count,
        "promotion_status": "blocked",
        "promotion_possible": False,
        "live_acceptance": False,
        "owner_approvals_authenticated": False,
        "label_mappings_authenticated": False,
        "corpus_qualification_authenticated": False,
        "grouping": ["split", "arm", "seed", "question_id"],
        "question_ids": list(REQUIRED_QUESTION_IDS),
        "sample_counts": {
            "expected_observations": expected_count,
            "observed_expected_observations": observed_expected_count,
            "input_observation_rows": len(observations),
        },
        "pin_claims": {
            "status": "unverified",
            "missing_names": pin_missing,
            "mismatched_names": pin_mismatched,
            "matching_values_authenticated": False,
        },
        "groups": group_reports,
        "cost_groups": cost_reports,
        "diagnostics": diagnostics,
        "promotion_blockers": [
            "owner_approvals_not_authenticated",
            "corpus_and_calibration_held_out_qualification_not_established",
            "question_label_and_metric_mapping_not_approved_or_authenticated",
            "exact_schema_adapter_model_runtime_and_baseline_acceptance_not_established",
            "actual_active_routing_receipts_not_present",
            "confidence_intervals_and_full_issue_21_evaluation_not_implemented",
            "promotion_path_is_disabled_in_this_tool",
        ],
    }
    serialized = json.dumps(report, ensure_ascii=True, indent=2, sort_keys=True).encode("utf-8")
    if len(serialized) > MAX_REPORT_BYTES:
        raise InputProblem("report_too_large")
    return report


def _error_payload(problem: InputProblem) -> dict[str, Any]:
    payload: dict[str, Any] = {"status": "malformed", "code": problem.code}
    if problem.line is not None:
        payload["line"] = problem.line
    return payload


def _read_input(path: Path) -> bytes:
    try:
        with path.open("rb") as handle:
            data = handle.read(MAX_INPUT_BYTES + 1)
    except OSError as exc:
        raise InputProblem("input_unreadable") from exc
    if len(data) > MAX_INPUT_BYTES:
        raise InputProblem("input_too_large")
    return data


def _write_output(path: Path, content: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except OSError as exc:
        try:
            if "temporary" in locals():
                temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise InputProblem("output_write_failed") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="synthetic normalized-result JSONL")
    parser.add_argument("--output", type=Path, default=None, help="report path; omit to write the report to stdout")
    args = parser.parse_args(argv)
    try:
        raw = _read_input(args.input)
        report = project_bytes(raw)
        content = json.dumps(report, ensure_ascii=True, indent=2, sort_keys=True) + "\n"
        if args.output is None:
            sys.stdout.write(content)
        else:
            try:
                if args.input.resolve() == args.output.resolve():
                    raise InputProblem("input_output_path_conflict")
            except OSError:
                raise InputProblem("input_output_path_conflict")
            _write_output(args.output, content)
        return 3
    except InputProblem as problem:
        sys.stderr.write(json.dumps(_error_payload(problem), sort_keys=True) + "\n")
        return 2
    except Exception:
        # Never let unexpected parser/projection details echo input values or paths.
        sys.stderr.write(json.dumps({"status": "malformed", "code": "internal_projection_error"}, sort_keys=True) + "\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
