import { types as utilTypes } from 'node:util';
import { closedErrorProjection } from './closed-diagnostics.js';

const PREFIX = 'OPS07_C04_COMPLETION_V1 ';
const WORK = new Set(['queued', 'running', 'parked', 'unknown', 'completed', 'failed', 'cancelled']);
const WORKFLOW = new Set(['queued', 'running', 'awaiting_response', 'reconciliation_pending',
  'review_required', 'succeeded', 'failed', 'cancelled']);
const REASONS = new Set(['LOCAL_EXECUTION_STOPPED', 'SAFE_RESTART_RESUME', 'CANCELLED',
  'EXTERNAL_OUTCOME_UNRESOLVED', 'WORKER_GENERATION_LIMIT']);
const PHASES = new Set(['runner_start', 'store_open', 'resource_ceilings', 'claim_read', 'controller',
  'initial_snapshot', 'initial_admission', 'loop_snapshot', 'completion', 'completion_resolution',
  'admission_resolution', 'next_admission', 'store_close', 'other']);
const CODES = new Set(['STORE_BUSY', 'STORE_WRITE_FAILED', 'STORE_OPEN_FAILED', 'STORE_CLOSED',
  'UNSUPPORTED_SCHEMA_VERSION', 'UNSUPPORTED_RUNTIME', 'SQLITE_UNSUPPORTED', 'CONCURRENT_MODIFICATION',
  'STALE_FENCE', 'LEASE_REQUIRED', 'LEASE_EXPIRED', 'ILLEGAL_TRANSITION', 'OUTCOME_UNRESOLVED',
  'INVALID_INPUT', 'CHECKPOINT_CORRUPT', 'CLOCK_ROLLBACK', 'ERR_SQLITE_ERROR']);
const SIGNALS = new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGQUIT']);

function data(value, key) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || utilTypes.isProxy(value)) return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}
function integer(value, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
}
function choice(value, values, fallback = 'unobserved') { return values.has(value) ? value : fallback; }
function array(value, max) {
  if (utilTypes.isProxy(value) || !Array.isArray(value) || value.length > max) return null;
  const result = [];
  for (let i = 0; i < value.length; i += 1) {
    const entry = Object.getOwnPropertyDescriptor(value, String(i));
    if (!entry || !Object.hasOwn(entry, 'value')) return null;
    result.push(entry.value);
  }
  return result;
}

// One indexed point lookup, before worker cleanup can change a queued/running
// row. No plans, identifiers, checkpoint payloads or raw error text are copied.
export function readC04FinalRow(database, jobId) {
  let status = 'not_observed'; let errorCode = 'none'; let row;
  if (database && typeof jobId === 'string') {
    try {
      row = database.prepare(`SELECT o.state AS work_state, o.reason_code, o.generation,
        o.fence_token AS operation_fence, w.state AS workflow_state,
        w.fence_token AS workflow_fence, w.checkpoint_sequence
        FROM operations_work o JOIN workflows w ON w.workflow_id=o.workflow_id WHERE o.job_id=?`).get(jobId);
      status = row ? 'observed' : 'missing';
    } catch (error) { status = 'error'; errorCode = closedErrorProjection(error).code; }
  }
  return { status, errorCode,
    workState: choice(data(row, 'work_state'), WORK), workflowState: choice(data(row, 'workflow_state'), WORKFLOW),
    reason: data(row, 'reason_code') == null ? 'none' : choice(data(row, 'reason_code'), REASONS, 'OTHER'),
    generation: integer(data(row, 'generation')), operationFence: integer(data(row, 'operation_fence')),
    workflowFence: integer(data(row, 'workflow_fence')), checkpointSequence: integer(data(row, 'checkpoint_sequence')) };
}

