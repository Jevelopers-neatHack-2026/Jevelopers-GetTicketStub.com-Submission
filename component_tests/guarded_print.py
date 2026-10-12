"""Explicit default-off test invocation of the original owner in a fresh guarded namespace."""

import json
import os
import selectors
import shutil
import socket
import subprocess
import sys
from collections import deque
from collections.abc import Callable
from contextlib import ExitStack
from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic, sleep
from traceback import walk_tb
from typing import override
from uuid import uuid4

from pydantic import BaseModel, JsonValue, TypeAdapter

from component_tests.container_binding import bind_owner
from component_tests.container_docker import Docker, prepare
from component_tests.container_facts import facts
from component_tests.container_lease import armed_lease
from component_tests.container_pidfd import open_pidfd
from component_tests.container_prototype import checkpoint
from component_tests.container_reap import finish, reap_clients
from component_tests.container_records import (
    Configuration,
    Observation,
    OwnerReceipt,
    Record,
    require_role,
)
from component_tests.container_socket import listen_lease
from component_tests.guarded_active import stop_active
from component_tests.guarded_git import verify_git_projection
from component_tests.guarded_identity import OwnerBinding, authenticate_owner, start_ticks
from integration_evals.artifacts import digest, read_bytes
from integration_evals.contracts import runtime_digest
from integration_evals.errors import InvalidArtifactError, fail
from integration_evals.print_setup import PrintProfile, verify_source
from integration_evals.processes import ProcessSettings


def exception_frames(error: BaseException | None) -> list[dict[str, str | int]]:
    """Bounded source locations only: never exception messages, source text or locals."""
    if error is None:
        return []
    root = Path(__file__).resolve().parents[1]
    allowed = {
        "component_tests/guarded_print.py",
        "component_tests/guarded_active.py",
        "component_tests/guarded_identity.py",
        "component_tests/guarded_git.py",
        "component_tests/container_docker.py",
        "component_tests/container_facts.py",
        "component_tests/container_records.py",
        "component_tests/container_pidfd.py",
        "component_tests/test_guarded_custody.py",
        "src/integration_evals/artifacts.py",
        "src/integration_evals/validation.py",
        "src/integration_evals/print_setup.py",
    }
    result: list[dict[str, str | int]] = []
    for frame, line in deque(walk_tb(error.__traceback__), maxlen=8):
        source = Path(frame.f_code.co_filename)
        if source.is_relative_to(root):
            name = source.relative_to(root).as_posix()
            if name in allowed:
                result.append(
                    {"source": name, "function": frame.f_code.co_name[:128], "line": line}
                )
    return result


LIMIT = 1048576
ENVIRONMENT = frozenset(
    {
        "PATH",
        "HOME",
        "TMPDIR",
        "IE_NAMESPACE",
        "IE_MODE",
        "IE_SEED",
        "IE_CLOCK",
        "IE_ARTIFACT_DIR",
        "PP_RENDERER_IMAGE",
    }
)


def real_directory(path: Path) -> Path:
    """Reject symlinks in any ancestor before a privileged ownership/mount operation."""
    assert path.is_absolute()
    assert path.resolve(strict=True) == path
    assert path.is_dir()
    return path


def verify_tree(path: Path) -> None:
    """Reject escaping dependency symlinks and hardlinks before privileged chown."""
    for directory, children, files in os.walk(path, followlinks=False):
        for name in (*children, *files):
            item = Path(directory) / name
            if item.is_symlink():
                assert item.resolve(strict=True).is_relative_to(path)
            elif item.is_file():
                assert item.stat().st_nlink == 1


def own_tree(path: Path, uid: int, gid: int) -> None:
    """Change only owned test tree metadata; never follow producer dependency symlinks."""
    for directory, children, files in os.walk(path, followlinks=False):
        base = Path(directory)
        os.chown(base, uid, gid, follow_symlinks=False)
        for name in (*children, *files):
            os.chown(base / name, uid, gid, follow_symlinks=False)


