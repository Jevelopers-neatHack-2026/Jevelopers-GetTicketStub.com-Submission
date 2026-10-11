#!/usr/bin/env python3
"""Run one of the three fixed OPS CI routes with bounded process custody."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import threading
import time
import uuid

REGISTRY_SCHEMA = "ops-ci1-owned-groups.v1"
SIDECAR_SCHEMA = "ops-ci1-temp-custody.v1"
RECEIPT_SCHEMA = "ops-ci1-owned-command-receipt.v1"
REGISTRY_MAX_BYTES = 8_192
REGISTRY_GROUP_MAX = 16
REGISTRY_PENDING_MAX = 16
SIDECAR_MAX_BYTES = 8_192
SIDECAR_LAUNCH_MAX = 16
SIDECAR_COUNT_MAX = 6
SIDECAR_TOTAL_MAX_BYTES = 49_152
SIDECAR_CANDIDATE_MAX = 256
SIDECAR_READ_MAX_BYTES = 1_048_576
REGISTRY_DIRECTORY_ENTRY_MAX = 512
TMP_IMMEDIATE_ENTRY_MAX = 1_024
TREE_DESCENDANT_MAX = 4_096
TREE_DIRECTORY_BYTES_MAX = 268_435_456
TREE_ALL_BYTES_MAX = 536_870_912
STREAM_MAX_BYTES = 4_194_304
COMBINED_STREAM_MAX_BYTES = 8_388_608
RECEIPT_MAX_BYTES = 8_192
WATCHDOG_LIMIT_MS = 300_000
WATCHDOG_READY_MS = 2_000
COMMAND_GATE_MS = 2_000
TARGET_ACK_MS = 2_000
COMMAND_WAIT_MS = 305_000
TERM_WAIT_MS = 750
KILL_WAIT_MS = 750
DIRECT_REAP_MS = 500
TARGET_RECHECK_MS = 250
WATCHDOG_STOP_SEQUENCE_MS = (4_000, 250, 500, 4_000, 100, 250, 250, 250)
WATCHDOG_STOP_MAX_MS = 9_600
MAX_REPORTED_ELAPSED_MS = 600_000
UUID4_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SIDECAR_NAME_RE = re.compile(r"^owned-groups\.json\.temp-custody\.([0-9]{1,12})\.([0-9a-f]{16})\.json$")
SIDECAR_TEMP_RE = re.compile(
    r"^owned-groups\.json\.temp-custody\.([0-9]{1,12})\.([0-9a-f]{16})\.json\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$"
)
REGISTRY_TEMP_RE = re.compile(
    r"^owned-groups\.json\.[0-9]{1,12}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$"
)
SAFE_LAUNCH_STATUSES = frozenset({
    "launch_intent", "spawn_attempted", "child_spawned", "group_verified",
    "group_verified_during_cleanup", "group_registered", "ready_released",
    "pending_removal_unconfirmed", "cancelled_custody_removal_unconfirmed",
    "group_unverified", "group_unconfirmed", "registry_removal_unconfirmed",
    "launch_cancelled", "group_absent",
})
ROUTES = {
    "runtime-foundation": {
        "argv": ("npm", "test"),
        "argvClass": "npm_test",
        "receipt": "ops-ci1-runtime-foundation.json",
        "tap": "runtime-foundation.tap",
    },
    "ops-quota-shutdown-restart": {
        "argv": ("make", "verify", "CASE=AH-11-OPS", "MODE=mock", "FIXTURE=quota-shutdown-restart"),
        "argvClass": "make_ops_fixture",
        "receipt": "ops-ci1-quota-shutdown-restart.json",
        "tap": None,
    },
    "ops-runbook-clean-start": {
        "argv": ("make", "verify", "CASE=AH-11-OPS", "MODE=mock", "FIXTURE=runbook-clean-start"),
        "argvClass": "make_ops_fixture",
        "receipt": "ops-ci1-runbook-clean-start.json",
        "tap": None,
    },
}
ROUTE_IDS = frozenset(ROUTES)
ENV_ALLOWLIST = ("PATH", "HOME", "LANG", "LC_ALL", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "CI")
RECEIPT_KEYS = frozenset({
    "schema", "route", "argvClass", "commandExitCode", "wrapperExitCode",
    "timeoutStage", "escalationStage", "commandDirectReaped", "commandGroupAbsent",
    "watchdogReaped", "watchdogGroupAbsent", "outerRegistryEmpty",
    "localRegistryEmpty", "sidecarsReconciled", "outputOverflow",
    "captureReadFailed", "elapsedMs", "elapsedCapped", "groupsObserved",
    "sidecarsObserved", "sidecarsReconciledCount", "pendingLaunchesRemaining",
    "stdout", "stderr",
})
TIMEOUT_STAGES = frozenset({"none", "command_wait", "watchdog", "signal", "launch_gate"})
ESCALATION_STAGES = frozenset({"none", "term", "kill", "unconfirmed"})
PROCESS_SIGNAL_NAMES = {signal.SIGINT: "SIGINT", signal.SIGTERM: "SIGTERM"}
_received_signal: int | None = None


class OwnerFailure(Exception):
    """A fixed internal failure category; never serialized verbatim."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def strict_json_bytes(data: bytes) -> object:
    def pairs_no_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate_key")
            result[key] = value
        return result

    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=pairs_no_duplicates)
    except RecursionError as exc:
        raise ValueError("json_depth") from exc


def lstat_regular(path: Path, *, mode: int | None = None) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as exc:
        raise OwnerFailure("lstat") from exc
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise OwnerFailure("not_regular")
    if mode is not None and stat.S_IMODE(info.st_mode) != mode:
        raise OwnerFailure("file_mode")
    return info


def lstat_directory(path: Path, *, mode: int | None = None) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as exc:
        raise OwnerFailure("lstat") from exc
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise OwnerFailure("not_directory")
    if mode is not None and stat.S_IMODE(info.st_mode) != mode:
        raise OwnerFailure("directory_mode")
    return info


def read_bounded(path: Path, limit: int, *, mode: int | None = None) -> bytes:
    info = lstat_regular(path, mode=mode)
    if info.st_size > limit:
        raise OwnerFailure("oversize")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
        try:
            opened = os.fstat(descriptor)
            if (not stat.S_ISREG(opened.st_mode) or opened.st_dev != info.st_dev
                    or opened.st_ino != info.st_ino
                    or (mode is not None and stat.S_IMODE(opened.st_mode) != mode)
                    or opened.st_size > limit):
                raise OwnerFailure("raced_file")
            with os.fdopen(descriptor, "rb", closefd=False) as stream:
                data = stream.read(limit + 1)
            final_info = os.fstat(descriptor)
            if final_info.st_size != info.st_size or final_info.st_ino != info.st_ino:
                raise OwnerFailure("raced_file")
        finally:
            os.close(descriptor)
    except OwnerFailure:
        raise
    except OSError as exc:
        raise OwnerFailure("read") from exc
    if len(data) > limit or len(data) != info.st_size:
        raise OwnerFailure("raced_or_oversize")
    return data


def write_new(path: Path, data: bytes, mode: int) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags, mode)
        try:
            os.fchmod(descriptor, mode)
            view = memoryview(data)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise OSError("short_write")
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError as exc:
        raise OwnerFailure("write_new") from exc


def atomic_write_json(path: Path, value: object, mode: int = 0o600) -> bool:
    temporary = path.with_name(f"{path.name}.{os.getpid()}.{uuid.uuid4()}.tmp")
    data = (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    if len(data) > REGISTRY_MAX_BYTES:
        return False
    try:
        write_new(temporary, data, mode)
        os.replace(temporary, path)
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            return False
        return True
    except OwnerFailure:
        try:
            temporary.unlink()
        except OSError:
            pass
        return False
    except OSError:
        try:
            temporary.unlink()
        except OSError:
            pass
        return False


def valid_uuid4(value: object) -> bool:
    return isinstance(value, str) and UUID4_RE.fullmatch(value) is not None


def validate_registry_value(value: object) -> dict[str, object]:
    if (not isinstance(value, dict)
            or set(value) != {"schema", "groups", "pendingLaunches"}
            or value.get("schema") != REGISTRY_SCHEMA
            or not isinstance(value.get("groups"), list)
            or not isinstance(value.get("pendingLaunches"), list)):
        raise OwnerFailure("registry_shape")
    groups = value["groups"]
    pending = value["pendingLaunches"]
    if (len(groups) > REGISTRY_GROUP_MAX
            or any(not isinstance(group, int) or isinstance(group, bool) or group < 2 for group in groups)
            or len(set(groups)) != len(groups)):
        raise OwnerFailure("registry_groups")
    if (len(pending) > REGISTRY_PENDING_MAX
            or any(not valid_uuid4(token) for token in pending)
            or len(set(pending)) != len(pending)):
        raise OwnerFailure("registry_pending")
    return {"schema": REGISTRY_SCHEMA, "groups": list(groups), "pendingLaunches": list(pending)}


def read_registry(path: Path) -> dict[str, object]:
    data = read_bounded(path, REGISTRY_MAX_BYTES, mode=0o600)
    try:
        value = strict_json_bytes(data)
    except (UnicodeError, ValueError) as exc:
        raise OwnerFailure("registry_json") from exc
    return validate_registry_value(value)


def mode_private_owner(path: Path) -> bool:
    try:
        info = path.lstat()
    except OSError:
        return False
    return (stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode)
            and stat.S_IMODE(info.st_mode) == 0o700
            and info.st_uid == os.getuid())


def ensure_dir(path: Path, mode: int, *, must_be_new: bool = False) -> None:
    try:
        if must_be_new:
            os.mkdir(path, mode)
        else:
            os.mkdir(path, mode)
    except FileExistsError:
        if must_be_new or not mode_private_owner(path):
            raise OwnerFailure("existing_private_path")
    except OSError as exc:
        raise OwnerFailure("mkdir") from exc
    try:
        info = lstat_directory(path, mode=mode)
    except OwnerFailure:
        raise
    if info.st_uid != os.getuid():
        raise OwnerFailure("directory_owner")


