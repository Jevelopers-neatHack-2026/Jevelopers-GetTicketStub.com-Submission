import contextlib
import copy
import io
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import rerun_report as rr  # noqa: E402

TOOL = os.path.join(os.path.dirname(__file__), "..", "tools", "rerun_report.py")
PIN = "a" * 40
SECRET = "SUPERSECRET-token-xyz"


def slurp(path, mode="rb"):
    with open(path, mode) as fh:
        return fh.read()


def run_rec(i, outcome="failed", kind="test_failure", base=None):
    rec = {
        "run_id": "run-%d" % i,
        "parent_run_id": None if i == 0 else "run-%d" % (i - 1),
        "attempt_index": i,
        "outcome": outcome,
        "error_kind": kind,
        "rationale": "why " + SECRET,
        "occurred_at": "2026-01-01T00:0%d:00Z" % i,
        "pins": {"repo": PIN},
        "fixture_digest": "b" * 64,
        "config_digest": "c" * 64,
        "seed": "seed-" + SECRET,
        "provider_modes": {"dispatch": "mock"},
    }
    return rec


def record(outcomes=(("failed", "test_failure"),), **over):
    rec = {
        "format_version": 1,
        "case_id": "case-1",
        "requirement_ids": ["REQ-1", "REQ-2"],
        "mandatory": True,
        "category": "functional",
        "provider_modes": {"dispatch": "mock"},
        "pins": {"repo": PIN},
        "fixture_digest": "b" * 64,
        "config_digest": "c" * 64,
        "seed": "seed-" + SECRET,
        "runs": [run_rec(i, o, k) for i, (o, k) in enumerate(outcomes)],
    }
    rec.update(over)
    return rec


def quarantine(**over):
    q = {"reason": "r " + SECRET, "owner_role": "owner", "remediation_issue":
         "https://github.com/org/repo/issues/12", "expiry": "2026-06-01T00:00:00Z",
         "reproduction_command": "rm -rf / " + SECRET, "failure_signature": "sig",
         "last_good_revision": None, "last_bad_revision": PIN}
    q.update(over)
    return q


def codes(data):
    return {c for c, _ in rr.validate(data)}


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = tmp.name

    def write(self, data, name="in.json"):
        path = os.path.join(self.dir, name)
        with open(path, "wb") as fh:
            fh.write(data if isinstance(data, bytes) else json.dumps(data).encode())
        return path

    def cli(self, path, *extra):
        p = subprocess.run([sys.executable, "-I", TOOL] + list(extra) + [path],
                           capture_output=True, text=True, timeout=30)
        return p.returncode, p.stdout, p.stderr

    def report(self, data):
        raw = json.dumps(data).encode()
        self.assertEqual(rr.validate(data), [])
        return rr.build_report(copy.deepcopy(data), raw)


