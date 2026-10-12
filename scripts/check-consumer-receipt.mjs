#!/usr/bin/env node
// Offline, dependency-free metadata checker for the consumer acceptance receipt
// (docs/consumer-acceptance-receipt.md, JSON form). Local governance tool: it
// checks the SHAPE of supplied metadata only. See docs/receipt-checker.md.
//
// Safety rules: never executes receipt content, never touches the network, and
// never echoes receipt values, key names, or file paths. Errors are a fixed
// code plus a path built only from this file's schema constants.

import { openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MAX_BYTES = 1024 * 1024;
export const MAX_DEPTH = 64;

export const CONSUMERS = [
  'integration-evals', 'print-production', 'agent-harness', 'event-intelligence',
  'creative-engine', 'fulfillment-connectors', 'cost-intelligence',
  'team-dashboard', 'getticketstub.com',
];

export const NOTICE =
  'Metadata shape check only. Not verified: runtime results, authenticity, owner acceptance, release.';

// Codes that mean "not finished yet"; every other code means "malformed".
const INCOMPLETE_CODES = new Set([
  'MISSING_FIELD', 'NULL_FIELD', 'EMPTY_LIST', 'NONZERO_EXIT',
  'NONZERO_FAILURES', 'NONZERO_SKIPS', 'ZERO_TESTS',
]);
const MAX_ERRORS = 100;
const ABSENT = Symbol('absent');

// ---- value predicates (all bounded) ----
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const isStr = (v, max = 500) => typeof v === 'string' && v.length > 0 && v.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(v);
const hex = (n) => (v) => typeof v === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(v);
const isSha1 = hex(40);
const isSha256Hex = hex(64);
const isPrefixed256 = (v) => typeof v === 'string' && /^sha256:[0-9a-f]{64}$/.test(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isPositive = (v) => Number.isSafeInteger(v) && v > 0;
const isSemver = (v) => typeof v === 'string' && v.length <= 64 &&
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/.test(v);
const isToken = (v) => typeof v === 'string' && /^[A-Za-z0-9._:/@#-]{1,200}$/.test(v);
const isName = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,99}$/.test(v);
const isContract = (v) => typeof v === 'string' && v.length <= 150 &&
  /^[A-Z][A-Za-z0-9]*\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/.test(v);

function isTimestamp(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/.test(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 19) === v.slice(0, 19);
}

function isSri(v) {
  if (typeof v !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(v)) return false;
  const raw = Buffer.from(v.slice(7), 'base64');
  return raw.length === 64 && raw.toString('base64') === v.slice(7);
}

// Immutable GitHub references only: sha-pinned file, commit, comment, or run.
const OWNER_REPO = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}';
const FILE_URL = new RegExp(`^https://github\\.com/${OWNER_REPO}/(?:blob|raw)/([0-9a-f]{40})/((?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+)$`);
const OTHER_URLS = [
  new RegExp(`^https://github\\.com/${OWNER_REPO}/commit/[0-9a-f]{40}$`),
  new RegExp(`^https://github\\.com/${OWNER_REPO}/(?:issues|pull)/\\d{1,12}#(?:issuecomment|discussion_r|pullrequestreview)-\\d{1,20}$`),
  new RegExp(`^https://github\\.com/${OWNER_REPO}/actions/runs/\\d{1,20}$`),
];

function pinnedFile(v) {
  if (typeof v !== 'string' || v.length > 400) return null;
  const m = FILE_URL.exec(v);
  if (!m || m[2].split('/').some((s) => s === '.' || s === '..')) return null;
  return m[1];
}
const isPinnedUrl = (v) => typeof v === 'string' && v.length <= 400 &&
  (pinnedFile(v) !== null || OTHER_URLS.some((re) => re.test(v)));

function nodeSupported(v) {
  const m = typeof v === 'string' && /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (!m) return false;
  const [maj, min, pat] = m.slice(1).map(Number);
  const floor = { 22: [22, 23, 3], 24: [24, 21, 0] }[maj];
  if (!floor) return false;
  return min > floor[1] || (min === floor[1] && pat >= floor[2]);
}

// ---- checker ----
export function checkReceipt(receipt) {
  const errors = [];
  const add = (code, path) => {
    if (errors.length < MAX_ERRORS) errors.push({ code, path });
  };

  // Read one field: records MISSING_FIELD / NULL_FIELD / BAD_FORMAT, else returns it.
  const read = (obj, key, parent, check) => {
    const path = `${parent}.${key}`;
    if (!Object.hasOwn(obj, key)) { add('MISSING_FIELD', path); return ABSENT; }
    const v = obj[key];
    if (v === null) { add('NULL_FIELD', path); return ABSENT; }
    if (!check(v)) { add('BAD_FORMAT', path); return ABSENT; }
    return v;
  };
  const section = (obj, key, parent, allowed) => {
    const v = read(obj, key, parent, isObj);
    if (v !== ABSENT) exact(v, allowed, `${parent}.${key}`);
    return v;
  };
  const exact = (obj, allowed, path) => {
    if (Object.keys(obj).some((k) => !allowed.includes(k))) add('UNKNOWN_FIELD', path);
  };
  const need = (cond, code, path) => { if (!cond) add(code, path); };

  if (!isObj(receipt)) {
    add('BAD_FORMAT', '$');
    return { status: 'INVALID', errors, notice: NOTICE };
  }
  exact(receipt, ['receipt', 'producer', 'consumer_run', 'stages'], '$');

  // receipt
  const r = section(receipt, 'receipt', '$', ['consumer', 'candidate', 'recorded_at']);
  let candidate = ABSENT;
  if (r !== ABSENT) {
    read(r, 'consumer', 'receipt', (v) => CONSUMERS.includes(v));
    candidate = read(r, 'candidate', 'receipt', isSemver);
    read(r, 'recorded_at', 'receipt', isTimestamp);
  }

  // producer
  const p = section(receipt, 'producer', '$', [
    'source_sha', 'base_sha', 'tree_sha', 'package_version', 'contract_names',
    'schema_versions', 'schema_hashes', 'archive_sha256', 'archive_sri',
    'content_digest', 'fixture_digest', 'producer_review']);
  let archive = ABSENT;
  if (p !== ABSENT) {
    const source = read(p, 'source_sha', 'producer', isSha1);
    read(p, 'base_sha', 'producer', isSha1);
    read(p, 'tree_sha', 'producer', isSha1);
    const version = read(p, 'package_version', 'producer', isSemver);
    if (candidate !== ABSENT && version !== ABSENT) {
      need(candidate === version, 'MISMATCH', 'receipt.candidate');
    }
    const names = read(p, 'contract_names', 'producer', isPositive);
    const versions = read(p, 'schema_versions', 'producer', isPositive);
    if (names !== ABSENT && versions !== ABSENT) {
      need(versions >= names, 'MISMATCH', 'producer.schema_versions');
    }
    const manifest = section(p, 'schema_hashes', 'producer', ['url', 'digest']);
    if (manifest !== ABSENT) {
      const pin = read(manifest, 'url', 'producer.schema_hashes', (v) => pinnedFile(v) !== null);
      if (pin !== ABSENT && source !== ABSENT) {
        need(pinnedFile(pin) === source, 'MISMATCH', 'producer.schema_hashes.url');
      }
      read(manifest, 'digest', 'producer.schema_hashes', isPrefixed256);
    }
    archive = read(p, 'archive_sha256', 'producer', isSha256Hex);
    read(p, 'archive_sri', 'producer', isSri);
    read(p, 'content_digest', 'producer', isPrefixed256);
    read(p, 'fixture_digest', 'producer', isPrefixed256);
    // Stage-1 evidence: null is allowed and does not block metadata completeness.
    if (Object.hasOwn(p, 'producer_review')) {
      need(p.producer_review === null || isPinnedUrl(p.producer_review), 'BAD_FORMAT', 'producer.producer_review');
    } else add('MISSING_FIELD', 'producer.producer_review');
  }

  // consumer_run
  const c = section(receipt, 'consumer_run', '$', [
    'consumer_sha', 'consumer_tree', 'installed_from', 'environment', 'caller',
    'contracts_exercised', 'type_check', 'scenarios', 'counts', 'failures',
    'skips', 'limitations', 'authority', 'evidence_links']);
  if (c !== ABSENT) checkRun(c);

  // stages
  const s = section(receipt, 'stages', '$', STAGE_KEYS);
  if (s !== ABSENT) {
    for (const key of STAGE_KEYS) {
      if (!Object.hasOwn(s, key)) { add('MISSING_FIELD', `stages.${key}`); continue; }
      const v = s[key];
      if (v === null) continue; // pending
      if (!isObj(v)) { add('BAD_FORMAT', `stages.${key}`); continue; }
      checkStage(key, v);
    }
  }

  function checkRun(run) {
    read(run, 'consumer_sha', 'consumer_run', isSha1);
    read(run, 'consumer_tree', 'consumer_run', isSha1);
    const from = read(run, 'installed_from', 'consumer_run', (v) => isSha256Hex(v) || isPrefixed256(v));
    if (from !== ABSENT && archive !== ABSENT) {
      need(from.replace(/^sha256:/, '') === archive, 'MISMATCH', 'consumer_run.installed_from');
    }
    const env = section(run, 'environment', 'consumer_run', ['node', 'os']);
    if (env !== ABSENT) {
      read(env, 'node', 'consumer_run.environment', nodeSupported);
      read(env, 'os', 'consumer_run.environment', (v) => isStr(v, 64));
    }
    read(run, 'caller', 'consumer_run', isToken);
    const ex = read(run, 'contracts_exercised', 'consumer_run', (v) => Array.isArray(v) && v.length <= 500 && v.every(isContract));
    if (ex !== ABSENT) {
      need(ex.length > 0, 'EMPTY_LIST', 'consumer_run.contracts_exercised');
      need(new Set(ex).size === ex.length, 'BAD_FORMAT', 'consumer_run.contracts_exercised');
    }
    const tc = section(run, 'type_check', 'consumer_run', ['command', 'exit_code']);
    if (tc !== ABSENT) checkCommand(tc, 'consumer_run.type_check', false);

    const sc = read(run, 'scenarios', 'consumer_run', (v) => Array.isArray(v) && v.length <= 500 && v.every(isObj));
    if (sc !== ABSENT) {
      need(sc.length > 0, 'EMPTY_LIST', 'consumer_run.scenarios');
      sc.forEach((item, i) => {
        const path = `consumer_run.scenarios[${i}]`;
        exact(item, ['name', 'command', 'exit_code'], path);
        checkCommand(item, path, true);
      });
    }

    const counts = section(run, 'counts', 'consumer_run', ['tests', 'fixture_cases', 'negative_assertions']);
    if (counts !== ABSENT) {
      const tests = read(counts, 'tests', 'consumer_run.counts', isCount);
      if (tests === 0) add('ZERO_TESTS', 'consumer_run.counts.tests');
      read(counts, 'fixture_cases', 'consumer_run.counts', isCount);
      read(counts, 'negative_assertions', 'consumer_run.counts', isCount);
    }
    checkTally(run, 'failures', 'NONZERO_FAILURES');
    checkTally(run, 'skips', 'NONZERO_SKIPS');

    const lim = read(run, 'limitations', 'consumer_run', (v) => Array.isArray(v) && v.length <= 50 && v.every((x) => isStr(x, 1000)));
    if (lim !== ABSENT) need(lim.length > 0, 'EMPTY_LIST', 'consumer_run.limitations');

    read(run, 'authority', 'consumer_run', (v) => v === 'synthetic' || (isObj(v) &&
      Object.keys(v).length === 2 && isToken(v.reference_id) && isPrefixed256(v.digest)));
    const links = read(run, 'evidence_links', 'consumer_run', (v) => Array.isArray(v) && v.length <= 50 && v.every(isPinnedUrl));
    if (links !== ABSENT) need(links.length > 0, 'EMPTY_LIST', 'consumer_run.evidence_links');
  }

  function checkCommand(obj, path, named) {
    if (named) read(obj, 'name', path, isToken);
    else exact(obj, ['command', 'exit_code'], path);
    // Command text is stored as metadata. It is never executed or interpreted.
    read(obj, 'command', path, (v) => isStr(v, 500));
    const code = read(obj, 'exit_code', path, Number.isSafeInteger);
    if (code !== ABSENT && code !== 0) add('NONZERO_EXIT', `${path}.exit_code`);
  }

  // failures/skips: { count, identifiers } with count === identifiers.length.
  function checkTally(run, key, nonzeroCode) {
    const path = `consumer_run.${key}`;
    const t = section(run, key, 'consumer_run', ['count', 'identifiers']);
    if (t === ABSENT) return;
    const count = read(t, 'count', path, isCount);
    const ids = read(t, 'identifiers', path, (v) => Array.isArray(v) && v.length <= 1000 && v.every(isToken));
    if (count === ABSENT || ids === ABSENT) return;
    if (count !== ids.length) add('MISMATCH', `${path}.identifiers`);
    else if (count > 0) add(nonzeroCode, `${path}.count`);
  }

  // Stage objects hold references only. A stage is never inferred from a boolean
  // or a string such as "approved"; those fail as BAD_FORMAT.
  function checkStage(key, obj) {
    const path = `stages.${key}`;
    const optional = (o, k, check) => {
      if (Object.hasOwn(o, k) && o[k] !== null && !check(o[k])) add('BAD_FORMAT', `${path}.${k}`);
    };
    if (key === 'domain_owner_acceptance') {
      exact(obj, ['contracts_and_versions', 'accountable_owner', 'reviewer',
        'acknowledgement_ref', 'acknowledgement_digest', 'scope_and_limitations'], path);
      optional(obj, 'contracts_and_versions', (v) => Array.isArray(v) && v.length <= 500 && v.every(isContract));
      optional(obj, 'accountable_owner', isName);
      optional(obj, 'reviewer', isName);
      optional(obj, 'acknowledgement_ref', isPinnedUrl);
      optional(obj, 'acknowledgement_digest', isPrefixed256);
      optional(obj, 'scope_and_limitations', (v) => isStr(v, 1000));
      return;
    }
    exact(obj, ['evidence_ref', 'evidence_digest', 'scope_and_limitations'], path);
    optional(obj, 'evidence_ref', isPinnedUrl);
    optional(obj, 'evidence_digest', isPrefixed256);
    optional(obj, 'scope_and_limitations', (v) => isStr(v, 1000));
  }

  const invalid = errors.some((e) => !INCOMPLETE_CODES.has(e.code));
  const status = invalid ? 'INVALID' : errors.length ? 'INCOMPLETE' : 'METADATA_COMPLETE';
  return { status, errors, notice: NOTICE };
}

const STAGE_KEYS = ['producer_model_review', 'finance_compatibility',
  'private_development_consumption', 'domain_owner_acceptance',
  'product_acceptance', 'merge_release'];

// ---- file loading ----
function maxDepth(text) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') { if (++depth > MAX_DEPTH) return depth; }
    else if (ch === ']' || ch === '}') depth--;
  }
  return depth;
}

