// No downloaded runtime dependencies. Uses installed Google Chrome, Node >=22,
// Python 3 and Pillow. Local-only CDP: no product APIs, fonts, paid services.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.cwd();
const chrome=process.env.COLLATERAL_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out='review/visual';
fs.mkdirSync(`${out}/previews`,{recursive:true});
// Remove sensitive elements and all metadata/comments, then replace accessible text.
// This is destructive source reconstruction, never an overlay or blur.
execFileSync('python3',['-c',String.raw`
from pathlib import Path
import xml.etree.ElementTree as E
p=Path('examples/synthetic'); r=E.fromstring((p/'redaction-before.svg').read_text())
for parent in r.iter():
 for child in list(parent):
  if child.tag.endswith('metadata') or child.get('data-sensitive')=='true': parent.remove(child)
for n in r.iter():
 if n.tag.endswith('desc'): n.text='Synthetic redaction test after. The central region is blank. Fake sensitive markers removed; privacy approval still required.'
 if n.tag.endswith('title'): n.text='Synthetic redaction test after removal'
E.register_namespace('', 'http://www.w3.org/2000/svg')
E.ElementTree(r).write(p/'redaction-after.svg',encoding='unicode')
`],{cwd:root});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'mm-visual-chrome-'));
const proc=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let chromeStderr='';proc.stderr.on('data',d=>chromeStderr+=d);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try{
 for(let i=0;i<100&&!fs.existsSync(path.join(profile,'DevToolsActivePort'));i++) await pause(100);
 const [port]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n');
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let id=0;const pending=new Map();let events=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}else events.push(m)};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
 for(const method of ['Page.enable','Runtime.enable','Log.enable','Network.enable'])await send(method);
 const version=await send('Browser.getVersion');
 const inputs=[['demo/diagrams/demo-workflow.svg',1440,900],['demo/screenshots/synthetic-stub-mockup.svg',1200,900],['launch/assets/x-submission-key-visual.svg',1200,675],['examples/synthetic/redaction-before.svg',800,500],['examples/synthetic/redaction-after.svg',800,500]];
 let results=[];
 async function render(file,w,h,dest,wrapper=false){
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});events=[];
  let url=pathToFileURL(path.join(root,file)).href;
  if(wrapper){
   const html=`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#F4ECDD}img{width:100%;height:auto;display:block}</style><img alt="Draft visual preview" src="${url}">`;
   const temp=path.join(profile,'preview.html');fs.writeFileSync(temp,html);url=pathToFileURL(temp).href;
  }
  await send('Page.navigate',{url});
  for(let i=0;i<100;i++){const x=await send('Runtime.evaluate',{expression:'document.readyState',returnByValue:true});if(x.result.value==='complete')break;await pause(50)}
  await send('Runtime.evaluate',{expression:'document.fonts.ready',awaitPromise:true});await pause(150);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(dest,Buffer.from(shot.data,'base64'));
  const errors=events.filter(e=>e.method==='Runtime.exceptionThrown'||e.method==='Network.loadingFailed'||e.method==='Log.entryAdded'&&e.params.entry.level==='error');
  const requests=events.filter(e=>e.method==='Network.requestWillBeSent').map(e=>e.params.request.url).map(u=>u.startsWith('file:')?'local-file':u);
  const external=requests.filter(u=>u!=='local-file'&&!u.startsWith('data:'));
  if(errors.length||external.length)throw Error(JSON.stringify({file,errors,external}));
  const layout=await send('Runtime.evaluate',{expression:`JSON.stringify({scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth,images:[...document.images].map(i=>({complete:i.complete,width:i.naturalWidth}))})`,returnByValue:true});
  const result={file,output:dest,width:w,height:h,browserErrors:errors,requests,externalRequests:external,layout:JSON.parse(layout.result.value)};
  if(file.endsWith('.html')){
   const responsive=await send('Runtime.evaluate',{expression:`JSON.stringify((()=>{const i=document.querySelector('img'),f=document.querySelector('.mobile-flow'),m=document.querySelector('main');return {containerWidth:parseFloat(getComputedStyle(m).width),graphicDisplayed:getComputedStyle(i).display!=='none',graphicWidth:i.getBoundingClientRect().width,graphicMinimumEffectiveTextPx:22*i.getBoundingClientRect().width/1440,textDisplayed:getComputedStyle(f).display!=='none',textFontPx:parseFloat(getComputedStyle(f.querySelector('li')).fontSize),orderedLabels:[...f.querySelectorAll('li')].map(n=>n.textContent),graphicAlt:i.alt}})())`,returnByValue:true});
   result.responsive=JSON.parse(responsive.result.value);
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   const focus=await send('Runtime.evaluate',{expression:"JSON.stringify({tag:document.activeElement.tagName,name:document.activeElement.textContent,outline:getComputedStyle(document.activeElement).outlineStyle})",returnByValue:true});
   result.keyboard=JSON.parse(focus.result.value);
   const metrics=await send('Page.getLayoutMetrics');
   const full=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:w,height:Math.ceil(metrics.cssContentSize.height),scale:1}});
   result.fullPageOutput=w===390?`${out}/previews/deck-mobile-full.png`:dest.replace('.png','-full.png');
   fs.writeFileSync(result.fullPageOutput,Buffer.from(full.data,'base64'));
  }
  results.push(result);
 }
 for(const [f,w,h] of inputs)await render(f,w,h,f.replace('.svg','.png'));
 await render('launch/assets/x-submission-key-visual.svg',390,220,`${out}/previews/x-feed-390.png`,true);
 await render('demo/diagrams/demo-workflow.svg',960,600,`${out}/previews/workflow-presentation-960.png`,true);
 await render('demo/screenshots/synthetic-stub-mockup.svg',720,540,`${out}/previews/mockup-presentation-720.png`,true);
 await render('demo/deck/concept-overview.html',1440,1200,`${out}/previews/deck-presentation-1440.png`);
 for(const width of [600,601,768,1038,1039,1040])await render('demo/deck/concept-overview.html',width,900,`${out}/previews/deck-responsive-${width}.png`);
 await render('demo/deck/concept-overview.html',390,740,`${out}/previews/deck-mobile-390.png`);
 const keyboard=await send('Runtime.evaluate',{expression:"JSON.stringify({tag:document.activeElement.tagName,name:document.activeElement.textContent,outline:getComputedStyle(document.activeElement).outlineStyle})",returnByValue:true});
 // Browser screenshot before contains a fake PNG metadata canary. After is recreated
 // from pixel bytes, so no text chunks or EXIF are carried forward.
 execFileSync('python3',['-c',String.raw`
from pathlib import Path
from PIL import Image,PngImagePlugin
p=Path('examples/synthetic'); a=Image.open(p/'redaction-before.png'); info=PngImagePlugin.PngInfo();info.add_text('Comment','DUMMY_METADATA_CANARY_C3');a.save(p/'redaction-before.png',pnginfo=info)
a=Image.open(p/'redaction-after.png').convert('RGB');Image.frombytes('RGB',a.size,a.tobytes()).save(p/'redaction-after.png')
`]);
 const allArtifacts=[...inputs.flatMap(([f])=>[f,f.replace('.svg','.png')]),'demo/deck/concept-overview.html','launch/assets/x-submission-alt-text.md',...fs.readdirSync(`${out}/previews`).map(f=>`${out}/previews/${f}`)];
 const hashes=allArtifacts.map(f=>({path:f,sha256:createHash('sha256').update(fs.readFileSync(f)).digest('hex'),bytes:fs.statSync(f).size}));
 fs.writeFileSync(`${out}/browser-render-evidence.json`,JSON.stringify({evidenceType:'Executed local browser render; author verification, not independent approval',browser:version,node:process.version,python:execFileSync('python3',['--version'],{encoding:'utf8'}).trim(),pillow:execFileSync('python3',['-c','import PIL; print(PIL.__version__)'],{encoding:'utf8'}).trim(),command:'node tools/render_collateral.mjs',results,keyboard:JSON.parse(keyboard.result.value),hashes,consoleScope:'Page CDP events only. Chrome process stderr retained only locally; background browser messages are not page-console errors.',releaseApproval:'pending'},null,2)+'\n');
 console.log(`Rendered ${results.length} local browser views; page errors 0; external requests 0. Browser ${version.product}`);
}finally{ws?.close();proc.kill();await pause(200);fs.rmSync(profile,{recursive:true,force:true});}
