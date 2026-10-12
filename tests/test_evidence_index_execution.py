"""IE-09A/IE-09B evidence joins over actual contained owner execution and replay."""

from pathlib import Path

from integration_evals.diagnostics import replay_comparisons
from integration_evals.history import History
from integration_evals.models import Outcome
from tests.test_diagnostic_execution import controlled_execution
from tests.test_evidence_index import index


def test_real_offline_execution_and_comparison_replay_join_same_original(tmp_path: Path) -> None:
    original, captures, suite, settings = controlled_execution(tmp_path)
    assert original.results[0].outcome is Outcome.FAILED
    assert original.results[0].evaluation_failure == "oracle-mismatch"
    assert len(captures) == 1
    diagnostic = replay_comparisons(History(runs=(original,)), captures, suite)
    history = History(runs=(original, diagnostic))
    output = index(history, suite, settings.artifacts)
    row = next(r for r in output.requirements if r.requirement == "IE-01.AC5")
    assert row.samples[1].execution_kind == "recorded-evaluation-replay"
    assert row.samples[1].source_run_id == original.id
    assert output.case_history[0].classification == "consistently_failed"
    assert output.case_history[0].denominator == 2
    assert len(output.artifacts) == len(original.evidence)
    assert all(a.bytes_checked for a in output.artifacts)
