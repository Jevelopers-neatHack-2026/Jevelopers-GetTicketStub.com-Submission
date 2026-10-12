import { readFile } from 'node:fs/promises';
import { hashManifest, researchContentHash } from '../generated/index.mjs';

const contracts = ['ProjectRequest', 'ResearchRequest', 'EventIntelligencePackage', 'ResearchRequestReceipt', 'ResearchAnswerReceipt', 'ResearchBatchReceipt', 'ResearchCorrectionRequest', 'ResearchCorrectionReceipt', 'ResearchInvalidation', 'CreativeBrief', 'DesignControlSchema', 'DesignVersion'];
const digests = { EventIntelligencePackage: 'package_hash', CreativeBrief: 'brief_hash', DesignControlSchema: 'control_schema_hash', DesignVersion: 'design_hash' };
const supportedKinds = new Set(['EventIntelligencePackage', 'ResearchRequest', 'ResearchRequestReceipt', 'ResearchAnswerReceipt', 'ResearchBatchReceipt', 'ResearchCorrectionReceipt', 'ResearchFact', 'CreativeBrief', 'DesignControlSchema', 'DesignVersion', 'JobStatus', 'Artifact', 'ApprovalReference']);
const read = name => readFile(new URL('../fixtures/' + name + '.json', import.meta.url), 'utf8').then(JSON.parse);
export async function researchReferenceCases() {
  const rows = [];
  const seed = async (contract, id = 'semantic-positive') => {
    const fixture = await read(contract), row = fixture.cases.find(row => row.id === id);
    if (!row) throw Error('Missing fixture: ' + contract + '/' + id);
    const value = structuredClone(fixture.valid);
    for (const key of row.remove ?? []) delete value[key];
    Object.assign(value, structuredClone(row.set ?? {}));
    return { value, context: structuredClone(row.context) };
  };
  const add = (id, input, expected_ok) => rows.push({ id, input, input_hash: hashManifest(input), expected_ok });
  const rehash = input => { const field = digests[input.value.contract]; if (field) input.value[field] = researchContentHash(input.value, field); };
  const at = (value, path) => path.split('/').reduce((v, key) => v[key], value);
  for (const contract of contracts) {
    const base = await seed(contract);
    add(contract + '/exact', structuredClone(base), true);
    for (const malformed of [null, {}, [], 17]) add(contract + '/context/' + JSON.stringify(malformed), { ...structuredClone(base), context: malformed }, false);
    for (const [path, ref] of Object.entries(base.context.references)) {
      let actual;
      try { actual = at(base.value, path); } catch { continue; }
      if (!actual || !Object.hasOwn(actual, 'schema_version')) continue;
      for (const field of ['contract', 'schema_version', 'id', 'revision', 'content_hash']) {
        const input = structuredClone(base), reference = at(input.value, path);
        reference[field] = field === 'contract' ? 'OrderAuthorization' : field === 'schema_version' ? '9.0.0' : field === 'id' ? '123e4567-e89b-42d3-a456-999999999999' : field === 'revision' ? ref.revision + 1 : 'sha256:' + 'f'.repeat(64);
        rehash(input);
        add(contract + '/' + path + '/independent-lookup/' + field, input, false);
      }
      if (supportedKinds.has(ref.contract)) {
        const input = structuredClone(base), reference = at(input.value, path);
        reference.contract = 'OrderAuthorization';
        input.context.references[path] = structuredClone(reference);
        if (path === 'expected_package_ref') input.context.correction_authority.expected_package_ref = structuredClone(reference);
        rehash(input);
        add(contract + '/' + path + '/rebound-wrong-kind', input, false);
      }
      for (const malformed of [null, {}, []]) {
        const input = structuredClone(base); input.context.references[path] = malformed;
        add(contract + '/' + path + '/malformed-lookup/' + JSON.stringify(malformed), input, false);
      }
    }
  }
  const bindings = [
    ['DesignVersion', 'semantic-positive', 'job_ref', 'job', 'job_id', 'revision'],
    ['DesignVersion', 'new-immutable-branch', 'parent_ref', 'prior_design', 'design_version_id', 'revision'],
    ['CreativeBrief', 'semantic-positive', 'package_ref', 'package', 'package_id', 'package_version'],
    ['ResearchAnswerReceipt', 'semantic-positive', 'package_ref', 'package', 'package_id', 'package_version'],
    ['EventIntelligencePackage', 'parent-linked-new-version', 'parent_ref', 'prior_package', 'package_id', 'package_version'],
    ['ResearchCorrectionRequest', 'semantic-positive', 'expected_package_ref', 'package', 'package_id', 'package_version'],
    ['ResearchCorrectionReceipt', 'externally-accepted-new-version', 'new_package_ref', 'new_package', 'package_id', 'package_version']
  ];
  for (const [contract, fixture, path, slot] of bindings) {
    const base = await seed(contract, fixture), record = base.context[slot];
    const nested = record.contract === 'EventIntelligencePackage' ? 'request_ref' : record.contract === 'DesignVersion' ? 'brief_ref' : null;
    if (!nested) continue;
    for (const field of ['contract', 'schema_version']) {
      const input = structuredClone(base), target = input.context[slot];
      target[nested][field] = field === 'contract' ? 'OrderAuthorization' : '9.0.0';
      target[digests[target.contract]] = researchContentHash(target, digests[target.contract]);
      input.value[path].content_hash = target[digests[target.contract]];
      input.context.references[path] = structuredClone(input.value[path]);
      if (path === 'expected_package_ref') input.context.correction_authority.expected_package_ref = structuredClone(input.value[path]);
      rehash(input);
      add(contract + '/' + path + '/context-record-nested/' + field, input, false);
    }
  }
  for (const [contract, fixture, path, slot, identity, revision] of bindings) {
    const base = await seed(contract, fixture);
    add(contract + '/' + path + '/record-exact', structuredClone(base), true);
    for (const field of ['contract', 'schema_version', 'id', 'revision', 'content_hash']) {
      const input = structuredClone(base), ref = input.value[path];
      ref[field] = field === 'contract' ? 'OrderAuthorization' : field === 'schema_version' ? '9.0.0' : field === 'id' ? '123e4567-e89b-42d3-a456-999999999999' : field === 'revision' ? ref.revision + 1 : 'sha256:' + 'f'.repeat(64);
      input.context.references[path] = structuredClone(ref);
      if (path === 'expected_package_ref') input.context.correction_authority.expected_package_ref = structuredClone(ref);
      rehash(input);
      add(contract + '/' + path + '/rebound/' + field, input, false);
      if (field === 'contract') rows.at(-1).expected_error = { code: contract === 'ResearchAnswerReceipt' ? 'INVALID_RECEIPT' : 'REFERENCE_MISMATCH', path: '/' + path };
    }
    for (const field of [identity, revision, 'schema_version', 'contract']) {
      const input = structuredClone(base), record = input.context[slot];
      record[field] = field === identity ? '123e4567-e89b-42d3-a456-999999999999' : field === revision ? record[field] + 1 : field === 'schema_version' ? '9.0.0' : 'OrderAuthorization';
      add(contract + '/' + path + '/different-record/' + field, input, false);
    }
    for (const recalculate of [false, true]) {
      const input = structuredClone(base), record = input.context[slot];
      if (record.contract === 'JobStatus') record.producer.build_revision = 'different-build';
      else if (record.contract === 'DesignVersion') record.lineage_branch = 'different-parent-branch';
      else record.readiness = record.readiness === 'ready' ? 'review' : 'ready';
      if (recalculate && digests[record.contract]) record[digests[record.contract]] = researchContentHash(record, digests[record.contract]);
      add(contract + '/' + path + '/different-record-content/rehash-' + recalculate, input, false);
    }
    for (const malformed of [null, {}, [], 'missing']) {
      const input = structuredClone(base); if (malformed === 'missing') delete input.context[slot]; else input.context[slot] = malformed;
      add(contract + '/' + path + '/record-context/' + JSON.stringify(malformed), input, false);
    }
  }
  for (const contract of ['ResearchRequestReceipt', 'ResearchAnswerReceipt']) {
    const input = await seed(contract);
    input.value.request_ref.revision = 73;
    input.context.references.request_ref = structuredClone(input.value.request_ref);
    add(contract + '/revision-free-request/descriptor-revision-73', input, true);
    for (const malformed of [null, {}, [], 'missing']) {
      const invalid = await seed(contract); if (malformed === 'missing') delete invalid.context.request; else invalid.context.request = malformed;
      add(contract + '/revision-free-request/context/' + JSON.stringify(malformed), invalid, false);
    }
    for (const field of ['contract', 'schema_version', 'request_id', 'batch_id']) {
      const invalid = await seed(contract);
      invalid.context.request[field] = field === 'contract' ? 'ProjectRequest' : field === 'schema_version' ? '9.0.0' : '123e4567-e89b-42d3-a456-999999999999';
      add(contract + '/revision-free-request/different-record/' + field, invalid, false);
    }
  }
  const batch = await seed('ResearchBatchReceipt');
  batch.value.request_receipt_refs[0].revision = 73;
  batch.context.references['request_receipt_refs/0'] = structuredClone(batch.value.request_receipt_refs[0]);
  add('ResearchBatchReceipt/revision-free-receipt/descriptor-revision-73', batch, true);
  for (const [contract, fixture] of [['EventIntelligencePackage', 'parent-linked-new-version'], ['DesignVersion', 'new-immutable-branch'], ['ResearchCorrectionReceipt', 'externally-accepted-new-version']]) {
    const input = await seed(contract, fixture), historical = input.context.prior_package ?? input.context.prior_design ?? input.context.package;
    historical.occurred_at = '2020-01-01T00:00:00Z';
    if (historical.expires_at) historical.expires_at = '2020-01-02T00:00:00Z';
    const field = digests[historical.contract]; historical[field] = researchContentHash(historical, field);
    const ref = input.value.parent_ref ?? input.value.expected_package_ref;
    ref.content_hash = historical[field];
    input.context.references[input.value.parent_ref ? 'parent_ref' : 'expected_package_ref'] = structuredClone(ref);
    if (input.context.correction_authority) {
      input.context.correction_authority.expected_package_ref = structuredClone(ref);
      input.context.request.expected_package_ref = structuredClone(ref);
      input.value.request_hash = hashManifest(input.context.request);
      const next = input.context.new_package;
      next.parent_ref.content_hash = historical[field]; next.package_hash = researchContentHash(next, 'package_hash');
      input.value.new_package_ref.content_hash = next.package_hash; input.context.references.new_package_ref = structuredClone(input.value.new_package_ref);
    }
    rehash(input);
    add(contract + '/historical-parent-no-current-status', input, true);
  }
  return rows;
}
