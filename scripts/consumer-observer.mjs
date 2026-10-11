import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { hashBytes, hashManifest } from '../tooling/runtime.mjs';

/** Native debugger observations are collected in the parent, never in a driver-writable audit file. */
export async function observeConsumerDriver({ script, checkout, snapshot, env, hook, requiredFixtures, expectedFiles }) {
  snapshot = await realpath(snapshot);
  const source = await readFile(join(snapshot, 'tooling/fixture-harness.mjs'), 'utf8');
  const target = pathToFileURL(join(snapshot, 'tooling/fixture-harness.mjs')).href;
  const lineNumber = source.split('\n').findLastIndex(line => line.trim() === 'return { failures, records };');
  if (lineNumber < 0) throw new Error('INVALID_FIXTURE_PROBE');
  const fixtures = new Map();
  for (const item of requiredFixtures) fixtures.set(item.contract + '@' + item.version, JSON.parse(await readFile(join(snapshot, item.path), 'utf8')));
  const child = spawn(process.execPath, ['--inspect-brk=127.0.0.1:0', '--import', hook, script], { cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', socket, nextId = 0, queue = Promise.resolve(), failure, waiting = false;
  const pending = new Map(), scripts = new Map(), verified = new Set(), coverage = [], imports = [];
  let endpointResolve, endpointReject;
  const endpoint = new Promise((resolve, reject) => { endpointResolve = resolve; endpointReject = reject; });
  let finishResolve;
  const completed = new Promise(resolve => { finishResolve = resolve; });
  const timer = setTimeout(() => { failure = new Error('CONSUMER_OBSERVATION_TIMEOUT'); child.kill(); socket?.close(); }, 60000);
  function post(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function inspectEvent(event) {
    if (event.method === 'Debugger.scriptParsed') {
      const record = event.params;
      scripts.set(record.scriptId, record.url);
      if (!record.isModule) return;
      if (!record.url.startsWith(pathToFileURL(snapshot + '/').href)) return;
      const path = fileURLToPath(record.url).slice(snapshot.length + 1);
      if (!expectedFiles[path]) throw new Error('UNEXPECTED_PACKAGE_SCRIPT');
      const code = await post('Debugger.getScriptSource', { scriptId: record.scriptId });
      if (hashBytes(new TextEncoder().encode(code.scriptSource)) !== expectedFiles[path]) throw new Error('IMPORTED_SOURCE_MISMATCH');
      verified.add(record.scriptId); imports.push({ path, sha256: expectedFiles[path] });
    }
    if (event.method === 'Debugger.paused') {
      const frame = event.params.callFrames[0];
      if (verified.has(frame.location.scriptId) && scripts.get(frame.location.scriptId) === target && frame.functionName === 'runCanonicalFixtures') {
        const observed = await post('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: '({ contract, manifest, failures, records })', returnByValue: true, silent: true });
        if (observed.exceptionDetails || !observed.result?.value) throw new Error('INVALID_EXECUTION_OBSERVATION');
        const value = observed.result.value;
        const expected = fixtures.get(value.contract + '@' + value.manifest?.schema_version);
        const bound = expected !== undefined && hashManifest(value.manifest) === hashManifest(expected);
        const records = Array.isArray(value.records) ? value.records : [];
        coverage.push({ contract: value.contract, version: value.manifest?.schema_version, bound, failures: Array.isArray(value.failures) ? value.failures.length : -1, positive: records.filter(row => row.expected?.ok).length, negative: records.filter(row => row.expected?.ok === false).length, semantic: records.some(row => ['semantic', 'research_creative', 'commerce_evidence'].includes(row.mode)) ? 1 : 0 });
      }
      await post('Debugger.resume');
    }
  }
  child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 1024 * 1024) { failure = new Error('CONSUMER_OUTPUT_LIMIT'); child.kill(); } });
  child.stderr.on('data', chunk => {
    stderr += chunk;
    if (stderr.length > 1024 * 1024) { failure = new Error('CONSUMER_OUTPUT_LIMIT'); child.kill(); }
    const found = stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+)/);
    if (found) endpointResolve(found[1]);
    if (stderr.includes('Waiting for the debugger to disconnect') && !waiting) {
      waiting = true;
      queue.then(() => socket?.close()).catch(() => socket?.close());
    }
  });
  child.on('error', error => { failure = error; endpointReject(error); finishResolve({ status: null }); });
  child.on('exit', status => { endpointReject(new Error('INSPECTOR_UNAVAILABLE')); finishResolve({ status }); });
  try {
    socket = new WebSocket(await endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', message => {
      const event = JSON.parse(message.data);
      if (event.id) {
        const item = pending.get(event.id); if (!item) return;
        pending.delete(event.id);
        if (event.error) item.reject(new Error('INSPECTOR_COMMAND_FAILED')); else item.resolve(event.result);
      } else {
        queue = queue.then(() => inspectEvent(event)).catch(error => { failure = error; child.kill(); socket.close(); });
      }
    });
    socket.addEventListener('close', () => {
      for (const item of pending.values()) item.reject(new Error('INSPECTOR_CLOSED'));
      pending.clear();
    });
    await post('Debugger.enable');
    await post('Debugger.setBreakpointByUrl', { url: target, lineNumber, columnNumber: 0 });
    await post('Runtime.runIfWaitingForDebugger');
    const result = await completed;
    await queue;
    if (failure) throw failure;
    return { status: result.status, stdout, coverage, imports };
  } finally {
    clearTimeout(timer); socket?.close(); if (child.exitCode === null) child.kill();
    for (const item of pending.values()) item.reject(new Error('INSPECTOR_CLOSED'));
  }
}
