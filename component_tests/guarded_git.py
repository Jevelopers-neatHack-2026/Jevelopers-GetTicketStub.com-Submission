"""Owned one-commit Git projections; no remote, reflog, hook or original config mounts."""

import os
import re
import shutil
import stat
import subprocess
from pathlib import Path
from time import monotonic

from integration_evals.artifacts import read_bytes
from integration_evals.errors import fail

CONFIG = (
    b"[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n"
    b"\tbare = false\n\tlogallrefupdates = false\n"
)
METADATA = frozenset({"HEAD", "config", "index", "objects", "shallow", "refs"})


def git_command(
    root: Path,
    arguments: tuple[str, ...],
    *,
    payload: bytes | None = None,
    deadline: float | None = None,
) -> bytes:
    executable = shutil.which("git")
    assert executable is not None
    environment = {
        "PATH": os.environ["PATH"],
        "HOME": str(root),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_NO_LAZY_FETCH": "1",
    }
    timeout = 30.0 if deadline is None else min(30, deadline - monotonic())
    if timeout <= 0:
        raise subprocess.TimeoutExpired(arguments, 30)
    return subprocess.run(  # noqa: S603 - fixed owned metadata commands, no ambient Git configuration
        (executable, "-C", str(root), *arguments),
        input=payload,
        check=True,
        capture_output=True,
        timeout=timeout,
        env=environment,
    ).stdout


def minimal_git(root: Path) -> None:
    """Keep only the authorized HEAD commit/tree closure and a newly generated index."""
    revision = git_command(root, ("rev-parse", "HEAD")).decode().strip()
    assert re.fullmatch("[a-f0-9]{40}", revision)
    objects = git_command(root, ("rev-list", "--objects", "--no-walk", "HEAD"))
    identifiers = b"\n".join(line.split(b" ", 1)[0] for line in objects.splitlines()) + b"\n"
    assert all(re.fullmatch(rb"[a-f0-9]{40}", item) for item in identifiers.splitlines())
    projected = root / ".git-projection"
    assert not projected.exists()
    (projected / "objects/pack").mkdir(parents=True)
    (projected / "refs").mkdir()
    _ = git_command(
        root, ("pack-objects", str(projected / "objects/pack/pack")), payload=identifiers
    )
    _ = (projected / "HEAD").write_text(revision + "\n")
    _ = (projected / "shallow").write_text(revision + "\n")
    _ = (projected / "config").write_bytes(CONFIG)
    # Only this freshly owned clone's old metadata is disposed; values are never inspected.
    shutil.rmtree(root / ".git")
    _ = projected.rename(root / ".git")
    _ = git_command(root, ("read-tree", "HEAD"))
    assert git_command(root, ("status", "--porcelain")) == b""
    verify_git_projection(root, monotonic() + 10)


def verify_git_projection(root: Path, deadline: float) -> None:
    """Require exact controlled metadata bytes and inventory before any source mount."""
    directory = root / ".git"
    assert directory.resolve(strict=True) == directory
    for child in (directory, directory / "refs", directory / "objects", directory / "objects/pack"):
        observed = child.lstat()
        assert stat.S_ISDIR(observed.st_mode)
        assert observed.st_uid == os.getuid()
    assert {path.name for path in directory.iterdir()} == METADATA
    for name in METADATA - {"objects", "refs"}:
        observed = (directory / name).lstat()
        assert stat.S_ISREG(observed.st_mode)
        assert observed.st_nlink == 1
    if read_bytes(directory / "config", max_bytes=65536, deadline=deadline) != CONFIG:
        fail("unexpected_git_configuration", "guarded-development")
    assert not tuple((directory / "refs").iterdir())
    head = read_bytes(directory / "HEAD", max_bytes=41, deadline=deadline)
    assert re.fullmatch(rb"[a-f0-9]{40}\n", head)
    assert read_bytes(directory / "shallow", max_bytes=41, deadline=deadline) == head
    _ = read_bytes(directory / "index", deadline=deadline)
    objects = directory / "objects"
    assert {path.name for path in objects.iterdir()} == {"pack"}
    packed = tuple((objects / "pack").iterdir())
    assert packed
    for item in packed:
        assert re.fullmatch(r"pack-[a-f0-9]{40}\.(?:pack|idx|rev)", item.name)
        observed = item.lstat()
        assert stat.S_ISREG(observed.st_mode)
        assert observed.st_nlink == 1
    stems = {item.stem for item in packed}
    assert len(stems) == 1
    assert {item.suffix for item in packed} in ({".pack", ".idx"}, {".pack", ".idx", ".rev"})
    index = next(item for item in packed if item.suffix == ".idx")
    _ = git_command(root, ("verify-pack", str(index)), deadline=deadline)
    expected = git_command(root, ("rev-list", "--objects", "--no-walk", "HEAD"), deadline=deadline)
    expected_ids = {line.split(b" ", 1)[0] for line in expected.splitlines()}
    actual = git_command(
        root, ("cat-file", "--batch-all-objects", "--batch-check=%(objectname)"), deadline=deadline
    )
    assert set(actual.splitlines()) == expected_ids
    assert git_command(root, ("rev-parse", "HEAD"), deadline=deadline) == head
