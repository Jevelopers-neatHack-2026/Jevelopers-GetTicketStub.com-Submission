"""Portable denial tests for the guarded invocation's pre-dispatch boundaries."""

import os
import signal
import socket
import subprocess
import sys
from pathlib import Path
from time import monotonic

import pytest

from component_tests.container_docker import Docker
from component_tests.container_records import Configuration, Observation
from component_tests.guarded_active import step_owner, stop_active, stopped_owner
from component_tests.guarded_git import CONFIG, git_command, minimal_git, verify_git_projection
from component_tests.guarded_identity import OwnerBinding
from component_tests.guarded_print import (
    LIMIT,
    GuardedPrint,
    bounded_response,
    owner_record,
    real_directory,
    verify_tree,
)
from component_tests.test_retrieval import commit, git
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import Settings
from integration_evals.processes import ProcessSettings
from integration_evals.validation import git_value


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


def test_minimal_git_omits_credential_metadata_and_preserves_identity(tmp_path: Path) -> None:
    _ = (tmp_path / "tracked").write_text("unrelated-history")
    commit(tmp_path)
    historical = git_value(tmp_path, "rev-parse", "HEAD")
    _ = (tmp_path / "tracked").write_text("authorized-source")
    commit(tmp_path)
    revision = git_value(tmp_path, "rev-parse", "HEAD")
    tree = git_value(tmp_path, "rev-parse", "HEAD^{tree}")
    git(
        tmp_path,
        (
            "config",
            "--local",
            "remote.origin.url",
            "https://fictional:credential@example.invalid/repo",
        ),
    )
    git(
        tmp_path,
        ("config", "--local", "http.https://example.invalid/.extraheader", "SYNTHETIC_AUTH_MARKER"),
    )
    minimal_git(tmp_path)
    assert git_value(tmp_path, "rev-parse", "HEAD") == revision
    assert git_value(tmp_path, "rev-parse", "HEAD^{tree}") == tree
    assert git_value(tmp_path, "status", "--porcelain") == ""
    assert git_value(tmp_path, "ls-files") == "tracked"
    assert (
        historical.encode()
        not in git_command(
            tmp_path, ("cat-file", "--batch-all-objects", "--batch-check=%(objectname)")
        ).splitlines()
    )
    assert (tmp_path / ".git/config").read_bytes() == CONFIG
    assert not {"logs", "hooks", "FETCH_HEAD", "ORIG_HEAD"}.intersection(
        path.name for path in (tmp_path / ".git").iterdir()
    )
    # A fake credential URL in the actual mounted projection is refused, not merely renamed.
    git(
        tmp_path,
        (
            "config",
            "--local",
            "remote.origin.url",
            "https://fictional:credential@example.invalid/repo",
        ),
    )
    with pytest.raises(InvalidArtifactError, match="unexpected_git_configuration") as rejected:
        verify_git_projection(tmp_path, monotonic() + 1)
    assert "fictional" not in str(rejected.value)
    assert "credential" not in str(rejected.value)


@pytest.mark.parametrize("replacement", ["symlink-directory", "hardlink", "metadata", "object"])
def test_git_projection_rejects_metadata_and_object_expansion(
    tmp_path: Path, replacement: str
) -> None:
    _ = (tmp_path / "tracked").write_text("source")
    commit(tmp_path)
    minimal_git(tmp_path)
    metadata = tmp_path / ".git"
    if replacement == "symlink-directory":
        refs = metadata / "refs"
        refs.rmdir()
        outside = tmp_path / "outside"
        outside.mkdir()
        refs.symlink_to(outside, target_is_directory=True)
    elif replacement == "hardlink":
        os.link(metadata / "HEAD", tmp_path / "alias")
    elif replacement == "metadata":
        _ = (metadata / "FETCH_HEAD").write_bytes(b"unapproved")
    else:
        _ = git_command(tmp_path, ("hash-object", "-w", "--stdin"), payload=b"unapproved-object")
    with pytest.raises(AssertionError):
        verify_git_projection(tmp_path, monotonic() + 1)


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


@pytest.mark.parametrize(
    "name", ["owner-start.json", "detached-owner.json", "request-binding.json"]
)
@pytest.mark.parametrize("replacement", ["fifo", "oversized", "symlink"])
def test_owner_receipt_replacements_fail_before_binding(
    tmp_path: Path, name: str, replacement: str
) -> None:
    (tmp_path / "owner").mkdir()
    path = tmp_path / "owner" / name
    if replacement == "fifo":
        os.mkfifo(path)
    elif replacement == "oversized":
        _ = path.write_bytes(b"x" * 65537)
    else:
        outside = tmp_path / "private-marker"
        _ = outside.write_text("PRIVATE_TEST_MARKER")
        path.symlink_to(outside)
    started = monotonic()
    with pytest.raises(InvalidArtifactError):
        _ = owner_record(tmp_path, name, started + 1)
    assert monotonic() - started < 1


def test_owner_receipt_expired_deadline_refuses_regular_input(tmp_path: Path) -> None:
    (tmp_path / "owner").mkdir()
    _ = (tmp_path / "owner/request-binding.json").write_bytes(b"{}")
    with pytest.raises(TimeoutError, match="Artifact read deadline expired"):
        _ = owner_record(tmp_path, "request-binding.json", monotonic() - 1)


