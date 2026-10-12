"""Explicit default-off test invocation of the original owner in a fresh guarded namespace."""

import json
import os
import selectors
import shutil
import socket
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic, sleep
from typing import override
from uuid import uuid4

from pydantic import BaseModel, JsonValue, TypeAdapter

from component_tests.container_binding import bind_owner
from component_tests.container_docker import Docker, prepare
from component_tests.container_facts import facts
from component_tests.container_lease import armed_lease
from component_tests.container_prototype import checkpoint
from component_tests.container_reap import finish, reap_clients
from component_tests.container_records import (
    Configuration,
    Observation,
    OwnerReceipt,
    Record,
    require_role,
)
from integration_evals.artifacts import digest
from integration_evals.contracts import runtime_digest
from integration_evals.errors import fail
from integration_evals.print_setup import PrintProfile, verify_source
from integration_evals.processes import ProcessSettings

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


def verify_git_keys(path: Path) -> None:
    """Inspect only local Git key names; credential-bearing keys prohibit mounting."""
    executable = shutil.which("git")
    assert executable is not None
    result = subprocess.run(  # noqa: S603 - fixed key-name-only Git query
        (executable, "-C", str(path), "config", "--local", "--name-only", "--list"),
        check=True,
        capture_output=True,
        timeout=5,
    )
    allowed = {
        "core.repositoryformatversion",
        "core.filemode",
        "core.bare",
        "core.logallrefupdates",
        "core.ignorecase",
        "core.precomposeunicode",
        "remote.origin.url",
        "remote.origin.fetch",
        "branch.main.remote",
        "branch.main.merge",
    }
    assert set(result.stdout.decode().splitlines()) <= allowed, "Unexpected local Git key names"


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


@dataclass(frozen=True, slots=True)
class PrintDocker(Docker):
    checkout: Path
    repository: Path
    home: Path

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
) -> None:
    raw = PrintOwnerReceipt.model_validate_json(
        (docker.configuration.directory / "owner/owner-start.json").read_bytes()
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
        (docker.configuration.directory / "guard-binding.json").read_bytes()
    )
    assert owner.namespaces == receipt.namespaces == guard.host_guard.namespaces
    assert owner.cgroup == guard.host_guard.cgroup
    process = Path(f"/proc/{owner.pid}")
    argv = tuple(part.decode() for part in (process / "cmdline").read_bytes().split(b"\0") if part)
    assert argv == command
    executable = str((process / "exe").readlink())
    assert executable == command[0]
    environment = dict(
        part.decode().split("=", 1)
        for part in (process / "environ").read_bytes().split(b"\0")
        if part
    )
    assert environment == expected_environment
    assert raw.host_read_denied is True
    assert raw.network_errno in (101, 113)
    assert len(raw.tamper) == 10
    _ = (docker.configuration.directory / "print-owner-binding.json").write_text(
        json.dumps(
            {
                "full_id": identity,
                "host_owner": owner.model_dump(),
                "container_owner": receipt.model_dump(),
                "command": argv,
                "executable_sha256": runtime_digest(Path(command[0])),
                "environment": environment,
                "security_probes": raw.model_dump(),
            },
            indent=2,
        )
    )


