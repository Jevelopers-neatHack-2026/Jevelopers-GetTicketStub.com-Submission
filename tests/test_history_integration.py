"""Complete historical outcomes must reach the normal coverage/release boundary."""

from pathlib import Path

import pytest

from integration_evals.artifacts import load_record
from integration_evals.errors import InvalidArtifactError
from integration_evals.history import History, summarize_history
from integration_evals.models import Outcome, Run, Status, Suite
from integration_evals.release import audit
from integration_evals.replay import link_rerun
from integration_evals.reporting import Tracker, coverage
from integration_evals.specifications import Requirements
from tests.test_replay_history import later
from tests.test_replay_history import synthetic_failure as failure_fixture

synthetic_failure = failure_fixture

REPOSITORY = Path(__file__).resolve().parents[1]


def test_preserves_failure_in_reporting_and_release(synthetic_failure: tuple[Run, Suite]) -> None:
    # Given a failed original followed by a separately recorded pass.
    original, suite = synthetic_failure
    passed = link_rerun(original, later(original, Outcome.PASSED), suite, "diagnostic")
    history = History(runs=(original, passed))
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    requirements = load_record(REPOSITORY / "planning/requirements.json", Requirements)
    # When the full history enters the actual reporting/release functions.
    rows = summarize_history(history, suite)
    receipt = audit(history, tracker, requirements, suite)
    # Then the earlier failure is measured and blocks its release obligation.
    assert rows[0].classification == "flaky"
    assert (rows[0].failures, rows[0].denominator, rows[0].release_blocked) == (1, 2, True)
    assert (
        next(row for row in receipt.obligations if row.id == "IE-09B.AC2").state is Status.BLOCKED
    )
    assert coverage(history, tracker)


def test_coverage_rejects_wrapped_latest_only_history(synthetic_failure: tuple[Run, Suite]) -> None:
    # Given a later passing diagnostic that omits the original failed ancestor.
    original, suite = synthetic_failure
    passed = link_rerun(original, later(original, Outcome.PASSED), suite, "diagnostic")
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    # When the direct coverage API is given a latest-only History wrapper.
    with pytest.raises(InvalidArtifactError, match="complete_history_required"):
        _ = coverage(History(runs=(passed,)), tracker)
    # Then wrapping cannot erase the original failure at this report boundary.
