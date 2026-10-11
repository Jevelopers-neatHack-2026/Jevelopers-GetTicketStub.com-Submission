import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OpenAIImagesProviderError,
  OpenRouterImagesProviderError,
  createOpenRouterImagesProvider,
  normalizeOpenRouterImageUsage,
} from "../../src/models/index.mjs";
import { readPrivateOpenAIImageRetryDisposition as readDisposition } from "../../src/models/openai-images.mjs";
import { makePng } from "../../fixtures/models/png.mjs";
import {
  CREDENTIAL_CANARY, FULL_USAGE, HASH, NOW, OR_ENDPOINT, OR_MODEL, OR_PROVIDER_TAG, TEST_HASH,
  orAuthorityPorts, orCredentialPort, orHarness, orInput, orProfile, orResponse,
} from "../../fixtures/models/openrouter-harness.mjs";

const JPEG = readFileSync(new URL("../../fixtures/models/valid-16x16.jpg", import.meta.url));
const WEBP = readFileSync(new URL("../../fixtures/models/valid-16x16.webp", import.meta.url));
const PROMPT = "A synthetic offline test image.";

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function assertNoLeak(value, extra = []) {
  const text = typeof value === "string" ? value : JSON.stringify(value, Object.getOwnPropertyNames(Object(value)));
  for (const secret of [CREDENTIAL_CANARY, "Bearer ", "data:image", ";base64,", PROMPT, ...extra]) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
}

function manifestEdit(referenceBytes, overrides = {}) {
  const references = referenceBytes.map((bytes, index) => ({ source_ref: `source-ref-${index + 1}`,
    asset_id: `asset-ref-${index + 1}`, content_hash: HASH(bytes), media_type: "image/png", width: 16, height: 16 }));
  const ctx = orInput("edit", {
    brief: { brief_id: "brief-test", research_package_ref: { package_id: "research-package-01" } },
    plan: { operation: "image.edit", source_refs: references.map((item) => item.source_ref),
      steps: [{ action: "image.edit", parameters: { design_version_id: "design-version-01",
        artifact_id: "parent-artifact-01", instruction: "Make the sky blue." } }] },
    image_reference_manifest: { contract: "CreativeImageReferenceManifest", schema_version: "1.0",
      tenant_id: "tenant-test", project_id: "creative-project-test", brief_id: "brief-test", brief_hash: TEST_HASH,
      research_package_id: "research-package-01", research_package_hash: TEST_HASH,
      base_design_version_id: "design-version-01", base_design_hash: TEST_HASH, references },
    ...overrides,
  });
  ctx.base_design.design_hash = TEST_HASH;
  return { ctx, references };
}

function editAssets(parent, referenceBytes, reads = []) {
  return {
    async readArtifact(args) { reads.push(args.artifact_id); return parent; },
    async readReference(args) {
      reads.push(args.source_ref);
      return referenceBytes[Number(args.source_ref.at(-1)) - 1];
    },
  };
}

function parentlessConcept(referenceCount, counters = { assetReads: 0, staged: 0 }) {
  const referenceBytes = Array.from({ length: referenceCount }, (_, index) => makePng({ transparent: index % 2 === 1 }));
  const references = referenceBytes.map((bytes, index) => ({ source_ref: `range-concept-source-${index + 1}`,
    asset_id: `range-concept-asset-${index + 1}`, content_hash: HASH(bytes), media_type: "image/png",
    role_ref: `range-concept-role-${index + 1}`, width: 16, height: 16 }));
  const ctx = orInput("edit", {
    base_design: null,
    brief: { brief_id: "brief-test", research_package_ref: { package_id: "research-package-01" } },
    plan: { operation: "concept.generate", plan_id: "plan-range-concept",
      source_refs: references.map((item) => item.source_ref),
      steps: [{ step_id: "range-concept-step", action: "concept.generate",
        source_refs: references.map((item) => item.source_ref), parameters: { variant_count: 1 } }] },
    concept_reference_manifest: { contract: "CreativeConceptReferenceManifest", schema_version: "1.0",
      tenant_id: "tenant-test", project_id: "creative-project-test", brief_id: "brief-test", brief_hash: TEST_HASH,
      research_package_id: "research-package-01", research_package_hash: TEST_HASH,
      mapping_ref: "openrouter-reference-concepts", mapping_version: "1",
      prompt_template_ref: "prompt-template-concepts-v1", prompt_template_version: "1",
      prompt_template_sha256: TEST_HASH, references },
    concept_batch_id: "range-concept-batch", concept_id: "range-concept-slot",
    async recordConceptDispatchBinding(binding) {
      return { status: "recorded", transport_attempt_id: "transport-image-001",
        target_binding_sha256: binding.target_binding_sha256 };
    },
    async stageConceptResponse(stage) {
      counters.staged += 1;
      return { status: "staged", stage_ref: "range-concept-stage", content_hash: stage.content_hash };
    },
    assertDispatchCurrent: () => "dispatch-image-001",
  });
  return { ctx, references, referenceBytes, counters, assetPort: {
    async readReference(args) {
      counters.assetReads += 1;
      return referenceBytes[references.findIndex((item) => item.asset_id === args.asset_id)];
    },
  } };
}

test("the profile is explicit: no default model, tag, or capability is invented", () => {
  const base = () => ({ ...orProfile(), ...orAuthorityPorts(), credentialPort: orCredentialPort(), promptPort: { render: () => PROMPT } });
  assert.doesNotThrow(() => createOpenRouterImagesProvider(base()));
  const denied = [
    ["missing model", { model_id: undefined }, "unsupported_model_profile"],
    ["bare model name", { model_id: "constructor" }, "unsupported_model_profile"],
    ["missing provider tag", { provider_tag: undefined }, "unsupported_model_profile"],
    ["tag with whitespace", { provider_tag: "a b" }, "unsupported_model_profile"],
    ["missing capabilities", { capabilities: undefined }, "unsupported_model_profile"],
    ["no capability at all", { capabilities: { generation: false, edit: false } }, "unsupported_model_profile"],
    ["edit without a reference maximum", { capabilities: { generation: true, edit: {} } }, "unsupported_model_profile"],
    ["edit with zero references", { capabilities: { generation: true, edit: { max_input_references: 0 } } }, "unsupported_model_profile"],
    ["edit true shorthand", { capabilities: { generation: true, edit: true } }, "unsupported_model_profile"],
    ["extra capability", { capabilities: { generation: true, edit: false, mask: true } }, "unsupported_model_profile"],
    ["svg output is never accepted", { supported_parameters: { output_format: { type: "enum", values: ["svg"] } }, configuration: {} }, "unsupported_model_profile"],
    ["unknown parameter descriptor", { supported_parameters: { seed: { type: "range", min: 0, max: 5 } }, configuration: {} }, "unsupported_model_profile"],
    ["undeclared configuration key", { configuration: { size: "1024x1024" } }, "unsupported_image_configuration"],
    ["configuration outside declared values", { configuration: { quality: "max" } }, "unsupported_image_configuration"],
    ["configured but undeclared parameter", { supported_parameters: {}, configuration: { quality: "low" } }, "unsupported_image_configuration"],
    ["transparent jpeg", { configuration: { background: "transparent", output_format: "jpeg" } }, "unsupported_image_configuration"],
    ["transparent without a pinned format", { configuration: { background: "transparent" } }, "unsupported_image_configuration"],
    ["compression on png", { configuration: { output_format: "png", output_compression: 50 } }, "unsupported_image_configuration"],
    ["compression out of range", { supported_parameters: { output_format: { type: "enum", values: ["webp"] },
      output_compression: { type: "range", min: 0, max: 80 } }, configuration: { output_format: "webp", output_compression: 90 } }, "unsupported_image_configuration"],
    ["non-integer compression", { configuration: { output_format: "webp", output_compression: 50.5 } }, "unsupported_image_configuration"],
    ["missing ports", { capabilityPort: undefined }, "provider_ports_unavailable"],
  ];
  for (const [name, overrides, code] of denied) {
    assert.throws(() => createOpenRouterImagesProvider({ ...base(), ...overrides }), (error) => {
      assert.ok(error instanceof OpenRouterImagesProviderError, name);
      assert.ok(error instanceof OpenAIImagesProviderError, name);
      assert.equal(error.name, "OpenRouterImagesProviderError");
      assert.equal(error.code, code, name);
      return true;
    }, name);
  }
  assert.doesNotThrow(() => createOpenRouterImagesProvider({ ...base(), configuration: {} }));
  assert.doesNotThrow(() => createOpenRouterImagesProvider({ ...base(),
    configuration: { background: "transparent", output_format: "webp", output_compression: 80 } }));
});

const LIVE_DESCRIPTORS = Object.freeze({
  aspect_ratio: { type: "enum", values: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "auto"] },
  quality: { type: "enum", values: ["auto", "low", "medium", "high", "xhigh", "max"] },
  background: { type: "enum", values: ["auto", "transparent", "opaque"] },
  output_format: { type: "enum", values: ["png", "jpeg", "webp"] },
  n: { type: "range", min: 1, max: 10 },
  input_references: { type: "range", min: 0, max: 16 },
  output_compression: { type: "range", min: 0, max: 100 },
});

