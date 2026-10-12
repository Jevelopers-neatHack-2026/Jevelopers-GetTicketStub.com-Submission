import shutil
import sys
from pathlib import Path
from typing import Literal, assert_never

import pytest
from typer.testing import CliRunner

from integration_evals.artifacts import load_record
from integration_evals.cli import app
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import OwnerContext
from integration_evals.models import Mode, Origin, Outcome, Run, Status, Suite
from integration_evals.owner import execute_owner
from integration_evals.preflight import PreflightContext
from integration_evals.report_validation import validate_evidence, validate_run
from integration_evals.reporting import Tracker, save_run
from integration_evals.runner import execute_case
from tests.test_evidence_claims import context_for, controlled_case
from tests.test_owner_output import archive_owner_execution, owner_context


@pytest.mark.parametrize("mode", [Mode.RECORDED, Mode.SANDBOX, Mode.LIVE])
@pytest.mark.parametrize("surface", ["runner", "owner"])
def test_mock_retrieval_capability_blocks_other_modes(
    tmp_path: Path, mode: Mode, surface: Literal["runner", "owner"]
) -> None:
    # Given the unchanged Linux case and an owner that declares only mock execution support.
    suite = load_record(Path(__file__).resolve().parents[1] / "scenarios/suite.json", Suite)
    case = next(case for case in suite.cases if case.id == "ssrf-egress")
    context = context_for(tmp_path, mode)
    component = context.assembly.components[0].model_copy(
        update={
            "repository": case.component,
            "supported_modes": (Mode.MOCK,),
            "command": (sys.executable, "-c", "raise RuntimeError('hook must not start')"),
            "cleanup_command": (sys.executable, "-c", "pass"),
        }
    )
    context = OwnerContext(
        context.assembly.model_copy(update={"components": (component,)}),
        context.settings,
        context.run_id,
        context.clock,
    )
    # When selecting the component under an unsupported requested transport mode.
    match surface:
        case "runner":
            result = execute_case(
                case,
                context,
                PreflightContext(mode, {}, "linux", authorize_paid=False),
                frozenset({case.id}),
            )
        case "owner":
            result = execute_owner(case, context)
        case _:
            assert_never(surface)
    # Then dispatch is blocked before starting a mock hook and the requested mode is preserved.
    assert result.result.outcome is Outcome.SKIPPED
    assert result.result.criterion_status is Status.BLOCKED
    assert result.result.reason == "owner adapter mode unsupported"
    assert result.result.mode is mode
    assert result.result.exit_code is None
    assert mode in case.modes


def test_legacy_receipt_remains_valid_without_component_capabilities(tmp_path: Path) -> None:
    # Given a real inert owner receipt serialized with the original component fields only.
    case = controlled_case()
    context = owner_context(tmp_path)
    result = execute_owner(case, context)
    archive = archive_owner_execution(case, context, result)
    run = load_record(archive / "run.json", Run)
    legacy = run.model_dump_json(exclude={"components": {"__all__": {"supported_modes"}}})
    # When the current reader loads and independently validates that historical record.
    loaded = Run.model_validate_json(legacy)
    validate_run(loaded, Suite(cases=(case,)))
    validate_evidence(loaded.evidence, archive, loaded)
    # Then omitted capability declarations keep their original behavior and artifact identity.
    assert loaded.results[0].outcome is Outcome.PASSED
    assert loaded.components[0].supported_modes is None
    assert loaded.evidence == run.evidence


def test_declared_mock_capability_rejects_a_consistent_live_archive(tmp_path: Path) -> None:
    # Given a valid real owner archive whose component explicitly supports mock mode only.
    case = controlled_case()
    context = owner_context(tmp_path)
    component = context.assembly.components[0].model_copy(update={"supported_modes": (Mode.MOCK,)})
    context = OwnerContext(
        context.assembly.model_copy(update={"components": (component,)}),
        context.settings,
        context.run_id,
        context.clock,
    )
    execution = execute_owner(case, context)
    archive = archive_owner_execution(case, context, execution)
    runner = CliRunner()
    trusted_suite = archive / "suite.json"
    assert (
        runner.invoke(
            app, ["inspect", str(archive / "run.json"), "--suite", str(trusted_suite)]
        ).exit_code
        == 0
    )
    original = load_record(archive / "run.json", Run)
    forged = original.model_copy(
        update={
            "results": (
                original.results[0].model_copy(update={"mode": Mode.LIVE, "origin": Origin.LIVE}),
            ),
            "evidence": tuple(
                item.model_copy(update={"mode": Mode.LIVE, "origin": Origin.LIVE})
                for item in original.evidence
            ),
        }
    )
    copied = tmp_path / "forged"
    _ = shutil.copytree(archive, copied)
    _ = (copied / "run.json").write_text(forged.model_dump_json(), encoding="utf-8")
    # When result/evidence labels are forged consistently but the capability stays mock.
    inspected = runner.invoke(
        app, ["inspect", str(copied / "run.json"), "--suite", str(trusted_suite)]
    )
    # Then independent inspection and persistence reject the capability mismatch.
    assert inspected.exit_code == 1
    assert "archived_component_mode_mismatch" in inspected.output
    tracker = load_record(
        Path(__file__).resolve().parents[1] / "planning/acceptance-checklist.json", Tracker
    )
    with pytest.raises(InvalidArtifactError, match="archived_component_mode_mismatch"):
        _ = save_run(forged, tmp_path / "forged-save", tracker, Suite(cases=(case,)), copied)
