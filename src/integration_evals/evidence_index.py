"""Join preserved evaluator receipts to scoped, hash-bound evidence reviews."""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from struct import unpack
from typing import Final, Literal

from pydantic import Field

from integration_evals.artifacts import confined_path, digest, read_bytes, reject_leaks
from integration_evals.errors import fail
from integration_evals.history import CaseHistory, History, summarize_history, validate_record
from integration_evals.models import (
    CaseId,
    CaseResult,
    Digest,
    Evidence,
    Identifier,
    Mode,
    Origin,
    Outcome,
    Record,
    Revision,
    Run,
    Status,
    Suite,
)
from integration_evals.report_models import Tracker
from integration_evals.report_validation import validate_evidence
from integration_evals.specifications import Requirements

PNG_HEADER_BYTES: Final = 24


class ReviewReference(Record):
    """An accessible sanitized review derivative, never an unchecked remote URL."""

    reference: str = Field(min_length=1)
    path: str
    sha256: Digest


class EvidenceReview(Record):
    """Owner-supplied review claims bound to the exact original evidence identity."""

    run_id: Identifier
    evidence_id: Identifier
    artifact_digest: Digest
    source_mode: Mode
    source_origin: Origin
    producing_revision: Revision
    original_created_at: datetime
    original_cutoff: datetime
    review_scope: Literal["local-attestation"] = "local-attestation"
    reviewer: Identifier
    intended_reviewers: tuple[Identifier, ...] = Field(min_length=1)
    checked_at: datetime
    expires_at: datetime
    permission: ReviewReference
    redaction: ReviewReference
    access: ReviewReference
    limitations: tuple[str, ...] = ()


class ImageQualification(Record):
    """Creative-owned GPT Image metadata; no invented provider receipt or usage IDs."""

    run_id: Identifier
    evidence_id: Identifier
    artifact_digest: Digest
    operation: Literal["generate", "edit"]
    provider_id: Literal["gpt-image"] = "gpt-image"
    model: str = Field(min_length=1)
    endpoint: str = Field(min_length=1)
    configuration_digest: Digest
    requested_at: datetime
    design_version: Identifier
    parent_design_version: Identifier | None = None
    input_digests: tuple[Digest, ...] = Field(min_length=1)
    input_permission: ReviewReference
    usage_status: Literal["unknown", "reported"]
    usage: ReviewReference | None = None
    provider_receipt: ReviewReference | None = None
    receipt_unavailable_reason: str | None = None
    media_type: Literal["image/png"] = "image/png"
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    provider_has_sandbox: bool = False
    limitations: tuple[str, ...] = ()


class Reviews(Record):
    """Optional evaluator sidecar leaves the existing Run/Evidence contract unchanged."""

    schema_version: Literal["1.0"] = "1.0"
    evidence: tuple[EvidenceReview, ...] = ()
    images: tuple[ImageQualification, ...] = ()


@dataclass(frozen=True, slots=True)
class IndexChecks:
    """Local verification inputs kept distinct from serializable producer claims."""

    roots: dict[str, Path]
    reviews: Reviews
    review_root: Path
    checked_at: datetime


class IndexedArtifact(Record):
    """Original metadata and local byte verification plus separately scoped review."""

    evidence: Evidence
    bytes_checked: bool
    review: EvidenceReview | None
    image: ImageQualification | None
    blockers: tuple[str, ...]


class IndexedSample(Record):
    """Every case attempt keeps its own run receipt and source identity."""

    run_id: str
    source_run_id: str
    execution_kind: Literal["owner-execution", "recorded-evaluation-replay"]
    run_digest: Digest
    manifest_digest: Digest
    configuration_digest: Digest
    fixture_digest: Digest
    case_id: str
    outcome: Outcome
    criterion_status: Status
    mode: Mode
    origin: Origin
    evidence_ids: tuple[str, ...]
    evidence_scope: Literal[
        "mocked", "recorded", "unreviewed", "local-review-attestation", "blocked"
    ]
    blocker_owner: str | None
    reason: str | None


