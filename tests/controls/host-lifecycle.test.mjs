import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostSessions } from '../../examples/frontend-action-roundtrip/host-session.mjs';
import { CreativeVersionStore } from 'creative-engine/versions';
import { createIntegratedHost } from '../../fixtures/controls/integrated-host.mjs';
import { closeAndCaptureHost } from '../../examples/frontend-action-roundtrip/host-capture.mjs';
import { createHostLifecycle } from '../../examples/frontend-action-roundtrip/host-lifecycle.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  const events = [], initial = { host: { id: 'old', close() { events.push('close-old'); } }, dir: 'old' };
  const lifecycle = createHostLifecycle(initial, {
    async create() { return { host: { id: 'new', close() { events.push('close-new'); } }, dir: 'new' }; },
    finalize(session) { session.host.close(); session.closed = true; session.finalized = true; events.push(`capture-${session.dir}`); },
    remove(session) { events.push(`remove-${session.dir}`); }, ...overrides,
  });
  return { lifecycle, events };
}
test('reset waits for leases; drain control retains old host; queued reads use replacement', async () => {
  const { lifecycle, events } = fixture(), lease = await lifecycle.acquire();
  const reset = lifecycle.change('reset', {}); await tick();
  assert.deepEqual(lifecycle.state(), { active: 1, retiring: true, closed: false, finalized: false, waiting: null });
  let admitted = false; const queued = lifecycle.acquire().then(value => { admitted = true; return value; });
  const release = await lifecycle.acquire({ draining: true }); assert.equal(release.host, lease.host); release.release();
  await tick(); assert.equal(admitted, false); assert.deepEqual(events, []);
  lease.release(); lease.release(); await reset;
  const next = await queued; assert.equal(next.host.id, 'new'); next.release();
  assert.deepEqual(events, ['close-old', 'capture-old', 'remove-old']);
  await lifecycle.stop();
});
test('capture is idempotent and a subsequent reset restores normal admission', async () => {
  const { lifecycle, events } = fixture();
  await Promise.all([lifecycle.change('capture'), lifecycle.change('capture')]);
  assert.deepEqual(events, ['close-old', 'capture-old']);
  await assert.rejects(lifecycle.acquire(), /finalized/);
  await lifecycle.change('reset', {}); const lease = await lifecycle.acquire(); assert.equal(lease.host.id, 'new'); lease.release(); await lifecycle.stop();
});
test('initialization failure leaves old host usable and lifecycle queue recoverable', async () => {
  let fail = true; const { lifecycle } = fixture({ create() { if (fail) throw new Error('MOCK initialization failure'); return { dir: 'new', host: { close() {} } }; } });
  await assert.rejects(lifecycle.change('reset', {}), /MOCK initialization/);
  const lease = await lifecycle.acquire(); assert.equal(lease.host.id, 'old'); lease.release();
  assert.equal(lifecycle.state().closed, false); fail = false; await lifecycle.change('reset', {}); await lifecycle.stop();
});
test('failed capture rejects, cleans replacement, preserves old evidence and allows later reset', async () => {
  let fail = true; const { lifecycle, events } = fixture({ finalize(session) { session.closed = true; if (fail) throw new Error('MOCK capture failure'); session.finalized = true; } });
  await assert.rejects(lifecycle.change('reset', {}), /MOCK capture/);
  assert.deepEqual(events, ['close-new', 'remove-new']); assert.equal(lifecycle.state().closed, true);
  await assert.rejects(lifecycle.acquire(), /finalized/); fail = false;
  await lifecycle.change('reset', {}); await lifecycle.stop(); assert.ok(events.includes('remove-old'));
});
test('replacement cleanup failure still opens admission barrier and preserves error', async () => {
  const { lifecycle } = fixture({ finalize() { throw new Error('MOCK capture failure'); }, remove() { throw new Error('MOCK cleanup failure'); } });
  await assert.rejects(lifecycle.change('reset', {}), error => error instanceof AggregateError && error.errors.map(value => value.message).join(',') === 'MOCK capture failure,MOCK cleanup failure'); assert.equal(lifecycle.state().retiring, false);
});

test('failed directory removal retains ownership until the next transition cleans it', async () => {
  let fail = true; const removed = [];
  const { lifecycle } = fixture({ remove(session) { if (fail) { fail = false; throw new Error('MOCK directory removal failure'); } removed.push(session.dir); } });
  await assert.rejects(lifecycle.change('reset', {}), /directory removal/);
  const lease = await lifecycle.acquire(); assert.equal(lease.host.id, 'new'); lease.release();
  await lifecycle.change('capture'); assert.deepEqual(removed, ['old']);
  await lifecycle.stop(); assert.deepEqual(removed, ['old', 'new']);
});

