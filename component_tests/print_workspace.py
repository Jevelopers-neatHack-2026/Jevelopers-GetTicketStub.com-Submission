"""Owned clean snapshots for the real print command; never rewrite producer sources."""

import os
import shutil
from pathlib import Path

from component_tests.guarded_git import minimal_git
from component_tests.test_retrieval import commit, git
from integration_evals.artifacts import load_record
from integration_evals.contract_records import ContractRuntime
from integration_evals.print_setup import (
    CONFIGURATION_PATH,
    PrintConfiguration,
    configuration,
    prepare,
    verify_source,
)
from integration_evals.validation import git_value


def workspace_at(root: Path, *, browser_in_container: bool = False) -> Path:
    """Copy exact sources plus their already built dependencies into one isolated workspace."""
    repository = Path(__file__).resolve().parents[1]
    root.mkdir(parents=True, exist_ok=True)
    evaluator = root / "integration-evals"
    if browser_in_container:
        # The development backend mounts only a clean tracked evaluator projection.
        assert git_value(repository, "status", "--porcelain") == ""
        evaluator.mkdir()
        for name in git_value(repository, "ls-files").splitlines():
            source = repository / name
            assert source.resolve(strict=True) == source
            destination = evaluator / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            _ = shutil.copyfile(source, destination)
    else:
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
                ".print-producer",
            ),
        )
    for name, variable in (
        ("shared-contracts", "IE_CONTRACT_SOURCE"),
        ("print-production", "IE_PRINT_SOURCE"),
    ):
        source = Path(os.environ[variable]).resolve()
        destination = root / name
        git(root, ("clone", "--no-hardlinks", str(source), str(destination)))
        git(destination, ("checkout", "--detach", git_value(source, "rev-parse", "HEAD")))
        if name == "print-production":
            for generated in ("dist", "node_modules"):
                _ = shutil.copytree(source / generated, destination / generated, symlinks=True)
            if browser_in_container:
                minimal_git(destination)
    runtime = load_record(Path(os.environ["IE_PRINT_RUNTIME"]), ContractRuntime)
    config = (
        PrintConfiguration(
            node_sha256=runtime.sha256,
            browser_root="/ms-playwright",
            renderer_image=verify_source(evaluator, root / "print-production").image,
        )
        if browser_in_container
        else configuration(evaluator, Path(runtime.path), Path(os.environ["IE_PRINT_BROWSER_ROOT"]))
    )
    _ = (evaluator / CONFIGURATION_PATH).write_text(
        config.model_dump_json(indent=2), encoding="utf-8"
    )
    commit(evaluator)
    if browser_in_container:
        minimal_git(evaluator)
    prepare(root, runtime, root / "assembly.json")
    return root
