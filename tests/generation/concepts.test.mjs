import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { computeDesignVersionHash } from "../../src/contracts/creative/v1.mjs";
import { canonicalHash } from "../../src/contracts/validation.mjs";
import { METERING_PROPOSAL_VERSION } from "../../src/contracts/metering.mjs";
import { hashArtifactBytes } from "../../src/storage/content-addressed.mjs";
import {
  CREATIVE_CONCEPT_PROPOSAL,
  applyCreativeConceptEvent,
  createCreativeConceptBatchProposal,
  inspectCreativeConceptImageBytes,
  inspectCreativeConceptReferenceBytes,
  replayCreativeConceptBatch,
} from "../../src/generation/concepts.mjs";
import {
  FIXTURE_NOW,
  conceptProposalInput,
  conceptReferenceBytes,
} from "../../fixtures/generation/concept-proposal.mjs";
import { corruptPngCrc } from "../../fixtures/models/png.mjs";

const HASH = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
let eventSequence = 0;

function expectCode(code, callback) {
  assert.throws(callback, (error) => {
    assert.equal(error?.code, code, `expected ${code}, received ${error?.code ?? error?.name ?? "unknown error"}`);
    return true;
  });
}

function makeAttempt(batch, slot, suffix) {
  return {
    schema_version: METERING_PROPOSAL_VERSION,
    logical_operation_id: slot.logical_operation_id,
    billable_attempt_id: `billable-${slot.ordinal}-${suffix}`,
    retry_mapping_ref: "fixture-explicit-retry-mapping",
    environment: "test",
    billing_mode: "simulated",
    operation_kind: batch.adapter_snapshot.operation_kind,
    tenant_id: batch.tenant_id,
    project_id: batch.project_id,
    budget_scope_id: batch.policy_snapshot.budget_scope_id,
    budget: {
      scope_id: batch.policy_snapshot.budget_scope_id,
      policy_version: batch.policy_snapshot.policy_version,
    },
    provider: {
      name: batch.adapter_snapshot.provider_name,
      model: batch.adapter_snapshot.model,
      endpoint: batch.adapter_snapshot.endpoint,
      sdk: { name: batch.adapter_snapshot.sdk_name, version: batch.adapter_snapshot.sdk_version },
    },
  };
}

function event(batch, slot, eventType, fields = {}) {
  eventSequence += 1;
  return {
    tenant_id: batch.tenant_id,
    project_id: batch.project_id,
    action_id: batch.action_id,
    batch_id: batch.batch_id,
    concept_id: slot.concept_id,
    event_id: `fixture-event-${eventSequence}`,
    event_type: eventType,
    ...fields,
  };
}

function reserve(batch, slot, suffix) {
  const meteredAttempt = makeAttempt(batch, slot, suffix);
  const reservation = {
    status: "reserved",
    reservation_id: `reservation-${slot.ordinal}-${suffix}`,
    billable_attempt_id: meteredAttempt.billable_attempt_id,
    held_amount: { amount: "0.01", currency: "USD" },
    lease_id: `lease-${slot.ordinal}-${suffix}`,
  };
  const reserveEvent = event(batch, slot, "reserve_attempt", {
    billable_attempt_id: meteredAttempt.billable_attempt_id,
    transport_attempt_id: `transport-${slot.ordinal}-${suffix}`,
    metered_attempt: meteredAttempt,
    reservation,
  });
  return {
    reserveEvent,
    batch: applyCreativeConceptEvent(batch, reserveEvent).batch,
    billableAttemptId: meteredAttempt.billable_attempt_id,
    transportAttemptId: `transport-${slot.ordinal}-${suffix}`,
    reservationRef: reservation.reservation_id,
  };
}

function dispatch(batch, slot, identities) {
  const dispatchEvent = event(batch, slot, "dispatch_started", {
    billable_attempt_id: identities.billableAttemptId,
    transport_attempt_id: identities.transportAttemptId,
    dispatch_intent_ref: `dispatch-${identities.billableAttemptId}`,
    provider_target_binding_sha256: `sha256:${"d".repeat(64)}`,
    rendered_prompt_sha256: `sha256:${"e".repeat(64)}`,
  });
  return { event: dispatchEvent, batch: applyCreativeConceptEvent(batch, dispatchEvent).batch };
}

function providerOutcome(batch, slot, identities, outcome, artifactBytes, overrides = {}) {
  const fields = {
    billable_attempt_id: identities.billableAttemptId,
    transport_attempt_id: identities.transportAttemptId,
    outcome,
    outcome_evidence_ref: `provider-outcome-${identities.billableAttemptId}`,
    provider_request_id: `provider-request-${identities.billableAttemptId}`,
    ...(artifactBytes ? { artifact_sha256: hashArtifactBytes(artifactBytes) } : {}),
    usage_evidence_ref: `usage-observation-${identities.billableAttemptId}`,
    usage_completeness: "complete",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) if (value === undefined) delete fields[key];
  const outcomeEvent = event(batch, slot, "provider_outcome", fields);
  return { event: outcomeEvent, batch: applyCreativeConceptEvent(batch, outcomeEvent).batch };
}

function staged(batch, slot, identities, artifactBytes) {
  return inspectCreativeConceptImageBytes({
    bytes: artifactBytes,
    expected_media_type: "image/png",
    maximum_bytes: batch.policy_snapshot.maximum_single_reference_bytes,
  }).then((metadata) => {
    const stageEvent = event(batch, slot, "candidate_staged", {
      billable_attempt_id: identities.billableAttemptId,
      transport_attempt_id: identities.transportAttemptId,
      artifact_sha256: metadata.content_sha256,
      media_type: metadata.media_type,
      width: metadata.width,
      height: metadata.height,
      storage_stage_ref: `fixture-storage-stage-${identities.billableAttemptId}`,
      inspection_evidence_ref: `fixture-native-inspection-${identities.billableAttemptId}`,
    });
    return { event: stageEvent, batch: applyCreativeConceptEvent(batch, stageEvent).batch, metadata };
  });
}

function versionFor(batch, slot, metadata, suffix) {
  const version = {
    contract: "DesignVersion",
    schema_version: "1.0",
    event_id: `version-event-${suffix}`,
    tenant_id: batch.tenant_id,
    project_id: batch.project_id,
    correlation_id: `version-correlation-${suffix}`,
    producer: "synthetic-concept-fixture",
    occurred_at: FIXTURE_NOW,
    ingested_at: FIXTURE_NOW,
    environment: "test",
    billing_mode: "simulated",
    source_refs: [...new Set(batch.references.map((reference) => reference.source_ref))],
    design_version_id: `design-version-${suffix}`,
    parent_version_id: null,
    brief_hash: batch.brief_sha256,
    artifact: {
      artifact_id: `artifact-${suffix}`,
      content_hash: metadata.content_sha256,
      media_type: metadata.media_type,
    },
  };
  version.design_hash = computeDesignVersionHash(version);
  return version;
}

async function commitSyntheticCandidate(batch, slot, identities, bytes, suffix) {
  const output = providerOutcome(batch, slot, identities, "succeeded", bytes);
  const stagedResult = await staged(output.batch, slot, identities, bytes);
  const publishEvent = event(stagedResult.batch, slot, "candidate_published", {
    billable_attempt_id: identities.billableAttemptId,
    transport_attempt_id: identities.transportAttemptId,
    design_version: versionFor(stagedResult.batch, slot, stagedResult.metadata, suffix),
    storage_commit_ref: `fixture-storage-commit-${suffix}`,
    lineage_evidence_ref: `fixture-lineage-${suffix}`,
  });
  return {
    batch: applyCreativeConceptEvent(stagedResult.batch, publishEvent).batch,
    providerEvent: output.event,
    stageEvent: stagedResult.event,
    publishEvent,
  };
}

async function prepareCandidatePublication(batch, slotIndex, bytes, suffix) {
  const slot = batch.slots[slotIndex];
  const identities = reserve(batch, slot, suffix);
  const dispatched = dispatch(identities.batch, identities.batch.slots[slotIndex], identities);
  const response = providerOutcome(dispatched.batch, dispatched.batch.slots[slotIndex], identities, "succeeded", bytes);
  const stagedResult = await staged(response.batch, response.batch.slots[slotIndex], identities, bytes);
  return { ...stagedResult, identities, slotIndex };
}

function candidatePublication(prepared, designVersion, suffix) {
  const slot = prepared.batch.slots[prepared.slotIndex];
  return event(prepared.batch, slot, "candidate_published", {
    billable_attempt_id: prepared.identities.billableAttemptId,
    transport_attempt_id: prepared.identities.transportAttemptId,
    design_version: designVersion,
    storage_commit_ref: `fixture-storage-commit-${suffix}`,
    lineage_evidence_ref: `fixture-lineage-${suffix}`,
  });
}

