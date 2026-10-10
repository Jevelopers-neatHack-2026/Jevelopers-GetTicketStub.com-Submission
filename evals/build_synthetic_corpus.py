#!/usr/bin/env python3
"""Materialize the small authored smoke fixtures; never synthesize benchmark rows."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "evals" / "corpus"
AUTHORED = CORPUS / "authored-cases.jsonl"
POLICY = ROOT / "evals" / "policies" / "promotion-v1.json"
CORPUS_VERSION = "jev-ei-synthetic-smoke-fixture-1.0.0"
LABEL_STATUS = "author_authored_synthetic_expectation_not_independently_adjudicated"
FAMILIES = (
    "ordinary", "sparse_dynamic", "unsupported", "no_answer",
    "identity_edition_conflict", "changed_date_venue", "multilingual_noisy",
    "hostile_url_content", "wrong_assets_stale_rights", "cache_provider_outage",
)


def stable_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            raise ValueError(f"{path}:{line_number}: blank row")
        row = json.loads(line)
        if not isinstance(row, dict):
            raise ValueError(f"{path}:{line_number}: each row must be an object")
        rows.append(row)
    return rows


def load_authored() -> tuple[list[dict[str, Any]], list[str]]:
    cases = read_jsonl(AUTHORED)
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    question_ids = [row["id"] for row in policy["required_questions"]]
    seen: set[str] = set()
    for case in cases:
        case_id = case.get("case_id")
        if not isinstance(case_id, str) or not case_id or case_id in seen:
            raise ValueError(f"duplicate or invalid case_id: {case_id!r}")
        seen.add(case_id)
        if case.get("split") not in ("calibration", "held_out"):
            raise ValueError(f"{case_id}: split must be calibration or held_out")
        if case.get("scenario_family") not in FAMILIES:
            raise ValueError(f"{case_id}: unknown scenario family")
        if not all(isinstance(case.get(field), str) and case[field].strip() for field in (
            "language", "fictional_event_name", "source_type_observation", "content", "asset_description",
        )):
            raise ValueError(f"{case_id}: required authored text is missing")
        if "untrusted_excerpt" not in case or (case["untrusted_excerpt"] is not None and not isinstance(case["untrusted_excerpt"], str)):
            raise ValueError(f"{case_id}: untrusted_excerpt must be a string or null")
        labels = case.get("labels")
        if not isinstance(labels, dict) or set(labels) != set(question_ids):
            raise ValueError(f"{case_id}: author must provide exactly the seven versioned question labels")
    if not cases:
        raise ValueError("authored fixture file is empty")
    if {row["scenario_family"] for row in cases if row["split"] == "held_out"} != set(FAMILIES):
        raise ValueError("authored held-out smoke fixtures must represent all ten required families")
    if {row["scenario_family"] for row in cases if row["split"] == "calibration"} != set(FAMILIES):
        raise ValueError("authored calibration smoke fixtures must represent all ten required families")
    return cases, question_ids


def materialize(cases: list[dict[str, Any]], question_ids: list[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    observations: list[dict[str, Any]] = []
    labels: list[dict[str, Any]] = []
    assignments: list[dict[str, Any]] = []
    for case in cases:
        case_id = case["case_id"]
        observation = {
            "case_id": case_id,
            "split": case["split"],
            "scenario_family": case["scenario_family"],
            # These are case-scoped fixture IDs, not adjudicated real-world lineages.
            "source_family_id": f"authored-case:{case_id}:source",
            "event_family_id": f"authored-case:{case_id}:event",
            "template_family_id": f"authored-case:{case_id}:template",
            "lineage_scope": "case_scoped_fixture_ids_only_no_real_world_independence_claim",
            "language": case["language"],
            "fictional_event_name": case["fictional_event_name"],
            "source_type_observation": case["source_type_observation"],
            "content": case["content"],
            "asset_description": case["asset_description"],
            "untrusted_excerpt": case["untrusted_excerpt"],
            "fixture_only": True,
            "privacy_classification": "synthetic_no_personal_data",
            "permission_classification": "synthetic_original_text_no_external_asset",
            "asset_rights_status": "synthetic_text_only_no_reproduction_rights_claimed",
            "adjudication_status": LABEL_STATUS,
            "evidence_ref": f"fixture://synthetic-smoke/{case_id}",
        }
        observations.append(observation)
        labels.append({"case_id": case_id, "labels": {qid: case["labels"][qid] for qid in question_ids}})
        assignments.append({
            "case_id": case_id,
            "split": case["split"],
            "scenario_family": case["scenario_family"],
            "source_family_id": observation["source_family_id"],
            "event_family_id": observation["event_family_id"],
            "template_family_id": observation["template_family_id"],
        })
    return observations, labels, assignments


def write_json(path: Path, value: Any) -> bytes:
    data = stable_bytes(value)
    path.write_bytes(data)
    return data


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> bytes:
    data = b"".join(stable_bytes(row) for row in rows)
    path.write_bytes(data)
    return data


def main() -> None:
    cases, question_ids = load_authored()
    observations, labels, assignments = materialize(cases, question_ids)
    CORPUS.mkdir(parents=True, exist_ok=True)
    authored_bytes = AUTHORED.read_bytes()
    observations_bytes = write_jsonl(CORPUS / "observations.jsonl", observations)
    labels_bytes = write_jsonl(CORPUS / "labels.jsonl", labels)
    counts = Counter(row["split"] for row in cases)
    family_counts: dict[str, dict[str, int]] = {
        family: {
            split: sum(row["scenario_family"] == family and row["split"] == split for row in cases)
            for split in ("calibration", "held_out")
        }
        for family in FAMILIES
    }
    language_counts = Counter(
        row["language"].split("-")[0].lower()
        for row in cases if row["split"] == "held_out" and row["language"].split("-")[0].lower() != "en"
    )
    non_english_count = sum(language_counts.values())
    assignment_fields = (
        "case_id", "split", "scenario_family", "source_family_id", "event_family_id", "template_family_id",
    )
    assignment_text = "\n".join("|".join(str(row.get(field, "")) for field in assignment_fields) for row in assignments) + "\n"
    assignment_hash = digest(assignment_text.encode("utf-8"))
    lock = {
        "corpus_version": CORPUS_VERSION,
        "lock_version": "1.0.0",
        "locked": True,
        "selection_method": "explicit_case_by_case_authorship_no_random_sampling_or_count_padding",
        "threshold_selection_split": "calibration",
        "held_out_policy": "one_predeclared_comparison_after_all_pins_are_frozen; never_tune_on_held_out",
        "split_counts": {split: counts.get(split, 0) for split in ("calibration", "held_out")},
        "source_cases_sha256": digest(authored_bytes),
        "observations_sha256": digest(observations_bytes),
        "labels_sha256": digest(labels_bytes),
        "assignment_sha256": assignment_hash,
        "case_assignments": assignments,
        "held_out_usage": {"status": "not_consumed", "evaluation_runs": []},
        "change_control": "Any membership change requires a new corpus and lock version, impact record, and Agent and research plus Finance and reliability review. Smoke fixture IDs do not certify real-world family independence.",
    }
    lock_bytes = write_json(CORPUS / "split-lock.json", lock)
    manifest = {
        "manifest_version": "1.0.0",
        "corpus_version": CORPUS_VERSION,
        "dataset_mode": "synthetic_smoke_fixture_only",
        "benchmark_eligible": False,
        "notice": "Small author-authored software smoke fixtures only. Expectations are not independently adjudicated, family IDs are case scoped, and these fixtures do not measure real-world quality or qualify a benchmark.",
        "label_provenance": LABEL_STATUS,
        "lineage_review": "case_scoped_fixture_ids_only_no_real_world_independence_claim; independent family audit unavailable",
        "minimums": {
            "calibration_cases": 120,
            "held_out_cases": 240,
            "held_out_cases_per_scenario_family": 20,
            "held_out_non_english_cases": 40,
            "held_out_non_english_languages": 4,
            "held_out_requires_cjk": True,
        },
        "case_counts": {split: counts.get(split, 0) for split in ("calibration", "held_out")},
        "required_scenario_family_counts": family_counts,
        "non_english_held_out": {
            "actual": non_english_count,
            "minimum": 40,
            "languages": sorted(language_counts),
            "language_counts": dict(sorted(language_counts.items())),
            "required_language_count": 4,
            "includes_cjk": any(language in {"ja", "zh", "ko"} for language in language_counts),
            "requires_cjk": True,
        },
        "admission": {
            "owner": "Agent and research",
            "reviewer": None,
            "external_sources": 0,
            "customer_records": 0,
            "image_or_asset_bytes": 0,
            "personal_data": "none_by_construction",
            "permission_review": "synthetic_text_only_no_external_asset; independent_owner_audit_pending",
            "privacy_review": "synthetic_no_personal_data; independent_owner_audit_pending",
            "label_adjudication": LABEL_STATUS,
            "family_independence": "not_established; case-scoped synthetic IDs only",
        },
        "artifacts": {
            "authored_cases": {"path": "authored-cases.jsonl", "sha256": digest(authored_bytes)},
            "observations": {"path": "observations.jsonl", "sha256": digest(observations_bytes)},
            "labels": {"path": "labels.jsonl", "sha256": digest(labels_bytes)},
            "split_lock": {"path": "split-lock.json", "sha256": digest(lock_bytes)},
        },
        "split_lock": {
            "path": "split-lock.json",
            "lock_version": lock["lock_version"],
            "assignment_sha256": assignment_hash,
            "held_out_consumed": False,
        },
    }
    write_json(CORPUS / "manifest.json", manifest)
    print(f"Wrote {len(cases)} author-authored smoke fixtures ({counts['calibration']} calibration, {counts['held_out']} held-out).")
    print("Corpus minimums remain unmet; no benchmark eligibility is implied.")


if __name__ == "__main__":
    main()
