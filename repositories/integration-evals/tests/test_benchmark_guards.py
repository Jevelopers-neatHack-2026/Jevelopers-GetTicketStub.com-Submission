from decimal import Decimal
from pathlib import Path

from integration_evals.artifacts import digest, load_record
from integration_evals.benchmark_receipts import CandidatePin, validate_receipts
from integration_evals.benchmarks import Corpus, Sample
from integration_evals.models import Mode
from integration_evals.numeric_rules import NumericRules, evaluate_rules, register_blockers

REPOSITORY = Path(__file__).resolve().parents[1]


def test_receipts_block_when_candidate_pin_changes_between_rows(tmp_path: Path) -> None:
    # Given a frozen candidate and a sample from a different revision.
    corpus = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    row = corpus.rows[1]
    pin = CandidatePin(
        candidate="jev",
        question=row.question,
        component="agent-harness",
        revision="a" * 40,
        model="fixture-model",
        config_digest=digest(b"frozen"),
    )
    sample = Sample(
        row_id=row.id,
        candidate="jev",
        prediction=row.label,
        latency_ms=1,
        mode=Mode.LIVE,
        component_revision="b" * 40,
        config_digest=digest(b"changed"),
        cost=Decimal(1),
        downstream_cost=Decimal(0),
        receipt_ref="nonexistent",
    )
    # When joining actual samples to immutable predeclared identities.
    blockers = validate_receipts((pin,), corpus, (sample,), tmp_path)
    # Then per-row candidate selection cannot manufacture a passing improvement.
    assert "candidate revision/configuration differs from frozen identity" in blockers


def test_receipts_block_when_reference_has_no_artifact(tmp_path: Path) -> None:
    # Given matching scalar pins but no actual referenced owner receipt.
    corpus = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    row = corpus.rows[1]
    pin = CandidatePin(
        candidate="jev",
        question=row.question,
        component="agent-harness",
        revision="a" * 40,
        model="fixture-model",
        config_digest=digest(b"frozen"),
    )
    sample = Sample(
        row_id=row.id,
        candidate="jev",
        prediction=row.label,
        latency_ms=1,
        mode=Mode.LIVE,
        component_revision=pin.revision,
        config_digest=pin.config_digest,
        receipt_ref="missing.json",
        receipt_digest=digest(b"missing"),
    )
    # When verifying actual immutable bytes.
    blockers = validate_receipts((pin,), corpus, (sample,), tmp_path)
    # Then a nonempty string is insufficient evidence.
    assert "sample owner receipt unavailable" in blockers


def test_register_blocks_when_latency_and_safety_targets_missing() -> None:
    # Given only a quality threshold for each question.
    rules = NumericRules(
        owner_decision_ref="fixture",
        ratified=True,
        uncertainty_method="paired-family-accuracy",
        minimum_held_out=1,
        minimum_families=2,
        bootstrap_repeats=100,
        maximum_interval_width=1,
        minimum_lower_difference=-1,
        safety_row_ids=("safety",),
    )
    # When checking mandatory executable policy coverage.
    blockers = register_blockers(rules, (("question", "macro_f1"),), ("question",))
    # Then omitted latency, abstention and deterministic safety rules block eligibility.
    assert blockers


def test_uncertainty_fails_when_owner_requires_more_families() -> None:
    # Given a valid smoke corpus below an explicit owner uncertainty requirement.
    corpus = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    rules = NumericRules(
        owner_decision_ref="fixture",
        ratified=True,
        uncertainty_method="paired-family-accuracy",
        minimum_held_out=1000,
        minimum_families=1000,
        bootstrap_repeats=100,
        maximum_interval_width=1,
        minimum_lower_difference=-1,
        safety_row_ids=(corpus.rows[1].id,),
    )
    # When executing the numeric coverage predicate.
    failures = evaluate_rules(rules, corpus, ())
    # Then reference prose cannot bypass the actual sample/family count.
    assert "owner minimum independent family count not met" in failures