test("catalog-shaped descriptors that list auto are accepted verbatim, but auto is never a pinned configuration", () => {
  const base = (overrides) => ({ ...orProfile(), ...orAuthorityPorts(), credentialPort: orCredentialPort(),
    promptPort: { render: () => PROMPT }, ...overrides });
  const verbatim = structuredClone(LIVE_DESCRIPTORS);
  const provider = createOpenRouterImagesProvider(base({ supported_parameters: verbatim,
    configuration: { aspect_ratio: "16:9", quality: "high", background: "opaque", output_format: "png" } }));
  assert.equal(provider.getConceptConfiguration().configuration.aspect_ratio, "16:9");
  assert.deepEqual(verbatim, LIVE_DESCRIPTORS, "the host's descriptor object is not mutated");
  const reject = (overrides, code, name) => assert.throws(() => createOpenRouterImagesProvider(base(overrides)),
    (error) => error.code === code, name);
  reject({ supported_parameters: LIVE_DESCRIPTORS, configuration: { aspect_ratio: "auto" } }, "unsupported_image_configuration",
    "pinning auto aspect ratio is refused");
  // The other catalog "auto" values keep their existing pinnable behavior.
  assert.doesNotThrow(() => createOpenRouterImagesProvider(base({ supported_parameters: LIVE_DESCRIPTORS,
    configuration: { quality: "auto", background: "auto" } })));
  for (const [name, descriptor] of [
    ["auto spelled in upper case", { type: "enum", values: ["AUTO"] }],
    ["auto with whitespace", { type: "enum", values: ["auto "] }],
    ["junk value", { type: "enum", values: ["1:1", "wide"] }],
    ["zero-dimension ratio", { type: "enum", values: ["0:1"] }],
    ["duplicate auto", { type: "enum", values: ["auto", "auto"] }],
    ["non-string value", { type: "enum", values: [1] }],
    ["unknown descriptor key", { type: "enum", values: ["auto"], default: "auto" }],
  ]) reject({ supported_parameters: { aspect_ratio: descriptor }, configuration: {} }, "unsupported_model_profile", name);
  for (const [name, supported_parameters] of [
    ["quality junk", { quality: { type: "enum", values: ["auto", "Not Valid!"] } }],
    ["background junk", { background: { type: "enum", values: ["auto", "sparkly"] } }],
    ["auto in output_format", { output_format: { type: "enum", values: ["auto"] } }],
    ["auto in resolution", { resolution: { type: "enum", values: ["auto"] } }],
    ["n above bound", { n: { type: "range", min: 1, max: 33 } }],
    ["n inverted", { n: { type: "range", min: 5, max: 1 } }],
    ["n fractional", { n: { type: "range", min: 0.5, max: 1 } }],
    ["n nonfinite", { n: { type: "range", min: 0, max: Number.NaN } }],
    ["n has unsupported default", { n: { type: "range", min: 0, max: 1, default: 1 } }],
    ["n has an unknown key", { n: { type: "range", min: 0, max: 1, extra: true } }],
    ["n unsafe integer", { n: { type: "range", min: 1, max: Number.MAX_SAFE_INTEGER + 1 } }],
    ["n as enum", { n: { type: "enum", values: ["1"] } }],
    ["input_references negative", { input_references: { type: "range", min: -1, max: 4 } }],
    ["input_references above ceiling", { input_references: { type: "range", min: 0, max: 33 } }],
    ["input_references inverted", { input_references: { type: "range", min: 4, max: 3 } }],
    ["input_references fractional", { input_references: { type: "range", min: 0, max: 1.5 } }],
    ["input_references nonfinite", { input_references: { type: "range", min: Number.NaN, max: 2 } }],
    ["input_references unsafe integer", { input_references: { type: "range", min: 0, max: Number.MAX_SAFE_INTEGER + 1 } }],
    ["input_references has unsupported default", { input_references: { type: "range", min: 0, max: 2, default: 1 } }],
    ["input_references has an unknown key", { input_references: { type: "range", min: 0, max: 2, extra: true } }],
    ["compression above 100", { output_compression: { type: "range", min: 0, max: 101 } }],
  ]) reject({ supported_parameters, configuration: {} }, "unsupported_model_profile", name);
  // Descriptor-only ranges can never be pinned.
  reject({ supported_parameters: LIVE_DESCRIPTORS, configuration: { n: 2 } }, "unsupported_image_configuration", "n is not pinnable");
  reject({ supported_parameters: LIVE_DESCRIPTORS, configuration: { input_references: 1 } }, "unsupported_image_configuration",
    "input_references is not pinnable");
});

test("provided catalog counts must agree with the fixed n and declared capabilities", async (t) => {
  const baseSupported = orProfile().supported_parameters;
  const contradictoryProfiles = [
    ["n excludes the adapter's fixed one image", {
      supported_parameters: { ...baseSupported, n: { type: "range", min: 2, max: 3 } },
    }, "generate"],
    ["generation requires zero references but the catalog requires at least one", {
      supported_parameters: { ...baseSupported, input_references: { type: "range", min: 1, max: 3 } },
    }, "generate"],
    ["edit capability cannot fit the catalog's zero-reference ceiling", {
      supported_parameters: { ...baseSupported, input_references: { type: "range", min: 0, max: 0 } },
      capabilities: { generation: true, edit: { max_input_references: 1 } },
    }, "edit"],
    ["edit capability cannot exceed the catalog ceiling used by parentless concepts", {
      supported_parameters: { ...baseSupported, input_references: { type: "range", min: 0, max: 1 } },
      capabilities: { generation: true, edit: { max_input_references: 3 } },
    }, "concept"],
    ["edit capability cannot reach the catalog minimum", {
      supported_parameters: { ...baseSupported, input_references: { type: "range", min: 3, max: 5 } },
      capabilities: { generation: false, edit: { max_input_references: 2 } },
    }, "edit"],
  ];

  for (const [name, profile, operation] of contradictoryProfiles) await t.test(name, async () => {
    const events = [];
    const counters = { fetches: 0, assetReads: 0, staged: 0 };
    const concept = operation === "concept" ? parentlessConcept(2, counters) : null;
    const reads = [];
    let harness;
    let denial;
    try {
      harness = orHarness({ operation: operation === "concept" ? "edit" : operation, profile, ports: { events },
        inputOverride: concept?.ctx ?? { async stageConceptResponse() { counters.staged += 1; } },
        assetPort: concept?.assetPort ?? editAssets(makePng(), [], reads),
        promptPort: concept ? { async render({ prompt_template }) { return { prompt: PROMPT,
          template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
          template_sha256: prompt_template.template_sha256 }; } } : undefined,
        fetchImpl: async () => { counters.fetches += 1; return orResponse(); },
      });
    } catch (error) { denial = error; }
    if (harness) {
      try { await harness.provider[operation === "concept" ? "edit" : operation](harness.ctx); }
      catch (error) { denial = error; }
    }
    assert.equal(denial?.code, "unsupported_model_profile",
      `${name}: contradictory catalog profile was accepted; side effects=${JSON.stringify({ events,
        fetches: counters.fetches, assetReads: counters.assetReads + reads.length, staged: counters.staged })}`);
    assert.equal(harness, undefined, `${name}: catalog contradiction must fail before a provider can dispatch`);
    assert.deepEqual(events, [], `${name}: no authority or credential port should run`);
    assert.equal(counters.fetches, 0, `${name}: no intercepted fetch should run`);
    assert.equal(harness?.fetchCount ?? 0, 0, `${name}: no adapter transport should run`);
    assert.equal(counters.assetReads + reads.length, 0, `${name}: no asset bytes should be read`);
    assert.equal(counters.staged, 0, `${name}: no concept response should be staged`);
  });

  await t.test("a normal edit below the declared minimum is refused before asset, credential, fetch, or stage work", async () => {
    const events = [];
    const reads = [];
    const counters = { fetches: 0, staged: 0 };
    const profile = {
      capabilities: { generation: false, edit: { max_input_references: 3 } },
      supported_parameters: { ...baseSupported, input_references: { type: "range", min: 2, max: 3 } },
    };
    const harness = orHarness({ operation: "edit", profile, ports: { events }, assetPort: editAssets(makePng(), [], reads),
      fetchImpl: async () => { counters.fetches += 1; return orResponse(); },
      inputOverride: { async stageConceptResponse() { counters.staged += 1; } },
    });
    await assert.rejects(harness.provider.edit(harness.ctx), (error) => error instanceof OpenRouterImagesProviderError &&
      error.code === "unsupported_operation" && error.field === "input_references");
    assert.deepEqual(events, []);
    assert.deepEqual(reads, []);
    assert.deepEqual(counters, { fetches: 0, staged: 0 });
  });

  for (const [name, inputRange, capabilityMaximum] of [
    ["concept references below the declared minimum", { min: 3, max: 3 }, 3],
  ]) await t.test(name, async () => {
    const events = [];
    const concept = parentlessConcept(2);
    const counters = { fetches: 0 };
    const profile = {
      capabilities: { generation: inputRange.min === 0, edit: { max_input_references: capabilityMaximum } },
      supported_parameters: { ...baseSupported, input_references: { type: "range", ...inputRange } },
    };
    const harness = orHarness({ operation: "edit", profile, ports: { events }, inputOverride: concept.ctx,
      assetPort: concept.assetPort, fetchImpl: async () => { counters.fetches += 1; return orResponse(); },
      promptPort: { async render({ prompt_template }) { return { prompt: PROMPT, template_ref: prompt_template.template_ref,
        template_version: prompt_template.template_version, template_sha256: prompt_template.template_sha256 }; } },
    });
    await assert.rejects(harness.provider.inspectConceptReferences({ scope: concept.ctx.scope, references: concept.references,
      maximum_single_reference_bytes: 1024 * 1024, maximum_aggregate_reference_bytes: 2 * 1024 * 1024 }),
    (error) => error instanceof OpenRouterImagesProviderError && error.code === "unsupported_operation" &&
      error.field === "input_references");
    await assert.rejects(harness.provider.edit(harness.ctx), (error) => error instanceof OpenRouterImagesProviderError &&
      error.code === "unsupported_operation" && error.field === "input_references");
    assert.deepEqual(events, [], "the parentless count is checked before authority or credential resolution");
    assert.equal(harness.fetchCount, 0);
    assert.equal(counters.fetches, 0);
    assert.equal(concept.counters.assetReads, 0, "inspection does not fetch unauthorized reference bytes");
    assert.equal(concept.counters.staged, 0, "an unsupported concept is never staged");
  });
});

