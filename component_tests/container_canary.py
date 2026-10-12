"""Hostile synthetic owner; never invokes the print acceptance protocol."""

import ctypes
import errno
import json
import os
import signal
import socket
import subprocess
import sys
from pathlib import Path

from component_tests.container_facts import facts


def tamper(guard: int, lease_fd: int) -> dict[str, int]:
    failures: dict[str, int] = {}
    for target in (1, guard):
        for sig in (signal.SIGSTOP, signal.SIGKILL, signal.SIGTERM):
            try:
                os.kill(target, sig)
            except PermissionError as error:
                failures[f"signal-{target}-{sig.value}"] = error.errno or 0
    library = ctypes.CDLL(None, use_errno=True)
    library.ptrace.restype = ctypes.c_long
    library.ptrace.argtypes = [ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_void_p]
    assert library.ptrace(16, guard, None, None) == -1
    failures["ptrace"] = ctypes.get_errno()
    for path in (f"/proc/{guard}/fd/{lease_fd}", "/run/ie-control/lease"):
        try:
            with Path(path).open("rb"):
                pass
        except PermissionError as error:
            failures[path] = error.errno or 0
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        try:
            connection.connect("/run/ie-control/lease")
        except PermissionError as error:
            failures["control-connect"] = error.errno or 0
    assert len(failures) == 10, failures
    assert all(code in (errno.EPERM, errno.EACCES) for code in failures.values())
    return failures


def main() -> None:
    guard, lease_fd = map(int, sys.argv[1:])
    denied = tamper(guard, lease_fd)
    node = "/producer/out/toolchain/node-v24.21.0-linux-x64/bin/node"
    observation_script = """
import {observeLinuxContainerSecurity} from '/producer/dist/src/runtime/environment.js';
console.log(JSON.stringify(await observeLinuxContainerSecurity()));
"""
    observed = subprocess.run(  # noqa: S603 - fixed pinned source observer, no owner input
        [
            node,
            "--input-type=module",
            "-e",
            observation_script,
        ],
        check=True,
        capture_output=True,
        timeout=5,
    )
    _ = Path("/owner/source-security.json").write_bytes(observed.stdout)
    reader, writer = os.pipe()
    if os.fork():
        os.close(writer)
        with os.fdopen(reader, "rb") as completed:
            assert completed.read(1) == b"1"
        return
    os.close(reader)
    os.setsid()
    if os.fork():
        os._exit(0)
    receipt = {"owner": facts(), "tamper": denied}
    _ = Path("/owner/owner.json").write_text(json.dumps(receipt))
    _ = sys.stdout.write(json.dumps(receipt) + "\n")
    _ = sys.stdout.flush()
    for descriptor in (0, 1, 2):
        os.close(descriptor)
    with os.fdopen(writer, "wb") as completed:
        _ = completed.write(b"1")
    while True:
        signal.pause()


if __name__ == "__main__":
    main()
