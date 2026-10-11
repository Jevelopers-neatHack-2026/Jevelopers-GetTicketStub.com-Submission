"""Guard accessibility evidence against missing variants or stale asset bytes."""
import hashlib
import json
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]
def digest_matches(data,expected):
    return hashlib.sha256(data).hexdigest()==expected
class AccessibilityEvidenceChecks(unittest.TestCase):
    def setUp(self):
        self.results=json.loads((ROOT/'review/visual/accessibility-results.json').read_text())
        self.browser=json.loads((ROOT/'review/visual/browser-render-evidence.json').read_text())
    def test_every_browser_view_and_full_page_is_bound_to_checked_bytes(self):
        expected={(v['file'],v['output']) for v in self.browser['results']}
        observed={(v['source'],v['output']) for v in self.results['views']}
        self.assertEqual(observed,expected)
        hashes={v['path']:v['sha256'] for v in self.results['hashes']}
        for v in self.results['views']:
            for key in ['source','output','alternative','fullPageOutput']:
                p=v.get(key)
                if p:
                    self.assertIn(p,hashes)
                    self.assertTrue(digest_matches((ROOT/p).read_bytes(),hashes[p]),p)
        for p,digest in hashes.items():
            self.assertTrue(digest_matches((ROOT/p).read_bytes(),digest),p)
    def test_changed_asset_invalidates_record(self):
        item=next(x for x in self.results['hashes'] if x['path'].endswith('.png'))
        data=(ROOT/item['path']).read_bytes()
        self.assertTrue(digest_matches(data,item['sha256']))
        self.assertFalse(digest_matches(data+b'changed-export',item['sha256']))
    def test_negative_fixture_cannot_be_reported_as_release_pass(self):
        before=[v for v in self.results['views'] if 'redaction-before' in v['source']]
        self.assertTrue(before)
        for v in before:
            self.assertEqual(v['result'],'EXPECTED_NEGATIVE_RELEASE_BLOCKED')
            self.assertIsNone(v['alternative'])
        self.assertEqual(self.results['independentReview'],'pending')
        self.assertEqual(self.results['publicationApproval'],'pending')
        self.assertEqual(self.results['captionTiming']['status'],'NOT_APPLICABLE')
        self.assertTrue(self.results['captionTiming']['futureVideo'].startswith('PENDING'))
    def test_workflow_alternative_preserves_order_recovery_and_limits(self):
        text=(ROOT/'demo/diagrams/demo-workflow-alt-text.md').read_text()
        terms=['1. Event context','2. Design draft','3. Human review','4. Handoff']
        indexes=[text.index(t) for t in terms]
        self.assertEqual(indexes,sorted(indexes))
        for term in ['planned and blocked','Hold or revise returns to design review','No production or payment action','No product behavior, live sponsor integration, or measured savings']:
            self.assertIn(term,text)
        launch=(ROOT/'launch/assets/x-submission-alt-text.md').read_text()
        for term in ['Draft synthetic concept','Approval is required before production','No product or sponsor results are verified','repository documentation','not a working application']:
            self.assertIn(term,launch)
if __name__=='__main__': unittest.main()
