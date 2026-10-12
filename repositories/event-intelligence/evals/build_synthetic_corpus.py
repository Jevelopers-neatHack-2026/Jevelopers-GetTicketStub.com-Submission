#!/usr/bin/env python3
"""Materialize the small authored smoke fixtures; never synthesize benchmark rows."""

from __future__ import annotations

import hashlib
import json
import fcntl
import os
import stat
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "evals" / "corpus"
AUTHORED = CORPUS / "authored-cases.jsonl"
POLICY = ROOT / "evals" / "policies" / "promotion-v1.json"
CORPUS_VERSION = "jev-ei-synthetic-smoke-fixture-1.0.0"
GENERATED_ARTIFACTS = ("observations.jsonl", "labels.jsonl", "split-lock.json", "manifest.json")
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


def load_authored(authored_path: Path = AUTHORED, policy_path: Path = POLICY) -> tuple[list[dict[str, Any]], list[str]]:
    cases = read_jsonl(authored_path)
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
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


def build_artifacts(
    cases: list[dict[str, Any]], question_ids: list[str], authored_bytes: bytes,
) -> dict[str, bytes]:
    """Render all generated corpus files in memory without touching the lock."""
    observations, labels, assignments = materialize(cases, question_ids)
    observations_bytes = b"".join(stable_bytes(row) for row in observations)
    labels_bytes = b"".join(stable_bytes(row) for row in labels)
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
    lock_bytes = stable_bytes(lock)
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
    manifest_bytes = stable_bytes(manifest)
    return {
        "observations.jsonl": observations_bytes,
        "labels.jsonl": labels_bytes,
        "split-lock.json": lock_bytes,
        "manifest.json": manifest_bytes,
    }


def _load_json_bytes(data: bytes, path: Path) -> dict[str, Any]:
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{path.name} is not valid UTF-8 JSON; refusing to overwrite locked artifacts") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must be a JSON object; refusing to overwrite locked artifacts")
    return value


def _read_existing_regular_file(path: Path) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise ValueError(f"cannot safely open generated artifact {path.name} without following symlinks: {exc}") from exc
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError(f"generated artifact is not a regular file: {path.name}; refusing to overwrite it")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            return stream.read()
    finally:
        os.close(fd)


def _validate_existing_artifacts(corpus_dir: Path, expected: dict[str, bytes]) -> None:
    names = tuple(expected)
    paths = {name: corpus_dir / name for name in names}
    for path in paths.values():
        if path.is_symlink():
            raise ValueError(f"generated artifact path is a symlink: {path.name}; refusing to follow or replace it")
    present = {name for name, path in paths.items() if os.path.lexists(path)}
    if not present:
        return
    if present != set(names):
        missing = sorted(set(names) - present)
        existing = sorted(present)
        raise ValueError(
            "partial generated corpus exists (present: " + ", ".join(existing) + "; missing: " + ", ".join(missing)
            + "); refusing all writes. Restore the immutable corpus or create a separately reviewed, versioned migration."
        )

    current = {name: _read_existing_regular_file(path) for name, path in paths.items()}
    changed = [name for name in ("observations.jsonl", "labels.jsonl") if current[name] != expected[name]]
    if changed:
        raise ValueError(
            "locked corpus membership or content differs in " + ", ".join(changed)
            + "; refusing all writes under the existing corpus version. Create a new immutable corpus path and use an explicitly reviewed versioned migration."
        )

    lock_path = paths["split-lock.json"]
    expected_lock = _load_json_bytes(expected["split-lock.json"], lock_path)
    current_lock = _load_json_bytes(current["split-lock.json"], lock_path)
    usage = current_lock.get("held_out_usage")
    normalized_lock = dict(expected_lock)
    normalized_lock["held_out_usage"] = usage
    if stable_bytes(normalized_lock) != current["split-lock.json"]:
        raise ValueError(
            "split-lock immutable fields differ from the authored corpus; refusing all writes and preserving the current usage ledger. "
            "Create a new immutable corpus path and use an explicitly reviewed versioned migration."
        )

    expected_manifest = _load_json_bytes(expected["manifest.json"], paths["manifest.json"])
    _load_json_bytes(current["manifest.json"], paths["manifest.json"])
    expected_manifest["artifacts"]["split_lock"]["sha256"] = digest(current["split-lock.json"])
    runs = usage.get("evaluation_runs", []) if isinstance(usage, dict) else []
    expected_manifest["split_lock"]["held_out_consumed"] = bool(runs)
    if stable_bytes(expected_manifest) != current["manifest.json"]:
        raise ValueError(
            "manifest or split-lock digest differs from immutable corpus artifacts; refusing all writes and preserving the current usage ledger. "
            "Create a new immutable corpus path and use an explicitly reviewed versioned migration."
        )


