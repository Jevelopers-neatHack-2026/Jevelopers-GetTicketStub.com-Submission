"""Shared helpers for the BK-01 checks. Standard library only (Python 3.9+)."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = "inventory/brand-inventory.json"


def list_files(root: Path, include_untracked: bool = False) -> list[str]:
    """Tracked paths per the git index, including tracked paths deleted from the work tree.

    Untracked-unignored files are added only with include_untracked (authoring aid, never the default).
    Outside a git work tree there is no index, so a filesystem walk is used.
    """
    cmd = ["git", "-C", str(root), "ls-files", "-z", "--cached"]
    if include_untracked:
        cmd += ["--others", "--exclude-standard"]
    try:
        out = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
        return sorted({f for f in out.split("\0") if f})
    except (subprocess.CalledProcessError, FileNotFoundError):
        found = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in (".git", "__pycache__")]
            for name in filenames:
                found.append(os.path.relpath(os.path.join(dirpath, name), root))
        return sorted(f.replace(os.sep, "/") for f in found)
