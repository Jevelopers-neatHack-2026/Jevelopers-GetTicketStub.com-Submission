"""Bounded diagnostic reruns preserve failed history and immutable execution inputs."""

from datetime import datetime
from typing import Final

from pydantic import Field

from integration_evals.errors import fail
from integration_evals.models import Mode, Outcome, Record, Run, Suite
from integration_evals.report_validation import validate_run

MAX_DIAGNOSTIC_RERUNS: Final = 2
# Semantic guard for cases whose frozen `safety` flag is false but whose retry would repeat
# an ambiguous supplier dispatch, an externally succeeded side effect or an authorization change.
NO_AUTOMATIC_RERUN_CASES: Final = frozenset(
    {"supplier-ambiguity", "restart-after-external-success", "authorization-mutation"}
)


class Flake(Record):
    """A quarantined case remains a release blocker with a measured denominator."""

    case_id: str
    requirement: str
    failing_runs: tuple[str, ...] = Field(min_length=1)
    observed_runs: int = Field(ge=1)
    last_good_revision: str | None
    last_bad_revision: str
    failure_signature: str
    owner: str
    remediation_issue: str
    quarantine_reason: str
    expires_at: datetime
    reproduction_command: tuple[str, ...] = Field(min_length=1)


def authorize_rerun(prior: Run, suite: Suite, rationale: str) -> None:
    """Forbid automatic safety, paid or ambiguous-dispatch retries."""
    validate_run(prior, suite)
    if prior.attempt >= MAX_DIAGNOSTIC_RERUNS or not rationale.strip():
        fail("rerun_limit_or_rationale", prior.id)
    if any(result.mode in {Mode.SANDBOX, Mode.LIVE} for result in prior.results):
        fail("real_provider_rerun_requires_owner_reconciliation", prior.id)
    safety = {
        case.id
        for case in suite.cases
        if case.safety or "ambiguous" in case.id or case.id in NO_AUTOMATIC_RERUN_CASES
    }
    if any(
        result.case_id in safety and result.outcome in {Outcome.ERROR, Outcome.FAILED}
        for result in prior.results
    ):
        fail("safety_or_ambiguity_rerun_forbidden", prior.id)


def link_rerun(prior: Run, candidate: Run, suite: Suite, rationale: str) -> Run:
    """Bind a separately executed receipt to its original failed attempt."""
    authorize_rerun(prior, suite, rationale)
    validate_run(candidate, suite)
    fingerprints = (
        "integration_revision",
        "source_digest",
        "manifest_digest",
        "suite_digest",
        "fixture_digest",
        "configuration_digest",
        "seed",
        "clock",
        "components",
        "providers",
        "working_tree_dirty",
        "context",
        "scope",
        "selected_case_ids",
        "runtime",
    )
    if any(getattr(prior, field) != getattr(candidate, field) for field in fingerprints):
        fail("rerun_input_drift", prior.id)
    if tuple((result.case_id, result.mode) for result in prior.results) != tuple(
        (result.case_id, result.mode) for result in candidate.results
    ):
        fail("rerun_selection_drift", prior.id)
    if prior.id == candidate.id:
        fail("rerun_identity_cycle", prior.id)
    return candidate.model_copy(
        update={"parent_id": prior.id, "attempt": prior.attempt + 1, "rationale": rationale}
    )


def validate_flake(flake: Flake) -> None:
    """Reject hidden quarantine and unsupported failure frequency claims."""
    if (
        len(set(flake.failing_runs)) != len(flake.failing_runs)
        or len(flake.failing_runs) > flake.observed_runs
    ):
        fail("invalid_flake_denominator", flake.case_id)
    if not all(
        (flake.owner, flake.remediation_issue, flake.quarantine_reason, flake.failure_signature)
    ):
        fail("unowned_quarantine", flake.case_id)
    if flake.expires_at.utcoffset() is None:
        fail("quarantine_timezone_missing", flake.case_id)
