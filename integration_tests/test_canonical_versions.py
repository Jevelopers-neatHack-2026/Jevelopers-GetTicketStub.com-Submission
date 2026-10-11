import os
import shutil
from pathlib import Path
from typing import Literal, assert_never

import pytest
from pydantic import JsonValue, TypeAdapter
from typer.testing import CliRunner

from integration_evals.artifacts import load_record, read_bytes
from integration_evals.cli import app
from integration_evals.contract_records import ContractReceipt
from integration_evals.contract_sources import SchemaIndex, bind_contract_observation
from integration_evals.errors import InvalidArtifactError
from integration_tests.test_canonical_failure import pin_owned_producer

type Mutation = Literal[
    "missing-v2", "duplicate-pair", "swapped-schema", "swapped-fixture", "omitted-case"
]


@pytest.fixture
def version_fault(tmp_path: Path, mutation: Mutation) -> tuple[Path, Path]:
    # Given the actual SDK in an owned copy with one controlled contract/version metadata fault.
    producer = tmp_path / "producer"
    _ = shutil.copytree(
        Path(os.environ["IE_CONTRACT_SOURCE"]), producer, ignore=shutil.ignore_patterns(".git")
    )
    schemas_path = producer / "generated/schema-manifest.json"
    schemas = load_record(schemas_path, SchemaIndex)
    legacy = next(
        index
        for index, row in enumerate(schemas.schemas)
        if row.key == ("BudgetReservation", "1.0.0")
    )
    current = next(
        index
        for index, row in enumerate(schemas.schemas)
        if row.key == ("BudgetReservation", "2.0.0")
    )
    adapter = TypeAdapter(dict[str, JsonValue])
    document = adapter.validate_json(read_bytes(schemas_path))
    rows = document["schemas"]
    assert isinstance(rows, list)
    target = schemas_path
    match mutation:
        case "missing-v2":
            document["schemas"] = rows[:current] + rows[current + 1 :]
        case "duplicate-pair":
            document["schemas"] = [*rows, rows[current]]
        case "swapped-schema":
            row = rows[current]
            old = rows[legacy]
            assert isinstance(row, dict)
            assert isinstance(old, dict)
            row["path"], row["sha256"] = old["path"], old["sha256"]
        case "swapped-fixture" | "omitted-case":
            target = producer / "generated/fixture-manifest.json"
            document = adapter.validate_json(read_bytes(target))
            declarations = document["contracts"]
            assert isinstance(declarations, list)
            row = next(
                item
                for item in declarations
                if isinstance(item, dict)
                and item.get("contract") == "BudgetReservation"
                and item.get("version") == "2.0.0"
            )
            assert isinstance(row, dict)
            match mutation:
                case "swapped-fixture":
                    row["path"] = "fixtures/BudgetReservation.json"
                case "omitted-case":
                    cases = row["cases"]
                    assert isinstance(cases, list)
                    row["cases"] = cases[:-1]
                case _:
                    assert_never(mutation)
        case _:
            assert_never(mutation)
    _ = target.write_bytes(adapter.dump_json(document))
    pin = pin_owned_producer(producer)
    return producer, pin


@pytest.mark.parametrize(
    "mutation",
    ["missing-v2", "duplicate-pair", "swapped-schema", "swapped-fixture", "omitted-case"],
)
def test_exact_version_fault_cannot_be_hidden_by_retained_v1(
    tmp_path: Path, mutation: Mutation, version_fault: tuple[Path, Path]
) -> None:
    producer, pin = version_fault
    output = tmp_path / "receipts"
    # When the unchanged public SDK is consumed through the full-scope CLI.
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
    receipt = load_record(next(output.glob("contracts-*/contracts.json")), ContractReceipt)
    # Then v1 cannot satisfy v2 and inconsistent joins cannot manufacture a conformance pass.
    match mutation:
        case "missing-v2":
            assert result.exit_code == 2, result.output
            assert receipt.execution == "passed", receipt.reason
            assert receipt.missing_contracts == ("BudgetReservation@2.0.0",)
            assert receipt.observation is not None
            assert len(receipt.observation.results) == 53
            assert any(
                row.key == ("BudgetReservation", "1.0.0") for row in receipt.observation.results
            )
        case "duplicate-pair" | "swapped-schema" | "swapped-fixture" | "omitted-case":
            assert result.exit_code == 1, result.output
            assert receipt.execution == "error", receipt.reason
            assert receipt.observation is None
        case _:
            assert_never(mutation)
    assert receipt.product_acceptance == "blocked"
    assert receipt.owner_acknowledgement is None


@pytest.mark.parametrize("mutation", ["omit", "forge"])
def test_historical_semantics_are_bound_to_the_owner_fixture(
    tmp_path: Path, mutation: Literal["omit", "forge"]
) -> None:
    # Given a valid receipt from the actual 0.6 SDK, including its historical v1 labels.
    producer = Path(os.environ["IE_CONTRACT_SOURCE"])
    output = tmp_path / "receipts"
    result = CliRunner().invoke(
        app,
        [
            "contracts",
            "--pin",
            "contracts/producer-pin.json",
            "--producer",
            str(producer),
            "--runtime",
            os.environ["IE_CONTRACT_RUNTIME"],
            "--output",
            str(output),
        ],
    )
    assert result.exit_code == 0, result.output
    receipt = load_record(next(output.glob("contracts-*/contracts.json")), ContractReceipt)
    observation = receipt.observation
    assert observation is not None
    bind_contract_observation(observation, producer, receipt.pin)
    row = next(row for row in observation.results if row.key == ("BudgetReservation", "1.0.0"))
    assert row.semantic_records
    match mutation:
        case "omit":
            altered = row.model_copy(update={"semantic_records": ()})
        case "forge":
            forged = row.semantic_records[0].model_copy(
                update={"profile": "current-authority", "operational_authority": True}
            )
            altered = row.model_copy(
                update={"semantic_records": (forged, *row.semantic_records[1:])}
            )
        case _:
            assert_never(mutation)
    changed = observation.model_copy(
        update={
            "results": tuple(
                altered if item.key == row.key else item for item in observation.results
            )
        }
    )
    # When a consumer observation drops the historical context or invents current authority.
    with pytest.raises(InvalidArtifactError, match="contract_semantic_"):
        bind_contract_observation(changed, producer, receipt.pin)
    # Then valid case membership alone cannot authenticate altered semantic metadata.
