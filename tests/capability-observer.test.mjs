import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { hashBytes } from '../tooling/runtime.mjs';
import { runCanonicalFixtures } from '../tooling/fixture-harness.mjs';
import { observeConsumerDriver } from '../scripts/consumer-observer.mjs';
import { inspectorPeer, options, snapshot } from './consumer-observer-wire.mjs';

test('wire observation recognizes capability consistency cases without granting real transport credit', { timeout: 2000 }, async () => {
  const path = 'tooling/fixture-harness.mjs';
  const source = await readFile(snapshot + '/' + path, 'utf8');
  const manifest = JSON.parse(await readFile(snapshot + '/fixtures/PrintSpec.json', 'utf8'));
  const checked = runCanonicalFixtures('PrintSpec', manifest);
  assert.deepEqual(checked.failures, []);
  const peer = inspectorPeer({ command(request, socket, child) {
    if (request.method === 'Debugger.evaluateOnCallFrame') {
      socket.reply(request, { result: { value: { contract: 'PrintSpec', manifest, ...checked } } });
      return;
    }
    socket.reply(request, request.method === 'Debugger.getScriptSource' ? { scriptSource: source } : {});
    if (request.method === 'Runtime.runIfWaitingForDebugger') {
      socket.message({ method: 'Debugger.scriptParsed', params: { scriptId: 'fixture', isModule: true, url: pathToFileURL(snapshot + '/' + path).href } });
      socket.message({ method: 'Debugger.paused', params: { callFrames: [{ functionName: 'runCanonicalFixtures', callFrameId: 'fixture-frame', location: { scriptId: 'fixture' } }] } });
    }
    if (request.method === 'Debugger.resume') child.stderr.write('Waiting for the debugger to disconnect...\n');
  } });
  const close = peer.runtime.WebSocket.prototype.close;
  peer.runtime.WebSocket.prototype.close = function () { close.call(this); peer.child.finish(0); };
  const result = await observeConsumerDriver({ ...options, expectedFiles: { [path]: hashBytes(Buffer.from(source)) }, requiredFixtures: [{ contract: 'PrintSpec', version: '1.0.0', path: 'fixtures/PrintSpec.json' }] }, { ...peer.runtime, timeoutMs: 1000 });
  assert.equal(result.coverage.length, 1);
  assert.equal(result.coverage[0].bound, true);
  assert.equal(result.coverage[0].semantic, 1);
  assert.equal(result.coverage[0].failures, 0);
});
