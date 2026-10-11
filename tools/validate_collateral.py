#!/usr/bin/env python3
"""Validate claim/provenance policy records and a synthetic text-only canary.

This command checks JSON and copy policy. It does not inspect or redact media,
rendered pixels, embedded office metadata, audio/video, or linked destinations.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
CANONICAL_LABELS = {"simulated", "sandbox", "live", "estimated", "pending"}
CLAIM_STATES = {"demonstrated", "simulated", "mock", "assumed", "planned", "blocked"}
SPONSOR_REFS = {
    "SPN-01": "SPN-NEATLOGS-001",
    "SPN-02": "SPN-ENTIRE-001",
    "SPN-03": "SPN-CFOAI-001",
}
SPONSORS = {"SPN-01": "Neatlogs", "SPN-02": "Entire", "SPN-03": "CFO.ai"}
EXPECTED_VISUAL_COPY_SOURCES = {
    "demo/diagrams/demo-workflow.svg": "DEMO-WORKFLOW-DIAGRAM-001",
    "demo/diagrams/demo-workflow-alt-text.md": "DEMO-WORKFLOW-DIAGRAM-001",
    "demo/screenshots/synthetic-stub-mockup.svg": "DEMO-SCREENSHOT-SET-001",
    "demo/screenshots/synthetic-stub-alt-text.md": "DEMO-SCREENSHOT-SET-001",
    "demo/deck/concept-overview.html": "DEMO-DECK-SUPPORT-001",
    "launch/assets/x-submission-key-visual.svg": "LAUNCH-X-KEY-VISUAL-001",
    "launch/assets/x-submission-alt-text.md": "LAUNCH-X-ALT-TEXT-001",
    "examples/synthetic/redaction-after-alt-text.md": "PROV-REDACTION-AFTER-ALT-001",
}
STATIC_HTML_COMPOSITION_ASSET_IDS = {"DEMO-DECK-SUPPORT-001"}
SELECTABLE_COLLATERAL_ASSET_IDS = {
    "DEMO-WORKFLOW-DIAGRAM-001",
    "DEMO-SCREENSHOT-SET-001",
    "DEMO-DECK-SUPPORT-001",
    "LAUNCH-X-KEY-VISUAL-001",
    "LAUNCH-X-ALT-TEXT-001",
}
DEFAULT_SUBMISSION_SELECTION = sorted(SELECTABLE_COLLATERAL_ASSET_IDS)
REQUIRED_SUBMISSION_ASSET_IDS = (
    "DEMO-EXPLAINER-001",
    "DEMO-SUBMISSION-NARRATIVE-001",
    "DEMO-SUBMISSION-VIDEO-001",
    "LAUNCH-X-COPY-001",
    "LAUNCH-X-CTA-001",
    "LAUNCH-X-KEY-VISUAL-001",
    "LAUNCH-X-ALT-TEXT-001",
)
REQUIRED_SUBMISSION_CLAIM_IDS = (
    "CLAIM-PRODUCT-CAPABILITY-001",
    "CLAIM-EVAL02-COMPARISON-001",
    "CLAIM-SPN-01-NEATLOGS-001",
    "CLAIM-SPN-02-ENTIRE-001",
    "CLAIM-SPN-03-CFO-001",
)
REQUIRED_SUBMISSION_EVIDENCE_CLASS_IDS = (
    "EVAL-02",
    "EVAL-03",
    "EVAL-04",
    "SPN-01",
    "SPN-02",
    "SPN-03",
)
LIFECYCLE_RELEASE_ELIGIBILITY = {
    "draft": False,
    "reviewed": False,
    "released": True,
    "deprecated": False,
    "not_applicable": False,
}
COMPOSABLE_SOURCE_KINDS = {
    "editable_visual_source",
    "synthetic_mockup_source",
    "visual_export",
    "static_html_rehearsal_support",
}
ACCESSIBLE_ALTERNATIVE_KINDS = {
    "accessible_text_alternative",
    "accessible_synthetic_fixture_alternative",
}
LOCAL_MEDIA_SUFFIXES = {".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"}
HEX40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
RISK_PATTERNS = [
    re.compile(r"\bfully\s+(?:automated|autonomous)\b", re.I),
    re.compile(r"\blive\s+(?:sponsor\s+)?integration\b", re.I),
    re.compile(r"\bverified\s+savings\b", re.I),
    re.compile(r"\bsaves?\s+\d+(?:\.\d+)?\s*%", re.I),
    re.compile(r"\b(?:reduces?|reduced|reducing)\s+(?:cost|costs|spend|processing time)\b", re.I),
    re.compile(r"\bguaranteed\s+(?:completion|savings|results|roi)\b", re.I),
]


def _read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: top-level JSON value must be an object")
    return value


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_path(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _is_tracked_repo_file(path_text: str) -> bool:
    candidate = Path(path_text)
    if candidate.is_absolute() or ".." in candidate.parts:
        return False
    local_path = ROOT / candidate
    if local_path.is_symlink() or not local_path.is_file():
        return False
    try:
        local_path.resolve(strict=True).relative_to(ROOT.resolve())
    except (OSError, RuntimeError, ValueError):
        return False
    result = subprocess.run(
        ["git", "ls-files", "--error-unmatch", path_text], cwd=ROOT,
        check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def _pinned_file(revision: str, path: str) -> bytes | None:
    """Read a path from a local immutable commit without trusting the worktree."""
    result = subprocess.run(
        ["git", "show", f"{revision}:{path}"],
        cwd=ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.stdout if result.returncode == 0 else None


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


class _CopyHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[str] = []
        self.skipped = 0
        self.units: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        self.stack.append(tag)
        if tag in {"style", "script"}:
            self.skipped += 1
        if tag == "img" and values.get("alt"):
            self.units.append(("html-alt", _norm(values["alt"] or "")))
        if values.get("aria-label"):
            self.units.append(("html-aria", _norm(values["aria-label"] or "")))
        if values.get("title"):
            self.units.append(("html-title-attribute", _norm(values["title"] or "")))

    def handle_endtag(self, tag: str) -> None:
        if tag in {"style", "script"} and self.skipped:
            self.skipped -= 1
        if tag in self.stack:
            index = len(self.stack) - 1 - self.stack[::-1].index(tag)
            self.stack = self.stack[:index]

    def handle_data(self, data: str) -> None:
        text = _norm(data)
        if not text or self.skipped:
            return
        surface = "html-document-title" if self.stack and self.stack[-1] == "title" else "html-visible-text"
        self.units.append((surface, text))


class _HTMLDependencyParser(HTMLParser):
    """Collect local media and accessible-alternative links consumed by static HTML."""

    def __init__(self) -> None:
        super().__init__()
        self.references: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "img" and values.get("src"):
            self.references.append(("embedded", values["src"] or ""))
        elif tag in {"audio", "iframe", "source", "video"} and values.get("src"):
            self.references.append(("embedded", values["src"] or ""))
        elif tag == "object" and values.get("data"):
            self.references.append(("embedded", values["data"] or ""))
        elif tag == "a" and values.get("href"):
            href = values["href"] or ""
            suffix = Path(urlsplit(href).path).suffix.lower()
            if suffix == ".md":
                self.references.append(("alternative", href))
            elif suffix in LOCAL_MEDIA_SUFFIXES:
                self.references.append(("embedded", href))


def _markdown_copy_units(text: str) -> list[tuple[str, str]]:
    units: list[tuple[str, str]] = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n")):
        rest: list[str] = []
        for line in block.strip().splitlines():
            heading = re.match(r"^#{1,6}\s+(.+?)\s*#*$", line.strip())
            if heading:
                units.append(("markdown-heading", _norm(heading.group(1))))
            else:
                rest.append(line)
        if rest:
            paragraph = _norm("\n".join(rest))
            if paragraph:
                units.append(("markdown-paragraph", paragraph))
    return units


def _extract_copy_units(path: Path) -> list[tuple[str, str]]:
    suffix = path.suffix.lower()
    if suffix == ".svg":
        root = ET.parse(path).getroot()
        units: list[tuple[str, str]] = []
        for element in root.iter():
            tag = element.tag.split("}")[-1]
            text = _norm("".join(element.itertext()))
            if not text:
                continue
            if tag == "title":
                units.append(("svg-accessible-title", text))
            elif tag == "desc":
                units.append(("svg-accessible-description", text))
            elif tag == "text":
                units.append(("svg-visible-text", text))
        return units
    if suffix == ".html":
        parser = _CopyHTMLParser()
        parser.feed(path.read_text(encoding="utf-8"))
        return parser.units
    if suffix == ".md":
        return _markdown_copy_units(path.read_text(encoding="utf-8"))
    return []


def _pinned_revision(source: dict[str, Any]) -> bool:
    revision = source.get("revision")
    kind = source.get("revisionKind")
    if isinstance(revision, str) and HEX40.fullmatch(revision):
        return True
    if isinstance(revision, str) and SHA256.fullmatch(revision):
        return True
    # Missing pins are allowed only for draft candidates. The release gate below
    # reports them as blockers; an unpinned row can never be approved.
    return revision is None and kind in {
        "candidate_content_digest",
        "upstream_issue_not_commit",
        "sha256_content_digest_to_be_bound_after_review",
    }


def _destination_scope_covered(allowed: Any, approved: Any) -> bool:
    """Every destination permitted by the source record must be explicitly approved."""
    return (
        isinstance(allowed, list)
        and bool(allowed)
        and all(isinstance(item, str) and item for item in allowed)
        and isinstance(approved, list)
        and bool(approved)
        and all(isinstance(item, str) and item for item in approved)
        and set(allowed) <= set(approved)
    )


def _destination_requirements(
    root_record_ids: list[str] | tuple[str, ...],
    records_by_id: dict[str, dict[str, Any]],
    *,
    include_derivatives: bool,
    relevant_kinds: set[str] | None = None,
) -> dict[str, set[str]]:
    """Propagate each output root's intended destinations through its provenance closure."""
    required_by_record: dict[str, set[str]] = {}
    for root_id in root_record_ids:
        root = records_by_id.get(root_id)
        destinations = root.get("allowedDestinations") if root else None
        if (
            not isinstance(destinations, list)
            or not destinations
            or not all(isinstance(item, str) and item for item in destinations)
        ):
            continue

        queue = [root_id]
        seen: set[str] = set()
        while queue:
            record_id = queue.pop()
            if record_id in seen:
                continue
            seen.add(record_id)
            record = records_by_id.get(record_id)
            if not record or (relevant_kinds is not None and record.get("kind") not in relevant_kinds):
                continue
            required_by_record.setdefault(record_id, set()).update(destinations)

            lineage = record.get("lineage", {})
            related_ids: list[str] = []
            if isinstance(lineage, dict):
                parents = lineage.get("derivedFrom", [])
                if isinstance(parents, list):
                    related_ids.extend(item for item in parents if isinstance(item, str))
                if include_derivatives:
                    derivatives = lineage.get("derivatives", [])
                    if isinstance(derivatives, list):
                        related_ids.extend(item for item in derivatives if isinstance(item, str))
            dependencies = record.get("compositionDependencies", [])
            if isinstance(dependencies, list):
                related_ids.extend(item for item in dependencies if isinstance(item, str))
            queue.extend(related_ids)
    return required_by_record


def _unsafe_positive_copy(text: str) -> list[str]:
    problems: list[str] = []
    for clause in re.split(r"[.;!?]\s*", text):
        clause = clause.strip()
        if not clause:
            continue
        is_negative = bool(
            re.match(
                r"^(?:no\b|not\b|never\b|without\b|unverified\b|pending\b|"
                r"does not\b|do not\b|is not\b|are not\b|isn't\b|aren't\b)",
                clause,
                re.I,
            )
        ) or bool(re.search(r"\b(?:not|never|unverified|pending|no)\b.{0,45}$", clause, re.I))
        if is_negative:
            continue
        for pattern in RISK_PATTERNS:
            if pattern.search(clause):
                problems.append(f"unsupported positive wording: {clause}")
                break
    return problems


