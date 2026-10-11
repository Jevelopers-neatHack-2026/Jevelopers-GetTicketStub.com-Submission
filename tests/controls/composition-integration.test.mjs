import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createIntegratedHost, fixturePrincipal as principal } from '../../fixtures/controls/integrated-host.mjs';
import { fixtureCompositionPolicy } from '../../fixtures/controls/composition-policy.mjs';
import { canonicalHash } from 'creative-engine/contracts';
import { spawnSync } from 'node:child_process';
import { assertCompositionHistory, assertCompositionHistoryIdentity, assertCompositionDraftReview } from '../../src/controls/composition-view.mjs';

async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'controls-composition-'));
  const host = await createIntegratedHost(directory, { enableComposition: true, lockLogo: false, ...options });
  t.after(async () => {
    const counts = host.evidenceCounts ?? host.counts();
    host.close();
    if (process.env.CONTROLS_COMPOSITION_EVIDENCE_DIR) {
      const target = join(process.env.CONTROLS_COMPOSITION_EVIDENCE_DIR, t.name.replace(/[^a-zA-Z0-9_-]/g, '_'), basename(directory));
      await mkdir(target, { recursive: true }); await cp(directory, join(target, 'store-root'), { recursive: true });
      await writeFile(join(target, 'counters.json'), JSON.stringify(counts, null, 2));
    }
    await rm(directory, { recursive: true, force: true });
  });
  return host;
}
async function initialize(host, id = 'initialize') {
  const view = await host.composition.current(principal);
  assert.equal(view.status, 'not_initialized', JSON.stringify(view));
  const action = { action_version: 'creative-composition-initialize/1.0', action_id: id, review_sha256: view.review.review_sha256, intent: 'initialize' };
  const result = await host.composition.apply(principal, action);
  assert.equal(result.ok, true, JSON.stringify(result)); return { action, result };
}
async function action(host, exact = {}, categories = {}, id = 'apply') {
  const view = await host.composition.current(principal); assert.equal(view.status, 'current', JSON.stringify(view));
  return { action_version: 'creative-composition-apply/1.0', action_id: id, projection_sha256: view.projection.projection_sha256, intent: 'apply', draft: { categories, exact } };
}
const current = host => host.store.getCurrentComposition({ scope: host.scope, design_version_id: host.selection().design_version_id });
const previewBinding = preview => Object.fromEntries(['revision_id','revision_sha256','preview_sha256'].map(k=>[k,preview[k]]));
const zeroEffects = host => assert.deepEqual([host.counts().image_calls, host.counts().jev_calls, host.counts().reservations], [0,0,0]);

test('read-only server review maps categories and every exact operation to actual before/after values without publishing', async t => {
  const host = await setup(t); await initialize(host);
  const view = await host.composition.current(principal), original = current(host), before = host.counts();
  const journalCount = () => host.adapter.db.prepare('SELECT COUNT(*) AS n FROM control_composition_actions_v1').get().n;
  const rows = journalCount(), mapping = fixtureCompositionPolicy(0);
  for (const [draft, kind, field, after] of [
    [{ categories:{name_size:'large'}, exact:{} }, 'set_text_size', 'text_size', {value:'36',unit:'pt'}],
    [{ categories:{layout:'stacked',layout_emphasis:'name'}, exact:{} }, 'set_layer_layout', 'layout', mapping.layouts.stacked_name],
    [{ categories:{logo_position:'bottom'}, exact:{} }, 'position_approved_logo', 'logo', mapping.logos.bottom],
    [{ categories:{}, exact:{text:'Taylor Sample'} }, 'set_text', 'text', 'Taylor Sample'],
    [{ categories:{}, exact:{text_size:{value:'31.125',unit:'px'}} }, 'set_text_size', 'text_size', {value:'31.125',unit:'px'}],
    [{ categories:{}, exact:{layout:{x_milli:200,y_milli:230,width_milli:650,height_milli:120}} }, 'set_layer_layout', 'layout', {x_milli:200,y_milli:230,width_milli:650,height_milli:120}],
    [{ categories:{}, exact:{logo:{x_milli:60,y_milli:790,width_milli:130,height_milli:130}} }, 'position_approved_logo', 'logo', {x_milli:60,y_milli:790,width_milli:130,height_milli:130}],
  ]) {
    const review = await host.composition.review(principal, { projection_sha256:view.projection.projection_sha256, draft });
    assertCompositionDraftReview(review, view.projection, draft);
    assert.equal(review.changes.length, 1); assert.equal(review.changes[0].kind, kind);
    assert.deepEqual(review.changes[0].before, view.projection.exact_controls[field].value);
    assert.deepEqual(review.changes[0].after, after);
    assert.equal(review.changes[0].asset_id, field === 'logo' ? 'asset-1' : null);
    const {review_sha256, ...body} = review; assert.equal(review_sha256, canonicalHash(body)); assert.equal(review.draft_sha256, canonicalHash(draft));
    assert.deepEqual(current(host), original); assert.equal(journalCount(), rows);
  }
  assert.equal(host.counts().jobs, before.jobs); assert.equal(host.counts().composition_previews, before.composition_previews); zeroEffects(host);
  await assert.rejects(host.composition.review(principal, { projection_sha256:canonicalHash({}), draft:{categories:{name_size:'large'},exact:{}} }));
  await assert.rejects(host.composition.review({...principal,tenant_id:'wrong-tenant'}, { projection_sha256:view.projection.projection_sha256, draft:{categories:{name_size:'large'},exact:{}} }));
  await assert.rejects(host.composition.review(principal, { projection_sha256:view.projection.projection_sha256, draft:{categories:{name_size:'large'},exact:{}}, policy:{} }));
  assert.equal(journalCount(), rows); zeroEffects(host);
});

