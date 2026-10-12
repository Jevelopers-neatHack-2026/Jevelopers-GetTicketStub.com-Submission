"""CLI surfaces for preserved diagnostics and independently declared benchmark repeats."""

import json
from pathlib import Path
from typing import Annotated

import typer
from pydantic import TypeAdapter

from integration_evals.artifacts import digest, load_record, read_bytes
from integration_evals.benchmark_history import BenchmarkHistory, save_benchmark
from integration_evals.benchmarks import Corpus, Sample
from integration_evals.comparison_archive import load_comparisons
from integration_evals.diagnostics import replay_comparisons
from integration_evals.history import History, summarize_history
from integration_evals.history_archive import load_history, save_history
from integration_evals.models import Suite
from integration_evals.release import audit, export_audit
from integration_evals.reporting import Tracker
from integration_evals.specifications import Requirements


def replay_evaluation(archive: Path, suite: Path | None = None) -> None:
    """Repeat only the oracle over hash-bound archived bytes; source authenticity is unverified."""
    trusted = load_record(suite or Path("scenarios/suite.json"), Suite)
    history = load_history(archive, trusted)
    original = archive.parent / history.runs[0].id
    captures = load_comparisons(original, history.runs[0])
    diagnostic = replay_comparisons(history, captures, trusted)
    diagnostic = diagnostic.model_copy(
        update={
            "limitations": (
                *diagnostic.limitations,
                "Archive source authenticity unverified; hashes prove consistency only.",
            )
        }
    )
    updated = History(runs=(*history.runs, diagnostic), quarantines=history.quarantines)
    tracker = load_record(Path("planning/acceptance-checklist.json"), Tracker)
    destination = save_history(updated, archive.parent, tracker, trusted, original)
    requirements = load_record(Path("planning/requirements.json"), Requirements)
    export_audit(audit(updated, tracker, requirements, trusted), destination / "release-audit.json")
    typer.echo(str(destination))
    raise typer.Exit(2)


def history_report(archive: Path, suite: Path | None = None) -> None:
    """Read every retained sample; no command from archive metadata is ever executed."""
    trusted = load_record(suite or Path("scenarios/suite.json"), Suite)
    history = load_history(archive, trusted)
    rows = summarize_history(history, trusted)
    typer.echo(json.dumps([row.model_dump(mode="json") for row in rows], indent=2))
    if any(row.release_blocked for row in rows):
        raise typer.Exit(2)


def benchmark_history(
    corpus: Path, samples: Path, repeats: Annotated[int, typer.Argument(min=1)], output: Path
) -> None:
    """Preserve every declared statistical repeat separately from diagnostic attempts."""
    dataset = load_record(corpus, Corpus)
    history = BenchmarkHistory(
        corpus_digest=digest(dataset.model_dump_json().encode()),
        declared_repeats=repeats,
        samples=TypeAdapter(tuple[Sample, ...]).validate_json(read_bytes(samples)),
    )
    save_benchmark(history, dataset, output)
    typer.echo(str(output))
