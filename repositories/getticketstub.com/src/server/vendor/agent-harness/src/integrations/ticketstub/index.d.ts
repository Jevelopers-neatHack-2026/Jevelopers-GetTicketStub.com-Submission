export const TICKETSTUB_EVENT_SCHEMA: 'ticketstub.event/1';
export const TICKETSTUB_INTAKE_SCHEMA: 'agent-harness.ticketstub-intake.v1';
export const HARNESS_TELEMETRY_KEY_NAME: 'AGENT_HARNESS_TELEMETRY_KEY';

export type TicketstubFieldKind = 'ref' | 'code' | 'count' | 'ts' | 'flag' | readonly string[];
export const TICKETSTUB_EVENT_SPEC: Readonly<Record<string, Readonly<Record<string, TicketstubFieldKind>>>>;

export interface TicketstubEventInput {
  schema: 'ticketstub.event/1';
  type: string;
  at: number;
  requestId: string;
  actor: 'account' | 'guest' | 'anonymous';
  actorRef?: string;
  projectRef?: string;
  mode: 'sandbox' | 'live';
  fields: Record<string, string | number | boolean>;
}

export type TicketstubIntakeErrorCode =
  | 'INVALID_EVENT'
  | 'UNSUPPORTED_SCHEMA'
  | 'INVALID_TELEMETRY_KEY'
  | 'TOKENIZE_FAILED'
  | 'MISSING_ENV'
  | 'MISSING_INGEST_KEY'
  | 'INVALID_OPTION'
  | 'INVALID_BATCH'
  | 'CLOSED';

export class TicketstubIntakeError extends Error {
  readonly code: TicketstubIntakeErrorCode;
}

export function validateTicketstubEvent(event: unknown): Readonly<TicketstubEventInput>;
export function parseHarnessTelemetryKey(value: unknown): Buffer;
export function createTicketstubTokenizer(keyBytes: Buffer): (kind: string, value: string) => string;
export function ticketstubOutboxEntry(event: unknown, tokenize: (kind: string, value: string) => string): Readonly<{
  eventToken: string;
  workflowName: string;
  sessionId: string;
  eventType: string;
  input: string;
  attributes: ReadonlyArray<readonly [string, string | number | boolean]>;
  occurredAtMs: number;
}>;

export interface TicketstubAcceptResult {
  readonly accepted: number;
  readonly duplicates: number;
  readonly refused: number;
  readonly invalid: number;
}

export interface NeatlogsDrainSummary {
  readonly leased: boolean;
  readonly sent: number;
  readonly sendRequests: number;
  readonly retried: number;
  readonly failed: number;
  readonly verified: number;
  readonly regenerated: number;
  readonly waiting: number;
  readonly readbackStatus: string | null;
  readonly sendStatus: string | null;
  readonly pruned: number;
}

export interface NeatlogsOutboxDiagnostics {
  readonly counts: Readonly<{ queued: number; sent: number; verified: number; failed: number }>;
  readonly latest: ReadonlyArray<Readonly<{
    traceId: string;
    workflowName: string;
    eventType: string;
    state: 'queued' | 'sent' | 'verified' | 'failed';
    generation: number;
    lastStatus: string | null;
    lastReason: string | null;
    duplicateTraceIds: readonly string[];
  }>>;
}

export interface TicketstubHarnessExporter {
  readonly summary: Readonly<{
    workflowName: string;
    tags: readonly string[];
    neatlogs: Readonly<Record<string, string | boolean | null>>;
  }>;
  accept(events: readonly unknown[]): TicketstubAcceptResult;
  drain(): Promise<NeatlogsDrainSummary | null>;
  scheduleDrain(delayMs?: number): void;
  status(): Readonly<{
    counters: Readonly<Record<'accepted' | 'duplicates' | 'refused' | 'invalid' | 'drains' | 'drainErrors', number>>;
    outbox: NeatlogsOutboxDiagnostics;
    lastDrain: NeatlogsDrainSummary | null;
  }>;
  close(): Promise<void>;
}

export interface TicketstubHarnessExporterOptions {
  /** Explicit environment: AGENT_HARNESS_TELEMETRY_KEY plus the documented NEATLOGS_* names. */
  env: Readonly<Record<string, string | undefined>>;
  /** File path of the durable outbox database. */
  databasePath: string;
  tags?: readonly string[];
  fetch?: typeof fetch;
  clock?: () => number;
  outboxOptions?: Readonly<Record<string, number>>;
  drainDelayMs?: number;
}

export function createTicketstubHarnessExporter(options: TicketstubHarnessExporterOptions): TicketstubHarnessExporter;
