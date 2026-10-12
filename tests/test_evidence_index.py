"""IE-09A/IE-08 evidence joins and IE-07 qualifiers preserve honest source scopes."""

import base64
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from typer.testing import CliRunner

from integration_evals import evidence_index as evidence_index_module
from integration_evals.artifacts import digest, load_record, read_bytes
from integration_evals.cli import app
from integration_evals.diagnostics import replay_comparisons
from integration_evals.errors import InvalidArtifactError
from integration_evals.evidence_index import (
    EvidenceIndex,
    EvidenceReview,
    ImageQualification,
    IndexChecks,
    ReviewReference,
    Reviews,
    build_index,
)
from integration_evals.history import History
from integration_evals.history_archive import save_history
from integration_evals.models import Evidence, Mode, Origin, Outcome, Provider, Run, Status, Suite
from integration_evals.release import audit
from integration_evals.replay import link_rerun
from integration_evals.reporting import Tracker
from integration_evals.schema_exports import schemas
from integration_evals.specifications import Requirements
from tests.test_diagnostic_execution import controlled_execution
from tests.test_replay_history import later
from tests.test_replay_history import synthetic_failure as failure_fixture

synthetic_failure = failure_fixture
REPOSITORY = Path(__file__).resolve().parents[1]
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOe0AAAAASUVORK5CYII="
)


def reference(root: Path, label: str) -> ReviewReference:
    data = b"Synthetic permission/redaction/access review; no private source or provider use."
    _ = (root / "review.txt").write_bytes(data)
    return ReviewReference(reference=label, path="review.txt", sha256=digest(data))


def review(item: Evidence, root: Path) -> EvidenceReview:
    return EvidenceReview(
        run_id=item.run_id,
        evidence_id=item.id,
        artifact_digest=item.sha256,
        source_mode=item.mode,
        source_origin=item.origin,
        producing_revision=item.revision,
        original_created_at=item.created_at,
        original_cutoff=item.original_cutoff,
        reviewer="synthetic-reviewer",
        intended_reviewers=("synthetic-reviewer",),
        checked_at=item.created_at + timedelta(seconds=1),
        expires_at=item.created_at + timedelta(days=1),
        permission=reference(root, item.permission_ref),
        redaction=reference(root, item.redaction_ref),
        access=reference(root, item.reviewer_access_ref),
    )


def index(
    history: History, suite: Suite, root: Path, reviews: Reviews | None = None
) -> EvidenceIndex:
    return build_index(
        history,
        suite,
        load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker),
        load_record(REPOSITORY / "planning/requirements.json", Requirements),
        checks=IndexChecks(
            {run.id: root for run in history.runs},
            reviews or Reviews(),
            root,
            history.runs[-1].started_at + timedelta(seconds=2),
        ),
    )


def test_every_attempt_and_all_owned_requirements_reach_index(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path
) -> None:
    original, suite = synthetic_failure
    _ = (tmp_path / "result.json").write_bytes(b"synthetic observation")
    passing = link_rerun(original, later(original, Outcome.PASSED), suite, "diagnostic")
    history = History(runs=(original, passing))
    output = index(history, suite, tmp_path)
    row = next(r for r in output.requirements if r.requirement == "IE-09B.AC2")
    assert len(output.requirements) == 146
    assert sum(not row.excluded for row in output.requirements) == 142
    assert tuple(s.run_id for s in row.samples) == (original.id, passing.id)
    assert tuple(s.outcome for s in row.samples) == (Outcome.FAILED, Outcome.PASSED)
    assert tuple(s.evidence_scope for s in row.samples) == ("blocked", "mocked")
    assert all(s.manifest_digest == original.manifest_digest for s in row.samples)
    assert output.case_history[0].classification == "flaky"
    assert output.case_history[0].denominator == 2
    assert output.case_history[0].release_blocked
    assert row.canonical_status is Status.PLANNED
    assert output.artifacts[0].evidence.run_id == original.id
    assert "permission-redaction-reviewer-access-unreviewed" in row.blockers


