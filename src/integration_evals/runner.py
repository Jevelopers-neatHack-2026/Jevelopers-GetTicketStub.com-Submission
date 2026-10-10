"""Orchestrate pinned owner cases and preserve exact composed-run evidence."""

import os
import sys
from datetime import UTC, datetime
from uuid import uuid4

from integration_evals.artifacts import digest, read_bytes
from integration_evals.errors import fail
from integration_evals.execution import OwnerContext, OwnerExecution, Settings, blocked
from integration_evals.models import Assembly, Catalog, Run, Suite
from integration_evals.owner import execute_owner
from integration_evals.preflight import PreflightContext, case_blocker
from integration_evals.reporting import validate_evidence
from integration_evals.validation import git_value, source_fingerprint, validate_assembly


def execute(suite: Suite, catalog: Catalog, settings: Settings) -> Run:
    """Execute every selected case while preserving exact pins and missing prerequisites."""
    path = settings.assembly_path
    assembly = Assembly.model_validate_json(read_bytes(path)) if path else None
    catalog_digest = digest(catalog.model_dump_json().encode())
    if assembly is not None:
        validate_assembly(assembly, settings.workspace, catalog_digest)
        if git_value(settings.repository, "rev-parse", "HEAD") != assembly.integration_revision:
            fail("runner_revision_not_in_assembly", "integration-evals")
        if git_value(settings.repository, "status", "--porcelain", "--untracked-files=all"):
            fail("dirty_integration_runner", "integration-evals")
    run_id = "run-" + uuid4().hex
    clock = datetime(2026, 10, 10, tzinfo=UTC)
    executions: list[OwnerExecution] = []
    preflight = PreflightContext(settings.mode, os.environ, sys.platform, settings.authorize_paid)
    for case in suite.cases:
        if assembly is None:
            receipt = OwnerExecution(
                blocked(
                    case,
                    settings.mode,
                    "getticketstub.com",
                    "app-owned composed release manifest unavailable",
                )
            )
        else:
            blocker = case_blocker(case, assembly.providers, preflight)
            receipt = (
                OwnerExecution(blocked(case, settings.mode, blocker.owner, blocker.reason))
                if blocker
                else execute_owner(case, OwnerContext(assembly, settings, run_id, clock))
            )
        executions.append(receipt)
    run = Run(
        id=run_id,
        started_at=datetime.now(UTC),
        context=settings.context,
        integration_revision=git_value(settings.repository, "rev-parse", "HEAD"),
        source_digest=source_fingerprint(settings.repository),
        working_tree_dirty=bool(git_value(settings.repository, "status", "--porcelain")),
        manifest_digest=digest(read_bytes(path)) if path else digest(b"absent"),
        suite_digest=digest(suite.model_dump_json().encode()),
        fixture_digest=catalog_digest,
        configuration_digest=assembly.configuration_digest if assembly else digest(b"offline"),
        runtime=sys.version,
        seed=settings.seed,
        clock=clock,
        components=assembly.components if assembly else (),
        providers=assembly.providers if assembly else (),
        results=tuple(execution.result for execution in executions),
        evidence=tuple(item for execution in executions for item in execution.evidence),
        limitations=("Product acceptance requires reviewed evidence for every composed boundary.",),
    )
    validate_evidence(run.evidence, settings.workspace, run)
    return run
