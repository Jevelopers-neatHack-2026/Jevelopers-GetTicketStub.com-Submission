import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import ClassVar, Literal, assert_never

import pytest
from pydantic import ConfigDict

from integration_evals.artifacts import digest, load_record, read_bytes
from integration_evals.errors import fail
from integration_evals.execution import Settings
from integration_evals.models import Catalog, Outcome, Record, Run, Status, Suite
from integration_evals.release import audit, export_audit
from integration_evals.reporting import Tracker, save_run
from integration_evals.retrieval_setup import RetrievalProfile, prepare
from integration_evals.runner import execute
from integration_evals.specifications import Requirements
from integration_evals.validation import git_value

type Mutation = Literal["baseline", "always-reject", "unchecked-private"]


class Attempt(Record):
    id: str
    code: str
    known_bytes: bool
    protected_connections: int
    protected_requests: int
    allowed_connections: int
    allowed_requests: int


class Capture(Record):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, strict=True, extra="ignore")
    network_namespace: str
    rows: tuple[Attempt, ...]
    uncovered: tuple[str, ...]


def git(root: Path, arguments: tuple[str, ...]) -> None:
    binary = shutil.which("git")
    if binary is None:
        fail("git_runtime_missing", "component-fixture")
    _ = subprocess.run(  # noqa: S603 - fixed Git arguments confined to owned test workspaces
        (binary, "-C", str(root), *arguments), check=True, capture_output=True, timeout=60
    )


def commit(root: Path) -> None:
    git(root, ("init",))
    git(root, ("add", "."))
    git(
        root,
        (
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@evals.example",
            "commit",
            "-m",
            "controlled component fixture",
        ),
    )


@pytest.fixture
def retrieval_workspace(tmp_path: Path, mutation: Mutation) -> Path:
    # Given exact owner sources and an owned clean evaluator snapshot in a Linux-only workspace.
    repository = Path(__file__).resolve().parents[1]
    evaluator = tmp_path / "integration-evals"
    _ = shutil.copytree(
        repository,
        evaluator,
        ignore=shutil.ignore_patterns(
            ".git",
            ".venv",
            ".pytest_cache",
            ".ruff_cache",
            "__pycache__",
            "reports",
            "dist",
            ".contract-producer",
            ".event-producer",
        ),
    )
    for name, variable in (
        ("shared-contracts", "IE_CONTRACT_SOURCE"),
        ("event-intelligence", "IE_EVENT_SOURCE"),
    ):
        git(tmp_path, ("clone", "--no-hardlinks", os.environ[variable], str(tmp_path / name)))
        git(
            tmp_path / name,
            ("checkout", "--detach", git_value(Path(os.environ[variable]), "rev-parse", "HEAD")),
        )
    producer = tmp_path / "event-intelligence"
    target = producer / "src/security/controlled-fetch.mjs"
    original = target.read_text(encoding="utf-8")
    marker = "  async fetch(input, options = {}) {"
    match mutation:
        case "baseline":
            changed = original
        case "always-reject":
            changed = original.replace(
                marker, marker + '\n    throw new RetrievalError("POLICY_DENIED");', 1
            )
        case "unchecked-private":
            changed = original.replace(
                marker,
                marker
                + '\n    if (input.startsWith("http://127.0.0.1:")) {'
                + " const reply = await globalThis.fetch(input);"
                + " return { bytes: Buffer.from(await reply.arrayBuffer()) }; }",
                1,
            )
        case _:
            assert_never(mutation)
    if changed != original:
        _ = target.write_text(changed, encoding="utf-8")
        commit(producer)
        profile_path = evaluator / "src/integration_evals/retrieval-profile.json"
        profile = load_record(profile_path, RetrievalProfile).model_copy(
            update={"producer_revision": git_value(producer, "rev-parse", "HEAD")}
        )
        _ = profile_path.write_text(profile.model_dump_json(), encoding="utf-8")
    commit(evaluator)
    manifest = tmp_path / "assembly.json"
    prepare(tmp_path, Path(os.environ["IE_CONTRACT_RUNTIME"]), manifest)
    return tmp_path


@pytest.mark.parametrize("mutation", ["baseline", "always-reject", "unchecked-private"])
def test_real_retrieval_component_archives_observed_boundary(
    retrieval_workspace: Path, mutation: Mutation
) -> None:
    evaluator = retrieval_workspace / "integration-evals"
    suite = load_record(evaluator / "scenarios/suite.json", Suite)
    catalog = load_record(evaluator / "fixtures/catalog.json", Catalog)
    tracker = load_record(evaluator / "planning/acceptance-checklist.json", Tracker)
    settings = Settings(evaluator, retrieval_workspace, retrieval_workspace / "assembly.json")
    # When actual orchestration invokes SafeFetcher under the unchanged offline Bubblewrap boundary.
    run = execute(suite, catalog, settings)
    archive = save_run(run, retrieval_workspace / "reports", tracker, suite, settings.artifacts)
    # Then the positive fixture proves transport and injected regressions cannot earn a pass.
    saved = load_record(archive / "run.json", Run)
    selected = next(result for result in saved.results if result.case_id == "ssrf-egress")
    if sys.platform != "linux":
        assert selected.outcome is Outcome.SKIPPED
        assert selected.reason == "required target platform unavailable"
        pytest.fail("Mandatory Linux boundary evidence unavailable; retained actual blocked run")
    assert selected.exit_code == 0, selected.reason
    assert selected.cleanup_status == "passed"
    assert selected.output_digest not in (None, digest(b""))
    assert len(saved.results) == 42
    assert all(
        result.criterion_status is Status.PLANNED
        for result in saved.results
        if result.case_id != selected.case_id
    )
    data = read_bytes(archive / saved.evidence[0].path)
    assert digest(data) == saved.evidence[0].sha256
    capture = Capture.model_validate_json(data)
    assert capture.network_namespace != str(Path("/proc/self/ns/net").readlink())
    assert capture.uncovered
    baseline = next(row for row in capture.rows if row.id == "allowed")
    match mutation:
        case "baseline":
            assert selected.outcome is Outcome.PASSED, selected.reason
            assert baseline.known_bytes
            assert baseline.allowed_requests == 1
            assert all(row.protected_connections == 0 for row in capture.rows)
        case "always-reject":
            assert selected.outcome is Outcome.FAILED
            assert baseline.code == "POLICY_DENIED"
            assert baseline.allowed_connections == 0
        case "unchecked-private":
            assert selected.outcome is Outcome.FAILED
            assert any(row.protected_connections > 0 for row in capture.rows)
        case _:
            assert_never(mutation)
    original_archive = read_bytes(archive / "run.json")
    with pytest.raises(FileExistsError):
        _ = save_run(run, retrieval_workspace / "reports", tracker, suite, settings.artifacts)
    assert read_bytes(archive / "run.json") == original_archive
    if destination := os.environ.get("IE_COMPONENT_EVIDENCE"):
        exported = save_run(saved, Path(destination) / mutation, tracker, suite, archive)
        requirements = load_record(evaluator / "planning/requirements.json", Requirements)
        release = audit(saved, tracker, requirements, suite)
        assert len(release.obligations) == 142
        assert release.product_acceptance == "blocked"
        export_audit(release, exported / "release-audit.json")
