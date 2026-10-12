import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CONTRAST_SOURCE, CONTRAST_METHOD, REQUIRED_CONTRAST_PAIRS } from './contrast-policy.mjs';

export const REQUIRED_COMMANDS = [
  'runtime', 'npm-ci', 'playwright-install', 'lint', 'typecheck', 'vitest',
  'build', 'contrast', 'e2e', 'integration', 'gate-tests',
];

function fail(message) { throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function hasCount(value) { return Number.isInteger(value) && value >= 0; }

export function validateCommandLog(input) {
  if (typeof input !== 'string') fail('Command log must be text.');
  const entries = input.split(String.fromCharCode(10))
    .map((line) => line.replaceAll(String.fromCharCode(13), '').trim())
    .filter(Boolean);
  const missing = REQUIRED_COMMANDS.filter((command) => !entries.includes(command));
  const unexpected = entries.filter((command) => !REQUIRED_COMMANDS.includes(command));
  const duplicated = REQUIRED_COMMANDS.filter((command) => entries.filter((entry) => entry === command).length > 1);
  const outOfOrder = entries.length === REQUIRED_COMMANDS.length && entries.some((entry, index) => entry !== REQUIRED_COMMANDS[index]);
  if (missing.length || unexpected.length || duplicated.length || entries.length !== REQUIRED_COMMANDS.length || outOfOrder) {
    fail(`Command log mismatch; missing=${missing.join(',') || 'none'}; unexpected=${unexpected.join(',') || 'none'}; duplicated=${duplicated.join(',') || 'none'}.`);
  }
  return { commands: entries.length };
}

export function parseReport(label, input) {
  if (typeof input !== 'string' || input.trim().length === 0) fail(`${label} report is missing or empty.`);
  try { return JSON.parse(input); }
  catch (error) { fail(`${label} report is malformed JSON: ${error.message}`); }
}

export function validateVitestReport(report) {
  if (!isRecord(report) || !Array.isArray(report.testResults) || report.testResults.length === 0) {
    fail('Vitest report must contain at least one test suite.');
  }
  if (report.success !== true) fail('Vitest report did not declare overall success.');
  for (const key of ['numFailedTestSuites', 'numPendingTestSuites', 'numFailedTests', 'numPendingTests', 'numTodoTests']) {
    if (!hasCount(report[key])) fail(`Vitest report is missing a valid ${key} count.`);
  }
  for (const key of ['numFailedTestSuites', 'numRuntimeErrorTestSuites', 'numPendingTestSuites']) {
    if (report[key] !== undefined && (!hasCount(report[key]) || report[key] !== 0)) fail(`Vitest report contains ${key}=${report[key]}.`);
  }
  let total = 0;
  for (const suite of report.testResults) {
    if (!isRecord(suite) || suite.status !== 'passed' || (typeof suite.failureMessage === 'string' && suite.failureMessage.length > 0) || !Array.isArray(suite.assertionResults) || suite.assertionResults.length === 0) {
      fail('Vitest report contains an empty or non-passing suite.');
    }
    for (const test of suite.assertionResults) {
      if (!isRecord(test) || test.status !== 'passed' || typeof test.title !== 'string' || test.title.trim().length === 0 || (Array.isArray(test.failureMessages) && test.failureMessages.length > 0)) {
        fail(`Vitest test has a skipped, todo, flaky, unexpected, or missing status: ${test?.fullName || test?.title || 'unknown test'}.`);
      }
      total += 1;
    }
  }
  if (!hasCount(report.numTotalTests) || !hasCount(report.numPassedTests) || report.numTotalTests !== total || report.numPassedTests !== total) {
    fail(`Vitest aggregate counts do not match ${total} individually passing tests.`);
  }
  for (const key of ['numFailedTests', 'numPendingTests', 'numTodoTests', 'numSkippedTests']) {
    if (report[key] !== undefined && (!hasCount(report[key]) || report[key] !== 0)) fail(`Vitest report contains ${key}=${report[key]}.`);
  }
  if (!hasCount(report.numTotalTestSuites) || report.numTotalTestSuites === 0 || !hasCount(report.numPassedTestSuites) || report.numPassedTestSuites !== report.numTotalTestSuites) {
    fail('Vitest aggregate suite counts do not all pass.');
  }
  if (report.snapshot?.failure === true) fail('Vitest report contains a snapshot failure.');
  return { suites: report.testResults.length, tests: total };
}

export function validatePlaywrightReport(report, label = 'Playwright') {
  if (!isRecord(report) || !Array.isArray(report.suites) || report.suites.length === 0) fail(`${label} report must contain suites.`);
  function rejectErrors(value, path = 'report') {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) rejectErrors(value[index], `${path}[${index}]`);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'errors' && !Array.isArray(nested)) fail(`${label} report has malformed errors at ${path}.`);
      if (key === 'errors' && nested.length > 0) fail(`${label} report contains errors at ${path}.`);
      rejectErrors(nested, `${path}.${key}`);
    }
  }
  rejectErrors(report);
  const specs = [];
  function collect(suite) {
    if (!isRecord(suite)) fail(`${label} report contains a malformed suite.`);
    if (Array.isArray(suite.specs)) specs.push(...suite.specs);
    if (Array.isArray(suite.suites)) for (const nested of suite.suites) collect(nested);
  }
  for (const suite of report.suites) collect(suite);
  if (specs.length === 0) fail(`${label} report contains no test specs.`);
  let total = 0;
  for (const spec of specs) {
    if (!isRecord(spec) || spec.ok !== true || typeof spec.title !== 'string' || spec.title.trim().length === 0 || !Array.isArray(spec.tests) || spec.tests.length === 0) {
      fail(`${label} report contains an empty, skipped, or unexpected spec.`);
    }
    for (const test of spec.tests) {
      if (!isRecord(test) || test.expectedStatus !== 'passed' || !['expected', 'passed'].includes(test.status) || !Array.isArray(test.results) || test.results.length !== 1) {
        fail(`${label} test is skipped, flaky, retried, or has an unexpected outcome: ${spec.title}.`);
      }
      if (!isRecord(test.results[0]) || test.results[0].status !== 'passed') fail(`${label} test attempt did not pass: ${spec.title}.`);
      total += 1;
    }
  }
  const stats = report.stats;
  if (!isRecord(stats) || !hasCount(stats.expected) || stats.expected !== total) fail(`${label} aggregate expected count does not match ${total} individual tests.`);
  for (const key of ['skipped', 'unexpected', 'flaky']) {
    if (!hasCount(stats[key]) || stats[key] !== 0) fail(`${label} report contains ${key}=${stats[key]}.`);
  }
  return { specs: specs.length, tests: total };
}

