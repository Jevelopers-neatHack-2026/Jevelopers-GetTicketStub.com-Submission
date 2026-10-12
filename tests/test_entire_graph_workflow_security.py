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


def _trigger_policy_violations(document):
    """Check the workflow's narrow trigger map without YAML 1.1 coercing ``on``."""
    lines = [line.split("#", 1)[0].rstrip() for line in document.splitlines()]
    on_headers = [
        index
        for index, line in enumerate(lines)
        if re.fullmatch(r"(?:on|'on'|\"on\"):\s*.*", line)
    ]
    if len(on_headers) != 1:
        return ["unsupported top-level trigger syntax"]

    on_index = on_headers[0]
    if lines[on_index].split(":", 1)[1].strip():
        return ["unsupported top-level trigger syntax"]

    event_headers = []
    end = len(lines)
    for index in range(on_index + 1, len(lines)):
        line = lines[index]
        if line.strip() and not line[0].isspace():
            end = index
            break
        event = re.fullmatch(
            r"  (?:([A-Za-z][A-Za-z0-9_-]*)|'([^']+)'|\"([^\"]+)\"):\s*(.*)",
            line,
        )
        if event:
            name = event.group(1) or event.group(2) or event.group(3)
            event_headers.append((index, name, event.group(4)))

    names = [name for _, name, _ in event_headers]
    if sorted(names) != ["push", "schedule"] or any(value for _, _, value in event_headers):
        return ["unexpected top-level workflow trigger"]

    violations = []
    for offset, (header_index, name, _) in enumerate(event_headers):
        body_end = event_headers[offset + 1][0] if offset + 1 < len(event_headers) else end
        body = [line for line in lines[header_index + 1 : body_end] if line.strip()]
        if name == "push":
            if len(body) != 1 or not re.fullmatch(
                r" {4}branches:\s*\[\s*(?:main|'main'|\"main\")\s*\]", body[0]
            ):
                violations.append("push is not restricted exactly to main")
        elif name == "schedule":
            if len(body) != 1 or not re.fullmatch(
                r" {4}- cron:\s*(?:'17 4 \* \* 1'|\"17 4 \* \* 1\"|17 4 \* \* 1)",
                body[0],
            ):
                violations.append("schedule does not match the intended trigger")
    return violations


def _workflow_violations(document):
    """Return conservative policy failures without requiring a YAML dependency."""
    lines = [line.split("#", 1)[0].rstrip() for line in document.splitlines()]
    clean = "\n".join(lines)
    violations = []
    violations.extend(_trigger_policy_violations(document))

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

    def test_workflow_has_exact_main_push_and_intended_schedule_triggers(self):
        self.assertEqual(_trigger_policy_violations(self.workflow), [])
        # GitHub treats this as the string key "on"; keep that semantics explicit
        # if a safe YAML 1.1 parser would otherwise coerce the unquoted key.
        quoted_on = self.workflow.replace("\non:\n", "\n'on':\n", 1)
        self.assertNotEqual(quoted_on, self.workflow)
        self.assertEqual(_trigger_policy_violations(quoted_on), [])
        self.assertNotIn("publish-agent-instructions", self.workflow)
        self.assertNotIn("push_branch", self.workflow)
        self.assertEqual(_workflow_violations(self.workflow), [])

    def test_unexpected_top_level_workflow_events_are_rejected(self):
        for event in (
            "repository_dispatch",
            "workflow_run",
            "pull_request",
            "workflow_dispatch",
            "release",
            "future_untrusted_event",
        ):
            with self.subTest(event=event):
                unsafe = self.workflow.replace(
                    "  schedule:\n", f"  {event}:\n  schedule:\n", 1
                )
                self.assertIn(
                    "unexpected top-level workflow trigger",
                    _workflow_violations(unsafe),
                )

    def test_trigger_mutations_cannot_broaden_push_or_change_schedule(self):
        for old, new in (
            ("branches: [main]", "branches: [main, feature]"),
            ("branches: [main]", "branches: [main]\n    paths: ['**']"),
            ("17 4 * * 1", "17 4 * * 2"),
        ):
            with self.subTest(mutation=new):
                unsafe = self.workflow.replace(old, new, 1)
                self.assertNotEqual(_trigger_policy_violations(unsafe), [])

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
