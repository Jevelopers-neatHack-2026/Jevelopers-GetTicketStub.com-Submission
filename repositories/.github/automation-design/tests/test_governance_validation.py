from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts import validate_governance as validator  # noqa: E402


def valid_form():
    return {
        "name": "Bug report",
        "description": "Report a sanitized defect.",
        "title": "[BUG] <summary>",
        "labels": ["type:bug"],
        "assignees": ["triage"],
        "projects": ["example/1"],
        "body": [
            {
                "type": "markdown",
                "attributes": {"value": "Do not paste secrets."},
            },
            {
                "type": "input",
                "id": "summary",
                "attributes": {"label": "Summary", "placeholder": "What happened?"},
                "validations": {"required": True, "min_length": 1},
            },
            {
                "type": "dropdown",
                "id": "priority",
                "attributes": {
                    "label": "Priority",
                    "options": ["P0", "P1", "P2"],
                    "default": 1,
                },
                "validations": {"required": True},
            },
            {
                "type": "checkboxes",
                "id": "acknowledgements",
                "attributes": {
                    "label": "Acknowledgements",
                    "options": [{"label": "I have removed secrets.", "required": True}],
                },
                "validations": {"required": True},
            },
            {
                "type": "textarea",
                "id": "attachments",
                "attributes": {"label": "Logs", "render": "text"},
                "validations": {"required": False},
            },
            {
                "type": "upload",
                "id": "files",
                "attributes": {"label": "Safe files"},
                "validations": {"accept": ".png,.txt", "required": False},
            },
        ],
    }


def runnable_workflow():
    return {
        "on": {"workflow_call": {}},
        "permissions": {"contents": "read"},
        "jobs": {
            "validate": {
                "runs-on": "ubuntu-latest",
                "timeout-minutes": 5,
                "permissions": {"contents": "read"},
                "steps": [{"run": "python3 -V"}],
            }
        },
    }


def caller_workflow():
    return {
        "on": {"pull_request": {"branches": ["main"]}},
        "permissions": {"contents": "read"},
        "concurrency": {"group": "ci-${{ github.ref }}", "cancel-in-progress": True},
        "jobs": {
            "docs": {
                "uses": "./.github/workflows/docs-check.yml",
                "with": {"scope": "repository"},
                "permissions": {"contents": "read"},
            }
        },
    }


def observation_fixture():
    observed_at = "2026-10-12T12:00:00Z"
    head_metadata_time = "2026-10-12T17:19:49Z"
    sha = "a" * 40
    names = [".github"] + ["consumer-{:02d}".format(i) for i in range(1, 15)]
    rows = []
    for index, name in enumerate(names):
        count = 4 if index == 0 else 5 if index == 1 else 3
        rows.append(
            {
                "name": name,
                "visibility": "public",
                "role": "governance_source" if index == 0 else "consumer",
                "default_branch": "main",
                "head_sha": sha,
                "observed_at": observed_at,
                "source_url": "https://github.com/Jevelopers-neatHack-2026/{}/tree/{}".format(name, sha),
                "tree_status": "complete",
                "artifacts": {
                    key: (
                        {"status": "present", "paths": [".github/workflows/check-{}.yml".format(i) for i in range(count)]}
                        if key == "workflow_files"
                        else {"status": "unknown", "paths": []}
                    )
                    for key in (
                        "agents_md", "contributing", "code_of_conduct", "security", "support",
                        "ownership_docs", "issue_forms", "pull_request_template", "workflow_files",
                        "adoption_record", "adoption_register", "codeowners",
                    )
                },
                "nested_paths": [],
                "local_overrides": False,
                "workflow_audit": {
                    "status": "inspected",
                    "workflow_file_count": count,
                    "parse_status": "complete",
                    "invalid_yaml_count": 0,
                    "shared_workflow_caller_count": 0,
                    "workflow_definition_count": 0,
                },
                "settings": {
                    "branch_protected": None,
                    "branch_protection_detail": "unknown",
                    "ruleset_count": None,
                    "label_catalogue": "unknown",
                    "inherited_profile_effective": "unknown",
                },
                "adoption_status": "not_applicable" if index == 0 else "not_verified",
            }
        )
    return {
        "schema_version": "1.0",
        "observed_at": "2026-10-12T12:01:00Z",
        "head_metadata_observed_at": head_metadata_time,
        "settings_observed_at": head_metadata_time,
        "latest_default_branch_heads": [
            {"name": row["name"], "head_sha": row["head_sha"], "observed_at": head_metadata_time}
            for row in rows
        ],
        "observer": "governance audit",
        "scope": {
            "organization": "Jevelopers-neatHack-2026",
            "inventory_source": "public repository metadata and trees",
            "repository_count": 16,
            "metadata_inspected": 16,
            "public_tree_inspected": 15,
            "private_source_unavailable": 1,
            "public_consumer_count": 14,
            "private_details_withheld": True,
        },
        "summary": {
            "public_repository_records": 15,
            "private_metadata_records": 1,
            "verified_adopted_consumers": 0,
            "workflow_files_inspected": 48,
            "shared_workflow_callers": 0,
            "workflow_definitions": 0,
        },
        "authoring_runtime": {
            "model": "gpt-6-luna",
            "reasoning_effort": "max",
            "service_tier": "priority",
            "route": "Fast",
            "pack_version": "1.1.0",
            "usage": None,
            "cost": None,
            "receipt_path": "unavailable (no per-call execution receipt exposed)",
            "metadata_source": "task delegation routing instruction",
        },
        "repositories": rows,
    }


