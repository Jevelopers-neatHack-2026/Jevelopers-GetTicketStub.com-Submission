import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { registerHooks } from "node:module";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Operational measurement, exercised through the real route handlers and provider transport, fully offline:
// fetch is replaced in every test, and the in-memory collector stands in for the configured sink.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const file = fileURLToPath(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url));
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});

// Neatlogs trace export for operational events, fully offline: the ingest call is a fake fetch, and the exported
// protobuf is decoded independently here to check exactly what would leave the process.
const scratch = mkdtempSync(join(tmpdir(), "ticketstub-neatlogs-"));
process.env.TICKETSTUB_DB = join(scratch, "ops.sqlite");
process.env.TICKETSTUB_FILES = join(scratch, "files");
delete process.env.TICKETSTUB_OPS_TELEMETRY;
delete process.env.NEATLOGS_API_KEY;

const { neatlogsConfig, neatlogsSink, buildTrace, encodeTrace, rejectedSpans, neatlogsStats, resetNeatlogsStats } = await import("../src/server/observability/neatlogs.ts");
const { setOpsSink, activeSink, logSink } = await import("../src/server/observability/sink.ts");
const { opsStats, resetOpsStats } = await import("../src/server/observability/measure.ts");
const agent = await import("../src/app/api/agent/route.ts");

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
beforeEach(() => { resetOpsStats(); resetNeatlogsStats(); });
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; setOpsSink(undefined); delete globalThis.__ticketstubNeatlogs; });

const SEED = "SEEDSECRET7f3a";
const KEY = "nl-offline-test-key-0000";
const event = { type: "concert", title: `Private Title ${SEED}`, facts: [{ id: "x", label: `note ${SEED}`, value: SEED, source: "me", provenance: "live", confidence: 1 }] };
const req = (body) => new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const textResponse = { model: "anthropic/test-model", provider: "Anthropic", choices: [{ finish_reason: "stop", message: { content: `Reply ${SEED}` } }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, cost: 0.001 } };
function liveAgent() {
  process.env.TICKETSTUB_RUNTIME_MODE = "live";
  process.env.TICKETSTUB_AGENT_PROVIDER = "openrouter";
  process.env.TICKETSTUB_AGENT_MODEL = "anthropic/test-model";
  process.env.TICKETSTUB_AGENT_OPENROUTER_API_KEY = "offline-provider-placeholder";
}

// --- independent OTLP protobuf decoder (only what these tests need) ---
function fields(buf) {
  const out = []; let i = 0;
  const varint = () => { let r = 0n, s = 0n; for (;;) { const b = buf[i++]; r |= BigInt(b & 0x7f) << s; if (!(b & 0x80)) return r; s += 7n; } };
  while (i < buf.length) {
    const key = Number(varint()); const f = key >> 3, w = key & 7;
    if (w === 0) out.push([f, varint()]);
    else if (w === 1) { out.push([f, buf.subarray(i, i + 8)]); i += 8; }
    else if (w === 2) { const n = Number(varint()); out.push([f, buf.subarray(i, i + n)]); i += n; }
    else throw new Error(`wire ${w}`);
  }
  return out;
}
const get = (fs, f) => fs.filter(([k]) => k === f).map(([, v]) => v);
function anyValue(buf) {
  const [[f, v]] = fields(buf);
  return f === 1 ? Buffer.from(v).toString() : f === 2 ? v === 1n : f === 3 ? Number(v) : f === 4 ? Buffer.from(v).readDoubleLE(0) : undefined;
}
const attrs = (list) => Object.fromEntries(list.map((kv) => { const fs = fields(kv); return [Buffer.from(get(fs, 1)[0]).toString(), anyValue(get(fs, 2)[0])]; }));
function decode(body) {
  const spans = [];
  const scopes = [];
  for (const rs of get(fields(body), 1)) {
    for (const ss of get(fields(rs), 2)) {
      const sfs = fields(ss);
      scopes.push(Buffer.from(get(fields(get(sfs, 1)[0]), 1)[0]).toString());
      for (const sp of get(sfs, 2)) {
        const f = fields(sp);
        const status = fields(get(f, 15)[0] ?? Buffer.alloc(0));
        spans.push({
          traceId: Buffer.from(get(f, 1)[0]).toString("hex"), spanId: Buffer.from(get(f, 2)[0]).toString("hex"),
          parent: get(f, 4)[0] ? Buffer.from(get(f, 4)[0]).toString("hex") : undefined, name: Buffer.from(get(f, 5)[0]).toString(),
          start: Buffer.from(get(f, 7)[0]).readBigUInt64LE(0), end: Buffer.from(get(f, 8)[0]).readBigUInt64LE(0),
          attributes: attrs(get(f, 9)), statusCode: Number(get(status, 3)[0] ?? 0n),
        });
      }
    }
  }
  return { spans, scopes };
}

