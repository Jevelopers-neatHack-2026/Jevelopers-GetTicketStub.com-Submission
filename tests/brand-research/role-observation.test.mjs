import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { BrandRoleQuestionPreparationError, discoverAssetCandidates, prepareBrandRoleQuestionFromAssetCandidate } from '../../src/brand-research/assets.mjs';
import { EvidenceStoreError } from '../../src/evidence/store.mjs';
import { inspectSafeAssetBytes } from '../../src/security/assets/inspect.mjs';
import { AssetPermissionSelectionError, createAssetPermissionSelector } from '../../src/verification/asset-permissions/index.mjs';
import { createHarness, EPOCH, request } from '../integration/pdf-evidence/store-harness.mjs';

const SOURCE_URL = 'https://events.example.com/calendar/index.html';
const SOURCE_HTML = '<!doctype html><html><head><meta property="og:image" content="/assets/brand.svg"></head><body><p>Community event</p></body></html>';
const TWO_CANDIDATE_HTML = '<!doctype html><html><head><meta property="og:image" content="/assets/brand.svg"><meta property="og:image" content="/assets/other-brand.svg"></head><body><p>Community event</p></body></html>';
const SAFE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="1" y="2" width="8" height="9" fill="#0af"/></svg>';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function locatorValue(locator) {
  return locator.kind === 'text-range'
    ? { kind: locator.kind, startByte: locator.startByte, endByte: locator.endByte }
    : { kind: locator.kind, pointer: locator.pointer };
}

function preparationCode(code) {
  return (error) => error instanceof BrandRoleQuestionPreparationError && error.code === code;
}

async function createFixture(t, {
  html = SOURCE_HTML,
  sourceUrl = SOURCE_URL,
  candidateIndex = 0,
  permitDurationMs = 60_000,
  accessState,
} = {}) {
  const access = accessState ?? { allowed: true };
  const authorize = ({ tenantId, request: authRequest }) => access.allowed === true
    && tenantId === 'tenant-pdf'
    && authRequest?.principal?.tenantId === tenantId
    && authRequest.allowPrivate === true;
  const harness = await createHarness(t, {
    authorizePrivateAccess: authorize,
    authorizePrivateAccessCurrent: authorize,
  });
  const authenticatedRequest = request('tenant-pdf', true);
  const scope = await harness.store.scopeForAuthenticatedRequest(authenticatedRequest);
  const discovery = await discoverAssetCandidates({
    store: harness.store,
    scope,
    document: {
      url: sourceUrl,
      contentType: 'text/html; charset=utf-8',
      fetchedAt: new Date(EPOCH).toISOString(),
      redirects: 0,
      bytes: Buffer.from(html, 'utf8'),
    },
    retentionHandle: harness.createPermit('tenant-pdf', permitDurationMs),
    request: authenticatedRequest,
  });
  assert.equal(discovery.outcome, 'stored');
  const candidate = discovery.candidates[candidateIndex];
  assert.ok(candidate);
  const assetBytes = Buffer.from(SAFE_SVG, 'utf8');
  const inspected = inspectSafeAssetBytes(assetBytes, { contentType: 'image/svg+xml' });
  assert.equal(inspected.action, 'transformed');
  const assetDocument = {
    url: candidate.fetchSuggestion,
    contentType: 'image/svg+xml',
    bytes: assetBytes,
    fetchedAt: new Date(EPOCH).toISOString(),
    redirects: 0,
  };
  const observation = {
    kind: 'structured_visual_observation',
    observationRef: 'observation:brand-role:1',
    sourceRef: discovery.metadata.evidenceId,
    candidateRef: candidate.candidateId,
    language: 'en',
    text: 'The supplied visual observation describes a blue geometric mark.',
    retentionTags: ['rights'],
    visual: {
      observerRef: 'observer:caller-asserted',
      observerModel: 'model:caller-asserted',
      regionRef: 'region:whole-image',
      assetHash: inspected.transformedHash,
      uncertainty: 'low',
    },
  };
  return {
    ...harness,
    access,
    authenticatedRequest,
    scope,
    discovery,
    candidate,
    assetBytes,
    inspected,
    assetDocument,
    observation,
  };
}

function prepare(fixture, overrides = {}) {
  return prepareBrandRoleQuestionFromAssetCandidate({
    store: fixture.store,
    scope: fixture.scope,
    request: fixture.authenticatedRequest,
    discovery: fixture.discovery,
    candidateId: fixture.candidate.candidateId,
    assetDocument: fixture.assetDocument,
    observation: fixture.observation,
    ...overrides,
  });
}

