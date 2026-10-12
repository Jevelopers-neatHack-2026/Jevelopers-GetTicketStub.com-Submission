from typing import assert_never

from component_tests.retrieval_resolver_checks import DnsMutation, Mutation, TlsMutation
from component_tests.retrieval_tls_checks import mutate_tls


def mutation_source(mutation: Mutation) -> str:
    match mutation:
        case "unchecked-dns-addresses" | "unchecked-dns-cname" | "unchecked-dns-id":
            return "src/security/internal/dns-wire.mjs"
        case (
            "baseline"
            | "always-reject"
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
            | "early-handshake-deadline"
        ):
            return "src/security/controlled-fetch.mjs"
        case _:
            assert_never(mutation)


def mutate_protocol(original: str, mutation: TlsMutation | DnsMutation) -> str:
    count = 1
    match mutation:
        case "unchecked-tls-hostname" | "unchecked-tls-trust" | "early-handshake-deadline":
            return mutate_tls(original, mutation)
        case "unchecked-dns-addresses":
            old = (
                "if (addresses.some((address) => !isPublicAddress(address))) "
                'throw new RetrievalError("POLICY_DENIED");'
            )
            new = ""
            count = 2
        case "unchecked-dns-cname":
            old = "const alias = validateHostname(linked[0].data);"
            new = "const alias = linked[0].data;"
        case "unchecked-dns-id":
            old = " || packet.readUInt16BE(0) !== id"
            new = ""
        case _:
            assert_never(mutation)
    assert original.count(old) == count
    return original.replace(old, new, count)
