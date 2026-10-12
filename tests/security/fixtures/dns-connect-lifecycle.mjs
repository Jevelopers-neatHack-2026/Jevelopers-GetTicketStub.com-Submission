import assert from "node:assert/strict";
import dgram from "node:dgram";
import net, { BlockList } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { setImmediate as immediate } from "node:timers/promises";

// Actual native UDP/TCP uses only an owned numeric-loopback resolver. BlockList and
// delayed/closed callback delivery are injected faults, not a public-run replay.
const scenario = process.argv[2];
assert.ok(["control", "native-error-semantics", "connect-error", "connect-error-fallback",
  "late-cancel", "late-deadline", "closed-before-callback", "tcp-control", "tcp-cancel",
  "tcp-deadline", "tcp-malformed-family", "tcp-family-control"].includes(scenario));
assert.equal(process.version, "v22.23.3");
const observed = { scenario, phase: "setup" };
process.on("exit", (code) => {
  process.stdout.write(JSON.stringify({ ...observed, processExit: code }) + "\n");
});

async function runUdpLifecycle() {
  Object.assign(observed, { mode: "synthetic_local_native_udp", nativeCallbacks: 0,
    connectErrors: [], sends: 0, sendErrors: [], closes: 0, sockets: 0, queries: 0,
    deliveredLateCallbacks: 0 });
  const createNative = dgram.createSocket;
  const server = createNative("udp4");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.bind(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  server.on("message", (query, peer) => {
    assert.equal(peer.address, "127.0.0.1");
    observed.queries += 1;
    const response = Buffer.from(query);
    const type = query.readUInt16BE(query.length - 4);
    assert.ok(type === 1 || type === 28);
    response.writeUInt16BE(0x8180, 2);
    response.writeUInt16BE(type === 1 ? 1 : 0, 6);
    const answer = type === 1
      ? Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, 8, 8, 8, 8])
      : Buffer.alloc(0);
    server.send(Buffer.concat([response, answer]), peer.port, peer.address);
  });

  const controller = new AbortController();
  const deferred = [];
  const blockList = new BlockList();
  blockList.addAddress(scenario === "connect-error-fallback" ? "127.0.0.2" : "127.0.0.1");
  const blocked = ["native-error-semantics", "connect-error", "connect-error-fallback"].includes(scenario);
  let deadline;
  let deadlineTimer;
  let deadlineTimerFired = false;

  try {
    if (scenario === "native-error-semantics") {
      const socket = createNative({ type: "udp4", sendBlockList: blockList });
      observed.sockets += 1;
      await new Promise((resolve, reject) => {
        socket.once("error", reject);
        let connectReturned = false;
        socket.connect(port, "127.0.0.1", (error) => {
          assert.equal(connectReturned, true, "native connect failure callback is asynchronous");
          observed.nativeCallbacks += 1;
          observed.connectErrors.push(error?.code ?? null);
          assert.equal(error?.code, "ERR_IP_BLOCKED");
          assert.throws(() => socket.send(Buffer.from([1]), () => {}), { code: "ERR_SOCKET_BAD_PORT" });
          socket.close(() => { observed.closes += 1; resolve(); });
        });
        connectReturned = true;
      });
      assert.equal(observed.queries, 0);
      assert.equal(observed.closes, observed.sockets);
    } else {
      dgram.createSocket = function (type) {
        const socket = createNative(blocked ? { type, sendBlockList: blockList } : type);
        observed.sockets += 1;
        socket.once("close", () => { observed.closes += 1; });
        const nativeConnect = socket.connect;
        const nativeSend = socket.send;
        socket.send = function (...args) {
          observed.sends += 1;
          try { return Reflect.apply(nativeSend, this, args); }
          catch (error) { observed.sendErrors.push(error.code); throw error; }
        };
        socket.connect = function (destinationPort, host, callback) {
          assert.ok(["127.0.0.1", "127.0.0.2"].includes(host), "numeric loopback only");
          assert.equal(destinationPort, port, "owned fixture port only");
          let connectReturned = false;
          const result = Reflect.apply(nativeConnect, this, [destinationPort, host, (error) => {
            assert.equal(connectReturned, true);
            observed.nativeCallbacks += 1;
            if (error) observed.connectErrors.push(error.code);
            const invoke = () => callback(error);
            if (scenario === "late-cancel" || scenario === "late-deadline") {
              assert.equal(error, undefined, "timing fault starts after a successful native connect");
              deferred.push(invoke);
              if (deferred.length === 2) {
                const releaseCallbacks = () => {
                  for (const invokeLate of deferred) {
                    observed.deliveredLateCallbacks += 1;
                    invokeLate();
                  }
                };
                if (scenario === "late-cancel") {
                  controller.abort();
                  setImmediate(releaseCallbacks);
                } else {
                  assert.ok(performance.now() < deadline, "both native connects must precede the deadline");
                  // Let actual monotonic time expire while the timer cannot run.
                  // No fake clock or fabricated connect completion is used.
                  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0,
                    Math.max(0, deadline - performance.now()) + 15);
                  assert.ok(performance.now() >= deadline);
                  assert.equal(deadlineTimerFired, false, "deadline timer is still waiting for the event loop");
                  releaseCallbacks();
                }
              }
            } else if (scenario === "closed-before-callback") {
              assert.equal(error, undefined);
              socket.close(invoke);
            } else {
              invoke();
            }
          }]);
          connectReturned = true;
          return result;
        };
        return socket;
      };
      syncBuiltinESMExports();
      const { DnsWireResolver } = await import("../../../src/security/internal/dns-wire.mjs");
      const resolver = new DnsWireResolver({ nameservers: scenario === "connect-error-fallback"
        ? ["127.0.0.2", "127.0.0.1"] : ["127.0.0.1"], port });
      deadline = performance.now() + (scenario === "late-deadline" ? 1_500 : 2_000);
      if (scenario === "late-deadline") {
        deadlineTimer = setTimeout(() => { deadlineTimerFired = true; }, Math.max(0, deadline - performance.now()));
      }
      observed.phase = "resolving";
      const pending = resolver.resolve("example.org", { signal: controller.signal, deadline });
      const successful = scenario === "control" || scenario === "connect-error-fallback";
      if (successful) {
        assert.deepEqual(await pending, { addresses: ["8.8.8.8"], aliases: [] });
      } else {
        const code = scenario === "late-cancel" ? "CANCELED"
          : scenario === "late-deadline" ? "DEADLINE_EXCEEDED" : "DNS_FAILURE";
        await assert.rejects(pending, { code });
      }
      await immediate();
      await immediate();
      assert.equal(observed.queries, successful ? 2 : 0, "actual loopback datagram count");
      assert.equal(observed.closes, observed.sockets, "every native client socket closed");
      if (scenario === "closed-before-callback") {
        assert.ok(observed.sends >= 1 && observed.sends <= 2);
        assert.equal(observed.sendErrors.length, observed.sends);
        assert.ok(observed.sendErrors.every((code) => code === "ERR_SOCKET_DGRAM_NOT_RUNNING"));
      } else {
        assert.equal(observed.sends, successful ? 2 : 0, "no send after a failed or inactive connect");
        assert.deepEqual(observed.sendErrors, []);
      }
      if (scenario === "connect-error" || scenario === "connect-error-fallback") {
        assert.deepEqual(observed.connectErrors, ["ERR_IP_BLOCKED", "ERR_IP_BLOCKED"]);
      }
      if (scenario === "late-cancel" || scenario === "late-deadline") {
        assert.equal(observed.deliveredLateCallbacks, 2, "both withheld native callbacks were exercised");
      }
    }
    observed.phase = "complete";
  } finally {
    clearTimeout(deadlineTimer);
    dgram.createSocket = createNative;
    syncBuiltinESMExports();
    controller.abort();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runTcpLifecycle() {
  Object.assign(observed, { mode: "synthetic_local_native_dns_tcp", udpQueries: 0,
    tcpQueries: 0, tcpTypes: [], tcpConnects: 0, clientWrites: 0, clientSockets: 0,
    clientCloses: 0, deliveredLateEvents: 0 });
  const mixedFamily = scenario === "tcp-malformed-family" || scenario === "tcp-family-control";
  function answer(query, truncated = false) {
    const header = Buffer.from(query);
    header.writeUInt16BE(truncated ? 0x8380 : 0x8180, 2);
    const isA = query.readUInt16BE(query.length - 4) === 1;
    header.writeUInt16BE(!truncated && isA ? 1 : 0, 6);
    return Buffer.concat([header, !truncated && isA
      ? Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, 8, 8, 8, 8]) : Buffer.alloc(0)]);
  }
  const acceptedSockets = new Set();
  const server = net.createServer((socket) => {
    acceptedSockets.add(socket);
    socket.once("close", () => acceptedSockets.delete(socket));
    socket.on("error", (error) => {
      assert.ok(["ECONNRESET", "EPIPE"].includes(error.code), "only fixture peer closure is expected");
    });
    let bytes = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length < 2 || bytes.length < bytes.readUInt16BE(0) + 2) return;
      observed.tcpQueries += 1;
      const query = bytes.subarray(2, bytes.readUInt16BE(0) + 2);
      observed.tcpTypes.push(query.readUInt16BE(query.length - 4));
      const response = answer(query);
      if (scenario === "tcp-malformed-family") {
        response.writeUInt16BE((query.readUInt16BE(0) + 1) & 0xffff, 0);
      }
      const frame = Buffer.alloc(response.length + 2);
      frame.writeUInt16BE(response.length, 0);
      response.copy(frame, 2);
      socket.end(frame);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const udp = dgram.createSocket("udp4");
  await new Promise((resolve, reject) => {
    udp.once("error", reject);
    udp.bind(port, "127.0.0.1", resolve);
  });
  udp.on("message", (query, peer) => {
    assert.equal(peer.address, "127.0.0.1");
    observed.udpQueries += 1;
    const isA = query.readUInt16BE(query.length - 4) === 1;
    udp.send(answer(query, !mixedFamily || !isA), peer.port, peer.address);
  });
  const controller = new AbortController();
  const nativeConnect = net.connect;
  const deferred = [];
  let deadline;
  let deadlineTimer;
  let deadlineTimerFired = false;
  try {
    net.connect = function (options) {
      assert.equal(options.host, "127.0.0.1", "numeric loopback only");
      assert.equal(options.port, port, "owned fixture port only");
      const socket = Reflect.apply(nativeConnect, this, [options]);
      observed.clientSockets += 1;
      socket.once("close", () => { observed.clientCloses += 1; });
      const nativeEmit = socket.emit;
      const nativeWrite = socket.write;
      socket.write = function (...args) {
        observed.clientWrites += 1;
        return Reflect.apply(nativeWrite, this, args);
      };
      // Hold one actual native connect event per socket, not individual listeners.
      socket.emit = function (event, ...args) {
        if (event !== "connect") return Reflect.apply(nativeEmit, this, [event, ...args]);
        observed.tcpConnects += 1;
        const invoke = () => Reflect.apply(nativeEmit, socket, [event, ...args]);
        if (scenario !== "tcp-deadline" && scenario !== "tcp-cancel") return invoke();
        deferred.push(invoke);
        if (deferred.length === 2) {
          const releaseEvents = () => {
            for (const invokeLate of deferred) {
              observed.deliveredLateEvents += 1;
              invokeLate();
            }
          };
          if (scenario === "tcp-cancel") {
            controller.abort();
            setImmediate(releaseEvents);
          } else {
            assert.ok(performance.now() < deadline, "both native TCP connects must precede the deadline");
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0,
              Math.max(0, deadline - performance.now()) + 15);
            assert.ok(performance.now() >= deadline);
            assert.equal(deadlineTimerFired, false, "deadline timer has not run");
            releaseEvents();
          }
        }
        return true;
      };
      return socket;
    };
    syncBuiltinESMExports();
    const { DnsWireResolver } = await import("../../../src/security/internal/dns-wire.mjs");
    deadline = performance.now() + (scenario === "tcp-deadline" ? 1_500 : 2_000);
    if (scenario === "tcp-deadline") {
      deadlineTimer = setTimeout(() => { deadlineTimerFired = true; }, Math.max(0, deadline - performance.now()));
    }
    observed.phase = "resolving";
    const result = await new DnsWireResolver({ nameservers: ["127.0.0.1"], port })
      .resolve("example.org", { deadline, signal: controller.signal })
      .then((value) => ({ value }), (error) => ({ error: error.code }));
    observed.result = result;
    await immediate();
    await immediate();
    assert.equal(observed.udpQueries, 2, "both families used actual local UDP");
    assert.equal(observed.tcpConnects, mixedFamily ? 1 : 2, "actual native TCP event count");
    assert.equal(observed.clientCloses, observed.clientSockets, "every native TCP client closed");
    if (scenario === "tcp-control" || scenario === "tcp-family-control") {
      assert.deepEqual(result.value, { addresses: ["8.8.8.8"], aliases: [] });
      assert.equal(observed.clientWrites, mixedFamily ? 1 : 2);
      assert.equal(observed.tcpQueries, mixedFamily ? 1 : 2);
      if (mixedFamily) assert.deepEqual(observed.tcpTypes, [28], "validated AAAA NODATA alone used TCP");
    } else if (scenario === "tcp-malformed-family") {
      assert.equal(result.error, "DNS_FAILURE", "malformed fallback cannot become a valid empty family");
      assert.equal(observed.clientWrites, 1);
      assert.equal(observed.tcpQueries, 1);
      assert.deepEqual(observed.tcpTypes, [28]);
    } else {
      assert.equal(result.error, scenario === "tcp-cancel" ? "CANCELED" : "DEADLINE_EXCEEDED");
      assert.equal(observed.deliveredLateEvents, 2, "both actual withheld native events were exercised");
      assert.equal(observed.clientWrites, 0, "no DNS write after cancellation or deadline");
      assert.equal(observed.tcpQueries, 0, "no actual local TCP DNS query after cancellation or deadline");
    }
    observed.phase = "complete";
  } finally {
    clearTimeout(deadlineTimer);
    net.connect = nativeConnect;
    syncBuiltinESMExports();
    controller.abort();
    for (const socket of acceptedSockets) socket.destroy();
    await new Promise((resolve) => udp.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
}

if (scenario.startsWith("tcp-")) await runTcpLifecycle();
else await runUdpLifecycle();
