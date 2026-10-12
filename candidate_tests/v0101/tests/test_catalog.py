import os
import shutil
from pathlib import Path
from typing import Literal, assert_never

import pytest
from typer.testing import CliRunner

from integration_evals.artifacts import load_record
from integration_evals.cli import app
from integration_evals.contract_package import InstalledPackage, verify_installed_package
from integration_evals.contract_records import ContractPin, ContractReceipt, ContractRuntime
from integration_evals.contract_sources import (
    FixtureIndex,
    SchemaIndex,
    bind_contract_observation,
    required_exports,
)
from integration_evals.errors import InvalidArtifactError
from integration_tests.test_canonical_failure import pin_owned_producer


@pytest.mark.parametrize("candidate_scope", [False, True])
@pytest.mark.parametrize("surface", ["source", "installed"])
def test_complete_candidate_catalog(
    candidate_scope: bool, surface: Literal["source", "installed"]
) -> None:
    # Given the exact opt-in source and independently installed archive.
    producer = Path(os.environ["IE_CONTRACT_SOURCE"])
    runtime = os.environ[
        "IE_CONTRACT_RUNTIME" if surface == "source" else "IE_CONTRACT_INSTALLED_RUNTIME"
    ]
    output = Path(os.environ["IE_CONTRACT_EVIDENCE"]) / surface / str(candidate_scope)
    # When the existing explicit-pin CLI runs complete source or installed conformance.
    result = CliRunner().invoke(
        app,
        [
            "contracts",
            "--pin",
            "contracts/producer-pin-v0101.json",
            "--producer",
            str(producer),
            "--runtime",
            runtime,
            "--output",
            str(output),
            *(["--candidate-scope"] if candidate_scope else []),
        ],
    )
    # Then every version and case joins to its source identity with historical authority intact.
    assert result.exit_code == 0, result.output
    receipt = load_record(Path(result.output.strip()) / "contracts.json", ContractReceipt)
    observation = receipt.observation
    assert receipt.execution == "passed"
    assert observation is not None
    assert receipt.candidate_scope == candidate_scope
    assert receipt.execution_surface == ("source" if surface == "source" else "installed-package")
    assert receipt.missing_contracts == ()
    assert len(observation.required_contracts) == 77
    assert len(observation.results) == 88
    assert sum(len(row.cases) for row in observation.results) == 1673
    assert observation.required_versions is not None
    assert tuple(row.key for row in observation.required_versions) == tuple(
        row.key for row in required_exports(producer)
    )
    assert {
        ("UsageEvent", "1.0.0"),
        ("UsageEvent", "2.0.0"),
        ("ProviderReportedCostEvidence", "1.0.0"),
    } <= {row.key for row in observation.results}
    schemas = load_record(producer / "generated/schema-manifest.json", SchemaIndex)
    for row, schema in zip(observation.results, schemas.schemas, strict=True):
        assert row.key == schema.key
        assert row.schema_digest == schema.sha256
        assert row.fixture_path is not None
        fixture = load_record(producer / row.fixture_path, FixtureIndex)
        assert row.cases == tuple(case.id for case in fixture.cases)
        assert row.failures == ()
    historical = [row for row in observation.results if row.semantic_records]
    assert len(historical) == 9
    assert all(row.version == "1.0.0" for row in historical)
    assert all(
        record.profile == "historical_finance_characterization"
        and record.operational_authority is False
        for row in historical
        for record in row.semantic_records
    )
    assert receipt.product_acceptance == "blocked"
    assert receipt.owner_acknowledgement is None


@pytest.mark.parametrize("fault", ["unknown-profile", "malformed-catalog"])
def test_unaccepted_metadata_retains_sanitized_receipt(
    tmp_path: Path, fault: Literal["unknown-profile", "malformed-catalog"]
) -> None:
    # Given a task-owned copy with invalid metadata, committed under a new exact test pin.
    producer = tmp_path / "producer"
    _ = shutil.copytree(
        Path(os.environ["IE_CONTRACT_SOURCE"]), producer, ignore=shutil.ignore_patterns(".git")
    )
    target = producer / "docs/contract-catalog.md"
    private = "synthetic-private-profile-" + "x" * 10000
    original = target.read_text(encoding="utf-8")
    altered = (
        original.replace("immutable_v1_behavior", private)
        if fault == "unknown-profile"
        else "```json catalog\n{invalid:" + private + "\n```"
    )
    assert altered != original
    _ = target.write_text(altered, encoding="utf-8")
    pin = pin_owned_producer(producer)
    output = Path(os.environ["IE_CONTRACT_EVIDENCE"]) / fault
    # When the real CLI rejects the catalog before execution.
    result = CliRunner().invoke(
        app,
        [
            "contracts",
            "--pin",
            str(pin),
            "--producer",
            str(producer),
            "--runtime",
            os.environ["IE_CONTRACT_RUNTIME"],
            "--output",
            str(output),
        ],
    )
    # Then an immutable bounded failure survives without private values or zero unknown scope.
    assert result.exit_code == 1, result.output
    path = Path(result.output.strip()) / "contracts.json"
    receipt = load_record(path, ContractReceipt)
    assert receipt.execution == "error"
    assert receipt.observation is None
    assert receipt.exit_code is None
    assert receipt.missing_contracts == ("canonical-catalog-unavailable",)
    assert receipt.product_acceptance == "blocked"
    assert receipt.owner_acknowledgement is None
    assert private not in path.read_text(encoding="utf-8") + result.output
    assert path.stat().st_size < 4096


