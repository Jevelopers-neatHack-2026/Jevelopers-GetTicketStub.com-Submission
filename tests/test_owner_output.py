import sys
from pathlib import Path

from integration_evals.models import Mode, Outcome, Status
from integration_evals.owner import execute_owner
from integration_evals.preflight import PreflightContext
from integration_evals.runner import execute_case
from tests.test_evidence_claims import context_for, controlled_case


def test_owner_output_survives_when_isolated_command_and_cleanup_finish(tmp_path: Path) -> None:
    # Given an inert owner protocol fixture that emits fresh bytes through the process boundary.
    case = controlled_case()
    context = context_for(tmp_path, Mode.MOCK)
    checkout = tmp_path / "agent-harness"
    checkout.mkdir()
    fixture = Path(__file__).parent / "fixtures/owner_output.py"
    component = context.assembly.components[0].model_copy(
        update={
            "command": (sys.executable, str(fixture)),
            "cleanup_command": (sys.executable, "-c", "import sys; sys.exit(0)"),
        }
    )
    context = type(context)(
        context.assembly.model_copy(update={"components": (component,)}),
        context.settings,
        context.run_id,
        context.clock,
    )
    # When executing the real isolated fixture command.
    result = execute_owner(case, context)
    # Then fresh sanitized artifacts remain available after temporary cleanup.
    assert result.result.outcome is Outcome.PASSED, result.result.reason
    assert result.result.cleanup_status == "passed"
    assert (
        context.settings.artifacts / result.evidence[0].path
    ).read_bytes() == b"controlled output"


def test_component_scope_keeps_unrelated_case_pending_when_not_selected(tmp_path: Path) -> None:
    # Given a scoped owner context and an intentionally unselected case.
    case = controlled_case()
    context = context_for(tmp_path, Mode.MOCK)
    preflight = PreflightContext(Mode.MOCK, {}, sys.platform, authorize_paid=False)
    # When dispatching only another declared selection.
    result = execute_case(case, context, preflight, frozenset())
    # Then no unrelated owner runs and the omitted criterion remains planned.
    assert result.result.criterion_status is Status.PLANNED
    assert result.result.reason == "not-selected"


def test_component_scope_blocks_when_selected_dependency_missing(tmp_path: Path) -> None:
    # Given a ready owner whose selected boundary actually requires an absent dependency.
    case = controlled_case().model_copy(update={"dependencies": ("creative-engine",)})
    context = context_for(tmp_path, Mode.MOCK)
    preflight = PreflightContext(Mode.MOCK, {}, sys.platform, authorize_paid=False)
    # When selecting this boundary.
    result = execute_case(case, context, preflight, frozenset({case.id}))
    # Then only the genuine dependency blocks its dispatch.
    assert result.result.criterion_status is Status.BLOCKED
    assert result.result.blocker_owner == "creative-engine"