def _publish_lock(corpus_dir: Path) -> int:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        directory_fd = os.open(corpus_dir, flags)
    except OSError as exc:
        raise ValueError(f"cannot open corpus directory without following symlinks: {exc}") from exc
    try:
        fcntl.flock(directory_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        os.close(directory_fd)
        raise ValueError("another corpus builder holds the directory lock; retry after it finishes") from exc
    except OSError as exc:
        os.close(directory_fd)
        raise ValueError(f"cannot lock corpus directory safely: {exc}") from exc
    return directory_fd


def publish_artifacts(corpus_dir: Path, artifacts: dict[str, bytes]) -> bool:
    """Create a corpus once; identical rebuilds are no-ops and mutations fail closed.

    Returns True when this call initialized the generated artifacts and False for
    an identical rebuild. Existing usage history is retained byte-for-byte.
    """
    if set(artifacts) != set(GENERATED_ARTIFACTS):
        raise ValueError("unexpected generated artifact set")
    if corpus_dir.is_symlink():
        raise ValueError(f"corpus directory must not be a symlink: {corpus_dir}")
    if not corpus_dir.is_dir():
        raise ValueError(f"corpus directory does not exist: {corpus_dir}")
    directory_fd = _publish_lock(corpus_dir)
    try:
        _validate_existing_artifacts(corpus_dir, artifacts)
        paths = {name: corpus_dir / name for name in GENERATED_ARTIFACTS}
        if all(os.path.lexists(path) for path in paths.values()):
            return False

        staged: list[tuple[Path, Path]] = []
        try:
            for name in GENERATED_ARTIFACTS:
                data = artifacts[name]
                with tempfile.NamedTemporaryFile(dir=corpus_dir, prefix=f".{name}.", suffix=".tmp", delete=False) as temp:
                    temp.write(data)
                    temp.flush()
                    os.fsync(temp.fileno())
                    staged.append((Path(temp.name), paths[name]))
            # Hard-link publication is atomic and fails if any destination appeared;
            # manifest is last, so readers never see a complete-looking partial set.
            for temporary, destination in staged:
                try:
                    os.link(temporary, destination, follow_symlinks=False)
                except FileExistsError as exc:
                    raise ValueError(
                        f"generated artifact appeared during initialization: {destination.name}; refusing to overwrite it"
                    ) from exc
        finally:
            for temporary, _ in staged:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
    finally:
        try:
            fcntl.flock(directory_fd, fcntl.LOCK_UN)
        finally:
            os.close(directory_fd)
    return True


def main() -> int:
    try:
        cases, question_ids = load_authored()
        artifacts = build_artifacts(cases, question_ids, AUTHORED.read_bytes())
        initialized = publish_artifacts(CORPUS, artifacts)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Corpus build refused: {exc}", file=sys.stderr)
        return 2
    counts = Counter(row["split"] for row in cases)
    if initialized:
        print(f"Initialized {len(cases)} author-authored smoke fixtures ({counts['calibration']} calibration, {counts['held_out']} held-out).")
    else:
        print(f"Corpus already matches {len(cases)} author-authored smoke fixtures; existing split-lock usage history preserved.")
    print("Corpus minimums remain unmet; no benchmark eligibility is implied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
