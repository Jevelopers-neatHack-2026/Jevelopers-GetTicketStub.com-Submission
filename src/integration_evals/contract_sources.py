"""Bind SDK observations to frozen producer metadata without duplicating domain schemas."""

import re
from pathlib import Path
from typing import Annotated, ClassVar

from pydantic import ConfigDict, Field

from integration_evals.artifacts import confined_path, load_record, read_bytes
from integration_evals.contract_records import ContractObservation, ContractPin
from integration_evals.errors import fail
from integration_evals.models import Digest, Identifier, Record
from integration_evals.validation import unique_ids


class Metadata(Record):
    """Parse only consumed metadata fields; payload validation stays with the canonical SDK."""

    model_config: ClassVar[ConfigDict] = ConfigDict(
        frozen=True, strict=True, extra="ignore", allow_inf_nan=False
    )


class ExportIndex(Metadata):
    """Names and original bytes consumed from the producer schema manifest."""

    contract: Identifier
    version: str
    path: str
    sha256: Digest


class SchemaIndex(Metadata):
    """Nonempty canonical export inventory."""

    schemas: tuple[ExportIndex, ...] = Field(min_length=1)


class FixtureDigest(Metadata):
    """Original content-addressed fixture declaration."""

    digest: Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]


class FixtureCaseIndex(Metadata):
    """Golden case identity and coverage category."""

    id: Identifier
    category: Identifier


class FixtureIndex(Metadata):
    """Complete frozen case selection for one export."""

    cases: tuple[FixtureCaseIndex, ...] = Field(min_length=1)


class CatalogEntry(Metadata):
    """A required canonical contract name."""

    name: Identifier


class CatalogIndex(Metadata):
    """Full required scope, including exports not yet implemented."""

    contracts: tuple[CatalogEntry, ...] = Field(min_length=1)


def required_contracts(producer: Path) -> tuple[str, ...]:
    """Read the producer's machine catalog, preserving omitted domain obligations."""
    data = read_bytes(confined_path(producer, "docs/contract-catalog.md"))
    match = re.search(rb"```json catalog\n([\s\S]*?)\n```", data)
    if match is None:
        return fail("canonical_catalog_missing", "shared-contracts")
    catalog = CatalogIndex.model_validate_json(match[1])
    names = tuple(item.name for item in catalog.contracts)
    unique_ids(names, "canonical_catalog")
    return names


def bind_contract_observation(
    observation: ContractObservation, producer: Path, pin: ContractPin
) -> None:
    """Reject omitted cases, substituted schema hashes and falsely reduced source scope."""
    if observation.node_version != pin.node_version:
        fail("contract_runtime_version_mismatch", "node")
    if observation.required_contracts != required_contracts(producer):
        fail("contract_catalog_scope_mismatch", "shared-contracts")
    manifest = load_record(producer / "generated/schema-manifest.json", SchemaIndex)
    fixture = load_record(producer / "generated/fixture-manifest.json", FixtureDigest)
    if observation.fixture_digest != fixture.digest.removeprefix("sha256:"):
        fail("contract_fixture_digest_mismatch", "shared-contracts")
    unique_ids(tuple(row.contract for row in manifest.schemas), "canonical_exports")
    expected = {row.contract: row for row in manifest.schemas}
    unique_ids(tuple(row.contract for row in observation.results), "canonical_results")
    if {row.contract for row in observation.results} != set(expected):
        fail("contract_export_scope_mismatch", "shared-contracts")
    for row in observation.results:
        schema = expected[row.contract]
        if row.version != schema.version or row.schema_digest != schema.sha256:
            fail("contract_schema_identity_mismatch", row.contract)
        index = load_record(confined_path(producer, f"fixtures/{row.contract}.json"), FixtureIndex)
        if row.cases != tuple(case.id for case in index.cases):
            fail("contract_fixture_scope_mismatch", row.contract)
        unique_ids(row.cases, row.contract)
        unique_ids(row.failures, row.contract)
        if not set(row.failures).issubset(row.cases):
            fail("orphan_fixture_failure", row.contract)
        if row.categories != tuple(sorted({case.category for case in index.cases})):
            fail("contract_fixture_category_mismatch", row.contract)
