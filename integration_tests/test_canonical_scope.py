import os
import shutil
from pathlib import Path

import pytest
from pydantic import JsonValue, TypeAdapter
from typer.testing import CliRunner

from integration_evals.artifacts import load_record, read_bytes
from integration_evals.cli import app
from integration_evals.contract_records import ContractReceipt
from integration_evals.contract_sources import (
    FixtureIndex,
    SchemaIndex,
    required_contracts,
    required_exports,
)
from integration_tests.test_canonical_failure import pin_owned_producer


@pytest.mark.parametrize("candidate_scope", [False, True])
def test_canonical_cli_passes_when_catalog_is_complete(
    tmp_path: Path, candidate_scope: bool
) -> None:
    # Given the exact pinned canonical SDK and its frozen complete catalog.
    producer = Path(os.environ["IE_CONTRACT_SOURCE"])
    runtime = Path(os.environ["IE_CONTRACT_RUNTIME"])
    manifest = load_record(producer / "generated/schema-manifest.json", SchemaIndex)
    expected = required_contracts(producer)
    output = tmp_path / "receipts"
    # When the public CLI consumes every real SDK fixture in the selected scope.
    result = CliRunner().invoke(
        app,
        [
            "contracts",
            "--pin",
            "contracts/producer-pin.json",
            "--producer",
            str(producer),
            "--runtime",
            str(runtime),
            "--output",
            str(output),
            *(["--candidate-scope"] if candidate_scope else []),
        ],
    )
    # Then every frozen export/case passes without granting product or owner acceptance.
    assert result.exit_code == 0, result.output
    receipt = load_record(next(output.glob("contracts-*/contracts.json")), ContractReceipt)
    assert receipt.execution == "passed", receipt.reason
    assert receipt.candidate_scope == candidate_scope
    assert receipt.missing_contracts == ()
    assert receipt.observation is not None
    assert len(expected) == 76
    assert receipt.observation.required_contracts == expected
    assert {row.contract for row in receipt.observation.results} == set(expected)
    assert receipt.observation.required_versions is not None
    assert tuple(item.key for item in receipt.observation.required_versions) == tuple(
        item.key for item in required_exports(producer)
    )
    assert len(receipt.observation.results) == 86
    historical = [row for row in receipt.observation.results if row.semantic_records]
    assert len(historical) == 9
    for row in historical:
        assert row.version == "1.0.0"
        assert row.fixture_path is not None
        source = TypeAdapter(dict[str, JsonValue]).validate_json(
            read_bytes(producer / row.fixture_path)
        )
        cases = source["cases"]
        assert isinstance(cases, list)
        expected_cases = tuple(
            case["id"]
            for case in cases
            if isinstance(case, dict) and case.get("mode") == "semantic"
        )
        assert tuple(record.case for record in row.semantic_records) == expected_cases
        assert all(
            record.profile == "historical_finance_characterization"
            and record.operational_authority is False
            for record in row.semantic_records
        )
    for row, schema in zip(receipt.observation.results, manifest.schemas, strict=True):
        assert row.fixture_path is not None
        fixtures = load_record(producer / row.fixture_path, FixtureIndex)
        assert (row.contract, row.schema_digest) == (schema.contract, schema.sha256)
        assert row.cases == tuple(case.id for case in fixtures.cases)
        assert row.categories == tuple(sorted({case.category for case in fixtures.cases}))
        assert row.failures == ()
    assert (receipt.mode, receipt.origin) == ("mock-only", "synthetic")
    assert receipt.product_acceptance == "blocked"
    assert receipt.owner_acknowledgement is None


def test_canonical_cli_blocks_when_one_catalog_export_is_missing(tmp_path: Path) -> None:
    # Given an owned SDK copy with only ApprovalReceipt omitted from its schema manifest.
    source = Path(os.environ["IE_CONTRACT_SOURCE"])
    producer = tmp_path / "producer"
    _ = shutil.copytree(source, producer, ignore=shutil.ignore_patterns(".git"))
    target = producer / "generated/schema-manifest.json"
    manifest = load_record(target, SchemaIndex)
    assert manifest.schemas[0].contract == "ApprovalReceipt"
    adapter = TypeAdapter(dict[str, JsonValue])
    document = adapter.validate_json(read_bytes(target))
    schemas = document["schemas"]
    assert isinstance(schemas, list)
    document["schemas"] = schemas[1:]
    _ = target.write_bytes(adapter.dump_json(document))
    pin = pin_owned_producer(producer)
    output = tmp_path / "receipts"
    # When full-scope conformance executes the unchanged SDK against the full catalog.
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
    # Then missing scope remains an exit-2 blocker with the exact missing export retained.
    assert result.exit_code == 2, result.output
    receipt = load_record(next(output.glob("contracts-*/contracts.json")), ContractReceipt)
    assert receipt.execution == "passed", receipt.reason
    assert receipt.missing_contracts == ("ApprovalReceipt",)
    assert receipt.observation is not None
    assert len(receipt.observation.results) == 85
    assert all(row.failures == () for row in receipt.observation.results)
    assert (receipt.mode, receipt.origin) == ("mock-only", "synthetic")
    assert receipt.product_acceptance == "blocked"
    assert receipt.owner_acknowledgement is None
