"""Authoritative acceptance tracker records shared by reporting and evidence joins."""

from integration_evals.models import Record, RequirementId, Status


class Criterion(Record):
    """Authoritative master acceptance row retained without altered ownership."""

    id: RequirementId
    category: str
    classification: str
    priority: str
    owner_role: str
    title: str
    verification: str
    evidence_required: str
    status: Status
    evidence_refs: tuple[str, ...]
    tested_revision_refs: tuple[str, ...]
    notes: str
    dependencies: tuple[str, ...]
    implementation_issue_refs: tuple[str, ...]


class Tracker(Record):
    """Original plan remains the authority; run output is an independent view."""

    format_version: str
    document_date: str
    kind: str
    allowed_statuses: tuple[Status, ...]
    notes: tuple[str, ...]
    criteria: tuple[Criterion, ...]
