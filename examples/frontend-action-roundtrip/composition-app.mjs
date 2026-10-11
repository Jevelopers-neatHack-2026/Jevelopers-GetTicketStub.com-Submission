import { canonical, assertRenderableSchema, defaultDraft } from '/schema.mjs';
import { assertCompositionCurrent, assertCompositionCompletion, verifyCompositionProjectionHash } from '/composition-view.mjs';
import { projectApplyResult } from '/public-result.mjs';
const $=id=>document.getElementById(id), labels={name_size:'Name size',layout:'Layout',logo_position:'Approved logo position',layout_emphasis:'Stacked layout emphasis'};
let current, generation=0, sequence=0, observedTerminal=0, busy=false, previewReady=false, reviewed, action, styleSchema, styleReview, styleAction;
const urls=new Map(), storageKey='creative-composition-reviewed-action/1';
const hash=async value=>`sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),b=>b.toString(16).padStart(2,'0')).join('')}`;
const same=(a,b)=>canonical(a)===canonical(b);
async function api(path,body){const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error('Unavailable');return response.json();}
function live(g){return g===generation;}
function error(message,g= generation){if(!live(g))return;$('composition-error').textContent=message;$('composition-error').hidden=false;$('composition-error').focus();}
function counter(c){if(c&&['image_calls','jev_calls','reservations','composition_previews'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0))$('composition-counters').textContent=`Image calls: ${c.image_calls} · JEV calls: ${c.jev_calls} · Fixture reservations: ${c.reservations} · Composition previews: ${c.composition_previews}`;}
function invalidateReview() {reviewed=undefined;styleReview=undefined;$('apply-review').hidden=true;$('style-review').hidden=true;$('apply-style').hidden=true;$('review-draft').disabled=busy||!previewReady;$('composition-status').textContent='Draft changed. Review the new values before Apply.';}
function recoveryButtons(){const available=!!action;$('composition-retry').disabled=busy||!available;$('composition-lookup').disabled=!available;$('composition-cancel').disabled=!available||observedTerminal>0;}
function saveAction(a){const base=current?.projection?.base??current?.review?.base;if(!base)throw Error('No scope');action=a;sessionStorage.setItem(storageKey,canonical({scope:{tenant_id:base.tenant_id,project_id:base.project_id},action:{action_id:a.action_id,action_version:a.action_version}}));recoveryButtons();}
function restoreAction(){try{const stored=JSON.parse(sessionStorage.getItem(storageKey));const base=current?.projection?.base??current?.review?.base;
  if(stored&&base&&same(stored.scope,{tenant_id:base.tenant_id,project_id:base.project_id})&&typeof stored.action?.action_id==='string'&&/^action_[a-zA-Z0-9-]+$/.test(stored.action.action_id)&&['creative-composition-initialize/1.0','creative-composition-apply/1.0'].includes(stored.action.action_version)){action=stored.action;$('operation-status').textContent=`Existing reviewed action ${action.action_id}. Read or retry this identity to reconcile its outcome.`;}
}catch{/* Malformed local cache is not an execution instruction. */}recoveryButtons();}
function field(id,labelText,options,value,locked){const wrapper=document.createElement('div');wrapper.className='field';const label=document.createElement('label');label.htmlFor=id;label.textContent=labelText;const select=document.createElement('select');select.id=id;
 if(value===null){const option=document.createElement('option');option.value='';option.textContent='Current value is outside categorical choices';select.append(option);}
 for(const value of options){const option=document.createElement('option');option.value=value;option.textContent=value[0].toUpperCase()+value.slice(1);select.append(option);}select.value=value??'';select.disabled=locked;select.addEventListener('change',()=>{updateQuestion();invalidateReview();});wrapper.append(label,select);
 if(locked){const note=document.createElement('p');note.id=`${id}-locked`;note.textContent='Unavailable under the current trusted policy or layer lock.';note.className='hint';select.setAttribute('aria-describedby',note.id);wrapper.append(note);}return wrapper;}
