"""Pinned canonical SDK conformance receipts, separate from product acceptance."""

from datetime import datetime
from typing import Literal

from pydantic import Field

from integration_evals.models import Digest, Identifier, Record, Revision


class ContractPin(Record):
    """Reviewed source and manifest bytes required before loading producer code."""

    revision: Revision
    tree: Revision
    lockfile_digest: Digest
    schema_manifest_digest: Digest
    fixture_manifest_digest: Digest
    catalog_digest: Digest
    node_version: str = Field(pattern=r"^\d+\.\d+\.\d+$")


class ContractIdentity(Record):
    """Identify an exact advertised version without collapsing its contract name."""

    contract: Identifier
    version: str

    @property
    def key(self) -> tuple[str, str]:
        """Return the exact metadata join key."""
        return self.contract, self.version


class FixtureSemantics(Record):
    """Preserve semantic labels actually emitted by the pinned producer harness."""

    case: Identifier
    profile: Literal["historical_finance_characterization"]
    operational_authority: Literal[False]


class ContractSlice(ContractIdentity):
    """Executed frozen fixture IDs and original schema identity for one export."""

    schema_digest: Digest
    cases: tuple[Identifier, ...] = Field(min_length=1)
    failures: tuple[Identifier, ...]
    categories: tuple[Identifier, ...]
    fixture_path: str | None = None
    semantic_records: tuple[FixtureSemantics, ...] = ()


class ContractRuntime(Record):
    """Platform-specific reviewed executable path and exact binary bytes."""

    path: str = Field(min_length=1)
    sha256: Digest


class ContractObservation(Record):
    """Strict output boundary for the isolated Node consumer driver."""

    node_version: str
    fixture_digest: Digest
    required_contracts: tuple[Identifier, ...] = Field(min_length=1)
    required_versions: tuple[ContractIdentity, ...] | None = Field(default=None, min_length=1)
    results: tuple[ContractSlice, ...] = Field(min_length=1)


class ContractReceipt(Record):
    """A candidate fixture pass cannot authenticate a composed release or owner consent."""

    id: Identifier
    started_at: datetime
    integration_revision: Revision
    integration_source_digest: Digest
    integration_dirty: bool
    pin: ContractPin
    pin_digest: Digest
    node_digest: Digest
    driver_digest: Digest
    mode: Literal["mock-only"] = "mock-only"
    origin: Literal["synthetic"] = "synthetic"
    candidate_scope: bool
    execution: Literal["passed", "failed", "error"]
    reason: str | None
    exit_code: int | None
    output_digest: Digest
    observation: ContractObservation | None
    missing_contracts: tuple[str, ...]
    product_acceptance: Literal["blocked"] = "blocked"
    owner_acknowledgement: None = None
    limitations: tuple[str, ...]
