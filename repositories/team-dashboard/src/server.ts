/**
 * Server-only entry: trusted host session verification seam, permission matrix and guarded reads.
 * It has no React dependency and no client directive. Never import it into browser code.
 */
export {
  CONTEXT_TTL_LIMITS, TIMEOUT_LIMITS, createDashboardAuthorizer, createGuardedRouteReader, parseInstant, toHostAccessProjection,
  type AuthorizationDecision, type AuthorizeInput, type AuthorizerOptions, type BillingMode, type DashboardAuthorizer, type DenyCause, type DenyReason,
  type FinanceEnvironment, type GuardedReadInput, type GuardedReadOutcome, type GuardedReadResult, type GuardedReaderOptions, type GuardedRouteReader,
  type HostCredential, type HostSessionVerifier, type TrustedHostContext, type TrustedReadRequest, type TrustedScope, type UnavailableCause,
  type VerifyFailure, type VerifyRequest, type VerifyResult,
} from './access/trusted-host';
export { FINANCE_EXPORT, FINANCE_READ, PERMISSION_MATRIX_VERSION, requiredCapabilities, routeCapabilities } from './access/permissions';
export type { HostAccess, HostScope } from './access/host';
export type { RouteState } from './data/boundary';
export type { ResolvedRoute, RouteId } from '../integration/routes';