class Decisions(Base):
    def test_candidate_single_original_failure(self):
        r = self.report(record())
        self.assertEqual((r["decision"], r["classification"]), ("diagnostic_candidate", "consistently_failed"))
        self.assertFalse(r["rerun_authorized"])
        self.assertFalse(r["release_verified"])
        self.assertTrue(r["release_blocked"])
        self.assertEqual((r["failure_count"], r["total_runs"]), (1, 1))

    def test_candidate_after_one_rerun_not_after_two(self):
        two = self.report(record((("failed", "test_failure"),) * 2))
        self.assertEqual(two["decision"], "diagnostic_candidate")
        three = self.report(record((("failed", "test_failure"),) * 3))
        self.assertEqual((three["decision"], three["decision_reason"]),
                         ("stop", "rerun_cap_reached"))

    def test_cap_of_two_reruns_enforced_by_validation(self):
        data = record((("failed", "test_failure"),) * 4)
        self.assertIn("too-many-runs", codes(data))

    def test_original_failure_retained_when_rerun_passes(self):
        r = self.report(record((("failed", "test_failure"), ("passed", "none"))))
        self.assertEqual(r["classification"], "flaky")
        self.assertEqual(r["decision"], "stop")
        self.assertEqual(r["recorded_outcomes"], ["failed", "passed"])
        self.assertTrue(r["release_blocked"])  # diagnostic pass never verifies release
        self.assertEqual(r["failure_count"], 1)
        self.assertFalse(r["release_verified"])

    def test_flaky_pass_then_fail(self):
        r = self.report(record((("passed", "none"), ("failed", "test_failure"))))
        self.assertEqual((r["classification"], r["decision"]), ("flaky", "stop"))
        self.assertTrue(r["release_blocked"])

    def test_passed(self):
        r = self.report(record((("passed", "none"),)))
        self.assertEqual((r["classification"], r["decision"], r["release_blocked"]),
                         ("passed", "stop", False))

    def test_nonmandatory_failure_not_release_blocked(self):
        r = self.report(record(mandatory=False))
        self.assertFalse(r["release_blocked"])

    def test_skipped_and_error_block(self):
        for out in (("skipped", "none"), ("error", "environment")):
            r = self.report(record((out,)))
            self.assertEqual((r["classification"], r["decision"]), ("blocked", "blocked"))
            self.assertTrue(r["release_blocked"])

    def test_environment_or_ambiguous_any_run_blocks(self):
        for kind in ("environment", "ambiguous_dispatch"):
            r = self.report(record((("failed", "test_failure"), ("failed", kind))))
            self.assertEqual(r["decision"], "blocked")
            self.assertNotEqual(r["decision"], "diagnostic_candidate")

    def test_quarantine_blocks_even_passed(self):
        r = self.report(record((("passed", "none"),), quarantine=quarantine()))
        self.assertEqual((r["classification"], r["decision"]), ("blocked", "blocked"))
        self.assertTrue(r["release_blocked"])
        self.assertEqual(r["quarantine"]["remediation_issue"], "https://github.com/org/repo/issues/12")
        self.assertNotIn("reproduction_command", json.dumps(r))

    def test_nonfunctional_categories_never_candidates(self):
        for cat in ("safety", "authorization"):
            r = self.report(record(category=cat))
            self.assertEqual(r["decision"], "stop")
            self.assertEqual(r["decision_reason"], "category_not_eligible")

    def test_benchmark_separate_classification_no_rerun(self):
        r = self.report(record((("failed", "test_failure"), ("passed", "none")), category="benchmark"))
        self.assertEqual((r["classification"], r["decision_reason"]),
                         ("benchmark_variation", "benchmark_no_automatic_rerun"))
        r = self.report(record(category="benchmark"))
        self.assertEqual(r["decision"], "stop")

    def test_sandbox_and_live_not_candidates(self):
        for mode in ("sandbox", "live"):
            d = record(provider_modes={"dispatch": mode})
            for run in d["runs"]:
                run["provider_modes"] = {"dispatch": mode}
            r = self.report(d)
            self.assertEqual((r["decision"], r["decision_reason"]), ("stop", "provider_mode_not_offline"))

    def test_mixed_modes_one_live_not_candidate(self):
        modes = {"a": "mock", "b": "recorded", "c": "live"}
        d = record(provider_modes=modes)
        for run in d["runs"]:
            run["provider_modes"] = dict(modes)
        self.assertEqual(self.report(d)["decision"], "stop")
        modes.pop("c")
        d = record(provider_modes=dict(modes))
        for run in d["runs"]:
            run["provider_modes"] = dict(modes)
        self.assertEqual(self.report(d)["decision"], "diagnostic_candidate")