test('a drain control entering after the last release keeps finalization waiting', async () => {
  const { lifecycle, events } = fixture(), lease = await lifecycle.acquire();
  const reset = lifecycle.change('reset', {}); await tick();
  lease.release(); const control = await lifecycle.acquire({ draining: true });
  await tick(); assert.deepEqual(events, []); assert.equal(lifecycle.state().active, 1);
  control.release(); await reset; assert.deepEqual(events, ['close-old', 'capture-old', 'remove-old']);
  await lifecycle.stop();
});
test('drain admission closes atomically before an asynchronous finalizer runs', async () => {
  let finishCapture; const capture = new Promise(resolve => { finishCapture = resolve; });
  const { lifecycle } = fixture({ async finalize(session) { assert.equal(session.active, 0); await capture; assert.equal(session.active, 0); session.closed = true; session.finalized = true; } });
  const reset = lifecycle.change('reset', {}); await tick();
  let admitted = false; const control = lifecycle.acquire({ draining: true }).then(lease => { admitted = true; return lease; });
  await tick(); assert.equal(admitted, false); finishCapture(); await reset;
  const lease = await control; assert.equal(lease.host.id, 'new'); lease.release(); await lifecycle.stop();
});

test('actual host retries each failed close component and never captures a partially closed store', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-close-store-')), evidence = mkdtempSync(join(tmpdir(), 'lifecycle-close-capture-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(evidence, { recursive: true, force: true }); });
  const host = await createIntegratedHost(dir, { enableComposition: true });
  const adapterClose = host.adapter.close.bind(host.adapter), storeClose = host.store.close.bind(host.store);
  let adapterCalls = 0, storeCalls = 0;
  host.adapter.close = () => { if (++adapterCalls === 1) throw new Error('MOCK adapter close failure'); adapterClose(); };
  host.store.close = () => { if (++storeCalls === 1) throw new Error('MOCK store close failure'); storeClose(); };
  const lifecycle = createHostLifecycle({ dir, host }, { create() {}, finalize: (session, reason) => closeAndCaptureHost(session, reason, evidence), remove: session => rmSync(session.dir, { recursive: true, force: true }) });
  await assert.rejects(lifecycle.change('capture'), error => error instanceof AggregateError && error.errors.map(value => value.message).join(',') === 'MOCK adapter close failure,MOCK store close failure');
  assert.equal(lifecycle.state().closed, false); assert.deepEqual(readdirSync(evidence), []); assert.equal(existsSync(dir), true);
  await assert.rejects(lifecycle.acquire(), /finalized/);
  await lifecycle.change('capture'); assert.equal(lifecycle.state().closed, true); assert.equal(host.store.closed, true);
  assert.equal(adapterCalls, 2); assert.equal(storeCalls, 2); assert.equal(readdirSync(evidence).length, 1);
  await lifecycle.stop(); assert.equal(existsSync(dir), false); assert.equal(adapterCalls, 2); assert.equal(storeCalls, 2);
});
test('successful close components are not retried when another component fails', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-close-retry-')), host = await createIntegratedHost(dir);
  t.after(() => { host.close(); rmSync(dir, { recursive: true, force: true }); });
  const adapterClose = host.adapter.close.bind(host.adapter), storeClose = host.store.close.bind(host.store);
  let adapterCalls = 0, storeCalls = 0;
  host.adapter.close = () => { adapterCalls++; adapterClose(); };
  host.store.close = () => { if (++storeCalls === 1) throw new Error('MOCK store close failure'); storeClose(); };
  assert.throws(() => host.close(), /MOCK store close/); assert.equal(host.store.closed, false);
  host.close(); host.close(); assert.equal(adapterCalls, 1); assert.equal(storeCalls, 2); assert.equal(host.store.closed, true);
});
test('unclosed replacement remains owned and is closed before any removal retry', async () => {
  let failCapture = true, closeCalls = 0; const events = [];
  const { lifecycle } = fixture({
    create() { return { dir: 'new', host: { close() { events.push('close-new'); if (++closeCalls === 1) throw new Error('MOCK replacement close failure'); } } }; },
    finalize(session) { if (failCapture) throw new Error('MOCK capture failure'); session.closed = true; session.finalized = true; },
    remove(session) { events.push(`remove-${session.dir}`); },
  });
  await assert.rejects(lifecycle.change('reset', {}), error => error instanceof AggregateError && error.errors.length === 2);
  assert.deepEqual(events, ['close-new']); await assert.rejects(lifecycle.acquire(), /finalized/);
  failCapture = false; await lifecycle.change('capture'); assert.deepEqual(events, ['close-new', 'close-new', 'remove-new']);
  await lifecycle.stop(); assert.deepEqual(events, ['close-new', 'close-new', 'remove-new', 'remove-old']);
});

test('failed initialization cleanup retains its actual open store directory until close succeeds', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-partial-store-'));
  const original = CreativeVersionStore.prototype.close; let closes = 0;
  CreativeVersionStore.prototype.close = function () { if (++closes === 1) throw new Error('MOCK partial store close failure'); return original.call(this); };
  t.after(() => { CreativeVersionStore.prototype.close = original; rmSync(dir, { recursive: true, force: true }); });
  const sessions = createHostSessions({ makeDirectory: () => dir });
  await assert.rejects(sessions.create({ preferences: 'invalid' }), error => error instanceof AggregateError && error.errors.length === 2 && error.errors[1].message === 'MOCK partial store close failure' && typeof error.fixtureCleanup === 'function');
  assert.equal(closes, 1); assert.equal(existsSync(dir), true);
  sessions.cleanup(); assert.equal(closes, 2); assert.equal(existsSync(dir), false);
  sessions.cleanup(); assert.equal(closes, 2);
});
