import ctypes
import os
import sys
from pathlib import Path

import pytest

from integration_evals.errors import InvalidArtifactError
from integration_evals.process_seccomp import export_filter, network_filter
from integration_evals.processes import ProcessSettings, invoke


def test_filter_rejects_execution_when_system_library_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given a system without the required filter compiler.
    def unavailable(_name: str) -> ctypes.CDLL:
        raise OSError

    monkeypatch.setattr(ctypes, "CDLL", unavailable)
    # When an offline invocation requests its filter.
    with pytest.raises(InvalidArtifactError, match="offline_seccomp_unavailable"):
        export_filter(-1)
    # Then it cannot fall back to unfiltered execution.


@pytest.mark.skipif(sys.platform != "linux", reason="requires actual Linux libseccomp")
def test_filter_descriptor_closes_after_its_owner_context_exits() -> None:
    # Given the real native filter compiler and an unlinked temporary descriptor.
    # When exporting and then leaving the owning context.
    with network_filter(offline=True) as descriptor:
        assert descriptor is not None
        assert os.fstat(descriptor).st_size > 0
    # Then no filter descriptor remains usable in the evaluator.
    with pytest.raises(OSError, match="Bad file descriptor"):
        _ = os.fstat(descriptor)


@pytest.mark.skipif(sys.platform != "linux", reason="requires actual Linux syscall filtering")
@pytest.mark.parametrize(
    "name", ["socketpair", "io_uring_setup", "io_uring_enter", "io_uring_register"]
)
def test_offline_filter_denies_alternate_socket_and_io_uring_paths(
    tmp_path: Path, name: str
) -> None:
    # Given a real child using the system's native syscall resolver.
    program = """import ctypes,errno,sys
library=ctypes.CDLL('libseccomp.so.2')
resolve=library.seccomp_syscall_resolve_name
resolve.argtypes=[ctypes.c_char_p]
resolve.restype=ctypes.c_int
number=resolve(sys.argv[1].encode())
assert number != -1
libc=ctypes.CDLL(None,use_errno=True)
print('runtime-started',flush=True)
result=libc.syscall(number,0,0,0,0,0,0)
assert result == -1 and ctypes.get_errno() == errno.EPERM
print('permission-denied')
"""
    output = tmp_path / "stdout"
    # When invoking blocked operations through the native syscall entry point.
    with output.open("w+b") as stream:
        result = invoke(
            (sys.executable, "-c", program, name),
            ProcessSettings(
                tmp_path, os.environ, b"", stream, 5, offline=True, writable_directory=tmp_path
            ),
        )
    # Then the real filter denies the calls rather than rejecting the runtime itself.
    assert result == 0
    assert output.read_text() == "runtime-started\npermission-denied\n"
