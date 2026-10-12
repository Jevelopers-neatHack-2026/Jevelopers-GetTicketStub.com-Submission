"""Offline regression fixtures for public-copy drift and qualified usage checks.

These synthetic mutations are not claims about a working product, reviewed
identity, rights clearance or consumer acceptance.
"""
import contextlib
import hashlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_guidelines as guidelines  # noqa: E402


class GuidelinesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        files = (*guidelines.PUBLIC_SOURCES, guidelines.SNAPSHOT, "docs/claims-register.md",
                 "docs/usage.md", "docs/usage-examples.html", "docs/identity-decision-packet.md",
                 *(f"logo/{name}" for name in guidelines.VARIANTS))
        for relative in files:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(guidelines.ROOT / relative, target)

    def problems(self):
        return "\n".join(guidelines.check(self.root))

    def replace(self, path, old, new):
        file = self.root / path
        text = file.read_text()
        self.assertIn(old, text, "mutation must affect an existing source fixture")
        file.write_text(text.replace(old, new))

    def update_test_hash(self, path):
        """Simulate deliberate rebasing; this never updates the real snapshot."""
        file = self.root / guidelines.SNAPSHOT
        data = json.loads(file.read_text())
        data["sources"][path] = hashlib.sha256((self.root / path).read_bytes()).hexdigest()
        file.write_text(json.dumps(data))

    def test_current_local_snapshot_passes_without_granting_approval(self):
        self.assertEqual(guidelines.check(self.root), [])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(guidelines.main(["--root", str(self.root)]), 0)
        self.assertIn("local source snapshot and structure only", out.getvalue())
        self.assertIn("approvals remain PENDING", out.getvalue())
        self.assertIn("release eligibility is NOT established", out.getvalue())

    def test_unsupported_present_tense_copy_fails_each_public_source(self):
        unsafe = "No forms: drop your ticket and it's done. Print it for $49. Ships in a moss sleeve."
        for path in guidelines.PUBLIC_SOURCES:
            with self.subTest(path=path):
                file = self.root / path
                original = file.read_bytes()
                try:
                    file.write_bytes(original + ("\n" + unsafe + "\n").encode())
                    self.assertIn(f"{path}: public-source drift", self.problems())
                finally:
                    file.write_bytes(original)

    def test_removing_warning_fails_even_if_hash_is_rebased(self):
        for path in guidelines.PUBLIC_SOURCES:
            with self.subTest(path=path):
                source = self.root / path
                original = source.read_bytes()
                try:
                    marker = guidelines.PUBLIC_MARKERS[path][0]
                    self.replace(path, marker, "Ready for public use")
                    self.update_test_hash(path)
                    self.assertIn(f"{path}: missing visible review marker", self.problems())
                finally:
                    source.write_bytes(original)
                    self.update_test_hash(path)

    def test_commented_markdown_warning_does_not_count(self):
        marker = guidelines.PUBLIC_MARKERS["README.md"][0]
        self.replace("README.md", marker, f"<!-- {marker} -->")
        self.update_test_hash("README.md")
        self.assertIn("README.md: missing visible review marker", self.problems())

    def test_code_only_markdown_warning_does_not_count(self):
        marker = guidelines.PUBLIC_MARKERS["README.md"][0]
        self.replace("README.md", marker, f"`{marker}`")
        self.update_test_hash("README.md")
        self.assertIn("README.md: missing visible review marker", self.problems())

    def test_hidden_html_warning_does_not_count(self):
        self.replace("index.html", 'id="review-status"', 'id="review-status" hidden')
        self.update_test_hash("index.html")
        self.assertIn("index.html: missing visible review marker", self.problems())

    def test_missing_claim_row_fails(self):
        path = self.root / "docs/claims-register.md"
        path.write_text("\n".join(line for line in path.read_text().splitlines()
                                   if not line.startswith("| BK-CLAIM-07")))
        self.assertIn("exactly one row for each BK-CLAIM", self.problems())

    def test_duplicate_claim_id_fails(self):
        self.replace("docs/claims-register.md", "| BK-CLAIM-07", "| BK-CLAIM-08")
        self.assertIn("exactly one row for each BK-CLAIM", self.problems())

    def test_mutable_original_source_link_fails(self):
        self.replace("docs/claims-register.md", f"/blob/{guidelines.ORIGINAL_REVISION}/", "/blob/main/")
        self.assertIn("original source must use the recorded baseline", self.problems())

    def test_claim_register_needs_pending_wording_decision(self):
        self.replace("docs/claims-register.md", "Approved public wording and named approving reviewer are pending for every product claim", "All public wording approved")
        self.assertIn("missing review boundary", self.problems())

    def test_negative_claim_fixture_must_reject(self):
        self.replace("docs/claims-register.md", "Required result: reject", "Required result: approve")
        self.assertIn("missing review boundary: Required result: reject", self.problems())

    def test_snapshot_cannot_claim_release_approval(self):
        path = self.root / guidelines.SNAPSHOT
        data = json.loads(path.read_text())
        data["release_eligible"] = True
        data["public_claim_approval"] = "approved"
        path.write_text(json.dumps(data))
        self.assertIn("must retain local-only scope", self.problems())

    def test_snapshot_cannot_drop_source_or_add_foreign_path(self):
        path = self.root / guidelines.SNAPSHOT
        data = json.loads(path.read_text())
        del data["sources"]["README.md"]
        data["sources"]["../../unrelated-file"] = "0" * 64
        path.write_text(json.dumps(data))
        self.assertIn("exactly the four public source paths", self.problems())

    def test_malformed_snapshot_reports_failure(self):
        (self.root / guidelines.SNAPSHOT).write_text("{broken")
        self.assertIn("invalid JSON", self.problems())

    def test_missing_public_source_reports_failure(self):
        (self.root / "README.md").unlink()
        self.assertIn("README.md: cannot read required file", self.problems())

    def test_missing_canonical_variant_fails(self):
        (self.root / "logo/ts-stamp-mono-orange.svg").unlink()
        self.assertIn("canonical variant set drift", self.problems())

    def test_unreviewed_extra_canonical_variant_fails(self):
        shutil.copyfile(self.root / "logo/ts-stamp.svg", self.root / "logo/new-symbol.svg")
        self.assertIn("canonical variant set drift", self.problems())

    def test_invalid_svg_document_fails(self):
        (self.root / "logo/ts-stamp.svg").write_text("<html/>")
        self.assertIn("invalid canonical SVG document", self.problems())

    def test_missing_negative_usage_example_fails(self):
        self.replace("docs/usage-examples.html", 'id="ratio-invalid"', 'id="ratio-removed"')
        self.assertIn("exactly one figure #ratio-invalid", self.problems())

    def test_unlabelled_negative_usage_example_fails(self):
        self.replace("docs/usage-examples.html", "Invalid: stretched to 96 × 40 px.", "Stretched to 96 × 40 px.")
        self.assertIn("#ratio-invalid needs a visible", self.problems())

    def test_hidden_negative_caption_fails(self):
        self.replace("docs/usage-examples.html", "<figcaption>", '<figcaption style="display:none">')
        self.assertIn("needs a visible", self.problems())

    def test_external_image_cannot_replace_canonical_source(self):
        self.replace("docs/usage-examples.html", 'src="../logo/ts-stamp.svg"', 'src="https://example.invalid/logo.svg"')
        self.assertIn("only relative canonical logo SVG sources", self.problems())

    def test_missing_channel_row_fails(self):
        self.replace("docs/usage.md", "| Print / packaging", "| Unmapped channel")
        self.assertIn("missing channel row: Print / packaging", self.problems())

    def test_check_is_read_only_and_drift_exits_nonzero(self):
        before = {str(path.relative_to(self.root)): path.read_bytes()
                  for path in self.root.rglob("*") if path.is_file()}
        guidelines.check(self.root)
        after = {str(path.relative_to(self.root)): path.read_bytes()
                 for path in self.root.rglob("*") if path.is_file()}
        self.assertEqual(before, after)
        self.replace("README.md", "Illustrative positioning for review", "Approved positioning")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guidelines.main(["--root", str(self.root)]), 1)


if __name__ == "__main__":
    unittest.main()
