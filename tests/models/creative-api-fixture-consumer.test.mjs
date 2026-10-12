import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canonicalHash, computeDesignVersionHash } from "creative-engine/contracts";
import {
  SCOPE, authorizedActor, apiRequest, createCreativeApiFixture, createNativeProvider, jsonFixture,
} from "../../fixtures/models/creative-api-fixture.mjs";
import { CREATIVE_API_SCENARIOS, runCreativeApiScenario } from "../../fixtures/models/creative-api-scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("native fixture construction requires intercepted fetch and cannot inherit ambient network", () => {
  assert.throws(() => createNativeProvider({}), /explicit intercepted fetch fixture is required/);
});

test("external fixture consumer invokes the public API and owns cleanup without importing a test file", async (t) => {
  const fixture = await createCreativeApiFixture();
  t.after(fixture.close);
  const plan = await jsonFixture("generate-plan");
  plan.base.brief_hash = canonicalHash(fixture.brief);
  plan.source_refs = ["page-1"]; plan.steps[0].source_refs = ["page-1"];
  const response = await fixture.api.invoke(authorizedActor(), apiRequest("independent-fixture-consumer", "generate", plan, "page-1"));
  assert.equal(response.ok, true, JSON.stringify(response));
  const version = response.result.design_version;
  const bytes = await fixture.store.getArtifactBytes({ scope: SCOPE, brief_id: fixture.brief.brief_id,
    design_version_id: version.design_version_id });
  assert.equal(digest(bytes), version.artifact.content_hash);
  await fixture.close();
  await fixture.close();
  await assert.rejects(access(fixture.root), { code: "ENOENT" });
});

for (const scenario of CREATIVE_API_SCENARIOS) test(`independent packet consumer verifies ${scenario} API, bytes, lineage and financial evidence`, async () => {
  const { packet, files } = await runCreativeApiScenario({ scenario });
  assert.equal(packet.execution_mode, "mock");
  assert.equal(packet.input_provenance, "synthetic");
  assert.equal(packet.external_acceptance, false);
  assert.equal(packet.real_credentials_read, false);
  assert.equal(packet.provider_network_requests, 0);
  assert.equal(packet.paid_provider_calls, 0);
  assert.match(packet.provenance.permission, /synthetic.*no real rights/);
  assert.match(packet.provenance.finance, /synthetic.*no Finance owner ACK/);
  assert.equal(packet.cleanup.temporary_database_and_objects_removed, true);
  assert.ok(packet.permission_checks.length > 0);
  assert.equal(canonicalHash(packet.research), packet.research_sha256);
  assert.equal(canonicalHash(packet.brief), packet.brief_sha256);
  const generation = packet.calls.find((call) => call.request.operation === "generate");
  const edit = packet.calls.find((call) => call.request.operation === "edit");
  const parent = generation.response.result.design_version;
  assert.equal(generation.response.ok, true);
  assert.equal(parent.parent_version_id, null);
  assert.equal(generation.request.correlation_id, edit.request.correlation_id);
  assert.equal(edit.request.payload.plan.base.design_hash, parent.design_hash);
  assert.equal(edit.request.payload.plan.base.design_version_id, parent.design_version_id);
  assert.equal(edit.request.payload.image_reference_manifest.base_design_hash, parent.design_hash);
  assert.equal(packet.counters.seed_dispatches, 0, "packet generation uses the actual native adapter, not the legacy seed provider");
  for (const artifact of packet.artifacts) {
    assert.equal(digest(files.get(artifact.file)), artifact.content_hash);
    assert.equal(artifact.content_hash, artifact.design_version.artifact.content_hash);
    assert.equal(computeDesignVersionHash(artifact.design_version), artifact.design_version.design_hash);
    assert.equal(artifact.media.width, 16);
    assert.equal(artifact.media.height, 16);
  }
  for (const transport of packet.transports) {
    assert.equal(transport.attempt.correlation_id, packet.correlation_id);
    assert.ok(packet.finance_events.some((event) => event.method === "reserveAttempt" &&
      event.input.billable_attempt_id === transport.attempt.billable_attempt_id));
    assert.ok(packet.preparations.some((prepared) => prepared.target_binding_sha256 === transport.target_binding_sha256 &&
      prepared.attempt.billable_attempt_id === transport.attempt.billable_attempt_id));
    for (const input of transport.input_files) assert.equal(digest(files.get(input.file)), input.content_hash);
    if (transport.response) assert.equal(digest(files.get(transport.response.file)), transport.response.content_hash);
  }
  for (const raw of packet.raw_usage_attribution) assert.equal(canonicalHash(raw.usage), raw.usage_sha256);
  const editUsage = packet.usage_observations.find((value) => value.logical_operation_id === edit.request.action_id);
  const positive = ["success", "duplicate-response"].includes(scenario);
  const mappedFailure = ["malformed-output", "empty-output"].includes(scenario);
  assert.equal(edit.response.ok, positive);
  assert.equal(packet.artifacts.length, positive ? 2 : 1);
  assert.equal(packet.counters.reserves, scenario === "unsupported-settings" ? 1 : 2);
  assert.equal(packet.counters.settlements, positive || mappedFailure ? 2 : 1);
  if (positive) {
    const child = edit.response.result.design_version;
    assert.equal(child.parent_version_id, parent.design_version_id);
    assert.notEqual(child.artifact.content_hash, parent.artifact.content_hash);
    assert.equal(editUsage.completeness, "complete");
  } else if (mappedFailure) {
    assert.equal(editUsage.completeness, "complete", "failed output does not erase supplied, synthetically mapped usage");
    assert.equal(packet.counters.held, 0);
  } else if (scenario === "unsupported-settings") {
    assert.equal(editUsage, undefined);
    assert.equal(packet.transports.length, 1, "schema rejection precedes any edit reservation/transport");
  } else if (["timeout-ambiguous", "refusal"].includes(scenario)) {
    assert.equal(editUsage, undefined, "absent provider usage must not become an invented observation");
    assert.equal(packet.counters.held, 1);
    assert.ok(packet.finance_events.some((event) => event.method === "markOutcomeUnknown" &&
      event.input.logical_operation_id === edit.request.action_id && event.result.status === "held_for_reconciliation"));
  } else {
    assert.notEqual(editUsage.completeness, "complete");
    assert.ok(editUsage.missing_fields.length > 0);
    assert.equal(packet.counters.held, 1);
  }
  if (scenario === "duplicate-response") {
    const replay = packet.calls.at(-1).response;
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, edit.response.result);
    assert.equal(packet.transports.length, 2);
    assert.equal(packet.usage_observations.length, 2);
  }
  if (scenario === "cancellation-late-completion") {
    assert.equal(packet.calls.find((call) => call.request.operation === "cancel").response.ok, true);
    assert.equal(edit.response.error.code, "cancelled");
    assert.equal(packet.transports[1].transport_outcome, "intercepted_late_response_returned_after_public_cancel");
  }
  assert.doesNotMatch(JSON.stringify(packet), /synthetic-offline-token|Bearer /,
    "even the fixture credential token is excluded from the packet");
});

