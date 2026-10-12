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
from component_tests.guarded_identity import OwnerBinding, authenticate_owner
from integration_evals.artifacts import digest, read_bytes


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
    binding = OwnerBinding.model_validate_json(
        read_bytes(
            docker.configuration.directory / "print-owner-binding.json",
            max_bytes=65536,
            deadline=docker.deadline,
        )
    )
    _ = authenticate_owner(binding, descriptor, docker.configuration.owner, docker.deadline)
    key, key_source = positive_key(docker, binding)
    artifact = home / "artifacts" / f"pp-{namespace}"
    database = artifact / "state.sqlite"
    info = read_bytes(
        Path(f"/proc/self/fdinfo/{descriptor}"), max_bytes=65536, deadline=docker.deadline
    )
    # Original positive-control creates the real source DB, but no mapping artifact.
    # WAL readiness only starts sampling; it does not establish a started compose.
    while not Path(str(database) + "-wal").exists():
        if monotonic() >= docker.deadline:
            raise subprocess.TimeoutExpired(("compose-active",), 30)
        sleep(0.0001)
    while True:
        if monotonic() >= docker.deadline:
            raise subprocess.TimeoutExpired(("compose-active",), 30)
        _ = authenticate_owner(binding, descriptor, docker.configuration.owner, docker.deadline)
        send_pidfd_signal(descriptor, signal.SIGSTOP)
        current = authenticate_owner(
            binding, descriptor, docker.configuration.owner, docker.deadline
        )
        while current.status["State"].split()[0] != "T":
            assert current.status["State"].split()[0] in {"R", "S"}
            if monotonic() >= docker.deadline:
                raise subprocess.TimeoutExpired(("compose-stop",), 30)
            sleep(0.0001)
            current = authenticate_owner(
                binding, descriptor, docker.configuration.owner, docker.deadline
            )
        assert current.status["State"].split()[0] == "T"
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
        with (docker.configuration.directory / "compose-probes.jsonl").open("a") as progress:
            _ = progress.write(
                json.dumps(
                    {
                        "host_owner_pid": current.pid,
                        "state": current.status["State"],
                        "pending": attempt["pending"],
                        "phase": attempt.get("phase"),
                        "database_inode": attempt.get("database_inode"),
                        "wal_inode": attempt.get("wal_inode"),
                        "shm_inode": attempt.get("shm_inode"),
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
        _ = authenticate_owner(binding, descriptor, docker.configuration.owner, docker.deadline)
        send_pidfd_signal(descriptor, signal.SIGCONT)
        sleep(0.0001)
