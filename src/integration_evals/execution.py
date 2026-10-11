"""Typed run settings and case receipts shared by orchestration and owner invocation."""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal

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
class OwnerExecution:
    """Case receipt and the owner's immutable evidence references."""

    result: CaseResult
    evidence: tuple[Evidence, ...] = ()


def blocked(case: Case, mode: Mode, owner: str, reason: str) -> CaseResult:
    """Keep absent boundaries skipped and acceptance blocked."""
    return CaseResult(
        case_id=case.id,
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
        requirements=case.requirements,
        outcome=Outcome.SKIPPED,
        criterion_status=Status.PLANNED,
        mode=mode,
        origin=Origin.SYNTHETIC,
        duration_seconds=0,
        reason="not-selected",
    )
