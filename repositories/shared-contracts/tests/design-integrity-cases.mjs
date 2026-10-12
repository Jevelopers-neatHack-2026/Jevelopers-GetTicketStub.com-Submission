import { readFile } from 'node:fs/promises';
import { hashManifest, hashBytes, researchContentHash, commerceContentHash } from '../generated/index.mjs';

const id = '123e4567-e89b-42d3-a456-999999999999';
const digest = 'sha256:' + 'f'.repeat(64);
const reference = contract => ({ contract, schema_version: '1.0.0', id, revision: 2, content_hash: digest });
const read = name => readFile(new URL('../fixtures/' + name + '.json', import.meta.url), 'utf8').then(JSON.parse);
const at = (value, path) => path.split('/').reduce((v, key) => v[key], value);
const set = (value, path, replacement) => { const keys = path.split('/'), key = keys.pop(); keys.reduce((v, k) => v[k], value)[key] = replacement; };
const delivery = new Set(['contract', 'event_id', 'producer', 'occurred_at', 'observed_at', 'ingested_at', 'source_refs', 'trace_id', 'correlation_id', 'design_hash']);

async function seed(contract) {
  const fixture = await read(contract), row = fixture.cases.find(row => row.id === 'semantic-positive');
  if (!row) throw new Error('Missing semantic-positive: ' + contract);
  const value = { ...structuredClone(fixture.valid), ...structuredClone(row.set ?? {}) };
  for (const key of row.remove ?? []) delete value[key];
  return { value, context: structuredClone(row.context) };
}

function bindDesign(input) {
  const d = input.context.design, h = input.value.contract === 'ArtifactHandoffManifest' ? input.value : input.context.handoff;
  h.design_ref = { contract: d.contract, schema_version: d.schema_version, id: d.design_version_id, revision: d.revision, content_hash: d.design_hash };
  h.manifest_hash = commerceContentHash(h, 'manifest_hash');
  if (input.value.contract === 'ArtifactHandoffManifest') input.context.references.design_ref = structuredClone(h.design_ref);
  else {
    input.value.manifest_ref.content_hash = h.manifest_hash;
    input.context.references.manifest_ref = structuredClone(input.value.manifest_ref);
  }
}

function bindArtifacts(input) {
  const d = input.context.design, c = input.context, h = input.value.contract === 'ArtifactHandoffManifest' ? input.value : c.handoff;
  for (const key of ['artifact_id', 'role', 'byte_hash', 'byte_size', 'media_type']) h.artwork[key] = d.artwork[key];
  h.artwork_ref.id = d.artwork.artifact_id; h.artwork_ref.content_hash = d.artwork.byte_hash;
  h.preview_ref.id = d.preview.artifact_id; h.preview_ref.content_hash = d.preview.byte_hash;
  c.artwork_ref = structuredClone(h.artwork_ref); c.preview_ref = structuredClone(h.preview_ref);
  const receipt = c.current_approval.receipt;
  receipt.binding.subject_ref = structuredClone(h.artwork_ref); receipt.binding.preview_ref = structuredClone(h.preview_ref);
  receipt.receipt_hash = commerceContentHash(receipt, 'receipt_hash');
  c.expected_binding = structuredClone(receipt.binding);
  h.approval_ref.content_hash = receipt.receipt_hash;
  input.value.approval_ref = structuredClone(h.approval_ref);
  c.references.approval_ref = structuredClone(input.value.approval_ref);
  if (input.value.contract === 'ArtifactHandoffManifest') {
    c.references.artwork_ref = structuredClone(h.artwork_ref); c.references.preview_ref = structuredClone(h.preview_ref);
  } else input.value.consumed_artifacts = [structuredClone(h.artwork)];
}

function fullDesign(input) {
  const d = input.context.design;
  for (const key of ['workflow_id', 'run_id', 'job_id', 'artifact_id', 'order_id', 'evidence_id', 'usage_event_id', 'logical_operation_id', 'provider_attempt_id', 'billable_attempt_id', 'transport_attempt_id', 'provider_request_id']) d[key] = id;
  d.revision = 2; d.parent_ref = reference('DesignVersion');
  d.artwork.kind = 'transformed'; d.artwork.original_byte_hash = digest; d.artwork.source_artifact_ref = reference('Artifact');
  d.decision_refs = [reference('DecisionReceipt')]; d.usage_refs = [reference('UsageEvent')];
  d.design_hash = researchContentHash(d, 'design_hash'); bindDesign(input);
  return input;
}