@pytest.mark.parametrize("mutation", ["digest", "access", "expiry", "revision", "mode", "origin"])
def test_rejects_stale_or_relabelled_reviews(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path, mutation: str
) -> None:
    run, suite = synthetic_failure
    _ = (tmp_path / "result.json").write_bytes(b"synthetic observation")
    record = review(run.evidence[0], tmp_path)
    if mutation == "digest":
        record = record.model_copy(update={"artifact_digest": "a" * 64})
    elif mutation == "access":
        record = record.model_copy(
            update={"access": record.access.model_copy(update={"sha256": "a" * 64})}
        )
    elif mutation == "expiry":
        record = record.model_copy(update={"expires_at": run.started_at})
    elif mutation == "revision":
        record = record.model_copy(update={"producing_revision": "a" * 40})
    elif mutation == "mode":
        record = record.model_copy(update={"source_mode": Mode.LIVE})
    else:
        record = record.model_copy(update={"source_origin": Origin.LIVE})
    with pytest.raises(InvalidArtifactError, match=r"evidence_review|stale_evidence_review"):
        _ = index(History(runs=(run,)), suite, tmp_path, Reviews(evidence=(record,)))


def test_access_review_requires_readable_safe_bytes(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path
) -> None:
    run, suite = synthetic_failure
    _ = (tmp_path / "result.json").write_bytes(b"synthetic observation")
    record = review(run.evidence[0], tmp_path)
    (tmp_path / "review.txt").unlink()
    with pytest.raises(FileNotFoundError):
        _ = index(History(runs=(run,)), suite, tmp_path, Reviews(evidence=(record,)))
    payload = b"IE_PII_CANARY_REVIEW_SOURCE"
    _ = (tmp_path / "review.txt").write_bytes(payload)
    changed = record.model_copy(
        update={"permission": record.permission.model_copy(update={"sha256": digest(payload)})}
    )
    with pytest.raises(InvalidArtifactError, match="sensitive_content"):
        _ = index(History(runs=(run,)), suite, tmp_path, Reviews(evidence=(changed,)))


@pytest.mark.parametrize("mutation", ["orphan", "duplicate", "artifact"])
def test_no_orphan_review_or_unchecked_ancestor_artifact(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path, mutation: str
) -> None:
    original, suite = synthetic_failure
    _ = (tmp_path / "result.json").write_bytes(b"synthetic observation")
    record = review(original.evidence[0], tmp_path)
    if mutation == "orphan":
        record = record.model_copy(update={"run_id": "unrelated"})
    records = (record, record) if mutation == "duplicate" else (record,)
    if mutation == "artifact":
        _ = (tmp_path / "result.json").write_bytes(b"changed original bytes")
    with pytest.raises(InvalidArtifactError):
        _ = index(History(runs=(original,)), suite, tmp_path, Reviews(evidence=records))


def image_sample(sample: tuple[Run, Suite], root: Path) -> tuple[Run, Suite, Reviews]:
    original, suite = sample
    case = suite.cases[0].model_copy(
        update={
            "requirements": ("ART-01", "IE-07.AC2", "IE-07.AC5"),
            "component": "creative-engine",
            "required_evidence_kinds": ("image",),
        }
    )
    suite = Suite(cases=(case,))
    artifacts = tuple(
        original.evidence[0].model_copy(
            update={
                "id": operation,
                "path": f"{operation}.png",
                "kind": "image",
                "component": "creative-engine",
                "requirement": case.requirements[0],
                "sha256": digest(PNG),
            }
        )
        for operation in ("generate", "edit")
    )
    for item in artifacts:
        _ = (root / item.path).write_bytes(PNG)
    run = original.model_copy(
        update={
            "suite_digest": digest(suite.model_dump_json().encode()),
            "components": (
                original.components[0].model_copy(update={"repository": "creative-engine"}),
            ),
            "providers": (
                Provider(
                    id="gpt-image",
                    mode=Mode.MOCK,
                    model="synthetic-model",
                    endpoint="https://fixtures.example/image",
                ),
            ),
            "evidence": artifacts,
            "results": (
                original.results[0].model_copy(
                    update={
                        "requirements": case.requirements,
                        "outcome": Outcome.PASSED,
                        "evidence_ids": tuple(i.id for i in artifacts),
                    }
                ),
            ),
        }
    )
    images = tuple(
        ImageQualification(
            run_id=item.run_id,
            evidence_id=item.id,
            artifact_digest=item.sha256,
            operation=operation,
            model="synthetic-model",
            endpoint="https://fixtures.example/image",
            configuration_digest=run.configuration_digest,
            requested_at=item.created_at,
            design_version=f"version-{operation}",
            parent_design_version="version-generate" if operation == "edit" else None,
            input_digests=(digest(b"synthetic creative input"),),
            input_permission=reference(root, "synthetic-input-permission"),
            usage_status="unknown",
            receipt_unavailable_reason="Synthetic fixture has no provider receipt",
            width=1,
            height=1,
        )
        for item, operation in zip(artifacts, ("generate", "edit"), strict=True)
    )
    return run, suite, Reviews(evidence=tuple(review(i, root) for i in artifacts), images=images)


