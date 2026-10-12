#!/usr/bin/env node
'use strict';
// Synthetic regressions run only in a disposable copy. No provider requests or
// consumer changes. An unavailable browser is a failure, never a negative pass.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const outputRoot = path.join(root, 'out/brand/accessibility-browser-regressions');
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-'));
const fixtureRoot = path.join(output, 'fixture');
const inputs = ['tokens/tokens.css', 'tokens/tokens.json', 'tokens/profile.json', 'tokens/mapping.json',
  'tools/accessibility-fixture/index.html', 'tools/accessibility-fixture/fixture.css',
  'tools/accessibility-fixture/fixture.js', 'tools/check_accessibility_browser.cjs',
  'tools/browser-dev/package.json', 'tools/browser-dev/package-lock.json'];
const report = {
  schema: 'ticketstub-browser-negative-regressions@1',
  mode: 'synthetic baseline and deliberately invalid local fixture copies; no owner acceptance',
  outcome: 'error', release_eligible: false, cases: [],
};
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

try {
  report.source_revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  report.runner_sha256 = digest(fs.readFileSync(__filename));
  report.inputs_sha256 = {};
  for (const relative of inputs) {
    const bytes = fs.readFileSync(path.join(root, relative));
    report.inputs_sha256[relative] = digest(bytes);
    const destination = path.join(fixtureRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
  const dependency = path.join(root, 'tools/browser-dev/node_modules');
  if (!fs.statSync(dependency).isDirectory()) throw new Error('Missing pinned browser dependency');
  fs.symlinkSync(dependency, path.join(fixtureRoot, 'tools/browser-dev/node_modules'), 'dir');
  fs.writeFileSync(path.join(fixtureRoot, '.gitignore'), 'out/\nnode_modules\n');
  // Give the synthetic copy its own revision; do not attribute mutated source to
  // the real checkout's HEAD. Mutations below remain visibly dirty in its report.
  const git = args => execFileSync('git', args, { cwd: fixtureRoot, stdio: 'pipe' });
  git(['init', '--quiet']);
  git(['add', '.gitignore', ...inputs]);
  git(['-c', 'user.name=Local synthetic accessibility regression', '-c', 'user.email=synthetic@example.invalid',
    'commit', '--quiet', '--no-gpg-sign', '--no-verify', '-m', 'Synthetic local accessibility fixture snapshot']);

  const stylesheet = path.join(fixtureRoot, 'tools/accessibility-fixture/fixture.css');
  const baselineCss = fs.readFileSync(stylesheet, 'utf8');
  const document = path.join(fixtureRoot, 'tools/accessibility-fixture/index.html');
  const baselineHtml = fs.readFileSync(document, 'utf8');
  const action = '<button type="button" class="cta" id="sample-action">Show sample confirmation</button>';
  if (!baselineHtml.includes(action)) throw new Error('Synthetic clipping fixture target is missing');
  const mutator = path.join(output, 'mutate-after-snapshot.cjs');
  // Trigger drift after the real runner has captured its inputs and starts its
  // loopback server. This controlled test hook changes no production code and
  // uses no timing guess, mocked browser result or external/provider request.
  fs.writeFileSync(mutator, "const fs=require('node:fs'),http=require('node:http');\n" +
    "const listen=http.Server.prototype.listen;\n" +
    "http.Server.prototype.listen=function(...args){this.once('listening',()=>fs.appendFileSync(" +
    JSON.stringify(stylesheet) + ", '\\n/* Synthetic post-snapshot source drift. */\\n'));return listen.apply(this,args);};\n");
  const cases = [
    { name: 'baseline', css: '', expectedExit: 0, expectedOutcome: 'pass-local-fixture' },
    { name: 'invisible-focus', css: ':is(button,input,textarea,select,a):focus-visible {outline-color:transparent;}',
      expectedExit: 1, expectedOutcome: 'error', expectedReason: 'focus indicator is invisible or below 3:1' },
    { name: 'ancestor-clipping', css: '@media(max-width:700px){.surface {height:50px;overflow:hidden;}}',
      expectedExit: 1, expectedOutcome: 'error', expectedReason: 'clipped essential fixture content at 200% layout zoom' },
    { name: 'clipped-focus-ring', css: '', clipFocus: true,
      expectedExit: 1, expectedOutcome: 'error', expectedReason: 'focus outline is clipped' },
    { name: 'source-drift-during-run', css: '', mutateDuringRun: true,
      expectedExit: 1, expectedOutcome: 'error', expectedReason: 'source inputs changed during browser verification' },
  ];
  for (const scenario of cases) {
    fs.writeFileSync(stylesheet, baselineCss + '\n/* Synthetic regression: ' + scenario.name + ' */\n' + scenario.css + '\n');
    fs.writeFileSync(document, scenario.clipFocus ? baselineHtml.replace(action,
      '<div style="width:fit-content;max-width:100%;overflow:hidden">' + action + '</div>') : baselineHtml);
    const command = [...(scenario.mutateDuringRun ? ['--require', mutator] : []), 'tools/check_accessibility_browser.cjs'];
    const processResult = spawnSync(process.execPath, command, {
      cwd: fixtureRoot, env: process.env, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
    });
    const row = { name: scenario.name, mode: 'synthetic', expected_exit: scenario.expectedExit,
      actual_exit: processResult.status, outcome: 'fail' };
    try {
      const summary = JSON.parse(processResult.stdout.trim().split('\n').at(-1));
      const evidencePath = path.resolve(fixtureRoot, summary.report);
      if (!evidencePath.startsWith(fixtureRoot + path.sep)) throw new Error('Report path escaped fixture');
      const bytes = fs.readFileSync(evidencePath);
      const evidence = JSON.parse(bytes);
      row.browser_report = path.relative(output, evidencePath);
      row.browser_report_sha256 = digest(bytes);
      row.browser_outcome = evidence.outcome;
      row.reason = evidence.error || null;
      row.source_unchanged = evidence.source_unchanged ?? null;
      row.changed_inputs = evidence.changed_inputs || [];
      const expected = !processResult.error && processResult.status === scenario.expectedExit &&
        evidence.outcome === scenario.expectedOutcome && evidence.release_eligible === false &&
        (scenario.expectedReason ? evidence.error?.includes(scenario.expectedReason) :
          evidence.cases.length === 4 && evidence.source_unchanged === true) &&
        (!scenario.mutateDuringRun || (evidence.source_unchanged === false &&
          evidence.changed_inputs?.includes('tools/accessibility-fixture/fixture.css')));
      row.outcome = expected ? 'pass' : 'fail';
    } catch (error) {
      row.error_type = error.name;
    }
    report.cases.push(row);
  }
  report.outcome = report.cases.length === cases.length && report.cases.every(row => row.outcome === 'pass') ? 'pass' : 'fail';
} catch (error) {
  report.error_type = error.name;
  report.error = 'Local regression prerequisite or execution failed; required cases have not passed.';
} finally {
  report.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outcome: report.outcome, cases: report.cases,
    report: path.relative(root, path.join(output, 'report.json')), release_eligible: false }));
  process.exitCode = report.outcome === 'pass' ? 0 : 1;
}
