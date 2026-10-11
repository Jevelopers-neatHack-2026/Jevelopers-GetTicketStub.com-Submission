import sys
from pathlib import Path

import pytest

from integration_evals.artifacts import digest, load_record, read_bytes
from integration_evals.execution import OwnerContext, OwnerExecution
from integration_evals.models import Case, Mode, Origin, Outcome, Run, Status, Suite
from integration_evals.owner import execute_owner
from integration_evals.preflight import PreflightContext
from integration_evals.reporting import Tracker, save_run
from integration_evals.runner import execute_case
from tests.test_evidence_claims import context_for, controlled_case


def owner_context(tmp_path: Path) -> OwnerContext:
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
    return OwnerContext(
        context.assembly.model_copy(
            update={
                "components": (component,),
                "kind": "component",
                "fixture_digest": digest(b"controlled output"),
                "runtime": sys.version,
            }
        ),
        context.settings,
        context.run_id,
        context.clock,
    )


def archive_owner_execution(case: Case, context: OwnerContext, execution: OwnerExecution) -> Path:
    suite = Suite(cases=(case,))
    run = Run(
        id=context.run_id,
        started_at=context.clock,
        context=context.settings.context,
        scope=context.assembly.kind,
        selected_case_ids=(case.id,),
        integration_revision=context.assembly.integration_revision,
        source_digest=digest(read_bytes(Path(__file__).parent / "fixtures/owner_output.py")),
        working_tree_dirty=False,
        manifest_digest=digest(context.assembly.model_dump_json().encode()),
        suite_digest=digest(suite.model_dump_json().encode()),
        fixture_digest=context.assembly.fixture_digest,
        configuration_digest=context.assembly.configuration_digest,
        runtime=context.assembly.runtime,
        seed=context.settings.seed,
        clock=context.clock,
        components=context.assembly.components,
        providers=context.assembly.providers,
        results=(execution.result,),
        evidence=execution.evidence,
        limitations=("Synthetic owner-protocol fixture; no product authority.",),
    )
    tracker = load_record(
        Path(__file__).resolve().parents[1] / "planning/acceptance-checklist.json", Tracker
    )
    return save_run(
        run, context.settings.workspace / "reports", tracker, suite, context.settings.artifacts
    )


def test_owner_output_survives_when_isolated_command_and_cleanup_finish(tmp_path: Path) -> None:
    # Given an inert owner protocol fixture that emits fresh bytes through the process boundary.
    case = controlled_case()
    context = owner_context(tmp_path)
    # When executing the real isolated fixture command.
    result = execute_owner(case, context)
    archive = archive_owner_execution(case, context, result)
    # Then fresh sanitized artifacts remain available after temporary cleanup.
    assert result.result.outcome is Outcome.PASSED, result.result.reason
    assert result.result.cleanup_status == "passed"
    assert result.result.exit_code == 0
    assert (
        context.settings.artifacts / result.evidence[0].path
    ).read_bytes() == b"controlled output"
    saved = load_record(archive / "run.json", Run)
    assert saved.results == (result.result,)
    assert (archive / saved.evidence[0].path).read_bytes() == b"controlled output"


@pytest.mark.parametrize("fault", ["wrong-digest", "missing-artifact"])
def test_owner_error_is_archived_when_output_retention_is_rejected(
    tmp_path: Path, fault: str
) -> None:
    # Given a real owner command with correct observations but invalid artifact availability.
    case = controlled_case().model_copy(update={"fault": fault})
    context = owner_context(tmp_path)
    # When the isolated owner completes and the normal immutable archive path consumes its result.
    execution = execute_owner(case, context)
    assert execution.result.exit_code == 0
    assert execution.result.cleanup_status == "passed"
    assert execution.result.output_digest not in (None, digest(b""))
    archive = archive_owner_execution(case, context, execution)
    # Then the saved error keeps execution diagnostics without accepting rejected evidence or costs.
    saved = load_record(archive / "run.json", Run)
    result = saved.results[0]
    assert result == execution.result
    assert result.outcome is Outcome.ERROR
    assert result.reason == "invalid owner response or runtime failure; private payload withheld"
    assert result.blocker_owner == case.component
    assert result.criterion_status is Status.IN_PROGRESS
    assert (result.mode, result.origin) == (Mode.MOCK, Origin.SYNTHETIC)
    assert result.cost is None
    assert result.cost_status == "unknown"
    assert result.evidence_ids == ()
    assert saved.evidence == ()
    assert load_record(archive / "suite.json", Suite) == Suite(cases=(case,))
    assert (archive / "junit.xml").read_bytes().count(b"<error ") == 1
    original = (archive / "run.json").read_bytes()
    with pytest.raises(FileExistsError):
        _ = archive_owner_execution(case, context, execution)
    assert (archive / "run.json").read_bytes() == original


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
