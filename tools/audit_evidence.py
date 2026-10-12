#!/usr/bin/env python3
"""Read-only integrity audit of evidence manifests and the acceptance checklist.

Scope is integrity only: SHA256SUMS manifests resolve safely and match, the
Markdown and JSON checklists agree, and verified entries carry evidence and
revision refs. It never contacts a provider, never infers that anything is
live-true, and never writes or promotes a status.
"""
import argparse
import hashlib
import json
import os
import re
import stat
import sys

PROVIDER_MODE = "N/A"
SCOPE = "integrity-only"
STATUSES = ("planned", "in_progress", "blocked", "verified", "deferred")
MD_STATUS = {
    "planned": "planned",
    "in progress": "in_progress",
    "blocked": "blocked",
    "verified": "verified",
    "deferred": "deferred",
}
SUMS_NAME = "SHA256SUMS"
SUM_LINE = re.compile(r"^([0-9a-f]{64}) [ *](.+)$")
CRITERION_ID = re.compile(r"^[A-Z][A-Z0-9]*-[0-9]+$")
MD_HEADING = re.compile(r"^### ([A-Z][A-Z0-9]*-[0-9]+)(?:\s|$)")
MD_ANY_HEADING = re.compile(r"^#{1,3} ")
MD_STATE = re.compile(r"^\s*[-*+] \[([ xX])\] \*\*([^*]*)\*\*")
CHUNK = 1 << 20


class Report:
    def __init__(self):
        self.errors = []
        self.counts = {"manifests": 0, "manifest_entries": 0, "criteria_json": 0,
                       "criteria_markdown": 0}
        self.status_counts = {s: 0 for s in STATUSES}

    def err(self, code, file, detail, ident=None):
        item = {"code": code, "file": file, "detail": detail}
        if ident is not None:
            item["id"] = ident
        self.errors.append(item)

    def as_dict(self):
        errors = sorted(self.errors, key=lambda e: (e["code"], e["file"], e.get("id", ""), e["detail"]))
        by_code = {}
        for e in errors:
            by_code[e["code"]] = by_code.get(e["code"], 0) + 1
        return {
            "provider_mode": PROVIDER_MODE,
            "scope": SCOPE,
            "ok": not errors,
            "counts": dict(sorted(self.counts.items())),
            "status_counts": self.status_counts,
            "error_counts": dict(sorted(by_code.items())),
            "errors": errors,
        }


def _inside(base, target):
    return target == base or target.startswith(base + os.sep)


def _safe_member(rel):
    """Return an error code for an unsafe manifest path, or None."""
    if not rel or "\x00" in rel:
        return "unsafe-path"
    if rel.startswith("/") or "\\" in rel or re.match(r"^[A-Za-z]:", rel):
        return "unsafe-path"
    parts = rel.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return "path-traversal" if ".." in parts else "unsafe-path"
    return None


class NotRegular(Exception):
    pass


def _open_regular(path):
    """Open a regular file (symlinks resolved) without ever blocking on a FIFO or device."""
    if not stat.S_ISREG(os.stat(path).st_mode):
        raise NotRegular()
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0))
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):  # swapped after the check
            raise NotRegular()
    except BaseException:
        os.close(fd)
        raise
    return os.fdopen(fd, "rb")


def _read_regular(report, path, rel, code):
    """Return file bytes, or None after recording an error."""
    try:
        with _open_regular(path) as fh:
            return fh.read()
    except NotRegular:
        report.err("not-regular-input", rel, "input is not a regular file")
    except OSError:
        report.err(code, rel, "cannot read input")
    return None


