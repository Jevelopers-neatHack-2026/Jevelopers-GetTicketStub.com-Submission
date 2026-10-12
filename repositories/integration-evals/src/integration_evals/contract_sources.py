"""Bind exact SDK versions to owner-declared metadata without product policy copies."""

import re
from pathlib import Path
from typing import Annotated, ClassVar, Literal, assert_never

from pydantic import ConfigDict, Field

from integration_evals.artifacts import confined_path, digest, load_record, read_bytes
from integration_evals.contract_records import (
    ContractIdentity,
    ContractObservation,
    ContractPin,
    ContractSlice,
    FixtureSemantics,
)
from integration_evals.errors import fail
from integration_evals.models import Digest, Identifier, Record
from integration_evals.validation import unique_ids

type SemanticProfile = Literal[
    "legacy_candidate_no_v2_guarantees",
    "cumulative_v2_proposal",
    "immutable_v1_behavior",
    "provider_reported_unsettled_candidate",
]


class Metadata(Record):
    """Parse consumed metadata fields; payload validation remains producer-owned."""

    model_config: ClassVar[ConfigDict] = ConfigDict(
        frozen=True, strict=True, extra="ignore", allow_inf_nan=False
    )


class ExportIndex(ContractIdentity, Metadata):
    """Bind a schema's exact version to its declared path and bytes."""

    path: str
    sha256: Digest


class SchemaIndex(Metadata):
    """Retain every schema export, including repeated names at different versions."""

    schemas: tuple[ExportIndex, ...] = Field(min_length=1)


class FixtureCaseIndex(Metadata):
    """Freeze case identity and category independently of execution."""

    id: Identifier
    category: Identifier
    mode: str = "structural"


class FixtureIndex(Metadata):
    """Bind a fixture file to its declared contract/version and complete case list."""

    contract: Identifier
    schema_version: str
    cases: tuple[FixtureCaseIndex, ...] = Field(min_length=1)


class FixtureExport(ContractIdentity, Metadata):
    """Select fixture paths from producer metadata, never filename conventions."""

    path: str
    cases: tuple[FixtureCaseIndex, ...] = Field(min_length=1)


class FixtureDigest(Metadata):
    """Keep fixture bytes and versioned declarations under the frozen manifest."""

    digest: Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
    files: dict[str, str]
    contracts: tuple[FixtureExport, ...] = Field(min_length=1)


class CatalogVersion(Metadata):
    """Owner-declared artifacts for a supported wire version."""

    schema_version: str
    schema_path: str
    fixtures: str
    semantic_profile: SemanticProfile | None = None


class CatalogEntry(CatalogVersion):
    """Active artifacts and all explicitly retained versions of one contract."""

    name: Identifier
    versions: tuple[CatalogVersion, ...] = ()


class CatalogIndex(Metadata):
    """Full required scope, independent of available schema exports."""

    contracts: tuple[CatalogEntry, ...] = Field(min_length=1)


class RequiredExport(ContractIdentity):
    """One independently required version and its owner-declared artifact paths."""

    schema_path: str
    fixtures: str
    semantic_profile: SemanticProfile | None = None


def read_catalog(producer: Path) -> CatalogIndex:
    """Read the frozen owner catalog, including retained declared versions."""
    data = read_bytes(confined_path(producer, "docs/contract-catalog.md"))
    match = re.search(rb"```json catalog\n([\s\S]*?)\n```", data)
    if match is None:
        return fail("canonical_catalog_missing", "shared-contracts")
    catalog = CatalogIndex.model_validate_json(match[1])
    unique_ids(tuple(item.name for item in catalog.contracts), "canonical_catalog")
    return catalog


def required_contracts(producer: Path) -> tuple[str, ...]:
    """Keep the legacy name inventory separate from exact version obligations."""
    return tuple(item.name for item in read_catalog(producer).contracts)


def required_exports(producer: Path) -> tuple[RequiredExport, ...]:
    """Flatten explicit catalog versions without guessing artifact paths."""
    result: list[RequiredExport] = []
    for entry in read_catalog(producer).contracts:
        versions = entry.versions or (entry,)
        if not any(
            (item.schema_version, item.schema_path, item.fixtures)
            == (entry.schema_version, entry.schema_path, entry.fixtures)
            for item in versions
        ):
            fail("contract_active_version_mismatch", entry.name)
        result.extend(
            RequiredExport(
                contract=entry.name,
                version=item.schema_version,
                schema_path=item.schema_path,
                fixtures=item.fixtures,
                semantic_profile=item.semantic_profile,
            )
            for item in versions
        )
    if len({item.key for item in result}) != len(result):
        fail("contract_duplicate_catalog_version", "shared-contracts")
    return tuple(result)


def missing_exports(
    required: tuple[RequiredExport, ...], available: set[tuple[str, str]]
) -> tuple[str, ...]:
    """Qualify multi-version gaps while retaining single-name diagnostics."""
    return tuple(
        f"{item.contract}@{item.version}"
        if sum(other.contract == item.contract for other in required) > 1
        else item.contract
        for item in required
        if item.key not in available
    )


