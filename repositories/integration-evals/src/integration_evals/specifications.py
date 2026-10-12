"""Safe fixture generation and a frozen issue acceptance inventory, never executable prose."""

import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Final, Literal

from pydantic import TypeAdapter

from integration_evals.artifacts import digest, read_bytes
from integration_evals.benchmarks import Corpus, CorpusRow
from integration_evals.models import (
    Catalog,
    Fixture,
    Mode,
    Origin,
    Record,
    RequirementId,
)

MODES: Final = (Mode.MOCK, Mode.RECORDED, Mode.SANDBOX, Mode.LIVE)
FIXED_DATE: Final = datetime(2026, 10, 10, tzinfo=UTC)


class Issue(Record):
    """Read-only live inventory data; bodies are never evaluated as instructions."""

    number: int
    title: str
    body: str
    html_url: str


class Leaf(Record):
    """Exact acceptance ID and source URL from the launch inventory."""

    id: RequirementId
    issue: str
    criterion: str
    status: Literal["planned"] = "planned"


class Requirements(Record):
    """Frozen acceptance source with independently reportable unresolved rows."""

    schema_version: Literal["1.0"] = "1.0"
    source_digest: str
    leaves: tuple[Leaf, ...]


def import_requirements(source: Path, destination: Path) -> Requirements:
    """Extract checkbox AC records without following links or embedded directives."""
    raw = read_bytes(source)
    issues = TypeAdapter(tuple[Issue, ...]).validate_json(raw)
    leaves = tuple(
        Leaf(id=RequirementId(match.group(1)), issue=issue.html_url, criterion=match.group(2))
        for issue in issues
        for match in re.finditer(
            r"^- \[ \] \*\*(IE-[\w.-]+\.AC\d+)\*\*[^\w]*(.+)$", issue.body, re.MULTILINE
        )
    )
    requirements = Requirements(source_digest=digest(raw), leaves=leaves)
    _ = destination.write_text(requirements.model_dump_json(indent=2), encoding="utf-8")
    return requirements


def generate_fixtures(root: Path) -> Catalog:
    """Create inert fictional positive/negative families with original byte hashes."""
    bindings: dict[str, tuple[str, ...]] = {
        "research": ("IE-02B.AC1", "AGT-01", "AGT-04"),
        "source": ("IE-02B.AC1", "AGT-05", "IE-11A.AC1"),
        "creative": ("IE-02B.AC2", "ART-01"),
        "approval": ("IE-02B.AC2", "ART-02", "CON-02"),
        "permission": ("IE-02B.AC2", "ART-05"),
        "usage": ("IE-02B.AC3", "FIN-01", "FIN-04", "FIN-07"),
        "finance": ("IE-02B.AC3", "FIN-05", "FIN-09"),
        "asset": ("IE-02B.AC4", "ART-05", "EVAL-04"),
        "email": ("IE-02B.AC1", "AGT-04"),
        "payload": ("IE-02B.AC3", "CON-01", "CON-02"),
    }
    directory = root / "data"
    directory.mkdir(parents=True, exist_ok=True)
    fixtures: list[Fixture] = []
    for family, requirements in bindings.items():
        for index in range(2):
            polarity = "positive" if index == 0 else "negative"
            fixture_id = f"{family}-{polarity}"
            relative = f"data/{fixture_id}.txt"
            data = read_bytes(root / relative)
            fixtures.append(
                Fixture(
                    id=fixture_id,
                    path=relative,
                    sha256=digest(data),
                    media_type="text/plain",
                    family=family,
                    origin=Origin.SYNTHETIC,
                    source_ref=f"https://fixtures.example/{fixture_id}",
                    collected_at=FIXED_DATE,
                    creator="integration-evals synthetic fixture generator",
                    permission="Fictional original test input; no customer or sponsor content",
                    tenant_scope="tenant-a/project-a; negative scope tenant-b/project-b",
                    redaction="Synthetic identities; no private source content",
                    retention="Versioned immutable fixture; revocation requires digest tombstone",
                    quarantined=family == "asset" and index == 1,
                    requirements=tuple(RequirementId(value) for value in requirements),
                    expected="accepted through owner boundary"
                    if index == 0
                    else "typed rejection/uncertainty; no unauthorized effect",
                    modes=MODES,
                )
            )
    catalog = Catalog(fixtures=tuple(fixtures))
    _ = (root / "catalog.json").write_text(catalog.model_dump_json(indent=2), encoding="utf-8")
    return catalog


def generate_corpus(destination: Path) -> Corpus:
    """Smoke rows validate methodology while retaining unmet upstream sample targets."""
    questions = (
        "source-type",
        "relevance",
        "identity-conflict",
        "injection",
        "creative-route",
        "repair",
    )
    rows = tuple(
        CorpusRow(
            id=f"{question}-{split}",
            family=f"{question}-{split}-family",
            question=question,
            language="en",
            stratum="synthetic-smoke",
            split=split,
            input_digest=digest(f"{question}-{split}".encode()),
            label="safe",
            allowed_abstention=True,
            permission="original synthetic methodology fixture",
            rationale="Synthetic smoke only; independently labeled owner export pending",
        )
        for question in questions
        for split in ("calibration", "held-out")
    )
    corpus = Corpus(
        rows=rows,
        required_questions=questions,
        minimum_calibration=120,
        minimum_held_out=240,
        minimum_per_stratum=20,
    )
    _ = destination.write_text(corpus.model_dump_json(indent=2), encoding="utf-8")
    return corpus
