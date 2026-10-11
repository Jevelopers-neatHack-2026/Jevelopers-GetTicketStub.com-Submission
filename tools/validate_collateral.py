#!/usr/bin/env python3
"""Validate claim/provenance policy records and a synthetic text-only canary.

This command checks JSON and copy policy. It does not inspect or redact media,
rendered pixels, embedded office metadata, audio/video, or linked destinations.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
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
SELECTABLE_COLLATERAL_ASSET_IDS = {
    "DEMO-WORKFLOW-DIAGRAM-001",
    "DEMO-SCREENSHOT-SET-001",
    "DEMO-DECK-SUPPORT-001",
    "LAUNCH-X-KEY-VISUAL-001",
    "LAUNCH-X-ALT-TEXT-001",
}
DEFAULT_SUBMISSION_SELECTION = sorted(SELECTABLE_COLLATERAL_ASSET_IDS)
REQUIRED_SUBMISSION_CLAIM_IDS = (
    "CLAIM-PRODUCT-CAPABILITY-001",
    "CLAIM-EVAL02-COMPARISON-001",
    "CLAIM-SPN-01-NEATLOGS-001",
    "CLAIM-SPN-02-ENTIRE-001",
    "CLAIM-SPN-03-CFO-001",
)
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
            if not row.get("allowedDestinations"):
                errors.append(f"{identifier}: public approval requires an explicit destination")
    if "PROV-SYNTHETIC-CANARY-001" not in ids:
        errors.append("required synthetic canary provenance record is missing")
    errors.extend(validate_provenance_lineage(register))
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


def validate_inventory(inventory: dict[str, Any]) -> list[str]:
    """Check exact tracked-file coverage, stable IDs, availability, lifecycle, and checksums."""
    errors: list[str] = []
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
        if row.get("lifecycleState") is None or row.get("releaseEligible") is not False:
            errors.append(f"{path_text}: lifecycle/release eligibility must be explicit")
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


def _expand_selected_assets(
    ledger: dict[str, Any], register: dict[str, Any], selected_asset_ids: list[str] | tuple[str, ...]
) -> set[str]:
    selected = set(selected_asset_ids)
    mappings = ledger.get("visualCopy", {}).get("mappings", [])
    records = {row.get("assetId"): row for row in register.get("records", []) if isinstance(row, dict)}
    contexts = ledger.get("visualCopy", {}).get("qualifierContexts", [])
    changed = True
    while changed:
        before = set(selected)
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
        changed = before != selected
    return selected


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
    selected = _expand_selected_assets(ledger, register, selected_asset_ids)
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
    relevant_kinds = {"editable_visual_source", "synthetic_mockup_source", "visual_export", "accessible_text_alternative", "static_html_rehearsal_support"}
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
        if record.get("publishability") != "approved" or record.get("permission", {}).get("status") != "approved":
            blockers.append(f"{record_id}: selected destination rights/publishability are not approved")
        if not record.get("reviewer") or not record.get("reviewDate"):
            blockers.append(f"{record_id}: selected source/export review lacks reviewer/date")
        if not record.get("allowedDestinations") or not record.get("permission", {}).get("approvedDestinations"):
            blockers.append(f"{record_id}: selected record has no explicit approved destination")
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
    for field in ("requiredAssetIds", "requiredClaimIds", "requiredEvidenceClassIds", "requiredOwnerGates"):
        if not isinstance(scope.get(field), list) or not scope.get(field):
            blockers.append(f"submission scope is incomplete: {field} must be explicitly populated")
    deliverables = {row.get("assetId"): row for row in inventory.get("plannedDeliverables", []) if isinstance(row, dict)}
    tracked = {row.get("path"): row for row in inventory.get("trackedFiles", []) if isinstance(row, dict)}
    selected = set(selected_asset_ids)
    for asset_id in scope.get("requiredAssetIds", []):
        row = deliverables.get(asset_id)
        if not row:
            blockers.append(f"submission asset {asset_id}: missing from inventory")
            continue
        if asset_id in SELECTABLE_COLLATERAL_ASSET_IDS and asset_id not in selected:
            blockers.append(f"submission asset {asset_id}: required collateral was not selected")
        path_text = row.get("path")
        if not isinstance(path_text, str) or not (ROOT / path_text).is_file():
            blockers.append(f"submission asset {asset_id}: required output is absent ({path_text})")
            continue
        indexed = tracked.get(path_text, {})
        if row.get("pathAvailability") not in {"tracked_at_baseline", "created_in_candidate"} or row.get("lifecycleState") != "released" or indexed.get("releaseEligible") is not True:
            blockers.append(f"submission asset {asset_id}: exact output is not inventoried as released/eligible")

    claims_by_id = {row.get("id"): row for row in ledger.get("claims", []) if isinstance(row, dict)}
    evidence_by_id = {row.get("id"): row for row in ledger.get("evidenceClasses", []) if isinstance(row, dict)}
    for claim_id in scope.get("requiredClaimIds", []):
        claim = claims_by_id.get(claim_id)
        if not claim:
            blockers.append(f"required submission claim {claim_id}: missing from claim ledger")
        elif claim.get("reviewStatus") != "approved" or claim.get("state") in {"blocked", "planned", "assumed"} or not claim.get("source", {}).get("revision"):
            blockers.append(f"required submission claim {claim_id}: product/evidence approval is not complete")
    for evidence_id in scope.get("requiredEvidenceClassIds", []):
        evidence = evidence_by_id.get(evidence_id)
        if not evidence or evidence.get("status") != "approved":
            blockers.append(f"required submission evidence {evidence_id}: producer evidence is not approved")
    for gate in scope.get("requiredOwnerGates", []):
        gate_id = gate.get("id", "unknown-owner-gate")
        if gate.get("status") != "approved" or not gate.get("reviewer") or not gate.get("reviewDate") or not gate.get("evidenceRef"):
            blockers.append(f"required submission owner gate {gate_id}: source-owner/organizer confirmation is pending")
    gate_ids = {gate.get("id") for gate in scope.get("requiredOwnerGates", []) if isinstance(gate, dict)}
    for required_gate in ("BRAND-CONSUMPTION-001", "ORGANIZER-RULES-AND-CUTOFF-001"):
        if required_gate not in gate_ids:
            blockers.append(f"required submission owner gate {required_gate}: missing from submission scope")
    if register.get("visualReview", {}).get("independentReview") != "passed":
        blockers.append("required submission review: independent visual/content/accessibility review is pending")
    if str(register.get("visualReview", {}).get("brandAndSourceOwnerRights", "")).startswith("pending"):
        blockers.append("required submission rights gate: brand/source-owner destination rights are pending")
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
