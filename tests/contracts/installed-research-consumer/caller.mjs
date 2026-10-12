import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCorrectionHistoryStore, ReviewHistoryError } from '../../../src/review/history/store.mjs';

const NOW = '2026-10-12T14:00:00.000Z';
const EPOCH = Date.parse(NOW);
const EVENT = 'synthetic-consumer-event';
const SHA = (value) => createHash('sha256').update(value).digest('hex');
const ID = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = (value) => structuredClone(value);
const json = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

const SYNTHETIC_SOURCE_FACTS = {
  event_name: { status: 'sourced', value: 'Synthetic source event', sourceEvidence: [
    { evidenceId: 'synthetic-name', contentHash: SHA('Synthetic source event') },
  ] },
  event_date: { status: 'missing' },
  venue: { status: 'conflicting', candidates: [
    { originStatus: 'sourced', value: 'Synthetic Hall', sourceEvidence: [
      { evidenceId: 'synthetic-venue-a', contentHash: SHA('Synthetic Hall') },
    ] },
    { originStatus: 'inferred', value: 'Synthetic Room', sourceEvidence: [
      { evidenceId: 'synthetic-venue-b', contentHash: SHA('Synthetic Room') },
    ] },
  ] },
};

function localHarness(directory) {
  const request = Object.freeze({ syntheticPrincipal: 'synthetic-actor' });
  const retention = Object.freeze({});
  const authenticated = (input) => input.request === request
    && input.tenantId === 'synthetic-tenant' && input.actorId === 'synthetic-actor';
  const options = {
    directory,
    resolveTenant: (candidate) => candidate === request ? 'synthetic-tenant' : undefined,
    resolveActor: (candidate) => candidate === request ? 'synthetic-actor' : undefined,
    authorize: authenticated,
    authorizeBoundary(input) {
      return authenticated(input) ? Object.freeze({
        authorized: true, tenantId: input.tenantId, actorId: input.actorId,
        eventId: input.eventId, action: input.action, field: input.field, nowMs: EPOCH,
      }) : false;
    },
    resolveKey({ tenantId, purpose, keyId }) {
      const resolved = `${purpose}-synthetic`;
      if (keyId && keyId !== resolved) throw new Error('SYNTHETIC_KEY_MISMATCH');
      return { keyId: resolved, key: createHash('sha256').update(`test-only:${tenantId}:${purpose}`).digest() };
    },
    resolveRetention({ retentionHandle }) {
      if (retentionHandle !== retention) throw new Error('SYNTHETIC_RETENTION_DENIED');
      return { expiresAtMs: EPOCH + 60_000, policyId: 'synthetic-local-policy',
        policyVersion: '1', accessPolicy: 'tenant_private' };
    },
    lockedFields: ['event_status'],
    now: () => EPOCH,
  };
  return { request, retention, open: () => createCorrectionHistoryStore(options) };
}

