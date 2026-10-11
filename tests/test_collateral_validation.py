import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.validate_collateral import (  # noqa: E402
    DEFAULT_SUBMISSION_SELECTION,
    REQUIRED_SUBMISSION_ASSET_IDS,
    REQUIRED_SUBMISSION_CLAIM_IDS,
    REQUIRED_SUBMISSION_EVIDENCE_CLASS_IDS,
    release_blockers,
    selected_collateral_blockers,
    submission_blockers,
    validate_all,
    validate_claims,
    validate_fixture,
    validate_inventory,
    validate_inventory_provenance,
    validate_provenance,
    validate_provenance_composition,
    validate_provenance_lineage,
    validate_visual_copy,
)


def read_json(relative_path):
    with (ROOT / relative_path).open(encoding="utf-8") as handle:
        return json.load(handle)


class CollateralPolicyValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.claims = read_json("messaging/claims.json")
        cls.provenance = read_json("review/provenance.json")
        cls.fixture = read_json("review/fixtures/synthetic-canaries.json")
        cls.handoff = read_json("review/visual/asset-handoff.json")
        cls.inventory = read_json("docs/collateral-inventory.json")

    def test_current_draft_records_are_structurally_valid(self):
        self.assertEqual(
            validate_all(
                copy.deepcopy(self.claims),
                copy.deepcopy(self.provenance),
                copy.deepcopy(self.fixture),
                copy.deepcopy(self.handoff),
                copy.deepcopy(self.inventory),
            ),
            [],
        )

    def test_release_remains_blocked_for_missing_evidence_and_rights(self):
        blockers = release_blockers(self.claims, self.provenance)
        self.assertTrue(any("SPN-01" in item for item in blockers))
        self.assertTrue(any("SPN-02" in item for item in blockers))
        self.assertTrue(any("SPN-03" in item for item in blockers))
        self.assertTrue(any("DEMO-SUBMISSION-VIDEO-001" in item for item in blockers))
        self.assertTrue(any("selected destination rights/publishability are not approved" in item for item in blockers))
        self.assertTrue(any("independent visual" in item for item in blockers))
        self.assertFalse(any("CTA-PRODUCT-TRANSACTION-001" in item for item in blockers))
        self.assertFalse(any("text/JSON canary does not establish pixel redaction" in item for item in blockers))

    def test_scoped_visual_redaction_evidence_replaces_blanket_pixel_blocker(self):
        formats = {row["format"]: row for row in self.provenance["visualReview"]["formats"]}
        self.assertIn("controlled synthetic redaction test passes", formats["SVG"]["status"])
        self.assertIn("controlled synthetic redaction test passes", formats["PNG"]["status"])
        self.assertIn("NOT_APPLICABLE", formats["audio/video"]["status"])
        self.assertIn("NOT_APPLICABLE", formats["office/deck exports"]["status"])

    def test_unsupported_automation_live_and_savings_copy_is_rejected(self):
        cases = (
            "The workflow is fully automated from intake through resolution.",
            "This service has a live integration with the sponsor.",
            "Our verified savings reduce operating costs.",
        )
        for unsafe_text in cases:
            with self.subTest(unsafe_text=unsafe_text):
                mutated = copy.deepcopy(self.claims)
                row = next(item for item in mutated["claims"] if item["id"] == "CLAIM-PRODUCT-CAPABILITY-001")
                row["allowedWording"] = unsafe_text
                errors = validate_claims(mutated)
                self.assertTrue(any("unsupported positive wording" in item for item in errors), errors)

    def test_labeled_synthetic_copy_is_accepted_and_mapped_exactly(self):
        errors = validate_fixture(self.fixture, self.claims)
        self.assertEqual(errors, [])
        simulation = next(item for item in self.claims["claims"] if item["id"] == "CLAIM-SIMULATION-001")
        self.assertEqual(simulation["state"], "simulated")
        self.assertIn("Synthetic concept only", simulation["allowedWording"])

    def test_sponsor_evidence_classes_cannot_be_collapsed(self):
        mutated = copy.deepcopy(self.claims)
        entire = next(item for item in mutated["evidenceClasses"] if item["id"] == "SPN-02")
        entire["evidenceRef"] = "SPN-NEATLOGS-001"
        errors = validate_claims(mutated)
        self.assertTrue(any("SPN-02 must have its own unique evidence reference" in item for item in errors), errors)

    def test_unavailable_route_cannot_be_approved_as_a_cta(self):
        mutated = copy.deepcopy(self.claims)
        cta = next(item for item in mutated["ctas"] if item["id"] == "CTA-REPOSITORY-DOCS-001")
        cta["availability"]["status"] = "unavailable_unconfirmed"
        cta["target"] = None
        cta["wordingReview"] = "approved"
        errors = validate_claims(mutated)
        self.assertTrue(any("cannot be approved with unavailable/unconfirmed destination" in item for item in errors), errors)

    def test_unknown_or_revoked_rights_never_allow_publication(self):
        for status in ("unknown", "revoked"):
            with self.subTest(status=status):
                mutated = copy.deepcopy(self.provenance)
                record = mutated["records"][0]
                record["permission"]["status"] = status
                record["publishability"] = "approved"
                self.assertTrue(
                    any("cannot be approved for publication" in item for item in validate_provenance(mutated))
                )

    def test_canary_has_all_requested_text_surfaces_and_redacted_expectations(self):
        source = self.fixture["sourceSurfaces"]
        redacted = self.fixture["expectedRedactedSurfaces"]
        required = {
            "visibleText",
            "fileMetadata",
            "speakerNotes",
            "altText",
            "audioTranscript",
            "qrTarget",
            "linkedResource",
            "extractedExportText",
        }
        self.assertTrue(required.issubset(source))
        self.assertEqual(set(source), set(redacted))
        prefix = self.fixture["canaryPrefix"]
        self.assertTrue(all(prefix in value for value in source.values()))
        self.assertTrue(all(not isinstance(value, str) or prefix not in value for value in redacted.values()))
        self.assertEqual(self.fixture["expectedValidation"]["visualPixelInspection"], "not_performed")
        self.assertEqual(
            self.fixture["expectedValidation"]["metadataAndNotesInspectionOfRenderedExports"],
            "not_performed",
        )

    def test_missing_source_revision_cannot_be_approved(self):
        mutated = copy.deepcopy(self.claims)
        row = next(item for item in mutated["claims"] if item["id"] == "CLAIM-SIMULATION-001")
        row["reviewStatus"] = "approved"
        row["reviewDate"] = "2026-10-11"
        row["source"]["revision"] = None
        errors = validate_claims(mutated)
        self.assertTrue(any("approved claim requires an immutable source revision" in item for item in errors), errors)

    def test_visual_copy_mapping_rejects_missing_claim_and_provenance(self):
        first = self.claims["visualCopy"]["mappings"][0]
        no_claim = copy.deepcopy(self.claims)
        no_claim["claims"] = [row for row in no_claim["claims"] if row.get("id") != first.get("claimId")]
        errors = validate_visual_copy(no_claim, self.handoff, self.provenance)
        self.assertTrue(any("missing claim" in item for item in errors), errors)

        no_provenance = copy.deepcopy(self.provenance)
        no_provenance["records"] = [row for row in no_provenance["records"] if row["assetId"] != first["provenanceRecordId"]]
        errors = validate_visual_copy(self.claims, self.handoff, no_provenance)
        self.assertTrue(any("missing provenance record" in item for item in errors), errors)

    def test_independent_copy_source_manifest_catches_deleted_copy_048(self):
        mutated = copy.deepcopy(self.claims)
        mutated["visualCopy"]["mappings"] = [
            row for row in mutated["visualCopy"]["mappings"] if row.get("mappingId") != "COPY-048"
        ]
        errors = validate_visual_copy(mutated, self.handoff, self.provenance)
        self.assertTrue(any("unmapped copy fragment" in item and "concept-overview.html" in item for item in errors), errors)

    def test_provenance_lineage_rejects_missing_reciprocity_unknown_parent_and_cycles(self):
        baseline = copy.deepcopy(self.provenance)
        self.assertEqual(validate_provenance_lineage(baseline), [])

        mutated = copy.deepcopy(baseline)
        png = next(row for row in mutated["records"] if row["assetId"] == "PROV-DEMO-WORKFLOW-PNG-001")
        png["lineage"]["derivedFrom"] = []
        self.assertTrue(any("does not list this source" in item for item in validate_provenance_lineage(mutated)))

        mutated = copy.deepcopy(baseline)
        png = next(row for row in mutated["records"] if row["assetId"] == "PROV-DEMO-WORKFLOW-PNG-001")
        png["lineage"]["derivedFrom"] = ["MISSING-SOURCE"]
        self.assertTrue(any("unknown lineage source" in item for item in validate_provenance_lineage(mutated)))

        mutated = copy.deepcopy(baseline)
        source = next(row for row in mutated["records"] if row["assetId"] == "DEMO-WORKFLOW-DIAGRAM-001")
        source["lineage"]["derivedFrom"] = ["PROV-DEMO-WORKFLOW-PNG-001"]
        png = next(row for row in mutated["records"] if row["assetId"] == "PROV-DEMO-WORKFLOW-PNG-001")
        png["lineage"]["derivatives"] = ["DEMO-WORKFLOW-DIAGRAM-001"]
        self.assertTrue(any("contains a cycle" in item for item in validate_provenance_lineage(mutated)))

    def _approved_synthetic_selection(self, asset_id):
        return self._approved_synthetic_assets([asset_id])

    def _approved_synthetic_assets(self, asset_ids):
        claims = copy.deepcopy(self.claims)
        provenance = copy.deepcopy(self.provenance)
        selected_assets = set(asset_ids)
        mappings = claims["visualCopy"]["mappings"]
        records_by_id = {row["assetId"]: row for row in provenance["records"]}
        composed_record_ids = set()
        changed = True
        while changed:
            before = (set(selected_assets), set(composed_record_ids))
            for context in claims["visualCopy"]["qualifierContexts"]:
                related = set(context.get("relatedAssetIds", []))
                if related & selected_assets:
                    selected_assets.update(related)
            for mapping in mappings:
                if mapping.get("assetId") not in selected_assets:
                    continue
                record = records_by_id.get(mapping.get("provenanceRecordId"), {})
                for dependency_id in record.get("compositionDependencies", []):
                    composed_record_ids.add(dependency_id)
                    selected_assets.update(
                        item.get("assetId") for item in mappings
                        if item.get("provenanceRecordId") == dependency_id
                    )
                for parent_id in record.get("lineage", {}).get("derivedFrom", []):
                    selected_assets.update(
                        item.get("assetId") for item in mappings
                        if item.get("provenanceRecordId") == parent_id
                    )
            changed = before != (selected_assets, composed_record_ids)

        selected_claim_ids = {
            row.get("claimId") for row in mappings
            if row.get("assetId") in selected_assets and row.get("claimId")
        }
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True,
            text=True, stdout=subprocess.PIPE,
        ).stdout.strip()
        for claim in claims["claims"]:
            if claim["id"] in selected_claim_ids:
                claim.update(reviewStatus="approved", reviewer="Controlled synthetic test reviewer", reviewDate="2026-10-10")
                claim["source"].update(revision=head, revisionKind="git_commit")
                if claim.get("state") in {"blocked", "planned", "assumed"}:
                    claim["state"] = "simulated"
        for context in claims["visualCopy"]["qualifierContexts"]:
            if selected_assets.intersection(context.get("relatedAssetIds", [])):
                context.update(
                    reviewStatus="approved", releaseDisposition="approved_for_selected_collateral",
                    reviewer="Controlled synthetic test reviewer", reviewDate="2026-10-10",
                )
        selected_records = {
            row.get("provenanceRecordId") for row in mappings
            if row.get("assetId") in selected_assets and row.get("provenanceRecordId")
        }
        selected_records.update(composed_record_ids)
        relevant_kinds = {"editable_visual_source", "synthetic_mockup_source", "visual_export", "accessible_text_alternative", "static_html_rehearsal_support"}
        queue = list(selected_records)
        while queue:
            record_id = queue.pop()
            record = records_by_id.get(record_id)
            if not record or record.get("kind") not in relevant_kinds:
                continue
            related_ids = (
                record.get("lineage", {}).get("derivedFrom", [])
                + record.get("lineage", {}).get("derivatives", [])
                + record.get("compositionDependencies", [])
            )
            for related_id in related_ids:
                if records_by_id.get(related_id, {}).get("kind") in relevant_kinds and related_id not in selected_records:
                    selected_records.add(related_id)
                    queue.append(related_id)
        for cta in claims["ctas"]:
            if not any(row.get("ctaId") == cta.get("id") and row.get("assetId") in selected_assets for row in mappings):
                continue
            cta.update(
                wordingReview="approved", reviewer="Controlled synthetic test reviewer", reviewDate="2026-10-10",
                routeReview="confirmed_static_repository_file_only", routeReviewer="Controlled route reviewer",
                routeReviewDate="2026-10-10", destinationClass="repository_accessible_text_alternative",
                target="demo/diagrams/demo-workflow-alt-text.md",
            )
            cta.setdefault("availability", {}).update(
                status="confirmed_local_repository_file_only",
                conditions="Controlled synthetic test destination points to an existing tracked text alternative.",
            )
        for record in provenance["records"]:
            if record["assetId"] in selected_records:
                record["publishability"] = "approved"
                record["permission"].update(status="approved", approvedDestinations=["controlled synthetic test destination"])
                record["allowedDestinations"] = ["controlled synthetic test destination"]
                record.update(reviewer="Controlled synthetic test reviewer", reviewDate="2026-10-10")
        return claims, provenance

    def _completed_controlled_submission_fixture(self):
        """Create in-memory approvals to exercise the full transition; no files are promoted."""
        claims, provenance = self._approved_synthetic_assets(DEFAULT_SUBMISSION_SELECTION)
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True,
            text=True, stdout=subprocess.PIPE,
        ).stdout.strip()
        claims_by_id = {row["id"]: row for row in claims["claims"]}
        for claim_id in REQUIRED_SUBMISSION_CLAIM_IDS:
            claim = claims_by_id[claim_id]
            claim.update(
                reviewStatus="approved", reviewer="Controlled synthetic test reviewer",
                reviewDate="2026-10-10", state="simulated",
            )
            claim["source"].update(revision=head, revisionKind="git_commit")
        evidence_by_id = {row["id"]: row for row in claims["evidenceClasses"]}
        for evidence_id in REQUIRED_SUBMISSION_EVIDENCE_CLASS_IDS:
            evidence_by_id[evidence_id]["status"] = "approved"
        inventory = copy.deepcopy(self.inventory)
        for gate in inventory["submissionScope"]["requiredOwnerGates"]:
            gate["status"] = "approved"
            gate["reviewer"] = "Controlled synthetic test reviewer"
            gate["reviewDate"] = "2026-10-10"
            gate["evidenceRef"] = "CONTROLLED-SYNTHETIC-TEST-ONLY"
        provenance["visualReview"].update(
            independentReview="passed", brandAndSourceOwnerRights="approved",
        )

        planned = {row["assetId"]: row for row in inventory["plannedDeliverables"]}
        tracked = {row["path"]: row for row in inventory["trackedFiles"]}
        provenance_by_id = {row["assetId"]: row for row in provenance["records"]}
        deck_record = copy.deepcopy(provenance_by_id["DEMO-DECK-SUPPORT-001"])
        for asset_id in REQUIRED_SUBMISSION_ASSET_IDS:
            row = planned[asset_id]
            if not (ROOT / row["path"]).is_file():
                # Test-only placeholder: all unavailable final assets use a tracked local file.
                row["path"] = "demo/deck/concept-overview.html"
                synthetic_record = copy.deepcopy(deck_record)
                synthetic_record.update(
                    assetId=asset_id,
                    kind="controlled_submission_test_artifact",
                    lineage={"derivedFrom": [], "derivatives": [], "transformations": ["In-memory controlled test fixture only."]},
                    reviewer="Controlled synthetic test reviewer",
                    reviewDate="2026-10-10",
                    publishability="approved",
                    blockers=[],
                )
                synthetic_record.pop("compositionDependencies", None)
                synthetic_record["permission"].update(
                    status="approved",
                    reference="In-memory controlled test fixture only; no real output or evidence is asserted.",
                    approvedDestinations=["controlled synthetic test destination"],
                    externalPublication="not granted",
                )
                synthetic_record["allowedDestinations"] = ["controlled synthetic test destination"]
                provenance["records"].append(synthetic_record)
                provenance_by_id[asset_id] = synthetic_record
            row["provenanceRecordIds"] = [asset_id]
            row["pathAvailability"] = "created_in_candidate"
            row["lifecycleState"] = "released"
            indexed = tracked[row["path"]]
            indexed.update(lifecycleState="released", releaseEligible=True)
        return claims, provenance, inventory

    def test_controlled_release_transition_passes_validate_all_then_submission_readiness(self):
        claims, provenance, inventory = self._completed_controlled_submission_fixture()
        self.assertEqual(
            validate_all(claims, provenance, copy.deepcopy(self.fixture), copy.deepcopy(self.handoff), inventory),
            [],
        )
        self.assertEqual(
            submission_blockers(claims, provenance, DEFAULT_SUBMISSION_SELECTION, inventory),
            [],
        )

    def test_required_submission_output_without_canonical_provenance_join_stays_blocked(self):
        claims, provenance, inventory = self._completed_controlled_submission_fixture()
        row = next(item for item in inventory["plannedDeliverables"] if item["assetId"] == "DEMO-SUBMISSION-VIDEO-001")
        row["provenanceRecordIds"] = []
        blockers = submission_blockers(claims, provenance, DEFAULT_SUBMISSION_SELECTION, inventory)
        self.assertTrue(any("DEMO-SUBMISSION-VIDEO-001: requires one canonical exact-output provenanceRecordIds entry" in item for item in blockers), blockers)

    def test_required_submission_output_checksum_must_match_exact_bytes(self):
        claims, provenance, inventory = self._completed_controlled_submission_fixture()
        record = next(row for row in provenance["records"] if row["assetId"] == "DEMO-SUBMISSION-VIDEO-001")
        record["checksum"]["value"] = "0" * 64
        blockers = submission_blockers(claims, provenance, DEFAULT_SUBMISSION_SELECTION, inventory)
        self.assertTrue(any("DEMO-SUBMISSION-VIDEO-001: required output/source provenance path or checksum is not exact" in item for item in blockers), blockers)

    def test_required_submission_output_provenance_must_match_canonical_asset_and_path(self):
        mutated = copy.deepcopy(self.inventory)
        row = next(item for item in mutated["plannedDeliverables"] if item["assetId"] == "LAUNCH-X-KEY-VISUAL-001")
        row["provenanceRecordIds"] = ["PROV-LAUNCH-X-KEY-PNG-001"]
        errors = validate_inventory_provenance(mutated, self.provenance)
        self.assertTrue(any("not the canonical output record" in item for item in errors), errors)
        self.assertTrue(any("source path does not match the planned output" in item for item in errors), errors)

    def test_selected_scope_allows_approved_synthetic_asset_without_global_guardrails(self):
        claims, provenance = self._approved_synthetic_selection("DEMO-SCREENSHOT-SET-001")
        self.assertEqual(selected_collateral_blockers(claims, provenance, ["DEMO-SCREENSHOT-SET-001"]), [])
        # The pending product transaction CTA and other unselected claims remain untouched.
        self.assertEqual(claims["status"], self.claims["status"])
        self.assertNotEqual(next(row for row in claims["ctas"] if row["id"] == "CTA-PRODUCT-TRANSACTION-001")["wordingReview"], "approved")

    def test_selected_scope_accepts_reviewed_local_text_alternative_cta(self):
        claims, provenance = self._approved_synthetic_selection("DEMO-DECK-SUPPORT-001")
        cta = next(row for row in claims["ctas"] if row["id"] == "CTA-WORKFLOW-TEXT-EQUIVALENT-001")
        cta.update(
            wordingReview="approved", reviewer="Controlled synthetic test reviewer", reviewDate="2026-10-10",
            routeReview="confirmed_static_repository_file_only", routeReviewer="Controlled route reviewer",
            routeReviewDate="2026-10-10",
        )
        cta["availability"].update(status="confirmed_local_repository_file_only", conditions="The exact tracked Markdown text alternative exists.")
        self.assertEqual(selected_collateral_blockers(claims, provenance, ["DEMO-DECK-SUPPORT-001"]), [])
        self.assertEqual(validate_visual_copy(claims, self.handoff, provenance), [])

    def test_selected_scope_rejects_empty_unknown_duplicate_and_unsafe_copy(self):
        self.assertTrue(selected_collateral_blockers(self.claims, self.provenance, []))
        self.assertTrue(selected_collateral_blockers(self.claims, self.provenance, ["NOT-AN-ASSET-001"]))
        self.assertTrue(selected_collateral_blockers(self.claims, self.provenance, ["DEMO-SCREENSHOT-SET-001"] * 2))
        claims, provenance = self._approved_synthetic_selection("DEMO-SCREENSHOT-SET-001")
        selected_claim = next(row for row in claims["claims"] if row["id"] in {
            item["claimId"] for item in claims["visualCopy"]["mappings"]
            if item.get("assetId") == "DEMO-SCREENSHOT-SET-001" and item.get("claimId")
        })
        selected_claim["allowedWording"] = "This is fully automated with verified savings."
        blockers = selected_collateral_blockers(claims, provenance, ["DEMO-SCREENSHOT-SET-001"])
        self.assertTrue(any("unsupported positive wording" in item for item in blockers), blockers)

    def test_submission_requires_explicit_assets_and_producer_gates(self):
        claims, provenance = self._approved_synthetic_selection("DEMO-SCREENSHOT-SET-001")
        blockers = submission_blockers(claims, provenance, ["DEMO-SCREENSHOT-SET-001"], copy.deepcopy(self.inventory))
        self.assertTrue(any("DEMO-SUBMISSION-VIDEO-001" in item for item in blockers), blockers)
        self.assertTrue(any("CLAIM-PRODUCT-CAPABILITY-001" in item for item in blockers), blockers)
        self.assertTrue(any("EVAL-03" in item for item in blockers), blockers)
        self.assertTrue(any("BRAND-CONSUMPTION-001" in item for item in blockers), blockers)
        self.assertTrue(any("ORGANIZER-RULES-AND-CUTOFF-001" in item for item in blockers), blockers)
        self.assertFalse(any("CTA-PRODUCT-TRANSACTION-001" in item for item in blockers), blockers)

    def test_submission_scope_cannot_drop_canonical_asset_claim_or_evidence_requirements(self):
        mutated = copy.deepcopy(self.inventory)
        scope = mutated["submissionScope"]
        scope["requiredAssetIds"] = ["LAUNCH-X-KEY-VISUAL-001"]
        scope["requiredClaimIds"] = ["CLAIM-POSITIONING-001"]
        scope["requiredEvidenceClassIds"] = ["EVAL-03"]
        errors = validate_inventory(mutated)
        self.assertTrue(any("submissionScope.requiredAssetIds omits immutable required IDs" in item for item in errors), errors)
        self.assertTrue(any("CLAIM-SPN-01-NEATLOGS-001" in item for item in errors), errors)
        self.assertTrue(any("SPN-01" in item for item in errors), errors)

        blockers = submission_blockers(
            self.claims, self.provenance, DEFAULT_SUBMISSION_SELECTION, mutated,
        )
        self.assertTrue(any("required submission claim CLAIM-SPN-01-NEATLOGS-001" in item for item in blockers), blockers)
        self.assertTrue(any("required submission evidence SPN-01" in item for item in blockers), blockers)
        self.assertTrue(any("DEMO-SUBMISSION-VIDEO-001" in item for item in blockers), blockers)

    def test_inventory_released_state_allows_eligibility_but_draft_cannot(self):
        released = copy.deepcopy(self.inventory)
        released_row = next(row for row in released["trackedFiles"] if row["path"] == "demo/deck/concept-overview.html")
        released_row.update(lifecycleState="released", releaseEligible=True)
        self.assertEqual(validate_inventory(released), [])

        invalid_draft = copy.deepcopy(self.inventory)
        draft_row = next(row for row in invalid_draft["trackedFiles"] if row["path"] == "demo/deck/concept-overview.html")
        draft_row["releaseEligible"] = True
        errors = validate_inventory(invalid_draft)
        self.assertTrue(any("lifecycleState draft requires releaseEligible=false" in item for item in errors), errors)

    def test_selected_deck_includes_embedded_source_claim_rights_and_alt_text(self):
        claims, provenance = self._approved_synthetic_selection("DEMO-DECK-SUPPORT-001")
        self.assertEqual(
            selected_collateral_blockers(claims, provenance, ["DEMO-DECK-SUPPORT-001"]),
            [],
        )

        pending_source = copy.deepcopy(provenance)
        diagram = next(row for row in pending_source["records"] if row["assetId"] == "DEMO-WORKFLOW-DIAGRAM-001")
        diagram["permission"].update(status="unknown", approvedDestinations=[])
        diagram.update(publishability="blocked")
        blockers = selected_collateral_blockers(claims, pending_source, ["DEMO-DECK-SUPPORT-001"])
        self.assertTrue(any("DEMO-WORKFLOW-DIAGRAM-001: selected destination rights" in item for item in blockers), blockers)

        pending_alt_claims = copy.deepcopy(claims)
        alt_claim = next(row for row in pending_alt_claims["claims"] if row["id"] == "CLAIM-VISUAL-COPY-053")
        alt_claim["reviewStatus"] = "pending"
        blockers = selected_collateral_blockers(pending_alt_claims, provenance, ["DEMO-DECK-SUPPORT-001"])
        self.assertTrue(any("CLAIM-VISUAL-COPY-053: selected exact-copy review is not approved" in item for item in blockers), blockers)

        pending_alt_rights = copy.deepcopy(provenance)
        alt = next(row for row in pending_alt_rights["records"] if row["assetId"] == "PROV-DEMO-WORKFLOW-ALT-001")
        alt["permission"].update(status="unknown", approvedDestinations=[])
        alt.update(publishability="blocked")
        blockers = selected_collateral_blockers(claims, pending_alt_rights, ["DEMO-DECK-SUPPORT-001"])
        self.assertTrue(any("PROV-DEMO-WORKFLOW-ALT-001: selected destination rights" in item for item in blockers), blockers)

    def test_html_composition_dependencies_match_sources_and_remain_acyclic(self):
        self.assertEqual(validate_provenance_composition(self.provenance), [])
        self.assertEqual(validate_provenance_lineage(self.provenance), [])

        missing_source = copy.deepcopy(self.provenance)
        deck = next(row for row in missing_source["records"] if row["assetId"] == "DEMO-DECK-SUPPORT-001")
        deck["compositionDependencies"].remove("DEMO-WORKFLOW-DIAGRAM-001")
        errors = validate_provenance_composition(missing_source)
        self.assertTrue(any("omits consumed HTML source DEMO-WORKFLOW-DIAGRAM-001" in item for item in errors), errors)

        cycle = copy.deepcopy(self.provenance)
        diagram = next(row for row in cycle["records"] if row["assetId"] == "DEMO-WORKFLOW-DIAGRAM-001")
        diagram["compositionDependencies"] = ["DEMO-DECK-SUPPORT-001"]
        errors = validate_provenance_composition(cycle)
        self.assertTrue(any("composition graph contains a cycle" in item for item in errors), errors)

        disguised = copy.deepcopy(self.provenance)
        deck = next(row for row in disguised["records"] if row["assetId"] == "DEMO-DECK-SUPPORT-001")
        deck["kind"] = "generic_source"
        deck.pop("compositionDependencies")
        disguised_inventory = copy.deepcopy(self.inventory)
        inventory_deck = next(row for row in disguised_inventory["plannedDeliverables"] if row["assetId"] == "DEMO-DECK-SUPPORT-001")
        inventory_deck.pop("compositionDependencies")
        errors = validate_all(
            copy.deepcopy(self.claims), disguised, copy.deepcopy(self.fixture),
            copy.deepcopy(self.handoff), disguised_inventory,
        )
        self.assertTrue(any("canonical HTML composition must retain static_html_rehearsal_support kind" in item for item in errors), errors)

    def test_reviewed_local_text_alternative_cta_can_transition_to_approved(self):
        mutated = copy.deepcopy(self.claims)
        cta = next(row for row in mutated["ctas"] if row["id"] == "CTA-WORKFLOW-TEXT-EQUIVALENT-001")
        cta.update(
            wordingReview="approved", reviewer="Assigned marketing reviewer", reviewDate="2026-10-10",
            routeReview="confirmed_static_repository_file_only", routeReviewer="Repository route reviewer",
            routeReviewDate="2026-10-10",
        )
        cta["availability"].update(status="confirmed_local_repository_file_only", conditions="The tracked Markdown alternative exists at the exact target.")
        errors = validate_claims(mutated)
        self.assertFalse(any("CTA-WORKFLOW-TEXT-EQUIVALENT-001" in item for item in errors), errors)

    def test_visual_copy_drift_and_checksum_drift_are_rejected(self):
        mutated = copy.deepcopy(self.claims)
        mapping = mutated["visualCopy"]["mappings"][0]
        mapping["exactText"] = "Changed copy that is not in the pinned source"
        errors = validate_visual_copy(mutated, self.handoff, self.provenance)
        self.assertTrue(any("copy source checksum drift" in item or "differs from" in item or "absent or drifted" in item for item in errors), errors)

        mutated = copy.deepcopy(self.provenance)
        record = next(row for row in mutated["records"] if row["assetId"] == "DEMO-WORKFLOW-DIAGRAM-001")
        record["checksum"]["value"] = "0" * 64
        errors = validate_provenance(mutated)
        self.assertTrue(any("checksum does not match exact source file" in item for item in errors), errors)

    def test_inventory_rejects_unlisted_tracked_file(self):
        mutated = copy.deepcopy(self.inventory)
        mutated["trackedFiles"].pop()
        errors = validate_inventory(mutated)
        self.assertTrue(any("unlisted tracked collateral/supporting file" in item for item in errors), errors)

    def test_inventory_requires_explicit_submission_scope_gates(self):
        mutated = copy.deepcopy(self.inventory)
        mutated["submissionScope"]["requiredOwnerGates"] = [
            gate for gate in mutated["submissionScope"]["requiredOwnerGates"]
            if gate.get("id") != "ORGANIZER-RULES-AND-CUTOFF-001"
        ]
        errors = validate_inventory(mutated)
        self.assertTrue(any("explicit brand and organizer owner gates" in item for item in errors), errors)

    def test_nonapproved_visual_release_stays_blocked(self):
        mutated = copy.deepcopy(self.provenance)
        mutated["status"] = "approved"
        blockers = release_blockers(self.claims, mutated)
        self.assertTrue(any("independent visual/content/accessibility review is pending" in item for item in blockers), blockers)
        self.assertTrue(any("selected destination rights/publishability are not approved" in item for item in blockers), blockers)


if __name__ == "__main__":
    unittest.main()