def _hash(path):
    h = hashlib.sha256()
    with _open_regular(path) as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def audit_manifest(report, root, sums_path):
    rel_sums = os.path.relpath(sums_path, root)
    report.counts["manifests"] += 1
    base = os.path.realpath(os.path.dirname(sums_path))
    real_root = os.path.realpath(root)
    if os.path.islink(sums_path) or not _inside(real_root, os.path.realpath(sums_path)):
        report.err("symlink-escape", rel_sums, "manifest is a symlink")
        return
    raw = _read_regular(report, sums_path, rel_sums, "manifest-unreadable")
    if raw is None:
        return
    try:
        lines = raw.decode("utf-8").split("\n")
    except UnicodeDecodeError:
        report.err("manifest-unreadable", rel_sums, "cannot read manifest as UTF-8")
        return
    if lines and lines[-1] == "":
        lines.pop()
    if not lines:
        report.err("manifest-empty", rel_sums, "manifest has no entries")
    seen = {}
    for number, line in enumerate(lines, 1):
        where = "line %d" % number
        match = SUM_LINE.match(line)
        if not match:
            report.err("malformed-entry", rel_sums, where + " is not '<sha256>  <path>'")
            continue
        digest, rel = match.groups()
        report.counts["manifest_entries"] += 1
        if rel in seen:
            report.err("duplicate-entry", rel_sums, "%s repeats the path on line %d" % (where, seen[rel]))
            continue
        seen[rel] = number
        bad = _safe_member(rel)
        if bad:
            report.err(bad, rel_sums, "%s has an unsafe path" % where)
            continue
        target = os.path.join(base, *rel.split("/"))
        # Any symlinked component whose resolution leaves the manifest dir is an escape.
        if not _inside(base, os.path.realpath(target)):
            report.err("symlink-escape", rel_sums, "%s resolves outside the manifest directory" % where)
            continue
        if not os.path.lexists(target):
            report.err("missing-file", rel_sums, "%s names a missing file" % where)
            continue
        if not os.path.isfile(target):
            report.err("not-regular-file", rel_sums, "%s names a non-regular file" % where)
            continue
        try:
            actual = _hash(target)
        except NotRegular:
            report.err("not-regular-file", rel_sums, "%s names a non-regular file" % where)
            continue
        except OSError:
            report.err("file-unreadable", rel_sums, "%s names an unreadable file" % where)
            continue
        if actual != digest:
            report.err("hash-mismatch", rel_sums, "%s hash differs from the file" % where)


def find_manifests(report, root, evidence):
    """Collect SHA256SUMS paths; symlinked directories are errors, never skipped."""
    evidence_dir = os.path.join(root, evidence)
    if os.path.islink(evidence_dir):
        report.err("symlink-dir", evidence, "evidence root is a symlink")
        return []
    found = []
    def unreadable(exc):
        name = getattr(exc, "filename", None) or evidence_dir
        report.err("dir-unreadable", os.path.relpath(name, root), "cannot list evidence directory")

    for dirpath, dirnames, filenames in os.walk(evidence_dir, followlinks=False, onerror=unreadable):
        dirnames.sort()
        for name in dirnames:
            full = os.path.join(dirpath, name)
            if os.path.islink(full):
                report.err("symlink-dir", os.path.relpath(full, root), "evidence directory is a symlink")
            elif name == SUMS_NAME:
                report.err("not-regular-input", os.path.relpath(full, root), "manifest path is a directory")
        if SUMS_NAME in dirnames:
            dirnames.remove(SUMS_NAME)  # reserved name: reported above, never descended
        if SUMS_NAME in filenames:
            found.append(os.path.join(dirpath, SUMS_NAME))
    return sorted(found)


def _nonempty_strings(value):
    return isinstance(value, list) and bool(value) and all(isinstance(v, str) and v.strip() for v in value)


class _DuplicateKey(ValueError):
    pass


def _no_duplicates(pairs):
    seen = set()
    for key, _ in pairs:
        if key in seen:
            raise _DuplicateKey()
        seen.add(key)
    return dict(pairs)


def audit_json(report, path, rel):
    raw = _read_regular(report, path, rel, "json-unreadable")
    if raw is None:
        return {}
    try:
        data = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicates)
    except _DuplicateKey:
        report.err("duplicate-key", rel, "JSON object repeats a key")
        return {}
    except (OSError, ValueError, RecursionError):
        report.err("json-unreadable", rel, "cannot parse checklist JSON")
        return {}
    if not isinstance(data, dict) or not isinstance(data.get("criteria"), list):
        report.err("json-shape", rel, "expected object with a criteria list")
        return {}
    if data.get("allowed_statuses") != list(STATUSES):
        report.err("allowed-states", rel, "allowed_statuses must equal %s" % ", ".join(STATUSES))
    if not data["criteria"]:
        report.err("empty-checklist", rel, "criteria list is empty")
    result = {}
    for index, crit in enumerate(data["criteria"]):
        report.counts["criteria_json"] += 1
        spot = "criterion[%d]" % index
        if not isinstance(crit, dict):
            report.err("json-shape", rel, spot + " is not an object")
            continue
        cid = crit.get("id")
        if not isinstance(cid, str) or not CRITERION_ID.match(cid):
            report.err("invalid-id", rel, spot + " has a missing or malformed id")
            continue
        if cid in result:
            report.err("duplicate-id", rel, "duplicate criterion id", cid)
            continue
        status = crit.get("status")
        if not isinstance(status, str) or status not in STATUSES:
            report.err("unknown-state", rel, "status is not an allowed value", cid)
            result[cid] = None
            continue
        result[cid] = status
        report.status_counts[status] += 1
        if status == "verified":
            if not _nonempty_strings(crit.get("evidence_refs")):
                report.err("verified-missing-evidence", rel, "verified entry needs nonempty evidence_refs", cid)
            if not _nonempty_strings(crit.get("tested_revision_refs")):
                report.err("verified-missing-revisions", rel, "verified entry needs nonempty tested_revision_refs", cid)
    return result


