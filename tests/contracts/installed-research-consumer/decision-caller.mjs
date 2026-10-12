import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createEvidenceStore } from '../../../src/evidence/store.mjs';
import { composeSourceIdentity } from '../../../src/discovery/identity/from-extraction.mjs';
import {
  prepareIdentityQuestionFromComposition,
  SourceIdentityQuestionPreparationError,
} from '../../../src/decisions/questions/index.mjs';

const QUESTION_ID = 'Q-EI-IDENTITY:v1';
const NOW = '2026-10-12T14:00:00.000Z';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.parse(JSON.stringify(value));
const clone = (value) => structuredClone(value);

function source(city, day) {
  const event = { '@type': 'Event', name: 'Synthetic River Night', series: 'Synthetic River Tour',
    edition: '2027', startDate: `2027-08-${day}`, eventStatus: 'https://schema.org/EventScheduled',
    location: { name: `Synthetic Hall ${city}`, address: { addressLocality: city } } };
  const bytes = Buffer.from(`<!doctype html><script type="application/ld+json">${JSON.stringify(event)}</script>`);
  return { url: `https://synthetic.example.test/${city.toLowerCase()}`, bytes };
}

function localEvidenceStore(directory) {
  const request = Object.freeze({ syntheticPrincipal: 'decision-synthetic-actor' });
  const retention = Object.freeze({});
  const tenant = 'decision-synthetic-tenant';
  const store = createEvidenceStore({
    directory,
    resolveTenant: (candidate) => candidate === request ? tenant : undefined,
    resolveKey({ tenantId, purpose, keyId }) {
      const expected = `${purpose}-decision-synthetic`;
      assert.equal(tenantId, tenant);
      if (keyId) assert.equal(keyId, expected);
      return { keyId: expected, key: createHash('sha256').update(`test-only:${tenantId}:${purpose}`).digest() };
    },
    resolveRetention({ tenantId, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
      assert.equal(tenantId, tenant);
      if (kind === 'evidence') assert.equal(retentionHandle, retention);
      return { expiresAtMs: sourceExpiresAtMs ?? nowMs + 120_000,
        policyId: 'decision-synthetic-private', policyVersion: '1', accessPolicy: 'tenant_private' };
    },
    authorizePrivateAccess: (input) => input.tenantId === tenant && input.request === request,
    authorizePrivateAccessCurrent: (input) => input.tenantId === tenant && input.request === request,
    maxRetentionMs: 180_000,
  });
  return { store, request, retention };
}

// This is a structural helper control, independently authored from the schema.
// None of its IDs, references or authority fields are an EI plan projection.
function syntheticRequest(consumerSha) {
  const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const reference = (contract, n) => ({ contract, schema_version: '1.0.0', id: id(n),
    revision: 1, content_hash: `sha256:${sha256(`decision-synthetic-ref-${n}`)}` });
  return { contract: 'DecisionPortRequest', schema_version: '1.0.0', policy_version: '1.0.0',
    event_id: id(1), tenant_id: id(2), project_id: id(3), correlation_id: id(4),
    producer: { module: 'event-intelligence', source_revision: consumerSha, build_revision: 'synthetic-syntax-control' },
    occurred_at: NOW, observed_at: NOW, ingested_at: NOW, environment: 'test', billing_mode: 'simulated', source_refs: [],
    request_id: id(5), batch_id: id(6), logical_operation_id: id(7), billable_attempt_id: id(8),
    attempt_number: 1, attempt_limit: 1, deadline_at: '2026-10-12T14:00:08.000Z',
    cancellation_ref: reference('Cancellation', 9), model_ref: reference('PolicyVersion', 10),
    policy_ref: reference('PolicyVersion', 11), budget_ref: reference('BudgetReservation', 12),
    state_ref: reference('EvidenceProjection', 13), execution_mode: 'independent_batch',
    acceptance_policy: 'all_or_nothing', prior_answers: {},
    questions: { synthetic_identity: { type: 'choice', instructions: 'Synthetic syntax control only.',
      depends_on: [], criteria: { distinct: 'Different synthetic events.', unknown: 'Insufficient synthetic evidence.' },
      eligible_candidate_ids: ['distinct', 'unknown'], minimum_confidence: 0.8 } },
  };
}

/** The supplied helpers are the launcher's installed public package imports. */
export async function runInstalledDecisionConsumer({ contracts, operations, directory, consumerSha, check, reject }) {
  const inputs = [source('Bristol', '01'), source('York', '02')];
  const host = localEvidenceStore(path.join(directory, 'decision-evidence'));
  const observations = { origin: 'actual_local_source_composer_and_question_preparation',
    source_origin: 'independently_authored_synthetic_html_no_retrieval',
    host_authority: 'synthetic_in_process_only', handler_calls: 0,
    calls: { actual_plan_schema: 0, actual_plan_request_check: 0, actual_plan_bound_port: 0,
      synthetic_control_bound_port: 0 } };
  let composition;
  let prepared;
  let before;
  let requestRefusalVerified = false;
  let boundRefusalVerified = false;
  let missingContextRefusalVerified = false;
  const snapshot = () => json({
    inputs: inputs.map(({ url, bytes }) => ({ url, bytes_base64: bytes.toString('base64'),
      byte_length: bytes.length, content_sha256: sha256(bytes), fetched_at: NOW })),
    composition, prepared,
  });
  const port = operations.bindDecisionPort(() => {
    observations.handler_calls += 1;
    throw new Error('DIAGNOSTIC_HANDLER_MUST_NOT_RUN');
  });

  await check('EI-X01-DECISION-LOCAL-01', 'actual_local_source_and_question_caller',
    'persist synthetic source evidence and prepare an immutable identity question through real EI callers', async () => {
      composition = await composeSourceIdentity({ request: host.request, evidenceStore: host.store,
        sources: inputs.map(({ url, bytes }) => ({ retentionHandle: host.retention,
          document: { url, bytes, contentType: 'text/html; charset=utf-8', fetchedAt: NOW, redirects: 0 } })) });
      assert.equal(composition.sources.length, inputs.length);
      assert.equal(composition.occurrenceCandidates.length, 2);
      for (const [index, stored] of composition.sources.entries()) {
        assert.equal(stored.evidence.contentHash, sha256(inputs[index].bytes));
        assert.equal(stored.storedSource.sourceUrl, inputs[index].url);
      }
      prepared = prepareIdentityQuestionFromComposition(composition, {
        candidateIds: composition.occurrenceCandidates.map((candidate) => candidate.candidateId),
        languageByEvidenceId: Object.fromEntries(composition.sources.map((item) => [item.evidence.evidenceId, 'en'])),
      });
      const { plan, sourceIdentityBinding } = prepared;
      const question = plan.questions.find((item) => item.questionId === QUESTION_ID);
      assert.equal(question.eligible, true);
      assert.equal(plan.readinessStatus, 'blocked');
      assert.equal(plan.executionStatus, 'not_dispatched');
      assert.equal(plan.promotionStatus, 'unpromoted');
      assert.equal(Object.values(plan.authorityScope).every((value) => value === false), true);
      assert.equal(Object.isFrozen(plan), true);
      for (const key of ['sourceEvidenceHash', 'planHash']) assert.equal(sourceIdentityBinding.bindingHashes[key], plan[key]);
      for (const key of ['targetBindingHash', 'targetStateHash', 'questionInstanceHash']) {
        assert.equal(sourceIdentityBinding.bindingHashes[key], question[key]);
      }
      before = snapshot();
      observations.before = before;
      observations.internal_hashes = { ...sourceIdentityBinding.bindingHashes, stateHash: plan.stateHash };
      return { outcome: 'prepared_from_actual_stored_evidence', source_count: inputs.length,
        plan_hash: plan.planHash, state_hash: plan.stateHash, candidate_only: true };
    });
  await check('EI-X01-DECISION-BRIDGE-01', 'actual_local_plan_to_installed_package',
    'the unchanged actual plan is not DecisionPortRequest/1.0.0', () => {
      const plan = prepared.plan;
      observations.calls.actual_plan_schema += 1;
      return reject(contracts.validateContract('DecisionPortRequest', plan), 'INVALID_PAYLOAD', '/schema_version');
    });
  await check('EI-X01-DECISION-BRIDGE-02', 'actual_local_plan_to_installed_package',
    'the public request checker refuses the unchanged actual plan before checking context', () => {
      const plan = prepared.plan;
      observations.calls.actual_plan_request_check += 1;
      const result = reject(operations.checkDecisionRequest(plan, {}), 'INVALID_PAYLOAD', '/schema_version');
      requestRefusalVerified = true;
      return result;
    });
  await check('EI-X01-DECISION-BRIDGE-03', 'actual_local_plan_to_installed_bound_port',
    'the public bound port refuses the unchanged actual plan without invoking its handler', async () => {
      const plan = prepared.plan;
      observations.calls.actual_plan_bound_port += 1;
      const result = reject(await port.decide(plan, {}), 'INVALID_PAYLOAD', '/schema_version');
      assert.equal(observations.handler_calls, 0);
      assert.deepEqual(snapshot(), before);
      observations.after_bound_call = snapshot();
      boundRefusalVerified = true;
      return { ...result, handler_calls: observations.handler_calls, input_bytes_and_hashes_unchanged: true };
    });
  await check('EI-X01-DECISION-BRIDGE-04', 'rejected_marker_only_copy_of_actual_plan',
    'adding only contract/version markers leaves required authority and reference fields absent', () => {
      const marked = { ...prepared.plan, contract: 'DecisionPortRequest', schema_version: '1.0.0' };
      const result = contracts.validateContract('DecisionPortRequest', marked);
      const refusal = reject(result, 'INVALID_PAYLOAD');
      const missing = result.errors.filter((row) => row.keyword === 'required').map((row) => row.path);
      for (const key of ['tenant_id', 'project_id', 'request_id', 'batch_id', 'logical_operation_id',
        'billable_attempt_id', 'deadline_at', 'cancellation_ref', 'model_ref', 'policy_ref', 'budget_ref', 'state_ref']) {
        assert.ok(missing.includes(`/${key}`), `required canonical field stays absent: ${key}`);
      }
      assert.ok(result.errors.some((row) => row.path === '/questions' && row.keyword === 'type'));
      observations.missing_canonical_fields = missing;
      return { ...refusal, missing_fields: missing, question_container: 'actual_array_canonical_object_required' };
    });

  const control = syntheticRequest(consumerSha);
  observations.synthetic_control = { origin: 'independently_authored_schema_syntax_not_an_ei_plan_projection', request: json(control) };
  await check('EI-X01-DECISION-CONTROL-01', 'independent_synthetic_decision_syntax_control',
    'independent canonical request syntax passes without claiming trusted-context or Finance acceptance', () => {
      assert.equal(contracts.validateContract('DecisionPortRequest', control).ok, true);
      return { outcome: 'synthetic_schema_syntax_accepted', trust_context_checked: false };
    });
  await check('EI-X01-DECISION-CONTROL-02', 'independent_synthetic_decision_syntax_control',
    'valid synthetic request syntax still cannot dispatch with missing trusted context', async () => {
      observations.calls.synthetic_control_bound_port += 1;
      const result = reject(await port.decide(control, {}), 'INVALID_TRUST_CONTEXT', '');
      assert.equal(observations.handler_calls, 0);
      assert.deepEqual(control, observations.synthetic_control.request);
      missingContextRefusalVerified = true;
      return { ...result, handler_calls: 0, finance_policy_reached: false };
    });
  await check('EI-X01-DECISION-BRIDGE-05', 'actual_question_id_in_independent_synthetic_syntax_control',
    'the exact local versioned question ID cannot silently become a canonical question-map key', () => {
      const questionId = prepared.plan.questions.find((item) => item.questionId === QUESTION_ID).questionId;
      const probe = { ...clone(control), questions: { [questionId]: clone(control.questions.synthetic_identity) } };
      return { ...reject(contracts.validateContract('DecisionPortRequest', probe), 'INVALID_PAYLOAD', '/questions'),
        local_question_id: questionId, probe_origin: 'mechanical_key_reuse_only_not_an_accepted_mapping' };
    });
  await check('EI-X01-DECISION-BRIDGE-06', 'actual_state_hash_in_independent_synthetic_reference_control',
    'a bare internal state hash is not a canonical versioned-reference digest', () =>
      reject(operations.validateVersionedReference({ ...control.state_ref, content_hash: prepared.plan.stateHash }), 'INVALID_PAYLOAD', ''));
  await check('EI-X01-DECISION-LOCAL-02', 'actual_local_source_and_question_caller',
    'a changed source hash is refused by actual preparation without reaching the bound port', () => {
      const tampered = clone(composition);
      tampered.sources[0].evidence.contentHash = '0'.repeat(64);
      assert.throws(() => prepareIdentityQuestionFromComposition(tampered, {
        candidateIds: prepared.sourceIdentityBinding.candidateIds,
        languageByEvidenceId: Object.fromEntries(composition.sources.map((item) => [item.evidence.evidenceId, 'en'])),
      }), (error) => error instanceof SourceIdentityQuestionPreparationError && error.code === 'SOURCE_BINDING_FAILED');
      assert.equal(observations.handler_calls, 0);
      return { outcome: 'expected_rejection', actual: { code: 'SOURCE_BINDING_FAILED' }, handler_calls: 0 };
    });
  await check('EI-X01-DECISION-LOCAL-03', 'actual_local_source_and_question_caller',
    'all refusal probes preserve source bytes, actual plan/state/target hashes and deterministic preparation', () => {
      assert.deepEqual(snapshot(), before);
      const repeated = prepareIdentityQuestionFromComposition(composition, {
        candidateIds: prepared.sourceIdentityBinding.candidateIds,
        languageByEvidenceId: Object.fromEntries(composition.sources.map((item) => [item.evidence.evidenceId, 'en'])),
      });
      assert.deepEqual(json(repeated), json(prepared));
      assert.equal(observations.handler_calls, 0);
      observations.after_all_probes = snapshot();
      return { outcome: 'actual_sources_and_preparation_unchanged', handler_calls: 0 };
    });
  observations.coverage = {
    request_validation: requestRefusalVerified ? 'executed_actual_plan_expected_incompatibility' : 'expected_refusal_not_established',
    bound_port: boundRefusalVerified ? 'executed_request_refusal_before_handler' : 'expected_refusal_not_established',
    actual_result_consumption: { status: 'unsupported', executed: false,
      reason: 'EI has no active DecisionPort result consumer; no result, completed stage or receipt was fabricated.' },
    provider_execution: { status: 'not_requested', executed: false },
    trusted_context_and_finance_acceptance: requestRefusalVerified && boundRefusalVerified && missingContextRefusalVerified
      ? 'not_reached_not_established' : 'not_established',
  };
  return observations;
}
