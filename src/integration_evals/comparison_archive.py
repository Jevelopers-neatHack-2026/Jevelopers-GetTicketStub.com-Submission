"""Portable immutable oracle inputs; archived input consistency is not authentication."""

from datetime import datetime
from pathlib import Path

from pydantic import Field

from integration_evals.artifacts import MAX_ARTIFACT_BYTES, digest, read_bytes, reject_leaks
from integration_evals.errors import InvalidArtifactError, fail
from integration_evals.execution import ComparisonCapture, OwnerContext, Settings
from integration_evals.models import Assembly, Case, Digest, Mode, Record, Run
from integration_evals.reporting import OwnerResponse


class ComparisonInput(Record):
    """Only comparison context is exported; no execution settings or host paths are restored."""

    case: Case
    assembly: Assembly
    run_id: str
    clock: datetime
    seed: int
    mode: Mode
    reserved_evidence_ids: tuple[str, ...]
    response_json: str


class ComparisonBundle(Record):
    """A minimal replay bundle binds serialized original oracle inputs to a run digest."""

    evaluator_digest: Digest
    inputs: tuple[ComparisonInput, ...] = Field(min_length=1)


def evaluator_digest() -> str:
    """Bind replay to the installed evaluator source bytes, independently of checkout claims."""
    source = Path(__file__).resolve().parent
    return digest(
        b"".join(
            path.name.encode() + digest(read_bytes(path)).encode()
            for path in sorted(source.glob("*.py"))
        )
    )


def bundle_bytes(captures: tuple[ComparisonCapture, ...]) -> bytes:
    """Freeze process-held observations before handing them to persistence."""
    bundle = ComparisonBundle(
        evaluator_digest=evaluator_digest(),
        inputs=tuple(
            ComparisonInput(
                case=capture.case,
                assembly=capture.context.assembly,
                run_id=capture.context.run_id,
                clock=capture.context.clock,
                seed=capture.context.settings.seed,
                mode=capture.context.settings.mode,
                reserved_evidence_ids=tuple(sorted(capture.context.evidence_ids)),
                response_json=capture.response_json.decode(),
            )
            for capture in captures
        ),
    )
    data = bundle.model_dump_json().encode()
    reject_leaks(data, "comparison-bundle")
    if len(data) > MAX_ARTIFACT_BYTES:
        fail("oversized_comparison_bundle", "history")
    return data


def save_comparisons(captures: tuple[ComparisonCapture, ...], run: Run, archive: Path) -> None:
    """Export captured comparison bytes without changing or relabeling source artifacts."""
    data = bundle_bytes(captures)
    if digest(data) != run.comparison_digest:
        fail("comparison_bundle_mismatch", "history")
    with (archive / "comparisons.json").open("xb") as output:
        _ = output.write(data)


def load_comparisons(archive: Path, run: Run) -> tuple[ComparisonCapture, ...]:
    """Read inputs for pure comparison only; never establish permission for owner execution."""
    data = read_bytes(archive / "comparisons.json")
    reject_leaks(data, "comparison-bundle")
    if digest(data) != run.comparison_digest:
        fail("comparison_bundle_mismatch", "history")
    bundle = ComparisonBundle.model_validate_json(data)
    return tuple(
        ComparisonCapture(
            item.case,
            OwnerContext(
                item.assembly,
                Settings(archive, archive, None, item.mode, seed=item.seed, artifact_root=archive),
                item.run_id,
                item.clock,
                frozenset(item.reserved_evidence_ids),
            ),
            item.response_json.encode(),
        )
        for item in bundle.inputs
    )


def capture_response(
    case: Case, context: OwnerContext, response: OwnerResponse
) -> ComparisonCapture | None:
    """Retain only declared boolean/null observations; omit arbitrary observation payloads."""
    expected = {assertion.observation: assertion.expected for assertion in case.assertions}
    for name, value in response.observations.items():
        if name not in expected:
            return None
        if value is not None and not isinstance(value, bool):
            return None
    data = response.model_dump_json().encode()
    if len(data) > MAX_ARTIFACT_BYTES:
        return None
    try:
        reject_leaks(data, "comparison-capture")
    except InvalidArtifactError:
        return None
    return ComparisonCapture(case, context, data)
