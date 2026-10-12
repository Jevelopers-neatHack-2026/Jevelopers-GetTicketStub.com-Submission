"""Pure recorded evaluator comparison; never redispatch an owner or provider command."""

import sys
from datetime import UTC, datetime
from time import monotonic
from uuid import uuid4

from integration_evals.artifacts import digest, reject_leaks
from integration_evals.comparison_archive import bundle_bytes
from integration_evals.errors import fail
from integration_evals.execution import ComparisonCapture
from integration_evals.history import History, validate_record
from integration_evals.models import Mode, Outcome, Run, Suite
from integration_evals.owner import compare_response
from integration_evals.replay import MAX_DIAGNOSTIC_RERUNS, NO_AUTOMATIC_RERUN_CASES, link_rerun
from integration_evals.report_validation import validate_evidence
from integration_evals.reporting import OwnerResponse


def replay_comparisons(
    history: History, captures: tuple[ComparisonCapture, ...], suite: Suite
) -> Run:
    """Reexecute the existing oracle on immutable captured bytes, preserving source evidence IDs.

    Captures are process-held or hash-bound archive inputs with unverified source authenticity.
    This is evaluation replay, not a second observation of owner behavior.
    """
    validate_record(history, suite)
    original = history.runs[0]
    if original.runtime != sys.version:
        fail("diagnostic_runtime_drift", "history")
    if captures and digest(bundle_bytes(captures)) != original.comparison_digest:
        fail("comparison_bundle_mismatch", "history")
    if history.quarantines or len(history.runs) > MAX_DIAGNOSTIC_RERUNS:
        fail("diagnostic_quarantine_or_limit", "history")
    selected = set(original.selected_case_ids)
    if {capture.case.id for capture in captures} != selected or len(captures) != len(selected):
        fail("diagnostic_capture_missing", "history")
    if any(
        result.outcome is not Outcome.FAILED
        or result.evaluation_failure != "oracle-mismatch"
        or result.evaluation_category != "recorded-comparison"
        for run in history.runs
        for result in run.results
        if result.case_id in selected
    ):
        fail("diagnostic_requires_captured_mismatch", "history")
    if any(
        result.cleanup_status != "passed"
        for result in original.results
        if result.case_id in selected
    ):
        fail("diagnostic_cleanup_missing", "history")
    if any(provider.mode in {Mode.SANDBOX, Mode.LIVE} for provider in original.providers):
        fail("diagnostic_external_provider", "history")
    results = {result.case_id: result for result in original.results}
    for capture in captures:
        case, context = capture.case, capture.context
        response = _validate_capture(capture, original, suite)
        started = monotonic()
        outcome, reason = compare_response(case, response, context)
        results[case.id] = results[case.id].model_copy(
            update={
                "exit_code": None,
                "cleanup_status": "not-run",
                "cost": None,
                "cost_status": "unknown",
                "outcome": outcome,
                "reason": reason,
                "duration_seconds": monotonic() - started,
                "evaluation_failure": "oracle-mismatch" if outcome is Outcome.FAILED else None,
            }
        )
    candidate = original.model_copy(
        update={
            "id": "evaluation-" + uuid4().hex,
            "started_at": datetime.now(UTC),
            "execution_kind": "recorded-evaluation-replay",
            "evaluation_source_run": original.id,
            "comparison_digest": original.comparison_digest,
            "results": tuple(results[result.case_id] for result in original.results),
            "limitations": (
                *original.limitations,
                "Recorded oracle replay; no owner/provider re-execution or fresh source evidence.",
            ),
        }
    )
    return link_rerun(history.runs, candidate, suite, "recorded evaluation comparison")


def _validate_capture(capture: ComparisonCapture, original: Run, suite: Suite) -> OwnerResponse:
    """Validate one immutable oracle input before comparison, without trusting prose."""
    case, context = capture.case, capture.context
    if case not in suite.cases or context.run_id != original.id:
        fail("diagnostic_capture_identity", "history")
    if case.category != "functional" or case.quarantined is not False:
        fail("diagnostic_category_or_quarantine_unproven", case.id)
    if case.safety or "ambiguous" in case.id or case.id in NO_AUTOMATIC_RERUN_CASES:
        fail("safety_or_ambiguity_rerun_forbidden", case.id)
    if (
        context.settings.mode not in {Mode.MOCK, Mode.RECORDED}
        or case.provider_ids
        or case.operations
    ):
        fail("diagnostic_external_provider", case.id)
    if (
        context.assembly.components != original.components
        or context.settings.seed != original.seed
        or context.clock != original.clock
        or context.assembly.providers != original.providers
        or context.assembly.configuration_digest != original.configuration_digest
        or context.assembly.fixture_digest != original.fixture_digest
        or context.assembly.integration_revision != original.integration_revision
    ):
        fail("diagnostic_capture_identity", case.id)
    reject_leaks(capture.response_json, case.id)
    response = OwnerResponse.model_validate_json(capture.response_json)
    if response.evidence != tuple(item for item in original.evidence if item.case_id == case.id):
        fail("diagnostic_capture_evidence", case.id)
    validate_evidence(response.evidence, context.settings.artifacts, original)
    return response
