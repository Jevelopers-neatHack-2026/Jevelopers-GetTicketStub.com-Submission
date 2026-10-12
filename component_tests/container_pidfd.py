import ctypes
import errno
import os
import sys
from typing import Protocol


class PidfdOpen(Protocol):
    def __call__(self, pid: int, flags: int, /) -> int: ...


def native_pidfd_open() -> PidfdOpen:
    library = ctypes.CDLL(None, use_errno=True)
    signature = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_int, ctypes.c_uint, use_errno=True)
    try:
        return signature(("pidfd_open", library))
    except AttributeError as error:
        raise OSError(errno.ENOSYS, "Host libc does not export pidfd_open") from error


def open_pidfd(pid: int) -> int:
    """Return a caller-owned kernel pidfd even when Python omitted its optional wrapper."""
    if not 0 < pid < 2**31:
        raise OSError(errno.EINVAL, "PID must fit a positive Linux pid_t")
    if sys.platform != "linux":
        raise OSError(errno.ENOSYS, "Kernel pidfds require Linux")
    descriptor = native_pidfd_open()(pid, 0)
    if descriptor == -1:
        error_number = ctypes.get_errno()
        raise OSError(error_number, os.strerror(error_number))
    return descriptor
