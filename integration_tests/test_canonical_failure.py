import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import ClassVar

from pydantic import ConfigDict
from typer.testing import CliRunner

from integration_evals.artifacts import digest, load_record, read_bytes
from integration_evals.cli import app
from integration_evals.contract_records import ContractPin, ContractReceipt, ContractRuntime
from integration_evals.contract_sources import FixtureIndex
from integration_evals.errors import fail
from integration_evals.models import Record
from integration_evals.validation import git_value


class FixtureManifest(Record):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, strict=True, extra="ignore")
    files: dict[str, str]
    digest: str


def pin_owned_producer(producer: Path) -> Path:
    git = shutil.which("git")
    if git is None:
        fail("git_runtime_missing", "canonical-integration-test")
    for command in (
        ("init",),
        ("add", "."),
        (
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@evals.example",
            "commit",
            "-m",
            "controlled conformance fault",
        ),
    ):
        _ = subprocess.run(  # noqa: S603 - fixed Git arguments in an owned test copy
            (git, "-C", str(producer), *command), check=True, capture_output=True, timeout=30
        )
    pin = ContractPin(
        revision=git_value(producer, "rev-parse", "HEAD"),
        tree=git_value(producer, "rev-parse", "HEAD^{tree}"),
        lockfile_digest=digest(read_bytes(producer / "package-lock.json")),
        schema_manifest_digest=digest(read_bytes(producer / "generated/schema-manifest.json")),
        fixture_manifest_digest=digest(read_bytes(producer / "generated/fixture-manifest.json")),
        catalog_digest=digest(read_bytes(producer / "docs/contract-catalog.md")),
        node_version="22.23.3",
    )
    pin_path = producer.parent / "pin.json"
    _ = pin_path.write_text(pin.model_dump_json(), encoding="utf-8")
    return pin_path


def test_canonical_cli_retains_failure_when_golden_expectation_disagrees(tmp_path: Path) -> None:
    # Given an owned copy of the actual canonical SDK with one contradictory golden expectation.
    source = Path(os.environ["IE_CONTRACT_SOURCE"])
    runtime = Path(os.environ["IE_CONTRACT_RUNTIME"])
    _ = load_record(runtime, ContractRuntime)
    producer = tmp_path / "producer"
    _ = shutil.copytree(source, producer, ignore=shutil.ignore_patterns(".git"))
    target = producer / "fixtures/CommonEnvelope.json"
    first_id = load_record(target, FixtureIndex).cases[0].id
    original = target.read_text(encoding="utf-8")
    assert '"ok": true' in original
    _ = target.write_text(original.replace('"ok": true', '"ok": false', 1), encoding="utf-8")
    fixture_path = producer / "generated/fixture-manifest.json"
    manifest = load_record(fixture_path, FixtureManifest)
    files = {
        **manifest.files,
        "fixtures/CommonEnvelope.json": "sha256:" + digest(read_bytes(target)),
    }
    canonical = json.dumps(
        files, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()
    changed = manifest.model_copy(
        update={"files": files, "digest": "sha256:" + hashlib.sha256(canonical).hexdigest()}
    )
    _ = fixture_path.write_text(changed.model_dump_json(), encoding="utf-8")
    pin_path = pin_owned_producer(producer)
    output = tmp_path / "receipts"
    # When the actual public CLI evaluates the original SDK against the controlled oracle fault.
    result = CliRunner().invoke(
        app,
        [
            "contracts",
            "--pin",
            str(pin_path),
            "--producer",
            str(producer),
            "--runtime",
            str(runtime),
            "--output",
            str(output),
            "--candidate-scope",
        ],
    )
    # Then it exits failed and retains the precise disagreement with acceptance still blocked.
    assert result.exit_code == 1, result.output
    receipt = load_record(next(output.glob("contracts-*/contracts.json")), ContractReceipt)
    assert receipt.execution == "failed", receipt.reason
    assert receipt.observation is not None
    envelope = next(row for row in receipt.observation.results if row.contract == "CommonEnvelope")
    assert envelope.failures == (first_id,)
    assert receipt.product_acceptance == "blocked"
