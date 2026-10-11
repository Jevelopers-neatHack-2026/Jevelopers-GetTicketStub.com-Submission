import { appendFileSync } from "node:fs";
import { createCreativeApi } from "../../src/api/v1.mjs";
import { canonicalHash } from "../../src/contracts/index.mjs";
import { createUsageObservation, createSqliteTelemetryOutbox, USAGE_PROFILE } from "../../src/telemetry/index.mjs";
import { createCreativeVersionApiPorts } from "../../src/versions/api-ports.mjs";
import { CreativeVersionStore } from "../../src/versions/store.mjs";

const databasePath = process.env.CE09_INSPECTION_DATABASE;
const objectRoot = process.env.CE09_INSPECTION_OBJECTS;
const actionId = process.env.CE09_INSPECTION_ACTION;
const designVersionId = process.env.CE09_INSPECTION_DESIGN;
const callLog = process.env.CE09_INSPECTION_CALL_LOG;
const now = Number(process.env.CE09_INSPECTION_NOW);
if (![databasePath, objectRoot, actionId, designVersionId, callLog].every((value) =>
  typeof value === "string" && value.length > 0) || !Number.isSafeInteger(now)) process.exit(2);

const scope = Object.freeze({ tenant_id: "tenant-api-1", project_id: "project-api-1", brief_id: "brief-api-1" });
const actor = { actor_id: "actor-api-1", tenant_id: scope.tenant_id, project_id: scope.project_id,
  expires_at: "2026-10-11T00:00:00.000Z", permissions: ["creative.generate", "creative.edit", "creative.read",
    "creative.restore", "creative.cancel"], budget_scope_id: "budget-api-1", budget_policy_version: "budget-policy/1" };
const store = new CreativeVersionStore({ databasePath, objectRoot, now: () => now });
const adapter = createCreativeVersionApiPorts({ store, idFactory: (() => { let next = 0; return () => `inspect-crash-port-${++next}`; })(),
  leaseDurationMs: 60_000, otherPorts: {
    metering: {
      async reserveAttempt(attempt) { return { status: "reserved", reservation_id: `reservation:${attempt.billable_attempt_id}`,
        billable_attempt_id: attempt.billable_attempt_id, held_amount: { amount: "1.00", currency: "USD" },
        lease_id: `finance-lease:${attempt.billable_attempt_id}` }; },
      async releaseBeforeDispatch() { return { status: "released" }; },
      async markAttemptInFlight(input) { return { status: "in_flight", reservation_id: input.reservation_id }; },
      async recordTransportAttempt() { return { status: "recorded" }; },
      async recordUsageObservation(input) { return { status: "accepted",
        source_observation_id: input.observation.source_observation_id,
        effective_billable_attempt_id: input.observation.billable_attempt_id }; },
      async settleReservation(input) { return { status: "settled", reservation_id: input.reservation_id,
        consumed_amount: { amount: "0.10", currency: "USD" }, released_unused_amount: { amount: "0.90", currency: "USD" } }; },
      async markOutcomeUnknown() { return { status: "held_for_reconciliation" }; },
    },
    inspection: {
      resolveRoute() { return { retry_mapping_ref: "retry:inspection-crash/1", provider: { name: "fixture-vision",
        model: "fixture-vision-model", endpoint: "test:/vision", sdk: { name: "fixture-sdk", version: "1.0" } } }; },
      async inspect(input) {
        appendFileSync(callLog, `${actionId}:observer-dispatched\n`, { mode: 0o600 });
        await input.recordTransportAttempt(input.transport_attempt_id);
        appendFileSync(callLog, `${actionId}:transport-recorded\n`, { mode: 0o600 });
        process.exit(86);
      },
    },
  } });

adapter.ports.telemetry = {
  outbox: createSqliteTelemetryOutbox({ database: store.db, clock: () => new Date(now) }),
  modes: { provider_execution_mode: "mock", commerce_mode: "simulated" },
  usage_profiles: { vision_observation: "creative.normalized-token-usage/1" },
  usage_profile_authority: Object.freeze({
    mapProviderUsage(input) {
      const observation = createUsageObservation({ attempt: input.attempt, trustedScope: input.trustedScope,
        usage: input.rawUsage, profile: USAGE_PROFILE.NORMALIZED, sourceObservationId: input.sourceObservationId,
        source: "provider_response", transportAttemptId: input.transportAttemptId });
      return { status: "mapped", profile_ref: "offline-fixture-profile:creative.normalized-token-usage/1",
        profile_sha256: canonicalHash({ profile: USAGE_PROFILE.NORMALIZED, source: "inspection-crash-worker" }),
        raw_usage_sha256: input.rawUsageSha256, target_binding_sha256: input.targetBindingSha256,
        attempt_binding_sha256: input.attemptBindingSha256, observation };
    },
  }),
};
const api = createCreativeApi({ ports: adapter.ports, now: () => now,
  idFactory: (() => { let next = 0; return () => `inspect-crash-api-${++next}`; })() });
const body = { contract: "CreativeApiRequest", schema_version: "1.0", event_id: `event-${actionId}`,
  request_id: `request-${actionId}`, tenant_id: scope.tenant_id, project_id: scope.project_id,
  correlation_id: `correlation-${actionId}`, producer: "versions-inspection-crash-worker",
  occurred_at: "2026-10-10T12:20:00.000Z", ingested_at: "2026-10-10T12:20:00.000Z",
  environment: "test", billing_mode: "simulated", source_refs: ["source-api-1"], operation: "inspect",
  action_id: actionId, payload: { brief_id: scope.brief_id, design_version_id: designVersionId } };
const result = await api.invoke(actor, body);
if (result?.ok !== true) {
  process.stderr.write(JSON.stringify({ code: result?.error?.code ?? "unknown", field: result?.error?.field ?? "" }));
  process.exit(3);
}
store.close();
