import fcntl
import os
import signal
import subprocess
import sys
from _thread import LockType
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event, Lock, Thread
from time import monotonic

import pytest

from integration_evals.processes import ProcessSettings, invoke
from tests.fixtures.process_cancel import (
    LEASE_OBSERVATION_SECONDS,
    WATCHDOG_SECONDS,
    CancellationTrace,
    Gate,
    LeaseObservation,
    Ready,
    Role,
    write_value,
)


@pytest.mark.parametrize("finish", ["success", "timeout"])
@pytest.mark.parametrize("detached", [False, True])
@pytest.mark.parametrize("depth", [1, 2])
def test_descendants_stop_when_owner_invocation_ends(
    tmp_path: Path, finish: str, depth: int, *, detached: bool
) -> None:
    # Given an owner attempting to create a descendant that outlives its leader.
    marker = tmp_path / "survived"
    child = (
        "from pathlib import Path; import time; "
        f"print('ready',flush=True); time.sleep(1); Path({str(marker)!r}).write_text('survived')"
    )
    if depth == 2:
        child = (
            "import subprocess,sys; "
            f"p=subprocess.Popen([sys.executable,'-c',{child!r}],"
            "start_new_session=True,stdout=subprocess.PIPE); "
            "print(p.stdout.readline().decode().strip(),flush=True)"
        )
    program = "\n".join(
        (
            "import subprocess,sys,signal",
            "try:",
            (
                f" child=subprocess.Popen([sys.executable,'-c',{child!r}],"
                f"start_new_session={detached!r},stdout=subprocess.PIPE)"
            ),
            " child.stdout.readline()",
            " print('spawned',flush=True)",
            "except PermissionError:",
            " print('fork-denied',flush=True)",
            "signal.pause()" if finish == "timeout" else "sys.exit(0)",
        )
    )
    output = tmp_path / "stdout"
    with output.open("w+b") as handle:
        settings = ProcessSettings(tmp_path, os.environ, b"", handle, 0.25)
        # When the owner finishes or reaches its deadline.
        if finish == "timeout":
            with pytest.raises(subprocess.TimeoutExpired):
                _ = invoke((sys.executable, "-c", program), settings)
        else:
            assert invoke((sys.executable, "-c", program), settings) == 0
    # Then Linux children cannot survive namespace teardown; macOS denies all forks.
    expected = "fork-denied" if sys.platform == "darwin" else "spawned"
    assert output.read_text(encoding="utf-8").strip() == expected
    _ = Event().wait(1.1)
    assert not marker.exists()


def lease_available(path: Path) -> bool:
    with path.open("r+b") as lease:
        try:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        fcntl.flock(lease, fcntl.LOCK_UN)
        return True


@dataclass(frozen=True, slots=True)
class Observer:
    root: Path
    deadline: float
    stop: Event = field(default_factory=Event)
    armed: Event = field(default_factory=Event)
    dispatch_lock: LockType = field(default_factory=Lock)
    events: list[str] = field(default_factory=list)
    joined: Event = field(default_factory=Event)
    lease_observations: list[LeaseObservation] = field(default_factory=list)


def wait_observation(observer: Observer, predicate: Callable[[], bool]) -> bool:
    while not observer.stop.is_set() and monotonic() < observer.deadline:
        if predicate():
            return True
        _ = observer.stop.wait(0.01)
    return False


def cancel_after_probe(observer: Observer) -> None:
    root = observer.root
    if not wait_observation(
        observer, lambda: (root / "owner.json").exists() and (root / "observer.json").exists()
    ):
        observer.events.append("readiness-unavailable")
        return
    observer.events.append("owner-and-observer-ready")
    if lease_available(root / "lease"):
        observer.events.append("lifetime-lease-not-held")
        return
    observer.events.append("lifetime-lease-held")
    write_value(root / "gate", Gate.PROBE.value)
    if not wait_observation(
        observer, lambda: (root / "sentinel").read_text(encoding="utf-8") == "probe-confirmed"
    ):
        observer.events.append("probe-unavailable")
        return
    observer.events.append("same-sentinel-probe-confirmed")
    with observer.dispatch_lock:
        if observer.armed.is_set() and monotonic() < observer.deadline:
            observer.events.append("native-interrupt-dispatched")
            os.kill(os.getpid(), signal.SIGINT)


def invoke_observed(settings: ProcessSettings, observer: Observer, depth: int) -> None:
    fixture = Path(__file__).parent / "fixtures/process_cancel.py"
    thread = Thread(target=cancel_after_probe, args=(observer,), daemon=True)
    observer.armed.set()
    thread.start()
    try:
        _ = invoke(
            (sys.executable, str(fixture), str(observer.root), str(depth), "owner"), settings
        )
    except KeyboardInterrupt:
        observer.events.append("invoke-interrupted")
        raise
    finally:
        with observer.dispatch_lock:
            observer.armed.clear()
        observer.stop.set()
        thread.join(timeout=3)
        if not thread.is_alive():
            observer.joined.set()
            observer.events.append("observer-joined")
        assert not thread.is_alive()


