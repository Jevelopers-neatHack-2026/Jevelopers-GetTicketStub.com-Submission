"""Immutable JSON, JUnit and human receipts without automatic tracker promotion."""

import json
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Literal
from xml.etree.ElementTree import Element, ElementTree, SubElement

from pydantic import Field

from integration_evals.artifacts import confined_path, digest, read_bytes, reject_leaks
from integration_evals.errors import fail
from integration_evals.models import (
    CaseResult,
    Evidence,
    Mode,
    Origin,
    Outcome,
    Record,
    RequirementId,
    Run,
    Status,
)


class Criterion(Record):
    """Authoritative master acceptance row retained without altered ownership."""

    id: RequirementId
    category: str
    classification: str
    priority: str
    owner_role: str
    title: str
    verification: str
    evidence_required: str
    status: Status
    evidence_refs: tuple[str, ...]
    tested_revision_refs: tuple[str, ...]
    notes: str
    dependencies: tuple[str, ...]
    implementation_issue_refs: tuple[str, ...]


class Tracker(Record):
    """Original plan remains the authority; run output is an independent view."""

    format_version: str
    document_date: str
    kind: str
    allowed_statuses: tuple[Status, ...]
    notes: tuple[str, ...]
    criteria: tuple[Criterion, ...]


class CoverageRow(Record):
    """Requirement-to-case-to-run-to-artifact export with explicit exclusions."""

    requirement: RequirementId
    status: Status
    case_ids: tuple[str, ...]
    run_id: str
    artifacts: tuple[str, ...]
    issue_refs: tuple[str, ...] = ()
    dependencies: tuple[str, ...] = ()
    excluded: bool = False
    reason: str | None = None


class OwnerResponse(Record):
    """Owner runner response, checked against pinned revision and case oracles."""

    component_revision: str
    mode: Mode
    origin: Origin
    observations: dict[str, str | int | bool | None] = Field(min_length=1)
    evidence: tuple[Evidence, ...] = ()
    cost: Decimal | None = Field(default=None, ge=0)
    cost_status: Literal["unknown", "estimated", "confirmed"] = "unknown"


def validate_evidence(evidence: tuple[Evidence, ...], root: Path, run: Run) -> None:
    """Join every export to accessible local bytes and exact producing revision."""
    ids: set[str] = set()
    components = {component.repository: component.revision for component in run.components}
    cases = {result.case_id: result for result in run.results}
    for item in evidence:
        if item.id in ids:
            fail("duplicate_evidence", item.id)
        ids.add(item.id)
        result = cases.get(item.case_id)
        if result is None or item.requirement not in result.requirements or item.run_id != run.id:
            fail("dangling_evidence_join", item.id)
        if components.get(item.component) != item.revision:
            fail("evidence_revision_mismatch", item.id)
        if item.mode != result.mode:
            fail("evidence_mode_mismatch", item.id)
        if not all((item.permission_ref, item.redaction_ref, item.reviewer_access_ref)):
            fail("evidence_permission_missing", item.id)
        if item.created_at.utcoffset() is None or item.original_cutoff.utcoffset() is None:
            fail("evidence_timezone_missing", item.id)
        data = read_bytes(confined_path(root, item.path))
        if digest(data) != item.sha256:
            fail("evidence_digest_mismatch", item.id)
        reject_leaks(data, item.id)


