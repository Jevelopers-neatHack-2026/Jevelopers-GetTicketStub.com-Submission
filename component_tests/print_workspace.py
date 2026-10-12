"""Owned clean snapshots for the real print command; never rewrite producer sources."""

import os
import shutil
from pathlib import Path

from component_tests.test_retrieval import commit, git
from integration_evals.artifacts import load_record
from integration_evals.contract_records import ContractRuntime
from integration_evals.print_setup import CONFIGURATION_PATH, configuration, prepare
from integration_evals.validation import git_value


def workspace_at(root: Path) -> Path:
    """Copy exact sources plus their already built dependencies into one isolated workspace."""
    repository = Path(__file__).resolve().parents[1]
    evaluator = root / "integration-evals"
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
    runtime = load_record(Path(os.environ["IE_PRINT_RUNTIME"]), ContractRuntime)
    config = configuration(evaluator, Path(runtime.path), Path(os.environ["IE_PRINT_BROWSER_ROOT"]))
    _ = (evaluator / CONFIGURATION_PATH).write_text(
        config.model_dump_json(indent=2), encoding="utf-8"
    )
    commit(evaluator)
    prepare(root, runtime, root / "assembly.json")
    return root
