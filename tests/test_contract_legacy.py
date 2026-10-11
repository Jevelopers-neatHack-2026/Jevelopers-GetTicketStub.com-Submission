from pathlib import Path

from integration_evals.artifacts import digest, load_record, read_bytes
from integration_evals.contract_records import ContractReceipt
from integration_evals.contracts import validate_contract_observation


def test_actual_05_receipt_keeps_its_original_unversioned_wire_shape() -> None:
    # Given the untouched positive 0.5 receipt captured from the public CLI before this upgrade.
    root = Path(__file__).parent / "fixtures/canonical-0.5"
    original = read_bytes(root / "contracts.json")
    assert digest(original) == (root / "contracts.sha256").read_text(encoding="utf-8")
    # When the current reader validates that historical receipt without rewriting its bytes.
    receipt = load_record(root / "contracts.json", ContractReceipt)
    assert receipt.observation is not None
    validate_contract_observation(receipt.observation, receipt.pin)
    # Then original scope and safety labels remain valid and new metadata is not fabricated.
    assert receipt.execution == "passed"
    assert receipt.observation.required_versions is None
    assert len(receipt.observation.results) == 45
    assert sum(len(row.cases) for row in receipt.observation.results) == 971
    assert all(
        row.fixture_path is None and row.semantic_records == ()
        for row in receipt.observation.results
    )
    assert receipt.missing_contracts == ()
    assert receipt.product_acceptance == "blocked"
    assert receipt.owner_acknowledgement is None
    assert read_bytes(root / "contracts.json") == original