class IssueFormValidatorTests(unittest.TestCase):
    def test_supported_issue_form_subset_accepts_documented_element_types(self) -> None:
        self.assertEqual([], validator.validate_form_document(valid_form(), "sample.yml"))

    def test_duplicate_ids_bad_dropdown_default_and_bad_types_fail(self) -> None:
        document = valid_form()
        document["body"][2]["id"] = "summary"
        document["body"][2]["attributes"]["default"] = True
        document["body"][2]["attributes"]["multiple"] = "no"
        errors = validator.validate_form_document(document, "sample.yml")
        self.assertTrue(any("duplicate field id" in error for error in errors), errors)
        self.assertTrue(any("default` must be an integer" in error for error in errors), errors)
        self.assertTrue(any("multiple` must be boolean" in error for error in errors), errors)

    def test_unknown_form_schema_keys_fail_instead_of_silently_passing(self) -> None:
        document = valid_form()
        document["mystery"] = True
        errors = validator.validate_form_document(document, "sample.yml")
        self.assertTrue(any("unsupported top-level key" in error for error in errors), errors)

    def test_labels_and_assignees_accept_documented_comma_delimited_strings(self) -> None:
        document = valid_form()
        document["labels"] = "bug, triage"
        document["assignees"] = "octocat"
        self.assertEqual([], validator.validate_form_document(document, "sample.yml"))
        document["projects"] = "example/1"
        errors = validator.validate_form_document(document, "sample.yml")
        self.assertTrue(any("projects` must be a list" in error for error in errors), errors)

    def test_empty_or_null_active_form_and_chooser_documents_fail(self) -> None:
        for config_text, form_text in (("", "null\n"), ("null\n", "")):
            with self.subTest(config_text=config_text, form_text=form_text):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    folder = root / ".github/ISSUE_TEMPLATE"
                    folder.mkdir(parents=True)
                    (folder / "config.yml").write_text(config_text, encoding="utf-8")
                    (folder / "active-form.yml").write_text(form_text, encoding="utf-8")
                    errors = validator.validate_issue_forms(root)
                self.assertTrue(any("config.yml: YAML document is empty or has a null top-level value" in error for error in errors), errors)
                self.assertTrue(any("active-form.yml: YAML document is empty or has a null top-level value" in error for error in errors), errors)


