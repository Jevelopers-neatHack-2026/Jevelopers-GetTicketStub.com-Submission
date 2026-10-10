from pathlib import Path

import pytest

from integration_evals.artifacts import digest, load_record
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import Settings
from integration_evals.models import Catalog, Outcome, Suite
from integration_evals.replay import authorize_rerun, link_rerun
from integration_evals.runner import execute

REPOSITORY = Path(__file__).resolve().parents[1]


def test_rerun_rejects_when_source_inputs_drift() -> None:
    # Given two receipts with different source content fingerprints.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    candidate = prior.model_copy(update={"source_digest": digest(b"different-source")})
    # When linking a purported identical-input rerun.
    with pytest.raises(InvalidArtifactError, match="rerun_input_drift"):
        _ = link_rerun(prior, candidate, suite, "diagnostic reproduction")
    # Then the original failure's inputs cannot be substituted silently.


def test_rerun_rejects_when_authorization_failure_present() -> None:
    # Given a safety failure on a tenant-boundary case.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    failed = next(result for result in prior.results if result.case_id == "wrong-tenant")
    prior = prior.model_copy(
        update={"results": (failed.model_copy(update={"outcome": Outcome.FAILED}),)}
    )
    # When requesting a diagnostic rerun.
    with pytest.raises(InvalidArtifactError, match="safety_or_ambiguity_rerun_forbidden"):
        authorize_rerun(prior, suite, "try again")
    # Then safety failures are preserved without automatic retries.


def test_rerun_rejects_when_diagnostic_limit_exhausted() -> None:
    # Given the original attempt plus two diagnostic reruns.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    prior = prior.model_copy(update={"attempt": 2})
    # When requesting another retry.
    with pytest.raises(InvalidArtifactError, match="rerun_limit_or_rationale"):
        authorize_rerun(prior, suite, "try again")
    # Then failed history cannot be hidden behind unlimited retries.
