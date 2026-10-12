import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_COMMANDS,
  parseReport,
  validateCommandLog,
  validateContrastReport,
  validateDashboardContrastReport,
  validatePlaywrightReport,
  validateVitestReport,
} from './assert-ci-reports.mjs';

function vitestFixture(status = 'passed') {
  return {
    success: true, numTotalTestSuites: 1, numPassedTestSuites: 1, numFailedTestSuites: 0,
    numRuntimeErrorTestSuites: 0, numPendingTestSuites: 0,
    numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0,
    numTodoTests: 0, numSkippedTests: 0,
    testResults: [{ status: 'passed', assertionResults: [{ title: 'fixture test', status }] }],
  };
}

function playwrightFixture(resultStatus = 'passed', testStatus = 'expected', expectedStatus = 'passed', results = [{ status: resultStatus }]) {
  return {
    suites: [{ title: 'fixture suite', specs: [{ title: 'fixture journey', ok: true, tests: [{ expectedStatus, status: testStatus, results }] }] }],
    errors: [],
    stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
  };
}

test('command log requires every successful CI command in order and rejects additions', () => {
  assert.deepEqual(validateCommandLog(REQUIRED_COMMANDS.join('\n')), { commands: REQUIRED_COMMANDS.length });
  assert.throws(() => validateCommandLog(REQUIRED_COMMANDS.filter((command) => command !== 'integration').join('\n')), /missing=integration/);
  assert.throws(() => validateCommandLog(`${REQUIRED_COMMANDS.join('\n')}\nextra`), /unexpected=extra/);
  assert.throws(() => validateCommandLog([...REQUIRED_COMMANDS].reverse().join('\n')), /mismatch/);
});

test('empty and malformed reports fail before status validation', () => {
  assert.throws(() => parseReport('fixture', ''), /missing or empty/);
  assert.throws(() => parseReport('fixture', '{'), /malformed JSON/);
  assert.throws(() => validateVitestReport({ testResults: [] }), /at least one test suite/);
});

test('Vitest validates each test even when aggregate counts claim success', () => {
  assert.deepEqual(validateVitestReport(vitestFixture()), { suites: 1, tests: 1 });
  assert.throws(() => validateVitestReport(vitestFixture('failed')), /skipped, todo, flaky, unexpected/);
  assert.throws(() => validateVitestReport(vitestFixture('skipped')), /skipped, todo, flaky, unexpected/);
  assert.throws(() => validateVitestReport(vitestFixture('todo')), /skipped, todo, flaky, unexpected/);
  assert.throws(() => validateVitestReport(vitestFixture('flaky')), /skipped, todo, flaky, unexpected/);
  assert.throws(() => validateVitestReport(vitestFixture('unexpected')), /skipped, todo, flaky, unexpected/);
  const mismatchedTotals = vitestFixture();
  mismatchedTotals.numPassedTests = 0;
  assert.throws(() => validateVitestReport(mismatchedTotals), /aggregate counts/);
  const failedTopLevel = vitestFixture();
  failedTopLevel.success = false;
  assert.throws(() => validateVitestReport(failedTopLevel), /overall success/);
  const failedSuiteCount = vitestFixture();
  failedSuiteCount.numFailedTestSuites = 1;
  assert.throws(() => validateVitestReport(failedSuiteCount), /numFailedTestSuites/);
  const runtimeError = vitestFixture();
  runtimeError.numRuntimeErrorTestSuites = 1;
  assert.throws(() => validateVitestReport(runtimeError), /numRuntimeErrorTestSuites/);
  const missingCounts = vitestFixture();
  delete missingCounts.numFailedTests;
  assert.throws(() => validateVitestReport(missingCounts), /missing a valid numFailedTests/);
});

test('Playwright rejects failures hidden behind passing aggregate counters', () => {
  assert.deepEqual(validatePlaywrightReport(playwrightFixture()), { specs: 1, tests: 1 });
  assert.throws(() => validatePlaywrightReport(playwrightFixture('failed')), /attempt did not pass/);
  assert.throws(() => validatePlaywrightReport(playwrightFixture('passed', 'flaky', 'passed', [{ status: 'failed' }, { status: 'passed' }])), /flaky, retried/);
  assert.throws(() => validatePlaywrightReport(playwrightFixture('skipped', 'skipped', 'skipped')), /skipped, flaky/);
  assert.throws(() => validatePlaywrightReport(playwrightFixture('passed', 'unexpected')), /unexpected outcome/);
  const rootError = playwrightFixture();
  rootError.errors.push({ message: 'fixture failure' });
  assert.throws(() => validatePlaywrightReport(rootError), /contains errors/);
  const attemptError = playwrightFixture();
  attemptError.suites[0].specs[0].tests[0].results[0].errors = [{ message: 'fixture failure' }];
  assert.throws(() => validatePlaywrightReport(attemptError), /contains errors/);
  const malformedErrors = playwrightFixture();
  malformedErrors.errors = 'fixture failure';
  assert.throws(() => validatePlaywrightReport(malformedErrors), /malformed errors/);
});

