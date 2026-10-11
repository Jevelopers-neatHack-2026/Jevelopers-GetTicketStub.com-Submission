"""Fake-only protocol and validation checks for the fixed OPS owner.

These tests use standard-library temporary files only. They never launch or
signal a process group and do not invoke npm, Make, Node, a fixture, or CI.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


OWNER_PATH = Path(__file__).with_name("run_ops_owned_command.py")
SPEC = importlib.util.spec_from_file_location("ops_owned_command_under_test", OWNER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("owner source unavailable")
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)


def receipt(route: str) -> dict[str, object]:
    return {
        "schema": OWNER.RECEIPT_SCHEMA,
        "route": route,
        "argvClass": OWNER.ROUTES[route]["argvClass"],
        "commandExitCode": 0,
        "wrapperExitCode": 0,
        "timeoutStage": "none",
        "escalationStage": "none",
        "commandDirectReaped": True,
        "commandGroupAbsent": True,
        "watchdogReaped": True,
        "watchdogGroupAbsent": True,
        "outerRegistryEmpty": True,
        "localRegistryEmpty": True,
        "sidecarsReconciled": True,
        "outputOverflow": False,
        "captureReadFailed": False,
        "elapsedMs": 20,
        "elapsedCapped": False,
        "groupsObserved": 0,
        "sidecarsObserved": 0,
        "sidecarsReconciledCount": 0,
        "pendingLaunchesRemaining": 0,
        "stdout": {"bytes": 0, "sha256": hashlib.sha256(b"").hexdigest()},
        "stderr": {"bytes": 0, "sha256": hashlib.sha256(b"").hexdigest()},
    }


class RouteValidationTests(unittest.TestCase):
    def test_exact_route_vectors_only(self) -> None:
        for route in OWNER.ROUTE_IDS:
            self.assertEqual(OWNER.parse_route_args(["--route", route]), route)
        self.assertIsNone(OWNER.parse_route_args(["--route", "npm", "test"]))
        self.assertIsNone(OWNER.parse_route_args(["--route", "runtime-foundation", "extra"]))
        self.assertIsNone(OWNER.parse_route_args(["--route", "unknown"]))

    def test_registry_bounds_and_types(self) -> None:
        valid = {"schema": OWNER.REGISTRY_SCHEMA, "groups": list(range(2, 18)), "pendingLaunches": []}
        self.assertEqual(len(OWNER.validate_registry_value(valid)["groups"]), 16)
        oversized = {**valid, "groups": list(range(2, 19))}
        with self.assertRaises(OWNER.OwnerFailure):
            OWNER.validate_registry_value(oversized)
        malformed = {"schema": OWNER.REGISTRY_SCHEMA, "groups": [True], "pendingLaunches": []}
        with self.assertRaises(OWNER.OwnerFailure):
            OWNER.validate_registry_value(malformed)
        duplicate = {"schema": OWNER.REGISTRY_SCHEMA, "groups": [123, 123], "pendingLaunches": []}
        with self.assertRaises(OWNER.OwnerFailure):
            OWNER.validate_registry_value(duplicate)

    def test_duplicate_json_keys_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            OWNER.strict_json_bytes(b'{"schema":"first","schema":"second"}')

    def test_receipt_requires_exact_fixed_shape(self) -> None:
        candidate = receipt("runtime-foundation")
        self.assertTrue(OWNER.validate_receipt_value(candidate, "runtime-foundation"))
        candidate["privatePath"] = "/private/location"
        self.assertFalse(OWNER.validate_receipt_value(candidate, "runtime-foundation"))

    def test_sidecar_discovery_distinguishes_local_registry_namespace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            tmp_root = Path(temporary)
            retry_dir = tmp_root / "ah11-ops-temp-custody-retry-fixture"
            retry_dir.mkdir(mode=0o700)
            os.chmod(retry_dir, 0o700)
            registry_path = retry_dir / "owned-groups.json"
            registry = {"schema": OWNER.REGISTRY_SCHEMA, "groups": [], "pendingLaunches": []}
            registry_path.write_text(json.dumps(registry) + "\n", encoding="utf-8")
            os.chmod(registry_path, 0o600)
            directory_text = str(retry_dir)
            tag = hashlib.sha256(directory_text.encode("utf-8")).hexdigest()[:16]
            sidecar_path = retry_dir / (
                f"owned-groups.json.temp-custody.{os.getpid()}.{tag}.json"
            )
            sidecar = {
                "schema": OWNER.SIDECAR_SCHEMA,
                "ownerPid": os.getpid(),
                "directory": directory_text,
                "launches": [{
                    "launchToken": "00000000-0000-4000-8000-000000000001",
                    "status": "launch_intent",
                    "spawnAttempted": False,
                    "directPid": None,
                    "groupId": None,
                    "registryRegistered": False,
                    "registryCleared": False,
                    "groupAbsent": False,
                }],
            }
            sidecar_path.write_text(json.dumps(sidecar) + "\n", encoding="utf-8")
            os.chmod(sidecar_path, 0o600)
            record = OWNER.validate_sidecar_value(
                sidecar_path.read_bytes(), sidecar_path, registry_path, tmp_root, os.getpid()
            )
            self.assertEqual(record["namespace"], "local")

    def test_sidecar_rejects_retry_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            tmp_root = Path(temporary)
            outside = tmp_root.parent / f"{tmp_root.name}-outside"
            outside.mkdir(mode=0o700)
            try:
                registry_dir = tmp_root / "registry"
                registry_dir.mkdir(mode=0o700)
                registry_path = registry_dir / "owned-groups.json"
                registry_path.write_text(
                    json.dumps({"schema": OWNER.REGISTRY_SCHEMA, "groups": [], "pendingLaunches": []}),
                    encoding="utf-8",
                )
                os.chmod(registry_path, 0o600)
                tag = hashlib.sha256(str(outside).encode("utf-8")).hexdigest()[:16]
                sidecar_path = registry_dir / (
                    f"owned-groups.json.temp-custody.{os.getpid()}.{tag}.json"
                )
                value = {
                    "schema": OWNER.SIDECAR_SCHEMA,
                    "ownerPid": os.getpid(),
                    "directory": str(outside),
                    "launches": [{
                        "launchToken": "00000000-0000-4000-8000-000000000002",
                        "status": "launch_intent",
                        "spawnAttempted": False,
                        "directPid": None,
                        "groupId": None,
                        "registryRegistered": False,
                        "registryCleared": False,
                        "groupAbsent": False,
                    }],
                }
                with self.assertRaises(OWNER.OwnerFailure):
                    OWNER.validate_sidecar_value(
                        json.dumps(value).encode(), sidecar_path, registry_path, tmp_root, os.getpid()
                    )
            finally:
                outside.rmdir()

    def test_unregistered_group_needs_durable_absence_and_registry_proof(self) -> None:
        row = {
            "launchToken": "00000000-0000-4000-8000-000000000003",
            "spawnAttempted": True,
            "directPid": 1234,
            "groupId": 1234,
            "registryRegistered": False,
            "registryCleared": False,
            "groupAbsent": False,
        }
        record = {"namespace": "outer", "launches": [row]}
        registry_result = {"empty": True, "groupsAbsent": set()}
        original_registry = {"groups": [], "pendingLaunches": []}
        self.assertFalse(OWNER.sidecar_rows_resolved(
            [record], "outer", registry_result, original_registry
        ))
        row["registryCleared"] = True
        row["groupAbsent"] = True
        self.assertTrue(OWNER.sidecar_rows_resolved(
            [record], "outer", registry_result, original_registry
        ))

    def test_reaped_command_leader_still_cleans_live_descendant_group_once(self) -> None:
        pgid = 43210
        cleanup_result = {
            "term": {pgid: "sent"},
            "kill": {},
            "allAbsent": True,
        }
        with (
            patch.object(OWNER, "group_exists", return_value=True) as group_exists,
            patch.object(OWNER, "cleanup_groups", return_value=cleanup_result) as cleanup_groups,
            patch.object(OWNER, "wait_groups", return_value={pgid: False}) as wait_groups,
            patch.object(OWNER, "wait_process") as wait_process,
        ):
            command_exit, command_reaped, group_absent, escalation = OWNER.cleanup_target_group(
                pgid, None, 0, True
            )

        self.assertEqual((command_exit, command_reaped, group_absent, escalation),
                         (0, True, True, "term"))
        group_exists.assert_called_once_with(pgid)
        cleanup_groups.assert_called_once_with(
            [pgid], OWNER.TERM_WAIT_MS, OWNER.KILL_WAIT_MS
        )
        wait_groups.assert_called_once_with([pgid], OWNER.TARGET_RECHECK_MS)
        wait_process.assert_not_called()
        bounded_wait_ms = OWNER.TERM_WAIT_MS + OWNER.KILL_WAIT_MS + OWNER.TARGET_RECHECK_MS
        self.assertEqual(bounded_wait_ms, 1_750)


if __name__ == "__main__":
    unittest.main()
