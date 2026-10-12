import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkReceipt, MAX_BYTES } from '../scripts/check-consumer-receipt.mjs';

const CLI = new URL('../scripts/check-consumer-receipt.mjs', import.meta.url).pathname;
const SHA = (c) => c.repeat(40);
const REPO = 'https://github.com/example-org/example-repo';
const SECRET = 'SECRET-sk_live_hostile_value_123';

// SYNTHETIC data only. Every hash and URL below is made up for tests.
const complete = () => ({
  receipt: { consumer: 'agent-harness', candidate: '0.9.7', recorded_at: '2026-10-12T05:00:00Z' },
  producer: {
    source_sha: SHA('a'), base_sha: SHA('b'), tree_sha: SHA('c'), package_version: '0.9.7',
    contract_names: 3, schema_versions: 4,
    schema_hashes: { url: `${REPO}/blob/${SHA('a')}/schemas/manifest.json`, digest: `sha256:${'1'.repeat(64)}` },
    archive_sha256: '2'.repeat(64),
    archive_sri: `sha512-${Buffer.alloc(64, 7).toString('base64')}`,
    content_digest: `sha256:${'3'.repeat(64)}`, fixture_digest: `sha256:${'4'.repeat(64)}`,
    producer_review: null,
  },
  consumer_run: {
    consumer_sha: SHA('d'), consumer_tree: SHA('e'), installed_from: `sha256:${'2'.repeat(64)}`,
    environment: { node: '24.21.0', os: 'linux' },
    caller: 'src/contracts-entry.mjs',
    contracts_exercised: ['ProjectRequest/1.0.0', 'UsageEvent/1.0.0'],
    type_check: { command: 'npm run typecheck', exit_code: 0 },
    scenarios: [{ name: 'scenario-1', command: 'npm run scenario-1', exit_code: 0 }],
    counts: { tests: 10, fixture_cases: 5, negative_assertions: 2 },
    failures: { count: 0, identifiers: [] },
    skips: { count: 0, identifiers: [] },
    limitations: ['Synthetic authority only.'],
    authority: 'synthetic',
    evidence_links: [`${REPO}/actions/runs/123456`],
  },
  stages: {
    producer_model_review: null, finance_compatibility: null,
    private_development_consumption: null,
    domain_owner_acceptance: {
      contracts_and_versions: null, accountable_owner: null, reviewer: null,
      acknowledgement_ref: null, acknowledgement_digest: null, scope_and_limitations: null,
    },
    product_acceptance: null, merge_release: null,
  },
});

const codes = (r) => r.errors.map((e) => `${e.code}@${e.path}`);
const mutate = (fn) => { const r = complete(); fn(r); return checkReceipt(r); };

test('complete synthetic receipt is METADATA_COMPLETE with null stages', () => {
  const r = checkReceipt(complete());
  assert.equal(r.status, 'METADATA_COMPLETE');
  assert.deepEqual(r.errors, []);
  assert.match(r.notice, /Not verified/);
});

test('structured filled stage is accepted as metadata only', () => {
  const r = mutate((x) => {
    x.stages.finance_compatibility = { evidence_ref: `${REPO}/pull/1#issuecomment-99`, evidence_digest: `sha256:${'5'.repeat(64)}` };
  });
  assert.equal(r.status, 'METADATA_COMPLETE');
});

test('all-null template is INCOMPLETE, never INVALID', () => {
  const t = complete();
  for (const k of Object.keys(t.receipt)) t.receipt[k] = null;
  for (const k of Object.keys(t.producer)) t.producer[k] = null;
  for (const k of Object.keys(t.consumer_run)) t.consumer_run[k] = null;
  const r = checkReceipt(t);
  assert.equal(r.status, 'INCOMPLETE');
  assert.ok(r.errors.every((e) => e.code === 'NULL_FIELD'));
});

test('missing and null are distinguished', () => {
  const r = mutate((x) => { delete x.producer.tree_sha; x.producer.base_sha = null; });
  assert.equal(r.status, 'INCOMPLETE');
  assert.ok(codes(r).includes('MISSING_FIELD@producer.tree_sha'));
  assert.ok(codes(r).includes('NULL_FIELD@producer.base_sha'));
});

