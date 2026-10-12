import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from integration_evals.artifacts import digest
from integration_evals.errors import InvalidArtifactError, fail
from integration_evals.models import Assembly, Component
from integration_evals.validation import REQUIRED_COMPONENTS, git_value, validate_assembly


def synthetic_workspace(root: Path) -> Assembly:
    git_binary = shutil.which("git")
    if git_binary is None:
        fail("git_runtime_missing", "test-workspace")
    components: list[Component] = []
    for name in sorted(REQUIRED_COMPONENTS):
        checkout = root / name
        checkout.mkdir()
        _ = (checkout / "lockfile").write_bytes(b"synthetic test lock")
        _ = (checkout / "canonical.json").write_bytes(b'{"synthetic":true}')
        _ = (checkout / "config.json").write_bytes(b'{"seed":17}')
        for arguments in (
            ("init",),
            ("add", "lockfile", "canonical.json", "config.json"),
            (
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@evals.example",
                "commit",
                "-m",
                "synthetic verification fixture",
            ),
        ):
            _ = subprocess.run(  # noqa: S603 - fixed Git commands within pytest tmp_path
                (git_binary, "-C", str(checkout), *arguments),
                capture_output=True,
                check=True,
                timeout=10,
            )
        components.append(
            Component(
                repository=name,
                revision=git_value(checkout, "rev-parse", "HEAD"),
                tree=git_value(checkout, "rev-parse", "HEAD^{tree}"),
                lockfile_path="lockfile",
                lockfile_digest=digest(b"synthetic test lock"),
            )
        )
    revision = next(
        component.revision
        for component in components
        if component.repository == "integration-evals"
    )
    return Assembly(
        owner="getticketstub.com",
        integration_revision=revision,
        components=tuple(components),
        contract_digest=digest(b'{"synthetic":true}'),
        contract_artifact_path="canonical.json",
        fixture_digest=digest(b"catalog"),
        runtime=sys.version,
        configuration_digest=digest(b'{"seed":17}'),
        configuration_artifact_path="config.json",
    )


def test_assembly_accepts_when_clean_checkouts_match(tmp_path: Path) -> None:
    # Given actual clean Git checkouts for a synthetic pin-validation test.
    assembly = synthetic_workspace(tmp_path)
    # When verifying every declared commit/tree/lock and artifact pin.
    validate_assembly(assembly, tmp_path, digest(b"catalog"))
    # Then the verifier accepts matching bytes without claiming product conformance.


def test_assembly_rejects_when_component_checkout_changed(tmp_path: Path) -> None:
    # Given a pinned component with a subsequently modified lockfile.
    assembly = synthetic_workspace(tmp_path)
    _ = (tmp_path / "agent-harness/lockfile").write_bytes(b"changed bytes")
    # When checking the composed release.
    with pytest.raises(InvalidArtifactError, match="dirty_release"):
        validate_assembly(assembly, tmp_path, digest(b"catalog"))
    # Then drifting source cannot be reported as the original tested release.


def test_assembly_rejects_when_canonical_artifact_hash_changed(tmp_path: Path) -> None:
    # Given unchanged checkouts with a manifest referring to different contract bytes.
    assembly = synthetic_workspace(tmp_path)
    altered = assembly.model_copy(update={"contract_digest": digest(b"substitute-schema")})
    # When checking the owner-supplied artifact identity.
    with pytest.raises(InvalidArtifactError, match="canonical_artifact_pin_mismatch"):
        validate_assembly(altered, tmp_path, digest(b"catalog"))
    # Then a substituted local schema cannot clear the pin check.


@pytest.mark.parametrize("change", ["runtime", "configuration_digest"])
def test_assembly_rejects_when_execution_environment_pin_differs(
    tmp_path: Path, change: str
) -> None:
    # Given clean actual checkouts and a false runtime or configuration identity.
    assembly = synthetic_workspace(tmp_path)
    value = "IMPOSSIBLE runtime" if change == "runtime" else digest(b"different configuration")
    altered = assembly.model_copy(update={change: value})
    # When verifying environment pins before dispatch.
    with pytest.raises(InvalidArtifactError):
        validate_assembly(altered, tmp_path, digest(b"catalog"))
    # Then informational strings cannot masquerade as enforced execution identity.


def test_component_manifest_accepts_when_unrelated_components_absent(tmp_path: Path) -> None:
    # Given a selected producer and its actual canonical/evaluator dependency pins.
    assembly = synthetic_workspace(tmp_path)
    names = {"agent-harness", "shared-contracts", "integration-evals"}
    scoped = assembly.model_copy(
        update={
            "kind": "component",
            "owner": "agent-harness",
            "components": tuple(
                component for component in assembly.components if component.repository in names
            ),
        }
    )
    # When validating only this declared component scope.
    validate_assembly(scoped, tmp_path, digest(b"catalog"))
    # Then absent unrelated product services do not prevent producer-ready verification.
