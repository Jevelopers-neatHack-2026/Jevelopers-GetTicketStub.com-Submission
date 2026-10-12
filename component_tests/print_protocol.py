"""Protocol controls use the same bounded evaluator invocation as the owner runner."""

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import IO, Literal, assert_never

from pydantic import JsonValue, TypeAdapter

from integration_evals.artifacts import load_record, read_bytes
from integration_evals.contract_records import ContractRuntime
from integration_evals.execution import OwnerContext, Settings
from integration_evals.models import Assembly, Outcome, Suite
from integration_evals.output_evidence import retain
from integration_evals.owner import compare_response
from integration_evals.print_setup import CONFIGURATION_PATH, PrintConfiguration
from integration_evals.processes import ProcessSettings, TestInvocation, invoke
from integration_evals.reporting import OwnerResponse

Mutation = Literal[
    "schema", "hash", "runtime", "case", "mode", "replay", "cleanup-lock", "positive"
]


@dataclass(frozen=True, slots=True)
class Invocation:
    """One strictly isolated request and its existing evaluator process settings."""

    workspace: Path
    home: Path
    mutation: Mutation
    test_invocation: TestInvocation | None = None

    def settings(self, stdout: IO[bytes]) -> ProcessSettings:
        repository = self.workspace / "integration-evals"
        config_path = repository / CONFIGURATION_PATH
        config = load_record(config_path, PrintConfiguration)
        suite = load_record(repository / "scenarios/suite.json", Suite)
        case = next(case for case in suite.cases if case.id == "print-invalid")
        environment = {
            "PATH": os.environ["PATH"],
            "HOME": str(self.home),
            "TMPDIR": str(self.home),
            "IE_NAMESPACE": "print-protocol-print-invalid",
            "IE_MODE": "mock-only",
            "IE_SEED": "17",
            "IE_CLOCK": "2026-10-10T00:00:00+00:00",
            "IE_ARTIFACT_DIR": str(self.home / "artifacts"),
            "PP_RENDERER_IMAGE": config.renderer_image,
        }
        match self.mutation:
            case "schema" | "hash" | "runtime":
                raw = TypeAdapter(dict[str, JsonValue]).validate_json(config.model_dump_json())
                match self.mutation:
                    case "schema":
                        raw["accepted"] = True
                    case "hash":
                        raw["node_sha256"] = "0" * 64
                    case "runtime":
                        raw["renderer_image"] = "unapproved-image"
                    case _:
                        assert_never(self.mutation)
                config_path = self.home / "configuration.json"
                _ = config_path.write_text(json.dumps(raw), encoding="utf-8")
            case "case":
                case = case.model_copy(update={"id": "print-preflight"})
            case "mode":
                environment["IE_MODE"] = "live"
            case "replay" | "cleanup-lock" | "positive":
                pass
            case _:
                assert_never(self.mutation)
        payload = json.dumps(
            {
                "case": case.model_dump(mode="json"),
                "run_id": "print-protocol",
                "component_revision": "0ef7398bb94caacf6b48068747142883470fbdaf",
                "configuration_artifact": str(config_path),
                "artifact_directory": str(self.home / "artifacts"),
                "namespace": "print-protocol-print-invalid",
                "seed": 17,
                "clock": environment["IE_CLOCK"],
                "providers": [],
            }
        ).encode()
        return ProcessSettings(
            self.workspace / "print-production",
            environment,
            payload,
            stdout,
            30,
            offline=True,
            writable_directory=self.home,
            test_invocation=self.test_invocation,
        )

    def retain(self, data: bytes, destination: Path) -> JsonValue:
        """Validate every successful owner claim and copy all files before cleanup."""
        repository = self.workspace / "integration-evals"
        suite = load_record(repository / "scenarios/suite.json", Suite)
        case = next(case for case in suite.cases if case.id == "print-invalid")
        assembly = load_record(self.workspace / "assembly.json", Assembly)
        context = OwnerContext(
            assembly,
            Settings(
                repository,
                self.workspace,
                self.workspace / "assembly.json",
                artifact_root=destination / self.mutation,
            ),
            "print-protocol",
            datetime.fromisoformat("2026-10-10T00:00:00+00:00"),
        )
        response = OwnerResponse.model_validate_json(data)
        outcome, reason = compare_response(case, response, context)
        assert outcome is Outcome.PASSED, reason
        evidence = retain(case, context, response.evidence, self.home / "artifacts")
        assert len(evidence) == 6
        return TypeAdapter(JsonValue).validate_json(
            response.model_copy(update={"evidence": evidence}).model_dump_json()
        )


