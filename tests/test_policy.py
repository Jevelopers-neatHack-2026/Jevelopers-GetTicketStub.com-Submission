from pathlib import Path

from integration_evals.artifacts import load_record
from integration_evals.benchmarks import Corpus
from integration_evals.policy import Policy, promotion

REPOSITORY = Path(__file__).resolve().parents[1]


def test_promotion_blocks_when_proposals_have_no_real_receipts() -> None:
    # Given proposed thresholds and methodology-only smoke inputs.
    policy = load_record(REPOSITORY / "benchmarks/policy.json", Policy)
    corpus = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    # When evaluating promotion without actual candidate/baseline evidence.
    result = promotion(policy, corpus, ())
    # Then proposals and empty runs cannot authorize live routing changes.
    assert result.verdict == "blocked"
    assert "actual required-mode candidate/baseline receipts missing" in result.reasons
    assert "numeric targets are absent or unratified" in result.reasons
