import json
import os
import select
import subprocess
import sys
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from uuid import uuid4

from component_tests.container_docker import Docker
from component_tests.container_records import Configuration, Record


class Checkpoint(Record):
    stage: str
    client_pid: int


@dataclass(frozen=True, slots=True)
class Driver:
    configuration: Configuration
    process: subprocess.Popen[bytes]
    deadline: float

    def advance(self, stage: str) -> Checkpoint:
        output = self.process.stdout
        assert output is not None
        while True:
            raw = b""
            while not raw.endswith(b"\n"):
                ready, _, _ = select.select([output], [], [], max(0, self.deadline - monotonic()))
                assert ready, "Controller checkpoint deadline expired"
                part = os.read(output.fileno(), 1)
                assert part, f"Controller exited before {stage}"
                raw += part
                assert len(raw) <= 4096
            observed = Checkpoint.model_validate_json(raw)
            with (self.configuration.directory / "checkpoints.jsonl").open("ab") as log:
                _ = log.write(raw)
            if observed.stage == stage:
                return observed
            self.release()

    def release(self) -> None:
        channel = self.process.stdin
        assert channel is not None
        _ = channel.write(b"continue\n")
        channel.flush()

    def result(self) -> int:
        status = self.process.wait(timeout=max(0.001, self.deadline - monotonic()))
        _ = (self.configuration.directory / "creator-exit.json").write_text(
            json.dumps(
                {
                    "exit_code": status,
                }
            )
        )
        return status

    def docker(self) -> Docker:
        return Docker(self.configuration, monotonic() + 5)


@contextmanager
def driver(*, failure: bool = False) -> Generator[Driver]:
    assert sys.platform == "linux"
    assert os.getuid() == 0
    assert os.environ.get("IE_PRINT_CONTAINER_PROTOTYPE") == "guarded-development"
    evidence = Path(os.environ["IE_PRINT_LIFETIME_EVIDENCE"]).resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    name = "ie-lifetime-" + uuid4().hex
    configuration = Configuration(
        producer=Path(os.environ["IE_PRINT_SOURCE"]).resolve(),
        directory=evidence / name,
        name=name,
        teardown_daemon_failure=failure,
    )
    path = evidence / f"{name}.json"
    _ = path.write_text(configuration.model_dump_json())
    with (
        (evidence / f"{name}.stderr").open("wb") as errors,
        subprocess.Popen(  # noqa: S603 - fixed local prototype module
            (sys.executable, "-m", "component_tests.container_prototype", str(path)),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=errors,
        ) as process,
    ):
        try:
            yield Driver(configuration, process, monotonic() + 36)
        finally:
            if process.poll() is None:
                process.kill()
            _ = process.wait(timeout=5)