test('binds one stored source candidate, fresh SVG inspection, and one blocked brand-role question', async (t) => {
  const fixture = await createFixture(t);
  const selected = await fixture.store.materializeSelected(fixture.scope, {
    evidence: [fixture.discovery.evidence],
    facts: [],
  }, fixture.authenticatedRequest);
  const storedEvidence = selected.evidence[0];
  const storedCandidate = storedEvidence.source.assetSource.candidates[0];
  const storedPosition = storedEvidence.positions[0];
  assert.deepEqual(locatorValue(storedCandidate.locator), locatorValue(storedPosition.locator));
  assert.equal(storedCandidate.positionIndex, 0);

  const expectedAssetBytesSourceHash = sha256(fixture.assetDocument.bytes);
  const preparation = prepare(fixture);
  fixture.assetDocument.bytes.fill(0);
  const prepared = await preparation;
  assert.equal(prepared.sourceBinding.evidenceId, fixture.discovery.metadata.evidenceId);
  assert.equal(prepared.sourceBinding.evidenceVersion, fixture.discovery.metadata.version);
  assert.equal(prepared.sourceBinding.pageSourceHash, fixture.discovery.sourceHash);
  assert.equal(prepared.sourceBinding.candidateId, fixture.candidate.candidateId);
  assert.equal(prepared.sourceBinding.positionIndex, 0);
  assert.deepEqual(locatorValue(prepared.sourceBinding.locator), locatorValue(storedPosition.locator));
  assert.equal(prepared.sourceBinding.candidateExcerptHash, fixture.candidate.excerptHash);
  assert.equal(prepared.assetInspection.assetBytesSourceHash, expectedAssetBytesSourceHash);
  assert.equal(prepared.assetInspection.transformedBytesHash, fixture.inspected.transformedHash);
  assert.equal(prepared.assetInspection.transformedBytesMatchInspection, true);
  assert.equal(prepared.assetInspection.acquisitionProvenance, 'caller_supplied_unverified');
  assert.equal(prepared.questionBinding.questionId, 'Q-EI-BRAND-ROLE:v1');
  assert.equal(prepared.questionBinding.candidateId, fixture.candidate.candidateId);
  assert.equal(prepared.questionBinding.observationRef, fixture.observation.observationRef);
  assert.equal(prepared.questionBinding.observerMetadataProvenance, 'caller_asserted_unverified');
  assert.equal(prepared.questionBinding.targetBindingHash !== null, true);
  assert.notEqual(prepared.sourceBinding.pageSourceHash, prepared.sourceBinding.candidateExcerptHash);
  assert.notEqual(prepared.assetInspection.assetBytesSourceHash, prepared.assetInspection.transformedBytesHash);
  assert.notEqual(prepared.sourceBinding.pageSourceHash, prepared.assetInspection.assetBytesSourceHash);
  assert.notEqual(prepared.sourceBinding.candidateExcerptHash, prepared.assetInspection.assetBytesSourceHash);
  assert.deepEqual(prepared.discoveryCandidateStatus, {
    role: 'unknown',
    permission: 'unknown',
    inspection: 'pending',
  });
  assert.equal(fixture.candidate.role, 'unknown');
  assert.equal(fixture.candidate.permission, 'unknown');
  assert.equal(fixture.candidate.inspection, 'pending');
  assert.equal(prepared.plan.readinessStatus, 'blocked');
  assert.equal(prepared.plan.promotionStatus, 'unpromoted');
  assert.equal(prepared.plan.executionStatus, 'not_dispatched');
  assert.equal(prepared.plan.decisionPortContractStatus, 'unavailable');
  assert.equal(prepared.plan.candidateOnly, true);
  assert.equal(JSON.stringify(prepared.plan).includes(SAFE_SVG), false);
  assert.equal(JSON.stringify(prepared.plan).includes(fixture.candidate.fetchSuggestion), false);
  assert.deepEqual(prepared.plan.authorityScope, {
    sourceOfficialnessGranted: false,
    verifiedFactStatusGranted: false,
    independentVerificationGranted: false,
    rightsOrPermissionGranted: false,
    capabilitiesGranted: false,
    budgetGranted: false,
    promotionGranted: false,
  });
  const question = prepared.plan.questions.find((item) => item.questionId === 'Q-EI-BRAND-ROLE:v1');
  assert.ok(question);
  assert.equal(question.eligible, true);
  assert.equal(question.reviewRequired, false);
  assert.equal(question.targetBinding.targetRef, prepared.questionBinding.targetRef);
  assert.deepEqual(question.targetBinding.candidateRefs, []);
  assert.deepEqual(question.targetBinding.observationRefs, [fixture.observation.observationRef]);
  assert.equal(question.targetBindingHash, prepared.questionBinding.targetBindingHash);
  assert.equal(prepared.plan.state.observations.length, 1);
  assert.equal(question.targetState.evidence[0].candidateRef, fixture.candidate.candidateId);
  assert.equal(prepared.plan.state.observations[0].visual.assetHash, fixture.inspected.transformedHash);

  const selectorCalls = { authorization: 0, publish: 0 };
  let published;
  const selector = createAssetPermissionSelector({
    readAuthorization({ request: scopedRequest, requestHash }) {
      selectorCalls.authorization += 1;
      return {
        status: 'authorized',
        requestHash,
        tenantRef: scopedRequest.tenantRef,
        scopeRef: scopedRequest.scopeRef,
        organizationRef: scopedRequest.organizationRef,
        occurrenceRef: scopedRequest.occurrenceRef,
        editionRef: scopedRequest.editionRef,
        packageVersion: scopedRequest.packageVersion,
        intendedUse: scopedRequest.intendedUse,
        principalRef: 'principal:fixture',
        subjectRef: 'subject:fixture',
        authorizationRevision: 'authorization:fixture',
      };
    },
    publishHandoff(payload, context) {
      selectorCalls.publish += 1;
      published = payload;
      return {
        status: 'published',
        requestHash: context.requestHash,
        selectionId: context.selectionId,
        handoffRef: 'handoff:original-artwork',
      };
    },
  });
  const permissionRequest = {
    requestVersion: 'asset-permission-request/1',
    tenantRef: 'tenant:one',
    scopeRef: 'scope:project-one',
    organizationRef: 'organization:one',
    occurrenceRef: 'occurrence:one',
    editionRef: 'edition:one',
    packageVersion: 'package:1',
    intendedUse: 'event-promotion',
  };
  await assert.rejects(selector.select({ request: permissionRequest, candidates: [prepared.plan] }), (error) =>
    error instanceof AssetPermissionSelectionError && error.code === 'INVALID_INPUT');
  assert.equal(selectorCalls.authorization, 0, 'the prepared plan is not accepted as a permission candidate');
  const fallback = await selector.select({ request: permissionRequest, candidates: [] });
  assert.equal(fallback.fallbackRequired, true);
  const handoff = await selector.handoff(fallback.handle, permissionRequest);
  assert.equal(handoff.status, 'fallback_published');
  assert.equal(selectorCalls.publish, 1);
  assert.equal(published.mode, 'original-artwork');
  assert.deepEqual(published.permittedAssets, []);
  assert.deepEqual(published.referenceImages, []);
  assert.equal(Object.hasOwn(published, 'roleEvidence'), false);
  assert.equal(Object.hasOwn(published, 'approval'), false);
});