async function prepareAttemptIdentityEvent(eventType) {
  eventSequence = 0;
  let batch = createCreativeConceptBatchProposal(conceptProposalInput());
  let slot = batch.slots[0];
  if (eventType === "reserve_attempt") {
    return { batch, event: reserve(batch, slot, "identity-reserve").reserveEvent };
  }

  const identities = reserve(batch, slot, `identity-${eventType}`);
  batch = identities.batch;
  slot = batch.slots[0];
  if (eventType === "dispatch_started") {
    return { batch, event: dispatch(batch, slot, identities).event };
  }

  const dispatched = dispatch(batch, slot, identities);
  batch = dispatched.batch;
  slot = batch.slots[0];
  const bytes = conceptReferenceBytes()[0];
  if (eventType === "provider_outcome") {
    return { batch, event: providerOutcome(batch, slot, identities, "succeeded", bytes).event };
  }
  if (eventType === "artifact_rejected") {
    batch = providerOutcome(batch, slot, identities, "succeeded", bytes).batch;
    slot = batch.slots[0];
    return { batch, event: event(batch, slot, eventType, {
      billable_attempt_id: identities.billableAttemptId,
      transport_attempt_id: identities.transportAttemptId,
      artifact_sha256: hashArtifactBytes(bytes),
      failure_code: "identity-test-artifact-rejected",
      inspection_evidence_ref: "identity-test-inspection",
    }) };
  }
  if (eventType === "reconcile_unknown_attempt") {
    batch = providerOutcome(batch, slot, identities, "unknown", null, {
      usage_completeness: "unknown",
      artifact_sha256: undefined,
    }).batch;
    slot = batch.slots[0];
    return { batch, event: event(batch, slot, eventType, {
      billable_attempt_id: identities.billableAttemptId,
      transport_attempt_id: identities.transportAttemptId,
      outcome: "succeeded",
      outcome_evidence_ref: "identity-test-late-outcome",
      provider_request_id: "identity-test-late-provider-request",
      artifact_sha256: hashArtifactBytes(bytes),
      usage_evidence_ref: "identity-test-late-usage",
      usage_completeness: "complete",
    }) };
  }
  if (eventType === "late_provider_evidence") {
    const cancellation = event(batch, slot, "cancel_concept", {
      billable_attempt_id: identities.billableAttemptId,
      transport_attempt_id: identities.transportAttemptId,
      cancellation_evidence_ref: "identity-test-cancel",
    });
    batch = applyCreativeConceptEvent(batch, cancellation).batch;
    slot = batch.slots[0];
    return { batch, event: event(batch, slot, eventType, {
      billable_attempt_id: identities.billableAttemptId,
      transport_attempt_id: identities.transportAttemptId,
      outcome: "succeeded",
      outcome_evidence_ref: "identity-test-late-outcome",
      provider_request_id: "identity-test-late-provider-request",
      artifact_sha256: hashArtifactBytes(bytes),
      usage_evidence_ref: "identity-test-late-usage",
      usage_completeness: "unknown",
    }) };
  }

  const response = providerOutcome(batch, slot, identities, "succeeded", bytes);
  const stage = await staged(response.batch, response.batch.slots[0], identities, bytes);
  if (eventType === "candidate_staged") return { batch: response.batch, event: stage.event };
  if (eventType === "reconcile_staged_metadata") {
    return { batch: stage.batch, event: event(stage.batch, stage.batch.slots[0], eventType, {
      billable_attempt_id: identities.billableAttemptId,
      transport_attempt_id: identities.transportAttemptId,
      artifact_sha256: hashArtifactBytes(bytes),
      metadata_evidence_ref: "identity-test-metadata",
    }) };
  }
  if (eventType === "candidate_published") {
    return { batch: stage.batch, event: event(stage.batch, stage.batch.slots[0], eventType, {
      billable_attempt_id: identities.billableAttemptId,
      transport_attempt_id: identities.transportAttemptId,
      design_version: versionFor(stage.batch, stage.batch.slots[0], stage.metadata, "identity-test"),
      storage_commit_ref: "identity-test-commit",
      lineage_evidence_ref: "identity-test-lineage",
    }) };
  }
  throw new Error(`unhandled identity test event ${eventType}`);
}

test("proposal creates ordered independent parentless slots from two scoped authorized assets", async () => {
  eventSequence = 0;
  const input = conceptProposalInput();
  const batch = createCreativeConceptBatchProposal(input);
  assert.equal(batch.acceptance_status, "unaccepted_local_proposal");
  assert.equal(batch.contract, CREATIVE_CONCEPT_PROPOSAL.contract);
  assert.equal(batch.requested_count, 2);
  assert.equal(batch.slots.length, 2);
  assert.equal(batch.references.length, 2);
  assert.deepEqual(batch.slots.map((slot) => slot.ordinal), [1, 2]);
  assert.notEqual(batch.slots[0].concept_id, batch.slots[1].concept_id);
  assert.notEqual(batch.slots[0].logical_operation_id, batch.slots[1].logical_operation_id);
  assert.equal(batch.slots.every((slot) => slot.parent_version_id === null && slot.status === "pending"), true);
  assert.equal(Object.isFrozen(batch.slots), true);
  assert.equal(batch.references[0].permission_evidence_ref, "fixture-permission-evidence-1");
  assert.equal(batch.adapter_snapshot.endpoint, "https://api.openai.com/v1/images/edits");
  assert.equal(batch.adapter_snapshot.prompt_template_ref, input.adapter_snapshot.prompt_template_ref);

  const bytes = conceptReferenceBytes();
  const resolved = await inspectCreativeConceptReferenceBytes(batch, batch.references.map((reference, index) => ({
    asset_id: reference.asset_id,
    bytes: bytes[index],
  })));
  assert.equal(resolved.references.length, 2);
  assert.equal(resolved.aggregate_byte_length, bytes[0].byteLength + bytes[1].byteLength);
  assert.deepEqual(resolved.references.map((reference) => reference.content_sha256), batch.references.map((reference) => reference.content_hash));
  assert.equal("bytes" in resolved.references[0], false);

  let current = batch;
  const identities = [];
  for (const [index, originalSlot] of batch.slots.entries()) {
    const slot = current.slots[index];
    const reserved = reserve(current, slot, `first-${index}`);
    identities.push(reserved);
    current = reserved.batch;
    current = dispatch(current, current.slots[index], reserved).batch;
    const outcome = providerOutcome(current, current.slots[index], reserved, "succeeded", bytes[index]);
    current = outcome.batch;
    const stageResult = await staged(current, current.slots[index], reserved, bytes[index]);
    current = stageResult.batch;
    assert.equal(current.slots[index].status, "staged");
    assert.equal(current.slots[index].output_lineage, null, "staged bytes are still invisible before the commit event");
    const publishEvent = event(current, current.slots[index], "candidate_published", {
      billable_attempt_id: reserved.billableAttemptId,
      transport_attempt_id: reserved.transportAttemptId,
      design_version: versionFor(current, current.slots[index], stageResult.metadata, `case1-${index}`),
      storage_commit_ref: `fixture-storage-commit-case1-${index}`,
      lineage_evidence_ref: `fixture-lineage-case1-${index}`,
    });
    current = applyCreativeConceptEvent(current, publishEvent).batch;
  }
  assert.equal(current.slots.every((slot) => slot.status === "succeeded"), true);
  assert.equal(current.slots.every((slot) => slot.output_lineage.parent_version_id === null), true);
  assert.equal(current.slots.every((slot) => slot.output_lineage.configuration_sha256 === input.adapter_snapshot.configuration_sha256), true);
  assert.equal(current.slots.every((slot) => slot.output_lineage.prompt_template_sha256 === input.adapter_snapshot.prompt_template_sha256), true);
  assert.equal(current.slots.every((slot) => slot.output_lineage.usage_evidence_refs.length === 1), true);
  assert.equal(current.slots.every((slot) => slot.attempts.length === 1), true);
  assert.deepEqual(identities.map((identity) => identity.billableAttemptId), ["billable-1-first-0", "billable-2-first-1"]);
});

