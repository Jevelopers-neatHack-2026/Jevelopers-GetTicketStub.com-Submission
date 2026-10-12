"""Offline regression checks for the human submission handoff, not release approval.

These checks inspect the actual runbook. They never open a browser, submit a
form, validate private receipts, or change the authoritative readiness gates.
"""
from pathlib import Path
import re
import unittest


RUNBOOK = Path(__file__).resolve().parents[1] / 'demo' / 'human-recording-runbook.md'
TAGS = ('@neatlogs', '@EntireHQ', '@arithecfo')


def section(text, number):
    # Anchor headings so a mention elsewhere cannot replace the required stage.
    match = re.search(r'(?ms)^## ' + str(number) + r'\. [^\n]*\n(.*?)(?=^## |\Z)', text)
    return match.group(1) if match else ''


def omissions(text):
    """Return missing document-contract elements; an empty list is NOT approval."""
    required = {
        2: (
            'https://neatlogs.com/submission', 'Both steps are required',
            '| Submission-form leader |', '| Final form acknowledgement |',
            '| Posted entry URL |', 'repository acceptance requirement',
        ) + TAGS,
        9: (
            'public quote-post', 'attach the demo video', 'check-in email',
            '`Submit project`', '`Continue` saves a draft',
            'redacted', 'timestamp', 'Both receipts are required',
        ) + TAGS,
    }
    return [
        'section {}: {}'.format(number, token)
        for number, tokens in required.items()
        for token in tokens
        if token not in section(text, number)
    ]


class SubmissionWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = RUNBOOK.read_text(encoding='utf-8')

    def test_actual_runbook_has_complete_two_step_handoff(self):
        self.assertEqual([], omissions(self.text))

    def test_form_and_post_receipts_remain_distinct_pending_fields(self):
        rows = section(self.text, 2).splitlines()
        for label in ('Posted entry URL', 'Submission-form leader', 'Final form acknowledgement'):
            with self.subTest(label=label):
                matches = [line for line in rows if line.startswith('| ' + label + ' |')]
                self.assertEqual(1, len(matches))
                self.assertIn('**Unknown', matches[0])

    def test_cancellation_and_human_roles_are_preserved(self):
        self.assertIn('CANCELLED_USER_REQUEST_NO_RESTART', self.text)
        self.assertIn('**No agent records, posts, uploads or submits.**', self.text)
        self.assertIn('**Crystal and Lars**', self.text)
        self.assertIn('No agent recording, upload, post or form submission is authorized', self.text)

    def test_finance_and_publication_limits_are_preserved(self):
        for token in ('43884eafc91bd84b6dd4970a893e084c09f4759ea566f4864f1b95268ba12a14',
                      'CFO-R2-001', 'HYPOTHETICAL FORECAST',
                      'not an approved final v1', 'No Finance',
                      'rights, brand', 'not a complete submission procedure'):
            with self.subTest(token=token):
                self.assertIn(token.lower(), self.text.lower())

    def test_missing_each_tag_is_rejected(self):
        for tag in TAGS:
            with self.subTest(tag=tag):
                bad = self.text.replace(tag, '')
                self.assertIn('section 2: ' + tag, omissions(bad))
                self.assertIn('section 9: ' + tag, omissions(bad))

    def test_post_only_handoff_is_rejected(self):
        bad = self.text.replace('https://neatlogs.com/submission', '')
        self.assertIn('section 2: https://neatlogs.com/submission', omissions(bad))

    def test_draft_only_instructions_are_rejected(self):
        bad = self.text.replace('`Submit project`', '`Continue`')
        self.assertIn('section 9: `Submit project`', omissions(bad))

    def test_missing_acknowledgement_field_is_rejected(self):
        bad = '\n'.join(line for line in self.text.splitlines()
                        if not line.startswith('| Final form acknowledgement |'))
        self.assertIn('section 2: | Final form acknowledgement |', omissions(bad))

    def test_intro_cannot_replace_after_take_instructions(self):
        bad = self.text.split('## 9. After the take')[0]
        self.assertTrue(any(item.startswith('section 9:') for item in omissions(bad)))

    def test_final_receipts_do_not_block_starting_human_recording(self):
        before = section(self.text, 3)
        self.assertNotIn('The Discord cutoff, official post URL, demo URL and posted URL', before)
        self.assertIn('collected after the take', before)
        self.assertIn('not prerequisites for starting the human recording', before)

    def test_all_three_sponsor_five_facet_matrices_remain(self):
        coverage = section(self.text, 6)
        for facet in ('Architecture', 'Implementation', 'Runtime', 'Reasoning', 'Result'):
            with self.subTest(facet=facet):
                self.assertEqual(3, coverage.count('| ' + facet + ' |'))

    def test_private_confirmation_data_is_not_requested_in_repository(self):
        after = section(self.text, 9)
        self.assertIn('Do not commit the verification email', after)
        self.assertIn('authentication links', after)
        self.assertIn('private form fields', after)


if __name__ == '__main__':
    unittest.main()