test("actual wire counts at declared lower and upper boundaries remain functional", async (t) => {
  const baseSupported = orProfile().supported_parameters;
  await t.test("generation keeps n:1 and zero references at exact descriptors", async () => {
    const harness = orHarness({ profile: { capabilities: { generation: true, edit: false },
      supported_parameters: { ...baseSupported, n: { type: "range", min: 1, max: 1 },
        input_references: { type: "range", min: 0, max: 0 } } } });
    await harness.provider.generate(harness.ctx);
    const body = JSON.parse(harness.requests[0].init.body);
    assert.equal(body.n, 1);
    assert.equal(Object.hasOwn(body, "input_references"), false);
  });

  await t.test("parent-first edit accepts its exact one-reference boundary", async () => {
    const harness = orHarness({ operation: "edit", profile: { capabilities: { generation: false, edit: { max_input_references: 1 } },
      supported_parameters: { ...baseSupported, n: { type: "range", min: 1, max: 1 },
        input_references: { type: "range", min: 1, max: 1 } } }, assetPort: editAssets(makePng(), []) });
    await harness.provider.edit(harness.ctx);
    assert.equal(JSON.parse(harness.requests[0].init.body).input_references.length, 1);
  });

  await t.test("parentless concept accepts the lower endpoint of two authorized references", async () => {
    const events = [];
    const concept = parentlessConcept(2);
    const profile = { capabilities: { generation: false, edit: { max_input_references: 3 } },
      supported_parameters: { ...baseSupported, n: { type: "range", min: 1, max: 1 },
        input_references: { type: "range", min: 2, max: 3 } } };
    const harness = orHarness({ operation: "edit", profile, ports: { events }, inputOverride: concept.ctx, assetPort: concept.assetPort,
      promptPort: { async render({ prompt_template }) { return { prompt: PROMPT, template_ref: prompt_template.template_ref,
        template_version: prompt_template.template_version, template_sha256: prompt_template.template_sha256 }; } } });
    const inspected = await harness.provider.inspectConceptReferences({ scope: concept.ctx.scope, references: concept.references,
      maximum_single_reference_bytes: 1024 * 1024, maximum_aggregate_reference_bytes: 3 * 1024 * 1024 });
    assert.equal(inspected.length, 2);
    await harness.provider.edit(harness.ctx);
    const body = JSON.parse(harness.requests[0].init.body);
    assert.equal(body.input_references.length, 2);
    assert.ok(!body.input_references.some((item) => item.image_url.url.includes("undefined")));
    assert.equal(concept.counters.staged, 1);
    assert.equal(harness.fetchCount, 1);
    assert.ok(events.includes("credential.resolve"));
  });

  await t.test("parent plus two authorized references accepts the upper endpoint", async () => {
    const referenceBytes = [makePng(), makePng({ transparent: true })];
    const { ctx, references } = manifestEdit(referenceBytes);
    const profile = { capabilities: { generation: false, edit: { max_input_references: 3 } },
      supported_parameters: { ...baseSupported, n: { type: "range", min: 1, max: 1 },
        input_references: { type: "range", min: 2, max: 3 } } };
    const harness = orHarness({ operation: "edit", profile, inputOverride: ctx,
      assetPort: editAssets(makePng(), referenceBytes) });
    await harness.provider.edit(harness.ctx);
    const body = JSON.parse(harness.requests[0].init.body);
    assert.equal(body.input_references.length, 3);
    assert.equal(references.length, 2);
  });

  await t.test("an absent optional range descriptor preserves legacy profile behavior", async () => {
    const harness = orHarness({ profile: { supported_parameters: baseSupported, configuration: {} } });
    await harness.provider.generate(harness.ctx);
    assert.equal(JSON.parse(harness.requests[0].init.body).n, 1);
  });
});

test("route is the exact OpenRouter endpoint and never a direct OpenAI one", () => {
  const harness = orHarness();
  for (const operation of ["generate", "edit"]) {
    const route = harness.provider.resolveRoute({ operation });
    assert.equal(route.provider.name, "openrouter");
    assert.equal(route.provider.model, OR_MODEL);
    assert.equal(route.provider.endpoint, OR_ENDPOINT);
    assert.deepEqual(route.provider.sdk, { name: "native-fetch", version: process.versions.node });
  }
  assert.throws(() => harness.provider.resolveRoute({ operation: "mask" }), (error) => error.code === "unsupported_operation");
});

test("generation posts one exact JSON request: pinned routing, no references, no identifiers, no redirects", async () => {
  let binding;
  const spy = orHarness({ ports: { mutateCapability: (value, args) => { binding = args.target_binding; return value; } } });
  const output = await spy.provider.generate(spy.ctx);
  assert.equal(spy.fetchCount, 1);
  const { url, init } = spy.requests[0];
  assert.equal(url, OR_ENDPOINT);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.deepEqual(Object.keys(init.headers).sort(), ["authorization", "content-type"]);
  assert.equal(init.headers["content-type"], "application/json");
  assert.equal(init.headers.authorization, `Bearer ${CREDENTIAL_CANARY}`);
  const body = JSON.parse(init.body);
  assert.deepEqual(body, { model: OR_MODEL, prompt: PROMPT, n: 1, stream: false,
    provider: { only: [OR_PROVIDER_TAG], allow_fallbacks: false },
    aspect_ratio: "1:1", quality: "low", background: "opaque", output_format: "png" });
  for (const forbidden of ["input_references", "user", "session_id", "trace", "seed", "size", "HTTP-Referer", "X-Title"]) {
    assert.ok(!(forbidden in body), forbidden);
  }
  for (const forbidden of ["sort", "order", "ignore", "options"]) assert.ok(!(forbidden in body.provider), forbidden);
  assert.equal(output.provider, "openrouter");
  assert.equal(output.model, OR_MODEL);
  assert.equal(output.artifact.media_type, "image/png");
  assert.equal(output.artifact.content_hash, HASH(makePng()));
  assert.ok(!("provider_request_ref" in output), "no provider request ref may be fabricated");
  assert.equal(binding.service, "openrouter");
  assert.equal(binding.endpoint, OR_ENDPOINT);
  assert.equal(binding.model, OR_MODEL);
  assert.equal(binding.provider_tag, OR_PROVIDER_TAG);
  assert.deepEqual(binding.provider_routing, { only: [OR_PROVIDER_TAG], allow_fallbacks: false });
  assert.equal(binding.operation, "generate");
  assert.equal(binding.operation_kind, "image_generation");
  assert.equal(binding.transport_policy.maximum_transport_attempts, 1);
  assert.equal(binding.transport_policy.automatic_retry, false);
});

test("the whole profile is bound into the configuration hash and target binding", async () => {
  const hashes = new Map();
  const run = async (name, profile, inputOverride = {}) => {
    let binding;
    const harness = orHarness({ profile, inputOverride, ports: { mutateCapability: (value, args) => { binding = args.target_binding; return value; } } });
    await harness.provider.generate(harness.ctx);
    hashes.set(name, binding.configuration_sha256);
    return binding;
  };
  await run("base", {});
  await run("tag", { provider_tag: "other-provider" });
  const attempt = orInput().attempt;
  await run("model", { model_id: "synthetic-lab/image-model-two" },
    { attempt: { ...attempt, provider: { ...attempt.provider, model: "synthetic-lab/image-model-two" } } });
  await run("quality", { configuration: { aspect_ratio: "1:1", quality: "high", output_format: "png", background: "opaque" } });
  await run("capability", { capabilities: { generation: true, edit: { max_input_references: 2 } } });
  await run("supported", { supported_parameters: { ...orProfile().supported_parameters, quality: { type: "enum", values: ["low", "high"] } } });
  assert.equal(new Set(hashes.values()).size, hashes.size, "each profile change must change the hash");
});