// Independently authored controls, not an adapter from a history snapshot. These
// source URLs, IDs, metadata, provenance for an unknown fact, and authority refs
// are fabricated test inputs. They must never be added to a real local history.
function canonicalControls(research, consumerSha) {
  const reference = (contract, n) => ({ contract, schema_version: '1.0.0', id: ID(n),
    revision: 1, content_hash: `sha256:${SHA(`synthetic-ref-${contract}-${n}`)}` });
  const scope = { tenant_id: ID(1), project_id: ID(2) };
  const envelope = (contract, n) => ({ contract, schema_version: '1.0.0', policy_version: '1.0.0',
    event_id: ID(n), ...scope, correlation_id: ID(3),
    producer: { module: 'event-intelligence', source_revision: consumerSha, build_revision: 'synthetic-offline-control' },
    occurred_at: NOW, observed_at: NOW, ingested_at: NOW,
    environment: 'test', billing_mode: 'simulated', source_refs: [],
  });
  const retention = reference('PolicyVersion', 21);
  const access = reference('PolicyVersion', 22);
  const evidence = reference('EvidenceProjection', 23);
  const provenance = [{ source_id: 'synthetic-source', retrieved_at: NOW, evidence_ref: evidence }];
  const fact = (n, key, status, value, candidates = []) => {
    const output = { fact_id: ID(n), revision: 1, key, status, value,
      candidate_values: candidates, confidence: { basis: 'not_measured', value: null }, provenance: clone(provenance) };
    output.fact_hash = research.researchContentHash(output, 'fact_hash');
    return output;
  };
  const refs = {
    request_ref: reference('ResearchRequest', 24),
    request_receipt_ref: reference('ResearchRequestReceipt', 25),
    'answer_receipt_refs/0': reference('ResearchAnswerReceipt', 26),
    batch_receipt_ref: reference('ResearchBatchReceipt', 27),
    policy_ref: reference('PolicyVersion', 28),
    'sources/0/retention_ref': retention,
    'sources/0/access_ref': access,
    'facts/0/provenance/0/evidence_ref': evidence,
    'facts/1/provenance/0/evidence_ref': evidence,
    'facts/2/provenance/0/evidence_ref': evidence,
  };
  const pkg = { ...envelope('EventIntelligencePackage', 4), package_id: ID(5), package_version: 1,
    parent_ref: null, request_ref: clone(refs.request_ref), request_receipt_ref: clone(refs.request_receipt_ref),
    answer_receipt_refs: [clone(refs['answer_receipt_refs/0'])], batch_receipt_ref: clone(refs.batch_receipt_ref),
    sources: [{ source_id: 'synthetic-source', url: 'https://synthetic.example.test/event', retrieved_at: NOW,
      content_hash: `sha256:${SHA('Synthetic source event')}`, retention_ref: clone(retention), access_ref: clone(access) }],
    facts: [fact(6, 'event_name', 'known', 'Synthetic source event'), fact(7, 'event_date', 'unknown', null),
      fact(8, 'venue', 'conflicting', null, ['Synthetic Hall', 'Synthetic Room'])],
    asset_candidates: [], approved_assets: [], readiness: 'review', expires_at: '2026-10-12T14:01:00.000Z',
    policy_ref: clone(refs.policy_ref), decision_refs: [], usage_refs: [],
  };
  pkg.package_hash = research.researchContentHash(pkg, 'package_hash');
  const context = { scope: clone(scope), now: NOW, policy_version: '1.0.0', references: clone(refs),
    allowed_domains: ['synthetic.example.test'], max_age_seconds: 60 };
  const requestRefs = {
    project_request_ref: reference('ProjectRequest', 31),
    'constraints/retention_policy_ref': clone(retention), 'constraints/access_policy_ref': clone(access),
    decision_ref: reference('DecisionReceipt', 32), budget_ref: reference('BudgetReservation', 33),
    permissions_ref: reference('PolicyVersion', 34), policy_ref: clone(refs.policy_ref),
    cancellation_ref: reference('Cancellation', 35),
  };
  const request = { ...envelope('ResearchRequest', 30), request_id: ID(36), batch_id: ID(37),
    logical_operation_id: ID(38), workflow_id: ID(39), run_id: ID(40), job_id: ID(41),
    idempotency_key: 'synthetic-request', project_request_ref: clone(requestRefs.project_request_ref),
    source_seeds: [{ source_id: 'synthetic-source', url: 'https://synthetic.example.test/event' }],
    requested_facts: ['event_name', 'event_date', 'venue'], constraints: { allowed_domains: ['synthetic.example.test'],
      max_sources: 1, max_age_seconds: 60, retention_policy_ref: clone(retention), access_policy_ref: clone(access) },
    result_expectation: { contract: 'EventIntelligencePackage', schema_version: '1.0.0' },
    decision_ref: clone(requestRefs.decision_ref), budget_ref: clone(requestRefs.budget_ref),
    permissions_ref: clone(requestRefs.permissions_ref), policy_ref: clone(requestRefs.policy_ref),
    deadline_at: '2026-10-12T14:01:00.000Z', cancellation_ref: clone(requestRefs.cancellation_ref),
  };
  const requestContext = { ...context, references: clone(requestRefs), requested_facts: [...request.requested_facts],
    max_sources: 1 };
  return { pkg, context, request, requestContext };
}

function reject(result, code, path) {
  assert.equal(result.ok, false, 'expected a typed rejection');
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, 'typed rejection has error rows');
  assert.equal(result.errors[0].code, code);
  if (path !== undefined) assert.equal(result.errors[0].path, path);
  return { outcome: 'expected_rejection', actual: json(result) };
}