test("invalid count, stale scope, revoked rights, and expired policy reject before a C03 attempt exists", () => {
  expectCode("invalid_integer", () => createCreativeConceptBatchProposal(conceptProposalInput({
    request: { ...conceptProposalInput().request, requested_count: 0 },
  })));
  const excess = conceptProposalInput();
  excess.policy_snapshot.maximum_concept_count = 1;
  expectCode("policy_limit_exceeded", () => createCreativeConceptBatchProposal(excess));

  const staleBrief = conceptProposalInput();
  staleBrief.brief_sha256 = `sha256:${"0".repeat(64)}`;
  expectCode("brief_hash_mismatch", () => createCreativeConceptBatchProposal(staleBrief));

  const revoked = conceptProposalInput();
  revoked.permission_evidence[0].status = "denied";
  expectCode("reference_permission_denied", () => createCreativeConceptBatchProposal(revoked));

  const crossScope = conceptProposalInput();
  crossScope.permission_evidence[1].project_id = "another-project";
  expectCode("reference_permission_scope_mismatch", () => createCreativeConceptBatchProposal(crossScope));

  const noRights = conceptProposalInput();
  noRights.permission_evidence = [];
  expectCode("reference_permission_missing", () => createCreativeConceptBatchProposal(noRights));

  const stalePermission = conceptProposalInput();
  stalePermission.permission_evidence[0].expires_at = FIXTURE_NOW;
  expectCode("reference_permission_expired", () => createCreativeConceptBatchProposal(stalePermission));

  const expiredBudget = conceptProposalInput();
  expiredBudget.policy_snapshot.budget_expires_at = FIXTURE_NOW;
  expectCode("policy_snapshot_expired", () => createCreativeConceptBatchProposal(expiredBudget));

  const expiredCountPolicy = conceptProposalInput();
  expiredCountPolicy.policy_snapshot.expires_at = FIXTURE_NOW;
  expectCode("policy_snapshot_expired", () => createCreativeConceptBatchProposal(expiredCountPolicy));
});

test("returned normalized policy retains the validated tenant, project, and brief scope", () => {
  const batch = createCreativeConceptBatchProposal(conceptProposalInput());
  assert.deepEqual({
    tenant_id: batch.policy_snapshot.tenant_id,
    project_id: batch.policy_snapshot.project_id,
    brief_id: batch.policy_snapshot.brief_id,
  }, {
    tenant_id: batch.tenant_id,
    project_id: batch.project_id,
    brief_id: batch.brief_id,
  });
  assert.equal(batch.policy_snapshot.tenant_id.toUpperCase(), batch.tenant_id.toUpperCase());
  assert.equal(batch.policy_snapshot.project_id.toUpperCase(), batch.project_id.toUpperCase());
  assert.equal(batch.policy_snapshot.brief_id.toUpperCase(), batch.brief_id.toUpperCase());
});

test("native codec and content hash reject invalid outputs and retain exact read-only byte snapshots", async () => {
  const [valid, second] = conceptReferenceBytes();
  const snapshot = Buffer.from(valid);
  const pending = inspectCreativeConceptImageBytes({ bytes: valid, expected_media_type: "image/png", maximum_bytes: 1_000_000 });
  valid.fill(0);
  const inspected = await pending;
  assert.equal(inspected.content_sha256, hashArtifactBytes(snapshot));
  assert.deepEqual([inspected.width, inspected.height], [16, 16]);

  await assert.rejects(inspectCreativeConceptImageBytes({ bytes: new Uint8Array(), expected_media_type: "image/png", maximum_bytes: 100 }),
    (error) => error?.code === "image_bytes_out_of_bounds");
  await assert.rejects(inspectCreativeConceptImageBytes({ bytes: corruptPngCrc(second), expected_media_type: "image/png", maximum_bytes: 1_000_000 }),
    (error) => error?.code === "image_inspection_failed");
  await assert.rejects(inspectCreativeConceptImageBytes({ bytes: second, expected_media_type: "image/jpeg", maximum_bytes: 1_000_000 }),
    (error) => error?.code === "image_media_type_mismatch");
  await assert.rejects(inspectCreativeConceptImageBytes({
    bytes: second,
    expected_media_type: "image/png",
    maximum_bytes: 1_000_000,
    expected_dimensions: { width: 16, height: 16 },
  }), (error) => error?.code === "image_dimensions_mismatch");

  const batch = createCreativeConceptBatchProposal(conceptProposalInput({
    policy_snapshot: { ...conceptProposalInput().policy_snapshot, maximum_aggregate_reference_bytes: 1 },
  }));
  const [ref1, ref2] = conceptReferenceBytes();
  await assert.rejects(inspectCreativeConceptReferenceBytes(batch, batch.references.map((reference, index) => ({
    asset_id: reference.asset_id,
    bytes: [ref1, ref2][index],
  }))), (error) => error?.code === "reference_bytes_out_of_bounds");
});

test("rejected provider bytes retain attempt and usage evidence without staging or publication", async () => {
  eventSequence = 0;
  const batch = createCreativeConceptBatchProposal(conceptProposalInput());
  const slot = batch.slots[0];
  const invalidBytes = corruptPngCrc(conceptReferenceBytes()[0]);
  const identities = reserve(batch, slot, "invalid-artifact");
  let current = dispatch(identities.batch, identities.batch.slots[0], identities).batch;
  current = providerOutcome(current, current.slots[0], identities, "succeeded", invalidBytes).batch;

  let inspectionFailure;
  try {
    await inspectCreativeConceptImageBytes({
      bytes: invalidBytes,
      expected_media_type: "image/png",
      maximum_bytes: current.policy_snapshot.maximum_single_reference_bytes,
    });
  } catch (error) {
    inspectionFailure = error;
  }
  assert.equal(inspectionFailure?.code, "image_inspection_failed");

  const rejected = event(current, current.slots[0], "artifact_rejected", {
    billable_attempt_id: identities.billableAttemptId,
    transport_attempt_id: identities.transportAttemptId,
    artifact_sha256: hashArtifactBytes(invalidBytes),
    failure_code: inspectionFailure.code,
    inspection_evidence_ref: "native-codec-rejected-provider-bytes",
  });
  current = applyCreativeConceptEvent(current, rejected).batch;
  const failedSlot = current.slots[0];
  const failedAttempt = failedSlot.attempts[0];
  assert.equal(failedSlot.status, "failed");
  assert.equal(failedSlot.output_lineage, null);
  assert.equal(failedAttempt.status, "failed_artifact");
  assert.equal(failedAttempt.staged_artifact, undefined);
  assert.deepEqual(failedAttempt.artifact_validation_failure, {
    artifact_sha256: hashArtifactBytes(invalidBytes),
    failure_code: "image_inspection_failed",
    inspection_evidence_ref: "native-codec-rejected-provider-bytes",
  });
  assert.equal(failedAttempt.provider_observations[0].outcome, "succeeded");
  assert.equal(failedAttempt.provider_observations[0].artifact_sha256, hashArtifactBytes(invalidBytes));
  assert.deepEqual(failedAttempt.usage_evidence_refs, [`usage-observation-${identities.billableAttemptId}`]);
  assert.equal(failedAttempt.unknown_financial_exposure, false);

  const retry = reserve(current, failedSlot, "invalid-artifact-retry");
  assert.notEqual(retry.billableAttemptId, identities.billableAttemptId);
  assert.equal(retry.batch.slots[0].attempts.length, 2);
  assert.equal(retry.batch.slots[0].attempts[0].artifact_validation_failure.failure_code, "image_inspection_failed");
});

test("staged media must match the explicit adapter output format", () => {
  eventSequence = 0;
  const batch = createCreativeConceptBatchProposal(conceptProposalInput());
  const slot = batch.slots[0];
  const bytes = conceptReferenceBytes()[0];
  const identities = reserve(batch, slot, "output-format");
  let current = dispatch(identities.batch, identities.batch.slots[0], identities).batch;
  current = providerOutcome(current, current.slots[0], identities, "succeeded", bytes).batch;
  expectCode("adapter_output_format_mismatch", () => applyCreativeConceptEvent(current, event(current, current.slots[0], "candidate_staged", {
    billable_attempt_id: identities.billableAttemptId,
    transport_attempt_id: identities.transportAttemptId,
    artifact_sha256: hashArtifactBytes(bytes),
    media_type: "image/jpeg",
    width: 16,
    height: 16,
    storage_stage_ref: "must-not-stage-wrong-format",
    inspection_evidence_ref: "wrong-format-inspection",
  })));
});