function updateQuestion(){const q=$('category-layout_emphasis');if(q){q.closest('.field').hidden=$('category-layout').value!=='stacked';q.required=$('category-layout').value==='stacked';}}
function renderExact(){const mode=$('edit-mode').value,container=$('exact-fields');container.replaceChildren();container.hidden=mode==='categories';$('composition-categories').hidden=mode!=='categories';if(mode==='categories')return;
 const control=current.projection.exact_controls[mode];const inputs=mode==='text'?[['text','Name text','text',control.value]]:mode==='text_size'?[['size','Text size','text',control.value?.value??''],['unit','Text size unit','unit',control.value?.unit??'pt']]:[['x_milli','Horizontal position (0–1000)','number',control.value?.x_milli??''],['y_milli','Vertical position (0–1000)','number',control.value?.y_milli??''],['width_milli','Width (1–1000, optional)','number',control.value?.width_milli??''],['height_milli','Height (1–1000, optional)','number',control.value?.height_milli??'']];
 for(const[id,text,type,value]of inputs){const wrapper=document.createElement('div');wrapper.className='field';const label=document.createElement('label');label.htmlFor=`exact-${id}`;label.textContent=text;let input;
 if(type==='unit'){input=document.createElement('select');for(const unit of control.bounds.units){const option=document.createElement('option');option.value=unit;option.textContent=unit;input.append(option);}}
 else{input=document.createElement('input');input.type=type; if(type==='number'){input.min=id.startsWith('width')||id.startsWith('height')?'1':'0';input.max='1000';input.step='1';}else input.maxLength=mode==='text'?control.max_length:16;}
 input.id=`exact-${id}`;input.value=value;input.disabled=control.locked;input.required=!id.includes('width')&&!id.includes('height');input.addEventListener('input',invalidateReview);wrapper.append(label,input);container.append(wrapper);}
 if(mode==='text_size'){const note=document.createElement('p');note.className='hint';note.textContent=`Trusted size bounds: ${control.bounds.min_value}–${control.bounds.max_value} ${control.bounds.units.join(' or ')}.`;container.append(note);}
 if(control.locked){const note=document.createElement('p');note.textContent='Exact edit is locked or factual under the current owner policy.';container.append(note);}}
function draft(){const mode=$('edit-mode').value, result={categories:{},exact:{}};
 if(mode==='categories'){for(const c of current.projection.categories){if(c.field==='layout_emphasis')continue;const value=$(`category-${c.field}`).value;if(value&&value!==c.current_value)result.categories[c.field]=value;}
  if($('category-layout').value==='stacked'&&(result.categories.layout||$('category-layout_emphasis').value!==current.projection.categories.find(c=>c.field==='layout_emphasis').current_value)){result.categories.layout='stacked';result.categories.layout_emphasis=$('category-layout_emphasis').value;if(!result.categories.layout_emphasis)throw Error('Answer the required stacked layout question.');}}
 else if(mode==='text')result.exact.text=$('exact-text').value;
 else if(mode==='text_size')result.exact.text_size={value:$('exact-size').value,unit:$('exact-unit').value};
 else{const layout={};for(const id of ['x_milli','y_milli','width_milli','height_milli'])if($(`exact-${id}`).value!=='')layout[id]=Number($(`exact-${id}`).value);result.exact[mode]=layout;}
 return result;}
function clearImages(){for(const id of ['composition-artwork','composition-preview']){$(id).hidden=true;$(id).removeAttribute('src');if(urls.has(id)){URL.revokeObjectURL(urls.get(id));urls.delete(id);}}$('preview-status').textContent='';}
async function loadImage(id,path,expected,g){const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw Error('Preview denied');const mime=response.headers.get('content-type')?.split(';')[0];if(!['image/png','image/jpeg','image/webp'].includes(mime)||expected.mime_type&&mime!==expected.mime_type)throw Error('Invalid preview MIME');
 const reader=response.body.getReader(),chunks=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>25*1024*1024){await reader.cancel();throw Error('Preview exceeds limit');}chunks.push(value);}const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 if(expected.byte_length&&length!==expected.byte_length)throw Error('Preview length mismatch');const digest=`sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')}`;if(digest!==expected.sha256)throw Error('Preview hash mismatch');
 if(!live(g))return;const url=URL.createObjectURL(new Blob([bytes],{type:mime}));const image=$(id);const previous=urls.get(id);urls.set(id,url);
 try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});await image.decode();if(!live(g)||urls.get(id)!==url)return;
  if(expected.width_px&&image.naturalWidth!==expected.width_px||expected.height_px&&image.naturalHeight!==expected.height_px||image.naturalWidth<1||image.naturalHeight<1||image.naturalWidth>16384||image.naturalHeight>16384||image.naturalWidth*image.naturalHeight>40000000)throw Error('Preview dimensions mismatch');image.hidden=false;
 }finally{if(previous)URL.revokeObjectURL(previous);if(!live(g)||urls.get(id)!==url)URL.revokeObjectURL(url);}}
