import json
import socket
import stat
import struct
from collections.abc import Generator
from contextlib import contextmanager
from time import monotonic

from component_tests.container_binding import bind_guard
from component_tests.container_docker import Docker
from component_tests.container_records import GuardConnection, GuardReceipt


@contextmanager
def armed_lease(
    docker: Docker, server: socket.socket, identity: str
) -> Generator[tuple[socket.socket, GuardReceipt]]:
    server.settimeout(max(0.001, docker.deadline - monotonic()))
    with server.accept()[0] as lease:
        lease.settimeout(max(0.001, docker.deadline - monotonic()))
        peer, uid, gid = struct.unpack("3i", lease.getsockopt(socket.SOL_SOCKET, 17, 12))
        assert (uid, gid) == (docker.configuration.guard.uid, docker.configuration.guard.gid)
        with lease.makefile("rb") as stream:
            raw = stream.readline(65537)
        assert len(raw) <= 65536
        assert raw.endswith(b"\n")
        receipt = GuardReceipt.model_validate_json(raw)
        bind_guard(docker, identity, GuardConnection(peer_pid=peer, receipt=receipt))
        modes: dict[str, tuple[int, int, int]] = {}
        for name in ("control", "control/lease", "owner"):
            observed = (docker.configuration.directory / name).stat()
            role = docker.configuration.owner if name == "owner" else docker.configuration.guard
            expected = 0o600 if name == "control/lease" else 0o700
            assert (observed.st_uid, observed.st_gid) == (role.uid, role.gid)
            assert stat.S_IMODE(observed.st_mode) == expected
            modes[name] = (observed.st_uid, observed.st_gid, stat.S_IMODE(observed.st_mode))
        _ = (docker.configuration.directory / "mount-permissions.json").write_text(
            json.dumps(modes)
        )
        assert not server.get_inheritable()
        assert not lease.get_inheritable()
        yield lease, receipt
