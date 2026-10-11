import { validateContract, checkTrustedContext, canonicalJson, hashManifest } from './runtime.mjs';
import { productionIssue, productionOk } from './production-errors.mjs';
import { productionContentHash } from './production-values.mjs';

/** Launch enabling is external. This boundary never fetches a file or parses CSV. */
export function checkCsvInput(input, context) {
  if (context?.enabled !== true) return productionIssue('CAPABILITY_DISABLED');
  const request = validateContract('PersonalizeBatchRequest', input);
  if (!request.ok || input.input.kind !== 'csv') return productionIssue('INVALID_INPUT');
  if (!context.enabling_ref || !context.expected_enabling_ref || canonicalJson(context.enabling_ref) !== canonicalJson(context.expected_enabling_ref)) return productionIssue('CAPABILITY_DISABLED');
  for (const [name, contract] of [['dialect', 'CsvDialect'], ['mapping', 'CsvMapping']]) {
    const parsed = validateContract(contract, context[name]);
    if (!parsed.ok || !checkTrustedContext(parsed.value, context.scope).ok) return productionIssue('INVALID_INPUT');
    const ref = input.input[name + '_ref'];
    if (ref.id !== parsed.value.id || ref.revision !== parsed.value.revision || ref.content_hash !== parsed.value.content_hash || productionContentHash(parsed.value) !== parsed.value.content_hash) return productionIssue('HASH_MISMATCH');
  }
  const mapping = context.mapping;
  const policy = validateContract('PersonalizationSchema', context.row_policy);
  if (!policy.ok || !checkTrustedContext(policy.value, context.scope).ok || productionContentHash(policy.value) !== policy.value.content_hash || mapping.row_schema_ref.id !== policy.value.schema_id || mapping.row_schema_ref.revision !== policy.value.revision || mapping.row_schema_ref.content_hash !== policy.value.content_hash) return productionIssue('ROW_SCHEMA');
  if (new Set(mapping.headers).size !== mapping.headers.length || !mapping.headers.includes(mapping.row_id_header) || Object.keys(mapping.field_mapping).some(header => !mapping.headers.includes(header)) || new Set(Object.values(mapping.field_mapping)).size !== Object.values(mapping.field_mapping).length) return productionIssue('ROW_SCHEMA');
  if (Object.values(mapping.field_mapping).some(id => !policy.value.fields.some(field => field.field_id === id && field.source_policy === 'row_display')) || policy.value.fields.filter(field => field.source_policy === 'row_display' && field.required).some(field => !Object.values(mapping.field_mapping).includes(field.field_id))) return productionIssue('ROW_SCHEMA');
  if (input.input.checkpoint_ref) {
    const checkpoint = validateContract('CsvCheckpoint', context.checkpoint);
    if (!checkpoint.ok || !checkTrustedContext(checkpoint.value, context.scope).ok) return productionIssue('INVALID_INPUT');
    for (const key of ['file_ref', 'dialect_ref', 'mapping_ref']) if (canonicalJson(checkpoint.value[key]) !== canonicalJson(input.input[key])) return productionIssue('HASH_MISMATCH');
    if (canonicalJson(context.checkpoint_ref) !== canonicalJson(input.input.checkpoint_ref) || context.checkpoint_ref.content_hash !== hashManifest(checkpoint.value) || context.complete_record_byte_offset !== checkpoint.value.byte_offset || context.logical_record !== checkpoint.value.logical_record || context.physical_line !== checkpoint.value.physical_line) return productionIssue('INVALID_CHECKPOINT');
  }
  return productionOk({ request: request.value, parser_implemented: false, launch_authorized: false });
}
