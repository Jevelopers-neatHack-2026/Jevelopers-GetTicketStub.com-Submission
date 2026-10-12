import os
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from integration_evals.contracts import stage_contract_inputs
from integration_evals.errors import InvalidArtifactError
from integration_evals.processes import ProcessSettings, invoke
from integration_evals.validation import git_value
from tests.test_contract_pins import pinned_checkout


def test_staged_checkout_contains_only_verified_tracked_inputs(tmp_path: Path) -> None:
    # Given a pinned producer with ignored harmless data and Git-private metadata.
    producer = tmp_path / "producer"
    producer.mkdir()
    settings = pinned_checkout(producer)
    _ = (producer / ".git/info/exclude").write_text("ignored-sentinel\n")
    _ = (producer / "ignored-sentinel").write_text("not-a-runtime-input")
    driver = tmp_path / "driver.mjs"
    _ = driver.write_text("console.log('owned-driver')")
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    # When staging the verified finite file set for a real offline invocation.
    package = stage_contract_inputs(settings, inputs, driver)
    # Then only immutable tracked bytes, the runtime and driver are exposed.
    assert package is None
    assert not (inputs / "producer/.git").exists()
    assert not (inputs / "producer/ignored-sentinel").exists()
    assert (inputs / "node").read_bytes() == settings.node.read_bytes()
    assert (inputs / "driver.mjs").read_bytes() == driver.read_bytes()
    assert (inputs / "producer/generated/schema-manifest.json").read_bytes() == (
        producer / "generated/schema-manifest.json"
    ).read_bytes()


def test_staging_rejects_untracked_producer_inputs(tmp_path: Path) -> None:
    # Given a previously pinned producer with a new untracked harmless file.
    producer = tmp_path / "producer"
    producer.mkdir()
    settings = pinned_checkout(producer)
    _ = (producer / "untracked-sentinel").write_text("outside-reviewed-inputs")
    driver = tmp_path / "driver.mjs"
    _ = driver.write_text("console.log('owned-driver')")
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    # When the input snapshot is checked against its original pin.
    with pytest.raises(InvalidArtifactError, match="dirty_contract_checkout"):
        _ = stage_contract_inputs(settings, inputs, driver)
    # Then the untracked content cannot become an offline runtime input.
    assert not (inputs / "producer/untracked-sentinel").exists()


def test_staged_inputs_remain_readonly_during_real_execution(tmp_path: Path) -> None:
    # Given exact staged producer/runtime/driver bytes and a separate writable output root.
    producer, inputs, writable = (tmp_path / name for name in ("producer", "inputs", "write"))
    for directory in (producer, inputs, writable):
        directory.mkdir()
    settings = pinned_checkout(producer)
    driver = tmp_path / "driver.mjs"
    _ = driver.write_text("owned-driver")
    _ = stage_contract_inputs(settings, inputs, driver)
    output = writable / "stdout"
    program = """import os
import sys
from dataclasses import replace
from pathlib import Path

import pytest
import errno,sys
source=Path('driver.mjs')
Path(sys.argv[1]).write_text(source.read_text())
try:
 source.write_text('mutated')
except OSError as error:
 assert error.errno in (errno.EPERM,errno.EACCES,errno.EROFS)
 print('input-write-denied')
else:
 raise RuntimeError('input was writable')
"""
    # When the actual sandbox consumes staged input, produces output, and attempts input mutation.
    with output.open("w+b") as stream:
        result = invoke(
            (sys.executable, "-c", program, str(writable / "result")),
            ProcessSettings(
                inputs, os.environ, b"", stream, 5, offline=True, writable_directory=writable
            ),
        )
    # Then staged inputs remain immutable while useful output survives.
    assert result == 0
    assert output.read_text() == "input-write-denied\n"
    assert (inputs / "driver.mjs").read_text() == "owned-driver"
    assert (writable / "result").read_text() == "owned-driver"


def test_staging_rejects_tracked_symlink_to_outside_input(tmp_path: Path) -> None:
    # Given a clean, newly pinned producer containing a link to a harmless outside file.
    producer = tmp_path / "producer"
    producer.mkdir()
    settings = pinned_checkout(producer)
    sentinel = tmp_path / "outside-sentinel"
    _ = sentinel.write_text("outside-input")
    (producer / "link").symlink_to(sentinel)
    _ = git_value(producer, "add", "link")
    _ = git_value(
        producer,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@evals.example",
        "commit",
        "-m",
        "pin symlink rejection fixture",
    )
    settings = replace(
        settings,
        pin=settings.pin.model_copy(
            update={
                "revision": git_value(producer, "rev-parse", "HEAD"),
                "tree": git_value(producer, "rev-parse", "HEAD^{tree}"),
            }
        ),
    )
    driver = tmp_path / "driver.mjs"
    _ = driver.write_text("owned-driver")
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    # When staging encounters the tracked link before copying its target.
    with pytest.raises(InvalidArtifactError, match="offline_path_alias_rejected"):
        _ = stage_contract_inputs(settings, inputs, driver)
    # Then the link and its target bytes are absent from the child input snapshot.
    assert not (inputs / "producer/link").exists()
