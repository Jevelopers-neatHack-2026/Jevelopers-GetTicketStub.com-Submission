from pathlib import Path

import pytest
from pydantic import ValidationError

from integration_evals.artifacts import digest
from integration_evals.print_setup import PrintConfiguration, configuration


def test_configuration_hashes_actual_large_executable(tmp_path: Path) -> None:
    # Given a runtime larger than the JSON artifact limit and a canonical browser directory.
    binary = tmp_path / "node"
    contents = b"runtime-test" * 800000
    _ = binary.write_bytes(contents)
    browser = tmp_path / "browser"
    browser.mkdir()
    # When generating a configuration from actual bytes.
    config = configuration(Path(__file__).resolve().parents[1], binary, browser)
    # Then the executable digest measures all bytes without granting acceptance.
    assert config.node_sha256 == digest(contents)
    assert config.browser_root == str(browser.resolve())
    assert config.accepted is False


@pytest.mark.parametrize(
    "change",
    [
        '"accepted":true',
        '"mode":"live"',
        '"case_id":"print-preflight"',
        '"node_sha256":"invalid"',
        '"extra":"undeclared"',
    ],
)
def test_configuration_rejects_unsupported_authority_or_shape(change: str) -> None:
    # Given otherwise valid configuration with one external caller's forbidden field.
    config = PrintConfiguration(
        node_sha256="a" * 64, browser_root="/ms-playwright", renderer_image="image"
    )
    data = config.model_dump_json(exclude={change.split('"')[1]})[:-1] + "," + change + "}"
    # When parsing the configuration boundary.
    with pytest.raises(ValidationError):
        _ = PrintConfiguration.model_validate_json(data)
    # Then invalid scope, authority, hash shape or undeclared fields cannot enter assembly.