test('contrast report accepts intentional negative controls only when they match expectation', () => {
  const report = { source: 'fixture', method: 'fixture calculation', pairs: [{ name: 'negative control', ratio: 2, threshold: 4.5, passes: false, expected: false }] };
  assert.deepEqual(validateContrastReport(report), { pairs: 1 });
  assert.throws(() => validateContrastReport({ ...report, pairs: [{ ...report.pairs[0], passes: true }] }), /unexpected result/);
  assert.throws(() => validateContrastReport({ ...report, pairs: [] }), /checked pairs/);
});

// TEST_BUILT report variants: exercise the gate, not browser contrast measurement.
for (const threshold of [3, 4.5]) {
  const reportWith = (ratio, passes) => ({
    source: 'fixture', method: 'unrounded fixture comparison',
    pairs: [{ name: 'fixture contrast pair', ratio, threshold, passes, expected: passes }],
  });

  test(`contrast rejects a false positive below ${threshold} even when both flags agree`, () => {
    assert.throws(() => validateContrastReport(reportWith(threshold - 0.001, true)), /inconsistent with its ratio and threshold/);
  });

  test(`contrast rejects a false negative above ${threshold} even when both flags agree`, () => {
    assert.throws(() => validateContrastReport(reportWith(threshold + 0.001, false)), /inconsistent with its ratio and threshold/);
  });

  test(`contrast rejects a false negative exactly at ${threshold}`, () => {
    assert.throws(() => validateContrastReport(reportWith(threshold, false)), /inconsistent with its ratio and threshold/);
  });

  test(`contrast uses an inclusive, unrounded comparison at ${threshold}`, () => {
    for (const [ratio, passes] of [[threshold - 0.001, false], [threshold, true], [threshold + 0.001, true]]) {
      assert.deepEqual(validateContrastReport(reportWith(ratio, passes)), { pairs: 1 });
    }
  });
}

// Independent TEST_BUILT dashboard reports; not browser accessibility evidence.
function dashboardContrastFixture() {
  return {
    source: 'brand-kit@3822635aff507cd5918a08a0c636bb0e41705261',
    method: 'WCAG sRGB relative luminance; source-over alpha in sRGB; unrounded comparisons',
    pairs: [
      ['body / cream', 4.5, true],
      ['muted / cream', 4.5, true],
      ['body / subtle surface', 4.5, true],
      ['focus / cream', 3, true],
      ['focus / subtle surface', 3, true],
      ['meaningful bar / subtle surface', 3, true],
      ['negative control: orange body / cream', 4.5, false],
      ['negative control: copper body / cream', 4.5, false],
      ['negative control: cyan body / cream', 4.5, false],
    ].map(([name, threshold, expected]) => ({ name, ratio: expected ? 7 : 2, threshold, passes: expected, expected })),
  };
}

test('dashboard contrast policy accepts the nine required pairs in any order', () => {
  const report = dashboardContrastFixture();
  assert.deepEqual(validateDashboardContrastReport(report), { pairs: 9 });
  report.pairs.reverse();
  assert.deepEqual(validateDashboardContrastReport(report), { pairs: 9 });
});

test('dashboard contrast policy rejects omissions, duplicates, extras and unknown names', () => {
  for (let index = 0; index < 9; index += 1) {
    const missing = dashboardContrastFixture();
    missing.pairs.splice(index, 1);
    assert.throws(() => validateDashboardContrastReport(missing), /every required checked pair/);
    const duplicate = dashboardContrastFixture();
    duplicate.pairs[index] = { ...duplicate.pairs[(index + 1) % 9] };
    assert.throws(() => validateDashboardContrastReport(duplicate), /duplicate pair/);
  }
  const extra = dashboardContrastFixture();
  extra.pairs.push({ ...extra.pairs[0] });
  assert.throws(() => validateDashboardContrastReport(extra), /every required checked pair/);
  for (const name of ['', ' ', 'unknown', 'body / cream ', '__proto__']) {
    const report = dashboardContrastFixture();
    report.pairs[0].name = name;
    assert.throws(() => validateDashboardContrastReport(report), /unknown or duplicate pair/);
  }
});

test('dashboard contrast policy pins source and method identities', () => {
  for (const key of ['source', 'method']) {
    for (const value of [undefined, null, '', ' ', 'fixture', 42]) {
      assert.throws(() => validateDashboardContrastReport({ ...dashboardContrastFixture(), [key]: value }), /Contrast report/);
    }
  }
});

test('dashboard contrast policy rejects weakened thresholds and changed expectations', () => {
  for (let index = 0; index < 9; index += 1) {
    const changedThreshold = dashboardContrastFixture();
    const thresholdPair = changedThreshold.pairs[index];
    thresholdPair.threshold = 1;
    thresholdPair.passes = true;
    thresholdPair.expected = true;
    assert.throws(() => validateDashboardContrastReport(changedThreshold), /pinned threshold or expected outcome/);
    const changedExpectation = dashboardContrastFixture();
    const pair = changedExpectation.pairs[index];
    pair.expected = !pair.expected;
    pair.passes = pair.expected;
    pair.ratio = pair.expected ? 7 : 2;
    assert.throws(() => validateDashboardContrastReport(changedExpectation), /pinned threshold or expected outcome/);
  }
});

