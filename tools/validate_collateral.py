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
        if row.get("wordingReview") == "approved" and availability.get("status") != "confirmed_for_pinned_documentation_only":
            errors.append(f"{identifier}: CTA wording cannot be approved with unavailable/unconfirmed destination")
        if row.get("wordingReview") == "approved" and row.get("routeReview") != "confirmed_by_assigned_supervisor_for_repository_docs_only":
            errors.append(f"{identifier}: CTA cannot be approved without destination-owner confirmation")
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

    for path_text in sorted({row.get("path") for row in mappings if isinstance(row, dict) and row.get("path")}):
        try:
            actual = _extract_copy_units(ROOT / path_text)
        except (OSError, ET.ParseError) as exc:
            errors.append(f"visual source copy cannot be extracted for {path_text}: {exc}")
            continue
        for surface in {surface for _, surface in actual}:
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
        if context.get("reviewStatus") != "pending_independent_exact_copy_review" or context.get("releaseDisposition") != "blocked":
            errors.append(f"{context_id}: qualifier context must remain pending and release-blocked")
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
    return errors


def release_blockers(ledger: dict[str, Any], register: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    if ledger.get("status") != "approved":
        blockers.append("MM-02 claim ledger is draft/unapproved")
    visual_copy_pending = 0
    for row in ledger.get("claims", []):
        if row.get("id", "").startswith("CLAIM-VISUAL-COPY-"):
            if row.get("reviewStatus") != "approved":
                visual_copy_pending += 1
            continue
        if row.get("reviewStatus") != "approved":
            blockers.append(f"{row.get('id')}: exact-copy review is not approved")
        if not isinstance(row.get("source", {}).get("revision"), str):
            blockers.append(f"{row.get('id')}: source revision is not immutably pinned")
        if row.get("state") in {"blocked", "planned", "assumed"}:
            blockers.append(f"{row.get('id')}: claim state is {row.get('state')}")
    if visual_copy_pending:
        blockers.append(f"{visual_copy_pending} exact visual/HTML/alternative copy rows await independent exact-copy review")
    for row in ledger.get("evidenceClasses", []):
        if row.get("status") != "approved":
            blockers.append(f"{row.get('id')}: source evidence remains {row.get('status')}")
    for row in ledger.get("ctas", []):
        if row.get("wordingReview") != "approved":
            blockers.append(f"{row.get('id')}: exact CTA wording is not approved")
        if row.get("availability", {}).get("status") != "confirmed_for_pinned_documentation_only":
            blockers.append(f"{row.get('id')}: target availability is not confirmed")
        if not row.get("target"):
            blockers.append(f"{row.get('id')}: destination target is missing")
    if register.get("status") != "approved":
        blockers.append("MM-05 provenance register is draft/unapproved")
    visual_rights_pending: list[str] = []
    for row in register.get("records", []):
        if row.get("kind") in {
            "editable_visual_source",
            "synthetic_mockup_source",
            "visual_export",
            "accessible_text_alternative",
            "static_html_rehearsal_support",
        }:
            if row.get("publishability") != "approved" or row.get("permission", {}).get("status") != "approved":
                visual_rights_pending.append(row.get("assetId", "unknown-asset"))
            continue
        if row.get("kind") in {
            "synthetic_fixture",
            "sanitized_synthetic_fixture",
            "accessible_synthetic_fixture_alternative",
            "internal_render_preview",
            "verification_evidence",
            "accessibility_evidence",
            "renderer_tooling",
            "validation_test",
        }:
            continue
        if row.get("publishability") != "approved":
            blockers.append(f"{row.get('assetId')}: publishability is {row.get('publishability')}")
        if row.get("permission", {}).get("status") != "approved":
            blockers.append(f"{row.get('assetId')}: destination permission is not approved")
        if not row.get("reviewDate") or not row.get("reviewer"):
            blockers.append(f"{row.get('assetId')}: independent publication review is missing")
    if visual_rights_pending:
        blockers.append(
            "MM-05-A: destination-specific rights approval is pending for visual sources/exports/alternatives: "
            + ", ".join(visual_rights_pending)
        )
    visual_review = register.get("visualReview", {})
    if not visual_review:
        blockers.append("MM-05-B: exact visual-format inspection evidence is missing")
    else:
        if visual_review.get("independentReview") != "passed":
            blockers.append("MM-05-B: independent visual/content/accessibility review is pending")
        if visual_review.get("brandAndSourceOwnerRights", "").startswith("pending"):
            blockers.append("MM-05-A: visual/media destination-specific rights and brand/source-owner approval remain pending")
        for expected in ("SVG", "PNG", "HTML", "Markdown accessible alternatives", "audio/video", "office/deck exports"):
            if not any(row.get("format") == expected for row in visual_review.get("formats", []) if isinstance(row, dict)):
                blockers.append(f"MM-05-B: format-aware review record is missing for {expected}")
    return blockers


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
    parser.add_argument("--mode", choices=("draft", "release"), default="draft")
    parser.add_argument("--claims", type=Path, default=ROOT / "messaging/claims.json")
    parser.add_argument("--provenance", type=Path, default=ROOT / "review/provenance.json")
    parser.add_argument("--fixture", type=Path, default=ROOT / "review/fixtures/synthetic-canaries.json")
    parser.add_argument("--handoff", type=Path, default=ROOT / "review/visual/asset-handoff.json")
    parser.add_argument("--inventory", type=Path, default=ROOT / "docs/collateral-inventory.json")
    args = parser.parse_args(argv)

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
    if args.mode == "release":
        blockers = release_blockers(ledger, register)
        for blocker in blockers:
            print(f"BLOCKED: {blocker}")
        print(f"Release readiness: BLOCKED ({len(blockers)} blockers)")
        return 2 if blockers else 0

    print("Release readiness: BLOCKED; run --mode release for the current blocker list")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