test("published DesignVersion identities are slot-unique and artifact identities retain exact bytes", async () => {
  eventSequence = 0;
  const [firstBytes, secondBytes] = conceptReferenceBytes();
  const firstPrepared = await prepareCandidatePublication(createCreativeConceptBatchProposal(conceptProposalInput()), 0, firstBytes, "f5-first");
  const firstVersion = versionFor(firstPrepared.batch, firstPrepared.batch.slots[0], firstPrepared.metadata, "f5-first");
  firstVersion.design_version_id = "design-version-f5-shared";
  firstVersion.artifact.artifact_id = "artifact-f5-first";
  firstVersion.design_hash = computeDesignVersionHash(firstVersion);
  const firstEvent = candidatePublication(firstPrepared, firstVersion, "f5-first");
  const first = applyCreativeConceptEvent(firstPrepared.batch, firstEvent).batch;
  assert.equal(first.slots[0].status, "succeeded");
  assert.equal(first.slots[0].output_lineage.artifact_id, "artifact-f5-first");
  assert.equal(applyCreativeConceptEvent(first, firstEvent).status, "duplicate", "the original exact publication remains an idempotent replay");

  const duplicateIdPrepared = await prepareCandidatePublication(first, 1, secondBytes, "f5-duplicate-id");
  const duplicateIdVersion = versionFor(duplicateIdPrepared.batch, duplicateIdPrepared.batch.slots[1], duplicateIdPrepared.metadata, "f5-duplicate-id");
  duplicateIdVersion.design_version_id = firstVersion.design_version_id;
  duplicateIdVersion.design_hash = computeDesignVersionHash(duplicateIdVersion);
  const duplicateIdEvent = candidatePublication(duplicateIdPrepared, duplicateIdVersion, "f5-duplicate-id");
  const duplicateIdInputHash = canonicalHash(duplicateIdPrepared.batch);
  expectCode("design_version_identity_reused", () => applyCreativeConceptEvent(duplicateIdPrepared.batch, duplicateIdEvent));
  assert.equal(canonicalHash(duplicateIdPrepared.batch), duplicateIdInputHash);
  assert.equal(duplicateIdPrepared.batch.events.some((item) => item.event_id === duplicateIdEvent.event_id), false);
  assert.equal(duplicateIdPrepared.batch.slots[0].status, "succeeded");
  assert.equal(duplicateIdPrepared.batch.slots[1].status, "staged");

  const compatibleFirstPrepared = await prepareCandidatePublication(createCreativeConceptBatchProposal(conceptProposalInput()), 0, firstBytes, "f5-compatible-first");
  const compatibleFirstVersion = versionFor(compatibleFirstPrepared.batch, compatibleFirstPrepared.batch.slots[0], compatibleFirstPrepared.metadata, "f5-compatible-first");
  compatibleFirstVersion.artifact.artifact_id = "artifact-f5-shared-content";
  compatibleFirstVersion.design_hash = computeDesignVersionHash(compatibleFirstVersion);
  const compatibleFirst = applyCreativeConceptEvent(
    compatibleFirstPrepared.batch,
    candidatePublication(compatibleFirstPrepared, compatibleFirstVersion, "f5-compatible-first"),
  ).batch;
  const compatibleSecondPrepared = await prepareCandidatePublication(compatibleFirst, 1, firstBytes, "f5-compatible-second");
  const compatibleSecondVersion = versionFor(compatibleSecondPrepared.batch, compatibleSecondPrepared.batch.slots[1], compatibleSecondPrepared.metadata, "f5-compatible-second");
  compatibleSecondVersion.artifact.artifact_id = compatibleFirstVersion.artifact.artifact_id;
  compatibleSecondVersion.design_hash = computeDesignVersionHash(compatibleSecondVersion);
  const compatibleSecondEvent = candidatePublication(compatibleSecondPrepared, compatibleSecondVersion, "f5-compatible-second");
  const compatible = applyCreativeConceptEvent(compatibleSecondPrepared.batch, compatibleSecondEvent).batch;
  assert.equal(compatible.slots[0].status, "succeeded");
  assert.equal(compatible.slots[1].status, "succeeded");
  assert.notEqual(compatible.slots[0].output_lineage.design_version_id, compatible.slots[1].output_lineage.design_version_id);
  assert.equal(compatible.slots[0].output_lineage.artifact_id, compatible.slots[1].output_lineage.artifact_id);
  assert.equal(compatible.slots[0].output_lineage.artifact_sha256, compatible.slots[1].output_lineage.artifact_sha256);
  assert.equal(applyCreativeConceptEvent(compatible, compatibleSecondEvent).status, "duplicate");

  const conflictFirstPrepared = await prepareCandidatePublication(createCreativeConceptBatchProposal(conceptProposalInput()), 0, firstBytes, "f5-artifact-first");
  const conflictFirstVersion = versionFor(conflictFirstPrepared.batch, conflictFirstPrepared.batch.slots[0], conflictFirstPrepared.metadata, "f5-artifact-first");
  conflictFirstVersion.artifact.artifact_id = "artifact-f5-reused-with-different-bytes";
  conflictFirstVersion.design_hash = computeDesignVersionHash(conflictFirstVersion);
  const conflictFirst = applyCreativeConceptEvent(
    conflictFirstPrepared.batch,
    candidatePublication(conflictFirstPrepared, conflictFirstVersion, "f5-artifact-first"),
  ).batch;
  const conflictSecondPrepared = await prepareCandidatePublication(conflictFirst, 1, secondBytes, "f5-artifact-second");
  const conflictSecondVersion = versionFor(conflictSecondPrepared.batch, conflictSecondPrepared.batch.slots[1], conflictSecondPrepared.metadata, "f5-artifact-second");
  conflictSecondVersion.artifact.artifact_id = conflictFirstVersion.artifact.artifact_id;
  conflictSecondVersion.design_hash = computeDesignVersionHash(conflictSecondVersion);
  const conflictSecondEvent = candidatePublication(conflictSecondPrepared, conflictSecondVersion, "f5-artifact-second");
  const artifactConflictInputHash = canonicalHash(conflictSecondPrepared.batch);
  expectCode("artifact_identity_conflict", () => applyCreativeConceptEvent(conflictSecondPrepared.batch, conflictSecondEvent));
  assert.equal(canonicalHash(conflictSecondPrepared.batch), artifactConflictInputHash);
  assert.equal(conflictSecondPrepared.batch.events.some((item) => item.event_id === conflictSecondEvent.event_id), false);
  assert.equal(conflictSecondPrepared.batch.slots[1].status, "staged");
});

test("optional DesignVersion attempt fields bind when supplied and remain compatible when omitted", async () => {
  eventSequence = 0;
  const bytes = conceptReferenceBytes()[0];
  const prepared = await prepareCandidatePublication(createCreativeConceptBatchProposal(conceptProposalInput()), 0, bytes, "f6-identities");
  const attempt = prepared.batch.slots[0].attempts[0];
  const matchingVersion = {
    ...versionFor(prepared.batch, prepared.batch.slots[0], prepared.metadata, "f6-matching"),
    logical_operation_id: prepared.batch.slots[0].logical_operation_id,
    billable_attempt_id: attempt.billable_attempt_id,
    transport_attempt_id: attempt.transport_attempt_id,
    provider_request_id: attempt.latest_provider_request_id,
  };
  matchingVersion.design_hash = computeDesignVersionHash(matchingVersion);
  const matchingEvent = candidatePublication(prepared, matchingVersion, "f6-matching");
  const applied = applyCreativeConceptEvent(prepared.batch, matchingEvent);
  assert.equal(applied.batch.slots[0].status, "succeeded");
  assert.equal(applyCreativeConceptEvent(applied.batch, matchingEvent).status, "duplicate");

  const originalInputHash = canonicalHash(prepared.batch);
  for (const field of ["logical_operation_id", "billable_attempt_id", "transport_attempt_id", "provider_request_id"]) {
    const mismatchedVersion = { ...matchingVersion, [field]: `another-${field}` };
    mismatchedVersion.design_hash = computeDesignVersionHash(mismatchedVersion);
    const versionHash = canonicalHash(mismatchedVersion);
    const mismatchedEvent = candidatePublication(prepared, mismatchedVersion, `f6-mismatch-${field}`);
    expectCode("design_version_attempt_identity_mismatch", () => applyCreativeConceptEvent(prepared.batch, mismatchedEvent));
    assert.equal(canonicalHash(mismatchedVersion), versionHash, `${field} mismatch rejection does not mutate the supplied version`);
    assert.equal(canonicalHash(prepared.batch), originalInputHash, `${field} mismatch rejection leaves the batch unchanged`);
    assert.equal(prepared.batch.events.some((item) => item.event_id === mismatchedEvent.event_id), false);
  }

  const omittedPrepared = await prepareCandidatePublication(createCreativeConceptBatchProposal(conceptProposalInput()), 0, bytes, "f6-omitted");
  const omittedVersion = versionFor(omittedPrepared.batch, omittedPrepared.batch.slots[0], omittedPrepared.metadata, "f6-omitted");
  for (const field of ["logical_operation_id", "billable_attempt_id", "transport_attempt_id", "provider_request_id"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(omittedVersion, field), false);
  }
  const omittedEvent = candidatePublication(omittedPrepared, omittedVersion, "f6-omitted");
  const omittedApplied = applyCreativeConceptEvent(omittedPrepared.batch, omittedEvent);
  assert.equal(omittedApplied.batch.slots[0].status, "succeeded");
  assert.equal(applyCreativeConceptEvent(omittedApplied.batch, omittedEvent).status, "duplicate");
});

