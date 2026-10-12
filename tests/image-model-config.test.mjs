import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { generateImage, providerFailure } from "../src/server/ai/providers.ts";

// Run the existing executor with dummy credentials and intercept fetch before any socket opens.
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
const jpeg = "/9j/AA==";
const reply = () => Response.json({ data: [{ b64_json: jpeg }], usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } });
const models = [
  "gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5", "gpt-image-2", "gpt-image-2-2026-04-21",
  "gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst-2026-09-08",
  "gpt-image-2.5-flare", "gpt-image-2.5-flare-2026-09-08", "chatgpt-image-latest",
];
function configure(values = {}) {
  process.env.TICKETSTUB_RUNTIME_MODE = "live";
  process.env.TICKETSTUB_ART_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "offline-direct-placeholder";
  for (const name of ["TICKETSTUB_ART_MODEL", "GPT_IMAGE_MODEL", "GPT_IMAGE_ACCESS_MODE", "TICKETSTUB_ART_OPENROUTER_API_KEY"]) delete process.env[name];
  Object.assign(process.env, values);
}

for (const name of ["TICKETSTUB_ART_MODEL", "GPT_IMAGE_MODEL"]) {
  for (const model of models) test(`${name} selects ${model} on the actual Images request`, async () => {
    configure({ [name]: model });
    const attempts = [];
    let posts = 0;
    globalThis.fetch = async (url, init) => {
      posts++;
      assert.equal(url, "https://api.openai.com/v1/images/generations");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.authorization, "Bearer offline-direct-placeholder");
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      assert.deepEqual(JSON.parse(init.body), {
        model, prompt: "Offline artwork", size: "1024x1536", n: 1,
        quality: "medium", output_format: "jpeg", output_compression: 82,
      });
      return reply();
    };
    const result = await generateImage("Offline artwork", undefined, attempt => attempts.push(attempt));
    assert.equal(posts, 1);
    assert.equal(result.value, `data:image/jpeg;base64,${jpeg}`);
    assert.equal(result.metadata.provider, "openai");
    assert.equal(result.metadata.requestedModel, model);
    assert.equal(result.metadata.returnedModel, undefined); // Images response does not prove a resolved alias.
    assert.deepEqual(result.metadata.usage, { inputTokens: 12, outputTokens: 8, totalTokens: 20, costUsd: undefined });
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].model, model);
    assert.equal(attempts[0].ok, true);
  });
}

test("equal canonical and compatibility selections normalize whitespace without a model change", async () => {
  const model = "gpt-image-2.5-sunburst-2026-09-08";
  configure({ TICKETSTUB_ART_MODEL: ` ${model} `, GPT_IMAGE_MODEL: model });
  globalThis.fetch = async (_url, init) => { assert.equal(JSON.parse(init.body).model, model); return reply(); };
  assert.equal((await generateImage("test")).metadata.requestedModel, model);
});

for (const [label, values, code] of [
  ["absent model", {}, "invalid_model_configuration"],
  ["empty canonical model", { TICKETSTUB_ART_MODEL: "" }, "invalid_model_configuration"],
  ["blank compatibility model", { GPT_IMAGE_MODEL: " " }, "invalid_model_configuration"],
  ["blank canonical cannot mask compatibility", { TICKETSTUB_ART_MODEL: " ", GPT_IMAGE_MODEL: "gpt-image-2" }, "invalid_model_configuration"],
  ["blank compatibility cannot mask canonical", { TICKETSTUB_ART_MODEL: "gpt-image-2", GPT_IMAGE_MODEL: "" }, "invalid_model_configuration"],
  ["conflicting model names", { TICKETSTUB_ART_MODEL: "gpt-image-2", GPT_IMAGE_MODEL: "gpt-image-1" }, "invalid_model_configuration"],
  ["text model", { GPT_IMAGE_MODEL: "gpt-4.1" }, "unsupported_image_model"],
  ["unknown future image ID", { GPT_IMAGE_MODEL: "gpt-image-999" }, "unsupported_image_model"],
  ["retired DALL-E model", { TICKETSTUB_ART_MODEL: "dall-e-3" }, "unsupported_image_model"],
  ["provider-prefixed direct ID", { TICKETSTUB_ART_MODEL: "openai/gpt-image-2" }, "invalid_model_configuration"],
  ["URL instead of model", { GPT_IMAGE_MODEL: "https://example.invalid/model" }, "invalid_model_configuration"],
  ["credential-like model", { GPT_IMAGE_MODEL: "sk-offline-placeholder" }, "invalid_model_configuration"],
]) test(`${label} rejects before any upstream attempt`, async () => {
  configure(values);
  const attempts = [];
  globalThis.fetch = () => { assert.fail("invalid image configuration attempted network"); };
  await assert.rejects(generateImage("test", undefined, attempt => attempts.push(attempt)), error => {
    assert.deepEqual(providerFailure(error), { status: code === "unsupported_image_model" ? 422 : 503, body: { code, error: "The selected AI service could not complete this request." } });
    return true;
  });
  assert.equal(attempts.length, 0);
});

