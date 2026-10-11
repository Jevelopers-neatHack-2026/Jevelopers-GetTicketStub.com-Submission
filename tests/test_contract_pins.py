import shutil
import subprocess
from pathlib import Path

import pytest

from integration_evals.artifacts import digest
from integration_evals.contract_records import ContractPin
from integration_evals.contracts import ContractSettings, validate_contract_pin
from integration_evals.errors import InvalidArtifactError, fail
from integration_evals.validation import git_value


def pinned_checkout(root: Path) -> ContractSettings:
    (root / "generated").mkdir()
    (root / "docs").mkdir()
    for name in (
        "package-lock.json",
        "generated/schema-manifest.json",
        "generated/fixture-manifest.json",
        "docs/contract-catalog.md",
    ):
        _ = (root / name).write_bytes(b"immutable metadata test input")
    node = root / "node"
    _ = node.write_bytes(b"runtime identity test input; never executed")
    git = shutil.which("git")
    if git is None:
        fail("git_runtime_missing", "contract-pin-test")
    for command in (
        ("init",),
        ("add", "."),
        (
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@evals.example",
            "commit",
            "-m",
            "pin fixture",
        ),
    ):
        _ = subprocess.run(  # noqa: S603 - fixed Git arguments in pytest tmp_path
            (git, "-C", str(root), *command), check=True, capture_output=True, timeout=10
        )
    pin = ContractPin(
        revision=git_value(root, "rev-parse", "HEAD"),
        tree=git_value(root, "rev-parse", "HEAD^{tree}"),
        lockfile_digest=digest(b"immutable metadata test input"),
        schema_manifest_digest=digest(b"immutable metadata test input"),
        fixture_manifest_digest=digest(b"immutable metadata test input"),
        catalog_digest=digest(b"immutable metadata test input"),
        node_version="22.23.3",
    )
    return ContractSettings(root, root, node, digest(node.read_bytes()), pin)


def test_contract_pin_accepts_when_actual_identity_matches(tmp_path: Path) -> None:
    # Given clean actual Git and binary identities for a pin-only fixture.
    settings = pinned_checkout(tmp_path)
    # When checking metadata before any runtime execution.
    validate_contract_pin(settings)
    # Then the guard accepts matching bytes without claiming SDK conformance.


@pytest.mark.parametrize(
    "field", ["revision", "tree", "lockfile_digest", "catalog_digest", "runtime"]
)
def test_contract_pin_rejects_when_expected_identity_differs(tmp_path: Path, field: str) -> None:
    # Given otherwise matching clean source and binary identities.
    settings = pinned_checkout(tmp_path)
    value = "a" * 40 if field in {"revision", "tree"} else digest(b"different bytes")
    pin = settings.pin.model_copy(update={field: value}) if field != "runtime" else settings.pin
    altered = ContractSettings(
        settings.repository,
        settings.producer,
        settings.node,
        value if field == "runtime" else settings.node_digest,
        pin,
    )
    # When checking a single substituted identity.
    with pytest.raises(InvalidArtifactError, match="contract_"):
        validate_contract_pin(altered)
    # Then the unapproved source or binary never reaches execution.


def test_contract_pin_rejects_when_producer_worktree_drifts(tmp_path: Path) -> None:
    # Given a pinned source with an uncommitted fixture manifest edit.
    settings = pinned_checkout(tmp_path)
    _ = (tmp_path / "generated/fixture-manifest.json").write_bytes(b"changed")
    # When checking the frozen producer checkout.
    with pytest.raises(InvalidArtifactError, match="dirty_contract_checkout"):
        validate_contract_pin(settings)
    # Then moving working-copy bytes cannot masquerade as the pinned commit.
