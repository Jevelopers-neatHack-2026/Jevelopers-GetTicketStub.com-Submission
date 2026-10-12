// Offline fixture runner for the SC-13 reporting-v1 PROPOSAL schemas.
// Structural validation only. Not authority, not Finance accounting, not exported.
//
// Usage: SC_AJV_ROOT=/abs/path/to/node_modules node proposals/reporting-v1/validate.mjs [fixtures.json]
//
// Ajv 8.17.1 is provisioned outside this repo. Nothing is installed or fetched.
// Output is counts, case ids, error keywords and sanitised schema locations only.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AJV_VERSION = '8.17.1';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA_KEYS = ['query', 'manifest'];
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export class RunnerError extends Error {}

// Loads Ajv2020 from the explicitly provisioned root and verifies the real package version.
export function loadAjv2020(root) {
  if (typeof root !== 'string' || root === '') throw new RunnerError('SC_AJV_ROOT is not set; point it at a node_modules directory containing ajv@' + AJV_VERSION);
  if (!isAbsolute(root)) throw new RunnerError('SC_AJV_ROOT must be an absolute path');
  let real;
  let pkg;
  try {
    real = realpathSync(root);
    pkg = JSON.parse(readFileSync(join(real, 'ajv', 'package.json'), 'utf8'));
  } catch {
    throw new RunnerError('ajv package not found under SC_AJV_ROOT; provision ajv@' + AJV_VERSION + ' (no auto install)');
  }
  if (pkg.name !== 'ajv') throw new RunnerError('SC_AJV_ROOT/ajv is not the ajv package');
  if (pkg.version !== AJV_VERSION) throw new RunnerError(`ajv version ${String(pkg.version).slice(0, 32)} found, ${AJV_VERSION} required`);
  let Ajv2020;
  try {
    const req = createRequire(join(real, 'ajv', 'package.json'));
    const file = realpathSync(req.resolve('./dist/2020.js'));
    if (!file.startsWith(real + sep)) throw new Error('outside root');
    Ajv2020 = req(file);
    Ajv2020 = Ajv2020.default ?? Ajv2020;
  } catch {
    throw new RunnerError('ajv/dist/2020 could not be loaded from SC_AJV_ROOT');
  }
  if (typeof Ajv2020 !== 'function') throw new RunnerError('ajv/dist/2020 did not export a constructor');
  return { Ajv2020, version: pkg.version };
}

