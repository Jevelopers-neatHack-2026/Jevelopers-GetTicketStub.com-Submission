"""Original evaluator/protocol oracles under explicit guarded development containment."""

import json
import os
import select
import signal
import subprocess
import sys
from collections.abc import Sequence
from contextlib import ExitStack
from pathlib import Path
from time import monotonic
from typing import IO

import pytest
from pydantic import JsonValue, TypeAdapter

from component_tests.container_driver import Checkpoint, driver
from component_tests.container_pidfd import open_pidfd
from component_tests.container_reap import recover
from component_tests.container_records import Configuration, Observation
from component_tests.guarded_print import GuardedPrint, PrintDocker, own_tree
from component_tests.guarded_print_worker import WorkerConfiguration
from component_tests.print_workspace import workspace_at
from component_tests.test_print import (
    test_print_protocol_rejects_unsupported_inputs as original_protocol_test,
)
from component_tests.test_print import (
    verified_print_workspace as original_workspace_fixture,
)
from integration_evals.artifacts import read_bytes

verified_print_workspace = original_workspace_fixture
test_print_protocol = original_protocol_test


@pytest.fixture(scope="module")
def print_invocation() -> GuardedPrint:
    return GuardedPrint(
        Path(os.environ["IE_PRINT_SOURCE"]).resolve(),
        Path(os.environ["IE_PRINT_EVIDENCE"]).resolve() / "guarded-invocations",
    )


def advance(process: subprocess.Popen[bytes], stage: str) -> None:
    assert process.stdout is not None
    assert process.stdin is not None
    deadline = monotonic() + 30
    while True:
        raw = b""
        while not raw.endswith(b"\n"):
            ready, _, _ = select.select([process.stdout], [], [], max(0, deadline - monotonic()))
            assert ready, "Actual-owner creator checkpoint expired"
            part = os.read(process.stdout.fileno(), 1)
            assert part, f"Actual-owner creator exited before {stage}"
            raw += part
            assert len(raw) <= 4096
        event = Checkpoint.model_validate_json(raw)
        if event.stage == stage:
            return
        _ = process.stdin.write(b"continue\n")
        process.stdin.flush()


def new_home(root: Path) -> Path:
    home = (root / "home").resolve()
    home.mkdir(mode=0o700)
    (home / "artifacts").mkdir()
    return home


def assert_active_compose(directory: Path) -> int:
    active = TypeAdapter(dict[str, JsonValue]).validate_json(
        read_bytes(directory / "active-compose.json")
    )
    assert active["request_delivered"] is True
    attempt = TypeAdapter(dict[str, JsonValue]).validate_python(active["attempt"])
    assert attempt["pending"] is True
    assert attempt["outcome"] is None
    assert attempt["execution_started_events"] == 1
    assert attempt["operation_name"] == "composeArtifact"
    assert attempt["snapshot"] == "stopped-owner-read-transaction-bound-db-wal-shm"
    owner = Observation.model_validate(active["host_owner"])
    assert owner.status["State"].split()[0] == "T"
    return owner.pid


def death_descriptors(directory: Path, stage: str, handles: ExitStack) -> Sequence[IO[bytes]]:
    observed = TypeAdapter(dict[str, list[int] | str]).validate_json(
        read_bytes(directory / "live-clients.json", max_bytes=65536)
    )
    pids = TypeAdapter(list[int]).validate_python(observed["pids"])
    assert len(pids) == 2
    if stage == "compose-active":
        pids.append(assert_active_compose(directory))
    descriptors = [
        handles.enter_context(os.fdopen(open_pidfd(pid), "rb", buffering=0)) for pid in pids
    ]
    assert all(not os.get_inheritable(fd.fileno()) for fd in descriptors)
    assert not select.select(descriptors, [], [], 0)[0]
    _ = (directory / "exec-pidfds.json").write_text(
        json.dumps(
            [
                {
                    "pid": pid,
                    "target": str(Path(f"/proc/self/fd/{fd.fileno()}").readlink()),
                    "fdinfo": read_bytes(
                        Path(f"/proc/self/fdinfo/{fd.fileno()}"), max_bytes=65536
                    ).decode(),
                    "inheritable": os.get_inheritable(fd.fileno()),
                }
                for pid, fd in zip(pids, descriptors, strict=True)
            ]
        )
    )
    return descriptors