def validate_catalog_scope(
    observation: ContractObservation, required: tuple[RequiredExport, ...]
) -> None:
    """Require explicit exact-version coverage for a multi-version catalog."""
    if observation.required_contracts != tuple(dict.fromkeys(item.contract for item in required)):
        fail("contract_catalog_scope_mismatch", "shared-contracts")
    expected_versions = tuple(
        ContractIdentity(contract=item.contract, version=item.version) for item in required
    )
    if observation.required_versions is None:
        if len({item.contract for item in required}) != len(required):
            fail("contract_version_scope_missing", "shared-contracts")
    elif observation.required_versions != expected_versions:
        fail("contract_version_scope_mismatch", "shared-contracts")


def bind_fixture_cases(row: ContractSlice, entry: FixtureExport, producer: Path) -> FixtureIndex:
    """Bind case accounting to both the fixture index and actual versioned fixture bytes."""
    index = load_record(confined_path(producer, entry.path), FixtureIndex)
    if (index.contract, index.schema_version) != row.key or index.cases != entry.cases:
        fail("contract_fixture_identity_mismatch", row.contract)
    if row.cases != tuple(case.id for case in index.cases):
        fail("contract_fixture_scope_mismatch", row.contract)
    unique_ids(row.cases, row.contract)
    unique_ids(row.failures, row.contract)
    unique_ids(tuple(item.case for item in row.semantic_records), row.contract)
    if any(
        item.case not in row.cases or item.case in row.failures for item in row.semantic_records
    ):
        fail("contract_semantic_record_scope_mismatch", row.contract)
    if not set(row.failures).issubset(row.cases):
        fail("orphan_fixture_failure", row.contract)
    if row.categories != tuple(sorted({case.category for case in index.cases})):
        fail("contract_fixture_category_mismatch", row.contract)
    return index


def validate_semantic_records(
    row: ContractSlice, index: FixtureIndex, target: RequiredExport
) -> None:
    """Reject missing or invented authority labels against the owner's declared profile."""
    match target.semantic_profile:
        case "legacy_candidate_no_v2_guarantees":
            expected = tuple(
                FixtureSemantics(
                    case=case.id,
                    profile="historical_finance_characterization",
                    operational_authority=False,
                )
                for case in index.cases
                if case.mode == "semantic" and case.id not in row.failures
            )
        case (
            "cumulative_v2_proposal"
            | "immutable_v1_behavior"
            | "provider_reported_unsettled_candidate"
            | None
        ):
            expected = ()
        case _:
            assert_never(target.semantic_profile)
    if row.semantic_records != expected:
        fail("contract_semantic_metadata_mismatch", row.contract)


def bind_contract_observation(
    observation: ContractObservation, producer: Path, pin: ContractPin
) -> None:
    """Join schema, declared fixture path and case accounting by exact version."""
    if observation.node_version != pin.node_version:
        fail("contract_runtime_version_mismatch", "node")
    required = required_exports(producer)
    validate_catalog_scope(observation, required)
    manifest = load_record(producer / "generated/schema-manifest.json", SchemaIndex)
    fixture = load_record(producer / "generated/fixture-manifest.json", FixtureDigest)
    if observation.fixture_digest != fixture.digest.removeprefix("sha256:"):
        fail("contract_fixture_digest_mismatch", "shared-contracts")
    schemas = {row.key: row for row in manifest.schemas}
    declared = {row.key: row for row in fixture.contracts}
    observed = {row.key: row for row in observation.results}
    catalog = {row.key: row for row in required}
    if (
        len(schemas) != len(manifest.schemas)
        or len(declared) != len(fixture.contracts)
        or len(observed) != len(observation.results)
    ):
        fail("contract_duplicate_version", "shared-contracts")
    if (
        set(observed) != set(schemas)
        or not set(schemas).issubset(catalog)
        or not set(declared).issubset(catalog)
    ):
        fail("contract_export_scope_mismatch", "shared-contracts")
    for row in observation.results:
        schema = schemas[row.key]
        entry = declared.get(row.key)
        target = catalog[row.key]
        if row.schema_digest != schema.sha256 or schema.path != target.schema_path:
            fail("contract_schema_identity_mismatch", row.contract)
        if entry is None or entry.path != target.fixtures:
            fail("contract_fixture_path_mismatch", row.contract)
        if row.fixture_path != entry.path and (
            row.fixture_path is not None or observation.required_versions is not None
        ):
            fail("contract_fixture_path_mismatch", row.contract)
        path = confined_path(producer, entry.path)
        if fixture.files.get(entry.path) != "sha256:" + digest(read_bytes(path)):
            fail("contract_fixture_bytes_mismatch", row.contract)
        index = bind_fixture_cases(row, entry, producer)
        validate_semantic_records(row, index, target)
