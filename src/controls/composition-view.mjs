/** Browser-safe closed projection. No code, URL, provider IDs or raw access
 * locators are accepted. Preview bytes use a separately authenticated endpoint. */
import { snapshotControlJson, canonical, validId, isRecord } from './schema.mjs';
const exact = (x, keys) => isRecord(x) && Object.keys(x).sort().join(',') === [...keys].sort().join(',');
const digest = x => typeof x === 'string' && /^sha256:[0-9a-f]{64}$/.test(x);
const deny = () => { throw new TypeError('Unsupported composition view'); };
const common = x => x.approval === false && x.purchase === false;
function layout(x) { return x === null || isRecord(x) && Object.keys(x).every(k=>['x_milli','y_milli','width_milli','height_milli'].includes(k)) &&
  ['x_milli','y_milli'].every(k=>Number.isSafeInteger(x[k])&&x[k]>=0&&x[k]<=1000) && ['width_milli','height_milli'].every(k=>x[k]===undefined||Number.isSafeInteger(x[k])&&x[k]>=1&&x[k]<=1000) &&
  (x.width_milli===undefined||x.x_milli+x.width_milli<=1000) && (x.height_milli===undefined||x.y_milli+x.height_milli<=1000); }
function size(x) { return x===null || exact(x,['value','unit']) && typeof x.value==='string' && /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(x.value) && Number(x.value)>0 && ['pt','px'].includes(x.unit); }
export function assertCompositionPreview(value) {
  const x=snapshotControlJson(value);
  if(!exact(x,['revision_id','revision_sha256','state_sha256','preview_id','preview_sha256','byte_length','mime_type','width_px','height_px']) ||
    !validId(x.revision_id)||!validId(x.preview_id)||!['revision_sha256','state_sha256','preview_sha256'].every(k=>digest(x[k])) ||
    !Number.isSafeInteger(x.byte_length)||x.byte_length<1||x.byte_length>25*1024*1024||!['image/png','image/jpeg','image/webp'].includes(x.mime_type)||
    !['width_px','height_px'].every(k=>Number.isSafeInteger(x[k])&&x[k]>0&&x[k]<=16384)||x.width_px*x.height_px>40000000)deny();
  return x;
}
export function assertCompositionProjection(value) {
  const x=snapshotControlJson(value);
  if(!exact(x,['contract','schema_version','base','categories','exact_controls','expires_at','approval','purchase','projection_sha256']) ||
    x.contract!=='CreativeCompositionControlProjection'||x.schema_version!=='creative-composition-controls/1.0'||!common(x)||!digest(x.projection_sha256)||!Number.isSafeInteger(x.expires_at)||
    !exact(x.base,['tenant_id','project_id','brief_id','composition_id','revision_id','revision_sha256','state_sha256','design_version_id','design_version_sha256','artwork_sha256','selection_revision','edit_policy_sha256','control_policy_sha256','preview_sha256']) ||
    !['tenant_id','project_id','brief_id','composition_id','revision_id','design_version_id'].every(k=>validId(x.base[k])) ||
    !['revision_sha256','state_sha256','design_version_sha256','artwork_sha256','edit_policy_sha256','control_policy_sha256','preview_sha256'].every(k=>digest(x.base[k])) || !Number.isSafeInteger(x.base.selection_revision)||x.base.selection_revision<1)deny();
  const opts={name_size:['small','medium','large'],layout:['centered','stacked'],logo_position:['top','bottom'],layout_emphasis:['balanced','name']};
  if(!Array.isArray(x.categories)||x.categories.length!==4)deny();
  for(const [i,field]of Object.keys(opts).entries()){
    const c=x.categories[i];if(!exact(c,['field','current_value','options','locked',...(field==='layout_emphasis'?['when','required']:[])])||c.field!==field||typeof c.locked!=='boolean'||canonical(c.options)!==canonical(opts[field])||c.current_value!==null&&!opts[field].includes(c.current_value)||
      field==='layout_emphasis'&&(!exact(c.when,['field','value'])||c.when.field!=='layout'||c.when.value!=='stacked'||c.required!==true))deny();
  }
  if(!exact(x.exact_controls,['text','text_size','layout','logo']))deny();
  for(const field of ['text','text_size','layout','logo']){
    const c=x.exact_controls[field];if(!exact(c,['layer_id','value','locked',...(field==='text'?['max_length']:field==='logo'?['asset_id']:field==='text_size'?['bounds']:[])])||!validId(c.layer_id)||typeof c.locked!=='boolean')deny();
    if(field==='text_size'&&(!exact(c.bounds,['min_value','max_value','units']) || !size({value:c.bounds.min_value,unit:'pt'}) || !size({value:c.bounds.max_value,unit:'pt'}) || Number(c.bounds.max_value)>1000 || Number(c.bounds.min_value)>Number(c.bounds.max_value) || !Array.isArray(c.bounds.units)||!c.bounds.units.length||c.bounds.units.some(x=>!['pt','px'].includes(x))||new Set(c.bounds.units).size!==c.bounds.units.length))deny();
    if(field==='text'&&(typeof c.value!=='string'||c.value.length>256||/[<>\u0000-\u001f\u007f]/.test(c.value)||!Number.isSafeInteger(c.max_length)||c.max_length<1||c.max_length>256))deny();
    if(field==='text_size'&&!size(c.value)||['layout','logo'].includes(field)&&!layout(c.value)||field==='logo'&&!validId(c.asset_id))deny();
  }
  return x;
}
export async function verifyCompositionProjectionHash(projection, subtle) {
  projection=assertCompositionProjection(projection);const body={...projection};delete body.projection_sha256;
  const bytes=await subtle.digest('SHA-256',new TextEncoder().encode(canonical(body)));
  return `sha256:${Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}`===projection.projection_sha256;
}
/** A review is a closed presentation of the trusted server's normalized plan.
 * Its digest and draft binding are verified separately before enabling Apply. */