test("adapter operation kinds match the declared MeteredOperationKind values at construction", () => {
  const supportedKinds = [
    "image_generation",
    "image_edit",
    "responses_orchestration",
    "planning",
    "vision_observation",
    "jev_decision",
    "baseline_evaluation",
  ];
  for (const operationKind of supportedKinds) {
    const input = conceptProposalInput();
    input.adapter_snapshot.operation_kind = operationKind;
    assert.equal(createCreativeConceptBatchProposal(input).adapter_snapshot.operation_kind, operationKind);
  }

  const unsupported = conceptProposalInput();
  unsupported.adapter_snapshot.operation_kind = "unrecognized-kind";
  const inputHash = canonicalHash(unsupported);
  expectCode("unsupported_operation_kind", () => createCreativeConceptBatchProposal(unsupported));
  assert.equal(canonicalHash(unsupported), inputHash, "unsupported operation kind rejection leaves the input unchanged");
});

test("same action replay compares canonical request and returns the exact stored partial state", async () => {
  eventSequence = 0;
  const input = conceptProposalInput();
  const original = createCreativeConceptBatchProposal(input);
  const first = reserve(original, original.slots[0], "replay");
  const second = dispatch(first.batch, first.batch.slots[0], first);
  const partial = providerOutcome(second.batch, second.batch.slots[0], first, "failed", null, {
    usage_completeness: "complete",
    artifact_sha256: undefined,
  }).batch;
  const replay = replayCreativeConceptBatch(partial, {
    trusted_scope: input.trusted_scope,
    request: input.request,
  });
  assert.equal(replay.status, "replayed");
  assert.equal(replay.batch, partial);
  assert.equal(replay.batch.slots[0].attempts.length, 1);
  expectCode("action_replay_conflict", () => replayCreativeConceptBatch(partial, {
    trusted_scope: input.trusted_scope,
    request: { ...input.request, requested_count: 1 },
  }));
  expectCode("replay_scope_mismatch", () => replayCreativeConceptBatch(partial, {
    trusted_scope: { ...input.trusted_scope, project_id: "different-project" },
    request: input.request,
  }));
  const changedReference = structuredClone(input.request);
  changedReference.references[0].role_ref = "different-reference-role";
  expectCode("action_replay_conflict", () => replayCreativeConceptBatch(partial, {
    trusted_scope: input.trusted_scope,
    request: changedReference,
  }));
  const extraReference = structuredClone(input.request);
  extraReference.references[0].unsupported = "synthetic-extra";
  expectCode("unsupported_field", () => replayCreativeConceptBatch(partial, {
    trusted_scope: input.trusted_scope,
    request: extraReference,
  }));
});

test("creation rejects unsupported original reference fields before normalization", () => {
  const withExtra = conceptProposalInput();
  withExtra.request.references[0].unsupported = "synthetic-extra";
  expectCode("unsupported_field", () => createCreativeConceptBatchProposal(withExtra));

  const acceptedInput = conceptProposalInput();
  const batch = createCreativeConceptBatchProposal(acceptedInput);
  const replay = replayCreativeConceptBatch(batch, {
    trusted_scope: acceptedInput.trusted_scope,
    request: acceptedInput.request,
  });
  assert.equal(replay.status, "replayed");
  assert.equal(replay.batch, batch);
});

test("all attempt transitions require complete exact identities before replay and leave input state unchanged on rejection", async () => {
  const eventTypes = [
    "dispatch_started",
    "provider_outcome",
    "candidate_staged",
    "reconcile_staged_metadata",
    "candidate_published",
    "artifact_rejected",
    "reconcile_unknown_attempt",
    "late_provider_evidence",
  ];
  for (const eventType of eventTypes) {
    const { batch, event: validEvent } = await prepareAttemptIdentityEvent(eventType);
    const applied = applyCreativeConceptEvent(batch, validEvent);
    assert.equal(applied.status, "applied", `${eventType} control applies with complete identities`);
    const replay = applyCreativeConceptEvent(applied.batch, validEvent);
    assert.equal(replay.status, "duplicate", `${eventType} exact replay remains a duplicate`);
    assert.equal(replay.batch, applied.batch);

    const originalHash = canonicalHash(batch);
    const appliedHash = canonicalHash(applied.batch);
    for (const field of ["billable_attempt_id", "transport_attempt_id"]) {
      for (const [variant, value] of [["null", null], ["empty", ""], ["wrong", `wrong-${field}-${eventType}`]]) {
        const malformed = { ...validEvent, [field]: value };
        const code = variant === "null" || variant === "empty"
          ? "invalid_value"
          : field === "transport_attempt_id" ? "attempt_identity_mismatch" : "unknown_attempt";
        expectCode(code, () => applyCreativeConceptEvent(batch, malformed));
        assert.equal(canonicalHash(batch), originalHash, `${eventType} ${field} ${variant} leaves input state unchanged`);
        expectCode(code, () => applyCreativeConceptEvent(applied.batch, malformed));
        assert.equal(canonicalHash(applied.batch), appliedHash, `${eventType} malformed replay ${field} ${variant} leaves input state unchanged`);
      }
      const omitted = { ...validEvent };
      delete omitted[field];
      expectCode("invalid_value", () => applyCreativeConceptEvent(batch, omitted));
      assert.equal(canonicalHash(batch), originalHash, `${eventType} omitted ${field} leaves input state unchanged`);
      expectCode("invalid_value", () => applyCreativeConceptEvent(applied.batch, omitted));
      assert.equal(canonicalHash(applied.batch), appliedHash, `${eventType} malformed replay omitted ${field} leaves input state unchanged`);
    }
  }
});