test('composition reads are uninitialized and read-only; initialization requires its exact reviewed binding', async t => {
  const host = await setup(t), empty = await host.composition.current(principal);
  await host.composition.current(principal); assert.equal(current(host), null); assert.equal(host.counts().composition_resolves, 0); zeroEffects(host);
  const denied = await host.composition.apply(principal, { action_version: 'creative-composition-initialize/1.0', action_id: 'forged-init', review_sha256: canonicalHash({}), intent: 'initialize' });
  assert.equal(denied.ok, false); assert.equal(current(host), null);
  const { action: init, result } = await initialize(host);
  const replay = await host.composition.apply(principal, init); assert.equal(replay.ok, true, JSON.stringify(replay)); assert.equal(replay.historical, true);
  assert.equal(replay.revision_sha256, result.revision_sha256); assert.equal(empty.approval, false); zeroEffects(host);
});

for (const [kind, value, assertChange] of [
  ['text', 'Taylor Sample', revision => assert.equal(revision.layer_manifest.find(x => x.layer_id === 'layer:name').value, 'Taylor Sample')],
  ['text_size', { value: '31.125', unit: 'px' }, revision => assert.deepEqual(revision.geometry.find(x => x.layer_id === 'layer:name').text_size, { value: '31.125', unit: 'px' })],
  ['layout', { x_milli: 150, y_milli: 230, width_milli: 650, height_milli: 120 }, revision => assert.equal(revision.geometry.find(x => x.layer_id === 'layer:name').layout.y_milli, 230)],
  ['logo', { x_milli: 60, y_milli: 790, width_milli: 130, height_milli: 130 }, revision => assert.equal(revision.geometry.find(x => x.layer_id === 'layer:logo').layout.x_milli, 60)],
]) test(`independent exact ${kind} Apply/get/replay/reopen preserves immutable artwork and loads owner preview`, async t => {
  const host = await setup(t); await initialize(host); const before = current(host), selection = host.selection();
  const bytes = await host.store.getArtifactBytes({ scope: host.scope, brief_id: host.scope.brief_id, design_version_id: selection.design_version_id });
  const body = await action(host, { [kind]: value });
  const [result, duplicate] = await Promise.all([host.composition.apply(principal, body), host.composition.apply(principal, body)]);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(duplicate.revision_sha256, result.revision_sha256);
  const after = current(host); assertChange(after.revision);
  assert.equal(after.revision.parent_revision_sha256, before.revision.revision_sha256);
  assert.notEqual(after.revision.revision_sha256, before.revision.revision_sha256);
  assert.notEqual(after.revision.state_sha256, before.revision.state_sha256);
  if (kind !== 'text') {
    assert.deepEqual(after.revision.layer_manifest, before.revision.layer_manifest);
    assert.equal(after.revision.binding.composition.sha256, before.revision.binding.composition.sha256, 'geometry-only edits preserve the legacy layer commitment');
  }
  assert.notEqual(after.revision.preview.preview_sha256, before.revision.preview.preview_sha256);
  assert.deepEqual(host.selection(), selection);
  assert.deepEqual(await host.store.getArtifactBytes({ scope: host.scope, brief_id: host.scope.brief_id, design_version_id: selection.design_version_id }), bytes);
  const view = await host.composition.current(principal); assert.equal(view.projection.base.revision_sha256, result.revision_sha256);
  const preview = await host.composition.preview(principal, previewBinding(view.preview)); assert.deepEqual(preview.bytes, Buffer.from(after.preview_bytes));
  assert.equal(preview.metadata.byte_length, preview.bytes.length);
  host.restartAdapter(); const replay = await host.composition.apply(principal, body);
  assert.equal(replay.ok, true, JSON.stringify(replay)); assert.equal(replay.historical, true); assert.equal(replay.backend_job_id, result.backend_job_id);
  assert.equal(host.counts().composition_previews, 1); zeroEffects(host);
  assert.equal(result.approval, false); assert.equal(result.purchase, false);
  const databasePath = host.adapter.db.prepare('PRAGMA database_list').all().find(x=>x.name==='main').file;
  const directory = databasePath.slice(0, -'/controls.sqlite'.length), actionPath=join(directory,'reopen-action.json');
  await writeFile(actionPath,JSON.stringify({action_id:body.action_id}));host.evidenceCounts=host.counts();host.close();
  const child=spawnSync(process.execPath,['fixtures/controls/composition-restart-worker.mjs',directory,actionPath],{encoding:'utf8'});
  await writeFile(join(directory,'restart.stdout.raw'),child.stdout??'');await writeFile(join(directory,'restart.stderr.raw'),child.stderr??'');
  await writeFile(join(directory,'restart.receipt.json'),JSON.stringify({argv:[process.execPath,'fixtures/controls/composition-restart-worker.mjs',directory,actionPath],node:process.version,cwd:process.cwd(),exit_code:child.status},null,2));
  assert.equal(child.status,0,child.stderr);const reopened=JSON.parse(child.stdout);
  assert.equal(reopened.result.ok,true,JSON.stringify(reopened.result));assert.equal(reopened.result.revision_sha256,result.revision_sha256);
  assert.equal(reopened.current.projection.base.revision_sha256,result.revision_sha256);
  assert.deepEqual([reopened.counters.composition_previews,reopened.counters.image_calls,reopened.counters.jev_calls,reopened.counters.reservations],[0,0,0,0]);
});

