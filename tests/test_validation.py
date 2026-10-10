from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import pytest

from integration_evals.artifacts import digest, load_record
from integration_evals.cli import owned_requirements
from integration_evals.errors import InvalidArtifactError
from integration_evals.models import Catalog, Fixture, Mode, Origin, RequirementId, Suite
from integration_evals.validation import validate_catalog, validate_suite

REPOSITORY = Path(__file__).resolve().parents[1]


def test_catalog_accepts_when_all_original_inputs_match() -> None:
    # Given the checked-in catalog and authoritative IDs.
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    requirements = owned_requirements(REPOSITORY)
    # When validating inert inputs.
    validate_catalog(catalog, REPOSITORY / "fixtures", requirements)
    # Then positive and negative families are actually available as bytes.
    assert len(catalog.fixtures) == 20


@pytest.mark.parametrize("change", ["bytes", "permission", "owner", "revocation"])
def test_catalog_rejects_when_provenance_or_integrity_breaks(
    tmp_path: Path, change: Literal["bytes", "permission", "owner", "revocation"]
) -> None:
    # Given a valid original synthetic artifact.
    data = b"fictional event"
    _ = (tmp_path / "fixture.txt").write_bytes(data)
    fixture = Fixture(
        id="example",
        path="fixture.txt",
        sha256=digest(data),
        media_type="text/plain",
        family="research",
        origin=Origin.SYNTHETIC,
        source_ref="https://fixtures.example/event",
        collected_at=datetime(2026, 10, 10, tzinfo=UTC),
        creator="test",
        permission="original",
        tenant_scope="synthetic",
        redaction="none needed",
        retention="versioned",
        requirements=(RequirementId("AGT-01"),),
        expected="sourced facts",
        modes=(Mode.MOCK,),
    )
    alterations: dict[str, dict[str, str | bool]] = {
        "bytes": {},
        "permission": {"permission": ""},
        "owner": {"creator": ""},
        "revocation": {"revoked": True},
    }
    if change == "bytes":
        _ = (tmp_path / "fixture.txt").write_bytes(b"changed")
    updates = alterations[change]
    catalog = Catalog(fixtures=(fixture.model_copy(update=updates),))
    # When validating the tampered artifact.
    with pytest.raises(InvalidArtifactError):
        validate_catalog(catalog, tmp_path, frozenset({RequirementId("AGT-01")}))
    # Then the missing provenance or mismatched bytes cannot enter execution.


def test_suite_rejects_when_case_has_unknown_requirement() -> None:
    # Given a case disconnected from the authoritative acceptance inventory.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    first = suite.cases[0].model_copy(update={"requirements": (RequirementId("UNOWNED"),)})
    modified = Suite(cases=(first,))
    # When selecting this suite.
    with pytest.raises(InvalidArtifactError, match="orphan_case"):
        validate_suite(modified, catalog, owned_requirements(REPOSITORY))
    # Then the orphan case is rejected before dispatch.
