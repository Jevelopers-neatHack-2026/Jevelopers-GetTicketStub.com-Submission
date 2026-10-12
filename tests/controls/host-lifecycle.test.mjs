import test from 'node:test';
import assert from 'node:assert/strict';
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
