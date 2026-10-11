#!/usr/bin/env python3
"""Validate caller-supplied ACV1 planning and release evidence snapshots offline."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


LIMITS = {
    "coverage-map": 8 * 1024 * 1024,
    "canonical-checklist": 1 * 1024 * 1024,
    "issue-readbacks": 16 * 1024 * 1024,
    "source-pins": 2 * 1024 * 1024,
    "release-manifest": 2 * 1024 * 1024,
    "evidence-file": 256 * 1024 * 1024,
    "evidence-total": 1024 * 1024 * 1024,
}
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
ISSUE_PATH_RE = re.compile(r"^/([^/]+)/([^/]+)/issues/([1-9][0-9]*)/?$")
MODES = {"mock", "recorded", "sandbox", "shadow", "live"}
STAGES = {"fixture", "contract", "runnable", "final_acceptance"}
STAGED_EDGE_STATES = {"pending", "satisfied"}
EVIDENCE_KINDS = {"test", "runtime", "configuration", "artifact", "receipt"}
LEAF_KINDS = {"implementation_leaf", "delivery_leaf"}
NON_LEAF_KINDS = {"epic", "gate", "release_gate", "program_gate"}
COORDINATION_STATES = {"unreported", "pending", "in_progress", "published", "reconciled", "complete"}
PUBLICATION_STATES = {"unreported", "pending", "published", "reconciled", "complete"}
JSON_READ_SIZE = 64 * 1024
MAX_ENTRIES = 10_000
MAX_CONTRIBUTION_ROWS = 100_000
MAX_OWNERSHIP_ROWS = 100_000
MAX_GRAPH_ROWS = 100_000
MAX_RELEASE_RECORDS = 10_000
MAX_BLOCKER_TEXT = 512
MAX_ISSUE_NUMBER_DIGITS = 20


class InputError(Exception):
    """A fixed diagnostic safe to include in the deterministic report."""

    def __init__(self, code: str, record: str = "input") -> None:
        self.code = code
        self.record = record if _safe_key(record) else "input"
        super().__init__(code)


def _safe_key(value: Any) -> bool:
    return isinstance(value, str) and KEY_RE.fullmatch(value) is not None


def _label(value: Any) -> str:
    return value if _safe_key(value) else "<invalid>"


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InputError("DUPLICATE_JSON_KEY", key)
        result[key] = value
    return result


def _reject_constant(_: str) -> None:
    raise InputError("INVALID_JSON_NUMBER")


def _finite_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise InputError("INVALID_JSON_NUMBER")
    return parsed


def _read_bytes(path: str | Path, limit: int, role: str) -> bytes:
    """Read a single explicitly named regular file without following symlinks."""
    try:
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        if hasattr(os, "O_NONBLOCK"):
            flags |= os.O_NONBLOCK
        fd = os.open(os.fspath(path), flags)
    except OSError as exc:
        raise InputError("INPUT_UNREADABLE", role) from exc
    data: bytes | None = None
    failure: InputError | None = None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise InputError("INPUT_TYPE_OR_SIZE", role)
        chunks: list[bytes] = []
        count = 0
        while True:
            chunk = os.read(fd, min(JSON_READ_SIZE, limit + 1 - count))
            if not chunk:
                break
            chunks.append(chunk)
            count += len(chunk)
            if count > limit:
                raise InputError("INPUT_TYPE_OR_SIZE", role)
        data = b"".join(chunks)
        if len(data) != info.st_size:
            raise InputError("INPUT_CHANGED_DURING_READ", role)
    except InputError as exc:
        failure = exc
    except OSError as exc:
        failure = InputError("INPUT_UNREADABLE", role)
        failure.__cause__ = exc
    try:
        os.close(fd)
    except OSError as exc:
        if failure is None:
            failure = InputError("INPUT_CLOSE_FAILED", role)
            failure.__cause__ = exc
    if failure is not None:
        raise failure
    assert data is not None
    return data


def _read_json(path: str | Path, role: str) -> tuple[dict[str, Any], bytes]:
    raw = _read_bytes(path, LIMITS[role], role)
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
            parse_float=_finite_float,
        )
    except InputError:
        raise
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise InputError("INVALID_JSON", role) from exc
    if not isinstance(value, dict):
        raise InputError("JSON_ROOT_NOT_OBJECT", role)
    return value, raw


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _git_blob_sha1(raw: bytes) -> str:
    header = b"blob " + str(len(raw)).encode("ascii") + b"\0"
    return hashlib.sha1(header + raw).hexdigest()


def _as_dict(value: Any, code: str, record: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InputError(code, record)
    return value


def _as_list(value: Any, code: str, record: str) -> list[Any]:
    if not isinstance(value, list):
        raise InputError(code, record)
    return value


def _text(value: Any, code: str, record: str, *, nonempty: bool = True) -> str:
    if not isinstance(value, str) or (nonempty and not value.strip()):
        raise InputError(code, record)
    return value


def _bool(value: Any, code: str, record: str) -> bool:
    if not isinstance(value, bool):
        raise InputError(code, record)
    return value


def _integer(value: Any, code: str, record: str, maximum: int | None = None) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise InputError(code, record)
    if maximum is not None and value > maximum:
        raise InputError(code, record)
    return value


def _iso_utc(value: Any, code: str, record: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise InputError(code, record)
    try:
        result = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise InputError(code, record) from exc
    if result.tzinfo != timezone.utc:
        raise InputError(code, record)
    return result


def _relative_artifact(value: Any, record: str) -> Path:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise InputError("EVIDENCE_PATH_INVALID", record)
    return Path(value)


def _add_issue(issues: list[dict[str, str]], code: str, record: Any) -> None:
    item = {"code": code, "record": _label(record)}
    if item not in issues and len(issues) < 250:
        issues.append(item)


def _add_relation_issue(
    issues: list[dict[str, str]], code: str, record: Any, related_record: Any
) -> None:
    item = {
        "code": code,
        "record": _label(record),
        "related_record": _label(related_record),
    }
    if item not in issues and len(issues) < 250:
        issues.append(item)


def _bounded_rows(
    rows: list[Any], maximum: int, code: str, record: str, issues: list[dict[str, str]]
) -> list[Any]:
    if len(rows) > maximum:
        _add_issue(issues, code, record)
        return rows[:maximum]
    return rows


def _snapshot_state(
    value: Any, allowed: set[str], field: str, issues: list[dict[str, str]]
) -> str:
    if value is None:
        return "unreported"
    if isinstance(value, str) and value in allowed:
        return value
    _add_issue(issues, field.upper() + "_INVALID", field)
    return "unreported"


def _normalized_snapshot_state(value: Any, allowed: set[str]) -> str:
    return value if isinstance(value, str) and value in allowed else "unreported"


def _normalized_utc(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 32:
        return None
    try:
        _iso_utc(value, "TIMESTAMP_INVALID", "input")
    except InputError:
        return None
    return value


def _reported_blockers(coverage: dict[str, Any]) -> tuple[list[dict[str, str]], bool]:
    result: list[dict[str, str]] = []
    entries = coverage.get("entries")
    if not isinstance(entries, list):
        return result, False
    for entry in entries:
        if not isinstance(entry, dict) or not _safe_key(entry.get("key")):
            continue
        blockers = entry.get("blockers", [])
        if not isinstance(blockers, list):
            continue
        for blocker in blockers:
            if not isinstance(blocker, dict):
                continue
            owner, action = blocker.get("owner"), blocker.get("action")
            if not isinstance(owner, str) or not isinstance(action, str):
                continue
            if len(result) == 250:
                return result, True
            result.append({
                "record": entry["key"],
                "owner": owner[:MAX_BLOCKER_TEXT],
                "action": action[:MAX_BLOCKER_TEXT],
            })
    return result, False


def _verify_source_pins(
    pins: dict[str, Any],
    map_raw: bytes,
    canonical_raw: bytes,
    readbacks_raw: bytes,
    issues: list[dict[str, str]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any] | None]:
    if pins.get("format") != "acv1.coverage-source-reference/v1":
        raise InputError("UNSUPPORTED_SOURCE_PINS_FORMAT", "source-pins")
    map_pin = _as_dict(pins.get("coverage_map"), "COVERAGE_MAP_PIN_REQUIRED", "coverage-map")
    if map_pin.get("adapter") != "agent-harness.coverage-map-current/v1":
        _add_issue(issues, "COVERAGE_MAP_ADAPTER_UNSUPPORTED", "coverage-map")
    if not isinstance(map_pin.get("source_path"), str) or not map_pin.get("source_path"):
        _add_issue(issues, "COVERAGE_MAP_SOURCE_PATH_MISSING", "coverage-map")
    expected_map_bytes = _integer(map_pin.get("bytes"), "COVERAGE_MAP_PIN_INVALID", "coverage-map", LIMITS["coverage-map"])
    expected_map_hash = map_pin.get("sha256")
    if not isinstance(expected_map_hash, str) or HASH_RE.fullmatch(expected_map_hash) is None:
        _add_issue(issues, "COVERAGE_MAP_PIN_INVALID", "coverage-map")
    else:
        if len(map_raw) != expected_map_bytes or _sha256(map_raw) != expected_map_hash:
            _add_issue(issues, "COVERAGE_MAP_PIN_MISMATCH", "coverage-map")

    upstream = _as_list(pins.get("upstream_git_objects"), "UPSTREAM_PINS_REQUIRED", "canonical-checklist")
    known_roles = {"global-canonical-checklist", "supporting-contract-catalog-metadata"}
    upstream_by_role: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(upstream):
        if not isinstance(item, dict) or not isinstance(item.get("role"), str):
            _add_issue(issues, "UPSTREAM_PIN_INVALID", f"upstream-{index}")
            continue
        role = item["role"]
        if role not in known_roles:
            _add_issue(issues, "UPSTREAM_ROLE_UNSUPPORTED", role)
            continue
        if role in upstream_by_role:
            _add_issue(issues, "UPSTREAM_ROLE_DUPLICATE", role)
            continue
        upstream_by_role[role] = item
    canonical_pin = upstream_by_role.get("global-canonical-checklist")
    if canonical_pin is None:
        _add_issue(issues, "CANONICAL_PIN_MISSING", "canonical-checklist")
        canonical_pin = {}
    if canonical_pin.get("adapter") != "integration-evals.acceptance-checklist/v1":
        _add_issue(issues, "CANONICAL_ADAPTER_UNSUPPORTED", "canonical-checklist")
    repository = canonical_pin.get("repository")
    if not isinstance(repository, str) or repository.count("/") != 1 or any(not REPOSITORY_RE.fullmatch(part) for part in repository.split("/")):
        _add_issue(issues, "CANONICAL_SOURCE_IDENTITY_INVALID", "canonical-checklist")
    for field in ("issue_pinned_revision", "captured_main_revision"):
        revision = canonical_pin.get(field)
        if not isinstance(revision, str) or re.fullmatch(r"[0-9a-f]{40}", revision) is None:
            _add_issue(issues, "CANONICAL_SOURCE_IDENTITY_INVALID", "canonical-checklist")
    if not isinstance(canonical_pin.get("source_path"), str) or not canonical_pin.get("source_path"):
        _add_issue(issues, "CANONICAL_SOURCE_IDENTITY_INVALID", "canonical-checklist")
    expected_blob = canonical_pin.get("git_blob_sha1")
    expected_bytes = canonical_pin.get("bytes")
    if (
        not isinstance(expected_blob, str)
        or re.fullmatch(r"[0-9a-f]{40}", expected_blob) is None
        or not isinstance(expected_bytes, int)
        or isinstance(expected_bytes, bool)
        or expected_bytes < 0
    ):
        _add_issue(issues, "CANONICAL_PIN_INVALID", "canonical-checklist")
    elif len(canonical_raw) != expected_bytes or _git_blob_sha1(canonical_raw) != expected_blob:
        _add_issue(issues, "CANONICAL_PIN_MISMATCH", "canonical-checklist")

    readback_value = pins.get("issue_readbacks")
    readback_pin = readback_value if isinstance(readback_value, dict) else None
    if readback_pin is None:
        _add_issue(issues, "ISSUE_READBACK_PIN_REQUIRED", "issue-readbacks")
        return map_pin, canonical_pin, None
    if readback_pin.get("adapter") != "agent-harness.issue-readbacks/v1":
        _add_issue(issues, "ISSUE_READBACK_ADAPTER_UNSUPPORTED", "issue-readbacks")
    readback_bytes = readback_pin.get("bytes")
    readback_hash = readback_pin.get("sha256")
    if (
        not isinstance(readback_bytes, int)
        or isinstance(readback_bytes, bool)
        or readback_bytes < 0
        or not isinstance(readback_hash, str)
        or HASH_RE.fullmatch(readback_hash) is None
    ):
        _add_issue(issues, "ISSUE_READBACK_PIN_INVALID", "issue-readbacks")
    elif len(readbacks_raw) != readback_bytes or _sha256(readbacks_raw) != readback_hash:
        _add_issue(issues, "ISSUE_READBACK_PIN_MISMATCH", "issue-readbacks")
    if readback_pin.get("pages_complete") is not True:
        _add_issue(issues, "ISSUE_READBACK_PIN_INCOMPLETE", "issue-readbacks")
    if not _safe_key(readback_pin.get("capture_id")):
        _add_issue(issues, "ISSUE_READBACK_PIN_INVALID", "issue-readbacks")
    try:
        _iso_utc(readback_pin.get("captured_at"), "ISSUE_READBACK_PIN_INVALID", "issue-readbacks")
    except InputError as exc:
        _add_issue(issues, exc.code, exc.record)
    revision = readback_pin.get("observed_revision")
    if revision is not None and (not isinstance(revision, str) or re.fullmatch(r"[0-9a-f]{40}", revision) is None):
        _add_issue(issues, "ISSUE_READBACK_PIN_INVALID", "issue-readbacks")
    return map_pin, canonical_pin, readback_pin


def _canonical_criteria(canonical: dict[str, Any], issues: list[dict[str, str]]) -> dict[str, dict[str, Any]]:
    criteria = canonical.get("criteria")
    if not isinstance(criteria, list):
        _add_issue(issues, "CANONICAL_CRITERIA_MISSING", "canonical-checklist")
        return {}
    criteria = _bounded_rows(criteria, MAX_ENTRIES, "CANONICAL_ROW_LIMIT_EXCEEDED", "canonical-checklist", issues)
    result: dict[str, dict[str, Any]] = {}
    required = {"id", "title", "priority", "owner_role", "verification", "evidence_required"}
    for index, item in enumerate(criteria):
        if not isinstance(item, dict):
            _add_issue(issues, "CANONICAL_CRITERION_INVALID", f"criterion-{index}")
            continue
        ident = item.get("id")
        if not _safe_key(ident):
            _add_issue(issues, "CANONICAL_CRITERION_ID_INVALID", f"criterion-{index}")
            continue
        if ident in result:
            _add_issue(issues, "CANONICAL_CRITERION_DUPLICATE", ident)
            continue
        if not required.issubset(item):
            _add_issue(issues, "CANONICAL_CRITERION_FIELDS_MISSING", ident)
        for field in ("title", "priority", "owner_role", "verification", "evidence_required"):
            text = item.get(field)
            if not isinstance(text, str) or not text.strip() or len(text) > 4096:
                _add_issue(issues, "CANONICAL_CRITERION_FIELD_INVALID", ident)
                break
        result[ident] = item
    return result


def _entry_identity(
    entry: dict[str, Any], record: str, issues: list[dict[str, str]]
) -> tuple[str, str, int] | None:
    repo = entry.get("repository")
    url = entry.get("issue_url")
    if not isinstance(repo, str) or REPOSITORY_RE.fullmatch(repo) is None:
        _add_issue(issues, "ENTRY_REPOSITORY_INVALID", record)
        return None
    if url is None:
        return None
    if not isinstance(url, str):
        _add_issue(issues, "ENTRY_ISSUE_URL_INVALID", record)
        return None
    try:
        parsed = urlparse(url)
    except ValueError:
        _add_issue(issues, "ENTRY_ISSUE_URL_INVALID", record)
        return None
    match = ISSUE_PATH_RE.fullmatch(parsed.path)
    if parsed.scheme != "https" or parsed.hostname != "github.com" or not match:
        _add_issue(issues, "ENTRY_ISSUE_URL_INVALID", record)
        return None
    if parsed.query or parsed.fragment or parsed.username is not None or parsed.password is not None:
        _add_issue(issues, "ENTRY_ISSUE_URL_INVALID", record)
        return None
    owner, url_repo, number_text = match.groups()
    if len(number_text) > MAX_ISSUE_NUMBER_DIGITS:
        _add_issue(issues, "ENTRY_ISSUE_URL_INVALID", record)
        return None
    if url_repo != repo:
        _add_issue(issues, "ENTRY_REPOSITORY_URL_MISMATCH", record)
        return None
    return owner + "/" + url_repo, url, int(number_text)


def _check_issue_readbacks(
    entries: list[dict[str, Any]],
    readbacks: dict[str, Any],
    pin: dict[str, Any] | None,
    issues: list[dict[str, str]],
) -> None:
    if readbacks.get("format") != "agent-harness.issue-readbacks/v1":
        _add_issue(issues, "ISSUE_READBACK_FORMAT_UNSUPPORTED", "issue-readbacks")
    if pin is None:
        _add_issue(issues, "ISSUE_READBACK_PIN_REQUIRED", "issue-readbacks")
    elif readbacks.get("capture_id") != pin.get("capture_id"):
        _add_issue(issues, "ISSUE_READBACK_CAPTURE_MISMATCH", "issue-readbacks")
    if pin is not None and readbacks.get("captured_at") != pin.get("captured_at"):
        _add_issue(issues, "ISSUE_READBACK_TIME_MISMATCH", "issue-readbacks")
    if pin is not None and pin.get("observed_revision") is not None and readbacks.get("observed_revision") != pin.get("observed_revision"):
        _add_issue(issues, "ISSUE_READBACK_REVISION_MISMATCH", "issue-readbacks")
    try:
        _iso_utc(readbacks.get("captured_at"), "ISSUE_READBACK_TIME_INVALID", "issue-readbacks")
    except InputError as exc:
        _add_issue(issues, exc.code, exc.record)
    if readbacks.get("pages_complete") is not True or (pin is not None and pin.get("pages_complete") is not True):
        _add_issue(issues, "ISSUE_READBACK_PAGES_INCOMPLETE", "issue-readbacks")
    rows = readbacks.get("issues")
    if not isinstance(rows, list):
        _add_issue(issues, "ISSUE_READBACK_ROWS_MISSING", "issue-readbacks")
        return
    rows = _bounded_rows(rows, MAX_ENTRIES, "ISSUE_READBACK_ROW_LIMIT_EXCEEDED", "issue-readbacks", issues)
    by_url: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            _add_issue(issues, "ISSUE_READBACK_ROW_INVALID", f"readback-{index}")
            continue
        url = row.get("url")
        if not isinstance(url, str):
            _add_issue(issues, "ISSUE_READBACK_URL_INVALID", f"readback-{index}")
            continue
        try:
            parsed = urlparse(url)
        except ValueError:
            _add_issue(issues, "ISSUE_READBACK_URL_INVALID", f"readback-{index}")
            continue
        readback_match = ISSUE_PATH_RE.fullmatch(parsed.path)
        if (
            parsed.scheme != "https"
            or parsed.hostname != "github.com"
            or not readback_match
            or len(readback_match.group(3)) > MAX_ISSUE_NUMBER_DIGITS
            or parsed.query
            or parsed.fragment
            or parsed.username is not None
            or parsed.password is not None
        ):
            _add_issue(issues, "ISSUE_READBACK_URL_INVALID", f"readback-{index}")
            continue
        if url in by_url:
            _add_issue(issues, "ISSUE_READBACK_DUPLICATE", "issue-readbacks")
            continue
        by_url[url] = row
    for entry in entries:
        if entry.get("required_for_v1") is not True:
            continue
        key = _label(entry.get("key"))
        identity = _entry_identity(entry, key, issues)
        if identity is None:
            if entry.get("issue_url") is None:
                _add_issue(issues, "REQUIRED_ISSUE_URL_UNPROVEN", key)
            continue
        repo_full, url, number = identity
        row = by_url.get(url)
        if row is None:
            _add_issue(issues, "ISSUE_READBACK_NOT_FOUND", key)
            continue
        if row.get("repository") not in (entry.get("repository"), repo_full):
            _add_issue(issues, "ISSUE_READBACK_REPOSITORY_MISMATCH", key)
        if row.get("number") != number or isinstance(row.get("number"), bool):
            _add_issue(issues, "ISSUE_READBACK_NUMBER_MISMATCH", key)
        if not isinstance(row.get("title"), str) or not row.get("title").strip():
            _add_issue(issues, "ISSUE_READBACK_TITLE_INVALID", key)
        elif entry.get("issue_title") is not None and row.get("title") != entry.get("issue_title"):
            _add_issue(issues, "ISSUE_READBACK_TITLE_MISMATCH", key)
        if not isinstance(row.get("body_sha256"), str) or HASH_RE.fullmatch(row.get("body_sha256")) is None:
            _add_issue(issues, "ISSUE_READBACK_BODY_INVALID", key)
        elif entry.get("body_sha256") is not None and row.get("body_sha256") != entry.get("body_sha256"):
            _add_issue(issues, "ISSUE_READBACK_BODY_MISMATCH", key)
        if not isinstance(row.get("state"), str) or row.get("state") not in {"open", "closed"}:
            _add_issue(issues, "ISSUE_READBACK_STATE_INVALID", key)
        else:
            entry_state = entry.get("state")
            if entry_state == "closed" and row.get("state") != "closed":
                _add_issue(issues, "ISSUE_READBACK_STATE_MISMATCH", key)
            elif row.get("state") == "closed":
                if isinstance(entry_state, str) and entry_state in {
                    "planned", "in_progress", "blocked", "deferred", "not_planned", "not-planned"
                }:
                    _add_issue(issues, "ISSUE_READBACK_STATE_MISMATCH", key)
                if not _has_exact_closure_evidence(entry.get("closure_evidence"), _required_test_ids(entry)):
                    _add_issue(issues, "CLOSED_LEAF_WITHOUT_EXACT_EVIDENCE", key)


def _validate_map(
    coverage: dict[str, Any],
    pins: dict[str, Any],
    canonical: dict[str, Any],
    readbacks: dict[str, Any],
    map_pin: dict[str, Any],
    readback_pin: dict[str, Any] | None,
    *,
    check_urls: bool,
    check_dag: bool,
    require_specialists: bool,
) -> tuple[list[dict[str, str]], dict[str, int], dict[str, dict[str, Any]]]:
    issues: list[dict[str, str]] = []
    if coverage.get("format") != "agent-harness.coverage-map-current/v1":
        _add_issue(issues, "COVERAGE_MAP_FORMAT_UNSUPPORTED", "coverage-map")
    if not check_urls:
        _add_issue(issues, "REQUIRED_CHECK_NOT_RUN", "issue-readbacks")
    if not check_dag:
        _add_issue(issues, "REQUIRED_CHECK_NOT_RUN", "dag")
    _snapshot_state(coverage.get("coordination_status"), COORDINATION_STATES, "coordination_status", issues)
    _snapshot_state(coverage.get("publication_status"), PUBLICATION_STATES, "publication_status", issues)
    criteria = _canonical_criteria(canonical, issues)
    entries_raw = coverage.get("entries")
    contributions_raw = coverage.get("source_contribution_rows")
    ownership_raw = coverage.get("ownership_rows")
    if not isinstance(entries_raw, list):
        _add_issue(issues, "ENTRY_FAMILY_MISSING", "entries")
        entries_raw = []
    if not isinstance(contributions_raw, list):
        _add_issue(issues, "CONTRIBUTION_FAMILY_MISSING", "source_contribution_rows")
        contributions_raw = []
    if not isinstance(ownership_raw, list):
        _add_issue(issues, "OWNERSHIP_FAMILY_MISSING", "ownership_rows")
        ownership_raw = []
    entries_raw = _bounded_rows(entries_raw, MAX_ENTRIES, "ENTRY_ROW_LIMIT_EXCEEDED", "entries", issues)
    contributions_raw = _bounded_rows(
        contributions_raw, MAX_CONTRIBUTION_ROWS, "CONTRIBUTION_ROW_LIMIT_EXCEEDED", "source_contribution_rows", issues
    )
    ownership_raw = _bounded_rows(
        ownership_raw, MAX_OWNERSHIP_ROWS, "OWNERSHIP_ROW_LIMIT_EXCEEDED", "ownership_rows", issues
    )

    entries: list[dict[str, Any]] = []
    entry_by_key: dict[str, dict[str, Any]] = {}
    leaf_by_key: dict[str, dict[str, Any]] = {}
    repo_counts: dict[str, int] = {}
    for index, raw in enumerate(entries_raw):
        if not isinstance(raw, dict):
            _add_issue(issues, "ENTRY_INVALID", f"entry-{index}")
            continue
        key = raw.get("key")
        if not _safe_key(key):
            _add_issue(issues, "ENTRY_KEY_INVALID", f"entry-{index}")
            continue
        if key in entry_by_key:
            _add_issue(issues, "ENTRY_KEY_DUPLICATE", key)
            continue
        entry_by_key[key] = raw
        entries.append(raw)
        record_type = raw.get("record_type")
        if not isinstance(record_type, str):
            _add_issue(issues, "ENTRY_RECORD_TYPE_REQUIRED", key)
            record_type = ""
        elif record_type in LEAF_KINDS:
            leaf_by_key[key] = raw
        elif record_type in NON_LEAF_KINDS:
            pass
        else:
            _add_issue(issues, "ENTRY_RECORD_TYPE_UNSUPPORTED", key)
        required_for_v1 = raw.get("required_for_v1")
        if not isinstance(required_for_v1, bool):
            _add_issue(issues, "REQUIRED_LEAF_FLAG_MISSING", key)
        elif required_for_v1 and record_type not in LEAF_KINDS:
            _add_issue(issues, "NON_LEAF_MARKED_REQUIRED", key)
        if record_type in LEAF_KINDS and required_for_v1 is True:
            owner = raw.get("owner_role")
            if not isinstance(owner, str) or not owner.strip():
                _add_issue(issues, "ENTRY_OWNER_ROLE_MISSING", key)
            elif len(owner) > MAX_BLOCKER_TEXT:
                _add_issue(issues, "ENTRY_OWNER_ROLE_TOO_LONG", key)
            priority = raw.get("priority")
            if not isinstance(priority, str) or not priority.strip() or len(priority) > 32:
                _add_issue(issues, "ENTRY_PRIORITY_INVALID", key)
            issue_title = raw.get("issue_title")
            body_digest = raw.get("body_sha256")
            if raw.get("issue_url") is not None and (
                not isinstance(issue_title, str) or not issue_title.strip() or len(issue_title) > MAX_BLOCKER_TEXT
            ):
                _add_issue(issues, "ENTRY_ISSUE_TITLE_INVALID", key)
            if raw.get("issue_url") is not None and (
                not isinstance(body_digest, str) or HASH_RE.fullmatch(body_digest) is None
            ):
                _add_issue(issues, "ENTRY_BODY_DIGEST_INVALID", key)
            tests_raw = raw.get("required_tests", raw.get("tests", []))
            if not isinstance(tests_raw, list):
                _add_issue(issues, "ENTRY_REQUIRED_TESTS_INVALID", key)
            else:
                tests_raw = _bounded_rows(tests_raw, MAX_ENTRIES, "ENTRY_REQUIRED_TEST_LIMIT_EXCEEDED", key, issues)
                test_ids: list[str] = []
                for test in tests_raw:
                    candidate = test if isinstance(test, str) else test.get("id", test.get("command")) if isinstance(test, dict) else None
                    if not isinstance(candidate, str) or not _safe_key(candidate):
                        _add_issue(issues, "ENTRY_REQUIRED_TESTS_INVALID", key)
                    else:
                        test_ids.append(candidate)
                if len(test_ids) != len(set(test_ids)):
                    _add_issue(issues, "ENTRY_REQUIRED_TESTS_DUPLICATE", key)
                required_mode = raw.get("required_mode")
                if required_mode is not None and (not isinstance(required_mode, str) or required_mode not in MODES):
                    _add_issue(issues, "ENTRY_REQUIRED_MODE_INVALID", key)
            required_evidence = raw.get("required_evidence")
            if not isinstance(required_evidence, list) or any(not _safe_key(value) for value in required_evidence):
                _add_issue(issues, "ENTRY_REQUIRED_EVIDENCE_INVALID", key)
            elif len(required_evidence) != len(set(required_evidence)):
                _add_issue(issues, "ENTRY_REQUIRED_EVIDENCE_DUPLICATE", key)
            required_receipts = raw.get("required_owner_receipts", [])
            if not isinstance(required_receipts, list) or any(not _safe_key(value) for value in required_receipts):
                _add_issue(issues, "ENTRY_REQUIRED_RECEIPTS_INVALID", key)
            elif len(required_receipts) != len(set(required_receipts)):
                _add_issue(issues, "ENTRY_REQUIRED_RECEIPTS_DUPLICATE", key)
            for field in ("required_model_revision", "required_policy_revision"):
                if field in raw and not _safe_key(raw.get(field)):
                    _add_issue(issues, "ENTRY_REQUIRED_CONFIGURATION_PIN_INVALID", key)
            required_release_stage = raw.get("required_release_stage")
            if "required_release_stage" in raw and (
                not isinstance(required_release_stage, str) or required_release_stage not in STAGES
            ):
                _add_issue(issues, "ENTRY_REQUIRED_RELEASE_STAGE_INVALID", key)
        repo = raw.get("repository")
        if not isinstance(repo, str) or REPOSITORY_RE.fullmatch(repo) is None:
            _add_issue(issues, "ENTRY_REPOSITORY_INVALID", key)
        else:
            repo_counts[repo] = repo_counts.get(repo, 0) + int(raw.get("required_for_v1") is True)
        req_ids = raw.get("requirement_ids")
        if not isinstance(req_ids, list):
            _add_issue(issues, "ENTRY_REQUIREMENT_IDS_INVALID", key)
        else:
            req_ids = _bounded_rows(req_ids, MAX_ENTRIES, "ENTRY_REQUIREMENT_ID_LIMIT_EXCEEDED", key, issues)
            if any(not _safe_key(item) for item in req_ids):
                _add_issue(issues, "ENTRY_REQUIREMENT_IDS_INVALID", key)
            elif len(req_ids) != len(set(req_ids)):
                _add_issue(issues, "ENTRY_REQUIREMENT_ID_DUPLICATE", key)
        state = raw.get("state")
        allowed_states = {"planned", "in_progress", "blocked", "closed", "complete", "verified", "deferred", "not_planned", "not-planned"}
        if not isinstance(state, str) or state not in allowed_states:
            _add_issue(issues, "ENTRY_STATE_INVALID", key)
        elif required_for_v1 is True and record_type in LEAF_KINDS and state in {"deferred", "not_planned", "not-planned"}:
            _add_issue(issues, "REQUIRED_LEAF_NOT_DELIVERED", key)
        elif required_for_v1 is True and state == "closed" and record_type in LEAF_KINDS:
            evidence = raw.get("closure_evidence")
            if not _has_exact_closure_evidence(evidence, _required_test_ids(raw)):
                _add_issue(issues, "CLOSED_LEAF_WITHOUT_EXACT_EVIDENCE", key)
        supersedes = raw.get("supersedes")
        if supersedes is not None and (not isinstance(supersedes, str) or not _safe_key(supersedes)):
            _add_issue(issues, "SUPERSESSION_RELATION_INVALID", key)
        superseded_by = raw.get("superseded_by")
        if superseded_by is not None and (not isinstance(superseded_by, str) or not _safe_key(superseded_by)):
            _add_issue(issues, "SUPERSESSION_RELATION_INVALID", key)
        blockers = raw.get("blockers", [])
        if not isinstance(blockers, list) or len(blockers) > MAX_GRAPH_ROWS:
            _add_issue(issues, "ENTRY_BLOCKERS_INVALID", key)
        else:
            for blocker in blockers:
                if not isinstance(blocker, dict):
                    _add_issue(issues, "ENTRY_BLOCKER_INVALID", key)
                elif (
                    not isinstance(blocker.get("owner"), str)
                    or not blocker.get("owner").strip()
                    or not isinstance(blocker.get("action"), str)
                    or not blocker.get("action").strip()
                    or len(blocker.get("owner", "")) > MAX_BLOCKER_TEXT
                    or len(blocker.get("action", "")) > MAX_BLOCKER_TEXT
                ):
                    _add_issue(issues, "ENTRY_BLOCKER_OWNER_ACTION_REQUIRED", key)
        if required_for_v1 is True and raw.get("issue_url") is None and not blockers:
            _add_issue(issues, "REQUIRED_NULL_URL_BLOCKER_REQUIRED", key)
    if check_urls:
        _check_issue_readbacks(entries, readbacks, readback_pin, issues)

    if require_specialists:
        for family in ("agent-harness", "event-intelligence", "creative-engine"):
            if repo_counts.get(family, 0) < 1:
                _add_issue(issues, "REQUIRED_LEAF_FAMILY_MISSING", family)

    ownership_by_id: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(ownership_raw):
        if not isinstance(raw, dict):
            _add_issue(issues, "OWNERSHIP_ROW_INVALID", f"ownership-{index}")
            continue
        ident = raw.get("requirement_id")
        if not _safe_key(ident):
            _add_issue(issues, "OWNERSHIP_ID_INVALID", f"ownership-{index}")
            continue
        if ident in ownership_by_id:
            _add_issue(issues, "OWNERSHIP_ID_DUPLICATE", ident)
            continue
        ownership_by_id[ident] = raw
        accountable = raw.get("accountable_delivery_leaf")
        if not isinstance(accountable, str) or accountable not in leaf_by_key:
            _add_issue(issues, "ACCOUNTABLE_DELIVERY_LEAF_INVALID", ident)
        elif ident not in raw_by_list(leaf_by_key[accountable].get("requirement_ids")):
            _add_issue(issues, "ACCOUNTABLE_LEAF_REQUIREMENT_MISMATCH", ident)
        acceptance_owner = raw.get("acceptance_owner_leaf")
        if not isinstance(acceptance_owner, str) or acceptance_owner not in leaf_by_key:
            _add_issue(issues, "ACCEPTANCE_OWNER_LEAF_INVALID", ident)
        contributors = raw.get("required_contributors", [])
        if not isinstance(contributors, list):
            _add_issue(issues, "OWNERSHIP_CONTRIBUTOR_INVALID", ident)
        else:
            contributors = _bounded_rows(contributors, MAX_ENTRIES, "OWNERSHIP_CONTRIBUTOR_LIMIT_EXCEEDED", ident, issues)
            if any(not isinstance(item, str) or item not in leaf_by_key for item in contributors):
                _add_issue(issues, "OWNERSHIP_CONTRIBUTOR_INVALID", ident)
            elif len(contributors) != len(set(contributors)):
                _add_issue(issues, "OWNERSHIP_CONTRIBUTOR_DUPLICATE", ident)
            elif isinstance(acceptance_owner, str) and acceptance_owner not in contributors:
                _add_issue(issues, "ACCEPTANCE_OWNER_NOT_CONTRIBUTOR", ident)
        if ident in criteria:
            if raw.get("scope") != "scoped_contribution":
                _add_issue(issues, "GLOBAL_SCOPE_OVERCLAIM", ident)
            if isinstance(raw.get("global_status"), str) and raw.get("global_status") in {"complete", "accepted", "satisfied"}:
                _add_issue(issues, "GLOBAL_SCOPE_OVERCLAIM", ident)
        elif raw.get("scope") != "local" and raw.get("scope_and_global_role") != "Scoped requirement":
            _add_issue(issues, "LOCAL_SCOPE_CLASSIFICATION_INVALID", ident)

    contribution_rows: list[dict[str, Any]] = []
    contributed_pairs: dict[str, set[str]] = {}
    seen_row_ids: set[str] = set()
    for index, raw in enumerate(contributions_raw):
        if not isinstance(raw, dict):
            _add_issue(issues, "CONTRIBUTION_ROW_INVALID", f"contribution-{index}")
            continue
        contribution_rows.append(raw)
        row_id = raw.get("row_id")
        if not _safe_key(row_id):
            _add_issue(issues, "CONTRIBUTION_ROW_ID_INVALID", f"contribution-{index}")
        elif row_id in seen_row_ids:
            _add_issue(issues, "CONTRIBUTION_ROW_ID_DUPLICATE", row_id)
        else:
            seen_row_ids.add(row_id)
        ident = raw.get("requirement_id")
        if not _safe_key(ident) or ident not in ownership_by_id:
            _add_issue(issues, "ORPHAN_CONTRIBUTION_REQUIREMENT", ident)
            continue
        leaf = raw.get("owning_leaf_key")
        if not isinstance(leaf, str) or leaf not in leaf_by_key:
            _add_issue(issues, "CONTRIBUTION_OWNER_NOT_LEAF", ident)
        else:
            leaf_declares_requirement = ident in raw_by_list(entry_by_key[leaf].get("requirement_ids"))
            if not leaf_declares_requirement:
                _add_issue(issues, "CONTRIBUTION_NOT_DECLARED_BY_LEAF", ident)
            required_contributors = ownership_by_id[ident].get("required_contributors", [])
            if not isinstance(required_contributors, list) or leaf not in required_contributors:
                _add_issue(issues, "CONTRIBUTION_OWNER_NOT_DECLARED", ident)
            elif leaf_declares_requirement:
                contributed_pairs.setdefault(ident, set()).add(leaf)
        if ident in criteria:
            acceptance = raw.get("authoritative_acceptance")
            if not isinstance(acceptance, dict):
                _add_issue(issues, "GLOBAL_ACCEPTANCE_METADATA_MISSING", ident)
            else:
                canonical_item = criteria[ident]
                for field in ("id", "title", "priority", "owner_role", "verification", "evidence_required"):
                    if acceptance.get(field) != canonical_item.get(field):
                        _add_issue(issues, "GLOBAL_ACCEPTANCE_METADATA_MISMATCH", ident)
                        break
        expected_scope = "scoped_contribution" if ident in criteria else "local"
        if raw.get("scope") != expected_scope and not (
            expected_scope == "local" and raw.get("scope_and_global_role") == "Scoped requirement"
        ):
            _add_issue(issues, "CONTRIBUTION_SCOPE_MISMATCH", row_id if _safe_key(row_id) else ident)
        ownership_scope = ownership_by_id[ident].get("scope")
        if ownership_scope != expected_scope and not (
            expected_scope == "local" and ownership_by_id[ident].get("scope_and_global_role") == "Scoped requirement"
        ):
            _add_issue(issues, "OWNERSHIP_SCOPE_MISMATCH", ident)

    contributed_ids = {
        row.get("requirement_id")
        for row in contribution_rows
        if isinstance(row.get("requirement_id"), str)
    }
    for ident in sorted(set(ownership_by_id) - contributed_ids):
        _add_issue(issues, "OWNERSHIP_WITHOUT_CONTRIBUTION", ident)
    for ident, ownership in ownership_by_id.items():
        required_contributors = ownership.get("required_contributors")
        if not isinstance(required_contributors, list) or any(
            not isinstance(contributor, str) or contributor not in leaf_by_key
            for contributor in required_contributors
        ):
            continue
        actual_contributors = contributed_pairs.get(ident, set())
        for contributor in required_contributors:
            if contributor not in actual_contributors:
                _add_relation_issue(
                    issues, "REQUIRED_CONTRIBUTOR_MISSING", ident, contributor
                )

    for entry in entries:
        supersedes = entry.get("supersedes")
        if isinstance(supersedes, str):
            prior = entry_by_key.get(supersedes)
            if prior is None or prior.get("superseded_by") != entry.get("key"):
                _add_issue(issues, "SUPERSESSION_RELATION_UNVERIFIED", entry.get("key"))
        superseded_by = entry.get("superseded_by")
        if superseded_by is not None:
            replacement = entry_by_key.get(superseded_by) if isinstance(superseded_by, str) else None
            if replacement is None or replacement.get("supersedes") != entry.get("key"):
                _add_issue(issues, "SUPERSESSION_RELATION_UNVERIFIED", entry.get("key"))

    all_entry_requirement_ids: set[str] = set()
    for entry in entries:
        req_ids = entry.get("requirement_ids")
        if isinstance(req_ids, list):
            all_entry_requirement_ids.update(item for item in req_ids if isinstance(item, str))
    for ident in sorted(all_entry_requirement_ids - set(ownership_by_id)):
        _add_issue(issues, "REQUIRED_ID_WITHOUT_OWNERSHIP", ident)

    if check_dag:
        _validate_graph(coverage.get("dag"), coverage.get("staged_edges"), entry_by_key, leaf_by_key, issues)
    staged_edges_for_ownership = coverage.get("staged_edges")
    if isinstance(staged_edges_for_ownership, list):
        for index, edge in enumerate(staged_edges_for_ownership):
            if not isinstance(edge, dict) or edge.get("required_for_v1") is not True:
                continue
            edge_id = edge.get("edge_id")
            requirement_ids = edge.get("requirement_ids")
            if not isinstance(requirement_ids, list):
                continue
            for requirement_id in requirement_ids:
                if isinstance(requirement_id, str) and requirement_id not in ownership_by_id:
                    _add_issue(issues, "STAGED_EDGE_REQUIREMENT_UNKNOWN", edge_id or f"stage-{index}")

    if coverage.get("complete") is not True or map_pin.get("complete") is not True:
        _add_issue(issues, "COVERAGE_SNAPSHOT_INCOMPLETE", "coverage-map")

    global_ids = set(criteria)
    mapped_global = set(ownership_by_id) & global_ids
    local_ids = set(ownership_by_id) - global_ids
    row_global = sum(
        1
        for row in contribution_rows
        if isinstance(row.get("requirement_id"), str) and row.get("requirement_id") in global_ids
    )
    row_local = len(contribution_rows) - row_global
    dimensions = {
        "required_leaf_records": sum(1 for item in entries if item.get("required_for_v1") is True),
        "agent_harness_leaf_records": repo_counts.get("agent-harness", 0),
        "specialist_leaf_records": sum(count for repo, count in repo_counts.items() if repo != "agent-harness"),
        "source_contribution_rows": len(contribution_rows),
        "unique_mapped_requirement_ids": len(ownership_by_id),
        "local_scoped_requirement_ids": len(local_ids),
        "global_ids_with_scoped_contributions": len(mapped_global),
        "global_criteria_total": len(criteria),
        "global_ids_outside_scoped_contribution": len(global_ids - mapped_global),
        "contribution_rows_to_global_ids": row_global,
        "contribution_rows_to_local_ids": row_local,
    }
    expected_dimensions = map_pin.get("observed_dimensions")
    if not isinstance(expected_dimensions, dict):
        _add_issue(issues, "DIMENSION_PINS_MISSING", "coverage-map")
    else:
        for name, actual in dimensions.items():
            expected = expected_dimensions.get(name)
            if not isinstance(expected, int) or isinstance(expected, bool) or expected != actual:
                _add_issue(issues, "DIMENSION_PIN_MISMATCH", name)
    if len(criteria) == 0:
        _add_issue(issues, "CANONICAL_CRITERIA_EMPTY", "canonical-checklist")
    return issues, dimensions, leaf_by_key


def raw_by_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _has_exact_closure_evidence(value: Any, required_tests: list[str]) -> bool:
    if not isinstance(value, list) or not value:
        return False
    return any(
        isinstance(item, dict)
        and isinstance(item.get("commit", item.get("revision")), str)
        and re.fullmatch(r"[0-9a-f]{40}", item.get("commit", item.get("revision"))) is not None
        and isinstance(item.get("tests"), list)
        and bool(item.get("tests"))
        and all(_safe_key(test_id) for test_id in item.get("tests", []))
        and bool(required_tests)
        and set(item.get("tests", [])) == set(required_tests)
        for item in value
    )


def _validate_graph(
    dag: Any,
    staged_edges: Any,
    entry_by_key: dict[str, dict[str, Any]],
    leaf_by_key: dict[str, dict[str, Any]],
    issues: list[dict[str, str]],
) -> None:
    if not isinstance(dag, dict) or not isinstance(dag.get("edges"), dict):
        _add_issue(issues, "EXECUTION_DAG_MISSING", "dag")
        return
    edges: dict[str, set[str]] = {}
    all_nodes = set(entry_by_key)
    edge_items = list(dag["edges"].items())
    if len(edge_items) > MAX_GRAPH_ROWS:
        _add_issue(issues, "EXECUTION_EDGE_ROW_LIMIT_EXCEEDED", "dag")
        edge_items = edge_items[:MAX_GRAPH_ROWS]
    for consumer, prerequisites in edge_items:
        if not isinstance(consumer, str) or consumer not in leaf_by_key:
            _add_issue(issues, "EXECUTION_EDGE_CONSUMER_NOT_LEAF", consumer)
            continue
        if not isinstance(prerequisites, list):
            _add_issue(issues, "EXECUTION_EDGE_LIST_INVALID", consumer)
            continue
        normalized: set[str] = set()
        prerequisites = _bounded_rows(prerequisites, MAX_ENTRIES, "EXECUTION_PREREQUISITE_LIMIT_EXCEEDED", consumer, issues)
        for prerequisite in prerequisites:
            if not isinstance(prerequisite, str) or prerequisite not in all_nodes:
                _add_issue(issues, "EXECUTION_EDGE_UNKNOWN_NODE", consumer)
                continue
            if prerequisite == consumer:
                _add_issue(issues, "EXECUTION_EDGE_SELF", consumer)
            if prerequisite not in leaf_by_key:
                _add_issue(issues, "EXECUTION_EDGE_PREREQUISITE_NOT_LEAF", consumer)
            if prerequisite in normalized:
                _add_issue(issues, "EXECUTION_EDGE_DUPLICATE", consumer)
            normalized.add(prerequisite)
        edges[consumer] = normalized
    for node in leaf_by_key:
        edges.setdefault(node, set())
    _check_cycle(edges, issues)
    fan_in = dag.get("required_gate_fan_in", {})
    if not isinstance(fan_in, dict):
        _add_issue(issues, "GATE_FAN_IN_INVALID", "dag")
    else:
        observed_fan_in = dag.get("gate_fan_in", {})
        if not isinstance(observed_fan_in, dict):
            _add_issue(issues, "GATE_FAN_IN_INVALID", "dag")
            observed_fan_in = {}
        if len(fan_in) > MAX_GRAPH_ROWS or len(observed_fan_in) > MAX_GRAPH_ROWS:
            _add_issue(issues, "GATE_FAN_IN_ROW_LIMIT_EXCEEDED", "dag")
        if set(observed_fan_in) != set(fan_in):
            _add_issue(issues, "GATE_FAN_IN_MISMATCH", "dag")
        for gate, expected in list(fan_in.items())[:MAX_GRAPH_ROWS]:
            if not isinstance(gate, str) or not isinstance(expected, list):
                _add_issue(issues, "GATE_FAN_IN_INVALID", gate)
                continue
            expected = _bounded_rows(expected, MAX_ENTRIES, "GATE_FAN_IN_LIMIT_EXCEEDED", gate, issues)
            gate_record = entry_by_key.get(gate)
            observed = observed_fan_in.get(gate)
            if isinstance(observed, list):
                observed = _bounded_rows(observed, MAX_ENTRIES, "GATE_FAN_IN_LIMIT_EXCEEDED", gate, issues)
            expected_set = set(item for item in expected if isinstance(item, str))
            observed_set = set(item for item in observed if isinstance(item, str)) if isinstance(observed, list) else None
            if (
                gate_record is None
                or gate_record.get("record_type") not in NON_LEAF_KINDS
                or observed_set is None
                or len(expected_set) != len(expected)
                or len(observed_set) != len(observed)
                or observed_set != expected_set
                or any(item not in leaf_by_key for item in expected_set)
            ):
                _add_issue(issues, "GATE_FAN_IN_MISMATCH", gate)
    if not isinstance(staged_edges, list):
        _add_issue(issues, "STAGED_EDGE_FAMILY_MISSING", "staged_edges")
        return
    staged_edges = _bounded_rows(staged_edges, MAX_GRAPH_ROWS, "STAGED_EDGE_ROW_LIMIT_EXCEEDED", "staged_edges", issues)
    seen_stage_edge_ids: set[str] = set()
    for index, edge in enumerate(staged_edges):
        record = f"stage-{index}"
        if not isinstance(edge, dict):
            _add_issue(issues, "STAGED_EDGE_INVALID", record)
            continue
        edge_id = edge.get("edge_id")
        if not _safe_key(edge_id):
            _add_issue(issues, "STAGED_EDGE_ID_INVALID", record)
        elif edge_id in seen_stage_edge_ids:
            _add_issue(issues, "STAGED_EDGE_ID_DUPLICATE", edge_id)
        else:
            seen_stage_edge_ids.add(edge_id)
        consumer = edge.get("consumer_key")
        prerequisite = edge.get("prerequisite_key")
        if (
            not isinstance(consumer, str)
            or not isinstance(prerequisite, str)
            or consumer not in all_nodes
            or prerequisite not in all_nodes
        ):
            _add_issue(issues, "STAGED_EDGE_UNKNOWN_NODE", record)
        for field in ("consumer_stage", "prerequisite_stage"):
            if not isinstance(edge.get(field), str) or edge.get(field) not in STAGES:
                _add_issue(issues, "STAGED_EDGE_FIELD_INVALID", record)
        if not isinstance(edge.get("status"), str) or edge.get("status") not in STAGED_EDGE_STATES:
            _add_issue(issues, "STAGED_EDGE_STATUS_INVALID", record)
        required_for_v1 = edge.get("required_for_v1")
        if not isinstance(required_for_v1, bool):
            _add_issue(issues, "STAGED_EDGE_REQUIRED_FLAG_INVALID", record)
        requirement_ids = edge.get("requirement_ids")
        if (
            not isinstance(requirement_ids, list)
            or any(not _safe_key(value) for value in requirement_ids)
        ):
            _add_issue(issues, "STAGED_EDGE_REQUIREMENT_IDS_INVALID", record)
        elif len(requirement_ids) != len(set(requirement_ids)):
            _add_issue(issues, "STAGED_EDGE_REQUIREMENT_IDS_DUPLICATE", record)
        elif required_for_v1 is True:
            if not requirement_ids:
                _add_issue(issues, "STAGED_EDGE_REQUIREMENT_IDS_REQUIRED", record)
            safe_edge_id = edge_id if _safe_key(edge_id) else record
            for endpoint_role, endpoint in (("consumer", consumer), ("prerequisite", prerequisite)):
                endpoint_leaf = leaf_by_key.get(endpoint) if isinstance(endpoint, str) else None
                endpoint_requirement_ids = endpoint_leaf.get("requirement_ids") if endpoint_leaf is not None else None
                for requirement_id in requirement_ids:
                    if (
                        endpoint_leaf is None
                        or not isinstance(endpoint_requirement_ids, list)
                        or requirement_id not in endpoint_requirement_ids
                    ):
                        code = (
                            "STAGED_EDGE_CONSUMER_REQUIREMENT_NOT_DECLARED"
                            if endpoint_role == "consumer"
                            else "STAGED_EDGE_PREREQUISITE_REQUIREMENT_NOT_DECLARED"
                        )
                        _add_relation_issue(issues, code, safe_edge_id, requirement_id)
        required_evidence = edge.get("required_evidence_ids", [])
        if (
            not isinstance(required_evidence, list)
            or any(not _safe_key(value) for value in required_evidence)
        ):
            _add_issue(issues, "STAGED_EDGE_EVIDENCE_IDS_INVALID", record)
        elif len(required_evidence) != len(set(required_evidence)):
            _add_issue(issues, "STAGED_EDGE_EVIDENCE_IDS_DUPLICATE", record)
        elif edge.get("status") == "satisfied" and not required_evidence:
            _add_issue(issues, "STAGED_EDGE_EVIDENCE_REQUIRED", record)
        required_receipts = edge.get("required_owner_receipt_ids", [])
        if (
            not isinstance(required_receipts, list)
            or any(not _safe_key(value) for value in required_receipts)
        ):
            _add_issue(issues, "STAGED_EDGE_RECEIPT_IDS_INVALID", record)
        elif len(required_receipts) != len(set(required_receipts)):
            _add_issue(issues, "STAGED_EDGE_RECEIPT_IDS_DUPLICATE", record)
        if edge.get("edge_type") != "evidence_stage":
            _add_issue(issues, "STAGED_EDGE_TYPE_INVALID", record)


def _check_cycle(edges: dict[str, set[str]], issues: list[dict[str, str]]) -> None:
    # Edges point from a consumer to its prerequisites. Kahn's algorithm is
    # iterative and uses the reverse graph so input size does not affect recursion.
    dependents: dict[str, set[str]] = {node: set() for node in edges}
    remaining: dict[str, int] = {}
    for consumer, prerequisites in edges.items():
        remaining[consumer] = len(prerequisites)
        for prerequisite in prerequisites:
            dependents.setdefault(prerequisite, set()).add(consumer)
    ready = deque(sorted(node for node, degree in remaining.items() if degree == 0))
    visited = 0
    while ready:
        node = ready.popleft()
        visited += 1
        for dependent in dependents.get(node, ()):
            remaining[dependent] -= 1
            if remaining[dependent] == 0:
                ready.append(dependent)
    if visited != len(remaining):
        cycle_nodes = sorted(node for node, degree in remaining.items() if degree > 0)
        _add_issue(issues, "EXECUTION_DAG_CYCLE", cycle_nodes[0] if cycle_nodes else "dag")


def _validate_release(
    release_path: str | Path,
    leaves: dict[str, dict[str, Any]],
    dag: Any,
    required_gate_fan_in: Any,
    staged_edges: Any,
    issues: list[dict[str, str]],
) -> dict[str, Any]:
    manifest, manifest_raw = _read_json(release_path, "release-manifest")
    if manifest.get("format") != "acv1.release-manifest/v1":
        _add_issue(issues, "RELEASE_FORMAT_UNSUPPORTED", "release-manifest")
    revisions_raw = manifest.get("tested_revisions")
    evidence_raw = manifest.get("evidence")
    outcomes_raw = manifest.get("outcomes")
    receipts_raw = manifest.get("owner_receipts", [])
    if not isinstance(revisions_raw, list) or not isinstance(evidence_raw, list) or not isinstance(outcomes_raw, list):
        _add_issue(issues, "RELEASE_REQUIRED_FAMILY_MISSING", "release-manifest")
        return {
            "tested_revisions": 0,
            "evidence_files": 0,
            "evidence_bytes_read": 0,
            "verified_evidence_bytes": 0,
            "outcomes": 0,
            "manifest_sha256": _sha256(manifest_raw),
        }
    if not isinstance(receipts_raw, list):
        _add_issue(issues, "RELEASE_RECEIPTS_INVALID", "release-manifest")
        receipts_raw = []
    revisions_raw = _bounded_rows(revisions_raw, MAX_RELEASE_RECORDS, "RELEASE_ROW_LIMIT_EXCEEDED", "tested_revisions", issues)
    evidence_raw = _bounded_rows(evidence_raw, MAX_RELEASE_RECORDS, "RELEASE_ROW_LIMIT_EXCEEDED", "evidence", issues)
    outcomes_raw = _bounded_rows(outcomes_raw, MAX_ENTRIES, "RELEASE_ROW_LIMIT_EXCEEDED", "outcomes", issues)
    receipts_raw = _bounded_rows(receipts_raw, MAX_RELEASE_RECORDS, "RELEASE_ROW_LIMIT_EXCEEDED", "owner_receipts", issues)
    tested: set[tuple[str, str]] = set()
    for index, item in enumerate(revisions_raw):
        if not isinstance(item, dict):
            _add_issue(issues, "TESTED_REVISION_INVALID", f"revision-{index}")
            continue
        repo, revision = item.get("repository"), item.get("revision")
        if (
            not isinstance(repo, str)
            or REPOSITORY_RE.fullmatch(repo) is None
            or not isinstance(revision, str)
            or re.fullmatch(r"[0-9a-f]{40}", revision) is None
        ):
            _add_issue(issues, "TESTED_REVISION_INVALID", f"revision-{index}")
            continue
        pair = (repo, revision)
        if pair in tested:
            _add_issue(issues, "TESTED_REVISION_DUPLICATE", repo)
        tested.add(pair)

    evidence_by_id: dict[str, dict[str, Any]] = {}
    evidence_bytes_read = 0
    verified_evidence_bytes = 0
    for index, item in enumerate(evidence_raw):
        record = f"evidence-{index}"
        if not isinstance(item, dict):
            _add_issue(issues, "EVIDENCE_RECORD_INVALID", record)
            continue
        ident = item.get("id")
        if not _safe_key(ident):
            _add_issue(issues, "EVIDENCE_ID_INVALID", record)
            continue
        if ident in evidence_by_id:
            _add_issue(issues, "EVIDENCE_ID_DUPLICATE", ident)
            continue
        evidence_by_id[ident] = item
        if not isinstance(item.get("mode"), str) or item.get("mode") not in MODES:
            _add_issue(issues, "EVIDENCE_MODE_INVALID", ident)
        for field in ("producer", "source_revision", "kind"):
            if not isinstance(item.get(field), str) or not item.get(field).strip() or len(item.get(field)) > MAX_BLOCKER_TEXT:
                _add_issue(issues, "EVIDENCE_METADATA_MISSING", ident)
        if isinstance(item.get("kind"), str) and item.get("kind") not in EVIDENCE_KINDS:
            _add_issue(issues, "EVIDENCE_KIND_UNSUPPORTED", ident)
        if not isinstance(item.get("source_revision"), str) or re.fullmatch(r"[0-9a-f]{40}", item.get("source_revision", "")) is None:
            _add_issue(issues, "EVIDENCE_REVISION_INVALID", ident)
        try:
            _iso_utc(item.get("captured_at"), "EVIDENCE_TIME_INVALID", ident)
        except InputError as exc:
            _add_issue(issues, exc.code, exc.record)
        expected_hash = item.get("sha256")
        if not isinstance(expected_hash, str) or HASH_RE.fullmatch(expected_hash) is None:
            _add_issue(issues, "EVIDENCE_DIGEST_INVALID", ident)
            continue
        if evidence_bytes_read > LIMITS["evidence-total"]:
            _add_issue(issues, "EVIDENCE_TOTAL_SIZE", ident)
            continue
        artifact_path = _relative_artifact(item.get("path"), ident)
        try:
            flags = os.O_RDONLY
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            if hasattr(os, "O_NONBLOCK"):
                flags |= os.O_NONBLOCK
            fd = os.open(os.fspath(artifact_path), flags)
        except OSError:
            _add_issue(issues, "EVIDENCE_UNREADABLE", ident)
            continue
        digest = hashlib.sha256()
        size = 0
        readable = True
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > LIMITS["evidence-file"]:
                _add_issue(issues, "EVIDENCE_TYPE_OR_SIZE", ident)
                readable = False
            elif evidence_bytes_read + info.st_size > LIMITS["evidence-total"]:
                _add_issue(issues, "EVIDENCE_TOTAL_SIZE", ident)
                readable = False
            while readable:
                remaining_file = LIMITS["evidence-file"] - size
                remaining_total = LIMITS["evidence-total"] - evidence_bytes_read
                read_size = min(64 * 1024, max(1, remaining_file + 1), max(1, remaining_total + 1))
                chunk = os.read(fd, read_size)
                if not chunk:
                    break
                size += len(chunk)
                evidence_bytes_read += len(chunk)
                if size > LIMITS["evidence-file"]:
                    _add_issue(issues, "EVIDENCE_TYPE_OR_SIZE", ident)
                    readable = False
                    break
                if evidence_bytes_read > LIMITS["evidence-total"]:
                    _add_issue(issues, "EVIDENCE_TOTAL_SIZE", ident)
                    readable = False
                    break
                digest.update(chunk)
            if readable and (size != info.st_size or digest.hexdigest() != expected_hash):
                _add_issue(issues, "EVIDENCE_DIGEST_MISMATCH", ident)
                readable = False
        except OSError:
            _add_issue(issues, "EVIDENCE_READ_FAILED", ident)
            readable = False
        finally:
            try:
                os.close(fd)
            except OSError:
                _add_issue(issues, "EVIDENCE_CLOSE_FAILED", ident)
                readable = False
        if readable:
            verified_evidence_bytes += size

    receipt_by_id: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(receipts_raw):
        if not isinstance(item, dict) or not _safe_key(item.get("id")):
            _add_issue(issues, "OWNER_RECEIPT_INVALID", f"receipt-{index}")
            continue
        if item["id"] in receipt_by_id:
            _add_issue(issues, "OWNER_RECEIPT_DUPLICATE", item["id"])
            continue
        receipt_by_id[item["id"]] = item

    outcomes: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(outcomes_raw):
        record = f"outcome-{index}"
        if not isinstance(item, dict):
            _add_issue(issues, "OUTCOME_INVALID", record)
            continue
        leaf = item.get("leaf_key")
        if not _safe_key(leaf) or leaf not in leaves:
            _add_issue(issues, "OUTCOME_UNKNOWN_LEAF", leaf)
            continue
        if leaf in outcomes:
            _add_issue(issues, "OUTCOME_DUPLICATE", leaf)
            continue
        outcomes[leaf] = item
        if item.get("status") != "verified":
            _add_issue(issues, "REQUIRED_OUTCOME_NOT_VERIFIED", leaf)
        required_stage = leaves[leaf].get("required_release_stage")
        evaluated_stage = item.get("evaluated_stage")
        if not isinstance(required_stage, str) or required_stage not in STAGES:
            _add_issue(issues, "REQUIRED_RELEASE_STAGE_MISSING", leaf)
        if not isinstance(evaluated_stage, str) or evaluated_stage not in STAGES:
            _add_issue(issues, "OUTCOME_EVALUATED_STAGE_INVALID", leaf)
        elif isinstance(required_stage, str) and required_stage in STAGES and evaluated_stage != required_stage:
            _add_issue(issues, "OUTCOME_EVALUATED_STAGE_MISMATCH", leaf)
        revision = item.get("revision")
        repo = leaves[leaf].get("repository")
        if not isinstance(revision, str) or re.fullmatch(r"[0-9a-f]{40}", revision) is None or (repo, revision) not in tested:
            _add_issue(issues, "OUTCOME_REVISION_UNTESTED", leaf)
        if item.get("prerequisites_satisfied") is not True:
            _add_issue(issues, "OUTCOME_PREREQUISITE_UNSATISFIED", leaf)
        required_tests = _required_test_ids(leaves[leaf])
        required_evidence = leaves[leaf].get("required_evidence", [])
        if not isinstance(required_evidence, list) or any(not isinstance(value, str) for value in required_evidence):
            _add_issue(issues, "REQUIRED_EVIDENCE_LIST_INVALID", leaf)
            required_evidence = []
        provided_tests = item.get("required_test_ids")
        evidence_ids = item.get("evidence_ids")
        if not isinstance(provided_tests, list) or not set(required_tests).issubset(set(x for x in provided_tests if isinstance(x, str))):
            _add_issue(issues, "REQUIRED_TEST_MISSING", leaf)
        elif len([value for value in provided_tests if isinstance(value, str)]) != len(set(value for value in provided_tests if isinstance(value, str))):
            _add_issue(issues, "OUTCOME_TEST_ID_DUPLICATE", leaf)
        if not isinstance(evidence_ids, list) or not evidence_ids:
            _add_issue(issues, "REQUIRED_EVIDENCE_MISSING", leaf)
            evidence_ids = []
        if len([value for value in evidence_ids if isinstance(value, str)]) != len(set(value for value in evidence_ids if isinstance(value, str))):
            _add_issue(issues, "OUTCOME_EVIDENCE_ID_DUPLICATE", leaf)
        if not set(required_evidence).issubset(set(value for value in evidence_ids if isinstance(value, str))):
            _add_issue(issues, "REQUIRED_EVIDENCE_MISSING", leaf)
        required_mode = item.get("required_mode")
        if not isinstance(required_mode, str) or required_mode not in MODES:
            _add_issue(issues, "REQUIRED_MODE_REQUIRED_OR_INVALID", leaf)
        entry_mode = leaves[leaf].get("required_mode")
        if entry_mode is not None and required_mode != entry_mode:
            _add_issue(issues, "REQUIRED_MODE_MISMATCH", leaf)
        required_configuration: dict[str, Any] = {}
        for pin_field in ("model_revision", "policy_revision"):
            expected_pin = leaves[leaf].get("required_" + pin_field)
            if expected_pin is not None:
                required_configuration[pin_field] = expected_pin
                if item.get("required_" + pin_field) != expected_pin:
                    _add_issue(issues, "REQUIRED_CONFIGURATION_PIN_MISMATCH", leaf)
            elif "required_" + pin_field in item:
                _add_issue(issues, "OUTCOME_CONFIGURATION_PIN_UNDECLARED", leaf)
        leaf_state = leaves[leaf].get("state")
        if leaves[leaf].get("blockers") or (
            isinstance(leaf_state, str) and leaf_state in {"blocked", "deferred", "not_planned", "not-planned"}
        ):
            _add_issue(issues, "REQUIRED_OUTCOME_BLOCKED", leaf)
        passed_tests: set[str] = set()
        if isinstance(evidence_ids, list):
            for evidence_id in evidence_ids:
                evidence = evidence_by_id.get(evidence_id) if isinstance(evidence_id, str) else None
                if evidence is None:
                    _add_issue(issues, "OUTCOME_EVIDENCE_UNKNOWN", leaf)
                    continue
                if evidence.get("source_revision") != revision:
                    _add_issue(issues, "EVIDENCE_REVISION_MISMATCH", leaf)
                if evidence.get("mode") != required_mode:
                    _add_issue(issues, "EVIDENCE_MODE_MISMATCH", leaf)
                if evidence.get("kind") == "test":
                    test_id = evidence.get("test_id")
                    if test_id in required_tests and evidence.get("result") != "passed":
                        _add_issue(issues, "REQUIRED_TEST_NOT_PASSED", leaf)
                    elif test_id in required_tests:
                        passed_tests.add(test_id)
                if isinstance(evidence.get("kind"), str) and evidence.get("kind") in {"test", "runtime", "configuration"}:
                    for pin_field, required_pin in required_configuration.items():
                        if required_pin is not None and evidence.get(pin_field) != required_pin:
                            _add_issue(issues, "EVIDENCE_CONFIGURATION_PIN_MISMATCH", leaf)
        for test_id in required_tests:
            if test_id not in passed_tests:
                _add_issue(issues, "REQUIRED_TEST_EVIDENCE_MISSING", leaf)
        required_receipts = item.get("required_owner_receipts", [])
        provided_receipts = item.get("owner_receipt_ids", [])
        if not isinstance(required_receipts, list) or not isinstance(provided_receipts, list):
            _add_issue(issues, "OUTCOME_RECEIPT_LIST_INVALID", leaf)
            required_receipts, provided_receipts = [], []
        leaf_required_receipts = leaves[leaf].get("required_owner_receipts", [])
        leaf_required_set = (
            set(value for value in leaf_required_receipts if isinstance(value, str))
            if isinstance(leaf_required_receipts, list)
            else set()
        )
        if isinstance(staged_edges, list):
            for edge in staged_edges:
                if (
                    not isinstance(edge, dict)
                    or edge.get("required_for_v1") is not True
                    or edge.get("prerequisite_key") != leaf
                ):
                    continue
                consumer_key = edge.get("consumer_key")
                consumer_leaf = leaves.get(consumer_key) if isinstance(consumer_key, str) else None
                if (
                    consumer_leaf is not None
                    and edge.get("consumer_stage") == consumer_leaf.get("required_release_stage")
                ):
                    edge_receipts = edge.get("required_owner_receipt_ids")
                    if isinstance(edge_receipts, list):
                        leaf_required_set.update(value for value in edge_receipts if isinstance(value, str))
        if set(value for value in required_receipts if isinstance(value, str)) != leaf_required_set:
            _add_issue(issues, "REQUIRED_OWNER_RECEIPTS_MISMATCH", leaf)
        provided_receipt_set = set(value for value in provided_receipts if isinstance(value, str))
        if provided_receipt_set != set(value for value in required_receipts if isinstance(value, str)):
            _add_issue(issues, "OWNER_RECEIPT_IDS_MISMATCH", leaf)
        for receipt_id in required_receipts:
            receipt = receipt_by_id.get(receipt_id) if isinstance(receipt_id, str) else None
            receipt_evidence_id = receipt.get("evidence_id") if receipt is not None else None
            receipt_evidence = evidence_by_id.get(receipt_evidence_id) if isinstance(receipt_evidence_id, str) else None
            if (
                receipt is None
                or receipt_id not in provided_receipts
                or receipt.get("status") != "accepted"
                or receipt.get("source_revision") != revision
                or receipt_evidence is None
                or receipt_evidence_id not in evidence_ids
                or receipt_evidence.get("source_revision") != revision
                or receipt_evidence.get("kind") != "receipt"
                or not isinstance(receipt.get("owner_role"), str)
                or not isinstance(receipt.get("action"), str)
                or not receipt.get("owner_role").strip()
                or not receipt.get("action").strip()
            ):
                _add_issue(issues, "REQUIRED_OWNER_RECEIPT_MISSING", leaf)

    if isinstance(staged_edges, list):
        for edge_index, edge in enumerate(staged_edges):
            if not isinstance(edge, dict):
                continue
            consumer = edge.get("consumer_key")
            if edge.get("required_for_v1") is not True:
                continue
            outcome = outcomes.get(consumer) if isinstance(consumer, str) else None
            consumer_leaf = leaves.get(consumer) if isinstance(consumer, str) else None
            if outcome is None or consumer_leaf is None:
                continue
            required_stage = consumer_leaf.get("required_release_stage")
            if edge.get("consumer_stage") != required_stage:
                continue
            edge_id = edge.get("edge_id")
            if edge.get("status") != "satisfied":
                _add_issue(issues, "STAGED_EDGE_PREREQUISITE_PENDING", edge_id or f"stage-{edge_index}")
                continue
            prerequisite = edge.get("prerequisite_key")
            prerequisite_outcome = outcomes.get(prerequisite) if isinstance(prerequisite, str) else None
            evidence_ids = edge.get("required_evidence_ids")
            if not isinstance(evidence_ids, list) or not evidence_ids:
                _add_issue(issues, "STAGED_EDGE_EVIDENCE_REQUIRED", edge_id or f"stage-{edge_index}")
                continue
            if prerequisite_outcome is None:
                _add_issue(issues, "STAGED_EDGE_PREREQUISITE_OUTCOME_MISSING", edge_id or f"stage-{edge_index}")
                continue
            prerequisite_outcome_ids = prerequisite_outcome.get("evidence_ids")
            if not isinstance(prerequisite_outcome_ids, list):
                prerequisite_outcome_ids = []
            expected_revision = prerequisite_outcome.get("revision")
            expected_mode = prerequisite_outcome.get("required_mode")
            edge_requirement_ids = edge.get("requirement_ids")
            for evidence_id in evidence_ids:
                evidence = evidence_by_id.get(evidence_id) if isinstance(evidence_id, str) else None
                evidence_requirement_ids = evidence.get("requirement_ids") if evidence is not None else None
                if (
                    not isinstance(evidence_id, str)
                    or evidence_id not in prerequisite_outcome_ids
                    or evidence is None
                    or evidence.get("stage_edge_id") != edge_id
                    or evidence.get("leaf_key") != prerequisite
                    or evidence.get("stage") != edge.get("prerequisite_stage")
                    or not isinstance(edge_requirement_ids, list)
                    or any(not isinstance(value, str) for value in edge_requirement_ids)
                    or not isinstance(evidence_requirement_ids, list)
                    or any(not isinstance(value, str) for value in evidence_requirement_ids)
                    or set(evidence_requirement_ids) != set(edge_requirement_ids)
                    or evidence.get("source_revision") != expected_revision
                    or evidence.get("mode") != expected_mode
                ):
                    _add_issue(issues, "STAGED_EDGE_EVIDENCE_MISMATCH", edge_id or f"stage-{edge_index}")
            required_receipts = edge.get("required_owner_receipt_ids", [])
            if isinstance(required_receipts, list) and required_receipts:
                outcome_receipt_ids = prerequisite_outcome.get("owner_receipt_ids")
                if not isinstance(outcome_receipt_ids, list):
                    outcome_receipt_ids = []
                for receipt_id in required_receipts:
                    receipt = receipt_by_id.get(receipt_id) if isinstance(receipt_id, str) else None
                    receipt_evidence_id = receipt.get("evidence_id") if receipt is not None else None
                    receipt_evidence = evidence_by_id.get(receipt_evidence_id) if isinstance(receipt_evidence_id, str) else None
                    if (
                        receipt is None
                        or receipt_id not in outcome_receipt_ids
                        or receipt.get("status") != "accepted"
                        or receipt.get("source_revision") != expected_revision
                        or receipt_evidence is None
                        or receipt_evidence_id not in prerequisite_outcome_ids
                        or receipt_evidence.get("source_revision") != expected_revision
                        or receipt_evidence.get("kind") != "receipt"
                    ):
                        _add_issue(issues, "STAGED_EDGE_OWNER_RECEIPT_MISSING", edge_id or f"stage-{edge_index}")

    for leaf, entry in leaves.items():
        if entry.get("required_for_v1") is True and leaf not in outcomes:
            _add_issue(issues, "REQUIRED_OUTCOME_MISSING", leaf)
    required_outcome_keys = {
        leaf for leaf, entry in leaves.items() if entry.get("required_for_v1") is True
    }
    if isinstance(required_gate_fan_in, dict):
        for expected in required_gate_fan_in.values():
            if isinstance(expected, list):
                required_outcome_keys.update(key for key in expected if isinstance(key, str) and key in leaves)
    edges = dag.get("edges") if isinstance(dag, dict) and isinstance(dag.get("edges"), dict) else {}
    pending = list(required_outcome_keys)
    while pending:
        consumer = pending.pop()
        prerequisites = edges.get(consumer, [])
        if not isinstance(prerequisites, list):
            continue
        for prerequisite in prerequisites:
            if isinstance(prerequisite, str) and prerequisite in leaves and prerequisite not in required_outcome_keys:
                required_outcome_keys.add(prerequisite)
                pending.append(prerequisite)
    for leaf in sorted(required_outcome_keys):
        if leaf not in outcomes:
            _add_issue(issues, "REQUIRED_PREREQUISITE_OUTCOME_MISSING", leaf)
    return {
        "tested_revisions": len(tested),
        "evidence_files": len(evidence_by_id),
        "evidence_bytes_read": evidence_bytes_read,
        "verified_evidence_bytes": verified_evidence_bytes,
        "outcomes": len(outcomes),
        "manifest_sha256": _sha256(manifest_raw),
    }


def _required_test_ids(entry: dict[str, Any]) -> list[str]:
    raw = entry.get("required_tests", entry.get("tests", []))
    if not isinstance(raw, list):
        return []
    result: list[str] = []
    for item in raw:
        if isinstance(item, str) and _safe_key(item):
            result.append(item)
        elif isinstance(item, dict):
            candidate = item.get("id", item.get("command"))
            if isinstance(candidate, str) and candidate.strip():
                result.append(candidate)
    return result


def validate(
    coverage_map_path: str | Path,
    source_pins_path: str | Path,
    canonical_path: str | Path,
    issue_readbacks_path: str | Path,
    *,
    release_path: str | Path | None = None,
    check_urls: bool = True,
    check_dag: bool = True,
    require_specialists: bool = True,
) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    try:
        pins, _ = _read_json(source_pins_path, "source-pins")
        coverage, map_raw = _read_json(coverage_map_path, "coverage-map")
        canonical, canonical_raw = _read_json(canonical_path, "canonical-checklist")
        readbacks, readbacks_raw = _read_json(issue_readbacks_path, "issue-readbacks")
        map_pin, canonical_pin, readback_pin = _verify_source_pins(
            pins, map_raw, canonical_raw, readbacks_raw, issues
        )
        map_issues, dimensions, leaves = _validate_map(
            coverage,
            pins,
            canonical,
            readbacks,
            map_pin,
            readback_pin,
            check_urls=check_urls,
            check_dag=check_dag,
            require_specialists=require_specialists or release_path is not None,
        )
        issues.extend(item for item in map_issues if item not in issues)
        planning_issue_count = len(issues)
        planning_clean = planning_issue_count == 0
        release_counts: dict[str, Any] | None = None
        release_issue_start = len(issues)
        if release_path is not None:
            try:
                dag = coverage.get("dag")
                fan_in = dag.get("required_gate_fan_in") if isinstance(dag, dict) else None
                release_counts = _validate_release(
                    release_path, leaves, dag, fan_in, coverage.get("staged_edges"), issues
                )
            except InputError as exc:
                _add_issue(issues, exc.code, exc.record)
        else:
            release_counts = None
        release_issue_count = len(issues) - release_issue_start
        mode = "release" if release_path is not None else "planning"
        clean = len(issues) == 0
        status = (
            "SCOPED_RELEASE_EVIDENCE_READY" if clean and mode == "release"
            else "BACKLOG_READY" if clean
            else "BLOCKED"
        )
        canonical_revision = canonical_pin.get("issue_pinned_revision")
        if not isinstance(canonical_revision, str) or re.fullmatch(r"[0-9a-f]{40}", canonical_revision) is None:
            canonical_revision = None
        pending_blockers, pending_blockers_truncated = _reported_blockers(coverage)
        return {
            "schema": "acv1.coverage-validation/v1",
            "mode": mode,
            "status": status,
            "planning_status": "BACKLOG_READY" if planning_clean else "BLOCKED",
            "coordination_status": _normalized_snapshot_state(coverage.get("coordination_status"), COORDINATION_STATES),
            "publication_status": _normalized_snapshot_state(coverage.get("publication_status"), PUBLICATION_STATES),
            "release_status": status if mode == "release" else "not_run",
            "checks": {
                "issue_readbacks": check_urls,
                "typed_graph": check_dag,
                "specialist_families": require_specialists or release_path is not None,
            },
            "pending_blockers": pending_blockers,
            "pending_blockers_truncated": pending_blockers_truncated,
            "planning_only": mode == "planning",
            "whole_program_acceptance": False,
            "global_acceptance": "not_asserted",
            "source_pins": {
                "coverage_map_sha256": _sha256(map_raw),
                "canonical_git_blob_sha1": _git_blob_sha1(canonical_raw),
                "issue_readbacks_sha256": _sha256(readbacks_raw),
                "canonical_revision": canonical_revision,
                "issue_readback_capture_id": readback_pin.get("capture_id") if readback_pin is not None and _safe_key(readback_pin.get("capture_id")) else None,
                "issue_readback_captured_at": _normalized_utc(readback_pin.get("captured_at")) if readback_pin is not None else None,
            },
            "counts": dimensions,
            "release_counts": release_counts,
            "planning_issue_count": planning_issue_count,
            "release_issue_count": release_issue_count,
            "issue_count": len(issues),
            "issues": issues[:250],
        }
    except InputError as exc:
        issues.append({"code": exc.code, "record": exc.record})
        return {
            "schema": "acv1.coverage-validation/v1",
            "mode": "release" if release_path is not None else "planning",
            "status": "BLOCKED",
            "planning_status": "BLOCKED",
            "coordination_status": "unreported",
            "publication_status": "unreported",
            "release_status": "BLOCKED" if release_path is not None else "not_run",
            "checks": {
                "issue_readbacks": check_urls,
                "typed_graph": check_dag,
                "specialist_families": require_specialists or release_path is not None,
            },
            "pending_blockers": [],
            "pending_blockers_truncated": False,
            "planning_only": release_path is None,
            "whole_program_acceptance": False,
            "global_acceptance": "not_asserted",
            "source_pins": {},
            "counts": {},
            "release_counts": None,
            "planning_issue_count": 1,
            "release_issue_count": 1 if release_path is not None else 0,
            "issue_count": 1,
            "issues": issues,
        }
    except Exception:
        return {
            "schema": "acv1.coverage-validation/v1",
            "mode": "release" if release_path is not None else "planning",
            "status": "BLOCKED",
            "planning_status": "BLOCKED",
            "coordination_status": "unreported",
            "publication_status": "unreported",
            "release_status": "BLOCKED" if release_path is not None else "not_run",
            "checks": {
                "issue_readbacks": check_urls,
                "typed_graph": check_dag,
                "specialist_families": require_specialists or release_path is not None,
            },
            "pending_blockers": [],
            "pending_blockers_truncated": False,
            "planning_only": release_path is None,
            "whole_program_acceptance": False,
            "global_acceptance": "not_asserted",
            "source_pins": {},
            "counts": {},
            "release_counts": None,
            "planning_issue_count": 1,
            "release_issue_count": 1 if release_path is not None else 0,
            "issue_count": 1,
            "issues": [{"code": "VALIDATION_INTERNAL_ERROR", "record": "input"}],
        }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check explicit ACV1 coverage and evidence snapshots without network access."
    )
    parser.add_argument("coverage_map", help="explicit path to coverage-map JSON")
    parser.add_argument("--source-pins", required=True, help="explicit path to source pin JSON")
    parser.add_argument("--canonical-checklist", required=True, help="explicit path to canonical checklist JSON")
    parser.add_argument("--issue-readbacks", required=True, help="explicit path to timestamped issue readback JSON")
    parser.add_argument("--check-urls", action=argparse.BooleanOptionalAction, default=True, help="compare issue URLs and identities to readbacks (enabled by default)")
    parser.add_argument("--check-dag", action=argparse.BooleanOptionalAction, default=True, help="check typed execution and evidence-stage edges (enabled by default)")
    parser.add_argument("--require-specialist-leaves", action="store_true", help="require each supplied repo family")
    parser.add_argument("--release", help="explicit path to release-manifest JSON")
    parser.add_argument("--require-evidence", action="store_true", help="require exact revision and content-addressed evidence")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.require_evidence and not args.release:
        parser.error("--require-evidence requires --release")
    if args.release and not args.require_evidence:
        parser.error("--release requires --require-evidence")
    report = validate(
        args.coverage_map,
        args.source_pins,
        args.canonical_checklist,
        args.issue_readbacks,
        release_path=args.release,
        check_urls=args.check_urls,
        check_dag=args.check_dag,
        require_specialists=args.require_specialist_leaves,
    )
    sys.stdout.write(json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n")
    return 0 if report["status"] in {"BACKLOG_READY", "SCOPED_RELEASE_EVIDENCE_READY"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
