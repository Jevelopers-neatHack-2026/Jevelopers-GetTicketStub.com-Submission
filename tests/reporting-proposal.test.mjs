import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, loadAjv2020, compileSchemas, readSchemas, readSchemaBuffers, evaluate, applyPatch, checkFixtureStructure, AJV_VERSION } from '../proposals/reporting-v1/validate.mjs';

// SYNTHETIC fixtures only. Ajv is provisioned outside the repo and named explicitly by SC_AJV_ROOT.
const RUNNER = new URL('../proposals/reporting-v1/validate.mjs', import.meta.url).pathname;
const FIXTURES = new URL('../proposals/reporting-v1/fixtures.json', import.meta.url).pathname;
const AJV_ROOT = process.env.SC_AJV_ROOT;
const SECRET = 'SECRET-sk_live_hostile_value_123';

const fixtures = () => JSON.parse(readFileSync(FIXTURES, 'utf8'));
let cached;
const validators = () => {
  // No silent skip: a missing or wrong Ajv fails every dependent test with the loader's message.
  if (!cached) cached = compileSchemas(loadAjv2020(AJV_ROOT).Ajv2020, readSchemas());
  return cached;
};
const docs = () => {
  const fx = fixtures();
  const byId = checkFixtureStructure(fx);
  const doc = (id) => {
    const c = byId.get(id);
    return 'data' in c ? structuredClone(c.data) : applyPatch(byId.get(c.base).data, c.patch);
  };
  return { fx, byId, doc };
};
const runCli = (args = [], env = { SC_AJV_ROOT: AJV_ROOT }) =>
  spawnSync(process.execPath, [RUNNER, ...args], { env, encoding: 'utf8', timeout: 60000 });
const ordinalOf = (fx, id) => fx.cases.findIndex((c) => c.id === id) + 1;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const SCHEMA_DIR = new URL('../proposals/reporting-v1/', import.meta.url).pathname;
const tmp = () => mkdtempSync(join(tmpdir(), 'sc-reporting-'));

test('SC_AJV_ROOT is provisioned and is the pinned Ajv version', () => {
  assert.ok(AJV_ROOT, 'SC_AJV_ROOT must name a node_modules directory containing ajv@' + AJV_VERSION);
  assert.equal(loadAjv2020(AJV_ROOT).version, AJV_VERSION);
});

test('fixture library: expected counts, synthetic marker, uncovered semantics listed', () => {
  const fx = fixtures();
  assert.equal(fx.synthetic, true);
  assert.ok(fx.not_covered_by_schema.length >= 5);
  const pos = fx.cases.filter((c) => c.expect === 'valid');
  const neg = fx.cases.filter((c) => c.expect === 'invalid');
  assert.ok(pos.length >= 10 && neg.length >= 100);
  for (const s of ['query', 'manifest']) {
    assert.ok(pos.some((c) => c.schema === s), `positive for ${s}`);
    assert.ok(neg.filter((c) => c.schema === s).length >= 40, `negatives for ${s}`);
  }
});

test('all fixtures meet their expected outcome under strict-compiled schemas', () => {
  const { counts, failures } = evaluate(fixtures(), validators());
  assert.deepEqual(failures, []);
  assert.equal(counts.failed, 0);
  assert.equal(counts.passed, counts.cases);
});

test('required guarantees are represented by fixtures', () => {
  const { byId, doc } = docs();
  const m = doc('manifest.positive.full');
  assert.deepEqual(m.totals[0].amount, { state: 'known', value: '0' }, 'exact zero');
  assert.deepEqual(m.totals[1].amount, { state: 'unknown', value: null, reason: 'missing_source' }, 'unknown is null with reason');
  assert.ok(m.source_watermarks.some((w) => w.watermark.state === 'known') && m.source_watermarks.some((w) => w.watermark.state === 'unknown'));
  assert.ok(m.ratios.some((r) => r.value.reason === 'denominator_zero') && m.ratios.some((r) => r.value.reason === 'denominator_missing'));
  assert.ok(byId.get('query.positive.pinned_cursor') && byId.get('query.positive.resolve_at_as_of'));
});

test('positives mutated: each removed top-level key becomes invalid', () => {
  const v = validators();
  for (const [schema, id] of [['query', 'query.positive.pinned'], ['manifest', 'manifest.positive.full']]) {
    const { doc } = docs();
    const base = doc(id);
    assert.equal(v[schema](base), true);
    for (const key of Object.keys(base)) {
      const copy = structuredClone(base);
      delete copy[key];
      assert.equal(v[schema](copy), false, `${schema} without ${key}`);
    }
  }
});

