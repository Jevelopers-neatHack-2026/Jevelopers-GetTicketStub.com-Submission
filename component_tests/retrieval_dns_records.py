from typing import Literal

from integration_evals.models import Digest, Record

type DnsScenario = Literal[
    "udp-cname", "tcp-public", "private-answer", "mixed-answer", "forbidden-cname", "wrong-tcp-id"
]


class DnsQuery(Record):
    index: int
    transport: Literal["udp", "tcp"]
    question_profile: Literal["target", "alias", "forbidden"]
    id: int
    type: int
    qclass: int
    peer_loopback: bool
    peer_source_port: int
    query_bytes: int
    query_sha256: Digest
    question_sha256: Digest
    query_frame_sha256: Digest
    reply_id: int | None
    reply_flags: int | None
    reply_bytes: int | None
    reply_sha256: Digest | None
    reply_frame_sha256: Digest | None
    send_completed: bool | None
    fallback_frame_matches_udp: bool | None


class DnsEvent(Record):
    event: Literal[
        "query", "reply-dispatched", "send-error", "send-completed", "tcp-open", "tcp-close"
    ]
    transport: Literal["udp", "tcp"]
    query_index: int | None


class UnexpectedPacket(Record):
    transport: Literal["udp", "tcp"]
    bytes: int
    sha256: Digest


class DnsTrace(Record):
    server_port: int
    queries: tuple[DnsQuery, ...]
    events: tuple[DnsEvent, ...]
    unexpected_packets: tuple[UnexpectedPacket, ...]
    protocol_errors: int
    socket_errors: int
    tcp_connections: int
    tcp_closes: int


class DnsAttempt(Record):
    id: DnsScenario
    surface: Literal["resolver-only", "http-redirect-negative"]
    resolver_calls: int
    resolver_code: str
    resolver_result_sha256: Digest | None
    fetch_code: str | None
    control_stop: bool
    control_stop_code: Literal["POLICY_DENIED"] | None
    control_stop_provenance: Literal["negative-fixture-unconditional-stop-before-transport"] | None
    http_connections: int
    initial_http: int
    final_http: int
    http_returned_bytes: int | None
    http_returned_sha256: Digest | None
    http_response_closes: int
    http_socket_closes: int
    order: tuple[
        Literal[
            "initial-http",
            "final-http",
            "wire-invoked",
            "wire-accepted",
            "wire-rejected",
            "control-stop",
        ],
        ...,
    ]
    wire: DnsTrace
    passed: bool


class DnsCapture(Record):
    fixture_mode: Literal["source-only-internal-DnsWireResolver"]
    rows: tuple[DnsAttempt, ...]
    passed: bool
    capture_scope: str


class DnsResult(Record):
    addresses: tuple[str, ...]
    aliases: tuple[str, ...] = ()