async function refresh(){const g=++generation,seq=++sequence;reviewed=undefined;styleReview=undefined;current=undefined;busy=false;previewReady=false;styleSchema=undefined;$('composition-style').disabled=true;$('review-style').disabled=true;$('composition-fields').disabled=false;$('apply-style').disabled=false;$('composition-identity').textContent='';clearImages();$('apply-review').hidden=true;$('composition-editor').hidden=true;$('initialization').hidden=true;$('composition-previews').hidden=true;$('initialize-reviewed').checked=false;$('initialize').disabled=true;$('composition-error').hidden=true;
 try{const raw=await api('/api/composition/current');if(!live(g))return;const view=assertCompositionCurrent(raw.view);if(view.status==='current'&&!await verifyCompositionProjectionHash(view.projection,crypto.subtle))throw Error('Projection mismatch');if(!live(g))return;current=view;counter(raw.counters);restoreAction();
  if(view.status==='not_initialized'){$('initialization').hidden=false;$('initialization-review').textContent=`Selected ${view.review.base.design_version_id} · artwork ${view.review.base.artwork_sha256} · selection ${view.review.base.selection_revision}`;$('initialize-reviewed').disabled=true;$('composition-status').textContent='Composition is not initialized. Explicit review and initialization are required.';$('composition-previews').hidden=false;const b=view.review.base;await loadImage('composition-artwork',`/api/artifact?design_version_id=${encodeURIComponent(b.design_version_id)}`,{sha256:b.artwork_sha256},g);if(!live(g))return;previewReady=true;$('composition-artwork-caption').textContent=`Immutable selected artwork ${b.artwork_sha256}`;$('composition-preview-caption').textContent='Composition is not initialized.';$('preview-status').textContent='Selected artwork bytes verified, loaded and decoded. No composition preview exists.';$('initialize-reviewed').disabled=!view.review.can_initialize;}
  else if(view.status==='current'){$('composition-editor').hidden=false;$('composition-categories').replaceChildren();for(const c of view.projection.categories)$('composition-categories').append(field(`category-${c.field}`,labels[c.field],c.options,c.current_value,c.locked));updateQuestion();renderExact();$('review-draft').disabled=true;
   $('composition-identity').textContent=`Current ${view.projection.base.revision_id} · full revision ${view.projection.base.revision_sha256} · state ${view.projection.base.state_sha256}`;$('composition-status').textContent='Current composition loaded. Draft changes require a separate reviewed Apply.';$('composition-previews').hidden=false;
   const p=view.preview,b=view.projection.base;await Promise.all([loadImage('composition-preview',`/api/composition/preview?revision_id=${encodeURIComponent(p.revision_id)}&revision_sha256=${encodeURIComponent(p.revision_sha256)}&preview_sha256=${encodeURIComponent(p.preview_sha256)}`,{...p,sha256:p.preview_sha256},g),loadImage('composition-artwork',`/api/artifact?design_version_id=${encodeURIComponent(b.design_version_id)}`,{sha256:b.artwork_sha256},g)]);if(!live(g))return;
   previewReady=true;$('composition-artwork-caption').textContent=`Immutable artwork ${b.artwork_sha256}`;$('composition-preview-caption').textContent=`MOCK composition ${p.revision_id} · exact preview ${p.preview_sha256}`;$('preview-status').textContent='Both exact byte hashes verified; both images loaded and decoded with valid dimensions.';
  }else{$('composition-status').textContent=view.status==='stale'?'Composition authority is stale. Read identity-only history and review an explicit renewal when its producer is available. Old drafts cannot Apply.':'Current composition unavailable. No current preview authority claimed.';}
  const old=await api('/api/schema');if(!live(g))return;styleSchema=assertRenderableSchema(old.schema);const style=styleSchema.controls.find(c=>c.id==='c04');$('composition-style').disabled=!style||style.locked;$('composition-style').value=style?.default_value??'calm';$('review-style').disabled=!style||style.locked;restoreStyleAction();
 }catch{if(live(g))error('Current composition or exact preview unavailable. Refresh to recheck current authority.',g);}finally{if(live(g)&&seq<=sequence)recoveryButtons();}}
