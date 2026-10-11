import { validateContract, checkTrustedContext, canonicalJson, hashManifest } from './runtime.mjs';
import { checkPartialFailure, checkJobUpdate } from './operations.mjs';
import { productionIssue, productionOk } from './production-errors.mjs';
import { checkPersonalizationSchema, checkTemplateSpec } from './production-values.mjs';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'partially_succeeded']);
const visible = row => row.artifact_ref !== null || row.bundle_ref !== null;

/** Validate the complete original structured plan before scheduling; no host callbacks. */
export function checkPersonalizationPlan(input, context) {
  if (input?.input?.kind === 'csv') return productionIssue('CAPABILITY_DISABLED');
  if (!Array.isArray(input?.input?.rows) || input.input.rows.length > 10000) return productionIssue('RESOURCE_LIMIT');
  let rawBytes = 0;
  for (const row of input.input.rows) {
    if (!row || typeof row.row_id !== 'string' || row.row_id.length > 100 || !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields)) return productionIssue('ROW_SCHEMA');
    let fields = 0;
    for (const [key, value] of Object.entries(row.fields)) {
      if (++fields > 32 || typeof value !== 'string' || value.length > 4096 || key.length > 64) return productionIssue('RESOURCE_LIMIT');
      rawBytes += Buffer.byteLength(JSON.stringify(key)) + Buffer.byteLength(JSON.stringify(value)) + 1;
      if (rawBytes > 4000000) return productionIssue('RESOURCE_LIMIT');
    }
    rawBytes += Buffer.byteLength(JSON.stringify(row.row_id));
    if (rawBytes > 4000000) return productionIssue('RESOURCE_LIMIT');
  }
  const parsed = validateContract('PersonalizeBatchRequest', input);
  if (!parsed.ok) return parsed;
  const template = checkTemplateSpec(context.template, context.scope);
  if (!template.ok) return template;
  if (input.binding.template_ref.id !== template.value.template_id || input.binding.template_ref.revision !== template.value.revision || input.binding.template_ref.content_hash !== template.value.content_hash || !same(input.binding.spec_ref, template.value.spec_ref) || !same(input.binding.capability_ref, template.value.capability_ref)) return productionIssue('HASH_MISMATCH');
  const policy = checkPersonalizationSchema(context.policy, context.template);
  if (!policy.ok) return policy;
  if (!checkTrustedContext(policy.value, context.scope).ok) return productionIssue('NOT_FOUND');
  const p = policy.value, rows = input.input.rows;
  if (input.input.row_schema_ref.id !== p.schema_id || input.input.row_schema_ref.revision !== p.revision || input.input.row_schema_ref.content_hash !== p.content_hash) return productionIssue('HASH_MISMATCH');
  if (rows.length > p.limits.maximum_rows || Buffer.byteLength(canonicalJson(input)) > p.limits.maximum_canonical_bytes) return productionIssue('RESOURCE_LIMIT');
  if (new Set(rows.map(row => row.row_id)).size !== rows.length) return productionIssue('ROW_DUPLICATE');
  const fields = p.fields.filter(field => field.source_policy === 'row_display');
  if (Object.keys(input.binding.values).some(key => !fields.some(field => field.field_id === key))) return productionIssue('ROW_SCHEMA');
  for (const row of rows) {
    if (Object.keys(row.fields).length > p.limits.maximum_fields || Object.keys(row.fields).some(key => !fields.some(field => field.field_id === key))) return productionIssue('ROW_SCHEMA');
    for (const field of fields) {
      const value = row.fields[field.field_id];
      if ((field.required && (value === undefined || value.length === 0)) || (value !== undefined && value.length > field.maximum_utf16_units)) return productionIssue('ROW_SCHEMA');
    }
  }
  return productionOk({ acceptance_policy: input.acceptance_policy ?? 'atomic', rows: rows.map((row, ordinal) => ({ row_id: row.row_id, ordinal, input_hash: hashManifest(row), fields: Object.fromEntries(fields.map(field => [field.field_id, row.fields[field.field_id] ?? ''])) })) });
}

