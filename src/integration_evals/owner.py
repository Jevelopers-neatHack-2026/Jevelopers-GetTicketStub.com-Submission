"""Invoke reviewed owner runners under isolation and always attempt bounded cleanup."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from typing import Literal

from pydantic import ValidationError

from integration_evals.artifacts import digest, read_bytes
from integration_evals.errors import InvalidArtifactError, fail
from integration_evals.execution import OwnerContext, OwnerExecution, blocked
from integration_evals.models import Case, CaseResult, Mode, Origin, Outcome, Status
from integration_evals.output_evidence import check_claim, retain
from integration_evals.processes import ProcessSettings, invoke
from integration_evals.reporting import OwnerResponse


def isolated_command(command: tuple[str, ...], isolated: str, mode: Mode) -> tuple[str, ...] | None:
    """Require operating-system network denial for offline owner execution."""
    if mode in {Mode.SANDBOX, Mode.LIVE}:
        return command
    canonical_isolated = str(Path(isolated).resolve())
    if sys.platform == "darwin":
        sandbox = shutil.which("sandbox-exec")
        if sandbox:
            profile = "\n".join(
                (
                    "(version 1)",
                    "(allow default)",
                    "(deny network*)",
                    "(deny file-write*)",
                    f'(allow file-write* (subpath "{canonical_isolated}"))',
                )
            )
            return (sandbox, "-p", profile, *command)
    else:
        bubblewrap = shutil.which("bwrap")
        if bubblewrap:
            return (
                bubblewrap,
                "--unshare-net",
                "--unshare-pid",
                "--die-with-parent",
                "--ro-bind",
                "/",
                "/",
                "--bind",
                canonical_isolated,
                isolated,
                "--dev",
                "/dev",
                "--proc",
                "/proc",
                "--",
                *command,
            )
    return None


def compare_response(
    case: Case, response: OwnerResponse, context: OwnerContext
) -> tuple[Outcome, str | None]:
    """Compare independent frozen observations after enforcing response identity."""
    component = next(c for c in context.assembly.components if c.repository == case.component)
    if response.component_revision != component.revision or response.mode != context.settings.mode:
        fail("owner_response_pin_or_mode_mismatch", case.id)
    mismatches = [
        assertion.observation
        for assertion in case.assertions
        if assertion.observation not in response.observations
        or type(response.observations[assertion.observation]) is not type(assertion.expected)
        or response.observations[assertion.observation] != assertion.expected
    ]
    if not response.evidence:
        return Outcome.ERROR, "owner-produced artifact evidence missing"
    check_claim(case, context, response.evidence, response.origin)
    return (
        (Outcome.FAILED, "observation mismatch: " + ", ".join(mismatches))
        if mismatches
        else (Outcome.PASSED, None)
    )


def execute_owner(case: Case, context: OwnerContext) -> OwnerExecution:
    """Invoke reviewed owner commands without inheriting unrelated credentials."""
    settings = context.settings
    component = next(
        (c for c in context.assembly.components if c.repository == case.component), None
    )
    if component is None or not component.command or not component.cleanup_command:
        return OwnerExecution(
            blocked(
                case, settings.mode, case.component, "owner runner/fault hooks/cleanup unavailable"
            )
        )
    started = monotonic()
    response: OwnerResponse | None = None
    reason: str | None = None
    outcome = Outcome.ERROR
    exit_code: int | None = None
    cleanup_status: Literal["not-run", "passed", "failed", "unknown"] = "not-run"
    output_digest: str | None = None
    with TemporaryDirectory(prefix=f"integration-evals-{context.run_id}-") as isolated:
        command = isolated_command(component.command, isolated, settings.mode)
        cleanup_command = isolated_command(component.cleanup_command, isolated, settings.mode)
        if command is None or cleanup_command is None:
            return OwnerExecution(
                blocked(
                    case,
                    settings.mode,
                    case.component,
                    "offline kernel network isolation unavailable",
                )
            )
        environment = {
            **{key: os.environ[key] for key in ("PATH", "SYSTEMROOT") if key in os.environ},
            "HOME": isolated,
            "TMPDIR": isolated,
            "IE_NAMESPACE": f"{context.run_id}-{case.id}",
            "IE_MODE": settings.mode.value,
            "IE_SEED": str(settings.seed),
            "IE_CLOCK": context.clock.isoformat(),
        }
        if settings.mode in {Mode.SANDBOX, Mode.LIVE}:
            environment.update(
                {
                    p.credential_env: os.environ[p.credential_env]
                    for p in context.assembly.providers
                    if p.id in case.provider_ids
                    and p.credential_env
                    and p.mode in {Mode.SANDBOX, Mode.LIVE}
                    and p.credential_env in os.environ
                }
            )
        staging = Path(isolated) / "artifacts"
        staging.mkdir()
        environment["IE_ARTIFACT_DIR"] = str(staging)
        request = json.dumps(
            {
                "case": case.model_dump(mode="json"),
                "run_id": context.run_id,
                "component_revision": component.revision,
                "configuration_artifact": str(
                    settings.workspace
                    / context.assembly.configuration_component
                    / (context.assembly.configuration_artifact_path or "")
                ),
                "artifact_directory": str(staging),
                "namespace": environment["IE_NAMESPACE"],
                "seed": settings.seed,
                "clock": context.clock.isoformat(),
                "providers": [p.model_dump(mode="json") for p in context.assembly.providers],
            }
        )
        try:
            with (Path(isolated) / "stdout").open("w+b") as stdout:
                exit_code = invoke(
                    command,
                    ProcessSettings(
                        checkout=settings.workspace / component.repository,
                        environment=environment,
                        payload=request.encode(),
                        stdout=stdout,
                        timeout=case.timeout_seconds,
                    ),
                )
            output = read_bytes(Path(isolated) / "stdout")
            output_digest = digest(output)
            if exit_code == 0:
                response = OwnerResponse.model_validate_json(output)
                outcome, reason = compare_response(case, response, context)
                response = response.model_copy(
                    update={"evidence": retain(case, context, response.evidence, staging)}
                )
            else:
                reason = f"owner runner exit {exit_code}; private output withheld"
        except subprocess.TimeoutExpired:
            reason = "owner runner timeout; dispatch state remains unknown"
        except (ValidationError, InvalidArtifactError, OSError):
            reason = "invalid owner response or runtime failure; private payload withheld"
            response = None
        finally:
            try:
                cleanup = invoke(
                    cleanup_command,
                    ProcessSettings(
                        checkout=settings.workspace / component.repository,
                        environment=environment,
                        payload=request.encode(),
                        stdout=subprocess.DEVNULL,
                        timeout=min(case.timeout_seconds, 30),
                    ),
                )
                if cleanup != 0:
                    outcome, reason = Outcome.ERROR, "owner cleanup failed"
                cleanup_status = "passed" if cleanup == 0 else "failed"
            except (subprocess.TimeoutExpired, OSError):
                outcome, reason = Outcome.ERROR, "owner cleanup timeout/runtime failure"
                cleanup_status = "unknown"
    result = CaseResult(
        case_id=case.id,
        requirements=case.requirements,
        outcome=outcome,
        criterion_status=Status.IN_PROGRESS,
        mode=settings.mode,
        origin=response.origin if response else Origin.SYNTHETIC,
        duration_seconds=monotonic() - started,
        reason=reason,
        cost=response.cost if response else None,
        cost_status=response.cost_status if response else "unknown",
        evidence_ids=tuple(item.id for item in response.evidence) if response else (),
        blocker_owner=case.component if outcome is not Outcome.PASSED else None,
        exit_code=exit_code,
        cleanup_status=cleanup_status,
        output_digest=output_digest,
    )
    return OwnerExecution(result, response.evidence if response else ())
