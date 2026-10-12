// Offline composition of the existing Creative API, durable ports and native image adapter.
// This is a repository fixture interface, not a provider or contract implementation.
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { canonicalHash } from "creative-engine/contracts";
import { inspectOpenAIImageBytes } from "creative-engine/models";
import {
  NOW, MODEL, SCOPE, NATIVE_FIXTURE_CONFIGURATION, hash, jsonFixture, authorizedActor, apiRequest,
  createCreativeApiFixture, createNativeProvider, mockOwnerUsageProfileAuthority,
} from "./creative-api-fixture.mjs";
import { makePng } from "./png.mjs";

export const CREATIVE_API_SCENARIOS = Object.freeze([
  "success", "malformed-output", "empty-output", "timeout-ambiguous", "refusal",
  "missing-usage", "duplicate-response", "cancellation-late-completion", "unsupported-settings",
]);
export const FIXTURE_CONFIGURATION = NATIVE_FIXTURE_CONFIGURATION;
const USAGE = Object.freeze({ input_tokens: 20, output_tokens: 10, total_tokens: 30,
  input_tokens_details: Object.freeze({ image_tokens: 18, text_tokens: 2 }),
  output_tokens_details: Object.freeze({ image_tokens: 9, text_tokens: 1 }) });

function deferred() {
  let resolve;
  return { promise: new Promise((done) => { resolve = done; }), resolve: (value) => resolve(value) };
}

async function requestFor(context, operation, actionId, parent) {
  const plan = await jsonFixture(operation === "generate" ? "generate-plan" : "edit-plan");
  const source = operation === "generate" ? "page-1" : "page-2";
  plan.base.brief_hash = canonicalHash(context.brief);
  plan.source_refs = [source];
  plan.steps[0].source_refs = [source];
  if (operation === "generate") return apiRequest(actionId, operation, plan, source);
  plan.base.design_hash = parent.design_hash;
  plan.base.design_version_id = parent.design_version_id;
  plan.steps[0].parameters.design_version_id = parent.design_version_id;
  plan.steps[0].parameters.artifact_id = parent.artifact.artifact_id;
  plan.expected_result.parent_version_id = parent.design_version_id;
  return apiRequest(actionId, operation, plan, source, {
    design_version_id: parent.design_version_id,
    image_reference_manifest: { contract: "CreativeImageReferenceManifest", schema_version: "1.0",
      ...SCOPE, brief_hash: canonicalHash(context.brief), research_package_id: context.research.package_id,
      research_package_hash: canonicalHash(context.research), base_design_version_id: parent.design_version_id,
      base_design_hash: parent.design_hash, references: [{ source_ref: "page-2", asset_id: "asset-2",
        content_hash: hash(context.referenceBytes), media_type: "image/png", width: 16, height: 16 }] },
  });
}

function publicCancelRequest(actionId, jobId) {
  const request = apiRequest(actionId, "cancel", null, "page-2");
  request.source_refs = [];
  request.payload = { job_id: jobId };
  return request;
}

function jsonRows(context, sql) {
  return context.store.db.prepare(sql).all().map((row) => Object.fromEntries(Object.entries(row)
    .map(([key, value]) => key.endsWith("_json") ? [key.slice(0, -5), value === null ? null : JSON.parse(value)] : [key, value])));
}

/** Execute an expected fixture scenario. API failures are returned as evidence; an unexpected
 * assertion/infrastructure failure rejects. Returned files contain synthetic bytes only.
 * Each call owns and removes its temporary SQLite/object directory before resolving.
 */