function failure(code) {
  return { status: 'INVALID', errors: [{ code, path: '$' }], notice: NOTICE };
}

export function checkReceiptFile(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const st = fstatSync(fd);
    if (!st.isFile()) return failure('FILE_UNREADABLE');
    if (st.size > MAX_BYTES) return failure('FILE_TOO_LARGE');
    const buf = Buffer.alloc(MAX_BYTES + 1);
    let n = 0;
    for (let k; n < buf.length && (k = readSync(fd, buf, n, buf.length - n, null)) > 0;) n += k;
    if (n > MAX_BYTES) return failure('FILE_TOO_LARGE');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, n));
    if (maxDepth(text) > MAX_DEPTH) return failure('DEPTH_EXCEEDED');
    return checkReceipt(JSON.parse(text));
  } catch (e) {
    return failure(e instanceof SyntaxError || e instanceof TypeError ? 'JSON_MALFORMED' : 'FILE_UNREADABLE');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// ---- CLI: exit 0 only for METADATA_COMPLETE, 1 INCOMPLETE, 2 INVALID ----
export function main(argv) {
  const result = argv.length === 1 ? checkReceiptFile(argv[0]) : failure('USAGE');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return { METADATA_COMPLETE: 0, INCOMPLETE: 1, INVALID: 2 }[result.status];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
