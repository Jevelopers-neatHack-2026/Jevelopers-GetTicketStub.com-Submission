#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["pydantic>=2.12,<3"]
# ///
# -- How to run --
# Install uv from its official documentation, then run from this repository:
# uv run python tests/fixtures/owner_output.py < approved-fixture-request.json
# The integration test supplies the request and active project interpreter automatically.
"""Emit a fresh synthetic artifact without implementing any product behavior."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import Literal, assert_never

from pydantic import TypeAdapter

from integration_evals.artifacts import digest
from integration_evals.models import Case, Evidence, Mode, Origin, Provider, Record, Revision
from integration_evals.reporting import OwnerResponse


class Request(Record):
    """The fixed evaluator request protocol used by this inert boundary fixture."""

    case: Case
    run_id: str
    component_revision: Revision
    artifact_directory: Path
    configuration_artifact: str
    namespace: str
    seed: int
    clock: datetime
    providers: tuple[Provider, ...]


def main() -> None:
    """Write controlled output and exact metadata to exercise retention and isolation."""
    request = Request.model_validate_json(sys.stdin.buffer.read())
    data = b"controlled output"
    fault = TypeAdapter(Literal["wrong-digest", "missing-artifact"] | None).validate_python(
        request.case.fault
    )
    match fault:
        case None:
            _ = (request.artifact_directory / "output.txt").write_bytes(data)
        case "wrong-digest":
            _ = (request.artifact_directory / "output.txt").write_bytes(b"different output")
        case "missing-artifact":
            pass
        case _:
            assert_never(fault)
    artifact = Evidence(
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
        path="output.txt",
        sha256=digest(data),
        permission_ref="synthetic",
        redaction_ref="no private data",
        reviewer_access_ref="fixture",
        kind="evaluation",
    )
    response = OwnerResponse(
        component_revision=request.component_revision,
        mode=Mode.MOCK,
        origin=Origin.SYNTHETIC,
        observations={"result": "controlled"},
        evidence=(artifact,),
    )
    _ = sys.stdout.write(response.model_dump_json())


if __name__ == "__main__":
    main()
