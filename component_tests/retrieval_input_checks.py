"""Verify evaluator-owned staging provenance without changing retrieval outcome oracles."""

import os
from pathlib import Path

from integration_evals.artifacts import digest, load_record, read_bytes
from integration_evals.contract_records import ContractRuntime
from integration_evals.execution import Settings
from integration_evals.models import Run
from integration_evals.retrieval_inputs import RetrievalInputRecord
from integration_evals.validation import git_value


def capture_input_record(run: Run, settings: Settings, mutation: str) -> Path:
    path = settings.artifacts / "input-staging" / run.id / "ssrf-egress.json"
    if destination := os.environ.get("IE_COMPONENT_EVIDENCE"):
        target = Path(destination) / "input-staging" / f"{mutation}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        if path.is_file():
            _ = target.write_bytes(read_bytes(path))
    return path


def assert_input_origin(path: Path, run: Run, workspace: Path) -> None:
    inputs = load_record(path, RetrievalInputRecord)
    runtime = load_record(Path(os.environ["IE_CONTRACT_RUNTIME"]), ContractRuntime)
    assert inputs.runtime_sha256 == runtime.sha256
    assert inputs.evaluator_revision == run.integration_revision
    assert inputs.producer_revision == git_value(
        workspace / "event-intelligence", "rev-parse", "HEAD"
    )
    for source in (workspace / "integration-evals", workspace / "event-intelligence"):
        assert git_value(source, "status", "--porcelain", "--untracked-files=all") == ""
    for item in inputs.files:
        if item.origin.startswith(("integration-evals/", "event-intelligence/")):
            assert digest(read_bytes(workspace / item.origin)) == item.sha256
