import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import https from "node:https";
import { Resolver } from "node:dns/promises";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { Pool } from "pg";
import ConnectionParameters from "pg/lib/connection-parameters.js";
import sharp from "sharp";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    const candidates = specifier.startsWith("@/") ? [new URL(`../src/${specifier.slice(2)}`, import.meta.url)]
      : specifier.startsWith(".") && context.parentURL ? [new URL(specifier, context.parentURL)] : [];
    for (const base of candidates) for (const extension of ["", ".ts", ".tsx", ".mjs"]) {
      const url = new URL(`${base.href}${extension}`);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) return { format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return nextLoad(url, context);
  },
});

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), "ticketstub-creative-host-"));
const { creativeHostConfig, currentProjectAuthority, providerCredentialPort, financeConnectionOptions } = await import("../src/server/creative/config.mjs");
const { canonicalHash } = await import("creative-engine/contracts");
const { buildCreativeBrief } = await import("creative-engine/planning");
const { changeBudgetPolicy, budgetDigest, readReservationSnapshot } = await import("@jevelopers/cost-intelligence/budgets");
const { registerPricingRuleV2, registerRateCardV2 } = await import("@jevelopers/cost-intelligence/pricing");
const { ingestUsage } = await import("@jevelopers/cost-intelligence/metering");
const { invokeAgentCreativeDevelopment } = await import("../src/server/vendor/agent-harness/src/development/index.js");
const { creativeHostForRequest } = await import("../src/server/creative/host.mjs");
const { createCreativeFinance } = await import("../src/server/creative/finance.mjs");
const { POST } = await import("../src/app/api/creative/route.ts");
const { POST: ART } = await import("../src/app/api/art/route.ts");

const ref = (contract, value = {}) => ({ contract, schema_version: "1.0.0", id: randomUUID(), revision: 1, content_hash: canonicalHash(value) });
const later = () => new Date(Date.now() + 30 * 60_000).toISOString();
const profile = { model_id: "synthetic-lab/offline-image", provider_tag: "synthetic-provider", capabilities: { generation: true, edit: { max_input_references: 2 } },
  supported_parameters: { aspect_ratio: { type: "enum", values: ["1:1"] }, quality: { type: "enum", values: ["low"] }, output_format: { type: "enum", values: ["png"] }, background: { type: "enum", values: ["opaque"] } },
  configuration: { aspect_ratio: "1:1", quality: "low", output_format: "png", background: "opaque" } };
const config = { schema_version: "ticketstub.creative-host/1", environment: "test", database_path: join(temp, "creative.sqlite"), object_root: join(temp, "creative-objects"),
  registry_path: join(temp, "authority.json"), image_profile: profile };
const research = (entry) => ({ contract: "EventIntelligencePackage", schema_version: "1.1", event_id: randomUUID(), tenant_id: entry.tenant_id, project_id: entry.project_id,
  correlation_id: randomUUID(), producer: "offline-external-research-data", occurred_at: new Date().toISOString(), ingested_at: new Date().toISOString(), environment: "test", billing_mode: "simulated",
  source_refs: ["page-offline"], package_id: "research-offline", source_identity: [{ source_id: "page-offline", uri: "https://example.test/event", retrieved_at: new Date().toISOString(), content_hash: canonicalHash("offline source bytes") }],
  facts: [{ fact_id: "name-offline", key: "event_name", status: "verified", value: "Offline Festival", provenance: [{ source_id: "page-offline", retrieved_at: new Date().toISOString(), evidence_ref: "source-name-offline" }] },
    { fact_id: "date-offline", key: "event_date", status: "verified", value: "2027-05-18", provenance: [{ source_id: "page-offline", retrieved_at: new Date().toISOString(), evidence_ref: "source-date-offline" }] }],
  assets: { presence: "absent", items: [] }, preferences: { presence: "absent", items: [] }, interpretations: { presence: "absent", items: [] }, permissions: { presence: "absent", items: [] }, locks: { presence: "absent", items: [] } });
const mapping = { schema_version: "ticketstub.openrouter-image-usage/1", model_id: profile.model_id, finance_model_compatibility_id: "synthetic-lab.offline-image", provider_tag: profile.provider_tag,
  budget_consumption_basis: "provider_reported_unsettled", essential_fields: ["input_tokens", "output_tokens", "total_tokens", "cost"] };
let entry = {
  application_project_id: "stub-offline", application_owner_id: "account-offline", brief_id: "brief-offline", tenant_id: randomUUID(), project_id: randomUUID(), budget_scope_id: randomUUID(),
  allowed_actor_ids: ["account-offline"], expires_at: later(), permissions: ["creative.generate", "creative.edit", "creative.read", "creative.cancel", "creative.restore", "creative.brief.create"],
  finance_service: { actor_id: "ticketstub-creative-service", grant_revision: "offline-delegation-1", operations: ["budgets.authorize", "budgets.markDispatched", "budgets.readReservation", "budgets.release", "budgets.settle", "metering.ingestUsage"],
    evidence_ref: "offline-owner-delegation", evidence_sha256: canonicalHash("offline owner-issued delegation"), source_authority_ref: ref("CreativeFinanceSource"), expires_at: later() },
  image_access: { service: "openrouter", model_id: profile.model_id, provider_tag: profile.provider_tag, account_ref: "offline-ce-account", project_ref: "offline-ce-key", grant_ref: "offline-ce-access-grant",
    eligible: true, quota_status: "available", operations: ["generate", "edit"], evidence_ref: "offline-eligibility", evidence_sha256: canonicalHash("offline eligibility data"), expires_at: later(), profile_sha256: canonicalHash(profile) },
  maximums: { image_generation: { amount: "1.00", policy_ref: ref("CreativeMaximumPolicy"), evidence_ref: "offline-maximum", evidence_sha256: canonicalHash("offline maximum"), expires_at: later() },
    image_edit: { amount: "1.00", policy_ref: ref("CreativeMaximumPolicy"), evidence_ref: "offline-edit-maximum", evidence_sha256: canonicalHash("offline edit maximum"), expires_at: later() } },
  budget_policy_ref: ref("BudgetPolicy"), research_package: {}, asset_permissions: [],
  usage_profile: { ref: "offline-reviewed-openrouter-usage/1", sha256: canonicalHash(mapping), mapping, source_authority_ref: ref("ImageUsageProfile"), expires_at: later() },
};
entry.research_package = research(entry);
entry.brief_id = buildCreativeBrief({ trusted_scope: { tenant_id: entry.tenant_id, project_id: entry.project_id }, research_package: entry.research_package,
  context: { created_at: new Date().toISOString(), environment: "test", billing_mode: "live", correlation_id: randomUUID() } }).brief.brief_id;