def audit_markdown(report, path, rel):
    raw = _read_regular(report, path, rel, "markdown-unreadable")
    if raw is None:
        return {}
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        report.err("markdown-unreadable", rel, "cannot read checklist Markdown")
        return {}
    result = {}
    heads = [i for i, line in enumerate(lines) if MD_ANY_HEADING.match(line)]
    heads.append(len(lines))
    for pos, i in enumerate(heads[:-1]):
        head = MD_HEADING.match(lines[i])
        if not head:
            continue
        cid = head.group(1)
        report.counts["criteria_markdown"] += 1
        if cid in result:
            report.err("duplicate-id", rel, "duplicate criterion heading", cid)
            continue
        states = [m for m in (MD_STATE.match(l) for l in lines[i + 1:heads[pos + 1]]) if m]
        if not states:
            report.err("unknown-state", rel, "no status line under heading", cid)
            result[cid] = None
            continue
        if len(states) > 1:
            report.err("duplicate-status", rel, "criterion has more than one status line", cid)
            result[cid] = None
            continue
        state = states[0]
        status = MD_STATUS.get(state.group(2).strip().lower())
        if status is None:
            report.err("unknown-state", rel, "status is not an allowed value", cid)
            result[cid] = None
            continue
        if (state.group(1) != " ") != (status == "verified"):
            report.err("checkbox-mismatch", rel, "checkbox disagrees with the status", cid)
        result[cid] = status
    if not result:
        report.err("empty-checklist", rel, "no criterion headings found")
    return result


def compare(report, rel_md, md, rel_json, js):
    for cid in sorted(set(md) - set(js)):
        report.err("checklist-disagreement", rel_md, "id missing from JSON", cid)
    for cid in sorted(set(js) - set(md)):
        report.err("checklist-disagreement", rel_json, "id missing from Markdown", cid)
    for cid in sorted(set(md) & set(js)):
        if md[cid] and js[cid] and md[cid] != js[cid]:
            report.err("checklist-disagreement", rel_json,
                       "Markdown says %s, JSON says %s" % (md[cid], js[cid]), cid)


def run(root, evidence="evidence", checklist_json="planning/acceptance-checklist.json",
        checklist_md="planning/acceptance-checklist.md"):
    report = Report()
    evidence_dir = os.path.join(root, evidence)
    if os.path.isdir(evidence_dir):
        manifests = find_manifests(report, root, evidence)
        if not manifests and not report.errors:
            report.err("no-manifests", evidence, "no SHA256SUMS manifests found")
        for sums in manifests:
            audit_manifest(report, root, sums)
    elif os.path.lexists(evidence_dir):
        report.err("evidence-not-dir", evidence, "evidence root is not a directory")
    else:
        report.err("no-manifests", evidence, "evidence directory not found")
    js = audit_json(report, os.path.join(root, checklist_json), checklist_json)
    md = audit_markdown(report, os.path.join(root, checklist_md), checklist_md)
    compare(report, checklist_md, md, checklist_json, js)
    return report.as_dict()


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    ap.add_argument("--root", default=".", help="repository root (default: .)")
    ap.add_argument("--evidence", default="evidence")
    ap.add_argument("--checklist-json", default="planning/acceptance-checklist.json")
    ap.add_argument("--checklist-md", default="planning/acceptance-checklist.md")
    args = ap.parse_args(argv)
    result = run(args.root, args.evidence, args.checklist_json, args.checklist_md)
    sys.stdout.write(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
