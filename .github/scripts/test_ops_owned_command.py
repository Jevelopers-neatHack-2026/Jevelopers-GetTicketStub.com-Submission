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
import threading
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


class ExitedProcess:
    def poll(self) -> int:
        return 0


class FakePipe:
    def __init__(self, chunks: list[bytes], *, hold_open_after_chunks: bool = False,
                 fail_read: bool = False):
        self.chunks = list(chunks)
        self.hold_open_after_chunks = hold_open_after_chunks
        self.fail_read = fail_read
        self.last_chunk_returned = threading.Event()
        self.release = threading.Event()

    def read1(self, _size: int) -> bytes:
        if self.fail_read:
            raise OSError("fake read failure")
        if self.chunks:
            chunk = self.chunks.pop(0)
            if not self.chunks:
                self.last_chunk_returned.set()
            return chunk
        if self.hold_open_after_chunks:
            self.release.wait()
        return b""


def private_file(path: Path, data: bytes = b"") -> None:
    path.write_bytes(data)
    os.chmod(path, 0o600)


def custody_sidecar(directory: Path, token: str, *, group_id: int | None = None,
                    registered: bool = False, cleared: bool = False,
                    group_absent: bool = False) -> dict[str, object]:
    return {
        "schema": OWNER.SIDECAR_SCHEMA,
        "ownerPid": os.getpid(),
        "directory": str(directory),
        "launches": [{
            "launchToken": token,
            "status": "launch_intent",
            "spawnAttempted": group_id is not None,
            "directPid": group_id,
            "groupId": group_id,
            "registryRegistered": registered,
            "registryCleared": cleared,
            "groupAbsent": group_absent,
        }],
    }