test('malformed hashes, SRI, version, consumer are INVALID', () => {
  const cases = [
    [(x) => { x.producer.source_sha = 'A'.repeat(40); }, 'producer.source_sha'],
    [(x) => { x.producer.tree_sha = 'abc'; }, 'producer.tree_sha'],
    [(x) => { x.producer.archive_sha256 = '2'.repeat(63); }, 'producer.archive_sha256'],
    [(x) => { x.producer.content_digest = '3'.repeat(64); }, 'producer.content_digest'],
    [(x) => { x.producer.archive_sri = `sha512-${Buffer.alloc(48).toString('base64')}`; }, 'producer.archive_sri'],
    [(x) => { x.producer.archive_sri = `sha256-${Buffer.alloc(32).toString('base64')}`; }, 'producer.archive_sri'],
    [(x) => { x.producer.package_version = 'v0.9.7'; }, 'producer.package_version'],
    [(x) => { x.receipt.consumer = 'unknown-repo'; }, 'receipt.consumer'],
    [(x) => { x.producer.contract_names = 0; }, 'producer.contract_names'],
    [(x) => { x.producer.schema_versions = 2.5; }, 'producer.schema_versions'],
    [(x) => { x.receipt.recorded_at = '2026-02-31T00:00:00Z'; }, 'receipt.recorded_at'],
  ];
  for (const [fn, path] of cases) {
    const r = mutate(fn);
    assert.equal(r.status, 'INVALID', path);
    assert.ok(r.errors.some((e) => e.path === path), path);
  }
});

test('candidate/package, installed_from, manifest pin and count consistency', () => {
  assert.ok(codes(mutate((x) => { x.receipt.candidate = '0.9.8'; })).includes('MISMATCH@receipt.candidate'));
  assert.ok(codes(mutate((x) => { x.consumer_run.installed_from = '9'.repeat(64); })).includes('MISMATCH@consumer_run.installed_from'));
  assert.ok(codes(mutate((x) => { x.producer.schema_hashes.url = `${REPO}/blob/${SHA('f')}/m.json`; })).includes('MISMATCH@producer.schema_hashes.url'));
  assert.ok(codes(mutate((x) => { x.producer.schema_versions = 2; })).includes('MISMATCH@producer.schema_versions'));
});

test('mutable or non-GitHub evidence URLs are rejected', () => {
  for (const url of [
    `${REPO}/blob/main/README.md`, `${REPO}/issues/3`, `${REPO}/tree/main`,
    `http://github.com/example-org/example-repo/actions/runs/1`,
    `https://example.com/example-org/example-repo/actions/runs/1`,
    `${REPO}/actions/runs/1?token=x`, `${REPO}/blob/${SHA('a')}/../x`,
  ]) {
    const r = mutate((x) => { x.consumer_run.evidence_links = [url]; });
    assert.equal(r.status, 'INVALID', url);
  }
  const bad = mutate((x) => { x.producer.schema_hashes.url = `${REPO}/blob/main/m.json`; });
  assert.equal(bad.status, 'INVALID');
});

test('nonzero failures, skips, exit codes remain INCOMPLETE', () => {
  const f = mutate((x) => { x.consumer_run.failures = { count: 1, identifiers: ['t-1'] }; });
  assert.equal(f.status, 'INCOMPLETE');
  assert.ok(codes(f).includes('NONZERO_FAILURES@consumer_run.failures.count'));
  const s = mutate((x) => { x.consumer_run.skips = { count: 2, identifiers: ['a', 'b'] }; });
  assert.equal(s.status, 'INCOMPLETE');
  const e = mutate((x) => { x.consumer_run.scenarios[0].exit_code = 1; });
  assert.equal(e.status, 'INCOMPLETE');
  assert.equal(mutate((x) => { x.consumer_run.counts.tests = 0; }).status, 'INCOMPLETE');
  assert.equal(mutate((x) => { x.consumer_run.evidence_links = []; }).status, 'INCOMPLETE');
});

test('count/identifier mismatch and bad counts are INVALID', () => {
  assert.ok(codes(mutate((x) => { x.consumer_run.failures = { count: 0, identifiers: ['hidden'] }; }))
    .includes('MISMATCH@consumer_run.failures.identifiers'));
  assert.equal(mutate((x) => { x.consumer_run.skips = { count: 1, identifiers: [] }; }).status, 'INVALID');
  assert.equal(mutate((x) => { x.consumer_run.counts.fixture_cases = -1; }).status, 'INVALID');
  assert.equal(mutate((x) => { x.consumer_run.counts.tests = '10'; }).status, 'INVALID');
  assert.equal(mutate((x) => { x.consumer_run.failures = 0; }).status, 'INVALID');
  assert.equal(mutate((x) => { x.consumer_run.type_check.exit_code = '0'; }).status, 'INVALID');
});

test('node version support window', () => {
  for (const [v, ok] of [['22.23.3', true], ['22.23.2', false], ['22.30.0', true], ['24.21.0', true],
    ['24.20.9', false], ['23.9.0', false], ['20.0.0', false], ['v24.21.0', false], ['25.0.0', false]]) {
    const r = mutate((x) => { x.consumer_run.environment.node = v; });
    assert.equal(r.status, ok ? 'METADATA_COMPLETE' : 'INVALID', v);
  }
});