def reserve_custody(docker: "PrintDocker") -> None:
    """Reserve a same-filesystem owned destination before any namespace dispatch."""
    destination = docker.configuration.directory / "quarantined-home"
    destination.mkdir(mode=0o700)
    assert destination.stat().st_dev == docker.home.stat().st_dev
    assert destination.stat().st_uid == os.getuid()


def preserve_home(docker: "PrintDocker") -> None:
    """Atomically retain original HOME before fallible receipts or caller disposal."""
    try:
        _ = docker.home.replace(docker.configuration.directory / "quarantined-home")
    except OSError as error:
        fail("guarded_print_custody_unknown", type(error).__name__)


@dataclass(frozen=True, slots=True)
class PrintDocker(Docker):
    checkout: Path
    repository: Path
    home: Path

    @property
    @override
    def environment(self) -> dict[str, str]:
        return {"PATH": "/usr/bin:/bin", "HOME": str(self.configuration.directory)}

    @override
    def mounts(self) -> tuple[tuple[Path, str, bool], ...]:
        base = tuple(mount for mount in Docker.mounts(self) if mount[1] != "/producer")
        producer = self.configuration.producer
        runtime = producer / "out/toolchain/node-v24.21.0-linux-x64"
        return (
            *base,
            (self.configuration.directory / "launch", "/run/ie-launch", False),
            (runtime, str(runtime), False),
            (self.checkout, str(self.checkout), False),
            (self.repository, str(self.repository), False),
            (self.home, str(self.home), True),
        )


def owner_record(directory: Path, name: str, deadline: float) -> bytes:
    """Bound every owner-writable control receipt before parsing or host binding."""
    assert name in {"owner-start.json", "detached-owner.json", "request-binding.json"}
    return read_bytes(directory / "owner" / name, max_bytes=65536, deadline=deadline)


class PrintOwnerReceipt(Record):
    owner: Observation
    tamper: dict[str, int]
    host_read_denied: bool
    network_errno: int


class GuardBinding(BaseModel):
    host_guard: Observation


def bind_print_owner(
    docker: PrintDocker,
    identity: str,
    command: tuple[str, ...],
    expected_environment: dict[str, str],
) -> int:
    raw = PrintOwnerReceipt.model_validate_json(
        owner_record(docker.configuration.directory, "owner-start.json", docker.deadline)
    )
    receipt = raw.owner
    top = docker.run(("top", identity, "-eo", "pid"))
    owners = [
        Observation.model_validate(facts(int(line)))
        for line in top.decode().splitlines()[1:]
        if facts(int(line))["status"]["NSpid"].split()[-1] == str(receipt.pid)
    ]
    assert len(owners) == 1
    owner = owners[0]
    require_role(owner, docker.configuration.owner)
    require_role(receipt, docker.configuration.owner)
    guard = GuardBinding.model_validate_json(
        read_bytes(
            docker.configuration.directory / "guard-binding.json",
            max_bytes=65536,
            deadline=docker.deadline,
        )
    )
    assert owner.namespaces == receipt.namespaces == guard.host_guard.namespaces
    assert owner.cgroup == guard.host_guard.cgroup
    process = Path(f"/proc/{owner.pid}")
    argv = tuple(
        part.decode()
        for part in read_bytes(
            process / "cmdline", max_bytes=65536, deadline=docker.deadline
        ).split(b"\0")
        if part
    )
    assert argv == command
    executable = str((process / "exe").readlink())
    assert executable == command[0]
    environment = dict(
        part.decode().split("=", 1)
        for part in read_bytes(
            process / "environ", max_bytes=65536, deadline=docker.deadline
        ).split(b"\0")
        if part
    )
    assert environment == expected_environment
    assert raw.host_read_denied is True
    assert raw.network_errno in (101, 113)
    assert len(raw.tamper) == 10
    with os.fdopen(open_pidfd(owner.pid), "rb", buffering=0) as handle:
        observed = (process / "exe").stat()
        binding = OwnerBinding(
            host_owner=owner,
            host_owner_start_ticks=start_ticks(owner.pid, docker.deadline),
            executable_identity=(observed.st_dev, observed.st_ino),
            command=command,
        )
        _ = authenticate_owner(
            binding, handle.fileno(), docker.configuration.owner, docker.deadline
        )
        _ = (docker.configuration.directory / "print-owner-binding.json").write_text(
            json.dumps(
                {
                    "full_id": identity,
                    **binding.model_dump(),
                    "held_pidfd": {
                        "target": str(Path(f"/proc/self/fd/{handle.fileno()}").readlink()),
                        "fdinfo": read_bytes(
                            Path(f"/proc/self/fdinfo/{handle.fileno()}"),
                            max_bytes=65536,
                            deadline=docker.deadline,
                        ).decode(),
                        "inheritable": os.get_inheritable(handle.fileno()),
                    },
                    "container_owner": receipt.model_dump(),
                    "executable_sha256": runtime_digest(Path(command[0])),
                    "environment": environment,
                    "security_probes": raw.model_dump(),
                },
                indent=2,
            )
        )
        return os.dup(handle.fileno())


