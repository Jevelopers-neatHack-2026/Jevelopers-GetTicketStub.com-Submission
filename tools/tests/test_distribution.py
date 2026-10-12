"""Synthetic local archive/recovery cases; never release or owner evidence."""
from __future__ import annotations

import copy
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_distribution as dist
import check_consumers as consumers
import check_brand_release as release

ROOT = Path(__file__).resolve().parents[2]


def archive_with(blobs: dict[str, bytes], extra: list[tuple[str, bytes]] | None = None,
                 mode: int = 0o100644, compression: int = zipfile.ZIP_STORED) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, content in list(blobs.items()) + (extra or []):
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = mode << 16
            info.compress_type = compression
            archive.writestr(info, content)
    return out.getvalue()


def synthetic_receipt(files_digest: str) -> dict:
    """Shape-only regression input, never written to real acceptance records."""
    return {"status": "approved", "reviewer": "synthetic-fixture-reviewer", "reviewed_on": "2026-10-12",
            "evidence_url": "https://github.com/synthetic-fixture/never-release/issues/1#issuecomment-1",
            "evidence_sha256": "1" * 64, "files_digest": files_digest}


def commit_synthetic(root: Path, message: str) -> str:
    subprocess.run(["git", "add", "."], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "-c", "user.name=Synthetic fixture", "-c", "user.email=fixture@example.invalid",
                    "commit", "-qm", "Synthetic fixture: " + message], cwd=root, check=True, capture_output=True)
    return dist.git(root, "rev-parse", "HEAD").decode().strip()


def approved_shape_fixture(root: Path) -> tuple[bytes, dict]:
    """Synthetic records exercise real validation, never real rights or provider evidence.

    This isolated test copy deliberately uses approved-shaped local data (including
    the production boolean) to reach the success branch. No real repository record,
    owner identity or external receipt is changed or authenticated.
    """
    reviewed_source, _ = dist.source_identity(root)
    paths = sorted(dist.TOKEN_PATHS | {path.relative_to(root).as_posix() for path in (root / "logo").glob("*.svg")})
    register = json.loads((root / "provenance/register.json").read_text())
    register["statement"] = "Synthetic validator regression only; no real rights or approval evidence."
    for record in register["records"]:
        if record["core"]:
            record.update(rights_status="cleared", reviewer="synthetic-fixture-reviewer",
                          permitted_uses=["Synthetic validator exercise"],
                          restrictions=["Synthetic data only; never release or publish"])
            record["approval"] = {"status": "approved", "date": "2026-10-12",
                                  "evidence": "https://github.com/synthetic-fixture/never-release/issues/1#issuecomment-1"}
            if record["path"] in paths:
                record["notice_required"] = "no"
    (root / "provenance/register.json").write_bytes(dist.canonical(register))
    entries = [{"path": path, "sha256": dist.digest((root / path).read_bytes()),
                "use": "Synthetic validator exercise"} for path in paths]
    allowlist = json.loads((root / "provenance/allowlist.json").read_text())
    allowlist.update(status="reviewed", entries=entries,
                     statement="Synthetic validator regression only; never a reviewed real distribution.",
                     review={"reviewer": "synthetic-fixture-reviewer", "date": "2026-10-12",
                             "evidence": "https://github.com/synthetic-fixture/never-release/issues/1#issuecomment-1"})
    (root / "provenance/allowlist.json").write_bytes(dist.canonical(allowlist))
    files_digest = dist.file_set_digest([{**entry, "size_bytes": (root / entry["path"]).stat().st_size}
                                         for entry in entries])
    receipt = synthetic_receipt(files_digest)
    record = json.loads((root / dist.REVIEW).read_text())
    record.update(source_sha=reviewed_source, brand_version="1.0.0", distribution=receipt, font_delivery=receipt,
                  consumer_acknowledgments={name: receipt for name in consumers.CONSUMERS})
    record["manual_evidence"]["external_font_available_and_unavailable"] = receipt
    (root / dist.REVIEW).write_bytes(dist.canonical(record))
    commit_synthetic(root, "approved-shaped historical source, no real approval")
    return dist.build_bytes(root, "approved")


class DistributionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="synthetic-brand-distribution-")
        cls.root = Path(cls.tmp.name) / "source"
        shutil.copytree(ROOT, cls.root, ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__", "out", "build"))
        for args in (("init", "-q"), ("add", "."),
                     ("-c", "user.name=Synthetic fixture", "-c", "user.email=fixture@example.invalid",
                      "commit", "-qm", "Synthetic archive test source")):
            subprocess.run(["git", *args], cwd=cls.root, check=True, capture_output=True)
        cls.data, cls.manifest = dist.build_bytes(cls.root)
        cls.source = cls.manifest["source_sha"]
        _, cls.blobs = dist.verify_bytes(cls.data, dist.digest(cls.data), cls.source)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def reject(self, data, source=None, checksum=None):
        with self.assertRaises(dist.DistributionError):
            dist.verify_bytes(data, dist.digest(data) if checksum is None else checksum,
                              self.source if source is None else source)

    def reject_resealed_source(self, manifest, blobs=None):
        contents = dict(self.blobs if blobs is None else blobs)
        contents[dist.MANIFEST] = dist.canonical(manifest)
        data = archive_with(contents)
        # A newly supplied checksum and internally consistent manifest are insufficient.
        verified, contents = dist.verify_bytes(data, dist.digest(data), self.source)
        with self.assertRaises(dist.DistributionError):
            dist.verify_source(self.root, self.source, verified, contents)

    def test_deterministic_review_build_with_explicit_nonapproval(self):
        again, manifest = dist.build_bytes(self.root)
        self.assertEqual(self.data, again)
        self.assertEqual(manifest["kind"], "review_candidate")
        self.assertIsNone(manifest["brand_version"])
        self.assertFalse(manifest["release_approved"])
        self.assertFalse(manifest["font_policy"]["self_hosted"])
        self.assertEqual(manifest["files_digest"], dist.file_set_digest(manifest["files"]))
        dist.verify_source(self.root, self.source, manifest, self.blobs)

    def test_font_and_reference_source_bytes_are_absent(self):
        self.assertTrue(all(not name.startswith(("brand-kit/fonts/", "brand-kit/references/")) for name in self.blobs))
        self.assertNotIn("brand-kit/index.html", self.blobs)

    def test_production_blocks_empty_allowlist_and_missing_rights(self):
        with self.assertRaises(dist.DistributionError):
            dist.build_bytes(self.root, "approved")

    def test_moving_partial_and_unknown_refs_are_rejected(self):
        for ref in ("main", "v1.0.0", self.source[:7], "", "UNKNOWN"):
            with self.subTest(ref=ref):
                self.reject(self.data, source=ref)

    def test_independent_checksum_pin_is_required(self):
        self.reject(self.data, checksum="0" * 64)
        self.reject(self.data, checksum="UNKNOWN")
        self.reject(self.data + b"tampered", checksum=dist.digest(self.data))

    def test_unlisted_member_and_reference_and_font_are_rejected(self):
        for path in ("brand-kit/logo/unlisted.svg", "brand-kit/references/image.webp", "brand-kit/fonts/font.woff2"):
            with self.subTest(path=path):
                self.reject(archive_with(self.blobs, [(path, b"synthetic forbidden member")]))

    def test_unsafe_duplicate_and_case_colliding_paths_are_rejected(self):
        for path in ("brand-kit/../outside", "/absolute", "brand-kit/logo/../../outside", "brand-kit\\file"):
            with self.subTest(path=path):
                self.reject(archive_with(self.blobs, [(path, b"unsafe")]))
        # A differently cased member must not overwrite a file on another platform.
        self.reject(archive_with(self.blobs, [("brand-kit/LOGO/wordmark.svg", b"collision")]))

    def test_missing_and_tampered_members_are_rejected(self):
        path = "brand-kit/tokens/tokens.css"
        missing = dict(self.blobs)
        missing.pop(path)
        self.reject(archive_with(missing))
        changed = dict(self.blobs)
        changed[path] += b"\n:root{--ts-text:red}"
        self.reject(archive_with(changed))

    def test_symlinks_and_compressed_archives_are_rejected(self):
        self.reject(archive_with(self.blobs, mode=0o120777))
        self.reject(archive_with(self.blobs, compression=zipfile.ZIP_DEFLATED))

    def test_manifest_cannot_claim_release_or_change_source(self):
        for key, value in (("release_approved", True), ("source_sha", "0" * 40), ("schema_version", 99),
                           ("kind", "approved_subset"), ("brand_version", "1.0.0")):
            with self.subTest(key=key):
                blobs = dict(self.blobs)
                manifest = copy.deepcopy(self.manifest)
                manifest[key] = value
                blobs[dist.MANIFEST] = dist.canonical(manifest)
                self.reject(archive_with(blobs))

    def test_consumer_recomputes_source_metadata_after_resealing(self):
        for key, value in (("source_tree", "0" * 40), ("proposal_sha256", "0" * 64),
                           ("token_profile", {"name": "invented-profile", "version": "99.0.0"}),
                           ("font_policy", {"self_hosted": False, "status": "approved", "default": "external_provider"}),
                           ("limitations", ["Synthetic claim of permission"])):
            with self.subTest(key=key):
                manifest = copy.deepcopy(self.manifest)
                manifest[key] = value
                self.reject_resealed_source(manifest)

    def test_resealed_provenance_cannot_clear_or_hide_unknown_rights(self):
        for provenance in (None, {"classification": "first-party-canonical", "rights_status": "cleared",
                                  "approval": {"status": "approved"}, "reviewer": "synthetic-fixture-reviewer",
                                  "notice_files": []}):
            with self.subTest(provenance=provenance):
                manifest = copy.deepcopy(self.manifest)
                entry = next(e for e in manifest["files"] if e["path"] == "logo/wordmark.svg")
                entry["provenance"] = provenance
                self.reject_resealed_source(manifest)

    def test_resealed_review_cannot_promote_itself_to_approved(self):
        manifest = copy.deepcopy(self.manifest)
        receipt = synthetic_receipt(manifest["files_digest"])
        self.assertFalse(dist.review_problems(receipt, "synthetic regression"))
        manifest.update(kind="approved_subset", brand_version="1.0.0",
                        distribution_decision={"source_sha": self.source,
                                               "distribution": receipt, "font_delivery": receipt})
        for entry in manifest["files"]:
            entry["provenance"] = {"rights_status": "cleared", "approval": {"status": "approved"}}
        self.reject_resealed_source(manifest)
        # The source still contains no approved distribution or allowlisted release.
        self.assertIsNone(json.loads((self.root / dist.REVIEW).read_text())["distribution"])
        self.assertEqual(json.loads((self.root / "provenance/allowlist.json").read_text())["entries"], [])

    def test_resealed_path_selection_must_match_source_proposal(self):
        for operation in ("remove", "add"):
            with self.subTest(operation=operation):
                manifest, blobs = copy.deepcopy(self.manifest), dict(self.blobs)
                if operation == "remove":
                    path = "docs/logo.md"
                    manifest["files"] = [e for e in manifest["files"] if e["path"] != path]
                    blobs.pop(dist.PREFIX + path)
                else:
                    path = "docs/voice.md"
                    content = dist.source_blob(self.root, self.source, path)
                    blobs[dist.PREFIX + path] = content
                    manifest["files"].append({"path": path, "sha256": dist.digest(content),
                                              "size_bytes": len(content), "provenance": None})
                    manifest["files"].sort(key=lambda entry: entry["path"])
                manifest["files_digest"] = dist.file_set_digest(manifest["files"])
                self.reject_resealed_source(manifest, blobs)

    def test_source_provenance_uses_pinned_tree_not_mutable_checkout(self):
        register = self.root / "provenance/register.json"
        original = register.read_bytes()
        try:
            register.write_text('{"synthetic":true,"records":[]}')
            # Verification of historical bytes does not adopt today's working edits.
            dist.verify_source(self.root, self.source, self.manifest, self.blobs)
        finally:
            register.write_bytes(original)

    def test_historical_archive_does_not_restore_revoked_current_eligibility(self):
        # Real archive/provenance/receipt paths, with only the optional Node compile
        # stubbed so the standard-library suite does not require Tailwind installed.
        for change in ("core_rights_revoked", "allowlist_emptied", "optional_path_removed"):
            with self.subTest(change=change), tempfile.TemporaryDirectory(prefix="synthetic-brand-revocation-") as tmp:
                root = Path(tmp) / "source"
                shutil.copytree(self.root, root)
                data, manifest = approved_shape_fixture(root)
                archive = Path(tmp) / "synthetic-historical-never-release.zip"
                archive.write_bytes(data)
                kwargs = {"archive": archive, "source": manifest["source_sha"], "expected_sha256": dist.digest(data)}
                with patch.object(consumers, "validate_tailwind", return_value={"status": "pass", "mode": "synthetic_mock_no_compile"}):
                    self.assertEqual(consumers.check(root, **kwargs)["result"], "pass")
                    if change == "core_rights_revoked":
                        path = root / "provenance/register.json"
                        register = json.loads(path.read_text())
                        record = next(row for row in register["records"] if row["path"] == "logo/wordmark.svg")
                        record["rights_status"] = "UNKNOWN"
                        record["approval"]["status"] = "rejected"
                        path.write_bytes(dist.canonical(register))
                    else:
                        path = root / "provenance/allowlist.json"
                        allowlist = json.loads(path.read_text())
                        allowlist["entries"] = [] if change == "allowlist_emptied" else [
                            row for row in allowlist["entries"] if row["path"] != "logo/ts-stamp-mono-orange.svg"]
                        path.write_bytes(dist.canonical(allowlist))
                    current = commit_synthetic(root, change)
                    self.assertNotEqual(current, manifest["source_sha"])
                    # The historical package is still an authentic copy of that old
                    # synthetic source, but it cannot revive today's eligibility.
                    verified, blobs = dist.verify_bytes(data, dist.digest(data), manifest["source_sha"])
                    dist.verify_source(root, manifest["source_sha"], verified, blobs)
                    local = consumers.check(root, local=True, **kwargs)
                    self.assertEqual(local["result"], "pass")
                    self.assertEqual(local["scope"], "local_fixture_mechanics")
                    self.assertFalse(local["release_approved"])
                    normal = consumers.check(root, **kwargs)
                    self.assertEqual(normal["result"], "blocked")
                    self.assertTrue(any("current" in problem for problem in normal["consumer_acknowledgments"]["problems"]))

    def test_historical_archive_receipts_bind_current_contract_metadata(self):
        # Hash-identical files alone cannot make version, font-policy or reviewed
        # source changes agree with an older artifact's decision record. These are
        # synthetic receipts; the real archive/source checks run, only Node is mocked.
        for change in ("brand_version", "font_policy", "reviewed_source"):
            with self.subTest(change=change), tempfile.TemporaryDirectory(prefix="synthetic-brand-contract-") as tmp:
                root = Path(tmp) / "source"
                shutil.copytree(self.root, root)
                data, manifest = approved_shape_fixture(root)
                archive = Path(tmp) / "synthetic-historical-never-release.zip"
                archive.write_bytes(data)
                kwargs = {"archive": archive, "source": manifest["source_sha"], "expected_sha256": dist.digest(data)}
                with patch.object(consumers, "validate_tailwind", return_value={"status": "pass", "mode": "synthetic_mock_no_compile"}):
                    self.assertEqual(consumers.check(root, **kwargs)["result"], "pass")
                    if change == "font_policy":
                        path = root / dist.PROPOSAL
                        value = json.loads(path.read_text())
                        value["font_policy"]["external_option"] = "Synthetic different external proposal; no provider selected or tested."
                    else:
                        path = root / dist.REVIEW
                        value = json.loads(path.read_text())
                        if change == "brand_version":
                            value["brand_version"] = "2.0.0"
                        else:
                            value["source_sha"] = manifest["source_sha"]
                    path.write_bytes(dist.canonical(value))
                    current = commit_synthetic(root, "different " + change + " with unchanged export bytes")
                    _, current_manifest = dist.source_package(root, current, "approved")
                    self.assertEqual(current_manifest["files_digest"], manifest["files_digest"])
                    normal = consumers.check(root, **kwargs)
                    self.assertEqual(normal["result"], "blocked")
                    self.assertTrue(any("archive contract differs" in problem for problem in normal["consumer_acknowledgments"]["problems"]))
                    local = consumers.check(root, local=True, **kwargs)
                    self.assertEqual(local["result"], "pass")
                    self.assertEqual(local["scope"], "local_fixture_mechanics")
                    self.assertFalse(local["release_approved"])

    def test_duplicate_json_keys_are_rejected(self):
        with self.assertRaises(dist.DistributionError):
            dist.parse_json(b'{"status":"pending","status":"approved"}')

    def test_wrong_manifest_types_fail_closed(self):
        for key, value in (("font_policy", []), ("files", {}), ("kind", []), ("source_tree", None)):
            with self.subTest(key=key):
                blobs = dict(self.blobs)
                manifest = copy.deepcopy(self.manifest)
                manifest[key] = value
                blobs[dist.MANIFEST] = dist.canonical(manifest)
                self.reject(archive_with(blobs))

    def test_dirty_tree_and_hidden_index_changes_block_build(self):
        path = self.root / "uncommitted.txt"
        try:
            path.write_text("synthetic uncommitted source")
            with self.assertRaises(dist.DistributionError):
                dist.build_bytes(self.root)
        finally:
            path.unlink()
        subprocess.run(["git", "update-index", "--assume-unchanged", "README.md"], cwd=self.root, check=True)
        try:
            with self.assertRaises(dist.DistributionError):
                dist.build_bytes(self.root)
        finally:
            subprocess.run(["git", "update-index", "--no-assume-unchanged", "README.md"], cwd=self.root, check=True)

    def test_existing_output_and_symlink_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "archive.zip"
            dist.write_new(output, b"prior evidence")
            with self.assertRaises(dist.DistributionError):
                dist.write_new(output, b"overwrite")
            self.assertEqual(output.read_bytes(), b"prior evidence")
            alias = Path(tmp) / "alias"
            alias.symlink_to(output)
            with self.assertRaises(dist.DistributionError):
                dist.write_new(alias, b"overwrite")

    def test_css_plain_import_and_network_negative(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp)
            for path, content in self.blobs.items():
                target = fixture / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            for name in ("plain.html", "plain.css"):
                source_name = name + ".in" if name.endswith(".html") else name
                shutil.copyfile(self.root / "distribution/fixtures" / source_name, fixture / name)
            self.assertGreater(consumers.validate_plain(fixture / "brand-kit", fixture), 0)
            css = fixture / "brand-kit/tokens/tokens.css"
            css.write_text(css.read_text() + '\n@import "https://example.invalid/font.css";')
            with self.assertRaises(dist.DistributionError):
                consumers.validate_plain(fixture / "brand-kit", fixture)

    def test_rendered_fixture_links_require_logo_and_compiled_css(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp)
            for path, content in self.blobs.items():
                target = fixture / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            for name in ("plain.html", "tailwind.html", "plain.css"):
                source_name = name + ".in" if name.endswith(".html") else name
                shutil.copyfile(self.root / "distribution/fixtures" / source_name, fixture / name)
            self.assertGreater(consumers.validate_links(fixture, "plain.html"), 0)
            with self.assertRaises(dist.DistributionError):
                consumers.validate_links(fixture, "tailwind.html")
            # This tests link existence only; actual compilation is a separate check.
            (fixture / "compiled.css").write_text("/* Synthetic link-existence fixture, not compilation evidence. */")
            self.assertEqual(consumers.validate_links(fixture, "tailwind.html"), 2)
            (fixture / "brand-kit/logo/wordmark.svg").unlink()
            with self.assertRaises(dist.DistributionError):
                consumers.validate_links(fixture, "plain.html")
            (fixture / "tailwind.html").write_text("<link href='https://example.invalid/external.css'>")
            with self.assertRaises(dist.DistributionError):
                consumers.validate_links(fixture, "tailwind.html")

    def test_removed_tokens_and_paths_need_breaking_migration(self):
        changed = dict(self.blobs)
        changed.pop("brand-kit/logo/wordmark.svg")
        changed["brand-kit/tokens/tokens.css"] = b":root { --ts-only-fixture: black; }"
        comparison = consumers.compare_public(self.blobs, changed)
        self.assertEqual(comparison["classification"], "breaking")
        self.assertIn("brand-kit/logo/wordmark.svg", comparison["removed_paths"])
        self.assertIn("--ts-text", comparison["removed_tokens"])
        self.assertFalse(comparison["policy_approved"])

    def test_no_named_acknowledgment_is_fabricated(self):
        record = json.loads((self.root / dist.REVIEW).read_text())
        problems = consumers.acknowledgment_problems(record["consumer_acknowledgments"], self.manifest["files_digest"])
        self.assertEqual(len(problems), 3)
        self.assertTrue(release.manual_problems(record, self.manifest["files_digest"]))

    def test_external_font_receipt_is_separate_from_execution(self):
        record = json.loads((self.root / dist.REVIEW).read_text())
        missing = consumers.font_evidence_report(record, self.manifest["files_digest"])
        self.assertEqual(missing["status"], "blocked")
        self.assertTrue(missing["required_for_release"])
        self.assertFalse(missing["performed_this_run"])
        self.assertIsNone(missing["record"])
        receipt = synthetic_receipt(self.manifest["files_digest"])
        record["manual_evidence"]["external_font_available_and_unavailable"] = receipt
        provided = consumers.font_evidence_report(record, self.manifest["files_digest"])
        self.assertEqual(provided["status"], "recorded_unverified")
        self.assertEqual(provided["record"], receipt)
        self.assertFalse(provided["performed_this_run"])
        receipt["files_digest"] = "0" * 64
        stale = consumers.font_evidence_report(record, self.manifest["files_digest"])
        self.assertEqual(stale["status"], "blocked")
        self.assertIsNone(stale["record"])

    def test_normal_contract_report_cannot_convert_missing_provider_evidence_to_pass(self):
        # Isolate reporting from eligibility: synthetic approved-shape receipts and
        # mocked packaging/compile are not a real approved source or provider result.
        record = json.loads((self.root / dist.REVIEW).read_text())
        receipt = synthetic_receipt(self.manifest["files_digest"])
        record.update(source_sha=self.source, brand_version="1.0.0", distribution=receipt, font_delivery=receipt,
                      consumer_acknowledgments={name: receipt for name in consumers.CONSUMERS})
        manifest = dict(self.manifest, kind="approved_subset")
        with patch.object(dist, "build_bytes", return_value=(self.data, manifest)), \
                patch.object(dist, "verify_bytes", return_value=(manifest, self.blobs)), \
                patch.object(dist, "verify_source"), \
                patch.object(dist, "accepted_record", side_effect=lambda *_: (record, [])), \
                patch.object(consumers, "validate_tailwind", return_value={"status": "pass"}):
            missing = consumers.check(self.root)
            self.assertEqual(missing["result"], "blocked")
            self.assertEqual(missing["external_font_evidence"]["status"], "blocked")
            record["manual_evidence"]["external_font_available_and_unavailable"] = receipt
            supplied = consumers.check(self.root)
            self.assertEqual(supplied["result"], "pass")
            self.assertEqual(supplied["external_font_evidence"]["status"], "recorded_unverified")
            self.assertEqual(supplied["font_provider_checks"]["status"], "not_run")
            self.assertFalse(supplied["font_provider_checks"]["performed_this_run"])
            self.assertFalse(supplied["release_approved"])

    def test_missing_tailwind_is_required_skip(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = consumers.validate_tailwind(self.root, Path(tmp), Path(tmp))
        self.assertEqual(result["status"], "skipped")
        self.assertTrue(result["required"])

    def test_gate_retains_failed_and_skipped_required_checks(self):
        def synthetic_collect(root, target, output, number, timeout):
            result = "fail" if number == 1 else "skipped" if number == 2 else "pass"
            return {"target": target, "result": result, "required": True, "exit_code": 1 if number == 1 else None}
        with tempfile.TemporaryDirectory() as tmp, patch.object(release, "collect_check", side_effect=synthetic_collect):
            output = Path(tmp) / "run"
            report = release.gate(self.root, output)
            self.assertEqual(len(report["commands"]), len(release.CHECKS))
            self.assertEqual(report["commands"][0]["result"], "fail")
            self.assertEqual(report["commands"][1]["result"], "skipped")
            self.assertEqual(report["result"], "blocked")
            self.assertFalse(report["release_approved"])
            self.assertFalse(report["foreign_acceptance_changed"])
            with self.assertRaises(dist.DistributionError):
                release.gate(self.root, output)


if __name__ == "__main__":
    unittest.main()
