"""Meaningful handoff checks for rehearsal timing, copy, and blockers."""

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class NarrativeHandoffTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scenes = json.loads((ROOT / "demo/rehearsal-scenes.json").read_text())
        cls.claim_data = json.loads((ROOT / "messaging/claims.json").read_text())
        cls.inventory = json.loads((ROOT / "docs/collateral-inventory.json").read_text())
        cls.official_formats = json.loads(
            (ROOT / "review/official-format-sources.json").read_text()
        )
        cls.claims = {row["id"]: row for row in cls.claim_data["claims"]}
        cls.ctas = {row["id"]: row for row in cls.claim_data["ctas"]}
        cls.deliverables = {
            row["assetId"]: row for row in cls.inventory["plannedDeliverables"]
        }
        cls.proposals = {
            row["id"]: row for row in cls.scenes["ledgerJoinProposals"]
        }

    def test_scenes_are_contiguous_and_within_official_duration(self):
        scenes = self.scenes["scenes"]
        self.assertEqual(len(scenes), 10)
        self.assertEqual(len({scene["sceneId"] for scene in scenes}), len(scenes))

        cursor = 0
        for scene in scenes:
            self.assertEqual(scene["startSeconds"], cursor, scene["sceneId"])
            self.assertEqual(
                scene["endSeconds"] - scene["startSeconds"],
                scene["durationSeconds"],
                scene["sceneId"],
            )
            cursor = scene["endSeconds"]

        render = self.scenes["render"]
        self.assertEqual(cursor, render["plannedDurationSeconds"])
        self.assertGreaterEqual(cursor, render["targetSeconds"]["minimum"])
        self.assertLessEqual(cursor, render["targetSeconds"]["maximum"])
        self.assertLessEqual(cursor, render["rehearsalMaximumSeconds"])
        self.assertEqual(cursor, 150)
        self.assertIn("not specified", render["officialVideoAspectRatio"])
        self.assertIn("not specified", render["officialVideoFileSizeLimit"])

    def test_scene_assets_and_source_pins_resolve(self):
        source_pins = {pin["id"]: pin for pin in self.scenes["sourcePins"]}
        for scene in self.scenes["scenes"]:
            self.assertIn(scene["assetId"], self.deliverables, scene["sceneId"])
            asset_path = ROOT / scene["assetPath"]
            self.assertTrue(asset_path.exists(), f"Missing {scene['assetPath']}")
            self.assertTrue(scene["fallback"].strip())
            self.assertTrue(scene["reviewer"].strip())

            for pin_id in scene["sourcePinIds"]:
                self.assertIn(pin_id, source_pins, scene["sceneId"])
                pin = source_pins[pin_id]
                if pin["repo"] == "Jevelopers-neatHack-2026/marketing-material":
                    self.assertTrue((ROOT / pin["path"]).is_file(), pin["path"])
                else:
                    self.assertTrue(pin["url"].startswith("https://"), pin_id)
                    if pin.get("evidenceClass") in {
                        "official_event_requirements",
                        "official_destination_constraint",
                    }:
                        self.assertEqual(pin.get("checkedAt"), "2026-10-11 UTC")

    def test_claim_copy_is_exact_or_explicitly_proposed(self):
        for scene in self.scenes["scenes"]:
            self.assertEqual(scene["captionText"], scene["narration"])
            segment_text = " ".join(
                segment["text"] for segment in scene["copySegments"]
            )
            self.assertEqual(segment_text, scene["captionText"], scene["sceneId"])

            referenced_claims = set(scene["claimIDs"])
            referenced_proposals = set(scene.get("proposalIDs", []))
            referenced_ctas = set(scene.get("ctaIDs", []))

            for segment in scene["copySegments"]:
                if segment["kind"] in {"claim_wording", "claim_qualifier"}:
                    refs = [segment["claimId"], *segment.get("alsoClaimIds", [])]
                    for claim_id in refs:
                        self.assertIn(claim_id, self.claims)
                        row = self.claims[claim_id]
                        source_wording = segment.get("sourceWording", segment["text"])
                        self.assertTrue(
                            source_wording == row["allowedWording"]
                            or segment["text"] == row.get("requiredQualifier"),
                            f"{scene['sceneId']} uses copy outside {claim_id}",
                        )
                        referenced_claims.add(claim_id)
                elif segment["kind"] == "proposed_wording":
                    proposal_id = segment["proposalId"]
                    self.assertIn(proposal_id, self.proposals)
                    self.assertIn(segment["text"], self.proposals[proposal_id]["exactWording"])
                    referenced_proposals.add(proposal_id)
                elif segment["kind"] == "cta_wording":
                    cta_id = segment["ctaId"]
                    self.assertIn(cta_id, self.ctas)
                    self.assertEqual(segment["text"], self.ctas[cta_id]["exactText"])
                    referenced_ctas.add(cta_id)
                else:
                    self.fail(f"Unclassified copy segment: {segment['kind']}")

            self.assertEqual(referenced_claims, set(scene["claimIDs"]))
            self.assertEqual(referenced_proposals, set(scene.get("proposalIDs", [])))
            self.assertEqual(referenced_ctas, set(scene.get("ctaIDs", [])))

        transcript = (ROOT / "demo/rehearsal-transcript.md").read_text()
        transcript_captions = re.findall(r"^\*\*Caption:\*\* (.*)$", transcript, re.M)
        self.assertEqual(
            transcript_captions,
            [scene["captionText"] for scene in self.scenes["scenes"]],
        )

    def test_each_sponsor_has_five_separately_pending_facets(self):
        required = {"architecture", "implementation", "runtime", "reasoning", "result"}
        sponsor_scenes = [scene for scene in self.scenes["scenes"] if "sponsor" in scene]
        self.assertEqual(
            {scene["sponsor"] for scene in sponsor_scenes},
            {"Neatlogs", "Entire", "CFO.ai"},
        )

        for scene in sponsor_scenes:
            self.assertEqual(
                {facet["aspect"] for facet in scene["sponsorFacets"]}, required
            )
            self.assertTrue(
                all(facet["status"] == "pending" for facet in scene["sponsorFacets"])
            )
            self.assertEqual(scene["evidenceClass"], "pending")
            self.assertEqual(scene["providerMode"], "not_run")
            self.assertIn(scene["sponsorEvidenceClass"], {"SPN-01", "SPN-02", "SPN-03"})

    def test_pending_external_fields_cannot_be_submission_ready(self):
        gate = self.scenes["submissionGate"]
        self.assertEqual(gate["readiness"], "BLOCKED")
        self.assertFalse(gate["rehearsalSatisfiesFinalDemoRequirement"])
        self.assertTrue(gate["blockers"])
        self.assertGreaterEqual(len(gate["requiredExternalFields"]), 8)
        for field, record in gate["requiredExternalFields"].items():
            self.assertIsNone(record["value"], field)
            self.assertIn("pending", record["status"], field)

    def test_x_copy_shells_fit_the_recorded_standard_post_limit(self):
        copy = (ROOT / "launch/announcement-copy.md").read_text()
        text_blocks = re.findall(r"```text\n(.*?)\n```", copy, re.S)
        self.assertEqual(len(text_blocks), 2)
        quote_template, build_update_template = text_blocks
        self.assertLessEqual(len(quote_template), 280)
        self.assertLessEqual(len(build_update_template), 280)
        self.assertIn("[TEAM_NAME_PENDING]", quote_template)
        self.assertIn("[SUBMITTER_NAME_PENDING]", quote_template)
        self.assertIn("[PROJECT_NAME_PENDING]", quote_template)
        self.assertIn("[PUBLIC_PROJECT_REPOSITORY_URL_PENDING]", quote_template)
        self.assertIn("[PUBLIC_DEMO_URL_PENDING]", quote_template)
        self.assertIn("#neatHack", quote_template)
        self.assertIn("DATED, SOURCE-LINKED ACTIVITY", build_update_template)
        self.assertIn("#neatHack", build_update_template)
        self.assertIn("OFFICIAL NEATLOGS SUBMISSION POST", copy)
        self.assertIn("CTA-REPOSITORY-DOCS-001", copy)
        self.assertIn(self.ctas["CTA-REPOSITORY-DOCS-001"]["exactText"], copy)

    def test_official_formats_keep_video_unknowns_and_submission_blockers_explicit(self):
        sources = {row["sourceId"]: row for row in self.official_formats["sources"]}
        organizer = sources["OFFICIAL-NEATHACK-2026"]["observedRequirements"]
        self.assertEqual(organizer["videoMaximumSeconds"], 180)
        self.assertEqual(
            set(organizer["perSponsorVideoFacets"]),
            {"architecture", "implementation", "runtime", "reasoning", "result"},
        )
        self.assertIsNone(organizer["videoAspectRatio"]["value"])
        self.assertIsNone(organizer["videoFileSizeLimit"]["value"])
        self.assertIsNone(organizer["officialQuotePost"]["url"])
        self.assertIsNone(organizer["confirmedFinalCutoff"]["value"])

        post = sources["OFFICIAL-X-POST-2026"]["observedRequirements"]
        self.assertEqual(post["ordinaryPostMaximumCharacters"], 280)
        image = sources["OFFICIAL-X-IMAGE-2026"]["observedRequirements"]
        self.assertEqual(
            image["singleImageStandardAspectRatiosDisplayedInFull"],
            {"wideLimit": "2:1", "tallLimit": "3:4"},
        )
        self.assertEqual(image["localDraftDimensions"]["status"], "local_choice_not_platform_requirement")


if __name__ == "__main__":
    unittest.main()
