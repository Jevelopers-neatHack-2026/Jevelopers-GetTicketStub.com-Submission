"""Every unsafe or unproven capture stops before any diagnostic evaluation."""

from pathlib import Path

import pytest

from integration_evals.artifacts import load_record
from integration_evals.diagnostics import replay_comparisons
from integration_evals.errors import InvalidArtifactError
from integration_evals.history import History
from integration_evals.history_archive import save_history
from integration_evals.models import CaseId, Outcome
from integration_evals.reporting import Tracker
from tests.test_diagnostic_execution import REPOSITORY, controlled_execution
from tests.test_evidence_claims import controlled_case


@pytest.mark.parametrize(
    "identity", ["supplier-ambiguity", "restart-after-external-success", "authorization-mutation"]
)
def test_named_guards_stop_real_captured_mismatch(tmp_path: Path, identity: str) -> None:
    # Given an actual comparison failure on a named unsafe case despite safety=False.
    case = controlled_case().model_copy(
        update={"id": CaseId(identity), "category": "functional", "quarantined": False}
    )
    original, captures, suite, settings = controlled_execution(tmp_path, case)
    assert original.results[0].outcome is Outcome.FAILED
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    _ = save_history(
        History(runs=(original,)), tmp_path / "reports", tracker, suite, settings.artifacts
    )
    # When attempting the optional pure diagnostic.
    with pytest.raises(InvalidArtifactError, match="safety_or_ambiguity_rerun_forbidden"):
        _ = replay_comparisons(History(runs=(original,)), captures, suite)
    # Then no second owner or evaluator run is recorded.
    assert len(tuple((tmp_path / "reports").glob("*/run.json"))) == 1


@pytest.mark.parametrize("category", [None, "safety", "authorization", "benchmark"])
def test_frozen_category_must_prove_functional(tmp_path: Path, category: str | None) -> None:
    # Given a successful capture without explicit frozen functional scope.
    case = controlled_case().model_copy(update={"category": category, "quarantined": False})
    original, captures, suite, _ = controlled_execution(tmp_path, case)
    # When requesting a diagnostic.
    with pytest.raises(InvalidArtifactError, match="diagnostic_category_or_quarantine_unproven"):
        _ = replay_comparisons(History(runs=(original,)), captures, suite)
    # Then an unset or unsafe category cannot be inferred from the mismatch.


@pytest.mark.parametrize("quarantined", [True, None])
def test_quarantine_must_be_explicitly_absent(tmp_path: Path, quarantined: bool | None) -> None:
    # Given a frozen functional case with quarantine present or unknown.
    case = controlled_case().model_copy(
        update={"category": "functional", "quarantined": quarantined}
    )
    original, captures, suite, _ = controlled_execution(tmp_path, case)
    # When requesting a diagnostic.
    with pytest.raises(InvalidArtifactError, match="diagnostic_category_or_quarantine_unproven"):
        _ = replay_comparisons(History(runs=(original,)), captures, suite)
    # Then caller prose cannot substitute for a known quarantine state.


@pytest.mark.parametrize("fault", ["unavailable-dependency", "failed-cleanup", "invalid-output"])
def test_real_environment_errors_never_create_replay_capture(tmp_path: Path, fault: str) -> None:
    # Given an unavailable dependency, unsuccessful cleanup or rejected artifact.
    case = controlled_case().model_copy(
        update={
            "category": "functional",
            "quarantined": False,
            "dependencies": ("unavailable-owner",) if fault == "unavailable-dependency" else (),
            "fault": "missing-artifact" if fault == "invalid-output" else None,
        }
    )
    original, captures, suite, settings = controlled_execution(
        tmp_path, case, int(fault == "failed-cleanup")
    )
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    _ = save_history(
        History(runs=(original,)), tmp_path / "reports", tracker, suite, settings.artifacts
    )
    # When attempting to replay the failed boundary.
    with pytest.raises(InvalidArtifactError, match="diagnostic_capture_missing"):
        _ = replay_comparisons(History(runs=(original,)), captures, suite)
    # Then blocked/error provenance is retained without an eligible comparison capability.
    assert original.results[0].outcome in {Outcome.SKIPPED, Outcome.ERROR}
    assert captures == ()


def test_private_observation_is_never_exported(tmp_path: Path) -> None:
    # Given actual owner output containing private text outside the allowed public oracle values.
    case = controlled_case().model_copy(
        update={"category": "functional", "quarantined": False, "fault": "private-observation"}
    )
    original, captures, suite, settings = controlled_execution(tmp_path, case)
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    # When saving the original failed evaluation through normal history reporting.
    archive = save_history(
        History(runs=(original,)), tmp_path / "reports", tracker, suite, settings.artifacts
    )
    # Then the original failure survives but its private comparison payload cannot escape.
    assert original.results[0].outcome is Outcome.FAILED
    assert captures == ()
    assert original.comparison_digest is None
    assert not (archive / "comparisons.json").exists()
    assert all(
        b"private-person@example.test" not in path.read_bytes()
        for path in archive.rglob("*")
        if path.is_file()
    )