def prepare_artifact_root(root: Path) -> None:
    try:
        info = root.lstat()
    except FileNotFoundError:
        try:
            root.mkdir(mode=0o755)
        except OSError as exc:
            raise OwnerFailure("artifact_root_create") from exc
        info = root.lstat()
    except OSError as exc:
        raise OwnerFailure("artifact_root_lstat") from exc
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise OwnerFailure("artifact_root_type")


def clear_stale_route_evidence(root: Path, route: str) -> None:
    names = [str(ROUTES[route]["receipt"])]
    if ROUTES[route]["tap"] is not None:
        names.append(str(ROUTES[route]["tap"]))
    for name in names:
        path = root / name
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise OwnerFailure("stale_artifact_lstat") from exc
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise OwnerFailure("stale_artifact_type")
        try:
            path.unlink()
            directory_fd = os.open(root, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError as exc:
            raise OwnerFailure("stale_artifact_remove") from exc


def prepare_state(root: Path) -> tuple[Path, Path, Path, Path]:
    prepare_artifact_root(root)
    private_root = root / ".ops-ci1-private"
    try:
        ensure_dir(private_root, 0o700)
    except OwnerFailure:
        raise
    run_id = str(uuid.uuid4())
    run_root = private_root / run_id
    ensure_dir(run_root, 0o700, must_be_new=True)
    registry_root = run_root / "registry"
    tmp_root = run_root / "tmp"
    ensure_dir(registry_root, 0o700, must_be_new=True)
    ensure_dir(tmp_root, 0o700, must_be_new=True)
    registry_path = registry_root / "owned-groups.json"
    initial = {"schema": REGISTRY_SCHEMA, "groups": [], "pendingLaunches": []}
    write_new(registry_path, (json.dumps(initial, separators=(",", ":")) + "\n").encode(), 0o600)
    read_registry(registry_path)
    return run_root, registry_root, registry_path, tmp_root


def directory_identity(path: Path, mode: int | None = None) -> tuple[int, int]:
    info = lstat_directory(path, mode=mode)
    if info.st_uid != os.getuid():
        raise OwnerFailure("directory_owner")
    return info.st_dev, info.st_ino


def validate_private_state_roots(tmp_root: Path, registry_path: Path,
                                 expected: dict[str, tuple[int, int]]) -> bool:
    registry_root = registry_path.parent
    run_root = tmp_root.parent
    private_root = run_root.parent
    if (registry_root.parent != run_root or registry_root.name != "registry"
            or tmp_root.name != "tmp" or not valid_uuid4(run_root.name)
            or private_root.name != ".ops-ci1-private"
            or private_root.parent.name != ".runtime-artifacts"):
        return False
    try:
        for path in (private_root, run_root, registry_root, tmp_root):
            info = lstat_directory(path, mode=0o700)
            if info.st_uid != os.getuid():
                return False
            if expected.get(str(path)) != (info.st_dev, info.st_ino):
                return False
        if tmp_root.resolve(strict=True).parent != run_root.resolve(strict=True):
            return False
        if registry_root.resolve(strict=True).parent != run_root.resolve(strict=True):
            return False
    except (OwnerFailure, OSError):
        return False
    return True


def private_environment(tmp_root: Path, registry_path: Path) -> dict[str, str]:
    result = {key: os.environ[key] for key in ENV_ALLOWLIST if key in os.environ}
    if "PATH" not in result or not result["PATH"]:
        raise OwnerFailure("path_missing")
    result["TMPDIR"] = str(tmp_root)
    result["TMP"] = str(tmp_root)
    result["TEMP"] = str(tmp_root)
    result["OPS_CI1_OWNED_GROUP_REGISTRY"] = str(registry_path)
    result["npm_config_offline"] = "true"
    result["npm_config_audit"] = "false"
    result["npm_config_update_notifier"] = "false"
    return result


def atomic_control(path: Path, state: str, pgid: int | None) -> bool:
    return atomic_write_json(path, {"schema": "ops-owned-group-control.v1", "state": state, "targetPgid": pgid})


def read_small_json(path: Path, limit: int = 4_096) -> object:
    data = read_bounded(path, limit, mode=0o600)
    try:
        return strict_json_bytes(data)
    except (UnicodeError, ValueError) as exc:
        raise OwnerFailure("control_json") from exc


def wait_file(path: Path, process: subprocess.Popen[bytes], timeout_ms: int) -> bool:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        try:
            info = path.lstat()
            if stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode):
                return True
        except FileNotFoundError:
            pass
        except OSError:
            return False
        time.sleep(0.01)
    try:
        info = path.lstat()
        return stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode)
    except OSError:
        return False


def group_exists(pgid: int) -> bool | None:
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except (PermissionError, OSError):
        return None


def wait_groups(pgids: list[int], max_elapsed_ms: int) -> dict[int, bool | None]:
    deadline = time.monotonic() + max_elapsed_ms / 1000
    unique = sorted(set(pgids))
    latest = {pgid: group_exists(pgid) for pgid in unique}
    while True:
        latest = {pgid: group_exists(pgid) for pgid in unique}
        if all(value is False for value in latest.values()):
            return latest
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return latest
        time.sleep(min(0.025, remaining))


def signal_groups(pgids: list[int], sig: int) -> dict[int, str]:
    result: dict[int, str] = {}
    for pgid in sorted(set(pgids)):
        try:
            os.killpg(pgid, sig)
            result[pgid] = "sent"
        except ProcessLookupError:
            result[pgid] = "already_absent"
        except PermissionError:
            result[pgid] = "permission_unknown"
        except OSError:
            result[pgid] = "signal_error"
    return result


def cleanup_groups(pgids: list[int], term_ms: int = TERM_WAIT_MS, kill_ms: int = KILL_WAIT_MS) -> dict[str, object]:
    unique = sorted(set(group for group in pgids
                        if isinstance(group, int) and not isinstance(group, bool) and group > 1))
    initial = {group: group_exists(group) for group in unique}
    targets = [group for group, state in initial.items() if state is True]
    continued = signal_groups(targets, signal.SIGCONT)
    term = signal_groups(targets, signal.SIGTERM)
    after_term = wait_groups(targets, term_ms)
    remaining = [group for group, state in after_term.items() if state is True]
    continued_after_term = signal_groups(remaining, signal.SIGCONT)
    killed = signal_groups(remaining, signal.SIGKILL)
    after_kill = wait_groups(remaining, kill_ms)
    final = dict(initial)
    final.update(after_term)
    final.update(after_kill)
    return {
        "groups": unique,
        "initial": initial,
        "continued": continued,
        "term": term,
        "afterTerm": after_term,
        "continuedAfterTerm": continued_after_term,
        "kill": killed,
        "afterKill": after_kill,
        "final": final,
        "allAbsent": all(value is False for value in final.values()),
        "termWaitMs": term_ms,
        "killWaitMs": kill_ms,
    }


def wait_process(process: subprocess.Popen[bytes], timeout_ms: int) -> tuple[int | None, bool]:
    try:
        return process.wait(timeout=timeout_ms / 1000), True
    except (subprocess.TimeoutExpired, OSError):
        return None, False


def cleanup_target_group(pgid: int, process: subprocess.Popen[bytes] | None,
                         command_exit: int | None, command_reaped: bool
                         ) -> tuple[int | None, bool, bool, str]:
    """Reconcile the selected command PGID, including after its leader exits."""
    escalation = "none"
    initial = group_exists(pgid)
    if initial is True:
        try:
            cleanup = cleanup_groups([pgid], TERM_WAIT_MS, KILL_WAIT_MS)
            if any(value == "sent" for value in cleanup.get("kill", {}).values()):
                escalation = "kill"
            elif any(value == "sent" for value in cleanup.get("term", {}).values()):
                escalation = "term"
            if cleanup.get("allAbsent") is not True:
                escalation = "unconfirmed"
        except OSError:
            escalation = "unconfirmed"
    elif initial is None:
        escalation = "unconfirmed"
    if not command_reaped:
        if process is None:
            command_exit, command_reaped = None, False
        else:
            command_exit, command_reaped = wait_process(process, DIRECT_REAP_MS)
    try:
        final_group = wait_groups([pgid], TARGET_RECHECK_MS)
        group_absent = final_group.get(pgid) is False
    except OSError:
        group_absent = False
    if not group_absent:
        escalation = "unconfirmed"
    return command_exit, command_reaped, group_absent, escalation


def stop_watchdog(process: subprocess.Popen[bytes], pgid: int | None) -> dict[str, object]:
    exit_code, reaped = wait_process(process, WATCHDOG_STOP_SEQUENCE_MS[0])
    cleanup: dict[str, object] = {"allAbsent": False, "groups": []}
    if not reaped and pgid is not None:
        cleanup = cleanup_groups([pgid], 250, 500)
        exit_code, reaped = wait_process(process, WATCHDOG_STOP_SEQUENCE_MS[3])
        if not reaped:
            cleanup_groups([pgid], 100, 250)
            exit_code, reaped = wait_process(process, WATCHDOG_STOP_SEQUENCE_MS[6])
    if pgid is not None:
        final_status = wait_groups([pgid], WATCHDOG_STOP_SEQUENCE_MS[7])
        absent = final_status.get(pgid) is False
    else:
        absent = False
    return {"exitCode": exit_code, "reaped": reaped, "groupAbsent": absent, "cleanup": cleanup}