test('same observationRef stays bound to the exact stored candidate and source in hashed question state', async (t) => {
  const firstCandidate = await createFixture(t);
  const differentCandidate = await createFixture(t, { html: TWO_CANDIDATE_HTML, candidateIndex: 1 });
  const differentSource = await createFixture(t, { sourceUrl: 'https://events.example.com/other/index.html' });
  assert.equal(firstCandidate.observation.observationRef, differentCandidate.observation.observationRef);
  assert.equal(firstCandidate.observation.observationRef, differentSource.observation.observationRef);
  assert.notEqual(firstCandidate.candidate.candidateId, differentCandidate.candidate.candidateId);
  assert.equal(firstCandidate.candidate.candidateId, differentSource.candidate.candidateId);
  assert.notEqual(firstCandidate.discovery.metadata.evidenceId, differentSource.discovery.metadata.evidenceId);

  const first = await prepare(firstCandidate);
  const candidateVariant = await prepare(differentCandidate);
  const sourceVariant = await prepare(differentSource);
  const firstQuestion = first.plan.questions.find((item) => item.questionId === 'Q-EI-BRAND-ROLE:v1');
  const candidateQuestion = candidateVariant.plan.questions.find((item) => item.questionId === 'Q-EI-BRAND-ROLE:v1');
  const sourceQuestion = sourceVariant.plan.questions.find((item) => item.questionId === 'Q-EI-BRAND-ROLE:v1');
  assert.equal(firstQuestion.eligible, true);
  assert.equal(candidateQuestion.eligible, true);
  assert.equal(sourceQuestion.eligible, true);
  assert.deepEqual(firstQuestion.targetBinding.observationRefs, [firstCandidate.observation.observationRef]);
  assert.deepEqual(candidateQuestion.targetBinding.observationRefs, [differentCandidate.observation.observationRef]);
  assert.deepEqual(sourceQuestion.targetBinding.observationRefs, [differentSource.observation.observationRef]);
  assert.equal(first.questionBinding.targetRef, candidateVariant.questionBinding.targetRef);
  assert.equal(first.questionBinding.targetRef, sourceVariant.questionBinding.targetRef);
  assert.equal(candidateVariant.questionBinding.candidateId, differentCandidate.candidate.candidateId);
  assert.equal(sourceVariant.questionBinding.candidateId, differentSource.candidate.candidateId);
  assert.equal(sourceVariant.sourceBinding.evidenceId, differentSource.discovery.metadata.evidenceId);
  assert.equal(candidateQuestion.targetState.evidence[0].candidateRef, differentCandidate.candidate.candidateId);
  assert.equal(sourceQuestion.targetState.evidence[0].sourceRef, differentSource.discovery.metadata.evidenceId);
  assert.notEqual(first.questionBinding.targetBindingHash, candidateVariant.questionBinding.targetBindingHash);
  assert.notEqual(firstQuestion.questionInstanceHash, candidateQuestion.questionInstanceHash);
  assert.notEqual(first.plan.stateHash, candidateVariant.plan.stateHash);
  assert.notEqual(first.questionBinding.targetBindingHash, sourceVariant.questionBinding.targetBindingHash);
  assert.notEqual(firstQuestion.questionInstanceHash, sourceQuestion.questionInstanceHash);
  assert.notEqual(first.plan.stateHash, sourceVariant.plan.stateHash);
});