class Validation(Base):
    def test_valid_baseline(self):
        self.assertEqual(rr.validate(record()), [])

    def test_missing_each_top_key(self):
        for key in rr.TOP_KEYS:
            d = record()
            del d[key]
            self.assertIn("missing-field", codes(d), key)

    def test_unknown_keys(self):
        d = record()
        d[SECRET] = 1
        self.assertIn("unknown-field", codes(d))
        d = record()
        d["runs"][0]["extra"] = 1
        self.assertIn("unknown-field", codes(d))
        d = record(quarantine=quarantine(extra=1))
        self.assertIn("unknown-field", codes(d))

    def test_top_level_not_object(self):
        for v in ([], "x", 1, None):
            self.assertEqual(codes(v), {"bad-type"})

    def test_bad_scalars(self):
        cases = [
            ("format_version", 2), ("format_version", True), ("format_version", "1"),
            ("case_id", ""), ("case_id", "a b"), ("case_id", 5), ("case_id", "x/../y"),
            ("requirement_ids", []), ("requirement_ids", "REQ-1"), ("requirement_ids", [1]),
            ("requirement_ids", ["a b"]),
            ("mandatory", "true"), ("mandatory", 1),
            ("category", "other"), ("category", None),
            ("provider_modes", {}), ("provider_modes", {"a": "prod"}), ("provider_modes", []),
            ("pins", {}), ("pins", {"r": "abc"}), ("pins", {"r": "A" * 40}), ("pins", {"r": "a" * 64}),
            ("fixture_digest", "b" * 63), ("fixture_digest", "B" * 64), ("fixture_digest", None),
            ("config_digest", "z" * 64),
            ("seed", ""), ("seed", "   "), ("seed", 7),
            ("runs", []), ("runs", {}), ("runs", "x"),
        ]
        for key, value in cases:
            d = record()
            d[key] = value
            self.assertTrue(rr.validate(d), (key, value))

    def test_duplicate_requirement_ids(self):
        self.assertIn("duplicate-id", codes(record(requirement_ids=["R-1", "R-1"])))

    def test_duplicate_run_ids(self):
        d = record((("failed", "test_failure"),) * 2)
        d["runs"][1]["run_id"] = "run-0"
        self.assertIn("duplicate-id", codes(d))

    def test_chain(self):
        d = record()
        d["runs"][0]["parent_run_id"] = "run-9"
        self.assertIn("bad-chain", codes(d))
        d = record((("failed", "test_failure"),) * 3)
        d["runs"][2]["parent_run_id"] = "run-0"  # not the immediately preceding run
        self.assertIn("bad-chain", codes(d))
        d = record((("failed", "test_failure"),) * 2)
        d["runs"][1]["parent_run_id"] = None
        self.assertIn("bad-chain", codes(d))

    def test_attempt_index(self):
        for idx in (1, -1, True, "0", None, 2.0):
            d = record()
            d["runs"][0]["attempt_index"] = idx
            self.assertIn("bad-attempt-index", codes(d), idx)
        d = record((("failed", "test_failure"),) * 2)
        d["runs"][1]["attempt_index"] = 2  # gap
        self.assertIn("bad-attempt-index", codes(d))

    def test_outcome_and_kind_enums_and_consistency(self):
        for key, bad in (("outcome", "ok"), ("error_kind", "weird"), ("outcome", None)):
            d = record()
            d["runs"][0][key] = bad
            self.assertIn("bad-value", codes(d))
        self.assertIn("inconsistent-outcome", codes(record((("passed", "test_failure"),))))
        self.assertIn("inconsistent-outcome", codes(record((("failed", "none"),))))
        self.assertIn("inconsistent-outcome", codes(record((("skipped", "test_failure"),))))

    def test_rationale_required_nonempty(self):
        for v in ("", "  ", None, 3):
            d = record()
            d["runs"][0]["rationale"] = v
            self.assertIn("bad-value", codes(d))

    def test_timestamp_types_and_forms(self):
        bad = [None, 0, 1767225600, True, [], "2026-01-01", "2026-01-01T00:00:00",
               "2026-01-01T00:00:00+01:00", "2026-01-01T00:00:00-00:00",
               "2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-01-01T00:00:60Z",
               "2026-01-01 00:00:00Z", "2026-01-01T00:00:00z", "2026-01-01T00:00:00.1234567Z",
               "", " 2026-01-01T00:00:00Z"]
        for v in bad:
            d = record()
            d["runs"][0]["occurred_at"] = v
            self.assertIn("bad-value", codes(d), repr(v))
        for v in ("2026-01-01T00:00:00Z", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00.123Z"):
            d = record()
            d["runs"][0]["occurred_at"] = v
            self.assertEqual(rr.validate(d), [], v)

    def test_monotonic_times(self):
        d = record((("failed", "test_failure"),) * 2)
        d["runs"][1]["occurred_at"] = d["runs"][0]["occurred_at"]
        self.assertIn("non-monotonic-time", codes(d))
        d["runs"][1]["occurred_at"] = "2025-12-31T00:00:00Z"
        self.assertIn("non-monotonic-time", codes(d))

    def test_pin_seed_and_declaration_changes_rejected(self):
        mutations = {
            "pins": {"repo": "d" * 40},
            "fixture_digest": "e" * 64,
            "config_digest": "e" * 64,
            "seed": "other-seed",
            "provider_modes": {"dispatch": "recorded"},
        }
        for key, value in mutations.items():
            d = record((("failed", "test_failure"),) * 2)
            d["runs"][1][key] = value
            self.assertIn("declaration-mismatch", codes(d), key)
        d = record((("failed", "test_failure"),) * 2)
        d["runs"][1]["pins"] = {"repo": PIN, "extra": PIN}
        self.assertIn("declaration-mismatch", codes(d))
        d = record()
        del d["runs"][0]["seed"]
        self.assertIn("missing-field", codes(d))

    def test_quarantine_validation(self):
        self.assertEqual(rr.validate(record(quarantine=quarantine())), [])
        self.assertEqual(rr.validate(record(quarantine=quarantine(last_good_revision=PIN))), [])
        bad = [("reason", ""), ("owner_role", None), ("reproduction_command", " "),
               ("failure_signature", 1),
               ("remediation_issue", "http://github.com/o/r/issues/1"),
               ("remediation_issue", "https://github.com/o/r/pull/1"),
               ("remediation_issue", "https://github.com/o/r/issues/0"),
               ("remediation_issue", "https://github.com/o/r/issues/1?x=1"),
               ("remediation_issue", "https://evil.example/o/r/issues/1"),
               ("expiry", "2026-06-01"), ("expiry", 5), ("expiry", "2026-06-01T00:00:00+02:00"),
               ("last_good_revision", "abc"), ("last_bad_revision", None),
               ("last_bad_revision", "g" * 40)]
        for key, value in bad:
            self.assertTrue(rr.validate(record(quarantine=quarantine(**{key: value}))), (key, value))
        for key in rr.QUARANTINE_KEYS:
            q = quarantine()
            del q[key]
            self.assertIn("missing-field", codes(record(quarantine=q)))
        self.assertTrue(rr.validate(record(quarantine=None)))
        self.assertTrue(rr.validate(record(quarantine="x")))

    def test_validate_does_not_mutate(self):
        d = record(quarantine=quarantine())
        before = copy.deepcopy(d)
        rr.validate(d)
        rr.build_report(d, b"{}")
        self.assertEqual(d, before)


class InputHandling(Base):
    def test_duplicate_keys(self):
        raw = json.dumps(record()).replace('"case_id": "case-1"', '"case_id": "a", "case_id": "b"')
        code, out, _ = self.cli(self.write(raw.encode()))
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out)["errors"], [{"code": "duplicate-key", "field": "input"}])

    def test_duplicate_nested_keys(self):
        raw = json.dumps(record()).replace('"repo"', '"repo": "' + PIN + '", "repo"', 1)
        code, out, _ = self.cli(self.write(raw.encode()))
        self.assertEqual(code, 1)
        self.assertIn("duplicate-key", out)

    def test_nonfinite_and_floats(self):
        for tok in ("NaN", "Infinity", "-Infinity", "1.5", "1e400", "1E2"):
            raw = json.dumps(record()).replace('"mandatory": true', '"mandatory": ' + tok)
            code, out, _ = self.cli(self.write(raw.encode()))
            self.assertEqual(code, 1, tok)
            self.assertIn("unsupported-number", out)

    def test_huge_integer(self):
        raw = json.dumps(record()).replace('"format_version": 1', '"format_version": ' + "9" * 5000)
        code, out, _ = self.cli(self.write(raw.encode()))
        self.assertEqual(code, 1)
        self.assertIn("unsupported-number", out)

    def test_invalid_json_and_encoding(self):
        for raw, expect in ((b"{", "invalid-json"), (b"", "invalid-json"),
                            (b"\xff\xfe", "input-not-utf8"),
                            (b"\xef\xbb\xbf{}", "invalid-json")):
            code, out, _ = self.cli(self.write(raw))
            self.assertEqual(code, 1)
            self.assertIn(expect, out)

    def test_deep_nesting(self):
        code, out, _ = self.cli(self.write(b"[" * 200000 + b"]" * 200000))
        self.assertEqual(code, 1)
        self.assertTrue(json.loads(out)["errors"])

    def test_size_limit_boundary(self):
        base = json.dumps(record()).encode()
        pad = rr.MAX_INPUT_BYTES - len(base)
        ok = base + b" " * pad
        self.assertEqual(len(ok), rr.MAX_INPUT_BYTES)
        code, _, _ = self.cli(self.write(ok))
        self.assertEqual(code, 2)  # valid; failed mandatory case is release-blocked
        code, out, _ = self.cli(self.write(ok + b" "))
        self.assertEqual(code, 1)
        self.assertIn("input-too-large", out)

    def test_missing_and_directory(self):
        code, out, _ = self.cli(os.path.join(self.dir, "nope.json"))
        self.assertEqual((code, json.loads(out)["errors"][0]["code"]), (1, "input-unreadable"))
        code, out, _ = self.cli(self.dir)
        self.assertEqual((code, json.loads(out)["errors"][0]["code"]), (1, "input-not-regular"))

    def test_symlink_rejected(self):
        target = self.write(record())
        link = os.path.join(self.dir, "link.json")
        os.symlink(target, link)
        code, out, _ = self.cli(link)
        self.assertEqual((code, json.loads(out)["errors"][0]["code"]), (1, "symlink-input"))
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        esc = os.path.join(outside.name, "x.json")
        with open(esc, "w") as fh:
            json.dump(record(), fh)
        link2 = os.path.join(self.dir, "esc.json")
        os.symlink(esc, link2)
        self.assertEqual(self.cli(link2)[0], 1)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "needs mkfifo")
    def test_fifo_does_not_hang(self):
        fifo = os.path.join(self.dir, "f.json")
        os.mkfifo(fifo)
        code, out, _ = self.cli(fifo)
        self.assertEqual((code, json.loads(out)["errors"][0]["code"]), (1, "input-not-regular"))

    @unittest.skipUnless(os.path.exists("/dev/zero"), "needs /dev/zero")
    def test_device_does_not_hang(self):
        code, out, _ = self.cli("/dev/zero")
        self.assertEqual((code, json.loads(out)["errors"][0]["code"]), (1, "input-not-regular"))

    def test_nul_in_path_and_bad_args(self):
        self.assertEqual(rr.run("a\x00b")[1], 1)
        for argv in (["t"], ["t", "a", "b"], ["t", "-x"]):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(rr.main(argv), 1)

    def test_double_dash_and_dash_prefixed_name(self):
        path = self.write(record(), name="-weird.json")
        p = subprocess.run([sys.executable, "-I", TOOL, "--", path],
                           capture_output=True, text=True, timeout=30, cwd=self.dir)
        self.assertEqual(p.returncode, 2)
        p = subprocess.run([sys.executable, "-I", TOOL, "-weird.json"],
                           capture_output=True, text=True, timeout=30, cwd=self.dir)
        self.assertEqual(p.returncode, 1)
        p = subprocess.run([sys.executable, "-I", TOOL, "--", "-weird.json"],
                           capture_output=True, text=True, timeout=30, cwd=self.dir)
        self.assertEqual(p.returncode, 2)

    def test_input_not_modified(self):
        path = self.write(record())
        before = (slurp(path), os.stat(path).st_mtime_ns)
        self.cli(path)
        self.assertEqual((slurp(path), os.stat(path).st_mtime_ns), before)
        self.assertEqual(sorted(os.listdir(self.dir)), ["in.json"])


