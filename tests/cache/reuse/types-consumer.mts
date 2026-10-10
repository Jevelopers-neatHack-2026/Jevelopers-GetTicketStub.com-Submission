import { createScopedReuseStore, type AdmissionResult, type CacheIdentity, type LookupResult, type ReusePins, type ScopedReuseScope } from '../../../src/cache/reuse/index.mjs';

interface AuthenticatedRequest {
  readonly principal: { readonly tenantId: string; readonly actorId: string };
}

declare const options: import('../../../src/cache/reuse/store.mjs').ScopedReuseOptions<AuthenticatedRequest>;
declare const request: AuthenticatedRequest;
declare const scope: ScopedReuseScope;
declare const identity: CacheIdentity;
declare const pins: ReusePins;

const store = createScopedReuseStore(options);
const privateResult = await store.getPrivateProfile(scope, request, {
  identity,
  pins,
  contentHash: 'a'.repeat(64),
});
void store.dispatchPendingInvalidations(scope, request, 20, 'tenant_private', new AbortController().signal);
declare const lookupResult: LookupResult;
declare const admissionResult: AdmissionResult;

if (lookupResult.status === 'unavailable' && lookupResult.reason === 'clock_rollback') {
  // @ts-expect-error clock rollback has no profile row or reference
  void lookupResult.profileRef;
}
if (lookupResult.status === 'unavailable' && lookupResult.reason === 'source_outage') {
  const profileRef: string = lookupResult.profileRef;
  void profileRef;
}
if (admissionResult.status === 'unavailable') {
  // @ts-expect-error clock rollback did not create an admission or usage record
  void admissionResult.admissionRef;
  // @ts-expect-error unknown usage must stay unknown when no admission was made
  void admissionResult.usage;
}
if (admissionResult.status === 'admitted' || admissionResult.status === 'refresh_unresolved') {
  const usage: 'unknown' = admissionResult.usage;
  const transport: 'not_implemented' = admissionResult.providerTransport;
  void usage;
  void transport;
}

if (privateResult.status === 'hit') {
  const trust: 'tenant_private' = privateResult.trust;
  void trust;
}

// @ts-expect-error tenant scope capabilities cannot be fabricated from a string
const forgedScope: ScopedReuseScope = request.principal.tenantId;
// @ts-expect-error publication mode comes from an opaque PrivacyBoundary derivative, never a client boolean
void store.publishReviewedPublicProfile(scope, request, { public: true, identity, pins });
void forgedScope;
