"""Synthetic policy receipts; these never establish component acceptance."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from integration_evals.artifacts import digest, load_record
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import Settings
from integration_evals.models import (
    Assertion,
    Case,
    CaseId,
    CaseResult,
    Catalog,
    Component,
    Evidence,
    Mode,
    Origin,
    Outcome,
    RequirementId,
    Run,
    Status,
    Suite,
)
from integration_evals.replay import authorize_rerun, link_rerun, validate_history
from integration_evals.runner import execute

REPOSITORY = Path(__file__).resolve().parents[1]


@pytest.fixture
def synthetic_failure() -> tuple[Run, Suite]:
    case = Case(
        id=CaseId("functional"),
        requirements=(RequirementId("IE-09B.AC2"),),
        fixtures=(),
        component="synthetic-owner",
        interface="offline-test",
        invariant="expected observation",
        assertions=(Assertion(observation="value", expected=1),),
        artifacts=("result.json",),
        modes=(Mode.MOCK,),
    )
    suite = Suite(cases=(case,))
    run = Run(
        id="synthetic-original",
        started_at=datetime(2026, 10, 10, tzinfo=UTC),
        context="local",
        selected_case_ids=(case.id,),
        integration_revision="1" * 40,
        source_digest=digest(b"source"),
        working_tree_dirty=False,
        manifest_digest=digest(b"manifest"),
        suite_digest=digest(suite.model_dump_json().encode()),
        fixture_digest=digest(b"fixtures"),
        configuration_digest=digest(b"configuration"),
        runtime="synthetic",
        seed=17,
        clock=datetime(2026, 10, 10, tzinfo=UTC),
        components=(
            Component(
                repository=case.component,
                revision="2" * 40,
                tree="3" * 40,
                lockfile_path="lock",
                lockfile_digest=digest(b"lock"),
            ),
        ),
        providers=(),
        results=(
            CaseResult(
                case_id=case.id,
                requirements=case.requirements,
                outcome=Outcome.FAILED,
                criterion_status=Status.IN_PROGRESS,
                mode=Mode.MOCK,
                origin=Origin.SYNTHETIC,
                duration_seconds=0.1,
                reason="observation mismatch: value",
                exit_code=0,
                cleanup_status="passed",
                output_digest=digest(b"synthetic observation"),
                evidence_ids=("synthetic-evidence",),
            ),
        ),
    )
    evidence = Evidence(
        id="synthetic-evidence",
        requirement=case.requirements[0],
        case_id=case.id,
        run_id=run.id,
        component=case.component,
        revision="2" * 40,
        created_at=run.started_at,
        original_cutoff=run.clock,
        mode=Mode.MOCK,
        origin=Origin.SYNTHETIC,
        path="result.json",
        sha256=digest(b"synthetic observation"),
        permission_ref="synthetic-test",
        redaction_ref="synthetic-test",
        reviewer_access_ref="synthetic-test",
        kind="evaluation",
    )
    return run.model_copy(update={"evidence": (evidence,)}), suite


def test_rejects_when_actual_runner_has_only_skips() -> None:
    # Given an actual runner receipt with no supplied assembly.
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    prior = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    assert all(result.outcome is Outcome.SKIPPED for result in prior.results)
    # When asking to rerun without an original failure.
    with pytest.raises(InvalidArtifactError):
        authorize_rerun(prior, suite, "diagnostic reproduction")
    # Then no skipped or blocked execution is authorized as a failed original.


def test_rejects_when_failed_receipt_has_unknown_failure_kind(
    synthetic_failure: tuple[Run, Suite],
) -> None:
    # Given a synthetic failure whose prose claims a functional mismatch.
    prior, suite = synthetic_failure
    # When asking for permission without typed failure provenance.
    with pytest.raises(InvalidArtifactError):
        authorize_rerun(prior, suite, "safe functional retry")
    # Then neither outcome nor human prose can supply missing authorization proof.


def test_rejects_when_only_latest_diagnostic_is_supplied(
    synthetic_failure: tuple[Run, Suite],
) -> None:
    # Given a latest-only attempt that omits its original receipt.
    prior, suite = synthetic_failure
    prior = prior.model_copy(update={"attempt": 1, "parent_id": "omitted-original"})
    # When asking for another diagnostic using incomplete ancestry.
    with pytest.raises(InvalidArtifactError):
        authorize_rerun(prior, suite, "diagnostic reproduction")
    # Then an unknown earlier outcome cannot be silently treated as failed.


def test_rejects_when_original_identity_resets_its_ancestry(
    synthetic_failure: tuple[Run, Suite],
) -> None:
    # Given a receipt with attempt zero but an existing parent.
    prior, suite = synthetic_failure
    prior = prior.model_copy(update={"parent_id": "omitted-original"})
    # When asking to treat that receipt as the first run.
    with pytest.raises(InvalidArtifactError):
        authorize_rerun(prior, suite, "diagnostic reproduction")
    # Then the diagnostic cap cannot be reset by inconsistent original metadata.


def later(run: Run, outcome: Outcome = Outcome.FAILED) -> Run:
    """Create a synthetic separately executed receipt; never run an owner command."""
    identity = f"{run.id}-next"
    return run.model_copy(
        update={
            "id": identity,
            "started_at": run.started_at + timedelta(seconds=1),
            "attempt": 0,
            "parent_id": None,
            "rationale": None,
            "results": tuple(
                result.model_copy(
                    update={
                        "outcome": outcome,
                        "criterion_status": Status.BLOCKED
                        if outcome is Outcome.SKIPPED
                        else Status.IN_PROGRESS,
                    }
                )
                for result in run.results
            ),
            "evidence": tuple(
                item.model_copy(update={"run_id": identity}) for item in run.evidence
            ),
        }
    )


@pytest.mark.parametrize("outcome", tuple(Outcome))
def test_records_every_outcome_without_granting_authority(
    synthetic_failure: tuple[Run, Suite],
    outcome: Outcome,
    tmp_path: Path,
) -> None:
    # Given an original functional-shaped failure and a later synthetic receipt.
    original, suite = synthetic_failure
    candidate = later(original, outcome)
    before = (original.model_dump_json(), candidate.model_dump_json())
    # When recording the later result.
    linked = link_rerun(original, candidate, suite, "offline diagnostic observation")
    # Then complete history keeps the original, every outcome and immutable inputs.
    assert (linked.parent_id, linked.attempt, linked.results[0].outcome) == (
        original.id,
        1,
        outcome,
    )
    assert (original.model_dump_json(), candidate.model_dump_json()) == before
    for name, receipt in (("original", original), ("candidate", candidate), ("linked", linked)):
        _ = (tmp_path / f"{name}.json").write_text(receipt.model_dump_json(indent=2))
    _ = (tmp_path / "suite.json").write_text(suite.model_dump_json(indent=2))
    with pytest.raises(InvalidArtifactError):
        authorize_rerun((original, linked), suite, "another attempt")


def test_rejects_authority_when_fail_pass_fail_history_is_complete_or_truncated(
    synthetic_failure: tuple[Run, Suite],
) -> None:
    # Given a recorded fail-pass-fail sequence with unchanged pins.
    original, suite = synthetic_failure
    passed = link_rerun(original, later(original, Outcome.PASSED), suite, "first diagnostic")
    failed = link_rerun((original, passed), later(passed), suite, "second diagnostic")
    # When examining the supplied full history or attempted omissions.
    for history in ((original, passed), (original, passed, failed), (failed,), (original, failed)):
        with pytest.raises(InvalidArtifactError):
            authorize_rerun(history, suite, "retry")
    # Then a later failure cannot hide a pass or reset the count.
    assert tuple(run.results[0].outcome for run in (original, passed, failed)) == (
        Outcome.FAILED,
        Outcome.PASSED,
        Outcome.FAILED,
    )


@pytest.mark.parametrize(
    "mutation",
    ["attempt", "parent_id", "id", "started_at", "backward", "naive", "rationale", "private"],
)
def test_rejects_when_recorded_ancestry_is_invalid(
    synthetic_failure: tuple[Run, Suite],
    mutation: str,
) -> None:
    # Given an otherwise consistent first diagnostic.
    original, suite = synthetic_failure
    linked = link_rerun(original, later(original), suite, "diagnostic")
    changes = {
        "attempt": 0,
        "parent_id": None,
        "id": original.id,
        "started_at": original.started_at,
        "rationale": " ",
        "backward": original.started_at - timedelta(seconds=1),
        "naive": original.started_at.replace(tzinfo=None),
        "private": "IE_SECRET_CANARY_history",
    }
    field = {"backward": "started_at", "naive": "started_at", "private": "rationale"}.get(
        mutation, mutation
    )
    corrupted = linked.model_copy(update={field: changes[mutation]})
    # When validating an altered historical record.
    with pytest.raises(InvalidArtifactError):
        validate_history((original, corrupted), suite)
    # Then reset, cycle, ordering and rationale defects are rejected.


@pytest.mark.parametrize("history_size", [0, 4])
def test_rejects_when_history_is_empty_or_over_cap(
    synthetic_failure: tuple[Run, Suite],
    history_size: int,
) -> None:
    # Given an empty or oversized supplied history.
    original, suite = synthetic_failure
    # When validating it for record-only use.
    with pytest.raises(InvalidArtifactError, match="rerun_history_size"):
        validate_history((original,) * history_size, suite)
    # Then record binding cannot exceed original plus two diagnostics.


@pytest.mark.parametrize(
    "reason", ["environment", "ambiguous dispatch", "quarantine", "test failure"]
)
def test_rejects_when_human_prose_claims_failure_kind(
    synthetic_failure: tuple[Run, Suite],
    reason: str,
) -> None:
    # Given untyped prose on an otherwise functional-shaped failed receipt.
    original, suite = synthetic_failure
    prior = original.model_copy(
        update={"results": (original.results[0].model_copy(update={"reason": reason}),)}
    )
    # When asking to authorize a rerun.
    with pytest.raises(InvalidArtifactError, match="rerun_failure_provenance_missing"):
        authorize_rerun(prior, suite, "safe approved retry")
    # Then no string spelling or claimed human approval manufactures provenance.


@pytest.mark.parametrize("rationale", ["IE_SECRET_CANARY_test", "IE_PII_CANARY_test"])
def test_rejects_private_rationale_before_linking(
    synthetic_failure: tuple[Run, Suite],
    rationale: str,
) -> None:
    # Given a valid record and sensitive new rationale.
    original, suite = synthetic_failure
    # When recording a new attempt.
    with pytest.raises(InvalidArtifactError, match="sensitive_content") as error:
        _ = link_rerun(original, later(original), suite, rationale)
    # Then rejected values are not echoed by the public diagnostic.
    assert rationale not in str(error.value)