test('dashboard contrast policy rejects malformed records and impossible ratios', () => {
  for (const ratio of [undefined, null, '7', NaN, Infinity, -Infinity, -1, 0, 0.99, 21.01]) {
    const report = dashboardContrastFixture();
    const index = typeof ratio === 'number' && ratio < 1 ? 6 : 0;
    report.pairs[index].ratio = ratio;
    assert.throws(() => validateDashboardContrastReport(report), /Contrast report/);
  }
  for (const pairs of [[], null, {}, 'pairs']) {
    assert.throws(() => validateDashboardContrastReport({ ...dashboardContrastFixture(), pairs }), /Contrast report/);
  }
  for (const pair of [null, [], 'pair']) {
    const report = dashboardContrastFixture();
    report.pairs[0] = pair;
    assert.throws(() => validateDashboardContrastReport(report), /Contrast report/);
  }
  for (const threshold of [undefined, null, '4.5', NaN, Infinity, -1, 0, 22]) {
    const report = dashboardContrastFixture();
    report.pairs[0].threshold = threshold;
    assert.throws(() => validateDashboardContrastReport(report), /Contrast report/);
  }
});

test('dashboard contrast policy preserves unrounded thresholds and physical endpoints', () => {
  for (let index = 0; index < 9; index += 1) {
    const report = dashboardContrastFixture();
    const pair = report.pairs[index];
    pair.ratio = pair.expected ? pair.threshold : pair.threshold - 1e-12;
    assert.deepEqual(validateDashboardContrastReport(report), { pairs: 9 });
    pair.ratio = pair.expected ? pair.threshold - 1e-12 : pair.threshold;
    assert.throws(() => validateDashboardContrastReport(report), /inconsistent with its ratio and threshold/);
  }
  const endpoints = dashboardContrastFixture();
  endpoints.pairs[0].ratio = 21;
  endpoints.pairs[6].ratio = 1;
  assert.deepEqual(validateDashboardContrastReport(endpoints), { pairs: 9 });
});

test('dashboard contrast policy retains generic rejection of inconsistent or malformed flags', () => {
  for (let index = 0; index < 9; index += 1) {
    const report = dashboardContrastFixture();
    report.pairs[index].ratio = report.pairs[index].expected ? 2 : 7;
    assert.throws(() => validateDashboardContrastReport(report), /inconsistent with its ratio and threshold/);
  }
  for (const key of ['passes', 'expected']) {
    for (const value of [undefined, null, 'true', 1]) {
      const report = dashboardContrastFixture();
      report.pairs[0][key] = value;
      assert.throws(() => validateDashboardContrastReport(report), /Contrast report/);
    }
  }
});

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

test('unchanged real CSS contrast producer satisfies the independent dashboard policy', () => {
  const result = spawnSync(process.execPath, ['scripts/check-contrast.mjs'], {
    cwd: repositoryRoot, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const report = parseReport('Contrast', result.stdout);
  assert.deepEqual(validateDashboardContrastReport(report), { pairs: 9 });
  assert.equal(report.pairs.filter(pair => pair.expected === false).length, 3);
});

test('CLI enforces dashboard coverage and recovers with a complete valid report', () => {
  const directory = mkdtempSync(join(tmpdir(), 'td-contrast-policy-'));
  try {
    const paths = Object.fromEntries(['commands', 'vitest', 'contrast', 'e2e', 'integration'].map(name => [name, join(directory, name)]));
    // These are synthetic gate inputs, not evidence that these suites ran.
    writeFileSync(paths.commands, REQUIRED_COMMANDS.join('\n'));
    writeFileSync(paths.vitest, JSON.stringify(vitestFixture()));
    writeFileSync(paths.e2e, JSON.stringify(playwrightFixture()));
    writeFileSync(paths.integration, JSON.stringify(playwrightFixture()));
    const args = ['scripts/assert-ci-reports.mjs', ...Object.entries(paths).flatMap(([name, path]) => [`--${name}`, path])];
    const run = () => spawnSync(process.execPath, args, { cwd: repositoryRoot, encoding: 'utf8', timeout: 10000 });
    const mutations = [
      report => report.pairs.pop(),
      report => { report.pairs[0] = { ...report.pairs[1] }; },
      report => { report.pairs[0].threshold = 1; },
      report => { Object.assign(report.pairs[0], { ratio: 2, passes: false, expected: false }); },
    ];
    for (const mutate of mutations) {
      const report = dashboardContrastFixture();
      mutate(report);
      writeFileSync(paths.contrast, JSON.stringify(report));
      const rejected = run();
      assert.equal(rejected.error, undefined);
      assert.equal(rejected.status, 1, rejected.stdout);
      assert.match(rejected.stderr, /Contrast report/);
      assert.equal(rejected.stdout, '');
    }
    writeFileSync(paths.contrast, JSON.stringify(dashboardContrastFixture()));
    const recovered = run();
    assert.equal(recovered.error, undefined);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.deepEqual(JSON.parse(recovered.stdout).contrast, { pairs: 9 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
