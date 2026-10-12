"""Construct offline read capabilities without mounting host or dependency parent roots."""

import os
import sys
import sysconfig
from pathlib import Path
from tempfile import gettempdir
from typing import Final

from integration_evals.errors import fail

SYSTEM_ALIASES: Final = frozenset(Path("/") / name for name in ("var", "tmp", "etc"))


def canonical_path(path: Path) -> Path:
    """Accept OS path aliases but no caller-supplied symlink components or traversal."""
    absolute = path.absolute()
    if ".." in absolute.parts or any(
        part.is_symlink() and part not in SYSTEM_ALIASES for part in (absolute, *absolute.parents)
    ):
        return fail("offline_path_alias_rejected", "owner-command")
    return absolute.resolve(strict=True)


def owned_directory(path: Path) -> Path:
    """Reject broad host roots before treating a checkout or task directory as owned."""
    resolved = canonical_path(path)
    protected = (Path.home().resolve(), Path(gettempdir()).resolve(), Path(__file__).resolve())
    if not resolved.is_dir() or any(
        resolved == item or resolved in item.parents for item in protected
    ):
        return fail("offline_directory_too_broad", "owner-command")
    return resolved


def python_reads() -> tuple[Path, ...]:
    """Expose this interpreter's library closure, not its installation or home parent."""
    stdlib = Path(sysconfig.get_path("stdlib"))
    paths = [path for path in stdlib.iterdir() if path.name != "site-packages"]
    executable = Path(sys.executable)
    while executable.is_symlink():
        paths.append(executable)
        target = executable.readlink()
        executable = target if target.is_absolute() else executable.parent / target
    paths.extend(
        (
            Path(sys.executable),
            Path(sys.executable).resolve(),
            Path(sys.prefix) / "pyvenv.cfg",
            Path(sysconfig.get_path("purelib")),
            Path(sysconfig.get_path("platlib")),
            Path(__file__).resolve().parent,
        )
    )
    library = stdlib.parent
    paths.extend(library.glob("*.dylib"))
    paths.extend(library.glob("*.so*"))
    return tuple(path for path in paths if path.exists())


def read_paths(command: tuple[str, ...], checkout: Path, writable: Path) -> tuple[Path, ...]:
    """Combine owned paths, fixed OS runtime resources and the evaluator interpreter closure."""
    paths = [checkout, writable]
    executable = Path(command[0])
    if executable.is_absolute() and executable.resolve() == Path(sys.executable).resolve():
        paths.extend(python_reads())
    if sys.platform == "darwin":
        paths.extend(
            Path(name)
            for name in ("/System/Library", "/usr/lib", "/usr/bin", "/bin", "/usr/share/zoneinfo")
        )
        paths.extend(Path(name) for name in ("/dev/null", "/dev/random", "/dev/urandom"))
    else:
        paths.extend(Path(name) for name in ("/usr/bin", "/bin", "/usr/lib", "/lib", "/lib64"))
        paths.extend(Path(name) for name in ("/etc/ld.so.cache", "/usr/share/zoneinfo"))
    return tuple(dict.fromkeys(path for path in paths if path.exists()))


def sandbox_reads(paths: tuple[Path, ...]) -> str:
    """Quote literal sandbox paths so checkout names cannot introduce policy clauses."""
    rules = [' (deny file-read*) (allow file-read* (literal "/"))']
    stdlib = Path(sysconfig.get_path("stdlib"))
    if any(path.parent == stdlib for path in paths):
        literal = str(stdlib).replace("\\", "\\\\").replace('"', '\\"')
        rules.append(f' (allow file-read* (literal "{literal}"))')
        source_parent = str(Path(__file__).resolve().parent.parent)
        source_parent = source_parent.replace("\\", "\\\\").replace('"', '\\"')
        rules.append(f' (allow file-read* (literal "{source_parent}"))')
    ancestors = {parent for path in paths for parent in (path, *path.parents)} | SYSTEM_ALIASES
    for parent in sorted(ancestors):
        escaped = str(parent).replace("\\", "\\\\").replace('"', '\\"')
        rules.append(f' (allow file-read-metadata (literal "{escaped}"))')
    for path in paths:
        escaped = os.fspath(path.resolve()).replace("\\", "\\\\").replace('"', '\\"')
        predicate = "subpath" if path.is_dir() else "literal"
        rules.append(f' (allow file-read* ({predicate} "{escaped}"))')
    return "".join(rules)


def linux_reads(paths: tuple[Path, ...], writable: Path) -> tuple[str, ...]:
    """Build an empty mount namespace populated only by the declared read closure."""
    bindings: list[str] = ["--unshare-net"]
    for path in paths:
        if path == writable:
            continue
        bindings.extend(("--ro-bind", str(path.resolve()), str(path)))
    bindings.extend(("--bind", str(writable), str(writable)))
    return tuple(bindings)
