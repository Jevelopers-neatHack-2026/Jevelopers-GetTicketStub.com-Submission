"""Strict versioned evaluation records, separate from canonical product schemas."""

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, ClassVar, Literal, NewType

from pydantic import BaseModel, ConfigDict, Field

Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Revision = Annotated[str, Field(pattern=r"^[a-f0-9]{40}$")]
Identifier = Annotated[str, Field(min_length=1, pattern=r"^[A-Za-z0-9_.-]+$")]
RequirementId = NewType("RequirementId", str)
CaseId = NewType("CaseId", str)


class Record(BaseModel):
    """Reject undeclared fields at the evaluation input boundary."""

    model_config: ClassVar[ConfigDict] = ConfigDict(
        frozen=True, extra="forbid", allow_inf_nan=False, strict=True
    )


class Mode(StrEnum):
    """Execution transport mode, independent from fixture origin."""

    MOCK = "mock-only"
    RECORDED = "recorded"
    SANDBOX = "sandbox"
    LIVE = "live"


class Origin(StrEnum):
    """Where the actual artifact originated."""

    SYNTHETIC = "synthetic"
    RECORDED = "recorded"
    SANDBOX = "sandbox-derived"
    LIVE = "live"


class Outcome(StrEnum):
    """Execution result; a blocked criterion has a skipped execution."""

    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ERROR = "error"


class Status(StrEnum):
    """Canonical criterion state."""

    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    VERIFIED = "verified"
    DEFERRED = "deferred"


class Fixture(Record):
    """Permission-reviewed inert fixture catalog entry."""

    id: Identifier
    path: str
    sha256: Digest
    media_type: str
    family: Identifier
    origin: Origin
    source_ref: str
    collected_at: datetime
    creator: str
    permission: str
    tenant_scope: str
    redaction: str
    retention: str
    revoked: bool = False
    quarantined: bool = False
    requirements: tuple[RequirementId, ...] = Field(min_length=1)
    expected: str
    modes: tuple[Mode, ...] = Field(min_length=1)


class Catalog(Record):
    """Content-addressed fixture inventory."""

    schema_version: Literal["1.0"] = "1.0"
    fixtures: tuple[Fixture, ...]
    upstream_revision: Revision | None = None
    canonical_schema_digest: Digest | None = None


class Provider(Record):
    """Preflight configuration; credential values never enter records."""

    id: Identifier
    mode: Mode
    model: str
    endpoint: str | None = None
    credential_env: Identifier | None = None
    eligible: bool = False
    authority_ref: str | None = None
    cap: Decimal | None = Field(default=None, gt=0)
    currency: str | None = None
    cleanup_supported: bool = False
    allowed_operations: tuple[str, ...] = ()


class Component(Record):
    """Immutable owner-provided checkout and adapter entrypoints."""

    repository: Identifier
    revision: Revision
    tree: Revision
    lockfile_path: str
    lockfile_digest: Digest
    command: tuple[str, ...] = ()
    cleanup_command: tuple[str, ...] = ()


class Assembly(Record):
    """App-owned composed release input; never inferred from moving branches."""

    schema_version: Literal["1.0"] = "1.0"
    owner: Identifier
    kind: Literal["composed", "component"] = "composed"
    selected_cases: tuple[CaseId, ...] | None = Field(default=None, min_length=1)
    integration_revision: Revision
    components: tuple[Component, ...] = Field(min_length=1)
    contract_digest: Digest
    contract_artifact_path: str | None = None
    fixture_digest: Digest
    runtime: str
    configuration_digest: Digest
    configuration_component: str = "integration-evals"
    configuration_artifact_path: str | None = None
    providers: tuple[Provider, ...] = ()


class Assertion(Record):
    """Compare an owner-produced named observation to a frozen oracle."""

    observation: Identifier
    expected: str | int | bool | Decimal | None


class Case(Record):
    """Declarative verification scenario with no competing domain implementation."""

    id: CaseId
    requirements: tuple[RequirementId, ...] = Field(min_length=1)
    fixtures: tuple[str, ...]
    component: str
    interface: str
    invariant: str
    assertions: tuple[Assertion, ...] = Field(min_length=1)
    artifacts: tuple[str, ...] = Field(min_length=1)
    modes: tuple[Mode, ...] = Field(min_length=1)
    provider_ids: tuple[str, ...] = ()
    operations: tuple[str, ...] = ()
    platform: Literal["any", "linux"] = "any"
    safety: bool = False
    mandatory: bool = True
    timeout_seconds: int = Field(default=30, ge=1, le=300)
    fault: str | None = None
    dependencies: tuple[str, ...] = ()
    artifact_producers: tuple[str, ...] = ()
    required_evidence_kinds: tuple[str, ...] = ("evaluation",)


class Suite(Record):
    """Checked-in scenario selection and ownership map."""

    schema_version: Literal["1.0"] = "1.0"
    cases: tuple[Case, ...] = Field(min_length=1)


class Selection(Record):
    """Independent mandatory registry prevents deleting cases to manufacture success."""

    schema_version: Literal["1.0"] = "1.0"
    mandatory_case_ids: tuple[CaseId, ...] = Field(min_length=1)


class Evidence(Record):
    """Sanitized derivative linked to an actual immutable source artifact."""

    id: Identifier
    requirement: RequirementId
    case_id: CaseId
    run_id: Identifier
    component: str
    revision: Revision
    created_at: datetime
    original_cutoff: datetime
    mode: Mode
    origin: Origin
    path: str
    sha256: Digest
    permission_ref: str
    redaction_ref: str
    reviewer_access_ref: str
    kind: Literal["trace", "checkpoint", "forecast", "image", "decision", "evaluation"]
    limitations: tuple[str, ...] = ()


class CaseResult(Record):
    """Result with honest costs, observed evidence mode and blockers."""

    case_id: CaseId
    requirements: tuple[RequirementId, ...]
    outcome: Outcome
    criterion_status: Status
    mode: Mode
    origin: Origin
    duration_seconds: float = Field(ge=0)
    cost: Decimal | None = Field(default=None, ge=0)
    cost_status: Literal["unknown", "estimated", "confirmed"] = "unknown"
    evidence_ids: tuple[str, ...] = ()
    blocker_owner: str | None = None
    reason: str | None = None
    exit_code: int | None = None
    cleanup_status: Literal["not-run", "passed", "failed", "unknown"] = "not-run"
    output_digest: Digest | None = None


class Run(Record):
    """Immutable evaluation execution receipt, retaining failed ancestors."""

    schema_version: Literal["1.0"] = "1.0"
    id: Identifier
    parent_id: Identifier | None = None
    attempt: int = Field(default=0, ge=0, le=2)
    rationale: str | None = None
    started_at: datetime
    context: Literal["local", "ci"]
    scope: Literal["composed", "component"] = "composed"
    selected_case_ids: tuple[CaseId, ...] = Field(min_length=1)
    integration_revision: Revision
    source_digest: Digest
    working_tree_dirty: bool
    manifest_digest: Digest
    suite_digest: Digest
    fixture_digest: Digest
    configuration_digest: Digest
    runtime: str
    seed: int
    clock: datetime
    components: tuple[Component, ...]
    providers: tuple[Provider, ...]
    results: tuple[CaseResult, ...] = Field(min_length=1)
    evidence: tuple[Evidence, ...] = ()
    limitations: tuple[str, ...] = ()
