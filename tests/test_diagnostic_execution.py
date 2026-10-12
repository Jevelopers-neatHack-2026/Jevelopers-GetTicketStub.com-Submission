"""Real controlled owner execution followed by the existing pure comparison oracle."""

import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

from integration_evals.artifacts import digest, load_record
from integration_evals.cli import app
from integration_evals.comparison_archive import save_comparisons
from integration_evals.diagnostics import replay_comparisons
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import ComparisonCapture, Settings
from integration_evals.history import History, summarize_history
from integration_evals.history_archive import load_history, save_history
from integration_evals.models import Assertion, Case, Catalog, Outcome, Run, Suite
from integration_evals.replay import authorize_rerun
from integration_evals.reporting import Tracker
from integration_evals.runner import execute_captured
from tests.test_assembly import synthetic_workspace
from tests.test_evidence_claims import controlled_case

REPOSITORY = Path(__file__).resolve().parents[1]


def controlled_execution(
    root: Path, case: Case | None = None, cleanup_exit: int = 0
) -> tuple[Run, tuple[ComparisonCapture, ...], Suite, Settings]:
    assembly = synthetic_workspace(root)
    fixture = REPOSITORY / "tests/fixtures/diagnostic_owner.py"
    components = tuple(
        component.model_copy(
            update={
                "command": (sys.executable, str(fixture)),
                "cleanup_command": (sys.executable, "-c", f"import sys; sys.exit({cleanup_exit})"),
            }
        )
        if component.repository == "agent-harness"
        else component
        for component in assembly.components
    )
    catalog = Catalog(fixtures=())
    scenario = case or controlled_case().model_copy(
        update={"category": "functional", "quarantined": False}
    )
    suite = Suite(
        cases=(
            scenario.model_copy(
                update={
                    "assertions": (Assertion(observation="result", expected=False),),
                }
            ),
        )
    )
    assembly = assembly.model_copy(
        update={
            "components": components,
            "fixture_digest": digest(catalog.model_dump_json().encode()),
        }
    )
    manifest = root / "assembly.json"
    _ = manifest.write_text(assembly.model_dump_json())
    settings = Settings(root / "integration-evals", root, manifest)
    run, captures = execute_captured(suite, catalog, settings)
    return run, captures, suite, settings


def test_replays_real_captured_mismatch_twice_and_retains_every_receipt(tmp_path: Path) -> None:
    # Given a real contained synthetic protocol fixture and its evaluator mismatch.
    original, captures, suite, settings = controlled_execution(tmp_path)
    assert original.results[0].outcome is Outcome.FAILED
    assert original.results[0].evaluation_failure == "oracle-mismatch"
    assert len(captures) == 1
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    history = History(runs=(original,))
    output = tmp_path / "reports"
    first = save_history(history, output, tracker, suite, settings.artifacts)
    before = (first / "run.json").read_bytes()
    # When two diagnostic attempts reexecute the original comparison oracle.
    for _ in range(2):
        diagnostic = replay_comparisons(history, captures, suite)
        history = History(runs=(*history.runs, diagnostic))
        _ = save_history(history, output, tracker, suite, settings.artifacts)
    # Then all three actual evaluations remain measurable with original source evidence.
    retained = load_history(first, suite)
    assert retained == history
    assert (first / "run.json").read_bytes() == before
    assert tuple(run.attempt for run in retained.runs) == (0, 1, 2)
    assert all(run.evidence == original.evidence for run in retained.runs)
    assert all(run.evaluation_source_run == original.id for run in retained.runs[1:])
    assert summarize_history(retained, suite)[0].denominator == 3
    assert len(tuple(settings.artifacts.glob("run-*"))) == 1
    with pytest.raises(InvalidArtifactError, match="diagnostic_quarantine_or_limit"):
        _ = replay_comparisons(history, captures, suite)
    with pytest.raises(InvalidArtifactError, match="rerun_failure_provenance_missing"):
        authorize_rerun(original, suite, "owner redispatch remains denied")


def test_rejects_changed_captured_evidence_before_replay(tmp_path: Path) -> None:
    # Given real captured observations whose referenced retained artifact is later altered.
    original, captures, suite, settings = controlled_execution(tmp_path)
    _ = (settings.artifacts / original.evidence[0].path).write_bytes(b"altered")
    # When replaying the oracle.
    with pytest.raises(InvalidArtifactError, match="evidence_digest_mismatch"):
        _ = replay_comparisons(History(runs=(original,)), captures, suite)
    # Then no result can be generated using drifted immutable inputs.


def test_public_replay_uses_archived_oracle_inputs_without_owner_dispatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Given a captured real evaluator failure and its safe portable comparison bundle.
    original, captures, suite, settings = controlled_execution(tmp_path)
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    first = save_history(
        History(runs=(original,)), tmp_path / "reports", tracker, suite, settings.artifacts
    )
    save_comparisons(captures, original, first)
    monkeypatch.chdir(REPOSITORY)
    # When invoking local replay twice, including from the old original archive reference.
    for attempt in (1, 2):
        result = CliRunner().invoke(
            app, ["replay-evaluation", str(first), "--suite", str(first / "suite.json")]
        )
        _ = (tmp_path / f"cli-replay-{attempt}.log").write_text(result.output)
        assert result.exit_code == 2, result.output
    # Then preserved history reaches the cap and contains no new source evidence or owner outputs.
    retained = load_history(first, suite)
    assert len(retained.runs) == 3
    assert all(run.evidence == original.evidence for run in retained.runs)
    assert len(tuple(settings.artifacts.glob("run-*"))) == 1
    denied = CliRunner().invoke(
        app, ["replay-evaluation", str(first), "--suite", str(first / "suite.json")]
    )
    _ = (tmp_path / "cli-replay-denied.log").write_text(denied.output)
    assert denied.exit_code == 1
    assert load_history(first, suite) == retained
