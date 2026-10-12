import assert from 'node:assert/strict';
import { sanitizedJson } from './receipt.mjs';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.FINANCE_SOURCE, 'FINANCE_SOURCE is required');
assert.ok(process.env.FINANCE_EVIDENCE, 'FINANCE_EVIDENCE is required');
export const source = resolve(process.env.FINANCE_SOURCE);
export const evidence = resolve(process.env.FINANCE_EVIDENCE);
export const api = await import(pathToFileURL(join(source, 'dist/index.js')));
const { sanitizeOutput } = await import(pathToFileURL(join(source, 'scripts/sanitize.mjs')));
const secrets = Object.entries(process.env).filter(([key]) => key.endsWith('_PASSWORD')).map(([, value]) => value);
export const owner = await import(pathToFileURL(join(source, 'tests/budgets/reservation-harness.mjs')));

// Ordinary RuntimePorts composition from owner authorization.test.mjs:673.
// Every authority here is the explicitly synthetic owner fixture, never a live issuer.
export function publicPorts(pool, scope, options = {}) {
  const low = owner.makePorts(pool, scope, options);
  return {
    ...low, storage: { isAvailable: async () => true }, providerSource: { isAvailable: async () => true },
    budgets: { database: low.database, reservationAuthority: low.reservationAuthority, budgetEvidence: low.budgetEvidence },
  };
}

export async function createScenario(id) {
  const pool = owner.reservationPool();
  const scope = owner.makeScope(`evaluation-${id}`);
  const ports = publicPorts(pool, scope);
  const fixture = await owner.loadReserveFixture();
  const trace = [];
  return {
    pool, scope, ports, fixture,
    failure(error) { trace.push({ operation: 'assertion-failure', message: error instanceof Error ? error.message : String(error) }); },
    record(operation, result) { trace.push({ operation, result }); },
    async call(operation, request, selectedPorts = ports) {
      const result = await api[operation](request, selectedPorts);
      trace.push({ operation, request, result });
      return result;
    },
    async rows() {
      const result = await pool.query(`SELECT
        (SELECT count(*)::int FROM cost_intelligence.budget_reservation_events WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS holds,
        (SELECT trim_scale(COALESCE(sum(held_amount),0))::text FROM cost_intelligence.budget_reservation_events WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS held,
        (SELECT count(*)::int FROM cost_intelligence.usage_intake_inbox WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS inbox,
        (SELECT count(*)::int FROM cost_intelligence.usage_intake_outbox WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS outbox,
        (SELECT count(*)::int FROM cost_intelligence.financial_ledger_events WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS ledger,
        (SELECT trim_scale(COALESCE(sum(amount),0))::text FROM cost_intelligence.financial_ledger_events WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4) AS amount`,
      [scope.tenantId, scope.projectId, scope.environment, scope.billingMode]);
      trace.push({ operation: 'observer scoped SQL', result: result.rows });
      return result.rows[0];
    },
    async close() {
      try {
        await writeFile(join(evidence, `${id}.json`), `${sanitizedJson({ id, authority: 'synthetic-owner-fixtures', trace }, text => sanitizeOutput(text, secrets))}\n`);
      } finally { await pool.end(); }
    },
  };
}

export function value(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

export async function policy(scenario, limit = '1') {
  const { limitAmount, ...setup } = owner.policyChange(scenario.scope, { limitAmount: limit });
  const result = value(await scenario.call('changeBudget', { ...setup, newLimit: limitAmount, expectedLedgerRevision: 0 }));
  assert.equal(result.status, 'applied');
  assert.equal(result.effectiveLimit, limit);
  return result.decisionReference;
}

export function current(scope, request, reservationId) {
  return { schemaVersion: '1.0.0', requestId: randomUUID(), scope, reservationId,
    attemptBinding: request.attemptBinding, authorityBinding: request.authorityBinding, phase: 'preparation' };
}

// Synthetic observation recipe from owner authorization.test.mjs:15; only fixture identities vary.
export async function observation(scope, binding) {
  const request = JSON.parse(await readFile(join(source, 'fixtures/metering/usage-observation.request.json'), 'utf8'));
  Object.assign(request, { scope, requestId: randomUUID(), idempotencyKey: randomUUID(), evidenceProvenanceRef: `fixture:synthetic:${randomUUID()}` });
  Object.assign(request.usageEvent, {
    tenant_id: scope.tenantId, project_id: scope.projectId, environment: scope.environment, billing_mode: scope.billingMode,
    event_id: randomUUID(), usage_event_id: randomUUID(), source_observation_id: randomUUID(), correlation_id: randomUUID(),
    logical_operation_id: binding?.logicalOperationId ?? randomUUID(), provider_attempt_id: binding?.providerAttemptId ?? randomUUID(),
    billable_attempt_id: binding?.billableAttemptId ?? randomUUID(), transport_attempt_id: binding?.transportAttemptId ?? randomUUID(), provider_request_id: null,
    occurred_at: owner.FIXED_TIME, observed_at: owner.FIXED_TIME, ingested_at: owner.FIXED_TIME,
  });
  return request;
}

export function unpriced(request) {
  Object.assign(request.usageEvent, { completeness: 'incomplete', usage_units: null, missing_fields: ['usage', 'amount'],
    valuation: { basis: 'unknown', money: null, rate_card_ref: null }, outcome: 'partial' });
  return request;
}
