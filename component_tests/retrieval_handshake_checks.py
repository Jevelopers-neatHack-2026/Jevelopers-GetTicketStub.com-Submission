from typing import Literal, assert_never

from component_tests.retrieval_resolver_checks import Mutation
from integration_evals.models import Record


class HandshakeCapture(Record):
    fixture_mode: Literal["source-only-localTestSeam-raw-tcp"]
    code: str
    returned_bytes: int | None
    connect_milliseconds: int
    total_milliseconds: int
    window_min_ms: int
    window_max_ms: int
    connections: int
    socket_closes: int
    socket_errors: int
    received_bytes: int
    sent_bytes: int
    stage_reached: bool
    connected_at_ms: float | None
    first_client_bytes_at_ms: float | None
    outcome_elapsed_ms: float
    peer_closed_at_ms: float | None
    passed: bool
    capture_scope: str


def assert_handshake(capture: HandshakeCapture, mutation: Mutation) -> None:
    assert (capture.connect_milliseconds, capture.total_milliseconds) == (10000, 30000)
    assert (capture.window_min_ms, capture.window_max_ms) == (9900, 20000)
    match mutation:
        case "always-reject":
            assert capture.passed is capture.stage_reached is False
            assert capture.code == "POLICY_DENIED"
            assert capture.connections == capture.received_bytes == capture.sent_bytes == 0
            assert capture.connected_at_ms is capture.first_client_bytes_at_ms is None
            assert capture.peer_closed_at_ms is None
            return
        case "early-handshake-deadline":
            assert capture.passed is False
            assert 0 < capture.outcome_elapsed_ms < capture.window_min_ms
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
            | "extra-slot"
            | "unchecked-tls-hostname"
            | "unchecked-tls-trust"
        ):
            assert capture.passed is True
            assert capture.window_min_ms <= capture.outcome_elapsed_ms <= capture.window_max_ms
        case _:
            assert_never(mutation)
    assert capture.stage_reached is True
    assert capture.code == "DEADLINE_EXCEEDED"
    assert capture.returned_bytes is None
    assert (capture.connections, capture.socket_closes, capture.sent_bytes) == (1, 1, 0)
    assert capture.received_bytes > 0
    assert capture.connected_at_ms is not None
    assert capture.first_client_bytes_at_ms is not None
    assert capture.peer_closed_at_ms is not None
    assert (
        0
        <= capture.connected_at_ms
        <= capture.first_client_bytes_at_ms
        < capture.outcome_elapsed_ms
    )
    assert capture.peer_closed_at_ms >= capture.first_client_bytes_at_ms