export async function runCreativeApiScenario({ scenario = "success" } = {}) {
  if (!CREATIVE_API_SCENARIOS.includes(scenario)) throw new TypeError("Unknown offline Creative API fixture scenario.");
  const context = await createCreativeApiFixture({ idPrefix: `ie07-${scenario}` });
  const files = new Map();
  const transports = [];
  const preparations = [];
  const finance = [];
  const permissions = [];
  const calls = [];
  const entered = deferred();
  const release = deferred();
  let activeDispatch;
  let artifactId = 0;
  let packet;
  let lateFlight;
  const snapshot = (value) => structuredClone(value);
  try {
    const originalVerifier = context.ports.planning.assetPermissionVerifier.verifyAssetUse;
    context.ports.planning.assetPermissionVerifier.verifyAssetUse = async (input) => {
      const result = await originalVerifier(input);
      permissions.push({ input: snapshot(input), result: snapshot(result), provenance: "synthetic" });
      return result;
    };
    for (const [method, original] of Object.entries(context.ports.metering)) {
      context.ports.metering[method] = async (...args) => {
        const result = await original(...args);
        // The second reserve argument can contain prepared host state. Never serialize it.
        finance.push({ sequence: finance.length + 1, method, input: snapshot(args[0] ?? null),
          result: snapshot(result), provenance: "synthetic" });
        return result;
      };
    }
    const native = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
      idFactory: () => `fixture-native-output-${++artifactId}`,
      async readArtifact(input) {
        const version = context.store.listDesignVersions({ scope: input.scope, brief_id: SCOPE.brief_id, limit: 100 }).items
          .find((item) => item.artifact.artifact_id === input.artifact_id && item.artifact.content_hash === input.content_hash);
        assert.ok(version, "native edit must resolve the exact immutable parent artifact");
        return context.store.getArtifactBytes({ scope: input.scope, brief_id: SCOPE.brief_id,
          design_version_id: version.design_version_id });
      },
      async fetchImpl(url, init) {
        context.counters.provider_posts += 1;
        assert.equal(init.method, "POST");
        assert.equal(init.redirect, "error");
        assert.equal(init.cache, "no-store");
        const operation = String(url).endsWith("/generations") ? "generate" : "edit";
        assert.equal(String(url), `https://api.openai.com/v1/images/${operation === "generate" ? "generations" : "edits"}`);
        const inputFiles = [];
        let parameters;
        if (operation === "generate") parameters = JSON.parse(init.body);
        else {
          parameters = {};
          for (const [name, value] of init.body.entries()) {
            if (typeof value === "string") parameters[name] = value;
            else {
              const bytes = Buffer.from(await value.arrayBuffer());
              const file = `transport-${transports.length + 1}-input-${inputFiles.length + 1}.png`;
              files.set(file, bytes);
              inputFiles.push({ field: name, file, content_hash: hash(bytes), media_type: value.type, bytes: bytes.length });
            }
          }
        }
        const record = { sequence: transports.length + 1, operation, url: String(url), method: init.method,
          intercepted: true, ...snapshot(activeDispatch), parameters, input_files: inputFiles };
        transports.push(record);
        const fault = operation === "edit" ? scenario : "success";
        const output = makePng({ blue: operation === "edit" ? 95 : 127 });
        const responseId = `synthetic-provider-receipt-${scenario}-${operation}`;
        let body = { data: [{ b64_json: output.toString("base64") }], usage: USAGE };
        let status = 200;
        if (fault === "malformed-output") body.data = [{ b64_json: Buffer.from("synthetic invalid image bytes").toString("base64") }];
        if (fault === "empty-output") body.data = [];
        if (fault === "missing-usage") delete body.usage;
        if (fault === "refusal") { status = 400; body = { error: { code: "content_policy_violation", message: "Synthetic refusal." } }; }
        if (fault === "timeout-ambiguous") {
          record.transport_outcome = "intercepted_timeout_after_dispatch_ack";
          record.response = null;
          throw new DOMException("Synthetic offline timeout after dispatch acknowledgement.", "TimeoutError");
        }
        const responseBytes = Buffer.from(JSON.stringify(body));
        const responseFile = `transport-${record.sequence}-response.json`;
        files.set(responseFile, responseBytes);
        record.response = { status, provider_receipt_id: responseId, provenance: "synthetic",
          file: responseFile, content_hash: hash(responseBytes), bytes: responseBytes.length };
        const response = new Response(responseBytes, { status, headers: {
          "content-type": "application/json", "x-request-id": responseId } });
        if (fault === "cancellation-late-completion") {
          record.transport_outcome = "intercepted_response_held_until_public_cancel";
          entered.resolve();
          await release.promise;
          record.transport_outcome = "intercepted_late_response_returned_after_public_cancel";
        } else record.transport_outcome = "intercepted_response_returned";
        return response;
      },
    });
    context.ports.provider = { ...native, async prepareAttempt(input) {
      const prepared = await native.prepareAttempt(input);
      preparations.push({ operation: input.operation, job_id: input.job_id,
        attempt: snapshot(input.attempt),
        target_binding_sha256: prepared.target_binding_sha256, target_binding: snapshot(prepared.target_binding),
        deadline_at: prepared.deadline_at });
      return prepared;
    } };
    for (const operation of ["generate", "edit"]) context.ports.provider[operation] = async (input) => {
      activeDispatch = { job_id: input.job_id, attempt: snapshot(input.attempt),
        transport_attempt_id: input.transport_attempt_id, reservation_ref: input.reservation_ref,
        target_binding_sha256: input.prepared_attempt.target_binding_sha256 };
      return native[operation](input);
    };
    context.ports.telemetry.usage_profile_authority = mockOwnerUsageProfileAuthority();
    const generateRequest = await requestFor(context, "generate", `ie07-${scenario}-generate`);
    generateRequest.correlation_id = `ie07-journey-${scenario}`;
    const generated = await context.api.invoke(authorizedActor(), generateRequest);
    calls.push({ request: generateRequest, response: generated });
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const parent = generated.result.design_version;
    const editRequest = await requestFor(context, "edit", `ie07-${scenario}-edit`, parent);
    editRequest.correlation_id = generateRequest.correlation_id;
    if (scenario === "unsupported-settings") editRequest.payload.plan.steps[0].parameters.unsupported_fixture_setting = true;
    let edited;
    if (scenario === "cancellation-late-completion") {
      lateFlight = context.api.invoke(authorizedActor(), editRequest);
      await Promise.race([entered.promise, lateFlight.then((result) => {
        throw new Error(`Edit completed before cancellation fixture dispatch: ${JSON.stringify(result)}`);
      })]);
      const cancel = publicCancelRequest(`cancel-${editRequest.action_id}`, activeDispatch.job_id);
      cancel.correlation_id = generateRequest.correlation_id;
      const cancelled = await context.api.invoke(authorizedActor(), cancel);
      calls.push({ request: cancel, response: cancelled });
      assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
      release.resolve();
      edited = await lateFlight;
    } else edited = await context.api.invoke(authorizedActor(), editRequest);
    calls.push({ request: editRequest, response: edited });
    const expectedSuccess = ["success", "duplicate-response"].includes(scenario);
    assert.equal(edited.ok, expectedSuccess, JSON.stringify(edited));
    if (scenario === "duplicate-response") {
      const replay = await context.api.invoke(authorizedActor(), editRequest);
      calls.push({ request: editRequest, response: replay, duplicate_request_replay: true });
      const { replayed, ...originalEnvelope } = replay;
      assert.equal(replayed, true);
      assert.deepEqual(originalEnvelope, edited);
    }
    const versions = context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 100 }).items;
    assert.equal(versions.length, expectedSuccess ? 2 : 1);
    assert.equal(context.counters.provider_posts, scenario === "unsupported-settings" ? 1 : 2);
    assert.equal(context.counters.reserves, scenario === "unsupported-settings" ? 1 : 2);
    const knownUsage = expectedSuccess || ["malformed-output", "empty-output"].includes(scenario);
    assert.equal(context.counters.settlements, knownUsage ? 2 : 1,
      "known synthetic usage settles a failed image attempt without publishing it");
    assert.equal(context.counters.held, !knownUsage && scenario !== "unsupported-settings" ? 1 : 0);
    if (!expectedSuccess) assert.equal(edited.error.code, scenario === "cancellation-late-completion" ? "cancelled" :
      scenario === "unsupported-settings" ? "invalid_request" : "unavailable");
    const artifacts = [];
    for (const version of versions) {
      const bytes = Buffer.from(await context.store.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
        design_version_id: version.design_version_id }));
      assert.equal(hash(bytes), version.artifact.content_hash);
      const media = await inspectOpenAIImageBytes(bytes);
      const file = `published-${artifacts.length + 1}.png`;
      files.set(file, bytes);
      artifacts.push({ design_version: version, file, content_hash: hash(bytes), bytes: bytes.length, media });
    }
    if (expectedSuccess) {
      const child = edited.result.design_version;
      assert.equal(child.parent_version_id, parent.design_version_id);
      assert.notEqual(child.artifact.content_hash, parent.artifact.content_hash);
    }
    assert.equal(transports[1]?.input_files[0]?.content_hash ?? parent.artifact.content_hash, parent.artifact.content_hash);
    packet = {
      evidence_schema: "creative-api-offline-fixture/1.0", scenario, fixture_version: "1.0",
      execution_mode: "mock", input_provenance: "synthetic", provider_network_requests: 0, paid_provider_calls: 0,
      real_credentials_read: false, external_acceptance: false,
      expected_api_outcome: expectedSuccess ? "success" : "structured_failure", fixture_assertions: "passed",
      fault_target: "edit", fixture_clock: new Date(NOW).toISOString(),
      scope: SCOPE, actor: authorizedActor(), correlation_id: generateRequest.correlation_id,
      provider: { name: "openai", model: MODEL, model_selection_authority: "synthetic fixture only",
        configuration: FIXTURE_CONFIGURATION, configuration_sha256: canonicalHash(FIXTURE_CONFIGURATION),
        adapter: "creative-engine/models#createOpenAIImagesProvider", sdk: { name: "native-fetch", version: process.versions.node } },
      provenance: { artwork: "locally generated synthetic PNG", permission: "synthetic local verifier; no real rights grant",
        capability: "synthetic local fixture", credential: "synthetic local port; token omitted",
        finance: "synthetic local reservation and settlement ports; no Finance owner ACK",
        usage_profile: "mock-owner-profile:gpt-image-2.5-fixture/1; synthetic mapping only",
        approval: "not exercised", production_handoff: "not exercised" },
      research: context.research, research_sha256: canonicalHash(context.research),
      brief: context.brief, brief_sha256: canonicalHash(context.brief), permission_checks: permissions,
      calls, preparations, transports, finance_events: finance, artifacts,
      usage_observations: snapshot(context.counters.usage_observations),
      jobs: jsonRows(context, "SELECT action_id,job_id,operation,request_hash,status,attempt_evidence_json,result_json,error_json FROM creative_jobs ORDER BY created_at,job_id"),
      provider_attribution: jsonRows(context, "SELECT action_id,job_id,operation,provider_name,provider_model,reservation_ref,billable_attempt_id,transport_attempt_id,dispatch_intent_ref,provider_request_id,provider_request_ref FROM private_provider_attributions ORDER BY job_id"),
      raw_usage_attribution: jsonRows(context, "SELECT action_id,billable_attempt_id,transport_attempt_id,target_binding_sha256,usage_sha256,usage_json FROM private_provider_usage_attributions ORDER BY job_id"),
      counters: snapshot(context.counters),
      boundary_limits: ["Expected negative API results are distinct from fixture command failures.",
        "Only generation and artwork edit API operations plus public cancellation/replay are exercised.",
        "Duplicate response means exact completed API request replay; no provider webhook protocol is claimed.",
        "Synthetic usage can settle only through the injected mock mapping and Finance ports.",
        "No recorded live response, real provider eligibility, rights, approval, Apply/C03 consumer ACK or release acceptance is established."],
    };
  } catch (error) {
    error.fixture_diagnostic = { scenario, calls, preparations, transports, finance_events: finance,
      counters: snapshot(context.counters) };
    throw error;
  } finally {
    release.resolve();
    await lateFlight?.catch(() => {});
    await context.close();
  }
  let removed = false;
  try { await access(context.root); } catch (error) { if (error.code === "ENOENT") removed = true; else throw error; }
  assert.equal(removed, true, "owned fixture database and object directory must be removed");
  packet.cleanup = { sqlite_closed: true, temporary_database_and_objects_removed: removed,
    retained_outputs: "only the caller-owned returned synthetic file map or CLI packet directory" };
  return { packet, files };
}
