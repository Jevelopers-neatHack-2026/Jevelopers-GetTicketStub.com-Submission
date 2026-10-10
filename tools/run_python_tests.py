#!/usr/bin/env python3
"""Run only explicitly listed local Python unit suites and report their counts."""

from __future__ import annotations

import argparse
import importlib.util
import json
import platform
import sys
import unittest
from pathlib import Path
from typing import Mapping, TextIO


ROOT = Path(__file__).resolve().parents[1]
SUMMARY_PREFIX = "PYTHON_VERIFY_SUMMARY_JSON="
sys.path.insert(0, str(ROOT))

# New Python suites must be named here explicitly. The generic evals route in
# tools/verify.mjs remains the Node benchmark route and cannot inherit these.
SUITE_FILES: Mapping[str, tuple[str, ...]] = {
    "eval-policy-unit": (
        "tests/evals/test_check_policy.py",
        "tests/runner/test_python_verification.py",
    ),
}


def _base_summary(case_name: str, expected: int = 0) -> dict[str, object]:
    return {
        "case": case_name,
        "mode": "unit",
        "status": "failed",
        "exit_code": 1,
        "runtime": platform.python_version(),
        "expected_cases": expected,
        "executed_cases": 0,
        "passed_cases": 0,
        "failed_cases": 0,
        "error_cases": 0,
        "runner_errors": 0,
        "runner_skips": 0,
        "skipped_cases": 0,
        "skip_events": 0,
        "subtest_skip_events": 0,
        "subtest_failure_events": 0,
        "subtest_error_events": 0,
        "incomplete_cases": 0,
        "expected_failure_cases": 0,
        "unexpected_success_cases": 0,
        "fixture_scope": "local policy and runner unit tests only",
        "provider_activity": "none",
        "reason": None,
    }


class CountingTextTestResult(unittest.TextTestResult):
    """Track per-case outcomes and fixture/subtest result events."""

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self.case_outcomes: list[set[str]] = []
        self._active_case_index: int | None = None
        self._active_test: unittest.case.TestCase | None = None
        self.runner_errors = 0
        self.runner_skips = 0
        self.subtest_skip_events = 0
        self.subtest_failure_events = 0
        self.subtest_error_events = 0

    def startTest(self, test: unittest.case.TestCase) -> None:
        super().startTest(test)
        self.case_outcomes.append(set())
        self._active_case_index = len(self.case_outcomes) - 1
        self._active_test = test

    def stopTest(self, test: unittest.case.TestCase) -> None:
        try:
            super().stopTest(test)
        finally:
            self._active_case_index = None
            self._active_test = None

    def _mark(self, outcome: str) -> None:
        if self._active_case_index is None:
            return
        self.case_outcomes[self._active_case_index].add(outcome)

    def addSuccess(self, test: unittest.case.TestCase) -> None:
        self._mark("passed")
        super().addSuccess(test)

    def addFailure(self, test: unittest.case.TestCase, err: object) -> None:
        self._mark("failure")
        super().addFailure(test, err)

    def addError(self, test: unittest.case.TestCase, err: object) -> None:
        if self._active_case_index is None:
            self.runner_errors += 1
        else:
            self._mark("error")
        super().addError(test, err)

    def addSkip(self, test: unittest.case.TestCase, reason: str) -> None:
        if self._active_case_index is None:
            self.runner_skips += 1
        elif test is self._active_test:
            self._mark("case_skipped")
        else:
            self.subtest_skip_events += 1
            self._mark("subtest_skipped")
        super().addSkip(test, reason)

    def addExpectedFailure(self, test: unittest.case.TestCase, err: object) -> None:
        self._mark("expected_failure")
        super().addExpectedFailure(test, err)

    def addUnexpectedSuccess(self, test: unittest.case.TestCase) -> None:
        self._mark("unexpected_success")
        super().addUnexpectedSuccess(test)

    def addSubTest(
        self,
        test: unittest.case.TestCase,
        subtest: unittest.case.TestCase,
        err: object | None,
    ) -> None:
        if err is not None:
            error_type = err[0]
            try:
                is_failure = issubclass(error_type, test.failureException)
            except TypeError:
                is_failure = False
            if is_failure:
                self.subtest_failure_events += 1
                self._mark("failure")
            else:
                self.subtest_error_events += 1
                self._mark("error")
        super().addSubTest(test, subtest, err)


