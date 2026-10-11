from __future__ import annotations

import sys
import subprocess
import tempfile
import types
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import package_collateral as package  # noqa: E402


class PackagePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # This fixture audits the current candidate itself, which must remain
        # blocked even after the silent rehearsal render is joined.
        cls.current_manifest = package.build_manifest(ROOT)

    def test_current_candidate_keeps_package_and_submission_gates_separate_and_blocked(self) -> None:
        manifest = self.current_manifest
        self.assertEqual("BLOCKED", manifest["collateralPackageReadiness"]["decision"])
        self.assertEqual("BLOCKED", manifest["externalSubmissionReadiness"]["decision"])
        self.assertFalse(manifest["requiredSubmissionArtifact"]["exists"])
        self.assertIn("demo/exports/v1-demo.mp4", " ".join(manifest["externalSubmissionReadiness"]["blockers"]))
        self.assertEqual("pending", manifest["brandReferences"]["approvalStatus"])
        all_blockers = " ".join(manifest["collateralPackageReadiness"]["blockers"])
        self.assertRegex(all_blockers, r"inventory join is (?:stale|missing_join|missing_asset_record)")
        self.assertRegex(all_blockers, r"provenance and rights record is missing or not approved")
        video = next(asset for asset in manifest["assets"] if asset["assetId"] == "DEMO-REHEARSAL-VIDEO-001")
        self.assertEqual("exact_current_source_snapshot", video["renderReceipt"]["sourceInputStatus"])
        self.assertEqual([], video["renderReceipt"]["sourceInputErrors"])

    def test_controlled_approved_fixture_can_pass_both_gates(self) -> None:
        # Synthetic policy fixture only: this proves the gate logic, not actual
        # rights, package bytes, a human review, or submission evidence.
        record = self.approved_record()
        package_gate, submission_gate = package.evaluate_gates(
            [record],
            {
                "status": "draft_rehearsal_only",
                "rehearsalSatisfiesFinalDemoRequirement": False,
                "durationSeconds": 120,
                "maximumSeconds": 180,
                "scenes": [{"sceneId": "fixture-scene"}],
            },
            {"approvalStatus": "approved"},
            [],
            [],
            {"exists": True},
            [{"path": "fixture.md", "exists": True}],
            {"available": True, "status": "validated", "selected": [], "submission": []},
        )
        self.assertEqual("PASS", package_gate["decision"])
        self.assertEqual("PASS", submission_gate["decision"])

    def test_missing_or_partial_canonical_api_fails_both_readiness_gates_closed(self) -> None:
        api_stubs = (
            ("no canonical functions", types.SimpleNamespace()),
            (
                "selected only",
                types.SimpleNamespace(
                    validate_all=lambda *_: [],
                    selected_collateral_blockers=lambda *_: [],
                ),
            ),
        )
        for label, stub in api_stubs:
            with self.subTest(label=label), patch.dict(sys.modules, {"validate_collateral": stub}):
                canonical = package.canonical_readiness_blockers(ROOT, ["FIXTURE-001"])
                package_gate, submission_gate = package.evaluate_gates(
                    [self.approved_record()],
                    {
                        "status": "draft_rehearsal_only",
                        "rehearsalSatisfiesFinalDemoRequirement": False,
                        "durationSeconds": 120,
                        "maximumSeconds": 180,
                        "scenes": [{"sceneId": "fixture-scene"}],
                    },
                    {"approvalStatus": "approved"},
                    [],
                    [],
                    {"exists": True},
                    [{"path": "fixture.md", "exists": True}],
                    canonical,
                )
                self.assertFalse(canonical["available"])
                self.assertEqual("BLOCKED", package_gate["decision"])
                self.assertEqual("BLOCKED", submission_gate["decision"])
                self.assertIn("API is incomplete", " ".join(package_gate["blockers"]))
                self.assertIn("API is incomplete", " ".join(submission_gate["blockers"]))

    def test_global_validation_errors_stop_before_selected_readiness(self) -> None:
        calls = []
        stub = types.SimpleNamespace(
            validate_all=lambda *_: ["fixture structural error"],
            selected_collateral_blockers=lambda *_: calls.append("selected") or [],
            submission_blockers=lambda *_: calls.append("submission") or [],
        )
        with patch.dict(sys.modules, {"validate_collateral": stub}):
            result = package.canonical_readiness_blockers(ROOT, ["FIXTURE-001"])
        self.assertEqual("global_validation_failed", result["status"])
        self.assertIn("fixture structural error", result["selected"])
        self.assertIn("fixture structural error", result["submission"])
        self.assertEqual([], calls)

    def test_canonical_api_runs_global_checks_before_selected_and_submission_checks(self) -> None:
        calls = []
        stub = types.SimpleNamespace(
            validate_all=lambda *_: calls.append("global") or [],
            selected_collateral_blockers=lambda *_: calls.append("selected") or [],
            submission_blockers=lambda *_: calls.append("submission") or [],
        )
        with patch.dict(sys.modules, {"validate_collateral": stub}):
            result = package.canonical_readiness_blockers(ROOT, ["FIXTURE-001"])
        self.assertEqual("validated", result["status"])
        self.assertEqual(["global", "selected", "submission"], calls)

    def test_canonical_policy_exceptions_and_unsupported_returns_fail_closed(self) -> None:
        policy_stubs = (
            types.SimpleNamespace(
                validate_all=lambda *_: (_ for _ in ()).throw(RuntimeError("structural check failed")),
                selected_collateral_blockers=lambda *_: [],
                submission_blockers=lambda *_: [],
            ),
            types.SimpleNamespace(
                validate_all=lambda *_: [],
                selected_collateral_blockers=lambda *_: 7,
                submission_blockers=lambda *_: [],
            ),
        )
        for stub in policy_stubs:
            with patch.dict(sys.modules, {"validate_collateral": stub}):
                result = package.canonical_readiness_blockers(ROOT, ["FIXTURE-001"])
            self.assertFalse(result["available"])
            self.assertEqual("validation_error", result["status"])
            self.assertTrue(result["selected"])
            self.assertTrue(result["submission"])

    def test_pending_and_superseded_samples_are_rejected(self) -> None:
        for field, value in (("releaseStatus", "pending"), ("status", "superseded")):
            with self.subTest(field=field, value=value):
                record = self.approved_record()
                record[field] = value
                blockers = package.asset_release_blockers(record, today=date(2026, 10, 10))
                self.assertTrue(any("not approved" in item or "not releasable" in item for item in blockers))

    def test_unknown_expired_revoked_or_out_of_scope_rights_are_rejected(self) -> None:
        mutations = (
            ("unknown expiry", lambda record: record["provenance"].update(expiry=None), "expiry/review trigger is unknown"),
            ("expired", lambda record: record["provenance"].update(expiry="2026-10-09"), "expired on"),
            ("unknown rights", lambda record: record["provenance"].update(permissionStatus="not_recorded"), "destination permission is not_recorded"),
            ("revoked", lambda record: record["provenance"].update(permissionStatus="revoked"), "destination permission is revoked"),
            ("out of scope", lambda record: record["provenance"].update(approvedDestinations=["external-post"]), "exact candidate destination"),
        )
        for label, mutate, expected in mutations:
            with self.subTest(label=label):
                record = self.approved_record()
                mutate(record)
                blockers = package.asset_release_blockers(record, today=date(2026, 10, 10))
                self.assertTrue(any(expected in item for item in blockers), blockers)

    def test_missing_alt_claim_provenance_and_pending_selected_claim_are_rejected(self) -> None:
        record = self.approved_record()
        record["mediaClass"] = "visual"
        record["accessibleAlternative"] = {"exists": False, "status": "missing"}
        record["provenance"].update(recordId=None, status="missing_record", permissionStatus="not_recorded")
        record["claimReferences"] = [{"id": "CLAIM-MISSING", "status": "missing_from_current_ledger"}]
        record["ctaReferences"] = []
        record["proposedWordingReferences"] = []
        blockers = package.asset_release_blockers(record, today=date(2026, 10, 10))
        combined = " ".join(blockers)
        self.assertIn("accessible alternative, captions, or transcript link is missing", combined)
        self.assertIn("provenance and rights record is missing or not approved", combined)
        self.assertIn("CLAIM-MISSING: selected claim is missing from the current claims ledger", combined)

    def test_claim_scope_only_checks_references_present_on_selected_asset(self) -> None:
        selected = {
            "claimReferences": [
                {
                    "id": "CLAIM-SELECTED",
                    "status": "current",
                    "reviewStatus": "approved",
                    "source": {"revision": "a" * 40},
                }
            ],
            "ctaReferences": [],
            "proposedWordingReferences": [],
        }
        self.assertEqual([], package.selected_claim_blockers(selected))
        context = {
            "sceneById": {
                "picked": {"claimIDs": ["CLAIM-SELECTED"], "ctaIDs": [], "proposalIDs": [], "sourcePinIds": []},
                "unselected": {"claimIDs": ["CLAIM-GUARDRAIL"], "ctaIDs": ["CTA-UNUSED"], "proposalIDs": [], "sourcePinIds": []},
            }
        }
        refs = package._references_for_scenes(context, ["picked"])
        self.assertEqual(["CLAIM-SELECTED"], refs["claimIds"])
        self.assertEqual([], refs["ctaIds"])

    def test_caption_sidecars_require_exact_text_and_stay_within_one_scene(self) -> None:
        scenes = [
            {"sceneId": "one", "startSeconds": 0, "endSeconds": 10, "captionText": "Context."},
            {"sceneId": "two", "startSeconds": 10, "endSeconds": 20, "captionText": "Review."},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            caption = root / "captions.srt"
            caption.write_text(
                "1\n00:00:00,000 --> 00:00:04,000\nContext.\n\n"
                "2\n00:00:10,000 --> 00:00:13,000\nReview.\n",
                encoding="utf-8",
            )
            self.assertEqual([], package.validate_caption_content(root, "captions.srt", scenes))
            caption.write_text(
                "1\n00:00:09,500 --> 00:00:10,500\nContext.\n\n"
                "2\n00:00:10,500 --> 00:00:13,000\nReview.\n",
                encoding="utf-8",
            )
            errors = package.validate_caption_content(root, "captions.srt", scenes)
            self.assertTrue(any("exactly one timed scene" in item for item in errors))

    def test_package_integrity_detects_source_or_export_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "source.md").write_bytes(b"source bytes\n")
            (root / "package.md").write_bytes(b"source bytes\n")
            digest = package.sha256_file(root / "source.md")
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Package Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "package-test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", "source.md"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "fixture source"], check=True)
            source_commit = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip()
            manifest = {
                "assets": [
                    {
                        "file": {"path": "source.md", "exists": True, "sha256": digest, "sourceCommitId": source_commit},
                        "packageCopy": {"path": "package.md", "expectedSha256": digest},
                        "source": {"path": "source.md", "sha256": digest, "sourceCommitId": source_commit},
                        "renderReceipt": {},
                    }
                ],
                "captionSidecars": [],
                "requiredSubmissionArtifact": {"exists": False},
            }
            self.assertEqual([], package.validate_manifest_files(root, manifest))
            (root / "package.md").write_bytes(b"changed package bytes\n")
            (root / "source.md").write_bytes(b"changed source bytes\n")
            errors = package.validate_manifest_files(root, manifest)
            self.assertTrue(any("packaged SHA-256 does not match" in item for item in errors))
            self.assertTrue(any("source SHA-256 differs from manifest" in item for item in errors))

    def test_render_receipt_detects_changed_source_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "storyboard.md"
            source.write_bytes(b"rendered source\n")
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Package Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "package-test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", "storyboard.md"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "render source"], check=True)
            commit = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip()
            receipt = {
                "sourceCommit": commit,
                "sourcePaths": ["storyboard.md"],
                "fileHashes": [{"path": "storyboard.md", "sha256": package.sha256_file(source)}],
            }
            self.assertEqual([], package.validate_receipt_sources(root, receipt))
            source.write_bytes(b"edited after render\n")
            errors = package.validate_receipt_sources(root, receipt)
            self.assertTrue(any("current bytes differ from the source snapshot used for rendering" in item for item in errors))

    def test_duplicate_package_target_is_a_hard_collision(self) -> None:
        manifest = {
            "assets": [
                {"packageCopy": {"path": "release/assets/same.png"}},
                {"packageCopy": {"path": "release/assets/same.png"}},
            ],
            "captionSidecars": [],
        }
        self.assertEqual(["duplicate package output path: release/assets/same.png"], package.package_path_collisions(manifest))

    def test_draft_manifest_refresh_archives_prior_bytes_but_approved_manifest_is_immutable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            relative = "release/v0.1.0-rehearsal/manifest.json"
            target = root / relative
            first = {"packageVersion": "v0.1.0-rehearsal", "releaseClass": "draft_rehearsal_only", "lifecycleState": "draft_rehearsal_only", "generation": 1}
            second = {**first, "generation": 2}
            encoded_first = package.json.dumps(first, indent=2) + "\n"
            encoded_second = package.json.dumps(second, indent=2) + "\n"
            self.assertIsNone(package.persist_draft_manifest(root, target, first, encoded_first))
            archived = package.persist_draft_manifest(root, target, second, encoded_second)
            self.assertIsNotNone(archived)
            self.assertEqual(first, package.read_json(root / archived))
            self.assertEqual(second, package.read_json(target))
            approved = {**second, "releaseClass": "approved"}
            with self.assertRaises(ValueError):
                package.persist_draft_manifest(root, target, approved, package.json.dumps(approved))

    def test_package_name_encodes_asset_variant_and_destination_without_overwriting_legacy_source(self) -> None:
        spec = package.read_json(ROOT / "release/v0.1.0-rehearsal/package-spec.json")
        row = next(item for item in spec["assets"] if item["assetId"] == "DEMO-RECORDING-CHECKLIST-001")
        name = package.package_filename(row, ROOT / row["path"], {"status": "not_applicable"}, spec)
        self.assertEqual(
            "demo-001-demo-recording-checklist-001-r01-repository-internal-review-text-en-us-rehearsal-recording-plan.md",
            name,
        )
        self.assertTrue((ROOT / row["path"]).is_file())

    @staticmethod
    def approved_record() -> dict:
        digest = "a" * 64
        commit = "b" * 40
        return {
            "recordId": "FIXTURE-001",
            "assetId": "FIXTURE-001",
            "releaseStatus": "approved",
            "status": "approved",
            "mediaClass": "text",
            "file": {"exists": True, "sha256": digest, "sourceCommitId": commit, "sourcePinStatus": "pinned"},
            "packageCopy": {"path": "package/fixture.md", "exists": True, "expectedSha256": digest, "byteIdenticalToSource": True},
            "inventoryJoin": {"status": "current"},
            "source": {"lineagePaths": []},
            "accessibleAlternative": {"exists": False},
            "provenance": {
                "recordId": "FIXTURE-RIGHTS-001",
                "status": "approved",
                "permissionStatus": "approved",
                "allowedDestinations": ["internal-review"],
                "approvedDestinations": ["internal-review"],
                "expiry": "2027-10-10",
                "reviewer": "Synthetic reviewer fixture",
                "reviewDate": "2026-10-10",
            },
            "destinations": {"candidateInternalUse": "internal-review", "permittedReuseDestinations": ["internal-review"]},
            "approval": {"status": "approved", "reviewerIdentity": "Synthetic reviewer fixture", "approvalDate": "2026-10-10"},
            "claimReferences": [],
            "ctaReferences": [],
            "proposedWordingReferences": [],
            "renderReceipt": {"status": "not_required"},
        }


if __name__ == "__main__":
    unittest.main()
