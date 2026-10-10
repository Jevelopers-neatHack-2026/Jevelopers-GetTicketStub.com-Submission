"""Frozen candidate bindings and exact owner-receipt joins for held-out samples."""

from datetime import datetime
from decimal import Decimal
from pathlib import Path

from integration_evals.artifacts import confined_path, digest, load_record, read_bytes, reject_leaks
from integration_evals.benchmarks import Corpus, Sample
from integration_evals.errors import fail
from integration_evals.models import Digest, Mode, Origin, Record, Revision


class CandidatePin(Record):
    """An immutable candidate/question/model/configuration approved before testing."""

    candidate: str
    question: str
    component: str
    revision: Revision
    model: str
    config_digest: Digest


class BenchmarkReceipt(Record):
    """Owner-produced receipt bytes retain prediction, timing, cost and provenance."""

    row_id: str
    candidate: str
    trial: int
    component: str
    component_revision: Revision
    model: str
    config_digest: Digest
    input_digest: Digest
    mode: Mode
    origin: Origin
    executed_at: datetime
    prediction: str | None
    latency_ms: float
    cost: Decimal | None
    downstream_cost: Decimal | None
    owner_review_ref: str


def validate_receipts(
    pins: tuple[CandidatePin, ...], corpus: Corpus, samples: tuple[Sample, ...], root: Path | None
) -> tuple[str, ...]:
    """Block missing or mismatched immutable owner evidence before promotion."""
    if not pins or root is None:
        return ("frozen candidate bindings and approved owner receipt root required",)
    frozen = {(pin.candidate, pin.question): pin for pin in pins}
    if len(frozen) != len(pins):
        fail("duplicate_candidate_pin", "benchmark")
    rows = {row.id: row for row in corpus.rows}
    failures: list[str] = []
    for sample in samples:
        row = rows.get(sample.row_id)
        if row is None:
            failures.append("sample references unknown corpus row")
            continue
        pin = frozen.get((sample.candidate, row.question))
        if (
            pin is None
            or sample.component_revision != pin.revision
            or sample.config_digest != pin.config_digest
        ):
            failures.append("candidate revision/configuration differs from frozen identity")
            continue
        if not sample.receipt_ref or not sample.receipt_digest:
            failures.append("sample owner receipt reference/digest missing")
            continue
        path = confined_path(root, sample.receipt_ref)
        if not path.is_file():
            failures.append("sample owner receipt unavailable")
            continue
        data = read_bytes(path)
        reject_leaks(data, "benchmark-receipt")
        if digest(data) != sample.receipt_digest:
            failures.append("sample owner receipt hash mismatch")
            continue
        receipt = load_record(path, BenchmarkReceipt)
        if not receipt_matches(receipt, sample, pin, row.input_digest):
            failures.append("sample does not join its own pinned owner receipt")
    return tuple(sorted(set(failures)))


def receipt_matches(
    receipt: BenchmarkReceipt, sample: Sample, pin: CandidatePin, input_digest: str
) -> bool:
    """Check actual scalar observations and mode against the owner's immutable bytes."""
    expected_origin = {Mode.LIVE: Origin.LIVE, Mode.SANDBOX: Origin.SANDBOX}.get(sample.mode)
    return all(
        (
            receipt.row_id == sample.row_id,
            receipt.candidate == sample.candidate,
            receipt.trial == sample.trial,
            receipt.component == pin.component,
            receipt.component_revision == pin.revision,
            receipt.model == pin.model,
            receipt.config_digest == pin.config_digest,
            receipt.input_digest == input_digest,
            receipt.mode == sample.mode,
            receipt.executed_at == sample.executed_at,
            receipt.prediction == sample.prediction,
            receipt.latency_ms == sample.latency_ms,
            receipt.cost == sample.cost,
            receipt.downstream_cost == sample.downstream_cost,
            bool(receipt.owner_review_ref),
            expected_origin is None or receipt.origin == expected_origin,
        )
    )