test("edit sends the parent first, then manifest references, as data URLs from validated asset-port bytes", async () => {
  const parent = makePng();
  const referenceBytes = [makePng({ transparent: true }), makePng({ width: 16, height: 16 })];
  const reads = [];
  const { ctx, references } = manifestEdit(referenceBytes);
  let binding;
  const harness = orHarness({ operation: "edit", inputOverride: ctx, assetPort: editAssets(parent, referenceBytes, reads),
    outputBytes: makePng({ transparent: false }),
    ports: { mutateCapability: (value, args) => { binding = args.target_binding; return value; } } });
  const output = await harness.provider.edit(harness.ctx);
  assert.equal(output.artifact.media_type, "image/png");
  assert.equal(harness.fetchCount, 1);
  assert.equal(harness.requests[0].url, OR_ENDPOINT);
  const body = JSON.parse(harness.requests[0].init.body);
  assert.equal(body.input_references.length, 3);
  const decoded = body.input_references.map((item) => {
    assert.deepEqual(Object.keys(item), ["type", "image_url"]);
    assert.equal(item.type, "image_url");
    assert.deepEqual(Object.keys(item.image_url), ["url"]);
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(item.image_url.url);
    assert.ok(match);
    return Buffer.from(match[1], "base64");
  });
  assert.deepEqual(decoded, [parent, ...referenceBytes]);
  assert.deepEqual(reads, ["parent-artifact-01", "source-ref-1", "source-ref-2"]);
  assert.ok(!("mask" in body) && !("image" in body));
  assert.deepEqual(Object.keys(body.provider), ["only", "allow_fallbacks"]);
  assert.equal(binding.operation, "edit");
  assert.equal(binding.operation_kind, "image_reference_edit");
  assert.equal(binding.metered_operation_kind, "image_edit");
  assert.equal(binding.edit_semantics, "reference_guided");
  assert.equal(binding.max_input_references, 3);
  assert.equal(binding.parent_artifact_sha256, HASH(parent));
  assert.ok(!("mask_content_sha256" in binding));
  assert.equal(references.length, 2);
  assertNoLeak(binding);
});

test("edit with only an immutable parent sends one reference", async () => {
  const parent = makePng();
  const harness = orHarness({ operation: "edit", assetPort: editAssets(parent, []) });
  await harness.provider.edit(harness.ctx);
  const body = JSON.parse(harness.requests[0].init.body);
  assert.equal(body.input_references.length, 1);
});

test("parentless concept edit sends only authorized references and fabricates no parent", async () => {
  const referenceBytes = [makePng(), makePng({ transparent: true })];
  const references = referenceBytes.map((bytes, index) => ({ source_ref: `source-concept-${index + 1}`,
    asset_id: `asset-concept-${index + 1}`, content_hash: HASH(bytes), media_type: "image/png",
    role_ref: `role-concept-${index + 1}`, width: 16, height: 16 }));
  const bindingAcks = [];
  const staged = [];
  const ctx = orInput("edit", {
    base_design: null,
    brief: { brief_id: "brief-test", research_package_ref: { package_id: "research-package-01" } },
    plan: { operation: "concept.generate", plan_id: "plan-concept-01", source_refs: references.map((item) => item.source_ref),
      steps: [{ step_id: "concept-step-01", action: "concept.generate", source_refs: references.map((item) => item.source_ref),
        parameters: { variant_count: 1 } }] },
    concept_reference_manifest: { contract: "CreativeConceptReferenceManifest", schema_version: "1.0",
      tenant_id: "tenant-test", project_id: "creative-project-test", brief_id: "brief-test", brief_hash: TEST_HASH,
      research_package_id: "research-package-01", research_package_hash: TEST_HASH,
      mapping_ref: "openrouter-reference-concepts", mapping_version: "1",
      prompt_template_ref: "prompt-template-concepts-v1", prompt_template_version: "1", prompt_template_sha256: TEST_HASH, references },
    concept_batch_id: "batch-concept-01", concept_id: "concept-slot-01",
    async recordConceptDispatchBinding(binding) {
      bindingAcks.push(binding);
      return { status: "recorded", transport_attempt_id: "transport-image-001", target_binding_sha256: binding.target_binding_sha256 };
    },
    async stageConceptResponse(stage) { staged.push(stage); return { status: "staged", stage_ref: "stage-01", content_hash: stage.content_hash }; },
    assertDispatchCurrent: () => "dispatch-image-001",
  });
  const harness = orHarness({ operation: "edit", inputOverride: ctx,
    promptPort: { async render({ prompt_template }) { return { prompt: PROMPT, template_ref: prompt_template.template_ref,
      template_version: prompt_template.template_version, template_sha256: prompt_template.template_sha256 }; } },
    assetPort: { async readReference(args) { return referenceBytes[references.findIndex((item) => item.asset_id === args.asset_id)]; } } });
  const inspected = await harness.provider.inspectConceptReferences({ scope: ctx.scope, references,
    maximum_single_reference_bytes: 1024 * 1024, maximum_aggregate_reference_bytes: 2 * 1024 * 1024 });
  assert.equal(inspected.length, 2);
  assert.deepEqual(harness.provider.getConceptConfiguration(), { model_id: OR_MODEL, provider_tag: OR_PROVIDER_TAG,
    capabilities: orProfile().capabilities, configuration: orProfile().configuration });
  await harness.provider.edit(harness.ctx);
  const body = JSON.parse(harness.requests[0].init.body);
  assert.equal(body.input_references.length, 2);
  assert.deepEqual(body.input_references.map((item) => Buffer.from(item.image_url.url.split(",")[1], "base64")), referenceBytes);
  assert.equal(bindingAcks.length, 1);
  assert.equal(bindingAcks[0].target_binding.operation_kind, "image_reference_edit");
  assert.equal(staged.length, 1);
});

test("concept edit rechecks local deadline and abort after the final same-store dispatch callback", async (t) => {
  const referenceBytes = [makePng(), makePng({ transparent: true })];
  const references = referenceBytes.map((bytes, index) => ({ source_ref: `source-final-fence-${index + 1}`,
    asset_id: `asset-final-fence-${index + 1}`, content_hash: HASH(bytes), media_type: "image/png",
    role_ref: `role-final-fence-${index + 1}`, width: 16, height: 16 }));
  for (const mode of ["deadline", "proof-expiry", "abort"]) await t.test(mode, async () => {
    let clock = NOW;
    let staged = 0;
    const ctx = orInput("edit", {
      base_design: null,
      brief: { brief_id: "brief-test", research_package_ref: { package_id: "research-package-01" } },
      plan: { operation: "concept.generate", plan_id: "plan-final-fence",
        source_refs: references.map((item) => item.source_ref),
        steps: [{ step_id: "concept-final-fence", action: "concept.generate",
          source_refs: references.map((item) => item.source_ref), parameters: { variant_count: 1 } }] },
      concept_reference_manifest: { contract: "CreativeConceptReferenceManifest", schema_version: "1.0",
        tenant_id: "tenant-test", project_id: "creative-project-test", brief_id: "brief-test", brief_hash: TEST_HASH,
        research_package_id: "research-package-01", research_package_hash: TEST_HASH,
        mapping_ref: "openrouter-reference-concepts", mapping_version: "1",
        prompt_template_ref: "prompt-template-concepts-v1", prompt_template_version: "1",
        prompt_template_sha256: TEST_HASH, references },
      concept_batch_id: "batch-final-fence", concept_id: "concept-final-fence",
      async recordConceptDispatchBinding(binding) { return { status: "recorded", transport_attempt_id: "transport-image-001",
        target_binding_sha256: binding.target_binding_sha256 }; },
      async stageConceptResponse(stage) { staged += 1; return { status: "staged", stage_ref: "stage-final-fence",
        content_hash: stage.content_hash }; },
    });
    ctx.assertDispatchCurrent = () => {
      if (mode === "deadline") clock = NOW + 60_000;
      else if (mode === "proof-expiry") clock = NOW + 15_000;
      else ctx.controller.abort();
      return "dispatch-image-001";
    };
    const harness = orHarness({ operation: "edit", now: () => clock, inputOverride: ctx,
      ports: mode === "proof-expiry" ? { mutateAuthority: (value) => ({ ...value,
        grant: { ...value.grant, expires_at: new Date(NOW + 15_000).toISOString() } }) } : {},
      assetPort: { async readReference(args) {
        return referenceBytes[references.findIndex((item) => item.asset_id === args.asset_id)];
      } },
      promptPort: { async render({ prompt_template }) { return { prompt: PROMPT,
        template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
        template_sha256: prompt_template.template_sha256 }; } } });
    await assert.rejects(harness.provider.edit(harness.ctx), (error) => error instanceof OpenRouterImagesProviderError &&
      error.code === "dispatch_fence_closed" && error.provider_outcome === "unknown");
    assert.equal(harness.fetchCount, 0);
    assert.equal(staged, 0);
  });
});

