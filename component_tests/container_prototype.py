import errno
import json
import os
import select
import signal
import socket
import subprocess
import sys
from contextlib import ExitStack
from pathlib import Path
from time import monotonic
from types import FrameType

from component_tests.container_binding import bind_owner
from component_tests.container_docker import Docker, prepare
from component_tests.container_lease import armed_lease
from component_tests.container_reap import finish, reap_clients
from component_tests.container_records import Configuration, OwnerReceipt


def checkpoint(stage: str, deadline: float, client_pid: int = 0) -> None:
    _ = sys.stdout.write(json.dumps({"stage": stage, "client_pid": client_pid}) + "\n")
    _ = sys.stdout.flush()
    readable, _, _ = select.select([sys.stdin], [], [], max(0, deadline - monotonic()))
    if not readable:
        raise TimeoutError(stage)
    assert sys.stdin.readline() == "continue\n", "Controller input closed or invalid"


def cancellation(_number: int, _frame: FrameType | None) -> None:
    raise InterruptedError


def execute(configuration: Configuration) -> int:
    if not __debug__ or os.environ.get("IE_PRINT_CONTAINER_PROTOTYPE") != "guarded-development":
        raise PermissionError(errno.EPERM, "Guarded development selection required")
    if sys.platform != "linux" or os.getuid() != 0:
        raise PermissionError(errno.EPERM, "Authorized Linux host controller required")
    deadline = monotonic() + 30
    docker = Docker(configuration, deadline)
    prepare(configuration)
    identity: str | None = None
    clients: list[subprocess.Popen[bytes]] = []
    outcome = "ERROR"
    try:
        with ExitStack() as stack:
            server = stack.enter_context(socket.socket(socket.AF_UNIX, socket.SOCK_STREAM))
            address = configuration.directory / "control/lease"
            server.bind(str(address))
            os.chown(address, configuration.guard.uid, configuration.guard.gid)
            address.chmod(0o600)
            server.listen(1)
            server.settimeout(max(0.001, deadline - monotonic()))
            creation = subprocess.Popen(  # noqa: S603 - reaped after sockets close in finally
                (docker.executable, *docker.create_arguments()),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            clients.append(creation)
            checkpoint("create-client-launched", deadline, creation.pid)
            output, errors = creation.communicate(timeout=max(0.001, deadline - monotonic()))
            assert creation.returncode == 0, errors
            identity = docker.inspect(output.decode().strip()).Id
            assert (configuration.directory / "cid").read_text().strip() == identity
            _ = (configuration.directory / "owned-id").write_text(identity)
            checkpoint("created", deadline)
            started = subprocess.Popen(  # noqa: S603 - reaped after sockets close in finally
                (docker.executable, "start", "--attach", identity),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            clients.append(started)
            checkpoint("start-attach-client-launched", deadline, started.pid)
            lease, receipt = stack.enter_context(armed_lease(docker, server, identity))
            checkpoint("lease-armed", deadline)
            owner_raw = docker.run(
                (
                    "exec",
                    "--user",
                    configuration.owner.docker_user,
                    identity,
                    str(Path(sys.base_prefix) / "bin/python3.13"),
                    "-B",
                    "-m",
                    "component_tests.container_canary",
                    str(receipt.guard.pid),
                    str(receipt.lease_fd),
                )
            )
            _ = (configuration.directory / "owner-receipt.json").write_bytes(owner_raw)
            bind_owner(docker, identity, OwnerReceipt.model_validate_json(owner_raw))
            checkpoint("owner-detached", deadline)
            lease.shutdown(socket.SHUT_RDWR)
            assert started.wait(timeout=max(0.001, deadline - monotonic())) == 0
            outcome = "LIFETIME_PROBE_COMPLETED"
    except (AssertionError, OSError, subprocess.SubprocessError, ValueError) as error:
        _ = (configuration.directory / "controller-error.txt").write_text(type(error).__name__)
    finally:
        reaper = Docker(configuration, monotonic() + 5)
        if not reap_clients(reaper, clients):
            outcome = "ERROR"
        if not finish(reaper, identity, completed=outcome == "LIFETIME_PROBE_COMPLETED"):
            outcome = "ERROR"
        _ = (configuration.directory / "result.json").write_text(
            json.dumps(
                {
                    "outcome": outcome,
                    "full_id": identity,
                    "acceptance": "blocked",
                }
            )
        )
    return 0 if outcome == "LIFETIME_PROBE_COMPLETED" else 1


if __name__ == "__main__":
    _ = signal.signal(signal.SIGTERM, cancellation)
    _ = signal.signal(signal.SIGINT, cancellation)
    sys.exit(execute(Configuration.model_validate_json(Path(sys.argv[1]).read_bytes())))
