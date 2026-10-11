import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const counts=async request=>(await request.get('/api/counters')).json();
async function refresh(page,expected){const response=page.waitForResponse('**/api/composition/current');await page.getByRole('button',{name:'Refresh current composition',exact:true}).click();const view=(await(await response).json()).view;expect(view.status).toBe('current');if(expected)expect(view.projection.base.revision_sha256).toBe(expected.revision_sha256);await expect(page.locator('#preview-status')).toContainText('Both exact byte hashes verified');}
async function initialize(page){await expect(page.locator('#composition-status')).toContainText('not initialized');await page.getByLabel('I reviewed the selected artwork and initialization binding.').check();const response=page.waitForResponse('**/api/composition/apply');await page.getByRole('button',{name:'Initialize reviewed composition'}).click();const result=(await(await response).json()).result;expect(result.ok).toBe(true);await expect(page.locator('#operation-status')).toContainText(result.revision_id);await refresh(page,result);}
async function apply(page){await page.getByRole('button',{name:'Review draft',exact:true}).click();await expect(page.getByRole('button',{name:'Apply reviewed composition',exact:true})).toBeFocused();const response=page.waitForResponse('**/api/composition/apply');await page.keyboard.press('Enter');const result=(await(await response).json()).result;expect(result.ok).toBe(true);await expect(page.locator('#operation-status')).toContainText(result.revision_id);await refresh(page,result);}
test.beforeEach(async({page,request})=>{await request.post('/__fixture/reset',{data:{lock_logo:false}});await page.goto('/composition.html');});
test('keyboard reviewed initialization then all categorical options and q01 produce real exact previews, axe and screenshot',async({page,request},info)=>{
  const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  await expect(page.getByRole('button',{name:'Initialize reviewed composition'})).toBeDisabled();expect(await counts(request)).toMatchObject({image_calls:0,jev_calls:0,reservations:0,composition_previews:0});
  await initialize(page);const initial=(await(await request.get('/api/composition/current')).json()).view.projection.base;
  for(const field of ['name_size','layout','logo_position'])expect(await page.locator(`#category-${field}`).isVisible()).toBe(true);
  for(const value of ['small','large','medium']){await page.getByLabel('Name size',{exact:true}).focus();await page.keyboard.press(value==='small'?'s':value==='large'?'l':'m');const before=await counts(request);await expect(page.getByRole('button',{name:'Review draft',exact:true})).toBeEnabled();expect(await counts(request)).toEqual(before);await apply(page);await expect(page.getByLabel('Name size',{exact:true})).toHaveValue(value);}
  await page.getByLabel('Layout',{exact:true}).focus();await page.keyboard.press('s');await expect(page.getByLabel('Stacked layout emphasis')).toBeVisible();await page.getByLabel('Stacked layout emphasis').selectOption('balanced');await apply(page);
  await page.getByLabel('Stacked layout emphasis').focus();await page.keyboard.press('n');await apply(page);await expect(page.getByLabel('Stacked layout emphasis')).toHaveValue('name');
  await page.getByLabel('Layout',{exact:true}).selectOption('centered');await apply(page);await expect(page.getByLabel('Stacked layout emphasis')).toBeHidden();
  for(const value of ['bottom','top']){await page.getByLabel('Approved logo position',{exact:true}).selectOption(value);await apply(page);await expect(page.getByLabel('Approved logo position',{exact:true})).toHaveValue(value);}
  const final=(await(await request.get('/api/composition/current')).json()).view.projection.base;expect(final.artwork_sha256).toBe(initial.artwork_sha256);expect(final.design_version_id).toBe(initial.design_version_id);expect(final.revision_sha256).not.toBe(initial.revision_sha256);
  expect(await counts(request)).toMatchObject({image_calls:0,jev_calls:0,reservations:0,composition_previews:8});
  expect(await page.locator('#composition-preview').evaluate(i=>i.complete&&i.naturalWidth===128&&i.naturalHeight===128)).toBe(true);expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath('categorical-composition.png'),fullPage:true});expect(posts.filter(x=>x.endsWith('/api/composition/apply'))).toHaveLength(9);
});
for(const[kind,input]of [['text',{text:'Taylor Sample'}],['text_size',{size:'31.125',unit:'px'}],['layout',{x_milli:'150',y_milli:'230',width_milli:'650',height_milli:'120'}],['logo',{x_milli:'60',y_milli:'790',width_milli:'130',height_milli:'130'}]])test(`exact ${kind} keyboard Apply, loaded image, reload and identical retry`,async({page,request},info)=>{
  await initialize(page);const old=(await(await request.get('/api/composition/current')).json()).view;await page.getByLabel('Edit mode').selectOption(kind);
  for(const[id,value]of Object.entries(input)){if(id==='unit')await page.locator(`#exact-${id}`).selectOption(value);else await page.locator(`#exact-${id}`).fill(value);}
  const unchanged=await counts(request);await page.getByRole('button',{name:'Review draft',exact:true}).focus();await page.keyboard.press('Enter');expect(await counts(request)).toEqual(unchanged);const response=page.waitForResponse('**/api/composition/apply');await page.keyboard.press('Enter');const result=(await(await response).json()).result;expect(result.ok).toBe(true);expect(result.parent_revision_sha256).toBe(old.projection.base.revision_sha256);await expect(page.locator('#operation-status')).toContainText(result.revision_id);await refresh(page,result);
  const saved=(await(await request.get('/api/composition/current')).json()).view;expect(saved.preview.preview_sha256).not.toBe(old.preview.preview_sha256);expect(saved.projection.base.artwork_sha256).toBe(old.projection.base.artwork_sha256);expect(saved.projection.base.revision_sha256).not.toBe(old.projection.base.revision_sha256);
  await page.reload();await expect(page.locator('#preview-status')).toContainText('Both exact byte hashes verified');await page.getByRole('button',{name:'Read existing operation'}).click();await expect(page.locator('#operation-status')).toContainText('Historical completion recovered');await page.getByRole('button',{name:'Retry existing Apply'}).click();await expect(page.locator('#operation-status')).toContainText('Historical completion recovered');expect(await counts(request)).toMatchObject({composition_previews:1,image_calls:0,jev_calls:0,reservations:0});
  await page.screenshot({path:info.outputPath(`exact-${kind}.png`),fullPage:true});
});
test('lost HTTP completion reconciles one saved revision after reload; mismatched preview and stale authority fail closed',async({page,request})=>{
  await initialize(page);await page.getByLabel('Name size',{exact:true}).selectOption('large');await page.getByRole('button',{name:'Review draft',exact:true}).click();
  await page.route('**/api/composition/apply',async route=>{await route.fetch();await route.abort();},{times:1});await page.getByRole('button',{name:'Apply reviewed composition',exact:true}).click();await expect(page.locator('#composition-error')).toContainText('Response unavailable');
  await page.reload();await expect(page.locator('#preview-status')).toContainText('Both exact byte hashes verified');await page.getByRole('button',{name:'Read existing operation'}).click();await expect(page.locator('#operation-status')).toContainText('Historical completion recovered');expect(await counts(request)).toMatchObject({composition_previews:1});
  await request.post('/__fixture/state',{data:{advance_ms:60001}});await page.getByRole('button',{name:'Refresh current composition',exact:true}).click();await expect(page.locator('#composition-status')).toContainText('authority is stale');await expect(page.locator('#composition-preview')).toBeHidden();await expect(page.locator('#composition-editor')).toBeHidden();
});
test('revoked permissions and locked logo never complete Apply, hostile view extras never render',async({page,request})=>{
  await request.post('/__fixture/reset',{data:{lock_logo:true}});await page.goto('/composition.html');await initialize(page);await expect(page.getByLabel('Approved logo position',{exact:true})).toBeDisabled();
  await page.getByLabel('Name size',{exact:true}).selectOption('large');await page.getByRole('button',{name:'Review draft',exact:true}).click();await request.post('/__fixture/state',{data:{revoke:true}});await page.getByRole('button',{name:'Apply reviewed composition',exact:true}).click();await expect(page.locator('#operation-status')).not.toContainText('Composition saved');expect(await counts(request)).toMatchObject({composition_previews:0,image_calls:0});
  await page.route('**/api/composition/current',async route=>{const response=await route.fetch(),data=await response.json();data.view.script='<script>attack()</script>';await route.fulfill({response,json:data});},{times:1});
  const rejected=page.waitForResponse('**/api/composition/current');await page.getByRole('button',{name:'Refresh current composition',exact:true}).click();await rejected;
  await expect(page.locator('#composition-error')).toContainText('exact preview unavailable');await expect(page.locator('#composition-editor')).toBeHidden();
});