test("capability denial happens before credential resolution and transport", async (t) => {
  const parent = makePng();
  const refs = [makePng(), makePng(), makePng()];
  const scenarios = [
    ["generation-only profile denies edit", "edit", { capabilities: { generation: true, edit: false } },
      () => ({}), "operation_permission_denied"],
    ["edit-only profile denies generation", "generate", { capabilities: { generation: false, edit: { max_input_references: 4 } } },
      () => ({}), "operation_permission_denied"],
    ["parent plus references over the profile maximum", "edit", { capabilities: { generation: true, edit: { max_input_references: 3 } } },
      () => manifestEdit(refs).ctx, "unsupported_operation"],
    ["a mask on a later plan step is rejected before any asset read", "edit", {}, () => {
      const ctx = orInput("edit");
      ctx.plan.steps.push({ action: "image.edit", parameters: { mask_source_ref: "mask-ref-01" } });
      return ctx;
    }, "unsupported_plan"],
    ["a mask is never accepted", "edit", {}, () => {
      const ctx = orInput("edit");
      ctx.plan.steps[0].parameters.mask_source_ref = "mask-ref-01";
      return ctx;
    }, "unsupported_operation"],
  ];
  for (const [name, operation, profile, makeCtx, code] of scenarios) await t.test(name, async () => {
    const reads = [];
    const harness = orHarness({ operation, profile, inputOverride: makeCtx(), assetPort: editAssets(parent, refs, reads) });
    await assert.rejects(harness[operation === "edit" ? "provider" : "provider"][operation === "edit" ? "edit" : "generate"](harness.ctx),
      (error) => error instanceof OpenRouterImagesProviderError && error.code === code);
    assert.equal(harness.fetchCount, 0);
    assert.deepEqual(harness.events, []);
    assert.deepEqual(reads, []);
  });
  await t.test("route and concept configuration are denied for a generation-only profile", () => {
    const harness = orHarness({ profile: { capabilities: { generation: true, edit: false } } });
    assert.throws(() => harness.provider.resolveRoute({ operation: "edit" }), (error) => error.code === "operation_permission_denied");
    assert.throws(() => harness.provider.getConceptConfiguration(), (error) => error.code === "operation_permission_denied");
    assert.doesNotThrow(() => harness.provider.resolveRoute({ operation: "generate" }));
  });
  await t.test("exactly the maximum reference count is accepted", async () => {
    const { ctx } = manifestEdit(refs.slice(0, 2));
    const harness = orHarness({ operation: "edit", inputOverride: ctx, assetPort: editAssets(parent, refs) });
    await harness.provider.edit(harness.ctx);
    assert.equal(JSON.parse(harness.requests[0].init.body).input_references.length, 3);
  });
  await t.test("hash-mismatched or unreadable reference bytes never reach transport", async () => {
    const { ctx } = manifestEdit([refs[0]]);
    const harness = orHarness({ operation: "edit", inputOverride: ctx,
      assetPort: editAssets(parent, [makePng({ transparent: true })]) });
    await assert.rejects(harness.provider.edit(harness.ctx), (error) => error.code === "asset_integrity_error");
    assert.equal(harness.fetchCount, 0);
  });
});

test("provider failures map to the existing vocabulary, keep one transport, and never retain provider text", async (t) => {
  const FLAGGED = "FLAGGED-USER-TEXT-CANARY-do-not-retain";
  const MESSAGE = "PROVIDER-MESSAGE-CANARY-do-not-retain";
  const scenarios = [
    [400, "provider_request_failed", "failed", {}],
    [401, "authentication_denied", "failed", {}],
    [402, "provider_quota_exhausted", "failed", {}],
    [403, "moderation_blocked", "failed", { metadata: { reasons: ["x"], flagged_input: FLAGGED, provider_name: "p" } }],
    [403, "operation_permission_denied", "failed", { metadata: { provider_name: "p" } }],
    [404, "model_capability_unavailable", "failed", {}],
    [408, "provider_outcome_unknown", "unknown", {}],
    [413, "provider_request_failed", "failed", {}],
    [429, "provider_rate_limited", "failed", {}, { "retry-after": "2" }],
    [500, "provider_request_failed", "unknown", {}],
    [502, "provider_request_failed", "failed", {}],
    [503, "provider_request_failed", "failed", {}, { "retry-after": "2" }],
    [524, "provider_outcome_unknown", "unknown", {}],
    [529, "provider_request_failed", "unknown", {}],
    [418, "provider_request_failed", "failed", {}],
    [504, "provider_request_failed", "unknown", {}],
  ];
  for (const [status, code, outcome, extra, headers] of scenarios) await t.test(`${status} ${code}`, async () => {
    const harness = orHarness({ fetchImpl: async () => jsonResponse(status, { error: { code: status, message: MESSAGE, ...extra } }, headers) });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => {
      assert.ok(error instanceof OpenRouterImagesProviderError);
      assert.equal(error.code, code);
      assert.equal(error.provider_outcome, outcome);
      assert.equal(error.http_status, status);
      assert.ok(!("provider_request_ref" in error));
      if (status === 429 || status === 503) {
        assert.equal(error.retry.automatic_retry, false);
        assert.equal(error.retry.decision, "stop");
        assert.equal(error.retry.stop_reason, "fresh_authorization_required");
        assert.equal(error.retry.delay_ms, 2000);
      } else assert.equal(error.retry, undefined);
      const hardStop = [400, 401, 402, 403, 404, 413, 418].includes(status);
      assert.equal(readDisposition(error), hardStop ? "hard_stop" : undefined);
      assertNoLeak(error, [FLAGGED, MESSAGE]);
      assertNoLeak(error.message, [FLAGGED, MESSAGE]);
      return true;
    });
    assert.equal(harness.fetchCount, 1, "no automatic retry or fallback");
  });
  await t.test("429 without a usable Retry-After stops with an advisory decision only", async () => {
    const harness = orHarness({ fetchImpl: async () => jsonResponse(429, { error: { code: 429, message: MESSAGE } }) });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => {
      assert.equal(error.retry.decision, "stop");
      assert.equal(error.retry.automatic_retry, false);
      return true;
    });
  });
  await t.test("an unreadable error body is still a typed failure", async () => {
    const harness = orHarness({ fetchImpl: async () => new Response("<html>FLAGGED</html>", { status: 502 }) });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error.code === "provider_request_failed" && error.provider_outcome === "failed");
  });
  await t.test("HTTP 200 with an error body is an error, not an image", async () => {
    for (const [code, expected, outcome] of [[402, "provider_quota_exhausted", "failed"], [403, "moderation_blocked", "failed"],
      [429, "provider_rate_limited", "failed"], [524, "provider_outcome_unknown", "unknown"], ["weird", "provider_request_failed", "unknown"]]) {
      const harness = orHarness({ fetchImpl: async () => jsonResponse(200, {
        error: { code, message: MESSAGE, metadata: { flagged_input: FLAGGED, reasons: ["r"] } },
        data: [{ b64_json: makePng().toString("base64") }] }) });
      await assert.rejects(harness.provider.generate(harness.ctx), (error) => {
        assert.equal(error.code, code === 403 ? "moderation_blocked" : expected);
        assert.equal(error.provider_outcome, outcome);
        assert.equal(error.http_status, 200, "the HTTP status stays the real transport status");
        assert.equal(error.embedded_code, Number.isInteger(code) ? code : undefined);
        assertNoLeak(error, [FLAGGED, MESSAGE]);
        return true;
      });
      assert.equal(harness.fetchCount, 1);
    }
  });
  await t.test("transport rejection after send is an unknown outcome and is not retried", async () => {
    const harness = orHarness({ fetchImpl: async () => { throw new Error(`socket closed ${CREDENTIAL_CANARY}`); } });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => {
      assert.equal(error.code, "provider_transport_unknown");
      assert.equal(error.provider_outcome, "unknown");
      assertNoLeak(error);
      return true;
    });
    assert.equal(harness.fetchCount, 1);
  });
});

