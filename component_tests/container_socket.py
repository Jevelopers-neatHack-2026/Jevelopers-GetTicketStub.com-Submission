"""Short descriptor-relative addressing for the same protected filesystem lease."""

import os
import socket
import stat
from pathlib import Path
from time import monotonic

from component_tests.container_records import Configuration


def bind_lease(server: socket.socket, control: Path) -> Path:
    assert control.resolve(strict=True) == control
    descriptor = os.open(control, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        observed = os.fstat(descriptor)
        assert stat.S_ISDIR(observed.st_mode)
        assert stat.S_IMODE(observed.st_mode) == 0o700
        assert not os.get_inheritable(descriptor)
        # AF_UNIX resolves this short pathname to the same pinned filesystem inode.
        # Guard still connects through its exact readonly /run/ie-control mount.
        server.bind(f"/proc/self/fd/{descriptor}/lease")
        address = control / "lease"
        assert stat.S_ISSOCK(address.lstat().st_mode)
        return address
    finally:
        os.close(descriptor)


def listen_lease(server: socket.socket, configuration: Configuration, deadline: float) -> None:
    address = bind_lease(server, configuration.directory / "control")
    os.chown(address, configuration.guard.uid, configuration.guard.gid)
    address.chmod(0o600)
    server.listen(1)
    server.settimeout(max(0.001, deadline - monotonic()))