test('both original artwork styles use genuine parent edits; lost response recovers one immutable child with opaque cache',async({page,request},info)=>{
  await initialize(page);const original=(await(await request.get('/api/history')).json()).selection;
  await page.getByLabel('Artwork style',{exact:true}).selectOption('vibrant');await page.getByRole('button',{name:'Review artwork style',exact:true}).click();expect(await counts(request)).toMatchObject({image_calls:0,reservations:0});
  await page.route('**/api/apply',async route=>{await route.fetch();await route.abort();},{times:1});await page.getByRole('button',{name:'Apply reviewed artwork style',exact:true}).click();await expect(page.locator('#composition-error')).toContainText('Artwork response unavailable');
  await page.reload();await expect(page.locator('#composition-status')).toContainText('not initialized');await page.getByRole('button',{name:'Read existing artwork style operation',exact:true}).click();await expect(page.locator('#style-status')).toContainText('Saved artwork');
  const cached=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('creative-artwork-reviewed-action/1')));expect(Object.keys(cached).sort()).toEqual(['action_id','scope']);
  const history=(await(await request.get('/api/history')).json()).result.items;const child=history.find(x=>x.parent_version_id===original.design_version_id);expect(child).toBeTruthy();expect(child.artifact.content_hash).not.toBe(history.find(x=>x.design_version_id===original.design_version_id).artifact.content_hash);
  await page.getByRole('button',{name:'Retry existing artwork style Apply',exact:true}).click();await expect(page.locator('#style-status')).toContainText('Saved artwork');expect(await counts(request)).toMatchObject({image_calls:1,jev_calls:0,reservations:1});
  await page.getByLabel('Artwork style',{exact:true}).selectOption('calm');await page.getByRole('button',{name:'Review artwork style',exact:true}).click();const secondResponse=page.waitForResponse('**/api/apply');await page.getByRole('button',{name:'Apply reviewed artwork style',exact:true}).click();const second=await(await secondResponse).json();expect(second.ok).toBe(true);expect(second.result.design_version.parent_version_id).toBe(child.design_version_id);expect(second.result.design_version.design_version_id).not.toBe(child.design_version_id);expect(second.result.design_version.artifact.content_hash).not.toBe(child.artifact.content_hash);await expect(page.locator('#style-status')).toContainText(second.result.design_version.design_version_id);await expect(page.locator('#composition-status')).toContainText('not initialized');expect((await(await request.get('/api/history')).json()).selection.design_version_id).toBe(second.result.design_version.design_version_id);expect(await counts(request)).toMatchObject({image_calls:2,jev_calls:0,reservations:2});
  await initialize(page);await page.screenshot({path:info.outputPath('post-style-fresh-composition.png'),fullPage:true});
});

