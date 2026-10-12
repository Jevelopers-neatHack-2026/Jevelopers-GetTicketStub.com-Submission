"""Tests for tools/check_provenance.py. Run: python3 -m unittest discover -s tools/tests

Every fixture is SYNTHETIC: invented files, invented reviewer, invented evidence. None of it is a real
approval, rights clearance or review, and the production check refuses synthetic data unless a test
explicitly opts in.
"""
import contextlib
import io
import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
import check_provenance as cp  # noqa: E402

SYN = "SYNTHETIC FIXTURE - NOT A REAL APPROVAL"


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


class Fixture(unittest.TestCase):
    FILES = {"logo/mark.svg": b"<svg>synthetic mark</svg>", "logo/notice.txt": b"synthetic notice text",
             "references/ref.webp": b"synthetic reference bytes", "fonts/F.ttf": b"synthetic font bytes",
             "fonts/F-OFL.txt": b"synthetic font notice", "docs/evidence.md": b"synthetic evidence doc"}

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for rel, data in self.FILES.items():
            (self.tmp / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.tmp / rel).write_bytes(data)
        self.reg = {"schema_version": 1, "synthetic": True, "hash_algorithm": "sha256", "source_revision": "synthetic",
                    "scope_prefixes": list(cp.REQUIRED_SCOPE), "statement": SYN,
                    "records": [
                        self.rec("logo/mark.svg", "first-party-canonical", release="candidate", approved=True,
                                 notice_required="yes", notice_files=["logo/notice.txt"]),
                        self.rec("logo/notice.txt", "licence-notice", release="candidate", approved=True, notice_required="no"),
                        self.rec("references/ref.webp", "reference-unknown", release="excluded"),
                        self.rec("fonts/F.ttf", "licensed-dependency", release="excluded", approved=True, notice_required="yes",
                                 notice_files=["fonts/F-OFL.txt"]),
                        self.rec("fonts/F-OFL.txt", "licence-notice", release="excluded", notice_required="no")]}
        self.al = {"schema_version": 1, "synthetic": True, "status": "reviewed", "source_revision": "synthetic",
                   "statement": SYN,
                   "review": {"reviewer": "synthetic-reviewer", "evidence": "docs/evidence.md", "date": "2000-01-01"},
                   "entries": [self.entry("logo/mark.svg"), self.entry("logo/notice.txt")]}
        self.write()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def rec(self, path, cls, release, approved=False, notice_required="no", notice_files=()):
        data = self.FILES[path]
        r = dict(path=path, sha256=sha(data), size_bytes=len(data), introduced_in="synthetic", classification=cls,
                 core=cp.is_core(path, cls), origin=SYN, origin_evidence=["docs/evidence.md"],
                 creator_rights_holder=SYN, source_version=cp.UNKNOWN, derivation=cp.UNKNOWN, tooling=cp.UNKNOWN,
                 notice_required=notice_required, notice_files=list(notice_files),
                 rights_status="cleared" if approved else cp.UNKNOWN,
                 intended_uses=["synthetic use"], permitted_uses=["synthetic use"] if approved else cp.UNKNOWN,
                 restrictions=["synthetic restriction"] if approved else cp.UNKNOWN,
                 reviewer="synthetic-reviewer" if approved else cp.UNKNOWN,
                 approval=dict(status="approved" if approved else cp.UNKNOWN,
                               evidence="docs/evidence.md" if approved else cp.UNKNOWN,
                               date="2000-01-01" if approved else cp.UNKNOWN),
                 disposition=dict(release=release, rationale=SYN), notes=[SYN])
        return r

    def entry(self, path):
        return {"path": path, "sha256": sha(self.FILES[path]), "use": "synthetic use"}

    def write(self):
        (self.tmp / "provenance").mkdir(exist_ok=True)
        (self.tmp / cp.REGISTER).write_text(json.dumps(self.reg))
        (self.tmp / cp.ALLOWLIST).write_text(json.dumps(self.al))

    def structural(self):
        return "\n".join(cp.run(self.tmp, False))

    def production(self, synthetic_ok=True):
        return "\n".join(cp.run(self.tmp, True, allow_synthetic=synthetic_ok))