export function checkRowResult(input, context) {
  const parsed = validateContract('RowResult', input);
  if (!parsed.ok) return parsed;
  if (!checkTrustedContext(input, context.scope).ok || !same(input.job, context.job)) return productionIssue('NOT_FOUND');
  const original = context.original_rows[input.ordinal];
  if (!original || original.row_id !== input.row_id || hashManifest(original) !== input.input_hash) return productionIssue('ROW_BINDING_MISMATCH');
  if ((input.status === 'skipped') !== (input.skip_reason !== null)) return productionIssue('ROW_SCHEMA');
  if (['failed', 'cancelled', 'skipped'].includes(input.status) && !input.errors.length) return productionIssue('ROW_SCHEMA');
  if (input.errors.some(error => error.operation !== 'personalizeArtifactBatch' || error.row_id !== input.row_id || !checkTrustedContext(error.diagnostic_ref, context.scope).ok)) return productionIssue('ROW_BINDING_MISMATCH');
  if (input.status !== 'succeeded' && visible(input)) return productionIssue('INVALID_PUBLICATION');
  if (visible(input)) {
    const verified = context.verified_rows?.[input.row_id];
    if (input.artifact_ref === null || input.bundle_ref === null || input.eligibility.state !== 'eligible' || !verified || !same(verified.artifact_ref, input.artifact_ref) || !same(verified.bundle_ref, input.bundle_ref) || verified.preflight_status !== 'passed') return productionIssue('INVALID_PUBLICATION');
    const row = input.bundle_ref.row_scope;
    if (!row || !same(row.job_ref, input.job) || row.row_id !== input.row_id || row.ordinal !== input.ordinal || row.input_hash !== input.input_hash || !same(input.artifact_ref.composition_ref, input.bundle_ref.composition_ref)) return productionIssue('ROW_BINDING_MISMATCH');
    if (verified.input_hash !== input.input_hash || verified.ordinal !== input.ordinal || !same(verified.job, input.job)) return productionIssue('ROW_BINDING_MISMATCH');
  }
  return parsed;
}

export function checkBatchResult(input, context) {
  const parsed = validateContract('BatchResult', input);
  if (!parsed.ok) return parsed;
  if (!checkTrustedContext(input, context.scope).ok || !same(input.job, context.job)) return productionIssue('NOT_FOUND');
  const c = input.counts;
  if (c.submitted !== context.original_rows.length || c.submitted !== c.succeeded + c.failed + c.cancelled + c.skipped + c.pending || input.published_count > c.succeeded) return productionIssue('INVALID_COUNTS');
  if (terminal.has(input.status) && c.pending !== 0) return productionIssue('INVALID_COUNTS');
  if (input.status === 'succeeded' && (c.succeeded !== c.submitted || input.published_count !== c.succeeded)) return productionIssue('INVALID_COUNTS');
  if (input.status === 'partially_succeeded' && (input.acceptance_policy !== 'allow_partial' || input.published_count === 0 || input.published_count === c.submitted)) return productionIssue('INVALID_COUNTS');
  if (!terminal.has(input.status) && (input.published_count || input.batch_manifest_ref !== null || input.rows.some(visible))) return productionIssue('INVALID_PUBLICATION');
  if (input.acceptance_policy === 'atomic' && input.status !== 'succeeded' && (input.published_count || input.rows.some(visible) || input.batch_manifest_ref !== null)) return productionIssue('INVALID_PUBLICATION');
  if (['failed', 'cancelled'].includes(input.status) && input.batch_manifest_ref !== null) return productionIssue('INVALID_PUBLICATION');
  if (input.page_start + input.rows.length > c.submitted || (input.page_start + input.rows.length < c.submitted) !== (input.next_cursor !== null) || (c.submitted > 0 && input.rows.length === 0)) return productionIssue('INCOMPLETE_PAGE');
  for (const [index, row] of input.rows.entries()) {
    if (row.ordinal !== input.page_start + index) return productionIssue('INCOMPLETE_PAGE');
    const checked = checkRowResult(row, context);
    if (!checked.ok) return checked;
  }
  return parsed;
}

