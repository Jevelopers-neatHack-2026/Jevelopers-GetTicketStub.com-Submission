from datetime import timedelta
from pathlib import Path

import pytest

from integration_evals.artifacts import digest, load_record
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import Settings
from integration_evals.models import CaseId, Catalog, Component, Mode, Outcome, Provider, Run, Suite
from integration_evals.replay import authorize_rerun, link_rerun
from integration_evals.runner import execute

REPOSITORY = Path(__file__).resolve().parents[1]


def test_rerun_rejects_when_source_inputs_drift() -> None:
    # Given two receipts with different source content fingerprints.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    candidate = prior.model_copy(
        update={
            "id": "run-rerun",
            "started_at": prior.started_at + timedelta(seconds=1),
            "source_digest": digest(b"different-source"),
        }
    )
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
    first = link_rerun(
        prior,
        prior.model_copy(
            update={"id": "first", "started_at": prior.started_at + timedelta(seconds=1)}
        ),
        suite,
        "first diagnostic record",
    )
    second = link_rerun(
        (prior, first),
        prior.model_copy(
            update={"id": "second", "started_at": prior.started_at + timedelta(seconds=2)}
        ),
        suite,
        "second diagnostic record",
    )
    # When requesting another retry.
    with pytest.raises(InvalidArtifactError, match="rerun_limit_or_rationale"):
        authorize_rerun((prior, first, second), suite, "try again")
    # Then failed history cannot be hidden behind unlimited retries.


@pytest.mark.parametrize(
    "change",
    [
        "selected_case_ids",
        "scope",
        "runtime",
        "context",
        "mode",
        "seed",
        "clock",
        "integration_revision",
        "manifest_digest",
        "fixture_digest",
        "configuration_digest",
        "working_tree_dirty",
        "providers",
        "components",
        "suite_digest",
    ],
)
def test_rerun_rejects_when_execution_scope_changes(change: str) -> None:
    # Given an unchanged declared suite and an actual subset/environment mutation.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    candidate = prior.model_copy(
        update={"id": "run-rerun", "started_at": prior.started_at + timedelta(seconds=1)}
    )
    changes = {
        "selected_case_ids": prior.selected_case_ids[:1],
        "scope": "component",
        "runtime": "different runtime",
        "context": "ci",
        "seed": prior.seed + 1,
        "clock": prior.clock + timedelta(seconds=1),
        "integration_revision": "a" * 40,
        "manifest_digest": digest(b"changed-manifest"),
        "fixture_digest": digest(b"changed-fixtures"),
        "configuration_digest": digest(b"changed-configuration"),
        "working_tree_dirty": not prior.working_tree_dirty,
        "providers": (Provider(id="provider", mode=Mode.MOCK, model="synthetic"),),
        "components": (
            Component(
                repository="changed",
                revision="a" * 40,
                tree="b" * 40,
                lockfile_path="lock",
                lockfile_digest=digest(b"changed-lock"),
            ),
        ),
        "suite_digest": digest(b"changed-suite"),
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
    with pytest.raises(
        InvalidArtifactError,
        match=r"rerun_input_drift|rerun_selection_drift|archived_suite_pin_mismatch",
    ):
        _ = link_rerun(prior, candidate, suite, "diagnostic reproduction")
    # Then retaining all declared rows cannot hide changed selected execution inputs.


def test_record_links_without_authorization_when_frozen_inputs_match() -> None:
    # Given a new receipt with the same complete execution identity.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    candidate = prior.model_copy(
        update={"id": "run-rerun", "started_at": prior.started_at + timedelta(seconds=1)}
    )
    original_bytes = prior.model_dump_json()
    # When recording an already executed attempt without authorizing another.
    linked = link_rerun(prior, candidate, suite, "diagnostic reproduction")
    # Then ancestry changes while actual execution selection and inputs are retained.
    assert linked.parent_id == prior.id
    assert linked.attempt == 1
    assert linked.selected_case_ids == prior.selected_case_ids
    assert prior.model_dump_json() == original_bytes
    with pytest.raises(InvalidArtifactError):
        authorize_rerun(prior, suite, "diagnostic reproduction")
    with pytest.raises(InvalidArtifactError, match="rerun_identity_cycle"):
        _ = link_rerun(prior, prior, suite, "diagnostic reproduction")


