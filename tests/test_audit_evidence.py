import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import audit_evidence as ae  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STATUS_LABEL = {"planned": "Planned", "verified": "Verified", "blocked": "Blocked",
                "in_progress": "In progress", "deferred": "Deferred"}


def crit(cid, status="planned", ev=None, rev=None):
    return {"id": cid, "status": status,
            "evidence_refs": ev if ev is not None else [],
            "tested_revision_refs": rev if rev is not None else []}


class Fixture(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        os.makedirs(os.path.join(self.root, "evidence", "a"))
        os.makedirs(os.path.join(self.root, "planning"))
        self.write("evidence/a/note.txt", "hello")
        self.sums("evidence/a", [("note.txt", None)])
        self.checklist([crit("AAA-01"), crit("AAA-02")])

    def write(self, rel, text):
        with open(os.path.join(self.root, rel), "w") as fh:
            fh.write(text)

    def sums(self, dirrel, entries, raw=None):
        lines = []
        for name, digest in entries:
            if digest is None:
                with open(os.path.join(self.root, dirrel, name), "rb") as fh:
                    digest = hashlib.sha256(fh.read()).hexdigest()
            lines.append("%s  %s" % (digest, name))
        self.write(dirrel + "/SHA256SUMS", raw if raw is not None else "\n".join(lines) + "\n")

    def checklist(self, criteria, md_status=None, allowed=None):
        data = {"allowed_statuses": allowed or list(ae.STATUSES), "criteria": criteria}
        self.write("planning/acceptance-checklist.json", json.dumps(data))
        md = ["# Checklist"]
        for c in criteria:
            st = (md_status or {}).get(c["id"], c["status"])
            label = STATUS_LABEL.get(st, st)
            box = "x" if st == "verified" else " "
            md += ["", "### %s Title" % c["id"], "", "- [%s] **%s** | P0 | Role" % (box, label)]
        self.write("planning/acceptance-checklist.md", "\n".join(md) + "\n")

    def audit(self):
        return ae.run(self.root)

    def codes(self):
        return sorted({e["code"] for e in self.audit()["errors"]})


class Positive(Fixture):
    def test_valid_fixture(self):
        r = self.audit()
        self.assertTrue(r["ok"])
        self.assertEqual(r["errors"], [])
        self.assertEqual(r["provider_mode"], "N/A")
        self.assertEqual(r["scope"], "integrity-only")
        self.assertEqual(r["counts"]["manifest_entries"], 1)
        self.assertEqual(r["status_counts"]["planned"], 2)

    def test_output_is_deterministic(self):
        self.assertEqual(json.dumps(self.audit(), sort_keys=True), json.dumps(self.audit(), sort_keys=True))

    def test_verified_with_refs_passes(self):
        self.checklist([crit("AAA-01", "verified", ["https://example/e"], ["repo abc123"])])
        self.assertTrue(self.audit()["ok"])

    def test_real_repository_is_valid(self):
        r = ae.run(REPO)
        self.assertEqual(r["errors"], [])
        self.assertEqual(r["counts"]["criteria_json"], r["counts"]["criteria_markdown"])


class Manifest(Fixture):
    def test_hash_mismatch(self):
        self.write("evidence/a/note.txt", "tampered")
        self.assertEqual(self.codes(), ["hash-mismatch"])

    def test_mismatch_does_not_leak_content(self):
        self.write("evidence/a/note.txt", "sk-SECRET-VALUE")
        self.assertNotIn("SECRET", json.dumps(self.audit()))

    def test_missing_file(self):
        os.remove(os.path.join(self.root, "evidence/a/note.txt"))
        self.assertEqual(self.codes(), ["missing-file"])

    def test_traversal(self):
        self.write("outside.txt", "x")
        d = hashlib.sha256(b"x").hexdigest()
        self.sums("evidence/a", [("../../outside.txt", d)])
        self.assertEqual(self.codes(), ["path-traversal"])

    def test_absolute_path(self):
        self.sums("evidence/a", [("/etc/hosts", "0" * 64)])
        self.assertEqual(self.codes(), ["unsafe-path"])

    def test_symlink_file_escape(self):
        with tempfile.TemporaryDirectory() as out:
            target = os.path.join(out, "secret.txt")
            with open(target, "w") as fh:
                fh.write("outside")
            os.symlink(target, os.path.join(self.root, "evidence/a/link.txt"))
            self.sums("evidence/a", [("link.txt", hashlib.sha256(b"outside").hexdigest())])
            self.assertEqual(self.codes(), ["symlink-escape"])

    def test_symlink_dir_escape(self):
        with tempfile.TemporaryDirectory() as out:
            with open(os.path.join(out, "f.txt"), "w") as fh:
                fh.write("o")
            os.symlink(out, os.path.join(self.root, "evidence/a/dirlink"))
            self.sums("evidence/a", [("dirlink/f.txt", hashlib.sha256(b"o").hexdigest())])
            self.assertEqual(self.codes(), ["symlink-dir", "symlink-escape"])

    def test_symlinked_manifest_escape(self):
        with tempfile.TemporaryDirectory() as out:
            real = os.path.join(out, "SHA256SUMS")
            with open(real, "w") as fh:
                fh.write("")
            os.remove(os.path.join(self.root, "evidence/a/SHA256SUMS"))
            os.symlink(real, os.path.join(self.root, "evidence/a/SHA256SUMS"))
            self.assertEqual(self.codes(), ["symlink-escape"])

    def test_duplicate_entry(self):
        self.sums("evidence/a", [("note.txt", None), ("note.txt", None)])
        self.assertEqual(self.codes(), ["duplicate-entry"])

    def test_malformed_entry_hides_content(self):
        self.sums("evidence/a", [], raw="password=hunter2\n")
        r = self.audit()
        self.assertEqual(self.codes(), ["malformed-entry"])
        self.assertNotIn("hunter2", json.dumps(r))

    def test_uppercase_digest_is_malformed(self):
        d = hashlib.sha256(b"hello").hexdigest().upper()
        self.sums("evidence/a", [("note.txt", d)])
        self.assertEqual(self.codes(), ["malformed-entry"])

    def test_no_manifests(self):
        os.remove(os.path.join(self.root, "evidence/a/SHA256SUMS"))
        self.assertEqual(self.codes(), ["no-manifests"])


class Checklist(Fixture):
    def test_duplicate_ids(self):
        self.checklist([crit("AAA-01"), crit("AAA-01")])
        self.assertIn("duplicate-id", self.codes())

    def test_unknown_state(self):
        self.checklist([crit("AAA-01", "done")])
        self.assertIn("unknown-state", self.codes())

    def test_allowed_states_changed(self):
        self.checklist([crit("AAA-01")], allowed=["planned", "done"])
        self.assertEqual(self.codes(), ["allowed-states"])

    def test_json_markdown_disagreement(self):
        self.checklist([crit("AAA-01", "blocked")], md_status={"AAA-01": "planned"})
        self.assertEqual(self.codes(), ["checklist-disagreement"])

    def test_id_missing_in_markdown(self):
        self.checklist([crit("AAA-01"), crit("AAA-02")])
        p = os.path.join(self.root, "planning/acceptance-checklist.md")
        with open(p) as fh:
            text = fh.read()
        self.write("planning/acceptance-checklist.md", text.replace("AAA-02", "AAA-09"))
        r = self.audit()
        self.assertEqual(len([e for e in r["errors"] if e["code"] == "checklist-disagreement"]), 2)

    def test_verified_requires_evidence_and_revisions(self):
        self.checklist([crit("AAA-01", "verified"), crit("AAA-02", "verified", [" "], ["r"])])
        r = self.audit()
        codes = [(e["id"], e["code"]) for e in r["errors"]]
        self.assertIn(("AAA-01", "verified-missing-evidence"), codes)
        self.assertIn(("AAA-01", "verified-missing-revisions"), codes)
        self.assertIn(("AAA-02", "verified-missing-evidence"), codes)

    def test_checkbox_mismatch(self):
        self.checklist([crit("AAA-01", "verified", ["e"], ["r"])])
        p = os.path.join(self.root, "planning/acceptance-checklist.md")
        with open(p) as fh:
            text = fh.read().replace("[x]", "[ ]")
        self.write("planning/acceptance-checklist.md", text)
        self.assertEqual(self.codes(), ["checkbox-mismatch"])


class Hardening(Fixture):
    JSON = "planning/acceptance-checklist.json"
    MD = "planning/acceptance-checklist.md"

    def md_text(self):
        with open(os.path.join(self.root, self.MD)) as fh:
            return fh.read()

    def test_duplicate_json_status_key(self):
        self.write(self.JSON, '{"allowed_statuses": %s, "criteria": [{"id": "AAA-01", '
                   '"status": "verified", "status": "planned"}]}' % json.dumps(list(ae.STATUSES)))
        r = self.audit()
        self.assertIn("duplicate-key", [e["code"] for e in r["errors"]])
        self.assertFalse(r["ok"])

    def test_duplicate_json_top_level_key(self):
        self.write(self.JSON, '{"criteria": [], "criteria": [{"id": "AAA-01"}]}')
        self.assertIn("duplicate-key", self.codes())

    def test_contradictory_second_markdown_status(self):
        self.write(self.MD, self.md_text().replace(
            "- [ ] **Planned** | P0 | Role", "- [ ] **Planned** | P0 | Role\n- Verify: x\n\nnote\n"
            "- [x] **Verified** | P0 | Role", 1))
        r = self.audit()
        self.assertIn(("AAA-01", "duplicate-status"), [(e.get("id"), e["code"]) for e in r["errors"]])

    def test_identical_duplicate_markdown_status(self):
        line = "- [ ] **Planned** | P0 | Role"
        self.write(self.MD, self.md_text().replace(line, line + "\n" + line, 1))
        self.assertIn("duplicate-status", self.codes())

    def test_symlinked_evidence_dir_not_skipped(self):
        os.makedirs(os.path.join(self.root, "evidence", "real"))
        self.write("evidence/real/f.txt", "z")
        self.sums("evidence/real", [("f.txt", None)])
        os.symlink(os.path.join(self.root, "evidence", "real"), os.path.join(self.root, "evidence", "linked"))
        r = self.audit()
        self.assertFalse(r["ok"])
        self.assertEqual([e["code"] for e in r["errors"]], ["symlink-dir"])
        self.assertEqual(r["counts"]["manifests"], 2)

    def test_symlinked_evidence_root(self):
        real = os.path.join(self.root, "realevidence")
        os.rename(os.path.join(self.root, "evidence"), real)
        os.symlink(real, os.path.join(self.root, "evidence"))
        r = self.audit()
        self.assertEqual([e["code"] for e in r["errors"]], ["symlink-dir"])

    def test_unknown_state_never_echoed(self):
        self.checklist([crit("AAA-01", "sk-SECRET-STATE")])
        self.write(self.MD, self.md_text())
        self.assertIn("unknown-state", self.codes())
        self.assertNotIn("SECRET", json.dumps(self.audit()))

    def test_unknown_markdown_state_never_echoed(self):
        self.write(self.MD, self.md_text().replace("**Planned**", "**sk-SECRET-MD**"))
        r = self.audit()
        self.assertIn("unknown-state", [e["code"] for e in r["errors"]])
        self.assertNotIn("SECRET", json.dumps(r))

    def test_arbitrary_id_never_echoed(self):
        self.checklist([crit("sk-SECRET-ID"), crit("sk-SECRET-ID")])
        r = self.audit()
        self.assertIn("invalid-id", [e["code"] for e in r["errors"]])
        self.assertNotIn("SECRET", json.dumps(r))

    def test_manifest_path_never_echoed(self):
        d = hashlib.sha256(b"hello").hexdigest()
        self.sums("evidence/a", [("sk-SECRET-missing.txt", d), ("../sk-SECRET-up", d)])
        self.assertNotIn("SECRET", json.dumps(self.audit()))

    def test_empty_json_criteria(self):
        self.write(self.JSON, json.dumps({"allowed_statuses": list(ae.STATUSES), "criteria": []}))
        self.assertIn("empty-checklist", self.codes())

    def test_empty_markdown_checklist(self):
        self.write(self.MD, "# Checklist\n")
        codes = self.codes()
        self.assertIn("empty-checklist", codes)
        self.assertIn("checklist-disagreement", codes)

    def test_both_empty_still_fails(self):
        self.checklist([])
        r = self.audit()
        self.assertFalse(r["ok"])
        self.assertEqual(r["error_counts"]["empty-checklist"], 2)

    def test_invalid_primitive_types_do_not_crash(self):
        bad_ids = [1, None, ["AAA-01"], {"a": 1}, True, "", "bad id"]
        bad_status = [1, None, ["planned"], {"a": 1}, True, ""]
        entries = [{"id": i, "status": "planned"} for i in bad_ids]
        entries += [{"id": "AAA-%02d" % (n + 10), "status": st} for n, st in enumerate(bad_status)]
        entries += [None, 5, "str", [1]]
        self.write(self.JSON, json.dumps({"allowed_statuses": list(ae.STATUSES), "criteria": entries}))
        r = self.audit()
        self.assertFalse(r["ok"])
        self.assertEqual(r["error_counts"]["invalid-id"], len(bad_ids))
        self.assertEqual(r["error_counts"]["unknown-state"] - 0, len(bad_status))
        self.assertEqual(r["error_counts"]["json-shape"], 4)

    def test_malformed_top_level_types(self):
        for text in ("[]", "null", '"x"', '{"criteria": {}}', '{"criteria": "x"}', "{", "\xff"):
            self.write(self.JSON, text)
            self.assertFalse(self.audit()["ok"], text)

    def test_invalid_utf8_checklists(self):
        for rel in (self.JSON, self.MD):
            with open(os.path.join(self.root, rel), "wb") as fh:
                fh.write(b"\xff\xfe")
        self.assertFalse(self.audit()["ok"])

    def test_deeply_nested_json_does_not_crash(self):
        self.write(self.JSON, "[" * 100000)
        self.assertFalse(self.audit()["ok"])

    def test_evidence_ref_type_errors(self):
        for refs in ("url", {"a": "b"}, [1], [None], [[]]):
            self.checklist([crit("AAA-01", "verified", refs, ["rev"])])
            self.assertIn("verified-missing-evidence", self.codes(), refs)


class NoPromotion(Fixture):
    def snapshot(self):
        out = {}
        for d, _, files in os.walk(self.root):
            for f in files:
                p = os.path.join(d, f)
                with open(p, "rb") as fh:
                    out[p] = fh.read()
        return out

    def test_mock_evidence_does_not_promote(self):
        self.checklist([crit("AAA-01", "planned", ["mock://provider/ok"], ["mock rev"])])
        before = self.snapshot()
        r = self.audit()
        self.assertTrue(r["ok"])
        self.assertEqual(r["status_counts"]["verified"], 0)
        self.assertEqual(r["status_counts"]["planned"], 1)
        self.assertEqual(r["provider_mode"], "N/A")
        self.assertEqual(before, self.snapshot())

    def test_verified_mock_ref_is_structural_success_only(self):
        self.checklist([crit("AAA-01", "verified", ["mock://provider/ok"], ["mock rev"])])
        before = self.snapshot()
        r = self.audit()
        self.assertTrue(r["ok"])
        self.assertEqual(r["errors"], [])
        self.assertEqual(r["status_counts"]["verified"], 1)
        # Structural pass only: scope stays integrity-only, no live claim is made.
        self.assertEqual(r["provider_mode"], "N/A")
        self.assertEqual(r["scope"], "integrity-only")
        self.assertFalse(any("live" in k for k in r))
        self.assertEqual(before, self.snapshot())

    def test_provider_env_is_ignored(self):
        os.environ["PROVIDER_MODE"] = "live"
        self.addCleanup(os.environ.pop, "PROVIDER_MODE", None)
        self.assertEqual(self.audit()["provider_mode"], "N/A")


class Cli(Fixture):
    def run_cli(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = ae.main(["--root", self.root])
        return rc, json.loads(buf.getvalue())

    def test_exit_zero_when_valid(self):
        rc, out = self.run_cli()
        self.assertEqual((rc, out["ok"]), (0, True))

    def test_exit_nonzero_when_invalid(self):
        self.write("evidence/a/note.txt", "x")
        rc, out = self.run_cli()
        self.assertEqual((rc, out["ok"]), (1, False))
        self.assertEqual(out["error_counts"], {"hash-mismatch": 1})


if __name__ == "__main__":
    unittest.main()
