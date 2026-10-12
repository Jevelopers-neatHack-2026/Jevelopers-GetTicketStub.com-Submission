#!/usr/bin/env python3
"""Validate the BK-06 provenance register and the production export allowlist.

Offline and deterministic: reads files only; nothing is installed, published or sent.
Standard library only (Python 3.9+).

    python3 tools/check_provenance.py --register-only   structural validation; honest UNKNOWNs pass
    python3 tools/check_provenance.py                    production eligibility; fails closed
    python3 tools/check_provenance.py --report           per-file include/exclude decision report
    python3 tools/check_provenance.py --print-hashes     current sha256 of every in-scope file

Exit 0 only when every check of the chosen mode passes, 1 otherwise. The production mode
passes only with a reviewed, non-empty allowlist of exact path+hash entries whose register
records carry real approval, and with the rights of every core asset cleared.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from inventory_lib import ROOT, list_files  # noqa: E402

REGISTER = "provenance/register.json"
ALLOWLIST = "provenance/allowlist.json"
UNKNOWN = "UNKNOWN"

CLASSES = {"first-party-canonical", "first-party-generated", "first-party-derived", "first-party-readme",
           "licensed-dependency", "licence-notice", "reference-unknown", "third-party-candidate", "internal"}
ELIGIBLE_CLASSES = {"first-party-canonical", "first-party-generated", "first-party-derived", "first-party-readme"}
# licence-notice is not here: a notice may be a release candidate, but only alongside an eligible non-font asset it covers.
EXCLUDED_CLASSES = {"licensed-dependency", "reference-unknown", "third-party-candidate", "internal"}
APPROVAL_STATUS = {UNKNOWN, "approved", "rejected"}
# Scope and core status are policy of this validator, not data a register edit can narrow or switch off.
REQUIRED_SCOPE = ("logo/", "fonts/", "references/", "tokens/", "docs/assets/")
CORE_PREFIXES = ("logo/", "fonts/", "tokens/")
NOTICE_EXT = (".txt", ".md")
SENTINELS = {UNKNOWN, "NOT-APPLICABLE"}
PLACEHOLDERS = {"unknown", "tbd", "todo", "n/a", "na", "none", "null", "nil", "-", "--", "?", "pending", "placeholder", "true", "false"}
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WORDLIKE_SECRET_RE = re.compile(r"(?=[A-Za-z0-9+/_=-]*\d)(?=[A-Za-z0-9+/_=-]*[A-Za-z])[A-Za-z0-9+/_=-]{24,}")
RELEASE = {"candidate", "excluded"}
ALLOWLIST_STATUS = {"empty", "draft", "reviewed"}
FONT_EXT = (".ttf", ".otf", ".woff", ".woff2", ".eot")
REQUIRED = ["path", "sha256", "size_bytes", "introduced_in", "classification", "core", "origin", "origin_evidence",
            "creator_rights_holder", "source_version", "derivation", "tooling", "notice_required", "notice_files",
            "rights_status", "intended_uses", "permitted_uses", "restrictions", "reviewer", "approval",
            "disposition", "notes"]
ALLOW_EMPTY = {"notice_files", "notes"}
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
RESTRICTED_RE = re.compile(r"^restricted:[A-Za-z0-9._-]{1,64}$")
URL_RE = re.compile(r"^https://[A-Za-z0-9.-]+(/[^\s?#]*)?(#[A-Za-z0-9._-]+)?$")
SECRET_PATTERNS = [
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}")),
    ("GitHub fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}")),
    ("Slack token", re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}")),
    ("API secret key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}")),
    ("JSON web token", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{30,}")),
    ("AWS access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("API key/secret assignment", re.compile(r"(?i)\b(api[_-]?key|secret|passw(or)?d|token|bearer)\b\s*[:=]\s*\S{8,}")),
    ("URL with credentials or query", re.compile(r"https?://[^\s/]*@|https?://[^\s]*\?[^\s]*=")),
    ("email address", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def path_problem(root: Path, rel) -> str | None:
    """Why `rel` is not a safe repository-relative file path, or None."""
    if not isinstance(rel, str) or not rel:
        return "path is empty or not a string"
    if any(ord(c) < 32 for c in rel) or "\\" in rel:
        return "path has control or backslash characters"
    if rel.startswith("/") or re.match(r"^[A-Za-z]:", rel) or rel.startswith("~"):
        return "path is absolute"
    parts = rel.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return "path has empty, '.' or '..' segments (traversal)"
    cur = root
    for p in parts:
        cur = cur / p
        if cur.is_symlink():
            return "path goes through a symlink"
    try:
        if not (root.resolve() / rel).resolve().is_relative_to(root.resolve()):
            return "path escapes the repository"
    except (OSError, ValueError):
        return "path cannot be resolved"
    return None


def load_json(root: Path, rel: str):
    p = root / rel
    if not p.is_file():
        return None, [f"missing required input: {rel}"]
    try:
        return json.loads(p.read_text(encoding="utf-8")), []
    except json.JSONDecodeError as exc:
        return None, [f"{rel}: invalid JSON at line {exc.lineno} column {exc.colno}"]
    except (UnicodeDecodeError, RecursionError) as exc:
        return None, [f"{rel}: unreadable input ({type(exc).__name__})"]


def strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from strings(k)
            yield from strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from strings(v)


def secret_kind(s: str) -> str | None:
    for name, pat in SECRET_PATTERNS:
        if pat.search(s):
            return name
    return None


def show(v) -> str:
    """The only way input-derived text reaches a diagnostic. Suspicious, long or odd values are never echoed."""
    if not isinstance(v, str):
        return f"<{type(v).__name__}>"
    if len(v) > 100 or not v.isprintable() or secret_kind(v) or WORDLIKE_SECRET_RE.search(v):
        return "<withheld>"
    return repr(v)


def sanitize_problems(doc, rel: str) -> list[str]:
    errs = []
    for s in strings(doc):
        kind = secret_kind(s)
        if kind:
            errs.append(f"{rel}: string looks like a {kind}; use a sanitized reference (not printed)")
    return errs


def meaningful(v) -> bool:
    """A real string: no surrounding whitespace, no control characters, not a placeholder word."""
    return (isinstance(v, str) and v == v.strip() and len(v) >= 2 and v.isprintable()
            and v.casefold() not in PLACEHOLDERS)


def real_date(v) -> bool:
    if not isinstance(v, str) or not ISO_DATE_RE.match(v):
        return False
    try:
        date.fromisoformat(v)
    except ValueError:
        return False
    return True


def text_problem(v, allow=SENTINELS) -> bool:
    return not ((isinstance(v, str) and v in allow) or meaningful(v))


def use_list_ok(v) -> bool:
    return v == UNKNOWN and isinstance(v, str) or (
        isinstance(v, list) and bool(v) and all(meaningful(x) for x in v))


def is_core(rel: str, cls) -> bool:
    """Required-core policy, derived from path (and notice texts), never from the register's own flag."""
    if not rel.startswith(CORE_PREFIXES):
        return False
    return not (cls == "licence-notice" and rel.endswith(NOTICE_EXT))


