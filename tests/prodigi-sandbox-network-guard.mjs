// Preloaded with `node --import` before any `dist/` module is evaluated, so the
// guard is in place before the adapter or its dependencies load. Every outbound
// path Node offers (global fetch, http/https request/get, net/tls connect, and
// the Socket.prototype.connect they all reach) throws and is counted.
import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");

const KEY = Symbol.for("fulfillment-connectors.prodigi-sandbox.network-guard");
const state = { installed: true, attempts: 0, probeAttempts: 0, probing: false };

function refuse(channel) {
  return function guarded() {
    if (state.probing) state.probeAttempts += 1;
    else state.attempts += 1;
    const error = new Error(`network is forbidden in the Prodigi sandbox suite (${channel})`);
    error.code = "ERR_NETWORK_FORBIDDEN_BY_SUITE";
    throw error;
  };
}

const fetchGuard = refuse("fetch");
globalThis.fetch = async (...args) => fetchGuard(...args);
http.request = refuse("http.request");
http.get = refuse("http.get");
https.request = refuse("https.request");
https.get = refuse("https.get");
net.connect = refuse("net.connect");
net.createConnection = refuse("net.createConnection");
net.Socket.prototype.connect = refuse("net.Socket.connect");
tls.connect = refuse("tls.connect");
syncBuiltinESMExports();

Object.defineProperty(globalThis, KEY, { value: state, enumerable: false, configurable: false, writable: false });