test('all original categoricals and q01 derive current state through explicit joint templates', async t => {
  const host = await setup(t); await initialize(host);
  for (const [id, categories] of [['small',{name_size:'small'}],['large',{name_size:'large'}],['medium',{name_size:'medium'}],
    ['stacked',{layout:'stacked',layout_emphasis:'balanced'}],['emphasis',{layout:'stacked',layout_emphasis:'name'}],['centered',{layout:'centered'}],['bottom',{logo_position:'bottom'}],['top',{logo_position:'top'}]]) {
    const result = await host.composition.apply(principal, await action(host, {}, categories, id)); assert.equal(result.ok, true, JSON.stringify(result));
    const view = await host.composition.current(principal);
    for (const [field,value] of Object.entries(categories)) assert.equal(view.projection.categories.find(x=>x.field===field).current_value, value);
  }
  zeroEffects(host); assert.equal(host.counts().composition_previews, 8);
});

test('unrepresented exact geometry stays null rather than inventing a categorical baseline', async t => {
  const host = await setup(t); await initialize(host);
  assert.equal((await host.composition.apply(principal, await action(host, { text_size: { value:'23',unit:'pt' } }))).ok, true);
  assert.equal((await host.composition.current(principal)).projection.categories.find(x=>x.field==='name_size').current_value, null);
});

