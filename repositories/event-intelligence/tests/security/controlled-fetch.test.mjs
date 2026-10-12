import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createSocket } from "node:dgram";
import net from "node:net";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { SafeFetcher } from "../../src/security/controlled-fetch.mjs";
import { RetrievalError } from "../../src/security/errors.mjs";
import { inspectSafeAssetBytes } from "../../src/security/assets/inspect.mjs";
import { DnsWireResolver } from "../../src/security/internal/dns-wire.mjs";
import { runWithSafeFetchLifecycle } from "../../src/security/internal/fetch-lifecycle.mjs";
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
    resolveOverride: options.resolveOverride,
    onDial: (record) => dials.push(record),
  });
  return { server, dials, seam, fetcher: new SafeFetcher(seam), url: (path, host) => fixtureUrl(server.port, path, host, options.certificate ? "https:" : "http:") };
}

async function waitFor(predicate, milliseconds = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > milliseconds) throw new Error("timed out waiting for fixture event");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function stalledDnsFixture(t) {
  const udp = createSocket("udp4");
  await new Promise((resolve, reject) => {
    udp.once("error", reject);
    udp.bind(0, "127.0.0.1", resolve);
  });
  const { port } = udp.address();
  let activeTcp = 0;
  let maximumTcp = 0;
  let totalTcp = 0;
  const tcpSockets = new Set();
  const tcp = net.createServer((socket) => {
    activeTcp += 1;
    totalTcp += 1;
    maximumTcp = Math.max(maximumTcp, activeTcp);
    tcpSockets.add(socket);
    socket.on("data", () => {});
    socket.once("close", () => {
      activeTcp -= 1;
      tcpSockets.delete(socket);
    });
  });
  await new Promise((resolve, reject) => {
    tcp.once("error", reject);
    tcp.listen(port, "127.0.0.1", resolve);
  });
  udp.on("message", (query, peer) => {
    let cursor = 12;
    while (query[cursor] !== 0) cursor += query[cursor] + 1;
    const type = query.readUInt16BE(cursor + 1);
    const response = Buffer.from(query);
    response.writeUInt16BE(type === 1 ? 0x8183 : 0x8380, 2); // A: NXDOMAIN; AAAA: truncated.
    response.writeUInt16BE(1, 4);
    response.writeUInt16BE(0, 6);
    response.writeUInt16BE(0, 8);
    response.writeUInt16BE(0, 10);
    const send = () => udp.send(response, peer.port, peer.address);
    if (type === 1) setTimeout(send, 30);
    else send();
  });
  const fixture = {
    port,
    get activeTcp() { return activeTcp; },
    get maximumTcp() { return maximumTcp; },
    get totalTcp() { return totalTcp; },
  };
  t.after(async () => {
    for (const socket of tcpSockets) socket.destroy();
    await new Promise((resolve) => tcp.close(() => resolve()));
    await new Promise((resolve) => udp.close(() => resolve()));
  });
  return fixture;
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

test("a resolver answer change after validation keeps the current dial pinned and blocks a fresh private answer", async (t) => {
  // The minted local seam treats this real loopback server as the approved
  // destination analogue; it does not make loopback a production destination.
  let currentAnswer = "127.0.0.1";
  const resolverAnswers = [];
  let requests = 0;
  let sockets = 0;
  let dispatchIntents = 0;
  const fixture = await fixtureFetcher(t, (_request, response) => {
    requests += 1;
    respond(response, 200, { "content-type": "text/plain" }, "original vetted destination");
  }, {
    resolveOverride(hostname) {
      assert.equal(hostname, "fixture.example.test");
      resolverAnswers.push(currentAnswer);
      return Object.freeze({ addresses: Object.freeze([currentAnswer]), aliases: Object.freeze([]) });
    },
  });
  fixture.server.server.on("connection", () => { sockets += 1; });

  const socketAttempts = [];
  let nativeSocketCalls = 0;
  const originalConnect = net.connect;
  net.connect = function guardedConnect(options, ...argumentsAfterOptions) {
    socketAttempts.push({ address: options?.host, port: options?.port });
    // Record before the native call and deny every non-fixture socket even if
    // a regression attempts to dial the rebinding answer without validation.
    assert.equal(options?.host, "127.0.0.1", "a forbidden address must never reach a native socket");
    assert.equal(options?.port, fixture.server.port, "only the controlled fixture port may be dialed");
    nativeSocketCalls += 1;
    return Reflect.apply(originalConnect, this, [options, ...argumentsAfterOptions]);
  };
  try {
    const result = await runWithSafeFetchLifecycle(fixture.fetcher, {
      onDispatchIntent() {
        dispatchIntents += 1;
        assert.deepEqual(resolverAnswers, ["127.0.0.1"], "change the answer after the first resolution is validated");
        assert.equal(socketAttempts.length, 0, "change the answer before any socket is created");
        currentAnswer = "10.0.0.7";
      },
    }, {}, () => fixture.fetcher.fetch(fixture.url("/before-rebinding")));

    assert.equal(Buffer.from(result.bytes).toString("utf8"), "original vetted destination");
    assert.equal(dispatchIntents, 1);
    assert.deepEqual(resolverAnswers, ["127.0.0.1"], "the in-flight request must not resolve its hostname again");
    assert.deepEqual(fixture.dials, [{ peer: "127.0.0.1", address: "127.0.0.1", port: fixture.server.port }]);

    await assert.rejects(fixture.fetcher.fetch(fixture.url("/after-rebinding")), { code: "POLICY_DENIED" });
    assert.deepEqual(resolverAnswers, ["127.0.0.1", "10.0.0.7"], "a fresh request observes the changed private answer");
    assert.deepEqual(socketAttempts, [{ address: "127.0.0.1", port: fixture.server.port }]);
    assert.equal(fixture.dials.length, 1);
    assert.equal(sockets, 1);
    assert.equal(requests, 1);
    assert.equal(nativeSocketCalls, 1);
  } finally {
    net.connect = originalConnect;
    t.diagnostic(JSON.stringify({ mode: "controlled-loopback", resolverAnswers, dispatchIntents,
      socketAttempts, nativeSocketCalls, acceptedSockets: sockets, requests }));
  }
});

test("only the exact factory-minted test options identity activates the local fixture seam", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, { "content-type": "text/plain" }, "fixture"));
  const result = await fixture.fetcher.fetch(fixture.url("/original"));
  assert.equal(Buffer.from(result.bytes).toString(), "fixture");

  const copiedFetcher = new SafeFetcher({ ...fixture.seam });
  await assert.rejects(copiedFetcher.fetch(fixture.url("/copy")), { code: "POLICY_DENIED" });
  assert.equal(fixture.dials.length, 1);
});