function leaves(value, path = '') {
  if (value === null || typeof value !== 'object') return [[path, value]];
  return Object.entries(value).flatMap(([key, v]) => leaves(v, path ? path + '/' + key : key));
}

export async function designIntegrityCases() {
  const rows = [];
  const add = (id, input, expected_ok, extra = {}) => rows.push({ id, input, input_hash: hashManifest(input), expected_ok, ...extra });
  for (const contract of ['ArtifactHandoffManifest', 'ArtifactConsumptionReceipt']) {
    const base = await seed(contract), expanded = fullDesign(structuredClone(base));
    const prefix = contract + '/supplied-design/';
    add(prefix + 'exact', structuredClone(base), true);
    add(prefix + 'historical-parent-and-transformed-source-without-target-records', structuredClone(expanded), true);
    for (const malformed of [null, {}, [], 12]) { const input = structuredClone(base); input.context.design = malformed; add(prefix + 'malformed/' + JSON.stringify(malformed), input, false); }

    // Exercise each mutable leaf in the canonical body, including optional identity,
    // lineage, rendering metadata, facts-bearing brief identity and reference tuples.
    for (const [path, old] of leaves(expanded.context.design)) {
      if (delivery.has(path.split('/')[0]) || ['schema_version', 'policy_version', 'production_output_ref', 'artwork/role', 'preview/role'].includes(path) || path.endsWith('/schema_version')) continue;
      const input = structuredClone(expanded), d = input.context.design;
      let next = typeof old === 'number' ? old + 1 : old?.startsWith('sha256:') ? 'sha256:' + 'e'.repeat(64) : old?.startsWith('123e4567') ? '123e4567-e89b-42d3-a456-888888888888' : old + '_changed';
      if (path.endsWith('/contract')) next = 'OrderAuthorization';
      if (path === 'environment') next = 'development';
      if (path === 'billing_mode') next = 'sandbox';
      if (path === 'job_outcome') next = 'partial';
      if (path === 'artifact_state') { next = 'unavailable'; d.artwork = null; d.preview = null; }
      if (path === 'artwork/kind') { next = 'generated'; d.artwork.source_artifact_ref = null; d.artwork.original_byte_hash = d.artwork.byte_hash; }
      if (path.endsWith('/media_type')) next = 'image/jpeg';
      set(d, path, next);
      const targetPath = contract === 'ArtifactHandoffManifest' ? '/design' : '/handoff/design_ref';
      add(prefix + 'stale-body/' + path, input, false, { body_path: path, expected_design_wire: true, expected_error: { code: 'INVALID_TRUST_CONTEXT', path: targetPath + (['tenant_id', 'project_id'].includes(path) ? '' : '/design_hash') } });
    }
    for (const field of ['parent_ref', 'decision_refs', 'usage_refs', 'artwork/source_artifact_ref']) {
      const input = structuredClone(expanded); set(input.context.design, field, field.endsWith('refs') ? [] : null);
      add(prefix + 'stale-presence/' + field, input, false, { expected_design_wire: true });
    }
    for (const path of ['schema_version', 'policy_version', 'production_output_ref', 'artwork/role', 'preview/role']) {
      const input = structuredClone(expanded); set(input.context.design, path, path === 'production_output_ref' ? reference('ProductionBundle') : 'unsupported');
      add(prefix + 'shape/' + path, input, false, { expected_design_wire: false });
    }
    const slots = ['parent_ref', 'brief_ref', 'configuration_ref', 'control_ref', 'policy_ref', 'job_ref', 'artwork/source_artifact_ref', 'decision_refs/0', 'usage_refs/0'];
    const kinds = new Set(['parent_ref', 'brief_ref', 'control_ref', 'job_ref', 'artwork/source_artifact_ref']);
    for (const slot of slots) {
      for (const field of ['contract', 'schema_version', 'id', 'revision', 'content_hash']) {
        const input = structuredClone(expanded), ref = at(input.context.design, slot);
        ref[field] = field === 'contract' ? 'OrderAuthorization' : field === 'schema_version' ? '9.0.0' : field === 'id' ? '123e4567-e89b-42d3-a456-888888888888' : field === 'revision' ? ref.revision + 1 : 'sha256:' + 'e'.repeat(64);
        if (slot === 'artwork/source_artifact_ref' && field === 'content_hash') input.context.design.artwork.original_byte_hash = ref.content_hash;
        input.context.design.design_hash = researchContentHash(input.context.design, 'design_hash'); bindDesign(input);
        const permitted = field !== 'schema_version' && !(field === 'contract' && kinds.has(slot));
        const targetPath = contract === 'ArtifactHandoffManifest' ? '/design' : '/handoff/design_ref';
        add(prefix + 'recomputed-bound/' + slot + '/' + field, input, permitted, { expected_design_wire: field !== 'schema_version', ...(!permitted ? { expected_error: { code: 'INVALID_TRUST_CONTEXT', path: targetPath + (field === 'schema_version' ? '' : '/' + slot) } } : {}) });
      }
    }
    for (const slot of ['brief_ref', 'parent_ref', 'configuration_ref', 'control_ref', 'policy_ref', 'job_ref', 'artwork/source_artifact_ref', 'decision_refs/0', 'usage_refs/0']) {
      const input = structuredClone(expanded); at(input.context.design, slot).id = '123e4567-e89b-42d3-a456-888888888888';
      input.context.design.design_hash = researchContentHash(input.context.design, 'design_hash');
      add(prefix + 'recomputed-unbound/' + slot, input, false, { expected_design_wire: true });
    }
    for (const key of ['event_id', 'trace_id', 'correlation_id', 'occurred_at', 'observed_at', 'ingested_at', 'producer', 'source_refs']) {
      const input = structuredClone(base), d = input.context.design;
      if (key === 'producer') d.producer.build_revision = 'historical-delivery';
      else if (key === 'source_refs') d.source_refs = [{ kind: 'manifest', id: 'historical' }];
      else d[key] = key.endsWith('_at') ? '2025-01-01T00:00:00Z' : id;
      add(prefix + 'delivery-excluded/' + key, input, true, { expected_design_wire: true, expected_same_digest: true });
    }
    for (const slot of ['brief_ref', 'lineage_branch', 'job_outcome']) {
      const input = structuredClone(base), d = input.context.design;
      if (slot === 'brief_ref') d.brief_ref.id = id;
      else d[slot] = slot === 'job_outcome' ? 'partial' : 'historical_branch';
      d.design_hash = researchContentHash(d, 'design_hash'); bindDesign(input);
      add(prefix + 'legitimate-recomputed-bound/' + slot, input, true, { expected_design_wire: true });
    }
    for (const key of ['design_id', 'design_version_id', 'revision', 'environment', 'billing_mode', 'workflow_id', 'run_id', 'job_id', 'artifact_id', 'order_id', 'evidence_id', 'usage_event_id', 'logical_operation_id', 'provider_attempt_id', 'billable_attempt_id', 'transport_attempt_id', 'provider_request_id']) {
      const input = structuredClone(expanded), d = input.context.design;
      d[key] = key === 'revision' ? 3 : key === 'environment' ? 'development' : key === 'billing_mode' ? 'sandbox' : '123e4567-e89b-42d3-a456-888888888888';
      d.design_hash = researchContentHash(d, 'design_hash'); bindDesign(input);
      add(prefix + 'legitimate-identity-bound/' + key, input, true, { expected_design_wire: true });
    }
    for (const path of ['artwork/original_byte_hash', 'artwork/source_artifact_ref', 'parent_ref', 'decision_refs', 'usage_refs']) {
      const input = structuredClone(expanded), d = input.context.design;
      if (path === 'artwork/original_byte_hash') { d.artwork.original_byte_hash = 'sha256:' + 'e'.repeat(64); d.artwork.source_artifact_ref.content_hash = d.artwork.original_byte_hash; }
      else if (path === 'artwork/source_artifact_ref') { d.artwork.kind = 'generated'; d.artwork.original_byte_hash = d.artwork.byte_hash; d.artwork.source_artifact_ref = null; }
      else set(d, path, path.endsWith('refs') ? [] : null);
      if (path === 'parent_ref') d.revision = 1;
      d.design_hash = researchContentHash(d, 'design_hash'); bindDesign(input);
      add(prefix + 'legitimate-lineage-bound/' + path, input, true, { expected_design_wire: true });
    }
    for (const path of ['artwork/media_type', 'preview/media_type', 'artwork/kind', 'artwork/byte_hash', 'artwork/byte_size', 'preview/byte_hash', 'preview/byte_size', 'artwork/artifact_id', 'preview/artifact_id']) {
      const input = structuredClone(base), d = input.context.design, [part, field] = path.split('/');
      if (field === 'media_type') d[part][field] = 'image/jpeg';
      else if (field === 'kind') d.artwork.kind = 'original';
      else if (field === 'artifact_id') { input.context.artifact_bytes[id] = input.context.artifact_bytes[d[part].artifact_id]; d[part].artifact_id = id; }
      else {
        const bytes = field === 'byte_size' ? [7, 8, 9, 10] : [7, 8, 9];
        input.context.artifact_bytes[d[part].artifact_id] = bytes;
        d[part].byte_hash = hashBytes(Uint8Array.from(bytes)); d[part].byte_size = bytes.length;
        if (part === 'artwork') { d.artwork.original_byte_hash = d.artwork.byte_hash; d.preview.artwork_byte_hash = d.artwork.byte_hash; }
      }
      d.design_hash = researchContentHash(d, 'design_hash'); bindArtifacts(input); bindDesign(input);
      add(prefix + 'legitimate-rendering-bound/' + path, input, true, { expected_design_wire: true });
    }
    for (const key of ['contract', 'schema_version', 'id', 'revision', 'content_hash']) {
      const input = structuredClone(base), h = contract === 'ArtifactHandoffManifest' ? input.value : input.context.handoff;
      h.design_ref[key] = key === 'contract' ? 'OrderAuthorization' : key === 'schema_version' ? '9.0.0' : key === 'id' ? id : key === 'revision' ? 999 : digest;
      if (contract === 'ArtifactHandoffManifest') input.context.references.design_ref = structuredClone(h.design_ref);
      h.manifest_hash = commerceContentHash(h, 'manifest_hash');
      if (contract === 'ArtifactConsumptionReceipt') { input.value.manifest_ref.content_hash = h.manifest_hash; input.context.references.manifest_ref = structuredClone(input.value.manifest_ref); }
      add(prefix + 'direct-tuple/' + key, input, false);
    }
    const bytes = structuredClone(base); bytes.context.artifact_bytes[bytes.context.design.artwork.artifact_id] = [9, 9, 9];
    add(prefix + 'wrong-actual-bytes', bytes, false);
  }

  // Other directly supplied hashed records retain their existing digest boundaries.
  for (const contract of ['ApprovalReceipt', 'ApprovalReference', 'ApprovalVerificationRequest', 'ApprovalVerificationOutcome', 'ArtifactHandoffManifest', 'ArtifactConsumptionReceipt', 'ProductionBundle']) {
    const base = await seed(contract); add(contract + '/current-receipt/exact', structuredClone(base), true);
    const input = structuredClone(base); input.context.current_approval.receipt.producer.build_revision = 'stale-receipt';
    add(contract + '/current-receipt/stale-digest', input, false);
  }
  for (const contract of ['ArtifactConsumptionReceipt', 'ProductionBundle']) {
    const base = await seed(contract); const input = structuredClone(base); input.context.handoff.producer.build_revision = 'stale-handoff';
    add(contract + '/supplied-handoff/stale-digest', input, false);
    const renewed = structuredClone(base); renewed.context.handoff.access.expires_at = '2026-10-12T12:00:00Z';
    add(contract + '/supplied-handoff/access-renewal', renewed, true);
  }
  for (const slot of ['quote', 'current_authorization']) {
    const input = await seed('OrderAuthorization'), target = slot === 'quote' ? input.context.quote : input.context.current_authorization.authorization;
    target.producer.build_revision = 'stale-' + slot;
    add('OrderAuthorization/supplied-' + slot + '/stale-digest', input, false);
  }
  add('OrderAuthorization/current-records/exact', await seed('OrderAuthorization'), true);
  return rows;
}