test('changed-action, hostile/unknown inputs, q01 conflicts, revoked scope and locks dispatch no effect', async t => {
  const host = await setup(t); await initialize(host);
  const good = await action(host, {}, {name_size:'large'}, 'dedup'); assert.equal((await host.composition.apply(principal, good)).ok,true);
  const changed = structuredClone(good); changed.draft.categories.name_size='small'; assert.equal((await host.composition.apply(principal, changed)).code,'conflict');
  const before=host.counts().composition_previews;
  for (const [id,exact,categories] of [['html',{text:'<script>bad</script>'},{}],['unknown',{eval:'bad'},{}],['empty',{},{}],['q01',{}, {layout:'stacked'}],['overlap',{layout:{x_milli:0,y_milli:0}}, {layout:'centered'}]])
    assert.equal((await host.composition.apply(principal, await action(host, exact, categories, id))).ok,false);
  const body=await action(host,{text:'Safe Name'}, {}, 'revoked');
  assert.equal((await host.composition.apply({...principal,tenant_id:'forged'},body)).ok,false);
  host.policy.can_apply=false; assert.equal((await host.composition.apply(principal,body)).ok,false);
  assert.equal(host.counts().composition_previews,before); zeroEffects(host);
});

test('same-ID geometry and preview swaps fail exact displayed preview binding', async t => {
  const host=await setup(t); await initialize(host); const old=(await host.composition.current(principal)).preview;
  assert.equal((await host.composition.apply(principal,await action(host,{}, {name_size:'large'}))).ok,true);
  assert.equal(await host.composition.preview(principal,previewBinding(old)),null);
  const now=(await host.composition.current(principal)).preview;
  assert.equal(await host.composition.preview(principal,{...previewBinding(now),preview_sha256:old.preview_sha256}),null);
  assert.equal(await host.composition.preview(principal,{...previewBinding(now),revision_sha256:old.revision_sha256}),null);
});

async function waitFor(check) { const end=Date.now()+4000; while(!check()){if(Date.now()>end)throw Error('Fixture barrier timed out');await new Promise(resolve=>setTimeout(resolve,5));} }
test('pending read-only lookup performs no execution and cancellation never publishes a child', async t => {
  const host=await setup(t);await initialize(host);const before=current(host).revision.revision_sha256,body=await action(host,{}, {name_size:'large'},'cancel-pending');
  host.block('composition-preview');const pending=host.composition.apply(principal,body);await waitFor(()=>host.waiting==='composition-preview');
  const counts=host.counts();const lookup=await host.composition.lookup(principal,body.action_id);assert.equal(lookup.status,'unknown');assert.deepEqual(host.counts(),counts,'lookup must not invoke owner or preview producer');
  const cancel=await host.composition.cancel(principal,body.action_id);assert.equal(cancel.ok,true,JSON.stringify(cancel));host.release();const result=await pending;
  assert.equal(result.ok,false);assert.equal(current(host).revision.revision_sha256,before);zeroEffects(host);
});

test('same-parent competing real Apply requests publish exactly one immutable child', async t => {
  const host=await setup(t);await initialize(host);const before=current(host).revision;
  const a=await action(host,{}, {name_size:'large'},'race-a'),b=await action(host,{}, {name_size:'small'},'race-b');
  host.block('composition-preview');const pending=Promise.all([host.composition.apply(principal,a),host.composition.apply(principal,b)]);
  await waitFor(()=>host.store.db.prepare("SELECT COUNT(*) AS n FROM creative_composition_actions_v1 WHERE action_id IN ('race-a','race-b')").get().n===2);host.release();const results=await pending;
  assert.equal(results.filter(x=>x.ok).length,1,JSON.stringify(results));assert.equal(current(host).revision.parent_revision_sha256,before.revision_sha256);
  assert.equal(host.store.db.prepare('SELECT COUNT(*) AS n FROM creative_composition_revisions_v1').get().n,2);zeroEffects(host);
});

test('real immutable locked and factual policies reject restricted edits while safe permitted size succeeds', async t => {
  const locked=await setup(t);locked.policy.locked_layer_ids=['layer:name'];await initialize(locked,'locked-init');
  const lockedBody=await action(locked,{text:'Blocked Name'}, {},'locked-text');assert.equal((await locked.composition.apply(principal,lockedBody)).ok,false);assert.equal(locked.counts().composition_previews,0);
  const factual=await setup(t);factual.policy.factual_name=true;await initialize(factual,'factual-init');
  const body=await action(factual,{text:'Invented Festival'}, {},'factual-text');assert.equal((await factual.composition.apply(principal,body)).ok,false);assert.equal(factual.counts().composition_previews,0);
  assert.equal((await factual.composition.apply(principal,await action(factual,{}, {name_size:'large'},'factual-size'))).ok,true);
  assert.equal(current(factual).revision.layer_manifest.find(x=>x.layer_id==='layer:name').value,'Example Festival');zeroEffects(locked);zeroEffects(factual);
});

