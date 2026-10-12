import test from 'node:test';
import assert from 'node:assert/strict';
import { observeConsumerDriver, ConsumerObservationError } from '../scripts/consumer-observer.mjs';
import { inspectorPeer, options, snapshot } from './consumer-observer-wire.mjs';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../tooling/runtime.mjs';

async function rejectsAndCleans(peer, code, input = options) {
  await assert.rejects(observeConsumerDriver(input, peer.runtime), error => error instanceof ConsumerObservationError && error.code === code && error.message === code);
  if (code === 'INSPECTOR_CHILD_EXIT') assert.equal(peer.child.exitCode, 7);
  else {
    assert.ok(peer.child.kills.length > 0);
    assert.equal(peer.child.signalCode, 'SIGKILL');
  }
  if (peer.socket) assert.equal(peer.socket.readyState, 3);
}

test('unexpected inspector processing error uses a fixed code', { timeout: 1000 }, async () => {
  const peer = inspectorPeer({ command(request, socket) {
    socket.reply(request);
    if (request.method === 'Runtime.runIfWaitingForDebugger') socket.message({ method: 'Debugger.paused', params: { callFrames: [null] } });
  } });
  await rejectsAndCleans(peer, 'INSPECTOR_PROCESSING_FAILED');
});

for (const phase of ['endpoint', 'connection', 'startup', 'queued command']) {
  test('observation deadline settles ' + phase + ' and cleans resources', { timeout: 1000 }, async () => {
    // Given a peer that never completes this phase.
    const peer = inspectorPeer({
      start: phase === 'endpoint' ? () => {} : undefined,
      connect: phase === 'connection' ? () => {} : undefined,
      command(request, socket) {
        if (phase === 'startup') return;
        if (request.method === 'Debugger.resume') return;
        socket.reply(request);
        if (request.method === 'Runtime.runIfWaitingForDebugger') socket.message({ method: 'Debugger.paused', params: { callFrames: [{ location: { scriptId: 'driver' } }] } });
      }
    });
    // When the existing observation deadline expires, then it rejects and cleans up.
    await rejectsAndCleans(peer, 'CONSUMER_OBSERVATION_TIMEOUT');
  });
}

for (const action of ['close', 'error', 'child exit']) {
  for (const phase of ['connection', 'startup', 'queued command', 'queued events']) {
    test(action + ' settles pending ' + phase, { timeout: 1000 }, async () => {
      // Given a lifecycle event delivered while observer work is pending.
      const end = (socket, child) => {
        if (action === 'child exit') child.finish(7);
        else socket.dispatchEvent(new Event(action));
        if (action === 'close') socket.readyState = 3;
      };
      const peer = inspectorPeer({
        connect: phase === 'connection' ? end : undefined,
        command(request, socket, child) {
          if (phase === 'startup') { end(socket, child); return; }
          if (phase === 'queued command' && request.method === 'Debugger.resume') { end(socket, child); return; }
          socket.reply(request);
          if (request.method === 'Runtime.runIfWaitingForDebugger') {
            socket.message({ method: 'Debugger.paused', params: { callFrames: [{ location: { scriptId: 'driver' } }] } });
            socket.message({ method: 'Debugger.paused', params: { callFrames: [{ location: { scriptId: 'driver' } }] } });
            if (phase === 'queued events') end(socket, child);
          }
        }
      });
      // When transport/process shutdown interrupts the observer, then it fails explicitly.
      await rejectsAndCleans(peer, action === 'child exit' ? 'INSPECTOR_CHILD_EXIT' : action === 'error' ? 'INSPECTOR_CONNECTION_FAILED' : 'INSPECTOR_CLOSED');
    });
  }
}

