from __future__ import annotations

import io
import tempfile
import unittest
from itertools import count
from pathlib import Path

from tools.run_python_tests import (
    CountingTextTestResult,
    run_named_suite,
    run_test_suite,
    summarize_result,
)


_case_numbers = count()


def synthetic_case(outcome: str) -> unittest.TestCase:
    def run_test(self: unittest.TestCase) -> None:
        if outcome == "skip":
            self.skipTest("synthetic skip")
        if outcome == "failure":
            self.fail("synthetic failure")
        if outcome == "error":
            raise RuntimeError("synthetic error")
        if outcome == "subtest_failure":
            for value in (1, 2):
                with self.subTest(value=value):
                    self.fail("synthetic subtest failure")
        if outcome == "expected_failure":
            self.fail("synthetic expected failure")
        if outcome == "unexpected_success":
            return

    method = run_test
    if outcome in {"expected_failure", "unexpected_success"}:
        method = unittest.expectedFailure(method)
    case_type = type(
        f"SyntheticCase_{outcome}_{next(_case_numbers)}",
        (unittest.TestCase,),
        {"__module__": __name__, "runTest": method},
    )
    return case_type()


def synthetic_subtest_case(outcomes: tuple[str, ...]) -> unittest.TestCase:
    def run_test(self: unittest.TestCase) -> None:
        for index, outcome in enumerate(outcomes):
            with self.subTest(index=index, outcome=outcome):
                if outcome == "skip":
                    self.skipTest("synthetic subtest skip")
                if outcome == "failure":
                    self.fail("synthetic subtest failure")
                if outcome == "error":
                    raise RuntimeError("synthetic subtest error")

    case_type = type(
        f"SyntheticSubTestCase_{next(_case_numbers)}",
        (unittest.TestCase,),
        {"__module__": __name__, "runTest": run_test},
    )
    return case_type()


