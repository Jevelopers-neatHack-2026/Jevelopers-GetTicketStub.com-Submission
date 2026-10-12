"""Authenticate and pause the real owner while its canonical attempt is still pending."""

import json
import os
import signal
import subprocess
import sys
from pathlib import Path
from time import monotonic, sleep

from pydantic import BaseModel, JsonValue, TypeAdapter

from component_tests.container_docker import Docker
from component_tests.container_facts import facts
from component_tests.container_pidfd import open_pidfd, send_pidfd_signal
from component_tests.container_records import Observation, require_role
from integration_evals.artifacts import read_bytes


class Binding(BaseModel):
    host_owner: Observation


def stop_active(docker: Docker, identity: str, namespace: str, home: Path) -> None:
    """Keep the bound Node stopped only after an unfinished real compose is observed."""
    binding = Binding.model_validate_json(
        read_bytes(
            docker.configuration.directory / "print-owner-binding.json",
            max_bytes=65536,
            deadline=docker.deadline,
        )
    )
    owner = binding.host_owner
    artifact = home / "artifacts" / f"pp-{namespace}"
    database = artifact / "state.sqlite"
    with os.fdopen(open_pidfd(owner.pid), "rb", buffering=0) as handle:
        info = read_bytes(
            Path(f"/proc/self/fdinfo/{handle.fileno()}"), max_bytes=65536, deadline=docker.deadline
        )
        assert (
            int(dict(line.split(b":", 1) for line in info.splitlines())[b"Pid"].strip())
            == owner.pid
        )
        # Mapping is written by the original CLI just before its actual compose call.
        while not (artifact / "mapping.json").exists():
            if monotonic() >= docker.deadline:
                raise subprocess.TimeoutExpired(("compose-active",), 30)
            sleep(0.0001)
        while True:
            if monotonic() >= docker.deadline:
                raise subprocess.TimeoutExpired(("compose-active",), 30)
            send_pidfd_signal(handle.fileno(), signal.SIGSTOP)
            current = Observation.model_validate(facts(owner.pid))
            while current.status["State"].split()[0] != "T":
                assert current.status["State"].split()[0] in {"R", "S"}
                if monotonic() >= docker.deadline:
                    raise subprocess.TimeoutExpired(("compose-stop",), 30)
                sleep(0.0001)
                current = Observation.model_validate(facts(owner.pid))
            require_role(current, docker.configuration.owner)
            assert current.namespaces == owner.namespaces
            assert current.cgroup == owner.cgroup
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
                            "pidfd_target": str(
                                Path(f"/proc/self/fd/{handle.fileno()}").readlink()
                            ),
                            "pidfd_fdinfo": info.decode(),
                            "pidfd_inheritable": os.get_inheritable(handle.fileno()),
                            "signal": "SIGSTOP",
                            "observer_surface": "same-nonroot-container",
                        },
                        indent=2,
                    )
                )
                return
            send_pidfd_signal(handle.fileno(), signal.SIGCONT)
            sleep(0.0001)