const writeRegistry = () => { writeFileSync(config.registry_path, JSON.stringify({ schema_version: "ticketstub.creative-authority/1", projects: [entry] }), { mode: 0o600 }); chmodSync(config.registry_path, 0o600); };
writeRegistry();

test("host configuration and private authority records fail closed; credentials remain separate", () => {
  const manifest = JSON.parse(readFileSync(join(root, "src/server/vendor/creative-engine/MANIFEST.json"), "utf8"));
  const installed = dirname(dirname(dirname(fileURLToPath(import.meta.resolve("creative-engine/api/v1")))));
  for (const [file, expected] of Object.entries(manifest.files)) if (file.startsWith("src/")) {
    assert.equal(createHash("sha256").update(readFileSync(join(installed, file))).digest("hex"), expected, `installed owned runtime must match ${file}`);
  }
  assert.equal(creativeHostConfig({}), null);
  for (const bad of ["{}", "not json", JSON.stringify({ ...config, environment: "preview" }), JSON.stringify({ ...config, apiKey: "must-not-be-grouped" })]) {
    assert.throws(() => creativeHostConfig({ TICKETSTUB_CREATIVE_CONFIG: bad }), { code: "creative_configuration_unavailable" });
  }
  assert.throws(() => currentProjectAuthority(config, entry.application_project_id, "other-owner", "account-offline"));
  assert.throws(() => currentProjectAuthority(config, entry.application_project_id, entry.application_owner_id, "other-actor"));
  chmodSync(config.registry_path, 0o666);
  assert.throws(() => currentProjectAuthority(config, entry.application_project_id, entry.application_owner_id, "account-offline"));
  chmodSync(config.registry_path, 0o600);
  const authority = () => currentProjectAuthority(config, entry.application_project_id, entry.application_owner_id, "account-offline");
  const input = { service: "openrouter", scope: { tenant_id: entry.tenant_id, project_id: entry.project_id }, account_ref: entry.image_access.account_ref,
    project_ref: entry.image_access.project_ref, grant_ref: entry.image_access.grant_ref, target_binding_sha256: canonicalHash("target"), deadline_at: later() };
  const onlyStudio = providerCredentialPort(config, authority, { TICKETSTUB_ART_OPENROUTER_API_KEY: "offline-studio-only" });
  assert.throws(() => onlyStudio.resolveCredential(input), { code: "creative_credential_unavailable" });
  const credential = providerCredentialPort(config, authority, { CREATIVE_ENGINE_OPENROUTER_API_KEY: "offline-ce-only", TICKETSTUB_ART_OPENROUTER_API_KEY: "offline-studio-only" }).resolveCredential(input);
  assert.ok(credential.token === "offline-ce-only", "the creative credential identity must remain separate");
  const connection = new ConnectionParameters(financeConnectionOptions("postgresql://offline-runtime:synthetic-password@finance.example.test/creative", "production"));
  assert.deepEqual(connection.ssl, { rejectUnauthorized: true }); assert.equal(connection.statement_timeout, 5000);
  assert.equal(connection.connect_timeout, 2);
  for (const query of ["sslmode=disable", "ssl=false", "uselibpqcompat=true", "statement_timeout=0", "sslcert=/tmp/untrusted", "sslkey=/tmp/untrusted", "sslrootcert=/tmp/untrusted"]) {
    assert.throws(() => financeConnectionOptions(`postgresql://offline-runtime:synthetic-password@finance.example.test/creative?${query}`, "production"), { code: "creative_configuration_unavailable" });
  }
});

// Real public art route/provider execution, intercepted transport only.
test("direct studio provider failures are explicit and never publish simulated success", async () => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { TICKETSTUB_DB: join(temp, "app.sqlite"), TICKETSTUB_FILES: join(temp, "app-files"), TICKETSTUB_RUNTIME_MODE: "live",
    CONTEXT_SECRET: "offline-issuer-secret-with-at-least-thirty-two-characters", TICKETSTUB_ART_PROVIDER: "openai", TICKETSTUB_ART_MODEL: "gpt-image-2.5-sunburst" });
  delete process.env.GPT_IMAGE_MODEL;
  const { getStorage } = await import("../src/server/index.ts");
  const allowanceUsed = () => getStorage().db.prepare("SELECT coalesce(sum(count),0) AS total FROM art_usage").get().total;
  const call = async (signal) => {
    const response = await ART(new Request("https://ticketstub.test/api/art", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: { title: "Offline event", type: "generic", facts: [] }, first: true, edition: "researched" }), signal }));
    const value = await response.json();
    assert.ok(response.status >= 400); assert.equal(value.provenance, undefined); assert.equal(value.art, undefined); return value.error.code;
  };
  try {
    const before = allowanceUsed();
    delete process.env.OPENAI_API_KEY;
    assert.equal(await call(), "missing_provider_key");
    process.env.OPENAI_API_KEY = "offline-direct-canary";
    process.env.TICKETSTUB_ART_MODEL = "unsupported-model";
    assert.equal(await call(), "unsupported_image_model");
    delete process.env.TICKETSTUB_ART_MODEL;
    assert.equal(await call(), "invalid_model_configuration");
    process.env.TICKETSTUB_ART_MODEL = "gpt-image-2.5-sunburst";
    process.env.GPT_IMAGE_MODEL = "gpt-image-2";
    assert.equal(await call(), "invalid_model_configuration"); delete process.env.GPT_IMAGE_MODEL;
    assert.equal(allowanceUsed(), before, "invalid/missing image configuration cannot consume any quota");
    globalThis.fetch = async () => new Response("{}", { status: 401 });
    assert.equal(await call(), "provider_authentication_failed");
    globalThis.fetch = async () => { throw new TypeError("offline network failure"); };
    assert.equal(await call(), "provider_unavailable");
    const controller = new AbortController(); controller.abort();
    globalThis.fetch = async () => { throw new DOMException("cancelled", "AbortError"); };
    assert.equal(await call(controller.signal), "provider_request_cancelled");
  } finally { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
});

