import copy
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "tools"))
import verify_provider_readiness as readiness  # noqa: E402


FIXTURE_PATH = REPO_ROOT / "fixtures" / "provider-profile.json"
AS_OF = date(2026, 10, 10)


def load_fixture():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def cell_for(profile, capability_id):
    return next(item for item in profile["capabilities"] if item["id"] == capability_id)


def add_jev_admin_record(profile, *, valid_until="2026-10-20"):
    cell = cell_for(profile, "jev")
    config = cell["configuration"]
    config["account_ref"] = "urn:typesafe:account:development"
    config["project_ref"] = "urn:agent-harness:project:acv1"
    config["quota_status"] = "recorded"
    config["quota_summary"] = "Account limit documented; numeric value retained in administrator evidence."
    config["quota_evidence_ref"] = "evidence:admin/jev-quota"
    config["model"].update(
        {
            "requested": "jev-1.13.0",
            "identity_kind": "pinned",
            "policy_status": "approved",
            "approved_model": "jev-1.13.0",
            "approval_ref": "evidence:runtime/jev-model-policy",
            "approved_by_role": "Agent and research",
            "approved_at": "2026-10-01",
            "revalidate_by": "2026-11-01",
        }
    )
    cell["eligibility"].update(
        {
            "status": "eligible",
            "checked_at": "2026-10-01",
            "valid_until": valid_until,
            "account_ref": config["account_ref"],
            "project_ref": config["project_ref"],
            "evidence_ref": "evidence:admin/jev-eligibility",
        }
    )
    return cell


def add_jev_model_list_record(cell, *, valid_until="2026-10-20"):
    config = cell["configuration"]
    cell["metadata"].update(
        {
            "status": "observed",
            "kind": "model_list",
            "checked_at": "2026-10-01",
            "valid_until": valid_until,
            "endpoint": "https://api.typesafe.ai/v1/models",
            "account_ref": config["account_ref"],
            "project_ref": config["project_ref"],
            "requested_model": config["model"]["requested"],
            "resolved_model": None,
            "evidence_ref": "evidence:admin/jev-model-list",
        }
    )


class MembershipOnlyEnvironment:
    """Proves the checker asks whether a secret name exists, never reads it."""

    def keys(self):
        return ("TYPESAFE_API_KEY",)

    def __contains__(self, key):
        return key == "TYPESAFE_API_KEY"

    def __getitem__(self, key):
        raise AssertionError("credential values must never be read")


