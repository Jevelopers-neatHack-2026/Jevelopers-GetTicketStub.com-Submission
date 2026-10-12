"""Put unchanged protocol fixtures inside the synthetic pinned owner checkout."""

import shutil
from dataclasses import dataclass
from pathlib import Path

from integration_evals.validation import git_value


@dataclass(frozen=True, slots=True)
class PinnedFixture:
    path: Path
    revision: str
    tree: str


def pin_process_fixture(checkout: Path, source: Path) -> PinnedFixture:
    target = checkout / source.name
    _ = shutil.copyfile(source, target)
    _ = git_value(checkout, "add", target.name)
    _ = git_value(
        checkout,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@evals.example",
        "commit",
        "-m",
        "pin owned process fixture",
    )
    return PinnedFixture(
        target,
        git_value(checkout, "rev-parse", "HEAD"),
        git_value(checkout, "rev-parse", "HEAD^{tree}"),
    )
