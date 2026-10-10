import { createScopedReuseStore, type CacheIdentity, type ReusePins, type ScopedReuseScope } from '../../../src/cache/reuse/index.mjs';

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

if (privateResult.status === 'hit') {
  const trust: 'tenant_private' = privateResult.trust;
  void trust;
}

// @ts-expect-error tenant scope capabilities cannot be fabricated from a string
const forgedScope: ScopedReuseScope = request.principal.tenantId;
// @ts-expect-error publication mode comes from an opaque PrivacyBoundary derivative, never a client boolean
void store.publishReviewedPublicProfile(scope, request, { public: true, identity, pins });
void forgedScope;
