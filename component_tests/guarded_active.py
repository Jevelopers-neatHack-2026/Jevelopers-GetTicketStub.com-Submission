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
from integration_evals.artifacts import read_bytes


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
    artifact = home / "artifacts" / f"pp-{namespace}"
    database = artifact / "state.sqlite"
    info = read_bytes(
        Path(f"/proc/self/fdinfo/{descriptor}"), max_bytes=65536, deadline=docker.deadline
    )
    # Mapping is written by the original CLI just before its actual compose call.
    while not (artifact / "mapping.json").exists():
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
            )
        )
        attempt = TypeAdapter(dict[str, JsonValue]).validate_json(raw)
        if attempt["pending"] is True:
            _ = (docker.configuration.directory / "active-compose.json").write_text(
                json.dumps(
                    {
                        "full_id": identity,
                        "host_owner": current.model_dump(),
                        "attempt": attempt,
                        "request_delivered": True,
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
