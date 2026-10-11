from typing import Literal, assert_never

from component_tests.retrieval_resolver_checks import Mutation
from integration_evals.artifacts import digest
from integration_evals.models import Digest, Record


class LifecycleEvent(Record):
    id: str
    event: Literal[
        "invoke",
        "invoke-live",
        "invoke-aborted",
        "admit",
        "http",
        "release",
        "response-finish",
        "response-close",
        "socket-close",
        "result",
        "abort",
        "checkpoint",
        "first-wave-http",
        "settled-before-release",
    ]


class LifecycleResult(Record):
    id: str
    code: str
    returned_bytes: int | None
    returned_sha256: Digest | None


class LifecycleCapture(Record):
    rows: tuple[LifecycleResult, ...]
    events: tuple[LifecycleEvent, ...]
    admissions: tuple[str, ...]
    connections: int
    requests: int
    response_closes: int
    socket_closes: int
    peak_http: int
    active_http: int
    passed: bool


class ParallelCapture(LifecycleCapture):
    admission_snapshot: tuple[str, ...]
    headers_withheld: bool


class ActiveCapture(LifecycleCapture):
    stage_reached: bool
    headers_withheld: bool


class QueuedCapture(ActiveCapture):
    queued_admitted: bool


class ConcurrencyCapture(Record):
    fixture_mode: Literal["source-only-localTestSeam"]
    concurrent_fetches: int
    parallel: ParallelCapture
    queued: QueuedCapture
    active: ActiveCapture
    passed: bool
    capture_scope: str


def event_index(capture: LifecycleCapture, identifier: str, event: str) -> int:
    return next(
        index
        for index, row in enumerate(capture.events)
        if row.id == identifier and row.event == event
    )


def assert_closed_bodies(capture: LifecycleCapture, canceled: str | None, requests: int) -> None:
    assert (
        capture.connections,
        capture.requests,
        capture.response_closes,
        capture.socket_closes,
    ) == (requests,) * 4
    assert capture.active_http == 0
    body = b"controlled concurrency bytes"
    for row in capture.rows:
        accepted = row.id != canceled
        assert row.code == ("accepted" if accepted else "CANCELED")
        assert row.returned_bytes == (len(body) if accepted else None)
        assert row.returned_sha256 == (digest(body) if accepted else None)


def assert_parallel(capture: ParallelCapture, extra_slot: bool) -> None:
    assert capture.passed is (not extra_slot)
    assert capture.headers_withheld is True
    assert capture.peak_http == (5 if extra_slot else 4)
    assert len(capture.admission_snapshot) == capture.peak_http
    assert {row.id for row in capture.rows} == {f"parallel-{index}" for index in range(8)}
    assert_closed_bodies(capture, None, 8)
    checkpoint = event_index(capture, "parallel", "checkpoint")
    gate = event_index(capture, "parallel", "first-wave-http")
    assert checkpoint < gate
    assert tuple(row.id for row in capture.events[:checkpoint] if row.event == "admit") == (
        capture.admission_snapshot
    )
    assert sum(row.event == "http" for row in capture.events[:gate]) == capture.peak_http
    assert all(index > gate for index, row in enumerate(capture.events) if row.event == "release")


def assert_queued(capture: QueuedCapture, extra_slot: bool) -> None:
    assert capture.stage_reached is True
    assert capture.headers_withheld is True
    assert capture.queued_admitted is extra_slot
    assert capture.passed is (not extra_slot)
    assert capture.peak_http == (5 if extra_slot else 4)
    assert {row.id for row in capture.rows} == {
        "hold-0",
        "hold-1",
        "hold-2",
        "hold-3",
        "queued",
        "survivor",
    }
    assert_closed_bodies(capture, "queued", 6 if extra_slot else 5)
    invoked = event_index(capture, "queued", "invoke-live")
    checkpoint = event_index(capture, "queued", "checkpoint")
    aborted = event_index(capture, "queued", "abort")
    settled = event_index(capture, "queued", "settled-before-release")
    assert invoked < checkpoint < aborted < event_index(capture, "queued", "result") < settled
    assert all(event_index(capture, f"hold-{index}", "http") < invoked for index in range(4))
    assert all(
        index > settled for index, row in enumerate(capture.events) if row.event == "release"
    )
    assert ("queued" in capture.admissions) is extra_slot
    queued_http = tuple(row for row in capture.events if row.id == "queued" and row.event == "http")
    assert len(queued_http) == int(extra_slot)
    if extra_slot:
        assert checkpoint < event_index(capture, "queued", "http") < aborted
        assert event_index(capture, "queued", "socket-close") < event_index(
            capture, "survivor", "invoke"
        )
    survivor = event_index(capture, "survivor", "result")
    assert event_index(capture, "survivor", "invoke") < event_index(capture, "hold-0", "release")
    assert all(survivor < event_index(capture, f"hold-{index}", "release") for index in (1, 2, 3))


def assert_active(capture: ActiveCapture) -> None:
    assert capture.stage_reached is True
    assert capture.headers_withheld is True
    assert capture.passed is True
    assert capture.peak_http == 1
    assert {row.id for row in capture.rows} == {"active", "followup"}
    assert_closed_bodies(capture, "active", 2)
    assert event_index(capture, "active", "invoke-live") < event_index(capture, "active", "http")
    assert event_index(capture, "active", "http") < event_index(capture, "active", "abort")
    assert event_index(capture, "active", "abort") < event_index(capture, "active", "result")
    assert event_index(capture, "active", "socket-close") < event_index(
        capture, "followup", "invoke"
    )
    assert not any(row.id == "active" and row.event == "release" for row in capture.events)


def assert_concurrency(capture: ConcurrencyCapture, mutation: Mutation) -> None:
    assert capture.concurrent_fetches == 4
    match mutation:
        case "always-reject":
            assert capture.passed is False
            assert capture.parallel.headers_withheld is False
            assert capture.queued.stage_reached is False
            assert capture.active.stage_reached is False
            for group in (capture.parallel, capture.queued, capture.active):
                assert group.passed is False
                assert group.admissions == ()
                assert group.connections == group.requests == 0
                assert all(row.code == "POLICY_DENIED" for row in group.rows)
            return
        case "extra-slot":
            extra_slot = True
        case (
            "baseline"
            | "unchecked-private"
            | "unchecked-wire"
            | "cached-resolution"
            | "first-answer-only"
            | "unchecked-alias"
            | "unchecked-ip-alias"
            | "unchecked-gzip-wire"
            | "unchecked-aggregate"
            | "unchecked-tls-hostname"
            | "unchecked-tls-trust"
            | "early-handshake-deadline"
        ):
            extra_slot = False
        case _:
            assert_never(mutation)
    assert capture.passed is (not extra_slot)
    assert_parallel(capture.parallel, extra_slot)
    assert_queued(capture.queued, extra_slot)
    assert_active(capture.active)
