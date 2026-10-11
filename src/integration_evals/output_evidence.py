"""Validate exact owner output claims and retain safe bytes before resource teardown."""

from dataclasses import dataclass
from pathlib import Path

from integration_evals.artifacts import confined_path, digest, read_bytes, reject_leaks
from integration_evals.errors import fail
from integration_evals.execution import OwnerContext
from integration_evals.models import Case, Evidence, Mode, Origin


@dataclass(frozen=True, slots=True)
class ClaimContext:
    """Frozen case rules bind both execution and independent archive inspection."""

    pins: dict[str, str]
    run_id: str
    mode: Mode
    evidence_ids: frozenset[str] = frozenset()


def validate_evidence_metadata(
    evidence: tuple[Evidence, ...], reserved_ids: frozenset[str]
) -> None:
    """Apply archive metadata rules before either owner acceptance or export."""
    ids = set(reserved_ids)
    for item in evidence:
        if item.id in ids:
            fail("duplicate_evidence", item.id)
        ids.add(item.id)
        if not all((item.permission_ref, item.redaction_ref, item.reviewer_access_ref)):
            fail("evidence_permission_missing", item.id)
        if item.created_at.utcoffset() is None or item.original_cutoff.utcoffset() is None:
            fail("evidence_timezone_missing", item.id)
        reject_leaks(item.model_dump_json().encode(), item.id)


def check_claim(
    case: Case, context: OwnerContext, evidence: tuple[Evidence, ...], origin: Origin
) -> None:
    """Require the case's own artifacts, expected producers and actual origin classes."""
    pins = {component.repository: component.revision for component in context.assembly.components}
    validate_claim(
        case,
        ClaimContext(pins, context.run_id, context.settings.mode, context.evidence_ids),
        evidence,
        origin,
    )


def validate_claim(
    case: Case, context: ClaimContext, evidence: tuple[Evidence, ...], origin: Origin
) -> None:
    """Apply the same producer, kind and origin predicates to every evidence boundary."""
    validate_evidence_metadata(evidence, context.evidence_ids)
    allowed = set(case.artifact_producers or (case.component,))
    kinds = {item.kind for item in evidence}
    if not set(case.required_evidence_kinds).issubset(kinds):
        fail("required_output_kind_missing", case.id)
    for item in evidence:
        if (
            item.case_id != case.id
            or item.run_id != context.run_id
            or item.requirement not in case.requirements
        ):
            fail("cross_case_output_claim", case.id)
        if item.component not in allowed or context.pins.get(item.component) != item.revision:
            fail("wrong_output_producer", case.id)
        if item.mode != context.mode:
            fail("output_mode_mismatch", case.id)
    real_origins = {Mode.LIVE: Origin.LIVE, Mode.SANDBOX: Origin.SANDBOX}
    required_origin = real_origins.get(context.mode)
    if required_origin is not None:
        if origin != required_origin:
            fail("synthetic_real_mode_claim", case.id)
        for kind in case.required_evidence_kinds:
            if not any(item.kind == kind and item.origin == required_origin for item in evidence):
                fail("required_real_output_missing", case.id)


def retain(
    case: Case, context: OwnerContext, evidence: tuple[Evidence, ...], staging: Path
) -> tuple[Evidence, ...]:
    """Copy only hash-matched sanitized outputs into a distinct durable case namespace."""
    namespace = f"{context.run_id}/{case.id}"
    destination = confined_path(context.settings.artifacts, namespace)
    destination.mkdir(parents=True, mode=0o700, exist_ok=False)
    retained: list[Evidence] = []
    paths: dict[str, str] = {}
    for item in evidence:
        data = read_bytes(confined_path(staging, item.path))
        if digest(data) != item.sha256:
            fail("owner_output_digest_mismatch", item.id)
        reject_leaks(data, item.id)
        if item.path in paths and paths[item.path] != item.sha256:
            fail("conflicting_output_hashes", item.id)
        if item.path not in paths:
            target = confined_path(destination, item.path)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as output:
                _ = output.write(data)
            paths[item.path] = item.sha256
        retained.append(item.model_copy(update={"path": f"{namespace}/{item.path}"}))
    return tuple(retained)
