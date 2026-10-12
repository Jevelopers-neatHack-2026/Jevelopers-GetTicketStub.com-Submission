"""Typed run settings and case receipts shared by orchestration and owner invocation."""

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from integration_evals.errors import fail
from integration_evals.models import (
    Assembly,
    Case,
    CaseResult,
    Evidence,
    Mode,
    Origin,
    Outcome,
    Status,
)
from integration_evals.processes import TestInvocation


@dataclass(frozen=True, slots=True)
class Settings:
    """Execution context separate from provider mode and immutable release inputs."""

    repository: Path
    workspace: Path
    assembly_path: Path | None
    mode: Mode = Mode.MOCK
    context: Literal["local", "ci"] = "local"
    authorize_paid: bool = False
    seed: int = 17
    artifact_root: Path | None = None
    test_invocation: TestInvocation | None = None
    test_clock: datetime | None = None

    def __post_init__(self) -> None:
        """Permit an explicit logical clock only for guarded mock development tests."""
        if self.test_clock is None:
            return
        if self.test_invocation is None or self.mode is not Mode.MOCK or self.authorize_paid:
            fail("test_clock_requires_guarded_mock", "development-only")
        if self.test_clock.tzinfo is not UTC:
            fail("test_clock_requires_aware_utc", "development-only")

    @property
    def artifacts(self) -> Path:
        """Retain sanitized outputs outside immutable component source checkouts."""
        return self.artifact_root or self.workspace / ".integration-evals-artifacts"


@dataclass(frozen=True, slots=True)
class OwnerContext:
    """One run's correlation and isolation namespace, with a fixed injected clock."""

    assembly: Assembly
    settings: Settings
    run_id: str
    clock: datetime
    evidence_ids: frozenset[str] = frozenset()


@dataclass(frozen=True, slots=True)
class ComparisonCapture:
    """Process-held oracle input captured after comparison, retention and successful cleanup.

    Archived copies authorize only pure comparison and carry no source authentication.
    This object authorizes no owner dispatch.
    Serialized response bytes prevent mutation of the owner's observations dictionary.
    """

    case: Case
    context: OwnerContext
    response_json: bytes


@dataclass(frozen=True, slots=True)
class OwnerExecution:
    """Case receipt and the owner's immutable evidence references."""

    result: CaseResult
    evidence: tuple[Evidence, ...] = ()
    comparison: ComparisonCapture | None = None


def blocked(case: Case, mode: Mode, owner: str, reason: str) -> CaseResult:
    """Keep absent boundaries skipped and acceptance blocked."""
    return CaseResult(
        case_id=case.id,
        case_category=case.category,
        quarantined=case.quarantined,
        requirements=case.requirements,
        outcome=Outcome.SKIPPED,
        criterion_status=Status.BLOCKED,
        mode=mode,
        origin=Origin.SYNTHETIC,
        duration_seconds=0,
        blocker_owner=owner,
        reason=reason,
    )


def unselected(case: Case, mode: Mode) -> CaseResult:
    """Keep intentionally omitted scope planned without treating it as a passing case."""
    return CaseResult(
        case_id=case.id,
        case_category=case.category,
        quarantined=case.quarantined,
        requirements=case.requirements,
        outcome=Outcome.SKIPPED,
        criterion_status=Status.PLANNED,
        mode=mode,
        origin=Origin.SYNTHETIC,
        duration_seconds=0,
        reason="not-selected",
    )
