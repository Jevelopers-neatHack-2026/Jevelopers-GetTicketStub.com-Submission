from pathlib import Path

import pytest

from integration_evals.artifacts import confined_path, digest, reject_leaks
from integration_evals.errors import InvalidArtifactError


@pytest.mark.parametrize("reference", ["../outside", "/outside"])
def test_rejects_path_when_outside_artifact_root(tmp_path: Path, reference: str) -> None:
    # Given an approved artifact root and an escaping reference.
    root = tmp_path / "approved"
    root.mkdir()
    # When resolving the reference.
    with pytest.raises(InvalidArtifactError, match="unsafe_path"):
        _ = confined_path(root, reference)
    # Then no outside path is accepted.


def test_rejects_path_when_symlink_escapes(tmp_path: Path) -> None:
    # Given a symlink to a file outside the approved root.
    root = tmp_path / "approved"
    root.mkdir()
    outside = tmp_path / "private"
    _ = outside.write_text("private", encoding="utf-8")
    (root / "link").symlink_to(outside)
    # When resolving the apparent local reference.
    with pytest.raises(InvalidArtifactError, match="unsafe_path"):
        _ = confined_path(root, "link")
    # Then the private target remains inaccessible through this API.


@pytest.mark.parametrize(
    "payload",
    [
        b"authorization: Bearer-pretend-secret",
        b"sk-proj-FICTIONALabcdefghijklmnop",
        b"IE_SECRET_CANARY_fixture_123",
        b"IE_PII_CANARY_fixture_123",
        b"https://assets.example/file?X-Amz-Signature=fictional",
    ],
)
def test_rejects_export_when_sensitive_value_present(payload: bytes) -> None:
    # Given fake credentials or temporary-access URL material.
    # When scanning an export.
    with pytest.raises(InvalidArtifactError):
        reject_leaks(payload, "fixture")
    # Then the rejected value is excluded from the diagnostic.


def test_hash_changes_when_artifact_bytes_change() -> None:
    # Given two otherwise identical byte sequences.
    before = b"approved bytes\n"
    after = b"approved bytes"
    # When hashing exact artifacts.
    actual = digest(before)
    # Then newline normalization cannot silently change approved output.
    assert actual != digest(after)