class IndexedRequirement(Record):
    """Canonical state is preserved independently from observed artifact coverage."""

    requirement: str
    canonical_status: Status
    issue_refs: tuple[str, ...]
    dependencies: tuple[str, ...]
    excluded: bool
    samples: tuple[IndexedSample, ...]
    blockers: tuple[str, ...]


class EvidenceIndex(Record):
    """Versioned offline package; never an acceptance or producer-authenticity grant."""

    schema_version: Literal["1.0"] = "1.0"
    history_digest: Digest
    suite_digest: Digest
    tracker_digest: Digest
    requirements_digest: Digest | None
    checked_at: datetime
    runs: tuple[Run, ...]
    requirements: tuple[IndexedRequirement, ...]
    artifacts: tuple[IndexedArtifact, ...]
    case_history: tuple[CaseHistory, ...]
    limitations: tuple[str, ...] = (
        "Local hashes prove consistency. Authenticity and reviewer identity need owner review.",
        "Artifact reviews never promote master criteria or establish product acceptance.",
        "Reviewer access is an expiring owner attestation. Remote references are never fetched.",
        "GPT Image checks cover PNG header dimensions. Creative quality needs owner review.",
    )


def _reference(reference: ReviewReference, root: Path) -> None:
    data = read_bytes(confined_path(root, reference.path))
    if digest(data) != reference.sha256:
        fail("evidence_review_digest_mismatch", "review")
    reject_leaks(data, "review")


def _review(item: Evidence, review: EvidenceReview, root: Path, checked_at: datetime) -> None:
    if (
        review.artifact_digest != item.sha256
        or review.source_mode != item.mode
        or review.source_origin != item.origin
        or review.producing_revision != item.revision
        or review.original_created_at != item.created_at
        or review.original_cutoff != item.original_cutoff
    ):
        fail("evidence_review_artifact_mismatch", item.id)
    if (
        review.checked_at.utcoffset() is None
        or review.expires_at.utcoffset() is None
        or not item.created_at <= review.checked_at <= checked_at < review.expires_at
    ):
        fail("stale_evidence_review", item.id)
    for reference, expected in (
        (review.permission, item.permission_ref),
        (review.redaction, item.redaction_ref),
        (review.access, item.reviewer_access_ref),
    ):
        if reference.reference != expected:
            fail("evidence_review_reference_mismatch", item.id)
        _reference(reference, root)


def _image(
    item: Evidence, image: ImageQualification, run: Run, root: Path, review_root: Path
) -> None:
    provider = next((p for p in run.providers if p.id == image.provider_id), None)
    if (
        item.kind != "image"
        or item.component != "creative-engine"
        or image.artifact_digest != item.sha256
        or provider is None
        or provider.model != image.model
        or provider.endpoint != image.endpoint
        or provider.mode != item.mode
        or image.configuration_digest != run.configuration_digest
    ):
        fail("image_provenance_mismatch", item.id)
    if item.mode is Mode.SANDBOX and not image.provider_has_sandbox:
        fail("image_sandbox_unavailable", item.id)
    if image.requested_at.utcoffset() is None or image.requested_at > item.created_at:
        fail("image_timestamp_mismatch", item.id)
    if (image.usage_status == "reported") != (image.usage is not None):
        fail("image_usage_mismatch", item.id)
    if (image.provider_receipt is None) != bool(image.receipt_unavailable_reason):
        fail("image_receipt_uncertainty_missing", item.id)
    if (image.operation == "edit") != (image.parent_design_version is not None) or (
        image.parent_design_version == image.design_version
    ):
        fail("image_parent_mismatch", item.id)
    _image_bytes(item, image, root)
    for reference in (image.input_permission, image.usage, image.provider_receipt):
        if reference is not None:
            _reference(reference, review_root)