// ---------------------------------------------------------------------------------------------

test("config needs the key and accepts only the documented ingest origins", () => {
  assert.equal(neatlogsConfig({}), undefined);
  assert.equal(neatlogsConfig({ NEATLOGS_API_KEY: "  " }), undefined);
  assert.equal(neatlogsConfig({ NEATLOGS_API_KEY: KEY }).endpoint, "https://ingest.neatlogs.com");
  assert.equal(neatlogsConfig({ NEATLOGS_API_KEY: KEY, NEATLOGS_ENDPOINT: "https://eu.ingest.neatlogs.com/" }).endpoint, "https://eu.ingest.neatlogs.com");
  for (const bad of ["http://ingest.neatlogs.com", "https://ingest.neatlogs.com.evil.example", "https://collector.example"]) {
    assert.equal(neatlogsConfig({ NEATLOGS_API_KEY: KEY, NEATLOGS_ENDPOINT: bad }), undefined, bad);
  }
  assert.deepEqual(neatlogsConfig({ NEATLOGS_API_KEY: KEY, TICKETSTUB_COMMIT_SHA: "0f9baa5" }).tags, ["ticketstub", "ticketstub@0f9baa5"]);
  assert.deepEqual(neatlogsConfig({ NEATLOGS_API_KEY: KEY, TICKETSTUB_COMMIT_SHA: "not a sha" }).tags, ["ticketstub"]);
  assert.ok(!JSON.stringify(neatlogsConfig({ NEATLOGS_API_KEY: KEY })).includes("neatlogs.com/v1"));
});

test("neatlogs is selected only with both the setting and the key; log keeps working alongside", () => {
  process.env.TICKETSTUB_OPS_TELEMETRY = "neatlogs";
  assert.equal(activeSink(), undefined, "no key: off");
  process.env.NEATLOGS_API_KEY = KEY;
  assert.equal(activeSink().name, "neatlogs");
  assert.equal(activeSink(), activeSink(), "one sink per process holds open operations");
  process.env.TICKETSTUB_OPS_TELEMETRY = "log, neatlogs";
  assert.equal(activeSink().name, "log,neatlogs");
  delete process.env.NEATLOGS_API_KEY;
  assert.equal(activeSink(), logSink, "log survives a missing key");
  process.env.TICKETSTUB_OPS_TELEMETRY = "https://collector.example";
  assert.equal(activeSink(), undefined);
});

test("a live agent reply exports one trace: workflow root, LLM child with tokens, completion marker, no private data", async () => {
  liveAgent();
  process.env.TICKETSTUB_OPS_ENVIRONMENT = "test";
  const sent = [];
  const sinkInstance = neatlogsSink({ config: { apiKey: KEY, endpoint: "https://ingest.neatlogs.com", tags: ["ticketstub", "ticketstub@0f9baa5"] },
    fetchImpl: async (url, init) => { sent.push({ url, init }); return new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "application/x-protobuf" } }); } });
  setOpsSink(sinkInstance);
  globalThis.fetch = async () => Response.json(textResponse);
  const res = await agent.POST(req({ event, message: `Hello ${SEED}` }));
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sent.length, 1);
  const { url, init } = sent[0];
  assert.equal(url, "https://ingest.neatlogs.com/v1/traces");
  assert.equal(init.headers["x-api-key"], KEY);
  assert.equal(init.headers["content-type"], "application/x-protobuf");
  assert.equal(init.redirect, "error");
  const body = Buffer.from(init.body);
  for (const bad of [SEED, "offline-provider-placeholder", "Private Title", "Hello", "Bearer", "localhost"]) assert.ok(!body.includes(bad), `exported ${bad}`);
  const { spans, scopes } = decode(body);
  assert.deepEqual(scopes, ["neatlogs", "neatlogs.internal"]);
  const root = spans.find((s) => !s.parent);
  const llm = spans.find((s) => s.attributes["neatlogs.span.kind"] === "LLM");
  const marker = spans.find((s) => s.name === "neatlogs.trace.complete");
  assert.equal(spans.length, 3);
  assert.equal(root.name, "ticketstub.agent");
  assert.equal(root.attributes["neatlogs.span.kind"], "WORKFLOW");
  assert.equal(root.attributes["ticketstub.status"], 200);
  assert.equal(root.attributes["ticketstub.operation"], "agent_reply");
  assert.equal(root.attributes["ticketstub.environment"], "test");
  assert.equal(root.attributes["neatlogs.session.id"], res.headers.get("x-ticketstub-operation"));
  assert.equal(root.statusCode, 1);
  assert.equal(llm.parent, root.spanId);
  assert.equal(llm.traceId, root.traceId);
  assert.equal(llm.name, "agent.generate");
  assert.equal(llm.attributes["neatlogs.llm.model_name"], "anthropic/test-model");
  assert.equal(llm.attributes["neatlogs.llm.provider"], "Anthropic");
  assert.equal(llm.attributes["neatlogs.llm.token_count.prompt"], 12);
  assert.equal(llm.attributes["neatlogs.llm.token_count.completion"], 3);
  assert.equal(llm.attributes["neatlogs.llm.token_count.total"], 15);
  assert.equal(llm.attributes["ticketstub.costUsd"], 0.001);
  assert.equal(llm.attributes["neatlogs.llm.cost_usd"], 0.001);
  assert.ok(llm.start >= root.start && llm.end <= root.end + 1_000_000n, "child inside root");
  assert.equal(marker.parent, root.spanId);
  assert.equal(marker.attributes["neatlogs.trace.complete"], true);
  assert.equal(root.attributes["neatlogs.tags"], "ticketstub,ticketstub@0f9baa5");
  assert.equal(neatlogsStats().accepted, 1);
  assert.equal(sinkInstance.pendingOperations(), 0);
});

