import { readJson } from '../scripts/generate.mjs';
import { commerceContentHash } from '../generated/index.mjs';

const wrongId = '123e4567-e89b-42d3-a456-000000000999';
const wrongHash = 'sha256:' + 'a'.repeat(64);
const links = [
  ['ProductionBundle', 'handoff_ref', 'REFERENCE_MISMATCH', '/handoff_ref', 'bundle_hash', true],
  ['ArtifactConsumptionReceipt', 'manifest_ref', 'INVALID_RECEIPT', '/manifest_ref', null, true],
  ['ArtifactHandoffManifest', 'design_ref', 'REFERENCE_MISMATCH', '/design_ref', 'manifest_hash', true],
  ['ApprovalReference', 'receipt_ref', 'STALE_APPROVAL', '/receipt_ref'],
  ['ApprovalVerificationRequest', 'approval_ref', 'STALE_APPROVAL', '/expected_binding'],
  ['ApprovalVerificationOutcome', 'request_ref', 'INVALID_RECEIPT', '/status'],
  ['ApprovalVerificationOutcome', 'receipt_ref', 'INVALID_RECEIPT', '/verified_binding'],
  ['ArtifactHandoffManifest', 'approval_ref', 'STALE_APPROVAL', '/approval_ref', 'manifest_hash'],
  ['ArtifactConsumptionReceipt', 'approval_ref', 'STALE_APPROVAL', '/approval_ref'],
  ['ProductionBundle', 'approval_ref', 'STALE_APPROVAL', '/approval_ref', 'bundle_hash'],
  ['OrderAuthorization', 'quote_ref', 'STALE_APPROVAL', '/quote_ref', 'authorization_hash', true],
  ['OrderAuthorization', 'bundle_ref', 'INVALID_TRUST_CONTEXT', '/quote', 'authorization_hash']
];