test("reservation and cancellation preserve the true attempt-free exception and reject incomplete attempt identities", () => {
  eventSequence = 0;
  const emptyBatch = createCreativeConceptBatchProposal(conceptProposalInput());
  const emptyCancellation = event(emptyBatch, emptyBatch.slots[0], "cancel_concept", {
    cancellation_evidence_ref: "attempt-free-cancellation",
  });
  const cancelled = applyCreativeConceptEvent(emptyBatch, emptyCancellation);
  assert.equal(cancelled.status, "applied");
  assert.equal(cancelled.batch.slots[0].status, "cancelled");
  assert.equal(applyCreativeConceptEvent(cancelled.batch, emptyCancellation).status, "duplicate");
  const emptyHash = canonicalHash(emptyBatch);
  const cancelledHash = canonicalHash(cancelled.batch);
  for (const malformed of [
    { ...emptyCancellation, billable_attempt_id: null },
    { ...emptyCancellation, billable_attempt_id: "fake-billable" },
    { ...emptyCancellation, transport_attempt_id: "fake-transport" },
    { ...emptyCancellation, billable_attempt_id: "fake-billable", transport_attempt_id: "fake-transport" },
  ]) {
    expectCode("attempt_identity_mismatch", () => applyCreativeConceptEvent(emptyBatch, malformed));
    assert.equal(canonicalHash(emptyBatch), emptyHash);
    expectCode("attempt_identity_mismatch", () => applyCreativeConceptEvent(cancelled.batch, malformed));
    assert.equal(canonicalHash(cancelled.batch), cancelledHash);
  }

  const reservationBatch = createCreativeConceptBatchProposal(conceptProposalInput());
  const reserved = reserve(reservationBatch, reservationBatch.slots[0], "identity-reserve-controls");
  const reservationBatchHash = canonicalHash(reservationBatch);
  for (const [field, value, code] of [
    ["billable_attempt_id", undefined, "invalid_value"],
    ["billable_attempt_id", null, "invalid_value"],
    ["billable_attempt_id", "", "invalid_value"],
    ["billable_attempt_id", "wrong-billable", "attempt_identity_mismatch"],
    ["transport_attempt_id", undefined, "invalid_value"],
    ["transport_attempt_id", null, "invalid_value"],
    ["transport_attempt_id", "", "invalid_value"],
  ]) {
    const malformed = { ...reserved.reserveEvent, [field]: value };
    if (value === undefined) delete malformed[field];
    expectCode(code, () => applyCreativeConceptEvent(reservationBatch, malformed));
    assert.equal(canonicalHash(reservationBatch), reservationBatchHash);
  }
  const existing = reserved.batch;
  const before = canonicalHash(existing);
  for (const [field, value, code] of [
    ["billable_attempt_id", undefined, "invalid_value"],
    ["billable_attempt_id", null, "invalid_value"],
    ["billable_attempt_id", "", "invalid_value"],
    ["billable_attempt_id", "wrong-billable", "attempt_identity_mismatch"],
    ["transport_attempt_id", undefined, "invalid_value"],
    ["transport_attempt_id", null, "invalid_value"],
    ["transport_attempt_id", "", "invalid_value"],
    ["transport_attempt_id", "wrong-transport", "attempt_identity_reused"],
  ]) {
    const malformed = { ...reserved.reserveEvent, [field]: value };
    if (value === undefined) delete malformed[field];
    expectCode(code, () => applyCreativeConceptEvent(existing, malformed));
    assert.equal(canonicalHash(existing), before);
  }
  const wrongTransport = { ...reserved.reserveEvent, event_id: "reserve-wrong-transport", transport_attempt_id: "wrong-transport" };
  expectCode("attempt_identity_reused", () => applyCreativeConceptEvent(existing, wrongTransport));
  assert.equal(canonicalHash(existing), before);

  const cancellation = event(existing, existing.slots[0], "cancel_concept", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    cancellation_evidence_ref: "attempt-bound-cancellation",
  });
  for (const [field, variant, value, code] of [
    ["billable_attempt_id", "omitted", undefined, "invalid_value"],
    ["billable_attempt_id", "null", null, "invalid_value"],
    ["billable_attempt_id", "empty", "", "invalid_value"],
    ["billable_attempt_id", "wrong", "wrong-billable", "attempt_identity_mismatch"],
    ["transport_attempt_id", "omitted", undefined, "invalid_value"],
    ["transport_attempt_id", "null", null, "invalid_value"],
    ["transport_attempt_id", "empty", "", "invalid_value"],
    ["transport_attempt_id", "wrong", "wrong-transport", "attempt_identity_mismatch"],
  ]) {
    const malformed = { ...cancellation, [field]: value };
    if (variant === "omitted") delete malformed[field];
    expectCode(code, () => applyCreativeConceptEvent(existing, malformed));
    assert.equal(canonicalHash(existing), before);
  }
  const appliedCancellation = applyCreativeConceptEvent(existing, cancellation);
  assert.equal(appliedCancellation.status, "applied");
  assert.equal(applyCreativeConceptEvent(appliedCancellation.batch, cancellation).status, "duplicate");
  const cancelledAttemptHash = canonicalHash(appliedCancellation.batch);
  for (const [field, variant, value, code] of [
    ["billable_attempt_id", "omitted", undefined, "invalid_value"],
    ["billable_attempt_id", "null", null, "invalid_value"],
    ["billable_attempt_id", "empty", "", "invalid_value"],
    ["billable_attempt_id", "wrong", "wrong-billable", "attempt_identity_mismatch"],
    ["transport_attempt_id", "omitted", undefined, "invalid_value"],
    ["transport_attempt_id", "null", null, "invalid_value"],
    ["transport_attempt_id", "empty", "", "invalid_value"],
    ["transport_attempt_id", "wrong", "wrong-transport", "attempt_identity_mismatch"],
  ]) {
    const malformed = { ...cancellation, [field]: value };
    if (variant === "omitted") delete malformed[field];
    expectCode(code, () => applyCreativeConceptEvent(appliedCancellation.batch, malformed));
    assert.equal(canonicalHash(appliedCancellation.batch), cancelledAttemptHash);
  }
});

test("stored metering evidence is deeply frozen while the upstream request remains mutable", () => {
  const batch = createCreativeConceptBatchProposal(conceptProposalInput());
  const upstream = makeAttempt(batch, batch.slots[0], "readonly-runtime-control");
  assert.equal(Object.isFrozen(upstream), false);
  assert.equal(Object.isFrozen(upstream.provider), false);
  upstream.provider.sdk.name = "mutable-upstream-input-control";
  assert.equal(upstream.provider.sdk.name, "mutable-upstream-input-control");

  const reserved = reserve(batch, batch.slots[0], "readonly-runtime-control");
  const stored = reserved.batch.slots[0].attempts[0].metering_attempt;
  assert.equal(Object.isFrozen(stored), true);
  assert.equal(Object.isFrozen(stored.provider), true);
  assert.equal(Object.isFrozen(stored.provider.sdk), true);
  assert.equal(Object.isFrozen(stored.budget), true);
  assert.throws(() => { stored.provider.model = "changed"; }, TypeError);
  assert.throws(() => { stored.provider.sdk.name = "changed"; }, TypeError);
  assert.throws(() => { stored.budget.policy_version = "changed"; }, TypeError);
});

test("known failure retries only through a distinct C03 reservation and completed slots never regenerate", async () => {
  eventSequence = 0;
  const batch = createCreativeConceptBatchProposal(conceptProposalInput());
  const [outputOne, outputTwo] = conceptReferenceBytes();
  const firstReserved = reserve(batch, batch.slots[0], "original");
  const duplicate = applyCreativeConceptEvent(firstReserved.batch, firstReserved.reserveEvent);
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.batch, firstReserved.batch);
  const collision = { ...firstReserved.reserveEvent, reservation: { ...firstReserved.reserveEvent.reservation, lease_id: "changed-lease" } };
  expectCode("event_identity_conflict", () => applyCreativeConceptEvent(firstReserved.batch, collision));

  let current = firstReserved.batch;
  current = dispatch(current, current.slots[0], firstReserved).batch;
  const failedUsageRef = `usage-observation-${firstReserved.billableAttemptId}`;
  current = providerOutcome(current, current.slots[0], firstReserved, "failed", null, {
    usage_completeness: "complete",
    retry_disposition: "eligible_retry",
    financial_exposure_status: "settled",
    financial_settlement_evidence: { status: "settled", reservation_id: firstReserved.reservationRef,
      source_observation_id: failedUsageRef, effective_billable_attempt_id: firstReserved.billableAttemptId },
  }).batch;
  const repeatedIdentity = {
    ...event(current, current.slots[0], "reserve_attempt", {}),
    billable_attempt_id: firstReserved.billableAttemptId,
    transport_attempt_id: "different-transport-for-old-billable",
    metered_attempt: makeAttempt(current, current.slots[0], "original"),
    reservation: {
      status: "reserved",
      reservation_id: "different-reservation-for-old-billable",
      billable_attempt_id: firstReserved.billableAttemptId,
      held_amount: { amount: "0.01", currency: "USD" },
      lease_id: "different-lease-for-old-billable",
    },
  };
  expectCode("attempt_identity_reused", () => applyCreativeConceptEvent(current, repeatedIdentity));
  const retry = reserve(current, current.slots[0], "retry-1");
  assert.notEqual(retry.billableAttemptId, firstReserved.billableAttemptId);
  assert.notEqual(retry.transportAttemptId, firstReserved.transportAttemptId);
  assert.notEqual(retry.reservationRef, firstReserved.reservationRef);

  current = dispatch(retry.batch, retry.batch.slots[0], retry).batch;
  const completed = await commitSyntheticCandidate(current, current.slots[0], retry, outputOne, "retry-completed");
  expectCode("terminal_state_immutable", () => applyCreativeConceptEvent(completed.batch, event(completed.batch, completed.batch.slots[0], "reserve_attempt", {
    billable_attempt_id: "billable-1-new-after-success",
    transport_attempt_id: "transport-new-after-success",
    metered_attempt: makeAttempt(completed.batch, completed.batch.slots[0], "new-after-success"),
    reservation: {
      status: "reserved", reservation_id: "reservation-new-after-success", billable_attempt_id: "billable-1-new-after-success",
      held_amount: { amount: "0.01", currency: "USD" }, lease_id: "lease-new-after-success",
    },
  })));

  let unaffected = completed.batch;
  const secondSlot = unaffected.slots[1];
  const independent = reserve(unaffected, secondSlot, "independent");
  unaffected = independent.batch;
  unaffected = dispatch(unaffected, unaffected.slots[1], independent).batch;
  unaffected = providerOutcome(unaffected, unaffected.slots[1], independent, "succeeded", outputTwo).batch;
  assert.equal(unaffected.slots[0].status, "succeeded");
  assert.equal(unaffected.slots[1].status, "response_received");
});

