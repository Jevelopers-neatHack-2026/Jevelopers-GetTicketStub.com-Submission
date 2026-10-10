import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTED_GROUPS = Object.freeze(Array.from({ length: 13 }, (_, index) => `OPS${String(index + 1).padStart(2, '0')}_`));
const FIXTURES = new Set(['quota-shutdown-restart', 'runbook-clean-start']);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  if (result.status !== 0) throw new Error('Git revision metadata is unavailable.');
  return result.stdout.trim();
}

function currentBaseRevision() {
  const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'refs/remotes/origin/main'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }
  });
  if (mergeBase.status === 0 && /^[a-f0-9]{40}$/u.test(mergeBase.stdout.trim())) {
    return mergeBase.stdout.trim();
  }
  return git(['rev-parse', 'HEAD^1']);
}

function child(args, env = {}) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 120_000,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      NODE_NO_WARNINGS: '1',
      ...env
    }
  });
}

function parseTAP(text) {
  const names = [...text.matchAll(/^# Subtest: (OPS\d{2}_[^\r\n]+)/gmu)].map(match => match[1]);
  const testCount = Number(text.match(/^# tests (\d+)/mu)?.[1] ?? -1);
  const passCount = Number(text.match(/^# pass (\d+)/mu)?.[1] ?? -1);
  const skipped = Number(text.match(/^# skipped (\d+)/mu)?.[1] ?? -1);
  const failures = Number(text.match(/^# fail (\d+)/mu)?.[1] ?? -1);
  const unique = [...new Set(names)];
  const missing = EXPECTED_GROUPS.filter(prefix => !unique.some(name => name.startsWith(prefix)));
  return {
    testCount: testCount < 0 ? null : testCount,
    passCount: passCount < 0 ? null : passCount,
    failCount: failures,
    skippedCount: skipped,
    groupNames: unique,
    missingGroups: missing,
    complete: testCount === 13 && passCount === 13 && unique.length === 13 && missing.length === 0
      && failures === 0 && skipped === 0
  };
}

function currentChangedPaths() {
  const paths = git(['ls-files', '--modified', '--others', '--exclude-standard']).split('\n').filter(Boolean).sort();
  return paths.map(path => {
    const bytes = readFileSync(join(ROOT, path));
    return { path, bytes: bytes.byteLength, sha256: digest(bytes) };
  });
}

function writeArtifact(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return { path, bytes: bytes.byteLength, sha256: digest(bytes) };
}

function safeTap(text) {
  return `${text.split(/\r?\n/u).filter(line => line.startsWith('TAP version ')
    || line.startsWith('1..') || line.startsWith('# Subtest: OPS')
    || /^ok \d+ - OPS/u.test(line) || /^not ok \d+ - OPS/u.test(line)
    || /^# (tests|pass|fail|cancelled|skipped|todo) \d+/u.test(line))
    .join('\n')}\n`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const [caseId, mode, fixture] = process.argv.slice(2);
if (caseId !== 'AH-11-OPS' || mode !== 'mock' || !FIXTURES.has(fixture)) {
  fail('Usage: node tests/operations/verify-fixture.js AH-11-OPS mock quota-shutdown-restart|runbook-clean-start');
}
const nodeVersion = process.versions.node;
if (!/^v22\.23\.3$/u.test(`v${nodeVersion}`)) fail('AH-11-OPS evidence requires the pinned Node v22.23.3 toolchain.');

let baseHead;
let startHead;
let startTree;
let dirtyBefore;
let sourceFiles;
try {
  baseHead = currentBaseRevision();
  startHead = git(['rev-parse', 'HEAD']);
  startTree = git(['rev-parse', 'HEAD^{tree}']);
  dirtyBefore = git(['status', '--porcelain']).length > 0;
  sourceFiles = currentChangedPaths();
} catch {
  fail('AH-11-OPS source identity could not be established.');
}

const artifactDirectory = resolve(ROOT, '.runtime-artifacts');
const stem = `AH-11-OPS-${fixture}`;
const metricsPath = join(tmpdir(), `ah11-ops-metrics-${process.pid}-${Date.now()}.json`);
const testResult = child(['--test', '--test-concurrency=1', '--test-reporter=tap', 'tests/operations/operations.test.js'], {
  AH11_OPS_METRICS_FILE: metricsPath
});
const tapText = `${testResult.stdout ?? ''}${testResult.stderr ?? ''}`;
const tapSummary = parseTAP(tapText);
const tapArtifact = writeArtifact(join(artifactDirectory, `${stem}.tap`), Buffer.from(safeTap(tapText), 'utf8'));
let metrics = null;
try {
  metrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
} catch {
  try { process.stderr.write('AH-11-OPS runtime metrics were not produced.\n'); } catch {}
}

let runbookArtifact = null;
let runbookResult = null;
if (fixture === 'runbook-clean-start') {
  runbookResult = child(['tests/operations/runbook-clean-start.mjs']);
  const output = (runbookResult.stdout ?? '').trim().split(/\r?\n/u).filter(Boolean);
  let runbookRecord = null;
  try {
    if (output.length === 1) runbookRecord = JSON.parse(output[0]);
  } catch {}
  if (runbookRecord && runbookRecord.fixture === fixture && runbookRecord.mode === 'mock'
      && runbookRecord.schemaVersion === 6 && runbookRecord.providerCalls === 0
      && Number.isSafeInteger(runbookRecord.supervisorRssBytes) && runbookRecord.supervisorRssBytes > 0
      && Number.isFinite(runbookRecord.firstStopElapsedMs) && runbookRecord.firstStopElapsedMs >= 0
      && Number.isFinite(runbookRecord.secondStopElapsedMs) && runbookRecord.secondStopElapsedMs >= 0
      && runbookRecord.sigtermDrain === 'pass' && runbookRecord.restart === 'pass') {
    runbookArtifact = writeArtifact(join(artifactDirectory, `${stem}.jsonl`), Buffer.from(`${JSON.stringify(runbookRecord)}\n`, 'utf8'));
  }
}

const resultCode = testResult.status ?? 1;
const runbookCode = runbookResult ? (runbookResult.status ?? 1) : null;
const allNetworkCallCountsZero = metrics !== null
  && metrics.providerCalls === 0
  && metrics.blockedExternalNetworkAttempts === 0;
const resourceMetricsComplete = metrics !== null
  && metrics.ownedRunnerStarts >= 1
  && metrics.ownedRunnerTermSignals >= 1
  && metrics.ownedRunnerKillSignals >= 1
  && metrics.ownedRunnerShutdownSamples >= 1
  && Number.isFinite(metrics.ownedRunnerShutdownElapsedMsMax)
  && metrics.ownedRunnerShutdownElapsedMsMax <= 1_000
  && metrics.processSigtermDrainSamples >= 5
  && Number.isFinite(metrics.processSigtermDrainElapsedMsMax)
  && metrics.processSigtermDrainElapsedMsMax <= 3_000
  && metrics.maxSupervisorRssBytes > 0
  && metrics.maxRunnerRssBytes > 0;
const externalMode = 'synthetic_offline';
const manifest = {
  schema: 'agent-harness.ah11-ops-evidence.v1',
  case: caseId,
  fixture,
  dependencyMode: externalMode,
  component: {
    repository: 'Jevelopers-neatHack-2026/agent-harness',
    baseHead,
    executedHead: startHead,
    executedTree: dirtyBefore ? null : startTree,
    workingTreeWasDirty: dirtyBefore,
    node: nodeVersion,
    schemaVersion: 6,
    checkpointEnvelopeVersion: 2,
    changedSourceFiles: sourceFiles
  },
  suite: {
    command: 'node --test --test-concurrency=1 --test-reporter=tap tests/operations/operations.test.js',
    exitCode: resultCode,
    ...tapSummary,
    requiredGroups: EXPECTED_GROUPS,
    skippedRequiredCases: tapSummary.skippedCount
  },
  runbook: runbookResult ? {
    command: 'node tests/operations/runbook-clean-start.mjs',
    exitCode: runbookCode,
    output: runbookArtifact,
    passed: runbookCode === 0 && runbookArtifact !== null
  } : null,
  resourceAndNetworkEvidence: {
    ...metrics,
    verifierRssBytes: process.memoryUsage().rss,
    resourceMetricsComplete,
    controlScope: 'Node DNS/HTTPS API guard and synthetic responders inside the JEV boundary child; not OS-wide or host egress enforcement',
    allProviderCallsZero: allNetworkCallCountsZero,
    paidCalls: 0
  },
  artifacts: { tap: tapArtifact },
  passed: resultCode === 0 && tapSummary.complete && tapSummary.skippedCount === 0
    && allNetworkCallCountsZero && resourceMetricsComplete
    && (fixture !== 'runbook-clean-start' || (runbookCode === 0 && runbookArtifact !== null))
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const manifestArtifact = writeArtifact(join(artifactDirectory, `${stem}.json`), manifestBytes);
const sidecar = Buffer.from(`${manifestArtifact.sha256}  ${stem}.json\n`, 'utf8');
const sidecarArtifact = writeArtifact(join(artifactDirectory, `${stem}.json.sha256`), sidecar);

try { rmSync(metricsPath, { force: true }); } catch {}

process.stdout.write(JSON.stringify({
  case: caseId, fixture, passed: manifest.passed,
  tests: tapSummary.testCount, pass: tapSummary.passCount, fail: tapSummary.failCount,
  skipped: tapSummary.skippedCount, providerCalls: metrics?.providerCalls ?? null,
  executedHead: startHead, executedTree: manifest.component.executedTree,
  artifacts: [tapArtifact, manifestArtifact, sidecarArtifact, ...(runbookArtifact ? [runbookArtifact] : [])]
}) + '\n');
if (!manifest.passed) process.exitCode = 1;