class RegisterTests(Fixture):
    def test_valid_register_passes(self):
        self.assertEqual(self.structural(), "")

    def test_unknowns_are_honest_and_pass(self):
        self.assertEqual(self.structural(), "")  # reference + font records are all UNKNOWN

    def test_missing_hash_field(self):
        del self.reg["records"][0]["sha256"]
        self.write()
        self.assertIn("missing field 'sha256'", self.structural())

    def test_malformed_hash(self):
        self.reg["records"][0]["sha256"] = "abc"
        self.write()
        self.assertIn("64 lowercase hex", self.structural())

    def test_stale_bytes(self):
        (self.tmp / "logo/mark.svg").write_bytes(b"changed after registration")
        self.assertIn("does not match the file bytes", self.structural())

    def test_unregistered_file(self):
        (self.tmp / "logo/new.svg").write_bytes(b"x")
        self.assertIn("unregistered file: 'logo/new.svg'", self.structural())

    def test_registered_file_removed(self):
        (self.tmp / "references/ref.webp").unlink()
        out = self.structural()
        self.assertIn("file does not exist", out)

    def test_empty_field_must_say_unknown(self):
        self.reg["records"][2]["origin"] = ""
        self.write()
        self.assertIn("write UNKNOWN", self.structural())

    def test_missing_register_input(self):
        (self.tmp / cp.REGISTER).unlink()
        self.assertIn("missing required input", self.structural())
        self.assertIn("missing required input", self.production())

    def test_missing_allowlist_input(self):
        (self.tmp / cp.ALLOWLIST).unlink()
        self.assertIn("missing required input", self.structural())

    def test_invalid_json(self):
        (self.tmp / cp.REGISTER).write_text("{")
        self.assertIn("invalid JSON", self.structural())

    def test_path_traversal_in_register(self):
        for bad in ("../outside.svg", "/etc/passwd", "logo/../../x", "logo//x.svg", "logo\\x.svg"):
            self.reg["records"][0]["path"] = bad
            self.write()
            self.assertTrue(cp.run(self.tmp, False), bad)

    def test_path_traversal_in_allowlist(self):
        self.al["entries"][0]["path"] = "../x"
        self.write()
        self.assertIn("traversal", self.structural())

    def test_symlink_escape(self):
        outside = Path(tempfile.mkdtemp())
        try:
            (outside / "secret.svg").write_bytes(b"x")
            (self.tmp / "logo/link.svg").symlink_to(outside / "secret.svg")
            self.reg["records"].append(self.rec("logo/mark.svg", "first-party-canonical", "candidate"))
            self.reg["records"][-1]["path"] = "logo/link.svg"
            self.write()
            self.assertIn("symlink", self.structural())
        finally:
            shutil.rmtree(outside)

    def test_reference_cannot_be_first_party(self):
        self.reg["records"][2]["classification"] = "first-party-canonical"
        self.write()
        self.assertIn("cannot be classified first-party", self.structural())

    def test_reference_must_be_excluded(self):
        self.reg["records"][2]["disposition"]["release"] = "candidate"
        self.write()
        self.assertIn("must have disposition.release 'excluded'", self.structural())

    def test_font_must_stay_source_only(self):
        self.reg["records"][3]["disposition"]["release"] = "candidate"
        self.write()
        self.assertIn("source-only", self.structural())

    def test_approved_needs_evidence(self):
        self.reg["records"][0]["approval"]["evidence"] = cp.UNKNOWN
        self.write()
        self.assertIn("approved but approval.evidence is UNKNOWN", self.structural())

    def test_notice_required_needs_files(self):
        self.reg["records"][0]["notice_files"] = []
        self.write()
        self.assertIn("notice_files is empty", self.structural())

    def test_notice_file_must_be_registered(self):
        self.reg["records"][0]["notice_files"] = ["logo/ghost.txt"]
        self.write()
        self.assertIn("not a register record", self.structural())

    def test_secret_like_string_rejected_without_echo(self):
        token = "ghp_" + "a" * 30
        self.reg["records"][2]["notes"] = [f"see {token}"]
        self.write()
        out = self.structural()
        self.assertIn("GitHub token", out)
        self.assertNotIn(token, out)

    def test_email_and_url_credentials_rejected(self):
        self.reg["records"][2]["notes"] = ["contact someone@example.com"]
        self.write()
        self.assertIn("email address", self.structural())
        self.reg["records"][2]["notes"] = ["https://x.example/a?sig=1234"]
        self.write()
        self.assertIn("URL with credentials or query", self.structural())

    def test_evidence_must_be_safe_reference(self):
        self.reg["records"][2]["origin_evidence"] = ["docs/ghost.md"]
        self.write()
        self.assertIn("not a tracked file", self.structural())
        self.reg["records"][2]["origin_evidence"] = ["restricted:contract-17"]
        self.write()
        self.assertEqual(self.structural(), "")


