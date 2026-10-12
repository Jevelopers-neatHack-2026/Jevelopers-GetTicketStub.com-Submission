"""Actual Linux filesystem-lease and stale-pidfd regressions, without owner substitution."""

import hashlib
import json
import os
import select
import socket
import sqlite3
import stat
import subprocess
import sys
from contextlib import closing
from pathlib import Path
from time import monotonic

import pytest
from pydantic import JsonValue, TypeAdapter

from component_tests.container_docker import Docker
from component_tests.container_pidfd import open_pidfd
from component_tests.container_records import Configuration, Observation
from component_tests.container_socket import bind_lease
from component_tests.guarded_active import stop_active
from component_tests.guarded_identity import OwnerBinding


def test_long_staging_root_binds_same_private_filesystem_lease(tmp_path: Path) -> None:
    control = (tmp_path / ("a" * 80) / ("b" * 80) / "control").resolve()
    control.mkdir(parents=True, mode=0o700)
    assert len(os.fsencode(control / "lease")) > 108
    # Clients can independently address the same filesystem inode through a pinned dir FD.
    with socket.socket(socket.AF_UNIX) as server, socket.socket(socket.AF_UNIX) as client:
        server.settimeout(1)
        client.settimeout(1)
        address = bind_lease(server, control)
        address.chmod(0o600)
        assert stat.S_IMODE(control.stat().st_mode) == 0o700
        assert stat.S_IMODE(address.stat().st_mode) == 0o600
        server.listen(1)
        descriptor = os.open(control, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            client.connect(f"/proc/self/fd/{descriptor}/lease")
            with server.accept()[0] as peer:
                assert not peer.get_inheritable()
                assert client.send(b"bound") == 5
                assert peer.recv(5) == b"bound"
                client.shutdown(socket.SHUT_RDWR)
                assert peer.recv(1) == b""
        finally:
            os.close(descriptor)


def test_stale_numeric_owner_binding_sends_zero_signals(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = Configuration(producer=tmp_path, directory=tmp_path, name="ie-lifetime-" + "a" * 32)
    binding = OwnerBinding(
        host_owner=Observation(
            pid=os.getpid() + 1,
            uid=61002,
            gid=61002,
            groups=(61002,),
            status={},
            namespaces={},
            cgroup="controlled-stale-binding",
            apparmor="docker-default (enforce)",
        ),
        host_owner_start_ticks="0",
        executable_identity=(0, 0),
        command=("original-node",),
    )
    _ = (tmp_path / "print-owner-binding.json").write_text(binding.model_dump_json())
    signals: list[tuple[int, int]] = []

    def record_signal(descriptor: int, number: int) -> None:
        signals.append((descriptor, number))

    monkeypatch.setattr("component_tests.guarded_active.send_pidfd_signal", record_signal)
    with os.fdopen(open_pidfd(os.getpid()), "rb", buffering=0) as handle:
        assert not select.select([handle], [], [], 0)[0]
        with pytest.raises(AssertionError):
            stop_active(
                Docker(config, monotonic() + 3),
                "controlled-full-id",
                "test",
                tmp_path,
                handle.fileno(),
            )
    assert signals == []
    _ = (tmp_path / "rejected-stale-identity.json").write_text(json.dumps({"signals": signals}))


def test_observer_reads_pending_state_and_schema_from_original_wal_siblings(tmp_path: Path) -> None:
    database = tmp_path / "state.sqlite"
    with closing(sqlite3.connect(database)) as connection:
        with closing(connection.execute("PRAGMA journal_mode=WAL")) as cursor:
            assert cursor.fetchone() == ("wal",)
        _ = connection.executescript(
            """CREATE TABLE attempts(id TEXT,operation TEXT,started INTEGER,outcome TEXT);
               CREATE TABLE operations(id TEXT,key TEXT);
               CREATE TABLE observations(attempt TEXT,kind TEXT);"""
        )
        key = hashlib.sha256(b'["composeArtifact","original-key"]').hexdigest()
        _ = connection.execute("INSERT INTO operations VALUES (?,?)", ("operation", key))
        _ = connection.execute(
            "INSERT INTO attempts VALUES (?,?,?,?)", ("attempt", "operation", 123, None)
        )
        _ = connection.execute(
            "INSERT INTO observations VALUES (?,?)", ("attempt", "execution_started")
        )
        connection.commit()
        _ = (tmp_path / "mapping.json").write_text(
            '{"canonical_request":{"idempotency_key":"original-key"}}'
        )
        # Keep writer connection open: all schema/rows remain in the original WAL.
        result = subprocess.run(  # noqa: S603 - fixed interpreter and readonly observer module
            (
                sys.executable,
                "-B",
                "-m",
                "component_tests.guarded_compose_probe",
                str(database),
                str(monotonic() + 3),
            ),
            check=True,
            capture_output=True,
            timeout=3,
        )
        observed = TypeAdapter(dict[str, JsonValue]).validate_json(result.stdout)
        assert observed["pending"] is True
        assert observed["operation_name"] == "composeArtifact"
        assert observed["execution_started_events"] == 1
        assert observed["database_inode"] == database.stat().st_ino
        assert observed["wal_inode"] == Path(str(database) + "-wal").stat().st_ino
        assert observed["shm_inode"] == Path(str(database) + "-shm").stat().st_ino


@pytest.mark.parametrize("suffix", ["-wal", "-shm"])
@pytest.mark.parametrize("replacement", ["symlink", "fifo"])
def test_observer_refuses_owner_sidecar_replacement_before_sqlite_reads(
    tmp_path: Path, suffix: str, replacement: str
) -> None:
    database = tmp_path / "state.sqlite"
    outside = tmp_path / "private-marker"
    _ = outside.write_bytes(b"PRIVATE_TEST_MARKER")
    with closing(sqlite3.connect(database)) as connection:
        with closing(connection.execute("PRAGMA journal_mode=WAL")) as cursor:
            assert cursor.fetchone() == ("wal",)
        _ = connection.execute("CREATE TABLE original(value TEXT)")
        connection.commit()
        sidecar = Path(str(database) + suffix)
        assert stat.S_ISREG(sidecar.stat().st_mode)
        backup = sidecar.with_name(sidecar.name + ".original")
        _ = sidecar.rename(backup)
        if replacement == "symlink":
            sidecar.symlink_to(outside)
        else:
            os.mkfifo(sidecar)
        try:
            result = subprocess.run(  # noqa: S603 - fixed interpreter/readonly module, owned fixture
                (
                    sys.executable,
                    "-B",
                    "-m",
                    "component_tests.guarded_compose_probe",
                    str(database),
                    str(monotonic() + 3),
                    "original-key",
                ),
                check=False,
                capture_output=True,
                timeout=3,
            )
            assert result.returncode != 0
            assert result.stdout == b""
        finally:
            sidecar.unlink()
            _ = backup.rename(sidecar)
    assert outside.read_bytes() == b"PRIVATE_TEST_MARKER"
