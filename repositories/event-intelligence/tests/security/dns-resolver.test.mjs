import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import net from "node:net";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { DnsWireResolver } from "../../src/security/internal/dns-wire.mjs";

function encodeName(name) {
  const labels = name.split(".").map((label) => {
    const bytes = Buffer.from(label, "ascii");
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  });
  return Buffer.concat([...labels, Buffer.from([0])]);
}

function readQuestion(query) {
  let offset = 12;
  const labels = [];
  while (query[offset] !== 0) {
    const length = query[offset++];
    labels.push(query.subarray(offset, offset + length).toString("ascii"));
    offset += length;
  }
  offset += 1;
  const type = query.readUInt16BE(offset);
  const questionEnd = offset + 4;
  return { hostname: labels.join(".").toLowerCase(), type, question: query.subarray(12, questionEnd), questionEnd };
}

function ipBytes(address) {
  if (address.includes(".")) return Buffer.from(address.split(".").map(Number));
  const halves = address.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const words = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right].map((part) => Number.parseInt(part || "0", 16));
  return Buffer.from(words.flatMap((word) => [word >> 8, word & 0xff]));
}

function recordBytes(questionHost, record) {
  const owner = record.owner === questionHost ? Buffer.from([0xc0, 0x0c]) : encodeName(record.owner);
  const header = Buffer.alloc(10);
  const types = { A: 1, CNAME: 5, AAAA: 28 };
  header.writeUInt16BE(types[record.type], 0);
  header.writeUInt16BE(1, 2);
  header.writeUInt32BE(60, 4);
  let payload;
  if (record.type === "A" || record.type === "AAAA") payload = ipBytes(record.data);
  else payload = encodeName(record.data);
  header.writeUInt16BE(payload.length, 8);
  return Buffer.concat([owner, header, payload]);
}

function makeResponse(query, records = [], { flags = 0x8180, id, question } = {}) {
  const parsed = readQuestion(query);
  const header = Buffer.from(query.subarray(0, 12));
  if (id !== undefined) header.writeUInt16BE(id, 0);
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(records.length, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  return Buffer.concat([header, question ?? parsed.question, ...records.map((record) => recordBytes(parsed.hostname, record))]);
}

async function udpFixture(handler) {
  const socket = createSocket("udp4");
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", resolve);
  });
  const { port } = socket.address();
  socket.on("message", handler);
  return {
    socket,
    port,
    close: () => new Promise((resolve) => socket.close(() => resolve())),
    onMessage: (callback) => socket.on("message", callback),
    handle: handler,
  };
}

async function resolverFor(t, handler) {
  const fixture = await udpFixture(handler);
  t.after(() => fixture.close());
  return { fixture, resolver: new DnsWireResolver({ nameservers: ["127.0.0.1"], port: fixture.port }) };
}

test("follows and records only a validated CNAME chain before using a terminal address", async (t) => {
  const seen = [];
  const { fixture, resolver } = await resolverFor(t, (query, peer) => {
    const question = readQuestion(query);
    seen.push(question.hostname);
    const records = question.type === 1 && question.hostname === "example.org"
      ? [{ owner: "example.org", type: "CNAME", data: "alias.example.org" }]
      : question.type === 1 && question.hostname === "alias.example.org"
        ? [{ owner: "alias.example.org", type: "A", data: "8.8.8.8" }]
        : [];
    fixture.socket.send(makeResponse(query, records), peer.port, peer.address);
  });
  const result = await resolver.resolve("example.org", { deadline: performance.now() + 1_000 });
  assert.deepEqual(result.addresses, ["8.8.8.8"]);
  assert.deepEqual(result.aliases, ["alias.example.org"]);
  assert.ok(seen.includes("alias.example.org"));
});

test("rejects a local CNAME alias before querying or dialing the alias", async (t) => {
  const seen = [];
  const { fixture, resolver } = await resolverFor(t, (query, peer) => {
    const question = readQuestion(query);
    seen.push(question.hostname);
    const records = question.type === 1 && question.hostname === "example.org"
      ? [{ owner: "example.org", type: "CNAME", data: "private.internal" }]
      : [];
    fixture.socket.send(makeResponse(query, records), peer.port, peer.address);
  });
  await assert.rejects(resolver.resolve("example.org", { deadline: performance.now() + 1_000 }), { code: "POLICY_DENIED" });
  assert.deepEqual([...new Set(seen)], ["example.org"]);
});

test("rejects a mixed public and private answer set as a whole", async (t) => {
  const { fixture, resolver } = await resolverFor(t, (query, peer) => {
    const question = readQuestion(query);
    const records = question.type === 1
      ? [
        { owner: question.hostname, type: "A", data: "8.8.8.8" },
        { owner: question.hostname, type: "A", data: "10.0.0.1" },
      ]
      : [];
    fixture.socket.send(makeResponse(query, records), peer.port, peer.address);
  });
  await assert.rejects(resolver.resolve("example.org", { deadline: performance.now() + 1_000 }), { code: "POLICY_DENIED" });
});

test("does not treat unrelated answer records as a valid address", async (t) => {
  const { fixture, resolver } = await resolverFor(t, (query, peer) => {
    const question = readQuestion(query);
    const records = question.type === 1 ? [{ owner: "unrelated.example.org", type: "A", data: "8.8.8.8" }] : [];
    fixture.socket.send(makeResponse(query, records), peer.port, peer.address);
  });
  await assert.rejects(resolver.resolve("example.org", { deadline: performance.now() + 1_000 }), { code: "DNS_FAILURE" });
});

