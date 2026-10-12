import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { hashBytes, hashManifest } from '../tooling/runtime.mjs';

export class ConsumerObservationError extends Error {
  constructor(code, cause) { super(code, { cause }); this.name = 'ConsumerObservationError'; this.code = code; }
}

/** Native debugger observations are collected in the parent, never in a driver-writable audit file. */
export async function observeConsumerDriver({ script, checkout, snapshot, env, hook, requiredFixtures, expectedFiles }, { spawn: spawnDriver = spawn, WebSocket: Socket = WebSocket, timeoutMs = 60000 } = {}) {
  snapshot = await realpath(snapshot);
  const source = await readFile(join(snapshot, 'tooling/fixture-harness.mjs'), 'utf8');
  const target = pathToFileURL(join(snapshot, 'tooling/fixture-harness.mjs')).href;
  const lineNumber = source.split('\n').findLastIndex(line => line.trim() === 'return { failures, records };');
  if (lineNumber < 0) throw new ConsumerObservationError('INVALID_FIXTURE_PROBE');
  const fixtures = new Map();
  for (const item of requiredFixtures) fixtures.set(item.contract + '@' + item.version, JSON.parse(await readFile(join(snapshot, item.path), 'utf8')));
  let child;
  try { child = spawnDriver(process.execPath, ['--inspect-brk=127.0.0.1:0', '--import', hook, script], { cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { throw new ConsumerObservationError('INSPECTOR_STARTUP_FAILED', error); }
  let stdout = '', stderr = '', socket, nextId = 0, queue = Promise.resolve(), failure, waiting = false, started = false, disconnecting = false, draining = false, closed = false, terminating = false;
  const pending = new Map(), scripts = new Map(), verified = new Set(), coverage = [], imports = [];
  let endpointResolve, endpointReject;
  const endpoint = new Promise((resolve, reject) => { endpointResolve = resolve; endpointReject = reject; });
  let finishResolve, abortResolve, readyReject;
  const completed = new Promise(resolve => { finishResolve = resolve; });
  const aborted = new Promise(resolve => { abortResolve = resolve; });
  const wait = promise => Promise.race([promise, aborted.then(error => { throw error; })]);
  function stopChild() {
    if (!closed && !terminating && child.exitCode === null && child.signalCode === null) { terminating = true; child.kill('SIGKILL'); }
  }
  function fail(error) {
    if (failure) return;
    failure = error instanceof ConsumerObservationError ? error : new ConsumerObservationError('INSPECTOR_PROCESSING_FAILED', error);
    endpointReject(failure);
    readyReject?.(failure);
    for (const item of pending.values()) item.reject(failure);
    pending.clear();
    abortResolve(failure);
    socket?.close();
    stopChild();
  }
  const timer = setTimeout(() => fail(new ConsumerObservationError('CONSUMER_OBSERVATION_TIMEOUT')), timeoutMs);
  function post(method, params = {}) {
    if (failure) return Promise.reject(failure);
    if (socket?.readyState !== 1) return Promise.reject(new ConsumerObservationError('INSPECTOR_CLOSED'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { fail(new ConsumerObservationError('INSPECTOR_COMMAND_FAILED', error)); }
    });
  }
  async function disconnect() {
    if (!waiting || !started || draining || failure) return;
    draining = true;
    try {
      while (!failure) {
        const observed = queue;
        await wait(observed);
        // A protocol round trip fences events arriving behind the independent stderr notice.
        await wait(post('Runtime.getIsolateId'));
        if (queue !== observed) continue;
        disconnecting = true;
        socket.close();
        return;
      }
    } catch (error) { fail(error); }
  }
  async function inspectEvent(event) {
    if (event.method === 'Debugger.scriptParsed') {
      const record = event.params;
      scripts.set(record.scriptId, record.url);
      if (!record.isModule) return;
      if (!record.url.startsWith(pathToFileURL(snapshot + '/').href)) return;
      const path = fileURLToPath(record.url).slice(snapshot.length + 1);
      if (!expectedFiles[path]) throw new ConsumerObservationError('UNEXPECTED_PACKAGE_SCRIPT');
      const code = await post('Debugger.getScriptSource', { scriptId: record.scriptId });
      if (hashBytes(new TextEncoder().encode(code.scriptSource)) !== expectedFiles[path]) throw new ConsumerObservationError('IMPORTED_SOURCE_MISMATCH');
      verified.add(record.scriptId); imports.push({ path, sha256: expectedFiles[path] });
    }
    if (event.method === 'Debugger.paused') {
      const frame = event.params.callFrames[0];
      if (verified.has(frame.location.scriptId) && scripts.get(frame.location.scriptId) === target && frame.functionName === 'runCanonicalFixtures') {
        const observed = await post('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: '({ contract, manifest, failures, records })', returnByValue: true, silent: true });
        if (observed.exceptionDetails || !observed.result?.value) throw new ConsumerObservationError('INVALID_EXECUTION_OBSERVATION');
        const value = observed.result.value;
        const expected = fixtures.get(value.contract + '@' + value.manifest?.schema_version);
        const bound = expected !== undefined && hashManifest(value.manifest) === hashManifest(expected);
        const records = Array.isArray(value.records) ? value.records : [];
        coverage.push({ contract: value.contract, version: value.manifest?.schema_version, bound, failures: Array.isArray(value.failures) ? value.failures.length : -1, positive: records.filter(row => row.expected?.ok).length, negative: records.filter(row => row.expected?.ok === false).length, semantic: records.some(row => ['semantic', 'research_creative', 'commerce_evidence', 'capability', 'production'].includes(row.mode)) ? 1 : 0 });
      }
      await post('Debugger.resume');
    }
  }
  child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 1024 * 1024) fail(new ConsumerObservationError('CONSUMER_OUTPUT_LIMIT')); });
  child.stderr.on('data', chunk => {
    stderr += chunk;
    if (stderr.length > 1024 * 1024) fail(new ConsumerObservationError('CONSUMER_OUTPUT_LIMIT'));
    const found = stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+)/);
    if (found) endpointResolve(found[1]);
    if (stderr.includes('Waiting for the debugger to disconnect') && !waiting) {
      waiting = true;
      void disconnect();
    }
  });
  child.on('error', error => fail(new ConsumerObservationError('INSPECTOR_STARTUP_FAILED', error)));
  child.on('exit', () => { if (!disconnecting) fail(new ConsumerObservationError('INSPECTOR_CHILD_EXIT')); });
  child.on('close', status => { closed = true; finishResolve({ status }); });
  try {
    try { socket = new Socket(await wait(endpoint)); }
    catch (error) { fail(failure ?? new ConsumerObservationError('INSPECTOR_CONNECTION_FAILED', error)); throw failure; }
    const ready = new Promise((resolve, reject) => { readyReject = reject; socket.addEventListener('open', resolve, { once: true }); });
    socket.addEventListener('error', error => fail(new ConsumerObservationError('INSPECTOR_CONNECTION_FAILED', error)));
    socket.addEventListener('close', () => {
      if (!disconnecting || pending.size) fail(new ConsumerObservationError('INSPECTOR_CLOSED'));
    });
    socket.addEventListener('message', message => {
      if (failure || disconnecting) return;
      let event;
      try { event = JSON.parse(message.data); }
      catch (error) { fail(new ConsumerObservationError('INVALID_INSPECTOR_MESSAGE', error)); return; }
      if (!event || typeof event !== 'object') { fail(new ConsumerObservationError('INVALID_INSPECTOR_MESSAGE')); return; }
      if (event.id) {
        const item = pending.get(event.id); if (!item) return;
        pending.delete(event.id);
        if (event.error) item.reject(new ConsumerObservationError('INSPECTOR_COMMAND_FAILED')); else item.resolve(event.result);
      } else {
        queue = queue.then(() => { if (failure) throw failure; return inspectEvent(event); }).catch(fail);
      }
    });
    await wait(ready);
    await wait(post('Debugger.enable'));
    await wait(post('Debugger.setBreakpointByUrl', { url: target, lineNumber, columnNumber: 0 }));
    await wait(post('Runtime.runIfWaitingForDebugger'));
    started = true;
    void disconnect();
    const result = await wait(completed);
    await wait(queue);
    if (failure) throw failure;
    return { status: result.status, stdout, coverage, imports };
  } finally {
    clearTimeout(timer); socket?.close();
    stopChild();
    for (const item of pending.values()) item.reject(failure ?? new ConsumerObservationError('INSPECTOR_CLOSED'));
    pending.clear();
    let cleanupTimer;
    try {
      await Promise.race([completed, new Promise((_, reject) => {
        cleanupTimer = setTimeout(() => reject(failure ?? new ConsumerObservationError('CONSUMER_CLEANUP_TIMEOUT')), 1000);
      })]);
    } finally { clearTimeout(cleanupTimer); }
  }
}
