import { readJson } from '../scripts/generate.mjs';
import { hashManifest } from '../generated/index.mjs';

const id = n => '123e4567-e89b-42d3-a456-' + String(n).padStart(12, '0');
const errorRef = receipt => ({ ...receipt.policy_ref, contract: 'ErrorEnvelope' });
const outcomes = ['successful', 'failed', 'pending'];

function bindReceipts(input) {
  input.value.request_receipt_refs = input.context.request_receipts.map(receipt => ({ contract: receipt.contract, schema_version: receipt.schema_version, id: receipt.receipt_id, revision: 1, content_hash: hashManifest(receipt) }));
  for (const key of Object.keys(input.context.references)) if (key.startsWith('request_receipt_refs/')) delete input.context.references[key];
  input.value.request_receipt_refs.forEach((ref, index) => input.context.references['request_receipt_refs/' + index] = structuredClone(ref));
}

function partition(input, assignments) {
  for (const outcome of outcomes) input.value[outcome + '_request_ids'] = assignments.filter(row => row.outcome === outcome).map(row => row.request_id);
  if (!input.value.successful_request_ids.length) {
    input.value.answer_receipt_refs = [];
    for (const key of Object.keys(input.context.references)) if (key.startsWith('answer_receipt_refs/')) delete input.context.references[key];
  }
}

