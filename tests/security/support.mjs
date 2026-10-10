import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { createTestSeam } from "../../src/security/internal/test-seams.mjs";
import { RetrievalError } from "../../src/security/errors.mjs";
import { parseAndValidateUrl, validateHostname } from "../../src/security/url-policy.mjs";

export async function createCertificate() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ei-safe-retrieval-cert-"));
  const keyPath = path.join(directory, "fixture-key.pem");
  const certPath = path.join(directory, "fixture-cert.pem");
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath,
      "-days", "1", "-subj", "/CN=fixture.example.test",
      "-addext", "subjectAltName=DNS:fixture.example.test,DNS:other.fixture.example.test",
    ], { stdio: "ignore" });
    return Object.freeze({ key: await readFile(keyPath), cert: await readFile(certPath), close: () => rm(directory, { recursive: true, force: true }) });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function startFixture(handler, { certificate } = {}) {
  const server = certificate
    ? https.createServer({ key: certificate.key, cert: certificate.cert, minVersion: "TLSv1.2" }, handler)
    : http.createServer(handler);
  server.maxHeadersCount = 50;
  server.headersTimeout = 5_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return Object.freeze({
    server,
    port: address.port,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  });
}

export function fixtureUrl(port, pathname = "/", hostname = "fixture.example.test", protocol = "http:") {
  return `${protocol}//${hostname}:${port}${pathname}`;
}

export function localTestSeam({ port, certificate, onDial, hostnames = ["fixture.example.test"], addresses = ["127.0.0.1"], aliases = [] }) {
  const allowedHosts = new Set(hostnames);
  return createTestSeam({
    validateHostname(hostname) {
      if (allowedHosts.has(hostname)) return hostname;
      return validateHostname(hostname);
    },
    validateUrl(input) {
      let url;
      try { url = new URL(input); }
      catch (cause) { throw new RetrievalError("POLICY_DENIED", { cause }); }
      if (allowedHosts.has(url.hostname) && url.protocol === (certificate ? "https:" : "http:")
        && url.port === String(port) && !url.username && !url.password && !url.hash) {
        return Object.freeze({ url, hostname: url.hostname, port });
      }
      return parseAndValidateUrl(input);
    },
    resolve(hostname) {
      if (!allowedHosts.has(hostname)) throw new RetrievalError("DNS_FAILURE");
      return Object.freeze({ addresses: Object.freeze([...addresses]), aliases: Object.freeze([...aliases]) });
    },
    isFixtureAddress(address) { return address === "127.0.0.1"; },
    onDial,
    testTlsCa: certificate?.cert,
  });
}

export function png(width, height) {
  const body = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(body, 0);
  body.write("IHDR", 12, "ascii");
  body.writeUInt32BE(width, 16);
  body.writeUInt32BE(height, 20);
  return body;
}

export function respond(response, status, headers = {}, body = "") {
  response.writeHead(status, headers);
  response.end(body);
}