class ProductionTests(Fixture):
    def test_valid_synthetic_fixture_passes_only_when_opted_in(self):
        self.assertEqual(self.production(), "")
        self.assertIn("synthetic fixture data can never be release evidence", self.production(synthetic_ok=False))

    def test_real_repository_fails_production_closed(self):
        # The shipped allowlist is empty and core rights are UNKNOWN, so production must never pass here.
        # (Structure of the real register is covered by `make check-provenance-register`.)
        root = HERE.parents[2]
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cp.main(["--root", str(root)]), 1)
        al = json.loads((root / cp.ALLOWLIST).read_text())
        self.assertEqual(al["entries"], [])
        self.assertFalse(al["synthetic"])

    def test_empty_allowlist_fails(self):
        self.al["entries"] = []
        self.write()
        self.assertIn("allowlist is empty", self.production())

    def test_unreviewed_allowlist_fails(self):
        self.al["review"]["reviewer"] = cp.UNKNOWN
        self.al["status"] = "draft"
        self.write()
        out = self.production()
        self.assertIn("review.reviewer is UNKNOWN", out)
        self.assertIn("not 'reviewed'", out)

    def test_unknown_approval_fails(self):
        self.reg["records"][0]["approval"] = dict(status=cp.UNKNOWN, evidence=cp.UNKNOWN, date=cp.UNKNOWN)
        self.reg["records"][0]["rights_status"] = cp.UNKNOWN
        self.write()
        self.assertIn("no approval with evidence", self.production())

    def test_unknown_core_rights_block_even_with_valid_allowlist(self):
        self.reg["records"][0]["rights_status"] = cp.UNKNOWN
        self.write()
        out = self.production()
        self.assertIn("core asset rights/approval not cleared", out)
        self.assertIn("rights_status is not cleared", out)

    def test_core_unknown_elsewhere_blocks(self):
        extra = self.rec("logo/mark.svg", "first-party-canonical", "candidate")
        extra["path"] = "logo/extra.svg"
        (self.tmp / "logo/extra.svg").write_bytes(self.FILES["logo/mark.svg"])
        self.reg["records"].append(extra)
        self.write()
        self.assertIn("core asset rights/approval not cleared", self.production())

    def test_internal_only_fails(self):
        self.reg["records"][0]["classification"] = "internal"
        self.write()
        self.assertIn("excluded", self.production())

    def test_thirdparty_candidate_fails(self):
        self.reg["records"][0]["classification"] = "third-party-candidate"
        self.write()
        self.assertIn("excluded", self.production())

    def test_reference_in_allowlist_fails(self):
        self.al["entries"].append(self.entry_for_ref())
        self.write()
        self.assertIn("excluded from release", self.production())

    def entry_for_ref(self):
        return {"path": "references/ref.webp", "sha256": sha(self.FILES["references/ref.webp"]), "use": "synthetic use"}

    def test_font_in_allowlist_fails(self):
        self.al["entries"].append({"path": "fonts/F.ttf", "sha256": sha(self.FILES["fonts/F.ttf"]), "use": "synthetic use"})
        self.write()
        self.assertIn("never exported", self.production())

    def test_missing_notice_fails(self):
        self.al["entries"] = [self.entry("logo/mark.svg")]
        self.write()
        self.assertIn("required notice 'logo/notice.txt' is not in the allowlist", self.production())

    def test_notice_requirement_unknown_fails(self):
        self.reg["records"][0]["notice_required"] = cp.UNKNOWN
        self.write()
        self.assertIn("notice_required is UNKNOWN", self.production())

    def test_allowlist_hash_missing_or_wrong_fails(self):
        self.al["entries"][0]["sha256"] = "0" * 64
        self.write()
        self.assertIn("allowlist hash does not match", self.production())
        del self.al["entries"][0]["sha256"]
        self.write()
        self.assertIn("sha256 must be 64", "\n".join(cp.run(self.tmp, True, allow_synthetic=True)))

    def test_stale_bytes_fail_production(self):
        (self.tmp / "logo/mark.svg").write_bytes(b"edited after approval")
        out = self.production()
        self.assertIn("does not match", out)

    def test_use_not_permitted_fails(self):
        self.al["entries"][0]["use"] = "something else"
        self.write()
        self.assertIn("not among the register's permitted_uses", self.production())

    def test_missing_permitted_uses_fails(self):
        self.reg["records"][0]["permitted_uses"] = cp.UNKNOWN
        self.reg["records"][0]["rights_status"] = cp.UNKNOWN
        self.write()
        self.assertIn("permitted_uses is UNKNOWN", self.production())

    def test_unreviewed_entry_not_in_register_fails(self):
        self.al["entries"].append({"path": "logo/ghost.svg", "sha256": "0" * 64, "use": "x"})
        self.write()
        self.assertIn("not in the register", self.production())

    def test_path_traversal_fails(self):
        self.al["entries"][0]["path"] = "../../etc/passwd"
        self.write()
        self.assertIn("traversal", self.production())

    def test_missing_inputs_fail(self):
        (self.tmp / cp.ALLOWLIST).unlink()
        self.assertIn("missing required input", self.production())


