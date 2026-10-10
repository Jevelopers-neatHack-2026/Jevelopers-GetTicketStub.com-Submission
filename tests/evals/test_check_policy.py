from __future__ import annotations

import contextlib
import hashlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EVALS = ROOT / "evals"
sys.path.insert(0, str(EVALS))

import check_policy  # noqa: E402


POLICY = EVALS / "policies" / "promotion-v1.json"
MANIFEST = EVALS / "corpus" / "manifest.json"


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def write_json(path: Path, value: object) -> None:
    path.write_bytes(canonical_json(value))


def write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_bytes(b"".join(canonical_json(row) for row in rows))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class CheckPolicyTests(unittest.TestCase):
    def test_fixture_policy_is_structural_but_promotion_blocked(self) -> None:
        report = check_policy.validate(POLICY, MANIFEST)
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["status"], "blocked")
        self.assertFalse(report["promotion_eligible"])
        actual = report["expected_vs_actual"]
        self.assertEqual(actual["case_counts"]["actual"], {"calibration": 10, "held_out": 10})
        self.assertEqual(actual["case_counts"]["required_minimum"], {"calibration": 120, "held_out": 240})
        self.assertEqual(actual["question_count"], 7)
        fact_support = next(q for q in json.loads(POLICY.read_text(encoding="utf-8"))["required_questions"] if q["id"] == "Q-EI-FACT-SUPPORT:v1")
        self.assertIn("eligible_adequate_evidence_automatic_coverage", fact_support["required_metrics"])
        self.assertEqual(fact_support["candidate_thresholds"]["eligible_adequate_evidence_automatic_coverage_min"], 0.60)
        self.assertEqual(actual["non_english_held_out"]["actual"], 8)
        self.assertTrue(actual["non_english_held_out"]["includes_cjk"])
        self.assertEqual(actual["non_english_held_out"]["language_counts"], {"de": 2, "es": 2, "fr": 2, "ja": 2})
        self.assertEqual(actual["held_out_scenario_families"]["ordinary"]["actual"], 1)
        self.assertEqual(actual["held_out_scenario_families"]["ordinary"]["required_minimum"], 20)
        self.assertEqual(len(actual["question_label_coverage"]["held_out"]), 7)
        for question in actual["question_label_coverage"]["held_out"].values():
            self.assertIn("denominator_definition", question)
            self.assertGreater(question["positive_count"], 0)
            self.assertGreater(question["negative_count"], 0)
            self.assertGreater(question["unknown_count"], 0)
        self.assertTrue(any("held_out contains 10 cases; required minimum is 240" == blocker for blocker in report["promotion_blockers"]))
        self.assertTrue(any("No trusted owner-role signing keys" in blocker for blocker in report["promotion_blockers"]))
        self.assertGreaterEqual(len(report["promotion_blockers"]), 5)

    def test_cli_distinguishes_structural_validation_from_promotion(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            validate_only = check_policy.main([
                "--policy", str(POLICY), "--corpus", str(MANIFEST), "--validate-only",
            ])
        self.assertEqual(validate_only, 0)
        self.assertIn('"promotion_eligible": false', output.getvalue())
        with contextlib.redirect_stdout(io.StringIO()):
            promotion = check_policy.main(["--policy", str(POLICY), "--corpus", str(MANIFEST)])
        self.assertEqual(promotion, 2)

    def test_split_family_leakage_is_rejected_after_consistent_relocking(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(EVALS / "corpus", root / "corpus")
            manifest_path = root / "corpus" / "manifest.json"
            observations_path = root / "corpus" / "observations.jsonl"
            lock_path = root / "corpus" / "split-lock.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            observations = [json.loads(line) for line in observations_path.read_text(encoding="utf-8").splitlines()]
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            calibration = next(row for row in lock["case_assignments"] if row["split"] == "calibration")
            held_out = next(row for row in lock["case_assignments"] if row["split"] == "held_out")
            held_out["source_family_id"] = calibration["source_family_id"]
            observation = next(row for row in observations if row["case_id"] == held_out["case_id"])
            observation["source_family_id"] = held_out["source_family_id"]
            write_jsonl(observations_path, observations)
            lock["observations_sha256"] = digest(observations_path)
            lock["assignment_sha256"] = check_policy.assignment_digest(lock["case_assignments"])
            write_json(lock_path, lock)
            manifest["artifacts"]["observations"]["sha256"] = digest(observations_path)
            manifest["artifacts"]["split_lock"]["sha256"] = digest(lock_path)
            manifest["split_lock"]["assignment_sha256"] = lock["assignment_sha256"]
            write_json(manifest_path, manifest)
            report = check_policy.validate(POLICY, manifest_path)
            self.assertTrue(any("split leakage" in error for error in report["errors"]))

    def test_repeated_held_out_case_use_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(EVALS / "corpus", root / "corpus")
            manifest_path = root / "corpus" / "manifest.json"
            lock_path = root / "corpus" / "split-lock.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            case_id = next(row["case_id"] for row in lock["case_assignments"] if row["split"] == "held_out")
            lock["held_out_usage"] = {
                "status": "consumed",
                "evaluation_runs": [
                    {"run_id": "run-a", "case_ids": [case_id]},
                    {"run_id": "run-b", "case_ids": [case_id]},
                ],
            }
            write_json(lock_path, lock)
            manifest["artifacts"]["split_lock"]["sha256"] = digest(lock_path)
            manifest["split_lock"]["held_out_consumed"] = True
            write_json(manifest_path, manifest)
            report = check_policy.validate(POLICY, manifest_path)
            self.assertTrue(any("held-out reuse detected" in error for error in report["errors"]))

    def test_missing_question_label_is_rejected_even_if_artifact_hash_is_updated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(EVALS / "corpus", root / "corpus")
            manifest_path = root / "corpus" / "manifest.json"
            labels_path = root / "corpus" / "labels.jsonl"
            lock_path = root / "corpus" / "split-lock.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            labels = [json.loads(line) for line in labels_path.read_text(encoding="utf-8").splitlines()]
            del labels[0]["labels"]["Q-EI-INJECTION:v1"]
            write_jsonl(labels_path, labels)
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            lock["labels_sha256"] = digest(labels_path)
            write_json(lock_path, lock)
            manifest["artifacts"]["labels"]["sha256"] = digest(labels_path)
            manifest["artifacts"]["split_lock"]["sha256"] = digest(lock_path)
            write_json(manifest_path, manifest)
            report = check_policy.validate(POLICY, manifest_path)
            self.assertTrue(any("missing or invalid label for Q-EI-INJECTION:v1" in error for error in report["errors"]))

    def test_authored_source_projection_is_checked_even_when_hashes_are_updated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(EVALS / "corpus", root / "corpus")
            manifest_path = root / "corpus" / "manifest.json"
            source_path = root / "corpus" / "authored-cases.jsonl"
            lock_path = root / "corpus" / "split-lock.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            source = [json.loads(line) for line in source_path.read_text(encoding="utf-8").splitlines()]
            source[0]["content"] += " Altered after materialization."
            write_jsonl(source_path, source)
            manifest["artifacts"]["authored_cases"]["sha256"] = digest(source_path)
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            lock["source_cases_sha256"] = digest(source_path)
            write_json(lock_path, lock)
            manifest["artifacts"]["split_lock"]["sha256"] = digest(lock_path)
            write_json(manifest_path, manifest)
            report = check_policy.validate(POLICY, manifest_path)
            self.assertTrue(any("observation differs from the author-authored source projection" in error for error in report["errors"]))

    def test_artifact_paths_cannot_escape_corpus_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(EVALS / "corpus", root / "corpus")
            manifest_path = root / "corpus" / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["artifacts"]["authored_cases"]["path"] = "../policies/promotion-v1.json"
            write_json(manifest_path, manifest)
            report = check_policy.validate(POLICY, manifest_path)
            self.assertTrue(any("path must remain inside the corpus directory" in error for error in report["errors"]))

    def test_unsupported_manifest_major_version_is_rejected_actionably(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(EVALS / "corpus", root / "corpus")
            manifest_path = root / "corpus" / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["manifest_version"] = "2.0.0"
            write_json(manifest_path, manifest)
            report = check_policy.validate(POLICY, manifest_path)
            self.assertTrue(any("unsupported manifest schema version" in error for error in report["errors"]))

    def test_missing_asset_rights_status_is_rejected_even_after_rehashing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(EVALS / "corpus", root / "corpus")
            manifest_path = root / "corpus" / "manifest.json"
            observations_path = root / "corpus" / "observations.jsonl"
            lock_path = root / "corpus" / "split-lock.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            observations = [json.loads(line) for line in observations_path.read_text(encoding="utf-8").splitlines()]
            observations[0]["asset_rights_status"] = None
            write_jsonl(observations_path, observations)
            manifest["artifacts"]["observations"]["sha256"] = digest(observations_path)
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            lock["observations_sha256"] = digest(observations_path)
            write_json(lock_path, lock)
            manifest["artifacts"]["split_lock"]["sha256"] = digest(lock_path)
            write_json(manifest_path, manifest)
            report = check_policy.validate(POLICY, manifest_path)
            self.assertTrue(any("asset rights status is missing or unsafe" in error for error in report["errors"]))

    def test_personal_data_in_authored_source_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(EVALS / "corpus", root / "corpus")
            manifest_path = root / "corpus" / "manifest.json"
            source_path = root / "corpus" / "authored-cases.jsonl"
            lock_path = root / "corpus" / "split-lock.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            source = [json.loads(line) for line in source_path.read_text(encoding="utf-8").splitlines()]
            source[0]["content"] += " Contact: sample.person@example.com."
            write_jsonl(source_path, source)
            manifest["artifacts"]["authored_cases"]["sha256"] = digest(source_path)
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            lock["source_cases_sha256"] = digest(source_path)
            write_json(lock_path, lock)
            manifest["artifacts"]["split_lock"]["sha256"] = digest(lock_path)
            write_json(manifest_path, manifest)
            report = check_policy.validate(POLICY, manifest_path)
            self.assertTrue(any("possible personal data or external URL detected" in error for error in report["errors"]))

    def test_duplicate_fixture_content_is_not_counted_as_independent_cases(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(EVALS / "corpus", root / "corpus")
            manifest_path = root / "corpus" / "manifest.json"
            source_path = root / "corpus" / "authored-cases.jsonl"
            lock_path = root / "corpus" / "split-lock.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            source = [json.loads(line) for line in source_path.read_text(encoding="utf-8").splitlines()]
            source[1]["content"] = source[0]["content"]
            write_jsonl(source_path, source)
            manifest["artifacts"]["authored_cases"]["sha256"] = digest(source_path)
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            lock["source_cases_sha256"] = digest(source_path)
            write_json(lock_path, lock)
            manifest["artifacts"]["split_lock"]["sha256"] = digest(lock_path)
            write_json(manifest_path, manifest)
            report = check_policy.validate(POLICY, manifest_path)
            self.assertTrue(any("duplicate normalized observation content" in error for error in report["errors"]))

    def test_non_finite_and_boolean_numeric_targets_are_rejected(self) -> None:
        for constant in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(constant=constant), tempfile.TemporaryDirectory() as directory:
                policy_path = Path(directory) / "policy.json"
                raw = POLICY.read_text(encoding="utf-8").replace('"amount": 5.0', f'"amount": {constant}', 1)
                policy_path.write_text(raw, encoding="utf-8")
                report = check_policy.validate(policy_path, MANIFEST)
                self.assertTrue(any(f"non-finite JSON number is forbidden: {constant}" in error for error in report["errors"]))
                self.assertFalse(report["promotion_eligible"])

        with tempfile.TemporaryDirectory() as directory:
            policy_path = Path(directory) / "policy.json"
            policy = json.loads(POLICY.read_text(encoding="utf-8"))
            policy["quality_cost_tradeoff"]["minimum_quality_gain_absolute"] = True
            write_json(policy_path, policy)
            report = check_policy.validate(policy_path, MANIFEST)
            self.assertTrue(any("quality_cost_tradeoff must declare numeric gain" in error for error in report["errors"]))
            self.assertFalse(report["promotion_eligible"])

    def test_unverified_approval_object_cannot_flip_policy_to_approved(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            policy_path = Path(directory) / "policy.json"
            policy = json.loads(POLICY.read_text(encoding="utf-8"))
            policy["policy_status"] = "approved"
            policy["approval_records"][0].update({
                "status": "approved",
                "approved_by": "local-claim",
                "approval_reference": "copied-receipt-hash",
            })
            write_json(policy_path, policy)
            report = check_policy.validate(policy_path, MANIFEST)
            self.assertTrue(any("policy_status must remain proposed_unapproved" in error for error in report["errors"]))
            self.assertTrue(any("unauthenticated approver claim" in error for error in report["errors"]))
            self.assertFalse(report["promotion_eligible"])

    def test_staged_run_plan_and_total_cost_cap_are_checked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            policy_path = Path(directory) / "policy.json"
            policy = json.loads(POLICY.read_text(encoding="utf-8"))
            plan = policy["comparison"]["bounded_run_plan"]
            plan["jev"]["maximum_input_tokens_total_including_retries"] += 10000
            write_json(policy_path, policy)
            report = check_policy.validate(policy_path, MANIFEST)
            self.assertTrue(any("JEV maximum_input_tokens_total_including_retries is inconsistent" in error for error in report["errors"]))
            policy["comparison"]["bounded_run_plan"]["jev"]["maximum_input_tokens_total_including_retries"] -= 10000
            policy["cost_and_latency_targets"]["comparison_total_cost_cap"]["amount"] = 45.0
            write_json(policy_path, policy)
            report = check_policy.validate(policy_path, MANIFEST)
            self.assertTrue(any("total comparison cap must equal required arms" in error for error in report["errors"]))
            policy["cost_and_latency_targets"]["comparison_total_cost_cap"]["amount"] = 10800.0
            policy["provider_candidates"]["generative_baseline"]["input_rate_usd_per_million_tokens"] = 0.0
            write_json(policy_path, policy)
            report = check_policy.validate(policy_path, MANIFEST)
            self.assertTrue(any("unknown rates must remain null rather than a zero-price assumption" in error for error in report["errors"]))


if __name__ == "__main__":
    unittest.main()