test("malformed, ambiguous, unsafe, or oversized outputs are rejected and nothing is published", async (t) => {
  const valid = makePng().toString("base64");
  const scenarios = [
    ["malformed JSON", () => new Response("{not json", { status: 200 }), "provider_response_invalid"],
    ["JSON array", () => jsonResponse(200, []), "provider_response_invalid"],
    ["missing data", () => jsonResponse(200, { created: 1 }), "provider_response_invalid"],
    ["empty data", () => jsonResponse(200, { data: [] }), "provider_response_invalid"],
    ["two images", () => jsonResponse(200, { data: [{ b64_json: valid }, { b64_json: valid }] }), "provider_response_invalid"],
    ["URL output only", () => jsonResponse(200, { data: [{ url: "https://example.invalid/a.png" }] }), "provider_response_invalid"],
    ["non-canonical base64", () => jsonResponse(200, { data: [{ b64_json: `${valid}\n` }] }), "provider_response_invalid"],
    ["bad base64 alphabet", () => jsonResponse(200, { data: [{ b64_json: "@@@@" }] }), "provider_response_invalid"],
    ["data URL instead of base64", () => jsonResponse(200, { data: [{ b64_json: `data:image/png;base64,${valid}` }] }), "provider_response_invalid"],
    ["SVG bytes", () => jsonResponse(200, { data: [{ b64_json: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64"),
      media_type: "image/svg+xml" }] }), null],
    ["SVG declared over PNG bytes", () => jsonResponse(200, { data: [{ b64_json: valid, media_type: "image/svg+xml" }] }), "provider_output_mismatch"],
    ["media_type mismatch", () => jsonResponse(200, { data: [{ b64_json: valid, media_type: "image/jpeg" }] }), "provider_output_mismatch"],
    ["non-string media_type", () => jsonResponse(200, { data: [{ b64_json: valid, media_type: 5 }] }), "provider_output_mismatch"],
    ["unknown format bytes", () => jsonResponse(200, { data: [{ b64_json: Buffer.from("GIF89a-not-allowed-here").toString("base64") }] }), "image_bytes_invalid"],
    ["corrupt PNG", () => jsonResponse(200, { data: [{ b64_json: makePng().subarray(0, 40).toString("base64") }] }), "image_bytes_invalid"],
    ["oversize payload", () => new Response(JSON.stringify({ data: [{ b64_json: "A".repeat(72_000_000) }] }), {
      status: 200, headers: { "content-length": "72000100" } }), "provider_response_invalid"],
  ];
  for (const [name, respond, code] of scenarios) await t.test(name, async () => {
    const harness = orHarness({ fetchImpl: async () => respond() });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => {
      assert.ok(error instanceof OpenRouterImagesProviderError);
      if (code) assert.equal(error.code, code);
      else assert.ok(["image_bytes_invalid", "provider_output_mismatch"].includes(error.code));
      assert.equal(error.provider_outcome, "unknown");
      assertNoLeak(error);
      return true;
    });
    assert.equal(harness.fetchCount, 1);
  });
  await t.test("a matching or omitted media_type is accepted for every allowed format", async () => {
    for (const [bytes, type] of [[makePng(), "image/png"], [JPEG, "image/jpeg"], [WEBP, "image/webp"]]) {
      for (const media_type of [undefined, type]) {
        const harness = orHarness({ profile: { configuration: {} }, outputBytes: bytes, media_type });
        const output = await harness.provider.generate(harness.ctx);
        assert.equal(output.artifact.media_type, type);
      }
    }
  });
});

test("pinned format, transparency, and aspect ratio are enforced; unpinned bounds are bounded", async (t) => {
  await t.test("decoded format must equal the pinned output_format", async () => {
    const harness = orHarness({ outputBytes: JPEG });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error.code === "provider_output_mismatch");
  });
  await t.test("transparent request needs an alpha channel", async () => {
    const harness = orHarness({ profile: { configuration: { background: "transparent", output_format: "png" } }, outputBytes: JPEG });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error.code === "provider_output_mismatch");
    const ok = orHarness({ profile: { configuration: { background: "transparent", output_format: "png" } },
      outputBytes: makePng({ transparent: true }) });
    assert.equal((await ok.provider.generate(ok.ctx)).artifact.media_type, "image/png");
  });
  await t.test("a pinned aspect ratio tolerates provider-derived sizes within 3% and rejects clearly different shapes", async () => {
    const wide = { aspect_ratio: "16:9", output_format: "png" };
    const bad = orHarness({ profile: { configuration: wide }, outputBytes: makePng({ width: 16, height: 16 }) });
    await assert.rejects(bad.provider.generate(bad.ctx), (error) => error.code === "provider_output_mismatch");
    for (const [width, height] of [[32, 18], [160, 90], [1344, 768], [1280, 736]]) {
      const ok = orHarness({ profile: { configuration: wide }, outputBytes: makePng({ width, height }) });
      assert.equal((await ok.provider.generate(ok.ctx)).artifact.media_type, "image/png", `${width}x${height}`);
    }
    for (const [width, height] of [[32, 20], [33, 18], [1024, 1024], [768, 1344]]) {
      const off = orHarness({ profile: { configuration: wide }, outputBytes: makePng({ width, height }) });
      await assert.rejects(off.provider.generate(off.ctx), (error) => error.code === "provider_output_mismatch", `${width}x${height}`);
    }
  });
  await t.test("without a pinned ratio or format any inspected PNG/JPEG/WebP within bounds is accepted", async () => {
    const harness = orHarness({ profile: { configuration: {} }, outputBytes: makePng({ width: 48, height: 16 }) });
    const output = await harness.provider.generate(harness.ctx);
    assert.equal(output.artifact.media_type, "image/png");
  });
});

