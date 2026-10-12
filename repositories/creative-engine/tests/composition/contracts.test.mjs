import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashCompositionLayerManifest } from "../../src/contracts/approval-handoff.mjs";
import { canonicalHash, canonicalSerialize } from "../../src/contracts/validation.mjs";
import {
  compositionStateHash,
  createCompositionProductionEnvelope,
  createCompositionRevision,
  snapshotCompositionBytesRecord,
  validateCompositionProductionEnvelope,
  validateCompositionRevision,
} from "../../src/contracts/composition-authority.mjs";
import { scenario, trustedScope } from "../contracts/approval/helpers.mjs";

function sha(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

function revisionFixture() {
  const setup = scenario();
  const scope = { ...trustedScope, brief_id: "test:brief-v1" };
  const previewBytes = Uint8Array.from(Buffer.from("deterministic exact preview bytes"));
  const previewHash = sha(previewBytes);
  const binding = structuredClone(setup.binding);
  binding.preview_sha256 = previewHash.slice(7);
  const layer_manifest = structuredClone(setup.layer_manifest);
  const artwork = structuredClone(setup.artifact);
  const geometry = [
    { layer_id: "test:art-layer", layout: { x_milli: 0, y_milli: 0 }, text_size: null },
    { layer_id: "test:name-layer", layout: null, text_size: { value: "24.50", unit: "pt" } },
    { layer_id: "test:logo-layer", layout: { x_milli: 870, y_milli: 40, width_milli: 90 }, text_size: null },
  ];
  binding.composition.sha256 = hashCompositionLayerManifest({ binding, artifact: artwork,
    layer_manifest, trustedScope });
  const dependencies = {
    brief_hash: `sha256:${binding.brief.sha256}`,
    facts_revision_id: binding.facts.revision_id,
    facts_sha256: `sha256:${binding.facts.sha256}`,
    package_id: "test:package-v1",
    package_sha256: `sha256:${"e".repeat(64)}`,
    design_version_id: binding.design_version.design_version_id,
    design_version_sha256: `sha256:${"d".repeat(64)}`,
    artwork_sha256: `sha256:${binding.design_version.artwork_sha256}`,
    parent_version_id: null,
    parent_design_hash: null,
    selection_revision: 7,
    asset_rights: ["display", "modify", "reproduce"].map((action) => ({
      asset_id: binding.assets[0].asset_id,
      action,
      source_ref: "test:source-logo",
      content_hash: `sha256:${binding.assets[0].sha256}`,
      package_id: "test:package-v1",
      package_hash: `sha256:${"e".repeat(64)}`,
      permission_ref: binding.assets[0].permission_ref,
      intended_use: binding.assets[0].intended_use,
      evidence_ref: `test:rights-proof:${action}`,
      checked_at: Date.parse("2026-10-11T12:00:00.000Z"),
      expires_at: Date.parse("2026-10-11T13:00:00.000Z"),
    })),
    edit_policy: null,
    authority_proof: {
      proof_ref: "test:authority-proof",
      state_sha256: `sha256:${"0".repeat(64)}`,
      checked_at: Date.parse("2026-10-11T12:00:00.000Z"),
      expires_at: Date.parse("2026-10-11T13:00:00.000Z"),
    },
  };
  const policyBody = {
    contract: "CreativeCompositionEditPolicy",
    schema_version: "1.0",
    policy_ref: "test:edit-policy-v1",
    policy_version: "test:policy-version-1",
    brief_hash: dependencies.brief_hash,
    facts_revision_id: dependencies.facts_revision_id,
    facts_sha256: dependencies.facts_sha256,
    package_id: dependencies.package_id,
    package_sha256: dependencies.package_sha256,
    design_version_id: dependencies.design_version_id,
    design_version_sha256: dependencies.design_version_sha256,
    artwork_sha256: dependencies.artwork_sha256,
    selection_revision: dependencies.selection_revision,
    locked_layer_ids: [],
    factual_text_layers: [],
    checked_at: Date.parse("2026-10-11T12:00:00.000Z"),
    expires_at: Date.parse("2026-10-11T13:00:00.000Z"),
  };
  dependencies.edit_policy = { ...policyBody, policy_sha256: canonicalHash(policyBody) };
  const raw = {
    tenant_id: scope.tenant_id,
    project_id: scope.project_id,
    brief_id: scope.brief_id,
    composition_id: binding.composition.composition_id,
    revision_id: binding.composition.revision_id,
    parent_revision_id: null,
    parent_revision_sha256: null,
    binding,
    artwork,
    layer_manifest,
    geometry,
    dependencies,
    preview: {
      contract: "CreativeCompositionPreviewMetadata",
      schema_version: "1.1",
      preview_id: "test:preview-v1",
      preview_sha256: previewHash,
      byte_length: previewBytes.byteLength,
      mime_type: "image/png",
      width_px: 16,
      height_px: 16,
      proof_ref: "test:preview-proof",
      state_sha256: `sha256:${"0".repeat(64)}`,
      checked_at: Date.parse("2026-10-11T12:00:00.000Z"),
      expires_at: Date.parse("2026-10-11T13:00:00.000Z"),
    },
  };
  const state_sha256 = compositionStateHash(raw);
  dependencies.authority_proof.state_sha256 = state_sha256;
  raw.preview.state_sha256 = state_sha256;
  return { scope, raw, previewBytes, state_sha256 };
}

test("composition revision, validator, and production envelope round-trip without a digest cycle", () => {
  const fixture = revisionFixture();
  assert.equal(compositionStateHash(fixture.raw), fixture.state_sha256);
  const created = createCompositionRevision(fixture.raw, { trustedScope: fixture.scope,
    previewBytes: fixture.previewBytes, nowMs: Date.parse("2026-10-11T12:30:00.000Z") });
  assert.equal(created.revision.state_sha256, fixture.state_sha256);
  assert.equal(created.revision.preview.state_sha256, fixture.state_sha256);
  assert.equal(Object.isFrozen(created.revision.geometry[1].text_size), true);
  assert.equal(created.revision.geometry[2].layout.width_milli, 90);

  const validated = validateCompositionRevision(created.revision, { trustedScope: fixture.scope,
    previewBytes: fixture.previewBytes, nowMs: Date.parse("2026-10-11T12:30:00.000Z") });
  assert.equal(canonicalSerialize(validated), canonicalSerialize(created.revision));

  const envelope = createCompositionProductionEnvelope(validated);
  const checkedEnvelope = validateCompositionProductionEnvelope(envelope, { trustedScope: fixture.scope,
    previewBytes: fixture.previewBytes });
  assert.equal(canonicalSerialize(checkedEnvelope), canonicalSerialize(envelope));
  assert.equal(Object.hasOwn(envelope.revision, "created_at"), false);
});

test("the state commitment is stable before proof completion and preview binds the final exact bytes", () => {
  const fixture = revisionFixture();
  const before = compositionStateHash(fixture.raw);
  const valid = createCompositionRevision(fixture.raw, { trustedScope: fixture.scope,
    previewBytes: fixture.previewBytes, nowMs: Date.parse("2026-10-11T12:30:00.000Z") });
  assert.equal(valid.revision.state_sha256, before);

  fixture.raw.dependencies.authority_proof.state_sha256 = `sha256:${"f".repeat(64)}`;
  assert.equal(compositionStateHash(fixture.raw), before);
  assert.throws(() => createCompositionRevision(fixture.raw, { trustedScope: fixture.scope,
    previewBytes: fixture.previewBytes, nowMs: Date.parse("2026-10-11T12:30:00.000Z") }),
  (error) => error.code === "integrity_error" && error.field === "dependencies.authority_proof.state_sha256");

  fixture.raw.dependencies.authority_proof.state_sha256 = before;
  const changedBytes = Uint8Array.from(Buffer.from("different preview bytes"));
  assert.throws(() => createCompositionRevision(fixture.raw, { trustedScope: fixture.scope,
    previewBytes: changedBytes, nowMs: Date.parse("2026-10-11T12:30:00.000Z") }),
  (error) => error.code === "integrity_error" && error.field === "preview");
});

test("composition byte snapshots bypass caller-owned typed-array getters and iterators", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  let byteLengthReads = 0;
  let iteratorReads = 0;
  Object.defineProperty(bytes, "byteLength", { configurable: true, get() {
    byteLengthReads += 1;
    bytes[0] = 99;
    return 1;
  } });
  Object.defineProperty(bytes, Symbol.iterator, { configurable: true, get() {
    iteratorReads += 1;
    bytes[0] = 88;
    return function* () { yield 77; };
  } });

  const copied = snapshotCompositionBytesRecord({ preview_bytes: bytes, mime_type: "image/png" });
  assert.deepEqual([...copied.bytes], [1, 2, 3]);
  assert.equal(byteLengthReads, 0);
  assert.equal(iteratorReads, 0);
  assert.deepEqual([bytes[0], bytes[1], bytes[2]], [1, 2, 3]);
});
