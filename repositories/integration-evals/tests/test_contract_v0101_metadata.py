import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from integration_evals.artifacts import digest, load_record
from integration_evals.contract_records import ContractReceipt, ContractSlice, FixtureSemantics
from integration_evals.contract_sources import (
    CatalogVersion,
    FixtureCaseIndex,
    FixtureIndex,
    RequiredExport,
    SemanticProfile,
    validate_semantic_records,
)
from integration_evals.contracts import execute_contracts, save_contract_receipt
from integration_evals.errors import InvalidArtifactError
from tests.test_contract_pins import pinned_checkout


@pytest.mark.parametrize(
    "profile", ["immutable_v1_behavior", "provider_reported_unsettled_candidate"]
)
@pytest.mark.parametrize("invent_label", [False, True])
def test_usage_profiles_require_unlabelled_semantics(
    profile: SemanticProfile, invent_label: bool
) -> None:
    # Given an explicitly supported UsageEvent profile and one successful semantic case.
    target = RequiredExport.model_validate_json(
        json.dumps(
            {
                "contract": "UsageEvent",
                "version": "2.0.0",
                "schema_path": "schema.json",
                "fixtures": "fixtures.json",
                "semantic_profile": profile,
            }
        )
    )
    row = ContractSlice(
        contract="UsageEvent",
        version="2.0.0",
        schema_digest=digest(b"schema"),
        cases=("semantic-positive",),
        failures=(),
        categories=("minimal",),
        semantic_records=(
            (
                FixtureSemantics(
                    case="semantic-positive",
                    profile="historical_finance_characterization",
                    operational_authority=False,
                ),
            )
            if invent_label
            else ()
        ),
    )
    index = FixtureIndex(
        contract=row.contract,
        schema_version=row.version,
        cases=(FixtureCaseIndex(id="semantic-positive", category="minimal", mode="semantic"),),
    )
    # When checking owner-declared semantics, then only the unlabelled observation is accepted.
    if invent_label:
        with pytest.raises(InvalidArtifactError, match="contract_semantic_metadata_mismatch"):
            validate_semantic_records(row, index, target)
    else:
        validate_semantic_records(row, index, target)


def test_invented_profile_is_rejected_at_the_metadata_boundary() -> None:
    # Given an unrecognized profile, not another supported literal.
    document = json.dumps(
        {
            "schema_version": "2.0.0",
            "schema_path": "schema.json",
            "fixtures": "fixtures.json",
            "semantic_profile": "invented-profile",
        }
    )
    # When parsing metadata, then arbitrary strings cannot widen the accepted contract.
    with pytest.raises(ValidationError, match="literal_error"):
        _ = CatalogVersion.model_validate_json(document)


def test_invalid_catalog_retains_bounded_error_receipt(tmp_path: Path) -> None:
    # Given a clean, pinned checkout whose catalog bytes contain no catalog block.
    settings = pinned_checkout(tmp_path)
    # When execution encounters invalid metadata before running any producer code.
    receipt = execute_contracts(settings)
    saved = save_contract_receipt(receipt, tmp_path / "receipts")
    # Then the immutable receipt retains unknown scope and grants no coverage or authority.
    assert load_record(saved / "contracts.json", ContractReceipt) == receipt
    assert receipt.execution == "error"
    assert receipt.observation is None
    assert receipt.exit_code is None
    assert receipt.missing_contracts == ("canonical-catalog-unavailable",)
    assert receipt.product_acceptance == "blocked"
    assert receipt.owner_acknowledgement is None
    assert b"immutable metadata test input" not in (saved / "contracts.json").read_bytes()
    assert (saved / "contracts.json").stat().st_size < 4096
