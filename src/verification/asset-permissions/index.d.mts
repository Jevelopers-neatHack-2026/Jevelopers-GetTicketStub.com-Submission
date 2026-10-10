export type AssetPermissionReference = string;
export type AssetPermissionRole = 'favicon' | 'logo' | 'poster' | 'photo' | 'unrelated' | 'unknown';
export type AssetPermissionHandoffRole = 'favicon' | 'logo' | 'poster' | 'photo';

export interface AssetPermissionRequest {
  readonly requestVersion: 'asset-permission-request/1';
  readonly tenantRef: AssetPermissionReference;
  readonly scopeRef: AssetPermissionReference;
  readonly organizationRef: AssetPermissionReference;
  readonly occurrenceRef: AssetPermissionReference;
  readonly editionRef: AssetPermissionReference;
  readonly packageVersion: AssetPermissionReference;
  readonly intendedUse: AssetPermissionReference;
}

export interface AssetPermissionRoleObservation {
  readonly questionId: 'Q-EI-BRAND-ROLE:v1';
  readonly registryVersion: string;
  readonly schemaVersion: string;
  readonly rubricVersion: string;
  readonly definitionHash: string;
  readonly targetRef: AssetPermissionReference;
  readonly candidateRef: AssetPermissionReference;
  readonly assetRef: AssetPermissionReference;
  readonly assetVersion: AssetPermissionReference;
  readonly tenantRef: AssetPermissionReference;
  readonly scopeRef: AssetPermissionReference;
  readonly organizationRef: AssetPermissionReference;
  readonly occurrenceRef: AssetPermissionReference;
  readonly editionRef: AssetPermissionReference;
  readonly packageVersion: AssetPermissionReference;
  readonly intendedUse: AssetPermissionReference;
  readonly sourceRef: AssetPermissionReference;
  readonly sourceHash: string;
  readonly transformedHash: string;
  readonly observationRef: AssetPermissionReference;
  readonly observationHash: string;
  readonly observerRef: AssetPermissionReference;
  readonly modelRef: AssetPermissionReference;
  readonly regionRef: AssetPermissionReference;
  readonly uncertaintyRef: AssetPermissionReference;
  readonly role: AssetPermissionRole;
}

export interface AssetPermissionApprovalClaim {
  /** Opaque reference to an externally issued approval. */
  readonly approvalRef: AssetPermissionReference;
  /** Untrusted expiry claim; the host must verify the source record. */
  readonly declaredExpiresAtMs: number;
  /** Opaque reference used by the host's current revocation lookup. */
  readonly revocationRef: AssetPermissionReference;
}

export interface AssetPermissionCandidate {
  readonly candidateRef: AssetPermissionReference;
  readonly assetRef: AssetPermissionReference;
  readonly assetVersion: AssetPermissionReference;
  readonly tenantRef: AssetPermissionReference;
  readonly scopeRef: AssetPermissionReference;
  readonly organizationRef: AssetPermissionReference;
  readonly occurrenceRef: AssetPermissionReference;
  readonly editionRef: AssetPermissionReference;
  readonly packageVersion: AssetPermissionReference;
  readonly intendedUse: AssetPermissionReference;
  readonly sourceRef: AssetPermissionReference;
  readonly evidenceRef: AssetPermissionReference;
  readonly contentType: string;
  /** Claimed source digest, checked against the copied bytes. */
  readonly sourceHash: string;
  /** Claimed sanitized output digest, checked against the inspector snapshot. */
  readonly transformedHash: string;
  readonly bytes: Uint8Array;
  readonly roleEvidence: AssetPermissionRoleObservation;
  readonly approvalClaim: AssetPermissionApprovalClaim;
}

export interface AssetPermissionAuthorizationSnapshot {
  readonly status: 'authorized' | 'denied';
  readonly requestHash: string;
  readonly tenantRef: AssetPermissionReference;
  readonly scopeRef: AssetPermissionReference;
  readonly organizationRef: AssetPermissionReference;
  readonly occurrenceRef: AssetPermissionReference;
  readonly editionRef: AssetPermissionReference;
  readonly packageVersion: AssetPermissionReference;
  readonly intendedUse: AssetPermissionReference;
  readonly principalRef: AssetPermissionReference;
  readonly subjectRef: AssetPermissionReference;
  readonly authorizationRevision: AssetPermissionReference;
}

