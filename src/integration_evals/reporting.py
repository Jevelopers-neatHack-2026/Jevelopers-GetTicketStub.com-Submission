"""Immutable JSON, JUnit and human receipts without automatic tracker promotion."""

import json
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Literal
from xml.etree.ElementTree import Element, ElementTree, SubElement

from pydantic import Field

from integration_evals.artifacts import confined_path
from integration_evals.errors import fail
from integration_evals.history import History, runs_of, summarize_history, validate_record
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
    Suite,
)
from integration_evals.packaging import copy_artifacts
from integration_evals.report_validation import validate_evidence, validate_run


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


def coverage(run: Run | History, tracker: Tracker) -> tuple[CoverageRow, ...]:
    """Export canonical states unchanged and list cases proving only their modes."""
    history = runs_of(run)
    quarantined: set[str] = (
        {item.case_id for item in run.quarantines} if isinstance(run, History) else set()
    )
    rows: list[CoverageRow] = []
    for criterion in tracker.criteria:
        cases = tuple(
            result
            for sample in history
            for result in sample.results
            if criterion.id in result.requirements
        )
        excluded = criterion.priority != "P0"
        status = criterion.status
        if not excluded and any(
            case.outcome is not Outcome.PASSED
            or case.quarantined is True
            or case.case_id in quarantined
            for case in cases
        ):
            status = Status.BLOCKED
        rows.append(
            CoverageRow(
                requirement=criterion.id,
                status=status,
                case_ids=tuple(dict.fromkeys(case.case_id for case in cases)),
                run_id=history[-1].id,
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


def save_run(
    run: Run, root: Path, tracker: Tracker, suite: Suite, artifact_root: Path | None = None
) -> Path:
    """Preserve original failures by refusing to overwrite an existing run ID."""
    if run.attempt or run.parent_id:
        fail("complete_history_required", run.id)
    return save_snapshot(History(runs=(run,)), root, tracker, suite, artifact_root)


def save_snapshot(
    history: History, root: Path, tracker: Tracker, suite: Suite, artifact_root: Path | None
) -> Path:
    """Write one immutable full-history snapshot after archive sequencing checks."""
    validate_record(history, suite)
    run = history.runs[-1]
    validate_run(run, suite)
    if run.evidence and artifact_root is None:
        fail("artifact_root_unavailable", run.id)
    if artifact_root is not None:
        validate_evidence(run.evidence, artifact_root, run)
    directory = confined_path(root, run.id)
    directory.mkdir(parents=True, exist_ok=False)
    if artifact_root is not None:
        copy_artifacts(run, artifact_root, directory)
    _ = (directory / "run.json").write_text(run.model_dump_json(indent=2), encoding="utf-8")
    _ = (directory / "suite.json").write_text(suite.model_dump_json(indent=2), encoding="utf-8")
    rows = coverage(history, tracker)
    export = json.dumps([row.model_dump(mode="json") for row in rows], indent=2)
    _ = (directory / "coverage.json").write_text(export, encoding="utf-8")
    _ = (directory / "history.json").write_text(history.model_dump_json(indent=2), encoding="utf-8")
    register = [row.model_dump(mode="json") for row in summarize_history(history, suite)]
    _ = (directory / "register.json").write_text(json.dumps(register, indent=2), encoding="utf-8")
    _ = (directory / "junit.xml").write_bytes(
        junit(tuple(result for sample in history.runs for result in sample.results))
    )
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
        for sample in history.runs
        for result in sample.results
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
