from __future__ import annotations

import os
import sys
import subprocess
import tempfile
import types
import unittest
import contextlib
import io
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
        present_assets = [asset for asset in manifest["assets"] if asset.get("file", {}).get("exists")]
        self.assertTrue(present_assets)
        self.assertTrue(all(asset.get("inventoryJoin", {}).get("status") == "current" for asset in present_assets))
        self.assertRegex(all_blockers, r"provenance and rights record is missing or not approved")
        self.assertRegex(all_blockers, r"selected exact wording review is (?:blocked|pending)")
        video = next(asset for asset in manifest["assets"] if asset["assetId"] == "DEMO-REHEARSAL-VIDEO-001")
        self.assertEqual("exact_current_source_snapshot", video["renderReceipt"]["sourceInputStatus"])
        self.assertEqual([], video["renderReceipt"]["sourceInputErrors"])
        for relative in package.POLICY_JSON_BINDINGS:
            support = next(row for row in manifest["supportFiles"] if row.get("path") == relative)
            policy_input = manifest["policyInputHashes"][relative]
            self.assertEqual(support["binding"], policy_input["binding"])
            self.assertEqual(support["sha256"], policy_input["sha256"])

    def test_package_copy_provenance_references_are_exact_and_destination_scoped(self) -> None:
        manifest = self.current_manifest
        package_copies = [
            record["packageCopy"]
            for record in [*manifest["assets"], *manifest["captionSidecars"]]
            if record.get("packageCopy", {}).get("path")
        ]
        package_copies.extend(
            dependency["packageCopy"]
            for record in manifest["assets"]
            for dependency in record.get("compositionDependencies", [])
        )
        self.assertTrue(package_copies)
        for copy in package_copies:
            self.assertEqual("joined_exact_bytes", copy["provenance"]["status"], copy["path"])
            self.assertEqual(copy["path"], copy["provenance"]["source"]["path"])
            self.assertEqual(copy["expectedSha256"], copy["provenance"]["source"]["sha256"])
            self.assertEqual(
                manifest["destinations"]["internalReview"],
                copy["provenance"]["permission"]["approvedDestinations"][0],
            )

        tampered = package.json.loads(package.json.dumps(manifest))
        selected_copy = next(item["packageCopy"] for item in tampered["assets"] if item.get("packageCopy", {}).get("path"))
        selected_copy["provenance"]["recordId"] = "PROV-FILE-UNKNOWN"
        errors = package.validate_manifest_files(ROOT, tampered)
        self.assertTrue(any("inventory/provenance copy reference is stale or altered" in item for item in errors), errors)

        selected_copy["provenance"] = None
        errors = package.validate_manifest_files(ROOT, tampered)
        self.assertTrue(any("exact inventory/provenance copy reference is missing" in item for item in errors), errors)

    def test_manifest_binds_direct_readiness_inputs_and_discovery_census(self) -> None:
        manifest = self.current_manifest
        support_by_path = {row["path"]: row for row in manifest["supportFiles"]}
        for relative in (
            "tools/validate_collateral.py",
            "review/fixtures/synthetic-canaries.json",
            "demo/exports/rehearsal-render-plan.json",
        ):
            with self.subTest(input=relative):
                self.assertTrue(support_by_path[relative]["exists"])
                self.assertRegex(support_by_path[relative]["sha256"], r"^[0-9a-f]{64}$")
                self.assertRegex(support_by_path[relative]["sourceCommitId"], r"^[0-9a-f]{40}$")

        census = manifest["sourceDiscovery"]
        self.assertEqual(package.SOURCE_DISCOVERY_ALGORITHM, census["algorithm"])
        roots = {row["rootKey"]: row for row in census["roots"]}
        self.assertEqual({"videoRoot", "captionRoot", "reviewRoot"}, set(roots))
        for record in roots.values():
            self.assertEqual(sorted(set(record["extensions"])), record["extensions"])
            self.assertEqual(sorted(set(record["paths"])), record["paths"])

    def test_source_discovery_detects_candidate_only_video_caption_and_receipt_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "baseline.txt").write_text("candidate baseline\n", encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Package Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "package-test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "discovery roots are empty"], check=True)
            empty_commit = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip()
            cases = (
                ("videoRoot", "demo/exports", [".mp4"], "demo/exports/rehearsal.mp4"),
                ("captionRoot", "demo/captions", [".srt", ".vtt"], "demo/captions/rehearsal.srt"),
                ("reviewRoot", "review/visual/rehearsal", [".json"], "review/visual/rehearsal/extra.json"),
            )
            for _, _, _, path in cases:
                file_path = root / path
                file_path.parent.mkdir(parents=True, exist_ok=True)
                file_path.write_text(f"synthetic discovery input: {path}\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "discovery inputs added"], check=True)
            present_commit = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip()
            for _, _, _, path in cases:
                (root / path).unlink()
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "discovery inputs removed"], check=True)

            for root_key, directory, extensions, path in cases:
                with self.subTest(root=root_key):
                    census = {"algorithm": package.SOURCE_DISCOVERY_ALGORITHM, "roots": [{
                        "rootKey": root_key,
                        "root": directory,
                        "extensions": extensions,
                        "paths": [],
                    }]}
                    self.assertEqual([], package.source_discovery_snapshot_errors(root, empty_commit, census))
                    errors = package.source_discovery_snapshot_errors(root, present_commit, census)
                    self.assertIn(f"candidate-only=['{path}']", errors[0])

    def test_source_snapshot_census_binds_all_inventory_tracked_blobs_and_selfpairs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest_path = f"release/{package.DEFAULT_VERSION}/manifest.json"
            source_bytes = {
                "tracked.txt": b"exact tracked source\n",
                "messaging/claims.json": b'{"claims":[]}\n',
                manifest_path: b'{"releaseClass":"draft_rehearsal_only"}\n',
            }
            for relative, content in source_bytes.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)

            rows = [
                {"path": "docs/collateral-inventory.json", "exists": True, "sha256": None, "provenanceRecordId": "PROV-FILE-E018FDB8D981"},
                {"path": "messaging/claims.json", "exists": True, "sha256": None, "provenanceRecordId": "MSG-CLAIMS-001"},
                {"path": "review/provenance.json", "exists": True, "sha256": None},
                {"path": manifest_path, "exists": True, "sha256": package.sha256_bytes(source_bytes[manifest_path]), "provenanceRecordId": "HANDOFF-MANIFEST-001"},
                {"path": "tracked.txt", "exists": True, "sha256": package.sha256_bytes(source_bytes["tracked.txt"])},
            ]
            inventory = {"schemaVersion": "1.0", "trackedFiles": rows}
            inventory_path = root / package.SOURCE_INVENTORY_PATH
            inventory_path.parent.mkdir(parents=True, exist_ok=True)
            inventory_bytes = (package.json.dumps(inventory, indent=2) + "\n").encode("utf-8")
            inventory_path.write_bytes(inventory_bytes)
            inventory_digest = package.sha256_bytes(inventory_bytes)
            claims_digest = package.sha256_bytes(source_bytes["messaging/claims.json"])
            provenance_records = []
            for identifier, relative, digest in (
                ("HANDOFF-MANIFEST-001", manifest_path, package.sha256_bytes(source_bytes[manifest_path])),
                ("PROV-FILE-E018FDB8D981", package.SOURCE_INVENTORY_PATH, inventory_digest),
                ("MSG-CLAIMS-001", "messaging/claims.json", claims_digest),
            ):
                provenance_records.append({
                    "assetId": identifier,
                    "source": {
                        "repo": "Jevelopers-neatHack-2026/marketing-material",
                        "path": relative,
                        "revision": f"sha256:{digest}",
                        "url": None,
                    },
                    "checksum": {"algorithm": "SHA-256", "value": digest},
                })
            provenance_path = root / package.SOURCE_PROVENANCE_PATH
            provenance_path.parent.mkdir(parents=True, exist_ok=True)
            provenance_path.write_text(
                package.json.dumps({"schemaVersion": "1.0", "records": provenance_records}, indent=2) + "\n",
                encoding="utf-8",
            )

            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Package Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "package-test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "complete tracked source census"], check=True)
            candidate = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip()
            tree, error = package.git_tree_entries(root, candidate)
            self.assertIsNone(error)
            self.assertEqual([], package.source_inventory_snapshot_errors(root, tree))

            (root / "extra.txt").write_text("candidate-only tracked file\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(root), "add", "extra.txt"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "unindexed tracked source"], check=True)
            extra_commit = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip()
            tree, error = package.git_tree_entries(root, extra_commit)
            self.assertIsNone(error)
            errors = package.source_inventory_snapshot_errors(root, tree)
            self.assertTrue(any("candidate-only=['extra.txt']" in item for item in errors), errors)

            (root / "tracked.txt").write_bytes(b"different exact source bytes\n")
            (root / "extra.txt").unlink()
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "inventory checksum mismatch"], check=True)
            changed_commit = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip()
            tree, error = package.git_tree_entries(root, changed_commit)
            self.assertIsNone(error)
            errors = package.source_inventory_snapshot_errors(root, tree)
            self.assertIn("candidate source inventory checksum does not match candidate bytes: tracked.txt", errors)

    def test_canonical_blocker_normalization_is_stable_across_iteration_order(self) -> None:
        blockers = ["rights pending", "claim review pending", "source pin missing"]
        expected = sorted(blockers)
        self.assertEqual(expected, package._normalise_policy_blockers(blockers))
        self.assertEqual(expected, package._normalise_policy_blockers(tuple(reversed(blockers))))
        self.assertEqual(expected, package._normalise_policy_blockers(set(blockers)))

    def test_fresh_gate_outputs_are_stable_across_python_hash_seeds(self) -> None:
        script = (
            "import json, sys; sys.path.insert(0, 'tools'); import package_collateral as p; "
            "m = p.build_manifest(p.ROOT, materialized=False); "
            "keys = ('collateralPackageReadiness', 'externalSubmissionReadiness'); "
            "gates = {'canonicalPolicySelectedAssetIds': m['buildDiagnostics']['canonicalPolicySelectedAssetIds'], "
            "'readiness': {name: {field: m[name].get(field) for field in ('decision', 'scope', 'blockers')} "
            "for name in keys}}; "
            "print(json.dumps(gates, "
            "sort_keys=True, separators=(',', ':')))"
        )
        outputs = []
        for seed in ("1", "2"):
            env = os.environ.copy()
            env["PYTHONHASHSEED"] = seed
            completed = subprocess.run(
                [sys.executable, "-c", script],
                cwd=ROOT,
                env=env,
                check=True,
                capture_output=True,
                text=True,
            )
            outputs.append(completed.stdout)
        self.assertEqual(outputs[0], outputs[1])

    def test_forged_manifest_pass_is_rejected_against_current_gate_recomputation(self) -> None:
        cached = package.json.loads(package.json.dumps(self.current_manifest))
        for field in ("collateralPackageReadiness", "externalSubmissionReadiness"):
            cached[field]["decision"] = "PASS"
            cached[field]["blockers"] = []
        errors = package.readiness_cache_errors(cached, self.current_manifest)
        self.assertIn("cached collateral package readiness decision differs from current source and policy evaluation", errors)
        self.assertIn("cached collateral package readiness blockers differs from current source and policy evaluation", errors)
        self.assertIn("cached external submission readiness decision differs from current source and policy evaluation", errors)

    def test_manifest_snapshot_rejects_omitted_duplicate_and_rebound_records(self) -> None:
        current = self.current_manifest
        mutations = {
            "assets": lambda value: value.update(assets=[]),
            "caption sidecars": lambda value: value.update(captionSidecars=[]),
            "rehearsal evidence": lambda value: value.update(rehearsalEvidenceFiles=[]),
            "support files": lambda value: value.update(supportFiles=[]),
            "policy input hashes": lambda value: value.update(policyInputHashes={}),
            "scene records": lambda value: value.update(scenes={**value["scenes"], "scenes": []}),
            "duplicate asset": lambda value: value["assets"].append(package.json.loads(package.json.dumps(value["assets"][0]))),
            "changed source binding": lambda value: value["assets"][0]["file"].update(sha256="0" * 64),
            "changed package path": lambda value: value["assets"][0]["packageCopy"].update(path="release/elsewhere/renamed.bin"),
            "changed support binding": lambda value: value["supportFiles"][0].update(sha256="0" * 64),
        }
        for label, mutate in mutations.items():
            with self.subTest(record=label):
                changed = package.json.loads(package.json.dumps(current))
                mutate(changed)
                errors = package.manifest_snapshot_errors(changed, current)
                self.assertTrue(any("authoritative current package snapshot" in error for error in errors), errors)

    def test_manifest_snapshot_allows_valid_ready_timestamps_to_vary(self) -> None:
        cached = package.json.loads(package.json.dumps(self.current_manifest))
        current = package.json.loads(package.json.dumps(self.current_manifest))
        for field in ("collateralPackageReadiness", "externalSubmissionReadiness"):
            for manifest, timestamp in ((cached, "2026-10-10T12:00:00+00:00"), (current, "2026-10-10T12:00:01Z")):
                manifest[field]["decision"] = "PASS"
                manifest[field]["blockers"] = []
                manifest[field]["readyAtUtc"] = timestamp
        self.assertEqual([], package.manifest_snapshot_errors(cached, current))

        cached["collateralPackageReadiness"]["readyAtUtc"] = "2026-10-10T12:00:00-04:00"
        errors = package.manifest_snapshot_errors(cached, current)
        self.assertIn("collateralPackageReadiness.readyAtUtc must be a valid UTC timestamp when the current decision is PASS", errors)

    def test_source_snapshot_must_exist_be_ancestor_and_contain_bound_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "input.txt").write_text("snapshot bytes\n", encoding="utf-8")
            spec_path = root / "release" / package.DEFAULT_VERSION / "package-spec.json"
            spec_path.parent.mkdir(parents=True)
            spec_path.write_text('{"assetRevision":"r01"}\n', encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Package Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "package-test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", "input.txt", str(spec_path.relative_to(root))], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "input snapshot"], check=True)
            candidate = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip()
            digest = package.sha256_file(root / "input.txt")
            spec_digest = package.sha256_file(spec_path)
            cached = {"packageVersion": package.DEFAULT_VERSION, "candidateSourceCommitAtGeneration": candidate}
            current = {
                "assets": [{"file": {"exists": True, "path": "input.txt", "sha256": digest}}],
                "supportFiles": [],
                "sourceDiscovery": {"algorithm": package.SOURCE_DISCOVERY_ALGORITHM, "roots": []},
                "policyInputHashes": {
                    f"release/{package.DEFAULT_VERSION}/package-spec.json": {
                        "path": f"release/{package.DEFAULT_VERSION}/package-spec.json",
                        "exists": True,
                        "sha256": spec_digest,
                    }
                },
            }
            self.assertEqual([], package.source_snapshot_errors(root, cached, current))

            wrong_binding = {"assets": [{"file": {"exists": True, "path": "input.txt", "sha256": "0" * 64}}]}
            wrong_binding.update(
                supportFiles=[],
                sourceDiscovery={"algorithm": package.SOURCE_DISCOVERY_ALGORITHM, "roots": []},
                policyInputHashes={},
            )
            self.assertIn(
                "candidate source snapshot input differs from manifest binding: input.txt",
                package.source_snapshot_errors(root, cached, wrong_binding),
            )
            conflicting_binding = package.json.loads(package.json.dumps(current))
            conflicting_binding["supportFiles"] = [{"path": "input.txt", "sha256": "1" * 64}]
            self.assertIn(
                "candidate source snapshot has conflicting manifest bindings for: input.txt",
                package.source_snapshot_errors(root, cached, conflicting_binding),
            )
            missing_commit = {**cached, "candidateSourceCommitAtGeneration": "f" * 40}
            self.assertIn(
                "candidateSourceCommitAtGeneration does not identify an existing commit",
                package.source_snapshot_errors(root, missing_commit, current),
            )

            spec_path.write_text('{"assetRevision":"r02"}\n', encoding="utf-8")
            subprocess.run(["git", "-C", str(root), "add", str(spec_path.relative_to(root))], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "package spec r02"], check=True)
            current["policyInputHashes"][f"release/{package.DEFAULT_VERSION}/package-spec.json"]["sha256"] = package.sha256_file(spec_path)
            self.assertIn(
                f"candidate source snapshot input differs from manifest binding: release/{package.DEFAULT_VERSION}/package-spec.json",
                package.source_snapshot_errors(root, cached, current),
            )

            subprocess.run(["git", "-C", str(root), "checkout", "--orphan", "independent"], check=True, capture_output=True)
            (root / "independent.txt").write_text("other history\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "independent history"], check=True)
            self.assertIn(
                "candidateSourceCommitAtGeneration is not an ancestor of the current source snapshot",
                package.source_snapshot_errors(root, cached, current),
            )

    def test_recorded_source_pins_validate_across_merge_and_rebuild_from_generation_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            version = "v0.0.0-merge-pin-test"
            source_path = root / "source.txt"
            source_path.write_text("base bytes\n", encoding="utf-8")
            spec_path = root / "release" / version / "package-spec.json"
            spec_path.parent.mkdir(parents=True)
            spec_path.write_text(
                package.json.dumps({
                    "packageVersion": version,
                    "releaseClass": "draft_rehearsal_only",
                    "assetRevision": "r01",
                    "assets": [],
                    "supportRecords": ["source.txt"],
                    "internalDestination": "repository-internal-review",
                }, indent=2) + "\n",
                encoding="utf-8",
            )
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Package Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "package-test@example.invalid"], check=True)

            def git(*args: str) -> str:
                result = subprocess.run(
                    ["git", "-C", str(root), *args], check=True, capture_output=True, text=True
                )
                return result.stdout.strip()

            def commit(message: str) -> str:
                git("add", "-A")
                git("commit", "-qm", message)
                return git("rev-parse", "HEAD")

            base_commit = commit("base source")
            git("checkout", "-b", "package-head")
            source_path.write_text("same final bytes\n", encoding="utf-8")
            package_pin = commit("package branch source")
            (root / "generation-marker.txt").write_text("recorded generation snapshot\n", encoding="utf-8")
            generation_commit = commit("record package generation snapshot")
            head_manifest = package.build_manifest(root, version=version)
            support = head_manifest["supportFiles"][0]
            self.assertEqual("source.txt", support["path"])
            self.assertEqual(package_pin, support["sourceCommitId"])
            self.assertEqual([], package.recompute_manifest_readiness(root, head_manifest)[1])

            pin_manifest = {
                "packageVersion": version,
                "releaseClass": "other",
                "candidateSourceCommitAtGeneration": generation_commit,
                "assets": [],
                "captionSidecars": [],
                "supportFiles": [package.json.loads(package.json.dumps(support))],
                "policyInputHashes": {},
                "rehearsalEvidenceFiles": [],
                "scenes": {"scenes": []},
            }
            self.assertEqual([], package.validate_manifest_files(root, pin_manifest))

            git("checkout", "-b", "main-parent", base_commit)
            source_path.write_text("same final bytes\n", encoding="utf-8")
            main_pin = commit("main branch records same source bytes")
            git("merge", "--no-ff", "package-head", "-m", "merge package branch with identical source tree")
            merge_commit = git("rev-parse", "HEAD")
            self.assertEqual("same final bytes\n", source_path.read_text(encoding="utf-8"))
            self.assertEqual(main_pin, package.committed_source(root, "source.txt", package.sha256_file(source_path))["commitId"])
            self.assertNotEqual(package_pin, main_pin)

            rebuilt = package.build_manifest(root, version=version, source_snapshot_commit=generation_commit)
            self.assertEqual(package.json.dumps(head_manifest, sort_keys=True), package.json.dumps(rebuilt, sort_keys=True))
            self.assertEqual([], package.manifest_snapshot_errors(head_manifest, rebuilt))
            self.assertEqual([], package.validate_manifest_files(root, pin_manifest))
            self.assertEqual([], package.recompute_manifest_readiness(root, head_manifest)[1])

            git("checkout", "--orphan", "unrelated-history")
            git("rm", "-rf", ".")
            source_path.write_text("same final bytes\n", encoding="utf-8")
            git("add", "source.txt")
            git("commit", "-qm", "unrelated source with identical bytes")
            unreachable_pin = git("rev-parse", "HEAD")
            git("checkout", "--detach", merge_commit)

            invalid_cases = {
                "malformed option-like revision": "--output=/tmp/package-pin-test",
                "missing commit": "f" * 40,
                "non-commit object": git("rev-parse", f"{package_pin}:source.txt"),
                "reachable after generation only": main_pin,
                "unreachable matching-blob commit": unreachable_pin,
                "wrong source bytes": base_commit,
            }
            for label, source_revision in invalid_cases.items():
                with self.subTest(source_pin=label):
                    changed = package.json.loads(package.json.dumps(pin_manifest))
                    changed["supportFiles"][0]["sourceCommitId"] = source_revision
                    errors = package.validate_manifest_files(root, changed)
                    self.assertTrue(any("recorded source" in error or "exact checksum-bound" in error for error in errors), errors)

            changed_path = package.json.loads(package.json.dumps(pin_manifest))
            changed_path["supportFiles"][0]["path"] = "missing-source.txt"
            errors = package.validate_manifest_files(root, changed_path)
            self.assertTrue(any("missing" in error for error in errors), errors)

            changed_hash = package.json.loads(package.json.dumps(pin_manifest))
            changed_hash["supportFiles"][0]["sha256"] = "0" * 64
            errors = package.validate_manifest_files(root, changed_hash)
            self.assertTrue(any("SHA-256" in error or "checksum" in error for error in errors), errors)

            source_path.write_text("modified after delivery\n", encoding="utf-8")
            try:
                errors = package.validate_manifest_files(root, pin_manifest)
                self.assertTrue(any("SHA-256" in error or "bytes differ" in error for error in errors), errors)
            finally:
                source_path.write_text("same final bytes\n", encoding="utf-8")
            self.assertEqual(merge_commit, git("rev-parse", "HEAD"))

    def test_rebuild_rejects_option_like_generation_revision_before_git_use(self) -> None:
        forged = {
            "packageVersion": package.DEFAULT_VERSION,
            "candidateSourceCommitAtGeneration": "--output=/tmp/package-rebuild-must-not-write",
        }
        with patch.object(package, "git", side_effect=AssertionError("invalid revision must be rejected before Git runs")) as git_call:
            current, errors = package.recompute_manifest_readiness(Path("."), forged)
        self.assertEqual({}, current)
        self.assertTrue(any("generation source commit is malformed" in error for error in errors), errors)
        git_call.assert_not_called()

    def test_source_snapshot_binds_declared_absence_at_generation_commit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "baseline.txt").write_text("candidate baseline\n", encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Package Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "package-test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "declared source paths are absent"], check=True)
            absent_commit = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip()

            def empty_manifest():
                return {
                    "assets": [],
                    "captionSidecars": [],
                    "supportFiles": [],
                    "policyInputHashes": {},
                    "sourceDiscovery": {"algorithm": package.SOURCE_DISCOVERY_ALGORITHM, "roots": []},
                    "rehearsalEvidenceFiles": [],
                    "requiredSubmissionArtifact": {},
                    "scenes": {"scenes": []},
                }

            def add_missing_fact(manifest, kind, path):
                if kind == "asset.file":
                    manifest["assets"].append({"file": {"path": path, "exists": False, "sha256": None}})
                elif kind == "asset.source":
                    manifest["assets"].append({"source": {"path": path, "sha256": None, "sourcePinStatus": "missing"}})
                elif kind == "asset.source_pin":
                    manifest["assets"].append({"sourcePins": [{"localFile": {"path": path, "exists": False, "sha256": None}}]})
                elif kind == "asset.package_copy":
                    manifest["assets"].append({"packageCopy": {"path": path, "exists": False, "expectedSha256": None}})
                elif kind == "asset.alt":
                    manifest["assets"].append({"accessibleAlternative": {"path": path, "exists": False, "sha256": None}})
                elif kind == "asset.render_receipt":
                    manifest["assets"].append({"renderReceipt": {"path": path, "status": "missing", "sha256": None}})
                elif kind == "dependency.source":
                    manifest["assets"].append({"compositionDependencies": [{"source": {"path": path, "sourcePinStatus": "missing", "sha256": None}}]})
                elif kind == "dependency.package_copy":
                    manifest["assets"].append({"compositionDependencies": [{"packageCopy": {"path": path, "exists": False, "expectedSha256": None}}]})
                elif kind == "caption.file":
                    manifest["captionSidecars"].append({"path": path, "exists": False, "sha256": None})
                elif kind == "caption.package_copy":
                    manifest["captionSidecars"].append({"packageCopy": {"path": path, "exists": False, "expectedSha256": None}})
                elif kind == "support":
                    manifest["supportFiles"].append({"path": path, "exists": False, "sha256": None})
                elif kind == "policy":
                    manifest["policyInputHashes"][path] = {"path": path, "exists": False, "sha256": None}
                elif kind == "evidence":
                    manifest["rehearsalEvidenceFiles"].append({"path": path, "exists": False, "sha256": None})
                elif kind == "required":
                    manifest["requiredSubmissionArtifact"] = {"path": path, "exists": False, "sha256": None}
                elif kind == "scene.asset":
                    manifest["scenes"]["scenes"].append({"assetPath": path, "assetSha256": None})
                elif kind == "scene.source_pin":
                    manifest["scenes"]["scenes"].append({"sourcePins": [{"localFile": {"path": path, "exists": False, "sha256": None}}]})
                else:
                    self.fail(f"unhandled missing-source test kind: {kind}")

            cases = [
                ("asset.file", "demo/missing-export.svg"),
                ("asset.source", "demo/sources/missing-editable.svg"),
                ("asset.source_pin", "messaging/missing-source.json"),
                ("asset.package_copy", "release/missing-asset.bin"),
                ("asset.alt", "demo/alternatives/missing-alt.md"),
                ("asset.render_receipt", "review/visual/missing-render.json"),
                ("dependency.source", "demo/diagrams/missing-dependency.svg"),
                ("dependency.package_copy", "release/context/missing-dependency.svg"),
                ("caption.file", "demo/captions/missing.srt"),
                ("caption.package_copy", "release/captions/missing.srt"),
                ("support", "review/missing-support.md"),
                ("policy", "review/missing-policy.json"),
                ("evidence", "review/visual/missing-evidence.png"),
                ("required", "demo/exports/v1-demo.mp4"),
                ("scene.asset", "demo/screenshots/missing-scene.png"),
                ("scene.source_pin", "demo/sources/missing-scene-input.md"),
            ]
            absent_facts = empty_manifest()
            for kind, path in cases:
                add_missing_fact(absent_facts, kind, path)
            cached = {
                "packageVersion": package.DEFAULT_VERSION,
                "candidateSourceCommitAtGeneration": absent_commit,
            }
            self.assertEqual([], package.source_snapshot_errors(root, cached, absent_facts))

            content_by_path = {}
            for _, path in cases:
                file_path = root / path
                file_path.parent.mkdir(parents=True, exist_ok=True)
                content = f"candidate generation contained {path}\n".encode("utf-8")
                content_by_path[path] = content
                file_path.write_bytes(content)
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "declared missing paths were present"], check=True)
            present_commit = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip()
            for _, path in cases:
                (root / path).unlink()
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "declared missing paths removed"], check=True)
            forged_generation = {**cached, "candidateSourceCommitAtGeneration": present_commit}
            for kind, path in cases:
                with self.subTest(source_fact=kind):
                    one_fact = empty_manifest()
                    add_missing_fact(one_fact, kind, path)
                    errors = package.source_snapshot_errors(root, forged_generation, one_fact)
                    self.assertIn(
                        f"candidate source snapshot contains manifest-declared-absent input: {path}",
                        errors,
                    )

            stale_receipt = empty_manifest()
            stale_receipt["assets"].append({"renderReceipt": {
                "path": "review/visual/missing-render.json",
                "status": "missing_or_stale_output_hash",
                "sha256": package.sha256_bytes(content_by_path["review/visual/missing-render.json"]),
            }})
            self.assertEqual([], package.source_snapshot_errors(root, forged_generation, stale_receipt))

    def test_validate_cli_rejects_manifest_that_omits_required_records(self) -> None:
        omitted = package.json.loads(package.json.dumps(self.current_manifest))
        omitted["supportFiles"] = []
        with tempfile.TemporaryDirectory() as temporary:
            manifest_path = Path(temporary) / "omitted-manifest.json"
            manifest_path.write_text(package.json.dumps(omitted), encoding="utf-8")
            stderr = io.StringIO()
            argv = ["package_collateral.py", "validate", str(manifest_path), "--root", str(ROOT)]
            with patch.object(sys, "argv", argv), \
                 patch.object(package, "validate_manifest_files", return_value=[]), \
                 patch.object(package, "verify_caption_receipt_records", return_value=[]), \
                 contextlib.redirect_stderr(stderr):
                self.assertEqual(1, package._cli())
            self.assertIn("manifest differs from the authoritative current package snapshot", stderr.getvalue())

    def test_validate_cli_uses_recomputed_gates_for_forged_and_required_pass(self) -> None:
        current = self.current_manifest
        forged = package.json.loads(package.json.dumps(current))
        for field in ("collateralPackageReadiness", "externalSubmissionReadiness"):
            forged[field]["decision"] = "PASS"
            forged[field]["blockers"] = []
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(package.json.dumps(forged), encoding="utf-8")
            with patch.object(sys, "argv", ["package_collateral.py", "validate", str(manifest_path), "--root", str(root)]), \
                 patch.object(package, "validate_manifest_files", return_value=[]), \
                 patch.object(package, "verify_caption_receipt_records", return_value=[]), \
                 patch.object(package, "recompute_manifest_readiness", return_value=(current, package.readiness_cache_errors(forged, current))), \
                 contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(1, package._cli(), "forged cached PASS must be rejected")

            manifest_path.write_text(package.json.dumps(current), encoding="utf-8")
            with patch.object(sys, "argv", ["package_collateral.py", "validate", str(manifest_path), "--root", str(root), "--require-release-ready"]), \
                 patch.object(package, "validate_manifest_files", return_value=[]), \
                 patch.object(package, "verify_caption_receipt_records", return_value=[]), \
                 patch.object(package, "recompute_manifest_readiness", return_value=(current, [])), \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(2, package._cli(), "--require-release-ready must use current recomputed BLOCKED status")

    def test_current_claim_approval_change_invalidates_exact_policy_input_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            relative = "messaging/claims.json"
            claim_path = root / relative
            claim_path.parent.mkdir(parents=True)
            claim_path.write_text(package.json.dumps({"claims": [{"id": "CLAIM-TEST", "reviewStatus": "pending"}]}), encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Package Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "package-test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", relative], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "pending claim"], check=True)
            commit = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
            support = package._support_file(root, relative)
            manifest = {
                "assets": [],
                "captionSidecars": [],
                "supportFiles": [],
                "policyInputHashes": {relative: support},
                "requiredSubmissionArtifact": {"exists": False},
                "candidateSourceCommitAtGeneration": commit,
            }
            self.assertEqual([], package.validate_manifest_files(root, manifest))
            claim_path.write_text(package.json.dumps({"claims": [{"id": "CLAIM-TEST", "reviewStatus": "approved"}]}), encoding="utf-8")
            errors = package.validate_manifest_files(root, manifest)
            self.assertTrue(any("policy input messaging/claims.json: source SHA-256 differs from manifest" in error for error in errors))
            self.assertTrue(any("policy input messaging/claims.json: current source bytes differ from the recorded checksum" in error for error in errors))

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
            SELECTABLE_COLLATERAL_ASSET_IDS=package.EXPECTED_POLICY_SELECTABLE_ASSET_IDS,
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
            SELECTABLE_COLLATERAL_ASSET_IDS=package.EXPECTED_POLICY_SELECTABLE_ASSET_IDS,
            validate_all=lambda *_: calls.append("global") or [],
            selected_collateral_blockers=lambda *_: calls.append("selected") or [],
            submission_blockers=lambda *_: calls.append("submission") or [],
        )
        with patch.dict(sys.modules, {"validate_collateral": stub}):
            result = package.canonical_readiness_blockers(ROOT, ["FIXTURE-001"])
        self.assertEqual("validated", result["status"])
        self.assertEqual(["global", "selected", "submission"], calls)

    def test_changed_canonical_selectable_contract_fails_closed(self) -> None:
        stub = types.SimpleNamespace(
            SELECTABLE_COLLATERAL_ASSET_IDS={"DEMO-WORKFLOW-DIAGRAM-001"},
            validate_all=lambda *_: [],
            selected_collateral_blockers=lambda *_: [],
            submission_blockers=lambda *_: [],
        )
        with patch.dict(sys.modules, {"validate_collateral": stub}):
            result = package.canonical_readiness_blockers(ROOT, ["DEMO-WORKFLOW-DIAGRAM-001"])
        self.assertFalse(result["available"])
        self.assertEqual("selectable_contract_changed", result["status"])
        self.assertIn("both readiness gates fail closed", " ".join(result["selected"]))

    def test_canonical_policy_exceptions_and_unsupported_returns_fail_closed(self) -> None:
        policy_stubs = (
            types.SimpleNamespace(
                SELECTABLE_COLLATERAL_ASSET_IDS=package.EXPECTED_POLICY_SELECTABLE_ASSET_IDS,
                validate_all=lambda *_: (_ for _ in ()).throw(RuntimeError("structural check failed")),
                selected_collateral_blockers=lambda *_: [],
                submission_blockers=lambda *_: [],
            ),
            types.SimpleNamespace(
                SELECTABLE_COLLATERAL_ASSET_IDS=package.EXPECTED_POLICY_SELECTABLE_ASSET_IDS,
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

    def test_canonical_visual_selection_does_not_skip_packaged_narrative_claim_review(self) -> None:
        narrative = self.approved_record()
        narrative["assetId"] = "DEMO-SUBMISSION-NARRATIVE-001"
        narrative["recordId"] = "DEMO-SUBMISSION-NARRATIVE-001-text"
        narrative["claimReferences"] = [
            {"id": "CLAIM-NARRATIVE-PENDING", "reviewStatus": "pending", "source": {"revision": "sha256:" + "a" * 64}}
        ]
        canonical = {
            "available": True,
            "status": "validated",
            "selected": [],
            "submission": [],
            "selectedAssetIds": sorted(package.EXPECTED_POLICY_SELECTABLE_ASSET_IDS),
        }
        package_gate, _ = package.evaluate_gates(
            [narrative],
            {"status": "draft_rehearsal_only", "rehearsalSatisfiesFinalDemoRequirement": False, "durationSeconds": 120, "maximumSeconds": 180, "scenes": [{"sceneId": "fixture"}]},
            {"approvalStatus": "approved"}, [], [], {"exists": True}, [{"path": "fixture.md", "exists": True}], canonical,
        )
        combined = " ".join(package_gate["blockers"])
        self.assertEqual("BLOCKED", package_gate["decision"])
        self.assertIn("CLAIM-NARRATIVE-PENDING: selected exact wording review is pending", combined)
        self.assertNotIn("CLAIM-UNSELECTED-OPTIONAL", combined)

    def test_canonical_json_projection_binds_only_documented_semantic_fields(self) -> None:
        cases = (
            (
                "docs/collateral-inventory.json",
                {"trackedFiles": [{"path": "release/v0.1.0-rehearsal/manifest.json", "sha256": "1" * 64, "trackedAtRevision": "a" * 40, "exists": True}]},
                lambda doc: doc["trackedFiles"][0].update(sha256="2" * 64, trackedAtRevision="b" * 40),
                lambda doc: doc["trackedFiles"][0].update(exists=False),
            ),
            (
                "review/provenance.json",
                {"records": [
                    {"assetId": "HANDOFF-MANIFEST-001", "source": {"revision": "a" * 40, "url": "old"}, "checksum": {"value": "1" * 64}, "reviewStatus": "pending"},
                    {"assetId": "PROV-FILE-E018FDB8D981", "source": {"revision": "a" * 64, "url": None}, "checksum": {"value": "3" * 64}, "reviewStatus": "pending"},
                ]},
                lambda doc: (
                    doc["records"][0]["source"].update(revision="b" * 40, url="new"),
                    doc["records"][0]["checksum"].update(value="2" * 64),
                    doc["records"][1]["source"].update(revision="b" * 64),
                    doc["records"][1]["checksum"].update(value="4" * 64),
                ),
                lambda doc: doc["records"][1]["source"].update(url="https://changed.example.invalid/source"),
            ),
        )
        for relative, original, excluded_mutation, included_mutation in cases:
            with self.subTest(path=relative):
                original_digest = package.projected_policy_digest(relative, original)
                excluded_changed = package.json.loads(package.json.dumps(original))
                excluded_mutation(excluded_changed)
                self.assertEqual(original_digest, package.projected_policy_digest(relative, excluded_changed))
                included_changed = package.json.loads(package.json.dumps(original))
                included_mutation(included_changed)
                self.assertNotEqual(original_digest, package.projected_policy_digest(relative, included_changed))

    def test_manifest_validator_fails_closed_for_missing_or_altered_projection_binding(self) -> None:
        relative = "docs/collateral-inventory.json"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / relative
            path.parent.mkdir(parents=True)
            source = {"trackedFiles": [{"path": "release/v0.1.0-rehearsal/manifest.json", "sha256": "1" * 64, "trackedAtRevision": "a" * 40, "exists": True}]}
            path.write_text(package.json.dumps(source), encoding="utf-8")
            support = package._support_file(root, relative)
            manifest = {"assets": [], "captionSidecars": [], "supportFiles": [support], "policyInputHashes": {}, "requiredSubmissionArtifact": {"exists": False}}
            self.assertEqual([], package.validate_manifest_files(root, manifest))
            path.write_text(package.json.dumps(source, indent=2), encoding="utf-8")
            self.assertEqual([], package.validate_manifest_files(root, manifest), "JSON whitespace is outside the documented semantic binding")
            support["binding"]["algorithm"] = "unknown"
            errors = package.validate_manifest_files(root, manifest)
            self.assertTrue(any("unsupported or altered canonical JSON projection" in error for error in errors))
            support.pop("binding")
            errors = package.validate_manifest_files(root, manifest)
            self.assertTrue(any("required canonical JSON projection binding is missing" in error for error in errors))

    def test_canonical_provenance_validation_catches_excluded_inventory_digest_tampering(self) -> None:
        import validate_collateral as canonical  # noqa: PLC0415

        original_read_json = package.read_json

        def tampered_read_json(path: Path) -> dict:
            document = original_read_json(path)
            if path.as_posix().endswith("review/provenance.json"):
                row = next(item for item in document["records"] if item["assetId"] == "PROV-FILE-E018FDB8D981")
                row["source"]["revision"] = "sha256:" + "0" * 64
                row["checksum"]["value"] = "0" * 64
            return document

        with patch.object(package, "read_json", side_effect=tampered_read_json):
            result = package.canonical_readiness_blockers(ROOT, sorted(package.EXPECTED_POLICY_SELECTABLE_ASSET_IDS))
        self.assertEqual("global_validation_failed", result["status"])
        errors = " ".join(result["selected"])
        self.assertIn("PROV-FILE-E018FDB8D981: content-digest source pin does not match exact source file", errors)
        self.assertIn("PROV-FILE-E018FDB8D981: SHA-256 checksum does not match exact source file docs/collateral-inventory.json", errors)
        self.assertNotEqual([], canonical.validate_provenance(tampered_read_json(ROOT / "review/provenance.json")))

    def test_manifest_self_reference_binder_changes_only_documented_exclusions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest_relative = "release/v0.1.0-rehearsal/manifest.json"
            manifest_path = root / manifest_relative
            manifest_path.parent.mkdir(parents=True)
            manifest_path.write_text(
                package.json.dumps({"releaseClass": "draft_rehearsal_only", "lifecycleState": "draft_rehearsal_only"}),
                encoding="utf-8",
            )
            manifest_digest = package.sha256_file(manifest_path)
            inventory = {
                "trackedFiles": [{
                    "path": manifest_relative,
                    "sha256": "0" * 64,
                    "trackedAtRevision": "a" * 40,
                    "exists": True,
                    "provenanceRecordId": "HANDOFF-MANIFEST-001",
                }]
            }
            provenance = {
                "records": [{
                    "assetId": "HANDOFF-MANIFEST-001",
                    "source": {
                        "repo": "Jevelopers-neatHack-2026/marketing-material",
                        "path": manifest_relative,
                        "revision": "a" * 40,
                        "revisionKind": "sha256_content_digest",
                        "url": "old-content-url",
                    },
                    "checksum": {"algorithm": "SHA-256", "value": "0" * 64, "status": "pending"},
                    "permission": {"status": "authorized_internal_candidate_review_only"},
                }, {
                    "assetId": "PROV-FILE-E018FDB8D981",
                    "source": {
                        "repo": "Jevelopers-neatHack-2026/marketing-material",
                        "path": "docs/collateral-inventory.json",
                        "revision": "d" * 64,
                        "revisionKind": "sha256_content_digest",
                        "url": None,
                    },
                    "checksum": {"algorithm": "SHA-256", "value": "d" * 64, "status": "pending"},
                }]
            }
            inventory_path = root / "docs/collateral-inventory.json"
            provenance_path = root / "review/provenance.json"
            inventory_path.parent.mkdir(parents=True)
            provenance_path.parent.mkdir(parents=True)
            inventory_path.write_text(package.json.dumps(inventory), encoding="utf-8")
            provenance_path.write_text(package.json.dumps(provenance), encoding="utf-8")
            inventory_projection = package.projected_policy_digest("docs/collateral-inventory.json", inventory)
            provenance_projection = package.projected_policy_digest("review/provenance.json", provenance)

            self.assertEqual(manifest_digest, package.bind_draft_manifest_self_reference(root, "v0.1.0-rehearsal"))
            updated_inventory = package.read_json(inventory_path)
            updated_provenance = package.read_json(provenance_path)
            updated_record = updated_provenance["records"][0]
            updated_inventory_record = updated_provenance["records"][1]
            inventory_digest = package.sha256_file(inventory_path)
            self.assertEqual(manifest_digest, updated_inventory["trackedFiles"][0]["sha256"])
            self.assertEqual("a" * 40, updated_inventory["trackedFiles"][0]["trackedAtRevision"])
            self.assertEqual("sha256:" + manifest_digest, updated_record["source"]["revision"])
            self.assertEqual("sha256_content_digest", updated_record["source"]["revisionKind"])
            self.assertIsNone(updated_record["source"]["url"])
            self.assertEqual(manifest_digest, updated_record["checksum"]["value"])
            self.assertEqual("sha256:" + inventory_digest, updated_inventory_record["source"]["revision"])
            self.assertIsNone(updated_inventory_record["source"]["url"], "inventory provenance URL stays bound and null")
            self.assertEqual(inventory_digest, updated_inventory_record["checksum"]["value"])
            self.assertEqual(inventory_projection, package.projected_policy_digest("docs/collateral-inventory.json", updated_inventory))
            self.assertEqual(provenance_projection, package.projected_policy_digest("review/provenance.json", updated_provenance))

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
                "candidateSourceCommitAtGeneration": source_commit,
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

    def test_html_contextual_dependencies_are_pinned_and_path_safe(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            html_source = "demo/deck/concept.html"
            svg_source = "demo/diagrams/flow.svg"
            alt_source = "demo/diagrams/flow-alt.md"
            html_copy = "release/v0.1.0-rehearsal/view/demo/deck/concept.html"
            svg_copy = "release/v0.1.0-rehearsal/view/demo/diagrams/flow.svg"
            alt_copy = "release/v0.1.0-rehearsal/view/demo/diagrams/flow-alt.md"
            contents = {
                html_source: b'<img src="../diagrams/flow.svg"><a href="../diagrams/flow-alt.md">Text</a>',
                svg_source: b'<svg></svg>\n',
                alt_source: b"Flow description.\n",
                html_copy: b'<img src="../diagrams/flow.svg"><a href="../diagrams/flow-alt.md">Text</a>',
                svg_copy: b'<svg></svg>\n',
                alt_copy: b"Flow description.\n",
            }
            for relative, content in contents.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Package Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "package-test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", "."], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "composition fixture"], check=True)
            commit = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip()

            def pinned(relative: str) -> dict:
                return {
                    "path": relative,
                    "sha256": package.sha256_file(root / relative),
                    "sourceCommitId": commit,
                    "sourcePinStatus": "pinned",
                }

            dependencies = []
            for source_path, package_path, reference, role in (
                (svg_source, svg_copy, "../diagrams/flow.svg", "image"),
                (alt_source, alt_copy, "../diagrams/flow-alt.md", "accessible equivalent"),
            ):
                source = pinned(source_path)
                copy = pinned(package_path)
                dependencies.append(
                    {
                        "relativeReference": reference,
                        "resolutionStatus": "matches_declared_package_path",
                        "resolvedPackagePath": package_path,
                        "source": source,
                        "packageCopy": {
                            **copy,
                            "exists": True,
                            "expectedSha256": source["sha256"],
                            "byteIdenticalToSource": copy["sha256"] == source["sha256"],
                        },
                        "role": role,
                    }
                )
            html_hash = package.sha256_file(root / html_source)
            manifest = {
                "packageVersion": "v0.1.0-rehearsal",
                "candidateSourceCommitAtGeneration": commit,
                "assets": [
                    {
                        "recordId": "fixture-html",
                        "file": {**pinned(html_source), "exists": True},
                        "packageCopy": {"path": html_copy, "expectedSha256": html_hash},
                        "source": pinned(html_source),
                        "compositionDependencies": dependencies,
                        "renderReceipt": {},
                    }
                ],
                "captionSidecars": [],
                "requiredSubmissionArtifact": {"exists": False},
            }
            self.assertEqual([], package.validate_manifest_files(root, manifest))

            (root / svg_copy).write_bytes(b"<svg>tampered</svg>\n")
            errors = package.validate_manifest_files(root, manifest)
            self.assertTrue(any("packaged contextual dependency checksum mismatch" in item for item in errors), errors)

            (root / svg_copy).unlink()
            errors = package.validate_manifest_files(root, manifest)
            self.assertTrue(any("packaged contextual dependency is missing" in item for item in errors), errors)

            with self.assertRaises(ValueError):
                package.resolve_package_reference(html_copy, "%2e%2e/%2e%2e/%2e%2e/%2e%2e/outside.svg", "v0.1.0-rehearsal")
            unsafe = package.package_composition_reference_errors(
                html_copy,
                ["../../../../outside.svg"],
                [],
                "v0.1.0-rehearsal",
            )
            self.assertTrue(any("is unsafe" in item for item in unsafe), unsafe)

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
            "demo-001-demo-recording-checklist-001-r07-repository-internal-review-text-en-us-rehearsal-recording-plan.md",
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