class StrictTypeTests(Fixture):
    """Exact types and meaningful values; malformed shapes must be reported, never crash or pass."""

    def fails(self, fragment, production=False):
        self.write()
        out = self.production() if production else self.structural()
        self.assertIn(fragment, out)

    def approval(self, **kw):
        self.reg["records"][0]["approval"].update(kw)

    def test_whitespace_or_padded_reviewer_rejected(self):
        for bad in ("   ", " alice", "alice ", "\t", "TBD", "unknown", "N/A", "none"):
            self.reg["records"][0]["reviewer"] = bad
            self.write()
            self.assertRegex(self.structural(), "reviewer (must be UNKNOWN or a meaningful|is empty)|'reviewer' is empty", bad)
        self.reg["records"][0]["reviewer"] = " alice"
        self.fails("reviewer must be UNKNOWN or a meaningful")

    def test_approved_with_unknown_reviewer_rejected(self):
        self.reg["records"][0]["reviewer"] = cp.UNKNOWN
        self.fails("approved but reviewer is UNKNOWN")

    def test_non_string_reviewer_rejected(self):
        for bad in (True, 7, ["alice"], {"n": "alice"}):
            self.reg["records"][0]["reviewer"] = bad
            self.fails("reviewer must be UNKNOWN or a meaningful")

    def test_approval_evidence_empty_list_or_blank_rejected(self):
        for bad in ([], ["docs/evidence.md"], "", "   ", " docs/evidence.md", True, 0, {}):
            self.approval(evidence=bad)
            self.write()
            out = self.structural()
            self.assertTrue(out, repr(bad))

    def test_approval_evidence_must_be_single_string(self):
        self.approval(evidence=["docs/evidence.md"])
        self.fails("single string reference")

    def test_boolean_and_malformed_dates_rejected(self):
        for bad in (True, False, 20000101, "2000-13-45", "2000-02-30", "2000-1-1", "yesterday", "", "  ", [], "2000-01-01T00:00:00"):
            self.approval(date=bad)
            self.write()
            self.assertTrue(self.structural(), repr(bad))
        self.approval(date=True)
        self.fails("approval.date must be UNKNOWN or a real ISO date")

    def test_approved_needs_real_date_not_unknown(self):
        self.approval(date=cp.UNKNOWN)
        self.fails("approved but approval.date is UNKNOWN or not a real ISO date")

    def test_invalid_approval_status_rejected_without_crash(self):
        for bad in ("pending", "APPROVED", "Approved ", "", [], {}, True, None):
            self.approval(status=bad)
            self.write()
            out = self.structural()
            self.assertTrue(out, repr(bad))
        self.approval(status="pending")
        self.fails("approval.status must be one of")

    def test_unknown_status_with_evidence_is_inconsistent(self):
        self.approval(status=cp.UNKNOWN)
        self.fails("status is UNKNOWN but evidence or date is present")

    def test_approval_object_extra_or_missing_keys_rejected(self):
        self.reg["records"][0]["approval"]["extra"] = "x"
        self.fails("exactly status, evidence and date")

    def test_rights_cleared_needs_approval_proof(self):
        self.reg["records"][0]["approval"] = dict(status=cp.UNKNOWN, evidence=cp.UNKNOWN, date=cp.UNKNOWN)
        self.fails("rights_status cleared needs an approval")

    def test_rights_cleared_needs_known_uses(self):
        self.reg["records"][0]["permitted_uses"] = cp.UNKNOWN
        self.fails("cleared needs known permitted_uses")

    def test_rights_status_exact_values(self):
        for bad in ("Cleared", "cleared ", True, ["cleared"], "yes"):
            self.reg["records"][0]["rights_status"] = bad
            self.fails("rights_status must be UNKNOWN or cleared")

    def test_use_lists_must_be_lists_of_meaningful_strings(self):
        for field in ("intended_uses", "permitted_uses", "restrictions"):
            for bad in ("synthetic use", [""], ["  "], [cp.UNKNOWN], [1], [True], [[]], {"a": "b"}):
                self.reg["records"][0][field] = bad
                self.write()
                self.assertIn(f"'{field}' must be UNKNOWN or a non-empty list", self.structural(), (field, bad))

    def test_boolean_size_and_non_string_fields_rejected(self):
        self.reg["records"][2]["size_bytes"] = True
        self.fails("size_bytes must be an integer")
        for key in ("origin", "tooling", "source_version", "creator_rights_holder", "introduced_in"):
            self.reg["records"][2][key] = True
            self.fails(f"'{key}' must be UNKNOWN")
            self.reg["records"][2][key] = "x"
            self.write()
            self.assertIn(f"'{key}' must be UNKNOWN", self.structural())
            self.reg["records"][2][key] = cp.UNKNOWN

    def test_origin_evidence_must_be_nonempty_list_of_references(self):
        for bad in ([], [""], [True], "docs/evidence.md", [cp.UNKNOWN], [["docs/evidence.md"]]):
            self.reg["records"][2]["origin_evidence"] = bad
            self.write()
            self.assertTrue(self.structural(), repr(bad))

    def test_wrong_typed_classification_and_disposition_do_not_crash(self):
        for bad in ([], {}, True, None, 3):
            self.reg["records"][2]["classification"] = bad
            self.write()
            self.assertTrue(self.structural())
        self.reg["records"][2]["classification"] = "reference-unknown"
        for bad in ([], {}, True, 3):
            self.reg["records"][2]["disposition"]["release"] = bad
            self.write()
            self.assertTrue(self.structural())
        self.reg["records"][2]["disposition"] = {"release": "excluded", "rationale": "  "}
        self.fails("meaningful rationale")

    def test_notice_files_wrong_types_do_not_crash(self):
        for bad in ([["logo/notice.txt"]], [1], [None], "logo/notice.txt"):
            self.reg["records"][0]["notice_files"] = bad
            self.write()
            self.assertTrue(self.structural())

    def test_allowlist_review_strict(self):
        for key, bad in (("reviewer", "   "), ("reviewer", True), ("evidence", []), ("evidence", ["docs/evidence.md"]),
                         ("evidence", ""), ("evidence", "  "), ("date", True), ("date", "2000-99-99"), ("date", ""), ("date", 5)):
            self.al["review"] = {"reviewer": "synthetic-reviewer", "evidence": "docs/evidence.md", "date": "2000-01-01"}
            self.al["review"][key] = bad
            self.write()
            self.assertTrue(self.structural(), (key, bad))

    def test_allowlist_review_not_accepted_in_production(self):
        for key, bad in (("reviewer", "   "), ("reviewer", cp.UNKNOWN), ("evidence", cp.UNKNOWN), ("date", cp.UNKNOWN)):
            self.al["review"] = {"reviewer": "synthetic-reviewer", "evidence": "docs/evidence.md", "date": "2000-01-01"}
            self.al["review"][key] = bad
            self.write()
            self.assertTrue(self.production(), (key, bad))

    def test_allowlist_status_and_use_strict(self):
        self.al["status"] = "Reviewed"
        self.fails("status must be one of")
        self.al["status"] = "reviewed"
        for bad in ("", "  ", True, ["synthetic use"], None):
            self.al["entries"][0]["use"] = bad
            self.write()
            self.assertIn("needs a 'use'", self.structural(), repr(bad))


