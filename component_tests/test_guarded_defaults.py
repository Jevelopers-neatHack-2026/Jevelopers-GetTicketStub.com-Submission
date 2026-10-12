"""Portable denial tests for the guarded invocation's pre-dispatch boundaries."""

import os
import subprocess
import sys
from pathlib import Path
from time import monotonic

import pytest

from component_tests.guarded_print import (
    LIMIT,
    GuardedPrint,
    bounded_response,
    real_directory,
    verify_git_keys,
    verify_tree,
)
from component_tests.test_retrieval import git
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import Settings
from integration_evals.processes import ProcessSettings


def test_guarded_backend_is_explicit_and_refuses_unsupported_host(tmp_path: Path) -> None:
    settings = ProcessSettings(tmp_path, {}, b"", subprocess.DEVNULL, 30)
    assert settings.test_invocation is None
    assert Settings(tmp_path, tmp_path, None).test_invocation is None
    backend = GuardedPrint(tmp_path, tmp_path / "untouched")
    if sys.platform == "linux" and os.getuid() == 0:
        with pytest.raises(InvalidArtifactError, match="guarded_print_requires_offline_root"):
            _ = backend(("/bin/true",), settings)
    else:
        with pytest.raises(InvalidArtifactError, match="guarded_print_host_unavailable"):
            _ = backend(("/bin/true",), settings)
    assert not backend.evidence.exists()


def test_credential_git_key_names_are_rejected_without_reading_values(tmp_path: Path) -> None:
    git(tmp_path, ("init",))
    verify_git_keys(tmp_path)
    git(
        tmp_path,
        ("config", "--local", "http.https://example.invalid/.extraheader", "SYNTHETIC_AUTH_MARKER"),
    )
    with pytest.raises(AssertionError, match="Unexpected local Git key names") as rejected:
        verify_git_keys(tmp_path)
    assert "SYNTHETIC_AUTH_MARKER" not in str(rejected.value)


def test_symlink_ancestor_and_escape_refused(tmp_path: Path) -> None:
    owned = tmp_path / "owned"
    owned.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(owned, target_is_directory=True)
    with pytest.raises(AssertionError):
        _ = real_directory(alias)
    outside = tmp_path / "outside"
    _ = outside.write_text("private-test-marker")
    (owned / "escape").symlink_to(outside)
    with pytest.raises(AssertionError):
        verify_tree(owned)
    assert outside.read_text() == "private-test-marker"


def test_hardlink_rejected_before_chown(tmp_path: Path) -> None:
    owned = tmp_path / "owned"
    owned.mkdir()
    outside = tmp_path / "outside"
    _ = outside.write_bytes(b"fixed")
    os.link(outside, owned / "hardlink")
    with pytest.raises(AssertionError):
        verify_tree(owned)


def test_stdout_capture_has_actual_byte_bound() -> None:
    with subprocess.Popen(  # noqa: S603 - fixed hostile-output test program
        (sys.executable, "-c", f"import sys; sys.stdout.buffer.write(b'x'*{LIMIT + 1})"),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ) as client:
        try:
            with pytest.raises(AssertionError, match="stdout exceeded capture limit"):
                _ = bounded_response(client, b"", monotonic() + 5)
        finally:
            if client.poll() is None:
                client.kill()
            _ = client.wait(timeout=5)
