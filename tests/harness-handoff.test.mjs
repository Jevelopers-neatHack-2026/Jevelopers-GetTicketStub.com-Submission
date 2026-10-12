import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// The agent-harness hand-off, fully offline: recordEvent -> exportToHarness -> the vendored harness outbox -> a fake
// Neatlogs ingest that captures the protobuf body, which is checked here for what would leave the process.
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

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "ticketstub-harness-"));
process.env.TICKETSTUB_DB = join(scratch, "app.sqlite");
process.env.TICKETSTUB_FILES = join(scratch, "files");
for (const name of ["TICKETSTUB_HARNESS_EXPORT", "TICKETSTUB_HARNESS_DB", "AGENT_HARNESS_TELEMETRY_KEY", "NEATLOGS_API_KEY", "NEATLOGS_TOKEN", "NEATLOGS_PROJECT_ID", "NEATLOGS_ENDPOINT", "NEATLOGS_HOST"]) {
  delete process.env[name];
}

const { exportToHarness, sanitizeEvent, refOf } = await import("../src/server/events.ts");
const { recordEvent } = await import("../src/server/event-log.ts");
const harness = await import("../src/server/harness-export.ts");
const { VENDORED_FILES } = await import("../scripts/vendor-agent-harness.mjs");

const KEY_HEX = "5e".repeat(32);
const INGEST = "offline-ingest-key-0123456789";
const originalEnv = { ...process.env };
afterEach(async () => {
  process.env = { ...originalEnv };
  await harness.resetHarnessExport();
});

function fakeIngest() {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    assert.equal(new URL(url).origin, "https://ingest.neatlogs.com");
    assert.equal(init.headers["x-api-key"], INGEST);
    bodies.push(Buffer.from(init.body));
    return new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "application/x-protobuf" } });
  };
  return { fetchImpl, bodies };
}

function enable(extra = {}) {
  Object.assign(process.env, {
    TICKETSTUB_HARNESS_EXPORT: "neatlogs",
    AGENT_HARNESS_TELEMETRY_KEY: `"${KEY_HEX}"`, // host settings are often pasted quoted
    NEATLOGS_API_KEY: INGEST,
    TICKETSTUB_COMMIT_SHA: "abcdef1",
    TICKETSTUB_OPS_ENVIRONMENT: "test",
    ...extra,
  });
}

test("the vendored harness files match MANIFEST.json and the pinned commit's file list", () => {
  const dir = join(ROOT, "src", "server", "vendor", "agent-harness");
  const manifest = JSON.parse(readFileSync(join(dir, "MANIFEST.json"), "utf8"));
  assert.match(manifest.commit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.repository, "https://github.com/Jevelopers-neatHack-2026/agent-harness");
  assert.deepEqual(Object.keys(manifest.files).sort(), [...VENDORED_FILES].sort());
  for (const [file, sha] of Object.entries(manifest.files)) {
    const actual = createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
    assert.equal(actual, sha, `${file} differs from agent-harness@${manifest.commit.slice(0, 7)}; re-run scripts/vendor-agent-harness.mjs`);
  }
});

test("off by default: nothing is loaded, stored or sent", async () => {
  const outbox = harness.harnessOutboxPath();
  await exportToHarness([sanitizeEvent({ type: "art_requested", fields: { first: true } })]);
  assert.equal(harness.harnessExportEnabled(), false);
  assert.equal(existsSync(outbox), false);
  assert.deepEqual(harness.harnessExportStatus(), { enabled: false, problem: 'TICKETSTUB_HARNESS_EXPORT is not "neatlogs"' });
});

test("switched on without its settings, it says which one is missing and does nothing else", async () => {
  enable({ AGENT_HARNESS_TELEMETRY_KEY: "" });
  assert.equal(harness.harnessExportProblem(), "AGENT_HARNESS_TELEMETRY_KEY is not set");
  enable({ NEATLOGS_API_KEY: "" });
  assert.equal(harness.harnessExportProblem(), "NEATLOGS_API_KEY is not set");
  enable({ AGENT_HARNESS_TELEMETRY_KEY: "too-short" });
  const warnings = [];
  const warn = console.warn;
  console.warn = (line) => warnings.push(String(line));
  try {
    await exportToHarness([sanitizeEvent({ type: "art_requested", fields: { first: true } })]);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, ["[harness] export could not start (INVALID_TELEMETRY_KEY)"]);
  assert.equal(warnings.join("").includes("too-short"), false);
  assert.equal(existsSync(harness.harnessOutboxPath()), false);
});

test("the outbox lives next to TICKETSTUB_DB unless TICKETSTUB_HARNESS_DB names it", () => {
  assert.equal(harness.harnessOutboxPath(), join(scratch, "agent-harness-outbox.sqlite"));
  assert.equal(harness.harnessOutboxPath({ TICKETSTUB_HARNESS_DB: "/private/x.sqlite", TICKETSTUB_DB: "/private/app.sqlite" }), "/private/x.sqlite");
  assert.equal(harness.harnessOutboxPath({}), undefined);
});

test("recordEvent hands the event to the harness, which delivers tokens, never the request id or refs", async () => {
  const ingest = fakeIngest();
  await harness.resetHarnessExport(ingest.fetchImpl);
  enable();
  const requestId = "smoke-harness-0123456789";
  const req = new Request("http://localhost/api/art", { method: "POST", headers: { "x-request-id": requestId } });
  await recordEvent(req, "art_requested", { first: true }, { project: "stub-private-id-1" });
  await recordEvent(req, "art_ready", { provider: "procedural" }, { project: "stub-private-id-1" });
  // The hand-off is never awaited by recordEvent; give its dynamic import a turn.
  for (let i = 0; i < 50 && (harness.harnessExportStatus().counters?.accepted ?? 0) < 2; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const before = harness.harnessExportStatus();
  assert.equal(before.enabled, true);
  assert.equal(before.counters.accepted, 2);
  assert.equal(before.outbox.counts.queued, 2);
  assert.deepEqual([...before.tags], ["ticketstub", "ticketstub@abcdef1", "environment:test"]);
  assert.equal(before.readback, false);

  const drain = await harness.drainHarnessExport();
  assert.equal(drain.sent, 2);
  assert.equal(ingest.bodies.length, 1);
  const after = harness.harnessExportStatus();
  assert.equal(after.outbox.counts.sent, 2, "accepted by the receiver, awaiting readback; never claimed as delivered");
  assert.equal(after.outbox.counts.verified, 0);

  const wire = ingest.bodies[0].toString("latin1");
  assert.ok(wire.includes("agent-harness.ticketstub-events"));
  assert.ok(wire.includes('"type":"art_requested"'));
  for (const raw of [requestId, refOf("stub-private-id-1"), "stub-private-id-1", KEY_HEX, INGEST]) {
    assert.equal(wire.includes(raw), false, `the wire body must not contain ${raw.slice(0, 10)}…`);
  }
  const statusText = JSON.stringify(after);
  for (const raw of [KEY_HEX, INGEST, requestId]) assert.equal(statusText.includes(raw), false);
});

test("the same event handed off twice is stored once", async () => {
  await harness.resetHarnessExport(fakeIngest().fetchImpl);
  enable();
  const ev = sanitizeEvent({ type: "share_created", requestId: "dup-request-0001", fields: { share: refOf("s") } });
  await exportToHarness([ev]);
  await exportToHarness([ev]);
  const status = harness.harnessExportStatus();
  assert.equal(status.counters.accepted, 1);
  assert.equal(status.counters.duplicates, 1);
});
