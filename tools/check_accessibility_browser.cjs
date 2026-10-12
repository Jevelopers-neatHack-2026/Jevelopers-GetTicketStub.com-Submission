#!/usr/bin/env node
'use strict';
// Runs only a local synthetic fixture. No font/provider requests are permitted.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const outputRoot = path.join(root, 'out', 'brand', 'accessibility-browser');
const started = new Date().toISOString();
const output = path.join(outputRoot, started.replace(/[:.]/g, '-'));
fs.mkdirSync(output, { recursive: true });
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
const sources = ['tokens/tokens.css', 'tokens/tokens.json', 'tokens/profile.json', 'tokens/mapping.json',
  'tools/accessibility-fixture/index.html', 'tools/accessibility-fixture/fixture.css',
  'tools/accessibility-fixture/fixture.js', 'tools/check_accessibility_browser.cjs',
  'tools/browser-dev/package.json', 'tools/browser-dev/package-lock.json'];
const report = {
  schema: 'ticketstub-local-browser-evidence@1', started_at: started,
  mode: 'offline local browser; synthetic content; all external requests blocked',
  outcome: 'error', release_eligible: false, cases: [], external_requests_blocked: 0,
  required_followup: [
    'Named accessibility/brand reviewer acceptance on exact source and report hashes.',
    'Approved external provider fonts available at 200% browser zoom and narrow width; not exercised or approved here.',
    'Real browser 200% zoom and assistive-technology walkthrough; automated CSS zoom below is only a layout proxy.',
    'Consumer application keyboard, focus, imagery, runtime motion and adopted artifact verification.'
  ]
};
class FixtureCheckError extends Error {}
function assert(condition, message) { if (!condition) throw new FixtureCheckError(message); }
function save() {
  report.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outcome: report.outcome, report: path.relative(root, path.join(output, 'report.json')), cases: report.cases.length, release_eligible: false }));
}

