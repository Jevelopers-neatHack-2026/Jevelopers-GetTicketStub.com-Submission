"""Offline packaging of retained receipts and optional owner review derivatives."""

from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

import typer

from integration_evals.artifacts import digest, load_record, read_bytes, reject_leaks
from integration_evals.evidence_index import IndexChecks, Reviews, build_index
from integration_evals.history_archive import load_history
from integration_evals.models import Suite
from integration_evals.reporting import Tracker
from integration_evals.specifications import Requirements


def evidence_index(
    archive: Path,
    output: Annotated[Path, typer.Option()],
    suite: Path | None = None,
    reviews: Path | None = None,
) -> None:
    """Join real retained history; no producer call or remote fetch occurs."""
    trusted = load_record(suite or Path("scenarios/suite.json"), Suite)
    history = load_history(archive, trusted)
    sidecar = Reviews()
    if reviews is not None:
        reject_leaks(read_bytes(reviews), "reviews")
        sidecar = load_record(reviews, Reviews)
    index = build_index(
        history,
        trusted,
        load_record(Path("planning/acceptance-checklist.json"), Tracker),
        load_record(Path("planning/requirements.json"), Requirements),
        checks=IndexChecks(
            roots={
                r.evaluation_source_run or r.id: archive.parent / (r.evaluation_source_run or r.id)
                for r in history.runs
            },
            reviews=sidecar,
            review_root=reviews.parent if reviews else Path(),
            checked_at=datetime.now(UTC),
        ),
    )
    raw = index.model_dump_json(indent=2).encode()
    reject_leaks(raw, "index")
    with output.open("xb") as destination:
        _ = destination.write(raw)
    typer.echo(f"Evidence index SHA256 {digest(raw)}")
    if any(row.blockers and not row.excluded for row in index.requirements):
        raise typer.Exit(2)
