"""Bound the lifetime of task-owned process groups without touching unrelated processes."""

import os
import shutil
import signal
import subprocess
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Protocol

from integration_evals.errors import fail
from integration_evals.process_network import OfflineNetwork, require_network_boundary
from integration_evals.process_reads import (
    linux_reads,
    owned_directory,
    read_paths,
    sandbox_reads,
)
from integration_evals.process_seccomp import network_filter


class TestInvocation(Protocol):
    """Explicit development-test dependency; no CLI or ambient backend selection."""

    def __call__(self, command: tuple[str, ...], settings: "ProcessSettings") -> int:
        """Invoke one command with the test's independently verified containment."""
        ...


@dataclass(frozen=True, slots=True)
class ProcessSettings:
    """One command's resources and cancellation deadline."""

    checkout: Path
    environment: Mapping[str, str]
    payload: bytes
    stdout: IO[bytes] | int
    timeout: float
    offline: bool = False
    writable_directory: Path | None = None
    network: OfflineNetwork = OfflineNetwork.DENY
    test_invocation: TestInvocation | None = None


def terminate_group(process: subprocess.Popen[bytes]) -> None:
    """Kill the new session's descendants, including leftovers after leader exit."""
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return


def contained_command(
    command: tuple[str, ...], settings: ProcessSettings, filter_descriptor: int | None = None
) -> tuple[str, ...]:
    """Contain detached children in Linux PID namespaces; prohibit forks on macOS."""
    require_network_boundary(settings.network, offline=settings.offline)
    directory = settings.writable_directory
    if settings.offline and directory is None:
        return fail("offline_writable_directory_missing", "owner-command")
    reads: tuple[Path, ...] = ()
    if settings.offline and directory is not None:
        directory = owned_directory(directory)
        reads = read_paths(command, owned_directory(settings.checkout), directory)
    if sys.platform == "darwin":
        sandbox = shutil.which("sandbox-exec")
        if sandbox is not None:
            profile = "(version 1) (allow default) (deny process-fork)"
            if settings.offline and directory is not None:
                profile += sandbox_reads(reads)
                escaped = str(directory).replace("\\", "\\\\").replace('"', '\\"')
                profile += (
                    f' (deny network*) (deny file-write*) (allow file-write* (subpath "{escaped}"))'
                )
            return (sandbox, "-p", profile, *command)
    if sys.platform == "linux":
        bubblewrap = shutil.which("bwrap")
        if bubblewrap is not None:
            bindings = ("--bind", "/", "/")
            if settings.offline and directory is not None:
                if filter_descriptor is None:
                    fail("offline_seccomp_missing", "owner-command")
                bindings = (*linux_reads(reads, directory), "--seccomp", str(filter_descriptor))
            return (
                bubblewrap,
                "--unshare-pid",
                "--die-with-parent",
                *bindings,
                "--dev",
                "/dev",
                "--proc",
                "/proc",
                *(("--remount-ro", "/") if settings.offline else ()),
                "--",
                *command,
            )
    return fail("process_lifetime_containment_unavailable", "owner-command")


def invoke(command: tuple[str, ...], settings: ProcessSettings) -> int:
    """Own a session and reap its leader on success, timeout and cancellation."""
    if settings.test_invocation is not None:
        return settings.test_invocation(command, settings)
    with (
        network_filter(offline=settings.offline, policy=settings.network) as descriptor,
        subprocess.Popen(  # noqa: S603 - reviewed command in a new task-owned session
            contained_command(command, settings, descriptor),
            cwd=settings.checkout,
            env=settings.environment,
            stdin=subprocess.PIPE,
            stdout=settings.stdout,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            pass_fds=() if descriptor is None else (descriptor,),
        ) as process,
    ):
        try:
            _ = process.communicate(input=settings.payload, timeout=settings.timeout)
        finally:
            terminate_group(process)
            exit_code = process.wait(timeout=5)
        return exit_code
