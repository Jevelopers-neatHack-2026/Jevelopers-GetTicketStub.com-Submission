from typing import Literal, assert_never

from component_tests.retrieval_resolver_checks import BudgetMutation, Mutation
from integration_evals.artifacts import digest
from integration_evals.models import Digest, Record


class BudgetAttempt(Record):
    id: str
    code: str
    encoded_bytes: int
    encoded_sha256: Digest
    decoded_bytes: int
    decoded_sha256: Digest
    gzip_level: Literal[0, 6]
    fetcher_scope: Literal["fresh", "shared-aggregate"]
    accepted_decoded_before: int
    returned_bytes: int | None
    returned_sha256: Digest | None
    connections: int
    requests: int
    response_closes: int
    connection_closes: int
    transfer_chunked: bool | None
    content_gzip: bool | None
    content_length_present: bool | None


class BudgetCapture(Record):
    fixture_mode: Literal["source-only-localTestSeam"]
    wire_bytes_per_request: int
    decoded_text_bytes_per_request: int
    decoded_bytes_per_run: int
    requests_per_run: int
    rows: tuple[BudgetAttempt, ...]
    passed: bool
    capture_scope: str


def mutate_budget(original: str, mutation: BudgetMutation) -> str:
    match mutation:
        case "unchecked-gzip-wire":
            old = (
                '        if (encoded > wireMaximum) callback(new RetrievalError("RESOURCE_LIMIT"));'
                "\n        else callback(null, chunk);"
            )
            new = "        callback(null, chunk);"
        case "unchecked-aggregate":
            old = (
                " || fetcherState.decodedBytes + chunk.length > "
                "DEFAULT_RUN_LIMITS.decodedBytesPerRun"
            )
            new = ""
        case _:
            assert_never(mutation)
    assert original.count(old) == 1
    return original.replace(old, new, 1)


def assert_budget_metadata(capture: BudgetCapture) -> None:
    mib = 1024 * 1024
    assert capture.wire_bytes_per_request == 10 * mib
    assert capture.decoded_text_bytes_per_request == 20 * mib
    assert capture.decoded_bytes_per_run == 100 * mib
    assert capture.requests_per_run > 6
    assert tuple(row.id for row in capture.rows) == (
        "gzip-positive",
        "gzip-wire-overflow",
        "aggregate-1",
        "aggregate-2",
        "aggregate-3",
        "aggregate-4",
        "aggregate-5",
        "aggregate-overflow",
        "fresh-one-byte",
    )
    positive, wire, *_, overflow, fresh = capture.rows
    assert positive.decoded_bytes == 1024
    assert wire.decoded_bytes == 10 * mib + 1
    assert wire.encoded_bytes > capture.wire_bytes_per_request
    assert wire.decoded_bytes < capture.decoded_text_bytes_per_request
    assert wire.decoded_bytes < capture.decoded_bytes_per_run
    assert wire.gzip_level == 0
    assert (overflow.decoded_bytes, fresh.decoded_bytes) == (1, 1)
    for row in capture.rows:
        assert row.decoded_sha256 == digest(b"b" * row.decoded_bytes)
        assert row.fetcher_scope == (
            "shared-aggregate" if row.id.startswith("aggregate-") else "fresh"
        )
        if row.id != "gzip-wire-overflow":
            assert row.encoded_bytes < capture.wire_bytes_per_request
            assert row.gzip_level == 6
    assert all(row.decoded_bytes == 20 * mib for row in capture.rows[2:7])


def assert_byte_budgets(capture: BudgetCapture, mutation: Mutation) -> None:
    assert_budget_metadata(capture)
    escaped: str | None = None
    match mutation:
        case "always-reject":
            assert capture.passed is False
            for row in capture.rows:
                assert row.code == "POLICY_DENIED"
                assert (row.connections, row.requests, row.accepted_decoded_before) == (0, 0, 0)
                assert row.returned_bytes is None
            return
        case "unchecked-gzip-wire":
            escaped = "gzip-wire-overflow"
        case "unchecked-aggregate":
            escaped = "aggregate-overflow"
        case (
            "baseline"
            | "unchecked-private"
            | "unchecked-wire"
            | "cached-resolution"
            | "first-answer-only"
            | "unchecked-alias"
            | "unchecked-ip-alias"
            | "extra-slot"
            | "unchecked-tls-hostname"
            | "unchecked-tls-trust"
            | "early-handshake-deadline"
            | "unchecked-dns-addresses"
            | "unchecked-dns-cname"
            | "unchecked-dns-id"
        ):
            escaped = None
        case _:
            assert_never(mutation)
    assert capture.passed is (escaped is None)
    for row in capture.rows:
        assert (row.connections, row.requests, row.response_closes, row.connection_closes) == (
            1,
        ) * 4
        assert row.transfer_chunked is True
        assert row.content_gzip is True
        assert row.content_length_present is False
        accepted = row.id not in ("gzip-wire-overflow", "aggregate-overflow") or row.id == escaped
        assert row.code == ("accepted" if accepted else "RESOURCE_LIMIT")
        assert row.returned_bytes == (row.decoded_bytes if accepted else None)
        assert row.returned_sha256 == (row.decoded_sha256 if accepted else None)
    for index, row in enumerate(capture.rows[2:7]):
        assert row.accepted_decoded_before == index * capture.decoded_text_bytes_per_request
    assert capture.rows[7].accepted_decoded_before == capture.decoded_bytes_per_run
    assert all(capture.rows[index].accepted_decoded_before == 0 for index in (0, 1, 8))
