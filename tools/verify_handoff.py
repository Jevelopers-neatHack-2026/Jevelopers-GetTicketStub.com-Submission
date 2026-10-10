#!/usr/bin/env python3
"""Check local handoff metadata and evidence-file integrity without claiming readiness.

This tool does not fetch URLs, import evidence code, execute manifest commands, inspect
credentials, or authenticate role/approval claims. A matching local SHA-256 proves only
that the referenced bytes match the manifest. Readiness remains blocked until an
accepted trusted evidence verifier is implemented and real external artifacts exist.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


TOOL_VERSION = "0.1.0"
MANIFEST_SCHEMA = "event-intelligence/handoff-manifest"
COMPONENT_SCHEMA = "event-intelligence/release-component-manifest"
EVIDENCE_VERIFIER_ID: str | None = None
MAX_MANIFEST_BYTES = 1_048_576
MAX_COMPONENT_BYTES = 1_048_576
MAX_EVIDENCE_BYTES = 2_097_152
MAX_JSON_DEPTH = 32
MAX_JSON_OBJECT_MEMBERS = 512
MAX_JSON_ARRAY_ITEMS = 512
MAX_RECORDS = 256
MAX_EVIDENCE_REFS = 128
MAX_PATH_CHARS = 512
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
DECIMAL_RE = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$")

KINDS = (
    "handoff-contracts",
    "handoff-metering",
    "provider-readiness",
    "handoff-consumer",
)
MODES = {"mock", "simulated", "recorded", "sandbox", "live", "unknown"}
USAGE_STATES = {"unknown", "estimated", "provider_confirmed", "not_applicable"}
EVIDENCE_PREFIXES = {
    "handoff-contracts": ("tests/contracts/evidence/",),
    "handoff-metering": ("tests/contracts/evidence/",),
    "provider-readiness": ("tests/providers/evidence/",),
    "handoff-consumer": ("tests/consumers/evidence/",),
    "component-pin": ("release/handoff-evidence/",),
}


@dataclass(frozen=True)
class ArtifactSpec:
    identity: str
    component: str
    owner_role: str
    review_roles: tuple[str, ...] = ()
    rejects_mock: bool = False


@dataclass(frozen=True)
class FixtureSpec:
    expected: str
    components: tuple[str, ...]
    owner_role: str
    rejects_mock: bool = True
    actual_consumer_required: bool = False
    required_case_count: int = 1


@dataclass(frozen=True)
class HandoffSpec:
    triage_key: str
    owner_role: str
    requirements: tuple[str, ...]
    acceptance_roles: tuple[tuple[str, str], ...]
    components: tuple[str, ...]
    provider_surfaces: tuple[str, ...]
    related_provider_surfaces: tuple[str, ...]
    artifacts: dict[str, ArtifactSpec]
    fixtures: dict[str, FixtureSpec]
    crosswalk: dict[str, str]


def _specs() -> dict[str, HandoffSpec]:
    agent = "Agent and research"
    creative = "Creative and fulfillment"
    product = "Product and frontend"
    finance = "Finance and reliability"

    return {
        "handoff-contracts": HandoffSpec(
            triage_key="EI-X01",
            owner_role=agent,
            requirements=("EI-01", "EI-06", "EI-07", "JEV-EI-01", "JEV-EI-02"),
            acceptance_roles=(("CON-01", agent), ("CON-02", agent), ("CON-03", agent)),
            components=("shared-contracts", "agent-harness", "creative-engine", "getticketstub.com"),
            provider_surfaces=(),
            related_provider_surfaces=(),
            artifacts={
                "research_request_schema": ArtifactSpec(
                    "shared-contracts:versioned-research-request-schema", "shared-contracts", agent,
                    (agent, creative),
                ),
                "event_intelligence_package_schema": ArtifactSpec(
                    "shared-contracts:versioned-event-intelligence-package-schema",
                    "shared-contracts", agent, (agent, creative),
                ),
                "progress_receipt_schema": ArtifactSpec(
                    "shared-contracts:versioned-progress-and-request-answer-batch-receipt-schemas",
                    "shared-contracts", agent, (agent, creative),
                ),
                "typed_error_schema": ArtifactSpec(
                    "shared-contracts:versioned-safe-typed-error-schema",
                    "shared-contracts", agent, (agent, creative),
                ),
                "correction_schema": ArtifactSpec(
                    "shared-contracts:versioned-correction-schema",
                    "shared-contracts", agent, (agent, creative),
                ),
                "invalidation_schema": ArtifactSpec(
                    "shared-contracts:versioned-invalidation-schema",
                    "shared-contracts", agent, (agent, creative),
                ),
                "decision_port_contract": ArtifactSpec(
                    "shared-contracts:contract-only-injected-decision-port", "shared-contracts", agent,
                    (agent,),
                ),
                "trusted_scope_approval_contract": ArtifactSpec(
                    "application-owned:authenticated-scope-and-approval-verification-contract",
                    "getticketstub.com", product, (product, agent, creative),
                ),
                "canonical_field_crosswalk": ArtifactSpec(
                    "shared-contracts:producer-consumer-reviewed-field-crosswalk", "shared-contracts", agent,
                    (agent, creative, product),
                ),
                "producer_binding_pin": ArtifactSpec(
                    "event-intelligence:generated-producer-binding-revision", "event-intelligence", agent,
                    (agent, creative),
                ),
                "consumer_binding_pin": ArtifactSpec(
                    "creative-engine:generated-consumer-binding-revision", "creative-engine", creative,
                    (agent, creative),
                ),
                "dependency_direction_evidence": ArtifactSpec(
                    "contract-boundary:engines-import-contracts-no-engine-imports-harness",
                    "agent-harness", agent, (agent, creative),
                ),
                "producer_review_acknowledgement": ArtifactSpec(
                    "shared-contracts:producer-role-acknowledgement", "shared-contracts", agent,
                    (agent,),
                ),
                "consumer_review_acknowledgement": ArtifactSpec(
                    "shared-contracts:consumer-role-acknowledgement", "shared-contracts", creative,
                    (creative,),
                ),
                "identity_approval_owner_acknowledgement": ArtifactSpec(
                    "getticketstub.com:identity-approval-owner-role-acknowledgement",
                    "getticketstub.com", product, (product,),
                ),
            },
            fixtures={
                "choice_score_noul_shapes_and_noul_has_no_confidence": FixtureSpec(
                    "real generated bindings parse valid Choice/Score/Noul and reject missing/extra/invalid fields",
                    ("shared-contracts", "event-intelligence", "creative-engine"), agent,
                ),
                "compatibility_minor_additive_and_unknown_major": FixtureSpec(
                    "supported old minor/additive fields follow reviewed rule; unknown major returns typed error",
                    ("shared-contracts", "event-intelligence", "creative-engine"), agent,
                ),
                "dependency_graph_has_no_engine_harness_import": FixtureSpec(
                    "contract-layer imports are acyclic and no engine imports the complete harness package",
                    ("shared-contracts", "agent-harness", "creative-engine"), agent,
                ),
                "timeouts_abstentions_malformed_results_preserve_capabilities": FixtureSpec(
                    "timeout, abstention and malformed result leave eligible capability set unchanged",
                    ("shared-contracts", "event-intelligence", "agent-harness"), agent,
                ),
                "dependent_questions_use_separate_stages": FixtureSpec(
                    "identity then support assessment uses immutable separate batches without sibling reads",
                    ("shared-contracts", "event-intelligence", "agent-harness"), agent,
                ),
                "trusted_approval_fails_closed": FixtureSpec(
                    "trusted mechanism rejects forged issuer, wrong scope/hash/version/use, expiry/revocation and boolean claims",
                    ("shared-contracts", "getticketstub.com", "creative-engine"), product,
                ),
                "crosswalk_identity_and_canonical_binding_roundtrip": FixtureSpec(
                    "producer and consumer generated bindings compare canonical bytes/hashes and preserve distinct identities",
                    ("shared-contracts", "event-intelligence", "creative-engine"), agent,
                ),
                "package_uncertainty_asset_policy_and_invalidation_receipts": FixtureSpec(
                    "representative package preserves facts/uncertainty, source and transformed hashes, policy, refs and ordered invalidation identity",
                    ("shared-contracts", "event-intelligence", "creative-engine"), agent,
                ),
                "official_score_legend_discrepancy_decision": FixtureSpec(
                    "record the official Score legend discrepancy decision; retain string-only criteria/legend until owners decide",
                    ("shared-contracts", "event-intelligence", "creative-engine"), agent,
                ),
            },
            crosswalk={
                "package_alias": "Decide the EventIntelligencePackage/ResearchPackage alias; this catalog does not choose the wire name.",
                "schema_version": "schema_version is required; pin supported compatibility policy.",
                "event_id": "event_id identifies an emitted event, not occurrence identity or package identity.",
                "tenant_id": "tenant_id is an externally authenticated scope value.",
                "project_id": "project_id is an externally authenticated scope value.",
                "correlation_id": "correlation_id links the approved execution context.",
                "producer_build_revision": "Record producer/build revision; exact composite field spelling remains for owner review.",
                "occurred_at": "occurred_at is distinct from ingested_at.",
                "ingested_at": "ingested_at is distinct from occurred_at.",
                "environment": "environment is explicit.",
                "billing_mode": "billing_mode is explicit and does not itself prove billing.",
                "source_refs": "source_refs preserve provenance references.",
                "workflow_run_package_version_hash_parent_refs": "Decide exact workflow/run/package/version/hash/parent reference fields.",
                "logical_operation_id": "Logical operation identity is distinct from attempts and source observation.",
                "billable_attempt_id": "Billable attempt identity is distinct from transport retry.",
                "transport_attempt_id": "Transport attempt identity is distinct from billable attempt.",
                "provider_request_id": "Provider request identity may be absent and is distinct from local identities.",
                "source_observation_identity": "Decide exact source observation identity field and duplicate semantics.",
                "permitted_asset_wire_field": "permittedAssets is conceptual only; external owner decides exact wire field.",
                "correction_fields": "External owner decides correction fields, revision semantics and history behavior.",
                "invalidation_fields": "External owner decides invalidation identity, ordering and deduplication fields.",
                "receipt_fields": "External owner decides request/answer/batch receipt fields and typed errors.",
                "score_legend": "EI v1 keeps Score criteria/legend string-only pending the official discrepancy decision.",
                "noul_confidence": "Noul has only type and noul; no confidence field.",
                "scope_approval_fields": "Issuer/audience/actor/tenant/project/asset version/hash/use/expiry/revocation and trusted lookup/signature rule require Product-owned agreement.",
            },
        ),
        "handoff-metering": HandoffSpec(
            triage_key="EI-X02",
            owner_role=agent,
            requirements=("EI-11", "JEV-EI-05"),
            acceptance_roles=(
                ("FIN-01", finance), ("FIN-02", finance), ("FIN-03", finance),
                ("FIN-04", finance), ("FIN-08", finance), ("BUD-01", finance),
                ("BUD-02", finance), ("BUD-03", finance), ("SPN-01", finance),
            ),
            components=("shared-contracts", "cost-intelligence", "agent-harness"),
            provider_surfaces=(),
            related_provider_surfaces=(),
            artifacts={
                "reviewed_metering_budget_trace_protocol": ArtifactSpec(
                    "cost-intelligence:finance-harness-reviewed-reservation-usage-trace-protocol",
                    "cost-intelligence", finance, (finance, agent),
                ),
                "per_provider_billability_mapping": ArtifactSpec(
                    "cost-intelligence:provider-retry-and-billability-mapping",
                    "cost-intelligence", finance, (finance, agent),
                ),
                "identity_and_deduplication_rules": ArtifactSpec(
                    "shared-contracts:operation-attempt-observation-identity-rules",
                    "shared-contracts", finance, (finance, agent),
                ),
                "valuation_and_rate_card_rules": ArtifactSpec(
                    "cost-intelligence:currency-rate-card-effective-date-and-valuation-basis",
                    "cost-intelligence", finance, (finance,),
                ),
                "durable_observation_recovery_contract": ArtifactSpec(
                    "agent-harness:bounded-durable-usage-observation-and-recovery-contract",
                    "agent-harness", agent, (finance, agent),
                ),
                "finance_review_acknowledgement": ArtifactSpec(
                    "cost-intelligence:finance-owner-role-acknowledgement",
                    "cost-intelligence", finance, (finance,),
                ),
                "harness_review_acknowledgement": ArtifactSpec(
                    "agent-harness:harness-contract-role-acknowledgement",
                    "agent-harness", agent, (agent,),
                ),
            },
            fixtures={
                "competing_reservations_only_one_uses_last_capacity": FixtureSpec(
                    "two competing reservations cannot both consume the final capacity",
                    ("cost-intelligence", "shared-contracts"), finance,
                ),
                "declined_reservation_blocks_dispatch": FixtureSpec(
                    "declined reservation prevents billable dispatch",
                    ("cost-intelligence", "agent-harness"), finance,
                ),
                "duplicate_direct_and_trace_observation_dedupes": FixtureSpec(
                    "duplicate direct/trace observation dedupes by agreed identity",
                    ("cost-intelligence", "agent-harness"), finance,
                ),
                "new_billable_attempt_is_retained": FixtureSpec(
                    "second billable execution remains a distinct attempt for one logical operation",
                    ("cost-intelligence", "shared-contracts"), finance,
                ),
                "timeout_cancel_restart_hold_until_reconcile": FixtureSpec(
                    "unknown in-flight outcome holds capacity through timeout/cancel/restart until reconciliation",
                    ("cost-intelligence", "agent-harness"), finance,
                ),
                "unused_predispatch_capacity_releases_safely": FixtureSpec(
                    "known unused pre-dispatch capacity follows reviewed release semantics",
                    ("cost-intelligence", "agent-harness"), finance,
                ),
                "cache_reuse_keeps_original_charge_lineage": FixtureSpec(
                    "cache reuse references original research usage and adds no research charge",
                    ("cost-intelligence", "event-intelligence"), finance,
                ),
                "trace_outage_is_durable_or_fails_closed": FixtureSpec(
                    "trace outage uses bounded durable delivery or fail-closed dispatch, never silent loss",
                    ("agent-harness", "cost-intelligence"), agent,
                ),
            },
            crosswalk={
                "reserve": "Define owner, action, blocker and authoritative state for reservation.",
                "predispatch_authorization": "Define authorization immediately before dispatch and revocation behavior.",
                "consume_release": "Define consume/release semantics and conservation rules.",
                "unknown_inflight_outcome": "Unknown in-flight cost remains held until external reconciliation.",
                "worker_lease": "Worker lease expiry/restart is never a financial reservation expiry signal.",
                "logical_operation_id": "Logical operation is distinct from billable and transport attempts.",
                "billable_attempt_id": "A genuinely new billable attempt remains distinct under retries.",
                "transport_attempt_id": "SDK/transport retries are mapped per provider and may be nonbillable.",
                "provider_request_id": "Missing provider request ID has an explicit representation.",
                "event_observation_identity": "event_id and observation identity are distinct and dedupe is specified.",
                "valuation": "Unknown, estimated and provider-confirmed are distinct; unknown is never zero.",
                "exact_amount_currency": "Use exact amount and currency; no rounding or currency is assumed here.",
                "rate_card_version_effective_date": "Record rate-card version/source and effective date when known.",
                "research_reuse_allocation": "EI emits original usage lineage and reuse telemetry; Finance owns allocation.",
                "trace_delivery_ack_recovery": "Define acknowledgement, durable delivery, retry and reconciliation boundaries.",
            },
        ),
        "provider-readiness": HandoffSpec(
            triage_key="EI-X03",
            owner_role=agent,
            requirements=("EI-03", "EI-12", "JEV-EI-01"),
            acceptance_roles=(
                ("FIN-01", finance), ("EVAL-03", product), ("EVAL-04", finance), ("SPN-01", finance),
            ),
            components=("agent-harness", "cost-intelligence"),
            provider_surfaces=("jev", "research-vision-reasoning", "budget-authorization"),
            related_provider_surfaces=("gpt-image", "neatlogs"),
            artifacts={
                "implemented_sole_jev_adapter_pin": ArtifactSpec(
                    "agent-harness:implemented-compatible-sole-jev-adapter-revision",
                    "agent-harness", agent, (agent,), rejects_mock=True,
                ),
                "jev_account_project_readiness_record": ArtifactSpec(
                    "agent-harness:sanitized-jev-account-and-project-eligibility-record",
                    "agent-harness", agent, (agent, finance), rejects_mock=True,
                ),
                "research_vision_reasoning_readiness_record": ArtifactSpec(
                    "agent-harness:sanitized-research-vision-reasoning-access-and-model-record",
                    "agent-harness", agent, (agent, finance), rejects_mock=True,
                ),
                "explicit_runtime_and_model_configuration": ArtifactSpec(
                    "agent-harness:explicit-runtime-sdk-model-parameters-retry-limit-and-mode",
                    "agent-harness", agent, (agent,), rejects_mock=True,
                ),
                "nonbillable_readiness_procedure_or_limitation": ArtifactSpec(
                    "agent-harness:nonbillable-account-readiness-procedure-or-no-safe-check-limitation",
                    "agent-harness", agent, (agent,), rejects_mock=True,
                ),
                "budget_authorization_and_predispatch_revocation": ArtifactSpec(
                    "cost-intelligence:authorized-budget-reference-and-revalidation-contract",
                    "cost-intelligence", finance, (finance, agent), rejects_mock=True,
                ),
            },
            fixtures={
                "missing_access_model_or_budget_blocks_before_dispatch": FixtureSpec(
                    "missing/revoked access, unavailable explicit model or absent budget blocks before billable dispatch",
                    ("agent-harness", "cost-intelligence"), agent,
                ),
                "readiness_is_nonbillable_or_limitation_is_explicit": FixtureSpec(
                    "readiness records accessible metadata without inference, or states no safe check exists",
                    ("agent-harness",), agent,
                ),
                "dependency_modes_and_sanitized_refs_are_distinct": FixtureSpec(
                    "simulated/recorded/sandbox/live are distinguished with redacted provider and usage references",
                    ("agent-harness",), agent,
                ),
                "budget_revocation_rechecked_before_dispatch": FixtureSpec(
                    "budget permission revoked after readiness is revalidated before dispatch",
                    ("agent-harness", "cost-intelligence"), finance,
                ),
                "explicit_model_pin_has_no_latest_substitution": FixtureSpec(
                    "unavailable explicit model pin fails rather than substituting a moving latest alias",
                    ("agent-harness",), agent,
                ),
            },
            crosswalk={
                "provider_identity": "Record provider and endpoint/API version only after owner verification.",
                "runtime_sdk": "Record actual runtime and SDK version; no value is selected here.",
                "explicit_model_id_version": "Record explicit model ID/version; do not substitute latest or auto.",
                "parameters_retry_limit": "Record parameters and retry limit without inferred defaults.",
                "account_project_eligibility": "Record account/project eligibility; never expose credentials.",
                "dependency_mode": "Classify simulated, recorded, sandbox or live separately.",
                "rate_card_source_effective_date": "Record source and effective date when verified; no prices are assumed.",
                "usage_basis_and_reference": "Separate unknown, estimated and provider-confirmed usage; unknown is not zero.",
                "budget_owner_and_revocation": "Finance owns budget authority and pre-dispatch revocation checks.",
                "gpt_image_readiness_owner": "Creative and fulfillment owns GPT Image readiness as a separate provider surface.",
                "neatlogs_readiness_owner": "Agent and research records Neatlogs separately as a harness-owned related surface.",
            },
        ),
        "handoff-consumer": HandoffSpec(
            triage_key="EI-X04",
            owner_role=agent,
            requirements=("EI-10", "EI-12"),
            acceptance_roles=(
                ("CON-01", agent), ("CON-02", agent), ("CON-03", agent),
                ("ART-02", product), ("ART-05", creative), ("EVAL-01", finance),
                ("EVAL-03", product), ("SPN-01", finance), ("SPN-02", agent),
            ),
            components=("shared-contracts", "creative-engine", "getticketstub.com"),
            provider_surfaces=(),
            related_provider_surfaces=(),
            artifacts={
                "pinned_runnable_creative_consumer": ArtifactSpec(
                    "creative-engine:actual-runnable-research-package-consumer-revision",
                    "creative-engine", creative, (creative, agent), rejects_mock=True,
                ),
                "agreed_representative_package_fixture": ArtifactSpec(
                    "shared-contracts:producer-consumer-agreed-representative-package-fixture",
                    "shared-contracts", agent, (agent, creative), rejects_mock=True,
                ),
                "consumer_ack_retry_error_contract": ArtifactSpec(
                    "creative-engine:consumer-rejection-acknowledgement-retry-and-safe-error-behavior",
                    "creative-engine", creative, (creative, agent), rejects_mock=True,
                ),
                "correction_invalidation_idempotency_contract": ArtifactSpec(
                    "creative-engine:corrected-package-idempotent-invalidation-and-history",
                    "creative-engine", creative, (creative, agent), rejects_mock=True,
                ),
                "trusted_scope_approval_contract_pin": ArtifactSpec(
                    "application-owned:trusted-scope-and-asset-approval-revision",
                    "getticketstub.com", product, (product, creative), rejects_mock=True,
                ),
                "consumer_owner_acknowledgement": ArtifactSpec(
                    "creative-engine:consumer-owner-role-acknowledgement",
                    "creative-engine", creative, (creative,), rejects_mock=True,
                ),
            },
            fixtures={
                "actual_consumer_revision_not_local_double": FixtureSpec(
                    "agreed representative fixture runs on the actual pinned consumer; a local double is insufficient",
                    ("creative-engine", "shared-contracts"), creative, actual_consumer_required=True,
                ),
                "preserves_package_identity_locked_facts_and_uncertainty": FixtureSpec(
                    "consumer preserves package ID/version/hash, locked facts and unresolved questions",
                    ("creative-engine", "shared-contracts"), creative, actual_consumer_required=True,
                ),
                "rights_assets_or_original_artwork_fallback": FixtureSpec(
                    "consumer preserves asset identity/hash/scope/expiry/revocation or explicit original-artwork fallback",
                    ("creative-engine", "shared-contracts", "getticketstub.com"), creative,
                    actual_consumer_required=True,
                ),
                "rejects_incompatible_scope_unresolved_or_stale_approval": FixtureSpec(
                    "consumer rejects incompatible schema, forged scope, unresolved required fact and stale/revoked approval",
                    ("creative-engine", "shared-contracts", "getticketstub.com"), product,
                    actual_consumer_required=True,
                ),
                "corrected_package_invalidation_is_idempotent": FixtureSpec(
                    "corrected package invalidates affected artifacts idempotently and retains history",
                    ("creative-engine", "shared-contracts"), creative, actual_consumer_required=True,
                ),
                "trace_decision_usage_and_sponsor_refs_are_preserved": FixtureSpec(
                    "consumer preserves trace/decision/usage references; scoped EVAL contribution is not whole-criterion proof",
                    ("creative-engine", "shared-contracts"), agent, actual_consumer_required=True,
                ),
            },
            crosswalk={
                "package_identity_version_hash": "Consumer carries package ID, version and hash unchanged.",
                "locked_facts_unresolved_questions": "Keep locked facts and unresolved questions visible to consumer behavior.",
                "permitted_asset_identity_hash_scope_expiry_revocation": "Carry permission-bound asset identity/hash/scope/expiry/revocation or original-artwork fallback.",
                "trace_decision_usage_references": "Preserve trace, decision and usage references without claiming provider success.",
                "correction_invalidation_identity_and_history": "Correction identifies affected downstream artifacts; invalidation is idempotent and history is retained.",
                "consumer_error_ack_retry": "Define safe rejection, acknowledgement and retry behavior for incompatible/stale/untrusted inputs.",
                "external_approval_authority": "Product owns authenticated scope and approval authority; consumer must fail closed on untrusted claims.",
                "program_epic_reference": "Point to the sole harness coordinator epic; links/closure are not executable evidence.",
                "acceptance_contribution_scope": "EVAL-01 retains global export/sandbox/reporting scope; this handoff is contribution only.",
            },
        ),
    }


HANDOFF_SPECS = _specs()
CROSSWALK_OWNER_OVERRIDES = {
    "handoff-contracts": {
        "scope_approval_fields": "Product and frontend",
    },
    "handoff-metering": {
        "trace_delivery_ack_recovery": "Agent and research",
    },
    "provider-readiness": {
        "budget_owner_and_revocation": "Finance and reliability",
        "gpt_image_readiness_owner": "Creative and fulfillment",
    },
    "handoff-consumer": {
        "package_identity_version_hash": "Creative and fulfillment",
        "locked_facts_unresolved_questions": "Creative and fulfillment",
        "permitted_asset_identity_hash_scope_expiry_revocation": "Creative and fulfillment",
        "trace_decision_usage_references": "Creative and fulfillment",
        "correction_invalidation_identity_and_history": "Creative and fulfillment",
        "consumer_error_ack_retry": "Creative and fulfillment",
        "external_approval_authority": "Product and frontend",
        "program_epic_reference": "Agent and research",
        "acceptance_contribution_scope": "Finance and reliability",
    },
}
COMPONENTS = {
    "event-intelligence": {
        "repository": "Jevelopers-neatHack-2026/event-intelligence",
        "owner_role": "Agent and research",
        "observed_revision": "070279d179ca65cf3a336beeea73feb53f27831f",
    },
    "shared-contracts": {
        "repository": "Jevelopers-neatHack-2026/shared-contracts",
        "owner_role": "Agent and research",
        "observed_revision": "c4caaccc2ea63b273eeac17ed89af8ac64f6bbde",
    },
    "agent-harness": {
        "repository": "Jevelopers-neatHack-2026/agent-harness",
        "owner_role": "Agent and research",
        "observed_revision": "29a9e2084e6d14c2cf35c7f4297c66687c1f32e5",
    },
    "creative-engine": {
        "repository": "Jevelopers-neatHack-2026/creative-engine",
        "owner_role": "Creative and fulfillment",
        "observed_revision": "65b8036194b3b962e1fd34f7193d54791cf07c88",
    },
    "cost-intelligence": {
        "repository": "Jevelopers-neatHack-2026/cost-intelligence",
        "owner_role": "Finance and reliability",
        "observed_revision": "a7b7484d60058708a5c32f8b3637d21f8b94a210",
    },
    "getticketstub.com": {
        "repository": "Jevelopers-neatHack-2026/getticketstub.com",
        "owner_role": "Product and frontend",
        "observed_revision": "5a2986454297dd6df97088a8fbde69adc771f7a0",
    },
}
PEER_CANDIDATES = {
    "creative-engine-contract-proposals": {
        "repository": "Jevelopers-neatHack-2026/creative-engine",
        "revision": "65b8036194b3b962e1fd34f7193d54791cf07c88",
        "state": "available_unaccepted",
        "paths": [
            "docs/contracts/canonical-owner-agreements.json",
            "docs/contracts/creative-boundary.md",
            "docs/contracts/decision-port.md",
            "docs/contracts/metering.md",
            "docs/contracts/approval-handoff.md",
            "src/contracts/creative/v1.mjs",
            "src/contracts/decision-port/v1.mjs",
        ],
        "owner_agreement_status": {"pending": 12, "accepted": 0, "independent_verification": "pending"},
    },
}
PROVIDERS = {
    "jev": {"owner_role": "Agent and research", "required_for": ("provider-readiness",)},
    "research-vision-reasoning": {"owner_role": "Agent and research", "required_for": ("provider-readiness",)},
    "budget-authorization": {"owner_role": "Finance and reliability", "required_for": ("provider-readiness",)},
    "gpt-image": {"owner_role": "Creative and fulfillment", "required_for": ()},
    "neatlogs": {"owner_role": "Agent and research", "required_for": ()},
}


class InputProblem(Exception):
    """A bounded local input is malformed, unsafe, or unsupported."""


class DuplicateKeyProblem(InputProblem):
    pass


def _object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    if len(pairs) > MAX_JSON_OBJECT_MEMBERS:
        raise InputProblem("JSON object exceeds the member limit")
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyProblem(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise InputProblem(f"non-finite JSON value is forbidden: {value}")


def _reject_float(value: str) -> None:
    raise InputProblem("JSON floating-point numbers are forbidden; use a decimal string")


def _check_json_depth(text: str) -> None:
    depth = 0
    in_string = False
    escaped = False
    for char in text:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise InputProblem(f"JSON nesting exceeds {MAX_JSON_DEPTH} levels")
        elif char in "]}":
            depth -= 1
            if depth < 0:
                raise InputProblem("malformed JSON nesting")
    if in_string or depth != 0:
        raise InputProblem("malformed JSON string or nesting")


def _parse_json(raw: bytes, label: str) -> Any:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InputProblem(f"{label} is not UTF-8") from exc
    _check_json_depth(text)
    try:
        value = json.loads(
            text,
            object_pairs_hook=_object_without_duplicates,
            parse_constant=_reject_constant,
            parse_float=_reject_float,
        )
    except InputProblem:
        raise
    except (json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise InputProblem(f"{label} is malformed JSON: {exc}") from exc
    _check_tree_limits(value)
    return value


def _check_tree_limits(value: Any, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise InputProblem(f"JSON nesting exceeds {MAX_JSON_DEPTH} levels")
    if type(value) is dict:
        if len(value) > MAX_JSON_OBJECT_MEMBERS:
            raise InputProblem("JSON object exceeds the member limit")
        for key, child in value.items():
            if type(key) is not str:
                raise InputProblem("JSON object keys must be strings")
            _check_tree_limits(child, depth + 1)
    elif type(value) is list:
        if len(value) > MAX_JSON_ARRAY_ITEMS:
            raise InputProblem("JSON array exceeds the item limit")
        for child in value:
            _check_tree_limits(child, depth + 1)


def _safe_relative_path(value: Any) -> tuple[str, ...]:
    if type(value) is not str or not value or len(value) > MAX_PATH_CHARS:
        raise InputProblem(f"path must be a non-empty string of at most {MAX_PATH_CHARS} characters")
    if "\x00" in value or "\\" in value:
        raise InputProblem("path contains a forbidden NUL or backslash")
    if value.startswith("/") or re.match(r"^[A-Za-z]:", value):
        raise InputProblem("absolute paths are forbidden")
    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise InputProblem("empty, dot and parent-traversal path segments are forbidden")
    return tuple(parts)


def _read_local_file(root: Path, relpath: Any, *, max_bytes: int, allowed_prefixes: Iterable[str] | None = None) -> bytes:
    parts = _safe_relative_path(relpath)
    normalized = "/".join(parts)
    if allowed_prefixes is not None and not any(normalized.startswith(prefix) for prefix in allowed_prefixes):
        raise InputProblem("path is outside the designated sanitized evidence directories")
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise InputProblem("platform lacks required no-follow directory-open protections")

    flags_dir = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    flags_file = os.O_RDONLY | os.O_NOFOLLOW
    descriptors: list[int] = []
    try:
        current_fd = os.open(str(root), flags_dir)
        descriptors.append(current_fd)
        for part in parts[:-1]:
            current_fd = os.open(part, flags_dir, dir_fd=current_fd)
            descriptors.append(current_fd)
        file_fd = os.open(parts[-1], flags_file, dir_fd=current_fd)
        descriptors.append(file_fd)
        file_stat = os.fstat(file_fd)
        if not stat.S_ISREG(file_stat.st_mode):
            raise InputProblem("referenced path is not a regular file")
        if file_stat.st_nlink != 1:
            raise InputProblem("hard-linked evidence files are not accepted")
        if file_stat.st_size > max_bytes:
            raise InputProblem(f"file exceeds the {max_bytes}-byte limit")
        chunks: list[bytes] = []
        remaining = max_bytes + 1
        while remaining > 0:
            chunk = os.read(file_fd, min(65_536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        if len(raw) > max_bytes:
            raise InputProblem(f"file grew beyond the {max_bytes}-byte limit while reading")
        return raw
    except InputProblem:
        raise
    except OSError as exc:
        raise InputProblem(f"cannot safely open local file ({exc.strerror or exc.__class__.__name__})") from exc
    finally:
        for descriptor in reversed(descriptors):
            try:
                os.close(descriptor)
            except OSError:
                pass


def _check_keys(value: Any, expected: set[str], label: str, report: dict[str, Any]) -> bool:
    if type(value) is not dict:
        _add_check(report, label, "JSON object", _typename(value), "invalid")
        return False
    actual_keys = set(value)
    if actual_keys != expected:
        _add_check(
            report,
            label,
            sorted(expected),
            {"present": sorted(actual_keys), "missing": sorted(expected - actual_keys), "unexpected": sorted(actual_keys - expected)},
            "invalid",
        )
        return False
    _add_check(report, label, sorted(expected), sorted(actual_keys), "pass")
    return True


def _typename(value: Any) -> str:
    if value is None:
        return "null"
    if type(value) is bool:
        return "boolean"
    if type(value) is int:
        return "integer"
    if type(value) is str:
        return "string"
    if type(value) is list:
        return "array"
    if type(value) is dict:
        return "object"
    return type(value).__name__


def _add_check(report: dict[str, Any], check_id: str, expected: Any, actual: Any, status: str, reason: str | None = None) -> None:
    item: dict[str, Any] = {"id": check_id, "expected": expected, "actual": actual, "status": status}
    if reason:
        item["reason"] = reason
    report["checks"].append(item)


def _missing(report: dict[str, Any], item_id: str, owner_role: str, expected: Any, actual: Any, reason: str, next_action: str) -> None:
    report["missing_deliverables"].append({
        "id": item_id,
        "owner_role": owner_role,
        "expected": expected,
        "actual": actual,
        "reason": reason,
        "next_action": next_action,
    })


def _validate_usage(value: Any, label: str, report: dict[str, Any]) -> bool:
    expected = {"status", "amount", "currency", "basis_ref"}
    if not _check_keys(value, expected, f"{label}.shape", report):
        return False
    status = value["status"]
    amount = value["amount"]
    currency = value["currency"]
    basis_ref = value["basis_ref"]
    valid = True
    if type(status) is not str or status not in USAGE_STATES:
        _add_check(report, f"{label}.status", sorted(USAGE_STATES), status, "invalid")
        return False
    if status == "unknown":
        if amount is not None or currency is not None:
            _add_check(report, f"{label}.unknown_is_not_zero", {"amount": None, "currency": None}, {"amount": amount, "currency": currency}, "invalid", "unknown usage cannot be represented as zero or a guessed currency")
            valid = False
        else:
            _add_check(report, f"{label}.unknown_is_not_zero", {"amount": None, "currency": None}, {"amount": amount, "currency": currency}, "pass")
    elif status in {"estimated", "provider_confirmed"}:
        if type(amount) is not str or not DECIMAL_RE.fullmatch(amount) or type(currency) is not str or not currency or type(basis_ref) is not str or not basis_ref:
            _add_check(report, f"{label}.valued_usage", "decimal string, explicit currency and basis reference", {"amount": amount, "currency": currency, "basis_ref": basis_ref}, "invalid")
            valid = False
        else:
            _add_check(report, f"{label}.valued_usage", "decimal string, explicit currency and basis reference", {"amount": amount, "currency": currency, "basis_ref": basis_ref}, "untrusted")
    elif status == "not_applicable":
        if amount is not None or currency is not None or type(basis_ref) is not str or not basis_ref:
            _add_check(report, f"{label}.not_applicable_usage", "null amount/currency and explicit reason reference", {"amount": amount, "currency": currency, "basis_ref": basis_ref}, "invalid")
            valid = False
        else:
            _add_check(report, f"{label}.not_applicable_usage", "null amount/currency and explicit reason reference", {"amount": amount, "currency": currency, "basis_ref": basis_ref}, "pass")
    return valid


def _validate_evidence_ref(
    root: Path,
    evidence: Any,
    *,
    label: str,
    kind: str,
    report: dict[str, Any],
    component_pin: bool = False,
) -> bool:
    evidence_refs_seen = report.get("evidence_refs_checked", 0) + 1
    report["evidence_refs_checked"] = evidence_refs_seen
    if evidence_refs_seen > MAX_EVIDENCE_REFS:
        _add_check(report, f"{label}.evidence_ref_count", f"at most {MAX_EVIDENCE_REFS} evidence references per run", evidence_refs_seen, "invalid")
        return False
    if type(evidence) is not dict or set(evidence) != {"path", "sha256"}:
        _add_check(report, f"{label}.evidence_shape", {"path", "sha256"}, _typename(evidence), "invalid")
        return False
    path = evidence["path"]
    declared_hash = evidence["sha256"]
    if type(declared_hash) is not str or not SHA256_RE.fullmatch(declared_hash):
        _add_check(report, f"{label}.sha256", "64 lowercase hex characters", declared_hash, "invalid")
        return False
    prefixes = EVIDENCE_PREFIXES["component-pin" if component_pin else kind]
    try:
        raw = _read_local_file(root, path, max_bytes=MAX_EVIDENCE_BYTES, allowed_prefixes=prefixes)
    except InputProblem as exc:
        _add_check(report, f"{label}.local_file", "bounded regular file under designated evidence directory", path, "invalid", str(exc))
        return False
    actual_hash = hashlib.sha256(raw).hexdigest()
    if actual_hash != declared_hash:
        _add_check(report, f"{label}.sha256", declared_hash, actual_hash, "mismatch", "local evidence bytes changed after the manifest digest was recorded")
        return False
    _add_check(report, f"{label}.sha256", declared_hash, actual_hash, "pass")
    _add_check(report, f"{label}.trust", "accepted external evidence verifier", "bytes matched; signer, role, meaning and conformance not authenticated", "untrusted")
    return True


def _load_component_manifest(root: Path, relpath: str, report: dict[str, Any]) -> dict[str, Any] | None:
    try:
        raw = _read_local_file(root, relpath, max_bytes=MAX_COMPONENT_BYTES)
        value = _parse_json(raw, "component manifest")
    except InputProblem as exc:
        _add_check(report, "component_manifest.read", "bounded local component manifest", relpath, "invalid", str(exc))
        return None
    if type(value) is not dict:
        _add_check(report, "component_manifest.shape", "JSON object", _typename(value), "invalid")
        return None
    _add_check(report, "component_manifest.schema", COMPONENT_SCHEMA, value.get("schema"), "pass" if value.get("schema") == COMPONENT_SCHEMA else "invalid")
    _add_check(report, "component_manifest.version", 1, value.get("schema_version"), "pass" if type(value.get("schema_version")) is int and value.get("schema_version") == 1 else "invalid")
    _check_component_manifest_fields(value, root, report)
    return value


def _check_component_manifest_fields(value: dict[str, Any], root: Path, report: dict[str, Any]) -> None:
    required = {"schema", "schema_version", "audit_date", "components", "provider_surfaces", "peer_candidates", "notes"}
    _check_keys(value, required, "component_manifest.keys", report)
    if type(value.get("schema_version")) is not int or value.get("schema_version") != 1:
        _add_check(report, "component_manifest.version_type", "integer 1 (boolean is invalid)", value.get("schema_version"), "invalid")
    if type(value.get("audit_date")) is not str:
        _add_check(report, "component_manifest.audit_date", "date string", _typename(value.get("audit_date")), "invalid")
    components = value.get("components")
    if type(components) is not list or len(components) > MAX_RECORDS:
        _add_check(report, "component_manifest.components", f"array with at most {MAX_RECORDS} records", _typename(components), "invalid")
    else:
        _add_check(report, "component_manifest.component_count", len(COMPONENTS), len(components), "pass" if len(components) == len(COMPONENTS) else "invalid")
    providers = value.get("provider_surfaces")
    if type(providers) is not list or len(providers) > MAX_RECORDS:
        _add_check(report, "component_manifest.provider_surfaces", f"array with at most {MAX_RECORDS} records", _typename(providers), "invalid")
    else:
        _add_check(report, "component_manifest.provider_count", len(PROVIDERS), len(providers), "pass" if len(providers) == len(PROVIDERS) else "invalid")
    candidates = value.get("peer_candidates")
    if type(candidates) is not list or len(candidates) > MAX_RECORDS:
        _add_check(report, "component_manifest.peer_candidates", f"array with at most {MAX_RECORDS} records", _typename(candidates), "invalid")
    else:
        _check_peer_candidate_records(candidates, report)
    if type(value.get("notes")) is not list or len(value.get("notes", [])) > MAX_JSON_ARRAY_ITEMS or any(type(note) is not str for note in value.get("notes", [])):
        _add_check(report, "component_manifest.notes", "bounded string array", _typename(value.get("notes")), "invalid")


def _check_peer_candidate_records(records: Any, report: dict[str, Any]) -> None:
    if type(records) is not list:
        return
    actual: dict[str, Any] = {}
    for index, item in enumerate(records):
        label = f"component_manifest.peer_candidates[{index}]"
        keys = {"id", "repository", "revision", "state", "paths", "owner_agreement_status", "accepted_revision"}
        if not _check_keys(item, keys, f"{label}.keys", report):
            continue
        candidate_id = item["id"]
        if type(candidate_id) is not str or candidate_id not in PEER_CANDIDATES or candidate_id in actual:
            _add_check(report, f"{label}.id", sorted(PEER_CANDIDATES), candidate_id, "invalid")
            continue
        actual[candidate_id] = item
        expected = PEER_CANDIDATES[candidate_id]
        for field in ("repository", "revision", "state", "paths", "owner_agreement_status"):
            _add_check(report, f"{label}.{field}", expected[field], item[field], "pass" if item[field] == expected[field] and type(item[field]) is type(expected[field]) else "mismatch")
        if item["accepted_revision"] is not None:
            _add_check(report, f"{label}.accepted_revision", None, item["accepted_revision"], "invalid", "candidate peer exports remain unaccepted until neutral owner agreement and independent verification")
        else:
            _add_check(report, f"{label}.accepted_revision", "null until owner-accepted canonical artifact exists", None, "pass")
        _add_check(report, f"{label}.readiness", "available proposal only; never canonical proof", "unaccepted", "informational")
    if set(actual) != set(PEER_CANDIDATES):
        _add_check(report, "component_manifest.peer_candidate_inventory", sorted(PEER_CANDIDATES), sorted(actual), "invalid")


def _check_component_records(records: Any, root: Path, report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if type(records) is not list:
        return result
    for index, item in enumerate(records):
        label = f"component_manifest.components[{index}]"
        keys = {"id", "repository", "owner_role", "observed_revision", "accepted_revision", "state", "mode", "pin_evidence"}
        if not _check_keys(item, keys, f"{label}.keys", report):
            continue
        component_id = item["id"]
        if type(component_id) is not str or component_id not in COMPONENTS:
            _add_check(report, f"{label}.id", sorted(COMPONENTS), component_id, "invalid")
            continue
        if component_id in result:
            _add_check(report, f"{label}.id", "unique component ID", component_id, "invalid")
            continue
        expected = COMPONENTS[component_id]
        result[component_id] = item
        for field in ("repository", "owner_role", "observed_revision"):
            _add_check(report, f"{label}.{field}", expected[field], item[field], "pass" if item[field] == expected[field] else "mismatch")
        accepted = item["accepted_revision"]
        if accepted is not None and (type(accepted) is not str or not COMMIT_RE.fullmatch(accepted)):
            _add_check(report, f"{label}.accepted_revision", "null or full 40-character commit", accepted, "invalid")
        elif accepted is None:
            _add_check(report, f"{label}.accepted_revision", "reviewed full commit pin", None, "missing", "observed documentation revision is not an accepted implementation pin")
        else:
            _add_check(report, f"{label}.accepted_revision", "reviewed full commit pin", accepted, "untrusted", "a commit string is a claim until independently verified")
        expected_state = "pending" if accepted is None else "pinned"
        _add_check(report, f"{label}.state", expected_state, item["state"], "pass" if item["state"] == expected_state else "mismatch")
        if type(item["mode"]) is not str or item["mode"] not in MODES:
            _add_check(report, f"{label}.mode", sorted(MODES), item["mode"], "invalid")
        else:
            _add_check(report, f"{label}.mode", sorted(MODES - {"unknown"}), item["mode"], "missing" if item["mode"] == "unknown" else "untrusted")
            if item["mode"] == "unknown":
                _missing(report, f"component-mode:{component_id}", expected["owner_role"], "explicit dependency mode", "unknown", "component mode is not recorded", "Record mock, recorded, sandbox or live separately for this component.")
        if accepted is None and item["pin_evidence"] is not None:
            _add_check(report, f"{label}.pin_evidence", None, item["pin_evidence"], "invalid", "pending component cannot carry a pin evidence claim")
        elif accepted is not None and item["pin_evidence"] is None:
            _add_check(report, f"{label}.pin_evidence", "sanitized pin receipt", None, "missing")
        elif accepted is not None:
            # Component pin receipts are not a schema or code import; only their bytes are hashed.
            _validate_evidence_ref(root, item["pin_evidence"], label=f"{label}.pin_evidence", kind="handoff-contracts", report=report, component_pin=True)
    expected_ids = set(COMPONENTS)
    actual_ids = set(result)
    if actual_ids != expected_ids:
        _add_check(report, "component_manifest.component_inventory", sorted(expected_ids), sorted(actual_ids), "invalid")
    return result


def _check_provider_records(records: Any, report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if type(records) is not list:
        return result
    expected_keys = {
        "id", "owner_role", "status", "endpoint_api_version", "sdk_runtime_version",
        "model_id_version", "parameters", "retry_limit", "account_project_eligibility",
        "rate_card_source", "rate_card_effective_date", "mode", "usage",
    }
    for index, item in enumerate(records):
        label = f"component_manifest.provider_surfaces[{index}]"
        if not _check_keys(item, expected_keys, f"{label}.keys", report):
            continue
        provider_id = item["id"]
        if type(provider_id) is not str or provider_id not in PROVIDERS:
            _add_check(report, f"{label}.id", sorted(PROVIDERS), provider_id, "invalid")
            continue
        if provider_id in result:
            _add_check(report, f"{label}.id", "unique provider surface ID", provider_id, "invalid")
            continue
        result[provider_id] = item
        _add_check(report, f"{label}.owner_role", PROVIDERS[provider_id]["owner_role"], item["owner_role"], "pass" if item["owner_role"] == PROVIDERS[provider_id]["owner_role"] else "mismatch")
        if type(item["status"]) is not str or item["status"] not in {"pending", "recorded"}:
            _add_check(report, f"{label}.status", ["pending", "recorded"], item["status"], "invalid", "ready/approved booleans are not accepted readiness evidence")
        else:
            _add_check(report, f"{label}.status", ["pending", "recorded"], item["status"], "missing" if item["status"] == "pending" else "untrusted", "recorded metadata still needs trusted owner verification")
        if type(item["mode"]) is not str or item["mode"] not in MODES:
            _add_check(report, f"{label}.mode", sorted(MODES), item["mode"], "invalid")
        else:
            _add_check(report, f"{label}.mode", sorted(MODES - {"unknown"}), item["mode"], "missing" if item["mode"] == "unknown" else "untrusted")
        if provider_id in {"jev", "research-vision-reasoning", "gpt-image"}:
            model = item["model_id_version"]
            if model is not None and (type(model) is not str or not model or model.lower() in {"latest", "auto"} or "latest" in model.lower()):
                _add_check(report, f"{label}.model_pin", "explicit versioned model identifier, no moving alias", model, "invalid")
            elif model is None:
                _add_check(report, f"{label}.model_pin", "explicit versioned model identifier", None, "missing", "provider-specific model selection is unverified and must remain owner supplied")
            else:
                _add_check(report, f"{label}.model_pin", "explicit versioned model identifier", model, "untrusted")
        for field in ("endpoint_api_version", "sdk_runtime_version", "parameters", "retry_limit", "account_project_eligibility", "rate_card_source", "rate_card_effective_date"):
            item_value = item[field]
            if field == "retry_limit" and item_value is not None and type(item_value) is not int:
                _add_check(report, f"{label}.{field}", "integer or null (booleans invalid)", item_value, "invalid")
            elif item_value is not None and type(item_value) not in {str, dict, list}:
                _add_check(report, f"{label}.{field}", "string/object/array or null", _typename(item_value), "invalid")
            elif item_value is None:
                _add_check(report, f"{label}.{field}", "owner-verified value or explicit limitation", None, "missing")
        _validate_usage(item["usage"], f"{label}.usage", report)
    expected_ids = set(PROVIDERS)
    actual_ids = set(result)
    if actual_ids != expected_ids:
        _add_check(report, "component_manifest.provider_inventory", sorted(expected_ids), sorted(actual_ids), "invalid")
    return result


def _check_component_bindings(
    kind: str,
    spec: HandoffSpec,
    handoff: dict[str, Any],
    root: Path,
    components: dict[str, dict[str, Any]],
    providers: dict[str, dict[str, Any]],
    report: dict[str, Any],
) -> None:
    required_components = handoff.get("required_components")
    expected_components = list(spec.components)
    if type(required_components) is not list or required_components != expected_components:
        _add_check(report, f"{kind}.required_components", expected_components, required_components, "mismatch")
    pins = handoff.get("pins")
    if type(pins) is not dict:
        _add_check(report, f"{kind}.pins", expected_components, _typename(pins), "invalid")
        pins = {}
    if set(pins) != set(expected_components):
        _add_check(report, f"{kind}.pin_inventory", sorted(expected_components), sorted(pins), "invalid")
    for component_id in spec.components:
        label = f"{kind}.pins.{component_id}"
        pin = pins.get(component_id)
        if type(pin) is not dict or set(pin) != {"revision", "evidence"}:
            _add_check(report, label, {"revision", "evidence"}, _typename(pin), "invalid")
            continue
        component = components.get(component_id)
        accepted = component.get("accepted_revision") if component else None
        revision = pin["revision"]
        if revision is None:
            _add_check(report, f"{label}.revision", "accepted component revision", None, "missing")
            _missing(report, f"pin:{component_id}", COMPONENTS[component_id]["owner_role"], "full accepted implementation commit and pin evidence", "unresolved", "no accepted external component revision is present", f"Publish the narrow delivering artifact and record its full commit after owner review.")
        elif type(revision) is not str or not COMMIT_RE.fullmatch(revision):
            _add_check(report, f"{label}.revision", "full 40-character commit", revision, "invalid")
        elif accepted is None:
            _add_check(report, f"{label}.revision", "match to accepted component-manifest pin", revision, "mismatch", "manifest pin cannot replace an accepted component pin")
        elif revision != accepted:
            _add_check(report, f"{label}.revision", accepted, revision, "mismatch")
        else:
            _add_check(report, f"{label}.revision", accepted, revision, "untrusted", "revision strings are not fetched or independently authenticated")
        if pin["evidence"] is None:
            _add_check(report, f"{label}.evidence", "sanitized pin receipt", None, "missing")
        else:
            _validate_evidence_ref(root, pin["evidence"], label=f"{label}.evidence", kind=kind, report=report, component_pin=True)

    for provider_id in spec.provider_surfaces:
        provider = providers.get(provider_id)
        if provider is None:
            _add_check(report, f"{kind}.provider.{provider_id}", "provider record", None, "missing")
            _missing(report, f"provider:{provider_id}", PROVIDERS[provider_id]["owner_role"], "sanitized account/configuration record and explicit mode", "missing", "required provider surface has no record", "Provide a sanitized record through the approved owner process; never include credentials.")
        elif provider.get("status") != "recorded" or provider.get("mode") in {"mock", "simulated", "unknown"}:
            _add_check(report, f"{kind}.provider.{provider_id}", "recorded owner-verified readiness evidence", {"status": provider.get("status"), "mode": provider.get("mode")}, "missing")
            _missing(report, f"provider:{provider_id}", PROVIDERS[provider_id]["owner_role"], "nonbillable readiness record with explicit mode and verified account/model eligibility", {"status": provider.get("status"), "mode": provider.get("mode")}, "access and configuration are not established", "Record the owner-verified account and explicit configuration, or record a safe-check limitation.")
        else:
            _add_check(report, f"{kind}.provider.{provider_id}", "recorded owner-verified readiness evidence", {"status": provider.get("status"), "mode": provider.get("mode")}, "untrusted", "metadata presence is not account or budget authority proof")
    for provider_id in spec.related_provider_surfaces:
        provider = providers.get(provider_id)
        _add_check(report, f"{kind}.related_provider.{provider_id}", "separate release record; not a blocker for this narrow handoff", {"status": provider.get("status") if provider else "missing", "mode": provider.get("mode") if provider else "missing"}, "informational")


def _validate_manifest_header(manifest: Any, report: dict[str, Any]) -> bool:
    if type(manifest) is not dict:
        _add_check(report, "manifest.shape", "JSON object", _typename(manifest), "invalid")
        return False
    header_keys = {
        "schema", "schema_version", "repository", "baseline_revision", "component_manifest",
        "evidence_verifier_id", "handoffs",
    }
    valid = _check_keys(manifest, header_keys, "manifest.keys", report)
    schema = manifest.get("schema")
    _add_check(report, "manifest.schema", MANIFEST_SCHEMA, schema, "pass" if schema == MANIFEST_SCHEMA else "invalid")
    version = manifest.get("schema_version")
    if type(version) is int and version == 1:
        _add_check(report, "manifest.version", 1, version, "pass")
    else:
        _add_check(report, "manifest.version", "integer 1 (boolean is invalid)", version, "invalid")
        valid = False
    _add_check(report, "manifest.repository", "event-intelligence", manifest.get("repository"), "pass" if manifest.get("repository") == "event-intelligence" else "invalid")
    baseline = manifest.get("baseline_revision")
    _add_check(report, "manifest.baseline_revision", "full source revision", baseline, "pass" if type(baseline) is str and COMMIT_RE.fullmatch(baseline) else "invalid")
    expected_component_path = "release/component-manifest.json"
    _add_check(report, "manifest.component_manifest", expected_component_path, manifest.get("component_manifest"), "pass" if manifest.get("component_manifest") == expected_component_path else "invalid")
    verifier_id = manifest.get("evidence_verifier_id")
    if verifier_id is None:
        _add_check(report, "trust.evidence_verifier", "accepted verifier implementation", None, "missing", "no trusted role/approval/evidence verifier has been accepted or implemented")
    else:
        _add_check(report, "trust.evidence_verifier", "accepted verifier implementation", verifier_id, "untrusted", "manifest-selected verifier IDs are never loaded or trusted")
    _add_check(report, "trust.registry", EVIDENCE_VERIFIER_ID, "unavailable", "missing", "the checker has no trusted verifier registry entry")
    handoffs = manifest.get("handoffs")
    if type(handoffs) is not dict:
        _add_check(report, "manifest.handoffs", list(KINDS), _typename(handoffs), "invalid")
        return False
    if set(handoffs) != set(KINDS):
        _add_check(report, "manifest.handoff_inventory", list(KINDS), sorted(handoffs), "invalid")
        valid = False
    else:
        _add_check(report, "manifest.handoff_inventory", list(KINDS), sorted(handoffs), "pass")
    return valid


def _check_handoff_structure(
    kind: str,
    value: Any,
    spec: HandoffSpec,
    root: Path,
    components: dict[str, dict[str, Any]],
    providers: dict[str, dict[str, Any]],
    report: dict[str, Any],
) -> bool:
    if type(value) is not dict:
        _add_check(report, f"{kind}.shape", "JSON object", _typename(value), "invalid")
        return False
    expected_keys = {
        "triage_key", "owner_role", "local_requirement_ids", "acceptance_roles", "workflow_state",
        "dependency_mode", "usage", "required_components", "pins", "artifacts", "fixtures", "crosswalk",
    }
    structurally_valid = _check_keys(value, expected_keys, f"{kind}.keys", report)
    for field, expected in (
        ("triage_key", spec.triage_key),
        ("owner_role", spec.owner_role),
        ("local_requirement_ids", list(spec.requirements)),
    ):
        actual = value.get(field)
        _add_check(report, f"{kind}.{field}", expected, actual, "pass" if actual == expected and type(actual) is type(expected) else "mismatch")
        if actual != expected or type(actual) is not type(expected):
            structurally_valid = False
    _add_check(report, f"{kind}.workflow_state", "blocked", value.get("workflow_state"), "pass" if value.get("workflow_state") == "blocked" else "mismatch")
    if value.get("workflow_state") != "blocked":
        structurally_valid = False
    mode = value.get("dependency_mode")
    if type(mode) is not str or mode not in MODES:
        _add_check(report, f"{kind}.dependency_mode", sorted(MODES), mode, "invalid")
        structurally_valid = False
    else:
        _add_check(report, f"{kind}.dependency_mode", sorted(MODES - {"unknown"}), mode, "missing" if mode == "unknown" else "untrusted")
    _validate_usage(value.get("usage"), f"{kind}.usage", report)

    expected_roles = dict(spec.acceptance_roles)
    roles = value.get("acceptance_roles")
    if type(roles) is not dict or roles != expected_roles:
        _add_check(report, f"{kind}.acceptance_roles", expected_roles, roles, "mismatch", "acceptance ownership is scoped to these roles and does not prove whole-criterion completion")
        structurally_valid = False
    else:
        _add_check(report, f"{kind}.acceptance_roles", expected_roles, roles, "pass")

    _check_component_bindings(kind, spec, value, root, components, providers, report)
    _check_crosswalk(kind, spec, value.get("crosswalk"), report)
    _check_artifacts(kind, spec, value.get("artifacts"), root, components, report)
    _check_fixtures(kind, spec, value.get("fixtures"), root, components, report)
    return structurally_valid


def _check_crosswalk(kind: str, spec: HandoffSpec, value: Any, report: dict[str, Any]) -> None:
    if type(value) is not dict:
        _add_check(report, f"{kind}.crosswalk", sorted(spec.crosswalk), _typename(value), "invalid")
        return
    if set(value) != set(spec.crosswalk):
        _add_check(report, f"{kind}.crosswalk.inventory", sorted(spec.crosswalk), {"present": sorted(value), "missing": sorted(set(spec.crosswalk) - set(value)), "unexpected": sorted(set(value) - set(spec.crosswalk))}, "invalid")
    for item_id, expected_description in spec.crosswalk.items():
        item = value.get(item_id)
        label = f"{kind}.crosswalk.{item_id}"
        if type(item) is not dict or set(item) != {"expectation", "resolution", "owner_role"}:
            _add_check(report, label, {"expectation", "resolution", "owner_role"}, _typename(item), "invalid")
            _missing(report, f"crosswalk:{item_id}", spec.owner_role, expected_description, "missing", "required crosswalk decision is absent or malformed", "Record the external producer/consumer decision with its pinned review artifact.")
            continue
        if item["expectation"] != expected_description:
            _add_check(report, f"{label}.expectation", expected_description, item["expectation"], "mismatch")
        expected_owner = CROSSWALK_OWNER_OVERRIDES.get(kind, {}).get(item_id, spec.owner_role)
        if item["owner_role"] != expected_owner:
            _add_check(report, f"{label}.owner_role", expected_owner, item["owner_role"], "mismatch")
        resolution = item["resolution"]
        if resolution is None:
            _add_check(report, f"{label}.resolution", "owner-reviewed resolution", None, "missing", "checker expectation is not a canonical field decision")
            _missing(report, f"crosswalk:{item_id}", item["owner_role"], expected_description, None, "field or behavior decision remains undecided", "Obtain the exact field decision from the listed contract owners and update the pinned crosswalk artifact.")
        elif kind == "handoff-consumer" and item_id == "program_epic_reference":
            expected_url = "https://github.com/Jevelopers-neatHack-2026/agent-harness/issues/3"
            if type(resolution) is str and resolution == expected_url:
                _add_check(report, f"{label}.resolution", expected_url, resolution, "untrusted", "the known coordinator URL is informational and does not prove program coverage or consumer readiness")
            else:
                _add_check(report, f"{label}.resolution", expected_url, resolution, "mismatch", "the crosswalk must identify the sole harness coordinator epic")
                _missing(report, f"crosswalk:{item_id}", expected_owner, expected_description, resolution, "coordinator reference is not the required epic URL", "Record the exact coordinator URL after owner review; the link itself remains informational.")
        elif type(resolution) is str and resolution.strip():
            _add_check(report, f"{label}.resolution", "owner-reviewed resolution", resolution, "untrusted", "a manifest string does not authenticate the external decision")
        else:
            _add_check(report, f"{label}.resolution", "null or non-empty decision string", resolution, "invalid")


def _check_artifacts(
    kind: str,
    spec: HandoffSpec,
    value: Any,
    root: Path,
    components: dict[str, dict[str, Any]],
    report: dict[str, Any],
) -> None:
    if type(value) is not dict:
        _add_check(report, f"{kind}.artifacts", sorted(spec.artifacts), _typename(value), "invalid")
        return
    if len(value) > MAX_RECORDS:
        _add_check(report, f"{kind}.artifact_count", f"at most {MAX_RECORDS}", len(value), "invalid")
        return
    if set(value) != set(spec.artifacts):
        missing_ids = set(spec.artifacts) - set(value)
        _add_check(report, f"{kind}.artifact_inventory", sorted(spec.artifacts), {"present": sorted(value), "missing": sorted(missing_ids), "unexpected": sorted(set(value) - set(spec.artifacts))}, "invalid")
        for artifact_id in sorted(missing_ids):
            artifact = spec.artifacts[artifact_id]
            _missing(report, f"artifact:{artifact_id}", artifact.owner_role, artifact.identity, None, "required artifact entry is omitted", f"Supply this exact narrow artifact with its owner-reviewed revision pin and sanitized evidence.")
    for artifact_id, artifact_spec in spec.artifacts.items():
        item = value.get(artifact_id)
        label = f"{kind}.artifacts.{artifact_id}"
        if item is None:
            continue
        keys = {"identity", "component", "owner_role", "required_review_roles", "status", "revision", "mode", "role_claims", "usage", "evidence"}
        if not _check_keys(item, keys, f"{label}.keys", report):
            continue
        for field, expected in (
            ("identity", artifact_spec.identity),
            ("component", artifact_spec.component),
            ("owner_role", artifact_spec.owner_role),
            ("required_review_roles", list(artifact_spec.review_roles)),
        ):
            actual = item[field]
            if actual != expected or type(actual) is not type(expected):
                _add_check(report, f"{label}.{field}", expected, actual, "mismatch")
            else:
                _add_check(report, f"{label}.{field}", expected, actual, "pass")
        status = item["status"]
        if type(status) is not str or status not in {"pending", "provided"}:
            _add_check(report, f"{label}.status", ["pending", "provided"], status, "invalid", "verified/approved/closed/pass status claims are not accepted")
            continue
        revision = item["revision"]
        component = components.get(artifact_spec.component)
        accepted_revision = component.get("accepted_revision") if component else None
        if status == "pending":
            _add_check(report, f"{label}.status", "provided evidence", "pending", "missing")
            _missing(report, f"artifact:{artifact_id}", artifact_spec.owner_role, artifact_spec.identity, "pending", "required external artifact is not present", f"Deliver and pin {artifact_spec.identity}; keep its actual owner acknowledgement and fixture receipts accessible.")
            if item["evidence"] is not None or item["revision"] is not None:
                _add_check(report, f"{label}.pending_claims", {"evidence": None, "revision": None}, {"evidence": item["evidence"], "revision": revision}, "invalid", "pending artifacts may not carry unverified evidence or pin claims")
        else:
            if type(revision) is not str or not COMMIT_RE.fullmatch(revision):
                _add_check(report, f"{label}.revision", "full 40-character commit", revision, "invalid")
            elif accepted_revision is None or revision != accepted_revision:
                _add_check(report, f"{label}.revision", accepted_revision, revision, "mismatch", "artifact revision does not match an accepted component pin")
            else:
                _add_check(report, f"{label}.revision", accepted_revision, revision, "untrusted", "matching revision strings are not independently authenticated")
            if item["evidence"] is None:
                _add_check(report, f"{label}.evidence", "sanitized receipt path and SHA-256", None, "missing")
            else:
                _validate_evidence_ref(root, item["evidence"], label=label, kind=kind, report=report)
            roles = item["role_claims"]
            if type(roles) is not list or roles != list(artifact_spec.review_roles):
                _add_check(report, f"{label}.role_claims", list(artifact_spec.review_roles), roles, "mismatch", "role strings are assertions and are never approval proof")
            else:
                _add_check(report, f"{label}.role_claims", list(artifact_spec.review_roles), roles, "untrusted", "reviewer role claims require an accepted verifier")
            if type(item["mode"]) is not str or item["mode"] not in MODES:
                _add_check(report, f"{label}.mode", sorted(MODES), item["mode"], "invalid")
            elif artifact_spec.rejects_mock and item["mode"] in {"mock", "simulated", "unknown"}:
                _add_check(report, f"{label}.mode", ["recorded", "sandbox", "live"], item["mode"], "missing", "mock/simulated/unknown mode cannot prove the required external artifact")
            else:
                _add_check(report, f"{label}.mode", sorted(MODES - {"unknown"}), item["mode"], "untrusted" if item["mode"] != "unknown" else "missing")
        _validate_usage(item["usage"], f"{label}.usage", report)


def _check_fixtures(
    kind: str,
    spec: HandoffSpec,
    value: Any,
    root: Path,
    components: dict[str, dict[str, Any]],
    report: dict[str, Any],
) -> None:
    if type(value) is not dict:
        _add_check(report, f"{kind}.fixtures", sorted(spec.fixtures), _typename(value), "invalid")
        return
    if len(value) > MAX_RECORDS:
        _add_check(report, f"{kind}.fixture_count", f"at most {MAX_RECORDS}", len(value), "invalid")
        return
    if set(value) != set(spec.fixtures):
        missing_ids = set(spec.fixtures) - set(value)
        _add_check(report, f"{kind}.fixture_inventory", sorted(spec.fixtures), {"present": sorted(value), "missing": sorted(missing_ids), "unexpected": sorted(set(value) - set(spec.fixtures))}, "invalid")
        for fixture_id in sorted(missing_ids):
            fixture = spec.fixtures[fixture_id]
            _missing(report, f"fixture:{fixture_id}", fixture.owner_role, fixture.expected, None, "required fixture identity is omitted", "Execute this acceptance fixture against the pinned real artifacts and provide an accessible sanitized receipt.")
    for fixture_id, fixture_spec in spec.fixtures.items():
        item = value.get(fixture_id)
        label = f"{kind}.fixtures.{fixture_id}"
        if item is None:
            continue
        keys = {"expected", "owner_role", "status", "case_count", "mode", "subject_kind", "revision_pins", "usage", "evidence"}
        if not _check_keys(item, keys, f"{label}.keys", report):
            continue
        _add_check(report, f"{label}.expected", fixture_spec.expected, item["expected"], "pass" if item["expected"] == fixture_spec.expected else "mismatch")
        _add_check(report, f"{label}.owner_role", fixture_spec.owner_role, item["owner_role"], "pass" if item["owner_role"] == fixture_spec.owner_role else "mismatch")
        status = item["status"]
        if type(status) is not str or status not in {"pending", "reported_pass", "reported_fail", "skipped"}:
            _add_check(report, f"{label}.status", ["pending", "reported_pass", "reported_fail", "skipped"], status, "invalid", "fixture booleans or unqualified pass strings are not accepted")
            continue
        case_count = item["case_count"]
        if type(case_count) is not int or case_count < 0:
            _add_check(report, f"{label}.case_count", f"non-negative integer; at least {fixture_spec.required_case_count} for coverage", case_count, "invalid", "boolean-as-integer and negative case counts are invalid")
        elif case_count < fixture_spec.required_case_count:
            case_status = "fail" if status in {"reported_pass", "reported_fail"} else "missing"
            _add_check(report, f"{label}.case_count", f"at least {fixture_spec.required_case_count}", case_count, case_status, "zero executed cases cannot cover a required fixture")
            if status in {"reported_pass", "reported_fail"}:
                _missing(report, f"fixture:{fixture_id}", fixture_spec.owner_role, fixture_spec.expected, {"status": status, "case_count": case_count}, "reported fixture has no executed cases", "Execute the required fixture and record a positive case count with a sanitized receipt.")
        elif status in {"pending", "skipped"}:
            _add_check(report, f"{label}.case_count", 0, case_count, "invalid", "pending or skipped fixtures may not claim executed cases")
        else:
            _add_check(report, f"{label}.case_count", f"at least {fixture_spec.required_case_count}", case_count, "untrusted", "case counts are self-reported until an accepted execution verifier authenticates them")
        if status != "reported_pass":
            reason = "fixture is zero-result, skipped or not run" if status == "skipped" else "required fixture has not reported a pass" if status == "pending" else "fixture reported failure"
            _add_check(report, f"{label}.status", "trusted executed pass", status, "missing" if status in {"pending", "skipped"} else "fail", reason)
            _missing(report, f"fixture:{fixture_id}", fixture_spec.owner_role, fixture_spec.expected, status, reason, "Execute the named fixture on the matching pinned artifacts; do not mark it skipped or count zero cases as coverage.")
        else:
            _add_check(report, f"{label}.status", "trusted executed pass", status, "untrusted", "reported fixture status is not execution or conformance proof")
            _missing(report, f"fixture:{fixture_id}", fixture_spec.owner_role, fixture_spec.expected, "reported_pass (untrusted)", "no trusted test-run evidence verifier is configured", "Supply retrievable sanitized execution evidence and use an accepted verifier for the pinned revision.")
        mode = item["mode"]
        if type(mode) is not str or mode not in MODES:
            _add_check(report, f"{label}.mode", sorted(MODES), mode, "invalid")
        elif fixture_spec.rejects_mock and mode in {"mock", "simulated", "unknown"}:
            _add_check(report, f"{label}.mode", ["recorded", "sandbox", "live"], mode, "missing", "mock/simulated/unknown mode is not qualifying evidence")
        else:
            _add_check(report, f"{label}.mode", sorted(MODES - {"unknown"}), mode, "untrusted")
        subject_kind = item["subject_kind"]
        expected_subject = "actual_consumer" if fixture_spec.actual_consumer_required else "implementation_or_contract"
        if subject_kind != expected_subject:
            _add_check(report, f"{label}.subject_kind", expected_subject, subject_kind, "mismatch", "a local consumer double cannot satisfy consumer readiness")
        elif fixture_spec.actual_consumer_required and status == "reported_pass":
            _add_check(report, f"{label}.subject_kind", expected_subject, subject_kind, "untrusted", "self-reported subject kind is not independently authenticated")
        else:
            _add_check(report, f"{label}.subject_kind", expected_subject, subject_kind, "pass")
        pins = item["revision_pins"]
        if type(pins) is not dict or set(pins) != set(fixture_spec.components):
            _add_check(report, f"{label}.revision_pins", sorted(fixture_spec.components), pins, "mismatch")
        else:
            for component_id in fixture_spec.components:
                actual_pin = pins[component_id]
                component = components.get(component_id)
                expected_pin = component.get("accepted_revision") if component else None
                if status == "pending" and actual_pin is None:
                    _add_check(report, f"{label}.revision_pins.{component_id}", "accepted component revision", None, "missing")
                elif type(actual_pin) is not str or not COMMIT_RE.fullmatch(actual_pin):
                    _add_check(report, f"{label}.revision_pins.{component_id}", "full 40-character commit", actual_pin, "invalid")
                elif expected_pin is None or actual_pin != expected_pin:
                    _add_check(report, f"{label}.revision_pins.{component_id}", expected_pin, actual_pin, "mismatch", "fixture revision does not match accepted component revision")
                else:
                    _add_check(report, f"{label}.revision_pins.{component_id}", expected_pin, actual_pin, "untrusted", "revision equality does not prove the fixture ran on that revision")
        if status == "reported_pass" and item["evidence"] is None:
            _add_check(report, f"{label}.evidence", "sanitized execution receipt path and SHA-256", None, "missing")
        elif item["evidence"] is None:
            _add_check(report, f"{label}.evidence", "receipt when executed", None, "missing" if status != "pending" else "informational")
        else:
            _validate_evidence_ref(root, item["evidence"], label=label, kind=kind, report=report)
        _validate_usage(item["usage"], f"{label}.usage", report)


def _load_manifest(root: Path, manifest_relpath: str, report: dict[str, Any]) -> dict[str, Any] | None:
    try:
        parts = _safe_relative_path(manifest_relpath)
        if "/".join(parts) != "tests/contracts/handoff-manifest.json":
            raise InputProblem("manifest path must be tests/contracts/handoff-manifest.json")
        raw = _read_local_file(root, manifest_relpath, max_bytes=MAX_MANIFEST_BYTES)
        manifest = _parse_json(raw, "handoff manifest")
    except InputProblem as exc:
        _add_check(report, "manifest.read", "bounded local tests/contracts/handoff-manifest.json", manifest_relpath, "invalid", str(exc))
        return None
    return manifest if type(manifest) is dict else manifest


def audit(root: Path, manifest_path: str, kind: str) -> dict[str, Any]:
    if kind not in HANDOFF_SPECS:
        raise ValueError(f"unsupported kind: {kind}")
    root = Path(root)
    spec = HANDOFF_SPECS[kind]
    report: dict[str, Any] = {
        "tool": "event-intelligence-handoff-checker",
        "tool_version": TOOL_VERSION,
        "kind": kind,
        "triage_key": spec.triage_key,
        "manifest": manifest_path,
        "readiness_status": "INVALID",
        "ready": False,
        "checks": [],
        "missing_deliverables": [],
        "evidence_refs_checked": 0,
        "limitations": [
            "This checker validates a local metadata catalog and bounded file digests; it does not establish canonical schema conformance.",
            "No accepted trusted evidence/approval verifier is implemented; role strings, approval claims, issue state and test result text are not proof.",
            "The checker never fetches URLs, imports evidence code, runs manifest commands, reads credentials, or inspects files outside designated paths.",
            "A reported fixture pass is an untrusted claim until independently authenticated and tied to accepted artifact pins.",
        ],
    }
    manifest = _load_manifest(root, manifest_path, report)
    if manifest is None:
        return _finish_report(report)
    if not _validate_manifest_header(manifest, report):
        return _finish_report(report)

    component_path = manifest.get("component_manifest")
    components_manifest = _load_component_manifest(root, component_path, report)
    if components_manifest is None:
        return _finish_report(report)
    components = _check_component_records(components_manifest.get("components"), root, report)
    providers = _check_provider_records(components_manifest.get("provider_surfaces"), report)
    handoffs = manifest.get("handoffs", {})
    if kind not in handoffs:
        _add_check(report, f"{kind}.present", "required handoff object", None, "invalid")
        return _finish_report(report)
    _check_handoff_structure(kind, handoffs[kind], spec, root, components, providers, report)
    # A trusted verifier is mandatory for readiness, even if every file hash and every
    # self-reported status matches. This makes the current absence visible and fail-closed.
    if EVIDENCE_VERIFIER_ID is None:
        _missing(
            report,
            "trusted-evidence-verifier",
            spec.owner_role,
            "accepted verifier for externally authorized role, pin, fixture and approval evidence",
            "unavailable",
            "the checker cannot authenticate owner authority or test-run provenance",
            "Obtain the owners' accepted attestation format and trust root, then add a reviewed in-process verifier; never load one from the manifest.",
        )
    return _finish_report(report)


def _finish_report(report: dict[str, Any]) -> dict[str, Any]:
    invalid = any(check["status"] == "invalid" for check in report["checks"])
    mismatched = any(check["status"] in {"mismatch", "fail"} for check in report["checks"])
    missing = len(report["missing_deliverables"])
    report["summary"] = {
        "checks": len(report["checks"]),
        "failed_or_invalid": sum(check["status"] in {"invalid", "mismatch", "fail"} for check in report["checks"]),
        "unverified_claims": sum(check["status"] == "untrusted" for check in report["checks"]),
        "missing_deliverables": missing,
        "required_artifacts": len(HANDOFF_SPECS[report["kind"]].artifacts),
        "required_fixtures": len(HANDOFF_SPECS[report["kind"]].fixtures),
        "fixture_pass_claims": sum(check["id"].endswith(".status") and check["status"] == "untrusted" for check in report["checks"]),
        "evidence_refs_checked": report.get("evidence_refs_checked", 0),
        "required_usage_default": "unknown (never assumed zero)",
    }
    if invalid or mismatched:
        report["readiness_status"] = "INVALID"
        report["exit_code"] = 2
    elif report["missing_deliverables"]:
        report["readiness_status"] = "BLOCKED"
        report["exit_code"] = 1
    else:
        # The verifier check is deliberately unresolved in this version; this branch is
        # unreachable until a reviewed verifier and trusted evidence are implemented.
        report["readiness_status"] = "BLOCKED"
        report["exit_code"] = 1
        report["missing_deliverables"].append({
            "id": "trusted-evidence-verifier",
            "owner_role": "Agent and research",
            "expected": "accepted trusted verifier",
            "actual": "unavailable",
            "reason": "no accepted evidence verifier exists",
            "next_action": "Add an owner-approved verifier in code after the trust protocol is agreed.",
        })
    return report


def _repository_root() -> Path:
    return Path(__file__).resolve().parent.parent


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check bounded local EI handoff evidence; readiness fails closed.")
    parser.add_argument("--kind", required=True, choices=KINDS, help="one handoff scope to check")
    parser.add_argument("--manifest", required=True, help="repository-relative tests/contracts/handoff-manifest.json")
    parser.add_argument("--version", action="version", version=TOOL_VERSION)
    args = parser.parse_args(argv)
    report = audit(_repository_root(), args.manifest, args.kind)
    print(json.dumps(report, sort_keys=True, indent=2, ensure_ascii=True))
    return int(report["exit_code"])


if __name__ == "__main__":
    raise SystemExit(main())
