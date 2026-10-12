import os
from pathlib import Path

import pytest

from component_tests.print_checks import assert_outcome
from component_tests.print_protocol import Mutation, protocol_control
from component_tests.print_workspace import workspace_at
from integration_evals.artifacts import load_record, read_bytes
from integration_evals.execution import Settings
from integration_evals.models import Catalog, Outcome, Run, Status, Suite
from integration_evals.print_setup import CONFIGURATION_PATH, PROFILE_PATH
from integration_evals.processes import TestInvocation as RuntimeInvocation
from integration_evals.release import audit, export_audit
from integration_evals.reporting import Tracker, save_run
from integration_evals.runner import execute
from integration_evals.specifications import Requirements


@pytest.fixture(scope="module")
def print_invocation() -> RuntimeInvocation | None:
    return None


@pytest.fixture(scope="module")
def verified_print_workspace(
    tmp_path_factory: pytest.TempPathFactory, print_invocation: RuntimeInvocation | None
) -> Path:
    # Given the original case, original fixture bytes and reviewed source configuration.
    workspace = workspace_at(
        tmp_path_factory.mktemp("print-consumer").resolve(),
        browser_in_container=print_invocation is not None,
    )
    repository = workspace / "integration-evals"
    suite = load_record(repository / "scenarios/suite.json", Suite)
    catalog = load_record(repository / "fixtures/catalog.json", Catalog)
    tracker = load_record(repository / "planning/acceptance-checklist.json", Tracker)
    settings = Settings(
        repository, workspace, workspace / "assembly.json", test_invocation=print_invocation
    )
    destination = Path(os.environ["IE_PRINT_EVIDENCE"]).resolve()
    inputs = destination / "inputs"
    inputs.mkdir(parents=True, exist_ok=False)
    for source in (
        workspace / "assembly.json",
        repository / CONFIGURATION_PATH,
        repository / PROFILE_PATH,
    ):
        _ = (inputs / source.name).write_bytes(read_bytes(source))
    # When the existing evaluator owns invocation, process teardown, capture and cleanup.
    run = execute(suite, catalog, settings)
    archive = save_run(run, destination / "negative", tracker, suite, settings.artifacts)
    saved = load_record(archive / "run.json", Run)
    requirements = load_record(repository / "planning/requirements.json", Requirements)
    release = audit(saved, tracker, requirements, suite)
    export_audit(release, archive / "release-audit.json")
    # Then failure remains captured, and only an actual quarantine can satisfy this case.
    selected = next(result for result in saved.results if result.case_id == "print-invalid")
    assert len(saved.results) == 42
    assert len(catalog.fixtures) == 20
    assert len(tracker.criteria) == 47
    assert len(release.obligations) == 142
    assert release.product_acceptance == "blocked"
    assert all(
        result.criterion_status is Status.PLANNED
        for result in saved.results
        if result.case_id != "print-invalid"
    )
    assert selected.outcome is Outcome.PASSED, selected.reason
    assert selected.exit_code == 0
    assert selected.cleanup_status == "passed"
    assert selected.cost is None
    assert selected.cost_status == "unknown"
    assert_outcome(saved, archive, repository)
    return workspace


@pytest.mark.parametrize(
    "mutation", ["schema", "hash", "runtime", "case", "mode", "replay", "cleanup-lock", "positive"]
)
def test_print_protocol_rejects_unsupported_inputs(
    verified_print_workspace: Path, mutation: Mutation, print_invocation: RuntimeInvocation | None
) -> None:
    # Given an exact reviewed owner snapshot and a single scoped protocol change.
    # When the real source command runs under the unchanged evaluator containment.
    # Then the control checks the actual exit, response and cleanup, preserving diagnostics.
    protocol_control(
        verified_print_workspace,
        mutation,
        Path(os.environ["IE_PRINT_EVIDENCE"]) / "protocol",
        test_invocation=print_invocation,
    )