export async function researchBatchCases() {
  const manifest = await readJson('fixtures/ResearchBatchReceipt.json');
  const seed = { value: manifest.valid, context: manifest.cases.find(c => c.id === 'semantic-positive').context };
  const cases = [];
  for (const policy of ['partial', 'all_or_nothing']) for (const status of ['accepted', 'rejected', 'duplicate', 'unknown']) for (const outcome of outcomes) {
    const input = structuredClone(seed), receipt = input.context.request_receipts[0];
    receipt.status = status;
    receipt.error_ref = status === 'rejected' ? errorRef(receipt) : null;
    bindReceipts(input);
    input.value.acceptance_policy = input.context.acceptance_policy = policy;
    partition(input, [{ request_id: receipt.request_id, outcome }]);
    const permitted = status === 'accepted' || (status === 'rejected' ? outcome === 'failed' : outcome === 'pending');
    cases.push({ id: policy + '/' + status + '/' + outcome, input, expected: permitted ? { ok: true } : { ok: false, code: 'INVALID_BATCH', path: '/' + outcome + '_request_ids' } });
  }
  for (const status of ['accepted', 'rejected', 'duplicate', 'unknown']) {
    const input = structuredClone(seed), receipt = input.context.request_receipts[0];
    receipt.status = status;
    receipt.error_ref = status === 'rejected' ? null : errorRef(receipt);
    bindReceipts(input);
    cases.push({ id: 'malformed-status-error/' + status, input, expected: { ok: false, code: 'INVALID_RECEIPT', path: '/request_receipts/0/error_ref' } });
  }
  for (const field of ['contract', 'id', 'content_hash']) {
    const input = structuredClone(seed), receipt = input.context.request_receipts[0];
    receipt.request_ref[field] = { contract: 'OrderAuthorization', id: id(999), content_hash: 'sha256:' + 'a'.repeat(64) }[field];
    bindReceipts(input);
    cases.push({ id: 'receipt-request-identity/' + field, input, expected: { ok: false, code: 'INVALID_RECEIPT', path: '/request_receipts/0/request_ref' } });
  }
  for (const field of ['contract', 'schema_version', 'id', 'content_hash']) {
    const input = structuredClone(seed);
    input.value.request_receipt_refs[0][field] = { contract: 'OrderAuthorization', schema_version: '9.0.0', id: id(999), content_hash: 'sha256:' + 'a'.repeat(64) }[field];
    input.context.references['request_receipt_refs/0'] = structuredClone(input.value.request_receipt_refs[0]);
    cases.push({ id: 'batch-receipt-identity/' + field, input, expected: { ok: false, code: field === 'schema_version' ? 'INVALID_PAYLOAD' : 'INVALID_RECEIPT', path: field === 'schema_version' ? '/request_receipt_refs/0/schema_version' : '/request_receipt_refs' } });
  }
  const request = (await readJson('fixtures/ResearchRequest.json')).valid;
  const mixed = structuredClone(seed);
  mixed.context.request_receipts = ['accepted', 'accepted', 'rejected', 'unknown'].map((status, index) => {
    const r = { ...structuredClone(request), request_id: index ? id(400 + index) : request.request_id };
    const receipt = { ...structuredClone(seed.context.request_receipts[0]), receipt_id: id(500 + index), request_id: r.request_id, status, request_hash: hashManifest(r) };
    receipt.request_ref = { ...receipt.request_ref, id: r.request_id, content_hash: receipt.request_hash };
    receipt.error_ref = status === 'rejected' ? errorRef(receipt) : null;
    return receipt;
  });
  mixed.value.request_ids = mixed.context.request_ids = mixed.context.request_receipts.map(receipt => receipt.request_id);
  bindReceipts(mixed);
  partition(mixed, mixed.context.request_receipts.map((receipt, index) => ({ request_id: receipt.request_id, outcome: ['successful', 'failed', 'failed', 'pending'][index] })));
  cases.push({ id: 'mixed/genuine-partial', input: structuredClone(mixed), expected: { ok: true } });
  for (const change of ['all-or-nothing', 'omitted-membership', 'overlapping-membership', 'omitted-receipt', 'duplicate-receipt', 'receipt-id-collision', 'duplicate-reference', 'omitted-reference', 'foreign-scope', 'reordered']) {
    const input = structuredClone(mixed);
    let expected = { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/request_receipts' };
    switch (change) {
      case 'all-or-nothing':
        input.value.acceptance_policy = input.context.acceptance_policy = 'all_or_nothing';
        expected = { ok: false, code: 'INVALID_BATCH', path: '/acceptance_policy' }; break;
      case 'omitted-membership':
        input.value.pending_request_ids = [];
        expected = { ok: false, code: 'INVALID_BATCH', path: '/request_ids' }; break;
      case 'overlapping-membership':
        input.value.failed_request_ids.push(input.value.successful_request_ids[0]);
        expected = { ok: false, code: 'INVALID_BATCH', path: '/request_ids' }; break;
      case 'omitted-receipt': input.context.request_receipts.pop(); break;
      case 'omitted-reference': input.value.request_receipt_refs.pop(); break;
      case 'duplicate-receipt': input.context.request_receipts[1] = structuredClone(input.context.request_receipts[0]); bindReceipts(input); break;
      case 'receipt-id-collision': input.context.request_receipts[1].receipt_id = input.context.request_receipts[0].receipt_id; bindReceipts(input); break;
      case 'duplicate-reference':
        input.value.request_receipt_refs[1] = structuredClone(input.value.request_receipt_refs[0]);
        input.context.references['request_receipt_refs/1'] = structuredClone(input.value.request_receipt_refs[1]);
        expected = { ok: false, code: 'INVALID_RECEIPT', path: '/request_receipt_refs' }; break;
      case 'foreign-scope': input.context.request_receipts[1].tenant_id = id(999); bindReceipts(input); break;
      case 'reordered': input.context.request_receipts.reverse(); expected = { ok: true }; break;
      default: throw Error('Unknown control');
    }
    cases.push({ id: 'mixed/' + change, input, expected });
  }
  for (const malformed of [null, 3, 'receipt', [], {}, { status: 'accepted' }]) {
    const input = structuredClone(seed);
    input.context.request_receipts[0] = malformed;
    cases.push({ id: 'malformed-receipt/' + JSON.stringify(malformed), input, expected: { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/request_receipts' } });
  }
  for (const malformed of [null, {}, [], new Array(1)]) {
    const input = structuredClone(seed);
    input.context.request_receipts = malformed;
    cases.push({ id: 'malformed-receipt-array/' + (Array.isArray(malformed) && malformed.length ? 'sparse' : JSON.stringify(malformed)), input, expected: { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/request_receipts' } });
  }
  return cases;
}
