import copy,hashlib,importlib.util,json,re,shutil,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image,ImageChops,ImageStat
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('rehearsal',ROOT/'tools/render_rehearsal.py');renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
def local_paths(text):
 # Public URL paths are not machine-local filesystem evidence.
 text=re.sub(r'https?://[^\s\"<>]+','PUBLIC_URL',text)
 return re.findall(r'(?<![\w:/])(?:file://)?/(?:Users|private|tmp|home|Volumes|Applications)(?:/[^\s\"<>]*)?',text)

class RehearsalChecks(unittest.TestCase):
 def setUp(self):
  self.source=json.loads((ROOT/'demo/rehearsal-scenes.json').read_text());self.plan=json.loads((ROOT/'demo/exports/rehearsal-render-plan.json').read_text());self.receipt=json.loads((ROOT/'review/visual/rehearsal/metadata.json').read_text())
 def test_scene_timing_captions_and_sidecars_match_exact_general_copy(self):
  scenes=renderer.validate(self.source);self.assertEqual(scenes[-1]['endSeconds'],150)
  self.assertEqual(self.plan['cues'],renderer.make_cues(scenes))
  for i,s in enumerate(scenes):
   cues=[c for c in self.plan['cues'] if c['sceneIndex']==i]
   self.assertEqual(' '.join(c['text'] for c in cues),s['captionText'])
   self.assertEqual(cues[0]['startFrame'],s['startSeconds']*30);self.assertEqual(cues[-1]['endFrame'],s['endSeconds']*30)
   for c in cues:
    self.assertLessEqual(len(c['text']),140);self.assertGreaterEqual(c['endSeconds']-c['startSeconds'],2)
    self.assertLessEqual(len(c['text'])/(c['endSeconds']-c['startSeconds']),20)
  qualifier='No product behavior, live sponsor integration, or measured savings are demonstrated.'
  self.assertTrue(any(qualifier in c['text'] for c in self.plan['cues'] if c['sceneIndex']==0))
  srt=(ROOT/'demo/captions/silent-rehearsal.srt').read_text();vtt=(ROOT/'demo/captions/silent-rehearsal.vtt').read_text()
  for i,c in enumerate(self.plan['cues']):
   self.assertIn(f'{i+1}\n{renderer.stamp(c["startSeconds"],True)} --> {renderer.stamp(c["endSeconds"],True)}\n{c["text"]}',srt)
   self.assertIn(f'{renderer.stamp(c["startSeconds"])} --> {renderer.stamp(c["endSeconds"])}\n{c["text"]}',vtt)
 def test_malformed_evidence_timing_or_missing_runtime_is_rejected(self):
  for field,value in [('startSeconds',1),('endSeconds',0),('captionText','invented')]:
   bad=copy.deepcopy(self.source);bad['scenes'][0][field]=value
   with self.assertRaises(ValueError):renderer.validate(bad)
  bad=copy.deepcopy(self.source);bad['scenes'][4]['sponsorFacets'][0]['status']='passed'
  with self.assertRaises(ValueError):renderer.validate(bad)
  with patch.object(renderer.shutil,'which',return_value=None):
   with self.assertRaisesRegex(RuntimeError,'runtime missing'):renderer.require_tool('ffmpeg')
 def test_actual_encoded_mp4_is_150_seconds_h264_720p_silent(self):
  video=ROOT/'demo/exports/silent-synthetic-rehearsal.mp4';p=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(video)]))
  self.assertAlmostEqual(float(p['format']['duration']),150,places=3);self.assertLess(video.stat().st_size,20000000)
  self.assertEqual(len(p['streams']),1);s=p['streams'][0];self.assertEqual(s['codec_name'],'h264');self.assertEqual(s['codec_type'],'video');self.assertEqual((s['width'],s['height']),(1280,720));self.assertEqual(s['r_frame_rate'],'30/1')
 def test_browser_text_status_facets_safe_area_and_no_remote_calls(self):
  browser=json.loads((ROOT/'review/visual/rehearsal/browser.json').read_text());self.assertEqual(len(browser['results']),len(self.plan['cues']))
  for b,c in zip(browser['results'],self.plan['cues']):
   m=b['measurement'];self.assertEqual(m['caption'],c['text']);self.assertEqual(m['screenText'],self.source['scenes'][c['sceneIndex']]['screenText'])
   for term in ['DRAFT','SYNTHETIC REHEARSAL','NOT A PRODUCT DEMO','SILENT / CAPTIONED']:self.assertIn(term,m['status'])
   self.assertEqual(b['pageErrors'],[]);self.assertEqual(b['externalRequests'],[]);self.assertLessEqual(m['lastTextBottom'],510)
   self.assertTrue(all(x['scrollHeight']<=x['clientHeight'] for x in m['overflow']))
  sponsors=[s for s in self.source['scenes'] if s.get('sponsor')];self.assertEqual(sum(len(s['sponsorFacets']) for s in sponsors),15)
 def test_all_twenty_decoded_boundary_frames_retain_rendered_caption_pixels(self):
  self.assertEqual(len(self.receipt['frames']),20)
  for frame in self.receipt['frames']:
   cue=next(c for c in self.plan['cues'] if c['startFrame']<=frame['frame']<c['endFrame'])
   with Image.open(ROOT/frame['path']) as actual,Image.open(ROOT/f'demo/exports/frames/cue-{cue["index"]:02}.png') as expected:
    self.assertLess(max(ImageStat.Stat(ImageChops.difference(actual.convert('RGB'),expected.convert('RGB'))).mean),3)
   with Image.open(ROOT/frame['mobilePath']) as mobile:self.assertEqual(mobile.size,(780,439))
 def test_public_receipts_use_relative_paths_without_machine_local_fields(self):
  expected='demo/exports/silent-synthetic-rehearsal.mp4'
  recorded=json.loads((ROOT/'review/visual/rehearsal/ffprobe.json').read_text())
  actual=renderer.probe_video(ROOT/expected)
  self.assertEqual(actual['format']['filename'],expected)
  self.assertEqual(actual,recorded)
  with tempfile.TemporaryDirectory(prefix='rehearsal-receipt-') as directory:
   checkout=Path(directory);video=checkout/expected;video.parent.mkdir(parents=True);shutil.copy2(ROOT/expected,video)
   with patch.object(renderer,'ROOT',checkout):self.assertEqual(renderer.probe_video(video),recorded)
  reports=list((ROOT/'review/visual/rehearsal').rglob('*.json'))+list((ROOT/'review/visual/rehearsal').rglob('*.md'))+[ROOT/'demo/exports/rehearsal-render-plan.json']
  for p in reports:self.assertEqual(local_paths(p.read_text()),[],str(p.relative_to(ROOT)))
  for prefix in ['/Users/alice/project','/private/build','/tmp/checkout','file:///Users/alice/project']:
   self.assertTrue(local_paths(prefix),prefix)
  self.assertEqual(local_paths('https://example.org/Users/public https://example.org/tmp/docs https://example.org/private/page'),[])
  with self.assertRaises(ValueError):renderer.probe_video(ROOT.parent/'outside.mp4')
 def test_final_artifact_hashes_remain_current(self):
  for item in self.receipt['hashes']:
   p=ROOT/item['path'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),item['sha256'],item['path'])
  self.assertEqual(self.receipt['independentApproval'],'pending');self.assertFalse(self.receipt['publication']);self.assertFalse(self.receipt['tts']);self.assertTrue(self.receipt['noPaidCalls'])
if __name__=='__main__':unittest.main()