(async () => {
  let server, browser;
  try {
    report.source_revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    report.worktree_diff_present = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim() !== '';
    // Hash and serve the same captured buffers. A later edit must never mix live
    // fixture bytes with the earlier evidence hashes or between browser scenarios.
    const snapshot = Object.fromEntries(sources.map(p => [p, fs.readFileSync(path.join(root, p))]));
    report.inputs_sha256 = Object.fromEntries(sources.map(p => [p,
      crypto.createHash('sha256').update(snapshot[p]).digest('hex')]));
    report.input_mode = 'frozen source buffers; end-of-run source comparison required';
    const packagePath = path.join(__dirname, 'browser-dev/node_modules/playwright/package.json');
    const version = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
    assert(version === '1.56.1', 'Install pinned Playwright 1.56.1 with npm ci in tools/browser-dev');
    const { chromium } = require(path.dirname(packagePath));
    report.node = process.version;
    report.playwright = version;
    const routes = {
      '/': ['tools/accessibility-fixture/index.html', 'text/html'],
      '/fixture.css': ['tools/accessibility-fixture/fixture.css', 'text/css'],
      '/fixture.js': ['tools/accessibility-fixture/fixture.js', 'application/javascript'],
      '/tokens/tokens.css': ['tokens/tokens.css', 'text/css']
    };
    server = http.createServer((req, res) => {
      const item = routes[(req.url || '').split('?')[0]];
      if (!item || req.method !== 'GET') { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', item[1] + '; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'self'; font-src 'none'; img-src 'none'; connect-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'");
      res.setHeader('Cache-Control', 'no-store');
      res.end(snapshot[item[0]]);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true });
    report.browser = browser.version();
    const scenarios = [
      ['os-light', 'light', 'auto', 'rgb(244, 236, 221)'],
      ['os-dark', 'dark', 'auto', 'rgb(23, 20, 15)'],
      ['explicit-light-over-dark-os', 'dark', 'light', 'rgb(244, 236, 221)'],
      ['explicit-dark-over-light-os', 'light', 'dark', 'rgb(23, 20, 15)']
    ];
    for (const [name, colorScheme, selected, expectedBackground] of scenarios) {
      const context = await browser.newContext({ colorScheme, viewport: { width: 1080, height: 900 }, reducedMotion: 'reduce' });
      await context.route('**/*', (route) => {
        if (route.request().url().startsWith(origin + '/')) return route.continue();
        report.external_requests_blocked++;
        return route.abort();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.name));
      await page.goto(origin, { waitUntil: 'networkidle' });
      await page.selectOption('#theme', selected);
      const background = await page.locator('#root-sample').evaluate(el => getComputedStyle(el).backgroundColor);
      assert(background === expectedBackground, name + ': wrong document background');
      assert(await page.locator('#night-sample').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(23, 20, 15)', name + ': night subtree does not override light');
      // Tab, rather than only programmatic focus, confirms the fixture controls are reachable.
      await page.locator('body').click({ position: { x: 2, y: 2 } });
      const reached = new Set();
      const focusChecks = [];
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const el = document.activeElement, s = getComputedStyle(el);
          const rgba = value => {
            const match = value.match(/^rgba?\(([^)]+)\)$/);
            if (!match) return null;
            const v = match[1].trim().split(/[,\s/]+/).map(Number);
            if ((v.length !== 3 && v.length !== 4) || v.some(n => !Number.isFinite(n)) ||
                v.slice(0, 3).some(n => n < 0 || n > 255) || (v.length === 4 && (v[3] < 0 || v[3] > 1))) return null;
            return [v[0] / 255, v[1] / 255, v[2] / 255, v.length === 4 ? v[3] : 1];
          };
          const composite = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])).concat(1);
          const luminance = color => color.slice(0, 3).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
          // The separated outline lies on its parent's surface, not its own control fill.
          // Resolve transparent ancestor layers to an actual opaque canvas. Unknown
          // backgrounds/effects fail closed instead of assuming a white background.
          const layers = [];
          let supported = true, opaqueCanvas = false;
          const rect = el.getBoundingClientRect();
          const extent = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
          const scaleX = el.offsetWidth ? rect.width / el.offsetWidth : 1;
          const scaleY = el.offsetHeight ? rect.height / el.offsetHeight : 1;
          const ring = { left: rect.left - extent * scaleX, right: rect.right + extent * scaleX,
            top: rect.top - extent * scaleY, bottom: rect.bottom + extent * scaleY };
          const clips = value => ['hidden', 'clip', 'scroll', 'auto'].includes(value);
          let ringUnclipped = rect.width > 0 && rect.height > 0 && Number.isFinite(extent);
          for (let node = el; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.opacity !== '1' || style.visibility !== 'visible' || style.display === 'none' ||
                style.filter !== 'none' || style.mixBlendMode !== 'normal') supported = false;
            // Unsupported masks or clipping effects cannot establish a visible ring.
            if (style.clipPath !== 'none' || style.maskImage !== 'none' || style.clip !== 'auto' ||
                /(?:^|\s)(?:paint|strict|content)(?:\s|$)/.test(style.contain)) ringUnclipped = false;
            if (node !== el && (clips(style.overflowX) || clips(style.overflowY))) {
              const box = node.getBoundingClientRect();
              const x = node.offsetWidth ? box.width / node.offsetWidth : 1;
              const y = node.offsetHeight ? box.height / node.offsetHeight : 1;
              const left = box.left + node.clientLeft * x, top = box.top + node.clientTop * y;
              const right = left + node.clientWidth * x, bottom = top + node.clientHeight * y;
              if ((clips(style.overflowX) && (ring.left < left - 1 || ring.right > right + 1)) ||
                  (clips(style.overflowY) && (ring.top < top - 1 || ring.bottom > bottom + 1))) ringUnclipped = false;
            }
            if (node === el || opaqueCanvas) continue;
            const color = rgba(style.backgroundColor);
            if (!color || style.backgroundImage !== 'none') { supported = false; continue; }
            layers.push(color);
            if (color[3] === 1) opaqueCanvas = true;
          }
          const outline = rgba(s.outlineColor);
          let ratio = null;
          if (supported && opaqueCanvas && outline) {
            let background = layers.pop();
            while (layers.length) background = composite(layers.pop(), background);
            const values = [luminance(composite(outline, background)), luminance(background)].sort((a, b) => a - b);
            ratio = (values[1] + 0.05) / (values[0] + 0.05);
          }
          return { tag: el.tagName, id: el.id, width: s.outlineWidth, offset: s.outlineOffset,
            visible: el.matches(':focus-visible'), style: s.outlineStyle, color: s.outlineColor,
            supported_surface: supported && opaqueCanvas, adjacent_contrast: ratio,
            ring_unclipped: ringUnclipped };
        });
        if (['BUTTON','INPUT','TEXTAREA','SELECT','A'].includes(focus.tag)) {
          assert(focus.ring_unclipped, name + ': focus outline is clipped or its clipping effect is unsupported');
          assert(focus.visible && parseFloat(focus.width) >= 3 && parseFloat(focus.offset) >= 4 &&
            !['none', 'hidden'].includes(focus.style) && focus.supported_surface && focus.adjacent_contrast >= 3,
            name + ': focus indicator is invisible or below 3:1 against its adjacent surface');
          focusChecks.push(focus);
          if (focus.id) reached.add(focus.id);
        }
      }
      for (const id of ['theme','fallback','note','sample-action','night-note','motion-toggle']) assert(reached.has(id), name + ': keyboard did not reach ' + id);
      const motion = await page.evaluate(() => ({
        durations: ['track','quick','base','settle','reveal','shutter','print-sweep'].map(k => getComputedStyle(document.documentElement).getPropertyValue('--ts-dur-' + k).trim()),
        animation: getComputedStyle(document.querySelector('.sweep')).animationName,
        transform: getComputedStyle(document.querySelector('.motion-card')).transform,
        transition: getComputedStyle(document.querySelector('.motion-card')).transitionDuration
      }));
      assert(motion.durations.every(v => v === '0ms') && motion.animation === 'none' && motion.transform === 'none' && motion.transition === '0s', name + ': reduced motion is not static');
      await page.locator('#sample-action').click();
      assert((await page.locator('#sample-status').textContent()).includes('no order was created'), name + ': text status missing');
      // Browser zoom itself remains a manual check. This tests 200% CSS layout zoom explicitly.
      await page.setViewportSize({ width: 640, height: 1000 });
      await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
      for (const forcedFallback of [false, true]) {
        await page.locator('#fallback').setChecked(forcedFallback);
        const clipping = await page.evaluate(() => {
          const failures = [];
          const clips = value => ['hidden', 'clip', 'scroll', 'auto'].includes(value);
          for (const el of document.querySelectorAll('p,h1,h2,h3,li,dd,dt,label,button,select,textarea')) {
            const rect = el.getBoundingClientRect();
            let problem = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 ||
              rect.width === 0 || rect.height === 0;
            for (let node = el; node; node = node.parentElement) {
              const style = getComputedStyle(node);
              if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) problem = true;
              if (node === el || (!clips(style.overflowX) && !clips(style.overflowY))) continue;
              const ancestor = node.getBoundingClientRect();
              // getBoundingClientRect includes CSS zoom; client/offset dimensions do
              // not. Compare every essential box against each clipping padding box
              // in the same coordinate system, allowing only rounding tolerance.
              const scaleX = node.offsetWidth ? ancestor.width / node.offsetWidth : 1;
              const scaleY = node.offsetHeight ? ancestor.height / node.offsetHeight : 1;
              const left = ancestor.left + node.clientLeft * scaleX;
              const top = ancestor.top + node.clientTop * scaleY;
              const right = left + node.clientWidth * scaleX;
              const bottom = top + node.clientHeight * scaleY;
              if ((clips(style.overflowX) && (rect.left < left - 1 || rect.right > right + 1)) ||
                  (clips(style.overflowY) && (rect.top < top - 1 || rect.bottom > bottom + 1))) problem = true;
            }
            if (problem) failures.push(el.id || el.tagName);
          }
          if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) failures.push('document horizontal overflow');
          return failures;
        });
        assert(clipping.length === 0, name + ': clipped essential fixture content at 200% layout zoom');
      }
      await page.screenshot({ path: path.join(output, name + '-layout-200.png'), fullPage: true });
      assert(errors.length === 0, name + ': browser script errors');
      report.cases.push({ name, outcome: 'pass', viewport_css_px: [640,1000], layout_zoom: 2, browser_zoom: 'not tested', font_mode: 'token-stacks and forced generic; no external fonts', reduced_motion: motion, keyboard_targets_reached: [...reached].sort(), keyboard_focus_checks: focusChecks });
      await context.close();
    }
    report.inputs_sha256_after = Object.fromEntries(sources.map(p => [p, hash(p)]));
    report.changed_inputs = sources.filter(p => report.inputs_sha256[p] !== report.inputs_sha256_after[p]);
    report.source_revision_after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    report.source_unchanged = report.changed_inputs.length === 0 && report.source_revision === report.source_revision_after;
    assert(report.source_unchanged, 'source inputs changed during browser verification; frozen observations cannot approve the changed candidate');
    report.outcome = 'pass-local-fixture';
    save();
    process.exitCode = 0;
  } catch (error) {
    // Never print arbitrary browser/network messages or data. Detailed prerequisites are documented.
    report.outcome = 'error';
    report.error_type = error.name;
    report.error = error instanceof FixtureCheckError ? error.message : 'Local browser/fixture check failed. Verify pinned dependencies, browser installation and scenarios; no browser acceptance can be claimed.';
    save();
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})();
