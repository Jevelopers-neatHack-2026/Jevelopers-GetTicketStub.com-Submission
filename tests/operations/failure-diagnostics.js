import { fileURLToPath } from 'node:url';
import { relative, resolve, sep } from 'node:path';
import { dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_RECORDS = 32;
const MAX_NESTED_ERROR_ROOTS = 32;
const MAX_INPUT_BYTES = 1_000_000;
const SAFE_ERROR_NAMES = new Set([
  'AssertionError', 'Error', 'RangeError', 'RuntimeError', 'SyntaxError', 'TimeoutError', 'TypeError'
]);
const C02_CONTROL_FAILURE_PREFIX = 'AH11_OPS_C02_CONTROL_FAILURE ';
const C02_CONTROL_FAILURE_MAX_RECORDS = 8;
const C02_CONTROL_FAILURE_MAX_LINE_BYTES = 192;
const C02_CONTROL_FAILURE_MAX_BYTES = 1_536;
const C02_CONTROL_FAILURE_BOUNDARIES = new Set([
  'C02_RUNNER_READY', 'C02_MARKER_CONTROL_READY', 'C02_WATCHDOG_READY',
  'C02_WATCHDOG_TARGET_ACK', 'C02_INERT_DESCENDANT_MARKER', 'C02_WATCHDOG_RESULT'
]);
const C02_CONTROL_FAILURE_ERROR_CLASSES = new Set(['Error', 'RangeError', 'SyntaxError', 'TypeError']);
const SAFE_ERROR_CODES = new Set([
  'EACCES', 'EISDIR', 'ENOENT', 'ETIMEDOUT', 'ERR_ASSERTION',
  'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ERR_SQLITE_ERROR', 'ERR_TEST_FAILURE',
  'SQLITE_BUSY', 'SQLITE_CONSTRAINT', 'SQLITE_ERROR', 'SQLITE_IOERR', 'SQLITE_LOCKED',
  'STORE_BUSY'
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

export function parseC02ControlReadDiagnostics({
  lines = '', count = 0, bytes = 0, diagnosticsComplete = true
} = {}) {
  let complete = typeof lines === 'string'
    && Number.isSafeInteger(count) && count >= 0 && count <= C02_CONTROL_FAILURE_MAX_RECORDS
    && Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= C02_CONTROL_FAILURE_MAX_BYTES
    && diagnosticsComplete === true;
  const actualBytes = typeof lines === 'string' ? Buffer.byteLength(lines, 'utf8') : -1;
  if (actualBytes !== bytes || (lines.length > 0 && !lines.endsWith('\n'))) complete = false;
  const rawLines = typeof lines === 'string' && lines.length > 0 ? lines.slice(0, C02_CONTROL_FAILURE_MAX_BYTES).split('\n') : [];
  if (rawLines.at(-1) === '') rawLines.pop();
  if (rawLines.length !== count || rawLines.length > C02_CONTROL_FAILURE_MAX_RECORDS) complete = false;
  const records = [];
  for (const rawLine of rawLines.slice(0, C02_CONTROL_FAILURE_MAX_RECORDS)) {
    if (Buffer.byteLength(rawLine, 'utf8') + 1 > C02_CONTROL_FAILURE_MAX_LINE_BYTES
        || !rawLine.startsWith(C02_CONTROL_FAILURE_PREFIX)) {
      complete = false;
      break;
    }
    let value;
    try { value = JSON.parse(rawLine.slice(C02_CONTROL_FAILURE_PREFIX.length)); } catch {
      complete = false;
      break;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      complete = false;
      break;
    }
    const keys = Object.keys(value).sort();
    if (keys.length !== 4 || keys[0] !== 'boundary' || keys[1] !== 'caseId'
        || keys[2] !== 'errorClass' || keys[3] !== 'schema'
        || value.schema !== 'agent-harness.ah11-ops-c02-control-failure.v1'
        || value.caseId !== 'OPS04.C02'
        || !C02_CONTROL_FAILURE_BOUNDARIES.has(value.boundary)
        || !C02_CONTROL_FAILURE_ERROR_CLASSES.has(value.errorClass)) {
      complete = false;
      break;
    }
    records.push(Object.freeze({
      caseId: 'OPS04.C02', boundary: value.boundary, errorClass: value.errorClass
    }));
  }
  return Object.freeze({
    complete,
    recordCount: complete ? records.length : 0,
    records: Object.freeze(complete ? records : [])
  });
}

function safeC02ControlReadDiagnostics(value) {
  let complete = value?.complete === true
    && Number.isSafeInteger(value?.recordCount)
    && value.recordCount >= 0 && value.recordCount <= C02_CONTROL_FAILURE_MAX_RECORDS
    && Array.isArray(value?.records) && value.records.length === value.recordCount;
  const records = [];
  for (const record of (Array.isArray(value?.records) ? value.records : []).slice(0, C02_CONTROL_FAILURE_MAX_RECORDS)) {
    const keys = record && typeof record === 'object' && !Array.isArray(record)
      ? Object.keys(record).sort() : [];
    if (keys.length !== 3 || keys[0] !== 'boundary' || keys[1] !== 'caseId' || keys[2] !== 'errorClass'
        || record.caseId !== 'OPS04.C02'
        || !C02_CONTROL_FAILURE_BOUNDARIES.has(record.boundary)
        || !C02_CONTROL_FAILURE_ERROR_CLASSES.has(record.errorClass)) {
      complete = false;
      break;
    }
    records.push(Object.freeze({
      caseId: 'OPS04.C02', boundary: record.boundary, errorClass: record.errorClass
    }));
  }
  return Object.freeze({
    complete,
    recordCount: complete ? records.length : 0,
    records: Object.freeze(complete ? records : [])
  });
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

function scalar(block, field, expectedIndentation = null) {
  for (const line of block.split(/\r?\n/u)) {
    const match = line.match(/^([ \t]*)([A-Za-z][A-Za-z0-9_-]*):\s*['"]?([A-Za-z0-9_./:-]{1,160})['"]?,?\s*$/u);
    if (match?.[2] === field
        && (expectedIndentation === null || match[1].length === expectedIndentation)) return match[3];
  }
  return null;
}

function sqlitePrimaryCode(value) {
  const code = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d{1,9}$/u.test(value) ? Number(value) : null;
  if (!Number.isSafeInteger(code) || code < 0) return null;
  const primary = code & 0xff;
  return primary === 5 || primary === 6 ? primary : null;
}

function safeNestedScalar(value) {
  const normalized = value?.trim();
  const quoted = normalized?.match(/^'([A-Za-z0-9_.:-]{1,160})',?$/u);
  if (quoted) return quoted[1];
  const plain = normalized?.match(/^([A-Za-z0-9_.:-]{1,160}),?$/u);
  return plain?.[1] ?? null;
}

function directErrorFields(lines, indentation) {
  const fields = new Map();
  for (const line of lines) {
    const match = line.match(/^([ \t]*)([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*?))?[ \t]*$/u);
    if (!match || match[1].length !== indentation) continue;
    if (!['name', 'code', 'errcode'].includes(match[2])) continue;
    if (fields.has(match[2])) return null;
    const value = match[3] === undefined ? null : safeNestedScalar(match[3]);
    if (value === null) return null;
    fields.set(match[2], value);
  }
  return fields;
}

function storageCauseFromFields(fields) {
  if (!fields) return null;
  const name = fields.get('name');
  const code = fields.get('code');
  if (name === 'RuntimeError' && code === 'STORE_BUSY') {
    return Object.freeze({
      failureCode: 'SQLITE_BUSY', errorClass: 'RuntimeError',
      errorCode: 'STORE_BUSY', sqlitePrimaryCode: null
    });
  }
  const primary = sqlitePrimaryCode(fields.get('errcode'));
  if ((name === 'Error' || name === 'SQLiteError') && code === 'ERR_SQLITE_ERROR' && primary !== null) {
    return Object.freeze({
      failureCode: 'SQLITE_BUSY', errorClass: 'Error',
      errorCode: 'ERR_SQLITE_ERROR', sqlitePrimaryCode: primary
    });
  }
  return null;
}

function nestedStorageFailure(block, parentIndentation) {
  const lines = block.split(/\r?\n/u);
  let inspectedRoots = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const root = lines[index].match(/^([ \t]*)(error|cause):(?:[ \t]*(.*))?$/u);
    if (!root || root[1].length !== parentIndentation || (root[3] ?? '') !== '') continue;
    inspectedRoots += 1;
    if (inspectedRoots > MAX_NESTED_ERROR_ROOTS) break;

    const descendants = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const indentation = lines[next].match(/^[ \t]*/u)?.[0].length ?? 0;
      if (lines[next].trim() && indentation <= parentIndentation) break;
      descendants.push(lines[next]);
    }

    const firstIndentation = descendants
      .map(line => ({ line, indentation: line.match(/^[ \t]*/u)?.[0].length ?? 0 }))
      .find(item => item.line.trim())?.indentation;
    if (firstIndentation === undefined || firstIndentation <= parentIndentation) continue;

    const directCause = storageCauseFromFields(directErrorFields(descendants, firstIndentation));
    if (directCause) return directCause;

    for (let markerIndex = 0; markerIndex < descendants.length; markerIndex += 1) {
      const line = descendants[markerIndex];
      const marker = line.match(/^([ \t]*)(RuntimeError|Error|SQLiteError):[ \t]*$/u);
      if (!marker || marker[1].length !== firstIndentation) continue;
      const markerIndentation = marker[1].length;
      const markerLines = [];
      for (let nestedIndex = markerIndex + 1; nestedIndex < descendants.length; nestedIndex += 1) {
        const nestedLine = descendants[nestedIndex];
        const nestedIndentation = nestedLine.match(/^[ \t]*/u)?.[0].length ?? 0;
        if (nestedLine.trim() && nestedIndentation <= markerIndentation) break;
        markerLines.push(nestedLine);
      }
      const fields = directErrorFields(markerLines, markerIndentation + 2);
      if (fields?.get('name') !== marker[2]) continue;
      const markedCause = storageCauseFromFields(fields);
      if (markedCause) return markedCause;
    }
  }
  return null;
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

function classify({ name, code, sqliteCode, timedOut }) {
  if (timedOut || code === 'ETIMEDOUT') return 'CHILD_TIMEOUT';
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'OUTPUT_LIMIT';
  if (name === 'SyntaxError') return 'JSON_PARSE';
  if (name === 'AssertionError' || code === 'ERR_ASSERTION') return 'ASSERTION_FAILURE';
  if (code === 'STORE_BUSY' || code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
      || (code === 'ERR_SQLITE_ERROR' && sqliteCode !== null)) return 'SQLITE_BUSY';
  return 'UNCLASSIFIED_FAILURE';
}

function makeRecord({
  scenario, phase, stage, status, signal, errorCode, errorName, timedOut,
  outputBytes, outputTruncated, caseId, location, operator, failureType,
  actualValueKind, expectedValueKind, missingCases, sqliteCode = null,
  nestedStorageCause = null
}) {
  const baseFailureCode = classify({
    name: errorName,
    code: errorCode,
    timedOut,
    sqliteCode
  });
  const nestedFailureCode = errorName === 'AssertionError' || errorCode === 'ERR_ASSERTION'
    ? null : nestedStorageCause?.failureCode ?? null;
  return {
    scenario: safeScenario(scenario),
    phase,
    stage,
    caseId: identifierFrom(caseId),
    failureCode: baseFailureCode === 'UNCLASSIFIED_FAILURE' && nestedFailureCode
      ? nestedFailureCode : baseFailureCode,
    errorClass: safeErrorName(errorName) ?? 'redacted',
    errorCode: safeErrorCode(errorCode),
    sqlitePrimaryCode: sqliteCode,
    nestedStorageCause,
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
  stdout = '', stderr = '', missingCases = [], c02ControlReadDiagnostics = undefined
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
    const recordIndentation = indent + 2;
    const name = scalar(blockText, 'name', recordIndentation);
    const code = scalar(blockText, 'code', recordIndentation);
    const failureType = scalar(blockText, 'failureType', recordIndentation);
    const operator = scalar(blockText, 'operator', recordIndentation);
    const location = scalar(blockText, 'location', recordIndentation);
    const nestedCause = nestedStorageFailure(blockText, recordIndentation);
    const primaryCode = sqlitePrimaryCode(scalar(blockText, 'errcode', recordIndentation));
    records.push(makeRecord({
      scenario, phase, stage, status, signal,
      errorCode: safeErrorCode(code), errorName: safeErrorName(name),
      timedOut: error?.code === 'ETIMEDOUT', outputBytes, sqliteCode: primaryCode,
      nestedStorageCause: nestedCause,
      outputTruncated: truncatedByLimit || lines.length >= 20_000,
      caseId: identifierFrom(failed[1]) ?? identifierFrom(currentSubtest),
      location,
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
      outputBytes, sqliteCode: sqlitePrimaryCode(error?.errcode),
      outputTruncated: truncatedByLimit || lines.length >= 20_000,
      caseId: identifierFrom(currentSubtest),
      location: null,
      operator: null,
      failureType: null,
      missingCases,
      nestedStorageCause: null
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
      missingCases,
      nestedStorageCause: null
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
    records: Object.freeze(records),
    ...(c02ControlReadDiagnostics === undefined ? {} : {
      c02ControlReadDiagnostics: safeC02ControlReadDiagnostics(c02ControlReadDiagnostics)
    })
  });
}
