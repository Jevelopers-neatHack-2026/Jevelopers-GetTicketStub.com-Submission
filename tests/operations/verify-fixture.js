import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTED_GROUPS = Object.freeze(Array.from({ length: 13 }, (_, index) => `OPS${String(index + 1).padStart(2, '0')}_`));
const REQUIRED_LOCAL_CASES = Object.freeze([
  'OPS01.C01', 'OPS01.C02',
  'OPS02.C01', 'OPS02.C02', 'OPS02.C03', 'OPS02.C04', 'OPS02.C05',
  'OPS03.C01', 'OPS03.C02', 'OPS03.C03', 'OPS03.C04',
  'OPS04.C01', 'OPS04.C02',
  'OPS05.C01', 'OPS05.C02', 'OPS05.C03', 'OPS05.C04', 'OPS05.C05', 'OPS05.C06', 'OPS05.C07', 'OPS05.C08', 'OPS05.C09', 'OPS05.C10',
  'OPS05.C11', 'OPS05.C12', 'OPS05.C13', 'OPS05.C14',
  'OPS06.C01', 'OPS06.C02', 'OPS06.C03',
  'OPS07.C01', 'OPS07.C02', 'OPS07.C03', 'OPS07.C04', 'OPS07.C05',
  'OPS08.C01', 'OPS08.C02', 'OPS08.C03',
  'OPS09.C01', 'OPS09.C02', 'OPS09.C03', 'OPS09.C04', 'OPS09.C05',
  'OPS10.C01',
  'OPS11.C01', 'OPS11.C02',
  'OPS12.C01',
  'OPS13.C01'
]);
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
  const names = [...text.matchAll(/^[ \t]*# Subtest: ((?:OPS\d{2}_[^\r\n]+)|(?:OPS\d{2}\.C\d{2}[^\r\n]*))/gmu)].map(match => match[1]);
  const testCount = Number(text.match(/^# tests (\d+)/mu)?.[1] ?? -1);
  const passCount = Number(text.match(/^# pass (\d+)/mu)?.[1] ?? -1);
  const skipped = Number(text.match(/^# skipped (\d+)/mu)?.[1] ?? -1);
  const failures = Number(text.match(/^# fail (\d+)/mu)?.[1] ?? -1);
  const unique = [...new Set(names)];
  const missing = EXPECTED_GROUPS.filter(prefix => !unique.some(name => name.startsWith(prefix)));
  const caseNames = unique.filter(name => /^OPS\d{2}\.C\d{2}(?:\s|$)/u.test(name)).map(name => name.match(/^OPS\d{2}\.C\d{2}/u)[0]);
  const uniqueCases = [...new Set(caseNames)];
  const missingCases = REQUIRED_LOCAL_CASES.filter(id => !uniqueCases.includes(id));
  return {
    testCount: testCount < 0 ? null : testCount,
    passCount: passCount < 0 ? null : passCount,
    failCount: failures,
    skippedCount: skipped,
    groupNames: unique,
    requiredLocalCases: REQUIRED_LOCAL_CASES,
    executedLocalCases: uniqueCases,
    missingLocalCases: missingCases,
    missingGroups: missing,
    complete: testCount === 13 + REQUIRED_LOCAL_CASES.length
      && passCount === 13 + REQUIRED_LOCAL_CASES.length
    && unique.filter(name => /^OPS\d{2}_/u.test(name)).length === 13
      && uniqueCases.length === REQUIRED_LOCAL_CASES.length
      && missingCases.length === 0 && missing.length === 0
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

function changedPathsBetween(base, head) {
  const names = git(['diff', '--name-only', '--diff-filter=ACMRT', base, head]).split('\n').filter(Boolean).sort();
  return names.map(path => {
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
    || /^\s*(?:ok|not ok) \d+ - OPS/u.test(line) || /^ok \d+ - OPS/u.test(line) || /^not ok \d+ - OPS/u.test(line)
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
  sourceFiles = changedPathsBetween(baseHead, startHead);
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
let runbookRecoveryArtifact = null;
let runbookResult = null;
let recoveryResult = null;
if (fixture === 'runbook-clean-start') {
  runbookResult = child(['tests/operations/runbook-clean-start.mjs']);
  const output = (runbookResult.stdout ?? '').trim().split(/\r?\n/u).filter(Boolean);
  let runbookRecord = null;
  try {
    if (output.length === 1) runbookRecord = JSON.parse(output[0]);
  } catch {}
  const shutdownMarkers = [...(runbookResult.stderr ?? '').matchAll(/^AH11_SHUTDOWN_SIGNAL (\d+)$/gmu)];
  const processCloseElapsedMs = shutdownMarkers.length > 0
    ? Number(process.hrtime.bigint() - BigInt(shutdownMarkers.at(-1)[1])) / 1_000_000
    : null;
  if (runbookRecord && runbookRecord.fixture === fixture && runbookRecord.mode === 'mock'
      && runbookRecord.schemaVersion === 6 && runbookRecord.providerCalls === 0
      && Number.isSafeInteger(runbookRecord.supervisorRssBytes) && runbookRecord.supervisorRssBytes > 0
      && Number.isFinite(runbookRecord.firstStopElapsedMs) && runbookRecord.firstStopElapsedMs >= 0
      && Number.isFinite(runbookRecord.secondStopElapsedMs) && runbookRecord.secondStopElapsedMs >= 0
      && runbookRecord.sigtermDrain === 'pass' && runbookRecord.restart === 'pass'
      && Number.isFinite(processCloseElapsedMs) && processCloseElapsedMs >= 0) {
    runbookArtifact = writeArtifact(join(artifactDirectory, `${stem}.jsonl`), Buffer.from(`${JSON.stringify({
      ...runbookRecord,
      processCloseElapsedMs,
      processCloseMeasuredFrom: 'last SIGTERM to parent-observed child close',
      shutdownSignalCount: shutdownMarkers.length
    })}\n`, 'utf8'));
  }
  const recoveryPath = join(artifactDirectory, 'AH-11-OPS-runbook-recovery.jsonl');
  recoveryResult = child(['tests/operations/runbook-recovery-cases.mjs', recoveryPath]);
  const recoveryOutput = (recoveryResult.stdout ?? '').trim().split(/\r?\n/u).filter(Boolean);
  let recoverySummary = null;
  try { if (recoveryOutput.length === 1) recoverySummary = JSON.parse(recoveryOutput[0]); } catch {}
  let recoveryRows = [];
  try { recoveryRows = readFileSync(recoveryPath, 'utf8').trim().split(/\r?\n/u).map(line => JSON.parse(line)); } catch {}
  const expectedRecoveryCases = [
    'busy_store_spans_stop', 'store_unavailable', 'future_schema',
    'stuck_runner_review_escalation', 'unknown_hold_restart_escalation'
  ];
  if (recoverySummary?.cases === expectedRecoveryCases.length
      && recoverySummary?.passed === expectedRecoveryCases.length
      && recoverySummary?.providerCalls === 0
      && recoveryRows.length === expectedRecoveryCases.length
      && expectedRecoveryCases.every((caseId, index) => recoveryRows[index]?.case === caseId
        && recoveryRows[index]?.outcome === 'pass' && recoveryRows[index]?.providerCalls === 0)
      && !/tenant-|project-|hold-ref|sqlite/iu.test(recoveryRows.map(row => JSON.stringify(row)).join('\n'))) {
    runbookRecoveryArtifact = writeArtifact(recoveryPath, Buffer.from(`${recoveryRows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8'));
  }
}

const resultCode = testResult.status ?? 1;
const runbookCode = runbookResult ? (runbookResult.status ?? 1) : null;
const allNetworkCallCountsZero = metrics !== null
  && metrics.providerCalls === 0
  && metrics.blockedExternalNetworkAttempts === 0;
const uploadWorkflow = readFileSync(join(ROOT, '.github/workflows/runtime-foundation.yml'), 'utf8');
const runbookJsonlMembers = [runbookArtifact, runbookRecoveryArtifact].filter(Boolean);
const referencedArtifactMembers = [tapArtifact, ...runbookJsonlMembers];
const artifactMembersIntegrity = referencedArtifactMembers.every(artifact => {
  try {
    const bytes = readFileSync(artifact.path);
    return bytes.byteLength === artifact.bytes && digest(bytes) === artifact.sha256;
  } catch {
    return false;
  }
});
const jsonlMembersIncludedInUpload = runbookJsonlMembers.every(artifact =>
  artifact.path.startsWith(`${artifactDirectory}/`)
  && basename(artifact.path).startsWith('AH-11-OPS-')
  && basename(artifact.path).endsWith('.jsonl'))
  && /\.runtime-artifacts\/AH-11-OPS-\*\.jsonl/u.test(uploadWorkflow);
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
  && metrics.processSigintSignalsSent >= 1
  && metrics.processCloseSamples >= 2
  && Number.isFinite(metrics.processCloseElapsedMsMax)
  && metrics.processCloseElapsedMsMax <= 3_000
  && metrics.runnerDeadlineCloseSamples >= 1
  && Number.isFinite(metrics.runnerDeadlineCloseElapsedMsMax)
  && metrics.runnerDeadlineCloseElapsedMsMax <= 1_500
  && metrics.resourceHighWaterSamples >= 1
  && metrics.ownedRunnerCountHighWater >= 2
  && metrics.supervisorOpenFileDescriptors > 0
  && metrics.runnerOpenFileDescriptors > 0
  && metrics.storeReservedHighWaterBytes > 0
  && metrics.storeHighWaterBytes + 1 <= metrics.storeReservedHighWaterBytes
  && metrics.databaseHighWaterBytes > 0
  && metrics.walHighWaterBytes > 0
  && metrics.shmHighWaterBytes > 0
  && metrics.freeSpaceLowWaterBytes > 0
  && metrics.pendingEventHighWaterRecords > 0
  && metrics.reservedEventHighWaterSlots > 0
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
    requiredLocalCases: REQUIRED_LOCAL_CASES,
    skippedRequiredCases: tapSummary.skippedCount
  },
  runbook: runbookResult ? {
    command: 'node tests/operations/runbook-clean-start.mjs',
    exitCode: runbookCode,
    output: runbookArtifact,
    passed: runbookCode === 0 && runbookArtifact !== null
      && recoveryResult?.status === 0 && runbookRecoveryArtifact !== null,
    recoveryCommand: 'node tests/operations/runbook-recovery-cases.mjs <transcript-path>',
    recoveryExitCode: recoveryResult?.status ?? null,
    recoveryCases: runbookRecoveryArtifact ? 5 : 0,
    recoveryOutput: runbookRecoveryArtifact
  } : null,
  artifactIntegrity: {
    referencedMembers: referencedArtifactMembers,
    allReferencedMembersPresentAndDigestCorrect: artifactMembersIntegrity,
    jsonlMembersIncludedInWorkflowUpload: jsonlMembersIncludedInUpload
  },
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
    && artifactMembersIntegrity && jsonlMembersIncludedInUpload
    && (fixture !== 'runbook-clean-start' || (runbookCode === 0 && runbookArtifact !== null
      && recoveryResult?.status === 0 && runbookRecoveryArtifact !== null))
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const manifestArtifact = writeArtifact(join(artifactDirectory, `${stem}.json`), manifestBytes);
const sidecar = Buffer.from(`${manifestArtifact.sha256}  ${stem}.json\n`, 'utf8');
const sidecarArtifact = writeArtifact(join(artifactDirectory, `${stem}.json.sha256`), sidecar);

try { rmSync(metricsPath, { force: true }); } catch {}

process.stdout.write(JSON.stringify({
  case: caseId, fixture, passed: manifest.passed,
  tests: tapSummary.testCount, pass: tapSummary.passCount, fail: tapSummary.failCount,
  localCases: tapSummary.executedLocalCases?.length ?? 0,
  skipped: tapSummary.skippedCount, providerCalls: metrics?.providerCalls ?? null,
  executedHead: startHead, executedTree: manifest.component.executedTree,
  artifacts: [tapArtifact, manifestArtifact, sidecarArtifact,
    ...(runbookArtifact ? [runbookArtifact] : []), ...(runbookRecoveryArtifact ? [runbookRecoveryArtifact] : [])]
}) + '\n');
if (!manifest.passed) process.exitCode = 1;
