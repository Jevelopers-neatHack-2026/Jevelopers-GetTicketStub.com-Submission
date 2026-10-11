from typing import Literal, assert_never

from integration_evals.artifacts import digest
from integration_evals.models import Digest, Record

type ResolverMutation = Literal[
    "cached-resolution", "first-answer-only", "unchecked-alias", "unchecked-ip-alias"
]
type BudgetMutation = Literal["unchecked-gzip-wire", "unchecked-aggregate"]
type TlsMutation = Literal[
    "unchecked-tls-hostname", "unchecked-tls-trust", "early-handshake-deadline"
]
type DnsMutation = Literal["unchecked-dns-addresses", "unchecked-dns-cname", "unchecked-dns-id"]
type Mutation = (
    Literal["baseline", "always-reject", "unchecked-private", "unchecked-wire", "extra-slot"]
    | ResolverMutation
    | BudgetMutation
    | TlsMutation
    | DnsMutation
)
type Scenario = Literal[
    "safe-alias", "private-transition", "mixed-answers", "metadata-alias", "ip-alias"
]


class ResolverCall(Record):
    input_profile: Literal["safe"] | Scenario
    same_hostname: bool
    address_count: int
    alias_count: int


class ResolverAttempt(Record):
    id: Scenario
    code: str
    resolver_calls: tuple[ResolverCall, ...]
    connections: int
    redirect_requests: int
    final_requests: int
    response_closes: int
    connection_closes: int
    returned_bytes: int | None
    returned_sha256: Digest | None
    passed: bool


class ResolverCapture(Record):
    fixture_mode: Literal["source-only-localTestSeam-resolveOverride"]
    rows: tuple[ResolverAttempt, ...]
    passed: bool
    capture_scope: str


def mutate_resolver(original: str, mutation: ResolverMutation) -> str:
    match mutation:
        case "cached-resolution":
            replacements = (
                (
                    "      let redirects = 0;",
                    "      let redirects = 0;\n      let cachedResolution;",
                ),
                (
                    "const resolved = this.#seam?.resolve",
                    "const resolved = cachedResolution ?? (this.#seam?.resolve",
                ),
                (
                    (
                        ": await resolveSystemHost(host, { signal: context.signal, "
                        "deadline: context.deadline });"
                    ),
                    (
                        ": await resolveSystemHost(host, { signal: context.signal, "
                        "deadline: context.deadline }));\n        cachedResolution = resolved;"
                    ),
                ),
            )
        case "first-answer-only":
            replacements = (
                (
                    (
                        "for (const address of resolved.addresses) "
                        "assertAllowedAddress(address, this.#seam);"
                    ),
                    (
                        "for (const address of resolved.addresses.slice(0, 1)) "
                        "assertAllowedAddress(address, this.#seam);"
                    ),
                ),
            )
        case "unchecked-alias":
            replacements = (("          validateHostnameForResolver(alias, this.#seam);", ""),)
        case "unchecked-ip-alias":
            replacements = (
                ('          if (isIPHost(alias)) throw new RetrievalError("DNS_FAILURE");', ""),
            )
        case _:
            assert_never(mutation)
    for old, new in replacements:
        assert original.count(old) == 1
        original = original.replace(old, new, 1)
    return original


def assert_resolver_inputs(capture: ResolverCapture, mutation: Mutation) -> None:
    expected = {
        "safe-alias": "accepted",
        "private-transition": "POLICY_DENIED",
        "mixed-answers": "POLICY_DENIED",
        "metadata-alias": "POLICY_DENIED",
        "ip-alias": "DNS_FAILURE",
    }
    assert tuple(row.id for row in capture.rows) == tuple(expected)
    affected: tuple[str, ...] = ()
    calls = 2
    match mutation:
        case "always-reject":
            assert capture.passed is False
            for row in capture.rows:
                assert row.code == "POLICY_DENIED"
                assert row.resolver_calls == ()
                assert (row.connections, row.redirect_requests, row.final_requests) == (0, 0, 0)
                assert row.passed is False
            return
        case "cached-resolution":
            affected = tuple(expected)
            calls = 1
        case "first-answer-only":
            affected = ("mixed-answers",)
        case "unchecked-alias":
            affected = ("metadata-alias",)
        case "unchecked-ip-alias":
            affected = ("ip-alias",)
        case (
            "baseline"
            | "unchecked-private"
            | "unchecked-wire"
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
            affected = ()
        case _:
            assert_never(mutation)
    assert capture.passed is (not affected)
    for row in capture.rows:
        code = "accepted" if row.id in affected else expected[row.id]
        assert row.code == code
        assert row.passed is (row.id not in affected)
        assert len(row.resolver_calls) == calls
        assert all(call.same_hostname for call in row.resolver_calls)
        first = row.resolver_calls[0]
        assert (first.input_profile, first.address_count, first.alias_count) == ("safe", 1, 1)
        if calls == 2:
            second = row.resolver_calls[1]
            assert second.input_profile == row.id
            assert second.address_count == (2 if row.id == "mixed-answers" else 1)
            assert second.alias_count == (
                0 if row.id in ("private-transition", "mixed-answers") else 1
            )
        reached = int(code == "accepted")
        assert (row.redirect_requests, row.final_requests) == (1, reached)
        assert (row.connections, row.response_closes, row.connection_closes) == (1 + reached,) * 3
        body = b"controlled resolver redirect bytes"
        assert row.returned_bytes == (len(body) if reached else None)
        assert row.returned_sha256 == (digest(body) if reached else None)