test("unknown attempt reconciles only on the same identity and keeps its unknown financial exposure", async () => {
  eventSequence = 0;
  const batch = createCreativeConceptBatchProposal(conceptProposalInput());
  const bytes = conceptReferenceBytes()[0];
  const reserved = reserve(batch, batch.slots[0], "unknown");
  let current = dispatch(reserved.batch, reserved.batch.slots[0], reserved).batch;
  const unknown = providerOutcome(current, current.slots[0], reserved, "unknown", null, {
    usage_completeness: "unknown",
    usage_evidence_ref: "unknown-exposure-evidence",
  });
  current = unknown.batch;
  assert.equal(current.slots[0].status, "unknown");
  expectCode("dispatch_not_allowed", () => applyCreativeConceptEvent(current, event(current, current.slots[0], "reserve_attempt", {
    billable_attempt_id: "billable-1-regenerated-after-unknown",
    transport_attempt_id: "transport-regenerated-after-unknown",
    metered_attempt: makeAttempt(current, current.slots[0], "regenerated-after-unknown"),
    reservation: {
      status: "reserved", reservation_id: "reservation-regenerated-after-unknown", billable_attempt_id: "billable-1-regenerated-after-unknown",
      held_amount: { amount: "0.01", currency: "USD" }, lease_id: "lease-regenerated-after-unknown",
    },
  })));

  const known = event(current, current.slots[0], "reconcile_unknown_attempt", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    outcome: "succeeded",
    outcome_evidence_ref: "same-attempt-late-provider-result",
    provider_request_id: "provider-request-late-known",
    artifact_sha256: hashArtifactBytes(bytes),
    usage_evidence_ref: "same-attempt-late-usage-observation",
    usage_completeness: "complete",
  });
  current = applyCreativeConceptEvent(current, known).batch;
  const attempt = current.slots[0].attempts[0];
  assert.equal(current.slots[0].status, "response_received");
  assert.deepEqual(attempt.provider_observations.map((item) => item.outcome), ["unknown", "succeeded"]);
  assert.deepEqual(attempt.usage_evidence_refs, ["unknown-exposure-evidence", "same-attempt-late-usage-observation"]);
  assert.equal(attempt.unknown_financial_exposure, true);
  assert.equal(attempt.financial_exposure_status, "unknown_hold");
  const stagedResult = await staged(current, current.slots[0], reserved, bytes);
  current = stagedResult.batch;
  const metadataEvent = event(current, current.slots[0], "reconcile_staged_metadata", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    artifact_sha256: hashArtifactBytes(bytes),
    metadata_evidence_ref: "same-bytes-metadata-reconciled",
  });
  current = applyCreativeConceptEvent(current, metadataEvent).batch;
  assert.equal(current.slots[0].attempts[0].storage_metadata_evidence_refs[0], "same-bytes-metadata-reconciled");
  const publishEvent = event(current, current.slots[0], "candidate_published", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    design_version: versionFor(current, current.slots[0], stagedResult.metadata, "unknown-reconciled"),
    storage_commit_ref: "same-attempt-reconciled-commit",
    lineage_evidence_ref: "same-attempt-reconciled-lineage",
  });
  current = applyCreativeConceptEvent(current, publishEvent).batch;
  assert.equal(current.slots[0].status, "succeeded");
  assert.equal(current.slots[0].output_lineage.unknown_financial_exposure, true);
  assert.equal(current.slots[0].output_lineage.usage_evidence_refs.includes("unknown-exposure-evidence"), true);
});

test("a settled complete-usage acknowledgement clears only the financial hold while preserving unknown provider output", () => {
  eventSequence = 0;
  const batch = createCreativeConceptBatchProposal(conceptProposalInput());
  const reserved = reserve(batch, batch.slots[0], "settled-unknown-output");
  const dispatching = dispatch(reserved.batch, reserved.batch.slots[0], reserved).batch;
  const before = canonicalHash(dispatching);
  const unsupportedClear = event(dispatching, dispatching.slots[0], "provider_outcome", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    outcome: "unknown",
    outcome_evidence_ref: "settled-unknown-incomplete",
    provider_request_id: "provider-settled-unknown-incomplete",
    usage_evidence_ref: "usage-settled-unknown-incomplete",
    usage_completeness: "unknown",
    financial_exposure_status: "settled",
    financial_settlement_evidence: { status: "settled", reservation_id: reserved.reservationRef,
      source_observation_id: "usage-settled-unknown-incomplete",
      effective_billable_attempt_id: reserved.billableAttemptId },
  });
  expectCode("invalid_financial_exposure_status", () => applyCreativeConceptEvent(dispatching, unsupportedClear));
  assert.equal(canonicalHash(dispatching), before);

  const mismatchedSettlement = event(dispatching, dispatching.slots[0], "provider_outcome", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    outcome: "unknown",
    outcome_evidence_ref: "settled-unknown-mismatched",
    provider_request_id: "provider-settled-unknown-mismatched",
    usage_evidence_ref: "usage-settled-unknown-mismatched",
    usage_completeness: "complete",
    financial_exposure_status: "settled",
    financial_settlement_evidence: { status: "settled", reservation_id: "foreign-reservation",
      source_observation_id: "usage-settled-unknown-mismatched",
      effective_billable_attempt_id: reserved.billableAttemptId },
  });
  expectCode("invalid_financial_exposure_status", () => applyCreativeConceptEvent(dispatching, mismatchedSettlement));
  assert.equal(canonicalHash(dispatching), before);

  for (const [eventName, name, evidence] of [
    ["observation", "observation", { status: "settled", reservation_id: reserved.reservationRef,
      source_observation_id: "foreign-usage-observation", effective_billable_attempt_id: reserved.billableAttemptId }],
    ["effective-billable", "effective billable attempt", { status: "settled", reservation_id: reserved.reservationRef,
      source_observation_id: "usage-settled-effective-billable", effective_billable_attempt_id: "foreign-billable-attempt" }],
  ]) {
    const mismatch = event(dispatching, dispatching.slots[0], "provider_outcome", {
      billable_attempt_id: reserved.billableAttemptId,
      transport_attempt_id: reserved.transportAttemptId,
      outcome: "unknown",
      outcome_evidence_ref: `settled-unknown-mismatched-${name}`,
      provider_request_id: `provider-settled-unknown-mismatched-${name}`,
      usage_evidence_ref: `usage-settled-${eventName}`,
      usage_completeness: "complete",
      financial_exposure_status: "settled",
      financial_settlement_evidence: evidence,
    });
    expectCode("invalid_financial_exposure_status", () => applyCreativeConceptEvent(dispatching, mismatch));
    assert.equal(canonicalHash(dispatching), before);
  }

  const settled = event(dispatching, dispatching.slots[0], "provider_outcome", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    outcome: "unknown",
    outcome_evidence_ref: "settled-unknown-valid",
    provider_request_id: "provider-settled-unknown-valid",
    usage_evidence_ref: "usage-settled-unknown-valid",
    usage_completeness: "complete",
    financial_exposure_status: "settled",
    financial_settlement_evidence: { status: "settled", reservation_id: reserved.reservationRef,
      source_observation_id: "usage-settled-unknown-valid",
      effective_billable_attempt_id: reserved.billableAttemptId },
  });
  const settledBatch = applyCreativeConceptEvent(dispatching, settled).batch;
  const attempt = settledBatch.slots[0].attempts[0];
  assert.equal(settledBatch.slots[0].status, "unknown");
  assert.equal(attempt.latest_provider_outcome, "unknown");
  assert.equal(attempt.unknown_financial_exposure, false);
  assert.equal(attempt.financial_exposure_status, "settled");
  assert.equal(attempt.provider_observations[0].financial_exposure_status, "settled");
});

test("proposal schema 0.1 remains readable but cannot accept the 0.2 C03 settlement extension", () => {
  eventSequence = 0;
  const input = conceptProposalInput();
  const current = createCreativeConceptBatchProposal(input);
  assert.equal(current.schema_version, "0.3.0");
  const legacy = Object.freeze({ ...current, schema_version: "0.1.0" });
  assert.equal(replayCreativeConceptBatch(legacy, { trusted_scope: input.trusted_scope, request: input.request }).status, "replayed");
  const reserved = reserve(legacy, legacy.slots[0], "legacy-v1");
  const dispatching = dispatch(reserved.batch, reserved.batch.slots[0], reserved).batch;
  const settlementExtension = event(dispatching, dispatching.slots[0], "provider_outcome", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    outcome: "unknown",
    outcome_evidence_ref: "legacy-settlement-extension",
    provider_request_id: "legacy-settlement-extension",
    usage_evidence_ref: "legacy-settlement-extension",
    usage_completeness: "complete",
    financial_exposure_status: "settled",
    financial_settlement_evidence: { status: "settled", reservation_id: reserved.reservationRef,
      source_observation_id: "legacy-settlement-extension",
      effective_billable_attempt_id: reserved.billableAttemptId },
  });
  expectCode("unsupported_field", () => applyCreativeConceptEvent(dispatching, settlementExtension));
  assert.equal(dispatching.slots[0].status, "dispatching");
  assert.equal(dispatching.slots[0].attempts[0].unknown_financial_exposure, false);
  const legacyOutcome = providerOutcome(dispatching, dispatching.slots[0], reserved, "unknown", null);
  assert.equal(legacyOutcome.batch.slots[0].attempts[0].unknown_financial_exposure, true,
    "legacy batches retain their original conservative unknown-exposure behavior");
});