test('closed nested exact input, hostile descriptors and forged actor fail before preview dispatch', async t => {
  const host=await setup(t);await initialize(host);let hooks=0;
  const getter=await action(host,{text:'Safe'}, {},'getter');Object.defineProperty(getter.draft.exact,'text',{get(){hooks++;return 'Hostile';},enumerable:true});
  assert.equal((await host.composition.apply(principal,getter)).ok,false);assert.equal(hooks,0);
  for(const[id,exact]of [['geometry-extra',{layout:{x_milli:0,y_milli:0,script:'run'}}],['negative',{layout:{x_milli:-1,y_milli:0}}],['offcanvas',{logo:{x_milli:900,y_milli:0,width_milli:200}}],['unit',{text_size:{value:'24',unit:'em'}}],['huge',{text_size:{value:'121',unit:'pt'}}],['size-extra',{text_size:{value:'24',unit:'pt',provider:'run'}}],['secret',{text:'api_key:synthetic-private-credential'}]]){
    assert.equal((await host.composition.apply(principal,await action(host,exact,{},id))).ok,false,id);
  }
  const body=await action(host,{}, {name_size:'large'},'actor');assert.equal((await host.composition.apply({...principal,actor_id:'other'},body)).ok,false);
  assert.equal(host.counts().composition_previews,0);zeroEffects(host);
});

test('borrowed controls BEGIN and SAVEPOINT reject before host callbacks and preserve caller rows',async t=>{
  const host=await setup(t);await initialize(host);const body=await action(host,{}, {name_size:'large'},'borrowed');
  const db=host.adapter.db;db.exec('CREATE TABLE caller_owned(value TEXT)');let reads=0;const original=host.composition.readContext;host.composition.readContext=(...args)=>{reads++;return original(...args);};
  for(const boundary of ['BEGIN','SAVEPOINT caller']){
    db.exec(boundary);db.prepare('INSERT INTO caller_owned VALUES(?)').run(boundary);
    const before=host.counts().composition_previews;
    assert.equal((await host.composition.apply(principal,body)).ok,false);assert.equal(await host.composition.lookup(principal,body.action_id),null);
    assert.equal(db.isTransaction,true);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM caller_owned WHERE value=?').get(boundary).n,1);assert.equal(reads,0);assert.equal(host.counts().composition_previews,before);
    if(boundary==='BEGIN')db.exec('ROLLBACK');else db.exec('ROLLBACK TO caller; RELEASE caller');
  }
});


test('distinct text, categorical size and exact layout/logo combine into one real immutable child', async t => {
  const host = await setup(t); await initialize(host); const before = current(host).revision;
  const body = await action(host, { text: 'Combined Sample', layout: { x_milli: 120, y_milli: 300 }, logo: { x_milli: 700, y_milli: 100 } }, { name_size: 'large' }, 'combined');
  const result = await host.composition.apply(principal, body); assert.equal(result.ok, true, JSON.stringify(result));
  const revision = current(host).revision;
  assert.equal(revision.parent_revision_sha256, before.revision_sha256);
  assert.equal(revision.layer_manifest.find(x => x.layer_id === 'layer:name').value, 'Combined Sample');
  assert.equal(revision.geometry.find(x => x.layer_id === 'layer:name').text_size.value, '36');
  assert.equal(revision.geometry.find(x => x.layer_id === 'layer:name').layout.y_milli, 300);
  assert.equal(revision.geometry.find(x => x.layer_id === 'layer:logo').layout.x_milli, 700);
  assert.equal(host.counts().composition_previews, 1); zeroEffects(host);
});

test('preview read discards genuine bytes if trusted selection changes during the response', async t => {
  const host = await setup(t); await initialize(host); const expected = previewBinding((await host.composition.current(principal)).preview);
  const api = host.composition.api, originalRead = host.composition.readContext; let changed = false;
  host.composition.api = { invoke: async (...args) => { const result = await api.invoke(...args); changed = true; return result; } };
  host.composition.readContext = (...args) => { const context = originalRead(...args); return changed ? { ...context, selection: { ...context.selection, revision: context.selection.revision + 1 } } : context; };
  assert.equal(await host.composition.preview(principal, expected), null);
  assert.equal(host.counts().composition_previews, 0); zeroEffects(host);
});


