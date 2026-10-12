"""Independent joins over the retained producer bytes, not response booleans alone."""

import json
from pathlib import Path

from pydantic import JsonValue, TypeAdapter

from integration_evals.artifacts import digest, load_record, read_bytes
from integration_evals.models import Run
from integration_evals.print_setup import CONFIGURATION_PATH, PROFILE_PATH, PrintProfile


def assert_outcome(run: Run, archive: Path, repository: Path) -> None:
    # Given evidence already retained independently by the evaluator before cleanup.
    profile = load_record(repository / PROFILE_PATH, PrintProfile)
    files = {Path(item.path).name: item for item in run.evidence}
    assert set(files) == {"trace.json", "mapping.json", "evaluation.json"}
    assert len(run.evidence) == 6
    expected = {
        (requirement, kind)
        for requirement in ("ART-04", "IE-05D.AC1")
        for kind in ("trace", "evaluation", "checkpoint")
    }
    assert {(item.requirement, item.kind) for item in run.evidence} == expected
    records: dict[str, dict[str, JsonValue]] = {}
    for name, item in files.items():
        data = read_bytes(archive / item.path)
        assert digest(data) == item.sha256
        records[name] = TypeAdapter(dict[str, JsonValue]).validate_json(data)
    # When independently joining the typed product error, SQL counts, runtime and source.
    trace, mapping, evaluation = (
        records[name] for name in ("trace.json", "mapping.json", "evaluation.json")
    )
    assert trace["source"] == mapping["source"] == evaluation["source"]
    source = TypeAdapter(dict[str, JsonValue]).validate_python(trace["source"])
    assert source["revision"] == profile.revision
    assert source["tree"] == profile.tree
    assert trace["run_id"] == evaluation["run_id"] == run.id
    assert trace["case_id"] == evaluation["case_id"] == "print-invalid"
    assert trace["operation"] == "composeArtifact"
    result = TypeAdapter(dict[str, JsonValue]).validate_python(trace["result"])
    error = TypeAdapter(dict[str, JsonValue]).validate_python(result["error"])
    assert result["ok"] is False
    assert error["code"] == "PREFLIGHT_FAILED"
    assert error["blocking_condition"] == "preflight"
    resolutions = trace["asset_resolutions"]
    assert type(resolutions) is int
    assert resolutions >= 2
    empty = {"publications": 0, "files": 0, "staged_files": 0, "blobs": 0}
    assert trace["before"] == trace["after"] == evaluation["production_state"] == empty
    assert trace["attempts"]
    assert trace["observations"]
    assert evaluation["observations"] == {"typed_rejection": True, "production_artifacts": 0}
    assert evaluation["trace_sha256"] == files["trace.json"].sha256
    assert evaluation["mapping_sha256"] == trace["mapping_sha256"] == files["mapping.json"].sha256
    config_hash = digest(read_bytes(repository / CONFIGURATION_PATH))
    assert mapping["configuration_sha256"] == evaluation["configuration_sha256"] == config_hash
    payload_hash = digest(read_bytes(repository / "fixtures/data/asset-negative.txt"))
    assert mapping["payload_sha256"] == trace["payload_sha256"] == payload_hash
    assert mapping["approval_authority"] is False
    assert mapping["financial_authority"] is False
    assert mapping["canonical_request"]
    assert mapping["canonical_records"]
    assert mapping["profile"]
    assert (
        mapping["original_collected_at"]
        == trace["original_fixture_collected_at"]
        == "2026-10-10T00:00:00Z"
    )
    assert trace["logical_scenario_clock"] == run.clock.isoformat()
    assert_runtime(evaluation["runtime_receipt"], repository)
    # Then all six claims retain their original logical clock and limited authority.
    assert all(item.created_at == item.original_cutoff == run.clock for item in run.evidence)
    assert evaluation["accepted"] is False
    assert evaluation["cost"] is None
    assert evaluation["cost_status"] == "unknown"
    _ = (archive / "consumer-joins.json").write_text(
        json.dumps(
            {
                "run_id": run.id,
                "files": {name: item.sha256 for name, item in files.items()},
                "source": profile.revision,
                "product_acceptance": "blocked",
                "checks": "passed",
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def assert_runtime(value: JsonValue, repository: Path) -> None:
    profile = load_record(repository / PROFILE_PATH, PrintProfile)
    receipt = TypeAdapter(dict[str, JsonValue]).validate_python(value)
    assert receipt["version"] == "v24.21.0"
    measurements = TypeAdapter(list[dict[str, JsonValue]]).validate_python(
        receipt["measured_mapping"]
    )
    assert len(measurements) == 1
    configuration = TypeAdapter(dict[str, JsonValue]).validate_python(
        measurements[0]["configuration"]
    )
    environment = TypeAdapter(dict[str, JsonValue]).validate_python(configuration["environment"])
    assert environment["profile"] == "pinned-linux-ci"
    assert environment["platform"] == "linux"
    assert environment["arch"] == "x64"
    assert environment["image"] == profile.image
    assert environment["node"] == profile.node_version
    assert environment["npm"] == profile.npm_version
    assert configuration["binary"] == profile.browser_sha256
    security = TypeAdapter(dict[str, JsonValue]).validate_python(environment["containerSecurity"])
    assert security["capabilities"] == "none"
    assert security["noNewPrivileges"] is True
    assert security["seccomp"] == "filter"
    assert security["apparmor"] == "docker-default (enforce)"
    assert security["interfaces"] == ["lo"]
    assert security["networkNamespace"] != str(Path("/proc/self/ns/net").readlink())
    shared_memory = TypeAdapter(int).validate_python(security["shmBytes"], strict=True)
    assert shared_memory >= 1073741824
    config = TypeAdapter(dict[str, JsonValue]).validate_json(
        read_bytes(repository / CONFIGURATION_PATH)
    )
    assert receipt["sha256"] == config["node_sha256"]