def valid_watchdog_result(pid: int, target_pgid: int | None,
                          control_state: str = "finish") -> dict[str, object]:
    acknowledged = target_pgid is not None
    target_cleanup = {
        "groups": [target_pgid] if acknowledged and control_state == "cleanup" else [],
        "final": {str(target_pgid): False} if acknowledged and control_state == "cleanup" else {},
        "allAbsent": True,
    }
    if not acknowledged or control_state == "finish":
        target_cleanup["not_needed"] = True
    return {
        "schema": "ops-owned-group-watchdog-result.v1",
        "pid": pid,
        "pgid": pid,
        "startedMonotonicNs": 1,
        "timedOut": False,
        "controlState": control_state,
        "targetPgid": target_pgid,
        "targetAckSent": acknowledged,
        "targetCleanup": target_cleanup,
        "registryError": None,
        "registeredGroupCleanup": {
            "groups": [], "final": {}, "allAbsent": True, "not_needed": True,
        },
        "elapsedMs": 25,
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

    def test_exact_ops04_and_ops13_custody_prefixes_are_supported(self) -> None:
        prefixes = (
            "ah11-jev-sigterm-",
            "ah11-jev-fixture-failure-",
            "ah11-jev-marker-missing-",
            "ah11-jev-marker-partial-",
            "ah11-jev-owned-group-finalizer-",
        )
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            tmp_root = base / "tmp"
            registry_root = base / "registry"
            tmp_root.mkdir(mode=0o700)
            registry_root.mkdir(mode=0o700)
            os.chmod(tmp_root, 0o700)
            os.chmod(registry_root, 0o700)
            registry_path = registry_root / "owned-groups.json"
            private_file(registry_path, json.dumps({
                "schema": OWNER.REGISTRY_SCHEMA, "groups": [], "pendingLaunches": [],
            }).encode())
            for index, prefix in enumerate(prefixes, start=1):
                directory = tmp_root / f"{prefix}fixture"
                directory.mkdir(mode=0o700)
                os.chmod(directory, 0o700)
                sidecar_path = registry_root / (
                    f"owned-groups.json.temp-custody.{os.getpid()}."
                    f"{hashlib.sha256(str(directory).encode()).hexdigest()[:16]}.json"
                )
                value = custody_sidecar(
                    directory, f"00000000-0000-4000-8000-{index:012x}"
                )
                record = OWNER.validate_sidecar_value(
                    json.dumps(value).encode(), sidecar_path, registry_path,
                    tmp_root, os.getpid(),
                )
                self.assertEqual(record["directory"], directory)
                self.assertEqual(record["namespace"], "outer")
            retry_dir = tmp_root / "ah11-ops-temp-custody-retry-fixture"
            retry_dir.mkdir(mode=0o700)
            os.chmod(retry_dir, 0o700)
            local_registry_path = retry_dir / "owned-groups.json"
            private_file(local_registry_path, json.dumps({
                "schema": OWNER.REGISTRY_SCHEMA, "groups": [], "pendingLaunches": [],
            }).encode())
            local_sidecar_path = retry_dir / (
                f"owned-groups.json.temp-custody.{os.getpid()}."
                f"{hashlib.sha256(str(retry_dir).encode()).hexdigest()[:16]}.json"
            )
            local_record = OWNER.validate_sidecar_value(
                json.dumps(custody_sidecar(
                    retry_dir, "00000000-0000-4000-8000-000000000006",
                )).encode(), local_sidecar_path, local_registry_path,
                tmp_root, os.getpid(),
            )
            self.assertEqual(local_record["namespace"], "local")
            unsupported = tmp_root / "ah11-unrelated-custody-fixture"
            unsupported.mkdir(mode=0o700)
            os.chmod(unsupported, 0o700)
            tag = hashlib.sha256(str(unsupported).encode()).hexdigest()[:16]
            rejected_path = registry_root / (
                f"owned-groups.json.temp-custody.{os.getpid()}.{tag}.json"
            )
            with self.assertRaises(OWNER.OwnerFailure):
                OWNER.validate_sidecar_value(
                    json.dumps(custody_sidecar(
                        unsupported, "00000000-0000-4000-8000-000000000099",
                    )).encode(), rejected_path, registry_path, tmp_root, os.getpid(),
                )
            misplaced_retry = tmp_root / "ah11-ops-temp-custody-retry-outer"
            misplaced_retry.mkdir(mode=0o700)
            os.chmod(misplaced_retry, 0o700)
            misplaced_tag = hashlib.sha256(str(misplaced_retry).encode()).hexdigest()[:16]
            misplaced_path = registry_root / (
                f"owned-groups.json.temp-custody.{os.getpid()}.{misplaced_tag}.json"
            )
            with self.assertRaises(OWNER.OwnerFailure):
                OWNER.validate_sidecar_value(
                    json.dumps(custody_sidecar(
                        misplaced_retry, "00000000-0000-4000-8000-000000000007",
                    )).encode(), misplaced_path, registry_path, tmp_root, os.getpid(),
                )

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
            [record], "outer", registry_result, original_registry, set()
        ))
        row["registryCleared"] = True
        row["groupAbsent"] = True
        # Historical flags alone cannot clear this row; an independent probe
        # must establish current absence before the directory is removable.
        self.assertFalse(OWNER.sidecar_rows_resolved(
            [record], "outer", registry_result, original_registry, set()
        ))
        self.assertTrue(OWNER.sidecar_rows_resolved(
            [record], "outer", registry_result, original_registry, {1234}
        ))

    def test_cleared_sidecar_groups_are_probed_without_signal_authority(self) -> None:
        row = {"spawnAttempted": True, "groupId": 5678}
        records = [{"launches": [row]}]
        counters = {"sidecarGroupProbes": 0, "boundExceeded": 0}
        budget = OWNER.WaitBudget()
        with (patch.object(OWNER, "wait_groups", return_value={5678: False}) as wait_groups,
              patch.object(OWNER, "signal_groups") as signal_groups,
              patch.object(OWNER, "cleanup_groups") as cleanup_groups):
            self.assertEqual(OWNER.probe_sidecar_groups(records, counters, budget), {5678})
        wait_groups.assert_called_once_with([5678], OWNER.SIDECAR_GROUP_PROBE_MS, budget)
        signal_groups.assert_not_called()
        cleanup_groups.assert_not_called()
        self.assertEqual(counters["sidecarGroupProbes"], 1)

        for state in (True, None):
            counters = {"sidecarGroupProbes": 0, "boundExceeded": 0}
            with patch.object(OWNER, "wait_groups", return_value={5678: state}):
                self.assertIsNone(OWNER.probe_sidecar_groups(records, counters, budget))

    def test_wait_file_reads_durable_result_after_producer_exit(self) -> None:
        pid = 54321
        result = valid_watchdog_result(pid, None)
        with tempfile.TemporaryDirectory() as temporary:
            result_path = Path(temporary) / "watchdog-result.json"
            private_file(result_path, json.dumps(result).encode())
            self.assertTrue(OWNER.wait_file(result_path, ExitedProcess(), 4_000))
            decoded = OWNER.read_small_json(result_path)
            self.assertTrue(OWNER.validate_watchdog_result(decoded, pid, None))

            missing = Path(temporary) / "missing.json"
            self.assertFalse(OWNER.wait_file(missing, ExitedProcess(), 4_000))

            private_file(result_path, b"{}")
            self.assertTrue(OWNER.wait_file(result_path, ExitedProcess(), 4_000))
            self.assertFalse(OWNER.validate_watchdog_result(
                OWNER.read_small_json(result_path), pid, None
            ))

    def test_watchdog_keeps_acknowledged_target_after_leader_exit(self) -> None:
        for descendant_survives in (False, True):
            identity_calls: list[int] = []
            state: dict[str, object] = {
                "target": None,
                "ack_sent": False,
                "ack_path": "ack",
                "group_identity": lambda pgid: identity_calls.append(pgid) or True,
                "atomic_write": lambda _path, _value: True,
            }
            exec(OWNER.WATCHDOG_TARGET_STATE_SOURCE, state)
            self.assertTrue(state["running_control_transition"](43210))
            # The leader may be gone while the recorded group is absent or a
            # descendant remains; neither state replaces the acknowledged PGID.
            state["group_identity"] = lambda _pgid: False if not descendant_survives else True
            self.assertTrue(state["running_control_transition"](43210))
            self.assertTrue(state["terminal_control_matches"](43210))
            self.assertFalse(state["running_control_transition"](43211))
            self.assertFalse(state["terminal_control_matches"](43211))
            self.assertEqual(identity_calls, [43210])

    def test_capture_detects_one_over_byte_while_pipe_remains_open(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(OWNER, "STREAM_MAX_BYTES", 4), \
                patch.object(OWNER, "COMBINED_STREAM_MAX_BYTES", 8):
            output = Path(temporary) / "stdout.raw"
            private_file(output)
            capture = OWNER.Capture({"stdout": output})
            OWNER.Capture._drain(capture, "stdout", FakePipe([b"1234"]))
            self.assertFalse(capture.overflow.is_set())
            self.assertEqual(output.read_bytes(), b"1234")

            private_file(output)
            capture = OWNER.Capture({"stdout": output})
            pipe = FakePipe([b"1234", b"5"], hold_open_after_chunks=True)
            thread = threading.Thread(target=capture._drain, args=("stdout", pipe))
            thread.start()
            self.assertTrue(pipe.last_chunk_returned.wait(1.0))
            self.assertTrue(capture.overflow.wait(1.0))
            self.assertTrue(thread.is_alive())
            self.assertEqual(output.read_bytes(), b"1234")
            pipe.release.set()
            thread.join(1.0)
            self.assertFalse(thread.is_alive())

    def test_capture_combined_cap_and_read_write_errors_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(OWNER, "STREAM_MAX_BYTES", 4), \
                patch.object(OWNER, "COMBINED_STREAM_MAX_BYTES", 6):
            stdout = Path(temporary) / "stdout.raw"
            stderr = Path(temporary) / "stderr.raw"
            private_file(stdout)
            private_file(stderr)
            capture = OWNER.Capture({"stdout": stdout, "stderr": stderr})
            capture._drain("stdout", FakePipe([b"1234"]))
            capture._drain("stderr", FakePipe([b"xyz"]))
            self.assertTrue(capture.overflow.is_set())
            self.assertEqual(stdout.read_bytes(), b"1234")
            self.assertEqual(stderr.read_bytes(), b"xy")

            read_failure = OWNER.Capture({"stdout": stdout, "stderr": stderr})
            read_failure._drain("stdout", FakePipe([], fail_read=True))
            self.assertTrue(read_failure.read_failed.is_set())

            write_failure = OWNER.Capture({"stdout": stdout, "stderr": stderr})
            with patch.object(OWNER.os, "write", side_effect=OSError("fake write failure")):
                write_failure._drain("stdout", FakePipe([b"x"]))
            self.assertTrue(write_failure.read_failed.is_set())

    def test_shared_wait_budget_matches_accepted_specified_waits(self) -> None:
        target_ms = OWNER.TERM_WAIT_MS + OWNER.KILL_WAIT_MS + OWNER.DIRECT_REAP_MS + OWNER.TARGET_RECHECK_MS
        registry_ms = OWNER.TERM_WAIT_MS + OWNER.KILL_WAIT_MS + OWNER.TARGET_RECHECK_MS
        watchdog_ms = sum(OWNER.WATCHDOG_STOP_SEQUENCE_MS)
        sidecar_ms = OWNER.SIDECAR_GROUP_PROBE_MAX * OWNER.SIDECAR_GROUP_PROBE_MS
        self.assertEqual((target_ms, registry_ms, watchdog_ms, sidecar_ms),
                         (2_250, 1_750, 9_600, 4_800))
        self.assertEqual(target_ms + registry_ms + watchdog_ms + sidecar_ms,
                         OWNER.POST_COMMAND_WAIT_MAX_MS)
        budget = OWNER.WaitBudget()
        self.assertEqual(budget.reserve(target_ms), (target_ms, False))
        with patch.object(OWNER.time, "monotonic", return_value=10.250):
            budget.settle(target_ms, 10.0, False, True)
        self.assertEqual(budget.used_ms, 250)
        self.assertEqual(budget.remaining_ms, OWNER.POST_COMMAND_WAIT_MAX_MS - 250)

    def test_registry_namespaces_share_one_sixteen_group_cleanup_batch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            outer_path = base / "outer" / "owned-groups.json"
            local_path = base / "local" / "owned-groups.json"
            outer_path.parent.mkdir()
            local_path.parent.mkdir()
            outer = OWNER.validate_registry_value({
                "schema": OWNER.REGISTRY_SCHEMA, "groups": [111, 222], "pendingLaunches": [],
            })
            local = OWNER.validate_registry_value({
                "schema": OWNER.REGISTRY_SCHEMA, "groups": [333], "pendingLaunches": [],
            })
            private_file(outer_path, json.dumps(outer).encode())
            private_file(local_path, json.dumps(local).encode())
            contexts = [("outer", outer_path, outer), ("local", local_path, local)]
            budget = OWNER.WaitBudget()
            cleanup_result = {
                "groups": [111, 222, 333], "final": {111: False, 222: False, 333: False},
                "term": {}, "kill": {}, "allAbsent": True,
            }
            with (patch.object(OWNER, "cleanup_groups", return_value=cleanup_result) as cleanup_groups,
                  patch.object(OWNER, "wait_groups", return_value={111: False, 222: False, 333: False}) as wait_groups):
                result = OWNER.reconcile_registries(contexts, [], set(), budget)
            self.assertTrue(result["ok"])
            self.assertEqual(result["groupsObserved"], 3)
            cleanup_groups.assert_called_once_with([111, 222, 333], budget=budget)
            wait_groups.assert_called_once_with([111, 222, 333], OWNER.TARGET_RECHECK_MS, budget)
            self.assertEqual(OWNER.read_registry(outer_path)["groups"], [])
            self.assertEqual(OWNER.read_registry(local_path)["groups"], [])

    def test_combined_registry_authority_rejects_more_than_sixteen_groups(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            outer_path = base / "outer" / "owned-groups.json"
            local_path = base / "local" / "owned-groups.json"
            outer_path.parent.mkdir()
            local_path.parent.mkdir()
            outer = OWNER.validate_registry_value({
                "schema": OWNER.REGISTRY_SCHEMA, "groups": list(range(1000, 1016)),
                "pendingLaunches": [],
            })
            local = OWNER.validate_registry_value({
                "schema": OWNER.REGISTRY_SCHEMA, "groups": [2000], "pendingLaunches": [],
            })
            private_file(outer_path, json.dumps(outer).encode())
            private_file(local_path, json.dumps(local).encode())
            with patch.object(OWNER, "cleanup_groups") as cleanup_groups:
                result = OWNER.reconcile_registries(
                    [("outer", outer_path, outer), ("local", local_path, local)],
                    [], set(), OWNER.WaitBudget(),
                )
            self.assertFalse(result["ok"])
            cleanup_groups.assert_not_called()

    def test_registry_persistence_failure_never_reports_reconciliation_success(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            outer_path = base / "outer" / "owned-groups.json"
            local_path = base / "local" / "owned-groups.json"
            outer_path.parent.mkdir()
            local_path.parent.mkdir()
            outer = OWNER.validate_registry_value({
                "schema": OWNER.REGISTRY_SCHEMA, "groups": [111], "pendingLaunches": [],
            })
            local = OWNER.validate_registry_value({
                "schema": OWNER.REGISTRY_SCHEMA, "groups": [222], "pendingLaunches": [],
            })
            private_file(outer_path, json.dumps(outer).encode())
            private_file(local_path, json.dumps(local).encode())
            original_write = OWNER.write_registry_state

            def fail_local_write(path, registry, groups, pending):
                if path == local_path:
                    return False
                return original_write(path, registry, groups, pending)

            cleanup_result = {
                "groups": [111, 222], "final": {111: False, 222: False},
                "term": {}, "kill": {}, "allAbsent": True,
            }
            with (patch.object(OWNER, "cleanup_groups", return_value=cleanup_result),
                  patch.object(OWNER, "wait_groups", return_value={111: False, 222: False}),
                  patch.object(OWNER, "write_registry_state", side_effect=fail_local_write)):
                result = OWNER.reconcile_registries(
                    [("outer", outer_path, outer), ("local", local_path, local)],
                    [], set(), OWNER.WaitBudget(),
                )
            self.assertFalse(result["ok"])
            self.assertFalse(result["outerEmpty"])
            self.assertEqual(OWNER.read_registry(local_path)["groups"], [222])

    def test_registry_scan_counter_is_shared_across_namespaces(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(OWNER, "REGISTRY_DIRECTORY_ENTRY_MAX", 2):
            base = Path(temporary)
            first = base / "first"
            second = base / "second"
            first.mkdir()
            second.mkdir()
            private_file(first / "one")
            private_file(first / "two")
            private_file(second / "three")
            counters = {"registryEntries": 0, "boundExceeded": 0}
            self.assertEqual(len(OWNER.list_entries(first, counters)), 2)
            self.assertIsNone(OWNER.list_entries(second, counters))
            self.assertEqual(counters["registryEntries"], 3)
            self.assertEqual(counters["boundExceeded"], 1)

    def test_reaped_command_leader_still_cleans_live_descendant_group_once(self) -> None:
        pgid = 43210
        cleanup_result = {
            "term": {pgid: "sent"},
            "kill": {},
            "allAbsent": True,
        }
        budget = OWNER.WaitBudget()
        with (
            patch.object(OWNER, "group_exists", return_value=True) as group_exists,
            patch.object(OWNER, "cleanup_groups", return_value=cleanup_result) as cleanup_groups,
            patch.object(OWNER, "wait_groups", return_value={pgid: False}) as wait_groups,
        ):
            (command_exit, command_reaped, group_absent, capture_drained,
             escalation) = OWNER.cleanup_target_group(
                pgid, None, 0, True, budget=budget,
            )

        self.assertEqual((command_exit, command_reaped, group_absent, escalation),
                         (0, True, True, "term"))
        self.assertTrue(capture_drained)
        group_exists.assert_called_once_with(pgid)
        cleanup_groups.assert_called_once_with(
            [pgid], OWNER.TERM_WAIT_MS, OWNER.KILL_WAIT_MS, budget
        )
        wait_groups.assert_called_once_with([pgid], OWNER.TARGET_RECHECK_MS, budget)
        bounded_wait_ms = (OWNER.TERM_WAIT_MS + OWNER.KILL_WAIT_MS
                           + OWNER.DIRECT_REAP_MS + OWNER.TARGET_RECHECK_MS)
        self.assertEqual(bounded_wait_ms, 2_250)

    def test_watchdog_owned_cleanup_is_never_signalled_twice(self) -> None:
        pgid = 43210
        with (
            patch.object(OWNER, "group_exists", return_value=True) as group_exists,
            patch.object(OWNER, "cleanup_groups") as cleanup_groups,
            patch.object(OWNER, "wait_groups", return_value={pgid: True}),
        ):
            result = OWNER.cleanup_target_group(
                pgid, None, 0, True, cleanup_attempted=True,
            )
        self.assertEqual(result, (0, True, False, True, "unconfirmed"))
        group_exists.assert_called_once_with(pgid)
        cleanup_groups.assert_not_called()

    def test_cleanup_failure_keeps_the_original_command_status(self) -> None:
        pgid = 43210
        with (
            patch.object(OWNER, "group_exists", return_value=True),
            patch.object(OWNER, "cleanup_groups", return_value={
                "term": {}, "kill": {}, "allAbsent": False,
            }),
            patch.object(OWNER, "wait_groups", return_value={pgid: True}),
        ):
            result = OWNER.cleanup_target_group(pgid, None, 37, True)
        self.assertEqual(result, (37, True, False, True, "unconfirmed"))


if __name__ == "__main__":
    unittest.main()
