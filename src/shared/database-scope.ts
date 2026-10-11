import type { TrustedScope } from './contracts.js';

type ScopeBindingClient = {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
};

/** Bind the current authority-checked scope to this transaction for PostgreSQL RLS. */
export async function bindFinancialDatabaseScope(client: ScopeBindingClient, scope: TrustedScope): Promise<void> {
  await client.query(
    `SELECT set_config('cost_intelligence.tenant_id', $1, true),
            set_config('cost_intelligence.project_id', $2, true),
            set_config('cost_intelligence.environment', $3, true),
            set_config('cost_intelligence.billing_mode', $4, true)`,
    [scope.tenantId, scope.projectId, scope.environment, scope.billingMode],
  );
}
