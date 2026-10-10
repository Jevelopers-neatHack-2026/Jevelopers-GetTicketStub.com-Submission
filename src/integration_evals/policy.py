"""Predeclared benchmark promotion policy, never inferred from achieved scores."""

from datetime import datetime
from decimal import Decimal
from operator import ge, le
from pathlib import Path
from typing import Final, Literal

from pydantic import Field

from integration_evals.artifacts import digest
from integration_evals.benchmark_receipts import CandidatePin, validate_receipts
from integration_evals.benchmarks import Corpus, Metrics, Sample, summarize, validate_corpus
from integration_evals.errors import fail
from integration_evals.models import Digest, Record
from integration_evals.numeric_rules import NumericRules, evaluate_rules, register_blockers

BASELINE_COUNT: Final = 2


class Threshold(Record):
    """An owner-ratified numerical target for a particular question and slice."""

    id: str
    question: str
    stratum: str
    metric: Literal[
        "macro_f1",
        "precision",
        "recall",
        "coverage",
        "abstention_rate",
        "p95_latency_ms",
        "critical_false_negatives",
        "unknown_cost_rate",
    ]
    relation: Literal["minimum", "maximum"]
    limit: Decimal
    owner: str
    decision_ref: str | None
    ratified: bool = False


class Policy(Record):
    """Freeze thresholds and corpus identity before observing final evaluation."""

    schema_version: Literal["1.0"] = "1.0"
    frozen_at: datetime
    corpus_digest: Digest
    required_questions: tuple[str, ...] = Field(min_length=1)
    thresholds: tuple[Threshold, ...]
    required_mode: Literal["sandbox", "live"]
    minimum_cost_reduction: Decimal = Field(ge=0, le=1)
    maximum_f1_loss: Decimal = Field(ge=0, le=1)
    uncertainty_rule_ref: str | None = None
    cost_policy_ref: str | None = None
    latency_policy_ref: str | None = None
    required_trials: int = Field(default=1, ge=1)
    candidates: tuple[CandidatePin, ...] = ()
    numeric_rules: NumericRules | None = None


class Promotion(Record):
    """A blocked or failed promotion preserves all negative findings."""

    verdict: Literal["blocked", "failed", "eligible-for-owner-review"]
    reasons: tuple[str, ...]
    corpus_digest: Digest
    policy_digest: Digest


def metric_value(metrics: Metrics, name: str) -> Decimal:
    """Expose only the policy's explicitly supported numeric metric names."""
    values = {
        "macro_f1": metrics.macro_f1,
        "precision": metrics.precision,
        "recall": metrics.recall,
        "coverage": metrics.coverage,
        "abstention_rate": metrics.abstention_rate,
        "p95_latency_ms": metrics.p95_latency_ms,
        "critical_false_negatives": metrics.critical_false_negatives,
        "unknown_cost_rate": metrics.unknown_cost_rate,
    }
    if name not in values:
        fail("unsupported_policy_metric", name)
    return Decimal(str(values[name]))


