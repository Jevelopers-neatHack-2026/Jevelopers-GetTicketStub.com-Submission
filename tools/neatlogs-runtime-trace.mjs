#!/usr/bin/env node
// Runs one genuine harness workflow through the operations worker with the
// durable TelemetryExporter wired to the Neatlogs outbox, then (optionally)
// sends the outbox through the OTLP sender and verifies it via the Public API.
// See docs/runbooks/neatlogs.md. Never prints or writes credential values or
// the Neatlogs project UUID.
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DurableWorkflowStore } from '../src/internal/durable-store.js';
import { createOperationsWorker } from '../src/worker/private/worker.js';
import {
  createNeatlogsOperationsTelemetry,
  drainNeatlogsOutbox,
  listNeatlogsOutbox,
  loadNeatlogsTelemetryOptIn,
  runtimeNeatlogsTags,
  iterateNeatlogsOutboxSnapshot
} from '../src/observability/private/neatlogs-outbox.js';

const EVIDENCE_SCHEMA = 'agent-harness.neatlogs.runtime-trace.v1';
const REVISION = /^[0-9a-f]{40}$/;
const HARNESS_MODE = 'mock';
// A bounded local plan using only the registry's local-pure operations. The
// registry marks every provider/network/shell operation unavailable, so this
// run cannot make a model or provider call.
export const RUNTIME_PLAN_JSON = JSON.stringify({
  kind: 'agent-harness.private-synthetic-plan',
  version: 1,
  steps: [
    { id: 'sum', operation: 'number.add', dependsOn: [], args: { left: 20, right: 22 } },
    { id: 'label', operation: 'text.concat', dependsOn: [], args: { parts: ['agent-harness ', 'runtime trace'] } }
  ]
});

export function isCompleteDeliveryEvidence({ network, batches, batchCount }) {
  return network === true
    && Array.isArray(batches)
    && Number.isSafeInteger(batchCount)
    && batches.length > 0
    && batches.length === batchCount
    && batches.every(batch => batch?.readback?.status === 'verified');
}

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write([
    'Usage: node tools/neatlogs-runtime-trace.mjs --mode <run|send-and-readback|drain>',
    '         --outbox <dir> --evidence <path> --component-revision <sha>',
    '         [--env-file <path>] [--max-polls <n>] [--poll-interval-ms <ms>] [--recover]',
    ''
  ].join('\n'));
  process.exit(2);
}

function writeJsonAtomically(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

async function waitForTerminal(worker, scope, jobId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = worker.readScopedWorkPage({ trustedSyntheticScope: scope, limit: 10 })
      .items.find(item => item.jobId === jobId);
    if (row && ['completed', 'failed', 'cancelled', 'unknown', 'parked'].includes(row.state)) return row;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
  }
  throw new Error('The runtime workflow did not reach a terminal durable state.');
}

/**
 * Executes one workflow through the normal in-process worker entry point:
 * createOperationsWorker -> submitSyntheticWork (the worker's only intake;
 * its scope strings carry no authority) -> owned runner child process ->
 * runBoundedLocalPlan. The worker's existing `telemetry` injection point
 * receives the durable TelemetryExporter, whose sink is the Neatlogs outbox.
 */
export async function runRuntimeWorkflow({ outboxDirectory, databaseDirectory }) {
  const databasePath = join(databaseDirectory, 'workflow.sqlite');
  const runId = randomUUID();
  const scope = Object.freeze({ tenantId: `runtime-tenant-${runId}`, projectId: `runtime-project-${runId}` });
  const ownerId = `ops-worker:runtime-${runId}`;
  const idempotencyKey = `runtime-trace-${runId}`;
  const telemetry = createNeatlogsOperationsTelemetry({ databasePath, outboxDirectory });
  let runtimeWorker;
  try {
    runtimeWorker = createOperationsWorker({ databasePath, ownerId, telemetry: telemetry.exporter });
  } catch (error) {
    telemetry.close();
    throw error;
  }
  let removeHandlers;
  try {
    removeHandlers = runtimeWorker.installSignalHandlers();
    const loop = runtimeWorker.start();
    const submitted = runtimeWorker.submitSyntheticWork({ trustedSyntheticScope: scope, idempotencyKey, planJson: RUNTIME_PLAN_JSON });
    if (!submitted.accepted) throw new Error('The runtime workflow was not admitted.');
    const terminal = await waitForTerminal(runtimeWorker, scope, submitted.jobId);
    const stop = await runtimeWorker.stop('requested');
    await loop;
    if (!stop.stopped || !stop.telemetryClosed) throw new Error('The worker did not stop and flush telemetry cleanly.');
    const diagnostics = telemetry.exporter.diagnostics();
    const store = DurableWorkflowStore.open({ databasePath, busyTimeoutMs: 20 });
    let rawEventIds;
    let output;
    try {
      rawEventIds = store.readEventPage({ afterSequence: 0, limit: 64 }).events.map(event => event.eventId);
      output = JSON.parse(store.getCheckpoint(terminal.workflowId).data.completedResultsJson);
    } finally {
      store.close();
    }
    return Object.freeze({
      jobState: terminal.state,
      results: Object.freeze({ sum: output.sum?.output ?? null, label: output.label?.output ?? null }),
      telemetry: Object.freeze({
        cursor: diagnostics.cursor,
        pendingRecords: diagnostics.pendingRecords,
        deliveredRecords: diagnostics.deliveredRecords,
        policyDroppedRecords: diagnostics.policyDroppedRecords,
        lastErrorCode: diagnostics.lastErrorCode
      }),
      // Raw identifiers of this run. They must never appear in the export body or evidence.
      forbidden: Object.freeze([
        submitted.jobId, terminal.workflowId, scope.tenantId, scope.projectId, ownerId, idempotencyKey, runId,
        ...rawEventIds
      ])
    });
  } finally {
    removeHandlers?.();
    if (runtimeWorker.lifecycle !== 'stopped') await runtimeWorker.stop('requested');
    telemetry.close();
  }
}