export interface AssetPermissionRoleIdentity {
  readonly version: 'asset-permission-selection/1';
  readonly requestHash: string;
  readonly candidateRef: AssetPermissionReference;
  readonly assetRef: AssetPermissionReference;
  readonly assetVersion: AssetPermissionReference;
  readonly tenantRef: AssetPermissionReference;
  readonly scopeRef: AssetPermissionReference;
  readonly organizationRef: AssetPermissionReference;
  readonly occurrenceRef: AssetPermissionReference;
  readonly editionRef: AssetPermissionReference;
  readonly packageVersion: AssetPermissionReference;
  readonly intendedUse: AssetPermissionReference;
  readonly sourceRef: AssetPermissionReference;
  readonly evidenceRef: AssetPermissionReference;
  readonly contentType: 'image/svg+xml';
  readonly sourceHash: string;
  readonly transformedHash: string;
  readonly inspectionPolicyVersion: string;
  readonly questionId: 'Q-EI-BRAND-ROLE:v1';
  readonly registryVersion: string;
  readonly schemaVersion: string;
  readonly rubricVersion: string;
  readonly definitionHash: string;
  readonly targetRef: AssetPermissionReference;
  readonly observationRef: AssetPermissionReference;
  readonly observationHash: string;
  readonly observerRef: AssetPermissionReference;
  readonly modelRef: AssetPermissionReference;
  readonly regionRef: AssetPermissionReference;
  readonly uncertaintyRef: AssetPermissionReference;
  readonly role: AssetPermissionRole;
}

export interface AssetPermissionRoleDecision extends AssetPermissionRoleIdentity {
  readonly status: 'eligible' | 'review' | 'rejected';
  readonly associationStatus: 'confirmed' | 'unconfirmed' | 'mismatch' | 'unknown';
  readonly decisionRef: AssetPermissionReference;
  readonly authorityRevision: AssetPermissionReference;
  readonly evidenceRevision: AssetPermissionReference;
}

export interface AssetPermissionCurrentRoleEvidence {
  readonly status: 'current' | 'stale';
  readonly requestHash: string;
  readonly candidateRef: AssetPermissionReference;
  readonly transformedHash: string;
  readonly decisionRef: AssetPermissionReference;
  readonly authorizationRevision: AssetPermissionReference;
  readonly evidenceRevision: AssetPermissionReference;
}

export interface AssetPermissionPermissionIdentity {
  readonly version: 'asset-permission-selection/1';
  readonly requestHash: string;
  readonly candidateRef: AssetPermissionReference;
  readonly assetRef: AssetPermissionReference;
  readonly assetVersion: AssetPermissionReference;
  readonly tenantRef: AssetPermissionReference;
  readonly scopeRef: AssetPermissionReference;
  readonly organizationRef: AssetPermissionReference;
  readonly occurrenceRef: AssetPermissionReference;
  readonly editionRef: AssetPermissionReference;
  readonly packageVersion: AssetPermissionReference;
  readonly intendedUse: AssetPermissionReference;
  readonly candidateTenantRef: AssetPermissionReference;
  readonly candidateScopeRef: AssetPermissionReference;
  readonly candidateOrganizationRef: AssetPermissionReference;
  readonly candidateOccurrenceRef: AssetPermissionReference;
  readonly candidateEditionRef: AssetPermissionReference;
  readonly candidatePackageVersion: AssetPermissionReference;
  readonly candidateIntendedUse: AssetPermissionReference;
  readonly sourceRef: AssetPermissionReference;
  readonly evidenceRef: AssetPermissionReference;
  readonly sourceHash: string;
  readonly transformedHash: string;
  readonly approvalRef: AssetPermissionReference;
  readonly declaredExpiresAtMs: number;
  readonly revocationRef: AssetPermissionReference;
}

export interface AssetPermissionDecision extends AssetPermissionPermissionIdentity {
  readonly status: 'authorized' | 'denied' | 'revoked' | 'expired' | 'review';
  readonly approvedHash: string;
  readonly expiresAtMs: number;
  readonly revocationStatus: 'active' | 'revoked' | 'unknown';
  readonly decisionRef: AssetPermissionReference;
  readonly issuerRef: AssetPermissionReference;
  readonly approverRef: AssetPermissionReference;
  readonly verifierRef: AssetPermissionReference;
  readonly authorityRevision: AssetPermissionReference;
  readonly permissionRevision: AssetPermissionReference;
  readonly revocationRevision: AssetPermissionReference;
}

