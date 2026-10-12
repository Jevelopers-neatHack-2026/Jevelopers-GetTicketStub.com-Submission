import errno
import json
import os
import socket
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from integration_evals.errors import InvalidArtifactError
from integration_evals.processes import ProcessSettings, invoke


@pytest.mark.parametrize("operation", ["read_text", "stat"])
@pytest.mark.parametrize(
    "route",
    ["absolute", "traversal", "checkout-symlink", "write-symlink", "other-case", "fake-home"],
)
def test_offline_command_cannot_read_outside_owned_roots(
    tmp_path: Path, route: str, operation: str
) -> None:
    # Given a harmless file outside the declared checkout and task write directory.
    checkout, writable = tmp_path / "checkout", tmp_path / "write"
    checkout.mkdir()
    writable.mkdir()
    sentinel = tmp_path / "outside-sentinel"
    if route == "other-case":
        sentinel = tmp_path / "other-case/retained/run.json"
    if route == "fake-home":
        sentinel = tmp_path / "fake-home/.ssh/task-owned-sentinel"
    sentinel.parent.mkdir(parents=True, exist_ok=True)
    _ = sentinel.write_text("harmless-outside-marker")
    target = sentinel
    if route == "traversal":
        target = checkout / ".." / sentinel.name
    if route.endswith("symlink"):
        target = (checkout if route == "checkout-symlink" else writable) / "link"
        target.symlink_to(sentinel)
    program = (
        "import pathlib,sys; "
        "print('runtime-started',flush=True); "
        f"print(pathlib.Path(sys.argv[1]).{operation}(),flush=True)"
    )
    output = tmp_path / "stdout"
    # When the real offline child attempts to read it.
    with output.open("w+b") as stream:
        result = invoke(
            (sys.executable, "-c", program, str(target)),
            ProcessSettings(
                checkout, os.environ, b"", stream, 5, offline=True, writable_directory=writable
            ),
        )
    # Then the runtime starts but the outside content cannot cross the boundary.
    assert output.read_text() == "runtime-started\n"
    assert result != 0


@pytest.mark.parametrize("name", ["checkout", 'quote" and back\\slash'])
def test_offline_command_reads_checkout_and_writes_task_output(tmp_path: Path, name: str) -> None:
    # Given a task-owned checkout input and isolated output directory.
    checkout, writable = tmp_path / name, tmp_path / "write"
    checkout.mkdir()
    writable.mkdir()
    _ = (checkout / "input").write_text("owned-input")
    program = (
        "from pathlib import Path; import sys; "
        "data=Path('input').read_text(); "
        "Path(sys.argv[1]).write_text(data); print(data)"
    )
    output = tmp_path / "stdout"
    # When the real contained interpreter reads and writes its declared resources.
    with output.open("w+b") as stream:
        result = invoke(
            (sys.executable, "-c", program, str(writable / "result")),
            ProcessSettings(
                checkout, os.environ, b"", stream, 5, offline=True, writable_directory=writable
            ),
        )
    # Then useful execution succeeds and fresh bytes are available.
    assert result == 0
    assert output.read_text() == "owned-input\n"
    assert (writable / "result").read_text() == "owned-input"


@pytest.mark.parametrize("location", ["checkout", "outside", "symlink"])
def test_offline_command_cannot_write_outside_task_directory(tmp_path: Path, location: str) -> None:
    # Given an immutable input and a distinct task write directory.
    checkout, writable = tmp_path / "checkout", tmp_path / "write"
    checkout.mkdir()
    writable.mkdir()
    target = (checkout if location == "checkout" else tmp_path) / "input"
    _ = target.write_text("immutable-input")
    addressed = target
    if location == "symlink":
        addressed = writable / "link"
        addressed.symlink_to(target)
    host_exists_before = target.is_file()
    host_bytes_before = addressed.read_text()
    assert host_exists_before
    assert host_bytes_before == "immutable-input"
    output = tmp_path / "stdout"
    program = """import errno,pathlib,sys
print('runtime-started',flush=True)
print('write-attempted',flush=True)
try:
 pathlib.Path(sys.argv[1]).write_text('bad')
except OSError as error:
 print(f'write-denied:{error.errno}',flush=True)
 if error.errno not in (errno.EPERM,errno.EACCES,errno.EROFS):
  raise
else:
 print('write-succeeded',flush=True)
 raise RuntimeError('outside write unexpectedly succeeded')
"""
    # When the actual contained runtime attempts to overwrite the input.
    with output.open("w+b") as stream:
        result = invoke(
            (
                sys.executable,
                "-c",
                program,
                str(addressed),
            ),
            ProcessSettings(
                checkout, os.environ, b"", stream, 5, offline=True, writable_directory=writable
            ),
        )
    # Then retain the actual syscall outcome and host integrity before checking the denial oracle.
    stdout = output.read_text()
    host_exists_after = target.is_file()
    host_bytes_after = target.read_text() if host_exists_after else "<missing>"
    observation = {
        "location": location,
        "exit_code": result,
        "stdout": stdout,
        "host_exists_before": host_exists_before,
        "host_bytes_before": host_bytes_before,
        "host_exists_after": host_exists_after,
        "host_bytes_after": host_bytes_after,
    }
    captured = json.dumps(observation, indent=2)
    _ = (tmp_path / "write-observation.json").write_text(captured)
    evidence = os.environ.get("IE_PROCESS_EVIDENCE")
    if evidence is not None:
        destination = Path(evidence)
        destination.mkdir(parents=True, exist_ok=True)
        _ = (destination / f"{tmp_path.name}.json").write_text(captured)
    lines = stdout.splitlines()
    assert host_exists_after, observation
    assert host_bytes_after == "immutable-input", observation
    assert lines[:2] == ["runtime-started", "write-attempted"], observation
    assert len(lines) == 3, observation
    assert lines[2] in {
        f"write-denied:{code}" for code in (errno.EPERM, errno.EACCES, errno.EROFS)
    }, observation
    assert result == 0, observation


