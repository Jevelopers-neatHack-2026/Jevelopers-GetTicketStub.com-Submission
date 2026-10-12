// Where sanitized operational events go. Collection is off unless TICKETSTUB_OPS_TELEMETRY names a sink.
//
//   TICKETSTUB_OPS_TELEMETRY=off   (default; also any unknown value) — nothing is built or written
//   TICKETSTUB_OPS_TELEMETRY=log   — one JSON line per event on stdout, prefixed by nothing, schema ticketstub.ops/1
//   TICKETSTUB_OPS_TELEMETRY=neatlogs      — one Neatlogs trace per operation (needs NEATLOGS_INGEST_KEY; see neatlogs.ts)
//   TICKETSTUB_OPS_TELEMETRY=log,neatlogs  — both
//
// The log sink relies on the host's log pipeline for retention (see docs/operations/observability.md). The
// Neatlogs sink is the only network path, and it is off unless both the setting and the key are present. Tests
// install the in-memory collector with setOpsSink.
import { createHash } from "node:crypto";
import { neatlogsConfig, neatlogsConfigProblem, neatlogsSink, noteOnce } from "./neatlogs";
import { OPS_ENVIRONMENTS, type OpsEnvironment, type OpsEvent } from "./schema";

export interface OpsSink {
  readonly name: string;
  /** May throw or reject: the caller isolates every failure from the request. */
  write(event: OpsEvent): void | Promise<void>;
}

/** Structured stdout lines: the event is already sanitized, so it is written as is and nothing else is added. */
export const logSink: OpsSink = {
  name: "log",
  write(event) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  },
};

export interface MemoryCollector extends OpsSink {
  readonly events: OpsEvent[];
  clear(): void;
}

/** Offline collector for tests and local inspection: keeps the newest `limit` events in process memory. */
export function memoryCollector(limit = 1000): MemoryCollector {
  const events: OpsEvent[] = [];
  return {
    name: "memory",
    events,
    write(event) {
      events.push(event);
      if (events.length > limit) events.splice(0, events.length - limit);
    },
    clear() {
      events.length = 0;
    },
  };
}

const g = globalThis as unknown as { __ticketstubOpsSink?: OpsSink | null; __ticketstubNeatlogs?: { id: string; sink: OpsSink } };

/** One Neatlogs sink per process and configuration, because it holds each open operation's events until it closes. */
function neatlogs(): OpsSink | undefined {
  const config = neatlogsConfig();
  if (!config) {
    noteOnce("config", `requested but not configured: ${neatlogsConfigProblem() ?? "unknown reason"}`);
    return undefined;
  }
  const id = createHash("sha256").update(`${config.endpoint}|${config.tags.join(",")}|${config.apiKey}`).digest("hex").slice(0, 16);
  if (g.__ticketstubNeatlogs?.id !== id) g.__ticketstubNeatlogs = { id, sink: neatlogsSink({ config }) };
  return g.__ticketstubNeatlogs.sink;
}

/** Writes to every sink; one sink failing never stops the others (the caller counts the failure). */
function fanOut(sinks: OpsSink[]): OpsSink {
  return {
    name: sinks.map((s) => s.name).join(","),
    write(event) {
      let failed: unknown;
      const pending: Promise<void>[] = [];
      for (const s of sinks) {
        try {
          const r = s.write(event);
          if (r && typeof (r as Promise<void>).then === "function") pending.push(r as Promise<void>);
        } catch (e) {
          failed = e;
        }
      }
      if (failed !== undefined) {
        for (const p of pending) p.catch(() => {}); // the caller counts the failure once; no stray rejections
        throw failed;
      }
      return pending.length ? Promise.all(pending).then(() => undefined) : undefined;
    },
  };
}

/** Replaces the configured sink (tests). `null` forces collection off; `undefined` returns to configuration. */
export function setOpsSink(sink: OpsSink | null | undefined): void {
  if (sink === undefined) delete g.__ticketstubOpsSink;
  else g.__ticketstubOpsSink = sink;
}

/** Logs, once per distinct setting, which sinks were selected: only known sink names and the setting's length. */
const selectionsNoted = new Set<string>();
/** Tests: forget which selections were already noted. */
export const resetSelectionNotes = (): void => selectionsNoted.clear();
function noteSelection(wanted: Set<string>, sinks: OpsSink[], rawLength: number): void {
  const requested = ["log", "neatlogs"].filter((s) => wanted.has(s));
  const unknown = [...wanted].filter((s) => s !== "log" && s !== "neatlogs" && s !== "off").length;
  const key = `${requested.join(",")}|${unknown}|${sinks.map((s) => s.name).join(",")}`;
  if (selectionsNoted.has(key) || (requested.length === 0 && unknown === 0)) return;
  selectionsNoted.add(key);
  console.info(`[ops] telemetry sinks: ${sinks.map((s) => s.name).join(",") || "none"} (requested: ${requested.join(",") || "none"}; unrecognised entries: ${unknown}; setting length: ${rawLength})`);
}

/** The active sink, or undefined when collection is off. Read per operation so a restart is not needed in tests. */
export function activeSink(): OpsSink | undefined {
  if (g.__ticketstubOpsSink !== undefined) return g.__ticketstubOpsSink ?? undefined;
  const raw = process.env.TICKETSTUB_OPS_TELEMETRY ?? "";
  // Entries are separated by commas or semicolons only; each entry is trimmed and may be quoted. A sink name inside a
  // longer entry ("neatlogs disabled", "log off") is an unrecognised entry, so it never turns that sink on.
  const wanted = new Set(raw.toLowerCase().split(/[,;]/).map((v) => v.trim().replace(/^["']+|["']+$/g, "").trim()).filter(Boolean));
  if (wanted.has("off")) return undefined; // an explicit "off" entry wins over anything listed with it
  const sinks: OpsSink[] = [];
  if (wanted.has("log")) sinks.push(logSink);
  if (wanted.has("neatlogs")) {
    const n = neatlogs();
    if (n) sinks.push(n);
  }
  noteSelection(wanted, sinks, raw.length);
  return sinks.length === 0 ? undefined : sinks.length === 1 ? sinks[0] : fanOut(sinks);
}

export function opsEnvironment(): OpsEnvironment {
  const v = process.env.TICKETSTUB_OPS_ENVIRONMENT?.trim().toLowerCase();
  return (OPS_ENVIRONMENTS as readonly string[]).includes(v ?? "") ? (v as OpsEnvironment) : "unspecified";
}
