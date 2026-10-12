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
MAX_METADATA_BYTES = 1 << 20
MAX_ERRORS = 100
MAX_CRITERION_ID_LENGTH = 64


class Report:
    def __init__(self):
        self.errors = []
        self.error_counts = {}
        self.total_errors = 0
        self.counts = {"manifests": 0, "manifest_entries": 0, "criteria_json": 0,
                       "criteria_markdown": 0}
        self.status_counts = {s: 0 for s in STATUSES}

    def err(self, code, file, detail):
        self.total_errors += 1
        self.error_counts[code] = self.error_counts.get(code, 0) + 1
        if len(self.errors) >= MAX_ERRORS:
            return
        self.errors.append({"code": code, "file": file, "detail": detail})

    def as_dict(self):
        errors = sorted(self.errors, key=lambda e: (e["code"], e["file"], e["detail"]))
        return {
            "provider_mode": PROVIDER_MODE,
            "scope": SCOPE,
            "ok": not errors,
            "counts": dict(sorted(self.counts.items())),
            "status_counts": self.status_counts,
            "error_counts": dict(sorted(self.error_counts.items())),
            "errors": errors,
            "errors_truncated": self.total_errors > len(errors),
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


def _read_regular(report, path, diagnostic_file, code):
    """Return file bytes, or None after recording an error."""
    try:
        with _open_regular(path) as fh:
            raw = fh.read(MAX_METADATA_BYTES + 1)
            if len(raw) > MAX_METADATA_BYTES:
                report.err("input-too-large", diagnostic_file,
                           "metadata input exceeds the 1 MiB limit")
                return None
            return raw
    except NotRegular:
        report.err("not-regular-input", diagnostic_file, "input is not a regular file")
    except OSError:
        report.err(code, diagnostic_file, "cannot read input")
    return None


def _hash(path):
    h = hashlib.sha256()
    with _open_regular(path) as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def audit_manifest(report, root, sums_path, diagnostic_file):
    report.counts["manifests"] += 1
    base = os.path.realpath(os.path.dirname(sums_path))
    real_root = os.path.realpath(root)
    if os.path.islink(sums_path) or not _inside(real_root, os.path.realpath(sums_path)):
        report.err("symlink-escape", diagnostic_file, "manifest is a symlink")
        return
    raw = _read_regular(report, sums_path, diagnostic_file, "manifest-unreadable")
    if raw is None:
        return
    try:
        lines = raw.decode("utf-8").split("\n")
    except UnicodeDecodeError:
        report.err("manifest-unreadable", diagnostic_file, "cannot read manifest as UTF-8")
        return
    if lines and lines[-1] == "":
        lines.pop()
    if not lines:
        report.err("manifest-empty", diagnostic_file, "manifest has no entries")
    seen = {}
    for number, line in enumerate(lines, 1):
        where = "line %d" % number
        match = SUM_LINE.match(line)
        if not match:
            report.err("malformed-entry", diagnostic_file, where + " is not '<sha256>  <path>'")
            continue
        digest, rel = match.groups()
        report.counts["manifest_entries"] += 1
        if rel in seen:
            report.err("duplicate-entry", diagnostic_file,
                       "%s repeats the path on line %d" % (where, seen[rel]))
            continue
        seen[rel] = number
        bad = _safe_member(rel)
        if bad:
            report.err(bad, diagnostic_file, "%s has an unsafe path" % where)
            continue
        target = os.path.join(base, *rel.split("/"))
        # Any symlinked component whose resolution leaves the manifest dir is an escape.
        if not _inside(base, os.path.realpath(target)):
            report.err("symlink-escape", diagnostic_file,
                       "%s resolves outside the manifest directory" % where)
            continue
        if not os.path.lexists(target):
            report.err("missing-file", diagnostic_file, "%s names a missing file" % where)
            continue
        if not os.path.isfile(target):
            report.err("not-regular-file", diagnostic_file, "%s names a non-regular file" % where)
            continue
        try:
            actual = _hash(target)
        except NotRegular:
            report.err("not-regular-file", diagnostic_file,
                       "%s names a non-regular file" % where)
            continue
        except OSError:
            report.err("file-unreadable", diagnostic_file, "%s names an unreadable file" % where)
            continue
        if actual != digest:
            report.err("hash-mismatch", diagnostic_file, "%s hash differs from the file" % where)


def find_manifests(report, root, evidence):
    """Collect SHA256SUMS paths; symlinked directories are errors, never skipped."""
    evidence_dir = os.path.join(root, evidence)
    if os.path.islink(evidence_dir):
        report.err("symlink-dir", "evidence", "evidence root is a symlink")
        return []
    found = []
    def unreadable(exc):
        report.err("dir-unreadable", "evidence", "cannot list evidence directory")

    for dirpath, dirnames, filenames in os.walk(evidence_dir, followlinks=False, onerror=unreadable):
        dirnames.sort()
        for name in dirnames:
            full = os.path.join(dirpath, name)
            if os.path.islink(full):
                report.err("symlink-dir", "evidence", "evidence directory is a symlink")
            elif name == SUMS_NAME:
                report.err("not-regular-input", "evidence", "manifest path is a directory")
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


def audit_json(report, path, diagnostic_file):
    positions = {}
    raw = _read_regular(report, path, diagnostic_file, "json-unreadable")
    if raw is None:
        return {}, positions
    try:
        data = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicates)
    except _DuplicateKey:
        report.err("duplicate-key", diagnostic_file, "JSON object repeats a key")
        return {}, positions
    except (OSError, ValueError, RecursionError):
        report.err("json-unreadable", diagnostic_file, "cannot parse checklist JSON")
        return {}, positions
    if not isinstance(data, dict) or not isinstance(data.get("criteria"), list):
        report.err("json-shape", diagnostic_file, "expected object with a criteria list")
        return {}, positions
    if data.get("allowed_statuses") != list(STATUSES):
        report.err("allowed-states", diagnostic_file,
                   "allowed_statuses must equal %s" % ", ".join(STATUSES))
    if not data["criteria"]:
        report.err("empty-checklist", diagnostic_file, "criteria list is empty")
    result = {}
    for index, crit in enumerate(data["criteria"]):
        report.counts["criteria_json"] += 1
        spot = "criterion[%d]" % index
        if not isinstance(crit, dict):
            report.err("json-shape", diagnostic_file, spot + " is not an object")
            continue
        cid = crit.get("id")
        if (not isinstance(cid, str) or len(cid) > MAX_CRITERION_ID_LENGTH
                or not CRITERION_ID.fullmatch(cid)):
            report.err("invalid-id", diagnostic_file, spot + " has a missing or malformed id")
            continue
        if cid in result:
            report.err("duplicate-id", diagnostic_file,
                       "%s duplicates %s" % (spot, positions[cid]))
            continue
        positions[cid] = spot
        status = crit.get("status")
        if not isinstance(status, str) or status not in STATUSES:
            report.err("unknown-state", diagnostic_file,
                       "%s has a status that is not allowed" % spot)
            result[cid] = None
            continue
        result[cid] = status
        report.status_counts[status] += 1
        if status == "verified":
            if not _nonempty_strings(crit.get("evidence_refs")):
                report.err("verified-missing-evidence", diagnostic_file,
                           "%s verified entry needs nonempty evidence_refs" % spot)
            if not _nonempty_strings(crit.get("tested_revision_refs")):
                report.err("verified-missing-revisions", diagnostic_file,
                           "%s verified entry needs nonempty tested_revision_refs" % spot)
    return result, positions


