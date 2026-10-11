"""Tests for the synthetic-only normalized-result projector."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

from evals import project_results


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "evals" / "project-results" / "smoke.synthetic.jsonl"
SCRIPT = ROOT / "evals" / "project_results.py"


def load_fixture() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    lines = FIXTURE.read_text(encoding="utf-8").splitlines()
    records = [json.loads(line) for line in lines]
    return records[0], records[1:]


def serialize(header: dict[str, Any], rows: list[dict[str, Any]]) -> bytes:
    records = [header, *rows]
    return ("\n".join(json.dumps(record, sort_keys=True, separators=(",", ":")) for record in records) + "\n").encode()


def group_key(row: dict[str, Any]) -> tuple[str, str, int, str]:
    return row["split"], row["arm"], row["seed"], row["question_id"]


def set_declared_denominators(header: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    counts: dict[tuple[str, str, int, str], int] = {}
    for row in rows:
        truth = row["truth"]
        if truth["status"] == "adjudicated" and truth["token"] is not None:
            key = group_key(row)
            counts[key] = counts.get(key, 0) + 1
    for denominator in header["denominators"]:
        key = (denominator["split"], denominator["arm"], denominator["seed"], denominator["question_id"])
        denominator["n"] = counts.get(key, 0)


def expected_group(report: dict[str, Any], split: str, arm: str, question_id: str) -> dict[str, Any]:
    return next(
        item for item in report["groups"]
        if (item["split"], item["arm"], item["seed"], item["question_id"]) == (split, arm, 1, question_id)
    )


def cost_group(report: dict[str, Any], split: str, arm: str) -> dict[str, Any]:
    return next(item for item in report["cost_groups"] if (item["split"], item["arm"], item["seed"]) == (split, arm, 1))


class ProjectResultsTests(unittest.TestCase):
    def test_fixture_has_clear_structure_but_never_promotes(self) -> None:
        report = project_results.project_bytes(FIXTURE.read_bytes())

        self.assertEqual(report["projection_status"], "completed")
        self.assertEqual(report["data_integrity_status"], "clear")
        self.assertEqual(report["data_integrity_blocker_count"], 0)
        self.assertEqual(report["sample_counts"]["expected_observations"], 112)
        self.assertEqual(report["sample_counts"]["observed_expected_observations"], 112)
        self.assertEqual(len(report["groups"]), 28)
        self.assertEqual(len(report["cost_groups"]), 4)
        self.assertEqual(report["promotion_status"], "blocked")
        self.assertFalse(report["promotion_possible"])
        self.assertFalse(report["live_acceptance"])
        self.assertFalse(report["owner_approvals_authenticated"])
        self.assertFalse(report["label_mappings_authenticated"])
        self.assertIn("promotion_path_is_disabled_in_this_tool", report["promotion_blockers"])

    def test_groups_keep_splits_and_nearest_rank_phases_separate(self) -> None:
        report = project_results.project_bytes(FIXTURE.read_bytes())
        qid = "Q-EI-SOURCE-TYPE:v1"
        calibration = expected_group(report, "calibration", "arm_a", qid)
        held_out = expected_group(report, "held_out", "arm_a", qid)

        self.assertEqual(calibration["expected_observations"], 4)
        self.assertEqual(calibration["denominator"]["method"], "adjudicated_truth_token_rows")
        self.assertEqual(calibration["denominator"]["exact_token_agreement"], {"numerator": 4, "denominator": 4})
        self.assertEqual(calibration["latency"]["cold"], {"n": 2, "p50_ms": "100", "p95_ms": "200", "reason": None})
        self.assertEqual(calibration["latency"]["warm"], {"n": 2, "p50_ms": "60", "p95_ms": "80", "reason": None})
        self.assertEqual(held_out["latency"]["cold"]["p50_ms"], "300")
        self.assertEqual(held_out["latency"]["warm"]["p95_ms"], "100")

    def test_cost_counts_unique_attempts_once_and_keeps_retry_distinct(self) -> None:
        report = project_results.project_bytes(FIXTURE.read_bytes())
        calibration_cost = cost_group(report, "calibration", "arm_a")
        held_out_cost = cost_group(report, "held_out", "arm_a")

        self.assertEqual(calibration_cost["unique_attempt_count"], 2)
        self.assertEqual(calibration_cost["attempt_attachment_count"], 29)
        self.assertEqual(calibration_cost["confirmed_attempt_claims"], 1)
        self.assertEqual(calibration_cost["estimated_attempt_claims"], 1)
        self.assertEqual(calibration_cost["aggregate_total"]["amount_minor"], 125)
        self.assertEqual(calibration_cost["aggregate_total"]["currency"], "USD")
        self.assertEqual(held_out_cost["unique_attempt_count"], 1)
        self.assertEqual(held_out_cost["aggregate_total"]["amount_minor"], 100)
        self.assertFalse(calibration_cost["authenticated"])

    def test_caller_approval_and_live_claims_are_untrusted(self) -> None:
        header, rows = load_fixture()
        self.assertTrue(all(header["owner_approval_claims"].values()))
        self.assertTrue(all(header["caller_claims"].values()))
        report = project_results.project_bytes(serialize(header, rows))

        self.assertEqual(report["data_integrity_status"], "clear")
        self.assertEqual(report["promotion_status"], "blocked")
        self.assertFalse(report["promotion_possible"])
        self.assertFalse(report["live_acceptance"])
        self.assertFalse(report["owner_approvals_authenticated"])

    def test_unknown_truth_token_is_visible_but_excluded_from_agreement(self) -> None:
        header, rows = load_fixture()
        row = next(
            row for row in rows
            if row["case_id"] == "cal_case_1" and row["arm"] == "arm_a" and row["question_id"] == "Q-EI-SOURCE-TYPE:v1"
        )
        row["truth"] = {"status": "unknown", "token": "synthetic-label-a"}
        set_declared_denominators(header, rows)
        report = project_results.project_bytes(serialize(header, rows))
        group = expected_group(report, "calibration", "arm_a", "Q-EI-SOURCE-TYPE:v1")

        self.assertEqual(group["denominator"]["observed_n"], 3)
        self.assertEqual(group["denominator"]["declared_n"], 3)
        self.assertEqual(group["denominator"]["exact_token_agreement"], {"numerator": 3, "denominator": 3})
        self.assertTrue(any(pair["truth_status"] == "unknown" and pair["truth_token"] == "synthetic-label-a" for pair in group["raw_label_pair_counts"]))

    def test_prediction_outage_is_retained_and_not_counted_as_agreement(self) -> None:
        header, rows = load_fixture()
        row = next(
            row for row in rows
            if row["case_id"] == "held_case_1" and row["arm"] == "arm_a" and row["question_id"] == "Q-EI-SOURCE-TYPE:v1"
        )
        row["prediction"] = {"status": "outage", "token": None}
        report = project_results.project_bytes(serialize(header, rows))
        group = expected_group(report, "held_out", "arm_a", "Q-EI-SOURCE-TYPE:v1")

        self.assertEqual(group["denominator"]["exact_token_agreement"], {"numerator": 3, "denominator": 4})
        self.assertEqual(group["prediction_status_counts"], {"label": 3, "outage": 1})
        self.assertTrue(any(item["code"] == "provider_outage_outcome_retained" for item in report["diagnostics"]))

    def test_declared_denominator_cannot_shrink_observed_records(self) -> None:
        header, rows = load_fixture()
        target = next(
            item for item in header["denominators"]
            if item["split"] == "calibration" and item["arm"] == "arm_a" and item["question_id"] == "Q-EI-SOURCE-TYPE:v1"
        )
        target["n"] = 1
        report = project_results.project_bytes(serialize(header, rows))
        group = expected_group(report, "calibration", "arm_a", "Q-EI-SOURCE-TYPE:v1")

        self.assertEqual(group["expected_observations"], 4)
        self.assertEqual(group["observed_observations"], 4)
        self.assertEqual(group["denominator"]["declared_n"], 1)
        self.assertEqual(group["denominator"]["observed_n"], 4)
        self.assertIsNone(group["denominator"]["exact_token_agreement"])
        self.assertEqual(group["denominator"]["reason"], "denominator_mismatch")

    def test_missing_rows_remain_in_expected_denominators(self) -> None:
        header, rows = load_fixture()
        rows = [
            row for row in rows
            if not (row["case_id"] == "cal_case_1" and row["arm"] == "arm_a" and row["question_id"] == "Q-EI-SOURCE-TYPE:v1")
        ]
        report = project_results.project_bytes(serialize(header, rows))
        group = expected_group(report, "calibration", "arm_a", "Q-EI-SOURCE-TYPE:v1")

        self.assertEqual(report["sample_counts"]["expected_observations"], 112)
        self.assertEqual(report["sample_counts"]["observed_expected_observations"], 111)
        self.assertEqual(group["expected_observations"], 4)
        self.assertEqual(group["missing_observations"], 1)
        self.assertEqual(group["denominator"]["reason"], "denominator_mismatch")
        self.assertEqual(report["data_integrity_status"], "blocked")
        cost = cost_group(report, "calibration", "arm_a")
        self.assertEqual(cost["coverage"]["status"], "incomplete")
        self.assertEqual(cost["coverage"]["missing_expected_observations"], 1)
        self.assertEqual(cost["aggregate_total"]["scope"], "unique_observed_billable_attempts")
        self.assertEqual(cost["aggregate_total"]["status"], "observed_attempt_subtotal_incomplete_coverage")
        self.assertEqual(cost["aggregate_total"]["amount_minor"], 100)

    def test_unknown_usage_and_unknown_cost_never_become_zero(self) -> None:
        header, rows = load_fixture()
        row = next(
            row for row in rows
            if row["case_id"] == "cal_case_1" and row["arm"] == "arm_a" and row["question_id"] == "Q-EI-SOURCE-TYPE:v1"
        )
        row["usage_state"] = "unknown"
        row["usage_attempts"] = []
        report = project_results.project_bytes(serialize(header, rows))
        group = cost_group(report, "calibration", "arm_a")

        self.assertEqual(group["unknown_usage_row_count"], 1)
        self.assertIsNone(group["aggregate_total"]["amount_minor"])
        self.assertEqual(group["aggregate_total"]["reason"], "unknown_or_unverified_usage_coverage")
        self.assertEqual(group["currency_breakdown"][0]["confirmed_minor"], 100)

    def test_currency_precision_and_aggregate_bounds_block_cost_total(self) -> None:
        header, rows = load_fixture()
        row = next(
            row for row in rows
            if row["case_id"] == "cal_case_1" and row["arm"] == "arm_a" and row["question_id"] == "Q-EI-SOURCE-TYPE:v1"
        )
        row["usage_attempts"].append({
            "attempt_id": "attempt-extra-high-cost",
            "batch_id": "batch-cal-arm_a-seed-1",
            "retry_of": None,
            "usage_status": "confirmed",
            "cost": {"currency": "USD", "precision": 3, "amount_minor": project_results.MAX_COST_MINOR},
        })
        report = project_results.project_bytes(serialize(header, rows))
        group = cost_group(report, "calibration", "arm_a")

        self.assertEqual(group["aggregate_total"]["reason"], "currency_precision_mismatch")
        self.assertIsNone(group["aggregate_total"]["amount_minor"])
        self.assertIsNone(group["currency_breakdown"][0]["precision"])
        self.assertTrue(any(item["code"] == "currency_precision_mismatch" for item in report["diagnostics"]))

        row["usage_attempts"][-1]["cost"]["precision"] = 2
        report = project_results.project_bytes(serialize(header, rows))
        group = cost_group(report, "calibration", "arm_a")
        self.assertEqual(group["aggregate_total"]["reason"], "aggregate_amount_out_of_bounds")
        self.assertIsNone(group["aggregate_total"]["amount_minor"])
        self.assertTrue(any(item["code"] == "cost_aggregate_out_of_bounds" for item in report["diagnostics"]))

    def test_global_attempt_and_batch_identity_cannot_cross_contexts(self) -> None:
        header, rows = load_fixture()
        row = next(
            row for row in rows
            if row["case_id"] == "held_case_1" and row["arm"] == "arm_a" and row["question_id"] == "Q-EI-SOURCE-TYPE:v1"
        )
        row["usage_attempts"][0]["batch_id"] = "batch-cal-arm_a-seed-1"

        with self.assertRaises(project_results.InputProblem) as caught:
            project_results.project_bytes(serialize(header, rows))
        self.assertEqual(caught.exception.code, "conflicting_attempt_identity")

        header, rows = load_fixture()
        row = next(
            row for row in rows
            if row["case_id"] == "cal_case_1" and row["arm"] == "arm_b" and row["question_id"] == "Q-EI-SOURCE-TYPE:v1"
        )
        row["usage_attempts"][0]["attempt_id"] = "attempt-cal-arm_a-seed-1"
        with self.assertRaises(project_results.InputProblem) as caught:
            project_results.project_bytes(serialize(header, rows))
        self.assertEqual(caught.exception.code, "conflicting_attempt_identity")

    def test_retry_cycles_are_rejected_iteratively(self) -> None:
        header, rows = load_fixture()
        first = rows[0]
        second = next(
            row for row in rows
            if row["case_id"] == "cal_case_1" and row["arm"] == "arm_a" and row["question_id"] == "Q-EI-RELEVANCE:v1"
        )
        first["usage_attempts"].append({
            "attempt_id": "cycle-attempt-a",
            "batch_id": "batch-cal-arm_a-seed-1",
            "retry_of": "cycle-attempt-b",
            "usage_status": "estimated",
            "cost": {"currency": "USD", "precision": 2, "amount_minor": 1},
        })
        second["usage_attempts"].append({
            "attempt_id": "cycle-attempt-b",
            "batch_id": "batch-cal-arm_a-seed-1",
            "retry_of": "cycle-attempt-a",
            "usage_status": "estimated",
            "cost": {"currency": "USD", "precision": 2, "amount_minor": 1},
        })

        with self.assertRaises(project_results.InputProblem) as caught:
            project_results.project_bytes(serialize(header, rows))
        self.assertEqual(caught.exception.code, "retry_lineage_cycle")

    def test_duplicate_keys_nonfinite_values_and_numeric_literals_fail_before_projection(self) -> None:
        fixture = FIXTURE.read_bytes()
        cases = (
            (b'{"contract":"ei.offline.normalized-results","contract":"other"}\n', "duplicate_json_key"),
            (fixture.replace(b'"latency_ms":100,', b'"latency_ms":NaN,', 1), "non_finite_number"),
            (fixture.replace(b'"latency_ms":100,', b'"latency_ms":12345678901234567890,', 1), "integer_literal_too_long"),
            (fixture.replace(b'"latency_ms":100,', b'"latency_ms":1e999999999,', 1), "decimal_literal_out_of_bounds"),
            (fixture.replace(b'"latency_ms":100,', b'"latency_ms":-1e999999999,', 1), "decimal_literal_out_of_bounds"),
            (fixture.replace(b'"latency_ms":100,', b'"latency_ms":1e-999999999,', 1), "decimal_literal_out_of_bounds"),
        )
        for data, expected_code in cases:
            with self.subTest(expected_code=expected_code, sample=data[:80]):
                with self.assertRaises(project_results.InputProblem) as caught:
                    project_results.project_bytes(data)
                self.assertEqual(caught.exception.code, expected_code)

    def test_numeric_magnitude_scale_and_literal_length_are_bounded(self) -> None:
        fixture = FIXTURE.read_bytes()
        cases = (
            (fixture.replace(b'"latency_ms":100,', b'"latency_ms":1e10,', 1), "decimal_literal_out_of_bounds"),
            (fixture.replace(b'"latency_ms":100,', b'"latency_ms":1.0000000,', 1), "decimal_literal_out_of_bounds"),
            (fixture.replace(b'"latency_ms":100,', b'"latency_ms":1.' + b'0' * 64 + b',', 1), "decimal_literal_too_long"),
            (fixture.replace(b'"amount_minor":100,', b'"amount_minor":9223372036854775808,', 1), "invalid_cost_amount"),
        )
        for data, expected_code in cases:
            with self.subTest(expected_code=expected_code, sample=data[:100]):
                with self.assertRaises(project_results.InputProblem) as caught:
                    project_results.project_bytes(data)
                self.assertEqual(caught.exception.code, expected_code)

    def test_input_bytes_lines_and_row_count_are_bounded(self) -> None:
        cases = (
            (b"x" * (project_results.MAX_INPUT_BYTES + 1), "input_too_large", None),
            (b"x" * (project_results.MAX_LINE_BYTES + 1), "line_too_large", 1),
            (b"{}\n" * (project_results.MAX_INPUT_ROWS + 2), "too_many_rows", None),
        )
        for data, expected_code, expected_line in cases:
            with self.subTest(expected_code=expected_code):
                with self.assertRaises(project_results.InputProblem) as caught:
                    project_results.project_bytes(data)
                self.assertEqual(caught.exception.code, expected_code)
                self.assertEqual(caught.exception.line, expected_line)

    def test_multiple_currencies_remain_separate(self) -> None:
        header, rows = load_fixture()
        row = next(
            row for row in rows
            if row["case_id"] == "cal_case_1" and row["arm"] == "arm_a" and row["question_id"] == "Q-EI-SOURCE-TYPE:v1"
        )
        row["usage_attempts"].append({
            "attempt_id": "attempt-eur-separate",
            "batch_id": "batch-cal-arm_a-seed-1",
            "retry_of": None,
            "usage_status": "estimated",
            "cost": {"currency": "EUR", "precision": 2, "amount_minor": 99},
        })
        report = project_results.project_bytes(serialize(header, rows))
        cost = cost_group(report, "calibration", "arm_a")

        self.assertEqual(cost["aggregate_total"]["reason"], "currency_mismatch")
        self.assertIsNone(cost["aggregate_total"]["amount_minor"])
        self.assertEqual(
            [(item["currency"], item["confirmed_minor"], item["estimated_minor"]) for item in cost["currency_breakdown"]],
            [("EUR", 0, 99), ("USD", 100, 25)],
        )

    def test_missing_cost_coverage_is_not_reported_as_a_full_run_total(self) -> None:
        header, rows = load_fixture()
        rows = [
            row for row in rows
            if not (row["case_id"] == "cal_case_1" and row["arm"] == "arm_a" and row["question_id"] == "Q-EI-SOURCE-TYPE:v1")
        ]
        report = project_results.project_bytes(serialize(header, rows))
        cost = cost_group(report, "calibration", "arm_a")

        self.assertEqual(cost["coverage"]["status"], "incomplete")
        self.assertEqual(cost["aggregate_total"]["scope"], "unique_observed_billable_attempts")
        self.assertEqual(cost["aggregate_total"]["status"], "observed_attempt_subtotal_incomplete_coverage")
        self.assertEqual(cost["aggregate_total"]["reason"], "expected_observation_coverage_incomplete")
        self.assertEqual(cost["aggregate_total"]["amount_minor"], 100)
        self.assertTrue(any(item["code"] == "expected_observation_coverage_incomplete" for item in report["diagnostics"]))

    def test_raw_text_failures_are_sanitized_and_cli_has_fixed_error_shape(self) -> None:
        header, rows = load_fixture()
        rows[0]["source_text"] = "PRIVATE_SOURCE_CANARY"
        data = serialize(header, rows)
        with tempfile.TemporaryDirectory(prefix="ei-projection-test-") as temporary:
            input_path = Path(temporary) / "input.jsonl"
            input_path.write_bytes(data)
            process = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(input_path)],
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(process.returncode, 2)
        self.assertEqual(process.stdout, "")
        self.assertEqual(json.loads(process.stderr), {"code": "invalid_object_shape", "line": 2, "status": "malformed"})
        self.assertNotIn("PRIVATE_SOURCE_CANARY", process.stderr)
        self.assertNotIn(str(input_path), process.stderr)

    def test_cli_extreme_exponent_returns_fixed_error_without_traceback(self) -> None:
        invalid = FIXTURE.read_bytes().replace(b'"latency_ms":100,', b'"latency_ms":1e999999999,', 1)
        with tempfile.TemporaryDirectory(prefix="ei-projection-exponent-") as temporary:
            input_path = Path(temporary) / "input.jsonl"
            input_path.write_bytes(invalid)
            process = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(input_path)],
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(process.returncode, 2)
        self.assertEqual(process.stdout, "")
        self.assertEqual(json.loads(process.stderr), {"code": "decimal_literal_out_of_bounds", "line": 2, "status": "malformed"})
        self.assertNotIn("Traceback", process.stderr)

    def test_bad_label_tokens_and_boolean_numbers_are_rejected(self) -> None:
        header, rows = load_fixture()
        rows[0]["truth"]["token"] = "PRIVATE SOURCE TEXT"
        with self.assertRaises(project_results.InputProblem) as caught:
            project_results.project_bytes(serialize(header, rows))
        self.assertEqual(caught.exception.code, "invalid_label_token")
        self.assertNotIn("PRIVATE SOURCE TEXT", str(caught.exception))

        header, rows = load_fixture()
        rows[0]["latency_ms"] = True
        with self.assertRaises(project_results.InputProblem) as caught:
            project_results.project_bytes(serialize(header, rows))
        self.assertEqual(caught.exception.code, "invalid_latency")

    def test_output_is_deterministic_and_cli_uses_nonzero_valid_blocked_status(self) -> None:
        fixture_bytes = FIXTURE.read_bytes()
        first = project_results.project_bytes(fixture_bytes)
        second = project_results.project_bytes(fixture_bytes)
        self.assertEqual(
            json.dumps(first, sort_keys=True, indent=2),
            json.dumps(second, sort_keys=True, indent=2),
        )
        with tempfile.TemporaryDirectory(prefix="ei-projection-cli-") as temporary:
            input_path = Path(temporary) / "input.jsonl"
            input_path.write_bytes(fixture_bytes)
            process = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(input_path)],
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(process.returncode, 3)
        self.assertEqual(process.stderr, "")
        self.assertEqual(json.loads(process.stdout)["promotion_status"], "blocked")

    def test_cli_argument_errors_are_fixed_code_and_help_remains_available(self) -> None:
        malformed = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--input",
                str(FIXTURE),
                "--unexpected",
                "ROOT_PRIVATE_CANARY",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(malformed.returncode, 2)
        self.assertEqual(malformed.stdout, "")
        self.assertEqual(
            json.loads(malformed.stderr),
            {"code": "invalid_cli_arguments", "status": "malformed"},
        )
        self.assertNotIn("ROOT_PRIVATE_CANARY", malformed.stderr)
        self.assertNotIn("--unexpected", malformed.stderr)

        missing = subprocess.run(
            [sys.executable, str(SCRIPT), "--output", "/private/ROOT_PRIVATE_CANARY.json"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(missing.returncode, 2)
        self.assertEqual(missing.stdout, "")
        self.assertEqual(
            json.loads(missing.stderr),
            {"code": "invalid_cli_arguments", "status": "malformed"},
        )
        self.assertNotIn("ROOT_PRIVATE_CANARY", missing.stderr)

        help_process = subprocess.run(
            [sys.executable, str(SCRIPT), "--help"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(help_process.returncode, 0)
        self.assertEqual(help_process.stderr, "")
        self.assertIn("usage:", help_process.stdout)
        self.assertIn("--input", help_process.stdout)


if __name__ == "__main__":
    unittest.main()