export function assertCompositionDraftReview(value, projection, draft) {
  const x = snapshotControlJson(value); projection = assertCompositionProjection(projection); draft = snapshotControlJson(draft);
  if (!exact(x, ['contract','schema_version','projection_sha256','draft_sha256','changes','approval','purchase','review_sha256']) ||
      x.contract !== 'CreativeCompositionDraftReview' || x.schema_version !== '1.0' || !common(x) || !digest(x.draft_sha256) || !digest(x.review_sha256) ||
      x.projection_sha256 !== projection.projection_sha256 || !exact(draft, ['categories','exact']) || !isRecord(draft.categories) || !isRecord(draft.exact) ||
      !Array.isArray(x.changes) || x.changes.length < 1 || x.changes.length > 4) deny();
  const fields = { set_text:'text', set_text_size:'text_size', set_layer_layout:'layout', position_approved_logo:'logo' }, seen = new Set();
  const categoryFields = { name_size:'text_size', layout:'layout', logo_position:'logo', layout_emphasis:'layout' }, requested = new Set();
  for (const [field, value] of Object.entries(draft.categories)) {
    const category = projection.categories.find(c => c.field === field);
    if (!category || category.locked || !category.options.includes(value)) deny();
    if (value !== category.current_value) requested.add(categoryFields[field]);
  }
  for (const [field, value] of Object.entries(draft.exact)) {
    const control = projection.exact_controls[field];
    if (!control || control.locked) deny();
    if (canonical(value) !== canonical(control.value)) requested.add(field);
  }
  for (const change of x.changes) {
    const field = fields[change?.kind], control = projection.exact_controls[field];
    if (!exact(change, ['kind','layer_id','asset_id','before','after']) || !control || !requested.has(field) || control.locked || change.layer_id !== control.layer_id ||
        canonical(change.before) !== canonical(control.value) || seen.has(`${change.layer_id}:${field === 'logo' ? 'layout' : field}`) ||
        (field === 'logo' ? change.asset_id !== control.asset_id : change.asset_id !== null)) deny();
    seen.add(`${change.layer_id}:${field === 'logo' ? 'layout' : field}`);
    if (field === 'text' && (typeof change.after !== 'string' || !change.after.length || change.after.length > control.max_length || /[<>\u0000-\u001f\u007f]/.test(change.after)) ||
        field === 'text_size' && (!size(change.after) || change.after === null || !control.bounds.units.includes(change.after.unit) || Number(change.after.value) < Number(control.bounds.min_value) || Number(change.after.value) > Number(control.bounds.max_value)) ||
        ['layout','logo'].includes(field) && (change.after === null || !layout(change.after)) ||
        Object.hasOwn(draft.exact, field) && canonical(change.after) !== canonical(draft.exact[field]) || canonical(change.before) === canonical(change.after)) deny();
  }
  if (x.changes.length !== requested.size) deny();
  return x;
}
export function assertCompositionCurrent(value) {
  const x=snapshotControlJson(value);if(!common(x)||typeof x.ok!=='boolean')deny();
  if(x.ok&&x.status==='current'){
    if(!exact(x,['ok','status','projection','preview','approval','purchase']))deny();x.projection=assertCompositionProjection(x.projection);x.preview=assertCompositionPreview(x.preview);
    if(['revision_id','revision_sha256','state_sha256','preview_sha256'].some(k=>x.preview[k]!==x.projection.base[k]))deny();return x;
  }
  if(x.ok&&x.status==='not_initialized'){
    if(!exact(x,['ok','status','review','approval','purchase'])||!exact(x.review,['contract','schema_version','base','can_initialize','approval','purchase','review_sha256'])||
      x.review.contract!=='CreativeCompositionInitializationReview'||x.review.schema_version!=='1.0'||!common(x.review)||typeof x.review.can_initialize!=='boolean'||!digest(x.review.review_sha256)||
      !exact(x.review.base,['tenant_id','project_id','brief_id','brief_sha256','design_version_id','design_version_sha256','artwork_sha256','selection_revision'])||
      !['tenant_id','project_id','brief_id','design_version_id'].every(k=>validId(x.review.base[k]))||!['brief_sha256','design_version_sha256','artwork_sha256'].every(k=>digest(x.review.base[k]))||!Number.isSafeInteger(x.review.base.selection_revision)||x.review.base.selection_revision<1)deny();return x;
  }
  if(!x.ok&&['stale','unavailable'].includes(x.status)&&exact(x,['ok','status','code','approval','purchase'])&&['stale_version','unavailable','failed','integrity_error','permission_denied','scope_denied','conflict'].includes(x.code))return x;
  deny();
}
export function assertCompositionCompletion(value, action_id) {
  const x=snapshotControlJson(value);if(!common(x)||typeof x.ok!=='boolean'||x.action_id!==action_id||!validId(x.action_id))deny();
  if(x.ok&&x.status==='saved'){
    if(!exact(x,['ok','status','historical','action_id','backend_job_id','request_sha256','revision_id','revision_sha256','parent_revision_id','parent_revision_sha256','state_sha256','artwork_sha256','preview','approval','purchase'])||
      typeof x.historical!=='boolean'||!validId(x.backend_job_id)||!validId(x.revision_id)||!['request_sha256','revision_sha256','state_sha256','artwork_sha256'].every(k=>digest(x[k]))||
      (x.parent_revision_id===null?x.parent_revision_sha256!==null:!validId(x.parent_revision_id)||!digest(x.parent_revision_sha256)))deny();x.preview=assertCompositionPreview(x.preview);
    if(['revision_id','revision_sha256','state_sha256'].some(k=>x[k]!==x.preview[k]))deny();return x;
  }
  if(!x.ok&&['failed','stale','unknown','cancelled'].includes(x.status)&&Object.keys(x).every(k=>['ok','status','code','action_id','backend_job_id','approval','purchase'].includes(k))&&
      ['unavailable','stale_version','failed','conflict','cancelled','validation','invalid_request','unsupported_version','permission_denied','scope_denied','integrity_error'].includes(x.code)&& (x.backend_job_id===undefined||x.backend_job_id===null||validId(x.backend_job_id)))return x;
  deny();
}


