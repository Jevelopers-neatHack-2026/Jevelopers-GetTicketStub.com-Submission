"""Frozen held-out corpus checks and statistics; no provider transport or tuning."""

import math
from datetime import datetime
from decimal import Decimal
from random import Random
from statistics import mean
from typing import Final, Literal

from pydantic import Field

from integration_evals.errors import fail
from integration_evals.models import Digest, Mode, Record, Revision

MIN_BOOTSTRAP_REPEATS: Final = 100


class CorpusRow(Record):
    """Labeled question with independent adjudication and family-level splitting."""

    id: str
    family: str
    question: str
    language: str
    stratum: str
    split: Literal["calibration", "held-out"]
    input_digest: Digest
    label: str
    allowed_abstention: bool
    permission: str
    rationale: str
    reviewer_a: str | None = None
    reviewer_b: str | None = None
    adjudication: str | None = None


class Corpus(Record):
    """Immutable corpus revision and original owner-approved collection targets."""

    schema_version: Literal["1.0"] = "1.0"
    rows: tuple[CorpusRow, ...]
    required_questions: tuple[str, ...]
    minimum_calibration: int = Field(ge=1)
    minimum_held_out: int = Field(ge=1)
    minimum_per_stratum: int = Field(ge=1)
    ratified: bool = False


class Sample(Record):
    """Raw repeated-trial receipt for one candidate on an unchanged held-out row."""

    row_id: str
    candidate: Literal["rules", "generative", "jev"]
    prediction: str | None
    latency_ms: float = Field(ge=0)
    cost: Decimal | None = Field(default=None, ge=0)
    downstream_cost: Decimal | None = Field(default=None, ge=0)
    mode: Mode
    component_revision: Revision
    config_digest: Digest
    receipt_ref: str | None = None
    trial: int = Field(default=0, ge=0)
    critical: bool = False
    executed_at: datetime | None = None


class Confusion(Record):
    """Per-label errors preserve false-positive/negative counts and denominators."""

    label: str
    true_positive: int
    false_positive: int
    false_negative: int


class Metrics(Record):
    """Confusion statistics retain abstentions, costs and sample denominators."""

    candidate: str
    question: str
    stratum: str
    samples: int
    macro_f1: float
    precision: float
    recall: float
    abstention_rate: float
    coverage: float
    critical_false_negatives: int
    p50_latency_ms: float
    p95_latency_ms: float
    total_known_cost: Decimal
    unknown_cost_rate: float
    cost_per_success: Decimal | None
    confusion: tuple[Confusion, ...]


def validate_corpus(corpus: Corpus, *, promotion: bool = False) -> tuple[str, ...]:
    """Reject leakage always; insufficient adjudicated coverage blocks promotion."""
    ids = [row.id for row in corpus.rows]
    if len(ids) != len(set(ids)):
        fail("duplicate_corpus_row", "corpus")
    family_splits: dict[str, set[str]] = {}
    digest_splits: dict[str, set[str]] = {}
    for row in corpus.rows:
        if not all((row.permission, row.rationale, row.label, row.question)):
            fail("corpus_provenance_missing", row.id)
        family_splits.setdefault(row.family, set()).add(row.split)
        digest_splits.setdefault(row.input_digest, set()).add(row.split)
    if any(len(splits) > 1 for splits in (*family_splits.values(), *digest_splits.values())):
        fail("held_out_split_leakage", "corpus")
    blockers = corpus_blockers(corpus)
    if promotion and blockers:
        fail("promotion_corpus_blocked", "corpus")
    return blockers


def corpus_blockers(corpus: Corpus) -> tuple[str, ...]:
    """Preserve unmet sample and review obligations independently of parser validity."""
    blockers: list[str] = []
    if not corpus.ratified:
        blockers.append("dataset/annotation/question schema not ratified by specialist owners")
    for split, minimum in (
        ("calibration", corpus.minimum_calibration),
        ("held-out", corpus.minimum_held_out),
    ):
        if sum(row.split == split for row in corpus.rows) < minimum:
            blockers.append(f"insufficient {split} samples: requires {minimum}")
    for question in corpus.required_questions:
        held_out = [
            row for row in corpus.rows if row.question == question and row.split == "held-out"
        ]
        if len(held_out) < corpus.minimum_per_stratum:
            blockers.append(f"insufficient held-out question coverage: {question}")
    if any(
        not row.reviewer_a
        or not row.reviewer_b
        or row.reviewer_a == row.reviewer_b
        or not row.adjudication
        for row in corpus.rows
    ):
        blockers.append("independent two-reviewer labels/adjudication incomplete")
    return tuple(blockers)