test('delayed old current success and error cannot replace a refreshed stale context or steal focus',async({page,request})=>{
  await initialize(page);let release,entered;const blocked=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  await page.route('**/api/composition/current',async route=>{const response=await route.fetch();entered();await blocked;await route.fulfill({response});},{times:1});
  await page.getByRole('button',{name:'Refresh current composition',exact:true}).click();await started;await request.post('/__fixture/state',{data:{advance_ms:60001}});
  await page.getByRole('button',{name:'Refresh current composition',exact:true}).click();await expect(page.locator('#composition-status')).toContainText('authority is stale');
  await page.getByRole('button',{name:'Read composition history',exact:true}).focus();release();await page.waitForLoadState('networkidle');await expect(page.locator('#composition-status')).toContainText('authority is stale');await expect(page.locator('#composition-preview')).toBeHidden();await expect(page.getByRole('button',{name:'Read composition history',exact:true})).toBeFocused();
});

test('changed preview bytes and caller-supplied scope reject without current image or dispatched edit',async({page,request})=>{
  await initialize(page);await page.route('**/api/composition/preview?**',async route=>{const response=await route.fetch(),bytes=await response.body();bytes[bytes.length-1]^=1;await route.fulfill({response,body:bytes});},{times:1});
  await page.getByRole('button',{name:'Refresh current composition',exact:true}).click();await expect(page.locator('#composition-error')).toContainText('exact preview unavailable');await expect(page.locator('#composition-preview')).toBeHidden();
  await refresh(page);await page.getByLabel('Name size',{exact:true}).selectOption('large');await page.getByRole('button',{name:'Review draft',exact:true}).click();
  await page.route('**/api/composition/apply',route=>{const body=route.request().postDataJSON();return route.continue({postData:JSON.stringify({...body,tenant_id:'forged'})});},{times:1});await page.getByRole('button',{name:'Apply reviewed composition',exact:true}).click();await expect(page.locator('#operation-status')).toContainText('failed');expect(await counts(request)).toMatchObject({composition_previews:0,image_calls:0,reservations:0});
});