@pytest.mark.parametrize(
    "stage", ["exec-client-launched", "exec-attached", "owner-awaiting-request", "compose-active"]
)
def test_actual_owner_creator_death(
    verified_print_workspace: Path, tmp_path: Path, stage: str
) -> None:
    # Given an independent sentinel and a fresh clone containing the original owner command.
    assert verified_print_workspace.is_dir()
    workspace = workspace_at((tmp_path / "workspace").resolve(), browser_in_container=True)
    home = new_home(tmp_path)
    evidence = Path(os.environ["IE_PRINT_EVIDENCE"]) / "exec-deaths" / stage
    config = WorkerConfiguration(
        workspace=workspace,
        home=home,
        producer=Path(os.environ["IE_PRINT_SOURCE"]),
        evidence=evidence,
        compose_checkpoint=stage == "compose-active",
    )
    configuration = tmp_path / "worker.json"
    _ = configuration.write_text(config.model_dump_json())
    with driver() as sentinel, ExitStack() as handles:
        _ = sentinel.advance("owner-detached")
        with subprocess.Popen(  # noqa: S603 - fixed independent test creator
            (sys.executable, "-m", "component_tests.guarded_print_worker", str(configuration)),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        ) as process:
            try:
                advance(process, stage)
                directories = tuple(evidence.glob("ie-lifetime-*"))
                assert len(directories) == 1
                directory = directories[0]
                descriptors = death_descriptors(directory, stage, handles)
                before = monotonic()
                # When SIGKILL closes this creator's sole kernel lease endpoint.
                process.kill()
                assert process.wait(timeout=5) == -signal.SIGKILL
                for descriptor in descriptors:
                    readable, _, _ = select.select([descriptor], [], [], 5)
                    assert readable, "Authenticated owner or Docker client survived creator death"
                lifetime = Configuration.model_validate_json(
                    (directory / "configuration.json").read_bytes()
                )
                docker = PrintDocker(
                    lifetime,
                    monotonic() + 5,
                    workspace / "print-production",
                    workspace / "integration-evals",
                    home,
                )
                inspection = docker.inspect(lifetime.name)
                if inspection.State.Running:
                    _ = docker.run(("wait", inspection.Id))
                final = docker.inspect(inspection.Id)
                # Then actual namespace termination precedes recovery and artifact custody.
                assert not final.State.Running
                assert monotonic() - before <= 5
                assert (home / "stdout").read_bytes() == b""
                live = sentinel.docker().inspect(sentinel.configuration.name)
                assert live.State.Running
                assert live.Id != final.Id
                _ = (directory / "actual-owner-death.json").write_text(
                    json.dumps(
                        {
                            "stage": stage,
                            "full_id": final.Id,
                            "sentinel_id": live.Id,
                            "elapsed_seconds": monotonic() - before,
                            "owner_request_delivered": stage == "compose-active",
                            "artifact_custody": "retained-original-home-after-proved-stop",
                        }
                    )
                )
                _ = recover(docker, final.Id)
                own_tree(workspace / "print-production", 0, 0)
            finally:
                if process.poll() is None:
                    process.kill()
                _ = process.wait(timeout=5)
        sentinel.release()
        assert sentinel.result() == 0


@pytest.mark.parametrize("operation", ["cancel", "deadline", "quarantine"])
def test_actual_owner_interruption_preserves_custody(
    verified_print_workspace: Path, tmp_path: Path, operation: str
) -> None:
    assert verified_print_workspace.is_dir()
    workspace = workspace_at((tmp_path / "workspace").resolve(), browser_in_container=True)
    home = new_home(tmp_path)
    evidence = Path(os.environ["IE_PRINT_EVIDENCE"]) / "exec-interruptions" / operation
    config = WorkerConfiguration(
        workspace=workspace,
        home=home,
        producer=Path(os.environ["IE_PRINT_SOURCE"]),
        evidence=evidence,
        daemon_failure=operation == "quarantine",
    )
    path = tmp_path / "worker.json"
    _ = path.write_text(config.model_dump_json())
    with subprocess.Popen(  # noqa: S603 - fixed original-owner test creator
        (sys.executable, "-m", "component_tests.guarded_print_worker", str(path)),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ) as process:
        try:
            advance(process, "owner-awaiting-request")
            if operation == "cancel":
                process.send_signal(signal.SIGTERM)
            elif operation == "quarantine":
                assert process.stdin is not None
                _ = process.stdin.write(b"continue\n")
                process.stdin.flush()
            assert process.wait(timeout=36) == 1
            directories = tuple(evidence.glob("ie-lifetime-*"))
            assert len(directories) == 1
            directory = directories[0]
            receipt = TypeAdapter(dict[str, object]).validate_json(
                (directory / "invocation.json").read_bytes()
            )
            assert receipt["backend"] == "guarded-print-development"
            assert receipt["acceptance"] == "blocked"
            assert receipt["clients_reaped"] is True
            if operation == "quarantine":
                assert receipt["namespace_stopped_and_removed"] is False
                assert not home.exists()
                retained = directory / "quarantined-home"
                assert (retained / "stdout").read_bytes() == b""
                assert tuple((retained / "artifacts").glob("pp-*/evaluation.json"))
                assert (directory / "quarantine.json").is_file()
                lifetime = Configuration.model_validate_json(
                    (directory / "configuration.json").read_bytes()
                )
                docker = PrintDocker(
                    lifetime,
                    monotonic() + 5,
                    workspace / "print-production",
                    workspace / "integration-evals",
                    home,
                )
                inspection = docker.inspect(lifetime.name)
                assert not inspection.State.Running
                _ = recover(docker, inspection.Id)
                own_tree(workspace / "print-production", 0, 0)
            else:
                assert receipt["namespace_stopped_and_removed"] is True
                assert home.exists()
                assert (home / "stdout").read_bytes() == b""
                assert not (directory / "quarantine.json").exists()
        finally:
            if process.poll() is None:
                process.kill()
            _ = process.wait(timeout=5)


def test_guarded_receipts_bind_every_published_response(verified_print_workspace: Path) -> None:
    assert verified_print_workspace.is_dir()
    root = Path(os.environ["IE_PRINT_EVIDENCE"]) / "guarded-invocations"
    receipts = tuple(root.glob("ie-lifetime-*/invocation.json"))
    assert len(receipts) >= 20
    identities: set[str] = set()
    for path in receipts:
        receipt = TypeAdapter(dict[str, object]).validate_json(path.read_bytes())
        assert receipt["backend"] == "guarded-print-development"
        assert receipt["acceptance"] == "blocked"
        assert receipt["clients_reaped"] is True
        assert receipt["namespace_stopped_and_removed"] is True
        assert receipt["error"] is None
        identity = receipt["full_id"]
        assert isinstance(identity, str)
        assert len(identity) == 64
        assert identity not in identities
        identities.add(identity)
        assert (path.parent / "print-owner-binding.json").is_file()
        assert (path.parent / "owner/request-binding.json").is_file()
