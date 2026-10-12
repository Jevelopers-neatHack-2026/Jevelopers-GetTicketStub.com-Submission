#!/usr/bin/env node
'use strict';
// Local synthetic consumer browser checks. No provider requests or approval claim.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const output = path.resolve(process.argv[3] || path.join(root, 'out/brand/consumer-browser', new Date().toISOString().replace(/[:.]/g, '-')));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(output, { recursive: true });
const report = { schema: 'ticketstub-local-consumer-browser@1', mode: 'synthetic local review archive',
  outcome: 'error', started_at: new Date().toISOString(), cases: [], blocked_external_requests: 0,
  release_approved: false, consumer_adoption: false, font_provider_checks: 'not_run',
  limitations: ['Platform fallback fonts only; no external-font availability evidence.',
    'Automated local Chromium layout, contrast and keyboard checks; no assistive-technology or human acceptance.',
    'No consumer application, provider behavior, real-browser zoom, rights or release approval is asserted.'] };
const prepare = String.raw`
import json, sys
from pathlib import Path
root, output = map(Path, sys.argv[1:])
sys.path.insert(0, str(root / 'tools'))
import build_distribution as dist
import check_consumers as consumers
source, tree = dist.source_identity(root)
data, initial = dist.build_bytes(root, 'review')
manifest, blobs = dist.verify_bytes(data, dist.digest(data), source)
dist.verify_source(root, source, manifest, blobs)
fixture = output / 'fixture'
fixture.mkdir()
for name, content in blobs.items():
    target = fixture / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
fixture_hashes = {}
for name in ('plain.html', 'plain.css', 'tailwind.html', 'tailwind.css'):
    source_name = name + '.in' if name.endswith('.html') else name
    source_path = 'distribution/fixtures/' + source_name
    content = dist.source_blob(root, source, source_path)
    (fixture / name).write_bytes(content)
    fixture_hashes[source_path] = dist.digest(content)
consumers.validate_plain(fixture / 'brand-kit', fixture)
tailwind = consumers.validate_tailwind(root, fixture, fixture / 'brand-kit')
if tailwind['status'] != 'pass':
    raise dist.DistributionError('pinned Tailwind compile is required; a skip is not a pass')
if dist.source_identity(root) != (source, tree):
    raise dist.DistributionError('source changed during fixture preparation')
(output / 'review-candidate.zip').write_bytes(data)
print(json.dumps(dict(source_sha=source, source_tree=tree, archive_sha256=dist.digest(data),
    files_digest=manifest['files_digest'], fixture_sha256=fixture_hashes, tailwind=tailwind,
    compiled_css_sha256=dist.digest((fixture / 'compiled.css').read_bytes()))))
`;
function rgb(value) {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
  if (!match) throw new Error('Expected an opaque computed RGB color');
  return match.slice(1).map(Number);
}
function contrast(a, b) {
  const lum = color => rgb(color).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
    .reduce((total, v, i) => total + v * [.2126, .7152, .0722][i], 0);
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

(async () => {
  let browser, server;
  try {
    report.checker_sha256 = sha(fs.readFileSync(__filename));
    report.package = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-I', '-c', prepare, root, output], { encoding: 'utf8', timeout: 180000 }));
    const playwrightPath = path.join(root, 'tools/browser-dev/node_modules/playwright');
    report.playwright = JSON.parse(fs.readFileSync(path.join(playwrightPath, 'package.json'))).version;
    const pinned = JSON.parse(fs.readFileSync(path.join(root, 'tools/browser-dev/package.json'))).devDependencies.playwright;
    if (report.playwright !== pinned || pinned !== '1.56.1') throw new Error('Install pinned Playwright 1.56.1');
    const fixture = path.join(output, 'fixture');
    const routes = new Map([
      ['plain.html', 'text/html'], ['plain.css', 'text/css'], ['tailwind.html', 'text/html'],
      ['compiled.css', 'text/css'], ['brand-kit/tokens/tokens.css', 'text/css'], ['brand-kit/logo/wordmark.svg', 'image/svg+xml']
    ].map(([name, type]) => ['/' + name, { type, bytes: fs.readFileSync(path.join(fixture, name)) }]));
    const logo = routes.get('/brand-kit/logo/wordmark.svg').bytes.toString();
    if (!logo.includes('<g fill="#17140F">')) throw new Error('Review the logo contrast assertion against the actual wordmark fill');
    report.served_sha256 = Object.fromEntries([...routes].map(([name, item]) => [name, sha(item.bytes)]));
    server = http.createServer((req, res) => {
      if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
      const item = routes.get(req.url);
      if (req.method !== 'GET' || !item) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', item.type);
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'none'; connect-src 'none'; script-src 'none'");
      res.end(item.bytes);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await require(playwrightPath).chromium.launch({ headless: true });
    report.browser = browser.version();
    report.node = process.version;
    const themes = [['os-light', 'light', 'auto', 'rgb(244, 236, 221)'], ['os-dark', 'dark', 'auto', 'rgb(23, 20, 15)'],
      ['explicit-light', 'dark', 'light', 'rgb(244, 236, 221)'], ['explicit-dark', 'light', 'dark', 'rgb(23, 20, 15)']];
    for (const name of ['plain', 'tailwind']) for (const [theme, colorScheme, selected, expectedCanvas] of themes) {
      for (const [width, reducedMotion] of [[1080, 'no-preference'], [375, 'reduce']]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion, serviceWorkers: 'block' });
        await context.route('**/*', route => {
          if (route.request().url().startsWith(origin + '/')) return route.continue();
          report.blocked_external_requests++;
          return route.abort();
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', () => errors.push('browser page error'));
        page.on('response', response => { if (response.status() >= 400) errors.push('local resource request failed'); });
        page.on('console', message => { if (message.type() === 'error') errors.push('browser console error or blocked resource'); });
        await page.goto(origin + '/' + name + '.html', { waitUntil: 'networkidle' });
        await page.evaluate(value => value === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', value), selected);
        // The normal fixture has the real 240ms duration utility. Measure the
        // settled selected theme, rather than an intermediate transition color.
        await page.waitForTimeout(350);
        const measurements = await page.evaluate(() => {
          const bg = node => { for (let el = node; el; el = el.parentElement) { const value = getComputedStyle(el).backgroundColor; if (value !== 'rgba(0, 0, 0, 0)') return value; } return null; };
          return { canvas: bg(document.body), overflow: document.documentElement.scrollWidth > innerWidth,
            reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            buttons: [...document.querySelectorAll('button')].map(el => { const c = getComputedStyle(el); return { foreground: c.color, background: bg(el), surrounding: bg(el.parentElement), transitionDuration: c.transitionDuration, animationName: c.animationName }; }),
            logos: [...document.images].map(el => ({ loaded: el.complete && el.naturalWidth > 0, foreground: 'rgb(23, 20, 15)', background: bg(el.parentElement), width: el.getBoundingClientRect().width })) };
        });
        const failures = [...errors];
        if (measurements.buttons.length !== (name === 'plain' ? 2 : 1) ||
            measurements.logos.length !== (name === 'plain' ? 1 : 0)) failures.push('required fixture controls or logo are missing or changed');
        if (measurements.canvas !== expectedCanvas) failures.push('canvas does not use selected semantic background');
        if (measurements.overflow) failures.push('horizontal page overflow');
        measurements.buttons.forEach(item => {
          item.contrast = contrast(item.foreground, item.background);
          if (item.contrast < 4.5) failures.push('normal CTA label contrast below 4.5:1');
          if (reducedMotion === 'reduce' && (item.animationName !== 'none' || item.transitionDuration.split(',').some(v => parseFloat(v) !== 0))) failures.push('motion remains in reduced mode');
        });
        measurements.logos.forEach(item => {
          item.contrast = contrast(item.foreground, item.background);
          if (!item.loaded || item.width <= 0) failures.push('logo did not render');
          if (item.contrast < 3) failures.push('ink logo lacks the intended visible contrasting surface');
        });
        const focus = [];
        for (let index = 0; index < measurements.buttons.length; index++) {
          await page.keyboard.press('Tab');
          const item = await page.evaluate(() => {
            const el = document.activeElement, c = getComputedStyle(el), r = el.getBoundingClientRect();
            return { button: el.tagName === 'BUTTON', visible: el.matches(':focus-visible'), color: c.outlineColor,
              width: parseFloat(c.outlineWidth), style: c.outlineStyle, offset: parseFloat(c.outlineOffset),
              inViewport: r.left - 7 >= 0 && r.right + 7 <= innerWidth && r.top - 7 >= 0 && r.bottom + 7 <= innerHeight };
          });
          const surrounding = measurements.buttons[index].surrounding;
          item.contrast = surrounding === null ? null : contrast(item.color, surrounding);
          if (!item.button || !item.visible || item.width < 3 || item.offset < 4 || item.style === 'none' || !item.inViewport || item.contrast < 3 || item.contrast === null) failures.push('keyboard focus lacks a visible separated contrasting outline');
          focus.push(item);
        }
        const id = [name, theme, width, reducedMotion].join('-');
        const screenshot = id + '.png';
        await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
        report.cases.push({ id, fixture: name, theme, selected, colorScheme, viewport_width: width, reduced_motion: reducedMotion,
          measurements, focus, outcome: failures.length ? 'fail' : 'pass', failures, screenshot, screenshot_sha256: sha(fs.readFileSync(path.join(output, screenshot))) });
        await context.close();
      }
    }
    const finalIdentity = execFileSync(process.env.PYTHON || 'python3', ['-I', '-c',
      "import sys; from pathlib import Path; sys.path.insert(0,str(Path(sys.argv[1])/'tools')); import build_distribution as d; print(d.source_identity(Path(sys.argv[1]))[0])", root], { encoding: 'utf8', timeout: 30000 }).trim();
    if (finalIdentity !== report.package.source_sha || sha(fs.readFileSync(__filename)) !== report.checker_sha256 ||
        sha(fs.readFileSync(path.join(output, 'review-candidate.zip'))) !== report.package.archive_sha256 ||
        [...routes].some(([name, item]) => sha(fs.readFileSync(path.join(fixture, name.slice(1)))) !== sha(item.bytes))) {
      throw new Error('Source or served input changed during the browser run');
    }
    report.source_and_input_drift = 'none';
    report.outcome = report.cases.length === 16 && report.cases.every(item => item.outcome === 'pass') && report.blocked_external_requests === 0 ? 'pass' : 'fail';
  } catch (error) {
    report.error = error.message;
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    report.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ outcome: report.outcome, cases: report.cases.length, report: path.join(output, 'report.json'), release_approved: false }));
    process.exitCode = report.outcome === 'pass' ? 0 : 1;
  }
})();
