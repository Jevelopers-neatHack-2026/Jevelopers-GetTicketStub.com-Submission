#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
# ─── How to run ───
# uv run fulfillment_component_tests/archive_reader.py ARCHIVE NEW_DIRECTORY MEMBER...
# The driver supplies the immutable member allowlist. No inner bundle is interpreted.
"""Read a bounded, allowlisted outer artifact ZIP using the standard library."""

from __future__ import annotations

import hashlib
import json
import re
import stat
import sys
from pathlib import Path
from typing import Final, TypedDict
from zipfile import ZipFile

MAX_MEMBER: Final = 2 * 1024 * 1024
MAX_TOTAL: Final = 16 * 1024 * 1024
MAX_COUNT: Final = 65


class ArchiveRejectedError(Exception):
    """The artifact cannot be safely read under the supplied member contract."""


class Member(TypedDict):
    """Portable custody of one inert artifact member."""

    path: str
    bytes: int
    sha256: str


def extract(archive: Path, destination: Path, expected: list[str]) -> list[Member]:
    """Write exact regular member bytes into a fresh private directory."""
    with ZipFile(archive) as source:
        entries = source.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > MAX_COUNT or len(set(names)) != len(names):
            raise ArchiveRejectedError
        if sorted(names) != sorted(expected) or not names:
            raise ArchiveRejectedError
        if sum(entry.file_size for entry in entries) > MAX_TOTAL:
            raise ArchiveRejectedError
        for entry in entries:
            mode = entry.external_attr >> 16
            safe = re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*", entry.filename)
            if (
                safe is None
                or any(part in {".", ".."} for part in entry.filename.split("/"))
                or not stat.S_ISREG(mode)
                or entry.is_dir()
                or entry.file_size > MAX_MEMBER
                or entry.flag_bits & 1
            ):
                raise ArchiveRejectedError
        destination.mkdir(mode=0o700)
        rows: list[Member] = []
        for entry in entries:
            with source.open(entry) as member:
                data = member.read(MAX_MEMBER + 1)
            if len(data) != entry.file_size or len(data) > MAX_MEMBER:
                raise ArchiveRejectedError
            target = destination / entry.filename
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with target.open("xb") as output:
                _ = output.write(data)
            rows.append(
                {
                    "path": entry.filename,
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            )
        return sorted(rows, key=lambda row: row["path"])


if __name__ == "__main__":
    _ = sys.stdout.write(json.dumps(extract(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3:])))