@pytest.mark.parametrize("mode", [Mode.SANDBOX, Mode.LIVE])
@pytest.mark.parametrize("location", ["providers", "results"])
def test_rejects_when_any_real_provider_mode_is_declared(mode: Mode, location: str) -> None:
    # Given an actual blocked receipt with a synthetic real-provider declaration.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    changes = {
        "providers": (Provider(id="provider", mode=mode, model="synthetic"),),
        "results": tuple(result.model_copy(update={"mode": mode}) for result in prior.results),
    }
    prior = prior.model_copy(update={location: changes[location]})
    # When requesting a diagnostic without owner reconciliation.
    with pytest.raises(
        InvalidArtifactError, match="real_provider_rerun_requires_owner_reconciliation"
    ):
        authorize_rerun(prior, suite, "diagnostic")
    # Then mode declarations cannot be ignored even when selected execution is blocked.


@pytest.mark.parametrize("mutation", ["parent_id", "attempt", "rationale", "started_at"])
def test_rejects_when_candidate_has_existing_link_or_naive_timestamp(mutation: str) -> None:
    # Given an already recorded or chronologically ambiguous synthetic candidate.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    changes = {
        "parent_id": prior.id,
        "attempt": 1,
        "rationale": "earlier rationale",
        "started_at": prior.started_at.replace(tzinfo=None),
    }
    candidate = prior.model_copy(update={"id": "new", mutation: changes[mutation]})
    # When binding it to the original history.
    with pytest.raises(InvalidArtifactError):
        _ = link_rerun(prior, candidate, suite, "diagnostic")
    # Then existing ancestry cannot be overwritten and naive timestamps cannot order attempts.


def test_rejects_repeated_latest_only_linking() -> None:
    # Given one linked diagnostic and an attempted next record without the original.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    original = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    candidate = original.model_copy(
        update={"id": "new", "started_at": original.started_at + timedelta(seconds=1)}
    )
    first = link_rerun(original, candidate, suite, "first diagnostic")
    # When only that latest receipt is supplied again.
    with pytest.raises(InvalidArtifactError, match="rerun_history_incomplete"):
        _ = link_rerun(first, candidate, suite, "another diagnostic")
    # Then latest-only callers fail closed instead of resetting ancestry.


def _prior_with_failure(case_id: str, outcome: Outcome = Outcome.FAILED) -> tuple[Suite, Run]:
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    prior = prior.model_copy(
        update={
            "results": tuple(
                result.model_copy(update={"outcome": outcome})
                if result.case_id == case_id
                else result
                for result in prior.results
            )
        }
    )
    return suite, prior.model_copy(update={"selected_case_ids": (CaseId(case_id),)})


@pytest.mark.parametrize("outcome", [Outcome.FAILED, Outcome.ERROR])
@pytest.mark.parametrize(
    "case_id", ["supplier-ambiguity", "restart-after-external-success", "authorization-mutation"]
)
def test_rerun_rejects_semantically_unsafe_cases_despite_unflagged_safety(
    case_id: str, outcome: Outcome
) -> None:
    # Given a failed case whose frozen safety flag is false but whose retry is unsafe.
    suite, prior = _prior_with_failure(case_id, outcome)
    assert not next(case for case in suite.cases if case.id == case_id).safety
    assert len(suite.cases) == 42
    # When requesting a diagnostic rerun.
    with pytest.raises(InvalidArtifactError, match="safety_or_ambiguity_rerun_forbidden"):
        authorize_rerun(prior, suite, "try again")
    # Then the original failing history is preserved without automatic retry.


def test_rerun_rejects_ordinary_failed_case_without_typed_provenance() -> None:
    # Given an ordinary non-safety failure.
    suite, prior = _prior_with_failure("happy-path")
    # When requesting a bounded diagnostic rerun.
    with pytest.raises(InvalidArtifactError, match="rerun_failure_provenance_missing"):
        authorize_rerun(prior, suite, "diagnostic reproduction")
    # Then untyped failures grant no authority and the failed status is untouched.
    assert any(r.case_id == "happy-path" and r.outcome is Outcome.FAILED for r in prior.results)
