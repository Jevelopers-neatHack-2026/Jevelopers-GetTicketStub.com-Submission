"""Meaningful export checks; run browser export first, then this suite."""
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
SOURCES = [ROOT / x for x in ['demo/diagrams/demo-workflow.svg', 'demo/screenshots/synthetic-stub-mockup.svg', 'launch/assets/x-submission-key-visual.svg']]
NS = {'s': 'http://www.w3.org/2000/svg'}
def luminance(color):
    rgb = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    rgb = [x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in rgb]
    return sum(x * w for x, w in zip(rgb, (.2126, .7152, .0722)))
def contrast(a, b):
    a,b = sorted((luminance(a),luminance(b)))
    return (b+.05)/(a+.05)
def contrast_pass(fg,bg,threshold=4.5):
    return contrast(fg,bg) >= threshold
class VisualChecks(unittest.TestCase):
    def test_normal_text_and_essential_marks(self):
        for source in SOURCES:
            r=ET.parse(source).getroot()
            for t in r.findall('.//s:text',NS):
                with self.subTest(path=source.name,text=t.text):
                    self.assertTrue(contrast_pass(t.attrib['fill'], t.attrib['data-bg']))
            for m in r.findall('.//*[@data-essential="true"]'):
                self.assertTrue(contrast_pass(m.attrib['stroke'],m.attrib['data-bg'],3))
    def test_failing_brand_pair_is_rejected(self):
        self.assertFalse(contrast_pass('#7CC6D2','#F4ECDD'))
        self.assertFalse(contrast_pass('#E4572E','#F4ECDD'))
    def test_dimensions_and_status(self):
        expected=[(1440,900),(1200,900),(1200,675)]
        for source,size in zip(SOURCES,expected):
            with Image.open(source.with_suffix('.png')) as image:
                self.assertEqual(image.size,size)
            r=ET.parse(source).getroot()
            self.assertTrue(r.find('s:title',NS).text.startswith('Draft'))
            self.assertIn('review', r.find('s:desc',NS).text.lower())
            self.assertFalse(r.findall('.//s:image',NS))
            self.assertFalse(r.findall('.//s:script',NS))
            self.assertIn('3822635aff507cd5918a08a0c636bb0e41705261',source.read_text())
    def test_fake_canary_removed_from_source_alt_metadata_and_pixels(self):
        p=ROOT/'examples/synthetic'
        fixture=json.loads((p/'redaction-canaries.json').read_text())
        self.assertTrue(fixture['syntheticOnly'])
        before=(p/'redaction-before.svg').read_text()
        for c in fixture['canaries']:
            self.assertIn(c,before)
            for f in ['redaction-after.svg','redaction-after-alt-text.md']:
                self.assertNotIn(c,(p/f).read_text())
            self.assertNotIn(c.encode(),(p/'redaction-after.png').read_bytes())
        a=Image.open(p/'redaction-after.png')
        self.assertEqual(a.info,{})
        with Image.open(p/'redaction-before.png') as image:
            self.assertIn('DUMMY_METADATA_CANARY_C3',str(image.info))
        x,y,w,h=fixture['sensitivePixelRegion']
        clean=a.convert('RGB').crop((x,y,x+w,y+h))
        dirty=Image.open(p/'redaction-before.png').convert('RGB').crop((x,y,x+w,y+h))
        self.assertEqual(set(clean.getdata()),{(244,236,221)})
        self.assertNotEqual(clean.tobytes(),dirty.tobytes())
    def test_overlay_only_would_fail_source_scan(self):
        p=ROOT/'examples/synthetic'
        fake_overlay=(p/'redaction-before.svg').read_text().replace('</svg>','<rect x="80" y="180" width="640" height="180" fill="#F4ECDD"/></svg>')
        self.assertIn('DUMMY_SECRET_CANARY_B2',fake_overlay)
    def test_browser_receipt(self):
        r=json.loads((ROOT/'review/visual/browser-render-evidence.json').read_text())
        self.assertEqual(len(r['results']),16)
        for x in r['results']:
            self.assertEqual(x['browserErrors'],[])
            self.assertEqual(x['externalRequests'],[])
            self.assertLessEqual(x['layout']['scrollWidth'],x['layout']['innerWidth'])
        self.assertEqual(r['keyboard']['tag'],'A')
        self.assertEqual(r['keyboard']['outline'],'solid')
if __name__=='__main__': unittest.main()
