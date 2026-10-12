from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class PublicIssueSurfaceTests(unittest.TestCase):
    def test_blank_issues_are_disabled_while_private_reporting_is_blocked(self) -> None:
        chooser = (ROOT / ".github/ISSUE_TEMPLATE/config.yml").read_text(encoding="utf-8")
        pending_policy = (ROOT / "community/SECURITY.pending.md").read_text(encoding="utf-8")
        active_forms = [
            path
            for path in (ROOT / ".github/ISSUE_TEMPLATE").glob("*.yml")
            if path.name != "config.yml"
        ]

        self.assertRegex(chooser, r"(?m)^blank_issues_enabled:\s*false\s*$")
        self.assertRegex(pending_policy, r"(?m)^\*\*Status: blocked\.\*\*")
        self.assertTrue(active_forms)
        self.assertFalse(any("security" in path.name.lower() for path in active_forms))
        for form in active_forms:
            with self.subTest(form=form.name):
                self.assertIn("Do not paste secrets", form.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
