import "server-only";
import { randomUUID } from "node:crypto";
import { canonicalHash } from "creative-engine/contracts";
import { validateUsageObservation } from "creative-engine/contracts/metering";
import { decisionExecutionTargetHash } from "creative-engine/contracts/decision-port/v1";
import {
  authorizeReservation, markReservationDispatched, readReservationSnapshot,
  revalidateReservation, settleReservation, releaseReservation,
  budgetDigest, normalizedBudgetRequest,
} from "@jevelopers/cost-intelligence/budgets";
import { ingestUsage } from "@jevelopers/cost-intelligence/metering";
import { estimateV2 } from "@jevelopers/cost-intelligence/pricing";
import { createUsageObservation, USAGE_PROFILE } from "creative-engine/telemetry";
import { CreativeHostError } from "./config.mjs";

const same = (left, right) => canonicalHash(left) === canonicalHash(right);
const required = (value) => { if (!value) throw new CreativeHostError("creative_finance_unavailable"); return value; };
const decimalScale = (value) => value.includes(".") ? value.split(".")[1].length : 0;
const money = (amount) => ({ amount, currency: "USD", scale: decimalScale(amount) });
const difference = (left, right) => {
  const scaled = (text) => { const [whole, fraction = ""] = text.split("."); return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0")); };
  const result = scaled(left) - scaled(right);
  if (result <= 0n) return "0";
  return `${result / 1_000_000_000n}.${String(result % 1_000_000_000n).padStart(9, "0")}`;
};
const resultValue = (result) => {
  if (!result?.ok) throw new CreativeHostError("creative_finance_unavailable");
  return result.value;
};
const versioned = (contract, id, value) => ({ contract, schema_version: "1.0.0", id, revision: 1, content_hash: canonicalHash(value) });

/** Mapping and recovery state only. The PostgreSQL cost-intelligence event log
 * is the sole reservation/capacity authority. This table never grants money. */
export function createCreativeFinance({ database, pool, authority, currentContext, environment, sourceRevision, now = Date.now }) {
  database.exec(`CREATE TABLE IF NOT EXISTS ticketstub_creative_attempts (
    billable_attempt_id TEXT PRIMARY KEY, state TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS ticketstub_creative_finance_sources (
    request_digest TEXT PRIMARY KEY, billable_attempt_id TEXT NOT NULL,
    source_ref TEXT NOT NULL, maximum TEXT
  )`);
  const save = (state) => database.prepare("INSERT INTO ticketstub_creative_attempts(billable_attempt_id,state) VALUES (?,?) ON CONFLICT(billable_attempt_id) DO UPDATE SET state=excluded.state")
    .run(state.attempt.billable_attempt_id, JSON.stringify(state));
  const load = (billable) => {
    const found = database.prepare("SELECT state FROM ticketstub_creative_attempts WHERE billable_attempt_id=?").get(billable);
    return found ? JSON.parse(found.state) : null;
  };
  const loadByReservation = (input) => {
    const row = required(load(input.billable_attempt_id));
    if (row.reservation_id !== input.reservation_id || row.attempt.logical_operation_id !== input.logical_operation_id || row.binding.leaseRef !== input.lease_id) required(false);
    return row;
  };
  const fresh = async () => { await currentContext(); return authority(); };
  const scope = (entry) => ({ tenantId: entry.tenant_id, projectId: entry.project_id, environment, billingMode: "live", actorId: entry.finance_service.actor_id });
  const scopeMatches = (value, entry) => same(value, scope(entry));
  const timestamp = () => new Date(now()).toISOString();
  const common = (row, contract) => ({ contract, schema_version: "1.0.0", policy_version: "1.0.0",
    event_id: randomUUID(), tenant_id: row.attempt.tenant_id, project_id: row.attempt.project_id,
    correlation_id: row.correlation_id, producer: { module: "getticketstub.com", source_revision: sourceRevision, build_revision: sourceRevision },
    occurred_at: timestamp(), observed_at: timestamp(), ingested_at: timestamp(), environment, billing_mode: "live", source_refs: [] });
  const register = async (request, row, sourceRef, maximum) => {
    const digest = await budgetDigest(normalizedBudgetRequest(request));
    database.prepare("INSERT OR IGNORE INTO ticketstub_creative_finance_sources(request_digest,billable_attempt_id,source_ref,maximum) VALUES (?,?,?,?)")
      .run(digest, row.attempt.billable_attempt_id, JSON.stringify(sourceRef), maximum ? JSON.stringify(maximum) : null);
  };
  const ports = {
    database: pool, clock: { now: () => new Date(now()) }, authorityWaitMs: 2000,
    trustedContext: { async resolve(requested) { const entry = await fresh(); return scopeMatches(requested, entry) ? requested : null; } },
    financeAuthority: {
      async authorizeCurrent(input) {
        const entry = await fresh();
        if (!scopeMatches(input.requestedScope, entry) || !entry.finance_service.operations.includes(input.operation)) return null;
        return { status: "allowed", decisionId: entry.finance_service.evidence_ref, operation: input.operation, permission: input.permission,
          scope: input.requestedScope, principal: { kind: "service", actorId: entry.finance_service.actor_id,
            serviceStatus: "active", serviceGrantRevision: entry.finance_service.grant_revision }, verifiedAt: timestamp(),
          expiresAt: new Date(Math.min(now() + 60_000, Date.parse(entry.expires_at), Date.parse(entry.finance_service.expires_at))).toISOString() };
      },
    },
    reservationAuthority: {
      async verifyCurrent(query) {
        const entry = await fresh();
        const row = load(query.billableAttemptId);
        if (!row || !scopeMatches(query.scope, entry) || !same(query.binding, row.binding) || !same(query.sourceAuthorityRef, row.source_ref) ||
            query.binding.grantRef !== row.access.grant_ref || row.access.evidence_sha256 !== (row.attempt.provider.name === "openrouter" ? entry.image_access.evidence_sha256 : entry.decision_access?.evidenceSha256) ||
            query.reservationId && query.reservationId !== row.reservation_id || query.transportAttemptId && query.transportAttemptId !== row.transport_id ||
            query.dispatchIntentRef && !same(query.dispatchIntentRef, row.dispatch_ref)) return null;
        return { status: "allowed", revoked: false, queryDigest: await budgetDigest(query), verifiedAt: timestamp(),
          expiresAt: row.binding.leaseExpiresAt, evidenceRef: row.access.evidence_ref, evidenceSha256: row.access.evidence_sha256 };
      },
    },
    budgetEvidence: {
      async verifyCurrent(query) {
        const entry = await fresh();
        const found = database.prepare("SELECT * FROM ticketstub_creative_finance_sources WHERE request_digest=?").get(query.requestDigest);
        if (!found || !scopeMatches(query.scope, entry) || !same(JSON.parse(found.source_ref), query.sourceAuthorityRef)) return null;
        const row = load(found.billable_attempt_id);
        const maximum = entry.maximums[row.attempt.operation_kind];
        if (!row || !maximum || !same(maximum.policy_ref, row.maximum.policy_ref) || maximum.amount !== row.maximum.amount) return null;
        return { status: "verified", queryDigest: await budgetDigest(query), verifiedAt: timestamp(),
          expiresAt: new Date(Math.min(Date.parse(maximum.expires_at), Date.parse(entry.expires_at))).toISOString(),
          ...(found.maximum ? { maximum: JSON.parse(found.maximum) } : {}) };
      },
    },
  };
  const snapshot = async (row) => resultValue(await readReservationSnapshot({ schemaVersion: "1.0.0", requestId: randomUUID(), scope: row.scope, reservationId: row.reservation_id }, ports));
  const commandBase = (row, expectedRevision, action) => ({ schemaVersion: "1.0.0", requestId: randomUUID(), idempotencyKey: `${row.attempt.billable_attempt_id}:${action}`,
    scope: row.scope, reservationId: row.reservation_id, expectedRevision, actorReference: row.scope.actorId,
    sourceAuthorityRef: row.source_ref, attemptBinding: row.attempt_binding });
  const metering = {
    async reserveAttempt(attempt, prepared) {
      const entry = await fresh();
      if (attempt.billing_mode !== "live" || attempt.environment !== environment || attempt.tenant_id !== entry.tenant_id || attempt.project_id !== entry.project_id ||
          attempt.budget_scope_id !== entry.budget_scope_id || !prepared || !/^sha256:[a-f0-9]{64}$/.test(prepared.target_binding_sha256) ||
          !prepared.transport_attempt_id || Date.parse(prepared.deadline_at) <= now()) required(false);
      // This context comes only from the owned CE preparation/C03 path, never
      // request JSON. The native image adapter validates its opaque minted
      // token and exact original target hash; do not invent a competing image
      // hashing recipe (the telemetry snapshot canonicalizes object order).
      if (attempt.provider.name === "typesafe" && decisionExecutionTargetHash(prepared.target_binding?.request,
        { trustedScope: { tenant_id: attempt.tenant_id, project_id: attempt.project_id, job_id: prepared.target_binding?.request?.job_id } }) !== prepared.target_binding_sha256) required(false);
      const maximum = required(entry.maximums[attempt.operation_kind]);
      const access = attempt.provider.name === "openrouter" ? entry.image_access : entry.decision_access;
      required(access);
      // Decision eligibility and image eligibility have separate identities.
      const normalizedAccess = attempt.provider.name === "openrouter" ? access : { account_ref: access.accountRef, project_ref: access.projectRef,
        grant_ref: access.grantRef, evidence_ref: access.evidenceRef, evidence_sha256: access.evidenceSha256, expires_at: access.expiresAt };
      const row = load(attempt.billable_attempt_id) ?? {
        attempt: structuredClone(attempt), scope: scope(entry), correlation_id: randomUUID(), transport_id: prepared.transport_attempt_id,
        access: normalizedAccess, maximum, source_ref: entry.finance_service.source_authority_ref,
        binding: { mappingVersion: "ci-reservation-authority-1.0.0", budgetScopeId: attempt.budget_scope_id,
          grantRef: normalizedAccess.grant_ref, accountRef: normalizedAccess.account_ref, projectRef: normalizedAccess.project_ref,
          provider: attempt.provider.name, model: attempt.provider.model, operation: attempt.operation_kind === "image_generation" ? "generate" : attempt.operation_kind === "image_edit" ? "edit" : "decision",
          targetBindingSha256: prepared.target_binding_sha256, leaseRef: randomUUID(),
          leaseExpiresAt: new Date(Math.min(Date.parse(prepared.deadline_at), Date.parse(normalizedAccess.expires_at), Date.parse(entry.expires_at))).toISOString() },
      };
      if (!same(row.attempt, attempt) || row.transport_id !== prepared.transport_attempt_id || row.binding.targetBindingSha256 !== prepared.target_binding_sha256) required(false);
      row.attempt_binding ??= { logicalOperationId: attempt.logical_operation_id, transportAttemptId: row.transport_id,
        providerRequestId: null, providerAttemptId: row.attempt.billable_attempt_id, billableAttemptId: attempt.billable_attempt_id };
      row.reserve_request ??= {
        schemaVersion: "1.0.0", requestId: randomUUID(), idempotencyKey: `${attempt.billable_attempt_id}:reserve`, scope: row.scope,
        canonicalRequest: { ...common(row, "ReserveRequest"), request_id: randomUUID(), idempotency_key: `${attempt.billable_attempt_id}:reserve`,
          budget_scope_id: entry.budget_scope_id, logical_operation_id: attempt.logical_operation_id, billable_attempt_id: attempt.billable_attempt_id,
          currency: "USD", policy_ref: entry.budget_policy_ref, requested: money(maximum.amount), expires_at: row.binding.leaseExpiresAt },
        estimate: { completeness: "unknown", knownSubtotal: "0", currency: "USD", rateCardRef: null, missingDimensions: ["usage"],
          boundedConservativeMaximum: maximum.amount, maximumPolicyRef: maximum.policy_ref },
        allowPartialAuthorization: false, attemptBinding: row.attempt_binding, authorityBinding: row.binding, sourceAuthorityRef: row.source_ref,
      };
      save(row);
      await register(row.reserve_request, row, row.source_ref, { policyRef: maximum.policy_ref, authorizedCap: maximum.amount, currency: "USD" });
      const admission = await authorizeReservation(row.reserve_request, ports);
      if (!admission.ok) { row.authority_error = { code: admission.error.code, operation: admission.error.operation, safe_message: admission.error.safe_message }; save(row); }
      const decision = resultValue(admission);
      if (decision.status !== "authorized" || decision.historicalReplay || !decision.finance) return { status: "denied", reason: "budget_unavailable" };
      row.reservation_id = decision.reservationId;
      row.held_amount = decision.heldAmount;
      row.state = "reserved";
      save(row);
      return { status: "reserved", reservation_id: row.reservation_id, billable_attempt_id: attempt.billable_attempt_id,
        held_amount: { amount: decision.heldAmount, currency: decision.currency }, lease_id: row.binding.leaseRef };
    },
    async markAttemptInFlight(input) { const row = loadByReservation(input); await fresh(); row.state = "in_flight"; save(row); return { status: "in_flight", reservation_id: row.reservation_id }; },
    async recordTransportAttempt(input) {
      const row = loadByReservation(input);
      if (input.transport_attempt_id !== row.transport_id || !row.dispatch_ref) required(false);
      row.dispatch_command ??= { ...commandBase(row, (await snapshot(row)).expectedRevision, "dispatch"), action: "mark_dispatched",
        dispatchIntentRef: row.dispatch_ref, workerLeaseId: row.binding.leaseRef, workerLeaseExpiresAt: row.binding.leaseExpiresAt };
      save(row);
      await register(row.dispatch_command, row, row.source_ref);
      const answer = resultValue(await markReservationDispatched(row.dispatch_command, ports));
      if (!["applied", "replayed"].includes(answer.status)) required(false);
      row.state = "dispatched"; save(row);
      return { status: "recorded" };
    },
    async recordUsageObservation(input) {
      const row = loadByReservation(input);
      const observation = validateUsageObservation(input.observation, row.attempt);
      const entry = await fresh();
      const rate = entry.usage_profile?.source_authority_ref;
      // The creative usage-profile port owns completeness of counters. Its
      // contract deliberately rejects financial valuation. Finance consumes
      // this separately persisted, exact-bound reported-cost receipt under the
      // owner's reviewed policy without upgrading it to reconciled expense.
      const reported = row.reported_cost_receipt;
      const amount = reported && canonicalHash(reported) === row.reported_cost_receipt_sha256 && reported.source_observation_id === observation.source_observation_id &&
        reported.transport_attempt_id === row.transport_id && reported.target_binding_sha256 === row.binding.targetBindingSha256 &&
        reported.profile_sha256 === entry.usage_profile?.sha256 ? reported.amount : undefined;
      row.finance_observation_id ??= randomUUID();
      const identity = { schema_version: "ticketstub.finance-usage-projection/1", billable_attempt_id: row.attempt.billable_attempt_id,
        transport_attempt_id: row.transport_id, target_binding_sha256: row.binding.targetBindingSha256,
        creative: { provider: observation.provider_name, model: observation.model, source_observation_id: observation.source_observation_id },
        finance: { provider: observation.provider_name, model: row.attempt.provider.name === "openrouter" ? required(entry.usage_profile?.mapping.finance_model_compatibility_id) : observation.model,
          source_observation_id: row.finance_observation_id },
        ...(row.attempt.provider.name === "openrouter" ? { owner_mapping: entry.usage_profile.mapping,
          owner_mapping_ref: entry.usage_profile.ref, owner_mapping_sha256: entry.usage_profile.sha256,
          source_authority_ref: entry.usage_profile.source_authority_ref } : {}) };
      if (row.identity_projection && !same(row.identity_projection, identity)) required(false);
      row.identity_projection ??= identity;
      row.identity_projection_ref ??= versioned("CreativeFinanceUsageProjection", row.finance_observation_id, identity);
      row.usage_request ??= { schemaVersion: "1.0.0", requestId: randomUUID(), idempotencyKey: `${observation.source_observation_id}:usage`, scope: row.scope,
        usageEvent: { ...common(row, "UsageEvent"), usage_event_id: randomUUID(), source_observation_id: row.finance_observation_id,
          logical_operation_id: row.attempt.logical_operation_id, provider_attempt_id: row.attempt.billable_attempt_id,
          billable_attempt_id: row.attempt.billable_attempt_id, transport_attempt_id: row.transport_id, provider_request_id: null,
          provider: observation.provider_name, model: row.attempt.provider.name === "openrouter" ? required(entry.usage_profile?.mapping.finance_model_compatibility_id) : observation.model, source: "provider_response",
          source_refs: [{ kind: "source_observation", id: observation.source_observation_id, content_hash: canonicalHash(observation) },
            { kind: "manifest", id: row.identity_projection_ref.id, content_hash: row.identity_projection_ref.content_hash }],
          completeness: observation.completeness === "partial" ? "incomplete" : observation.completeness,
          // CI's pinned privacy vocabulary excludes redundant total_tokens.
          // Input/output are disjoint counters; preserve totals/details in
          // CE's private receipt rather than bypassing that intake policy.
          usage_units: (observation.usage_units ?? []).filter((unit) => ["input_tokens", "output_tokens"].includes(unit.name))
            .map((unit) => ({ name: unit.name, quantity: unit.quantity, relation: "standalone", scale: decimalScale(unit.quantity) })),
          missing_fields: observation.missing_fields.length ? ["all"] : [],
          valuation: amount && rate ? { basis: "estimated", money: money(amount), rate_card_ref: rate } : { basis: "unknown", money: null, rate_card_ref: null },
          outcome: "unknown", retry_mapping_ref: row.source_ref, supersedes_observation_id: null, reconciliation_ref: null },
        evidenceMode: environment === "production" ? "live" : "sandbox", verificationStatus: "verified", evidenceProvenanceRef: entry.finance_service.evidence_ref };
      if (row.usage_request.usageEvent.source_observation_id !== row.finance_observation_id || row.observation && row.observation.source_observation_id !== observation.source_observation_id) required(false);
      row.observation = observation;
      if (amount && rate && observation.completeness === "complete") row.quoted_observation = { ...observation,
        valuation: { basis: "estimated", amount, currency: "USD", rate_card_ref: entry.usage_profile.ref } };
      if (row.attempt.provider.name === "typesafe" && observation.completeness === "complete" && entry.decision_pricing && !row.pricing_result) {
        row.pricing_request ??= { schemaVersion: "2.0.0", requestId: randomUUID(), idempotencyKey: `${observation.source_observation_id}:price`, scope: row.scope,
          usageEvent: row.usage_request.usageEvent, selection: { policy: "event_time", effectiveAt: row.usage_request.usageEvent.occurred_at,
            product: entry.decision_pricing.product, requestedCurrency: "USD", rateCardRef: entry.decision_pricing.rate_card_ref,
            fxRateRef: null, contractTimeEvidenceRef: null, contextTier: null, serviceTier: null, reasoningMode: null, toolClass: null, dimensionsEvidenceRef: null } };
        save(row);
        const priced = await estimateV2(row.pricing_request, { ...ports, actionAuthority: {
          async authorize(input) {
            const current = await fresh();
            if (input.action !== "estimate" || !scopeMatches(input.scope, current) || !current.finance_service.operations.includes("pricing.estimateV2") || !current.decision_pricing) return null;
            return { allowed: true, decisionId: current.decision_pricing.source_authority_ref.id, action: input.action, scope: input.scope,
              actorId: input.scope.actorId, issuedAt: timestamp(), expiresAt: new Date(Math.min(now() + 60_000, Date.parse(current.decision_pricing.expires_at))).toISOString() };
          },
        } });
        if (priced.ok && priced.value.status === "complete" && priced.value.currency === "USD" && priced.value.knownSubtotal !== null) {
          row.pricing_result = priced.value;
          // Explicit host compatibility projection: this is a receipt of the
          // genuine schema2 quote, never a renamed schema2 RateCard.
          const receiptRef = versioned("PricingEstimateReceipt", priced.value.requestId, priced.value);
          row.usage_request.usageEvent.valuation = { basis: "estimated", money: money(priced.value.knownSubtotal), rate_card_ref: receiptRef };
          row.quoted_observation = { ...observation, valuation: { basis: "estimated", amount: priced.value.knownSubtotal, currency: "USD", rate_card_ref: entry.decision_pricing.source_authority_ref.id } };
        }
      }
      save(row);
      const intake = await ingestUsage(row.usage_request, { ...ports, providerSource: { isAvailable: async () => true } });
      if (!intake.ok) { row.authority_error = { code: intake.error.code, operation: intake.error.operation, safe_message: intake.error.safe_message }; save(row); }
      const receipt = resultValue(intake);
      row.intake_status = { status: receipt.status, ...(receipt.quarantineCode ? { quarantine_code: receipt.quarantineCode } : {}) }; save(row);
      if (!receipt.durableCommit || !["accepted", "duplicate"].includes(receipt.status) || receipt.billableAttemptId?.id !== row.attempt.billable_attempt_id || receipt.sourceObservationId?.id !== row.finance_observation_id) required(false);
      return { status: receipt.status, source_observation_id: observation.source_observation_id, effective_billable_attempt_id: row.attempt.billable_attempt_id };
    },
    async settleReservation(input) {
      const row = loadByReservation(input);
      const observation = row.quoted_observation ?? row.observation;
      if (!observation || observation.source_observation_id !== input.source_observation_id || observation.completeness !== "complete" || observation.valuation?.basis !== "estimated" || !observation.valuation.amount) {
        return { status: "held_for_reconciliation", reservation_id: row.reservation_id };
      }
      if (!row.identity_projection || canonicalHash(row.identity_projection) !== row.identity_projection_ref?.content_hash ||
          row.identity_projection.creative.source_observation_id !== observation.source_observation_id ||
          row.identity_projection.creative.provider !== row.attempt.provider.name || row.identity_projection.creative.model !== row.attempt.provider.model ||
          row.identity_projection.finance.source_observation_id !== row.usage_request?.usageEvent.source_observation_id ||
          row.identity_projection.finance.provider !== row.usage_request?.usageEvent.provider || row.identity_projection.finance.model !== row.usage_request?.usageEvent.model ||
          row.identity_projection.target_binding_sha256 !== row.binding.targetBindingSha256 ||
          row.attempt.provider.name === "openrouter" && (!row.reported_cost_receipt || canonicalHash(row.reported_cost_receipt) !== row.reported_cost_receipt_sha256 ||
            row.reported_cost_receipt.target_binding_sha256 !== row.binding.targetBindingSha256 || row.reported_cost_receipt.source_observation_id !== observation.source_observation_id ||
            row.reported_cost_receipt.transport_attempt_id !== row.transport_id || row.reported_cost_receipt.amount !== observation.valuation.amount)) {
        return { status: "held_for_reconciliation", reservation_id: row.reservation_id };
      }
      const usageRef = versioned("UsageEvent", row.usage_request.usageEvent.usage_event_id, row.usage_request.usageEvent);
      const consumed = observation.valuation.amount;
      const expectedRevision = (await snapshot(row)).expectedRevision;
      row.settle_command ??= { ...commandBase(row, expectedRevision, "settle"), action: "settle",
        canonicalCommand: { ...common(row, "SettleRequest"), request_id: randomUUID(), idempotency_key: `${row.attempt.billable_attempt_id}:settle`,
          budget_scope_id: row.attempt.budget_scope_id, logical_operation_id: row.attempt.logical_operation_id, billable_attempt_id: row.attempt.billable_attempt_id,
          currency: "USD", policy_ref: row.reserve_request.canonicalRequest.policy_ref, reservation_id: row.reservation_id,
          expected_revision: expectedRevision, consumed: money(consumed), usage_ref: usageRef },
        settlement: { measure: "cumulative", finality: "final", sequence: 1, cumulativeAmount: consumed, currency: "USD", usageCompleteness: "complete",
          sourceObservationRefs: [usageRef], allowObservedOverrun: true } };
      save(row); await register(row.settle_command, row, row.source_ref);
      const settled = resultValue(await settleReservation(row.settle_command, ports));
      if (!["applied", "replayed"].includes(settled.status)) required(false);
      // Budget consumption is an observed estimate. This never reconciles a
      // provider invoice or upgrades provider_reported_unsettled to confirmed.
      const unused = difference(row.held_amount, consumed);
      row.state = "settled"; row.budget_consumed_amount = consumed; save(row);
      return { status: "settled", reservation_id: row.reservation_id, consumed_amount: { amount: consumed, currency: "USD" },
        released_unused_amount: { amount: "0", currency: "USD" }, posting_refs: [], unused_held_amount: unused };
    },
    async releaseBeforeDispatch(input) {
      const row = loadByReservation(input);
      const expectedRevision = (await snapshot(row)).expectedRevision;
      row.release_command ??= { ...commandBase(row, expectedRevision, "release"), action: "release",
        canonicalCommand: { ...common(row, "ReleaseRequest"), request_id: randomUUID(), idempotency_key: `${row.attempt.billable_attempt_id}:release`,
          budget_scope_id: row.attempt.budget_scope_id, logical_operation_id: row.attempt.logical_operation_id, billable_attempt_id: row.attempt.billable_attempt_id,
          currency: "USD", policy_ref: row.reserve_request.canonicalRequest.policy_ref, reservation_id: row.reservation_id,
          expected_revision: expectedRevision, reason: "unused" },
        release: { amount: row.held_amount, currency: "USD", reason: "cancelled before provider transport", proof: "never_dispatched_fenced", evidenceRefs: [row.source_ref] } };
      save(row); await register(row.release_command, row, row.source_ref);
      const released = resultValue(await releaseReservation(row.release_command, ports));
      if (!["applied", "replayed"].includes(released.status)) required(false);
      row.state = "released"; save(row); return { status: "released" };
    },
    async markOutcomeUnknown(input) { const row = loadByReservation(input); row.state = "held_for_reconciliation"; row.unknown_reason = String(input.reason).slice(0, 80); save(row); return { status: "held_for_reconciliation" }; },
  };
  return {
    metering,
    bindDispatchIntent(input, answer) {
      if (answer?.status !== "authorized" || !input.billable_attempt_id) return;
      const row = load(input.billable_attempt_id);
      if (!row || row.reservation_id !== input.reservation_ref || row.transport_id !== input.transport_attempt_id) required(false);
      const bound = versioned("CreativeDispatchIntent", row.transport_id, { dispatch_intent_ref: answer.dispatch_intent_ref, target: row.binding.targetBindingSha256 });
      if (row.dispatch_ref && !same(row.dispatch_ref, bound)) required(false);
      row.dispatch_ref = bound; row.dispatch_intent_ref = answer.dispatch_intent_ref; save(row);
    },
    authorizationPort: {
      async revalidate(input) {
        const entry = await fresh(); const row = required(load(input.billable_attempt_id));
        if (row.reservation_id !== input.reservation_ref || row.binding.targetBindingSha256 !== input.target_binding_sha256 || row.dispatch_intent_ref !== input.dispatch_intent_ref) required(false);
        const value = resultValue(await revalidateReservation({ schemaVersion: "1.0.0", requestId: randomUUID(), scope: row.scope,
          reservationId: row.reservation_id, attemptBinding: row.attempt_binding, authorityBinding: row.binding, phase: input.phase,
          ...(input.phase === "post_transport_ack" ? { dispatchIntentRef: row.dispatch_ref, transportAttemptId: row.transport_id } : {}) }, ports));
        if (value.status !== "authorized" || !value.finance) required(false);
        const access = row.attempt.provider.name === "openrouter" ? entry.image_access : {
          service: "typesafe", model_id: entry.decision_access.model, grant_ref: entry.decision_access.grantRef, account_ref: entry.decision_access.accountRef,
          project_ref: entry.decision_access.projectRef, expires_at: entry.decision_access.expiresAt, evidence_ref: entry.decision_access.evidenceRef, evidence_sha256: entry.decision_access.evidenceSha256 };
        return { status: "authorized", revoked: false, finance: value.finance,
          grant: { service: access.service, grant_ref: access.grant_ref, account_ref: access.account_ref, project_ref: access.project_ref,
            tenant_id: entry.tenant_id, project_id: entry.project_id, target_binding_sha256: input.target_binding_sha256, operation: input.operation,
            model: access.model_id, permission: "allowed", revoked: false, expires_at: access.expires_at, evidence_ref: access.evidence_ref, evidence_sha256: access.evidence_sha256 } };
      },
    },
    async revalidateDecision(input) {
      const row = required(load(input.billable_attempt_id));
      if (row.attempt.provider.name !== "typesafe" || row.reservation_id !== input.reservation_ref || row.binding.targetBindingSha256 !== input.target_binding_sha256) required(false);
      await fresh();
      const value = resultValue(await revalidateReservation({ schemaVersion: "1.0.0", requestId: randomUUID(), scope: row.scope,
        reservationId: row.reservation_id, attemptBinding: row.attempt_binding, authorityBinding: row.binding,
        phase: row.state === "dispatched" ? "post_transport_ack" : "preparation",
        ...(row.state === "dispatched" ? { dispatchIntentRef: row.dispatch_ref, transportAttemptId: row.transport_id } : {}) }, ports));
      if (value.status !== "authorized" || !value.finance) required(false);
    },
    usageProfileAuthority: {
      async mapProviderUsage(input) {
        const entry = await fresh(); const profile = entry.usage_profile; const raw = input.rawUsage;
        if (input.attempt.provider.name === "typesafe") {
          const row = required(load(input.attempt.billable_attempt_id));
          if (!entry.decision_access || !entry.decision_pricing || row.binding.targetBindingSha256 !== input.targetBindingSha256 ||
              row.reservation_id !== input.reservationRef || row.transport_id !== input.transportAttemptId || canonicalHash(raw) !== input.rawUsageSha256) return { status: "unknown" };
          const observation = createUsageObservation({ attempt: input.attempt, trustedScope: input.trustedScope, usage: raw,
            profile: USAGE_PROFILE.TYPESAFE_DECISION, sourceObservationId: input.sourceObservationId, source: "provider_response", transportAttemptId: input.transportAttemptId });
          if (observation.completeness !== "complete") return { status: "unknown" };
          return { status: "mapped", profile_ref: USAGE_PROFILE.TYPESAFE_DECISION, profile_sha256: canonicalHash({ profile: USAGE_PROFILE.TYPESAFE_DECISION,
            source_authority_ref: entry.decision_pricing.source_authority_ref }), raw_usage_sha256: input.rawUsageSha256, target_binding_sha256: input.targetBindingSha256,
            attempt_binding_sha256: input.attemptBindingSha256, observation };
        }
        if (!profile || input.attempt.provider.name !== "openrouter" || input.attempt.provider.model !== profile.mapping.model_id ||
            canonicalHash(raw) !== input.rawUsageSha256 || !raw || raw.completeness !== "unknown" ||
            JSON.stringify(raw.missing_fields) !== JSON.stringify(["usage.profile_mapping_pending"]) ||
            ![raw.input_tokens, raw.output_tokens, raw.total_tokens].every((v) => Number.isSafeInteger(v) && v >= 0) || raw.input_tokens + raw.output_tokens !== raw.total_tokens ||
            raw.cost?.provenance !== "provider_reported_unsettled" || raw.cost.currency !== "USD" || !/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(raw.cost.amount)) return { status: "unknown" };
        const row = required(load(input.attempt.billable_attempt_id));
        if (row.binding.targetBindingSha256 !== input.targetBindingSha256 || row.reservation_id !== input.reservationRef || row.transport_id !== input.transportAttemptId || row.dispatch_intent_ref !== input.dispatchIntentRef) return { status: "unknown" };
        const observation = { schema_version: "creative.metering.proposal/v1", tenant_id: input.attempt.tenant_id, project_id: input.attempt.project_id,
          budget_scope_id: input.attempt.budget_scope_id, logical_operation_id: input.attempt.logical_operation_id, billable_attempt_id: input.attempt.billable_attempt_id,
          source_observation_id: input.sourceObservationId, source: "provider_response", provider_name: "openrouter", model: input.attempt.provider.model,
          transport_attempt_id: input.transportAttemptId, environment, billing_mode: "live", completeness: "complete", missing_fields: [],
          usage_units: [{ name: "input_tokens", quantity: String(raw.input_tokens), relation: "included_subset", included_in: "total_tokens" },
            { name: "output_tokens", quantity: String(raw.output_tokens), relation: "included_subset", included_in: "total_tokens" },
            { name: "total_tokens", quantity: String(raw.total_tokens), relation: "standalone" }] };
        const receipt = { source_observation_id: input.sourceObservationId, transport_attempt_id: input.transportAttemptId,
          target_binding_sha256: input.targetBindingSha256, attempt_binding_sha256: input.attemptBindingSha256,
          raw_usage_sha256: input.rawUsageSha256, profile_ref: profile.ref, profile_sha256: profile.sha256,
          amount: raw.cost.amount, currency: "USD", provenance: "provider_reported_unsettled" };
        if (row.reported_cost_receipt && !same(row.reported_cost_receipt, receipt)) return { status: "unknown" };
        row.reported_cost_receipt = receipt; row.reported_cost_receipt_sha256 = canonicalHash(receipt); save(row);
        return { status: "mapped", profile_ref: profile.ref, profile_sha256: profile.sha256,
          raw_usage_sha256: input.rawUsageSha256, target_binding_sha256: input.targetBindingSha256, attempt_binding_sha256: input.attemptBindingSha256, observation };
      },
    },
  };
}