def _watchdog_source() -> str:
    return r'''
import json, os, signal, stat, sys, time, uuid
control_path, registry_path, ready_path, ack_path, result_path, limit_text = sys.argv[1:7]
limit_ms = int(limit_text)
started_ns = time.monotonic_ns()
deadline = time.monotonic() + limit_ms / 1000
REGISTRY_SCHEMA = "ops-ci1-owned-groups.v1"
def atomic_write(path, value):
    temporary = path + "." + str(os.getpid()) + "." + str(uuid.uuid4()) + ".tmp"
    try:
        data = (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode()
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.fchmod(fd, 0o600)
            view = memoryview(data)
            while view:
                written = os.write(fd, view)
                if written <= 0: raise OSError("short_write")
                view = view[written:]
            os.fsync(fd)
        finally: os.close(fd)
        os.replace(temporary, path)
        directory_fd = os.open(os.path.dirname(path), os.O_RDONLY)
        try: os.fsync(directory_fd)
        finally: os.close(directory_fd)
        return True
    except OSError:
        try: os.unlink(temporary)
        except OSError: pass
        return False
def read_json(path, maximum):
    try:
        info = os.lstat(path)
        if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode)
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > maximum): return None
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        try:
            opened = os.fstat(fd)
            if (not stat.S_ISREG(opened.st_mode) or opened.st_dev != info.st_dev
                    or opened.st_ino != info.st_ino or opened.st_size != info.st_size
                    or stat.S_IMODE(opened.st_mode) != 0o600): return None
            with os.fdopen(fd, "rb", closefd=False) as stream: data = stream.read(maximum + 1)
            final_info = os.fstat(fd)
            if final_info.st_size != info.st_size or final_info.st_ino != info.st_ino: return None
        finally: os.close(fd)
        if len(data) != info.st_size or len(data) > maximum: return None
        def unique_pairs(pairs):
            value = {}
            for key, item in pairs:
                if key in value: raise ValueError("duplicate_key")
                value[key] = item
            return value
        return json.loads(data.decode("utf-8"), object_pairs_hook=unique_pairs)
    except (OSError, ValueError, UnicodeError): return None
def exists(pgid):
    try: os.killpg(pgid, 0); return True
    except ProcessLookupError: return False
    except (PermissionError, OSError): return None
def wait_empty(pgids, bound_ms):
    end = time.monotonic() + bound_ms / 1000
    status = {pgid: exists(pgid) for pgid in pgids}
    while True:
        status = {pgid: exists(pgid) for pgid in pgids}
        if all(value is False for value in status.values()) or time.monotonic() >= end: return status
        time.sleep(min(0.025, max(0, end - time.monotonic())))
def signal_many(pgids, sig):
    result = {}
    for pgid in sorted(set(pgids)):
        try: os.killpg(pgid, sig); result[pgid] = "sent"
        except ProcessLookupError: result[pgid] = "already_absent"
        except PermissionError: result[pgid] = "permission_unknown"
        except OSError: result[pgid] = "signal_error"
    return result
def cleanup(pgids):
    pgids = sorted(set(x for x in pgids if isinstance(x, int) and not isinstance(x, bool) and x > 1))
    initial = {x: exists(x) for x in pgids}
    targets = [x for x, state in initial.items() if state is True]
    continued = signal_many(targets, signal.SIGCONT)
    term = signal_many(targets, signal.SIGTERM)
    after_term = wait_empty(targets, 750)
    remaining = [x for x, state in after_term.items() if state is True]
    continued2 = signal_many(remaining, signal.SIGCONT)
    killed = signal_many(remaining, signal.SIGKILL)
    after_kill = wait_empty(remaining, 750)
    final = dict(initial); final.update(after_term); final.update(after_kill)
    return {"groups": pgids, "initial": initial, "continued": continued, "term": term,
            "afterTerm": after_term, "continuedAfterTerm": continued2, "kill": killed,
            "afterKill": after_kill, "final": final, "allAbsent": all(x is False for x in final.values())}
def read_registry():
    value = read_json(registry_path, 8192)
    if (not isinstance(value, dict) or set(value) != {"schema", "groups", "pendingLaunches"}
            or value.get("schema") != REGISTRY_SCHEMA or not isinstance(value.get("groups"), list)
            or not isinstance(value.get("pendingLaunches"), list) or len(value["groups"]) > 16
            or len(value["pendingLaunches"]) > 16): return None
    groups = value["groups"]; pending = value["pendingLaunches"]
    if (any(not isinstance(x, int) or isinstance(x, bool) or x < 2 for x in groups)
            or len(set(groups)) != len(groups)): return None
    if (any(not isinstance(x, str) or len(x) != 36 for x in pending)
            or len(set(pending)) != len(pending)): return None
    return {"groups": list(groups), "pendingLaunches": list(pending)}
def group_identity(pgid):
    try: return os.getpgid(pgid) == pgid and exists(pgid) is True
    except (ProcessLookupError, PermissionError, OSError): return False
if not atomic_write(ready_path, {"schema":"ops-owned-group-watchdog-ready.v1","pid":os.getpid(),
                                 "pgid":os.getpgrp(),"startedMonotonicNs":started_ns}):
    sys.exit(93)
target = None
control_state = None
ack_sent = False
timed_out = False
while time.monotonic() < deadline:
    control = read_json(control_path, 4096)
    if isinstance(control, dict) and control.get("schema") == "ops-owned-group-control.v1":
        state = control.get("state")
        candidate = control.get("targetPgid")
        if state == "running" and isinstance(candidate, int) and not isinstance(candidate, bool) and candidate > 1:
            if target is not None and candidate != target: break
            if group_identity(candidate):
                target = candidate
                if not ack_sent:
                    ack_sent = atomic_write(ack_path, {"schema":"ops-owned-group-target-ack.v1",
                                                       "targetPgid":candidate,"verified":True})
            else:
                break
        elif state in ("finish", "cleanup"):
            control_state = state
            if candidate is not None and isinstance(candidate, int) and not isinstance(candidate, bool) and candidate > 1:
                target = candidate
            break
    time.sleep(0.02)
else:
    timed_out = True
    control_state = "watchdog_timeout"
target_cleanup = {"groups": [], "final": {}, "allAbsent": False}
group_cleanup = {"groups": [], "final": {}, "allAbsent": False}
registry_error = None
if timed_out:
    target_cleanup = cleanup([target]) if target is not None else {
        "groups": [], "final": {}, "allAbsent": False, "unresolved": "target_not_acknowledged"
    }
    registry = read_registry()
    if registry is None:
        registry_error = "unreadable_or_invalid"
    else:
        groups = [x for x in registry["groups"] if x not in (target, os.getpgrp())]
        group_cleanup = cleanup(groups)
else:
    target_cleanup = {"groups": [], "final": {}, "allAbsent": True, "not_needed": True}
    group_cleanup = {"groups": [], "final": {}, "allAbsent": True, "not_needed": True}
if not atomic_write(result_path, {
    "schema":"ops-owned-group-watchdog-result.v1",
    "pid":os.getpid(), "pgid":os.getpgrp(), "startedMonotonicNs":started_ns,
    "timedOut":timed_out, "controlState":control_state, "targetPgid":target,
    "targetAckSent":ack_sent, "targetCleanup":target_cleanup,
    "registryError":registry_error, "registeredGroupCleanup":group_cleanup,
    "elapsedMs":max(0, round((time.monotonic_ns()-started_ns)/1_000_000))
}):
    sys.exit(94)
'''


def _bootstrap_source() -> str:
    return r'''
import json, os, selectors, stat, subprocess, sys, time
gate_path, argv_text, gate_ms_text = sys.argv[1:4]
target_pgid = os.getpid()
argv = json.loads(argv_text)
deadline = time.monotonic() + int(gate_ms_text) / 1000
while time.monotonic() < deadline:
    try:
        info = os.lstat(gate_path)
        if (stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode)
                and stat.S_IMODE(info.st_mode) == 0o600):
            with open(gate_path, "rb") as stream: gate = json.loads(stream.read(1024).decode("utf-8"))
            if gate == {"schema":"ops-command-ready.v1","targetPgid":target_pgid}: break
            os._exit(90)
    except FileNotFoundError:
        pass
    except (OSError, ValueError, UnicodeError):
        os._exit(90)
    time.sleep(0.01)
else:
    os._exit(90)
try:
    probe = subprocess.Popen(["node", "--version"], stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True)
except OSError:
    os._exit(91)
selector = selectors.DefaultSelector()
selector.register(probe.stdout, selectors.EVENT_READ, "stdout")
selector.register(probe.stderr, selectors.EVENT_READ, "stderr")
captured = {"stdout": bytearray(), "stderr": bytearray()}
overflow = False
deadline = time.monotonic() + 5.0
while selector.get_map():
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        overflow = True
        break
    for key, _ in selector.select(min(0.05, remaining)):
        try: chunk = os.read(key.fileobj.fileno(), 256)
        except OSError:
            overflow = True
            break
        if not chunk:
            selector.unregister(key.fileobj)
            continue
        target = captured[key.data]
        if len(target) + len(chunk) > 128:
            overflow = True
            break
        target.extend(chunk)
    if overflow:
        break
if overflow:
    try: probe.kill()
    except OSError: pass
    try: probe.wait(timeout=0.25)
    except Exception: pass
    os._exit(91)
try: probe_status = probe.wait(timeout=0.25)
except Exception:
    os._exit(91)
if (probe_status != 0 or bytes(captured["stdout"]) != b"v22.23.3\n"
        or bytes(captured["stderr"]) != b""):
    os._exit(91)
os.execvpe(argv[0], argv, os.environ)
'''