def summarize_result(
    case_name: str,
    expected: int,
    result: unittest.TestResult,
) -> dict[str, object]:
    outcomes = getattr(result, "case_outcomes", [])
    # A test that reports any additional outcome was run, even if setup,
    # teardown, or cleanup also emitted a skip callback.
    skipped = sum(outcome == {"case_skipped"} for outcome in outcomes)
    failed = sum(bool(outcome & {"failure", "error"}) for outcome in outcomes)
    error_cases = sum("error" in outcome for outcome in outcomes)
    expected_failures = sum("expected_failure" in outcome for outcome in outcomes)
    unexpected_successes = sum("unexpected_success" in outcome for outcome in outcomes)
    executed = len(outcomes) - skipped
    passed = sum(
        "passed" in outcome
        and outcome.isdisjoint(
            {
                "failure",
                "error",
                "case_skipped",
                "subtest_skipped",
                "expected_failure",
                "unexpected_success",
            }
        )
        for outcome in outcomes
    )
    terminal_events = {
        "passed",
        "failure",
        "error",
        "case_skipped",
        "expected_failure",
        "unexpected_success",
    }
    incomplete = sum(outcome.isdisjoint(terminal_events) for outcome in outcomes)
    runner_errors = getattr(result, "runner_errors", 0)
    runner_skips = getattr(result, "runner_skips", 0)
    subtest_skip_events = getattr(result, "subtest_skip_events", 0)
    subtest_failure_events = getattr(result, "subtest_failure_events", 0)
    subtest_error_events = getattr(result, "subtest_error_events", 0)
    skip_events = len(getattr(result, "skipped", ()))

    passed_all = (
        expected > 0
        and executed > 0
        and expected == result.testsRun
        and len(outcomes) == result.testsRun
        and passed == expected
        and incomplete == 0
        and failed == 0
        and skipped == 0
        and skip_events == 0
        and runner_skips == 0
        and subtest_skip_events == 0
        and expected_failures == 0
        and unexpected_successes == 0
        and runner_errors == 0
        and result.wasSuccessful()
    )
    summary = _base_summary(case_name, expected)
    summary.update(
        {
            "status": "passed" if passed_all else "failed",
            "exit_code": 0 if passed_all else 1,
            "executed_cases": executed,
            "passed_cases": passed,
            "failed_cases": failed,
            "error_cases": error_cases,
            "runner_errors": runner_errors,
            "runner_skips": runner_skips,
            "skipped_cases": skipped,
            "skip_events": skip_events,
            "subtest_skip_events": subtest_skip_events,
            "subtest_failure_events": subtest_failure_events,
            "subtest_error_events": subtest_error_events,
            "incomplete_cases": incomplete,
            "expected_failure_cases": expected_failures,
            "unexpected_success_cases": unexpected_successes,
        }
    )
    if expected == 0:
        summary["reason"] = "no tests were collected"
    elif skip_events:
        summary["reason"] = "tests or unittest setup/teardown hooks were skipped"
    elif runner_errors:
        summary["reason"] = "unittest setup or teardown failed outside a test case"
    elif incomplete:
        summary["reason"] = "some tests did not report a terminal result"
    elif executed == 0:
        summary["reason"] = "no tests executed"
    elif not passed_all:
        summary["reason"] = "tests failed, were skipped, or did not all execute"
    return summary


def run_test_suite(
    case_name: str,
    suite: unittest.TestSuite,
    *,
    stream: TextIO | None = None,
) -> dict[str, object]:
    expected = suite.countTestCases()
    if expected == 0:
        summary = _base_summary(case_name)
        summary["reason"] = "no tests were collected"
        return summary

    runner = unittest.TextTestRunner(
        stream=stream or sys.stderr,
        verbosity=2,
        resultclass=CountingTextTestResult,
    )
    result = runner.run(suite)
    return summarize_result(case_name, expected, result)


def _load_suite(
    case_name: str,
    *,
    manifest: Mapping[str, tuple[str, ...]],
    root: Path,
) -> tuple[unittest.TestSuite | None, int, str | None]:
    listed_files = manifest.get(case_name)
    if listed_files is None:
        return None, 0, "unknown Python unit suite"
    if not listed_files:
        return None, 0, "no test files are configured"

    root = root.resolve()
    suite = unittest.TestSuite()
    expected = 0
    loader = unittest.defaultTestLoader
    for index, relative_path in enumerate(listed_files):
        path = (root / relative_path).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            return None, expected, "test file is outside the repository root"
        if not path.is_file():
            return None, expected, "a listed test file is missing"

        module_name = f"_ei_{case_name.replace('-', '_')}_{index}_{path.stem}"
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            return None, expected, "a listed test file could not be loaded"
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        try:
            spec.loader.exec_module(module)
            loaded = loader.loadTestsFromModule(module)
        except Exception:
            sys.modules.pop(module_name, None)
            return None, expected, "a listed test file could not be imported"
        suite.addTests(loaded)
        expected += loaded.countTestCases()

    return suite, expected, None


def run_named_suite(
    case_name: str,
    *,
    manifest: Mapping[str, tuple[str, ...]] = SUITE_FILES,
    root: Path = ROOT,
    stream: TextIO | None = None,
) -> dict[str, object]:
    suite, expected, error = _load_suite(case_name, manifest=manifest, root=root)
    if error is not None or suite is None:
        summary = _base_summary(case_name, expected)
        summary["reason"] = error or "test suite could not be loaded"
        return summary
    return run_test_suite(case_name, suite, stream=stream)


def _emit_summary(summary: Mapping[str, object]) -> None:
    print(SUMMARY_PREFIX + json.dumps(summary, sort_keys=True, separators=(",", ":")))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=tuple(SUITE_FILES), required=True)
    args = parser.parse_args(argv)
    summary = run_named_suite(args.suite)
    _emit_summary(summary)
    return int(summary["exit_code"])


if __name__ == "__main__":
    raise SystemExit(main())