test("a provider failure is an error span with its code, and the response is unchanged", async () => {
  liveAgent();
  const sent = [];
  setOpsSink(neatlogsSink({ config: { apiKey: KEY, endpoint: "https://ingest.neatlogs.com", tags: ["ticketstub"] },
    fetchImpl: async (_u, init) => { sent.push(init); return new Response(null, { status: 200 }); } }));
  globalThis.fetch = async () => new Response("{}", { status: 429 });
  const res = await agent.POST(req({ event, message: "Hello?" }));
  await new Promise((r) => setTimeout(r, 0));
  const { spans } = decode(Buffer.from(sent[0].body));
  const llm = spans.find((s) => s.attributes["neatlogs.span.kind"] === "LLM");
  assert.equal(llm.statusCode, 2);
  assert.equal(llm.attributes["neatlogs.error.message"], "provider_rate_limited");
  assert.equal(llm.attributes["ticketstub.upstreamStatus"], 429);
  assert.equal(llm.attributes["neatlogs.llm.cost_usd"], undefined, "no reported cost, no cost attribute");
  const root = spans.find((s) => !s.parent);
  assert.equal(root.attributes["ticketstub.status"], res.status);
});

test("export failures are counted and never reach the request", async () => {
  liveAgent();
  setOpsSink(neatlogsSink({ config: { apiKey: KEY, endpoint: "https://ingest.neatlogs.com", tags: ["ticketstub"] }, fetchImpl: async () => { throw new TypeError("network down"); } }));
  globalThis.fetch = async () => Response.json(textResponse);
  const res = await agent.POST(req({ event, message: "Hello?" }));
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(neatlogsStats().failed, 1);
  assert.equal(opsStats().sinkErrors, 0, "the sink isolates its own network failure");
  setOpsSink(neatlogsSink({ config: { apiKey: KEY, endpoint: "https://ingest.neatlogs.com", tags: ["ticketstub"] }, fetchImpl: async () => new Response("no", { status: 401 }) }));
  await agent.POST(req({ event, message: "Hello?" }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(neatlogsStats().failed, 2);
});

test("receiver responses: empty is success, partial success is surfaced, garbage is unknown", () => {
  assert.equal(rejectedSpans(new Uint8Array(0), "application/x-protobuf"), 0);
  // ExportTraceServiceResponse { partial_success { rejected_spans: 2 } }
  assert.equal(rejectedSpans(Uint8Array.from([0x0a, 0x02, 0x08, 0x02]), "application/x-protobuf"), 2);
  assert.equal(rejectedSpans(Buffer.from('{"partialSuccess":{"rejectedSpans":"3"}}'), "application/json"), 3);
  assert.equal(rejectedSpans(Buffer.from("{}"), "application/json"), 0);
  assert.equal(rejectedSpans(Uint8Array.from([0x0a, 0x09]), "application/x-protobuf"), -1);
});

test("open operations are bounded and a trace without a closing event is never sent", () => {
  const at = Date.now();
  assert.equal(buildTrace([{ schema: "ticketstub.ops/1", name: "provider_attempt", at, environment: "test", mode: "live", operationId: "op_AAAAAAAAAAAAAAAA", fields: {} }], ["ticketstub"]), undefined);
  const s = neatlogsSink({ config: { apiKey: KEY, endpoint: "https://ingest.neatlogs.com", tags: ["ticketstub"] }, fetchImpl: async () => assert.fail("sent") });
  for (let n = 0; n < 250; n++) s.write({ schema: "ticketstub.ops/1", name: "source_fetch", at, environment: "test", mode: "live", operationId: `op_${String(n).padStart(16, "A")}`, fields: { source: "event_page", outcome: "ok" } });
  assert.ok(s.pendingOperations() <= 200);
  assert.ok(neatlogsStats().dropped >= 50);
  const body = encodeTrace("0123456789abcdef0123456789abcdef", [], ["ticketstub"]);
  assert.ok(body.length > 0);
});

test("a busy operation is truncated, not lost: the closing event always exports", async () => {
  const at = Date.now();
  const sent = [];
  const s = neatlogsSink({ config: { apiKey: KEY, endpoint: "https://ingest.neatlogs.com", tags: ["ticketstub"] }, fetchImpl: async (_u, init) => { sent.push(init); return new Response(null, { status: 200 }); } });
  const op = "op_BBBBBBBBBBBBBBBB";
  for (let n = 0; n < 70; n++) s.write({ schema: "ticketstub.ops/1", name: "source_fetch", at, environment: "test", mode: "live", operationId: op, fields: { source: "event_page", outcome: "no_match", durationMs: 1 } });
  await s.write({ schema: "ticketstub.ops/1", name: "api_request", at, environment: "test", mode: "live", operationId: op, fields: { route: "research", status: 200, outcome: "success", durationMs: 5 } });
  assert.equal(sent.length, 1);
  assert.equal(s.pendingOperations(), 0);
  const { spans } = decode(Buffer.from(sent[0].body));
  assert.equal(spans.filter((x) => x.name === "source.event_page").length, 64);
  assert.ok(spans.filter((x) => x.name === "source.event_page").every((x) => x.statusCode === 1), "no_match is not an error");
});

test("quoted settings are accepted and problems are explained without values", async () => {
  const { neatlogsConfigProblem, resetNeatlogsNotes } = await import("../src/server/observability/neatlogs.ts");
  assert.equal(neatlogsConfig({ NEATLOGS_API_KEY: `"${KEY}"`, NEATLOGS_ENDPOINT: "'https://ingest.neatlogs.com'" }).apiKey, KEY);
  assert.equal(neatlogsConfigProblem({}), "NEATLOGS_API_KEY is not set");
  assert.match(neatlogsConfigProblem({ NEATLOGS_API_KEY: KEY, NEATLOGS_ENDPOINT: "https://ingest.neatlogs.com/v1/traces" }), /NEATLOGS_ENDPOINT must be/);
  assert.equal(neatlogsConfigProblem({ NEATLOGS_API_KEY: KEY }), undefined);
  // The configuration warning is logged once and never contains the key.
  resetNeatlogsNotes();
  const lines = [];
  const warn = console.warn; console.warn = (l) => lines.push(l);
  try {
    process.env.TICKETSTUB_OPS_TELEMETRY = "neatlogs";
    process.env.NEATLOGS_API_KEY = KEY;
    process.env.NEATLOGS_ENDPOINT = "https://collector.example";
    activeSink(); activeSink();
  } finally { console.warn = warn; }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[ops\] neatlogs: requested but not configured: NEATLOGS_ENDPOINT/);
  assert.ok(!lines.join("").includes(KEY));
});

test("export outcomes are logged once per kind with status only", async () => {
  const { resetNeatlogsNotes } = await import("../src/server/observability/neatlogs.ts");
  resetNeatlogsNotes();
  liveAgent();
  const lines = [];
  const warn = console.warn, info = console.info;
  console.warn = (l) => lines.push(l); console.info = (l) => lines.push(l);
  try {
    setOpsSink(neatlogsSink({ config: { apiKey: KEY, endpoint: "https://ingest.neatlogs.com", tags: ["ticketstub"] }, fetchImpl: async () => new Response("denied", { status: 401 }) }));
    globalThis.fetch = async () => Response.json(textResponse);
    await agent.POST(req({ event, message: "Hello?" })); await agent.POST(req({ event, message: "Hello?" }));
    await new Promise((r) => setTimeout(r, 0));
    setOpsSink(neatlogsSink({ config: { apiKey: KEY, endpoint: "https://ingest.neatlogs.com", tags: ["ticketstub"] }, fetchImpl: async () => new Response(null, { status: 200 }) }));
    await agent.POST(req({ event, message: "Hello?" }));
    await new Promise((r) => setTimeout(r, 0));
  } finally { console.warn = warn; console.info = info; }
  assert.equal(lines.filter((l) => l.includes("HTTP 401")).length, 1, "401 noted once");
  assert.ok(lines.some((l) => l === "[ops] neatlogs: export accepted (HTTP 200)"));
  assert.ok(!lines.join("").includes(KEY) && !lines.join("").includes("denied"));
});
