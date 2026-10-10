import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { SafeFetcher } from "../../src/security/controlled-fetch.mjs";
import { RetrievalError } from "../../src/security/errors.mjs";
import {
  createCertificate,
  fixtureUrl,
  localTestSeam,
  png,
  respond,
  startFixture,
} from "./support.mjs";

async function fixtureFetcher(t, handler, options = {}) {
  const server = await startFixture(handler, { certificate: options.certificate });
  t.after(() => server.close());
  if (options.certificate) t.after(() => options.certificate.close());
  const dials = [];
  const seam = localTestSeam({
    port: server.port,
    certificate: options.certificate,
    hostnames: options.hostnames,
    addresses: options.addresses,
    aliases: options.aliases,
    onDial: (record) => dials.push(record),
  });
  return { server, dials, fetcher: new SafeFetcher(seam), url: (path, host) => fixtureUrl(server.port, path, host, options.certificate ? "https:" : "http:") };
}

async function waitFor(predicate, milliseconds = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > milliseconds) throw new Error("timed out waiting for fixture event");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("fetches over a direct pinned socket and sends no ambient credentials or proxy headers", async (t) => {
  const before = { HTTP_PROXY: process.env.HTTP_PROXY, http_proxy: process.env.http_proxy };
  process.env.HTTP_PROXY = "http://127.0.0.1:1";
  process.env.http_proxy = "http://127.0.0.1:1";
  t.after(() => {
    if (before.HTTP_PROXY === undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = before.HTTP_PROXY;
    if (before.http_proxy === undefined) delete process.env.http_proxy; else process.env.http_proxy = before.http_proxy;
  });
  let captured;
  const fixture = await fixtureFetcher(t, (request, response) => {
    captured = request.headers;
    respond(response, 200, { "content-type": "text/html; charset=utf-8" }, "<!doctype html><html><body>event</body></html>");
  }, { addresses: ["127.0.0.1", "8.8.8.8"] });
  const result = await fixture.fetcher.fetch(fixture.url("/event"));
  assert.equal(result.contentType, "text/html");
  assert.equal(Buffer.from(result.bytes).toString("utf8"), "<!doctype html><html><body>event</body></html>");
  assert.equal(captured.authorization, undefined);
  assert.equal(captured.cookie, undefined);
  assert.equal(captured["proxy-authorization"], undefined);
  assert.equal(captured.host, `fixture.example.test:${fixture.server.port}`);
  assert.equal(fixture.dials.length, 1);
  assert.deepEqual(fixture.dials[0], { peer: "127.0.0.1", address: "127.0.0.1", port: fixture.server.port });
});

test("rejects caller header injection without opening a socket", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, { "content-type": "text/plain" }, "hello"));
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/"), { headers: { cookie: "session=secret" } }), { code: "POLICY_DENIED" });
  assert.equal(fixture.dials.length, 0);
});

test("rejects private DNS answers before a transport dial", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, { "content-type": "text/plain" }, "blocked"), {
    addresses: ["8.8.8.8", "10.0.0.7"],
  });
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/private-answer")), { code: "POLICY_DENIED" });
  assert.equal(fixture.dials.length, 0);
});

test("rejects partial-content responses instead of returning them as complete evidence", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 206, {
    "content-type": "text/plain", "content-range": "bytes 0-1/4",
  }, "ab"));
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/partial")), { code: "TRANSPORT_FAILURE" });
});

test("redirect destinations pass through URL policy before another dial", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 302, { location: "http://127.0.0.1/private" }));
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/start")), { code: "POLICY_DENIED" });
  assert.equal(fixture.dials.length, 1);
});

test("redirected image assets use the same pinned transport and resource policy", async (t) => {
  const fixture = await fixtureFetcher(t, (request, response) => {
    if (request.url === "/") respond(response, 302, { location: "/brand.png" });
    else respond(response, 200, { "content-type": "image/png" }, png(8, 6));
  });
  const result = await fixture.fetcher.fetch(fixture.url("/"));
  assert.equal(result.redirects, 1);
  assert.equal(result.image.width, 8);
  assert.equal(result.image.height, 6);
  assert.equal(fixture.dials.length, 2);
});

test("stops a redirect loop at the immutable per-fetch limit", async (t) => {
  let requests = 0;
  const fixture = await fixtureFetcher(t, (_request, response) => {
    requests += 1;
    respond(response, 302, { location: "/loop" });
  });
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/")), { code: "REDIRECT_LIMIT" });
  assert.equal(requests, 6);
  assert.equal(fixture.dials.length, 6);
});

