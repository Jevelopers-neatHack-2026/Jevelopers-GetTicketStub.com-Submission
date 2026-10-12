"""Immutable snapshots, stale writers and quarantine remain fail closed."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError
from typer.testing import CliRunner

from integration_evals.artifacts import load_record
from integration_evals.cli import app
from integration_evals.errors import InvalidArtifactError
from integration_evals.history import History, Quarantine, summarize_history
from integration_evals.history_archive import load_history, save_history
from integration_evals.models import Run, Suite
from integration_evals.replay import link_rerun
from integration_evals.reporting import Tracker
from tests.test_replay_history import later
from tests.test_replay_history import synthetic_failure as failure_fixture

synthetic_failure = failure_fixture
REPOSITORY = Path(__file__).resolve().parents[1]


def retained_history(sample: tuple[Run, Suite], root: Path) -> tuple[History, Tracker, Path]:
    original, suite = sample
    _ = (root / "result.json").write_bytes(b"synthetic observation")
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    history = History(runs=(original, link_rerun(original, later(original), suite, "diagnostic")))
    path = save_history(history, root / "reports", tracker, suite, root)
    return history, tracker, path


@pytest.mark.parametrize(
    "mutation", ["omission", "outcome", "successor", "private", "symlink", "deleted-link"]
)
def test_rejects_tampered_retained_history(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path, mutation: str
) -> None:
    # Given saved original and diagnostic snapshots.
    history, _, path = retained_history(synthetic_failure, tmp_path)
    original = path.parent / history.runs[0].id
    # When an immutable ancestor, link or its bytes are altered.
    if mutation == "omission":
        (original / "history.json").unlink()
    elif mutation == "outcome":
        data = (original / "run.json").read_text().replace('"failed"', '"error"')
        _ = (original / "run.json").write_text(data)
    elif mutation == "successor":
        _ = (original / "successor.json").write_text(
            '{"run_id":"../escape","history_digest":"' + "a" * 64 + '"}'
        )
    elif mutation == "deleted-link":
        (original / "successor.json").unlink()
    elif mutation == "private":
        _ = (original / "history.json").write_text('{"password":"IE_SECRET_CANARY_TEST"}')
    else:
        (original / "history.json").unlink()
        (original / "history.json").symlink_to(path / "history.json")
    with pytest.raises((InvalidArtifactError, OSError, ValidationError)):
        _ = load_history(original, synthetic_failure[1])
    # Then history cannot hide a missing, changed, private or redirected original.


def test_one_successor_wins_when_two_writers_race(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path
) -> None:
    # Given a durable original and two candidates for its first diagnostic.
    original, suite = synthetic_failure
    _ = (tmp_path / "result.json").write_bytes(b"synthetic observation")
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    first = save_history(History(runs=(original,)), tmp_path / "reports", tracker, suite, tmp_path)
    candidates = tuple(
        History(
            runs=(
                original,
                link_rerun(
                    original,
                    later(original).model_copy(
                        update={
                            "id": identity,
                            "evidence": tuple(
                                item.model_copy(update={"run_id": identity})
                                for item in original.evidence
                            ),
                        }
                    ),
                    suite,
                    "diagnostic",
                ),
            )
        )
        for identity in ("first-writer", "second-writer")
    )

    def append(history: History) -> bool:
        try:
            _ = save_history(history, first.parent, tracker, suite, tmp_path)
        except InvalidArtifactError:
            return False
        return True

    # When both writers compete for the same parent.
    with ThreadPoolExecutor(max_workers=2) as executor:
        winners = tuple(executor.map(append, candidates))
    # Then one append wins and the retained denominator is exactly two.
    assert sorted(winners) == [False, True]
    assert len(load_history(first, suite).runs) == 2


def test_expired_quarantine_remains_blocked_on_public_cli(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path
) -> None:
    # Given an explicitly owned quarantine whose expiry is already past.
    original, suite = synthetic_failure
    item = Quarantine(
        case_id=original.results[0].case_id,
        owner="reliability",
        remediation_issue="https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/21",
        reason="controlled local reproduction",
        expires_at=datetime(2020, 1, 1, tzinfo=UTC),
    )
    history = History(runs=(original,), quarantines=(item,))
    _ = (tmp_path / "result.json").write_bytes(b"synthetic observation")
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    saved = save_history(history, tmp_path / "reports", tracker, suite, tmp_path)
    # When normal CLI history reporting examines the retained quarantine.
    result = CliRunner().invoke(
        app, ["history-report", str(saved), "--suite", str(saved / "suite.json")]
    )
    _ = (tmp_path / "cli-output.json").write_text(result.output)
    # Then expiry requests triage without improving release coverage.
    assert result.exit_code == 2
    row = summarize_history(load_history(saved, suite), suite)[0]
    assert row.release_blocked
    assert row.quarantine_expired
    assert row.classification == "blocked"