async function renew(page) {
  await page.getByRole('button',{name:'Read composition history',exact:true}).click();
  await expect(page.locator('#composition-history-status')).toContainText('Identity-only history');
  await page.getByRole('button',{name:'Review fresh authority renewal',exact:true}).click();
  await expect(page.getByRole('button',{name:'Apply reviewed authority renewal',exact:true})).toBeFocused();
  const response=page.waitForResponse('**/api/composition/apply');await page.keyboard.press('Enter');const result=(await(await response).json()).result;expect(result.ok).toBe(true);await expect(page.locator('#composition-identity')).toContainText(result.revision_sha256);
  await expect(page.locator('#preview-status')).toContainText('Both exact byte hashes verified');
}

test('expired current preview stays hidden; metadata history and explicit keyboard renewal require a new reviewed Apply',async({page,request},info)=>{
  await initialize(page);const old=(await(await request.get('/api/composition/current')).json()).view.projection.base;
  await page.getByLabel('Name size',{exact:true}).selectOption('large');await page.getByRole('button',{name:'Review draft',exact:true}).click();
  await request.post('/__fixture/state',{data:{advance_ms:60001}});await page.getByRole('button',{name:'Refresh current composition',exact:true}).click();await expect(page.locator('#composition-status')).toContainText('authority is stale');await expect(page.locator('#composition-preview')).toBeHidden();await expect(page.locator('#apply-review')).toBeHidden();
  const before=await counts(request);const history=(await(await request.get('/api/composition/history')).json()).view;expect(JSON.stringify(history)).not.toContain('preview');expect(history.identity.current.revision_sha256).toBe(old.revision_sha256);expect(await counts(request)).toEqual(before);
  await renew(page);const fresh=(await(await request.get('/api/composition/current')).json()).view;expect(fresh.projection.base.revision_sha256).not.toBe(old.revision_sha256);expect(fresh.projection.base.artwork_sha256).toBe(old.artwork_sha256);await expect(page.locator('#apply-review')).toBeHidden();await expect(page.getByLabel('Name size',{exact:true})).toHaveValue('medium');
  expect(await counts(request)).toMatchObject({image_calls:0,jev_calls:0,reservations:0,composition_previews:1,composition_revalidations:1});
  await page.getByLabel('Name size',{exact:true}).selectOption('large');await apply(page);expect(await counts(request)).toMatchObject({composition_previews:2,composition_revalidations:1});
  await page.getByRole('button',{name:'Read composition history',exact:true}).click();await expect(page.locator('#composition-history li')).toHaveCount(3);expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);await page.screenshot({path:info.outputPath('renewed-history-fresh-apply.png'),fullPage:true});
});