test("rejects caller header injection without opening a socket", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, { "content-type": "text/plain" }, "hello"));
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/"), { headers: { cookie: "session=secret" } }), { code: "POLICY_DENIED" });
  assert.equal(fixture.dials.length, 0);
});

test("malformed options and signals fail as sanitized typed policy errors before resolution", async (t) => {
  let resolverCalls = 0;
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, { "content-type": "text/plain" }, "unused"), {
    resolveOverride() {
      resolverCalls += 1;
      return { addresses: ["127.0.0.1"], aliases: [] };
    },
  });
  const canary = "private-canary-https://secret.example/token";
  const hostile = new Proxy({}, { ownKeys() { throw new Error(canary); } });
  const accessor = {};
  Object.defineProperty(accessor, "signal", { get() { throw new Error(canary); } });
  for (const options of [null, { signal: {} }, { signal: 1 }, hostile, accessor]) {
    await assert.rejects(fixture.fetcher.fetch(fixture.url("/invalid"), options), (error) => {
      assert.ok(error instanceof RetrievalError);
      assert.equal(error.code, "POLICY_DENIED");
      assert.equal(error.cause, undefined);
      assert.equal(error.message.includes(canary), false);
      assert.equal(error.stack.includes(canary), false);
      return true;
    });
  }
  assert.equal(resolverCalls, 0);
  assert.equal(fixture.dials.length, 0);
});

test("uses trusted AbortSignal intrinsics and never lets caller cleanup methods replace the result", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, { "content-type": "text/plain" }, "ok"));
  const controller = new AbortController();
  controller.signal.addEventListener = () => { throw new Error("hostile add"); };
  controller.signal.removeEventListener = () => { throw new Error("hostile remove"); };
  const result = await fixture.fetcher.fetch(fixture.url("/intrinsics"), { signal: controller.signal });
  assert.equal(Buffer.from(result.bytes).toString(), "ok");
  assert.equal(fixture.dials.length, 1);
});

