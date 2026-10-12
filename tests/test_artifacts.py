import os
from pathlib import Path

import pytest

from integration_evals import artifacts
from integration_evals.artifacts import confined_path, digest, read_bytes, reject_leaks
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
        b'{"api_key": "fictional-key-value-1234"}',
        b'{"password": "fictional-password-1234"}',
        b'{"authorization": "fictional-value-1234"}',
        b'{"Authorization": "Bearer fictional-token-1234"}',
        b"Authorization: Bearer fictionaltoken1234",
        b'{"outer": [{"client_secret": "fictional-secret-1234"}]}',
        b'{"body": "{\\"password\\": \\"fictional-password-1234\\"}"}',
        b'{"\\u0070assword": "fictional-password-1234"}',
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


def test_accepts_ordinary_json_without_credentials() -> None:
    # Given JSON that merely mentions short or non-credential fields.
    # When scanning it.
    reject_leaks(b'{"password": "short", "note": "bearer of news", "count": 3}', "fixture")
    # Then ordinary data is not rejected.


def test_read_bytes_rejects_fifo_without_blocking(tmp_path: Path) -> None:
    # Given a FIFO with no writer, which would block a blocking open.
    fifo = tmp_path / "pipe"
    os.mkfifo(fifo)
    # When reading it as an artifact.
    with pytest.raises(InvalidArtifactError, match="non_regular_artifact"):
        _ = read_bytes(fifo)
    # Then it is rejected promptly as a non-regular file.


def test_read_bytes_rejects_symlink_without_following(tmp_path: Path) -> None:
    # Given a symlink to a regular file.
    target = tmp_path / "target"
    _ = target.write_bytes(b"data")
    link = tmp_path / "link"
    link.symlink_to(target)
    # When reading the link itself.
    with pytest.raises(InvalidArtifactError, match="symlink_artifact"):
        _ = read_bytes(link)
    # Then the final component is never followed.


def test_read_bytes_bounds_actual_bytes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Given a file larger than the artifact limit.
    monkeypatch.setattr(artifacts, "MAX_ARTIFACT_BYTES", 16)
    big = tmp_path / "big"
    _ = big.write_bytes(b"x" * 17)
    exact = tmp_path / "exact"
    _ = exact.write_bytes(b"y" * 16)
    # When reading each.
    with pytest.raises(InvalidArtifactError, match="oversized_artifact"):
        _ = read_bytes(big)
    # Then only the oversized one is rejected and the exact-limit file is read whole.
    assert read_bytes(exact) == b"y" * 16
