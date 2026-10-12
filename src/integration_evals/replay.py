"""Bounded diagnostic reruns preserve failed history and immutable execution inputs."""

from datetime import datetime
from typing import Final, assert_never

from pydantic import Field

from integration_evals.artifacts import reject_leaks
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


def run_history(prior: Run | tuple[Run, ...]) -> tuple[Run, ...]:
    """Keep original-only callers while requiring all ancestors for diagnostics."""
    match prior:
        case Run():
            return (prior,)
        case tuple():
            return prior
        case _:
            assert_never(prior)


def validate_history(history: tuple[Run, ...], suite: Suite) -> None:
    """Validate recorded ancestry and inputs without authorizing any execution."""
    if not history or len(history) > MAX_DIAGNOSTIC_RERUNS + 1:
        fail("rerun_history_size", "history")
    seen: set[str] = set()
    for index, run in enumerate(history):
        validate_run(run, suite)
        if run.id in seen:
            fail("rerun_identity_cycle", run.id)
        seen.add(run.id)
        parent = history[index - 1] if index else None
        if run.attempt != index or run.parent_id != (parent.id if parent else None):
            fail("rerun_history_incomplete", run.id)
        if run.started_at.utcoffset() is None:
            fail("rerun_timestamp_invalid", run.id)
        if parent is not None:
            if not run.rationale or not run.rationale.strip():
                fail("rerun_limit_or_rationale", run.id)
            if run.started_at <= parent.started_at:
                fail("rerun_timestamp_invalid", run.id)
            validate_rerun_inputs(parent, run)


def authorize_rerun(prior: Run | tuple[Run, ...], suite: Suite, rationale: str) -> None:
    """Fail closed until receipts carry typed failure/category/quarantine proof.

    Outcome and human prose cannot establish safe diagnostic execution. This API
    remains a denial boundary; record-only linking never calls or bypasses it.
    """
    history = run_history(prior)
    validate_history(history, suite)
    latest = history[-1]
    if latest.attempt >= MAX_DIAGNOSTIC_RERUNS or not rationale.strip():
        fail("rerun_limit_or_rationale", latest.id)
    reject_leaks(rationale.encode(), latest.id)
    selected = set(latest.selected_case_ids)
    if any(
        result.mode in {Mode.SANDBOX, Mode.LIVE} for run in history for result in run.results
    ) or any(
        provider.mode in {Mode.SANDBOX, Mode.LIVE} for run in history for provider in run.providers
    ):
        fail("real_provider_rerun_requires_owner_reconciliation", latest.id)
    if any(
        case.id in selected
        and (case.safety or "ambiguous" in case.id or case.id in NO_AUTOMATIC_RERUN_CASES)
        for case in suite.cases
    ):
        fail("safety_or_ambiguity_rerun_forbidden", latest.id)
    if any(
        result.outcome is not Outcome.FAILED
        for run in history
        for result in run.results
        if result.case_id in selected
    ):
        fail("rerun_requires_failed_history", latest.id)
    fail("rerun_failure_provenance_missing", latest.id)


def validate_rerun_inputs(prior: Run, candidate: Run) -> None:
    """Bind every recorded attempt to the same immutable execution identity."""
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


def link_rerun(prior: Run | tuple[Run, ...], candidate: Run, suite: Suite, rationale: str) -> Run:
    """Bind an already executed receipt; this grants no rerun/dispatch authority.

    Supply the complete original-first history. Preserve it alongside the returned
    receipt: a later pass does not replace, authorize or clear an earlier failure.
    """
    history = run_history(prior)
    validate_history(history, suite)
    latest = history[-1]
    if latest.attempt >= MAX_DIAGNOSTIC_RERUNS or not rationale.strip():
        fail("rerun_limit_or_rationale", latest.id)
    reject_leaks(rationale.encode(), latest.id)
    if candidate.parent_id is not None or candidate.attempt != 0 or candidate.rationale is not None:
        fail("rerun_candidate_already_linked", candidate.id)
    linked = candidate.model_copy(
        update={"parent_id": latest.id, "attempt": latest.attempt + 1, "rationale": rationale}
    )
    validate_history((*history, linked), suite)
    return linked


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
