import shutil
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from integration_evals.artifacts import digest, load_record
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import OwnerContext, Settings
from integration_evals.models import Case, Catalog, Component, Mode
from integration_evals.process_inputs import copy_tracked_inputs
from integration_evals.process_network import OfflineNetwork
from integration_evals.retrieval_inputs import (
    MODULES,
    PROFILE_PATH,
    RetrievalInputRecord,
    RetrievalProfile,
    prepare_owner_inputs,
)
from integration_evals.validation import git_value
from tests.test_assembly import synthetic_workspace
from tests.test_evidence_claims import controlled_case


def commit_fixture(root: Path) -> None:
    _ = git_value(root, "add", ".")
    _ = git_value(
        root,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@evals.example",
        "commit",
        "-m",
        "pin retrieval input fixture",
    )


@pytest.fixture
def retrieval_inputs(tmp_path: Path) -> tuple[Case, OwnerContext, Component]:
    assembly = synthetic_workspace(tmp_path)
    repository = tmp_path / "integration-evals"
    original = Path(__file__).resolve().parents[1]
    for name in (
        *[f"src/integration_evals/{name}" for name in MODULES],
        "fixtures/catalog.json",
        "fixtures/data/source-negative.txt",
    ):
        target = repository / name
        target.parent.mkdir(parents=True, exist_ok=True)
        _ = shutil.copyfile(original / name, target)
    producer = tmp_path / "event-intelligence"
    _ = (producer / "owned-source.mjs").write_text("export const fixture=true;")
    commit_fixture(producer)
    revision = git_value(producer, "rev-parse", "HEAD")
    profile = load_record(original / PROFILE_PATH, RetrievalProfile).model_copy(
        update={"producer_revision": revision}
    )
    _ = (repository / PROFILE_PATH).write_text(profile.model_dump_json())
    commit_fixture(repository)
    runtime = tmp_path / "node"
    _ = runtime.write_bytes(b"synthetic runtime identity bytes; never executed")
    command = (
        str(runtime),
        str(repository / "src/integration_evals/retrieval_adapter.mjs"),
        "--runtime-sha256",
        digest(runtime.read_bytes()),
    )
    components = tuple(
        item.model_copy(
            update={
                "revision": git_value(tmp_path / item.repository, "rev-parse", "HEAD"),
                "tree": git_value(tmp_path / item.repository, "rev-parse", "HEAD^{tree}"),
                **(
                    {
                        "command": command,
                        "cleanup_command": (*command, "--cleanup"),
                        "supported_modes": (Mode.MOCK,),
                    }
                    if item.repository == "event-intelligence"
                    else {}
                ),
            }
        )
        for item in assembly.components
    )
    case = controlled_case().model_copy(
        update={
            "id": "ssrf-egress",
            "component": "event-intelligence",
            "fixtures": ("source-negative",),
        }
    )
    catalog = load_record(repository / "fixtures/catalog.json", Catalog)
    assembly = assembly.model_copy(
        update={
            "kind": "component",
            "owner": "integration-evals",
            "selected_cases": (case.id,),
            "components": components,
            "integration_revision": git_value(repository, "rev-parse", "HEAD"),
            "fixture_digest": digest(catalog.model_dump_json().encode()),
            "configuration_artifact_path": PROFILE_PATH,
            "configuration_digest": digest((repository / PROFILE_PATH).read_bytes()),
        }
    )
    return (
        case,
        OwnerContext(
            assembly,
            Settings(repository, tmp_path, None),
            "run-staging",
            datetime(2026, 10, 10, tzinfo=UTC),
        ),
        next(item for item in components if item.repository == case.component),
    )


def test_verified_retrieval_inputs_preserve_bytes_and_original_pins(
    tmp_path: Path, retrieval_inputs: tuple[Case, OwnerContext, Component]
) -> None:
    # Given pinned sources and an ignored harmless file that is not part of the input closure.
    case, context, component = retrieval_inputs
    producer = tmp_path / component.repository
    _ = (producer / ".git/info/exclude").write_text("ignored-sentinel\n")
    _ = (producer / "ignored-sentinel").write_text("not-authorized")
    staged = tmp_path / "staged"
    staged.mkdir()
    # When the trusted evaluator stages its exact fixture closure.
    inputs = prepare_owner_inputs(case, context, component, staged)
    record = load_record(
        context.settings.artifacts / "input-staging/run-staging/ssrf-egress.json",
        RetrievalInputRecord,
    )
    # Then copied hashes and original pins remain exact; only this fixture gets private IP.
    assert inputs.network is OfflineNetwork.RETRIEVAL
    assert inputs.checkout == staged
    assert Path(inputs.command[0]).is_relative_to(staged)
    assert Path(inputs.command[1]).is_relative_to(staged)
    assert inputs.cleanup_command == (*inputs.command, "--cleanup")
    assert (
        inputs.configuration.read_bytes()
        == (context.settings.repository / PROFILE_PATH).read_bytes()
    )
    assert all(digest((staged / item.path).read_bytes()) == item.sha256 for item in record.files)
    assert record.producer_revision == component.revision
    assert record.evaluator_revision == context.assembly.integration_revision
    assert record.runtime_sha256 == component.command[3]
    assert not (staged / ".git").exists()
    assert not (staged / "ignored-sentinel").exists()
    assert git_value(producer, "rev-parse", "HEAD") == component.revision
    assert git_value(producer, "status", "--porcelain", "--untracked-files=all") == ""