class WorkflowPolicyValidatorTests(unittest.TestCase):
    def test_runnable_reusable_workflow_and_caller_shapes_pass(self) -> None:
        self.assertEqual([], validator.validate_workflow_document(runnable_workflow(), "source"))
        self.assertEqual([], validator.validate_workflow_document(caller_workflow(), "caller"))

    def test_secret_context_references_fail_across_supported_expression_forms(self) -> None:
        expressions = (
            "${{ secrets.DEMO_TOKEN }}",
            "${{ secrets['DEMO_TOKEN'] }}",
            "${{ toJSON(secrets) }}",
            "${{ format('{0}', secrets.DEMO_TOKEN) }}",
            "${{ format('{0}', SeCrEtS['DEMO_TOKEN']) }}",
            "${{secrets.DEMO_TOKEN}}",
            "${{secrets}}",
            "${{github.ref}}-${{secrets.DEMO_TOKEN}}",
            "${{github.ref}}${{toJSON(secrets)}}",
        )
        for expression in expressions:
            with self.subTest(expression=expression):
                document = runnable_workflow()
                document["jobs"]["validate"]["steps"][0]["env"] = {"VALUE": expression}
                errors = validator.validate_workflow_document(document, "secret-reference")
                self.assertTrue(
                    any("must not declare, reference, or inherit secrets" in error for error in errors),
                    errors,
                )

    def test_secret_context_literals_and_other_context_properties_are_safe(self) -> None:
        safe_values = (
            "${{ format('{0}', 'secrets.DEMO_TOKEN') }}",
            "${{ 'it''s only the word secrets.DEMO_TOKEN' }}",
            "${{ 'literal }} secrets.DEMO_TOKEN' }}",
            "${{ github['secrets'] }}",
            "echo secrets.DEMO_TOKEN",
        )
        for value in safe_values:
            with self.subTest(value=value):
                document = runnable_workflow()
                document["jobs"]["validate"]["steps"][0]["env"] = {"VALUE": value}
                self.assertEqual([], validator.validate_workflow_document(document, "safe-literal"))

        # GitHub also permits the `${{ }}` wrapper to be omitted for `if`.
        document = runnable_workflow()
        document["jobs"]["validate"]["steps"][0]["if"] = (
            "contains(github.ref, 'secrets.DEMO_TOKEN')"
        )
        self.assertEqual([], validator.validate_workflow_document(document, "safe-if-literal"))

        document["jobs"]["validate"]["steps"][0]["if"] = "toJSON(secrets) != ''"
        errors = validator.validate_workflow_document(document, "secret-if-reference")
        self.assertTrue(
            any("must not declare, reference, or inherit secrets" in error for error in errors),
            errors,
        )

    def test_write_scope_and_privileged_event_fail(self) -> None:
        document = runnable_workflow()
        document["permissions"] = {"contents": "write"}
        document["on"]["pull_request_target"] = {}
        document["unknown-github-key"] = True
        errors = validator.validate_workflow_document(document, "unsafe")
        self.assertTrue(any("privileged trigger" in error for error in errors), errors)
        self.assertTrue(any("only `contents: read`/`none`" in error for error in errors), errors)
        self.assertTrue(any("unsupported top-level workflow key" in error for error in errors), errors)

    def test_runnable_jobs_require_bounded_timeout_and_pinned_checkout_without_credentials(self) -> None:
        document = runnable_workflow()
        job = document["jobs"]["validate"]
        job.pop("timeout-minutes")
        job["steps"] = [{"uses": "actions/checkout@v7"}]
        errors = validator.validate_workflow_document(document, "unsafe")
        self.assertTrue(any("bounded `timeout-minutes`" in error for error in errors), errors)
        self.assertTrue(any("full 40-character commit SHA" in error for error in errors), errors)

    def test_step_cannot_mix_action_and_shell_commands(self) -> None:
        document = runnable_workflow()
        document["jobs"]["validate"]["steps"] = [
            {"uses": "actions/checkout@" + validator.CHECKOUT_SHA, "run": "echo unsafe"}
        ]
        errors = validator.validate_workflow_document(document, "ambiguous-step")
        self.assertTrue(any("exactly one of `uses` or `run`" in error for error in errors), errors)

    def test_reusable_caller_rejects_unsupported_timeout_and_other_job_keys(self) -> None:
        document = caller_workflow()
        document["jobs"]["docs"]["timeout-minutes"] = 5
        document["jobs"]["docs"]["runs-on"] = "ubuntu-latest"
        errors = validator.validate_workflow_document(document, "caller")
        self.assertTrue(any("unsupported job key(s): runs-on, timeout-minutes" in error for error in errors), errors)
        self.assertTrue(any("timeout-minutes` is not supported" in error for error in errors), errors)

    def test_checked_in_reusable_source_is_installed_byte_for_byte(self) -> None:
        source = ROOT / "automation-design/examples/reusable/.github/workflows/docs-check.yml"
        installed = ROOT / ".github/workflows/docs-check.yml"
        self.assertEqual(source.read_bytes(), installed.read_bytes())
        self.assertEqual([], validator.validate_workflows(ROOT))


class GovernanceRegisterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads((ROOT / "adoption/governance-register.json").read_text(encoding="utf-8"))

    def validate_copy(self, data):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "adoption/governance-register.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(data), encoding="utf-8")
            return validator.validate_governance_register(Path(temp))

    def test_historical_register_passes_without_rewriting_its_snapshot(self) -> None:
        self.assertEqual([], validator.validate_governance_register(ROOT))

    def test_missing_owner_and_evidence_reference_fail(self) -> None:
        data = copy.deepcopy(self.data)
        artifact = data["repositories"][0]["artifacts"][0]
        artifact["owner_role"] = "unconfirmed role"
        artifact["source_refs"] = ["not-in-catalog"]
        errors = self.validate_copy(data)
        self.assertTrue(any("owner role must match" in error for error in errors), errors)
        self.assertTrue(any("unresolved evidence" in error for error in errors), errors)

    def test_unknown_category_and_status_join_fail(self) -> None:
        data = copy.deepcopy(self.data)
        artifact = data["repositories"][0]["artifacts"][0]
        artifact["category_id"] = "noncanonical-category"
        artifact["verification_ref"] = "noncanonical-category"
        errors = self.validate_copy(data)
        self.assertTrue(any("unknown category" in error for error in errors), errors)


class ObservationSnapshotTests(unittest.TestCase):
    def validate_copy(self, data):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "adoption/observations/organization-adoption-2026-10-12.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(data), encoding="utf-8")
            return validator.validate_observation_snapshot(Path(temp))

    def test_public_records_and_withheld_private_aggregate_pass(self) -> None:
        self.assertEqual([], self.validate_copy(observation_fixture()))

    def test_stale_observation_and_missing_sha_fail(self) -> None:
        data = observation_fixture()
        data["repositories"][2]["observed_at"] = "2026-10-11T23:59:59Z"
        data["repositories"][2]["head_sha"] = "not-a-commit"
        errors = self.validate_copy(data)
        self.assertTrue(any("stale or later" in error for error in errors), errors)
        self.assertTrue(any("full 40-character commit SHA" in error for error in errors), errors)

    def test_later_head_metadata_is_separate_from_pinned_tree_revision(self) -> None:
        data = observation_fixture()
        data["latest_default_branch_heads"][0]["head_sha"] = "b" * 40
        self.assertEqual([], self.validate_copy(data))
        data["head_metadata_observed_at"] = "2026-10-12T11:59:00Z"
        errors = self.validate_copy(data)
        self.assertTrue(any("later same-day observation" in error for error in errors), errors)

    def test_settings_timestamp_must_join_to_head_metadata_time(self) -> None:
        data = observation_fixture()
        data["settings_observed_at"] = "2026-10-12T17:18:49Z"
        errors = self.validate_copy(data)
        self.assertTrue(any("settings_observed_at` must equal `head_metadata_observed_at`" in error for error in errors), errors)

    def test_repository_and_latest_head_timestamps_must_use_utc(self) -> None:
        data = observation_fixture()
        data["repositories"][0]["observed_at"] = "2026-10-12T13:00:00+01:00"
        data["latest_default_branch_heads"][0]["observed_at"] = "2026-10-12T18:19:49+01:00"
        errors = self.validate_copy(data)
        self.assertTrue(any("repositories[0]: `observed_at` must be timezone-aware UTC ISO-8601" in error for error in errors), errors)
        self.assertTrue(any("latest_default_branch_heads[0]: `observed_at` must be UTC" in error for error in errors), errors)

    def test_unavailable_runtime_receipt_cannot_be_replaced_with_a_fabricated_path(self) -> None:
        data = observation_fixture()
        data["authoring_runtime"]["receipt_path"] = "scratch/runtime-receipt.json"
        errors = self.validate_copy(data)
        self.assertTrue(any("runtime receipt must state when no per-call receipt is exposed" in error for error in errors), errors)

    def test_private_row_and_mismatched_workflow_summary_fail(self) -> None:
        data = observation_fixture()
        data["repositories"][1]["visibility"] = "private"
        data["latest_default_branch_heads"][1]["name"] = "private-repository"
        data["summary"]["workflow_files_inspected"] = 49
        errors = self.validate_copy(data)
        self.assertTrue(any("only public repository records" in error for error in errors), errors)
        self.assertTrue(any("workflow file summary does not join" in error for error in errors), errors)
        self.assertTrue(any("latest-head metadata names must join" in error for error in errors), errors)

    def test_absent_artifact_cannot_include_a_path(self) -> None:
        data = observation_fixture()
        data["repositories"][0]["artifacts"]["security"] = {
            "status": "absent", "paths": ["SECURITY.md"]
        }
        errors = self.validate_copy(data)
        self.assertTrue(any("marked absent includes observed paths" in error for error in errors), errors)

    def test_complete_offline_validation_passes_on_isolated_fixture_copy(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "checkout"
            shutil.copytree(
                ROOT,
                root,
                ignore=shutil.ignore_patterns(".git", ".venv", "__pycache__", "*.pyc"),
            )
            snapshot = root / "adoption/observations/organization-adoption-2026-10-12.json"
            snapshot.parent.mkdir(parents=True, exist_ok=True)
            snapshot.write_text(json.dumps(observation_fixture()), encoding="utf-8")
            errors, stats = validator.run_validation(root)
            self.assertEqual([], errors)
            self.assertEqual(18, stats["profile_assets"])


class DocumentationAndReleasePrerequisiteTests(unittest.TestCase):
    def test_supported_relative_links_and_profile_assets_pass(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "docs").mkdir()
            (root / "docs/index.md").write_text('[Guide](guide.md)\n', encoding="utf-8")
            (root / "docs/guide.md").write_text("# Guide\n", encoding="utf-8")
            (root / "profile/assets").mkdir(parents=True)
            (root / "profile/assets/banner.svg").write_text("<svg/>", encoding="utf-8")
            (root / "profile/README.md").write_text(
                '<img alt="banner" src="./assets/banner.svg">\n', encoding="utf-8"
            )
            errors, stats = validator.validate_markdown_links(root)
            self.assertEqual([], errors)
            self.assertEqual(1, stats["profile_assets"])

    def test_broken_link_missing_image_alt_and_missing_asset_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "profile").mkdir()
            (root / "README.md").write_text(
                '[Missing](missing.md)\n[Malformed](https://[invalid)\n', encoding="utf-8"
            )
            (root / "profile/README.md").write_text(
                '<img src="./assets/missing.svg">\n', encoding="utf-8"
            )
            errors, _ = validator.validate_markdown_links(root)
            self.assertTrue(any("does not exist" in error for error in errors), errors)
            self.assertTrue(any("malformed link target" in error for error in errors), errors)
            self.assertTrue(any("missing an `alt`" in error for error in errors), errors)

    def test_release_template_requires_publication_authority_prerequisite(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "templates/release-record.md"
            path.parent.mkdir()
            original = (ROOT / "templates/release-record.md").read_text(encoding="utf-8")
            path.write_text(original.replace("Publication authorization/settings evidence", "Evidence"), encoding="utf-8")
            errors = validator.validate_release_template(root)
            self.assertTrue(any("publication authority evidence" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()
