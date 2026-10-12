"""Regression checks for the Entire workflow's ref and token trust boundary."""

import re
import unittest
from pathlib import Path
from textwrap import dedent
from typing import Final, final

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "entire-graph.yml"

PERMISSION_NAMES: Final[str] = """
    actions
    |attestations
    |checks
    |contents
    |deployments
    |discussions
    |id-token
    |issues
    |models
    |packages
    |pages
    |pull-requests
    |repository-projects
    |security-events
    |statuses
    |permissions
"""
AUTH_ENV_VARIABLES: Final[str] = "GH_TOKEN|GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN"

WRITE_PERMISSION: Final[re.Pattern[str]] = re.compile(
    rf"""(?ix)
    (?:^|[\x7b,]|\s)['\"]?(?:{PERMISSION_NAMES})['\"]?\s*:\s*
    ['\"]?write(?:-all)?['\"]?\b
    """
)
TOKEN_OR_SECRET: Final[re.Pattern[str]] = re.compile(
    rf"(?ix)\b(?:{AUTH_ENV_VARIABLES})\b|github\.token|\bsecrets\."
)
ACTION_USE: Final[re.Pattern[str]] = re.compile(r"(?im)^\s*-\s*uses:\s*([^\s#]+)")
CHECKOUT_USE: Final[re.Pattern[str]] = re.compile(r"(?im)^\s*-\s*uses:\s*actions/checkout@")


def _extract_trigger_headers(
    lines: list[str],
) -> tuple[list[tuple[int, str, str]], int] | None:
    """Read the literal YAML ``on`` map and its direct event children."""
    on_headers: list[int] = [
        index for index, line in enumerate(lines) if re.fullmatch(r"(?:on|'on'|\"on\"):\s*.*", line)
    ]
    if len(on_headers) != 1:
        return None

    on_index = on_headers[0]
    if lines[on_index].split(":", 1)[1].strip():
        return None

    event_headers: list[tuple[int, str, str]] = []
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
            name = event.group(1) or event.group(2) or event.group(3) or ""
            value = event.group(4) or ""
            event_headers.append((index, name, value))

    return event_headers, end


def _trigger_body(
    lines: list[str],
    event_headers: list[tuple[int, str, str]],
    offset: int,
    end: int,
) -> list[str]:
    header_index = event_headers[offset][0]
    body_end = event_headers[offset + 1][0] if offset + 1 < len(event_headers) else end
    return [line for line in lines[header_index + 1 : body_end] if line.strip()]


def _push_trigger_is_exact(body: list[str]) -> bool:
    return (
        len(body) == 1
        and re.fullmatch(r" {4}branches:\s*\[\s*(?:main|'main'|\"main\")\s*\]", body[0]) is not None
    )


def _schedule_trigger_is_intended(body: list[str]) -> bool:
    return (
        len(body) == 1
        and re.fullmatch(
            r" {4}- cron:\s*(?:'17 4 \* \* 1'|\"17 4 \* \* 1\"|17 4 \* \* 1)",
            body[0],
        )
        is not None
    )


def _trigger_policy_violations(document: str) -> list[str]:
    """Check the workflow's narrow trigger map without YAML 1.1 coercing ``on``."""
    lines: list[str] = [line.split("#", 1)[0].rstrip() for line in document.splitlines()]
    parsed = _extract_trigger_headers(lines)
    if parsed is None:
        return ["unsupported top-level trigger syntax"]
    event_headers, end = parsed
    names = [name for _, name, _ in event_headers]
    if sorted(names) != ["push", "schedule"] or any(value for _, _, value in event_headers):
        return ["unexpected top-level workflow trigger"]

    violations: list[str] = []
    for offset, (_, name, _) in enumerate(event_headers):
        body = _trigger_body(lines, event_headers, offset, end)
        if name == "push":
            if not _push_trigger_is_exact(body):
                violations.append("push is not restricted exactly to main")
        elif not _schedule_trigger_is_intended(body):
            violations.append("schedule does not match the intended trigger")
    return violations