@pytest.mark.parametrize("root", [Path("/"), Path.home(), Path.home().parent])
def test_offline_command_rejects_broad_checkout_roots(tmp_path: Path, root: Path) -> None:
    # Given a broad host root instead of a dedicated owned checkout.
    settings = ProcessSettings(
        root, os.environ, b"", -3, 5, offline=True, writable_directory=tmp_path
    )
    # When constructing the actual command boundary.
    with pytest.raises(InvalidArtifactError, match="offline_directory_too_broad"):
        _ = invoke((sys.executable, "-c", "pass"), settings)
    # Then dispatch is rejected before any child can read host content.


@pytest.mark.parametrize("alias", ["root", "parent", "traversal"])
def test_offline_command_rejects_aliased_write_roots(tmp_path: Path, alias: str) -> None:
    # Given a caller that addresses the task directory through an untrusted alias.
    checkout, writable = tmp_path / "checkout", tmp_path / "write"
    checkout.mkdir()
    writable.mkdir()
    link = tmp_path / "link"
    link.symlink_to(writable, target_is_directory=True)
    addressed = link
    if alias == "parent":
        (writable / "child").mkdir()
        addressed = link / "child"
    if alias == "traversal":
        addressed = checkout / ".." / "write"
    settings = ProcessSettings(
        checkout, os.environ, b"", -3, 5, offline=True, writable_directory=addressed
    )
    # When dispatch validates ownership boundaries.
    with pytest.raises(InvalidArtifactError, match="offline_path_alias_rejected"):
        _ = invoke((sys.executable, "-c", "pass"), settings)
    # Then no aliased write capability is granted.


def test_offline_command_cannot_connect_to_host_socket(tmp_path: Path) -> None:
    # Given a harmless task-owned Unix socket inside the otherwise writable directory.
    output = tmp_path / "stdout"
    program = """import socket,sys,errno
print('runtime-started',flush=True)
try:
 with socket.socket(socket.AF_UNIX) as client:
  client.connect(sys.argv[1])
except OSError as error:
 if error.errno not in (errno.EPERM,errno.EACCES):
  raise
 print('network-denied')
else:
 print('connected')
"""
    with (
        TemporaryDirectory(prefix="ie-sock-") as directory,
        socket.socket(socket.AF_UNIX) as listener,
        output.open("w+b") as stream,
    ):
        root = Path(directory)
        endpoint = root / "socket"
        listener.bind(str(endpoint))
        listener.listen()
        with socket.socket(socket.AF_UNIX) as control:
            control.connect(str(endpoint))
            connection = listener.accept()[0]
            with connection:
                _ = control.send(b"reachable")
                assert connection.recv(9) == b"reachable"
        # When the actual offline runtime attempts to reach that host socket.
        result = invoke(
            (sys.executable, "-c", program, str(endpoint)),
            ProcessSettings(
                root, os.environ, b"", stream, 5, offline=True, writable_directory=root
            ),
        )
    # Then filesystem read grants have not opened a network/socket escape.
    assert result == 0
    assert output.read_text() == "runtime-started\nnetwork-denied\n"


def test_offline_child_does_not_inherit_unrelated_open_file(tmp_path: Path) -> None:
    # Given an explicitly inheritable descriptor for a harmless outside sentinel.
    checkout, writable = tmp_path / "checkout", tmp_path / "write"
    checkout.mkdir()
    writable.mkdir()
    sentinel = tmp_path / "outside"
    _ = sentinel.write_text("outside-fd-content")
    output = tmp_path / "stdout"
    program = """import os,sys,errno
print('runtime-started',flush=True)
try:
 print(os.read(int(sys.argv[1]),100))
except OSError as error:
 assert error.errno == errno.EBADF
 print('descriptor-closed')
"""
    with sentinel.open("rb") as outside, output.open("w+b") as stream:
        os.set_inheritable(outside.fileno(), True)  # noqa: FBT003 - positional-only stdlib flag
        # When the evaluator starts the offline child with only its owned channels.
        result = invoke(
            (sys.executable, "-c", program, str(outside.fileno())),
            ProcessSettings(
                checkout, os.environ, b"", stream, 5, offline=True, writable_directory=writable
            ),
        )
    # Then the unrelated descriptor cannot bypass the path read policy.
    assert result == 0
    assert output.read_text() == "runtime-started\ndescriptor-closed\n"


@pytest.mark.parametrize("location", ["checkout", "outside", "symlink"])
def test_write_denial_oracle_rejects_failure_before_payload(
    tmp_path: Path, location: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Given a real contained process that exits before running the intended write payload.
    original_invoke = invoke

    def fail_before_payload(_command: tuple[str, ...], settings: ProcessSettings) -> int:
        return original_invoke((sys.executable, "-c", "raise SystemExit(71)"), settings)

    monkeypatch.setattr(sys.modules[__name__], "invoke", fail_before_payload)
    # When the same outside-write oracle evaluates that failed launch.
    with pytest.raises(AssertionError, match="runtime-started"):
        test_offline_command_cannot_write_outside_task_directory(tmp_path, location)
    # Then startup failure cannot masquerade as a permission-enforcement pass.