def policy_blockers(
    policy: Policy, corpus: Corpus, samples: tuple[Sample, ...], receipt_root: Path | None = None
) -> tuple[str, ...]:
    """Reject missing authority, receipt coverage and predeclared policy before scoring."""
    blockers = list(validate_corpus(corpus))
    blockers.extend(validate_receipts(policy.candidates, corpus, samples, receipt_root))
    blockers.extend(
        register_blockers(
            policy.numeric_rules,
            tuple((target.question, target.metric) for target in policy.thresholds),
            policy.required_questions,
        )
    )
    held_out = {row.id for row in corpus.rows if row.split == "held-out"}
    expected = {
        (row, candidate, trial)
        for row in held_out
        for candidate in ("rules", "generative", "jev")
        for trial in range(policy.required_trials)
    }
    actual = {(sample.row_id, sample.candidate, sample.trial) for sample in samples}
    if actual != expected or len(actual) != len(samples):
        blockers.append("incomplete, duplicate or unpaired held-out sample coverage")
    if policy.frozen_at.utcoffset() is None or any(
        sample.executed_at is None
        or sample.executed_at.utcoffset() is None
        or sample.executed_at <= policy.frozen_at
        for sample in samples
    ):
        blockers.append("policy freeze before final evaluation is unverified")
    corpus_digest = digest(corpus.model_dump_json().encode())
    if corpus_digest != policy.corpus_digest:
        blockers.append("corpus does not match frozen policy")
    if not all((policy.uncertainty_rule_ref, policy.cost_policy_ref, policy.latency_policy_ref)):
        blockers.append("incomplete ratified uncertainty/latency/cost policy")
    if not policy.thresholds or any(
        not target.ratified or not target.decision_ref for target in policy.thresholds
    ):
        blockers.append("numeric targets are absent or unratified")
    covered = {target.question for target in policy.thresholds}
    if not set(policy.required_questions).issubset(covered):
        blockers.append("required question policy missing")
    if not samples or any(
        (sample.candidate != "rules" and sample.mode.value != policy.required_mode)
        or not sample.receipt_ref
        for sample in samples
    ):
        blockers.append("actual required-mode candidate/baseline receipts missing")
    if any(sample.cost is None or sample.downstream_cost is None for sample in samples):
        blockers.append("total outcome cost remains unknown")
    return tuple(blockers)


def promotion(
    policy: Policy, corpus: Corpus, samples: tuple[Sample, ...], receipt_root: Path | None = None
) -> Promotion:
    """Check frozen owner policy and real receipts without auto-promoting routing."""
    blockers = policy_blockers(policy, corpus, samples, receipt_root)
    corpus_digest = digest(corpus.model_dump_json().encode())
    if blockers:
        return Promotion(
            verdict="blocked",
            reasons=tuple(blockers),
            corpus_digest=corpus_digest,
            policy_digest=digest(policy.model_dump_json().encode()),
        )
    failures: list[str] = []
    if policy.numeric_rules is not None:
        failures.extend(evaluate_rules(policy.numeric_rules, corpus, samples))
    metrics = tuple(
        summarize(samples, corpus.rows, candidate, question, stratum)
        for candidate in ("rules", "generative", "jev")
        for question, stratum in sorted(
            {(row.question, row.stratum) for row in corpus.rows if row.split == "held-out"}
        )
    )
    for target in policy.thresholds:
        slices = [
            item
            for item in metrics
            if item.candidate == "jev"
            and item.question == target.question
            and target.stratum in {"*", item.stratum}
        ]
        if not slices:
            failures.append(f"missing evaluated slice: {target.id}")
        comparator = {"minimum": ge, "maximum": le}[target.relation]
        failures.extend(
            f"threshold not met: {target.id}/{item.stratum}"
            for item in slices
            if not comparator(metric_value(item, target.metric), target.limit)
        )
    for item in (metric for metric in metrics if metric.candidate == "jev"):
        baselines = [
            baseline
            for baseline in metrics
            if baseline.candidate in {"rules", "generative"}
            and baseline.question == item.question
            and baseline.stratum == item.stratum
        ]
        if len(baselines) != BASELINE_COUNT:
            failures.append(f"baseline comparison incomplete: {item.question}/{item.stratum}")
            continue
        if (
            Decimal(str(max(baseline.macro_f1 for baseline in baselines) - item.macro_f1))
            > policy.maximum_f1_loss
        ):
            failures.append(f"candidate quality regressed: {item.question}/{item.stratum}")
        generative = next(baseline for baseline in baselines if baseline.candidate == "generative")
        if item.cost_per_success is None or generative.cost_per_success is None:
            failures.append("total-cost comparison missing")
        elif item.cost_per_success > generative.cost_per_success * (
            1 - policy.minimum_cost_reduction
        ):
            failures.append(f"cost reduction not met: {item.question}/{item.stratum}")
    return Promotion(
        verdict="failed" if failures else "eligible-for-owner-review",
        reasons=tuple(failures),
        corpus_digest=corpus_digest,
        policy_digest=digest(policy.model_dump_json().encode()),
    )
