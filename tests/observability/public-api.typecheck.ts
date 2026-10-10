import {
  DurableWorkflowStore,
  createHmacTokenizer,
  createTelemetryExporter,
  type TelemetryRecord,
  type TelemetrySink
} from '@jevelopers/agent-harness-runtime';

declare const store: DurableWorkflowStore;
declare const localTokenKey: Uint8Array;
declare const sink: TelemetrySink;

const tokenizer = createHmacTokenizer(localTokenKey);
declare const record: TelemetryRecord;
void record.eventId;

const exporter = createTelemetryExporter({
  store,
  tokenizer,
  sink,
  limits: { batchSize: 8, queueRecords: 8, sinkTimeoutMs: 200 }
});

const page = store.readEventPage({ afterSequence: 0, limit: 100 });
void page.events[0]?.type;
void exporter.diagnostics().pendingRecords;