@pytest.mark.parametrize("fault", ["archive", "installed", "extra", "symlink", "old-pin"])
def test_candidate_package_rejects_tampering(
    tmp_path: Path, fault: Literal["archive", "installed", "extra", "symlink", "old-pin"]
) -> None:
    # Given a separate copy of the installed candidate and its reviewed archive.
    runtime = load_record(Path(os.environ["IE_CONTRACT_INSTALLED_RUNTIME"]), ContractRuntime)
    assert runtime.installation is not None
    root = tmp_path / "package"
    _ = shutil.copytree(runtime.installation.root, root)
    archive = tmp_path / "package.tgz"
    _ = shutil.copyfile(runtime.installation.archive, archive)
    pin = load_record(Path("contracts/producer-pin-v0101.json"), ContractPin)
    match fault:
        case "archive":
            _ = archive.write_bytes(b"substituted archive")
            code = "contract_archive_digest_mismatch"
        case "installed":
            _ = (root / "package.json").write_bytes(b"substituted package")
            code = "contract_installed_bytes_mismatch"
        case "extra":
            _ = (root / "extra.mjs").write_bytes(b"extra")
            code = "contract_installed_scope_mismatch"
        case "symlink":
            (root / "linked.mjs").symlink_to(root / "package.json")
            code = "contract_installed_symlink"
        case "old-pin":
            pin = load_record(Path("contracts/producer-pin.json"), ContractPin)
            code = "contract_archive_digest_mismatch"
        case _:
            assert_never(fault)
    assert pin.package is not None
    # When the unchanged package verifier checks the actual bytes, then each fault is rejected.
    with pytest.raises(InvalidArtifactError, match=code):
        verify_installed_package(InstalledPackage(root, archive), pin.package)


@pytest.fixture
def source_receipt(tmp_path: Path) -> ContractReceipt:
    output = tmp_path / "receipts"
    result = CliRunner().invoke(
        app,
        [
            "contracts",
            "--pin",
            "contracts/producer-pin-v0101.json",
            "--producer",
            os.environ["IE_CONTRACT_SOURCE"],
            "--runtime",
            os.environ["IE_CONTRACT_RUNTIME"],
            "--output",
            str(output),
        ],
    )
    assert result.exit_code == 0, result.output
    return load_record(Path(result.output.strip()) / "contracts.json", ContractReceipt)


@pytest.mark.parametrize("fault", ["version", "case", "historical"])
def test_candidate_observation_rejects_inexact_joins(
    fault: Literal["version", "case", "historical"], source_receipt: ContractReceipt
) -> None:
    # Given an independently executed complete receipt from the actual source CLI.
    receipt = source_receipt
    observation = receipt.observation
    assert observation is not None
    contract = "BudgetReservation" if fault == "historical" else "UsageEvent"
    version = "1.0.0" if fault == "historical" else "2.0.0"
    row = next(row for row in observation.results if row.key == (contract, version))
    match fault:
        case "version":
            changed = row.model_copy(update={"version": "1.0.0"})
        case "case":
            changed = row.model_copy(update={"cases": row.cases[:-1]})
        case "historical":
            assert row.semantic_records
            changed = row.model_copy(update={"semantic_records": ()})
        case _:
            assert_never(fault)
    altered = observation.model_copy(
        update={
            "results": tuple(
                changed if item.key == row.key else item for item in observation.results
            )
        }
    )
    # When binding the altered observation, then retained versions cannot mask lost coverage.
    with pytest.raises(InvalidArtifactError, match="contract_"):
        bind_contract_observation(altered, Path(os.environ["IE_CONTRACT_SOURCE"]), receipt.pin)
