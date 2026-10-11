"""Validate brand evidence integrity; this cannot grant producer approval."""
import copy
import hashlib
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
class BrandEvidenceChecks(unittest.TestCase):
    def setUp(self):
        self.record=json.loads((ROOT/'review/visual/brand-comparison.json').read_text())
    def assert_gate_consistent(self,record):
        missing_subset=record.get('approvedSubset') is None
        missing_approval=any(a.get('status')!='approved' for a in record['requiredApprovals'])
        if missing_subset or missing_approval:
            self.assertEqual(record['brandConformance'],'BLOCKED_PENDING_OWNER_APPROVAL')
    def test_missing_unknown_or_revoked_approval_cannot_coexist_with_pass(self):
        self.assert_gate_consistent(self.record)
        for status in ['pending','unknown','revoked']:
            bad=copy.deepcopy(self.record)
            bad['brandConformance']='PASS'
            bad['requiredApprovals'][0]['status']=status
            with self.subTest(status=status):
                with self.assertRaises(AssertionError):
                    self.assert_gate_consistent(bad)
        bad=copy.deepcopy(self.record)
        bad['requiredApprovals']=[dict(a,status='approved') for a in bad['requiredApprovals']]
        bad['approvedSubset']=None
        bad['brandConformance']='PASS'
        with self.assertRaises(AssertionError): self.assert_gate_consistent(bad)
    def test_exact_pins_and_source_notices_are_identifiable(self):
        pins={'brand-kit':'3822635aff507cd5918a08a0c636bb0e41705261','getticketstub.com':'5a2986454297dd6df97088a8fbde69adc771f7a0','landing-page-repo':'3f28c8ac691374614354a8e53c1a2520e8c7854c'}
        for s in self.record['sources']:
            self.assertEqual(s['revision'],pins[s['repo']])
            self.assertIn(s['revision'],s['url'])
            self.assertEqual(len(s['sha256']),64)
            self.assertGreater(s['bytes'],0)
        files={s['path'] for s in self.record['sources'] if s['repo']=='brand-kit'}
        self.assertTrue({'SPEC.md','tokens/tokens.json','docs/voice.md','docs/logo.md','docs/imagery.md','fonts/Fraunces-OFL.txt','fonts/InterTight-OFL.txt'}.issubset(files))
        self.assertEqual(self.record['copiedBinaryAssets'],[])
    def test_comparisons_bind_unchanged_candidates_and_rendered_bytes(self):
        recorded={v['path']:v['sha256'] for v in self.record['candidateHashes']}
        self.assertEqual(len(self.record['treatments']),2)
        for t in self.record['treatments']:
            for key in ['source','comparison','preview']:
                p=t[key]
                self.assertEqual(hashlib.sha256((ROOT/p).read_bytes()).hexdigest(),recorded[p])
            html=(ROOT/t['comparison']).read_text()
            self.assertIn('brand approval pending',html)
            self.assertIn('not a screenshot of an approved brand board or product',html)
            self.assertNotIn('@font-face',html)
        for v in self.record['browserEvidence']['results']:
            self.assertEqual(v['pageErrors'],[])
            self.assertEqual(v['externalRequests'],[])
        browser=json.loads((ROOT/'review/visual/browser-render-evidence.json').read_text())
        original={v['path']:v['sha256'] for v in browser['hashes']}
        for t in self.record['treatments']:
            self.assertEqual(recorded[t['source']],original[t['source']])
    def test_migration_does_not_drop_support_derivatives(self):
        impacted=set(self.record['migrationExample']['impactedAssetIds'])
        self.assertTrue({'DEMO-WORKFLOW-DIAGRAM-001','DEMO-SCREENSHOT-SET-001','DEMO-DECK-SUPPORT-001','LAUNCH-X-KEY-VISUAL-001','LAUNCH-X-ALT-TEXT-001'}.issubset(impacted))
        self.assertIn('revoked',self.record['migrationExample']['rollback'].lower())
if __name__=='__main__': unittest.main()