test("proposal schema 0.2 retains settlement compatibility and does not accept 0.3 retry authority", () => {
  eventSequence = 0;
  const input = conceptProposalInput();
  const current = createCreativeConceptBatchProposal(input);
  const prior = Object.freeze({ ...current, schema_version: "0.2.0" });
  assert.equal(replayCreativeConceptBatch(prior, { trusted_scope: input.trusted_scope, request: input.request }).status, "replayed");
  const reserved = reserve(prior, prior.slots[0], "prior-v2");
  const dispatching = dispatch(reserved.batch, reserved.batch.slots[0], reserved).batch;
  const usageRef = "usage-prior-v2-settlement";
  const settlement = event(dispatching, dispatching.slots[0], "provider_outcome", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    outcome: "failed",
    outcome_evidence_ref: "prior-v2-settlement",
    provider_request_id: "prior-v2-provider-request",
    usage_evidence_ref: usageRef,
    usage_completeness: "complete",
    financial_exposure_status: "settled",
    financial_settlement_evidence: { status: "settled", reservation_id: reserved.reservationRef,
      source_observation_id: usageRef, effective_billable_attempt_id: reserved.billableAttemptId },
  });
  const settled = applyCreativeConceptEvent(dispatching, settlement).batch;
  assert.equal(settled.slots[0].attempts[0].financial_exposure_status, "settled");
  assert.equal(Object.hasOwn(settled.slots[0].attempts[0], "latest_retry_disposition"), false);
  const retryExtension = { ...settlement, event_id: "prior-v2-retry-extension", retry_disposition: "eligible_retry" };
  expectCode("unsupported_field", () => applyCreativeConceptEvent(dispatching, retryExtension));
  assert.equal(dispatching.slots[0].status, "dispatching");
});

test("legacy concept histories upgrade by event and failed attempts without retry evidence stay unclassified", () => {
  eventSequence = 0;
  const input = conceptProposalInput();
  const current = createCreativeConceptBatchProposal(input);
  for (const schemaVersion of ["0.1.0", "0.2.0"]) {
    const legacy = Object.freeze({ ...current, schema_version: schemaVersion });
    const reserved = reserve(legacy, legacy.slots[0], `legacy-upgrade-${schemaVersion}`);
    const dispatching = dispatch(reserved.batch, reserved.batch.slots[0], reserved).batch;
    const outcome = providerOutcome(dispatching, dispatching.slots[0], reserved, "failed", null,
      schemaVersion === "0.2.0" ? {
        financial_exposure_status: "settled",
        financial_settlement_evidence: { status: "settled", reservation_id: reserved.reservationRef,
          source_observation_id: `usage-observation-${reserved.billableAttemptId}`,
          effective_billable_attempt_id: reserved.billableAttemptId },
      } : {});
    const oldEventHistory = structuredClone(outcome.batch.events);
    const upgradeEvent = {
      tenant_id: outcome.batch.tenant_id,
      project_id: outcome.batch.project_id,
      action_id: outcome.batch.action_id,
      batch_id: outcome.batch.batch_id,
      concept_id: null,
      event_id: `legacy-upgrade-event-${schemaVersion}`,
      event_type: "upgrade_retry_disposition",
      from_schema_version: schemaVersion,
      to_schema_version: "0.3.0",
    };
    const upgraded = applyCreativeConceptEvent(outcome.batch, upgradeEvent);
    assert.equal(upgraded.status, "applied");
    assert.equal(upgraded.batch.schema_version, "0.3.0");
    assert.deepEqual(upgraded.batch.events.slice(0, oldEventHistory.length), oldEventHistory,
      "migration appends one event and preserves every historical event identity/hash");
    assert.equal(upgraded.batch.events.at(-1).event_type, "upgrade_retry_disposition");
    const attempt = upgraded.batch.slots[0].attempts[0];
    assert.equal(attempt.latest_provider_outcome, "failed");
    assert.equal(attempt.provider_observations[0].retry_disposition, undefined,
      "the migration does not invent a native classification for historical provider evidence");
    assert.equal(attempt.latest_retry_disposition, "legacy_unclassified");
    if (schemaVersion === "0.2.0") {
      assert.equal(attempt.financial_exposure_status, "settled",
        "historical owner-backed settlement remains intact through the upgrade");
      assert.equal(attempt.unknown_financial_exposure, false);
    }
    assert.equal(applyCreativeConceptEvent(upgraded.batch, upgradeEvent).status, "duplicate");
    expectCode("retry_not_authorized", () => reserve(upgraded.batch, upgraded.batch.slots[0],
      `legacy-upgrade-retry-${schemaVersion}`));
  }
});

test("proposal schema 0.3 requires explicit settled retry eligibility and preserves hard stops", () => {
  eventSequence = 0;
  const batch = createCreativeConceptBatchProposal(conceptProposalInput());
  const reserved = reserve(batch, batch.slots[0], "hard-stop");
  const dispatching = dispatch(reserved.batch, reserved.batch.slots[0], reserved).batch;
  const hardStop = providerOutcome(dispatching, dispatching.slots[0], reserved, "failed", null, {
    retry_disposition: "hard_stop",
    financial_exposure_status: "settled",
    financial_settlement_evidence: { status: "settled", reservation_id: reserved.reservationRef,
      source_observation_id: `usage-observation-${reserved.billableAttemptId}`,
      effective_billable_attempt_id: reserved.billableAttemptId },
  }).batch;
  const hardStoppedAttempt = hardStop.slots[0].attempts[0];
  assert.equal(hardStoppedAttempt.latest_retry_disposition, "hard_stop");
  assert.equal(hardStoppedAttempt.provider_observations[0].retry_disposition, "hard_stop");
  expectCode("retry_not_authorized", () => reserve(hardStop, hardStop.slots[0], "must-not-retry"));
  assert.equal(hardStop.slots[0].attempts.length, 1);

  const unsettled = providerOutcome(dispatching, dispatching.slots[0], reserved, "failed", null).batch;
  expectCode("retry_not_authorized", () => reserve(unsettled, unsettled.slots[0], "unsettled-retry"));
});

test("cancellation suppresses same-attempt late success while retaining evidence and the unknown hold", () => {
  eventSequence = 0;
  const batch = createCreativeConceptBatchProposal(conceptProposalInput());
  const bytes = conceptReferenceBytes()[0];
  const reserved = reserve(batch, batch.slots[0], "cancelled");
  let current = dispatch(reserved.batch, reserved.batch.slots[0], reserved).batch;
  const cancel = event(current, current.slots[0], "cancel_concept", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    cancellation_evidence_ref: "owner-cancellation-event-ref",
  });
  current = applyCreativeConceptEvent(current, cancel).batch;
  assert.equal(current.slots[0].status, "cancelled");
  assert.equal(current.slots[0].attempts[0].financial_exposure_status, "unknown_hold");

  const late = event(current, current.slots[0], "late_provider_evidence", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    outcome: "succeeded",
    outcome_evidence_ref: "late-success-after-cancel",
    provider_request_id: "late-provider-request",
    artifact_sha256: hashArtifactBytes(bytes),
    usage_evidence_ref: "late-usage-observation",
    usage_completeness: "unknown",
  });
  current = applyCreativeConceptEvent(current, late).batch;
  assert.equal(current.slots[0].status, "cancelled");
  assert.equal(current.slots[0].output_lineage, null);
  assert.equal(current.slots[0].late_evidence.length, 1);
  assert.equal(current.slots[0].attempts[0].provider_observations[0].publication_suppressed, true);
  assert.equal(current.slots[0].attempts[0].unknown_financial_exposure, true);
  const publishEvent = event(current, current.slots[0], "candidate_published", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    design_version: {},
    storage_commit_ref: "must-not-publish",
    lineage_evidence_ref: "must-not-publish",
  });
  expectCode("event_identity_conflict", () => applyCreativeConceptEvent(current, { ...publishEvent, event_id: cancel.event_id }));
  expectCode("terminal_state_immutable", () => applyCreativeConceptEvent(current, publishEvent));
  expectCode("terminal_state_immutable", () => applyCreativeConceptEvent(current, event(current, current.slots[0], "cancel_concept", {
    billable_attempt_id: reserved.billableAttemptId,
    transport_attempt_id: reserved.transportAttemptId,
    cancellation_evidence_ref: "second-cancel",
  })));
});