test('public same-design restore changes selection, keeps history identity, and requires explicit fresh renewal',async({page,request})=>{
  await initialize(page);const selected=(await(await request.get('/api/history')).json()).selection;
  const restored=(await(await request.post('/api/restore',{data:{design_version_id:selected.design_version_id,expected_selection_revision:selected.revision,action_id:'browser-same-design-restore'}})).json());expect(restored.ok).toBe(true);
  await page.getByRole('button',{name:'Refresh current composition',exact:true}).click();await expect(page.locator('#composition-status')).toContainText('authority is stale');
  await page.getByRole('button',{name:'Read composition history',exact:true}).click();await expect(page.locator('#composition-history-status')).toContainText('Selection compatibility: changed');await expect(page.locator('#composition-preview')).toBeHidden();
  await renew(page);expect(await counts(request)).toMatchObject({image_calls:0,jev_calls:0,reservations:0,composition_previews:1,composition_revalidations:1});await expect(page.locator('#apply-review')).toBeHidden();
});

test('pending composition cancellation is authoritative and read-only status never duplicates work',async({page,request})=>{
  await initialize(page);const old=(await(await request.get('/api/composition/current')).json()).view.projection.base;
  await page.getByLabel('Name size',{exact:true}).selectOption('large');await page.getByRole('button',{name:'Review draft',exact:true}).click();
  await request.post('/__fixture/state',{data:{block:'composition-preview'}});const applyResponse=page.waitForResponse('**/api/composition/apply');await page.getByRole('button',{name:'Apply reviewed composition',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cancel existing operation',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Read existing operation',exact:true}).click();await expect(page.locator('#operation-status')).toContainText('unknown');expect(await counts(request)).toMatchObject({composition_previews:0,image_calls:0});
  await page.getByRole('button',{name:'Cancel existing operation',exact:true}).click();await expect(page.locator('#operation-status')).toContainText('cancelled');
  await request.post('/__fixture/state',{data:{release:true}});const result=(await(await applyResponse).json()).result;expect(result.ok).toBe(false);await refresh(page);
  expect((await(await request.get('/api/composition/current')).json()).view.projection.base.revision_sha256).toBe(old.revision_sha256);expect(await counts(request)).toMatchObject({composition_previews:1,image_calls:0,jev_calls:0,reservations:0});const completed=await counts(request);await page.getByRole('button',{name:'Read existing operation',exact:true}).click();await expect(page.locator('#operation-status')).toContainText('cancelled');expect(await counts(request)).toEqual(completed);
});


