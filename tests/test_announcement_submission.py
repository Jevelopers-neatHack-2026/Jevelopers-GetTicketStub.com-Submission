"""Offline checks of the actual announcement draft; not submission evidence.

Reuse the repository's bounded X estimator. These documentation checks do not
validate a live composer, media, permissions, a form, or a completed submission.
Run with: python3 -m unittest discover -s tests -p 'test_announcement_submission.py' -v
"""

import re
import unittest
from pathlib import Path

from test_narrative_handoff import (
    PLAN_URL,
    X_DEST_CLAIM_IDS,
    X_MAX_WEIGHTED,
    XEstimateOutOfScope,
    x_weighted_length,
)

ROOT = Path(__file__).resolve().parents[1]
HANDLES = ("@neatlogs", "@EntireHQ", "@arithecfo")
DEMO_URL = "https://demo.example.org/ticketstub"
HANDOFF_HEADING = "### Human-only completion handoff"


def copy_blocks(document):
    blocks = re.findall(r"```text\n(.*?)\n```", document, re.S)
    if len(blocks) != 2:
        raise ValueError("Expected exactly the quote-post and build-update blocks")
    return blocks


def handle_errors(quote):
    # Count standalone handles, not prose elsewhere, URLs or similar handles.
    tokens = re.findall(r"(?<!\S)@[A-Za-z0-9_]+(?=\s|$)", quote)
    return [handle for handle in HANDLES if tokens.count(handle) != 1]


def handoff_errors(document):
    """Check this internal procedure's explicit, separately testable safeguards."""
    match = re.search(
        re.escape(HANDOFF_HEADING) + r"\n(.*?)(?=\n### |\n## |\Z)",
        document,
        re.S,
    )
    if not match:
        return ["missing_handoff"]
    section = match.group(1)
    required = {
        "both_steps": "Both steps are required.",
        "post_step": "1. The authorized human X submitter",
        "video_attachment": "attach the final approved demo video",
        "form_step": "2. The authorized human team leader",
        "form_locator": "https://neatlogs.com/submission",
        "draft_not_submission": "A saved draft is not a completed submission.",
        "post_receipt": "| Posted entry URL | PENDING |",
        "form_receipt": "| Final form acknowledgement | PENDING |",
        "leader_pending": "| Submission-form leader | PENDING |",
        "submitter_pending": "| X submitter and authorization | PENDING |",
        "receipt_redaction": "redacted confirmation reference and timestamp",
        "receipts_after_take": "collected after the take",
        "no_agent_actions": "No agent posts, uploads, or submits.",
        "capture_cancelled": "CANCELLED_USER_REQUEST_NO_RESTART",
    }
    return [key for key, text in required.items() if text not in section]


class AnnouncementSubmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = (ROOT / "launch/announcement-copy.md").read_text(
            encoding="utf-8"
        )
        cls.quote, cls.update = copy_blocks(cls.document)

    def test_actual_quote_contains_each_required_sponsor_handle_once(self):
        self.assertEqual(handle_errors(self.quote), [])

    def test_actual_copy_keeps_separate_human_steps_and_pending_receipts(self):
        self.assertEqual(handoff_errors(self.document), [])

    def test_actual_copy_keeps_known_fields_qualifiers_and_pending_approvals(self):
        for text in (
            "Team: Jevelopers",
            "Project: TicketStub",
            "Repository: https://github.com/Jevelopers-neatHack-2026/getticketstub.com",
            f"Business plan: {PLAN_URL}",
            "[SUBMITTER_NAME_PENDING]",
            "[PUBLIC_DEMO_URL_PENDING]",
            "#neatHack",
        ):
            self.assertIn(text, self.quote)
        for text in (*X_DEST_CLAIM_IDS, "CFO-R2-001", "not Finance approval",
                     "Project name only; product availability is unverified.",
                     "**Status:** draft only.", "review pending; not approved"):
            self.assertIn(text, self.document)

    def test_actual_copy_has_current_source_and_human_composer_boundary(self):
        self.assertIn("rechecked **2026-10-12 UTC**", self.document)
        self.assertIn("https://neatlogs.com/hackathon", self.document)
        self.assertIn("**Human composer check: pending.**", self.document)
        self.assertIn("all three sponsor handles", self.document)
        self.assertIn("not evidence of sponsor usage or endorsement", self.document)
        self.assertNotIn("not yet published or supplied", self.document)

    def test_launch_locator_is_available_but_human_verification_is_pending(self):
        locator = "https://x.com/bettersayAJ/status/2109639214723932495"
        for path in ("launch/announcement-copy.md", "launch/deliverable-briefs.md"):
            document = (ROOT / path).read_text(encoding="utf-8")
            with self.subTest(path=path):
                self.assertIn(locator, document)
                self.assertIn("403", document)
                self.assertIn("Discord", document)
                self.assertIn("13:30", document)
                self.assertIn("18:25", document)
        self.assertNotIn(locator, self.quote)
        self.assertIn("Only the public first-step page was read here", self.document)
        self.assertIn("no interactive form flow, email verification, draft save or submission", self.document)
        self.assertIn("not verified here", self.document)

    def test_companion_brief_counts_the_same_body_and_retains_both_steps(self):
        brief = (ROOT / "launch/deliverable-briefs.md").read_text(encoding="utf-8")
        stand_in = self.quote.replace("[PUBLIC_DEMO_URL_PENDING]", DEMO_URL)
        used = x_weighted_length(stand_in.replace("[SUBMITTER_NAME_PENDING]", ""))
        self.assertIn(f"{x_weighted_length(stand_in)} weighted ({len(stand_in)} raw)", brief)
        self.assertIn(f"{X_MAX_WEIGHTED - used} weighted characters remain", brief)
        for value in (*HANDLES, "https://neatlogs.com/submission", "team leader",
                      "Submit project", "Continue", "CFO-R2-001", "draft"):
            self.assertIn(value, brief)

    def test_recorded_count_table_matches_actual_copy_including_tags(self):
        stand_in = self.quote.replace("[PUBLIC_DEMO_URL_PENDING]", DEMO_URL)
        variants = (
            ("Template as shown (name and demo left as brackets)", self.quote),
            ("Name left as `[SUBMITTER_NAME_PENDING]`; stand-in demo URL", stand_in),
            ("Empty name; stand-in demo URL",
             stand_in.replace("[SUBMITTER_NAME_PENDING]", "")),
            ("Name `Sam Lee`; stand-in demo URL",
             stand_in.replace("[SUBMITTER_NAME_PENDING]", "Sam Lee")),
            ("Name `Alexandria Montgomery-Featherstonehaugh`; stand-in demo URL",
             stand_in.replace("[SUBMITTER_NAME_PENDING]",
                              "Alexandria Montgomery-Featherstonehaugh")),
            ("Build-in-public shell (section B)", self.update),
        )
        for label, text in variants:
            with self.subTest(variant=label):
                expected = f"| {label} | {len(text)} | {x_weighted_length(text)} |"
                self.assertIn(expected, self.document)
                self.assertLessEqual(x_weighted_length(text), X_MAX_WEIGHTED)

    def test_recorded_name_budget_and_one_character_overflow(self):
        base = self.quote.replace("[PUBLIC_DEMO_URL_PENDING]", DEMO_URL).replace(
            "[SUBMITTER_NAME_PENDING]", ""
        )
        used = x_weighted_length(base)
        budget = X_MAX_WEIGHTED - used
        self.assertGreater(budget, 0)
        self.assertIn(f"{budget} weighted characters remain", self.document)
        self.assertIn(f"280 minus {used}", self.document)
        with_name = self.quote.replace("[PUBLIC_DEMO_URL_PENDING]", DEMO_URL)
        for extra, expected in ((0, 280), (1, 281)):
            text = with_name.replace("[SUBMITTER_NAME_PENDING]", "n" * (budget + extra))
            self.assertEqual(x_weighted_length(text), expected)
            self.assertEqual(handle_errors(text), [])

    def test_reusable_update_is_unchanged_and_not_a_submission(self):
        self.assertEqual(
            self.update,
            "Build-in-public update: [DATED, SOURCE-LINKED ACTIVITY THAT ACTUALLY "
            "OCCURRED]. Explore the repository docs. #neatHack",
        )
        self.assertIn("documentation CTA only", self.document)
        self.assertIn("human step", self.document)

    def test_negative_each_missing_handle_is_detected_in_copy_block(self):
        fixture = "Synthetic test fixture " + " ".join(HANDLES)
        self.assertEqual(handle_errors(fixture), [])
        for handle in HANDLES:
            with self.subTest(handle=handle):
                self.assertEqual(handle_errors(fixture.replace(handle, "")), [handle])

    def test_negative_similar_duplicate_and_url_handles_do_not_pass(self):
        fixture = "Synthetic test fixture " + " ".join(HANDLES)
        self.assertEqual(handle_errors(fixture), [])
        for handle in HANDLES:
            for replacement in (handle + "x", handle + " " + handle,
                                "https://example.org/" + handle):
                with self.subTest(handle=handle, replacement=replacement):
                    self.assertEqual(
                        handle_errors(fixture.replace(handle, replacement)), [handle]
                    )

    def test_negative_missing_or_extra_copy_blocks_are_rejected(self):
        for document in ("", "```text\none\n```", self.document + "\n```text\nextra\n```"):
            with self.subTest(document=document[:40]):
                with self.assertRaises(ValueError):
                    copy_blocks(document)

    def test_negative_quote_only_missing_leader_or_receipt_is_detected(self):
        # This is synthetic documentation, not a real permission or submission.
        fixture = (
            HANDOFF_HEADING + "\nBoth steps are required.\n"
            "1. The authorized human X submitter must attach the final approved demo video.\n"
            "2. The authorized human team leader uses https://neatlogs.com/submission.\n"
            "A saved draft is not a completed submission.\n"
            "| Posted entry URL | PENDING |\n| Final form acknowledgement | PENDING |\n"
            "| Submission-form leader | PENDING |\n| X submitter and authorization | PENDING |\n"
            "Use a redacted confirmation reference and timestamp, collected after the take.\n"
            "No agent posts, uploads, or submits. CANCELLED_USER_REQUEST_NO_RESTART\n"
        )
        self.assertEqual(handoff_errors(fixture), [])
        mutations = {
            "form_step": "2. The authorized human team leader",
            "form_locator": "https://neatlogs.com/submission",
            "form_receipt": "| Final form acknowledgement | PENDING |",
            "post_receipt": "| Posted entry URL | PENDING |",
            "leader_pending": "| Submission-form leader | PENDING |",
            "draft_not_submission": "A saved draft is not a completed submission.",
            "video_attachment": "attach the final approved demo video",
            "receipt_redaction": "redacted confirmation reference and timestamp",
            "capture_cancelled": "CANCELLED_USER_REQUEST_NO_RESTART",
        }
        for key, text in mutations.items():
            with self.subTest(missing=key):
                self.assertEqual(handoff_errors(fixture.replace(text, "")), [key])

    def test_negative_handoff_safeguards_elsewhere_do_not_fill_a_missing_section(self):
        self.assertEqual(handoff_errors("Both steps are required.\n"), ["missing_handoff"])
        self.assertEqual(
            handoff_errors("## Other procedure\n" + HANDOFF_HEADING.replace("Human", "Agent")),
            ["missing_handoff"],
        )

    def test_estimator_limits_remain_fail_closed_for_unsupported_inputs(self):
        for value in ("http://example.org/demo", "\U0001F600", "中"):
            with self.subTest(value=value):
                with self.assertRaises(XEstimateOutOfScope):
                    x_weighted_length(value)
        self.assertEqual(x_weighted_length("a" * 280), 280)
        self.assertGreater(x_weighted_length("a" * 281), X_MAX_WEIGHTED)
        self.assertEqual(x_weighted_length("https://example.org/" + "a" * 400), 23)


if __name__ == "__main__":
    unittest.main()