test("transport failures do not retain raw errors or private URL details as causes", async (t) => {
  const canary = "private-canary-https://secret.example/token";
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, { "content-type": "text/plain" }, "unused"), {
    resolveOverride() { throw new Error(canary); },
  });
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/transport")), (error) => {
    assert.ok(error instanceof RetrievalError);
    assert.equal(error.code, "TRANSPORT_FAILURE");
    assert.equal(error.cause, undefined);
    assert.equal(error.message.includes(canary), false);
    assert.equal(error.stack.includes(canary), false);
    return true;
  });
  const direct = new RetrievalError("TRANSPORT_FAILURE", { cause: new Error(canary) });
  assert.equal(direct.cause, undefined);
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

test('controlled SVG fetch is one-hop and never resolves or dials a redirect target', async (t) => {
  const paths = [];
  let resolverCalls = 0;
  const fixture = await fixtureFetcher(t, (request, response) => {
    paths.push(request.url);
    respond(response, 302, { location: 'http://fixture.example.test/second.svg' });
  }, {
    resolveOverride: () => {
      resolverCalls += 1;
      return Object.freeze({ addresses: Object.freeze(['127.0.0.1']), aliases: Object.freeze([]) });
    },
  });

  await assert.rejects(
    runWithSafeFetchLifecycle(fixture.fetcher, {}, {}, () => fixture.fetcher.fetchSvgAsset(fixture.url('/first.svg'))),
    { code: 'REDIRECT_LIMIT' },
  );
  assert.deepEqual(paths, ['/first.svg']);
  assert.equal(resolverCalls, 1);
  assert.equal(fixture.dials.length, 1);
});