test('lost renewal response reconciles the same durable child after reload without another preview or renewal',async({page,request})=>{
  await initialize(page);await request.post('/__fixture/state',{data:{advance_ms:60001}});await page.getByRole('button',{name:'Refresh current composition',exact:true}).click();await expect(page.locator('#composition-status')).toContainText('authority is stale');
  await page.getByRole('button',{name:'Read composition history',exact:true}).click();await expect(page.getByRole('button',{name:'Review fresh authority renewal',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Review fresh authority renewal',exact:true}).click();
  await page.route('**/api/composition/apply',async route=>{await route.fetch();await route.abort();},{times:1});await page.getByRole('button',{name:'Apply reviewed authority renewal',exact:true}).click();await expect(page.locator('#composition-error')).toContainText('Response unavailable');await expect(page.locator('#review-draft')).toBeDisabled();await expect(page.locator('#composition-editor')).toBeHidden();
  await page.reload();await expect(page.locator('#operation-status')).toContainText('Historical completion recovered');await expect(page.locator('#preview-status')).toContainText('Both exact byte hashes verified');await page.getByRole('button',{name:'Retry existing Apply',exact:true}).click();await expect(page.locator('#operation-status')).toContainText('Historical completion recovered');expect(await counts(request)).toMatchObject({composition_previews:1,composition_revalidations:1,image_calls:0,jev_calls:0,reservations:0});
  const cache=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('creative-composition-reviewed-action/1')));expect(Object.keys(cache).sort()).toEqual(['action','scope']);expect(Object.keys(cache.action).sort()).toEqual(['action_id','action_version']);
});


test('invalid version, changed identity and actual alternate MOCK principals cannot dispatch another child',async({page,request})=>{
  await initialize(page);let reviewed;
  await page.route('**/api/composition/apply',async route=>{reviewed=route.request().postDataJSON();const first=await route.fetch(),replay=await route.fetch();const a=(await first.json()).result,b=(await replay.json()).result;expect(a.ok).toBe(true);expect(b.revision_sha256).toBe(a.revision_sha256);await route.fulfill({response:first});},{times:1});
  await page.getByLabel('Name size',{exact:true}).selectOption('large');await apply(page);expect(await counts(request)).toMatchObject({composition_previews:1});
  const changed=structuredClone(reviewed);changed.draft.categories.name_size='small';expect((await(await request.post('/api/composition/apply',{data:changed})).json()).result.code).toBe('conflict');
  const unknown={...reviewed,action_id:'browser-unknown-version',action_version:'creative-composition-apply/2.0'};expect((await(await request.post('/api/composition/apply',{data:unknown})).json()).result.code).toBe('unsupported_version');
  for(const principal of ['other-tenant','other-actor']){
    const denied=(await(await request.post('/api/composition/apply',{data:reviewed,headers:{'x-mock-controls-principal':principal}})).json()).result;expect(denied.ok).toBe(false);
    const status=(await(await request.post('/api/composition/lookup',{data:{action_id:reviewed.action_id},headers:{'x-mock-controls-principal':principal}})).json()).result;expect(status).toBeNull();
  }
  expect(await counts(request)).toMatchObject({composition_previews:1,image_calls:0,jev_calls:0,reservations:0});
});

test('well-formed cross-scope projection and hostile identity history never become displayed authority',async({page,request})=>{
  await initialize(page);await page.route('**/api/composition/current',async route=>{const response=await route.fetch(),data=await response.json();data.view.projection.base.tenant_id='other_fixture_tenant';const body={...data.view.projection};delete body.projection_sha256;data.view.projection.projection_sha256=await page.evaluate(async body=>{const canonical=x=>Array.isArray(x)?`[${x.map(canonical).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`:JSON.stringify(x);const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(body)));return `sha256:${Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')}`;},body);await route.fulfill({response,json:data});},{times:1});
  await page.getByRole('button',{name:'Refresh current composition',exact:true}).click();await expect(page.locator('#composition-error')).toContainText('exact preview unavailable');await expect(page.locator('#composition-preview')).toBeHidden();await refresh(page);
  await page.route('**/api/composition/history?**',async route=>{const response=await route.fetch(),data=await response.json();data.view.identity.preview_access={bytes_base64:'AAAA'};await route.fulfill({response,json:data});},{times:1});await page.getByRole('button',{name:'Read composition history',exact:true}).click();await expect(page.locator('#composition-history-status')).toContainText('unavailable');await expect(page.getByRole('button',{name:'Review fresh authority renewal',exact:true})).toBeDisabled();expect(await counts(request)).toMatchObject({composition_previews:0,image_calls:0});
});
