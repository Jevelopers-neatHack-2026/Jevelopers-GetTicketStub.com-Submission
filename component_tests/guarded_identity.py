"""Authenticate a held owner pidfd before any privileged process signal."""

import os
import select
from pathlib import Path

from pydantic import BaseModel

from component_tests.container_facts import facts
from component_tests.container_records import Observation, Role, require_role
from integration_evals.artifacts import read_bytes


class OwnerBinding(BaseModel):
    host_owner: Observation
    host_owner_start_ticks: str
    executable_identity: tuple[int, int]
    command: tuple[str, ...]


def start_ticks(pid: int, deadline: float) -> str:
    value = read_bytes(Path(f"/proc/{pid}/stat"), max_bytes=65536, deadline=deadline)
    # Parentheses in comm belong to field2; field22 is index19 after its closing delimiter.
    return value.rsplit(b") ", 1)[1].split()[19].decode()


def authenticate_owner(
    binding: OwnerBinding, descriptor: int, role: Role, deadline: float
) -> Observation:
    assert not os.get_inheritable(descriptor)
    assert not select.select([descriptor], [], [], 0)[0], "Bound owner already exited"
    info = read_bytes(Path(f"/proc/self/fdinfo/{descriptor}"), max_bytes=65536, deadline=deadline)
    assert (
        int(dict(line.split(b":", 1) for line in info.splitlines())[b"Pid"].strip())
        == binding.host_owner.pid
    )
    current = Observation.model_validate(facts(binding.host_owner.pid))
    require_role(current, role)
    assert current.namespaces == binding.host_owner.namespaces
    assert current.cgroup == binding.host_owner.cgroup
    assert start_ticks(current.pid, deadline) == binding.host_owner_start_ticks
    process = Path(f"/proc/{current.pid}")
    assert str((process / "exe").readlink()) == binding.command[0]
    executable = (process / "exe").stat()
    assert (executable.st_dev, executable.st_ino) == binding.executable_identity
    argv = tuple(
        part.decode()
        for part in read_bytes(process / "cmdline", max_bytes=65536, deadline=deadline).split(b"\0")
        if part
    )
    assert argv == binding.command
    assert not select.select([descriptor], [], [], 0)[0], "Bound owner exited during authentication"
    return current
