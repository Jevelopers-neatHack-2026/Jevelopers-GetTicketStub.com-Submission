"""Pin the reviewed negative-only print owner without changing original fixtures."""

import sys
from pathlib import Path
from typing import Final, Literal

from integration_evals.artifacts import confined_path, digest, load_record, read_bytes
from integration_evals.contract_records import ContractPin, ContractRuntime
from integration_evals.contracts import runtime_digest
from integration_evals.errors import fail
from integration_evals.models import (
    Assembly,
    Case,
    CaseId,
    Catalog,
    Component,
    Digest,
    Fixture,
    Mode,
    Record,
    Revision,
    Suite,
)
from integration_evals.validation import git_value, validate_assembly

PROFILE_PATH: Final = "src/integration_evals/print-profile.json"
CONFIGURATION_PATH: Final = "print-configuration.json"


class PrintProfile(Record):
    """Immutable producer source and fixture commitments; no approval authority."""

    revision: Revision
    tree: Revision
    source_files: dict[str, Digest]
    node_version: Literal["24.21.0"]
    npm_version: Literal["11.19.0"]
    node_archive_sha256: Digest
    browser_sha256: Digest
    image: str


class PrintConfiguration(Record):
    """Exact producer configuration schema, limited to synthetic negative input."""

    schema_version: Literal["print-invalid-owner/v1"] = "print-invalid-owner/v1"
    case_id: Literal["print-invalid"] = "print-invalid"
    fixture_id: Literal["asset-negative"] = "asset-negative"
    supplement_id: Literal["print-invalid-synthetic/v1"] = "print-invalid-synthetic/v1"
    payload_sha256: Literal["969bc670d1540ffce4823ea9ca7b9c9bd5154052c78a0460cf8c235f88cca4de"] = (
        "969bc670d1540ffce4823ea9ca7b9c9bd5154052c78a0460cf8c235f88cca4de"
    )
    mode: Literal["mock-only"] = "mock-only"
    origin: Literal["synthetic"] = "synthetic"
    accepted: Literal[False] = False
    node_sha256: Digest
    browser_root: str
    renderer_image: str


def verify_source(repository: Path, producer: Path) -> PrintProfile:
    """Check exact source, all declared bytes, original payload and metadata joins."""
    profile = load_record(repository / PROFILE_PATH, PrintProfile)
    if (
        git_value(producer, "rev-parse", "HEAD"),
        git_value(producer, "rev-parse", "HEAD^{tree}"),
    ) != (profile.revision, profile.tree):
        fail("print_source_pin_mismatch", "print-production")
    for name, expected in profile.source_files.items():
        if digest(read_bytes(confined_path(producer, name))) != expected:
            fail("print_source_digest_mismatch", name)
    fixtures = producer / "tests/fixtures/integration-evals/v1"
    suite = load_record(repository / "scenarios/suite.json", Suite)
    case = next(case for case in suite.cases if case.id == "print-invalid")
    if load_record(fixtures / "case.json", Case) != case:
        fail("print_case_projection_mismatch", case.id)
    catalog = load_record(repository / "fixtures/catalog.json", Catalog)
    original = next(item for item in catalog.fixtures if item.id == "asset-negative")
    if load_record(fixtures / "original-metadata.json", Fixture) != original:
        fail("print_fixture_metadata_mismatch", original.id)
    if read_bytes(repository / "fixtures" / original.path) != read_bytes(
        fixtures / "asset-negative.txt"
    ):
        fail("print_original_payload_mismatch", original.id)
    return profile


def configuration(repository: Path, node: Path, browser: Path) -> PrintConfiguration:
    """Measure actual executable bytes; runtime authority remains the owner's checks."""
    profile = load_record(repository / PROFILE_PATH, PrintProfile)
    return PrintConfiguration(
        node_sha256=runtime_digest(node.resolve(strict=True)),
        browser_root=str(browser.resolve(strict=True)),
        renderer_image=profile.image,
    )


def prepare(workspace: Path, runtime: ContractRuntime, output: Path) -> None:
    """Assemble clean pinned checkouts with a previously committed configuration."""
    root = workspace.resolve()
    repository = root / "integration-evals"
    profile = verify_source(repository, root / "print-production")
    config = load_record(repository / CONFIGURATION_PATH, PrintConfiguration)
    if config.node_sha256 != runtime.sha256 or runtime_digest(Path(runtime.path)) != runtime.sha256:
        fail("print_node_digest_mismatch", "print-production")
    if config.renderer_image != profile.image:
        fail("print_image_pin_mismatch", "print-production")
    canonical = load_record(repository / "contracts/producer-pin.json", ContractPin)
    components: list[Component] = []
    for name, lock in (
        ("integration-evals", "uv.lock"),
        ("shared-contracts", "package-lock.json"),
        ("print-production", "package-lock.json"),
    ):
        checkout = root / name
        command = (runtime.path, "dist/scripts/integration-evals/cli.js")
        owner = name == "print-production"
        components.append(
            Component(
                repository=name,
                revision=git_value(checkout, "rev-parse", "HEAD"),
                tree=git_value(checkout, "rev-parse", "HEAD^{tree}"),
                lockfile_path=lock,
                lockfile_digest=digest(read_bytes(checkout / lock)),
                command=(*command, "run") if owner else (),
                cleanup_command=(*command, "cleanup") if owner else (),
                supported_modes=(Mode.MOCK,) if owner else None,
            )
        )
    contract = next(
        component for component in components if component.repository == "shared-contracts"
    )
    if (contract.revision, contract.tree, contract.lockfile_digest) != (
        canonical.revision,
        canonical.tree,
        canonical.lockfile_digest,
    ):
        fail("print_contract_source_pin_mismatch", "shared-contracts")
    catalog = load_record(repository / "fixtures/catalog.json", Catalog)
    assembly = Assembly(
        owner="integration-evals",
        kind="component",
        selected_cases=(CaseId("print-invalid"),),
        integration_revision=git_value(repository, "rev-parse", "HEAD"),
        components=tuple(components),
        contract_digest=canonical.schema_manifest_digest,
        contract_artifact_path="generated/schema-manifest.json",
        fixture_digest=digest(catalog.model_dump_json().encode()),
        runtime=sys.version,
        configuration_digest=digest(read_bytes(repository / CONFIGURATION_PATH)),
        configuration_artifact_path=CONFIGURATION_PATH,
    )
    validate_assembly(assembly, root, assembly.fixture_digest)
    with output.open("x", encoding="utf-8") as destination:
        _ = destination.write(assembly.model_dump_json(indent=2))