class ProviderReadinessTests(unittest.TestCase):
    def validate(self, profile):
        return readiness.validate_profile(profile, as_of=AS_OF)

    def first_issue(self, profile):
        errors, validated = self.validate(profile)
        self.assertIsNone(validated)
        self.assertTrue(errors)
        return errors[0]

    def test_fixture_is_valid_but_pending_and_keeps_all_gates_independent(self):
        profile = load_fixture()
        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        report = readiness.assess_profile(validated, mode="offline", as_of=AS_OF, environ={})

        self.assertEqual(report["status"], "pending")
        self.assertEqual(report["exit_code"], 2)
        self.assertFalse(report["network_accessed"])
        self.assertEqual([item["id"] for item in report["capabilities"]], list(readiness.EXPECTED_CAPABILITIES))
        self.assertEqual(report["development_execution"]["access_preference"], "codex_subscription")
        self.assertEqual(report["development_execution"]["model"], "gpt-image-2")
        self.assertEqual(report["development_execution"]["engine_api_integration"], "pending")
        self.assertEqual(report["development_execution"]["provider_metering"], "not_established")

        by_id = {item["id"]: item for item in report["capabilities"]}
        self.assertEqual(by_id["jev"]["eligibility"]["status"], "pending")
        self.assertEqual(by_id["gpt_image"]["requested_model"], None)
        self.assertEqual(by_id["gpt_image"]["billing_mode"], "unknown")
        self.assertEqual(by_id["planner_reasoning"]["provider"], None)
        self.assertEqual(by_id["generative_baseline"]["provider"], None)
        self.assertEqual(by_id["neatlogs"]["blocked_consumers"], ["SPN-01"])
        self.assertEqual(by_id["entire"]["blocked_consumers"], ["SPN-02"])
        self.assertEqual(by_id["gpt_image"]["status"], "pending")
        self.assertEqual(by_id["planner_reasoning"]["status"], "pending")
        self.assertEqual(by_id["generative_baseline"]["status"], "pending")
        self.assertIn("CREDENTIAL_ENV_ABSENT", {item["code"] for item in by_id["jev"]["blockers"]})

    def test_offline_serialization_is_deterministic_for_same_inputs(self):
        profile = load_fixture()
        report_a = readiness.assess_profile(profile, mode="offline", as_of=AS_OF, environ={})
        report_b = readiness.assess_profile(profile, mode="offline", as_of=AS_OF, environ={})
        self.assertEqual(
            json.dumps(report_a, sort_keys=True, separators=(",", ":")),
            json.dumps(report_b, sort_keys=True, separators=(",", ":")),
        )

    def test_missing_environment_is_rejected_with_sanitized_typed_error(self):
        profile = load_fixture()
        profile["environment"] = ""
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "CONFIG_VALUE_INVALID")
        self.assertEqual(issue["path"], "$.environment")
        self.assertEqual(issue["message"], "Expected a non-empty string.")

    def test_missing_credential_reference_is_pending_not_an_auth_success(self):
        profile = load_fixture()
        cell_for(profile, "jev")["configuration"]["credential_env"] = None
        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        report = readiness.assess_profile(validated, mode="offline", as_of=AS_OF, environ={})
        jev = next(item for item in report["capabilities"] if item["id"] == "jev")
        self.assertIn("CREDENTIAL_REFERENCE_MISSING", {item["code"] for item in jev["blockers"]})
        self.assertIsNone(jev["credential_reference"])
        self.assertEqual(jev["eligibility"]["status"], "pending")

    def test_empty_credential_reference_is_rejected(self):
        profile = load_fixture()
        cell_for(profile, "jev")["configuration"]["credential_env"] = ""
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "CONFIG_VALUE_INVALID")

    def test_placeholder_credential_reference_is_rejected(self):
        profile = load_fixture()
        cell_for(profile, "jev")["configuration"]["credential_env"] = "YOUR_TYPESAFE_API_KEY"
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "CREDENTIAL_REFERENCE_INVALID")
        self.assertNotIn("YOUR_TYPESAFE_API_KEY", issue["message"])

    def test_provider_rejects_arbitrary_and_insecure_endpoints(self):
        for endpoint in (
            "http://api.typesafe.ai/v1/systemone",
            "https://attacker.example/v1/systemone",
            "https://api.typesafe.ai/v1/systemone?token=hidden",
        ):
            with self.subTest(endpoint=endpoint):
                profile = load_fixture()
                cell_for(profile, "jev")["configuration"]["endpoint"] = endpoint
                issue = self.first_issue(profile)
                self.assertEqual(issue["code"], "ENDPOINT_UNSAFE")
                self.assertNotIn(endpoint, issue["message"])

    def test_wrong_provider_model_identifier_is_rejected(self):
        profile = load_fixture()
        cell_for(profile, "jev")["configuration"]["model"].update(
            {"requested": "not-a-typesafe-model", "identity_kind": "pinned"}
        )
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "MODEL_UNSUPPORTED")
        self.assertNotIn("not-a-typesafe-model", issue["message"])

    def test_unselected_planner_provider_cannot_carry_a_proposed_model(self):
        profile = load_fixture()
        cell = cell_for(profile, "planner_reasoning")
        cell["configuration"]["model"].update(
            {"requested": "model-example", "identity_kind": "pinned"}
        )
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "PROVIDER_SELECTION_REQUIRED")
        self.assertNotIn("model-example", issue["message"])

    def test_blocked_consumer_relationships_cannot_drift_from_assigned_issue(self):
        profile = load_fixture()
        cell_for(profile, "planner_reasoning")["blocked_consumers"].append("unrelated-consumer")
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "BLOCKED_CONSUMERS_MISMATCH")

    def test_unsupported_profile_version_is_rejected(self):
        profile = load_fixture()
        profile["schema_version"] = "2.0"
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "PROFILE_VERSION_UNSUPPORTED")

    def test_codex_builtin_model_cannot_be_reused_as_an_engine_api_pin(self):
        profile = load_fixture()
        cell_for(profile, "gpt_image")["configuration"]["model"].update(
            {"requested": "gpt-image-2", "identity_kind": "pinned"}
        )
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "MODEL_SURFACE_MISMATCH")

    def test_moving_alias_requires_explicit_approved_policy_and_expected_resolution(self):
        profile = load_fixture()
        cell = cell_for(profile, "jev")
        model = cell["configuration"]["model"]
        model.update({"requested": "jev-latest", "identity_kind": "alias"})
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "MODEL_ALIAS_POLICY_REQUIRED")

        model.update(
            {
                "policy_status": "approved",
                "approved_model": "jev-latest",
                "expected_resolved": "jev-1.13.0",
                "approval_ref": "evidence:runtime/jev-alias-policy",
                "approved_by_role": "Agent and research",
                "approved_at": "2026-10-01",
                "revalidate_by": "2026-11-01",
            }
        )
        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        model["resolved"] = "jev-1.12.0"
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "MODEL_RESOLUTION_MISMATCH")
        self.assertIsNotNone(validated)

    def test_model_policy_requires_a_current_revalidation_date(self):
        profile = load_fixture()
        cell = add_jev_admin_record(profile)
        cell["configuration"]["model"]["revalidate_by"] = "2026-10-09"
        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        report = readiness.assess_profile(validated, mode="offline", as_of=AS_OF, environ={})
        jev = next(item for item in report["capabilities"] if item["id"] == "jev")
        self.assertIn("MODEL_POLICY_STALE", {item["code"] for item in jev["blockers"]})

    def test_per_provider_environment_billing_and_quota_are_explicit(self):
        profile = load_fixture()
        report = readiness.assess_profile(profile, mode="offline", as_of=AS_OF, environ={})
        self.assertEqual({item["environment"] for item in report["capabilities"]}, {"development"})
        self.assertEqual({item["billing_mode"] for item in report["capabilities"]}, {"unknown"})

        profile = load_fixture()
        cell_for(profile, "jev")["configuration"]["environment"] = "production"
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "ENVIRONMENT_IDENTITY_MISMATCH")

        profile = load_fixture()
        config = cell_for(profile, "jev")["configuration"]
        config["quota_status"] = "recorded"
        config["quota_summary"] = "documented"
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "QUOTA_EVIDENCE_MISSING")

    def test_planner_and_baseline_keep_separate_future_budget_and_live_owner_records(self):
        profile = load_fixture()
        planner = cell_for(profile, "planner_reasoning")["future_usage_authorization"]
        baseline = cell_for(profile, "generative_baseline")["future_usage_authorization"]
        planner.update(
            {
                "status": "approved",
                "budget_ref": "evidence:finance/planner-budget",
                "reservation_protocol_ref": "evidence:finance/planner-reservation",
            }
        )
        baseline.update(
            {
                "status": "approved",
                "budget_ref": "evidence:finance/baseline-budget",
                "reservation_protocol_ref": "evidence:finance/baseline-reservation",
            }
        )
        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        report = readiness.assess_profile(validated, mode="offline", as_of=AS_OF, environ={})
        by_id = {item["id"]: item for item in report["capabilities"]}
        self.assertTrue(by_id["planner_reasoning"]["future_usage_authorization"]["budget_reference_present"])
        self.assertTrue(by_id["generative_baseline"]["future_usage_authorization"]["reservation_protocol_reference_present"])
        self.assertEqual(by_id["planner_reasoning"]["status"], "pending")
        self.assertEqual(by_id["generative_baseline"]["status"], "pending")

        baseline["reservation_protocol_ref"] = None
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "FUTURE_USAGE_EVIDENCE_INCOMPLETE")

    def test_sponsor_setup_and_actual_artifact_gates_remain_pending(self):
        profile = load_fixture()
        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        report = readiness.assess_profile(validated, mode="offline", as_of=AS_OF, environ={})
        by_id = {item["id"]: item for item in report["capabilities"]}
        neatlogs = by_id["neatlogs"]
        entire = by_id["entire"]
        self.assertEqual(neatlogs["sponsor_integration"]["status"], "pending")
        self.assertEqual(entire["sponsor_integration"]["applicability"], "required")
        self.assertEqual(entire["live_capability"], "pending")
        self.assertIn("SPONSOR_CONFIGURATION_PENDING", {item["code"] for item in neatlogs["blockers"]})
        self.assertIn("ENTIRE_ARTIFACT_PENDING", {item["code"] for item in entire["blockers"]})

        profile = load_fixture()
        neatlogs = cell_for(profile, "neatlogs")["sponsor_integration"]
        neatlogs.update(
            {
                "status": "configured",
                "tool_version": "1.0.0",
                "artifact_plan_ref": "evidence:ops/neatlogs-plan",
            }
        )
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "SPONSOR_CONFIGURATION_INCOMPLETE")

    def test_mock_or_sandbox_mode_never_counts_as_observed_live_access(self):
        profile = load_fixture()
        cell_for(profile, "jev")["live"]["dependency_mode"] = "mock"
        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        report = readiness.assess_profile(validated, mode="offline", as_of=AS_OF, environ={})
        jev = next(item for item in report["capabilities"] if item["id"] == "jev")
        self.assertEqual(jev["live_evidence"]["dependency_mode"], "mock")
        self.assertEqual(jev["live_capability"], "pending")

        profile = load_fixture()
        jev = cell_for(profile, "jev")
        jev["configuration"]["billing_mode"] = "sandbox"
        jev["live"].update(
            {
                "status": "observed",
                "dependency_mode": "mock",
                "checked_at": "2026-10-01",
                "valid_until": "2026-10-20",
                "endpoint": "https://api.typesafe.ai/v1/systemone",
                "account_ref": "urn:typesafe:account:development",
                "project_ref": "urn:agent-harness:project:acv1",
                "requested_model": "jev-1.13.0",
                "evidence_ref": "evidence:test/mock-run",
            }
        )
        add_jev_admin_record(profile)
        jev["configuration"]["billing_mode"] = "sandbox"
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "LIVE_AUTHORIZATION_MISSING")

        profile["live_test_authorization"].update(
            {
                "status": "approved",
                "reservation_ref": "evidence:finance/mock-test-reservation",
                "evidence_ref": "evidence:owner/mock-test-authorization",
                "authorized_capabilities": ["jev"],
            }
        )
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "LIVE_DEPENDENCY_MODE_MISMATCH")

    def test_live_outcome_requires_matching_capability_authorization_and_live_mode(self):
        profile = load_fixture()
        cell = add_jev_admin_record(profile)
        profile["live_test_authorization"].update(
            {
                "status": "approved",
                "reservation_ref": "evidence:finance/reservation",
                "evidence_ref": "evidence:owner/live-approval",
                "authorized_capabilities": ["jev"],
            }
        )
        cell["live"].update(
            {
                "status": "observed",
                "dependency_mode": "live",
                "checked_at": "2026-10-01",
                "valid_until": "2026-10-20",
                "endpoint": "https://api.typesafe.ai/v1/systemone",
                "account_ref": cell["configuration"]["account_ref"],
                "project_ref": cell["configuration"]["project_ref"],
                "requested_model": "jev-1.13.0",
                "resolved_model": "jev-1.13.0",
                "evidence_ref": "evidence:provider/jev-live",
            }
        )
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "LIVE_BILLING_MODE_UNCONFIRMED")

        cell["configuration"]["billing_mode"] = "sandbox"
        cell["live"]["dependency_mode"] = "mock"
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "LIVE_DEPENDENCY_MODE_MISMATCH")

        cell["live"]["dependency_mode"] = "live"
        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        report = readiness.assess_profile(validated, mode="offline", as_of=AS_OF, environ={})
        jev = next(item for item in report["capabilities"] if item["id"] == "jev")
        self.assertEqual(jev["live_capability"], "observed")

        profile["live_test_authorization"]["authorized_capabilities"] = ["gpt_image"]
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "LIVE_AUTHORIZATION_MISSING")

    def test_metadata_only_evidence_does_not_verify_inference_or_image_generation(self):
        profile = load_fixture()
        jev = add_jev_admin_record(profile)
        add_jev_model_list_record(jev)
        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        report = readiness.assess_profile(validated, mode="offline", as_of=AS_OF, environ=MembershipOnlyEnvironment())
        by_id = {item["id"]: item for item in report["capabilities"]}

        self.assertEqual(by_id["jev"]["metadata"]["status"], "observed")
        self.assertEqual(by_id["jev"]["metadata"]["endpoint"], "https://api.typesafe.ai/v1/models")
        self.assertTrue(by_id["jev"]["metadata"]["evidence_reference_present"])
        self.assertIsNone(by_id["jev"]["metadata"]["resolved_model"])
        self.assertEqual(by_id["jev"]["live_capability"], "pending")
        self.assertEqual(by_id["gpt_image"]["live_capability"], "pending")
        self.assertEqual(by_id["neatlogs"]["live_capability"], "pending")
        self.assertEqual(by_id["planner_reasoning"]["status"], "pending")
        self.assertEqual(by_id["generative_baseline"]["status"], "pending")
        self.assertEqual(by_id["jev"]["configuration_status"], "pending")
        self.assertTrue(by_id["jev"]["credential_reference_present"])

    def test_auth_metadata_cannot_smuggle_unvalidated_model_or_secret_text(self):
        marker = "INLINE_SECRET_IN_MODEL_FIELD"
        profile = load_fixture()
        cell = add_jev_admin_record(profile)
        config = cell["configuration"]
        cell["metadata"].update(
            {
                "status": "observed",
                "kind": "auth",
                "checked_at": "2026-10-01",
                "valid_until": "2026-10-20",
                "endpoint": "https://api.typesafe.ai/v1/models",
                "account_ref": config["account_ref"],
                "project_ref": config["project_ref"],
                "requested_model": marker,
                "evidence_ref": "evidence:admin/jev-auth",
            }
        )
        issue = self.first_issue(profile)
        self.assertEqual(issue["code"], "METADATA_RECORD_INCONSISTENT")
        self.assertNotIn(marker, issue["message"])

    def test_stale_and_mismatched_identity_records_block_or_reject(self):
        stale_profile = load_fixture()
        add_jev_admin_record(stale_profile, valid_until="2026-10-09")
        errors, validated = self.validate(stale_profile)
        self.assertEqual(errors, [])
        report = readiness.assess_profile(validated, mode="offline", as_of=AS_OF, environ={})
        self.assertIn("IDENTITY_RECORD_STALE", {item["code"] for item in report["diagnostics"]})

        mismatch_profile = load_fixture()
        jev = add_jev_admin_record(mismatch_profile)
        jev["eligibility"]["account_ref"] = "urn:typesafe:account:other"
        issue = self.first_issue(mismatch_profile)
        self.assertEqual(issue["code"], "IDENTITY_RECORD_MISMATCH")

    def test_denial_and_sponsor_gap_remain_separate_from_available_jev_metadata(self):
        profile = load_fixture()
        jev = add_jev_admin_record(profile)
        add_jev_model_list_record(jev)
        gpt = cell_for(profile, "gpt_image")
        neatlogs = cell_for(profile, "neatlogs")
        for cell, account, project, evidence in (
            (gpt, "urn:openai:account:dev", "urn:openai:project:acv1", "evidence:admin/image-denied"),
            (neatlogs, "urn:neatlogs:account:dev", "urn:neatlogs:project:acv1", "evidence:admin/neatlogs-pending"),
        ):
            cell["configuration"]["account_ref"] = account
            cell["configuration"]["project_ref"] = project
            cell["eligibility"].update(
                {
                    "status": "denied" if cell["id"] == "gpt_image" else "pending",
                    "checked_at": "2026-10-01" if cell["id"] == "gpt_image" else None,
                    "valid_until": "2026-10-20" if cell["id"] == "gpt_image" else None,
                    "account_ref": account if cell["id"] == "gpt_image" else None,
                    "project_ref": project if cell["id"] == "gpt_image" else None,
                    "evidence_ref": evidence if cell["id"] == "gpt_image" else None,
                }
            )

        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        report = readiness.assess_profile(validated, mode="offline", as_of=AS_OF, environ={})
        by_id = {item["id"]: item for item in report["capabilities"]}
        self.assertEqual(by_id["jev"]["metadata"]["status"], "observed")
        self.assertEqual(by_id["gpt_image"]["status"], "denied")
        self.assertIn("ELIGIBILITY_DENIED", {item["code"] for item in by_id["gpt_image"]["blockers"]})
        self.assertEqual(by_id["neatlogs"]["eligibility"]["status"], "pending")
        self.assertEqual(by_id["neatlogs"]["blocked_consumers"], ["SPN-01"])
        self.assertEqual(by_id["entire"]["blocked_consumers"], ["SPN-02"])

    def test_denied_jev_entitlement_does_not_change_other_provider_cells(self):
        profile = load_fixture()
        jev = cell_for(profile, "jev")
        config = jev["configuration"]
        config["account_ref"] = "urn:typesafe:account:development"
        config["project_ref"] = "urn:agent-harness:project:acv1"
        jev["eligibility"].update(
            {
                "status": "denied",
                "checked_at": "2026-10-01",
                "valid_until": "2026-10-20",
                "account_ref": config["account_ref"],
                "project_ref": config["project_ref"],
                "evidence_ref": "evidence:admin/jev-denial",
            }
        )
        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        report = readiness.assess_profile(validated, mode="offline", as_of=AS_OF, environ={})
        by_id = {item["id"]: item for item in report["capabilities"]}
        self.assertEqual(by_id["jev"]["status"], "denied")
        self.assertIn("ACV1-JEV-EVAL", by_id["jev"]["blocked_consumers"])
        self.assertEqual(by_id["gpt_image"]["eligibility"]["status"], "pending")
        self.assertEqual(by_id["planner_reasoning"]["provider"], None)
        self.assertEqual(by_id["neatlogs"]["eligibility"]["status"], "pending")

    def test_live_mode_refuses_without_authorization_and_never_calls_provider(self):
        profile = load_fixture()
        with tempfile.TemporaryDirectory() as temp_dir:
            profile_path = Path(temp_dir) / "profile.json"
            profile_path.write_text(json.dumps(profile), encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output), mock.patch("socket.create_connection", side_effect=AssertionError("network forbidden")):
                exit_code = readiness.main(["--profile", str(profile_path), "--mode", "live", "--as-of", "2026-10-10"])
        report = json.loads(output.getvalue())
        self.assertEqual(exit_code, 3)
        self.assertEqual(report["mode_result"], "refused_without_authorization")
        self.assertIn("LIVE_AUTHORIZATION_MISSING", {item["code"] for item in report["diagnostics"]})
        self.assertFalse(report["network_accessed"])

    def test_metadata_mode_is_explicitly_unsupported_without_network(self):
        profile = load_fixture()
        with tempfile.TemporaryDirectory() as temp_dir:
            profile_path = Path(temp_dir) / "profile.json"
            profile_path.write_text(json.dumps(profile), encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output), mock.patch("socket.create_connection", side_effect=AssertionError("network forbidden")):
                exit_code = readiness.main(["--profile", str(profile_path), "--mode", "metadata", "--as-of", "2026-10-10"])
        report = json.loads(output.getvalue())
        self.assertEqual(exit_code, 3)
        self.assertEqual(report["mode_result"], "unsupported_no_network")
        self.assertIn("METADATA_MODE_UNSUPPORTED", {item["code"] for item in report["diagnostics"]})
        self.assertFalse(report["network_accessed"])

    def test_cli_reports_only_credential_reference_and_never_secret_value(self):
        sentinel = "NEVER_PRINT_THIS_SENTINEL_CREDENTIAL"
        output = io.StringIO()
        with mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": sentinel}):
            with contextlib.redirect_stdout(output):
                exit_code = readiness.main(
                    ["--profile", str(FIXTURE_PATH), "--mode", "offline", "--as-of", "2026-10-10"]
                )
        rendered = output.getvalue()
        report = json.loads(rendered)
        self.assertEqual(exit_code, 2)
        self.assertNotIn(sentinel, rendered)
        self.assertIn("TYPESAFE_API_KEY", rendered)
        jev = next(item for item in report["capabilities"] if item["id"] == "jev")
        self.assertTrue(jev["credential_reference_present"])
        self.assertEqual(jev["eligibility"]["status"], "pending")

    def test_empty_environment_secret_is_not_read_and_does_not_prove_authentication(self):
        output = io.StringIO()
        with mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": ""}):
            with contextlib.redirect_stdout(output):
                exit_code = readiness.main(
                    ["--profile", str(FIXTURE_PATH), "--mode", "offline", "--as-of", "2026-10-10"]
                )
        report = json.loads(output.getvalue())
        jev = next(item for item in report["capabilities"] if item["id"] == "jev")
        self.assertEqual(exit_code, 2)
        self.assertTrue(jev["credential_reference_present"])
        self.assertEqual(jev["eligibility"]["status"], "pending")
        self.assertEqual(jev["live_capability"], "pending")

    def test_profile_parser_rejects_duplicate_keys_without_echoing_input(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            profile_path = Path(temp_dir) / "duplicate.json"
            profile_path.write_text('{"profile_id":"safe","profile_id":"INLINE_SECRET"}', encoding="utf-8")
            loaded, error = readiness._load_profile(profile_path)
        self.assertIsNone(loaded)
        self.assertEqual(error, "PROFILE_JSON_DUPLICATE_KEY")

    def test_unknown_fields_cannot_smuggle_inline_secrets_into_output(self):
        marker = "INLINE_SECRET_DO_NOT_ECHO"
        profile = load_fixture()
        profile["api_key"] = marker
        with tempfile.TemporaryDirectory() as temp_dir:
            profile_path = Path(temp_dir) / "profile.json"
            profile_path.write_text(json.dumps(profile), encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                exit_code = readiness.main(["--profile", str(profile_path), "--mode", "offline"])
        self.assertEqual(exit_code, 1)
        self.assertNotIn(marker, output.getvalue())
        self.assertIn("CONFIG_FIELD_UNSUPPORTED", output.getvalue())

    def test_schema_is_local_strict_and_fixture_shape_matches_profile_contract(self):
        schema = json.loads((REPO_ROOT / "config" / "provider-profiles.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertIn("not a shared domain contract", schema["description"])
        self.assertFalse(schema["additionalProperties"])
        profile = load_fixture()
        capability_schema = schema["$defs"]["capability"]
        configuration_schema = schema["$defs"]["configuration"]
        model_schema = schema["$defs"]["model"]
        for cell in profile["capabilities"]:
            self.assertTrue(set(capability_schema["required"]).issubset(cell))
            self.assertTrue(set(configuration_schema["required"]).issubset(cell["configuration"]))
            self.assertTrue(set(model_schema["required"]).issubset(cell["configuration"]["model"]))
        self.assertIn("futureUsageAuthorization", schema["$defs"])
        self.assertIn("sponsorIntegration", schema["$defs"])
        errors, validated = self.validate(profile)
        self.assertEqual(errors, [])
        self.assertEqual(len(validated["capabilities"]), 6)


if __name__ == "__main__":
    unittest.main()