class UseMembershipTests(Fixture):
    def test_string_permitted_uses_does_not_bypass_membership(self):
        # A bare string used to skip the exact-membership test (substring/ignored). Call production directly
        # so the structural guard cannot be what makes this pass.
        self.reg["records"][0]["permitted_uses"] = "synthetic use"
        self.al["entries"][0]["use"] = "use"
        out = "\n".join(cp.production_problems(self.tmp, self.reg, self.al, allow_synthetic=True))
        self.assertIn("permitted_uses is UNKNOWN", out)
        self.write()
        self.assertIn("'permitted_uses' must be UNKNOWN or a non-empty list", self.structural())

    def test_substring_and_case_variants_of_use_rejected(self):
        for bad in ("synthetic", "Synthetic Use", "use"):
            self.al["entries"][0]["use"] = bad
            self.write()
            self.assertIn("not among the register's permitted_uses", self.production())

    def test_exact_use_passes(self):
        self.assertEqual(self.production(), "")


class ScopeAndCoreTests(Fixture):
    def test_narrowed_scope_is_rejected(self):
        self.reg["scope_prefixes"] = ["logo/"]
        self.write()
        self.assertIn("must include the complete required scope", self.structural())
        self.assertIn("must include the complete required scope", self.production())

    def test_narrowed_scope_still_covers_fonts_and_references(self):
        self.reg["scope_prefixes"] = ["logo/"]
        self.reg["records"] = [r for r in self.reg["records"] if r["path"].startswith("logo/")]
        self.write()
        out = self.structural()
        self.assertIn("unregistered file: 'references/ref.webp'", out)
        self.assertIn("unregistered file: 'fonts/F.ttf'", out)

    def test_extra_prefixes_are_allowed(self):
        (self.tmp / "extra").mkdir()
        (self.tmp / "extra/a.txt").write_bytes(b"a")
        self.reg["scope_prefixes"] = list(cp.REQUIRED_SCOPE) + ["extra/"]
        self.write()
        self.assertIn("unregistered file: 'extra/a.txt'", self.structural())

    def test_core_false_flag_on_core_asset_is_rejected(self):
        self.reg["records"][0]["core"] = False
        self.write()
        self.assertIn("core must be true", self.structural())
        self.assertIn("core must be true", self.production())

    def test_core_false_cannot_suppress_blockers_even_past_structure(self):
        r = self.reg["records"][0]
        r.update(core=False, rights_status=cp.UNKNOWN, permitted_uses=cp.UNKNOWN)
        r["approval"] = dict(status=cp.UNKNOWN, evidence=cp.UNKNOWN, date=cp.UNKNOWN)
        out = "\n".join(cp.production_problems(self.tmp, self.reg, self.al, allow_synthetic=True))
        self.assertIn("core asset rights/approval not cleared", out)

    def test_reclassifying_a_core_path_does_not_remove_core_status(self):
        r = self.reg["records"][0]
        r.update(classification="internal", core=False, rights_status=cp.UNKNOWN, permitted_uses=cp.UNKNOWN)
        r["approval"] = dict(status=cp.UNKNOWN, evidence=cp.UNKNOWN, date=cp.UNKNOWN)
        r["disposition"]["release"] = "excluded"
        out = "\n".join(cp.production_problems(self.tmp, self.reg, self.al, allow_synthetic=True))
        self.assertIn("core asset rights/approval not cleared", out)
        self.write()
        self.assertIn("core must be true", self.structural())

    def test_core_true_on_noncore_path_is_rejected(self):
        self.reg["records"][2]["core"] = True
        self.write()
        self.assertIn("core must be false", self.structural())

    def test_licence_text_is_not_core_but_a_logo_relabelled_notice_is(self):
        self.assertFalse(cp.is_core("fonts/X-OFL.txt", "licence-notice"))
        self.assertTrue(cp.is_core("logo/x.svg", "licence-notice"))
        self.assertTrue(cp.is_core("tokens/tokens.json", "internal"))
        self.assertFalse(cp.is_core("docs/assets/readme/banner-day.svg", "first-party-readme"))
        self.assertFalse(cp.is_core("references/a.webp", "reference-unknown"))


