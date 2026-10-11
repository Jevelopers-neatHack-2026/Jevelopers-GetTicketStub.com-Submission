import { createHash } from "node:crypto";
import { writeSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [baselineRoot, databasePath, objectRoot, historicalConceptV1Root, historicalConceptV2Root] = process.argv.slice(2);
if (!baselineRoot || !databasePath || !objectRoot || !historicalConceptV1Root || !historicalConceptV2Root) {
  process.stderr.write("The pinned schema-10 producer needs the extracted schema-10 and historical concept sources, database, and object directory.\n");
  process.exit(87);
}

const importFromBaseline = (path) => import(pathToFileURL(join(baselineRoot, path)).href);
const importFromRoot = (root, path) => import(pathToFileURL(join(root, path)).href);
const [{ CreativeVersionStore }, { createCreativeVersionApiPorts }, { canonicalHash }, helpers, conceptDomain,
  conceptFixture, telemetry, planning, { fixtureAttempt }] = await Promise.all([
  importFromBaseline("src/versions/store.mjs"),
  importFromBaseline("src/versions/api-ports.mjs"),
  importFromBaseline("src/contracts/index.mjs"),
  importFromBaseline("tests/versions/helpers.mjs"),
  importFromBaseline("src/generation/concepts.mjs"),
  importFromBaseline("fixtures/generation/concept-proposal.mjs"),
  importFromBaseline("src/telemetry/index.mjs"),
  importFromBaseline("src/planning/index.mjs"),
  importFromBaseline("fixtures/metering/attempt.mjs"),
]);

const NOW = Date.parse("2026-10-11T12:30:00.000Z");
const actor = "pinned-schema10-fixture-actor";
const { DEFAULT_SCOPE, createBrief, createWrite } = helpers;
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
let id = 0;
const store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
const ports = createCreativeVersionApiPorts({ store, now: () => NOW, leaseDurationMs: 600_000,
  idFactory: () => `schema10-generated-${++id}` });

async function main() {
  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  store.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const aInput = createWrite({ scope, id: "schema10-history-A", action_id: "schema10-action-A",
    job_id: "schema10-job-A", actor_id: actor, bytes: Buffer.from("schema10 artifact A exact bytes") });
  const a = await store.saveDesignVersion(aInput);
  const bInput = createWrite({ scope, id: "schema10-history-B", parent: a.design_version,
    selection: { mode: "branch" }, action_id: "schema10-action-B", job_id: "schema10-job-B", actor_id: actor,
    bytes: Buffer.from("schema10 artifact B exact bytes") });
  const b = await store.saveDesignVersion(bInput);
  const cInput = createWrite({ scope, id: "schema10-history-C", parent: a.design_version,
    selection: { mode: "branch" }, action_id: "schema10-action-C", job_id: "schema10-job-C", actor_id: actor,
    bytes: Buffer.from("schema10 artifact C exact bytes") });
  const c = await store.saveDesignVersion(cInput);
  if ([a.status, b.status, c.status].some((status) => status !== "saved")) throw new Error("schema10 version fixture did not commit");

  async function stagePrivateAttribution(actionId, leavePending) {
    const operation = "generate";
    const requestHash = hash(`schema10-request:${actionId}`);
    const started = await ports.jobs.begin({ scope, actor_id: actor, action_id: actionId,
      request_hash: requestHash, operation });
    if (started.kind !== "started") throw new Error("schema10 dispatch fixture job did not start");
    const billable = `schema10-billable:${actionId}`;
    const transport = `schema10-transport:${actionId}`;
    const reservation = `schema10-reservation:${actionId}`;
    const contextFence = { brief_id: scope.brief_id, brief_hash: canonicalHash(brief),
      expected_current_design_version_id: a.design_version.design_version_id,
      expected_current_design_hash: a.design_version.design_hash };
    const dispatch = await ports.jobs.authorizeDispatch({ scope, actor_id: actor, job_id: started.job_id,
      lease_token: started.lease_token, action_id: actionId, operation, billable_attempt_id: billable,
      reservation_ref: reservation, provider_name: "openai", provider_model: "schema10-fixture-model",
      transport_attempt_id: transport, context_fence: contextFence });
    if (dispatch.status !== "authorized") throw new Error("schema10 private dispatch intent was not recorded");
    const providerRequestId = `fixture-only:${actionId}`;
    const providerRequestRef = `provider-request-${createHash("sha256").update(providerRequestId).digest("hex")}`;
    const result = await ports.jobs.stagePrivateProviderAttribution({ scope, actor_id: actor, job_id: started.job_id,
      action_id: actionId, request_hash: requestHash, operation, provider: "openai", model: "schema10-fixture-model",
      reservation_ref: reservation, billable_attempt_id: billable, transport_attempt_id: transport,
      dispatch_intent_ref: dispatch.dispatch_intent_ref, target_binding_sha256: hash(`target:${actionId}`),
      provider_request_id: providerRequestId, provider_request_ref: providerRequestRef,
      usage: { completeness: "unknown", missing_fields: ["usage.profile_mapping_pending"],
        transport_attempt_id: transport, provider_request_id: providerRequestRef } });
    if (result.status !== "staged") throw new Error("schema10 private attribution was not staged");
    if (!leavePending) {
      const reconciled = await ports.jobs.reconcilePrivateProviderAttributions({
        scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, limit: 1 });
      if (reconciled.reconciled !== 1) throw new Error("schema10 private attribution did not reconcile");
    }
    return { started, requestHash, dispatch, result };
  }

  const reconciledAttribution = await stagePrivateAttribution("schema10-reconciled-attribution", false);
  const pendingAttribution = await stagePrivateAttribution("schema10-pending-attribution", true);

  const telemetryScope = { tenant_id: scope.tenant_id, project_id: scope.project_id,
    budget_scope_id: "schema10-fixture-budget" };
  const attempt = fixtureAttempt({ ...telemetryScope, logical_operation_id: "schema10-fixture-logical",
    billable_attempt_id: "schema10-fixture-observation-attempt", operation_kind: "image_generation",
    budget: { scope_id: telemetryScope.budget_scope_id, policy_version: "schema10-fixture-policy" },
    provider: { name: "openai", model: "schema10-fixture-model", endpoint: "test:/fixture-only",
      sdk: { name: "fixture", version: "1" } } });
  const outbox = telemetry.createSqliteTelemetryOutbox({ database: store.db, clock: () => NOW,
    idFactory: () => "schema10-fixture-outbox-event" });
  const evidence = telemetry.createTelemetryEvidence({ eventId: "schema10-fixture-event", type: "attempt_intent",
    attempt, trustedScope: telemetryScope,
    modes: { provider_execution_mode: "mock", commerce_mode: "simulated" },
    occurredAt: new Date(NOW).toISOString() });
  await outbox.append(evidence);
  const observation = telemetry.createUsageObservation({ attempt, trustedScope: telemetryScope,
    profile: telemetry.USAGE_PROFILE.NORMALIZED, sourceObservationId: "schema10-fixture-source-observation",
    providerRequestId: "schema10-fixture-provider-request", transportAttemptId: "schema10-fixture-transport",
    usage: { input_tokens: 2, output_tokens: 1 } });
  await outbox.enqueueUsageObservation({ attempt, trustedScope: telemetryScope, observation });

  const historicalV1 = await Promise.all([
    importFromRoot(historicalConceptV1Root, "src/generation/concepts.mjs"),
    importFromRoot(historicalConceptV1Root, "fixtures/generation/concept-proposal.mjs"),
  ]);
  const historicalV2 = await Promise.all([
    importFromRoot(historicalConceptV2Root, "src/generation/concepts.mjs"),
    importFromRoot(historicalConceptV2Root, "fixtures/generation/concept-proposal.mjs"),
  ]);
  const conceptSources = new Map([
    ["0.1.0", { domain: historicalV1[0], fixture: historicalV1[1] }],
    ["0.2.0", { domain: historicalV2[0], fixture: historicalV2[1] }],
    ["0.3.0", { domain: conceptDomain, fixture: conceptFixture }],
  ]);
  for (const schemaVersion of ["0.1.0", "0.2.0", "0.3.0"]) {
    const actionId = `schema10-concept-${schemaVersion.replaceAll(".", "-")}`;
    const source = conceptSources.get(schemaVersion);
    const conceptInput = source.fixture.conceptProposalInput();
    conceptInput.request = { ...conceptInput.request, action_id: actionId };
    const conceptScope = conceptInput.trusted_scope;
    store.putBrief({ scope: { tenant_id: conceptScope.tenant_id, project_id: conceptScope.project_id },
      brief: conceptInput.brief });
    const batch = source.domain.createCreativeConceptBatchProposal(conceptInput);
    if (batch.schema_version !== schemaVersion) {
      throw new Error(`The historical ${schemaVersion} constructor emitted ${batch.schema_version}`);
    }
    if (source.domain.replayCreativeConceptBatch(batch, { trusted_scope: conceptInput.trusted_scope,
      request: conceptInput.request }).status !== "replayed") {
      throw new Error(`The historical ${schemaVersion} proposal did not replay under its own contract`);
    }
    const slot = batch.slots[0];
    const cancelEvent = { tenant_id: batch.tenant_id, project_id: batch.project_id,
      action_id: batch.action_id, batch_id: batch.batch_id, concept_id: slot.concept_id,
      event_id: `schema10-event:${schemaVersion}`, event_type: "cancel_concept",
      cancellation_evidence_ref: `fixture-cancellation-proof:${schemaVersion}` };
    const historicalApply = source.domain.applyCreativeConceptEvent(batch, cancelEvent);
    if (historicalApply.status !== "applied" || historicalApply.batch.slots[0].status !== "cancelled" ||
        historicalApply.batch.schema_version !== schemaVersion) {
      throw new Error(`The historical ${schemaVersion} reducer did not apply its valid cancellation`);
    }
    const started = await ports.jobs.begin({ scope: conceptScope, actor_id: actor, action_id: actionId,
      request_hash: batch.request_sha256, operation: "concepts.create" });
    if (started.kind !== "started") throw new Error(`schema10 ${schemaVersion} concept job did not start`);
    store.beginConceptBatch({ scope: conceptScope, actor_id: actor, job_id: started.job_id,
      lease_token: started.lease_token, action_id: actionId, request_hash: batch.request_sha256, batch });
    await store.appendConceptEvent({ scope: conceptScope, actor_id: actor, job_id: started.job_id,
      lease_token: started.lease_token, action_id: actionId, request_hash: batch.request_sha256, event: cancelEvent });
  }

  // Exercise the schema-10 CE02 boundary on its actual shared connection.
  // One invalidation completes both external acknowledgment receipts; a
  // second retains its asset fence and pending application acknowledgment.
  // Keep the paired revoked-asset fence exercise in a distinct, valid scope so
  // it cannot stale the main brief used by the pinned commit-intent recovery.
  const invalidationScope = { tenant_id: scope.tenant_id, project_id: "schema10-invalidation-project",
    brief_id: "schema10-invalidation-brief" };
  const invalidationBrief = createBrief(invalidationScope);
  const planningStore = planning.createCreativeBriefStore({ database: store.db,
    trustedScope: { tenant_id: invalidationScope.tenant_id, project_id: invalidationScope.project_id } });
  planningStore.appendBriefVersion({ brief: invalidationBrief, brief_hash: canonicalHash(invalidationBrief),
    created_at: invalidationBrief.occurred_at });
  const invalidationClock = { now: () => new Date(NOW).toISOString() };
  const makeAssetRevocation = (eventId, sourceRevision, assetId) => ({
    event_id: eventId,
    tenant_id: invalidationScope.tenant_id,
    project_id: invalidationScope.project_id,
    source_package_id: invalidationBrief.research_package_ref.package_id,
    source_package_hash: invalidationBrief.research_package_ref.content_hash,
    source_revision: sourceRevision,
    occurred_at: new Date(NOW).toISOString(),
    kind: "asset",
    reason: "asset_permission_revoked",
    assets: [{ asset_id: assetId, content_hash: hash(Buffer.from(`${eventId}:revoked-by-fixture`)) }],
    affected_briefs: [{ brief_id: invalidationBrief.brief_id, brief_hash: canonicalHash(invalidationBrief) }],
  });
  const verifyInvalidation = async ({ event }) => ({ status: "verified", classification: "synthetic_test",
    evidence_ref: "schema10-fixture-invalidation-proof", event_hash: event.content_hash,
    event_id: event.event_id, tenant_id: event.tenant_id, project_id: event.project_id,
    verified_at: invalidationClock.now(), valid_until: new Date(NOW + 300_000).toISOString() });
  const acknowledged = await planning.applyResearchInvalidation({
    trusted_scope: { tenant_id: invalidationScope.tenant_id, project_id: invalidationScope.project_id },
    event: makeAssetRevocation("schema10-asset-revocation-acknowledged", 2, "schema10-asset-acknowledged"),
    ports: { clock: invalidationClock, store: planningStore, verifier: { verifyInvalidation },
      approvalStaleness: { async markBriefStale(request) { return { status: "acknowledged",
        request_id: request.request_id, brief_id: request.brief_id, brief_hash: request.brief_hash,
        event_id: request.event_id, tenant_id: request.tenant_id, project_id: request.project_id }; } },
      producerAcknowledgment: { async acknowledgeInvalidation(request) { return { status: "acknowledged",
        event_id: request.event_id, idempotency_key: request.idempotency_key,
        event_hash: request.event_hash, tenant_id: request.tenant_id, project_id: request.project_id }; } },
    },
  });
  if (acknowledged.approval_staleness.status !== "acknowledged" ||
      acknowledged.producer_acknowledgment?.status !== "acknowledged") {
    throw new Error("schema10 acknowledged invalidation did not persist exact owner callback receipts");
  }
  const pending = await planning.applyResearchInvalidation({
    trusted_scope: { tenant_id: invalidationScope.tenant_id, project_id: invalidationScope.project_id },
    event: makeAssetRevocation("schema10-asset-revocation-pending", 3, "schema10-asset-pending"),
    ports: { clock: invalidationClock, store: planningStore, verifier: { verifyInvalidation } },
  });
  if (pending.approval_staleness.status !== "pending" || pending.producer_acknowledgment !== null) {
    throw new Error("schema10 pending invalidation did not retain its pending approval and producer fences");
  }
  planningStore.close();

  const inspectAction = "schema10-inspection-action";
  const inspectHash = hash(`schema10-inspect:${inspectAction}`);
  const inspectJob = await ports.jobs.begin({ scope, actor_id: actor, action_id: inspectAction,
    request_hash: inspectHash, operation: "inspect" });
  if (inspectJob.kind !== "started") throw new Error("schema10 inspection job did not start");
  const inspectionIdentity = { scope, brief_id: scope.brief_id, actor_id: actor, job_id: inspectJob.job_id,
    lease_token: inspectJob.lease_token, action_id: inspectAction, request_hash: inspectHash,
    brief_hash: a.design_version.brief_hash, design_version_id: a.design_version.design_version_id,
    design_hash: a.design_version.design_hash, parent_version_id: null, parent_design_hash: null,
    artifact_id: a.design_version.artifact.artifact_id, artifact_hash: a.design_version.artifact.content_hash,
    root_design_version_id: a.design_version.design_version_id, root_design_hash: a.design_version.design_hash };
  await ports.storage.beginInspectionSession(inspectionIdentity);
  const observerIntent = { contract: "Schema10FixtureInspectionIntent", schema_version: "1.0",
    stage: "observer", design_hash: a.design_version.design_hash };
  await ports.storage.stageInspectionStage({ ...inspectionIdentity, stage: "observer",
    attempt_id: "schema10-inspection-observer-attempt", intent: observerIntent });
  await ports.storage.completeInspectionStage({ ...inspectionIdentity, stage: "observer",
    attempt_id: "schema10-inspection-observer-attempt",
    result: { status: "fixture_completed", report_hash: hash("schema10-inspection-observer-report") } });
  await ports.storage.stageInspectionStage({ ...inspectionIdentity, stage: "decision_evidence",
    attempt_id: "schema10-inspection-pending-attempt",
    intent: { contract: "Schema10FixtureInspectionIntent", schema_version: "1.0",
      stage: "decision_evidence", design_hash: a.design_version.design_hash } });

  const intentWrite = createWrite({ scope, id: "schema10-existing-commit-intent", parent: a.design_version,
    selection: { mode: "branch" }, action_id: "schema10-existing-commit-intent-action",
    job_id: "schema10-existing-commit-intent-job", actor_id: actor,
    bytes: Buffer.from("schema10 commit-intent exact staged artifact") });
  const replayInput = { scope: intentWrite.scope, brief_id: intentWrite.brief_id, actor_id: intentWrite.actor_id,
    brief_snapshot: intentWrite.brief_snapshot, design_version: intentWrite.design_version,
    artifact_bytes_base64: Buffer.from(intentWrite.artifact_bytes).toString("base64"),
    selection: intentWrite.selection, creation: intentWrite.creation,
    configuration_snapshot: intentWrite.configuration_snapshot };
  writeSync(1, `PINNED_SCHEMA10_REPLAY_INPUT ${JSON.stringify(replayInput)}\n`);
  await store.saveDesignVersion(intentWrite, { faultInjector(point) {
    if (point === "after_commit_intent") {
      writeSync(1, "PINNED_SCHEMA10_COMMIT_INTENT_DURABLE\n");
      process.exit(86);
    }
  } });
  throw new Error("schema10 producer completed without the required commit-intent process cut");
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 89;
});