test('controlled SVG fetch rejects deceptive MIME and honors a lower decoded media cap', async (t) => {
  const deceptive = await fixtureFetcher(t, (_request, response) => {
    respond(response, 200, { 'content-type': 'text/html; charset=utf-8' }, '<svg/>');
  });
  await assert.rejects(deceptive.fetcher.fetchSvgAsset(deceptive.url('/deceptive.svg')), { code: 'UNSUPPORTED_MEDIA' });
  assert.equal(deceptive.dials.length, 1);

  const expanded = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(256)}</svg>`);
  const compressed = gzipSync(expanded);
  const bounded = await fixtureFetcher(t, (_request, response) => {
    respond(response, 200, {
      'content-type': 'image/svg+xml',
      'content-encoding': 'gzip',
      'content-length': String(compressed.byteLength),
    }, compressed);
  });
  await assert.rejects(
    runWithSafeFetchLifecycle(bounded.fetcher, {}, { decodedMediaBytesPerResponse: 64 },
      () => bounded.fetcher.fetchSvgAsset(bounded.url('/expanded.svg'))),
    { code: 'RESOURCE_LIMIT' },
  );
  assert.equal(bounded.dials.length, 1);
});

test('SVG transport decodes a bounded full prolog while the inspector still rejects that unsupported syntax', async (t) => {
  const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>';
  const commentPrefix = `${xmlDeclaration}<!--`;
  const asciiBeforeMultibyte = 'a'.repeat(1023 - Buffer.byteLength(commentPrefix));
  const source = Buffer.from(`${commentPrefix}${asciiBeforeMultibyte}é--><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>`);
  assert.equal(Buffer.byteLength(`${commentPrefix}${asciiBeforeMultibyte}`), 1023,
    'the two-byte UTF-8 character straddles the former 1024-byte prefix boundary');
  const fixture = await fixtureFetcher(t, (_request, response) => {
    respond(response, 200, { 'content-type': 'image/svg+xml; charset=utf-8' }, source);
  });

  const fetched = await runWithSafeFetchLifecycle(fixture.fetcher, {}, {},
    () => fixture.fetcher.fetchSvgAsset(fixture.url('/prolog.svg')));
  assert.deepEqual(Buffer.from(fetched.bytes), source, 'the bounded transport validates UTF-8 across the whole response');
  const inspection = inspectSafeAssetBytes(fetched.bytes, { contentType: 'image/svg+xml' });
  try {
    assert.equal(inspection.action, 'reject');
    assert.equal(inspection.diagnostics[0].code, 'SVG_UNSUPPORTED_DECLARATION');
  } finally {
    inspection.dispose?.();
    fetched.bytes.fill(0);
  }
  assert.equal(fixture.dials.length, 1);
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

test("rejects chunked identity text above the independent 10 MiB wire cap", async (t) => {
  const expanded = Buffer.alloc(10 * 1024 * 1024 + 1, 0x62);
  const fixture = await fixtureFetcher(t, (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain", "transfer-encoding": "chunked" });
    response.end(expanded);
  });
  await assert.rejects(fixture.fetcher.fetch(fixture.url("/large")), { code: "RESOURCE_LIMIT" });
});

test("rejects declared identity text above the independent 10 MiB wire cap", async (t) => {
  const fixture = await fixtureFetcher(t, (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain", "content-length": String(10 * 1024 * 1024 + 1) });
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

test("failed A lookup cancels and settles the stalled AAAA TCP sibling before fetch slots are reused", async (t) => {
  const dns = await stalledDnsFixture(t);
  const resolver = new DnsWireResolver({ nameservers: ["127.0.0.1"], port: dns.port });
  const fixture = await fixtureFetcher(t, (_request, response) => respond(response, 200, { "content-type": "text/plain" }, "unreachable"), {
    hostnames: ["example.org"],
    resolveOverride(hostname, { signal }) {
      return resolver.resolve(hostname, { signal, deadline: performance.now() + 2_000 });
    },
  });
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const outcomes = await Promise.all(controllers.map((controller) =>
    fixture.fetcher.fetch(fixture.url("/dns-failure", "example.org"), { signal: controller.signal }).then(
      () => ({ status: "fulfilled" }),
      (error) => ({ status: "rejected", error }),
    )));
  assert.deepEqual(outcomes.map((outcome) => outcome.status === "rejected" ? outcome.error.code : "FULFILLED"), Array(8).fill("DNS_FAILURE"));
  assert.ok(dns.totalTcp >= 1, "AAAA TCP fallback should be exercised");
  await waitFor(() => dns.activeTcp === 0, 500);
  assert.ok(dns.maximumTcp <= 4, `sibling sockets must remain within fetch slots (observed ${dns.maximumTcp})`);
  assert.equal(fixture.dials.length, 0);
  for (const controller of controllers) controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dns.activeTcp, 0, "later caller cancellation must not reveal a lingering resolver child");
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

test("cancellation during delayed admission or dispatch-intent hooks cannot open a socket", async (t) => {
  for (const stage of ["beforeHop", "onDispatchIntent"]) {
    let requests = 0;
    const fixture = await fixtureFetcher(t, (_request, response) => {
      requests += 1;
      respond(response, 200, { "content-type": "text/plain" }, "unexpected");
    });
    const controller = new AbortController();
    let entered;
    let resume;
    const enteredPromise = new Promise((resolve) => { entered = resolve; });
    const resumePromise = new Promise((resolve) => { resume = resolve; });
    const pending = runWithSafeFetchLifecycle(fixture.fetcher, {
      [stage]: async () => { entered(); await resumePromise; },
      onKnownZero: async () => {},
    }, {}, () => fixture.fetcher.fetch(fixture.url(`/cancel-${stage}`), { signal: controller.signal }));
    await enteredPromise;
    controller.abort();
    resume();
    await assert.rejects(pending, (error) => error instanceof RetrievalError && error.code === "CANCELED");
    assert.equal(fixture.dials.length, 0, `${stage} cancellation must happen before a pinned dial`);
    assert.equal(requests, 0);
  }
});

test("deadline during an awaited private admission hook is checked before socket creation", async (t) => {
  let requests = 0;
  const fixture = await fixtureFetcher(t, (_request, response) => {
    requests += 1;
    respond(response, 200, { "content-type": "text/plain" }, "unexpected");
  });
  const pending = runWithSafeFetchLifecycle(fixture.fetcher, {
    beforeHop: async () => new Promise((resolve) => setTimeout(resolve, 60)),
    onKnownZero: async () => {},
  }, { totalMilliseconds: 20 }, () => fixture.fetcher.fetch(fixture.url("/deadline-hook")));
  await assert.rejects(pending, (error) => error instanceof RetrievalError && error.code === "DEADLINE_EXCEEDED");
  assert.equal(fixture.dials.length, 0);
  assert.equal(requests, 0);
});