def evidence_problem(root: Path, ref, tracked: set[str], allow_unknown: bool = True) -> str | None:
    """Evidence is one string: UNKNOWN, a tracked repo path, a public https URL or an opaque restricted:<id>."""
    if not isinstance(ref, str):
        return "evidence must be a single string reference, not a list or other type"
    if ref == UNKNOWN:
        return None if allow_unknown else "evidence is UNKNOWN"
    if not ref.strip() or ref != ref.strip():
        return "evidence reference is blank or has surrounding whitespace"
    if RESTRICTED_RE.match(ref):
        return None
    if ref.startswith("https://"):
        return None if URL_RE.match(ref) else "evidence URL must be plain https without credentials or query"
    base = ref.split("#", 1)[0]
    bad = path_problem(root, base)
    if bad:
        return f"evidence path {show(ref)} is unsafe: {bad}"
    if base not in tracked:
        return f"evidence path {show(ref)} is not a tracked file"
    return None


def scope_files(root: Path, prefixes, tracked: set[str]) -> set[str]:
    wanted = tuple(set(REQUIRED_SCOPE) | {p for p in (prefixes or []) if isinstance(p, str)})
    return {f for f in tracked if f.startswith(wanted)}


def validate_record(root: Path, r: dict, where: str, tracked: set[str]) -> list[str]:
    errs: list[str] = []
    for key in REQUIRED:
        if key not in r:
            errs.append(f"{where}: missing field '{key}'")
        elif r[key] is None or r[key] == {} or (isinstance(r[key], str) and not r[key].strip()) or (
                r[key] == [] and key not in ALLOW_EMPTY):
            errs.append(f"{where}: field '{key}' is empty; write UNKNOWN when the value is not known")
    if errs:
        return errs
    der = r["derivation"]
    if isinstance(der, dict):
        inputs = der.get("inputs")
        if set(der) != {"generator", "inputs"} or not meaningful(der["generator"]) or not isinstance(inputs, list) \
                or not inputs or not all(isinstance(x, str) and x in tracked for x in inputs):
            errs.append(f"{where}: derivation object needs a meaningful generator and a non-empty list of tracked input paths")
    elif text_problem(der):
        errs.append(f"{where}: 'derivation' must be UNKNOWN, NOT-APPLICABLE, a meaningful string or a generator/inputs object")
    for key in ("introduced_in", "origin", "creator_rights_holder", "source_version", "tooling"):
        if text_problem(r[key]):
            errs.append(f"{where}: '{key}' must be UNKNOWN, NOT-APPLICABLE or a meaningful string")
    if text_problem(r["reviewer"], {UNKNOWN}):
        errs.append(f"{where}: reviewer must be UNKNOWN or a meaningful name/role string")
    for key in ("intended_uses", "permitted_uses", "restrictions"):
        if not use_list_ok(r[key]):
            errs.append(f"{where}: '{key}' must be UNKNOWN or a non-empty list of meaningful strings")
    if not isinstance(r["notes"], list) or not all(meaningful(x) for x in r["notes"]):
        errs.append(f"{where}: notes must be a list of meaningful strings")
    oe = r["origin_evidence"]
    if oe != UNKNOWN or not isinstance(oe, str):
        if not isinstance(oe, list) or not oe:
            errs.append(f"{where}: origin_evidence must be UNKNOWN or a non-empty list of evidence references")
        else:
            for ev in oe:
                p = evidence_problem(root, ev, tracked, allow_unknown=False)
                if p:
                    errs.append(f"{where}: origin_evidence: {p}")
    if not isinstance(r["size_bytes"], int) or isinstance(r["size_bytes"], bool):
        errs.append(f"{where}: size_bytes must be an integer")
    cls = r["classification"]
    if not isinstance(cls, str) or cls not in CLASSES:
        errs.append(f"{where}: classification {show(cls)} is not one of {sorted(CLASSES)}")
    if not isinstance(r["core"], bool):
        errs.append(f"{where}: 'core' must be true or false")
    elif r["core"] is not is_core(r["path"], cls):
        errs.append(f"{where}: core must be {str(is_core(r['path'], cls)).lower()}: core status derives from path "
                    f"({', '.join(CORE_PREFIXES)}) and classification, not from this field")
    rights = r["rights_status"]
    if not isinstance(rights, str) or rights not in (UNKNOWN, "cleared"):
        errs.append(f"{where}: rights_status must be UNKNOWN or cleared")
    if not isinstance(r["notice_required"], str) or r["notice_required"] not in (UNKNOWN, "yes", "no"):
        errs.append(f"{where}: notice_required must be UNKNOWN, yes or no")
    nf = r["notice_files"]
    if not isinstance(nf, list) or not all(isinstance(n, str) for n in nf):
        errs.append(f"{where}: notice_files must be a list of paths")
    elif r["notice_required"] == "yes" and not nf:
        errs.append(f"{where}: notice_required is yes but notice_files is empty")

    approval = r["approval"]
    approved = False
    if not isinstance(approval, dict):
        errs.append(f"{where}: approval must be an object")
    else:
        if set(approval) != {"status", "evidence", "date"}:
            errs.append(f"{where}: approval must have exactly status, evidence and date")
        status, ev, dt = approval.get("status"), approval.get("evidence", UNKNOWN), approval.get("date", UNKNOWN)
        if not isinstance(status, str) or status not in APPROVAL_STATUS:
            errs.append(f"{where}: approval.status must be one of {sorted(APPROVAL_STATUS)}")
        p = evidence_problem(root, ev, tracked)
        if p:
            errs.append(f"{where}: approval.evidence: {p}")
        if not (dt == UNKNOWN and isinstance(dt, str)) and not real_date(dt):
            errs.append(f"{where}: approval.date must be UNKNOWN or a real ISO date YYYY-MM-DD")
        if status == "approved":
            approved = True
            if ev == UNKNOWN or p:
                errs.append(f"{where}: approved but approval.evidence is UNKNOWN or invalid")
            if not real_date(dt):
                errs.append(f"{where}: approved but approval.date is UNKNOWN or not a real ISO date")
            if r["reviewer"] == UNKNOWN or text_problem(r["reviewer"], set()):
                errs.append(f"{where}: approved but reviewer is UNKNOWN or not a meaningful string")
        elif status == UNKNOWN and (ev != UNKNOWN or dt != UNKNOWN):
            errs.append(f"{where}: approval.status is UNKNOWN but evidence or date is present")
    if rights == "cleared":
        if not approved:
            errs.append(f"{where}: rights_status cleared needs an approval with evidence, date and reviewer as its proof")
        if r["permitted_uses"] == UNKNOWN or r["restrictions"] == UNKNOWN:
            errs.append(f"{where}: rights_status cleared needs known permitted_uses and restrictions")

    disp = r["disposition"]
    release = disp.get("release") if isinstance(disp, dict) else None
    if not isinstance(disp, dict) or not isinstance(release, str) or release not in RELEASE or not meaningful(disp.get("rationale")):
        errs.append(f"{where}: disposition needs release in {sorted(RELEASE)} and a meaningful rationale")
    rel = r["path"]
    # Classification rules: reference/internal/third-party/licensed never become release candidates.
    if cls in EXCLUDED_CLASSES and release != "excluded":
        errs.append(f"{where}: classification {show(cls)} must have disposition.release 'excluded'")
    if rel.endswith(FONT_EXT) and (release != "excluded" or cls != "licensed-dependency"):
        errs.append(f"{where}: runtime font files are source-only: classification licensed-dependency, release excluded")
    if rel.startswith("references/") and cls in ELIGIBLE_CLASSES:
        errs.append(f"{where}: files in references/ cannot be classified first-party from their location or appearance")
    if cls == "reference-unknown" and rights != UNKNOWN:
        errs.append(f"{where}: reference-unknown must keep rights_status UNKNOWN")
    return errs


