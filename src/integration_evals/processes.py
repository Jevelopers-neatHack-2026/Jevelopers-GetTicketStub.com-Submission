"""Bound the lifetime of task-owned process groups without touching unrelated processes."""

import os
import signal
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import IO


@dataclass(frozen=True, slots=True)
class ProcessSettings:
    """One command's resources and cancellation deadline."""

    checkout: Path
    environment: Mapping[str, str]
    payload: bytes
    stdout: IO[bytes] | int
    timeout: float


def terminate_group(process: subprocess.Popen[bytes]) -> None:
    """Kill the new session's descendants, including leftovers after leader exit."""
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return


def invoke(command: tuple[str, ...], settings: ProcessSettings) -> int:
    """Own a session and reap its leader on success, timeout and cancellation."""
    with subprocess.Popen(  # noqa: S603 - reviewed command in a new task-owned session
        command,
        cwd=settings.checkout,
        env=settings.environment,
        stdin=subprocess.PIPE,
        stdout=settings.stdout,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    ) as process:
        try:
            _ = process.communicate(input=settings.payload, timeout=settings.timeout)
        finally:
            terminate_group(process)
            exit_code = process.wait(timeout=5)
        return exit_code
