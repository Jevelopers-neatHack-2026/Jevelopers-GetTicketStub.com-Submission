"""Copy finite verified inputs into a private checkout without directory read grants."""

import shutil
from pathlib import Path

from integration_evals.contracts import runtime_digest
from integration_evals.errors import fail
from integration_evals.models import Record
from integration_evals.process_reads import canonical_path
from integration_evals.validation import git_value


class InputFile(Record):
    """Original identity and copied-byte hash; receipts do not include payload bytes."""

    origin: str
    path: str
    sha256: str


def copy_input(source: Path, root: Path, name: str, expected: str, origin: str) -> InputFile:
    """Verify both sides of a regular-file copy and preserve executable modes."""
    original = canonical_path(source)
    target = root / name
    if (
        target.exists()
        or target.is_symlink()
        or not target.resolve().is_relative_to(root.resolve())
    ):
        fail("input_snapshot_path_rejected", "owner-command")
    if runtime_digest(original) != expected:
        fail("input_snapshot_source_changed", origin)
    target.parent.mkdir(parents=True, exist_ok=True)
    _ = shutil.copyfile(original, target)
    _ = shutil.copymode(original, target)
    if runtime_digest(target) != expected:
        fail("input_snapshot_copy_changed", origin)
    return InputFile(origin=origin, path=name, sha256=expected)


def copy_tracked_inputs(source: Path, root: Path, component: str) -> tuple[InputFile, ...]:
    """Snapshot only tracked regular files; reject source links and unreviewed additions."""
    if git_value(source, "status", "--porcelain", "--untracked-files=all"):
        fail("input_snapshot_source_dirty", component)
    files: list[InputFile] = []
    for name in git_value(source, "ls-files", "-z").split("\0"):
        if not name:
            continue
        path = canonical_path(source.resolve() / name)
        if not path.is_relative_to(source.resolve()):
            fail("input_snapshot_source_escape", component)
        files.append(copy_input(path, root, name, runtime_digest(path), f"{component}/{name}"))
    return tuple(files)
