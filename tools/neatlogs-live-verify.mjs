#!/usr/bin/env node
// Neatlogs live ingestion/readback verifier for one synthetic harness workflow.
// See docs/runbooks/neatlogs.md. Never prints or writes credential values.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  DurableWorkflowStore,
  createHmacTokenizer,
  projectTelemetryEvent
} from '@jevelopers/agent-harness-runtime';
import { loadNeatlogsConfig, scrubNeatlogsEnvironment } from '../src/observability/private/neatlogs-config.js';
import {
  canonicalNeatlogsInput,
  deterministicNeatlogsIds,
  encodeNeatlogsExportRequest,
  planNeatlogsExport,
  validateNeatlogsTags
} from '../src/observability/private/neatlogs-otlp.js';
import { readbackNeatlogsPlan, sendNeatlogsPlan } from '../src/observability/private/neatlogs-live.js';
import { validateNeatlogsSourceRecords } from '../src/observability/private/neatlogs-sdk-mapper.js';

const EVIDENCE_SCHEMA = 'agent-harness.neatlogs.live-verification.v1';
const PLAN_SCHEMA = 'agent-harness.neatlogs.export-plan.v1';
const REVISION = /^[0-9a-f]{40}$/;
// Synthetic canaries are written into the durable workflow's raw fields. They
// must never appear in the export body, the plan, or the evidence.
export const SYNTHETIC_CANARIES = Object.freeze([
  'SYNTHETIC_RAW_ID_CANARY_7d1',
  'SYNTHETIC_PRIVATE_URL_CANARY_https://private.invalid/order?token=suffix',
  'SYNTHETIC_EMAIL_CANARY_person@example.invalid',
  'SYNTHETIC_CUSTOMER_TEXT_CANARY_4be',
  'SYNTHETIC_TOKEN_CANARY_sk-synthetic-not-a-key',
  'SYNTHETIC_ERROR_TEXT_CANARY_e02'
]);

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write([
    'Usage: node tools/neatlogs-live-verify.mjs --mode <offline|send|readback|send-and-readback>',
    '         --evidence <path> [--env-file <path>] [--plan <path>] [--component-revision <sha>]',
    '         [--max-polls <n>] [--poll-interval-ms <ms>]',
    ''
  ].join('\n'));
  process.exit(2);
}

function writeJsonAtomically(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

function buildSyntheticRecords() {
  const scratch = mkdtempSync(join(tmpdir(), 'neatlogs-live-synthetic-'));
  let generated = 0;
  const store = DurableWorkflowStore.open({
    databasePath: join(scratch, 'synthetic.sqlite'),
    clock: () => Date.now(),
    idFactory: () => `synthetic-generated-${randomUUID()}-${++generated}`
  });
  const tokenizer = createHmacTokenizer(randomBytes(32));
  try {
    const run = randomUUID();
    const workflowId = `workflow:${SYNTHETIC_CANARIES[0]}:${run}`;
    store.createWorkflow({
      workflowId,
      eventId: `event:created:${run}`,
      checkpoint: {
        customer: SYNTHETIC_CANARIES[3],
        privateUrl: SYNTHETIC_CANARIES[1],
        email: SYNTHETIC_CANARIES[2],
        bearer: SYNTHETIC_CANARIES[4],
        rawError: SYNTHETIC_CANARIES[5]
      }
    });
    const lease = store.acquireLease({
      workflowId,
      ownerId: 'synthetic-neatlogs-verifier',
      ttlMs: 10_000,
      eventId: `event:lease:${run}`
    });
    store.transitionWorkflow({
      ...lease,
      expectedRevision: 0,
      toState: 'running',
      eventId: `event:running:${run}`
    });
    const page = store.readEventPage({ afterSequence: 0, limit: 32 });
    const tokenize = tokenizer.tokenize.bind(tokenizer);
    return page.events.map(event => projectTelemetryEvent(event, tokenize));
  } finally {
    tokenizer.destroy?.();
    store.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function captureEnvelope(records) {
  // Imported lazily so the SDK sees a scrubbed environment.
  const { createNeatlogsSdkCapture } = await import('../src/observability/private/neatlogs-sdk-capture.js');
  const capture = createNeatlogsSdkCapture({ timeoutMs: 500 });
  try {
    const result = await capture.prepare(records);
    if (result.status !== 'captured_local') {
      throw new Error(`Local SDK capture failed (${result.reasonCode}).`);
    }
    return result.envelope;
  } finally {
    await capture.close();
  }
}

function serializablePlan(plan) {
  return {
    schema: PLAN_SCHEMA,
    workflowName: plan.workflowName,
    tags: [...plan.tags],
    traces: plan.traces.map(trace => ({
      traceId: trace.traceId,
      rootSpanId: trace.rootSpanId,
      markerSpanId: trace.markerSpanId,
      sessionId: trace.sessionId,
      eventToken: trace.eventToken,
      sequence: trace.sequence,
      revision: trace.revision,
      eventType: trace.eventType,
      fence: trace.fence,
      input: trace.input
    }))
  };
}

function loadPlan(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed?.schema !== PLAN_SCHEMA || !Array.isArray(parsed.traces)) throw new Error('Plan file is invalid.');
  const records = validateNeatlogsSourceRecords(parsed.traces.map(trace => JSON.parse(trace.input)));
  const traces = parsed.traces.map((trace, index) => {
    const record = records[index];
    const ids = deterministicNeatlogsIds(record.eventId);
    if (trace.traceId !== ids.traceId || trace.rootSpanId !== ids.rootSpanId
        || trace.markerSpanId !== ids.markerSpanId || trace.input !== canonicalNeatlogsInput(record)
        || trace.sessionId !== record.workflowId) {
      throw new Error('Plan file does not match its derived identifiers.');
    }
    return Object.freeze({ ...trace, ...ids, record });
  });
  return Object.freeze({
    workflowName: parsed.workflowName,
    tags: validateNeatlogsTags(parsed.tags),
    traces: Object.freeze(traces)
  });
}

function leakScan(text, secrets) {
  const found = [];
  SYNTHETIC_CANARIES.forEach((canary, index) => {
    if (text.includes(canary)) found.push(`canary_${index}`);
  });
  secrets.forEach((secret, index) => {
    if (secret && text.includes(secret)) found.push(`credential_${index}`);
  });
  return found;
}

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    evidence: { type: 'string' },
    'env-file': { type: 'string' },
    plan: { type: 'string' },
    'component-revision': { type: 'string' },
    'max-polls': { type: 'string' },
    'poll-interval-ms': { type: 'string' }
  },
  strict: true
});
const mode = values.mode;
if (!['offline', 'send', 'readback', 'send-and-readback'].includes(mode)) usage('Unknown --mode.');
if (!values.evidence) usage('--evidence is required.');
const revision = values['component-revision'] ?? null;
if (mode !== 'readback' && (revision === null || !REVISION.test(revision))) {
  usage('--component-revision must be the full 40-character agent-harness commit SHA.');
}

