from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY / "tools"))

import verify_handoff as checker  # noqa: E402


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


class HandoffCheckerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.manifest_path = self.root / "tests/contracts/handoff-manifest.json"
        self.component_path = self.root / "release/component-manifest.json"
        self.manifest = json.loads((REPOSITORY / "tests/contracts/handoff-manifest.json").read_text())
        self.components = json.loads((REPOSITORY / "release/component-manifest.json").read_text())
        _write_json(self.manifest_path, self.manifest)
        _write_json(self.component_path, self.components)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def save_manifest(self) -> None:
        _write_json(self.manifest_path, self.manifest)

    def audit(self, kind: str) -> dict:
        return checker.audit(self.root, "tests/contracts/handoff-manifest.json", kind)

    @staticmethod
    def checks(report: dict, check_id: str) -> list[dict]:
        return [item for item in report["checks"] if item["id"] == check_id]

    def test_checked_in_manifest_is_pending_for_all_four_scopes(self) -> None:
        for kind in checker.KINDS:
            with self.subTest(kind=kind):
                report = self.audit(kind)
                self.assertEqual(report["readiness_status"], "BLOCKED")
                self.assertEqual(report["exit_code"], 1)
                self.assertFalse(report["ready"])
                self.assertTrue(any(item["id"] == "trusted-evidence-verifier" for item in report["missing_deliverables"]))

    def test_each_scope_reports_an_omitted_artifact_and_fixture(self) -> None:
        for kind, spec in checker.HANDOFF_SPECS.items():
            with self.subTest(kind=kind, item="artifact"):
                self.manifest["handoffs"][kind]["artifacts"].pop(next(iter(spec.artifacts)))
                self.save_manifest()
                report = self.audit(kind)
                self.assertEqual(report["exit_code"], 2)
                self.assertTrue(any(item["id"].startswith("artifact:") for item in report["missing_deliverables"]))
                self.manifest["handoffs"][kind]["artifacts"] = {
                    artifact_id: {
                        "identity": artifact.identity,
                        "component": artifact.component,
                        "owner_role": artifact.owner_role,
                        "required_review_roles": list(artifact.review_roles),
                        "status": "pending",
                        "revision": None,
                        "mode": "unknown",
                        "role_claims": [],
                        "usage": {"status": "unknown", "amount": None, "currency": None, "basis_ref": None},
                        "evidence": None,
                    }
                    for artifact_id, artifact in spec.artifacts.items()
                }
                self.save_manifest()

            with self.subTest(kind=kind, item="fixture"):
                self.manifest["handoffs"][kind]["fixtures"].pop(next(iter(spec.fixtures)))
                self.save_manifest()
                report = self.audit(kind)
                self.assertEqual(report["exit_code"], 2)
                self.assertTrue(any(item["id"].startswith("fixture:") for item in report["missing_deliverables"]))
                self.manifest = json.loads((REPOSITORY / "tests/contracts/handoff-manifest.json").read_text())
                self.save_manifest()

    def test_malformed_json_duplicate_nonfinite_float_depth_and_count_fail(self) -> None:
        for raw in (
            b'{"x":1,"x":2}',
            b'{"x":NaN}',
            b'{"x":Infinity}',
            b'{"x":1.25}',
            (b"[" * (checker.MAX_JSON_DEPTH + 1)) + b"0" + (b"]" * (checker.MAX_JSON_DEPTH + 1)),
            json.dumps(list(range(checker.MAX_JSON_ARRAY_ITEMS + 1))).encode(),
            json.dumps({f"k{i}": i for i in range(checker.MAX_JSON_OBJECT_MEMBERS + 1)}).encode(),
        ):
            with self.subTest(raw=raw[:40]):
                with self.assertRaises(checker.InputProblem):
                    checker._parse_json(raw, "test input")

    def test_boolean_schema_version_is_not_an_integer(self) -> None:
        self.manifest["schema_version"] = True
        self.save_manifest()
        report = self.audit("handoff-contracts")
        self.assertEqual(report["exit_code"], 2)
        self.assertEqual(self.checks(report, "manifest.version")[0]["status"], "invalid")

    def test_boolean_retry_limit_is_not_an_integer(self) -> None:
        provider = next(item for item in self.components["provider_surfaces"] if item["id"] == "jev")
        provider["retry_limit"] = True
        _write_json(self.component_path, self.components)
        report = self.audit("provider-readiness")
        self.assertTrue(any(item["id"].endswith(".retry_limit") and item["status"] == "invalid" for item in report["checks"]))

    def test_mock_provider_record_does_not_satisfy_readiness(self) -> None:
        provider = next(item for item in self.components["provider_surfaces"] if item["id"] == "jev")
        provider["status"] = "recorded"
        provider["mode"] = "mock"
        _write_json(self.component_path, self.components)
        report = self.audit("provider-readiness")
        item = self.checks(report, "provider-readiness.provider.jev")[0]
        self.assertEqual(item["status"], "missing")
        self.assertNotEqual(report["readiness_status"], "READY")

    def test_oversized_manifest_and_evidence_are_rejected(self) -> None:
        self.manifest_path.write_bytes(b" " * (checker.MAX_MANIFEST_BYTES + 1))
        report = self.audit("handoff-contracts")
        self.assertEqual(report["exit_code"], 2)
        self.assertIn("manifest.read", [item["id"] for item in report["checks"]])

        evidence = self.root / "tests/contracts/evidence/oversized.bin"
        evidence.parent.mkdir(parents=True, exist_ok=True)
        evidence.write_bytes(b"x" * (checker.MAX_EVIDENCE_BYTES + 1))
        with self.assertRaises(checker.InputProblem):
            checker._read_local_file(
                self.root,
                "tests/contracts/evidence/oversized.bin",
                max_bytes=checker.MAX_EVIDENCE_BYTES,
                allowed_prefixes=checker.EVIDENCE_PREFIXES["handoff-contracts"],
            )

    def test_unsafe_paths_and_symlink_traversal_are_rejected(self) -> None:
        evidence_dir = self.root / "tests/contracts/evidence"
        evidence_dir.mkdir(parents=True)
        ordinary = evidence_dir / "ordinary.json"
        ordinary.write_text("{}", encoding="utf-8")
        for unsafe in ("../outside", "/tmp/outside", "tests\\contracts\\evidence\\ordinary.json", "tests//contracts/evidence/ordinary.json"):
            with self.subTest(path=unsafe):
                with self.assertRaises(checker.InputProblem):
                    checker._read_local_file(self.root, unsafe, max_bytes=256)

        outside = self.root / "outside"
        outside.mkdir()
        (outside / "leak.json").write_text("{}", encoding="utf-8")
        (evidence_dir / "link.json").symlink_to(outside / "leak.json")
        with self.assertRaises(checker.InputProblem):
            checker._read_local_file(self.root, "tests/contracts/evidence/link.json", max_bytes=256)

        safe_parent = self.root / "tests/providers"
        safe_parent.mkdir(parents=True)
        (safe_parent / "evidence").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(checker.InputProblem):
            checker._read_local_file(self.root, "tests/providers/evidence/leak.json", max_bytes=256)

    def test_hardlinked_evidence_is_rejected(self) -> None:
        evidence_dir = self.root / "tests/contracts/evidence"
        evidence_dir.mkdir(parents=True)
        source = evidence_dir / "source.json"
        source.write_text("{}", encoding="utf-8")
        alias = evidence_dir / "alias.json"
        os.link(source, alias)
        with self.assertRaisesRegex(checker.InputProblem, "hard-linked"):
            checker._read_local_file(self.root, "tests/contracts/evidence/alias.json", max_bytes=256)

    def test_hash_mismatch_and_positive_integrity_never_authenticate_claims(self) -> None:
        evidence = self.root / "tests/contracts/evidence/receipt.json"
        evidence.parent.mkdir(parents=True)
        raw = b'{"synthetic":true}\n'
        evidence.write_bytes(raw)
        report = {"checks": [], "missing_deliverables": []}
        self.assertTrue(checker._validate_evidence_ref(
            self.root,
            {"path": "tests/contracts/evidence/receipt.json", "sha256": hashlib.sha256(raw).hexdigest()},
            label="synthetic",
            kind="handoff-contracts",
            report=report,
        ))
        self.assertIn({"id": "synthetic.trust", "expected": "accepted external evidence verifier", "actual": "bytes matched; signer, role, meaning and conformance not authenticated", "status": "untrusted"}, report["checks"])
        self.assertNotIn("pass", [item["status"] for item in report["checks"] if item["id"] == "synthetic.trust"])

        report = {"checks": [], "missing_deliverables": []}
        self.assertFalse(checker._validate_evidence_ref(
            self.root,
            {"path": "tests/contracts/evidence/receipt.json", "sha256": "0" * 64},
            label="tampered",
            kind="handoff-contracts",
            report=report,
        ))
        self.assertEqual(self.checks(report, "tampered.sha256")[0]["status"], "mismatch")

    def test_evidence_reference_count_is_bounded_per_run(self) -> None:
        evidence = self.root / "tests/contracts/evidence/receipt.json"
        evidence.parent.mkdir(parents=True)
        raw = b"synthetic\n"
        evidence.write_bytes(raw)
        reference = {"path": "tests/contracts/evidence/receipt.json", "sha256": hashlib.sha256(raw).hexdigest()}
        report = {"checks": [], "missing_deliverables": [], "evidence_refs_checked": 0}
        for index in range(checker.MAX_EVIDENCE_REFS):
            self.assertTrue(checker._validate_evidence_ref(
                self.root, reference, label=f"receipt-{index}", kind="handoff-contracts", report=report,
            ))
        self.assertFalse(checker._validate_evidence_ref(
            self.root, reference, label="overflow", kind="handoff-contracts", report=report,
        ))
        self.assertEqual(report["evidence_refs_checked"], checker.MAX_EVIDENCE_REFS + 1)
        self.assertEqual(self.checks(report, "overflow.evidence_ref_count")[0]["status"], "invalid")

    def test_skipped_fixture_is_missing_coverage_and_mock_consumer_is_rejected(self) -> None:
        consumer = self.manifest["handoffs"]["handoff-consumer"]
        fixture = consumer["fixtures"]["actual_consumer_revision_not_local_double"]
        fixture["status"] = "skipped"
        fixture["case_count"] = 0
        fixture["mode"] = "mock"
        self.save_manifest()
        report = self.audit("handoff-consumer")
        self.assertEqual(self.checks(report, "handoff-consumer.fixtures.actual_consumer_revision_not_local_double.status")[0]["status"], "missing")
        self.assertEqual(self.checks(report, "handoff-consumer.fixtures.actual_consumer_revision_not_local_double.mode")[0]["status"], "missing")
        self.assertTrue(any(item["id"] == "fixture:actual_consumer_revision_not_local_double" for item in report["missing_deliverables"]))

        fixture["status"] = "reported_pass"
        fixture["case_count"] = 0
        fixture["subject_kind"] = "local_double"
        self.save_manifest()
        report = self.audit("handoff-consumer")
        self.assertEqual(self.checks(report, "handoff-consumer.fixtures.actual_consumer_revision_not_local_double.subject_kind")[0]["status"], "mismatch")
        self.assertEqual(self.checks(report, "handoff-consumer.fixtures.actual_consumer_revision_not_local_double.case_count")[0]["status"], "fail")
        self.assertNotEqual(report["readiness_status"], "READY")

    def test_boolean_case_count_is_not_one_executed_case(self) -> None:
        fixture = self.manifest["handoffs"]["provider-readiness"]["fixtures"]["readiness_is_nonbillable_or_limitation_is_explicit"]
        fixture["status"] = "reported_pass"
        fixture["case_count"] = True
        self.save_manifest()
        report = self.audit("provider-readiness")
        self.assertEqual(self.checks(report, "provider-readiness.fixtures.readiness_is_nonbillable_or_limitation_is_explicit.case_count")[0]["status"], "invalid")

    def test_revision_mismatch_blocks_fixture_even_when_commit_strings_are_well_formed(self) -> None:
        component = next(item for item in self.components["components"] if item["id"] == "shared-contracts")
        component["accepted_revision"] = "a" * 40
        component["state"] = "pinned"
        _write_json(self.component_path, self.components)
        fixture = self.manifest["handoffs"]["handoff-contracts"]["fixtures"]["choice_score_noul_shapes_and_noul_has_no_confidence"]
        fixture["revision_pins"]["shared-contracts"] = "b" * 40
        self.save_manifest()
        report = self.audit("handoff-contracts")
        pin_check = self.checks(report, "handoff-contracts.fixtures.choice_score_noul_shapes_and_noul_has_no_confidence.revision_pins.shared-contracts")[0]
        self.assertEqual(pin_check["status"], "mismatch")
        self.assertEqual(report["readiness_status"], "INVALID")

    def test_untrusted_approval_and_role_strings_never_count_as_proof(self) -> None:
        handoff = self.manifest["handoffs"]["handoff-contracts"]
        handoff["crosswalk"]["scope_approval_fields"]["resolution"] = "approved"
        self.save_manifest()
        report = self.audit("handoff-contracts")
        self.assertEqual(self.checks(report, "handoff-contracts.crosswalk.scope_approval_fields.resolution")[0]["status"], "untrusted")
        self.assertIsNone(self.manifest["evidence_verifier_id"])
        self.assertNotEqual(report["readiness_status"], "READY")

    def test_unknown_usage_cannot_be_zero_or_boolean(self) -> None:
        for amount in ("0", 0, False):
            with self.subTest(amount=amount):
                report = {"checks": [], "missing_deliverables": []}
                valid = checker._validate_usage(
                    {"status": "unknown", "amount": amount, "currency": None, "basis_ref": None},
                    "usage",
                    report,
                )
                self.assertFalse(valid)
                self.assertEqual(self.checks(report, "usage.unknown_is_not_zero")[0]["status"], "invalid")

    def test_known_program_epic_url_is_a_reference_check_not_execution_proof(self) -> None:
        crosswalk = self.manifest["handoffs"]["handoff-consumer"]["crosswalk"]["program_epic_reference"]
        crosswalk["resolution"] = "https://github.com/Jevelopers-neatHack-2026/agent-harness/issues/3"
        self.save_manifest()
        report = self.audit("handoff-consumer")
        check = self.checks(report, "handoff-consumer.crosswalk.program_epic_reference.resolution")[0]
        self.assertEqual(check["status"], "untrusted")
        self.assertNotEqual(report["readiness_status"], "READY")


if __name__ == "__main__":
    unittest.main()