function completion(raw,a,g,seq){if(!live(g)||action?.action_id!==a.action_id)return;const result=assertCompositionCompletion(raw.result,a.action_id);if(observedTerminal>0&&result.status==='unknown')return;counter(raw.counters);
 if(result.ok){observedTerminal=Math.max(observedTerminal,sequence);$('operation-status').textContent=`${result.historical?'Historical completion recovered':'Composition saved'}: ${result.revision_id} · ${result.revision_sha256}. Refresh current state separately; no approval or purchase created.`;}
 else{$('operation-status').textContent=`Existing action ${a.action_id}: ${result.status}. ${result.code==='stale_version'?'Refresh and review fresh authority before a new Apply.':'Reconcile this identity before requesting another operation.'}`;if(result.status!=='unknown')observedTerminal=Math.max(observedTerminal,sequence);}recoveryButtons();}
async function invoke(path,body){if(busy&&path==='/api/composition/apply')return;const g=generation,seq=++sequence,a=action;if(!a)return;busy=true;recoveryButtons();$('composition-fields').disabled=true;
 try{const raw=await api(path,body);if(!live(g)||action?.action_id!==a.action_id)return;if(path==='/api/composition/cancel'){$('operation-status').textContent=`Cancellation requested for ${a.action_id}. Read existing operation for its authoritative outcome.`;}else completion(raw,a,g,seq);}
 catch{if(live(g)&&action?.action_id===a.action_id&&seq>observedTerminal)error('Response unavailable. Read or retry the persisted action identity; its outcome remains unknown.',g);}
 finally{if(live(g)&&action?.action_id===a.action_id){busy=false;$('composition-fields').disabled=false;recoveryButtons();}}}
