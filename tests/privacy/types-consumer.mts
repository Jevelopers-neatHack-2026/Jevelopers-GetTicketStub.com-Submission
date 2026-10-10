import { createPrivacyBoundary } from '../../src/privacy/boundary.mjs';
import { createPrivacyFlows } from '../../src/privacy/flows.mjs';
import {
  authorizeAction,
  createActionRequest,
  createTrustedActionPolicy,
} from '../../src/security/content-boundary/policy.mjs';

type AuthenticatedRequest = {
  readonly principal: { readonly tenantId: string };
};

const boundary = createPrivacyBoundary<AuthenticatedRequest>({
  resolveTenant: (request) => request.principal.tenantId,
  reviewPublicFacts: (input) => ({
    status: 'approved',
    tenantId: input.tenantId,
    sourceDigest: input.sourceDigest,
    facts: { event_name: 'Fixture Event' },
  }),
});
const scope = boundary.scopeForAuthenticatedRequest({ principal: { tenantId: 'tenant-a' } });
const flows = createPrivacyFlows(boundary);
const start = boundary.begin(scope, { modality: 'plain_text', content: 'Fixture Event' });
const result = await boundary.prepare(scope, start.session, { event_name: 'Fixture Event' });
const derivative = boundary.publish(scope, start.session);
flows.cache.put(scope, 'fixture', derivative);
flows.diagnostic.record(scope, result);

// @ts-expect-error authenticated request shape is determined by the configured resolver
boundary.scopeForAuthenticatedRequest({ tenantId: 'browser-controlled' });
// @ts-expect-error derivative handles must come from the boundary issuer
flows.cache.put(scope, 'forged', { facts: { event_name: 'canary' } });

const policy = createTrustedActionPolicy({ allowedCapabilities: ['search'], maxBillableUnits: 2 });
authorizeAction(policy, createActionRequest('search', 1));