class PythonVerificationRunnerTests(unittest.TestCase):
    def test_missing_listed_file_fails_with_zero_execution_counts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            summary = run_named_suite(
                "eval-policy-unit",
                manifest={"eval-policy-unit": ("tests/missing_suite.py",)},
                root=Path(directory),
                stream=io.StringIO(),
            )

        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["expected_cases"], 0)
        self.assertEqual(summary["executed_cases"], 0)
        self.assertEqual(summary["passed_cases"], 0)
        self.assertEqual(summary["failed_cases"], 0)
        self.assertEqual(summary["skipped_cases"], 0)
        self.assertEqual(summary["reason"], "a listed test file is missing")

    def test_zero_test_suite_fails_closed(self) -> None:
        summary = run_test_suite("eval-policy-unit", unittest.TestSuite(), stream=io.StringIO())

        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["exit_code"], 1)
        self.assertEqual(summary["expected_cases"], 0)
        self.assertEqual(summary["executed_cases"], 0)
        self.assertEqual(summary["reason"], "no tests were collected")

    def test_skipped_test_is_not_counted_as_executed_or_passed(self) -> None:
        suite = unittest.TestSuite([synthetic_case("pass"), synthetic_case("skip")])
        summary = run_test_suite("eval-policy-unit", suite, stream=io.StringIO())

        self.assertEqual(summary["expected_cases"], 2)
        self.assertEqual(summary["executed_cases"], 1)
        self.assertEqual(summary["passed_cases"], 1)
        self.assertEqual(summary["failed_cases"], 0)
        self.assertEqual(summary["skipped_cases"], 1)
        self.assertEqual(summary["status"], "failed")

    def test_failures_and_errors_are_counted_once_per_test(self) -> None:
        suite = unittest.TestSuite(
            [synthetic_case("pass"), synthetic_case("failure"), synthetic_case("error")]
        )
        summary = run_test_suite("eval-policy-unit", suite, stream=io.StringIO())

        self.assertEqual(summary["expected_cases"], 3)
        self.assertEqual(summary["executed_cases"], 3)
        self.assertEqual(summary["passed_cases"], 1)
        self.assertEqual(summary["failed_cases"], 2)
        self.assertEqual(summary["error_cases"], 1)
        self.assertEqual(summary["status"], "failed")

    def test_unittest_expected_failure_is_not_reported_as_a_pass(self) -> None:
        summary = run_test_suite(
            "eval-policy-unit",
            unittest.TestSuite([synthetic_case("expected_failure")]),
            stream=io.StringIO(),
        )

        self.assertEqual(summary["expected_cases"], 1)
        self.assertEqual(summary["executed_cases"], 1)
        self.assertEqual(summary["passed_cases"], 0)
        self.assertEqual(summary["expected_failure_cases"], 1)
        self.assertEqual(summary["status"], "failed")

    def test_unittest_unexpected_success_is_not_reported_as_a_pass(self) -> None:
        summary = run_test_suite(
            "eval-policy-unit",
            unittest.TestSuite([synthetic_case("unexpected_success")]),
            stream=io.StringIO(),
        )

        self.assertEqual(summary["expected_cases"], 1)
        self.assertEqual(summary["executed_cases"], 1)
        self.assertEqual(summary["passed_cases"], 0)
        self.assertEqual(summary["unexpected_success_cases"], 1)
        self.assertEqual(summary["status"], "failed")

    def test_repeated_test_ids_are_counted_as_distinct_executions(self) -> None:
        case = synthetic_case("failure")
        suite = unittest.TestSuite([case, case])
        summary = run_test_suite("eval-policy-unit", suite, stream=io.StringIO())

        self.assertEqual(summary["expected_cases"], 2)
        self.assertEqual(summary["executed_cases"], 2)
        self.assertEqual(summary["passed_cases"], 0)
        self.assertEqual(summary["failed_cases"], 2)

    def test_multiple_subtest_failures_count_as_one_failed_case(self) -> None:
        summary = run_test_suite(
            "eval-policy-unit",
            unittest.TestSuite([synthetic_case("subtest_failure")]),
            stream=io.StringIO(),
        )

        self.assertEqual(summary["expected_cases"], 1)
        self.assertEqual(summary["executed_cases"], 1)
        self.assertEqual(summary["passed_cases"], 0)
        self.assertEqual(summary["failed_cases"], 1)
        self.assertEqual(summary["subtest_failure_events"], 2)
        self.assertEqual(summary["status"], "failed")

    def test_mixed_subtest_skip_and_failure_counts_in_either_order(self) -> None:
        for outcomes in (("skip", "failure"), ("failure", "skip")):
            with self.subTest(outcomes=outcomes):
                summary = run_test_suite(
                    "eval-policy-unit",
                    unittest.TestSuite([synthetic_subtest_case(outcomes)]),
                    stream=io.StringIO(),
                )

                self.assertEqual(summary["status"], "failed")
                self.assertEqual(summary["exit_code"], 1)
                self.assertEqual(summary["expected_cases"], 1)
                self.assertEqual(summary["executed_cases"], 1)
                self.assertEqual(summary["passed_cases"], 0)
                self.assertEqual(summary["failed_cases"], 1)
                self.assertEqual(summary["skipped_cases"], 0)
                self.assertEqual(summary["skip_events"], 1)
                self.assertEqual(summary["subtest_skip_events"], 1)
                self.assertEqual(summary["subtest_failure_events"], 1)
                self.assertEqual(
                    summary["reason"],
                    "tests or unittest setup/teardown hooks were skipped",
                )

    def test_successful_subtest_with_a_skip_is_not_counted_as_a_pass(self) -> None:
        summary = run_test_suite(
            "eval-policy-unit",
            unittest.TestSuite([synthetic_subtest_case(("skip",))]),
            stream=io.StringIO(),
        )

        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["exit_code"], 1)
        self.assertEqual(summary["expected_cases"], 1)
        self.assertEqual(summary["executed_cases"], 1)
        self.assertEqual(summary["passed_cases"], 0)
        self.assertEqual(summary["skipped_cases"], 0)
        self.assertEqual(summary["skip_events"], 1)
        self.assertEqual(summary["subtest_skip_events"], 1)
        self.assertEqual(
            summary["reason"],
            "tests or unittest setup/teardown hooks were skipped",
        )

    def test_multiple_subtest_failures_and_errors_preserve_both_events(self) -> None:
        summary = run_test_suite(
            "eval-policy-unit",
            unittest.TestSuite(
                [synthetic_subtest_case(("failure", "error", "failure"))]
            ),
            stream=io.StringIO(),
        )

        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["executed_cases"], 1)
        self.assertEqual(summary["failed_cases"], 1)
        self.assertEqual(summary["error_cases"], 1)
        self.assertEqual(summary["subtest_failure_events"], 2)
        self.assertEqual(summary["subtest_error_events"], 1)

    def test_failure_followed_by_tear_down_error_counts_as_one_error_case(self) -> None:
        def fail_test(self: unittest.TestCase) -> None:
            self.fail("synthetic assertion failure before teardown")

        def fail_tear_down(self: unittest.TestCase) -> None:
            raise RuntimeError("synthetic tearDown error")

        case_type = type(
            f"FailureAndTearDownErrorCase_{next(_case_numbers)}",
            (unittest.TestCase,),
            {
                "__module__": __name__,
                "runTest": fail_test,
                "tearDown": fail_tear_down,
            },
        )
        summary = run_test_suite(
            "eval-policy-unit",
            unittest.TestSuite([case_type()]),
            stream=io.StringIO(),
        )

        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["failed_cases"], 1)
        self.assertEqual(summary["error_cases"], 1)
        self.assertEqual(summary["runner_errors"], 0)


    def test_pass_summary_counts_are_faithful(self) -> None:
        summary = run_test_suite(
            "eval-policy-unit",
            unittest.TestSuite([synthetic_case("pass"), synthetic_case("pass")]),
            stream=io.StringIO(),
        )

        self.assertEqual(summary["status"], "passed")
        self.assertEqual(summary["expected_cases"], 2)
        self.assertEqual(summary["executed_cases"], 2)
        self.assertEqual(summary["passed_cases"], 2)
        self.assertEqual(summary["failed_cases"], 0)
        self.assertEqual(summary["skipped_cases"], 0)
        self.assertEqual(summary["expected_failure_cases"], 0)
        self.assertEqual(summary["unexpected_success_cases"], 0)

    def test_started_test_without_terminal_result_is_incomplete(self) -> None:
        case = synthetic_case("pass")
        result = CountingTextTestResult(io.StringIO(), True, 1)
        result.startTest(case)
        result.stopTest(case)

        summary = summarize_result("eval-policy-unit", 1, result)

        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["expected_cases"], 1)
        self.assertEqual(summary["executed_cases"], 1)
        self.assertEqual(summary["passed_cases"], 0)
        self.assertEqual(summary["incomplete_cases"], 1)
        self.assertEqual(summary["reason"], "some tests did not report a terminal result")

    def test_tear_down_class_error_is_reported_outside_test_cases(self) -> None:
        @classmethod
        def tear_down_class(cls: type[unittest.TestCase]) -> None:
            raise RuntimeError("synthetic tearDownClass error")

        case_type = type(
            f"ClassHookCase_{next(_case_numbers)}",
            (unittest.TestCase,),
            {
                "__module__": __name__,
                "test_first": lambda self: None,
                "test_second": lambda self: None,
                "tearDownClass": tear_down_class,
            },
        )
        summary = run_test_suite(
            "eval-policy-unit",
            unittest.TestSuite([case_type("test_first"), case_type("test_second")]),
            stream=io.StringIO(),
        )

        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["expected_cases"], 2)
        self.assertEqual(summary["passed_cases"], 2)
        self.assertEqual(summary["failed_cases"], 0)
        self.assertEqual(summary["runner_errors"], 1)
        self.assertEqual(
            summary["reason"],
            "unittest setup or teardown failed outside a test case",
        )

    def test_tear_down_module_error_is_reported_outside_test_cases(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "module_hook_suite.py").write_text(
                "import unittest\n"
                "class ModuleHookCase(unittest.TestCase):\n"
                "    def test_pass(self):\n"
                "        pass\n"
                "def tearDownModule():\n"
                "    raise RuntimeError('synthetic tearDownModule error')\n",
                encoding="utf-8",
            )
            summary = run_named_suite(
                "eval-policy-unit",
                manifest={"eval-policy-unit": ("module_hook_suite.py",)},
                root=root,
                stream=io.StringIO(),
            )

        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["expected_cases"], 1)
        self.assertEqual(summary["passed_cases"], 1)
        self.assertEqual(summary["failed_cases"], 0)
        self.assertEqual(summary["runner_errors"], 1)
        self.assertEqual(
            summary["reason"],
            "unittest setup or teardown failed outside a test case",
        )

    def test_class_setup_and_teardown_skips_are_reported(self) -> None:
        for hook_name in ("setUpClass", "tearDownClass"):
            def skip_hook(cls: type[unittest.TestCase]) -> None:
                raise unittest.SkipTest(f"synthetic {hook_name} skip")

            case_type = type(
                f"ClassSkipCase_{hook_name}_{next(_case_numbers)}",
                (unittest.TestCase,),
                {
                    "__module__": __name__,
                    "test_pass": lambda self: None,
                    hook_name: classmethod(skip_hook),
                },
            )
            with self.subTest(hook=hook_name):
                summary = run_test_suite(
                    "eval-policy-unit",
                    unittest.TestSuite([case_type("test_pass")]),
                    stream=io.StringIO(),
                )

                self.assertEqual(summary["status"], "failed")
                self.assertEqual(summary["exit_code"], 1)
                self.assertEqual(summary["expected_cases"], 1)
                self.assertEqual(summary["runner_skips"], 1)
                self.assertEqual(summary["skip_events"], 1)
                self.assertEqual(summary["skipped_cases"], 0)
                self.assertEqual(
                    summary["reason"],
                    "tests or unittest setup/teardown hooks were skipped",
                )
                if hook_name == "setUpClass":
                    self.assertEqual(summary["executed_cases"], 0)
                    self.assertEqual(summary["passed_cases"], 0)
                else:
                    self.assertEqual(summary["executed_cases"], 1)
                    self.assertEqual(summary["passed_cases"], 1)

    def test_module_setup_and_teardown_skips_are_reported(self) -> None:
        for hook_name in ("setUpModule", "tearDownModule"):
            with self.subTest(hook=hook_name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                suite_name = f"{hook_name}_skip_suite.py"
                (root / suite_name).write_text(
                    "import unittest\n"
                    "class ModuleSkipCase(unittest.TestCase):\n"
                    "    def test_pass(self):\n"
                    "        pass\n"
                    f"def {hook_name}():\n"
                    f"    raise unittest.SkipTest('synthetic {hook_name} skip')\n",
                    encoding="utf-8",
                )
                summary = run_named_suite(
                    "eval-policy-unit",
                    manifest={"eval-policy-unit": (suite_name,)},
                    root=root,
                    stream=io.StringIO(),
                )

                self.assertEqual(summary["status"], "failed")
                self.assertEqual(summary["exit_code"], 1)
                self.assertEqual(summary["expected_cases"], 1)
                self.assertEqual(summary["runner_skips"], 1)
                self.assertEqual(summary["skip_events"], 1)
                self.assertEqual(summary["skipped_cases"], 0)
                self.assertEqual(
                    summary["reason"],
                    "tests or unittest setup/teardown hooks were skipped",
                )
                if hook_name == "setUpModule":
                    self.assertEqual(summary["executed_cases"], 0)
                    self.assertEqual(summary["passed_cases"], 0)
                else:
                    self.assertEqual(summary["executed_cases"], 1)
                    self.assertEqual(summary["passed_cases"], 1)


if __name__ == "__main__":
    unittest.main()