class LicenceNoticeTests(Fixture):
    def test_notice_accompanies_eligible_asset_without_relabelling(self):
        self.assertEqual(self.reg["records"][1]["classification"], "licence-notice")
        self.assertEqual(self.production(), "")

    def test_asset_without_its_notice_in_allowlist_fails(self):
        self.al["entries"] = [self.entry("logo/mark.svg")]
        self.write()
        self.assertIn("required notice 'logo/notice.txt' is not in the allowlist", self.production())

    def test_notice_without_its_asset_fails(self):
        self.al["entries"] = [self.entry("logo/notice.txt")]
        self.write()
        self.assertIn("no allowlisted eligible non-font asset", self.production())

    def test_notice_hash_must_match(self):
        self.al["entries"][1]["sha256"] = "0" * 64
        self.write()
        self.assertIn("allowlist hash does not match", self.production())
        (self.tmp / "logo/notice.txt").write_bytes(b"edited notice")
        self.assertIn("does not match the file bytes", self.production())

    def test_notice_needs_its_own_approval_and_use(self):
        self.reg["records"][1]["approval"] = dict(status=cp.UNKNOWN, evidence=cp.UNKNOWN, date=cp.UNKNOWN)
        self.reg["records"][1]["rights_status"] = cp.UNKNOWN
        self.write()
        self.assertIn("no approval with evidence", self.production())
        self.reg["records"][1].update(rights_status="cleared", permitted_uses=["another use"])
        self.reg["records"][1]["approval"] = dict(status="approved", evidence="docs/evidence.md", date="2000-01-01")
        self.write()
        self.assertIn("not among the register's permitted_uses", self.production())

    def test_notice_candidate_must_be_disposition_candidate(self):
        self.reg["records"][1]["disposition"]["release"] = "excluded"
        self.write()
        self.assertIn("register disposition is 'excluded'", self.production())

    def test_font_notice_cannot_be_candidate(self):
        n = self.reg["records"][4]
        n["disposition"]["release"] = "candidate"
        self.write()
        self.assertIn("covers an eligible non-font candidate asset", self.structural())

    def test_font_notice_in_allowlist_fails(self):
        self.al["entries"].append({"path": "fonts/F-OFL.txt", "sha256": sha(self.FILES["fonts/F-OFL.txt"]), "use": "synthetic use"})
        self.write()
        self.assertTrue(self.production())

    def test_font_binary_still_forbidden_even_with_notice(self):
        self.al["entries"] += [{"path": "fonts/F.ttf", "sha256": sha(self.FILES["fonts/F.ttf"]), "use": "synthetic use"},
                               {"path": "fonts/F-OFL.txt", "sha256": sha(self.FILES["fonts/F-OFL.txt"]), "use": "synthetic use"}]
        self.write()
        out = self.production()
        self.assertIn("never exported", out)
        self.assertIn("register disposition is 'excluded'", out)

    def test_notice_files_must_point_to_notice_class(self):
        self.reg["records"][0]["notice_files"] = ["references/ref.webp"]
        self.write()
        self.assertIn("is not classified licence-notice", self.structural())

    def test_orphan_notice_rejected(self):
        self.reg["records"][0]["notice_required"] = "no"
        self.reg["records"][0]["notice_files"] = []
        self.write()
        self.assertIn("not named by any record's notice_files", self.structural())


