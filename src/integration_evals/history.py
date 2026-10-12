"""Measured complete-history classification and local quarantine records."""

import re
from datetime import datetime
from typing import Literal

from pydantic import Field

from integration_evals.artifacts import MAX_ARTIFACT_BYTES, reject_leaks
from integration_evals.errors import fail
from integration_evals.models import CaseId, Identifier, Outcome, Record, Revision, Run, Suite
from integration_evals.replay import validate_history, validate_rerun_inputs


class Quarantine(Record):
    """Local triage metadata; expiry never automatically releases a case."""

    case_id: CaseId
    owner: Identifier
    remediation_issue: str = Field(
        pattern=r"^https://github\.com/[\w.-]+/[\w.-]+/issues/[1-9][0-9]*$"
    )
    reason: str = Field(min_length=1, max_length=1000)
    expires_at: datetime
    reproduction: Literal["integration-evals history-report"] = "integration-evals history-report"


class History(Record):
    """All original-first samples, with quarantine that applies to the entire history."""

    runs: tuple[Run, ...] = Field(min_length=1, max_length=3)
    quarantines: tuple[Quarantine, ...] = ()


class CaseHistory(Record):
    """Machine-readable register; denominators are derived from retained samples."""

    case_id: CaseId
    requirements: tuple[str, ...]
    classification: Literal["passed", "flaky", "consistently_failed", "blocked"]
    outcomes: tuple[Outcome, ...]
    run_ids: tuple[str, ...]
    failures: int
    denominator: int
    last_good_revision: Revision | None
    last_bad_revision: Revision | None
    failure_signature: str | None
    owner: str
    remediation_issue: str | None
    reproduction_command: tuple[str, ...]
    triage_complete: bool
    quarantine: Quarantine | None
    quarantine_expired: bool
    release_blocked: bool
    source: Literal["preserved-evaluation-receipts"] = "preserved-evaluation-receipts"


def runs_of(value: Run | History) -> tuple[Run, ...]:
    """Reject latest-only diagnostic receipts at report and release boundaries."""
    if isinstance(value, History):
        seen: set[str] = set()
        for index, run in enumerate(value.runs):
            parent = value.runs[index - 1] if index else None
            if (
                run.id in seen
                or run.attempt != index
                or run.parent_id != (parent.id if parent else None)
            ):
                fail("complete_history_required", "history")
            seen.add(run.id)
            if parent is not None:
                validate_rerun_inputs(parent, run)
        return value.runs
    if value.attempt or value.parent_id:
        fail("complete_history_required", value.id)
    return (value,)


def validate_record(history: History, suite: Suite) -> None:
    """Check ancestry, quarantine joins and safe references before exporting."""
    if len(history.model_dump_json(indent=2).encode()) > MAX_ARTIFACT_BYTES:
        fail("oversized_history", "history")
    validate_history(history.runs, suite)
    ids = tuple(item.case_id for item in history.quarantines)
    if len(set(ids)) != len(ids) or not set(ids).issubset(c.id for c in suite.cases):
        fail("invalid_quarantine_scope", "history")
    for item in history.quarantines:
        if item.expires_at.utcoffset() is None or not item.reason.strip():
            fail("invalid_quarantine_metadata", item.case_id)
    reject_leaks(history.model_dump_json().encode(), "history")


def summarize_history(history: History, suite: Suite) -> tuple[CaseHistory, ...]:
    """Count every declared case sample; a later pass never clears earlier failure."""
    validate_record(history, suite)
    quarantine = {item.case_id: item for item in history.quarantines}
    rows: list[CaseHistory] = []
    for case in suite.cases:
        samples = tuple(
            (run, result)
            for run in history.runs
            for result in run.results
            if result.case_id == case.id
        )
        outcomes = tuple(result.outcome for _, result in samples)
        bad = tuple(run.integration_revision for run, r in samples if r.outcome is Outcome.FAILED)
        good = tuple(run.integration_revision for run, r in samples if r.outcome is Outcome.PASSED)
        blocked = (
            case.quarantined is True
            or case.id in quarantine
            or any(o in {Outcome.ERROR, Outcome.SKIPPED} for o in outcomes)
        )
        classification = (
            "blocked"
            if blocked
            else "flaky"
            if bad and good
            else "consistently_failed"
            if bad
            else "passed"
        )
        item = quarantine.get(case.id)
        # Signatures contain only structural case/outcome facts, never owner output or prose.
        signature = f"{case.id}:failed" if bad else None
        if signature is not None and not re.fullmatch(r"[A-Za-z0-9_.-]+:failed", signature):
            fail("unsafe_failure_signature", "history")
        rows.append(
            CaseHistory(
                case_id=case.id,
                requirements=tuple(case.requirements),
                classification=classification,
                outcomes=outcomes,
                run_ids=tuple(run.id for run, _ in samples),
                failures=len(bad),
                denominator=len(samples),
                last_good_revision=good[-1] if good else None,
                last_bad_revision=bad[-1] if bad else None,
                failure_signature=signature,
                owner=item.owner if item else case.component,
                remediation_issue=item.remediation_issue if item else None,
                reproduction_command=(
                    "integration-evals",
                    "history-report",
                    history.runs[0].id,
                    "--suite",
                    f"{history.runs[0].id}/suite.json",
                ),
                triage_complete=item is not None,
                quarantine=item,
                quarantine_expired=item is not None
                and item.expires_at <= history.runs[-1].started_at,
                release_blocked=case.mandatory and (blocked or bool(bad)),
            )
        )
    return tuple(rows)
