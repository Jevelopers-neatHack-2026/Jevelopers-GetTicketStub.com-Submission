from typing import ClassVar, Literal, assert_never

from pydantic import ConfigDict

from component_tests.retrieval_budget_checks import BudgetCapture
from component_tests.retrieval_concurrency_checks import ConcurrencyCapture
from component_tests.retrieval_dns_records import DnsCapture
from component_tests.retrieval_handshake_checks import HandshakeCapture
from component_tests.retrieval_resolver_checks import Mutation, ResolverCapture
from component_tests.retrieval_tls_checks import TlsCapture
from integration_evals.artifacts import digest
from integration_evals.models import CaseResult, Digest, Outcome, Record


class Attempt(Record):
    id: str
    code: str
    known_bytes: bool
    protected_connections: int
    protected_requests: int
    allowed_connections: int
    allowed_requests: int


class WireAttempt(Record):
    id: Literal["at-limit", "over-limit"]
    code: str
    fixture_bytes: int
    fixture_sha256: Digest
    returned_bytes: int | None
    returned_sha256: Digest | None
    connections: int
    requests: int
    response_closes: int
    connection_closes: int
    transfer_chunked: bool | None
    content_identity: bool | None
    content_length_present: bool | None


class WireCapture(Record):
    fixture_mode: Literal["source-only-localTestSeam"]
    wire_bytes_per_request: int
    decoded_text_bytes_per_request: int
    decoded_bytes_per_run: int
    fresh_fetcher_per_request: Literal[True]
    rows: tuple[WireAttempt, WireAttempt]
    passed: bool
    capture_scope: str


class Capture(Record):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, strict=True, extra="ignore")
    network_namespace: str
    rows: tuple[Attempt, ...]
    uncovered: tuple[str, ...]
    chunked_wire: WireCapture
    resolver_inputs: ResolverCapture
    resource_budgets: BudgetCapture
    concurrency: ConcurrencyCapture
    tls_redirects: TlsCapture
    handshake_deadline: HandshakeCapture
    dns_wire: DnsCapture


def assert_observed_outcome(selected: CaseResult, capture: Capture, mutation: Mutation) -> None:
    baseline = next(row for row in capture.rows if row.id == "allowed")
    wire = capture.chunked_wire
    at_limit, over_limit = wire.rows
    limit = 10 * 1024 * 1024
    assert wire.wire_bytes_per_request == limit
    assert (at_limit.id, over_limit.id) == ("at-limit", "over-limit")
    assert (at_limit.fixture_bytes, over_limit.fixture_bytes) == (limit, limit + 1)
    assert at_limit.fixture_sha256 == digest(b"b" * limit)
    assert over_limit.fixture_sha256 == digest(b"b" * (limit + 1))
    assert limit + 1 < wire.decoded_text_bytes_per_request
    assert limit + 1 < wire.decoded_bytes_per_run
    match mutation:
        case "always-reject":
            assert selected.outcome is Outcome.FAILED
            assert baseline.code == "POLICY_DENIED"
            assert baseline.allowed_connections == 0
            assert wire.passed is False
            assert all(row.connections == 0 for row in wire.rows)
            return
        case "baseline":
            assert selected.outcome is Outcome.PASSED, selected.reason
            assert baseline.known_bytes
            assert baseline.allowed_requests == 1
            assert all(row.protected_connections == 0 for row in capture.rows)
        case "unchecked-private":
            assert selected.outcome is Outcome.FAILED
            assert any(row.protected_connections > 0 for row in capture.rows)
        case (
            "unchecked-wire"
            | "cached-resolution"
            | "first-answer-only"
            | "unchecked-alias"
            | "unchecked-ip-alias"
            | "unchecked-gzip-wire"
            | "unchecked-aggregate"
            | "extra-slot"
            | "unchecked-tls-hostname"
            | "unchecked-tls-trust"
            | "early-handshake-deadline"
            | "unchecked-dns-addresses"
            | "unchecked-dns-cname"
            | "unchecked-dns-id"
        ):
            assert selected.outcome is Outcome.FAILED
        case _:
            assert_never(mutation)
    for row in wire.rows:
        assert (row.connections, row.requests, row.response_closes, row.connection_closes) == (
            1,
            1,
            1,
            1,
        )
        assert row.transfer_chunked is True
        assert row.content_identity is True
        assert row.content_length_present is False
    assert at_limit.code == "accepted"
    assert at_limit.returned_bytes == limit
    assert at_limit.returned_sha256 == at_limit.fixture_sha256
    match mutation:
        case "unchecked-wire":
            assert wire.passed is False
            assert over_limit.code == "accepted"
            assert over_limit.returned_bytes == limit + 1
            assert over_limit.returned_sha256 == over_limit.fixture_sha256
        case (
            "baseline"
            | "unchecked-private"
            | "cached-resolution"
            | "first-answer-only"
            | "unchecked-alias"
            | "unchecked-ip-alias"
            | "unchecked-gzip-wire"
            | "unchecked-aggregate"
            | "extra-slot"
            | "unchecked-tls-hostname"
            | "unchecked-tls-trust"
            | "early-handshake-deadline"
            | "unchecked-dns-addresses"
            | "unchecked-dns-cname"
            | "unchecked-dns-id"
        ):
            assert wire.passed is True
            assert over_limit.code == "RESOURCE_LIMIT"
            assert over_limit.returned_bytes is None
        case _:
            assert_never(mutation)
