import type { RouteId } from '../../integration/routes';

/**
 * Proposed dashboard permission matrix. Each route lists the explicit host capability strings a verified
 * context must hold. Role names are never consulted. The capability strings follow the host's GT-FIN-001
 * proposal (getticketstub.com PR #42); neither the host nor Finance has accepted this matrix yet.
 */
export const PERMISSION_MATRIX_VERSION = 'team-dashboard.permissions/1';
export const FINANCE_READ = 'finance.read';
export const FINANCE_EXPORT = 'finance.export';
export const routeCapabilities: Readonly<Record<RouteId, readonly string[]>> = Object.freeze({
  overview: [FINANCE_READ],
  'ai-costs': [FINANCE_READ],
  sales: [FINANCE_READ],
  fulfillment: [FINANCE_READ],
  budgets: [FINANCE_READ],
  transactions: [FINANCE_READ],
  'transaction-detail': [FINANCE_READ],
  events: [FINANCE_READ],
  'event-detail': [FINANCE_READ],
  reports: [FINANCE_READ],
  exports: [FINANCE_READ, FINANCE_EXPORT],
});
/** Unknown routes require an unsatisfiable grant, so they fail closed. */
export function requiredCapabilities(route: string): readonly string[] | undefined {
  return Object.hasOwn(routeCapabilities, route) ? routeCapabilities[route as RouteId] : undefined;
}
