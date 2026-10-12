"""Real temporary-directory custody under simulated unknown teardown boundaries."""

import errno
import json
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic

import pytest

from component_tests.container_records import Configuration
from component_tests.guarded_print import (
    GuardedPrint,
    InvocationState,
    PrintDocker,
    exception_frames,
    reserve_custody,
)
from integration_evals.artifacts import load_record
from integration_evals.errors import InvalidArtifactError
from integration_evals.print_setup import PROFILE_PATH, PrintProfile
from integration_evals.processes import ProcessSettings


def test_failure_locations_are_bounded_and_exclude_private_messages_and_locals() -> None:
    def diagnostic_leaf() -> None:
        private = "PRIVATE_DIAGNOSTIC_CANARY"
        raise AssertionError(private)

    def nested(depth: int) -> None:
        if depth:
            nested(depth - 1)
        diagnostic_leaf()

    try:
        nested(20)
    except AssertionError as error:
        frames = exception_frames(error)
    else:
        pytest.fail("Expected controlled diagnostic failure")
    assert len(frames) == 8
    assert all(set(frame) == {"source", "function", "line"} for frame in frames)
    assert all(isinstance(frame["line"], int) and frame["line"] > 0 for frame in frames)
    assert all(frame["source"] == "component_tests/test_guarded_custody.py" for frame in frames)
    assert frames[-1]["function"] == "diagnostic_leaf"
    assert len(json.dumps(frames)) <= 4096
    assert "PRIVATE_DIAGNOSTIC_CANARY" not in json.dumps(frames)
    assert exception_frames(None) == []


@pytest.mark.parametrize("failure", ["expired-budget", "receipt-write", "teardown-write"])
def test_unknown_teardown_preserves_home_before_expired_budget_and_receipt_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    directory = tmp_path / "retained"
    directory.mkdir(mode=0o700)
    _ = (directory / "pre-dispatch.json").write_bytes(b"{}")
    profile = load_record(Path(__file__).resolve().parents[1] / PROFILE_PATH, PrintProfile)
    output = BytesIO(b"original-capture")
    original_write = Path.write_text

    def fail_receipt(
        path: Path,
        data: str,
        encoding: str | None = None,
        errors: str | None = None,
        newline: str | None = None,
    ) -> int:
        if path.name == "invocation.json":
            raise OSError(errno.ENOSPC, "controlled receipt write failure")
        return original_write(path, data, encoding=encoding, errors=errors, newline=newline)

    def unknown_finish(docker: PrintDocker, *_: object, **_unused: object) -> bool:
        assert docker.deadline < monotonic(), "Regression must exhaust the reap budget"
        if failure == "teardown-write":
            raise OSError(errno.ENOSPC, "controlled teardown diagnostic write failure")
        return False

    def prepared(*_: object) -> tuple[PrintDocker, dict[str, str], PrintProfile]:
        return docker, {}, profile

    def no_run(*_: object) -> None:
        return

    def reaped(*_: object) -> bool:
        return True

    with TemporaryDirectory(dir=tmp_path) as disposable:
        home = Path(disposable) / "home"
        home.mkdir()
        _ = (home / "owner-artifact").write_bytes(b"retained-original-bytes")
        config = Configuration(
            producer=tmp_path, directory=directory, name="ie-lifetime-" + "a" * 32
        )
        docker = PrintDocker(config, monotonic() + 30, tmp_path, tmp_path, home)
        reserve_custody(docker)
        monkeypatch.setattr(GuardedPrint, "prepare", prepared)
        monkeypatch.setattr(GuardedPrint, "run", no_run)
        monkeypatch.setattr("component_tests.guarded_print.monotonic", lambda: -100)
        monkeypatch.setattr("component_tests.guarded_print.reap_clients", reaped)
        monkeypatch.setattr("component_tests.guarded_print.finish", unknown_finish)
        if failure == "receipt-write":
            monkeypatch.setattr(Path, "write_text", fail_receipt)
        settings = ProcessSettings(tmp_path, {}, b"", output, 30, writable_directory=home)
        with pytest.raises(InvalidArtifactError if failure == "expired-budget" else OSError):
            _ = GuardedPrint(tmp_path, directory)(("original-owner",), settings)
        assert not home.exists()
        assert output.getvalue() == b"original-capture"
    assert not Path(disposable).exists()
    assert (
        directory / "quarantined-home/owner-artifact"
    ).read_bytes() == b"retained-original-bytes"
    assert (directory / "invocation.json").exists() is (failure == "expired-budget")


def test_proved_teardown_flushes_small_response_for_independent_file_reader(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    directory = tmp_path / "retained"
    directory.mkdir(mode=0o700)
    _ = (directory / "pre-dispatch.json").write_bytes(b"{}")
    home = tmp_path / "home"
    home.mkdir()
    profile = load_record(Path(__file__).resolve().parents[1] / PROFILE_PATH, PrintProfile)
    configuration = Configuration(
        producer=tmp_path, directory=directory, name="ie-lifetime-" + "a" * 32
    )
    docker = PrintDocker(configuration, monotonic() + 30, tmp_path, tmp_path, home)
    response = b'{"small-original-owner-response":true}\n'
    published = home / "stdout"
    namespace_stopped = False

    def prepared(*_: object) -> tuple[PrintDocker, dict[str, str], PrintProfile]:
        return docker, {}, profile

    def captured(
        _backend: GuardedPrint,
        _command: tuple[str, ...],
        _settings: ProcessSettings,
        _docker: PrintDocker,
        _environment: dict[str, str],
        state: InvocationState,
    ) -> None:
        assert published.read_bytes() == b""
        state.output = response
        state.exit_code = 0

    def reaped(*_: object) -> bool:
        return True

    def stopped(*_: object, **_unused: object) -> bool:
        nonlocal namespace_stopped
        assert published.read_bytes() == b""
        namespace_stopped = True
        return True

    def no_chown(*_: object) -> None:
        assert namespace_stopped

    monkeypatch.setattr(GuardedPrint, "prepare", prepared)
    monkeypatch.setattr(GuardedPrint, "run", captured)
    monkeypatch.setattr("component_tests.guarded_print.reap_clients", reaped)
    monkeypatch.setattr("component_tests.guarded_print.finish", stopped)
    monkeypatch.setattr("component_tests.guarded_print.own_tree", no_chown)
    with published.open("w+b") as output:
        settings = ProcessSettings(tmp_path, {}, b"", output, 30, writable_directory=home)
        assert GuardedPrint(tmp_path, directory)(("original-owner",), settings) == 0
        assert namespace_stopped
        # Still inside BufferedRandom's context: independent FD must see the bytes now.
        assert published.read_bytes() == response