// Rejects anything but closed objects and local $defs refs, so the Ajv run needs no network or other files.
export function checkSchemaShape(schema, label) {
  const problems = [];
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') problems.push('not draft 2020-12');
  const walk = (node, at) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${at}/${i}`));
    if (typeof node.$ref === 'string' && !/^#\/\$defs\/[A-Za-z0-9_]+$/.test(node.$ref)) problems.push(`non-local $ref at ${at}`);
    if (node.properties && node.additionalProperties !== false) problems.push(`open object at ${at}`);
    for (const [k, v] of Object.entries(node.properties ?? {})) walk(v, `${at}/properties/${k}`);
    for (const [k, v] of Object.entries(node.$defs ?? {})) walk(v, `${at}/$defs/${k}`);
    for (const k of ['items', 'not']) walk(node[k], `${at}/${k}`);
    for (const k of ['oneOf', 'anyOf', 'allOf']) walk(node[k], `${at}/${k}`);
    // if/then/else hold conditions, not closed data objects, so they are not walked.
  };
  walk(schema, '');
  if (problems.length) throw new RunnerError(`${label} schema shape: ${problems.join('; ')}`);
}

// Strict compile. Strict mode is never relaxed.
export function compileSchemas(Ajv2020, schemas) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validators = {};
  for (const key of SCHEMA_KEYS) {
    checkSchemaShape(schemas[key], key);
    try {
      validators[key] = ajv.compile(schemas[key]);
    } catch (e) {
      throw new RunnerError(`${key} schema failed strict compile: ${String(e.message).slice(0, 200)}`);
    }
  }
  return validators;
}

export function readSchemas(dir = HERE, names = null) {
  const fixtures = names ?? { query: 'reporting-query.schema.json', manifest: 'reporting-export-manifest.schema.json' };
  return Object.fromEntries(SCHEMA_KEYS.map((k) => [k, JSON.parse(readFileSync(join(dir, fixtures[k]), 'utf8'))]));
}

// ---- fixtures: positives and negatives are full documents or a base plus JSON-pointer-style patch ----

const decode = (path) => {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new RunnerError('bad patch path');
  const segs = path.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (segs.some((s) => UNSAFE_SEGMENTS.has(s))) throw new RunnerError('unsafe patch segment');
  return segs;
};
const parentOf = (doc, segs) => {
  let node = doc;
  for (const s of segs.slice(0, -1)) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, s)) throw new RunnerError('patch path not found');
    node = node[s];
  }
  if (node === null || typeof node !== 'object') throw new RunnerError('patch parent is not a container');
  return node;
};
const slot = (parent, key) => (Array.isArray(parent) ? (key === '-' ? parent.length : Number(key)) : key);
const getAt = (doc, path) => {
  const segs = decode(path);
  return segs.length ? parentOf(doc, segs)[segs.at(-1)] : doc;
};

export function applyPatch(doc, patch) {
  let out = structuredClone(doc);
  for (const op of patch) {
    const segs = decode(op.path);
    if (segs.length === 0) throw new RunnerError('root patch not supported');
    const parent = parentOf(out, segs);
    const key = slot(parent, segs.at(-1));
    const exists = Array.isArray(parent) ? Number.isInteger(key) && key >= 0 && key < parent.length : Object.hasOwn(parent, key);
    switch (op.op) {
      case 'add':
        if (Array.isArray(parent)) parent.splice(key, 0, structuredClone(op.value));
        else parent[key] = structuredClone(op.value);
        break;
      case 'replace':
        if (!exists) throw new RunnerError('replace target not found');
        parent[key] = structuredClone(op.value);
        break;
      case 'remove':
        if (!exists) throw new RunnerError('remove target not found');
        if (Array.isArray(parent)) parent.splice(key, 1);
        else delete parent[key];
        break;
      case 'generate_ids': // distinct ids prefix1..prefixN
        if (!exists) throw new RunnerError('generate_ids target not found');
        parent[key] = Array.from({ length: op.count }, (_, i) => `${op.prefix}${i + 1}`);
        break;
      case 'repeat_item': // N copies of the first element
        if (!exists || !Array.isArray(parent[key]) || parent[key].length === 0) throw new RunnerError('repeat_item target invalid');
        parent[key] = Array.from({ length: op.count }, () => structuredClone(parent[key][0]));
        break;
      default:
        throw new RunnerError('unknown patch op');
    }
  }
  return out;
}

export function checkFixtureStructure(fx) {
  if (fx?.synthetic !== true || !Array.isArray(fx.cases) || fx.cases.length === 0) throw new RunnerError('fixtures must be marked synthetic and contain cases');
  const byId = new Map();
  for (const c of fx.cases) {
    if (typeof c.id !== 'string' || byId.has(c.id)) throw new RunnerError('fixture ids must be unique strings');
    if (!SCHEMA_KEYS.includes(c.schema)) throw new RunnerError(`case ${c.id}: unknown schema key`);
    if (c.expect !== 'valid' && c.expect !== 'invalid') throw new RunnerError(`case ${c.id}: expect must be valid|invalid`);
    const full = 'data' in c;
    if (full === ('base' in c)) throw new RunnerError(`case ${c.id}: exactly one of data or base`);
    if (!full) {
      const b = byId.get(c.base);
      if (!b || b.schema !== c.schema || !('data' in b)) throw new RunnerError(`case ${c.id}: base must be an earlier full document of the same schema`);
      if (!Array.isArray(c.patch) || c.patch.length === 0) throw new RunnerError(`case ${c.id}: patch required`);
    }
    if (c.expect === 'invalid' && (typeof c.error_at !== 'string' || !('base' in c))) throw new RunnerError(`case ${c.id}: negatives need base and error_at`);
    byId.set(c.id, c);
  }
  return byId;
}

// Only keywords and locations made of known-safe characters are reported. Instance values, schema params
// (which may echo property names), messages and file paths are never emitted.
const safeLocation = (p) => (/^(\/[A-Za-z0-9_]{1,40}){0,12}$/.test(p) ? p : '/?');
const summariseErrors = (errors) => (errors ?? []).slice(0, 5).map((e) => ({ keyword: String(e.keyword).replace(/[^A-Za-z0-9$]/g, '').slice(0, 24), at: safeLocation(e.instancePath) }));

export function evaluate(fx, validators) {
  const byId = checkFixtureStructure(fx);
  const failures = [];
  const counts = { cases: fx.cases.length, valid_expected: 0, invalid_expected: 0, passed: 0, failed: 0 };
  for (const c of fx.cases) {
    const data = 'data' in c ? c.data : applyPatch(byId.get(c.base).data, c.patch);
    const validate = validators[c.schema];
    const ok = validate(data) === true;
    const errors = validate.errors;
    counts[c.expect === 'valid' ? 'valid_expected' : 'invalid_expected']++;
    let reason = null;
    if (c.expect === 'valid' && !ok) reason = 'expected_valid_got_invalid';
    else if (c.expect === 'invalid' && ok) reason = 'expected_invalid_got_valid';
    else if (c.expect === 'invalid' && !(errors ?? []).some((e) => e.instancePath.startsWith(c.error_at) && (!c.keyword || e.keyword === c.keyword))) reason = 'error_location_mismatch';
    if (reason) {
      counts.failed++;
      failures.push({ id: c.id, reason, errors: summariseErrors(errors) });
    } else counts.passed++;
  }
  return { counts, failures };
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function run({ root, fixturesPath = join(HERE, 'fixtures.json'), schemaDir = HERE }) {
  const { Ajv2020, version } = loadAjv2020(root);
  const schemas = readSchemas(schemaDir);
  const validators = compileSchemas(Ajv2020, schemas);
  const raw = readFileSync(fixturesPath);
  let fx;
  try {
    fx = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new RunnerError('fixtures file is not valid JSON');
  }
  const { counts, failures } = evaluate(fx, validators);
  return {
    ajv_version: version,
    node_version: process.versions.node,
    strict_compile: true,
    schemas_compiled: SCHEMA_KEYS.length,
    fixtures_sha256: sha256(raw),
    schema_sha256: Object.fromEntries(SCHEMA_KEYS.map((k) => [k, sha256(Buffer.from(JSON.stringify(schemas[k])))])),
    ...counts,
    failures,
    scope: 'structural validation of synthetic fixtures only; not semantic acceptance',
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = run({ root: process.env.SC_AJV_ROOT, ...(process.argv[2] ? { fixturesPath: process.argv[2] } : {}) });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.failed === 0 ? 0 : 1;
  } catch (e) {
    console.error(`validate.mjs: ${e instanceof RunnerError ? e.message : 'unexpected error'}`);
    process.exitCode = 2;
  }
}
