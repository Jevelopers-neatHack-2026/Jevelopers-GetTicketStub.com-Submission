#!/usr/bin/env python3
"""Read-only, offline reporting for safe diagnostic reruns (IE09B reporting v1).

Usage: python tools/rerun_report.py [--] INPUT_JSON

The input is a local, self-declared JSON record of one case and its run
history. This tool only inspects that declared metadata. It does not prove the
sources are immutable, does not authorize any rerun or provider use, never
executes anything found in the input (including reproduction commands), never
touches the network, and never writes files. A `diagnostic_candidate`
decision is advisory reporting, never runtime authorization.

Output is deterministic JSON on stdout. Arbitrary input strings (rationale,
reproduction command, owner, failure signature, seed, unknown keys, ...) are
never echoed; only whitelisted identifiers, hashes and enums are.

Exit status: 1 invalid input, 2 release_blocked, 0 otherwise.
"""
import datetime
import errno
import hashlib
import json
import os
import re
import stat
import sys

FORMAT_VERSION = 1
PROVIDER_MODE = "N/A"
SCOPE = "offline-report-only"
MAX_INPUT_BYTES = 1 << 20
MAX_RUNS = 3  # original + at most 2 diagnostic reruns (attempt_index 0..2)
MAX_RERUNS = MAX_RUNS - 1
MAX_ERRORS = 50
MAX_ITEMS = 256

CATEGORIES = ("functional", "safety", "authorization", "benchmark")
PROVIDER_VALUES = ("mock", "recorded", "sandbox", "live")
OFFLINE_PROVIDER_VALUES = ("mock", "recorded")
OUTCOMES = ("passed", "failed", "skipped", "error")
ERROR_KINDS = ("none", "test_failure", "environment", "ambiguous_dispatch")

SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
HEX40 = re.compile(r"[0-9a-f]{40}")
HEX64 = re.compile(r"[0-9a-f]{64}")
ISSUE_URL = re.compile(r"https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/issues/[1-9][0-9]{0,9}")
UTC_TS = re.compile(
    r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?(?:Z|\+00:00)")

TOP_KEYS = ("format_version", "case_id", "requirement_ids", "mandatory", "category",
            "provider_modes", "pins", "fixture_digest", "config_digest", "seed", "runs")
RUN_DECLARED = ("pins", "fixture_digest", "config_digest", "seed", "provider_modes")
RUN_KEYS = ("run_id", "parent_run_id", "attempt_index", "outcome", "error_kind",
            "rationale", "occurred_at") + RUN_DECLARED
QUARANTINE_KEYS = ("reason", "owner_role", "remediation_issue", "expiry",
                   "reproduction_command", "failure_signature", "last_good_revision",
                   "last_bad_revision")

NOTES = (
    "Reports declared metadata only; declarations are not independently verified.",
    "Does not prove immutable sources and does not authorize any rerun or provider use.",
    "A diagnostic pass never verifies a release.",
)


class InputError(Exception):
    def __init__(self, code):
        Exception.__init__(self, code)
        self.code = code


class _Dup(Exception):
    pass


class _Num(Exception):
    pass


def _pairs(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise _Dup()
        out[key] = value
    return out


def _reject_const(_name):
    raise _Num()


def _parse_int(text):
    if len(text) > 18:
        raise _Num()
    return int(text)


def _reject_float(_text):
    raise _Num()


def read_input(path):
    """Return raw bytes of a regular, non-symlink file of at most MAX_INPUT_BYTES."""
    flags = os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            raise InputError("symlink-input")
        raise InputError("input-unreadable")
    except ValueError:
        raise InputError("input-unreadable")
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise InputError("input-not-regular")
        with os.fdopen(fd, "rb", closefd=False) as fh:
            raw = fh.read(MAX_INPUT_BYTES + 1)
    except OSError:
        raise InputError("input-unreadable")
    finally:
        os.close(fd)
    if len(raw) > MAX_INPUT_BYTES:
        raise InputError("input-too-large")
    return raw


def parse_json(raw):
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise InputError("input-not-utf8")
    try:
        return json.loads(text, object_pairs_hook=_pairs, parse_constant=_reject_const,
                          parse_int=_parse_int, parse_float=_reject_float)
    except _Dup:
        raise InputError("duplicate-key")
    except _Num:
        raise InputError("unsupported-number")
    except RecursionError:
        raise InputError("input-too-deep")
    except ValueError:
        raise InputError("invalid-json")


class _Errors:
    def __init__(self):
        self.items = set()

    def add(self, code, field):
        self.items.add((code, field))


def _is_str(value):
    return type(value) is str and value.strip() != ""


def _is_int(value):
    return type(value) is int


def parse_ts(value):
    """Return a datetime for a UTC ISO timestamp, or None."""
    if type(value) is not str:
        return None
    m = UTC_TS.fullmatch(value)
    if not m:
        return None
    parts = [int(g) for g in m.groups()[:6]]
    micro = int((m.group(7) or "0").ljust(6, "0"))
    try:
        return datetime.datetime(*parts, microsecond=micro)
    except ValueError:
        return None


def _check_object(errs, obj, field, keys, optional=()):
    if type(obj) is not dict:
        errs.add("bad-type", field)
        return False
    for key in keys:
        if key not in obj and key not in optional:
            errs.add("missing-field", field + "." + key if field else key)
    if any(key not in keys and key not in optional for key in obj):
        errs.add("unknown-field", field or "$")
    return True


def _valid_pins(errs, value, field):
    if type(value) is not dict or not value or len(value) > MAX_ITEMS:
        errs.add("bad-value", field)
        return False
    ok = True
    for key, item in value.items():
        if not SAFE_ID.fullmatch(key) or type(item) is not str or not HEX40.fullmatch(item):
            ok = False
    if not ok:
        errs.add("bad-value", field)
    return ok


def _valid_modes(errs, value, field):
    if type(value) is not dict or not value or len(value) > MAX_ITEMS:
        errs.add("bad-value", field)
        return False
    ok = all(SAFE_ID.fullmatch(k) and type(v) is str and v in PROVIDER_VALUES
             for k, v in value.items())
    if not ok:
        errs.add("bad-value", field)
    return ok


def _valid_hex(errs, value, field, pattern):
    ok = type(value) is str and bool(pattern.fullmatch(value))
    if not ok:
        errs.add("bad-value", field)
    return ok


def _validate_quarantine(errs, q):
    field = "quarantine"
    if not _check_object(errs, q, field, QUARANTINE_KEYS):
        return
    for key in ("reason", "owner_role", "reproduction_command", "failure_signature"):
        if key in q and not _is_str(q[key]):
            errs.add("bad-value", field + "." + key)
    if "remediation_issue" in q and not (
            type(q["remediation_issue"]) is str and ISSUE_URL.fullmatch(q["remediation_issue"])):
        errs.add("bad-value", field + ".remediation_issue")
    if "expiry" in q and parse_ts(q["expiry"]) is None:
        errs.add("bad-value", field + ".expiry")
    if "last_good_revision" in q and q["last_good_revision"] is not None:
        _valid_hex(errs, q["last_good_revision"], field + ".last_good_revision", HEX40)
    if "last_bad_revision" in q:
        _valid_hex(errs, q["last_bad_revision"], field + ".last_bad_revision", HEX40)


def _validate_runs(errs, data, runs, top_ok):
    if type(runs) is not list or not runs:
        errs.add("bad-value", "runs")
        return
    if len(runs) > MAX_RUNS:
        errs.add("too-many-runs", "runs")
        runs = runs[:MAX_RUNS]
    seen = set()
    prev_id = None
    prev_ts = None
    for i, run in enumerate(runs):
        f = "runs[%d]" % i
        if not _check_object(errs, run, f, RUN_KEYS):
            continue
        rid = run.get("run_id")
        if "run_id" in run:
            if type(rid) is not str or not SAFE_ID.fullmatch(rid):
                errs.add("bad-value", f + ".run_id")
            elif rid in seen:
                errs.add("duplicate-id", f + ".run_id")
            else:
                seen.add(rid)
        if "parent_run_id" in run:
            parent = run["parent_run_id"]
            expected = prev_id if i else None
            if i == 0:
                if parent is not None:
                    errs.add("bad-chain", f + ".parent_run_id")
            elif type(parent) is not str or prev_id is None or parent != expected:
                errs.add("bad-chain", f + ".parent_run_id")
        if "attempt_index" in run:
            if not _is_int(run["attempt_index"]) or run["attempt_index"] != i:
                errs.add("bad-attempt-index", f + ".attempt_index")
        outcome = run.get("outcome")
        kind = run.get("error_kind")
        if "outcome" in run and not (type(outcome) is str and outcome in OUTCOMES):
            errs.add("bad-value", f + ".outcome")
            outcome = None
        if "error_kind" in run and not (type(kind) is str and kind in ERROR_KINDS):
            errs.add("bad-value", f + ".error_kind")
            kind = None
        if outcome is not None and kind is not None:
            if (outcome == "passed" and kind != "none") or \
                    (outcome in ("failed", "error") and kind == "none") or \
                    (outcome == "skipped" and kind == "test_failure"):
                errs.add("inconsistent-outcome", f + ".error_kind")
        if "rationale" in run and not _is_str(run["rationale"]):
            errs.add("bad-value", f + ".rationale")
        if "occurred_at" in run:
            ts = parse_ts(run["occurred_at"])
            if ts is None:
                errs.add("bad-value", f + ".occurred_at")
            else:
                if prev_ts is not None and ts <= prev_ts:
                    errs.add("non-monotonic-time", f + ".occurred_at")
                prev_ts = ts
        if top_ok:
            for key in RUN_DECLARED:
                if key in run and run[key] != data[key]:
                    errs.add("declaration-mismatch", f + "." + key)
        prev_id = rid if type(rid) is str else None


def validate(data):
    """Return a sorted list of (code, field) errors; empty when the record is valid."""
    errs = _Errors()
    if not _check_object(errs, data, "", TOP_KEYS, optional=("quarantine",)):
        return sorted(errs.items)
    if "format_version" in data and not (_is_int(data["format_version"])
                                         and data["format_version"] == FORMAT_VERSION):
        errs.add("bad-value", "format_version")
    if "case_id" in data and not (type(data["case_id"]) is str and SAFE_ID.fullmatch(data["case_id"])):
        errs.add("bad-value", "case_id")
    if "requirement_ids" in data:
        ids = data["requirement_ids"]
        if type(ids) is not list or not ids or len(ids) > MAX_ITEMS or not all(
                type(x) is str and SAFE_ID.fullmatch(x) for x in ids):
            errs.add("bad-value", "requirement_ids")
        elif len(set(ids)) != len(ids):
            errs.add("duplicate-id", "requirement_ids")
    if "mandatory" in data and type(data["mandatory"]) is not bool:
        errs.add("bad-type", "mandatory")
    if "category" in data and not (type(data["category"]) is str and data["category"] in CATEGORIES):
        errs.add("bad-value", "category")
    ok = True
    if "provider_modes" in data:
        ok = _valid_modes(errs, data["provider_modes"], "provider_modes") and ok
    if "pins" in data:
        ok = _valid_pins(errs, data["pins"], "pins") and ok
    for key, pattern in (("fixture_digest", HEX64), ("config_digest", HEX64)):
        if key in data:
            ok = _valid_hex(errs, data[key], key, pattern) and ok
    if "seed" in data and not _is_str(data["seed"]):
        errs.add("bad-value", "seed")
        ok = False
    top_ok = ok and all(k in data for k in RUN_DECLARED)
    if "runs" in data:
        _validate_runs(errs, data, data["runs"], top_ok)
    if "quarantine" in data:
        _validate_quarantine(errs, data["quarantine"])
    return sorted(errs.items)


def _classify(data, outcomes):
    quarantined = "quarantine" in data
    if quarantined or "skipped" in outcomes or "error" in outcomes:
        return "blocked"
    if all(o == "passed" for o in outcomes):
        return "passed"
    if data["category"] == "benchmark":
        return "benchmark_variation"
    if all(o == "failed" for o in outcomes):
        return "consistently_failed"
    return "flaky"


def _decide(data, classification):
    """Return (decision, reason) from a fixed enum; never an authorization."""
    runs = data["runs"]
    kinds = [r["error_kind"] for r in runs]
    if "quarantine" in data:
        return "blocked", "quarantined"
    if "environment" in kinds or "ambiguous_dispatch" in kinds:
        return "blocked", "environment_or_ambiguous_dispatch"
    if classification == "blocked":
        return "blocked", "skipped_or_error_outcome"
    if classification == "passed":
        return "stop", "no_failure"
    if data["category"] == "benchmark":
        return "stop", "benchmark_no_automatic_rerun"
    if data["category"] != "functional":
        return "stop", "category_not_eligible"
    if any(v not in OFFLINE_PROVIDER_VALUES for v in data["provider_modes"].values()):
        return "stop", "provider_mode_not_offline"
    if classification == "flaky":
        return "stop", "flaky_not_a_deterministic_failure"
    if len(runs) - 1 >= MAX_RERUNS:
        return "stop", "rerun_cap_reached"
    return "diagnostic_candidate", "functional_offline_consistent_test_failure"


def build_report(data, raw):
    """Build the deterministic report for an already validated record. Does not mutate data."""
    runs = data["runs"]
    outcomes = [r["outcome"] for r in runs]
    classification = _classify(data, outcomes)
    decision, reason = _decide(data, classification)
    quarantined = "quarantine" in data
    release_blocked = bool(data["mandatory"] and (quarantined or any(o != "passed" for o in outcomes)))
    q = data.get("quarantine")
    return {
        "format_version": FORMAT_VERSION,
        "provider_mode": PROVIDER_MODE,
        "scope": SCOPE,
        "ok": True,
        "input": {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)},
        "case_id": data["case_id"],
        "category": data["category"],
        "mandatory": data["mandatory"],
        "requirement_ids": sorted(data["requirement_ids"]),
        "provider_modes": dict(sorted(data["provider_modes"].items())),
        "pins": dict(sorted(data["pins"].items())),
        "fixture_digest": data["fixture_digest"],
        "config_digest": data["config_digest"],
        "seed_sha256": hashlib.sha256(data["seed"].encode("utf-8", "surrogatepass")).hexdigest(),
        "recorded_outcomes": outcomes,
        "runs": [{"run_id": r["run_id"], "parent_run_id": r["parent_run_id"],
                  "attempt_index": r["attempt_index"], "outcome": r["outcome"],
                  "error_kind": r["error_kind"], "occurred_at": r["occurred_at"]}
                 for r in runs],
        "classification": classification,
        "failure_count": outcomes.count("failed"),
        "total_runs": len(runs),
        "rerun_count": len(runs) - 1,
        "rerun_cap": MAX_RERUNS,
        "decision": decision,
        "decision_reason": reason,
        "rerun_authorized": False,
        "release_blocked": release_blocked,
        "release_verified": False,
        "quarantine": None if q is None else {
            "present": True,
            "remediation_issue": q["remediation_issue"],
            "expiry": q["expiry"],
            "last_good_revision": q["last_good_revision"],
            "last_bad_revision": q["last_bad_revision"],
        },
        "notes": list(NOTES),
    }


def error_report(errors):
    ordered = sorted(set(errors))
    return {
        "format_version": FORMAT_VERSION,
        "provider_mode": PROVIDER_MODE,
        "scope": SCOPE,
        "ok": False,
        "errors": [{"code": c, "field": f} for c, f in ordered[:MAX_ERRORS]],
        "errors_truncated": len(ordered) > MAX_ERRORS,
    }


def run(path):
    """Return (report_dict, exit_code)."""
    try:
        raw = read_input(path)
        data = parse_json(raw)
    except InputError as exc:
        return error_report([(exc.code, "input")]), 1
    errors = validate(data)
    if errors:
        return error_report(errors), 1
    report = build_report(data, raw)
    return report, 2 if report["release_blocked"] else 0


def main(argv):
    args = list(argv[1:])
    dashdash = args[:1] == ["--"]
    if dashdash:
        args = args[1:]
    if len(args) != 1 or (args[0].startswith("-") and not dashdash):
        report, code = error_report([("bad-arguments", "argv")]), 1
    else:
        report, code = run(args[0])
    sys.stdout.write(json.dumps(report, indent=2, sort_keys=True) + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
