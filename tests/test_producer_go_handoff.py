"""Offline guards for the producer's dated 6daafba handoff, not runtime proof."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
DOCS = ('demo/human-recording-runbook.md', 'demo/recording-checklist.md',
        'docs/collateral-handoff.md')
HEADING = 'Current producer GO — 6daafba'
RECEIPT = 'issuecomment-6129152479'


def current_go(text):
    match = re.search(r'(?ms)^## ' + re.escape(HEADING)
                      + r'\s*\n(.*?)(?=^## |\Z)', text)
    return match.group(1) if match else ''


def missing_scope(text):
    required = (RECEIPT, '2026-10-12T17:21:38Z', 'producer reported',
                '6daafba', 'Do not wait for #104 or #112',
                'not a completed recording', 'CANCELLED_USER_REQUEST_NO_RESTART')
    return [value for value in required if value.lower() not in text.lower()]


class ProducerGoHandoffTests(unittest.TestCase):
    def test_each_current_guide_records_the_actual_dated_producer_go(self):
        for name in DOCS:
            with self.subTest(document=name):
                body = current_go((ROOT / name).read_text(encoding='utf-8'))
                self.assertEqual([], missing_scope(body))

    def test_removed_go_receipt_cannot_pass_on_earlier_fallback_links(self):
        for name in DOCS:
            with self.subTest(document=name):
                body = current_go((ROOT / name).read_text(encoding='utf-8'))
                self.assertIn(RECEIPT, missing_scope(body.replace(RECEIPT, 'earlier-fallback')))

    def test_current_runbook_preserves_the_two_turn_workaround_and_limit(self):
        body = current_go((ROOT / DOCS[0]).read_text(encoding='utf-8'))
        self.assertIn('two separate turns', body)
        self.assertIn('17 OCT', body)
        self.assertIn('Generate art only once', body)
        self.assertLess(body.index('17 OCT'), body.index('Generate art only once'))
        self.assertIn('#100', body)
        self.assertIn('no new provider authorization', body)

    def test_selected_take_collects_session_evidence_after_human_execution(self):
        body = current_go((ROOT / DOCS[0]).read_text(encoding='utf-8'))
        for value in ('analytics consent', 'Tear off', 'Download', 'Neatlogs',
                      'Entire', 'CFO.ai', 'session timestamp', '180 seconds'):
            with self.subTest(value=value):
                self.assertIn(value, body)
        self.assertIn('not measured performance', body)
        self.assertIn('final media review', body)


if __name__ == '__main__':
    unittest.main()
