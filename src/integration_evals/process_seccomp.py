"""Deny host socket and io_uring escape paths in offline Linux children."""

import ctypes
import errno
import sys
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass
from tempfile import TemporaryFile
from typing import Final

from integration_evals.errors import fail

ALLOW: Final = 0x7FFF0000
DENY: Final = 0x00050000 | errno.EPERM
SOCKET_CALLS: Final = (
    "socket",
    "socketpair",
    "connect",
    "bind",
    "listen",
    "accept",
    "accept4",
    "sendto",
    "sendmsg",
    "sendmmsg",
    "recvfrom",
    "recvmsg",
    "recvmmsg",
    "shutdown",
    "getsockname",
    "getpeername",
    "setsockopt",
    "getsockopt",
    "io_uring_setup",
    "io_uring_enter",
    "io_uring_register",
)


@dataclass(frozen=True, slots=True)
class _Seccomp:
    initialize: Callable[[int], int | None]
    resolve: Callable[[bytes], int]
    add: Callable[[int, int, int, int, None], int]
    export: Callable[[int, int], int]
    release: Callable[[int], None]


def export_filter(descriptor: int) -> None:
    """Use libseccomp's native ABI resolution and bad-architecture rejection."""
    try:
        library = ctypes.CDLL("libseccomp.so.2")
        functions = _Seccomp(
            ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_uint)(("seccomp_init", library)),
            ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_char_p)(
                ("seccomp_syscall_resolve_name", library)
            ),
            ctypes.CFUNCTYPE(
                ctypes.c_int,
                ctypes.c_void_p,
                ctypes.c_uint,
                ctypes.c_int,
                ctypes.c_uint,
                ctypes.c_void_p,
            )(("seccomp_rule_add_array", library)),
            ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_int)(
                ("seccomp_export_bpf", library)
            ),
            ctypes.CFUNCTYPE(None, ctypes.c_void_p)(("seccomp_release", library)),
        )
    except (OSError, AttributeError):
        return fail("offline_seccomp_unavailable", "owner-command")
    context = functions.initialize(ALLOW)
    if context is None:
        fail("offline_seccomp_initialize_failed", "owner-command")
    try:
        for name in SOCKET_CALLS:
            syscall = functions.resolve(name.encode("ascii"))
            if syscall == -1 or functions.add(context, DENY, syscall, 0, None) != 0:
                fail("offline_seccomp_rule_failed", "owner-command")
        if functions.export(context, descriptor) != 0:
            fail("offline_seccomp_export_failed", "owner-command")
    finally:
        functions.release(context)


@contextmanager
def network_filter(*, offline: bool) -> Generator[int | None]:
    """Keep the unlinked BPF descriptor alive only while its bubblewrap owner runs."""
    if not offline or sys.platform != "linux":
        yield None
        return
    with TemporaryFile() as program:
        export_filter(program.fileno())
        _ = program.seek(0)
        yield program.fileno()
