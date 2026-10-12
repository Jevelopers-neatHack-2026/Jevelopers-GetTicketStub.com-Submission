import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const snapshot = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
export const options = { script: 'driver.mjs', checkout: snapshot, snapshot, env: {}, hook: 'hook.mjs', requiredFixtures: [], expectedFiles: {} };

/** Wire-level inspector peer: it can withhold replies and deliver lifecycle events in exact order. */
export function inspectorPeer({ start, connect, command }) {
  const child = new EventEmitter();
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, kills: [] });
  child.finish = (status = 0, signal = null) => {
    child.exitCode = status; child.signalCode = signal;
    child.emit('exit', status, signal);
    child.stdout.end(); child.stderr.end(); child.emit('close', status, signal);
  };
  child.kill = signal => {
    child.kills.push(signal ?? 'SIGTERM');
    queueMicrotask(() => child.finish(null, signal ?? 'SIGTERM'));
    return true;
  };
  let socket;
  class Socket extends EventTarget {
    readyState = 0;
    sent = [];
    constructor() {
      super(); socket = this;
      queueMicrotask(() => connect ? connect(this, child) : this.open());
    }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
    reply(request, result = {}) { this.message({ id: request.id, result }); }
    send(bytes) {
      // A closed peer cannot deliver a response to a subsequently queued command.
      if (this.readyState !== 1) return;
      const request = JSON.parse(bytes); this.sent.push(request);
      command(request, this, child);
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  return {
    child,
    get socket() { return socket; },
    runtime: { WebSocket: Socket, timeoutMs: 20, spawn() {
      queueMicrotask(() => start ? start(child) : child.stderr.write('Debugger listening on ws://127.0.0.1:1234/abcd\n'));
      return child;
    } }
  };
}
