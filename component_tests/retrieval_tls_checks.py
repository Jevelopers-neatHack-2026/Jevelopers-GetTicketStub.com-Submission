from typing import Literal, assert_never

from component_tests.retrieval_resolver_checks import Mutation, TlsMutation
from integration_evals.artifacts import digest
from integration_evals.models import Digest, Record


class TlsAttempt(Record):
    id: Literal["trusted", "hostname-mismatch", "trust-mismatch"]
    code: str
    connections: int
    socket_closes: int
    initial_requests: int
    final_requests: int
    response_closes: int
    secure_connections: int
    tls_client_errors: int
    served_certificate_sha256: tuple[Digest | None, ...]
    events: tuple[
        Literal[
            "initial-http",
            "rotate-certificate",
            "final-http",
            "tcp",
            "socket-close",
            "tls-secure",
            "tls-client-error",
        ],
        ...,
    ]
    rotated: bool
    returned_bytes: int | None
    returned_sha256: Digest | None
    passed: bool


class TlsCapture(Record):
    fixture_mode: Literal["source-only-owner-createCertificate-localTestSeam"]
    trusted_certificate_sha256: Digest
    other_certificate_sha256: Digest
    rows: tuple[TlsAttempt, ...]
    passed: bool
    capture_scope: str


def mutate_tls(original: str, mutation: TlsMutation) -> str:
    match mutation:
        case "unchecked-tls-hostname":
            replacements = (
                (
                    (
                        "checkServerIdentity: (_serverName, certificate) => "
                        "tls.checkServerIdentity(this.hostname, certificate),"
                    ),
                    "checkServerIdentity: () => undefined,",
                ),
            )
        case "unchecked-tls-trust":
            replacements = (
                ("rejectUnauthorized: true,", "rejectUnauthorized: false,"),
                ('if (!tlsSocket.authorized) throw new RetrievalError("TRANSPORT_FAILURE");', ""),
            )
        case "early-handshake-deadline":
            replacements = (
                (
                    "DEFAULT_RUN_LIMITS.connectMilliseconds);",
                    "DEFAULT_RUN_LIMITS.connectMilliseconds / 10);",
                ),
            )
        case _:
            assert_never(mutation)
    for old, new in replacements:
        assert original.count(old) == 1
        original = original.replace(old, new, 1)
    return original


def assert_tls_rows(capture: TlsCapture, escaped: tuple[str, ...]) -> None:
    assert capture.passed is (not escaped)
    for row in capture.rows:
        accepted = row.id == "trusted" or row.id in escaped
        assert row.code == ("accepted" if accepted else "TRANSPORT_FAILURE")
        assert row.passed is (row.id not in escaped)
        assert (row.connections, row.socket_closes, row.initial_requests) == (2, 2, 1)
        assert row.final_requests == int(accepted)
        assert row.response_closes == 1 + int(accepted)
        assert row.rotated is (row.id == "trust-mismatch")
        body = b"controlled TLS redirect bytes"
        assert row.returned_bytes == (len(body) if accepted else None)
        assert row.returned_sha256 == (digest(body) if accepted else None)
        assert row.events.count("tcp") == row.connections
        assert row.events.count("socket-close") == row.socket_closes
        assert row.events.count("tls-secure") == row.secure_connections
        assert row.events.count("tls-client-error") == row.tls_client_errors
        second_tcp = tuple(index for index, event in enumerate(row.events) if event == "tcp")[1]
        assert row.events.index("initial-http") < second_tcp
        if row.rotated:
            assert (
                row.events.index("initial-http")
                < row.events.index("rotate-certificate")
                < second_tcp
            )
        assert 1 <= row.secure_connections <= 2
        assert len(row.served_certificate_sha256) == row.secure_connections
        assert row.served_certificate_sha256[0] == capture.trusted_certificate_sha256
        if accepted:
            assert row.secure_connections == 2
            assert row.served_certificate_sha256[1] == (
                capture.other_certificate_sha256
                if row.rotated
                else capture.trusted_certificate_sha256
            )


def assert_tls(capture: TlsCapture, mutation: Mutation) -> None:
    assert capture.trusted_certificate_sha256 != capture.other_certificate_sha256
    assert tuple(row.id for row in capture.rows) == (
        "trusted",
        "hostname-mismatch",
        "trust-mismatch",
    )
    escaped: tuple[str, ...] = ()
    match mutation:
        case "always-reject":
            assert capture.passed is False
            for row in capture.rows:
                assert row.code == "POLICY_DENIED"
                assert row.connections == row.initial_requests == row.final_requests == 0
                assert row.events == ()
                assert row.rotated is row.passed is False
            return
        case "unchecked-tls-hostname":
            escaped = ("hostname-mismatch",)
        case "unchecked-tls-trust":
            escaped = ("hostname-mismatch", "trust-mismatch")
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
            | "early-handshake-deadline"
        ):
            escaped = ()
        case _:
            assert_never(mutation)
    assert_tls_rows(capture, escaped)
