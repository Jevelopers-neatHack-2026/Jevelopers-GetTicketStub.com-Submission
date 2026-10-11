# /// script
# requires-python = ">=3.13"
# dependencies = ["pydantic>=2.12,<3"]
# ///
# How to run: the repository pytest process tests invoke this owned fixture with
# their interpreter: python process_cancel.py ROOT DEPTH owner.

import fcntl
import os
import sys
from enum import StrEnum
from pathlib import Path
from threading import Event
from time import monotonic
from typing import Final, assert_never

from integration_evals.models import Record

WATCHDOG_SECONDS: Final = 15


class InvalidDepth(SystemExit):
    def __init__(self) -> None:
        super().__init__("fixture depth must be between 0 and 2")


class Role(StrEnum):
    OWNER = "owner"
    BRANCH = "branch"
    LEAF = "leaf"


class Gate(StrEnum):
    IDLE = ""
    PROBE = "probe"
    RELEASE = "release"
    QUIT = "quit"


class Ready(Record):
    role: Role
    session_leader: bool


class CancellationTrace(Record):
    platform: str
    depth: int
    readiness: tuple[Ready, ...]
    observer: Ready | None
    events: tuple[str, ...]
    stdout: str
    marker: str
    observer_thread_stopped: bool
    cleanup_lease_released: bool | None


def write_value(path: Path, value: str) -> None:
    temporary = path.with_suffix(".next")
    _ = temporary.write_text(value, encoding="utf-8")
    _ = temporary.replace(path)


def ready(root: Path, name: str, role: Role) -> None:
    record = Ready(role=role, session_leader=os.getpid() == os.getsid(0))
    write_value(root / f"{name}.json", record.model_dump_json())
    emit(f"{name}: {record.model_dump_json()}")


def emit(value: str) -> None:
    _ = sys.stdout.write(value + "\n")
    _ = sys.stdout.flush()


def observe(root: Path, role: Role) -> None:
    # os._exit keeps the lease descriptor open until this exact process exits.
    with (root / "lease").open("w+b") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX)
        write_value(root / "sentinel", "ready")
        ready(root, "observer", role)
        deadline = monotonic() + WATCHDOG_SECONDS
        last = Gate.IDLE
        while monotonic() < deadline:
            path = root / "gate"
            gate = Gate(path.read_text(encoding="utf-8")) if path.exists() else Gate.IDLE
            if gate is not last:
                match gate:
                    case Gate.PROBE:
                        write_value(root / "sentinel", "probe-confirmed")
                        emit("probe-confirmed")
                    case Gate.RELEASE:
                        write_value(root / "sentinel", "survived")
                        os._exit(0)
                    case Gate.QUIT:
                        os._exit(0)
                    case Gate.IDLE:
                        emit("idle")
                    case _:
                        assert_never(gate)
                last = gate
            _ = Event().wait(0.01)
        os._exit(2)


def run(root: Path, depth: int, role: Role) -> None:
    if not 0 <= depth <= 2:
        raise InvalidDepth
    ready(root, role.value, role)
    if depth == 0:
        observe(root, role)
        return
    child_role = Role.LEAF if depth == 1 else Role.BRANCH
    try:
        child = os.fork()
    except PermissionError:
        write_value(root / "fork-denied", "process-fork rejected")
        emit("fork-denied")
        observe(root, Role.OWNER)
        return
    if child == 0:
        _ = os.setsid()
        run(root, depth - 1, child_role)
        os._exit(0)
    _ = os.waitpid(child, 0)


if __name__ == "__main__":
    run(Path(sys.argv[1]), int(sys.argv[2]), Role(sys.argv[3]))
