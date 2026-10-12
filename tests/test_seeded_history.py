"""A seeded synthetic owner emits alternating observations through the real runner."""

from pathlib import Path
from random import Random
from uuid import UUID

import pytest

from integration_evals.artifacts import load_record
from integration_evals.history import History, summarize_history
from integration_evals.history_archive import load_history, save_history
from integration_evals.models import Catalog, Outcome
from integration_evals.replay import link_rerun
from integration_evals.reporting import Tracker
from integration_evals.runner import execute_captured
from tests.test_diagnostic_execution import REPOSITORY, controlled_execution
from tests.test_evidence_claims import controlled_case


def test_seeded_alternating_real_observations_preserve_original_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Given fixed source/config/seed and explicitly injected seeded run-ID parity.
    random = Random(17)  # noqa: S311 - repeatable fixture namespaces, never credentials
    identities = iter(UUID(int=(random.getrandbits(128) & ~1) | parity) for parity in (0, 1, 0))
    monkeypatch.setattr("integration_evals.runner.uuid4", lambda: next(identities))
    case = controlled_case().model_copy(
        update={"category": "functional", "quarantined": False, "fault": "seeded-alternation"}
    )
    original, _, suite, settings = controlled_execution(tmp_path, case)
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    history = History(runs=(original,))
    first = save_history(history, tmp_path / "reports", tracker, suite, settings.artifacts)
    # When three separately requested real contained fixture executions are recorded.
    for _ in range(2):
        candidate, _ = execute_captured(suite, Catalog(fixtures=()), settings)
        linked = link_rerun(history.runs, candidate, suite, "seeded controlled fixture observation")
        history = History(runs=(*history.runs, linked))
        _ = save_history(history, tmp_path / "reports", tracker, suite, settings.artifacts)
    # Then the complete measured denominator retains fail/pass/fail and blocks release.
    retained = load_history(first, suite)
    row = summarize_history(retained, suite)[0]
    assert row.outcomes == (Outcome.FAILED, Outcome.PASSED, Outcome.FAILED)
    assert (row.classification, row.failures, row.denominator, row.release_blocked) == (
        "flaky",
        2,
        3,
        True,
    )
    assert len(tuple(settings.artifacts.glob("run-*"))) == 3