@pytest.mark.parametrize("fault", ["mode", "cleanup", "runtime", "adapter"])
def test_retrieval_capability_rejects_unverified_identity(
    tmp_path: Path, retrieval_inputs: tuple[Case, OwnerContext, Component], fault: str
) -> None:
    # Given a correctly identified adapter with one untrusted authority input.
    case, context, component = retrieval_inputs
    if fault == "mode":
        context = replace(context, settings=replace(context.settings, mode=Mode.RECORDED))
    if fault == "cleanup":
        component = component.model_copy(
            update={"cleanup_command": (*component.command, "--different")}
        )
    if fault == "runtime":
        _ = Path(component.command[0]).write_bytes(b"runtime substitution")
    if fault == "adapter":
        adapter = Path(component.command[1])
        _ = adapter.write_text("throw new Error('substituted');")
        commit_fixture(context.settings.repository)
        updated = tuple(
            item.model_copy(
                update={
                    "revision": git_value(context.settings.repository, "rev-parse", "HEAD"),
                    "tree": git_value(context.settings.repository, "rev-parse", "HEAD^{tree}"),
                }
            )
            if item.repository == "integration-evals"
            else item
            for item in context.assembly.components
        )
        context = replace(
            context,
            assembly=context.assembly.model_copy(
                update={
                    "components": updated,
                    "integration_revision": git_value(
                        context.settings.repository, "rev-parse", "HEAD"
                    ),
                }
            ),
        )
    staged = tmp_path / "staged"
    staged.mkdir()
    # When private fixture authority is requested.
    with pytest.raises(
        InvalidArtifactError,
        match=r"retrieval_fixture_identity_rejected|input_snapshot_source_changed",
    ):
        _ = prepare_owner_inputs(case, context, component, staged)
    # Then no provenance receipt or authorized invocation is returned.
    assert not (context.settings.artifacts / "input-staging/run-staging/ssrf-egress.json").exists()


def test_unrecognized_owner_keeps_default_network_policy(
    tmp_path: Path,
    retrieval_inputs: tuple[Case, OwnerContext, Component],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given a basename lookalike and an ambient attempt to enable private networking.
    case, context, component = retrieval_inputs
    command = (component.command[0], str(tmp_path / "retrieval_adapter.mjs"))
    component = component.model_copy(update={"command": command})
    monkeypatch.setenv("IE_NETWORK", "retrieval-private-ip")
    # When a generic owner is prepared.
    inputs = prepare_owner_inputs(case, context, component, tmp_path / "unused")
    # Then neither the basename nor environment selects fixture authority.
    assert inputs.command == command
    assert inputs.network is OfflineNetwork.DENY


@pytest.mark.parametrize(
    ("fault", "error"),
    [("untracked", "input_snapshot_source_dirty"), ("symlink", "offline_path_alias_rejected")],
)
def test_input_snapshot_rejects_unreviewed_file_or_link(
    tmp_path: Path, fault: str, error: str
) -> None:
    # Given an owned Git source with either an unreviewed file or a committed escaping link.
    source, target = tmp_path / "source", tmp_path / "snapshot"
    source.mkdir()
    target.mkdir()
    _ = git_value(source, "init")
    _ = (source / "owned").write_text("owned")
    commit_fixture(source)
    outside = tmp_path / "outside"
    _ = outside.write_text("harmless-outside-input")
    if fault == "symlink":
        (source / "extra").symlink_to(outside)
        commit_fixture(source)
    else:
        _ = (source / "extra").write_text("unreviewed")
    # When a finite tracked snapshot is requested.
    with pytest.raises(InvalidArtifactError, match=error):
        _ = copy_tracked_inputs(source, target, "fixture")
    # Then no outside or unreviewed bytes become readable child input.
    assert not (target / "extra").exists()
    assert outside.read_text() == "harmless-outside-input"
