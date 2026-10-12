// Hand-off of product events (ticketstub.event/1) to the agent-harness, which records them in its durable Neatlogs
// outbox and delivers them as traces. Off unless TICKETSTUB_HARNESS_EXPORT=neatlogs, and then only when the
// tokenization key, the Neatlogs ingest key and a durable outbox path are all available.
//
// The harness code is vendored, byte for byte, from one pinned agent-harness commit (src/server/vendor/agent-harness,
// see MANIFEST.json and scripts/vendor-agent-harness.mjs); the harness repo owns it. It re-validates every event
// against its own copy of the contract, replaces the request id and refs with HMAC tokens under
// AGENT_HARNESS_TELEMETRY_KEY, and sends nothing inline: `accept` is one local SQLite write, and delivery, retry,
// readback and recovery run in a background drain. A failure here never reaches the request that recorded the event.
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import {
  createTicketstubHarnessExporter,
  type TicketstubHarnessExporter,
} from "./vendor/agent-harness/src/integrations/ticketstub/index.js";
import type { TicketstubEvent } from "./events";

const SETTING = "TICKETSTUB_HARNESS_EXPORT";
const PASSED_NAMES = [
  "AGENT_HARNESS_TELEMETRY_KEY",
  "NEATLOGS_API_KEY",
  "NEATLOGS_TOKEN",
  "NEATLOGS_PROJECT_ID",
  "NEATLOGS_ENDPOINT",
  "NEATLOGS_HOST",
] as const;
const ENVIRONMENTS = ["production", "preview", "development", "test"];
const OUTBOX_FILE = "agent-harness-outbox.sqlite";

/** Host settings are often pasted with surrounding quotes; strip one matching pair, nothing else. */
const unquote = (v: string | undefined) => v?.trim().replace(/^(["'])(.*)\1$/, "$2").trim() ?? "";

export function harnessExportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return unquote(env[SETTING]).toLowerCase() === "neatlogs";
}

/** The outbox file: TICKETSTUB_HARNESS_DB, or next to TICKETSTUB_DB so it shares the durable mount. */
export function harnessOutboxPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = unquote(env.TICKETSTUB_HARNESS_DB);
  if (explicit) return explicit;
  const db = unquote(env.TICKETSTUB_DB);
  return db ? join(dirname(db), OUTBOX_FILE) : undefined;
}

/** Why export cannot run, in words safe to log (never a value), or undefined when it can. */
export function harnessExportProblem(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!harnessExportEnabled(env)) return `${SETTING} is not "neatlogs"`;
  if (!unquote(env.AGENT_HARNESS_TELEMETRY_KEY)) return "AGENT_HARNESS_TELEMETRY_KEY is not set";
  if (!unquote(env.NEATLOGS_API_KEY)) return "NEATLOGS_API_KEY is not set";
  if (!harnessOutboxPath(env)) return "no durable path: set TICKETSTUB_DB or TICKETSTUB_HARNESS_DB";
  return undefined;
}

function tagsFrom(env: NodeJS.ProcessEnv): string[] {
  const tags: string[] = [];
  const commit = unquote(env.TICKETSTUB_COMMIT_SHA).toLowerCase();
  if (/^[0-9a-f]{7,40}$/.test(commit)) tags.push(`ticketstub@${commit}`);
  const environment = unquote(env.TICKETSTUB_OPS_ENVIRONMENT).toLowerCase();
  if (ENVIRONMENTS.includes(environment)) tags.push(`environment:${environment}`);
  return tags;
}

const g = globalThis as unknown as {
  __ticketstubHarness?: { id: string; exporter: TicketstubHarnessExporter };
  __ticketstubHarnessNotes?: Set<string>;
  __ticketstubHarnessFetch?: typeof fetch;
};

function note(kind: string, line: string, level: "info" | "warn" = "warn"): void {
  const noted = (g.__ticketstubHarnessNotes ??= new Set());
  if (noted.has(kind)) return;
  noted.add(kind);
  (level === "info" ? console.info : console.warn)(`[harness] ${line}`);
}

/** One exporter per process and configuration. Its creation errors carry a code, never a value. */
function exporter(env: NodeJS.ProcessEnv = process.env): TicketstubHarnessExporter | undefined {
  const problem = harnessExportProblem(env);
  if (problem) {
    if (harnessExportEnabled(env)) note("config", `export requested but not configured: ${problem}`);
    return undefined;
  }
  const passed: Record<string, string> = {};
  for (const name of PASSED_NAMES) {
    const value = unquote(env[name]);
    if (value) passed[name] = value;
  }
  const databasePath = harnessOutboxPath(env)!;
  const tags = tagsFrom(env);
  const id = createHash("sha256").update(JSON.stringify([passed, databasePath, tags])).digest("hex").slice(0, 16);
  if (g.__ticketstubHarness?.id === id) return g.__ticketstubHarness.exporter;
  const previous = g.__ticketstubHarness?.exporter;
  delete g.__ticketstubHarness;
  void previous?.close().catch(() => {});
  try {
    const created = createTicketstubHarnessExporter({
      env: passed,
      databasePath,
      tags,
      ...(g.__ticketstubHarnessFetch ? { fetch: g.__ticketstubHarnessFetch } : {}),
    });
    g.__ticketstubHarness = { id, exporter: created };
    const readback = created.summary.neatlogs.readbackReady ? "on" : "off (no NEATLOGS_TOKEN/NEATLOGS_PROJECT_ID)";
    note("on", `export on: workflow ${created.summary.workflowName}, readback ${readback}`, "info");
    // Resume anything a previous process left queued or awaiting readback.
    created.scheduleDrain();
    return created;
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    note("create", `export could not start (${typeof code === "string" ? code : "error"})`);
    return undefined;
  }
}

/** Gives events to the harness outbox. Never throws and never waits for the network. */
export function handOff(events: readonly TicketstubEvent[]): void {
  if (events.length === 0) return;
  try {
    const target = exporter();
    if (!target) return;
    const result = target.accept(events);
    if (result.invalid > 0) note("invalid", `harness refused ${result.invalid} event(s) outside ticketstub.event/1`);
    if (result.refused > 0) note("full", "harness outbox is full; events were dropped");
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    note("accept", `hand-off failed (${typeof code === "string" ? code : "error"})`);
  }
}

/** Counts and trace ids only (no event content): for the staff status route and tests. */
export function harnessExportStatus(env: NodeJS.ProcessEnv = process.env) {
  const problem = harnessExportProblem(env);
  if (problem) return { enabled: false as const, problem };
  const target = exporter(env);
  if (!target) return { enabled: false as const, problem: "export could not start (see server log)" };
  return { enabled: true as const, workflowName: target.summary.workflowName, tags: target.summary.tags, readback: target.summary.neatlogs.readbackReady === true, ...target.status() };
}

/** Runs one drain now (tests and the staff status route). */
export async function drainHarnessExport(env: NodeJS.ProcessEnv = process.env) {
  return (await exporter(env)?.drain()) ?? null;
}

/** Tests: replace the network, and drop the cached exporter so the next call reads settings again. */
export async function resetHarnessExport(fetchImpl?: typeof fetch): Promise<void> {
  const current = g.__ticketstubHarness?.exporter;
  delete g.__ticketstubHarness;
  g.__ticketstubHarnessNotes?.clear();
  if (fetchImpl) g.__ticketstubHarnessFetch = fetchImpl;
  else delete g.__ticketstubHarnessFetch;
  await current?.close();
}
