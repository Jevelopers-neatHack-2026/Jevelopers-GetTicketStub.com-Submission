"""Source-only checks for PR 27 review corrections; never release approval.

The guards inspect operational sections, not frozen rehearsal narration. They
make no network, media, provider, form, or approval calls. Failure injections
prove detection of missing instructions, not actual organizer acceptance.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
TAGS = ('@neatlogs', '@EntireHQ', '@arithecfo')
DOCUMENT_SECTIONS = {
    'demo/human-recording-runbook.md': '9. After the take',
    'demo/recording-checklist.md': 'Human submission handoff (after the take)',
    'demo/narration.md': 'Current submission procedure (not narration)',
    'docs/collateral-handoff.md': 'Format and external-use boundary',
}
FORM_FIELDS = ('Location', 'Founder or work details', 'Neatlogs description',
               'Entire description', 'CFO.ai description')
PRODUCER_DECISION = 'issuecomment-6127105138'
PRODUCER_FALLBACK = 'issuecomment-6128507697'


def section(text, heading):
    """Find one exact H2 boundary; mentions outside it do not supply evidence."""
    match = re.search(r'(?ms)^## ' + re.escape(heading)
                      + r'\s*\n(.*?)(?=^## |\Z)', text)
    return match.group(1) if match else ''


def normalized(text):
    return re.sub(r'\s+', ' ', text.replace('`', '').replace('**', '')).lower()


def procedure_errors(text):
    """Check meaningful required labels, allowing whitespace/Markdown changes."""
    clean = normalized(text)
    patterns = {
        'public quote-post': r'public (?:x )?quote-post',
        'attached demo': r'attach(?:ed|es|ing)? (?:the )?(?:approved )?demo video',
        'leader': r'\bleader\b',
        'form destination': r'https://neatlogs\.com/submission',
        'final action': r'\bsubmit project\b',
        'draft distinction': r'\bcontinue\b[^.]*\bdraft\b',
        'two steps': r'\bboth steps are required\b|\bboth receipts are required\b',
        'posted receipt': r'posted-entry url',
        'form receipt': r'redacted final form acknowledgement',
        'receipt time': r'\btimestamp\b',
    }
    errors = [name for name, pattern in patterns.items() if not re.search(pattern, clean)]
    errors.extend(tag for tag in TAGS if tag.lower() not in clean)
    return errors


def pending_field_errors(text):
    rows = [line.split('|')[1:-1] for line in text.splitlines() if line.startswith('|')]
    failures = []
    for label in FORM_FIELDS:
        found = [row for row in rows if row and row[0].strip() == label]
        if len(found) != 1 or len(found[0]) != 3:
            failures.append(label)
        elif found[0][1].strip() or 'unknown' not in found[0][2].lower():
            failures.append(label)
    return failures


class RecordingHandoffReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.docs = {name: (ROOT / name).read_text(encoding='utf-8')
                    for name in DOCUMENT_SECTIONS}
        cls.runbook = cls.docs['demo/human-recording-runbook.md']

    def test_each_operational_document_has_complete_procedure(self):
        for name, heading in DOCUMENT_SECTIONS.items():
            with self.subTest(document=name):
                self.assertEqual([], procedure_errors(section(self.docs[name], heading)))

    def test_each_companion_rejects_each_missing_sponsor_tag(self):
        for name, heading in DOCUMENT_SECTIONS.items():
            body = section(self.docs[name], heading)
            for tag in TAGS:
                with self.subTest(document=name, tag=tag):
                    self.assertIn(tag, procedure_errors(body.replace(tag, '')))

    def test_each_companion_rejects_draft_only_completion(self):
        for name, heading in DOCUMENT_SECTIONS.items():
            with self.subTest(document=name):
                body = section(self.docs[name], heading).replace('Submit project', 'Continue')
                self.assertIn('final action', procedure_errors(body))

    def test_each_companion_rejects_post_only_completion(self):
        for name, heading in DOCUMENT_SECTIONS.items():
            with self.subTest(document=name):
                body = section(self.docs[name], heading).replace('https://neatlogs.com/submission', '')
                self.assertIn('form destination', procedure_errors(body))

    def test_missing_operational_section_cannot_pass_on_historical_text(self):
        for name, heading in DOCUMENT_SECTIONS.items():
            with self.subTest(document=name):
                bad = self.docs[name].replace('## ' + heading, '### ' + heading)
                self.assertTrue(procedure_errors(section(bad, heading)))

    def test_runbook_carries_private_pending_form_fields(self):
        self.assertEqual([], pending_field_errors(section(self.runbook, '2. What the organizer and the entry require')))

    def test_missing_or_prematurely_filled_field_is_rejected(self):
        original = section(self.runbook, '2. What the organizer and the entry require')
        for label in FORM_FIELDS:
            with self.subTest(field=label):
                missing = '\n'.join(line for line in original.splitlines()
                                    if not line.startswith('| ' + label + ' |'))
                self.assertIn(label, pending_field_errors(missing))
                filled = original.replace('| ' + label + ' | |', '| ' + label + ' | example value |')
                self.assertIn(label, pending_field_errors(filled))

    def test_form_fields_are_not_presented_as_mandatory_post_contents(self):
        body = section(self.runbook, '9. After the take')
        post = next((line for line in body.splitlines() if line.startswith('- [ ] The authorized teammate')), '')
        self.assertTrue(post)
        self.assertNotIn('required team, name, project', post)
        self.assertNotIn('founder', post.lower())
        self.assertIn('location', body.lower())
        self.assertIn('founder or work details', body.lower())
        self.assertIn('check-in', body.lower())

    def test_window_has_date_timezones_and_discord_override(self):
        body = section(self.runbook, '2. What the organizer and the entry require')
        for token in ('2026-10-12', '19:00', '23:55', 'IST', '09:30', '14:25', 'EDT', '13:30', '18:25', 'UTC'):
            with self.subTest(token=token):
                self.assertIn(token, body)
        self.assertRegex(body, r'Discord[^\n]*overrides')
        self.assertIn('cannot be pre-filled before', body)

    def test_producer_selection_and_fallback_supersede_legacy_shots(self):
        body = section(self.runbook, '6. Planned timed shot list (a plan, not an executed dry run)')
        for token in (PRODUCER_DECISION, PRODUCER_FALLBACK, 'StudioStart', 'five editions', 'legacy', 'producer'):
            with self.subTest(token=token):
                self.assertIn(token, body)
        self.assertNotIn('5 editions versus 8 new SVG templates, undecided', self.runbook)

    def test_rehearsal_close_is_archival_not_current_instructions(self):
        narration = self.docs['demo/narration.md']
        operative = section(narration, 'Current submission procedure (not narration)')
        self.assertIn('historical', operative.lower())
        self.assertIn('scene-09-submission-gate', operative)
        # Original caption text remains exact; its synchronized media is NOT regenerated.
        row = next(line for line in narration.splitlines()
                   if line.startswith('| `scene-09-submission-gate`'))
        self.assertIn('Quote-post the official neatlogs post with team, name, project, public repository and demo link.', row)
        self.assertNotIn('Submit project', row)
        self.assertIn('historical', section(self.runbook, '7. Beat text and spoken lines').lower())

    def test_private_fields_and_receipts_stay_out_of_repository(self):
        body = section(self.runbook, '2. What the organizer and the entry require')
        self.assertIn('Do not commit', body)
        self.assertIn('founder/work', body)
        self.assertIn('verification email', section(self.runbook, '9. After the take'))

    def test_no_tentative_account_mapping_or_availability_chatter(self):
        for name in ('demo/human-recording-runbook.md', 'demo/recording-checklist.md'):
            with self.subTest(document=name):
                self.assertNotRegex(self.docs[name], r'likely\s+[\w-]+/[\w-]+')
                self.assertNotRegex(self.docs[name], r'(?i)\b(?:lars|crystal)\s+is\s+offline\b')

    def test_semantic_checks_allow_markdown_and_whitespace_changes(self):
        for name, heading in DOCUMENT_SECTIONS.items():
            with self.subTest(document=name):
                body = section(self.docs[name], heading).replace('`', '').replace(' ', '  ')
                self.assertEqual([], procedure_errors(body))


if __name__ == '__main__':
    unittest.main()
