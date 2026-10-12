"""Bounded readonly observation of the stopped original owner's pending compose state."""

import hashlib
import json
import os
import sqlite3
import stat
import sys
from contextlib import ExitStack, closing
from pathlib import Path
from time import monotonic
from typing import TypedDict, cast


class Mapping(TypedDict):
    canonical_request: dict[str, str]


def identity(descriptor: int) -> tuple[int, int]:
    observed = os.fstat(descriptor)
    assert stat.S_ISREG(observed.st_mode)
    return observed.st_dev, observed.st_ino


def bounded_file(path: Path, cap: int) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    try:
        _ = identity(descriptor)
        data = os.read(descriptor, cap + 1)
        assert len(data) <= cap
        return data
    finally:
        os.close(descriptor)


def pending_attempt(connection: sqlite3.Connection, key: str) -> dict[str, str | int | bool | None]:
    query = """SELECT a.id,a.operation,a.started,o.key FROM attempts a
               JOIN operations o ON o.id=a.operation WHERE a.outcome IS NULL LIMIT 2"""
    rows = cast("list[tuple[str, str, int, str]]", connection.execute(query).fetchall())
    if not rows:
        return {"pending": False}
    assert len(rows) == 1
    attempt, operation, started, operation_key = rows[0]
    expected = hashlib.sha256(
        json.dumps(["composeArtifact", key], separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    assert operation_key == expected
    observed = cast(
        "tuple[int]",
        connection.execute(
            "SELECT COUNT(*) FROM observations WHERE attempt=? AND kind='execution_started'",
            (attempt,),
        ).fetchone(),
    )
    assert observed[0] == 1
    return {
        "pending": True,
        "attempt": attempt,
        "operation": operation,
        "operation_name": "composeArtifact",
        "started": started,
        "outcome": None,
        "execution_started_events": observed[0],
    }


def descriptors() -> dict[int, tuple[int, int]]:
    result: dict[int, tuple[int, int]] = {}
    for path in Path("/proc/self/fd").iterdir():
        try:
            descriptor = int(path.name)
            observed = os.fstat(descriptor)
            if stat.S_ISREG(observed.st_mode):
                result[descriptor] = (observed.st_dev, observed.st_ino)
        except OSError:
            continue
    return result


def observe(path: Path, deadline: float) -> dict[str, str | int | bool | None]:
    if not path.exists():
        return {"pending": False}
    with ExitStack() as handles:
        pinned: dict[str, tuple[int, int]] = {}
        main = -1
        for suffix, cap in (("", 16 * 1024 * 1024), ("-wal", 16 * 1024 * 1024), ("-shm", 1048576)):
            candidate = Path(str(path) + suffix)
            if suffix and not candidate.exists():
                continue
            descriptor = os.open(candidate, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
            _ = handles.callback(os.close, descriptor)
            pinned[suffix] = identity(descriptor)
            assert os.fstat(descriptor).st_size <= cap
            if not suffix:
                main = descriptor
        before = descriptors()
        try:
            # The kernel FD alias retains the bound inode; SQLite's actual DB/WAL FDs
            # are checked below rather than trusting a pathname reopening that alias.
            with closing(
                sqlite3.connect(f"file:/proc/self/fd/{main}?mode=ro", uri=True, timeout=0.01)
            ) as connection:
                _ = connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 65536)
                _ = connection.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 4096)
                _ = connection.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 32)
                connection.set_progress_handler(lambda: int(monotonic() >= deadline), 100)
                _ = connection.execute("PRAGMA query_only=ON")
                _ = connection.execute("BEGIN")
                mapping = cast(
                    "Mapping", json.loads(bounded_file(path.parent / "mapping.json", 1048576))
                )
                result = pending_attempt(
                    connection, mapping["canonical_request"]["idempotency_key"]
                )
                actual = {
                    value for descriptor, value in descriptors().items() if descriptor not in before
                }
                assert pinned[""] in actual
                # SQLite may resolve its FD alias back to the original pathname. Every
                # descriptor it actually opens must match the pinned source snapshot,
                # including sidecars that were absent before the connection opened.
                assert actual <= set(pinned.values())
                if result["pending"] is True:
                    assert {"", "-wal", "-shm"} == set(pinned)
                    assert actual == set(pinned.values())
                assert monotonic() < deadline
                result["database_inode"] = pinned[""][1]
                result["wal_inode"] = pinned.get("-wal", (0, 0))[1]
                result["shm_inode"] = pinned.get("-shm", (0, 0))[1]
                result["snapshot"] = "stopped-owner-read-transaction-bound-db-wal-shm"
                return result
        except sqlite3.OperationalError as error:
            if str(error) not in {
                "no such table: attempts",
                "no such table: observations",
                "no such table: operations",
                "database is locked",
            }:
                raise
            return {"pending": False}


if __name__ == "__main__":
    _ = sys.stdout.write(json.dumps(observe(Path(sys.argv[1]), float(sys.argv[2]))) + "\n")
