import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compile = file => ts.transpileModule(readFileSync(new URL(`../src/customer/landing/${file}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function motionEnv({ search = '', storageFails = false, renderer = 'NVIDIA', rendererThrows = false, hints = {}, reduced = false } = {}) {
  let losses = 0, probes = 0;
  const stored = new Map();
  const location = new URL(`https://example.test/?campaign=kept${search}&other=yes#studio`);
  const state = { keep: 'history state' };
  const gl = {
    getExtension(name) { return name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 1 } : { loseContext() { losses++; } }; },
    getParameter() { if (rendererThrows) throw new Error('renderer blocked'); return renderer; },
  };
  const media = { matches: reduced };
  const window = {
    location,
    history: { state, replaceState(s, _, url) { assert.equal(s, state); location.href = new URL(url, location).href; } },
    matchMedia: () => media,
    localStorage: {
      getItem(k) { if (storageFails) throw new Error('storage blocked'); return stored.get(k) ?? null; },
      setItem(k, v) { if (storageFails) throw new Error('storage blocked'); stored.set(k, v); },
      removeItem(k) { if (storageFails) throw new Error('storage blocked'); stored.delete(k); },
    },
  };
  const env = { exports: {}, window, URL, URLSearchParams, navigator: { hardwareConcurrency: 8, deviceMemory: 8, ...hints }, document: {
    createElement() { probes++; return { getContext: () => gl }; },
  } };
  vm.runInNewContext(compile('motion.ts'), env);
  return { ...env.exports, location, stored, media, losses: () => losses, probes: () => probes };
}
for (const first of ['on', 'off']) test(`motion: query ${first} is an initial choice and repeated toggles work`, () => {
  const env = motionEnv({ search: `&motion=${first}` });
  assert.equal(env.readMotionPref(), first);
  const next = first === 'on' ? 'off' : 'on';
  env.writeMotionPref(next);
  assert.equal(env.readMotionPref(), next);
  assert.equal(env.location.searchParams.get('motion'), next);
  assert.equal(env.location.searchParams.get('campaign'), 'kept');
  assert.equal(env.location.searchParams.get('other'), 'yes');
  assert.equal(env.location.hash, '#studio');
  env.writeMotionPref(first);
  assert.equal(env.readMotionPref(), first);
});
test('motion: storage failures preserve repeated choices for this load, including auto', () => {
  const env = motionEnv({ storageFails: true, search: '&motion=off' });
  for (const choice of ['on', 'off', 'on', 'auto']) {
    env.writeMotionPref(choice);
    assert.equal(env.readMotionPref(), choice);
  }
  assert.equal(env.location.searchParams.has('motion'), false);
});
test('motion: automatic preference follows OS changes and explicit on overrides reduce', () => {
  const env = motionEnv();
  assert.equal(env.landingMode().still, false);
  env.media.matches = true;
  assert.equal(env.landingMode().still, true);
  env.writeMotionPref('on');
  assert.equal(env.landingMode().still, false);
  assert.equal(env.probes(), 1);
});
test('motion: GPU probe releases even when the renderer read fails and caches fallback', () => {
  const env = motionEnv({ rendererThrows: true });
  assert.equal(env.hasHardwareGL(), false);
  assert.equal(env.losses(), 1);
  assert.equal(env.hasHardwareGL(), false);
  assert.equal(env.probes(), 1);
});
for (const renderer of ['SwiftShader', 'llvmpipe', 'softpipe', 'software renderer', 'Microsoft Basic Render Driver', 'lavapipe']) {
  test(`motion: ${renderer} uses printed fallback`, () => {
    const env = motionEnv({ renderer });
    assert.equal(env.landingMode().no3d, true);
    assert.equal(env.losses(), 1);
  });
}
for (const hints of [{ connection: { saveData: true } }, { connection: { effectiveType: 'slow-2g' } }, { connection: { effectiveType: '2g' } }, { deviceMemory: 2 }, { hardwareConcurrency: 2 }]) {
  test(`motion: ${JSON.stringify(hints)} falls back before probing WebGL`, () => {
    const env = motionEnv({ hints });
    assert.equal(env.landingMode().no3d, true);
    assert.equal(env.probes(), 0);
  });
}

// Render the real component with deterministic hooks; its effect, click handler and cleanup run unchanged.
function landingEnv() {
  let effect, cleanup, run = 0, refIndex = 0, stopped = 0;
  const refs = [], listeners = new Map(), changes = new Set(), modes = [], focus = [];
  let pref = 'auto', reduced = false;
  const toggle = { setAttribute(k, v) { this[k] = v; }, focus(o) { focus.push(o); }, addEventListener(k, v) { listeners.set(k, v); }, removeEventListener(k) { listeners.delete(k); } };
  const el = { dataset: {}, classList: { remove() {} }, querySelector: () => toggle, querySelectorAll: () => [{}, {}, {}, {}] };
  const exports = {};
  vm.runInNewContext(compile('Landing.tsx'), { exports, window: { matchMedia: () => ({ addEventListener(_, cb) { changes.add(cb); }, removeEventListener(_, cb) { changes.delete(cb); } }) }, document: { activeElement: toggle }, require(id) {
    if (id === 'react') return {
      useRef(initial) { const i = refIndex++; return refs[i] ??= { current: i === 0 ? el : initial }; },
      useState: () => [run, fn => { run = fn(run); }], useEffect: cb => { effect = cb; },
    };
    if (id === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
    if (id === 'next/navigation') return { useRouter: () => ({ push() {} }) };
    if (id === './motion') return { readMotionPref: () => pref, writeMotionPref: v => { pref = v; }, landingMode: () => ({ still: pref === 'off' || (pref === 'auto' && reduced), no3d: pref !== 'on', reason: pref === 'on' ? '' : 'motion off' }) };
    if (id === './landing.script') return { mountLanding: ctx => { modes.push(ctx.mode); return () => { stopped++; }; } };
    if (id === './markup') return { CHROME_HTML: '', HERO_HTML: '', REST_HTML: '', FOOT_HTML: '' };
    return {};
  } });
  const render = () => { cleanup?.(); refIndex = 0; exports.Landing({ children: null }); cleanup = effect(); };
  render();
  return { render, el, toggle, modes, focus, changes, click: () => listeners.get('click')(), system(v) { reduced = v; for (const cb of changes) cb(); }, run: () => run, stopped: () => stopped, cleanup: () => cleanup() };
}
test('Landing effect follows system changes only in auto, reflects aria-pressed and restores switch focus', () => {
  const env = landingEnv();
  assert.equal(env.toggle['aria-pressed'], 'false');
  env.system(true);
  assert.equal(env.run(), 1);
  env.render();
  assert.equal(env.toggle['aria-pressed'], 'true');
  assert.equal(env.el.dataset.motion, 'off');
  env.click(); env.render();
  assert.equal(env.toggle['aria-pressed'], 'false');
  assert.equal(env.el.dataset.motion, '3d');
  assert.equal(Object.hasOwn(env.el.dataset, 'lite'), false);
  assert.equal(env.focus.length, 2);
  assert.ok(env.focus.every(o => o.preventScroll));
  env.system(false);
  assert.equal(env.run(), 2, 'an explicit on choice ignores OS changes');
  env.click(); env.render();
  assert.equal(env.toggle['aria-pressed'], 'true');
  assert.equal(env.changes.size, 1, 'each remount removes the previous media listener');
  env.cleanup();
  assert.equal(env.changes.size, 0);
  assert.equal(env.stopped(), 4);
});