export interface AssetPermissionCurrentDecision {
  readonly status: 'current' | 'stale';
  readonly requestHash: string;
  readonly candidateRef: AssetPermissionReference;
  readonly transformedHash: string;
  readonly decisionRef: AssetPermissionReference;
  readonly authorizationRevision: AssetPermissionReference;
  readonly permissionRevision: AssetPermissionReference;
  readonly revocationRevision: AssetPermissionReference;
}

export interface AssetPermissionPublishAsset {
  readonly candidateRef: AssetPermissionReference;
  readonly assetRef: AssetPermissionReference;
  readonly assetVersion: AssetPermissionReference;
  readonly organizationRef: AssetPermissionReference;
  readonly occurrenceRef: AssetPermissionReference;
  readonly editionRef: AssetPermissionReference;
  readonly packageVersion: AssetPermissionReference;
  readonly intendedUse: AssetPermissionReference;
  readonly sourceRef: AssetPermissionReference;
  readonly evidenceRef: AssetPermissionReference;
  readonly role: AssetPermissionHandoffRole;
  readonly roleQuestionId: 'Q-EI-BRAND-ROLE:v1';
  readonly roleRegistryVersion: string;
  readonly roleSchemaVersion: string;
  readonly roleRubricVersion: string;
  readonly roleDefinitionHash: string;
  readonly roleTargetRef: AssetPermissionReference;
  readonly observationRef: AssetPermissionReference;
  readonly observationHash: string;
  readonly observerRef: AssetPermissionReference;
  readonly modelRef: AssetPermissionReference;
  readonly regionRef: AssetPermissionReference;
  readonly uncertaintyRef: AssetPermissionReference;
  readonly inspectionPolicyVersion: string;
  readonly sourceHash: string;
  readonly transformedHash: string;
  readonly approvalRef: AssetPermissionReference;
  readonly issuerRef: AssetPermissionReference;
  readonly approverRef: AssetPermissionReference;
  readonly permissionDecisionRef: AssetPermissionReference;
  readonly permissionRevision: AssetPermissionReference;
  readonly revocationRef: AssetPermissionReference;
  readonly revocationRevision: AssetPermissionReference;
  readonly expiresAtMs: number;
  readonly roleDecisionRef: AssetPermissionReference;
  readonly roleEvidenceRevision: AssetPermissionReference;
  readonly bytes: Uint8Array;
}

export interface AssetPermissionHandoffPayload {
  readonly version: 'asset-permission-handoff/1';
  readonly selectionId: string;
  readonly request: AssetPermissionRequest;
  readonly mode: 'original-artwork' | 'permitted-reference-images';
  readonly permittedAssets: readonly AssetPermissionPublishAsset[];
  readonly referenceImages: readonly AssetPermissionPublishAsset[];
  readonly fallback: Readonly<{ mode: 'original-artwork' }> | null;
}

export interface AssetPermissionPublishContext {
  readonly version: 'asset-permission-selection/1';
  readonly requestHash: string;
  readonly selectionId: string;
  readonly authorization: AssetPermissionAuthorizationSnapshot;
  readonly roleDecisions: readonly Readonly<{ candidateRef: string; decisionRef: string; evidenceRevision: string }>[];
  readonly permissionDecisions: readonly Readonly<{
    candidateRef: string;
    decisionRef: string;
    permissionRevision: string;
    revocationRevision: string;
    transformedHash: string;
  }>[];
  readonly finalBoundary: 'host-must-atomically-revalidate-current-authorization-and-permissions';
  readonly deadlineAtMs: number;
  readonly signal: AbortSignal | null;
}