def validate_register(root: Path, reg, tracked: set[str]) -> list[str]:
    errs: list[str] = []
    if not isinstance(reg, dict):
        return [f"{REGISTER}: top level must be an object"]
    if reg.get("schema_version") != 1:
        errs.append(f"{REGISTER}: schema_version must be 1")
    if reg.get("hash_algorithm") != "sha256":
        errs.append(f"{REGISTER}: hash_algorithm must be 'sha256'")
    if not isinstance(reg.get("synthetic"), bool):
        errs.append(f"{REGISTER}: 'synthetic' must be true or false")
    if not meaningful(reg.get("source_revision")):
        errs.append(f"{REGISTER}: missing source_revision")
    prefixes = reg.get("scope_prefixes")
    if not isinstance(prefixes, list) or not all(isinstance(p, str) and p.endswith("/") for p in prefixes):
        return errs + [f"{REGISTER}: scope_prefixes must be a list of 'dir/' prefixes"]
    missing = [p for p in REQUIRED_SCOPE if p not in prefixes]
    if missing:
        errs.append(f"{REGISTER}: scope_prefixes must include the complete required scope {list(REQUIRED_SCOPE)}; "
                    f"missing {missing} (extra prefixes may be added, none removed)")
    records = reg.get("records")
    if not isinstance(records, list) or not records:
        return errs + [f"{REGISTER}: 'records' must be a non-empty list"]
    errs += sanitize_problems(reg, REGISTER)

    seen: set[str] = set()
    cls_of: dict[str, object] = {}
    rec_of: dict[str, dict] = {}
    for i, r in enumerate(records):
        where = f"records[{i}] ({show(r.get('path', '?')) if isinstance(r, dict) else '?'})"
        if not isinstance(r, dict):
            errs.append(f"{where}: must be an object")
            continue
        rel = r.get("path")
        bad = path_problem(root, rel)
        if bad:
            errs.append(f"{where}: {bad}")
            continue
        if rel in seen:
            errs.append(f"{where}: duplicate path")
        seen.add(rel)
        cls_of[rel], rec_of[rel] = r.get("classification"), r
        if not any(rel.startswith(p) for p in set(REQUIRED_SCOPE) | set(prefixes)):
            errs.append(f"{where}: path is outside the provenance scope")
        errs += validate_record(root, r, where, tracked)
        actual = root / rel
        if not actual.is_file():
            errs.append(f"{where}: file does not exist")
        else:
            digest = r.get("sha256")
            if not isinstance(digest, str) or not SHA_RE.match(digest):
                errs.append(f"{where}: sha256 must be 64 lowercase hex characters")
            elif digest != sha256_file(actual):
                errs.append(f"{where}: sha256 does not match the file bytes (stale register); actual {sha256_file(actual)}")
            if r.get("size_bytes") != actual.stat().st_size:
                errs.append(f"{where}: size_bytes does not match the file")

    covered: dict[str, list[str]] = {}
    for rel, r in rec_of.items():
        nf = r.get("notice_files")
        if not isinstance(nf, list):
            continue
        for n in nf:
            if not isinstance(n, str) or n not in seen:
                errs.append(f"{show(rel)}: notice file {show(n)} is not a register record")
            elif cls_of[n] != "licence-notice":
                errs.append(f"{show(rel)}: notice file {show(n)} is not classified licence-notice")
            else:
                covered.setdefault(n, []).append(rel)
    for rel, r in rec_of.items():
        if r.get("classification") != "licence-notice":
            continue
        if rel not in covered:
            errs.append(f"{show(rel)}: licence notice is not named by any record's notice_files")
        disp = r.get("disposition")
        if isinstance(disp, dict) and disp.get("release") == "candidate":
            eligible_cover = [a for a in covered.get(rel, []) if rec_of[a].get("classification") in ELIGIBLE_CLASSES
                              and not a.endswith(FONT_EXT) and isinstance(rec_of[a].get("disposition"), dict)
                              and rec_of[a]["disposition"].get("release") == "candidate"]
            if not eligible_cover:
                errs.append(f"{show(rel)}: a licence notice can be a release candidate only when it covers an eligible "
                            "non-font candidate asset (font notices stay excluded with their fonts)")

    in_scope = scope_files(root, prefixes, tracked)
    for f in sorted(in_scope - seen):
        errs.append(f"unregistered file: {show(f)}")
    for f in sorted(seen - in_scope):
        errs.append(f"registered path is not a tracked in-scope file: {show(f)}")
    return errs


