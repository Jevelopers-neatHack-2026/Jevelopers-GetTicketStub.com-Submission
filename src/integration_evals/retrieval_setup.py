"""Stage an exact, source-only retrieval component manifest without changing checkouts."""

import sys
from pathlib import Path
from typing import Literal

import typer

from integration_evals.artifacts import digest, load_record, read_bytes
from integration_evals.cli import owned_requirements
from integration_evals.contract_records import ContractPin, ContractRuntime
from integration_evals.contracts import ContractSettings, validate_contract_pin
from integration_evals.errors import fail
from integration_evals.models import (
    Assembly,
    CaseId,
    Catalog,
    Component,
    Mode,
    Record,
    Revision,
    Selection,
    Suite,
)
from integration_evals.validation import (
    git_value,
    validate_assembly,
    validate_catalog,
    validate_suite,
)


class RetrievalProfile(Record):
    """Reviewed adapter scope; contains no credentials or provider authority."""

    case_id: Literal["ssrf-egress"]
    mode: Literal["mock-only"]
    producer_revision: Revision
    node_version: Literal["22.23.3"]


def prepare(workspace: Path, runtime: Path, output: Path) -> None:
    """Write a manifest for existing clean evaluator, canonical and retrieval checkouts."""
    root = workspace.resolve()
    repository = root / "integration-evals"
    node = load_record(runtime, ContractRuntime)
    canonical_pin = load_record(repository / "contracts/producer-pin.json", ContractPin)
    validate_contract_pin(
        ContractSettings(
            repository, root / "shared-contracts", Path(node.path), node.sha256, canonical_pin
        )
    )
    profile_path = "src/integration_evals/retrieval-profile.json"
    profile = load_record(repository / profile_path, RetrievalProfile)
    if git_value(root / "event-intelligence", "rev-parse", "HEAD") != profile.producer_revision:
        fail("retrieval_source_revision_mismatch", "event-intelligence")
    components: list[Component] = []
    adapter = repository / "src/integration_evals/retrieval_adapter.mjs"
    command = (node.path, str(adapter), "--runtime-sha256", node.sha256)
    for name, lock in (
        ("integration-evals", "uv.lock"),
        ("shared-contracts", "package-lock.json"),
        ("event-intelligence", "package-lock.json"),
    ):
        checkout = root / name
        retrieval = name == "event-intelligence"
        components.append(
            Component(
                repository=name,
                revision=git_value(checkout, "rev-parse", "HEAD"),
                tree=git_value(checkout, "rev-parse", "HEAD^{tree}"),
                lockfile_path=lock,
                lockfile_digest=digest(read_bytes(checkout / lock)),
                command=command if retrieval else (),
                cleanup_command=(*command, "--cleanup") if retrieval else (),
                supported_modes=(Mode.MOCK,) if retrieval else None,
            )
        )
    catalog = load_record(repository / "fixtures/catalog.json", Catalog)
    requirements = owned_requirements(repository)
    validate_catalog(catalog, repository / "fixtures", requirements)
    validate_suite(
        load_record(repository / "scenarios/suite.json", Suite),
        catalog,
        requirements,
        load_record(repository / "scenarios/selection.json", Selection),
    )
    assembly = Assembly(
        owner="integration-evals",
        kind="component",
        selected_cases=(CaseId(profile.case_id),),
        integration_revision=git_value(repository, "rev-parse", "HEAD"),
        components=tuple(components),
        contract_digest=canonical_pin.schema_manifest_digest,
        contract_artifact_path="generated/schema-manifest.json",
        fixture_digest=digest(catalog.model_dump_json().encode()),
        runtime=sys.version,
        configuration_digest=digest(read_bytes(repository / profile_path)),
        configuration_artifact_path=profile_path,
    )
    validate_assembly(assembly, root, assembly.fixture_digest)
    with output.open("x", encoding="utf-8") as destination:
        _ = destination.write(assembly.model_dump_json(indent=2))


if __name__ == "__main__":
    typer.run(prepare)