// This is a small, explicitly diagnostic projection of the existing private
// FD3 capture. C04 deliberately kills its first runner and has one logical job;
// it cannot claim the separate two-job OPS07.C01 capture's completeness oracle.
export function encodeC04CompletionDiagnostic(input) {
  const row = data(input, 'row');
  const source = data(input, 'capture');
  const flags = data(source, 'flags');
  const children = array(data(source, 'slots'), 2);
  const supervisor = array(data(source, 'supervisor'), 100);
  const slots = [];
  for (const slot of [0, 1]) {
    const child = children?.find(item => data(item, 'slot') === slot);
    const records = array(data(child, 'records'), 100);
    const projected = { slot, childObserved: child !== undefined, recordsObserved: records?.length ?? null, lastPhase: 'unobserved',
      errorPhase: 'unobserved', errorCode: 'none', sqlitePrimaryCode: null,
      exitObserved: false, exitCode: null, signal: null,
      finishOutcome: 'unobserved', finishSettled: null,
      footerObserved: data(child, 'footer') === true, writerComplete: data(child, 'writerComplete') === true };
    for (const record of records ?? []) {
      const stage = data(record, 'stage');
      if (stage === 'runner_phase') projected.lastPhase = choice(data(record, 'phase'), PHASES);
      if (['runner_error', 'controller_error', 'storage_origin'].includes(stage)) {
        projected.errorPhase = choice(data(record, 'phase'), PHASES, projected.lastPhase);
        projected.errorCode = choice(data(record, 'code'), CODES, 'OTHER');
        projected.sqlitePrimaryCode = integer(data(record, 'primaryCode'), 255);
      }
    }
    for (const record of supervisor ?? []) {
      if (data(record, 'slot') !== slot) continue;
      if (data(record, 'stage') === 'child_exit') {
        projected.exitObserved = true;
        projected.exitCode = integer(data(record, 'exitCode'), 255);
        projected.signal = choice(data(record, 'signal'), SIGNALS, null);
      }
      if (data(record, 'stage') === 'finish_result') {
        projected.finishOutcome = choice(data(record, 'outcome'), new Set(['completed', 'stopped', 'shutdown']));
        projected.finishSettled = typeof data(record, 'settled') === 'boolean' ? data(record, 'settled') : null;
      }
    }
    slots.push(projected);
  }
  const value = { schema: 'agent-harness.ops07-c04-completion.v1', diagnosticOnly: true,
    phase: choice(data(input, 'phase'), new Set(['worker_start', 'runner_wait', 'held_stop', 'recovered_stop',
      'restart_start', 'restart_wait', 'restart_stop', 'done'])),
    primaryFailed: data(input, 'primaryFailed') === true,
    cleanupComplete: data(input, 'cleanupComplete') === true,
    row: { status: choice(data(row, 'status'), new Set(['observed', 'missing', 'error', 'not_observed']), 'not_observed'),
      errorCode: data(row, 'errorCode') === 'none' ? 'none' : choice(data(row, 'errorCode'), CODES, 'OTHER'),
      workState: choice(data(row, 'workState'), WORK), workflowState: choice(data(row, 'workflowState'), WORKFLOW),
      reason: data(row, 'reason') === 'none' ? 'none' : choice(data(row, 'reason'), REASONS, 'OTHER'),
      generation: integer(data(row, 'generation')), operationFence: integer(data(row, 'operationFence')),
      workflowFence: integer(data(row, 'workflowFence')), checkpointSequence: integer(data(row, 'checkpointSequence')) },
    capture: { available: data(source, 'schema') === 'agent-harness.ops07-session.v1' && children !== null && supervisor !== null,
      missingChildCapture: data(flags, 'missingChildCapture') !== false,
      malformed: data(flags, 'malformed') !== false, overflow: data(flags, 'overflow') !== false,
      writeFailed: data(flags, 'writeFailed') !== false, abruptExit: data(flags, 'abruptExit') !== false,
      sessionCleanupIncomplete: data(flags, 'cleanupIncomplete') !== false, slots } };
  const line = `${PREFIX}${JSON.stringify(value)}`;
  return Buffer.byteLength(line, 'utf8') <= 4_096 ? line : null;
}
