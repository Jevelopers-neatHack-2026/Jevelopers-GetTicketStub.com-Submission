from pathlib import Path

import pytest

from integration_evals.artifacts import digest, load_record
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import Settings
from integration_evals.models import Catalog, Mode, Outcome, Suite
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
        update={
            "results": tuple(
                result.model_copy(update={"outcome": Outcome.FAILED})
                if result.case_id == failed.case_id
                else result
                for result in prior.results
            )
        }
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


@pytest.mark.parametrize("change", ["selected_case_ids", "scope", "runtime", "context", "mode"])
def test_rerun_rejects_when_execution_scope_changes(change: str) -> None:
    # Given an unchanged declared suite and an actual subset/environment mutation.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    candidate = prior.model_copy(update={"id": "run-rerun"})
    changes = {
        "selected_case_ids": prior.selected_case_ids[:1],
        "scope": "component",
        "runtime": "different runtime",
        "context": "ci",
    }
    if change == "mode":
        candidate = candidate.model_copy(
            update={
                "results": tuple(
                    result.model_copy(update={"mode": Mode.RECORDED}) for result in prior.results
                )
            }
        )
    else:
        candidate = candidate.model_copy(update={change: changes[change]})
    # When binding the newly executed receipt to the prior run.
    with pytest.raises(InvalidArtifactError, match=r"rerun_input_drift|rerun_selection_drift"):
        _ = link_rerun(prior, candidate, suite, "diagnostic reproduction")
    # Then retaining all declared rows cannot hide changed selected execution inputs.


def test_rerun_links_when_frozen_inputs_match() -> None:
    # Given a new receipt with the same complete execution identity.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    candidate = prior.model_copy(update={"id": "run-rerun"})
    # When recording the diagnostic attempt.
    linked = link_rerun(prior, candidate, suite, "diagnostic reproduction")
    # Then ancestry changes while actual execution selection and inputs are retained.
    assert linked.parent_id == prior.id
    assert linked.attempt == 1
    assert linked.selected_case_ids == prior.selected_case_ids
    with pytest.raises(InvalidArtifactError, match="rerun_identity_cycle"):
        _ = link_rerun(prior, prior, suite, "diagnostic reproduction")
