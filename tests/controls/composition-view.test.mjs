import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntegratedHost, fixturePrincipal } from '../../fixtures/controls/integrated-host.mjs';
import { assertCompositionCurrent, assertCompositionCompletion, assertCompositionProjection, verifyCompositionProjectionHash } from '../../src/controls/composition-view.mjs';
import { assertRenderableSchema } from '../../src/controls/schema.mjs';
import { validateCompositionControlPolicy } from '../../src/controls/composition-projection.mjs';
import { fixtureCompositionPolicy } from '../../fixtures/controls/composition-policy.mjs';

async function context(t) {
  const dir=await mkdtemp(join(tmpdir(),'composition-view-')),host=await createIntegratedHost(dir,{enableComposition:true,lockLogo:false});
  t.after(async()=>{host.close();await rm(dir,{recursive:true,force:true});});
  const empty=await host.composition.current(fixturePrincipal),action={action_version:'creative-composition-initialize/1.0',action_id:'view-init',review_sha256:empty.review.review_sha256,intent:'initialize'};
  const result=await host.composition.apply(fixturePrincipal,action),current=await host.composition.current(fixturePrincipal);return {host,empty,result,current};
}
test('actual producer projection hashes validate while old consumers reject the explicitly new version',async t=>{
  const {empty,result,current}=await context(t);assert.equal(assertCompositionCurrent(empty).status,'not_initialized');assert.equal(assertCompositionCurrent(current).status,'current');
  assert.equal(assertCompositionCompletion(result,'view-init').revision_sha256,current.projection.base.revision_sha256);
  assert.equal(await verifyCompositionProjectionHash(current.projection,webcrypto.subtle),true);
  assert.throws(()=>assertRenderableSchema(current.projection),'legacy schema must not silently discard new full state');
  const altered=structuredClone(current.projection);altered.base.state_sha256=`sha256:${'a'.repeat(64)}`;assert.equal(await verifyCompositionProjectionHash(altered,webcrypto.subtle),false);
});
test('deep view allowlists reject hostile extras, previews, geometry, swaps and script text with zero getters',async t=>{
  const {current,result}=await context(t);let hooks=0;const getter=structuredClone(current);
  Object.defineProperty(getter.projection,'base',{get(){hooks++;return current.projection.base;},enumerable:true});assert.throws(()=>assertCompositionCurrent(getter));assert.equal(hooks,0);
  for(const mutate of [x=>{x.provider_request_id='private';},x=>{x.projection.base.signed_url='https://private.invalid';},x=>{x.projection.categories[0].script='run';},x=>{x.projection.exact_controls.text.value='<script>attack()</script>';},x=>{x.projection.exact_controls.layout.value={x_milli:0,y_milli:0,run:'code'};},x=>{x.preview.bytes_base64='AAAA';},x=>{x.preview.state_sha256=`sha256:${'a'.repeat(64)}`;},x=>{x.preview.byte_length=25*1024*1024+1;},x=>{x.preview.mime_type='image/svg+xml';},x=>{x.projection.schema_version='creative-composition-controls/2.0';}]){
    const input=structuredClone(current);mutate(input);assert.throws(()=>assertCompositionCurrent(input));
  }
  assert.throws(()=>assertCompositionCompletion({...result,approval:true},'view-init'));assert.throws(()=>assertCompositionCompletion(result,'wrong-action'));
});
test('trusted policy is closed, bounded and unambiguous rather than a guessed mapping',()=>{
  const p=fixtureCompositionPolicy(1000);assert.equal(validateCompositionControlPolicy(p).schema_version,'1.0');
  for(const mutate of [x=>{x.layouts.centered={x_milli:900,y_milli:0,width_milli:200};},x=>{x.layouts.stacked_name=x.layouts.stacked_balanced;},x=>{x.targets.logo_asset_id='https://private.invalid';},x=>{x.html='run';},x=>{x.size_bounds.units=['em'];},x=>{x.checked_at=x.expires_at;}]){const input=structuredClone(p);mutate(input);assert.throws(()=>validateCompositionControlPolicy(input));}
  const hostile=structuredClone(p);let hooks=0;Object.defineProperty(hostile.name_sizes,'large',{get(){hooks++;return p.name_sizes.large;},enumerable:true});assert.throws(()=>validateCompositionControlPolicy(hostile));assert.equal(hooks,0);
  assert.throws(()=>assertCompositionProjection({schema_version:'creative-composition-controls/1.0'}));
});
