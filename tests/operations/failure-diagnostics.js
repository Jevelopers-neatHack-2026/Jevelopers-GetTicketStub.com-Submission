import { fileURLToPath } from 'node:url';
import { relative, resolve, sep } from 'node:path';
import { dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_RECORDS = 32;
const MAX_INPUT_BYTES = 1_000_000;
const SAFE_ERROR_NAMES = new Set([
  'AssertionError', 'Error', 'RangeError', 'SyntaxError', 'TimeoutError', 'TypeError'
]);
const SAFE_ERROR_CODES = new Set([
  'EACCES', 'EISDIR', 'ENOENT', 'ETIMEDOUT', 'ERR_ASSERTION',
  'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ERR_TEST_FAILURE',
  'SQLITE_BUSY', 'SQLITE_CONSTRAINT', 'SQLITE_ERROR', 'SQLITE_IOERR', 'SQLITE_LOCKED'
]);
const SAFE_SIGNALS = new Set(['SIGABRT', 'SIGINT', 'SIGKILL', 'SIGTERM']);
const SAFE_OPERATORS = new Set([
  'deepEqual', 'deepStrictEqual', 'doesNotMatch', 'doesNotThrow', 'equal', 'fail',
  'ifError', 'match', 'notDeepEqual', 'notDeepStrictEqual', 'notEqual', 'notStrictEqual',
  'ok', 'rejects', 'strictEqual', 'throws'
]);

function safeErrorName(value) {
  return SAFE_ERROR_NAMES.has(value) ? value : null;
}

function safeErrorCode(value) {
  return SAFE_ERROR_CODES.has(value) ? value : null;
}

function safeSignal(value) {
  return SAFE_SIGNALS.has(value) ? value : null;
}

function safeScenario(value) {
  return identifierFrom(value)
    ?? (['quota-shutdown-restart', 'runbook-clean-start', 'diagnostic-control'].includes(value)
      ? value : 'AH-11-OPS');
}

function sourceLocation(value) {
  if (typeof value !== 'string') return 'redacted';
  let filePath;
  let line;
  let column;
  const urlMatch = value.match(/(file:\/\/[^\s'"<>]+):(\d+):(\d+)/u);
  const pathMatch = value.match(/((?:tests|src)\/[A-Za-z0-9_./-]+):(\d+):(\d+)/u);
  try {
    if (urlMatch) {
      filePath = fileURLToPath(new URL(urlMatch[1]));
      line = urlMatch[2];
      column = urlMatch[3];
    } else if (pathMatch) {
      filePath = resolve(ROOT, pathMatch[1]);
      line = pathMatch[2];
      column = pathMatch[3];
    } else {
      return 'redacted';
    }
  } catch {
    return 'redacted';
  }
  const rel = relative(ROOT, filePath).split(sep).join('/');
  if (!/^(?:tests|src)\/[A-Za-z0-9_./-]+$/u.test(rel)
      || rel === '..' || rel.startsWith('../') || !Number.isSafeInteger(Number(line))
      || !Number.isSafeInteger(Number(column))) return 'redacted';
  return `${rel}:${line}:${column}`;
}

function identifierFrom(value) {
  return value?.match(/\bOPS\d{2}\.C\d{2}\b/u)?.[0]
    ?? value?.match(/\bOPS\d{2}_[A-Z0-9_]+\b/u)?.[0]
    ?? null;
}

function scalar(block, field) {
  const pattern = new RegExp(`^[ \\t]*${field}:\\s*['\"]?([A-Za-z0-9_./:-]{1,160})['\"]?\\s*$`, 'mu');
  return block.match(pattern)?.[1] ?? null;
}

function assertionValueKind(block, field) {
  const pattern = new RegExp(`^[ \\t]*${field}:\\s*(.*?)\\s*$`, 'mu');
  const value = block.match(pattern)?.[1];
  if (value === undefined) return null;
  const normalized = value.trim();
  if (/^(?:null|~)$/iu.test(normalized)) return 'null';
  if (/^(?:true|false)$/iu.test(normalized)) return 'boolean';
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(normalized)) return 'number';
  if (normalized.startsWith('[') || normalized.startsWith('- ')) return 'array';
  if (normalized.startsWith('{')) return 'object';
  if (normalized.startsWith("'") || normalized.startsWith('"')
      || normalized.startsWith('|') || normalized.startsWith('>')) return 'string';
  if (normalized === '') return 'complex';
  return 'scalar';
}

function classify({ name, code, timedOut, rawText }) {
  if (timedOut || code === 'ETIMEDOUT') return 'CHILD_TIMEOUT';
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
      || /\b(?:SQLITE_BUSY|SQLITE_LOCKED)\b|database is locked/iu.test(rawText)) return 'SQLITE_BUSY';
  if (name === 'SyntaxError') return 'JSON_PARSE';
  if (name === 'AssertionError' || code === 'ERR_ASSERTION') return 'ASSERTION_FAILURE';
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'OUTPUT_LIMIT';
  return 'UNCLASSIFIED_FAILURE';
}

function makeRecord({
  scenario, phase, stage, status, signal, errorCode, errorName, timedOut,
  outputBytes, outputTruncated, caseId, location, operator, failureType,
  actualValueKind, expectedValueKind, missingCases
}) {
  return {
    scenario: safeScenario(scenario),
    phase,
    stage,
    caseId: identifierFrom(caseId),
    failureCode: classify({
      name: errorName,
      code: errorCode,
      timedOut,
      rawText: ''
    }),
    errorClass: safeErrorName(errorName) ?? 'redacted',
    errorCode: safeErrorCode(errorCode),
    failureType: ['testCodeFailure', 'testTimeoutFailure', 'subtestsFailed'].includes(failureType)
      ? failureType : null,
    sourceLocation: sourceLocation(location),
    assertionOperator: SAFE_OPERATORS.has(operator) ? operator : null,
    assertionContext: {
      actualValueKind: actualValueKind ?? null,
      expectedValueKind: expectedValueKind ?? null
    },
    status: Number.isSafeInteger(status) && status >= 0 && status <= 255 ? status : null,
    signal: safeSignal(signal),
    timedOut: Boolean(timedOut || errorCode === 'ETIMEDOUT'),
    outputBytes: Number.isSafeInteger(outputBytes) && outputBytes >= 0 ? outputBytes : 0,
    outputTruncated: Boolean(outputTruncated),
    missingCaseIds: [...new Set((missingCases ?? []).filter(value => /^OPS\d{2}\.C\d{2}$/u.test(value)))].slice(0, 52)
  };
}

export function buildSafeFailureDiagnostics({
  scenario, phase, stage, status = null, signal = null, error = null,
  stdout = '', stderr = '', missingCases = []
}) {
  const combined = `${typeof stdout === 'string' ? stdout : ''}\n${typeof stderr === 'string' ? stderr : ''}`;
  const outputBytes = Buffer.byteLength(combined, 'utf8');
  const truncatedByLimit = outputBytes > MAX_INPUT_BYTES
    || error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
  const input = truncatedByLimit ? Buffer.from(combined).subarray(0, MAX_INPUT_BYTES).toString('utf8') : combined;
  const lines = input.split(/\r?\n/u).slice(0, 20_000);
  const records = [];
  let currentSubtest = null;

  for (let index = 0; index < lines.length && records.length < MAX_RECORDS; index += 1) {
    const subtest = lines[index].match(/^[ \t]*# Subtest: (.+)$/u);
    if (subtest) currentSubtest = subtest[1];
    const failed = lines[index].match(/^[ \t]*not ok \d+ - (.+)$/u);
    if (!failed) continue;

    const indent = lines[index].match(/^[ \t]*/u)?.[0].length ?? 0;
    const block = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next];
      if (candidate.trim() && (candidate.match(/^[ \t]*/u)?.[0].length ?? 0) <= indent
          && /^(?:not )?ok \d+ - |# (?:tests|pass|fail)\b/u.test(candidate.trim())) break;
      block.push(candidate);
    }
    const blockText = block.join('\n');
    const name = scalar(blockText, 'name');
    const code = scalar(blockText, 'code');
    const failureType = scalar(blockText, 'failureType');
    const operator = scalar(blockText, 'operator');
    const locationMatch = blockText.match(/^[ \t]*location:\s*["']?([^\r\n"']+)["']?\s*$/mu);
    records.push(makeRecord({
      scenario, phase, stage, status, signal,
      errorCode: safeErrorCode(code), errorName: safeErrorName(name),
      timedOut: error?.code === 'ETIMEDOUT', outputBytes,
      outputTruncated: truncatedByLimit || lines.length >= 20_000,
      caseId: identifierFrom(failed[1]) ?? identifierFrom(currentSubtest),
      location: locationMatch?.[1] ?? null,
      operator: SAFE_OPERATORS.has(operator) ? operator : null,
      actualValueKind: assertionValueKind(blockText, 'actual'),
      expectedValueKind: assertionValueKind(blockText, 'expected'),
      failureType,
      missingCases
    }));
  }

  const processFailed = status !== 0 || signal !== null || error !== null;
  if (processFailed && records.length === 0 && records.length < MAX_RECORDS) {
    records.push(makeRecord({
      scenario, phase, stage, status, signal,
      errorCode: safeErrorCode(error?.code),
      errorName: safeErrorName(error?.name),
      timedOut: error?.code === 'ETIMEDOUT',
      outputBytes,
      outputTruncated: truncatedByLimit || lines.length >= 20_000,
      caseId: identifierFrom(currentSubtest),
      location: null,
      operator: null,
      failureType: null,
      missingCases
    }));
  }

  if (missingCases.length > 0 && records.length < MAX_RECORDS) {
    records.push(makeRecord({
      scenario, phase, stage, status, signal,
      errorCode: null,
      errorName: null,
      timedOut: false,
      outputBytes,
      outputTruncated: truncatedByLimit || lines.length >= 20_000,
      caseId: identifierFrom(currentSubtest),
      location: null,
      operator: null,
      failureType: null,
      missingCases
    }));
    records.at(-1).failureCode = 'REQUIRED_CASES_MISSING';
  }

  return Object.freeze({
    schema: 'agent-harness.ah11-ops-safe-diagnostics.v1',
    scenario: safeScenario(scenario),
    phase,
    stage,
    status: Number.isSafeInteger(status) && status >= 0 && status <= 255 ? status : null,
    signal: safeSignal(signal),
    timedOut: error?.code === 'ETIMEDOUT',
    outputBytes,
    outputTruncated: truncatedByLimit || lines.length >= 20_000,
    records: Object.freeze(records)
  });
}