/** Complete source-ordered pages are needed to prove global counts; cursor auth is host-owned. */
export function checkBatchPages(pages, context) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 10000) return productionIssue('RESOURCE_LIMIT');
  const first = pages[0];
  let position = 0;
  const rows = [];
  for (const page of pages) {
    const checked = checkBatchResult(page, context);
    if (!checked.ok) return checked;
    for (const key of ['job', 'counts', 'status', 'acceptance_policy', 'published_count', 'cancel_requested', 'batch_manifest_ref']) if (!same(page[key], first[key])) return productionIssue('INVALID_COUNTS');
    if (page.page_start !== position) return productionIssue('INCOMPLETE_PAGE');
    rows.push(...page.rows); position += page.rows.length;
  }
  if (position !== context.original_rows.length || pages.at(-1).next_cursor !== null) return productionIssue('INCOMPLETE_PAGE');
  const counts = { submitted: rows.length, succeeded: 0, failed: 0, cancelled: 0, skipped: 0, pending: 0 };
  for (const row of rows) counts[['queued', 'running'].includes(row.status) ? 'pending' : row.status]++;
  if (!same(counts, first.counts) || rows.filter(visible).length !== first.published_count) return productionIssue('INVALID_COUNTS');
  return productionOk({ batch: first, rows });
}

/** Explicit value projections use supplied v1 envelope and typed error mappings. */
export function projectBatchPartialFailure(input, context) {
  const complete = checkBatchPages(input, context);
  if (!complete.ok) return complete;
  const { batch, rows } = complete.value;
  if (!terminal.has(batch.status) || rows.length > 100 || batch.status === 'succeeded') return productionIssue('LEGACY_UNREPRESENTABLE');
  const successful_item_ids = batch.acceptance_policy === 'allow_partial' ? rows.filter(visible).map(row => row.row_id) : [];
  const failures = [];
  for (const row of rows.filter(row => ['failed', 'cancelled', 'skipped'].includes(row.status))) {
    const error = context.v1_errors?.[row.row_id];
    if (!error || error.side_effects !== row.errors[0].side_effects || error.usage_state !== row.errors[0].usage_state) return productionIssue('LEGACY_UNREPRESENTABLE');
    failures.push({ item_id: row.row_id, error });
  }
  const value = { ...context.envelope, contract: 'PartialFailure', batch_id: batch.job.job_ref.id, policy_ref: context.policy_ref,
    acceptance_policy: batch.acceptance_policy === 'atomic' ? 'all_or_nothing' : 'partial', successful_item_ids, failures,
    unprocessed_item_ids: rows.filter(row => !successful_item_ids.includes(row.row_id) && !failures.some(failure => failure.item_id === row.row_id)).map(row => row.row_id) };
  const checked = checkPartialFailure(value, { ...context.operation_context, item_ids: rows.map(row => row.row_id), acceptance_policy: value.acceptance_policy });
  return checked.ok ? productionOk({ value: checked.value, equivalent: false, loss: ['execution_success_visibility', 'row_scope', 'pagination'] }) : checked;
}

export function projectBatchJobStatus(input, context) {
  const complete = checkBatchPages(input, context);
  if (!complete.ok) return complete;
  const batch = complete.value.batch;
  if (!terminal.has(batch.status) || !context.batch_ref || context.batch_ref.contract !== 'BatchResult' || context.batch_ref.schema_version !== '1.0.0' || context.batch_ref.content_hash !== hashManifest(batch)) return productionIssue('LEGACY_UNREPRESENTABLE');
  const state = batch.status === 'partially_succeeded' ? 'failed' : batch.status;
  const value = { ...context.job_candidate, state, outcome: state, result_refs: [context.batch_ref] };
  if (state === 'failed' && (!value.error || value.error.code !== 'PARTIAL_FAILURE')) return productionIssue('LEGACY_UNREPRESENTABLE');
  const checked = checkJobUpdate(value, context.job_context);
  return checked.ok ? productionOk({ value: checked.value, equivalent: false, loss: ['partial_execution_outcome', 'publication_counts', 'row_diagnostics'] }) : checked;
}