def audit_markdown(report, path, diagnostic_file):
    positions = {}
    raw = _read_regular(report, path, diagnostic_file, "markdown-unreadable")
    if raw is None:
        return {}, positions
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        report.err("markdown-unreadable", diagnostic_file, "cannot read checklist Markdown")
        return {}, positions
    result = {}
    heads = [i for i, line in enumerate(lines) if MD_ANY_HEADING.match(line)]
    heads.append(len(lines))
    for pos, i in enumerate(heads[:-1]):
        head = MD_HEADING.match(lines[i])
        if not head:
            continue
        cid = head.group(1)
        spot = "heading line %d" % (i + 1)
        if len(cid) > MAX_CRITERION_ID_LENGTH:
            report.err("invalid-id", diagnostic_file,
                       "%s has a malformed criterion id" % spot)
            continue
        report.counts["criteria_markdown"] += 1
        if cid in result:
            report.err("duplicate-id", diagnostic_file,
                       "%s duplicates %s" % (spot, positions[cid]))
            continue
        positions[cid] = spot
        states = [m for m in (MD_STATE.match(l) for l in lines[i + 1:heads[pos + 1]]) if m]
        if not states:
            report.err("unknown-state", diagnostic_file,
                       "%s has no status line" % spot)
            result[cid] = None
            continue
        if len(states) > 1:
            report.err("duplicate-status", diagnostic_file,
                       "%s has more than one status line" % spot)
            result[cid] = None
            continue
        state = states[0]
        status = MD_STATUS.get(state.group(2).strip().lower())
        if status is None:
            report.err("unknown-state", diagnostic_file,
                       "%s has a status that is not allowed" % spot)
            result[cid] = None
            continue
        if (state.group(1) != " ") != (status == "verified"):
            report.err("checkbox-mismatch", diagnostic_file,
                       "%s checkbox disagrees with its status" % spot)
        result[cid] = status
    if not result:
        report.err("empty-checklist", diagnostic_file, "no criterion headings found")
    return result, positions


def compare(report, rel_md, md, rel_json, js, md_positions, json_positions):
    for cid in sorted(set(md) - set(js)):
        spot = md_positions.get(cid, "Markdown criterion")
        report.err("checklist-disagreement", rel_md,
                   "%s has no matching JSON criterion" % spot)
    for cid in sorted(set(js) - set(md)):
        spot = json_positions.get(cid, "JSON criterion")
        report.err("checklist-disagreement", rel_json,
                   "%s has no matching Markdown heading" % spot)
    for cid in sorted(set(md) & set(js)):
        if md[cid] and js[cid] and md[cid] != js[cid]:
            md_spot = md_positions.get(cid, "Markdown criterion")
            json_spot = json_positions.get(cid, "JSON criterion")
            report.err("checklist-disagreement", rel_json,
                       "%s and %s have different statuses" % (json_spot, md_spot))


def run(root, evidence="evidence", checklist_json="planning/acceptance-checklist.json",
        checklist_md="planning/acceptance-checklist.md"):
    report = Report()
    evidence_dir = os.path.join(root, evidence)
    if os.path.isdir(evidence_dir):
        manifests = find_manifests(report, root, evidence)
        if not manifests and not report.errors:
            report.err("no-manifests", "evidence", "no SHA256SUMS manifests found")
        for index, sums in enumerate(manifests, 1):
            audit_manifest(report, root, sums, "evidence manifest %d" % index)
    elif os.path.lexists(evidence_dir):
        report.err("evidence-not-dir", "evidence", "evidence root is not a directory")
    else:
        report.err("no-manifests", "evidence", "evidence directory not found")
    js, json_positions = audit_json(
        report, os.path.join(root, checklist_json), "acceptance checklist JSON")
    md, md_positions = audit_markdown(
        report, os.path.join(root, checklist_md), "acceptance checklist Markdown")
    compare(report, "acceptance checklist Markdown", md,
            "acceptance checklist JSON", js, md_positions, json_positions)
    return report.as_dict()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
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
