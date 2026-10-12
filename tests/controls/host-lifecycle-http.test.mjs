/** Deterministic real HTTP/SQLite lifecycle probes; all authority is MOCK. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { readCaptureInventory } from '../../examples/frontend-action-roundtrip/host-capture-inventory.mjs';
import { DatabaseSync } from 'node:sqlite';
const fixture = new URL('../../examples/frontend-action-roundtrip/server.mjs', import.meta.url);
async function server(t) {
  const evidence = mkdtempSync(join(process.env.CONTROLS_LIFECYCLE_EVIDENCE_DIR ?? tmpdir(), 'lifecycle-http-'));
  const child = spawn(process.execPath, [fixture.pathname], { env: { ...process.env, CONTROLS_FIXTURE_PORT: '0', CONTROLS_BROWSER_EVIDENCE_DIR: evidence } });
  let stderr = ''; child.stderr.on('data', value => { stderr += value; });
  const ready = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error(`MOCK fixture exited before readiness: ${stderr}`); })]);
  const port = /127\.0\.0\.1:(\d+)/.exec(String(ready[0]))?.[1]; assert.ok(port);
  const call = async (path, data) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(10000), ...(data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }) });
    assert.equal(response.status, 200, `${path} must succeed`); return response.json();
  };
  t.after(async () => {
    let releaseError;
    try {
      const state = await call('/__fixture/lifecycle');
      if (!state.closed) assert.equal((await call('/__fixture/state', { release: true })).ok, true);
    } catch (error) { releaseError = error; }
    child.kill('SIGTERM'); const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
    const [code, signal] = child.exitCode !== null || child.signalCode !== null ? [child.exitCode, child.signalCode] : await once(child, 'exit');
    clearTimeout(kill);
    assert.equal(signal, null, 'MOCK fixture must stop without a forced signal');
    assert.equal(code, 0, 'MOCK fixture must finalize successfully on orderly stop');
    if (releaseError) throw releaseError;
    if (!process.env.CONTROLS_LIFECYCLE_EVIDENCE_DIR) rmSync(evidence, { recursive: true, force: true });
  });
  return { call, evidence };
}
async function until(call, predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const state = await call('/__fixture/lifecycle'); if (predicate(state)) return state; }
  assert.fail('MOCK lifecycle synchronization did not reach the declared state');
}
async function initialize(call) {
  const current = await call('/api/composition/current'); assert.equal(current.view.status, 'not_initialized');
  const action = { action_version: 'creative-composition-initialize/1.0', action_id: 'lifecycle-initialize', intent: 'initialize', review_sha256: current.view.review.review_sha256 };
  const applied = await call('/api/composition/apply', action); assert.equal(applied.result.ok, true); return applied.result;
}
function captureFiles(root, prefix = '') {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name), relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...captureFiles(path, relative));
    else {
      assert.equal(entry.isFile(), true, 'Captured evidence must contain only regular files and directories');
      const bytes = readFileSync(path); files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  return files;
}
function validateCapture(evidence, expectedPreviewCount) {
  const inventory = readCaptureInventory(evidence); assert.equal(inventory.sessions.length, 1, 'one completed capture of the retired host');
  assert.equal(inventory.attempts.length, 0, 'Normal HTTP captures must not contain failed attempts');
  const { root, receipt } = inventory.sessions[0];
  assert.equal(receipt.counters.composition_previews, expectedPreviewCount); assert.equal(receipt.live_calls, 0);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json')));
  assert.equal(receipt.files, manifest.length);
  assert.deepEqual(captureFiles(join(root, 'store-root')), manifest, 'Manifest must match complete captured membership and bytes');
  return join(root, 'store-root');
}
for (const transition of ['reset', 'capture']) test(`${transition} drains an admitted current read and preserves its own counters and exact store`, { timeout: 15000 }, async t => {
  const { call, evidence } = await server(t); await initialize(call);
  const before = await call('/api/composition/current');
  const action = { action_version: 'creative-composition-apply/1.0', action_id: 'lifecycle-prior-apply', intent: 'apply', projection_sha256: before.view.projection.projection_sha256, draft: { categories: { name_size: 'large' }, exact: {} } };
  const initialized = (await call('/api/composition/apply', action)).result; assert.equal(initialized.ok, true);
  assert.equal((await call('/__fixture/state', { block: 'composition-current' })).ok, true);
  const read = call('/api/composition/current'); await until(call, state => state.waiting === 'composition-current');
  let completed = false; const change = call(`/__fixture/${transition}`, transition === 'reset' ? { lock_logo: true } : {}).then(value => { completed = true; return value; });
  const retiring = await until(call, state => state.retiring);
  assert.equal(retiring.closed, false); assert.equal(retiring.active, 1); assert.equal(completed, false); assert.deepEqual(readdirSync(evidence), []);
  assert.equal((await call('/__fixture/state', { release: true })).ok, true);
  const original = await read; assert.equal(original.view.status, 'current'); assert.equal(original.view.projection.base.revision_id, initialized.revision_id);
  assert.equal(original.counters.composition_previews, 1); assert.equal((await change).ok, true);
  validateCapture(evidence, 1);
  if (transition === 'capture') { assert.equal((await call('/__fixture/capture', {})).ok, true); assert.equal(readCaptureInventory(evidence).sessions.length, 1); assert.equal((await call('/__fixture/reset', { lock_logo: true })).ok, true); }
  assert.ok((await call('/api/schema')).schema); const replacement = await call('/api/composition/current');
  assert.equal(replacement.view.status, 'not_initialized'); assert.equal(replacement.counters.composition_previews, 0);
});
for (const transition of ['reset', 'capture']) for (const cancel of [false, true]) test(`${transition} permits ${cancel ? 'cancel and release' : 'release'} of a genuine held Apply`, { timeout: 15000 }, async t => {
  const { call, evidence } = await server(t); await initialize(call); const initial = await call('/api/composition/current');
  await call('/__fixture/state', { block: 'composition-preview' });
  const action = { action_version: 'creative-composition-apply/1.0', action_id: 'lifecycle-held-apply', intent: 'apply', projection_sha256: initial.view.projection.projection_sha256, draft: { categories: { name_size: 'large' }, exact: {} } };
  const apply = call('/api/composition/apply', action); await until(call, state => state.waiting === 'composition-preview');
  const change = call(`/__fixture/${transition}`, transition === 'reset' ? { lock_logo: true } : {});
  assert.equal((await until(call, state => state.retiring)).closed, false);
  if (cancel) assert.equal((await call('/api/composition/cancel', { action_id: action.action_id })).result.status, 'cancelled');
  assert.equal((await call('/__fixture/state', { release: true })).ok, true);
  const applied = await apply; assert.equal(applied.result.status, cancel ? 'cancelled' : 'saved'); assert.equal((await change).ok, true);
  const store = validateCapture(evidence, 1), sealed = captureFiles(dirname(store));
  const inspection = mkdtempSync(join(tmpdir(), 'lifecycle-store-inspection-'));
  try {
    // Read-only SQLite WAL inspection can create sidecars. Inspect a disposable
    // copy so that terminal-job assertions cannot alter sealed custody.
    const copy = join(inspection, 'store-root'); cpSync(store, copy, { recursive: true });
    const db = new DatabaseSync(join(copy, 'creative.sqlite'), { readOnly: true });
    try { assert.equal(db.prepare('SELECT status FROM creative_jobs WHERE action_id=?').get(action.action_id).status, cancel ? 'cancelled' : 'completed'); }
    finally { db.close(); }
  } finally { rmSync(inspection, { recursive: true, force: true }); }
  assert.deepEqual(captureFiles(dirname(store)), sealed, 'Inspection must preserve every sealed member and byte hash');
  validateCapture(evidence, 1);
  if (transition === 'capture') assert.equal((await call('/__fixture/reset', {})).ok, true);
  assert.ok((await call('/api/schema')).schema); assert.equal((await call('/api/composition/current')).view.status, 'not_initialized');
});
