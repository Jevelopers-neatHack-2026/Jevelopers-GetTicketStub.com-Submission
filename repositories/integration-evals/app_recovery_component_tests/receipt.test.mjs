import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTap, expectedTests, sanitizedTap, pgUnavailable, validateReceipt, validateRecordedReceipt } from './receipt.mjs';
import { sourceCustody, digest } from './custody.mjs';
import { collectObservations, projectRow, validateObservations } from './observations.mjs';
import { cleanupOwned, parseEvents, retirePrivate } from './lifecycle.mjs';
import { runBounded } from './process.mjs';

const pin = JSON.parse(await readFile(new URL('../contracts/app-recovery-producer-pin.json', import.meta.url)));
const fixtureTap = () => ['TAP version 13', ...expectedTests.flatMap((name, index) => [`# Subtest: ${name}`, `ok ${index + 1} - ${name}`]),
  '# Finance-first unavailable: zero Product admissions/provider writes; real SQL exact persisted dispatch replay ACK only',
  '1..5', '# tests 5', '# suites 0', '# pass 5', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0', ''].join('\n');
const fixtureReceipt = () => ({ kind: 'app-recovery-component-development', status: 'passed', source: pin.revision, tree: pin.tree,
  mode: 'synthetic-owner-fixtures', paid_execution_enabled: false, adoption_accepted: false, platform: 'linux', node: `v${pin.node}`,
  command: { exitCode: 0, failure: null, groupAbsent: true }, tests: parseTap(fixtureTap()),
  postgres: { observation_basis: 'owner_assertion', independent: { ...pgUnavailable } },
  sqlite: { validated: true, artifact: 'sqlite-observations.json', sha256: 'a'.repeat(64) },
  cleanup: { confirmed: true, unknown: [], owned: ['b'.repeat(64)], private_removed: true } });
async function record(name, value) {
  if (process.env.APP_RECOVERY_TEST_EVIDENCE) {
    await mkdir(process.env.APP_RECOVERY_TEST_EVIDENCE, { recursive: true });
    await writeFile(join(process.env.APP_RECOVERY_TEST_EVIDENCE, `${name}.json`), JSON.stringify({ synthetic_control: true, ...value }, null, 2));
  }
}

test('accepts exact five identities when all summaries and fixture diagnostic agree', () => {
  const text = fixtureTap();
  const result = parseTap(text);
  assert.equal(result.length, 5);
});
for (const [name, transform] of [
  ['empty', () => ''], ['missing', text => text.replace(/^ok 3.*\n/m, '')],
  ['renamed', text => text.replace(expectedTests[2], 'renamed').replace(expectedTests[2], 'renamed')],
  ['skip', text => text.replace(`ok 5 - ${expectedTests[4]}`, `ok 5 - ${expectedTests[4]} # SKIP`) ],
  ['failure', text => text.replace('ok 4 -', 'not ok 4 -')],
  ['todo', text => text.replace('ok 1 -', 'ok 1 -').replace('# todo 0', '# todo 1')],
  ['cancelled', text => text.replace('# cancelled 0', '# cancelled 1')],
  ['duplicate summary', text => `${text}# pass 5\n`],
  ['missing fixture diagnostic', text => text.replace(/^# Finance-first.*\n/m, '')],
]) test(`rejects ${name} TAP instead of qualifying`, () => {
  const text = transform(fixtureTap());
  assert.throws(() => parseTap(text));
});
for (const [name, mutate] of [
  ['pin drift', value => { value.source = '0'.repeat(40); }],
  ['missing SQLite declaration', value => { delete value.sqlite; }],
  ['unknown cleanup', value => { value.cleanup.unknown = ['unknown']; }],
  ['empty ownership', value => { value.cleanup.owned = []; }],
  ['fabricated independent PG balance', value => { value.postgres.independent.balances = 0; }],
  ['fabricated independent PG role', value => { value.postgres.independent.roles = [{ rolsuper: false }]; }],
  ['promoted adoption', value => { value.adoption_accepted = true; }],
]) test(`rejects ${name} receipt`, () => {
  const value = fixtureReceipt(); mutate(value);
  assert.throws(() => validateReceipt(value, pin));
});
test('sanitization withholds arbitrary logs and failure diagnostics', () => {
  const text = `${fixtureTap()}password=canary\n  actual: postgres://secret@host\n# arbitrary secret\n`;
  const sanitized = sanitizedTap(text);
  assert.ok(!/canary|secret|arbitrary/.test(sanitized));
  assert.match(sanitized, /# tests 5/);
});
test('missing retained SQLite files rejects direct evidence collection', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'app-recovery-unit-')));
  await mkdir(join(root, 'ticketstub-creative-host-unit'));
  try { await assert.rejects(collectObservations(root), { code: 'ENOENT' }); } finally { await rm(root, { recursive: true }); }
});
test('real read-only SQLite projection rejects missing table without exporting registry', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'app-recovery-unit-'))); const dir = join(root, 'ticketstub-creative-host-unit'); await mkdir(dir);
  const db = new DatabaseSync(join(dir, 'concurrent-recovery.sqlite')); db.exec('CREATE TABLE registry (secret TEXT); INSERT INTO registry VALUES (\'canary\')'); db.close();
  try { await assert.rejects(collectObservations(root)); } finally { await rm(root, { recursive: true }); }
});
test('projection hashes identity and request bytes without exporting authority', () => {
  const row = { attempt: { billable_attempt_id: 'private-id' }, state: 'held_for_reconciliation', observations: [{ source_observation_id: 'private-observation' }], usage_request: { secret: 'canary' }, registry: 'private-registry' };
  const result = projectRow(row);
  assert.equal(result.usage_request_sha256, digest(row.usage_request));
  assert.equal(result.observation_count, 1); assert.equal(result.unique_observation_count, 1);
  assert.ok(!/private|canary|registry/.test(JSON.stringify(result)));
});
test('concurrency projection rejects invented counts', () => {
  assert.throws(() => validateObservations({ observation_basis: 'direct_post_exit_sqlite', concurrent: [{ observation_count: 0 }], recovery: [] }));
});
const id = 'a'.repeat(64); const unknown = 'b'.repeat(64); const name = 'ticketstub-finance-recovery-0123456789';
const event = action => ({ id, name, image: pin.postgres, action, time: 10 });
const context = () => ({ baseline: [], image: pin.postgres, events: [event('create'), event('start')] });
test('unknown container prevents any deletion', async () => {
  const removed = [];
  const docker = { inventory: () => [id, unknown], remove: value => removed.push(value) };
  await assert.rejects(cleanupOwned(context(), docker));
  assert.deepEqual(removed, []);
});
test('changed ownership prevents captured ID deletion', async () => {
  const removed = [];
  const docker = { inventory: () => [id], inspect: () => ({ id, name: 'foreign', image: pin.postgres }), remove: value => removed.push(value) };
  await assert.rejects(cleanupOwned(context(), docker)); assert.deepEqual(removed, []);
});
test('bounded cleanup removes only captured revalidated ID', async () => {
  let present = true; const removed = [];
  const docker = { inventory: () => present ? [id] : [], inspect: () => ({ id, name, image: pin.postgres }), remove: value => { removed.push(value); present = false; } };
  const result = await cleanupOwned(context(), docker);
  assert.deepEqual(removed, [id]); assert.equal(result.confirmed, true);
  await record('owned-cleanup', result);
});
test('event custody rejects preexisting IDs and mismatched pinned image', () => {
  const line = JSON.stringify({ Type: 'container', Action: 'create', Actor: { ID: id, Attributes: { name, image: 'postgres:latest' } }, time: 10 });
  assert.throws(() => parseEvents(line, { baseline: [], since: 9, until: 11, image: pin.postgres }));
});
for (const [name, script, options] of [
  ['timeout', 'setInterval(() => {}, 1000)', { timeout: 150, limit: 4096 }],
  ['output_overflow', "process.stdout.write('x'.repeat(65536)); setInterval(() => {}, 1000)", { timeout: 5000, limit: 1024 }],
]) test(`${name} terminates inert process group and preserves failed control receipt`, async () => {
  const result = await runBounded(process.execPath, ['-e', script], { ...options, grace: 100, env: {} });
  assert.equal(result.failure, name); assert.equal(result.groupAbsent, true); assert.notEqual(result.exitCode, 0);
  const receipt = { status: 'failed', command: result, product_execution: false };
  await record(name, receipt);
});
test('clean inert child completes without lifecycle failure', async () => {
  const result = await runBounded(process.execPath, ['-e', "console.log('inert')"], { env: {}, timeout: 5000 });
  assert.equal(result.exitCode, 0); assert.equal(result.failure, null); assert.equal(result.groupAbsent, true);
});
if (process.env.APP_RECOVERY_PIN_SOURCE) test('exact source bytes bind the owner pin and drift fails', async () => {
  const source = process.env.APP_RECOVERY_PIN_SOURCE;
  const actual = await sourceCustody(source, pin); assert.equal(actual.revision, pin.revision);
  await assert.rejects(sourceCustody(source, { ...pin, tracked_files_sha256: '0'.repeat(64) }));
  await record('source-custody-verification', actual);
});
test('post-exit SQLite invariants are observed from real synthetic fixture tables', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'app-recovery-unit-')));
  const dir = join(root, 'ticketstub-creative-host-unit'); await mkdir(dir);
  const observation = { source_observation_id: 'first' };
  const held = { attempt: { billable_attempt_id: 'one' }, state: 'held_for_reconciliation' };
  const concurrent = { ...held, observation, observations: [observation, ...['two', 'three', 'four'].map(source_observation_id => ({ source_observation_id }))],
    usage_request: { fixture: 'opaque original request bytes' }, recovery_reasons: ['original_unknown', 'finance_lifecycle_unavailable', 'concurrent_unknown', 'public_settlement_unavailable', 'public_release_unavailable'] };
  const retry = { ...held, observations: [observation, { source_observation_id: 'two' }], dispatch_ack: { status: 'replay', owner_revision: 2 },
    usage_request: { fixture: 'request' }, dispatch_command: { fixture: 'command' }, intake_receipt: { status: 'accepted', outboxStatus: 'retry', durableCommit: true }, recovery_reasons: ['concurrent_owner_replay_unknown'] };
  const pending = { ...retry, intake_receipt: { status: 'accepted', outboxStatus: 'pending', durableCommit: true }, recovery_reason: 'usage_outbox_pending' };
  for (const [file, rows] of [['concurrent-recovery.sqlite', [concurrent]], ['recovery.sqlite', [retry, pending, ...Array.from({ length: 4 }, () => held)]]]) {
    const db = new DatabaseSync(join(dir, file)); db.exec('CREATE TABLE ticketstub_creative_attempts (state TEXT)');
    for (const row of rows) db.prepare('INSERT INTO ticketstub_creative_attempts VALUES (?)').run(JSON.stringify(row));
    db.close();
  }
  try {
    const result = await collectObservations(root);
    assert.equal(result.concurrent[0].observation_count, 4); assert.equal(result.recovery.length, 6);
    await record('sqlite-projection', result);
  } finally { await rm(root, { recursive: true }); }
});
test('uncertain bootstrap descendant quarantines private files before owner context exists', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'app-recovery-unit-')));
  await writeFile(join(root, 'fixture-marker'), 'potentially-live');
  try {
    const result = await retirePrivate(root, { terminationConfirmed: false, resourceCleanupConfirmed: true });
    assert.equal(result.private_removed, false);
    assert.equal(await readFile(join(root, 'fixture-marker'), 'utf8'), 'potentially-live');
    await record('uncertain-bootstrap-quarantine', { status: 'failed', ...result });
  } finally { await rm(root, { recursive: true }); }
});
test('retained sanitized TAP remains independently parseable', () => {
  const retained = sanitizedTap(fixtureTap());
  assert.equal(parseTap(retained).length, 5);
});

test('recorded passing claim rejects an absent SQLite artifact', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'app-recovery-unit-')));
  await writeFile(join(root, 'receipt.json'), JSON.stringify(fixtureReceipt()));
  await writeFile(join(root, 'owner.tap'), fixtureTap());
  try { await assert.rejects(validateRecordedReceipt(root, pin), { code: 'ENOENT' }); }
  finally { await rm(root, { recursive: true }); }
});
