"""Authenticate and pause the real owner while its canonical attempt is still pending."""

import json
import os
import signal
import subprocess
import sys
from pathlib import Path
from time import monotonic, sleep

from pydantic import JsonValue, TypeAdapter

from component_tests.container_docker import Docker
from component_tests.container_pidfd import send_pidfd_signal
from component_tests.container_records import Observation
from component_tests.guarded_identity import OwnerBinding, authenticate_owner
from integration_evals.artifacts import digest, read_bytes

STEP_QUANTUM = 0.020


def phase(docker: Docker, name: str, owner: OwnerBinding, state: str | None = None) -> None:
    """Keep one bounded root-side phase marker without owner data or exception text."""
    if monotonic() >= docker.deadline:
        raise subprocess.TimeoutExpired(("compose-active",), 30)
    _ = (docker.configuration.directory / "compose-phase.json").write_text(
        json.dumps(
            {
                "phase": name,
                "host_owner_pid": owner.host_owner.pid,
                "state": state,
                "quantum_seconds": STEP_QUANTUM,
            }
        )
    )


def stopped_owner(docker: Docker, binding: OwnerBinding, descriptor: int) -> Observation:
    current = authenticate_owner(binding, descriptor, docker.configuration.owner, docker.deadline)
    while current.status["State"].split()[0] != "T":
        phase(docker, "awaiting-stopped-state", binding, current.status["State"][:64])
        # Uninterruptible disk IO can delay an already-pending stop signal.
        # D is only a waiting state: no SQL/phase proof occurs until authenticated T.
        assert current.status["State"].split()[0] in {"R", "S", "D"}
        if monotonic() >= docker.deadline:
            raise subprocess.TimeoutExpired(("compose-stop",), 30)
        sleep(0.0001)
        current = authenticate_owner(
            binding, descriptor, docker.configuration.owner, docker.deadline
        )
    return current


def step_owner(docker: Docker, binding: OwnerBinding, descriptor: int) -> Observation:
    """Pulse the same held task reference from a fully authenticated stopped state."""
    current = authenticate_owner(binding, descriptor, docker.configuration.owner, docker.deadline)
    assert current.status["State"].split()[0] == "T"
    remaining = docker.deadline - monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired(("compose-active",), 30)
    send_pidfd_signal(descriptor, signal.SIGCONT)
    # No numeric PID, reopen, or /proc round trip while the original task runs.
    # A dead held task raises ESRCH; it is never rebound to a replacement process.
    sleep(min(STEP_QUANTUM, remaining))
    send_pidfd_signal(descriptor, signal.SIGSTOP)
    return stopped_owner(docker, binding, descriptor)


def positive_key(docker: Docker, binding: OwnerBinding) -> tuple[str, dict[str, str]]:
    assert binding.command[1] == "dist/tests/fixtures/integration-evals/positive-control.js"
    launch = TypeAdapter(dict[str, JsonValue]).validate_json(
        read_bytes(
            docker.configuration.directory / "launch/launch.json",
            max_bytes=65536,
            deadline=docker.deadline,
        )
    )
    checkout = launch["checkout"]
    assert isinstance(checkout, str)
    fixture = (
        Path(checkout)
        / "node_modules/@jevelopers/shared-contracts/fixtures/ComposeArtifactRequest.json"
    )
    assert fixture.resolve(strict=True) == fixture
    # The unchanged pinned 0.9.7 fixture is 225610 bytes; keep a finite bound.
    raw = read_bytes(fixture, max_bytes=256 * 1024, deadline=docker.deadline)
    payload = TypeAdapter(dict[str, JsonValue]).validate_json(raw)
    valid = TypeAdapter(dict[str, JsonValue]).validate_python(payload["valid"])
    key = valid["idempotency_key"]
    assert isinstance(key, str)
    assert 0 < len(key) <= 128
    return key, {
        "path": str(fixture),
        "sha256": digest(raw),
        "kind": "immutable-original-owner-fixture",
    }


