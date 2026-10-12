"""Regression checks for the Entire workflow's ref and token trust boundary."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "entire-graph.yml"

WRITE_PERMISSION = re.compile(
    r"(?i)(?:^|[,{]|\s)['\"]?(?:actions|attestations|checks|contents|deployments|"
    r"discussions|id-token|issues|models|packages|pages|pull-requests|"
    r"repository-projects|security-events|statuses|permissions)['\"]?\s*:\s*"
    r"['\"]?write(?:-all)?['\"]?\b"
)
TOKEN_OR_SECRET = re.compile(
    r"(?i)\b(?:GH_TOKEN|GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN)\b|"
    r"github\.token|\bsecrets\."
)
ACTION_USE = re.compile(r"(?im)^\s*-\s*uses:\s*([^\s#]+)")
CHECKOUT_USE = re.compile(r"(?im)^\s*-\s*uses:\s*actions/checkout@")


def _workflow_violations(document):
    """Return conservative policy failures without requiring a YAML dependency."""
    lines = [line.split("#", 1)[0].rstrip() for line in document.splitlines()]
    clean = "\n".join(lines)
    violations = []

    if WRITE_PERMISSION.search(clean):
        violations.append("write permission")

    permission_blocks = []
    for index, line in enumerate(lines):
        header = re.fullmatch(r"( *)permissions:\s*(.*)", line)
        if not header:
            continue
        indent = len(header.group(1))
        declaration = [line]
        value = header.group(2).strip()
        if value:
            violations.append("unsupported permissions syntax")
            continue
        for child in lines[index + 1 :]:
            if child.strip() and not child[0].isspace():
                break
            if child.strip():
                child_indent = len(child) - len(child.lstrip())
                if child_indent <= indent:
                    break
                permission = re.fullmatch(
                    r"\s+['\"]?([A-Za-z-]+)['\"]?:\s*['\"]?([A-Za-z-]+)['\"]?\s*",
                    child,
                )
                if not permission:
                    violations.append("unsupported permissions syntax")
                elif permission.group(2).lower() not in ("read", "none", "write"):
                    violations.append("unsupported permissions syntax")
                elif permission.group(2).lower() == "write":
                    violations.append("write permission")
            declaration.append(child)
        permission_blocks.append((indent, "\n".join(declaration)))

    root_permissions = next(
        (block for indent, block in permission_blocks if indent == 0),
        None,
    )
    if root_permissions is None:
        violations.append("missing explicit root permissions")
    else:
        has_read_contents = re.search(
            r"(?im)^\s+['\"]?contents['\"]?:\s*['\"]?read['\"]?\s*$",
            root_permissions,
        )
        if not has_read_contents:
            violations.append("root contents permission is not explicitly read-only")

    if TOKEN_OR_SECRET.search(clean):
        violations.append("token or secret exposure")

    if re.search(r"(?i)\bgit\s+(?:push|commit)\b", clean):
        violations.append("repository write command")

    action_refs = ACTION_USE.findall(clean)
    if not action_refs or any(
        not re.fullmatch(r"[^@\s]+@[0-9a-f]{40}", reference)
        for reference in action_refs
    ):
        violations.append("mutable or missing action SHA pin")

    checkout_indices = [
        index for index, line in enumerate(lines) if CHECKOUT_USE.search(line)
    ]
    for index in checkout_indices:
        step_indent = len(lines[index]) - len(lines[index].lstrip())
        step_lines = [lines[index]]
        for line in lines[index + 1 :]:
            if line.strip():
                indent = len(line) - len(line.lstrip())
                if indent <= step_indent and re.match(r"\s*-\s+", line):
                    break
            step_lines.append(line)
        if not re.search(r"(?im)^\s+persist-credentials:\s*false\s*$", "\n".join(step_lines)):
            violations.append("checkout credentials persist")
            break

    return violations


def _unsafe_event_workflow(event, selected_ref=None):
    condition = ""
    if selected_ref is not None:
        condition = f"    if: github.ref == '{selected_ref}'\n"
    return (
        "name: unsafe fixture\n"
        "on:\n"
        f"  {event}:\n"
        "permissions:\n"
        "  contents: read\n"
        "jobs:\n"
        "  publish:\n"
        f"{condition}"
        "    permissions:\n"
        "      contents: write\n"
    )


class EntireGraphWorkflowSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

    def test_workflow_runs_only_from_main_and_has_no_pr_or_manual_ref_event(self):
        self.assertRegex(self.workflow, r"(?m)^  push:\s*$")
        self.assertRegex(self.workflow, r"(?m)^  schedule:\s*$")
        self.assertRegex(self.workflow, r"(?m)^\s+branches:\s*\[main\]\s*$")
        self.assertNotRegex(
            self.workflow,
            r"(?m)^  (?:pull_request|pull_request_target|workflow_dispatch|workflow_run)\s*:",
        )
        self.assertNotIn("publish-agent-instructions", self.workflow)
        self.assertNotIn("push_branch", self.workflow)
        self.assertEqual(_workflow_violations(self.workflow), [])

    def test_pull_request_and_manual_workflows_with_write_scope_are_rejected(self):
        for event in ("pull_request", "workflow_dispatch"):
            with self.subTest(event=event):
                violations = _workflow_violations(_unsafe_event_workflow(event))
                self.assertIn("write permission", violations)

    def test_selected_ref_condition_cannot_authorize_a_write_token(self):
        for ref in (
            "refs/heads/main",
            "refs/heads/feature/untrusted",
            "refs/tags/untrusted",
        ):
            with self.subTest(ref=ref):
                violations = _workflow_violations(
                    _unsafe_event_workflow("workflow_dispatch", selected_ref=ref)
                )
                self.assertIn("write permission", violations)

    def test_flow_style_and_quoted_write_permissions_are_rejected(self):
        for declaration in (
            'permissions: { contents: "write" }',
            'permissions:\n  "contents": "write"',
            "permissions: write-all",
        ):
            with self.subTest(declaration=declaration):
                unsafe = (
                    "name: unsafe fixture\n"
                    "on:\n  workflow_dispatch:\n"
                    + declaration
                    + "\njobs:\n  publish:\n    runs-on: ubuntu-latest\n"
                )
                self.assertIn("write permission", _workflow_violations(unsafe))

    def test_read_only_pr_workflow_mutation_is_rejected(self):
        unsafe = self.workflow.replace(
            "permissions:\n  contents: read",
            "permissions:\n  contents: write",
            1,
        ).replace(
            "  push:\n",
            "  pull_request:\n  push:\n",
            1,
        )
        self.assertIn("write permission", _workflow_violations(unsafe))

    def test_token_and_secret_references_are_rejected(self):
        unsafe = self.workflow + "\nenv:\n  LEAK: " + "$" + "{{ secrets.EXAMPLE }}\n"
        unsafe += "\nrun: echo " + "$" + "{{ github.token }}\n"
        violations = _workflow_violations(unsafe)
        self.assertIn("token or secret exposure", violations)

    def test_checkout_credentials_must_be_disabled(self):
        self.assertEqual(len(CHECKOUT_USE.findall(self.workflow)), 1)
        unsafe = self.workflow.replace(
            "persist-credentials: false", "persist-credentials: true", 1
        )
        self.assertIn("checkout credentials persist", _workflow_violations(unsafe))

    def test_every_action_must_use_a_full_commit_sha(self):
        match = re.search(r"(?m)^(\s*-\s*uses:\s*actions/checkout)@[0-9a-f]{40}", self.workflow)
        self.assertIsNotNone(match)
        unsafe = self.workflow[: match.end()] + "@v7" + self.workflow[match.end() :]
        self.assertIn("mutable or missing action SHA pin", _workflow_violations(unsafe))

    def test_artifact_workflow_rejects_repository_mutations(self):
        unsafe = self.workflow + "\nrun: git push origin HEAD\n"
        self.assertIn("repository write command", _workflow_violations(unsafe))


if __name__ == "__main__":
    unittest.main()
