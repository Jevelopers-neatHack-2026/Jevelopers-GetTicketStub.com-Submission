import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Execute the page's real handlers/frame function, with browser and Lenis doubles.
// No browser download, CDN, provider API, or npm install is needed.
// SCROLL_TEST_HTML also lets us run these checks against the pre-fix page.
const html = readFileSync(process.env.SCROLL_TEST_HTML || new URL('../site/index.html', import.meta.url), 'utf8');
const moduleSource = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert.ok(moduleSource, 'main page module exists');

function section(from, to){
  const start = moduleSource.indexOf(from);
  const end = moduleSource.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `page section exists: ${from}`);
  return moduleSource.slice(start, end);
}

function browserDouble(){
  const listeners = new Map(), frames = [], calls = [], progress = new Map();
  const rail = { style: { setProperty: (name, value) => progress.set(name, value) } };
  const field = { focus: options => calls.push({ focus: options }) };
  const context = vm.createContext({
    scrollY: 2400, innerHeight: 600, innerWidth: 1200,
    reduced: false, dead3d: false, clock: 0, last: 0, H: 600,
    lenisRef: null, staticStarts: 0, frameErrors: [],
    performance: { now: () => 0 },
    history: { pushState: (_, __, id) => calls.push({ hash: id }) },
    document: {
      documentElement: { scrollHeight: 12600 },
      getElementById: id => id === 'ev' ? field : null,
      querySelector: selector => selector === '.rail' ? rail : null,
      querySelectorAll: () => [],
    },
    addEventListener(type, handler, options){
      const entries = listeners.get(type) || [];
      entries.push({ handler, options }); listeners.set(type, entries);
    },
    requestAnimationFrame: callback => frames.push(callback),
    scrollTo: options => { calls.push({ scroll: options }); context.scrollY = options.top; },
    // A failure at the first render measurement stops the original RAF chain.
    navColour(){ throw new Error('simulated animation failure'); },
    useStatic(){ context.staticStarts++; },
    console: { warn: (_, error) => context.frameErrors.push(error.message) },
  });
  context.window = context;

  // Lenis 1.1.13's relevant contract: smoothWheel prevents native wheel defaults,
  // and only raf() advances its pending target. This models the old app lifecycle,
  // rather than trying to emulate rendering or the whole library.
  context.Lenis = class {
    constructor(){
      this.target = context.scrollY;
      context.addEventListener('wheel', event => { event.preventDefault(); this.target += event.deltaY; });
    }
    raf(){ context.scrollY = this.target; }
    scrollTo(y){ this.target = y; }
  };

  function dispatch(type, event = {}){
    for (const { handler } of listeners.get(type) || []) handler(event);
  }
  function wheel(deltaY){
    let prevented = false;
    dispatch('wheel', { deltaY, preventDefault(){ prevented = true; } });
    if (!prevented) context.scrollY += deltaY;
    dispatch('scroll');
    return prevented;
  }
  return { context, listeners, frames, calls, progress, rail, dispatch, wheel };
}

function loadFrame(harness){
  // Initialization and the complete tick function come directly from build3D.
  const engine = section('  /* ---------- scroll engine ---------- */', '  const clamp =');
  const frame = section('  function tick(now){', '  // start the loop when');
  vm.runInContext(`${engine}\n${frame}\nglobalThis.runFrame = tick;`, harness.context);
}

test('wheel keeps moving forward/backward after the 3D loop exits on context loss', () => {
  const h = browserDouble(); loadFrame(h);
  h.context.dead3d = true;
  h.context.runFrame(16);
  assert.equal(h.frames.length, 0, '3D has stopped requesting frames');
  const before = h.context.scrollY;
  assert.equal(h.wheel(500), false, 'wheel default must remain available');
  assert.equal(h.context.scrollY, before + 500);
  h.wheel(-300);
  assert.equal(h.context.scrollY, before + 200);
});

test('an animation exception cannot strand wheel input and starts readable static art', () => {
  const h = browserDouble(); loadFrame(h);
  // The original callback throws before requesting another frame. Observe that
  // stopped state as well as the fixed callback's graceful fallback.
  try { h.context.runFrame(16); } catch (error){ assert.match(error.message, /simulated animation failure/); }
  const before = h.context.scrollY;
  assert.equal(h.wheel(500), false, 'stopped rendering must not own wheel input');
  assert.equal(h.context.scrollY, before + 500);
  h.wheel(-500);
  assert.equal(h.context.scrollY, before);
  assert.equal(h.context.staticStarts, 1, 'runtime errors hand over to static art');
  assert.equal(h.context.dead3d, true);
  h.context.runFrame(32);
  assert.equal(h.context.staticStarts, 1, 'failed 3D loop stays stopped');
});

function loadProgress(h){
  const marker = '// Progress follows native scroll events';
  // No shared update exists in the baseline; leave the rail at its initial state
  // so the same behavioral assertions demonstrate its frozen progress marker.
  if (moduleSource.includes(marker)) vm.runInContext(section(marker, '/* =============================== 3D,'), h.context);
}