test("enforces the immutable request budget across one fetcher run", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, { "content-type": "text/plain" }, "ok"));
  for (let index = 0; index < 30; index += 1) await fixture.fetcher.fetch(fixture.url(`/item-${index}`));
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/over-budget")), { code: "REQUEST_LIMIT" });
  assert.equal(fixture.dials.length, 30);
});

test("rejects a gzip expansion over the decoded text cap", async (t) => {
  const expanded = Buffer.alloc(20 * 1024 * 1024 + 1, 0x61);
  const compressed = gzipSync(expanded);
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, {
    "content-type": "text/plain", "content-encoding": "gzip", "content-length": String(compressed.length),
  }, compressed));
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/bomb")), { code: "RESOURCE_LIMIT" });
});

test("rejects an oversized chunked text response while consuming it", async (t) => {
  const expanded = Buffer.alloc(20 * 1024 * 1024 + 1, 0x62);
  const fixture = await fixtureFetcher(t, (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain", "transfer-encoding": "chunked" });
    response.end(expanded);
  });
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/large")), { code: "RESOURCE_LIMIT" });
});

test("rejects an oversized declared body before consuming it", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain", "content-length": String(20 * 1024 * 1024 + 1) });
    response.flushHeaders();
  });
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/large")), { code: "RESOURCE_LIMIT" });
});

test("rejects misleading MIME and content signatures", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, { "content-type": "text/html" }, "plain text only"));
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/mislabelled")), { code: "UNSUPPORTED_MEDIA" });
});

test("rejects an image whose declared dimensions exceed the intake bound", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, { "content-type": "image/png" }, png(10_001, 1)));
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/huge.png")), { code: "RESOURCE_LIMIT" });
});

test("cancellation interrupts an active response socket", async (t) => {
  let closed = false;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const fixture = await fixtureFetcher(t, (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain", "transfer-encoding": "chunked" });
    response.write("partial");
    response.on("close", () => { closed = true; });
    started();
  });
  const controller = new AbortController();
  const pending = fixture.fetcher.fetch(fixture.url("/slow"), { signal: controller.signal });
  await startedPromise;
  controller.abort();
  await assert.rejects(pending, { code: "CANCELED" });
  await waitFor(() => closed);
});

test("cancellation prevents queued work from opening a socket", async (t) => {
  const activeResponses = [];
  const fixture = await fixtureFetcher(t, (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain", "transfer-encoding": "chunked" });
    response.write("pending");
    activeResponses.push(response);
  });
  const active = Array.from({ length: 4 }, (_, index) => fixture.fetcher.fetch(fixture.url(`/hold-${index}`)));
  await waitFor(() => activeResponses.length === 4);
  const controller = new AbortController();
  const queued = fixture.fetcher.fetch(fixture.url("/queued"), { signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, { code: "CANCELED" });
  assert.equal(fixture.dials.length, 4);
  for (const response of activeResponses) response.end("done");
  const results = await Promise.all(active);
  assert.equal(results.length, 4);
});

test("keeps concurrent local requests within the run limit", async (t) => {
  let active = 0;
  let maximum = 0;
  const fixture = await fixtureFetcher(t, (_request, response) => {
    active += 1;
    maximum = Math.max(maximum, active);
    setTimeout(() => {
      active -= 1;
      respond(response, 200, { "content-type": "text/plain" }, "ok");
    }, 20);
  });
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => fixture.fetcher.fetch(fixture.url(`/parallel-${index}`))));
  assert.equal(results.length, 8);
  assert.equal(maximum, 4);
});

test("verifies the original hostname and trusted certificate over the pinned TLS socket", async (t) => {
  const certificate = await createCertificate();
  let hostHeader;
  const fixture = await fixtureFetcher(t, (request, response) => {
    hostHeader = request.headers.host;
    respond(response, 200, { "content-type": "text/plain" }, "tls ok");
  }, { certificate });
  const result = await fixture.fetcher.fetch(fixture.url("/tls"));
  assert.equal(Buffer.from(result.bytes).toString(), "tls ok");
  assert.equal(hostHeader, `fixture.example.test:${fixture.server.port}`);
  assert.equal(fixture.dials.length, 1);
  assert.equal(fixture.dials[0].address, "127.0.0.1");
});

test("rejects a TLS hostname mismatch before sending the HTTP request", async (t) => {
  const certificate = await createCertificate();
  let requests = 0;
  const fixture = await fixtureFetcher(t, (_request, response) => {
    requests += 1;
    respond(response, 200, { "content-type": "text/plain" }, "unexpected");
  }, { certificate, hostnames: ["mismatch.fixture.example.test"] });
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/mismatch", "mismatch.fixture.example.test")), RetrievalError);
  assert.equal(requests, 0);
});
