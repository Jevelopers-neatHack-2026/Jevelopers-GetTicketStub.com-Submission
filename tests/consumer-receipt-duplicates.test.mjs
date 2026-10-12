import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkReceipt, checkReceiptFile, MAX_BYTES } from '../scripts/check-consumer-receipt.mjs';

const CLI = new URL('../scripts/check-consumer-receipt.mjs', import.meta.url);
const SHA = (c) => c.repeat(40);
const REPO = 'https://github.com/example-org/example-repo';

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

// Check raw text, not an already-parsed object: JSON.parse loses duplicates.
function withFile(text, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'receipt-duplicates-'));
  const file = join(dir, 'receipt.json');
  try {
    writeFileSync(file, text);
    return callback(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const inspect = (text) => withFile(text, (file) => checkReceiptFile(file));
const duplicate = (text) => {
  const result = inspect(text);
  assert.equal(result.status, 'INVALID');
  assert.deepEqual(result.errors, [{ code: 'DUPLICATE_KEY', path: '$' }]);
  assert.match(result.notice, /Not verified/);
};
const raw = () => JSON.stringify(complete());
const replaceOnce = (text, from, to) => {
  assert.ok(text.includes(from), 'regression target must exist');
  return text.replace(from, to);
};

// Each attack used to become METADATA_COMPLETE after last-key-wins parsing.
const attacks = [
  ['type-check failure', '"exit_code":0', '"exit_code":9,"exit_code":0'],
  ['zero tests', '"tests":10', '"tests":0,"tests":10'],
  ['failure tally', '"failures":{"count":0,"identifiers":[]}',
    '"failures":{"count":1,"identifiers":["failed-case"]},"failures":{"count":0,"identifiers":[]}'],
  ['skip tally', '"skips":{"count":0,"identifiers":[]}',
    '"skips":{"count":1,"identifiers":["required-case"]},"skips":{"count":0,"identifiers":[]}'],
  ['source pin', `"source_sha":"${SHA('a')}"`, `"source_sha":"${SHA('f')}","source_sha":"${SHA('a')}"`],
  ['authority', '"authority":"synthetic"', '"authority":"unverified","authority":"synthetic"'],
  ['nested scenario failure', '"command":"npm run scenario-1","exit_code":0',
    '"command":"npm run scenario-1","exit_code":2,"exit_code":0'],
  ['escaped spelling', '"exit_code":0', '"\\u0065xit_code":3,"exit_code":0'],
  ['same value', '"tests":10', '"tests":10,"tests":10'],
];
for (const [name, from, to] of attacks) {
  test(`raw duplicate rejects hidden ${name}`, () => {
    const text = replaceOnce(raw(), from, to);
    // Documents why the raw-text entry point must enforce this boundary.
    assert.equal(checkReceipt(JSON.parse(text)).status, 'METADATA_COMPLETE');
    duplicate(text);
  });
}

test('CLI returns exit 2 and fixed diagnostics without exposing duplicate names or values', () => {
  const marker = 'SYNTHETIC_PRIVATE_SENTINEL';
  const text = `{"${marker}":"${marker}","${marker}":null}`;
  withFile(text, (file, dir) => {
    const run = spawnSync(process.execPath, [CLI.pathname, file], { encoding: 'utf8', timeout: 5000 });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 2);
    assert.equal(run.stderr, '');
    const out = JSON.parse(run.stdout);
    assert.deepEqual(out.errors, [{ code: 'DUPLICATE_KEY', path: '$' }]);
    assert.ok(!run.stdout.includes(marker));
    assert.ok(!run.stdout.includes(dir));
  });
});

test('key comparison decodes JSON escapes, including escaped quotes and surrogates', () => {
  for (const text of [
    String.raw`{"a":1,"\u0061":2}`,
    String.raw`{"/":1,"\/":2}`,
    String.raw`{"a\\b":1,"a\u005cb":2}`,
    String.raw`{"a\"b":1,"a\u0022b":2}`,
    String.raw`{"\ud83d\ude00":1,"😀":2}`,
    String.raw`{"\ud800":1,"\uD800":2}`,
    String.raw`{"":1,"":2}`,
    String.raw`{"__proto__":1,"__proto__":2}`,
    String.raw`{"constructor":1,"constructor":2}`,
    String.raw`{"toString":1,"toString":2}`,
  ]) duplicate(text);
});

test('object scopes are independent across arrays and nested objects', () => {
  const receipt = complete();
  receipt.consumer_run.scenarios.push({ name: 'scenario-2', command: 'npm run scenario-2', exit_code: 0 });
  assert.equal(inspect(JSON.stringify(receipt)).status, 'METADATA_COMPLETE');
  // Parent keys and sibling keys must not contaminate another object's key set.
  const result = inspect('{"x":{"x":0},"y":[{"x":1},{"x":2}]}');
  assert.ok(!result.errors.some((error) => error.code === 'DUPLICATE_KEY'));
  duplicate('{"x":{"x":0},"y":[{"x":1,"x":2}]}');
});

test('strings containing duplicate-looking JSON and escaped delimiters are not keys', () => {
  const receipt = complete();
  receipt.consumer_run.type_check.command = 'echo "tests":0,"tests":10 { [ ] } \\ " :';
  receipt.consumer_run.limitations = ['"x":1,"x":2', 'Unicode 😀 and escaped \\ backslashes.'];
  assert.equal(inspect(JSON.stringify(receipt)).status, 'METADATA_COMPLETE');
  assert.equal(inspect(JSON.stringify(complete(), null, '\t')).status, 'METADATA_COMPLETE');
});

test('invalid JSON retains JSON_MALFORMED rather than being misclassified as a duplicate', () => {
  for (const text of ['{"x":1,"x":}', '{"x":1,"x":2,}', '{"x":1,"x":2} junk']) {
    assert.equal(inspect(text).errors[0].code, 'JSON_MALFORMED');
  }
});

test('depth and byte ceilings apply before duplicate analysis', () => {
  const object = '{"x":1,"x":2}';
  duplicate('['.repeat(63) + object + ']'.repeat(63));
  assert.equal(inspect('['.repeat(64) + object + ']'.repeat(64)).errors[0].code, 'DEPTH_EXCEEDED');
  duplicate(object + ' '.repeat(MAX_BYTES - Buffer.byteLength(object)));
  assert.equal(inspect(object + ' '.repeat(MAX_BYTES + 1 - Buffer.byteLength(object))).errors[0].code, 'FILE_TOO_LARGE');
});

test('many unique keys and equivalent escaped keys remain deterministic', () => {
  const members = Array.from({ length: 512 }, (_, i) => `${JSON.stringify(`key-${i}`)}:${i}`);
  const control = `{${members.join(',')}}`;
  assert.ok(!inspect(control).errors.some((error) => error.code === 'DUPLICATE_KEY'));
  duplicate(String.raw`{${members.join(',')},"\u006bey-511":0}`);
});

test('ordinary complete, incomplete, and invalid receipts retain their statuses', () => {
  assert.equal(inspect(raw()).status, 'METADATA_COMPLETE');
  const incomplete = complete(); incomplete.consumer_run.type_check.exit_code = 1;
  assert.equal(inspect(JSON.stringify(incomplete)).status, 'INCOMPLETE');
  const invalid = complete(); invalid.producer.source_sha = 'not-a-sha';
  assert.equal(inspect(JSON.stringify(invalid)).status, 'INVALID');
});
