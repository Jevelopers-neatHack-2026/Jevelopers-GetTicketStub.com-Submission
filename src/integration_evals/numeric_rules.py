"""Execute numerical uncertainty, safety and mandatory-metric policy from ratified owners."""

from typing import Final, Literal

from pydantic import Field

from integration_evals.benchmarks import Corpus, Sample, paired_family_interval
from integration_evals.models import Record

MANDATORY_METRICS: Final = frozenset(
    {
        "macro_f1",
        "precision",
        "recall",
        "coverage",
        "abstention_rate",
        "p95_latency_ms",
        "critical_false_negatives",
        "unknown_cost_rate",
    }
)


class NumericRules(Record):
    """Owner values are required inputs; no numeric target is invented by the harness."""

    owner_decision_ref: str
    ratified: bool = False
    uncertainty_method: Literal["paired-family-accuracy"]
    minimum_held_out: int = Field(ge=1)
    minimum_families: int = Field(ge=2)
    bootstrap_repeats: int = Field(ge=100)
    maximum_interval_width: float = Field(ge=0, le=2)
    minimum_lower_difference: float = Field(ge=-1, le=1)
    safety_row_ids: tuple[str, ...] = Field(min_length=1)


def register_blockers(
    rules: NumericRules | None, targets: tuple[tuple[str, str], ...], questions: tuple[str, ...]
) -> tuple[str, ...]:
    """Require executable owner rules and each mandatory metric for every question."""
    if rules is None or not rules.ratified or not rules.owner_decision_ref:
        return ("executable ratified numeric/uncertainty register unavailable",)
    declared = set(targets)
    if any(
        (question, metric) not in declared for question in questions for metric in MANDATORY_METRICS
    ):
        return ("mandatory quality/latency/safety/abstention metric target missing",)
    return ()


def evaluate_rules(
    rules: NumericRules, corpus: Corpus, samples: tuple[Sample, ...]
) -> tuple[str, ...]:
    """Apply predeclared sample coverage, confidence interval and exact safety predicates."""
    rows = {row.id: row for row in corpus.rows if row.split == "held-out"}
    failures: list[str] = []
    if len(rows) < rules.minimum_held_out:
        failures.append("owner minimum held-out sample count not met")
    if len({row.family for row in rows.values()}) < rules.minimum_families:
        failures.append("owner minimum independent family count not met")
    if not set(rules.safety_row_ids).issubset(rows):
        failures.append("required safety rows unavailable")
    if any(
        sample.candidate == "jev"
        and sample.row_id in rules.safety_row_ids
        and sample.prediction != rows[sample.row_id].label
        for sample in samples
    ):
        failures.append("deterministic safety outcome failed")
    if failures:
        return tuple(sorted(set(failures)))
    low, high = paired_family_interval(corpus.rows, samples, repeats=rules.bootstrap_repeats)
    if high - low > rules.maximum_interval_width:
        failures.append("owner confidence interval width exceeded")
    if low < rules.minimum_lower_difference:
        failures.append("owner confidence lower bound not met")
    return tuple(failures)