export async function commerceSemanticLinkCases() {
  const cases = [];
  for (const [contract, slot, code, path, hashField, revisioned] of links) {
    const manifest = await readJson('fixtures/' + contract + '.json');
    const seed = { value: manifest.valid, context: manifest.cases.find(c => c.id === 'semantic-positive').context };
    for (const field of ['exact', 'contract', 'schema_version', 'id', 'content_hash', ...(revisioned || slot === 'bundle_ref' ? ['revision'] : [])]) {
      const input = structuredClone(seed);
      if (field !== 'exact') {
        input.value[slot][field] = { contract: 'OrderAuthorization', schema_version: '9.0.0', id: wrongId, content_hash: wrongHash, revision: 999 }[field];
        input.context.references[slot] = structuredClone(input.value[slot]);
        if (hashField) input.value[hashField] = commerceContentHash(input.value, hashField);
        if (contract === 'OrderAuthorization') input.context.current_authorization.authorization = structuredClone(input.value);
      }
      const expected = field === 'exact' ? { ok: true } : field === 'schema_version' ? { ok: false, code: 'INVALID_PAYLOAD', path: '/' + slot + '/schema_version' } : { ok: false, code, path };
      cases.push({ id: contract + '/' + slot + '/' + field, input, expected });
    }
  }
  const manifest = await readJson('fixtures/ProductionBundle.json');
  const seed = { value: manifest.valid, context: manifest.cases.find(c => c.id === 'semantic-positive').context };
  for (const mode of ['renew-access', 'bad-manifest-digest', 'foreign-handoff-scope', 'malformed-handoff', 'revoked-approval']) {
    const input = structuredClone(seed);
    let expected;
    switch (mode) {
      case 'renew-access':
        input.context.handoff.access.locator_ref.id = wrongId;
        input.context.handoff.access.expires_at = '2026-10-10T14:00:00Z';
        expected = { ok: true }; break;
      case 'bad-manifest-digest':
        input.context.handoff.manifest_hash = wrongHash;
        input.value.handoff_ref.content_hash = wrongHash;
        input.context.references.handoff_ref = structuredClone(input.value.handoff_ref);
        input.value.bundle_hash = commerceContentHash(input.value, 'bundle_hash');
        expected = { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/handoff/manifest_hash' }; break;
      case 'foreign-handoff-scope':
        input.context.handoff.tenant_id = wrongId;
        expected = { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/handoff' }; break;
      case 'malformed-handoff':
        input.context.handoff = null;
        expected = { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/handoff' }; break;
      case 'revoked-approval':
        input.context.current_approval.status = 'revoked';
        expected = { ok: false, code: 'STALE_APPROVAL', path: '/status_ref' }; break;
      default: throw Error('Unknown control');
    }
    cases.push({ id: 'ProductionBundle/' + mode, input, expected });
  }
  const advanced = structuredClone(seed);
  advanced.context.handoff.revision = 2;
  advanced.context.handoff.manifest_hash = commerceContentHash(advanced.context.handoff, 'manifest_hash');
  advanced.value.handoff_ref.revision = 2;
  advanced.value.handoff_ref.content_hash = advanced.context.handoff.manifest_hash;
  advanced.context.references.handoff_ref = structuredClone(advanced.value.handoff_ref);
  advanced.value.bundle_hash = commerceContentHash(advanced.value, 'bundle_hash');
  cases.push({ id: 'ProductionBundle/exact-advanced-handoff', input: advanced, expected: { ok: true } });
  const consumption = await readJson('fixtures/ArtifactConsumptionReceipt.json');
  for (const field of ['contract', 'id', 'revision', 'content_hash']) {
    const input = { value: structuredClone(consumption.valid), context: structuredClone(consumption.cases.find(c => c.id === 'semantic-positive').context) };
    input.context.handoff.design_ref[field] = { contract: 'OrderAuthorization', id: wrongId, revision: 999, content_hash: wrongHash }[field];
    input.context.handoff.manifest_hash = commerceContentHash(input.context.handoff, 'manifest_hash');
    input.value.manifest_ref.content_hash = input.context.handoff.manifest_hash;
    input.context.references.manifest_ref = structuredClone(input.value.manifest_ref);
    cases.push({ id: 'ArtifactConsumptionReceipt/supplied-design/' + field, input, expected: { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/handoff/design_ref' } });
  }
  const outcome = await readJson('fixtures/ApprovalVerificationOutcome.json');
  for (const status of ['rejected', 'stale', 'expired', 'revoked', 'unavailable']) for (const field of ['exact', 'absent', 'contract', 'id', 'content_hash']) {
    const input = { value: structuredClone(outcome.valid), context: structuredClone(outcome.cases.find(c => c.id === 'semantic-positive').context) };
    input.value.status = input.context.current_approval.status = status;
    input.value.verified_binding = null;
    if (field === 'absent') { input.value.receipt_ref = null; delete input.context.references.receipt_ref; }
    else if (field !== 'exact') {
      input.value.receipt_ref[field] = { contract: 'OrderAuthorization', id: wrongId, content_hash: wrongHash }[field];
      input.context.references.receipt_ref = structuredClone(input.value.receipt_ref);
    }
    cases.push({ id: 'ApprovalVerificationOutcome/' + status + '/' + field, input, expected: ['exact', 'absent'].includes(field) ? { ok: true } : { ok: false, code: 'INVALID_RECEIPT', path: '/receipt_ref' } });
  }
  const authorization = await readJson('fixtures/OrderAuthorization.json');
  const input = { value: structuredClone(authorization.valid), context: structuredClone(authorization.cases.find(c => c.id === 'semantic-positive').context) };
  input.context.quote.quote_version = 2;
  input.context.quote.quote_hash = commerceContentHash(input.context.quote, 'quote_hash');
  input.value.quote_ref.revision = 2;
  input.value.quote_ref.content_hash = input.context.quote.quote_hash;
  input.context.references.quote_ref = structuredClone(input.value.quote_ref);
  input.value.authorization_hash = commerceContentHash(input.value, 'authorization_hash');
  input.context.current_authorization.authorization = structuredClone(input.value);
  cases.push({ id: 'OrderAuthorization/exact-advanced-quote', input, expected: { ok: true } });
  return cases;
}
