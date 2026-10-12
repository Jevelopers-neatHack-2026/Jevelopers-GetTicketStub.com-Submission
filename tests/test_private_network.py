import os
import socket
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Protocol

import pytest

from integration_evals.errors import InvalidArtifactError
from integration_evals.process_network import OfflineNetwork
from integration_evals.processes import ProcessSettings, invoke


class _Ipv4Socket(Protocol):
    def getsockname(self) -> tuple[str, int]: ...


def ipv4_address(server: _Ipv4Socket) -> tuple[str, int]:
    return server.getsockname()


def run_private(root: Path, program: str, *arguments: str) -> tuple[int, str]:
    output = root / "stdout"
    with output.open("w+b") as stream:
        status = invoke(
            (sys.executable, "-c", program, *arguments),
            ProcessSettings(
                root,
                os.environ,
                b"",
                stream,
                5,
                offline=True,
                writable_directory=root,
                network=OfflineNetwork.RETRIEVAL,
            ),
        )
    return status, output.read_text()


@pytest.mark.parametrize("offline", [False, True])
def test_private_network_requires_linux_offline_boundary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, offline: bool
) -> None:
    # Given either an online call or a platform without the required network namespace.
    if offline:
        monkeypatch.setattr(sys, "platform", "darwin")
    settings = ProcessSettings(
        tmp_path,
        os.environ,
        b"",
        -3,
        5,
        offline=offline,
        writable_directory=tmp_path,
        network=OfflineNetwork.RETRIEVAL,
    )
    # When the explicit private capability is submitted to the real invocation boundary.
    with pytest.raises(InvalidArtifactError, match="private_network_namespace_unavailable"):
        _ = invoke((sys.executable, "-c", "raise RuntimeError('must not launch')"), settings)
    # Then no unsupported platform or online fallback starts a payload.


@pytest.mark.skipif(sys.platform != "linux", reason="requires real Linux private network namespace")
@pytest.mark.parametrize("family", [socket.AF_INET, socket.AF_INET6])
def test_private_network_allows_owned_tcp_and_udp(
    tmp_path: Path, family: socket.AddressFamily
) -> None:
    # Given a private network namespace and a task-owned fixture message.
    program = """import socket,sys
from pathlib import Path
family=int(sys.argv[1]); host='127.0.0.1' if family==socket.AF_INET else '::1'
print('runtime-started',flush=True)
with socket.socket(family) as server, socket.socket(family) as client:
 server.bind((host,0)); server.listen(); client.connect(server.getsockname())
 connection=server.accept()[0]
 with connection:
  client.sendall(b'owned-tcp'); assert connection.recv(9)==b'owned-tcp'
with (socket.socket(family,socket.SOCK_DGRAM) as server,
      socket.socket(family,socket.SOCK_DGRAM) as client):
 server.bind((host,0)); client.sendto(b'owned-udp',server.getsockname())
 assert server.recvfrom(9)[0]==b'owned-udp'
assert str(Path('/proc/self/ns/net').readlink()) != sys.argv[2]
print('owned-tcp-udp-passed')
"""
    # When real sockets exchange data wholly inside the namespace.
    status, output = run_private(
        tmp_path, program, str(int(family)), str(Path("/proc/self/ns/net").readlink())
    )
    # Then the explicit capability supports useful transport in a distinct network namespace.
    assert status == 0
    assert output == "runtime-started\nowned-tcp-udp-passed\n"


@pytest.mark.skipif(sys.platform != "linux", reason="requires real Linux network separation")
def test_private_network_cannot_reach_host_loopback(tmp_path: Path) -> None:
    # Given an actually reachable harmless host TCP listener.
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        with socket.create_connection(ipv4_address(server), timeout=2) as control:
            connection = server.accept()[0]
            with connection:
                control.sendall(b"host-control")
                assert connection.recv(12) == b"host-control"
        program = """import socket,sys,errno
print('runtime-started',flush=True)
try:
 with socket.create_connection(('127.0.0.1',int(sys.argv[1])),timeout=1):
  raise RuntimeError('host listener reached')
except OSError as error:
 assert error.errno==errno.ECONNREFUSED
 print('host-loopback-unreachable')
"""
        # When the same address is dialed from the real isolated namespace.
        status, output = run_private(tmp_path, program, str(ipv4_address(server)[1]))
    # Then the host listener is unreachable despite private IP being usable.
    assert status == 0
    assert output == "runtime-started\nhost-loopback-unreachable\n"


@pytest.mark.skipif(sys.platform != "linux", reason="requires real Linux family filter")
def test_private_network_still_denies_host_unix_socket() -> None:
    # Given a reachable host Unix socket in the directory that will be bind-mounted writable.
    with (
        TemporaryDirectory(prefix="ie-private-unix-") as directory,
        socket.socket(socket.AF_UNIX) as server,
    ):
        root = Path(directory)
        endpoint = root / "socket"
        server.bind(str(endpoint))
        server.listen()
        with socket.socket(socket.AF_UNIX) as control:
            control.connect(str(endpoint))
            connection = server.accept()[0]
            with connection:
                control.sendall(b"host-control")
                assert connection.recv(12) == b"host-control"
        program = """import socket,errno
print('runtime-started',flush=True)
try:
 with socket.socket(socket.AF_UNIX):
  raise RuntimeError('Unix family admitted')
except OSError as error:
 assert error.errno==errno.EPERM
 print('host-unix-denied')
"""
        # When private-IP fixture code attempts to obtain a Unix socket.
        status, output = run_private(root, program)
    # Then network-namespace access does not grant a host Unix socket channel.
    assert status == 0
    assert output == "runtime-started\nhost-unix-denied\n"


