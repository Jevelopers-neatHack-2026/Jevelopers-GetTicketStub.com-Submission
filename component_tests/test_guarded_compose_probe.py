"""Portable checks of the original producer's canonical pending-state predicate."""

import hashlib
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from time import monotonic

import pytest

from component_tests.container_docker import Docker
from component_tests.container_records import Configuration, Observation
from component_tests.guarded_active import positive_key
from component_tests.guarded_compose_probe import bounded_file, pending_attempt
from component_tests.guarded_identity import OwnerBinding
from integration_evals.artifacts import digest
from integration_evals.errors import InvalidArtifactError


@pytest.mark.parametrize("outcome", [None, "failed", "succeeded"])
def test_pending_requires_unfinished_original_compose_with_started_event(
    outcome: str | None,
) -> None:
    with closing(sqlite3.connect(":memory:")) as connection:
        _ = connection.executescript(
            """CREATE TABLE attempts(id TEXT, operation TEXT, started INTEGER, outcome TEXT);
               CREATE TABLE operations(id TEXT, key TEXT);
               CREATE TABLE observations(attempt TEXT, kind TEXT);"""
        )
        # The producer hashes compact JSON, independently of the observation helper.
        key = hashlib.sha256(b'["composeArtifact","original-key"]').hexdigest()
        _ = connection.execute("INSERT INTO operations VALUES (?,?)", ("operation", key))
        _ = connection.execute(
            "INSERT INTO attempts VALUES (?,?,?,?)", ("attempt", "operation", 123, outcome)
        )
        _ = connection.execute(
            "INSERT INTO observations VALUES (?,?)", ("attempt", "execution_started")
        )
        result = pending_attempt(connection, "original-key")
        assert result["pending"] is (outcome is None)
        if outcome is None:
            assert result["operation_name"] == "composeArtifact"
            assert result["execution_started_events"] == 1
            with pytest.raises(AssertionError):
                _ = pending_attempt(connection, "different-request-key")
            _ = connection.execute("DELETE FROM observations")
            with pytest.raises(AssertionError):
                _ = pending_attempt(connection, "original-key")


@pytest.mark.parametrize("replacement", ["fifo", "oversized", "symlink"])
def test_guest_mapping_reader_rejects_owner_replacements(tmp_path: Path, replacement: str) -> None:
    path = tmp_path / "mapping.json"
    if replacement == "fifo":
        os.mkfifo(path)
    elif replacement == "oversized":
        _ = path.write_bytes(b"x" * 4097)
    else:
        outside = tmp_path / "outside"
        _ = outside.write_bytes(b"{}")
        path.symlink_to(outside)
    with pytest.raises((AssertionError, OSError)):
        _ = bounded_file(path, 4096)


def test_no_pending_diagnostics_distinguish_registration_admission_and_completion() -> None:
    """Readonly primitive fixture; none of these states establishes active execution."""
    with closing(sqlite3.connect(":memory:")) as connection:
        _ = connection.executescript(
            """CREATE TABLE attempts(id TEXT, operation TEXT, started INTEGER, outcome TEXT);
               CREATE TABLE operations(id TEXT, key TEXT);
               CREATE TABLE observations(attempt TEXT, kind TEXT);"""
        )
        expected = hashlib.sha256(b'["composeArtifact","original-key"]').hexdigest()
        result = pending_attempt(connection, "original-key")
        assert result == {
            "pending": False,
            "phase": "operation-not-registered",
            "expected_operation_rows": 0,
            "attempt_rows": 0,
        }
        _ = connection.execute("INSERT INTO operations VALUES (?,?)", ("operation", expected))
        result = pending_attempt(connection, "original-key")
        assert result == {
            "pending": False,
            "phase": "operation-not-admitted",
            "expected_operation_rows": 1,
            "attempt_rows": 0,
        }
        _ = connection.execute(
            "INSERT INTO attempts VALUES (?,?,?,?)", ("attempt", "operation", 123, "succeeded")
        )
        result = pending_attempt(connection, "original-key")
        assert result == {
            "pending": False,
            "phase": "attempt-not-pending",
            "expected_operation_rows": 1,
            "attempt_rows": 1,
        }


@pytest.mark.parametrize("replacement", ["original-size", "oversized", "fifo", "symlink"])
def test_positive_fixture_key_reader_bounds_original_size_and_replacements(
    tmp_path: Path, replacement: str
) -> None:
    """Reader-only regression; synthetic bytes are not actual producer proof."""
    checkout = tmp_path / "checkout"
    fixture = (
        checkout / "node_modules/@jevelopers/shared-contracts/fixtures/ComposeArtifactRequest.json"
    )
    fixture.parent.mkdir(parents=True)
    raw = b'{"valid":{"idempotency_key":"compose_1"}}'
    # Same size as the immutable original 0.9.7 fixture, retaining finite bounds.
    raw += b" " * (225610 - len(raw))
    if replacement == "original-size":
        _ = fixture.write_bytes(raw)
    elif replacement == "oversized":
        _ = fixture.write_bytes(b" " * (256 * 1024 + 1))
    elif replacement == "fifo":
        os.mkfifo(fixture)
    else:
        outside = tmp_path / "outside"
        _ = outside.write_bytes(raw)
        fixture.symlink_to(outside)
    staging = tmp_path / "staging"
    (staging / "launch").mkdir(parents=True)
    _ = (staging / "launch/launch.json").write_text(json.dumps({"checkout": str(checkout)}))
    docker = Docker(
        Configuration(producer=checkout, directory=staging, name="ie-lifetime-" + "a" * 32),
        monotonic() + 1,
    )
    binding = OwnerBinding(
        host_owner=Observation(
            pid=1,
            uid=61002,
            gid=61002,
            groups=(61002,),
            status={},
            namespaces={},
            cgroup="reader-only",
            apparmor="docker-default (enforce)",
        ),
        host_owner_start_ticks="0",
        executable_identity=(0, 0),
        command=("original-node", "dist/tests/fixtures/integration-evals/positive-control.js"),
    )
    if replacement == "original-size":
        key, source = positive_key(docker, binding)
        assert key == "compose_1"
        assert source == {
            "path": str(fixture),
            "sha256": digest(raw),
            "kind": "immutable-original-owner-fixture",
        }
    else:
        with pytest.raises((InvalidArtifactError, AssertionError)):
            _ = positive_key(docker, binding)
    assert monotonic() < docker.deadline