async function renewalAction(host, id = 'renew') {
  const history = await host.composition.history(principal); assert.equal(history.ok, true, JSON.stringify(history)); assert.equal(history.review.can_renew, true);
  return { action_version: 'creative-composition-renew/1.0', action_id: id, intent: 'renew', review_sha256: history.review.review_sha256 };
}

test('expired authority exposes metadata-only history; reviewed renewal appends a child and requires fresh Apply', async t => {
  const host = await setup(t); await initialize(host); const before = current(host).revision, oldAction = await action(host, {}, { name_size: 'large' }, 'old-draft');
  host.advance(60001); assert.equal((await host.composition.current(principal)).status, 'stale');
  const beforeCounts = host.counts(), history = await host.composition.history(principal); assert.deepEqual(host.counts(), beforeCounts);
  assert.equal(history.identity.current.revision_sha256, before.revision_sha256); assert.equal(history.identity.revisions.length, 1);
  assert.equal(JSON.stringify(history).includes('preview'), false); assert.equal(history.approval, false);
  const renew = await renewalAction(host), result = await host.composition.apply(principal, renew); assert.equal(result.ok, true, JSON.stringify(result));
  const after = current(host).revision; assert.equal(after.parent_revision_sha256, before.revision_sha256);
  assert.deepEqual(after.geometry, before.geometry); assert.deepEqual(after.layer_manifest, before.layer_manifest); assert.deepEqual(after.artwork, before.artwork);
  assert.notEqual(after.revision_sha256, before.revision_sha256); assert.equal(result.approval, false); assert.equal(result.purchase, false);
  assert.equal((await host.composition.apply(principal, oldAction)).ok, false);
  assert.equal((await host.composition.current(principal)).status, 'current');
  const replay = await host.composition.apply(principal, renew); assert.equal(replay.revision_sha256, result.revision_sha256); assert.equal(replay.historical, true);
  assert.equal(host.counts().composition_revalidations, 1); assert.equal(host.counts().composition_previews, 1);
  assert.equal((await host.composition.apply(principal, await action(host, {}, { name_size: 'large' }, 'fresh-after-renewal'))).ok, true);
  assert.equal(host.counts().composition_previews, 2); zeroEffects(host);
  const preserved = host.store.getCompositionRevision({ scope: host.scope, composition_id: before.composition_id, revision_id: before.revision_id });
  assert.equal(preserved.revision.revision_sha256, before.revision_sha256);
});

test('public same-design restore remains stale until a fresh reviewed renewal rebinds selection', async t => {
  const host = await setup(t); await initialize(host); const before = current(host).revision, selection = host.selection();
  const staleReview = await renewalAction(host, 'stale-renew-review');
  const restored = await host.restore(selection.design_version_id, selection.revision, 'restore-same-design'); assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal((await host.composition.current(principal)).status, 'stale');
  const history = await host.composition.history(principal); assert.equal(history.identity.selection_compatibility, 'changed');
  assert.equal((await host.composition.apply(principal, staleReview)).ok, false); assert.equal(host.counts().composition_previews, 0);
  const result = await host.composition.apply(principal, await renewalAction(host, 'renew-restored')); assert.equal(result.ok, true, JSON.stringify(result));
  const after = current(host).revision; assert.equal(after.dependencies.selection_revision, host.selection().revision); assert.equal(after.parent_revision_sha256, before.revision_sha256);
  assert.equal((await host.composition.current(principal)).status, 'current'); zeroEffects(host);
});

test('history paginates actual identities without execution; forged renewal review and unavailable owner never authorize a child', async t => {
  const host = await setup(t); await initialize(host); await host.composition.apply(principal, await action(host, {}, { name_size: 'large' }, 'history-large'));
  const before = host.counts(), first = await host.composition.history(principal, { limit: 1 });
  assert.equal(first.identity.has_more, true); const second = await host.composition.history(principal, { limit: 1, after_revision_id: first.identity.next_after_revision_id });
  assert.equal(second.identity.has_more, false); assert.notEqual(first.identity.revisions[0].revision_id, second.identity.revisions[0].revision_id); assert.deepEqual(host.counts(), before);
  const forged = { ...await renewalAction(host, 'forged-renewal'), review_sha256: canonicalHash({}) }; assert.equal((await host.composition.apply(principal, forged)).ok, false);
  const good = await renewalAction(host, 'owner-denied'); host.policy.permitted_asset_ids = []; assert.equal((await host.composition.apply(principal, good)).ok, false);
  assert.equal(host.store.db.prepare('SELECT COUNT(*) AS n FROM creative_composition_revisions_v1').get().n, 2); zeroEffects(host);
});