def validate_claims(ledger: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if ledger.get("schemaVersion") != "1.0":
        errors.append("claims schemaVersion must be 1.0")
    if ledger.get("inventoryKey") != "MM-02":
        errors.append("claims inventoryKey must be MM-02")

    labels = set(ledger.get("canonicalEvidenceLabels", []))
    if not CANONICAL_LABELS.issubset(labels):
        errors.append("canonical EVAL-03 evidence labels must retain simulated/sandbox/live/estimated/pending")
    if not {"mock", "planned"}.issubset(set(ledger.get("additionalCopyStates", []))):
        errors.append("mock and planned must remain additional copy states")

    evidence_rows = ledger.get("evidenceClasses", [])
    evidence_by_id = {row.get("id"): row for row in evidence_rows if isinstance(row, dict)}
    if len(evidence_by_id) != len(evidence_rows):
        errors.append("evidence class IDs must be unique")
    for identifier in ("EVAL-02", "EVAL-03", "EVAL-04", "SPN-01", "SPN-02", "SPN-03"):
        if identifier not in evidence_by_id:
            errors.append(f"missing distinct evidence class {identifier}")
    sponsor_refs_seen: set[str] = set()
    for sponsor_id, expected_ref in SPONSOR_REFS.items():
        row = evidence_by_id.get(sponsor_id)
        if not row:
            continue
        if row.get("sponsor") != SPONSORS[sponsor_id]:
            errors.append(f"{sponsor_id} must remain the separate {SPONSORS[sponsor_id]} evidence class")
        evidence_ref = row.get("evidenceRef")
        if evidence_ref != expected_ref or evidence_ref in sponsor_refs_seen:
            errors.append(f"{sponsor_id} must have its own unique evidence reference {expected_ref}")
        if evidence_ref:
            sponsor_refs_seen.add(evidence_ref)

    claims = ledger.get("claims", [])
    claim_by_id: dict[str, dict[str, Any]] = {}
    required_claim_fields = {
        "id",
        "allowedWording",
        "prohibitedVariants",
        "audience",
        "destination",
        "state",
        "source",
        "evidenceReference",
        "evidenceClassification",
        "providerMode",
        "reviewDate",
        "reviewer",
        "reviewStatus",
        "limitations",
        "reReviewTrigger",
    }
    for row in claims:
        if not isinstance(row, dict):
            errors.append("each claim must be an object")
            continue
        identifier = row.get("id")
        if not isinstance(identifier, str) or not identifier:
            errors.append("each claim requires a stable id")
            continue
        if identifier in claim_by_id:
            errors.append(f"duplicate claim ID {identifier}")
        claim_by_id[identifier] = row
        missing = required_claim_fields - set(row)
        if missing:
            errors.append(f"{identifier}: missing fields {', '.join(sorted(missing))}")
        if row.get("state") not in CLAIM_STATES:
            errors.append(f"{identifier}: unsupported claim state {row.get('state')!r}")
        if not isinstance(row.get("allowedWording"), str) or not row.get("allowedWording", "").strip():
            errors.append(f"{identifier}: exact allowedWording is required")
        if not isinstance(row.get("source"), dict):
            errors.append(f"{identifier}: source repository/path/revision record is required")
            continue
        source = row["source"]
        if not source.get("repo") or not source.get("path") or not _pinned_revision(source):
            errors.append(f"{identifier}: source repo/path and an immutable revision or explicit draft pin state are required")
        if row.get("reviewStatus") == "approved":
            if not row.get("reviewer") or not row.get("reviewDate"):
                errors.append(f"{identifier}: approved claim requires reviewer and reviewDate")
            if not isinstance(source.get("revision"), str) or not (HEX40.fullmatch(source["revision"]) or SHA256.fullmatch(source["revision"])):
                errors.append(f"{identifier}: approved claim requires an immutable source revision")
            if row.get("state") in {"blocked", "planned", "assumed"}:
                errors.append(f"{identifier}: blocked/planned/assumed claim cannot be approved")
        qualifier = row.get("requiredQualifier")
        if row.get("kind") in {"visual_concept", "proposed_policy", "project_identifier"} and not qualifier:
            errors.append(f"{identifier}: contextual visual wording requires a requiredQualifier")
        errors.extend(f"{identifier}: {problem}" for problem in _unsafe_positive_copy(row.get("allowedWording", "")))

    ctas = ledger.get("ctas", [])
    cta_by_id: dict[str, dict[str, Any]] = {}
    for row in ctas:
        if not isinstance(row, dict):
            errors.append("each CTA must be an object")
            continue
        identifier = row.get("id")
        if not isinstance(identifier, str) or not identifier:
            errors.append("each CTA requires a stable id")
            continue
        if identifier in cta_by_id:
            errors.append(f"duplicate CTA ID {identifier}")
        cta_by_id[identifier] = row
        for field in ("exactText", "intendedAction", "destinationClass", "destinationOwner", "availability", "reviewer", "reReviewTrigger"):
            if field not in row or row.get(field) is None or row.get(field) == "":
                errors.append(f"{identifier}: missing required CTA field {field}")
        if not isinstance(row.get("exactText"), str):
            continue
        errors.extend(f"{identifier}: {problem}" for problem in _unsafe_positive_copy(row["exactText"]))
        availability = row.get("availability", {})
        if row.get("wordingReview") == "approved":
            if not row.get("reviewer") or not row.get("reviewDate"):
                errors.append(f"{identifier}: approved CTA wording requires reviewer and reviewDate")
            if row.get("routeReview") == "confirmed_by_assigned_supervisor_for_repository_docs_only":
                if availability.get("status") != "confirmed_for_pinned_documentation_only":
                    errors.append(f"{identifier}: CTA wording cannot be approved with unavailable/unconfirmed destination")
                if not row.get("routeReviewer") or not row.get("routeReviewDate"):
                    errors.append(f"{identifier}: confirmed documentation route requires reviewer and routeReviewDate")
            elif row.get("routeReview") == "confirmed_static_repository_file_only":
                target = row.get("target")
                if (
                    row.get("destinationClass") != "repository_accessible_text_alternative"
                    or availability.get("status") != "confirmed_local_repository_file_only"
                    or not isinstance(target, str)
                    or not _is_tracked_repo_file(target)
                ):
                    errors.append(f"{identifier}: confirmed local-file CTA must name an existing repository text alternative")
                if not row.get("routeReviewer") or not row.get("routeReviewDate"):
                    errors.append(f"{identifier}: confirmed local-file route requires reviewer and routeReviewDate")
            else:
                errors.append(f"{identifier}: CTA cannot be approved without a confirmed destination-owner route")
        if row.get("destinationClass") != "none" and availability.get("status") == "confirmed_for_pinned_documentation_only":
            target = row.get("target")
            if not isinstance(target, str) or not target.startswith("https://github.com/"):
                errors.append(f"{identifier}: confirmed repository CTA requires an exact public documentation target")
        if row.get("availability", {}).get("status") == "unavailable_unconfirmed" and row.get("target") is not None:
            errors.append(f"{identifier}: unavailable CTA must not carry a promoted target")

    return errors


def validate_provenance(register: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if register.get("schemaVersion") != "1.0":
        errors.append("provenance schemaVersion must be 1.0")
    if register.get("inventoryKey") != "MM-05":
        errors.append("provenance inventoryKey must be MM-05")
    rows = register.get("records", [])
    ids: set[str] = set()
    required = set(register.get("requiredRecordFields", []))
    for row in rows:
        if not isinstance(row, dict):
            errors.append("each provenance record must be an object")
            continue
        identifier = row.get("assetId")
        if not isinstance(identifier, str) or not identifier:
            errors.append("each provenance record requires assetId")
            continue
        if identifier in ids:
            errors.append(f"duplicate provenance asset ID {identifier}")
        ids.add(identifier)
        missing = required - set(row)
        if missing:
            errors.append(f"{identifier}: missing provenance fields {', '.join(sorted(missing))}")
        source = row.get("source", {})
        if not source.get("repo") or not source.get("path"):
            errors.append(f"{identifier}: source repo and path are required")
        revision = source.get("revision")
        if revision is not None and not (
            (isinstance(revision, str) and HEX40.fullmatch(revision))
            or (isinstance(revision, str) and SHA256.fullmatch(revision))
        ):
            errors.append(f"{identifier}: source revision must be a commit or SHA-256 content digest")
        if source.get("repo") == "Jevelopers-neatHack-2026/marketing-material":
            source_path = source.get("path")
            local_path = ROOT / str(source_path)
            if not local_path.is_file():
                errors.append(f"{identifier}: exact provenance source file is missing: {source_path}")
            else:
                actual_digest = _sha256_path(local_path)
                if row.get("checksum", {}).get("value") != actual_digest:
                    errors.append(f"{identifier}: SHA-256 checksum does not match exact source file {source_path}")
                if isinstance(revision, str) and HEX40.fullmatch(revision):
                    pinned = _pinned_file(revision, str(source_path))
                    if pinned is None:
                        errors.append(f"{identifier}: source path is absent at pinned commit {revision}")
                    elif _sha256_bytes(pinned) != actual_digest:
                        errors.append(f"{identifier}: pinned source commit does not contain this exact file revision")
                elif isinstance(revision, str) and SHA256.fullmatch(revision):
                    if revision.removeprefix("sha256:") != actual_digest:
                        errors.append(f"{identifier}: content-digest source pin does not match exact source file")
        permission = row.get("permission", {})
        permission_state = permission.get("status")
        publishability = row.get("publishability")
        if permission_state in {"unknown", "revoked", "expired", "rejected"} and publishability == "approved":
            errors.append(f"{identifier}: {permission_state} permission cannot be approved for publication")
        checksum = row.get("checksum", {})
        if publishability == "approved":
            if permission_state != "approved":
                errors.append(f"{identifier}: public approval requires explicit destination permission")
            if not source.get("revision"):
                errors.append(f"{identifier}: public approval requires an immutable source revision")
            if not row.get("reviewer") or not row.get("reviewDate"):
                errors.append(f"{identifier}: public approval requires reviewer and date")
            if not SHA256.fullmatch(f"sha256:{checksum.get('value', '')}"):
                errors.append(f"{identifier}: public approval requires a SHA-256 checksum")
            if not _destination_scope_covered(row.get("allowedDestinations"), permission.get("approvedDestinations")):
                errors.append(f"{identifier}: public approval must cover every allowed destination")
    if "PROV-SYNTHETIC-CANARY-001" not in ids:
        errors.append("required synthetic canary provenance record is missing")
    errors.extend(validate_provenance_lineage(register))
    errors.extend(validate_provenance_composition(register))
    return errors


def _local_composition_target(source_path: str, reference: str) -> str | None:
    """Resolve an in-repository HTML reference while ignoring external URLs/fragments."""
    parsed = urlsplit(reference)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return None
    path = unquote(parsed.path)
    if path.startswith("/"):
        target = posixpath.normpath(path.lstrip("/"))
    else:
        target = posixpath.normpath(posixpath.join(posixpath.dirname(source_path), path))
    if target in {"", ".", ".."} or target.startswith("../"):
        raise ValueError("local reference escapes the repository root")
    return target


def validate_provenance_composition(register: dict[str, Any]) -> list[str]:
    """Validate HTML composition edges separately from source/derivative lineage."""
    errors: list[str] = []
    rows = [row for row in register.get("records", []) if isinstance(row, dict)]
    by_id = {row.get("assetId"): row for row in rows if isinstance(row.get("assetId"), str)}
    by_path: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        path = row.get("source", {}).get("path")
        if isinstance(path, str):
            by_path.setdefault(path, []).append(row)

    graph: dict[str, set[str]] = {}
    for identifier, row in by_id.items():
        raw_dependencies = row.get("compositionDependencies", [])
        if not isinstance(raw_dependencies, list) or not all(isinstance(item, str) for item in raw_dependencies):
            errors.append(f"{identifier}: compositionDependencies must be an array of provenance record IDs")
            raw_dependencies = []
        if len(raw_dependencies) != len(set(raw_dependencies)):
            errors.append(f"{identifier}: compositionDependencies must be unique")
        graph[identifier] = set(raw_dependencies)
        if identifier in graph[identifier]:
            errors.append(f"{identifier}: composition cannot depend on itself")
        for dependency_id in raw_dependencies:
            if dependency_id not in by_id:
                errors.append(f"{identifier}: unknown composition dependency {dependency_id}")

        source_path = row.get("source", {}).get("path")
        if row.get("kind") != "static_html_rehearsal_support":
            if identifier in STATIC_HTML_COMPOSITION_ASSET_IDS:
                errors.append(f"{identifier}: canonical HTML composition must retain static_html_rehearsal_support kind")
            continue
        if not isinstance(source_path, str) or not (ROOT / source_path).is_file():
            errors.append(f"{identifier}: static HTML composition source is missing")
            continue
        parser = _HTMLDependencyParser()
        try:
            parser.feed((ROOT / source_path).read_text(encoding="utf-8"))
        except (OSError, UnicodeError) as exc:
            errors.append(f"{identifier}: HTML composition references cannot be read: {exc}")
            continue

        actual_dependencies: set[str] = set()
        for dependency_kind, reference in parser.references:
            try:
                target_path = _local_composition_target(source_path, reference)
            except ValueError as exc:
                errors.append(f"{identifier}: unsafe HTML composition reference {reference!r}: {exc}")
                continue
            if target_path is None:
                continue
            if dependency_kind == "alternative":
                candidates = [
                    item for item in by_path.get(target_path, [])
                    if item.get("kind") in ACCESSIBLE_ALTERNATIVE_KINDS
                ]
            else:
                candidates = [
                    item for item in by_path.get(target_path, [])
                    if item.get("kind") in COMPOSABLE_SOURCE_KINDS
                ]
            if len(candidates) != 1:
                errors.append(
                    f"{identifier}: HTML {dependency_kind} reference {target_path} must resolve to exactly one matching provenance record"
                )
                continue
            actual_dependencies.add(candidates[0]["assetId"])

        declared = set(raw_dependencies)
        for missing in sorted(actual_dependencies - declared):
            errors.append(f"{identifier}: compositionDependencies omits consumed HTML source {missing}")
        for stale in sorted(declared - actual_dependencies):
            errors.append(f"{identifier}: composition dependency {stale} is not a consumed local HTML source")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(identifier: str) -> None:
        if identifier in visiting:
            errors.append(f"{identifier}: provenance composition graph contains a cycle")
            return
        if identifier in visited:
            return
        visiting.add(identifier)
        for dependency_id in graph.get(identifier, set()):
            if dependency_id in by_id:
                visit(dependency_id)
        visiting.remove(identifier)
        visited.add(identifier)

    for identifier in graph:
        visit(identifier)
    return errors


def validate_provenance_lineage(register: dict[str, Any]) -> list[str]:
    """Require known, reciprocal source-to-derivative edges and an acyclic graph."""
    errors: list[str] = []
    rows = [row for row in register.get("records", []) if isinstance(row, dict)]
    by_id = {row.get("assetId"): row for row in rows if isinstance(row.get("assetId"), str)}
    parents: dict[str, set[str]] = {}
    children: dict[str, set[str]] = {}
    for identifier, row in by_id.items():
        lineage = row.get("lineage", {})
        if not isinstance(lineage, dict):
            errors.append(f"{identifier}: lineage must be an object")
            continue
        raw_parents = lineage.get("derivedFrom", [])
        raw_children = lineage.get("derivatives", [])
        if not isinstance(raw_parents, list) or not all(isinstance(item, str) for item in raw_parents):
            errors.append(f"{identifier}: lineage.derivedFrom must be an array of IDs")
            raw_parents = []
        if not isinstance(raw_children, list) or not all(isinstance(item, str) for item in raw_children):
            errors.append(f"{identifier}: lineage.derivatives must be an array of IDs")
            raw_children = []
        if len(raw_parents) != len(set(raw_parents)) or len(raw_children) != len(set(raw_children)):
            errors.append(f"{identifier}: lineage references must be unique")
        parents[identifier] = set(raw_parents)
        children[identifier] = set(raw_children)
        if identifier in parents[identifier] or identifier in children[identifier]:
            errors.append(f"{identifier}: lineage cannot reference itself")
    for child, source_ids in parents.items():
        for source_id in source_ids:
            if source_id not in by_id:
                errors.append(f"{child}: unknown lineage source {source_id}")
            elif child not in children.get(source_id, set()):
                errors.append(f"{child}: lineage source {source_id} does not list this derivative")
    for source_id, derivative_ids in children.items():
        for child in derivative_ids:
            if child not in by_id:
                errors.append(f"{source_id}: unknown lineage derivative {child}")
            elif source_id not in parents.get(child, set()):
                errors.append(f"{source_id}: derivative {child} does not list this source")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(identifier: str) -> None:
        if identifier in visiting:
            errors.append(f"{identifier}: provenance lineage contains a cycle")
            return
        if identifier in visited:
            return
        visiting.add(identifier)
        for child in children.get(identifier, set()):
            if child in by_id:
                visit(child)
        visiting.remove(identifier)
        visited.add(identifier)

    for identifier in by_id:
        visit(identifier)
    return errors


def validate_fixture(fixture: dict[str, Any], ledger: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if fixture.get("classification") != "synthetic":
        errors.append("canary fixture must be explicitly synthetic")
    prefix = fixture.get("canaryPrefix")
    surfaces = fixture.get("sourceSurfaces", {})
    safe = fixture.get("expectedRedactedSurfaces", {})
    if not isinstance(prefix, str) or not prefix.startswith("SYNTHETIC_"):
        errors.append("canary marker prefix must be obviously synthetic")
        return errors
    if set(surfaces) != set(safe):
        errors.append("source and expected-redacted canary surfaces must match")
    for field, value in surfaces.items():
        if not isinstance(value, str) or prefix not in value:
            errors.append(f"{field}: source canary must contain the synthetic marker")
    for field, value in safe.items():
        if isinstance(value, str) and prefix in value:
            errors.append(f"{field}: synthetic marker remains in expected sanitized value")
    expected = fixture.get("expectedValidation", {})
    if expected.get("visualPixelInspection") != "not_performed":
        errors.append("fixture must state that actual pixel inspection was not performed")
    if expected.get("metadataAndNotesInspectionOfRenderedExports") != "not_performed":
        errors.append("fixture must state that rendered metadata/notes inspection was not performed")

    claims_by_id = {row.get("id"): row for row in ledger.get("claims", []) if isinstance(row, dict)}
    ctas_by_id = {row.get("id"): row for row in ledger.get("ctas", []) if isinstance(row, dict)}
    for mapping in fixture.get("safeConceptCopy", []):
        text = mapping.get("text", "")
        if "claimId" in mapping:
            row = claims_by_id.get(mapping["claimId"])
            if not row:
                errors.append(f"fixture copy references missing claim {mapping['claimId']}")
                continue
            if text != row.get("allowedWording"):
                errors.append(f"fixture text does not exactly match {mapping['claimId']} allowedWording")
            if mapping.get("requiredQualifier") != row.get("requiredQualifier"):
                errors.append(f"fixture qualifier does not match {mapping['claimId']} requiredQualifier")
            if mapping.get("requiredQualifier") and not row.get("requiredQualifier"):
                errors.append(f"{mapping['claimId']} lacks its required contextual qualifier")
        elif "ctaId" in mapping:
            row = ctas_by_id.get(mapping["ctaId"])
            if not row:
                errors.append(f"fixture copy references missing CTA {mapping['ctaId']}")
            elif text != row.get("exactText"):
                errors.append(f"fixture CTA text does not exactly match {mapping['ctaId']}")
        else:
            errors.append(f"fixture text has no claimId or ctaId mapping: {text}")
        errors.extend(_unsafe_positive_copy(text))
    return errors


def validate_visual_copy(
    ledger: dict[str, Any], handoff: dict[str, Any], register: dict[str, Any]
) -> list[str]:
    """Require exact copy, source, claim/CTA, and provenance joins for the visual candidate."""
    errors: list[str] = []
    copy_policy = ledger.get("visualCopy")
    if not isinstance(copy_policy, dict):
        return ["visual copy mapping register is missing"]
    handoff_path = copy_policy.get("handoffPath")
    handoff_commit = copy_policy.get("handoffCommit")
    if handoff_path != "review/visual/asset-handoff.json":
        errors.append("visual copy mapping must name the canonical asset handoff path")
    if not isinstance(handoff_commit, str) or not HEX40.fullmatch(handoff_commit):
        errors.append("visual copy mapping handoff must pin an immutable commit")
    else:
        pinned_handoff = _pinned_file(handoff_commit, handoff_path or "")
        if pinned_handoff is None or _sha256_bytes(pinned_handoff) != copy_policy.get("handoffSha256"):
            errors.append("visual asset handoff source pin/checksum is missing or stale")
    claim_ids = {row.get("id") for row in ledger.get("claims", []) if isinstance(row, dict)}
    cta_by_id = {row.get("id"): row for row in ledger.get("ctas", []) if isinstance(row, dict)}
    provenance_by_id = {
        row.get("assetId"): row
        for row in register.get("records", [])
        if isinstance(row, dict)
    }
    mappings = copy_policy.get("mappings", [])
    qualifier_contexts = {
        row.get("qualifierId"): row
        for row in copy_policy.get("qualifierContexts", [])
        if isinstance(row, dict)
    }
    if len(qualifier_contexts) != len(copy_policy.get("qualifierContexts", [])):
        errors.append("visual qualifier context IDs must be present and unique")
    mapping_ids: set[str] = set()
    mapped_units: dict[tuple[str, str], set[str]] = {}
    map_by_asset_path_surface: set[tuple[str, str, str, str]] = set()
    for row in mappings:
        if not isinstance(row, dict):
            errors.append("each visual copy mapping must be an object")
            continue
        map_id = row.get("mappingId")
        if not isinstance(map_id, str) or not map_id:
            errors.append("each visual copy mapping requires a stable mappingId")
        elif map_id in mapping_ids:
            errors.append(f"duplicate visual copy mapping ID {map_id}")
        else:
            mapping_ids.add(map_id)
        asset_id, path_text, surface = row.get("assetId"), row.get("path"), row.get("surface")
        exact_text, kind = row.get("exactText"), row.get("mappingKind")
        if not all(isinstance(value, str) and value for value in (asset_id, path_text, surface, exact_text)):
            errors.append(f"{map_id or 'visual mapping'}: asset, path, surface and exactText are required")
            continue
        key = (asset_id, path_text, surface, exact_text)
        if key in map_by_asset_path_surface:
            errors.append(f"{map_id}: duplicate exact copy mapping for {path_text}")
        map_by_asset_path_surface.add(key)
        path = ROOT / path_text
        if not path.is_file():
            errors.append(f"{map_id}: copy source path is missing: {path_text}")
            continue
        digest = _sha256_path(path)
        if digest != row.get("sourceSha256"):
            errors.append(f"{map_id}: copy source checksum drift for {path_text}")
        revision = row.get("sourceCommit")
        if not isinstance(revision, str) or not HEX40.fullmatch(revision):
            errors.append(f"{map_id}: copy source must pin a full commit")
        else:
            pinned = _pinned_file(revision, path_text)
            if pinned is None or _sha256_bytes(pinned) != row.get("sourceSha256"):
                errors.append(f"{map_id}: pinned source file is absent or does not match the exact checksum")
        provenance_id = row.get("provenanceRecordId")
        record = provenance_by_id.get(provenance_id)
        if not record:
            errors.append(f"{map_id}: missing provenance record {provenance_id}")
        else:
            if record.get("source", {}).get("path") != path_text:
                errors.append(f"{map_id}: provenance record {provenance_id} points to a different source path")
            if record.get("checksum", {}).get("value") != digest:
                errors.append(f"{map_id}: provenance checksum does not match mapped copy source {path_text}")
        if "claimId" in row:
            claim_id = row.get("claimId")
            if claim_id not in claim_ids:
                errors.append(f"{map_id}: missing claim {claim_id}")
            else:
                claim = next(item for item in ledger["claims"] if item.get("id") == claim_id)
                if claim.get("allowedWording") != exact_text:
                    errors.append(f"{map_id}: exact copy differs from {claim_id} allowedWording")
                if claim.get("requiredQualifier"):
                    context_id = row.get("contextQualifierId")
                    context = qualifier_contexts.get(context_id)
                    if not context:
                        errors.append(f"{map_id}: required qualifier for {claim_id} has no per-asset context mapping")
                    else:
                        if asset_id not in context.get("relatedAssetIds", []):
                            errors.append(f"{map_id}: qualifier context {context_id} does not cover asset {asset_id}")
                        qualifier_claims = {
                            item.get("claimId"): item.get("requiredQualifier")
                            for item in context.get("requiredClaimQualifiers", [])
                            if isinstance(item, dict)
                        }
                        if qualifier_claims.get(claim_id) != claim.get("requiredQualifier"):
                            errors.append(f"{map_id}: qualifier context {context_id} omits or changes {claim_id} requiredQualifier")
        elif "ctaId" in row:
            cta = cta_by_id.get(row.get("ctaId"))
            if not cta:
                errors.append(f"{map_id}: missing CTA {row.get('ctaId')}")
            elif cta.get("exactText") != exact_text:
                errors.append(f"{map_id}: exact copy differs from {row.get('ctaId')} exactText")
        else:
            errors.append(f"{map_id}: exact copy requires a claimId or ctaId")
        try:
            actual = _extract_copy_units(path)
        except (OSError, ET.ParseError) as exc:
            errors.append(f"{map_id}: source copy cannot be read: {exc}")
            continue
        actual_by_surface: dict[str, set[str]] = {}
        all_text = []
        for actual_surface, actual_text in actual:
            actual_by_surface.setdefault(actual_surface, set()).add(actual_text)
            all_text.append(actual_text)
        if kind == "block":
            mapped_units.setdefault((path_text, surface), set()).add(exact_text)
            if exact_text not in actual_by_surface.get(surface, set()):
                errors.append(f"{map_id}: mapped copy is absent or drifted in {path_text} ({surface})")
        elif kind == "span":
            if exact_text not in " ".join(all_text) and exact_text not in path.read_text(encoding="utf-8"):
                errors.append(f"{map_id}: CTA action span is absent or drifted in {path_text}")
        else:
            errors.append(f"{map_id}: mappingKind must be block or span")

    mapped_paths = {
        row.get("path") for row in mappings
        if isinstance(row, dict) and isinstance(row.get("path"), str)
    }
    for path_text, expected_asset_id in EXPECTED_VISUAL_COPY_SOURCES.items():
        if not (ROOT / path_text).is_file():
            errors.append(f"expected visual-copy source path is missing: {path_text}")
        if path_text not in mapped_paths:
            errors.append(f"expected visual-copy source path has no copy mappings: {path_text}")
        for row in mappings:
            if isinstance(row, dict) and row.get("path") == path_text and row.get("assetId") != expected_asset_id:
                errors.append(f"{path_text}: expected copy owner {expected_asset_id}, found {row.get('assetId')}")
    for path_text in sorted(mapped_paths - set(EXPECTED_VISUAL_COPY_SOURCES)):
        errors.append(f"unexpected visual-copy source path is not in the independent source manifest: {path_text}")

    for path_text in sorted(set(EXPECTED_VISUAL_COPY_SOURCES) | mapped_paths):
        try:
            actual = _extract_copy_units(ROOT / path_text)
        except (OSError, ET.ParseError) as exc:
            errors.append(f"visual source copy cannot be extracted for {path_text}: {exc}")
            continue
        for surface in {surface for surface, _ in actual}:
            actual_set = {text for actual_surface, text in actual if actual_surface == surface}
            mapped_set = mapped_units.get((path_text, surface), set())
            for missing in sorted(actual_set - mapped_set):
                errors.append(f"unmapped copy fragment in {path_text} ({surface}): {missing}")
            for stale in sorted(mapped_set - actual_set):
                errors.append(f"stale copy mapping in {path_text} ({surface}): {stale}")

    # The consumer handoff remains a required independent inventory of every SVG line.
    for asset in handoff.get("assets", []):
        path_text, asset_id = asset.get("source"), asset.get("assetId")
        mapped = mapped_units.get((path_text, "svg-visible-text"), set())
        for text in asset.get("visibleText", []):
            if _norm(text) not in mapped:
                errors.append(f"asset handoff line is missing an exact copy join for {asset_id}: {text}")
    for context_id, context in qualifier_contexts.items():
        review_status = context.get("reviewStatus")
        disposition = context.get("releaseDisposition")
        if review_status == "pending_independent_exact_copy_review":
            if disposition != "blocked":
                errors.append(f"{context_id}: pending qualifier review must remain blocked")
        elif review_status == "approved":
            if disposition != "approved_for_selected_collateral":
                errors.append(f"{context_id}: approved qualifier review requires selected-collateral disposition")
            if not context.get("reviewer") or not context.get("reviewDate"):
                errors.append(f"{context_id}: approved qualifier context requires reviewer and reviewDate")
        else:
            errors.append(f"{context_id}: unsupported qualifier-context review state {review_status!r}")
        for mapping_id in context.get("visibleOrAccessibleQualifierCopyIds", []):
            if mapping_id not in mapping_ids:
                errors.append(f"{context_id}: contextual qualifier references missing copy mapping {mapping_id}")
        for item in context.get("requiredClaimQualifiers", []):
            claim = next((row for row in ledger.get("claims", []) if row.get("id") == item.get("claimId")), None)
            if not claim or item.get("requiredQualifier") != claim.get("requiredQualifier"):
                errors.append(f"{context_id}: per-asset qualifier wording is missing or drifted for {item.get('claimId')}")
    return errors


def _caption_timestamp(seconds: float, comma: bool = False) -> str:
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    whole_seconds, milliseconds = divmod(milliseconds, 1_000)
    separator = "," if comma else "."
    return f"{hours:02}:{minutes:02}:{whole_seconds:02}{separator}{milliseconds:03}"


def validate_narrative_copy(
    ledger: dict[str, Any], register: dict[str, Any], inventory: dict[str, Any]
) -> list[str]:
    """Join scene narration, captions, browser-visible text, and alternatives to exact ledger rows."""
    errors: list[str] = []
    mapping = ledger.get("narrativeCopy")
    if not isinstance(mapping, dict) or mapping.get("schemaVersion") != "1.0":
        return ["narrativeCopy exact-copy map with schemaVersion 1.0 is required"]

    claim_by_id = {
        row.get("id"): row for row in ledger.get("claims", []) if isinstance(row, dict)
    }
    cta_by_id = {
        row.get("id"): row for row in ledger.get("ctas", []) if isinstance(row, dict)
    }
    evidence_by_id = {
        row.get("id"): row for row in ledger.get("evidenceClasses", []) if isinstance(row, dict)
    }
    provenance_by_id = {
        row.get("assetId"): row for row in register.get("records", []) if isinstance(row, dict)
    }
    inventory_by_path = {
        row.get("path"): row for row in inventory.get("trackedFiles", []) if isinstance(row, dict)
    }

    def exact_source_pin(path_text: str, commit: str, digest: str, context: str) -> None:
        path = ROOT / path_text
        if not path.is_file():
            errors.append(f"{context}: exact source path is missing: {path_text}")
            return
        actual = _sha256_path(path)
        if digest != actual:
            errors.append(f"{context}: source SHA-256 drift for {path_text}")
        if not isinstance(commit, str) or not HEX40.fullmatch(commit):
            errors.append(f"{context}: source must pin a full commit")
            return
        pinned = _pinned_file(commit, path_text)
        if pinned is None or _sha256_bytes(pinned) != actual:
            errors.append(f"{context}: pinned commit does not contain the exact current source {path_text}")
        tracked_row = inventory_by_path.get(path_text)
        if not tracked_row or tracked_row.get("exists") is not True:
            errors.append(f"{context}: exact source path is not indexed in the collateral inventory: {path_text}")
        record_id = tracked_row.get("provenanceRecordId") if tracked_row else None
        record = provenance_by_id.get(record_id)
        if not record or record.get("source", {}).get("path") != path_text:
            errors.append(f"{context}: exact source path has no matching inventory/provenance join: {path_text}")
        elif record.get("checksum", {}).get("value") != actual:
            errors.append(f"{context}: provenance checksum drift for {path_text}")

    source = mapping.get("sceneSource", {})
    scene_path = source.get("path")
    if scene_path != "demo/rehearsal-scenes.json":
        errors.append("narrativeCopy must name demo/rehearsal-scenes.json as its canonical scene source")
    else:
        exact_source_pin(scene_path, source.get("sourceCommit"), source.get("sha256"), "narrative scene source")
    plan_ref = mapping.get("renderPlan", {})
    plan_path = plan_ref.get("path")
    if plan_path != "demo/exports/rehearsal-render-plan.json":
        errors.append("narrativeCopy must name the canonical rehearsal render plan")
    else:
        exact_source_pin(plan_path, plan_ref.get("sourceCommit"), plan_ref.get("sha256"), "narrative render plan")

    try:
        scenes_data = _read_json(ROOT / "demo/rehearsal-scenes.json")
        plan_data = _read_json(ROOT / "demo/exports/rehearsal-render-plan.json")
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        return errors + [f"narrative scene/render source is invalid: {exc}"]
    scenes = scenes_data.get("scenes", [])
    if len(scenes) != mapping.get("expectedSceneCount"):
        errors.append("narrativeCopy expectedSceneCount does not match the source scene count")
    if plan_data.get("scenes") != scenes:
        errors.append("render plan scene content drifted from the canonical scene source")

    proposals = {
        row.get("id"): row for row in scenes_data.get("ledgerJoinProposals", []) if isinstance(row, dict)
    }
    required_proposals = mapping.get("requiredProposalIds", [])
    if set(required_proposals) != set(proposals) or len(required_proposals) != len(proposals):
        errors.append("narrativeCopy proposal manifest must independently list every unique source proposal")
    for proposal_id, proposal in proposals.items():
        claim = claim_by_id.get(proposal_id)
        if not claim:
            errors.append(f"narrative proposal {proposal_id} has no exact claim-ledger row")
            continue
        if claim.get("allowedWording") != proposal.get("exactWording"):
            errors.append(f"narrative proposal {proposal_id} exactWording differs from its claim-ledger row")
        if claim.get("state") not in {"mock", "planned", "blocked"} or claim.get("reviewStatus") == "approved":
            errors.append(f"narrative proposal {proposal_id} must remain an unapproved draft/status row")
        claim_source = claim.get("source", {})
        if claim_source.get("path") != scene_path or claim_source.get("revision") != source.get("sourceCommit"):
            errors.append(f"narrative proposal {proposal_id} must pin the exact scene-source commit")
        if claim.get("requiredQualifier"):
            related_scene_ids = proposal.get("sceneIds", [proposal.get("sceneId")])
            if isinstance(related_scene_ids, str):
                related_scene_ids = [related_scene_ids]
            for scene_id in filter(None, related_scene_ids):
                scene = next((item for item in scenes if item.get("sceneId") == scene_id), None)
                if not scene:
                    errors.append(f"narrative proposal {proposal_id} references unknown scene {scene_id}")
                    continue
                qualifiers = {
                    claim_by_id.get(segment.get("claimId"), {}).get("requiredQualifier")
                    for segment in scene.get("copySegments", [])
                    if segment.get("kind") == "claim_qualifier"
                }
                if claim.get("requiredQualifier") not in qualifiers:
                    errors.append(f"narrative proposal {proposal_id} lacks its exact contextual qualifier in {scene_id}")

    copy_units = mapping.get("copyUnits", [])
    copy_by_id = {row.get("unitId"): row for row in copy_units if isinstance(row, dict)}
    expected_copy_count = sum(len(scene.get("copySegments", [])) for scene in scenes)
    if len(copy_units) != expected_copy_count or len(copy_by_id) != len(copy_units):
        errors.append("narrativeCopy copyUnits must uniquely cover every exact scene caption/narration segment")
    screen_units = mapping.get("screenTextUnits", [])
    screen_by_id = {row.get("unitId"): row for row in screen_units if isinstance(row, dict)}
    expected_screen_count = sum(len(scene.get("screenText", [])) for scene in scenes)
    if (
        len(screen_units) != expected_screen_count
        or len(screen_by_id) != len(screen_units)
        or len(screen_units) != mapping.get("expectedScreenTextUnitCount")
    ):
        errors.append("narrativeCopy screenTextUnits must uniquely cover every exact scene screen-text line")

    for scene in scenes:
        scene_id = scene.get("sceneId")
        if scene.get("captionText") != scene.get("narration"):
            errors.append(f"{scene_id}: captionText must exactly match narration")
        if " ".join(segment.get("text", "") for segment in scene.get("copySegments", [])) != scene.get("captionText"):
            errors.append(f"{scene_id}: captionText must be composed from its classified copy segments")
        for index, segment in enumerate(scene.get("copySegments", [])):
            unit_id = f"{scene_id}::segment-{index:02}"
            row = copy_by_id.get(unit_id)
            if not row:
                errors.append(f"{scene_id}: exact copy segment is unmapped ({unit_id})")
                continue
            if row.get("exactText") != segment.get("text") or row.get("kind") != segment.get("kind"):
                errors.append(f"{unit_id}: mapped copy kind/text drifted from the canonical scene")
            if row.get("sceneId") != scene_id:
                errors.append(f"{unit_id}: mapped copy belongs to a different scene")
            if segment.get("kind") in {"claim_wording", "claim_qualifier"}:
                refs = [segment.get("claimId"), *segment.get("alsoClaimIds", [])]
                for claim_id in filter(None, refs):
                    claim = claim_by_id.get(claim_id)
                    if not claim:
                        errors.append(f"{unit_id}: missing claim {claim_id}")
                        continue
                    if segment.get("kind") == "claim_qualifier":
                        if claim_id == segment.get("claimId") and segment.get("text") != claim.get("requiredQualifier"):
                            errors.append(f"{unit_id}: qualifier does not exactly match {claim_id}")
                        elif claim_id in segment.get("alsoClaimIds", []) and segment.get("text") not in {
                            claim.get("requiredQualifier"), claim.get("allowedWording")
                        }:
                            errors.append(f"{unit_id}: secondary claim context does not match {claim_id}")
                    else:
                        source_wording = segment.get("sourceWording", segment.get("text"))
                        if source_wording != claim.get("allowedWording"):
                            errors.append(f"{unit_id}: sourceWording differs from {claim_id} allowedWording")
                        if segment.get("text") not in {source_wording, source_wording + "."}:
                            errors.append(f"{unit_id}: rendered wording drifted from the exact claim text")
            elif segment.get("kind") == "proposed_wording":
                proposal_id = segment.get("proposalId")
                claim = claim_by_id.get(proposal_id)
                if proposal_id not in proposals or not claim:
                    errors.append(f"{unit_id}: proposed copy lacks its source proposal or ledger row")
                elif segment.get("text") != proposals[proposal_id].get("exactWording") or segment.get("text") != claim.get("allowedWording"):
                    errors.append(f"{unit_id}: proposed copy differs from exact proposal/ledger wording")
            elif segment.get("kind") == "cta_wording":
                cta = cta_by_id.get(segment.get("ctaId"))
                if not cta or segment.get("text") != cta.get("exactText"):
                    errors.append(f"{unit_id}: exact CTA text/ID is missing or drifted")
            else:
                errors.append(f"{unit_id}: unsupported copy segment kind {segment.get('kind')!r}")

        for index, text in enumerate(scene.get("screenText", [])):
            unit_id = f"{scene_id}::screen-{index:02}"
            row = screen_by_id.get(unit_id)
            if not row:
                errors.append(f"{scene_id}: browser-visible text is unmapped ({unit_id})")
                continue
            if row.get("exactText") != text or row.get("sceneId") != scene_id:
                errors.append(f"{unit_id}: browser-visible text mapping drifted")
            refs = row.get("claimIds", [])
            if any(claim_id not in claim_by_id for claim_id in refs):
                errors.append(f"{unit_id}: browser-visible text references an unknown claim")
            if any(claim_id not in scene.get("claimIDs", []) for claim_id in refs):
                errors.append(f"{unit_id}: browser-visible claim reference is not attached to the same scene")
            for claim_id in refs:
                claim = claim_by_id[claim_id]
                wording = claim.get("allowedWording", "")
                qualifier = claim.get("requiredQualifier", "")
                exact_text = row.get("exactText", "")
                fragments = [part for part in (wording, qualifier) if part]
                if not any(
                    fragment.casefold().rstrip(" .") in exact_text.casefold().rstrip(" .")
                    or exact_text.casefold().rstrip(" .") in fragment.casefold().rstrip(" .")
                    for fragment in fragments
                ):
                    errors.append(f"{unit_id}: claim reference {claim_id} does not support this exact screen line")
            for proposal_id in row.get("proposalIds", []):
                proposal = proposals.get(proposal_id)
                if not proposal or proposal_id not in claim_by_id:
                    errors.append(f"{unit_id}: browser-visible status references an unknown proposal {proposal_id}")
                elif proposal.get("exactWording", "").casefold() not in row.get("exactText", "").casefold() and row.get("exactText") not in {"Hold or revise draft", "Production handoff: planned"}:
                    errors.append(f"{unit_id}: proposal reference does not match the source screen label")
            for cta_id in row.get("ctaIds", []):
                cta = cta_by_id.get(cta_id)
                if not cta or cta.get("exactText") != row.get("exactText"):
                    errors.append(f"{unit_id}: browser-visible CTA is not exact")
            status = row.get("statusReference")
            if not refs and not row.get("proposalIds") and not row.get("ctaIds") and not isinstance(status, dict):
                errors.append(f"{unit_id}: browser-visible screen text has no claim, CTA, proposal, or status mapping")
            if isinstance(status, dict):
                status_type = status.get("type")
                evidence_id = status.get("evidenceClassId")
                if evidence_id and evidence_id not in evidence_by_id:
                    errors.append(f"{unit_id}: status references unknown evidence class {evidence_id}")
                if status_type == "sponsor_facet":
                    scene_facet = next((item for item in scene.get("sponsorFacets", []) if item.get("aspect") == status.get("aspect")), None)
                    if not scene_facet or scene_facet.get("status") != "pending" or status.get("status") != "pending" or evidence_id != scene.get("sponsorEvidenceClass"):
                        errors.append(f"{unit_id}: sponsor facet status must match its own pending source row")
                elif status_type == "sponsor_status" and (status.get("status") != "pending" or evidence_id != scene.get("sponsorEvidenceClass")):
                    errors.append(f"{unit_id}: sponsor status must remain in its distinct pending class")
                elif status_type == "provider_mode" and (status.get("value") != scene.get("providerMode") or status.get("value") != "not_run"):
                    errors.append(f"{unit_id}: provider mode label must match not_run in the source scene")
                elif status_type == "evidence_class_status":
                    if status.get("status") != "pending" or "PENDING" not in row.get("exactText", ""):
                        errors.append(f"{unit_id}: rehearsal EVAL label must preserve its source-pinned pending state")
                elif status_type == "submission_field_status" and (status.get("status") != "pending" or "PENDING" not in row.get("exactText", "")):
                    errors.append(f"{unit_id}: unresolved submission field must remain visibly pending")
                elif status_type == "qualifying_status_label":
                    if not status.get("relatedClaimIds") or any(claim_id not in scene.get("claimIDs", []) for claim_id in status.get("relatedClaimIds", [])):
                        errors.append(f"{unit_id}: qualification label must map to the same scene's claims")
                elif status_type == "scene_state_label":
                    if status.get("sceneId") != scene_id or status.get("evidenceClass") != scene.get("evidenceClass") or status.get("providerMode") != scene.get("providerMode"):
                        errors.append(f"{unit_id}: scene status label differs from its source-state record")
                elif status_type not in {"sponsor_facet", "sponsor_status", "provider_mode", "evidence_class_status", "submission_field_status", "qualifying_status_label", "scene_state_label"}:
                    errors.append(f"{unit_id}: unsupported screen-text status-reference kind {status_type!r}")

    # Reject stale or extra copy rows, and keep the expected input surfaces independent of the source segments.
    expected_copy_ids = {
        f"{scene.get('sceneId')}::segment-{index:02}"
        for scene in scenes for index, _ in enumerate(scene.get("copySegments", []))
    }
    if set(copy_by_id) != expected_copy_ids:
        errors.append("narrativeCopy contains missing or stale caption/narration mapping IDs")
    expected_screen_ids = {
        f"{scene.get('sceneId')}::screen-{index:02}"
        for scene in scenes for index, _ in enumerate(scene.get("screenText", []))
    }
    if set(screen_by_id) != expected_screen_ids:
        errors.append("narrativeCopy contains missing or stale browser screen-text mapping IDs")

    expected_surfaces = {
        "demo/rehearsal-scenes.json", "demo/narration.md", "demo/rehearsal-transcript.md",
        "demo/captions/silent-rehearsal.srt", "demo/captions/silent-rehearsal.vtt",
        "demo/deck/rehearsal-scenes.html",
    }
    surface_rows = mapping.get("surfaces", [])
    surface_paths = [row.get("path") for row in surface_rows if isinstance(row, dict)]
    if set(surface_paths) != expected_surfaces or len(surface_paths) != len(expected_surfaces):
        errors.append("narrativeCopy surfaces must independently enumerate scene, narration, transcript, both caption sidecars, and HTML")
    for row in surface_rows:
        if not isinstance(row, dict):
            continue
        path_text, asset_id = row.get("path"), row.get("assetId")
        record_id = row.get("provenanceRecordId")
        inv_row = inventory_by_path.get(path_text)
        record = provenance_by_id.get(record_id)
        if not inv_row or inv_row.get("provenanceRecordId") != record_id:
            errors.append(f"narrative surface {path_text}: inventory/provenance ID join is missing")
        if not record or record.get("assetId") != asset_id or record.get("source", {}).get("path") != path_text:
            errors.append(f"narrative surface {path_text}: canonical asset provenance path/ID mismatch")
        if path_text and (ROOT / path_text).is_file() and record and record.get("checksum", {}).get("value") != _sha256_path(ROOT / path_text):
            errors.append(f"narrative surface {path_text}: current bytes do not match canonical provenance checksum")

    # The HTML embeds exact scene and cue data; fixed labels are explicitly classified as draft/accessibility state.
    html_map = mapping.get("html", {})
    html_path = ROOT / str(html_map.get("path", ""))
    try:
        html_text = html_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        errors.append(f"narrative HTML source cannot be read: {exc}")
        html_text = ""
    match = re.search(r"const data=(\{.*?\});const cue=", html_text, re.S)
    if not match:
        errors.append("narrative HTML must embed the exact render-plan data payload")
    else:
        try:
            html_data = json.loads(match.group(1))
            if html_data.get("scenes") != plan_data.get("scenes") or html_data.get("cues") != plan_data.get("cues"):
                errors.append("narrative HTML dynamic copy differs from the pinned render plan")
        except json.JSONDecodeError as exc:
            errors.append(f"narrative HTML dynamic copy payload is invalid JSON: {exc}")
    for fragment in html_map.get("staticFragments", []):
        if not isinstance(fragment, dict) or not fragment.get("exactText") or fragment.get("exactText") not in html_text:
            errors.append("narrative HTML fixed status/accessibility fragment is missing or unmapped")
        elif fragment.get("role") not in {"document title status", "persistent status label", "persistent status and media label", "accessible caption region label"}:
            errors.append("narrative HTML fixed fragment has an unsupported surface role")
    if html_map.get("ariaLabel") and f'aria-label="{html_map["ariaLabel"]}"' not in html_text:
        errors.append("narrative HTML accessible caption-region label is missing or drifted")

    # SRT/VTT cues must match exact cue text/timestamps; no speech or audio timing is inferred.
    for sidecar_path, is_srt in (("demo/captions/silent-rehearsal.srt", True), ("demo/captions/silent-rehearsal.vtt", False)):
        try:
            content = (ROOT / sidecar_path).read_text(encoding="utf-8").strip()
        except (OSError, UnicodeError) as exc:
            errors.append(f"caption sidecar cannot be read: {sidecar_path}: {exc}")
            continue
        blocks = [block.splitlines() for block in re.split(r"\n\s*\n", content) if block.strip()]
        if not is_srt and blocks and blocks[0] == ["WEBVTT"]:
            blocks = blocks[1:]
        if len(blocks) != len(plan_data.get("cues", [])):
            errors.append(f"{sidecar_path}: cue count differs from the render plan")
            continue
        for index, (block, cue) in enumerate(zip(blocks, plan_data.get("cues", []))):
            if is_srt:
                if len(block) < 3 or block[0] != str(index + 1):
                    errors.append(f"{sidecar_path}: malformed SRT cue {index + 1}")
                    continue
                timing_line, text_lines = block[1], block[2:]
            else:
                if len(block) < 2:
                    errors.append(f"{sidecar_path}: malformed VTT cue {index + 1}")
                    continue
                timing_line, text_lines = block[0], block[1:]
            expected_timing = f"{_caption_timestamp(cue['startSeconds'], is_srt)} --> {_caption_timestamp(cue['endSeconds'], is_srt)}"
            if timing_line != expected_timing or " ".join(text_lines) != cue.get("text"):
                errors.append(f"{sidecar_path}: exact cue text/timing drift at cue {index + 1}")

    transcript_path = ROOT / "demo/rehearsal-transcript.md"
    try:
        transcript = transcript_path.read_text(encoding="utf-8")
        transcript_captions = re.findall(r"^\*\*Caption:\*\* (.*)$", transcript, re.M)
        if transcript_captions != [scene.get("captionText") for scene in scenes]:
            errors.append("accessible transcript caption lines differ from the exact scene captions")
        transcript_lines = transcript.splitlines()
        transcript_screens: list[list[str]] = []
        index = 0
        while index < len(transcript_lines):
            if transcript_lines[index] == "**On screen:**":
                index += 1
                while index < len(transcript_lines) and not transcript_lines[index].strip():
                    index += 1
                screen_lines: list[str] = []
                while index < len(transcript_lines) and transcript_lines[index].startswith("- "):
                    screen_lines.append(transcript_lines[index][2:])
                    index += 1
                transcript_screens.append(screen_lines)
            else:
                index += 1
        expected_screens = [scene.get("screenText", []) for scene in scenes]
        if transcript_screens != expected_screens:
            errors.append("accessible transcript on-screen text differs from the exact scene screenText lines")
    except (OSError, UnicodeError) as exc:
        errors.append(f"accessible transcript cannot be read: {exc}")

    narration_path = ROOT / "demo/narration.md"
    try:
        narration = narration_path.read_text(encoding="utf-8")
        narration_rows: dict[str, str] = {}
        for line in narration.splitlines():
            if not line.startswith("| `scene-"):
                continue
            cells = [cell.strip() for cell in line.split("|")]
            if len(cells) == 5 and cells[1].startswith("`") and cells[1].endswith("`"):
                narration_rows[cells[1][1:-1]] = cells[3]
        expected_narration = {scene.get("sceneId"): scene.get("captionText") for scene in scenes}
        if narration_rows != expected_narration:
            errors.append("narration script rows differ from the exact scene caption/narration text")
        if "mapped to `messaging/claims.json`; they remain unapproved." not in narration:
            errors.append("narration script must accurately describe the five proposal rows as joined and unapproved")
        if "It has not been merged into `messaging/claims.json`" in narration:
            errors.append("narration script contains stale proposal-join status")
    except (OSError, UnicodeError) as exc:
        errors.append(f"narration script cannot be read: {exc}")

    return errors


def validate_inventory(inventory: dict[str, Any]) -> list[str]:
    """Check exact tracked-file coverage, stable IDs, availability, lifecycle, and checksums."""
    errors: list[str] = []
    status_definitions = inventory.get("statusDefinitions", {})
    documented_lifecycle = (
        status_definitions.get("releaseEligibilityByLifecycle")
        if isinstance(status_definitions, dict) else None
    )
    if documented_lifecycle != LIFECYCLE_RELEASE_ELIGIBILITY:
        errors.append("statusDefinitions.releaseEligibilityByLifecycle must match the validator lifecycle policy")
    rows = inventory.get("trackedFiles", [])
    path_rows: dict[str, dict[str, Any]] = {}
    id_seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            errors.append("each trackedFiles entry must be an object")
            continue
        path_text, file_id = row.get("path"), row.get("fileId")
        if not isinstance(path_text, str) or not path_text or not isinstance(file_id, str) or not file_id:
            errors.append("each tracked file requires exact path and canonical fileId")
            continue
        if path_text in path_rows:
            errors.append(f"duplicate tracked file path {path_text}")
        if file_id in id_seen:
            errors.append(f"duplicate canonical tracked file ID {file_id}")
        id_seen.add(file_id)
        path_rows[path_text] = row
        path = ROOT / path_text
        if not path.is_file() or row.get("exists") is not True:
            errors.append(f"inventory path is marked tracked but missing: {path_text}")
            continue
        if row.get("pathAvailability") not in {"tracked_at_baseline", "created_in_candidate"}:
            errors.append(f"{path_text}: tracked file has invalid pathAvailability")
        lifecycle = row.get("lifecycleState")
        expected_eligibility = LIFECYCLE_RELEASE_ELIGIBILITY.get(lifecycle)
        if expected_eligibility is None:
            errors.append(f"{path_text}: lifecycleState must be one of {', '.join(LIFECYCLE_RELEASE_ELIGIBILITY)}")
        elif not isinstance(row.get("releaseEligible"), bool) or row.get("releaseEligible") is not expected_eligibility:
            errors.append(f"{path_text}: lifecycleState {lifecycle} requires releaseEligible={str(expected_eligibility).lower()}")
        expected_digest = row.get("sha256")
        if expected_digest and _sha256_path(path) != expected_digest:
            errors.append(f"{path_text}: tracked inventory checksum drift")
    result = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    if result.returncode:
        errors.append("cannot enumerate tracked files with git ls-files")
    else:
        tracked = set(result.stdout.splitlines())
        indexed = set(path_rows)
        for path_text in sorted(tracked - indexed):
            errors.append(f"unlisted tracked collateral/supporting file: {path_text}")
        for path_text in sorted(indexed - tracked):
            errors.append(f"inventory lists an untracked path: {path_text}")
    scope = inventory.get("submissionScope")
    if not isinstance(scope, dict):
        errors.append("submissionScope must explicitly define required final assets, claims, evidence classes, and owner gates")
    else:
        for field in ("requiredAssetIds", "requiredClaimIds", "requiredEvidenceClassIds", "requiredOwnerGates"):
            value = scope.get(field)
            if not isinstance(value, list) or not value:
                errors.append(f"submissionScope.{field} must be a nonempty array")
            elif not all(isinstance(item, (str, dict)) for item in value):
                errors.append(f"submissionScope.{field} contains an invalid value")
        planned = {row.get("assetId") for row in inventory.get("plannedDeliverables", []) if isinstance(row, dict)}
        required_assets = scope.get("requiredAssetIds", [])
        if all(isinstance(item, str) for item in required_assets):
            if len(required_assets) != len(set(required_assets)):
                errors.append("submissionScope.requiredAssetIds must be unique")
            for asset_id in sorted(set(required_assets) - planned):
                errors.append(f"submissionScope references an asset absent from plannedDeliverables: {asset_id}")
        for field in ("requiredClaimIds", "requiredEvidenceClassIds"):
            values = scope.get(field, [])
            if all(isinstance(item, str) for item in values) and len(values) != len(set(values)):
                errors.append(f"submissionScope.{field} must be unique")
        canonical_requirements = {
            "requiredAssetIds": REQUIRED_SUBMISSION_ASSET_IDS,
            "requiredClaimIds": REQUIRED_SUBMISSION_CLAIM_IDS,
            "requiredEvidenceClassIds": REQUIRED_SUBMISSION_EVIDENCE_CLASS_IDS,
        }
        for field, required_ids in canonical_requirements.items():
            values = scope.get(field, [])
            if isinstance(values, list) and all(isinstance(item, str) for item in values):
                missing_ids = sorted(set(required_ids) - set(values))
                if missing_ids:
                    errors.append(f"submissionScope.{field} omits immutable required IDs: {', '.join(missing_ids)}")
        gates = scope.get("requiredOwnerGates", [])
        gate_ids = [row.get("id") for row in gates if isinstance(row, dict)]
        if len(gate_ids) != len(set(gate_ids)):
            errors.append("submissionScope owner gate IDs must be unique")
        required_gate_ids = {"BRAND-CONSUMPTION-001", "ORGANIZER-RULES-AND-CUTOFF-001"}
        if set(gate_ids) != required_gate_ids:
            errors.append("submissionScope must retain the explicit brand and organizer owner gates")
        for gate in gates:
            if not isinstance(gate, dict) or gate.get("status") not in {"pending", "approved"}:
                errors.append("submissionScope owner gate status must be pending or approved")
            elif gate.get("status") == "approved" and not all(gate.get(field) for field in ("reviewer", "reviewDate", "evidenceRef")):
                errors.append(f"submissionScope owner gate {gate.get('id')}: approval requires reviewer, reviewDate and evidenceRef")
    return errors


def _selection_errors(selected_asset_ids: list[str] | tuple[str, ...] | None) -> list[str]:
    if not selected_asset_ids:
        return ["selected collateral scope requires at least one --select asset ID"]
    if len(selected_asset_ids) != len(set(selected_asset_ids)):
        return ["selected collateral scope cannot contain duplicate asset IDs"]
    unknown = sorted(set(selected_asset_ids) - SELECTABLE_COLLATERAL_ASSET_IDS)
    if unknown:
        return ["unknown or nonselectable collateral asset IDs: " + ", ".join(unknown)]
    return []


def validate_inventory_composition(inventory: dict[str, Any], register: dict[str, Any]) -> list[str]:
    """Keep the inventory's human-facing composition declaration aligned to provenance."""
    errors: list[str] = []
    planned = {
        row.get("assetId"): row
        for row in inventory.get("plannedDeliverables", [])
        if isinstance(row, dict) and isinstance(row.get("assetId"), str)
    }
    records = {
        row.get("assetId"): row
        for row in register.get("records", [])
        if isinstance(row, dict) and isinstance(row.get("assetId"), str)
    }
    for asset_id, record in records.items():
        if record.get("kind") != "static_html_rehearsal_support":
            continue
        inventory_row = planned.get(asset_id)
        if not inventory_row:
            errors.append(f"{asset_id}: static HTML composition is missing from the collateral inventory")
            continue
        if "compositionDependencies" not in inventory_row:
            errors.append(f"{asset_id}: static HTML composition is missing its inventory dependency list")
    for asset_id, row in planned.items():
        if "compositionDependencies" not in row:
            continue
        record = records.get(asset_id)
        if not record:
            errors.append(f"{asset_id}: inventory composition has no provenance record")
            continue
        if record.get("kind") != "static_html_rehearsal_support":
            errors.append(f"{asset_id}: inventory composition requires a static HTML provenance record")
            continue
        inventory_dependencies = row.get("compositionDependencies")
        provenance_dependencies = record.get("compositionDependencies", [])
        if not isinstance(inventory_dependencies, list) or not all(isinstance(item, str) for item in inventory_dependencies):
            errors.append(f"{asset_id}: inventory compositionDependencies must be an array of provenance record IDs")
            continue
        if not isinstance(provenance_dependencies, list) or not all(isinstance(item, str) for item in provenance_dependencies):
            errors.append(f"{asset_id}: provenance compositionDependencies must be an array of record IDs")
            continue
        if set(inventory_dependencies) != set(provenance_dependencies):
            errors.append(f"{asset_id}: inventory and provenance composition dependencies differ")
    return errors


def validate_inventory_provenance(inventory: dict[str, Any], register: dict[str, Any]) -> list[str]:
    """Join each required deliverable to its canonical exact-output provenance record."""
    errors: list[str] = []
    planned = {
        row.get("assetId"): row
        for row in inventory.get("plannedDeliverables", [])
        if isinstance(row, dict) and isinstance(row.get("assetId"), str)
    }
    records = {
        row.get("assetId"): row
        for row in register.get("records", [])
        if isinstance(row, dict) and isinstance(row.get("assetId"), str)
    }
    scope = inventory.get("submissionScope", {})
    scoped_asset_ids = scope.get("requiredAssetIds", []) if isinstance(scope, dict) else []
    required_asset_ids = set(REQUIRED_SUBMISSION_ASSET_IDS)
    if isinstance(scoped_asset_ids, list):
        required_asset_ids.update(item for item in scoped_asset_ids if isinstance(item, str))
    for asset_id in sorted(required_asset_ids):
        row = planned.get(asset_id)
        if not row:
            continue
        record_ids = row.get("provenanceRecordIds")
        if not isinstance(record_ids, list) or not all(isinstance(item, str) and item for item in record_ids):
            errors.append(f"{asset_id}: provenanceRecordIds must be an array of canonical provenance asset IDs")
            continue
        if len(record_ids) != len(set(record_ids)):
            errors.append(f"{asset_id}: provenanceRecordIds must be unique")
        if len(record_ids) > 1:
            errors.append(f"{asset_id}: exactly one canonical output provenance record is supported")
        for record_id in record_ids:
            record = records.get(record_id)
            if not record:
                errors.append(f"{asset_id}: provenanceRecordIds references missing record {record_id}")
                continue
            if record_id != asset_id or record.get("assetId") != asset_id:
                errors.append(f"{asset_id}: provenance record {record_id} is not the canonical output record")
            source = record.get("source", {})
            if not isinstance(source, dict) or source.get("path") != row.get("path"):
                errors.append(f"{asset_id}: provenance record {record_id} source path does not match the planned output")
    return errors


def _expand_selected_assets(
    ledger: dict[str, Any], register: dict[str, Any], selected_asset_ids: list[str] | tuple[str, ...]
) -> tuple[set[str], set[str]]:
    selected = set(selected_asset_ids)
    mappings = ledger.get("visualCopy", {}).get("mappings", [])
    records = {row.get("assetId"): row for row in register.get("records", []) if isinstance(row, dict)}
    contexts = ledger.get("visualCopy", {}).get("qualifierContexts", [])
    composition_records: set[str] = set()
    changed = True
    while changed:
        before = (set(selected), set(composition_records))
        for context in contexts:
            related = set(context.get("relatedAssetIds", []))
            if related & selected:
                selected.update(related & SELECTABLE_COLLATERAL_ASSET_IDS)
        for mapping in mappings:
            if mapping.get("assetId") not in selected:
                continue
            record = records.get(mapping.get("provenanceRecordId"))
            if not record:
                continue
            for parent_id in record.get("lineage", {}).get("derivedFrom", []):
                if parent_id in SELECTABLE_COLLATERAL_ASSET_IDS:
                    selected.add(parent_id)
            for dependency_id in record.get("compositionDependencies", []):
                composition_records.add(dependency_id)
                for dependency_mapping in mappings:
                    if dependency_mapping.get("provenanceRecordId") != dependency_id:
                        continue
                    dependency_asset = dependency_mapping.get("assetId")
                    if dependency_asset in SELECTABLE_COLLATERAL_ASSET_IDS:
                        selected.add(dependency_asset)
        changed = before != (selected, composition_records)
    return selected, composition_records


def _cta_blockers(cta: dict[str, Any]) -> list[str]:
    identifier = cta.get("id", "unknown-CTA")
    problems: list[str] = []
    if cta.get("wordingReview") != "approved":
        problems.append(f"{identifier}: exact CTA wording is not approved")
        return problems
    if not cta.get("reviewer") or not cta.get("reviewDate"):
        problems.append(f"{identifier}: approved CTA wording lacks reviewer/date")
    availability = cta.get("availability", {})
    target = cta.get("target")
    if cta.get("routeReview") == "confirmed_by_assigned_supervisor_for_repository_docs_only":
        if availability.get("status") != "confirmed_for_pinned_documentation_only" or not isinstance(target, str) or not target.startswith("https://github.com/"):
            problems.append(f"{identifier}: repository documentation target is unavailable or unpinned")
    elif cta.get("routeReview") == "confirmed_static_repository_file_only":
        if (
            cta.get("destinationClass") != "repository_accessible_text_alternative"
            or availability.get("status") != "confirmed_local_repository_file_only"
            or not isinstance(target, str)
            or not _is_tracked_repo_file(target)
        ):
            problems.append(f"{identifier}: confirmed local-file CTA must name an existing repository text alternative")
    else:
        problems.append(f"{identifier}: CTA destination-owner route is not confirmed")
    if not cta.get("routeReviewer") or not cta.get("routeReviewDate"):
        problems.append(f"{identifier}: CTA route confirmation lacks reviewer/date")
    return problems


def selected_collateral_blockers(
    ledger: dict[str, Any], register: dict[str, Any], selected_asset_ids: list[str] | tuple[str, ...]
) -> list[str]:
    """Evaluate only a nonempty, known selection and its copy, qualifier, CTA, and rights joins."""
    errors = _selection_errors(selected_asset_ids)
    if errors:
        return errors
    selected, composition_records = _expand_selected_assets(ledger, register, selected_asset_ids)
    mappings = [
        row for row in ledger.get("visualCopy", {}).get("mappings", [])
        if isinstance(row, dict) and row.get("assetId") in selected
    ]
    blockers: list[str] = []
    if not mappings:
        return ["selected collateral has no exact copy mapping"]

    claims_by_id = {row.get("id"): row for row in ledger.get("claims", []) if isinstance(row, dict)}
    ctas_by_id = {row.get("id"): row for row in ledger.get("ctas", []) if isinstance(row, dict)}
    claim_ids = {row.get("claimId") for row in mappings if row.get("claimId")}
    cta_ids = {row.get("ctaId") for row in mappings if row.get("ctaId")}
    for claim_id in sorted(claim_ids):
        claim = claims_by_id.get(claim_id)
        if not claim:
            blockers.append(f"{claim_id}: selected copy references a missing claim")
            continue
        if claim.get("reviewStatus") != "approved":
            blockers.append(f"{claim_id}: selected exact-copy review is not approved")
        if not claim.get("reviewer") or not claim.get("reviewDate"):
            blockers.append(f"{claim_id}: selected claim approval lacks reviewer/date")
        if not _pinned_revision(claim.get("source", {})) or not claim.get("source", {}).get("revision"):
            blockers.append(f"{claim_id}: selected claim source is not immutably pinned")
        if claim.get("state") in {"blocked", "planned", "assumed"}:
            blockers.append(f"{claim_id}: selected claim state is {claim.get('state')}")
        blockers.extend(f"{claim_id}: {item}" for item in _unsafe_positive_copy(claim.get("allowedWording", "")))
    for cta_id in sorted(cta_ids):
        cta = ctas_by_id.get(cta_id)
        if not cta:
            blockers.append(f"{cta_id}: selected copy references a missing CTA")
        else:
            blockers.extend(_cta_blockers(cta))

    contexts_by_id = {
        row.get("qualifierId"): row
        for row in ledger.get("visualCopy", {}).get("qualifierContexts", [])
        if isinstance(row, dict)
    }
    required_context_ids = {
        row.get("contextQualifierId")
        for row in mappings
        if row.get("claimId") in claims_by_id and claims_by_id[row["claimId"]].get("requiredQualifier")
    }
    for context_id in sorted(required_context_ids):
        context = contexts_by_id.get(context_id)
        if not context:
            blockers.append(f"{context_id}: selected claim has no per-asset qualifier review")
            continue
        if context.get("reviewStatus") != "approved" or context.get("releaseDisposition") != "approved_for_selected_collateral":
            blockers.append(f"{context_id}: selected per-asset qualifier review is pending or blocked")
        if not context.get("reviewer") or not context.get("reviewDate"):
            blockers.append(f"{context_id}: selected qualifier approval lacks reviewer/date")

    record_by_id = {row.get("assetId"): row for row in register.get("records", []) if isinstance(row, dict)}
    required_record_ids = {row.get("provenanceRecordId") for row in mappings if row.get("provenanceRecordId")}
    required_record_ids.update(composition_records)
    relevant_kinds = {
        "editable_visual_source", "synthetic_mockup_source", "visual_export",
        "accessible_text_alternative", "accessible_synthetic_fixture_alternative",
        "static_html_rehearsal_support",
    }
    destination_requirements = _destination_requirements(
        selected_asset_ids, record_by_id,
        include_derivatives=True,
        relevant_kinds=relevant_kinds,
    )
    queue = list(required_record_ids)
    seen: set[str] = set()
    while queue:
        record_id = queue.pop()
        if record_id in seen:
            continue
        seen.add(record_id)
        record = record_by_id.get(record_id)
        if not record:
            blockers.append(f"{record_id}: selected provenance record is missing")
            continue
        if record.get("kind") not in relevant_kinds:
            continue
        for parent_id in record.get("lineage", {}).get("derivedFrom", []):
            if record_by_id.get(parent_id, {}).get("kind") in relevant_kinds:
                queue.append(parent_id)
        for child_id in record.get("lineage", {}).get("derivatives", []):
            if record_by_id.get(child_id, {}).get("kind") in relevant_kinds:
                queue.append(child_id)
        for dependency_id in record.get("compositionDependencies", []):
            if dependency_id in record_by_id:
                queue.append(dependency_id)
        if record.get("publishability") != "approved" or record.get("permission", {}).get("status") != "approved":
            blockers.append(f"{record_id}: selected destination rights/publishability are not approved")
        if not record.get("reviewer") or not record.get("reviewDate"):
            blockers.append(f"{record_id}: selected source/export review lacks reviewer/date")
        allowed = record.get("allowedDestinations")
        approved = record.get("permission", {}).get("approvedDestinations")
        if not _destination_scope_covered(allowed, approved):
            reason = "permission does not cover every allowed destination" if allowed and approved else "selected record has no explicit approved destination"
            blockers.append(f"{record_id}: {reason}")
        required_destinations = destination_requirements.get(record_id, set())
        approved_destinations = set(approved) if isinstance(approved, list) else set()
        missing_destinations = sorted(required_destinations - approved_destinations)
        if missing_destinations:
            blockers.append(
                f"{record_id}: selected source/export permission does not approve intended destination(s): "
                f"{', '.join(missing_destinations)}"
            )
    return blockers


def submission_blockers(
    ledger: dict[str, Any],
    register: dict[str, Any],
    selected_asset_ids: list[str] | tuple[str, ...],
    inventory: dict[str, Any] | None = None,
) -> list[str]:
    """Require selected content plus the explicit final-event deliverables and producer gates."""
    blockers = selected_collateral_blockers(ledger, register, selected_asset_ids)
    if blockers and blockers[0].startswith(("selected collateral scope", "unknown or nonselectable")):
        return blockers
    if inventory is None:
        inventory = _read_json(ROOT / "docs/collateral-inventory.json")
    scope = inventory.get("submissionScope", {})
    if not isinstance(scope, dict):
        scope = {}
    for field in ("requiredAssetIds", "requiredClaimIds", "requiredEvidenceClassIds", "requiredOwnerGates"):
        if not isinstance(scope.get(field), list) or not scope.get(field):
            blockers.append(f"submission scope is incomplete: {field} must be explicitly populated")
    immutable_scope = {
        "requiredAssetIds": REQUIRED_SUBMISSION_ASSET_IDS,
        "requiredClaimIds": REQUIRED_SUBMISSION_CLAIM_IDS,
        "requiredEvidenceClassIds": REQUIRED_SUBMISSION_EVIDENCE_CLASS_IDS,
    }
    scoped_values: dict[str, list[str]] = {}
    for field, required_ids in immutable_scope.items():
        values = scope.get(field, [])
        if not isinstance(values, list) or not all(isinstance(item, str) for item in values):
            values = []
        scoped_values[field] = values
        for missing_id in sorted(set(required_ids) - set(values)):
            blockers.append(f"submission scope omits immutable required {field.removeprefix('required').removesuffix('Ids').lower()} {missing_id}")
    gates = scope.get("requiredOwnerGates", [])
    if not isinstance(gates, list):
        gates = []
    deliverables = {row.get("assetId"): row for row in inventory.get("plannedDeliverables", []) if isinstance(row, dict)}
    tracked = {row.get("path"): row for row in inventory.get("trackedFiles", []) if isinstance(row, dict)}
    provenance_by_id = {row.get("assetId"): row for row in register.get("records", []) if isinstance(row, dict)}
    required_output_record_ids: list[str] = []
    selected = set(selected_asset_ids)
    for asset_id in dict.fromkeys((*REQUIRED_SUBMISSION_ASSET_IDS, *scoped_values["requiredAssetIds"])):
        row = deliverables.get(asset_id)
        if not row:
            blockers.append(f"submission asset {asset_id}: missing from inventory")
            continue
        if asset_id in SELECTABLE_COLLATERAL_ASSET_IDS and asset_id not in selected:
            blockers.append(f"submission asset {asset_id}: required collateral was not selected")
        path_text = row.get("path")
        output_exists = isinstance(path_text, str) and (ROOT / path_text).is_file()
        if not output_exists:
            blockers.append(f"submission asset {asset_id}: required output is absent ({path_text})")
        else:
            indexed = tracked.get(path_text, {})
            if row.get("pathAvailability") not in {"tracked_at_baseline", "created_in_candidate"} or row.get("lifecycleState") != "released" or indexed.get("releaseEligible") is not True:
                blockers.append(f"submission asset {asset_id}: exact output is not inventoried as released/eligible")

        output_record_ids = row.get("provenanceRecordIds")
        if not isinstance(output_record_ids, list) or output_record_ids != [asset_id]:
            blockers.append(f"submission asset {asset_id}: requires one canonical exact-output provenanceRecordIds entry")
            continue
        output_record = provenance_by_id.get(asset_id)
        if not output_record:
            blockers.append(f"submission asset {asset_id}: canonical exact-output provenance record is missing")
            continue
        source = output_record.get("source", {})
        if not isinstance(source, dict) or source.get("path") != path_text:
            blockers.append(f"submission asset {asset_id}: canonical provenance source path does not match the required output")
        required_output_record_ids.append(asset_id)

    claims_by_id = {row.get("id"): row for row in ledger.get("claims", []) if isinstance(row, dict)}
    evidence_by_id = {row.get("id"): row for row in ledger.get("evidenceClasses", []) if isinstance(row, dict)}
    for claim_id in dict.fromkeys((*REQUIRED_SUBMISSION_CLAIM_IDS, *scoped_values["requiredClaimIds"])):
        claim = claims_by_id.get(claim_id)
        if not claim:
            blockers.append(f"required submission claim {claim_id}: missing from claim ledger")
        elif claim.get("reviewStatus") != "approved" or claim.get("state") in {"blocked", "planned", "assumed"} or not claim.get("source", {}).get("revision"):
            blockers.append(f"required submission claim {claim_id}: product/evidence approval is not complete")
    for evidence_id in dict.fromkeys((*REQUIRED_SUBMISSION_EVIDENCE_CLASS_IDS, *scoped_values["requiredEvidenceClassIds"])):
        evidence = evidence_by_id.get(evidence_id)
        if not evidence or evidence.get("status") != "approved":
            blockers.append(f"required submission evidence {evidence_id}: producer evidence is not approved")
    for gate in gates:
        if not isinstance(gate, dict):
            blockers.append("required submission owner gate is malformed")
            continue
        gate_id = gate.get("id", "unknown-owner-gate")
        if gate.get("status") != "approved" or not gate.get("reviewer") or not gate.get("reviewDate") or not gate.get("evidenceRef"):
            blockers.append(f"required submission owner gate {gate_id}: source-owner/organizer confirmation is pending")
    gate_ids = {gate.get("id") for gate in scope.get("requiredOwnerGates", []) if isinstance(gate, dict)}
    for required_gate in ("BRAND-CONSUMPTION-001", "ORGANIZER-RULES-AND-CUTOFF-001"):
        if required_gate not in gate_ids:
            blockers.append(f"required submission owner gate {required_gate}: missing from submission scope")
    if register.get("visualReview", {}).get("independentReview") != "passed":
        blockers.append("required submission review: independent visual/content/accessibility review is pending")
    if register.get("visualReview", {}).get("brandAndSourceOwnerRights") != "approved":
        blockers.append("required submission rights gate: brand/source-owner destination rights are not approved")
    blockers.extend(_submission_provenance_rights_blockers(required_output_record_ids, provenance_by_id))
    return blockers


def _submission_provenance_rights_blockers(
    output_record_ids: list[str], provenance_by_id: dict[str, dict[str, Any]],
) -> list[str]:
    """Require destination approval for each required output and every declared source input."""
    blockers: list[str] = []
    destination_requirements = _destination_requirements(
        output_record_ids, provenance_by_id, include_derivatives=False,
    )
    queue = list(output_record_ids)
    seen: set[str] = set()
    while queue:
        record_id = queue.pop()
        if record_id in seen:
            continue
        seen.add(record_id)
        record = provenance_by_id.get(record_id)
        if not record:
            blockers.append(f"{record_id}: required submission provenance record is missing")
            continue
        permission = record.get("permission", {})
        if record.get("publishability") != "approved" or permission.get("status") != "approved":
            blockers.append(f"{record_id}: required output/source provenance destination rights are not approved")
        if not record.get("reviewer") or not record.get("reviewDate"):
            blockers.append(f"{record_id}: required output/source provenance review lacks reviewer/date")
        if not _destination_scope_covered(record.get("allowedDestinations"), permission.get("approvedDestinations")):
            blockers.append(f"{record_id}: required output/source permission does not cover every allowed destination")
        approved_destinations = permission.get("approvedDestinations")
        approved_set = set(approved_destinations) if isinstance(approved_destinations, list) else set()
        missing_destinations = sorted(destination_requirements.get(record_id, set()) - approved_set)
        if missing_destinations:
            blockers.append(
                f"{record_id}: required output/source permission does not approve intended destination(s): "
                f"{', '.join(missing_destinations)}"
            )
        source = record.get("source", {})
        if not isinstance(source, dict) or not source.get("path") or not source.get("revision") or not _pinned_revision(source):
            blockers.append(f"{record_id}: required output/source provenance is not immutably pinned")
        elif source.get("repo") == "Jevelopers-neatHack-2026/marketing-material":
            source_path = source["path"]
            exact_path = ROOT / source_path
            checksum = record.get("checksum", {})
            if (
                not _is_tracked_repo_file(source_path)
                or not isinstance(checksum, dict)
                or checksum.get("algorithm") != "SHA-256"
                or checksum.get("value") != _sha256_path(exact_path)
            ):
                blockers.append(f"{record_id}: required output/source provenance path or checksum is not exact")
        lineage = record.get("lineage", {})
        parent_ids = lineage.get("derivedFrom", []) if isinstance(lineage, dict) else []
        composition_ids = record.get("compositionDependencies", [])
        for relation_name, relation_ids in (("lineage.derivedFrom", parent_ids), ("compositionDependencies", composition_ids)):
            if not isinstance(relation_ids, list) or not all(isinstance(item, str) for item in relation_ids):
                blockers.append(f"{record_id}: {relation_name} must be an array of provenance record IDs")
                continue
            queue.extend(relation_ids)
    return blockers


def release_blockers(ledger: dict[str, Any], register: dict[str, Any]) -> list[str]:
    """Backward-compatible alias for final-submission readiness over the default visual set."""
    return submission_blockers(ledger, register, DEFAULT_SUBMISSION_SELECTION)


def validate_all(
    ledger: dict[str, Any],
    register: dict[str, Any],
    fixture: dict[str, Any],
    handoff: dict[str, Any] | None = None,
    inventory: dict[str, Any] | None = None,
) -> list[str]:
    errors = validate_claims(ledger)
    errors.extend(validate_provenance(register))
    errors.extend(validate_fixture(fixture, ledger))
    if handoff is None:
        handoff = _read_json(ROOT / "review/visual/asset-handoff.json")
    errors.extend(validate_visual_copy(ledger, handoff, register))
    if inventory is None:
        inventory = _read_json(ROOT / "docs/collateral-inventory.json")
    errors.extend(validate_inventory(inventory))
    errors.extend(validate_inventory_composition(inventory, register))
    errors.extend(validate_inventory_provenance(inventory, register))
    errors.extend(validate_narrative_copy(ledger, register, inventory))
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("draft", "selected", "submission", "release"), default="draft")
    parser.add_argument("--select", action="append", dest="selected_assets", metavar="ASSET_ID", help="asset to evaluate; repeat for a multi-asset scope")
    parser.add_argument("--claims", type=Path, default=ROOT / "messaging/claims.json")
    parser.add_argument("--provenance", type=Path, default=ROOT / "review/provenance.json")
    parser.add_argument("--fixture", type=Path, default=ROOT / "review/fixtures/synthetic-canaries.json")
    parser.add_argument("--handoff", type=Path, default=ROOT / "review/visual/asset-handoff.json")
    parser.add_argument("--inventory", type=Path, default=ROOT / "docs/collateral-inventory.json")
    args = parser.parse_args(argv)

    if args.mode in {"selected", "submission"} and not args.selected_assets:
        print("ERROR: selected and submission modes require at least one --select ASSET_ID", file=sys.stderr)
        return 1
    selected_assets = args.selected_assets or DEFAULT_SUBMISSION_SELECTION
    if args.mode in {"selected", "submission", "release"}:
        selection_errors = _selection_errors(selected_assets)
        if selection_errors:
            for error in selection_errors:
                print(f"ERROR: {error}", file=sys.stderr)
            return 1

    try:
        ledger = _read_json(args.claims)
        register = _read_json(args.provenance)
        fixture = _read_json(args.fixture)
        handoff = _read_json(args.handoff)
        inventory = _read_json(args.inventory)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"invalid input: {exc}", file=sys.stderr)
        return 1

    errors = validate_all(ledger, register, fixture, handoff, inventory)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print("Draft policy validation: PASS (claims, provenance/checksum pins, copy joins, full tracked-file inventory, and synthetic text canary)")
    print("Visual evidence: scoped author SVG/PNG pixel and metadata checks, browser renders, contrast, and alternatives are recorded; this validator does not scan arbitrary media or grant rights.")
    if args.mode in {"selected", "submission", "release"}:
        if args.mode == "selected":
            blockers = selected_collateral_blockers(ledger, register, selected_assets)
            mode_name = "Selected collateral"
        else:
            blockers = submission_blockers(ledger, register, selected_assets, inventory)
            mode_name = "Final submission" if args.mode == "submission" else "Final submission (legacy --mode release alias)"
        for blocker in blockers:
            print(f"BLOCKED: {blocker}")
        print(f"{mode_name} readiness: {'BLOCKED' if blockers else 'READY'} ({len(blockers)} blockers)")
        return 2 if blockers else 0

    print("Readiness: not evaluated; use --mode selected --select ASSET_ID or --mode submission --select ASSET_ID")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