def test_qualified_mock_generation_edit_remains_only_mocked(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path
) -> None:
    run, suite, records = image_sample(synthetic_failure, tmp_path)
    output = index(History(runs=(run,)), suite, tmp_path, records)
    row = next(r for r in output.requirements if r.requirement == "IE-07.AC5")
    assert row.samples[0].evidence_scope == "mocked"
    assert row.canonical_status is Status.PLANNED
    assert row.blockers == ("producer-authenticity-and-permission-authority-unverified",)
    assert all(a.image is not None and a.image.usage is None for a in output.artifacts)
    # Keep a complete reproducible offline sample under pytest's chosen basetemp.
    reviewed_at = datetime.now(UTC)
    sample_records = records.model_copy(
        update={
            "evidence": tuple(
                r.model_copy(
                    update={
                        "checked_at": reviewed_at,
                        "expires_at": reviewed_at + timedelta(days=1),
                    }
                )
                for r in records.evidence
            )
        }
    )
    _ = (tmp_path / "reviews.json").write_text(sample_records.model_dump_json(indent=2))
    archive = save_history(
        History(runs=(run,)),
        tmp_path / "reports",
        load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker),
        suite,
        tmp_path,
        requirements=load_record(REPOSITORY / "planning/requirements.json", Requirements),
    )
    _ = (tmp_path / "qualified-index.json").write_text(output.model_dump_json(indent=2))
    assert load_record(archive / "evidence-index.json", EvidenceIndex).runs == (run,)


def test_release_consumes_required_image_review_blockers(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path
) -> None:
    run, suite, records = image_sample(synthetic_failure, tmp_path)
    history = History(runs=(run,))
    built = index(history, suite, tmp_path, records)
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    requirements = load_record(REPOSITORY / "planning/requirements.json", Requirements)
    receipt = audit(history, tracker, requirements, suite, evidence_index=built)
    row = next(r for r in receipt.obligations if r.id == "IE-07.AC5")
    assert row.state is Status.BLOCKED
    assert "producer-authenticity" in row.next_action
    assert receipt.product_acceptance == "blocked"
    with pytest.raises(InvalidArtifactError, match="release_evidence_index_mismatch"):
        _ = audit(
            history,
            tracker,
            requirements,
            suite,
            evidence_index=built.model_copy(update={"requirements": ()}),
        )


def test_real_offline_execution_and_comparison_replay_join_same_original(tmp_path: Path) -> None:
    original, captures, suite, settings = controlled_execution(tmp_path)
    diagnostic = replay_comparisons(History(runs=(original,)), captures, suite)
    history = History(runs=(original, diagnostic))
    output = index(history, suite, settings.artifacts)
    row = next(r for r in output.requirements if r.requirement == "IE-01.AC5")
    assert row.samples[1].execution_kind == "recorded-evaluation-replay"
    assert row.samples[1].source_run_id == original.id
    assert output.case_history[0].classification == "consistently_failed"
    assert output.case_history[0].denominator == 2
    assert len(output.artifacts) == len(original.evidence)
    assert all(a.bytes_checked for a in output.artifacts)


def test_master_release_obligation_retains_missing_image_review_reasons(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path
) -> None:
    run, suite, _ = image_sample(synthetic_failure, tmp_path)
    history = History(runs=(run,))
    built = index(history, suite, tmp_path)
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    original_tracker = tracker.model_dump_json()
    requirements = load_record(REPOSITORY / "planning/requirements.json", Requirements)
    receipt = audit(history, tracker, requirements, suite, evidence_index=built)
    master = next(row for row in receipt.obligations if row.id == "ART-01")
    indexed = next(row for row in built.requirements if row.requirement == "ART-01")
    expected = {
        "producer-authenticity-and-permission-authority-unverified",
        "permission-redaction-reviewer-access-unreviewed",
        "gpt-image-owner-qualification-missing",
        "gpt-image-generation-edit-chain-missing",
    }
    assert master.state is Status.BLOCKED
    assert set(master.next_action.split("; ")) == expected == set(indexed.blockers)
    assert indexed.canonical_status is Status.PLANNED
    assert tracker.model_dump_json() == original_tracker
    assert sum(c.status is Status.VERIFIED for c in tracker.criteria) == 3
    assert sum(c.status is Status.PLANNED for c in tracker.criteria) == 44
    assert set(receipt.exclusions) == {"BUD-04", "LIVE-01", "LIVE-02", "LIVE-03"}
    assert not set(receipt.exclusions).intersection(row.id for row in receipt.obligations)


