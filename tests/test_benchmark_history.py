"""Declared statistical repeats retain samples independently of the diagnostic cap."""

from pathlib import Path

import pytest
from typer.testing import CliRunner

from integration_evals.artifacts import digest, load_record
from integration_evals.benchmark_history import (
    BenchmarkArchive,
    BenchmarkHistory,
    benchmark_archive,
)
from integration_evals.benchmarks import Corpus, Sample
from integration_evals.cli import app
from integration_evals.errors import InvalidArtifactError
from integration_evals.models import Mode

REPOSITORY = Path(__file__).resolve().parents[1]


def declared_samples(corpus: Corpus) -> tuple[Sample, ...]:
    return tuple(
        Sample(
            row_id=row.id,
            candidate=candidate,
            prediction=row.label if trial % 2 else None,
            latency_ms=float(10 + trial),
            mode=Mode.MOCK,
            component_revision="a" * 40,
            config_digest=digest(b"fixed-config"),
            trial=trial,
        )
        for row in corpus.rows
        if row.split == "held-out"
        for candidate in ("rules", "generative", "jev")
        for trial in range(4)
    )


def test_cli_preserves_all_four_declared_trials(tmp_path: Path) -> None:
    # Given four statistical trials, independently of the two-diagnostic cap.
    corpus = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    samples = declared_samples(corpus)
    path = tmp_path / "samples.json"
    _ = path.write_text("[" + ",".join(sample.model_dump_json() for sample in samples) + "]")
    output = tmp_path / "benchmark-history.json"
    # When exporting through the public benchmark history surface.
    result = CliRunner().invoke(
        app,
        [
            "benchmark-history",
            str(REPOSITORY / "benchmarks/corpus.json"),
            str(path),
            "4",
            str(output),
        ],
    )
    _ = (tmp_path / "cli.log").write_text(result.output)
    # Then all samples and measured metrics survive without a flake classification.
    assert result.exit_code == 0, result.output
    archive = load_record(output, BenchmarkArchive)
    assert archive.history.samples == samples
    assert archive.history.classification == "benchmark-variation"
    assert archive.promotion_blockers
    assert sum(metric.samples for metric in archive.metrics) == len(samples)


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "drift", "candidate"])
def test_rejects_incomplete_or_changed_statistical_samples(mutation: str) -> None:
    # Given a predeclared four-repeat benchmark.
    corpus = load_record(REPOSITORY / "benchmarks/corpus.json", Corpus)
    samples = declared_samples(corpus)
    if mutation == "missing":
        samples = samples[:-1]
    elif mutation == "duplicate":
        samples = (*samples, samples[0])
    elif mutation == "drift":
        samples = (samples[0].model_copy(update={"config_digest": digest(b"drift")}), *samples[1:])
    else:
        samples = tuple(sample for sample in samples if sample.candidate != "generative")
    history = BenchmarkHistory(
        corpus_digest=digest(corpus.model_dump_json().encode()), declared_repeats=4, samples=samples
    )
    # When the statistics boundary checks complete trial identity.
    with pytest.raises(InvalidArtifactError):
        _ = benchmark_archive(history, corpus)
    # Then omission, duplicate trials and input drift cannot improve the denominator.
