from decimal import Decimal
from pathlib import Path

import pytest

from integration_evals.artifacts import digest, load_record
from integration_evals.benchmarks import (
    Corpus,
    Sample,
    paired_family_interval,
    summarize,
    validate_corpus,
)
from integration_evals.errors import InvalidArtifactError
from integration_evals.models import Mode

REPOSITORY = Path(__file__).resolve().parents[1]


def test_rejects_corpus_when_family_leaks_across_splits() -> None:
    # Given related variants incorrectly assigned to calibration and final evaluation.
    corpus = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    leaked = corpus.rows[1].model_copy(update={"family": corpus.rows[0].family})
    modified = corpus.model_copy(update={"rows": (corpus.rows[0], leaked)})
    # When checking the frozen split.
    with pytest.raises(InvalidArtifactError, match="held_out_split_leakage"):
        _ = validate_corpus(modified)
    # Then tuning/evaluation overlap is rejected.


def test_blocks_promotion_when_smoke_corpus_looks_clean() -> None:
    # Given a structurally valid smoke corpus below the owner-required sample sizes.
    corpus = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    # When requesting promotion.
    with pytest.raises(InvalidArtifactError, match="promotion_corpus_blocked"):
        _ = validate_corpus(corpus, promotion=True)
    # Then methodology fixtures cannot establish live routing quality.


def test_metrics_preserve_unknown_cost_when_prediction_correct() -> None:
    # Given one correct held-out result with unobserved downstream cost.
    corpus = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    row = corpus.rows[1]
    samples = (
        Sample(
            row_id=row.id,
            candidate="jev",
            prediction=row.label,
            latency_ms=120,
            cost=Decimal("0.01"),
            downstream_cost=None,
            mode=Mode.MOCK,
            component_revision="a" * 40,
            config_digest=digest(b"config"),
        ),
    )
    # When computing this question/stratum slice.
    metrics = summarize(samples, corpus.rows, "jev", row.question, row.stratum)
    # Then accuracy may pass while cost evidence remains incomplete.
    assert metrics.macro_f1 == 1
    assert metrics.unknown_cost_rate == 1
    assert metrics.cost_per_success is None


def test_metrics_count_abstention_as_false_negative_when_answer_required() -> None:
    # Given an abstained decision on a labeled held-out case.
    corpus = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    row = corpus.rows[1]
    samples = (
        Sample(
            row_id=row.id,
            candidate="jev",
            prediction=None,
            latency_ms=20,
            cost=Decimal(0),
            downstream_cost=Decimal(0),
            mode=Mode.MOCK,
            component_revision="a" * 40,
            config_digest=digest(b"config"),
            critical=True,
        ),
    )
    # When calculating quality and safety metrics.
    metrics = summarize(samples, corpus.rows, "jev", row.question, row.stratum)
    # Then abstention cannot silently improve recall or hide a critical miss.
    assert metrics.recall == 0
    assert metrics.abstention_rate == 1
    assert metrics.critical_false_negatives == 1


def test_interval_rejects_when_baseline_pair_missing() -> None:
    # Given frozen held-out rows without matching candidate/baseline receipts.
    corpus = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    # When computing a paired family interval.
    with pytest.raises(InvalidArtifactError, match="unpaired_baseline_samples"):
        _ = paired_family_interval(corpus.rows, ())
    # Then a fabricated comparison cannot be reported.
