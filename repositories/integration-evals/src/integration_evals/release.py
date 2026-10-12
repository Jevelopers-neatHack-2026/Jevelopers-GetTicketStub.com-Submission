"""Per-criterion audit distinguishes tooling checks from composed product acceptance."""

from pathlib import Path
from typing import Literal

from integration_evals.artifacts import digest, read_bytes
from integration_evals.errors import fail
from integration_evals.evidence_index import EvidenceIndex
from integration_evals.history import History, runs_of, validate_record
from integration_evals.models import Outcome, Record, Run, Status, Suite
from integration_evals.report_validation import validate_run
from integration_evals.reporting import Tracker, coverage
from integration_evals.specifications import Requirements


class Obligation(Record):
    """An individually owned missing acceptance criterion or external artifact."""

    id: str
    issue: str
    state: Status
    cases: tuple[str, ...]
    owner: str
    next_action: str


class ReleaseAudit(Record):
    """An audit never converts local validation into product/provider approval."""

    schema_version: Literal["1.0"] = "1.0"
    integration_revision: str
    run_id: str
    tooling_readiness: Literal["partial", "ready"]
    product_acceptance: Literal["blocked", "ready"]
    obligations: tuple[Obligation, ...]
    exclusions: tuple[str, ...]
    run_digest: str
    limitations: tuple[str, ...]


def audit(
    run: Run | History,
    tracker: Tracker,
    requirements: Requirements,
    suite: Suite,
    *,
    evidence_index: EvidenceIndex | None = None,
) -> ReleaseAudit:
    """List every launch leaf and original acceptance row without premature closure."""
    history = runs_of(run)
    if evidence_index is not None and (
        evidence_index.runs != history
        or evidence_index.history_digest
        != digest(
            (run if isinstance(run, History) else History(runs=history)).model_dump_json().encode()
        )
        or evidence_index.suite_digest != digest(suite.model_dump_json().encode())
        or evidence_index.tracker_digest != digest(tracker.model_dump_json().encode())
        or evidence_index.requirements_digest != digest(requirements.model_dump_json().encode())
        or {row.requirement for row in evidence_index.requirements}
        != {*(str(c.id) for c in tracker.criteria), *(str(c.id) for c in requirements.leaves)}
    ):
        fail("release_evidence_index_mismatch", "index")
    evidence_blockers = (
        {row.requirement: row.blockers for row in evidence_index.requirements}
        if evidence_index
        else {}
    )
    if isinstance(run, History):
        validate_record(run, suite)
    else:
        validate_run(run, suite)
    quarantined: set[str] = (
        {item.case_id for item in run.quarantines} if isinstance(run, History) else set()
    )
    quarantined.update(case.id for case in suite.cases if case.quarantined is True)
    obligations: list[Obligation] = []
    for leaf in requirements.leaves:
        results = tuple(
            result
            for sample in history
            for result in sample.results
            if leaf.id in result.requirements
        )
        blockers = tuple(
            result
            for result in results
            if result.outcome is not Outcome.PASSED or result.case_id in quarantined
        )
        obligations.append(
            Obligation(
                id=leaf.id,
                issue=leaf.issue,
                state=Status.BLOCKED
                if blockers or not results or evidence_blockers.get(leaf.id)
                else Status.IN_PROGRESS,
                cases=tuple(result.case_id for result in results),
                owner=blockers[0].blocker_owner or "repository reviewer"
                if blockers
                else "repository reviewer",
                next_action=(blockers[0].reason or "resolve failed owner boundary")
                if blockers
                else "; ".join(evidence_blockers[leaf.id])
                if evidence_blockers.get(leaf.id)
                else "Provide reviewed criterion artifacts; tooling tests alone are insufficient",
            )
        )
    rows = coverage(run, tracker)
    for row in rows:
        if not row.excluded:
            criterion = next(item for item in tracker.criteria if item.id == row.requirement)
            obligations.append(
                Obligation(
                    id=criterion.id,
                    issue=criterion.implementation_issue_refs[0],
                    state=Status.BLOCKED if evidence_blockers.get(criterion.id) else row.status,
                    cases=row.case_ids,
                    owner=criterion.owner_role,
                    next_action="; ".join(evidence_blockers[criterion.id])
                    if evidence_blockers.get(criterion.id)
                    else "Owner review of authentic boundary evidence and composed pins",
                )
            )
    return ReleaseAudit(
        integration_revision=history[-1].integration_revision,
        run_id=history[-1].id,
        tooling_readiness="partial",
        product_acceptance="blocked",
        obligations=tuple(obligations),
        exclusions=tuple(row.requirement for row in rows if row.excluded),
        run_digest=digest(run.model_dump_json().encode()),
        limitations=(
            "No canonical contract package or app release manifest has been supplied.",
            "Synthetic smoke corpus is not a ratified held-out evaluation.",
            "Sponsor/provider artifacts and their owner reviews remain required.",
        ),
    )


def export_audit(receipt: ReleaseAudit, destination: Path) -> None:
    """Write an immutable local audit with an independently checkable byte digest."""
    with destination.open("x", encoding="utf-8") as output:
        _ = output.write(receipt.model_dump_json(indent=2))
    with destination.with_suffix(".sha256").open("x", encoding="utf-8") as output:
        _ = output.write(digest(read_bytes(destination)))
