"""Run the actual canonical SDK under offline containment and retain immutable receipts."""

import hashlib
import json
import os
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Final
from uuid import uuid4

from pydantic import ValidationError

from integration_evals.artifacts import confined_path, digest, read_bytes, reject_leaks
from integration_evals.contract_package import InstalledPackage, verify_installed_package
from integration_evals.contract_records import ContractObservation, ContractPin, ContractReceipt
from integration_evals.contract_sources import (
    RequiredExport,
    bind_contract_observation,
    missing_exports,
    required_exports,
)
from integration_evals.errors import InvalidArtifactError, fail
from integration_evals.processes import ProcessSettings, invoke
from integration_evals.validation import git_value, source_fingerprint, unique_ids

MANDATORY_CATEGORIES: Final = frozenset(
    {
        "minimal",
        "full",
        "missing",
        "type",
        "enum",
        "malformed_json",
        "unsupported_version",
        "unknown_field",
    }
)
MAX_RUNTIME_BYTES: Final = 256 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class ContractSettings:
    """Paths and reviewed execution identity for a single offline consumer run."""

    repository: Path
    producer: Path
    node: Path
    node_digest: str
    pin: ContractPin
    candidate_scope: bool = False
    installed: InstalledPackage | None = None


def runtime_digest(path: Path) -> str:
    """Hash a bounded regular runtime binary without the small JSON artifact limit."""
    if not path.is_file() or path.stat().st_size > MAX_RUNTIME_BYTES:
        return fail("invalid_contract_runtime", "node")
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def validate_contract_pin(settings: ContractSettings) -> None:
    """Reject source, configuration or binary drift before executing any producer code."""
    pin, producer = settings.pin, settings.producer
    if settings.installed is not None:
        if pin.package is None:
            fail("contract_package_pin_missing", "shared-contracts")
        verify_installed_package(settings.installed, pin.package)
    if git_value(producer, "rev-parse", "HEAD") != pin.revision:
        fail("contract_revision_mismatch", "shared-contracts")
    if git_value(producer, "rev-parse", "HEAD^{tree}") != pin.tree:
        fail("contract_tree_mismatch", "shared-contracts")
    if git_value(producer, "status", "--porcelain", "--untracked-files=all"):
        fail("dirty_contract_checkout", "shared-contracts")
    for path, expected in (
        ("package-lock.json", pin.lockfile_digest),
        ("generated/schema-manifest.json", pin.schema_manifest_digest),
        ("generated/fixture-manifest.json", pin.fixture_manifest_digest),
        ("docs/contract-catalog.md", pin.catalog_digest),
    ):
        if digest(read_bytes(confined_path(producer, path))) != expected:
            fail("contract_artifact_pin_mismatch", path)
    if runtime_digest(settings.node) != settings.node_digest:
        fail("contract_runtime_digest_mismatch", "node")


def validate_contract_observation(observation: ContractObservation, pin: ContractPin) -> None:
    """Require nonempty unique fixture coverage and the exact executing runtime."""
    if observation.node_version != pin.node_version:
        fail("contract_runtime_version_mismatch", "node")
    unique_ids(observation.required_contracts, "canonical_catalog")
    if len({result.key for result in observation.results}) != len(observation.results):
        fail("duplicate_contract_version", "canonical_exports")
    if observation.required_versions is None:
        unique_ids(tuple(result.contract for result in observation.results), "canonical_exports")
    elif len({item.key for item in observation.required_versions}) != len(
        observation.required_versions
    ):
        fail("duplicate_contract_version", "canonical_catalog")
    for result in observation.results:
        unique_ids(result.cases, result.contract)
        if result.contract not in observation.required_contracts:
            fail("orphan_contract_export", result.contract)
        if observation.required_versions is not None and result.key not in {
            item.key for item in observation.required_versions
        }:
            fail("orphan_contract_version", result.contract)
        if not set(result.failures).issubset(result.cases):
            fail("orphan_fixture_failure", result.contract)
        if not MANDATORY_CATEGORIES.issubset(result.categories):
            fail("incomplete_contract_fixture_categories", result.contract)


