"""Validate fixture, coverage and exact composed-release inputs before execution."""

import shutil
import subprocess
import sys
from datetime import timedelta
from pathlib import Path
from time import monotonic
from typing import Final

from integration_evals.artifacts import (
    confined_path,
    digest,
    public_reference,
    read_bytes,
    reject_leaks,
)
from integration_evals.errors import fail
from integration_evals.models import (
    Assembly,
    Catalog,
    Component,
    Origin,
    RequirementId,
    Selection,
    Suite,
)

REQUIRED_COMPONENTS: Final = frozenset(
    {
        "getticketstub.com",
        "shared-contracts",
        "agent-harness",
        "event-intelligence",
        "creative-engine",
        "cost-intelligence",
        "integration-evals",
    }
)


def unique_ids(values: tuple[str, ...], reference: str) -> None:
    """Prevent identity collisions in catalogs, suites and manifests."""
    if len(values) != len(set(values)):
        fail("duplicate_id", reference)


def validate_catalog(catalog: Catalog, root: Path, requirements: frozenset[RequirementId]) -> None:
    """Inspect inert bytes and permission metadata without rendering or fetching."""
    unique_ids(tuple(item.id for item in catalog.fixtures), "fixture_catalog")
    for item in catalog.fixtures:
        if not set(item.requirements).issubset(requirements):
            fail("orphan_fixture", item.id)
        if not all(
            (
                item.permission,
                item.creator,
                item.retention,
                item.redaction,
                item.expected,
                item.tenant_scope,
                item.media_type,
                item.source_ref,
            )
        ):
            fail("missing_provenance", item.id)
        if item.collected_at.utcoffset() != timedelta(0):
            fail("non_utc_date", item.id)
        if item.revoked and not item.quarantined:
            fail("revoked_fixture", item.id)
        data = read_bytes(confined_path(root, item.path))
        if digest(data) != item.sha256:
            fail("fixture_digest_mismatch", item.id)
        public_reference(item.source_ref)
        if not item.quarantined:
            reject_leaks(data, item.id)
        if item.origin is Origin.SYNTHETIC and item.source_ref.startswith("https://"):
            host = item.source_ref.split("/")[2]
            if not (host.endswith(".example") or host in {"example.com", "example.org"}):
                fail("non_reserved_synthetic_source", item.id)


def validate_suite(
    suite: Suite,
    catalog: Catalog,
    requirements: frozenset[RequirementId],
    selection: Selection | None = None,
) -> None:
    """Require owned cases, available fixtures and explicit mandatory selection."""
    unique_ids(tuple(case.id for case in suite.cases), "suite")
    if selection is None:
        fail("mandatory_registry_missing", "suite")
    if not set(selection.mandatory_case_ids).issubset(
        case.id for case in suite.cases if case.mandatory
    ):
        fail("mandatory_cases_omitted", "suite")
    fixtures = {item.id: item for item in catalog.fixtures}
    for case in suite.cases:
        if not set(case.requirements).issubset(requirements):
            fail("orphan_case", case.id)
        if not all((case.component, case.interface, case.invariant)):
            fail("missing_case_boundary", case.id)
        for fixture_id in case.fixtures:
            fixture = fixtures.get(fixture_id)
            if fixture is None or fixture.revoked:
                fail("unavailable_fixture", case.id)
            if not set(case.modes).issubset(fixture.modes):
                fail("unsupported_fixture_mode", case.id)


def git_value(checkout: Path, *args: str, deadline: float | None = None) -> str:
    """Read checkout identity with bounded Git execution and no shell expansion."""
    git_binary = shutil.which("git")
    if git_binary is None:
        fail("git_runtime_missing", "checkout")
    remaining = 10.0 if deadline is None else min(10, deadline - monotonic())
    if remaining <= 0:
        raise subprocess.TimeoutExpired(args, 10)
    completed = subprocess.run(  # noqa: S603 - resolved Git binary and argument arrays
        [git_binary, "-C", str(checkout), *args],
        capture_output=True,
        text=True,
        timeout=remaining,
        check=True,
    )
    return completed.stdout.strip()


def validate_assembly(assembly: Assembly, workspace: Path, catalog_digest: str) -> None:
    """Require clean actual checkouts, trees, lockfiles and full release membership."""
    unique_ids(tuple(component.repository for component in assembly.components), "components")
    unique_ids(tuple(provider.id for provider in assembly.providers), "providers")
    names = {component.repository for component in assembly.components}
    required = (
        REQUIRED_COMPONENTS
        if assembly.kind == "composed"
        else {"shared-contracts", "integration-evals"}
    )
    if not required.issubset(names):
        fail("missing_component_pin", "assembly")
    if (
        assembly.kind == "composed" and assembly.owner != "getticketstub.com"
    ) or assembly.owner not in names:
        fail("manifest_owner_mismatch", "assembly")
    validate_environment(assembly, workspace)
    if assembly.fixture_digest != catalog_digest:
        fail("catalog_pin_mismatch", "assembly")
    if assembly.contract_artifact_path is None:
        fail("canonical_artifact_unavailable", "shared-contracts")
    canonical = confined_path(workspace / "shared-contracts", assembly.contract_artifact_path)
    if digest(read_bytes(canonical)) != assembly.contract_digest:
        fail("canonical_artifact_pin_mismatch", "shared-contracts")
    for component in assembly.components:
        validate_component(component, workspace)
    integration = next(c for c in assembly.components if c.repository == "integration-evals")
    if integration.revision != assembly.integration_revision:
        fail("integration_pin_mismatch", "assembly")


def validate_component(component: Component, workspace: Path) -> None:
    """Verify one actual source tree and its lockfile without resolving moving refs."""
    checkout = confined_path(workspace, component.repository)
    if git_value(checkout, "rev-parse", "HEAD") != component.revision:
        fail("checkout_pin_mismatch", component.repository)
    if git_value(checkout, "rev-parse", "HEAD^{tree}") != component.tree:
        fail("checkout_tree_mismatch", component.repository)
    if git_value(checkout, "status", "--porcelain", "--untracked-files=all"):
        fail("dirty_release", component.repository)
    lockfile = confined_path(checkout, component.lockfile_path)
    if digest(read_bytes(lockfile)) != component.lockfile_digest:
        fail("lockfile_pin_mismatch", component.repository)


def validate_environment(assembly: Assembly, workspace: Path) -> None:
    """Enforce actual interpreter identity and hash real configuration bytes before dispatch."""
    if assembly.runtime != sys.version:
        fail("runtime_pin_mismatch", "assembly")
    if assembly.configuration_artifact_path is None:
        fail("configuration_artifact_missing", "assembly")
    if assembly.configuration_component not in {
        component.repository for component in assembly.components
    }:
        fail("configuration_owner_missing", "assembly")
    root = confined_path(workspace, assembly.configuration_component)
    data = read_bytes(confined_path(root, assembly.configuration_artifact_path))
    reject_leaks(data, "configuration")
    if digest(data) != assembly.configuration_digest:
        fail("configuration_pin_mismatch", "assembly")


def source_fingerprint(repository: Path) -> str:
    """Hash current tracked and nonignored source bytes, including uncommitted work."""
    files = git_value(repository, "ls-files", "-c", "-o", "--exclude-standard").splitlines()
    records = [
        f"{name}:{digest(read_bytes(confined_path(repository, name)))}"
        for name in sorted(set(files))
        if (repository / name).is_file()
    ]
    return digest("\n".join(records).encode())
