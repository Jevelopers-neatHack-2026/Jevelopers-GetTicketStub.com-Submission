from typing import assert_never

from component_tests.retrieval_dns_packets import assert_dns_trace
from component_tests.retrieval_dns_records import DnsAttempt, DnsCapture, DnsResult
from component_tests.retrieval_resolver_checks import Mutation
from integration_evals.artifacts import digest


def expected_result(row: DnsAttempt) -> DnsResult:
    match row.id:
        case "udp-cname":
            return DnsResult(addresses=("8.8.8.8",), aliases=("alias.example.org",))
        case "tcp-public" | "wrong-tcp-id":
            return DnsResult(addresses=("9.9.9.9",))
        case "private-answer":
            return DnsResult(addresses=("10.0.0.7",))
        case "mixed-answer":
            return DnsResult(addresses=("8.8.8.8", "10.0.0.7"))
        case "forbidden-cname":
            return DnsResult(addresses=("8.8.8.8",), aliases=("private.internal",))
        case _:
            assert_never(row.id)


def assert_dns_row(row: DnsAttempt, escaped: bool) -> None:
    positive = row.id in ("udp-cname", "tcp-public")
    code = "DNS_FAILURE" if row.id == "wrong-tcp-id" else "POLICY_DENIED"
    assert row.surface == ("resolver-only" if positive else "http-redirect-negative")
    assert row.resolver_calls == 1
    assert row.resolver_code == ("accepted" if positive or escaped else code)
    assert row.passed is (not escaped)
    assert row.resolver_result_sha256 == (
        digest(expected_result(row).model_dump_json().encode()) if positive or escaped else None
    )
    assert row.control_stop is escaped
    assert row.control_stop_code == ("POLICY_DENIED" if escaped else None)
    assert row.control_stop_provenance == (
        "negative-fixture-unconditional-stop-before-transport" if escaped else None
    )
    assert row.fetch_code == (None if positive else "POLICY_DENIED" if escaped else code)
    assert row.final_http == 0
    assert row.http_returned_bytes is row.http_returned_sha256 is None
    assert (
        row.http_connections,
        row.initial_http,
        row.http_response_closes,
        row.http_socket_closes,
    ) == (int(not positive),) * 4
    assert row.order == (
        ("wire-invoked", "wire-accepted")
        if positive
        else ("initial-http", "wire-invoked", "wire-accepted", "control-stop")
        if escaped
        else ("initial-http", "wire-invoked", "wire-rejected")
    )
    assert_dns_trace(row, escaped and row.id == "forbidden-cname")


def assert_dns(capture: DnsCapture, mutation: Mutation) -> None:
    assert tuple(row.id for row in capture.rows) == (
        "udp-cname",
        "tcp-public",
        "private-answer",
        "mixed-answer",
        "forbidden-cname",
        "wrong-tcp-id",
    )
    match mutation:
        case "always-reject" | "cached-resolution":
            assert capture.passed is False
            bypassed = mutation == "cached-resolution"
            for row in capture.rows[:2]:
                assert_dns_row(row, escaped=False)
            for row in capture.rows[2:]:
                assert row.passed is False
                assert row.fetch_code == ("accepted" if bypassed else "POLICY_DENIED")
                assert row.resolver_code == "not-invoked"
                assert row.resolver_calls == 0
                assert row.resolver_result_sha256 is None
                assert (row.http_connections, row.http_socket_closes, row.http_response_closes) == (
                    (2,) * 3 if bypassed else (0,) * 3
                )
                assert row.initial_http == row.final_http == int(bypassed)
                body = b"controlled DNS redirect bytes"
                assert row.http_returned_bytes == (len(body) if bypassed else None)
                assert row.http_returned_sha256 == (digest(body) if bypassed else None)
                assert row.order == (("initial-http", "final-http") if bypassed else ())
                assert row.control_stop is False
                assert row.control_stop_code is row.control_stop_provenance is None
                assert row.wire.queries == ()
                assert row.wire.tcp_connections == row.wire.tcp_closes == 0
            return
        case "unchecked-dns-addresses":
            escaped = ("private-answer", "mixed-answer")
        case "unchecked-dns-cname":
            escaped = ("forbidden-cname",)
        case "unchecked-dns-id":
            escaped = ("wrong-tcp-id",)
        case (
            "baseline"
            | "unchecked-private"
            | "unchecked-wire"
            | "first-answer-only"
            | "unchecked-alias"
            | "unchecked-ip-alias"
            | "unchecked-gzip-wire"
            | "unchecked-aggregate"
            | "extra-slot"
            | "unchecked-tls-hostname"
            | "unchecked-tls-trust"
            | "early-handshake-deadline"
        ):
            escaped = ()
        case _:
            assert_never(mutation)
    assert capture.passed is (not escaped)
    for row in capture.rows:
        assert_dns_row(row, row.id in escaped)
