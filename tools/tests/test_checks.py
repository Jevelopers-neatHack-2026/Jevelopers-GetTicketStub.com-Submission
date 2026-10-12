"""Negative and positive tests for the BK-01 checks. Run: python3 -m unittest discover -s tools/tests"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
import check_inventory  # noqa: E402
import check_links  # noqa: E402
from inventory_lib import INVENTORY, ROOT  # noqa: E402


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for rel in ("README.md", "docs/source-of-truth.md", "SPEC.md"):
            (self.tmp / rel).parent.mkdir(parents=True, exist_ok=True)
        (self.tmp / "README.md").write_text("[idx](docs/source-of-truth.md) [spec](SPEC.md#colour)\n")
        (self.tmp / "SPEC.md").write_text("# Colour\n")
        (self.tmp / "docs/source-of-truth.md").write_text("SPEC.md\n")
        self.entries = [self.entry(p) for p in ("README.md", "SPEC.md", "docs/source-of-truth.md", INVENTORY)]
        self.write()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    @staticmethod
    def entry(path):
        return dict(id=path, path=path, type="x", category="c", classification="guideline", description="d",
                    owner_role="o", approval_status="unknown", provenance_status="unknown",
                    release_class="internal", canonical_authority=path)

    def write(self):
        inv = dict(enums={"approval_status": ["unknown"]}, entries=self.entries,
                   source_of_truth=[dict(topic="t", paths=["SPEC.md"])], path_map=[])
        p = self.tmp / INVENTORY
        p.parent.mkdir(exist_ok=True)
        p.write_text(json.dumps(inv))

    def problems(self):
        return "\n".join(check_inventory.check(self.tmp))


class InventoryTests(Fixture):
    def test_valid_fixture_passes(self):
        self.assertEqual(check_inventory.check(self.tmp), [])

    def test_missing_path(self):
        self.entries.append(self.entry("logo/ghost.svg"))
        self.write()
        self.assertIn("path does not exist", self.problems())

    def test_duplicate_entry(self):
        self.entries.append(dict(self.entries[1]))
        self.write()
        self.assertIn("duplicate id", self.problems())
        self.assertIn("duplicate path", self.problems())

    def test_uncatalogued_asset(self):
        (self.tmp / "logo").mkdir()
        (self.tmp / "logo/new.svg").write_text("<svg/>")
        self.assertIn("uncatalogued file: logo/new.svg", self.problems())

    def test_broken_canonical_link(self):
        self.entries[1]["canonical_authority"] = "tokens/missing.json"
        self.write()
        self.assertIn("not a catalogued path", self.problems())

    def test_missing_inventory_is_error(self):
        (self.tmp / INVENTORY).unlink()
        self.assertIn("missing required input", self.problems())

    def test_unknown_must_be_explicit(self):
        del self.entries[1]["approval_status"]
        self.write()
        self.assertIn("missing required field 'approval_status'", self.problems())

    def test_cli_exit_codes(self):
        self.assertEqual(check_inventory.main(["--root", str(self.tmp)]), 0)
        (self.tmp / "stray.txt").write_text("x")
        self.assertEqual(check_inventory.main(["--root", str(self.tmp)]), 1)


class GitFixture(Fixture):
    def setUp(self):
        super().setUp()
        git = ["git", "-C", str(self.tmp), "-c", "user.name=t", "-c", "user.email=t@example.invalid"]
        self.git = git
        subprocess.run(git + ["init", "-q"], check=True)
        subprocess.run(git + ["add", "-A"], check=True)
        subprocess.run(git + ["commit", "-q", "-m", "x"], check=True)


class GitTests(GitFixture):
    def test_clean_git_fixture_passes(self):
        self.assertEqual(check_inventory.check(self.tmp), [])

    def test_deleted_tracked_file_removed_from_inventory_fails(self):
        (self.tmp / "SPEC.md").unlink()
        self.entries = [e for e in self.entries if e["path"] != "SPEC.md"]
        self.write()
        self.assertIn("uncatalogued file: SPEC.md", self.problems())

    def test_deleted_tracked_file_still_in_inventory_fails(self):
        (self.tmp / "SPEC.md").unlink()
        self.assertIn("path does not exist", self.problems())

    def test_untracked_notes_ignored_by_default(self):
        (self.tmp / "notes.md").write_text("scratch\n")
        self.assertEqual(check_inventory.check(self.tmp), [])
        self.assertEqual(check_inventory.main(["--root", str(self.tmp)]), 0)

    def test_untracked_notes_flagged_with_option(self):
        (self.tmp / "notes.md").write_text("scratch\n")
        self.assertIn("uncatalogued file: notes.md",
                      "\n".join(check_inventory.check(self.tmp, include_untracked=True)))
        self.assertEqual(check_inventory.main(["--root", str(self.tmp), "--include-untracked"]), 1)

    def test_untracked_broken_link_ignored_by_default(self):
        (self.tmp / "notes.md").write_text("[x](nope.md)\n")
        self.assertEqual(check_links.check(self.tmp)[0], [])
        self.assertTrue(check_links.check(self.tmp, include_untracked=True)[0])

    def test_deleted_tracked_markdown_does_not_crash_links(self):
        (self.tmp / "SPEC.md").unlink()
        errors, _, _ = check_links.check(self.tmp)
        self.assertTrue(any("broken local link 'SPEC.md" in e for e in errors))


class LinkTests(Fixture):
    def test_empty_root_fails(self):
        empty = Path(tempfile.mkdtemp())
        try:
            errors, _, _ = check_links.check(empty)
            self.assertIn("missing required input: README.md", errors)
            self.assertIn("missing required input: no tracked .md or .html files to check", errors)
            self.assertEqual(check_links.main(["--root", str(empty)]), 1)
        finally:
            shutil.rmtree(empty)

    def test_missing_index_doc_fails(self):
        (self.tmp / "docs/source-of-truth.md").unlink()
        self.assertTrue(any("missing required input: docs/source-of-truth.md" in e
                            for e in check_links.check(self.tmp)[0]))

    def test_reference_definition_broken_target(self):
        (self.tmp / "README.md").write_text("[x][a]\n\n[a]: docs/nope.md\n")
        self.assertTrue(any("broken local link 'docs/nope.md'" in e for e in check_links.check(self.tmp)[0]))

    def test_reference_image_and_angle_target_and_anchor(self):
        (self.tmp / "README.md").write_text("![i][img] [c][] [s]\n\n[img]: <gone.png> \"t\"\n[C]: SPEC.md#nothing\n[s]: SPEC.md#colour\n")
        errors = check_links.check(self.tmp)[0]
        self.assertTrue(any("gone.png" in e for e in errors))
        self.assertTrue(any("missing anchor '#nothing'" in e for e in errors))
        self.assertEqual(len(errors), 2)

    def test_reference_undefined_label(self):
        (self.tmp / "README.md").write_text("[x][missing] [y][]\n")
        errors = check_links.check(self.tmp)[0]
        self.assertTrue(any("'[missing]' has no definition" in e for e in errors))
        self.assertTrue(any("'[y]' has no definition" in e for e in errors))

    def test_reference_empty_target(self):
        (self.tmp / "README.md").write_text("[x][a]\n\n[a]: \n")
        self.assertTrue(any("empty target" in e for e in check_links.check(self.tmp)[0]))

    def test_valid_reference_passes_and_external_listed(self):
        (self.tmp / "README.md").write_text("[x][a] [y][B]\n\n[a]: SPEC.md#colour\n[b]: https://example.invalid/\n")
        errors, ext, ok = check_links.check(self.tmp)
        self.assertEqual(errors, [])
        self.assertEqual(ext, {"https://example.invalid/"})

    def test_shortcut_reference_broken_destination(self):
        (self.tmp / "README.md").write_text("see [gone] and ![pic]\n\n[gone]: docs/nope.md\n[pic]: nope.png\n")
        errors = check_links.check(self.tmp)[0]
        self.assertTrue(any("docs/nope.md" in e for e in errors))
        self.assertTrue(any("nope.png" in e for e in errors))

    def test_shortcut_reference_broken_anchor(self):
        (self.tmp / "README.md").write_text("see [spec]\n\n[Spec]: SPEC.md#nothing\n")
        self.assertTrue(any("missing anchor '#nothing'" in e for e in check_links.check(self.tmp)[0]))

    def test_shortcut_reference_external_listed_not_verified(self):
        (self.tmp / "README.md").write_text("see [ext]\n\n[ext]: https://example.invalid/x\n")
        errors, ext, _ = check_links.check(self.tmp)
        self.assertEqual(errors, [])
        self.assertEqual(ext, {"https://example.invalid/x"})

    def test_valid_shortcut_reference_passes(self):
        (self.tmp / "README.md").write_text("see [spec] and\n\n> [spec]: SPEC.md#colour\n")
        self.assertEqual(check_links.check(self.tmp)[0], [])

    def test_unmatched_plain_brackets_are_text(self):
        (self.tmp / "README.md").write_text("- [ ] todo [x] done [note] and [a, b] array\n")
        self.assertEqual(check_links.check(self.tmp)[0], [])

    def test_reference_in_code_fence_ignored(self):
        (self.tmp / "README.md").write_text("```\n[x][nope]\n[a]: gone.md\n```\n")
        self.assertEqual(check_links.check(self.tmp)[0], [])

    def test_valid_links_pass(self):
        errors, ext, ok = check_links.check(self.tmp)
        self.assertEqual(errors, [])

    def test_broken_local_link(self):
        (self.tmp / "README.md").write_text("[x](docs/nope.md)\n")
        errors, _, _ = check_links.check(self.tmp)
        self.assertTrue(any("broken local link" in e for e in errors))
        self.assertEqual(check_links.main(["--root", str(self.tmp)]), 1)

    def test_missing_anchor(self):
        (self.tmp / "README.md").write_text("[x](SPEC.md#nothing)\n")
        errors, _, _ = check_links.check(self.tmp)
        self.assertTrue(any("missing anchor" in e for e in errors))

    def test_html_and_css_links(self):
        (self.tmp / "index.html").write_text('<img src="gone.webp"><style>a{background:url(gone2.png)}</style>')
        errors, _, _ = check_links.check(self.tmp)
        self.assertEqual(len([e for e in errors if "index.html" in e]), 2)

    def test_external_not_verified_offline(self):
        (self.tmp / "README.md").write_text("[x](https://example.invalid/a)\n")
        errors, ext, _ = check_links.check(self.tmp)
        self.assertEqual(errors, [])
        self.assertEqual(ext, {"https://example.invalid/a"})

    def test_code_blocks_ignored(self):
        (self.tmp / "README.md").write_text("```\n[x](nope.md)\n```\n`[y](nope2.md)`\n")
        self.assertEqual(check_links.check(self.tmp)[0], [])


class RealRepo(unittest.TestCase):
    def test_repository_passes(self):
        self.assertEqual(check_inventory.check(ROOT), [])
        self.assertEqual(check_links.check(ROOT)[0], [])

    def test_repository_classifications_are_honest(self):
        inv = json.loads((ROOT / INVENTORY).read_text(encoding="utf-8"))
        by = {e["path"]: e for e in inv["entries"]}
        for p in ("tokens/tokens.css", "tokens/tailwind.preset.js"):
            self.assertEqual(by[p]["classification"], "derived-manual")
        for p in ("fonts/Fraunces-OFL.txt", "fonts/InterTight-OFL.txt"):
            self.assertEqual(by[p]["classification"], "licence-provenance")
            self.assertEqual(by[p]["release_class"], "candidate-unapproved")
        for e in inv["entries"]:
            self.assertEqual(e["approval_status"], "unknown")
        for p in ("docs/brand-governance.md", "docs/governance/decision-template.md",
                  "docs/governance/simulated-walkthrough.md", "tools/check_governance.py"):
            self.assertIn(p, by)


if __name__ == "__main__":
    unittest.main()