test('graceful disconnect retains module events delivered after the stderr notice', { timeout: 1000 }, async () => {
  // Given module source delivered behind the disconnect notice on the independent socket.
  const path = 'tooling/fixture-harness.mjs', source = await readFile(snapshot + '/' + path, 'utf8');
  const digest = hashBytes(Buffer.from(source));
  const peer = inspectorPeer({ command(request, socket, child) {
    if (request.method === 'Runtime.runIfWaitingForDebugger') {
      child.stderr.write('Waiting for the debugger to disconnect...\n');
      setImmediate(() => socket.message({ method: 'Debugger.scriptParsed', params: { scriptId: 'fixture', isModule: true, url: pathToFileURL(snapshot + '/' + path).href } }));
    }
    if (request.method === 'Runtime.getIsolateId') {
      setImmediate(() => socket.reply(request));
      return;
    }
    socket.reply(request, request.method === 'Debugger.getScriptSource' ? { scriptSource: source } : {});
  } });
  const close = peer.runtime.WebSocket.prototype.close;
  peer.runtime.WebSocket.prototype.close = function () { close.call(this); peer.child.finish(0); };
  // When the observer disconnects, then the late source still contributes verified imports.
  const result = await observeConsumerDriver({ ...options, expectedFiles: { [path]: digest } }, { ...peer.runtime, timeoutMs: 1000 });
  assert.equal(result.status, 0);
  assert.deepEqual(result.imports, [{ path, sha256: digest }]);
});

for (const failure of ['spawn throws', 'child error', 'socket constructor', 'send throws', 'command rejection', 'malformed message', 'output limit']) {
  test('startup failure cleans resources when ' + failure, { timeout: 2000 }, async () => {
    // Given a failed startup at the actual process or protocol boundary.
    const peer = inspectorPeer({
      start: failure === 'child error' ? child => { child.emit('error', new Error('ENOENT')); child.emit('close', null); } : undefined,
      command(request, socket, child) {
        if (failure === 'send throws') throw new Error('send');
        if (failure === 'command rejection') socket.message({ id: request.id, error: { code: -1 } });
        if (failure === 'malformed message') socket.dispatchEvent(new MessageEvent('message', { data: '{' }));
        if (failure === 'output limit') child.stdout.write('x'.repeat(1024 * 1024 + 1));
      }
    });
    if (failure === 'spawn throws') peer.runtime.spawn = () => { throw new Error('spawn'); };
    if (failure === 'socket constructor') peer.runtime.WebSocket = class { constructor() { throw new Error('connect'); } };
    const code = ['spawn throws', 'child error'].includes(failure) ? 'INSPECTOR_STARTUP_FAILED' : failure === 'socket constructor' ? 'INSPECTOR_CONNECTION_FAILED' : failure === 'malformed message' ? 'INVALID_INSPECTOR_MESSAGE' : failure === 'output limit' ? 'CONSUMER_OUTPUT_LIMIT' : 'INSPECTOR_COMMAND_FAILED';
    // When observation starts, then a typed failure is returned, never execution success.
    if (failure === 'spawn throws') await assert.rejects(observeConsumerDriver(options, peer.runtime), { code });
    else await rejectsAndCleans(peer, code);
  });
}

test('deadline reaps an actual spawned driver that ignores SIGTERM', { timeout: 5000 }, async () => {
  // Given a real spawned driver that keeps running and ignores graceful termination.
  const directory = await mkdtemp(join(tmpdir(), 'shared-contracts-observer-shutdown-'));
  let child, output = '';
  try {
    const script = join(directory, 'driver.mjs');
    await writeFile(script, "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);\n");
    // When its observation deadline expires, then it fails and its process is already reaped.
    await assert.rejects(observeConsumerDriver({ ...options, script, hook: 'data:text/javascript,' }, {
      timeoutMs: 2000,
      spawn(...args) { child = spawn(...args); child.stdout.on('data', chunk => { output += chunk; }); return child; }
    }), { code: 'CONSUMER_OBSERVATION_TIMEOUT' });
    assert.equal(output.trim(), 'ready');
    assert.equal(child.signalCode, 'SIGKILL');
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
});