const config = loadNeatlogsConfig({
  env: { ...process.env },
  envFile: values['env-file'] ? resolve(values['env-file']) : null
});
scrubNeatlogsEnvironment(process.env);
const secrets = [];
try { secrets.push(config.ingestKey()); } catch { secrets.push(null); }
try { secrets.push(config.readbackToken()); } catch { secrets.push(null); }

const evidence = {
  schema: EVIDENCE_SCHEMA,
  generatedAt: new Date().toISOString(),
  mode,
  evidenceClass: mode === 'offline' ? 'offline-fixture' : 'live-synthetic',
  syntheticData: true,
  componentRevisions: { agentHarness: revision, neatlogsSdk: '1.1.28' },
  config: config.summary,
  plan: null,
  redaction: null,
  send: null,
  readback: null,
  deliveryConfirmed: false
};

let plan;
if (mode === 'readback') {
  if (!values.plan) usage('--plan is required for readback mode.');
  plan = loadPlan(resolve(values.plan));
} else {
  const records = buildSyntheticRecords();
  const envelope = await captureEnvelope(records);
  plan = planNeatlogsExport(envelope, {
    tags: [`agent-harness@${revision}`, 'evidence:synthetic']
  });
  const body = encodeNeatlogsExportRequest(plan).toString('latin1');
  const bodyFindings = leakScan(body, secrets);
  evidence.redaction = {
    rawCanariesSeeded: SYNTHETIC_CANARIES.length,
    exportBodyFindings: bodyFindings,
    passed: bodyFindings.length === 0
  };
  if (bodyFindings.length > 0) {
    writeJsonAtomically(resolve(values.evidence), evidence);
    process.stderr.write('Redaction gate failed; nothing was sent.\n');
    process.exit(1);
  }
  if (values.plan) writeJsonAtomically(resolve(values.plan), serializablePlan(plan));
}
evidence.plan = serializablePlan(plan);

if (mode === 'send' || mode === 'send-and-readback') {
  evidence.send = await sendNeatlogsPlan(config, plan);
}
if (mode === 'readback' || (mode === 'send-and-readback' && evidence.send?.status === 'receiver_accepted')) {
  const options = {};
  if (values['max-polls']) options.maxPolls = Number(values['max-polls']);
  if (values['poll-interval-ms']) options.pollIntervalMs = Number(values['poll-interval-ms']);
  evidence.readback = await readbackNeatlogsPlan(config, plan, options);
  evidence.deliveryConfirmed = evidence.readback.status === 'verified';
}

const serialized = JSON.stringify(evidence);
const evidenceFindings = leakScan(serialized, secrets);
if (evidenceFindings.length > 0) {
  process.stderr.write(`Evidence leak scan failed (${evidenceFindings.join(',')}); evidence not written.\n`);
  process.exit(1);
}
writeJsonAtomically(resolve(values.evidence), evidence);
process.stdout.write(`${JSON.stringify({
  mode,
  evidenceClass: evidence.evidenceClass,
  traces: plan.traces.length,
  send: evidence.send?.status ?? null,
  readback: evidence.readback?.status ?? null,
  deliveryConfirmed: evidence.deliveryConfirmed
})}\n`);
const succeeded = mode === 'offline'
  || (mode === 'send' && evidence.send?.status === 'receiver_accepted')
  || evidence.deliveryConfirmed;
process.exit(succeeded ? 0 : 1);
