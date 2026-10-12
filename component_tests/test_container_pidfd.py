import errno

import pytest

from component_tests.container_pidfd import open_pidfd


@pytest.mark.parametrize("pid", [-1, 0, 2**31])
def test_pidfd_rejects_ids_that_cannot_identify_one_linux_process(pid: int) -> None:
    # Given a value that cannot be represented as a positive Linux pid_t.
    # When the native boundary receives that value.
    with pytest.raises(OSError, check=lambda error: error.errno == errno.EINVAL) as raised:
        _ = open_pidfd(pid)
    # Then it rejects the value instead of narrowing it to another process identity.
    assert raised.value.errno == errno.EINVAL


def test_pidfd_rejects_unsupported_platform(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given a host explicitly outside the Linux pidfd contract.
    monkeypatch.setattr("component_tests.container_pidfd.sys.platform", "unsupported")
    # When a valid numeric ID reaches the native boundary.
    with pytest.raises(OSError, check=lambda error: error.errno == errno.ENOSYS) as raised:
        _ = open_pidfd(1)
    # Then it fails closed without trying an unrelated platform syscall or PID fallback.
    assert raised.value.errno == errno.ENOSYS