def _image_bytes(item: Evidence, image: ImageQualification, root: Path) -> None:
    """Bind media properties and leakage checks to the exact bytes parsed on this read."""
    data = read_bytes(confined_path(root, item.path))
    if digest(data) != item.sha256:
        fail("image_digest_mismatch", item.id)
    reject_leaks(data, item.id)
    if (
        len(data) < PNG_HEADER_BYTES
        or data[:8] != b"\x89PNG\r\n\x1a\n"
        or data[12:16] != b"IHDR"
        or unpack(">II", data[16:24]) != (image.width, image.height)
    ):
        fail("image_media_mismatch", item.id)


def index_artifacts(
    history: History,
    roots: dict[str, Path],
    reviews: Reviews,
    review_root: Path,
    checked_at: datetime,
) -> tuple[IndexedArtifact, ...]:
    """Reject orphan/stale sidecars; absent reviews remain explicit blockers."""
    reject_leaks(reviews.model_dump_json().encode(), "reviews")
    review_map = {(r.run_id, r.evidence_id): r for r in reviews.evidence}
    image_map = {(r.run_id, r.evidence_id): r for r in reviews.images}
    if len(review_map) != len(reviews.evidence) or len(image_map) != len(reviews.images):
        fail("duplicate_evidence_review", "reviews")
    indexed: dict[tuple[str, str], IndexedArtifact] = {}
    for run in history.runs:
        source = run.evaluation_source_run or run.id
        root = roots.get(source)
        if root is not None:
            validate_evidence(run.evidence, root, run)
        for item in run.evidence:
            if not any(item.id in result.evidence_ids for result in run.results):
                fail("orphan_index_artifact", item.id)
            key = (item.run_id, item.id)
            if key in indexed:
                continue  # Comparison replay retains the original source artifact.
            indexed[key] = _artifact(
                item,
                run,
                root,
                IndexChecks(roots, reviews, review_root, checked_at),
            )
    if not set(review_map).issubset(indexed) or not set(image_map).issubset(indexed):
        fail("orphan_evidence_review", "reviews")
    return tuple(indexed.values())


def _artifact(item: Evidence, run: Run, root: Path | None, checks: IndexChecks) -> IndexedArtifact:
    key = (item.run_id, item.id)
    review = next((r for r in checks.reviews.evidence if (r.run_id, r.evidence_id) == key), None)
    image = next((r for r in checks.reviews.images if (r.run_id, r.evidence_id) == key), None)
    blockers: list[str] = ["producer-authenticity-and-permission-authority-unverified"]
    if root is None:
        blockers.append("artifact-bytes-unavailable")
    if review is None:
        blockers.append("permission-redaction-reviewer-access-unreviewed")
    else:
        _review(item, review, checks.review_root, checks.checked_at)
    if item.kind == "image":
        if image is None:
            blockers.append("gpt-image-owner-qualification-missing")
        elif root is not None:
            _image(item, image, run, root, checks.review_root)
        if (
            image is not None
            and image.provider_receipt is None
            and item.origin is not Origin.SYNTHETIC
        ):
            blockers.append("original-provider-receipt-unavailable")
    elif image is not None:
        fail("image_provenance_mismatch", item.id)
    return IndexedArtifact(
        evidence=item,
        bytes_checked=root is not None,
        review=review,
        image=image,
        blockers=tuple(blockers),
    )


def _sample_blockers(
    result: CaseResult, attached: tuple[IndexedArtifact, ...], quarantined: set[CaseId]
) -> tuple[str, ...]:
    blockers = [b for a in attached for b in a.blockers]
    if result.case_id in quarantined:
        blockers.append("required-case-quarantined")
    if result.outcome is not Outcome.PASSED:
        blockers.append(result.reason or result.outcome.value)
    if "IE-07.AC5" in result.requirements:
        images = tuple(a.image for a in attached if a.image is not None)
        generated = {i.design_version for i in images if i.operation == "generate"}
        if not generated or not any(
            i.operation == "edit" and i.parent_design_version in generated for i in images
        ):
            blockers.append("gpt-image-generation-edit-chain-missing")
    return tuple(blockers)