def validate_allowlist_shape(root: Path, al, register_paths: set[str], tracked: set[str]) -> list[str]:
    if not isinstance(al, dict):
        return [f"{ALLOWLIST}: top level must be an object"]
    errs = []
    if al.get("schema_version") != 1:
        errs.append(f"{ALLOWLIST}: schema_version must be 1")
    if not isinstance(al.get("synthetic"), bool):
        errs.append(f"{ALLOWLIST}: 'synthetic' must be true or false")
    if not isinstance(al.get("status"), str) or al.get("status") not in ALLOWLIST_STATUS:
        errs.append(f"{ALLOWLIST}: status must be one of {sorted(ALLOWLIST_STATUS)}")
    review = al.get("review")
    if not isinstance(review, dict) or set(review) != {"reviewer", "evidence", "date"}:
        errs.append(f"{ALLOWLIST}: review must be an object with exactly reviewer, evidence and date (UNKNOWN is allowed in shape checks)")
    else:
        if text_problem(review["reviewer"], {UNKNOWN}):
            errs.append(f"{ALLOWLIST}: review.reviewer must be UNKNOWN or a meaningful name/role string")
        p = evidence_problem(root, review["evidence"], tracked)
        if p:
            errs.append(f"{ALLOWLIST}: review.evidence: {p}")
        if not (review["date"] == UNKNOWN and isinstance(review["date"], str)) and not real_date(review["date"]):
            errs.append(f"{ALLOWLIST}: review.date must be UNKNOWN or a real ISO date YYYY-MM-DD")
    entries = al.get("entries")
    if not isinstance(entries, list):
        return errs + [f"{ALLOWLIST}: 'entries' must be a list"]
    errs += sanitize_problems(al, ALLOWLIST)
    seen = set()
    for i, e in enumerate(entries):
        where = f"allowlist entries[{i}] ({show(e.get('path', '?')) if isinstance(e, dict) else '?'})"
        if not isinstance(e, dict):
            errs.append(f"{where}: must be an object")
            continue
        bad = path_problem(root, e.get("path"))
        if bad:
            errs.append(f"{where}: {bad}")
            continue
        if e["path"] in seen:
            errs.append(f"{where}: duplicate path")
        seen.add(e["path"])
        if e["path"] not in register_paths:
            errs.append(f"{where}: path is not in the register")
        if not isinstance(e.get("sha256"), str) or not SHA_RE.match(e["sha256"]):
            errs.append(f"{where}: sha256 must be 64 lowercase hex characters")
        if not meaningful(e.get("use")):
            errs.append(f"{where}: needs a 'use' naming the permitted use (a meaningful string)")
    return errs