def validate_run(run: Run) -> None:
    """Reject forged status, dangling references and unknown-as-zero costs."""
    ids = [result.case_id for result in run.results]
    if len(ids) != len(set(ids)):
        fail("duplicate_case_result", run.id)
    evidence_ids = {item.id for item in run.evidence}
    for result in run.results:
        if not set(result.evidence_ids).issubset(evidence_ids):
            fail("dangling_evidence_reference", result.case_id)
        if result.criterion_status is Status.VERIFIED:
            fail("unreviewed_tracker_promotion", result.case_id)
        if result.cost_status == "unknown" and result.cost is not None:
            fail("unknown_cost_has_amount", result.case_id)
        if result.cost_status != "unknown" and result.cost is None:
            fail("known_cost_missing_amount", result.case_id)
        if result.outcome is Outcome.SKIPPED and result.criterion_status is not Status.BLOCKED:
            fail("skip_hidden_as_success", result.case_id)
        if (
            result.mode is Mode.LIVE
            and result.outcome is Outcome.PASSED
            and result.origin is not Origin.LIVE
        ):
            fail("synthetic_claims_live_execution", result.case_id)
    reject_leaks(run.model_dump_json().encode(), run.id)


def coverage(run: Run, tracker: Tracker) -> tuple[CoverageRow, ...]:
    """Export canonical states unchanged and list cases proving only their modes."""
    rows: list[CoverageRow] = []
    for criterion in tracker.criteria:
        cases = tuple(result for result in run.results if criterion.id in result.requirements)
        excluded = criterion.priority != "P0"
        status = criterion.status
        if not excluded and any(case.criterion_status is Status.BLOCKED for case in cases):
            status = Status.BLOCKED
        rows.append(
            CoverageRow(
                requirement=criterion.id,
                status=status,
                case_ids=tuple(case.case_id for case in cases),
                run_id=run.id,
                artifacts=tuple(ref for case in cases for ref in case.evidence_ids),
                issue_refs=criterion.implementation_issue_refs,
                dependencies=criterion.dependencies,
                excluded=excluded,
                reason="P1/Production outside v1"
                if excluded
                else ("no executed required boundary" if not cases else None),
            )
        )
    return tuple(rows)


def junit(results: tuple[CaseResult, ...]) -> bytes:
    """Emit skipped blockers distinctly from failures in CI test reports."""
    root = Element(
        "testsuite",
        tests=str(len(results)),
        failures=str(sum(r.outcome is Outcome.FAILED for r in results)),
        errors=str(sum(r.outcome is Outcome.ERROR for r in results)),
        skipped=str(sum(r.outcome is Outcome.SKIPPED for r in results)),
    )
    for result in results:
        case = SubElement(root, "testcase", name=result.case_id, time=str(result.duration_seconds))
        if result.outcome is not Outcome.PASSED:
            tag = {Outcome.SKIPPED: "skipped", Outcome.FAILED: "failure", Outcome.ERROR: "error"}
            _ = SubElement(case, tag[result.outcome], message=result.reason or result.outcome.value)
    output = BytesIO()
    ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)
    return output.getvalue()


def save_run(run: Run, root: Path, tracker: Tracker) -> Path:
    """Preserve original failures by refusing to overwrite an existing run ID."""
    validate_run(run)
    directory = confined_path(root, run.id)
    directory.mkdir(parents=True, exist_ok=False)
    _ = (directory / "run.json").write_text(run.model_dump_json(indent=2), encoding="utf-8")
    rows = coverage(run, tracker)
    export = json.dumps([row.model_dump(mode="json") for row in rows], indent=2)
    _ = (directory / "coverage.json").write_text(export, encoding="utf-8")
    _ = (directory / "junit.xml").write_bytes(junit(run.results))
    lines = [
        f"# Evaluation run {run.id}",
        "",
        f"Integration revision: `{run.integration_revision}`",
        "",
        "| Case | Outcome | Criterion | Mode | Cost | Blocker |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    lines.extend(
        " | ".join(
            (
                "",
                result.case_id,
                result.outcome,
                result.criterion_status,
                result.mode,
                result.cost_status,
                result.reason or "-",
                "",
            )
        )
        for result in run.results
    )
    lines.extend(
        [
            "",
            "Mock/replay output verifies only that mode; skipped boundaries block acceptance.",
            "",
        ]
    )
    lines.extend(run.limitations)
    _ = (directory / "report.md").write_text("\n".join(lines), encoding="utf-8")
    return directory
