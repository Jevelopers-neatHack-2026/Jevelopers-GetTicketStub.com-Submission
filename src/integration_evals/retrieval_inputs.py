"""Authorize only the reviewed retrieval fixture and stage its complete input closure."""

from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal

from integration_evals.artifacts import confined_path, digest, load_record, read_bytes
from integration_evals.contracts import runtime_digest
from integration_evals.errors import fail
from integration_evals.execution import OwnerContext
from integration_evals.models import Case, Catalog, Component, Mode, Record, Revision
from integration_evals.process_inputs import InputFile, copy_input, copy_tracked_inputs
from integration_evals.process_network import OfflineNetwork
from integration_evals.validation import git_value, validate_assembly

COMMAND_ARGUMENTS: Final = 4
PROFILE_PATH: Final = "src/integration_evals/retrieval-profile.json"
MODULES: Final = (
    "retrieval_adapter.mjs",
    "retrieval_probe.mjs",
    "retrieval_wire.mjs",
    "retrieval_resolver.mjs",
    "retrieval_budgets.mjs",
    "retrieval_concurrency.mjs",
    "retrieval_tls.mjs",
    "retrieval_handshake.mjs",
    "retrieval_dns_wire.mjs",
    "retrieval_dns_fixture.mjs",
)


class RetrievalProfile(Record):
    """Reviewed fixture scope, never a generic transport permission."""

    case_id: Literal["ssrf-egress"]
    mode: Literal["mock-only"]
    producer_revision: Revision
    node_version: Literal["22.23.3"]


@dataclass(frozen=True, slots=True)
class OwnerInputs:
    """Execution paths kept alive through both owner run and bounded cleanup."""

    checkout: Path
    command: tuple[str, ...]
    cleanup_command: tuple[str, ...]
    configuration: Path
    network: OfflineNetwork = OfflineNetwork.DENY
    environment: tuple[tuple[str, str], ...] = ()


class RetrievalInputRecord(Record):
    """Evaluator-owned staging provenance, separate from owner-produced business evidence."""

    run_id: str
    case_id: Literal["ssrf-egress"]
    producer_revision: Revision
    evaluator_revision: Revision
    runtime_sha256: str
    files: tuple[InputFile, ...]


def prepare_owner_inputs(
    case: Case, context: OwnerContext, component: Component, root: Path
) -> OwnerInputs:
    """Authenticate the evaluator fixture before granting private IP and staging its inputs."""
    settings, assembly = context.settings, context.assembly
    repository = settings.workspace / "integration-evals"
    configuration = (
        settings.workspace
        / assembly.configuration_component
        / (assembly.configuration_artifact_path or "")
    )
    adapter = repository / "src/integration_evals/retrieval_adapter.mjs"
    command = component.command
    if not command[1:] or Path(command[1]).absolute() != adapter.absolute():
        return OwnerInputs(
            settings.workspace / component.repository,
            command,
            component.cleanup_command,
            configuration,
        )
    if (
        settings.mode is not Mode.MOCK
        or case.id != "ssrf-egress"
        or component.repository != "event-intelligence"
        or assembly.kind != "component"
        or assembly.owner != "integration-evals"
        or assembly.selected_cases != (case.id,)
        or assembly.configuration_component != "integration-evals"
        or assembly.configuration_artifact_path != PROFILE_PATH
        or len(command) != COMMAND_ARGUMENTS
        or command[2] != "--runtime-sha256"
        or not Path(command[0]).is_absolute()
        or component.cleanup_command != (*command, "--cleanup")
    ):
        fail("retrieval_fixture_identity_rejected", case.id)
    catalog = load_record(repository / "fixtures/catalog.json", Catalog)
    validate_assembly(assembly, settings.workspace, digest(catalog.model_dump_json().encode()))
    tracked = frozenset(git_value(repository, "ls-files", "-z").split("\0"))
    required = {
        PROFILE_PATH,
        "fixtures/catalog.json",
        "fixtures/data/source-negative.txt",
        *(f"src/integration_evals/{name}" for name in MODULES),
    }
    if not required.issubset(tracked):
        fail("retrieval_input_not_tracked", case.id)
    profile = load_record(configuration, RetrievalProfile)
    if profile.producer_revision != component.revision or profile.case_id != case.id:
        fail("retrieval_fixture_profile_rejected", case.id)
    files = list(
        copy_tracked_inputs(settings.workspace / component.repository, root, component.repository)
    )
    private = ".integration-evals-inputs"
    if (root / private).exists():
        fail("retrieval_snapshot_collision", case.id)
    node = Path(command[0]).resolve(strict=True)
    files.append(copy_input(node, root, f"{private}/node", command[3], "node-runtime"))
    trusted = Path(__file__).resolve().parent
    for name in MODULES:
        relative = f"src/integration_evals/{name}"
        files.append(
            copy_input(
                repository / relative,
                root,
                f"{private}/{relative}",
                digest(read_bytes(trusted / name)),
                f"integration-evals/{relative}",
            )
        )
    files.append(
        copy_input(
            configuration,
            root,
            f"{private}/{PROFILE_PATH}",
            assembly.configuration_digest,
            f"integration-evals/{PROFILE_PATH}",
        )
    )
    negative = next((item for item in catalog.fixtures if item.id == "source-negative"), None)
    if (
        negative is None
        or negative.path != "data/source-negative.txt"
        or "source-negative" not in case.fixtures
    ):
        fail("retrieval_fixture_catalog_rejected", case.id)
    for name, expected in (
        ("fixtures/catalog.json", digest(read_bytes(repository / "fixtures/catalog.json"))),
        ("fixtures/data/source-negative.txt", negative.sha256),
    ):
        files.append(
            copy_input(
                repository / name, root, f"{private}/{name}", expected, f"integration-evals/{name}"
            )
        )
    openssl = Path("/etc/ssl/openssl.cnf").resolve(strict=True)
    files.append(
        copy_input(
            openssl,
            root,
            f"{private}/openssl.cnf",
            runtime_digest(openssl),
            "os:/etc/ssl/openssl.cnf",
        )
    )
    validate_assembly(assembly, settings.workspace, digest(catalog.model_dump_json().encode()))
    if runtime_digest(node) != command[3]:
        fail("retrieval_runtime_changed", case.id)
    receipt = RetrievalInputRecord(
        run_id=context.run_id,
        case_id="ssrf-egress",
        producer_revision=component.revision,
        evaluator_revision=assembly.integration_revision,
        runtime_sha256=command[3],
        files=tuple(files),
    )
    destination = confined_path(
        settings.artifacts, f"input-staging/{context.run_id}/ssrf-egress.json"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("x", encoding="utf-8") as output:
        _ = output.write(receipt.model_dump_json(indent=2))
    staged_command = (
        str(root / private / "node"),
        str(root / private / "src/integration_evals/retrieval_adapter.mjs"),
        *command[2:],
    )
    return OwnerInputs(
        root,
        staged_command,
        (*staged_command, "--cleanup"),
        root / private / PROFILE_PATH,
        OfflineNetwork.RETRIEVAL,
        (("OPENSSL_CONF", str(root / private / "openssl.cnf")), ("PATH", "/usr/bin:/bin")),
    )
