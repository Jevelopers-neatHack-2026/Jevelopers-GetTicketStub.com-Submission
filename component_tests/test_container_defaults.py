import os
import subprocess
import sys
from pathlib import Path

import pytest

from component_tests.container_prototype import execute
from component_tests.container_records import Configuration


def test_prototype_refuses_unselected_execution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Given no explicit prototype selection.
    monkeypatch.delenv("IE_PRINT_CONTAINER_PROTOTYPE", raising=False)
    configuration = Configuration(
        producer=tmp_path,
        directory=tmp_path / "untouched",
        name="ie-lifetime-" + "a" * 32,
    )
    # When the prototype is invoked directly.
    with pytest.raises(PermissionError):
        _ = execute(configuration)
    # Then no staging, process or Docker operation has been reached.
    assert not configuration.directory.exists()


def test_optimized_python_cannot_bypass_guard_checks(tmp_path: Path) -> None:
    # Given an explicitly selected prototype under optimized Python.
    configuration = Configuration(
        producer=tmp_path,
        directory=tmp_path / "untouched",
        name="ie-lifetime-" + "b" * 32,
    )
    path = tmp_path / "configuration.json"
    _ = path.write_text(configuration.model_dump_json())
    # When the actual module entry point runs with assertions disabled.
    result = subprocess.run(  # noqa: S603 - fixed interpreter and local entry point
        (sys.executable, "-O", "-m", "component_tests.container_prototype", str(path)),
        env={**os.environ, "IE_PRINT_CONTAINER_PROTOTYPE": "guarded-development"},
        check=False,
        capture_output=True,
        timeout=10,
    )
    # Then the explicit opt-in gate refuses before staging or Docker invocation.
    assert result.returncode == 1
    assert not configuration.directory.exists()
