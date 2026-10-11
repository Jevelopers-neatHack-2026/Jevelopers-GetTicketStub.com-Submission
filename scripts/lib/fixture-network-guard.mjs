// Preloaded with `node --import` in fixture mode: only loopback may be reached. Any other host is refused
// at fetch, http(s) and socket level, and every refusal is appended to $VERIFY_NET_LOG so the runner fails
// the run even if the code under test swallowed the error.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { appendFileSync } from "node:fs";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "::", ""]);
const log = process.env.VERIFY_NET_LOG;

function allowed(host) {
  const h = String(host ?? "").toLowerCase();
  return LOOPBACK.has(h) || h.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(h);
}

function refuse(kind, host) {
  const line = `${kind} ${host}`;
  if (log) {
    try {
      appendFileSync(log, `${line}\n`);
    } catch {
      /* the thrown error below still fails the call */
    }
  }
  const err = new Error(`fixture mode blocks outbound network: ${line}`);
  err.code = "ETICKETSTUB_FIXTURE_NETWORK";
  return err;
}

function hostOf(args) {
  const [a, b] = args;
  if (typeof a === "string" || a instanceof URL) {
    try {
      return new URL(a).hostname;
    } catch {
      return String(a);
    }
  }
  const o = a ?? b ?? {};
  return o.hostname ?? o.host ?? (o.href ? new URL(o.href).hostname : "localhost");
}

const realFetch = globalThis.fetch;
globalThis.fetch = function guardedFetch(input, init) {
  const url = typeof input === "string" || input instanceof URL ? input : input?.url;
  let host = "";
  try {
    host = new URL(url, "http://localhost").hostname;
  } catch {
    /* a relative URL has no host to refuse */
  }
  if (!allowed(host)) return Promise.reject(refuse("fetch", host));
  return realFetch.call(this, input, init);
};

for (const [name, mod] of [["http", http], ["https", https]]) {
  for (const fn of ["request", "get"]) {
    const real = mod[fn];
    mod[fn] = function guarded(...args) {
      const host = hostOf(args);
      if (!allowed(host)) throw refuse(`${name}.${fn}`, host);
      return real.apply(this, args);
    };
  }
}

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  // unix sockets and pipes have no network host
  if (first && typeof first === "object" && first.path) return realConnect.apply(this, args);
  const host = first && typeof first === "object" ? (first.host ?? "localhost") : typeof args[1] === "string" ? args[1] : "localhost";
  if (!allowed(host)) {
    const err = refuse("net.connect", host);
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return realConnect.apply(this, args);
};