test("usage is raw, unknown, identity-bound, and missing values are reported, never zero", async (t) => {
  await t.test("complete usage keeps counters and labels cost as provider-reported USD", async () => {
    const harness = orHarness({ usage: FULL_USAGE });
    const { usage } = await harness.provider.generate(harness.ctx);
    assert.equal(usage.completeness, "unknown");
    assert.deepEqual(usage.missing_fields, ["usage.profile_mapping_pending"]);
    assert.equal(usage.transport_attempt_id, "transport-image-001");
    assert.deepEqual([usage.input_tokens, usage.output_tokens, usage.total_tokens], [12, 34, 46]);
    assert.deepEqual(usage.cost, { amount: "0.04", currency: "USD", provenance: "provider_reported_unsettled" });
    assert.deepEqual(usage.cost_details, { upstream_inference_cost: "0.035" });
    assert.equal(usage.is_byok, false);
    assert.ok(Object.isFrozen(usage) && Object.isFrozen(usage.cost));
    assert.ok(!("provider_request_id" in usage));
  });
  await t.test("missing usage is unknown with missing fields and no zero counters or cost", async () => {
    const harness = orHarness({ usage: undefined });
    const { usage } = await harness.provider.generate(harness.ctx);
    assert.equal(usage.completeness, "unknown");
    assert.deepEqual(usage.missing_fields, ["usage", "usage.cost"]);
    for (const field of ["input_tokens", "output_tokens", "total_tokens", "cost", "cost_details", "is_byok"]) assert.ok(!(field in usage), field);
  });
  await t.test("missing cost is never filled with zero", async () => {
    const harness = orHarness({ usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
    const { usage } = await harness.provider.generate(harness.ctx);
    assert.ok(!("cost" in usage));
    assert.ok(usage.missing_fields.includes("usage.cost"));
    assert.equal(usage.input_tokens, 1);
  });
  await t.test("invalid, negative, or non-finite values are treated as missing", () => {
    for (const bad of [-1, "0.04", null, Number.NaN, {}]) {
      const usage = normalizeOpenRouterImageUsage({ prompt_tokens: bad, cost: bad });
      assert.ok(!("cost" in usage) && !("input_tokens" in usage), String(bad));
      assert.ok(usage.missing_fields.includes("usage.cost") && usage.missing_fields.includes("usage.input_tokens"));
    }
    const zero = normalizeOpenRouterImageUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 });
    assert.equal(zero.cost.amount, "0");
    assert.equal(zero.input_tokens, 0, "a provider-reported zero is kept distinct from absent");
  });
  await t.test("a positive cost that cannot be represented is unknown, never recorded as zero", () => {
    for (const tiny of [1e-10, 4e-10, 1e-12]) {
      const usage = normalizeOpenRouterImageUsage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: tiny,
        cost_details: { upstream_inference_cost: tiny } });
      assert.ok(!("cost" in usage), String(tiny));
      assert.ok(usage.missing_fields.includes("usage.cost"));
      assert.ok(!("upstream_inference_cost" in (usage.cost_details ?? {})));
      assert.ok(usage.missing_fields.includes("usage.cost_details.upstream_inference_cost"));
    }
    assert.equal(normalizeOpenRouterImageUsage({ cost: 0 }).cost.amount, "0", "a reported zero stays zero");
    assert.equal(normalizeOpenRouterImageUsage({ cost: 1e-9 }).cost.amount, "0.000000001");
  });
  await t.test("unmapped extensions and over-wide usage are flagged, and wide usage never publishes", async () => {
    const extension = normalizeOpenRouterImageUsage({ ...FULL_USAGE, mystery_field: 1, cost_details: { upstream_inference_cost: 0.1, extra: 1 } });
    assert.ok(extension.missing_fields.includes("usage.unmapped_fields"));
    assert.ok(extension.missing_fields.includes("usage.cost_details.unmapped_fields"));
    const wide = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`field_${index}`, index]));
    const harness = orHarness({ usage: { ...FULL_USAGE, ...wide } });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => {
      assert.equal(error.code, "usage_invalid");
      assert.ok(error.usage.missing_fields.includes("usage.too_many_fields"));
      return true;
    });
  });
  await t.test("over-wide nested cost details preserve allowlisted observations before refusing output", async () => {
    const extensions = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`extension_${index}`, `private-extra-${index}`]));
    assert.throws(() => normalizeOpenRouterImageUsage({ cost_details: {
      upstream_inference_cost: 0.035, ...extensions,
    } }), (error) => error.code === "usage_invalid", "the exported strict normalizer retains its nested field bound");
    const harness = orHarness({ usage: { ...FULL_USAGE, cost_details: {
      upstream_inference_cost: 0.035, ...extensions,
    } } });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => {
      assert.equal(error.code, "usage_invalid");
      assert.equal(error.provider_outcome, "unknown");
      assert.equal(error.usage.input_tokens, 12);
      assert.equal(error.usage.output_tokens, 34);
      assert.equal(error.usage.total_tokens, 46);
      assert.deepEqual(error.usage.cost, { amount: "0.04", currency: "USD", provenance: "provider_reported_unsettled" });
      assert.deepEqual(error.usage.cost_details, { upstream_inference_cost: "0.035" });
      assert.ok(error.usage.missing_fields.includes("usage.cost_details.too_many_fields"));
      assert.ok(!JSON.stringify(error.usage).includes("private-extra"));
      return true;
    });
    assert.equal(harness.fetchCount, 1);
  });
  await t.test("documented token details are bounded counters preserved as parent subsets", async () => {
    const details = { prompt_tokens_details: { audio_tokens: 0, cache_write_tokens: 1, cached_tokens: 2, file_tokens: 3, video_tokens: 4 },
      completion_tokens_details: { audio_tokens: 0, image_tokens: 30, reasoning_tokens: 4 } };
    const usage = normalizeOpenRouterImageUsage({ ...FULL_USAGE, ...details });
    assert.deepEqual(usage.input_tokens_details, details.prompt_tokens_details);
    assert.deepEqual(usage.output_tokens_details, details.completion_tokens_details);
    assert.ok(Object.isFrozen(usage.input_tokens_details) && Object.isFrozen(usage.output_tokens_details));
    assert.deepEqual(usage.missing_fields, ["usage.profile_mapping_pending"], "documented details are not findings");
    assert.ok(!("prompt_tokens_details" in usage) && !("completion_tokens_details" in usage));
    const harness = orHarness({ usage: { ...FULL_USAGE, ...details } });
    const output = await harness.provider.generate(harness.ctx);
    assert.deepEqual(output.usage.input_tokens_details, details.prompt_tokens_details);
    assert.deepEqual(output.usage.output_tokens_details, details.completion_tokens_details);
    assert.deepEqual(output.usage.missing_fields, ["usage.profile_mapping_pending"]);
    const bad = normalizeOpenRouterImageUsage({ ...FULL_USAGE, prompt_tokens_details: { cached_tokens: -1, file_tokens: 1.5, video_tokens: "3", audio_tokens: 2 },
      completion_tokens_details: [1] });
    assert.deepEqual(bad.input_tokens_details, { audio_tokens: 2 }, "invalid counters are dropped, never zero");
    assert.ok(!("output_tokens_details" in bad));
    for (const field of ["usage.prompt_tokens_details.cached_tokens", "usage.prompt_tokens_details.file_tokens",
      "usage.prompt_tokens_details.video_tokens", "usage.completion_tokens_details"]) assert.ok(bad.missing_fields.includes(field), field);
    const nullish = normalizeOpenRouterImageUsage({ ...FULL_USAGE, prompt_tokens_details: null });
    assert.ok(!("input_tokens_details" in nullish) && nullish.missing_fields.length === 1);
  });
  await t.test("unknown detail keys are anonymous findings and over-wide details are bounded", async () => {
    const unknown = normalizeOpenRouterImageUsage({ ...FULL_USAGE,
      prompt_tokens_details: { cached_tokens: 2, secret_vendor_key: 9 }, completion_tokens_details: { image_tokens: 1, other: 1 } });
    assert.deepEqual(unknown.input_tokens_details, { cached_tokens: 2 });
    assert.deepEqual(unknown.output_tokens_details, { image_tokens: 1 });
    assert.ok(unknown.missing_fields.includes("usage.prompt_tokens_details.unmapped_fields"));
    assert.ok(unknown.missing_fields.includes("usage.completion_tokens_details.unmapped_fields"));
    assert.ok(!JSON.stringify(unknown).includes("secret_vendor_key"));
    const extensions = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`extension_${index}`, `private-extra-${index}`]));
    const harness = orHarness({ usage: { ...FULL_USAGE, prompt_tokens_details: { cached_tokens: 5, ...extensions } } });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => {
      assert.equal(error.code, "usage_invalid");
      assert.deepEqual(error.usage.input_tokens_details, { cached_tokens: 5 });
      assert.deepEqual(error.usage.cost, { amount: "0.04", currency: "USD", provenance: "provider_reported_unsettled" });
      assert.ok(error.usage.missing_fields.includes("usage.prompt_tokens_details.too_many_fields"));
      assert.ok(error.usage.missing_fields.includes("usage.prompt_tokens_details.unmapped_fields"));
      assert.ok(!JSON.stringify(error.usage).includes("private-extra") && !JSON.stringify(error.usage).includes("extension_"));
      return true;
    });
  });
  await t.test("unmapped root keys are named only from the documented vocabulary; undocumented keys stay anonymous", async () => {
    const documented = { server_tool_use: { tool_calls_executed: 1 }, service_tier: "default", speed: "fast",
      cache_creation: { x: 1 }, iterations: [{ a: 1 }] };
    const usage = normalizeOpenRouterImageUsage({ ...FULL_USAGE, ...documented });
    assert.deepEqual(usage.missing_fields, ["usage.profile_mapping_pending", ...Object.keys(documented).map((key) => `usage.unmapped.${key}`)]);
    assert.ok(!usage.missing_fields.includes("usage.unmapped_fields"));
    const mixed = normalizeOpenRouterImageUsage({ ...FULL_USAGE, service_tier: "default", vendor_secret_key: "v" });
    assert.ok(mixed.missing_fields.includes("usage.unmapped.service_tier") && mixed.missing_fields.includes("usage.unmapped_fields"));
    assert.ok(!JSON.stringify(mixed).includes("vendor_secret_key"));
    const harness = orHarness({ usage: { ...FULL_USAGE, ...documented, vendor_secret_key: "do-not-echo" } });
    const output = await harness.provider.generate(harness.ctx);
    for (const key of Object.keys(documented)) assert.ok(output.usage.missing_fields.includes(`usage.unmapped.${key}`), key);
    assert.ok(output.usage.missing_fields.includes("usage.unmapped_fields"));
    assert.ok(!JSON.stringify(output.usage).includes("vendor_secret_key") && !JSON.stringify(output.usage).includes("do-not-echo"));
    assert.ok(!("service_tier" in output.usage) && !("server_tool_use" in output.usage));
    assert.equal(output.usage.cost.amount, "0.04");
  });
  await t.test("accessor-backed or proxied usage is rejected without being invoked", () => {
    let invoked = false;
    const hostile = {};
    Object.defineProperty(hostile, "cost", { enumerable: true, get() { invoked = true; return 1; } });
    assert.throws(() => normalizeOpenRouterImageUsage(hostile), OpenRouterImagesProviderError);
    assert.throws(() => normalizeOpenRouterImageUsage(new Proxy({}, { ownKeys() { invoked = true; return []; } })), OpenRouterImagesProviderError);
    assert.equal(invoked, false);
  });
  await t.test("observed usage accompanies a failed outcome without implying settlement", async () => {
    const harness = orHarness({ fetchImpl: async () => jsonResponse(502, { error: { code: 502, message: "x" }, usage: { cost: 0.01, total_tokens: 5 } }) });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => {
      assert.equal(error.usage.completeness, "unknown");
      assert.equal(error.usage.cost.provenance, "provider_reported_unsettled");
      assert.equal(error.usage.total_tokens, 5);
      return true;
    });
  });
});

test("a response request id header is never read, stored, or fabricated into a provider ref", async () => {
  const harness = orHarness({ fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: makePng().toString("base64") }] }), {
    status: 200, headers: { "x-request-id": "raw-private-request-id-123", "x-generation-id": "gen-raw-456" } }) });
  const output = await harness.provider.generate(harness.ctx);
  assert.ok(!("provider_request_ref" in output));
  assert.ok(!("provider_request_id" in output.usage));
  assert.ok(!JSON.stringify(output.usage).includes("raw-private-request-id"));
});

