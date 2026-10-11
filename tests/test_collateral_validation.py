import copy
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.validate_collateral import (  # noqa: E402
    release_blockers,
    validate_all,
    validate_claims,
    validate_fixture,
    validate_inventory,
    validate_provenance,
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
        self.assertTrue(any("CTA-PRODUCT-TRANSACTION-001" in item for item in blockers))
        self.assertTrue(any("destination-specific rights" in item for item in blockers))
        self.assertTrue(any("independent visual" in item for item in blockers))
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

    def test_nonapproved_visual_release_stays_blocked(self):
        mutated = copy.deepcopy(self.provenance)
        mutated["status"] = "approved"
        blockers = release_blockers(self.claims, mutated)
        self.assertTrue(any("independent visual/content/accessibility review is pending" in item for item in blockers), blockers)
        self.assertTrue(any("destination-specific rights approval is pending" in item for item in blockers), blockers)


if __name__ == "__main__":
    unittest.main()
