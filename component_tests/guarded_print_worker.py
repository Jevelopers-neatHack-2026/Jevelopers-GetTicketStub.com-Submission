"""Independent creator process used to kill the actual guarded owner invocation."""

import signal
import sys
from pathlib import Path

from component_tests.container_prototype import cancellation
from component_tests.container_records import Record
from component_tests.guarded_print import GuardedPrint
from component_tests.print_clock import GUARDED_CLOCK
from component_tests.print_protocol import Invocation
from integration_evals.processes import invoke


class WorkerConfiguration(Record):
    workspace: Path
    home: Path
    producer: Path
    evidence: Path
    daemon_failure: bool = False
    compose_checkpoint: bool = False


def main(configuration: WorkerConfiguration) -> int:
    backend = GuardedPrint(
        configuration.producer,
        configuration.evidence,
        checkpoints=True,
        daemon_failure=configuration.daemon_failure,
        compose_checkpoint=configuration.compose_checkpoint,
    )
    invocation = Invocation(
        configuration.workspace, configuration.home, "replay", backend, clock=GUARDED_CLOCK
    )
    with (configuration.home / "stdout").open("w+b") as output:
        settings = invocation.settings(output)
        node = str(configuration.producer / "out/toolchain/node-v24.21.0-linux-x64/bin/node")
        command = (
            (node, "dist/tests/fixtures/integration-evals/positive-control.js")
            if configuration.compose_checkpoint
            else (node, "dist/scripts/integration-evals/cli.js", "run")
        )
        return invoke(command, settings)


if __name__ == "__main__":
    _ = signal.signal(signal.SIGTERM, cancellation)
    _ = signal.signal(signal.SIGINT, cancellation)
    sys.exit(main(WorkerConfiguration.model_validate_json(Path(sys.argv[1]).read_bytes())))
