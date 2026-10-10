import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import {
  getQuestionDefinition,
  QUESTION_REGISTRY_SCHEMA_VERSION,
  QUESTION_REGISTRY_VERSION,
} from '../../../src/decisions/questions/registry.mjs';
import {
  AssetPermissionSelectionError,
  ASSET_PERMISSION_SELECTION_LIMITS,
  createAssetPermissionSelector,
} from '../../../src/verification/asset-permissions/index.mjs';
import { inspectSafeAssetBytes, SAFE_ASSET_LIMITS } from '../../../src/security/assets/inspect.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_SOURCE = `<svg xmlns="${SVG_NS}" width="16" height="16"><rect x="1.00" y="2" width="8" height="9" fill="#0aF"/></svg>`;
const BRAND_ROLE = getQuestionDefinition('Q-EI-BRAND-ROLE:v1');
const request = Object.freeze({
  requestVersion: 'asset-permission-request/1',
  tenantRef: 'tenant:one',
  scopeRef: 'scope:project-one',
  organizationRef: 'organization:one',
  occurrenceRef: 'occurrence:fall-show',
  editionRef: 'edition:2026',
  packageVersion: 'package:7',
  intendedUse: 'event-promotion',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function makeCandidate(overrides = {}) {
  const sourceBytes = Buffer.from(SVG_SOURCE, 'utf8');
  const inspected = inspectSafeAssetBytes(sourceBytes, { contentType: 'image/svg+xml' });
  assert.equal(inspected.action, 'transformed');
  const identity = {
    candidateRef: 'candidate:one',
    assetRef: 'asset:logo-one',
    assetVersion: 'asset-version:4',
    tenantRef: request.tenantRef,
    scopeRef: request.scopeRef,
    organizationRef: request.organizationRef,
    occurrenceRef: request.occurrenceRef,
    editionRef: request.editionRef,
    packageVersion: request.packageVersion,
    intendedUse: request.intendedUse,
    sourceRef: 'source:page-one',
    evidenceRef: 'evidence:asset-one',
    contentType: 'image/svg+xml',
    sourceHash: inspected.sourceHash,
    transformedHash: inspected.transformedHash,
  };
  const roleEvidence = {
    questionId: 'Q-EI-BRAND-ROLE:v1',
    registryVersion: QUESTION_REGISTRY_VERSION,
    schemaVersion: QUESTION_REGISTRY_SCHEMA_VERSION,
    rubricVersion: BRAND_ROLE.rubricVersion,
    definitionHash: BRAND_ROLE.definitionHash,
    targetRef: 'target:brand-role-one',
    candidateRef: identity.candidateRef,
    assetRef: identity.assetRef,
    assetVersion: identity.assetVersion,
    tenantRef: identity.tenantRef,
    scopeRef: identity.scopeRef,
    organizationRef: identity.organizationRef,
    occurrenceRef: identity.occurrenceRef,
    editionRef: identity.editionRef,
    packageVersion: identity.packageVersion,
    intendedUse: identity.intendedUse,
    sourceRef: identity.sourceRef,
    sourceHash: identity.sourceHash,
    transformedHash: identity.transformedHash,
    observationRef: 'observation:logo-one',
    observationHash: sha256('structured-observation:logo-one'),
    observerRef: 'observer:local-fixture',
    modelRef: 'model:jev-candidate-only',
    regionRef: 'region:one',
    uncertaintyRef: 'uncertainty:one',
    role: 'logo',
  };
  const candidate = {
    ...identity,
    bytes: sourceBytes,
    roleEvidence,
    approvalClaim: {
      approvalRef: 'approval:external-one',
      declaredExpiresAtMs: Date.now() + 60_000,
      revocationRef: 'revocation:external-one',
    },
  };
  return { candidate: { ...candidate, ...overrides }, sourceBytes, inspected };
}

function createHost(options = {}) {
  const state = {
    principalRef: options.principalRef ?? 'principal:one',
    subjectRef: options.subjectRef ?? 'subject:one',
    authorizationRevision: options.authorizationRevision ?? 'authorization:1',
    authorized: options.authorized ?? true,
    permissionRevision: options.permissionRevision ?? 'permission:1',
    revocationRevision: options.revocationRevision ?? 'revocation:1',
    revoked: options.revoked ?? false,
    permissionStatus: options.permissionStatus ?? 'authorized',
    roleStatus: options.roleStatus ?? 'eligible',
    associationStatus: options.associationStatus ?? 'confirmed',
    approvedHash: options.approvedHash,
    issuerRef: options.issuerRef ?? 'issuer:external-one',
    approverRef: options.approverRef ?? 'actor:external-one',
    overridePermissionIdentity: options.overridePermissionIdentity,
    failPermissionCandidateRef: options.failPermissionCandidateRef,
    onRole: options.onRole,
    onPermission: options.onPermission,
    onPublish: options.onPublish,
    calls: { role: 0, permission: 0, authorization: 0, publish: 0 },
    permissionIdentities: [],
    published: [],
  };

  const adapters = {
    readAuthorization({ request: scopedRequest, requestHash }) {
      state.calls.authorization += 1;
      return {
        status: state.authorized ? 'authorized' : 'denied',
        requestHash,
        tenantRef: scopedRequest.tenantRef,
        scopeRef: scopedRequest.scopeRef,
        organizationRef: scopedRequest.organizationRef,
        occurrenceRef: scopedRequest.occurrenceRef,
        editionRef: scopedRequest.editionRef,
        packageVersion: scopedRequest.packageVersion,
        intendedUse: scopedRequest.intendedUse,
        principalRef: state.principalRef,
        subjectRef: state.subjectRef,
        authorizationRevision: state.authorizationRevision,
      };
    },
    async verifyRoleEvidence(input, signal) {
      state.calls.role += 1;
      if (options.onRole) await options.onRole(input, signal, state);
      return {
        ...input.identity,
        status: state.roleStatus,
        associationStatus: state.associationStatus,
        decisionRef: `role-decision:${input.identity.candidateRef}`,
        authorityRevision: input.authorization.authorizationRevision,
        evidenceRevision: `role-evidence:${input.identity.candidateRef}:1`,
      };
    },
    recheckRoleEvidence(input) {
      return {
        status: 'current',
        requestHash: input.requestHash,
        candidateRef: input.identity.candidateRef,
        transformedHash: input.identity.transformedHash,
        decisionRef: input.decision.decisionRef,
        authorizationRevision: input.authorization.authorizationRevision,
        evidenceRevision: input.decision.evidenceRevision,
      };
    },
    async verifyPermission(input, signal) {
      state.calls.permission += 1;
      state.permissionIdentities.push(input.identity);
      if (options.onPermission) await options.onPermission(input, signal, state);
      if (state.failPermissionCandidateRef === input.identity.candidateRef) throw new Error('fixture failure');
      const identity = state.overridePermissionIdentity
        ? { ...input.identity, ...state.overridePermissionIdentity(input) }
        : input.identity;
      return {
        ...identity,
        status: state.revoked ? 'revoked' : state.permissionStatus,
        approvedHash: state.approvedHash ?? input.identity.transformedHash,
        expiresAtMs: input.identity.declaredExpiresAtMs,
        revocationStatus: state.revoked ? 'revoked' : 'active',
        decisionRef: `permission-decision:${input.identity.candidateRef}`,
        issuerRef: state.issuerRef,
        approverRef: state.approverRef,
        verifierRef: 'verifier:host-one',
        authorityRevision: input.authorization.authorizationRevision,
        permissionRevision: state.permissionRevision,
        revocationRevision: state.revocationRevision,
      };
    },
    recheckPermission(input) {
      return {
        status: state.revoked || !state.authorized ? 'stale' : 'current',
        requestHash: input.requestHash,
        candidateRef: input.identity.candidateRef,
        transformedHash: input.identity.transformedHash,
        decisionRef: input.decision.decisionRef,
        authorizationRevision: input.authorization.authorizationRevision,
        permissionRevision: input.decision.permissionRevision,
        revocationRevision: input.decision.revocationRevision,
      };
    },
    publishHandoff(payload, context) {
      state.calls.publish += 1;
      if (options.onPublish) options.onPublish(payload, context, state);
      if (!state.authorized || context.authorization.status !== 'authorized'
        || state.authorizationRevision !== context.authorization.authorizationRevision) {
        return { status: 'rejected', requestHash: context.requestHash, selectionId: context.selectionId };
      }
      if (payload.permittedAssets.some((asset) => {
        const permission = context.permissionDecisions.find((entry) => entry.candidateRef === asset.candidateRef);
        return state.revoked || !permission
          || permission.permissionRevision !== state.permissionRevision
          || permission.revocationRevision !== state.revocationRevision
          || asset.expiresAtMs <= Date.now()
          || sha256(asset.bytes) !== asset.transformedHash;
      })) {
        return { status: 'rejected', requestHash: context.requestHash, selectionId: context.selectionId };
      }
      state.published.push(payload);
      return {
        status: 'published',
        requestHash: context.requestHash,
        selectionId: context.selectionId,
        handoffRef: `handoff:${context.selectionId}`,
      };
    },
  };

  return { state, adapters };
}

function errorCode(code) {
  return (error) => error instanceof AssetPermissionSelectionError && error.code === code;
}

function select(selector, candidates, options) {
  return selector.select({ request, candidates }, options);
}

test('selects only inspected transformed bytes after current trusted role and exact permission checks', async () => {
  const fixture = makeCandidate();
  const host = createHost();
  const selector = createAssetPermissionSelector(host.adapters);
  const selected = await select(selector, [fixture.candidate]);

  assert.equal(selected.referenceImageCount, 1);
  assert.equal(selected.fallbackRequired, false);
  assert.equal(host.state.calls.role, 1);
  assert.equal(host.state.calls.permission, 1);
  assert.equal(host.state.calls.publish, 0);
  assert.equal(host.state.calls.authorization >= 3, true);

  fixture.sourceBytes.fill(0);
  fixture.candidate.assetVersion = 'asset-version:mutated';
  fixture.candidate.roleEvidence.role = 'unknown';
  fixture.candidate.approvalClaim.approvalRef = 'approval:mutated';
  const handed = await selector.handoff(selected.handle, request);
  assert.equal(handed.status, 'published');
  assert.equal(handed.permittedAssetCount, 1);
  const payload = host.state.published[0];
  const asset = payload.permittedAssets[0];
  assert.equal(payload.mode, 'permitted-reference-images');
  assert.equal(asset.sourceHash, fixture.inspected.sourceHash);
  assert.equal(asset.transformedHash, fixture.inspected.transformedHash);
  assert.notEqual(asset.sourceHash, asset.transformedHash);
  assert.equal(sha256(asset.bytes), asset.transformedHash);
  assert.deepEqual(asset.bytes, fixture.inspected.copyTransformedBytes());
  assert.equal(Object.hasOwn(payload, 'rawSourceBytes'), false);
  assert.equal(host.state.calls.role, 2);
  assert.equal(host.state.calls.permission, 2);
});

test('checks each role label while role suggestions and favorable judgments never grant permission', async (t) => {
  for (const role of ['favicon', 'logo', 'poster', 'photo', 'unrelated', 'unknown']) {
    await t.test(role, async () => {
      const fixture = makeCandidate();
      fixture.candidate.roleEvidence.role = role;
      const host = createHost();
      const selector = createAssetPermissionSelector(host.adapters);
      const selected = await select(selector, [fixture.candidate]);
      assert.equal(selected.referenceImageCount, ['favicon', 'logo', 'poster', 'photo'].includes(role) ? 1 : 0);
      assert.equal(host.state.calls.permission, 1, 'permission lookup is independent of role');
    });
  }

  const favorableRoleButDeniedPermission = makeCandidate();
  const deniedHost = createHost({ permissionStatus: 'denied' });
  const deniedSelector = createAssetPermissionSelector(deniedHost.adapters);
  const denied = await select(deniedSelector, [favorableRoleButDeniedPermission.candidate]);
  assert.equal(denied.referenceImageCount, 0);
  assert.equal(denied.fallbackRequired, true);
  assert.equal(deniedHost.state.calls.role, 1);
  assert.equal(deniedHost.state.calls.permission, 1);

  const untrustedIssuer = makeCandidate();
  const issuerHost = createHost({
    permissionStatus: 'denied',
    issuerRef: 'issuer:forged',
    approverRef: 'actor:unauthorized',
  });
  const issuerSelector = createAssetPermissionSelector(issuerHost.adapters);
  const issuerFallback = await select(issuerSelector, [untrustedIssuer.candidate]);
  assert.equal(issuerFallback.referenceImageCount, 0);
  assert.equal(issuerHost.state.calls.publish, 0);

  const lowConfidence = makeCandidate();
  const reviewHost = createHost({ roleStatus: 'review', associationStatus: 'unknown' });
  const reviewSelector = createAssetPermissionSelector(reviewHost.adapters);
  const review = await select(reviewSelector, [lowConfidence.candidate]);
  assert.equal(review.referenceImageCount, 0);
});

test('wrong organization and unconfirmed association stay out of the reference set', async () => {
  const wrongCompany = makeCandidate();
  wrongCompany.candidate.organizationRef = 'organization:other';
  const wrongHost = createHost();
  const wrongSelector = createAssetPermissionSelector(wrongHost.adapters);
  const wrong = await select(wrongSelector, [wrongCompany.candidate]);
  assert.equal(wrong.referenceImageCount, 0);
  assert.equal(wrongHost.state.calls.permission, 1);
  assert.equal(wrongHost.state.permissionIdentities[0].candidateOrganizationRef, 'organization:other');
  assert.equal(wrongHost.state.permissionIdentities[0].organizationRef, request.organizationRef);

  const crossTenant = makeCandidate();
  crossTenant.candidate.tenantRef = 'tenant:other';
  const tenantHost = createHost();
  const tenantSelector = createAssetPermissionSelector(tenantHost.adapters);
  const tenantFallback = await select(tenantSelector, [crossTenant.candidate]);
  assert.equal(tenantFallback.referenceImageCount, 0);
  assert.equal(tenantHost.state.calls.permission, 1);
  assert.equal(tenantHost.state.permissionIdentities[0].candidateTenantRef, 'tenant:other');

  const uncertain = makeCandidate();
  const uncertainHost = createHost({ associationStatus: 'unconfirmed' });
  const uncertainSelector = createAssetPermissionSelector(uncertainHost.adapters);
  const uncertainResult = await select(uncertainSelector, [uncertain.candidate]);
  assert.equal(uncertainResult.referenceImageCount, 0);
  assert.equal(uncertainHost.state.calls.permission, 1);
});

test('forged client approval fields and missing host verifiers cannot promote candidate bytes', async () => {
  const forged = makeCandidate();
  forged.candidate.approvalClaim.approved = true;
  const forgedHost = createHost();
  const forgedSelector = createAssetPermissionSelector(forgedHost.adapters);
  await assert.rejects(select(forgedSelector, [forged.candidate]), errorCode('INVALID_INPUT'));
  assert.equal(forgedHost.state.calls.publish, 0);

  const fixture = makeCandidate();
  const noVerifier = createAssetPermissionSelector({
    readAuthorization: createHost().adapters.readAuthorization,
    publishHandoff(payload, context) {
      assert.deepEqual(payload.permittedAssets, []);
      assert.deepEqual(payload.referenceImages, []);
      assert.equal(payload.mode, 'original-artwork');
      assert.deepEqual(payload.fallback, { mode: 'original-artwork' });
      assert.equal(context.permissionDecisions.length, 0);
      return { status: 'published', requestHash: context.requestHash, selectionId: context.selectionId, handoffRef: 'handoff:empty' };
    },
  });
  const fallback = await select(noVerifier, [fixture.candidate]);
  assert.equal(fallback.referenceImageCount, 0);
  const handed = await noVerifier.handoff(fallback.handle, request);
  assert.equal(handed.status, 'fallback_published');
  assert.equal(handed.permittedAssetCount, 0);
});

test('transformed bytes require an exact transformed-hash approval and exact version/scope/use', async () => {
  const sourceOnly = makeCandidate();
  const sourceOnlyHost = createHost({ approvedHash: sourceOnly.inspected.sourceHash });
  const sourceOnlySelector = createAssetPermissionSelector(sourceOnlyHost.adapters);
  await assert.rejects(select(sourceOnlySelector, [sourceOnly.candidate]), errorCode('AUTHORITY_UNAVAILABLE'));
  assert.equal(sourceOnlyHost.state.calls.publish, 0);

  const wrongVersion = makeCandidate();
  const versionHost = createHost({
    overridePermissionIdentity: () => ({ assetVersion: 'asset-version:wrong' }),
  });
  const versionSelector = createAssetPermissionSelector(versionHost.adapters);
  await assert.rejects(select(versionSelector, [wrongVersion.candidate]), errorCode('AUTHORITY_UNAVAILABLE'));

  const wrongScope = makeCandidate();
  wrongScope.candidate.scopeRef = 'scope:other';
  const scopeHost = createHost();
  const scopeSelector = createAssetPermissionSelector(scopeHost.adapters);
  const scopeFallback = await select(scopeSelector, [wrongScope.candidate]);
  assert.equal(scopeFallback.referenceImageCount, 0);

  const wrongUse = makeCandidate();
  wrongUse.candidate.intendedUse = 'unrelated-use';
  const useHost = createHost();
  const useSelector = createAssetPermissionSelector(useHost.adapters);
  const useFallback = await select(useSelector, [wrongUse.candidate]);
  assert.equal(useFallback.referenceImageCount, 0);
});

test('active-content SVG and deceptive content types never produce fallback source bytes', async () => {
  const activeSource = `<svg xmlns="${SVG_NS}" width="16" height="16"><script>fetch('https://example.invalid')</script></svg>`;
  const activeBytes = Buffer.from(activeSource);
  const unsafe = makeCandidate({
    bytes: activeBytes,
    sourceHash: sha256(activeBytes),
    transformedHash: '0'.repeat(64),
  });
  const host = createHost();
  const selector = createAssetPermissionSelector(host.adapters);
  const result = await select(selector, [unsafe.candidate]);
  assert.equal(result.referenceImageCount, 0);
  assert.equal(host.state.calls.publish, 0);
  assert.equal(host.state.calls.permission, 0);

  const deceptive = makeCandidate({ contentType: 'image/png' });
  const deceptiveResult = await select(selector, [deceptive.candidate]);
  assert.equal(deceptiveResult.referenceImageCount, 0);
  assert.equal(host.state.calls.publish, 0);
});

test('revocation and principal changes between selection and handoff deny all publication', async (t) => {
  await t.test('permission revoked after selection', async () => {
    const fixture = makeCandidate();
    const host = createHost();
    const selector = createAssetPermissionSelector(host.adapters);
    const selected = await select(selector, [fixture.candidate]);
    host.state.revoked = true;
    await assert.rejects(selector.handoff(selected.handle, request), errorCode('PERMISSION_DENIED'));
    assert.equal(host.state.calls.publish, 0);
  });

  await t.test('authenticated principal changes after selection', async () => {
    const fixture = makeCandidate();
    const host = createHost();
    const selector = createAssetPermissionSelector(host.adapters);
    const selected = await select(selector, [fixture.candidate]);
    host.state.principalRef = 'principal:two';
    host.state.subjectRef = 'subject:two';
    await assert.rejects(selector.handoff(selected.handle, request), errorCode('PRINCIPAL_CHANGED'));
    assert.equal(host.state.calls.publish, 0);
  });

  await t.test('request scope cannot be changed for a stored selection', async () => {
    const fixture = makeCandidate();
    const host = createHost();
    const selector = createAssetPermissionSelector(host.adapters);
    const selected = await select(selector, [fixture.candidate]);
    await assert.rejects(selector.handoff(selected.handle, { ...request, packageVersion: 'package:8' }), errorCode('REQUEST_MISMATCH'));
    assert.equal(host.state.calls.publish, 0);
  });

  await t.test('approval expires after selection', async () => {
    const fixture = makeCandidate();
    fixture.candidate.approvalClaim.declaredExpiresAtMs = Date.now() + 40;
    const host = createHost();
    const selector = createAssetPermissionSelector(host.adapters);
    const selected = await select(selector, [fixture.candidate]);
    assert.equal(selected.referenceImageCount, 1);
    await delay(55);
    await assert.rejects(selector.handoff(selected.handle, request), errorCode('PERMISSION_DENIED'));
    assert.equal(host.state.calls.publish, 0);
  });
});

test('host final boundary rejects a permission revision changed immediately before publication', async () => {
  const fixture = makeCandidate();
  const host = createHost({ onPublish: (_payload, _context, state) => { state.permissionRevision = 'permission:2'; } });
  const selector = createAssetPermissionSelector(host.adapters);
  const selected = await select(selector, [fixture.candidate]);
  await assert.rejects(selector.handoff(selected.handle, request), errorCode('PUBLISH_REJECTED'));
  assert.equal(host.state.calls.publish, 1);
  assert.equal(host.state.published.length, 0);
});

test('cancellation, deadline, and authorization changes during async verification fail closed', async (t) => {
  await t.test('cancelled permission verification', async () => {
    const fixture = makeCandidate();
    const controller = new AbortController();
    const host = createHost({ onPermission: () => controller.abort() });
    const selector = createAssetPermissionSelector(host.adapters);
    await assert.rejects(select(selector, [fixture.candidate], { signal: controller.signal }), errorCode('CANCELLED'));
    assert.equal(host.state.calls.publish, 0);
  });

  await t.test('deadline while permission verification is pending', async () => {
    const fixture = makeCandidate();
    const host = createHost({ onPermission: async () => delay(30) });
    const selector = createAssetPermissionSelector(host.adapters);
    await assert.rejects(select(selector, [fixture.candidate], { deadlineAtMs: performance.now() + 5 }), errorCode('DEADLINE_EXCEEDED'));
    assert.equal(host.state.calls.publish, 0);
  });

  await t.test('server authorization revoked by callback completion', async () => {
    const fixture = makeCandidate();
    const host = createHost({
      onPermission: (_input, _signal, state) => { state.authorized = false; },
    });
    const selector = createAssetPermissionSelector(host.adapters);
    await assert.rejects(select(selector, [fixture.candidate]), errorCode('AUTHORIZATION_DENIED'));
    assert.equal(host.state.calls.publish, 0);
  });

  await t.test('principal changes while callback is pending', async () => {
    const fixture = makeCandidate();
    const host = createHost({
      onPermission: (_input, _signal, state) => {
        state.principalRef = 'principal:two';
        state.subjectRef = 'subject:two';
      },
    });
    const selector = createAssetPermissionSelector(host.adapters);
    await assert.rejects(select(selector, [fixture.candidate]), errorCode('PRINCIPAL_CHANGED'));
    assert.equal(host.state.calls.publish, 0);
  });

  await t.test('claim expires during async permission verification', async () => {
    const fixture = makeCandidate();
    fixture.candidate.approvalClaim.declaredExpiresAtMs = Date.now() + 5;
    const host = createHost({ onPermission: async () => delay(15) });
    const selector = createAssetPermissionSelector(host.adapters);
    await assert.rejects(select(selector, [fixture.candidate]), errorCode('PERMISSION_STALE'));
    assert.equal(host.state.calls.publish, 0);
  });
});

test('one malformed async decision prevents the whole multi-asset selection from being handed off', async () => {
  const first = makeCandidate();
  first.candidate.candidateRef = 'candidate:first';
  first.candidate.assetRef = 'asset:first';
  first.candidate.roleEvidence.candidateRef = 'candidate:first';
  first.candidate.roleEvidence.assetRef = 'asset:first';
  const second = makeCandidate();
  second.candidate.candidateRef = 'candidate:second';
  second.candidate.assetRef = 'asset:second';
  second.candidate.roleEvidence.candidateRef = 'candidate:second';
  second.candidate.roleEvidence.assetRef = 'asset:second';
  const host = createHost({ failPermissionCandidateRef: 'candidate:second' });
  const selector = createAssetPermissionSelector(host.adapters);
  await assert.rejects(select(selector, [first.candidate, second.candidate]), errorCode('AUTHORITY_UNAVAILABLE'));
  assert.equal(host.state.calls.permission, 2);
  assert.equal(host.state.calls.publish, 0);
});

test('input records, candidate count, byte caps, and output hashes are bounded and fail closed', async (t) => {
  await t.test('accessor', async () => {
    const fixture = makeCandidate();
    Object.defineProperty(fixture.candidate, 'candidateRef', { enumerable: true, get: () => 'candidate:evil' });
    const host = createHost();
    const selector = createAssetPermissionSelector(host.adapters);
    await assert.rejects(select(selector, [fixture.candidate]), errorCode('INVALID_INPUT'));
    assert.equal(host.state.calls.publish, 0);
  });

  await t.test('proxy', async () => {
    const fixture = makeCandidate();
    const selector = createAssetPermissionSelector(createHost().adapters);
    await assert.rejects(select(selector, [new Proxy(fixture.candidate, {})]), errorCode('INVALID_INPUT'));
  });

  await t.test('candidate count limit', async () => {
    const selector = createAssetPermissionSelector(createHost().adapters);
    await assert.rejects(select(selector, Array.from({ length: ASSET_PERMISSION_SELECTION_LIMITS.maxCandidates + 1 }, () => makeCandidate().candidate)), errorCode('INVALID_INPUT'));
  });

  await t.test('declared output hash mismatch', async () => {
    const fixture = makeCandidate({ transformedHash: 'a'.repeat(64) });
    fixture.candidate.roleEvidence.transformedHash = 'a'.repeat(64);
    const host = createHost();
    const selector = createAssetPermissionSelector(host.adapters);
    const selected = await select(selector, [fixture.candidate]);
    assert.equal(selected.referenceImageCount, 0);
    assert.equal(host.state.calls.permission, 0);
  });

  await t.test('per-source byte cap', async () => {
    const oversized = makeCandidate({ bytes: Buffer.alloc(SAFE_ASSET_LIMITS.maxSourceBytes + 1) });
    const selector = createAssetPermissionSelector(createHost().adapters);
    await assert.rejects(select(selector, [oversized.candidate]), errorCode('INVALID_INPUT'));
  });
});

test('a selection handle is opaque, scoped, and one-use', async () => {
  const fixture = makeCandidate();
  const host = createHost();
  const selector = createAssetPermissionSelector(host.adapters);
  const selected = await select(selector, [fixture.candidate]);
  assert.deepEqual(Object.keys(selected.handle), []);
  assert.equal(Object.isFrozen(selected.handle), true);
  const clone = Object.freeze(Object.create(null));
  await assert.rejects(selector.handoff(clone, request), errorCode('INVALID_SELECTION'));
  await selector.handoff(selected.handle, request);
  await assert.rejects(selector.handoff(selected.handle, request), errorCode('INVALID_SELECTION'));
});

test('final publication receives only the exact sanitized bytes and host version references', async () => {
  const fixture = makeCandidate();
  const host = createHost();
  const selector = createAssetPermissionSelector(host.adapters);
  const selected = await select(selector, [fixture.candidate]);
  await selector.handoff(selected.handle, request);
  const payload = host.state.published[0];
  const asset = payload.permittedAssets[0];
  assert.equal(asset.bytes instanceof Uint8Array, true);
  assert.equal(asset.transformedHash, sha256(asset.bytes));
  assert.equal(asset.permissionRevision, 'permission:1');
  assert.equal(asset.revocationRevision, 'revocation:1');
  assert.equal(asset.expiresAtMs, fixture.candidate.approvalClaim.declaredExpiresAtMs);
  assert.equal(payload.referenceImages.length, 1);
  assert.equal(payload.fallback, null);
});
