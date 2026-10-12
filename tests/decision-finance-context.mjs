import { financeSeeds, fixtureReferences, requestReference } from './finance-fixture-seeds.mjs';
export async function independentDecisionFinanceContext(trustedBudget, now) {
  const seeds = await financeSeeds();
  const value = structuredClone(seeds.cases.BudgetReservation.value), context = structuredClone(seeds.cases.BudgetReservation.context);
  for (const key of ['tenant_id', 'project_id', 'reservation_id', 'budget_scope_id', 'logical_operation_id', 'billable_attempt_id', 'environment', 'billing_mode', 'held', 'consumed', 'authority_ref', 'expires_at', 'revision', 'idempotency_key']) value[key] = structuredClone(trustedBudget[key]);
  const request = context.initial_request;
  for (const key of ['tenant_id', 'project_id', 'budget_scope_id', 'logical_operation_id', 'billable_attempt_id', 'environment', 'billing_mode', 'expires_at', 'idempotency_key']) request[key] = structuredClone(trustedBudget[key]);
  request.requested = structuredClone(trustedBudget.held);
  value.requested_capacity = structuredClone(trustedBudget.held); value.grant_request_ref = requestReference(request);
  value.dispatch_cap = structuredClone(trustedBudget.held); value.retained_exposure = structuredClone(trustedBudget.held);
  value.grant_revision = trustedBudget.revision;
  context.scope = { tenant_id: value.tenant_id, project_id: value.project_id }; context.now = now;
  context.environment = value.environment; context.billing_mode = value.billing_mode; context.currency = value.held.currency;
  context.authority_ref = structuredClone(value.authority_ref); context.authorized_capacity = structuredClone(value.held); context.grant_revision = value.grant_revision;
  context.references = fixtureReferences(value); context.current_reservation = structuredClone(value); context.requested_dispatch = structuredClone(value.held);
  return context;
}
