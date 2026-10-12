import "server-only";
import type { DatabaseSync } from "node:sqlite";
import {
  ProdigiCallbackReconciler,
  type ProdigiReadLimiter,
} from "../vendor/fulfillment-connectors/dist/prodigi-callbacks.js";
import {
  ProdigiSandboxClient,
  createFetchProdigiHttpPort,
  type ProdigiHttpPort,
} from "../vendor/fulfillment-connectors/dist/prodigi-sandbox.js";
import { createEnvServerSecretSource, PRODIGI_SANDBOX_SECRET_BINDING } from "../vendor/fulfillment-connectors/dist/prodigi-secrets.js";
import type { SandboxDecisionVerifier } from "../vendor/fulfillment-connectors/dist/provider-matrix.js";
import type { ServerSecretSource } from "../vendor/fulfillment-connectors/dist/security.js";
import { openDatabase } from "../sqlite";
import { dbPath } from "../index";
import {
  CALLBACK_TOKEN_BINDING,
  CALLBACK_TOKEN_PREVIOUS_BINDING,
  PRODIGI_SANDBOX_DECISION,
  PRODIGI_SCOPE,
  prodigiCallbackMode,
} from "./prodigi-config";
import { migrateProdigi } from "./prodigi-migrations";
import { abandonAlertHook, ProdigiJobWorker, SqliteProdigiJobQueue } from "./prodigi-jobs";
import { SqliteProdigiStore } from "./prodigi-store";

// Assembles the getticketstub side of Prodigi sandbox callbacks: the vendored ProdigiCallbackReconciler over the
// durable SQLite store and job queue, the abandon hook, and the worker loop. It exists only while
// TICKETSTUB_PRODIGI_CALLBACKS=sandbox; otherwise prodigiCallbackHost() is null and nothing is opened or read.

/** Raw body cap for the route and the reconciler (the reconciler's default, 512 KiB). */
export const PRODIGI_CALLBACK_MAX_BODY_BYTES = 512 * 1024;

/**
 * Fails closed: no owner decision is verified, so every sandbox read (and order) is refused as
 * decision_unverified before a credential is loaded or a request is built. 0003 blocker 5 replaces this with a
 * verifier that resolves the 0003 record.
 */
export const UNVERIFIED_DECISION: SandboxDecisionVerifier = Object.freeze({ verify: async () => undefined });

export interface ProdigiHostOptions {
  readonly db: DatabaseSync;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly http?: ProdigiHttpPort;
  readonly decisionVerifier?: SandboxDecisionVerifier;
  readonly clock?: { now(): number };
  readonly random?: () => number;
  readonly readLimiter?: ProdigiReadLimiter;
  readonly workerId?: string;
  readonly leaseMs?: number;
  readonly log?: (line: string) => void;
  /** Passed through to the reconciler (tests shorten these). */
  readonly reconciler?: { minReadIntervalMs?: number; requestDeadlineMs?: number; workerClockSkewMs?: number; jobRetryPolicy?: { initialDelayMs?: number; maxDelayMs?: number; maxAttempts?: number; horizonMs?: number } };
}

export interface ProdigiHost {
  readonly db: DatabaseSync;
  readonly store: SqliteProdigiStore;
  readonly queue: SqliteProdigiJobQueue;
  readonly reconciler: ProdigiCallbackReconciler;
  readonly worker: ProdigiJobWorker;
  readonly secrets: ServerSecretSource;
  readonly maxBodyBytes: number;
  close(): void;
}

export function prodigiSecretSource(env?: Readonly<Record<string, string | undefined>>): ServerSecretSource {
  return createEnvServerSecretSource({
    bindings: [PRODIGI_SANDBOX_SECRET_BINDING, CALLBACK_TOKEN_BINDING, CALLBACK_TOKEN_PREVIOUS_BINDING],
    ...(env ? { env } : {}),
  });
}