def approval_blocker(r: dict) -> str | None:
    """Why a record lacks a usable approval and cleared rights, or None. Assumes the shape was validated."""
    a = r["approval"]
    if a.get("status") != "approved" or a.get("evidence") == UNKNOWN or not real_date(a.get("date")) \
            or r.get("reviewer") == UNKNOWN or text_problem(r.get("reviewer"), set()):
        return "no approval with evidence, date and reviewer in the register"
    if r.get("rights_status") != "cleared":
        return "rights_status is not cleared"
    return None


def production_problems(root: Path, reg, al, allow_synthetic: bool = False) -> list[str]:
    """Fail-closed eligibility. Assumes the register and allowlist shapes already validated."""
    errs: list[str] = []
    if (reg.get("synthetic") or al.get("synthetic")) and not allow_synthetic:
        errs.append("synthetic fixture data can never be release evidence")
    by_path = {r["path"]: r for r in reg["records"]}
    # Required-core status comes from path policy; the register's own `core` flag cannot lower it.
    core_blocking = [r["path"] for r in reg["records"] if (is_core(r["path"], r["classification"]) or r.get("core") is True)
                     and approval_blocker(r)]
    if core_blocking:
        errs.append(f"core asset rights/approval not cleared for {len(core_blocking)} core file(s), e.g. {show(core_blocking[0])}; "
                    "an otherwise complete register does not lift this")
    entries = al.get("entries") or []
    if not entries:
        errs.append("allowlist is empty: no reviewed export candidate exists")
    review = al.get("review") or {}
    if text_problem(review.get("reviewer"), set()):
        errs.append("allowlist review.reviewer is UNKNOWN: the exact candidate list has not been reviewed")
    if review.get("evidence") == UNKNOWN:
        errs.append("allowlist review.evidence is UNKNOWN: the exact candidate list has not been reviewed")
    if not real_date(review.get("date")):
        errs.append("allowlist review.date is UNKNOWN: the exact candidate list has not been reviewed")
    if al.get("status") != "reviewed":
        errs.append("allowlist status is not 'reviewed'")
    listed = {e["path"]: e for e in entries}
    for path, e in listed.items():
        where = f"allowlist {show(path)}"
        r = by_path.get(path)
        if r is None:
            continue
        actual = root / path
        if not actual.is_file():
            errs.append(f"{where}: file missing")
            continue
        digest = sha256_file(actual)
        if e["sha256"] != digest:
            errs.append(f"{where}: allowlist hash does not match the file bytes (stale)")
        if r["sha256"] != digest or e["sha256"] != r["sha256"]:
            errs.append(f"{where}: register hash does not match the file bytes (stale)")
        cls = r["classification"]
        is_notice = cls == "licence-notice"
        if cls not in ELIGIBLE_CLASSES and not is_notice:
            errs.append(f"{where}: classification {show(cls)} is excluded from release (reference, internal, third-party or licensed)")
        if path.endswith(FONT_EXT):
            errs.append(f"{where}: runtime font files are never exported (no self-hosted fonts)")
        if r["disposition"]["release"] != "candidate":
            errs.append(f"{where}: register disposition is {show(r['disposition']['release'])}")
        blocker = approval_blocker(r)
        if blocker:
            errs.append(f"{where}: {blocker}")
        for field in ("intended_uses", "permitted_uses", "restrictions"):
            if not isinstance(r.get(field), list):
                errs.append(f"{where}: {field} is UNKNOWN")
        pu = r.get("permitted_uses")
        if isinstance(pu, list) and e["use"] not in pu:
            errs.append(f"{where}: use {show(e['use'])} is not among the register's permitted_uses")
        if is_notice:
            assets = [a for a, ar in by_path.items() if a in listed and path in ar["notice_files"]
                      and ar["classification"] in ELIGIBLE_CLASSES and not a.endswith(FONT_EXT)]
            if not assets:
                errs.append(f"{where}: licence notice has no allowlisted eligible non-font asset that it accompanies")
        if r.get("notice_required") == UNKNOWN:
            errs.append(f"{where}: notice_required is UNKNOWN")
        elif r.get("notice_required") == "yes":
            for n in r["notice_files"]:
                if n not in listed:
                    errs.append(f"{where}: required notice {show(n)} is not in the allowlist")
    return errs