$('composition-refresh').addEventListener('click',refresh);
$('initialize-reviewed').addEventListener('change',()=>{$('initialize').disabled=!previewReady||!$('initialize-reviewed').checked||!current?.review?.can_initialize;});
$('initialize').addEventListener('click',()=>{if(!previewReady||!current?.review||!$('initialize-reviewed').checked)return;observedTerminal=0;saveAction({action_version:'creative-composition-initialize/1.0',action_id:`action_${crypto.randomUUID()}`,review_sha256:current.review.review_sha256,intent:'initialize'});invoke('/api/composition/apply',action);});
$('edit-mode').addEventListener('change',()=>{renderExact();invalidateReview();});
$('composition-form').addEventListener('submit',e=>{e.preventDefault();try{if(busy||!previewReady||current?.status!=='current')return;const proposed=draft();reviewed={projection_sha256:current.projection.projection_sha256,draft:proposed};$('review-summary').textContent=`Proposed values: ${canonical(proposed)}. Exact text, size, layout or approved-logo instructions only. Artwork stays unchanged.`;$('review-binding').textContent=`Review binding ${current.projection.base.revision_sha256} · policy ${current.projection.base.control_policy_sha256}`;$('apply-review').hidden=false;$('composition-apply').focus();}catch{error('Complete the required draft fields before review.');}});
$('composition-apply').addEventListener('click',()=>{if(!previewReady||!reviewed||reviewed.projection_sha256!==current?.projection?.projection_sha256)return;observedTerminal=0;saveAction({action_version:'creative-composition-apply/1.0',action_id:`action_${crypto.randomUUID()}`,intent:'apply',...structuredClone(reviewed)});reviewed=undefined;$('apply-review').hidden=true;invoke('/api/composition/apply',action);});
$('composition-retry').addEventListener('click',()=>invoke('/api/composition/retry',{action_id:action?.action_id}));$('composition-lookup').addEventListener('click',()=>invoke('/api/composition/lookup',{action_id:action?.action_id}));$('composition-cancel').addEventListener('click',()=>invoke('/api/composition/cancel',{action_id:action?.action_id}));
$('review-style').addEventListener('click',()=>{const value=$('composition-style').value,old=styleSchema?.controls.find(c=>c.id==='c04');if(!old||old.locked||value===old.default_value)return;styleReview={value,schema:structuredClone(styleSchema)};$('style-review').textContent=`Review artwork style ${value} against ${styleSchema.expected_versions.design}. One eligible artwork edit creates new bytes and requires a fresh composition context. Usage and cost depend on the provider; this fixture is simulated.`;$('style-review').hidden=false;$('apply-style').hidden=false;$('apply-style').focus();});
$('composition-style').addEventListener('change',()=>{styleReview=undefined;$('style-review').hidden=true;$('apply-style').hidden=true;});
const styleStorageKey = 'creative-artwork-reviewed-action/1';
function restoreStyleAction() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(styleStorageKey));
    if (cached && styleSchema && same(cached.scope, { tenant_id:styleSchema.tenant_id, project_id:styleSchema.project_id }) && /^style_[a-zA-Z0-9-]+$/.test(cached.action_id)) {
      const restoring = styleAction !== cached.action_id; styleAction = cached.action_id;
      if (restoring) $('style-status').textContent = `Existing artwork action ${styleAction}. Read or retry its identity before requesting another edit.`;
    }
  } catch { /* A malformed local cache is never authority. */ }
  $('retry-style').disabled = !styleAction; $('lookup-style').disabled = !styleAction;
}
async function submitStyle(path, body) {
  if (busy || !styleAction) return;
  const g = generation, identity = styleAction; busy = true; $('apply-style').disabled = true; $('retry-style').disabled = true;
  $('style-status').textContent = `Artwork action ${identity} is pending. Reconcile this identity before another edit.`;
  try {
    const raw = await api(path, body); if (!live(g) || identity !== styleAction) return;
    const result = projectApplyResult(raw);
    if (result.ok && result.result?.design_version) {
      $('style-status').textContent = `Saved artwork ${result.result.design_version.design_version_id}. Review its current composition separately; no approval or purchase created.`;
      if (path !== '/api/artwork/status') await refresh();
    } else $('style-status').textContent = `Existing artwork action ${identity}: ${result.status ?? 'unknown'}. Read or retry this identity before requesting another edit.`;
  } catch { if (live(g) && identity === styleAction) error('Artwork response unavailable. Read or retry the saved artwork action identity; do not request another edit.', g); }
  finally { if (live(g) && identity === styleAction) { busy = false; $('apply-style').disabled = false; $('retry-style').disabled = false; $('lookup-style').disabled = false; } }
}
$('apply-style').addEventListener('click', async () => {
  if (!styleReview || busy) return;
  const g=generation, review=structuredClone(styleReview), schema=review.schema, d=defaultDraft(schema);
  d.selections.c04=review.value;
  const body={action_version:`creative-apply/${schema.schema_version.split('/')[1]}`,schema_version:schema.schema_version,
    action_id:`style_${crypto.randomUUID()}`,tenant_id:schema.tenant_id,project_id:schema.project_id,brief_id:schema.brief_id,
    expected_versions:schema.expected_versions,intent:'apply',draft:d,control_schema_hash:await hash(schema),draft_hash:(await hash(d)).slice(7)};
  if(!live(g)||!styleReview||!same(styleReview,review))return;
  styleAction=body.action_id;
  sessionStorage.setItem(styleStorageKey,canonical({scope:{tenant_id:schema.tenant_id,project_id:schema.project_id},action_id:styleAction}));
  styleReview=undefined; $('style-review').hidden=true; $('apply-style').hidden=true;
  submitStyle('/api/apply',body);
});
$('retry-style').addEventListener('click',()=>submitStyle('/api/artwork/retry',{action_id:styleAction}));
$('lookup-style').addEventListener('click',()=>submitStyle('/api/artwork/status',{action_id:styleAction}));
$('composition-history-refresh').addEventListener('click',()=>{$('composition-history-status').textContent='Identity-only history and explicit renewal require the frozen API1.3 producer. No revision, preview, approval or purchase was created by this read.';});
refresh();