def test_changed_fingerprint_cannot_create_flake_record(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path
) -> None:
    original, suite = synthetic_failure
    candidate = later(original, Outcome.PASSED).model_copy(
        update={
            "configuration_digest": "a" * 64,
            "attempt": 1,
            "parent_id": original.id,
            "rationale": "changed-input pass is not a flake",
        }
    )
    with pytest.raises(InvalidArtifactError, match="rerun_input_drift"):
        _ = index(History(runs=(original, candidate)), suite, tmp_path)


def test_mock_owner_response_cannot_reuse_original_review_as_live_proof(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path
) -> None:
    run, suite = synthetic_failure
    _ = (tmp_path / "result.json").write_bytes(b"synthetic observation")
    original_review = review(run.evidence[0], tmp_path)
    suite = Suite(cases=(suite.cases[0].model_copy(update={"modes": (Mode.MOCK, Mode.LIVE)}),))
    altered = run.model_copy(
        update={
            "suite_digest": digest(suite.model_dump_json().encode()),
            "results": (
                run.results[0].model_copy(
                    update={"outcome": Outcome.PASSED, "mode": Mode.LIVE, "origin": Origin.LIVE}
                ),
            ),
            "evidence": (
                run.evidence[0].model_copy(update={"mode": Mode.LIVE, "origin": Origin.LIVE}),
            ),
        }
    )
    with pytest.raises(InvalidArtifactError, match="evidence_review_artifact_mismatch"):
        _ = index(History(runs=(altered,)), suite, tmp_path, Reviews(evidence=(original_review,)))
    without_review = index(History(runs=(altered,)), suite, tmp_path)
    assert (
        "producer-authenticity-and-permission-authority-unverified"
        in without_review.artifacts[0].blockers
    )
    assert without_review.requirements[-1].canonical_status is Status.PLANNED


def test_provider_without_sandbox_cannot_invent_one(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path
) -> None:
    run, suite, records = image_sample(synthetic_failure, tmp_path)
    suite = Suite(cases=(suite.cases[0].model_copy(update={"modes": (Mode.SANDBOX,)}),))
    run = run.model_copy(
        update={
            "suite_digest": digest(suite.model_dump_json().encode()),
            "providers": (run.providers[0].model_copy(update={"mode": Mode.SANDBOX}),),
            "results": (
                run.results[0].model_copy(update={"mode": Mode.SANDBOX, "origin": Origin.SANDBOX}),
            ),
            "evidence": tuple(
                i.model_copy(update={"mode": Mode.SANDBOX, "origin": Origin.SANDBOX})
                for i in run.evidence
            ),
        }
    )
    records = records.model_copy(
        update={"evidence": tuple(review(i, tmp_path) for i in run.evidence)}
    )
    with pytest.raises(InvalidArtifactError, match="image_sandbox_unavailable"):
        _ = index(History(runs=(run,)), suite, tmp_path, records)


def test_committed_public_schemas_match_exported_formats(tmp_path: Path) -> None:
    schemas(tmp_path)
    for name in ("EvidenceIndex", "Reviews"):
        assert json.loads((tmp_path / f"{name}.schema.json").read_text()) == json.loads(
            (REPOSITORY / "schemas" / f"{name}.schema.json").read_text()
        )


def test_generated_index_scans_tracker_reference_metadata_before_export(
    synthetic_failure: tuple[Run, Suite],
) -> None:
    run, suite = synthetic_failure
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    altered = tracker.model_copy(
        update={
            "criteria": (
                tracker.criteria[0].model_copy(
                    update={
                        "implementation_issue_refs": (
                            "https://fixtures.example/review?signature=IE_SIGNED_CANARY_INDEX",
                        )
                    }
                ),
                *tracker.criteria[1:],
            )
        }
    )
    with pytest.raises(InvalidArtifactError, match="signed_access_url"):
        _ = build_index(History(runs=(run,)), suite, altered)