def build_index(
    history: History,
    suite: Suite,
    tracker: Tracker,
    requirements: Requirements | None = None,
    *,
    checks: IndexChecks | None = None,
) -> EvidenceIndex:
    """Export all known requirements and preserve actual sample/fingerprint joins."""
    validate_record(history, suite)
    case_history = summarize_history(history, suite)
    quarantined = {row.case_id for row in case_history if row.quarantine is not None}
    quarantined.update(case.id for case in suite.cases if case.quarantined is True)
    checks = checks or IndexChecks({}, Reviews(), Path(), history.runs[-1].started_at)
    timestamp = checks.checked_at
    if timestamp.utcoffset() is None:
        fail("evidence_index_timezone_missing", "index")
    artifacts = index_artifacts(
        history, checks.roots, checks.reviews, checks.review_root, timestamp
    )
    indexed = {(a.evidence.run_id, a.evidence.id): a for a in artifacts}
    master = {str(c.id): c for c in tracker.criteria}
    leaves = {str(c.id): c for c in requirements.leaves} if requirements else {}
    scope = dict.fromkeys(
        (*master, *leaves, *(str(r) for c in suite.cases for r in c.requirements))
    )
    if requirements is not None and any(r not in master and r not in leaves for r in scope):
        fail("orphan_index_requirement", "index")
    rows: list[IndexedRequirement] = []
    for requirement in scope:
        samples: list[IndexedSample] = []
        blockers: list[str] = []
        for run in history.runs:
            for result in run.results:
                if requirement not in result.requirements:
                    continue
                source = run.evaluation_source_run or run.id
                attached = tuple(indexed[(source, eid)] for eid in result.evidence_ids)
                scope_label = (
                    "blocked"
                    if result.outcome is not Outcome.PASSED
                    else "mocked"
                    if result.mode is Mode.MOCK or result.origin is Origin.SYNTHETIC
                    else "recorded"
                    if run.evaluation_source_run or result.mode is Mode.RECORDED
                    else "unreviewed"
                    if any(len(a.blockers) > 1 for a in attached)
                    else "local-review-attestation"
                )
                blockers.extend(_sample_blockers(result, attached, quarantined))
                samples.append(
                    IndexedSample(
                        run_id=run.id,
                        source_run_id=source,
                        execution_kind=run.execution_kind,
                        run_digest=digest(run.model_dump_json().encode()),
                        manifest_digest=run.manifest_digest,
                        configuration_digest=run.configuration_digest,
                        fixture_digest=run.fixture_digest,
                        case_id=result.case_id,
                        outcome=result.outcome,
                        criterion_status=result.criterion_status,
                        mode=result.mode,
                        origin=result.origin,
                        evidence_ids=result.evidence_ids,
                        evidence_scope=scope_label,
                        blocker_owner=result.blocker_owner,
                        reason=result.reason,
                    )
                )
        criterion = master.get(requirement)
        leaf = leaves.get(requirement)
        rows.append(
            IndexedRequirement(
                requirement=requirement,
                canonical_status=criterion.status if criterion else Status.PLANNED,
                issue_refs=criterion.implementation_issue_refs
                if criterion
                else ((leaf.issue,) if leaf else ()),
                dependencies=criterion.dependencies if criterion else (),
                excluded=criterion is not None and criterion.priority != "P0",
                samples=tuple(samples),
                blockers=tuple(dict.fromkeys(blockers)) if samples else ("no-executed-boundary",),
            )
        )
    output = EvidenceIndex(
        history_digest=digest(history.model_dump_json().encode()),
        suite_digest=digest(suite.model_dump_json().encode()),
        tracker_digest=digest(tracker.model_dump_json().encode()),
        requirements_digest=digest(requirements.model_dump_json().encode())
        if requirements
        else None,
        checked_at=timestamp,
        runs=history.runs,
        requirements=tuple(rows),
        artifacts=artifacts,
        case_history=case_history,
    )
    reject_leaks(output.model_dump_json().encode(), "index")
    return output