test("stale, denied, mismatched, or revoked authority never reaches the credential or transport", async (t) => {
  const scenarios = [
    ["unknown capability", { mutateCapability: (value) => ({ ...value, status: "unknown" }) }],
    ["operation denied", { mutateCapability: (value) => ({ ...value, operation_permission: "denied" }) }],
    ["quota unknown", { mutateCapability: (value) => ({ ...value, quota_status: "unknown" }) }],
    ["wrong service", { mutateCapability: (value) => ({ ...value, service: "openai" }) }],
    ["wrong model", { mutateCapability: (value) => ({ ...value, model: "synthetic-lab/other" }) }],
    ["expired capability", { mutateCapability: (value) => ({ ...value, expires_at: new Date(NOW - 1).toISOString() }) }],
    ["grant for another service", { mutateAuthority: (value) => ({ ...value, grant: { ...value.grant, service: "openai" } }) }],
    ["grant for another target", { mutateAuthority: (value) => ({ ...value, grant: { ...value.grant, target_binding_sha256: TEST_HASH } }) }],
    ["revoked", { mutateAuthority: (value) => ({ ...value, revoked: true }) }],
    ["finance for another provider", { mutateAuthority: (value) => ({ ...value, finance: { ...value.finance, provider: "openai" } }) }],
    ["wrong reservation", { mutateAuthority: (value) => ({ ...value, finance: { ...value.finance, reservation_ref: "reservation-foreign" } }) }],
    ["over-cap hold", { mutateAuthority: (value) => ({ ...value, finance: { ...value.finance, held_amount: { amount: "1.01", currency: "USD" } } }) }],
    ["currency mismatch", { mutateAuthority: (value) => ({ ...value, finance: { ...value.finance, authorized_cap: { amount: "1.00", currency: "EUR" } } }) }],
    ["expired Finance lease", { mutateAuthority: (value) => ({ ...value, finance: { ...value.finance, expires_at: new Date(NOW - 1).toISOString() } }) }],
  ];
  for (const [name, ports] of scenarios) await t.test(name, async () => {
    const harness = orHarness({ ports });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error instanceof OpenRouterImagesProviderError);
    assert.equal(harness.fetchCount, 0);
    assert.ok(!harness.events.includes("credential.resolve") || name === "never");
    assertNoLeak(harness.events);
  });
  await t.test("revocation after the transport acknowledgement stops the POST and leaves the outcome unknown", async () => {
    let phase;
    const harness = orHarness({ ports: { mutateAuthority: (value, args) => {
      phase = args.phase;
      return args.phase === "post_transport_ack" ? { ...value, revoked: true } : value;
    } } });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error.provider_outcome === "unknown");
    assert.equal(phase, "post_transport_ack");
    assert.equal(harness.fetchCount, 0);
  });
  await t.test("capability revalidation failure after acknowledgement stops the POST", async () => {
    const harness = orHarness({ ports: { mutateCapability: (value, args) => args.phase === "post_transport_ack"
      ? { ...value, operation_permission: "denied" } : value } });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error.code === "model_capability_unverified");
    assert.equal(harness.fetchCount, 0);
  });
  await t.test("a credential bound to another service or grant is rejected before transport", async () => {
    const harness = orHarness();
    const provider = createOpenRouterImagesProvider({ ...orProfile(), ...orAuthorityPorts(),
      credentialPort: { async resolveCredential(args) {
        const resolved = await orCredentialPort().resolveCredential(args);
        return { ...resolved, binding: { ...resolved.binding, service: "openai" } };
      } },
      promptPort: { render: () => PROMPT }, fetchImpl: async () => { throw new Error("must not post"); }, now: () => NOW });
    await assert.rejects(provider.generate(harness.ctx), (error) => error.code === "credential_unavailable");
  });
  await t.test("a credential port exception is sanitized", async () => {
    const provider = createOpenRouterImagesProvider({ ...orProfile(), ...orAuthorityPorts(),
      credentialPort: { async resolveCredential() { throw new Error(`vault failure ${CREDENTIAL_CANARY}`); } },
      promptPort: { render: () => PROMPT }, fetchImpl: async () => { throw new Error("must not post"); }, now: () => NOW });
    await assert.rejects(provider.generate(orInput()), (error) => {
      assert.equal(error.code, "credential_unavailable");
      assertNoLeak(error);
      return true;
    });
  });
  await t.test("the adapter never reads environment credentials", async () => {
    const saved = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      TICKETSTUB_ART_OPENROUTER_API_KEY: process.env.TICKETSTUB_ART_OPENROUTER_API_KEY,
      CREATIVE_ENGINE_OPENROUTER_API_KEY: process.env.CREATIVE_ENGINE_OPENROUTER_API_KEY };
    for (const key of Object.keys(saved)) process.env[key] = `env-canary-${key}`;
    try {
      const harness = orHarness();
      await harness.provider.generate(harness.ctx);
      const sent = JSON.stringify(harness.requests[0]);
      assert.ok(!sent.includes("env-canary"));
      assert.equal(harness.requests[0].init.headers.authorization, `Bearer ${CREDENTIAL_CANARY}`);
    } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
});

test("identity, reservation, route, and deadline fences are preserved", async (t) => {
  const scenarios = [
    ["no reservation", { reservation_ref: undefined }],
    ["transport aliases billable", { transport_attempt_id: "billable-image-001" }],
    ["direct OpenAI route in an OpenRouter call", { attempt: { ...orInput().attempt, provider: { ...orInput().attempt.provider, name: "openai" } } }],
    ["another model", { attempt: { ...orInput().attempt, provider: { ...orInput().attempt.provider, model: "other/model" } } }],
    ["another endpoint", { attempt: { ...orInput().attempt, provider: { ...orInput().attempt.provider,
      endpoint: "https://openrouter.ai/api/v1/chat/completions" } } }],
    ["direct OpenAI endpoint", { attempt: { ...orInput().attempt, provider: { ...orInput().attempt.provider,
      endpoint: "https://api.openai.com/v1/images/generations" } } }],
    ["cross tenant", { scope: { tenant_id: "tenant-foreign", project_id: "creative-project-test" } }],
    ["expired deadline", { deadline_at: new Date(NOW - 1).toISOString() }],
    ["already cancelled", { signal: AbortSignal.abort() }],
  ];
  for (const [name, override] of scenarios) await t.test(name, async () => {
    const harness = orHarness({ inputOverride: override });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error instanceof OpenRouterImagesProviderError);
    assert.equal(harness.fetchCount, 0);
  });
  await t.test("references are not accepted on generation", async () => {
    const harness = orHarness({ inputOverride: { image_reference_manifest: { references: [] } } });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error.code === "invalid_reference_manifest");
    assert.equal(harness.fetchCount, 0);
  });
});

test("transport acknowledgement and the final dispatch fence precede the single POST", async (t) => {
  await t.test("order of authority, acknowledgement, revalidation, fence, and fetch", async () => {
    const harness = orHarness();
    await harness.provider.generate(harness.ctx);
    assert.deepEqual(harness.events, ["capability.verify", "authority.preparation", "credential.resolve",
      "authority.post_transport_ack", "capability.revalidate", "fetch.called"]);
  });
  await t.test("unconfirmed or mismatched acknowledgement never posts", async () => {
    for (const recordTransportAttempt of [async () => { throw new Error("down"); }, async () => "dispatch-other"]) {
      const harness = orHarness({ inputOverride: { recordTransportAttempt } });
      await assert.rejects(harness.provider.generate(harness.ctx), (error) => error.provider_outcome === "unknown");
      assert.equal(harness.fetchCount, 0);
    }
  });
  await t.test("a closed final dispatch fence never posts", async () => {
    const harness = orHarness({ inputOverride: { revalidateDispatch: async () => "dispatch-other" } });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error.code === "dispatch_fence_closed");
    assert.equal(harness.fetchCount, 0);
  });
});

test("cancellation and deadline before or after transport never publish", async (t) => {
  await t.test("cancelled at the acknowledgement", async () => {
    const ctx = orInput();
    ctx.recordTransportAttempt = async () => { ctx.controller.abort(); return "dispatch-image-001"; };
    const harness = orHarness({ inputOverride: ctx });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error.provider_outcome === "unknown");
    assert.equal(harness.fetchCount, 0);
  });
  await t.test("cancelled while the response returns", async () => {
    const ctx = orInput();
    const harness = orHarness({ inputOverride: ctx, fetchImpl: async () => { ctx.controller.abort(); return orResponse(); } });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => {
      assert.equal(error.code, "provider_outcome_unknown");
      assert.equal(error.provider_outcome, "unknown");
      return true;
    });
    assert.equal(harness.fetchCount, 1);
  });
  await t.test("the deadline passes after the response is received", async () => {
    let clock = NOW;
    const harness = orHarness({ now: () => clock, fetchImpl: async () => { clock = NOW + 120_000; return orResponse(); } });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error.code === "provider_outcome_unknown");
    assert.equal(harness.fetchCount, 1);
  });
  await t.test("the deadline passes before the dispatch fence", async () => {
    let clock = NOW;
    const harness = orHarness({ now: () => clock, inputOverride: { revalidateDispatch: async () => { clock = NOW + 120_000; return "dispatch-image-001"; } } });
    await assert.rejects(harness.provider.generate(harness.ctx), (error) => error.code === "dispatch_fence_closed");
    assert.equal(harness.fetchCount, 0);
  });
});

test("the canary credential and prompt never appear in any failure, event, or exposed evidence", async () => {
  const failures = [];
  for (const respond of [
    () => jsonResponse(401, { error: { code: 401, message: `bad key ${CREDENTIAL_CANARY}` } }),
    () => jsonResponse(403, { error: { code: 403, message: PROMPT, metadata: { flagged_input: PROMPT } } }),
    () => jsonResponse(200, { error: { code: 402, message: `Bearer ${CREDENTIAL_CANARY}` } }),
    () => new Response(`${PROMPT} ${CREDENTIAL_CANARY}`, { status: 500 }),
    () => new Response(JSON.stringify({ data: [{ b64_json: `data:image/png;base64,${CREDENTIAL_CANARY}` }] }), { status: 200 }),
  ]) {
    const harness = orHarness({ fetchImpl: async () => respond() });
    try { await harness.provider.generate(harness.ctx); assert.fail("must reject"); } catch (error) {
      failures.push(error);
      assertNoLeak(error);
      assertNoLeak(String(error.stack).split("\n")[0]);
      for (const key of Object.keys(error)) assertNoLeak(String(JSON.stringify(error[key])));
      assert.ok(!String(readDisposition(error) ?? "").includes(CREDENTIAL_CANARY));
    }
    assertNoLeak(harness.events);
  }
  assert.equal(failures.length, 5);
});