def stop_active(docker: Docker, identity: str, namespace: str, home: Path, descriptor: int) -> None:
    """Keep the bound Node stopped only after an unfinished real compose is observed."""
    sampling_started = monotonic()
    samples = 0
    binding = OwnerBinding.model_validate_json(
        read_bytes(
            docker.configuration.directory / "print-owner-binding.json",
            max_bytes=65536,
            deadline=docker.deadline,
        )
    )
    phase(docker, "initial-authentication", binding)
    _ = authenticate_owner(binding, descriptor, docker.configuration.owner, docker.deadline)
    phase(docker, "original-fixture-key", binding)
    key, key_source = positive_key(docker, binding)
    artifact = home / "artifacts" / f"pp-{namespace}"
    database = artifact / "state.sqlite"
    pre_dispatch = TypeAdapter(dict[str, JsonValue]).validate_json(
        read_bytes(
            docker.configuration.directory / "pre-dispatch.json",
            max_bytes=65536,
            deadline=docker.deadline,
        )
    )
    sources = TypeAdapter(dict[str, str]).validate_python(pre_dispatch["source_files"])
    _ = (docker.configuration.directory / "database-binding.json").write_text(
        json.dumps(
            {
                "database_path": str(database),
                "command": binding.command,
                "owner_script_sha256": pre_dispatch["owner_script_sha256"],
                "request_sha256": pre_dispatch["request_sha256"],
                "key_source": key_source,
                "route_sources": {
                    name: sources[name]
                    for name in (
                        "scripts/integration-evals/protocol.ts",
                        "tests/fixtures/integration-evals/host.ts",
                        "tests/fixtures/integration-evals/positive-control.ts",
                    )
                },
            }
        )
    )
    info = read_bytes(
        Path(f"/proc/self/fdinfo/{descriptor}"), max_bytes=65536, deadline=docker.deadline
    )
    # Original positive-control creates the real source DB, but no mapping artifact.
    # WAL readiness only starts sampling; it does not establish a started compose.
    phase(docker, "wal-readiness", binding)
    while not Path(str(database) + "-wal").exists():
        if monotonic() >= docker.deadline:
            raise subprocess.TimeoutExpired(("compose-active",), 30)
        sleep(0.0001)
    phase(docker, "before-stop-authentication", binding)
    _ = authenticate_owner(binding, descriptor, docker.configuration.owner, docker.deadline)
    send_pidfd_signal(descriptor, signal.SIGSTOP)
    phase(docker, "after-stop-authentication", binding)
    current = stopped_owner(docker, binding, descriptor)
    while True:
        if monotonic() >= docker.deadline:
            raise subprocess.TimeoutExpired(("compose-active",), 30)
        assert current.status["State"].split()[0] == "T"
        phase(docker, "sqlite-observation", binding, current.status["State"][:64])
        raw = docker.run(
            (
                "exec",
                "--user",
                docker.configuration.owner.docker_user,
                identity,
                str(Path(sys.base_prefix) / "bin/python3.13"),
                "-B",
                "-m",
                "component_tests.guarded_compose_probe",
                str(database),
                str(docker.deadline),
                key,
            )
        )
        attempt = TypeAdapter(dict[str, JsonValue]).validate_json(raw)
        samples += 1
        with (docker.configuration.directory / "compose-probes.jsonl").open("a") as progress:
            _ = progress.write(
                json.dumps(
                    {
                        "host_owner_pid": current.pid,
                        "state": current.status["State"],
                        "pending": attempt["pending"],
                        "phase": attempt.get("phase"),
                        "expected_operation_rows": attempt.get("expected_operation_rows"),
                        "attempt_rows": attempt.get("attempt_rows"),
                        "operations_total_capped2": attempt.get("operations_total_capped2"),
                        "attempts_total_capped2": attempt.get("attempts_total_capped2"),
                        "database_inode": attempt.get("database_inode"),
                        "wal_inode": attempt.get("wal_inode"),
                        "shm_inode": attempt.get("shm_inode"),
                        "sample": samples,
                        "quantum_seconds": STEP_QUANTUM,
                        "elapsed_seconds": monotonic() - sampling_started,
                    }
                )
                + "\n"
            )
        if attempt["pending"] is True:
            _ = (docker.configuration.directory / "active-compose.json").write_text(
                json.dumps(
                    {
                        "full_id": identity,
                        "host_owner": current.model_dump(),
                        "attempt": attempt,
                        "request_delivered": True,
                        "owner_path": "original-positive-control",
                        "command": binding.command,
                        "key_source": key_source,
                        "qualification": "synthetic offline/simulated; no real authority",
                        "samples": samples,
                        "quantum_seconds": STEP_QUANTUM,
                        "elapsed_seconds": monotonic() - sampling_started,
                        "pidfd_target": str(Path(f"/proc/self/fd/{descriptor}").readlink()),
                        "pidfd_fdinfo": info.decode(),
                        "pidfd_inheritable": os.get_inheritable(descriptor),
                        "signal": "SIGSTOP",
                        "observer_surface": "same-nonroot-container",
                    },
                    indent=2,
                )
            )
            return
        phase(docker, "before-continue-authentication", binding, current.status["State"][:64])
        current = step_owner(docker, binding, descriptor)