/** Identity-only stale history never contains preview/access or approval claims. */
export function assertCompositionHistoryIdentity(value) {
  const x = snapshotControlJson(value);
  if (!exact(x, ['contract','schema_version','status','current','selection_compatibility','revisions','has_more','next_after_revision_id']) ||
      x.contract !== 'CreativeCompositionHistoryIdentity' || x.schema_version !== '1.0' || !['identity_only','not_initialized'].includes(x.status) ||
      !['current','changed','different_design','unavailable'].includes(x.selection_compatibility) || !Array.isArray(x.revisions) || x.revisions.length > 20 || typeof x.has_more !== 'boolean') deny();
  if (x.current !== null && (!exact(x.current, ['composition_id','revision_id','revision_sha256','design_version_id','design_version_sha256','selection_revision','updated_at']) ||
      !['composition_id','revision_id','design_version_id'].every(k => validId(x.current[k])) || !digest(x.current.revision_sha256) || !digest(x.current.design_version_sha256) ||
      !Number.isSafeInteger(x.current.selection_revision) || x.current.selection_revision < 1 || typeof x.current.updated_at !== 'string' || !Number.isFinite(Date.parse(x.current.updated_at)))) deny();
  if (x.status === 'not_initialized' ? x.current !== null || x.revisions.length > 0 || x.has_more : x.current === null) deny();
  const seen = new Set(); let previousTime = Infinity, previousId = '';
  for (const r of x.revisions) {
    if (!exact(r, ['revision_id','revision_sha256','parent_revision_id','parent_revision_sha256','design_version_id','design_version_sha256','created_at']) ||
        !validId(r.revision_id) || seen.has(r.revision_id) || !digest(r.revision_sha256) || !validId(r.design_version_id) || !digest(r.design_version_sha256) ||
        (r.parent_revision_id === null ? r.parent_revision_sha256 !== null : !validId(r.parent_revision_id) || !digest(r.parent_revision_sha256)) ||
        typeof r.created_at !== 'string' || !Number.isFinite(Date.parse(r.created_at)) || Date.parse(r.created_at) > previousTime ||
        Date.parse(r.created_at) === previousTime && r.revision_id < previousId ||
        x.current && (r.design_version_id !== x.current.design_version_id || r.design_version_sha256 !== x.current.design_version_sha256)) deny();
    seen.add(r.revision_id); previousTime = Date.parse(r.created_at); previousId = r.revision_id;
  }
  if (x.has_more ? !x.revisions.length || x.next_after_revision_id !== x.revisions.at(-1).revision_id : x.next_after_revision_id !== null) deny();
  return x;
}
export function assertCompositionHistory(value) {
  const x = snapshotControlJson(value);
  if (!common(x) || typeof x.ok !== 'boolean') deny();
  if (!x.ok && exact(x, ['ok','status','code','approval','purchase']) && x.status === 'unavailable' && ['stale_version','unavailable','permission_denied','scope_denied','failed','unsupported_version'].includes(x.code)) return x;
  if (!x.ok || !exact(x, ['ok','status','identity','review','approval','purchase'])) deny();
  x.identity = assertCompositionHistoryIdentity(x.identity); if (x.status !== x.identity.status) deny();
  if (x.review === null) { if (x.identity.current !== null) deny(); return x; }
  const r = x.review;
  if (!x.identity.current || !exact(r, ['contract','schema_version','base','can_renew','approval','purchase','review_sha256']) ||
      r.contract !== 'CreativeCompositionRenewalReview' || r.schema_version !== '1.0' || !common(r) || typeof r.can_renew !== 'boolean' || !digest(r.review_sha256) ||
      !exact(r.base, ['tenant_id','project_id','brief_id','brief_sha256','design_version_id','design_version_sha256','artwork_sha256','selection_revision','composition_id','current_revision_id','current_revision_sha256']) ||
      !['tenant_id','project_id','brief_id','design_version_id','composition_id','current_revision_id'].every(k => validId(r.base[k])) ||
      !['brief_sha256','design_version_sha256','artwork_sha256','current_revision_sha256'].every(k => digest(r.base[k])) || !Number.isSafeInteger(r.base.selection_revision) || r.base.selection_revision < 1 ||
      r.base.current_revision_id !== x.identity.current.revision_id || r.base.current_revision_sha256 !== x.identity.current.revision_sha256 || r.base.composition_id !== x.identity.current.composition_id ||
      r.base.design_version_id !== x.identity.current.design_version_id || r.base.design_version_sha256 !== x.identity.current.design_version_sha256 ||
      r.can_renew && !['current','changed'].includes(x.identity.selection_compatibility)) deny();
  return x;
}