function localHash(snapshot) {
  const { contentHash, ...body } = snapshot;
  assert.equal(SHA(canonical(body)), contentHash, 'local content hash covers the complete local snapshot');
  return contentHash;
}

/** Run actual EI callers first; canonical fixtures remain separately labeled controls. */
export async function runInstalledResearchConsumer({ contracts, research, operations, directory, consumerSha }) {
  const cases = [];
  const observations = { authority: 'synthetic_in_process_only', sourceFacts: clone(SYNTHETIC_SOURCE_FACTS) };
  async function check(id, origin, expected, run) {
    try {
      const result = await run();
      cases.push({ id, origin, expected, status: 'passed', ...result });
    } catch (error) {
      cases.push({ id, origin, expected, status: 'failed', error: {
        name: error.name, code: error.code ?? null, message: error.message,
        ...(error.actual !== undefined ? { actual: error.actual } : {}),
        ...(error.expected !== undefined ? { expected: error.expected } : {}),
      } });
    }
  }
  const local = localHarness(directory);
  const store = local.open();
  const scope = await store.scopeForAuthenticatedRequest(local.request);
  let initial;
  let corrected;
  let correctionInput;

  await check('EI-X01-LOCAL-01', 'actual_local_history_caller', 'create immutable history with unknown and conflicting facts', async () => {
    initial = (await store.createHistory(scope, { eventId: EVENT, sourceFacts: clone(SYNTHETIC_SOURCE_FACTS),
      idempotencyKey: 'synthetic-initialize', retentionHandle: local.retention }, local.request)).snapshot;
    assert.equal(initial.revision, 1);
    assert.equal(initial.parentVersionId, null);
    assert.equal(initial.fields.event_date.status, 'missing');
    assert.equal(Object.hasOwn(initial.fields.event_date, 'value'), false);
    assert.equal(initial.fields.venue.status, 'conflicting');
    assert.equal(Object.hasOwn(initial.fields.venue, 'value'), false);
    assert.deepEqual(initial.fields.venue.candidates.map((row) => row.value), ['Synthetic Hall', 'Synthetic Room']);
    assert.deepEqual(initial.fields.venue.sourceClaims.map((row) => row.sourceRevision), [1, 1]);
    assert.equal(Object.isFrozen(initial), true);
    localHash(initial);
    observations.initial = json(initial);
    return { outcome: 'created', revision: initial.revision, contentHash: initial.contentHash };
  });
  await check('EI-X01-LOCAL-02', 'actual_local_history_caller', 'bind a local handoff reference to the exact version and hash', async () => {
    const result = await store.registerDownstreamReference(scope, { eventId: EVENT, versionId: initial.versionId,
      contentHash: initial.contentHash, referenceId: 'synthetic-handoff-1', kind: 'handoff_reference' }, local.request);
    assert.equal(result.versionId, initial.versionId);
    assert.equal(result.contentHash, initial.contentHash);
    assert.equal(result.replayed, false);
    observations.boundReference = json(result);
    return { outcome: 'bound_locally', versionId: result.versionId };
  });
  await check('EI-X01-LOCAL-03', 'actual_local_history_caller', 'correct without rewriting source claims or the prior version', async () => {
    correctionInput = { eventId: EVENT, baseVersionId: initial.versionId, baseContentHash: initial.contentHash,
      field: 'venue', value: 'Synthetic Hall', idempotencyKey: 'synthetic-correct', retentionHandle: local.retention };
    corrected = (await store.applyCorrection(scope, correctionInput, local.request)).snapshot;
    assert.equal(corrected.parentVersionId, initial.versionId);
    assert.equal(corrected.revision, 2);
    assert.notEqual(corrected.contentHash, initial.contentHash);
    assert.equal(corrected.fields.venue.status, 'customer_supplied');
    assert.equal(corrected.fields.venue.currentCorrection.revision, 2);
    assert.deepEqual(json(corrected.fields.venue.sourceClaims), json(initial.fields.venue.sourceClaims));
    assert.equal(corrected.fields.venue.disagreements[0].value, 'Synthetic Room');
    assert.equal(corrected.fields.event_date.status, 'missing');
    localHash(corrected);
    observations.corrected = json(corrected);
    // Retention is an opaque local capability, not a wire authority reference.
    observations.correctionInput = json({ ...correctionInput, retentionHandle: {} });
    return { outcome: 'corrected_locally', revision: corrected.revision, contentHash: corrected.contentHash };
  });
  await check('EI-X01-LOCAL-04', 'actual_local_history_caller', 'invalidate exactly the bound prior hash and version', async () => {
    assert.equal(corrected.invalidations.length, 1);
    const [invalidation] = corrected.invalidations;
    assert.equal(invalidation.referenceId, 'synthetic-handoff-1');
    assert.equal(invalidation.priorVersionId, initial.versionId);
    assert.equal(invalidation.priorContentHash, initial.contentHash);
    assert.equal(invalidation.materialChange, true);
    const [reference] = await store.listDownstreamReferences(scope, EVENT, local.request);
    assert.equal(reference.state, 'invalidated');
    assert.equal(reference.invalidatedByVersionId, corrected.versionId);
    observations.invalidatedReference = json(reference);
    return { outcome: 'invalidated_locally_external_delivery_unverified' };
  });
  await check('EI-X01-LOCAL-05', 'actual_local_history_caller', 'persist original and corrected versions after reopening SQLite', async () => {
    const reopened = local.open();
    const reopenedScope = await reopened.scopeForAuthenticatedRequest(local.request);
    const versions = await reopened.listHistory(reopenedScope, EVENT, local.request);
    assert.deepEqual(versions.map((row) => row.versionId), [initial.versionId, corrected.versionId]);
    assert.deepEqual(json(await reopened.getHistoryVersion(reopenedScope, EVENT, initial.versionId, local.request)), json(initial));
    assert.deepEqual(json(await reopened.getHistory(reopenedScope, EVENT, local.request)), json(corrected));
    return { outcome: 'durable', revisions: versions.map((row) => row.revision) };
  });
  await check('EI-X01-LOCAL-06', 'actual_local_history_caller', 'exact correction replay creates no new version or invalidation', async () => {
    const replay = await store.applyCorrection(scope, correctionInput, local.request);
    assert.equal(replay.replayed, true);
    assert.deepEqual(json(replay.snapshot), json(corrected));
    assert.equal((await store.listHistory(scope, EVENT, local.request)).length, 2);
    return { outcome: 'idempotent_replay', revision: replay.snapshot.revision };
  });
  const localNegative = async (id, expected, operation) => check(id, 'actual_local_history_caller', expected, async () => {
    await assert.rejects(operation, (error) => error instanceof ReviewHistoryError && error.code === expected);
    assert.deepEqual(json(await store.getHistory(scope, EVENT, local.request)), json(corrected));
    return { outcome: 'expected_rejection', actual: { code: expected }, head_unchanged: true };
  });
  await localNegative('EI-X01-LOCAL-07', 'REVIEW_VERSION_CONFLICT', () => store.applyCorrection(scope,
    { ...correctionInput, idempotencyKey: 'synthetic-stale', value: 'Another synthetic room' }, local.request));
  await localNegative('EI-X01-LOCAL-08', 'REVIEW_VERSION_CONFLICT', () => store.applyCorrection(scope,
    { ...correctionInput, baseVersionId: corrected.versionId, baseContentHash: '0'.repeat(64),
      idempotencyKey: 'synthetic-forged-hash' }, local.request));
  await localNegative('EI-X01-LOCAL-09', 'REVIEW_VERSION_CONFLICT', () => store.registerDownstreamReference(scope,
    { eventId: EVENT, versionId: initial.versionId, contentHash: initial.contentHash,
      referenceId: 'synthetic-stale-handoff', kind: 'handoff_reference' }, local.request));
  await localNegative('EI-X01-LOCAL-10', 'REVIEW_DENIED', () => store.getHistory(scope, EVENT, { ...local.request }));
  await localNegative('EI-X01-LOCAL-11', 'REVIEW_DENIED', () => store.getHistory({}, EVENT, local.request));
  await localNegative('EI-X01-LOCAL-12', 'REVIEW_FIELD_LOCKED', () => store.applyCorrection(scope,
    { ...correctionInput, baseVersionId: corrected.versionId, baseContentHash: corrected.contentHash,
      field: 'event_status', value: 'completed', idempotencyKey: 'synthetic-locked' }, local.request));

  await check('EI-X01-BRIDGE-01', 'actual_local_output_to_installed_package', 'direct local snapshot is not EventIntelligencePackage/1.0.0', () =>
    reject(contracts.validateContract('EventIntelligencePackage', initial), 'INVALID_PAYLOAD', '/schema_version'));
  await check('EI-X01-BRIDGE-02', 'actual_local_output_to_installed_package', 'direct corrected snapshot is not EventIntelligencePackage/1.0.0', () =>
    reject(research.checkEventIntelligencePackage(corrected, {}), 'INVALID_PAYLOAD', '/schema_version'));
  await check('EI-X01-BRIDGE-03', 'actual_local_input_to_installed_package', 'local correction command is not ResearchCorrectionRequest/1.0.0', () =>
    reject(contracts.validateContract('ResearchCorrectionRequest', correctionInput), 'INVALID_PAYLOAD', '/schema_version'));
  await check('EI-X01-BRIDGE-04', 'actual_local_output_to_installed_package', 'local correction result is not ResearchCorrectionReceipt/1.0.0', () =>
    reject(contracts.validateContract('ResearchCorrectionReceipt', { snapshot: corrected, replayed: false,
      invalidations: corrected.invalidations }), 'INVALID_PAYLOAD', '/schema_version'));
  await check('EI-X01-BRIDGE-05', 'actual_local_output_to_installed_package', 'local invalidation is not ResearchInvalidation/1.0.0', () =>
    reject(research.checkResearchInvalidation(corrected.invalidations[0], {}), 'INVALID_PAYLOAD', '/schema_version'));
  await check('EI-X01-BRIDGE-06', 'actual_local_output_to_installed_package', 'canonical alias adapter refuses the exact local snapshot', () =>
    reject(research.adaptResearchPackage(initial, 'canonical-alias-1.0.0'), 'PROFILE_UNREPRESENTABLE', '/contract'));
  for (const version of ['1.0', '1.1']) {
    await check(`EI-X01-BRIDGE-LOCAL-${version}`, 'actual_local_output_to_installed_package', `creative-local-${version} is not an EI history adapter`, () =>
      reject(research.adaptResearchPackage(initial, `creative-local-${version}`), 'PROFILE_UNREPRESENTABLE', ''));
  }
  await check('EI-X01-BRIDGE-07', 'actual_local_output_to_installed_package', 'renaming version/contract does not supply the required wire fields', () => {
    const forcedAlias = { ...json(initial), contract: 'EventIntelligencePackage', schema_version: '1.0.0' };
    const result = contracts.validateContract('EventIntelligencePackage', forcedAlias);
    reject(result, 'INVALID_PAYLOAD');
    const missing = result.errors.filter((row) => row.keyword === 'required').map((row) => row.path);
    for (const field of ['/tenant_id', '/project_id', '/sources', '/facts', '/package_hash', '/request_ref']) {
      assert.ok(missing.includes(field), `missing canonical field remains explicit: ${field}`);
    }
    observations.missingCanonicalFields = missing;
    return { outcome: 'expected_rejection', actual: json(result), missing_fields: missing };
  });
  await check('EI-X01-BRIDGE-08', 'actual_local_output_to_installed_package', 'local and canonical hash domains cannot be substituted', () => {
    localHash(initial);
    const canonicalAttempt = research.researchContentHash(initial, 'package_hash');
    assert.notEqual(canonicalAttempt, `sha256:${initial.contentHash}`);
    assert.equal(initial.contentHash, observations.initial.contentHash);
    return { outcome: 'distinct_hash_domains', local_hash: initial.contentHash,
      diagnostic_canonical_hash_of_local_object: canonicalAttempt, valid_canonical_package: false };
  });

  const controls = canonicalControls(research, consumerSha);
  const { pkg, context, request, requestContext } = controls;
  observations.canonicalControlOrigin = 'independently_constructed_synthetic_metadata_not_a_history_projection';
  observations.canonicalControls = json(controls);
  await check('EI-X01-CONTROL-01', 'independent_synthetic_canonical_control', 'synthetic ResearchRequest/1.0.0 passes the installed public helper', () => {
    assert.equal(research.checkResearchRequest(request, requestContext).ok, true);
    return { outcome: 'synthetic_control_accepted' };
  });
  await check('EI-X01-CONTROL-02', 'independent_synthetic_canonical_control', 'known/unknown/conflicting package remains review-required', () => {
    assert.equal(research.checkEventIntelligencePackage(pkg, context).ok, true);
    assert.deepEqual(pkg.facts.map((row) => row.status), ['known', 'unknown', 'conflicting']);
    assert.equal(pkg.readiness, 'review');
    assert.deepEqual(pkg.approved_assets, []);
    return { outcome: 'synthetic_control_accepted', rights: 'none', readiness: 'review' };
  });
  await check('EI-X01-CONTROL-03', 'independent_synthetic_canonical_control', 'roundtrip preserves facts, source bytes hashes, references and versions', () => {
    const parsed = contracts.parseContract('EventIntelligencePackage', JSON.stringify(pkg));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.value, pkg);
    assert.equal(research.researchContentHash(parsed.value, 'package_hash'), pkg.package_hash);
    assert.equal(research.checkEventIntelligencePackage(parsed.value, context).ok, true);
    return { outcome: 'lossless_synthetic_roundtrip' };
  });
  await check('EI-X01-CONTROL-04', 'independent_synthetic_canonical_control', 'fact tamper fails after valid enclosing package rehash', () => {
    const value = clone(pkg);
    value.facts[0].value = 'Tampered synthetic event';
    value.package_hash = research.researchContentHash(value, 'package_hash');
    return reject(research.checkEventIntelligencePackage(value, context), 'REFERENCE_MISMATCH', '/facts/0/fact_hash');
  });
  await check('EI-X01-CONTROL-05', 'independent_synthetic_canonical_control', 'source tamper without package rehash is rejected', () => {
    const value = clone(pkg); value.sources[0].content_hash = `sha256:${'0'.repeat(64)}`;
    return reject(research.checkEventIntelligencePackage(value, context), 'REFERENCE_MISMATCH', '/package_hash');
  });
  await check('EI-X01-CONTROL-06', 'independent_synthetic_canonical_control', 'wrong request reference fails independent expected binding', () => {
    const value = clone(pkg); value.request_ref.content_hash = `sha256:${'0'.repeat(64)}`;
    value.package_hash = research.researchContentHash(value, 'package_hash');
    return reject(research.checkEventIntelligencePackage(value, context), 'REFERENCE_MISMATCH', '/request_ref');
  });
  await check('EI-X01-CONTROL-07', 'independent_synthetic_canonical_control', 'forged tenant fails independent scope', () => {
    const value = clone(pkg); value.tenant_id = ID(999);
    value.package_hash = research.researchContentHash(value, 'package_hash');
    return reject(research.checkEventIntelligencePackage(value, context), 'SCOPE_MISMATCH', '/tenant_id');
  });
  await check('EI-X01-CONTROL-08', 'independent_synthetic_canonical_control', 'unknown and conflicting facts cannot be marked ready', () => {
    const value = clone(pkg); value.readiness = 'ready';
    value.package_hash = research.researchContentHash(value, 'package_hash');
    return reject(research.checkEventIntelligencePackage(value, context), 'UNSUPPORTED_CASE', '/readiness');
  });
  await check('EI-X01-CONTROL-09', 'independent_synthetic_canonical_control', 'unsupported minor is UNSUPPORTED_VERSION, never an aliased EI error', () =>
    reject(contracts.validateContract('EventIntelligencePackage', { ...pkg, schema_version: '1.1.0' }), 'UNSUPPORTED_VERSION', '/schema_version'));
  await check('EI-X01-CONTROL-10', 'independent_synthetic_canonical_control', 'additive unknown fields remain rejected by this candidate', () =>
    reject(contracts.validateContract('EventIntelligencePackage', { ...pkg, future_field: 'synthetic' }), 'INVALID_PAYLOAD', ''));
  await check('EI-X01-CONTROL-11', 'independent_synthetic_canonical_control', 'malformed JSON is a typed refusal', () =>
    reject(contracts.parseContract('EventIntelligencePackage', '{'), 'MALFORMED_JSON', ''));
  await check('EI-X01-CONTROL-12', 'independent_synthetic_canonical_control', 'bare local content hash is not a canonical reference digest', () =>
    reject(operations.validateVersionedReference({ ...pkg.request_ref, content_hash: initial.contentHash }), 'INVALID_PAYLOAD', ''));
  await check('EI-X01-CONTROL-13', 'independent_synthetic_canonical_control', 'unsupported reference schema version is explicit', () =>
    reject(operations.validateVersionedReference({ ...pkg.request_ref, schema_version: '1.1.0' }), 'UNSUPPORTED_VERSION', '/schema_version'));
  await check('EI-X01-CONTROL-14', 'independent_synthetic_canonical_control', 'payload values do not supply a missing trusted context', () =>
    reject(research.checkEventIntelligencePackage(pkg, {}), 'INVALID_TRUST_CONTEXT', ''));
  await check('EI-X01-CONTROL-15', 'independent_synthetic_canonical_control', 'canonical delivery fields are excluded from package content hash', () => {
    const value = clone(pkg); value.event_id = ID(888); value.observed_at = '2026-10-12T13:59:59.000Z';
    assert.equal(research.researchContentHash(value, 'package_hash'), pkg.package_hash);
    const changedFact = clone(pkg.facts[0]); changedFact.revision += 1;
    assert.notEqual(research.researchContentHash(changedFact, 'fact_hash'), pkg.facts[0].fact_hash);
    return { outcome: 'hash_domains_preserved' };
  });
  await check('EI-X01-CONTROL-16', 'independent_synthetic_canonical_control', 'no helper mutates original controls', () => {
    assert.deepEqual(json(controls), observations.canonicalControls);
    return { outcome: 'inputs_unchanged' };
  });
  const failures = cases.filter((row) => row.status !== 'passed').map((row) => row.id);
  return {
    diagnostic_status: failures.length ? 'failed' : 'passed_expected_incompatibility',
    consumer_acceptance: 'INCOMPATIBLE_HOLD', accepted_migration: false,
    acceptance_ids: { related: ['CON-01', 'CON-02', 'CON-03'], satisfied: [] },
    authority: 'synthetic', provider_mode: 'offline_no_provider_transport',
    imports: ['@jevelopers/shared-contracts', '@jevelopers/shared-contracts/research-creative', '@jevelopers/shared-contracts/operations'],
    contracts_exercised: ['ResearchRequest/1.0.0', 'EventIntelligencePackage/1.0.0',
      'ResearchCorrectionRequest/1.0.0', 'ResearchCorrectionReceipt/1.0.0', 'ResearchInvalidation/1.0.0'],
    definitions_exercised: ['ResearchFact (EventIntelligencePackage/1.0.0)', 'VersionedReference/1.0.0'],
    counts: { scenarios: cases.length, passed: cases.length - failures.length, failed: failures.length,
      skipped: 0, upstream_fixture_cases: 0,
      expected_rejections: cases.filter((row) => row.status === 'passed' && row.outcome === 'expected_rejection').length },
    failures, cases, observations,
    limitations: [
      'Actual consumer outputs are incompatible with the canonical wire package; no accepted public ResearchPackage API or wire adapter is supplied.',
      'Independent synthetic canonical controls are helper controls only, not actual wire consumer acceptance.',
      'Local source/evidence claims have no canonical URL/retrieved_at/access/retention reference envelope or accepted lossless status mapping.',
      'Synthetic host callbacks establish no real authentication, authorization, retention policy, permission, Finance authority or Creative acceptance.',
      'Local reference invalidation is observed; external delivery and recipient acknowledgement are unverified.',
      'ResearchRequest public orchestration, DecisionPort, assets/rights, canonical corrections/receipts and full catalog obligations remain unaccepted.',
      '0.9.8 is a separate exact archive that this diagnostic does not exercise; results cannot transfer to it.',
    ],
    acknowledgements: { accountable_owner: null, reviewer: null, producer: null, consumer: null, product: null, release: null },
  };
}
