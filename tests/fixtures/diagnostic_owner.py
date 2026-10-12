#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["pydantic>=2.12,<3"]
# ///
# How to run: uv run tests/fixtures/diagnostic_owner.py < controlled-request.json
"""Emit one inert boolean observation for the real evaluation capture boundary."""

import sys
from datetime import datetime
from pathlib import Path

from integration_evals.models import Case, Evidence, Mode, Origin, Provider, Record, Revision
from integration_evals.reporting import OwnerResponse


class Request(Record):
    """Fixed inert owner-protocol request; never creates product authority."""

    case: Case
    run_id: str
    component_revision: Revision
    artifact_directory: Path
    configuration_artifact: str
    namespace: str
    seed: int
    clock: datetime
    providers: tuple[Provider, ...]


request = Request.model_validate_json(sys.stdin.buffer.read())
output = request.artifact_directory / "output.txt"
_ = output.write_bytes(b"controlled output")
if request.case.fault == "missing-artifact":
    output.unlink()
observed = (
    bool((request.seed + int(request.run_id[-1], 16)) % 2)
    if request.case.fault == "seeded-alternation"
    else True
)
response = OwnerResponse(
    component_revision=request.component_revision,
    mode=Mode.MOCK,
    origin=Origin.SYNTHETIC,
    observations={
        "result": "private-person@example.test"
        if request.case.fault == "private-observation"
        else observed
    },
    evidence=(
        Evidence(
            id="output",
            requirement=request.case.requirements[0],
            case_id=request.case.id,
            run_id=request.run_id,
            component="agent-harness",
            revision=request.component_revision,
            created_at=request.clock,
            original_cutoff=request.clock,
            mode=Mode.MOCK,
            origin=Origin.SYNTHETIC,
            path=Path("output.txt").as_posix(),
            sha256="b5ca7425a297ffc711fc19c0a3caba370abe7c68f0c2c6ab5a7eafe104f6c29c",
            permission_ref="synthetic",
            redaction_ref="no private data",
            reviewer_access_ref="fixture",
            kind="evaluation",
        ),
    ),
)
_ = sys.stdout.write(response.model_dump_json())