test("connected UDP resolver ignores a response from an unconfigured source port", async (t) => {
  let spoofCount = 0;
  const { fixture, resolver } = await resolverFor(t, async (query, peer) => {
    const spoof = createSocket("udp4");
    await new Promise((resolve) => spoof.bind(0, "127.0.0.1", resolve));
    spoofCount += 1;
    spoof.send(makeResponse(query, [{ owner: readQuestion(query).hostname, type: "A", data: "10.0.0.1" }]), peer.port, peer.address);
    spoof.close();
    const question = readQuestion(query);
    const records = question.type === 1 ? [{ owner: question.hostname, type: "A", data: "1.1.1.1" }] : [];
    fixture.socket.send(makeResponse(query, records), peer.port, peer.address);
  });
  const result = await resolver.resolve("example.org", { deadline: performance.now() + 2_000 });
  assert.deepEqual(result.addresses, ["1.1.1.1"]);
  assert.equal(spoofCount, 2);
});

test("validates transaction IDs and questions again after UDP truncation fallback", async (t) => {
  const tcp = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 2) return;
      const size = buffer.readUInt16BE(0);
      if (buffer.length < size + 2) return;
      const query = buffer.subarray(2, size + 2);
      const q = readQuestion(query);
      const malformedQuestion = Buffer.from(q.question);
      malformedQuestion.writeUInt16BE(q.type === 1 ? 28 : 1, malformedQuestion.length - 4);
      const answer = makeResponse(query, [], { id: (query.readUInt16BE(0) + 1) & 0xffff, question: malformedQuestion });
      const frame = Buffer.alloc(answer.length + 2);
      frame.writeUInt16BE(answer.length, 0);
      answer.copy(frame, 2);
      socket.end(frame);
    });
  });
  await new Promise((resolve, reject) => { tcp.once("error", reject); tcp.listen(0, "127.0.0.1", resolve); });
  const port = tcp.address().port;
  t.after(() => new Promise((resolve) => tcp.close(() => resolve())));
  const udp = createSocket("udp4");
  await new Promise((resolve, reject) => { udp.once("error", reject); udp.bind(port, "127.0.0.1", resolve); });
  t.after(() => new Promise((resolve) => udp.close(() => resolve())));
  udp.on("message", (query, peer) => udp.send(makeResponse(query, [], { flags: 0x8380 }), peer.port, peer.address));
  const resolver = new DnsWireResolver({ nameservers: ["127.0.0.1"], port });
  await assert.rejects(resolver.resolve("example.org", { deadline: performance.now() + 2_000 }), { code: "DNS_FAILURE" });
});

test("recomputes DNS response flags and accepts a valid TCP fallback response", async (t) => {
  let tcpConnections = 0;
  const tcp = net.createServer((socket) => {
    tcpConnections += 1;
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 2) return;
      const size = buffer.readUInt16BE(0);
      if (buffer.length < size + 2) return;
      const query = buffer.subarray(2, size + 2);
      const q = readQuestion(query);
      const records = q.type === 1 ? [{ owner: q.hostname, type: "A", data: "9.9.9.9" }] : [];
      const answer = makeResponse(query, records, { flags: 0x8180 });
      const frame = Buffer.alloc(answer.length + 2);
      frame.writeUInt16BE(answer.length, 0);
      answer.copy(frame, 2);
      socket.end(frame);
    });
  });
  await new Promise((resolve, reject) => { tcp.once("error", reject); tcp.listen(0, "127.0.0.1", resolve); });
  const port = tcp.address().port;
  t.after(() => new Promise((resolve) => tcp.close(() => resolve())));
  const udp = createSocket("udp4");
  await new Promise((resolve, reject) => { udp.once("error", reject); udp.bind(port, "127.0.0.1", resolve); });
  t.after(() => new Promise((resolve) => udp.close(() => resolve())));
  udp.on("message", (query, peer) => udp.send(makeResponse(query, [], { flags: 0x8380 }), peer.port, peer.address));
  const resolver = new DnsWireResolver({ nameservers: ["127.0.0.1"], port });
  const result = await resolver.resolve("example.org", { deadline: performance.now() + 2_000 });
  assert.deepEqual(result.addresses, ["9.9.9.9"]);
  assert.equal(tcpConnections, 2);
});

test("DNS cancellation interrupts outstanding UDP queries", async (t) => {
  const { resolver } = await resolverFor(t, () => {});
  const controller = new AbortController();
  const pending = resolver.resolve("example.org", { signal: controller.signal, deadline: performance.now() + 2_000 });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, { code: "CANCELED" });
});

test("DNS deadline applies to stalled resolver responses", async (t) => {
  const { resolver } = await resolverFor(t, () => {});
  await assert.rejects(resolver.resolve("example.org", { deadline: performance.now() + 40 }), { code: "DEADLINE_EXCEEDED" });
});

test("cancellation and expired deadlines are honored for literal IP results", async () => {
  const resolver = new DnsWireResolver({ nameservers: ["127.0.0.1"] });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(resolver.resolve("8.8.8.8", { signal: controller.signal }), { code: "CANCELED" });
  await assert.rejects(resolver.resolve("8.8.8.8", { deadline: performance.now() - 1 }), { code: "DEADLINE_EXCEEDED" });
});
