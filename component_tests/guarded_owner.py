"""Fixed owner supervisor: exact env/argv and a pre-request real Node PID receipt."""

import errno
import hashlib
import json
import os
import signal
import socket
import subprocess
import sys
from pathlib import Path
from typing import TypedDict, cast

from component_tests.container_canary import tamper
from component_tests.container_facts import facts


class Launch(TypedDict):
    guard: int
    lease_fd: int
    command: list[str]
    environment: dict[str, str]
    checkout: str
    host_probe: str
    request_sha256: str


def detached(denied: dict[str, int]) -> None:
    """Keep a hostile closed-stdio sibling alive alongside the actual original owner."""
    reader, writer = os.pipe()
    first = os.fork()
    if first:
        os.close(writer)
        with os.fdopen(reader, "rb") as completed:
            assert completed.read(1) == b"1"
        _ = os.waitpid(first, 0)
        return
    os.close(reader)
    _ = os.setsid()
    if os.fork():
        os._exit(0)
    _ = Path("/owner/detached-owner.json").write_text(
        json.dumps({"owner": facts(), "tamper": denied})
    )
    for descriptor in (0, 1, 2):
        os.close(descriptor)
    with os.fdopen(writer, "wb") as completed:
        _ = completed.write(b"1")
    while True:
        signal.pause()


def main() -> None:
    launch = cast("Launch", json.loads(Path("/run/ie-launch/launch.json").read_text()))
    denied = tamper(launch["guard"], launch["lease_fd"])
    host = Path(launch["host_probe"])
    try:
        with host.open("rb"):
            pass
    except FileNotFoundError:
        host_denied = True
    else:
        host_denied = False
    assert host_denied, "Host-only marker was exposed"
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as channel:
        channel.settimeout(1)
        try:
            channel.connect(("198.51.100.1", 443))
        except OSError as error:
            network_denied = error.errno
        else:
            network_denied = 0
    assert network_denied in (errno.ENETUNREACH, errno.EHOSTUNREACH)
    detached(denied)
    with subprocess.Popen(  # noqa: S603 - exact readonly manifest argv/environment
        launch["command"], cwd=launch["checkout"], env=launch["environment"], stdin=subprocess.PIPE
    ) as owner:
        receipt = {
            "owner": facts(owner.pid),
            "tamper": denied,
            "host_read_denied": host_denied,
            "network_errno": network_denied,
        }
        _ = Path("/owner/owner-start.json").write_text(json.dumps(receipt))
        payload = sys.stdin.buffer.read(65537)
        assert len(payload) <= 65536
        assert hashlib.sha256(payload).hexdigest() == launch["request_sha256"]
        _ = Path("/owner/request-binding.json").write_text(
            json.dumps({"sha256": launch["request_sha256"], "bytes": len(payload)})
        )
        _ = owner.communicate(input=payload, timeout=30)
        sys.exit(owner.returncode)


if __name__ == "__main__":
    main()
