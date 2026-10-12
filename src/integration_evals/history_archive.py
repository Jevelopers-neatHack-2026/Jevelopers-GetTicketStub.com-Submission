"""Serialized append-only snapshots with explicit stale-writer and incomplete-write denial."""

import fcntl
import os
from pathlib import Path

from integration_evals.artifacts import confined_path, digest, load_record, read_bytes, reject_leaks
from integration_evals.errors import fail
from integration_evals.history import History, validate_record
from integration_evals.models import Digest, Identifier, Record, Run, Suite
from integration_evals.report_validation import validate_evidence
from integration_evals.reporting import Tracker, save_snapshot


class Successor(Record):
    """An immutable reservation binds one parent to exactly one successor snapshot."""

    run_id: Identifier
    history_digest: Digest


def _directory(root: Path, identity: str) -> Path:
    if identity in {".", ".."}:
        fail("unsafe_history_path", "history")
    target = root / identity
    if target.is_symlink():
        fail("symlink_history", "history")
    return confined_path(root, identity)


def _read(directory: Path, suite: Suite) -> History:
    raw = read_bytes(directory / "history.json")
    reject_leaks(raw, "history")
    history = History.model_validate_json(raw)
    validate_record(history, suite)
    if directory.name != history.runs[-1].id:
        fail("history_location_mismatch", "history")
    if load_record(directory / "run.json", Run) != history.runs[-1]:
        fail("history_receipt_mismatch", "history")
    validate_evidence(history.runs[-1].evidence, directory, history.runs[-1])
    return history


def load_history(directory: Path, suite: Suite) -> History:
    """Follow immutable successors; a request for an old snapshot still returns every sample."""
    if directory.is_symlink():
        fail("symlink_history", "history")
    history = _read(directory, suite)
    root = directory.parent
    for index, run in enumerate(history.runs[:-1]):
        ancestor = _directory(root, run.id)
        retained = _read(ancestor, suite)
        if (
            retained.runs != history.runs[: index + 1]
            or retained.quarantines != history.quarantines
        ):
            fail("history_ancestor_mismatch", "history")
        link = load_record(ancestor / "successor.json", Successor)
        expected = History(runs=history.runs[: index + 2], quarantines=history.quarantines)
        if link.run_id != expected.runs[-1].id or link.history_digest != digest(
            expected.model_dump_json().encode()
        ):
            fail("history_successor_mismatch", "history")
    successor = directory / "successor.json"
    if successor.exists() or successor.is_symlink():
        link = load_record(successor, Successor)
        if link.run_id in {run.id for run in history.runs}:
            fail("history_identity_cycle", "history")
        following = _read(_directory(root, link.run_id), suite)
        if (
            digest(following.model_dump_json().encode()) != link.history_digest
            or following.runs[:-1] != history.runs
            or following.quarantines != history.quarantines
        ):
            fail("history_successor_mismatch", "history")
        return load_history(_directory(root, link.run_id), suite)
    _check_terminal(root, history)
    return history


def _check_terminal(root: Path, history: History) -> None:
    """Reject erased successor links when a later snapshot is still retained."""
    for path in root.glob("*/history.json"):
        raw = read_bytes(path)
        reject_leaks(raw, "history")
        retained = History.model_validate_json(raw)
        if retained.runs[0].id == history.runs[0].id and (
            len(retained.runs) > len(history.runs)
            or retained.runs != history.runs[: len(retained.runs)]
        ):
            fail("history_unlinked_snapshot", "history")


def _sync_snapshot(directory: Path) -> None:
    """Flush immutable files and directory entries before acknowledging a saved snapshot."""
    for path in (*directory.rglob("*"), directory, directory.parent):
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def save_history(
    history: History, root: Path, tracker: Tracker, suite: Suite, artifact_root: Path | None = None
) -> Path:
    """Append under a local lock; interrupted writes retain a blocking reservation."""
    validate_record(history, suite)
    root.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(root / ".history.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for index, run in enumerate(history.runs):
            prefix = History(runs=history.runs[: index + 1], quarantines=history.quarantines)
            directory = _directory(root, run.id)
            if directory.exists():
                existing = _read(directory, suite)
                if existing != prefix:
                    fail("history_snapshot_conflict", "history")
                if index == len(history.runs) - 1:
                    fail("history_snapshot_exists", "history")
                continue
            if index:
                parent = _directory(root, history.runs[index - 1].id)
                retained = load_history(parent, suite)
                if (
                    retained.runs != history.runs[:index]
                    or retained.quarantines != history.quarantines
                ):
                    fail("history_stale_writer", "history")
                link = Successor(
                    run_id=run.id, history_digest=digest(prefix.model_dump_json().encode())
                )
                with (parent / "successor.json").open("x", encoding="utf-8") as output:
                    _ = output.write(link.model_dump_json())
                    output.flush()
                    os.fsync(output.fileno())
            _ = save_snapshot(prefix, root, tracker, suite, artifact_root)
            _sync_snapshot(directory)
        return _directory(root, history.runs[-1].id)
