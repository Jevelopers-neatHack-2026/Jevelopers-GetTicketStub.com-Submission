import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from integration_evals.artifacts import digest, load_record
from integration_evals.benchmark_receipts import BenchmarkReceipt, CandidatePin
from integration_evals.benchmarks import Corpus, CorpusRow, Sample, paired_family_interval
from integration_evals.models import Mode, Origin
from integration_evals.numeric_rules import MANDATORY_METRICS, NumericRules
from integration_evals.policy import Policy, Threshold, promotion

REPOSITORY = Path(__file__).resolve().parents[1]


def trial_sample(
    row: CorpusRow, pin: CandidatePin, trial: int, root: Path, *, correct: bool
) -> Sample:
    receipt = BenchmarkReceipt(
        row_id=row.id,
        candidate=pin.candidate,
        trial=trial,
        component=pin.component,
        component_revision=pin.revision,
        model=pin.model,
        config_digest=pin.config_digest,
        input_digest=row.input_digest,
        mode=Mode.LIVE,
        origin=Origin.LIVE,
        executed_at=datetime(2026, 10, 10, 12, tzinfo=UTC),
        prediction=row.label if correct else "incorrect",
        latency_ms=1,
        cost=Decimal(".01") if pin.candidate == "jev" else Decimal(1),
        downstream_cost=Decimal(0),
        owner_review_ref="inert unit fixture; never product evidence",
    )
    data = receipt.model_dump_json().encode()
    path = f"{row.id}-{pin.candidate}-{trial}.json"
    _ = (root / path).write_bytes(data)
    return Sample(
        row_id=row.id,
        candidate=pin.candidate,
        trial=trial,
        prediction=receipt.prediction,
        latency_ms=receipt.latency_ms,
        cost=receipt.cost,
        downstream_cost=receipt.downstream_cost,
        mode=receipt.mode,
        component_revision=pin.revision,
        config_digest=pin.config_digest,
        receipt_ref=path,
        receipt_digest=digest(data),
        executed_at=receipt.executed_at,
    )


def trial_policy(corpus: Corpus, pins: tuple[CandidatePin, ...]) -> Policy:
    thresholds = tuple(
        Threshold.model_validate_json(
            json.dumps(
                {
                    "id": f"{question}-{metric}",
                    "question": question,
                    "stratum": "*",
                    "metric": metric,
                    "relation": "minimum"
                    if metric in {"macro_f1", "precision", "recall", "coverage"}
                    else "maximum",
                    "limit": "0"
                    if metric in {"macro_f1", "precision", "recall", "coverage"}
                    else "100",
                    "owner": "unit fixture",
                    "decision_ref": "inert unit fixture",
                    "ratified": True,
                }
            )
        )
        for question in corpus.required_questions
        for metric in sorted(MANDATORY_METRICS)
    )
    return Policy(
        frozen_at=datetime(2026, 10, 10, tzinfo=UTC),
        corpus_digest=digest(corpus.model_dump_json().encode()),
        required_questions=corpus.required_questions,
        thresholds=thresholds,
        required_mode="live",
        minimum_cost_reduction=Decimal(0),
        maximum_f1_loss=Decimal(1),
        uncertainty_rule_ref="inert unit fixture",
        cost_policy_ref="inert unit fixture",
        latency_policy_ref="inert unit fixture",
        required_trials=2,
        candidates=pins,
        numeric_rules=NumericRules(
            owner_decision_ref="inert unit fixture",
            ratified=True,
            uncertainty_method="paired-family-accuracy",
            minimum_held_out=1,
            minimum_families=2,
            bootstrap_repeats=100,
            maximum_interval_width=2,
            minimum_lower_difference=0.5,
            safety_row_ids=(next(row.id for row in corpus.rows if row.split == "held-out"),),
        ),
    )


@pytest.mark.parametrize("later_trials_correct", [False, True])
def test_full_promotion_uses_every_paired_trial(
    tmp_path: Path, *, later_trials_correct: bool
) -> None:
    # Given complete hash-joined inert receipts, explicit policy and repeated trials.
    original = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    corpus = original.model_copy(
        update={
            "ratified": True,
            "minimum_calibration": 1,
            "minimum_held_out": 1,
            "minimum_per_stratum": 1,
            "rows": tuple(
                row.model_copy(
                    update={"reviewer_a": "A", "reviewer_b": "B", "adjudication": "unit fixture"}
                )
                for row in original.rows
            ),
        }
    )
    pins = tuple(
        CandidatePin(
            candidate=candidate,
            question=question,
            component="agent-harness",
            revision="a" * 40,
            model="inert fixture",
            config_digest=digest(b"config"),
        )
        for candidate in ("rules", "generative", "jev")
        for question in corpus.required_questions
    )
    held_out = tuple(row for row in corpus.rows if row.split == "held-out")
    samples = tuple(
        trial_sample(
            row,
            pin,
            trial,
            tmp_path,
            correct=(
                pin.candidate == "rules"
                or (
                    pin.candidate == "jev"
                    and (trial == 0 or later_trials_correct or row.id == held_out[0].id)
                )
                or (pin.candidate == "generative" and trial == 1)
            ),
        )
        for row in held_out
        for pin in pins
        if pin.question == row.question
        for trial in (0, 1)
    )
    # When the full promotion pipeline executes its uncertainty predicate.
    verdict = promotion(trial_policy(corpus, pins), corpus, samples, tmp_path)
    low, high = paired_family_interval(corpus.rows, samples, repeats=100)
    # Then adverse later trials fail the same policy that consistent wins satisfy.
    if later_trials_correct:
        assert verdict.verdict == "eligible-for-owner-review", verdict.reasons
        assert (low, high) == (0.5, 0.5)
    else:
        assert verdict.verdict == "failed", verdict.reasons
        assert verdict.reasons == ("owner confidence lower bound not met",)
        assert high < 0.5