def protocol_control(
    workspace: Path,
    mutation: Mutation,
    destination: Path,
    *,
    test_invocation: TestInvocation | None = None,
) -> None:
    """Retain observations even when an actual unsupported Linux runtime fails."""
    runtime = load_record(Path(os.environ["IE_PRINT_RUNTIME"]), ContractRuntime)
    command = (runtime.path, "dist/scripts/integration-evals/cli.js")
    capture: dict[str, JsonValue] = {"scenario": mutation, "cost": None, "cost_status": "unknown"}
    destination.mkdir(parents=True, exist_ok=True)
    try:
        with TemporaryDirectory(prefix="print-protocol-") as directory:
            home = Path(directory).resolve()
            (home / "artifacts").mkdir()
            invocation = Invocation(workspace, home, mutation, test_invocation)
            with (home / "stdout").open("w+b") as stdout:
                settings = invocation.settings(stdout)
                run_command = (
                    (runtime.path, "dist/tests/fixtures/integration-evals/positive-control.js")
                    if mutation == "positive"
                    else (*command, "run")
                )
                owned = home / "artifacts/pp-print-protocol-print-invalid"
                try:
                    capture["run_exit"] = invoke(run_command, settings)
                    data = read_bytes(home / "stdout")
                    if data:
                        capture["response"] = TypeAdapter(JsonValue).validate_json(data)
                    capture["namespace_claimed"] = owned.exists()
                    if mutation in {"replay", "cleanup-lock"}:
                        assert capture["run_exit"] == 0
                        capture["retained_response"] = invocation.retain(data, destination)
                        if mutation == "replay":
                            before = read_bytes(owned / "evaluation.json")
                            capture["replay_exit"] = invoke((*command, "run"), settings)
                            assert capture["replay_exit"] != 0
                            assert read_bytes(owned / "evaluation.json") == before
                        else:
                            _ = (owned / ".cleanup-lock").write_text(
                                "interrupted", encoding="utf-8"
                            )
                finally:
                    _ = stdout.seek(0)
                    _ = stdout.truncate()
                    capture["cleanup_exit"] = invoke((*command, "cleanup"), settings)
                    cleanup = read_bytes(home / "stdout")
                    if cleanup:
                        capture["cleanup_response"] = TypeAdapter(JsonValue).validate_json(cleanup)
                    if mutation == "replay" and capture.get("run_exit") == 0:
                        capture["marker_retained"] = (owned / "owner.json").is_file()
                        _ = stdout.seek(0)
                        _ = stdout.truncate()
                        capture["repeat_cleanup_exit"] = invoke((*command, "cleanup"), settings)
                        capture["repeat_cleanup_response"] = TypeAdapter(JsonValue).validate_json(
                            read_bytes(home / "stdout")
                        )
    finally:
        _ = (destination / f"{mutation}.json").write_text(
            json.dumps(capture, indent=2), encoding="utf-8"
        )
    assert_control(TypeAdapter(JsonValue).validate_python(capture), mutation)


def assert_control(value: JsonValue, mutation: Mutation) -> None:
    capture = TypeAdapter(dict[str, JsonValue]).validate_python(value)
    match mutation:
        case "schema" | "hash" | "runtime" | "case" | "mode":
            assert capture["run_exit"] != 0
            assert "response" not in capture
            assert capture["namespace_claimed"] is False
        case "cleanup-lock":
            assert capture["cleanup_exit"] != 0
        case "replay":
            assert capture["marker_retained"] is True
            assert capture["cleanup_exit"] == capture["repeat_cleanup_exit"] == 0
            cleanup = TypeAdapter(dict[str, JsonValue]).validate_python(capture["cleanup_response"])
            assert cleanup["status"] == "removed"
            assert cleanup["retained"] == ["owner.json"]
            repeat = TypeAdapter(dict[str, JsonValue]).validate_python(
                capture["repeat_cleanup_response"]
            )
            assert repeat["removed"] == []
        case "positive":
            assert capture["run_exit"] == 0
            response = TypeAdapter(dict[str, JsonValue]).validate_python(capture["response"])
            result = TypeAdapter(dict[str, JsonValue]).validate_python(response["result"])
            assert result["ok"] is True
            assert response["publications"] == 1
            files = TypeAdapter(list[dict[str, JsonValue]]).validate_python(response["files"])
            assert files
            assert all(file["stored_hash"] == file["actual_hash"] for file in files)
            assert capture["cleanup_exit"] == 0
        case _:
            assert_never(mutation)