def percentile(values: tuple[float, ...], fraction: float) -> float:
    """Use nearest-rank quantiles with an explicit empty-sample rejection."""
    if not values:
        fail("zero_executed_samples", "benchmark")
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def summarize(
    samples: tuple[Sample, ...],
    rows: tuple[CorpusRow, ...],
    candidate: str,
    question: str,
    stratum: str,
) -> Metrics:
    """Compute one slice without pooling away hard negatives or unknown costs."""
    selected_rows = {
        row.id: row
        for row in rows
        if row.split == "held-out" and row.question == question and row.stratum == stratum
    }
    selected = tuple(
        sample
        for sample in samples
        if sample.candidate == candidate and sample.row_id in selected_rows
    )
    if not selected:
        fail("zero_executed_samples", question)
    labels = sorted({row.label for row in selected_rows.values()})
    f1_scores: list[float] = []
    precisions: list[float] = []
    recalls: list[float] = []
    confusion: list[Confusion] = []
    for label in labels:
        tp = sum(s.prediction == label and selected_rows[s.row_id].label == label for s in selected)
        fp = sum(s.prediction == label and selected_rows[s.row_id].label != label for s in selected)
        fn = sum(s.prediction != label and selected_rows[s.row_id].label == label for s in selected)
        confusion.append(
            Confusion(label=label, true_positive=tp, false_positive=fp, false_negative=fn)
        )
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        precisions.append(precision)
        recalls.append(recall)
        f1_scores.append(
            2 * precision * recall / (precision + recall) if precision + recall else 0.0
        )
    successes = sum(s.prediction == selected_rows[s.row_id].label for s in selected)
    unknown = sum(s.cost is None or s.downstream_cost is None for s in selected)
    known_cost = sum((s.cost or Decimal(0)) + (s.downstream_cost or Decimal(0)) for s in selected)
    total = Decimal(known_cost)
    return Metrics(
        candidate=candidate,
        question=question,
        stratum=stratum,
        samples=len(selected),
        macro_f1=mean(f1_scores),
        precision=mean(precisions),
        recall=mean(recalls),
        abstention_rate=sum(s.prediction is None for s in selected) / len(selected),
        coverage=sum(s.prediction is not None for s in selected) / len(selected),
        critical_false_negatives=sum(
            s.critical and s.prediction != selected_rows[s.row_id].label for s in selected
        ),
        p50_latency_ms=percentile(tuple(s.latency_ms for s in selected), 0.50),
        p95_latency_ms=percentile(tuple(s.latency_ms for s in selected), 0.95),
        total_known_cost=total,
        unknown_cost_rate=unknown / len(selected),
        cost_per_success=total / successes if successes and not unknown else None,
        confusion=tuple(confusion),
    )


def paired_family_interval(
    rows: tuple[CorpusRow, ...], samples: tuple[Sample, ...], *, seed: int = 17, repeats: int = 1000
) -> tuple[float, float]:
    """Bootstrap paired family accuracy differences, preserving correlated variants."""
    if repeats < MIN_BOOTSTRAP_REPEATS:
        fail("insufficient_bootstrap_repeats", "benchmark")
    held_out = {row.id: row for row in rows if row.split == "held-out"}
    pairs = {(sample.row_id, sample.candidate, sample.trial): sample for sample in samples}
    families: dict[str, list[float]] = {}
    for row in held_out.values():
        jev = pairs.get((row.id, "jev", 0))
        baseline = pairs.get((row.id, "generative", 0))
        if jev is None or baseline is None:
            fail("unpaired_baseline_samples", row.id)
        delta = float(jev.prediction == row.label) - float(baseline.prediction == row.label)
        families.setdefault(row.family, []).append(delta)
    if not families:
        fail("zero_executed_samples", "benchmark")
    random = Random(seed)  # noqa: S311 - reproducible statistical resampling, not credentials
    keys = sorted(families)
    deltas: list[float] = []
    for _ in range(repeats):
        selected = [random.choice(keys) for _ in keys]
        deltas.append(mean(value for key in selected for value in families[key]))
    return percentile(tuple(deltas), 0.025), percentile(tuple(deltas), 0.975)