test('rejects copied, forged, stale, and source-misaligned candidate references', async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(prepare(fixture, { candidateId: 'candidate:missing' }), preparationCode('CANDIDATE_NOT_FOUND'));
  await assert.rejects(prepare(fixture, { discovery: { ...fixture.discovery } }), preparationCode('INVALID_INPUT'));

  const copiedCandidate = Object.freeze({
    ...fixture.candidate,
    position: Object.freeze({ ...fixture.candidate.position }),
  });
  const reassignedDiscovery = Object.freeze({
    ...fixture.discovery,
    candidates: Object.freeze([copiedCandidate]),
  });
  await assert.rejects(prepare(fixture, { discovery: reassignedDiscovery }), preparationCode('INVALID_INPUT'));

  await assert.rejects(prepare(fixture, {
    observation: { ...fixture.observation, sourceRef: 'evidence:other' },
  }), preparationCode('OBSERVATION_BINDING_MISMATCH'));
  await assert.rejects(prepare(fixture, {
    observation: { ...fixture.observation, candidateRef: 'candidate:other' },
  }), preparationCode('OBSERVATION_BINDING_MISMATCH'));
  await assert.rejects(prepare(fixture, {
    observation: {
      ...fixture.observation,
      visual: { ...fixture.observation.visual, assetHash: fixture.discovery.sourceHash },
    },
  }), preparationCode('ASSET_HASH_MISMATCH'));
  await assert.rejects(prepare(fixture, {
    observation: {
      ...fixture.observation,
      visual: { ...fixture.observation.visual, assetHash: fixture.candidate.excerptHash },
    },
  }), preparationCode('ASSET_HASH_MISMATCH'));
  await assert.rejects(prepare(fixture, {
    assetDocument: { ...fixture.assetDocument, url: 'https://assets.example.net/other.svg' },
  }), preparationCode('ASSET_DOCUMENT_MISMATCH'));
  await assert.rejects(prepare(fixture, {
    assetDocument: { ...fixture.assetDocument, redirects: 1 },
  }), preparationCode('ASSET_DOCUMENT_MISMATCH'));

  const quarantined = await createFixture(t, {
    html: '<!doctype html><html><head><meta property="og:image" content="javascript:alert(1)"></head><body>x</body></html>',
  });
  assert.equal(quarantined.candidate.fetchSuggestion, null);
  await assert.rejects(prepare(quarantined), preparationCode('CANDIDATE_NOT_FETCHABLE'));
});

