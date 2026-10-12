"""Trusted invocation policies; never parsed from owner output or environment variables."""

import sys
from enum import StrEnum
from typing import assert_never

from integration_evals.errors import fail


class OfflineNetwork(StrEnum):
    """Keep generic offline commands socket-free; permit reviewed private IP fixtures only."""

    DENY = "deny"
    RETRIEVAL = "retrieval-private-ip"


def require_network_boundary(policy: OfflineNetwork, *, offline: bool) -> None:
    """Require the mandatory Linux network namespace for a retrieval fixture capability."""
    match policy:
        case OfflineNetwork.DENY:
            return
        case OfflineNetwork.RETRIEVAL:
            if not offline or sys.platform != "linux":
                fail("private_network_namespace_unavailable", "owner-command")
        case _:
            assert_never(policy)
