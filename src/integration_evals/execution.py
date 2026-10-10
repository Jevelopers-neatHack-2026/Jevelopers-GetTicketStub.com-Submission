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


@dataclass(frozen=True, slots=True)
class OwnerContext:
    """One run's correlation and isolation namespace, with a fixed injected clock."""

    assembly: Assembly
    settings: Settings
    run_id: str
    clock: datetime


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