@pytest.mark.parametrize(
    "mutation", ["model", "configuration", "width", "usage", "receipt", "parent"]
)
def test_gpt_image_qualifications_must_join_actual_metadata_and_bytes(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path, mutation: str
) -> None:
    run, suite, records = image_sample(synthetic_failure, tmp_path)
    image = records.images[0]
    if mutation == "model":
        image = image.model_copy(update={"model": "unrelated"})
    elif mutation == "configuration":
        image = image.model_copy(update={"configuration_digest": "a" * 64})
    elif mutation == "width":
        image = image.model_copy(update={"width": 2})
    elif mutation == "usage":
        image = image.model_copy(update={"usage_status": "reported"})
    elif mutation == "receipt":
        image = image.model_copy(update={"receipt_unavailable_reason": None})
    else:
        image = image.model_copy(update={"parent_design_version": "unrelated"})
    records = records.model_copy(update={"images": (image, records.images[1])})
    with pytest.raises(InvalidArtifactError, match="image_"):
        _ = index(History(runs=(run,)), suite, tmp_path, records)


def test_missing_image_metadata_and_broken_edit_chain_stay_blocked(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path
) -> None:
    run, suite, records = image_sample(synthetic_failure, tmp_path)
    absent = index(History(runs=(run,)), suite, tmp_path)
    assert "gpt-image-owner-qualification-missing" in absent.artifacts[0].blockers
    broken = records.images[1].model_copy(update={"parent_design_version": "unrelated"})
    output = index(
        History(runs=(run,)),
        suite,
        tmp_path,
        records.model_copy(update={"images": (records.images[0], broken)}),
    )
    row = next(r for r in output.requirements if r.requirement == "IE-07.AC5")
    assert "gpt-image-generation-edit-chain-missing" in row.blockers


def test_image_properties_cannot_use_bytes_changed_after_archive_hash_check(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run, suite, records = image_sample(synthetic_failure, tmp_path)
    changed = PNG[:16] + (2).to_bytes(4, "big") + PNG[20:]
    qualifier = records.images[0].model_copy(update={"width": 2})
    records = records.model_copy(update={"images": (qualifier, records.images[1])})

    def changed_second_read(path: Path) -> bytes:
        return changed if path.name == "generate.png" else read_bytes(path)

    # Initial report_validation reads the actual width-1 bytes and accepts their original digest.
    # Only the later image-property read changes to width-2 bytes matching the forged qualifier.
    monkeypatch.setattr(evidence_index_module, "read_bytes", changed_second_read)
    with pytest.raises(InvalidArtifactError, match="image_digest_mismatch"):
        _ = index(History(runs=(run,)), suite, tmp_path, records)


def test_public_commands_write_full_index_without_changing_authority(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(REPOSITORY)
    original = (REPOSITORY / "planning/acceptance-checklist.json").read_bytes()
    runner = CliRunner()
    result = runner.invoke(app, ["run", "--output", str(tmp_path / "reports")])
    assert result.exit_code == 2, result.output
    archive = next((tmp_path / "reports").glob("run-*"))
    built = load_record(archive / "evidence-index.json", EvidenceIndex)
    assert len(built.requirements) == 146
    output = tmp_path / "reviewed-index.json"
    packaged = runner.invoke(app, ["evidence-index", str(archive), "--output", str(output)])
    assert packaged.exit_code == 2, packaged.output
    assert len(load_record(output, EvidenceIndex).requirements) == 146
    assert (REPOSITORY / "planning/acceptance-checklist.json").read_bytes() == original


def test_archive_index_rejects_changed_original_before_export(
    synthetic_failure: tuple[Run, Suite], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run, suite = synthetic_failure
    monkeypatch.chdir(REPOSITORY)
    _ = (tmp_path / "result.json").write_bytes(b"synthetic observation")
    archive = save_history(
        History(runs=(run,)),
        tmp_path / "reports",
        load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker),
        suite,
        tmp_path,
    )
    _ = (archive / "result.json").write_bytes(b"tampered")
    output = tmp_path / "index.json"
    result = CliRunner().invoke(
        app,
        [
            "evidence-index",
            str(archive),
            "--suite",
            str(archive / "suite.json"),
            "--output",
            str(output),
        ],
    )
    assert result.exit_code == 1
    assert not output.exists()
