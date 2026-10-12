import json
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
    Run,
)
from integration_evals.output_evidence import check_claim, retain
from integration_evals.packaging import copy_artifacts
from tests.leak_matrix import BENIGN, CASES


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


def payload_id(payload: bytes) -> str:
    return f"{len(payload)}b-{digest(payload)[:8]}"


HUGE = "1" * 5000
ESCAPED_KEY = '{"\\u0061pi_key":"fictional-long-credential-123","n":'
RESOURCE_PAYLOADS = (
    (ESCAPED_KEY + HUGE + "}").encode(),
    json.dumps({"body": ESCAPED_KEY + HUGE + "}"}).encode(),
    json.dumps({"body": '{"n":' + HUGE + "}"}).encode(),
    b"[" * 256 + b"]" * 256,
    b"[" * 512 + b"]" * 512,
    json.dumps({"body": "[" * 256 + "]" * 256}).encode(),
    b'{"a":{"api_key":"fictional-long-credential-123"},"a":{}}',
    b'{"a":{"\\u0061pi_key":"fictional-long-credential-123"},"a":{"api_key":""}}',
)


LEAKY_JSON = (
    *RESOURCE_PAYLOADS,
    b'{"api_key": "fictional-key-value-1234"}',
    b'{"password": "fictional-password-1234"}',
    b'{"Authorization": "Bearer fictional-token-1234"}',
    b'{"nested": {"headers": {"authorization": "fictional-value-1234"}}}',
    b'{"body": "{\\"api_key\\": \\"fictional-key-value-1234\\"}"}',
    b'{"\\u0061pi_key": "fictional-key-value-1234"}',
    b"Authorization: Bearer fictionaltoken1234",
    b'{"\\u0061pi_key":"fictional-long-credential-123","api_key":""}',
    b'{"body": "{\\"\\\\u0061pi_key\\":\\"fictional-long-credential-123\\",\\"api_key\\":\\"\\"}"}',
)


@pytest.mark.parametrize("payload", LEAKY_JSON, ids=payload_id)
def test_retain_rejects_quoted_or_bearer_credentials_without_echo(
    tmp_path: Path, payload: bytes
) -> None:
    # Given staged output with a JSON or header credential and a matching digest.
    case = controlled_case()
    context = context_for(tmp_path, Mode.MOCK)
    staging = tmp_path / "staging"
    staging.mkdir()
    _ = (staging / "output.json").write_bytes(payload)
    item = artifact(case, context).model_copy(update={"sha256": digest(payload)})
    # When retaining it.
    with pytest.raises(InvalidArtifactError, match="sensitive_content") as caught:
        _ = retain(case, context, (item,), staging)
    # Then it is rejected, nothing is retained, and the value is not in the diagnostic.
    assert b"fictional" not in str(caught.value).encode()
    assert not (context.settings.artifacts / context.run_id / case.id / "output.json").exists()


@pytest.mark.parametrize("payload", LEAKY_JSON, ids=payload_id)
def test_archive_copy_rejects_quoted_or_bearer_credentials_without_echo(
    tmp_path: Path, payload: bytes
) -> None:
    # Given archived output with a credential and a matching digest.
    case = controlled_case()
    context = context_for(tmp_path, Mode.MOCK)
    source = tmp_path / "source"
    source.mkdir()
    _ = (source / "output.json").write_bytes(payload)
    item = artifact(case, context).model_copy(update={"sha256": digest(payload)})
    run = Run.model_construct(evidence=(item,))
    destination = tmp_path / "archive"
    destination.mkdir()
    # When copying it into a public archive.
    with pytest.raises(InvalidArtifactError, match="sensitive_content") as caught:
        copy_artifacts(run, source, destination)
    # Then no bytes are published and the diagnostic omits the value.
    assert b"fictional" not in str(caught.value).encode()
    assert not (destination / "output.json").exists()


@pytest.mark.parametrize(
    ("payload", "code"), [case[1:] for case in CASES], ids=[c[0] for c in CASES]
)
def test_export_paths_reject_decoded_json_policy_classes(
    tmp_path: Path, payload: bytes, code: str
) -> None:
    # Given matching-digest output hiding a policy class in escaped JSON keys or values.
    case = controlled_case()
    context = context_for(tmp_path, Mode.MOCK)
    staging = tmp_path / "staging"
    staging.mkdir()
    _ = (staging / "output.json").write_bytes(payload)
    item = artifact(case, context).model_copy(update={"sha256": digest(payload)})
    # When retaining and archiving it.
    with pytest.raises(InvalidArtifactError) as retained:
        _ = retain(case, context, (item,), staging)
    destination = tmp_path / "archive"
    destination.mkdir()
    with pytest.raises(InvalidArtifactError) as copied:
        copy_artifacts(Run.model_construct(evidence=(item,)), staging, destination)
    # Then both fail with the class code, publish nothing, and keep the value out.
    assert retained.value.code == copied.value.code == code
    assert str(copied.value) == f"{code}: evaluation"
    assert not (destination / "output.json").exists()
    assert not (context.settings.artifacts / context.run_id / case.id / "output.json").exists()


@pytest.mark.parametrize("payload", BENIGN, ids=payload_id)
def test_export_paths_keep_benign_escaped_json(tmp_path: Path, payload: bytes) -> None:
    # Given ordinary escaped and embedded JSON.
    case = controlled_case()
    context = context_for(tmp_path, Mode.MOCK)
    staging = tmp_path / "staging"
    staging.mkdir()
    _ = (staging / "output.json").write_bytes(payload)
    item = artifact(case, context).model_copy(update={"sha256": digest(payload)})
    destination = tmp_path / "archive"
    destination.mkdir()
    # When retaining and archiving it.
    kept = retain(case, context, (item,), staging)
    copy_artifacts(Run.model_construct(evidence=(item,)), staging, destination)
    # Then both preserve the exact bytes.
    assert (context.settings.artifacts / kept[0].path).read_bytes() == payload
    assert (destination / "output.json").read_bytes() == payload
