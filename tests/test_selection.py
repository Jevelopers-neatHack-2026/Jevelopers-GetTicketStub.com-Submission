from pathlib import Path

import pytest
from typer.testing import CliRunner

from integration_evals.artifacts import load_record
from integration_evals.cli import app, owned_requirements
from integration_evals.errors import InvalidArtifactError
from integration_evals.models import Catalog, Selection, Suite
from integration_evals.validation import validate_suite

REPOSITORY = Path(__file__).resolve().parents[1]


def test_suite_rejects_when_mandatory_case_omitted() -> None:
    # Given a valid registry but a suite missing one mandatory declaration.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    selection = load_record(REPOSITORY / "scenarios/selection.json", Selection)
    modified = Suite(cases=suite.cases[1:])
    # When validating scope before dispatch.
    with pytest.raises(InvalidArtifactError, match="mandatory_cases_omitted"):
        validate_suite(modified, catalog, owned_requirements(REPOSITORY), selection)
    # Then deleting required tests cannot produce a green run.


def test_cli_rejects_when_receipt_has_no_results(tmp_path: Path) -> None:
    # Given a malformed public receipt containing no executed cases.
    receipt = tmp_path / "empty.json"
    _ = receipt.write_text('{"results":[]}', encoding="utf-8")
    # When the real CLI inspects it.
    result = CliRunner().invoke(app, ["inspect", str(receipt)])
    # Then an empty run is rejected without echoing raw untrusted input.
    assert result.exit_code == 1