@dataclass(slots=True)
class Transfer:
    client: subprocess.Popen[bytes]
    payload: bytes
    selector: selectors.BaseSelector
    written: int = 0
    output: bytearray = field(default_factory=bytearray)
    after_input: Callable[[], None] | None = None

    def ready(self, descriptor: int) -> None:
        assert self.client.stdout is not None
        if descriptor == self.client.stdout.fileno():
            part = os.read(descriptor, 65536)
            if not part:
                _ = self.selector.unregister(descriptor)
            else:
                assert len(self.output) + len(part) <= LIMIT, "Owner stdout exceeded capture limit"
                self.output.extend(part)
            return
        assert self.client.stdin is not None
        self.written += os.write(descriptor, self.payload[self.written :])
        if self.written == len(self.payload):
            _ = self.selector.unregister(descriptor)
            self.client.stdin.close()
            self.client.stdin = None
            if self.after_input is not None:
                self.after_input()


def bounded_response(
    client: subprocess.Popen[bytes],
    payload: bytes,
    deadline: float,
    *,
    after_input: Callable[[], None] | None = None,
) -> bytes:
    """Forward request and bounded response concurrently under one absolute deadline."""
    assert client.stdin is not None
    assert client.stdout is not None
    assert len(payload) <= 65536
    os.set_blocking(client.stdin.fileno(), False)
    os.set_blocking(client.stdout.fileno(), False)
    with selectors.DefaultSelector() as selector:
        transfer = Transfer(client, payload, selector, after_input=after_input)
        _ = selector.register(client.stdout, selectors.EVENT_READ)
        if payload:
            _ = selector.register(client.stdin, selectors.EVENT_WRITE)
        else:
            client.stdin.close()
            client.stdin = None
        while selector.get_map():
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(client.args, 30)
            ready = selector.select(remaining)
            if not ready:
                raise subprocess.TimeoutExpired(client.args, 30)
            for key, _ in ready:
                try:
                    transfer.ready(key.fd)
                except BlockingIOError:
                    continue
    remaining = deadline - monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired(client.args, 30)
    _ = client.wait(timeout=remaining)
    return bytes(transfer.output)


def wait_owner(client: subprocess.Popen[bytes], directory: Path, deadline: float) -> None:
    while not (directory / "owner/owner-start.json").exists():
        assert client.poll() is None, "Owner launch failed before receipt"
        if monotonic() >= deadline:
            raise subprocess.TimeoutExpired(client.args, 30)
        sleep(0.01)


@dataclass(slots=True)
class InvocationState:
    clients: list[subprocess.Popen[bytes]] = field(default_factory=list)
    identity: str | None = None
    output: bytes = b""
    exit_code: int | None = None