class Capture:
    def __init__(self, paths: dict[str, Path]):
        self.paths = paths
        self.lock = threading.Lock()
        self.overflow = threading.Event()
        self.read_failed = threading.Event()
        self.retained = {"stdout": 0, "stderr": 0}
        self.combined = 0
        self.threads: list[threading.Thread] = []

    def start(self, process: subprocess.Popen[bytes]) -> None:
        if process.stdout is None or process.stderr is None:
            raise OwnerFailure("capture_pipe_missing")
        for name, pipe in (("stdout", process.stdout), ("stderr", process.stderr)):
            thread = threading.Thread(target=self._drain, args=(name, pipe), daemon=True)
            self.threads.append(thread)
            thread.start()

    def _drain(self, name: str, pipe) -> None:
        try:
            flags = os.O_WRONLY | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0)
            descriptor = os.open(self.paths[name], flags)
            try:
                info = os.fstat(descriptor)
                if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600):
                    raise OwnerFailure("capture_file_type")
                with os.fdopen(descriptor, "ab", buffering=0, closefd=False) as output:
                    while True:
                        chunk = pipe.read(65_536)
                        if not chunk:
                            return
                        with self.lock:
                            stream_room = STREAM_MAX_BYTES - self.retained[name]
                            combined_room = COMBINED_STREAM_MAX_BYTES - self.combined
                            keep = max(0, min(len(chunk), stream_room, combined_room))
                            if keep:
                                output.write(chunk[:keep])
                                self.retained[name] += keep
                                self.combined += keep
                            if keep != len(chunk):
                                self.overflow.set()
            finally:
                os.close(descriptor)
        except (OSError, OwnerFailure):
            self.read_failed.set()

    def join(self, timeout: float = 2.0) -> bool:
        deadline = time.monotonic() + timeout
        for thread in self.threads:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            thread.join(remaining)
        return all(not thread.is_alive() for thread in self.threads)


def file_digest(path: Path, capture: Capture | None = None) -> dict[str, object]:
    try:
        data = read_bounded(path, STREAM_MAX_BYTES, mode=0o600)
    except OwnerFailure:
        if capture is not None:
            capture.read_failed.set()
        return {"bytes": 0, "sha256": sha256(b"")}
    return {"bytes": len(data), "sha256": sha256(data)}


def copy_fixed_tap(source: Path, target: Path) -> bool:
    try:
        data = read_bounded(source, STREAM_MAX_BYTES, mode=0o600)
    except OwnerFailure:
        return False
    temporary = target.with_name(f".{target.name}.{uuid.uuid4()}.tmp")
    try:
        write_new(temporary, data, 0o600)
        os.replace(temporary, target)
        return True
    except (OwnerFailure, OSError):
        try:
            temporary.unlink()
        except OSError:
            pass
        return False


def list_entries(path: Path, counters: dict[str, int]) -> list[os.DirEntry[str]] | None:
    entries: list[os.DirEntry[str]] = []
    try:
        with os.scandir(path) as iterator:
            for entry in iterator:
                counters["registryEntries"] += 1
                if counters["registryEntries"] > REGISTRY_DIRECTORY_ENTRY_MAX:
                    counters["boundExceeded"] = 1
                    return None
                entries.append(entry)
    except OSError:
        return None
    return sorted(entries, key=lambda entry: entry.name)


def validate_sidecar_value(data: bytes, path: Path, registry_path: Path,
                           tmp_root: Path, filename_pid: int) -> dict[str, object]:
    if len(data) > SIDECAR_MAX_BYTES:
        raise OwnerFailure("sidecar_oversize")
    try:
        value = strict_json_bytes(data)
    except (UnicodeError, ValueError) as exc:
        raise OwnerFailure("sidecar_json") from exc
    if (not isinstance(value, dict)
            or set(value) != {"schema", "ownerPid", "directory", "launches"}
            or value.get("schema") != SIDECAR_SCHEMA
            or not isinstance(value.get("ownerPid"), int)
            or isinstance(value.get("ownerPid"), bool)
            or value.get("ownerPid") != filename_pid
            or not isinstance(value.get("directory"), str)
            or not isinstance(value.get("launches"), list)
            or not 1 <= len(value["launches"]) <= SIDECAR_LAUNCH_MAX):
        raise OwnerFailure("sidecar_shape")
    directory_text = value["directory"]
    directory = Path(directory_text)
    if not directory.is_absolute() or str(directory) != directory_text:
        raise OwnerFailure("sidecar_path")
    try:
        tmp_real = tmp_root.resolve(strict=True)
        parent_real = directory.parent.resolve(strict=True)
        directory_info = directory.lstat()
        registry_parent = registry_path.parent.resolve(strict=True)
    except OSError as exc:
        raise OwnerFailure("sidecar_directory") from exc
    if (parent_real != tmp_real or stat.S_ISLNK(directory_info.st_mode)
            or not stat.S_ISDIR(directory_info.st_mode)
            or stat.S_IMODE(directory_info.st_mode) != 0o700
            or directory_info.st_uid != os.getuid()
            or not directory.name.startswith("ah11-ops-")):
        raise OwnerFailure("sidecar_directory")
    expected_tag = hashlib.sha256(directory_text.encode("utf-8")).hexdigest()[:16]
    match = SIDECAR_NAME_RE.fullmatch(path.name)
    if match is None or int(match.group(1)) != filename_pid or match.group(2) != expected_tag:
        raise OwnerFailure("sidecar_name")
    if path != registry_path.parent / path.name and path.parent != registry_path.parent:
        raise OwnerFailure("sidecar_namespace")
    launches: list[dict[str, object]] = []
    tokens: set[str] = set()
    previous_token: str | None = None
    for launch in value["launches"]:
        expected = {
            "launchToken", "status", "spawnAttempted", "directPid", "groupId",
            "registryRegistered", "registryCleared", "groupAbsent",
        }
        if not isinstance(launch, dict) or set(launch) != expected:
            raise OwnerFailure("sidecar_launch_shape")
        token = launch.get("launchToken")
        status = launch.get("status")
        if not valid_uuid4(token) or not isinstance(status, str) or status not in SAFE_LAUNCH_STATUSES:
            raise OwnerFailure("sidecar_launch_identity")
        if token in tokens or (previous_token is not None and token <= previous_token):
            raise OwnerFailure("sidecar_launch_duplicate_or_order")
        tokens.add(token)
        previous_token = token
        for key in ("spawnAttempted", "registryRegistered", "registryCleared", "groupAbsent"):
            if not isinstance(launch.get(key), bool):
                raise OwnerFailure("sidecar_launch_bool")
        for key in ("directPid", "groupId"):
            item = launch.get(key)
            if item is not None and (not isinstance(item, int) or isinstance(item, bool) or item < 2):
                raise OwnerFailure("sidecar_launch_pid")
        if launch.get("groupId") is not None and launch.get("directPid") not in (None, launch.get("groupId")):
            raise OwnerFailure("sidecar_launch_pid_mismatch")
        if launch.get("registryRegistered") and launch.get("groupId") is None:
            raise OwnerFailure("sidecar_registered_without_group")
        if launch.get("groupAbsent") and launch.get("groupId") is None:
            raise OwnerFailure("sidecar_absent_without_group")
        if launch.get("registryCleared") and launch.get("groupId") is not None and not launch.get("groupAbsent"):
            raise OwnerFailure("sidecar_cleared_before_absence")
        launches.append(dict(launch))
    return {
        "path": path,
        "registryPath": registry_path,
        "directory": directory,
        "ownerPid": filename_pid,
        "launches": launches,
        "bytes": len(data),
        "namespace": "local" if registry_parent.parent == tmp_real else "outer",
    }


def discover_sidecars(registry_path: Path, tmp_root: Path,
                      counters: dict[str, int]) -> tuple[list[dict[str, object]], list[str]]:
    records: list[dict[str, object]] = []
    errors: list[str] = []
    entries = list_entries(registry_path.parent, counters)
    if entries is None:
        return records, ["outer_registry_directory_unreadable_or_oversize"]
    for entry in entries:
        name = entry.name
        if name == "owned-groups.json":
            continue
        is_final = SIDECAR_NAME_RE.fullmatch(name)
        is_temp = SIDECAR_TEMP_RE.fullmatch(name)
        is_registry_temp = REGISTRY_TEMP_RE.fullmatch(name)
        if is_registry_temp:
            try:
                info = entry.stat(follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or info.st_size > REGISTRY_MAX_BYTES:
                    errors.append("outer_registry_temporary_invalid")
            except OSError:
                errors.append("outer_registry_temporary_unreadable")
            errors.append("outer_registry_temporary_retained")
            continue
        if is_final is None and is_temp is None:
            errors.append("outer_registry_unexpected_entry")
            continue
        counters["candidates"] += 1
        if counters["candidates"] > SIDECAR_CANDIDATE_MAX:
            counters["boundExceeded"] = 1
            errors.append("sidecar_candidate_limit")
            continue
        try:
            info = entry.stat(follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode) or info.st_size > SIDECAR_MAX_BYTES:
                raise OwnerFailure("sidecar_candidate_shape")
            if stat.S_ISLNK(info.st_mode):
                raise OwnerFailure("sidecar_candidate_symlink")
        except (OSError, OwnerFailure):
            errors.append("outer_sidecar_candidate_invalid")
            continue
        if is_temp is not None:
            errors.append("sidecar_atomic_temporary_retained")
            continue
        counters["finalSidecarCount"] += 1
        if counters["finalSidecarCount"] > SIDECAR_COUNT_MAX:
            counters["boundExceeded"] = 1
            errors.append("sidecar_count_limit")
            continue
        side_path = Path(entry.path)
        try:
            data = read_bounded(side_path, SIDECAR_MAX_BYTES, mode=0o600)
            counters["sidecarReadBytes"] += len(data)
            if counters["sidecarReadBytes"] > SIDECAR_READ_MAX_BYTES:
                counters["boundExceeded"] = 1
                raise OwnerFailure("sidecar_read_limit")
            counters["finalSidecarBytes"] += len(data)
            if counters["finalSidecarBytes"] > SIDECAR_TOTAL_MAX_BYTES:
                counters["boundExceeded"] = 1
                raise OwnerFailure("sidecar_total_limit")
            record = validate_sidecar_value(data, side_path, registry_path, tmp_root, int(is_final.group(1)))
            records.append(record)
        except OwnerFailure:
            errors.append("outer_sidecar_invalid")
    return records, errors


def find_retry_directory(tmp_root: Path, counters: dict[str, int]) -> tuple[Path | None, list[str]]:
    errors: list[str] = []
    candidates: list[Path] = []
    try:
        iterator = os.scandir(tmp_root)
    except OSError:
        return None, ["tmp_root_unreadable"]
    with iterator:
        for index, entry in enumerate(iterator, start=1):
            if index > TMP_IMMEDIATE_ENTRY_MAX:
                counters["boundExceeded"] = 1
                return None, ["tmp_root_entry_limit"]
            if not entry.name.startswith("ah11-ops-temp-custody-retry-"):
                continue
            try:
                info = entry.stat(follow_symlinks=False)
            except OSError:
                errors.append("retry_directory_unreadable")
                continue
            if (stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)
                    or stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.getuid()):
                errors.append("retry_directory_invalid")
                continue
            candidates.append(Path(entry.path))
    if len(candidates) > 1:
        errors.append("retry_directory_duplicate")
        return None, errors
    return (candidates[0] if candidates else None), errors


