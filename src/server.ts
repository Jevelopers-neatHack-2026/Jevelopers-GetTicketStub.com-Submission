/**
 * Server-only entry: trusted host session verification seam, permission matrix and guarded reads.
 * It has no React dependency and no client directive. Never import it into browser code.
 */
export {
  createDashboardAuthorizer, createGuardedRouteReader, toHostAccessProjection,
  type AuthorizationDecision, type AuthorizeInput, type AuthorizerOptions, type DashboardAuthorizer, type DenyReason,
  type GuardedReadInput, type GuardedRouteReader, type HostCredential, type HostSessionVerifier,
  type TrustedHostContext, type TrustedReadRequest, type VerifyFailure, type VerifyRequest, type VerifyResult,
} from './access/trusted-host';
export { FINANCE_EXPORT, FINANCE_READ, PERMISSION_MATRIX_VERSION, requiredCapabilities, routeCapabilities } from './access/permissions';
export type { HostAccess, HostScope } from './access/host';
export type { RouteState } from './data/boundary';
export type { ResolvedRoute, RouteId } from '../integration/routes';
