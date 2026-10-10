from pathlib import Path

import pytest
from typer.testing import CliRunner

from integration_evals.artifacts import load_record
from integration_evals.cli import app
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import Settings
from integration_evals.models import Catalog, Mode, Outcome, Run, Status, Suite
from integration_evals.report_validation import validate_run
from integration_evals.reporting import Tracker, junit, save_run
from integration_evals.runner import execute

REPOSITORY = Path(__file__).resolve().parents[1]


def absent_assembly() -> Run:
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    return execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))


def test_blocks_all_product_cases_when_composed_release_missing() -> None:
    # Given scenario oracles and fixtures without an app-owned assembly.
    # When executing the product suite.
    run = absent_assembly()
    # Then no mock service or fabricated component pin substitutes for the release.
    assert all(result.outcome is Outcome.SKIPPED for result in run.results)
    assert all(result.criterion_status is Status.BLOCKED for result in run.results)
    assert run.components == ()


def test_junit_retains_blockers_when_no_tests_executed() -> None:
    # Given an honestly blocked product execution.
    run = absent_assembly()
    # When exporting CI results.
    output = junit(run.results)
    # Then CI reports skipped cases rather than a passing suite.
    assert output.count(b"<skipped ") == len(run.results)


def test_rejects_run_when_mock_promotes_authoritative_criteria() -> None:
    # Given a blocked receipt altered to claim verified acceptance.
    run = absent_assembly()
    altered = run.results[0].model_copy(update={"criterion_status": Status.VERIFIED})
    forged = run.model_copy(update={"results": (altered,)})
    # When validating the claim.
    with pytest.raises(InvalidArtifactError, match="unreviewed_tracker_promotion"):
        validate_run(forged, load_record(REPOSITORY / "scenarios/suite.json", Suite))
    # Then the unchanged canonical tracker remains authoritative.


def test_rejects_run_when_unknown_cost_becomes_zero() -> None:
    # Given an unknown billing outcome with a forged zero amount.
    run = absent_assembly()
    altered = run.results[0].model_copy(update={"cost": 0})
    forged = run.model_copy(update={"results": (altered,)})
    # When validating the report.
    with pytest.raises(InvalidArtifactError, match="unknown_cost_has_amount"):
        validate_run(forged, load_record(REPOSITORY / "scenarios/suite.json", Suite))
    # Then zero is never substituted for unobserved cost.


def test_preserves_failure_when_same_run_id_saved_again(tmp_path: Path) -> None:
    # Given a previously saved immutable receipt.
    run = absent_assembly()
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    _ = save_run(run, tmp_path, tracker, suite)
    # When attempting to replace its history.
    with pytest.raises(FileExistsError):
        _ = save_run(run, tmp_path, tracker, suite)
    # Then the original result still exists byte-for-byte.
    assert load_record(tmp_path / run.id / "run.json", Run) == run


def test_cli_exits_blocked_when_real_release_unavailable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Given the real CLI and a repository without an assembly manifest.
    monkeypatch.chdir(REPOSITORY)
    runner = CliRunner()
    # When running the public command surface.
    result = runner.invoke(app, ["run", "--output", str(tmp_path)])
    # Then exit 2 and immutable receipts make incompleteness observable.
    assert result.exit_code == 2, result.output
    assert len(tuple(tmp_path.glob("run-*/run.json"))) == 1


def test_live_profile_stays_blocked_when_credentials_and_assembly_absent() -> None:
    # Given a request for live mode without its owner-provided prerequisites.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    # When evaluating the gated profile.
    run = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None, Mode.LIVE))
    validate_run(run, suite)
    # Then missing live evidence is reported without a mock fallback.
    assert all(
        result.mode is Mode.LIVE and result.outcome is Outcome.SKIPPED for result in run.results
    )