function sanitizeBatch(batch) {
  return {
    state: batch.state,
    firstSequence: batch.firstSequence,
    lastSequence: batch.lastSequence,
    records: batch.records.length,
    workflowName: batch.plan?.workflowName ?? null,
    tags: batch.plan?.tags ?? null,
    send: batch.send && {
      status: batch.send.status,
      reasonCode: batch.send.reasonCode ?? null,
      httpStatus: batch.send.httpStatus ?? null,
      attempts: batch.send.attempts ?? null,
      expectedSpans: batch.send.expectedSpans ?? null,
      rejectedSpans: batch.send.rejectedSpans ?? null
    },
    recovery: batch.recovery ? {
      regeneratedFrom: batch.recovery.regeneratedFrom,
      regeneratedTo: batch.recovery.regeneratedTo,
      basis: batch.recovery.basis ?? null,
      duplicateDeliveryRisk: batch.recovery.duplicateDeliveryRisk ?? null,
      send: batch.recovery.send && {
        status: batch.recovery.send.status,
        httpStatus: batch.recovery.send.httpStatus ?? null,
        attempts: batch.recovery.send.attempts ?? null,
        expectedSpans: batch.recovery.send.expectedSpans ?? null,
        rejectedSpans: batch.recovery.send.rejectedSpans ?? null
      }
    } : null,
    readback: batch.readback && {
      status: batch.readback.status,
      reasonCode: batch.readback.reasonCode ?? null,
      duplicateEventDeliveries: batch.readback.duplicateEventDeliveries ?? null
    },
    traces: (batch.plan?.traces ?? []).map(trace => {
      const read = batch.readback?.traces?.find(item => item.traceId === trace.traceId) ?? null;
      return {
        traceId: trace.traceId,
        rootSpanId: trace.rootSpanId,
        generation: trace.generation,
        sequence: trace.sequence,
        eventType: trace.eventType,
        sessionId: trace.sessionId,
        readback: read && {
          status: read.status,
          finalizationStatus: read.finalizationStatus ?? null,
          spansCount: read.spansCount ?? null,
          markerStored: read.markerStored ?? null,
          duplicateTraceIds: read.duplicateTraceIds ?? [],
          problems: read.problems
        }
      };
    })
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string' },
      outbox: { type: 'string' },
      evidence: { type: 'string' },
      'env-file': { type: 'string' },
      'component-revision': { type: 'string' },
      'max-polls': { type: 'string' },
      'poll-interval-ms': { type: 'string' },
      recover: { type: 'boolean' }
    },
    strict: true
  });
  const mode = values.mode;
  if (!['run', 'send-and-readback', 'drain'].includes(mode)) usage('Unknown --mode.');
  if (!values.outbox || !values.evidence) usage('--outbox and --evidence are required.');
  const revision = values['component-revision'];
  if (!revision || !REVISION.test(revision)) usage('--component-revision must be the full 40-character commit SHA.');
  const network = mode !== 'run';
  // Opt-in: configuration is read only for network modes, only through the strict loader.
  const optIn = loadNeatlogsTelemetryOptIn({
    enabled: network,
    env: { ...process.env },
    envFile: values['env-file'] ? resolve(values['env-file']) : null,
    scrubEnv: process.env
  });
  const outbox = resolve(values.outbox);
  const tags = runtimeNeatlogsTags({ revision, harnessMode: HARNESS_MODE });
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    generatedAt: new Date().toISOString(),
    mode,
    evidenceClass: network ? 'live-runtime-application' : 'offline-runtime-application',
    syntheticBuilder: false,
    componentRevisions: { agentHarness: revision, neatlogsSdk: '1.1.28', node: process.versions.node },
    workflow: {
      entryPoint: 'createOperationsWorker().submitSyntheticWork() -> src/worker/private/runner.js -> runBoundedLocalPlan',
      harnessMode: HARNESS_MODE,
      modelMode: 'none (mock dependency mode; local-pure registry operations number.add and text.concat; provider, network and shell operations are unavailable in the registry)',
      providerCalls: 0,
      plan: JSON.parse(RUNTIME_PLAN_JSON)
    },
    config: optIn.enabled ? {
      region: optIn.config.summary.region,
      ingestOrigin: optIn.config.summary.ingestOrigin,
      appOrigin: optIn.config.summary.appOrigin,
      readbackReady: optIn.config.summary.readbackReady
    } : null,
    tags,
    run: null,
    batches: [],
    deliveryConfirmed: false
  };
  let forbidden = [];
  if (mode !== 'drain') {
    const databaseDirectory = mkdtempSync(join(tmpdir(), 'neatlogs-runtime-'));
    try {
      const run = await runRuntimeWorkflow({ outboxDirectory: outbox, databaseDirectory });
      forbidden = run.forbidden;
      evidence.run = { jobState: run.jobState, results: run.results, telemetry: run.telemetry, rawIdentifiersScanned: forbidden.length };
    } finally {
      rmSync(databaseDirectory, { recursive: true, force: true });
    }
  }
  if (network) {
    const options = {};
    if (values['max-polls']) options.maxPolls = Number(values['max-polls']);
    if (values['poll-interval-ms']) options.pollIntervalMs = Number(values['poll-interval-ms']);
    const results = await drainNeatlogsOutbox({
      directory: outbox,
      config: optIn.config,
      tags,
      forbidden,
      send: true,
      readback: optIn.config.summary.readbackReady,
      recover: values.recover === true,
      readbackOptions: options
    });
    // A drain visits one bounded rotating page. Completeness is evaluated from
    // all retained batch states, not from that page or the scheduling cursor.
    evidence.drainPage = results.map(result => ({ path: basename(result.path), state: result.state }));
    evidence.batchEvidenceSource = 'persisted_outbox_snapshot';
    evidence.batches = Array.from(iterateNeatlogsOutboxSnapshot(outbox), result => sanitizeBatch(result.batch));
  } else {
    evidence.batches = listNeatlogsOutbox(outbox).map(path => ({ path: path.slice(outbox.length + 1) }));
  }
  evidence.deliveryConfirmed = isCompleteDeliveryEvidence({
    network,
    batches: evidence.batches,
    batchCount: listNeatlogsOutbox(outbox).length
  });

  const serialized = JSON.stringify(evidence);
  const secrets = [];
  if (optIn.enabled) {
    try { secrets.push(optIn.config.ingestKey()); } catch { /* not configured */ }
    try { secrets.push(optIn.config.readbackToken()); } catch { /* not configured */ }
    if (optIn.config.summary.projectId) secrets.push(optIn.config.summary.projectId);
  }
  const leaks = [...forbidden, ...secrets].filter(value => typeof value === 'string' && value && serialized.includes(value));
  if (leaks.length > 0) {
    process.stderr.write(`Evidence leak scan failed (${leaks.length} value(s)); evidence not written.\n`);
    process.exit(1);
  }
  writeJsonAtomically(resolve(values.evidence), evidence);
  process.stdout.write(`${JSON.stringify({
    mode,
    evidenceClass: evidence.evidenceClass,
    jobState: evidence.run?.jobState ?? null,
    batches: evidence.batches.length,
    traces: evidence.batches.reduce((count, batch) => count + (batch.traces?.length ?? 0), 0),
    send: evidence.batches.map(batch => batch.send?.status ?? null),
    readback: evidence.batches.map(batch => batch.readback?.status ?? null),
    deliveryConfirmed: evidence.deliveryConfirmed
  })}\n`);
  const succeeded = mode === 'run' ? evidence.run?.jobState === 'completed' : evidence.deliveryConfirmed;
  process.exit(succeeded ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`Neatlogs runtime trace failed (${typeof error?.code === 'string' ? error.code : 'ERROR'}).\n`);
    process.exitCode = 1;
  });
}