def assert_fixture_scope(root: Path, depth: int, events: list[str]) -> None:
    ready = Ready.model_validate_json((root / "observer.json").read_bytes())
    if sys.platform == "darwin":
        assert (root / "fork-denied").read_text(encoding="utf-8") == "process-fork rejected"
        assert ready.role is Role.OWNER
        assert not (root / "leaf.json").exists()
        events.append("macos-owner-only-fork-denial")
    else:
        assert ready.role is Role.LEAF
        assert ready.session_leader
        if depth == 2:
            branch = Ready.model_validate_json((root / "branch.json").read_bytes())
            assert branch.session_leader
        events.append("linux-detached-observer-lease-closed")


def observe_natural_lease_release(observer: Observer) -> bool:
    assert (observer.root / "gate").read_text(encoding="utf-8") == Gate.PROBE.value
    started = monotonic()
    deadline = started + LEASE_OBSERVATION_SECONDS
    observer.events.append("unassisted-lease-observation-started")

    def sample() -> bool:
        available = lease_available(observer.root / "lease")
        elapsed = monotonic() - started
        observer.lease_observations.append(
            LeaseObservation(elapsed_seconds=elapsed, available=available)
        )
        return available and elapsed <= LEASE_OBSERVATION_SECONDS

    released = wait_observation(Observer(observer.root, deadline), sample)
    assert (observer.root / "gate").read_text(encoding="utf-8") == Gate.PROBE.value
    observer.events.append(
        "natural-lease-closure-observed" if released else "natural-lease-closure-deadline"
    )
    return released


def cleanup_trace(observer: Observer, depth: int) -> CancellationTrace:
    root = observer.root
    with observer.dispatch_lock:
        observer.armed.clear()
    observer.stop.set()
    write_value(root / "gate", Gate.QUIT.value)
    cleanup = Observer(root, monotonic() + LEASE_OBSERVATION_SECONDS)
    released = (
        wait_observation(cleanup, lambda: lease_available(root / "lease"))
        if (root / "lease").exists()
        else None
    )
    trace = CancellationTrace(
        platform=sys.platform,
        depth=depth,
        readiness=tuple(
            Ready.model_validate_json(path.read_bytes())
            for path in (root / "owner.json", root / "branch.json", root / "leaf.json")
            if path.exists()
        ),
        observer=Ready.model_validate_json((root / "observer.json").read_bytes())
        if (root / "observer.json").exists()
        else None,
        events=tuple(observer.events),
        stdout=(root / "stdout").read_text(encoding="utf-8"),
        marker=(root / "sentinel").read_text(encoding="utf-8")
        if (root / "sentinel").exists()
        else "unreached",
        observer_thread_stopped=observer.joined.is_set(),
        cleanup_lease_released=released,
        natural_lease_observations=tuple(observer.lease_observations),
        natural_lease_observed="natural-lease-closure-observed" in observer.events,
    )
    _ = (root / "cancellation-trace.json").write_text(
        trace.model_dump_json(indent=2), encoding="utf-8"
    )
    return trace


@pytest.mark.parametrize("depth", [1, 2])
def test_process_namespace_stops_when_invocation_is_cancelled(
    tmp_path: Path, depth: int, record_testsuite_property: Callable[[str, str], None]
) -> None:
    # Given a detached observer that proves readiness, writability and a live lifetime lease.
    output = tmp_path / "stdout"
    events: list[str] = []
    observer = Observer(tmp_path, monotonic() + 2, events=events)
    started = monotonic()
    try:
        with output.open("w+b") as handle:
            settings = ProcessSettings(
                tmp_path, os.environ, b"", handle, 3, offline=True, writable_directory=tmp_path
            )
            # When readiness and a successful in-boundary probe cause native cancellation.
            with pytest.raises(KeyboardInterrupt):
                invoke_observed(settings, observer, depth)
        # Then the actual lease is released before any cooperative fixture cleanup.
        assert observer.joined.is_set()
        assert monotonic() - started + LEASE_OBSERVATION_SECONDS < WATCHDOG_SECONDS
        assert events == [
            "owner-and-observer-ready",
            "lifetime-lease-held",
            "same-sentinel-probe-confirmed",
            "native-interrupt-dispatched",
            "invoke-interrupted",
            "observer-joined",
        ]
        assert observe_natural_lease_release(observer)
        assert monotonic() - started < WATCHDOG_SECONDS
        events.append("lifetime-lease-reacquired-after-invoke")
        write_value(tmp_path / "gate", Gate.RELEASE.value)
        assert (tmp_path / "sentinel").read_text(encoding="utf-8") == "probe-confirmed"
        assert_fixture_scope(tmp_path, depth, events)
    finally:
        trace = cleanup_trace(observer, depth)
        record_testsuite_property(f"process-cancellation-depth-{depth}", trace.model_dump_json())
        assert trace.cleanup_lease_released is not False
        assert trace.observer_thread_stopped