export function validateContrastReport(report) {
  if (!isRecord(report) || typeof report.source !== 'string' || typeof report.method !== 'string' || !Array.isArray(report.pairs) || report.pairs.length === 0) {
    fail('Contrast report must contain a source, method, and checked pairs.');
  }
  for (const pair of report.pairs) {
    if (!isRecord(pair) || typeof pair.name !== 'string' || typeof pair.passes !== 'boolean' || typeof pair.expected !== 'boolean' || !Number.isFinite(pair.ratio) || !Number.isFinite(pair.threshold) || pair.passes !== pair.expected) {
      fail('Contrast report contains an empty, malformed, or unexpected result.');
    }
    // Matching flags alone are not evidence; use the producer's unrounded comparison.
    if (pair.passes !== (pair.ratio >= pair.threshold)) {
      fail('Contrast report contains a result inconsistent with its ratio and threshold.');
    }
  }
  return { pairs: report.pairs.length };
}

// Dashboard-specific completeness policy is separate from generic arithmetic
// validation so PR #36's general comparison and all its tests remain intact.
export function validateDashboardContrastReport(report) {
  const summary = validateContrastReport(report);
  if (report.source !== CONTRAST_SOURCE || report.method !== CONTRAST_METHOD) {
    fail('Contrast report must identify the pinned source and calculation method.');
  }
  if (report.pairs.length !== REQUIRED_CONTRAST_PAIRS.length) {
    fail('Contrast report must contain every required checked pair exactly once.');
  }
  const policy = new Map(REQUIRED_CONTRAST_PAIRS.map(pair => [pair.name, pair]));
  const seen = new Set();
  for (const pair of report.pairs) {
    if (!policy.has(pair.name) || seen.has(pair.name)) {
      fail('Contrast report contains an unknown or duplicate pair.');
    }
    seen.add(pair.name);
    const required = policy.get(pair.name);
    if (pair.threshold !== required.threshold || pair.expected !== required.expected) {
      fail('Contrast report changes a pinned threshold or expected outcome.');
    }
    if (pair.ratio < 1 || pair.ratio > 21) {
      fail('Contrast report contains a ratio outside the physical range [1, 21].');
    }
  }
  return summary;
}

async function readReport(label, path) {
  let input;
  try { input = await readFile(path, 'utf8'); }
  catch (error) { fail(`${label} report is missing at ${path}: ${error.message}`); }
  return parseReport(label, input);
}

async function main(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!['--commands', '--vitest', '--contrast', '--e2e', '--integration'].includes(key) || !value || options.has(key)) fail(`Invalid report gate arguments near ${key || 'end of input'}.`);
    options.set(key, value);
  }
  const required = ['--commands', '--vitest', '--contrast', '--e2e', '--integration'];
  const missing = required.filter((key) => !options.has(key));
  if (missing.length) fail(`Missing required gate inputs: ${missing.join(', ')}.`);
  const commandText = await readFile(options.get('--commands'), 'utf8');
  const [vitest, contrast, e2e, integration] = await Promise.all([
    readReport('Vitest', options.get('--vitest')),
    readReport('Contrast', options.get('--contrast')),
    readReport('E2E', options.get('--e2e')),
    readReport('Integration', options.get('--integration')),
  ]);
  const summary = {
    commands: validateCommandLog(commandText),
    vitest: validateVitestReport(vitest),
    contrast: validateDashboardContrastReport(contrast),
    e2e: validatePlaywrightReport(e2e, 'E2E'),
    integration: validatePlaywrightReport(integration, 'Integration'),
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
