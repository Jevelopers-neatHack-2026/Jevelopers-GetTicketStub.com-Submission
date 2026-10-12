"""Local-only silent draft rehearsal: validate, render Chrome frames, encode H.264."""
from pathlib import Path
import argparse,hashlib,html,json,math,re,shutil,subprocess
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'demo/rehearsal-scenes.json'
def validate(data):
    scenes=data.get('scenes',[])
    if not scenes or data.get('status')!='rehearsal_only': raise ValueError('Rehearsal scenes/status required')
    end=0
    for s in scenes:
        if s['startSeconds']!=end or s['endSeconds']<=end or s['durationSeconds']!=s['endSeconds']-end: raise ValueError('Noncontiguous or invalid timing')
        if not s.get('captionText') or s['captionText']!=s.get('narration'): raise ValueError('Exact caption/narration mismatch')
        if not s.get('screenText') or any(not isinstance(t,str) or not t for t in s['screenText']): raise ValueError('Screen text required')
        if s.get('sponsor'):
            facets=s.get('sponsorFacets',[])
            if {x['aspect'] for x in facets}!={'architecture','implementation','runtime','reasoning','result'} or any(x['status']!='pending' for x in facets) or s['providerMode']!='not_run': raise ValueError('Sponsor missing/passed facet or runtime mode')
        end=s['endSeconds']
    if end!=data['render']['plannedDurationSeconds'] or end>180: raise ValueError('Duration does not match or exceeds180s')
    if data['render'].get('tts') or data['render'].get('paidProviderCalls'): raise ValueError('Only silent/no-paid mode allowed')
    return scenes

def chunks(text,limit=140):
    # Keep complete sentences together so negative evidence qualifiers cannot
    # become a misleading standalone positive fragment in a later cue.
    sentences=re.split(r'(?<=[.!?]) ',text);out=[];part=''
    for sentence in sentences:
        if len(sentence)>limit: raise ValueError('Caption sentence exceeds safe budget; request source-owner segmentation')
        if part and len(part)+1+len(sentence)>limit: out.append(part);part=sentence
        else: part+=(' ' if part else '')+sentence
    if part: out.append(part)
    if ' '.join(out)!=text: raise ValueError('Caption round-trip mismatch')
    return out

def make_cues(scenes):
    cues=[]
    for index,s in enumerate(scenes):
        parts=chunks(s['captionText']);weights=[len(x) for x in parts];total=sum(weights);current=round(s['startSeconds']*30)
        for j,text in enumerate(parts):
            ending=round((s['startSeconds']+s['durationSeconds']*sum(weights[:j+1])/total)*30)
            cues.append({'index':len(cues),'sceneIndex':index,'sceneId':s['sceneId'],'text':text,'startFrame':current,'endFrame':ending,'startSeconds':current/30,'endSeconds':ending/30})
            current=ending
    return cues

