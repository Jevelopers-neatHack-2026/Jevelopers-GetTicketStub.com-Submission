"""Archive immutable sanitized output bytes with their original digest-linked metadata."""

from pathlib import Path

from integration_evals.artifacts import confined_path, digest, read_bytes, reject_leaks
from integration_evals.errors import fail
from integration_evals.models import Run


def copy_artifacts(run: Run, source: Path, destination: Path) -> None:
    """Recheck exact bytes during copy, rejecting stale files and conflicting references."""
    copied: dict[str, str] = {}
    for item in run.evidence:
        if item.path in copied:
            if copied[item.path] != item.sha256:
                fail("conflicting_archive_hash", item.id)
            continue
        data = read_bytes(confined_path(source, item.path))
        if digest(data) != item.sha256:
            fail("stale_archive_artifact", item.id)
        reject_leaks(data, item.id)
        target = confined_path(destination, item.path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as output:
            _ = output.write(data)
        copied[item.path] = item.sha256
