import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function installPdfNetworkGuard() {
  let attempts = 0;
  const deny = (kind) => (..._args) => {
    attempts += 1;
    const error = new Error(`PDF external resource API disabled: ${kind}`);
    error.code = "PDF_EXTERNAL_RESOURCE_DENIED";
    throw error;
  };

  for (const [moduleName, methods, kind] of [
    ["node:http", ["request", "get"], "http"],
    ["node:https", ["request", "get"], "https"],
    ["node:net", ["connect", "createConnection"], "socket"],
    ["node:tls", ["connect"], "tls"],
    ["node:dgram", ["createSocket"], "datagram"],
    ["node:dns", ["lookup", "resolve", "resolve4", "resolve6"], "dns"],
    ["node:dns/promises", ["lookup", "resolve", "resolve4", "resolve6"], "dns-promises"],
  ]) {
    const target = require(moduleName);
    for (const method of methods) {
      if (typeof target[method] === "function") target[method] = deny(kind);
    }
  }
  globalThis.fetch = deny("fetch");
  if (typeof globalThis.WebSocket === "function") {
    globalThis.WebSocket = class DeniedWebSocket {
      constructor(..._args) {
        attempts += 1;
        const error = new Error("PDF external resource API disabled: websocket");
        error.code = "PDF_EXTERNAL_RESOURCE_DENIED";
        throw error;
      }
    };
  }

  return Object.freeze({
    get attemptCount() {
      return attempts;
    },
  });
}