def discover_local_sidecars(retry_dir: Path, tmp_root: Path,
                            counters: dict[str, int]) -> tuple[Path | None, list[dict[str, object]], list[str]]:
    registry_path = retry_dir / "owned-groups.json"
    records: list[dict[str, object]] = []
    errors: list[str] = []
    try:
        retry_info = lstat_directory(retry_dir, mode=0o700)
        if retry_info.st_uid != os.getuid():
            raise OwnerFailure("retry_directory_owner")
        if retry_dir.parent.resolve(strict=True) != tmp_root.resolve(strict=True):
            raise OwnerFailure("retry_path_escape")
        registry = read_registry(registry_path)
        del registry
    except (OwnerFailure, OSError):
        return None, records, ["local_registry_missing_or_invalid"]
    entries = list_entries(retry_dir, counters)
    if entries is None:
        return registry_path, records, ["local_registry_directory_unreadable_or_oversize"]
    for entry in entries:
        name = entry.name
        if name == "owned-groups.json":
            continue
        is_final = SIDECAR_NAME_RE.fullmatch(name)
        is_temp = SIDECAR_TEMP_RE.fullmatch(name)
        is_registry_temp = REGISTRY_TEMP_RE.fullmatch(name)
        if is_registry_temp:
            try:
                info = entry.stat(follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or info.st_size > REGISTRY_MAX_BYTES:
                    errors.append("local_registry_temporary_invalid")
            except OSError:
                errors.append("local_registry_temporary_unreadable")
            errors.append("local_registry_temporary_retained")
            continue
        if is_final is None and is_temp is None:
            errors.append("local_registry_unexpected_entry")
            continue
        counters["candidates"] += 1
        if counters["candidates"] > SIDECAR_CANDIDATE_MAX:
            counters["boundExceeded"] = 1
            errors.append("sidecar_candidate_limit")
            continue
        try:
            info = entry.stat(follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode) or info.st_size > SIDECAR_MAX_BYTES:
                raise OwnerFailure("sidecar_candidate_shape")
            if stat.S_ISLNK(info.st_mode):
                raise OwnerFailure("sidecar_candidate_symlink")
        except (OSError, OwnerFailure):
            errors.append("local_sidecar_candidate_invalid")
            continue
        if is_temp is not None:
            errors.append("sidecar_atomic_temporary_retained")
            continue
        counters["finalSidecarCount"] += 1
        if counters["finalSidecarCount"] > SIDECAR_COUNT_MAX:
            counters["boundExceeded"] = 1
            errors.append("sidecar_count_limit")
            continue
        side_path = Path(entry.path)
        try:
            data = read_bounded(side_path, SIDECAR_MAX_BYTES, mode=0o600)
            counters["sidecarReadBytes"] += len(data)
            if counters["sidecarReadBytes"] > SIDECAR_READ_MAX_BYTES:
                counters["boundExceeded"] = 1
                raise OwnerFailure("sidecar_read_limit")
            counters["finalSidecarBytes"] += len(data)
            if counters["finalSidecarBytes"] > SIDECAR_TOTAL_MAX_BYTES:
                counters["boundExceeded"] = 1
                raise OwnerFailure("sidecar_total_limit")
            record = validate_sidecar_value(data, side_path, registry_path, tmp_root, int(is_final.group(1)))
            record["namespace"] = "local"
            records.append(record)
        except OwnerFailure:
            errors.append("local_sidecar_invalid")
    return registry_path, records, errors


def sidecar_records_for_namespace(records: list[dict[str, object]], namespace: str) -> list[dict[str, object]]:
    return [record for record in records if record.get("namespace") == namespace]


def write_registry_state(path: Path, registry: dict[str, object], groups: list[int],
                         pending: list[str]) -> bool:
    next_value = {
        "schema": REGISTRY_SCHEMA,
        "groups": sorted(set(groups)),
        "pendingLaunches": sorted(set(pending)),
    }
    if len(next_value["groups"]) > REGISTRY_GROUP_MAX or len(next_value["pendingLaunches"]) > REGISTRY_PENDING_MAX:
        return False
    try:
        current = read_registry(path)
    except OwnerFailure:
        return False
    if current != registry:
        return False
    if not atomic_write_json(path, next_value):
        return False
    try:
        reread = read_registry(path)
    except OwnerFailure:
        return False
    return reread == next_value


def reconcile_registry(path: Path, sidecars: list[dict[str, object]],
                       protected: set[int], global_group_ids: set[int]) -> dict[str, object]:
    result: dict[str, object] = {
        "empty": False, "groupsObserved": 0, "groupsAbsent": set(),
        "pendingRemaining": None, "ok": False, "escalation": "none",
    }
    try:
        registry = read_registry(path)
    except OwnerFailure:
        return result
    rows = [row for sidecar in sidecars for row in sidecar["launches"]]
    tokens: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        tokens.setdefault(str(row["launchToken"]), []).append(row)
    for pending_token in registry["pendingLaunches"]:
        matches = tokens.get(str(pending_token), [])
        if len(matches) != 1:
            return result
        row = matches[0]
        if (row["spawnAttempted"] is not False or row["directPid"] is not None
                or row["groupId"] is not None):
            return result
    groups_before = list(registry["groups"])
    if any(group in protected for group in groups_before):
        return result
    if not global_group_ids.isdisjoint(set(groups_before)):
        return result
    global_group_ids.update(groups_before)
    if len(global_group_ids) > REGISTRY_GROUP_MAX * 2:
        return result
    result["groupsObserved"] = len(groups_before)
    cleanup_status: dict[int, bool | None] = {}
    escalation = "none"
    if groups_before:
        cleanup_result = cleanup_groups(groups_before)
        cleanup_status = cleanup_result.get("final", {})
        if any(v == "sent" for v in cleanup_result.get("kill", {}).values()):
            escalation = "kill"
        elif any(v == "sent" for v in cleanup_result.get("term", {}).values()):
            escalation = "term"
    result["escalation"] = escalation
    if any(cleanup_status.get(group) is not False for group in groups_before):
        return result
    groups_absent = set(groups_before)
    result["groupsAbsent"] = groups_absent
    latest = registry
    try:
        latest = read_registry(path)
    except OwnerFailure:
        return result
    latest_groups = list(latest["groups"])
    if latest_groups != groups_before:
        newly_seen = [group for group in latest_groups if group not in global_group_ids]
        if newly_seen:
            if any(group in protected for group in newly_seen):
                return result
            global_group_ids.update(newly_seen)
            if len(global_group_ids) > REGISTRY_GROUP_MAX * 2:
                return result
            result["groupsObserved"] = int(result["groupsObserved"]) + len(newly_seen)
            more = cleanup_groups(newly_seen)
            if any(more.get("final", {}).get(group) is not False for group in newly_seen):
                return result
            groups_absent.update(newly_seen)
            if any(v == "sent" for v in more.get("kill", {}).values()):
                result["escalation"] = "kill"
            elif any(v == "sent" for v in more.get("term", {}).values()) and result["escalation"] == "none":
                result["escalation"] = "term"
            try:
                latest = read_registry(path)
            except OwnerFailure:
                return result
            latest_groups = list(latest["groups"])
        if any(group not in groups_absent for group in latest_groups):
            return result
    pending_before = list(latest["pendingLaunches"])
    cancelable = set()
    for token in pending_before:
        matches = tokens.get(str(token), [])
        if len(matches) != 1:
            continue
        row = matches[0]
        if (row["spawnAttempted"] is False and row["directPid"] is None
                and row["groupId"] is None):
            cancelable.add(token)
    next_groups = [group for group in latest_groups if group not in groups_absent]
    next_pending = [token for token in pending_before if token not in cancelable]
    if next_groups != latest_groups or next_pending != pending_before:
        if not write_registry_state(path, latest, next_groups, next_pending):
            return result
    try:
        final = read_registry(path)
    except OwnerFailure:
        return result
    result["pendingRemaining"] = len(final["pendingLaunches"])
    result["empty"] = final["groups"] == [] and final["pendingLaunches"] == []
    result["groupsAbsent"] = groups_absent
    result["ok"] = result["empty"]
    return result


def sidecar_rows_resolved(records: list[dict[str, object]], namespace: str,
                          registry_result: dict[str, object],
                          original_registry: dict[str, object] | None) -> bool:
    rows = [row for record in records if record.get("namespace") == namespace
            for row in record.get("launches", [])]
    if original_registry is None:
        return False
    original_groups = set(original_registry["groups"])
    original_pending = set(original_registry["pendingLaunches"])
    absent = registry_result.get("groupsAbsent", set())
    for row in rows:
        token = row["launchToken"]
        group_id = row["groupId"]
        if row["spawnAttempted"] is False:
            if row["directPid"] is not None or group_id is not None:
                return False
            if token in original_pending and not registry_result.get("empty"):
                return False
            continue
        if group_id is None:
            if not (row["groupAbsent"] is True and row["registryCleared"] is True):
                return False
            continue
        if group_id in original_groups:
            if group_id not in absent:
                return False
        elif row["groupAbsent"] is not True or row["registryCleared"] is not True:
            # Groups absent from the original registry require durable source proof.
            return False
    return True


def validate_sidecar_inventory(records: list[dict[str, object]], outer_registry: dict[str, object] | None,
                               local_registry: dict[str, object] | None) -> bool:
    seen_tokens: set[str] = set()
    seen_directories: set[str] = set()
    outer_groups = set(outer_registry["groups"]) if outer_registry else set()
    local_groups = set(local_registry["groups"]) if local_registry else set()
    outer_pending = set(outer_registry["pendingLaunches"]) if outer_registry else set()
    local_pending = set(local_registry["pendingLaunches"]) if local_registry else set()
    for record in records:
        directory = str(record["directory"])
        if directory in seen_directories:
            return False
        seen_directories.add(directory)
        namespace = record["namespace"]
        groups = outer_groups if namespace == "outer" else local_groups
        pending = outer_pending if namespace == "outer" else local_pending
        for row in record["launches"]:
            token = row["launchToken"]
            if token in seen_tokens:
                return False
            seen_tokens.add(token)
            if row["groupId"] in groups and row["registryRegistered"] is not True:
                return False
            if token in pending and (row["spawnAttempted"] is not False or row["groupId"] is not None):
                return False
    for registry, groups, pending, namespace in (
        (outer_registry, outer_groups, outer_pending, "outer"),
        (local_registry, local_groups, local_pending, "local"),
    ):
        if registry is None:
            continue
        namespace_rows = [row for record in records if record["namespace"] == namespace
                          for row in record["launches"]]
        for group in groups:
            matches = [row for row in namespace_rows if row["groupId"] == group]
            if len(matches) != 1 or matches[0]["registryRegistered"] is not True:
                return False
        for token in pending:
            if len([row for row in namespace_rows if row["launchToken"] == token]) != 1:
                return False
    return True


def preflight_tree(directory: Path, counters: dict[str, int],
                   sidecar_path: Path | None = None) -> list[Path] | None:
    try:
        lstat_directory(directory)
        if directory.is_symlink():
            return None
    except OwnerFailure:
        return None
    paths: list[Path] = []
    stack = [directory]
    local_count = 0
    local_bytes = 0
    while stack:
        current = stack.pop()
        try:
            iterator = os.scandir(current)
        except OSError:
            return None
        with iterator:
            for entry in iterator:
                path = Path(entry.path)
                kept_sidecar = sidecar_path is not None and path == sidecar_path
                local_count += 1
                counters["treeDescendants"] += 1
                if (local_count > TREE_DESCENDANT_MAX
                        or counters["treeDescendants"] > TREE_DESCENDANT_MAX * SIDECAR_COUNT_MAX):
                    counters["boundExceeded"] = 1
                    return None
                try:
                    info = entry.stat(follow_symlinks=False)
                except OSError:
                    return None
                if stat.S_ISLNK(info.st_mode):
                    return None
                if stat.S_ISDIR(info.st_mode):
                    if kept_sidecar:
                        return None
                    stack.append(path)
                    paths.append(path)
                elif stat.S_ISREG(info.st_mode):
                    if info.st_size < 0:
                        return None
                    local_bytes += info.st_size
                    counters["treeBytes"] += info.st_size
                    if (local_bytes > TREE_DIRECTORY_BYTES_MAX
                            or counters["treeBytes"] > TREE_ALL_BYTES_MAX):
                        counters["boundExceeded"] = 1
                        return None
                    if not kept_sidecar:
                        paths.append(path)
                else:
                    return None
    paths.sort(key=lambda value: (len(value.parts), str(value)), reverse=True)
    return paths


def remove_preflighted_directory(directory: Path, paths: list[Path],
                                 keep_sidecar: Path | None = None) -> bool:
    try:
        for path in paths:
            if path.is_dir() and not path.is_symlink():
                path.rmdir()
            else:
                path.unlink()
        if keep_sidecar is not None:
            keep_sidecar.unlink()
        directory.rmdir()
        return True
    except OSError:
        return False


def preflight_external_sidecars(records: list[dict[str, object]],
                                counters: dict[str, int]) -> list[tuple[dict[str, object], list[Path]]] | None:
    prepared: list[tuple[dict[str, object], list[Path]]] = []
    for record in records:
        if record["namespace"] != "outer":
            continue
        paths = preflight_tree(record["directory"], counters)
        if paths is None:
            return None
        prepared.append((record, paths))
    return prepared


def reconcile_custody(tmp_root: Path, outer_registry_path: Path,
                      target_pgid: int | None, watchdog_pgid: int | None,
                      expected_directories: dict[str, tuple[int, int]]) -> dict[str, object]:
    counters = {
        "registryEntries": 0, "candidates": 0, "finalSidecarCount": 0,
        "sidecarReadBytes": 0, "finalSidecarBytes": 0,
        "treeDescendants": 0, "treeBytes": 0,
        "boundExceeded": 0,
    }
    outcome: dict[str, object] = {
        "outerRegistryEmpty": False, "localRegistryEmpty": True,
        "sidecarsReconciled": False, "groupsObserved": 0,
        "sidecarsObserved": 0, "sidecarsReconciledCount": 0,
        "pendingLaunchesRemaining": None, "escalationStage": "none",
    }
    outer_before: dict[str, object] | None = None
    local_before: dict[str, object] | None = None
    if not validate_private_state_roots(tmp_root, outer_registry_path, expected_directories):
        return outcome
    try:
        outer_before = read_registry(outer_registry_path)
    except OwnerFailure:
        return outcome
    outer_records, outer_errors = discover_sidecars(outer_registry_path, tmp_root, counters)
    retry_dir, retry_errors = find_retry_directory(tmp_root, counters)
    local_registry_path: Path | None = None
    local_records: list[dict[str, object]] = []
    local_errors: list[str] = []
    if retry_dir is not None:
        local_registry_path, local_records, local_errors = discover_local_sidecars(retry_dir, tmp_root, counters)
        if local_registry_path is not None:
            try:
                local_before = read_registry(local_registry_path)
            except OwnerFailure:
                local_before = None
    records = outer_records + local_records
    outcome["sidecarsObserved"] = len(records)
    if local_before is None and retry_dir is not None:
        outcome["localRegistryEmpty"] = False
    errors = outer_errors + retry_errors + local_errors
    if counters["boundExceeded"]:
        errors.append("budget_exceeded")
    if len(records) > SIDECAR_COUNT_MAX:
        errors.append("sidecar_count_limit")
    if not validate_sidecar_inventory(records, outer_before, local_before):
        errors.append("sidecar_registry_mismatch")
    protected = {os.getpgrp()}
    if target_pgid is not None:
        protected.add(target_pgid)
    if watchdog_pgid is not None:
        protected.add(watchdog_pgid)
    all_groups: set[int] = set()
    outer_result = reconcile_registry(
        outer_registry_path, sidecar_records_for_namespace(records, "outer"),
        protected, all_groups
    )
    outcome["groupsObserved"] = int(outer_result.get("groupsObserved", 0))
    outcome["outerRegistryEmpty"] = outer_result.get("empty") is True
    outcome["pendingLaunchesRemaining"] = outer_result.get("pendingRemaining")
    outcome["escalationStage"] = outer_result.get("escalation", "none")
    local_result: dict[str, object] = {"empty": True, "ok": True, "groupsObserved": 0,
                                       "groupsAbsent": set(), "pendingRemaining": 0}
    if local_registry_path is not None and local_before is not None:
        local_result = reconcile_registry(
            local_registry_path, sidecar_records_for_namespace(records, "local"),
            protected, all_groups
        )
        outcome["localRegistryEmpty"] = local_result.get("empty") is True
        outcome["groupsObserved"] = int(outcome["groupsObserved"]) + int(local_result.get("groupsObserved", 0))
        if local_result.get("escalation") == "kill" or (
                local_result.get("escalation") == "term" and outcome["escalationStage"] == "none"):
            outcome["escalationStage"] = local_result.get("escalation")
    outer_pending = outer_result.get("pendingRemaining")
    local_pending = local_result.get("pendingRemaining")
    if (isinstance(outer_pending, int) and not isinstance(outer_pending, bool)
            and isinstance(local_pending, int) and not isinstance(local_pending, bool)):
        outcome["pendingLaunchesRemaining"] = outer_pending + local_pending
    else:
        outcome["pendingLaunchesRemaining"] = None
    resolved_rows = (
        outer_result.get("ok") is True
        and sidecar_rows_resolved(records, "outer", outer_result, outer_before)
        and local_result.get("ok") is True
        and sidecar_rows_resolved(records, "local", local_result, local_before or {
            "groups": [], "pendingLaunches": []
        })
    )
    if retry_dir is not None and local_before is None:
        resolved_rows = False
    if not resolved_rows or errors:
        outcome["sidecarsReconciled"] = False
        return outcome
    if not outcome["outerRegistryEmpty"] or not outcome["localRegistryEmpty"]:
        return outcome
    prepared_external = preflight_external_sidecars(records, counters)
    if prepared_external is None:
        return outcome
    local_record = next((record for record in records if record["namespace"] == "local"), None)
    local_paths: list[Path] | None = None
    if retry_dir is not None:
        local_path = local_record["path"] if local_record is not None else None
        local_paths = preflight_tree(retry_dir, counters, local_path)
        if local_paths is None:
            return outcome
    for record, paths in prepared_external:
        if not remove_preflighted_directory(record["directory"], paths):
            return outcome
        try:
            record["path"].unlink()
        except OSError:
            return outcome
    if retry_dir is not None and local_paths is not None:
        keep_local = local_record["path"] if local_record is not None else None
        if not remove_preflighted_directory(retry_dir, local_paths, keep_local):
            return outcome
    outcome["sidecarsReconciled"] = True
    outcome["sidecarsReconciledCount"] = len(records)
    return outcome


def make_receipt(route: str, command_exit: int | None, wrapper_exit: int,
                 timeout_stage: str, escalation_stage: str,
                 command_reaped: bool, command_absent: bool,
                 watchdog_reaped: bool, watchdog_absent: bool,
                 custody: dict[str, object], capture: Capture | None,
                 stdout_path: Path | None, stderr_path: Path | None,
                 elapsed_ms: int) -> dict[str, object]:
    stdout = file_digest(stdout_path, capture) if stdout_path is not None else {"bytes": 0, "sha256": sha256(b"")}
    stderr = file_digest(stderr_path, capture) if stderr_path is not None else {"bytes": 0, "sha256": sha256(b"")}
    elapsed_capped = elapsed_ms > MAX_REPORTED_ELAPSED_MS
    return {
        "schema": RECEIPT_SCHEMA,
        "route": route,
        "argvClass": ROUTES[route]["argvClass"],
        "commandExitCode": command_exit,
        "wrapperExitCode": wrapper_exit,
        "timeoutStage": timeout_stage if timeout_stage in TIMEOUT_STAGES else "launch_gate",
        "escalationStage": escalation_stage if escalation_stage in ESCALATION_STAGES else "unconfirmed",
        "commandDirectReaped": command_reaped is True,
        "commandGroupAbsent": command_absent is True,
        "watchdogReaped": watchdog_reaped is True,
        "watchdogGroupAbsent": watchdog_absent is True,
        "outerRegistryEmpty": custody.get("outerRegistryEmpty") is True,
        "localRegistryEmpty": custody.get("localRegistryEmpty") is True,
        "sidecarsReconciled": custody.get("sidecarsReconciled") is True,
        "outputOverflow": capture.overflow.is_set() if capture is not None else False,
        "captureReadFailed": capture.read_failed.is_set() if capture is not None else False,
        "elapsedMs": min(elapsed_ms, MAX_REPORTED_ELAPSED_MS),
        "elapsedCapped": elapsed_capped,
        "groupsObserved": int(custody.get("groupsObserved", 0)),
        "sidecarsObserved": int(custody.get("sidecarsObserved", 0)),
        "sidecarsReconciledCount": int(custody.get("sidecarsReconciledCount", 0)),
        "pendingLaunchesRemaining": custody.get("pendingLaunchesRemaining"),
        "stdout": stdout,
        "stderr": stderr,
    }


def validate_receipt_value(value: object, expected_route: str) -> bool:
    if not isinstance(value, dict) or set(value) != RECEIPT_KEYS:
        return False
    if (value.get("schema") != RECEIPT_SCHEMA or value.get("route") != expected_route
            or value.get("argvClass") != ROUTES[expected_route]["argvClass"]):
        return False
    if (not isinstance(value.get("timeoutStage"), str)
            or value.get("timeoutStage") not in TIMEOUT_STAGES
            or not isinstance(value.get("escalationStage"), str)
            or value.get("escalationStage") not in ESCALATION_STAGES):
        return False
    for key in ("commandDirectReaped", "commandGroupAbsent", "watchdogReaped",
                "watchdogGroupAbsent", "outerRegistryEmpty", "localRegistryEmpty",
                "sidecarsReconciled", "outputOverflow", "captureReadFailed", "elapsedCapped"):
        if not isinstance(value.get(key), bool):
            return False
    for key in ("wrapperExitCode", "elapsedMs", "groupsObserved",
                "sidecarsObserved", "sidecarsReconciledCount"):
        item = value.get(key)
        if not isinstance(item, int) or isinstance(item, bool) or item < 0:
            return False
    if (value["wrapperExitCode"] > 255 or value["groupsObserved"] > REGISTRY_GROUP_MAX * 2
            or value["sidecarsObserved"] > SIDECAR_COUNT_MAX
            or value["sidecarsReconciledCount"] > SIDECAR_COUNT_MAX
            or value["sidecarsReconciledCount"] > value["sidecarsObserved"]):
        return False
    command_exit = value.get("commandExitCode")
    if command_exit is not None and (not isinstance(command_exit, int) or isinstance(command_exit, bool)
                                     or command_exit < -128 or command_exit > 255):
        return False
    pending = value.get("pendingLaunchesRemaining")
    if pending is not None and (not isinstance(pending, int) or isinstance(pending, bool)
                                or not 0 <= pending <= REGISTRY_PENDING_MAX * 2):
        return False
    for name in ("stdout", "stderr"):
        item = value.get(name)
        if (not isinstance(item, dict) or set(item) != {"bytes", "sha256"}
                or not isinstance(item.get("bytes"), int) or isinstance(item.get("bytes"), bool)
                or not 0 <= item["bytes"] <= STREAM_MAX_BYTES
                or not isinstance(item.get("sha256"), str)
                or re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is None):
            return False
    if value["elapsedMs"] > MAX_REPORTED_ELAPSED_MS:
        return False
    if value["elapsedCapped"] and value["wrapperExitCode"] == 0:
        return False
    return True


def parse_route_args(argv: list[str]) -> str | None:
    if len(argv) != 2 or argv[0] != "--route" or argv[1] not in ROUTE_IDS:
        return None
    return argv[1]


def _signal_handler(signum: int, _frame) -> None:
    global _received_signal
    _received_signal = signum


def run_route(route: str, root: Path) -> int:
    global _received_signal
    started_ns = time.monotonic_ns()
    _received_signal = None
    if os.name != "posix" or not hasattr(os, "killpg"):
        sys.stderr.write("OPS-CI1 owner requires POSIX process-group support.\n")
        return 1
    artifact_root = root / ".runtime-artifacts"
    route_cfg = ROUTES[route]
    run_root: Path | None = None
    registry_root: Path | None = None
    registry_path: Path | None = None
    tmp_root: Path | None = None
    stdout_path: Path | None = None
    stderr_path: Path | None = None
    control_path: Path | None = None
    ready_path: Path | None = None
    ack_path: Path | None = None
    result_path: Path | None = None
    gate_path: Path | None = None
    process: subprocess.Popen[bytes] | None = None
    watchdog: subprocess.Popen[bytes] | None = None
    target_pgid: int | None = None
    watchdog_pgid: int | None = None
    command_exit: int | None = None
    command_reaped = False
    command_absent = False
    watchdog_reaped = False
    watchdog_absent = False
    timeout_stage = "none"
    escalation_stage = "none"
    capture: Capture | None = None
    artifact_root_identity: tuple[int, int] | None = None
    state_directory_identities: dict[str, tuple[int, int]] = {}
    custody: dict[str, object] = {
        "outerRegistryEmpty": False, "localRegistryEmpty": True,
        "sidecarsReconciled": False, "groupsObserved": 0,
        "sidecarsObserved": 0, "sidecarsReconciledCount": 0,
        "pendingLaunchesRemaining": None, "escalationStage": "none",
    }
    previous_handlers: dict[int, object] = {}
    owner_error = False
    try:
        if shutil.which(str(route_cfg["argv"][0])) is None:
            raise OwnerFailure("command_missing")
        prepare_artifact_root(artifact_root)
        artifact_root_identity = directory_identity(artifact_root)
        clear_stale_route_evidence(artifact_root, route)
        run_root, registry_root, registry_path, tmp_root = prepare_state(artifact_root)
        state_directory_identities = {
            str(path): directory_identity(path, 0o700)
            for path in (run_root.parent, run_root, registry_root, tmp_root)
        }
        stdout_path = run_root / "stdout.raw"
        stderr_path = run_root / "stderr.raw"
        for path in (stdout_path, stderr_path):
            write_new(path, b"", 0o600)
        control_path = run_root / "watchdog-control.json"
        ready_path = run_root / "watchdog-ready.json"
        ack_path = run_root / "watchdog-target-ack.json"
        result_path = run_root / "watchdog-result.json"
        gate_path = run_root / "command-ready.json"
        environment = private_environment(tmp_root, registry_path)
        for signum in PROCESS_SIGNAL_NAMES:
            previous_handlers[signum] = signal.signal(signum, _signal_handler)
        with open(os.devnull, "wb") as devnull:
            watchdog = subprocess.Popen(
                [sys.executable, "-c", _watchdog_source(),
                 str(control_path), str(registry_path), str(ready_path), str(ack_path),
                 str(result_path), str(WATCHDOG_LIMIT_MS)],
                cwd=root, env=environment, stdin=subprocess.DEVNULL,
                stdout=devnull, stderr=devnull, start_new_session=True, close_fds=True,
            )
        watchdog_pgid = watchdog.pid
        if not wait_file(ready_path, watchdog, WATCHDOG_READY_MS):
            timeout_stage = "launch_gate"
            raise OwnerFailure("watchdog_ready")
        watchdog_ready = read_small_json(ready_path)
        if (not isinstance(watchdog_ready, dict)
                or set(watchdog_ready) != {"schema", "pid", "pgid", "startedMonotonicNs"}
                or watchdog_ready.get("schema") != "ops-owned-group-watchdog-ready.v1"
                or watchdog_ready.get("pid") != watchdog.pid
                or watchdog_ready.get("pgid") != watchdog.pid
                or not isinstance(watchdog_ready.get("startedMonotonicNs"), int)
                or isinstance(watchdog_ready.get("startedMonotonicNs"), bool)
                or watchdog_ready.get("startedMonotonicNs", 0) <= 0
                or os.getpgid(watchdog.pid) != watchdog.pid
                or group_exists(watchdog.pid) is not True):
            timeout_stage = "launch_gate"
            raise OwnerFailure("watchdog_ready_invalid")
        with stdout_path.open("ab", buffering=0), stderr_path.open("ab", buffering=0):
            pass
        capture = Capture({"stdout": stdout_path, "stderr": stderr_path})
        command = list(route_cfg["argv"])
        bootstrap = _bootstrap_source()
        process = subprocess.Popen(
            [sys.executable, "-c", bootstrap, str(gate_path), json.dumps(command), str(COMMAND_GATE_MS)],
            cwd=root, env=environment, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True, close_fds=True,
        )
        target_pgid = process.pid
        # The bootstrap receives its own pid through the gate. It cannot launch
        # npm or Make until the separate watchdog verifies this exact group.
        gate_payload = {"schema": "ops-command-ready.v1", "targetPgid": target_pgid}
        capture.start(process)
        # The gate file is written only after the watchdog's exact-target ack.
        if not atomic_control(control_path, "running", target_pgid):
            timeout_stage = "launch_gate"
            raise OwnerFailure("control_write")
        if not wait_file(ack_path, watchdog, TARGET_ACK_MS):
            timeout_stage = "launch_gate"
            raise OwnerFailure("target_ack")
        ack = read_small_json(ack_path)
        if ack != {"schema": "ops-owned-group-target-ack.v1", "targetPgid": target_pgid, "verified": True}:
            timeout_stage = "launch_gate"
            raise OwnerFailure("target_ack_invalid")
        if not atomic_write_json(gate_path, gate_payload):
            timeout_stage = "launch_gate"
            raise OwnerFailure("command_gate_write")
        deadline = time.monotonic() + COMMAND_WAIT_MS / 1000
        while process.poll() is None:
            if _received_signal is not None:
                timeout_stage = "signal"
                break
            if capture.overflow.is_set() or capture.read_failed.is_set():
                break
            if time.monotonic() >= deadline:
                timeout_stage = "command_wait"
                break
            time.sleep(0.025)
        if process.poll() is not None:
            command_exit = process.returncode
            command_reaped = True
        if timeout_stage != "none" or capture.overflow.is_set() or capture.read_failed.is_set():
            owner_error = True
    except (OwnerFailure, OSError, ValueError, subprocess.SubprocessError):
        owner_error = True
    finally:
        if control_path is not None:
            state = "finish" if not owner_error and command_exit == 0 and _received_signal is None else "cleanup"
            if not atomic_control(control_path, state, target_pgid):
                owner_error = True
        if process is not None:
            if target_pgid is not None:
                command_exit, command_reaped, command_absent, escalation_stage = cleanup_target_group(
                    target_pgid, process, command_exit, command_reaped
                )
            elif not command_reaped:
                command_exit, command_reaped = wait_process(process, DIRECT_REAP_MS)
                escalation_stage = "unconfirmed"
            if not command_reaped or not command_absent or escalation_stage == "unconfirmed":
                owner_error = True
        # On the watchdog timeout path, let its exact-group cleanup finish before
        # the parent reads the registries. It never mutates their contents.
        watchdog_record: object = None
        if watchdog is not None and result_path is not None:
            try:
                if wait_file(result_path, watchdog, 4_000):
                    watchdog_record = read_small_json(result_path, 8_192)
            except OwnerFailure:
                watchdog_record = None
        if watchdog_record is None and watchdog is not None and result_path is not None:
            try:
                if watchdog.poll() is not None and wait_file(result_path, watchdog, 250):
                    watchdog_record = read_small_json(result_path, 8_192)
            except OwnerFailure:
                watchdog_record = None
        watchdog_protocol_ok = bool(
            isinstance(watchdog_record, dict)
            and set(watchdog_record) == {
                "schema", "pid", "pgid", "startedMonotonicNs", "timedOut",
                "controlState", "targetPgid", "targetAckSent", "targetCleanup",
                "registryError", "registeredGroupCleanup", "elapsedMs",
            }
            and watchdog_record.get("schema") == "ops-owned-group-watchdog-result.v1"
            and watchdog_record.get("pid") == watchdog_pgid
            and watchdog_record.get("pgid") == watchdog_pgid
            and watchdog_record.get("timedOut") is False
            and watchdog_record.get("controlState") in ("finish", "cleanup")
            and watchdog_record.get("targetPgid") == target_pgid
            and watchdog_record.get("targetAckSent") is (target_pgid is not None)
            and isinstance(watchdog_record.get("startedMonotonicNs"), int)
            and not isinstance(watchdog_record.get("startedMonotonicNs"), bool)
            and isinstance(watchdog_record.get("elapsedMs"), int)
            and not isinstance(watchdog_record.get("elapsedMs"), bool)
            and 0 <= watchdog_record.get("elapsedMs", -1) <= WATCHDOG_LIMIT_MS + 10_000
            and isinstance(watchdog_record.get("targetCleanup"), dict)
            and isinstance(watchdog_record.get("registeredGroupCleanup"), dict)
        )
        if not watchdog_protocol_ok:
            owner_error = True
        if isinstance(watchdog_record, dict) and watchdog_record.get("timedOut") is True:
            timeout_stage = "watchdog"
            target_cleanup = watchdog_record.get("targetCleanup")
            registered_cleanup = watchdog_record.get("registeredGroupCleanup")
            if (not isinstance(target_cleanup, dict)
                    or target_cleanup.get("allAbsent") is not True):
                owner_error = True
            if (not isinstance(registered_cleanup, dict)
                    or registered_cleanup.get("allAbsent") is not True):
                owner_error = True
        if (tmp_root is not None and registry_path is not None
                and command_reaped and command_absent):
            try:
                custody = reconcile_custody(
                    tmp_root, registry_path, target_pgid, watchdog_pgid,
                    state_directory_identities,
                )
            except Exception:
                owner_error = True
                custody["sidecarsReconciled"] = False
            if custody.get("escalationStage") in ("term", "kill"):
                if escalation_stage == "none" or custody["escalationStage"] == "kill":
                    escalation_stage = str(custody["escalationStage"])
            if (custody.get("outerRegistryEmpty") is not True
                    or custody.get("localRegistryEmpty") is not True
                    or custody.get("sidecarsReconciled") is not True):
                owner_error = True
        else:
            owner_error = True
        if watchdog is not None and watchdog_pgid is not None:
            try:
                stop = stop_watchdog(watchdog, watchdog_pgid)
                watchdog_reaped = stop["reaped"] is True
                watchdog_absent = stop["groupAbsent"] is True
                if not watchdog_reaped or not watchdog_absent or stop["exitCode"] != 0:
                    owner_error = True
                if stop.get("cleanup", {}).get("allAbsent") is not True and not watchdog_absent:
                    owner_error = True
            except (OSError, ValueError):
                owner_error = True
        if capture is not None:
            if not capture.join(2.0):
                owner_error = True
        for signum, previous in previous_handlers.items():
            try:
                signal.signal(signum, previous)
            except (OSError, ValueError):
                owner_error = True
    if _received_signal is not None:
        timeout_stage = "signal"
        owner_error = True
    if capture is not None and (capture.overflow.is_set() or capture.read_failed.is_set()):
        owner_error = True
    if route_cfg["tap"] and stdout_path is not None:
        if not copy_fixed_tap(stdout_path, artifact_root / str(route_cfg["tap"])):
            owner_error = True
    command_status = command_exit
    if _received_signal is not None:
        wrapper_exit = min(255, 128 + int(_received_signal))
    elif command_exit is not None and command_exit < 0:
        wrapper_exit = min(255, 128 + abs(int(command_exit)))
    elif owner_error or command_exit is None or not command_reaped or not command_absent:
        wrapper_exit = 1 if command_exit in (None, 0) else int(command_exit)
    else:
        wrapper_exit = int(command_exit)
    elapsed = max(0, round((time.monotonic_ns() - started_ns) / 1_000_000))
    receipt = make_receipt(
        route, command_status, wrapper_exit, timeout_stage, escalation_stage,
        command_reaped, command_absent, watchdog_reaped, watchdog_absent,
        custody, capture, stdout_path, stderr_path, elapsed,
    )
    if capture is not None and capture.read_failed.is_set():
        owner_error = True
        if wrapper_exit == 0:
            wrapper_exit = 1
        receipt["captureReadFailed"] = True
        receipt["wrapperExitCode"] = wrapper_exit
    if receipt["elapsedCapped"]:
        owner_error = True
        if wrapper_exit == 0:
            wrapper_exit = 1
        receipt["wrapperExitCode"] = wrapper_exit
    if not validate_receipt_value(receipt, route):
        owner_error = True
        wrapper_exit = 1
        receipt["wrapperExitCode"] = wrapper_exit
    receipt_path = artifact_root / str(route_cfg["receipt"])
    try:
        prepare_artifact_root(artifact_root)
        if directory_identity(artifact_root) != artifact_root_identity:
            raise OwnerFailure("artifact_root_replaced")
        payload = (json.dumps(receipt, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
        if len(payload) > RECEIPT_MAX_BYTES:
            owner_error = True
            wrapper_exit = 1
        else:
            temporary = receipt_path.with_name(f".{receipt_path.name}.{uuid.uuid4()}.tmp")
            write_new(temporary, payload, 0o600)
            os.replace(temporary, receipt_path)
            directory_fd = os.open(artifact_root, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            saved = strict_json_bytes(read_bounded(receipt_path, RECEIPT_MAX_BYTES, mode=0o600))
            if not validate_receipt_value(saved, route):
                owner_error = True
                wrapper_exit = 1
    except (OwnerFailure, OSError, ValueError):
        owner_error = True
        wrapper_exit = 1
    if owner_error or wrapper_exit != 0:
        sys.stderr.write("OPS-CI1 owner did not qualify route completion.\n")
        return wrapper_exit if wrapper_exit != 0 else 1
    return 0


def main(argv: list[str] | None = None) -> int:
    route = parse_route_args(sys.argv[1:] if argv is None else argv)
    if route is None:
        sys.stderr.write("Usage: python3 .github/scripts/run_ops_owned_command.py --route ROUTE\n")
        sys.stderr.write("ROUTE must be one of the three fixed runtime/OPS routes.\n")
        return 2
    script = Path(__file__).resolve()
    root = script.parents[2]
    try:
        return run_route(route, root)
    except Exception:
        sys.stderr.write("OPS-CI1 owner encountered an internal failure.\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