test('display-only rail tracks native scrolling/resizing without rendering frames', () => {
  const h = browserDouble(); loadProgress(h);
  h.context.scrollY = 6000; h.dispatch('scroll');
  assert.equal(h.progress.get('--rp'), '0.5000');
  h.context.scrollY = 2400; h.dispatch('scroll');
  assert.equal(h.progress.get('--rp'), '0.2000');
  h.context.document.documentElement.scrollHeight = 24600; h.dispatch('resize');
  assert.equal(h.progress.get('--rp'), '0.1000');
  h.context.document.documentElement.scrollHeight = 600; h.dispatch('resize');
  assert.equal(h.progress.get('--rp'), '0.0000', 'short pages never produce NaN/Infinity');
  assert.equal(h.frames.length, 0);
  assert.equal(h.listeners.get('scroll')[0].options.passive, true);
});

test('rail is decorative and passes pointer input through', () => {
  const css = html.match(/\.rail\{([^}]+)\}/)?.[1];
  assert.match(css, /pointer-events\s*:\s*none/);
  assert.match(css, /cursor\s*:\s*default/);
  assert.match(html, /<div class="rail" aria-hidden="true">/);
});

test('switching to static art restores scene copy hidden by an interrupted 3D frame', () => {
  const h = browserDouble();
  const visibility = new Map([['--ia', '0.000']]);
  h.context.root = { classList: { add: value => h.calls.push({ className: value }) } };
  const info = { style: { removeProperty: name => visibility.delete(name) } };
  h.context.document.querySelectorAll = selector => {
    assert.equal(selector, '.scene .info');
    return [info];
  };
  // sceneEls is local to build3D; it must not be invented as a module global.
  assert.equal('sceneEls' in h.context, false);
  h.context.startStaticLoop = () => { h.context.staticStarts++; return { stop(){} }; };
  vm.runInContext(section('let staticLoop = null, dead3d = false;', 'function leaveStatic()'), h.context);
  h.context.useStatic();
  assert.equal(visibility.has('--ia'), false, 'scene opacity returns to its visible CSS default');
  assert.ok(h.calls.some(call => call.className === 'no3d'));
  h.context.useStatic();
  assert.equal(h.context.staticStarts, 1, 'fallback loop starts once');
});

function loadAnchors(h){
  const handlers = new Map();
  const targets = {
    '#scenes': { getBoundingClientRect: () => ({ top: 1200 }) },
    '#make': {},
    '#top': { getBoundingClientRect: () => ({ top: -h.context.scrollY }) },
  };
  const anchors = ['#scenes', '#make', '#top', '#missing'].map(id => ({
    getAttribute: () => id,
    addEventListener: (_, handler) => handlers.set(id, handler),
  }));
  h.context.document.querySelectorAll = () => anchors;
  h.context.document.querySelector = selector => selector === '.rail' ? h.rail : targets[selector];
  h.context.boardEl = { offsetTop: 12000, offsetHeight: 6000 };
  h.context.finale = { inert: false };
  const source = section('/* ---------- in-page links:', '/* =============================== 3D,');
  vm.runInContext(source, h.context);
  return id => {
    let prevented = false;
    handlers.get(id)({ preventDefault(){ prevented = true; } });
    return prevented;
  };
}

for (const reduced of [false, true]){
  test(`native navigation reaches scenes and maker, with reduced motion ${reduced}`, () => {
    const h = browserDouble(); h.context.reduced = reduced;
    const click = loadAnchors(h);
    assert.equal(click('#scenes'), true);
    assert.equal(h.context.scrollY, 3600);
    assert.equal(h.calls.find(call => call.scroll).scroll.behavior, reduced ? 'auto' : 'smooth');
    assert.equal(click('#make'), true);
    assert.equal(h.context.scrollY, 17388);
    assert.ok(h.calls.some(call => call.hash === '#make'));
    h.frames.shift()(16);
    assert.ok(h.calls.some(call => call.focus?.preventScroll === true), 'maker receives focus without moving the page');
    assert.equal(click('#top'), true);
    assert.equal(h.context.scrollY, 0);
    assert.equal(click('#missing'), false, 'missing targets keep ordinary browser behavior');
  });
}

test('user wheel input cancels pending maker focus', () => {
  const h = browserDouble(); h.context.finale = { inert: true };
  const click = loadAnchors(h);
  h.context.finale.inert = true;
  click('#make');
  h.wheel(-100);
  h.context.finale.inert = false;
  h.frames.shift()(16);
  assert.equal(h.calls.some(call => call.focus), false);
});

test('seamless hero wrap uses an immediate native jump', () => {
  const h = browserDouble();
  const source = moduleSource.match(/function jumpTo\(y\)\{[^\n]+\}/)?.[0];
  assert.ok(source);
  vm.runInContext(source, h.context);
  h.context.jumpTo(120);
  assert.equal(h.context.scrollY, 120);
  assert.equal(h.calls[0].scroll.behavior, 'instant');
});
