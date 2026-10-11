#!/usr/bin/env python3
"""Validate claim/provenance policy records and a synthetic text-only canary.

This command checks JSON and copy policy. It does not inspect or redact media,
rendered pixels, embedded office metadata, audio/video, or linked destinations.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


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


def release_blockers(ledger: dict[str, Any], register: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    if ledger.get("status") != "approved":
        blockers.append("MM-02 claim ledger is draft/unapproved")
    for row in ledger.get("claims", []):
        if row.get("reviewStatus") != "approved":
            blockers.append(f"{row.get('id')}: exact-copy review is not approved")
        if not isinstance(row.get("source", {}).get("revision"), str):
            blockers.append(f"{row.get('id')}: source revision is not immutably pinned")
        if row.get("state") in {"blocked", "planned", "assumed"}:
            blockers.append(f"{row.get('id')}: claim state is {row.get('state')}")
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
    for row in register.get("records", []):
        if row.get("publishability") != "approved":
            blockers.append(f"{row.get('assetId')}: publishability is {row.get('publishability')}")
        if row.get("permission", {}).get("status") != "approved":
            blockers.append(f"{row.get('assetId')}: destination permission is not approved")
        if not row.get("reviewDate") or not row.get("reviewer"):
            blockers.append(f"{row.get('assetId')}: independent publication review is missing")
    blockers.extend(
        [
            "MM-05-B: this text/JSON canary does not establish pixel redaction or rendered metadata/notes inspection.",
            "MM-05-A: no visual/media asset has destination-specific rights approval in this register.",
        ]
    )
    return blockers


def validate_all(ledger: dict[str, Any], register: dict[str, Any], fixture: dict[str, Any]) -> list[str]:
    errors = validate_claims(ledger)
    errors.extend(validate_provenance(register))
    errors.extend(validate_fixture(fixture, ledger))
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("draft", "release"), default="draft")
    parser.add_argument("--claims", type=Path, default=ROOT / "messaging/claims.json")
    parser.add_argument("--provenance", type=Path, default=ROOT / "review/provenance.json")
    parser.add_argument("--fixture", type=Path, default=ROOT / "review/fixtures/synthetic-canaries.json")
    args = parser.parse_args(argv)

    try:
        ledger = _read_json(args.claims)
        register = _read_json(args.provenance)
        fixture = _read_json(args.fixture)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"invalid input: {exc}", file=sys.stderr)
        return 1

    errors = validate_all(ledger, register, fixture)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print("Draft policy validation: PASS (claims, provenance schema, distinct sponsor evidence, and synthetic text canary)")
    print("Media/pixel/metadata inspection: NOT PERFORMED by this text/JSON validator")
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