@pytest.mark.skipif(sys.platform != "linux", reason="requires real Linux syscall filtering")
@pytest.mark.parametrize(
    "operation",
    ["socketpair", "netlink", "packet", "io_uring_setup", "io_uring_enter", "io_uring_register"],
)
def test_private_network_rejects_other_ipc_paths(tmp_path: Path, operation: str) -> None:
    # Given the private-IP capability and native syscall dispatch, bypassing high-level adapters.
    program = """import ctypes,socket,sys,errno
resolve=ctypes.CDLL('libseccomp.so.2').seccomp_syscall_resolve_name
resolve.argtypes=[ctypes.c_char_p]; resolve.restype=ctypes.c_int
operation=sys.argv[1]
arguments=(0,0,0,0,0,0)
if operation in ('netlink','packet'):
 family=socket.AF_NETLINK if operation=='netlink' else socket.AF_PACKET
 arguments=(family,socket.SOCK_DGRAM,0,0,0,0)
 operation='socket'
number=resolve(operation.encode()); assert number != -1
libc=ctypes.CDLL(None,use_errno=True)
print('runtime-started',flush=True)
assert libc.syscall(number,*arguments)==-1 and ctypes.get_errno()==errno.EPERM
print('permission-denied')
"""
    # When unsupported families, socketpair or io_uring are invoked directly.
    status, output = run_private(tmp_path, program, operation)
    # Then the native filter rejects every alternate path explicitly.
    assert status == 0
    assert output == "runtime-started\npermission-denied\n"


@pytest.mark.skipif(sys.platform != "linux", reason="requires real Linux private IP execution")
def test_private_network_does_not_inherit_host_socket(tmp_path: Path) -> None:
    # Given a live inheritable host socket with a harmless readable byte queued.
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        with socket.create_connection(ipv4_address(server), timeout=2) as client:
            connection = server.accept()[0]
            with connection:
                os.set_inheritable(connection.fileno(), True)  # noqa: FBT003 - positional-only flag
                client.sendall(b"x")
                program = """import os,sys,errno
print('runtime-started',flush=True)
try:
 os.read(int(sys.argv[1]),1)
except OSError as error:
 assert error.errno==errno.EBADF
 print('descriptor-closed')
else:
 raise RuntimeError('host socket inherited')
"""
                # When a private fixture child is launched from the owning parent.
                status, output = run_private(tmp_path, program, str(connection.fileno()))
    # Then the host channel is closed despite the explicit IP capability.
    assert status == 0
    assert output == "runtime-started\ndescriptor-closed\n"


@pytest.mark.skipif(sys.platform != "linux", reason="requires real Linux default socket filter")
@pytest.mark.parametrize("family", [socket.AF_INET, socket.AF_INET6])
def test_default_offline_policy_rejects_ip_despite_ambient_optin(
    tmp_path: Path, family: socket.AddressFamily, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Given an untrusted environment value and no trusted invocation capability.
    monkeypatch.setenv("IE_NETWORK", "retrieval-private-ip")
    output = tmp_path / "stdout"
    program = """import socket,sys,errno
print('runtime-started',flush=True)
try:
 with socket.socket(int(sys.argv[1])):
  raise RuntimeError('generic offline socket admitted')
except OSError as error:
 assert error.errno==errno.EPERM
 print('default-socket-denied')
"""
    # When a generic offline command attempts native IP socket creation.
    with output.open("w+b") as stream:
        status = invoke(
            (sys.executable, "-c", program, str(int(family))),
            ProcessSettings(
                tmp_path, os.environ, b"", stream, 5, offline=True, writable_directory=tmp_path
            ),
        )
    # Then an environment string cannot select the evaluator-only capability.
    assert status == 0
    assert output.read_text() == "runtime-started\ndefault-socket-denied\n"


@pytest.mark.skipif(sys.platform != "linux", reason="requires real Linux private-IP boundary")
def test_private_network_keeps_unmounted_root_readonly(tmp_path: Path) -> None:
    # Given a harmless host sentinel outside the private fixture's writable mount.
    owned = tmp_path / "owned"
    owned.mkdir()
    sentinel = tmp_path / "outside"
    _ = sentinel.write_text("immutable")
    program = """import errno,sys
from pathlib import Path
print('runtime-started',flush=True)
Path('allowed').write_text('task-output')
try:
 Path(sys.argv[1]).write_text('changed')
except OSError as error:
 assert error.errno==errno.EROFS
 print('root-readonly')
else:
 raise RuntimeError('private policy made namespace root writable')
"""
    # When private-IP authority is used for the same filesystem write attempt.
    status, output = run_private(owned, program, str(sentinel))
    # Then private transport does not change the independent filesystem policy.
    assert status == 0
    assert output == "runtime-started\nroot-readonly\n"
    assert (owned / "allowed").read_text() == "task-output"
    assert sentinel.read_text() == "immutable"