test("application session -> owned CE API/SQLite -> real Finance SQL -> intercepted OpenRouter -> immutable artifact", { skip: process.env.TICKETSTUB_OFFLINE_POSTGRES !== "1" }, async (t) => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  const name = `ticketstub-creative-offline-${randomBytes(5).toString("hex")}`;
  const adminPassword = randomBytes(32).toString("base64url");
  const runtimePassword = randomBytes(32).toString("base64url");
  const dockerEnvFile = join(temp, "postgres.env");
  writeFileSync(dockerEnvFile, `POSTGRES_PASSWORD=${adminPassword}\nPOSTGRES_DB=creative_offline\n`, { mode: 0o600 });
  const docker = (args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const image = "postgres@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d";
  docker(["image", "inspect", image]);
  docker(["run", "--rm", "--name", name, "-d", "-p", "127.0.0.1::5432", "--env-file", dockerEnvFile, image]);
  let admin; let runtime; let host; let failed = false;
  try {
    const port = Number(docker(["port", name, "5432/tcp"]).split(":").at(-1));
    for (let count = 0; count < 50; count += 1) {
      admin = new Pool({ host: "127.0.0.1", port, user: "postgres", password: adminPassword, database: "creative_offline", connectionTimeoutMillis: 1000 });
      try { await admin.query("SELECT 1"); break; } catch { await admin.end(); admin = null; await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.ok(admin, "the disposable PostgreSQL engine must be available");
    const migrations = join(root, "src/server/vendor/cost-intelligence/migrations");
    for (const file of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) await admin.query(readFileSync(join(migrations, file), "utf8"));
    await admin.query(`CREATE ROLE creative_runtime LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS`);
    await admin.query("GRANT ci_finance_runtime TO creative_runtime");
    runtime = new Pool({ host: "127.0.0.1", port, user: "creative_runtime", password: runtimePassword, database: "creative_offline" });
    Object.assign(process.env, { TICKETSTUB_DB: join(temp, "app.sqlite"), TICKETSTUB_FILES: join(temp, "app-files"), TICKETSTUB_RUNTIME_MODE: "live",
      CONTEXT_SECRET: "offline-issuer-secret-with-at-least-thirty-two-characters", ADMIN_EMAILS: "commissioning@example.test", TICKETSTUB_OPS_ENVIRONMENT: "test",
      GIT_SHA: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), APP_URL: "https://ticketstub.test",
      TICKETSTUB_CREATIVE_CONFIG: JSON.stringify(config), TICKETSTUB_FINANCE_DATABASE_URL: `postgresql://creative_runtime:${runtimePassword}@127.0.0.1:${port}/creative_offline`,
      CREATIVE_ENGINE_OPENROUTER_API_KEY: "offline-ce-only", TICKETSTUB_ART_OPENROUTER_API_KEY: "offline-studio-only" });
    const { getStorage } = await import("../src/server/index.ts");
    const { hashToken } = await import("../src/server/crypto.ts");
    const { newStub, NEATHACK } = await import("../src/customer/studio/fixtures.ts");
    const account = await getStorage().findOrCreateAccount("commissioning@example.test", Date.now());
    const cookie = randomBytes(24).toString("base64url");
    await getStorage().createSession(hashToken(cookie), account.id, Date.now(), Date.now() + 60 * 60_000);
    const stub = newStub(NEATHACK, entry.application_project_id);
    await getStorage().syncWall(account.id, [stub], [], Date.now());
    entry.application_owner_id = account.id; entry.allowed_actor_ids = [account.id];
    const financialScope = { tenantId: entry.tenant_id, projectId: entry.project_id, environment: "test", billingMode: "live", actorId: entry.finance_service.actor_id };
    // The external Finance owner provisions the policy as seeded data. Every
    // reservation and lifecycle call below uses the actual application ports.
    const policy = await changeBudgetPolicy({ schemaVersion: "1.0.0", requestId: randomUUID(), idempotencyKey: randomUUID(), scope: financialScope, currency: "USD", limitAmount: "50.00",
      expectedPolicyRevision: 0, actorReference: "offline-finance-owner", reasonReference: "offline-policy-provision", sourceAuthorityRef: entry.finance_service.source_authority_ref }, {
      database: runtime, clock: { now: () => new Date() }, trustedContext: { resolve: async (scope) => scope },
      financeAuthority: { authorizeCurrent: async (request) => ({ status: "allowed", decisionId: "offline-owner-provision", operation: request.operation, permission: request.permission,
        scope: request.requestedScope, principal: { kind: "service", actorId: financialScope.actorId, serviceStatus: "active", serviceGrantRevision: "offline-owner-provision" }, verifiedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }) },
      budgetEvidence: { verifyCurrent: async (query) => ({ status: "verified", queryDigest: await budgetDigest(query), verifiedAt: new Date().toISOString(), expiresAt: later() }) },
    });
    assert.equal(policy.ok, true, JSON.stringify(policy)); assert.equal(policy.value.status, "applied"); entry.budget_policy_ref = policy.value.policyRef;
    // Seed an explicitly synthetic external tariff through the actual Finance
    // catalog API. The host estimates against the SQL catalog; it does not do
    // local token arithmetic or treat this fixture as a production tariff.
    const published = new Date().toISOString();
    const tariffEvidence = ref("SyntheticTariffApproval", { provenance: "synthetic_fixture" });
    const pricingPorts = { database: runtime, clock: { now: () => new Date() }, trustedContext: { resolve: async (scope) => scope },
      financeAuthority: { authorizeCurrent: async (input) => ({ status: "allowed", decisionId: "offline-tariff-owner", operation: input.operation, permission: input.permission,
        scope: input.requestedScope, principal: { kind: "service", actorId: financialScope.actorId, serviceStatus: "active", serviceGrantRevision: "offline-tariff-owner" },
        verifiedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }) },
      actionAuthority: { authorize: async (input) => ({ allowed: true, decisionId: "offline-tariff-owner", action: input.action, scope: input.scope,
        actorId: input.scope.actorId, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }) } };
    const tariffBase = { schemaVersion: "2.0.0", revision: 1, provider: "typesafe", product: "systemone", effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      effectiveTo: null, retrievedAt: published, freshnessMaxAgeSeconds: 3600, sourceUrl: "https://example.test/synthetic-typesafe-tariff",
      sourceContentHash: canonicalHash("synthetic offline tariff, never a deployed tariff"), approvalRef: tariffEvidence, provenance: "synthetic_fixture" };
    const rule = await registerPricingRuleV2({ schemaVersion: "2.0.0", requestId: randomUUID(), idempotencyKey: randomUUID(), scope: financialScope,
      rule: { ...tariffBase, id: randomUUID(), usageSource: "provider_response", usageSemantics: "Input and output are separate disjoint provider counters.", partitionGroups: [],
        usageUnits: ["input_tokens", "output_tokens"].map((name) => ({ name, category: name, unit: "tokens", relation: "standalone", treatment: "charge_total", missingPolicy: "required" })) } }, pricingPorts);
    assert.equal(rule.ok, true, JSON.stringify(rule));
    const card = await registerRateCardV2({ schemaVersion: "2.0.0", requestId: randomUUID(), idempotencyKey: randomUUID(), scope: financialScope,
      rateCard: { ...tariffBase, id: randomUUID(), modelOrSku: "jev-1.13.0", aliases: [], contextTier: null, serviceTier: null, reasoningMode: null, toolClass: null,
        currency: "USD", pricingRuleRef: rule.value.reference,
        unitRates: ["input_tokens", "output_tokens"].map((name) => ({ category: name, unit: "tokens", basisQuantity: "1", rate: "0.001", relation: "standalone" })) } }, pricingPorts);
    assert.equal(card.ok, true, JSON.stringify(card));
    entry.finance_service.operations.push("pricing.estimateV2");
    entry.maximums.jev_decision = { amount: "1.00", policy_ref: ref("CreativeMaximumPolicy"), evidence_ref: "offline-jev-maximum", evidence_sha256: canonicalHash("offline JEV maximum"), expires_at: later() };
    entry.decision_access = { provider: "typesafe", model: "jev-1.13.0", environment: "test", accountRef: "offline-typesafe-account", projectRef: "offline-typesafe-key",
      grantRef: "offline-typesafe-grant", evidenceRef: "offline-typesafe-eligibility", evidenceSha256: canonicalHash("offline eligibility data"), expiresAt: later(), eligible: true };
    entry.decision_pricing = { product: "systemone", rate_card_ref: card.value.reference, allow_estimate_receipt_ref: true,
      source_authority_ref: tariffEvidence, expires_at: later() };
    process.env.TYPESAFE_API_KEY = "offline-typesafe-only";
    writeRegistry();
    const request = (body, token = cookie) => new Request("https://ticketstub.test/api/creative", { method: "POST", headers: { host: "ticketstub.test", origin: "https://ticketstub.test", "content-type": "application/json", cookie: `ts_session=${token}` }, body: JSON.stringify(body) });
    const dispatches = [];
    const decisionWrites = [];
    let beforeDecisionTls;
    let returnedDecisionModel = "jev-1.13.0";
    t.mock.method(Resolver.prototype, "resolve4", async (hostname) => { assert.equal(hostname, "api.typesafe.ai"); return ["93.184.216.34"]; });
    t.mock.method(Resolver.prototype, "resolve6", async (hostname) => { assert.equal(hostname, "api.typesafe.ai"); return []; });
    t.mock.method(https, "request", (options, callback) => {
      assert.equal(options.hostname, "api.typesafe.ai");
      assert.ok(options.headers.authorization === "Bearer offline-typesafe-only", "only the server decision credential may reach this transport");
      const request = new EventEmitter(); request.destroy = () => {};
      request.end = (bytes) => {
        decisionWrites.push(JSON.parse(bytes.toString()));
        const response = new EventEmitter(); const body = Buffer.from(JSON.stringify({ ...(returnedDecisionModel ? { model: returnedDecisionModel } : {}), answers: {
          layout: { type: "choice", choice: "bright", probabilities: { bright: 0.9, quiet: 0.1 }, confidence: 0.9 },
        }, usage: { input_tokens: 10, output_tokens: 4 } }));
        response.statusCode = 200; response.headers = { "content-length": String(body.length), "x-typesafe-request-id": "offline-provider-request" };
        response.rawHeaders = ["content-length", String(body.length), "x-typesafe-request-id", "offline-provider-request"];
        setImmediate(() => { callback(response); response.emit("data", body); response.emit("end"); });
      };
      const socket = new EventEmitter(); socket.encrypted = true; socket.authorized = true; socket.secureConnecting = true; socket.destroy = () => {};
      setImmediate(() => { void (async () => { request.emit("socket", socket); if (beforeDecisionTls) await beforeDecisionTls();
        socket.secureConnecting = false; socket.emit("secureConnect"); })().catch((error) => request.emit("error", error)); });
      return request;
    });
    const pixels = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#FF8F00" } }).png().toBuffer();
    let usage = { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46, cost: 0.04 };
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/images");
      assert.ok(init.headers.authorization === "Bearer offline-ce-only", "only the dedicated creative credential may reach this transport");
      const body = JSON.parse(init.body); assert.equal(body.model, profile.model_id); assert.deepEqual(body.provider, { only: [profile.provider_tag], allow_fallbacks: false });
      dispatches.push(body);
      return Response.json({ data: [{ b64_json: pixels.toString("base64"), media_type: "image/png" }], ...(usage ? { usage } : {}) });
    };
    const denied = await POST(request({ projectId: entry.application_project_id, operation: "list", actionId: randomUUID(), payload: { brief_id: entry.brief_id } }, "unrecognized-session"));
    assert.equal(denied.status, 404); assert.equal(dispatches.length, 0);
    for (const extra of [{ admission_context: { target_binding_sha256: canonicalHash("untrusted") } }, { environment: "production" }, { actor_id: "untrusted" }]) {
      const deniedBody = await POST(request({ projectId: entry.application_project_id, operation: "list", actionId: randomUUID(), payload: { brief_id: entry.brief_id }, ...extra }));
      assert.equal(deniedBody.status, 400); assert.equal(dispatches.length, 0); assert.equal(decisionWrites.length, 0);
    }
    host = await creativeHostForRequest(request({}), entry.application_project_id);
    const created = await POST(request({ projectId: entry.application_project_id, operation: "brief.create", actionId: randomUUID(), payload: {} }));
    const briefResult = await created.json(); assert.equal(created.status, 200, JSON.stringify(briefResult));
    const brief = briefResult.result.brief;
    let baseDesign = { contract: "DesignRoot", schema_version: "1.0", brief_id: entry.brief_id };
    const plan = (id, operation = "concept.generate") => ({ contract: "EditPlan", schema_version: "1.0", event_id: randomUUID(), tenant_id: entry.tenant_id, project_id: entry.project_id,
      correlation_id: randomUUID(), producer: "offline-consumer", occurred_at: new Date().toISOString(), ingested_at: new Date().toISOString(), environment: "test", billing_mode: "live", source_refs: [], plan_id: id,
      base: { brief_hash: canonicalHash(brief), design_hash: baseDesign.design_hash ?? canonicalHash(baseDesign),
        ...(baseDesign.design_version_id ? { design_version_id: baseDesign.design_version_id } : {}) }, operation,
      steps: [{ step_id: `${id}-step`, action: operation, source_refs: [], parameters: operation === "concept.generate" ? { brief_id: entry.brief_id, variant_count: 1 }
        : { design_version_id: baseDesign.design_version_id, artifact_id: baseDesign.artifact.artifact_id, instruction: "Make the artwork blue." } }],
      expected_result: { contract: "DesignVersion", schema_version: "1.0", parent_version_id: baseDesign.design_version_id ?? `root:${entry.brief_id}`, artifact_kind: "image" }, invalidates: [] });
    const decisionRequest = { execution_mode: "independent_batch", state: { text: "Synthetic verified offline festival facts." }, questions: {
      layout: { type: "choice", question_schema_version: "1.0", policy_version: "offline-layout-policy/1", instructions: "Select one synthetic layout.",
        criteria: { bright: "Bright layout", quiet: "Quiet layout" }, eligible_candidate_ids: ["bright", "quiet"], policy: { minimum_confidence: 0.7, low_confidence_action: "review" } },
    } };
    const action = randomUUID(); const input = { projectId: entry.application_project_id, operation: "generate", actionId: action,
      payload: { brief_id: entry.brief_id, plan: plan("offline-generation"), decision_request: decisionRequest } };
    const commit = host.store.commitPreparedDesignVersion.bind(host.store);
    let signalPublication; let releasePublication;
    const publicationPaused = new Promise((resolve) => { signalPublication = resolve; });
    const publicationGate = new Promise((resolve) => { releasePublication = resolve; });
    t.mock.method(host.store, "commitPreparedDesignVersion", async (...args) => {
      const answer = await commit(...args);
      assert.equal(host.store.db.isTransaction, true, "the actual owner publication transaction remains open");
      signalPublication(); await publicationGate;
      return answer;
    });
    const publishing = POST(request(input));
    await Promise.race([publicationPaused, publishing.then(async (response) => { throw new Error(`Publication did not reach its owner commit: ${JSON.stringify(await response.clone().json())}`); })]);
    let concurrentReadCompleted = false;
    const reading = POST(request({ projectId: entry.application_project_id, operation: "list", actionId: randomUUID(), payload: { brief_id: entry.brief_id } }))
      .then((response) => { concurrentReadCompleted = true; return response; });
    await new Promise((resolve) => setImmediate(resolve));
    const concurrentReadWasBlocked = !concurrentReadCompleted;
    releasePublication();
    const response = await publishing; const result = await response.json();
    const readResponse = await reading; const readResult = await readResponse.json();
    assert.equal(concurrentReadWasBlocked, true, "another request cannot observe an uncommitted artifact through another controller");
    assert.equal(readResponse.status, 200); assert.equal(readResult.result.items.length, 1);
    const stageSummary = host.store.db.prepare("SELECT state FROM ticketstub_creative_attempts").all().map((row) => { const value = JSON.parse(row.state); return { state: value.state, authority_error: value.authority_error }; });
    assert.equal(response.status, 200, `${JSON.stringify(result)} ${JSON.stringify(stageSummary)}`); assert.equal(result.ok, true); assert.equal(dispatches.length, 1); assert.equal(decisionWrites.length, 1);
    const design = result.result.design ?? result.result.design_version ?? result.result;
    const versions = await host.store.listDesignVersions({ scope: { tenant_id: entry.tenant_id, project_id: entry.project_id }, brief_id: entry.brief_id, limit: 100 });
    assert.equal(versions.items.length, 1);
    const bytes = await host.store.getArtifactBytes({ scope: { tenant_id: entry.tenant_id, project_id: entry.project_id }, brief_id: entry.brief_id, design_version_id: versions.items[0].design_version_id });
    assert.equal(canonicalHash(Array.from(bytes)), canonicalHash(Array.from(pixels)));
    assert.equal(versions.items[0].artifact.content_hash, `sha256:${createHash("sha256").update(pixels).digest("hex")}`);
    assert.ok(design, "the canonical API returns its actual publication result");
    const repeated = await POST(request(input)); assert.equal(repeated.status, 200); assert.equal(dispatches.length, 1, "idempotent replay cannot spend twice");
    const financial = await admin.query("SELECT reservation_id,event_type,consumed_amount::text FROM cost_intelligence.budget_reservation_events WHERE tenant_id=$1 ORDER BY reservation_id,event_sequence", [entry.tenant_id]);
    const histories = Map.groupBy(financial.rows, (row) => row.reservation_id);
    assert.equal(histories.size, 2);
    for (const rows of histories.values()) assert.deepEqual(rows.map((row) => row.event_type), ["authorized", "dispatched", "settled"]);
    assert.deepEqual(financial.rows.filter((row) => row.event_type === "settled").map((row) => Number(row.consumed_amount)).sort(), [0.014, 0.04]);
    const observations = await admin.query("SELECT event_facts FROM cost_intelligence.usage_intake_inbox WHERE tenant_id=$1", [entry.tenant_id]);
    assert.equal(observations.rows.length, 2);
    const committed = host.store.db.prepare("SELECT state FROM ticketstub_creative_attempts").all().map((row) => JSON.parse(row.state));
    for (const row of committed) {
      const facts = observations.rows.find((item) => item.event_facts.billable_attempt_id === row.attempt.billable_attempt_id).event_facts;
      assert.equal(facts.transport_attempt_id, row.transport_id); assert.equal(facts.source_observation_id, row.finance_observation_id);
      assert.equal(row.identity_projection.creative.model, row.attempt.provider.model);
      assert.equal(row.identity_projection.creative.source_observation_id, row.observation.source_observation_id);
      assert.equal(row.identity_projection.finance.model, facts.model); assert.equal(row.identity_projection.finance.source_observation_id, facts.source_observation_id);
      assert.equal(canonicalHash(row.identity_projection), row.identity_projection_ref.content_hash);
      assert.ok(facts.source_refs.some((ref) => ref.id === row.identity_projection_ref.id && ref.content_hash === row.identity_projection_ref.content_hash));
      assert.equal(facts.valuation.basis, "estimated", "reported/quoted cost is never upgraded to reconciled provider expense");
      assert.deepEqual(facts.usage_units.map((unit) => unit.name).sort(), ["input_tokens", "output_tokens"]);
      assert.ok(facts.usage_units.every((unit) => unit.relation === "standalone"));
    }
    const imageAttempt = committed.find((row) => row.attempt.provider.name === "openrouter");
    assert.equal(versions.items[0].billable_attempt_id, imageAttempt.attempt.billable_attempt_id);
    assert.equal(imageAttempt.reported_cost_receipt.provenance, "provider_reported_unsettled");
    assert.equal(imageAttempt.identity_projection.creative.model, profile.model_id);
    assert.equal(imageAttempt.identity_projection.finance.model, mapping.finance_model_compatibility_id);
    for (const units of [
      [{ name: "total_tokens", quantity: "46", scale: 0, relation: "standalone" }],
      [{ name: "input_tokens", quantity: "12", scale: 0, relation: "included_subset", included_in: "total_tokens" }],
    ]) {
      const invalid = structuredClone(imageAttempt.usage_request); const attemptId = randomUUID();
      Object.assign(invalid, { requestId: randomUUID(), idempotencyKey: randomUUID() });
      Object.assign(invalid.usageEvent, { event_id: randomUUID(), usage_event_id: randomUUID(), source_observation_id: randomUUID(),
        logical_operation_id: randomUUID(), provider_attempt_id: attemptId, billable_attempt_id: attemptId, transport_attempt_id: randomUUID(), usage_units: units });
      const quarantined = await ingestUsage(invalid, { ...pricingPorts, providerSource: { isAvailable: async () => true } });
      assert.equal(quarantined.ok, true); assert.equal(quarantined.value.status, "quarantined"); assert.equal(quarantined.value.quarantineCode, "unsafe_metadata");
      assert.equal(quarantined.value.durableCommit, true, "unsupported Finance privacy units stay in durable quarantine");
    }
    assert.equal(Number((await admin.query("SELECT count(*) AS count FROM cost_intelligence.usage_intake_inbox WHERE tenant_id=$1", [entry.tenant_id])).rows[0].count), 2,
      "quarantined source records cannot overwrite the two accepted observations");
    const decisionAttempt = committed.find((row) => row.attempt.provider.name === "typesafe");
    const quotes = await admin.query("SELECT usage_event_id,result_payload FROM cost_intelligence.pricing_estimate_snapshots WHERE tenant_id=$1", [entry.tenant_id]);
    assert.equal(quotes.rows.length, 1); assert.equal(quotes.rows[0].usage_event_id, decisionAttempt.usage_request.usageEvent.usage_event_id);
    assert.equal(canonicalHash(quotes.rows[0].result_payload), canonicalHash(decisionAttempt.pricing_result));
    assert.equal(decisionAttempt.usage_request.usageEvent.valuation.rate_card_ref.contract, "PricingEstimateReceipt");
    assert.equal(decisionAttempt.usage_request.usageEvent.valuation.rate_card_ref.id, quotes.rows[0].result_payload.requestId);
    assert.equal(decisionAttempt.usage_request.usageEvent.valuation.rate_card_ref.content_hash, canonicalHash(quotes.rows[0].result_payload));
    const finance = createCreativeFinance({ database: host.store.db, pool: runtime, environment: "test", sourceRevision: process.env.GIT_SHA,
      authority: () => currentProjectAuthority(config, entry.application_project_id, account.id, account.id),
      currentContext: async () => { const checked = await host.invoke({ projectId: entry.application_project_id, operation: "list", actionId: randomUUID(), payload: { brief_id: entry.brief_id } }); assert.equal(checked.ok, true); } });
    const settlementInput = { billable_attempt_id: imageAttempt.attempt.billable_attempt_id, logical_operation_id: imageAttempt.attempt.logical_operation_id,
      reservation_id: imageAttempt.reservation_id, lease_id: imageAttempt.binding.leaseRef, source_observation_id: imageAttempt.observation.source_observation_id };
    const originalMapping = JSON.stringify(imageAttempt);
    for (const corrupt of [
      (row) => { delete row.reported_cost_receipt; },
      (row) => { row.reported_cost_receipt.target_binding_sha256 = canonicalHash("wrong target"); row.reported_cost_receipt_sha256 = canonicalHash(row.reported_cost_receipt); },
      (row) => { row.reported_cost_receipt.amount = "0.99"; row.reported_cost_receipt_sha256 = canonicalHash(row.reported_cost_receipt); },
      (row) => { row.identity_projection.finance.model = "incorrect-compatibility-label"; row.identity_projection_ref.content_hash = canonicalHash(row.identity_projection); },
    ]) {
      const mutated = JSON.parse(originalMapping); corrupt(mutated);
      host.store.db.prepare("UPDATE ticketstub_creative_attempts SET state=? WHERE billable_attempt_id=?").run(JSON.stringify(mutated), imageAttempt.attempt.billable_attempt_id);
      assert.equal((await finance.metering.settleReservation(settlementInput)).status, "held_for_reconciliation", "private receipt/projection corruption cannot authorize another settlement");
    }
    host.store.db.prepare("UPDATE ticketstub_creative_attempts SET state=? WHERE billable_attempt_id=?").run(originalMapping, imageAttempt.attempt.billable_attempt_id);
    assert.equal(Number((await admin.query("SELECT count(*) AS count FROM cost_intelligence.budget_reservation_events WHERE tenant_id=$1", [entry.tenant_id])).rows[0].count), 6);
    const driver = await invokeAgentCreativeDevelopment({ host, request: { projectId: entry.application_project_id, environment: "test", operation: "list", actionId: randomUUID(), payload: { brief_id: entry.brief_id } }, source_manifest: host.source_manifest });
    assert.equal(driver.response.ok, true); assert.equal(dispatches.length, 1); assert.equal(decisionWrites.length, 1);
    const stale = await POST(request({ ...input, actionId: randomUUID() }));
    assert.equal((await stale.json()).error.code, "stale_version"); assert.equal(dispatches.length, 1, "an obsolete generation root cannot spend");
    baseDesign = versions.items[0];
    const cancelAction = randomUUID();
    beforeDecisionTls = async () => {
      const job = host.store.db.prepare("SELECT job_id FROM creative_jobs WHERE tenant_id=? AND project_id=? AND action_id=?")
        .get(entry.tenant_id, entry.project_id, cancelAction);
      assert.ok(job);
      const cancelled = await POST(request({ projectId: entry.application_project_id, operation: "cancel", actionId: randomUUID(), payload: { job_id: job.job_id } }));
      assert.equal(cancelled.status, 200, JSON.stringify(await cancelled.json()));
    };
    const cancelled = await POST(request({ projectId: entry.application_project_id, operation: "edit", actionId: cancelAction,
      payload: { brief_id: entry.brief_id, design_version_id: baseDesign.design_version_id, plan: plan("offline-cancel", "image.edit"), decision_request: decisionRequest } }));
    assert.ok(cancelled.status >= 400); assert.equal(decisionWrites.length, 1, "owned cancellation at TLS prevents the next provider write"); assert.equal(dispatches.length, 1);
    beforeDecisionTls = undefined;
    returnedDecisionModel = undefined;
    const uncertainInput = { projectId: entry.application_project_id, operation: "edit", actionId: randomUUID(),
      payload: { brief_id: entry.brief_id, design_version_id: baseDesign.design_version_id, plan: plan("offline-unverified-model", "image.edit"), decision_request: decisionRequest } };
    const uncertain = await POST(request(uncertainInput)); assert.ok(uncertain.status >= 400);
    assert.equal(decisionWrites.length, 2); assert.equal(dispatches.length, 1, "unverified JEV model usage cannot permit image publication");
    const repeatedUncertain = await POST(request(uncertainInput)); const replayedUncertain = await repeatedUncertain.json();
    assert.ok(repeatedUncertain.status >= 400, JSON.stringify(replayedUncertain)); assert.equal(replayedUncertain.job.status, "failed");
    assert.equal(replayedUncertain.result, undefined, "pending recovery cannot be presented as a published result");
    assert.equal(decisionWrites.length, 2, "a durable unknown outcome cannot blindly resend");
    returnedDecisionModel = "jev-1.13.0";
    const savedAuthority = JSON.stringify(entry);
    for (const change of [
      (record) => { record.decision_access.grantRef = "revoked-original-grant"; },
      (record) => { record.finance_service.grant_revision = "changed-delegation-revision"; },
      (record) => { record.permissions = record.permissions.filter((permission) => permission !== "creative.edit"); },
      (record) => { record.decision_access.expiresAt = new Date(Date.now() - 1000).toISOString(); },
    ]) {
      beforeDecisionTls = async () => { change(entry); writeRegistry(); };
      const revoked = await POST(request({ projectId: entry.application_project_id, operation: "edit", actionId: randomUUID(),
        payload: { brief_id: entry.brief_id, design_version_id: baseDesign.design_version_id, plan: plan("offline-revoked-registry", "image.edit"), decision_request: decisionRequest } }));
      assert.ok(revoked.status >= 400); assert.equal(decisionWrites.length, 2); assert.equal(dispatches.length, 1, "current registry changes close paid dispatch");
      entry = JSON.parse(savedAuthority); writeRegistry();
    }
    beforeDecisionTls = undefined;
    // Fault injection preserves the actual SQLite read/result and all real
    // Finance calls. Change an external owner record during the owned final
    // synchronous job fence, after async permits have completed. The host's
    // uncached registry check must close this last send boundary.
    const originalPrepare = host.store.db.prepare.bind(host.store.db);
    let finalAuthorityChange;
    t.mock.method(host.store.db, "prepare", (sql) => {
      const statement = originalPrepare(sql);
      if (finalAuthorityChange && String(sql).includes("SELECT dispatch_intent_ref,context_fence_json,billable_attempt_id") && new Error().stack.includes("assertDispatchCurrent")) {
        const originalGet = statement.get.bind(statement);
        statement.get = (...args) => { const result = originalGet(...args); const change = finalAuthorityChange; finalAuthorityChange = undefined; change(entry); writeRegistry(); return result; };
      }
      return statement;
    });
    finalAuthorityChange = (record) => { record.finance_service.grant_revision = "changed-at-final-owner-fence"; };
    const finalRevocation = await POST(request({ projectId: entry.application_project_id, operation: "edit", actionId: randomUUID(),
      payload: { brief_id: entry.brief_id, design_version_id: baseDesign.design_version_id, plan: plan("offline-final-fence", "image.edit"), decision_request: decisionRequest } }));
    assert.ok(finalRevocation.status >= 400); assert.equal(finalAuthorityChange, undefined, "the actual owned final fence was traversed");
    assert.equal(decisionWrites.length, 2); assert.equal(dispatches.length, 1, "a changed final delegation cannot reach provider writes");
    entry = JSON.parse(savedAuthority); writeRegistry();
    // The same final owner read injects a real application authority change,
    // after the last awaited permit/Finance operation. No session result or
    // reservation response is mocked. The storage methods below execute their
    // owned synchronous SQLite transactions before returning their promises.
    const storage = getStorage(); const sessionHash = hashToken(cookie);
    const restoreSession = async () => { await storage.deleteSession(sessionHash); await storage.createSession(sessionHash, account.id, Date.now(), Date.now() + 60 * 60_000); };
    let wallRevision = Date.now();
    const authorityChanges = [
      { name: "session-revoked", change: () => { void storage.deleteSession(sessionHash); }, restore: restoreSession },
      { name: "session-expired", change: () => { storage.db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(Date.now() - 1, sessionHash); }, restore: restoreSession },
      { name: "staff-list-removed", change: () => { delete process.env.ADMIN_EMAILS; }, restore: async () => { process.env.ADMIN_EMAILS = account.email; } },
      { name: "membership-revised", change: () => { void storage.syncStaff(account.id, false); void storage.syncStaff(account.id, true); }, restore: async () => {} },
      { name: "ownership-tombstoned", change: () => { wallRevision = Math.max(wallRevision + 1, Date.now()); void storage.syncWall(account.id, [], [stub.id], wallRevision); },
        restore: async () => { wallRevision += 1; await storage.syncWall(account.id, [{ ...stub, updatedAt: wallRevision }], [], wallRevision); } },
    ];
    for (const provider of ["typesafe", "openrouter"]) for (const scenario of authorityChanges) {
      const actionId = randomUUID();
      finalAuthorityChange = scenario.change;
      const blocked = await POST(request({ projectId: entry.application_project_id, operation: "edit", actionId,
        payload: { brief_id: entry.brief_id, design_version_id: baseDesign.design_version_id, plan: plan(`offline-final-${provider}-${scenario.name}`, "image.edit"),
          ...(provider === "typesafe" ? { decision_request: decisionRequest } : {}) } }));
      try {
        assert.ok(blocked.status >= 400, `${provider}/${scenario.name} must fail closed`);
        assert.equal(finalAuthorityChange, undefined, `${provider}/${scenario.name} must traverse the actual final fence`);
        assert.equal(decisionWrites.length, 2); assert.equal(dispatches.length, 1, `${provider}/${scenario.name} cannot write to either provider`);
        const dispatch = host.store.db.prepare(`SELECT d.billable_attempt_id,d.reservation_ref,d.provider_name FROM creative_dispatch_intents d
          JOIN creative_jobs j ON j.tenant_id=d.tenant_id AND j.project_id=d.project_id AND j.job_id=d.job_id
          WHERE j.tenant_id=? AND j.project_id=? AND j.action_id=?`).get(entry.tenant_id, entry.project_id, actionId);
        assert.ok(dispatch, `${provider}/${scenario.name} must have its actual admitted dispatch`); assert.equal(dispatch.provider_name, provider);
        const retained = JSON.parse(host.store.db.prepare("SELECT state FROM ticketstub_creative_attempts WHERE billable_attempt_id=?").get(dispatch.billable_attempt_id).state);
        assert.equal(retained.reservation_id, dispatch.reservation_ref); assert.equal(retained.state, "held_for_reconciliation");
        const history = await admin.query(`SELECT event_type,held_amount::text,consumed_amount::text,released_amount::text
          FROM cost_intelligence.budget_reservation_events WHERE tenant_id=$1 AND reservation_id=$2 ORDER BY event_sequence`, [entry.tenant_id, dispatch.reservation_ref]);
        assert.deepEqual(history.rows.map((row) => row.event_type), ["authorized", "dispatched"], "a real Finance hold cannot be settled or released after final revocation");
        // Event amounts are deltas. A separately seeded external Finance-owner
        // read grant inspects the actual SQL reducer after app authority closes.
        const snapshot = await readReservationSnapshot({ schemaVersion: "1.0.0", requestId: randomUUID(), scope: retained.scope, reservationId: dispatch.reservation_ref }, pricingPorts);
        assert.equal(snapshot.ok, true); assert.equal(snapshot.value.reservation.billable_attempt_id, dispatch.billable_attempt_id);
        assert.equal(snapshot.value.state, "dispatched"); assert.equal(snapshot.value.reservation.lifecycle, "uncertain_in_flight");
        assert.ok(Number(snapshot.value.heldAmount) > 0); assert.equal(Number(snapshot.value.effectiveConsumedAmount), 0); assert.equal(Number(snapshot.value.releasedAmount), 0);
        assert.equal(snapshot.value.expectedRevision, 2); assert.equal(snapshot.value.reservation.usage_completeness, "unknown");
        assert.equal((await host.store.listDesignVersions({ scope: { tenant_id: entry.tenant_id, project_id: entry.project_id }, brief_id: entry.brief_id, limit: 100 })).items.length, 1,
          `${provider}/${scenario.name} cannot publish another artifact`);
      } finally { await scenario.restore(); }
    }
    t.diagnostic("Both provider paths denied final-fence session revocation/expiry, staff-list removal, membership revision and ownership tombstone; all 10 real PostgreSQL holds retained, zero extra provider writes.");
    usage = null;
    const missing = await POST(request({ ...input, operation: "edit", actionId: randomUUID(), payload: { brief_id: entry.brief_id,
      design_version_id: baseDesign.design_version_id, plan: plan("offline-missing-usage", "image.edit") } }));
    const missingResult = await missing.json();
    assert.ok(missing.status >= 400); assert.equal(dispatches.length, 2, JSON.stringify(missingResult));
    const retained = host.store.db.prepare("SELECT state FROM ticketstub_creative_attempts").all().map((row) => JSON.parse(row.state));
    assert.ok(retained.some((row) => row.state === "held_for_reconciliation"));
    assert.equal((await host.store.listDesignVersions({ scope: { tenant_id: entry.tenant_id, project_id: entry.project_id }, brief_id: entry.brief_id, limit: 100 })).items.length, 1);
    assert.ok(!JSON.stringify(result).includes("offline-ce-only"), "credentials do not appear in the public result");
    assert.ok(!JSON.stringify(retained).includes("offline-ce-only"), "credentials do not appear in durable mapping state");
    t.diagnostic(`Real PostgreSQL16 with all ${readdirSync(migrations).filter((file) => file.endsWith(".sql")).length} pinned CI migrations; intercepted image writes=${dispatches.length}, decision writes=${decisionWrites.length}; immutable versions=1.`);
  } catch (error) { failed = true; throw error; } finally {
    globalThis.fetch = originalFetch;
    if (host) await host.close(); if (runtime) await runtime.end(); if (admin) await admin.end();
    let cleanupFailed = false;
    try { docker(["rm", "-f", name]); } catch { cleanupFailed = true; }
    try { unlinkSync(dockerEnvFile); } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved);
    }
    if (cleanupFailed) {
      t.diagnostic(`Disposable PostgreSQL container cleanup failed: ${name}; inspect the local Docker runtime. No other containers were changed.`);
      if (!failed) assert.fail("The disposable PostgreSQL container could not be removed.");
    }
  }
});