class NoLeakTests(Fixture):
    TOKEN = "ghp_" + "Q7x" * 12
    ENTROPY = "Zk39fQ81LmXp02VbN7sT4uYc6WdR5eH"

    def run_main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cp.main(["--root", str(self.tmp), *args])
        return code, out.getvalue() + err.getvalue()

    def assertClean(self, text):
        for needle in (self.TOKEN, self.ENTROPY, "Q7xQ7x"):
            self.assertNotIn(needle, text)

    def test_token_in_many_fields_is_never_echoed_by_any_diagnostic(self):
        for secret in (self.TOKEN, self.ENTROPY):
            self.setUp()
            r0, r2 = self.reg["records"][0], self.reg["records"][2]
            r0["classification"] = secret
            r0["disposition"]["release"] = secret
            r0["notice_files"] = [secret, "logo/" + secret + ".txt"]
            r0["approval"]["status"] = secret
            r0["approval"]["evidence"] = secret
            r0["origin_evidence"] = [secret, "docs/" + secret]
            r2["path"] = "references/" + secret + ".webp"
            r2["rights_status"] = secret
            r2["permitted_uses"] = [secret]
            self.reg["records"].append(dict(self.reg["records"][1], path="logo/" + secret + ".svg"))
            self.al["entries"][0]["use"] = secret
            self.al["entries"].append({"path": "logo/" + secret, "sha256": secret, "use": secret})
            self.al["review"] = {"reviewer": secret, "evidence": secret, "date": secret}
            self.al["status"] = secret
            (self.tmp / ("logo/" + secret + ".svg")).write_bytes(b"x")
            self.write()
            for args in ((), ("--register-only",), ("--report",)):
                code, text = self.run_main(*args)
                self.assertEqual(code, 1, args)
                self.assertClean(text)
                self.assertIn("FAIL", text)

    def test_secret_in_register_reports_once_without_later_echo(self):
        self.reg["records"][2]["notes"] = [f"see {self.TOKEN}"]
        self.reg["records"][2]["origin_evidence"] = [self.TOKEN]
        self.reg["records"][0]["notice_files"] = [self.TOKEN]
        self.write()
        code, text = self.run_main("--register-only")
        self.assertEqual(code, 1)
        self.assertIn("GitHub token", text)
        self.assertClean(text)

    def test_token_shaped_path_in_file_listing_is_withheld(self):
        (self.tmp / f"logo/{self.TOKEN}.svg").write_bytes(b"x")
        code, text = self.run_main("--register-only")
        self.assertEqual(code, 1)
        self.assertIn("unregistered file: <withheld>", text)
        self.assertClean(text)

    def test_malformed_json_and_crashes_do_not_echo_input(self):
        (self.tmp / cp.REGISTER).write_text('{"records": ["' + self.TOKEN + '"')
        code, text = self.run_main()
        self.assertEqual(code, 1)
        self.assertClean(text)

    def test_unexpected_exception_fails_closed_without_values(self):
        self.write()
        original = cp.run
        def boom(*a, **k):
            raise ValueError(self.TOKEN)
        cp.run = boom
        try:
            code, text = self.run_main()
        finally:
            cp.run = original
        self.assertEqual(code, 1)
        self.assertIn("ValueError", text)
        self.assertClean(text)

    def test_show_withholds_suspicious_values(self):
        self.assertEqual(cp.show(self.TOKEN), "<withheld>")
        self.assertEqual(cp.show(self.ENTROPY), "<withheld>")
        self.assertEqual(cp.show("x" * 101), "<withheld>")
        self.assertEqual(cp.show("a\nb"), "<withheld>")
        self.assertEqual(cp.show(["x"]), "<list>")
        self.assertEqual(cp.show("logo/ts-stamp-mono-orange.svg"), "'logo/ts-stamp-mono-orange.svg'")


if __name__ == "__main__":
    unittest.main()
