"""Characterize the unchanged containment prefix with a harmless, bounded command."""

import os
import re
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Final, Literal

from integration_evals.artifacts import digest, read_bytes, reject_leaks
from integration_evals.contracts import runtime_digest
from integration_evals.errors import InvalidArtifactError
from integration_evals.models import Digest, Record, Revision
from integration_evals.processes import ProcessSettings, contained_command, terminate_group
from integration_evals.validation import git_value

STDERR_LIMIT: Final = 65536
SAFE_STDERR: Final = frozenset(
    {
        "bwrap: Creating new namespace failed: Operation not permitted",
        "bwrap: Creating new namespace failed: Permission denied",
        "bwrap: setting up uid map: Permission denied",
        "bwrap: setting up gid map: Permission denied",
        "bwrap: Failed to make / slave: Permission denied",
        "bwrap: Failed to make / slave: Operation not permitted",
    }
)
NAMESPACE_DENIAL_PREFIXES: Final = (
    "bwrap: No permissions to creating new namespace,",
    "bwrap: Creating new namespace failed,",
)
STATUS_FIELDS: Final = frozenset(
    {
        "Uid",
        "Gid",
        "NSpid",
        "CapInh",
        "CapPrm",
        "CapEff",
        "CapBnd",
        "CapAmb",
        "NoNewPrivs",
        "Seccomp",
        "Seccomp_filters",
    }
)


class StderrObservation(Record):
    """Closed-list messages and bounded byte identity; unknown content stays private."""

    safe_lines: tuple[str, ...]
    unknown_lines: bool
    truncated: bool
    captured_sha256: Digest


def stderr_observation(data: bytes) -> StderrObservation:
    """Expose only exact fixed bwrap messages; never include paths or arbitrary text."""
    captured = data[: STDERR_LIMIT + 1]
    lines = captured[:STDERR_LIMIT].decode("utf-8", errors="replace").splitlines()
    safe_lines = [line for line in lines if line in SAFE_STDERR]
    safe_lines.extend(
        prefix
        for prefix in NAMESPACE_DENIAL_PREFIXES
        if any(line.startswith(prefix) for line in lines)
    )
    return StderrObservation(
        safe_lines=tuple(safe_lines),
        unknown_lines=any(line not in SAFE_STDERR for line in lines),
        truncated=len(data) > STDERR_LIMIT,
        captured_sha256=digest(captured),
    )


class ContainmentProbe(Record):
    """Diagnostic facts only; this record cannot satisfy any owner case."""

    kind: Literal["containment-characterization"] = "containment-characterization"
    platform: str
    integration_revision: Revision
    integration_tree: Revision
    producer_revision: Revision
    uid: int
    gid: int
    kernel: str
    outer_security: dict[str, str | None]
    command: tuple[str, ...]
    source_hashes: dict[str, Digest]
    binary_sha256: Digest | None
    outcome: Literal["completed", "timeout", "spawn-error", "containment-unavailable"]
    exit_code: int | None
    stderr: StderrObservation
    product_acceptance: Literal["blocked"] = "blocked"


def security_facts() -> dict[str, str | None]:
    """Read only fixed numeric/kernel security facts from the outer process."""
    facts: dict[str, str | None] = {}
    if sys.platform != "linux":
        return facts
    with Path("/proc/self/status").open(encoding="utf-8") as source:
        status = source.read(STDERR_LIMIT)
    for line in status.splitlines():
        name, _, value = line.partition(":")
        if name in STATUS_FIELDS and re.fullmatch(r"[0-9a-fA-F\s]+", value):
            facts[name] = value.strip()
    for name in ("user", "pid", "mnt", "net", "ipc"):
        value = str(Path(f"/proc/self/ns/{name}").readlink())
        facts[f"namespace_{name}"] = value if re.fullmatch(r"[a-z]+:\[\d+\]", value) else None
    for name in (
        "kernel/unprivileged_userns_clone",
        "kernel/apparmor_restrict_unprivileged_userns",
        "user/max_user_namespaces",
    ):
        try:
            value = Path(f"/proc/sys/{name}").read_text(encoding="utf-8").strip()
        except (FileNotFoundError, PermissionError):
            value = ""
        facts[name] = value if value.isdecimal() else None
    try:
        label = Path("/proc/self/attr/current").read_text(encoding="utf-8").strip()
    except (FileNotFoundError, PermissionError):
        label = ""
    facts["apparmor"] = label if label == "docker-default (enforce)" else None
    return facts


def probe(checkout: Path, destination: Path) -> ContainmentProbe:
    """Reap only the probe's owned session; never invoke or interpret an owner response."""
    repository = Path(__file__).resolve().parents[1]
    sources = ("src/integration_evals/processes.py", "component_tests/print_containment.py")
    hashes = {name: digest(read_bytes(repository / name)) for name in sources}
    stderr = b""
    outcome: Literal["completed", "timeout", "spawn-error", "containment-unavailable"] = "completed"
    exit_code: int | None = None
    command: tuple[str, ...] = ()
    binary: str | None = None
    with TemporaryDirectory(prefix="print-containment-") as temporary:
        home = Path(temporary).resolve()
        settings = ProcessSettings(
            checkout=checkout,
            environment={"PATH": os.environ["PATH"], "HOME": str(home), "TMPDIR": str(home)},
            payload=b"",
            stdout=subprocess.DEVNULL,
            timeout=5,
            offline=True,
            writable_directory=home,
        )
        try:
            actual = contained_command(("/bin/true",), settings)
            command = (
                Path(actual[0]).name,
                *(argument.replace(str(home), "<isolated>") for argument in actual[1:]),
            )
            binary = runtime_digest(Path(actual[0]))
            with subprocess.Popen[bytes](
                actual,
                cwd=settings.checkout,
                env=settings.environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                start_new_session=True,
            ) as process:
                try:
                    exit_code = process.wait(timeout=settings.timeout)
                except subprocess.TimeoutExpired:
                    outcome = "timeout"
                finally:
                    terminate_group(process)
                    exit_code = process.wait(timeout=5)
                if process.stderr is not None:
                    stderr = os.read(process.stderr.fileno(), STDERR_LIMIT + 1)
        except InvalidArtifactError:
            outcome = "containment-unavailable"
        except OSError:
            outcome = "spawn-error"
    receipt = ContainmentProbe(
        platform=sys.platform,
        integration_revision=git_value(repository, "rev-parse", "HEAD"),
        integration_tree=git_value(repository, "rev-parse", "HEAD^{tree}"),
        producer_revision=git_value(checkout, "rev-parse", "HEAD"),
        uid=os.getuid(),
        gid=os.getgid(),
        kernel=os.uname().release,
        outer_security=security_facts(),
        command=command,
        source_hashes=hashes,
        binary_sha256=binary,
        outcome=outcome,
        exit_code=exit_code,
        stderr=stderr_observation(stderr),
    )
    data = receipt.model_dump_json(indent=2).encode()
    reject_leaks(data, "print-containment-diagnostic")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("xb") as output:
        _ = output.write(data)
    return receipt