@dataclass(frozen=True, slots=True)
class GuardedPrint:
    producer: Path
    evidence: Path
    checkpoints: bool = False
    daemon_failure: bool = False
    compose_checkpoint: bool = False

    def prepare(
        self, command: tuple[str, ...], settings: ProcessSettings, deadline: float
    ) -> tuple[PrintDocker, dict[str, str], PrintProfile]:
        if not __debug__ or sys.platform != "linux" or os.getuid() != 0:
            return fail("guarded_print_host_unavailable", "development-only")
        home = settings.writable_directory
        if not settings.offline or home is None:
            return fail("guarded_print_requires_offline_root", "development-only")
        producer = real_directory(self.producer)
        checkout = real_directory(settings.checkout)
        repository = real_directory(checkout.parent / "integration-evals")
        home = real_directory(home)
        assert len({producer, checkout, repository, home}) == 4
        roots = (producer, checkout, repository, home, real_directory(Path(sys.base_prefix)))
        assert not any(
            a.is_relative_to(b) or b.is_relative_to(a)
            for i, a in enumerate(roots)
            for b in roots[i + 1 :]
        )
        profile = verify_source(repository, producer, deadline=deadline)
        assert verify_source(repository, checkout, deadline=deadline) == profile
        node = producer / "out/toolchain/node-v24.21.0-linux-x64/bin/node"
        allowed = (
            (str(node), "dist/scripts/integration-evals/cli.js", "run"),
            (str(node), "dist/scripts/integration-evals/cli.js", "cleanup"),
            (str(node), "dist/tests/fixtures/integration-evals/positive-control.js"),
        )
        assert command in allowed
        assert set(settings.environment) in (ENVIRONMENT, ENVIRONMENT - {"PP_RENDERER_IMAGE"})
        environment = dict(settings.environment)
        environment["PATH"] = str(node.parent) + ":/usr/bin:/bin"
        assert environment["HOME"] == environment["TMPDIR"] == str(home)
        assert environment["IE_ARTIFACT_DIR"] == str(home / "artifacts")
        assert environment.get("PP_RENDERER_IMAGE", profile.image) == profile.image
        environment["PP_RENDERER_IMAGE"] = profile.image
        assert len(settings.payload) <= 65536
        request = TypeAdapter(dict[str, JsonValue]).validate_json(settings.payload)
        config_path = request.get("configuration_artifact")
        assert isinstance(config_path, str)
        configuration = Path(config_path)
        assert configuration.resolve(strict=True) == configuration
        assert configuration.is_relative_to(repository) or configuration.is_relative_to(home)
        configuration_bytes = read_bytes(configuration, max_bytes=LIMIT, deadline=deadline)
        self.evidence.mkdir(parents=True, exist_ok=True)
        evidence = real_directory(self.evidence)
        name = "ie-lifetime-" + uuid4().hex
        config = Configuration(
            producer=producer,
            directory=evidence / name,
            name=name,
            teardown_daemon_failure=self.daemon_failure,
        )
        docker = PrintDocker(config, deadline, checkout, repository, home)
        assert not any(
            evidence.is_relative_to(root) or root.is_relative_to(evidence) for root in roots
        )
        for source in (checkout, repository):
            verify_git_projection(source, deadline)
        verify_tree(checkout)
        verify_tree(home)
        prepare(config)
        reserve_custody(docker)
        _ = (config.directory / "pre-dispatch.json").write_text(
            json.dumps(
                {
                    "request_sha256": digest(settings.payload),
                    "logical_scenario_clock": request.get("clock"),
                    "configuration_sha256": digest(configuration_bytes),
                    "owner_script_sha256": digest(
                        read_bytes(checkout / command[1], max_bytes=LIMIT, deadline=deadline)
                    ),
                    "source_files": profile.source_files,
                    "backend_sources": {
                        name: digest(
                            read_bytes(
                                Path(__file__).resolve().parents[1] / name,
                                max_bytes=LIMIT,
                                deadline=deadline,
                            )
                        )
                        for name in (
                            "component_tests/guarded_print.py",
                            "component_tests/guarded_owner.py",
                            "component_tests/guarded_git.py",
                            "component_tests/guarded_active.py",
                            "component_tests/guarded_compose_probe.py",
                            "component_tests/guarded_identity.py",
                            "component_tests/container_socket.py",
                            "component_tests/print_clock.py",
                            "component_tests/print_protocol.py",
                            "src/integration_evals/artifacts.py",
                            "src/integration_evals/validation.py",
                            "src/integration_evals/print_setup.py",
                            "src/integration_evals/processes.py",
                            "src/integration_evals/owner.py",
                            "src/integration_evals/execution.py",
                            "src/integration_evals/runner.py",
                        )
                    },
                },
                indent=2,
            )
        )
        own_tree(checkout, config.owner.uid, config.owner.gid)
        own_tree(home, config.owner.uid, config.owner.gid)
        for name in ("guarded_owner.py", "guarded_compose_probe.py"):
            _ = shutil.copyfile(Path(__file__).with_name(name), config.directory / "code" / name)
        _ = (config.directory / "code-hashes.json").write_text(
            json.dumps(
                {
                    path.name: digest(read_bytes(path, max_bytes=LIMIT, deadline=deadline))
                    for path in (config.directory / "code").iterdir()
                }
            )
        )
        launch = config.directory / "launch"
        launch.mkdir(mode=0o755)
        _ = (config.directory / "host-only-marker").write_text("not-mounted")
        return docker, environment, profile

    def event(
        self, stage: str, docker: PrintDocker, state: InvocationState, client_pid: int
    ) -> None:
        _ = (docker.configuration.directory / "live-clients.json").write_text(
            json.dumps(
                {
                    "pids": [item.pid for item in state.clients if item.poll() is None],
                    "full_id": state.identity,
                }
            )
        )
        if self.checkpoints:
            checkpoint(stage, docker.deadline, client_pid)

    def run(
        self,
        command: tuple[str, ...],
        settings: ProcessSettings,
        docker: PrintDocker,
        environment: dict[str, str],
        state: InvocationState,
    ) -> None:
        config = docker.configuration
        deadline = docker.deadline
        launch = config.directory / "launch"
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server, ExitStack() as handles:
            listen_lease(server, config, deadline)
            creation = subprocess.Popen(  # noqa: S603 - fixed isolated Docker argv
                (docker.executable, *docker.create_arguments()),
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=docker.environment,
            )
            state.clients.append(creation)
            created, _ = creation.communicate(timeout=max(0.001, deadline - monotonic()))
            assert creation.returncode == 0
            state.identity = docker.inspect(created.decode().strip()).Id
            assert (config.directory / "cid").read_text().strip() == state.identity
            assert state.identity is not None
            started = subprocess.Popen(  # noqa: S603 - captured immutable ID
                (docker.executable, "start", "--attach", state.identity),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=docker.environment,
            )
            state.clients.append(started)
            with armed_lease(docker, server, state.identity) as (lease, receipt):
                _ = (launch / "launch.json").write_text(
                    json.dumps(
                        {
                            "guard": receipt.guard.pid,
                            "lease_fd": receipt.lease_fd,
                            "command": command,
                            "checkout": str(docker.checkout),
                            "environment": environment,
                            "host_probe": str(config.directory / "host-only-marker"),
                            "request_sha256": digest(settings.payload),
                        }
                    )
                )
                client = subprocess.Popen(  # noqa: S603 - fixed source-bound manifest wrapper
                    (
                        docker.executable,
                        "exec",
                        "-i",
                        "--user",
                        config.owner.docker_user,
                        state.identity,
                        str(Path(sys.base_prefix) / "bin/python3.13"),
                        "-B",
                        "-m",
                        "component_tests.guarded_owner",
                    ),
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    env=docker.environment,
                )
                state.clients.append(client)
                self.event("exec-client-launched", docker, state, client.pid)
                wait_owner(client, config.directory, deadline)
                self.event("exec-attached", docker, state, client.pid)
                owner_handle = handles.enter_context(
                    os.fdopen(
                        bind_print_owner(docker, state.identity, command, environment),
                        "rb",
                        buffering=0,
                    )
                )
                bind_owner(
                    docker,
                    state.identity,
                    OwnerReceipt.model_validate_json(
                        owner_record(config.directory, "detached-owner.json", deadline)
                    ),
                )
                self.event("owner-awaiting-request", docker, state, client.pid)
                callback = (
                    (
                        lambda: self.compose_active(
                            docker,
                            state,
                            client.pid,
                            environment["IE_NAMESPACE"],
                            owner_handle.fileno(),
                        )
                    )
                    if self.compose_checkpoint
                    else None
                )
                state.output = bounded_response(
                    client, settings.payload, deadline, after_input=callback
                )
                state.exit_code = client.returncode
                binding = TypeAdapter(dict[str, JsonValue]).validate_json(
                    owner_record(config.directory, "request-binding.json", deadline)
                )
                assert binding == {
                    "sha256": digest(settings.payload),
                    "bytes": len(settings.payload),
                }
                lease.shutdown(socket.SHUT_RDWR)
            assert started.wait(timeout=max(0.001, deadline - monotonic())) == 0

    def compose_active(
        self,
        docker: PrintDocker,
        state: InvocationState,
        client_pid: int,
        namespace: str,
        owner_descriptor: int,
    ) -> None:

        assert state.identity is not None
        stop_active(docker, state.identity, namespace, docker.home, owner_descriptor)
        self.event("compose-active", docker, state, client_pid)

    def __call__(self, command: tuple[str, ...], settings: ProcessSettings) -> int:
        docker, environment, profile = self.prepare(
            command, settings, monotonic() + settings.timeout
        )
        config = docker.configuration
        home = docker.home
        pre_dispatch_sha256 = digest(
            read_bytes(
                config.directory / "pre-dispatch.json", max_bytes=65536, deadline=docker.deadline
            )
        )
        state = InvocationState()
        failure: BaseException | None = None
        try:
            self.run(command, settings, docker, environment, state)
        except (
            AssertionError,
            OSError,
            subprocess.SubprocessError,
            ValueError,
            InvalidArtifactError,
            KeyboardInterrupt,
        ) as error:
            failure = error
        finally:
            reaper = PrintDocker(config, monotonic() + 5, docker.checkout, docker.repository, home)
            stopped = False
            try:
                clients_reaped = reap_clients(reaper, state.clients)
                stopped = finish(reaper, state.identity, completed=failure is None)
            finally:
                if not stopped:
                    preserve_home(reaper)
            receipt = {
                "backend": "guarded-print-development",
                "acceptance": "blocked",
                "full_id": state.identity,
                "command": command,
                "request_sha256": digest(settings.payload),
                "pre_dispatch_sha256": pre_dispatch_sha256,
                "source_revision": profile.revision,
                "source_tree": profile.tree,
                "roles": {"guard": config.guard.model_dump(), "owner": config.owner.model_dump()},
                "mounts": [
                    (str(source), target, writable) for source, target, writable in docker.mounts()
                ],
                "stdout_bytes": len(state.output),
                "stdout_sha256": digest(state.output),
                "owner_exit": state.exit_code,
                "clients_reaped": clients_reaped,
                "namespace_stopped_and_removed": stopped,
                "error": type(failure).__name__ if failure else None,
                "error_frames": exception_frames(failure),
            }
            _ = (config.directory / "invocation.json").write_text(json.dumps(receipt, indent=2))
            if stopped:
                own_tree(docker.checkout, 0, 0)
            if not clients_reaped or not stopped:
                fail("guarded_print_teardown_unknown", "development-only")
        if failure is not None:
            raise failure
        assert state.exit_code is not None
        if not isinstance(settings.stdout, int):
            _ = settings.stdout.seek(0)
            _ = settings.stdout.truncate()
            _ = settings.stdout.write(state.output)
            settings.stdout.flush()
        return state.exit_code