test("CLI consumer verifies complete retained packet hashes and preserves existing output directories", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "creative-ie07-cli-consumer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, "packet");
  const run = (...args) => spawnSync(process.execPath, ["scripts/creative-api-fixture.mjs", ...args], {
    cwd: repoRoot, encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
  });
  const result = run("--scenario", "all", "--out", output);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = JSON.parse(result.stdout.trim());
  const manifestBytes = await readFile(path.join(output, "manifest.json"));
  assert.equal(digest(manifestBytes), receipt.manifest_sha256);
  const manifest = JSON.parse(manifestBytes);
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(output, file.path));
    assert.equal(digest(bytes), file.sha256);
    assert.equal(bytes.length, file.bytes);
  }
  const source = JSON.parse(await readFile(path.join(output, "source-inputs.json"), "utf8"));
  assert.match(source.commit_sha, /^[a-f0-9]{40}$/);
  assert.equal(source.runtime.node, process.versions.node);
  assert.equal(canonicalHash(source.inputs), source.input_manifest_sha256);
  assert.ok(source.inputs.some((item) => item.path === "fixtures/models/creative-api-fixture.mjs"));
  assert.equal(source.inputs.some((item) => item.path.includes("node_modules")), false);
  const index = JSON.parse(await readFile(path.join(output, "index.json"), "utf8"));
  assert.equal(index.results.length, CREATIVE_API_SCENARIOS.length);
  assert.equal(index.external_acceptance, false);
  for (const row of index.results) {
    const bytes = await readFile(path.join(output, row.packet));
    assert.equal(digest(bytes), row.sha256);
    const packet = JSON.parse(bytes);
    assert.equal(packet.execution.source_commit, source.commit_sha);
    assert.equal(packet.execution.input_manifest_sha256, source.input_manifest_sha256);
  }
  const rerun = run("--scenario", "success", "--out", output);
  assert.equal(rerun.status, 1);
  assert.match(rerun.stderr, /EEXIST/);
  assert.deepEqual(await readFile(path.join(output, "manifest.json")), manifestBytes);
  const sentinel = path.join(root, "sentinel.txt");
  await writeFile(sentinel, "caller-owned data");
  const fileCollision = run("--out", sentinel);
  assert.equal(fileCollision.status, 1);
  assert.equal(await readFile(sentinel, "utf8"), "caller-owned data");
  const link = path.join(root, "packet-link");
  await symlink(output, link);
  assert.equal(run("--out", link).status, 1);
  const invalidOutput = path.join(root, "invalid");
  assert.equal(run("--scenario", "live", "--out", invalidOutput).status, 1);
  await assert.rejects(access(invalidOutput), { code: "ENOENT" });
});

test("fixture cleanup leaves a caller-owned root and unrelated sentinel intact", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "creative-ie07-caller-root-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sentinel = path.join(root, "sentinel.txt");
  await writeFile(sentinel, "keep");
  const fixture = await createCreativeApiFixture({ root });
  await fixture.close();
  assert.equal(await readFile(sentinel, "utf8"), "keep");
  await access(fixture.databasePath);
});