test('read-only completed-job recovery remains available after edit revocation without caching or execution', async t => {
  const host = await setup(t); await initialize(host);
  const body = await action(host, {}, { name_size: 'large' }, 'lost-completed-readonly');
  const invoke = host.composition.api.invoke;
  host.composition.api = { ...host.composition.api, invoke: async (...args) => {
    const response = await invoke(...args);
    if (args[1].operation === 'composition.update') throw new Error('Declared lost response after actual publication');
    return response;
  } };
  const lost = await host.composition.apply(principal, body);
  assert.equal(lost.status, 'unknown');
  const row = host.composition.row(principal, body.action_id);
  assert.equal(row.response_json, null);
  assert.equal((await host.composition.ports.jobs.get({ scope: principal, job_id: row.job_id })).status, 'completed');
  host.policy.can_apply = false;
  const before = host.counts(), revision = current(host).revision;
  const recovered = await host.composition.lookup(principal, body.action_id);
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(recovered.historical, true);
  assert.equal(recovered.revision_sha256, revision.revision_sha256);
  assert.deepEqual(host.counts(), before);
  assert.equal(host.composition.row(principal, body.action_id).response_json, null, 'read-only recovery must not cache acknowledgement');
  assert.equal(await host.composition.lookup({ ...principal, actor_id: 'other_actor' }, body.action_id), null);
  assert.equal(await host.composition.lookup({ ...principal, tenant_id: 'other_tenant' }, body.action_id), null);
  assert.equal(await host.composition.lookup({ ...principal, project_id: 'other_project' }, body.action_id), null);
  host.policy.can_read = false;
  assert.equal(await host.composition.lookup(principal, body.action_id), null);
  zeroEffects(host);
});


test('public mixed-case history keeps binary full-page and single-row pagination equal without normalizing corrupt order', async t => {
  const host = await setup(t), initialized = await initialize(host);
  const ids = ['Z_mixed', 'a_mixed', 'A_mixed', '_mixed', 'z_mixed'];
  for (let i = 0; i < ids.length; i++) {
    const result = await host.composition.apply(principal, await action(host, {}, { name_size: i % 2 ? 'small' : 'large' }, ids[i]));
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  const before = host.counts(), full = await host.composition.history(principal, { limit: 20 });
  assert.equal(assertCompositionHistory(full).ok, true);
  const expected = [initialized.result.revision_id, ...ids.map(id => `revision:${id}`)].sort();
  assert.deepEqual(full.identity.revisions.map(r => r.revision_id), expected);
  assert.equal(new Set(full.identity.revisions.map(r => r.created_at)).size, 1, 'fixture explicitly exercises equal-time ID tie ordering');
  const pages = []; let after;
  do {
    const view = await host.composition.history(principal, { limit: 1, ...(after ? { after_revision_id: after } : {}) });
    assertCompositionHistory(view); pages.push(...view.identity.revisions); after = view.identity.next_after_revision_id;
  } while (after);
  assert.deepEqual(pages, full.identity.revisions);
  const reversed = structuredClone(full.identity); reversed.revisions.reverse();
  assert.throws(() => assertCompositionHistoryIdentity(reversed), 'consumer must reject reversed producer order rather than sort it');
  const duplicated = structuredClone(full.identity); duplicated.revisions.push(duplicated.revisions[0]);
  assert.throws(() => assertCompositionHistoryIdentity(duplicated));
  const crossScope = structuredClone(full.identity); crossScope.revisions[0].design_version_id = 'other_design';
  assert.throws(() => assertCompositionHistoryIdentity(crossScope));
  await assert.rejects(host.composition.history({ ...principal, tenant_id: 'other_tenant' }));
  host.policy.can_read = false;
  await assert.rejects(host.composition.history(principal));
  assert.deepEqual(host.counts(), before, 'all history and rejected reads perform zero execution');
  zeroEffects(host);
});