test('stage booleans and "approved" strings are rejected', () => {
  for (const v of [true, 'approved', 'APPROVE', 1, []]) {
    const r = mutate((x) => { x.stages.merge_release = v; });
    assert.equal(r.status, 'INVALID');
    assert.ok(codes(r).includes('BAD_FORMAT@stages.merge_release'));
  }
  assert.equal(mutate((x) => { x.stages.domain_owner_acceptance.accountable_owner = true; }).status, 'INVALID');
  assert.equal(mutate((x) => { x.stages.product_acceptance = { approved: true }; }).status, 'INVALID');
  assert.equal(mutate((x) => { x.stages.domain_owner_acceptance.acknowledgement_ref = `${REPO}/issues/3`; }).status, 'INVALID');
});

test('unknown keys and non-object roots are INVALID', () => {
  assert.equal(mutate((x) => { x.approved = true; }).status, 'INVALID');
  assert.equal(mutate((x) => { x.producer.extra = 1; }).status, 'INVALID');
  for (const v of [null, [], 'x', 5, true]) assert.equal(checkReceipt(v).status, 'INVALID');
});

test('authority must be synthetic or a digest-bound owner-held reference', () => {
  assert.equal(mutate((x) => { x.consumer_run.authority = 'real'; }).status, 'INVALID');
  assert.equal(mutate((x) => { x.consumer_run.authority = { reference_id: 'vault-ref-1', digest: `sha256:${'6'.repeat(64)}` }; }).status, 'METADATA_COMPLETE');
  assert.equal(mutate((x) => { x.consumer_run.limitations = []; }).status, 'INCOMPLETE');
});

test('hostile values never appear in results', () => {
  const r = mutate((x) => {
    x.producer.source_sha = SECRET;
    x.consumer_run.caller = SECRET;
    x.consumer_run.failures = { count: 0, identifiers: [SECRET] };
    x[SECRET] = SECRET;
    x.stages.merge_release = { [SECRET]: SECRET };
  });
  assert.equal(r.status, 'INVALID');
  assert.ok(!JSON.stringify(r).includes('SECRET'));
});

// ---- CLI ----
const dir = mkdtempSync(join(tmpdir(), 'receipt-test-'));
const put = (name, content) => { const p = join(dir, name); writeFileSync(p, content); return p; };
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

function assertClean(res) {
  const out = res.stdout + res.stderr;
  assert.ok(!out.includes(dir), 'path leaked');
  assert.ok(!out.includes('SECRET'), 'content leaked');
  assert.equal(res.stderr, '');
  JSON.parse(res.stdout);
}

test('CLI exit codes: complete 0, incomplete 1, invalid 2', () => {
  const ok = run(put('ok.json', JSON.stringify(complete())));
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).status, 'METADATA_COMPLETE');
  const t = complete(); t.producer.base_sha = null;
  const inc = run(put('inc.json', JSON.stringify(t)));
  assert.equal(inc.status, 1);
  assert.equal(JSON.parse(inc.stdout).status, 'INCOMPLETE');
  const t2 = complete(); t2.producer.base_sha = SECRET;
  const bad = run(put('bad.json', JSON.stringify(t2)));
  assert.equal(bad.status, 2);
  for (const res of [ok, inc, bad]) assertClean(res);
});

test('CLI handles malformed JSON, missing file, usage, directory without leaks', () => {
  const cases = [
    [[put('mal.json', `{"a": ${SECRET}`)], 'JSON_MALFORMED'],
    [[join(dir, `nope-${SECRET}.json`)], 'FILE_UNREADABLE'],
    [[dir], 'FILE_UNREADABLE'],
    [[], 'USAGE'],
    [['a', 'b'], 'USAGE'],
  ];
  for (const [args, code] of cases) {
    const res = run(...args);
    assert.equal(res.status, 2);
    assert.equal(JSON.parse(res.stdout).errors[0].code, code);
    assertClean(res);
  }
});

test('CLI enforces file size and nesting limits', () => {
  const big = run(put('big.json', JSON.stringify({ pad: 'x'.repeat(MAX_BYTES) })));
  assert.equal(JSON.parse(big.stdout).errors[0].code, 'FILE_TOO_LARGE');
  assert.equal(big.status, 2);
  const deep = run(put('deep.json', '['.repeat(65) + ']'.repeat(65)));
  assert.equal(JSON.parse(deep.stdout).errors[0].code, 'DEPTH_EXCEEDED');
  assert.equal(deep.status, 2);
  const okDepth = run(put('depth64.json', '['.repeat(64) + ']'.repeat(64)));
  assert.equal(JSON.parse(okDepth.stdout).errors[0].code, 'BAD_FORMAT');
  for (const res of [big, deep, okDepth]) assertClean(res);
});

test('command strings are metadata and are never executed', () => {
  const marker = join(dir, 'executed-marker');
  const t = complete();
  t.consumer_run.type_check.command = `touch ${marker}; node -e "require('fs').writeFileSync('${marker}','x')"`;
  t.consumer_run.scenarios[0].command = `$(touch ${marker}) && echo SECRET`;
  const res = run(put('cmd.json', JSON.stringify(t)));
  assert.equal(res.status, 0);
  assert.equal(existsSync(marker), false);
  assertClean(res);
});