def run(root: Path, production: bool, allow_synthetic: bool = False) -> list[str]:
    """allow_synthetic exists for the unit tests only; the CLI never sets it."""
    tracked = set(list_files(root))
    reg, e1 = load_json(root, REGISTER)
    al, e2 = load_json(root, ALLOWLIST)
    errs = e1 + e2
    if reg is not None:
        errs += validate_register(root, reg, tracked)
    if al is not None:
        paths = {r.get("path") for r in reg.get("records", []) if isinstance(r, dict) and isinstance(r.get("path"), str)} \
            if isinstance(reg, dict) and isinstance(reg.get("records"), list) else set()
        errs += validate_allowlist_shape(root, al, paths, tracked)
    if production:
        if errs:
            return errs + ["production check not evaluated further: fix structural problems first"]
        errs += production_problems(root, reg, al, allow_synthetic)
    return errs


def report(root: Path) -> int:
    errs = run(root, False)
    if errs:
        print("\n".join(f"FAIL {e}" for e in errs))
        return 1
    reg, _ = load_json(root, REGISTER)
    al, _ = load_json(root, ALLOWLIST)
    listed = {e["path"] for e in al["entries"]}
    for r in reg["records"]:
        verdict = "INCLUDE" if r["path"] in listed else "EXCLUDE"
        print(f"{verdict}  {r['classification']:<22} approval={r['approval']['status']:<8} {show(r['path'])}")
        print(f"         {r['disposition']['rationale']}")  # validated above: no secret-like text
    print(f"allowlisted: {len(listed)} of {len(reg['records'])} registered files")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=ROOT)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--register-only", action="store_true", help="structural validation only")
    mode.add_argument("--report", action="store_true", help="print the include/exclude decision report")
    mode.add_argument("--print-hashes", action="store_true", help="print sha256 of in-scope files (refresh aid)")
    args = ap.parse_args(argv)
    root = args.root.resolve()
    try:
        return _dispatch(args, root)
    except Exception as exc:  # fail closed without echoing any input value
        print(f"FAIL validator could not process the inputs ({type(exc).__name__}); no input values are printed")
        return 1


def _dispatch(args, root: Path) -> int:
    if args.print_hashes:
        reg, errs = load_json(root, REGISTER)
        prefixes = reg.get("scope_prefixes", []) if isinstance(reg, dict) else []
        for f in sorted(scope_files(root, prefixes, set(list_files(root)))):
            if (root / f).is_file():
                print(f"{sha256_file(root / f)}  {f}")
        return 0
    if args.report:
        return report(root)
    production = not args.register_only
    errs = run(root, production)
    name = "check-provenance" if production else "check-provenance-register"
    if errs:
        for e in errs:
            print(f"FAIL {e}")
        print(f"{name}: {len(errs)} problem(s)" + (" -- NOT release eligible" if production else ""))
        return 1
    if production:
        print("check-provenance: reviewed allowlist and core evidence pass (this is not a release approval)")
    else:
        print("check-provenance-register: OK (structure, coverage and hashes; UNKNOWN values are allowed here and are not approvals)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
