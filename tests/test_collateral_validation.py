import copy
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.validate_collateral import (  # noqa: E402
    release_blockers,
    selected_collateral_blockers,
    submission_blockers,
    validate_all,
    validate_claims,
    validate_fixture,
    validate_inventory,
    validate_provenance,
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
        claims = copy.deepcopy(self.claims)
        provenance = copy.deepcopy(self.provenance)
        selected_claim_ids = {
            row.get("claimId") for row in claims["visualCopy"]["mappings"]
            if row.get("assetId") == asset_id and row.get("claimId")
        }
        for claim in claims["claims"]:
            if claim["id"] in selected_claim_ids:
                claim.update(reviewStatus="approved", reviewer="Controlled synthetic test reviewer", reviewDate="2026-10-10")
        for context in claims["visualCopy"]["qualifierContexts"]:
            if asset_id in context.get("relatedAssetIds", []):
                context.update(
                    reviewStatus="approved", releaseDisposition="approved_for_selected_collateral",
                    reviewer="Controlled synthetic test reviewer", reviewDate="2026-10-10",
                )
        selected_records = {
            row.get("provenanceRecordId") for row in claims["visualCopy"]["mappings"]
            if row.get("assetId") == asset_id and row.get("provenanceRecordId")
        }
        records_by_id = {row["assetId"]: row for row in provenance["records"]}
        relevant_kinds = {"editable_visual_source", "synthetic_mockup_source", "visual_export", "accessible_text_alternative", "static_html_rehearsal_support"}
        queue = list(selected_records)
        while queue:
            record_id = queue.pop()
            record = records_by_id.get(record_id)
            if not record or record.get("kind") not in relevant_kinds:
                continue
            for related_id in record.get("lineage", {}).get("derivedFrom", []) + record.get("lineage", {}).get("derivatives", []):
                if records_by_id.get(related_id, {}).get("kind") in relevant_kinds and related_id not in selected_records:
                    selected_records.add(related_id)
                    queue.append(related_id)
        for record in provenance["records"]:
            if record["assetId"] in selected_records:
                record["publishability"] = "approved"
                record["permission"].update(status="approved", approvedDestinations=["controlled synthetic test destination"])
                record["allowedDestinations"] = ["controlled synthetic test destination"]
                record.update(reviewer="Controlled synthetic test reviewer", reviewDate="2026-10-10")
        return claims, provenance

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
