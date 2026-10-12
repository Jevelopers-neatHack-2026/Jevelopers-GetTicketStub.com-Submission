"""The default-off canary's main child exits on kernel control-socket EOF."""

import json
import socket

from component_tests.container_facts import facts


def main() -> None:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as lease:
        lease.connect("/run/ie-control/lease")
        receipt = {"guard": facts(), "init": facts(1), "lease_fd": lease.fileno()}
        lease.sendall(json.dumps(receipt).encode() + b"\n")
        assert lease.recv(1) == b"", "Only creator EOF terminates the lease"


if __name__ == "__main__":
    main()
