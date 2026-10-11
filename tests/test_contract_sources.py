import json
from pathlib import Path

import pytest

from integration_evals.artifacts import digest
from integration_evals.contract_records import ContractObservation, ContractPin, ContractSlice
from integration_evals.contract_sources import bind_contract_observation
from integration_evals.contracts import validate_contract_observation
from integration_evals.errors import InvalidArtifactError


def metadata_packet(root: Path) -> tuple[ContractObservation, ContractPin]:
    (root / "generated").mkdir()
    (root / "fixtures").mkdir()
    (root / "docs").mkdir()
    schema = {
        "contract": "Example",
        "version": "1.0.0",
        "path": "schema.json",
        "sha256": digest(b"schema"),
    }
    _ = (root / "generated/schema-manifest.json").write_text(
        json.dumps({"schemas": [schema]}), encoding="utf-8"
    )
    _ = (root / "generated/fixture-manifest.json").write_text(
        json.dumps({"digest": "sha256:" + digest(b"fixtures")}), encoding="utf-8"
    )
    cases = [
        {"id": "positive", "category": "minimal"},
        {"id": "negative", "category": "unknown_field"},
    ]
    _ = (root / "fixtures/Example.json").write_text(json.dumps({"cases": cases}), encoding="utf-8")
    _ = (root / "docs/contract-catalog.md").write_text(
        '```json catalog\n{"contracts":[{"name":"Example"},{"name":"Missing"}]}\n```',
        encoding="utf-8",
    )
    pin = ContractPin(
        revision="a" * 40,
        tree="b" * 40,
        lockfile_digest=digest(b"lock"),
        schema_manifest_digest=digest(b"manifest"),
        fixture_manifest_digest=digest(b"fixtures"),
        catalog_digest=digest(b"catalog"),
        node_version="22.23.3",
    )
    observation = ContractObservation(
        node_version=pin.node_version,
        fixture_digest=digest(b"fixtures"),
        required_contracts=("Example", "Missing"),
        results=(
            ContractSlice(
                contract="Example",
                version="1.0.0",
                schema_digest=digest(b"schema"),
                cases=("positive", "negative"),
                failures=(),
                categories=("minimal", "unknown_field"),
            ),
        ),
    )
    return observation, pin


def test_contract_metadata_binds_when_source_scope_matches(tmp_path: Path) -> None:
    # Given matching metadata, including an unimplemented required export.
    observation, pin = metadata_packet(tmp_path)
    # When joining fixture execution to the source declarations.
    bind_contract_observation(observation, tmp_path, pin)
    # Then the undeclared completion remains visibly absent from executed exports.
    assert set(observation.required_contracts) - {row.contract for row in observation.results} == {
        "Missing"
    }


@pytest.mark.parametrize(
    "mutation", ["case", "schema", "export", "catalog", "digest", "runtime", "category"]
)
def test_contract_metadata_rejects_when_execution_claim_drifts(
    tmp_path: Path, mutation: str
) -> None:
    # Given a valid source-bound packet changed at one execution boundary.
    observation, pin = metadata_packet(tmp_path)
    row = observation.results[0]
    changes = {
        "case": observation.model_copy(
            update={"results": (row.model_copy(update={"cases": ("positive",)}),)}
        ),
        "schema": observation.model_copy(
            update={"results": (row.model_copy(update={"schema_digest": digest(b"wrong")}),)}
        ),
        "export": observation.model_copy(update={"results": ()}),
        "catalog": observation.model_copy(update={"required_contracts": ("Example",)}),
        "digest": observation.model_copy(update={"fixture_digest": digest(b"wrong")}),
        "runtime": observation.model_copy(update={"node_version": "wrong"}),
        "category": observation.model_copy(
            update={"results": (row.model_copy(update={"categories": ("minimal",)}),)}
        ),
    }
    # When validating the isolated child's claim.
    with pytest.raises(InvalidArtifactError, match="contract_"):
        bind_contract_observation(changes[mutation], tmp_path, pin)
    # Then missing cases or substituted identities cannot be reported as full coverage.


def test_contract_category_gate_rejects_when_negative_classes_missing(tmp_path: Path) -> None:
    # Given a source-bound export containing only two categories.
    observation, pin = metadata_packet(tmp_path)
    # When enforcing complete positive and negative fixture classes.
    with pytest.raises(InvalidArtifactError, match="incomplete_contract_fixture_categories"):
        validate_contract_observation(observation, pin)
    # Then a happy-path-only export cannot obtain a conformance pass.
