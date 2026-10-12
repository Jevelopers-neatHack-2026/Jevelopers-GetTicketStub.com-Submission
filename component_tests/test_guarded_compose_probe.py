"""Portable checks of the original producer's canonical pending-state predicate."""

import hashlib
import os
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from component_tests.guarded_compose_probe import bounded_file, pending_attempt


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