/** Builds a host on `db`. Always sandbox: the reconciler itself refuses any other mode. */
export function createProdigiHost(options: ProdigiHostOptions): ProdigiHost {
  const { db } = options;
  migrateProdigi(db);
  const clock = options.clock ?? { now: () => Date.now() };
  const log = options.log;
  const store = new SqliteProdigiStore(db, { clock });
  const queue = new SqliteProdigiJobQueue(db, { clock, ...(options.leaseMs ? { leaseMs: options.leaseMs } : {}) });
  const secrets = prodigiSecretSource(options.env);
  // The reader for authenticated reads. Sandbox calls are permitted at this layer, but every call still needs the
  // verified owner decision (UNVERIFIED_DECISION refuses) and the sandbox API key.
  const reader = new ProdigiSandboxClient({
    http: options.http ?? createFetchProdigiHttpPort(),
    secrets,
    decision: PRODIGI_SANDBOX_DECISION,
    decisionVerifier: options.decisionVerifier ?? UNVERIFIED_DECISION,
    sandboxCallsEnabled: true,
  });
  const reconciler = new ProdigiCallbackReconciler({
    mode: "sandbox",
    trustedScope: PRODIGI_SCOPE,
    reader,
    store,
    callbacksEnabled: true,
    secrets,
    callbackTokenReference: CALLBACK_TOKEN_BINDING.reference,
    previousCallbackTokenReference: CALLBACK_TOKEN_PREVIOUS_BINDING.reference,
    maxBodyBytes: PRODIGI_CALLBACK_MAX_BODY_BYTES,
    scheduler: queue,
    onReconcileAbandoned: abandonAlertHook(db, queue, { clock, ...(log ? { log } : {}) }),
    clock,
    ...(options.random ? { random: options.random } : {}),
    ...(options.readLimiter ? { readLimiter: options.readLimiter } : {}),
    ...(options.reconciler ?? {}),
  });
  const worker = new ProdigiJobWorker({ db, queue, reconciler, clock, ...(options.workerId ? { workerId: options.workerId } : {}), ...(log ? { log } : {}) });
  return {
    db, store, queue, reconciler, worker, secrets,
    maxBodyBytes: PRODIGI_CALLBACK_MAX_BODY_BYTES,
    close() {
      worker.stop();
      reconciler.close();
    },
  };
}

// ---- process singleton ----

const g = globalThis as unknown as { __ticketstubProdigiHost?: ProdigiHost | null; __ticketstubProdigiRefusalLogged?: boolean };

/**
 * The process's host, or null when callbacks are off. Opens its own connection to TICKETSTUB_DB (WAL, so it
 * shares the file safely with the storage connection) and starts the worker loop. Throws if the database cannot
 * be opened; the route answers 503.
 */
export function prodigiCallbackHost(): ProdigiHost | null {
  const mode = prodigiCallbackMode();
  if (mode.state !== "sandbox") {
    if (mode.state === "refused" && !g.__ticketstubProdigiRefusalLogged) {
      g.__ticketstubProdigiRefusalLogged = true;
      console.warn(`[prodigi] TICKETSTUB_PRODIGI_CALLBACKS=${mode.value === "live" ? "live is refused (sandbox only)" : "<unrecognized> is treated as off"}; callbacks stay off`);
    }
    return null;
  }
  if (g.__ticketstubProdigiHost) return g.__ticketstubProdigiHost;
  const host = createProdigiHost({ db: openDatabase(dbPath()) });
  host.worker.start();
  g.__ticketstubProdigiHost = host;
  console.log("[prodigi] sandbox callbacks on; job worker started");
  return host;
}

/** Starts the worker at boot (instrumentation), so queued jobs resume after a restart without waiting for a callback. */
export function startProdigiCallbackWorker(): void {
  try {
    prodigiCallbackHost();
  } catch (e) {
    console.error("[prodigi] callback worker not started:", e instanceof Error ? e.message : "unknown");
  }
}

/** Tests only: drop the singleton. */
export function resetProdigiCallbackHost(): void {
  g.__ticketstubProdigiHost?.close();
  g.__ticketstubProdigiHost = undefined;
  g.__ticketstubProdigiRefusalLogged = undefined;
}
