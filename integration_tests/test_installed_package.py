import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Literal, assert_never

import pytest
from typer.testing import CliRunner

from integration_evals.artifacts import load_record
from integration_evals.cli import app
from integration_evals.contract_package import InstalledPackage, verify_installed_package
from integration_evals.contract_records import ContractPin, ContractReceipt, ContractRuntime
from integration_evals.errors import InvalidArtifactError


def record_probe(scenario: str, exit_code: int | None, diagnostic: str) -> None:
    """Retain sanitized binary observations when an evidence directory is requested."""
    destination = os.environ.get("IE_CONTRACT_EVIDENCE")
    if destination is None:
        return
    directory = Path(destination)
    directory.mkdir(parents=True, exist_ok=True)
    _ = (directory / (scenario + ".json")).write_text(
        json.dumps(
            {
                "scenario": scenario,
                "exit_code": exit_code,
                "diagnostic": diagnostic,
                "product_acceptance": "blocked",
            }
        )
        + "\n",
        encoding="utf-8",
    )


def installed_runtime() -> ContractRuntime:
    return load_record(Path(os.environ["IE_CONTRACT_INSTALLED_RUNTIME"]), ContractRuntime)


@pytest.mark.parametrize("candidate_scope", [False, True])
def test_installed_cli_consumes_complete_public_sdk(tmp_path: Path, candidate_scope: bool) -> None:
    # Given a lifecycle-disabled private installation with pinned archive bytes.
    output = tmp_path / "receipts"
    # When the real CLI imports the installed export map and executes installed fixtures.
    result = CliRunner().invoke(
        app,
        [
            "contracts",
            "--pin",
            "contracts/producer-pin.json",
            "--producer",
            os.environ["IE_CONTRACT_SOURCE"],
            "--runtime",
            os.environ["IE_CONTRACT_INSTALLED_RUNTIME"],
            "--output",
            str(output),
            *(["--candidate-scope"] if candidate_scope else []),
        ],
    )
    # Then installed execution is explicitly distinguished and every exact export passes.
    assert result.exit_code == 0, result.output
    receipt = load_record(next(output.glob("*/contracts.json")), ContractReceipt)
    assert receipt.execution_surface == "installed-package"
    assert receipt.execution == "passed"
    assert receipt.observation is not None
    assert len(receipt.observation.results) == 86
    assert sum(len(row.cases) for row in receipt.observation.results) == 1641
    assert receipt.missing_contracts == ()
    assert receipt.product_acceptance == "blocked"


@pytest.mark.parametrize("fault", ["archive", "installed", "extra"])
def test_private_package_rejects_substitution(
    tmp_path: Path, fault: Literal["archive", "installed", "extra"]
) -> None:
    # Given a separately owned copy of the authentic private package.
    runtime = installed_runtime()
    assert runtime.installation is not None
    root = tmp_path / "package"
    _ = shutil.copytree(runtime.installation.root, root)
    archive = tmp_path / "package.tgz"
    _ = shutil.copyfile(runtime.installation.archive, archive)
    pin = load_record(Path("contracts/producer-pin.json"), ContractPin)
    assert pin.package is not None
    match fault:
        case "archive":
            _ = archive.write_bytes(b"wrong archive")
        case "installed":
            _ = (root / "generated/index.mjs").write_text("export const corrupted = true;\n")
        case "extra":
            _ = (root / "foreign.mjs").write_text("export const foreign = true;\n")
        case _:
            assert_never(fault)
    # When the production guard checks installed bytes before any SDK import.
    with pytest.raises(InvalidArtifactError, match=r"contract_(archive|installed)_") as rejected:
        verify_installed_package(InstalledPackage(root, archive), pin.package)
    record_probe("reject-" + fault, None, str(rejected.value))
    # Then neither substituted archive nor post-install mutations can execute as reviewed code.


def run_node(
    runtime: ContractRuntime, arguments: tuple[str, ...]
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - pinned Node and task-owned fixed scenarios
        (runtime.path, *arguments), check=False, capture_output=True, text=True, timeout=30
    )


def test_consumer_caller_detects_corrupted_public_validator(tmp_path: Path) -> None:
    # Given an owned installed SDK with its actual public design validator forced to accept.
    runtime = installed_runtime()
    assert runtime.installation is not None
    root = tmp_path / "node_modules/@jevelopers/shared-contracts"
    _ = shutil.copytree(runtime.installation.root, root)
    target = root / "tooling/production-values.mjs"
    original = target.read_text()
    altered = original.replace(
        "export function checkTemplateSpec(input, scope) {",
        "export function checkTemplateSpec(input, scope) { return {ok:true,value:input};",
        1,
    )
    assert altered != original
    _ = target.write_text(altered)
    caller_root = Path(os.environ["IE_CONTRACT_CALLER_ROOT"])
    for name in ("installed-caller.mjs", "installed-scenarios.mjs"):
        _ = shutil.copyfile(caller_root / name, tmp_path / name)
    # When the same consumer-authored scenario calls the corrupted public validator directly.
    result = run_node(runtime, (str(tmp_path / "installed-scenarios.mjs"),))
    # Then the controlled negative catches lost hash validation, independently of archive guards.
    assert result.returncode == 1
    assert "design-content-corruption" in result.stderr
    record_probe("corrupt-public-validator", result.returncode, "design-content-corruption")


def test_real_consumer_calls_supported_pure_checks() -> None:
    # Given the strictly compiled consumer binding and the exact installed SDK.
    runtime = installed_runtime()
    caller = Path(os.environ["IE_CONTRACT_CALLER_ROOT"]) / "installed-scenarios.mjs"
    # When the consumer executes positive and controlled negative domain calls.
    result = run_node(runtime, (str(caller),))
    # Then all caller assertions pass; SDK acceptance never becomes release authority.
    assert result.returncode == 0, result.stderr
    assert '"surface":"installed-public-sdk-consumer"' in result.stdout


def test_generated_readonly_binding_rejects_consumer_mutation(tmp_path: Path) -> None:
    # Given actual generated readonly bindings resolved from the installed package.
    runtime = installed_runtime()
    assert runtime.installation is not None
    package = tmp_path / "node_modules/@jevelopers"
    package.mkdir(parents=True)
    (package / "shared-contracts").symlink_to(runtime.installation.root, target_is_directory=True)
    source = tmp_path / "mutation.mts"
    _ = source.write_text("""import type { Composition } from '@jevelopers/shared-contracts';
declare const value: Composition;
value.revision = 999;
""")
    # When an unsuppressed assignment is submitted to the pinned strict compiler.
    result = run_node(
        runtime,
        (
            os.environ["IE_CONTRACT_TYPESCRIPT"],
            "--noEmit",
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            str(source),
        ),
    )
    # Then TypeScript rejects writing a generated readonly field, not a missing dependency.
    assert result.returncode == 2
    assert "TS2540" in result.stdout
    assert "read-only property" in result.stdout
    record_probe(
        "readonly-mutation", result.returncode, result.stdout.split("error ", 1)[1].strip()
    )