def test_stalled_stdin_obeys_same_absolute_deadline() -> None:
    parent, child = socket.socketpair()
    with parent, child:
        parent.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
        with subprocess.Popen(
            (sys.executable, "-c", "import time; time.sleep(5)"),
            stdin=child.fileno(),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        ) as client:
            writer = parent.makefile("wb")
            client.stdin = writer
            started = monotonic()
            try:
                with pytest.raises(subprocess.TimeoutExpired):
                    _ = bounded_response(client, b"x" * 65536, started + 0.05)
                assert monotonic() - started < 0.5
            finally:
                client.kill()
                _ = client.wait(timeout=5)
                writer.close()
                client.stdin = None


def test_stale_held_owner_identity_is_rejected_before_any_signal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    binding = OwnerBinding(
        host_owner=Observation(
            pid=os.getpid(),
            uid=61002,
            gid=61002,
            groups=(61002,),
            status={},
            namespaces={},
            cgroup="controlled-binding",
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

    def stale_fdinfo(path: Path, *, max_bytes: int, deadline: float) -> bytes:
        assert path.parent == Path("/proc/self/fdinfo")
        assert max_bytes == 65536
        assert deadline > monotonic()
        return f"Pid:\t{os.getpid() + 1}\n".encode()

    monkeypatch.setattr("component_tests.guarded_identity.read_bytes", stale_fdinfo)
    monkeypatch.setattr("component_tests.guarded_active.send_pidfd_signal", record_signal)
    configuration = Configuration(
        producer=tmp_path, directory=tmp_path, name="ie-lifetime-" + "a" * 32
    )
    reader, writer = os.pipe()
    with (
        os.fdopen(reader, "rb", buffering=0) as handle,
        os.fdopen(writer, "wb", buffering=0),
        pytest.raises(AssertionError),
    ):
        stop_active(
            Docker(configuration, monotonic() + 3), "full-id", "test", tmp_path, handle.fileno()
        )
    assert signals == []


@pytest.mark.parametrize("exited", [False, True])
def test_stopped_identity_authorizes_only_same_handle_pulse_then_reauthentication(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, exited: bool
) -> None:
    owner = Observation(
        pid=1,
        uid=61002,
        gid=61002,
        groups=(61002,),
        status={"State": "T (stopped)"},
        namespaces={},
        cgroup="controlled-call-order",
        apparmor="docker-default (enforce)",
    )
    binding = OwnerBinding(
        host_owner=owner,
        host_owner_start_ticks="0",
        executable_identity=(0, 0),
        command=("original-node",),
    )
    docker = Docker(
        Configuration(producer=tmp_path, directory=tmp_path, name="ie-lifetime-" + "a" * 32),
        monotonic() + 1,
    )
    events: list[str] = []

    def authenticated(*_: object) -> Observation:
        events.append("authenticate")
        return owner

    def sent(descriptor: int, number: int) -> None:
        assert descriptor == 7
        events.append(signal.Signals(number).name)
        if exited and number == signal.SIGSTOP:
            raise ProcessLookupError

    def quantum(duration: float) -> None:
        assert 0 < duration <= 0.0005
        events.append("quantum")

    monkeypatch.setattr("component_tests.guarded_active.authenticate_owner", authenticated)
    monkeypatch.setattr("component_tests.guarded_active.send_pidfd_signal", sent)
    monkeypatch.setattr("component_tests.guarded_active.sleep", quantum)
    if exited:
        with pytest.raises(ProcessLookupError):
            _ = step_owner(docker, binding, 7)
        assert events == ["authenticate", "SIGCONT", "quantum", "SIGSTOP"]
    else:
        assert step_owner(docker, binding, 7) is owner
        assert events == ["authenticate", "SIGCONT", "quantum", "SIGSTOP", "authenticate"]


@pytest.mark.parametrize("persistent", [False, True])
def test_authenticated_disk_wait_requires_actual_stopped_state_before_deadline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, persistent: bool
) -> None:
    owner = Observation(
        pid=1,
        uid=61002,
        gid=61002,
        groups=(61002,),
        status={"State": "D (disk sleep)"},
        namespaces={},
        cgroup="controlled-disk-wait",
        apparmor="docker-default (enforce)",
    )
    binding = OwnerBinding(
        host_owner=owner,
        host_owner_start_ticks="0",
        executable_identity=(0, 0),
        command=("original-node",),
    )
    docker = Docker(
        Configuration(producer=tmp_path, directory=tmp_path, name="ie-lifetime-" + "a" * 32),
        2,
    )
    now = 1.0
    calls = 0

    def authenticated(*_: object) -> Observation:
        nonlocal calls
        calls += 1
        return (
            owner
            if calls == 1 or persistent
            else owner.model_copy(update={"status": {"State": "T (stopped)"}})
        )

    def tick(_duration: float) -> None:
        nonlocal now
        now = 3.0 if persistent else 1.5

    def no_sql(*_: object) -> bytes:
        pytest.fail("Stop-state waiting must not invoke Docker or SQLite")

    monkeypatch.setattr("component_tests.guarded_active.authenticate_owner", authenticated)
    monkeypatch.setattr("component_tests.guarded_active.sleep", tick)
    monkeypatch.setattr("component_tests.guarded_active.monotonic", lambda: now)
    monkeypatch.setattr(Docker, "run", no_sql)
    if persistent:
        with pytest.raises(subprocess.TimeoutExpired):
            _ = stopped_owner(docker, binding, 7)
    else:
        assert stopped_owner(docker, binding, 7).status["State"] == "T (stopped)"
    assert calls == 2
    # This wait helper cannot invoke Docker/SQLite or publish a checkpoint.
    assert not (tmp_path / "active-compose.json").exists()