def stamp(seconds,comma=False):
    ms=round(seconds*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f'{h:02}:{m:02}:{s:02}{"," if comma else "."}{ms:03}'

def require_tool(name):
    p=shutil.which(name)
    if not p: raise RuntimeError('Required local runtime missing: '+name)
    return p

def run(args): return subprocess.check_output(args,cwd=ROOT,text=True,stderr=subprocess.STDOUT)
def probe_video(video):
    # Relative input prevents ffprobe from publishing the checkout's local path.
    relative=Path(video).resolve().relative_to(ROOT.resolve()).as_posix()
    return json.loads(run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',relative]))

def main():
    scenes=validate(json.loads(SOURCE.read_text()));cues=make_cues(scenes)
    for t in ['node','ffmpeg','ffprobe']: require_tool(t)
    out=ROOT/'demo/exports';proof=ROOT/'review/visual/rehearsal';captions=ROOT/'demo/captions'
    for p in [out/'frames',proof/'inspection',captions]:p.mkdir(parents=True,exist_ok=True)
    data={'status':'DRAFT / SYNTHETIC REHEARSAL / NOT A PRODUCT DEMO','silent':True,'width':1280,'height':720,'fps':30,'durationSeconds':scenes[-1]['endSeconds'],'scenes':scenes,'cues':cues}
    (out/'rehearsal-render-plan.json').write_text(json.dumps(data,indent=2)+'\n')
    srt='\n\n'.join(f'{i+1}\n{stamp(c["startSeconds"],True)} --> {stamp(c["endSeconds"],True)}\n{c["text"]}' for i,c in enumerate(cues))+'\n'
    vtt='WEBVTT\n\n'+'\n\n'.join(f'{stamp(c["startSeconds"])} --> {stamp(c["endSeconds"])}\n{c["text"]}' for c in cues)+'\n'
    (captions/'silent-rehearsal.srt').write_text(srt);(captions/'silent-rehearsal.vtt').write_text(vtt)
    payload=json.dumps(data,ensure_ascii=False).replace('<','\\u003c')
    page='''<!doctype html><html lang="en"><meta charset="utf-8"><title>Draft synthetic silent rehearsal — not product demo</title><style>*{box-sizing:border-box}body{margin:0;width:1280px;height:720px;background:#F4ECDD;color:#17140F;font-family:system-ui,-apple-system,sans-serif;overflow:hidden}header{position:absolute;left:48px;top:24px;width:1184px;height:104px;background:#26302A;color:#F4ECDD;padding:10px 20px;font-size:32px;font-weight:600;line-height:1.2}header div+div{font-size:28px;margin-top:5px}main{position:absolute;left:64px;top:150px;width:1152px;height:350px;display:flex;flex-direction:column;justify-content:center;gap:12px}main p{margin:0;font-size:32px;line-height:1.16}main p:first-child{font-size:36px;font-weight:650}main.sponsor{gap:5px}main.sponsor p{font-size:28px;line-height:1.12}main.sponsor p:first-child{font-size:36px;margin-bottom:6px}main.sponsor p:nth-last-child(2){font-size:28px;margin-top:8px}aside{position:absolute;left:48px;top:526px;width:1184px;height:154px;background:#17140F;color:#F4ECDD;padding:16px 24px;display:flex;align-items:center;font-size:32px;line-height:1.2}footer{display:none}</style><header><div>DRAFT • SYNTHETIC REHEARSAL</div><div>NOT A PRODUCT DEMO • SILENT / CAPTIONED</div></header><main id="screen"></main><aside aria-label="Exact rehearsal caption" id="caption"></aside><footer id="position"></footer><script>const data=PAYLOAD;const cue=data.cues[Number(location.hash.slice(1)||0)];const scene=data.scenes[cue.sceneIndex];const main=document.querySelector('main');main.className=scene.sponsor?'sponsor':'';for(const text of scene.screenText){const p=document.createElement('p');p.textContent=text;main.append(p)}document.querySelector('#caption').textContent=cue.text;document.querySelector('#position').textContent=`Scene ${cue.sceneIndex+1}/10 • ${scene.evidenceClass} • provider mode: ${scene.providerMode} • review pending`;window.rehearsalReady=true;</script></html>'''.replace('PAYLOAD',payload)
    (ROOT/'demo/deck/rehearsal-scenes.html').write_text(page)
    expected={f'cue-{c["index"]:02}.png' for c in cues}
    for stale in (out/'frames').glob('cue-*.png'):
        if stale.name not in expected: stale.unlink()
    print(run(['node','tools/render_rehearsal.mjs']))
    # Static PNG loops per cue retain 30fps timing exactly; a temporary local concat manifest.
    segments=[]
    for c in cues:
        f=out/'frames'/f'cue-{c["index"]:02}.png';segment=proof/f'cue-{c["index"]:02}.mp4'
        run(['ffmpeg','-hide_banner','-loglevel','error','-y','-loop','1','-framerate','30','-i',str(f),'-frames:v',str(c['endFrame']-c['startFrame']),'-c:v','libx264','-preset','ultrafast','-crf','28','-pix_fmt','yuv420p','-an',str(segment)])
        segments.append(segment)
    listing=proof/'concat.txt';listing.write_text(''.join("file '"+p.name+"'\n" for p in segments))
    video=out/'silent-synthetic-rehearsal.mp4'
    run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','1','-i',str(listing),'-c','copy','-movflags','+faststart','-metadata','title=DRAFT synthetic silent rehearsal; not product demo','-metadata','comment=No product/sponsor results verified; final approval pending',str(video)])
    probe=probe_video(video)
    (proof/'ffprobe.json').write_text(json.dumps(probe,indent=2)+'\n')
    frames=[]
    from PIL import Image
    for i,s in enumerate(scenes):
        for label,frame in [('start',round(s['startSeconds']*30)),('end',round(s['endSeconds']*30)-1)]:
            target=proof/'inspection'/f'scene-{i+1:02}-{label}.png'
            run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(video),'-vf',f'select=eq(n\\,{frame})','-vsync','0','-frames:v','1',str(target)])
            mobile=target.with_name(target.stem+'-mobile.png')
            with Image.open(target) as image:image.resize((780,439)).save(mobile)
            frames.append({'sceneId':s['sceneId'],'position':label,'frame':frame,'path':target.relative_to(ROOT).as_posix(),'mobilePath':mobile.relative_to(ROOT).as_posix()})
        for suffix in ['', '-mobile']:
            names=[proof/'inspection'/f'scene-{i+1:02}-{x}{suffix}.png' for x in ['start','end']]
            with Image.open(names[0]) as a,Image.open(names[1]) as b:
                sheet=Image.new('RGB',(a.width+b.width,a.height));sheet.paste(a,(0,0));sheet.paste(b,(a.width,0));sheet.save(proof/'inspection'/f'scene-{i+1:02}-pair{suffix}.png')
    # Intermediate encoded cue segments are reproducible scratch, not deliverables.
    for p in segments+[listing]:p.unlink()
    outputs=[SOURCE,ROOT/'demo/storyboard.md',ROOT/'demo/narration.md',ROOT/'demo/rehearsal-transcript.md',video,out/'rehearsal-render-plan.json',captions/'silent-rehearsal.srt',captions/'silent-rehearsal.vtt',ROOT/'demo/deck/rehearsal-scenes.html']
    outputs+=[ROOT/'tools/render_rehearsal.py',ROOT/'tools/render_rehearsal.mjs',proof/'browser.json',proof/'ffprobe.json']
    outputs+=list((out/'frames').glob('*.png'))+list((proof/'inspection').glob('*.png'))
    receipt={'status':'DRAFT_SYNTHETIC_REHEARSAL_NOT_PRODUCT_DEMO','silent':True,'audioTracks':0,'subtitles':'Burned-in exact captions plus SRT/VTT sidecars; no embedded subtitle stream','durationSeconds':float(probe['format']['duration']),'bytes':video.stat().st_size,'localSizeTargetBytes':20000000,'targetIsOrganizerRequirement':False,'viewingContext':'1280x720 native; mobile landscape/fullscreen780x439. Portrait uses packaged transcript, not a readability claim for tiny inline playback.','versions':{'ffmpeg':run(['ffmpeg','-version']).splitlines()[0],'ffprobe':run(['ffprobe','-version']).splitlines()[0]},'command':'python3 tools/render_rehearsal.py','sourceMode':'Exact general scene screenText/captionText; plain-text fallback chosen so dense supporting diagrams need not shrink','frames':frames,'noPaidCalls':True,'tts':False,'publication':False,'independentApproval':'pending','authorFrameInspection':'pending','limitations':json.loads(SOURCE.read_text())['submissionGate']['blockers'],'hashes':[{'path':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in outputs]}
    (proof/'metadata.json').write_text(json.dumps(receipt,indent=2)+'\n');print('Encoded',video.stat().st_size,'bytes;',probe['format']['duration'],'seconds;',len(cues),'caption cues')
if __name__=='__main__':main()
