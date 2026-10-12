/** Reproducible offline checks and sanitized evidence. Native fetch is intercepted. */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { action, fixtureState } from './state.mjs';
import { hash } from '../../src/controls/actions.mjs';
import { integratedTranscript } from './integrated-transcript.mjs';
import { createControlSchema } from '../../src/controls/schema.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtureDir = join(root, 'examples/frontend-action-roundtrip');
const args = process.argv.slice(2), runBrowser = args.includes('--browser');
const output = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
const results = [];
const reviewProbes = [];
function run(command, argv, cwd, label, env = {}) {
  // Keep Playwright's `node server.mjs` and its workers on this evaluated runtime.
  const result = spawnSync(command, argv, { cwd, encoding: 'utf8', env: {
    ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`, ...env } });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  const counts = {};
  for (const name of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) { const match = new RegExp(`^# ${name} ([0-9]+)$`, 'm').exec(result.stdout ?? ''); if (match) counts[name] = Number(match[1]); }
  results.push({ command: label, exit_code: result.status, passed: result.status === 0, ...(Object.keys(counts).length ? { counts } : {}) });
  for (const line of (result.stdout ?? '').split('\n')) if (line.startsWith('# {"controls_probe":')) reviewProbes.push(JSON.parse(line.slice(2)));
}
run(process.execPath, ['--test', '--test-reporter=tap', 'tests/controls/actions.test.mjs', 'tests/controls/integration.test.mjs', 'tests/controls/review-regressions.test.mjs', 'tests/controls/native.test.mjs', 'tests/controls/inspection-consumer.test.mjs', 'tests/controls/public-result.test.mjs', 'tests/controls/actual-inspection.test.mjs', 'tests/controls/inspection-result.test.mjs', 'tests/controls/composition-integration.test.mjs', 'tests/controls/composition-view.test.mjs', 'tests/controls/inflight-isolation.test.mjs', 'tests/controls/composition-scope-backend.test.mjs', 'tests/controls/reviewer-midflight-corrupt.test.mjs', 'tests/controls/composition-recovery.test.mjs'], root, 'node --test --test-reporter=tap tests/controls/actions.test.mjs tests/controls/integration.test.mjs tests/controls/review-regressions.test.mjs tests/controls/native.test.mjs tests/controls/inspection-consumer.test.mjs tests/controls/public-result.test.mjs tests/controls/actual-inspection.test.mjs tests/controls/inspection-result.test.mjs tests/controls/composition-integration.test.mjs tests/controls/composition-view.test.mjs tests/controls/inflight-isolation.test.mjs tests/controls/composition-scope-backend.test.mjs tests/controls/reviewer-midflight-corrupt.test.mjs tests/controls/composition-recovery.test.mjs');
if (runBrowser || args.includes('--types')) run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', '../../tests/controls/types/tsconfig.json'],
  fixtureDir, 'tsc --strict --module NodeNext (source and public actual inspection consumers)');
if (runBrowser) run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--reporter=list,json'], fixtureDir,
  'npm test (Playwright Chromium + axe)', { PLAYWRIGHT_JSON_OUTPUT_FILE: join(fixtureDir, 'test-results/browser-results.json') });
const digest = createHash('sha256');
const sourceFiles = [];
for (const dir of ['src/controls', 'tests/controls', 'examples/frontend-action-roundtrip', 'fixtures/controls']) {
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', 'test-results', 'playwright-report'].includes(entry.name) || /^evidence-.*\.json$/.test(entry.name)) continue;
      const name = join(path, entry.name);
      if (entry.isDirectory()) walk(name);
      else { const rel = relative(root, name); sourceFiles.push(rel); digest.update(rel); digest.update(readFileSync(name)); }
    }
  }
  walk(join(root, dir));
}
for (const rel of ['.github/workflows/controls.yml', 'docs/controls-integration.md']) {
  sourceFiles.push(rel); digest.update(rel); digest.update(readFileSync(join(root, rel)));
}
const transcript = await integratedTranscript();
const dependency_files = {};
for (const directory of ['src/api', 'src/runtime', 'src/planning', 'src/versions', 'src/storage', 'src/telemetry', 'src/inspection', 'src/contracts', 'src/models']) {
  function fingerprint(path) { for (const item of readdirSync(path, { withFileTypes: true })) { if (item.name === 'node_modules') continue; const name = join(path, item.name); if (item.isDirectory()) fingerprint(name); else dependency_files[relative(root, name)] = createHash('sha256').update(readFileSync(name)).digest('hex'); } }
  fingerprint(join(root, directory));
}
for (const name of ['package.json', 'package-lock.json', 'Makefile', 'fixtures/planning/research-packages.mjs', 'fixtures/contracts/creative/current.json', 'fixtures/models/png.mjs', 'fixtures/models/valid-16x16.jpg', 'fixtures/models/valid-16x16.webp']) dependency_files[name] = createHash('sha256').update(readFileSync(join(root, name))).digest('hex');
const state = fixtureState();
let browser_summary = null;
if (runBrowser) { const report = JSON.parse(readFileSync(join(fixtureDir, 'test-results/browser-results.json'), 'utf8')); browser_summary = report.stats; }
const evidence = { evidence_version: 'controls-offline-evidence/2.0', dependency_mode: 'mock', billing_mode: 'simulated',
  runtime: process.version, platform: process.platform, architecture: process.arch, host_validation: 'local_only',
  schema_version: 'creative-controls/1.1', action_version: 'creative-apply/1.1',
  composition_schema_version: 'creative-composition-controls/1.0', composition_action_version: 'creative-composition-apply/1.0', composition_renewal_action_version: 'creative-composition-renew/1.0',
  composition_backend_api_versions: ['1.2','1.3'],
  contract_status: 'local-consumer-proposal', source_fingerprint_sha256: digest.digest('hex'), source_files: sourceFiles,
  fixture_schema_sha256: hash(createControlSchema(state)), fixture_action_sha256: hash(action(state)),
  checks: results, review_probes: reviewProbes, browser_summary, browser_exercised: runBrowser && results.find(r => r.command === 'npm test (Playwright Chromium + axe)')?.passed === true,
  types_checked: results.find(r => r.command === 'tsc --strict --module NodeNext (source and public actual inspection consumers)')?.passed === true,
  dependency_files,
  base_revision: '18b5e6076f6275af763bdd45bf77c6a644a8bddc',
  authoritative_contract_revision: 'c4caaccc2ea63b273eeac17ed89af8ac64f6bbde',
  authoritative_checklist_revision: 'ff1f6d2df816ebbff34742f51be728fcb5c28cb5',
  actual_api_transcript: transcript,
  calls: { application_provider_live: 0, fixture_apply_image: transcript.final_counters.image_calls, fixture_apply_jev: transcript.final_counters.jev_calls, fixture_apply_reservations: transcript.final_counters.reservations }, approval_created: false, purchase_created: false,
  pending: ['canonical external schema publication and consumer acknowledgement', 'full CE06 eight-bucket routing, compound and correction consumers plus exact full-state handoff', 'live observer/JEV execution and external inspection policy acceptance', 'application authentication/authorization',
    'harness outbox consumer and paid artwork dispatch', 'live providers and external release acceptance',
    'CloudLinux/CageFS x86_64 host validation (exact Node 22 patch unknown)'],
  passed: results.every(r => r.passed) };
if (output) {
  const path = join(root, output);
  mkdirSync(dirname(path), { recursive: true });
  // Explicit LF byte keeps the artifact unambiguous when copied through clients
  // that escape source text. Verify the actual emitted file, not an in-memory copy.
  writeFileSync(path, Buffer.concat([Buffer.from(JSON.stringify(evidence, null, 2), 'utf8'), Buffer.from([0x0a])]));
  const emitted = readFileSync(path);
  assert.equal(emitted.at(-1), 0x0a, 'Evidence must end with a newline byte');
  assert.deepEqual(JSON.parse(emitted.toString('utf8')), evidence, 'Emitted evidence must parse and preserve the measured result');
}
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.passed) process.exitCode = 1;