test('positives mutated: an extra key at every object level becomes invalid', () => {
  const v = validators();
  for (const [schema, id] of [['query', 'query.positive.pinned'], ['manifest', 'manifest.positive.full']]) {
    const base = docs().doc(id);
    const paths = [];
    const walk = (n, p) => {
      if (n && typeof n === 'object') {
        if (!Array.isArray(n)) paths.push(p);
        for (const [k, c] of Object.entries(n)) walk(c, `${p}/${k}`);
      }
    };
    walk(base, '');
    assert.ok(paths.length > 20);
    for (const p of paths) {
      const out = applyPatch(base, [{ op: 'add', path: `${p}/zz_extra`, value: 1 }]);
      assert.equal(v[schema](out), false, `${schema} extra key at ${p || 'root'}`);
    }
  }
});

test('positives mutated: every sha256 string rejects zero-filled, uppercase and truncated digests', () => {
  const v = validators();
  for (const [schema, id] of [['query', 'query.positive.pinned_cursor'], ['manifest', 'manifest.positive.full']]) {
    const base = docs().doc(id);
    const paths = [];
    const walk = (n, p) => {
      if (typeof n === 'string' && /^sha256:/.test(n)) paths.push(p);
      else if (n && typeof n === 'object') for (const [k, c] of Object.entries(n)) walk(c, `${p}/${k}`);
    };
    walk(base, '');
    assert.ok(paths.length >= 8);
    for (const p of paths) {
      for (const bad of [`sha256:${'0'.repeat(64)}`, `sha256:${'A'.repeat(64)}`, `sha256:${'1'.repeat(63)}`, '']) {
        assert.equal(v[schema](applyPatch(base, [{ op: 'replace', path: p, value: bad }])), false, `${schema} ${p}`);
      }
    }
  }
});

test('positives mutated: amounts reject numbers, exponent, plus and negative zero; unknown rejects values', () => {
  const v = validators();
  const base = docs().doc('manifest.positive.full');
  for (const bad of [12.5, 0, '1e3', '+1', '-0', '00', 'x', null]) {
    assert.equal(v.manifest(applyPatch(base, [{ op: 'replace', path: '/totals/0/amount/value', value: bad }])), false, `known ${String(bad)}`);
  }
  for (const bad of ['0', 0, '', false]) {
    assert.equal(v.manifest(applyPatch(base, [{ op: 'replace', path: '/totals/1/amount/value', value: bad }])), false, `unknown ${String(bad)}`);
  }
});

test('a permissive validator fails the expected negative outcomes', () => {
  const fx = fixtures();
  const permissive = { query: Object.assign(() => true, { errors: null }), manifest: Object.assign(() => true, { errors: null }) };
  const { counts, failures } = evaluate(fx, permissive);
  const negatives = fx.cases.filter((c) => c.expect === 'invalid').length;
  assert.equal(counts.failed, negatives);
  assert.ok(failures.every((f) => f.reason === 'expected_invalid_got_valid'));
});

test('a validator that rejects everything fails the expected positives', () => {
  const fx = fixtures();
  const strictAll = { query: Object.assign(() => false, { errors: [{ keyword: 'x', instancePath: '' }] }), manifest: Object.assign(() => false, { errors: [{ keyword: 'x', instancePath: '' }] }) };
  const { failures } = evaluate(fx, strictAll);
  const positives = fx.cases.filter((c) => c.expect === 'valid').length;
  assert.equal(failures.filter((f) => f.reason === 'expected_valid_got_invalid').length, positives);
});

test('schemas with additionalProperties:false stripped are caught by the unknown-key negatives', () => {
  const { Ajv2020 } = loadAjv2020(AJV_ROOT);
  const schemas = readSchemas();
  const strip = (n) => {
    if (n && typeof n === 'object') {
      if (!Array.isArray(n) && n.additionalProperties === false) delete n.additionalProperties;
      Object.values(n).forEach(strip);
    }
    return n;
  };
  // compileSchemas rejects open objects by design, so compile directly for this sensitivity check.
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const broken = { query: ajv.compile(strip(structuredClone(schemas.query))), manifest: ajv.compile(strip(structuredClone(schemas.manifest))) };
  const { failures } = evaluate(fixtures(), broken);
  const fx = fixtures();
  const ids = failures.map((f) => f.ordinal);
  for (const id of ['query.neg.unknown_key_top', 'query.neg.unknown_key_page', 'manifest.neg.unknown_key_top', 'manifest.neg.unknown_key_file']) assert.ok(ids.includes(ordinalOf(fx, id)), id);
});

