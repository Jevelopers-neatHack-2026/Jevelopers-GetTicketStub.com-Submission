import json
import os
import platform
import select
import signal
from contextlib import ExitStack
from pathlib import Path
from time import monotonic

import pytest

from component_tests.container_binding import bind_owner
from component_tests.container_driver import driver
from component_tests.container_pidfd import open_pidfd
from component_tests.container_reap import recover
from component_tests.container_records import OwnerReceipt, Record


class Result(Record):
    outcome: str
    full_id: str | None
    acceptance: str


@pytest.mark.parametrize(
    "stage",
    [
        "create-client-launched",
        "created",
        "start-attach-client-launched",
        "lease-armed",
        "owner-detached",
    ],
)
def test_creator_sigkill_ends_only_its_namespace(stage: str) -> None:
    # Given an independent live sentinel and one invocation stopped at a lifecycle checkpoint.
    with driver() as sentinel, driver() as subject, ExitStack() as handles:
        _ = sentinel.advance("owner-detached")
        event = subject.advance(stage)
        observed_at = monotonic()
        client = (
            handles.enter_context(os.fdopen(open_pidfd(event.client_pid), "rb", buffering=0))
            if event.client_pid
            else None
        )
        if client is not None:
            pidfd = client.fileno()
            fdinfo = Path(f"/proc/self/fdinfo/{pidfd}").read_text()
            _ = (subject.configuration.directory / "pidfd-runtime.json").write_text(
                json.dumps(
                    {
                        "python_has_pidfd_open": hasattr(os, "pidfd_open"),
                        "libc": platform.libc_ver(),
                        "kernel": platform.release(),
                        "client_pid": event.client_pid,
                        "descriptor_target": str(Path(f"/proc/self/fd/{pidfd}").readlink()),
                        "fdinfo": fdinfo,
                        "inheritable": os.get_inheritable(pidfd),
                    }
                )
            )
            fields = dict(line.split(":", 1) for line in fdinfo.splitlines())
            assert int(fields["Pid"].strip()) == event.client_pid
            assert not os.get_inheritable(pidfd)
        # When only the captured creator PID receives SIGKILL.
        subject.process.kill()
        assert subject.result() == -signal.SIGKILL
        if client is not None:
            readable, _, _ = select.select([client], [], [], 5)
            assert readable, "Owned Docker client remained live after creator death"
        # Then the actual container is stopped/created, and the unrelated namespace survives.
        docker = subject.docker()
        inspected = docker.inspect(subject.configuration.name)
        if inspected.State.Running:
            _ = docker.run(("wait", inspected.Id))
        final = docker.inspect(inspected.Id)
        assert not final.State.Running
        assert monotonic() - observed_at <= 5
        sentinel_state = sentinel.docker().inspect(sentinel.configuration.name)
        assert sentinel_state.State.Running
        assert sentinel_state.Id != final.Id
        sentinel_owner = OwnerReceipt.model_validate_json(
            (sentinel.configuration.directory / "owner-receipt.json").read_bytes(),
        )
        bind_owner(sentinel.docker(), sentinel_state.Id, sentinel_owner)
        _ = (subject.configuration.directory / "death-observation.json").write_text(
            json.dumps(
                {
                    "stage": stage,
                    "stopped_id": final.Id,
                    "sentinel_id": sentinel_state.Id,
                    "elapsed_seconds": monotonic() - observed_at,
                }
            )
        )
        _ = recover(subject.docker(), inspected.Id)
        sentinel.release()
        assert sentinel.result() == 0


def test_normal_lease_release_ends_detached_owner() -> None:
    # Given a proved guard lease and a double-forked hostile owner with closed stdio.
    with driver() as subject:
        _ = subject.advance("owner-detached")
        # When the creator releases its only lease endpoint.
        subject.release()
        # Then the controller verifies namespace termination and removes only its captured ID.
        assert subject.result() == 0
        result = Result.model_validate_json(
            (subject.configuration.directory / "result.json").read_bytes()
        )
        assert result.outcome == "LIFETIME_PROBE_COMPLETED"
        assert result.acceptance == "blocked"


def test_handled_cancellation_ends_namespace() -> None:
    # Given an armed lease and detached owner.
    with driver() as subject:
        _ = subject.advance("owner-detached")
        # When the creator receives handled cancellation.
        subject.process.send_signal(signal.SIGTERM)
        # Then cancellation remains ERROR after confirmed teardown, with staging preserved.
        assert subject.result() == 1
        assert (subject.configuration.directory / "owner/owner.json").is_file()
        assert not (subject.configuration.directory / "quarantine.json").exists()


def test_original_deadline_ends_namespace() -> None:
    # Given a creator whose original 30-second budget includes create/start/validation.
    with driver() as subject:
        _ = subject.advance("owner-detached")
        # When no checkpoint continuation arrives before that original deadline.
        status = subject.result()
        # Then the timeout is ERROR with successful bounded namespace teardown.
        assert status == 1
        assert not (subject.configuration.directory / "quarantine.json").exists()


def test_unreachable_teardown_daemon_preserves_quarantine() -> None:
    # Given a real invocation and a teardown-only unreachable Docker socket.
    with driver(failure=True) as subject:
        _ = subject.advance("owner-detached")
        # When teardown cannot inspect through its selected endpoint.
        subject.release()
        # Then ERROR retains staging and the exact stopped container for independent recovery.
        assert subject.result() == 1
        assert (subject.configuration.directory / "quarantine.json").is_file()
        assert (subject.configuration.directory / "owner/owner.json").is_file()
        inspected = subject.docker().inspect(subject.configuration.name)
        assert not inspected.State.Running
        _ = recover(subject.docker(), inspected.Id)
