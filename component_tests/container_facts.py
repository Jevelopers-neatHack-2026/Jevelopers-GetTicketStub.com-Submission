"""Numeric observations used by the isolated lifetime canaries."""

import os
from pathlib import Path
from typing import TypedDict


class Facts(TypedDict):
    pid: int
    uid: int
    gid: int
    groups: list[int]
    status: dict[str, str]
    namespaces: dict[str, str]
    cgroup: str
    apparmor: str


def facts(pid: int = 0) -> Facts:
    target = Path(f"/proc/{pid}" if pid else "/proc/self")
    status = dict(line.split(":", 1) for line in (target / "status").read_text().splitlines())
    selected = (
        "State",
        "Uid",
        "Gid",
        "Groups",
        "PPid",
        "NSpid",
        "CapInh",
        "CapPrm",
        "CapEff",
        "CapBnd",
        "CapAmb",
        "NoNewPrivs",
        "Seccomp",
        "Seccomp_filters",
    )
    return {
        "pid": pid or os.getpid(),
        "uid": int(status["Uid"].split()[0]),
        "gid": int(status["Gid"].split()[0]),
        "groups": [int(group) for group in status["Groups"].split()],
        "status": {name: status[name].strip() for name in selected},
        "namespaces": {
            name: str((target / "ns" / name).readlink())
            for name in ("pid", "mnt", "net", "ipc", "user")
        },
        "cgroup": (target / "cgroup").read_text(),
        "apparmor": (target / "attr/current").read_text().strip(),
    }
