"""Validate immutable run claims against frozen cases and accessible evidence bytes."""

from decimal import Decimal
from pathlib import Path
from typing import Literal

from integration_evals.artifacts import confined_path, digest, read_bytes, reject_leaks
from integration_evals.errors import fail
from integration_evals.models import CaseResult, Evidence, Mode, Origin, Outcome, Run, Status, Suite
from integration_evals.output_evidence import (
    ClaimContext,
    validate_claim,
    validate_evidence_metadata,
)


def validate_evidence(evidence: tuple[Evidence, ...], root: Path, run: Run) -> None:
    """Join every export to accessible local bytes and exact producing revision."""
    validate_evidence_metadata(evidence, frozenset())
    components = {component.repository: component.revision for component in run.components}
    cases = {result.case_id: result for result in run.results}
    for item in evidence:
        result = cases.get(item.case_id)
        if result is None or item.requirement not in result.requirements or item.run_id != run.id:
            fail("dangling_evidence_join", item.id)
        if components.get(item.component) != item.revision:
            fail("evidence_revision_mismatch", item.id)
        if item.mode != result.mode:
            fail("evidence_mode_mismatch", item.id)
        data = read_bytes(confined_path(root, item.path))
        if digest(data) != item.sha256:
            fail("evidence_digest_mismatch", item.id)
        reject_leaks(data, item.id)


def validate_run(run: Run, suite: Suite) -> None:
    """Reject forged status, dangling references and unknown-as-zero costs."""
    ids = [result.case_id for result in run.results]
    if len(ids) != len(set(ids)):
        fail("duplicate_case_result", run.id)
    evidence = {item.id: item for item in run.evidence}
    if len(evidence) != len(run.evidence):
        fail("duplicate_evidence", run.id)
    for result in run.results:
        validate_result(result, run.id, evidence)
    validate_suite_binding(run, suite, evidence)
    if not run.results or not run.selected_case_ids or not set(run.selected_case_ids).issubset(ids):
        fail("empty_or_omitted_run_selection", run.id)
    if any(
        result.case_id in run.selected_case_ids and result.reason == "not-selected"
        for result in run.results
    ):
        fail("selected_case_hidden_as_unselected", run.id)
    reject_leaks(run.model_dump_json().encode(), run.id)


def validate_suite_binding(run: Run, suite: Suite, evidence: dict[str, Evidence]) -> None:
    """Bind archive claims to independently supplied frozen scenario definitions."""
    if digest(suite.model_dump_json().encode()) != run.suite_digest:
        fail("archived_suite_pin_mismatch", run.id)
    definitions = {case.id: case for case in suite.cases}
    if {result.case_id for result in run.results} != set(definitions):
        fail("archived_case_scope_mismatch", run.id)
    components = {component.repository: component for component in run.components}
    pins = {name: component.revision for name, component in components.items()}
    for result in run.results:
        case = definitions[result.case_id]
        if result.requirements != case.requirements or (
            result.outcome is Outcome.PASSED and result.mode not in case.modes
        ):
            fail("archived_case_contract_mismatch", result.case_id)
        if result.outcome is Outcome.PASSED:
            component = components.get(case.component)
            if component is not None and not component.supports_mode(result.mode):
                fail("archived_component_mode_mismatch", case.id)
            validate_claim(
                case,
                ClaimContext(pins, run.id, result.mode),
                tuple(evidence[key] for key in result.evidence_ids),
                result.origin,
            )


def validate_result(result: CaseResult, run_id: str, evidence: dict[str, Evidence]) -> None:
    """Prevent another case or synthetic artifact from supporting a passed real claim."""
    if not set(result.evidence_ids).issubset(evidence):
        fail("dangling_evidence_reference", result.case_id)
    referenced = tuple(evidence[key] for key in result.evidence_ids)
    if any(
        item.case_id != result.case_id
        or item.run_id != run_id
        or item.requirement not in result.requirements
        or item.mode != result.mode
        for item in referenced
    ):
        fail("cross_case_evidence_reference", result.case_id)
    if result.outcome is Outcome.PASSED and not referenced:
        fail("passed_case_missing_evidence", result.case_id)
    required_origin = {Mode.LIVE: Origin.LIVE, Mode.SANDBOX: Origin.SANDBOX}.get(result.mode)
    if (
        result.outcome is Outcome.PASSED
        and required_origin is not None
        and (
            result.origin != required_origin
            or not any(item.origin == required_origin for item in referenced)
        )
    ):
        fail("synthetic_claims_real_execution", result.case_id)
    if result.criterion_status is Status.VERIFIED:
        fail("unreviewed_tracker_promotion", result.case_id)
    validate_cost(result.cost, result.cost_status, result.case_id)
    unselected = result.criterion_status is Status.PLANNED and result.reason == "not-selected"
    if (
        result.outcome is Outcome.SKIPPED
        and result.criterion_status is not Status.BLOCKED
        and not unselected
    ):
        fail("skip_hidden_as_success", result.case_id)


def validate_cost(
    cost: Decimal | None, status: Literal["unknown", "estimated", "confirmed"], reference: str
) -> None:
    """Keep cost presence consistent at owner ingestion and archive validation."""
    if status == "unknown" and cost is not None:
        fail("unknown_cost_has_amount", reference)
    if status != "unknown" and cost is None:
        fail("known_cost_missing_amount", reference)