class Output(Base):
    def test_exit_codes(self):
        self.assertEqual(self.cli(self.write(record()))[0], 2)
        self.assertEqual(self.cli(self.write(record((("passed", "none"),))))[0], 0)
        self.assertEqual(self.cli(self.write(record(mandatory=False)))[0], 0)
        self.assertEqual(self.cli(self.write({}))[0], 1)

    def test_deterministic_and_provenance(self):
        d = record((("failed", "test_failure"), ("passed", "none")))
        path = self.write(d)
        a = self.cli(path)
        b = self.cli(path)
        self.assertEqual(a, b)
        rep = json.loads(a[1])
        self.assertEqual(rep["input"]["sha256"], hashlib.sha256(slurp(path)).hexdigest())
        self.assertEqual(rep["recorded_outcomes"], ["failed", "passed"])
        self.assertEqual((rep["format_version"], rep["provider_mode"], rep["scope"]),
                         (1, "N/A", "offline-report-only"))
        self.assertEqual(rep["rerun_cap"], 2)

    def test_key_order_irrelevant(self):
        d = record()
        shuffled = dict(reversed(list(d.items())))
        a = self.cli(self.write(d))[1]
        b = json.loads(self.cli(self.write(shuffled, "b.json"))[1])
        a = json.loads(a)
        a["input"] = b["input"] = None
        self.assertEqual(a, b)

    def test_no_secret_or_arbitrary_echo(self):
        d = record(quarantine=quarantine())
        out = self.cli(self.write(d))[1]
        self.assertNotIn(SECRET, out)
        self.assertNotIn("rm -rf", out)
        self.assertNotIn("owner", out)
        self.assertNotIn("seed-", out)
        # invalid inputs: values and unknown key names are never echoed
        bad = record()
        bad[SECRET] = SECRET
        bad["case_id"] = SECRET + " bad id"
        bad["runs"][0]["outcome"] = SECRET
        bad["runs"][0][SECRET] = 1
        out = self.cli(self.write(bad))[1]
        self.assertNotIn(SECRET, out)
        self.assertEqual(self.cli(self.write(bad))[0], 1)

    def test_error_report_sanitized_and_bounded(self):
        d = record()
        d["runs"] = [{SECRET + str(i): i} for i in range(3)]
        rep = json.loads(self.cli(self.write(d))[1])
        self.assertFalse(rep["ok"])
        for e in rep["errors"]:
            self.assertEqual(set(e), {"code", "field"})
            self.assertNotIn(SECRET, json.dumps(e))
        many = rr.error_report([("bad-value", "f%d" % i) for i in range(500)])
        self.assertEqual(len(many["errors"]), rr.MAX_ERRORS)
        self.assertTrue(many["errors_truncated"])

    def test_no_network_or_exec_imports(self):
        src = slurp(TOOL, "r")
        for word in ("subprocess", "socket", "urllib", "http.client", "os.system", "eval(", "exec("):
            self.assertNotIn(word, src)


if __name__ == "__main__":
    unittest.main()