test('error_at must match: wrong location is reported as a mismatch', () => {
  const fx = fixtures();
  const neg = fx.cases.find((c) => c.id === 'query.neg.currency_lowercase');
  neg.error_at = '/period';
  const { failures } = evaluate(fx, validators());
  assert.deepEqual(failures.map((f) => [f.ordinal, f.reason]), [[ordinalOf(fx, 'query.neg.currency_lowercase'), 'error_location_mismatch']]);
});

test('tampered fixture expectations fail in-process and in the CLI', () => {
  const fx = fixtures();
  fx.cases.find((c) => c.id === 'manifest.neg.decimal_exponent').expect = 'valid';
  fx.cases.find((c) => c.id === 'query.positive.denominator_ref').expect = 'invalid';
  const withErrorAt = structuredClone({ ...fx, cases: fx.cases.map((c) => (c.id === 'query.positive.denominator_ref' ? { ...c, error_at: '' } : c)) });
  const { failures } = evaluate(withErrorAt, validators());
  assert.deepEqual(failures.map((f) => f.reason).sort(), ['expected_invalid_got_valid', 'expected_valid_got_invalid']);
  // Without an explicit error_at the flipped positive is refused as malformed.
  assert.throws(() => evaluate(fx, validators()), /negatives need base and error_at/);

  const dir = tmp();
  try {
    const file = join(dir, 'tampered.json');
    const raw = fixtures();
    raw.cases.find((c) => c.id === 'manifest.neg.decimal_exponent').expect = 'valid';
    writeFileSync(file, JSON.stringify(raw));
    const r = runCli([file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /"failed": 1/);
    assert.equal(JSON.parse(r.stdout).failures[0].ordinal, ordinalOf(raw, 'manifest.neg.decimal_exponent'));
    assert.ok(!r.stdout.includes('manifest.neg.decimal_exponent'), 'ids are never emitted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tampered fixture data (positive broken, negative repaired) fails', () => {
  const broken = fixtures();
  broken.cases.find((c) => c.id === 'query.positive.pinned').data.currency = 'usd';
  assert.ok(evaluate(broken, validators()).failures.some((f) => f.ordinal === ordinalOf(broken, 'query.positive.pinned') && f.reason === 'expected_valid_got_invalid'));
  const repaired = fixtures();
  repaired.cases.find((c) => c.id === 'query.neg.currency_lowercase').patch = [{ op: 'replace', path: '/query_id', value: 'q-other' }];
  assert.deepEqual(evaluate(repaired, validators()).failures.map((f) => [f.ordinal, f.reason]), [[ordinalOf(repaired, 'query.neg.currency_lowercase'), 'expected_invalid_got_valid']]);
});

test('malformed fixtures are rejected before any validation', () => {
  const bad = (mut) => { const fx = fixtures(); mut(fx); return () => checkFixtureStructure(fx); };
  assert.throws(bad((fx) => { fx.synthetic = false; }), /synthetic/);
  assert.throws(bad((fx) => { fx.cases[1].id = fx.cases[0].id; }), /unique/);
  assert.throws(bad((fx) => { fx.cases[1].base = 'missing'; }), /base/);
  assert.throws(bad((fx) => { delete fx.cases.find((c) => c.expect === 'invalid').error_at; }), /error_at/);
  assert.throws(() => applyPatch({ a: {} }, [{ op: 'add', path: '/__proto__/x', value: 1 }]), /unsafe/);
  assert.throws(() => applyPatch({ a: 1 }, [{ op: 'replace', path: '/b', value: 1 }]), /not found/);
});

test('CLI passes with explicit env, emits counts only and no paths, values or secrets', () => {
  const r = spawnSync(process.execPath, [RUNNER], { env: { SC_AJV_ROOT: AJV_ROOT, SC_TEST_SECRET: SECRET }, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ajv_version, AJV_VERSION);
  assert.equal(out.failed, 0);
  assert.equal(out.strict_compile, true);
  assert.equal(out.cases, fixtures().cases.length);
  for (const leak of [AJV_ROOT, SECRET, 'tenant-synthetic', 'project-synthetic', process.env.HOME ?? '\0']) {
    assert.ok(!r.stdout.includes(leak) && !r.stderr.includes(leak), 'output must not contain paths, fixture values or secrets');
  }
});

test('CLI failure output stays path/value free', () => {
  const dir = tmp();
  try {
    const raw = fixtures();
    raw.cases.find((c) => c.id === 'query.neg.unknown_key_top').expect = 'valid';
    raw.cases.find((c) => c.id === 'query.positive.pinned').data.expected_scope.tenant_id = SECRET;
    raw.cases.find((c) => c.id === 'query.positive.pinned').data.zz_extra_key_name = 1;
    const file = join(dir, 'f.json');
    writeFileSync(file, JSON.stringify(raw));
    const r = runCli([file], { SC_AJV_ROOT: AJV_ROOT });
    assert.equal(r.status, 1);
    for (const leak of [SECRET, 'zz_extra_key_name', dir, AJV_ROOT]) assert.ok(!r.stdout.includes(leak) && !r.stderr.includes(leak));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema_sha256 is the sha256 of the raw committed bytes, and formatting changes alter it', () => {
  const r = runCli();
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const buffers = readSchemaBuffers();
  const files = { query: 'reporting-query.schema.json', manifest: 'reporting-export-manifest.schema.json' };
  for (const k of ['query', 'manifest']) {
    assert.equal(out.schema_sha256[k], sha256(readFileSync(join(SCHEMA_DIR, files[k]))), `${k} raw file hash`);
    assert.equal(out.schema_sha256[k], sha256(buffers[k]));
    assert.notEqual(out.schema_sha256[k], sha256(Buffer.from(JSON.stringify(JSON.parse(buffers[k].toString('utf8'))))), `${k} not the parsed-and-restringified hash`);
  }
  // Control: same parsed content, different bytes -> different hash through the real runner.
  const dir = tmp();
  try {
    for (const k of ['query', 'manifest']) {
      writeFileSync(join(dir, files[k]), buffers[k]);
    }
    const run1 = (d) => run({ root: AJV_ROOT, schemaDir: d }).schema_sha256;
    const before = run1(dir);
    assert.deepEqual(before, out.schema_sha256, 'byte-identical copy hashes the same');
    const reformatted = JSON.stringify(JSON.parse(buffers.query.toString('utf8')), null, '\t') + '\n\n';
    assert.notEqual(reformatted, buffers.query.toString('utf8'));
    writeFileSync(join(dir, files.query), reformatted);
    const after = run1(dir);
    assert.deepEqual(parsedOf(dir, files.query), parsedOf(SCHEMA_DIR, files.query), 'parsed content unchanged');
    assert.notEqual(after.query, before.query, 'bytes changed, hash changes');
    assert.equal(after.query, sha256(Buffer.from(reformatted)));
    assert.equal(after.manifest, before.manifest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const parsedOf = (d, f) => JSON.parse(readFileSync(join(d, f), 'utf8'));

test('hostile fixture ids never reach diagnostics, errors or CLI output', () => {
  const MARKER = 'SYNTHETIC_SECRET_MARKER';
  const hostile = (n) => `${MARKER}-${n}-/Users/x/secret`;
  const noLeak = (text) => { for (const leak of [MARKER, '/Users/x/secret']) assert.ok(!text.includes(leak), `leak: ${leak}`); };

  // Tampered expectation with a hostile id: mismatch is still reported, by ordinal only.
  const fx = fixtures();
  const i = fx.cases.findIndex((c) => c.id === 'manifest.neg.decimal_exponent');
  fx.cases[i].id = hostile('tamper');
  fx.cases[i].expect = 'valid';
  const { failures, counts } = evaluate(fx, validators());
  assert.equal(counts.failed, 1);
  assert.deepEqual(failures.map((f) => [f.ordinal, f.reason]), [[i + 1, 'expected_valid_got_invalid']]);
  assert.deepEqual(Object.keys(failures[0]).sort(), ['errors', 'ordinal', 'reason']);
  noLeak(JSON.stringify(failures));

  // Malformed controls: every structure error must be marker-free and name only the ordinal.
  const mutations = [
    (c) => { c.schema = 'nope'; },
    (c) => { c.expect = 'maybe'; },
    (c) => { c.data = {}; },
    (c) => { delete c.patch; },
    (c) => { c.patch = []; },
    (c) => { c.base = hostile('missing-base'); },
    (c) => { delete c.error_at; },
  ];
  for (const [n, mutate] of mutations.entries()) {
    const bad = fixtures();
    const j = bad.cases.findIndex((c) => c.expect === 'invalid');
    bad.cases[j].id = hostile(`m${n}`);
    mutate(bad.cases[j]);
    let message;
    try { checkFixtureStructure(bad); } catch (e) { message = e.message; }
    assert.ok(message, `mutation ${n} must be rejected`);
    noLeak(message);
    assert.match(message, new RegExp(`case #${j + 1}:`));
    assert.throws(() => evaluate(bad, validators()), (e) => !e.message.includes(MARKER));
  }
  // Duplicate hostile ids.
  const dup = fixtures();
  dup.cases[0].id = hostile('dup');
  dup.cases[1].id = hostile('dup');
  assert.throws(() => checkFixtureStructure(dup), (e) => /case #2: .*unique/.test(e.message) && !e.message.includes(MARKER));

  // Public CLI: tampered, malformed and a hostile base reference.
  const dir = tmp();
  try {
    const cli = (raw) => {
      const file = join(dir, 'h.json');
      writeFileSync(file, JSON.stringify(raw));
      return runCli([file]);
    };
    const tampered = cli(fx);
    assert.equal(tampered.status, 1);
    assert.equal(JSON.parse(tampered.stdout).failures[0].ordinal, i + 1);
    noLeak(tampered.stdout + tampered.stderr);
    assert.ok(!(tampered.stdout + tampered.stderr).includes(dir) && !(tampered.stdout + tampered.stderr).includes(AJV_ROOT));

    const malformed = fixtures();
    malformed.cases[i].id = hostile('cli-malformed');
    malformed.cases[i].base = hostile('cli-base');
    const m = cli(malformed);
    assert.equal(m.status, 2);
    assert.match(m.stderr, new RegExp(`case #${i + 1}:`));
    noLeak(m.stdout + m.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing or wrong Ajv fails clearly in an isolated subprocess (no install, no network)', () => {
  const dir = tmp();
  try {
    const clean = { SC_TEST_SECRET: SECRET };
    let r = runCli([], clean);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /SC_AJV_ROOT is not set/);

    r = runCli([], { ...clean, SC_AJV_ROOT: 'relative/path' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /absolute/);

    r = runCli([], { ...clean, SC_AJV_ROOT: join(dir, 'does-not-exist') });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ajv package not found/);

    mkdirSync(join(dir, 'ajv'), { recursive: true });
    writeFileSync(join(dir, 'ajv', 'package.json'), JSON.stringify({ name: 'ajv', version: '8.17.0' }));
    r = runCli([], { ...clean, SC_AJV_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /8\.17\.0 found, 8\.17\.1 required/);

    writeFileSync(join(dir, 'ajv', 'package.json'), JSON.stringify({ name: 'not-ajv', version: AJV_VERSION }));
    r = runCli([], { ...clean, SC_AJV_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not the ajv package/);

    writeFileSync(join(dir, 'ajv', 'package.json'), JSON.stringify({ name: 'ajv', version: AJV_VERSION }));
    r = runCli([], { ...clean, SC_AJV_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /could not be loaded/);

    for (const res of [r]) assert.ok(!res.stdout.includes(SECRET) && !res.stderr.includes(SECRET) && !res.stderr.includes(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('open or non-local-ref schemas are refused, strict compile is not relaxed', () => {
  const { Ajv2020 } = loadAjv2020(AJV_ROOT);
  const good = readSchemas();
  const open = structuredClone(good);
  delete open.query.properties.page.additionalProperties;
  assert.throws(() => compileSchemas(Ajv2020, open), /open object/);
  const remote = structuredClone(good);
  remote.manifest.properties.currency = { $ref: 'https://example.invalid/x.json' };
  assert.throws(() => compileSchemas(Ajv2020, remote), /non-local \$ref/);
  const unknownKeyword = structuredClone(good);
  unknownKeyword.query.properties.currency = { type: 'string', notAKeyword: true };
  assert.throws(() => compileSchemas(Ajv2020, unknownKeyword), /strict compile/);
});

test('the runner sources add no dependencies or package files', () => {
  const src = readFileSync(RUNNER, 'utf8');
  assert.ok(!/from 'ajv|require\('ajv|import\('ajv|child_process|fetch\(|node:https?|node:net/.test(src));
});
