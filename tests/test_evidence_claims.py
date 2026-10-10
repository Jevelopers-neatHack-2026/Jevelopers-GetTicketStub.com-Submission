from datetime import UTC, datetime
from pathlib import Path

import pytest

from integration_evals.artifacts import digest
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import OwnerContext, Settings
from integration_evals.models import (
    Assembly,
    Assertion,
    Case,
    CaseId,
    Component,
    Evidence,
    Mode,
    Origin,
    RequirementId,
)
from integration_evals.output_evidence import check_claim, retain


def controlled_case() -> Case:
    return Case(
        id=CaseId("controlled"),
        requirements=(RequirementId("IE-01.AC5"),),
        fixtures=(),
        component="agent-harness",
        interface="mock-protocol",
        invariant="exact retained output",
        assertions=(Assertion(observation="result", expected="controlled"),),
        artifacts=("evaluation",),
        modes=(Mode.MOCK, Mode.LIVE),
    )


def context_for(root: Path, mode: Mode) -> OwnerContext:
    component = Component(
        repository="agent-harness",
        revision="a" * 40,
        tree="b" * 40,
        lockfile_path="lock",
        lockfile_digest=digest(b"lock"),
    )
    assembly = Assembly(
        owner="getticketstub.com",
        integration_revision="c" * 40,
        components=(component,),
        contract_digest=digest(b"schema"),
        fixture_digest=digest(b"fixtures"),
        runtime="unit fixture",
        configuration_digest=digest(b"config"),
    )
    return OwnerContext(
        assembly,
        Settings(root, root, None, mode),
        "run-controlled",
        datetime(2026, 10, 10, tzinfo=UTC),
    )


def artifact(case: Case, context: OwnerContext) -> Evidence:
    return Evidence(
        id="evaluation",
        requirement=case.requirements[0],
        case_id=case.id,
        run_id=context.run_id,
        component="agent-harness",
        revision="a" * 40,
        created_at=context.clock,
        original_cutoff=context.clock,
        mode=context.settings.mode,
        origin=Origin.SYNTHETIC,
        path="output.json",
        sha256=digest(b'{"result":"controlled"}'),
        permission_ref="synthetic input",
        redaction_ref="no private data",
        reviewer_access_ref="local fixture",
        kind="evaluation",
    )


def test_evidence_rejects_when_case_identity_differs(tmp_path: Path) -> None:
    # Given valid bytes claimed for a different execution case.
    case = controlled_case()
    context = context_for(tmp_path, Mode.MOCK)
    wrong = artifact(case, context).model_copy(update={"case_id": CaseId("unrelated")})
    # When binding the owner response to this case.
    with pytest.raises(InvalidArtifactError, match="cross_case_output_claim"):
        check_claim(case, context, (wrong,), Origin.SYNTHETIC)
    # Then an unrelated artifact cannot support a passing result.


def test_evidence_rejects_when_synthetic_artifact_claims_live_output(tmp_path: Path) -> None:
    # Given a synthetic artifact with an attempted live-result label.
    case = controlled_case()
    context = context_for(tmp_path, Mode.LIVE)
    # When checking the required real-output evidence.
    with pytest.raises(InvalidArtifactError, match="required_real_output_missing"):
        check_claim(case, context, (artifact(case, context),), Origin.LIVE)
    # Then source labels cannot manufacture a genuine provider result.


def test_evidence_retains_when_temporary_staging_is_removed(tmp_path: Path) -> None:
    # Given fresh owner output in a disposable staging directory.
    case = controlled_case()
    context = context_for(tmp_path, Mode.MOCK)
    staging = tmp_path / "staging"
    staging.mkdir()
    _ = (staging / "output.json").write_bytes(b'{"result":"controlled"}')
    # When retaining approved immutable output before cleanup.
    kept = retain(case, context, (artifact(case, context),), staging)
    # Then the durable copy survives staging deletion with its original bytes/hash.
    (staging / "output.json").unlink()
    staging.rmdir()
    assert (context.settings.artifacts / kept[0].path).read_bytes() == b'{"result":"controlled"}'
