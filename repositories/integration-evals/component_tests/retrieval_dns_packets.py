import struct
from typing import assert_never

from component_tests.retrieval_dns_records import DnsAttempt, DnsQuery, DnsScenario
from integration_evals.artifacts import digest


def encoded_name(name: str) -> bytes:
    return (
        b"".join(bytes([len(label)]) + label.encode("ascii") for label in name.split(".")) + b"\0"
    )


def question_bytes(query: DnsQuery) -> bytes:
    names = {
        "target": "wire-target.example.org",
        "alias": "alias.example.org",
        "forbidden": "private.internal",
    }
    return encoded_name(names[query.question_profile]) + struct.pack("!HH", query.type, 1)


def reply_bytes(query: DnsQuery, scenario: DnsScenario) -> bytes:
    truncated = query.transport == "udp" and scenario in ("tcp-public", "wrong-tcp-id")
    records: list[bytes] = []
    record_type = 1
    if not truncated and query.type == 1:
        match scenario:
            case "udp-cname" | "forbidden-cname":
                if query.question_profile == "target":
                    record_type = 5
                    records = [
                        encoded_name(
                            "alias.example.org" if scenario == "udp-cname" else "private.internal"
                        )
                    ]
                else:
                    records = [bytes([8, 8, 8, 8])]
            case "private-answer":
                records = [bytes([10, 0, 0, 7])]
            case "mixed-answer":
                records = [bytes([8, 8, 8, 8]), bytes([10, 0, 0, 7])]
            case "tcp-public" | "wrong-tcp-id":
                records = [bytes([9, 9, 9, 9])]
            case _:
                assert_never(scenario)
    corrupt = scenario == "wrong-tcp-id" and query.transport == "tcp" and query.type == 1
    identifier = (query.id + 1) % 65536 if corrupt else query.id
    header = struct.pack("!6H", identifier, 0x8380 if truncated else 0x8180, 1, len(records), 0, 0)
    return (
        header
        + question_bytes(query)
        + b"".join(
            struct.pack("!HHHIH", 0xC00C, record_type, 1, 60, len(data)) + data for data in records
        )
    )


def assert_packet(query: DnsQuery, scenario: DnsScenario) -> None:
    assert 0 <= query.id <= 65535
    assert 1 <= query.peer_source_port <= 65535
    assert query.peer_loopback is True
    assert query.qclass == 1
    packet = struct.pack("!6H", query.id, 0x0100, 1, 0, 0, 0) + question_bytes(query)
    reply = reply_bytes(query, scenario)
    assert query.query_bytes == len(packet)
    assert query.query_sha256 == digest(packet)
    assert query.question_sha256 == digest(question_bytes(query))
    assert query.query_frame_sha256 == digest(
        struct.pack("!H", len(packet)) + packet if query.transport == "tcp" else packet
    )
    assert query.reply_bytes == len(reply)
    assert query.reply_sha256 == digest(reply)
    assert query.reply_frame_sha256 == digest(
        struct.pack("!H", len(reply)) + reply if query.transport == "tcp" else reply
    )
    assert query.reply_id == int.from_bytes(reply[:2])
    assert query.reply_flags == int.from_bytes(reply[2:4])
    assert query.send_completed is True


def assert_dns_trace(row: DnsAttempt, forbidden_queried: bool) -> None:
    trace = row.wire
    assert 1 <= trace.server_port <= 65535
    assert trace.protocol_errors == trace.socket_errors == 0
    assert trace.unexpected_packets == ()
    tcp = row.id in ("tcp-public", "wrong-tcp-id")
    assert trace.tcp_connections == trace.tcp_closes == (2 if tcp else 0)
    assert sum(e.event == "tcp-open" for e in trace.events) == trace.tcp_connections
    assert sum(e.event == "tcp-close" for e in trace.events) == trace.tcp_closes
    expected = [("udp", "target", 1), ("udp", "target", 28)]
    if tcp:
        expected += [("tcp", "target", 1), ("tcp", "target", 28)]
    if row.id == "udp-cname":
        expected += [("udp", "alias", 1)]
    if forbidden_queried:
        expected += [("udp", "forbidden", 1)]
    assert sorted((q.transport, q.question_profile, q.type) for q in trace.queries) == sorted(
        expected
    )
    for index, query in enumerate(trace.queries):
        assert query.index == index
        assert_packet(query, row.id)
        assert (
            sum(e.event == "send-completed" and e.query_index == index for e in trace.events) == 1
        )
        if query.transport == "tcp":
            udp = next(q for q in trace.queries if q.transport == "udp" and q.type == query.type)
            assert query.fallback_frame_matches_udp is True
            assert query.id == udp.id
            assert query.query_sha256 == udp.query_sha256
            assert query.question_sha256 == udp.question_sha256
        else:
            assert query.fallback_frame_matches_udp is None
    for transport in ("udp", "tcp") if tcp else ("udp",):
        indices = {
            q.index
            for q in trace.queries
            if q.transport == transport and q.question_profile == "target"
        }
        arrivals = [
            i for i, e in enumerate(trace.events) if e.event == "query" and e.query_index in indices
        ]
        replies = [
            i
            for i, e in enumerate(trace.events)
            if e.event == "reply-dispatched" and e.query_index in indices
        ]
        assert len(arrivals) == len(replies) == 2
        assert max(arrivals) < min(replies)
    for alias in (q for q in trace.queries if q.question_profile != "target"):
        parent = next(q for q in trace.queries if q.question_profile == "target" and q.type == 1)
        dispatched = next(
            i
            for i, e in enumerate(trace.events)
            if e.event == "reply-dispatched" and e.query_index == parent.index
        )
        arrived = next(
            i
            for i, e in enumerate(trace.events)
            if e.event == "query" and e.query_index == alias.index
        )
        assert dispatched < arrived