export interface AssetPermissionHostAdapters {
  /** Must synchronously authenticate the current actor and exact request scope. */
  readonly readAuthorization: (input: Readonly<{ request: AssetPermissionRequest; requestHash: string }>) => AssetPermissionAuthorizationSnapshot;
  /** Trusted adapter only; this module does not call JEV or accept model output as authority. */
  readonly verifyRoleEvidence: (input: Readonly<{
    request: AssetPermissionRequest;
    requestHash: string;
    authorization: AssetPermissionAuthorizationSnapshot;
    identity: AssetPermissionRoleIdentity;
    observation: AssetPermissionRoleObservation;
    handoffRevalidation?: true;
  }>, signal?: AbortSignal) => AssetPermissionRoleDecision | Promise<AssetPermissionRoleDecision>;
  readonly recheckRoleEvidence: (input: Readonly<{
    request: AssetPermissionRequest;
    requestHash: string;
    authorization: AssetPermissionAuthorizationSnapshot;
    identity: AssetPermissionRoleIdentity;
    decision: AssetPermissionRoleDecision;
  }>) => AssetPermissionCurrentRoleEvidence;
  /** Must verify an externally issued approval, issuer and approver authority, scope, hash, expiry and revocation. */
  readonly verifyPermission: (input: Readonly<{
    request: AssetPermissionRequest;
    requestHash: string;
    authorization: AssetPermissionAuthorizationSnapshot;
    identity: AssetPermissionPermissionIdentity;
    claim: AssetPermissionApprovalClaim;
    handoffRevalidation?: true;
  }>, signal?: AbortSignal) => AssetPermissionDecision | Promise<AssetPermissionDecision>;
  readonly recheckPermission: (input: Readonly<{
    request: AssetPermissionRequest;
    requestHash: string;
    authorization: AssetPermissionAuthorizationSnapshot;
    identity: AssetPermissionPermissionIdentity;
    decision: AssetPermissionDecision;
  }>) => AssetPermissionCurrentDecision;
  /** Must synchronously and atomically revalidate current authority and publish, or reject without publishing. */
  readonly publishHandoff: (payload: AssetPermissionHandoffPayload, context: AssetPermissionPublishContext) => Readonly<{
    status: 'published' | 'rejected';
    requestHash: string;
    selectionId: string;
    handoffRef?: AssetPermissionReference;
  }>;
}

export interface AssetPermissionSelectorOptions {
  readonly signal?: AbortSignal;
  /** Absolute deadline in the `performance.now()` time basis. */
  readonly deadlineAtMs?: number;
}

declare const selectionHandleBrand: unique symbol;
export interface AssetPermissionSelectionHandle {
  readonly [selectionHandleBrand]: true;
}

export interface AssetPermissionSelectionSummary {
  readonly version: 'asset-permission-selection/1';
  readonly selectionId: string;
  readonly handle: AssetPermissionSelectionHandle;
  readonly referenceImageCount: number;
  readonly fallbackRequired: boolean;
}

export interface AssetPermissionHandoffResult {
  readonly status: 'published' | 'fallback_published';
  readonly selectionId: string;
  readonly handoffRef: AssetPermissionReference;
  readonly permittedAssetCount: number;
}

export interface AssetPermissionSelector {
  select(input: Readonly<{
    request: AssetPermissionRequest;
    candidates: readonly AssetPermissionCandidate[];
  }>, options?: AssetPermissionSelectorOptions): Promise<AssetPermissionSelectionSummary>;
  handoff(
    handle: AssetPermissionSelectionHandle,
    request: AssetPermissionRequest,
    options?: AssetPermissionSelectorOptions,
  ): Promise<AssetPermissionHandoffResult>;
}

export interface AssetPermissionSelectionLimits {
  readonly maxCandidates: 8;
  readonly maxTotalSourceBytes: 1048576;
  readonly maxReferenceBytes: 192;
  readonly maxOperationMs: 1500;
  readonly maxHandleAgeMs: 60000;
}

export type AssetPermissionSelectionErrorCode =
  | 'ASSET_SNAPSHOT_MISMATCH'
  | 'AUTHORITY_UNAVAILABLE'
  | 'AUTHORIZATION_DENIED'
  | 'CANCELLED'
  | 'DEADLINE_EXCEEDED'
  | 'INVALID_INPUT'
  | 'INVALID_SELECTION'
  | 'LIMIT_EXCEEDED'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_STALE'
  | 'PRINCIPAL_CHANGED'
  | 'PUBLISH_NOT_SYNCHRONOUS'
  | 'PUBLISH_REJECTED'
  | 'REQUEST_MISMATCH'
  | 'ROLE_EVIDENCE_STALE'
  | 'SELECTION_EXPIRED';

export declare class AssetPermissionSelectionError extends Error {
  readonly code: AssetPermissionSelectionErrorCode;
}

export declare const ASSET_PERMISSION_SELECTION_VERSION: 'asset-permission-selection/1';
export declare const ASSET_PERMISSION_SELECTION_LIMITS: AssetPermissionSelectionLimits;

/** Partial wiring is permitted so missing host authorities fail closed to fallback or a typed denial. */
export declare function createAssetPermissionSelector(
  adapters: Partial<AssetPermissionHostAdapters>,
): AssetPermissionSelector;