def _permission_children(lines: list[str], index: int, indent: int) -> list[str]:
    children: list[str] = []
    for child in lines[index + 1 :]:
        if child.strip() and not child[0].isspace():
            break
        if child.strip():
            child_indent = len(child) - len(child.lstrip())
            if child_indent <= indent:
                break
        children.append(child)
    return children


def _permission_child_violations(child: str) -> list[str]:
    permission = re.fullmatch(
        r"\s+['\"]?([A-Za-z-]+)['\"]?:\s*['\"]?([A-Za-z-]+)['\"]?\s*",
        child,
    )
    if not permission:
        return ["unsupported permissions syntax"]
    permission_level = (permission.group(2) or "").lower()
    if permission_level not in ("read", "none", "write"):
        return ["unsupported permissions syntax"]
    if permission_level == "write":
        return ["write permission"]
    return []


def _permission_violations(lines: list[str]) -> list[str]:
    violations: list[str] = []
    if WRITE_PERMISSION.search("\n".join(lines)):
        violations.append("write permission")

    permission_blocks: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        header = re.fullmatch(r"( *)permissions:\s*(.*)", line)
        if not header:
            continue
        indent = len(header.group(1) or "")
        declaration = [line]
        value = (header.group(2) or "").strip()
        if value:
            violations.append("unsupported permissions syntax")
            continue
        children = _permission_children(lines, index, indent)
        for child in children:
            if child.strip():
                violations.extend(_permission_child_violations(child))
        declaration.extend(children)
        permission_blocks.append((indent, "\n".join(declaration)))

    root_permissions: str | None = next(
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
    return violations


def _checkout_violations(lines: list[str]) -> list[str]:
    violations: list[str] = []
    checkout_indices: list[int] = [
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
        persists_credentials = re.search(
            r"(?im)^\s+persist-credentials:\s*false\s*$", "\n".join(step_lines)
        )
        if not persists_credentials:
            violations.append("checkout credentials persist")
            break
    return violations


def _workflow_violations(document: str) -> list[str]:
    """Return conservative policy failures without requiring a YAML dependency."""
    lines: list[str] = [line.split("#", 1)[0].rstrip() for line in document.splitlines()]
    clean = "\n".join(lines)
    violations = _trigger_policy_violations(document)
    violations.extend(_permission_violations(lines))
    if TOKEN_OR_SECRET.search(clean):
        violations.append("token or secret exposure")
    if re.search(r"(?i)\bgit\s+(?:push|commit)\b", clean):
        violations.append("repository write command")

    action_refs: list[str] = ACTION_USE.findall(clean)
    if not action_refs or any(
        not re.fullmatch(r"[^@\s]+@[0-9a-f]{40}", reference) for reference in action_refs
    ):
        violations.append("mutable or missing action SHA pin")
    violations.extend(_checkout_violations(lines))
    return violations


def _unsafe_event_workflow(event: str, selected_ref: str | None = None) -> str:
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


@final
class EntireGraphWorkflowSecurityTests(unittest.TestCase):
    workflow: Final[str] = WORKFLOW_PATH.read_text(encoding="utf-8")

    def test_workflow_has_exact_main_push_and_intended_schedule_triggers(self) -> None:
        assert _trigger_policy_violations(self.workflow) == []
        # GitHub treats this as the string key "on"; keep that semantics explicit
        # if a safe YAML 1.1 parser would otherwise coerce the unquoted key.
        quoted_on = self.workflow.replace("\non:\n", "\n'on':\n", 1)
        assert quoted_on != self.workflow
        assert _trigger_policy_violations(quoted_on) == []
        assert "publish-agent-instructions" not in self.workflow
        assert "push_branch" not in self.workflow
        assert _workflow_violations(self.workflow) == []

    def test_unexpected_top_level_workflow_events_are_rejected(self) -> None:
        for event in (
            "repository_dispatch",
            "workflow_run",
            "pull_request",
            "workflow_dispatch",
            "release",
            "future_untrusted_event",
        ):
            with self.subTest(event=event):
                unsafe = self.workflow.replace("  schedule:\n", f"  {event}:\n  schedule:\n", 1)
                assert "unexpected top-level workflow trigger" in _workflow_violations(unsafe)

    def test_trigger_mutations_cannot_broaden_push_or_change_schedule(self) -> None:
        for old, new in (
            ("branches: [main]", "branches: [main, feature]"),
            ("branches: [main]", "branches: [main]\n    paths: ['**']"),
            ("17 4 * * 1", "17 4 * * 2"),
        ):
            with self.subTest(mutation=new):
                unsafe = self.workflow.replace(old, new, 1)
                assert _trigger_policy_violations(unsafe) != []

    def test_pull_request_and_manual_workflows_with_write_scope_are_rejected(self) -> None:
        for event in ("pull_request", "workflow_dispatch"):
            with self.subTest(event=event):
                violations = _workflow_violations(_unsafe_event_workflow(event))
                assert "write permission" in violations

    def test_selected_ref_condition_cannot_authorize_a_write_token(self) -> None:
        for ref in (
            "refs/heads/main",
            "refs/heads/feature/untrusted",
            "refs/tags/untrusted",
        ):
            with self.subTest(ref=ref):
                violations = _workflow_violations(
                    _unsafe_event_workflow("workflow_dispatch", selected_ref=ref)
                )
                assert "write permission" in violations

    def test_flow_style_and_quoted_write_permissions_are_rejected(self) -> None:
        for declaration in (
            'permissions: { contents: "write" }',
            'permissions:\n  "contents": "write"',
            "permissions: write-all",
        ):
            with self.subTest(declaration=declaration):
                unsafe = dedent(
                    f"""\
                    name: unsafe fixture
                    on:
                      workflow_dispatch:
                    {declaration}
                    jobs:
                      publish:
                        runs-on: ubuntu-latest
                    """
                )
                assert "write permission" in _workflow_violations(unsafe)

    def test_read_only_pr_workflow_mutation_is_rejected(self) -> None:
        unsafe = self.workflow.replace(
            "permissions:\n  contents: read",
            "permissions:\n  contents: write",
            1,
        ).replace(
            "  push:\n",
            "  pull_request:\n  push:\n",
            1,
        )
        assert "write permission" in _workflow_violations(unsafe)

    def test_token_and_secret_references_are_rejected(self) -> None:
        unsafe = self.workflow + "\nenv:\n  LEAK: " + "$" + "{{ secrets.EXAMPLE }}\n"
        unsafe += "\nrun: echo " + "$" + "{{ github.token }}\n"
        violations = _workflow_violations(unsafe)
        assert "token or secret exposure" in violations

    def test_checkout_credentials_must_be_disabled(self) -> None:
        assert len(CHECKOUT_USE.findall(self.workflow)) == 1
        unsafe = self.workflow.replace("persist-credentials: false", "persist-credentials: true", 1)
        assert "checkout credentials persist" in _workflow_violations(unsafe)

    def test_every_action_must_use_a_full_commit_sha(self) -> None:
        match = re.search(r"(?m)^(\s*-\s*uses:\s*actions/checkout)@[0-9a-f]{40}", self.workflow)
        if match is None:
            self.fail("expected checkout to use a full SHA")
        unsafe = self.workflow[: match.end()] + "@v7" + self.workflow[match.end() :]
        assert "mutable or missing action SHA pin" in _workflow_violations(unsafe)

    def test_artifact_workflow_rejects_repository_mutations(self) -> None:
        unsafe = self.workflow + "\nrun: git push origin HEAD\n"
        assert "repository write command" in _workflow_violations(unsafe)


if __name__ == "__main__":
    _ = unittest.main()
