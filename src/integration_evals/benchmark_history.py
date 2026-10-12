"""Declared benchmark repeats remain separate from bounded diagnostic run histories."""

from pathlib import Path
from typing import Literal

from pydantic import Field

from integration_evals.artifacts import digest, reject_leaks
from integration_evals.benchmarks import Corpus, Metrics, Sample, summarize, validate_corpus
from integration_evals.errors import fail
from integration_evals.models import Digest, Record


class BenchmarkHistory(Record):
    """Every declared trial is retained; statistics do not imply infrastructure flakiness."""

    classification: Literal["benchmark-variation"] = "benchmark-variation"
    corpus_digest: Digest
    declared_repeats: int = Field(ge=1)
    samples: tuple[Sample, ...] = Field(min_length=1)


class BenchmarkArchive(Record):
    """Raw samples and existing evaluator statistics share one immutable export."""

    history: BenchmarkHistory
    metrics: tuple[Metrics, ...]
    promotion_blockers: tuple[str, ...]


def benchmark_archive(history: BenchmarkHistory, corpus: Corpus) -> BenchmarkArchive:
    """Require the complete declared Cartesian trial set before computing statistics."""
    if history.corpus_digest != digest(corpus.model_dump_json().encode()):
        fail("benchmark_corpus_drift", "benchmark")
    blockers = validate_corpus(corpus)
    rows = {row.id for row in corpus.rows if row.split == "held-out"}
    candidates = {"rules", "generative", "jev"}
    keys = tuple((sample.row_id, sample.candidate, sample.trial) for sample in history.samples)
    expected = {
        (row, candidate, trial)
        for row in rows
        for candidate in candidates
        for trial in range(history.declared_repeats)
    }
    if len(keys) != len(set(keys)) or set(keys) != expected:
        fail("benchmark_declared_samples_incomplete", "benchmark")
    for candidate in candidates:
        identities = {
            (sample.component_revision, sample.config_digest, sample.mode)
            for sample in history.samples
            if sample.candidate == candidate
        }
        if len(identities) != 1:
            fail("benchmark_repeat_identity_drift", "benchmark")
    reject_leaks(history.model_dump_json().encode(), "benchmark")
    return BenchmarkArchive(
        history=history,
        metrics=tuple(
            summarize(history.samples, corpus.rows, candidate, question, stratum)
            for candidate in sorted(candidates)
            for question, stratum in sorted(
                {(row.question, row.stratum) for row in corpus.rows if row.split == "held-out"}
            )
        ),
        promotion_blockers=blockers,
    )


def save_benchmark(history: BenchmarkHistory, corpus: Corpus, destination: Path) -> None:
    """Write all samples and metrics exclusively; neither overwrite nor truncate repeats."""
    archive = benchmark_archive(history, corpus)
    with destination.open("x", encoding="utf-8") as output:
        _ = output.write(archive.model_dump_json(indent=2))
