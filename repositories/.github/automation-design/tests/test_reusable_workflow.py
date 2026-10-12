from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "automation-design/examples/reusable/.github/workflows/docs-check.yml"
FIXTURE_WORKFLOW = (
    ROOT / "automation-design/fixtures/reusable-workflow/.github/workflows/docs-check.yml"
)
CONSUMER_FIXTURE = ROOT / "automation-design/fixtures/reusable-workflow"
CALLER = ROOT / "automation-design/examples/caller/.github/workflows/docs-check.yml"
TEMPLATE = ROOT / "workflow-templates/docs-check.yml"
TEMPLATE_PROPERTIES = ROOT / "workflow-templates/docs-check.properties.json"
CHECKOUT_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1"


def extract_node_script(workflow: str) -> str:
    """Extract the exact script run by the reusable source's Node here-document."""
    match = re.search(
        r"(?ms)^        run: \|\n          node <<'NODE'\n(.*?)^          NODE\s*$",
        workflow,
    )
    if not match:
        raise AssertionError("reusable workflow Node here-document not found")
    block = match.group(1)
    lines = block.splitlines()
    if not all(not line.strip() or line.startswith("          ") for line in lines):
        raise AssertionError("unexpected YAML indentation in Node script")
    return "\n".join(line[10:] if line.startswith("          ") else "" for line in lines) + "\n"


def policy_violations(source: str, *callers: str) -> list[str]:
    workflows = (source, *callers)
    text = "\n".join(workflows)
    violations: list[str] = []
    if "pull_request_target:" in text or "workflow_run:" in text:
        violations.append("privileged trigger")
    if any(permission_violations(workflow) for workflow in workflows):
        violations.append("token permissions must be limited to contents: read")
    if re.search(r"(?m)^\s*secrets:\s*inherit\s*$", text):
        violations.append("inherited secrets")
    if re.search(r"\$\{\{\s*secrets\.", text):
        violations.append("secret reference")
    if re.search(r"(?m)^\s*secrets:\s*$", source):
        violations.append("declared reusable secret")
    return violations


class UniqueKeySafeLoader(yaml.SafeLoader):
    """Reject ambiguous duplicate keys instead of choosing one declaration."""

    def construct_mapping(self, node, deep=False):
        mapping = super().construct_mapping(node, deep=deep)
        if len(mapping) != len(node.value):
            raise yaml.constructor.ConstructorError(
                None, None, "duplicate mapping key", node.start_mark
            )
        return mapping


def permission_violations(text: str) -> list[str]:
    """Check one workflow's declarations and every job's effective permissions."""
    try:
        workflow = yaml.load(text, Loader=UniqueKeySafeLoader)
    except yaml.YAMLError:
        return ["invalid or ambiguous workflow YAML"]
    if not isinstance(workflow, dict) or not isinstance(workflow.get("jobs"), dict):
        return ["unsupported workflow or jobs declaration"]

    def is_minimal(permissions) -> bool:
        # An explicit map disables omitted scopes; {} disables all scopes.
        return isinstance(permissions, dict) and all(
            scope == "contents" and level in ("read", "none")
            for scope, level in permissions.items()
        )

    violations: list[str] = []
    default = workflow.get("permissions")
    if "permissions" in workflow and not is_minimal(default):
        violations.append("non-minimal workflow permissions")
    for job in workflow["jobs"].values():
        if not isinstance(job, dict):
            violations.append("unsupported job declaration")
        elif not is_minimal(job.get("permissions", default)):
            # Without an explicit job or workflow map, the repository default
            # is unknown and may grant writes. Job maps replace workflow maps.
            violations.append("non-minimal or unknown job permissions")
    return violations


class ReusableWorkflowFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source_text = SOURCE.read_text(encoding="utf-8")
        cls.fixture_workflow_text = FIXTURE_WORKFLOW.read_text(encoding="utf-8")
        cls.caller_text = CALLER.read_text(encoding="utf-8")
        cls.template_text = TEMPLATE.read_text(encoding="utf-8")
        cls.node_script = extract_node_script(cls.source_text)
        cls.node_scripts = (
            cls.node_script,
            extract_node_script(cls.fixture_workflow_text),
            extract_node_script(cls.template_text),
        )

    def run_checker(
        self,
        scope: str,
        documents: dict[str, str],
        outside: dict[str, str] | None = None,
        make_docs: bool = True,
    ) -> tuple[subprocess.CompletedProcess[str], str]:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            root.mkdir(parents=True)
            if make_docs:
                (root / "docs").mkdir()
            for relpath, content in documents.items():
                target = root / relpath
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
            if outside:
                for relpath, content in outside.items():
                    target = Path(temp) / relpath
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(content, encoding="utf-8")

            output = root / "github-output.txt"
            env = os.environ.copy()
            env["DOCS_SCOPE"] = scope
            env["CONTRACT_VERSION"] = "docs-link-check/v1"
            env["GITHUB_OUTPUT"] = str(output)
            # Execute the same here-document through the same shell command as the workflow.
            command = "node <<'NODE'\n" + self.node_script + "NODE\n"
            result = subprocess.run(
                ["/bin/sh", "-c", command],
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            return result, output.read_text(encoding="utf-8") if output.exists() else ""

    def test_fixture_is_exact_copy_and_action_pin_is_full_sha(self) -> None:
        self.assertEqual(self.source_text, self.fixture_workflow_text)
        self.assertIn(f"actions/checkout@{CHECKOUT_SHA}", self.source_text)
        self.assertRegex(CHECKOUT_SHA, r"^[0-9a-f]{40}$")
        self.assertIn("scope:", self.source_text)
        self.assertIn("contract_version:", self.source_text)
        self.assertIn("CONTRACT_VERSION: docs-link-check/v1", self.source_text)
        self.assertIn("DOCS_SCOPE: ${{ inputs.scope }}", self.source_text)
        self.assertIn("checked_files:", self.source_text)
        self.assertIn("result:", self.source_text)
        self.assertIn(
            "value: ${{ jobs.validate.outputs.contract_version }}",
            self.source_text,
        )
        self.assertIn("value: ${{ jobs.validate.outputs.checked_files }}", self.source_text)
        self.assertIn("value: ${{ jobs.validate.outputs.result }}", self.source_text)
        self.assertIn(
            "contract_version: ${{ steps.check.outputs.contract_version }}",
            self.source_text,
        )
        self.assertIn("checked_files: ${{ steps.check.outputs.checked_files }}", self.source_text)
        self.assertIn("result: ${{ steps.check.outputs.result }}", self.source_text)
        run_body = self.source_text.split("        run: |\n", 1)[1].split(
            "          NODE", 1
        )[0]
        self.assertNotIn("${{ inputs.scope }}", run_body)
        self.assertIn("CHECKED_FILES: ${{ needs.docs.outputs.checked_files }}", self.caller_text)
        self.assertIn("CHECK_RESULT: ${{ needs.docs.outputs.result }}", self.caller_text)
        self.assertIn(
            "CONTRACT_VERSION: ${{ needs.docs.outputs.contract_version }}",
            self.caller_text,
        )
        self.assertNotIn("pull_request_target:", self.source_text + self.caller_text)
        self.assertEqual(
            self.node_script,
            extract_node_script(self.template_text),
            "the copyable starter must run the same tested checker implementation",
        )
        self.assertIn("pull_request:", self.template_text)
        self.assertIn("push:", self.template_text)
        self.assertIn("branches: [ $default-branch ]", self.template_text)
        self.assertIn("workflow_dispatch:", self.template_text)
        self.assertIn("persist-credentials: false", self.source_text)
        self.assertIn("persist-credentials: false", self.template_text)
        self.assertEqual(1, len(set(self.node_scripts)), "source, fixture, and starter scripts must stay identical")
        self.assertEqual(
            [],
            policy_violations(
                self.source_text, self.caller_text, self.template_text
            ),
        )

        properties = json.loads(TEMPLATE_PROPERTIES.read_text(encoding="utf-8"))
        self.assertEqual("Markdown relative-link check", properties["name"])
        self.assertIn("description", properties)
        self.assertEqual([".*\\.md$"], properties["filePatterns"])

    def test_docs_scope_passes_and_writes_declared_outputs(self) -> None:
        result, output = self.run_checker(
            "docs",
            {
                "docs/index.md": "[reference](reference.md)\n",
                "docs/reference.md": "# Reference\n",
            },
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("checked_files=2\n", output)
        self.assertIn("broken_links=0\n", output)
        self.assertIn("contract_version=docs-link-check/v1\n", output)
        self.assertIn("result=passed\n", output)

    def test_checked_in_consumer_fixture_executes_same_checker(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "github-output.txt"
            env = os.environ.copy()
            env["DOCS_SCOPE"] = "repository"
            env["CONTRACT_VERSION"] = "docs-link-check/v1"
            env["GITHUB_OUTPUT"] = str(output)
            command = "node <<'NODE'\n" + self.node_script + "NODE\n"
            result = subprocess.run(
                ["/bin/sh", "-c", command],
                cwd=CONSUMER_FIXTURE,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("checked_files=2\n", output.read_text(encoding="utf-8"))
            self.assertIn(
                "contract_version=docs-link-check/v1\n",
                output.read_text(encoding="utf-8"),
            )
            self.assertIn("result=passed\n", output.read_text(encoding="utf-8"))

    def test_checker_passes_on_current_governance_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "github-output.txt"
            env = os.environ.copy()
            env["DOCS_SCOPE"] = "repository"
            env["CONTRACT_VERSION"] = "docs-link-check/v1"
            env["GITHUB_OUTPUT"] = str(output)
            command = "node <<'NODE'\n" + self.node_script + "NODE\n"
            result = subprocess.run(
                ["/bin/sh", "-c", command],
                cwd=ROOT,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertRegex(output.read_text(encoding="utf-8"), r"checked_files=[1-9][0-9]*\n")
            self.assertIn("broken_links=0\n", output.read_text(encoding="utf-8"))
            self.assertIn("result=passed\n", output.read_text(encoding="utf-8"))

    def test_repository_scope_passes_and_scans_outside_docs(self) -> None:
        result, output = self.run_checker(
            "repository",
            {
                "README.md": "[docs](docs/index.md)\n",
                "docs/index.md": "# Docs\n",
            },
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("checked_files=2\n", output)
        self.assertIn("result=passed\n", output)

    def test_missing_link_fails_with_failure_output(self) -> None:
        result, output = self.run_checker(
            "docs", {"docs/index.md": "[missing](no-file.md)\n"}
        )
        self.assertEqual(1, result.returncode)
        self.assertIn("missing target", result.stderr)
        self.assertNotIn("no-file.md", result.stderr)
        self.assertIn("broken_links=1\n", output)
        self.assertIn("contract_version=docs-link-check/v1\n", output)
        self.assertIn("result=failed\n", output)

    def test_malformed_percent_escape_fails_closed(self) -> None:
        result, output = self.run_checker(
            "docs", {"docs/index.md": "[malformed](bad%ZZpath.md)\n"}
        )
        self.assertEqual(1, result.returncode)
        self.assertIn("malformed relative target", result.stderr)
        self.assertIn("broken_links=1\n", output)
        self.assertIn("result=failed\n", output)

    def test_path_escape_fails_closed(self) -> None:
        result, output = self.run_checker(
            "docs",
            {"docs/index.md": "[outside](../../outside.md)\n"},
            {"outside.md": "synthetic only\n"},
        )
        self.assertEqual(1, result.returncode)
        self.assertIn("link escapes checkout", result.stderr)
        self.assertIn("contract_version=docs-link-check/v1\n", output)
        self.assertIn("result=failed\n", output)

    def test_empty_scope_and_symlink_escape_fail_closed(self) -> None:
        result, output = self.run_checker("docs", {})
        self.assertEqual(1, result.returncode)
        self.assertIn("no Markdown files found", result.stderr)
        self.assertIn("contract_version=docs-link-check/v1\n", output)
        self.assertIn("result=failed\n", output)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            (root / "docs").mkdir(parents=True)
            outside = Path(temp) / "private.md"
            outside.write_text("synthetic\n", encoding="utf-8")
            (root / "docs" / "escape.md").symlink_to(outside)
            (root / "docs" / "index.md").write_text("[outside](escape.md)\n", encoding="utf-8")
            output_path = root / "github-output.txt"
            env = os.environ.copy()
            env["DOCS_SCOPE"] = "docs"
            env["CONTRACT_VERSION"] = "docs-link-check/v1"
            env["GITHUB_OUTPUT"] = str(output_path)
            command = "node <<'NODE'\n" + self.node_script + "NODE\n"
            result = subprocess.run(
                ["/bin/sh", "-c", command],
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(1, result.returncode)
            self.assertIn("link resolves outside checkout", result.stderr)
            self.assertIn("result=failed\n", output_path.read_text(encoding="utf-8"))

    def test_docs_scope_inside_root_symlink_passes_for_all_copies(self) -> None:
        for script in self.node_scripts:
            with self.subTest(script_copy="source-fixture-starter"):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp) / "repo"
                    internal_docs = root / "documentation-source"
                    internal_docs.mkdir(parents=True)
                    (internal_docs / "index.md").write_text(
                        "[reference](reference.md)\n", encoding="utf-8"
                    )
                    (internal_docs / "reference.md").write_text(
                        "# Synthetic reference\n", encoding="utf-8"
                    )
                    (root / "docs").symlink_to(internal_docs, target_is_directory=True)
                    output = root / "github-output.txt"
                    env = os.environ.copy()
                    env["DOCS_SCOPE"] = "docs"
                    env["CONTRACT_VERSION"] = "docs-link-check/v1"
                    env["GITHUB_OUTPUT"] = str(output)
                    command = "node <<'NODE'\n" + script + "NODE\n"
                    result = subprocess.run(
                        ["/bin/sh", "-c", command],
                        cwd=root,
                        env=env,
                        text=True,
                        capture_output=True,
                        check=False,
                    )
                    self.assertEqual(0, result.returncode, result.stderr)
                    self.assertIn("checked_files=2\n", output.read_text(encoding="utf-8"))
                    self.assertIn("result=passed\n", output.read_text(encoding="utf-8"))

    def test_docs_scope_symlink_outside_root_fails_for_all_copies(self) -> None:
        for script in self.node_scripts:
            with self.subTest(script_copy="source-fixture-starter"):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp) / "repo"
                    outside_docs = Path(temp) / "sibling-synthetic"
                    outside_docs.mkdir()
                    (outside_docs / "outside.md").write_text(
                        "# Synthetic sibling content\n", encoding="utf-8"
                    )
                    root.mkdir()
                    (root / "docs").symlink_to(outside_docs, target_is_directory=True)
                    output = root / "github-output.txt"
                    env = os.environ.copy()
                    env["DOCS_SCOPE"] = "docs"
                    env["CONTRACT_VERSION"] = "docs-link-check/v1"
                    env["GITHUB_OUTPUT"] = str(output)
                    command = "node <<'NODE'\n" + script + "NODE\n"
                    result = subprocess.run(
                        ["/bin/sh", "-c", command],
                        cwd=root,
                        env=env,
                        text=True,
                        capture_output=True,
                        check=False,
                    )
                    contents = output.read_text(encoding="utf-8")
                    self.assertEqual(1, result.returncode)
                    self.assertIn("requested scope resolves outside checkout", result.stderr)
                    self.assertIn("checked_files=0\n", contents)
                    self.assertIn("broken_links=1\n", contents)
                    self.assertIn("contract_version=docs-link-check/v1\n", contents)
                    self.assertIn("result=failed\n", contents)

    def test_invalid_scope_and_missing_docs_fail_closed(self) -> None:
        result, output = self.run_checker(
            "$(touch GITHUB_INPUT_WAS_EXECUTED)",
            {"docs/index.md": "# x\n"},
        )
        self.assertEqual(1, result.returncode)
        self.assertIn("scope must be docs or repository", result.stderr)
        self.assertIn("contract_version=docs-link-check/v1\n", output)
        self.assertIn("result=failed\n", output)
        result, output = self.run_checker("docs", {}, make_docs=False)
        self.assertEqual(1, result.returncode)
        self.assertIn("docs scope requested but docs/ is missing", result.stderr)
        self.assertIn("contract_version=docs-link-check/v1\n", output)
        self.assertIn("result=failed\n", output)

    def test_untrusted_scope_is_data_and_cannot_run_shell(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            (root / "docs").mkdir(parents=True)
            (root / "docs/index.md").write_text("# Synthetic\n", encoding="utf-8")
            marker = root / "INPUT_WAS_EXECUTED"
            env = os.environ.copy()
            env["DOCS_SCOPE"] = f"$(touch {marker})"
            env["CONTRACT_VERSION"] = "docs-link-check/v1"
            output = root / "github-output.txt"
            env["GITHUB_OUTPUT"] = str(output)
            command = "node <<'NODE'\n" + self.node_script + "NODE\n"
            result = subprocess.run(
                ["/bin/sh", "-c", command],
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(1, result.returncode)
            self.assertIn("scope must be docs or repository", result.stderr)
            self.assertFalse(marker.exists())
            self.assertIn("contract_version=docs-link-check/v1\n", output.read_text(encoding="utf-8"))
            self.assertIn("result=failed\n", output.read_text(encoding="utf-8"))

    def test_unsafe_fork_policy_mutations_are_detected(self) -> None:
        unsafe = self.caller_text.replace("contents: read", "contents: write", 1)
        unsafe = unsafe.replace("on:\n  pull_request:", "on:\n  pull_request_target:", 1)
        unsafe += "\n    secrets: inherit\n"
        violations = policy_violations(self.source_text, unsafe)
        self.assertIn(
            "token permissions must be limited to contents: read", violations
        )
        self.assertIn("privileged trigger", violations)
        self.assertIn("inherited secrets", violations)

        explicit_secret = self.caller_text + "\n# synthetic unsafe mutation\n${{ secrets.DEMO_TOKEN }}\n"
        self.assertIn("secret reference", policy_violations(self.source_text, explicit_secret))

        unsafe_permission_mutations = (
            self.caller_text.replace("permissions:\n  contents: read", "permissions: write-all", 1),
            self.caller_text.replace("contents: read", "id-token: write", 1),
            self.caller_text.replace("contents: read", "actions: write", 1),
        )
        for mutated in unsafe_permission_mutations:
            with self.subTest(permission_mutation=mutated.splitlines()[4:8]):
                self.assertIn(
                    "token permissions must be limited to contents: read",
                    policy_violations(self.source_text, mutated),
                )

    def test_quoted_job_permissions_bypass_is_rejected(self) -> None:
        for key in ('"permissions"', "'permissions'"):
            with self.subTest(key=key):
                mutated = self.caller_text.replace(
                    "    permissions:\n      contents: read",
                    f"    {key}: write-all",
                )
                self.assertEqual(
                    "write-all", yaml.safe_load(mutated)["jobs"]["report"]["permissions"]
                )
                self.assertIn(
                    "token permissions must be limited to contents: read",
                    policy_violations(self.source_text, mutated),
                )

    def test_flow_permissions_and_added_write_scopes_are_rejected(self) -> None:
        for permissions in (
            "write-all",
            "{contents: write}",
            "{contents: read, id-token: write}",
            "{contents: read, actions: write}",
        ):
            for key in ("permissions", '"permissions"'):
                with self.subTest(permissions=permissions, key=key):
                    workflow = (
                        "permissions: {contents: read}\n"
                        "jobs: {first: {permissions: {}}, report: {"
                        + key + ": " + permissions + "}}\n"
                    )
                    self.assertTrue(permission_violations(workflow))

    def test_unsafe_defaults_and_unknown_inherited_permissions_are_rejected(self) -> None:
        workflows = (
            '"permissions": write-all\njobs: {report: {}}\n',
            "permissions: {contents: read, id-token: write}\njobs: {report: {}}\n",
            "permissions: write-all\njobs: {report: {permissions: {contents: read}}}\n",
            "jobs: {first: {permissions: {}}, report: {}}\n",
        )
        for workflow in workflows:
            with self.subTest(workflow=workflow):
                self.assertTrue(permission_violations(workflow))

    def test_safe_minimal_permissions_and_inheritance_are_accepted(self) -> None:
        workflows = (
            '"permissions": {"contents": "read"}\njobs: {report: {}}\n',
            "permissions: {}\njobs: {report: {}}\n",
            "permissions: {contents: read}\njobs: {report: {permissions: {}}}\n",
            "jobs: {report: {'permissions': {'contents': 'read'}}}\n",
            "jobs: {report: {permissions: {contents: none}}}\n",
        )
        for workflow in workflows:
            with self.subTest(workflow=workflow):
                self.assertEqual([], permission_violations(workflow))

    def test_workflow_documents_are_checked_separately(self) -> None:
        safe = "permissions: {contents: read}\njobs: {report: {}}\n"
        unsafe = "permissions: write-all\njobs: {report: {}}\n"
        for workflows in ((unsafe, safe), (safe, unsafe), (safe, safe, unsafe)):
            with self.subTest(workflows=workflows):
                self.assertIn(
                    "token permissions must be limited to contents: read",
                    policy_violations(*workflows),
                )
        self.assertEqual([], policy_violations(safe, safe, safe))

    def test_unsupported_or_ambiguous_permission_forms_fail_closed(self) -> None:
        workflows = (
            "permissions: {contents: read}\npermissions: write-all\njobs: {report: {}}\n",
            "permissions: write-all\npermissions: {contents: read}\njobs: {report: {}}\n",
            "jobs: {report: {permissions: null}}\n",
            "jobs: {report: {permissions: [contents, read]}}\n",
            "jobs: {report: {permissions: {contents: read-all}}}\n",
            "jobs: {report: {permissions: read-all}}\n",
            "jobs: {report: null}\n",
            "jobs: []\n",
            "jobs: {report: {permissions: {}}}\n---\njobs: {other: {}}\n",
        )
        for workflow in workflows:
            with self.subTest(workflow=workflow):
                self.assertTrue(permission_violations(workflow))


if __name__ == "__main__":
    unittest.main()