test('requires current EvidenceStore access and unexpired retained evidence on every preparation', async (t) => {
  const revoked = { allowed: true };
  const fixture = await createFixture(t, { accessState: revoked });
  revoked.allowed = false;
  await assert.rejects(prepare(fixture), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_DENIED');

  const expiring = await createFixture(t, { permitDurationMs: 1_000 });
  expiring.clock.value = EPOCH + 1_001;
  await assert.rejects(prepare(expiring), (error) => error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED');
});

test('rejects accessor and proxy input records without invoking caller hooks', async (t) => {
  const fixture = await createFixture(t);
  let hooks = 0;
  const accessorObservation = { ...fixture.observation };
  Object.defineProperty(accessorObservation, 'text', {
    enumerable: true,
    get() { hooks += 1; return 'caller controlled'; },
  });
  await assert.rejects(prepare(fixture, { observation: accessorObservation }), preparationCode('INVALID_INPUT'));

  const proxiedDocument = new Proxy(fixture.assetDocument, {
    get() { hooks += 1; throw new Error('document getter invoked'); },
    ownKeys() { hooks += 1; throw new Error('document keys invoked'); },
    getOwnPropertyDescriptor() { hooks += 1; throw new Error('document descriptor invoked'); },
  });
  await assert.rejects(prepare(fixture, { assetDocument: proxiedDocument }), preparationCode('INVALID_INPUT'));

  class AccessorDocument {
    constructor(document) { Object.assign(this, document); }
  }
  await assert.rejects(prepare(fixture, {
    assetDocument: new AccessorDocument(fixture.assetDocument),
  }), preparationCode('INVALID_INPUT'));

  const proxiedInput = new Proxy({}, {
    get() { hooks += 1; throw new Error('input getter invoked'); },
    ownKeys() { hooks += 1; throw new Error('input keys invoked'); },
    getOwnPropertyDescriptor() { hooks += 1; throw new Error('input descriptor invoked'); },
  });
  await assert.rejects(prepareBrandRoleQuestionFromAssetCandidate(proxiedInput), preparationCode('INVALID_INPUT'));
  assert.equal(hooks, 0);
});

test('keeps inspection rejection and review fail-closed and rejects sensitive observations', async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(prepare(fixture, {
    assetDocument: {
      ...fixture.assetDocument,
      contentType: 'image/png',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
  }), preparationCode('ASSET_INSPECTION_REVIEW'));

  await assert.rejects(prepare(fixture, {
    assetDocument: {
      ...fixture.assetDocument,
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    },
  }), preparationCode('ASSET_INSPECTION_REVIEW'));

  await assert.rejects(prepare(fixture, {
    assetDocument: {
      ...fixture.assetDocument,
      bytes: Buffer.from([0xff]),
    },
  }), preparationCode('ASSET_INSPECTION_REJECTED'));

  await assert.rejects(prepare(fixture, {
    observation: { ...fixture.observation, text: 'authorization: Bearer abcdefghijklmnop' },
  }), preparationCode('QUESTION_BINDING_FAILED'));
});

test('high and unknown visual uncertainty remain review-required and caller observer claims stay unverified', async (t) => {
  const fixture = await createFixture(t);
  for (const uncertainty of ['high', 'unknown']) {
    await t.test(uncertainty, async () => {
      const prepared = await prepare(fixture, {
        observation: {
          ...fixture.observation,
          visual: {
            ...fixture.observation.visual,
            observerRef: 'observer:claimed-admin',
            observerModel: 'model:claimed-approved',
            uncertainty,
          },
        },
      });
      const question = prepared.plan.questions.find((item) => item.questionId === 'Q-EI-BRAND-ROLE:v1');
      assert.equal(prepared.questionBinding.observerMetadataProvenance, 'caller_asserted_unverified');
      assert.equal(question.reviewRequired, true);
      assert.ok(question.reviewReasons.includes('visual_observation_uncertain_requires_review'));
      assert.equal(prepared.plan.readinessStatus, 'blocked');
      assert.equal(prepared.plan.promotionStatus, 'unpromoted');
      assert.equal(prepared.plan.executionStatus, 'not_dispatched');
      assert.equal(prepared.plan.authorityScope.rightsOrPermissionGranted, false);
    });
  }
});