def bounded_response(client: subprocess.Popen[bytes], payload: bytes, deadline: float) -> bytes:
    assert client.stdin is not None
    assert client.stdout is not None
    assert len(payload) <= 65536
    _ = client.stdin.write(payload)
    client.stdin.close()
    client.stdin = None
    output = bytearray()
    with selectors.DefaultSelector() as selector:
        _ = selector.register(client.stdout, selectors.EVENT_READ)
        while True:
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(client.args, 30)
            ready = selector.select(remaining)
            if not ready:
                raise subprocess.TimeoutExpired(client.args, 30)
            part = os.read(client.stdout.fileno(), 65536)
            if not part:
                break
            assert len(output) + len(part) <= LIMIT, "Owner stdout exceeded capture limit"
            output.extend(part)
    _ = client.wait(timeout=max(0.001, deadline - monotonic()))
    return bytes(output)


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
        profile = verify_source(repository, producer)
        assert verify_source(repository, checkout) == profile
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
        assert configuration.is_file()
        assert configuration.stat().st_size <= LIMIT
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
        for source in (producer, checkout, repository):
            verify_git_keys(source)
        verify_tree(checkout)
        verify_tree(home)
        prepare(config)
        _ = (config.directory / "pre-dispatch.json").write_text(
            json.dumps(
                {
                    "request_sha256": digest(settings.payload),
                    "configuration_sha256": digest(configuration.read_bytes()),
                    "owner_script_sha256": digest((checkout / command[1]).read_bytes()),
                    "source_files": profile.source_files,
                    "backend_sources": {
                        name: digest((Path(__file__).resolve().parents[1] / name).read_bytes())
                        for name in (
                            "component_tests/guarded_print.py",
                            "component_tests/guarded_owner.py",
                            "src/integration_evals/processes.py",
                            "src/integration_evals/owner.py",
                            "src/integration_evals/execution.py",
                        )
                    },
                },
                indent=2,
            )
        )
        own_tree(checkout, config.owner.uid, config.owner.gid)
        own_tree(home, config.owner.uid, config.owner.gid)
        _ = shutil.copyfile(
            Path(__file__).with_name("guarded_owner.py"), config.directory / "code/guarded_owner.py"
        )
        _ = (config.directory / "code-hashes.json").write_text(
            json.dumps(
                {
                    path.name: digest(path.read_bytes())
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
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            address = config.directory / "control/lease"
            server.bind(str(address))
            os.chown(address, config.guard.uid, config.guard.gid)
            address.chmod(0o600)
            server.listen(1)
            creation = subprocess.Popen(  # noqa: S603 - fixed isolated Docker argv
                (docker.executable, *docker.create_arguments()),
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
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
                )
                state.clients.append(client)
                self.event("exec-client-launched", docker, state, client.pid)
                wait_owner(client, config.directory, deadline)
                self.event("exec-attached", docker, state, client.pid)
                bind_print_owner(docker, state.identity, command, environment)
                bind_owner(
                    docker,
                    state.identity,
                    OwnerReceipt.model_validate_json(
                        (config.directory / "owner/detached-owner.json").read_bytes()
                    ),
                )
                self.event("owner-awaiting-request", docker, state, client.pid)
                state.output = bounded_response(client, settings.payload, deadline)
                state.exit_code = client.returncode
                binding = TypeAdapter(dict[str, JsonValue]).validate_json(
                    (config.directory / "owner/request-binding.json").read_bytes()
                )
                assert binding == {
                    "sha256": digest(settings.payload),
                    "bytes": len(settings.payload),
                }
                lease.shutdown(socket.SHUT_RDWR)
            assert started.wait(timeout=max(0.001, deadline - monotonic())) == 0

    def __call__(self, command: tuple[str, ...], settings: ProcessSettings) -> int:
        docker, environment, profile = self.prepare(
            command, settings, monotonic() + settings.timeout
        )
        config = docker.configuration
        home = docker.home
        state = InvocationState()
        failure: BaseException | None = None
        try:
            self.run(command, settings, docker, environment, state)
        except (
            AssertionError,
            OSError,
            subprocess.SubprocessError,
            ValueError,
            KeyboardInterrupt,
        ) as error:
            failure = error
        finally:
            reaper = PrintDocker(config, monotonic() + 5, docker.checkout, docker.repository, home)
            clients_reaped = reap_clients(reaper, state.clients)
            stopped = finish(reaper, state.identity, completed=failure is None)
            receipt = {
                "backend": "guarded-print-development",
                "acceptance": "blocked",
                "full_id": state.identity,
                "command": command,
                "request_sha256": digest(settings.payload),
                "pre_dispatch_sha256": digest(
                    (config.directory / "pre-dispatch.json").read_bytes()
                ),
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
            }
            _ = (config.directory / "invocation.json").write_text(json.dumps(receipt, indent=2))
            if not stopped:
                _ = home.rename(config.directory / "quarantined-home")
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
        return state.exit_code
