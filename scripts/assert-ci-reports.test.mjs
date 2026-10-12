import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_COMMANDS,
  parseReport,
  validateCommandLog,
  validateContrastReport,
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