for (const mode of ["codex_subscription", "api", "", "unrecognized"]) test(`access preference ${mode || "blank"} cannot supply deployed API access`, async () => {
  configure({ GPT_IMAGE_ACCESS_MODE: mode, GPT_IMAGE_MODEL: "gpt-image-2" });
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = () => { assert.fail("development preference dispatched without a server key"); };
  await assert.rejects(generateImage("test"), error => error.code === "missing_provider_key");
});

test("development subscription preference cannot replace the server credential or selected model", async () => {
  const model = "gpt-image-2.5-flare-2026-09-08";
  configure({ GPT_IMAGE_ACCESS_MODE: "codex_subscription", GPT_IMAGE_MODEL: model });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/images/generations");
    assert.equal(init.headers.authorization, "Bearer offline-direct-placeholder");
    assert.equal(JSON.parse(init.body).model, model);
    return reply();
  };
  assert.equal((await generateImage("test")).metadata.requestedModel, model);
});

test("runtime configuration is isolated on each invocation rather than cached between environments", async () => {
  const requests = [];
  globalThis.fetch = async (_url, init) => { requests.push({ model: JSON.parse(init.body).model, authorization: init.headers.authorization }); return reply(); };
  configure({ TICKETSTUB_ART_MODEL: "gpt-image-2-2026-04-21", OPENAI_API_KEY: "offline-preview-placeholder" });
  await generateImage("test");
  configure({ TICKETSTUB_ART_MODEL: "gpt-image-2.5-sunburst-2026-09-08", OPENAI_API_KEY: "offline-production-placeholder" });
  await generateImage("test");
  assert.deepEqual(requests, [
    { model: "gpt-image-2-2026-04-21", authorization: "Bearer offline-preview-placeholder" },
    { model: "gpt-image-2.5-sunburst-2026-09-08", authorization: "Bearer offline-production-placeholder" },
  ]);
});

test("OpenRouter retains its own model, discovery and credential and ignores the direct compatibility alias", async () => {
  const model = "openai/gpt-image-2";
  configure({ TICKETSTUB_ART_PROVIDER: "openrouter", TICKETSTUB_ART_MODEL: model, GPT_IMAGE_MODEL: "gpt-image-1", TICKETSTUB_ART_OPENROUTER_API_KEY: "offline-router-placeholder" });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    assert.equal(init.headers.authorization, "Bearer offline-router-placeholder");
    if (url.endsWith("/models")) return Response.json({ data: [{ id: model, architecture: { output_modalities: ["image"] } }] });
    assert.equal(JSON.parse(init.body).model, model);
    return Response.json({ data: [{ b64_json: jpeg, media_type: "image/jpeg" }] });
  };
  assert.equal((await generateImage("test")).metadata.requestedModel, model);
  assert.deepEqual(calls, ["https://openrouter.ai/api/v1/images/models", "https://openrouter.ai/api/v1/images"]);
});

test("OpenRouter cannot borrow GPT_IMAGE_MODEL when its model is missing", async () => {
  configure({ TICKETSTUB_ART_PROVIDER: "openrouter", GPT_IMAGE_MODEL: "gpt-image-2", TICKETSTUB_ART_OPENROUTER_API_KEY: "offline-router-placeholder" });
  globalThis.fetch = () => { assert.fail("missing OpenRouter model attempted network"); };
  await assert.rejects(generateImage("test"), error => error.code === "invalid_model_configuration");
});

test("demo execution ignores present credentials and invalid or conflicting model selections", async () => {
  configure({ TICKETSTUB_ART_MODEL: "invalid", GPT_IMAGE_MODEL: "gpt-image-2", GPT_IMAGE_ACCESS_MODE: "api" });
  process.env.TICKETSTUB_RUNTIME_MODE = "demo";
  globalThis.fetch = () => { assert.fail("demo attempted upstream transport"); };
  assert.equal(await generateImage("test"), undefined);
});

for (const [status, code] of [[401, "provider_authentication_failed"], [403, "provider_authentication_failed"], [429, "provider_rate_limited"], [400, "unsupported_provider_request"], [503, "provider_unavailable"]]) test(`direct image HTTP ${status} fails once with no model or provider fallback`, async () => {
  configure({ GPT_IMAGE_MODEL: "gpt-image-2.5-sunburst-2026-09-08" });
  const attempts = [];
  let posts = 0;
  globalThis.fetch = async (_url, init) => {
    posts++;
    assert.equal(JSON.parse(init.body).model, process.env.GPT_IMAGE_MODEL);
    return Response.json({ error: "private upstream diagnostic" }, { status });
  };
  await assert.rejects(generateImage("test", undefined, attempt => attempts.push(attempt)), error => error.code === code && !error.message.includes("private"));
  assert.equal(posts, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].ok, false);
  assert.equal(attempts[0].code, code);
  assert.equal(attempts[0].metadata, undefined); // No invented usage or successful result.
});