def execute_contracts(settings: ContractSettings) -> ContractReceipt:
    """Preserve failures and source pins without granting owner or product acceptance."""
    validate_contract_pin(settings)
    driver = Path(__file__).with_name("contract_driver.mjs")
    driver_digest = digest(read_bytes(driver))
    observation: ContractObservation | None = None
    required: tuple[RequiredExport, ...] | None = None
    reason: str | None = None
    exit_code: int | None = None
    output = b""
    started_at = datetime.now(UTC)
    with TemporaryDirectory(prefix="integration-contracts-") as directory:
        staging = Path(directory)
        environment = {"HOME": directory, "TMPDIR": directory}
        if "PATH" in os.environ:
            environment["PATH"] = os.environ["PATH"]
        try:
            required = required_exports(settings.producer)
            with (staging / "stdout").open("w+b") as stdout:
                exit_code = invoke(
                    (
                        str(settings.node.resolve()),
                        "--experimental-import-meta-resolve",
                        str(driver.resolve()),
                    ),
                    ProcessSettings(
                        checkout=settings.producer,
                        environment=environment,
                        payload=json.dumps(
                            {
                                "producer": str(settings.producer.resolve()),
                                "node_version": settings.pin.node_version,
                                "package_root": (
                                    str(settings.installed.root.resolve())
                                    if settings.installed is not None
                                    else None
                                ),
                            }
                        ).encode(),
                        stdout=stdout,
                        timeout=60,
                        offline=True,
                        writable_directory=staging,
                    ),
                )
            output = read_bytes(staging / "stdout")
            reject_leaks(output, "contract-output")
            if exit_code == 0:
                observation = ContractObservation.model_validate_json(output)
                bind_contract_observation(observation, settings.producer, settings.pin)
                validate_contract_observation(observation, settings.pin)
            else:
                reason = "canonical SDK driver failed; private output withheld"
            validate_contract_pin(settings)
        except subprocess.TimeoutExpired:
            reason = "canonical SDK driver timed out"
        except (ValidationError, InvalidArtifactError, OSError):
            reason = "canonical SDK output or execution rejected; private output withheld"
            observation = None
    failed = observation is not None and any(result.failures for result in observation.results)
    available: set[tuple[str, str]] = (
        {result.key for result in observation.results} if observation else set()
    )
    return ContractReceipt(
        id="contracts-" + uuid4().hex,
        started_at=started_at,
        integration_revision=git_value(settings.repository, "rev-parse", "HEAD"),
        integration_source_digest=source_fingerprint(settings.repository),
        integration_dirty=bool(git_value(settings.repository, "status", "--porcelain")),
        pin=settings.pin,
        pin_digest=digest(settings.pin.model_dump_json().encode()),
        node_digest=settings.node_digest,
        driver_digest=driver_digest,
        execution_surface="installed-package" if settings.installed else "source",
        candidate_scope=settings.candidate_scope,
        execution="error" if observation is None else ("failed" if failed else "passed"),
        reason=reason,
        exit_code=exit_code,
        output_digest=digest(output),
        observation=observation,
        missing_contracts=(
            missing_exports(required, available)
            if required is not None
            else ("canonical-catalog-unavailable",)
        ),
        limitations=(
            (
                "Installed public SDK fixtures; owner-boundary adoption remains unverified."
                if settings.installed
                else "Source SDK fixture execution; installed-package adoption remains unverified."
            ),
            "Synthetic contexts and offline mode do not authenticate product or finance authority.",
            "Published contracts, owner acknowledgement and composed release remain required.",
        ),
    )


def save_contract_receipt(receipt: ContractReceipt, output: Path) -> Path:
    """Publish a new immutable receipt directory; reruns cannot replace failures."""
    directory = confined_path(output, receipt.id)
    directory.mkdir(parents=True, exist_ok=False)
    data = receipt.model_dump_json(indent=2).encode()
    reject_leaks(data, receipt.id)
    _ = (directory / "contracts.json").write_bytes(data)
    _ = (directory / "contracts.sha256").write_text(digest(data), encoding="utf-8")
    return directory
